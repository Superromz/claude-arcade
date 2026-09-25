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
const tool = (k) => (s) => s.tools[k] || 0;
// Cheap, missing-field-safe readers for achievement values.
const gameOf = (s) => (s && s.game) || {};
const streakOf = (s) => ((s && s.streak) || {}).count || 0;
const toolSum = (s) => Object.values((s && s.tools) || {}).reduce((n, v) => n + (Number(v) || 0), 0);
const TOOL_KINDS = ['editing', 'running', 'reading', 'searching', 'web', 'summoning', 'planning'];
// The roster lives in config.json; cache it briefly since the trophies tab
// evaluates every achievement each frame.
let heroCache = { t: 0, n: 0 };
function heroCount() {
  if (Date.now() - heroCache.t > 2000) {
    try { heroCache = { t: Date.now(), n: (loadConfig().heroes || []).length }; } catch { heroCache = { t: Date.now(), n: 0 }; }
  }
  return heroCache.n;
}
// The turn that just ended (the Stop hook sets victory right before unlock).
const justWon = (ses) => !!(ses && ses.mode === 'victory' && ses.since);
const wonAt = (ses) => new Date(ses.since);
const turnTools = (ses) => (ses && ses.turn ? Object.keys(TOOL_XP).reduce((n, k) => n + (ses.turn[k] || 0), 0) : 0);

const ACHIEVEMENTS = [
  // quests
  { id: 'first-quest', name: 'First Blood', desc: 'Complete your first turn', goal: 1, value: (s) => s.quests },
  { id: 'quests-10', name: 'Adventurer', desc: 'Complete 10 turns', goal: 10, value: (s) => s.quests || 0 },
  { id: 'quests-100', name: 'Centurion', desc: 'Complete 100 turns', goal: 100, value: (s) => s.quests },
  { id: 'quests-500', name: 'Veteran', desc: 'Complete 500 turns', goal: 500, value: (s) => s.quests || 0 },
  { id: 'quests-1000', name: 'Living Legend', desc: 'Complete 1,000 turns', goal: 1000, value: (s) => s.quests || 0 },
  // tools
  { id: 'forge-1', name: 'Tinkerer', desc: 'Make your first edit', goal: 1, value: tool('editing') },
  { id: 'forge-50', name: 'Blacksmith', desc: 'Make 50 edits', goal: 50, value: tool('editing') },
  { id: 'forge-500', name: 'Master Smith', desc: 'Make 500 edits', goal: 500, value: tool('editing') },
  { id: 'forge-2000', name: 'Forge Lord', desc: 'Make 2,000 edits', goal: 2000, value: tool('editing') },
  { id: 'cast-10', name: 'Apprentice Caster', desc: 'Run 10 commands', goal: 10, value: tool('running') },
  { id: 'cast-100', name: 'Spellslinger', desc: 'Run 100 commands', goal: 100, value: tool('running') },
  { id: 'cast-1000', name: 'Archmage', desc: 'Run 1,000 commands', goal: 1000, value: tool('running') },
  { id: 'scout-200', name: 'Pathfinder', desc: 'Read or search 200 times', goal: 200, value: (s) => (s.tools.reading || 0) + (s.tools.searching || 0) },
  { id: 'scout-2000', name: 'Loremaster', desc: 'Read or search 2,000 times', goal: 2000, value: (s) => (s.tools.reading || 0) + (s.tools.searching || 0) },
  { id: 'web-25', name: 'Far Seer', desc: 'Use the web or an MCP tool 25 times', goal: 25, value: tool('web') },
  { id: 'web-250', name: 'Eagle Master', desc: 'Use the web or an MCP tool 250 times', goal: 250, value: tool('web') },
  { id: 'plan-10', name: 'Strategist', desc: 'Plan or update todos 10 times', goal: 10, value: tool('planning') },
  { id: 'plan-100', name: 'Grand Tactician', desc: 'Plan or update todos 100 times', goal: 100, value: tool('planning') },
  { id: 'all-rounder', name: 'Jack of All Trades', desc: 'Use every kind of tool at least once', goal: TOOL_KINDS.length, value: (s) => TOOL_KINDS.filter((k) => (s.tools || {})[k] > 0).length },
  { id: 'tools-10k', name: 'Ten Thousand Spells', desc: 'Make 10,000 tool calls', goal: 10000, value: toolSum },
  // party
  { id: 'summon-1', name: 'Party Up', desc: 'Summon your first subagent', goal: 1, value: tool('summoning') },
  { id: 'summon-25', name: 'Guild Master', desc: 'Summon 25 subagents', goal: 25, value: tool('summoning') },
  { id: 'summon-100', name: 'Legion Commander', desc: 'Summon 100 subagents', goal: 100, value: tool('summoning') },
  { id: 'full-party', name: 'Full Party', desc: 'Have 3 subagents running at once', goal: 3, value: (s, ses) => (ses ? Object.keys(ses.party || {}).length : 0) },
  { id: 'party-5', name: 'Raid Group', desc: 'Have 5 subagents running at once', goal: 5, value: (s, ses) => (ses ? Object.keys(ses.party || {}).length : 0) },
  // combo
  { id: 'combo-25', name: 'Combo x25', desc: '25 tool calls in a row without a failure', goal: 25, value: (s, ses) => (ses ? ses.combo : 0) },
  { id: 'combo-50', name: 'Unstoppable', desc: '50 tool calls in a row without a failure', goal: 50, value: (s, ses) => (ses ? ses.combo || 0 : 0) },
  { id: 'combo-100', name: 'Godlike', desc: '100 tool calls in a row without a failure', goal: 100, value: (s, ses) => (ses ? ses.combo || 0 : 0) },
  // streaks
  { id: 'streak-3', name: 'Dedicated', desc: 'Play 3 days in a row', goal: 3, value: streakOf },
  { id: 'streak-7', name: 'Obsessed', desc: 'Play 7 days in a row', goal: 7, value: streakOf },
  { id: 'streak-14', name: 'Devoted', desc: 'Play 14 days in a row', goal: 14, value: streakOf },
  { id: 'streak-30', name: 'Monthly Ritual', desc: 'Play 30 days in a row', goal: 30, value: streakOf },
  { id: 'streak-100', name: 'Centennial', desc: 'Play 100 days in a row', goal: 100, value: streakOf },
  // levels
  { id: 'lvl-5', name: 'Rising Star', desc: 'Reach level 5', goal: 5, value: (s) => levelFor(s.xp || 0) },
  { id: 'lvl-10', name: 'Double Digits', desc: 'Reach level 10', goal: 10, value: (s) => levelFor(s.xp) },
  { id: 'lvl-20', name: 'Twenty-Sided', desc: 'Reach level 20', goal: 20, value: (s) => levelFor(s.xp || 0) },
  { id: 'lvl-30', name: 'Ascended', desc: 'Reach level 30', goal: 30, value: (s) => levelFor(s.xp || 0) },
  // tokens
  { id: 'tokens-100k', name: 'Wordsmith', desc: 'Claude writes 100,000 output tokens for you', goal: 1e5, value: (s) => ((s.tokens || {}).output || 0) },
  { id: 'tokens-1m', name: 'Epic Poet', desc: 'Claude writes 1,000,000 output tokens for you', goal: 1e6, value: (s) => ((s.tokens || {}).output || 0) },
  { id: 'tokens-10m', name: 'Library of Babel', desc: 'Claude writes 10,000,000 output tokens for you', goal: 1e7, value: (s) => ((s.tokens || {}).output || 0) },
  // projects
  { id: 'projects-3', name: 'Wanderer', desc: 'Adventure in 3 different projects', goal: 3, value: (s) => Object.keys(s.projects || {}).length },
  { id: 'projects-10', name: 'Cartographer', desc: 'Adventure in 10 different projects', goal: 10, value: (s) => Object.keys(s.projects || {}).length },
  { id: 'projects-25', name: 'World Walker', desc: 'Adventure in 25 different projects', goal: 25, value: (s) => Object.keys(s.projects || {}).length },
  // battle
  { id: 'kills-100', name: 'Monster Hunter', desc: 'Slay 100 monsters', goal: 100, value: (s) => gameOf(s).kills || 0 },
  { id: 'kills-1000', name: 'Exterminator', desc: 'Slay 1,000 monsters', goal: 1000, value: (s) => gameOf(s).kills || 0 },
  { id: 'wave-10', name: 'Wave Rider', desc: 'Reach wave 10', goal: 10, value: (s) => gameOf(s).bestWave || 0 },
  { id: 'boss-1', name: 'Giant Slayer', desc: 'Defeat a boss', goal: 1, value: (s) => gameOf(s).bosses || 0 },
  { id: 'boss-10', name: 'Boss Rush', desc: 'Defeat 10 bosses', goal: 10, value: (s) => gameOf(s).bosses || 0 },
  // gold
  { id: 'gold-500', name: 'Coin Purse', desc: 'Hold 500 gold at once', goal: 500, value: (s) => gameOf(s).gold || 0 },
  { id: 'gold-5000', name: 'Dragon Hoard', desc: 'Hold 5,000 gold at once', goal: 5000, value: (s) => gameOf(s).gold || 0 },
  // heroes
  { id: 'heroes-2', name: 'Alter Ego', desc: 'Create a second hero', goal: 2, value: heroCount },
  { id: 'heroes-5', name: 'Hall of Heroes', desc: 'Create 5 heroes', goal: 5, value: heroCount },
  // secret: judged on the quest that just ended
  { id: 'night-owl', name: 'Night Owl', desc: 'Finish a quest between midnight and 4 am', goal: 1, secret: true, value: (s, ses) => (justWon(ses) && wonAt(ses).getHours() < 4 ? 1 : 0) },
  { id: 'early-bird', name: 'Early Bird', desc: 'Finish a quest between 5 and 7 am', goal: 1, secret: true, value: (s, ses) => (justWon(ses) && [5, 6].includes(wonAt(ses).getHours()) ? 1 : 0) },
  { id: 'weekend', name: 'Weekend Warrior', desc: 'Finish a quest on a Saturday or Sunday', goal: 1, secret: true, value: (s, ses) => (justWon(ses) && [0, 6].includes(wonAt(ses).getDay()) ? 1 : 0) },
  { id: 'marathon', name: 'Marathon', desc: 'Finish a quest that took 30 minutes or more', goal: 30, secret: true, value: (s, ses) => (justWon(ses) && ses.turn && ses.turn.start ? Math.floor((ses.since - ses.turn.start) / 60000) : 0) },
  { id: 'scar-tissue', name: 'Scar Tissue', desc: 'Finish a quest after 3 or more failures', goal: 3, secret: true, value: (s, ses) => (justWon(ses) && ses.turn ? ses.turn.fails || 0 : 0) },
  { id: 'untouchable', name: 'Untouchable', desc: 'Finish a quest of 20+ tool calls without a failure', goal: 20, secret: true, value: (s, ses) => (justWon(ses) && ses.turn && !ses.turn.fails ? turnTools(ses) : 0) },
];
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
