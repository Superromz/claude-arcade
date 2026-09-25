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

test('arrow keys move the selection across slots and sections', () => {
  ui.shop = { sel: 0, cols: 3 };
  const d = snapshotData();
  shop.shopKey('\x1b[C', d);
  assert.strictEqual(ui.shop.sel, 1);
  shop.shopKey('\x1b[D', d);
  assert.strictEqual(ui.shop.sel, 0);
  shop.shopKey('\x1b[D', d); // before the first hat: the last Daily Deal
  const deals = shop.dailyDeals();
  assert.strictEqual(I.CATALOG[ui.shop.sel].id, deals[deals.length - 1].id);
  shop.shopKey('[', d); // previous section wraps to the Wardrobe
  assert.strictEqual(ui.shop.sel, -1);
  shop.shopKey(']', d); shop.shopKey(']', d); // Deals, then Hats
  assert.strictEqual(I.CATALOG[ui.shop.sel].slot, 'hat');
  for (let i = 0; i < 80; i++) shop.shopKey(['\x1b[B', '\x1b[A', '\x1b[C', ']'][i % 4], d);
  assert.ok(ui.shop.sel === -1 || I.CATALOG[ui.shop.sel]);
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

// ---------- the big catalog, camp, recruits, deals, sets and wardrobe ----------

const giveAll = (gold = 50000) => {
  L.withLock(() => { const st = L.loadState(); st.xp = 250; st.game = { ...(st.game || {}), gold, inventory: I.CATALOG.filter((it) => it.slot !== 'buff').map((it) => it.id) }; L.saveState(st); });
  ui.battle.gold = gold;
};
const blank = (w = 40, h = 16) => new X.PixelCanvas(w, h, [10, 10, 20]);
const sig = (pc) => pc.px.map((c) => c.join()).join();

test('the catalog is big, varied and valid in every slot', () => {
  assert.ok(I.CATALOG.length >= 126, `only ${I.CATALOG.length} items`);
  for (const slot of ['trail', 'mount', 'tent', 'banner', 'fire', 'outfit']) assert.ok(I.SLOTS.includes(slot), slot);
  for (const slot of I.SLOTS) {
    const list = I.CATALOG.filter((it) => it.slot === slot);
    assert.ok(list.length >= 5, `${slot}: ${list.length}`);
    assert.ok(new Set(list.map((it) => it.rarity)).size >= 3, `${slot} rarities`);
  }
  const need = { hat: (it) => it.rows || it.draw, back: (it) => it.draw, aura: (it) => it.draw, pet: (it) => it.draw, weapon: (it) => it.draw, trail: (it) => it.trail,
    mount: (it) => it.mount && it.mount.draw, tent: (it) => it.tent, banner: (it) => it.banner, fire: (it) => it.fire, outfit: (it) => it.outfit, buff: (it) => it.buff && it.icon };
  for (const it of I.CATALOG) {
    assert.ok(it.name && it.desc && it.price > 0 && I.RARITY[it.rarity], it.id);
    assert.ok(need[it.slot](it), `${it.id} can be drawn`);
    if (it.set) assert.ok(I.SETS[it.set], `${it.id} set ${it.set}`);
    if (it.buff) assert.ok(!('xp' in it.buff), `${it.id} never gives XP`);
  }
  for (const [name, st] of Object.entries(I.SETS)) {
    assert.ok(I.CATALOG.filter((it) => it.set === name).length >= 2, name);
    assert.ok(st.bonus && (st.bonus.dmg || st.bonus.gold) && !st.bonus.xp, `${name} bonus`);
  }
});

test('every hero item shows on the hero (trails while walking)', () => {
  const render = (ch, pose, t) => { const pc = blank(); SP.drawHero(pc, ch, 18, 4, { pose, t }); return sig(pc); };
  for (const it of I.CATALOG.filter((x) => I.HERO_SLOTS.includes(x.slot))) {
    for (const cls of ['mage', 'knight', 'rogue']) {
      const ch = C.defaultCharacter(cls);
      const pose = it.slot === 'trail' ? 'walk' : 'stand';
      const t = it.slot === 'trail' ? 3 : 5;
      assert.notStrictEqual(render({ ...ch, equipped: { [it.slot]: it.id } }, pose, t), render(ch, pose, t), `${it.id} on ${cls}`);
    }
  }
  // Trails only show while moving or attacking.
  const ch = { ...C.defaultCharacter('mage'), equipped: { trail: 'sparkletrail' } };
  ui.heroAction = null;
  assert.strictEqual(render(ch, 'stand', 40), render(C.defaultCharacter('mage'), 'stand', 40));
});

test('swatches and previews draw every item', () => {
  const hero = C.defaultCharacter('ranger');
  for (const it of I.CATALOG) {
    const a = blank(20, 5), b = blank(20, 5);
    I.drawSwatch(a, it, hero, 0, 0, 7);
    assert.notStrictEqual(sig(a), sig(b), `${it.id} swatch`);
    if (!I.HERO_SLOTS.includes(it.slot) && it.slot !== 'buff') {
      const p = blank(30, 13);
      assert.strictEqual(I.drawPreview(p, it, { ...hero, equipped: { [it.slot]: it.id } }, 4), true, it.id);
      assert.notStrictEqual(sig(p), sig(blank(30, 13)), `${it.id} preview`);
    }
  }
});

test('camp decorations: tents, banners and mounts draw at camp, fires recolor', () => {
  const plain = I.campDecor(C.defaultCharacter('mage'));
  assert.deepStrictEqual([plain.tent, plain.banner, plain.mount, plain.firePal, plain.fireGlow], [null, null, null, null, null]);
  const base = blank(120, 30);
  plain.behind(base, { hx: 40, fx: 62, floorY: 54, t: 3 });
  assert.strictEqual(sig(base), sig(blank(120, 30)), 'nothing equipped draws nothing');
  for (const it of I.CATALOG.filter((x) => ['tent', 'banner', 'mount'].includes(x.slot))) {
    for (const stage of ['stand', 'sleep']) {
      const pc = blank(120, 30);
      I.campDecor({ equipped: { [it.slot]: it.id } }, 3).behind(pc, { hx: 40, fx: 62, floorY: 54, t: 3, stage });
      assert.notStrictEqual(sig(pc), sig(blank(120, 30)), `${it.id} ${stage}`);
    }
  }
  for (const it of I.CATALOG.filter((x) => x.slot === 'fire')) {
    const dec = I.campDecor({ equipped: { fire: it.id } }, 5);
    assert.ok(dec.firePal && dec.firePal.F && dec.firePal.f && dec.firePal.r && dec.firePal.K, it.id);
    assert.ok(dec.fireGlow && dec.fireSparks.length === 2, it.id);
  }
});

test('recruit outfits tint guild recruits and give them hats', () => {
  const hero = C.defaultCharacter('mage');
  const draw = (h) => { const pc = blank(30, 12); I.drawRecruit(pc, { cls: 'knight', guild: true }, 8, 6, { id: 'g1', t: 4 }, h); return sig(pc); };
  const plainPc = blank(30, 12); SP.drawCompanion(plainPc, { cls: 'knight', guild: true }, 8, 6, { id: 'g1', t: 4 });
  assert.strictEqual(draw(hero), sig(plainPc), 'no outfit: the usual recruit');
  for (const it of I.CATALOG.filter((x) => x.slot === 'outfit')) assert.notStrictEqual(draw({ ...hero, equipped: { outfit: it.id } }), sig(plainPc), it.id);
});

test('daily deals are deterministic by date, discounted, and sometimes rare', () => {
  const day = (n) => new Date(2026, 0, 1 + n, 12);
  assert.deepStrictEqual(shop.dailyDeals(day(3)), shop.dailyDeals(new Date(2026, 0, 4, 23, 59)));
  const seen = new Set();
  let rare = 0;
  for (let n = 0; n < 365; n++) {
    const deals = shop.dailyDeals(day(n));
    assert.strictEqual(deals.length, 3);
    assert.strictEqual(new Set(deals.map((x) => x.id)).size, 3);
    for (const dl of deals) {
      const it = I.getItem(dl.id);
      assert.ok(it && it.slot !== 'buff', dl.id);
      assert.ok(dl.price < dl.was && dl.price > 0, `${dl.id} ${dl.price}/${dl.was}`);
      assert.strictEqual(dl.was, it.price);
      assert.strictEqual(!!it.loot, dl.rare, `${dl.id} rare flag`);
      seen.add(dl.id);
    }
    if (deals.some((x) => x.rare)) rare++;
  }
  assert.ok(seen.size > 60, `deals rotate (${seen.size} different items)`);
  assert.ok(rare > 10 && rare < 100, `rare deals on ${rare} days`);
});

test('buying a deal charges the deal price and persists; chest-only items need a deal', () => {
  L.withLock(() => { const st = L.loadState(); st.xp = 250; st.game = { gold: 5000, kills: 1, inventory: [] }; L.saveState(st); });
  ui.battle.gold = 5000;
  const d = snapshotData();
  const deal = shop.dailyDeals()[0];
  shop.select('deals');
  assert.strictEqual(shop.shopKey('\r', d), true);
  assert.strictEqual(ui.battle.gold, 5000 - deal.price);
  assert.ok(state().game.inventory.includes(deal.id));
  assert.strictEqual(state().game.gold, 5000 - deal.price);
  assert.strictEqual(state().xp, 250);
  // A chest-only item can't be bought normally...
  assert.strictEqual(shop.buy('phoenixwings', d), false);
  // ...and a deal that isn't on today's list is refused.
  if (!shop.dailyDeals().some((x) => x.id === 'phoenixwings')) assert.strictEqual(shop.buy('phoenixwings', d, { deal: true }), false);
  // On a rare-deal day it can be.
  let n = 0; while (!shop.dailyDeals(new Date(2027, 0, 1 + n)).some((x) => x.rare)) n++;
  const date = new Date(2027, 0, 1 + n), rareDeal = shop.dailyDeals(date).find((x) => x.rare);
  const gold = ui.battle.gold;
  assert.strictEqual(shop.buy(rareDeal.id, snapshotData(), { deal: true, date }), true);
  assert.strictEqual(ui.battle.gold, gold - rareDeal.price);
  assert.ok(state().game.inventory.includes(rareDeal.id));
});

test('set bonuses: a small damage or gold boost, never XP', () => {
  giveAll();
  ui.buffs = [];
  const hero = { ...C.defaultCharacter('mage'), equipped: { hat: 'beanie', aura: 'coffeeaura' } };
  ui.frameData = { hero };
  assert.strictEqual(I.goldMultiplier(), 1, 'two pieces: not yet');
  hero.equipped.pet = 'duck';
  assert.ok(Math.abs(I.goldMultiplier() - 1.05) < 1e-9, 'Night Shift: +5% gold');
  assert.strictEqual(I.damageMultiplier(), 1);
  const st = I.setStatus(hero).find((x) => x.name === 'Night Shift');
  assert.deepStrictEqual([st.have, st.need, st.active], [3, 3, true]);
  hero.equipped = { hat: 'socrown', back: 'mergecape', weapon: 'wgreen' };
  assert.ok(Math.abs(I.damageMultiplier() - 1.05) < 1e-9, 'Ship It: +5% damage');
  // The set flair draws around the hero.
  const a = blank(), b = blank();
  SP.drawHero(a, hero, 18, 4, { t: 3 });
  SP.drawHero(b, { ...hero, equipped: { hat: 'socrown', back: 'mergecape' } }, 18, 4, { t: 3 });
  assert.notStrictEqual(sig(a), sig(b));
  ui.frameData = null;
  assert.strictEqual(state().xp, 250);
});

test('the wardrobe saves up to three outfits and switches between them', () => {
  giveAll();
  L.saveConfig({ theme: 'rpg', character: { ...C.defaultCharacter('knight'), equipped: { hat: 'cowboy', mount: 'pony', tent: 'tent_teepee' } } });
  let d = snapshotData();
  shop.select('wardrobe');
  assert.strictEqual(shop.shopKey('\r', d), true); // empty slot: save the current look
  assert.deepStrictEqual(state().game.outfits[0], { hat: 'cowboy', mount: 'pony', tent: 'tent_teepee' });
  shop.shopKey('\x1b[C', d); // Outfit 2
  shop.equip('socrown', d); shop.equip('rocket', d);
  assert.strictEqual(shop.shopKey('s', d), true);
  assert.strictEqual(state().game.outfits[1].hat, 'socrown');
  assert.strictEqual(shop.wearOutfit(0, d), true);
  assert.deepStrictEqual(L.loadConfig().character.equipped, { hat: 'cowboy', mount: 'pony', tent: 'tent_teepee' });
  assert.strictEqual(shop.wearOutfit(1, d), true);
  assert.strictEqual(L.loadConfig().character.equipped.mount, 'rocket');
  assert.strictEqual(shop.wearOutfit(2, d), false, 'empty slot');
  // Pieces you no longer own are skipped.
  L.withLock(() => { const st = L.loadState(); st.game.inventory = st.game.inventory.filter((id) => id !== 'pony'); L.saveState(st); });
  d = snapshotData();
  shop.wearOutfit(0, d);
  assert.deepStrictEqual(L.loadConfig().character.equipped, { hat: 'cowboy', tent: 'tent_teepee' });
  assert.strictEqual(shop.clearOutfit(1, d), true);
  assert.strictEqual(state().game.outfits[1], null);
  assert.strictEqual(state().xp, 250);
});

test('every section renders exactly W wide', () => {
  giveAll(300);
  L.withLock(() => { const st = L.loadState(); st.game.outfits = [{ hat: 'froghat', trail: 'comet' }, null, { mount: 'unicorn' }]; st.game.materials = { slime: 3, ember: 9 }; L.saveState(st); });
  const d = snapshotData();
  const G = shop.groups();
  for (const theme of ['rpg', 'space', 'retro']) {
    for (const W of [50, 64, 90, 110, 130, 170, 220]) {
      for (let g = 0; g < G.length; g++) {
        for (let i = 0; i < G[g].items.length; i += 4) {
          ui.shop = { g, i, top: 0, cols: 3 };
          ui.tick = i + g;
          const lines = shop.shopTab(d, UI[theme], W, 22);
          for (const l of lines) assert.strictEqual(L.visWidth(l), W, `${theme} W=${W} ${G[g].id}#${i}`);
        }
      }
    }
  }
});

test('recruit outfits and camp items are bought like any cosmetic', () => {
  L.withLock(() => { const st = L.loadState(); st.xp = 250; st.game = { gold: 2000, inventory: [] }; L.saveState(st); });
  ui.battle.gold = 2000;
  const d = snapshotData();
  for (const id of ['of_pirate', 'tent_igloo', 'fire_blue', 'pony']) {
    shop.select(id);
    assert.strictEqual(shop.shopKey('\r', d), true);
    assert.ok(state().game.inventory.includes(id), id);
    assert.strictEqual(L.loadConfig().character.equipped[I.getItem(id).slot], id);
  }
  assert.strictEqual(ui.battle.gold, 2000 - ['of_pirate', 'tent_igloo', 'fire_blue', 'pony'].reduce((n, id) => n + I.getItem(id).price, 0));
  assert.strictEqual(state().xp, 250);
});
