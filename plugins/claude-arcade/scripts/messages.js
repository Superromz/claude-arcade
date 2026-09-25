// Flavor text. Every pool is picked at random so toasts and the quest log
// don't repeat themselves. {x} placeholders are filled by say().
// Pools keyed by a sub name (summon by class, chest by tier) take it as
// say()'s last argument: say(theme, 'chest', { gold }, 'epic').
'use strict';

const MESSAGES = {
  rpg: {
    welcome: [
      'The tavern door creaks open. {title} {name} returns — Lv {lvl}, {streak}-day streak.',
      'Lv {lvl} {title} steps into the dungeon. The bugs tremble. ({streak}-day streak)',
      'A {title} of level {lvl} approaches. Roll for initiative! ({streak}-day streak)',
      'The innkeeper nods. "The usual, {title}?" Lv {lvl}, {streak}-day streak.',
      'Torches flare as a Lv {lvl} {title} enters. ({streak}-day streak)',
      'The quest board rustles. A {title} (Lv {lvl}) is back in town. ({streak}-day streak)',
      'Somewhere, a null pointer shivers. Lv {lvl} {title} has arrived. ({streak}-day streak)',
      'The guild bell rings for a Lv {lvl} {title}. {streak}-day streak and counting.',
      'Boots laced, sword sharpened, linter armed. Lv {lvl} {title}, {streak}-day streak.',
    ],
    quest: [
      'Quest complete! {summary}',
      'The dungeon falls silent. {summary}',
      'Victory! The bards will sing of this. {summary}',
      'Loot secured. {summary}',
      'Another boss down. {summary}',
      'The village is saved (for now). {summary}',
      'Bugs flee before you. {summary}',
      'The quest giver is pleased. {summary}',
      'Tests pass. The oracle smiles. {summary}',
      'You return to the tavern a hero. {summary}',
      'The scroll is sealed and delivered. {summary}',
      'Not a single goblin left standing. {summary}',
      'The dragon of legacy code retreats. {summary}',
      'Mark it in the chronicle. {summary}',
      'The castle gates open for you. {summary}',
    ],
    questQuick: [
      'A quick errand, done. +{xp} XP',
      'Swift as an elven arrow. +{xp} XP',
      'Barely broke a sweat. +{xp} XP',
      'In and out before the ale went warm. +{xp} XP',
      'A side quest, dispatched. +{xp} XP',
      'The squire could have done it. You did it faster. +{xp} XP',
      'One swing, one goblin. +{xp} XP',
      'Done before the bard finished tuning. +{xp} XP',
      'A trivial trial. +{xp} XP',
    ],
    flawless: [
      'FLAWLESS — not a scratch!',
      'Untouched. The healers are bored.',
      'Not one failed spell. Legendary.',
      'Zero errors. The linter weeps with joy.',
      'Clean run! Your armor still shines.',
      'Perfect form. The trainers take notes.',
    ],
    scarred: [
      'Took {hits} but still standing.',
      'Bloodied but victorious ({hits}).',
      'Scarred by {hits}, wiser for it.',
      'A few stack traces to remember ({hits}).',
      'Took {hits}. The cleric sends the bill.',
      'Battered by {hits}, but the quest is done.',
    ],
    levelUp: [
      '✨ LEVEL UP ✨ Lv {lvl}! You are now a {title}.',
      '✨ DING! Lv {lvl} — the guild names you {title}.',
      '✨ Power surges through you. Lv {lvl}: {title}!',
      '✨ The runes glow. Lv {lvl} — rise, {title}!',
      '✨ The bards need a new verse: Lv {lvl} {title}!',
      '✨ Your stats swell. Lv {lvl}, {title}.',
      '✨ A new rank is carved on your shield: Lv {lvl} {title}.',
      '✨ LEVEL UP! Lv {lvl}. The bugs whisper of a {title}.',
      '✨ The oracle foresaw this. Lv {lvl}: {title}.',
    ],
    achievement: [
      '🏅 Achievement unlocked: {name} — {desc}',
      '🏅 A new trophy for the wall: {name} ({desc})',
      '🏅 The guild records your deed: {name} — {desc}',
      '🏅 {name}! The bards add a verse ({desc})',
      '🏅 Trophy earned: {name} — {desc}',
      '🏅 Heralds announce: {name} ({desc})',
    ],
    summon: {
      Mage: [
        '🧙 A Mage answers the summons: {desc}',
        '🧙 Arcane smoke clears — a Mage appears: {desc}',
        '🧙 A Mage adjusts their hat and gets to work: {desc}',
        '🧙 A Mage rolls up their sleeves (and their scrolls): {desc}',
        '🧙 A Mage steps through a portal, coffee in hand: {desc}',
        '🧙 The Mage mutters "trust me" and starts casting: {desc}',
      ],
      Ranger: [
        '🏹 A Ranger slips out of the shadows to scout: {desc}',
        '🏹 The Ranger nocks an arrow and heads off: {desc}',
        '🏹 A Ranger reads the tracks through the codebase: {desc}',
        '🏹 A Ranger vanishes into the file tree: {desc}',
        '🏹 The Ranger whistles for a hawk and moves out: {desc}',
        '🏹 A Ranger checks the map and sets off: {desc}',
      ],
      Knight: [
        '🛡 A Knight raises their shield: {desc}',
        '🛡 A Knight swears an oath to protect you: {desc}',
        '🛡 A Knight stands guard over the tests: {desc}',
        '🛡 A Knight polishes their armor and inspects the walls: {desc}',
        '🛡 A Knight salutes and takes the watch: {desc}',
        '🛡 A Knight draws steel against regressions: {desc}',
      ],
      Warlock: [
        '🔮 A Warlock steps from a violet rift: {desc}',
        '🔮 The Warlock mutters a dark pact: {desc}',
        '🔮 A Warlock gazes into the architecture: {desc}',
        '🔮 A Warlock sketches runes on the battle map: {desc}',
        '🔮 The Warlock consults a very old diagram: {desc}',
        '🔮 A Warlock bargains with the dependency graph: {desc}',
      ],
      Bard: [
        '🎵 A Bard strikes a rousing chord: {desc}',
        '🎵 A Bard joins, humming a battle hymn: {desc}',
        '🎵 A Bard unrolls a fresh scroll and a quill: {desc}',
        '🎵 A Bard promises to write this all down: {desc}',
        '🎵 The Bard tunes up and starts taking notes: {desc}',
        '🎵 A Bard arrives, already composing the README: {desc}',
      ],
      Rogue: [
        '🗡 A Rogue drops from the rafters: {desc}',
        '🗡 A Rogue flips a dagger and grins: {desc}',
        '🗡 A Rogue picks the lock on the bug: {desc}',
        '🗡 A Rogue slips into the shell unseen: {desc}',
        '🗡 The Rogue cracks their knuckles: {desc}',
        '🗡 A Rogue whispers "leave this one to me": {desc}',
      ],
    },
    partyFull: [
      'The party is {n} strong!',
      '{n} heroes march together!',
      'A fellowship of {n}!',
      '{n} adventurers share one campfire.',
      'The tavern table now seats {n}.',
      '{n} banners fly over the camp!',
    ],
    faint: [
      '💀 You fainted! A passing cleric revives you at full HP.',
      '💀 Knocked out! You wake up in the tavern, fully healed.',
      '💀 The stack trace was too long. A healer patches you up.',
      '💀 Down, but not out. A potion appears in your hand. Full HP!',
      '💀 The merge conflict curse strikes! You respawn at the shrine.',
      '💀 You see a bright light... it\'s the CI dashboard. Back to full HP.',
    ],
    bountyDone: [
      '📜 Bounty complete: {name}! +{gold} gold',
      '📜 The quest board pays out: {name} (+{gold} gold)',
      '📜 {name} — done. The guild hands you {gold} gold.',
      '📜 A sealed purse for {name}: {gold} gold!',
      '📜 Bounty claimed: {name}. The coffers grow by {gold}.',
      '📜 The bounty master grunts approval. {name}: +{gold} gold',
    ],
    chest: {
      wooden: [
        '📦 A wooden chest creaks open: {gold} gold.',
        '📦 Splinters and {gold} gold. Not bad.',
        '📦 A humble crate. Inside: {gold} gold and a rubber duck.',
      ],
      iron: [
        '🧰 An iron chest clanks open: {gold} gold!',
        '🧰 The iron lock gives way. {gold} gold inside.',
        '🧰 Heavy, rusty, and holding {gold} gold.',
      ],
      gold: [
        '💰 A golden chest! {gold} gold spills out.',
        '💰 It glitters. {gold} gold, polished and shiny.',
        '💰 A chest of gold, full of gold. {gold} of it!',
      ],
      epic: [
        '💎 An EPIC chest bursts with light: {gold} gold!',
        '💎 Violet flames lick the lid. {gold} gold within!',
        '💎 The chest hums with power. {gold} gold and a strange aura.',
      ],
      legendary: [
        '👑 A LEGENDARY chest! The heavens sing. {gold} gold!',
        '👑 The legendary chest opens with a choir. {gold} gold!',
        '👑 Bards will argue about this chest for ages. {gold} gold!',
      ],
    },
    bossIntro: [
      '☠ {boss} rises from the depths!',
      '☠ The ground shakes. {boss} approaches!',
      '☠ A shadow falls over the dungeon: {boss}!',
      '☠ {boss} crawls out of the legacy code!',
      '☠ Roll for initiative — {boss} is here!',
      '☠ {boss} has entered the chat.',
    ],
    bossDefeated: [
      '🏆 {boss} is defeated! +{xp} XP',
      '🏆 {boss} falls. The realm cheers! +{xp} XP',
      '🏆 {boss} has been refactored out of existence. +{xp} XP',
      '🏆 The bards will sing of how {boss} fell. +{xp} XP',
      '🏆 {boss} crumbles to dust. +{xp} XP',
      '🏆 Boss down! {boss} won\'t trouble prod again. +{xp} XP',
    ],
  },
  space: {
    welcome: [
      'Captain on deck. {title} rank, Lv {lvl}. ({streak}-day streak)',
      'Systems online. Welcome back, {title} (Lv {lvl}, {streak}-day streak).',
      'Airlock cycling... {title} aboard. Lv {lvl}, {streak}-day streak.',
      'Bridge lights up for a Lv {lvl} {title}. ({streak}-day streak)',
      'All hands, the {title} has the conn. Lv {lvl}, {streak}-day streak.',
      'Reactor warm, coffee warmer. Lv {lvl} {title} reporting. ({streak}-day streak)',
    ],
    quest: [
      'Mission accomplished. {summary}',
      'Returning to base. {summary}',
      'Sector secured. {summary}',
      'Objective complete. {summary}',
      'Houston, we have no problem. {summary}',
      'Mission log updated. {summary}',
      'The fleet salutes you. {summary}',
      'Clean landing. {summary}',
      'Transmission received: success. {summary}',
    ],
    questQuick: [
      'Quick jump, done. +{xp} XP',
      'In and out at warp speed. +{xp} XP',
      'A short hop across the sector. +{xp} XP',
      'Mission time: one blink. +{xp} XP',
      'Autopilot could not have done it faster. +{xp} XP',
      'Routine patrol, complete. +{xp} XP',
    ],
    flawless: [
      'Zero hull damage.',
      'Shields never dropped.',
      'Every system green.',
      'Not a single warning light.',
      'Textbook flight. The academy wants the recording.',
      'Pristine hull, pristine build.',
    ],
    scarred: [
      'Hull took {hits}.',
      'Minor damage ({hits}) — nothing duct tape can\'t fix.',
      'Shields absorbed {hits}.',
      'Took {hits}. Engineering is on it.',
      '{hits} logged. The repair drones sigh.',
      'Some scorch marks ({hits}), mission intact.',
    ],
    levelUp: [
      '🎖 PROMOTION! Lv {lvl} — {title}.',
      '🎖 Starfleet promotes you to {title} (Lv {lvl}).',
      '🎖 New insignia pinned: Lv {lvl} {title}.',
      '🎖 Command confirms: Lv {lvl}, rank {title}.',
      '🎖 The crew cheers! Lv {lvl} {title}.',
      '🎖 Clearance upgraded. Lv {lvl}: {title}.',
    ],
    achievement: [
      '🎖 Commendation earned: {name} — {desc}',
      '🎖 Medal awarded: {name} ({desc})',
      '🎖 Added to your service record: {name} — {desc}',
    ],
    summon: {
      Mage: ['🧙 A science officer beams aboard: {desc}', '🧙 The science officer calibrates the lab: {desc}', '🧙 A science officer runs the numbers: {desc}'],
      Ranger: ['🔭 Scout ship away: {desc}', '🔭 A scout pilot launches into the unknown: {desc}', '🔭 Scout drone deployed to map the sector: {desc}'],
      Knight: ['🛡 Security team deployed: {desc}', '🛡 A security officer checks every airlock: {desc}', '🛡 Security runs a full diagnostic: {desc}'],
      Warlock: ['🔮 A void navigator joins the bridge: {desc}', '🔮 The void navigator plots a strange course: {desc}', '🔮 A void navigator reads the star charts: {desc}'],
      Bard: ['📡 Comms officer on the line: {desc}', '📡 The comms officer opens a channel: {desc}', '📡 A comms officer starts the mission log: {desc}'],
      Rogue: ['🗡 A stealth pilot slips into the hangar: {desc}', '🗡 A stealth pilot goes dark: {desc}', '🗡 The stealth pilot hotwires a shuttle: {desc}'],
    },
    partyFull: ['Fleet strength: {n} ships.', '{n} ships in formation.', 'Squadron of {n}, ready.'],
    faint: [
      '☄ Hull breach! Emergency repairs complete.',
      '☄ Reactor scram! Systems rebooted at full power.',
      '☄ Life support failing... restored. Shields back to full.',
    ],
    bountyDone: [
      '📡 Contract fulfilled: {name}. +{gold} gold',
      '📡 Command pays out for {name}: {gold} gold.',
      '📡 Bounty transmitted: {name}. {gold} gold received.',
    ],
    chest: {
      wooden: ['📦 A supply crate: {gold} gold.', '📦 Salvage pod recovered: {gold} gold.', '📦 A dented cargo box. {gold} gold inside.'],
      iron: ['🧰 A steel cargo pod: {gold} gold!', '🧰 Armored container cracked: {gold} gold.', '🧰 Freighter strongbox: {gold} gold.'],
      gold: ['💰 A gilded cache: {gold} gold!', '💰 Treasure beacon found: {gold} gold.', '💰 A smuggler\'s stash: {gold} gold!'],
      epic: ['💎 An alien relic! {gold} gold!', '💎 A crystal vault hums open: {gold} gold.', '💎 Precursor tech! {gold} gold.'],
      legendary: ['👑 A LEGENDARY derelict! {gold} gold!', '👑 The lost flagship\'s vault: {gold} gold!', '👑 A star-forged chest. {gold} gold!'],
    },
    bossIntro: [
      '☠ Warning: {boss} on intercept course!',
      '☠ Red alert! {boss} decloaks off the bow!',
      '☠ Sensors spike. {boss} emerges from the nebula!',
      '☠ Incoming: {boss}. All hands to battle stations!',
    ],
    bossDefeated: [
      '🏆 {boss} destroyed! +{xp} XP',
      '🏆 {boss} drifts apart in the void. +{xp} XP',
      '🏆 Threat neutralized: {boss}. +{xp} XP',
      '🏆 The fleet cheers as {boss} falls. +{xp} XP',
    ],
  },
  retro: {
    welcome: [
      'PLAYER 1 READY. LV {lvl} {title}. STREAK {streak}.',
      'INSERT COIN... LV {lvl} {title} CONTINUES! STREAK {streak}.',
      'PRESS START. LV {lvl} {title}. STREAK {streak}.',
      'LOADING SAVE... LV {lvl} {title}, STREAK {streak}.',
      'A NEW CHALLENGER! LV {lvl} {title}. STREAK {streak}.',
      'CONTINUE? YES. LV {lvl} {title}. STREAK {streak}.',
    ],
    quest: [
      'STAGE CLEAR! {summary}',
      'COURSE CLEAR! {summary}',
      'YOU WIN! {summary}',
      'LEVEL COMPLETE! {summary}',
      'GOAL! {summary}',
      'BONUS STAGE! {summary}',
      'THANK YOU PLAYER! {summary}',
      'CHECKPOINT! {summary}',
      'ROUND CLEAR! {summary}',
    ],
    questQuick: [
      'SPEEDRUN! +{xp} PTS',
      'PERFECT TIME! +{xp} PTS',
      'WARP ZONE! +{xp} PTS',
      'ANY% CLEAR! +{xp} PTS',
      'TIME BONUS! +{xp} PTS',
      'SKIP! +{xp} PTS',
    ],
    flawless: ['NO DAMAGE BONUS!', 'PERFECT!', 'NO MISS!', 'FLAWLESS VICTORY!', 'FULL HP BONUS!', 'DEATHLESS!'],
    scarred: ['{hits} TAKEN.', 'OUCH! {hits}.', '{hits} TAKEN. STILL ALIVE.', 'DAMAGE: {hits}.', '{hits} TAKEN. NO CONTINUE USED.', 'SURVIVED {hits}.'],
    levelUp: [
      '*** LEVEL UP! LV {lvl} {title} ***',
      '*** 1UP! LV {lvl} {title} ***',
      '*** POWER UP! LV {lvl} {title} ***',
      '*** NEW RANK! LV {lvl} {title} ***',
      '*** HIGH SCORE! LV {lvl} {title} ***',
      '*** EXTRA LIFE! LV {lvl} {title} ***',
    ],
    achievement: [
      '*** BONUS: {name} - {desc} ***',
      '*** SECRET FOUND: {name} - {desc} ***',
      '*** ACHIEVEMENT: {name} - {desc} ***',
    ],
    summon: {
      MAGE: ['{desc} - MAGE JOINS!', 'MAGE ENTERS THE GAME: {desc}', 'P2 PICKS MAGE: {desc}'],
      RANGER: ['{desc} - RANGER JOINS!', 'RANGER ENTERS THE GAME: {desc}', 'P2 PICKS RANGER: {desc}'],
      KNIGHT: ['{desc} - KNIGHT JOINS!', 'KNIGHT ENTERS THE GAME: {desc}', 'P2 PICKS KNIGHT: {desc}'],
      WARLOCK: ['{desc} - WARLOCK JOINS!', 'WARLOCK ENTERS THE GAME: {desc}', 'P2 PICKS WARLOCK: {desc}'],
      BARD: ['{desc} - BARD JOINS!', 'BARD ENTERS THE GAME: {desc}', 'P2 PICKS BARD: {desc}'],
      ROGUE: ['{desc} - ROGUE JOINS!', 'ROGUE ENTERS THE GAME: {desc}', 'P2 PICKS ROGUE: {desc}'],
    },
    partyFull: ['{n} PLAYER CO-OP!', '{n}P MODE!', 'PARTY OF {n}!'],
    faint: [
      'GAME OVER... CONTINUE? YES. HP RESTORED.',
      'YOU DIED. RESPAWNING... HP FULL.',
      'K.O.! EXTRA LIFE USED. HP RESTORED.',
    ],
    bountyDone: ['BOUNTY CLEAR: {name} +{gold} G', 'MISSION BONUS: {name} +{gold} G', 'CHALLENGE MET: {name} +{gold} G'],
    chest: {
      wooden: ['WOOD CHEST: +{gold} G', 'SMALL CHEST: +{gold} G', 'CRATE: +{gold} G'],
      iron: ['IRON CHEST: +{gold} G', 'METAL CHEST: +{gold} G!', 'LOCKED CHEST OPENED: +{gold} G'],
      gold: ['GOLD CHEST: +{gold} G!', 'SHINY CHEST: +{gold} G!', 'TREASURE: +{gold} G!'],
      epic: ['EPIC CHEST!! +{gold} G', 'RARE DROP!! +{gold} G', 'MEGA CHEST!! +{gold} G'],
      legendary: ['*** LEGENDARY CHEST *** +{gold} G', '*** JACKPOT *** +{gold} G', '*** 777 *** +{gold} G'],
    },
    bossIntro: ['WARNING! {boss} APPROACHING!', 'BOSS FIGHT: {boss}!', 'HERE COMES {boss}!', 'READY? {boss} - FIGHT!'],
    bossDefeated: ['{boss} DEFEATED! +{xp} PTS', 'BOSS CLEAR: {boss}! +{xp} PTS', 'K.O.! {boss} +{xp} PTS', 'YOU BEAT {boss}! +{xp} PTS'],
  },
};

// Agents join as one of the six hero classes. The agent's role picks the
// class; general-purpose agents get one from a hash of their id, so a batch
// of them becomes a mixed party.
const COMPANION_ROLES = [
  [/explore|search|find|scout/i, 'ranger'],
  [/review|audit|security|test|verif|qa/i, 'knight'],
  [/plan|architect|design|workflow/i, 'warlock'],
  [/guide|doc|research|writ|summar/i, 'bard'],
  [/debug|fix|bash|shell|ops|deploy/i, 'rogue'],
];
const CLASS_IDS = ['mage', 'ranger', 'knight', 'warlock', 'bard', 'rogue'];
const CLASS_INFO = {
  mage: ['🧙', 'Mage'], ranger: ['🏹', 'Ranger'], knight: ['🛡', 'Knight'],
  warlock: ['🔮', 'Warlock'], bard: ['🎵', 'Bard'], rogue: ['🗡', 'Rogue'],
};

function classFor(themeName, kind, id = '') {
  const hit = COMPANION_ROLES.find(([re]) => re.test(kind || ''));
  let cls = hit && hit[1];
  if (!cls) {
    let h = 0;
    for (const ch of String(id || kind)) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
    cls = CLASS_IDS[h % CLASS_IDS.length];
  }
  const [icon, name] = CLASS_INFO[cls];
  return { id: cls, icon: themeName === 'retro' ? `[${name[0]}]` : icon, name: themeName === 'retro' ? name.toUpperCase() : name };
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
