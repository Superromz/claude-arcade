'use strict';
// Shop tab: spend battle gold on cosmetics (shown on the hero, at camp and on
// guild recruits) and battle buffs, craft chest-only items from materials,
// grab today's Daily Deals, and save up to three outfits in the Wardrobe.
// Cards are grouped into sections (Deals, one per slot, Wardrobe); the left
// panel previews the selected item.

const L = require('./lib');
const X = require('./pixel');
const C = require('./character');
const SP = require('./sprites');
const I = require('./items');
const { RESET, bg, ui } = require('./state');
const { panelLine, truncVis } = require('./panels');

const PREVIEW_W = 30;
const CARD_MIN = 20;
const CARD_H = 8; // 5 swatch lines + name + price + spacer
const OUTFIT_SLOTS = 3;

const shop = () => (ui.shop ||= { g: 0, i: 0, top: 0, cols: 3, msg: null });
const inSlot = (slot) => I.CATALOG.filter((it) => it.slot === slot);

// ---------- persistence ----------

const inventory = (state) => ((state && state.game && state.game.inventory) || []).slice();
const owns = (state, id) => inventory(state).includes(id);
const materials = (state) => ({ ...((state && state.game && state.game.materials) || {}) });
const outfits = (state) => { const o = (state && state.game && state.game.outfits) || []; return Array.from({ length: OUTFIT_SLOTS }, (_, i) => o[i] || null); };

// What a recipe still needs: [{ id, name, need, have, color }].
function recipe(it, state) {
  const have = materials(state);
  return Object.entries(it.craft || {}).map(([id, need]) => ({ id, need, have: have[id] || 0, ...I.getMaterial(id) }));
}
const canCraft = (it, state) => !!it.craft && recipe(it, state).every((m) => m.have >= m.need);

function note(text, good = false) { shop().msg = { text, good, until: ui.tick + 30 }; }

// Update state.game under the lock, keeping every other field. fn returning
// false cancels the write.
function writeGame(d, fn) {
  let ok = false;
  L.withLock(() => {
    const st = L.loadState();
    const game = { ...(st.game || {}) };
    if (fn(game, st) === false) return;
    st.game = game;
    L.saveState(st);
    d.state = st;
    ok = true;
  });
  return ok;
}

// ---------- daily deals ----------

// Local calendar day, so deals turn over at the player's midnight.
function dayKey(date = new Date()) {
  const p = (n) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${p(date.getMonth() + 1)}-${p(date.getDate())}`;
}
function hashStr(str) { let h = 2166136261; for (const ch of str) { h ^= ch.charCodeAt(0); h = Math.imul(h, 16777619); } return h >>> 0; }
function rng(seed) { let a = seed >>> 0; return () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
const round5 = (n) => Math.max(5, Math.round(n / 5) * 5);
const CUTS = [20, 25, 30, 35, 40, 50];
const RARE_DEAL = 0.12;

// Three discounted cosmetics from three different slots, the same for
// everyone on the same day. On about 12% of days the third deal is a
// normally chest-only item, sold at 10% under its worth.
const dealCache = new Map();
function dailyDeals(date = new Date()) {
  const key = dayKey(date);
  if (dealCache.has(key)) return dealCache.get(key).map((x) => ({ ...x }));
  const r = rng(hashStr(`deals:${key}`));
  const pool = I.CATALOG.filter((it) => !it.loot && it.slot !== 'buff');
  const picks = [], slots = new Set();
  for (let guard = 0; picks.length < 3 && guard < 300; guard++) {
    const it = pool[Math.floor(r() * pool.length)];
    if (picks.some((p) => p.id === it.id) || (slots.has(it.slot) && guard < 150)) continue;
    slots.add(it.slot);
    const pct = CUTS[Math.floor(r() * CUTS.length)];
    picks.push({ id: it.id, pct, was: it.price, price: round5((it.price * (100 - pct)) / 100), rare: false, key });
  }
  if (r() < RARE_DEAL) {
    const loot = I.CATALOG.filter((it) => it.loot && it.slot !== 'buff');
    const it = loot[Math.floor(r() * loot.length)];
    picks[2] = { id: it.id, pct: 10, was: it.price, price: round5(it.price * 0.9), rare: true, key };
  }
  if (dealCache.size > 8) dealCache.clear();
  dealCache.set(key, picks);
  return picks.map((x) => ({ ...x }));
}

function untilMidnight(now = new Date()) {
  const next = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);
  const mins = Math.max(0, Math.round((next - now) / 60000));
  return `${Math.floor(mins / 60)}h ${mins % 60}m`;
}

// ---------- buying, crafting, equipping ----------

// Buy an item with battle gold. Cosmetics go to state.json game.inventory
// and are equipped right away; buffs go to ui.buffs. opts.deal buys it at
// today's Daily Deal price (the only way to buy a chest-only item).
// Returns true on success. Never touches XP.
function buy(id, d, opts = {}) {
  const it = I.getItem(id);
  if (!it) return false;
  const deal = opts.deal ? dailyDeals(opts.date).find((x) => x.id === id) : null;
  if (opts.deal && !deal) { note('That deal has ended'); return false; }
  if (it.loot && !deal) { note(it.craft ? 'Craft it from materials' : 'Found in chests only'); return false; }
  if (it.slot !== 'buff' && owns(d.state, id)) return false;
  const price = deal ? deal.price : it.price;
  const gold = ui.battle.gold || 0;
  if (gold < price) { note(`Need ◉ ${price - gold} more gold`); return false; }
  ui.battle.gold = gold - price;
  ui.dirty = true;
  writeGame(d, (game, st) => {
    game.gold = ui.battle.gold;
    if (it.slot !== 'buff') game.inventory = [...new Set([...inventory(st), id])];
  });
  if (it.slot === 'buff') I.addBuff(id); else equip(id, d);
  ui.celebrate = { kind: 'purchase', text: `Got ${it.name}!${deal ? ` (-${deal.pct}%)` : ''}`, until: ui.tick + 20 };
  note(`Got ${it.name}!`, true);
  return true;
}

// Craft a chest-only item from materials (state.game.materials) and equip
// it. Returns true on success. Never touches gold or XP.
function craft(id, d) {
  const it = I.getItem(id);
  if (!it || !it.loot || !it.craft || it.slot === 'buff' || owns(d.state, id)) return false;
  const short = recipe(it, d.state).find((m) => m.have < m.need);
  if (short) { note(`Need ${short.need - short.have} more ${short.name}`); return false; }
  const ok = writeGame(d, (game, st) => {
    const mats = { ...(game.materials || {}) };
    if (!Object.entries(it.craft).every(([m, n]) => (mats[m] || 0) >= n)) return false;
    for (const [m, n] of Object.entries(it.craft)) mats[m] -= n;
    game.materials = mats;
    game.crafted = (game.crafted || 0) + 1;
    game.inventory = [...new Set([...inventory(st), id])];
  });
  if (!ok) return false;
  equip(id, d);
  ui.celebrate = { kind: 'purchase', text: `Crafted ${it.name}!`, until: ui.tick + 20 };
  note(`Crafted ${it.name}!`, true);
  return true;
}

// Write character.equipped in config.json.
function setEquipped(d, fn) {
  const cfg = L.loadConfig();
  const base = cfg.character || { ...(d.hero || C.defaultCharacter()) };
  const equipped = fn({ ...(base.equipped || {}) });
  for (const k of Object.keys(equipped)) if (!equipped[k]) delete equipped[k];
  cfg.character = { ...base, equipped };
  L.saveConfig(cfg);
  d.cfg = cfg;
  d.hero = { ...(d.hero || C.getCharacter(cfg)), equipped };
}

function equip(id, d) {
  const it = I.getItem(id);
  if (!it || it.slot === 'buff' || !owns(d.state, id)) return false;
  setEquipped(d, (e) => ({ ...e, [it.slot]: id }));
  return true;
}

function unequip(slot, d) {
  if (!((d.hero && d.hero.equipped) || {})[slot]) return false;
  setEquipped(d, (e) => ({ ...e, [slot]: null }));
  return true;
}

// ---------- wardrobe (saved outfits, per hero in state.game.outfits) ----------

// Only owned cosmetics in their own slot count as part of a look.
function cleanLook(look, state) {
  const out = {};
  for (const [slot, id] of Object.entries(look || {})) {
    const it = I.getItem(id);
    if (it && it.slot === slot && slot !== 'buff' && owns(state, id)) out[slot] = id;
  }
  return out;
}

function saveOutfit(n, d) {
  if (!(n >= 0 && n < OUTFIT_SLOTS)) return false;
  const look = cleanLook((d.hero && d.hero.equipped) || {}, d.state);
  const ok = writeGame(d, (game) => {
    const list = outfits({ game });
    list[n] = look;
    game.outfits = list;
  });
  if (ok) note(`Saved Outfit ${n + 1} (${Object.keys(look).length} pieces)`, true);
  return ok;
}

function wearOutfit(n, d) {
  const look = outfits(d.state)[n];
  if (!look) { note(`Outfit ${n + 1} is empty`); return false; }
  const eq = cleanLook(look, d.state);
  setEquipped(d, () => ({ ...eq }));
  note(`Wearing Outfit ${n + 1}`, true);
  return true;
}

function clearOutfit(n, d) {
  if (!outfits(d.state)[n]) return false;
  const ok = writeGame(d, (game) => { const list = outfits({ game }); list[n] = null; game.outfits = list; });
  if (ok) note(`Cleared Outfit ${n + 1}`);
  return ok;
}

const sameLook = (a, b) => { const ka = Object.keys(a || {}), kb = Object.keys(b || {}); return ka.length === kb.length && ka.every((k) => a[k] === b[k]); };

// ---------- sections and selection ----------

// Deals, one section per slot, then the Wardrobe. Items in Deals carry
// `deal`; Wardrobe entries carry `outfit` (0-2).
function groups() {
  return [
    { id: 'deals', name: 'Deals', items: dailyDeals().map((dl) => ({ ...I.getItem(dl.id), deal: dl })) },
    ...I.SLOTS.map((slot) => ({ id: slot, name: I.SLOT_NAMES[slot], items: inSlot(slot) })),
    { id: 'wardrobe', name: 'Wardrobe', items: Array.from({ length: OUTFIT_SLOTS }, (_, n) => ({ id: `outfit:${n}`, wardrobe: n, name: `Outfit ${n + 1}`, slot: 'wardrobe', rarity: 'common', desc: '' })) },
  ];
}

// The current selection. `ui.shop.sel` (a CATALOG index) still works: when
// something sets it, the cursor jumps to that item in its slot section.
function cursor() {
  const s = shop(), G = groups();
  if (typeof s.sel === 'number' && s.sel !== s._sel) {
    const it = I.CATALOG[s.sel];
    if (it) { s.g = G.findIndex((g) => g.id === it.slot); s.i = G[s.g].items.findIndex((x) => x.id === it.id); }
    s._sel = s.sel;
  }
  if (!(s.g >= 0 && s.g < G.length)) s.g = 0;
  s.i = Math.max(0, Math.min(G[s.g].items.length - 1, s.i || 0));
  return { s, G, grp: G[s.g], it: G[s.g].items[s.i] };
}
function sync(s, G) { const it = G[s.g].items[s.i]; s.sel = s._sel = it && it.wardrobe === undefined ? I.CATALOG.findIndex((x) => x.id === it.id) : -1; }

// Select an item (in its slot section), or a section by id ('deals', 'wardrobe', 'hat', ...).
function select(id) {
  const s = shop(), G = groups();
  const g = G.findIndex((x) => x.id === id);
  if (g >= 0) { s.g = g; s.i = 0; }
  else { const it = I.getItem(id); if (!it) return false; s.g = G.findIndex((x) => x.id === it.slot); s.i = G[s.g].items.findIndex((x) => x.id === id); }
  sync(s, G);
  return true;
}

function move(dir) {
  const { s, G, grp } = cursor();
  const cols = Math.max(1, s.cols || 1), n = grp.items.length;
  if (dir === 'right') { if (s.i + 1 < n) s.i++; else { s.g = (s.g + 1) % G.length; s.i = 0; } }
  else if (dir === 'left') { if (s.i > 0) s.i--; else { s.g = (s.g + G.length - 1) % G.length; s.i = G[s.g].items.length - 1; } }
  else if (dir === 'down') {
    if (s.i + cols < n) s.i += cols;
    else if (Math.floor(s.i / cols) < Math.floor((n - 1) / cols)) s.i = n - 1;
    else { const col = s.i % cols; s.g = (s.g + 1) % G.length; s.i = Math.min(col, G[s.g].items.length - 1); }
  } else if (dir === 'up') {
    if (s.i - cols >= 0) s.i -= cols;
    else {
      const col = s.i % cols;
      s.g = (s.g + G.length - 1) % G.length;
      const m = G[s.g].items.length, lastRow = Math.floor((m - 1) / cols) * cols;
      s.i = Math.min(lastRow + col, m - 1);
    }
  } else if (dir === 'next' || dir === 'prev') { s.g = (s.g + (dir === 'next' ? 1 : G.length - 1)) % G.length; s.i = 0; s.top = 0; }
  sync(s, G);
}

// ---------- keys ----------

const isEnter = (key) => key === '\r' || key === '\n';

function wardrobeKey(key, n, d) {
  if (isEnter(key)) { if (outfits(d.state)[n]) wearOutfit(n, d); else saveOutfit(n, d); return true; }
  if (key === 's') { saveOutfit(n, d); return true; }
  if (key === 'x') { clearOutfit(n, d); return true; }
  return false;
}

// Returns true when the key was handled by the shop.
function shopKey(key, d) {
  const dirs = { '\x1b[C': 'right', '\x1b[D': 'left', '\x1b[A': 'up', '\x1b[B': 'down', ']': 'next', '[': 'prev', '\x1b[6~': 'next', '\x1b[5~': 'prev' };
  if (dirs[key]) { move(dirs[key]); return true; }
  const { it } = cursor();
  if (it.wardrobe !== undefined) return wardrobeKey(key, it.wardrobe, d);
  if (isEnter(key)) {
    const owned = owns(d.state, it.id);
    if (it.deal && !owned && it.slot !== 'buff') buy(it.id, d, { deal: true });
    else if (it.loot && !owned) { if (it.slot === 'buff' || !it.craft) note('Found in chests only'); else craft(it.id, d); }
    else if (it.slot === 'buff' || !owned) buy(it.id, d);
    else if (((d.hero && d.hero.equipped) || {})[it.slot] === it.id) { unequip(it.slot, d); note(`Unequipped ${it.name}`); }
    else { equip(it.id, d); note(`Equipped ${it.name}`, true); }
    return true;
  }
  if (key === 'u') {
    if (unequip(it.slot, d)) note(`Unequipped ${(I.SLOT_NAMES[it.slot] || it.slot).toLowerCase()}`);
    return true;
  }
  return false;
}

// ---------- rendering ----------

function wrap(text, w) {
  const out = [''];
  for (const word of String(text || '').split(' ')) {
    const cur = out[out.length - 1];
    if (cur && L.visWidth(cur + ' ' + word) > w) out.push(word); else out[out.length - 1] = cur ? `${cur} ${word}` : word;
  }
  return out;
}

// Compact recipe for a card: "◆6 ◆2" in material colors.
const recipeParts = (it, d, pal) => recipe(it, d.state).flatMap((m, i) => [[`${i ? ' ' : ''}◆`, m.color, true], [`${m.need}`, m.have >= m.need ? pal.text : pal.bad]]);
const rarityColor = (it) => (I.RARITY[it.rarity] || I.RARITY.common).color;

function cardState(it, d, pal) {
  if (it.wardrobe !== undefined) {
    const look = outfits(d.state)[it.wardrobe];
    if (!look) return [['Empty · Enter save', pal.dim]];
    const n = Object.keys(look).length;
    return sameLook(cleanLook(look, d.state), (d.hero && d.hero.equipped) || {}) ? [['✓ Wearing', pal.good, true], [` · ${n} pieces`, pal.dim]] : [[`${n} piece${n === 1 ? '' : 's'}`, pal.text]];
  }
  const eq = ((d.hero && d.hero.equipped) || {})[it.slot] === it.id;
  const owned = owns(d.state, it.id);
  if (it.deal && !owned && !eq) {
    const g = (ui.battle.gold || 0) >= it.deal.price ? pal.gold : pal.bad;
    return [...(it.deal.rare ? [['✦', pal.magic, true]] : []), [`◉ ${it.deal.price}`, g, true], [` -${it.deal.pct}%`, pal.good, true]];
  }
  if (it.loot && !owned && !eq) {
    if (it.slot === 'buff' || !it.craft) return [['✦ Found in chests', pal.magic]];
    return [['Craft ', canCraft(it, d.state) ? pal.good : pal.dim, true], ...recipeParts(it, d, pal)];
  }
  if (it.slot === 'buff') {
    const active = I.buffs().find((b) => b.id === it.id);
    return [[`◉ ${it.price}`, (ui.battle.gold || 0) >= it.price ? pal.gold : pal.bad, true], [active ? `  ${active.waves} wave${active.waves > 1 ? 's' : ''} left` : '', pal.good]];
  }
  if (eq) return [['✓ Equipped', pal.good, true]];
  if (owned) return [['Owned', pal.text]];
  return [[`◉ ${it.price}`, (ui.battle.gold || 0) >= it.price ? pal.gold : pal.bad, true]];
}

function card(it, d, pal, w, selected) {
  const rc = it.wardrobe !== undefined ? pal.accent : rarityColor(it);
  const cardBg = selected ? X.mix(pal.panel2, pal.accent, 0.22) : pal.panel2;
  const swBg = selected ? X.mix(pal.panel, rc, 0.16) : pal.panel;
  const iw = w - 1; // one column of gap to the right of each card
  const sw = new X.PixelCanvas(Math.max(1, iw - 2), 5, swBg);
  sw.glow((iw - 2) / 2, 6, 10, rc, selected ? 0.3 : 0.14);
  const ox = Math.floor((iw - 2 - 20) / 2), t = selected ? ui.tick : 6;
  if (it.wardrobe !== undefined) {
    const look = outfits(d.state)[it.wardrobe];
    if (look) SP.drawHero(sw, { ...d.hero, equipped: cleanLook(look, d.state) }, ox + 2, 0, { t, pose: 'stand' });
    else for (let x = ox + 6; x < ox + 14; x++) sw.set(x, 6, X.mix(swBg, pal.dim, 0.5));
  } else I.drawSwatch(sw, it, d.hero, ox, 0, t);
  const edge = `${bg(cardBg)} `, gap = `${bg(pal.panel)} ${RESET}`;
  const lines = sw.lines().map((l) => `${edge}${l}${bg(cardBg)} ${gap}`);
  lines.push(panelLine(iw, cardBg, [[selected ? '▸' : ' ', pal.accent, true], [it.name, rc, true]]) + gap);
  lines.push(panelLine(iw, cardBg, [[' ', pal.dim], ...cardState(it, d, pal)]) + gap);
  lines.push(panelLine(w, pal.panel, []));
  return lines;
}

function setLine(it, d, pal) {
  if (!it.set || !I.SETS[it.set]) return null;
  const st = I.setStatus(d.hero || {}).find((x) => x.name === it.set);
  const col = I.SETS[it.set].color;
  return [[` ${it.set} `, col, true], [`${st.have}/${st.need} `, st.active ? pal.good : pal.dim], [`${st.active ? '✓' : '→'} ${I.setBonusText(st.bonus)}`, st.active ? pal.good : pal.dim]];
}

function previewPanel(d, pal, w, h, it) {
  const out = [];
  const pc = new X.PixelCanvas(w, 13, pal.panel);
  const cur = { ...((d.hero && d.hero.equipped) || {}) };
  for (let x = 0; x < w; x++) pc.set(x, 25, X.mix(pal.panel, pal.text, 0.12));
  if (it.wardrobe !== undefined) {
    const look = outfits(d.state)[it.wardrobe];
    const ch = { ...d.hero, equipped: look ? cleanLook(look, d.state) : cur };
    pc.glow(15, 14, 16, pal.accent, 0.25);
    SP.drawHero(pc, ch, ch.equipped.pet ? 13 : 7, 1, { t: ui.tick, pose: 'stand' });
    out.push(...pc.lines());
    out.push(panelLine(w, pal.panel2, [[` ${it.name}`, pal.accent, true]]));
    out.push(panelLine(w, pal.panel, [[' ', pal.dim], ...cardState(it, d, pal)]));
    out.push(panelLine(w, pal.panel, [[look ? ' Enter wear · s save · x clear' : ' Enter save your current look', pal.accent, true]]));
    const names = look ? Object.values(look).map((id) => (I.getItem(id) || {}).name).filter(Boolean).join(', ') : 'Save up to three looks and switch between them with one key.';
    for (const l of wrap(names, w - 2).slice(0, 4)) out.push(panelLine(w, pal.panel, [[` ${l}`, look ? pal.text : pal.dim]]));
  } else {
    const rc = rarityColor(it);
    const eq = { ...cur };
    if (it.slot !== 'buff') eq[it.slot] = it.id;
    const ch = { ...d.hero, equipped: eq };
    pc.glow((eq.pet ? 13 : 7) + 8, 14, 16, rc, 0.28);
    if (!I.drawPreview(pc, it, ch, ui.tick)) {
      const trail = it.slot === 'trail';
      SP.drawHero(pc, ch, trail ? 13 : eq.pet ? 13 : 7, 1, { t: ui.tick, pose: trail ? 'walk' : (ui.tick >> 5) % 4 === 3 ? 'cheer' : 'stand' });
    }
    out.push(...pc.lines());
    out.push(panelLine(w, pal.panel2, [[` ${it.name}`, rc, true]]));
    out.push(panelLine(w, pal.panel, [[` ${I.RARITY[it.rarity].name}`, rc], [` · ${I.SLOT_NAMES[it.slot]}`, pal.dim]]));
    const owned = owns(d.state, it.id), on = cur[it.slot] === it.id;
    if (it.loot && !owned && it.craft && !it.deal) {
      out.push(panelLine(w, pal.panel, [[' Recipe ', pal.dim], ...recipe(it, d.state).flatMap((m) => [['◆', m.color, true], [`${m.have}/${m.need} `, m.have >= m.need ? pal.good : pal.bad]])]));
    } else out.push(panelLine(w, pal.panel, [[' ', pal.dim], ...cardState(it, d, pal)]));
    const action = it.deal && !owned && it.slot !== 'buff' ? 'Enter buy deal' : it.loot && !owned ? (it.craft && it.slot !== 'buff' ? 'Enter craft' : 'Win it from chests') : it.slot === 'buff' ? 'Enter buy' : !owned ? 'Enter buy' : on ? 'Enter unequip' : 'Enter equip';
    out.push(panelLine(w, pal.panel, [[` ${action}`, pal.accent, true], [it.slot !== 'buff' && owned ? ' · u unequip' : '', pal.dim]]));
    if (it.deal) out.push(panelLine(w, pal.panel, [[it.deal.rare ? ' ✦ Rare deal!' : ' Daily deal', it.deal.rare ? pal.magic : pal.good, true], [` was ${it.deal.was} · ${untilMidnight()} left`, pal.dim]]));
    const sl = setLine(it, d, pal);
    if (sl) out.push(panelLine(w, pal.panel, sl));
    for (const l of wrap(it.desc, w - 2).slice(0, 2)) out.push(panelLine(w, pal.panel, [[` ${l}`, pal.text]]));
  }
  while (out.length < h) out.push(panelLine(w, pal.panel, []));
  return out.slice(0, h);
}

// Section tabs that fit in `avail` columns, scrolled to keep the current one visible.
function tabParts(G, g, pal, avail) {
  const label = (x) => ` ${x.name} `;
  const widths = G.map((x) => L.visWidth(label(x)));
  let a = g, b = g + 1, used = widths[g];
  for (;;) {
    const canR = b < G.length && used + widths[b] <= avail - 2, canL = a > 0 && used + widths[a - 1] <= avail - 2;
    if (!canR && !canL) break;
    if (canR && (b - g <= g - a || !canL)) used += widths[b++]; else used += widths[--a];
  }
  const parts = G.slice(a, b).map((x, k) => [label(x), a + k === g ? pal.accent : x.id === 'deals' ? pal.gold : pal.dim, a + k === g]);
  return [...(a > 0 ? [['‹', pal.dim]] : []), ...parts, ...(b < G.length ? [['›', pal.dim]] : [])];
}

function shopTab(d, pal, W, h = 20) {
  const { s, G, grp, it } = cursor();
  const gold = ui.battle.gold || 0;
  const out = [];

  // Header: section tabs, materials, gold.
  const mats = materials(d.state);
  const matParts = I.MATERIALS.flatMap((m) => [['◆', m.color, true], [`${mats[m.id] || 0} `, pal.text]]);
  const right = [...(W >= 110 ? matParts : []), [`◉ ${gold} gold `, pal.gold, true]];
  const rw = right.reduce((n, p) => n + L.visWidth(p[0]), 0);
  out.push(panelLine(W, pal.panel2, [[' SHOP ', pal.accent, true], ...tabParts(G, s.g, pal, W - rw - 7)], right));

  const bodyH = Math.max(0, h - 2);
  const pw = W >= 70 ? PREVIEW_W : 0;
  const gw = W - pw;
  const cols = Math.max(1, Math.floor(gw / CARD_MIN));
  s.cols = cols;
  const cw = Math.floor(gw / cols);
  const group = grp.items, idx = s.i;
  const rowsFit = Math.max(1, Math.floor(bodyH / CARD_H));
  const row = Math.floor(idx / cols);
  if (!Number.isFinite(s.top)) s.top = 0;
  if (row < s.top) s.top = row;
  if (row >= s.top + rowsFit) s.top = row - rowsFit + 1;
  s.top = Math.max(0, Math.min(s.top, Math.max(0, Math.ceil(group.length / cols) - rowsFit)));

  const grid = [];
  for (let r = s.top; r < s.top + rowsFit && r * cols < group.length; r++) {
    const cards = group.slice(r * cols, r * cols + cols).map((g, j) => card(g, d, pal, j === cols - 1 ? gw - cw * (cols - 1) : cw, g === it));
    const used = cards.length === cols ? gw : cw * cards.length;
    for (let i = 0; i < CARD_H; i++) grid.push(cards.map((c) => c[i]).join('') + (used < gw ? panelLine(gw - used, pal.panel, []) : ''));
  }
  const more = Math.ceil(group.length / cols) > s.top + rowsFit;
  const intro = grp.id === 'deals' ? [[`  Daily Deals · new deals in ${untilMidnight()}`, pal.gold]] : grp.id === 'wardrobe' ? [['  Save up to 3 outfits · Enter wear · s save · x clear', pal.dim]] : [];
  while (grid.length < bodyH) grid.push(panelLine(gw, pal.panel, grid.length === bodyH - 1 ? (more ? [['  ▾ more below', pal.dim]] : intro) : []));
  const prev = pw ? previewPanel(d, pal, pw, bodyH, it) : [];
  for (let i = 0; i < bodyH; i++) out.push((prev[i] || '') + grid[i]);

  // Footer: status message or key help; active buffs and set bonuses on the right.
  const m = s.msg && s.msg.until > ui.tick ? s.msg : null;
  const buffs = I.buffs().map((b) => `${(I.getItem(b.id) || {}).name} ${b.waves}w`).join(', ');
  const sets = I.activeSets(d.hero || {}).map((st) => `${st.name} ${I.setBonusText(st.bonus)}`).join(', ');
  const footRight = buffs ? [[`active: ${buffs} `, pal.magic]] : sets ? [[`set: ${sets} `, pal.good]] : W < 110 ? matParts : [];
  const help = grp.id === 'wardrobe' ? ' ←↑↓→ browse · [ ] section · Enter wear/save · s save · x clear' : ' ←↑↓→ browse · [ ] section · Enter buy/craft/equip · u unequip';
  out.push(panelLine(W, pal.panel2, m ? [[` ${m.text}`, m.good ? pal.good : pal.bad, true]] : [[help, pal.dim]], footRight));
  return out.slice(0, Math.max(h, 1)).map((l) => (L.visWidth(l) === W ? l : fit(l, W, pal)));
}

// Safety net: pad or cut a line to exactly W columns.
function fit(line, W, pal) {
  const w = L.visWidth(line);
  if (w < W) return line.replace(/\x1b\[0m$/, '') + `${bg(pal.panel)}${' '.repeat(W - w)}${RESET}`;
  return panelLine(W, pal.panel, [[truncVis(line.replace(/\x1b\[[0-9;]*m/g, ''), W), pal.text]]);
}

module.exports = {
  shopTab, shopKey, buy, craft, recipe, materials, equip, unequip, inventory,
  dailyDeals, dayKey, saveOutfit, wearOutfit, clearOutfit, outfits, select, groups,
};
