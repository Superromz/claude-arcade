'use strict';
// The Guild: subagents that finish their work can ask to join your hero for
// good. Recruits live in state.game.guild (per hero, it swaps with the hero
// roster), level up from jobs of their own class, and up to three of them
// fight beside the hero as permanent companions.
//
// The top of this file is plain state logic used by hook.js and state.js
// (kept light: hooks must stay fast). The tab renderer requires the UI
// modules lazily.

const L = require('./lib');
const C = require('./character');

const MAX_OFFERS = 3;
const MAX_ACTIVE = 3;
const MAX_GUILD = 12;
const JOB_XP = 20; // companion XP per finished job of the recruit's class

// ---------- names ----------

const NAMES = {
  mage: ['Aldric', 'Merelda', 'Thessaly', 'Orvyn', 'Zanthe', 'Quillon', 'Isolde', 'Barnaby', 'Cyrene', 'Malachar'],
  ranger: ['Sylvara', 'Fenwick', 'Lirael', 'Tamsin', 'Hawke', 'Briar', 'Kestrel', 'Rowan', 'Ashling', 'Thorne'],
  knight: ['Gareth', 'Brienne', 'Aldous', 'Rosalind', 'Cedric', 'Maud', 'Percival', 'Ysolde', 'Tristan', 'Beatrix'],
  warlock: ['Morwen', 'Vesper', 'Skaldir', 'Nyx', 'Corvin', 'Hexana', 'Draven', 'Lilith', 'Umbral', 'Sable'],
  bard: ['Lark', 'Pippin', 'Rhiannon', 'Dandelion', 'Melisande', 'Tobias', 'Cadence', 'Fiddlewick', 'Aria', 'Jasper'],
  rogue: ['Vex', 'Nim', 'Shade', 'Kit', 'Rook', 'Sly', 'Wren', 'Dagny', 'Ferret', 'Lucan'],
};
const CLASS_IDS = Object.keys(NAMES);

const hashOf = (s) => { let h = 0; for (const ch of String(s)) h = (h * 31 + ch.charCodeAt(0)) >>> 0; return h; };
const clsOf = (cls) => (C.CLASSES[cls] ? cls : 'mage');
const className = (cls) => C.CLASSES[clsOf(cls)].name;

// A fantasy name that fits the class, stable for an agent id, avoiding names
// already taken in the guild or the offers.
function nameFor(cls, seed, taken = []) {
  const pool = NAMES[clsOf(cls)];
  const used = new Set(taken);
  const h = hashOf(seed);
  for (let i = 0; i < pool.length; i++) {
    const n = pool[(h + i) % pool.length];
    if (!used.has(n)) return n;
  }
  const base = pool[h % pool.length];
  for (let k = 2; ; k++) if (!used.has(`${base} ${roman(k)}`)) return `${base} ${roman(k)}`;
}
const roman = (n) => ['', 'I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII', 'IX', 'X'][n] || String(n);

// ---------- levels ----------

// Level n needs 40 * n * (n - 1) / 2 companion XP: 0, 40, 120, 240, ...
const levelFor = (xp) => Math.floor((1 + Math.sqrt(1 + (8 * Math.max(0, xp || 0)) / 40)) / 2);
const xpForLevel = (n) => (40 * n * (n - 1)) / 2;

// ---------- state ----------

const gameOf = (state) => (state.game && typeof state.game === 'object' ? state.game : (state.game = { gold: 0, kills: 0, inventory: [] }));
const guildOf = (state) => (Array.isArray((state.game || {}).guild) ? state.game.guild : []);
const offersOf = (state) => (Array.isArray((state.game || {}).recruitOffers) ? state.game.recruitOffers : []);
const takenNames = (state) => [...guildOf(state), ...offersOf(state)].map((g) => g.name);

// Called by the SubagentStop hook (inside its lock) with the departing party
// member. Adds a recruit offer and gives companion XP to active recruits of
// the same class. Never touches hero XP. Returns what happened for toasts.
function onSubagentStop(state, member, agentId, now = Date.now()) {
  if (!member || member.guild) return { offer: null, levelUps: [] };
  const game = gameOf(state);
  const cls = clsOf(member.cls);
  const levelUps = [];
  game.guild = guildOf(state).map((g) => {
    if (!g.active || g.cls !== cls) return g;
    const xp = (g.xp || 0) + JOB_XP;
    const level = levelFor(xp);
    if (level > (g.level || 1)) levelUps.push({ ...g, level });
    return { ...g, xp, level, jobs: (g.jobs || 0) + 1 };
  });
  const id = String(agentId || `${member.since || now}-${cls}`);
  let offer = null;
  const offers = offersOf(state);
  if (!offers.some((o) => o.id === id) && !game.guild.some((g) => g.id === id)) {
    offer = { id, name: nameFor(cls, id, takenNames(state)), cls, type: member.type || 'agent', t: now };
    game.recruitOffers = [...offers, offer].slice(-MAX_OFFERS);
  }
  return { offer, levelUps };
}

// Accept an offer into the guild. Active right away while there is room.
function accept(state, offerId, now = Date.now()) {
  const offers = offersOf(state);
  const o = offers.find((x) => x.id === offerId);
  if (!o) return { ok: false, msg: 'That offer is gone.' };
  const guild = guildOf(state);
  if (guild.length >= MAX_GUILD) return { ok: false, msg: `The guild is full (${MAX_GUILD}). Release someone first.` };
  const active = guild.filter((g) => g.active).length < MAX_ACTIVE;
  const member = { id: o.id, name: o.name, cls: clsOf(o.cls), type: o.type, level: 1, xp: 0, jobs: 0, recruitedAt: now, active, activeSince: active ? now : null };
  const game = gameOf(state);
  game.guild = [...guild, member];
  game.recruitOffers = offers.filter((x) => x.id !== offerId);
  return { ok: true, member, msg: `${o.name} the ${className(o.cls)} joins your guild!${active ? '' : ' (resting: 3 already active)'}` };
}

function dismiss(state, offerId) {
  const offers = offersOf(state);
  const o = offers.find((x) => x.id === offerId);
  if (!o) return { ok: false };
  gameOf(state).recruitOffers = offers.filter((x) => x.id !== offerId);
  return { ok: true, msg: `${o.name} goes on their way.` };
}

function release(state, id) {
  const guild = guildOf(state);
  const g = guild.find((x) => x.id === id);
  if (!g) return { ok: false };
  gameOf(state).guild = guild.filter((x) => x.id !== id);
  return { ok: true, msg: `${g.name} leaves the guild. Farewell!` };
}

function toggleActive(state, id, now = Date.now()) {
  const guild = guildOf(state);
  const g = guild.find((x) => x.id === id);
  if (!g) return { ok: false };
  if (!g.active && guild.filter((x) => x.active).length >= MAX_ACTIVE) return { ok: false, msg: `Only ${MAX_ACTIVE} recruits can fight at once.` };
  gameOf(state).guild = guild.map((x) => (x.id === id ? { ...x, active: !x.active, activeSince: x.active ? null : now } : x));
  return { ok: true, msg: g.active ? `${g.name} rests at the guild hall.` : `${g.name} joins the fight!` };
}

// Active recruits as party entries for the game pane (never saved to disk).
function partyEntries(state, cfg = {}) {
  const retro = cfg.theme === 'retro';
  const out = {};
  for (const g of guildOf(state).filter((x) => x && x.active).slice(0, MAX_ACTIVE)) {
    const cls = clsOf(g.cls);
    out[`guild:${g.id}`] = { type: 'guild', cls, name: g.name, icon: retro ? `[${className(cls)[0]}]` : C.CLASSES[cls].icon, since: g.activeSince || g.recruitedAt || 0, level: g.level || 1, guild: true };
  }
  return out;
}

// ---------- tab ----------

const gui = () => {
  const { ui } = require('./state');
  return (ui.guild ||= { sel: 0, top: 0, cols: 1, confirm: null, msg: null });
};

// Offers first, then the roster: one flat selection list.
function items(state) {
  return [...offersOf(state).slice().reverse().map((o) => ({ kind: 'offer', o })), ...guildOf(state).map((g) => ({ kind: 'member', g }))];
}

function write(d, fn) {
  let res = { ok: false };
  L.withLock(() => {
    const st = L.loadState();
    st.game = { ...(st.game || {}) };
    res = fn(st) || res;
    L.saveState(st);
    d.state = st;
  });
  return res;
}

function note(text, good = false) { const { ui } = require('./state'); gui().msg = text ? { text, good, until: ui.tick + 40 } : null; }

// Returns true when the key was handled by the guild tab.
function guildKey(key, d) {
  const g = gui();
  const list = items(d.state);
  g.sel = Math.max(0, Math.min(g.sel, list.length - 1));
  const cur = list[g.sel];
  if (g.confirm) {
    const id = g.confirm;
    g.confirm = null;
    if (key === 'x' || key === 'y') { const r = write(d, (st) => release(st, id)); note(r.msg, false); return true; }
    note('Kept them in the guild.', true);
    if (!['\x1b[A', '\x1b[B', '\x1b[C', '\x1b[D', '\r', '\n', 'a'].includes(key)) return true;
  }
  const nOffers = offersOf(d.state).length;
  const cols = Math.max(1, g.cols || 1);
  if (key === '\x1b[A' || key === '\x1b[B') {
    const down = key === '\x1b[B';
    if (g.sel < nOffers) g.sel += down ? 1 : -1;
    else if (down) g.sel = g.sel + cols < list.length ? g.sel + cols : g.sel - nOffers < Math.floor((list.length - 1 - nOffers) / cols) * cols ? list.length - 1 : g.sel;
    else g.sel = g.sel - cols >= nOffers ? g.sel - cols : nOffers ? nOffers - 1 : g.sel;
    g.sel = Math.max(0, Math.min(list.length - 1, g.sel));
    return true;
  }
  if (key === '\x1b[C' || key === '\x1b[D') {
    if (!list.length) return false; // nothing to browse: let arrows switch tabs
    g.sel = (g.sel + (key === '\x1b[C' ? 1 : -1) + list.length) % list.length;
    return true;
  }
  if (key === 'a') {
    const o = cur && cur.kind === 'offer' ? cur.o : offersOf(d.state)[nOffers - 1];
    if (!o) { note('No one is asking to join right now.'); return true; }
    const r = write(d, (st) => accept(st, o.id));
    note(r.msg, r.ok);
    if (r.ok) { const { ui } = require('./state'); ui.celebrate = { kind: 'purchase', text: r.msg, until: ui.tick + 20 }; }
    return true;
  }
  if (key === 'x') {
    if (!cur) return true;
    if (cur.kind === 'offer') { const r = write(d, (st) => dismiss(st, cur.o.id)); note(r.msg); return true; }
    g.confirm = cur.g.id;
    note(`Release ${cur.g.name}? Press x again to confirm.`);
    return true;
  }
  if (key === '\r' || key === '\n') {
    if (!cur) return true;
    const r = cur.kind === 'offer' ? write(d, (st) => accept(st, cur.o.id)) : write(d, (st) => toggleActive(st, cur.g.id));
    note(r.msg, r.ok);
    return true;
  }
  return false;
}

const ago = (t) => {
  const s = Math.max(0, Math.round((Date.now() - (t || 0)) / 1000));
  return s < 60 ? `${s}s ago` : s < 3600 ? `${Math.floor(s / 60)}m ago` : s < 86400 ? `${Math.floor(s / 3600)}h ago` : `${Math.floor(s / 86400)}d ago`;
};

function guildTab(d, pal, W, h = 20) {
  const X = require('./pixel');
  const SP = require('./sprites');
  const { RESET, fg, bg, ui } = require('./state');
  const P = require('./panels');
  const g = gui();
  const offers = offersOf(d.state).slice().reverse();
  const guild = guildOf(d.state);
  const list = items(d.state);
  g.sel = Math.max(0, Math.min(g.sel, Math.max(0, list.length - 1)));
  const cc = (cls) => P.classColors(cls, pal).H;
  const out = [];
  const activeN = guild.filter((x) => x.active).length;

  out.push(P.panelLine(W, pal.panel2, [[' GUILD ', pal.accent, true], [` ${guild.length} recruit${guild.length === 1 ? '' : 's'} · ${activeN}/${MAX_ACTIVE} fighting`, pal.dim]], [[offers.length ? `${offers.length} offer${offers.length > 1 ? 's' : ''} waiting ` : '', pal.gold, true]]));

  // Offers.
  out.push(P.cardTop(W, pal, [['◇ ', pal.magic, true], ['WANTS TO JOIN', pal.accent, true]], [[`${offers.length}/${MAX_OFFERS}`, pal.dim]]));
  if (!offers.length) out.push(P.cardRow(W, pal, [['Agents who finish a job may ask to join. None waiting.', pal.dim]]));
  offers.forEach((o, i) => {
    const sel = g.sel === i;
    const inner = sel ? X.mix(pal.panel, pal.accent, 0.16) : pal.panel;
    const pill = (k, label, c) => [[` ${k} `, pal.ink, true, c], [` ${label} `, sel ? pal.text : pal.dim]];
    out.push(P.cardRow(W, pal, [[sel ? '▸ ' : '  ', pal.accent, true], [o.name, cc(o.cls), true], [` the ${className(o.cls)}`, cc(o.cls)], [' wants to join!', pal.text], [`  ${o.type} · ${ago(o.t)}`, pal.dim]], [...pill('a', 'Accept', pal.good), ...pill('x', 'Dismiss', pal.bad)], { inner }));
  });
  out.push(P.cardBottom(W, pal));

  // Roster cards.
  const footerH = 1;
  const room = Math.max(0, h - out.length - footerH);
  const CARD_H = 10, PORT = 13;
  const cols = Math.max(1, Math.min(3, Math.floor(W / 36)));
  g.cols = cols;
  const cw = Math.floor(W / cols);
  if (!guild.length) {
    out.push(P.cardTop(W, pal, [['◎ ', pal.magic, true], ['ROSTER', pal.accent, true]], [['empty', pal.dim]]));
    out.push(P.cardRow(W, pal, [['Accept an offer and your recruit fights beside you between and during tasks.', pal.dim]]));
    out.push(P.cardRow(W, pal, [['Recruits gain levels from jobs of their own class.', pal.dim]]));
    out.push(P.cardBottom(W, pal));
  } else {
    const rowsFit = Math.max(1, Math.floor(room / CARD_H));
    const selRow = g.sel >= offers.length ? Math.floor((g.sel - offers.length) / cols) : 0;
    if (selRow < g.top) g.top = selRow;
    if (selRow >= g.top + rowsFit) g.top = selRow - rowsFit + 1;
    g.top = Math.max(0, Math.min(g.top, Math.max(0, Math.ceil(guild.length / cols) - rowsFit)));
    for (let r = g.top; r < g.top + rowsFit && r * cols < guild.length && out.length + CARD_H <= h - footerH; r++) {
      const cards = guild.slice(r * cols, r * cols + cols).map((m, j) => card(m, offers.length + r * cols + j, j === cols - 1 ? W - cw * (cols - 1) : cw));
      const used = cards.length === cols ? W : cw * cards.length;
      for (let i = 0; i < CARD_H; i++) out.push(cards.map((c) => c[i]).join('') + (used < W ? P.panelLine(W - used, pal.panel, []) : ''));
    }
    if (Math.ceil(guild.length / cols) > g.top + rowsFit && out.length < h - footerH) out.push(P.panelLine(W, pal.panel, [['  ▾ more recruits below', pal.dim]]));
  }
  while (out.length < h - footerH) out.push(P.panelLine(W, pal.panel, []));

  // Footer: message, release confirm or key help.
  const m = g.msg && g.msg.until > ui.tick ? g.msg : null;
  const help = [[' ↑↓←→ select · a accept · x dismiss/release · Enter toggle fighting', pal.dim]];
  out.push(P.panelLine(W, pal.panel2, m ? [[` ${m.text}`, g.confirm ? pal.gold : m.good ? pal.good : pal.bad, true]] : help));
  return out.slice(0, Math.max(1, h)).map((l) => fit(l, W, pal));

  function card(m, idx, w) {
    const sel = g.sel === idx;
    const c = cc(m.cls);
    const color = sel ? pal.accent : m.active ? X.mix(pal.panel, c, 0.6) : P.edge(pal);
    const inner = sel ? X.mix(pal.panel, pal.accent, 0.1) : pal.panel;
    const o = { color, inner };
    const lines = [];
    lines.push(P.cardTop(w, pal, [[m.name, c, true]], [[m.active ? '● FIGHTING' : '○ resting', m.active ? pal.good : pal.dim, m.active]], { color }));
    const pc = new X.PixelCanvas(PORT, 8, inner);
    if (m.active) pc.glow(6, 9, 8, c, 0.28);
    for (let x = 0; x < PORT; x++) pc.set(x, 15, X.mix(inner, pal.text, 0.12));
    const t = sel || m.active ? ui.tick : 0;
    SP.drawCompanion(pc, { cls: m.cls }, 1, 1 + (sel ? (t >> 2) & 1 : 0), { cls: m.cls, t, id: m.id, sit: !m.active && !sel });
    const port = pc.lines();
    const tw = w - 2 - PORT;
    const level = m.level || levelFor(m.xp);
    const lo = xpForLevel(level), hi = xpForLevel(level + 1);
    const ratio = Math.max(0, Math.min(1, ((m.xp || 0) - lo) / (hi - lo)));
    const role = P.wrap(C.CLASSES[clsOf(m.cls)].role, Math.max(4, tw - 1), 2);
    const bw = Math.max(4, Math.min(14, tw - 12));
    const text = [
      P.panelLine(tw, inner, [[` ${className(m.cls)}`, c, true], [` · ${m.type || 'agent'}`, pal.dim]]),
      ...role.map((r) => P.panelLine(tw, inner, [[` ${r}`, pal.text]])),
      ...(role.length < 2 ? [P.panelLine(tw, inner, [])] : []),
      P.panelLine(tw, inner, [[' Lv ', pal.dim], [String(level), pal.gold, true], ['  ', pal.dim], [`${m.jobs || 0} job${m.jobs === 1 ? '' : 's'}`, pal.text]]),
      P.padRaw(`${bg(inner)}${fg(pal.dim)} XP ${P.barPart(ratio, bw, X.mix(c, pal.text, 0.2), c, pal, inner)}${fg(pal.dim)} ${m.xp || 0}/${hi}`, tw, inner),
      P.panelLine(tw, inner, [[' Enter ', pal.accent, true], [m.active ? 'rest' : 'fight', pal.dim], ['  x ', pal.accent, true], ['release', pal.dim]]),
      P.panelLine(tw, inner, [[` joined ${ago(m.recruitedAt)}`, pal.dim]]),
      P.panelLine(tw, inner, []),
    ];
    for (let i = 0; i < 8; i++) lines.push(P.cardRaw(w, pal, `${port[i].replace(/\x1b\[0m$/, '')}${text[i] || P.panelLine(tw, inner, [])}`, o));
    lines.push(P.cardBottom(w, pal, [], { color }));
    return lines;
  }

  // Safety net: pad or cut a line to exactly W columns.
  function fit(line, Wd, p) {
    const w = L.visWidth(line);
    if (w === Wd) return line;
    if (w < Wd) return line.replace(/\x1b\[0m$/, '') + `${bg(p.panel)}${' '.repeat(Wd - w)}${RESET}`;
    return P.panelLine(Wd, p.panel, [[P.truncVis(line.replace(/\x1b\[[0-9;]*m/g, ''), Wd), p.text]]);
  }
}

module.exports = {
  MAX_OFFERS, MAX_ACTIVE, MAX_GUILD, JOB_XP, NAMES, CLASS_IDS,
  nameFor, levelFor, xpForLevel, onSubagentStop, accept, dismiss, release, toggleActive, partyEntries, guildTab, guildKey,
};
