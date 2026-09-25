// Shop and inventory: buying with battle gold, persisting the inventory,
// equipping into config.json, buffs, and fixed-width rendering.
// Run with: node --test
'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

// Point the game's data dir at a throwaway HOME before loading any module.
const home = fs.mkdtempSync(path.join(os.tmpdir(), 'arcade-shop-'));
process.env.HOME = home;
process.env.USERPROFILE = home;

const SCRIPTS = path.join(__dirname, '..', 'plugins', 'claude-arcade', 'scripts');
const L = require(path.join(SCRIPTS, 'lib.js'));
const X = require(path.join(SCRIPTS, 'pixel.js'));
const SP = require(path.join(SCRIPTS, 'sprites.js'));
const C = require(path.join(SCRIPTS, 'character.js'));
const { ui, UI, snapshotData } = require(path.join(SCRIPTS, 'state.js'));
const I = require(path.join(SCRIPTS, 'items.js'));
const shop = require(path.join(SCRIPTS, 'shop.js'));

const state = () => JSON.parse(fs.readFileSync(path.join(home, '.claude', 'arcade', 'state.json'), 'utf8'));
const config = () => JSON.parse(fs.readFileSync(path.join(home, '.claude', 'arcade', 'config.json'), 'utf8'));
const select = (id) => { ui.shop = { ...(ui.shop || {}), sel: I.CATALOG.findIndex((it) => it.id === id) }; };

test.before(() => {
  L.withLock(() => { const st = L.loadState(); st.xp = 250; st.game = { gold: 1000, kills: 42, bestWave: 7 }; L.saveState(st); });
  L.saveConfig({ theme: 'rpg', character: C.defaultCharacter('knight') });
  ui.battle.gold = 1000;
});

test('catalog covers every slot with priced, rarity-tagged items', () => {
  for (const slot of I.SLOTS) assert.ok(I.CATALOG.some((it) => it.slot === slot), slot);
  for (const it of I.CATALOG) {
    assert.ok(it.price > 0, it.id);
    assert.ok(I.RARITY[it.rarity], it.id);
  }
  assert.strictEqual(new Set(I.CATALOG.map((it) => it.id)).size, I.CATALOG.length);
});

test('buying deducts gold, persists the inventory and equips the item', () => {
  const d = snapshotData();
  select('crown');
  assert.strictEqual(shop.shopKey('\r', d), true);
  const crown = I.getItem('crown');
  assert.strictEqual(ui.battle.gold, 1000 - crown.price);
  assert.strictEqual(ui.dirty, true);
  const g = state().game;
  assert.deepStrictEqual(g.inventory, ['crown']);
  assert.strictEqual(g.gold, 1000 - crown.price);
  assert.strictEqual(g.kills, 42); // other game fields survive
  assert.strictEqual(g.bestWave, 7);
  assert.strictEqual(state().xp, 250); // gold never buys XP
  assert.strictEqual(config().character.equipped.hat, 'crown');
  assert.strictEqual(config().character.cls, 'knight');
  assert.strictEqual(ui.celebrate.kind, 'purchase');
  assert.match(ui.celebrate.text, /Got Royal Crown!/);
});

test('buying without enough gold changes nothing', () => {
  const before = ui.battle.gold;
  select('halo');
  shop.shopKey('\r', snapshotData());
  assert.strictEqual(ui.battle.gold, before);
  assert.deepStrictEqual(state().game.inventory, ['crown']);
});

test('enter toggles equip on owned items and u unequips', () => {
  select('crown');
  shop.shopKey('\r', snapshotData()); // owned + equipped -> unequip
  assert.strictEqual(config().character.equipped.hat, undefined);
  shop.shopKey('\r', snapshotData()); // owned -> equip, no second charge
  assert.strictEqual(config().character.equipped.hat, 'crown');
  assert.strictEqual(ui.battle.gold, 1000 - I.getItem('crown').price);
  assert.strictEqual(shop.shopKey('u', snapshotData()), true);
  assert.strictEqual(config().character.equipped.hat, undefined);
  assert.strictEqual(shop.shopKey('x', snapshotData()), false);
});

test('buffs multiply damage and gold, then wear off; they never grant XP', () => {
  ui.buffs = [];
  const d = snapshotData();
  assert.strictEqual(I.damageMultiplier(), 1);
  select('whetstone'); shop.shopKey('\r', d);
  select('luckycharm'); shop.shopKey('\r', d);
  assert.strictEqual(I.damageMultiplier(), 1.25);
  assert.strictEqual(I.goldMultiplier(), 2);
  assert.ok(!(state().game.inventory || []).includes('whetstone'));
  assert.strictEqual(state().xp, 250);
  for (let i = 0; i < 3; i++) I.consumeWave();
  assert.strictEqual(I.damageMultiplier(), 1);
  assert.strictEqual(I.goldMultiplier(), 1);
});

test('arrow keys move the selection across slots', () => {
  ui.shop = { sel: 0, cols: 3 };
  const d = snapshotData();
  shop.shopKey('\x1b[C', d);
  assert.strictEqual(ui.shop.sel, 1);
  shop.shopKey('\x1b[D', d);
  shop.shopKey('\x1b[D', d); // wraps to the last item
  assert.strictEqual(ui.shop.sel, I.CATALOG.length - 1);
  for (let i = 0; i < 40; i++) shop.shopKey(i % 3 ? '\x1b[B' : '\x1b[A', d);
  assert.ok(I.CATALOG[ui.shop.sel]);
});

test('shop tab lines are exactly W wide', () => {
  const d = snapshotData();
  for (const theme of ['rpg', 'retro']) {
    for (const W of [50, 64, 90, 120, 170]) {
      for (let sel = 0; sel < I.CATALOG.length; sel += 3) {
        ui.shop = { sel, cols: 3 };
        ui.tick = sel;
        const lines = shop.shopTab(d, UI[theme], W, 22);
        assert.ok(lines.length >= 20 && lines.length <= 22, `height ${lines.length}`);
        for (const l of lines) assert.strictEqual(L.visWidth(l), W, `W=${W} sel=${sel}`);
      }
    }
  }
});

test('equipment draws on the hero for every class and pose', () => {
  const render = (ch, pose, t) => { const pc = new X.PixelCanvas(40, 16, [0, 0, 0]); SP.drawHero(pc, ch, 14, 4, { pose, t }); return pc.px.map((c) => c.join()).join(); };
  const pick = (slot) => I.CATALOG.filter((it) => it.slot === slot);
  for (const cls of Object.keys(C.CLASSES)) {
    for (let i = 0; i < 5; i++) {
      const equipped = {};
      for (const slot of ['hat', 'back', 'aura', 'pet', 'weapon']) { const list = pick(slot); equipped[slot] = list[i % list.length].id; }
      const ch = C.defaultCharacter(cls);
      for (const pose of ['stand', 'walk1', 'cheer', 'hurt']) {
        assert.notStrictEqual(render({ ...ch, equipped }, pose, i * 7), render(ch, pose, i * 7), `${cls} ${pose}`);
      }
    }
  }
});
