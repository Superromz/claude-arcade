// Loot chests: tiers by difficulty, saved rewards, duplicates, practice
// chests, the chest overlay's line widths, and crafting in the shop.
// Run with: node --test
'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

// Point the game's data dir at a throwaway HOME before loading any module.
const home = fs.mkdtempSync(path.join(os.tmpdir(), 'arcade-loot-'));
Object.assign(process.env, { HOME: home, USERPROFILE: home, APPDATA: home, ARCADE_NO_CLIPBOARD: '1' });
delete process.env.ARCADE_LOOT;

const SCRIPTS = path.join(__dirname, '..', 'plugins', 'claude-arcade', 'scripts');
const L = require(path.join(SCRIPTS, 'lib.js'));
const C = require(path.join(SCRIPTS, 'character.js'));
const I = require(path.join(SCRIPTS, 'items.js'));
const { ui, UI, RESET, bg, fg } = require(path.join(SCRIPTS, 'state.js'));
const shop = require(path.join(SCRIPTS, 'shop.js'));
const Lt = require(path.join(SCRIPTS, 'loot.js'));

const state = () => JSON.parse(fs.readFileSync(path.join(home, '.claude', 'arcade', 'state.json'), 'utf8'));
const tierIndex = (id) => Lt.TIERS.findIndex((t) => t.id === id);
const lootEvents = () => L.readEvents(400).filter((e) => e.kind === 'quest' && /🎁/.test(e.text));

function freshGame(extra = {}) {
  L.withLock(() => { const st = L.loadState(); st.xp = 500; st.game = { gold: 100, kills: 7, bestWave: 3, inventory: [], ...extra }; L.saveState(st); });
  L.saveConfig({ theme: 'rpg', character: C.defaultCharacter('knight') });
  Object.assign(ui.battle, { gold: 100, wave: 0, monsters: [], practice: false, finisher: null });
  ui.loot = null; ui.celebrate = null; ui.levelUp = null; ui.buffs = []; ui.xpPending = 0; ui.tick = 0;
}
const heroD = (ses) => ({ sid: 's1', ses, lvl: 5, hero: C.defaultCharacter('knight'), state: L.loadState() });
const monster = (hp, extra = {}) => ({ hp, max: 10, x: 50, y: 10, ...extra });

test('chest tiers rise with difficulty', () => {
  // Waves: later waves, elite waves and bosses all climb.
  const w = (o) => tierIndex(Lt.tierFor(Lt.waveScore(o), 'wave').tier);
  assert.strictEqual(w({ wave: 1, lvl: 1 }), 0);
  assert.ok(w({ wave: 5, lvl: 5 }) > w({ wave: 4, lvl: 5 }), 'elite wave beats the wave before');
  assert.ok(w({ wave: 12, lvl: 10 }) >= w({ wave: 5, lvl: 5 }));
  assert.ok(w({ wave: 12, bosses: 1, lvl: 10 }) > w({ wave: 12, lvl: 10 }));
  assert.ok(w({ wave: 99, bosses: 3, lvl: 50 }) <= tierIndex('epic'), 'a wave alone tops out at Epic');
  // Quests: a quick answer is Wooden, a long hard task is Legendary.
  const now = Date.now();
  const q = (turn, o = {}) => tierIndex(Lt.tierFor(Lt.questScore({ start: now - (turn.secs || 5) * 1000, fails: 0, ...turn }, { end: now, lvl: 1, ...o }), 'quest').tier);
  const quick = q({ secs: 5 });
  const medium = q({ secs: 180, editing: 6, reading: 6 });
  const big = q({ secs: 600, editing: 15, running: 10, reading: 10, fails: 2, tokens: 60, summoning: 2 });
  const epic = q({ secs: 900, editing: 20, running: 10, reading: 10, fails: 3, tokens: 120, summoning: 3 }, { bosses: 1 });
  assert.strictEqual(quick, 0);
  assert.ok(medium > quick && big > medium && epic >= big, `${quick} ${medium} ${big} ${epic}`);
  assert.strictEqual(epic, tierIndex('legendary'));
});

test('better tiers roll better rewards', () => {
  const avg = (tier) => {
    const rng = Lt.seeded(42);
    let gold = 0, gear = 0;
    for (let i = 0; i < 200; i++) { const r = Lt.rollChest({ kind: 'quest', tier, q: 0.5, lvl: 1 }, rng); gold += r.gold; gear += r.items.length + r.dupes.length; }
    return { gold: gold / 200, gear: gear / 200 };
  };
  const res = Lt.TIERS.map((t) => avg(t.id));
  for (let i = 1; i < res.length; i++) {
    assert.ok(res[i].gold > res[i - 1].gold, `gold ${Lt.TIERS[i].id}`);
    assert.ok(res[i].gear > res[i - 1].gear, `gear ${Lt.TIERS[i].id}`);
  }
  const r = Lt.rollChest({ kind: 'quest', tier: 'legendary', q: 1 }, Lt.seeded(3));
  assert.ok(r.items.length + r.dupes.length >= 1, 'legendary chests always hold gear');
  assert.ok((r.mats.starlight || 0) >= 1, 'legendary quest chests always hold Starlight Dust');
  assert.match(r.text, /^🎁 (Legendary) Chest/);
});

test('a cleared wave gives a chest that is saved, logged once and never gives XP', () => {
  freshGame();
  const ses = { mode: 'running', since: Date.now(), turn: { start: Date.now() } };
  Lt.lootTick(heroD(ses)); // first tick only takes note of what's on screen
  ui.battle.wave = 3;
  ui.battle.monsters = [monster(5), monster(5)];
  Lt.lootTick(heroD(ses));
  assert.strictEqual(ui.battle.gold, 100, 'nothing while monsters stand');
  ui.battle.monsters.forEach((m) => { m.hp = 0; });
  const events = lootEvents().length;
  Lt.lootTick(heroD(ses));
  assert.ok(ui.battle.gold > 100, 'gold added to the purse');
  assert.strictEqual(ui.dirty, true);
  const g = state().game;
  assert.strictEqual(g.gold, ui.battle.gold);
  assert.ok(Object.values(g.materials || {}).reduce((a, b) => a + b, 0) >= 1, 'materials saved as counts');
  assert.strictEqual(g.kills, 7); // other game fields survive
  assert.strictEqual(g.bestWave, 3);
  assert.strictEqual(state().xp, 500, 'chests never give XP');
  assert.strictEqual(ui.xpPending, 0);
  assert.strictEqual(lootEvents().length, events + 1);
  assert.match(lootEvents().pop().text, /Chest \(wave 3\)/);
  const gold = ui.battle.gold;
  for (let i = 0; i < 5; i++) Lt.lootTick(heroD(ses));
  assert.strictEqual(ui.battle.gold, gold, 'a wave pays out once');
  ui.battle.wave = 0; Lt.lootTick(heroD(ses));
  assert.strictEqual(ui.loot.lastWave, 0, 'resets with the wave counter');
});

test('practice waves give a small Wooden chest with no gear or buffs', () => {
  for (let seed = 1; seed < 60; seed++) {
    const r = Lt.rollChest({ kind: 'wave', tier: 'epic', q: 1, practice: true, lvl: 5, wave: 2 }, Lt.seeded(seed));
    assert.strictEqual(r.tier, 'wooden');
    assert.strictEqual(r.upgraded, false);
    assert.deepStrictEqual([r.items, r.dupes, r.buffs], [[], [], []]);
    assert.ok(r.gold >= 4 && r.gold <= 12, `gold ${r.gold}`);
    assert.ok(Object.keys(r.mats).every((m) => m === 'slime' || m === 'bone'));
  }
  // lootTick remembers the practice flag even though battle.js clears it the moment the wave falls.
  freshGame();
  const ses = { mode: 'idle', since: Date.now() - 60000 };
  Lt.lootTick(heroD(ses));
  Object.assign(ui.battle, { wave: 1, practice: true, monsters: [monster(3)] });
  Lt.lootTick(heroD(ses));
  ui.battle.monsters[0].hp = 0; ui.battle.practice = false;
  Lt.lootTick(heroD(ses));
  assert.match(lootEvents().pop().text, /Wooden Chest \(practice wave 1\)/);
  assert.strictEqual(state().xp, 500);
});

test('duplicates of owned gear convert into gold and materials', () => {
  const all = I.CATALOG.filter((it) => it.slot !== 'buff').map((it) => it.id);
  let dupes = 0;
  for (let seed = 1; seed < 40; seed++) {
    const r = Lt.rollChest({ kind: 'quest', tier: 'legendary', q: 1, owned: all }, Lt.seeded(seed));
    assert.deepStrictEqual(r.items, []);
    for (const d of r.dupes) {
      dupes++;
      assert.strictEqual(d.gold, Math.round(I.getItem(d.id).price * 0.25));
      assert.ok(r.gold >= d.gold);
      assert.ok(r.mats[d.mat] >= d.n);
    }
  }
  assert.ok(dupes > 0);
  // Saving a chest with a duplicate keeps the inventory as it was.
  freshGame({ inventory: ['crown'] });
  const r = Lt.rollChest({ kind: 'quest', tier: 'legendary', owned: all }, Lt.seeded(5));
  Lt.applyReward(r, heroD({}));
  assert.deepStrictEqual(state().game.inventory, ['crown']);
  assert.strictEqual(state().xp, 500);
});

test('a finished quest opens a quest chest; keys reveal, then close it', () => {
  freshGame();
  const start = Date.now() - 300000;
  const ses = { mode: 'thinking', since: Date.now() - 1000, turn: { start, fails: 1, xp: 90, editing: 8, running: 5, reading: 6 } };
  Lt.lootTick(heroD(ses));
  assert.strictEqual(ui.battle.gold, 100);
  ses.mode = 'victory'; ses.since = Date.now();
  ui.battle.finisher = { t: 3 }; // wait for the boss finisher before opening
  Lt.lootTick(heroD(ses));
  assert.strictEqual(ui.battle.gold, 100);
  ui.battle.monsters = [monster(0, { boss: true })]; // the boss falls
  ui.battle.finisher = null;
  ui.tick++;
  Lt.lootTick(heroD(ses));
  assert.ok(ui.battle.gold > 100);
  const ev = lootEvents().pop();
  assert.match(ev.text, /^🎁 (Iron|Gold|Epic|Legendary) Chest/, 'a long task with a boss is worth more than Wooden');
  assert.strictEqual(ev.sid, 's1');
  const gold = ui.battle.gold;
  for (let i = 0; i < 5; i++) { ui.tick++; Lt.lootTick(heroD(ses)); }
  assert.strictEqual(ui.battle.gold, gold, 'one chest per quest');
  // The overlay shows it; the first key fast-forwards, the next closes.
  const lines = frame(100, 30);
  const out = Lt.lootOverlay(lines, {}, UI.rpg, 100, 30);
  assert.notDeepStrictEqual(out, lines);
  assert.strictEqual(Lt.lootKey('x'), true);
  assert.strictEqual(Lt.lootKey('x'), true);
  assert.strictEqual(Lt.lootKey('x'), false);
  assert.strictEqual(state().xp, 500);
});

test('wave popups do not take keys', () => {
  ui.loot = null; ui.tick = 0;
  Lt.present(Lt.sample('iron', 'wave'));
  Lt.lootOverlay(frame(100, 30), {}, UI.rpg, 100, 30);
  assert.strictEqual(Lt.lootKey('1'), false);
});

// A busy synthetic frame: panels, half-block pixels and a wide emoji.
function frame(W, H) {
  return Array.from({ length: H }, (_, i) => {
    let s = `${bg([20 + i, 18, 30])}${fg([230, 220, 200])}`;
    let w = 0;
    if (i % 5 === 1) { s += '🎁 quest'; w += 8; }
    while (w < W) { s += i % 2 ? `${fg([i * 8, 90, 200])}▀` : 'a'; w++; }
    return s + RESET;
  });
}

test('chest overlay lines are exactly W wide at every size, tier and age', () => {
  for (const kind of ['quest', 'wave']) {
    for (const t of Lt.TIERS) {
      const r = Lt.sample(t.id, kind);
      for (const [W, H] of [[50, 14], [60, 22], [80, 24], [100, 30], [120, 34], [150, 44], [200, 60]]) {
        for (let age = 0; age < Lt.duration(r); age += 3) {
          ui.loot = { init: true, queue: [], cur: { ...r, t0: 0 } };
          ui.tick = age;
          const lines = frame(W, H);
          const out = Lt.lootOverlay(lines, {}, UI.rpg, W, H);
          assert.strictEqual(out.length, H);
          out.forEach((l, i) => assert.strictEqual(L.visWidth(l), W, `${kind} ${t.id} ${W}x${H} age ${age} row ${i}`));
        }
      }
    }
  }
  ui.loot = null;
});

test('crafting turns materials into chest-only items; they are never sold', () => {
  freshGame({ materials: { slime: 7, bone: 1 } });
  const d = heroD({});
  const sel = (id) => { ui.shop = { sel: I.CATALOG.findIndex((it) => it.id === id), cols: 3, top: 0 }; };
  // Chest-only items can't be bought with gold.
  assert.strictEqual(shop.buy('phoenixwings', d), false);
  assert.strictEqual(ui.battle.gold, 100);
  // Not enough materials: nothing changes.
  sel('skullhelm'); shop.shopKey('\r', d);
  assert.deepStrictEqual(state().game.materials, { slime: 7, bone: 1 });
  assert.ok(!(state().game.inventory || []).includes('skullhelm'));
  // Enough: materials are spent, the item is kept and worn.
  sel('slimecrown'); assert.strictEqual(shop.shopKey('\r', d), true);
  assert.deepStrictEqual(state().game.materials, { slime: 1, bone: 1 });
  assert.ok(state().game.inventory.includes('slimecrown'));
  assert.strictEqual(L.loadConfig().character.equipped.hat, 'slimecrown');
  assert.strictEqual(ui.battle.gold, 100, 'crafting costs no gold');
  assert.strictEqual(state().xp, 500, 'crafting never gives XP');
  assert.strictEqual(shop.craft('slimecrown', d), false, 'no crafting what you own');
  // Every loot-only piece is either craftable or chest-only, and belongs to a set if it's gear.
  for (const it of I.CATALOG.filter((x) => x.loot)) {
    if (it.craft) for (const m of Object.keys(it.craft)) assert.ok(I.getMaterial(m), `${it.id} needs ${m}`);
    if (it.slot !== 'buff') assert.ok(I.SETS[it.set], it.id);
  }
});
