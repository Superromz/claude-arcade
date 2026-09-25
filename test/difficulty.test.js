// Difficulty tiers, monster affixes, the hero's battle HP and knockouts.
// XP must never depend on difficulty. Run with: node --test
'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

const home = fs.mkdtempSync(path.join(os.tmpdir(), 'arcade-difficulty-'));
process.env.HOME = home;
process.env.USERPROFILE = home;

const SCRIPTS = path.join(__dirname, '..', 'plugins', 'claude-arcade', 'scripts');
const L = require(path.join(SCRIPTS, 'lib.js'));
const MON = require(path.join(SCRIPTS, 'monsters.js'));
const B = require(path.join(SCRIPTS, 'battle.js'));
const { ui, UI } = require(path.join(SCRIPTS, 'state.js'));

const pc = { w: 84, h: 60, set() {}, get() { return [0, 0, 0]; }, glow() {}, label() {}, rect() {} };
const fresh = () => {
  Object.assign(ui.battle, { monsters: [], shots: [], bolts: [], coins: [], fx: [], imps: [], pets: [], dashes: [], rings: [], wave: 0, kills: 0, gold: 0, practice: false, ko: null, knockouts: 0, heroHp: null, heroHpMax: 0, barrier: 0, guard: 0, dodge: 0, tier: null, combo: 0, lastEventT: 0, nextWaveAt: 0 });
  ui.floaters = []; ui.particles = []; ui.xpPending = 0; ui.tick = 1; ui.heroX = 20; ui.heroY = 30; ui.sceneW = 84; ui.skillMods = null;
};
const monster = (o = {}) => ({ type: 'slime', hp: 100, max: 100, x: 40, y: 40, floorY: 54, slot: 0, seed: 0, xp: 3, lvl: 5, ...o });
const hero = (lvl, cls = 'mage') => ({ hero: { cls }, lvl, stats: { INT: 20, STR: 20, DEX: 20, WIS: 20, CHA: 20 }, state: { game: {} }, ses: { party: {} }, events: [], cfg: { theme: 'rpg' } });

test('difficulty tiers follow hero level, and Abyss scales without a cap', () => {
  const t = (l) => MON.difficultyFor(l).id;
  assert.strictEqual(t(1), 'normal');
  assert.strictEqual(t(19), 'normal');
  assert.strictEqual(t(20), 'veteran');
  assert.strictEqual(t(34), 'veteran');
  assert.strictEqual(t(35), 'heroic');
  assert.strictEqual(t(50), 'mythic');
  assert.strictEqual(t(60), 'abyss');
  assert.strictEqual(MON.difficultyFor(60).label, 'ABYSS 1');
  assert.strictEqual(MON.difficultyFor(66).level, 3);
  let prev = 0;
  for (const lvl of [1, 20, 35, 50, 60, 70, 90, 150]) {
    const d = MON.difficultyFor(lvl);
    assert.ok(d.hp >= prev, `${lvl} HP multiplier grows`);
    prev = d.hp;
  }
  assert.ok(MON.difficultyFor(150).gold > MON.difficultyFor(60).gold);
  assert.strictEqual(MON.difficultyFor(5, 'mythic').id, 'mythic');
  assert.strictEqual(MON.difficultyFor(5, 'abyss:4').label, 'ABYSS 4');
});

test('higher tiers add affixes; elites always have some', () => {
  const count = (force) => {
    fresh();
    let normal = 0, elite = 0, eliteAff = 0;
    for (let w = 0; w < 60; w++) {
      ui.battle.monsters = [];
      ui.battle.wave = w;
      B.spawnWave(84, 54, 40, force);
      for (const m of ui.battle.monsters) { if (m.elite) { elite++; eliteAff += (m.affixes || []).length; } else normal += (m.affixes || []).length ? 1 : 0; }
    }
    return { normal, elite, eliteAff };
  };
  const n = count('normal'), m = count('mythic');
  assert.strictEqual(n.normal, 0, 'Normal: plain monsters have no affixes');
  assert.ok(n.eliteAff >= n.elite, 'Normal elites have at least one affix');
  assert.ok(m.normal > 20, 'Mythic: many normal monsters have affixes');
  assert.ok(m.eliteAff >= 3 * m.elite, 'Mythic elites have 3 affixes');
});

test('a shield soaks damage before HP, and lightning breaks it faster', () => {
  fresh();
  const m = B.applyAffixes(monster(), ['shielded'], 5);
  assert.strictEqual(m.shield, 40);
  B.hitMonster(m, 10, null, { noCrit: true });
  assert.strictEqual(m.hp, 100);
  assert.strictEqual(m.shield, 30);
  B.hitMonster(m, 10, null, { noCrit: true, el: 'lightning' });
  assert.strictEqual(m.shield, 10);
  B.hitMonster(m, 30, null, { noCrit: true });
  assert.strictEqual(m.shield, 0);
  assert.strictEqual(m.hp, 80, 'damage past the shield reaches HP');
});

test('armor takes a flat bite out of direct hits, not damage over time', () => {
  fresh();
  const m = monster({ armor: 6 });
  B.hitMonster(m, 10, null, { noCrit: true });
  assert.strictEqual(m.hp, 96);
  B.hitMonster(m, 10, null, { noCrit: true, dot: true });
  assert.strictEqual(m.hp, 86);
  B.hitMonster(m, 3, null, { noCrit: true });
  assert.strictEqual(m.hp, 85, 'a hit always does at least 1');
  B.hitMonster(m, 10, null, { noCrit: true, pen: 0.5 });
  assert.strictEqual(m.hp, 78, 'armor penetration ignores part of it');
});

test('resist and weakness change elemental damage', () => {
  fresh();
  const m = monster({ resist: 'fire', weak: 'frost' });
  B.hitMonster(m, 20, null, { noCrit: true, el: 'fire' });
  assert.strictEqual(m.hp, 90);
  B.hitMonster(m, 20, null, { noCrit: true, el: 'frost' });
  assert.strictEqual(m.hp, 60);
});

test('splitting monsters split into two that give no XP', () => {
  fresh();
  const m = monster({ affixes: ['splitting'], xp: 5 });
  ui.battle.monsters.push(m);
  B.hitMonster(m, 500, null, { noCrit: true });
  const kids = ui.battle.monsters.filter((x) => x.split);
  assert.strictEqual(kids.length, 2);
  for (const k of kids) { assert.strictEqual(k.xp, 0); assert.strictEqual(k.max, 35); assert.ok(!(k.affixes || []).includes('splitting')); }
  assert.strictEqual(ui.xpPending, 5, 'only the original counts');
  for (const k of kids) B.hitMonster(k, 500, null, { noCrit: true });
  assert.strictEqual(ui.battle.monsters.filter((x) => x.split).length, 2, 'children never split again');
  assert.strictEqual(ui.xpPending, 5);
});

test('XP from kills never depends on the difficulty tier', () => {
  const xpOf = (force) => { fresh(); ui.battle.wave = 4; B.spawnWave(84, 54, 45, force); return ui.battle.monsters.map((m) => m.xp); };
  const base = xpOf('normal');
  for (const f of ['veteran', 'heroic', 'mythic', 'abyss:9']) assert.deepStrictEqual(xpOf(f), base, f);
  // Gold does scale.
  fresh(); ui.battle.wave = 4; B.spawnWave(84, 54, 45, 'mythic');
  assert.ok(ui.battle.monsters.every((m) => m.goldMult === 1.9 || m.goldMult === 2));
});

test('monsters hurt battle HP; a knockout costs no XP, gold or items', () => {
  fresh();
  const d = hero(40);
  ui.battle.gold = 777; ui.xpPending = 12;
  B.stepBattle(d, pc, 54, 20, [35, 36], UI.rpg, 'running');
  const max = ui.battle.heroHpMax;
  assert.ok(max > 100);
  assert.strictEqual(ui.battle.heroHp, max);
  const m = monster({ hp: 1000, max: 1000, x: 42 });
  ui.battle.monsters.push(m);
  assert.ok(B.hurtHero(100, m, d) > 0);
  assert.ok(ui.battle.heroHp < max);
  ui.battle.dodge = ui.tick + 10;
  assert.strictEqual(B.hurtHero(100, m, d), 0, 'dodge avoids the hit');
  ui.battle.dodge = 0;
  ui.battle.wave = 7; ui.battle.combo = 5;
  B.hurtHero(max * 5, m, d);
  assert.ok(ui.battle.ko, 'knocked out');
  assert.strictEqual(ui.battle.wave, 0, 'the wave streak resets');
  assert.strictEqual(ui.battle.combo, 0, 'the gold combo resets');
  assert.strictEqual(ui.battle.gold, 777, 'banked gold is kept');
  assert.strictEqual(ui.xpPending, 12, 'XP is kept');
  assert.ok(m.fleeing && m.xp === 0, 'monsters leave without rewards');
  B.hitMonster(m, 5000, null, { noCrit: true });
  for (let i = 0; i < B.KO_TICKS + 2; i++) { ui.tick++; B.stepBattle(d, pc, 54, 20, [35, 36], UI.rpg, 'running'); }
  assert.strictEqual(ui.battle.ko, null, 'respawned');
  assert.strictEqual(ui.battle.heroHp, ui.battle.heroHpMax);
  assert.strictEqual(ui.xpPending, 12);
});

test('healing skills restore battle HP', () => {
  fresh();
  const d = hero(30, 'knight');
  B.stepBattle(d, pc, 54, 20, [35, 36], UI.rpg, 'idle');
  ui.battle.heroHp = 10;
  B.healHero(0.35);
  assert.ok(ui.battle.heroHp > 10 + ui.battle.heroHpMax * 0.3);
});

test('every class casts every skill without errors or runaway state', () => {
  const C = require(path.join(SCRIPTS, 'character.js'));
  for (const cls of Object.keys(C.KITS)) {
    fresh();
    const d = hero(80, cls);
    ui.battle.practice = true;
    B.spawnWave(84, 54, 80);
    B.stepBattle(d, pc, 54, 20, [35, 36], UI.rpg, 'running');
    for (const sk of C.kitFor(cls)) {
      if (!B.aliveMonsters().length) { ui.battle.wave = 1; B.spawnWave(84, 54, 80); ui.battle.practice = true; }
      B.cast(d, 'running', [35, 36], UI.rpg, sk, 1);
      for (let i = 0; i < 12; i++) { ui.tick++; B.stepBattle(d, pc, 54, 20, [35, 36], UI.rpg, 'running'); }
    }
    assert.ok(ui.battle.monsters.length < 30, cls);
    assert.strictEqual(ui.xpPending || 0, 0, `${cls}: practice never gives XP`);
  }
});

test('Mythic and Abyss battles render at exactly W', () => {
  const dir = path.join(home, 'snap');
  fs.mkdirSync(path.join(dir, '.claude', 'arcade'), { recursive: true });
  fs.writeFileSync(path.join(dir, '.claude', 'arcade', 'config.json'), JSON.stringify({ theme: 'rpg', character: { name: 'T', cls: 'warlock' } }));
  const now = Date.now();
  fs.writeFileSync(path.join(dir, '.claude', 'arcade', 'state.json'), JSON.stringify({ xp: L.xpForLevel(70), sessions: { s1: { mode: 'running', since: now, hp: 100, party: {}, turn: { start: now } } } }));
  for (const tier of ['mythic', 'abyss:5']) for (const [cols, rows] of [[80, 24], [130, 36]]) {
    const out = execFileSync(process.execPath, [path.join(SCRIPTS, 'game.js'), '--snapshot', '1'], { env: { ...process.env, HOME: dir, USERPROFILE: dir, COLUMNS: String(cols), LINES: String(rows), ARCADE_WARMUP: '120', ARCADE_TIER: tier }, encoding: 'utf8' });
    const lines = out.replace(/\n$/, '').split('\n');
    for (const l of lines) assert.strictEqual(L.visWidth(l), cols, `${tier} ${cols}x${rows}`);
  }
});
