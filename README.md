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

Run `/claude-arcade:play` to open the game in a split pane (in Warp: `Ctrl+Shift+D`, then paste the
command it copies for you). It's pixel art rendered with half-block characters in 24-bit color.

**Create your hero.** On first launch (or press `c`) pick a name, class, colors, skin, hair and an
accessory. Each class has its own look, weapon and XP bonus:

| Class | Weapon | Bonus |
|---|---|---|
| Mage | staff | +50% XP from commands |
| Ranger | bow | +50% XP from reading & searching |
| Knight | sword & shield | +50% XP from edits |
| Warlock | familiar | +50% XP from agents |
| Bard | lute | +50% XP from web, MCP & planning |
| Rogue | daggers | double combo bonus |

**Battle while Claude works.** When a task starts, waves of monsters attack (slimes, bats,
skeletons, goblins, and a warlord boss every 5th wave). Every tool call Claude makes is a spell
cast; your agents fight as companions. New spells unlock as you level: Fireball (3), Frost Shard (5),
Chain Lightning (8), Meteor (12), Starfall (18). Kills drop gold and XP; practice waves give gold only.

**Play along.** `1`-`6` or `space` cast from your hotbar (with cooldowns), click monsters to strike
them, `w` summons a practice wave when idle, `tab`/`←→` switch views (Adventure, Hero, Party,
Trophies), `t` theme, `p` pick session, `q` quit.

**Real progress.** XP comes from tool use, finished tasks, monsters slain, and the actual tokens in
your Claude Code transcripts. Your stats (STR, INT, DEX, WIS, CHA) grow from how you use Claude.
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
- **Mana & cost**: mana is the context window Claude has left; the session's dollar cost shows as "$1.20 spent".
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