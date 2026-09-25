'use strict';
// Daily, weekly and monthly bounties: small challenges picked from a pool by
// a seed made from the date, so every player sees the same board on the same
// day. Progress comes from real Claude usage (the quest log and the counters
// in state.json). Rewards are gold and sometimes a buff, never XP.
//
// state.game.bounties (per hero; game is a hero field):
//   { day, week, month,
//     baseline: { day, week, month },  counters when each period started
//     progress: { 'key/id': n },       best progress seen, so it survives
//                                      the quest log being trimmed
//     claimed: ['key/id', ...],        claims in the current periods
//     stats: { daily, weekly, monthly } lifetime claims (achievements) }

const fs = require('fs');
const L = require('./lib');
const X = require('./pixel');
const { RESET, BOLD, NOBOLD, fg, bg, ui } = require('./state');
const { panelLine, cardTop, cardRow, cardRaw, cardBottom, labelBar, truncVis } = require('./panels');

const DAY = 864e5;
const TIER_IDS = ['wooden', 'iron', 'gold', 'epic', 'legendary'];

// ---------- the pools ----------
// m is the progress context built by measure(): m.ev (counts from the quest
// log since the period started), m.dv(k) (counter delta since the baseline),
// m.state, m.projects, m.streak. `group` keeps two bounties about the same
// thing off the same board. `buff` is an items.js buff id given on claim.

const both = (ev, dv) => (m) => Math.max(m.ev[ev], m.dv(dv));
const runs = both('running', 'running'), edits = both('editing', 'editing'), summons = both('summon', 'summoning');
const webs = both('web', 'web'), plans = both('planning', 'planning'), quests = both('quests', 'quests');
const scouts = (m) => Math.max(m.ev.reading + m.ev.searching, m.dv('reading') + m.dv('searching'));
const bosses = both('bosses', 'bosses'), chests = both('chests', 'chests');
const levels = both('levels', 'lvl');
const tierUp = (i) => (m) => TIER_IDS.slice(i).reduce((n, t) => n + m.ev.tiers[t], 0);
const B = (id, group, name, desc, goal, gold, value, buff) => ({ id, group, name, desc, goal, gold, value, ...(buff ? { buff } : {}) });

const DAILY = [
  B('d-cast', 'running', 'Spellcaster', 'Run 5 commands', 5, 40, runs),
  B('d-cast-15', 'running', 'Battle Mage', 'Run 15 commands', 15, 60, runs),
  B('d-cast-30', 'running', 'Thunderstorm', 'Run 30 commands', 30, 90, runs),
  B('d-forge', 'editing', 'Busy Forge', 'Edit 10 files', 10, 50, edits),
  B('d-forge-25', 'editing', 'Hammer Time', 'Make 25 edits', 25, 70, edits),
  B('d-forge-50', 'editing', 'Forge Fire', 'Make 50 edits', 50, 100, edits),
  B('d-scout', 'reading', 'Scout Report', 'Read or search 25 times', 25, 30, scouts),
  B('d-read', 'reading', 'Bookworm', 'Read 10 files', 10, 30, both('reading', 'reading')),
  B('d-search', 'reading', 'Treasure Map', 'Search the code 10 times', 10, 30, both('searching', 'searching')),
  B('d-scout-75', 'reading', 'Deep Dive', 'Read or search 75 times', 75, 70, scouts),
  B('d-quest-1', 'quests', 'Opening Move', 'Finish a quest', 1, 20, quests),
  B('d-quests', 'quests', 'Errand Runner', 'Finish 3 quests', 3, 40, quests),
  B('d-quests-6', 'quests', 'Busy Day', 'Finish 6 quests', 6, 70, quests),
  B('d-quests-10', 'quests', 'Quest Frenzy', 'Finish 10 quests', 10, 110, quests),
  B('d-flawless', 'flawless', 'Clean Sweep', 'Finish 3 quests without a failure', 3, 60, (m) => m.ev.flawless),
  B('d-flawless-5', 'flawless', 'Spotless', 'Finish 5 quests without a failure', 5, 90, (m) => m.ev.flawless),
  B('d-summon', 'summon', 'Call the Party', 'Summon 2 agents', 2, 50, summons),
  B('d-summon-5', 'summon', 'Rally the Troops', 'Summon 5 agents', 5, 80, summons),
  B('d-return', 'summon', 'Safe Return', 'Have 3 agents return with news', 3, 45, (m) => m.ev.returns),
  B('d-projects', 'projects', 'Two Realms', 'Work in 2 different projects today', 2, 60, (m) => m.projects),
  B('d-projects-3', 'projects', 'Three Realms', 'Work in 3 different projects today', 3, 90, (m) => m.projects),
  B('d-web', 'web', 'Eagle Post', 'Use the web or an MCP tool 3 times', 3, 35, webs),
  B('d-web-10', 'web', 'Scout Eagles', 'Use the web or an MCP tool 10 times', 10, 60, webs),
  B('d-plan', 'planning', 'Battle Plans', 'Plan or update todos 3 times', 3, 35, plans),
  B('d-plan-8', 'planning', 'War Room', 'Plan or update todos 8 times', 8, 55, plans),
  B('d-combo', 'combo', 'Combo Breaker', 'Reach a 10-hit combo', 10, 45, (m) => m.ev.bestCombo),
  B('d-combo-20', 'combo', 'Combo Master', 'Reach a 20-hit combo', 20, 70, (m) => m.ev.bestCombo),
  B('d-combo-x3', 'combo', 'Chain Reaction', 'Hit 3 combo milestones (every 10 hits)', 3, 60, (m) => m.ev.combos),
  B('d-waves', 'battle', 'Wave Breaker', 'Clear 3 monster waves', 3, 40, (m) => m.ev.waves),
  B('d-waves-8', 'battle', 'Siege Breaker', 'Clear 8 monster waves', 8, 80, (m) => m.ev.waves),
  B('d-kills', 'battle', 'Pest Control', 'Slay 25 monsters', 25, 40, (m) => m.dv('kills')),
  B('d-kills-75', 'battle', 'Night Watch', 'Slay 75 monsters', 75, 80, (m) => m.dv('kills')),
  B('d-boss', 'boss', 'Boss of the Day', 'Defeat a boss', 1, 90, bosses),
  B('d-tokens', 'tokens', 'Chatterbox', 'Claude writes 5,000 output tokens', 5000, 40, (m) => m.dv('out')),
  B('d-tokens-20k', 'tokens', 'Novelist', 'Claude writes 20,000 output tokens', 20000, 80, (m) => m.dv('out')),
  B('d-chests', 'chests', 'Loot Run', 'Open 3 chests', 3, 40, chests),
  B('d-chest-iron', 'chests', 'Heavy Metal', 'Open an Iron chest or better', 1, 60, tierUp(1)),
  B('d-chest-quest', 'chests', 'Quest Reward', 'Open 2 quest chests', 2, 50, (m) => m.ev.questChests),
  B('d-mats', 'chests', 'Gatherer', 'Find 6 crafting materials in chests', 6, 45, (m) => m.ev.mats),
  B('d-offer', 'guild', 'Help Wanted', 'Get a recruit offer for your guild', 1, 50, (m) => m.ev.offers),
  B('d-sessions', 'sessions', 'Juggler', 'Start quests in 2 different Claude sessions', 2, 45, (m) => m.ev.sessions),
  B('d-approve', 'approvals', 'Gatekeeper', 'Allow 3 requests from the game pane', 3, 40, (m) => m.ev.approvals),
  B('d-night', 'time', 'Night Shift', 'Finish a quest after 10 pm', 1, 50, (m) => m.ev.nightQuests),
];

const WEEKLY = [
  B('w-streak', 'streak', 'Steady Hand', 'Keep a 3-day streak', 3, 150, (m) => m.streak, 'whetstone'),
  B('w-streak-5', 'streak', 'Five Alive', 'Keep a 5-day streak', 5, 220, (m) => m.streak, 'whetstone'),
  B('w-boss', 'boss', 'Giant Killer', 'Defeat a boss', 1, 150, bosses, 'wardrum'),
  B('w-bosses-3', 'boss', 'Boss Hunt', 'Defeat 3 bosses', 3, 260, bosses, 'wardrum'),
  B('w-kills', 'battle', 'Monster Cull', 'Slay 150 monsters', 150, 150, (m) => m.dv('kills')),
  B('w-waves', 'battle', 'Tide Breaker', 'Clear 25 monster waves', 25, 180, (m) => m.ev.waves),
  B('w-quests', 'quests', 'Quest Marathon', 'Finish 25 quests', 25, 200, quests),
  B('w-quests-50', 'quests', 'Epic Saga', 'Finish 50 quests', 50, 320, quests),
  B('w-flawless', 'flawless', 'Untouched', 'Finish 10 quests without a failure', 10, 220, (m) => m.ev.flawless),
  B('w-forge', 'editing', 'Master Forge', 'Make 100 edits', 100, 200, edits),
  B('w-forge-250', 'editing', 'Great Forge', 'Make 250 edits', 250, 320, edits),
  B('w-cast', 'running', 'Storm Caller', 'Run 60 commands', 60, 180, runs),
  B('w-scout', 'reading', 'Grand Survey', 'Read or search 300 times', 300, 150, scouts),
  B('w-web', 'web', 'Eagle Network', 'Use the web or an MCP tool 40 times', 40, 180, webs),
  B('w-plan', 'planning', 'Grand Strategy', 'Plan or update todos 30 times', 30, 160, plans),
  B('w-summon', 'summon', 'Warband', 'Summon 10 agents', 10, 180, summons, 'luckycharm'),
  B('w-projects', 'projects', 'Realm Hopper', 'Work in 3 different projects', 3, 150, (m) => m.projects),
  B('w-level', 'level', 'Growth Spurt', 'Gain a level', 1, 150, levels),
  B('w-combo', 'combo', 'Combo Legend', 'Reach a 40-hit combo', 40, 200, (m) => m.ev.bestCombo),
  B('w-chests', 'chests', 'Treasure Trove', 'Open 15 chests', 15, 180, chests),
  B('w-chest-gold', 'chests', 'Gold Fever', 'Open a Gold chest or better', 1, 200, tierUp(2), 'luckycharm'),
  B('w-mats', 'chests', 'Stockpile', 'Find 30 crafting materials in chests', 30, 180, (m) => m.ev.mats),
  B('w-items', 'items', 'New Look', 'Add 2 new items to your collection', 2, 200, (m) => m.dv('items')),
  B('w-recruit', 'guild', 'Recruitment Drive', 'Welcome a new recruit into your guild', 1, 200, (m) => m.dv('guild')),
  B('w-guild-lvl', 'guild', 'Training Grounds', 'Recruits gain 2 guild levels', 2, 200, (m) => m.ev.recruitUps),
  B('w-skills', 'skills', 'Studious', 'Learn 2 skill ranks', 2, 180, (m) => m.dv('ranks') + m.dv('paragon')),
  B('w-tokens', 'tokens', 'Wordsmith Week', 'Claude writes 100,000 output tokens', 1e5, 200, (m) => m.dv('out')),
  B('w-sessions', 'sessions', 'Many Fronts', 'Start quests in 8 different Claude sessions', 8, 180, (m) => m.ev.sessions),
];

const MONTHLY = [
  B('m-streak-20', 'streak', 'Iron Will', 'Reach a 20-day streak', 20, 1000, (m) => m.streak, 'phoenixdraught'),
  B('m-bosses-10', 'boss', 'Boss Slayer', 'Defeat 10 bosses', 10, 1000, bosses, 'wardrum'),
  B('m-quests-200', 'quests', 'Legend of the Month', 'Finish 200 quests', 200, 1200, quests),
  B('m-forge-1000', 'editing', 'Thousand Hammers', 'Make 1,000 edits', 1000, 1000, edits),
  B('m-cast-500', 'running', 'Tempest', 'Run 500 commands', 500, 900, runs),
  B('m-summon-50', 'summon', 'Grand Army', 'Summon 50 agents', 50, 1000, summons, 'luckycharm'),
  B('m-projects-5', 'projects', 'Explorer', 'Work in 5 different projects', 5, 800, (m) => m.projects),
  B('m-levels-3', 'level', 'Ascension', 'Gain 3 levels', 3, 1000, levels, 'midastonic'),
  B('m-chests-60', 'chests', 'Dragon\'s Hoard', 'Open 60 chests', 60, 900, chests),
  B('m-chest-legendary', 'chests', 'Legend Found', 'Open a Legendary chest', 1, 1200, tierUp(4), 'midastonic'),
  B('m-tokens-1m', 'tokens', 'Million Words', 'Claude writes 1,000,000 output tokens', 1e6, 1000, (m) => m.dv('out')),
  B('m-recruits-3', 'guild', 'Guild Founder', 'Welcome 3 new recruits into your guild', 3, 900, (m) => m.dv('guild')),
  B('m-items-5', 'items', 'Collector', 'Add 5 new items to your collection', 5, 1000, (m) => m.dv('items')),
  B('m-skills-6', 'skills', 'Scholar', 'Learn 6 skill ranks', 6, 900, (m) => m.dv('ranks') + m.dv('paragon')),
  B('m-kills-1000', 'battle', 'Culling Season', 'Slay 1,000 monsters', 1000, 900, (m) => m.dv('kills')),
];

const TIERS = [
  { id: 'daily', title: 'DAILY BOUNTIES', icon: '◆', pool: DAILY, n: 3 },
  { id: 'weekly', title: 'WEEKLY BOUNTIES', icon: '◈', pool: WEEKLY, n: 2 },
  { id: 'monthly', title: 'MONTHLY BOUNTIES', icon: '◇', pool: MONTHLY, n: 2 },
];

// ---------- dates and the seeded pick ----------

const dayStart = (t) => { const d = new Date(t); return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()); };
const weekStart = (t) => { const s = dayStart(t); return s - ((new Date(s).getUTCDay() + 6) % 7) * DAY; }; // Monday, UTC
const monthStart = (t) => { const d = new Date(t); return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1); };
const monthEnd = (t) => { const d = new Date(t); return Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 1); };
const dayKey = (t) => new Date(dayStart(t)).toISOString().slice(0, 10);
const weekKey = (t) => `wk-${new Date(weekStart(t)).toISOString().slice(0, 10)}`;
const monthKey = (t) => `mo-${new Date(monthStart(t)).toISOString().slice(0, 7)}`;

// Where each tier's period starts and ends, and its key.
const PERIOD = {
  daily: (t) => ({ key: dayKey(t), start: dayStart(t), end: dayStart(t) + DAY }),
  weekly: (t) => ({ key: weekKey(t), start: weekStart(t), end: weekStart(t) + 7 * DAY }),
  monthly: (t) => ({ key: monthKey(t), start: monthStart(t), end: monthEnd(t) }),
};
const BASE_OF = { daily: 'day', weekly: 'week', monthly: 'month' };

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

// The bounties posted for the day, week and month containing `now`.
function pickBounties(now = Date.now()) {
  const out = { day: dayKey(now), week: weekKey(now), month: monthKey(now) };
  for (const T of TIERS) out[T.id] = pickN(T.pool, T.n, `${T.id}:${PERIOD[T.id](now).key}`);
  return out;
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
// went wrong (a hurt event) in its session since the previous prompt. Chest
// openings are logged as quest events starting with 🎁; practice-wave chests
// don't count.
function aggregate(events, start) {
  const a = {
    running: 0, editing: 0, reading: 0, searching: 0, web: 0, planning: 0, thinking: 0,
    summon: 0, offers: 0, recruitUps: 0, returns: 0, quests: 0, flawless: 0, nightQuests: 0,
    bosses: 0, waves: 0, levels: 0, achievements: 0, bestCombo: 0, combos: 0, approvals: 0, sessions: 0,
    chests: 0, questChests: 0, mats: 0, loot: 0, tiers: Object.fromEntries(TIER_IDS.map((t) => [t, 0])),
  };
  const hurt = {}, sids = new Set();
  for (const e of events) {
    if (!e) continue;
    const sid = e.sid || '-', live = (e.t || 0) >= start, text = String(e.text || '');
    const chest = e.kind === 'quest' && text.startsWith('🎁');
    if (e.kind === 'prompt') { hurt[sid] = false; if (live) sids.add(sid); }
    else if (e.kind === 'hurt') hurt[sid] = true;
    else if (e.kind === 'quest' && !chest) {
      if (live) {
        a.quests++;
        if (!hurt[sid]) a.flawless++;
        const hr = new Date(e.t).getHours();
        if (hr >= 22 || hr < 5) a.nightQuests++;
      }
      hurt[sid] = false;
    }
    if (!live) continue;
    if (e.kind === 'action' && e.mode in a) a[e.mode]++;
    else if (e.kind === 'summon') {
      if (text.startsWith('⭐')) a.recruitUps++;
      else if (text.startsWith('🤝')) a.offers++;
      else a.summon++;
    } else if (e.kind === 'return') a.returns++;
    else if (e.kind === 'level' && !/New spell/i.test(text)) a.levels++;
    else if (e.kind === 'achievement') a.achievements++;
    else if (e.kind === 'combo') {
      if (/^Boss defeated/i.test(text)) a.bosses++;
      else if (/^Wave \d+ cleared/i.test(text)) a.waves++;
      else if (/Allowed in game/.test(text)) a.approvals++;
      const c = /(\d+)-hit combo/.exec(text);
      if (c) { a.bestCombo = Math.max(a.bestCombo, Number(c[1])); a.combos++; }
    } else if (chest && !/\(practice wave/.test(text)) {
      const tm = /^🎁\s*(\w+) Chest/.exec(text), tier = tm && tm[1].toLowerCase();
      a.chests++;
      if (tier in a.tiers) a.tiers[tier]++;
      if (!/\(wave \d+\)/.test(text)) a.questChests++;
      for (const mm of text.matchAll(/×(\d+)/g)) a.mats += Number(mm[1]);
      a.loot += (text.match(/\((?:common|rare|epic|legendary)\)/g) || []).length;
    }
  }
  a.sessions = sids.size;
  return a;
}

const killsNow = (state) => Math.max(((state && state.game) || {}).kills || 0, ui.battle.kills || 0);
const bossesNow = (state) => Math.max(((state && state.game) || {}).bosses || 0, ui.battle.bosses || 0);
const sumVals = (o) => Object.values(o || {}).reduce((n, v) => n + (Number(v) || 0), 0);

// Counter snapshot stored as a period baseline.
function snapshot(state) {
  const g = (state && state.game) || {}, sk = g.skills || {};
  return {
    t: Date.now(), quests: state.quests || 0, tools: { ...(state.tools || {}) },
    out: ((state.tokens || {}).output) || 0, inp: ((state.tokens || {}).input) || 0,
    kills: killsNow(state), bosses: bossesNow(state), lvl: L.levelFor(state.xp || 0),
    items: (g.inventory || []).length, guild: Array.isArray(g.guild) ? g.guild.length : 0,
    ranks: sumVals(sk.nodes), paragon: sumVals(sk.paragon), chests: sumVals(g.chests), crafted: g.crafted || 0,
  };
}

function measure(state, start, base, now = Date.now()) {
  const c = logEvents();
  const ev = (c.agg[start] ||= aggregate(c.events, start));
  const cur = snapshot(state);
  const dv = (k) => {
    if (!base) return 0;
    const at = k in cur ? cur[k] : cur.tools[k] || 0;
    const was = k in base ? base[k] : (base.tools || {})[k] || 0;
    return Math.max(0, (Number(at) || 0) - (Number(was) || 0));
  };
  const projects = Object.values(state.projects || {}).filter((p) => (p.lastSeen || 0) >= start).length;
  const sk = state.streak || {};
  const streak = [dayKey(now), dayKey(now - DAY)].includes(sk.day) ? sk.count || 0 : 0;
  return { ev, dv, state, start, projects, streak };
}

// Make sure this hero has baselines for the current day, week and month.
// Writes state.json at most once per period change (and once per hero).
function ensure(d, now = Date.now()) {
  const keys = { day: dayKey(now), week: weekKey(now), month: monthKey(now) };
  const cur = (d.state.game || {}).bounties;
  if (cur && cur.day === keys.day && cur.week === keys.week && cur.month === keys.month && cur.baseline) return cur;
  const make = (st) => {
    const b = (st.game || {}).bounties || {}, snap = snapshot(st), base = b.baseline || {};
    const live = (k) => k.startsWith(`${keys.day}/`) || k.startsWith(`${keys.week}/`) || k.startsWith(`${keys.month}/`);
    const baseline = {};
    for (const p of ['day', 'week', 'month']) baseline[p] = b[p] === keys[p] && base[p] ? base[p] : snap;
    return {
      ...keys, baseline,
      progress: Object.fromEntries(Object.entries(b.progress || {}).filter(([k]) => live(k))),
      claimed: (b.claimed || []).filter(live),
      stats: { daily: 0, weekly: 0, monthly: 0, ...(b.stats || {}) },
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

// Remember the best progress seen so a bounty stays done even after the
// quest log is trimmed. Writes only when something went up (throttled).
let lastMemo = 0;
function remember(d, items, force) {
  const now = Date.now();
  if (!force && now - lastMemo < 3000) return;
  lastMemo = now;
  try {
    L.withLock(() => {
      const st = L.loadState();
      const game = { ...(st.game || {}) };
      const b = { ...(game.bounties || {}) };
      const prog = { ...(b.progress || {}) };
      for (const it of items) prog[it.key] = Math.max(prog[it.key] || 0, it.value);
      b.progress = prog;
      game.bounties = b;
      st.game = game;
      L.saveState(st);
      d.state = st;
    });
  } catch {}
}

// Everything the board shows: each posted bounty with its progress.
function board(d, now = Date.now()) {
  const b = ensure(d, now);
  const posted = pickBounties(now);
  const claimed = new Set(b.claimed || []);
  const memo = b.progress || {};
  const out = { day: posted.day, week: posted.week, month: posted.month, all: [] };
  const raised = [];
  let newlyDone = false;
  for (const T of TIERS) {
    const P = PERIOD[T.id](now), base = (b.baseline || {})[BASE_OF[T.id]];
    out[T.id] = posted[T.id].map((def) => {
      const id = `${P.key}/${def.id}`;
      let raw = 0;
      try { raw = Math.max(0, Math.floor(Number(def.value(measure(d.state, P.start, base, now))) || 0)); } catch {}
      const value = Math.min(def.goal, Math.max(raw, memo[id] || 0));
      const it = { def, period: T.id, key: id, value, goal: def.goal, done: value >= def.goal, claimed: claimed.has(id), endsAt: P.end };
      if (value > (memo[id] || 0)) { raised.push(it); if (it.done) newlyDone = true; }
      return it;
    });
    out.all.push(...out[T.id]);
  }
  if (raised.length) remember(d, raised, newlyDone);
  return out;
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
    const stats = { daily: 0, weekly: 0, monthly: 0, ...(b.stats || {}) };
    stats[it.period] = (stats[it.period] || 0) + 1;
    b.stats = stats;
    b.progress = { ...(b.progress || {}), [it.key]: Math.max((b.progress || {})[it.key] || 0, it.value) };
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

// "2/7 bounties ready" for the header.
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
const fmtN = (n) => (n >= 1e6 ? `${Math.round(n / 1e5) / 10}M` : n >= 1e4 ? `${Math.round(n / 1e3)}k` : String(n));
const periodColor = (p, pal) => (p === 'weekly' ? pal.magic : p === 'monthly' ? pal.gold : pal.accent);

function card(it, pal, w, selected) {
  const ready = it.done && !it.claimed;
  const pulse = ready && ((ui.tick || 0) >> 3) % 2 === 0;
  const color = selected ? pal.accent : ready ? X.mix(pal.gold, pal.panel, pulse ? 0.1 : 0.35) : it.claimed ? X.mix(pal.good, pal.panel, 0.55) : X.mix(pal.panel, pal.text, 0.22);
  const inner = selected ? X.mix(pal.panel, pal.accent, 0.1) : ready ? X.mix(pal.panel, pal.gold, 0.07) : pal.panel;
  const T = TIERS.find((x) => x.id === it.period) || TIERS[0];
  const icon = it.claimed ? '✓' : ready ? '★' : T.icon;
  const pc = periodColor(it.period, pal);
  const iconC = it.claimed ? pal.good : ready ? pal.gold : pc;
  const o = { color, inner };
  const buff = it.def.buff ? (() => { try { return (require('./items').getItem(it.def.buff) || {}).name; } catch { return null; } })() : null;
  const barW = Math.max(6, w - 4);
  const label = `${fmtN(it.value)}/${fmtN(it.goal)}`;
  const c2 = it.claimed ? pal.good : ready ? pal.gold : pc;
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
    row.forEach((_, j) => { spans[i + j] = [lines.length, lines.length + 3]; });
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
  let head = W < 72 ? `${bg(pal.panel2)}${fg(pal.gold)}${BOLD} ✦ BOUNTIES ${NOBOLD}${fg(pal.dim)}${claimedN}/${bd.all.length}` : `${bg(pal.panel2)}${fg(pal.gold)}${BOLD} ✦ BOUNTY BOARD ${NOBOLD} ${labelBar(claimedN / Math.max(1, bd.all.length), barW, X.shade(pal.gold, 0.7), pal.gold, X.mix(pal.panel2, pal.text, 0.1), `${claimedN}/${bd.all.length} claimed`, { ink: pal.ink, text: pal.text })}${bg(pal.panel2)}`;
  if (ready) head += `${fg(pal.gold)}${BOLD}  ★ ${ready} ready${NOBOLD}`;
  const goldTxt = ` ◉ ${gold} gold `;
  out.push(fit(`${head}${' '.repeat(Math.max(1, W - L.visWidth(head) - L.visWidth(goldTxt)))}${BOLD}${fg(pal.gold)}${goldTxt}${NOBOLD}${RESET}`, W, pal, pal.panel2));

  const body = [], spans = [];
  let offset = 0;
  for (const T of TIERS) {
    const items = bd[T.id], color = periodColor(T.id, pal);
    const left = items.length ? items[0].endsAt - now : 0;
    body.push(panelLine(W, pal.panel, [[` ${T.icon} `, color, true], [T.title, color, true], [W >= 64 ? `  ${items.length} posted` : '', pal.dim]], [[`${W >= 64 ? 'resets in ' : ''}${fmtLeft(left)} `, pal.dim]]));
    const base = body.length;
    const g = grid(items, pal, W, s.sel, offset);
    spans.push(...g.spans.map(([a, b]) => [a + base, b + base]));
    body.push(...g.lines);
    offset += items.length;
  }

  // Scroll so the selected card (and its section title) stays in view.
  const room = Math.max(1, h - 2);
  const [sa, sb] = spans[s.sel] || [0, 0];
  if (sa - 1 < s.top) s.top = Math.max(0, sa - 1);
  if (sb >= s.top + room) s.top = sb - room + 1;
  s.top = Math.max(0, Math.min(s.top, Math.max(0, body.length - room)));
  const view = body.slice(s.top, s.top + room);
  const more = body.length > s.top + room;
  const tip = ' Bounties pay gold, never XP. Progress comes from your real Claude work.';
  while (view.length < room) view.push(panelLine(W, pal.panel, view.length === room - 1 && body.length <= room ? [[tip, pal.dim]] : []));
  out.push(...view);

  const m = s.msg && s.msg.until > (ui.tick || 0) ? s.msg : null;
  out.push(panelLine(W, pal.panel2, m ? [[` ${m.text}`, m.good ? pal.good : pal.bad, true]] : [[` ←↑↓→ select · Enter claim${more ? ' · ▾ more below' : ''}`, pal.dim]], [[`${bd.day} UTC `, pal.dim]]));
  return out.slice(0, Math.max(1, h)).map((l) => fit(l, W, pal));
}

// Safety net: pad or cut a line to exactly W columns.
function fit(line, W, pal, panel = pal.panel) {
  const w = L.visWidth(line);
  if (w === W) return line;
  if (w < W) return line.replace(/\x1b\[0m$/, '') + `${bg(panel)}${' '.repeat(W - w)}${RESET}`;
  return panelLine(W, panel, [[truncVis(line.replace(/\x1b\[[0-9;]*m/g, ''), W), pal.text]]);
}

module.exports = {
  DAILY, WEEKLY, MONTHLY, TIERS, pickBounties, board, claim, ensure, aggregate,
  bountiesTab, bountiesKey, bountySummary, dayKey, weekKey, monthKey,
};
