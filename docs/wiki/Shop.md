# Shop

The Shop is where you spend the gold your hero collects from monsters. Open it with `tab` (or `←`
`→`, or a click on **Shop**). It's tab 5 in the game pane.

![The Shop tab showing hats, with the hero previewing a Party Hat](https://raw.githubusercontent.com/Superromz/claude-arcade/main/docs/images/shop-tab.png)

It sells two kinds of things:

- **Cosmetics** that show on your hero everywhere: in battle, at camp, on the Hero tab and on your
  roster card.
- **Battle buffs** that make your hero hit harder or collect more gold for a few waves.

Nothing in the Shop gives XP, ever. XP only comes from real Claude usage, because the global
leaderboard depends on it. See [Progression and XP](Progression-and-XP).

## Getting gold

Every monster you slay drops gold, including monsters in practice waves (`w`). Tougher monsters,
elite leaders and bosses drop more, and quick chains of kills add a bonus. Your gold shows at the top
right of the Shop, on the Hero tab and on your roster card. Each hero has its own purse.

## Keys

| Key | Action |
|---|---|
| `←` `→` | Previous or next item |
| `↑` `↓` | Move between rows, and on to the previous or next category |
| `Enter` | Buy the item. On something you own: equip it, or unequip it if it's already on |
| `u` | Unequip whatever you're wearing in the selected item's slot |
| `tab` | Leave the Shop for the next tab |
| `q` | Quit the game |

While the Shop is open, the arrow keys browse items instead of switching tabs, so use `tab` or a
click to leave.

## How it works

- The left panel previews your hero wearing the selected item, with its rarity, price and
  description.
- Item cards are grouped by slot: **Hats, Back, Auras, Pets, Weapon glow, Buffs**. Each card shows
  its price, or **Owned**, or **✓ Equipped**. A price in red means you can't afford it yet.
- Buying a cosmetic equips it right away (with a **LOOT!** banner) and keeps it in your inventory
  for good. You can wear one item per slot.
- If you're short on gold, the footer tells you how much more you need.

![A mage wearing a crown and the Fire Aura](https://raw.githubusercontent.com/Superromz/claude-arcade/main/docs/images/shop.png)

## Catalog

Items come in four rarities: Common, Rare, Epic and Legendary.

| Slot | Item | Rarity | Price |
|---|---|---|---|
| Hats | Party Hat | Common | 60 |
| | Flower Crown | Common | 90 |
| | Top Hat | Common | 140 |
| | Pirate Hat | Rare | 260 |
| | Wizard Hat of Stars | Rare | 320 |
| | Horned Helm | Rare | 360 |
| | Royal Crown | Epic | 650 |
| | Halo | Legendary | 1,200 |
| Back | Jetpack | Rare | 380 |
| | Rainbow Cape | Epic | 600 |
| | Angel Wings | Legendary | 1,100 |
| Auras | Sparkle Aura | Rare | 300 |
| | Fire Aura | Epic | 550 |
| | Frost Aura | Epic | 550 |
| | Shadow Aura | Legendary | 900 |
| Pets | Slime Buddy | Common | 150 |
| | Cat | Common | 200 |
| | Owl | Rare | 280 |
| | Robot | Epic | 520 |
| | Dragon Whelp | Legendary | 950 |
| Weapon glow | Flame Enchant | Rare | 240 |
| | Frost Enchant | Rare | 240 |
| | Void Enchant | Epic | 480 |

## Buffs

| Buff | Price | Effect |
|---|---|---|
| Whetstone | 40 | +25% damage for 3 waves |
| Lucky Charm | 60 | Double gold for 3 waves |
| War Drum | 90 | +50% damage for 2 waves |

- Buffs apply to your hero's spells and attacks (damage) and to the gold monsters drop.
- A buff counts down by one each time a wave is cleared, practice waves included. The Shop's footer
  shows your active buffs and how many waves each has left.
- Buying a buff you already have adds its waves on top. Different buffs stack: a Whetstone and a War
  Drum together give 1.25 × 1.5 damage.
- Buffs last for the current game session. They're gone if you close the game pane, so buy them
  when you're about to fight.
