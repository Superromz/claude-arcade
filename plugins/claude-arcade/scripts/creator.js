'use strict';
// Character creator screen.
//
// Callers may set, after openCreator():
//   ui.create.title    - header text (default "Create your hero")
//   ui.create.onDone   - fn(character) called on Enter instead of saving config
//   ui.create.onCancel - fn() called on Esc instead of the default behavior

const L = require('./lib');
const X = require('./pixel');
const C = require('./character');
const SP = require('./sprites');
const { RESET, BOLD, NOBOLD, fg, bg, UI, ui } = require('./state');
const P = require('./panels');
const { panelLine, footer, truncVis } = P;

// ---------- character creator ----------

const FIELDS = ['name', 'cls', 'primary', 'secondary', 'skin', 'hair', 'accessory', 'begin'];

const FIELD_LABEL = { name: 'Name', cls: 'Class', primary: 'Robe', secondary: 'Trim', skin: 'Skin', hair: 'Hair', accessory: 'Accessory' };

const OPTIONS = { cls: Object.keys(C.CLASSES), primary: Object.keys(C.COLORS), secondary: Object.keys(C.COLORS), skin: Object.keys(C.SKINS), hair: Object.keys(C.HAIR), accessory: C.ACCESSORIES };

const SWATCHES = { primary: C.COLORS, secondary: C.COLORS, skin: C.SKINS, hair: C.HAIR };

function openCreator(d) {
  ui.screen = 'create';
  ui.create.field = 0;
  ui.create.ch = { ...(C.getCharacter(d.cfg) || C.defaultCharacter()) };
  ui.create.isNew = !C.getCharacter(d.cfg);
  delete ui.create.onDone; delete ui.create.onCancel; delete ui.create.title;
}

const vis = L.visWidth;

// One form row: marker, label, then the value (chips for color fields).
function fieldRow(f, sel, ch, pal, w) {
  const inner = sel ? X.mix(pal.panel, pal.accent, 0.1) : pal.panel;
  let s = `${bg(inner)}${fg(pal.accent)}${BOLD}${sel ? ' ▸ ' : '   '}${NOBOLD}${fg(sel ? pal.text : pal.dim)}${sel ? BOLD : ''}${FIELD_LABEL[f].padEnd(11)}${NOBOLD}`;
  let used = 3 + 11;
  const room = () => w - used;
  const add = (str, width = vis(str)) => { if (width <= room()) { s += str; used += width; return true; } return false; };
  if (f === 'name') {
    add(`${fg(pal.text)}${BOLD}${truncVis(ch.name || '', room() - 2)}${NOBOLD}`, vis(truncVis(ch.name || '', room() - 2)));
    if (sel) add(`${fg(pal.accent)}${(ui.tick >> 3) % 2 ? '▏' : ' '}`, 1);
    if (sel) add(`${fg(pal.dim)}  type to rename`);
  } else if (f === 'cls') {
    const cls = C.CLASSES[ch.cls];
    const txt = `${P.CLASS_ICON[ch.cls] || '◆'} ${cls.name}`;
    if (sel) add(`${fg(pal.accent)}◀ ${fg(pal.text)}${BOLD}${txt}${NOBOLD}${fg(pal.accent)} ▶`, vis(txt) + 4);
    else add(`${fg(pal.text)}${txt}`, vis(txt));
  } else if (SWATCHES[f]) {
    const opts = OPTIONS[f], cur = ch[f];
    if (sel) {
      // Color chips: two cells each, the chosen one framed in the accent color.
      const ci = opts.indexOf(cur);
      let strip = '';
      opts.forEach((o, i) => {
        strip += i === ci ? `${bg(inner)}${fg(pal.accent)}▐` : i === ci + 1 ? `${bg(inner)}${fg(pal.accent)}▌` : `${bg(inner)} `;
        strip += `${bg(SWATCHES[f][o])}  `;
      });
      strip += ci === opts.length - 1 ? `${bg(inner)}${fg(pal.accent)}▌` : `${bg(inner)} `;
      add(strip, opts.length * 3 + 1);
      add(`${bg(inner)}${fg(pal.text)}${BOLD}${cur}${NOBOLD}`);
    } else {
      add(`${bg(SWATCHES[f][cur])}  ${bg(inner)} ${fg(pal.text)}`, 3);
      add(`${fg(pal.text)}${cur}`);
    }
  } else if (f === 'accessory') {
    if (sel) {
      add(`${fg(pal.accent)}◀ `, 2);
      for (const o of OPTIONS.accessory) add(o === ch.accessory ? `${bg(pal.accent)}${fg(pal.ink)}${BOLD} ${o} ${NOBOLD}${bg(inner)}` : `${fg(pal.dim)} ${o} `, o.length + 2);
      add(`${fg(pal.accent)} ▶`, 2);
    } else add(`${fg(pal.text)}${ch.accessory}`);
  }
  return P.cardRaw(w + 2, pal, P.padRaw(s, w, inner), { inner, color: sel ? X.mix(pal.panel, pal.accent, 0.5) : P.edge(pal) });
}

function classCard(ch, pal, w) {
  const cls = C.CLASSES[ch.cls];
  const cc = (X.CLASS_COLORS[cls.name] || {}).H || C.COLORS[cls.primary] || pal.accent;
  const out = [P.cardTop(w, pal, [[`${P.CLASS_ICON[ch.cls] || '◆'} `, cc, true], [cls.name.toUpperCase(), pal.accent, true]], [['main stat ', pal.dim], [cls.stat, pal.accent, true]])];
  for (const l of P.wrap(cls.desc, w - 4, 2)) out.push(P.cardRow(w, pal, [[l, pal.text]]));
  // class chips, three per row
  const keys = Object.keys(C.CLASSES), per = 3, cw = Math.floor((w - 4) / per);
  for (let i = 0; i < keys.length; i += per) {
    let s = `${bg(pal.panel)} `;
    keys.slice(i, i + per).forEach((k) => {
      const on = k === ch.cls;
      const label = truncVis(` ${P.CLASS_ICON[k]} ${C.CLASSES[k].name}`, cw - 1).padEnd(cw - 1);
      s += on ? `${bg(pal.accent)}${fg(pal.ink)}${BOLD}${label}${NOBOLD}${bg(pal.panel)} ` : `${bg(pal.panel2)}${fg(pal.dim)}${label}${bg(pal.panel)} `;
    });
    out.push(P.cardRaw(w, pal, s));
  }
  out.push(P.cardSep(w, pal, [['▲ ', pal.accent, true], ['STARTING STATS', pal.accent, true]]));
  const st = C.stats({ xp: 0, tools: {}, tokens: { input: 0, output: 0 } }, ch);
  const colors = { STR: pal.bad, INT: pal.magic, DEX: pal.good, WIS: [110, 190, 255], CHA: pal.gold };
  const barW = Math.max(6, w - 2 - 10);
  for (const [k, v] of Object.entries(st)) {
    const main = k === cls.stat, c = pal === UI.retro ? pal.accent : colors[k];
    out.push(P.cardRaw(w, pal, `${bg(pal.panel)}${fg(main ? pal.accent : pal.text)}${main ? BOLD + '▸' : ' '}${k}${NOBOLD} ${P.thinBar(v / 16, barW, X.shade(c, 0.6), c, X.mix(pal.panel, pal.text, 0.12), pal.panel)}${fg(main ? pal.accent : pal.text)}${BOLD}${String(v).padStart(3)}${NOBOLD}`));
  }
  out.push(P.cardSep(w, pal, [['● ', pal.accent, true], ['SPELLS', pal.accent, true]]));
  out.push(P.cardRow(w, pal, [['Basic  ', pal.dim], [`${P.CLASS_ICON[ch.cls]} ${C.BASIC_NAMES[ch.cls]}`, pal.accent, true]]));
  out.push(P.cardRow(w, pal, [['Unlock ', pal.dim], ...C.SPELLS.slice(1).map((s) => [`${P.SPELL_ICON[s.id]}${s.lvl} `, P.spellColor(s, pal)])]));
  out.push(P.cardBottom(w, pal));
  return out;
}

function beginButton(sel, pal, w) {
  const label = sel ? ' ▶ BEGIN ADVENTURE ◀ ' : '   Begin adventure   ';
  const b = sel ? pal.accent : pal.panel2;
  const lw = vis(label) + 2, left = Math.max(0, Math.floor((w - lw) / 2));
  return `${bg(pal.panel)}${' '.repeat(left)}${fg(b)}▐${bg(b)}${fg(sel ? pal.ink : pal.text)}${BOLD}${label}${NOBOLD}${bg(pal.panel)}${fg(b)}▌${' '.repeat(Math.max(0, w - left - lw))}${RESET}`;
}

function creatorFrame(cols, rows, d) {
  const pal = UI[d.cfg.theme] || UI.rpg;
  const W = Math.max(30, cols), ch = ui.create.ch;
  const bar = P.darken(pal.panel, 0.35);
  const title = ui.create.title || 'Create your hero';
  const head = `${bg(bar)}${fg(pal.accent)}${BOLD} ◆ ${P.gradientText('CLAUDE ARCADE', pal.accent, pal.gold)}${NOBOLD}${fg(pal.dim)} · ${fg(pal.text)}${BOLD}${title}${NOBOLD}`;
  const hint = '↑↓ choose  ←→ change  enter to begin ';
  const out = [P.padRaw(head, W - (vis(head) + vis(hint) <= W ? vis(hint) : 0), bar) + (vis(head) + vis(hint) <= W ? `${fg(pal.dim)}${hint}` : '') + RESET];
  const bodyH = Math.max(12, rows - 2);
  const formW = Math.min(58, Math.max(Math.min(42, W - 18), Math.floor(W * 0.48))), prevW = W - formW;

  // Preview: the hero on a pedestal, scaled up when there is room.
  const S = Math.max(1, Math.min(4, Math.floor(Math.min(bodyH * 2 / 34, prevW / 26))));
  const lc = Math.ceil(prevW / S), lr = Math.ceil(bodyH / S);
  const pc = new X.PixelCanvas(lc, lr, pal.panel);
  for (let y = 0; y < pc.h; y++) for (let x = 0; x < pc.w; x++) pc.px[y * pc.w + x] = X.mix(pal.panel, [0, 0, 0], 0.35 * (1 - y / pc.h));
  const hx = Math.floor(lc / 2) - 8, hy = Math.floor(pc.h / 2) - 13;
  pc.glow(hx + 8, hy + 14, 22, C.COLORS[ch.primary] || pal.magic, 0.3);
  for (let x = hx - 6; x < hx + 22; x++) for (let y = hy + 24; y < hy + 27; y++) pc.set(x, y, X.mix(pal.panel2, pal.text, y === hy + 24 ? 0.25 : 0.08));
  const poses = ['stand', 'walk1', 'stand', 'walk2', 'cheer'];
  SP.drawHero(pc, ch, hx, hy, { pose: poses[(ui.tick >> 4) % poses.length], t: ui.tick, action: true });
  let canvas = pc;
  if (S > 1) {
    canvas = new X.PixelCanvas(prevW, bodyH);
    for (let y = 0; y < canvas.h; y++) for (let x = 0; x < prevW; x++) canvas.px[y * prevW + x] = pc.px[Math.floor(y / S) * lc + Math.floor(x / S)];
  }
  // Name plate above the hero.
  const plate = `${P.CLASS_ICON[ch.cls] || '◆'} ${ch.name || 'Hero'} the ${C.CLASSES[ch.cls].name}`;
  if (bodyH > 4 && vis(plate) + 2 <= prevW) canvas.label(Math.floor((prevW - vis(plate)) / 2), 1, plate, pal.accent, true);
  const sub = C.CLASSES[ch.cls].desc.split('.')[0] + '.';
  if (bodyH > 6 && vis(sub) + 2 <= prevW) canvas.label(Math.floor((prevW - vis(sub)) / 2), 2, sub, pal.dim);
  const preview = canvas.lines();

  const fw = formW - 2;
  const form = [P.cardTop(formW, pal, [['◆ ', pal.accent, true], ['YOUR HERO', pal.accent, true]], [[`${Math.min(ui.create.field + 1, FIELDS.length)}/${FIELDS.length}`, pal.dim]])];
  FIELDS.forEach((f, i) => { if (f !== 'begin') form.push(fieldRow(f, i === ui.create.field, ch, pal, fw)); });
  form.push(P.cardBottom(formW, pal));
  form.push(beginButton(FIELDS[ui.create.field] === 'begin', pal, formW));
  form.push(panelLine(formW, pal.panel, []));
  form.push(...classCard(ch, pal, formW));
  while (form.length < bodyH) form.push(panelLine(formW, pal.panel, []));
  for (let i = 0; i < bodyH; i++) out.push(form[i] + preview[i]);
  out.push(footer(pal, W, [['↑↓', 'field'], ['←→', 'change'], ['enter', 'begin'], ['esc', ui.create.onCancel || !ui.create.isNew ? 'cancel' : 'use defaults']]));
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
    const hero = { ...ch, name: ch.name.trim() || 'Hero' };
    if (typeof cr.onDone === 'function') return cr.onDone(hero);
    d.cfg.character = hero;
    L.saveConfig(d.cfg);
    L.logEvent({ sid: d.sid, kind: 'welcome', text: `${d.cfg.character.name} the ${C.CLASSES[ch.cls].name} begins their adventure!` });
    ui.screen = 'game';
  } else if (key === '\x1b') {
    if (typeof cr.onCancel === 'function') return cr.onCancel();
    if (cr.isNew) { d.cfg.character = C.defaultCharacter(); L.saveConfig(d.cfg); }
    ui.screen = 'game';
  } else if (f === 'name') {
    if (key === '\x7f' || key === '\b') ch.name = ch.name.slice(0, -1);
    else if (/^[\w .'-]$/.test(key) && ch.name.length < 16) ch.name += key;
  }
}

module.exports = { FIELDS, FIELD_LABEL, OPTIONS, openCreator, creatorFrame, creatorKey };
