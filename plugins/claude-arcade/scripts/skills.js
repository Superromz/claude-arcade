'use strict';
// Skill tree: three branches per class, eight nodes each: a capstone at
// tier 5, two more tiers (Lv 20 and 28) and an Awakened capstone (Lv 40). Points come from levels (1 per level) and bosses (1 per boss
// killed). Once every node is learned, extra points become paragon points
// for small, uncapped boosts. The tree lives in the active hero's
// state.game.skills, so it swaps with the hero. Nothing here grants XP.

const L = require('./lib');
const X = require('./pixel');
const C = require('./character');
const { RESET, BOLD, NOBOLD, fg, bg, ui, UI } = require('./state');

// ---------- data ----------

// Effects (per rank unless noted):
//   dmg {s, v}      skill s (or '*') deals +v damage
//   usage {m, v}    casts triggered by these Claude activities deal +v
//   cdr {s, v}      skill s cooldown -v
//   targets {s, v}  skill s hits v more monsters
//   crit {v}        +v crit chance
//   speed {v}       auto-attacks come v faster
//   dur {s, v}      skill s's stun/freeze/root/buff lasts +v longer
//   dot {v}         burn, curse, poison and bleed ticks deal +v
//   onhit {s, e}    skill s also applies e: burn, stun, bleed or lifesteal
//   heal {v}        healing +v (share)
//   hp {v}          max battle HP +v     dr {v}  damage taken -v
//   el {e, v}       element e deals +v   pen {v} ignore v of armor
//   sb {v}          shields break v faster
//   flag {f}        changes how a skill works (see battle.js)
const N = (name, max, desc, fx) => ({ name, max, desc, fx });
const TREES = {
  mage: [
    { name: 'Pyromancy', color: [255, 128, 56], nodes: [
      N('Kindling', 3, 'Fireball deals +15% damage.', [{ t: 'dmg', s: 'fireball', v: 0.15 }]),
      N('Searing Heat', 2, 'Burns deal +25% damage.', [{ t: 'dot', v: 0.25 }]),
      N('Firestarter', 2, 'Edits deal +15% damage.', [{ t: 'usage', m: ['editing'], v: 0.15 }]),
      N('Meteor Shower', 2, 'Meteor: -15% cooldown, +15% damage.', [{ t: 'cdr', s: 'meteor', v: 0.15 }, { t: 'dmg', s: 'meteor', v: 0.15 }]),
      N('Phoenix Fire', 1, 'Capstone. Fireball splits into 3 on impact.', [{ t: 'flag', f: 'fireballSplit' }]),
    ] },
    { name: 'Frost', color: [130, 206, 255], nodes: [
      N('Cold Snap', 3, 'Frost Nova deals +15% damage.', [{ t: 'dmg', s: 'frost', v: 0.15 }]),
      N('Deep Freeze', 2, 'Freezes last 25% longer.', [{ t: 'dur', s: 'frost', v: 0.25 }]),
      N('Shatter', 2, 'Frozen monsters take +10% damage.', [{ t: 'flag', f: 'shatter', v: 0.1 }]),
      N('Scholar\'s Focus', 2, 'Reads and searches deal +15% damage.', [{ t: 'usage', m: ['reading', 'searching'], v: 0.15 }]),
      N('Absolute Zero', 1, 'Capstone. Frost Nova also stuns.', [{ t: 'onhit', s: 'frost', e: 'stun' }]),
    ] },
    { name: 'Storm', color: [255, 232, 110], nodes: [
      N('Static', 3, 'Chain Lightning deals +15% damage.', [{ t: 'dmg', s: 'chain', v: 0.15 }]),
      N('Arc Reach', 2, 'Chain Lightning jumps to 1 more monster.', [{ t: 'targets', s: 'chain', v: 1 }]),
      N('Command Line', 2, 'Commands deal +15% damage.', [{ t: 'usage', m: ['running'], v: 0.15 }]),
      N('Overcharge', 2, '+4% crit chance.', [{ t: 'crit', v: 0.04 }]),
      N('Starstorm', 1, 'Capstone. Starfall strikes twice.', [{ t: 'flag', f: 'starfallTwice' }]),
    ] },
  ],
  ranger: [
    { name: 'Marksman', color: [230, 200, 120], nodes: [
      N('Steady Aim', 3, 'Arrows deal +15% damage.', [{ t: 'dmg', s: 'basic', v: 0.15 }]),
      N('Eagle Eye', 2, '+5% crit chance.', [{ t: 'crit', v: 0.05 }]),
      N('Broadheads', 2, 'Piercing Arrow deals +20% damage.', [{ t: 'dmg', s: 'pierce', v: 0.2 }]),
      N('Keen Reader', 2, 'Reads and searches deal +15% damage.', [{ t: 'usage', m: ['reading', 'searching'], v: 0.15 }]),
      N('Deadeye', 1, 'Capstone. Crits deal triple damage.', [{ t: 'flag', f: 'critX3' }]),
    ] },
    { name: 'Volley', color: [150, 220, 120], nodes: [
      N('Quick Draw', 3, 'Multishot deals +15% damage.', [{ t: 'dmg', s: 'multishot', v: 0.15 }]),
      N('Split Shot', 2, 'Multishot fires 1 more arrow.', [{ t: 'targets', s: 'multishot', v: 1 }]),
      N('Hail', 2, 'Rain of Arrows: +1 volley.', [{ t: 'targets', s: 'rain', v: 1 }]),
      N('Rapid Fire', 2, 'Auto-attacks come 8% faster.', [{ t: 'speed', v: 0.08 }]),
      N('Arrowstorm', 1, 'Capstone. Rain of Arrows covers the whole field, -50% cooldown.', [{ t: 'flag', f: 'rainAll' }, { t: 'cdr', s: 'rain', v: 0.5 }]),
    ] },
    { name: 'Trapper', color: [200, 150, 90], nodes: [
      N('Barbed Snare', 3, 'Snare Trap deals +15% damage.', [{ t: 'dmg', s: 'snare', v: 0.15 }]),
      N('Serrated Jaws', 1, 'Snare Trap makes monsters bleed.', [{ t: 'onhit', s: 'snare', e: 'bleed' }]),
      N('Field Notes', 2, 'Edits and plans deal +15% damage.', [{ t: 'usage', m: ['editing', 'planning'], v: 0.15 }]),
      N('Tangle', 2, 'Roots last 25% longer.', [{ t: 'dur', s: 'snare', v: 0.25 }]),
      N('Talon Storm', 1, 'Capstone. Eagle Strike stuns, -40% cooldown.', [{ t: 'onhit', s: 'eagle', e: 'stun' }, { t: 'cdr', s: 'eagle', v: 0.4 }]),
    ] },
  ],
  knight: [
    { name: 'Guardian', color: [140, 190, 255], nodes: [
      N('Heavy Shield', 3, 'Shield Bash deals +15% damage.', [{ t: 'dmg', s: 'bash', v: 0.15 }]),
      N('Concussion', 2, 'Stuns last 25% longer.', [{ t: 'dur', s: 'bash', v: 0.25 }, { t: 'dur', s: 'judgment', v: 0.25 }]),
      N('Blacksmith', 2, 'Edits deal +15% damage.', [{ t: 'usage', m: ['editing'], v: 0.15 }]),
      N('Bulwark', 2, 'Taunt: -20% cooldown, lasts 25% longer.', [{ t: 'cdr', s: 'taunt', v: 0.2 }, { t: 'dur', s: 'taunt', v: 0.25 }]),
      N('Shield Wall', 1, 'Capstone. Shield Bash hits 2 more monsters.', [{ t: 'targets', s: 'bash', v: 2 }]),
    ] },
    { name: 'Warrior', color: [235, 240, 255], nodes: [
      N('Sharpened Blade', 3, 'Sword Wave deals +15% damage.', [{ t: 'dmg', s: 'basic', v: 0.15 }]),
      N('Wide Arc', 2, 'Whirlwind deals +15% damage.', [{ t: 'dmg', s: 'whirl', v: 0.15 }]),
      N('Momentum', 2, 'Auto-attacks come 8% faster.', [{ t: 'speed', v: 0.08 }]),
      N('Cleaving Wounds', 1, 'Whirlwind makes monsters bleed.', [{ t: 'onhit', s: 'whirl', e: 'bleed' }]),
      N('Bladestorm', 1, 'Capstone. Whirlwind spins twice.', [{ t: 'flag', f: 'bladestorm' }]),
    ] },
    { name: 'Crusader', color: [255, 226, 130], nodes: [
      N('Zeal', 3, 'Holy Strike deals +15% damage.', [{ t: 'dmg', s: 'holy', v: 0.15 }]),
      N('Righteous', 2, '+4% crit chance.', [{ t: 'crit', v: 0.04 }]),
      N('Consecrate', 1, 'Holy Strike sets the ground ablaze.', [{ t: 'onhit', s: 'holy', e: 'burn' }]),
      N('Oathkeeper', 2, 'All damage +6%.', [{ t: 'dmg', s: '*', v: 0.06 }]),
      N('Final Judgment', 1, 'Capstone. Judgment deals double damage to bosses, -30% cooldown.', [{ t: 'flag', f: 'judgmentBoss' }, { t: 'cdr', s: 'judgment', v: 0.3 }]),
    ] },
  ],
  warlock: [
    { name: 'Affliction', color: [190, 110, 250], nodes: [
      N('Hex', 3, 'Curse deals +15% damage.', [{ t: 'dmg', s: 'curse', v: 0.15 }]),
      N('Lingering', 2, 'Curses last 25% longer.', [{ t: 'dur', s: 'curse', v: 0.25 }]),
      N('Agony', 2, 'Damage over time +20%.', [{ t: 'dot', v: 0.2 }]),
      N('Legion', 2, 'Launching agents deals +20% damage.', [{ t: 'usage', m: ['summoning'], v: 0.2 }]),
      N('Plague', 1, 'Capstone. A cursed monster passes its curse on when it dies.', [{ t: 'flag', f: 'curseSpread' }]),
    ] },
    { name: 'Blood', color: [230, 70, 90], nodes: [
      N('Siphon', 3, 'Drain Life deals +15% damage.', [{ t: 'dmg', s: 'drain', v: 0.15 }]),
      N('Vampirism', 2, 'Healing +25%.', [{ t: 'heal', v: 0.25 }]),
      N('Blood Pact', 2, 'All damage +6%.', [{ t: 'dmg', s: '*', v: 0.06 }]),
      N('Dark Vigor', 2, '+4% crit chance.', [{ t: 'crit', v: 0.04 }]),
      N('Soul Harvest', 1, 'Capstone. Drain Life drains 2 more monsters.', [{ t: 'targets', s: 'drain', v: 2 }]),
    ] },
    { name: 'Demonology', color: [255, 120, 60], nodes: [
      N('Imp Mastery', 3, 'Your imp deals +15% damage.', [{ t: 'dmg', s: 'imp', v: 0.15 }]),
      N('Pact of Fire', 2, 'Your imp stays 25% longer.', [{ t: 'dur', s: 'imp', v: 0.25 }]),
      N('Hellfire', 2, 'Shadowflame deals +20% damage.', [{ t: 'dmg', s: 'shadowflame', v: 0.2 }]),
      N('Command Line', 2, 'Commands deal +15% damage.', [{ t: 'usage', m: ['running'], v: 0.15 }]),
      N('Twin Imps', 1, 'Capstone. Summon Imp brings two imps.', [{ t: 'flag', f: 'twinImps' }]),
    ] },
  ],
  bard: [
    { name: 'Valor', color: [255, 200, 90], nodes: [
      N('Rousing', 3, 'Anthem gives 5% more damage.', [{ t: 'flag', f: 'anthemBoost', v: 0.05 }]),
      N('Long Song', 2, 'Anthem lasts 25% longer.', [{ t: 'dur', s: 'anthem', v: 0.25 }]),
      N('Loremaster', 2, 'Web and plans deal +15% damage.', [{ t: 'usage', m: ['web', 'planning'], v: 0.15 }]),
      N('Power Chords', 2, 'Power Chord deals +20% damage.', [{ t: 'dmg', s: 'basic', v: 0.2 }]),
      N('Epic Ballad', 1, 'Capstone. Anthem also gives +15% crit chance.', [{ t: 'flag', f: 'anthemCrit' }]),
    ] },
    { name: 'Dissonance', color: [255, 110, 170], nodes: [
      N('Harsh Notes', 3, 'Discord deals +15% damage.', [{ t: 'dmg', s: 'discord', v: 0.15 }]),
      N('Ringing Ears', 2, 'Stuns last 25% longer.', [{ t: 'dur', s: 'discord', v: 0.25 }]),
      N('Resonance', 2, 'Crescendo deals +20% damage.', [{ t: 'dmg', s: 'crescendo', v: 0.2 }]),
      N('Feedback', 2, 'Crescendo: -15% cooldown.', [{ t: 'cdr', s: 'crescendo', v: 0.15 }]),
      N('Wall of Sound', 1, 'Capstone. Discord hits every monster; stunned ones take double.', [{ t: 'flag', f: 'wallOfSound' }]),
    ] },
    { name: 'Virtuoso', color: [170, 150, 255], nodes: [
      N('Improvise', 3, 'Echo replays at +15% damage.', [{ t: 'dmg', s: 'echo', v: 0.15 }]),
      N('Tempo', 2, 'Auto-attacks come 8% faster.', [{ t: 'speed', v: 0.08 }]),
      N('Showman', 2, '+4% crit chance.', [{ t: 'crit', v: 0.04 }]),
      N('Standing Ovation', 2, 'Encore: -20% cooldown.', [{ t: 'cdr', s: 'encore', v: 0.2 }]),
      N('Double Echo', 1, 'Capstone. Echo replays your last two skills.', [{ t: 'flag', f: 'doubleEcho' }]),
    ] },
  ],
  rogue: [
    { name: 'Assassination', color: [220, 80, 80], nodes: [
      N('Sharp Knives', 3, 'Backstab deals +15% damage.', [{ t: 'dmg', s: 'backstab', v: 0.15 }]),
      N('Lethality', 2, '+5% crit chance.', [{ t: 'crit', v: 0.05 }]),
      N('Hemorrhage', 1, 'Backstab makes monsters bleed.', [{ t: 'onhit', s: 'backstab', e: 'bleed' }]),
      N('Quick Hands', 2, 'Edits deal +15% damage.', [{ t: 'usage', m: ['editing'], v: 0.15 }]),
      N('Assassinate', 1, 'Capstone. Backstab kills monsters below 30% HP (not bosses).', [{ t: 'flag', f: 'assassinate' }]),
    ] },
    { name: 'Venom', color: [120, 220, 90], nodes: [
      N('Toxic Edge', 3, 'Poison Blade deals +15% damage.', [{ t: 'dmg', s: 'poison', v: 0.15 }]),
      N('Virulence', 2, 'Poison lasts 25% longer.', [{ t: 'dur', s: 'poison', v: 0.25 }]),
      N('Potency', 2, 'Damage over time +20%.', [{ t: 'dot', v: 0.2 }]),
      N('Researcher', 2, 'Reads and searches deal +15% damage.', [{ t: 'usage', m: ['reading', 'searching'], v: 0.15 }]),
      N('Pandemic', 1, 'Capstone. Poison Blade poisons every monster.', [{ t: 'flag', f: 'pandemic' }]),
    ] },
    { name: 'Shadow', color: [120, 220, 200], nodes: [
      N('Thick Smoke', 3, 'Smoke Bomb deals +15% damage and lasts longer.', [{ t: 'dmg', s: 'smoke', v: 0.15 }, { t: 'dur', s: 'smoke', v: 0.15 }]),
      N('Evasion', 2, 'Smoke Bomb: -15% cooldown.', [{ t: 'cdr', s: 'smoke', v: 0.15 }]),
      N('Swift', 2, 'Auto-attacks come 8% faster.', [{ t: 'speed', v: 0.08 }]),
      N('Marked for Death', 2, 'Death Mark deals +20% damage.', [{ t: 'dmg', s: 'deathmark', v: 0.2 }]),
      N('Shadow Clone', 1, 'Capstone. Shadow Step hits 2 more monsters and resets Backstab.', [{ t: 'targets', s: 'shadowstep', v: 2 }, { t: 'flag', f: 'stepReset' }]),
    ] },
  ],
};
// Tiers 6 and 7 (Lv 20 and 28) and the Awakened capstones (Lv 40), which
// upgrade each branch's tier-5 capstone. Appended to every branch.
const AW = (name, desc, fx) => N(`Awakened ${name}`, 1, `Awakened (Lv 40). ${desc}`, fx);
const EXTRA = {
  mage: [
    [N('Kindled Soul', 2, 'Inferno deals +20% damage.', [{ t: 'dmg', s: 'inferno', v: 0.2 }]),
      N('Pyroclasm', 2, 'Fire damage +10%.', [{ t: 'el', e: 'fire', v: 0.1 }]),
      AW('Phoenix', 'Fireball splits into 5, and every ember burns.', [{ t: 'flag', f: 'phoenixAwk' }])],
    [N('Glacial Armor', 2, 'Take 8% less damage.', [{ t: 'dr', v: 0.08 }]),
      N('Permafrost', 2, 'Blizzard +20% damage, frost damage +10%.', [{ t: 'dmg', s: 'blizzard', v: 0.2 }, { t: 'el', e: 'frost', v: 0.1 }]),
      AW('Zero', 'Frost Nova reaches every monster on the field.', [{ t: 'flag', f: 'zeroAwk' }])],
    [N('Conductor', 2, 'Shields break 50% faster.', [{ t: 'sb', v: 0.5 }]),
      N('Arcane Reserves', 2, 'Barriers absorb 25% more; max HP +5%.', [{ t: 'flag', f: 'barrierPlus', v: 0.25 }, { t: 'hp', v: 0.05 }]),
      AW('Starstorm', 'Starfall strikes three times.', [{ t: 'flag', f: 'starAwk' }])],
  ],
  ranger: [
    [N('Armor Piercer', 2, 'Ignore 25% of armor.', [{ t: 'pen', v: 0.25 }]),
      N('Storm Quiver', 2, 'Storm Arrow deals +20% damage.', [{ t: 'dmg', s: 'stormarrow', v: 0.2 }]),
      AW('Deadeye', 'Crits deal ×4.', [{ t: 'flag', f: 'deadeyeAwk' }])],
    [N('Pack Leader', 2, 'Wolves deal +20% damage and stay 25% longer.', [{ t: 'dmg', s: 'wolves', v: 0.2 }, { t: 'dur', s: 'wolves', v: 0.25 }]),
      N('Frostfletch', 2, 'Frost Volley deals +20% damage.', [{ t: 'dmg', s: 'frostvolley', v: 0.2 }]),
      AW('Arrowstorm', 'Rain of Arrows fires 3 more volleys.', [{ t: 'targets', s: 'rain', v: 3 }])],
    [N('Survivalist', 2, 'Max HP +8%.', [{ t: 'hp', v: 0.08 }]),
      N('Field Medic', 2, 'Healing +20%.', [{ t: 'heal', v: 0.2 }]),
      AW('Talons', 'Eagle Strike dives twice.', [{ t: 'flag', f: 'talonAwk' }])],
  ],
  knight: [
    [N('Iron Skin', 2, 'Take 8% less damage.', [{ t: 'dr', v: 0.08 }]),
      N('Fortress', 2, 'Max HP +8%.', [{ t: 'hp', v: 0.08 }]),
      AW('Shield Wall', 'Shield Bash hits 2 more monsters and stuns twice as long.', [{ t: 'targets', s: 'bash', v: 2 }, { t: 'dur', s: 'bash', v: 1 }])],
    [N('Earthshaker', 2, 'Ground Slam deals +20% damage.', [{ t: 'dmg', s: 'groundslam', v: 0.2 }]),
      N('Sunder', 2, 'Ignore 25% of armor; shields break 25% faster.', [{ t: 'pen', v: 0.25 }, { t: 'sb', v: 0.25 }]),
      AW('Bladestorm', 'Whirlwind spins three times.', [{ t: 'flag', f: 'bladeAwk' }])],
    [N('Devotion', 2, 'Healing +20%.', [{ t: 'heal', v: 0.2 }]),
      N('Sanctified', 2, 'Holy damage +10%, Consecration +20%.', [{ t: 'el', e: 'holy', v: 0.1 }, { t: 'dmg', s: 'consecrate', v: 0.2 }]),
      AW('Judgment', 'Judgment heals 3% HP for every monster it hits.', [{ t: 'flag', f: 'judgeAwk' }])],
  ],
  warlock: [
    [N('Soul Eater', 2, 'Soul Rot +20% damage; damage over time +10%.', [{ t: 'dmg', s: 'soulrot', v: 0.2 }, { t: 'dot', v: 0.1 }]),
      N('Dread', 2, 'Fear lasts 25% longer.', [{ t: 'dur', s: 'fear', v: 0.25 }]),
      AW('Plague', 'Curses spread to two monsters.', [{ t: 'flag', f: 'plagueAwk' }])],
    [N('Blood Shield', 2, 'Barriers absorb 25% more.', [{ t: 'flag', f: 'barrierPlus', v: 0.25 }]),
      N('Unholy Vigor', 2, 'Max HP +8%.', [{ t: 'hp', v: 0.08 }]),
      AW('Harvest', 'Drain Life drains every monster.', [{ t: 'flag', f: 'harvestAwk' }])],
    [N('Infernal Pact', 2, 'Summon Demon +20% damage; fire damage +10%.', [{ t: 'dmg', s: 'demon', v: 0.2 }, { t: 'el', e: 'fire', v: 0.1 }]),
      N('Brimstone', 2, 'Rain of Fire deals +20% damage.', [{ t: 'dmg', s: 'firerain', v: 0.2 }]),
      AW('Imps', 'Summon Imp brings three imps.', [{ t: 'flag', f: 'impsAwk' }])],
  ],
  bard: [
    [N('Battle Hymn', 2, 'Healing +20%.', [{ t: 'heal', v: 0.2 }]),
      N('Heroic Refrain', 2, 'Max HP +8%.', [{ t: 'hp', v: 0.08 }]),
      AW('Ballad', 'Anthem gives 10% more damage and heals 5%.', [{ t: 'flag', f: 'balladAwk' }])],
    [N('Thunderous', 2, 'Power Riff +20% damage; shields break 25% faster.', [{ t: 'dmg', s: 'riff', v: 0.2 }, { t: 'sb', v: 0.25 }]),
      N('Drummer', 2, 'Drum Line deals +20% damage.', [{ t: 'dmg', s: 'drumline', v: 0.2 }]),
      AW('Wall of Sound', 'Discord stuns twice as long.', [{ t: 'dur', s: 'discord', v: 1 }])],
    [N('Siren\'s Voice', 2, 'Siren Song lasts 25% longer.', [{ t: 'dur', s: 'siren', v: 0.25 }]),
      N('Stage Presence', 2, 'Take 8% less damage.', [{ t: 'dr', v: 0.08 }]),
      AW('Echo', 'Echo replays your last three skills.', [{ t: 'flag', f: 'echoAwk' }])],
  ],
  rogue: [
    [N('Exposed', 2, 'Ignore 25% of armor.', [{ t: 'pen', v: 0.25 }]),
      N('Flurry', 2, 'Blade Flurry deals +20% damage.', [{ t: 'dmg', s: 'flurry', v: 0.2 }]),
      AW('Assassin', 'Backstab executes monsters below 45% HP.', [{ t: 'flag', f: 'assassinAwk' }])],
    [N('Toxicology', 2, 'Damage over time +10%; Fan of Knives +20%.', [{ t: 'dot', v: 0.1 }, { t: 'dmg', s: 'fan', v: 0.2 }]),
      N('Garrote Wire', 2, 'Garrote deals +20% damage.', [{ t: 'dmg', s: 'garrote', v: 0.2 }]),
      AW('Pandemic', 'Poison deals double damage.', [{ t: 'flag', f: 'pandemicAwk' }])],
    [N('Elusive', 2, 'Take 8% less damage.', [{ t: 'dr', v: 0.08 }]),
      N('Shadow Veil', 2, 'Healing +20%.', [{ t: 'heal', v: 0.2 }]),
      AW('Clone', 'Shadow Step hits 4 more monsters.', [{ t: 'targets', s: 'shadowstep', v: 4 }])],
  ],
};
for (const cls of Object.keys(EXTRA)) EXTRA[cls].forEach((nodes, b) => TREES[cls][b].nodes.push(...nodes));

// Each tier needs this hero level.
const TIER_LVL = [1, 4, 8, 12, 16, 20, 28, 40];
const NODES = TIER_LVL.length;
const PARAGON = [
  { id: 'dmg', name: 'Might', desc: '+1% damage per point', color: [255, 128, 80] },
  { id: 'gold', name: 'Fortune', desc: '+1% gold per point', color: [255, 214, 80] },
  { id: 'crit', name: 'Precision', desc: '+1% crit chance per point', color: [140, 210, 255] },
];

const treeFor = (cls) => TREES[cls] || TREES.mage;
const nodeId = (cls, b, n) => `${cls}.${b}.${n}`;
const totalRanks = (cls) => treeFor(cls).reduce((a, br) => a + br.nodes.reduce((s, n) => s + n.max, 0), 0);

// ---------- progress ----------

const clsOf = (d) => (d && d.hero && C.KITS[d.hero.cls] ? d.hero.cls : 'mage');
function skillData(state) {
  const s = (state && state.game && state.game.skills) || {};
  const out = { nodes: { ...(s.nodes || {}) }, respecs: s.respecs || 0, paragon: { dmg: 0, gold: 0, crit: 0, ...(s.paragon || {}) } };
  if (Array.isArray(s.loadout)) out.loadout = s.loadout.slice(0, 6);
  return out;
}
// Bosses killed by this hero (game.js saves ui.battle.bosses as game.bosses).
const bossKills = (state) => { const g = (state && state.game) || {}; return Math.max(Number(g.bosses) || 0, Number(g.bossKills) || 0); };
const rankOf = (sk, cls, b, n) => Math.min(treeFor(cls)[b].nodes[n].max, Number(sk.nodes[nodeId(cls, b, n)]) || 0);

// Points summary for a hero: level and bosses earn points; nodes, then
// paragon boosts, spend them.
function points(d) {
  const cls = clsOf(d), sk = skillData(d.state);
  const earned = Math.max(0, d.lvl || 1) + bossKills(d.state);
  let spent = 0;
  treeFor(cls).forEach((br, b) => br.nodes.forEach((_, n) => { spent += rankOf(sk, cls, b, n); }));
  const total = totalRanks(cls);
  const pSpent = PARAGON.reduce((a, p) => a + (sk.paragon[p.id] || 0), 0);
  const full = spent >= total;
  const avail = Math.max(0, earned - pSpent - spent);
  return { earned, spent, total, full, avail: full ? 0 : Math.min(avail, total - spent), paragon: full ? avail : 0, pSpent, bosses: bossKills(d.state), sk, cls };
}

const respecCost = (respecs) => 100 * Math.pow(2, respecs || 0);

// Why a node can't be learned right now ('' if it can).
function blocker(d, b, n) {
  const P = points(d), br = treeFor(P.cls)[b], node = br.nodes[n];
  if (rankOf(P.sk, P.cls, b, n) >= node.max) return 'Fully learned';
  if ((d.lvl || 1) < TIER_LVL[n]) return `Needs level ${TIER_LVL[n]}`;
  if (n > 0 && rankOf(P.sk, P.cls, b, n - 1) < 1) return `Learn ${br.nodes[n - 1].name} first`;
  if (P.avail < 1) return 'No skill points';
  return '';
}

// Save a change to the active hero's skills under the state lock, keeping
// every other field. `fn(skills, game)` mutates and returns false to abort.
function saveSkills(d, fn) {
  let ok = false;
  L.withLock(() => {
    const st = L.loadState();
    const game = { ...(st.game || {}) };
    const sk = skillData(st);
    if (fn(sk, game) === false) return;
    game.skills = sk;
    st.game = game;
    L.saveState(st);
    d.state = st;
    ok = true;
  });
  memo.key = null;
  return ok;
}

function learn(d, b, n) {
  const why = blocker(d, b, n);
  if (why) return note(why);
  const cls = clsOf(d), id = nodeId(cls, b, n), node = treeFor(cls)[b].nodes[n];
  // Re-check against fresh state inside the lock.
  const ok = saveSkills(d, (sk) => {
    if (blocker({ ...d, state: { ...d.state, game: { ...(d.state.game || {}), skills: sk } } }, b, n)) return false;
    sk.nodes[id] = (Number(sk.nodes[id]) || 0) + 1;
    return true;
  });
  if (ok) { note(`Learned ${node.name}!`, true); flashNode(b, n); }
  return ok;
}

function learnParagon(d, i) {
  const P = points(d), p = PARAGON[i];
  if (!P.full) return note('Learn every node to unlock paragon');
  if (P.paragon < 1) return note('No paragon points');
  const ok = saveSkills(d, (sk) => { sk.paragon[p.id] = (sk.paragon[p.id] || 0) + 1; });
  if (ok) note(`Paragon: ${p.name} +1%`, true);
  return ok;
}

// Reset every node for gold. Paragon boosts are permanent and stay.
function respec(d) {
  const P = points(d);
  if (!P.spent) return note('Nothing to reset');
  const cost = respecCost(P.sk.respecs);
  const gold = ui.battle.gold || 0;
  if (gold < cost) return note(`Respec needs ◉ ${cost} gold`);
  const ok = saveSkills(d, (sk, game) => {
    const cls = clsOf(d);
    for (const k of Object.keys(sk.nodes)) if (k.startsWith(`${cls}.`)) delete sk.nodes[k];
    sk.respecs += 1;
    ui.battle.gold = gold - cost;
    game.gold = ui.battle.gold;
  });
  if (ok) { ui.dirty = true; note(`Skills reset for ◉ ${cost}`, true); }
  return ok;
}

// ---------- modifiers (read by battle.js) ----------

const memo = { key: null, val: null };
function mods(d) {
  const cls = clsOf(d), sk = skillData(d && d.state);
  const key = `${cls}|${JSON.stringify(sk)}`;
  if (memo.key === key) return memo.val;
  const M = { dmg: {}, usage: {}, cdr: {}, targets: {}, dur: {}, onhit: {}, flags: {}, el: {}, crit: 0, speed: 0, dot: 0, heal: 0, gold: 0, all: 0, hp: 0, dr: 0, pen: 0, sb: 0 };
  treeFor(cls).forEach((br, b) => br.nodes.forEach((node, n) => {
    const r = rankOf(sk, cls, b, n);
    if (!r) return;
    for (const f of node.fx) {
      const v = (f.v || 0) * r;
      if (f.t === 'dmg') { if (f.s === '*') M.all += v; else M.dmg[f.s] = (M.dmg[f.s] || 0) + v; }
      else if (f.t === 'usage') for (const m of f.m) M.usage[m] = (M.usage[m] || 0) + v;
      else if (f.t === 'cdr') M.cdr[f.s] = Math.min(0.75, (M.cdr[f.s] || 0) + v);
      else if (f.t === 'targets') M.targets[f.s] = (M.targets[f.s] || 0) + v;
      else if (f.t === 'dur') M.dur[f.s] = (M.dur[f.s] || 0) + v;
      else if (f.t === 'crit') M.crit += v;
      else if (f.t === 'speed') M.speed += v;
      else if (f.t === 'dot') M.dot += v;
      else if (f.t === 'heal') M.heal += v;
      else if (f.t === 'hp') M.hp += v;
      else if (f.t === 'dr') M.dr = Math.min(0.6, M.dr + v);
      else if (f.t === 'pen') M.pen = Math.min(1, M.pen + v);
      else if (f.t === 'sb') M.sb += v;
      else if (f.t === 'el') M.el[f.e] = (M.el[f.e] || 0) + v;
      else if (f.t === 'onhit') (M.onhit[f.s] ||= []).push(f.e);
      else if (f.t === 'flag') M.flags[f.f] = f.v ? f.v * r : true;
    }
  }));
  // Paragon: +1% damage, gold and crit per point, uncapped.
  M.paragonDmg = (sk.paragon.dmg || 0) * 0.01;
  M.gold += (sk.paragon.gold || 0) * 0.01;
  M.crit += (sk.paragon.crit || 0) * 0.01;
  // Damage multiplier for a skill cast by a Claude activity (mode).
  M.mult = (id, mode, el) => (1 + M.all + (M.dmg[id] || 0) + (mode ? M.usage[mode] || 0 : 0) + (el ? M.el[el] || 0 : 0)) * (1 + M.paragonDmg);
  M.durMult = (id) => 1 + (M.dur[id] || 0);
  M.cd = (id, base) => Math.max(1, Math.round(base * (1 - (M.cdr[id] || 0))));
  M.has = (id, e) => (M.onhit[id] || []).includes(e);
  memo.key = key; memo.val = M;
  return M;
}

// ---------- UI state ----------

const sel = () => { const s = (ui.skills ||= { b: 0, n: 0, p: 0, msg: null, confirm: false, flash: null }); s.k ??= 0; s.slot ??= 0; s.view ??= 'tree'; return s; };
function note(text, good = false) { sel().msg = { text, good, until: ui.tick + 30 }; return false; }
function flashNode(b, n) { sel().flash = { b, n, t: ui.tick }; }

// Returns true when the key was handled.
function skillsKey(key, d) {
  const s = sel();
  if (s.confirm) {
    s.confirm = false;
    if (key === 'y' || key === 'Y' || key === '\r' || key === 'r') respec(d);
    else note('Respec cancelled');
    return true;
  }
  if (key === 'k' || key === 'K') { s.view = s.view === 'kit' ? 'tree' : 'kit'; return true; }
  if (s.view === 'kit') return kitKey(key, d);
  const PR = NODES; // the paragon row sits under the last tier
  if (key === '\x1b[A') { if (s.n === PR) { s.n = PR - 1; s.b = Math.min(2, s.p); } else s.n = Math.max(0, s.n - 1); return true; }
  if (key === '\x1b[B') { if (s.n === PR - 1) { s.n = PR; s.p = s.b; } else s.n = Math.min(PR, s.n + 1); return true; }
  if (key === '\x1b[D') { if (s.n === PR) s.p = (s.p + 2) % 3; else s.b = (s.b + 2) % 3; return true; }
  if (key === '\x1b[C') { if (s.n === PR) s.p = (s.p + 1) % 3; else s.b = (s.b + 1) % 3; return true; }
  if (key === '\r' || key === '\n') { if (s.n === PR) learnParagon(d, s.p); else learn(d, s.b, s.n); return true; }
  if (key === 'r' || key === 'R') {
    const P = points(d);
    if (!P.spent) { note('Nothing to reset'); return true; }
    s.confirm = true;
    return true;
  }
  return false;
}

// ---------- drawing ----------

const vis = L.visWidth;
function fit(text, w) {
  if (w <= 0) return '';
  if (vis(text) <= w) return text;
  let out = '';
  for (const ch of text) { if (vis(out + ch) > w - 1) break; out += ch; }
  return out + '…';
}
// A run of text padded/cut to exactly w cells on a background.
const cell = (w, text, c, back, bold = false, align = 'left') => {
  const t = fit(text, w), pad = w - vis(t);
  const l = align === 'center' ? Math.floor(pad / 2) : align === 'right' ? pad : 0;
  return `${bg(back)}${fg(c)}${bold ? BOLD : ''}${' '.repeat(l)}${t}${' '.repeat(pad - l)}${bold ? NOBOLD : ''}`;
};
// Several colored parts in exactly w cells.
function row(w, back, parts) {
  let s = '', used = 0;
  for (const [t, c, b] of parts) {
    if (used >= w) break;
    const tt = fit(t, w - used);
    s += `${bg(back)}${fg(c)}${b ? BOLD : ''}${tt}${b ? NOBOLD : ''}`;
    used += vis(tt);
  }
  return s + `${bg(back)}${' '.repeat(Math.max(0, w - used))}`;
}

const nodeState = (d, P, b, n) => {
  const r = rankOf(P.sk, P.cls, b, n), max = treeFor(P.cls)[b].nodes[n].max;
  if (r >= max) return 'full';
  if (r > 0) return 'part';
  const why = blocker(d, b, n);
  return !why ? 'avail' : why === 'No skill points' ? 'open' : 'locked';
};

// Skills tab: three branches drawn as node columns joined by box-drawing
// connectors, a detail panel for the selected node, points and paragon.
// Every line is exactly W cells wide.
function skillsTab(d, pal, W, h) {
  if (sel().view === 'kit') return kitTab(d, pal, W, h);
  const s = sel(), P = points(d), tree = treeFor(P.cls), t = ui.tick;
  const retro = pal === UI.retro;
  const edgeC = X.mix(pal.panel, pal.text, 0.24);
  const B = (c = edgeC) => `${bg(pal.panel)}${fg(c)}`;
  const out = [];
  const ptsTxt = P.full ? `◆ ${P.paragon} paragon` : `◆ ${P.avail} point${P.avail === 1 ? '' : 's'}`;
  const tier = require('./monsters').difficultyFor(d.lvl);
  out.push(titleBar(W, pal, `SKILL TREE · ${C.CLASSES[P.cls].name}`, [[` ${tier.label} `, retro ? pal.accent : tier.color, true], [`${ptsTxt} `, P.avail || P.paragon ? pal.gold : pal.dim, true]]));

  const inner = W - 2;
  const sideW = inner >= 96 ? Math.min(40, Math.floor(inner * 0.34)) : 0;
  const treeW = inner - sideW - (sideW ? 1 : 0);
  const colW = Math.floor(treeW / 3), lastW = treeW - colW * 2;
  const cw = (b) => (b === 2 ? lastW : colW);
  const boxed = h >= 38;
  const col = (br, st, sel2) => {
    const base = retro ? pal.accent : br.color;
    if (st === 'full') return X.mix(base, [255, 255, 255], 0.25 + 0.2 * Math.sin(t * 0.3));
    if (st === 'part') return base;
    if (st === 'avail') return X.mix(base, pal.text, 0.35);
    if (st === 'open') return X.mix(pal.dim, base, 0.3);
    return X.mix(pal.dim, pal.panel, 0.25);
  };
  const icon = (st) => ({ full: '◆', part: '◈', avail: '◇', open: '◇', locked: '·' }[st]);

  const treeRows = [];
  // branch titles
  treeRows.push(tree.map((br, b) => {
    const r = br.nodes.reduce((a, _, n) => a + rankOf(P.sk, P.cls, b, n), 0), m = br.nodes.reduce((a, n) => a + n.max, 0);
    return row(cw(b), pal.panel, [[' ', pal.text], [br.name.toUpperCase(), retro ? pal.accent : br.color, true], [` ${r}/${m}`, pal.dim]]);
  }).join(''));
  for (let n = 0; n < NODES; n++) {
    const parts = { top: [], mid: [], bot: [], link: [] };
    tree.forEach((br, b) => {
      const w = cw(b), node = br.nodes[n], st = nodeState(d, P, b, n), r = rankOf(P.sk, P.cls, b, n);
      const isSel = s.n === n && s.b === b;
      const c = col(br, st, isSel);
      const flash = s.flash && s.flash.b === b && s.flash.n === n && t - s.flash.t < 8;
      const back = isSel ? X.mix(pal.panel, c, flash && t % 2 ? 0.6 : 0.28) : st === 'full' ? X.mix(pal.panel, c, 0.1 + 0.06 * Math.sin(t * 0.3)) : pal.panel;
      const cap = n === 4 || n === NODES - 1;
      const label = `${icon(st)} ${node.name}`;
      const rk = `${r}/${node.max}`;
      const bw = Math.max(8, w - 2), lp = Math.floor((w - bw) / 2), rp = w - bw - lp;
      const mid = Math.floor(bw / 2);
      const lineC = (k) => (rankOf(P.sk, P.cls, b, k) > 0 ? (retro ? pal.accent : br.color) : X.mix(pal.dim, pal.panel, 0.35));
      const pad = (str) => `${bg(pal.panel)}${' '.repeat(lp)}${str}${bg(pal.panel)}${' '.repeat(rp)}`;
      const edgeCol = isSel ? pal.text : c;
      const [tl, tr, bl, brc, hz] = cap ? ['╔', '╗', '╚', '╝', '═'] : ['╭', '╮', '╰', '╯', '─'];
      if (boxed) {
        const topBar = hz.repeat(mid - 1) + (n > 0 ? (cap ? '╧' : '┴') : hz) + hz.repeat(bw - mid - 2);
        const botBar = hz.repeat(mid - 1) + (n < NODES - 1 ? (cap ? '╤' : '┬') : hz) + hz.repeat(bw - mid - 2);
        parts.top.push(pad(`${bg(pal.panel)}${fg(edgeCol)}${tl}${topBar}${tr}`));
        const text = cap ? `${n === 4 ? '★' : '✦'} ${node.name}` : label;
        parts.mid.push(pad(`${bg(pal.panel)}${fg(edgeCol)}${cap ? '║' : '│'}${row(bw - 2 - vis(rk) - 1, back, [[text, c, st === 'full' || isSel]])}${cell(vis(rk) + 1, rk, st === 'locked' ? c : pal.dim, back, false, 'right')}${bg(pal.panel)}${fg(edgeCol)}${cap ? '║' : '│'}`));
        parts.bot.push(pad(`${bg(pal.panel)}${fg(edgeCol)}${bl}${botBar}${brc}`));
      } else {
        parts.mid.push(pad(`${row(bw - vis(rk) - 1, back, [[cap ? `${n === 4 ? '★' : '✦'} ${node.name}` : label, c, st === 'full' || isSel]])}${cell(vis(rk) + 1, rk, pal.dim, back, false, 'right')}`));
      }
      if (n < NODES - 1) {
        const lc = lineC(n + 1);
        parts.link.push(`${bg(pal.panel)}${' '.repeat(lp + mid)}${fg(lc)}${rankOf(P.sk, P.cls, b, n + 1) > 0 ? '┃' : '│'}${' '.repeat(w - lp - mid - 1)}`);
      }
    });
    if (boxed) treeRows.push(parts.top.join(''));
    treeRows.push(parts.mid.join(''));
    if (boxed) treeRows.push(parts.bot.join(''));
    if (n < NODES - 1 && (boxed || h >= 22)) treeRows.push(parts.link.join(''));
  }
  // paragon row
  treeRows.push(row(treeW, pal.panel, []));
  const pc = P.full ? pal.gold : X.mix(pal.dim, pal.panel, 0.2);
  treeRows.push(row(treeW, pal.panel, [[' PARAGON ', pc, true], [P.full ? `${P.paragon} point${P.paragon === 1 ? '' : 's'} · 1 per level, no cap` : `unlocks when all ${P.total} ranks are learned (${P.spent}/${P.total})`, pal.dim]]));
  treeRows.push(PARAGON.map((p, i) => {
    const isSel = s.n === NODES && s.p === i, v = P.sk.paragon[p.id] || 0;
    const c = P.full || v ? (retro ? pal.accent : p.color) : X.mix(pal.dim, pal.panel, 0.25);
    const back = isSel ? X.mix(pal.panel, c, 0.3) : pal.panel;
    return `${bg(pal.panel)} ${row(cw(i) - 2, back, [[isSel ? '▸ ' : '  ', pal.text, true], [p.name, c, true], [` +${v}%`, isSel ? pal.text : pal.dim]])}${bg(pal.panel)} `;
  }).join(''));

  // detail panel
  const side = [];
  if (sideW) {
    const line = (parts) => row(sideW, pal.panel2, parts);
    const wrapT = (text, w) => { const ls = ['']; for (const wd of String(text).split(/\s+/)) { const cur = ls[ls.length - 1]; if (!cur) ls[ls.length - 1] = wd; else if (vis(cur) + 1 + vis(wd) <= w) ls[ls.length - 1] = `${cur} ${wd}`; else ls.push(wd); } return ls; };
    side.push(line([]));
    if (s.n < NODES) {
      const br = tree[s.b], node = br.nodes[s.n], r = rankOf(P.sk, P.cls, s.b, s.n), st = nodeState(d, P, s.b, s.n);
      const c = col(br, st === 'locked' ? 'avail' : st);
      side.push(line([[' ', pal.text], [s.n === 4 ? '★ ' : s.n === NODES - 1 ? '✦ ' : `${icon(st)} `, c, true], [node.name, pal.text, true]]));
      side.push(line([[' ', pal.text], [`${br.name} · tier ${s.n + 1}${s.n === 4 ? ' capstone' : s.n === NODES - 1 ? ' awakened' : ''} · Lv ${TIER_LVL[s.n]}`, pal.dim]]));
      side.push(line([[' Rank ', pal.dim], ['■'.repeat(r), c, true], ['□'.repeat(node.max - r), pal.dim], [` ${r}/${node.max}`, pal.text]]));
      side.push(line([]));
      for (const l of wrapT(node.desc, sideW - 2)) side.push(line([[' ', pal.text], [l, pal.text]]));
      if (node.max > 1) side.push(line([[' ', pal.text], ['Stacks per rank.', pal.dim]]));
      side.push(line([]));
      const why = blocker(d, s.b, s.n);
      side.push(line(why ? [[' ', pal.text], [why, why === 'Fully learned' ? pal.good : pal.bad, true]] : [[' ', pal.text], ['enter', pal.accent, true], [' learn · 1 point', pal.text]]));
    } else {
      const p = PARAGON[s.p];
      side.push(line([[' ', pal.text], ['✦ ', retro ? pal.accent : p.color, true], [`Paragon: ${p.name}`, pal.text, true]]));
      side.push(line([[' ', pal.text], [p.desc, pal.dim]]));
      side.push(line([[' Current ', pal.dim], [`+${P.sk.paragon[p.id] || 0}%`, pal.gold, true]]));
      side.push(line([]));
      side.push(line([[' ', pal.text], [P.full ? (P.paragon ? 'enter  spend a paragon point' : 'Level up for paragon points') : 'Learn every node first', P.full && P.paragon ? pal.accent : pal.dim, true]]));
    }
    side.push(line([]));
    side.push(line([[' POINTS', pal.accent, true]]));
    side.push(line([[' Levels   ', pal.dim], [`${d.lvl || 1}`, pal.text, true]]));
    side.push(line([[' Bosses   ', pal.dim], [`${P.bosses}`, pal.text, true]]));
    side.push(line([[' Spent    ', pal.dim], [`${P.spent}/${P.total}`, pal.text, true], [P.pSpent ? ` +${P.pSpent} paragon` : '', pal.dim]]));
    side.push(line([[' Free     ', pal.dim], [P.full ? `${P.paragon} paragon` : `${P.avail}`, P.avail || P.paragon ? pal.gold : pal.text, true]]));
    side.push(line([]));
    const cost = respecCost(P.sk.respecs);
    side.push(line([[' r ', pal.accent, true], ['respec ', pal.text], [`◉ ${cost}`, pal.gold, true], [P.sk.respecs ? ` (${P.sk.respecs} done)` : '', pal.dim]]));
  }

  // status line at the bottom: message, confirm prompt or key help
  const msg = s.msg && s.msg.until > t ? s.msg : null;
  const status = s.confirm
    ? [[' Reset every node for ', pal.text], [`◉ ${respecCost(P.sk.respecs)}`, pal.gold, true], ['?  ', pal.text], ['y', pal.accent, true], [' yes  ', pal.text], ['any key', pal.accent, true], [' no', pal.text]]
    : msg ? [[' ', pal.text], [msg.text, msg.good ? pal.good : pal.bad, true]]
      : [[' ↑↓←→', pal.accent, true], [' move  ', pal.dim], ['enter', pal.accent, true], [' learn  ', pal.dim], ['r', pal.accent, true], [' respec  ', pal.dim], ['k', pal.accent, true], [' skills & loadout  ', pal.dim], ['◆ learned  ◈ partial  ◇ open  · locked', pal.dim]];

  // Narrow layout: one detail line for the selection instead of the panel.
  let detail = null;
  if (!sideW) {
    if (s.n < NODES) {
      const node = tree[s.b].nodes[s.n], why = blocker(d, s.b, s.n);
      detail = [[' ', pal.text], [node.name, pal.text, true], [` ${rankOf(P.sk, P.cls, s.b, s.n)}/${node.max} · `, pal.dim], [node.desc + ' ', pal.text], [why ? `(${why})` : '(enter to learn)', why ? pal.dim : pal.accent]];
    } else {
      const p = PARAGON[s.p];
      detail = [[' ', pal.text], [`Paragon: ${p.name} `, pal.text, true], [p.desc, pal.dim]];
    }
  }
  const bodyH = Math.max(0, h - 3 - (detail ? 1 : 0));
  const topPad = Math.max(0, Math.min(1, bodyH - treeRows.length));
  let view = treeRows;
  if (treeRows.length > bodyH) {
    const per = (treeRows.length - 4) / NODES;
    const off = Math.max(0, Math.min(treeRows.length - bodyH, Math.round(1 + Math.min(s.n, NODES) * per - bodyH / 2)));
    view = [treeRows[0], ...treeRows.slice(1 + off, off + bodyH)];
  }
  for (let i = 0; i < bodyH; i++) {
    const tr = view[i - topPad];
    const left = tr !== undefined ? tr : row(treeW, pal.panel, []);
    const right = sideW ? `${bg(pal.panel)} ${side[i] !== undefined ? side[i] : row(sideW, pal.panel2, [])}` : '';
    out.push(`${B()}│${left}${right}${B()}│${RESET}`);
  }
  if (detail) out.push(`${B()}│${row(inner, pal.panel, detail)}${B()}│${RESET}`);
  out.push(`${B()}│${row(inner, pal.panel2, status)}${B()}│${RESET}`);
  out.push(`${B()}╰${'─'.repeat(W - 2)}╯${RESET}`);
  return out.slice(0, h);
}


// ---------- loadout ----------

// The six hotbar skills for this hero (see C.loadoutFor).
function loadout(d) { return C.loadoutFor(d.lvl || 1, clsOf(d), skillData(d.state).loadout); }

// Put a known skill into a hotbar slot (0-5). If it's already on the bar,
// the two slots swap.
function equip(d, slot, id) {
  const cls = clsOf(d), skill = C.kitFor(cls).find((x) => x.id === id);
  if (!skill || slot < 0 || slot > 5) return false;
  if (skill.lvl > (d.lvl || 1)) return note(`${skill.name} unlocks at Lv ${skill.lvl}`);
  const cur = loadout(d).map((x) => x.id);
  const j = cur.indexOf(id);
  if (j === slot) return note(`${skill.name} is already in slot ${slot + 1}`);
  if (j >= 0) cur[j] = cur[slot];
  cur[slot] = id;
  const ok = saveSkills(d, (sk) => { sk.loadout = cur; });
  if (ok) note(`${skill.name} → slot ${slot + 1}`, true);
  return ok;
}

// ---------- skills & loadout view ----------

const ELC = () => require('./monsters').ELEMENT_COLOR;
const P_ = () => require('./panels');

function kitKey(key, d) {
  const s = sel(), kit = C.kitFor(clsOf(d));
  if (key === '\x1b[A') { s.k = (s.k + kit.length - 1) % kit.length; return true; }
  if (key === '\x1b[B') { s.k = (s.k + 1) % kit.length; return true; }
  if (key === '\x1b[D') { s.slot = (s.slot + 5) % 6; return true; }
  if (key === '\x1b[C') { s.slot = (s.slot + 1) % 6; return true; }
  if (key === 'e' || key === 'E' || key === '\r' || key === '\n') { equip(d, s.slot, kit[s.k].id); return true; }
  return false;
}

function kitTab(d, pal, W, h) {
  const s = sel(), cls = clsOf(d), kit = C.kitFor(cls), t = ui.tick;
  const P = P_(), retro = pal === UI.retro;
  const edgeC = X.mix(pal.panel, pal.text, 0.24);
  const B = () => `${bg(pal.panel)}${fg(edgeC)}`;
  const tier = require('./monsters').difficultyFor(d.lvl);
  const lo = loadout(d).map((x) => x.id);
  const out = [titleBar(W, pal, `SKILLS & LOADOUT · ${C.CLASSES[cls].name}`, [[` ${tier.label} `, retro ? pal.accent : tier.color, true]])];
  const inner = W - 2;
  const sideW = inner >= 96 ? Math.min(42, Math.floor(inner * 0.36)) : 0;
  const listW = inner - sideW - (sideW ? 1 : 0);
  const rows = [];
  rows.push(row(listW, pal.panel, [[' SLOT  SKILL', pal.dim, true]]));
  kit.forEach((sk, i) => {
    const known = sk.lvl <= (d.lvl || 1), slot = lo.indexOf(sk.id), isSel = s.k === i;
    const col = known ? (retro ? pal.accent : P.spellColor(sk, pal)) : X.mix(pal.dim, pal.panel, 0.25);
    const back = isSel ? X.mix(pal.panel, col, 0.25) : pal.panel;
    const el = sk.el || 'physical', elc = retro ? pal.dim : (ELC()[el] || pal.dim);
    const tag = sk.ult ? 'ULT' : sk.def ? 'DEF' : '';
    const nameW = Math.max(8, Math.min(24, listW - 34));
    const parts = [
      [isSel ? '▸' : ' ', pal.text, true],
      [slot >= 0 ? ` [${slot + 1}] ` : '     ', slot >= 0 ? pal.gold : pal.dim, slot >= 0],
      [`${P.spellIcon(sk, d)} `, col, true],
      [fit(sk.name, nameW).padEnd(nameW), known ? pal.text : pal.dim, known && isSel],
      [` Lv ${String(sk.lvl).padEnd(3)}`, known ? pal.dim : X.mix(pal.dim, pal.panel, 0.2)],
      [` ${el.padEnd(9)}`, known ? elc : X.mix(pal.dim, pal.panel, 0.25)],
      [` ${(sk.cd / 10).toFixed(1).padStart(4)}s `, pal.dim],
      [tag, sk.ult ? pal.gold : pal.good, true],
    ];
    rows.push(row(listW, back, parts));
  });
  // Loadout strip under the list.
  rows.push(row(listW, pal.panel, []));
  rows.push(row(listW, pal.panel, [[' HOTBAR', pal.accent, true], ['  ←→ pick a slot', pal.dim]]));
  const cellW = Math.max(6, Math.floor((listW - 1) / 6));
  let strip = `${bg(pal.panel)} `, used = 1;
  loadout(d).forEach((sk, i) => {
    const isSlot = s.slot === i, known = sk.lvl <= (d.lvl || 1);
    const back = isSlot ? X.mix(pal.panel2, pal.accent, 0.35 + 0.1 * Math.sin(t * 0.4)) : pal.panel2;
    const w = Math.min(cellW, listW - used);
    if (w <= 0) return;
    strip += cell(w - 1, `${i + 1} ${P.spellIcon(sk, d)} ${sk.name}`, known ? pal.text : pal.dim, back, isSlot) + `${bg(pal.panel)} `;
    used += w;
  });
  rows.push(strip + `${bg(pal.panel)}${' '.repeat(Math.max(0, listW - used))}`);

  const side = [];
  const sk = kit[s.k] || kit[0];
  if (sideW) {
    const line = (parts) => row(sideW, pal.panel2, parts);
    const known = sk.lvl <= (d.lvl || 1);
    const el = sk.el || 'physical';
    side.push(line([]));
    side.push(line([[' ', pal.text], [`${P.spellIcon(sk, d)} `, retro ? pal.accent : P.spellColor(sk, pal), true], [sk.name, pal.text, true], [sk.ult ? '  ULTIMATE' : sk.def ? '  DEFENSE' : '', sk.ult ? pal.gold : pal.good, true]]));
    side.push(line([[' ', pal.text], [el, retro ? pal.accent : ELC()[el] || pal.dim, true], [` · ${(sk.cd / 10).toFixed(1)} s cooldown · Lv ${sk.lvl}`, pal.dim]]));
    side.push(line([]));
    for (const l of wrapText(sk.desc || '', sideW - 2)) side.push(line([[' ', pal.text], [l, pal.text]]));
    side.push(line([]));
    const modes = (sk.modes || []).join(', ');
    side.push(line([[' Claude casts it when ', pal.dim]]));
    side.push(line([[' ', pal.text], [sk.id === 'basic' ? 'auto-attacking' : sk.def ? 'you are hurt' : modes || 'auto-attacking', pal.accent]]));
    side.push(line([]));
    side.push(line(known ? [[' e', pal.accent, true], [` equip in slot ${s.slot + 1}`, pal.text]] : [[` Unlocks at Lv ${sk.lvl}`, pal.bad, true]]));
    side.push(line([]));
    side.push(line([[' DIFFICULTY ', pal.accent, true], [tier.label, retro ? pal.accent : tier.color, true]]));
    side.push(line([[' Monster HP ', pal.dim], [`×${tier.hp.toFixed(2)}`, pal.text], ['  gold ', pal.dim], [`×${tier.gold.toFixed(2)}`, pal.gold]]));
  }
  const msg = s.msg && s.msg.until > t ? s.msg : null;
  const status = msg ? [[' ', pal.text], [msg.text, msg.good ? pal.good : pal.bad, true]]
    : [[' ↑↓', pal.accent, true], [' skill  ', pal.dim], ['←→', pal.accent, true], [' slot  ', pal.dim], ['e', pal.accent, true], [' equip  ', pal.dim], ['k', pal.accent, true], [' skill tree', pal.dim]];
  const detail = sideW ? null : [[' ', pal.text], [sk.name, pal.text, true], [` · ${sk.el || 'physical'} · `, pal.dim], [sk.desc || '', pal.text]];
  const bodyH = Math.max(0, h - 3 - (detail ? 1 : 0));
  // Keep the selected skill in view when the tab is short.
  const off = Math.max(0, Math.min(rows.length - bodyH, s.k + 1 - Math.floor(bodyH / 2)));
  const shown = rows.length > bodyH ? [rows[0], ...rows.slice(1 + off, off + bodyH)] : rows;
  for (let i = 0; i < bodyH; i++) {
    const left = shown[i] !== undefined ? shown[i] : row(listW, pal.panel, []);
    const right = sideW ? `${bg(pal.panel)} ${side[i] !== undefined ? side[i] : row(sideW, pal.panel2, [])}` : '';
    out.push(`${B()}│${left}${right}${B()}│${RESET}`);
  }
  if (detail) out.push(`${B()}│${row(inner, pal.panel, detail)}${B()}│${RESET}`);
  out.push(`${B()}│${row(inner, pal.panel2, status)}${B()}│${RESET}`);
  out.push(`${B()}╰${'─'.repeat(W - 2)}╯${RESET}`);
  return out.slice(0, h);
}

function wrapText(text, w) {
  const ls = [''];
  for (const wd of String(text).split(/\s+/)) {
    const cur = ls[ls.length - 1];
    if (!cur) ls[ls.length - 1] = wd;
    else if (vis(cur) + 1 + vis(wd) <= w) ls[ls.length - 1] = `${cur} ${wd}`;
    else ls.push(wd);
  }
  return ls.map((l) => fit(l, w));
}

// ╭─ TITLE ────── right ─╮ exactly W wide.
function titleBar(W, pal, title, right) {
  const edgeC = X.mix(pal.panel, pal.text, 0.24);
  const rw = right.reduce((n, p) => n + vis(p[0]), 0);
  const tt = fit(title, Math.max(0, W - 6 - rw));
  const fillN = W - 4 - vis(tt) - 1 - rw - 1;
  if (fillN < 0 || W < 8) return `${bg(pal.panel)}${fg(edgeC)}╭${'─'.repeat(Math.max(0, W - 2))}╮${RESET}`;
  return `${bg(pal.panel)}${fg(edgeC)}╭─ ${BOLD}${fg(pal.accent)}${tt}${NOBOLD}${fg(edgeC)} ${'─'.repeat(fillN)}${right.map(([x, c, b]) => `${b ? BOLD : ''}${fg(c)}${x}${b ? NOBOLD : ''}`).join('')}${fg(edgeC)}─╮${RESET}`;
}

module.exports = { NODES, loadout, equip, kitTab, TREES, TIER_LVL, PARAGON, treeFor, nodeId, totalRanks, skillData, points, respecCost, blocker, learn, learnParagon, respec, mods, skillsTab, skillsKey };
