// The player's hero: classes, customization options, class XP bonuses,
// RPG stats derived from real usage, and token-based XP from transcripts.
'use strict';

const fs = require('fs');

const CLASSES = {
  mage: { name: 'Mage', role: 'Area blasts that hit every nearby monster', icon: '🧙', head: 'wizard', weapon: 'staff', specialty: ['running'], stat: 'INT', primary: 'royal', secondary: 'violet', accessory: 'beard', desc: 'Commands are spells. +50% XP from running commands.' },
  ranger: { name: 'Ranger', role: 'Strikes first with high crit chance', icon: '🏹', head: 'hood', weapon: 'bow', specialty: ['reading', 'searching'], stat: 'DEX', primary: 'forest', secondary: 'forest', accessory: 'cape', desc: 'Sees everything. +50% XP from reading and searching.' },
  knight: { name: 'Knight', role: 'Taunts monsters and shields the hero', icon: '🛡', head: 'helm', weapon: 'sword', specialty: ['editing'], stat: 'STR', primary: 'charcoal', secondary: 'crimson', accessory: 'cape', desc: 'Forges code. +50% XP from edits.' },
  warlock: { name: 'Warlock', role: 'Curses that deal damage over time', icon: '🔮', head: 'horns', weapon: 'familiar', specialty: ['summoning'], stat: 'CHA', primary: 'violet', secondary: 'charcoal', accessory: 'none', desc: 'Commands a legion. +50% XP from summoning agents.' },
  bard: { name: 'Bard', role: 'Inspires the party: +20% damage for all', icon: '🎵', head: 'cap', weapon: 'lute', specialty: ['web', 'planning'], stat: 'WIS', primary: 'crimson', secondary: 'gold', accessory: 'scarf', desc: 'Knows every tale. +50% XP from web, MCP and planning.' },
  rogue: { name: 'Rogue', role: 'Backstab bursts on a single target', icon: '🗡', head: 'mask', weapon: 'daggers', specialty: [], stat: 'DEX', primary: 'charcoal', secondary: 'teal', accessory: 'scarf', desc: 'Strikes fast. Combo bonuses are doubled.' },
};

const COLORS = {
  royal: [60, 92, 205], crimson: [190, 52, 58], forest: [52, 132, 66], violet: [124, 74, 206], gold: [222, 172, 52],
  teal: [40, 160, 164], charcoal: [74, 76, 92], snow: [214, 220, 232], rose: [222, 104, 152], orange: [232, 124, 44],
};
const SKINS = { light: [246, 208, 170], tan: [226, 174, 126], brown: [178, 122, 82], deep: [118, 78, 54] };
const HAIR = { brown: [112, 72, 42], black: [44, 38, 46], blond: [232, 202, 112], red: [192, 82, 42], white: [232, 232, 238], blue: [84, 124, 232] };
const ACCESSORIES = ['none', 'cape', 'beard', 'scarf'];

function defaultCharacter(cls = 'mage') {
  const c = CLASSES[cls];
  return { name: 'Claudius', cls, primary: c.primary, secondary: c.secondary, skin: 'light', hair: 'white', accessory: c.accessory };
}

function getCharacter(cfg) {
  const ch = cfg && cfg.character;
  return ch && CLASSES[ch.cls] ? { ...defaultCharacter(ch.cls), ...ch } : null;
}

// Class bonus applied to tool XP.
function xpFor(ch, mode, base, combo) {
  let xp = base;
  if (ch && CLASSES[ch.cls].specialty.includes(mode)) xp = Math.round(base * 1.5);
  const comboBonus = Math.floor(combo / 10);
  return xp + (ch && ch.cls === 'rogue' ? comboBonus * 2 : comboBonus);
}

// RPG stats grow with the square root of real usage, plus level and class.
function stats(state, ch) {
  const t = state.tools || {};
  const g = (n) => Math.floor(Math.sqrt(n || 0) * 1.5);
  const lvl = Math.floor((1 + Math.sqrt(1 + (8 * state.xp) / 100)) / 2);
  const s = {
    STR: 5 + g(t.editing) + lvl,
    INT: 5 + g(t.running) + lvl,
    DEX: 5 + g((t.reading || 0) + (t.searching || 0)) + lvl,
    WIS: 5 + g((t.web || 0) + (t.planning || 0)) + lvl + Math.floor(Math.log10(1 + ((state.tokens || {}).output || 0))),
    CHA: 5 + g((t.summoning || 0) * 4) + lvl,
  };
  if (ch) s[CLASSES[ch.cls].stat] += 5;
  return s;
}

// Read new transcript lines since the last offset and sum token usage.
// Assistant messages repeat their usage on every content-block line, so
// each message id is counted once.
function readTokens(file, offsets, key) {
  const res = { input: 0, output: 0 };
  if (!file) return res;
  let fd;
  try {
    const size = fs.statSync(file).size;
    let start = offsets[key] || 0;
    if (start > size) start = 0;
    if (size - start > 8 * 1024 * 1024) start = size - 8 * 1024 * 1024; // cap the first read
    const len = size - start;
    if (len <= 0) return res;
    const buf = Buffer.alloc(len);
    fd = fs.openSync(file, 'r');
    fs.readSync(fd, buf, 0, len, start);
    const text = buf.toString('utf8');
    const end = text.lastIndexOf('\n');
    if (end < 0) return res;
    offsets[key] = start + Buffer.byteLength(text.slice(0, end + 1));
    const seen = new Map();
    for (const line of text.slice(0, end).split('\n')) {
      if (!line.includes('"usage"')) continue;
      try {
        const msg = JSON.parse(line).message;
        if (msg && msg.usage) seen.set(msg.id || line.length + Math.random(), msg.usage);
      } catch {}
    }
    for (const u of seen.values()) {
      res.input += (u.input_tokens || 0) + (u.cache_creation_input_tokens || 0);
      res.output += u.output_tokens || 0;
    }
  } catch {} finally { if (fd !== undefined) try { fs.closeSync(fd); } catch {} }
  return res;
}

// Spellbook: unlocked by level. `modes` are the tool activities that prefer
// the spell; damage scales with level and the class's main stat.
const SPELLS = [
  { id: 'basic', name: 'Basic attack', lvl: 1, dmg: 5, modes: [] },
  { id: 'fireball', name: 'Fireball', lvl: 3, dmg: 9, aoe: 8, modes: ['editing', 'planning'] },
  { id: 'frost', name: 'Frost Shard', lvl: 5, dmg: 8, modes: ['reading', 'searching'] },
  { id: 'chain', name: 'Chain Lightning', lvl: 8, dmg: 7, chain: 3, modes: ['running'] },
  { id: 'meteor', name: 'Meteor', lvl: 12, dmg: 18, aoe: 16, modes: ['web', 'summoning'] },
  { id: 'starfall', name: 'Starfall', lvl: 18, dmg: 10, all: true, modes: ['thinking'] },
];
const BASIC_NAMES = { mage: 'Arcane Spark', ranger: 'Arrow', knight: 'Sword Wave', warlock: 'Shadow Bolt', bard: 'Power Chord', rogue: 'Throwing Knife' };

function spellFor(lvl, mode, tick = 0) {
  const known = SPELLS.filter((s) => s.lvl <= lvl);
  const preferred = known.filter((s) => s.modes.includes(mode));
  // Mostly the matching spell, sometimes the strongest known one.
  if (preferred.length && tick % 3 !== 0) return preferred[preferred.length - 1];
  return tick % 4 === 0 ? known[known.length - 1] : known[0];
}

function damage(spell, lvl, statValue) {
  return Math.round(spell.dmg * (1 + (lvl - 1) * 0.12) * (1 + statValue / 60));
}
// 1 XP per 150 output tokens and per 3,000 fresh input tokens.
const tokenXp = (u) => Math.floor(u.output / 150) + Math.floor(u.input / 3000);

module.exports = { SPELLS, BASIC_NAMES, spellFor, damage, CLASSES, COLORS, SKINS, HAIR, ACCESSORIES, defaultCharacter, getCharacter, xpFor, stats, readTokens, tokenXp };
