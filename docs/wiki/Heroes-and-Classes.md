# Heroes and Classes

Your hero is you in the game. It levels up from your real Claude usage, and its class decides which
kind of work earns you extra XP and which stat grows fastest.

## The six classes

| Class | Main stat | XP bonus | Weapon | Basic attack |
|---|---|---|---|---|
| Mage | INT | +50% XP from commands | Staff | Arcane Spark |
| Ranger | DEX | +50% XP from reading and searching | Bow | Arrow |
| Knight | STR | +50% XP from edits | Sword and shield | Sword Wave |
| Warlock | CHA | +50% XP from agents | Familiar | Shadow Bolt |
| Bard | WIS | +50% XP from web, MCP and planning | Lute | Power Chord |
| Rogue | DEX | Double combo bonus | Daggers | Throwing Knife |

Pick the class that matches how you work. If Claude spends most of its time editing files, a Knight
levels fastest. If you run lots of agents, try a Warlock.

### How the bonus works

A tool call's base XP is multiplied by 1.5 (rounded) when it matches your class. For example, an
edit is worth 5 XP, or 8 XP for a Knight. A command is worth 3 XP, or 5 for a Mage.

The Rogue gets no per-tool bonus. Instead, the combo bonus (see
[Progression and XP](Progression-and-XP#combo)) is doubled, so a Rogue who keeps a long streak of
successful tool calls going earns the most from it.

### Main stat

Your class's main stat gets +5, and it also powers your damage in battle: the higher it is, the
harder your spells hit. See [Combat and Spells](Combat-and-Spells#damage).

## The character creator

![The character creator with a Bard selected](https://raw.githubusercontent.com/Superromz/claude-arcade/main/docs/images/creator.png)

The creator opens the first time you start the game, when you press `n` on the
[Hero Roster](Hero-Roster), and when you press `c` in the game to change your look. A live preview
of your hero updates as you go.

| Field | Choices |
|---|---|
| Name | Type any name |
| Class | Mage, Ranger, Knight, Warlock, Bard, Rogue |
| Robe | royal, crimson, forest, violet, gold, teal, charcoal, snow, rose, orange |
| Trim | Same colors as the robe |
| Skin | light, tan, brown, deep |
| Hair | brown, black, blond, red, white, blue |
| Accessory | none, cape, beard, scarf |

Each class also gives your hero its own headgear (wizard hat, hood, helm, horns, cap or mask),
weapon and attack animations. The creator shows the class's starting stats, its basic attack and the
levels at which its spells unlock. Cosmetics you buy in the [Shop](Shop) are worn on top of your
look.

### Creator keys

| Key | Action |
|---|---|
| `↑` `↓` (or `tab`) | Move between fields |
| `←` `→` | Change the value |
| Letters, `Backspace` | Edit the name |
| `Enter` | Begin your adventure (or save changes) |
| `Esc` | Cancel. On a brand-new install, it starts with the default hero |

Changing your look or even your class later keeps your XP and level. The class bonus applies to XP
you earn from then on.

## Where to see your hero

- **Hero tab** in the game pane (`tab` to switch): portrait, stats, XP, tokens, gold, kills, your
  spellbook and a "Deeds" chart of what you've done most.
- **Status line:** your hero's name, level and class on the second row.
- **`/claude-arcade:stats`:** a text hero sheet. See [Project Stats](Project-Stats).
