'use strict';
// Character creator screen.

const L = require('./lib');
const M = require('./messages');
const X = require('./pixel');
const C = require('./character');
const SP = require('./sprites');
const { ESC, RESET, BOLD, NOBOLD, fg, bg, UI, TABS, SIDE, ui, snapshotData, currentMode, isBusy } = require('./state');
const { truncVis, panelLine, gradBar, barPart, ICONS, eventColor, collapse, stripIcon, questLog, fmtNum, heroCard, partyList, partyTab, trophiesTab, heroTab, hotbar, header, footer } = require('./panels');

// ---------- character creator ----------

const FIELDS = ['name', 'cls', 'primary', 'secondary', 'skin', 'hair', 'accessory', 'begin'];

const FIELD_LABEL = { name: 'Name', cls: 'Class', primary: 'Robe', secondary: 'Trim', skin: 'Skin', hair: 'Hair', accessory: 'Accessory' };

const OPTIONS = { cls: Object.keys(C.CLASSES), primary: Object.keys(C.COLORS), secondary: Object.keys(C.COLORS), skin: Object.keys(C.SKINS), hair: Object.keys(C.HAIR), accessory: C.ACCESSORIES };

function openCreator(d) {
  ui.screen = 'create';
  ui.create.field = 0;
  ui.create.ch = { ...(C.getCharacter(d.cfg) || C.defaultCharacter()) };
  ui.create.isNew = !C.getCharacter(d.cfg);
}

function creatorFrame(cols, rows, d) {
  const pal = UI[d.cfg.theme] || UI.rpg;
  const W = Math.max(60, cols), ch = ui.create.ch;
  const out = [panelLine(W, pal.panel, [[' ◆ CLAUDE ARCADE ', pal.accent, true], ['· Create your hero', pal.text]], [['↑↓ choose  ←→ change  type a name  enter to begin ', pal.dim]])];
  const bodyH = Math.max(12, rows - 2);
  const formW = Math.min(52, Math.floor(W * 0.45)), prevW = W - formW;
  const S = Math.max(1, Math.min(4, Math.floor(Math.min(bodyH * 2 / 34, prevW / 26))));
  const lc = Math.ceil(prevW / S), lr = Math.ceil(bodyH / S);
  const pc = new X.PixelCanvas(lc, lr, pal.panel);
  for (let y = 0; y < pc.h; y++) for (let x = 0; x < pc.w; x++) pc.px[y * pc.w + x] = X.mix(pal.panel, [0, 0, 0], 0.3 * (1 - y / pc.h));
  const hx = Math.floor(lc / 2) - 8, hy = Math.floor(pc.h / 2) - 13;
  pc.glow(hx + 8, hy + 14, 22, C.COLORS[ch.primary] || pal.magic, 0.3);
  for (let x = hx - 6; x < hx + 22; x++) for (let y = hy + 24; y < hy + 27; y++) pc.set(x, y, X.mix(pal.panel2, pal.text, y === hy + 24 ? 0.25 : 0.08));
  const poses = ['stand', 'walk1', 'stand', 'walk2', 'cheer'];
  SP.drawHero(pc, ch, hx, hy, { pose: poses[(ui.tick >> 4) % poses.length], t: ui.tick, action: true });
  let preview = pc.lines();
  if (S > 1) {
    const big = new X.PixelCanvas(prevW, bodyH);
    for (let y = 0; y < big.h; y++) for (let x = 0; x < prevW; x++) big.px[y * prevW + x] = pc.px[Math.floor(y / S) * lc + Math.floor(x / S)];
    for (const [k, v] of pc.text) { const [c, r] = k.split(',').map(Number); if (c * S < prevW && r * S < bodyH) big.text.set(`${c * S},${r * S}`, v); }
    preview = big.lines();
  }
  const form = [panelLine(formW, pal.panel2, [[' YOUR HERO', pal.accent, true]]), panelLine(formW, pal.panel, [])];
  FIELDS.forEach((f, i) => {
    const sel = i === ui.create.field;
    if (f === 'begin') {
      form.push(panelLine(formW, pal.panel, []));
      form.push(panelLine(formW, sel ? pal.accent : pal.panel2, [[sel ? '  ▶ BEGIN ADVENTURE ◀' : '    Begin adventure', sel ? pal.ink : pal.text, true]]));
      return;
    }
    let value = f === 'name' ? `${ch.name}${sel && (ui.tick >> 3) % 2 ? '▏' : ' '}` : f === 'cls' ? C.CLASSES[ch.cls].name : ch[f];
    if (f !== 'name') value = `◀ ${value} ▶`;
    const swatch = { primary: C.COLORS[ch.primary], secondary: C.COLORS[ch.secondary], skin: C.SKINS[ch.skin], hair: C.HAIR[ch.hair] }[f];
    form.push(panelLine(formW, sel ? pal.panel2 : pal.panel, [[sel ? ' ▸ ' : '   ', pal.accent, true], [FIELD_LABEL[f].padEnd(11), sel ? pal.text : pal.dim, sel], [value, sel ? pal.accent : pal.text, sel], [swatch ? '  ██' : '', swatch || pal.text]]));
  });
  const cls = C.CLASSES[ch.cls];
  form.push(panelLine(formW, pal.panel, []));
  form.push(panelLine(formW, pal.panel2, [[` ${cls.name.toUpperCase()}`, pal.accent, true], [`  main stat ${cls.stat}`, pal.dim]]));
  form.push(panelLine(formW, pal.panel, [[` ${cls.desc}`, pal.text]]));
  form.push(panelLine(formW, pal.panel, [[` Basic attack: ${C.BASIC_NAMES[ch.cls]}`, pal.dim]]));
  form.push(panelLine(formW, pal.panel, [[' Spells unlock at Lv 3, 5, 8, 12 and 18.', pal.dim]]));
  while (form.length < bodyH) form.push(panelLine(formW, pal.panel, []));
  for (let i = 0; i < bodyH; i++) out.push(form[i] + preview[i]);
  out.push(footer(pal, W, [['↑↓', 'field'], ['←→', 'change'], ['enter', 'begin'], ['esc', ui.create.isNew ? 'use defaults' : 'cancel']]));
  return out;
}

function creatorKey(key, d) {
  const cr = ui.create, ch = cr.ch, f = FIELDS[cr.field];
  if (key === '\x1b[A') cr.field = (cr.field + FIELDS.length - 1) % FIELDS.length;
  else if (key === '\x1b[B' || key === '\t') cr.field = (cr.field + 1) % FIELDS.length;
  else if ((key === '\x1b[C' || key === '\x1b[D') && OPTIONS[f]) {
    const opts = OPTIONS[f], dir = key === '\x1b[C' ? 1 : -1;
    ch[f] = opts[(opts.indexOf(ch[f]) + dir + opts.length) % opts.length];
    if (f === 'cls') { const c = C.CLASSES[ch.cls]; ch.primary = c.primary; ch.secondary = c.secondary; ch.accessory = c.accessory; }
  } else if (key === '\r' || key === '\n') {
    d.cfg.character = { ...ch, name: ch.name.trim() || 'Hero' };
    L.saveConfig(d.cfg);
    L.logEvent({ sid: d.sid, kind: 'welcome', text: `${d.cfg.character.name} the ${C.CLASSES[ch.cls].name} begins their adventure!` });
    ui.screen = 'game';
  } else if (key === '\x1b') {
    if (cr.isNew) { d.cfg.character = C.defaultCharacter(); L.saveConfig(d.cfg); }
    ui.screen = 'game';
  } else if (f === 'name') {
    if (key === '\x7f' || key === '\b') ch.name = ch.name.slice(0, -1);
    else if (/^[\w .'-]$/.test(key) && ch.name.length < 16) ch.name += key;
  }
}

module.exports = { FIELDS, FIELD_LABEL, OPTIONS, openCreator, creatorFrame, creatorKey };
