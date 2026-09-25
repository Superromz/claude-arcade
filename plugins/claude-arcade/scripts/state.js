'use strict';
// Shared game state, palettes and helpers used by every game module.

const L = require('./lib');
const M = require('./messages');
const X = require('./pixel');
const C = require('./character');
const SP = require('./sprites');
const G = require('./guild');


const ESC = '\x1b[';

const RESET = `${ESC}0m`, BOLD = `${ESC}1m`, NOBOLD = `${ESC}22m`;

const fg = ([r, g, b]) => `${ESC}38;2;${r};${g};${b}m`;

const bg = ([r, g, b]) => `${ESC}48;2;${r};${g};${b}m`;

const UI = {
  rpg: { panel: [24, 20, 34], panel2: [36, 30, 50], accent: [255, 176, 60], text: [232, 226, 242], dim: [128, 118, 150], good: [120, 220, 120], bad: [255, 92, 92], magic: [185, 135, 255], gold: [255, 214, 80], ink: [24, 20, 34] },
  space: { panel: [10, 14, 30], panel2: [20, 28, 52], accent: [80, 200, 255], text: [226, 236, 255], dim: [110, 130, 170], good: [90, 240, 190], bad: [255, 80, 130], magic: [200, 120, 255], gold: [255, 230, 110], ink: [10, 14, 30] },
  retro: { panel: [6, 18, 6], panel2: [12, 34, 12], accent: [90, 255, 90], text: [140, 255, 140], dim: [50, 140, 50], good: [90, 255, 90], bad: [200, 255, 120], magic: [120, 255, 160], gold: [200, 255, 100], ink: [6, 18, 6] },
};

const TABS = ['Adventure', 'Hero', 'Party', 'Guild', 'Bounties', 'Trophies', 'Shop', 'Projects'];

const SIDE = 46;

const ui = {
  screen: 'game', tab: 0, pin: null, cheerUntil: 0, tick: 0, prev: [],
  particles: [], floaters: [], dust: [],
  battle: { monsters: [], shots: [], bolts: [], coins: [], wave: 0, kills: 0, gold: 0, lastEventT: Date.now(), lastVictory: 0, shake: 0, flash: 0, practice: false },
  cooldowns: {}, layout: null, dirty: false, lastSave: 0, heroX: 0, heroY: 0,
  create: { field: 0, ch: null },
};

// ---------- data ----------

function snapshotData() {
  const cfg = L.loadConfig();
  const state = L.loadState();
  const sessions = Object.entries(state.sessions).sort((a, b) => (b[1].since || 0) - (a[1].since || 0));
  const sid = ui.pin && state.sessions[ui.pin] ? ui.pin : sessions[0] && sessions[0][0];
  let ses = (sid && state.sessions[sid]) || { mode: 'idle', since: Date.now(), hp: 100, combo: 0, party: {} };
  // Active guild recruits fight beside the hero as permanent party members.
  // They only live in this snapshot, never in state.json.
  const recruits = G.partyEntries(state, cfg);
  if (Object.keys(recruits).length) ses = { ...ses, party: { ...(ses.party || {}), ...recruits } };
  const events = L.readEvents(150).filter((e) => !sid || !e.sid || e.sid === sid);
  const hero = C.getCharacter(cfg) || C.defaultCharacter();
  const lvl = L.levelFor(state.xp);
  const stats = C.stats(state, C.getCharacter(cfg));
  return { cfg, state, sessions, sid, ses, events, hero, lvl, stats };
}

function currentMode(ses) {
  const age = (Date.now() - (ses.since || 0)) / 1000;
  let mode = ses.mode || 'idle';
  if (mode === 'victory' && age > 8) mode = 'idle';
  if (mode === 'hurt' && age > 3) mode = 'thinking';
  if (!['idle', 'victory', 'waiting'].includes(mode) && age > 1800) mode = 'idle';
  return mode;
}

const isBusy = (mode) => !['idle', 'victory', 'waiting', 'cheer'].includes(mode);

// Biome by hero level (backgrounds and monster rosters both use this).
// ARCADE_BIOME forces one for screenshots.
const BIOMES = ['dungeon', 'forest', 'lava', 'castle'];
function biomeFor(lvl) {
  if (process.env.ARCADE_BIOME && BIOMES.includes(process.env.ARCADE_BIOME)) return process.env.ARCADE_BIOME;
  return lvl >= 15 ? 'castle' : lvl >= 10 ? 'lava' : lvl >= 5 ? 'forest' : 'dungeon';
}

module.exports = { BIOMES, biomeFor, ESC, RESET, BOLD, NOBOLD, fg, bg, UI, TABS, SIDE, ui, snapshotData, currentMode, isBusy };
