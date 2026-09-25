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
  earns a bonus, and long combos earn extra. New title every two levels.
- **HP**: failed tool calls cost HP; finishing turns heals.
- **Party**: each running subagent gets a class (Ranger, Sage, Paladin, Mage…) with an animated
  row and a stamina bar for its context usage.
- **Mana & gold**: remaining context window and session cost.
- **Achievements**: 13 to unlock, from *First Blood* to *Guild Master*.
- **Spinner**: themed verbs ("Rolling for initiative", "Brewing potions"…) and tips.
- **Toasts**: short messages for quests, level-ups, achievements and new party members.

## Commands

| Command | |
|---|---|
| `/claude-arcade:setup [theme]` | Install the HUD |
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
```

Add a theme by adding an entry to `THEMES` in `scripts/lib.js`.

## License

MIT