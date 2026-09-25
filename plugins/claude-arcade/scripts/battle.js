'use strict';
// Battle system: waves, biome rosters, bosses for long tasks, spells,
// companions, projectiles, loot and battle juice (hit-stop, crits, combos,
// elemental effects). Drives ui.battle.

const L = require('./lib');
const X = require('./pixel');
const C = require('./character');
const MON = require('./monsters');
const { UI, ui, isBusy, biomeFor, BIOMES } = require('./state');

const BOSS_AFTER_MS = 90 * 1000; // a boss arrives when one task runs this long
const COMBO_WINDOW = 25;          // ticks between kills that keep a combo alive

// ---------- particles & floaters ----------

function emit(n, x, y, colors, { spread = 1.2, up = 2, grav = 0.12, life = 18 } = {}) {
  for (let i = 0; i < n; i++) ui.particles.push({ x, y, vx: (Math.random() - 0.5) * spread * 2, vy: -Math.random() * up, g: grav, life: life * (0.6 + Math.random() * 0.6), c: colors[i % colors.length] });
  if (ui.particles.length > 500) ui.particles.splice(0, ui.particles.length - 500);
}

function floater(x, y, text, color, bold = false) { ui.floaters.push({ x, y, text, color, bold, life: 18 }); }

const size = (m) => MON.monsterSize(m);
const center = (m) => { const [w, h] = size(m); return [m.x + w / 2, m.y + (m.yOff || 0) + h / 2]; };
const stopFor = (b, n) => { b.hitStop = Math.max(b.hitStop || 0, n); };
const shakeFor = (b, n) => { b.shake = Math.max(b.shake || 0, n); };

// ---------- waves ----------

function rosterFor(lvl) {
  const biome = biomeFor(lvl);
  const all = MON.ROSTERS[biome] || MON.ROSTERS.dungeon;
  if (biome !== 'dungeon') return all;
  return lvl < 2 ? all.slice(0, 2) : lvl < 3 ? all.slice(0, 3) : all;
}

function spawnWave(W, floorY, lvl) {
  const b = ui.battle;
  b.wave += 1;
  const biome = biomeFor(lvl), bi = Math.max(0, (BIOMES || []).indexOf(biome));
  const roster = rosterFor(lvl);
  const elite = b.wave % 5 === 0;
  const n = elite ? 3 : Math.min(6, 2 + Math.floor(b.wave / 2));
  const scale = 1 + Math.min(1.5, (b.wave - 1) * 0.12);
  const types = [];
  for (let i = 0; i < n; i++) types.push(roster[(b.wave + i * 7) % roster.length]);
  if (elite) types[0] = roster.reduce((a, t) => (MON.MONSTERS[t].hp > MON.MONSTERS[a].hp ? t : a), roster[0]);
  // A wave is worth about 5-15 XP in total, split by monster toughness.
  const budget = Math.min(15, 4 + b.wave + bi * 2);
  const weights = types.map((t, i) => MON.MONSTERS[t].xp * (elite && i === 0 ? 3 : 1));
  const sum = weights.reduce((a, v) => a + v, 0);
  types.forEach((type, i) => {
    const def = MON.MONSTERS[type];
    const isElite = elite && i === 0;
    const [, h] = size({ type });
    const hp = Math.round(def.hp * scale * (isElite ? 3 : 1));
    const y = def.fly ? floorY - 26 - (i % 2) * 6 : floorY - h;
    b.monsters.push({
      type, boss: false, elite: isElite, lvl: Math.max(1, lvl + Math.floor(b.wave / 3) - 1), xp: Math.max(1, Math.round((budget * weights[i]) / sum)),
      hp, max: hp, color: b.wave + i, seed: i, x: W - 8 + i * 14, slot: i, y, baseY: y, floorY, flash: 0, frozen: 0, lunge: 0, windup: 0, kb: 0, at: i * 3,
    });
  });
}

function spawnBoss(d, W, floorY) {
  const b = ui.battle;
  const type = MON.BOSSES[biomeFor(d.lvl)] || 'boss';
  const def = MON.MONSTERS[type];
  // Draw the boss at 2x when the scene has room for it beside the hero.
  const [fw] = size({ type, boss: true, scale: 1 });
  const scale = W - ((ui.heroX || W * 0.2) + 22) >= fw * 2 + 2 ? 2 : 1;
  const [, h] = size({ type, boss: true, scale });
  const stat = d.stats[(C.CLASSES[d.hero.cls] || C.CLASSES.mage).stat] || 10;
  // Sized to last roughly a minute or two against the hero and party.
  const allies = Object.keys((d.ses && d.ses.party) || {}).length;
  const hp = Math.round(((def.hp * C.damage(C.SPELLS[0], d.lvl, stat)) / 6) * (1 + d.lvl * 0.06) * (1 + Math.min(4, allies) * 0.3));
  const xp = Math.min(150, Math.max(50, Math.round(def.xp * 0.6 + d.lvl * 3)));
  b.monsters.push({
    type, boss: true, scale, lvl: d.lvl + 2, xp, hp, max: hp, lag: hp, color: 0, seed: 0, x: W + 2, slot: 0, y: floorY - h, baseY: floorY - h, floorY,
    flash: 0, frozen: 0, lunge: 0, windup: 0, kb: 0, yOff: 0, at: 0, phase: 0, slamAt: ui.tick + 55, entering: true,
  });
  ui.celebrate = { kind: 'bossIntro', text: `${def.name} approaches!`, until: ui.tick + 30 };
  shakeFor(b, 6);
  try { L.logEvent({ sid: d.sid, kind: 'combo', text: `A boss appears: ${def.name}!` }); } catch {}
}

function summonMinions(boss, n, floorY, lvl) {
  const b = ui.battle;
  const roster = rosterFor(lvl);
  const [cx, cy] = center(boss);
  floater(cx - 4, boss.y - 10, 'SUMMON!', [200, 140, 255], true);
  emit(24, cx, cy, [[200, 140, 255], [255, 255, 255], [140, 90, 220]], { spread: 1.8, up: 2.2 });
  const have = b.monsters.filter((m) => m.minion && m.hp > 0).length;
  for (let i = 0; i < n && have + i < 4; i++) {
    const type = roster[(i + boss.phase) % roster.length];
    const def = MON.MONSTERS[type];
    const [, h] = size({ type });
    const hp = Math.round(def.hp * 1.2);
    const y = def.fly ? floorY - 26 - (i % 2) * 6 : floorY - h;
    b.monsters.push({ type, boss: false, minion: true, lvl, xp: 2, hp, max: hp, color: i + 1, seed: i + 3, x: boss.x + 4 + i * 5, slot: have + i, y, baseY: y, floorY, flash: 6, frozen: 0, lunge: 0, windup: 0, kb: 0, at: i * 5 });
  }
}

// ---------- damage ----------

function comboPop(n) {
  ui.floaters = ui.floaters.filter((f) => !f.combo);
  const col = n >= 8 ? [255, 90, 210] : n >= 5 ? [255, 120, 60] : n >= 3 ? [255, 200, 60] : [255, 240, 170];
  floater(ui.heroX + 1, ui.heroY - 8, `${n}x COMBO${n >= 5 ? '!!' : '!'}`, col, true);
  const f = ui.floaters[ui.floaters.length - 1];
  f.combo = true; f.life = 24;
}

function deathFx(m) {
  const pal = MON.paletteFor(m);
  const def = MON.MONSTERS[m.type];
  const [w, h] = size(m);
  const cx = m.x + w / 2, cy = m.y + h / 2, feet = m.y + h - 2;
  switch (def.death) {
    case 'splat': emit(16, cx, feet, [pal.G, pal.h, pal.g], { spread: 2.2, up: 2.4, grav: 0.24, life: 22 }); break;
    case 'spiral': emit(8, cx, cy, [pal.g, pal.d, pal.G], { spread: 0.9, up: 0.6, grav: 0.06, life: 16 }); break;
    case 'collapse': emit(10, cx, cy, [pal.W, pal.G, pal.g, m.type === 'golem' || m.type === 'drake' ? pal.O : pal.h], { spread: 1.3, up: 1.6, grav: 0.22, life: 16 }); break;
    case 'poof': emit(18, cx, cy, [pal.h, pal.W, pal.G], { spread: 1.1, up: 1.2, grav: -0.03, life: 22 }); break;
    case 'dissolve': emit(16, cx, cy, [pal.h, pal.G, m.type === 'imp' ? pal.O : pal.C], { spread: 0.9, up: 1.5, grav: -0.05, life: 20 }); break;
    default: emit(10, cx, feet, [[150, 130, 110], [110, 96, 84], pal.g], { spread: 1.6, up: 1, grav: 0.1, life: 14 });
  }
}

function kill(m) {
  const b = ui.battle, t = ui.tick;
  const def = MON.MONSTERS[m.type];
  m.hp = 0; m.dieT = 0; m.windup = 0; m.lunge = 0; m.burn = 0; m.curse = 0; m.frozen = 0; m.slam = null; m.yOff = 0;
  b.kills += 1;
  ui.dirty = true;
  b.combo = t - (b.lastKillT == null ? -99 : b.lastKillT) <= COMBO_WINDOW ? (b.combo || 0) + 1 : 1;
  b.lastKillT = t;
  const [mw, mh] = size(m);
  let value = m.boss ? 40 + m.lvl * 2 : (m.elite ? 5 : 0) + 1 + (m.max >> 3);
  if (b.combo >= 3) value += b.combo - 2;
    value = Math.round(value * require('./items').goldMultiplier());
  for (let i = 0; i < Math.min(8, value); i++) b.coins.push({ x: m.x + mw / 2, y: m.y, vx: (Math.random() - 0.5) * 2, vy: -1.5 - Math.random() * 1.5, v: i === 0 ? value - Math.min(8, value) + 1 : 1, age: 0 });
  if (!b.practice) { ui.xpPending = (ui.xpPending || 0) + m.xp; if (!m.boss) b.waveXp = (b.waveXp || 0) + m.xp; }
  floater(m.x + mw / 2 - 3, m.y - 12, b.practice ? `+${value}◉` : `+${m.xp} XP`, [255, 214, 80], true);
  emit(m.boss ? 40 : 8, m.x + mw / 2, m.y + mh / 2, [[255, 214, 80], [255, 255, 255], [255, 150, 60]], { spread: m.boss ? 2.4 : 1.6, up: 2.6 });
  deathFx(m);
  if (b.combo >= 2) comboPop(b.combo);
  stopFor(b, m.elite ? 3 : 1);
  if (m.boss) {
    shakeFor(b, 10); b.flash = 4; stopFor(b, 5);
    (b.rings ||= []).push({ x: m.x + mw / 2, y: m.floorY || m.y + mh, r: 3, life: 12, c: [255, 214, 80] });
    floater(m.x + mw / 2 - 5, m.y - 6, 'BOSS DOWN!', [255, 214, 80], true);
    ui.celebrate = { kind: 'boss', text: `${def.name} DEFEATED! +${m.xp} XP`, until: t + 30 };
    try { L.logEvent({ sid: ui.frameData && ui.frameData.sid, kind: 'combo', text: `Boss defeated: ${def.name}! +${m.xp} XP` }); } catch {}
  }
}

// opts: dot (damage-over-time tick), noCrit, crit (force), critChance.
function hitMonster(m, dmg, color, o = {}) {
  if (!m || m.hp <= 0) return;
  const b = ui.battle;
  const crit = !o.dot && !o.noCrit && (o.crit || Math.random() < (o.critChance || 0.15));
  dmg = Math.max(1, Math.round(crit ? dmg * 2 : dmg));
  m.hp -= dmg;
  if (!o.dot) m.flash = crit ? 4 : 3;
  const [w] = size(m);
  const [cx, cy] = center(m);
  const top = m.y + (m.yOff || 0);
  if (!o.dot) m.kb = (m.kb || 0) + (crit ? 3.2 : 1.5) * (m.boss ? 0.25 : 1);
  if (o.dot) floater(m.x + w / 2 - 1 + (Math.random() - 0.5) * 6, top - 3, `${dmg}`, color || [255, 150, 60]);
  else if (crit) {
    floater(cx - 5, top - 8, `CRIT ${dmg}!`, [255, 150, 40], true);
    emit(12, cx, cy, [[255, 240, 120], [255, 150, 40], [255, 255, 255]], { spread: 2, up: 2.2, life: 12 });
    shakeFor(b, 3); stopFor(b, 2);
  } else {
    floater(cx - 2 + (Math.random() - 0.5) * 6, top - 6, `-${dmg}`, color || [255, 240, 150], true);
    if (!m.boss && dmg >= m.max * 0.35) stopFor(b, 1);
  }
  if (m.hp <= 0) kill(m);
}

const aliveMonsters = () => ui.battle.monsters.filter((m) => m.hp > 0 && (m.x < (ui.sceneW || 200) - 12 || (m.boss && !m.entering)));

// ---------- spells ----------

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

// Legacy saves used flavor class names for companions.
const LEGACY_CLS = { sage: 'warlock', paladin: 'knight', warrior: 'rogue', scholar: 'bard' };
const ROLES = ['mage', 'ranger', 'knight', 'warlock', 'bard', 'rogue'];
function allyClass(p) {
  const c = String((p && p.cls) || 'mage').toLowerCase();
  const m = LEGACY_CLS[c] || c;
  return ROLES.includes(m) ? m : 'mage';
}
const partyOf = (d) => Object.entries((d.ses && d.ses.party) || {}).slice(0, 4);
const inspired = (d) => partyOf(d).some(([, p]) => allyClass(p) === 'bard');

// Cast the spell matching the current tool activity.
function cast(d, mode, origin, pal, forced, boost = 1) {
  const targets = aliveMonsters().sort((a, b) => a.x - b.x);
  if (!targets.length) return;
  const spell = forced || C.spellFor(d.lvl, mode, ui.tick + ui.battle.kills);
  const stat = d.stats[(C.CLASSES[d.hero.cls] || C.CLASSES.mage).stat] || 10;
  const dmg = Math.round(C.damage(spell, d.lvl, stat) * boost * (inspired(d) ? 1.2 : 1) * require('./items').damageMultiplier());
  // Tell the hero animation what was just cast.
  ui.heroAction = { kind: spell.id === 'basic' ? 'swing' : 'cast', spell: spell.id, t: ui.tick };
  const target = targets[0];
  const [ox, oy] = origin;
  if (spell.id === 'chain') {
    let from = [ox, oy];
    for (const m of targets.slice(0, spell.chain)) {
      const to = center(m);
      ui.battle.bolts.push({ from, to, life: 5 });
      m.shock = 6;
      emit(5, to[0], to[1], [[255, 255, 255], [150, 210, 255]], { spread: 1.4, up: 1.4, life: 8 });
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

// ---------- companions ----------

const ALLY = {
  ranger: { every: 12, kind: 'shoot' },
  knight: { every: 40, kind: 'taunt' },
  warlock: { every: 30, kind: 'curse' },
  bard: { every: 26, kind: 'play' },
  rogue: { every: 36, kind: 'dash' },
  mage: { every: 30, kind: 'blast' },
};

function stepAllies(d, heroX, floorY, active) {
  const b = ui.battle, t = ui.tick;
  b.allyState ||= {}; b.inspiredIds ||= {};
  const party = partyOf(d);
  b.shield = party.some(([, p]) => allyClass(p) === 'knight');
  const base = Math.max(2, Math.round(C.damage(C.SPELLS[0], d.lvl, 10) * 0.5 * (inspired(d) ? 1.2 : 1)));
  party.forEach(([id, p], i) => {
    const cls = allyClass(p);
    const ax = heroX - 12 * (i + 1) + 9, ay = floorY - 8;
    if (cls === 'bard' && !b.inspiredIds[id]) { b.inspiredIds[id] = true; floater(heroX - 4, ui.heroY - 12, '♪ inspired', [255, 170, 220], true); }
    if (!active) return;
    const target = aliveMonsters().sort((a, c) => a.x - c.x)[0];
    if (!target) return;
    const role = ALLY[cls];
    // Rangers loose the first arrow at every new wave.
    const first = cls === 'ranger' && b.rangerWave !== b.wave;
    if (!first && (t + i * 7) % role.every !== 0) return;
    if (cls === 'ranger') b.rangerWave = b.wave;
    b.allyState[id] = { attackT: t, kind: role.kind };
    const shot = (spell, dmg, color, speed, extra = {}) => b.shots.push({ x: ax, y: ay, spell, dmg, target, speed, color, ally: cls, ...extra });
    switch (cls) {
      case 'ranger': shot({ id: 'arrow' }, base, [210, 170, 110], 3.6, { cls: 'ranger', critChance: 0.4 }); break;
      case 'knight': {
        target.taunt = 34;
        floater(target.x, target.y - 10, 'TAUNT!', [120, 190, 255], true);
        shot({ id: 'ally' }, base, [235, 240, 255], 2.4, { cls: 'knight' });
        break;
      }
      case 'warlock': shot({ id: 'curse' }, Math.round(base * 0.6), [180, 90, 240], 1.8); break;
      case 'bard': shot({ id: 'note' }, Math.round(base * 0.7), [255, 170, 220], 2, { cls: 'bard' }); break;
      case 'rogue': (b.dashes ||= []).push({ id, x0: ax - 6, y0: floorY - 7, target, t: 0, dmg: Math.round(base * 1.6) }); break;
      default: shot({ id: 'blast', aoe: 7 }, Math.round(base * 0.8), [120, 160, 255], 2.2);
    }
  });
  // Rogue dashes: 4 ticks out, strike, 4 ticks back.
  b.dashes = (b.dashes || []).filter((ds) => {
    ds.t++;
    const tgt = ds.target.hp > 0 ? ds.target : null;
    if (tgt) { const [cx, cy] = center(tgt); ds.tx = tgt.x - 3; ds.ty = cy; ds.cx = cx; }
    if (ds.t === 4 && tgt) {
      hitMonster(tgt, ds.dmg, [200, 255, 230], { crit: Math.random() < 0.7 });
      emit(8, ds.cx, ds.ty, [[220, 255, 240], [255, 255, 255], [120, 220, 200]], { spread: 1.6, up: 1.6, life: 10 });
    }
    return ds.t < 9 && ds.tx != null;
  });
}

// ---------- boss behavior ----------

function stepBoss(boss, d, heroX, floorY) {
  const b = ui.battle, t = ui.tick;
  const r = boss.hp / boss.max;
  const [w, h] = size(boss);
  const [cx] = center(boss);
  if (boss.phase < 1 && r < 0.7) { boss.phase = 1; summonMinions(boss, 2, floorY, d.lvl); }
  if (boss.phase < 2 && r < 0.4) { boss.phase = 2; summonMinions(boss, 3, floorY, d.lvl); }
  if (!boss.enraged && r < 0.35) {
    boss.enraged = true;
    floater(cx - 4, boss.y - 12, 'ENRAGED!', [255, 70, 50], true);
    emit(30, cx, boss.y + h / 2, [[255, 70, 40], [255, 180, 60], [120, 20, 20]], { spread: 2, up: 2.4 });
    shakeFor(b, 5);
    boss.slamAt = Math.min(boss.slamAt, t + 20);
  }
  if (!boss.slam && t >= boss.slamAt) boss.slam = { t: 0 };
  if (!boss.slam) return;
  // Telegraphed slam: crouch, rise with a warning, crash down.
  const s = boss.slam, T = boss.enraged ? 10 : 14;
  s.t++;
  if (s.t <= 3) boss.yOff = 1;
  else if (s.t <= T) boss.yOff = -Math.round(12 * Math.sin(((s.t - 3) / (T - 3)) * Math.PI / 2));
  else if (s.t <= T + 2) boss.yOff = -Math.round(12 * (1 - (s.t - T) / 2));
  if (s.t === 4) floater(cx - 1, boss.y - 14, '!!', [255, 80, 60], true);
  if (s.t === T + 2) {
    boss.yOff = 0;
    shakeFor(b, 8); stopFor(b, 3);
    b.rings.push({ x: boss.x + w / 2, y: floorY, r: 4, life: 10, c: [255, 230, 200] });
    emit(26, boss.x + w / 2, floorY - 1, [[150, 130, 110], [200, 180, 150], [110, 96, 84]], { spread: 2.6, up: 1.4, grav: 0.1, life: 16 });
    emit(10, heroX + 8, ui.heroY + 14, b.shield ? [[140, 200, 255], [255, 255, 255]] : [[255, 80, 70], [255, 200, 200]], { spread: 1.4, up: 1.6, life: 12 });
    floater(heroX + 1, ui.heroY - 4, b.shield ? 'BLOCKED' : 'SLAM!', b.shield ? [140, 200, 255] : [255, 90, 70], true);
    if (b.shield) b.shieldFlash = 8;
  }
  if (s.t >= T + 6) { boss.slam = null; boss.yOff = 0; boss.slamAt = t + (boss.enraged ? 45 : 80); }
}

// ---------- main step ----------

function stepBattle(d, pc, floorY, heroX, origin, pal, mode) {
  const b = ui.battle, W = pc.w, t = ui.tick;
  ui.sceneW = W;
  b.floorY = floorY;
  b.rings ||= [];
  const busy = isBusy(mode);
  const frozen = (b.hitStop || 0) > 0;
  if (frozen) b.hitStop--;

  // New tool events trigger spells; failures let a monster land a hit.
  const fresh = d.events.filter((e) => e.t > b.lastEventT);
  if (fresh.length) b.lastEventT = fresh[fresh.length - 1].t;
  for (const e of fresh) {
    if (e.kind === 'action') cast(d, e.mode || 'thinking', origin, pal);
    if (e.kind === 'hurt') {
      const m = aliveMonsters().filter((mo) => !mo.boss)[0];
      if (m) m.windup = 3;
      if (b.shield) { shakeFor(b, 2); b.shieldFlash = 8; } else shakeFor(b, 5);
    }
  }
  if (!frozen) {
    // Auto-attack while Claude works; faster at higher levels.
    const every = Math.max(6, Math.round(24 - d.lvl * 1.2));
    if (busy && t % every === 0) cast(d, mode, origin, pal);
    stepAllies(d, heroX, floorY, busy || b.practice);
  }

  // Waves: spawn while busy, wipe out on victory, retreat when idle.
  if (b.wave && b.buffWave !== b.wave && !b.monsters.some((m) => m.hp > 0)) { b.buffWave = b.wave; require('./items').consumeWave(); }
  if (b.wave && !b.monsters.some((m) => m.hp > 0) && b.waveXp) {
    L.logEvent({ sid: d.sid, kind: 'combo', text: `Wave ${b.wave} cleared! +${b.waveXp} XP` });
    b.waveXp = 0;
  }
  const turn = d.ses && d.ses.turn;
  if (busy && !b.practice && turn && turn.start && b.bossTurn !== turn.start && Date.now() - turn.start > BOSS_AFTER_MS) {
    b.bossTurn = turn.start;
    spawnBoss(d, W, floorY);
  }
  if (busy && !aliveMonsters().length && !b.monsters.some((m) => m.hp > 0) && t % 20 === 0) spawnWave(W, floorY, d.lvl);
  if (mode === 'victory' && d.ses.since !== b.lastVictory) {
    b.lastVictory = d.ses.since;
    const boss = b.monsters.find((m) => m.boss && m.hp > 0);
    if (boss) { b.finisher = { t: 0, m: boss }; boss.slam = null; boss.yOff = 0; }
    const rest = aliveMonsters().filter((m) => !m.boss);
    if (rest.length) { b.flash = 4; shakeFor(b, 6); for (const m of rest) hitMonster(m, m.hp, [255, 214, 80], { noCrit: true }); }
    b.wave = 0;
  }
  // The big finisher: a pillar of light, then the boss falls.
  if (b.finisher) {
    const f = b.finisher;
    f.t++;
    const [cx, cy] = center(f.m);
    if (f.t < 10) emit(3, cx + (Math.random() - 0.5) * 8, 0, [[255, 250, 200], [255, 214, 80]], { spread: 0.3, up: -2, grav: 0.3, life: 10 });
    if (f.t === 10 && f.m.hp > 0) {
      floater(cx - 5, f.m.y - 14, 'FINISHER!', [255, 240, 150], true);
      emit(40, cx, cy, [[255, 255, 255], [255, 214, 80], [255, 150, 60]], { spread: 2.8, up: 3 });
      hitMonster(f.m, f.m.hp, [255, 214, 80], { noCrit: true });
      b.flash = 5;
    }
    if (f.t > 16) b.finisher = null;
  }
  if (b.practice && !b.monsters.some((m) => m.hp > 0)) b.practice = false;

  const minionSlots = {};
  let ms = 0;
  for (const m of b.monsters) if (m.minion && m.hp > 0) minionSlots[b.monsters.indexOf(m)] = ms++;
  b.monsters.forEach((m, idx) => {
    if (m.hp <= 0) {
      if (frozen) return;
      m.dieT = (m.dieT || 0) + 1;
      if (m.boss && m.dieT < 14 && m.dieT % 3 === 0) {
        const [w, h] = size(m);
        emit(12, m.x + Math.random() * w, m.y + Math.random() * h, [[255, 240, 180], [255, 150, 60], [255, 255, 255]], { spread: 1.8, up: 2 });
        shakeFor(b, 2);
      }
      return;
    }
    if (frozen) return;
    m.at = (m.at || 0) + 1;
    const def = MON.MONSTERS[m.type];
    const [mw, mh] = size(m);
    const stop = m.boss ? Math.max(heroX + 18, Math.min(W - mw - 1, heroX + 34))
      : m.minion ? heroX + 22 + (minionSlots[idx] || 0) * 9 : heroX + 22 + m.slot * 13;
    const retreat = !busy && mode !== 'victory' && !b.practice && !(m.boss && (mode === 'waiting' || b.finisher));
    m.walking = false;
    m.flip = retreat;
    if (retreat) {
      m.x += m.boss ? 1 : 0.8; m.walking = true; m.windup = 0;
      if (m.boss && !m.fled) { m.fled = true; floater(m.x, m.y - 8, 'The boss retreats…', [200, 190, 220]); }
    } else if ((busy || b.practice || m.boss) && m.x > stop && !b.finisher) {
      const sp = m.boss && m.entering ? 1.2 : def.speed * 1.7;
      m.x = Math.max(stop, m.x - sp * (m.frozen > 0 ? 0.3 : 1));
      m.walking = true;
    } else if (m.boss) m.entering = false;
    if (def.fly) m.y = m.baseY + Math.sin((m.at + m.seed * 5) * 0.25) * 3;
    if (m.kb) { m.x += m.kb; m.kb *= 0.55; if (Math.abs(m.kb) < 0.2) m.kb = 0; }
    if (!m.boss) {
      if (m.windup > 0) { m.windup--; if (!m.windup) m.lunge = 6; }
      else if (m.lunge > 0) {
        m.x += m.lunge > 3 ? -2.5 : 2.5;
        m.lunge--;
        if (m.lunge === 3 && m.x - heroX < 40) {
          const guard = b.shield || m.taunt > 0;
          emit(5, heroX + 14, ui.heroY + 12, guard ? [[140, 200, 255], [255, 255, 255]] : [[255, 90, 80], [255, 255, 255]], { spread: 0.9, up: 1.1, life: 8 });
          if (guard) b.shieldFlash = 5;
        }
      } else if (busy && !(m.frozen > 0) && m.x <= stop + 1 && (m.at + m.seed * 9) % 40 === 0) m.windup = 5;
    } else if (busy && !m.entering && !b.finisher) stepBoss(m, d, heroX, floorY);
    if (m.flash > 0) m.flash--;
    if (m.frozen > 0) m.frozen--;
    if (m.shock > 0) m.shock--;
    if (m.taunt > 0) m.taunt--;
    if (m.boss) m.lag = Math.max(m.hp, (m.lag == null ? m.hp : m.lag) - Math.max(0.5, ((m.lag || 0) - m.hp) * 0.08));
    // Elemental damage over time.
    if (m.burn > 0) {
      m.burn--;
      if (m.burn % 6 === 0) hitMonster(m, m.burnDmg || 1, [255, 150, 60], { dot: true });
      if (m.burn % 2 === 0) emit(1, m.x + Math.random() * mw, m.y + Math.random() * mh * 0.6, [[255, 210, 90], [255, 120, 40]], { spread: 0.3, up: 0.8, grav: -0.03, life: 8 });
    }
    if (m.curse > 0 && m.hp > 0) {
      m.curse--;
      if (m.curse % 8 === 0) hitMonster(m, m.curseDmg || 1, [200, 120, 255], { dot: true });
      if (m.curse % 3 === 0) emit(1, m.x + Math.random() * mw, m.y + mh * 0.3, [[170, 80, 230], [90, 40, 140]], { spread: 0.2, up: 0.5, grav: -0.02, life: 10 });
    }
  });
  b.monsters = b.monsters.filter((m) => (m.hp > 0 || (m.dieT || 0) < MON.deathTicks(m)) && m.x < W + 60);

  // Coins fly to the hero and are banked.
  b.coins = b.coins.filter((c) => {
    const dx = ui.heroX + 8 - c.x, dy = ui.heroY + 10 - c.y, dist = Math.hypot(dx, dy);
    if (!frozen) {
      c.age++;
      if (c.age > 12 && dist < 3) { b.gold += c.v; ui.dirty = true; return false; }
      if (c.age <= 12) { c.x += c.vx; c.y += c.vy; c.vy += 0.2; if (c.y > floorY - 2) { c.y = floorY - 2; c.vy *= -0.5; } }
      else { c.x += dx / dist * 2.5; c.y += dy / dist * 2.5; }
    }
    pc.set(c.x, c.y, (t + c.age) % 4 < 2 ? [255, 220, 90] : [255, 250, 190]);
    return true;
  });

  // Projectiles home in on their target.
  if (frozen) return;
  b.shots = b.shots.filter((s) => {
    const tgt = s.target.hp > 0 ? s.target : aliveMonsters()[0];
    if (!tgt) return false;
    s.target = tgt;
    const [tx, ty] = center(tgt);
    const dx = tx - s.x, dy = ty - s.y, dist = Math.hypot(dx, dy);
    if (dist < 3) {
      const id = s.spell.id;
      if (s.spell.aoe) {
        const hit = aliveMonsters().filter((m) => Math.abs(m.x - tgt.x) < s.spell.aoe || m === tgt);
        for (const m of hit) {
          if (id === 'fireball' || id === 'meteor') { m.burn = 30; m.burnDmg = Math.max(1, Math.round(s.dmg * 0.12)); }
          hitMonster(m, s.dmg, s.color);
        }
        emit(id === 'meteor' ? 34 : id === 'blast' ? 10 : 18, tx, ty, [s.color, [255, 230, 120], [255, 255, 255]], { spread: 2, up: 2.4 });
        if (id === 'meteor') { shakeFor(b, 6); stopFor(b, 3); b.rings.push({ x: tx, y: floorY, r: 3, life: 9, c: [255, 160, 80] }); }
      } else {
        if (id === 'frost') { tgt.frozen = tgt.boss ? 20 : 40; emit(8, tx, ty, [[200, 245, 255], [140, 230, 255], [255, 255, 255]], { spread: 1.4, up: 1.4, life: 12 }); }
        if (id === 'curse') { tgt.curse = 40; tgt.curseDmg = Math.max(1, Math.round(s.dmg * 0.5)); }
        hitMonster(tgt, s.dmg, s.color, { critChance: s.critChance });
        emit(5, tx, ty, [s.color, [255, 255, 255]], { spread: 1, up: 1.2 });
      }
      return false;
    }
    s.x += (dx / dist) * s.speed; s.y += (dy / dist) * s.speed;
    return true;
  });
}

// ---------- drawing ----------

function drawShots(pc) {
  const b = ui.battle, t = ui.tick;
  for (const s of b.shots) {
    const x = Math.round(s.x), y = Math.round(s.y), id = s.spell.id;
    if ((id === 'basic' || id === 'arrow') && s.cls === 'ranger') { for (let i = 0; i < 5; i++) pc.set(x - i, y, i === 0 ? [220, 220, 230] : s.color); pc.set(x - 4, y - 1, [230, 230, 240]); continue; }
    if ((id === 'basic' || id === 'ally') && s.cls === 'knight') { for (let j = -2; j <= 2; j++) pc.set(x - Math.abs(j), y + j, s.color); pc.glow(x, y, 4, s.color, 0.3); continue; }
    if ((id === 'basic' || id === 'note') && s.cls === 'bard') { pc.label(Math.floor(x), Math.floor(y / 2), (t >> 2) % 2 ? '♪' : '♫', s.color); continue; }
    if (id === 'curse') {
      for (let k = 0; k < 5; k++) pc.set(x - k, y + Math.round(Math.sin((t + k) * 0.9) * 1.5), X.shade(s.color, 1 - k * 0.15));
      pc.set(x, y, [240, 200, 255]); pc.glow(x, y, 5, s.color, 0.45);
      continue;
    }
    const r = id === 'meteor' ? 2 : id === 'fireball' ? 1.5 : 1;
    for (let j = -r; j <= r; j++) for (let i = -r; i <= r; i++) if (i * i + j * j <= r * r + 0.5) pc.set(x + i, y + j, X.mix(s.color, [255, 255, 255], 0.3));
    for (let k = 1; k < (id === 'meteor' ? 8 : 4); k++) pc.set(x - k * (id === 'meteor' ? 0.7 : 1), y - (id === 'meteor' ? k : 0) + (id === 'fireball' ? Math.round(Math.sin(t + k)) : 0), X.shade(s.color, 1 - k * 0.12));
    if (id === 'frost') { pc.set(x, y - 2, [230, 250, 255]); pc.set(x, y + 2, [230, 250, 255]); pc.set(x + 2, y, [230, 250, 255]); }
    pc.glow(x, y, id === 'meteor' ? 10 : 5, s.color, 0.4);
  }
  for (const bo of b.bolts) {
    const [x1, y1] = bo.from, [x2, y2] = bo.to;
    const n = Math.max(1, Math.ceil(Math.hypot(x2 - x1, y2 - y1)));
    let jitter = 0;
    for (let i = 0; i <= n; i++) {
      if (i % 3 === 0) jitter = Math.round((Math.random() - 0.5) * 4);
      const px = x1 + (x2 - x1) * i / n, py = y1 + (y2 - y1) * i / n + jitter;
      pc.set(px, py, i % 2 ? [255, 255, 255] : [150, 210, 255]);
      // Forked branches.
      if (i % 7 === 3) for (let k = 1; k < 4; k++) pc.set(px + k * 0.7, py + (jitter > 0 ? k : -k), [150, 210, 255]);
    }
    pc.glow(x2, y2, 7, [150, 210, 255], 0.55);
    bo.life--;
  }
  b.bolts = b.bolts.filter((bo) => bo.life > 0);
  // Rogue dash streaks and slash arcs.
  for (const ds of b.dashes || []) {
    if (ds.tx == null) continue;
    const k = ds.t <= 4 ? ds.t / 4 : 1 - (ds.t - 4) / 5;
    const px = ds.x0 + (ds.tx - ds.x0) * k, py = ds.y0 + (ds.ty - ds.y0) * k * 0.5;
    for (let i = 0; i < 10; i++) pc.set(px - i * (ds.t <= 4 ? 1 : -1), py + (i % 3) - 1, X.mix([60, 200, 180], [30, 30, 40], i / 10));
    pc.rect(px - 1, py - 3, 3, 6, [40, 44, 56]); pc.set(px, py - 3, [120, 220, 200]);
    if (ds.t >= 4 && ds.t <= 6) for (let a = -3; a <= 3; a++) pc.set(ds.tx + 3 + Math.abs(a) * 0.5, ds.ty + a, [220, 255, 240]);
  }
}

// Extra battle HUD drawn over the scene: boss bar, slam warnings, finisher,
// shock rings and the knight's shield. Pixel coords.
function drawBattleOverlay(pc, pal, d) {
  const b = ui.battle, W = pc.w, H = pc.h, t = ui.tick;
  const floorY = b.floorY || H - 10;

  // Shockwave rings along the floor.
  b.rings = (b.rings || []).filter((r) => {
    r.r += 3; r.life--;
    const a = Math.max(0, r.life / 10);
    for (let k = 0; k < 48; k++) {
      const ang = (k / 48) * Math.PI * 2;
      const x = r.x + Math.cos(ang) * r.r, y = r.y + Math.sin(ang) * r.r * 0.22;
      if (x >= 0 && x < W && y >= 0 && y < H) pc.set(x, y, X.mix(pc.get(x, y), r.c, 0.7 * a));
    }
    return r.life > 0;
  });

  // Knight shield bubble around the hero.
  if (b.shield && ui.heroX) {
    const cx = ui.heroX + 8, cy = ui.heroY + 12, f = (b.shieldFlash || 0) > 0;
    if (f) b.shieldFlash--;
    for (let k = 0; k < 40; k++) {
      const ang = (k / 40) * Math.PI * 2;
      if (!f && (k + (t >> 1)) % 4) continue;
      const x = cx + Math.cos(ang) * 12, y = cy + Math.sin(ang) * 14;
      if (x >= 0 && x < W && y >= 0 && y < H) pc.set(x, y, X.mix(pc.get(x, y), [150, 210, 255], f ? 0.85 : 0.45));
    }
    if (f) pc.glow(cx, cy, 14, [150, 210, 255], 0.2);
  }

  const boss = b.monsters.find((m) => m.boss && (m.hp > 0 || (m.dieT || 0) < 12));
  if (boss) {
    const def = MON.MONSTERS[boss.type];
    const [bw0, bh0] = size(boss);
    // Slam telegraph: the floor between boss and hero pulses red.
    if (boss.slam && boss.slam.t <= (boss.enraged ? 10 : 14)) {
      const a = 0.25 + 0.25 * Math.sin(t * 1.5);
      for (let x = Math.max(0, Math.round(ui.heroX) - 6); x < Math.min(W, boss.x + bw0 + 4); x++) for (let y = floorY; y < Math.min(H, floorY + 3); y++) pc.set(x, y, X.mix(pc.get(x, y), [255, 50, 40], a));
      if (t & 2) pc.label(Math.round(boss.x + bw0 / 2), Math.max(1, Math.floor((boss.y + (boss.yOff || 0) - 6) / 2)), '!', [255, 80, 60], true);
    }
    // Enrage: pulsing red vignette at the scene edges.
    if (boss.enraged && boss.hp > 0) {
      const a = 0.18 + 0.1 * Math.sin(t * 0.5);
      for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
        const e = Math.min(x, W - 1 - x, y * 2, (H - 1 - y) * 2);
        if (e < 8) pc.set(x, y, X.mix(pc.get(x, y), [200, 20, 20], a * (1 - e / 8)));
      }
    }
    // Big boss HP bar along the bottom of the scene.
    const bw = Math.max(24, Math.min(W - 8, Math.floor(W * 0.62))), bx = Math.floor((W - bw) / 2);
    const by = (H - 4) & ~1;
    const ratio = Math.max(0, boss.hp / boss.max), lag = Math.max(ratio, (boss.lag == null ? boss.hp : boss.lag) / boss.max);
    const fill = boss.enraged ? X.mix([230, 40, 30], [255, 140, 40], 0.5 + 0.5 * Math.sin(t * 0.6)) : [214, 48, 56];
    const K = [16, 12, 22];
    for (let i = -1; i <= bw; i++) { pc.set(bx + i, by - 1, K); pc.set(bx + i, by + 2, K); }
    for (let j = 0; j < 2; j++) { pc.set(bx - 1, by + j, K); pc.set(bx + bw, by + j, K); }
    for (let i = 0; i < bw; i++) for (let j = 0; j < 2; j++) {
      const f = i / bw;
      const c = f < ratio ? X.shade(fill, j ? 0.72 : 1.05) : f < lag ? [255, 236, 190] : [44, 30, 42];
      pc.set(bx + i, by + j, c);
    }
    for (const mark of [0.7, 0.4]) { const mx = bx + Math.round(bw * mark); pc.set(mx, by, K); pc.set(mx, by + 1, K); }
    const title = `${def.name}${boss.enraged && boss.hp > 0 ? ' · ENRAGED' : ''}`;
    const hpTxt = `${Math.max(0, boss.hp)}/${boss.max}`;
    const row = by / 2 - 1;
    pc.label(bx, row, title.slice(0, Math.max(0, bw - hpTxt.length - 1)), boss.enraged ? [255, 120, 90] : [255, 226, 200], true);
    pc.label(bx + bw - hpTxt.length, row, hpTxt, [230, 214, 220]);
    void bh0;
  }

  // Finisher: a pillar of light crashing down on the boss.
  if (b.finisher) {
    const f = b.finisher, m = f.m;
    const [w, h] = size(m);
    const cx = m.x + w / 2, half = Math.min(w / 2 + 2, f.t * 1.5), bottom = Math.min(H, m.y + h);
    const reach = Math.min(1, f.t / 6) * bottom;
    for (let y = 0; y < reach; y++) for (let x = Math.floor(cx - half); x <= cx + half; x++) {
      if (x < 0 || x >= W) continue;
      const e = Math.abs(x - cx) / Math.max(1, half);
      pc.set(x, y, X.mix(pc.get(x, y), e < 0.35 ? [255, 255, 255] : [255, 220, 110], (1 - e) * 0.85));
    }
    pc.glow(cx, bottom - 4, 16, [255, 230, 150], 0.5);
  }
}

module.exports = { drawBattleOverlay, emit, floater, spawnWave, hitMonster, aliveMonsters, COOLDOWN, playerCast, cast, stepBattle, drawShots, allyClass };
