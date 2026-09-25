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
  // +1 per 10 combo, capped so long streaks of cheap tools can't snowball
  // (+3 per tool call, Rogues double up to +5).
  const comboBonus = Math.floor((combo || 0) / 10);
  return xp + (ch && ch.cls === 'rogue' ? Math.min(5, comboBonus * 2) : Math.min(3, comboBonus));
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
// `seen` (optional, an array kept in state.tokenSeen) remembers the last
// 5,000 message ids across sessions, so a resumed or forked transcript that
// copies old messages never counts them twice.
function readTokens(file, offsets, key, seen) {
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
    const found = new Map();
    for (const line of text.slice(0, end).split('\n')) {
      if (!line.includes('"usage"')) continue;
      try {
        const msg = JSON.parse(line).message;
        if (msg && msg.usage) found.set(msg.id || line.length + Math.random(), msg.usage);
      } catch {}
    }
    const prior = Array.isArray(seen) ? new Set(seen) : null;
    for (const [id, u] of found) {
      if (prior && typeof id === 'string') { if (prior.has(id)) continue; prior.add(id); seen.push(id); }
      res.input += (u.input_tokens || 0) + (u.cache_creation_input_tokens || 0);
      res.output += u.output_tokens || 0;
    }
    if (Array.isArray(seen) && seen.length > 5000) seen.splice(0, seen.length - 5000);
  } catch {} finally { if (fd !== undefined) try { fs.closeSync(fd); } catch {} }
  return res;
}

// Class skill kits: every class has its basic attack plus eleven skills that
// unlock at Lv 3/5/8/12/18/25/30/40/50/60 and an ultimate at Lv 75. `modes`
// are the tool activities that prefer the skill; `cd` is the hotbar cooldown
// in ticks (10 per second); `el` is the element monsters may resist or be
// weak to. `def` marks defensive skills (cast when the hero is hurt), `ult`
// the ultimate. `kind` picks the effect for skills added after Lv 18 (see
// battle.js useSkill). Damage scales with level and the class's main stat.
// Skill ids are unique across classes.
const UNLOCKS = [1, 3, 5, 8, 12, 18, 25, 30, 40, 50, 60, 75];
const ELEMENTS = ['fire', 'frost', 'lightning', 'shadow', 'holy', 'physical'];
const kit = (list) => list.map((s, i) => ({ lvl: UNLOCKS[i], el: 'physical', ...s }));
const KITS = {
  mage: kit([
    { id: 'basic', name: 'Arcane Spark', dmg: 5, cd: 6, el: 'lightning', modes: [], desc: 'A quick bolt of arcane light.' },
    { id: 'fireball', name: 'Fireball', dmg: 9, cd: 30, aoe: 8, burn: true, el: 'fire', modes: ['editing', 'planning'], desc: 'Explodes on impact and sets monsters on fire.' },
    { id: 'frost', name: 'Frost Nova', dmg: 7, cd: 30, nova: 18, freeze: 40, el: 'frost', modes: ['reading', 'searching'], desc: 'A ring of ice that freezes nearby monsters.' },
    { id: 'chain', name: 'Chain Lightning', dmg: 7, cd: 50, chain: 3, el: 'lightning', modes: ['running'], desc: 'Jumps between up to 3 monsters.' },
    { id: 'meteor', name: 'Meteor', dmg: 18, cd: 90, aoe: 16, burn: true, el: 'fire', modes: ['web', 'summoning'], desc: 'A falling star that scorches a wide area.' },
    { id: 'starfall', name: 'Starfall', dmg: 10, cd: 150, all: true, el: 'holy', modes: ['thinking'], desc: 'Stars rain down on every monster.' },
    { id: 'barrier', name: 'Arcane Barrier', dmg: 0, cd: 200, def: true, kind: 'barrier', frac: 0.35, dur: 100, el: 'lightning', modes: ['planning'], desc: 'A shimmering shield that absorbs 35% of your HP in damage.' },
    { id: 'blizzard', name: 'Blizzard', dmg: 4, cd: 120, kind: 'storm', style: 'snow', ticks: 8, every: 5, area: 30, onHit: { freeze: 20 }, el: 'frost', modes: ['reading', 'searching'], desc: 'A snowstorm that chills and freezes an area.' },
    { id: 'orb', name: 'Ball Lightning', dmg: 5, cd: 120, kind: 'orb', sb: 2, el: 'lightning', modes: ['running'], desc: 'A crackling orb drifts across the field, zapping everything near it.' },
    { id: 'inferno', name: 'Inferno', dmg: 14, cd: 150, kind: 'storm', style: 'inferno', ticks: 3, every: 5, area: 'all', onHit: { burn: true }, el: 'fire', modes: ['editing'], desc: 'Pillars of fire erupt under every monster.' },
    { id: 'timewarp', name: 'Time Warp', dmg: 0, cd: 250, def: true, kind: 'control', freeze: 50, heal: 0.2, style: 'clock', el: 'frost', modes: ['thinking'], desc: 'Stops time for every monster and mends 20% of your HP.' },
    { id: 'cataclysm', name: 'Arcane Cataclysm', dmg: 55, cd: 400, ult: true, kind: 'cataclysm', sb: 3, el: 'lightning', modes: ['summoning', 'web'], desc: 'Ultimate. The sky splits and arcane fire hits every monster.' },
  ]),
  ranger: kit([
    { id: 'basic', name: 'Arrow', dmg: 5, cd: 6, modes: [], desc: 'A swift arrow.' },
    { id: 'multishot', name: 'Multishot', dmg: 6, cd: 30, targets: 3, modes: ['reading', 'searching'], desc: 'Looses an arrow at up to 3 monsters.' },
    { id: 'snare', name: 'Snare Trap', dmg: 8, cd: 30, root: 40, modes: ['editing', 'planning'], desc: 'A trap that snaps shut and roots a monster.' },
    { id: 'pierce', name: 'Piercing Arrow', dmg: 11, cd: 50, pierce: true, sb: 2, modes: ['running'], desc: 'Passes through every monster in its path.' },
    { id: 'rain', name: 'Rain of Arrows', dmg: 5, cd: 90, volleys: 4, aoe: 22, modes: ['web', 'summoning'], desc: 'Volleys of arrows fall on a wide area.' },
    { id: 'eagle', name: 'Eagle Strike', dmg: 14, cd: 150, all: true, critBonus: 0.3, modes: ['thinking'], desc: 'Your eagle dives through every monster.' },
    { id: 'secondwind', name: 'Second Wind', dmg: 0, cd: 200, def: true, kind: 'heal', heal: 0.15, regen: 0.15, style: 'leaves', el: 'holy', modes: ['planning'], desc: 'Catch your breath: heal 15% now and 15% more over 5 s.' },
    { id: 'explosive', name: 'Explosive Arrow', dmg: 16, cd: 90, kind: 'volley', n: 1, aoe: 14, onHit: { burn: true }, shot: 'bomb', el: 'fire', modes: ['editing'], desc: 'An arrow that bursts into flame on impact.' },
    { id: 'frostvolley', name: 'Frost Volley', dmg: 8, cd: 120, kind: 'volley', n: 5, onHit: { freeze: 30 }, shot: 'ice', el: 'frost', modes: ['reading', 'searching'], desc: 'Five ice arrows that freeze what they hit.' },
    { id: 'wolves', name: 'Wolf Pack', dmg: 10, cd: 180, kind: 'pets', pet: 'wolf', n: 2, dur: 100, modes: ['summoning', 'web'], desc: 'Two wolves join the hunt for 10 s.' },
    { id: 'stormarrow', name: 'Storm Arrow', dmg: 18, cd: 120, kind: 'pierce', chainBolt: true, sb: 2, el: 'lightning', modes: ['running'], desc: 'A piercing arrow that arcs lightning from every monster it passes.' },
    { id: 'thousand', name: 'Thousand Arrows', dmg: 10, cd: 400, ult: true, kind: 'storm', style: 'arrows', ticks: 12, every: 3, area: 'all', sb: 3, modes: ['thinking'], desc: 'Ultimate. The sky goes dark with arrows over the whole field.' },
  ]),
  knight: kit([
    { id: 'basic', name: 'Sword Wave', dmg: 5, cd: 6, modes: [], desc: 'A wave of steel.' },
    { id: 'bash', name: 'Shield Bash', dmg: 10, cd: 30, stun: 20, sb: 2, modes: ['editing'], desc: 'Slams the front monster and stuns it.' },
    { id: 'taunt', name: 'Taunt', dmg: 4, cd: 30, all: true, taunt: 60, modes: ['reading', 'searching', 'planning'], desc: 'Every monster attacks your shield instead of you.' },
    { id: 'whirl', name: 'Whirlwind', dmg: 9, cd: 50, near: 34, modes: ['running'], desc: 'Spins through every monster close to you.' },
    { id: 'holy', name: 'Holy Strike', dmg: 20, cd: 90, heal: 0.05, el: 'holy', modes: ['web', 'summoning'], desc: 'A pillar of light smites one monster and mends 5% of your HP.' },
    { id: 'judgment', name: 'Judgment', dmg: 12, cd: 150, all: true, stun: 15, el: 'holy', modes: ['thinking'], desc: 'Hammers of light fall on every monster.' },
    { id: 'shieldwall', name: 'Tower Shield', dmg: 0, cd: 200, def: true, kind: 'guard', dr: 0.6, dur: 80, modes: ['reading', 'searching'], desc: 'Raise a tower shield: take 60% less damage for 8 s, and every monster is taunted.' },
    { id: 'layhands', name: 'Lay on Hands', dmg: 0, cd: 250, def: true, kind: 'heal', heal: 0.35, style: 'holy', el: 'holy', modes: ['planning'], desc: 'Heal 35% of your HP at once.' },
    { id: 'consecrate', name: 'Consecration', dmg: 6, cd: 150, kind: 'storm', style: 'runes', ticks: 10, every: 5, area: 'near', el: 'holy', modes: ['editing'], desc: 'Holy ground burns every monster standing near you.' },
    { id: 'groundslam', name: 'Ground Slam', dmg: 20, cd: 150, kind: 'slam', near: 50, onHit: { stun: 25 }, sb: 2, modes: ['running'], desc: 'A shockwave that stuns everything close.' },
    { id: 'wrath', name: 'Avenging Wrath', dmg: 0, cd: 300, def: true, kind: 'buff', buffDmg: 0.5, lifesteal: 0.04, dur: 100, style: 'wings', el: 'holy', modes: ['web', 'summoning'], desc: 'Wings of light: +50% damage and lifesteal for 10 s.' },
    { id: 'divinestorm', name: 'Divine Storm', dmg: 22, cd: 400, ult: true, kind: 'storm', style: 'swords', ticks: 3, every: 6, area: 'all', heal: 0.08, sb: 3, el: 'holy', modes: ['thinking'], desc: 'Ultimate. Swords of light fall three times on every monster and heal you.' },
  ]),
  warlock: kit([
    { id: 'basic', name: 'Shadow Bolt', dmg: 5, cd: 6, el: 'shadow', modes: [], desc: 'A bolt of shadow.' },
    { id: 'curse', name: 'Curse', dmg: 4, cd: 30, curse: 48, el: 'shadow', modes: ['summoning', 'planning'], desc: 'Withers a monster with damage over time.' },
    { id: 'drain', name: 'Drain Life', dmg: 8, cd: 30, heal: 0.06, el: 'shadow', modes: ['reading', 'searching'], desc: 'Steals life from a monster and heals you.' },
    { id: 'imp', name: 'Summon Imp', dmg: 6, cd: 50, imp: 80, el: 'fire', modes: ['running'], desc: 'An imp joins the fight and hurls fire.' },
    { id: 'shadowflame', name: 'Shadowflame', dmg: 12, cd: 90, aoe: 14, burn: true, el: 'shadow', modes: ['web', 'editing'], desc: 'A cone of black fire that burns.' },
    { id: 'doom', name: 'Doom', dmg: 8, cd: 150, doom: 30, el: 'shadow', modes: ['thinking'], desc: 'Dooms a monster; it explodes a moment later.' },
    { id: 'darkpact', name: 'Dark Pact', dmg: 0, cd: 200, def: true, kind: 'barrier', frac: 0.3, dur: 100, style: 'dark', el: 'shadow', modes: ['planning'], desc: 'A shield of shadow that absorbs 30% of your HP in damage.' },
    { id: 'fear', name: 'Fear', dmg: 5, cd: 150, kind: 'control', stun: 30, push: 8, el: 'shadow', modes: ['reading', 'searching'], desc: 'Every monster flees in terror for 3 s.' },
    { id: 'firerain', name: 'Rain of Fire', dmg: 8, cd: 120, kind: 'storm', style: 'firerain', ticks: 8, every: 4, area: 30, onHit: { burn: true }, el: 'fire', modes: ['editing'], desc: 'Burning stones rain on an area.' },
    { id: 'demon', name: 'Summon Demon', dmg: 22, cd: 240, kind: 'pets', pet: 'demon', n: 1, dur: 120, el: 'fire', modes: ['summoning', 'running'], desc: 'A hulking demon fights beside you for 12 s.' },
    { id: 'soulrot', name: 'Soul Rot', dmg: 6, cd: 180, kind: 'rot', curse: 60, heal: 0.01, el: 'shadow', modes: ['web'], desc: 'Curses every monster; each curse tick heals you a little.' },
    { id: 'oblivion', name: 'Oblivion', dmg: 60, cd: 400, ult: true, kind: 'blackhole', sb: 3, el: 'shadow', modes: ['thinking'], desc: 'Ultimate. A black hole drags every monster in, then collapses.' },
  ]),
  bard: kit([
    { id: 'basic', name: 'Power Chord', dmg: 5, cd: 6, el: 'lightning', modes: [], desc: 'A crunchy chord.' },
    { id: 'anthem', name: 'Anthem', dmg: 4, cd: 30, anthem: 80, el: 'holy', modes: ['planning', 'web'], desc: 'Rallies the party: +25% damage for a while.' },
    { id: 'discord', name: 'Discord', dmg: 6, cd: 30, aoe: 20, stun: 20, el: 'lightning', modes: ['reading', 'searching'], desc: 'A clashing note that stuns nearby monsters.' },
    { id: 'echo', name: 'Echo', dmg: 0, cd: 50, echo: true, el: 'holy', modes: ['running'], desc: 'Plays your last skill again.' },
    { id: 'crescendo', name: 'Crescendo', dmg: 14, cd: 90, near: 60, el: 'holy', modes: ['editing', 'summoning'], desc: 'A rising wave of sound across the field.' },
    { id: 'encore', name: 'Encore', dmg: 8, cd: 150, all: true, encore: true, el: 'holy', modes: ['thinking'], desc: 'Hits every monster and resets your cooldowns.' },
    { id: 'lullaby', name: 'Lullaby', dmg: 0, cd: 200, def: true, kind: 'control', stun: 40, heal: 0.1, style: 'sleep', el: 'holy', modes: ['planning'], desc: 'Sings every monster to sleep for 4 s and heals 10%.' },
    { id: 'hymn', name: 'Healing Hymn', dmg: 0, cd: 220, def: true, kind: 'heal', heal: 0.2, regen: 0.2, style: 'notes', el: 'holy', modes: ['reading', 'searching'], desc: 'Heal 20% now and 20% more over 5 s.' },
    { id: 'riff', name: 'Power Riff', dmg: 12, cd: 90, kind: 'chain', chain: 4, sb: 2, el: 'lightning', modes: ['running'], desc: 'A screaming solo that arcs through 4 monsters.' },
    { id: 'drumline', name: 'Drum Line', dmg: 10, cd: 150, kind: 'waves', n: 4, near: 60, onHit: { stun: 6 }, modes: ['editing'], desc: 'Four booming beats, each hitting and staggering monsters near you.' },
    { id: 'siren', name: 'Siren Song', dmg: 8, cd: 200, kind: 'charm', charm: 40, el: 'shadow', modes: ['web', 'summoning'], desc: 'Charms every monster: they turn and hit each other.' },
    { id: 'symphony', name: 'Symphony of Destruction', dmg: 28, cd: 400, ult: true, kind: 'waves', n: 3, near: 999, buffDmg: 0.5, dur: 100, sb: 3, el: 'holy', modes: ['thinking'], desc: 'Ultimate. Three walls of sound sweep the field, then the party deals +50% damage.' },
  ]),
  rogue: kit([
    { id: 'basic', name: 'Throwing Knife', dmg: 5, cd: 6, modes: [], desc: 'A thrown knife.' },
    { id: 'backstab', name: 'Backstab', dmg: 14, cd: 30, critBonus: 0.35, dash: true, sb: 2, modes: ['editing'], desc: 'Dashes behind a monster; likely to crit.' },
    { id: 'poison', name: 'Poison Blade', dmg: 5, cd: 30, poison: 50, el: 'shadow', modes: ['reading', 'searching'], desc: 'Coats your blade in poison.' },
    { id: 'smoke', name: 'Smoke Bomb', dmg: 6, cd: 50, aoe: 16, dodge: 60, modes: ['running'], desc: 'A cloud of smoke; you dodge every hit inside it.' },
    { id: 'shadowstep', name: 'Shadow Step', dmg: 16, cd: 90, targets: 2, el: 'shadow', modes: ['web', 'summoning', 'planning'], desc: 'Blinks between two monsters, striking both.' },
    { id: 'deathmark', name: 'Death Mark', dmg: 8, cd: 150, mark: 60, el: 'shadow', modes: ['thinking'], desc: 'Marks a monster: +50% damage taken, then it bursts.' },
    { id: 'vanish', name: 'Vanish', dmg: 0, cd: 200, def: true, kind: 'vanish', dodge: 60, heal: 0.1, el: 'shadow', modes: ['planning'], desc: 'Vanish for 6 s: dodge every hit, heal 10%, and your next hit crits.' },
    { id: 'fan', name: 'Fan of Knives', dmg: 10, cd: 90, kind: 'volley', n: 99, onHit: { bleed: true }, shot: 'knife', modes: ['reading', 'searching'], desc: 'Knives fly at every monster and make them bleed.' },
    { id: 'garrote', name: 'Garrote', dmg: 14, cd: 120, kind: 'dash', onHit: { stun: 30, bleed: true }, modes: ['editing'], desc: 'Strangle the front monster: stun and bleed.' },
    { id: 'bombs', name: 'Cluster Bomb', dmg: 14, cd: 150, kind: 'volley', n: 3, aoe: 12, onHit: { burn: true }, shot: 'bomb', el: 'fire', modes: ['running'], desc: 'Three bombs that burst into flames.' },
    { id: 'flurry', name: 'Blade Flurry', dmg: 7, cd: 150, kind: 'flurry', hits: 8, modes: ['web', 'summoning'], desc: 'Eight lightning-fast slashes on the front monster.' },
    { id: 'cuts', name: 'Thousand Cuts', dmg: 20, cd: 400, ult: true, kind: 'cuts', rounds: 3, sb: 3, el: 'shadow', modes: ['thinking'], desc: 'Ultimate. Blink through every monster three times.' },
  ]),
};
const BASIC_NAMES = Object.fromEntries(Object.entries(KITS).map(([k, v]) => [k, v[0].name]));

// The class the game is showing. The game pane sets it every frame; other
// callers can pass a class explicitly. Defaults to the mage kit.
let activeCls = null;
function setClass(cls) { if (KITS[cls]) activeCls = cls; return activeCls; }
const kitFor = (cls) => KITS[cls] || KITS[activeCls] || KITS.mage;
const skillById = (id, cls) => kitFor(cls).find((s) => s.id === id) || Object.values(KITS).flat().find((s) => s.id === id) || null;

// The skill a Claude activity casts. Mostly the newest known attack that
// matches the activity, sometimes the strongest known attack. Defensive
// skills and the ultimate are left to battle.js, which casts them when the
// hero is hurt or their cooldown allows.
function spellFor(lvl, mode, tick = 0, cls) {
  const known = kitFor(cls).filter((s) => s.lvl <= lvl);
  const attacks = known.filter((s) => !s.def && !s.ult);
  const preferred = attacks.filter((s) => s.modes.includes(mode));
  if (preferred.length && tick % 3 !== 0) return preferred[preferred.length - 1];
  return tick % 4 === 0 ? attacks[attacks.length - 1] : known[0];
}

// The six hotbar skills: a saved loadout (skill ids, unknown or locked ones
// skipped), else the basic attack plus the newest five known skills (or the
// next ones to unlock, so the hotbar shows what's coming).
function loadoutFor(lvl, cls, saved) {
  const k = kitFor(cls);
  const known = k.filter((s) => s.lvl <= lvl);
  let ids;
  if (Array.isArray(saved) && saved.length) {
    ids = saved.slice(0, 6).map((id) => (known.some((s) => s.id === id) ? id : null));
  } else if (known.length <= 6) ids = k.slice(0, 6).map((s) => s.id);
  else ids = [k[0].id, ...known.slice(-5).map((s) => s.id)];
  while (ids.length < 6) ids.push(null);
  // Empty slots take the next known skill that isn't equipped yet.
  const spare = (known.length > 6 ? [...known].reverse() : k).filter((s) => !ids.includes(s.id));
  return ids.map((id) => (id ? k.find((s) => s.id === id) : spare.shift() || null)).map((s) => s || k[0]);
}

function damage(spell, lvl, statValue) {
  return Math.round((spell.dmg ?? 5) * (1 + (lvl - 1) * 0.12) * (1 + statValue / 60));
}
// 1 XP per 150 output tokens and per 3,000 fresh input tokens.
const tokenXp = (u) => Math.floor(u.output / 150) + Math.floor(u.input / 3000);

module.exports = { KITS, UNLOCKS, ELEMENTS, BASIC_NAMES, setClass, kitFor, skillById, spellFor, loadoutFor, damage, CLASSES, COLORS, SKINS, HAIR, ACCESSORIES, defaultCharacter, getCharacter, xpFor, stats, readTokens, tokenXp };
// C.SPELLS is the active class's kit (the game pane sets the class each frame).
Object.defineProperty(module.exports, 'SPELLS', { enumerable: true, get: () => kitFor() });
Object.defineProperty(module.exports, 'activeClass', { enumerable: true, get: () => activeCls || 'mage' });
