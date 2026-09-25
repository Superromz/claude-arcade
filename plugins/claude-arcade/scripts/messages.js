// Flavor text. Every pool is picked at random so toasts and the quest log
// don't repeat themselves. {x} placeholders are filled by say().
'use strict';

const MESSAGES = {
  rpg: {
    welcome: [
      'The tavern door creaks open. {title} {name} returns — Lv {lvl}, {streak}-day streak.',
      'Lv {lvl} {title} steps into the dungeon. The bugs tremble. ({streak}-day streak)',
      'A {title} of level {lvl} approaches. Roll for initiative! ({streak}-day streak)',
    ],
    quest: [
      'Quest complete! {summary}',
      'The dungeon falls silent. {summary}',
      'Victory! The bards will sing of this. {summary}',
      'Loot secured. {summary}',
      'Another boss down. {summary}',
    ],
    questQuick: ['A quick errand, done. +{xp} XP', 'Swift as an elven arrow. +{xp} XP', 'Barely broke a sweat. +{xp} XP'],
    flawless: ['FLAWLESS — not a scratch!', 'Untouched. The healers are bored.'],
    scarred: ['Took {hits} but still standing.', 'Bloodied but victorious ({hits}).'],
    levelUp: [
      '✨ LEVEL UP ✨ Lv {lvl}! You are now a {title}.',
      '✨ DING! Lv {lvl} — the guild names you {title}.',
      '✨ Power surges through you. Lv {lvl}: {title}!',
    ],
    achievement: ['🏅 Achievement unlocked: {name} — {desc}', '🏅 A new trophy for the wall: {name} ({desc})'],
    summon: {
      Ranger: ['🏹 A Ranger slips out of the shadows to scout: {desc}', '🏹 The Ranger nocks an arrow and heads off: {desc}'],
      Sage: ['📜 A Sage unrolls the ancient maps: {desc}', '📜 The Sage strokes their beard and begins plotting: {desc}'],
      Paladin: ['🛡 A Paladin swears an oath to inspect: {desc}', '🛡 The Paladin raises their shield: {desc}'],
      Warrior: ['⚔ A Warrior charges into battle: {desc}', '⚔ The Warrior cracks their knuckles: {desc}'],
      Scholar: ['📚 A Scholar vanishes into the library: {desc}', '📚 The Scholar adjusts their spectacles: {desc}'],
      Mage: ['🧙 A Mage answers the summons: {desc}', '🧙 Arcane smoke clears — a Mage appears: {desc}'],
    },
    partyFull: ['The party is {n} strong!', '{n} heroes march together!'],
    faint: ['💀 You fainted! A passing cleric revives you at full HP.', '💀 Knocked out! You wake up in the tavern, fully healed.'],
  },
  space: {
    welcome: ['Captain on deck. {title} rank, Lv {lvl}. ({streak}-day streak)', 'Systems online. Welcome back, {title} (Lv {lvl}, {streak}-day streak).'],
    quest: ['Mission accomplished. {summary}', 'Returning to base. {summary}', 'Sector secured. {summary}'],
    questQuick: ['Quick jump, done. +{xp} XP', 'In and out at warp speed. +{xp} XP'],
    flawless: ['Zero hull damage.', 'Shields never dropped.'],
    scarred: ['Hull took {hits}.', 'Minor damage ({hits}) — nothing duct tape can\'t fix.'],
    levelUp: ['🎖 PROMOTION! Lv {lvl} — {title}.', '🎖 Starfleet promotes you to {title} (Lv {lvl}).'],
    achievement: ['🎖 Commendation earned: {name} — {desc}'],
    summon: {
      Scout: ['🔭 Scout ship away: {desc}'], Navigator: ['🧭 Navigator plotting: {desc}'],
      Security: ['🛡 Security team deployed: {desc}'], Drone: ['🛸 Drone launched: {desc}'],
    },
    partyFull: ['Fleet strength: {n} ships.'],
    faint: ['☄ Hull breach! Emergency repairs complete.'],
  },
  retro: {
    welcome: ['PLAYER 1 READY. LV {lvl} {title}. STREAK {streak}.', 'INSERT COIN... LV {lvl} {title} CONTINUES!'],
    quest: ['STAGE CLEAR! {summary}', 'COURSE CLEAR! {summary}', 'YOU WIN! {summary}'],
    questQuick: ['SPEEDRUN! +{xp} PTS', 'PERFECT TIME! +{xp} PTS'],
    flawless: ['NO DAMAGE BONUS!', 'PERFECT!'],
    scarred: ['{hits} TAKEN.'],
    levelUp: ['*** LEVEL UP! LV {lvl} {title} ***', '*** 1UP! LV {lvl} {title} ***'],
    achievement: ['*** BONUS: {name} - {desc} ***'],
    summon: { SCOUT: ['{desc} - SCOUT JOINS!'], PLANNER: ['{desc} - PLANNER JOINS!'], PLAYER: ['{desc} - PLAYER 2 JOINS!'] },
    partyFull: ['{n} PLAYER CO-OP!'],
    faint: ['GAME OVER... CONTINUE? YES. HP RESTORED.'],
  },
};

// Agent class per theme, picked from the agent type / name.
const CLASSES = {
  rpg: [
    [/explore|search|find/i, '🏹', 'Ranger'], [/plan|architect/i, '📜', 'Sage'],
    [/review|audit|security/i, '🛡', 'Paladin'], [/test|debug|fix/i, '⚔', 'Warrior'],
    [/guide|doc|research/i, '📚', 'Scholar'], [/.*/, '🧙', 'Mage'],
  ],
  space: [
    [/explore|search|find/i, '🔭', 'Scout'], [/plan|architect/i, '🧭', 'Navigator'],
    [/review|audit|security/i, '🛡', 'Security'], [/.*/, '🛸', 'Drone'],
  ],
  retro: [[/explore|search|find/i, '[S]', 'SCOUT'], [/plan|architect/i, '[P]', 'PLANNER'], [/.*/, '[2P]', 'PLAYER']],
};

function classFor(themeName, kind) {
  const [, icon, name] = (CLASSES[themeName] || CLASSES.rpg).find(([re]) => re.test(kind || ''));
  return { icon, name };
}

const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];

function say(themeName, key, vars = {}, sub) {
  const pool = MESSAGES[themeName] || MESSAGES.rpg;
  let list = pool[key];
  if (sub !== undefined) list = (list && (list[sub] || Object.values(list)[0])) || [];
  if (!list || !list.length) return '';
  return pick(list).replace(/\{(\w+)\}/g, (_, k) => (vars[k] ?? ''));
}

// "Forged 3 files, cast 2 spells, scouted 5 times" from per-turn counters.
const VERBS = {
  rpg: { editing: ['forged', 'file'], running: ['cast', 'spell'], reading: ['scouted', 'scroll'], searching: ['searched', 'room'], web: ['sent', 'eagle'], summoning: ['summoned', 'ally', 'allies'], planning: ['drew', 'map'] },
  space: { editing: ['repaired', 'module'], running: ['fired', 'thruster'], reading: ['scanned', 'sector'], searching: ['swept', 'grid'], web: ['hailed', 'station'], summoning: ['launched', 'drone'], planning: ['plotted', 'course'] },
  retro: { editing: ['BUILT', 'BLOCK'], running: ['RAN', 'LEVEL'], reading: ['READ', 'SIGN'], searching: ['FOUND', 'SECRET'], web: ['GOT', 'POWER-UP'], summoning: ['CALLED', 'PLAYER'], planning: ['LOADED', 'MAP'] },
};

function turnSummary(themeName, turn) {
  const v = VERBS[themeName] || VERBS.rpg;
  const parts = Object.entries(v)
    .filter(([k]) => turn[k])
    .sort((a, b) => turn[b[0]] - turn[a[0]])
    .slice(0, 3)
    .map(([k, [verb, one, many]]) => `${verb} ${turn[k]} ${turn[k] === 1 ? one : many || one + 's'}`);
  if (!parts.length) return '';
  const s = parts.join(', ');
  return s[0].toUpperCase() + s.slice(1);
}

module.exports = { MESSAGES, say, pick, classFor, turnSummary };
