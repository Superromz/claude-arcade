'use strict';
// Loot chests: a prize at the end of every wave and every quest (prompt).
//
//   lootTick(d)      once per frame: detects a cleared wave or a finished
//                    quest, rolls a chest whose tier depends on how hard it
//                    was, saves the rewards and queues the chest animation.
//   lootOverlay(...) draws the queued chest over a finished frame. Quest
//                    chests get the big centered show; wave chests a small
//                    popup in the scene's top-right corner.
//   lootKey(key)     any key fast-forwards, then closes, a quest chest.
//
// Chests give gold, crafting materials, cosmetics (duplicates convert into
// gold and materials) and battle buffs. Never XP: XP only comes from real
// Claude usage, which keeps the leaderboard fair.
//
// ARCADE_LOOT=tier[:wave|quest[:age]] forces a chest frozen at that age (in
// ticks) for snapshots, without touching any saved state.

const L = require('./lib');
const X = require('./pixel');
const I = require('./items');
const { ui, currentMode, SIDE } = require('./state');
const { layoutWord, parseLine, renderCells } = require('./celebrate');

const WHITE = [255, 255, 255], INK = [26, 18, 24];

// ---------- tiers ----------

// gold: [min, max] before level and kind scaling. gear: chance of each gear
// roll. rarity: gear rarity weights. mats: [min, max] material stacks rolled
// from matPool. buff: chance of a battle buff. jackpot: chance of an extra
// legendary item on top.
const TIERS = [
  { id: 'wooden', name: 'Wooden', title: [214, 150, 88], body: [150, 98, 52], dark: [92, 58, 30], trim: [118, 122, 136], trimHi: [188, 192, 206], lock: [200, 170, 90], glow: [255, 204, 130], planks: true,
    gold: [15, 35], gear: [0.1], rarity: { common: 85, rare: 15 }, mats: [1, 2], matPool: { slime: 5, bone: 5, ember: 1 }, buff: 0.15, jackpot: 0.004 },
  { id: 'iron', name: 'Iron', title: [196, 206, 222], body: [112, 120, 138], dark: [64, 70, 84], trim: [70, 74, 88], trimHi: [214, 220, 232], lock: [236, 240, 250], glow: [200, 230, 255],
    gold: [40, 80], gear: [0.25], rarity: { common: 55, rare: 38, epic: 7 }, mats: [2, 3], matPool: { slime: 4, bone: 4, ember: 3, moonsilver: 1 }, buff: 0.3, jackpot: 0.01 },
  { id: 'gold', name: 'Gold', title: [255, 210, 70], body: [226, 170, 40], dark: [150, 98, 20], trim: [120, 66, 20], trimHi: [255, 244, 170], lock: [255, 250, 220], glow: [255, 222, 110],
    gold: [90, 160], gear: [0.5], rarity: { common: 20, rare: 48, epic: 27, legendary: 5 }, mats: [2, 4], matPool: { slime: 2, bone: 3, ember: 4, moonsilver: 3, starlight: 1 }, buff: 0.5, jackpot: 0.02 },
  { id: 'epic', name: 'Epic', title: [206, 130, 255], body: [124, 64, 200], dark: [70, 30, 130], trim: [255, 206, 90], trimHi: [255, 246, 190], lock: [120, 240, 255], glow: [214, 150, 255],
    gear: [0.85, 0.25], gold: [180, 300], rarity: { rare: 30, epic: 52, legendary: 18 }, mats: [3, 5], matPool: { bone: 2, ember: 4, moonsilver: 4, starlight: 2 }, buff: 0.7, jackpot: 0.05 },
  { id: 'legendary', name: 'Legendary', title: [255, 164, 44], body: [236, 118, 30], dark: [150, 56, 20], trim: [255, 236, 150], trimHi: [255, 255, 230], lock: [110, 240, 255], glow: [255, 196, 90], rainbow: true,
    gear: [1, 0.6], gold: [350, 600], rarity: { epic: 40, legendary: 60 }, mats: [4, 6], matPool: { ember: 3, moonsilver: 4, starlight: 4 }, buff: 1, jackpot: 0.25, bonusMat: 'starlight' },
];
const TIER = Object.fromEntries(TIERS.map((t, i) => [t.id, { ...t, index: i }]));
const WAVE_STEPS = [0, 7, 13, 21, 32];
const QUEST_STEPS = [0, 5, 12, 22, 34];
const RAINBOW = [[255, 90, 90], [255, 170, 60], [255, 236, 90], [110, 230, 120], [90, 180, 255], [190, 120, 255]];

// ---------- difficulty ----------

// A cleared wave: wave number, elite waves (every 5th), bosses killed in it
// and hero level.
function waveScore({ wave = 1, bosses = 0, lvl = 1 } = {}) {
  return wave + (wave % 5 === 0 ? 5 : 0) + bosses * 12 + lvl * 0.3;
}

// A finished quest: tool calls, time on task, failures recovered from,
// token XP, agents launched, web trips and bosses killed during the turn.
function questScore(turn = {}, { end = Date.now(), bosses = 0, lvl = 1 } = {}) {
  const tools = Object.keys(L.TOOL_XP).reduce((n, k) => n + (Number(turn[k]) || 0), 0);
  const mins = turn.start ? Math.max(0, end - turn.start) / 60000 : 0;
  return Math.min(14, tools * 0.6) + Math.min(10, mins * 1.2) + Math.min(5, (turn.fails || 0) * 1.25)
    + Math.min(8, (turn.tokens || 0) / 15) + Math.min(6, (turn.summoning || 0) * 1.5) + Math.min(3, (turn.web || 0) * 0.5)
    + bosses * 10 + lvl * 0.15;
}

// Score -> { tier, q } where q (0-1) is how far into the tier the score is.
function tierFor(score, kind = 'quest') {
  const steps = kind === 'wave' ? WAVE_STEPS : QUEST_STEPS;
  let i = 0;
  while (i + 1 < steps.length && score >= steps[i + 1]) i++;
  if (kind === 'wave') i = Math.min(i, 3); // a wave alone tops out at Epic (an upgrade can still go Legendary)
  const next = steps[i + 1] ?? steps[i] + 12;
  return { tier: TIERS[i].id, q: Math.max(0, Math.min(1, (score - steps[i]) / (next - steps[i]))) };
}

// ---------- rolling ----------

function seeded(seed) { // mulberry32
  let a = seed >>> 0;
  return () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
const between = (rng, [a, b]) => a + Math.floor(rng() * (b - a + 1));
function weighted(rng, weights) {
  const keys = Object.keys(weights).filter((k) => weights[k] > 0);
  let r = rng() * keys.reduce((n, k) => n + weights[k], 0);
  for (const k of keys) { r -= weights[k]; if (r < 0) return k; }
  return keys[keys.length - 1];
}

const RARITY_ORDER = ['common', 'rare', 'epic', 'legendary'];
const DUPE_MATS = { common: ['bone', 2], rare: ['ember', 1], epic: ['moonsilver', 1], legendary: ['starlight', 2] };
const gearPool = () => I.CATALOG.filter((it) => it.slot !== 'buff');

function pickGear(rng, rarity, owned) {
  let pool = [];
  for (let k = 0; !pool.length && k < 4; k++) {
    const r = RARITY_ORDER[Math.max(0, RARITY_ORDER.indexOf(rarity) - k)];
    pool = gearPool().filter((it) => it.rarity === r);
  }
  // Things you don't own yet are twice as likely; chest-only pieces a bit more.
  const w = Object.fromEntries(pool.map((it) => [it.id, (owned.has(it.id) ? 1 : 2) * (it.loot ? 1.5 : 1)]));
  return weighted(rng, w);
}

// Roll a chest. opts: { kind: 'wave'|'quest', tier, q, lvl, owned: [ids],
// practice, wave }. Returns the reward; nothing is saved here.
function rollChest(opts = {}, rng = Math.random) {
  const kind = opts.kind === 'wave' ? 'wave' : 'quest';
  const practice = !!opts.practice;
  let tier = TIER[opts.tier] || TIER.wooden;
  const q = Math.max(0, Math.min(1, opts.q || 0));
  const lvl = Math.max(1, opts.lvl || 1);
  let upgraded = false, from = null;
  if (practice) tier = TIER.wooden;
  else if (tier.index < TIERS.length - 1 && rng() < 0.06 + 0.08 * q) { from = tier.id; tier = TIER[TIERS[tier.index + 1].id]; upgraded = true; }

  const r = { kind, tier: tier.id, upgraded, from, practice, wave: opts.wave || 0, gold: 0, mats: {}, items: [], dupes: [], buffs: [], legendary: false };
  const addMat = (id, n) => { if (n > 0) r.mats[id] = (r.mats[id] || 0) + n; };
  const lvlK = 1 + Math.min(30, lvl) * 0.02;

  if (practice) { // a small Wooden chest: a little gold, maybe one common material
    r.gold = Math.round(between(rng, [4, 10]) * lvlK);
    if (rng() < 0.35) addMat(rng() < 0.5 ? 'slime' : 'bone', 1);
    return finish(r);
  }
  const kindK = kind === 'wave' ? 0.5 : 1;
  const [g0, g1] = tier.gold;
  r.gold = Math.round((g0 + (g1 - g0) * Math.min(1, 0.6 * q + 0.4 * rng())) * lvlK * kindK);

  const stacks = Math.max(1, between(rng, tier.mats) - (kind === 'wave' ? 1 : 0));
  for (let i = 0; i < stacks; i++) addMat(weighted(rng, tier.matPool), 1 + (rng() < 0.35 ? 1 : 0));
  if (tier.bonusMat && kind === 'quest') addMat(tier.bonusMat, 1);

  const owned = new Set(opts.owned || []);
  const gearRolls = tier.gear.map((c) => c * (kind === 'wave' ? 0.5 : 1));
  const drops = [];
  for (const chance of gearRolls) if (rng() < chance) drops.push(pickGear(rng, weighted(rng, tier.rarity), owned));
  if (rng() < tier.jackpot * (kind === 'wave' ? 0.5 : 1)) { drops.push(pickGear(rng, 'legendary', owned)); r.legendary = true; }
  for (const id of drops) {
    const it = I.getItem(id);
    if (owned.has(id)) {
      const [m, n] = DUPE_MATS[it.rarity] || DUPE_MATS.common;
      const g = Math.round(it.price * 0.25);
      r.dupes.push({ id, gold: g, mat: m, n });
      r.gold += g; addMat(m, n);
    } else {
      owned.add(id);
      r.items.push(id);
      if (it.rarity === 'legendary') r.legendary = true;
    }
  }
  if (rng() < tier.buff * (kind === 'wave' ? 0.5 : 1)) {
    const w = { whetstone: 4, luckycharm: 3, wardrum: 2 };
    if (tier.index >= 2) Object.assign(w, { phoenixdraught: 1.5, midastonic: 1.5 });
    if (tier.index >= 4) w.duckoracle = 1;
    r.buffs.push(weighted(rng, w));
  }
  return finish(r);
}

// Display entries (one per line in the chest) and the quest-log text.
function finish(r) {
  const e = [];
  const rc = (id) => I.RARITY[(I.getItem(id) || {}).rarity || 'common'].color;
  for (const id of r.items) {
    const it = I.getItem(id);
    e.push({ glyph: '★', text: it.name, color: rc(id), suffix: ` ${I.RARITY[it.rarity].name}${it.set ? ` · ${it.set}` : ''}`, legendary: it.rarity === 'legendary' });
  }
  for (const b of r.buffs) { const it = I.getItem(b); e.push({ glyph: '+', text: it.name, color: [185, 135, 255], suffix: ` ${it.buff.waves} waves` }); }
  for (const dp of r.dupes) e.push({ glyph: '↺', text: `${I.getItem(dp.id).name}`, color: X.shade(rc(dp.id), 0.85), suffix: ` dupe → ${dp.gold}◉ +${dp.n} ${I.getMaterial(dp.mat).name}` });
  for (const [id, n] of Object.entries(r.mats)) { const m = I.getMaterial(id); e.push({ glyph: '◆', text: `${m.name} ×${n}`, color: m.color }); }
  if (r.gold) e.unshift({ glyph: '◉', text: `${r.gold} gold`, color: [255, 214, 80] });
  r.entries = e;
  const parts = [];
  if (r.gold) parts.push(`${r.gold} gold`);
  for (const [id, n] of Object.entries(r.mats)) parts.push(`${I.getMaterial(id).name} ×${n}`);
  for (const id of r.items) parts.push(`${I.getItem(id).name} (${(I.getItem(id).rarity)})`);
  for (const b of r.buffs) parts.push(I.getItem(b).name);
  const t = TIER[r.tier];
  const where = r.kind === 'wave' ? ` (${r.practice ? 'practice ' : ''}wave ${r.wave})` : '';
  r.text = `🎁 ${t.name} Chest${where}${r.upgraded ? ' (upgraded!)' : ''}: ${parts.join(', ') || 'dust and cobwebs'}!`;
  return r;
}

// ---------- saving ----------

// Gold goes to ui.battle.gold (game.js banks it); items and materials are
// written to state.game under the lock. Buffs start right away. New gear goes
// on straight away when that slot is empty. XP is never touched.
function applyReward(r, d = {}) {
  ui.battle.gold = (ui.battle.gold || 0) + (r.gold || 0);
  ui.dirty = true;
  L.withLock(() => {
    const st = L.loadState();
    const game = { ...(st.game || {}) };
    game.gold = ui.battle.gold;
    game.inventory = [...new Set([...(game.inventory || []), ...r.items])];
    const mats = { ...(game.materials || {}) };
    for (const [id, n] of Object.entries(r.mats)) mats[id] = (mats[id] || 0) + n;
    game.materials = mats;
    if (!r.practice) game.chests = { ...(game.chests || {}), [r.tier]: ((game.chests || {})[r.tier] || 0) + 1 };
    st.game = game;
    L.saveState(st);
    d.state = st;
  });
  for (const b of r.buffs) I.addBuff(b);
  if (d.hero && r.items.length) {
    const eq = { ...(d.hero.equipped || {}) };
    for (const id of r.items) {
      const it = I.getItem(id);
      if (eq[it.slot]) continue;
      try { require('./shop').equip(id, d); eq[it.slot] = id; } catch {}
    }
  }
  try { L.logEvent({ sid: d.sid, kind: 'quest', text: r.text }); } catch {}
  return r;
}

// ---------- detection ----------

const WAVE_TICKS = 26;
const loot = () => (ui.loot ||= { init: false, lastWave: 0, lastVictory: null, waveInfo: null, turnStart: null, turnBosses: 0, pending: null, queue: [], cur: null });
const snapshotMode = () => process.argv.includes('--snapshot');

function ownedIds() { try { return ((L.loadState().game || {}).inventory) || []; } catch { return []; } }

function award(opts, d) {
  const r = rollChest({ ...opts, lvl: d.lvl, owned: ownedIds() });
  applyReward(r, d);
  present(r);
  return r;
}

// Queue a chest animation. Quest chests jump the queue; wave popups pile up
// at most three deep (their rewards are already saved either way).
function present(r) {
  const lp = loot();
  if (r.kind === 'quest') { lp.queue = lp.queue.filter((x) => x.kind === 'quest'); lp.queue.push(r); if (lp.cur && lp.cur.kind === 'wave') lp.cur = null; }
  else { lp.queue.push(r); while (lp.queue.filter((x) => x.kind === 'wave').length > 3) lp.queue.splice(lp.queue.findIndex((x) => x.kind === 'wave'), 1); }
}

const celebrating = () => !!(ui.levelUp || (ui.celebrate && ui.celebrate.kind));

function lootTick(d) {
  const lp = loot();
  if (process.env.ARCADE_LOOT || snapshotMode() || !d) return;
  const b = ui.battle, ses = d.ses || {}, turn = ses.turn || null;
  const vkey = `${d.sid || ''}:${ses.since || 0}`;
  if (!lp.init) { // never reward what was already on screen when the game opened
    Object.assign(lp, { init: true, lastWave: b.wave || 0, lastVictory: ses.since || null, lastVictoryKey: vkey, turnStart: turn && turn.start });
  }
  if (turn && turn.start !== lp.turnStart) { lp.turnStart = turn.start; lp.turnBosses = 0; }
  for (const m of b.monsters || []) {
    if (!m.boss || m.hp > 0 || m._loot) continue;
    m._loot = true;
    lp.turnBosses++;
    if (lp.waveInfo) lp.waveInfo.bosses++;
  }

  // Waves: remember each wave while it's alive (and whether it was a
  // practice wave, since that flag clears the moment it falls).
  if (!b.wave) { lp.lastWave = 0; lp.waveInfo = null; }
  else if ((b.monsters || []).some((m) => m.hp > 0)) {
    if (!lp.waveInfo || lp.waveInfo.wave !== b.wave) lp.waveInfo = { wave: b.wave, practice: !!b.practice, bosses: 0 };
    else if (b.practice) lp.waveInfo.practice = true;
  } else if (lp.lastWave !== b.wave && lp.waveInfo && lp.waveInfo.wave === b.wave) {
    lp.lastWave = b.wave;
    const w = lp.waveInfo;
    const { tier, q } = tierFor(waveScore({ wave: w.wave, bosses: w.bosses, lvl: d.lvl }), 'wave');
    award({ kind: 'wave', tier, q, wave: w.wave, practice: w.practice }, d);
  }

  // Quests: a new victory. Wait for a boss finisher and any banner first so
  // the chest has the stage (and counts the boss), but never more than ~5 s.
  if (currentMode(ses) === 'victory' && vkey !== lp.lastVictoryKey) {
    lp.lastVictoryKey = vkey; lp.lastVictory = ses.since;
    lp.pending = { t0: ui.tick, end: ses.since || Date.now(), turn: { ...(turn || {}) } };
  }
  if (lp.pending && ((!b.finisher && !celebrating()) || ui.tick - lp.pending.t0 > 50)) {
    const p = lp.pending;
    lp.pending = null;
    const { tier, q } = tierFor(questScore(p.turn, { end: p.end, bosses: lp.turnBosses, lvl: d.lvl }), 'quest');
    lp.turnBosses = 0;
    award({ kind: 'quest', tier, q }, d);
  }
}

// ---------- presentation timing ----------

const burstAt = (r) => (r.kind === 'wave' ? 7 : 12);
const entryAt = (r, i) => (r.kind === 'wave' ? 9 + i * 2 : burstAt(r) + 4 + i * 2);
const revealAt = (r) => entryAt(r, Math.min(r.entries.length, r.kind === 'wave' ? 3 : 7));
const duration = (r) => (r.kind === 'wave' ? Math.max(WAVE_TICKS, revealAt(r) + 12) : Math.max(40, revealAt(r) + 16));

function current() {
  const lp = loot();
  const forced = process.env.ARCADE_LOOT;
  if (forced) {
    const [tier, kind = 'quest', a] = forced.split(':');
    lp.forced ||= sample(TIER[tier] ? tier : 'gold', kind);
    return { r: lp.forced, age: a === undefined ? revealAt(lp.forced) + 2 : Number(a) || 0 };
  }
  if (lp.cur && ui.tick - lp.cur.t0 >= duration(lp.cur)) lp.cur = null;
  if (!lp.cur && lp.queue.length) { lp.cur = lp.queue.shift(); lp.cur.t0 = ui.tick; }
  return lp.cur ? { r: lp.cur, age: ui.tick - lp.cur.t0 } : null;
}

// A fixed, good-looking chest for snapshots and previews.
function sample(tier, kind = 'quest') {
  const idx = TIER[tier].index;
  const r = rollChest({ kind, tier, q: 0.7, lvl: 8, wave: kind === 'wave' ? 5 : 0 }, seeded(7 + idx));
  const upgrades = TIER[tier].index > 0 && kind === 'quest';
  const picks = { wooden: [], iron: ['slimecrown'], gold: ['flamecrown'], epic: ['bonewings', 'wember'], legendary: ['phoenixwings', 'starsprite'] }[tier];
  r.items = [...new Set([...(kind === 'quest' ? picks : picks.slice(0, 1)), ...r.items])].slice(0, 2);
  r.legendary = r.items.some((id) => I.getItem(id).rarity === 'legendary');
  r.tier = tier; r.upgraded = upgrades && tier === 'gold'; r.from = r.upgraded ? 'iron' : null;
  return finish(r);
}

// Returns true while a quest chest is up: the first key reveals everything,
// the next one closes it. Wave popups don't take keys (combat keeps going).
function lootKey() {
  const lp = loot();
  if (!lp.cur || lp.cur.kind !== 'quest') return false;
  const age = ui.tick - lp.cur.t0, rev = revealAt(lp.cur);
  if (age < rev) lp.cur.t0 = ui.tick - rev;
  else lp.cur = null;
  return true;
}

// ---------- pixel surface over a band of frame rows ----------

function surface(lines, W, r0, r1) {
  const rows = [];
  for (let r = r0; r < r1; r++) rows.push(parseLine(lines[r], W));
  const H = rows.length * 2;
  const S = {
    W, H, rows,
    get: (x, y) => { const c = rows[y >> 1][x]; return (y & 1) ? c.bot : c.top; },
    set(x, y, col) {
      x = Math.round(x); y = Math.round(y);
      if (x < 0 || x >= W || y < 0 || y >= H || !col) return;
      const c = rows[y >> 1][x];
      if (c.text || c.cont) { c.dirty = true; c.text = false; }
      if (y & 1) c.bot = col; else c.top = col;
    },
    blend(x, y, col, a) {
      x = Math.round(x); y = Math.round(y);
      if (x < 0 || x >= W || y < 0 || y >= H || a <= 0) return;
      S.set(x, y, X.mix(S.get(x, y), col, Math.min(1, a)));
    },
    glow(cx, cy, r, col, s) {
      for (let y = Math.max(0, Math.floor(cy - r)); y < Math.min(H, cy + r); y++) {
        for (let x = Math.max(0, Math.floor(cx - r)); x < Math.min(W, cx + r); x++) {
          const k = Math.hypot(x - cx, y - cy) / r;
          if (k < 1) S.blend(x, y, col, s * (1 - k) * (1 - k));
        }
      }
    },
    // Darken every pixel (text too) toward `tint` by k.
    dim(y0, y1, x0, x1, k, tint) {
      for (let y = Math.max(0, y0); y < Math.min(H, y1); y++) for (let x = Math.max(0, x0); x < Math.min(W, x1); x++) {
        const c = rows[y >> 1][x];
        if (y & 1) c.bot = X.mix(c.bot, tint, k); else { c.top = X.mix(c.top, tint, k); if (c.text) c.f = X.mix(c.f, tint, k); }
      }
    },
    label(col, row, text, color, bold = false, alpha = 1) {
      if (row < 0 || row >= rows.length) return col;
      for (const ch of text) {
        if (col >= W) break;
        if (col >= 0 && L.visWidth(ch) === 1) {
          const cell = rows[row][col];
          cell.label = ch; cell.lf = X.mix(X.mix(cell.top, cell.bot, 0.5), color, alpha); cell.lbold = !!bold;
          cell.text = false; cell.dirty = true;
        }
        col++;
      }
      return col;
    },
    render(lines0, r0) { const out = lines0.slice(); rows.forEach((cells, i) => { out[r0 + i] = renderCells(cells); }); return out; },
  };
  return S;
}

// ---------- drawing pieces ----------

const chestHeight = (w) => Math.max(5, Math.round(w * 0.42)) + Math.max(4, Math.round(w * 0.3));
const ease = (k) => 1 - (1 - Math.max(0, Math.min(1, k))) ** 3;
const hsh = (a, b) => X.hash(a * 7 + 3, b * 13 + 11);

function tierLook(tier, t) {
  const T = TIER[tier] || TIER.wooden;
  if (!T.rainbow) return T;
  const k = (t * 0.15) % RAINBOW.length, i = Math.floor(k);
  const shimmer = X.mix(RAINBOW[i], RAINBOW[(i + 1) % RAINBOW.length], k - i);
  return { ...T, trim: X.mix(T.trim, shimmer, 0.35), title: X.mix(T.title, shimmer, 0.25) };
}

// A treasure chest, centered on cx with its bottom edge at baseY.
// lift: how far the lid has flown open (px). flash: 0-1 white-out.
function drawChest(S, cx, baseY, w, T, { lift = 0, shake = 0, flash = 0, glow = 0, t = 0 } = {}) {
  const x0 = Math.round(cx - w / 2 + shake), x1 = x0 + w - 1;
  const hb = Math.max(5, Math.round(w * 0.42)), hl = Math.max(4, Math.round(w * 0.3));
  const top = baseY - hb;
  const f = (c) => (flash > 0 ? X.mix(c, WHITE, flash) : c);
  const band = (x) => { const a = x - x0, b = x1 - x; return w >= 16 ? a === 2 || a === 3 || b === 2 || b === 3 : a === 2 || b === 2; };
  const mid = Math.round(cx + shake);
  const open = lift > 1;

  if (glow > 0) S.glow(mid, top - 1, w * 1.1, T.glow, 0.55 * glow);
  // Light pouring out between the lid and the base.
  if (open) {
    for (let y = top - lift - 1; y <= top; y++) for (let x = x0 + 1; x < x1; x++) {
      const k = (y - (top - lift - 1)) / (lift + 1);
      S.blend(x, y, X.mix(T.glow, WHITE, 0.5 + 0.5 * k), 0.55 + 0.4 * k);
    }
  }
  // Base.
  for (let y = top; y < baseY; y++) for (let x = x0; x <= x1; x++) {
    const ly = y - top;
    let c;
    if (x === x0 || x === x1 || y === baseY - 1) c = INK;
    else if (ly <= 1) c = ly === 0 ? T.trimHi : T.trim;
    else if (band(x)) c = ly % 3 === 0 ? T.trimHi : T.trim;
    else {
      c = X.mix(T.body, T.dark, ((ly - 2) / Math.max(1, hb - 3)) * 0.65);
      if (T.planks && (ly - 2) % 3 === 2) c = X.shade(c, 0.72);
      if (!T.planks && x === x0 + 1) c = X.mix(c, WHITE, 0.2);
    }
    S.set(x, y, f(c));
  }
  // Lock plate and keyhole.
  for (let j = 0; j < 5; j++) for (let i = -2; i <= 1; i++) S.set(mid + i, top + j, f(i === -2 || i === 1 || j === 4 ? INK : T.lock));
  S.set(mid - 1, top + 1, INK); S.set(mid, top + 1, INK); S.set(mid, top + 2, INK);
  // Treasure peeking over the rim once open.
  if (open) {
    for (let x = x0 + 2; x < x1 - 1; x++) {
      const hgt = 1 + Math.round(hsh(x, 3) * 2);
      for (let j = 0; j < hgt; j++) {
        const gem = hsh(x, j + 9) > 0.86;
        const col = gem ? (T.rainbow ? RAINBOW[(x + j) % 6] : T.glow) : ((x + j) % 2 ? [255, 214, 80] : [255, 240, 170]);
        S.set(x, top - 1 - j, f(col));
      }
      if (hsh(x, t >> 1) > 0.9) S.set(x, top - 2 - Math.round(hsh(x, 3) * 2), WHITE);
    }
  }
  // Lid: closed it sits on the base; open it hangs above, showing its dark inside.
  const ly0 = top - hl - lift;
  for (let j = 0; j < hl; j++) {
    const inset = j === 0 ? 2 : j === 1 ? 1 : 0;
    for (let x = x0 + inset; x <= x1 - inset; x++) {
      const y = ly0 + j;
      let c;
      if (x === x0 + inset || x === x1 - inset || j === 0 || j === hl - 1) c = INK;
      else if (j === hl - 2) c = T.trim;
      else if (band(x)) c = j === 1 ? T.trimHi : T.trim;
      else if (open) c = X.mix(T.dark, INK, 0.35 + 0.3 * (j / hl));
      else c = j === 1 ? X.mix(T.body, WHITE, 0.35) : X.mix(T.body, T.dark, (j / hl) * 0.4);
      S.set(x, y, f(c));
    }
  }
  return { top, lidTop: ly0, x0, x1 };
}

// Light rays turning around (cx, cy).
function drawRays(S, cx, cy, R, colors, alpha, rot, n = 12) {
  if (alpha <= 0) return;
  for (let y = Math.max(0, Math.floor(cy - R)); y < Math.min(S.H, cy + R); y++) {
    for (let x = Math.max(0, Math.floor(cx - R * 1.4)); x < Math.min(S.W, cx + R * 1.4); x++) {
      const dx = (x - cx) / 1.4, dy = y - cy, d = Math.hypot(dx, dy);
      if (d > R || d < 3) continue;
      const a = Math.atan2(dy, dx) - rot;
      const v = 0.5 + 0.5 * Math.cos(n * a);
      if (v < 0.55) continue;
      const k = ((v - 0.55) / 0.45) * (1 - d / R) * alpha * (dy > 2 ? 0.45 : 1);
      const idx = ((Math.round((a / (2 * Math.PI)) * n) % colors.length) + colors.length) % colors.length;
      S.blend(x, y, colors[idx], Math.min(0.85, k * 1.3));
    }
  }
}

// Coins, gems and sparks thrown out when the lid bursts. Pure function of age.
function drawBurst(S, cx, cy, tau, T, n, spread) {
  if (tau < 0) return;
  for (let i = 0; i < n; i++) {
    const a = -Math.PI / 2 + (hsh(i, 1) - 0.5) * spread;
    const v = 1.6 + hsh(i, 2) * 2.6, life = 10 + Math.floor(hsh(i, 3) * 10);
    if (tau > life) continue;
    const x = cx + Math.cos(a) * v * tau * 1.6, y = cy + Math.sin(a) * v * tau + 0.16 * tau * tau;
    const kind = i % 3;
    const col = kind === 0 ? [255, 214, 80] : kind === 1 ? (T.rainbow ? RAINBOW[i % 6] : T.glow) : WHITE;
    const fade = tau > life - 4 ? (life - tau) / 4 : 1;
    S.blend(x, y, col, fade);
    if (kind === 0 && (tau + i) % 4 < 2) S.blend(x + 1, y, X.shade(col, 0.75), fade);
  }
}

// Block-letter title. Returns rows used.
function drawTitle(S, word, cx, y0, scale, T, age, alpha) {
  const lay = layoutWord(word);
  const x0 = Math.round(cx - (lay.w * scale) / 2);
  const outline = X.shade(T.dark, 0.35);
  const sheen = ((age * 4) % (lay.w * scale + 50)) - 25;
  lay.glyphs.forEach((g, gi) => {
    const ta = age - gi * 0.5;
    if (ta < 0) return;
    const drop = ta < 3 ? -Math.round((3 - ta) * scale * 2) : 0;
    const oy = y0 + drop;
    const on = (gx, gy) => gy >= 0 && gy < 5 && gx >= 0 && gx < g.rows[0].length && g.rows[gy][gx] === '#';
    for (let gy = -1; gy <= 5; gy++) for (let gx = -1; gx <= g.rows[0].length; gx++) {
      if (on(gx, gy) || !(on(gx - 1, gy) || on(gx + 1, gy) || on(gx, gy - 1) || on(gx, gy + 1) || on(gx - 1, gy - 1))) continue;
      for (let sy = 0; sy < scale; sy++) for (let sx = 0; sx < scale; sx++) S.blend(x0 + (g.x + gx) * scale + sx, oy + gy * scale + sy, outline, alpha * 0.9);
    }
    for (let gy = 0; gy < 5; gy++) for (let gx = 0; gx < g.rows[0].length; gx++) {
      if (!on(gx, gy)) continue;
      for (let sy = 0; sy < scale; sy++) for (let sx = 0; sx < scale; sx++) {
        const x = x0 + (g.x + gx) * scale + sx, y = oy + gy * scale + sy;
        const v = (gy * scale + sy) / (5 * scale - 1);
        const base = T.rainbow ? RAINBOW[Math.floor((x - x0) / 3 + age * 0.5) % 6] : T.title;
        let col = v < 0.3 ? X.mix(WHITE, base, v / 0.3) : X.mix(base, X.shade(base, 0.6), (v - 0.3) / 0.7);
        const sd = Math.abs((x - x0) - (y - y0) * 0.7 - sheen);
        if (sd < 3) col = X.mix(col, WHITE, 0.7 * (1 - sd / 3));
        S.blend(x, y, col, alpha);
      }
    }
  });
}

function sparkles(S, n, age, cols, alpha, box) {
  const [bx0, by0, bx1, by1] = box;
  for (let k = 0; k < n; k++) {
    const cyc = Math.floor((age + k * 3) / 5), ph = (age + k * 3) % 5;
    const x = Math.floor(bx0 + hsh(k, cyc) * (bx1 - bx0)), y = Math.floor(by0 + hsh(cyc, k + 99) * (by1 - by0));
    const col = cols[k % cols.length], a = alpha * [0.6, 1, 1, 0.7, 0.3][ph];
    S.blend(x, y, col, a);
    if (ph >= 1 && ph <= 3) for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) S.blend(x + dx, y + dy, col, a * 0.6);
  }
}

function entryWidth(e) { return 2 + L.visWidth(e.text) + L.visWidth(e.suffix || ''); }

// Draw one reward line; `pop` (0-1) flashes it white as it lands.
function drawEntry(S, col, row, e, alpha, pop, maxW, t) {
  let c = e.color;
  if (e.legendary) c = RAINBOW[(t >> 1) % 6];
  const hot = (x) => (pop > 0 ? X.mix(x, WHITE, pop) : x);
  const text = L.visWidth(e.text) + 2 > maxW ? e.text.slice(0, Math.max(1, maxW - 3)) + '…' : e.text;
  let x = S.label(col, row, `${e.glyph} `, hot(c), true, alpha);
  x = S.label(x, row, text, hot(c), true, alpha);
  const room = col + maxW - x;
  if (e.suffix && room > 2) {
    const suf = L.visWidth(e.suffix) > room ? e.suffix.slice(0, room - 1) + '…' : e.suffix;
    x = S.label(x, row, suf, [150, 140, 170], false, alpha);
  }
  if (e.legendary && x + 12 <= col + maxW && (t >> 2) % 2) S.label(x, row, ' LEGENDARY!', hot([255, 236, 140]), true, alpha);
}

// ---------- quest chest (big, centered) ----------

function drawQuest(lines, W, H, r, age, pal) {
  const dur = duration(r), B = burstAt(r);
  const top0 = 3, bot0 = Math.max(top0, H - 2);
  const avail = bot0 - top0;
  const T0 = tierLook(r.tier, age), Tfrom = r.upgraded ? tierLook(r.from, age) : T0;
  const T = r.upgraded && age < 10 ? Tfrom : T0;
  const n = Math.min(r.entries.length, 7), more = r.entries.length - n;
  const wantW = Math.min(44, Math.max(18, ...r.entries.slice(0, n).map(entryWidth)));

  // Pick the biggest layout that fits: chest size, title scale, list beside
  // or below the chest, and the full or short title.
  let layout = null;
  for (const cw of [...(W >= 140 && avail >= 34 ? [40] : []), 30, 24, 18, 14]) {
    for (const scale of [2, 1]) {
      for (const word of [`${T0.name.toUpperCase()} CHEST`, `${T0.name.toUpperCase()}!`]) {
        if (layoutWord(word).w * scale + 6 > W) continue;
        const titleRows = Math.ceil((5 * scale + 1) / 2);
        const chestPx = chestHeight(cw) + (cw >= 18 ? 12 : 9); // base + lid + room to open
        const listW = Math.min(wantW, W - cw - 12);
        const side = listW >= 20;
        const lw2 = side ? listW : Math.min(wantW, W - 4);
        const bodyRows = side ? Math.max(Math.ceil(chestPx / 2), n + (more ? 1 : 0) + 1) : Math.ceil(chestPx / 2) + n + (more ? 1 : 0);
        const core = 1 + titleRows + 1 + bodyRows + 1;
        if (core <= avail && (scale === 1 || avail - core >= 4)) { layout = { cw, scale, word, titleRows, side, listW: lw2, chestPx, bodyRows, core }; break; }
      }
      if (layout) break;
    }
    if (layout) break;
  }
  if (!layout) return drawCompact(lines, W, H, r, age, pal);

  const { cw, scale, word, titleRows, side, listW, chestPx, bodyRows, core } = layout;
  const coreTop = top0 + Math.max(0, Math.floor((avail - core) / 2));
  const S = surface(lines, W, top0, bot0);
  const cy0 = (coreTop - top0) * 2; // core top in surface pixels
  const open = Math.min(1, (age + 1) / 4);
  const alpha = Math.max(0, Math.min(1, (dur - age) / 6)) * open;

  // 1) dim the whole stage, the core more.
  const tint = X.mix(pal.panel, [0, 0, 0], 0.6);
  S.dim(0, S.H, 0, W, 0.55 * alpha, tint);
  S.dim(cy0, cy0 + core * 2, 0, W, 0.5 * alpha, tint);

  // Geometry.
  const groupW = side ? cw + 6 + listW : Math.max(cw, listW);
  const gx0 = Math.floor((W - groupW) / 2);
  const chestCx = side ? gx0 + cw / 2 : W / 2;
  const bodyY0 = cy0 + (1 + titleRows + 1) * 2;
  const baseY = bodyY0 + chestPx - 1;
  const listCol = side ? gx0 + cw + 6 : Math.floor((W - listW) / 2);
  const listRow0 = side ? Math.floor(bodyY0 / 2) + Math.max(0, Math.floor((bodyRows - n - (more ? 1 : 0)) / 2)) : Math.ceil((baseY + 2) / 2);

  // 2) rays and glow once the lid bursts.
  const tau = age - B;
  const lidTopGuess = baseY - Math.round(cw * 0.42) - 2;
  if (tau >= 0) {
    const R = Math.min(chestPx * 1.6, 8 + tau * 6);
    const cols = T.rainbow ? RAINBOW : [T.glow, X.mix(T.glow, WHITE, 0.5), T.title];
    drawRays(S, chestCx, lidTopGuess, R, cols, alpha * Math.max(0.35, 1 - tau / 30), age * 0.06, T.index >= 3 ? 16 : 12);
    S.glow(chestCx, lidTopGuess, cw * 1.2, T.glow, 0.45 * alpha);
  }

  // 3) the chest: drops in, shakes, bursts open.
  const drop = age < 4 ? -Math.round((1 - ease(age / 4)) * 24) : age === 4 ? 1 : 0;
  const shaking = age >= 5 && age < B;
  const shake = shaking ? Math.round(Math.sin(age * 2.7) * (1 + (age - 5) / 3)) : 0;
  const liftSeq = [3, 7, 10, 9, 8];
  const lift = tau < 0 ? 0 : liftSeq[Math.min(liftSeq.length - 1, tau)];
  let flash = tau >= 0 && tau < 3 ? 0.85 * (1 - tau / 3) : 0;
  if (r.upgraded && age >= 8 && age < 11) flash = Math.max(flash, [0.35, 0.75, 0.4][age - 8]);
  const seamGlow = shaking ? (age - 5) / (B - 5) : tau >= 0 ? 1 : 0;
  const Tc = r.upgraded && age >= 10 ? T0 : T;
  const g = drawChest(S, chestCx, baseY + drop, cw, Tc, { lift, shake, flash: flash * alpha, glow: seamGlow * alpha, t: age });
  if (shaking) { // light leaks through the seam
    for (let x = g.x0 + 1; x < g.x1; x++) if (hsh(x, age) < 0.25 + seamGlow * 0.5) S.blend(x, g.top - 1, X.mix(Tc.glow, WHITE, 0.4), 0.8 * alpha);
  }
  if (age === 4 || age === 5) for (let k = 0; k < 6; k++) S.blend(chestCx + (k - 2.5) * (cw / 4) + (age - 4) * (k < 3 ? -2 : 2), baseY + 1, [150, 140, 130], 0.6 * alpha);
  drawBurst(S, chestCx, g.top - 3, tau, Tc, T0.index >= 3 ? 40 : 26, Math.PI * 1.1);

  // 4) title and the upgrade call-out.
  if (age >= 2) drawTitle(S, word, W / 2, cy0 + 2, scale, T0, age - 2, alpha);
  if (r.upgraded && age >= 9 && age < B + 12) {
    const txt = `▲ UPGRADED from ${TIER[r.from].name}! ▲`;
    S.label(Math.floor((W - L.visWidth(txt)) / 2), coreTop - top0 + 1 + titleRows, txt, (age >> 1) % 2 ? WHITE : T0.title, true, alpha);
  }

  // 5) rewards pop out one by one: an orb arcs from the chest to its line.
  const mouthX = chestCx, mouthY = g.top - 4;
  for (let i = 0; i < n; i++) {
    const e = r.entries[i], at = entryAt(r, i), row = listRow0 + i;
    const ex = listCol, ey = row * 2 + 1;
    const k = (age - (at - 3)) / 3;
    if (k >= 0 && k < 1) {
      const x = mouthX + (ex - mouthX) * ease(k), y = mouthY + (ey - mouthY) * k - Math.sin(k * Math.PI) * 10;
      const c = e.legendary ? RAINBOW[age % 6] : e.color;
      S.glow(x, y, 4, c, 0.6 * alpha);
      S.blend(x, y, WHITE, alpha); S.blend(x + 1, y, c, alpha); S.blend(x, y + 1, c, alpha); S.blend(x + 1, y + 1, c, alpha);
    }
    if (age >= at) {
      if (e.legendary) S.glow(listCol + listW / 2, ey, listW * 0.6, [255, 190, 80], 0.25 * alpha);
      drawEntry(S, listCol, row, e, alpha, Math.max(0, 1 - (age - at) / 3), Math.min(listW + 12, W - listCol - 1), age);
    }
  }
  if (more && age >= revealAt(r)) S.label(listCol, listRow0 + n, `  …and ${more} more (see the quest log)`, [150, 140, 170], false, alpha);

  // 6) sparkles and the hint.
  if (tau >= 0) sparkles(S, Math.max(10, Math.floor(W / 6)), age, T.rainbow ? RAINBOW : [T.glow, WHITE, [255, 214, 80]], alpha, [0, cy0, W, cy0 + core * 2]);
  if (age >= revealAt(r)) {
    const hint = 'press any key';
    S.label(Math.floor((W - hint.length) / 2), coreTop - top0 + core - 1, hint, [150, 140, 170], false, alpha * (0.6 + 0.4 * Math.sin(age * 0.4)));
  }
  return S.render(lines, top0);
}

// Tiny frames: a one-line banner.
function drawCompact(lines, W, H, r, age, pal) {
  if (H < 4) return lines;
  const T = tierLook(r.tier, age);
  const row = Math.max(0, Math.min(lines.length - 1, Math.floor(H / 2)));
  const S = surface(lines, W, row, row + 1);
  const alpha = Math.max(0, Math.min(1, (duration(r) - age) / 6)) * Math.min(1, (age + 1) / 3);
  S.dim(0, 2, 0, W, 0.85 * alpha, X.mix(pal.panel, [0, 0, 0], 0.6));
  const x = S.label(1, 0, `■ ${T.name.toUpperCase()} CHEST · `, T.title, true, alpha);
  S.label(x, 0, r.entries.map((e) => e.text).join(', ').slice(0, Math.max(0, W - x - 1)), [232, 226, 242], false, alpha);
  return S.render(lines, row);
}

// ---------- wave chest (corner popup) ----------

function drawWave(lines, W, H, r, age, pal) {
  const dur = duration(r), B = burstAt(r);
  const bw = Math.min(40, W - 4), bh = 8;
  const top = 3;
  if (bw < 26 || top + bh > H - 2) return lines;
  const right = W >= 130 ? W - SIDE - 1 : W - 1; // stay over the scene when the side panel shows
  const slideIn = ease(age / 4), slideOut = age > dur - 4 ? ease((age - (dur - 4)) / 4) : 0;
  const off = Math.round((1 - slideIn + slideOut) * (bw + 2));
  const bx = right - bw + off;
  const T = tierLook(r.tier, age);
  const S = surface(lines, W, top, top + bh);
  const alpha = 1;
  // Box: dark glass with a tier-colored frame.
  const inside = X.mix(pal.panel, [0, 0, 0], 0.45);
  for (let y = 0; y < S.H; y++) for (let x = bx; x < bx + bw; x++) {
    if (x < 0 || x >= W) continue;
    const edge = y === 0 || y === S.H - 1 || x === bx || x === bx + bw - 1;
    const corner = (y === 0 || y === S.H - 1) && (x === bx || x === bx + bw - 1);
    if (corner) continue;
    S.blend(x, y, edge ? X.mix(T.title, WHITE, age >= B && age < B + 3 ? 0.6 : 0) : inside, edge ? 1 : 0.88);
  }
  const cx = bx + 8, baseY = S.H - 2;
  const tau = age - B;
  if (tau >= 0) S.glow(cx, baseY - 8, 12, T.glow, 0.5 * Math.max(0.4, 1 - tau / 12));
  const shaking = age >= 3 && age < B;
  const lift = tau < 0 ? 0 : [2, 4, 3][Math.min(2, tau)];
  const g = drawChest(S, cx, baseY, 14, T, { lift, shake: shaking ? Math.round(Math.sin(age * 2.7)) : 0, flash: tau >= 0 && tau < 3 ? 1 - tau / 3 : 0, glow: tau >= 0 ? 0.8 : shaking ? 0.4 : 0, t: age });
  drawBurst(S, cx, g.top - 2, tau, T, 12, Math.PI * 0.9);
  // Text column.
  const tx = bx + 17, tw = bw - 19;
  if (tx < W) {
    const title = `${T.name.toUpperCase()} CHEST${r.upgraded ? ' ▲' : ''}`;
    S.label(tx, 1, title.slice(0, tw), T.rainbow ? RAINBOW[(age >> 1) % 6] : T.title, true, alpha);
    S.label(tx, 2, (r.practice ? `Practice wave ${r.wave}` : r.wave % 5 === 0 ? `Elite wave ${r.wave}!` : `Wave ${r.wave} cleared!`).slice(0, tw), [150, 140, 170], false, alpha);
    const n = Math.min(3, r.entries.length);
    for (let i = 0; i < n; i++) if (age >= entryAt(r, i)) drawEntry(S, tx, 3 + i, { ...r.entries[i], suffix: '' }, alpha, Math.max(0, 1 - (age - entryAt(r, i)) / 3), tw, age);
    if (r.entries.length > 3 && age >= revealAt(r)) S.label(tx, 6, `+${r.entries.length - 3} more`.slice(0, tw), [150, 140, 170], false, alpha);
  }
  return S.render(lines, top);
}

// ---------- entry point ----------

function lootOverlay(lines, d, pal, W, H) {
  if (!Array.isArray(lines) || !lines.length) return lines;
  const cur = current();
  if (!cur) return lines;
  const h = Math.min(H || lines.length, lines.length);
  try {
    const out = cur.r.kind === 'wave' ? drawWave(lines, W, h, cur.r, cur.age, pal) : drawQuest(lines, W, h, cur.r, cur.age, pal);
    // Only rows we redrew are checked: they must come out exactly W wide.
    return out.every((l, i) => l === lines[i] || L.visWidth(l) === W) ? out : lines;
  } catch { return lines; }
}

module.exports = {
  TIERS, waveScore, questScore, tierFor, rollChest, applyReward, lootTick, lootOverlay, lootKey,
  present, sample, seeded, duration, revealAt,
};
