# Loot and Chests

Every fight ends with a prize. When a wave falls you get a **wave chest**, and when Claude finishes
your prompt (a quest) you get a bigger **quest chest**. The harder the fight, the better the chest.

Chests never give XP. XP only comes from real Claude usage, because the global leaderboard depends on
it. See [Progression and XP](Progression-and-XP).

## Chest tiers

| Tier | Color | Gold (quest chest) | Gear | Materials | Buff |
|---|---|---|---|---|---|
| **Wooden** | Brown | 15-35 | 10% chance, mostly Common | 1-2 stacks, mostly Slime Gel and Bone Shard | 15% |
| **Iron** | Steel | 40-80 | 25% chance, up to Epic | 2-3 stacks, sometimes Ember Core | 30% |
| **Gold** | Gold | 90-160 | 50% chance, Legendary possible | 2-4 stacks, sometimes Moonsilver | 50% |
| **Epic** | Purple | 180-300 | 85% chance, plus a 25% second roll | 3-5 stacks, sometimes Starlight Dust | 70% |
| **Legendary** | Rainbow | 350-600 | Always, plus a 60% second roll, mostly Legendary | 4-6 stacks, Starlight Dust in every quest chest | Always |

- Gold also grows a little with your level, and a harder fight lands higher within its tier's range.
- Every chest has a small chance to **upgrade** one tier ("▲ UPGRADED from Iron!"). The harder the
  fight was, the better the chance.
- Every tier also has a tiny chance of a bonus **Legendary drop**: a Legendary item on top of
  everything else. The chance goes from 0.4% in a Wooden chest to 25% in a Legendary one.
- Wave chests are smaller than quest chests. They hold half the gold, one less material stack, and
  half the chance of gear and buffs.

## What decides the tier

**Wave chests** go up with the wave number. Elite waves (every 5th) and bosses beaten during the wave
push them higher, and your level adds a little. A wave chest on its own tops out at Epic (an upgrade
can still make it Legendary).

**Quest chests** measure the task Claude just finished:

- how many tools Claude used (edits, commands, reads, searches, web trips),
- how long the task took,
- failures the hero recovered from,
- tokens spent (the token XP from the task),
- agents launched,
- bosses beaten during the task (a boss is worth a lot).

A quick one-line answer gets a Wooden chest. A long task with lots of edits, a couple of failures and
a boss can open a Legendary one.

## Practice waves

Practice waves (`w`) give a small **Wooden** chest with a little gold (4-10, a bit more at high levels) and, sometimes, one Slime Gel or
Bone Shard. They never give gear, buffs or upgrades, so real work is always the way to the good
stuff.

## Rewards

- **Gold** goes straight into your hero's purse. Spend it in the [Shop](Shop).
- **Gear** is any cosmetic from the catalog: a hat, back item, aura, pet, weapon glow, trail,
  mount, tent, banner, campfire color or recruit outfit. Things you don't own yet are twice as
  likely to drop. New gear goes on right away if that slot is empty.
- **Duplicates:** gear you already own turns into a quarter of its worth in gold, plus materials
  (Common gives 2 Bone Shards, Rare 1 Ember Core, Epic 1 Moonsilver Ore, Legendary 2 Starlight Dust).
- **Materials** are kept as counts and are used for crafting (see below).
- **Buffs** start straight away, like buffs from the Shop: Whetstone, Lucky Charm, War Drum and, from
  Gold chests up, two chest-only potions.

Each chest is written to the quest log, for example:
`🎁 Gold Chest: 120 gold, Ember Core ×2, Flame Crown (epic)!`

## Materials

| Material | Rarity |
|---|---|
| Slime Gel | Common |
| Bone Shard | Common |
| Ember Core | Rare |
| Moonsilver Ore | Epic |
| Starlight Dust | Legendary |

Your materials show at the top right of the Shop (or in its footer on narrow screens). Each hero has
its own materials.

## Chest-only items

These items are never sold at their normal price. Win them from chests, or craft most of them in
the [Shop](Shop): select the item and press `Enter` when you have the materials. Crafting costs no
gold and equips the item. Items without a recipe are found in chests only. Now and then one of them
turns up as a rare **Daily Deal** in the Shop.

Wearing enough pieces of a set turns on its set bonus (a few percent more damage or gold, never
XP). See [Shop](Shop#item-sets).

| Set | Item | Slot | Rarity | Recipe |
|---|---|---|---|---|
| Slimebound | Slime Crown | Hat | Common | 6 Slime Gel |
| | Slime Coat | Weapon glow | Common | 8 Slime Gel, 2 Bone Shard |
| Bonecaller | Skull Helm | Hat | Rare | 8 Bone Shard, 3 Slime Gel |
| | Grave Glow | Weapon glow | Rare | 10 Bone Shard |
| | Bone Pup | Pet | Rare | 12 Bone Shard, 1 Moonsilver Ore |
| | Bone Wings | Back | Epic | 16 Bone Shard, 3 Moonsilver Ore |
| Emberforged | Flame Crown | Hat | Epic | 6 Ember Core, 2 Moonsilver Ore |
| | Ember Brand | Weapon glow | Epic | 8 Ember Core |
| | Emberling | Pet | Epic | 10 Ember Core, 2 Moonsilver Ore |
| | Phoenix Wings | Back | Legendary | Chests only |
| Starlight | Starlight Circlet | Hat | Legendary | 8 Starlight Dust, 4 Moonsilver Ore |
| | Starlight Edge | Weapon glow | Legendary | 6 Starlight Dust, 3 Moonsilver Ore |
| | Star Sprite | Pet | Legendary | 14 Starlight Dust, 6 Ember Core |
| | Starlight Aura | Aura | Legendary | Chests only |
| (no set) | Ember Drake | Mount | Legendary | 24 Ember Core, 6 Starlight Dust |

Chest-only buffs (these start as soon as they drop):

| Buff | Effect |
|---|---|
| Phoenix Draught | Double damage for 2 waves |
| Midas Tonic | Triple gold for 2 waves |
| Rubber Duck Oracle | +50% damage and +50% gold for 3 waves |

## The chest opening

- **Quest chests** take over the screen for about 4 seconds: the chest drops in, shakes with light
  leaking from the seam, then the lid bursts open with light rays, coins and gems. The tier's name
  appears in big letters and the rewards pop out one by one. Press any key to skip to the full list,
  and any key again to close it.
- **Wave chests** are a quick popup in the top-right corner of the battlefield. They don't take your
  keys, so you can keep casting.
- A quest chest waits for a boss finisher or a VICTORY or LEVEL UP banner to finish first.
