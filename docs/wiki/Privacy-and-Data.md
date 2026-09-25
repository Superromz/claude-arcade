# Privacy and Data

**Short version:** everything stays on your machine. Claude Arcade makes no network requests, has no
account, no telemetry and no analytics.

## What it reads

| What | Why |
|---|---|
| Claude Code hook events (tool names and inputs, agent starts and stops, prompts, session ids, working folder) | To animate your hero, award XP and fill the quest log |
| Your Claude Code transcripts | Only the token usage numbers, to award token XP. Reading is incremental: it remembers where it stopped |
| The status line input from Claude Code (context used, session cost, model) | To show mana, cost and model in the HUD |
| `~/.claude/settings.json` | Setup and uninstall update four settings and back up the old values |

## What it writes

Everything lives in `~/.claude/arcade/`:

| File | Contents |
|---|---|
| `state.json` | Your heroes' progress: XP, quests, tool counts, achievements, tokens, gold, kills, Shop inventory, streak, recent sessions, per-project stats |
| `config.json` | Theme, options (toasts, ascii, approvals) and your heroes' looks, including equipped cosmetics |
| `events.jsonl` | The quest log the game pane shows. It keeps itself small (trimmed to the latest 400 entries once it passes 256 KB) |
| `bin/` | Copies of the status line and game scripts, so plugin updates don't break your settings |
| `settings-backup.json` | Your previous status line and spinner settings, until you uninstall |
| `approvals/` | Permission requests waiting for an answer in the game pane. Deleted as soon as they're answered |
| `game.alive` | A heartbeat file the game pane updates while it's open |

Outside that folder, setup writes the `arcade` launcher (`%APPDATA%\npm\arcade.cmd` on Windows,
`~/.local/bin/arcade` elsewhere) and edits `~/.claude/settings.json`. `/claude-arcade:uninstall`
removes the launcher and restores your settings.

## A note on the quest log

The quest log (`events.jsonl`) holds short descriptions of what Claude did, such as file names,
command descriptions, and the first 60 characters of your prompts. It never leaves your machine, but
keep that in mind if you share your `~/.claude` folder.

## Deleting your data

- Delete `~/.claude/arcade/events.jsonl` to clear the quest log.
- Delete `~/.claude/arcade/` to remove all progress. Run `/claude-arcade:uninstall` first if you want
  your old settings back.

## The future leaderboard

The planned global leaderboard (see [Roadmap](Roadmap)) will need a small server. It will be opt-in,
and this page will say exactly what it sends before it ships.
