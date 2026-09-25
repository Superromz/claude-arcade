'use strict';
// Battle system: waves, biome rosters, bosses for long tasks, spells,
// companions, projectiles, loot and battle juice (hit-stop, crits, combos,
// elemental effects). Drives ui.battle.

const L = require('./lib');
const X = require('./pixel');
const C = require('./character');
const MON = require('./monsters');
const S = require('./skills');
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

// Expected hero power at a level for a sensible build: damage growth,
// main stat from typical usage, skill-tree points and attack speed.
function heroPower(lvl) {
  const stat = 10 + 3.7 * lvl;
  const tree = 1 + 0.02 * Math.min(lvl, 32) + 0.01 * Math.max(0, lvl - 32);
  const every = Math.max(6, Math.round(24 - lvl * 1.2));
  return (1 + (lvl - 1) * 0.12) * (1 + stat / 60) * tree / every;
}
// Monster HP scale: each biome's roster is tuned for its first level; past
// that, HP grows with the hero so a normal monster still takes 2-5 s.
const BIOME_START = [1, 5, 10, 15];
function hpScale(lvl) {
  const start = [...BIOME_START].reverse().find((l) => lvl >= l) || 1;
  return Math.max(1, heroPower(lvl) / heroPower(start));
}
// Waves can't be cleared faster than this, so a stronger build never
// speeds up kill XP beyond the pace of real work.
const MIN_WAVE_TICKS = 60;

function spawnWave(W, floorY, lvl) {
  const b = ui.battle;
  b.wave += 1;
  const biome = biomeFor(lvl), bi = Math.max(0, (BIOMES || []).indexOf(biome));
  const roster = rosterFor(lvl);
  const elite = b.wave % 5 === 0;
  const n = elite ? 3 : Math.min(6, 2 + Math.floor(b.wave / 2));
  const scale = 1 + Math.min(0.8, (b.wave - 1) * 0.08);
  const lvlScale = hpScale(lvl);
  b.nextWaveAt = ui.tick + MIN_WAVE_TICKS;
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
    const goldHp = Math.round(def.hp * scale * (isElite ? 3 : 1));
    const hp = Math.round(goldHp * lvlScale);
    const y = def.fly ? floorY - 26 - (i % 2) * 6 : floorY - h;
    b.monsters.push({
      type, boss: false, elite: isElite, lvl: Math.max(1, lvl + Math.floor(b.wave / 3) - 1), xp: Math.max(1, Math.round((budget * weights[i]) / sum)),
      hp, max: hp, goldHp, color: b.wave + i, seed: i, x: W - 8 + i * 14, slot: i, y, baseY: y, floorY, flash: 0, frozen: 0, lunge: 0, windup: 0, kb: 0, at: i * 3,
    });
  });
}

function spawnBoss(d, W, floorY) {
  const b = ui.battle;
  const biome = biomeFor(d.lvl);
  b.bossHistory ||= [];
  const type = MON.pickBoss(biome, b.bossHistory, d.lvl);
  b.bossHistory = [...b.bossHistory, type].slice(-6);
  const returning = MON.bossBiome(type) !== biome;
  const def = MON.MONSTERS[type];
  // Draw the boss at 2x when the scene has room for it beside the hero.
  const [fw] = size({ type, boss: true, scale: 1 });
  const scale = W - ((ui.heroX || W * 0.2) + 22) >= fw * 2 + 2 ? 2 : 1;
  const [, h] = size({ type, boss: true, scale });
  const stat = d.stats[(C.CLASSES[d.hero.cls] || C.CLASSES.mage).stat] || 10;
  // Sized to last roughly a minute or two against the hero and party.
  // Guild recruits count at half weight; the skill tree is expected to grow.
  const allies = Object.values((d.ses && d.ses.party) || {}).reduce((n, p) => n + (p && p.guild ? 0.5 : 1), 0);
  const tree = 1 + 0.02 * Math.min(d.lvl, 32);
  const hp = Math.round(((def.hp * C.damage(C.kitFor(d.hero.cls)[0], d.lvl, stat)) / 6) * (1 + d.lvl * 0.06) * tree * (1 + Math.min(4, allies) * 0.3) * (returning ? 1.2 : 1));
  const xp = Math.min(150, Math.max(50, Math.round(def.xp * 0.6 + d.lvl * 3)));
  b.monsters.push({
    type, boss: true, scale, lvl: d.lvl + (returning ? 4 : 2), xp, hp, max: hp, lag: hp, color: 0, seed: 0, x: W + 2, slot: 0, y: floorY - h, baseY: floorY - h, floorY,
    flash: 0, frozen: 0, lunge: 0, windup: 0, kb: 0, yOff: 0, at: 0, phase: 0, slamAt: ui.tick + 55, entering: true,
  });
  ui.celebrate = { kind: 'bossIntro', text: returning ? `${def.name} returns for a rematch!` : `${def.name} approaches!`, until: ui.tick + 30 };
  shakeFor(b, 6);
  try { L.logEvent({ sid: d.sid, kind: 'combo', text: `A boss appears: ${def.name}!${def.flavor ? ' ' + def.flavor : ''}` }); } catch {}
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
  m.curseT = m.curse > 0 ? m.curseT || m.curse : 0;
  m.hp = 0; m.dieT = 0; m.windup = 0; m.lunge = 0; m.burn = 0; m.curse = 0; m.frozen = 0; m.slam = null; m.yOff = 0;
  m.stun = 0; m.poison = 0; m.bleed = 0; m.doom = 0; m.mark = 0; m.rooted = 0;
  b.kills += 1;
  ui.dirty = true;
  b.combo = t - (b.lastKillT == null ? -99 : b.lastKillT) <= COMBO_WINDOW ? (b.combo || 0) + 1 : 1;
  b.lastKillT = t;
  const [mw, mh] = size(m);
  let value = m.boss ? 40 + m.lvl * 2 : (m.elite ? 5 : 0) + 1 + ((m.goldHp || m.max) >> 3);
  if (b.combo >= 3) value += b.combo - 2;
  value = Math.round(value * require('./items').goldMultiplier() * (1 + ((ui.skillMods && ui.skillMods.gold) || 0)));
  for (let i = 0; i < Math.min(8, value); i++) b.coins.push({ x: m.x + mw / 2, y: m.y, vx: (Math.random() - 0.5) * 2, vy: -1.5 - Math.random() * 1.5, v: i === 0 ? value - Math.min(8, value) + 1 : 1, age: 0 });
  if (!b.practice) { ui.xpPending = (ui.xpPending || 0) + m.xp; if (!m.boss) b.waveXp = (b.waveXp || 0) + m.xp; }
  floater(m.x + mw / 2 - 3, m.y - 12, b.practice ? `+${value}◉` : `+${m.xp} XP`, [255, 214, 80], true);
  emit(m.boss ? 40 : 8, m.x + mw / 2, m.y + mh / 2, [[255, 214, 80], [255, 255, 255], [255, 150, 60]], { spread: m.boss ? 2.4 : 1.6, up: 2.6 });
  deathFx(m);
  if (b.combo >= 2) comboPop(b.combo);
  stopFor(b, m.elite ? 3 : 1);
  if (m.curseT > 0 && ui.skillMods && ui.skillMods.flags.curseSpread) {
    const next = aliveMonsters().filter((o) => o !== m && !(o.curse > 0)).sort((a, c) => Math.abs(a.x - m.x) - Math.abs(c.x - m.x))[0];
    if (next) { next.curse = m.curseT; next.curseDmg = m.curseDmg; next.curseT = m.curseT; floater(next.x, next.y - 8, 'PLAGUE', [200, 120, 255], true); }
  }
  if (m.boss) {
    // Saved as state.game.bosses (achievements); each boss is a skill point.
    b.bosses = (b.bosses || 0) + 1;
    floater(m.x + mw / 2 - 5, m.y - 18, '+1 SKILL POINT', [140, 220, 255], true);
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
  const b = ui.battle, M = ui.skillMods;
  if (m.mark > 0) dmg *= 1.5;
  if (M && M.flags.shatter && m.frozen > 0) dmg *= 1 + M.flags.shatter;
  const cc = (o.critChance || 0.15) + (M ? M.crit : 0) + (b.anthemCrit && anthemOn() ? 0.15 : 0);
  const crit = !o.dot && !o.noCrit && (o.crit || Math.random() < cc);
  dmg = Math.max(1, Math.round(crit ? dmg * (M && M.flags.critX3 ? 3 : 2) : dmg));
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

// ---------- skills ----------

// Hotbar cooldowns in ticks for every class skill (ids are unique across
// classes). Skill-tree cooldown reduction is applied on cast; ui.cdLen keeps
// the real length so the hotbar sweep matches.
const COOLDOWN = Object.fromEntries(Object.values(C.KITS).flat().map((s) => [s.id, s.cd]));

const modsOf = (d) => { try { return (ui.skillMods = S.mods(d)); } catch { return ui.skillMods || S.mods({}); } };

// Player-cast skill from the hotbar (slot 0 = basic attack).
function playerCast(d, slot) {
  C.setClass(d.hero.cls);
  const spell = C.kitFor(d.hero.cls)[slot];
  if (!spell || spell.lvl > d.lvl) return floater(ui.heroX, ui.heroY - 4, spell ? `Lv ${spell.lvl}` : '', [180, 170, 200]);
  if ((ui.cooldowns[spell.id] || 0) > ui.tick) return;
  if (!aliveMonsters().length) return floater(ui.heroX, ui.heroY - 4, 'no target — press w', [180, 170, 200]);
  const len = modsOf(d).cd(spell.id, spell.cd);
  (ui.cdLen ||= {})[spell.id] = len;
  ui.cooldowns[spell.id] = ui.tick + len;
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
const anthemOn = () => (ui.battle.anthem || 0) > ui.tick;

const BASIC_COLOR = { mage: [255, 230, 110], ranger: [200, 150, 90], knight: [235, 240, 255], warlock: [160, 70, 220], bard: [255, 160, 210], rogue: [200, 205, 220] };
const SKILL_COLOR = {
  fireball: [255, 140, 40], frost: [140, 230, 255], chain: [180, 220, 255], meteor: [255, 110, 40], starfall: [255, 240, 180],
  multishot: [220, 190, 120], snare: [190, 170, 140], pierce: [240, 240, 255], rain: [210, 180, 120], eagle: [240, 220, 170],
  bash: [150, 200, 255], taunt: [120, 190, 255], whirl: [235, 240, 255], holy: [255, 236, 150], judgment: [255, 220, 110],
  curse: [180, 90, 240], drain: [230, 60, 90], imp: [255, 130, 50], shadowflame: [150, 60, 220], doom: [120, 40, 160],
  anthem: [255, 200, 90], discord: [255, 110, 170], echo: [200, 170, 255], crescendo: [255, 170, 220], encore: [255, 214, 80],
  backstab: [220, 80, 80], poison: [120, 220, 90], smoke: [150, 150, 170], shadowstep: [120, 220, 200], deathmark: [230, 50, 60],
};

// Hit a monster with a skill and apply its tree on-hit effects.
function strike(m, dmg, color, sk, M, o = {}) {
  if (!m || m.hp <= 0) return;
  const id = sk.id;
  if (M.has(id, 'burn')) { m.burn = 30; m.burnDmg = Math.max(1, Math.round(dmg * 0.12 * (1 + M.dot))); }
  if (M.has(id, 'bleed')) { m.bleed = 40; m.bleedDmg = Math.max(1, Math.round(dmg * 0.1 * (1 + M.dot))); }
  if (M.has(id, 'stun')) stun(m, 18);
  if (M.has(id, 'lifesteal')) healHero(1);
  hitMonster(m, dmg, color, o);
}
function stun(m, n) {
  if (!m || m.hp <= 0) return;
  m.stun = Math.max(m.stun || 0, Math.round(m.boss ? n / 2 : n));
  m.windup = 0; m.lunge = 0;
}
// Drain Life and lifesteal heal the hero's HP (saved in batches).
function healHero(n) { ui.battle.healPending = Math.min(20, (ui.battle.healPending || 0) + n); }
const fx = (o) => (ui.battle.fx ||= []).push({ t: 0, ...o });

// Cast the skill matching the current tool activity.
function cast(d, mode, origin, pal, forced, boost = 1, auto = false) {
  const b = ui.battle;
  const targets = aliveMonsters().sort((a, c) => a.x - c.x);
  if (!targets.length) return;
  C.setClass(d.hero.cls);
  const M = modsOf(d);
  let spell = forced || C.spellFor(d.lvl, mode, ui.tick + b.kills, d.hero.cls);
  // Auto-attacks only use a skill when its (hidden) cooldown is up; tool
  // calls always cast their skill.
  b.autoCd ||= {};
  if (auto && !forced && spell.id !== 'basic') {
    if ((b.autoCd[spell.id] || 0) > ui.tick) spell = C.kitFor(d.hero.cls)[0];
  }
  if (spell.id !== 'basic') b.autoCd[spell.id] = ui.tick + M.cd(spell.id, spell.cd);
  // Echo plays your last skill (or last two) again.
  if (spell.echo) {
    const kit = C.kitFor(d.hero.cls);
    const last = (b.lastSkills || []).map((id) => kit.find((s) => s.id === id)).filter(Boolean);
    const replay = last.slice(-(M.flags.doubleEcho ? 2 : 1));
    fx({ kind: 'echo', x: ui.heroX + 8, y: ui.heroY + 8, life: 12 });
    floater(ui.heroX, ui.heroY - 6, 'ECHO!', SKILL_COLOR.echo, true);
    ui.heroAction = { kind: 'cast', spell: 'echo', t: ui.tick };
    const bst = boost * 0.8 * (1 + (M.dmg.echo || 0));
    if (!replay.length) replay.push(kit[0]);
    replay.forEach((sk, i) => (i ? (b.queued ||= []).push({ at: ui.tick + 6, d, mode, origin, pal, sk, boost: bst }) : cast(d, mode, origin, pal, { ...sk, echoed: true }, bst)));
    return;
  }
  const stat = d.stats[(C.CLASSES[d.hero.cls] || C.CLASSES.mage).stat] || 10;
  const buff = (inspired(d) ? 1.2 : 1) * (anthemOn() ? 1.25 + (M.flags.anthemBoost || 0) : 1);
  const dmg = Math.max(1, Math.round(C.damage(spell, d.lvl, stat) * boost * buff * require('./items').damageMultiplier() * M.mult(spell.id, mode)));
  if (!spell.echoed && spell.id !== 'basic') { b.lastSkills = [...(b.lastSkills || []), spell.id].slice(-2); }
  // Tell the hero animation what was just cast.
  ui.heroAction = { kind: spell.id === 'basic' || spell.dash ? 'swing' : 'cast', spell: spell.id, t: ui.tick };
  useSkill(d, spell, dmg, origin, pal, M, targets);
}

function useSkill(d, sk, dmg, origin, pal, M, targets) {
  const b = ui.battle, id = sk.id, t = ui.tick;
  const [ox, oy] = origin;
  const target = targets[0];
  const color = id === 'basic' ? BASIC_COLOR[d.hero.cls] || pal.magic : SKILL_COLOR[id] || pal.magic;
  const extra = M.targets[id] || 0;
  const shoot = (tgt, o = {}) => b.shots.push({ x: ox, y: oy, spell: sk, dmg, target: tgt, speed: 2.4, color, cls: d.hero.cls, ...o });
  const heroCx = ui.heroX + 8, floorY = b.floorY || ui.heroY + 24;
  const near = (px) => targets.filter((m) => m.x <= ui.heroX + 22 + px);
  const within = (cx, r) => targets.filter((m) => Math.abs(center(m)[0] - cx) <= r);
  switch (id) {
    // ----- mage -----
    case 'fireball': return shoot(target, { speed: 1.6 });
    case 'frost': {
      const [cx, cy] = center(target);
      fx({ kind: 'nova', x: cx, y: cy, life: 10, color });
      for (const m of within(cx, sk.nova)) {
        m.frozen = Math.round((m.boss ? 20 : sk.freeze) * M.durMult('frost'));
        strike(m, dmg, color, sk, M);
      }
      return;
    }
    case 'chain': {
      let from = [ox, oy];
      for (const m of targets.slice(0, sk.chain + extra)) {
        const to = center(m);
        b.bolts.push({ from, to, life: 5 });
        m.shock = 6;
        emit(5, to[0], to[1], [[255, 255, 255], [150, 210, 255]], { spread: 1.4, up: 1.4, life: 8 });
        strike(m, dmg, color, sk, M);
        from = to;
      }
      return;
    }
    case 'meteor': return b.shots.push({ x: target.x - 30, y: -6, spell: sk, dmg, target, speed: 1.8, color, cls: d.hero.cls });
    case 'starfall': {
      for (const m of targets) b.shots.push({ x: m.x + Math.random() * 6 - 10, y: -4, spell: sk, dmg, target: m, speed: 2.2, color });
      if (M.flags.starfallTwice) for (const m of targets) b.shots.push({ x: m.x + Math.random() * 6 - 14, y: -26, spell: sk, dmg, target: m, speed: 2.2, color: [220, 200, 255] });
      return;
    }
    // ----- ranger -----
    case 'multishot': {
      const n = sk.targets + extra;
      for (let i = 0; i < n; i++) shoot(targets[i % targets.length], { y: oy + (i - (n - 1) / 2) * 2, speed: 3.4 });
      return;
    }
    case 'snare': {
      const [cx] = center(target);
      fx({ kind: 'trap', x: cx, y: target.floorY || floorY, life: 16, target, dmg, sk });
      return;
    }
    case 'pierce': return fx({ kind: 'pierce', x: ox, y: oy + 2, life: 60, dmg, sk, hit: [] });
    case 'rain': {
      const [cx] = center(target);
      const volleys = sk.volleys + extra;
      fx({ kind: 'rain', x: cx, r: M.flags.rainAll ? 999 : sk.aoe, life: volleys * 4 + 6, volleys, dmg, sk });
      return;
    }
    case 'eagle': return fx({ kind: 'eagle', x: -10, y: Math.max(4, target.y - 6), life: 60, dmg, sk, hit: [] });
    // ----- knight -----
    case 'bash': {
      for (const m of targets.slice(0, 1 + extra)) {
        const [cx, cy] = center(m);
        fx({ kind: 'bash', x: cx, y: cy, life: 8, color });
        stun(m, sk.stun * M.durMult('bash'));
        m.kb = (m.kb || 0) + 4;
        strike(m, dmg, color, sk, M);
      }
      shakeFor(b, 3);
      return;
    }
    case 'taunt': {
      fx({ kind: 'shout', x: heroCx, y: ui.heroY + 10, life: 12, color });
      floater(ui.heroX, ui.heroY - 8, 'TAUNT!', color, true);
      b.shieldFlash = 10;
      for (const m of targets) { m.taunt = Math.round(sk.taunt * M.durMult('taunt')); strike(m, dmg, color, sk, M, { noCrit: true }); }
      return;
    }
    case 'whirl': {
      const spins = M.flags.bladestorm ? 2 : 1;
      fx({ kind: 'whirl', x: heroCx, y: ui.heroY + 12, life: 9 * spins, spins, dmg, sk, r: sk.near });
      return;
    }
    case 'holy': return fx({ kind: 'pillar', target, life: 12, dmg, sk, color });
    case 'judgment': {
      targets.forEach((m, i) => fx({ kind: 'hammer', target: m, life: 14 + i * 2, delay: i * 2, dmg: M.flags.judgmentBoss && m.boss ? dmg * 2 : dmg, sk, color }));
      return;
    }
    // ----- warlock -----
    case 'curse': return shoot(target, { speed: 1.8 });
    case 'drain': {
      const heal = sk.heal + M.heal;
      for (const m of targets.slice(0, 1 + extra)) {
        fx({ kind: 'beam', target: m, life: 12, color });
        strike(m, dmg, color, sk, M);
      }
      healHero(heal);
      floater(ui.heroX + 2, ui.heroY - 6, `+${heal} HP`, [120, 230, 120], true);
      return;
    }
    case 'imp': {
      const life = Math.round(sk.imp * M.durMult('imp'));
      const n = M.flags.twinImps ? 2 : 1;
      b.imps = (b.imps || []).filter((im) => im.t < im.life).slice(-2);
      for (let i = 0; i < n; i++) b.imps.push({ t: 0, life, i: b.imps.length, dmg: Math.max(1, Math.round(dmg * 0.5)), sk });
      emit(18, heroCx - 8, ui.heroY + 6, [[255, 130, 50], [255, 220, 120], [120, 30, 30]], { spread: 1.4, up: 1.8 });
      floater(ui.heroX - 4, ui.heroY - 6, n > 1 ? 'IMPS!' : 'IMP!', color, true);
      return;
    }
    case 'shadowflame': {
      const [cx] = center(target);
      fx({ kind: 'cone', x: ox, y: oy, tx: cx, life: 10, color });
      for (const m of within(cx, sk.aoe)) {
        m.burn = 36; m.burnDmg = Math.max(1, Math.round(dmg * 0.14 * (1 + M.dot))); m.burnC = [170, 90, 255];
        strike(m, dmg, color, sk, M);
      }
      return;
    }
    case 'doom': return shoot(target, { speed: 1.6 });
    // ----- bard -----
    case 'anthem': {
      b.anthem = t + Math.round(sk.anthem * M.durMult('anthem'));
      b.anthemCrit = !!M.flags.anthemCrit;
      fx({ kind: 'notes', x: heroCx, y: ui.heroY + 4, life: 18, color });
      floater(ui.heroX - 4, ui.heroY - 8, `ANTHEM +${Math.round((0.25 + (M.flags.anthemBoost || 0)) * 100)}%`, color, true);
      shoot(target, { speed: 2 });
      return;
    }
    case 'discord': {
      const [cx, cy] = center(target);
      const hit = M.flags.wallOfSound ? targets : within(cx, sk.aoe);
      fx({ kind: 'ring', x: cx, y: cy, life: 10, color, r: M.flags.wallOfSound ? 60 : sk.aoe });
      for (const m of hit) {
        const was = (m.stun || 0) > 0;
        stun(m, sk.stun * M.durMult('discord'));
        strike(m, M.flags.wallOfSound && was ? dmg * 2 : dmg, color, sk, M);
      }
      return;
    }
    case 'crescendo': return fx({ kind: 'wave', x: ox, y: oy, life: 30, dmg, sk, hit: [], reach: ui.heroX + 22 + sk.near + 40 });
    case 'encore': {
      for (const k of Object.keys(ui.cooldowns)) if (k !== 'encore' && k !== 'click') ui.cooldowns[k] = 0;
      floater(ui.heroX - 4, ui.heroY - 8, 'ENCORE!', color, true);
      for (const m of targets) b.shots.push({ x: m.x + Math.random() * 8 - 4, y: -4, spell: sk, dmg, target: m, speed: 2, color });
      return;
    }
    // ----- rogue -----
    case 'backstab': {
      (b.dashes ||= []).push({ id: 'hero', hero: true, x0: ox - 6, y0: oy + 2, target, t: 0, dmg, sk, crit: 0.15 + (sk.critBonus || 0) });
      return;
    }
    case 'poison': {
      const list = M.flags.pandemic ? targets : [target];
      for (const m of list) shoot(m, { speed: 2.6 });
      return;
    }
    case 'smoke': {
      const dur = Math.round(sk.dodge * M.durMult('smoke'));
      b.dodge = t + dur;
      fx({ kind: 'cloud', x: heroCx + 14, y: floorY - 6, life: dur, color });
      for (const m of near(sk.aoe + 10)) strike(m, dmg, color, sk, M);
      floater(ui.heroX, ui.heroY - 6, 'SMOKE!', [200, 200, 215], true);
      return;
    }
    case 'shadowstep': {
      const list = targets.slice(0, sk.targets + extra);
      list.forEach((m, i) => fx({ kind: 'step', target: m, life: 8, delay: i * 3, dmg, sk, color }));
      if (M.flags.stepReset) ui.cooldowns.backstab = 0;
      return;
    }
    case 'deathmark': return shoot(target, { speed: 2.6 });
    default: return shoot(target, { speed: d.hero.cls === 'ranger' ? 3.4 : 2.4 });
  }
}

// Timed skill effects: traps, beams, waves, eagles, imps and friends.
function stepFx(d, floorY) {
  const b = ui.battle, t = ui.tick, M = ui.skillMods || modsOf(d);
  b.queued = (b.queued || []).filter((q) => { if (t < q.at) return true; cast(q.d, q.mode, q.origin, q.pal, { ...q.sk, echoed: true }, q.boost); return false; });
  b.fx = (b.fx || []).filter((f) => {
    f.t++;
    const k = f.kind;
    if (k === 'trap' && f.t === 5) {
      const m = f.target;
      if (m && m.hp > 0) {
        m.frozen = Math.round((m.boss ? 20 : f.sk.root) * M.durMult('snare'));
        m.rooted = m.frozen;
        strike(m, f.dmg, SKILL_COLOR.snare, f.sk, M);
        emit(8, f.x, f.y - 2, [[200, 190, 170], [255, 255, 255]], { spread: 1.2, up: 1.2, life: 8 });
      }
    }
    if (k === 'pierce') {
      f.x += 5;
      for (const m of aliveMonsters()) {
        const [w] = size(m);
        if (!f.hit.includes(m) && f.x >= m.x && f.x - 5 <= m.x + w) { f.hit.push(m); strike(m, f.dmg, SKILL_COLOR.pierce, f.sk, M); }
      }
      if (f.x > (ui.sceneW || 200) + 4) return false;
    }
    if (k === 'rain' && f.t % 4 === 0 && f.t / 4 <= f.volleys) {
      for (const m of aliveMonsters().filter((mo) => Math.abs(center(mo)[0] - f.x) <= f.r)) strike(m, f.dmg, SKILL_COLOR.rain, f.sk, M, { critChance: 0.1 });
    }
    if (k === 'eagle') {
      f.x += 4; f.y += Math.sin(f.t * 0.4) * 0.8;
      for (const m of aliveMonsters()) {
        const [w] = size(m);
        if (!f.hit.includes(m) && f.x >= m.x && f.x - 4 <= m.x + w) {
          f.hit.push(m);
          strike(m, f.dmg, SKILL_COLOR.eagle, f.sk, M, { critChance: 0.15 + (f.sk.critBonus || 0) + M.crit });
          emit(6, f.x, center(m)[1], [[255, 255, 255], [240, 220, 170]], { spread: 1.4, up: 1.2, life: 8 });
        }
      }
      if (f.x > (ui.sceneW || 200) + 10) return false;
    }
    if (k === 'whirl' && f.t % 9 === 3) {
      for (const m of aliveMonsters().filter((mo) => mo.x <= ui.heroX + 22 + f.r)) strike(m, f.dmg, SKILL_COLOR.whirl, f.sk, M);
      shakeFor(b, 2);
    }
    if (k === 'pillar' && f.t === 4 && f.target.hp > 0) { strike(f.target, f.dmg, f.color, f.sk, M); shakeFor(b, 3); const [cx] = center(f.target); b.rings.push({ x: cx, y: f.target.floorY || floorY, r: 2, life: 8, c: [255, 236, 150] }); }
    if (k === 'hammer' && f.t === f.delay + 6 && f.target.hp > 0) {
      stun(f.target, f.sk.stun * M.durMult('judgment'));
      strike(f.target, f.dmg, f.color, f.sk, M);
      const [cx, cy] = center(f.target);
      emit(10, cx, cy, [[255, 240, 180], [255, 214, 80], [255, 255, 255]], { spread: 1.8, up: 1.6, life: 10 });
      shakeFor(b, 2);
    }
    if (k === 'wave') {
      f.x += 3;
      for (const m of aliveMonsters()) if (!f.hit.includes(m) && f.x >= m.x && m.x <= f.reach) { f.hit.push(m); strike(m, f.dmg, SKILL_COLOR.crescendo, f.sk, M); }
      if (f.x > Math.min(f.reach, (ui.sceneW || 200))) return false;
    }
    if (k === 'step' && f.t === f.delay + 2 && f.target.hp > 0) {
      strike(f.target, f.dmg, f.color, f.sk, M, { critChance: 0.3 });
      const [cx, cy] = center(f.target);
      emit(10, cx, cy, [[120, 220, 200], [30, 30, 40], [255, 255, 255]], { spread: 1.6, up: 1.4, life: 10 });
    }
    return f.t < f.life + (f.delay || 0);
  });
  // Imps hover beside the hero and hurl fire at the front monster.
  b.imps = (b.imps || []).filter((im) => {
    im.t++;
    if (im.t % 10 === 5) {
      const tgt = aliveMonsters().sort((a, c) => a.x - c.x)[0];
      if (tgt) {
        const [ix, iy] = impPos(im);
        b.shots.push({ x: ix + 3, y: iy + 2, spell: { id: 'impfire' }, sk: im.sk, dmg: im.dmg, target: tgt, speed: 2.2, color: [255, 150, 50] });
      }
    }
    return im.t < im.life;
  });
  // Heal in small batches so hooks and the game don't fight over state.json.
  if (b.healPending >= 1 && t % 30 === 0 && !b.practice) {
    const n = Math.floor(b.healPending); b.healPending = 0;
    const sid = d.sid;
    if (sid) try { L.withLock(() => { const st = L.loadState(); const ses = st.sessions && st.sessions[sid]; if (ses) { ses.hp = Math.min(100, (ses.hp == null ? 100 : ses.hp) + n); L.saveState(st); } }); } catch {}
  }
}
const impPos = (im) => [ui.heroX - 8 - im.i * 9, ui.heroY + 2 + Math.round(Math.sin((ui.tick + im.i * 7) * 0.3) * 2)];


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
    if (ds.t === 4 && tgt && ds.hero) {
      const M = ui.skillMods || S.mods({});
      strike(tgt, ds.dmg, [255, 120, 120], ds.sk, M, { crit: Math.random() < ds.crit + M.crit });
      if (M.flags.assassinate && tgt.hp > 0 && !tgt.boss && tgt.hp / tgt.max < 0.3) { floater(tgt.x, tgt.y - 10, 'EXECUTE!', [255, 80, 80], true); hitMonster(tgt, tgt.hp, [255, 80, 80], { noCrit: true }); }
      emit(8, ds.cx, ds.ty, [[255, 140, 140], [255, 255, 255], [150, 30, 40]], { spread: 1.6, up: 1.6, life: 10 });
    } else if (ds.t === 4 && tgt) {
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
  C.setClass(d.hero.cls);
  const M = modsOf(d);
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
    const every = Math.max(4, Math.round(Math.max(6, Math.round(24 - d.lvl * 1.2)) * (1 - Math.min(0.4, M.speed))));
    if (busy && t % every === 0) cast(d, mode, origin, pal, null, 1, true);
    stepAllies(d, heroX, floorY, busy || b.practice);
    stepFx(d, floorY);
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
  if (busy && !aliveMonsters().length && !b.monsters.some((m) => m.hp > 0) && t % 20 === 0 && t >= (b.nextWaveAt || 0)) spawnWave(W, floorY, d.lvl);
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
  // Wave monsters line up in front of the hero, packed closer when the scene
  // is narrow so every one of them stays in reach.
  const lineup = b.monsters.filter((m) => !m.boss && !m.minion && m.hp > 0).sort((p, q) => p.slot - q.slot);
  const rank = new Map(lineup.map((m, k) => [m, k]));
  const gap = Math.max(5, Math.min(13, (W - 20 - (heroX + 22)) / Math.max(1, lineup.length - 1)));
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
      : m.minion ? heroX + 22 + (minionSlots[idx] || 0) * 9 : heroX + 22 + Math.round((rank.get(m) || 0) * gap);
    const retreat = !busy && mode !== 'victory' && !b.practice && !(m.boss && (mode === 'waiting' || b.finisher));
    m.walking = false;
    m.flip = retreat;
    if (retreat) {
      m.x += m.boss ? 1 : 0.8; m.walking = true; m.windup = 0;
      if (m.boss && !m.fled) { m.fled = true; floater(m.x, m.y - 8, 'The boss retreats…', [200, 190, 220]); }
    } else if ((busy || b.practice || m.boss) && m.x > stop && !b.finisher) {
      const sp = m.boss && m.entering ? 1.2 : def.speed * 1.7;
      m.x = Math.max(stop, m.x - sp * (m.stun > 0 || m.rooted > 0 ? 0 : m.frozen > 0 ? 0.3 : 1));
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
          const dodge = (b.dodge || 0) > t;
          const guard = b.shield || m.taunt > 0 || dodge;
          if (dodge) floater(heroX + 2, ui.heroY - 4, 'DODGE', [200, 200, 215], true);
          emit(5, heroX + 14, ui.heroY + 12, guard ? [[140, 200, 255], [255, 255, 255]] : [[255, 90, 80], [255, 255, 255]], { spread: 0.9, up: 1.1, life: 8 });
          if (guard) b.shieldFlash = 5;
        }
      } else if (busy && !(m.frozen > 0) && !(m.stun > 0) && m.x <= stop + 1 && (m.at + m.seed * 9) % 40 === 0) m.windup = 5;
    } else if (busy && !m.entering && !b.finisher && !(m.stun > 0)) stepBoss(m, d, heroX, floorY);
    if (m.flash > 0) m.flash--;
    if (m.frozen > 0) m.frozen--;
    if (m.shock > 0) m.shock--;
    if (m.taunt > 0) m.taunt--;
    if (m.stun > 0) m.stun--;
    if (m.rooted > 0) m.rooted--;
    if (m.boss) m.lag = Math.max(m.hp, (m.lag == null ? m.hp : m.lag) - Math.max(0.5, ((m.lag || 0) - m.hp) * 0.08));
    // Elemental damage over time.
    if (m.burn > 0) {
      m.burn--;
      if (m.burn % 6 === 0) hitMonster(m, m.burnDmg || 1, [255, 150, 60], { dot: true });
      if (m.burn % 2 === 0) emit(1, m.x + Math.random() * mw, m.y + Math.random() * mh * 0.6, m.burnC ? [m.burnC, [60, 20, 90]] : [[255, 210, 90], [255, 120, 40]], { spread: 0.3, up: 0.8, grav: -0.03, life: 8 });
    }
    if (m.curse > 0 && m.hp > 0) {
      m.curse--;
      if (m.curse % 8 === 0) hitMonster(m, m.curseDmg || 1, [200, 120, 255], { dot: true });
      if (m.curse % 3 === 0) emit(1, m.x + Math.random() * mw, m.y + mh * 0.3, [[170, 80, 230], [90, 40, 140]], { spread: 0.2, up: 0.5, grav: -0.02, life: 10 });
    }
    if (m.poison > 0 && m.hp > 0) {
      m.poison--;
      if (m.poison % 8 === 0) hitMonster(m, m.poisonDmg || 1, [140, 230, 90], { dot: true });
      if (m.poison % 4 === 0) emit(1, m.x + 1 + Math.random() * (mw - 2), m.y + mh * 0.4, [[120, 220, 90], [70, 160, 50]], { spread: 0.05, up: 0, grav: 0.18, life: 10 });
    }
    if (m.bleed > 0 && m.hp > 0) {
      m.bleed--;
      if (m.bleed % 8 === 0) hitMonster(m, m.bleedDmg || 1, [230, 50, 60], { dot: true });
      if (m.bleed % 5 === 0) emit(1, m.x + Math.random() * mw, m.y + mh * 0.5, [[200, 30, 40], [140, 20, 30]], { spread: 0.1, up: 0.2, grav: 0.2, life: 8 });
    }
    if (m.doom > 0 && m.hp > 0 && !--m.doom) {
      const [dx, dy] = center(m);
      floater(dx - 3, m.y - 10, 'DOOM!', [190, 110, 255], true);
      emit(30, dx, dy, [[170, 80, 255], [40, 10, 60], [255, 255, 255]], { spread: 2.4, up: 2.4 });
      b.rings.push({ x: dx, y: m.floorY || floorY, r: 3, life: 10, c: [170, 80, 255] });
      shakeFor(b, 5);
      hitMonster(m, m.doomDmg || 1, [190, 110, 255], { noCrit: true });
    }
    if (m.mark > 0 && m.hp > 0 && !--m.mark) {
      const [dx, dy] = center(m);
      emit(16, dx, dy, [[255, 60, 60], [255, 200, 200]], { spread: 1.8, up: 1.8 });
      hitMonster(m, m.markDmg || 1, [255, 80, 80], { noCrit: true });
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
    if (dist < 3) { impact(s, tgt, tx, ty, floorY); return false; }
    s.x += (dx / dist) * s.speed; s.y += (dy / dist) * s.speed;
    return true;
  });
}

// A projectile lands: area blasts, burns, curses, poison, doom and marks.
function impact(s, tgt, tx, ty, floorY) {
  const b = ui.battle, sk = s.spell, id = sk.id, M = ui.skillMods || S.mods({});
  const hit = (m, o) => (s.ally ? hitMonster(m, s.dmg, s.color, o) : strike(m, s.dmg, s.color, s.sk || sk, M, o));
  if (sk.aoe) {
    const list = aliveMonsters().filter((m) => Math.abs(m.x - tgt.x) < sk.aoe || m === tgt);
    for (const m of list) {
      if (id !== 'blast') { m.burn = 30; m.burnDmg = Math.max(1, Math.round(s.dmg * 0.12 * (1 + (s.ally ? 0 : M.dot)))); m.burnC = null; }
      hit(m);
    }
    emit(id === 'meteor' ? 34 : id === 'blast' || id === 'ember' ? 10 : 18, tx, ty, [s.color, [255, 230, 120], [255, 255, 255]], { spread: 2, up: 2.4 });
    if (id === 'meteor') { shakeFor(b, 6); stopFor(b, 3); b.rings.push({ x: tx, y: floorY, r: 3, life: 9, c: [255, 160, 80] }); }
    if (id === 'fireball' && !s.ally && M.flags.fireballSplit) {
      for (const m of aliveMonsters().filter((o) => o !== tgt).slice(0, 3)) b.shots.push({ x: tx, y: ty - 2, spell: { id: 'ember', aoe: 4 }, sk, dmg: Math.max(1, Math.round(s.dmg * 0.4)), target: m, speed: 2, color: [255, 180, 80] });
    }
    return;
  }
  if (s.ally && id === 'curse') { tgt.curse = 40; tgt.curseDmg = Math.max(1, Math.round(s.dmg * 0.5)); }
  if (!s.ally) {
    if (id === 'curse') { tgt.curse = tgt.curseT = Math.round(sk.curse * M.durMult('curse')); tgt.curseDmg = Math.max(1, Math.round(s.dmg * 0.6 * (1 + M.dot))); }
    if (id === 'poison') { tgt.poison = Math.round(sk.poison * M.durMult('poison')); tgt.poisonDmg = Math.max(1, Math.round(s.dmg * 0.5 * (1 + M.dot))); emit(6, tx, ty, [[120, 220, 90], [200, 255, 160]], { spread: 1, up: 1, life: 10 }); }
    if (id === 'doom') { tgt.doom = sk.doom; tgt.doomDmg = s.dmg * 4; floater(tx - 3, tgt.y - 8, 'DOOMED', [170, 80, 255], true); }
    if (id === 'deathmark') { tgt.mark = sk.mark; tgt.markDmg = s.dmg * 2; floater(tx - 3, tgt.y - 8, 'MARKED', [255, 80, 80], true); }
  }
  hit(tgt, { critChance: s.critChance });
  emit(5, tx, ty, [s.color, [255, 255, 255]], { spread: 1, up: 1.2 });
}

// ---------- drawing ----------

function drawShots(pc) {
  const b = ui.battle, t = ui.tick;
  for (const s of b.shots) {
    const x = Math.round(s.x), y = Math.round(s.y), id = s.spell.id;
    if (id === 'multishot') { for (let i = 0; i < 5; i++) pc.set(x - i, y, i === 0 ? [240, 240, 250] : s.color); pc.set(x - 4, y - 1, [230, 230, 240]); pc.set(x - 4, y + 1, [230, 230, 240]); continue; }
    if (id === 'anthem' || id === 'encore') { pc.label(Math.floor(x), Math.floor(y / 2), (t >> 2) % 2 ? '♪' : '♫', s.color, true); pc.glow(x, y, 4, s.color, 0.3); continue; }
    if (id === 'poison' || id === 'deathmark') {
      const c = id === 'poison' ? [120, 230, 90] : [240, 60, 70], sp = (t >> 1) % 4;
      const dirs = [[1, 0], [1, 1], [0, 1], [-1, 1]][sp];
      for (let k = -2; k <= 2; k++) pc.set(x + dirs[0] * k, y + dirs[1] * k, k === 2 ? [230, 230, 240] : c);
      if (id === 'poison') pc.set(x - 1, y + 2 + (t % 3), [90, 200, 60]);
      pc.glow(x, y, 4, c, 0.35);
      continue;
    }
    if (id === 'doom') {
      pc.rect(x - 1, y - 1, 3, 3, [40, 16, 60]); pc.set(x, y, [230, 180, 255]);
      for (let k = 0; k < 4; k++) { const g = t * 0.6 + k * 1.57; pc.set(x + Math.cos(g) * 3, y + Math.sin(g) * 2, [170, 80, 255]); }
      pc.glow(x, y, 6, [150, 60, 220], 0.5);
      continue;
    }
    if (id === 'impfire' || id === 'ember') { pc.set(x, y, [255, 240, 180]); pc.set(x - 1, y, s.color); pc.set(x - 2, y + ((t >> 1) % 2), [200, 80, 30]); pc.glow(x, y, 3, s.color, 0.4); continue; }
    if ((id === 'basic' || id === 'arrow') && s.cls === 'ranger') { for (let i = 0; i < 5; i++) pc.set(x - i, y, i === 0 ? [220, 220, 230] : s.color); pc.set(x - 4, y - 1, [230, 230, 240]); continue; }
    if ((id === 'basic' || id === 'ally') && s.cls === 'knight') { for (let j = -2; j <= 2; j++) pc.set(x - Math.abs(j), y + j, s.color); pc.glow(x, y, 4, s.color, 0.3); continue; }
    if ((id === 'basic' || id === 'note') && s.cls === 'bard') { pc.label(Math.floor(x), Math.floor(y / 2), (t >> 2) % 2 ? '♪' : '♫', s.color); continue; }
    if (id === 'curse') {
      for (let k = 0; k < 5; k++) pc.set(x - k, y + Math.round(Math.sin((t + k) * 0.9) * 1.5), X.shade(s.color, 1 - k * 0.15));
      pc.set(x, y, [240, 200, 255]); pc.glow(x, y, 5, s.color, 0.45);
      continue;
    }
    const r = id === 'meteor' ? 2 : id === 'fireball' ? 1.5 : 1;
    if (id === 'starfall' && (t >> 1) % 2) { pc.set(x - 2, y, [255, 255, 255]); pc.set(x + 2, y, [255, 255, 255]); pc.set(x, y - 2, [255, 255, 255]); }
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
  drawFx(pc);
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

// Skill effects drawn over the scene (pixel coords).
function drawFx(pc) {
  const b = ui.battle, t = ui.tick, W = pc.w, H = pc.h;
  const blend = (x, y, c, a) => { if (x >= 0 && y >= 0 && x < W && y < H) pc.set(x, y, X.mix(pc.get(x, y) || [0, 0, 0], c, a)); };
  const ring = (cx, cy, r, c, a, squash = 0.5, n = 40) => { for (let k = 0; k < n; k++) { const g = (k / n) * Math.PI * 2; blend(cx + Math.cos(g) * r, cy + Math.sin(g) * r * squash, c, a); } };
  for (const f of b.fx || []) {
    const k = f.kind, p = f.t / Math.max(1, f.life);
    if (k === 'nova') {
      const r = 3 + f.t * 2;
      ring(f.x, f.y, r, [200, 245, 255], 0.9 * (1 - p), 0.55, 48);
      ring(f.x, f.y, r * 0.7, [140, 230, 255], 0.6 * (1 - p), 0.55, 36);
      for (let s = 0; s < 8; s++) { const g = (s / 8) * Math.PI * 2 + 0.3; for (let j = 0; j < 3; j++) blend(f.x + Math.cos(g) * (r + j), f.y + Math.sin(g) * (r + j) * 0.55, [255, 255, 255], 0.8 * (1 - p)); }
    } else if (k === 'trap') {
      const x = Math.round(f.x), y = Math.round(f.y) - 1, shut = f.t >= 5;
      const teeth = shut ? [[-2, -1], [-1, -2], [0, -1], [1, -2], [2, -1]] : [[-4, -2], [-3, -1], [-2, 0], [2, 0], [3, -1], [4, -2]];
      for (let i = -4; i <= 4; i++) pc.set(x + i, y, [110, 100, 90]);
      for (const [dx, dy] of teeth) pc.set(x + dx, y + dy, [220, 220, 230]);
      if (shut && f.t < 9) pc.glow(x, y - 1, 5, [255, 240, 200], 0.4);
    } else if (k === 'pierce') {
      const x = Math.round(f.x), y = Math.round(f.y);
      for (let i = 0; i < 14; i++) blend(x - i, y, i < 3 ? [255, 255, 255] : [200, 220, 255], 1 - i / 14);
      pc.set(x + 1, y, [255, 255, 255]); pc.set(x - 1, y - 1, [230, 230, 240]); pc.set(x - 1, y + 1, [230, 230, 240]);
      pc.glow(x, y, 5, [200, 220, 255], 0.35);
    } else if (k === 'rain') {
      const left = Math.max(0, f.x - Math.min(f.r, W)), right = Math.min(W - 1, f.x + Math.min(f.r, W));
      if (f.t <= f.volleys * 4 + 2) for (let c = 0; c < 10; c++) {
        const ax = left + ((c * 37 + t * 3) % Math.max(1, right - left + 1));
        const ay = ((c * 13 + f.t * 6) % Math.max(8, (b.floorY || H) - 2));
        for (let i = 0; i < 4; i++) pc.set(ax - i * 0.5, ay - i, i === 0 ? [230, 230, 240] : [200, 160, 100]);
      }
    } else if (k === 'eagle') {
      const x = Math.round(f.x), y = Math.round(f.y), up = (t >> 1) % 2;
      const body = [196, 150, 90], wing = [150, 104, 60];
      pc.rect(x - 2, y, 5, 2, body); pc.set(x + 3, y, [245, 245, 240]); pc.set(x + 4, y, [255, 200, 60]);
      for (let i = 1; i <= 5; i++) { pc.set(x - i, y + (up ? -i * 0.6 : i * 0.3), wing); pc.set(x + 1 - i, y + (up ? -i * 0.6 : i * 0.3), wing); }
      for (let i = 1; i < 10; i++) blend(x - 3 - i, y + 1, [255, 240, 200], 0.4 * (1 - i / 10));
    } else if (k === 'bash') {
      const r = 2 + f.t;
      for (let a = -5; a <= 5; a++) { const g = (a / 10) * Math.PI; blend(f.x - 3 + Math.cos(g) * -r, f.y + Math.sin(g) * r, [180, 220, 255], 1 - p); }
      pc.glow(f.x - 2, f.y, 6, [150, 200, 255], 0.5 * (1 - p));
    } else if (k === 'shout' || k === 'echo') {
      const c = k === 'echo' ? [200, 170, 255] : [120, 190, 255];
      for (let j = 0; j < 3; j++) { const r = f.t * 3 - j * 6; if (r > 0) ring(f.x, f.y, r, c, 0.7 * (1 - p), 0.6, 44); }
    } else if (k === 'whirl') {
      const cx = f.x + 6, cy = f.y;
      for (let j = 0; j < 3; j++) {
        const g = t * 1.1 + j * 2.1, r = 10 + (f.r || 30) * 0.3;
        for (let i = 0; i < 8; i++) { const gg = g - i * 0.12; blend(cx + Math.cos(gg) * r, cy + Math.sin(gg) * r * 0.45, [235, 240, 255], 0.9 - i * 0.1); }
      }
    } else if (k === 'pillar') {
      if (f.target && f.target.hp > -99) {
        const [cx] = center(f.target), bottom = Math.min(H, f.target.y + size(f.target)[1]);
        const half = Math.max(1, 5 - Math.abs(f.t - 4)), reach = Math.min(1, f.t / 4) * bottom;
        for (let y = 0; y < reach; y++) for (let x = Math.floor(cx - half); x <= cx + half; x++) blend(x, y, Math.abs(x - cx) < half * 0.4 ? [255, 255, 255] : [255, 230, 140], 0.75 * (1 - p * 0.6));
      }
    } else if (k === 'hammer') {
      const tt = f.t - (f.delay || 0);
      if (tt >= 0 && tt <= 7 && f.target) {
        const [cx, cy] = center(f.target), y = Math.round(-6 + (cy - 4 + 6) * Math.min(1, tt / 6));
        pc.rect(cx - 3, y - 2, 7, 3, [255, 226, 130]); pc.rect(cx - 2, y - 1, 5, 1, [255, 250, 220]);
        for (let i = 1; i < 5; i++) pc.set(cx, y - 2 - i, [200, 160, 90]);
        pc.glow(cx, y, 6, [255, 220, 110], 0.4);
      }
    } else if (k === 'beam') {
      if (f.target && f.target.hp > -99) {
        const [tx, ty] = center(f.target), hx = ui.heroX + 10, hy = ui.heroY + 8;
        const n = Math.max(1, Math.ceil(Math.hypot(tx - hx, ty - hy)));
        for (let i = 0; i <= n; i++) {
          const u = i / n, wob = Math.sin(u * 12 + t * 0.8) * 1.5;
          blend(tx + (hx - tx) * u, ty + (hy - ty) * u + wob, i % 2 ? [230, 60, 90] : [255, 140, 160], 0.85 * (1 - p * 0.5));
        }
        for (let j = 0; j < 3; j++) { const u = ((t * 0.12 + j / 3) % 1); pc.set(tx + (hx - tx) * u, ty + (hy - ty) * u, [255, 220, 230]); }
      }
    } else if (k === 'cone') {
      const len = Math.max(4, f.tx - f.x);
      for (let i = 0; i < len; i++) {
        const spread = 1 + i * 0.28, u = i / len;
        for (let j = -spread; j <= spread; j++) {
          if (Math.random() > 0.55) continue;
          const hot = Math.abs(j) < spread * 0.35;
          blend(f.x + i, f.y + j, hot ? [220, 170, 255] : (i + t) % 3 ? [130, 50, 200] : [40, 20, 60], 0.8 * (1 - p) * (1 - u * 0.3));
        }
      }
    } else if (k === 'notes') {
      for (let j = 0; j < 4; j++) {
        const ph = (f.t + j * 5) % 18;
        pc.label(Math.floor(f.x - 8 + j * 5), Math.max(0, Math.floor((f.y - ph) / 2)), j % 2 ? '♪' : '♫', X.mix(f.color, [255, 255, 255], 0.3));
      }
    } else if (k === 'ring') {
      const r = Math.min(f.r, 2 + f.t * 3);
      ring(f.x, f.y, r, f.color, 0.8 * (1 - p), 0.5, 44);
      if (f.t < 6) pc.label(Math.floor(f.x), Math.max(0, Math.floor((f.y - 8 - f.t) / 2)), '♯', f.color);
    } else if (k === 'wave') {
      for (let j = 0; j < 3; j++) {
        const x = f.x - j * 4;
        for (let dy = -10 + j * 2; dy <= 10 - j * 2; dy++) blend(x - Math.abs(dy) * 0.25, f.y + dy, j ? [255, 190, 230] : [255, 240, 250], 0.8 - j * 0.25);
      }
    } else if (k === 'cloud') {
      const fade = f.life - f.t < 10 ? (f.life - f.t) / 10 : 1;
      for (let j = 0; j < 7; j++) {
        const cx = f.x + Math.sin(j * 2.3 + t * 0.05) * 12, cy = f.y - (j % 3) * 4 + Math.cos(j + t * 0.07) * 2, r = 5 + (j % 3);
        for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) if (dx * dx + dy * dy * 2 <= r * r) blend(cx + dx, cy + dy, (dx + dy + j) % 4 ? [130, 130, 150] : [175, 175, 190], 0.45 * fade);
      }
    } else if (k === 'step') {
      const tt = f.t - (f.delay || 0);
      if (tt >= 0 && f.target) {
        const [cx, cy] = center(f.target);
        if (tt < 4) { pc.rect(cx + 4, cy - 3, 3, 6, [30, 34, 44]); pc.set(cx + 5, cy - 3, [120, 220, 200]); }
        if (tt >= 1 && tt <= 5) for (let a = -4; a <= 4; a++) { pc.set(cx + a, cy + a, [200, 255, 240]); pc.set(cx + a, cy - a, [120, 220, 200]); }
      }
    }
  }
  // Imps: little winged devils beside the hero.
  for (const im of b.imps || []) {
    const [x, y] = impPos(im), flap = (t >> 1) % 2;
    const R = [210, 60, 40], D = [120, 30, 30], Y = [255, 220, 90];
    pc.rect(x, y, 4, 4, R); pc.set(x, y - 1, D); pc.set(x + 3, y - 1, D);
    pc.set(x + 1, y + 1, Y); pc.set(x + 3, y + 1, Y);
    pc.set(x - 1, y + (flap ? 0 : 2), D); pc.set(x - 2, y + (flap ? -1 : 2), D);
    pc.set(x + 1, y + 4, D); pc.set(x + 2, y + 4, D);
    if (im.life - im.t < 12 && t % 2) pc.glow(x + 2, y + 2, 4, [255, 120, 60], 0.3);
  }
  // Status markers over monsters.
  for (const m of b.monsters) {
    if (m.hp <= 0) continue;
    const [w, h] = size(m), cx = Math.round(m.x + w / 2), top = Math.round(m.y + (m.yOff || 0));
    if (m.stun > 0) for (let s = 0; s < 3; s++) { const g = t * 0.5 + s * 2.1; pc.set(cx + Math.cos(g) * 4, top - 3 + Math.sin(g) * 1.2, s ? [255, 230, 90] : [255, 255, 255]); }
    if (m.mark > 0) { const c = t % 4 < 2 ? [255, 60, 60] : [255, 160, 160]; for (let i = -2; i <= 2; i++) { pc.set(cx + i, top - 6, c); pc.set(cx, top - 6 + i, c); } pc.set(cx, top - 6, [255, 255, 255]); }
    if (m.doom > 0) { ring(cx, top - 6, 1 + m.doom / 8, [170, 80, 255], 0.9, 1, 16); pc.set(cx, top - 6, [230, 200, 255]); }
    if (m.rooted > 0) for (let i = -2; i <= w + 1; i += 2) pc.set(m.x + i, m.y + h - 1 - ((i + t) % 2), [90, 150, 60]);
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

module.exports = { drawBattleOverlay, emit, floater, spawnWave, hitMonster, aliveMonsters, COOLDOWN, playerCast, cast, stepBattle, drawShots, allyClass, hpScale, heroPower, MIN_WAVE_TICKS };
