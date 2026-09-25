# Combat and Spells

The Adventure tab is a battlefield that follows Claude. When Claude is working, monsters attack.
When Claude finishes, you win.

![A mage fighting Ignarok the Magma Drake in the lava cave](https://raw.githubusercontent.com/Superromz/claude-arcade/main/docs/images/boss-drake.png)

## How a fight goes

1. **You send a prompt.** Claude starts working, and a wave of monsters walks in from the right.
2. **Claude uses tools.** Every tool call casts a spell that matches what Claude is doing. Editing a
   file might throw a Fireball; running a command might cast Chain Lightning.
3. **Your hero auto-attacks** while Claude is busy, and attacks faster as you level up (from about
   every 2.4 seconds at level 1 down to every 0.6 seconds).
4. **Companions fight too.** Agents Claude launches join the battle. See [Companions](Companions).
5. **A tool fails.** A monster lunges at your hero, and you lose HP (see
   [Progression and XP](Progression-and-XP#hp)).
6. **Claude finishes.** Every monster left on the field is wiped out in one blow. Victory!

When Claude is idle or waiting for you, the monsters retreat and your hero makes camp (see
[Camp and Celebrations](Camp-and-Celebrations)).

## Waves

- A new wave spawns whenever the field is clear and Claude is still working.
- Waves grow from 2 up to 6 monsters and get tougher as the wave number rises.
- **Every 5th wave is an elite wave:** fewer monsters, led by the toughest monster in the biome with
  triple HP and a bigger share of the XP.
- The monsters depend on your [biome](Biomes-and-Themes), which depends on your level.
- When a wave falls, the quest log shows "Wave N cleared!" with the XP it gave.

Every monster has an HP bar and a name tag with its level, HP and XP value. Hits show damage
numbers, and crits show in orange.

## Bosses

If a single task keeps Claude busy for more than 90 seconds, a boss arrives: a big, named foe for
your current biome.

| Biome | Boss |
|---|---|
| Dungeon | Goblin Warlord |
| Forest | Elderbark the Ancient |
| Lava cave | Ignarok the Magma Drake |
| Castle | The Lich King |

Bosses fight in phases. They summon minions at 70% and 40% HP, become **enraged** below 35%, and
telegraph a ground slam ("!!") before they crash down. A Knight companion blocks the slam.

When Claude finishes the task, your hero lands a **finisher** on the boss. If Claude goes idle
before that, the boss retreats. A boss is worth 50 to 150 XP and a big pile of gold, and a
**VICTORY** banner marks the moment (see [Camp and Celebrations](Camp-and-Celebrations)).

## Class skills

Every class has a **basic attack** plus **five skills of its own**, unlocked at levels 3, 5, 8, 12
and 18. Claude's activity picks which skill to cast: each class leans on the skill that fits what
Claude is doing, and the hero also auto-attacks while Claude works. Skill ranks, extra targets,
shorter cooldowns and new effects come from the [Skill Tree](Skill-Tree).

| Class | Lv 3 | Lv 5 | Lv 8 | Lv 12 | Lv 18 |
|---|---|---|---|---|---|
| Mage | Fireball (area, burn) | Frost Nova (freeze ring) | Chain Lightning | Meteor | Starfall |
| Ranger | Multishot | Snare Trap (root) | Piercing Arrow (hits all in a line) | Rain of Arrows | Eagle Strike |
| Knight | Shield Bash (stun) | Taunt (all) | Whirlwind | Holy Strike (light pillar) | Judgment (stuns all) |
| Warlock | Curse (damage over time) | Drain Life (heals HP) | Summon Imp (fights for 8 s) | Shadowflame (burning cone) | Doom (bursts for 4× later) |
| Bard | Anthem (+25% party damage) | Discord (stun ring) | Echo (replays your last skill) | Crescendo (sound wave) | Encore (hits all, resets cooldowns) |
| Rogue | Backstab (dash, high crit) | Poison Blade | Smoke Bomb (dodge) | Shadow Step (2 targets) | Death Mark (+50% damage taken, then bursts) |

Base cooldowns: basic 0.6 s, then 3 / 3 / 5 / 9 / 15 s. The hotbar (`1`-`6`) shows your class's
skills in unlock order.

## Playing along

You don't have to do anything, but you can:

| Input | What it does |
|---|---|
| `1`-`6` | Cast that hotbar skill for **1.5× damage**. Each spell has a cooldown, shown as the slot refilling |
| `space` | Basic attack |
| Click a monster | Strike it directly (a quick hit with a short cooldown) |
| Click a hotbar slot | Cast that spell |
| `w` | Summon a **practice wave** when the field is empty |

Cooldowns: basic attack 0.6 s, Fireball and Frost Shard 3 s, Chain Lightning 5 s, Meteor 9 s,
Starfall 15 s.

**Practice waves** are for fun between tasks. They drop gold but never XP, because XP only comes from
real Claude usage.

## Damage

Damage grows with your level and your class's main stat:

- **+12% per level** above 1.
- **Main stat bonus:** damage × (1 + stat ÷ 60).
- **Crits:** 15% chance to deal **double damage**. Some companions crit more often.
- A Bard in your party gives everyone **+20% damage**.
- Damage buffs from the [Shop](Shop) (Whetstone, War Drum) multiply your hero's damage.
- Fireball and Meteor leave a burn, and the Warlock's curse deals damage over time.

## Gold and kills

- Every monster drops gold coins that fly to your hero. Tougher monsters drop more, quick chains of
  kills ("3x COMBO!") add bonus gold, and a Lucky Charm from the Shop doubles it.
- Kills during a real task also give XP (shown on the monster's name tag).
- Gold and kill counts are saved to your hero every few seconds. Spend gold in the [Shop](Shop).
