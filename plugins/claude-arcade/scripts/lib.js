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

function defaultState() {
  return { xp: 0, quests: 0, tools: {}, achievements: [], sessions: {}, streak: { day: null, count: 0 } };
}

function loadState() { return { ...defaultState(), ...readJSON(STATE_FILE, {}) }; }
function saveState(s) { writeJSON(STATE_FILE, s); }

function loadConfig() {
  return { theme: 'rpg', ascii: false, toasts: true, ...readJSON(CONFIG_FILE, {}) };
}
function saveConfig(c) { writeJSON(CONFIG_FILE, c); }

function session(state, id) {
  const key = id || 'default';
  state.sessions[key] ||= { mode: 'idle', detail: '', since: Date.now(), hp: 100, combo: 0, party: {}, xp: 0 };
  return state.sessions[key];
}

// Drop sessions nobody has touched for a day so state.json stays small.
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
    titles: ['Peasant', 'Squire', 'Apprentice Coder', 'Code Knight', 'Bug Slayer', 'Refactor Paladin',
      'Merge Sorcerer', 'Archmage of Types', 'Legendary Hacker', 'Mythic Architect', 'Elder Code God'],
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
    spinnerVerbs: ['Rolling for initiative', 'Consulting the oracle', 'Grinding XP', 'Brewing potions',
      'Sharpening swords', 'Looting the codebase', 'Casting fireball', 'Slaying bugs', 'Reading ancient scrolls',
      'Deciphering runes', 'Crafting artifacts', 'Questing', 'Leveling up', 'Summoning familiars'],
    tips: ['Every edit forged earns XP ⚒', 'Failed commands cost HP — heal by finishing quests 🏆',
      'Summon subagents to build your party 🧝', 'Run /claude-arcade:stats to see your hero sheet'],
  },
  space: {
    name: 'Star Command',
    titles: ['Cadet', 'Ensign', 'Lieutenant', 'Commander', 'Captain', 'Commodore', 'Rear Admiral',
      'Vice Admiral', 'Admiral', 'Fleet Admiral', 'Galactic Legend'],
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
    spinnerVerbs: ['Warping', 'Calibrating sensors', 'Charging hyperdrive', 'Reticulating nebulae',
      'Scanning the void', 'Docking', 'Terraforming', 'Plotting a course', 'Engaging tractor beam'],
    tips: ['Every mission completed earns XP 🌟', 'Launch subagents to grow your fleet 🛸',
      'Run /claude-arcade:stats for your service record'],
  },
  retro: {
    // Plain ASCII: safe for any font / terminal.
    name: '8-Bit Arcade',
    titles: ['NOOB', 'PLAYER 1', 'CHALLENGER', 'HI-SCORER', 'COMBO KING', 'BOSS SLAYER', 'SPEEDRUNNER',
      'GRANDMASTER', 'LEGEND', 'MAX LEVEL', 'KILL SCREEN'],
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
    spinnerVerbs: ['LOADING', 'BUFFERING', 'BLOWING ON CARTRIDGE', 'GRINDING', 'SPEEDRUNNING',
      'SAVING GAME', 'ENTERING CHEAT CODE', 'RESPAWNING', 'CHARGING SUPER'],
    tips: ['UP UP DOWN DOWN LEFT RIGHT LEFT RIGHT B A', 'Finish turns to rack up PTS',
      'Run /claude-arcade:stats for the high score table'],
  },
};

function theme(cfg) { return THEMES[cfg.theme] || THEMES.rpg; }

// A new title every two levels.
function titleFor(t, lvl) { return t.titles[Math.min(t.titles.length - 1, Math.floor((lvl - 1) / 2))]; }

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

const ACHIEVEMENTS = [
  { id: 'first-quest', name: 'First Blood', desc: 'Complete your first turn', test: (s) => s.quests >= 1 },
  { id: 'quests-100', name: 'Centurion', desc: 'Complete 100 turns', test: (s) => s.quests >= 100 },
  { id: 'forge-50', name: 'Blacksmith', desc: 'Make 50 edits', test: (s) => (s.tools.editing || 0) >= 50 },
  { id: 'forge-500', name: 'Master Smith', desc: 'Make 500 edits', test: (s) => (s.tools.editing || 0) >= 500 },
  { id: 'cast-100', name: 'Spellslinger', desc: 'Run 100 commands', test: (s) => (s.tools.running || 0) >= 100 },
  { id: 'scout-200', name: 'Pathfinder', desc: 'Read or search 200 times', test: (s) => (s.tools.reading || 0) + (s.tools.searching || 0) >= 200 },
  { id: 'summon-1', name: 'Party Up', desc: 'Summon your first subagent', test: (s) => (s.tools.summoning || 0) >= 1 },
  { id: 'summon-25', name: 'Guild Master', desc: 'Summon 25 subagents', test: (s) => (s.tools.summoning || 0) >= 25 },
  { id: 'full-party', name: 'Full Party', desc: 'Have 3 subagents running at once', test: (s, ses) => ses && Object.keys(ses.party).length >= 3 },
  { id: 'combo-25', name: 'Combo x25', desc: '25 tool calls in one turn without a failure', test: (s, ses) => ses && ses.combo >= 25 },
  { id: 'streak-3', name: 'Dedicated', desc: 'Play 3 days in a row', test: (s) => s.streak.count >= 3 },
  { id: 'streak-7', name: 'Obsessed', desc: 'Play 7 days in a row', test: (s) => s.streak.count >= 7 },
  { id: 'lvl-10', name: 'Double Digits', desc: 'Reach level 10', test: (s) => levelFor(s.xp) >= 10 },
];

// Returns newly unlocked achievements and records them in state.
function unlock(state, ses) {
  const got = new Set(state.achievements);
  const fresh = ACHIEVEMENTS.filter((a) => !got.has(a.id) && a.test(state, ses));
  for (const a of fresh) state.achievements.push(a.id);
  return fresh;
}

module.exports = {
  HOME, STATE_FILE, CONFIG_FILE, THEMES, ACHIEVEMENTS, TOOL_XP, c, paint, bar,
  readJSON, writeJSON, readStdin, loadState, saveState, loadConfig, saveConfig,
  session, pruneSessions, levelFor, xpForLevel, theme, titleFor, modeForTool, describeTool, unlock,
};
