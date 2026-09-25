'use strict';
// Battle system: waves, spells, projectiles, loot. Drives ui.battle.

const L = require('./lib');
const M = require('./messages');
const X = require('./pixel');
const C = require('./character');
const SP = require('./sprites');
const { ESC, RESET, BOLD, NOBOLD, fg, bg, UI, TABS, SIDE, ui, snapshotData, currentMode, isBusy } = require('./state');

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


const aliveMonsters = () => ui.battle.monsters.filter((m) => m.hp > 0 && m.x < (ui.sceneW || 200) - 12);

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
  ui.sceneW = W;
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

module.exports = { emit, floater, spawnWave, hitMonster, aliveMonsters, COOLDOWN, playerCast, cast, stepBattle, drawShots };
