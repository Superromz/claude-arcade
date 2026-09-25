#!/usr/bin/env node
// Claude Arcade game pane: your hero battles waves of monsters while Claude
// works. Every tool call is a spell; higher levels unlock stronger spells.
//
//   node game.js                       play (follows the latest session)
//   node game.js --snapshot [tab]      print one frame and exit
//   node game.js --snapshot create     print the character creator
//
// Keys: 1-5 / space cast spells · click monsters to strike · w summon a wave
//       tab or ←→ views · c hero · t theme · p session · q quit
'use strict';

const L = require('./lib');
const M = require('./messages');
const X = require('./pixel');
const C = require('./character');
const SP = require('./sprites');

const ESC = '\x1b[';
const RESET = `${ESC}0m`, BOLD = `${ESC}1m`, NOBOLD = `${ESC}22m`;
const fg = ([r, g, b]) => `${ESC}38;2;${r};${g};${b}m`;
const bg = ([r, g, b]) => `${ESC}48;2;${r};${g};${b}m`;

const UI = {
  rpg: { panel: [24, 20, 34], panel2: [36, 30, 50], accent: [255, 176, 60], text: [232, 226, 242], dim: [128, 118, 150], good: [120, 220, 120], bad: [255, 92, 92], magic: [185, 135, 255], gold: [255, 214, 80], ink: [24, 20, 34] },
  space: { panel: [10, 14, 30], panel2: [20, 28, 52], accent: [80, 200, 255], text: [226, 236, 255], dim: [110, 130, 170], good: [90, 240, 190], bad: [255, 80, 130], magic: [200, 120, 255], gold: [255, 230, 110], ink: [10, 14, 30] },
  retro: { panel: [6, 18, 6], panel2: [12, 34, 12], accent: [90, 255, 90], text: [140, 255, 140], dim: [50, 140, 50], good: [90, 255, 90], bad: [200, 255, 120], magic: [120, 255, 160], gold: [200, 255, 100], ink: [6, 18, 6] },
};
const TABS = ['Adventure', 'Hero', 'Party', 'Trophies'];
const SIDE = 46;

const ui = {
  screen: 'game', tab: 0, pin: null, cheerUntil: 0, tick: 0, prev: [],
  particles: [], floaters: [], dust: [],
  battle: { monsters: [], shots: [], bolts: [], coins: [], wave: 0, kills: 0, gold: 0, lastEventT: Date.now(), lastVictory: 0, shake: 0, flash: 0, practice: false },
  cooldowns: {}, layout: null, dirty: false, lastSave: 0, heroX: 0, heroY: 0,
  create: { field: 0, ch: null },
};

// ---------- text helpers ----------

function truncVis(s, w) {
  if (w <= 0) return '';
  if (L.visWidth(s) <= w) return s;
  let out = '';
  for (const ch of s) { if (L.visWidth(out + ch) > w - 1) break; out += ch; }
  return out + '…';
}

function panelLine(width, panel, parts, right = []) {
  const render = (ps) => ps.map(([t, c, b]) => `${b ? BOLD : ''}${fg(c)}${t}${b ? NOBOLD : ''}`).join('');
  const plain = (ps) => ps.map((p) => p[0]).join('');
  const rw = L.visWidth(plain(right));
  let left = parts, lw = L.visWidth(plain(parts));
  if (lw + rw > width) {
    const room = Math.max(0, width - rw);
    left = []; let used = 0;
    for (const [t, c, b] of parts) {
      if (used >= room) break;
      const s = truncVis(t, room - used); left.push([s, c, b]); used += L.visWidth(s);
    }
    lw = used;
  }
  return `${bg(panel)}${render(left)}${' '.repeat(Math.max(0, width - lw - rw))}${render(right)}${RESET}`;
}

function gradBar(ratio, width, c1, c2, track) {
  const r = Math.max(0, Math.min(1, ratio)) * width;
  const full = Math.floor(r), part = Math.floor((r - full) * 8);
  let s = '';
  for (let i = 0; i < width; i++) {
    const c = X.mix(c1, c2, width > 1 ? i / (width - 1) : 0);
    if (i < full) s += `${fg(c)}█`;
    else if (i === full && part > 0) s += `${fg(c)}${bg(track)}${' ▏▎▍▌▋▊▉'[part]}`;
    else s += `${fg(track)}█`;
  }
  return s;
}
const barPart = (ratio, width, c1, c2, pal, panel) => `${gradBar(ratio, width, c1, c2, X.mix(panel, pal.text, 0.14))}${bg(panel)}`;

// ---------- data ----------

function snapshotData() {
  const cfg = L.loadConfig();
  const state = L.loadState();
  const sessions = Object.entries(state.sessions).sort((a, b) => (b[1].since || 0) - (a[1].since || 0));
  const sid = ui.pin && state.sessions[ui.pin] ? ui.pin : sessions[0] && sessions[0][0];
  const ses = (sid && state.sessions[sid]) || { mode: 'idle', since: Date.now(), hp: 100, combo: 0, party: {} };
  const events = L.readEvents(150).filter((e) => !sid || !e.sid || e.sid === sid);
  const hero = C.getCharacter(cfg) || C.defaultCharacter();
  const lvl = L.levelFor(state.xp);
  const stats = C.stats(state, C.getCharacter(cfg));
  return { cfg, state, sessions, sid, ses, events, hero, lvl, stats };
}

function currentMode(ses) {
  const age = (Date.now() - (ses.since || 0)) / 1000;
  let mode = ses.mode || 'idle';
  if (mode === 'victory' && age > 8) mode = 'idle';
  if (mode === 'hurt' && age > 3) mode = 'thinking';
  if (!['idle', 'victory', 'waiting'].includes(mode) && age > 1800) mode = 'idle';
  return mode;
}
const isBusy = (mode) => !['idle', 'victory', 'waiting', 'cheer'].includes(mode);

// ---------- particles & floaters ----------

function emit(n, x, y, colors, { spread = 1.2, up = 2, grav = 0.12, life = 18 } = {}) {
  for (let i = 0; i < n; i++) ui.particles.push({ x, y, vx: (Math.random() - 0.5) * spread * 2, vy: -Math.random() * up, g: grav, life: life * (0.6 + Math.random() * 0.6), c: colors[i % colors.length] });
  if (ui.particles.length > 500) ui.particles.splice(0, ui.particles.length - 500);
}
function floater(x, y, text, color, bold = false) { ui.floaters.push({ x, y, text, color, bold, life: 18 }); }

// ---------- battle ----------

function spawnWave(W, floorY, lvl) {
  const b = ui.battle;
  b.wave += 1;
  const boss = b.wave % 5 === 0;
  const types = lvl < 3 ? ['slime', 'bat'] : lvl < 6 ? ['slime', 'bat', 'goblin'] : ['slime', 'bat', 'goblin', 'skeleton'];
  const n = boss ? 1 : Math.min(6, 2 + Math.floor(b.wave / 2));
  const scale = 1 + (b.wave - 1) * 0.12;
  for (let i = 0; i < n; i++) {
    const type = boss ? 'boss' : types[(b.wave + i * 7) % types.length];
    const def = SP.MONSTERS[type];
    const [, h] = SP.monsterSize({ type, boss });
    const hp = Math.round(def.hp * scale);
    const y = def.fly ? floorY - 26 - (i % 2) * 6 : floorY - h;
    b.monsters.push({ type, boss, lvl: Math.max(1, lvl + Math.floor(b.wave / 3) - 1), xp: Math.round(def.xp * scale), hp, max: hp, color: b.wave + i, seed: i, x: W - 8 + i * 14, slot: i, y, baseY: y, flash: 0, frozen: 0, lunge: 0 });
  }
}

function hitMonster(m, dmg, color) {
  if (m.hp <= 0) return;
  const crit = Math.random() < 0.15;
  if (crit) dmg = Math.round(dmg * 1.8);
  m.hp -= dmg; m.flash = 3;
  const [w] = SP.monsterSize(m);
  floater(m.x + w / 2 - 2 + (Math.random() - 0.5) * 6, m.y - 6, crit ? `CRIT -${dmg}!` : `-${dmg}`, crit ? [255, 150, 40] : color || [255, 240, 150], true);
  if (m.hp <= 0) {
    ui.battle.kills += 1;
    ui.dirty = true;
    const value = m.boss ? 25 : 1 + (m.max >> 3);
    for (let i = 0; i < Math.min(8, value); i++) ui.battle.coins.push({ x: m.x + 4, y: m.y, vx: (Math.random() - 0.5) * 2, vy: -1.5 - Math.random() * 1.5, v: i === 0 ? value - Math.min(8, value) + 1 : 1, age: 0 });
    const [mw, mh] = SP.monsterSize(m);
    if (!ui.battle.practice) { ui.xpPending = (ui.xpPending || 0) + m.xp; ui.battle.waveXp = (ui.battle.waveXp || 0) + m.xp; }
    floater(m.x + mw / 2 - 3, m.y - 12, ui.battle.practice ? `+${1 + (m.max >> 3)}◉` : `+${m.xp} XP`, [255, 214, 80], true);
    emit(m.boss ? 40 : 14, m.x + mw / 2, m.y + mh / 2, [[255, 214, 80], [255, 255, 255], [255, 150, 60]], { spread: 1.6, up: 2.6 });
    if (m.boss) { ui.battle.shake = 8; floater(m.x, m.y - 8, 'BOSS DOWN!', [255, 214, 80]); }
  }
}

let sceneW = 200;
const aliveMonsters = () => ui.battle.monsters.filter((m) => m.hp > 0 && m.x < sceneW - 12);

// Player-cast spell from the hotbar (slot 0 = basic attack).
const COOLDOWN = { basic: 6, fireball: 30, frost: 30, chain: 50, meteor: 90, starfall: 150 };
function playerCast(d, slot) {
  const spell = C.SPELLS[slot];
  if (!spell || spell.lvl > d.lvl) return floater(ui.heroX, ui.heroY - 4, spell ? `Lv ${spell.lvl}` : '', [180, 170, 200]);
  if ((ui.cooldowns[spell.id] || 0) > ui.tick) return;
  if (!aliveMonsters().length) return floater(ui.heroX, ui.heroY - 4, 'no target — press w', [180, 170, 200]);
  ui.cooldowns[spell.id] = ui.tick + COOLDOWN[spell.id];
  cast(d, null, [ui.heroX + 15, ui.heroY + 6], UI[d.cfg.theme] || UI.rpg, spell, 1.5);
}

// Cast the spell matching the current tool activity.
function cast(d, mode, origin, pal, forced, boost = 1) {
  const targets = aliveMonsters().sort((a, b) => a.x - b.x);
  if (!targets.length) return;
  const spell = forced || C.spellFor(d.lvl, mode, ui.tick + ui.battle.kills);
  const stat = d.stats[C.CLASSES[d.hero.cls].stat] || 10;
  const dmg = Math.round(C.damage(spell, d.lvl, stat) * boost);
  const target = targets[0];
  const [ox, oy] = origin;
  if (spell.id === 'chain') {
    let from = [ox, oy];
    for (const m of targets.slice(0, spell.chain)) {
      const to = [m.x + 4, m.y + 4];
      ui.battle.bolts.push({ from, to, life: 5 });
      hitMonster(m, dmg, [180, 220, 255]);
      from = to;
    }
    return;
  }
  if (spell.id === 'starfall') {
    for (const m of targets) ui.battle.shots.push({ x: m.x + Math.random() * 6 - 10, y: -4, spell, dmg, target: m, speed: 2.2, color: [255, 240, 180] });
    return;
  }
  const basicColor = { mage: [255, 230, 110], ranger: [200, 150, 90], knight: [235, 240, 255], warlock: [160, 70, 220], bard: [255, 160, 210], rogue: [200, 205, 220] }[d.hero.cls];
  const color = { basic: basicColor, fireball: [255, 140, 40], frost: [140, 230, 255], meteor: [255, 110, 40] }[spell.id] || pal.magic;
  const start = spell.id === 'meteor' ? [target.x - 30, -6] : [ox, oy];
  ui.battle.shots.push({ x: start[0], y: start[1], spell, dmg, target, speed: spell.id === 'meteor' ? 1.8 : spell.id === 'fireball' ? 1.6 : 2.4, color, cls: d.hero.cls });
}

function stepBattle(d, pc, floorY, heroX, origin, pal, mode) {
  const b = ui.battle, W = pc.w, t = ui.tick;
  sceneW = W;
  const busy = isBusy(mode);

  // New tool events trigger spells; failures let a monster land a hit.
  const fresh = d.events.filter((e) => e.t > b.lastEventT);
  if (fresh.length) b.lastEventT = fresh[fresh.length - 1].t;
  for (const e of fresh) {
    if (e.kind === 'action') cast(d, e.mode || 'thinking', origin, pal);
    if (e.kind === 'hurt') { b.shake = 5; const m = aliveMonsters()[0]; if (m) m.lunge = 8; }
  }
  // Auto-attack while Claude works; faster at higher levels.
  const every = Math.max(6, Math.round(24 - d.lvl * 1.2));
  if (busy && t % every === 0) cast(d, mode, origin, pal);
  // Companions chip in.
  Object.values(d.ses.party || {}).slice(0, 4).forEach((p, i) => {
    const target = aliveMonsters()[0];
    if (busy && target && (t + i * 7) % 28 === 0) {
      const col = (X.CLASS_COLORS[p.cls] || X.CLASS_COLORS.Mage).H;
      b.shots.push({ x: heroX - 12 * (i + 1) + 8, y: floorY - 9, spell: { id: 'ally' }, dmg: Math.max(2, Math.round(d.lvl * 0.8)), target, speed: 2, color: col });
    }
  });

  // Waves: spawn while busy, wipe out on victory, retreat when idle.
  if (b.wave && !b.monsters.some((m) => m.hp > 0) && b.waveXp) {
    L.logEvent({ sid: d.sid, kind: 'combo', text: `Wave ${b.wave} cleared! +${b.waveXp} XP` });
    b.waveXp = 0;
  }
  if (busy && !aliveMonsters().length && !b.monsters.some((m) => m.hp > 0) && t % 20 === 0) spawnWave(W, floorY, d.lvl);
  if (mode === 'victory' && d.ses.since !== b.lastVictory) {
    b.lastVictory = d.ses.since;
    if (aliveMonsters().length) { b.flash = 4; b.shake = 6; for (const m of aliveMonsters()) hitMonster(m, m.hp, [255, 214, 80]); }
    b.wave = 0;
  }
  if (!busy && mode !== 'victory' && !b.practice) b.monsters.forEach((m) => { m.x += 0.8; });
  if (b.practice && !b.monsters.some((m) => m.hp > 0)) b.practice = false;

  for (const m of b.monsters) {
    const def = SP.MONSTERS[m.type];
    const stop = heroX + 22 + m.slot * 13;
    if ((busy || b.practice) && m.x > stop) m.x -= def.speed * 1.7 * (m.frozen > 0 ? 0.3 : 1);
    if (def.fly) m.y = m.baseY + Math.sin((t + m.seed * 5) * 0.25) * 3;
    if (m.lunge > 0) { m.x -= m.lunge > 4 ? 2 : -2; m.lunge--; }
    else if (busy && m.x <= stop + 1 && (t + m.seed * 9) % 40 === 0) m.lunge = 8;
    if (m.flash > 0) m.flash--;
    if (m.frozen > 0) m.frozen--;
  }
  b.monsters = b.monsters.filter((m) => m.hp > 0 && m.x < W + 60);
  // Coins fly to the hero and are banked.
  b.coins = b.coins.filter((c) => {
    const dx = ui.heroX + 8 - c.x, dy = ui.heroY + 10 - c.y, dist = Math.hypot(dx, dy);
    c.age++;
    if (c.age > 12 && dist < 3) { b.gold += c.v; ui.dirty = true; return false; }
    if (c.age <= 12) { c.x += c.vx; c.y += c.vy; c.vy += 0.2; if (c.y > floorY - 2) { c.y = floorY - 2; c.vy *= -0.5; } }
    else { c.x += dx / dist * 2.5; c.y += dy / dist * 2.5; }
    pc.set(c.x, c.y, (t + c.age) % 4 < 2 ? [255, 220, 90] : [255, 250, 190]);
    return true;
  });

  // Projectiles home in on their target.
  b.shots = b.shots.filter((s) => {
    const tgt = s.target.hp > 0 ? s.target : aliveMonsters()[0];
    if (!tgt) return false;
    s.target = tgt;
    const [tw, th] = SP.monsterSize(tgt);
    const tx = tgt.x + tw / 2, ty = tgt.y + th / 2;
    const dx = tx - s.x, dy = ty - s.y, dist = Math.hypot(dx, dy);
    if (dist < 3) {
      if (s.spell.aoe) {
        for (const m of aliveMonsters()) if (Math.abs(m.x - tgt.x) < s.spell.aoe) hitMonster(m, s.dmg, s.color);
        emit(s.spell.id === 'meteor' ? 30 : 16, tx, ty, [s.color, [255, 230, 120], [255, 255, 255]], { spread: 2, up: 2.4 });
        if (s.spell.id === 'meteor') b.shake = 6;
      } else {
        hitMonster(tgt, s.dmg, s.color);
        if (s.spell.id === 'frost') tgt.frozen = 40;
        emit(5, tx, ty, [s.color, [255, 255, 255]], { spread: 1, up: 1.2 });
      }
      return false;
    }
    s.x += (dx / dist) * s.speed; s.y += (dy / dist) * s.speed;
    return true;
  });
}

function drawShots(pc) {
  for (const s of ui.battle.shots) {
    const x = Math.round(s.x), y = Math.round(s.y), id = s.spell.id;
    if (id === 'basic' && s.cls === 'ranger') { for (let i = 0; i < 5; i++) pc.set(x - i, y, i === 0 ? [220, 220, 230] : s.color); continue; }
    if (id === 'basic' && s.cls === 'knight') { for (let j = -2; j <= 2; j++) pc.set(x - Math.abs(j), y + j, s.color); pc.glow(x, y, 4, s.color, 0.3); continue; }
    if (id === 'basic' && s.cls === 'bard') { pc.label(Math.floor(x), Math.floor(y / 2), '♪', s.color); continue; }
    const r = id === 'meteor' ? 2 : id === 'fireball' ? 1.5 : 1;
    for (let j = -r; j <= r; j++) for (let i = -r; i <= r; i++) if (i * i + j * j <= r * r + 0.5) pc.set(x + i, y + j, X.mix(s.color, [255, 255, 255], 0.3));
    for (let k = 1; k < (id === 'meteor' ? 8 : 4); k++) pc.set(x - k * (id === 'meteor' ? 0.7 : 1), y - (id === 'meteor' ? k : 0), X.shade(s.color, 1 - k * 0.12));
    pc.glow(x, y, id === 'meteor' ? 10 : 5, s.color, 0.4);
  }
  for (const bo of ui.battle.bolts) {
    const [x1, y1] = bo.from, [x2, y2] = bo.to;
    const n = Math.max(1, Math.ceil(Math.hypot(x2 - x1, y2 - y1)));
    let jitter = 0;
    for (let i = 0; i <= n; i++) {
      if (i % 3 === 0) jitter = Math.round((Math.random() - 0.5) * 4);
      pc.set(x1 + (x2 - x1) * i / n, y1 + (y2 - y1) * i / n + jitter, i % 2 ? [255, 255, 255] : [150, 210, 255]);
    }
    pc.glow(x2, y2, 6, [150, 210, 255], 0.5);
    bo.life--;
  }
  ui.battle.bolts = ui.battle.bolts.filter((bo) => bo.life > 0);
}

// ---------- scene ----------

function drawBackground(pc, th, floorY, scroll, t) {
  const W = pc.w, H = pc.h;
  if (th === 'space') {
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      let c = X.mix([5, 5, 18], [28, 12, 52], y / H);
      const s1 = X.hash(x + Math.floor(t * 0.2), y), s2 = X.hash(x + Math.floor(t * 0.6) + 999, y);
      if (s1 > 0.994) c = X.mix(c, [255, 255, 255], 0.5 + 0.4 * Math.sin(t * 0.3 + x));
      else if (s2 > 0.99) c = X.mix(c, [140, 160, 255], 0.55);
      pc.px[y * W + x] = c;
    }
    pc.glow(W * 0.6, H * 0.35, H * 0.8, [120, 40, 170], 0.3);
    pc.glow(W * 0.25, H * 0.2, H * 0.5, [30, 90, 170], 0.22);
    const px = W * 0.84, py = H * 0.26, pr = Math.max(5, H * 0.13);
    for (let y = -pr; y < pr; y++) for (let x = -pr; x < pr; x++) {
      if (Math.hypot(x, y) < pr) pc.set(px + x, py + y, X.shade(X.mix([240, 160, 90], [190, 90, 60], (y + pr) / (2 * pr)), 0.4 + 0.7 * Math.max(0, (-x - y) / (pr * 1.5) + 0.45)));
    }
    for (let a = 0; a < 200; a++) { const ang = a / 200 * 6.283; const rx = Math.cos(ang) * pr * 1.8, ry = Math.sin(ang) * pr * 0.35; if (ry > 0 || Math.hypot(rx, ry * 3) > pr) pc.set(px + rx, py + ry, [220, 200, 170]); }
    const sx = (t * 5) % (W * 3) - W, sy = (t * 2) % (H * 3) - H;
    if (sx > 0 && sx < W && sy > 0 && sy < floorY) for (let k = 0; k < 8; k++) pc.set(sx - k * 2.5, sy - k, X.shade([255, 255, 255], 1 - k * 0.12));
    for (let y = floorY; y < H; y++) for (let x = 0; x < W; x++) {
      let c = X.shade([64, 70, 92], 1 - (y - floorY) / (H - floorY + 1) * 0.55);
      if (y === floorY) c = [140, 150, 180];
      if ((x + scroll) % 24 === 0) c = X.shade(c, 0.7);
      if (y === floorY + 2 && (x + scroll) % 12 < 6) c = X.mix([0, 210, 255], c, 0.25 + 0.3 * Math.sin(t * 0.4 + x * 0.05));
      pc.px[y * W + x] = c;
    }
    return;
  }
  for (let y = 0; y < floorY; y++) {
    const row = y >> 2, off = row % 2 ? 6 : 0;
    for (let x = 0; x < W; x++) {
      const bx = Math.floor((x + off + scroll) / 12);
      const mortar = y % 4 === 3 || (x + off + scroll) % 12 === 0;
      const base = mortar ? [30, 26, 40] : X.shade([56, 48, 70], 0.78 + 0.36 * X.hash(bx, row));
      pc.px[y * W + x] = X.shade(base, 0.5 + 0.5 * (y / floorY));
    }
  }
  // Arched alcoves and pillars.
  const archW = 56, top = Math.floor(floorY * 0.18);
  for (let ax = -((scroll >> 1) % archW) - archW; ax < W + archW; ax += archW) {
    const cx = ax + 28, rr = 14;
    for (let y = top; y < floorY; y++) for (let x = Math.max(0, ax + 14); x < Math.min(W, ax + 42); x++) {
      if (y > top + rr || Math.hypot(x - cx, y - (top + rr)) < rr) pc.px[y * W + x] = X.shade(pc.px[y * W + x], 0.45);
    }
    for (let y = top; y < floorY; y++) for (let x = ax + 8; x <= ax + 12; x++) if (x >= 0 && x < W) pc.px[y * W + x] = X.shade([80, 70, 96], 0.6 + 0.12 * (x - ax - 8) + 0.3 * (y / floorY));
  }
  for (let y = floorY; y < H; y++) for (let x = 0; x < W; x++) {
    const tx = Math.floor((x + scroll) / 10), ty = Math.floor((y - floorY) / 3);
    let c = X.shade([84, 70, 62], (0.75 + 0.3 * X.hash(tx, ty + 99)) * (1 - (y - floorY) / (H - floorY + 1) * 0.6));
    if (y === floorY) c = [132, 110, 92];
    if ((x + scroll) % 10 === 0 && y > floorY) c = X.shade(c, 0.75);
    pc.px[y * W + x] = c;
  }
  const ty = Math.max(2, Math.floor(floorY * 0.35));
  const flick = 0.85 + 0.15 * Math.sin(t * 0.9) * Math.sin(t * 0.37);
  for (let x = -((scroll >> 1) % archW) - archW + 10; x < W + 10; x += archW) {
    pc.glow(x + 1, ty, 22, [255, 150, 60], 0.45 * flick);
    pc.sprite(x, ty, X.TORCH[(t + x) >> 2 & 1], X.BASE);
  }
  if (ui.dust.length < W / 6) ui.dust.push({ x: Math.random() * W, y: Math.random() * floorY, v: 0.05 + Math.random() * 0.1 });
  for (const p of ui.dust) {
    p.x += p.v; p.y += Math.sin((t + p.x) * 0.05) * 0.05;
    if (p.x >= W) p.x = 0;
    if (p.y >= 0 && p.y < floorY) pc.set(p.x, p.y, X.mix(pc.get(p.x | 0, p.y | 0) || [0, 0, 0], [255, 220, 170], 0.35));
  }
}

function drawScene(pc, d, pal) {
  const t = ui.tick, th = d.cfg.theme, W = pc.w, H = pc.h;
  const floorY = H - Math.max(5, Math.floor(H * 0.18));
  const mode = currentMode(d.ses);
  const partyN = Math.min(4, Object.keys(d.ses.party || {}).length);
  const heroX = Math.max(Math.floor(W * 0.2), 12 * partyN + 4);
  const heroY = floorY - 24 - (mode === 'idle' && (t >> 3) % 2 ? 1 : 0);

  drawBackground(pc, th, floorY, Math.floor(t * (isBusy(mode) ? 0.15 : 0)), t);

  if (mode === 'idle') {
    const fx = heroX + 22;
    pc.glow(fx + 4, floorY - 3, 28, [255, 140, 50], 0.4 + 0.08 * Math.sin(t * 0.7));
    pc.sprite(fx, floorY - 6, X.FIRE[(t >> 2) % 3], X.BASE);
    if (t % 3 === 0) emit(1, fx + 4, floorY - 6, [[255, 200, 90], [255, 120, 40]], { spread: 0.3, up: 0.8, grav: -0.02, life: 14 });
    pc.label(heroX + 6 + ((t >> 3) % 3), Math.max(0, Math.floor((heroY - 4 - ((t >> 2) % 4)) / 2)), (t >> 4) % 2 ? 'z' : 'Z', pal.dim);
  }

  Object.values(d.ses.party || {}).slice(0, 4).forEach((p, i) => {
    const colors = X.CLASS_COLORS[p.cls] || X.CLASS_COLORS.Mage;
    const fresh = Math.min(1, (Date.now() - (p.since || 0)) / 1500);
    SP.drawCompanion(pc, colors, heroX - 12 * (i + 1), floorY - 13 - ((t + i * 3) >> 2 & 1), { alpha: fresh, t: t + i * 2 });
  });

  let pose = 'stand', tint = null;
  if (mode === 'victory' || mode === 'cheer' || mode === 'summoning') pose = 'cheer';
  else if (mode === 'hurt') { pose = 'hurt'; if ((t >> 1) % 2) tint = [[255, 60, 60], 0.55]; }
  else if (isBusy(mode) && (t >> 2) % 6 === 0) pose = 'cheer';
  const jump = (mode === 'victory' || mode === 'cheer') && (t >> 2) % 2 ? 2 : 0;
  const origin = [heroX + 15, heroY + 6];
  ui.heroX = heroX; ui.heroY = heroY;
  SP.drawHero(pc, d.hero, heroX, heroY - jump, { pose, t, tint, action: isBusy(mode) });

  if (mode === 'summoning') {
    const cx = heroX + 30, cy = floorY - 1;
    pc.glow(cx, cy - 4, 18, pal.magic, 0.45);
    for (let a = 0; a < 24; a++) { const ang = a / 24 * 6.28 + t * 0.15; pc.set(cx + Math.cos(ang) * 9, cy + Math.sin(ang) * 2, a % 2 ? pal.magic : [255, 255, 255]); }
  }
  if (mode === 'thinking' && !aliveMonsters().length) {
    const bx = heroX + 26, by = Math.max(5, heroY - 4);
    for (let y = -4; y <= 4; y++) for (let x = -7; x <= 7; x++) if ((x * x) / 49 + (y * y) / 16 <= 1) pc.set(bx + x, by + y, [236, 236, 246]);
    pc.rect(heroX + 17, heroY + 1, 2, 2, [236, 236, 246]); pc.rect(heroX + 20, heroY - 1, 2, 2, [236, 236, 246]);
    pc.label(bx - 1, Math.floor(by / 2), ['?', '…', '!', '✦'][(t >> 3) % 4], pal.ink);
  }
  if (mode === 'waiting' && (t >> 3) % 2) pc.label(heroX + 7, Math.max(0, Math.floor((heroY - 5) / 2)), '!', pal.accent);
  if (mode === 'victory') {
    const cx = heroX + 26;
    pc.sprite(cx, floorY - 8, X.CHEST.open, X.BASE);
    pc.glow(cx + 6, floorY - 6, 18, [255, 210, 80], 0.45);
    if (t % 2 === 0) emit(3, cx + 6, floorY - 7, [[255, 214, 80], [255, 240, 150], [255, 170, 40]], { spread: 0.9, up: 3 });
    if (t % 2 === 0) emit(2, Math.random() * W, 0, [pal.gold, pal.magic, pal.good, pal.bad, pal.accent], { spread: 0.4, up: -0.3, grav: 0.05, life: 50 });
  }

  stepBattle(d, pc, floorY, heroX, origin, pal, mode);
  const front = aliveMonsters().sort((a, b) => a.x - b.x)[0];
  for (const m of ui.battle.monsters) SP.drawMonster(pc, m, t, { target: m === front });
  if (front) {
    const def = SP.MONSTERS[front.type];
    const tag = `${def.name} Lv${front.lvl} · ${Math.max(0, front.hp)}/${front.max} HP · ${ui.battle.practice ? 'practice' : `${front.xp} XP`}`;
    const [fw] = SP.monsterSize(front);
    pc.label(Math.max(0, Math.min(W - tag.length - 1, Math.round(front.x + fw / 2 - tag.length / 2))), Math.max(1, Math.floor((front.y - (front.boss ? 11 : 8)) / 2)), tag, [255, 236, 200], true);
  }
  drawShots(pc);

  ui.particles = ui.particles.filter((p) => (p.life -= 1) > 0);
  for (const p of ui.particles) {
    p.x += p.vx; p.y += p.vy; p.vy += p.g;
    if (p.y > floorY - 1) { p.y = floorY - 1; p.vy *= -0.4; p.vx *= 0.7; }
    pc.set(p.x, p.y, p.c);
  }
  ui.floaters = ui.floaters.filter((f) => (f.life -= 1) > 0);
  for (const f of ui.floaters) { f.y -= 0.5; pc.label(Math.floor(f.x), Math.max(0, Math.floor(f.y / 2)), f.text, f.color, f.bold); }

  if (ui.battle.flash > 0) { ui.battle.flash--; pc.px = pc.px.map((c) => X.mix(c, [255, 250, 230], 0.5)); }
  pc.px = pc.px.map((c, i) => { const v = ((i % W) / W - 0.5) * 2; return X.shade(c, 1 - 0.28 * v * v); });
  if (th === 'retro') pc.map((c) => { const l = (c[0] * 0.3 + c[1] * 0.59 + c[2] * 0.11) / 255; const q = Math.round(l * 5) / 5; return [10 + q * 40, 20 + q * 235, 10 + q * 60].map(X.clamp); });
  pc.label(1, 0, ` ${ui.battle.practice ? 'PRACTICE ' : ''}WAVE ${ui.battle.wave} · ${ui.battle.kills} slain · ◉ ${ui.battle.gold} gold `, pal.gold);
}

// Render at a logical resolution sized so the hero is ~40% of the scene height.
function sceneLines(cols, rows, d, pal) {
  const S = Math.max(1, Math.min(4, Math.round((rows * 2) / 62)));
  const lc = Math.ceil(cols / S), lr = Math.ceil(rows / S);
  const small = new X.PixelCanvas(lc, lr);
  drawScene(small, d, pal);
  ui.sceneScale = S;
  let lines;
  if (S === 1) lines = small.lines();
  else {
    const big = new X.PixelCanvas(cols, rows);
    for (let y = 0; y < big.h; y++) for (let x = 0; x < cols; x++) big.px[y * cols + x] = small.px[Math.floor(y / S) * lc + Math.floor(x / S)];
    for (const [k, v] of small.text) { const [c, r] = k.split(',').map(Number); if (c * S < cols) big.text.set(`${c * S},${Math.min(rows - 1, Math.floor(r * S + S / 2))}`, v); }
    lines = big.lines();
  }
  if (ui.battle.shake > 0) { ui.battle.shake--; if (ui.battle.shake % 2) lines = lines.slice(1).concat(lines[0]); }
  return lines;
}

// ---------- panels ----------

const ICONS = { quest: '★', level: '▲', achievement: '✦', hurt: '✖', faint: '✝', summon: '✧', return: '↩', combo: '≫', prompt: '▸', welcome: '◆', waiting: '!', compact: '☾', action: '·' };
function eventColor(kind, pal) {
  return { quest: pal.gold, level: pal.gold, achievement: pal.gold, hurt: pal.bad, faint: pal.bad, summon: pal.magic, return: pal.magic, combo: pal.accent, prompt: pal.accent, welcome: pal.good, waiting: pal.accent }[kind] || pal.dim;
}
function collapse(events) {
  const out = [];
  for (const e of events) {
    const last = out[out.length - 1];
    if (last && e.kind === 'action' && last.kind === 'action' && last.text === e.text) { last.n++; last.t = e.t; continue; }
    out.push({ ...e, n: 1 });
  }
  return out;
}
const stripIcon = (s) => s.replace(/^[\p{Extended_Pictographic}️‍ ]+/u, '');

function questLog(d, pal, W, h, compact = false) {
  const last = d.events[d.events.length - 1];
  const rows = collapse(d.events.filter((e) => !compact || e.kind !== 'action' || e === last)).slice(-h).map((e, i, arr) => {
    const time = new Date(e.t).toTimeString().slice(0, 5);
    const text = stripIcon(e.text) + (e.n > 1 ? ` ×${e.n}` : '');
    const isLast = i === arr.length - 1;
    return panelLine(W, isLast ? pal.panel2 : pal.panel, [[compact ? ' ' : `  ${time} `, pal.dim], [`${ICONS[e.kind] || '·'} `, eventColor(e.kind, pal), true], [text, e.kind === 'action' ? (isLast ? pal.text : pal.dim) : eventColor(e.kind, pal), e.kind !== 'action']]);
  });
  while (rows.length < h) rows.unshift(panelLine(W, pal.panel, []));
  return rows;
}

function fmtNum(n) { return n >= 1e6 ? `${(n / 1e6).toFixed(1)}M` : n >= 1e3 ? `${(n / 1e3).toFixed(1)}k` : String(n || 0); }

// Hero card: portrait + stats + spellbook. Used by the sidebar and Hero tab.
function heroCard(d, pal, W, { big = false } = {}) {
  const out = [];
  const cls = C.CLASSES[d.hero.cls];
  const t = L.theme(d.cfg);
  out.push(panelLine(W, pal.panel2, [[` ${d.hero.name} `, pal.accent, true], [`Lv ${d.lvl} ${cls.name}`, pal.text]], [[`${L.titleFor(t, d.lvl)} `, pal.magic]]));
  const pw = 18, ph = 13;
  const pc = new X.PixelCanvas(pw, ph, pal.panel);
  pc.glow(9, 16, 14, C.COLORS[d.hero.primary] || pal.magic, 0.25);
  for (let x = 0; x < pw; x++) pc.set(x, 25, X.mix(pal.panel, pal.text, 0.1));
  SP.drawHero(pc, d.hero, 1, 1, { t: ui.tick, pose: (ui.tick >> 5) % 4 === 3 ? 'cheer' : 'stand' });
  const portrait = pc.lines();
  const statW = W - pw, barW = Math.max(6, statW - 12);
  const maxStat = Math.max(20, ...Object.values(d.stats));
  const statColors = { STR: pal.bad, INT: pal.magic, DEX: pal.good, WIS: [110, 190, 255], CHA: pal.gold };
  const right = [panelLine(statW, pal.panel, [[` ${cls.desc}`, pal.dim]])];
  for (const [k, v] of Object.entries(d.stats)) {
    right.push(`${bg(pal.panel)}${fg(k === cls.stat ? pal.accent : pal.text)}${k === cls.stat ? BOLD : ''} ${k}${NOBOLD} ${barPart(v / maxStat, barW, X.shade(statColors[k], 0.7), statColors[k], pal, pal.panel)}${fg(pal.dim)} ${String(v).padEnd(statW - barW - 6)}${RESET}`);
  }
  const lo = L.xpForLevel(d.lvl), hi = L.xpForLevel(d.lvl + 1);
  right.push(`${bg(pal.panel)}${fg(pal.dim)} XP  ${barPart((d.state.xp - lo) / (hi - lo), barW, pal.accent, pal.gold, pal, pal.panel)}${fg(pal.dim)} ${`${Math.round((d.state.xp - lo) / (hi - lo) * 100)}%`.padEnd(statW - barW - 6)}${RESET}`);
  const tok = d.state.tokens || { input: 0, output: 0 };
  right.push(panelLine(statW, pal.panel, [[' Tokens ', pal.dim], [`${fmtNum(tok.output)} out · ${fmtNum(tok.input)} in`, pal.text]]));
  right.push(panelLine(statW, pal.panel, [[' Slain ', pal.dim], [`${ui.battle.kills}`, pal.text, true], ['  Gold ', pal.dim], [`◉ ${ui.battle.gold}`, pal.gold, true]]));
  while (right.length < ph) right.push(panelLine(statW, pal.panel, []));
  for (let i = 0; i < ph; i++) out.push(portrait[i] + right[i]);
  out.push(panelLine(W, pal.panel2, [[' SPELLBOOK', pal.accent, true]]));
  const spells = C.SPELLS.map((s) => {
    const known = s.lvl <= d.lvl;
    const name = s.id === 'basic' ? C.BASIC_NAMES[d.hero.cls] : s.name;
    return [known ? `✦ ${name}` : `· ${name} (Lv ${s.lvl})`, known ? pal.gold : pal.dim, known];
  });
  const perRow = big ? 3 : 2, colW = Math.floor(W / perRow);
  for (let i = 0; i < spells.length; i += perRow) {
    out.push(spells.slice(i, i + perRow).map(([s, c, b], j, arr) => panelLine(j === arr.length - 1 ? W - colW * (arr.length - 1) : colW, pal.panel, [[' ' + s, c, b]])).join(''));
  }
  return out;
}

function partyList(d, pal, W) {
  const party = Object.values(d.ses.party || {});
  const out = [panelLine(W, pal.panel2, [[' COMPANIONS ', pal.accent, true], [party.length ? `${party.length} fighting` : 'none', pal.dim]])];
  if (!party.length) out.push(panelLine(W, pal.panel, [[' Agents Claude launches join you here.', pal.dim]]));
  for (const p of party) out.push(panelLine(W, pal.panel, [[` ${p.cls} `, (X.CLASS_COLORS[p.cls] || X.CLASS_COLORS.Mage).H, true], [`${p.type} · ${Math.round((Date.now() - p.since) / 1000)}s`, pal.dim]]));
  return out;
}

function partyTab(d, pal, W, h) {
  const party = Object.values(d.ses.party || {});
  const out = [];
  if (party.length) {
    const pc = new X.PixelCanvas(W, 9, pal.panel);
    party.slice(0, Math.floor((W - 4) / 16)).forEach((p, i) => {
      const colors = X.CLASS_COLORS[p.cls] || X.CLASS_COLORS.Mage;
      pc.glow(8 + i * 16, 12, 9, colors.H, 0.25);
      SP.drawCompanion(pc, colors, 3 + i * 16, 2 + ((ui.tick + i * 3) >> 2 & 1), { t: ui.tick + i });
      pc.label(2 + i * 16, 8, (p.cls || '').slice(0, 12), pal.text);
    });
    out.push(...pc.lines());
  }
  out.push(...partyList(d, pal, W));
  out.push(panelLine(W, pal.panel2, [['  RECENT ADVENTURES', pal.accent, true]]));
  const hist = d.events.filter((e) => e.kind === 'summon' || e.kind === 'return');
  for (const e of hist.slice(-Math.max(0, h - out.length))) out.push(panelLine(W, pal.panel, [[`  ${new Date(e.t).toTimeString().slice(0, 5)} `, pal.dim], [stripIcon(e.text), pal.magic]]));
  return out;
}

function trophiesTab(d, pal, W) {
  const got = new Set(d.state.achievements);
  const out = [panelLine(W, pal.panel2, [['  TROPHIES ', pal.accent, true], [`${got.size}/${L.ACHIEVEMENTS.length} unlocked`, pal.dim]])];
  const barW = 16;
  for (const a of L.ACHIEVEMENTS) {
    const v = Math.min(a.goal, a.value(d.state, d.ses));
    const done = got.has(a.id);
    const name = a.name.padEnd(15).slice(0, 15);
    out.push(`${bg(pal.panel)}${fg(done ? pal.gold : pal.dim)}${BOLD}${done ? '  ★ ' : '  ☆ '}${NOBOLD}${fg(done ? pal.gold : pal.text)}${name} ${barPart(done ? 1 : v / a.goal, barW, done ? pal.gold : pal.dim, done ? pal.accent : pal.magic, pal, pal.panel)} ${panelLine(W - 4 - 16 - barW - 1, pal.panel, [[`${done ? a.goal : v}/${a.goal}  `, pal.text], [a.desc, pal.dim]])}`);
  }
  return out;
}

function heroTab(d, pal, W) {
  const out = heroCard(d, pal, W, { big: true });
  const s = d.state;
  const rows = [['Edits forged', s.tools.editing], ['Commands cast', s.tools.running], ['Files scouted', s.tools.reading], ['Searches', s.tools.searching], ['Web & MCP', s.tools.web], ['Allies summoned', s.tools.summoning], ['Plans drawn', s.tools.planning]];
  const max = Math.max(1, ...rows.map((r) => r[1] || 0));
  out.push(panelLine(W, pal.panel2, [[' DEEDS ', pal.accent, true], [`${s.quests} quests · ${s.streak.count}-day streak · press c to edit your hero`, pal.dim]]));
  const barW = Math.max(10, W - 30);
  for (const [label, n] of rows) out.push(`${bg(pal.panel)}${fg(pal.text)}  ${label.padEnd(16)} ${barPart((n || 0) / max, barW, pal.magic, pal.accent, pal, pal.panel)}${fg(pal.dim)} ${String(n || 0).padEnd(W - barW - 20)}${RESET}`);
  return out;
}

// Skill hotbar: one slot per spell with a cooldown fill. Records click zones.
function hotbar(d, pal, W) {
  let s = `${bg(pal.panel)} `, used = 1;
  const zones = [];
  const slotW = Math.max(14, Math.min(22, Math.floor((W - 2) / C.SPELLS.length)));
  C.SPELLS.forEach((sp, i) => {
    if (used + slotW > W) return;
    const known = sp.lvl <= d.lvl;
    const name = sp.id === 'basic' ? C.BASIC_NAMES[d.hero.cls] : sp.name;
    const cd = Math.max(0, (ui.cooldowns[sp.id] || 0) - ui.tick);
    const ready = known && cd === 0;
    const label = ` ${i + 1} ${known ? name : `Lv ${sp.lvl}`}`;
    const inner = slotW - 1;
    const fill = known ? Math.round(inner * (1 - cd / COOLDOWN[sp.id])) : 0;
    const text = truncVis(label, inner).padEnd(inner);
    let cell = '';
    [...text].forEach((ch, j) => { cell += `${bg(!known ? pal.panel2 : j < fill ? X.mix(pal.panel2, pal.accent, ready ? 0.55 : 0.3) : pal.panel2)}${fg(ready ? pal.text : pal.dim)}${ch}`; });
    s += `${ready ? BOLD : ''}${cell}${NOBOLD}${bg(pal.panel)} `;
    zones.push({ from: used + 1, to: used + inner, slot: i });
    used += slotW;
  });
  ui.hotbarZones = zones;
  return s + ' '.repeat(Math.max(0, W - used)) + RESET;
}

// ---------- header / footer ----------

function header(d, pal, W) {
  const t = L.theme(d.cfg);
  const out = [];
  const tabs = TABS.map((name, i) => (i === ui.tab ? [` ${i + 1} ${name} `, pal.accent, true] : [` ${i + 1} ${name} `, pal.dim]));
  out.push(panelLine(W, pal.panel, [[' ◆ CLAUDE ARCADE ', pal.accent, true], [`· ${t.name}`, pal.dim]], [...tabs, [' ', pal.dim]]));
  let tx = W - 1 - tabs.reduce((n, [s]) => n + L.visWidth(s), 0);
  ui.tabZones = tabs.map(([s], i) => { const z = { from: tx + 1, to: tx + L.visWidth(s), tab: i }; tx += L.visWidth(s); return z; });
  const hp = d.ses.hp ?? 100;
  const lo = L.xpForLevel(d.lvl), hi = L.xpForLevel(d.lvl + 1);
  const xpW = Math.max(10, Math.min(28, Math.floor(W / 6))), hpW = Math.max(8, Math.floor(xpW / 2));
  const clsName = C.CLASSES[d.hero.cls].name;
  const left = ` ${d.hero.name} · Lv ${d.lvl} ${clsName}  XP `;
  const mid = ` ${d.state.xp}/${hi}   HP `;
  const tail = ` ${hp}${d.ses.combo >= 3 ? `   ≫ combo x${d.ses.combo}` : ''}   ★ ${d.state.quests} quests`;
  const used = L.visWidth(left) + xpW + L.visWidth(mid) + hpW;
  const tailT = truncVis(tail, W - used);
  out.push(`${bg(pal.panel2)}${BOLD}${fg(pal.text)} ${d.hero.name}${NOBOLD}${fg(pal.dim)} · ${fg(pal.magic)}Lv ${d.lvl} ${clsName}${fg(pal.dim)}  XP ${barPart((d.state.xp - lo) / (hi - lo), xpW, pal.accent, pal.gold, pal, pal.panel2)}${fg(pal.dim)}${mid}${barPart(hp / 100, hpW, pal.bad, pal.good, pal, pal.panel2)}${fg(pal.accent)}${tailT}${' '.repeat(Math.max(0, W - used - L.visWidth(tailT)))}${RESET}`);
  const mode = currentMode(d.ses);
  const verb = mode === 'cheer' ? 'Cheering!' : (t.modes[mode] || t.modes.thinking).verb;
  const age = Math.max(0, Math.round((Date.now() - (d.ses.since || Date.now())) / 1000));
  const busy = isBusy(mode);
  const partyN = Object.keys(d.ses.party || {}).length;
  out.push(panelLine(W, pal.panel, [[' ▶ ', pal.accent, true], [`${verb}${busy ? '…' : ''} `, pal.text, true], [d.ses.detail && mode !== 'victory' ? d.ses.detail : '', pal.accent], [busy && age > 1 ? `  ${age}s` : '', pal.dim]], partyN ? [[`✧ ${partyN} companion${partyN > 1 ? 's' : ''} `, pal.magic, true]] : []));
  return out;
}

function footer(pal, W, keys) {
  let s = `${bg(pal.panel2)} `, used = 1;
  for (const [k, lbl] of keys) {
    const kk = ` ${k} `, ll = ` ${lbl}  `;
    if (used + L.visWidth(kk) + L.visWidth(ll) > W) break;
    s += `${bg(pal.accent)}${fg(pal.ink)}${BOLD}${kk}${NOBOLD}${bg(pal.panel2)}${fg(pal.dim)}${ll}`;
    used += L.visWidth(kk) + L.visWidth(ll);
  }
  return s + ' '.repeat(Math.max(0, W - used)) + RESET;
}

// ---------- character creator ----------

const FIELDS = ['name', 'cls', 'primary', 'secondary', 'skin', 'hair', 'accessory', 'begin'];
const FIELD_LABEL = { name: 'Name', cls: 'Class', primary: 'Robe', secondary: 'Trim', skin: 'Skin', hair: 'Hair', accessory: 'Accessory' };
const OPTIONS = { cls: Object.keys(C.CLASSES), primary: Object.keys(C.COLORS), secondary: Object.keys(C.COLORS), skin: Object.keys(C.SKINS), hair: Object.keys(C.HAIR), accessory: C.ACCESSORIES };

function openCreator(d) {
  ui.screen = 'create';
  ui.create.field = 0;
  ui.create.ch = { ...(C.getCharacter(d.cfg) || C.defaultCharacter()) };
  ui.create.isNew = !C.getCharacter(d.cfg);
}

function creatorFrame(cols, rows, d) {
  const pal = UI[d.cfg.theme] || UI.rpg;
  const W = Math.max(60, cols), ch = ui.create.ch;
  const out = [panelLine(W, pal.panel, [[' ◆ CLAUDE ARCADE ', pal.accent, true], ['· Create your hero', pal.text]], [['↑↓ choose  ←→ change  type a name  enter to begin ', pal.dim]])];
  const bodyH = Math.max(12, rows - 2);
  const formW = Math.min(52, Math.floor(W * 0.45)), prevW = W - formW;
  const S = Math.max(1, Math.min(4, Math.floor(Math.min(bodyH * 2 / 34, prevW / 26))));
  const lc = Math.ceil(prevW / S), lr = Math.ceil(bodyH / S);
  const pc = new X.PixelCanvas(lc, lr, pal.panel);
  for (let y = 0; y < pc.h; y++) for (let x = 0; x < pc.w; x++) pc.px[y * pc.w + x] = X.mix(pal.panel, [0, 0, 0], 0.3 * (1 - y / pc.h));
  const hx = Math.floor(lc / 2) - 8, hy = Math.floor(pc.h / 2) - 13;
  pc.glow(hx + 8, hy + 14, 22, C.COLORS[ch.primary] || pal.magic, 0.3);
  for (let x = hx - 6; x < hx + 22; x++) for (let y = hy + 24; y < hy + 27; y++) pc.set(x, y, X.mix(pal.panel2, pal.text, y === hy + 24 ? 0.25 : 0.08));
  const poses = ['stand', 'walk1', 'stand', 'walk2', 'cheer'];
  SP.drawHero(pc, ch, hx, hy, { pose: poses[(ui.tick >> 4) % poses.length], t: ui.tick, action: true });
  let preview = pc.lines();
  if (S > 1) {
    const big = new X.PixelCanvas(prevW, bodyH);
    for (let y = 0; y < big.h; y++) for (let x = 0; x < prevW; x++) big.px[y * prevW + x] = pc.px[Math.floor(y / S) * lc + Math.floor(x / S)];
    for (const [k, v] of pc.text) { const [c, r] = k.split(',').map(Number); if (c * S < prevW && r * S < bodyH) big.text.set(`${c * S},${r * S}`, v); }
    preview = big.lines();
  }
  const form = [panelLine(formW, pal.panel2, [[' YOUR HERO', pal.accent, true]]), panelLine(formW, pal.panel, [])];
  FIELDS.forEach((f, i) => {
    const sel = i === ui.create.field;
    if (f === 'begin') {
      form.push(panelLine(formW, pal.panel, []));
      form.push(panelLine(formW, sel ? pal.accent : pal.panel2, [[sel ? '  ▶ BEGIN ADVENTURE ◀' : '    Begin adventure', sel ? pal.ink : pal.text, true]]));
      return;
    }
    let value = f === 'name' ? `${ch.name}${sel && (ui.tick >> 3) % 2 ? '▏' : ' '}` : f === 'cls' ? C.CLASSES[ch.cls].name : ch[f];
    if (f !== 'name') value = `◀ ${value} ▶`;
    const swatch = { primary: C.COLORS[ch.primary], secondary: C.COLORS[ch.secondary], skin: C.SKINS[ch.skin], hair: C.HAIR[ch.hair] }[f];
    form.push(panelLine(formW, sel ? pal.panel2 : pal.panel, [[sel ? ' ▸ ' : '   ', pal.accent, true], [FIELD_LABEL[f].padEnd(11), sel ? pal.text : pal.dim, sel], [value, sel ? pal.accent : pal.text, sel], [swatch ? '  ██' : '', swatch || pal.text]]));
  });
  const cls = C.CLASSES[ch.cls];
  form.push(panelLine(formW, pal.panel, []));
  form.push(panelLine(formW, pal.panel2, [[` ${cls.name.toUpperCase()}`, pal.accent, true], [`  main stat ${cls.stat}`, pal.dim]]));
  form.push(panelLine(formW, pal.panel, [[` ${cls.desc}`, pal.text]]));
  form.push(panelLine(formW, pal.panel, [[` Basic attack: ${C.BASIC_NAMES[ch.cls]}`, pal.dim]]));
  form.push(panelLine(formW, pal.panel, [[' Spells unlock at Lv 3, 5, 8, 12 and 18.', pal.dim]]));
  while (form.length < bodyH) form.push(panelLine(formW, pal.panel, []));
  for (let i = 0; i < bodyH; i++) out.push(form[i] + preview[i]);
  out.push(footer(pal, W, [['↑↓', 'field'], ['←→', 'change'], ['enter', 'begin'], ['esc', ui.create.isNew ? 'use defaults' : 'cancel']]));
  return out;
}

function creatorKey(key, d) {
  const cr = ui.create, ch = cr.ch, f = FIELDS[cr.field];
  if (key === '\x1b[A') cr.field = (cr.field + FIELDS.length - 1) % FIELDS.length;
  else if (key === '\x1b[B' || key === '\t') cr.field = (cr.field + 1) % FIELDS.length;
  else if ((key === '\x1b[C' || key === '\x1b[D') && OPTIONS[f]) {
    const opts = OPTIONS[f], dir = key === '\x1b[C' ? 1 : -1;
    ch[f] = opts[(opts.indexOf(ch[f]) + dir + opts.length) % opts.length];
    if (f === 'cls') { const c = C.CLASSES[ch.cls]; ch.primary = c.primary; ch.secondary = c.secondary; ch.accessory = c.accessory; }
  } else if (key === '\r' || key === '\n') {
    d.cfg.character = { ...ch, name: ch.name.trim() || 'Hero' };
    L.saveConfig(d.cfg);
    L.logEvent({ sid: d.sid, kind: 'welcome', text: `${d.cfg.character.name} the ${C.CLASSES[ch.cls].name} begins their adventure!` });
    ui.screen = 'game';
  } else if (key === '\x1b') {
    if (cr.isNew) { d.cfg.character = C.defaultCharacter(); L.saveConfig(d.cfg); }
    ui.screen = 'game';
  } else if (f === 'name') {
    if (key === '\x7f' || key === '\b') ch.name = ch.name.slice(0, -1);
    else if (/^[\w .'-]$/.test(key) && ch.name.length < 16) ch.name += key;
  }
}

// ---------- frame ----------

function frame(cols, rows) {
  const d = snapshotData();
  if (ui.screen === 'create') return creatorFrame(cols, rows, d);
  const pal = UI[d.cfg.theme] || UI.rpg;
  const W = Math.max(50, cols);
  const out = header(d, pal, W);
  const bodyH = Math.max(8, rows - out.length - 2);
  const top = out.length;

  if (ui.tab === 0) {
    if (W >= 130) {
      const sceneW = W - SIDE;
      const scene = sceneLines(sceneW, bodyH, d, pal);
      ui.layout = { top, cols: sceneW, rows: bodyH };
      const side = [...heroCard(d, pal, SIDE), ...partyList(d, pal, SIDE)];
      side.push(panelLine(SIDE, pal.panel2, [[' QUEST LOG', pal.accent, true]]));
      side.push(...questLog(d, pal, SIDE, Math.max(0, bodyH - side.length), true));
      for (let i = 0; i < bodyH; i++) out.push(scene[i] + (side[i] || panelLine(SIDE, pal.panel, [])));
    } else {
      const sceneH = Math.max(8, Math.min(40, Math.floor(bodyH * 0.62)));
      out.push(...sceneLines(W, sceneH, d, pal));
      ui.layout = { top, cols: W, rows: sceneH };
      out.push(panelLine(W, pal.panel2, [['  QUEST LOG', pal.accent, true]], [[`wave ${ui.battle.wave} · ${ui.battle.kills} slain `, pal.dim]]));
      out.push(...questLog(d, pal, W, bodyH - sceneH - 1));
    }
  } else {
    ui.layout = null;
    const body = [heroTab, partyTab, trophiesTab][ui.tab - 1](d, pal, W, bodyH).slice(0, bodyH);
    while (body.length < bodyH) body.push(panelLine(W, pal.panel, []));
    out.push(...body);
  }
  const sess = d.sid ? `${ui.pin ? 'pinned' : 'following'} ${d.sid.slice(0, 8)}` : 'no session';
  out.push(hotbar(d, pal, W));
  ui.hotbarRow = out.length;
  out.push(footer(pal, W, [['1-6', 'cast'], ['click', 'strike'], ['w', 'wave'], ['tab', 'view'], ['c', 'hero'], ['t', 'theme'], ['p', sess], ['q', 'quit']]));
  return out;
}

// ---------- main loop ----------

function render(force = false) {
  const cols = process.stdout.columns || 100, rows = process.stdout.rows || 30;
  const lines = frame(cols, rows).slice(0, rows);
  let s = '';
  lines.forEach((l, i) => { if (force || ui.prev[i] !== l) s += `${ESC}${i + 1};1H${l}`; });
  ui.prev = lines;
  if (s) process.stdout.write(s);
}

function onKey(key) {
  const d = snapshotData();
  if (key === '\x03') return quit();
  if (ui.screen === 'create') { creatorKey(key, d); return render(true); }
  if (key.startsWith('\x1b[<')) return onMouse(key, d);
  if (key === 'q' || key === '\x1b') return quit();
  if (/^[1-6]$/.test(key)) playerCast(d, Number(key) - 1);
  if (key === ' ') playerCast(d, 0);
  if (key === 'w' && !aliveMonsters().length) { ui.battle.practice = true; spawnWave(sceneW, Math.floor(ui.heroY + 24), d.lvl); }
  if (key === '\x1b[C' || key === '\t') ui.tab = (ui.tab + 1) % TABS.length;
  if (key === '\x1b[D') ui.tab = (ui.tab + TABS.length - 1) % TABS.length;
  if (key === 'c') openCreator(d);
  if (key === 't') {
    const names = Object.keys(L.THEMES);
    d.cfg.theme = names[(names.indexOf(d.cfg.theme) + 1) % names.length];
    L.saveConfig(d.cfg);
  }
  if (key === 'p') {
    const ids = d.sessions.map(([id]) => id);
    const i = ui.pin ? ids.indexOf(ui.pin) : -1;
    ui.pin = i + 1 < ids.length ? ids[i + 1] : null;
  }
  render(true);
}

// SGR mouse: "\x1b[<b;col;rowM". Left click strikes monsters, casts from the
// hotbar or switches tabs.
function onMouse(seq, d) {
  for (const m of seq.matchAll(/\x1b\[<(\d+);(\d+);(\d+)([Mm])/g)) {
    const [btn, col, row, kind] = [Number(m[1]), Number(m[2]), Number(m[3]), m[4]];
    if (kind !== 'M' || (btn & 3) !== 0 || btn >= 32) continue;
    if (row === 1 && ui.tabZones) { const z = ui.tabZones.find((z) => col >= z.from && col <= z.to); if (z) ui.tab = z.tab; continue; }
    if (row === ui.hotbarRow + 1 && ui.hotbarZones) { const z = ui.hotbarZones.find((z) => col >= z.from && col <= z.to); if (z) playerCast(d, z.slot); continue; }
    const lay = ui.layout;
    if (!lay || row <= lay.top || row > lay.top + lay.rows || col > lay.cols) continue;
    const S = ui.sceneScale || 1;
    const px = (col - 1) / S, py = ((row - 1 - lay.top) * 2 + 1) / S;
    const target = aliveMonsters().find((mo) => { const [mw, mh] = SP.monsterSize(mo); return px >= mo.x - 3 && px <= mo.x + mw + 3 && py >= mo.y - 4 && py <= mo.y + mh + 4; });
    if (target && (ui.cooldowns.click || 0) <= ui.tick) {
      ui.cooldowns.click = ui.tick + 3;
      const stat = d.stats[C.CLASSES[d.hero.cls].stat] || 10;
      hitMonster(target, Math.max(1, Math.round(C.damage(C.SPELLS[0], d.lvl, stat) * 0.8)), [255, 255, 255]);
      emit(6, px, py, [[255, 255, 255], [255, 220, 120]], { spread: 1.2, up: 1.5 });
    } else if (!target) emit(3, px, py, [[200, 200, 220]], { spread: 0.6, up: 0.8, life: 8 });
  }
  render(true);
}

// Bank gold and kills in state.json (under the same lock the hooks use).
function saveProgress() {
  if (!ui.dirty) return;
  ui.dirty = false;
  try {
    L.withLock(() => {
      const st = L.loadState();
      if (ui.xpPending) { st.xp += ui.xpPending; st.battleXp = (st.battleXp || 0) + ui.xpPending; ui.xpPending = 0; }
      st.game = { ...(st.game || {}), gold: ui.battle.gold, kills: ui.battle.kills, bestWave: Math.max((st.game || {}).bestWave || 0, ui.battle.wave) };
      L.saveState(st);
    });
  } catch {}
}

function quit() {
  saveProgress();
  process.stdout.write(`${RESET}${ESC}?1000l${ESC}?1006l${ESC}?25h${ESC}?1049l`);
  process.exit(0);
}

if (process.argv.includes('--snapshot')) {
  const arg = process.argv[process.argv.indexOf('--snapshot') + 1];
  const cols = Number(process.env.COLUMNS) || 100, rows = Number(process.env.LINES) || 28;
  if (arg === 'create') openCreator(snapshotData());
  else if (Number(arg) >= 1 && Number(arg) <= 4) ui.tab = Number(arg) - 1;
  ui.battle.lastEventT = 0; // replay recent events as spells
  const g = L.loadState().game || {};
  ui.battle.gold = g.gold || 0; ui.battle.kills = g.kills || 0;
  const warm = Number(process.env.ARCADE_WARMUP) || 40;
  for (ui.tick = 0; ui.tick < warm; ui.tick++) frame(cols, rows);
  process.stdout.write(frame(cols, rows).join('\n') + '\n');
} else if (!process.stdout.isTTY || !process.stdin.isTTY) {
  console.log('The game needs an interactive terminal. Run it in its own terminal pane: node game.js');
} else {
  const g = L.loadState().game || {};
  ui.battle.gold = g.gold || 0; ui.battle.kills = g.kills || 0;
  process.stdout.write(`${ESC}?1049h${ESC}?25l${ESC}2J${ESC}?1000h${ESC}?1006h`);
  process.stdin.setRawMode(true);
  process.stdin.setEncoding('utf8');
  process.stdin.on('data', onKey);
  process.stdout.on('resize', () => { process.stdout.write(`${ESC}2J`); render(true); });
  process.on('SIGINT', quit);
  process.on('exit', () => { saveProgress(); process.stdout.write(`${RESET}${ESC}?1000l${ESC}?1006l${ESC}?25h${ESC}?1049l`); });
  setInterval(saveProgress, 3000);
  if (!C.getCharacter(L.loadConfig())) openCreator(snapshotData());
  setInterval(() => { ui.tick++; try { render(); } catch {} }, 100);
  render(true);
}
