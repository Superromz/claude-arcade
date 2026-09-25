// Shared state, XP math, themes and ANSI helpers for Claude Arcade.
// Everything lives in ~/.claude/arcade so hooks (plugin root) and the
// status line (user settings) read the same files across plugin updates.
'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');

const HOME = path.join(os.homedir(), '.claude', 'arcade');
const STATE_FILE = path.join(HOME, 'state.json');
const CONFIG_FILE = path.join(HOME, 'config.json');

// ---------- io ----------

function readJSON(file, fallback) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return fallback; }
}

function writeJSON(file, data) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2));
  fs.renameSync(tmp, file);
}

function readStdin() {
  try { return JSON.parse(fs.readFileSync(0, 'utf8').replace(/^﻿/, '') || '{}'); } catch { return {}; }
}

// Hooks run in the background and can overlap, so read-modify-write of
// state.json happens under a mkdir lock (atomic on every OS).
const LOCK_DIR = path.join(HOME, 'state.lock');
const sleep = (ms) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);

function withLock(fn) {
  fs.mkdirSync(HOME, { recursive: true });
  const deadline = Date.now() + 1500;
  for (;;) {
    try { fs.mkdirSync(LOCK_DIR); break; } catch {
      try { if (Date.now() - fs.statSync(LOCK_DIR).mtimeMs > 3000) fs.rmdirSync(LOCK_DIR); } catch {}
      if (Date.now() > deadline) break; // give up waiting rather than stall Claude
      sleep(15);
    }
  }
  try { return fn(); } finally { try { fs.rmdirSync(LOCK_DIR); } catch {} }
}

// Append-only quest log the game pane tails. Trimmed when it grows.
const EVENTS_FILE = path.join(HOME, 'events.jsonl');

function logEvent(ev) {
  try {
    fs.mkdirSync(HOME, { recursive: true });
    fs.appendFileSync(EVENTS_FILE, JSON.stringify({ t: Date.now(), ...ev }) + '\n');
    if (fs.statSync(EVENTS_FILE).size > 256 * 1024) {
      const lines = fs.readFileSync(EVENTS_FILE, 'utf8').trim().split('\n').slice(-400);
      fs.writeFileSync(EVENTS_FILE, lines.join('\n') + '\n');
    }
  } catch {}
}

function readEvents(n = 50) {
  try {
    return fs.readFileSync(EVENTS_FILE, 'utf8').trim().split('\n').slice(-n)
      .map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);
  } catch { return []; }
}

// In-game approvals. The PermissionRequest hook drops a request file here and
// waits for the game pane to write <id>.answer.json. The game writes a
// heartbeat so the hook only waits when someone can actually answer.
const APPROVALS_DIR = path.join(HOME, 'approvals');
const HEARTBEAT = path.join(HOME, 'game.alive');
function gameAlive() {
  try { return Date.now() - fs.statSync(HEARTBEAT).mtimeMs < 3000; } catch { return false; }
}
function pendingApprovals() {
  try {
    return fs.readdirSync(APPROVALS_DIR).filter((f) => f.endsWith('.req.json'))
      .map((f) => readJSON(path.join(APPROVALS_DIR, f), null)).filter(Boolean).sort((a, b) => a.t - b.t);
  } catch { return []; }
}
function answerApproval(id, behavior) {
  writeJSON(path.join(APPROVALS_DIR, `${id}.answer.json`), { behavior, t: Date.now() });
}

function defaultState() {
  return { xp: 0, quests: 0, tools: {}, achievements: [], sessions: {}, streak: { day: null, count: 0 } };
}

function loadState() { return { ...defaultState(), ...readJSON(STATE_FILE, {}) }; }
function saveState(s) { writeJSON(STATE_FILE, s); }

// config.character is the active hero's look; config.heroes is the roster
// (looks only). Progress lives in state: the active hero's numbers at the top
// level (so every other module just reads state.xp etc.), the others parked
// in state.heroes[id] until switched to.
function loadConfig() {
  const cfg = { theme: 'rpg', ascii: false, toasts: true, ...readJSON(CONFIG_FILE, {}) };
  if (cfg.character && !cfg.heroes) {
    // One-time migration of a pre-roster hero.
    const id = newHeroId();
    cfg.character = { ...cfg.character, id, createdAt: Date.now() };
    cfg.heroes = [cfg.character];
    cfg.activeHero = id;
    try { writeJSON(CONFIG_FILE, cfg); } catch {}
  }
  return cfg;
}
function saveConfig(c) {
  if (c.heroes && c.activeHero && c.character) {
    c.character.id = c.activeHero;
    const i = c.heroes.findIndex((h) => h.id === c.activeHero);
    if (i >= 0) c.heroes[i] = c.character; else c.heroes.push(c.character);
  }
  writeJSON(CONFIG_FILE, c);
}

// ---------- hero roster ----------

const HERO_FIELDS = ['xp', 'quests', 'tools', 'achievements', 'tokens', 'tokenXp', 'battleXp', 'game'];
const newHeroId = () => `hero-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
const freshProgress = () => ({ xp: 0, quests: 0, tools: {}, achievements: [], tokens: { input: 0, output: 0 }, tokenXp: 0, battleXp: 0, game: { gold: 0, kills: 0, inventory: [] } });

function parkActive(state, cfg) {
  if (!cfg.activeHero) return;
  state.heroes ||= {};
  state.heroes[cfg.activeHero] = { ...Object.fromEntries(HERO_FIELDS.map((k) => [k, state[k]])), lastPlayed: Date.now() };
}
function loadHero(state, id) {
  const saved = (state.heroes && state.heroes[id]) || freshProgress();
  for (const k of HERO_FIELDS) state[k] = saved[k] !== undefined ? saved[k] : freshProgress()[k];
  if (state.heroes) delete state.heroes[id];
}

function switchHero(id) {
  return withLock(() => {
    const cfg = loadConfig(), state = loadState();
    const hero = (cfg.heroes || []).find((h) => h.id === id);
    if (!hero || cfg.activeHero === id) return { cfg, state };
    parkActive(state, cfg);
    loadHero(state, id);
    cfg.activeHero = id; cfg.character = hero;
    saveState(state); saveConfig(cfg);
    return { cfg, state };
  });
}

// Adds a hero with fresh progress and makes it active.
function createHero(look) {
  return withLock(() => {
    const cfg = loadConfig(), state = loadState();
    const hero = { ...look, id: newHeroId(), createdAt: Date.now() };
    // The very first hero keeps any progress earned before heroes existed.
    if (cfg.activeHero) { parkActive(state, cfg); loadHero(state, hero.id); }
    cfg.heroes = [...(cfg.heroes || []), hero];
    cfg.activeHero = hero.id; cfg.character = hero;
    saveState(state); saveConfig(cfg);
    return { cfg, state };
  });
}

function deleteHero(id) {
  return withLock(() => {
    const cfg = loadConfig(), state = loadState();
    if (!cfg.heroes || cfg.heroes.length <= 1) return { cfg, state };
    if (cfg.activeHero === id) {
      const next = cfg.heroes.find((h) => h.id !== id);
      loadHero(state, next.id);
      cfg.activeHero = next.id; cfg.character = next;
    }
    cfg.heroes = cfg.heroes.filter((h) => h.id !== id);
    if (state.heroes) delete state.heroes[id];
    saveState(state); saveConfig(cfg);
    return { cfg, state };
  });
}

// Every hero with its progress, for the roster screen and /stats.
function heroList(cfg, state) {
  return (cfg.heroes || []).map((h) => {
    const active = h.id === cfg.activeHero;
    const p = active ? state : (state.heroes && state.heroes[h.id]) || freshProgress();
    const game = p.game || {};
    return { ...h, active, xp: p.xp || 0, level: levelFor(p.xp || 0), quests: p.quests || 0, gold: game.gold || 0, kills: game.kills || 0, tools: p.tools || {}, achievements: (p.achievements || []).length, lastPlayed: active ? Date.now() : p.lastPlayed || h.createdAt };
  });
}

function session(state, id) {
  const key = id || 'default';
  state.sessions[key] ||= { mode: 'idle', detail: '', since: Date.now(), hp: 100, combo: 0, party: {}, xp: 0 };
  return state.sessions[key];
}

// Drop sessions nobody has touched for a day so state.json stays small.
// Per-project stats, keyed by the git root of the session's cwd (or the cwd
// itself outside a repo). Global totals stay at the top level of state.
function projectRoot(cwd) {
  if (!cwd) return null;
  let d = path.resolve(cwd);
  for (;;) {
    if (fs.existsSync(path.join(d, '.git'))) return d;
    const up = path.dirname(d);
    if (up === d) return path.resolve(cwd);
    d = up;
  }
}

function project(state, cwd) {
  const root = projectRoot(cwd);
  if (!root) return null;
  const key = process.platform === 'win32' ? root.toLowerCase() : root;
  state.projects ||= {};
  state.projects[key] ||= { name: path.basename(root) || root, path: root, xp: 0, quests: 0, sessions: 0, tools: {}, tokens: { input: 0, output: 0 }, firstSeen: Date.now(), lastSeen: Date.now() };
  const p = state.projects[key];
  p.lastSeen = Date.now();
  return p;
}

function pruneSessions(state) {
  const cutoff = Date.now() - 24 * 3600 * 1000;
  for (const [k, s] of Object.entries(state.sessions)) if ((s.since || 0) < cutoff) delete state.sessions[k];
}

// ---------- xp ----------

// Level n needs 100 * n * (n - 1) / 2 total XP: 0, 100, 300, 600, 1000, ...
function levelFor(xp) { return Math.floor((1 + Math.sqrt(1 + (8 * xp) / 100)) / 2); }
function xpForLevel(n) { return (100 * n * (n - 1)) / 2; }

// ---------- ansi ----------

const ESC = '\x1b[';
const c = {
  reset: `${ESC}0m`, bold: `${ESC}1m`, dim: `${ESC}2m`,
  red: `${ESC}91m`, green: `${ESC}92m`, yellow: `${ESC}93m`, blue: `${ESC}94m`,
  magenta: `${ESC}95m`, cyan: `${ESC}96m`, white: `${ESC}97m`, gray: `${ESC}90m`,
};
const paint = (color, s) => `${c[color] || ''}${s}${c.reset}`;

// Approximate terminal cell width: wide emoji count 2, joiners/selectors 0.
function visWidth(s) {
  let w = 0;
  for (const ch of String(s).replace(/\x1b\[[0-9;]*m/g, '')) {
    const cp = ch.codePointAt(0);
    if (cp === 0xfe0f || cp === 0x200d || (cp >= 0x300 && cp < 0x370)) continue;
    w += cp >= 0x1f000 || (cp >= 0x2600 && cp < 0x27c0 && /\p{Extended_Pictographic}/u.test(ch)) || (cp >= 0x1100 && cp <= 0x115f) || (cp >= 0x2e80 && cp <= 0xa4cf) ? 2 : 1;
  }
  return w;
}
const padVis = (s, w) => s + ' '.repeat(Math.max(0, w - visWidth(s)));

function bar(ratio, width, full = '█', empty = '░') {
  const n = Math.max(0, Math.min(width, Math.round(ratio * width)));
  return full.repeat(n) + empty.repeat(width - n);
}

// ---------- themes ----------
// Each mode has animation frames (one per second with refreshInterval: 1)
// and a verb. Tools map to modes in modeForTool().

const THEMES = {
  rpg: {
    name: 'Dungeon Crawl',
    titles: [
      'Peasant', 'Squire', 'Apprentice Coder', 'Code Knight', 'Bug Slayer', 'Refactor Paladin',
      'Merge Sorcerer', 'Archmage of Types', 'Lint Warden', 'Stack Ranger', 'Regex Druid', 'Test Templar',
      'Async Assassin', 'Null Exorcist', 'Cache Alchemist', 'Pipeline Warlord', 'Heap Necromancer', 'Kernel Crusader',
      'Commit Champion', 'Dragon of Diffs', 'Lord of Lambdas', 'Grand Debugger', 'Rebase Runesmith', 'High Priest of CI',
      'Monad Monk', 'Keeper of the Monorepo', 'Warden of Prod', 'Archon of APIs', 'Legendary Hacker', 'Mythic Architect',
      'Code Demigod', 'Elder Code God',
    ],
    xpLabel: 'XP', hpLabel: '❤',
    party: '⚔ party',
    modes: {
      idle: { frames: ['🧙 💤', '🧙 💤 ', '🧙  💤'], verb: 'Resting at the tavern' },
      thinking: { frames: ['🔮 ✦ ', '🔮 ✧✦', '🔮 ✦✧✦', '🔮 ✧✦✧'], verb: 'Consulting the oracle' },
      planning: { frames: ['📜 ✎', '📜 ✎.', '📜 ✎..', '📜 ✎...'], verb: 'Drawing the battle map' },
      reading: { frames: ['🧭 🔍 ', '🧭  🔍', '🧭 🔍 '], verb: 'Scouting' },
      searching: { frames: ['🗺  ◜', '🗺  ◝', '🗺  ◞', '🗺  ◟'], verb: 'Searching the dungeon' },
      editing: { frames: ['⚒ 🔥', '⚒ ✨', '⚒ 💥', '⚒ ✨'], verb: 'Forging' },
      running: { frames: ['⚡ ᗧ···', '⚡  ᗧ··', '⚡   ᗧ·', '⚡    ᗧ'], verb: 'Casting' },
      web: { frames: ['🦅 ~ ', '🦅  ~', '🦅 ~~'], verb: 'Sending the scout eagle' },
      summoning: { frames: ['🌀 ✦', '🌀 🧝', '🌀 🧝🧙', '🌀 🧝🧙🛡'], verb: 'Summoning the party' },
      victory: { frames: ['🏆 ✨', '🏆 🎉', '🏆 ✨'], verb: 'Quest complete!' },
      hurt: { frames: ['💥 😵', '💢 😵'], verb: 'Took a hit' },
      waiting: { frames: ['🛡 ❔', '🛡 ❕'], verb: 'Awaiting your command' },
    },
    spinnerVerbs: [
      'Rolling for initiative', 'Consulting the oracle', 'Grinding XP', 'Brewing potions',
      'Sharpening swords', 'Looting the codebase', 'Casting fireball', 'Slaying bugs',
      'Reading ancient scrolls', 'Deciphering runes', 'Crafting artifacts', 'Questing',
      'Leveling up', 'Summoning familiars', 'Taming the regex beast', 'Polishing the armor',
      'Bargaining with goblins', 'Lifting the merge curse', 'Mapping the dungeon', 'Enchanting the tests',
      'Feeding the dragon', 'Haggling with the blacksmith', 'Warding off null pointers', 'Tracking footprints in the logs',
      'Lighting the torches', 'Chanting the build rite', 'Counting the loot', 'Waking the ancient compiler',
      'Banishing flaky tests', 'Scrying the stack trace',
    ],
    tips: [
      'Every edit forged earns XP ⚒', 'Failed commands cost HP — heal by finishing quests 🏆',
      'Summon subagents to build your party 🧝', 'Run /claude-arcade:stats to see your hero sheet',
      'Daily bounties pay gold, never XP 📜', 'Weekly bounties reset every Monday (UTC) 📜',
      'Chain tool calls without a failure to build a combo 🔥', 'Your class gets +50% XP on its specialty ⚔',
      'Gold buys hats, pets and buffs in the shop 🛒', 'Keep your daily streak alive for trophies 🏅',
      'Bosses show up during long quests ☠', 'Some trophies are secret. Try questing after midnight 🌙',
    ],
  },
  space: {
    name: 'Star Command',
    titles: [
      'Cadet', 'Ensign', 'Lieutenant', 'Asteroid Ace', 'Commander', 'Comet Chaser',
      'Captain', 'Warp Engineer', 'Nebula Navigator', 'Commodore', 'Orbit Architect', 'Pulsar Pilot',
      'Rear Admiral', 'Quasar Captain', 'Void Voyager', 'Vice Admiral', 'Starship Strategist', 'Nova Knight',
      'Admiral', 'Sector Marshal', 'Galaxy Warden', 'Fleet Admiral', 'Wormhole Wizard', 'Dark Matter Adept',
      'Supernova Sovereign', 'Star Forger', 'Constellation Lord', 'Cosmic Architect', 'Galactic Legend', 'Universal Overmind',
      'Big Bang Theorist', 'Singularity',
    ],
    xpLabel: 'XP', hpLabel: '🛡',
    party: '🚀 fleet',
    modes: {
      idle: { frames: ['🛰  ·', '🛰 · ', '🛰·  '], verb: 'Orbiting' },
      thinking: { frames: ['🧠 ◐', '🧠 ◓', '🧠 ◑', '🧠 ◒'], verb: 'Computing trajectory' },
      planning: { frames: ['🗺 ✦', '🗺 ✦✧', '🗺 ✦✧✦'], verb: 'Plotting a course' },
      reading: { frames: ['📡 )', '📡 ))', '📡 )))'], verb: 'Scanning' },
      searching: { frames: ['🔭 ·  ', '🔭  · ', '🔭   ·'], verb: 'Sweeping the sector' },
      editing: { frames: ['🔧 ⚙', '🔧 ⚙⚙', '🔧 ⚙⚙⚙'], verb: 'Repairing hull' },
      running: { frames: ['🚀 =  ', '🚀 == ', '🚀 ==='], verb: 'Firing thrusters' },
      web: { frames: ['📶 ⋅', '📶 ⋅⋅', '📶 ⋅⋅⋅'], verb: 'Hailing frequencies' },
      summoning: { frames: ['🛸', '🛸🛸', '🛸🛸🛸'], verb: 'Launching drones' },
      victory: { frames: ['🌟 ✨', '🌟 🎆', '🌟 ✨'], verb: 'Mission accomplished!' },
      hurt: { frames: ['☄ 💥', '☄ 🔥'], verb: 'Hull breach' },
      waiting: { frames: ['📟 ?', '📟 !'], verb: 'Awaiting orders' },
    },
    spinnerVerbs: [
      'Warping', 'Calibrating sensors', 'Charging hyperdrive', 'Reticulating nebulae',
      'Scanning the void', 'Docking', 'Terraforming', 'Plotting a course',
      'Engaging tractor beam', 'Rerouting power', 'Venting plasma', 'Aligning the dish',
      'Decoding transmissions', 'Refueling at the station', 'Dodging asteroids', 'Slingshotting around a moon',
      'Recalibrating the deflector', 'Polishing the viewport', 'Mining the asteroid belt', 'Compiling star charts',
      'Pinging the relay', 'Cooling the reactor', 'Consulting the ship AI', 'Boosting shields',
    ],
    tips: [
      'Every mission completed earns XP 🌟', 'Launch subagents to grow your fleet 🛸',
      'Run /claude-arcade:stats for your service record', 'Daily contracts pay gold, never XP 📡',
      'Weekly contracts reset every Monday (UTC) 📡', 'Clean runs build a combo for bonus XP 🔥',
      'Gold buys gear and boosts in the shop 🛒', 'Keep your daily streak for commendations 🎖',
      'Big threats appear during long missions ☄',
    ],
  },
  retro: {
    // Plain ASCII: safe for any font / terminal.
    name: '8-Bit Arcade',
    titles: [
      'NOOB', 'PLAYER 1', 'CHALLENGER', 'HI-SCORER', 'COMBO KING', 'BOSS SLAYER',
      'SPEEDRUNNER', 'PIXEL PUSHER', 'COIN MUNCHER', 'GLITCH HUNTER', 'WALL JUMPER', 'WARP ZONER',
      'PERFECT RUNNER', 'TAS BOT', 'FRAME PERFECT', 'SEQUENCE BREAKER', 'PALETTE SWAPPER', 'CHEAT CODER',
      '1CC HERO', 'ARCADE CHAMP', 'BOSS RUSHER', 'NEW GAME PLUS', 'HARD MODE', 'GRANDMASTER',
      'PIXEL PERFECT', 'WORLD RECORD', 'LEGEND', 'HALL OF FAMER', 'FINAL BOSS', 'MAX LEVEL',
      '256 OVERFLOW', 'KILL SCREEN',
    ],
    xpLabel: 'PTS', hpLabel: 'HP',
    party: 'P2+',
    modes: {
      idle: { frames: ['(-_-) zz', '(-_-) zZ', '(-_-) Zz'], verb: 'INSERT COIN' },
      thinking: { frames: ['(o_o) .', '(o_o) ..', '(o_o) ...', '(O_O) ?'], verb: 'THINKING' },
      planning: { frames: ['[#   ]', '[##  ]', '[### ]', '[####]'], verb: 'LOADING LEVEL' },
      reading: { frames: ['(o_o)>  ', '(o_o) > ', '(o_o)  >'], verb: 'READING' },
      searching: { frames: ['|', '/', '-', '\\'], verb: 'SEARCHING' },
      editing: { frames: ['[=  ]', '[== ]', '[===]', '[ ==]'], verb: 'BUILDING' },
      running: { frames: ['C · · ·', ' C · ·', '  C ·', '   C'], verb: 'RUNNING' },
      web: { frames: ['<~  >', '< ~ >', '<  ~>'], verb: 'DOWNLOADING' },
      summoning: { frames: ['[P2]', '[P2][P3]', '[P2][P3][P4]'], verb: 'PLAYERS JOINING' },
      victory: { frames: ['\\(^o^)/', ' (^o^) ', '\\(^o^)/'], verb: 'STAGE CLEAR!' },
      hurt: { frames: ['(x_x)', '(X_X)'], verb: 'OUCH!' },
      waiting: { frames: ['(._.)?', '(._.)!'], verb: 'PRESS START' },
    },
    spinnerVerbs: [
      'LOADING', 'BUFFERING', 'BLOWING ON CARTRIDGE', 'GRINDING',
      'SPEEDRUNNING', 'SAVING GAME', 'ENTERING CHEAT CODE', 'RESPAWNING',
      'CHARGING SUPER', 'WALL JUMPING', 'COLLECTING COINS', 'FINDING WARP PIPE',
      'MASHING BUTTONS', 'CLIPPING THROUGH WALLS', 'DODGING BARRELS', 'EATING POWER PELLET',
      'RESETTING RNG', 'ADJUSTING TRACKING', 'REWINDING TAPE', 'CHECKING HIGH SCORES',
      'PAUSING', 'BEATING BOSS RUSH', 'TYPING INITIALS',
    ],
    tips: [
      'UP UP DOWN DOWN LEFT RIGHT LEFT RIGHT B A', 'Finish turns to rack up PTS',
      'Run /claude-arcade:stats for the high score table', 'BOUNTIES PAY GOLD, NOT PTS',
      'WEEKLY BOUNTIES RESET ON MONDAY (UTC)', 'NO MISS = COMBO BONUS',
      'SPEND GOLD IN THE SHOP', 'DAILY STREAKS UNLOCK TROPHIES',
      'LONG STAGES SPAWN BOSSES',
    ],
  },
};

function theme(cfg) { return THEMES[cfg.theme] || THEMES.rpg; }

// A new title every level until the list runs out.
function titleFor(t, lvl) { return t.titles[Math.min(t.titles.length - 1, lvl - 1)]; }

// ---------- tools -> modes / xp ----------

function modeForTool(name = '') {
  if (/^(Edit|Write|MultiEdit|NotebookEdit)$/.test(name)) return 'editing';
  if (/^(Bash|PowerShell)$/.test(name)) return 'running';
  if (/^(Read)$/.test(name)) return 'reading';
  if (/^(Grep|Glob|LS|ToolSearch)$/.test(name)) return 'searching';
  if (/^(WebFetch|WebSearch)$/.test(name) || name.startsWith('mcp__')) return 'web';
  if (/^(Agent|Task|Workflow|SendMessage)$/.test(name)) return 'summoning';
  if (/(Plan|Todo|Task(Create|Update))/.test(name)) return 'planning';
  return 'thinking';
}

const TOOL_XP = { editing: 5, running: 3, reading: 1, searching: 1, web: 2, summoning: 10, planning: 4, thinking: 1 };

function describeTool(name, input = {}) {
  const trim = (s, n = 38) => (s = String(s || '').replace(/\s+/g, ' ').trim()).length > n ? s.slice(0, n - 1) + '…' : s;
  const file = (p) => path.basename(String(p || ''));
  switch (name) {
    case 'Edit': case 'Write': case 'MultiEdit': case 'Read': case 'NotebookEdit':
      return file(input.file_path || input.notebook_path);
    case 'Bash': case 'PowerShell': return trim(input.description || input.command);
    case 'Grep': case 'Glob': return trim(input.pattern);
    case 'WebFetch': return trim(input.url);
    case 'WebSearch': return trim(input.query);
    case 'Agent': case 'Task': return trim(input.description || input.subagent_type);
    default: return name.startsWith('mcp__') ? name.split('__').slice(1).join(' ') : '';
  }
}

// ---------- achievements ----------

// value() is progress toward goal, so the game pane can draw progress bars.
// Every value must be cheap (the status line and hooks run often) and safe on
// a state with missing fields; a wrapper at the end turns errors into 0.
const toolsOf = (s) => (s && s.tools) || {};
const tool = (k) => (s) => toolsOf(s)[k] || 0;
const gameOf = (s) => (s && s.game) || {};
const streakOf = (s) => ((s && s.streak) || {}).count || 0;
const sumOf = (o) => Object.values(o || {}).reduce((n, v) => n + (Number(v) || 0), 0);
const toolSum = (s) => sumOf(toolsOf(s));
const TOOL_KINDS = ['editing', 'running', 'reading', 'searching', 'web', 'summoning', 'planning'];
const quests = (s) => (s && s.quests) || 0;
const lvl = (s) => levelFor((s && s.xp) || 0);
const outTokens = (s) => ((s && s.tokens) || {}).output || 0;
const projectCount = (s) => Object.keys((s && s.projects) || {}).length;
const partySize = (s, ses) => (ses ? Object.keys(ses.party || {}).length : 0);
const combo = (s, ses) => (ses ? ses.combo || 0 : 0);
// The roster and looks live in config.json; cache it briefly since the
// trophies tab evaluates every achievement each frame.
let cfgCache = { t: 0, cfg: {} };
function cfgNow() {
  if (Date.now() - cfgCache.t > 2000) {
    try { cfgCache = { t: Date.now(), cfg: loadConfig() || {} }; } catch { cfgCache = { t: Date.now(), cfg: {} }; }
  }
  return cfgCache.cfg;
}
const heroCount = () => (cfgNow().heroes || []).length;
const classesPlayed = () => new Set([...(cfgNow().heroes || []), cfgNow().character || {}].map((h) => h && h.cls).filter(Boolean));
const CLASSES = ['mage', 'ranger', 'knight', 'warlock', 'bard', 'rogue'];
// Loot and crafting (items.js). Set pieces are listed here so hooks don't
// load items.js; test/bounties.test.js checks they match items.SETS.
const SET_PIECES = {
  Slimebound: ['slimecrown', 'wslime'],
  Bonecaller: ['skullhelm', 'bonewings', 'bonepup', 'wbone'],
  Emberforged: ['flamecrown', 'phoenixwings', 'emberling', 'wember'],
  Starlight: ['starcirclet', 'staraura', 'starsprite', 'wstar'],
};
const MATERIAL_IDS = ['slime', 'bone', 'ember', 'moonsilver', 'starlight'];
const inventoryOf = (s) => (Array.isArray(gameOf(s).inventory) ? gameOf(s).inventory : []);
const setOwned = (name) => (s) => { const inv = new Set(inventoryOf(s)); return SET_PIECES[name].filter((id) => inv.has(id)).length; };
const setsDone = (s) => Object.keys(SET_PIECES).filter((n) => setOwned(n)(s) >= SET_PIECES[n].length).length;
const matsOf = (s) => gameOf(s).materials || {};
const chestsOf = (s) => gameOf(s).chests || {};
const EQUIP_SLOTS = ['hat', 'back', 'aura', 'pet', 'weapon'];
const equippedSlots = () => { const eq = (cfgNow().character || {}).equipped || {}; return EQUIP_SLOTS.filter((k) => eq[k]).length; };
// Skill tree (skills.js): nodes are 'cls.branch.node' ranks; node 4 is a capstone.
const skillsOf = (s) => gameOf(s).skills || {};
const ranksLearned = (s) => sumOf(skillsOf(s).nodes);
const capstones = (s) => Object.entries(skillsOf(s).nodes || {}).filter(([k, v]) => /\.4$/.test(k) && Number(v) > 0).length;
const paragonPts = (s) => sumOf(skillsOf(s).paragon);
const respecs = (s) => Number(skillsOf(s).respecs) || 0;
// Guild (guild.js): state.game.guild is a list of recruits.
const guildOf = (s) => (Array.isArray(gameOf(s).guild) ? gameOf(s).guild : []);
const topRecruit = (s) => guildOf(s).reduce((m, g) => Math.max(m, Number(g && g.level) || 0), 0);
// Bosses (monsters.js BOSS_POOLS); per-type kills are game.bossTypes.
const BOSS_POOLS = {
  dungeon: [['boss', 'Goblin Grief', 'the Goblin Warlord'], ['slimeking', 'Ungooed', 'King Gloop'], ['bonelord', 'Bone Dry', 'Skullmaw the Bone Tyrant']],
  forest: [['elder', 'Timber!', 'Elderbark the Ancient'], ['spiderqueen', 'Web Developer', 'Arachnessa the Brood Queen'], ['moonwolf', 'Howl No More', 'Fenrath the Moon Wolf']],
  lava: [['drake', 'Dragonslayer', 'Ignarok the Magma Drake'], ['infernal', 'Pit Stop', 'Balgoroth the Pit Fiend'], ['magmaworm', 'Worm Removal', 'Scorchmaw the Lava Wyrm']],
  castle: [['lich', 'Phylactery Found', 'the Lich King'], ['deathknight', 'Knight Shift', 'Sir Mordred the Death Knight'], ['vampire', 'Stake Holder', 'Count Vessarin']],
};
const bossTypes = (s) => gameOf(s).bossTypes || {};
const bossesIn = (biome) => (s) => BOSS_POOLS[biome].filter(([id]) => (bossTypes(s)[id] || 0) > 0).length;
const bossKinds = (s) => Object.values(BOSS_POOLS).flat().filter(([id]) => (bossTypes(s)[id] || 0) > 0).length;
const bountyStats = (s) => (gameOf(s).bounties || {}).stats || {};
// The turn that just ended (the Stop hook sets victory right before unlock).
const justWon = (ses) => !!(ses && ses.mode === 'victory' && ses.since);
const wonAt = (ses) => new Date(ses.since);
const turnOf = (ses) => (ses && ses.turn) || {};
const turnTools = (ses) => Object.keys(TOOL_XP).reduce((n, k) => n + (Number(turnOf(ses)[k]) || 0), 0);
const turnMins = (ses) => (turnOf(ses).start ? (ses.since - turnOf(ses).start) / 60000 : 0);
const won = (test) => (s, ses) => (justWon(ses) && test(s, ses) ? 1 : 0);
const A = (id, name, desc, goal, value, extra) => ({ id, name, desc, goal, value, ...(extra || {}) });
const S = { secret: true };

const ACHIEVEMENTS = [
  // quests
  A('first-quest', 'First Blood', 'Complete your first turn', 1, quests),
  A('quests-10', 'Adventurer', 'Complete 10 turns', 10, quests),
  A('quests-100', 'Centurion', 'Complete 100 turns', 100, quests),
  A('quests-500', 'Veteran', 'Complete 500 turns', 500, quests),
  A('quests-1000', 'Living Legend', 'Complete 1,000 turns', 1000, quests),
  A('quests-2500', 'Saga', 'Complete 2,500 turns', 2500, quests),
  // tools
  A('forge-1', 'Tinkerer', 'Make your first edit', 1, tool('editing')),
  A('forge-50', 'Blacksmith', 'Make 50 edits', 50, tool('editing')),
  A('forge-500', 'Master Smith', 'Make 500 edits', 500, tool('editing')),
  A('forge-2000', 'Forge Lord', 'Make 2,000 edits', 2000, tool('editing')),
  A('forge-5000', 'Anvil of the Gods', 'Make 5,000 edits', 5000, tool('editing')),
  A('cast-10', 'Apprentice Caster', 'Run 10 commands', 10, tool('running')),
  A('cast-100', 'Spellslinger', 'Run 100 commands', 100, tool('running')),
  A('cast-1000', 'Archmage', 'Run 1,000 commands', 1000, tool('running')),
  A('cast-5000', 'Thunderlord', 'Run 5,000 commands', 5000, tool('running')),
  A('scout-200', 'Pathfinder', 'Read or search 200 times', 200, (s) => (toolsOf(s).reading || 0) + (toolsOf(s).searching || 0)),
  A('scout-2000', 'Loremaster', 'Read or search 2,000 times', 2000, (s) => (toolsOf(s).reading || 0) + (toolsOf(s).searching || 0)),
  A('read-1000', 'Bookworm', 'Read 1,000 files', 1000, tool('reading')),
  A('search-500', 'Needle Finder', 'Search the code 500 times', 500, tool('searching')),
  A('web-25', 'Far Seer', 'Use the web or an MCP tool 25 times', 25, tool('web')),
  A('web-250', 'Eagle Master', 'Use the web or an MCP tool 250 times', 250, tool('web')),
  A('web-1000', 'World Wide Wizard', 'Use the web or an MCP tool 1,000 times', 1000, tool('web')),
  A('plan-10', 'Strategist', 'Plan or update todos 10 times', 10, tool('planning')),
  A('plan-100', 'Grand Tactician', 'Plan or update todos 100 times', 100, tool('planning')),
  A('plan-500', 'Master Planner', 'Plan or update todos 500 times', 500, tool('planning')),
  A('all-rounder', 'Jack of All Trades', 'Use every kind of tool at least once', TOOL_KINDS.length, (s) => TOOL_KINDS.filter((k) => toolsOf(s)[k] > 0).length),
  A('tools-10k', 'Ten Thousand Spells', 'Make 10,000 tool calls', 10000, toolSum),
  A('tools-50k', 'Fifty Thousand Spells', 'Make 50,000 tool calls', 50000, toolSum),
  // party
  A('summon-1', 'Party Up', 'Summon your first subagent', 1, tool('summoning')),
  A('summon-25', 'Guild Master', 'Summon 25 subagents', 25, tool('summoning')),
  A('summon-100', 'Legion Commander', 'Summon 100 subagents', 100, tool('summoning')),
  A('summon-500', 'Army of One', 'Summon 500 subagents', 500, tool('summoning')),
  A('full-party', 'Full Party', 'Have 3 subagents running at once', 3, partySize),
  A('party-5', 'Raid Group', 'Have 5 subagents running at once', 5, partySize),
  A('party-8', 'Legion at Your Back', 'Have 8 subagents running at once', 8, partySize),
  // combo
  A('combo-25', 'Combo x25', '25 tool calls in a row without a failure', 25, combo),
  A('combo-50', 'Unstoppable', '50 tool calls in a row without a failure', 50, combo),
  A('combo-100', 'Godlike', '100 tool calls in a row without a failure', 100, combo),
  A('combo-200', 'Transcendent', '200 tool calls in a row without a failure', 200, combo),
  // streaks
  A('streak-3', 'Dedicated', 'Play 3 days in a row', 3, streakOf),
  A('streak-7', 'Obsessed', 'Play 7 days in a row', 7, streakOf),
  A('streak-14', 'Devoted', 'Play 14 days in a row', 14, streakOf),
  A('streak-30', 'Monthly Ritual', 'Play 30 days in a row', 30, streakOf),
  A('streak-60', 'Unbreakable', 'Play 60 days in a row', 60, streakOf),
  A('streak-100', 'Centennial', 'Play 100 days in a row', 100, streakOf),
  A('streak-365', 'Year of Code', 'Play 365 days in a row', 365, streakOf),
  // levels and biomes
  A('lvl-5', 'Rising Star', 'Reach level 5', 5, lvl),
  A('lvl-10', 'Double Digits', 'Reach level 10', 10, lvl),
  A('lvl-20', 'Twenty-Sided', 'Reach level 20', 20, lvl),
  A('lvl-30', 'Ascended', 'Reach level 30', 30, lvl),
  A('lvl-40', 'Mythic', 'Reach level 40', 40, lvl),
  A('lvl-50', 'Half-Century', 'Reach level 50', 50, lvl),
  A('biome-forest', 'Into the Woods', 'Reach the forest biome (level 5)', 5, lvl),
  A('biome-lava', 'Feel the Heat', 'Reach the lava cave biome (level 10)', 10, lvl),
  A('biome-castle', 'Castle Gates', 'Reach the castle biome (level 15)', 15, lvl),
  // tokens
  A('tokens-100k', 'Wordsmith', 'Claude writes 100,000 output tokens for you', 1e5, outTokens),
  A('tokens-1m', 'Epic Poet', 'Claude writes 1,000,000 output tokens for you', 1e6, outTokens),
  A('tokens-10m', 'Library of Babel', 'Claude writes 10,000,000 output tokens for you', 1e7, outTokens),
  A('tokens-50m', 'Infinite Scroll', 'Claude writes 50,000,000 output tokens for you', 5e7, outTokens),
  A('tokens-in-10m', 'Context Glutton', 'Feed Claude 10,000,000 fresh input tokens', 1e7, (s) => ((s && s.tokens) || {}).input || 0),
  // projects
  A('projects-3', 'Wanderer', 'Adventure in 3 different projects', 3, projectCount),
  A('projects-10', 'Cartographer', 'Adventure in 10 different projects', 10, projectCount),
  A('projects-25', 'World Walker', 'Adventure in 25 different projects', 25, projectCount),
  A('projects-50', 'Multiverse', 'Adventure in 50 different projects', 50, projectCount),
  // battle
  A('kills-100', 'Monster Hunter', 'Slay 100 monsters', 100, (s) => gameOf(s).kills || 0),
  A('kills-1000', 'Exterminator', 'Slay 1,000 monsters', 1000, (s) => gameOf(s).kills || 0),
  A('kills-5000', 'Bugpocalypse', 'Slay 5,000 monsters', 5000, (s) => gameOf(s).kills || 0),
  A('kills-10000', 'Extinction Event', 'Slay 10,000 monsters', 10000, (s) => gameOf(s).kills || 0),
  A('wave-10', 'Wave Rider', 'Reach wave 10', 10, (s) => gameOf(s).bestWave || 0),
  A('wave-25', 'Tide Turner', 'Reach wave 25', 25, (s) => gameOf(s).bestWave || 0),
  A('wave-50', 'Endless Night', 'Reach wave 50', 50, (s) => gameOf(s).bestWave || 0),
  A('boss-1', 'Giant Slayer', 'Defeat a boss', 1, (s) => gameOf(s).bosses || 0),
  A('boss-10', 'Boss Rush', 'Defeat 10 bosses', 10, (s) => gameOf(s).bosses || 0),
  A('boss-25', 'Boss Hunter', 'Defeat 25 bosses', 25, (s) => gameOf(s).bosses || 0),
  A('boss-50', 'Bane of Bosses', 'Defeat 50 bosses', 50, (s) => gameOf(s).bosses || 0),
  A('boss-100', 'Boss of Bosses', 'Defeat 100 bosses', 100, (s) => gameOf(s).bosses || 0),
  // every boss, and every boss of a biome
  ...Object.values(BOSS_POOLS).flat().map(([id, name, who]) => A(`boss-${id}`, name, `Defeat ${who}`, 1, (s) => bossTypes(s)[id] || 0)),
  A('bosses-dungeon', 'Dungeon Master', 'Defeat all three dungeon bosses', 3, bossesIn('dungeon')),
  A('bosses-forest', 'Forest Warden', 'Defeat all three forest bosses', 3, bossesIn('forest')),
  A('bosses-lava', 'Firewalker', 'Defeat all three lava cave bosses', 3, bossesIn('lava')),
  A('bosses-castle', 'Castle Crasher', 'Defeat all three castle bosses', 3, bossesIn('castle')),
  A('bosses-all', 'Bestiary Complete', 'Defeat all twelve bosses', 12, bossKinds),
  // gold
  A('gold-500', 'Coin Purse', 'Hold 500 gold at once', 500, (s) => gameOf(s).gold || 0),
  A('gold-5000', 'Dragon Hoard', 'Hold 5,000 gold at once', 5000, (s) => gameOf(s).gold || 0),
  A('gold-20000', 'Midas', 'Hold 20,000 gold at once', 20000, (s) => gameOf(s).gold || 0),
  // chests (game.chests counts opened chests by tier)
  A('chests-1', 'Loot Goblin', 'Open your first chest', 1, (s) => sumOf(chestsOf(s))),
  A('chests-100', 'Treasure Hunter', 'Open 100 chests', 100, (s) => sumOf(chestsOf(s))),
  A('chests-500', 'Mimic Whisperer', 'Open 500 chests', 500, (s) => sumOf(chestsOf(s))),
  A('chest-wooden-50', 'Splinter Collector', 'Open 50 Wooden chests', 50, (s) => chestsOf(s).wooden || 0),
  A('chest-iron-10', 'Ironclad', 'Open 10 Iron chests', 10, (s) => chestsOf(s).iron || 0),
  A('chest-gold-10', 'Golden Touch', 'Open 10 Gold chests', 10, (s) => chestsOf(s).gold || 0),
  A('chest-epic-5', 'Epic Loot', 'Open 5 Epic chests', 5, (s) => chestsOf(s).epic || 0),
  A('chest-legendary-1', 'Legendary Haul', 'Open a Legendary chest', 1, (s) => chestsOf(s).legendary || 0),
  // crafting, sets and collection
  A('craft-1', 'Apprentice Crafter', 'Craft your first item', 1, (s) => gameOf(s).crafted || 0),
  A('craft-10', 'Artisan', 'Craft 10 items', 10, (s) => gameOf(s).crafted || 0),
  A('set-slimebound', 'Gooey Ensemble', 'Own every piece of the Slimebound set', SET_PIECES.Slimebound.length, setOwned('Slimebound')),
  A('set-bonecaller', 'Bone Collector', 'Own every piece of the Bonecaller set', SET_PIECES.Bonecaller.length, setOwned('Bonecaller')),
  A('set-emberforged', 'Forged in Fire', 'Own every piece of the Emberforged set', SET_PIECES.Emberforged.length, setOwned('Emberforged')),
  A('set-starlight', 'Starborn', 'Own every piece of the Starlight set', SET_PIECES.Starlight.length, setOwned('Starlight')),
  A('sets-all', 'Set Collector', 'Complete all four item sets', 4, setsDone),
  A('mats-50', 'Hoarder', 'Hold 50 crafting materials', 50, (s) => sumOf(matsOf(s))),
  A('mats-kinds', 'Alchemist\'s Shelf', 'Hold every kind of crafting material', MATERIAL_IDS.length, (s) => MATERIAL_IDS.filter((m) => matsOf(s)[m] > 0).length),
  A('mats-starlight', 'Stardust Collector', 'Hold 10 Starlight Dust', 10, (s) => matsOf(s).starlight || 0),
  A('items-10', 'Fashionista', 'Own 10 cosmetic items', 10, (s) => inventoryOf(s).length),
  A('items-25', 'Wardrobe Master', 'Own 25 cosmetic items', 25, (s) => inventoryOf(s).length),
  A('full-outfit', 'Dressed to Kill', 'Wear something in every equipment slot', EQUIP_SLOTS.length, equippedSlots),
  // skill tree
  A('skill-1', 'First Lesson', 'Learn your first skill rank', 1, ranksLearned),
  A('skill-15', 'Well Studied', 'Learn 15 skill ranks', 15, ranksLearned),
  A('capstone-1', 'Capstone', 'Learn a capstone skill', 1, capstones),
  A('capstone-3', 'Grandmaster', 'Learn three capstone skills', 3, capstones),
  A('paragon-1', 'Paragon', 'Spend your first paragon point', 1, paragonPts),
  A('paragon-25', 'Beyond Mastery', 'Spend 25 paragon points', 25, paragonPts),
  A('respec-1', 'Second Thoughts', 'Reset your skill tree', 1, respecs),
  // guild
  A('guild-1', 'Recruiter', 'Welcome your first recruit into the guild', 1, (s) => guildOf(s).length),
  A('guild-6', 'Guild Hall', 'Have 6 recruits in your guild', 6, (s) => guildOf(s).length),
  A('guild-12', 'Full House', 'Fill your guild with 12 recruits', 12, (s) => guildOf(s).length),
  A('recruit-5', 'Seasoned Recruit', 'Train a recruit to guild level 5', 5, topRecruit),
  A('recruit-10', 'Guild Champion', 'Train a recruit to guild level 10', 10, topRecruit),
  A('guild-classes', 'United Classes', 'Have a recruit of every class', CLASSES.length, (s) => new Set(guildOf(s).map((g) => g && g.cls)).size),
  A('guild-active-3', 'Shield Wall', 'Have 3 recruits fighting beside you', 3, (s) => guildOf(s).filter((g) => g && g.active).length),
  A('guild-jobs-50', 'Job Board', 'Your recruits finish 50 jobs', 50, (s) => guildOf(s).reduce((n, g) => n + (Number(g && g.jobs) || 0), 0)),
  // heroes and classes
  A('heroes-2', 'Alter Ego', 'Create a second hero', 2, heroCount),
  A('heroes-5', 'Hall of Heroes', 'Create 5 heroes', 5, heroCount),
  A('heroes-10', 'Legion of Selves', 'Create 10 heroes', 10, heroCount),
  ...[['mage', 'Spellbook Opened'], ['ranger', 'Into the Wild'], ['knight', 'Sworn In'], ['warlock', 'Pact Signed'], ['bard', 'Opening Act'], ['rogue', 'Shadow Step']]
    .map(([cls, name]) => A(`class-${cls}`, name, `Play a ${cls[0].toUpperCase() + cls.slice(1)}`, 1, () => (classesPlayed().has(cls) ? 1 : 0))),
  A('class-all', 'Renaissance Hero', 'Play every class', CLASSES.length, () => CLASSES.filter((c) => classesPlayed().has(c)).length),
  // bounties (bounties.js counts claims in game.bounties.stats)
  A('bounty-1', 'Bounty Hunter', 'Claim your first daily bounty', 1, (s) => bountyStats(s).daily || 0),
  A('bounty-25', 'Regular', 'Claim 25 daily bounties', 25, (s) => bountyStats(s).daily || 0),
  A('bounty-100', 'Contractor', 'Claim 100 daily bounties', 100, (s) => bountyStats(s).daily || 0),
  A('bounty-w1', 'Weekly Warrior', 'Claim a weekly bounty', 1, (s) => bountyStats(s).weekly || 0),
  A('bounty-w10', 'Seasoned Hunter', 'Claim 10 weekly bounties', 10, (s) => bountyStats(s).weekly || 0),
  A('bounty-m1', 'Monthly Legend', 'Claim a monthly bounty', 1, (s) => bountyStats(s).monthly || 0),
  A('bounty-m6', 'Half-Year Hero', 'Claim 6 monthly bounties', 6, (s) => bountyStats(s).monthly || 0),
  A('bounty-all-150', 'Bounty Baron', 'Claim 150 bounties in total', 150, (s) => sumOf(bountyStats(s))),
  // secret: judged on the quest that just ended (times use the local clock)
  A('night-owl', 'Night Owl', 'Finish a quest between midnight and 4 am', 1, won((s, ses) => wonAt(ses).getHours() < 4), S),
  A('early-bird', 'Early Bird', 'Finish a quest between 5 and 7 am', 1, won((s, ses) => [5, 6].includes(wonAt(ses).getHours())), S),
  A('weekend', 'Weekend Warrior', 'Finish a quest on a Saturday or Sunday', 1, won((s, ses) => [0, 6].includes(wonAt(ses).getDay())), S),
  A('marathon', 'Marathon', 'Finish a quest that took 30 minutes or more', 30, (s, ses) => (justWon(ses) ? Math.floor(turnMins(ses)) : 0), S),
  A('scar-tissue', 'Scar Tissue', 'Finish a quest after 3 or more failures', 3, (s, ses) => (justWon(ses) ? turnOf(ses).fails || 0 : 0), S),
  A('untouchable', 'Untouchable', 'Finish a quest of 20+ tool calls without a failure', 20, (s, ses) => (justWon(ses) && !turnOf(ses).fails ? turnTools(ses) : 0), S),
  A('midnight-oil', 'Midnight Oil', 'Finish a quest that started the day before', 1, won((s, ses) => turnOf(ses).start && new Date(turnOf(ses).start).toDateString() !== wonAt(ses).toDateString()), S),
  A('friday-deploy', 'Friday Deploy', 'Finish a quest on a Friday after 4 pm', 1, won((s, ses) => wonAt(ses).getDay() === 5 && wonAt(ses).getHours() >= 16), S),
  A('speedrunner', 'Speedrunner', 'Finish a quest of 5+ tool calls in under a minute', 1, won((s, ses) => turnTools(ses) >= 5 && turnMins(ses) < 1), S),
  A('last-stand', 'Last Stand', 'Finish a quest with 10 HP or less left', 1, won((s, ses) => (ses.hp || 0) <= 30), S),
  A('rubber-duck', 'Rubber Duck', 'Finish a quest without a single tool call', 1, won((s, ses) => turnOf(ses).start && turnTools(ses) === 0), S),
  A('token-tsunami', 'Token Tsunami', 'Earn 100 token XP in a single quest', 100, (s, ses) => (justWon(ses) ? turnOf(ses).tokens || 0 : 0), S),
  A('spooky', 'Spooky Season', 'Finish a quest on Halloween', 1, won((s, ses) => wonAt(ses).getMonth() === 9 && wonAt(ses).getDate() === 31), S),
  A('new-year', 'Fresh Start', 'Finish a quest on New Year\'s Day', 1, won((s, ses) => wonAt(ses).getMonth() === 0 && wonAt(ses).getDate() === 1), S),
  A('leet', 'L33T', 'Hold exactly 1,337 gold', 1, (s) => (gameOf(s).gold === 1337 ? 1 : 0), S),
  A('answer-42', 'Don\'t Panic', 'Complete exactly 42 turns', 1, (s) => (quests(s) === 42 ? 1 : 0), S),
  A('hydra', 'Hydra', 'Run 5 Claude sessions in one day', 5, (s) => Object.keys((s && s.sessions) || {}).length, S),
  A('indecisive', 'Indecisive', 'Reset your skill tree 5 times', 5, respecs, S),
];
// Values never throw and always return a number, whatever the state holds.
for (const a of ACHIEVEMENTS) {
  const f = a.value;
  a.value = (s, ses) => { try { return Number(f(s || {}, ses)) || 0; } catch { return 0; } };
}
// Returns newly unlocked achievements and records them in state.
function unlock(state, ses) {
  const got = new Set(state.achievements);
  const fresh = ACHIEVEMENTS.filter((a) => !got.has(a.id) && a.value(state, ses) >= a.goal);
  for (const a of fresh) state.achievements.push(a.id);
  return fresh;
}

module.exports = {
  HOME, STATE_FILE, CONFIG_FILE, EVENTS_FILE, APPROVALS_DIR, HEARTBEAT, gameAlive, pendingApprovals, answerApproval, withLock, logEvent, readEvents, THEMES, ACHIEVEMENTS, TOOL_XP, c, paint, bar, visWidth, padVis,
  readJSON, writeJSON, readStdin, loadState, saveState, loadConfig, saveConfig,
  switchHero, createHero, deleteHero, heroList, HERO_FIELDS,
  session, pruneSessions, project, projectRoot, levelFor, xpForLevel, theme, titleFor, modeForTool, describeTool, unlock,
};
