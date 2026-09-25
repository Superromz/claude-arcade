'use strict';
// Daily and weekly bounties: small challenges picked from a pool by a seed
// made from the date, so every player sees the same board on the same day.
// Progress comes from real Claude usage (the quest log and the counters in
// state.json). Rewards are gold and sometimes a buff, never XP.
//
// state.game.bounties = { day, week, baseline: { day, week }, claimed: [] }
// is per hero (game is a hero field). baseline holds the counters at the
// start of the day/week, so progress survives the quest log being trimmed.

const fs = require('fs');
const L = require('./lib');
const X = require('./pixel');
const { RESET, BOLD, NOBOLD, fg, bg, ui } = require('./state');
const { panelLine, cardTop, cardRow, cardRaw, cardBottom, labelBar, truncVis } = require('./panels');

const DAY = 864e5;

// ---------- the pools ----------
// m is the progress context built by measure(): m.ev (counts from the quest
// log since the period started), m.dv(k) (counter delta since the baseline),
// m.state, m.start. group keeps two bounties about the same thing apart.

const DAILY = [
  { id: 'd-cast', group: 'running', name: 'Spellcaster', desc: 'Run 5 commands', goal: 5, gold: 40, value: (m) => Math.max(m.ev.running, m.dv('running')) },
  { id: 'd-cast-15', group: 'running', name: 'Battle Mage', desc: 'Run 15 commands', goal: 15, gold: 60, value: (m) => Math.max(m.ev.running, m.dv('running')) },
  { id: 'd-forge', group: 'editing', name: 'Busy Forge', desc: 'Edit 10 files', goal: 10, gold: 50, value: (m) => Math.max(m.ev.editing, m.dv('editing')) },
  { id: 'd-forge-25', group: 'editing', name: 'Hammer Time', desc: 'Make 25 edits', goal: 25, gold: 70, value: (m) => Math.max(m.ev.editing, m.dv('editing')) },
  { id: 'd-scout', group: 'reading', name: 'Scout Report', desc: 'Read or search 25 times', goal: 25, gold: 30, value: (m) => Math.max(m.ev.reading + m.ev.searching, m.dv('reading') + m.dv('searching')) },
  { id: 'd-quests', group: 'quests', name: 'Errand Runner', desc: 'Finish 3 quests', goal: 3, gold: 40, value: (m) => Math.max(m.ev.quests, m.dv('quests')) },
  { id: 'd-flawless', group: 'quests', name: 'Clean Sweep', desc: 'Finish 3 quests without a failure', goal: 3, gold: 60, value: (m) => m.ev.flawless },
  { id: 'd-summon', group: 'summon', name: 'Call the Party', desc: 'Summon 2 agents', goal: 2, gold: 50, value: (m) => Math.max(m.ev.summon, m.dv('summoning')) },
  { id: 'd-projects', group: 'projects', name: 'Two Realms', desc: 'Work in 2 different projects today', goal: 2, gold: 60, value: (m) => m.projects },
  { id: 'd-web', group: 'web', name: 'Eagle Post', desc: 'Use the web or an MCP tool 3 times', goal: 3, gold: 35, value: (m) => Math.max(m.ev.web, m.dv('web')) },
  { id: 'd-plan', group: 'planning', name: 'Battle Plans', desc: 'Plan or update todos 3 times', goal: 3, gold: 35, value: (m) => Math.max(m.ev.planning, m.dv('planning')) },
  { id: 'd-combo', group: 'combo', name: 'Combo Breaker', desc: 'Reach a 10-hit combo', goal: 10, gold: 45, value: (m) => m.ev.bestCombo },
  { id: 'd-waves', group: 'battle', name: 'Wave Breaker', desc: 'Clear 3 monster waves', goal: 3, gold: 40, value: (m) => m.ev.waves },
  { id: 'd-kills', group: 'battle', name: 'Pest Control', desc: 'Slay 25 monsters', goal: 25, gold: 40, value: (m) => m.dv('kills') },
  { id: 'd-tokens', group: 'tokens', name: 'Chatterbox', desc: 'Claude writes 5,000 output tokens', goal: 5000, gold: 40, value: (m) => m.dv('out') },
];

const WEEKLY = [
  { id: 'w-streak', group: 'streak', name: 'Steady Hand', desc: 'Keep a 3-day streak', goal: 3, gold: 150, buff: 'whetstone', value: (m) => m.streak },
  { id: 'w-boss', group: 'battle', name: 'Giant Killer', desc: 'Defeat a boss', goal: 1, gold: 150, buff: 'wardrum', value: (m) => m.ev.bosses },
  { id: 'w-kills', group: 'battle', name: 'Monster Cull', desc: 'Slay 150 monsters', goal: 150, gold: 150, value: (m) => m.dv('kills') },
  { id: 'w-quests', group: 'quests', name: 'Quest Marathon', desc: 'Finish 25 quests', goal: 25, gold: 200, value: (m) => Math.max(m.ev.quests, m.dv('quests')) },
  { id: 'w-flawless', group: 'quests', name: 'Untouched', desc: 'Finish 10 quests without a failure', goal: 10, gold: 220, value: (m) => m.ev.flawless },
  { id: 'w-forge', group: 'editing', name: 'Master Forge', desc: 'Make 100 edits', goal: 100, gold: 200, value: (m) => Math.max(m.ev.editing, m.dv('editing')) },
  { id: 'w-cast', group: 'running', name: 'Storm Caller', desc: 'Run 60 commands', goal: 60, gold: 180, value: (m) => Math.max(m.ev.running, m.dv('running')) },
  { id: 'w-summon', group: 'summon', name: 'Warband', desc: 'Summon 10 agents', goal: 10, gold: 180, buff: 'luckycharm', value: (m) => Math.max(m.ev.summon, m.dv('summoning')) },
  { id: 'w-projects', group: 'projects', name: 'Realm Hopper', desc: 'Work in 3 different projects', goal: 3, gold: 150, value: (m) => m.projects },
  { id: 'w-level', group: 'level', name: 'Growth Spurt', desc: 'Gain a level', goal: 1, gold: 150, value: (m) => m.ev.levels },
];

const PICKS = { daily: 3, weekly: 2 };

// ---------- dates and the seeded pick ----------

const dayStart = (t) => { const d = new Date(t); return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()); };
const weekStart = (t) => { const s = dayStart(t); return s - ((new Date(s).getUTCDay() + 6) % 7) * DAY; }; // Monday, UTC
const dayKey = (t) => new Date(dayStart(t)).toISOString().slice(0, 10);
const weekKey = (t) => `wk-${new Date(weekStart(t)).toISOString().slice(0, 10)}`;

function seedOf(str) {
  let h = 2166136261;
  for (const ch of String(str)) { h ^= ch.charCodeAt(0); h = Math.imul(h, 16777619); }
  return h >>> 0;
}
function rng(seed) { // mulberry32
  return () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
function pickN(pool, n, key) {
  const r = rng(seedOf(key)), left = pool.slice(), out = [], groups = new Set();
  while (out.length < n && left.length) {
    const b = left.splice(Math.floor(r() * left.length), 1)[0];
    if (groups.has(b.group)) continue;
    groups.add(b.group);
    out.push(b);
  }
  return out;
}

// The bounties posted for the day and week containing `now`.
function pickBounties(now = Date.now()) {
  return { day: dayKey(now), week: weekKey(now), daily: pickN(DAILY, PICKS.daily, `daily:${dayKey(now)}`), weekly: pickN(WEEKLY, PICKS.weekly, `weekly:${weekKey(now)}`) };
}

// ---------- progress ----------

// The quest log is re-read only when the file changes.
let evCache = { key: null, events: [], agg: {} };
function logEvents() {
  let key;
  try { const st = fs.statSync(L.EVENTS_FILE); key = `${st.mtimeMs}:${st.size}`; } catch { key = 'none'; }
  if (key !== evCache.key) evCache = { key, events: key === 'none' ? [] : L.readEvents(5000), agg: {} };
  return evCache;
}

// Counts from the quest log since `start`. A quest is flawless when nothing
// went wrong (a hurt event) in its session since the previous prompt.
function aggregate(events, start) {
  const a = { running: 0, editing: 0, reading: 0, searching: 0, web: 0, planning: 0, summon: 0, quests: 0, flawless: 0, bosses: 0, waves: 0, levels: 0, bestCombo: 0 };
  const hurt = {};
  for (const e of events) {
    if (!e) continue;
    const sid = e.sid || '-', live = (e.t || 0) >= start, text = String(e.text || '');
    if (e.kind === 'prompt') hurt[sid] = false;
    else if (e.kind === 'hurt') hurt[sid] = true;
    else if (e.kind === 'quest') { if (live) { a.quests++; if (!hurt[sid]) a.flawless++; } hurt[sid] = false; }
    if (!live) continue;
    if (e.kind === 'action' && e.mode in a) a[e.mode]++;
    else if (e.kind === 'summon') a.summon++;
    else if (e.kind === 'level' && !/New spell/i.test(text)) a.levels++;
    else if (e.kind === 'combo') {
      if (/^Boss defeated/i.test(text)) a.bosses++;
      else if (/^Wave \d+ cleared/i.test(text)) a.waves++;
      const c = /(\d+)-hit combo/.exec(text);
      if (c) a.bestCombo = Math.max(a.bestCombo, Number(c[1]));
    }
  }
  return a;
}

const killsNow = (state) => Math.max(((state && state.game) || {}).kills || 0, ui.battle.kills || 0);

// Counter snapshot stored as the day/week baseline.
function snapshot(state) {
  return { t: Date.now(), quests: state.quests || 0, tools: { ...(state.tools || {}) }, out: ((state.tokens || {}).output) || 0, kills: killsNow(state) };
}

function measure(state, start, base, now = Date.now()) {
  const c = logEvents();
  const ev = (c.agg[start] ||= aggregate(c.events, start));
  const cur = snapshot(state);
  const dv = (k) => {
    if (!base) return 0;
    const now = k in cur ? cur[k] : cur.tools[k] || 0;
    const was = k in base ? base[k] : (base.tools || {})[k] || 0;
    return Math.max(0, (now || 0) - (was || 0));
  };
  const projects = Object.values(state.projects || {}).filter((p) => (p.lastSeen || 0) >= start).length;
  const sk = state.streak || {};
  const streak = [dayKey(now), dayKey(now - DAY)].includes(sk.day) ? sk.count || 0 : 0;
  return { ev, dv, state, start, projects, streak };
}

// Make sure this hero has a baseline for the current day and week. Writes
// state.json at most once per day (and once per hero).
function ensure(d, now = Date.now()) {
  const day = dayKey(now), week = weekKey(now);
  const cur = (d.state.game || {}).bounties;
  if (cur && cur.day === day && cur.week === week && cur.baseline) return cur;
  const make = (st) => {
    const b = (st.game || {}).bounties || {}, snap = snapshot(st), base = b.baseline || {};
    return {
      day, week,
      baseline: { day: b.day === day && base.day ? base.day : snap, week: b.week === week && base.week ? base.week : snap },
      claimed: (b.claimed || []).filter((k) => k.startsWith(`${day}/`) || k.startsWith(`${week}/`)),
    };
  };
  try {
    return L.withLock(() => {
      const st = L.loadState();
      const nb = make(st);
      st.game = { ...(st.game || {}), bounties: nb };
      L.saveState(st);
      d.state = st;
      return nb;
    });
  } catch {
    return make(d.state);
  }
}

// Everything the board shows: each posted bounty with its progress.
function board(d, now = Date.now()) {
  const b = ensure(d, now);
  const posted = pickBounties(now);
  const claimed = new Set(b.claimed || []);
  const item = (def, period, key, start, base, endsAt) => {
    const value = Math.max(0, Math.floor(Number(def.value(measure(d.state, start, base, now))) || 0));
    const id = `${key}/${def.id}`;
    return { def, period, key: id, value: Math.min(value, def.goal), goal: def.goal, done: value >= def.goal, claimed: claimed.has(id), endsAt };
  };
  const ds = dayStart(now), ws = weekStart(now);
  const daily = posted.daily.map((def) => item(def, 'daily', posted.day, ds, (b.baseline || {}).day, ds + DAY));
  const weekly = posted.weekly.map((def) => item(def, 'weekly', posted.week, ws, (b.baseline || {}).week, ws + 7 * DAY));
  return { day: posted.day, week: posted.week, daily, weekly, all: [...daily, ...weekly] };
}

// ---------- claiming ----------

const bstate = () => (ui.bounties ||= { sel: 0, top: 0, msg: null });
function note(text, good = false) { bstate().msg = { text, good, until: (ui.tick || 0) + 30 }; }

// Pay out one finished bounty. Gold goes to ui.battle.gold (the game pane's
// wallet) and state.json in the same write, like the shop. Never XP.
function claim(it, d) {
  if (!it || !it.done || it.claimed) return false;
  let paid = false;
  L.withLock(() => {
    const st = L.loadState();
    const game = { ...(st.game || {}) };
    const b = { ...(game.bounties || {}) };
    const claimed = b.claimed || [];
    if (claimed.includes(it.key)) { d.state = st; return; } // claimed elsewhere
    ui.battle.gold = (ui.battle.gold || 0) + it.def.gold;
    ui.dirty = true;
    b.claimed = [...claimed, it.key];
    game.bounties = b;
    game.gold = ui.battle.gold;
    st.game = game;
    L.saveState(st);
    d.state = st;
    paid = true;
  });
  if (!paid) return false;
  it.claimed = true;
  let extra = '';
  if (it.def.buff) {
    try {
      const I = require('./items');
      if (I.addBuff && I.addBuff(it.def.buff)) extra = ` + ${(I.getItem(it.def.buff) || {}).name || it.def.buff}`;
    } catch {}
  }
  const text = `${it.def.name}: +${it.def.gold} gold${extra}`;
  ui.celebrate = { kind: 'purchase', text, until: (ui.tick || 0) + 20 };
  note(`Claimed ${text}`, true);
  try {
    const M = require('./messages');
    const th = (d.cfg && d.cfg.theme) || 'rpg';
    L.logEvent({ sid: d.sid, kind: 'combo', text: M.say(th, 'bountyDone', { name: it.def.name, gold: it.def.gold }) + extra });
  } catch {}
  return true;
}

// ---------- keys ----------

// Arrows move the selection, Enter claims. Returns true when handled.
function bountiesKey(key, d) {
  const s = bstate();
  const all = board(d).all;
  const n = all.length || 1;
  if (key === '\x1b[C' || key === '\x1b[B') { s.sel = (s.sel + 1) % n; return true; }
  if (key === '\x1b[D' || key === '\x1b[A') { s.sel = (s.sel + n - 1) % n; return true; }
  if (key === '\r' || key === '\n') {
    const it = all[s.sel];
    if (!it) return true;
    if (it.claimed) note('Already claimed');
    else if (!it.done) note(`${it.goal - it.value} to go`);
    else claim(it, d);
    return true;
  }
  return false;
}

// "2/5 bounties ready" for the header.
function bountySummary(d, now = Date.now()) {
  try {
    const all = board(d, now).all;
    const ready = all.filter((it) => it.done && !it.claimed).length;
    const claimed = all.filter((it) => it.claimed).length;
    if (ready) return `${ready}/${all.length} bounties ready`;
    if (claimed === all.length) return 'all bounties claimed';
    return `${claimed}/${all.length} bounties claimed`;
  } catch { return ''; }
}

// ---------- rendering ----------

function fmtLeft(ms) {
  const m = Math.max(0, Math.ceil(ms / 60000));
  const dd = Math.floor(m / 1440), hh = Math.floor((m % 1440) / 60), mm = m % 60;
  return dd ? `${dd}d ${hh}h` : hh ? `${hh}h ${mm}m` : `${mm}m`;
}
const fmtN = (n) => (n >= 1e4 ? `${Math.round(n / 1e3)}k` : String(n));

function card(it, pal, w, selected) {
  const ready = it.done && !it.claimed;
  const pulse = ready && ((ui.tick || 0) >> 3) % 2 === 0;
  const color = selected ? pal.accent : ready ? X.mix(pal.gold, pal.panel, pulse ? 0.1 : 0.35) : it.claimed ? X.mix(pal.good, pal.panel, 0.55) : X.mix(pal.panel, pal.text, 0.22);
  const inner = selected ? X.mix(pal.panel, pal.accent, 0.1) : ready ? X.mix(pal.panel, pal.gold, 0.07) : pal.panel;
  const icon = it.claimed ? '✓' : ready ? '★' : it.period === 'weekly' ? '◈' : '◆';
  const iconC = it.claimed ? pal.good : ready ? pal.gold : it.period === 'weekly' ? pal.magic : pal.accent;
  const o = { color, inner };
  const buff = it.def.buff ? (() => { try { return (require('./items').getItem(it.def.buff) || {}).name; } catch { return null; } })() : null;
  const barW = Math.max(6, w - 4);
  const label = `${fmtN(it.value)}/${fmtN(it.goal)}`;
  const c2 = it.claimed ? pal.good : ready ? pal.gold : it.period === 'weekly' ? pal.magic : pal.accent;
  const status = it.claimed ? [['✓ claimed', pal.good, true]]
    : ready ? [[selected ? '▸ Enter to claim' : '★ ready to claim', pal.gold, true]]
      : [[`${Math.floor((it.value / it.goal) * 100)}%`, pal.dim]];
  return [
    cardTop(w, pal, [[`${icon} `, iconC, true], [it.def.name, it.claimed ? pal.dim : selected || ready ? pal.gold : pal.text, true]], [[`◉ ${it.def.gold}`, pal.gold, true]], { color }),
    cardRow(w, pal, [[it.def.desc, it.claimed ? pal.dim : pal.text]], buff ? [[`+${buff}`, pal.magic]] : [], o),
    cardRaw(w, pal, `${bg(inner)} ${labelBar(it.value / it.goal, barW, X.shade(c2, 0.65), c2, X.mix(inner, pal.text, 0.12), label, { ink: pal.ink, text: pal.text })}${bg(inner)} `, o),
    cardBottom(w, pal, status, { color }),
  ];
}

// Cards in rows of `cols`; returns lines and which lines each card uses.
function grid(items, pal, W, selIdx, offset) {
  const cols = Math.max(1, Math.min(items.length, Math.floor(W / 28))), cw = Math.floor(W / cols);
  const lines = [], spans = [];
  for (let i = 0; i < items.length; i += cols) {
    const row = items.slice(i, i + cols);
    const cards = row.map((it, j) => card(it, pal, j === cols - 1 ? W - cw * (cols - 1) : cw, offset + i + j === selIdx));
    const used = row.length === cols ? W : cw * row.length;
    row.forEach((_, j) => spans[i + j] = [lines.length, lines.length + 3]);
    for (let r = 0; r < 4; r++) lines.push(cards.map((c) => c[r]).join('') + (used < W ? panelLine(W - used, pal.panel, []) : ''));
  }
  return { lines, spans };
}

function bountiesTab(d, pal, W, h = 20, now = Date.now()) {
  const s = bstate();
  const bd = board(d, now);
  if (s.sel >= bd.all.length) s.sel = 0;
  const gold = ui.battle.gold || ((d.state.game || {}).gold) || 0;
  const ready = bd.all.filter((it) => it.done && !it.claimed).length;
  const out = [];
  const claimedN = bd.all.filter((it) => it.claimed).length;
  const barW = Math.max(8, Math.min(24, W - 58));
  let head = W < 60 ? `${bg(pal.panel2)}${fg(pal.gold)}${BOLD} ✦ BOUNTIES ${NOBOLD}${fg(pal.dim)}${claimedN}/${bd.all.length}` : `${bg(pal.panel2)}${fg(pal.gold)}${BOLD} ✦ BOUNTY BOARD ${NOBOLD} ${labelBar(claimedN / Math.max(1, bd.all.length), barW, X.shade(pal.gold, 0.7), pal.gold, X.mix(pal.panel2, pal.text, 0.1), `${claimedN}/${bd.all.length} claimed`, { ink: pal.ink, text: pal.text })}${bg(pal.panel2)}`;
  if (ready) head += `${fg(pal.gold)}${BOLD}  ★ ${ready} ready${NOBOLD}`;
  const goldTxt = ` ◉ ${gold} gold `;
  out.push(fit(`${head}${' '.repeat(Math.max(1, W - L.visWidth(head) - L.visWidth(goldTxt)))}${BOLD}${fg(pal.gold)}${goldTxt}${NOBOLD}${RESET}`, W, pal, pal.panel2));

  const body = [];
  const section = (icon, title, n, left, color) => panelLine(W, pal.panel, [[` ${icon} `, color, true], [title, color, true], [W >= 64 ? `  ${n} posted` : '', pal.dim]], [[`${W >= 64 ? 'resets in ' : ''}${fmtLeft(left)} `, pal.dim]]);
  body.push(section('◆', 'DAILY BOUNTIES', bd.daily.length, bd.daily.length ? bd.daily[0].endsAt - now : 0, pal.accent));
  const g1 = grid(bd.daily, pal, W, s.sel, 0);
  const spans = g1.spans.map(([a, b]) => [a + 1, b + 1]);
  body.push(...g1.lines);
  body.push(section('◈', 'WEEKLY BOUNTIES', bd.weekly.length, bd.weekly.length ? bd.weekly[0].endsAt - now : 0, pal.magic));
  const base = body.length;
  const g2 = grid(bd.weekly, pal, W, s.sel, bd.daily.length);
  spans.push(...g2.spans.map(([a, b]) => [a + base, b + base]));
  body.push(...g2.lines);

  // Scroll so the selected card stays in view.
  const room = Math.max(1, h - 2);
  const [sa, sb] = spans[s.sel] || [0, 0];
  if (sa < s.top) s.top = Math.max(0, sa - 1);
  if (sb >= s.top + room) s.top = sb - room + 1;
  s.top = Math.max(0, Math.min(s.top, Math.max(0, body.length - room)));
  const view = body.slice(s.top, s.top + room);
  const tip = ' Bounties pay gold, never XP. Progress comes from your real Claude work.';
  while (view.length < room) view.push(panelLine(W, pal.panel, view.length === room - 1 && body.length <= room ? [[tip, pal.dim]] : []));
  out.push(...view);

  const m = s.msg && s.msg.until > (ui.tick || 0) ? s.msg : null;
  out.push(panelLine(W, pal.panel2, m ? [[` ${m.text}`, m.good ? pal.good : pal.bad, true]] : [[' ←↑↓→ select · Enter claim', pal.dim]], [[`${bd.day} UTC `, pal.dim]]));
  return out.slice(0, Math.max(1, h)).map((l) => fit(l, W, pal));
}

// Safety net: pad or cut a line to exactly W columns.
function fit(line, W, pal, panel = pal.panel) {
  const w = L.visWidth(line);
  if (w === W) return line;
  if (w < W) return line.replace(/\x1b\[0m$/, '') + `${bg(panel)}${' '.repeat(W - w)}${RESET}`;
  return panelLine(W, panel, [[truncVis(line.replace(/\x1b\[[0-9;]*m/g, ''), W), pal.text]]);
}

module.exports = { DAILY, WEEKLY, pickBounties, board, claim, ensure, bountiesTab, bountiesKey, bountySummary, dayKey, weekKey };
