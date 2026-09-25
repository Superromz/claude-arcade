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

// Class skill kits: every class has its basic attack plus five skills that
// unlock at Lv 3/5/8/12/18. `modes` are the tool activities that prefer the
// skill; `cd` is the hotbar cooldown in ticks (10 per second). Damage scales
// with level and the class's main stat. Skill ids are unique across classes.
const UNLOCKS = [1, 3, 5, 8, 12, 18];
const kit = (list) => list.map((s, i) => ({ lvl: UNLOCKS[i], ...s }));
const KITS = {
  mage: kit([
    { id: 'basic', name: 'Arcane Spark', dmg: 5, cd: 6, modes: [], desc: 'A quick bolt of arcane light.' },
    { id: 'fireball', name: 'Fireball', dmg: 9, cd: 30, aoe: 8, burn: true, modes: ['editing', 'planning'], desc: 'Explodes on impact and sets monsters on fire.' },
    { id: 'frost', name: 'Frost Nova', dmg: 7, cd: 30, nova: 18, freeze: 40, modes: ['reading', 'searching'], desc: 'A ring of ice that freezes nearby monsters.' },
    { id: 'chain', name: 'Chain Lightning', dmg: 7, cd: 50, chain: 3, modes: ['running'], desc: 'Jumps between up to 3 monsters.' },
    { id: 'meteor', name: 'Meteor', dmg: 18, cd: 90, aoe: 16, burn: true, modes: ['web', 'summoning'], desc: 'A falling star that scorches a wide area.' },
    { id: 'starfall', name: 'Starfall', dmg: 10, cd: 150, all: true, modes: ['thinking'], desc: 'Stars rain down on every monster.' },
  ]),
  ranger: kit([
    { id: 'basic', name: 'Arrow', dmg: 5, cd: 6, modes: [], desc: 'A swift arrow.' },
    { id: 'multishot', name: 'Multishot', dmg: 6, cd: 30, targets: 3, modes: ['reading', 'searching'], desc: 'Looses an arrow at up to 3 monsters.' },
    { id: 'snare', name: 'Snare Trap', dmg: 8, cd: 30, root: 40, modes: ['editing', 'planning'], desc: 'A trap that snaps shut and roots a monster.' },
    { id: 'pierce', name: 'Piercing Arrow', dmg: 11, cd: 50, pierce: true, modes: ['running'], desc: 'Passes through every monster in its path.' },
    { id: 'rain', name: 'Rain of Arrows', dmg: 5, cd: 90, volleys: 4, aoe: 22, modes: ['web', 'summoning'], desc: 'Volleys of arrows fall on a wide area.' },
    { id: 'eagle', name: 'Eagle Strike', dmg: 14, cd: 150, all: true, critBonus: 0.3, modes: ['thinking'], desc: 'Your eagle dives through every monster.' },
  ]),
  knight: kit([
    { id: 'basic', name: 'Sword Wave', dmg: 5, cd: 6, modes: [], desc: 'A wave of steel.' },
    { id: 'bash', name: 'Shield Bash', dmg: 10, cd: 30, stun: 20, modes: ['editing'], desc: 'Slams the front monster and stuns it.' },
    { id: 'taunt', name: 'Taunt', dmg: 4, cd: 30, all: true, taunt: 60, modes: ['reading', 'searching', 'planning'], desc: 'Every monster attacks your shield instead of you.' },
    { id: 'whirl', name: 'Whirlwind', dmg: 9, cd: 50, near: 34, modes: ['running'], desc: 'Spins through every monster close to you.' },
    { id: 'holy', name: 'Holy Strike', dmg: 20, cd: 90, modes: ['web', 'summoning'], desc: 'A pillar of light smites one monster.' },
    { id: 'judgment', name: 'Judgment', dmg: 12, cd: 150, all: true, stun: 15, modes: ['thinking'], desc: 'Hammers of light fall on every monster.' },
  ]),
  warlock: kit([
    { id: 'basic', name: 'Shadow Bolt', dmg: 5, cd: 6, modes: [], desc: 'A bolt of shadow.' },
    { id: 'curse', name: 'Curse', dmg: 4, cd: 30, curse: 48, modes: ['summoning', 'planning'], desc: 'Withers a monster with damage over time.' },
    { id: 'drain', name: 'Drain Life', dmg: 8, cd: 30, heal: 2, modes: ['reading', 'searching'], desc: 'Steals life from a monster and heals you.' },
    { id: 'imp', name: 'Summon Imp', dmg: 6, cd: 50, imp: 80, modes: ['running'], desc: 'An imp joins the fight and hurls fire.' },
    { id: 'shadowflame', name: 'Shadowflame', dmg: 12, cd: 90, aoe: 14, burn: true, modes: ['web', 'editing'], desc: 'A cone of black fire that burns.' },
    { id: 'doom', name: 'Doom', dmg: 8, cd: 150, doom: 30, modes: ['thinking'], desc: 'Dooms a monster; it explodes a moment later.' },
  ]),
  bard: kit([
    { id: 'basic', name: 'Power Chord', dmg: 5, cd: 6, modes: [], desc: 'A crunchy chord.' },
    { id: 'anthem', name: 'Anthem', dmg: 4, cd: 30, anthem: 80, modes: ['planning', 'web'], desc: 'Rallies the party: +25% damage for a while.' },
    { id: 'discord', name: 'Discord', dmg: 6, cd: 30, aoe: 20, stun: 20, modes: ['reading', 'searching'], desc: 'A clashing note that stuns nearby monsters.' },
    { id: 'echo', name: 'Echo', dmg: 0, cd: 50, echo: true, modes: ['running'], desc: 'Plays your last skill again.' },
    { id: 'crescendo', name: 'Crescendo', dmg: 14, cd: 90, near: 60, modes: ['editing', 'summoning'], desc: 'A rising wave of sound across the field.' },
    { id: 'encore', name: 'Encore', dmg: 8, cd: 150, all: true, encore: true, modes: ['thinking'], desc: 'Hits every monster and resets your cooldowns.' },
  ]),
  rogue: kit([
    { id: 'basic', name: 'Throwing Knife', dmg: 5, cd: 6, modes: [], desc: 'A thrown knife.' },
    { id: 'backstab', name: 'Backstab', dmg: 14, cd: 30, critBonus: 0.35, dash: true, modes: ['editing'], desc: 'Dashes behind a monster; likely to crit.' },
    { id: 'poison', name: 'Poison Blade', dmg: 5, cd: 30, poison: 50, modes: ['reading', 'searching'], desc: 'Coats your blade in poison.' },
    { id: 'smoke', name: 'Smoke Bomb', dmg: 6, cd: 50, aoe: 16, dodge: 60, modes: ['running'], desc: 'A cloud of smoke; you dodge every hit inside it.' },
    { id: 'shadowstep', name: 'Shadow Step', dmg: 16, cd: 90, targets: 2, modes: ['web', 'summoning', 'planning'], desc: 'Blinks between two monsters, striking both.' },
    { id: 'deathmark', name: 'Death Mark', dmg: 8, cd: 150, mark: 60, modes: ['thinking'], desc: 'Marks a monster: +50% damage taken, then it bursts.' },
  ]),
};
const BASIC_NAMES = Object.fromEntries(Object.entries(KITS).map(([k, v]) => [k, v[0].name]));

// The class the game is showing. The game pane sets it every frame; other
// callers can pass a class explicitly. Defaults to the mage kit.
let activeCls = null;
function setClass(cls) { if (KITS[cls]) activeCls = cls; return activeCls; }
const kitFor = (cls) => KITS[cls] || KITS[activeCls] || KITS.mage;
const skillById = (id, cls) => kitFor(cls).find((s) => s.id === id) || Object.values(KITS).flat().find((s) => s.id === id) || null;

function spellFor(lvl, mode, tick = 0, cls) {
  const known = kitFor(cls).filter((s) => s.lvl <= lvl);
  const preferred = known.filter((s) => s.modes.includes(mode));
  // Mostly the matching skill, sometimes the strongest known one.
  if (preferred.length && tick % 3 !== 0) return preferred[preferred.length - 1];
  return tick % 4 === 0 ? known[known.length - 1] : known[0];
}

function damage(spell, lvl, statValue) {
  return Math.round((spell.dmg ?? 5) * (1 + (lvl - 1) * 0.12) * (1 + statValue / 60));
}
// 1 XP per 150 output tokens and per 3,000 fresh input tokens.
const tokenXp = (u) => Math.floor(u.output / 150) + Math.floor(u.input / 3000);

module.exports = { KITS, UNLOCKS, BASIC_NAMES, setClass, kitFor, skillById, spellFor, damage, CLASSES, COLORS, SKINS, HAIR, ACCESSORIES, defaultCharacter, getCharacter, xpFor, stats, readTokens, tokenXp };
// C.SPELLS is the active class's kit (the game pane sets the class each frame).
Object.defineProperty(module.exports, 'SPELLS', { enumerable: true, get: () => kitFor() });
Object.defineProperty(module.exports, 'activeClass', { enumerable: true, get: () => activeCls || 'mage' });
