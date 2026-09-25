# 🎮 Claude Arcade

Turn Claude Code into a game. While Claude thinks, plans, edits and runs commands you get an
animated HUD instead of plain text: XP, levels, HP, combos, achievements, and your subagents
show up as party members.

```
🔮 ✧✦  Consulting the oracle…  12s                         ⚔ party 2 🧝🧙
Lv 7 Code Knight ██████░░░░ 2,140/2,800 XP  ❤ ▰▰▰▰▰▱  🔥 x12 combo  ✦ mana 66%  💰 1.20g  Opus
```

It uses only ANSI text, the Claude Code status line and hooks, so it works in **any terminal**:
Warp, Windows Terminal, iTerm2, Kitty, VS Code, etc. The `retro` theme is pure ASCII for fonts
without emoji.

## 🕹 The game pane

Run `/claude-arcade:play` to open a full-screen, animated game that follows Claude live in a split
pane. Windows Terminal splits itself; in Warp press `Ctrl+Shift+D` (`Cmd+D` on macOS) and paste the
command it copies for you.

```
╭─ CLAUDE ARCADE · Dungeon Crawl ────────[1 Adventure] 2 Party  3 Trophies  4 Stats ─╮
│ Lv 3 Apprentice Coder  ██████░░░░░░░░ 240/600 XP   HP ▰▰▰▰▰▰▰▰▰▱ 90   combo x12  │
│ » Forging… auth.ts 4s                                                              │
├────────────────────────────────────────────────────────────────────────────────────┤
│ !                 !                 !                 !                 !          │
│ |                 |                 |                 |                 |          │
│                    S    R    o_T                                                   │
│                   /|\  /|\  /|  .---.                                              │
│                   / \  / \  / \  | |                                               │
│____________________________________________________________________________________│
├─ Quest log ────────────────────────────────────────────────────────────────────────┤
│ 15:18:41 🏹 A Ranger slips out of the shadows to scout: Explore                    │
│ 15:18:44 💥 Bash backfired! −10 HP                                                 │
│ 15:18:52 🏆 Loot secured. Forged 3 files, cast 2 spells. +48 XP in 41s.            │
╰ 1-4 tabs · t theme · s session · space cheer · q quit ─────────────────────────────╯
```

The hero sits by the campfire when idle, thinks in bubbles, paces the dungeon while reading and
searching, hammers an anvil while editing, throws lightning when running commands, gets hit by a
goblin when a tool fails, and opens a treasure chest when the turn is done. Subagents walk behind
the hero as party members. Tabs show your party, trophies with progress bars, and stats.

Keys: `1`-`4` or `←`/`→` switch tabs · `t` cycles the theme · `s` follows a specific session ·
`space` cheers · `q` quits.

## Preview it first

```sh
node demo.js          # rpg theme
node demo.js space
node demo.js retro
```

## Install

Requires Node.js 18+.

```sh
/plugin marketplace add superromz/claude-arcade
/plugin install claude-arcade@claude-arcade
/claude-arcade:setup            # or: /claude-arcade:setup space
```

To install from a local clone instead: `/plugin marketplace add /path/to/claude-arcade`.

`setup` is needed because plugins can't set the main status line or spinner by themselves. It
edits `~/.claude/settings.json` (`statusLine`, `subagentStatusLine`, `spinnerVerbs`,
`spinnerTipsOverride`) and saves your previous values so `/claude-arcade:uninstall` can put
them back.

## What you get

| Claude is… | HUD shows (rpg theme) |
|---|---|
| thinking | 🔮 Consulting the oracle |
| planning / todos | 📜 Drawing the battle map |
| reading files | 🧭 Scouting `auth.ts` |
| grep / glob | 🗺 Searching the dungeon |
| editing | ⚒ Forging `auth.ts` |
| running commands | ⚡ Casting `Run the test suite` |
| web / MCP | 🦅 Sending the scout eagle |
| launching agents | 🌀 Summoning the party |
| a tool failed | 💥 Took a hit (−10 HP) |
| waiting on you | 🛡 Awaiting your command |
| done | 🏆 Quest complete! +XP |

- **XP & levels**: every tool call earns XP (edits 5, commands 3, agents 10…), finishing a turn
  earns a bonus, and long combos earn extra. A new title every level.
- **HP**: failed tool calls cost HP; finishing turns heals.
- **Party**: each running subagent gets a class (Ranger, Sage, Paladin, Mage…) with an animated
  row and a stamina bar for its context usage.
- **Mana & gold**: remaining context window and session cost.
- **Achievements**: 13 to unlock, from *First Blood* to *Guild Master*.
- **Spinner**: themed verbs ("Rolling for initiative", "Brewing potions"…) and tips.
- **Toasts**: varied, themed messages with an end-of-turn summary ("Forged 3 files, cast 2 spells. +48 XP in 41s. Flawless!"). Only three hooks run in the foreground, so tool calls don't add "running hook" lines.

## Commands

| Command | |
|---|---|
| `/claude-arcade:setup [theme]` | Install the HUD |
| `/claude-arcade:play` | Open the interactive game pane |
| `/claude-arcade:theme rpg\|space\|retro` | Switch theme |
| `/claude-arcade:stats` | Hero sheet and achievements |
| `/claude-arcade:toggle toasts\|ascii` | Turn toasts or emoji off |
| `/claude-arcade:uninstall` | Restore your old status line and spinner |

Progress lives in `~/.claude/arcade/`. After updating the plugin, run `/claude-arcade:setup`
again to refresh the status line scripts.

## Development

```sh
npm test        # end-to-end tests against a throwaway HOME
npm run demo
```

Layout:

```
.claude-plugin/marketplace.json     this repo is also its own marketplace
plugins/claude-arcade/
  .claude-plugin/plugin.json
  hooks/hooks.json                  every event -> scripts/hook.js
  commands/*.md                     slash commands -> scripts/arcade.js
  scripts/lib.js                    state, XP, themes, achievements
  scripts/hook.js                   updates game state, emits toasts
  scripts/statusline.js             animated two-row HUD
  scripts/subagents.js              party member rows for subagents
  scripts/game.js                   interactive game pane
  scripts/messages.js               flavor text
```

Add a theme by adding an entry to `THEMES` in `scripts/lib.js`.

## License

MIT