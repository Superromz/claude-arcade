'use strict';
// Shop tab: spend battle gold on cosmetics (shown on the hero) and battle
// buffs, and craft chest-only items from the materials chests drop. Cards
// are grouped by slot; the left panel previews the hero wearing the selected
// item.

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

const shop = () => (ui.shop ||= { sel: 0, top: 0, cols: 3, msg: null });
const inSlot = (slot) => I.CATALOG.filter((it) => it.slot === slot);

// ---------- persistence ----------

const inventory = (state) => ((state && state.game && state.game.inventory) || []).slice();
const owns = (state, id) => inventory(state).includes(id);
const materials = (state) => ({ ...((state && state.game && state.game.materials) || {}) });

// What a recipe still needs: [{ id, name, need, have, color }].
function recipe(it, state) {
  const have = materials(state);
  return Object.entries(it.craft || {}).map(([id, need]) => ({ id, need, have: have[id] || 0, ...I.getMaterial(id) }));
}
const canCraft = (it, state) => !!it.craft && recipe(it, state).every((m) => m.have >= m.need);

function note(text, good = false) { shop().msg = { text, good, until: ui.tick + 30 }; }

// Buy an item with battle gold. Cosmetics go to state.json game.inventory
// and are equipped right away; buffs go to ui.buffs. Returns true on success.
function buy(id, d) {
  const it = I.getItem(id);
  if (!it) return false;
  if (it.loot) { note(it.craft ? 'Craft it from materials' : 'Found in chests only'); return false; }
  if (it.slot !== 'buff' && owns(d.state, id)) return false;
  const gold = ui.battle.gold || 0;
  if (gold < it.price) { note(`Need ◉ ${it.price - gold} more gold`); return false; }
  ui.battle.gold = gold - it.price;
  ui.dirty = true;
  L.withLock(() => {
    const st = L.loadState();
    const game = { ...(st.game || {}) };
    game.gold = ui.battle.gold;
    if (it.slot !== 'buff') game.inventory = [...new Set([...inventory(st), id])];
    st.game = game;
    L.saveState(st);
    d.state = st;
  });
  if (it.slot === 'buff') I.addBuff(id); else equip(id, d);
  ui.celebrate = { kind: 'purchase', text: `Got ${it.name}!`, until: ui.tick + 20 };
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
  let ok = false;
  L.withLock(() => {
    const st = L.loadState();
    const game = { ...(st.game || {}) };
    const mats = { ...(game.materials || {}) };
    if (!Object.entries(it.craft).every(([m, n]) => (mats[m] || 0) >= n)) return;
    for (const [m, n] of Object.entries(it.craft)) mats[m] -= n;
    game.materials = mats;
    game.inventory = [...new Set([...inventory(st), id])];
    st.game = game;
    L.saveState(st);
    d.state = st;
    ok = true;
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

// ---------- keys ----------

function move(dir) {
  const s = shop(), cat = I.CATALOG;
  const cur = cat[s.sel] || cat[0];
  const group = inSlot(cur.slot), idx = group.indexOf(cur), cols = Math.max(1, s.cols);
  if (dir === 'left' || dir === 'right') { s.sel = (s.sel + (dir === 'right' ? 1 : -1) + cat.length) % cat.length; return; }
  let target;
  if (dir === 'down') {
    if (idx + cols < group.length) target = group[idx + cols];
    else if (Math.floor(idx / cols) < Math.floor((group.length - 1) / cols)) target = group[group.length - 1];
    else { const next = inSlot(I.SLOTS[(I.SLOTS.indexOf(cur.slot) + 1) % I.SLOTS.length]); target = next[Math.min(idx % cols, next.length - 1)]; }
  } else if (idx - cols >= 0) target = group[idx - cols];
  else {
    const prev = inSlot(I.SLOTS[(I.SLOTS.indexOf(cur.slot) + I.SLOTS.length - 1) % I.SLOTS.length]);
    const lastRow = Math.floor((prev.length - 1) / cols) * cols;
    target = prev[Math.min(lastRow + (idx % cols), prev.length - 1)];
  }
  s.sel = cat.indexOf(target);
}

// Returns true when the key was handled by the shop.
function shopKey(key, d) {
  const dirs = { '\x1b[C': 'right', '\x1b[D': 'left', '\x1b[A': 'up', '\x1b[B': 'down' };
  if (dirs[key]) { move(dirs[key]); return true; }
  const it = I.CATALOG[shop().sel] || I.CATALOG[0];
  if (key === '\r' || key === '\n') {
    if (it.loot && !owns(d.state, it.id)) { if (it.slot === 'buff' || !it.craft) note('Found in chests only'); else craft(it.id, d); }
    else if (it.slot === 'buff' || !owns(d.state, it.id)) buy(it.id, d);
    else if (((d.hero && d.hero.equipped) || {})[it.slot] === it.id) { unequip(it.slot, d); note(`Unequipped ${it.name}`); }
    else { equip(it.id, d); note(`Equipped ${it.name}`, true); }
    return true;
  }
  if (key === 'u') {
    if (unequip(it.slot, d)) note(`Unequipped ${I.SLOT_NAMES[it.slot].toLowerCase()}`);
    return true;
  }
  return false;
}

// ---------- rendering ----------

function wrap(text, w) {
  const out = [''];
  for (const word of text.split(' ')) {
    const cur = out[out.length - 1];
    if (cur && L.visWidth(cur + ' ' + word) > w) out.push(word); else out[out.length - 1] = cur ? `${cur} ${word}` : word;
  }
  return out;
}

// Compact recipe for a card: "◆6 ◆2" in material colors.
const recipeParts = (it, d, pal) => recipe(it, d.state).flatMap((m, i) => [[`${i ? ' ' : ''}◆`, m.color, true], [`${m.need}`, m.have >= m.need ? pal.text : pal.bad]]);

function cardState(it, d, pal) {
  const eq = ((d.hero && d.hero.equipped) || {})[it.slot] === it.id;
  if (it.loot && !owns(d.state, it.id) && !eq) {
    if (it.slot === 'buff' || !it.craft) return [['✦ Found in chests', pal.magic]];
    return [['Craft ', canCraft(it, d.state) ? pal.good : pal.dim, true], ...recipeParts(it, d, pal)];
  }
  if (it.slot === 'buff') {
    const active = I.buffs().find((b) => b.id === it.id);
    return [[`◉ ${it.price}`, (ui.battle.gold || 0) >= it.price ? pal.gold : pal.bad, true], [active ? `  ${active.waves} wave${active.waves > 1 ? 's' : ''} left` : '', pal.good]];
  }
  if (eq) return [['✓ Equipped', pal.good, true]];
  if (owns(d.state, it.id)) return [['Owned', pal.text]];
  return [[`◉ ${it.price}`, (ui.battle.gold || 0) >= it.price ? pal.gold : pal.bad, true]];
}

function card(it, d, pal, w, selected) {
  const rc = I.RARITY[it.rarity].color;
  const cardBg = selected ? X.mix(pal.panel2, pal.accent, 0.22) : pal.panel2;
  const swBg = selected ? X.mix(pal.panel, rc, 0.16) : pal.panel;
  const iw = w - 1; // one column of gap to the right of each card
  const sw = new X.PixelCanvas(iw - 2, 5, swBg);
  sw.glow((iw - 2) / 2, 6, 10, rc, selected ? 0.3 : 0.14);
  I.drawSwatch(sw, it, d.hero, Math.floor((iw - 2 - 20) / 2), 0, selected ? ui.tick : 6);
  const edge = `${bg(cardBg)} `, gap = `${bg(pal.panel)} ${RESET}`;
  const lines = sw.lines().map((l) => `${edge}${l}${bg(cardBg)} ${gap}`);
  lines.push(panelLine(iw, cardBg, [[selected ? '▸' : ' ', pal.accent, true], [it.name, rc, true]]) + gap);
  lines.push(panelLine(iw, cardBg, [[' ', pal.dim], ...cardState(it, d, pal)]) + gap);
  lines.push(panelLine(w, pal.panel, []));
  return lines;
}

function previewPanel(d, pal, w, h, it) {
  const out = [];
  const rc = I.RARITY[it.rarity].color;
  const eq = { ...((d.hero && d.hero.equipped) || {}) };
  if (it.slot !== 'buff') eq[it.slot] = it.id;
  const ch = { ...d.hero, equipped: eq };
  const pc = new X.PixelCanvas(w, 13, pal.panel);
  pc.glow((eq.pet ? 13 : 7) + 8, 14, 16, rc, 0.28);
  for (let x = 0; x < w; x++) pc.set(x, 25, X.mix(pal.panel, pal.text, 0.12));
  SP.drawHero(pc, ch, eq.pet ? 13 : 7, 1, { t: ui.tick, pose: (ui.tick >> 5) % 4 === 3 ? 'cheer' : 'stand' });
  out.push(...pc.lines());
  out.push(panelLine(w, pal.panel2, [[` ${it.name}`, rc, true]]));
  const setInfo = it.set ? [[` · ${it.set} set`, (I.SETS[it.set] || {}).color || pal.dim]] : [];
  out.push(panelLine(w, pal.panel, [[` ${I.RARITY[it.rarity].name}`, rc], [` · ${I.SLOT_NAMES[it.slot]}`, pal.dim], ...setInfo]));
  const owned = owns(d.state, it.id), on = eq[it.slot] === it.id && ((d.hero.equipped || {})[it.slot] === it.id);
  if (it.loot && !owned && it.craft) {
    out.push(panelLine(w, pal.panel, [[' Recipe ', pal.dim], ...recipe(it, d.state).flatMap((m) => [[`◆`, m.color, true], [`${m.have}/${m.need} `, m.have >= m.need ? pal.good : pal.bad]])]));
    out.push(panelLine(w, pal.panel, [[` ${recipe(it, d.state).map((m) => m.name).join(', ')}`, pal.dim]]));
  } else out.push(panelLine(w, pal.panel, [[' ', pal.dim], ...cardState(it, d, pal)]));
  for (const l of wrap(it.desc, w - 2).slice(0, 2)) out.push(panelLine(w, pal.panel, [[` ${l}`, pal.text]]));
  const action = it.loot && !owned ? (it.craft && it.slot !== 'buff' ? 'Enter craft' : 'Win it from chests') : it.slot === 'buff' ? 'Enter buy' : !owned ? 'Enter buy' : on ? 'Enter unequip' : 'Enter equip';
  out.push(panelLine(w, pal.panel, [[` ${action}`, pal.accent, true], [it.slot !== 'buff' ? ' · u unequip' : '', pal.dim]]));
  while (out.length < h) out.push(panelLine(w, pal.panel, []));
  return out.slice(0, h);
}

function shopTab(d, pal, W, h = 20) {
  const s = shop();
  if (!I.CATALOG[s.sel]) s.sel = 0;
  const it = I.CATALOG[s.sel];
  const gold = ui.battle.gold || 0;
  const out = [];

  // Header: slot tabs + gold.
  const tabs = I.SLOTS.map((slot) => [` ${I.SLOT_NAMES[slot]} `, slot === it.slot ? pal.accent : pal.dim, slot === it.slot]);
  const mats = materials(d.state);
  const matParts = I.MATERIALS.flatMap((m) => [['◆', m.color, true], [`${mats[m.id] || 0} `, pal.text]]);
  out.push(panelLine(W, pal.panel2, [[' SHOP ', pal.accent, true], ...tabs], [...(W >= 110 ? matParts : []), [`◉ ${gold} gold `, pal.gold, true]]));

  const bodyH = Math.max(0, h - 2);
  const pw = W >= 70 ? PREVIEW_W : 0;
  const gw = W - pw;
  const cols = Math.max(1, Math.floor(gw / CARD_MIN));
  s.cols = cols;
  const cw = Math.floor(gw / cols);
  const group = inSlot(it.slot);
  const idx = group.indexOf(it);
  const rowsFit = Math.max(1, Math.floor(bodyH / CARD_H));
  const row = Math.floor(idx / cols);
  if (row < s.top) s.top = row;
  if (row >= s.top + rowsFit) s.top = row - rowsFit + 1;
  s.top = Math.max(0, Math.min(s.top, Math.max(0, Math.ceil(group.length / cols) - rowsFit)));

  const grid = [];
  for (let r = s.top; r < s.top + rowsFit && r * cols < group.length; r++) {
    const cards = group.slice(r * cols, r * cols + cols).map((g, j, arr) => card(g, d, pal, j === cols - 1 ? gw - cw * (cols - 1) : cw, g === it));
    const used = cards.length === cols ? gw : cw * cards.length;
    for (let i = 0; i < CARD_H; i++) grid.push(cards.map((c) => c[i]).join('') + (used < gw ? panelLine(gw - used, pal.panel, []) : ''));
  }
  const more = Math.ceil(group.length / cols) > s.top + rowsFit;
  while (grid.length < bodyH) grid.push(panelLine(gw, pal.panel, grid.length === bodyH - 1 && more ? [['  ▾ more below', pal.dim]] : []));
  const prev = pw ? previewPanel(d, pal, pw, bodyH, it) : [];
  for (let i = 0; i < bodyH; i++) out.push((prev[i] || '') + grid[i]);

  // Footer: status message or key help.
  const m = s.msg && s.msg.until > ui.tick ? s.msg : null;
  const buffs = I.buffs().map((b) => `${(I.getItem(b.id) || {}).name} ${b.waves}w`).join(', ');
  const footRight = buffs ? [[`active: ${buffs} `, pal.magic]] : W < 110 ? matParts : [];
  out.push(panelLine(W, pal.panel2, m ? [[` ${m.text}`, m.good ? pal.good : pal.bad, true]] : [[' ←↑↓→ browse · Enter buy/craft/equip · u unequip', pal.dim]], footRight));
  return out.slice(0, Math.max(h, 1)).map((l) => (L.visWidth(l) === W ? l : fit(l, W, pal)));
}

// Safety net: pad or cut a line to exactly W columns.
function fit(line, W, pal) {
  const w = L.visWidth(line);
  if (w < W) return line.replace(/\x1b\[0m$/, '') + `${bg(pal.panel)}${' '.repeat(W - w)}${RESET}`;
  return panelLine(W, pal.panel, [[truncVis(line.replace(/\x1b\[[0-9;]*m/g, ''), W), pal.text]]);
}

module.exports = { shopTab, shopKey, buy, craft, recipe, materials, equip, unequip, inventory };
