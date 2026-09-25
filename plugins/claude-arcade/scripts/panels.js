'use strict';
// Text UI panels: header, footer, hotbar, hero card, tabs, quest log.
//
// Panels are drawn as rounded "cards" (╭─ title ──╮ │ … │ ╰──╯) with
// truecolor borders on the panel background. Every glyph used here is
// single-width in common terminal fonts, and every line is padded to the
// exact width it was asked for (measured with lib.visWidth).

const L = require('./lib');
const X = require('./pixel');
const C = require('./character');
const SP = require('./sprites');
const { RESET, BOLD, NOBOLD, fg, bg, UI, TABS, ui, currentMode, isBusy } = require('./state');
// Read battle's cooldown table lazily (battle.js may require panels).
const cooldownOf = (id) => { if (ui.cdLen && ui.cdLen[id]) return ui.cdLen[id]; try { return require('./battle').COOLDOWN[id] || 1; } catch { return 1; } };

const vis = L.visWidth;
const clamp01 = (v) => Math.max(0, Math.min(1, Number(v) || 0));
const BLACK = [0, 0, 0], WHITE = [255, 255, 255];

// ---------- text helpers ----------

function truncVis(s, w) {
  if (w <= 0) return '';
  if (vis(s) <= w) return s;
  let out = '';
  for (const ch of s) { if (vis(out + ch) > w - 1) break; out += ch; }
  return out + '…';
}

// Parts are [text, color, bold, background?]. The optional background lets a
// part sit on its own color (badges, pills) inside a panel line.
function renderParts(ps, panel) {
  return ps.map(([t, c, b, pb]) => `${pb ? bg(pb) : ''}${b ? BOLD : ''}${fg(c)}${t}${b ? NOBOLD : ''}${pb ? bg(panel) : ''}`).join('');
}
const partsWidth = (ps) => ps.reduce((n, p) => n + vis(p[0]), 0);

function fitParts(parts, room) {
  if (partsWidth(parts) <= room) return parts;
  const out = []; let used = 0;
  for (const [t, c, b, pb] of parts) {
    if (used >= room) break;
    const s = truncVis(t, room - used); out.push([s, c, b, pb]); used += vis(s);
  }
  return out;
}

function panelLine(width, panel, parts, right = []) {
  const rw = partsWidth(right);
  const left = fitParts(parts, Math.max(0, width - rw));
  const lw = partsWidth(left);
  return `${bg(panel)}${renderParts(left, panel)}${' '.repeat(Math.max(0, width - lw - rw))}${renderParts(right, panel)}${RESET}`;
}

// Pad an already-colored string to w cells on the panel background.
const padRaw = (raw, w, panel) => `${raw}${bg(panel)}${' '.repeat(Math.max(0, w - vis(raw)))}`;

function wrap(text, w, maxLines = 99) {
  const lines = [''];
  for (const word of String(text).split(/\s+/).filter(Boolean)) {
    const cur = lines[lines.length - 1];
    if (!cur) lines[lines.length - 1] = word;
    else if (vis(cur) + 1 + vis(word) <= w) lines[lines.length - 1] = `${cur} ${word}`;
    else lines.push(word);
  }
  if (lines.length > maxLines) { lines.length = maxLines; lines[maxLines - 1] = truncVis(lines[maxLines - 1] + ' …', w); }
  return lines.map((l) => truncVis(l, w));
}

// ---------- bars ----------

function gradBar(ratio, width, c1, c2, track) {
  const r = clamp01(ratio) * width;
  const full = Math.floor(r), part = Math.floor((r - full) * 8);
  let s = '';
  for (let i = 0; i < width; i++) {
    const c = X.mix(c1, c2, width > 1 ? i / (width - 1) : 0);
    if (i < full) s += `${fg(c)}█`;
    else if (i === full && part > 0) s += `${fg(c)}${bg(track)}${' ▏▎▍▌▋▊▉'[part]}`;
    else s += `${fg(track)}█`;
  }
  return s;
}

const barPart = (ratio, width, c1, c2, pal, panel) => `${gradBar(ratio, width, c1, c2, X.mix(panel, pal.text, 0.14))}${bg(panel)}`;

// A slim bar drawn with heavy rules (━), for stats and progress lists.
function thinBar(ratio, width, c1, c2, track, panel) {
  const r = clamp01(ratio) * width;
  let s = bg(panel);
  for (let i = 0; i < width; i++) {
    const col = X.mix(c1, c2, width > 1 ? i / (width - 1) : 0);
    const f = Math.max(0, Math.min(1, r - i));
    s += fg(f >= 1 ? col : f > 0 ? X.mix(track, col, f) : track) + '━';
  }
  return s;
}

// A filled bar with its label centered inside it. The label reads dark on the
// filled part and light on the empty track. Leaves the background dirty.
function labelBar(ratio, width, c1, c2, track, label = '', { ink = [22, 18, 30], text = [236, 232, 246] } = {}) {
  const r = clamp01(ratio) * width;
  const chars = [...truncVis(label, width)];
  const st = Math.max(0, Math.floor((width - chars.length) / 2));
  let s = BOLD;
  for (let i = 0; i < width; i++) {
    const col = X.mix(c1, c2, width > 1 ? i / (width - 1) : 0);
    const f = Math.max(0, Math.min(1, r - i));
    const cb = f >= 1 ? col : f > 0 ? X.mix(track, col, f) : track;
    const ch = i >= st && i < st + chars.length ? chars[i - st] : ' ';
    s += `${bg(cb)}${fg(f > 0.5 ? ink : text)}${ch}`;
  }
  return s + NOBOLD;
}

// ---------- cards ----------

const edge = (pal, t = 0.24) => X.mix(pal.panel, pal.text, t);
const darken = (c, t = 0.35) => X.mix(c, BLACK, t);

// A horizontal border: ╭─ title ──── right ─╮ (ends picks the corners).
function rule(W, pal, ends, title = [], right = [], { color = edge(pal), panel = pal.panel } = {}) {
  const B = `${bg(panel)}${fg(color)}`;
  if (W < 4) return `${B}${'─'.repeat(Math.max(0, W))}${RESET}`;
  const room = W - 4;
  let rw = right.length ? partsWidth(right) + 2 : 0;
  if (title.length && partsWidth(title) + 2 + rw > room) { right = []; rw = 0; }
  const t = title.length ? fitParts(title, Math.max(0, room - rw - 2)) : [];
  const tw = t.length ? partsWidth(t) + 2 : 0;
  const fill = Math.max(0, room - tw - rw);
  return `${B}${ends[0]}─${tw ? ` ${renderParts(t, panel)}${B} ` : ''}${'─'.repeat(fill)}${rw ? ` ${renderParts(right, panel)}${B} ` : ''}─${ends[1]}${RESET}`;
}

const cardTop = (W, pal, title, right, o) => rule(W, pal, ['╭', '╮'], title, right, o);
const cardBottom = (W, pal, right = [], o) => rule(W, pal, ['╰', '╯'], [], right, o);
const cardSep = (W, pal, title, right, o) => rule(W, pal, ['├', '┤'], title, right, o);

// A card body row: │ parts … right │. `inner` tints the row (highlights).
function cardRow(W, pal, parts = [], right = [], { color = edge(pal), inner = pal.panel } = {}) {
  const B = `${bg(pal.panel)}${fg(color)}`;
  return `${B}│${panelLine(W - 2, inner, [[' ', pal.text], ...parts], [...right, [' ', pal.text]])}${B}│${RESET}`;
}

// A card body row from an already-colored string (padded to fit).
function cardRaw(W, pal, raw, { color = edge(pal), inner = pal.panel } = {}) {
  const B = `${bg(pal.panel)}${fg(color)}`;
  return `${B}│${padRaw(raw, W - 2, inner)}${B}│${RESET}`;
}

// Section header for callers that build their own card body (the quest log
// in game.js): ╭─ ≡ QUEST LOG ───── wave 3 ─╮.
const sectionHeader = (W, pal, title, right = [], icon = '≡') =>
  cardTop(W, pal, [[`${icon} `, pal.accent, true], [title, pal.accent, true]], right.map(([t, c, b]) => [t.trim(), c || pal.dim, b]));

// ---------- icons and colors ----------

const ICONS = { quest: '★', level: '▲', achievement: '◈', hurt: '×', faint: '†', summon: '◇', return: '«', combo: '»', prompt: '▸', welcome: '◆', waiting: '?', compact: '◐', action: '•' };

const CLASS_ICON = { mage: '∆', ranger: '»', knight: '†', warlock: '◉', bard: '♪', rogue: '‡' };
const SPELL_ICON = {
  basic: '•', fireball: '●', frost: '◇', chain: '≈', meteor: '▼', starfall: '☼',
  multishot: '≡', snare: '#', pierce: '→', rain: '↓', eagle: '∧',
  bash: '■', taunt: '!', whirl: '@', holy: '+', judgment: 'Ω',
  curse: '§', drain: '∞', imp: 'ж', shadowflame: '▲', doom: 'Ø',
  anthem: '♩', discord: '♯', echo: '∿', crescendo: '≋', encore: '★',
  backstab: '⌐', poison: '¡', smoke: '○', shadowstep: '⇥', deathmark: '×',
};
const SPELL_COLOR = {
  fireball: [255, 128, 56], frost: [130, 206, 255], chain: [255, 232, 110], meteor: [255, 96, 72], starfall: [206, 160, 255],
  multishot: [220, 190, 120], snare: [200, 170, 120], pierce: [230, 236, 255], rain: [210, 180, 120], eagle: [240, 220, 170],
  bash: [150, 200, 255], taunt: [120, 190, 255], whirl: [225, 232, 250], holy: [255, 236, 150], judgment: [255, 214, 90],
  curse: [190, 110, 250], drain: [236, 80, 110], imp: [255, 130, 50], shadowflame: [170, 90, 255], doom: [150, 80, 220],
  anthem: [255, 200, 90], discord: [255, 110, 170], echo: [200, 170, 255], crescendo: [255, 170, 220], encore: [255, 214, 80],
  backstab: [230, 90, 90], poison: [130, 225, 90], smoke: [180, 180, 196], shadowstep: [120, 220, 200], deathmark: [240, 70, 80],
};

const spellIcon = (sp, d) => (sp.id === 'basic' ? CLASS_ICON[d.hero.cls] || '•' : SPELL_ICON[sp.id] || '•');
const spellName = (sp, d) => (sp.id === 'basic' ? C.BASIC_NAMES[d.hero.cls] || sp.name : sp.name);
function spellColor(sp, pal) {
  if (pal === UI.retro) return pal.accent;
  return sp.id === 'basic' ? pal.accent : SPELL_COLOR[sp.id] || pal.magic;
}

function eventColor(kind, pal) {
  return { quest: pal.gold, level: pal.gold, achievement: pal.gold, hurt: pal.bad, faint: pal.bad, summon: pal.magic, return: pal.magic, combo: pal.accent, prompt: pal.accent, welcome: pal.good, waiting: pal.accent }[kind] || pal.dim;
}

function modeColor(mode, pal) {
  return { editing: pal.accent, running: pal.gold, reading: pal.good, searching: pal.good, web: pal.magic, summoning: pal.magic, planning: pal.accent, thinking: pal.magic, waiting: pal.accent, hurt: pal.bad, victory: pal.gold, cheer: pal.gold }[mode] || pal.dim;
}

const cap = (s) => String(s || '').charAt(0).toUpperCase() + String(s || '').slice(1);
const classColors = (cls, pal) => (pal === UI.retro ? { H: pal.accent, R: pal.good } : X.CLASS_COLORS[cap(cls)] || X.CLASS_COLORS.Mage);

// ---------- quest log ----------

function collapse(events) {
  const out = [];
  for (const e of events) {
    const last = out[out.length - 1];
    if (last && e.kind === last.kind && last.text === e.text) { last.n++; last.t = e.t; continue; }
    out.push({ ...e, n: 1 });
  }
  return out;
}

const stripIcon = (s) => String(s).replace(/^[\p{Extended_Pictographic}️‍ ]+/u, '');

// Card body rows for the quest log (h rows, the last one closes the card).
// Newest entry is highlighted; older entries fade toward the panel color.
function questLog(d, pal, W, h, compact = false) {
  if (h <= 0) return [];
  const closed = h >= 2, n = closed ? h - 1 : h;
  const last = d.events[d.events.length - 1];
  const evs = collapse(d.events.filter((e) => !compact || e.kind !== 'action' || e === last)).slice(-n);
  const rows = evs.map((e, i, arr) => {
    const age = arr.length - 1 - i, isLast = age === 0;
    const kc = eventColor(e.kind, pal);
    const inner = isLast ? X.mix(pal.panel, kc, 0.13) : pal.panel;
    const fade = Math.min(0.6, (age / Math.max(4, arr.length)) * 0.75);
    const base = e.kind === 'action' ? (isLast ? pal.text : pal.dim) : kc;
    const text = stripIcon(e.text) + (e.n > 1 ? ` ×${e.n}` : '');
    const time = new Date(e.t).toTimeString().slice(0, 5);
    return cardRow(W, pal, [[isLast ? '▸' : ' ', pal.accent, true], [` ${ICONS[e.kind] || '•'} `, X.mix(kc, inner, fade), true], [text, X.mix(base, inner, fade), e.kind !== 'action']],
      [[` ${time}`, X.mix(pal.dim, inner, fade * 0.6)]], { inner });
  });
  if (!rows.length) rows.push(cardRow(W, pal, [['Your deeds will be written here.', pal.dim]]));
  while (rows.length < n) rows.unshift(cardRow(W, pal, []));
  if (closed) rows.push(cardBottom(W, pal));
  return rows;
}

function fmtNum(n) { return n >= 1e6 ? `${(n / 1e6).toFixed(1)}M` : n >= 1e3 ? `${(n / 1e3).toFixed(1)}k` : String(n || 0); }

// ---------- hero card ----------

// Framed pixel portrait of the hero. The hero stands at x = hx so pets (up
// to 12 px to the left) and wings (6 px past each side) fit inside.
function portrait(d, pal, pw = 28, ph = 13, hx = 8) {
  const inset = darken(pal.panel, 0.4);
  const tint = C.COLORS[d.hero.primary] || pal.magic;
  const pc = new X.PixelCanvas(pw, ph, inset);
  for (let y = 0; y < pc.h; y++) for (let x = 0; x < pw; x++) pc.px[y * pw + x] = X.mix(inset, tint, 0.12 * (y / pc.h));
  pc.glow(hx + 8, pc.h * 0.55, 15, tint, 0.3);
  for (let x = 1; x < pw - 1; x++) { pc.set(x, pc.h - 3, X.mix(inset, pal.text, 0.14)); pc.set(x, pc.h - 2, X.mix(inset, pal.text, 0.06)); }
  SP.drawHero(pc, d.hero, hx, 1, { t: ui.tick, pose: (ui.tick >> 5) % 4 === 3 ? 'cheer' : 'stand' });
  // Retro is a green phosphor screen: render the portrait monochrome too.
  if (pal === UI.retro) pc.map((c) => X.mix(pal.ink, pal.text, (0.3 * c[0] + 0.59 * c[1] + 0.11 * c[2]) / 255));
  const fr = pal === UI.retro ? pal.dim : X.mix(pal.gold, pal.panel, 0.25);
  const lit = X.mix(fr, WHITE, 0.3), dark = X.shade(fr, 0.6);
  for (let x = 1; x < pw - 1; x++) { pc.set(x, 0, lit); pc.set(x, pc.h - 1, dark); }
  for (let y = 1; y < pc.h - 1; y++) { pc.set(0, y, fr); pc.set(pw - 1, y, dark); }
  for (const [x, y] of [[0, 0], [pw - 1, 0], [0, pc.h - 1], [pw - 1, pc.h - 1]]) pc.set(x, y, pal.panel);
  // twinkle on the frame
  const tw = (ui.tick >> 1) % 40;
  if (tw < pw - 2) pc.set(1 + tw, 0, WHITE);
  return pc.lines();
}

function statRows(d, pal, w) {
  const cls = C.CLASSES[d.hero.cls];
  const maxStat = Math.max(20, ...Object.values(d.stats));
  const colors = { STR: pal.bad, INT: pal.magic, DEX: pal.good, WIS: [110, 190, 255], CHA: pal.gold };
  const barW = Math.max(4, Math.min(28, w - 9));
  return Object.entries(d.stats).map(([k, v]) => {
    const main = k === cls.stat;
    const c = pal === UI.retro ? pal.accent : colors[k] || pal.accent;
    return padRaw(`${bg(pal.panel)}${fg(main ? pal.accent : pal.dim)}${main ? BOLD + '▸' : ' '}${fg(main ? pal.accent : pal.text)}${k}${NOBOLD} ${thinBar(v / maxStat, barW, X.shade(c, 0.6), c, X.mix(pal.panel, pal.text, 0.12), pal.panel)}${fg(main ? pal.accent : pal.text)}${main ? BOLD : ''}${String(v).padStart(3)}${NOBOLD}`, w, pal.panel);
  });
}

// Hero card: framed portrait + stats + spellbook. Used by the sidebar and Hero tab.
function heroCard(d, pal, W, { big = false } = {}) {
  const out = [];
  const cls = C.CLASSES[d.hero.cls];
  const t = L.theme(d.cfg);
  out.push(cardTop(W, pal, [[`${CLASS_ICON[d.hero.cls] || '◆'} `, pal.accent, true], [d.hero.name, pal.text, true]], [[L.titleFor(t, d.lvl), pal.magic]]));
  const pw = big ? 30 : 28, ph = 13, statW = W - 2 - pw - 1;
  const compact = statW < 24;
  const pic = portrait(d, pal, pw, ph, big ? 9 : 8);
  const lo = L.xpForLevel(d.lvl), hi = L.xpForLevel(d.lvl + 1);
  const ratio = (d.state.xp - lo) / (hi - lo);
  const tok = d.state.tokens || { input: 0, output: 0 };
  const right = [panelLine(statW, pal.panel, [[' ', pal.text], [` Lv ${d.lvl} `, pal.ink, true, pal.accent], [` ${cls.name}`, pal.text, true], [compact ? '' : ` · main ${cls.stat}`, pal.dim]])];
  if (compact) right.push(panelLine(statW, pal.panel, [[` main stat ${cls.stat}`, pal.dim]]));
  else for (const l of wrap(cls.desc, statW - 1, 2)) right.push(panelLine(statW, pal.panel, [[` ${l}`, pal.dim]]));
  while (right.length < 3) right.push(panelLine(statW, pal.panel, []));
  right.push(...statRows(d, pal, statW));
  right.push(panelLine(statW, pal.panel, []));
  const xpLabel = compact ? `XP ${Math.round(ratio * 100)}%` : `XP ${Math.round(ratio * 100)}% · ${fmtNum(hi - d.state.xp)} to go`;
  right.push(padRaw(`${bg(pal.panel)} ${labelBar(ratio, statW - 1, X.shade(pal.accent, 0.8), pal.gold, X.mix(pal.panel, pal.text, 0.1), xpLabel, { ink: pal.ink, text: pal.text })}`, statW, pal.panel));
  if (compact) {
    right.push(panelLine(statW, pal.panel, [[' ◉ ', pal.gold, true], [`${fmtNum(ui.battle.gold)} gold`, pal.gold, true]]));
    right.push(panelLine(statW, pal.panel, [[' × ', pal.bad, true], [`${fmtNum(ui.battle.kills)} slain`, pal.text]]));
    right.push(panelLine(statW, pal.panel, [[' ↑', pal.good, true], [fmtNum(tok.output), pal.text], [' ↓', pal.magic, true], [fmtNum(tok.input), pal.text]]));
  } else {
    right.push(panelLine(statW, pal.panel, [[' ◉ ', pal.gold, true], [`${fmtNum(ui.battle.gold)} gold`, pal.gold, true], ['  × ', pal.bad, true], [`${fmtNum(ui.battle.kills)} slain`, pal.text]]));
    right.push(panelLine(statW, pal.panel, [[' ↑ ', pal.good, true], [fmtNum(tok.output), pal.text, true], [' ↓ ', pal.magic, true], [fmtNum(tok.input), pal.text, true], [' tokens', pal.dim]]));
  }
  while (right.length < ph) right.push(panelLine(statW, pal.panel, []));
  const B = `${bg(pal.panel)}${fg(edge(pal))}`;
  for (let i = 0; i < ph; i++) out.push(`${B}│${pic[i]}${bg(pal.panel)} ${right[i]}${B}│${RESET}`);
  const kit = C.kitFor(d.hero.cls);
  const known = kit.filter((s) => s.lvl <= d.lvl).length;
  out.push(cardSep(W, pal, [['◇ ', pal.accent, true], ['SKILLS', pal.accent, true]], [[`${known}/${kit.length} known`, pal.dim]]));
  const perRow = big ? 3 : 2, inner = W - 2, colW = Math.floor(inner / perRow);
  for (let i = 0; i < kit.length; i += perRow) {
    const cells = kit.slice(i, i + perRow).map((s, j, arr) => {
      const w = j === arr.length - 1 ? inner - colW * (arr.length - 1) : colW;
      const ok = s.lvl <= d.lvl;
      return ok
        ? panelLine(w, pal.panel, [[` ${spellIcon(s, d)} `, spellColor(s, pal), true], [spellName(s, d), pal.text, true]])
        : panelLine(w, pal.panel, [[' Ө ', X.mix(pal.dim, pal.panel, 0.3)], [spellName(s, d), pal.dim], [` Lv ${s.lvl}`, X.mix(pal.dim, pal.panel, 0.3)]]);
    });
    out.push(`${B}│${cells.join('')}${B}│${RESET}`);
  }
  out.push(cardBottom(W, pal));
  return out;
}

// ---------- party ----------

function partyList(d, pal, W) {
  const party = Object.values(d.ses.party || {});
  const out = [cardTop(W, pal, [['◎ ', pal.magic, true], ['COMPANIONS', pal.accent, true]], [[party.length ? `${party.length} fighting` : 'none', party.length ? pal.magic : pal.dim]])];
  if (!party.length) out.push(cardRow(W, pal, [['Agents Claude launches join you here.', pal.dim]]));
  party.forEach((p, i) => {
    const cc = classColors(p.cls, pal).H;
    const spin = '◐◓◑◒'[((ui.tick >> 1) + i) % 4];
    out.push(p.guild
      ? cardRow(W, pal, [['● ', cc, true], [cap(p.cls).padEnd(9), cc, true], [p.name || p.type || '', pal.text]], [[`${spin} `, X.mix(cc, pal.panel, 0.3)], [`Lv ${p.level || 1}`, pal.dim]])
      : cardRow(W, pal, [['● ', cc, true], [cap(p.cls).padEnd(9), cc, true], [p.type || '', pal.text]], [[`${spin} `, X.mix(cc, pal.panel, 0.3)], [p.since ? `${Math.round((Date.now() - p.since) / 1000)}s` : '', pal.dim]]));
  });
  out.push(cardBottom(W, pal));
  return out;
}

function partyTab(d, pal, W, h) {
  const party = Object.values(d.ses.party || {});
  const out = [];
  if (party.length) {
    const top = darken(pal.panel, 0.35);
    const pc = new X.PixelCanvas(W, 9, top);
    for (let y = 0; y < pc.h; y++) for (let x = 0; x < W; x++) pc.px[y * W + x] = X.mix(top, pal.panel2, y / pc.h);
    for (let x = 0; x < W; x++) { pc.set(x, 15, X.mix(pal.panel2, pal.text, 0.18)); pc.set(x, 16, X.mix(pal.panel2, pal.text, 0.08)); }
    party.slice(0, Math.floor((W - 4) / 16)).forEach((p, i) => {
      const colors = classColors(p.cls);
      pc.glow(8 + i * 16, 10, 10, colors.H, 0.3);
      SP.drawCompanion(pc, p, 3 + i * 16, 3 + ((ui.tick + i * 3) >> 2 & 1), { t: ui.tick + i, id: p.name || i });
      pc.label(2 + i * 16, 8, cap(p.cls).slice(0, 12), pal.text, true);
    });
    out.push(...pc.lines());
  }
  out.push(...partyList(d, pal, W));
  const hist = d.events.filter((e) => e.kind === 'summon' || e.kind === 'return');
  const room = Math.max(1, h - out.length - 2);
  out.push(cardTop(W, pal, [['« ', pal.accent, true], ['RECENT ADVENTURES', pal.accent, true]], [[`${hist.length} tales`, pal.dim]]));
  const recent = hist.slice(-room);
  if (!recent.length) out.push(cardRow(W, pal, [['No companions have fought beside you yet.', pal.dim]]));
  recent.forEach((e, i) => {
    const fade = Math.min(0.5, (recent.length - 1 - i) * 0.08);
    out.push(cardRow(W, pal, [[`${ICONS[e.kind]} `, X.mix(eventColor(e.kind, pal), pal.panel, fade), true], [stripIcon(e.text), X.mix(pal.magic, pal.panel, fade)]], [[new Date(e.t).toTimeString().slice(0, 5), pal.dim]]));
  });
  out.push(cardBottom(W, pal));
  return out;
}

// ---------- trophies ----------

const RING = ['○', '◔', '◑', '◕', '●'];

// 950, 9.9k, 12k, 1.2M, 12M: at most 4 characters, so counts fit a trophy card.
const compact = (n) => (n < 1000 ? String(n) : n < 1e4 ? `${(n / 1e3).toFixed(1)}k` : n < 1e6 ? `${Math.round(n / 1e3)}k` : n < 1e7 ? `${(n / 1e6).toFixed(1)}M` : `${Math.round(n / 1e6)}M`);

function badge(a, d, pal, w, got) {
  const v = Math.min(a.goal, a.value(d.state, d.ses) || 0);
  const done = got.has(a.id), ratio = done ? 1 : v / a.goal;
  const col = done ? X.mix(pal.gold, pal.panel, 0.2) : ratio > 0 ? X.mix(pal.magic, pal.panel, 0.45) : edge(pal, 0.16);
  const icon = done ? '★' : RING[Math.min(3, Math.floor(ratio * 4))];
  const iconC = done ? pal.gold : ratio > 0 ? pal.magic : pal.dim;
  const inner = done ? X.mix(pal.panel, pal.gold, 0.06) : pal.panel;
  const barW = Math.max(4, w - 4 - 10);
  const count = `${compact(done ? a.goal : v)}/${compact(a.goal)}`;
  return [
    cardTop(w, pal, [[`${icon} `, iconC, true], [a.name, done ? pal.gold : pal.text, done]], [], { color: col }),
    cardRow(w, pal, [[a.desc, done ? pal.text : pal.dim]], [], { color: col, inner }),
    cardRaw(w, pal, `${bg(inner)} ${thinBar(ratio, barW, done ? pal.accent : X.shade(pal.magic, 0.7), done ? pal.gold : pal.magic, X.mix(inner, pal.text, 0.12), inner)}${fg(done ? pal.gold : pal.text)} ${count.padStart(9)}`, { color: col, inner }),
    cardBottom(w, pal, [[done ? '✓ unlocked' : `${Math.round(ratio * 100)}%`, done ? pal.good : pal.dim, done]], { color: col }),
  ];
}

function trophiesTab(d, pal, W) {
  const got = new Set(d.state.achievements);
  const total = L.ACHIEVEMENTS.length;
  const barW = Math.max(10, Math.min(30, W - 44));
  const out = W < 70 ? [panelLine(W, pal.panel2, [[' ★ TROPHIES ', pal.gold, true], [`${got.size}/${total} unlocked`, pal.dim]])] : [padRaw(`${bg(pal.panel2)}${fg(pal.gold)}${BOLD} ★ TROPHY HALL ${NOBOLD} ${labelBar(got.size / total, barW, X.shade(pal.gold, 0.7), pal.gold, X.mix(pal.panel2, pal.text, 0.1), `${got.size}/${total} unlocked`, { ink: pal.ink, text: pal.text })}${bg(pal.panel2)}${fg(pal.dim)}  ${got.size === total ? 'every trophy won!' : 'keep questing to fill the hall'}`, W, pal.panel2)];
  const cols = Math.max(1, Math.floor(W / 30)), cw = Math.floor(W / cols);
  const sorted = [...L.ACHIEVEMENTS].sort((a, b) => (got.has(b.id) ? 1 : 0) - (got.has(a.id) ? 1 : 0));
  for (let i = 0; i < sorted.length; i += cols) {
    const row = sorted.slice(i, i + cols).map((a, j) => badge(a, d, pal, j === cols - 1 ? W - cw * (cols - 1) : cw, got));
    while (row.length < cols) row.push(Array(4).fill(panelLine(row.length === cols - 1 ? W - cw * (cols - 1) : cw, pal.panel, [])));
    for (let r = 0; r < 4; r++) out.push(row.map((b) => b[r]).join(''));
  }
  return out;
}

// ---------- hero tab ----------

function heroTab(d, pal, W) {
  const out = heroCard(d, pal, W, { big: true });
  const s = d.state;
  const rows = [['Edits forged', s.tools.editing], ['Commands cast', s.tools.running], ['Files scouted', s.tools.reading], ['Searches', s.tools.searching], ['Web & MCP', s.tools.web], ['Allies summoned', s.tools.summoning], ['Plans drawn', s.tools.planning]];
  const max = Math.max(1, ...rows.map((r) => r[1] || 0));
  out.push(cardTop(W, pal, [['▲ ', pal.accent, true], ['DEEDS', pal.accent, true]], [[`${s.quests} quests · ${(s.streak || {}).count || 0}-day streak`, pal.dim]]));
  const barW = Math.max(8, Math.min(60, W - 2 - 19 - 8));
  for (const [label, n] of rows) {
    out.push(cardRaw(W, pal, `${bg(pal.panel)}${fg(pal.text)} ${label.padEnd(17)} ${thinBar((n || 0) / max, barW, X.shade(pal.magic, 0.8), pal.accent, X.mix(pal.panel, pal.text, 0.12), pal.panel)}${fg(n ? pal.text : pal.dim)}${BOLD}${fmtNum(n || 0).padStart(6)}${NOBOLD}`));
  }
  out.push(cardBottom(W, pal, [['press ', pal.dim], ['c', pal.accent, true], [' to edit your hero', pal.dim]]));
  return out;
}

// ---------- hotbar ----------

// Skill hotbar: key cap, spell icon, cooldown sweep, ready flash, locked
// slots greyed with a padlock. Records click zones (1-based columns).
function hotbar(d, pal, W) {
  C.setClass(d.hero.cls);
  const kit = C.kitFor(d.hero.cls);
  const base = darken(pal.panel, 0.35);
  let s = `${bg(base)} `, used = 1;
  const zones = [];
  ui.hbPrev = ui.hbPrev || {}; ui.hbReady = ui.hbReady || {};
  // Equal slots when wide; otherwise locked slots shrink to "Ө Lv N" so the
  // spells you know get room for their names.
  const even = Math.floor((W - 1) / kit.length);
  const useEven = even >= 22;
  const lockedW = (sp) => 3 + vis(` Ө Lv ${sp.lvl} `) + 1;
  const locked = kit.filter((sp) => sp.lvl > d.lvl);
  const knownN = kit.length - locked.length;
  const knownW = Math.max(12, Math.min(30, Math.floor((W - 1 - locked.reduce((n, sp) => n + lockedW(sp), 0)) / Math.max(1, knownN))));
  kit.forEach((sp, i) => {
    const known = sp.lvl <= d.lvl;
    const slotW = useEven ? Math.min(30, even) : known ? knownW : lockedW(sp);
    if (used + slotW > W) return;
    const inner = slotW - 1, bodyW = inner - 3;
    const cd = Math.max(0, (ui.cooldowns[sp.id] || 0) - ui.tick);
    const ready = known && cd === 0;
    if (ready && (ui.hbPrev[sp.id] || 0) > 0) ui.hbReady[sp.id] = ui.tick;
    ui.hbPrev[sp.id] = cd;
    const since = ui.tick - (ui.hbReady[sp.id] ?? -99);
    const flash = ready && since >= 0 && since < 6;
    const col = spellColor(sp, pal);
    // key cap
    const capBg = !known ? X.mix(base, pal.dim, 0.22) : flash ? WHITE : ready ? X.mix(pal.text, col, 0.35) : X.mix(pal.panel2, pal.text, 0.3);
    s += `${bg(capBg)}${fg(known ? pal.ink : darken(pal.dim, 0.3))}${BOLD} ${i + 1} ${NOBOLD}`;
    // body with the cooldown sweep
    const name = spellName(sp, d);
    let left, right = '';
    if (!known) left = useEven ? ` Ө Lv ${sp.lvl} ${name}` : ` Ө Lv ${sp.lvl}`;
    else {
      left = ` ${spellIcon(sp, d)} ${name}`;
      if (cd > 0) right = `${(cd / 10).toFixed(1)}s `;
      if (vis(left) + vis(right) > bodyW) right = cd > 0 ? '' : right;
    }
    const lt = truncVis(left, bodyW - vis(right));
    const cells = [...(lt + ' '.repeat(Math.max(0, bodyW - vis(lt) - vis(right))) + right)];
    const lockedBg = X.mix(base, pal.panel2, 0.45);
    const emptyBg = X.mix(base, pal.panel2, 0.8);
    const fullBg = flash ? X.mix(pal.panel2, col, since % 2 ? 0.55 : 0.8) : ready ? X.mix(pal.panel2, col, 0.26) : X.mix(pal.panel2, col, 0.14);
    const fill = !known ? 0 : ready ? bodyW : bodyW * (1 - cd / cooldownOf(sp.id));
    cells.forEach((ch, j) => {
      const f = Math.max(0, Math.min(1, fill - j));
      const cb = !known ? lockedBg : f >= 1 ? fullBg : f > 0 ? X.mix(emptyBg, fullBg, f) : emptyBg;
      const isIcon = j === 1;
      const fc = !known ? darken(pal.dim, 0.2) : flash ? pal.ink : isIcon ? (ready ? col : X.mix(col, pal.dim, 0.5)) : ready ? pal.text : pal.dim;
      s += `${bg(cb)}${fg(fc)}${ready && (isIcon || flash) ? BOLD : ''}${ch}${NOBOLD}`;
    });
    s += `${bg(base)} `;
    zones.push({ from: used + 1, to: used + inner, slot: i });
    used += slotW;
  });
  ui.hotbarZones = zones;
  return s + ' '.repeat(Math.max(0, W - used)) + RESET;
}

// ---------- header / footer ----------

function gradientText(str, c1, c2) {
  const chars = [...str];
  return chars.map((ch, i) => `${fg(X.mix(c1, c2, chars.length > 1 ? i / (chars.length - 1) : 0))}${ch}`).join('');
}

function header(d, pal, W) {
  if (d.hero) C.setClass(d.hero.cls); // C.SPELLS follows the active hero
  const t = L.theme(d.cfg);
  const out = [];
  const bar = darken(pal.panel, 0.35);

  // Row 1: logo + tab pills (clickable).
  const pills = (compact) => TABS.map((name, i) => {
    const on = i === ui.tab;
    const label = compact && !on ? ` ${i + 1} ` : ` ${i + 1} ${name} `;
    return { i, on, name: compact && !on ? '' : name, w: vis(label) + 2 };
  });
  let gap = 1, ps = pills(false), withName = true;
  const pillsW = () => ps.reduce((n, p) => n + p.w + gap, 0);
  const logoW = () => 16 + (withName ? vis(t.name) + 3 : 0);
  if (logoW() + pillsW() > W) withName = false;
  if (logoW() + pillsW() > W) ps = pills(true);
  if (logoW() + pillsW() > W) gap = 0;
  if (logoW() + pillsW() > W) ps = ps.filter((p) => p.on).map((p) => ({ ...p, name: `${p.name} ${ui.tab + 1}/${TABS.length}`, w: vis(` ${p.i + 1} ${p.name} ${ui.tab + 1}/${TABS.length} `) + 2 }));
  let s = `${bg(bar)}${fg(pal.accent)}${BOLD} ◆ ${gradientText('CLAUDE ARCADE', pal.accent, pal.gold)}${NOBOLD}`;
  if (withName) s += `${fg(pal.dim)} · ${t.name}`;
  const pw = pillsW();
  s += ' '.repeat(Math.max(0, W - vis(s) - pw));
  let x = W - pw;
  const zones = [];
  for (const p of ps) {
    const pb = p.on ? pal.accent : X.mix(bar, pal.text, 0.1);
    s += `${bg(bar)}${fg(pb)}▐${bg(pb)}${p.on ? BOLD : ''}${fg(p.on ? pal.ink : pal.text)} ${p.i + 1}${p.name ? `${fg(p.on ? pal.ink : pal.dim)} ${p.name}` : ''} ${NOBOLD}${bg(bar)}${fg(pb)}▌${' '.repeat(gap)}`;
    zones.push({ from: x + 1, to: x + p.w, tab: p.i });
    x += p.w + gap;
  }
  out.push(s + RESET);
  ui.tabZones = zones;

  // Row 2: hero, level badge, XP and HP bars with labels inside.
  const P2 = pal.panel2;
  const hp = Math.max(0, Math.min(100, d.ses.hp ?? 100));
  const lo = L.xpForLevel(d.lvl), hi = L.xpForLevel(d.lvl + 1);
  const cls = C.CLASSES[d.hero.cls];
  const xpW = Math.max(14, Math.min(32, Math.floor(W / 5))), hpW = Math.max(10, Math.min(20, Math.floor(xpW * 0.6)));
  const hpC = hp > 60 ? pal.good : hp > 30 ? pal.gold : pal.bad;
  const track = X.mix(P2, pal.text, 0.1);
  const segs = [
    `${bg(P2)}${fg(pal.text)}${BOLD} ${d.hero.name} ${NOBOLD}`,
    `${fg(pal.accent)}▐${bg(pal.accent)}${fg(pal.ink)}${BOLD}Lv ${d.lvl}${NOBOLD}${bg(P2)}${fg(pal.accent)}▌`,
    `${fg(pal.magic)} ${CLASS_ICON[d.hero.cls] || '◆'} ${cls.name}  `,
    `${labelBar((d.state.xp - lo) / (hi - lo), xpW, X.shade(pal.accent, 0.75), pal.gold, track, `XP ${fmtNum(d.state.xp)} / ${fmtNum(hi)}`, { ink: pal.ink, text: pal.text })}${bg(P2)}  `,
    `${labelBar(hp / 100, hpW, X.shade(hpC, 0.6), hpC, track, `HP ${hp}`, { ink: pal.ink, text: pal.text })}${bg(P2)}`,
    d.ses.combo >= 3 ? `${fg(pal.accent)}${BOLD}  » combo x${d.ses.combo}${NOBOLD}` : '',
    `${fg(pal.gold)}  ★ ${fg(pal.text)}${d.state.quests}${fg(pal.dim)} quest${d.state.quests === 1 ? '' : 's'}`,
  ];
  let row2 = '', w2 = 0;
  for (const sg of segs) { const sw = vis(sg); if (w2 + sw > W) break; row2 += sg; w2 += sw; }
  out.push(padRaw(row2, W, P2) + RESET);

  // Row 3: live mode indicator.
  const mode = currentMode(d.ses);
  const verb = mode === 'cheer' ? 'Cheering!' : (t.modes[mode] || t.modes.thinking).verb;
  const busy = isBusy(mode);
  const age = Math.max(0, Math.round((Date.now() - (d.ses.since || Date.now())) / 1000));
  const mc = modeColor(mode, pal);
  const glyph = busy ? '◐◓◑◒'[(ui.tick >> 1) % 4] : mode === 'waiting' ? (ui.tick >> 2) % 2 ? '!' : ' ' : mode === 'victory' || mode === 'cheer' ? '★' : '●';
  const pulse = busy ? 0.88 + 0.12 * Math.sin(ui.tick * 0.6) : mode === 'idle' ? 0.6 : 1;
  const pillC = X.mix(pal.panel, mc, pulse);
  const partyN = Object.keys(d.ses.party || {}).length;
  const pill = `${bg(pal.panel)} ${fg(pillC)}▐${bg(pillC)}${fg(pal.ink)}${BOLD}${glyph} ${verb.toUpperCase()}${busy ? '…' : ''}${NOBOLD}${bg(pal.panel)}${fg(pillC)}▌ `;
  const rightP = partyN ? [[`◎ ${partyN} companion${partyN > 1 ? 's' : ''} `, pal.magic, true]] : [[`${mode === 'idle' ? 'resting' : mode} `, pal.dim]];
  const restW = W - vis(pill);
  out.push(pill + panelLine(restW, pal.panel, [[d.ses.detail && mode !== 'victory' ? d.ses.detail : '', pal.text], [busy && age > 1 ? `  ${age}s` : '', pal.dim]], rightP));
  return out;
}

function footer(pal, W, keys) {
  const base = darken(pal.panel, 0.35);
  const capBg = X.mix(pal.panel2, pal.text, 0.16);
  let s = `${bg(base)} `, used = 1;
  for (const [k, lbl] of keys) {
    const kk = ` ${k} `, ll = ` ${lbl}  `;
    if (used + vis(kk) + vis(ll) > W) break;
    s += `${bg(capBg)}${fg(pal.accent)}${BOLD}${kk}${NOBOLD}${bg(base)}${fg(pal.dim)}${ll}`;
    used += vis(kk) + vis(ll);
  }
  return s + ' '.repeat(Math.max(0, W - used)) + RESET;
}

module.exports = {
  truncVis, panelLine, gradBar, barPart, ICONS, eventColor, collapse, stripIcon, questLog, fmtNum, heroCard, partyList, partyTab, trophiesTab, heroTab, hotbar, header, footer,
  // new helpers
  labelBar, thinBar, rule, cardTop, cardBottom, cardSep, cardRow, cardRaw, padRaw, sectionHeader, wrap, fitParts, renderParts,
  CLASS_ICON, SPELL_ICON, spellIcon, spellName, spellColor, modeColor, classColors, darken, edge, gradientText,
};
