# Commands and Controls

## Slash commands

Run these inside Claude Code.

| Command | What it does |
|---|---|
| `/claude-arcade:setup [rpg\|space\|retro]` | Install the status line, agent party rows, themed spinner and the `arcade` command. Run it again after updating the plugin |
| `/claude-arcade:play` | Open the game pane. Splits Windows Terminal automatically; elsewhere it tells you how and copies the command |
| `/claude-arcade:theme rpg\|space\|retro` | Switch theme, including the spinner |
| `/claude-arcade:stats` | Hero sheet, hero roster, project leaderboard and achievements |
| `/claude-arcade:toggle toasts` | Turn the quest, level-up and achievement messages on or off |
| `/claude-arcade:toggle ascii` | Turn emoji in the status line off or on |
| `/claude-arcade:toggle approvals` | Turn [in-game approvals](In-Game-Approvals) off or on |
| `/claude-arcade:uninstall` | Restore your previous status line and spinner and remove the `arcade` command. Keeps your progress |

To remove the plugin's hooks too, run `/plugin uninstall claude-arcade`.

## The `arcade` command

Run `arcade` in any terminal pane to start the game. It follows your most recent Claude session
automatically. See [Getting Started](Getting-Started#3-open-the-game-pane) for where setup installs
it.

## Game pane keys

| Key | Action |
|---|---|
| `1`-`6` | Cast a hotbar spell (1.5× damage, with cooldowns) |
| `space` | Basic attack |
| Click a monster | Strike it |
| Click a hotbar slot | Cast that spell |
| Click a tab name | Switch to that tab |
| `w` | Summon a practice wave when the field is empty (gold only, no XP) |
| `tab`, `→` | Next tab (in the Shop, `→` browses instead) |
| `←` | Previous tab (in the Shop, `←` browses instead) |
| `h` | Open the [Hero Roster](Hero-Roster) |
| `c` | Change your hero's look in the character creator |
| `t` | Cycle the theme |
| `p` | Pin a different Claude session, cycling through recent ones, then back to following the latest |
| `q` / `Esc` | Quit. It asks first: `Y` or Enter quits, any other key stays. `Ctrl+C` quits right away |

### Tabs

| # | Tab | Shows |
|---|---|---|
| 1 | Adventure | The battlefield (or the camp), plus your hero card, companions and quest log on wide terminals |
| 2 | Hero | Portrait, stats, XP, tokens, gold, kills, spellbook and your "Deeds" |
| 3 | [Skills](Skill-Tree) | Your class skill tree, respec and paragon |
| 4 | Party | Your companions and recent adventures |
| 5 | [Guild](Guild) | Recruit finished agents as permanent companions |
| 6 | [Bounties](Bounties) | Daily and weekly challenges; Enter claims a finished one |
| 7 | Trophies | Achievements with progress bars |
| 8 | [Shop](Shop) | Cosmetics and battle buffs to buy with gold |
| 9 | Projects | Your stats per project. See [Project Stats](Project-Stats) |

Switch tabs with `tab`, `←` `→`, or a click on the tab name. The number keys are the hotbar, not tab
shortcuts.

### Shop

| Key | Action |
|---|---|
| `←` `→` `↑` `↓` | Browse items |
| `Enter` | Buy, or equip and unequip an item you own |
| `u` | Unequip the selected item's slot |
| `tab` | Next tab (the arrow keys browse while the Shop is open) |

### Permission dialog

| Key | Action |
|---|---|
| `Y` | Allow once |
| `N` | Deny |
| `C` | Answer in Claude instead |

### Hero roster

| Key | Action |
|---|---|
| `←` `→`, `tab` | Choose a hero |
| `Enter` | Play |
| `n` | New hero |
| `e` | Edit look |
| `x` `x` | Delete (press twice) |
| `q`, `Esc` | Quit |

### Character creator

| Key | Action |
|---|---|
| `↑` `↓`, `tab` | Move between fields |
| `←` `→` | Change the value |
| Letters, `Backspace` | Edit the name |
| `Enter` | Save and play |
| `Esc` | Cancel |

## Terminal size

The game fits itself to your pane. At 130 columns or wider, the Adventure tab shows the hero card,
companions and quest log beside the battlefield. In narrower panes, the quest log sits under it.
