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
5. **A tool fails.** A monster lunges at your hero, and you lose session HP (see
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

Harder tiers make bosses meaner: from Veteran their slam hurts your battle HP, from Heroic they
make a **Last Stand** at 20% HP (a shield and three minions) and bring affixes of their own, and
from Mythic they roll a **dark nova** at you every few seconds. Abyss bosses slam more often.

When Claude finishes the task, your hero lands a **finisher** on the boss. If Claude goes idle
before that, the boss retreats. A boss is worth 50 to 150 XP and a big pile of gold, and a
**VICTORY** banner marks the moment (see [Camp and Celebrations](Camp-and-Celebrations)).

## Class skills

Every class has a **basic attack**, **ten more skills** and an **ultimate**, unlocked as you level:
Lv 3, 5, 8, 12, 18, 25, 30, 40, 50, 60, and the ultimate at **Lv 75**. Claude's activity picks which
skill to cast: each class leans on the skill that fits what Claude is doing, and the hero also
auto-attacks while Claude works. Skill ranks, extra targets, shorter cooldowns and new effects come
from the [Skill Tree](Skill-Tree).

| Class | Lv 3 | Lv 5 | Lv 8 | Lv 12 | Lv 18 |
|---|---|---|---|---|---|
| Mage | Fireball (area, burn) | Frost Nova (freeze ring) | Chain Lightning | Meteor | Starfall |
| Ranger | Multishot | Snare Trap (root) | Piercing Arrow (hits all in a line) | Rain of Arrows | Eagle Strike |
| Knight | Shield Bash (stun) | Taunt (all) | Whirlwind | Holy Strike (light pillar, heals) | Judgment (stuns all) |
| Warlock | Curse (damage over time) | Drain Life (heals you) | Summon Imp (fights for 8 s) | Shadowflame (burning cone) | Doom (bursts for 4× later) |
| Bard | Anthem (+25% party damage) | Discord (stun ring) | Echo (replays your last skill) | Crescendo (sound wave) | Encore (hits all, resets cooldowns) |
| Rogue | Backstab (dash, high crit) | Poison Blade | Smoke Bomb (dodge) | Shadow Step (2 targets) | Death Mark (+50% damage taken, then bursts) |

| Class | Lv 25 | Lv 30 | Lv 40 | Lv 50 | Lv 60 | Lv 75 ultimate |
|---|---|---|---|---|---|---|
| Mage | Arcane Barrier (shield) | Blizzard (freezing storm) | Ball Lightning (drifting orb) | Inferno (fire pillars on all) | Time Warp (stops time, heals) | Arcane Cataclysm |
| Ranger | Second Wind (heal) | Explosive Arrow | Frost Volley (5 freezing arrows) | Wolf Pack (2 wolves) | Storm Arrow (piercing, chains lightning) | Thousand Arrows |
| Knight | Tower Shield (−60% damage, taunt) | Lay on Hands (heal 35%) | Consecration (holy ground) | Ground Slam (stun shockwave) | Avenging Wrath (+50% damage, lifesteal) | Divine Storm |
| Warlock | Dark Pact (shield) | Fear (all flee) | Rain of Fire | Summon Demon | Soul Rot (curses all, heals you) | Oblivion (black hole) |
| Bard | Lullaby (sleep all, heal) | Healing Hymn | Power Riff (chain lightning) | Drum Line (4 beats) | Siren Song (monsters hit each other) | Symphony of Destruction |
| Rogue | Vanish (dodge, heal, next hit crits) | Fan of Knives (bleed all) | Garrote (stun, bleed) | Cluster Bomb | Blade Flurry (8 slashes) | Thousand Cuts |

- **Defensive skills** (shields, heals, Tower Shield, Vanish…) are cast automatically when your
  hero is hurt. Avenging Wrath also fires when a boss shows up.
- **Ultimates** fire when a big fight starts (3+ monsters or a boss), at most every 40 s.
- Every skill has an **element**: fire, frost, lightning, shadow, holy or physical. Monsters can
  resist one element or be weak to another (see [Difficulty](#difficulty)).

### Hotbar loadout

The hotbar has **6 slots**. Until you know more than six skills it shows your first six; after
that it holds your basic attack plus your five newest skills. To choose your own, open the
**Skills** tab and press `k` for **Skills & Loadout**: `↑↓` picks a skill, `←→` picks a slot, and
`e` (or `Enter`) puts it there. If the skill is already on the bar, the two slots swap. Claude's
activity can still cast **any** skill you know, equipped or not.

## Difficulty

Fights get harder as your hero grows. The tier shows in the top-right corner of the battle and on
the Skills tab.

| Tier | Hero level | Monster HP | Monster hits | Affixes | Gold |
|---|---|---|---|---|---|
| Normal | 1-19 | ×1 | light | elites get 1 | ×1 |
| Veteran | 20-34 | ×1.2 | moderate | elites 1-2, some monsters 1 | ×1.25 |
| Heroic | 35-49 | ×1.3 | heavy | elites 2-3, a third of monsters 1 | ×1.5 |
| Mythic | 50-59 | ×1.9 | brutal | elites 3, most monsters 1-2 | ×2 |
| Abyss 1, 2, 3… | 60+ | ×2.2, +6% per Abyss level | +0.8% per level | more with depth | ×2.5, +0.2 per level |

A new Abyss level comes every 3 hero levels past 60, with no cap. Harder tiers also give better
chests (see [Loot and Chests](Loot-and-Chests)). **XP never depends on the tier**: a monster is
worth the same XP on Normal and on Abyss 20.

### Monster affixes

Affixes show as colored pips over a monster's HP bar and as words on its name tag.

| Affix | What it does | How to beat it |
|---|---|---|
| Armored | Every direct hit loses a flat amount | Big hits, damage over time, armor-piercing nodes |
| Shielded | A blue shield bar must break before HP drops | Lightning and heavy skills break shields 2-3× faster |
| Swift | Moves and attacks faster | Stuns, roots and freezes |
| Regenerating | Green shimmer; heals 2% a second | Burn or poison stops the healing |
| Vampiric | Heals 15% when it hits you | Dodge, taunt, shields |
| Splitting | Splits into two small copies on death | Area damage. The copies give no XP |
| Enraging | Below 30% HP it hits harder and faster | Burst it down |
| Resistant / Weak | Half damage from one element, or +50% from one | Watch the name tag |

## Battle HP and knockouts

Your hero has **battle HP** (the bar over their head), separate from the session HP that tool
failures cost. It grows with level, main stat and the skill tree, regenerates slowly in a fight
and quickly between waves. Monsters' lunges and boss slams hurt it; dodges, taunts, a Knight
companion, shields and damage-reduction nodes soften the blows, and healing skills restore it.

At 0 HP your hero is **knocked out**: the battle greys out for a few seconds, the monsters walk
away without dropping anything, and your wave streak and gold combo reset. Then your hero is back
at full HP. **Nothing real is lost**: XP, banked gold and items all stay.

With a good build, knockouts are rare; on Heroic and above a fresh or thin build will be knocked
out now and then. On Normal they almost never happen.

## Playing along

You don't have to do anything, but you can:

| Input | What it does |
|---|---|
| `1`-`6` | Cast that hotbar slot for **1.5× damage**. Each skill has a cooldown, shown as the slot refilling |
| `space` | Basic attack |
| Click a monster | Strike it directly (a quick hit with a short cooldown) |
| Click a hotbar slot | Cast that spell |
| `w` | Summon a **practice wave** when the field is empty |

Cooldowns run from 0.6 s (basic attack) to 40 s (ultimates); the Skills & Loadout view lists each one.

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

## Chests

Every cleared wave drops a small chest in the corner, and every finished quest drops a big one.
Tougher waves and harder quests give better chests. See [Loot and Chests](Loot-and-Chests).

## Gold and kills

- Every monster drops gold coins that fly to your hero. Tougher monsters drop more, quick chains of
  kills ("3x COMBO!") add bonus gold, and a Lucky Charm from the Shop doubles it.
- Kills during a real task also give XP (shown on the monster's name tag).
- Gold and kill counts are saved to your hero every few seconds. Spend gold in the [Shop](Shop).
