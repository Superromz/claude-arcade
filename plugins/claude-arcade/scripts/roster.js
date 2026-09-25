'use strict';
// Hero select: a card per saved hero with its own progress, plus "New Hero".

const L = require('./lib');
const X = require('./pixel');
const C = require('./character');
const SP = require('./sprites');
const { ESC, RESET, BOLD, NOBOLD, fg, bg, UI, ui } = require('./state');
const { panelLine, footer, truncVis, barPart } = require('./panels');

const CARD_W = 30;

function openRoster() {
  ui.screen = 'roster';
  const cfg = L.loadConfig();
  const heroes = cfg.heroes || [];
  const i = heroes.findIndex((h) => h.id === cfg.activeHero);
  ui.roster = { sel: i >= 0 ? i : 0, confirmDelete: null };
}

function ago(ms) {
  const s = Math.max(0, (Date.now() - ms) / 1000);
  if (s < 90) return 'now';
  if (s < 3600) return `${Math.round(s / 60)}m ago`;
  if (s < 86400) return `${Math.round(s / 3600)}h ago`;
  return `${Math.round(s / 86400)}d ago`;
}

// One hero card: portrait on top, name/class/level, XP bar and stats.
function card(h, selected, pal, height) {
  const w = CARD_W;
  const panel = selected ? pal.panel2 : pal.panel;
  const edge = selected ? pal.accent : X.mix(pal.panel, pal.text, 0.18);
  const out = [];
  const rule = (l, r) => `${bg(pal.panel)}${fg(edge)}${l}${'─'.repeat(w - 2)}${r}${RESET}`;
  const row = (content) => `${bg(pal.panel)}${fg(edge)}│${RESET}${content}${bg(pal.panel)}${fg(edge)}│${RESET}`;
  out.push(rule('╭', '╮'));
  if (!h) {
    // "New hero" card.
    const inner = height - 2;
    for (let i = 0; i < inner; i++) {
      const mid = Math.floor(inner / 2);
      const text = i === mid - 1 ? '＋' : i === mid ? 'NEW HERO' : i === mid + 1 ? 'press n or enter' : '';
      const pad = Math.max(0, Math.floor((w - 2 - L.visWidth(text)) / 2));
      out.push(row(panelLine(w - 2, panel, [[' '.repeat(pad), pal.dim], [text, i === mid ? pal.accent : pal.dim, i === mid]])));
    }
    out.push(rule('╰', '╯'));
    return out;
  }
  const cls = C.CLASSES[h.cls] || C.CLASSES.mage;
  // Portrait.
  const ph = 13;
  const pc = new X.PixelCanvas(w - 2, ph, panel);
  pc.glow((w - 2) / 2, 18, 16, C.COLORS[h.primary] || pal.magic, selected ? 0.35 : 0.18);
  for (let x = 4; x < w - 6; x++) pc.set(x, 25, X.mix(panel, pal.text, 0.12));
  const pose = selected ? (['stand', 'walk1', 'stand', 'walk2', 'cheer'][(ui.tick >> 4) % 5]) : 'stand';
  SP.drawHero(pc, h, Math.floor((w - 2) / 2) - 8, 1, { pose, t: ui.tick, action: selected });
  if (h.active) pc.label(1, 0, '▶ ACTIVE', pal.good, true);
  out.push(...pc.lines().map((l) => row(l)));
  const lo = L.xpForLevel(h.level), hi = L.xpForLevel(h.level + 1);
  const lines = [
    panelLine(w - 2, panel, [[` ${h.name}`, selected ? pal.accent : pal.text, true]], [[`Lv ${h.level} `, pal.gold, true]]),
    panelLine(w - 2, panel, [[` ${cls.icon || ''} ${cls.name}`, pal.magic]], [[`${ago(h.lastPlayed)} `, pal.dim]]),
    `${bg(panel)} ${barPart((h.xp - lo) / Math.max(1, hi - lo), w - 4, pal.accent, pal.gold, pal, panel)} ${RESET}`,
    panelLine(w - 2, panel, [[` ★ ${h.quests} quests`, pal.text], [`   ✦ ${h.achievements} trophies`, pal.dim]]),
    panelLine(w - 2, panel, [[` ◉ ${h.gold} gold`, pal.gold], [`   × ${h.kills} slain`, pal.dim]]),
  ];
  for (const l of lines) out.push(row(l));
  while (out.length < height - 1) out.push(row(panelLine(w - 2, panel, [])));
  out.push(rule('╰', '╯'));
  return out.slice(0, height);
}

function rosterFrame(cols, rows) {
  const cfg = L.loadConfig(), state = L.loadState();
  const pal = UI[cfg.theme] || UI.rpg;
  const W = Math.max(30, cols);
  const heroes = L.heroList(cfg, state);
  const r = ui.roster || (openRoster(), ui.roster);
  const slots = [...heroes, null];
  r.sel = Math.max(0, Math.min(r.sel, slots.length - 1));
  const out = [panelLine(W, pal.panel, [[' ◆ CLAUDE ARCADE ', pal.accent, true], ['· Choose your hero', pal.text]], [[`${heroes.length} hero${heroes.length === 1 ? '' : 'es'} `, pal.dim]])];
  const bodyH = Math.max(12, rows - 3);
  const cardH = Math.min(22, bodyH - 2);
  const perRow = Math.max(1, Math.floor((W - 2) / (CARD_W + 2)));
  // Scroll so the selected card is visible.
  const first = Math.max(0, Math.min(r.sel - perRow + 1, slots.length - perRow));
  const shown = slots.slice(first, first + perRow);
  const cards = shown.map((h, i) => card(h, first + i === r.sel, pal, cardH));
  out.push(panelLine(W, pal.panel, []));
  const used = shown.length * (CARD_W + 2);
  const left = Math.max(0, Math.floor((W - used) / 2));
  for (let i = 0; i < cardH; i++) {
    let line = `${bg(pal.panel)}${' '.repeat(left)}`;
    for (const c of cards) line += `${c[i]}${bg(pal.panel)}  `;
    out.push(line + `${bg(pal.panel)}${' '.repeat(Math.max(0, W - left - used))}${RESET}`);
  }
  // Details of the selected hero.
  const h = slots[r.sel];
  const info = h
    ? [[` ${h.name} the ${(C.CLASSES[h.cls] || {}).name}: `, pal.accent, true], [(C.CLASSES[h.cls] || {}).desc || '', pal.text]]
    : [[' Start a new adventure. ', pal.accent, true], ['Each hero levels up separately — only the active hero earns XP from your Claude work.', pal.dim]];
  if (r.confirmDelete && h && r.confirmDelete === h.id) info.splice(0, info.length, [` Delete ${h.name} and all their progress? Press x again to confirm, any other key to cancel.`, pal.bad, true]);
  if (r.message) info.push([`  ${r.message}`, pal.bad]);
  out.push(panelLine(W, pal.panel, []));
  out.push(panelLine(W, pal.panel2, info));
  while (out.length < rows - 1) out.push(panelLine(W, pal.panel, []));
  out.push(footer(pal, W, [['←→', 'choose'], ['enter', 'play'], ['n', 'new hero'], ['e', 'edit look'], ['x', 'delete'], ['q', 'quit']]));
  return out.slice(0, rows);
}

// Returns an action for game.js: { play }, { create }, { edit }, { quit }, or null.
function rosterKey(key) {
  const cfg = L.loadConfig();
  const heroes = cfg.heroes || [];
  const r = ui.roster;
  const n = heroes.length + 1;
  const h = heroes[r.sel];
  r.message = '';
  if (key !== 'x') r.confirmDelete = null;
  if (key === '\x1b[C' || key === '\t') r.sel = (r.sel + 1) % n;
  else if (key === '\x1b[D') r.sel = (r.sel + n - 1) % n;
  else if (key === 'n' || ((key === '\r' || key === '\n') && !h)) return { create: true };
  else if (key === '\r' || key === '\n') { L.switchHero(h.id); return { play: h.id }; }
  else if (key === 'e' && h) { L.switchHero(h.id); return { edit: h.id }; }
  else if (key === 'x' && h) {
    if (heroes.length <= 1) r.message = 'You need at least one hero.';
    else if (r.confirmDelete === h.id) { L.deleteHero(h.id); r.confirmDelete = null; r.sel = Math.max(0, r.sel - 1); }
    else r.confirmDelete = h.id;
  } else if (key === 'q' || key === '\x1b' || key === '\x03') return { quit: true };
  return null;
}

module.exports = { openRoster, rosterFrame, rosterKey };
