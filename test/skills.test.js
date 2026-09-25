// Class skill kits, the skill tree, respecs, paragon points and the Skills
// tab's fixed-width rendering.
// Run with: node --test
'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

// Point the game's data dir at a throwaway HOME before loading any module.
const home = fs.mkdtempSync(path.join(os.tmpdir(), 'arcade-skills-'));
process.env.HOME = home;
process.env.USERPROFILE = home;

const SCRIPTS = path.join(__dirname, '..', 'plugins', 'claude-arcade', 'scripts');
const L = require(path.join(SCRIPTS, 'lib.js'));
const C = require(path.join(SCRIPTS, 'character.js'));
const { ui, UI } = require(path.join(SCRIPTS, 'state.js'));
const S = require(path.join(SCRIPTS, 'skills.js'));
const B = require(path.join(SCRIPTS, 'battle.js'));

const CLASSES = Object.keys(C.CLASSES);
const reset = (game = {}, xp = 0) => L.saveState({ ...L.loadState(), xp, game });
const hero = (cls, lvl) => ({ hero: { cls }, lvl, state: L.loadState() });

test('every class has its own kit: basic attack plus eleven skills and a Lv 75 ultimate', () => {
  const ids = [];
  for (const cls of CLASSES) {
    const kit = C.kitFor(cls);
    assert.strictEqual(kit.length, 12, cls);
    assert.deepStrictEqual(kit.map((s) => s.lvl), [1, 3, 5, 8, 12, 18, 25, 30, 40, 50, 60, 75], cls);
    assert.ok(kit[11].ult, `${cls} ultimate`);
    assert.ok(kit.filter((s) => s.def).length >= 1, `${cls} has a defensive skill`);
    for (const s of kit) assert.ok(C.ELEMENTS.includes(s.el), `${s.id} element`);
    assert.strictEqual(kit[0].id, 'basic');
    assert.strictEqual(kit[0].name, C.BASIC_NAMES[cls]);
    ids.push(...kit.slice(1).map((s) => s.id));
    for (const s of kit.slice(1)) assert.ok(B.COOLDOWN[s.id] > 0, `cooldown for ${s.id}`);
  }
  assert.strictEqual(new Set(ids).size, ids.length, 'skill ids are unique across classes');
});

test('spellFor picks from the class kit by level and activity', () => {
  assert.strictEqual(C.spellFor(1, 'editing', 1, 'knight').id, 'basic');
  assert.strictEqual(C.spellFor(3, 'editing', 1, 'knight').id, 'bash');
  assert.strictEqual(C.spellFor(9, 'running', 1, 'mage').id, 'chain');
  assert.strictEqual(C.spellFor(9, 'running', 1, 'ranger').id, 'pierce');
  assert.strictEqual(C.spellFor(20, 'thinking', 1, 'rogue').id, 'deathmark');
  assert.strictEqual(C.spellFor(5, 'reading', 1, 'warlock').id, 'drain');
  for (const cls of CLASSES) for (const lvl of [1, 4, 9, 20]) for (const mode of ['editing', 'web', 'idle']) for (let t = 0; t < 12; t++) {
    const sp = C.spellFor(lvl, mode, t, cls);
    assert.ok(C.kitFor(cls).includes(sp), `${cls} ${lvl} ${mode}`);
    assert.ok(sp.lvl <= lvl);
  }
  // C.SPELLS follows the active class.
  C.setClass('bard');
  assert.strictEqual(C.SPELLS[1].id, 'anthem');
  C.setClass('mage');
  assert.strictEqual(C.SPELLS[1].id, 'fireball');
});

test('learning spends points, follows prerequisites and level gates, and keeps other fields', () => {
  reset({ gold: 42, kills: 7 });
  const d = hero('mage', 5);
  assert.strictEqual(S.points(d).avail, 5); // 1 per level
  assert.match(S.blocker(d, 0, 1), /Learn Kindling first/);
  assert.ok(S.learn(d, 0, 0));
  assert.ok(S.learn(d, 0, 1));
  assert.match(S.blocker(d, 0, 2), /Needs level 8/);
  const st = L.loadState();
  assert.strictEqual(st.game.skills.nodes['mage.0.0'], 1);
  assert.strictEqual(st.game.skills.nodes['mage.0.1'], 1);
  assert.strictEqual(st.game.gold, 42);
  assert.strictEqual(st.game.kills, 7);
  assert.strictEqual(S.points(hero('mage', 5)).avail, 3);
  // Ranks cap at the node's max.
  const d2 = hero('mage', 5);
  S.learn(d2, 0, 0); S.learn(d2, 0, 0); S.learn(d2, 0, 0);
  assert.strictEqual(L.loadState().game.skills.nodes['mage.0.0'], 3);
  assert.strictEqual(S.blocker(hero('mage', 5), 0, 0), 'Fully learned');
});

test('bosses killed add skill points', () => {
  reset({ bosses: 3 });
  assert.strictEqual(S.points(hero('knight', 4)).avail, 7);
});

test('tree nodes change damage, cooldowns, targets and crit', () => {
  reset({ skills: { nodes: { 'mage.0.0': 3, 'mage.0.2': 2, 'mage.2.0': 1, 'mage.2.1': 2, 'mage.2.3': 1, 'mage.0.4': 1 } } });
  const M = S.mods(hero('mage', 30));
  assert.ok(Math.abs(M.mult('fireball') - 1.45) < 1e-9);
  assert.ok(Math.abs(M.mult('fireball', 'editing') - 1.75) < 1e-9); // Firestarter: edits +30%
  assert.strictEqual(M.targets.chain, 2);
  assert.ok(Math.abs(M.crit - 0.04) < 1e-9);
  assert.strictEqual(M.flags.fireballSplit, true);
  assert.strictEqual(M.cd('fireball', 30), 30);
});

test('respec costs gold, grows each time, and keeps paragon', () => {
  reset({ gold: 150, skills: { nodes: { 'rogue.0.0': 2 }, respecs: 0, paragon: { gold: 2 } } });
  assert.strictEqual(S.respecCost(0), 100);
  assert.strictEqual(S.respecCost(1), 200);
  assert.strictEqual(S.respecCost(2), 400);
  ui.battle.gold = 150;
  assert.ok(S.respec(hero('rogue', 10)));
  let st = L.loadState();
  assert.deepStrictEqual(st.game.skills.nodes, {});
  assert.strictEqual(st.game.skills.respecs, 1);
  assert.strictEqual(st.game.skills.paragon.gold, 2);
  assert.strictEqual(st.game.gold, 50);
  assert.strictEqual(ui.battle.gold, 50);
  // The next respec costs 200: not enough gold.
  const d = hero('rogue', 10);
  S.learn(d, 0, 0);
  assert.ok(!S.respec(hero('rogue', 10)));
  st = L.loadState();
  assert.strictEqual(st.game.skills.nodes['rogue.0.0'], 1);
  assert.strictEqual(st.game.gold, 50);
});

test('paragon points start once every node is learned and have no cap', () => {
  const nodes = {};
  S.treeFor('ranger').forEach((br, b) => br.nodes.forEach((n, k) => { nodes[S.nodeId('ranger', b, k)] = n.max; }));
  const total = S.totalRanks('ranger');
  reset({ skills: { nodes } });
  const lvl = total + 4;
  let P = S.points(hero('ranger', lvl));
  assert.ok(P.full);
  assert.strictEqual(P.avail, 0);
  assert.strictEqual(P.paragon, 4);
  assert.ok(S.learnParagon(hero('ranger', lvl), 0));
  assert.ok(S.learnParagon(hero('ranger', lvl), 1));
  assert.ok(S.learnParagon(hero('ranger', lvl), 2));
  P = S.points(hero('ranger', lvl));
  assert.strictEqual(P.paragon, 1);
  const M = S.mods(hero('ranger', lvl));
  assert.ok(Math.abs(M.paragonDmg - 0.01) < 1e-9);
  assert.ok(Math.abs(M.gold - 0.01) < 1e-9);
  // Paragon is locked while nodes are missing.
  delete nodes['ranger.0.0'];
  reset({ skills: { nodes } });
  assert.ok(!S.learnParagon(hero('ranger', lvl + 10), 0));
});

test('the skill tree never grants XP', () => {
  reset({ gold: 1000 }, 1234);
  ui.battle.gold = 1000;
  const d = hero('warlock', 40);
  for (let i = 0; i < 10; i++) S.learn(d, i % 3, 0);
  S.respec(hero('warlock', 40));
  assert.strictEqual(L.loadState().xp, 1234);
  // Practice waves with class skills never add XP either.
  ui.xpPending = 0;
  Object.assign(ui.battle, { monsters: [], shots: [], fx: [], imps: [], wave: 0, practice: true, lastEventT: 0 });
  ui.heroX = 20; ui.heroY = 30;
  const pc = { w: 84, h: 60, set() {}, get() { return [0, 0, 0]; }, glow() {}, label() {}, rect() {} };
  const dd = { hero: { cls: 'warlock' }, lvl: 40, stats: { CHA: 80 }, state: L.loadState(), ses: { party: {} }, events: [], cfg: { theme: 'rpg' } };
  B.spawnWave(84, 54, 40);
  for (ui.tick = 0; ui.tick < 400; ui.tick++) {
    if (ui.tick % 25 === 0) { ui.cooldowns = {}; B.playerCast(dd, 1 + (ui.tick / 25) % 5); }
    B.stepBattle(dd, pc, 54, 20, [35, 36], UI.rpg, 'idle');
  }
  assert.ok(ui.battle.kills > 0);
  assert.strictEqual(ui.xpPending || 0, 0);
});

test('monster HP grows with level so fights stay a few seconds long', () => {
  assert.ok(B.hpScale(4) > B.hpScale(1));
  assert.ok(B.hpScale(40) > B.hpScale(20));
});

test('the Skills tab is exactly W wide for every class, size and theme', () => {
  reset({ bosses: 1, skills: { nodes: { 'bard.0.0': 3, 'bard.1.0': 1 } } });
  for (const cls of CLASSES) for (const [W, h] of [[50, 10], [80, 18], [100, 24], [130, 30], [180, 40]]) for (const theme of ['rpg', 'retro']) {
    for (const [b, n] of [[0, 0], [2, 4], [1, 5]]) {
      ui.skills = { b, n, p: b };
      const lines = S.skillsTab(hero(cls, 14), UI[theme], W, h);
      assert.ok(lines.length <= h);
      for (const l of lines) assert.strictEqual(L.visWidth(l), W, `${cls} ${W}x${h} ${theme}`);
    }
  }
});

test('skillsKey moves, learns and respecs with a confirm', () => {
  reset({ gold: 500 });
  ui.battle.gold = 500;
  ui.skills = { b: 0, n: 0, p: 0 };
  const d = () => hero('knight', 10);
  assert.ok(S.skillsKey('\x1b[C', d()));
  assert.strictEqual(ui.skills.b, 1);
  assert.ok(S.skillsKey('\r', d()));
  assert.strictEqual(L.loadState().game.skills.nodes['knight.1.0'], 1);
  assert.ok(S.skillsKey('\x1b[B', d()));
  assert.strictEqual(ui.skills.n, 1);
  assert.strictEqual(S.skillsKey('1', d()), false);
  // r asks first; any other key cancels.
  assert.ok(S.skillsKey('r', d()));
  assert.ok(S.skillsKey('n', d()));
  assert.strictEqual(L.loadState().game.skills.nodes['knight.1.0'], 1);
  assert.ok(S.skillsKey('r', d()));
  assert.ok(S.skillsKey('y', d()));
  assert.deepStrictEqual(L.loadState().game.skills.nodes, {});
  assert.strictEqual(L.loadState().game.gold, 400);
});

test('the hotbar loadout defaults sensibly, saves, swaps and survives a respec', () => {
  reset({ gold: 1000 });
  ui.battle.gold = 1000;
  // Low level: basic plus the first five skills (the locked ones preview).
  assert.deepStrictEqual(S.loadout(hero('mage', 4)).map((s) => s.id), ['basic', 'fireball', 'frost', 'chain', 'meteor', 'starfall']);
  // High level: basic plus the newest five known.
  assert.deepStrictEqual(S.loadout(hero('mage', 60)).map((s) => s.id), ['basic', 'barrier', 'blizzard', 'orb', 'inferno', 'timewarp']);
  assert.ok(!S.equip(hero('mage', 30), 1, 'cataclysm'), 'locked skills cannot be equipped');
  assert.ok(S.equip(hero('mage', 60), 1, 'fireball'));
  assert.strictEqual(L.loadState().game.skills.loadout[1], 'fireball');
  assert.ok(S.equip(hero('mage', 60), 2, 'fireball')); // already equipped: the slots swap
  const lo = L.loadState().game.skills.loadout;
  assert.strictEqual(lo[2], 'fireball');
  assert.strictEqual(lo[1], 'blizzard');
  assert.strictEqual(new Set(lo).size, 6);
  S.learn(hero('mage', 60), 0, 0);
  assert.ok(S.respec(hero('mage', 60)));
  assert.deepStrictEqual(L.loadState().game.skills.loadout, lo);
  // The hotbar casts from the loadout slot.
  assert.strictEqual(S.loadout(hero('mage', 60))[2].id, 'fireball');
});

test('the skill tree has 8 tiers with Awakened capstones at Lv 40', () => {
  assert.deepStrictEqual(S.TIER_LVL, [1, 4, 8, 12, 16, 20, 28, 40]);
  for (const cls of CLASSES) for (const br of S.treeFor(cls)) {
    assert.strictEqual(br.nodes.length, 8);
    assert.match(br.nodes[7].name, /^Awakened /);
    assert.strictEqual(br.nodes[7].max, 1);
  }
  reset({ skills: { nodes: {} } });
  assert.match(S.blocker(hero('knight', 30), 0, 7), /Needs level 40/);
});

test('the Skills & loadout view is exactly W wide and k toggles it', () => {
  reset({});
  ui.skills = { b: 0, n: 0, p: 0 };
  assert.ok(S.skillsKey('k', hero('rogue', 50)));
  for (const cls of CLASSES) for (const [W, h] of [[50, 10], [80, 18], [100, 24], [130, 30], [180, 40]]) {
    ui.skills.k = 11; ui.skills.slot = 5;
    const lines = S.skillsTab(hero(cls, 50), UI.rpg, W, h);
    assert.ok(lines.length <= h);
    for (const l of lines) assert.strictEqual(L.visWidth(l), W, `${cls} kit view ${W}x${h}`);
  }
  ui.skills.k = 1; ui.skills.slot = 3;
  assert.ok(S.skillsKey('e', hero('rogue', 50)));
  assert.strictEqual(S.loadout(hero('rogue', 50))[3].id, 'backstab');
  assert.ok(S.skillsKey('k', hero('rogue', 50)));
  assert.strictEqual(ui.skills.view, 'tree');
});
