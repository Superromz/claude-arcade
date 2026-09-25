#!/usr/bin/env node
// Claude Arcade web view server (see web/PROTOCOL.md for the contract).
//
//   node web/server.js          start the server and open the browser
//   arcade web                  the same, through the game.js shim
//
// Runs the battle headless with the same modules the terminal game uses
// (scene.js drawScene on an off-screen PixelCanvas, battle.js, loot.js...),
// streams it to the browser over Server-Sent Events and performs player
// actions through the same functions the terminal keys call.
//
// Environment:
//   ARCADE_WEB_PORT      first port to try (default 47800; 0 = any free port)
//   ARCADE_NO_BROWSER=1  don't open the browser
//   ARCADE_WEB_IDLE_MIN  stop after this many minutes with no browser open (default 30, 0 = never)
//   ARCADE_SCRIPTS       game scripts folder (default: found next to this file)
//
// Zero dependencies: Node built-ins only.
'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');
const crypto = require('crypto');

const DEFAULT_PORT = 47800;
const PORT_TRIES = 20;
const W = 320, H = 180;            // logical scene size in pixels
// The terminal game steps 10 ticks a second, and every timer in battle.js
// (wave pacing, cooldowns, animations) is counted in ticks. Running faster
// would clear waves, and earn kill XP, faster than in the terminal.
const HZ = 10;
const KEEPALIVE_MS = 15000;
const SNAPSHOT_CHECK_MS = 1000;
const SAVE_MS = 3000;
const BEAT_MS = 1000;
const MAX_BODY = 16 * 1024;
const MAX_STREAMS = 16;
const MAX_PARTICLES = 300;
const CLIENT_DIR = path.join(__dirname, 'client');

// ---------- helpers ----------

const r2 = (n) => (Number.isFinite(n) ? Math.round(n * 100) / 100 : 0);
const pidAlive = (pid) => { try { process.kill(pid, 0); return true; } catch (e) { return e.code === 'EPERM'; } };

// Deep copy that JSON can always encode: drops functions, cycles and non-finite numbers.
function clean(v, seen = new WeakSet(), depth = 0) {
  if (v === null) return null;
  const t = typeof v;
  if (t === 'number') return Number.isFinite(v) ? v : null;
  if (t === 'string' || t === 'boolean') return v;
  if (t !== 'object') return undefined;
  if (seen.has(v) || depth > 14 || v instanceof Map || v instanceof Set) return undefined;
  seen.add(v);
  let out;
  if (Array.isArray(v)) out = v.map((x) => { const c = clean(x, seen, depth + 1); return c === undefined ? null : c; });
  else {
    out = {};
    for (const k of Object.keys(v)) { const c = clean(v[k], seen, depth + 1); if (c !== undefined) out[k] = c; }
  }
  seen.delete(v);
  return out;
}

class BadInput extends Error { constructor(msg, status = 400) { super(msg); this.status = status; } }
const bad = (msg, status) => { throw new BadInput(msg, status); };
const str = (v, name, max = 120) => { if (typeof v !== 'string' || !v || v.length > max) bad(`${name} must be a string`); return v; };
const int = (v, name, lo, hi) => { if (!Number.isInteger(v) || v < lo || v > hi) bad(`${name} must be an integer from ${lo} to ${hi}`); return v; };
const num = (v, name, lo, hi) => { if (typeof v !== 'number' || !Number.isFinite(v) || v < lo || v > hi) bad(`${name} must be a number from ${lo} to ${hi}`); return v; };
const oneOf = (v, name, list) => { if (typeof v !== 'string' || !list.includes(v)) bad(`${name} must be one of: ${list.join(', ')}`); return v; };

// Where the game scripts live: installed (~/.claude/arcade/web next to bin/),
// inside the plugin (plugins/claude-arcade/web next to scripts/), or the repo.
function findScripts(opts = {}) {
  const cands = [opts.scriptsDir, process.env.ARCADE_SCRIPTS,
    path.join(__dirname, '..', 'bin'),
    path.join(__dirname, '..', 'scripts'),
    path.join(__dirname, '..', 'plugins', 'claude-arcade', 'scripts')].filter(Boolean);
  const dir = cands.find((d) => fs.existsSync(path.join(d, 'scene.js')) && fs.existsSync(path.join(d, 'lib.js')));
  if (!dir) throw new Error(`Claude Arcade scripts not found (looked in ${cands.join(', ')})`);
  return path.resolve(dir);
}

function openBrowser(url) {
  if (/^(1|true|yes)$/i.test(process.env.ARCADE_NO_BROWSER || '')) return false;
  if (!/^http:\/\/127\.0\.0\.1:\d+\/[\w?=&./-]*$/.test(url)) return false;
  try {
    const { spawn } = require('child_process');
    const o = { detached: true, stdio: 'ignore', windowsHide: true };
    const child = process.platform === 'win32'
      ? spawn('cmd.exe', ['/c', 'start', '""', `"${url}"`], { ...o, windowsVerbatimArguments: true })
      : spawn(process.platform === 'darwin' ? 'open' : 'xdg-open', [url], o);
    child.on('error', () => {});
    child.unref();
    return true;
  } catch { return false; }
}

// ---------- server ----------

function start(opts = {}) {
  const dir = findScripts(opts);
  const req = (f) => require(path.join(dir, f));
  const L = req('lib.js');
  const X = req('pixel.js');
  const C = req('character.js');
  const SP = req('sprites.js');
  const MON = req('monsters.js');
  const { ui, UI, TABS, BIOMES, snapshotData, currentMode, biomeFor } = req('state.js');
  const B = req('battle.js');
  const { drawScene } = req('scene.js');
  const LOOT = req('loot.js');
  const { applyOverlay } = req('celebrate.js');
  const I = req('items.js');
  const SHOP = req('shop.js');
  const SK = req('skills.js');
  const BT = req('bounties.js');
  const G = req('guild.js');
  const { OPTIONS: LOOK_OPTIONS } = req('creator.js');

  const WEB_LOCK = path.join(L.HOME, 'web.lock');
  const log = opts.log || ((...a) => console.log(...a));

  // Another web server already owns the battle: hand its link back.
  const prev = L.readJSON(WEB_LOCK, null);
  if (prev && prev.pid && prev.pid !== process.pid && pidAlive(prev.pid) && !opts.force) {
    return Promise.resolve({ already: true, url: prev.url, port: prev.port, stop: async () => {} });
  }

  // ----- capture what drawScene draws (it keeps poses in locals) -----
  // scene.js calls SP.drawHero / SP.drawCompanion through the module object,
  // so wrapping them here records the exact pose and position of every frame.
  let capture = null;
  if (!SP.__arcadeWeb) {
    const drawHero = SP.drawHero, drawCompanion = SP.drawCompanion;
    SP.drawHero = function (pc, ch, x, y, o = {}) {
      if (capture) capture.hero = { x, y, o };
      return drawHero.apply(this, arguments);
    };
    SP.drawCompanion = function (pc, who, x, y, o = {}) {
      if (capture) capture.companions.push({ who, x, y, o });
      return drawCompanion.apply(this, arguments);
    };
    SP.__arcadeWeb = (c) => { capture = c; };
  }
  const setCapture = SP.__arcadeWeb;
  // A canvas that also remembers labels: the hero's thought bubble is the only
  // label drawn in INK (scene.js), which is how the bubble text is found.
  class RecCanvas extends X.PixelCanvas {
    constructor(c, r) { super(c, r); this.labels = []; }
    label(col, row, s, fg, bold) { this.labels.push([col, row, s, fg]); return super.label(col, row, s, fg, bold); }
  }
  const isInk = (c) => Array.isArray(c) && c[0] === 22 && c[1] === 18 && c[2] === 30;

  // ----- game state (mirrors game.js) -----

  // Load the active hero's banked gold, kills and bosses and reset the field (game.js enterGame).
  function enterGame() {
    const g = L.loadState().game || {};
    Object.assign(ui.battle, { monsters: [], shots: [], bolts: [], coins: [], wave: 0, practice: false, waveXp: 0, gold: g.gold || 0, kills: g.kills || 0, bosses: g.bosses || 0, lastEventT: Date.now() });
    ui.xpPending = 0;
    ui.screen = 'game';
  }

  // Bank gold, kills and kill XP under the state lock (game.js saveProgress).
  // Kill XP only exists outside practice waves; nothing here adds any.
  function saveProgress() {
    if (!ui.dirty) return;
    ui.dirty = false;
    try {
      L.withLock(() => {
        const st = L.loadState();
        if (ui.xpPending) { st.xp += ui.xpPending; st.battleXp = (st.battleXp || 0) + ui.xpPending; ui.xpPending = 0; }
        st.game = { ...(st.game || {}), bosses: Math.max((st.game || {}).bosses || 0, ui.battle.bosses || 0), gold: ui.battle.gold, kills: ui.battle.kills, bestWave: Math.max((st.game || {}).bestWave || 0, ui.battle.wave) };
        L.saveState(st);
      });
    } catch {}
  }

  const beat = () => { try { fs.mkdirSync(L.HOME, { recursive: true }); fs.writeFileSync(L.HEARTBEAT, String(Date.now())); } catch {} };

  // ----- battle event -----

  const monsterIds = new WeakMap();
  let nextMonsterId = 1;
  const mid = (m) => { if (!m || typeof m !== 'object') return null; let id = monsterIds.get(m); if (!id) { id = nextMonsterId++; monsterIds.set(m, id); } return id; };
  const isMonster = (v) => v && typeof v === 'object' && typeof v.type === 'string' && 'hp' in v && 'max' in v;

  // Skill effects hold references to monsters and skills; send ids instead.
  function cleanFx(f) {
    const out = {};
    for (const [k, v] of Object.entries(f)) {
      if (typeof v === 'number') out[k] = r2(v);
      else if (typeof v === 'string' || typeof v === 'boolean') out[k] = v;
      else if (isMonster(v)) out[`${k}Id`] = mid(v);
      else if (Array.isArray(v)) {
        if (v.every((x) => typeof x === 'number')) out[k] = v.map(r2);
        else if (v.every(isMonster)) out[`${k}Ids`] = v.map(mid);
        else if (v.every((x) => Array.isArray(x) && x.every((y) => typeof y === 'number'))) out[k] = v.map((x) => x.map(r2));
      } else if (v && typeof v === 'object' && typeof v.id === 'string') out[k] = { id: v.id };
    }
    return out;
  }

  const LOOK_KEYS = ['name', 'cls', 'primary', 'secondary', 'skin', 'hair', 'accessory', 'equipped'];

  function lootPresentation() {
    const lp = ui.loot;
    if (!lp || !lp.cur) return null;
    const r = lp.cur, tier = LOOT.TIERS.find((t) => t.id === r.tier) || {};
    return clean({
      kind: r.kind, tier: r.tier, tierName: tier.name, colors: { title: tier.title, body: tier.body, glow: tier.glow, trim: tier.trim },
      text: r.text, entries: r.entries, wave: r.wave || 0, practice: !!r.practice, upgraded: !!r.upgraded, from: r.from || null,
      legendary: !!r.legendary, age: ui.tick - r.t0, revealAt: LOOT.revealAt(r), duration: LOOT.duration(r),
    });
  }

  function battleEvent(d, pc, shake, cap) {
    const b = ui.battle, t = ui.tick;
    const mode = currentMode(d.ses);
    const floorY = H - Math.max(5, Math.floor(H * 0.18));
    const cls = C.CLASSES[d.hero.cls] ? d.hero.cls : 'mage';
    const ho = (cap.hero && cap.hero.o) || {};
    const hero = {
      x: r2(cap.hero ? cap.hero.x : ui.heroX), y: r2(cap.hero ? cap.hero.y : ui.heroY),
      pose: ho.pose || 'stand', flip: false, action: ui.heroAction ? clean(ui.heroAction) : null,
      busy: !!ho.busy, lookDir: ho.look || null, hop: !!ho.hop, hurt: Number.isFinite(ho.hurt) ? ho.hurt : -1,
      flinch: Number.isFinite(ho.flinch) ? ho.flinch : -1, alert: Number.isFinite(ho.alert) ? ho.alert : 99,
      hp: d.ses.hp == null ? 100 : d.ses.hp, cls, look: clean(Object.fromEntries(LOOK_KEYS.filter((k) => d.hero[k] !== undefined).map((k) => [k, d.hero[k]]))),
    };
    const allies = b.allyState || {};
    const companions = cap.companions.map(({ who, x, y, o }) => {
      const id = o.id !== undefined ? String(o.id) : null, st = id && allies[id];
      return {
        id, cls: SP.companionClass(who), name: (who && who.name) || null, x: r2(x), y: r2(y),
        attackT: st && Number.isFinite(st.attackT) ? st.attackT : null, attack: Number.isFinite(o.attack) ? o.attack : null,
        kind: (st && st.kind) || null, guild: !!(who && who.guild), level: (who && who.level) || null,
        walk: !!o.walk, flip: !!o.flip, sit: !!o.sit, sleep: !!o.sleep, alpha: r2(o.alpha == null ? 1 : o.alpha), t: o.t || 0,
      };
    });
    const monsters = b.monsters.map((m) => {
      const def = MON.MONSTERS[m.type] || {};
      let size = [0, 0];
      try { size = MON.monsterSize(m); } catch {}
      return {
        id: mid(m), type: m.type, boss: !!m.boss, elite: !!m.elite, minion: !!m.minion,
        x: r2(m.x), y: r2(m.y + (m.yOff || 0)), w: size[0], h: size[1], scale: m.scale || 1,
        hp: Math.max(0, m.hp), max: m.max, flash: m.flash || 0, frozen: m.frozen || 0, lunge: m.lunge || 0, windup: m.windup || 0,
        stun: m.stun || 0, burn: m.burn || 0, curse: m.curse || 0, poison: m.poison || 0, bleed: m.bleed || 0, taunt: m.taunt || 0,
        mark: m.mark || 0, doom: m.doom || 0, dying: m.hp <= 0, dieT: m.dieT || 0, entering: !!m.entering, phase: m.phase || 0,
        lvl: m.lvl, name: def.name || m.type, color: m.color || 0, seed: m.seed || 0, xp: b.practice ? 0 : m.xp || 0,
      };
    });
    const boss = b.monsters.find((m) => m.boss && m.hp > 0);
    const bubbleLabel = pc.labels.find((l) => isInk(l[3]));
    const kit = C.kitFor(cls);
    return {
      tick: t, t: Date.now(), hz: HZ, mode, biome: d.cfg.theme === 'space' ? 'space' : biomeFor(d.lvl), theme: d.cfg.theme,
      W, H, floorY, scroll: r2(ui.scroll || 0),
      hero, companions, monsters,
      shots: b.shots.map((s) => ({ x: r2(s.x), y: r2(s.y), id: (s.spell && s.spell.id) || null, color: s.color || null, cls: s.cls || null, ally: s.ally || null, aoe: (s.spell && s.spell.aoe) || 0 })),
      bolts: (b.bolts || []).map((bo) => ({ from: bo.from.map(r2), to: bo.to.map(r2), life: bo.life })),
      fx: (b.fx || []).map(cleanFx),
      dashes: (b.dashes || []).filter((ds) => ds.tx != null).map((ds) => ({ x0: r2(ds.x0), y0: r2(ds.y0), tx: r2(ds.tx), ty: r2(ds.ty), t: ds.t })),
      rings: (b.rings || []).map((r) => ({ x: r2(r.x), y: r2(r.y), r: r2(r.r), life: r.life, c: r.c })),
      coins: b.coins.map((c) => ({ x: r2(c.x), y: r2(c.y) })),
      particles: ui.particles.slice(-MAX_PARTICLES).map((p) => ({ x: r2(p.x), y: r2(p.y), c: p.c })),
      floaters: ui.floaters.map((f) => ({ x: r2(f.x), y: r2(f.y), text: f.text, color: f.color, bold: !!f.bold })),
      bubble: bubbleLabel ? { text: bubbleLabel[2] } : null,
      celebrate: ui.celebrate && ui.celebrate.kind ? clean({ kind: ui.celebrate.kind, text: ui.celebrate.text, age: t - (ui.celebrate._t0 == null ? t : ui.celebrate._t0), until: ui.celebrate.until }) : null,
      levelUp: ui.levelUp ? clean({ ...ui.levelUp, age: t - ui.levelUp.t0 }) : null,
      loot: lootPresentation(),
      wave: b.wave, kills: b.kills, gold: b.gold, practice: !!b.practice,
      boss: boss ? { id: mid(boss), name: (MON.MONSTERS[boss.type] || {}).name || boss.type, hp: Math.max(0, boss.hp), max: boss.max, phase: boss.phase || 0 } : null,
      shake, flash: b.flash || 0, shield: !!b.shield,
      hotbar: kit.map((s) => ({ id: s.id, name: s.name, lvl: s.lvl, locked: s.lvl > d.lvl, cd: Math.max(0, (ui.cooldowns[s.id] || 0) - t), cdLen: (ui.cdLen || {})[s.id] || s.cd })),
      buffs: clean(ui.buffs || []),
      approval: pendingCount > 0,
    };
  }

  // ----- snapshot (the d object the panels use, JSON-safe) -----

  const msgOf = (o) => (o && o.msg && o.msg.text && (o.msg.until == null || o.msg.until >= ui.tick) ? { text: o.msg.text, good: !!o.msg.good } : null);

  function buildSnapshot(d) {
    const cfg = d.cfg, st = d.state, th = L.theme(cfg);
    const game = st.game || {};
    const heroes = L.heroList(cfg, st);
    const lo = L.xpForLevel(d.lvl), hi = L.xpForLevel(d.lvl + 1);
    const got = new Set(st.achievements || []);
    const achievements = L.ACHIEVEMENTS.map((a) => {
      let v = 0;
      try { v = Number(a.value(st, d.ses)) || 0; } catch {}
      return { id: a.id, name: a.name, desc: a.desc, goal: a.goal, value: Math.min(v, a.goal), done: got.has(a.id) };
    });
    let bounties = null;
    try {
      const bd = BT.board(d);
      const item = (it) => ({ id: it.key, def: it.def.id, name: it.def.name, desc: it.def.desc, period: it.period, goal: it.goal, value: it.value, done: it.done, claimed: it.claimed, gold: it.def.gold, buff: it.def.buff || null, endsAt: it.endsAt });
      bounties = { day: bd.day, week: bd.week, daily: bd.daily.map(item), weekly: bd.weekly.map(item) };
    } catch {}
    let skills = null;
    try {
      const P = SK.points(d);
      const tree = SK.treeFor(P.cls).map((br, b) => ({
        name: br.name, color: br.color,
        nodes: br.nodes.map((n, i) => {
          const id = SK.nodeId(P.cls, b, i);
          return { id, b, n: i, name: n.name, max: n.max, desc: n.desc, lvl: SK.TIER_LVL[i], rank: Math.min(n.max, Number(P.sk.nodes[id]) || 0), blocked: SK.blocker(d, b, i) };
        }),
      }));
      skills = {
        cls: P.cls, tree, tierLvl: SK.TIER_LVL,
        points: { earned: P.earned, spent: P.spent, total: P.total, full: P.full, avail: P.avail, paragon: P.paragon, pSpent: P.pSpent, bosses: P.bosses },
        paragon: SK.PARAGON.map((p) => ({ id: p.id, name: p.name, desc: p.desc, color: p.color, rank: P.sk.paragon[p.id] || 0 })),
        respecs: P.sk.respecs, respecCost: SK.respecCost(P.sk.respecs),
      };
    } catch {}
    const equipped = (d.hero && d.hero.equipped) || {};
    const inv = new Set(SHOP.inventory(st));
    const gold = ui.battle.gold || 0;
    const shop = {
      gold, slots: I.SLOTS, slotNames: I.SLOT_NAMES, buffs: clean(ui.buffs || []),
      materials: Object.entries(SHOP.materials(st)).map(([id, n]) => ({ id, n, ...clean(I.getMaterial(id) || {}) })),
      items: I.CATALOG.map((it) => {
        const owned = it.slot !== 'buff' && inv.has(it.id);
        const recipe = it.craft ? SHOP.recipe(it, st).map((m) => ({ id: m.id, name: m.name, need: m.need, have: m.have, color: m.color })) : null;
        return {
          id: it.id, name: it.name, slot: it.slot, price: it.price, rarity: it.rarity, desc: it.desc || '', set: it.set || null,
          loot: !!it.loot, buff: clean(it.buff) || null, owned, equipped: equipped[it.slot] === it.id,
          craft: recipe, canCraft: !!(it.loot && recipe && !owned && recipe.every((m) => m.have >= m.need)),
          canBuy: !it.loot && (it.slot === 'buff' || !owned) && gold >= it.price,
        };
      }),
    };
    const guild = {
      members: clean(Array.isArray(game.guild) ? game.guild : []), offers: clean(Array.isArray(game.recruitOffers) ? game.recruitOffers : []),
      maxActive: G.MAX_ACTIVE, maxGuild: G.MAX_GUILD,
    };
    const approvals = L.pendingApprovals().map((r) => clean({ id: r.id, tool: r.tool, input: r.input, cwd: r.cwd, t: r.t }));
    return clean({
      cfg, hero: d.hero, heroes, needsHero: !(cfg.heroes || []).length, lvl: d.lvl, title: L.titleFor(th, d.lvl),
      xp: { value: st.xp, lo, hi }, themeName: th.name, xpLabel: th.xpLabel, stats: d.stats,
      state: { xp: st.xp, quests: st.quests, tools: st.tools, tokens: st.tokens, achievements: st.achievements, streak: st.streak, game, projects: st.projects || {} },
      ses: d.ses, sid: d.sid, sessions: d.sessions, events: d.events.slice(-150),
      achievements, bounties, skills, guild, shop, tabs: TABS, approvals,
      battle: { gold, kills: ui.battle.kills, wave: ui.battle.wave, bosses: ui.battle.bosses || 0, practice: !!ui.battle.practice },
      messages: { shop: msgOf(ui.shop), skills: msgOf(ui.skills), bounties: msgOf(ui.bounties), guild: msgOf(ui.guild) },
      web: { hz: HZ, W, H, terminalOpen: terminalWasOpen },
    });
  }
  // Fields that change on every read; ignored when deciding whether to push a snapshot.
  const volatile = (k, v) => (k === 'lastPlayed' ? undefined : v);

  // ----- actions -----

  function validLook(look, base) {
    if (!look || typeof look !== 'object' || Array.isArray(look)) bad('look must be an object');
    let out = { ...base };
    if (look.cls !== undefined) {
      oneOf(look.cls, 'look.cls', LOOK_OPTIONS.cls);
      // Picking a class resets its colors, like the creator does.
      if (look.cls !== base.cls) { const c = C.CLASSES[look.cls]; out = { ...out, cls: look.cls, primary: c.primary, secondary: c.secondary, accessory: c.accessory }; }
    }
    for (const f of ['primary', 'secondary', 'skin', 'hair', 'accessory']) if (look[f] !== undefined) out[f] = oneOf(look[f], `look.${f}`, LOOK_OPTIONS[f]);
    if (look.name !== undefined) {
      if (typeof look.name !== 'string' || !/^[\w .'-]{1,16}$/.test(look.name) || !look.name.trim()) bad('look.name must be 1-16 letters, digits, spaces or . \' -');
      out.name = look.name.trim();
    }
    return out;
  }

  const heroIds = () => (L.loadConfig().heroes || []).map((h) => h.id);

  function act(body) {
    if (!body || typeof body !== 'object' || Array.isArray(body)) bad('Expected a JSON object');
    const type = str(body.type, 'type', 20);
    let d = snapshotData();
    const reply = (ok, message) => ({ ok: !!ok, ...(message ? { message } : {}) });
    const note = (o) => (o && o.msg ? o.msg.text : undefined);
    const clearMsg = (k) => { if (ui[k]) ui[k].msg = null; };
    switch (type) {
      case 'cast': {
        const kit = C.kitFor(d.hero.cls);
        const slot = int(body.slot, 'slot', 0, Math.max(5, kit.length - 1));
        const spell = kit[slot];
        const why = !spell ? 'No skill in that slot' : spell.lvl > d.lvl ? `Unlocks at level ${spell.lvl}` : (ui.cooldowns[spell.id] || 0) > ui.tick ? 'Still cooling down' : !B.aliveMonsters().length ? 'No target: summon a wave' : '';
        B.playerCast(d, slot);
        return reply(!why, why || undefined);
      }
      case 'strike': {
        const px = num(body.x, 'x', -W, 2 * W), py = num(body.y, 'y', -H, 2 * H);
        const target = B.aliveMonsters().find((mo) => { const [mw, mh] = MON.monsterSize(mo); return px >= mo.x - 3 && px <= mo.x + mw + 3 && py >= mo.y - 4 && py <= mo.y + mh + 4; });
        if (target && (ui.cooldowns.click || 0) <= ui.tick) {
          ui.cooldowns.click = ui.tick + 3;
          const stat = d.stats[C.CLASSES[d.hero.cls].stat] || 10;
          B.hitMonster(target, Math.max(1, Math.round(C.damage(C.SPELLS[0], d.lvl, stat) * 0.8 * I.damageMultiplier())), [255, 255, 255]);
          B.emit(6, px, py, [[255, 255, 255], [255, 220, 120]], { spread: 1.2, up: 1.5 });
          return { ok: true, hit: true };
        }
        if (!target) B.emit(3, px, py, [[200, 200, 220]], { spread: 0.6, up: 0.8, life: 8 });
        return { ok: true, hit: false };
      }
      case 'wave': {
        // Stricter than the w key: monsters still walking in count too, so one click can't stack waves.
        if (ui.battle.monsters.some((m) => m.hp > 0)) return reply(false, 'Finish this wave first');
        ui.battle.practice = true;
        B.spawnWave(ui.sceneW || W, Math.floor(ui.heroY + 24), d.lvl);
        return reply(true, 'A practice wave appears');
      }
      case 'tab': return reply(true);
      case 'buy': case 'equip': case 'craft': case 'unequip': {
        const id = str(body.id, 'id', 60);
        const it = I.getItem(id);
        const slot = type === 'unequip' && I.SLOTS.includes(id) ? id : it && it.slot;
        if (!slot) bad('Unknown item', 404);
        clearMsg('shop');
        let ok;
        if (type === 'buy') ok = SHOP.buy(id, d);
        else if (type === 'craft') ok = SHOP.craft(id, d);
        else if (type === 'equip') ok = SHOP.equip(id, d);
        else ok = SHOP.unequip(slot, d);
        const why = type === 'equip' && !ok ? "You don't own that yet" : type === 'unequip' && !ok ? 'Nothing equipped there' : type === 'buy' && !ok && !note(ui.shop) && it.slot !== 'buff' ? 'Already owned' : undefined;
        return reply(ok, note(ui.shop) || why || (ok && type === 'equip' ? `Equipped ${it.name}` : ok && type === 'unequip' ? 'Unequipped' : undefined));
      }
      case 'learn': {
        const tree = SK.treeFor(d.hero.cls);
        let b, n;
        if (typeof body.node === 'string') {
          const m = /^([a-z]+)\.(\d)\.(\d)$/.exec(body.node);
          if (!m || m[1] !== (C.KITS[d.hero.cls] ? d.hero.cls : 'mage')) bad('node must be a node id of this hero\'s tree, like "mage.0.1"');
          b = Number(m[2]); n = Number(m[3]);
        } else if (body.node && typeof body.node === 'object') { b = body.node.b; n = body.node.n; } else bad('node is required');
        int(b, 'node branch', 0, tree.length - 1);
        int(n, 'node tier', 0, tree[b].nodes.length - 1);
        clearMsg('skills');
        const ok = SK.learn(d, b, n);
        return reply(ok, note(ui.skills));
      }
      case 'respec': { clearMsg('skills'); const ok = SK.respec(d); return reply(ok, note(ui.skills)); }
      case 'paragon': {
        const i = typeof body.stat === 'number' ? int(body.stat, 'stat', 0, SK.PARAGON.length - 1) : SK.PARAGON.findIndex((p) => p.id === oneOf(body.stat, 'stat', SK.PARAGON.map((p) => p.id)));
        clearMsg('skills');
        const ok = SK.learnParagon(d, i);
        return reply(ok, note(ui.skills));
      }
      case 'claim': {
        const id = str(body.id, 'id', 80);
        const it = BT.board(d).all.find((x) => x.key === id);
        if (!it) bad('No such bounty on the board', 404);
        if (it.claimed) return reply(false, 'Already claimed');
        if (!it.done) return reply(false, `${it.goal - it.value} to go`);
        clearMsg('bounties');
        const ok = BT.claim(it, d);
        return reply(ok, note(ui.bounties));
      }
      case 'guild': {
        const op = oneOf(body.op, 'op', ['accept', 'dismiss', 'toggle', 'release']);
        const id = str(body.id, 'id', 100);
        const fn = { accept: G.accept, dismiss: G.dismiss, toggle: G.toggleActive, release: G.release }[op];
        let res = { ok: false };
        L.withLock(() => {
          const st = L.loadState();
          st.game = { ...(st.game || {}) };
          res = fn(st, id) || res;
          if (res.ok) L.saveState(st);
        });
        return reply(res.ok, res.msg || (res.ok ? undefined : 'Nobody by that id'));
      }
      case 'hero': {
        const op = oneOf(body.op, 'op', ['switch', 'create', 'edit', 'delete']);
        if (op === 'create') {
          const look = validLook(body.look, { ...C.defaultCharacter(body.look && C.CLASSES[body.look.cls] ? body.look.cls : 'mage'), name: 'Hero' });
          ui.dirty = true; saveProgress();
          L.createHero(look);
          enterGame();
          return reply(true, `${look.name} the ${C.CLASSES[look.cls].name} begins their adventure!`);
        }
        const id = str(body.id, 'id', 80);
        if (!heroIds().includes(id)) bad('No hero with that id', 404);
        const active = L.loadConfig().activeHero;
        if (op === 'switch' || (op === 'edit' && id !== active)) {
          if (id !== active) { ui.dirty = true; saveProgress(); L.switchHero(id); enterGame(); }
          if (op === 'switch') return reply(true);
        }
        if (op === 'edit') {
          const cfg = L.loadConfig();
          const base = C.getCharacter(cfg) || C.defaultCharacter();
          cfg.character = { ...cfg.character, ...validLook(body.look, base) };
          L.saveConfig(cfg);
          return reply(true);
        }
        // delete
        if (heroIds().length <= 1) return reply(false, "You can't delete your only hero");
        if (id === active) { ui.dirty = true; saveProgress(); }
        L.deleteHero(id);
        if (id === active) enterGame();
        return reply(true);
      }
      case 'approval': {
        const id = str(body.id, 'id', 120);
        const behavior = oneOf(body.behavior, 'behavior', ['allow', 'deny', 'claude']);
        if (!/^[\w.-]+$/.test(id) || !L.pendingApprovals().some((r) => r.id === id)) bad('That request is no longer waiting', 404);
        L.answerApproval(id, behavior);
        if (behavior === 'allow') B.floater(ui.heroX, ui.heroY - 6, 'ALLOWED!', [120, 230, 120], true);
        if (behavior === 'deny') B.floater(ui.heroX, ui.heroY - 6, 'DENIED', [255, 90, 90], true);
        return reply(true);
      }
      case 'theme': {
        const name = oneOf(body.name, 'name', Object.keys(L.THEMES));
        const cfg = L.loadConfig();
        cfg.theme = name;
        L.saveConfig(cfg);
        return reply(true, `Theme: ${L.THEMES[name].name}`);
      }
      case 'quit': { setTimeout(() => stop(), 150); return reply(true, 'The web view is shutting down'); }
      default: bad(`Unknown action type "${type}"`);
    }
    return reply(false);
  }

  // ----- assets -----

  let assetsJSON = null, assetsTag = null;
  function assets() {
    if (assetsJSON) return assetsJSON;
    // FALLBACK: sprites.js keeps some tables private. Use its exports when they
    // exist; otherwise the copies/derivations below (keep in sync until exported).
    const FB = {
      CAPE: (flutter) => [
        ...Array(13).fill(''), '...KKKKKKKKKK...', '..K5555555555K..', '..K5555555555K..', '..K5555555555K..', '..K5555555555K..',
        '..K6555555555K..', '..K6555555556K..', flutter ? '.K66555555556K..' : '..K6655555566K..', flutter ? 'K666655555566K..' : '.K666555555666K.', flutter ? 'KKKKKK6666KKK...' : '.KKKKKKKKKKKKKK.',
      ],
      FACES: {
        blink: { 10: '....KSTSSTSK....' }, sleep: { 10: '....KShSShSK....' }, wince: { 10: '....KSKSSKSK....', 11: '....KSSEESTK....' },
        happy: { 11: '....KSSmmSTK....' }, lookL: { 10: '....KESSESSK....' }, lookR: { 10: '....KSSESSEK....' },
        yawn: { 10: '....KSTSSTSK....', 11: '....KSSmmSTK....', 12: '.....KTmmTK.....' }, surprise: { 9: '....KSESSESK....', 11: '....KSSSmSTK....' },
      },
      SIT_LEGS: { 21: '...K1222222223K.', 22: '...KKKKKKKK23vK.', 23: '..........KvvuK.' },
      COMP_BODY: ['...KKKKK...', '..KhhhhhK..', '.KhHhhhhhK.', '.KhSSSSShK.', '..KSESESK..', '..KSSSSTK..', '..KK122KK..', '.K1122223K.', 'KSK12223K..', '.KKYYYYYK..', '..K12K23K..', '..KvvKvvK..', '..KKKKKKK..'],
      COMP_WALK: { 10: '.K12K.K23K.', 11: '.KvvK.KvvK.', 12: '.KKKK.KKKK.' },
      COMP_SIT: '..K12223vvK',
      COMP_HEADS: {
        wizard: [-4, ['.....KK....', '....K55K...', '....K455K..', '...K4556K..', '..K45556K..', '.KYYYYYYYK.', 'KK4455566KK']],
        hood: [-1, ['...KKKK....', '..K4555K...', '.K455555K..', '.K4555556K.', '.K5SSSSS6K.', '.K5SESES6K.']],
        helm: [-2, ['....K55K...', '...K555K...', '..KK778KK..', '.K7788889K.', '.K7888889K.', '.K8SS8SS9K.', '.K8SESES9K.']],
        horns: [-2, ['.W.......W.', '.WK.....KW.', '..WKKKKKW..', '..K45556K..', '.K4555556K.', '.K5SSSSS6K.', '.K5SESES6K.']],
        cap: [-3, ['........P..', '.......PP..', '...KKKKKP..', '..K455556K.', '.K45YY5566K']],
        mask: [0, ['...KKKKK...', '..K45555K..', '.K4555556K.', '.K5SSSSS6K.', '.K5SESES6K.', '..K55556K..']],
      },
    };
    const BODY = SP.BODY || SP.POSES.stand;
    // ACCESSORY rows: derived by building the hero with and without it (no hat, no blink).
    const ACCESSORY = SP.ACCESSORY || Object.fromEntries(C.ACCESSORIES.filter((a) => a !== 'none' && a !== 'cape').map((a) => {
      const rows = SP.build({ ...C.defaultCharacter('mage'), accessory: a, equipped: { hat: 'x' } }, 'stand', 10, null);
      const diff = {};
      rows.forEach((r, i) => { if (r !== BODY[i]) diff[i] = [...r].map((ch, j) => (ch === BODY[i][j] ? '.' : ch)).join(''); });
      return [a, diff];
    }));
    const CAPE = SP.CAPE || FB.CAPE;
    const pick = (k) => (SP[k] !== undefined ? SP[k] : FB[k]);
    const fallbacks = ['BODY', 'ACCESSORY', 'CAPE', 'FACES', 'SIT_LEGS', 'COMP_BODY', 'COMP_WALK', 'COMP_SIT', 'COMP_HEADS'].filter((k) => SP[k] === undefined);
    const classColors = Object.fromEntries(Object.entries(C.CLASSES).map(([id, c]) => {
      const p = SP.palette({ ...C.defaultCharacter(id) });
      return [id, { primary: c.primary, secondary: c.secondary, head: c.head, weapon: c.weapon, 1: p[1], 2: p[2], 3: p[3], 4: p[4], 5: p[5], 6: p[6] }];
    }));
    const monsterPalettes = Object.fromEntries(Object.keys(MON.MONSTERS).map((type) => {
      const n = (MON.MONSTER_COLORS[type] || MON.MONSTER_COLORS.slime || [0]).length;
      return [type, Array.from({ length: n }, (_, i) => MON.paletteFor({ type, color: i }))];
    }));
    const monsterSizes = Object.fromEntries(Object.keys(MON.MONSTERS).map((type) => {
      const s = (o) => { try { return MON.monsterSize(o); } catch { return null; } };
      return [type, { normal: s({ type }), boss: s({ type, boss: true, scale: 1 }) }];
    }));
    const data = {
      version: 1,
      hero: {
        BODY, POSES: SP.POSES, HEADS: SP.HEADS, ACCESSORY, CAPE: { still: CAPE(false), flutter: CAPE(true) },
        FACES: pick('FACES'), SIT_LEGS: pick('SIT_LEGS'),
        palettes: { COLORS: C.COLORS, SKINS: C.SKINS, HAIR: C.HAIR }, BASE: X.BASE,
        paletteKeys: 'K outline, S/T skin, h/H hair, E eye, m mouth, 1-3 primary, 4-6 secondary, 7-9 metal, Y/y belt, v/u boots, W bone, P magic',
      },
      companions: {
        rows: { BODY: pick('COMP_BODY'), WALK: pick('COMP_WALK'), SIT: pick('COMP_SIT'), HEADS: pick('COMP_HEADS') },
        classColors, skins: Object.values(C.SKINS), hair: Object.values(C.HAIR),
      },
      monsters: { MONSTERS: MON.MONSTERS, MONSTER_COLORS: MON.MONSTER_COLORS, BOSS_POOLS: MON.BOSS_POOLS, ROSTERS: MON.ROSTERS, palettes: monsterPalettes, sizes: monsterSizes },
      props: { FIRE: X.FIRE, TORCH: X.TORCH, CHEST: X.CHEST, ANVIL: X.ANVIL, CRYSTAL: X.CRYSTAL, BIRD: X.BIRD, BOOK: X.BOOK, BASE: X.BASE },
      items: { CATALOG: I.CATALOG, RARITY: I.RARITY, SLOTS: I.SLOTS, SLOT_NAMES: I.SLOT_NAMES, SETS: I.SETS, MATERIALS: I.MATERIALS },
      classes: C.CLASSES, kits: C.KITS,
      looks: LOOK_OPTIONS,
      themes: Object.fromEntries(Object.keys(UI).map((k) => [k, { ...UI[k], name: (L.THEMES[k] || {}).name || k, xpLabel: (L.THEMES[k] || {}).xpLabel || 'XP' }])),
      biomes: BIOMES || ['dungeon', 'forest', 'lava', 'castle'],
      loot: { TIERS: LOOT.TIERS },
      skills: { PARAGON: SK.PARAGON, TIER_LVL: SK.TIER_LVL },
      fallbacks,
    };
    assetsJSON = JSON.stringify(clean(data));
    assetsTag = `"${crypto.createHash('sha1').update(assetsJSON).digest('hex').slice(0, 16)}"`;
    return assetsJSON;
  }

  // ----- simulation loop -----

  const DUMMY_W = 60, DUMMY_H = 20, DUMMY = Array(DUMMY_H).fill(' '.repeat(DUMMY_W));
  let lastBattle = null, lastD = null, pendingCount = 0, drawErrors = 0;

  function tick() {
    ui.tick++;
    let d;
    try { d = snapshotData(); } catch { return; }
    lastD = d;
    const pal = UI[d.cfg.theme] || UI.rpg;
    try { LOOT.lootTick(d); } catch {}
    const pc = new RecCanvas(W, H / 2);
    ui.sceneScale = 1; ui.textScale = null;
    const cap = { hero: null, companions: [] };
    setCapture(cap);
    try { drawScene(pc, d, pal); } catch (e) { if (drawErrors++ < 3) log(`Claude Arcade web: scene error: ${e && e.message}`); }
    setCapture(null);
    // sceneLines counts the screen shake down once per frame.
    const shake = ui.battle.shake || 0;
    if (ui.battle.shake > 0) ui.battle.shake--;
    // Level-up detection and banner expiry live in celebrate.applyOverlay;
    // run it on a throwaway frame so the timing matches the terminal.
    try { applyOverlay(DUMMY.slice(), d, pal, DUMMY_W, DUMMY_H); } catch {}
    // Advance the chest presentation queue like loot.js current().
    const lp = ui.loot;
    if (lp) {
      if (lp.cur && ui.tick - lp.cur.t0 >= LOOT.duration(lp.cur)) lp.cur = null;
      if (!lp.cur && lp.queue && lp.queue.length) { lp.cur = lp.queue.shift(); lp.cur.t0 = ui.tick; }
    }
    if (!streams.size) { lastBattle = null; return; }
    try { lastBattle = JSON.stringify(battleEvent(d, pc, shake, cap)); } catch (e) { if (drawErrors++ < 3) log(`Claude Arcade web: event error: ${e && e.message}`); return; }
    broadcast('battle', lastBattle, true);
  }

  let lastSnapKey = null;
  function snapshotJSON(d) {
    const snap = buildSnapshot(d || snapshotData());
    return { json: JSON.stringify(snap), key: JSON.stringify(snap, volatile) };
  }
  function pushSnapshot(force = false) {
    if (!streams.size) return;
    try {
      pendingCount = L.pendingApprovals().length;
      const s = snapshotJSON();
      if (!force && s.key === lastSnapKey) return;
      lastSnapKey = s.key;
      broadcast('snapshot', s.json);
    } catch {}
  }

  // ----- HTTP -----

  const token = crypto.randomBytes(24).toString('hex');
  const tokenBuf = Buffer.from(token);
  const tokenOk = (t) => typeof t === 'string' && t.length === token.length && crypto.timingSafeEqual(Buffer.from(t), tokenBuf);
  let port = 0;
  const streams = new Set();
  let lastStreamAt = Date.now();

  function broadcast(event, json, droppable = false) {
    const msg = `event: ${event}\ndata: ${json}\n\n`;
    for (const s of streams) {
      if (droppable && s.blocked) continue; // slow client: skip battle frames until it catches up
      if (!s.res.write(msg)) { s.blocked = true; s.res.once('drain', () => { s.blocked = false; }); }
    }
  }

  const BASE_HEADERS = { 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer', 'X-Frame-Options': 'DENY', 'Cross-Origin-Resource-Policy': 'same-origin' };
  function send(res, status, body, type = 'text/plain; charset=utf-8', extra = {}) {
    res.writeHead(status, { ...BASE_HEADERS, 'Content-Type': type, 'Cache-Control': 'no-store', ...extra });
    res.end(body);
  }
  const json = (res, status, obj) => send(res, status, typeof obj === 'string' ? obj : JSON.stringify(obj), 'application/json; charset=utf-8');

  const MIME = {
    '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8',
    '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8', '.png': 'image/png', '.svg': 'image/svg+xml',
    '.ico': 'image/x-icon', '.woff2': 'font/woff2', '.woff': 'font/woff', '.ttf': 'font/ttf', '.wasm': 'application/wasm',
    '.map': 'application/json; charset=utf-8', '.txt': 'text/plain; charset=utf-8', '.webp': 'image/webp', '.gif': 'image/gif', '.jpg': 'image/jpeg',
  };

  // Static files, only from web/client. Anything that resolves outside it is refused.
  function serveStatic(req, res, pathname) {
    let rel;
    if (pathname === '/' || pathname === '/index.html') rel = 'index.html';
    else if (pathname.startsWith('/client/')) rel = pathname.slice('/client/'.length);
    else return send(res, 404, 'Not found');
    try { rel = decodeURIComponent(rel); } catch { return send(res, 400, 'Bad path'); }
    if (!rel || rel.includes('\0') || rel.split(/[\\/]/).some((seg) => seg === '..' || seg.startsWith('.'))) return send(res, 403, 'Forbidden');
    const root = path.resolve(CLIENT_DIR);
    const file = path.resolve(root, rel);
    if (!file.startsWith(root + path.sep)) return send(res, 403, 'Forbidden');
    fs.realpath(file, (err, real) => {
      if (err) return send(res, 404, pathname === '/' ? 'The web client is missing (web/client/index.html).' : 'Not found');
      let realRoot = root;
      try { realRoot = fs.realpathSync(root); } catch {}
      if (!real.startsWith(realRoot + path.sep)) return send(res, 403, 'Forbidden');
      fs.stat(real, (err2, st) => {
        if (err2 || !st.isFile()) return send(res, 404, 'Not found');
        res.writeHead(200, { ...BASE_HEADERS, 'Content-Type': MIME[path.extname(real).toLowerCase()] || 'application/octet-stream', 'Content-Length': st.size, 'Cache-Control': 'no-cache' });
        if (req.method === 'HEAD') return res.end();
        fs.createReadStream(real).on('error', () => res.destroy()).pipe(res);
      });
    });
  }

  // Reads a small JSON body. Oversized bodies are drained (up to 1 MB, then
  // the connection is cut) so the client still gets its 413.
  function readBody(req) {
    return new Promise((resolve, reject) => {
      let tooBig = Number(req.headers['content-length'] || 0) > MAX_BODY;
      const chunks = [];
      let size = 0;
      req.on('data', (c) => {
        size += c.length;
        if (size > MAX_BODY) { tooBig = true; chunks.length = 0; }
        if (size > 1024 * 1024) { req.destroy(); return; }
        if (!tooBig) chunks.push(c);
      });
      req.on('end', () => {
        if (tooBig) return reject(new BadInput('Body too large', 413));
        try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8') || 'null')); } catch { reject(new BadInput('Body must be JSON')); }
      });
      req.on('error', reject);
    });
  }

  function openStream(req, res) {
    if (streams.size >= MAX_STREAMS) return send(res, 503, 'Too many open views');
    res.writeHead(200, { ...BASE_HEADERS, 'Content-Type': 'text/event-stream; charset=utf-8', 'Cache-Control': 'no-store', Connection: 'keep-alive', 'X-Accel-Buffering': 'no' });
    const s = { res, blocked: false };
    streams.add(s);
    lastStreamAt = Date.now();
    res.write('retry: 2000\n\n');
    try { pendingCount = L.pendingApprovals().length; const snap = snapshotJSON(); lastSnapKey = snap.key; res.write(`event: snapshot\ndata: ${snap.json}\n\n`); } catch {}
    if (lastBattle) res.write(`event: battle\ndata: ${lastBattle}\n\n`);
    const done = () => { streams.delete(s); lastStreamAt = Date.now(); };
    req.on('close', done);
    res.on('error', done);
  }

  async function handle(req, res) {
    const host = String(req.headers.host || '').toLowerCase();
    // DNS rebinding guard: only our own origin names.
    if (host !== `127.0.0.1:${port}` && host !== `localhost:${port}`) return send(res, 403, 'Forbidden');
    let u;
    try { u = new URL(req.url, `http://127.0.0.1:${port}`); } catch { return send(res, 400, 'Bad request'); }
    const p = u.pathname;
    if (p.startsWith('/api/')) {
      const t = u.searchParams.get('t') || req.headers['x-arcade-token'];
      if (!tokenOk(t)) return json(res, 403, { ok: false, message: 'Forbidden: missing or wrong session token' });
      if (p === '/api/assets' && req.method === 'GET') {
        const body = assets();
        if (req.headers['if-none-match'] === assetsTag) { res.writeHead(304, { ...BASE_HEADERS, ETag: assetsTag }); return res.end(); }
        return send(res, 200, body, 'application/json; charset=utf-8', { ETag: assetsTag, 'Cache-Control': 'private, no-cache' });
      }
      if (p === '/api/snapshot' && req.method === 'GET') { pendingCount = L.pendingApprovals().length; return json(res, 200, snapshotJSON().json); }
      if (p === '/api/stream' && req.method === 'GET') return openStream(req, res);
      if (p === '/api/action') {
        if (req.method !== 'POST') return send(res, 405, 'Use POST', undefined, { Allow: 'POST' });
        try {
          const body = await readBody(req);
          const out = act(body);
          const snap = snapshotJSON();
          lastSnapKey = snap.key;
          broadcast('snapshot', snap.json);
          return json(res, 200, `${JSON.stringify(out).slice(0, -1)},"snapshot":${snap.json}}`);
        } catch (e) {
          if (e instanceof BadInput) return json(res, e.status, { ok: false, message: e.message });
          log(`Claude Arcade web: action failed: ${e && e.stack || e}`);
          return json(res, 500, { ok: false, message: 'Something went wrong' });
        }
      }
      return json(res, 404, { ok: false, message: 'Not found' });
    }
    if (req.method !== 'GET' && req.method !== 'HEAD') return send(res, 405, 'Method not allowed');
    return serveStatic(req, res, p);
  }

  // ----- lifecycle -----

  const terminalWasOpen = L.gameAlive(); // the terminal pane's heartbeat, before ours
  enterGame();
  const server = http.createServer((q, s) => { handle(q, s).catch(() => { try { send(s, 500, 'Error'); } catch {} }); });
  server.keepAliveTimeout = 5000;
  const timers = [];
  let stopped = false;
  const idleMin = process.env.ARCADE_WEB_IDLE_MIN === undefined ? 30 : Number(process.env.ARCADE_WEB_IDLE_MIN);

  function stop() {
    if (stopped) return Promise.resolve();
    stopped = true;
    for (const t of timers) clearInterval(t);
    saveProgress();
    try { fs.unlinkSync(L.HEARTBEAT); } catch {}
    try { const l = L.readJSON(WEB_LOCK, null); if (l && l.pid === process.pid) fs.unlinkSync(WEB_LOCK); } catch {}
    for (const s of streams) { try { s.res.end(); } catch {} }
    streams.clear();
    return new Promise((resolve) => {
      server.close(() => resolve());
      if (server.closeAllConnections) server.closeAllConnections();
      setTimeout(resolve, 1000).unref();
    });
  }

  function listen(p, triesLeft) {
    return new Promise((resolve, reject) => {
      const onErr = (e) => {
        server.removeListener('listening', onOk);
        if (e.code === 'EADDRINUSE' && triesLeft > 1 && p !== 0) resolve(listen(p + 1, triesLeft - 1));
        else reject(e);
      };
      const onOk = () => { server.removeListener('error', onErr); resolve(server.address().port); };
      server.once('error', onErr);
      server.once('listening', onOk);
      server.listen(p, '127.0.0.1');
    });
  }

  const envPort = process.env.ARCADE_WEB_PORT;
  const first = opts.port !== undefined ? opts.port : envPort !== undefined && envPort !== '' && Number.isInteger(Number(envPort)) ? Number(envPort) : DEFAULT_PORT;

  return listen(first, PORT_TRIES).then((p) => {
    port = p;
    const url = `http://127.0.0.1:${port}/?t=${token}`;
    try { L.writeJSON(WEB_LOCK, { pid: process.pid, port, url, started: Date.now() }); } catch {}
    beat();
    timers.push(setInterval(() => { try { tick(); } catch {} }, Math.round(1000 / HZ)));
    timers.push(setInterval(beat, BEAT_MS));
    timers.push(setInterval(saveProgress, SAVE_MS));
    timers.push(setInterval(() => pushSnapshot(false), SNAPSHOT_CHECK_MS));
    timers.push(setInterval(() => { for (const s of streams) s.res.write(': keepalive\n\n'); }, KEEPALIVE_MS));
    if (idleMin > 0) timers.push(setInterval(() => { if (!streams.size && Date.now() - lastStreamAt > idleMin * 60000) { log('Claude Arcade web: no browser open for a while, stopping.'); stop().then(() => { if (opts.exitOnStop) process.exit(0); }); } }, 30000));
    if (opts.open !== false) openBrowser(url);
    return { url, port, token, terminalWasOpen, stop, server };
  });
}

// Run in the foreground: print the link, stop cleanly on Ctrl+C (or an IPC
// "shutdown" message from a parent process, which the tests use).
function main(opts = {}) {
  return start({ ...opts, exitOnStop: true }).then((s) => {
    if (s.already) {
      console.log(`Claude Arcade is already running in your browser: ${s.url}`);
      openBrowser(s.url);
      return s;
    }
    console.log(`Claude Arcade web view: ${s.url}`);
    if (s.terminalWasOpen) console.log('The terminal game pane is open too. The battle now runs here; the pane keeps its panels.');
    console.log('Press Ctrl+C to stop.');
    const quit = () => s.stop().then(() => process.exit(0));
    for (const sig of ['SIGINT', 'SIGTERM', 'SIGHUP', 'SIGBREAK']) { try { process.on(sig, quit); } catch {} }
    if (process.send) {
      process.on('message', (m) => { if (m && m.type === 'shutdown') quit(); });
      process.on('disconnect', quit);
    }
    s.server.on('close', () => setTimeout(() => process.exit(0), 50).unref());
    return s;
  }).catch((e) => {
    console.error(`Claude Arcade web view could not start: ${e && e.message}`);
    process.exitCode = 1;
  });
}

module.exports = { start, main, openBrowser, findScripts, DEFAULT_PORT, HZ, W, H };

if (require.main === module) main();
