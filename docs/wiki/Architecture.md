# Architecture

How Claude Arcade is built, for contributors. Player-facing behavior is described on the other wiki
pages; this page is where implementation detail belongs.

## Overview

Claude Arcade is a Claude Code plugin with no runtime dependencies (Node 18+). Three kinds of
processes share state through files in `~/.claude/arcade/`:

```
Claude Code ──hook events──▶ hook.js ──▶ state.json (under a lock)
                                     └─▶ events.jsonl (append-only quest log)
                                     └─▶ toasts (stdout JSON, foreground hooks only)

Claude Code ──every second──▶ statusline.js / subagents.js ──reads──▶ state.json, config.json

arcade (game.js, own pane) ──10 fps──reads──▶ state.json, config.json, events.jsonl
                           ──writes──▶ gold, kills, battle XP, inventory (under the same lock)
                           ──writes──▶ equipped cosmetics (config.json)
                           ◀──files──▶ approvals/ (PermissionRequest hook)
```

## Repository layout

```
.claude-plugin/marketplace.json     this repo is its own plugin marketplace
plugins/claude-arcade/
  .claude-plugin/plugin.json
  hooks/hooks.json                  every hook event runs scripts/hook.js
  commands/*.md                     slash commands, each runs scripts/arcade.js
  scripts/                          all game code (see below)
test/                               node:test suites
tools/ansi2png.py                   dev tool: render a snapshot to a PNG
demo.js                             scripted status line preview
docs/                               wiki pages and images
```

## Modules

| File | Role |
|---|---|
| `lib.js` | Shared core: file paths, JSON I/O, the state lock, quest log, sessions, per-project stats, hero roster, XP and level math, themes, tool-to-mode mapping, achievements, `visWidth` |
| `hook.js` | The single entry point for every hook event. Updates state, awards XP, logs events, prints toasts, and handles in-game approvals |
| `arcade.js` | CLI behind the slash commands: `setup`, `play`, `theme`, `stats`, `toggle`, `uninstall` (plus `reset`) |
| `statusline.js` | The two-row status line HUD |
| `subagents.js` | The `subagentStatusLine` rows that show agents as party members |
| `messages.js` | Flavor text pools per theme, the turn summary, and the agent-to-class mapping (`classFor`) |
| `character.js` | Classes, customization options, class XP bonus, stats, token reading and token XP, spells and damage |
| `game.js` | The game pane: main loop, input (keys and SGR mouse), approvals dialog, saving progress, `--snapshot` |
| `state.js` | Shared game-pane state (`ui`), theme palettes, tabs, `snapshotData`, biome by level |
| `battle.js` | Waves, bosses, spells, companions, damage, crits, loot and battle effects |
| `monsters.js` | Monster sprites, biome rosters, bosses, and monster animations |
| `scene.js` | Composes the scene: background, idle camp, hero, companions, monsters, effects, the hero's thought bubble and the camp recap board |
| `backgrounds.js` | Parallax biome and space-sector backgrounds with weather |
| `sprites.js` | Layered hero sprites (body, headgear, accessory, arms, weapon rig) with per-class attack, camp and sleep animations, and mini-class companions |
| `pixel.js` | `PixelCanvas`: a truecolor canvas drawn with `▀` half-blocks, two pixels per cell |
| `panels.js` | Text UI: header, footer, hotbar, hero card, tabs and quest log |
| `creator.js` | Character creator screen |
| `roster.js` | Hero roster screen |
| `items.js` | Shop catalog, equipment drawing on the hero, and battle buffs (damage and gold multipliers, counted down per cleared wave) |
| `shop.js` | The Shop tab: item cards, hero preview, buying, equipping |
| `projects.js` | The Projects tab |
| `celebrate.js` | LEVEL UP, VICTORY, LOOT and TROPHY banners composited over a finished frame |

## Hooks

`hooks/hooks.json` sends every event to `hook.js` with the event name as an argument.

| Event | Runs | What it does |
|---|---|---|
| `SessionStart` | foreground | Streak, session and project bookkeeping, welcome toast |
| `UserPromptSubmit` | async | Starts a new quest (turn). Synthetic prompts from background tasks (starting with `<`) continue the current one |
| `PreToolUse` | async | Sets the mode and detail the HUD and game show; logs an `action` event the game turns into a spell |
| `PostToolUse` | async | Counts the tool, grows the combo, awards tool XP. The Agent/Task tool is skipped, because agents are counted once, on `SubagentStart` |
| `PostToolUseFailure` | async | −10 HP, breaks the combo |
| `SubagentStart` | foreground | Adds a party member, awards XP, toast |
| `SubagentStop` | async | Removes the party member, +5 XP, reads the agent's transcript for token XP |
| `Notification` | async | "Waiting on you" mode |
| `PreCompact` | async | Rest animation while Claude compacts |
| `Stop` | foreground | Completes the quest: +10 XP, heal, token XP, turn summary toast |
| `PermissionRequest` | foreground, 120 s timeout | In-game approvals (see below) |

Only foreground hooks can print toasts, and only `SessionStart`, `SubagentStart` and `Stop` are
foreground among the game events, so tool calls never show "running hook" lines. Messages produced
by async hooks (level-ups, achievements, faints) go into `state.pending` and are flushed by the next
foreground hook.

Hooks must never block or break a Claude session. `hook.js` swallows every error, always exits 0,
and gives up waiting for the lock after 1.5 s.

## State and locking

- `state.json` is read-modify-written by overlapping async hooks, so every write happens inside
  `withLock`, which uses `mkdir state.lock` as an atomic lock (stale locks older than 3 s are
  removed). Writes go to a temp file and are renamed into place.
- The active hero's progress lives at the top level of `state.json` (`xp`, `quests`, `tools`,
  `achievements`, `tokens`, `tokenXp`, `battleXp`, `game`), so most code just reads `state.xp`.
  Other heroes are parked in `state.heroes[id]`. `HERO_FIELDS` in `lib.js` is the list of per-hero
  fields.
- Sessions (`state.sessions[id]`) hold the live mode, HP, combo, party and current turn. Sessions
  untouched for a day are pruned.
- Projects (`state.projects[key]`) are keyed by git root (lowercased on Windows).
- `state.offsets` remembers how far each transcript has been read, so token counting is incremental.
- `config.json` holds the theme, options, `heroes` (looks only), `activeHero`, and `character` (the
  active hero's look).

## Status line install

Plugins can't set the main status line, so `arcade.js setup` edits `~/.claude/settings.json`. The
plugin folder changes on every update, so setup copies every script except `hook.js` and
`arcade.js` to `~/.claude/arcade/bin/` and points the settings there. Re-running setup refreshes the
copies. `settings-backup.json` stores the replaced values for `uninstall`.

## Game pane

- `game.js` renders about 10 frames a second. Each frame is a list of lines, each exactly the
  terminal width (measured with `lib.visWidth`). Only changed lines are redrawn.
- The pane follows the most recent session, or the one pinned with `p`.
- New `action` events in `events.jsonl` become spells (`battle.cast`), and `hurt` events make a
  monster attack.
- Gold, kills and kill XP are banked every 3 seconds and on exit, under the state lock. Kill XP is
  only added outside practice waves.
- Purchases write `game.inventory` (per hero) to `state.json`, and equipped items to
  `character.equipped` in `config.json`. Active buffs live only in memory (`ui.buffs`), so they end
  when the game closes.
- Banners come from `ui.celebrate` (boss, purchase) or from the level rising between frames (level
  up). `celebrate.applyOverlay` draws them over the finished frame without changing line widths.
- The game writes `game.alive` every second as a heartbeat.

## In-game approvals

1. The `PermissionRequest` hook checks that approvals are on and the heartbeat is fresh (under 3 s).
   If not, it prints nothing and Claude shows its own dialog.
2. It writes `approvals/<id>.req.json` and polls for `<id>.answer.json` for up to 90 s, stopping early
   if the heartbeat goes stale.
3. The game shows the oldest request as a modal. `Y`/`N`/`C` write `allow`, `deny` or `claude` as the
   answer.
4. On `allow` or `deny` the hook prints a `PermissionRequest` decision. Anything else prints nothing.
   Both files are always deleted.

## Tests

```sh
npm test    # node --test
```

- `test/simulate.test.js` is end to end. It runs the real scripts as child processes against a
  throwaway home folder (`HOME`, `USERPROFILE` and `APPDATA` all point to a temp dir, and
  `ARCADE_NO_CLIPBOARD=1` keeps `play` off your clipboard). It feeds hook events and checks state,
  toasts, the HUD, the quest log, project stats, approvals, and the setup/uninstall round trip.
- It also renders every tab, the creator and so on with `--snapshot`, and asserts that **every line
  is exactly the terminal width**. Any new screen should get the same check.
- `test/shop.test.js` covers the shop: buying, equipping, buffs (which must never grant XP), and
  line widths.
- The snapshot width test covers tabs 1-4 and the creator, and `shop.test.js` checks the Shop tab. The
  Projects tab doesn't have a width test yet.

## Snapshots and PNGs

The game can print a single frame and exit, which is how screenshots and visual checks are made.

```sh
# Use a throwaway home so your real progress isn't touched.
HOME=/tmp/arcade-shot USERPROFILE=/tmp/arcade-shot \
COLUMNS=130 LINES=36 ARCADE_WARMUP=60 \
node plugins/claude-arcade/scripts/game.js --snapshot 1 > frame.ans
```

| Argument or variable | Effect |
|---|---|
| `--snapshot 1`-`6` | Render that tab (Adventure, Hero, Party, Trophies, Shop, Projects) |
| `--snapshot create` / `roster` | Render the character creator or the hero roster |
| `COLUMNS`, `LINES` | Frame size (default 100×28) |
| `ARCADE_WARMUP` | Frames to simulate before printing (default 40), so battles have time to develop |
| `ARCADE_BIOME` | Force `dungeon`, `forest`, `lava` or `castle` |
| `ARCADE_WEATHER` | Force the forest weather: `rain` or `clear` |
| `ARCADE_CELEBRATE` | Force a banner: `levelup`, `boss`, `purchase` or `achievement`, optionally `:age` in ticks to freeze it at a moment |

To put a hero in a particular state, write a `config.json` into the throwaway home first (for example
`{"theme":"rpg","character":{"name":"Test","cls":"mage"}}`) and feed `hook.js` a few events, such as a
`PreToolUse` so the hero is busy and monsters spawn.

The output is ANSI text with 24-bit colors. Turn it into an image with the dev tool in the repo:

```sh
python tools/ansi2png.py frame.ans frame.png   # needs Pillow
```

It draws each cell as an 8×16 block, with `▀` painting the top half in the foreground color and the
bottom half in the background color. It's a development tool only, not part of the plugin, so the
zero-dependency rule doesn't apply to it. The screenshots in `docs/images/` were made this way.

## Adding things

- **Theme:** add an entry to `THEMES` in `lib.js`, a message pool in `messages.js` (including a
  `summon` message for each of the six classes), and a palette in `UI` in `state.js`.
- **Shop item:** add it to the right list in `items.js` with a price, rarity and drawing. Buffs get a
  `buff` field with `dmg` or `gold` and `waves`. Never XP.
- **Monster:** add it to `MONSTERS` and a biome in `ROSTERS` in `monsters.js`.
- **Spell:** add it to `SPELLS` in `character.js`, a cooldown in `COOLDOWN` in `battle.js`, and its
  behavior in `battle.cast`.
- **Achievement:** add it to `ACHIEVEMENTS` in `lib.js`. `value()` returns progress toward `goal`,
  which the Trophies tab draws as a bar.

Whatever you add, update the docs in the same change. See [Contributing](Contributing).
