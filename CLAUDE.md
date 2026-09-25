# CLAUDE.md

Guidance for Claude Code and other agents working on Claude Arcade.

## What this is

An open-source Claude Code plugin that turns the terminal into a game. You create a hero, and it
levels up from your real Claude usage. Every prompt is a quest, every bug is a monster, and your
agents fight beside you as companions. See `README.md` for the pitch and `docs/wiki/` for how
everything works.

## Docs as we go (required)

Every task that changes behavior updates the docs **in the same commit**:

- `docs/wiki/*.md`: the page for that feature (add a page and link it from `Home.md` and
  `_Sidebar.md` if the feature is new).
- `CHANGELOG.md`: one line under `## Unreleased`, written for players, not implementation.
- `README.md`: only if the feature changes the pitch, install, quick start or main controls.
- `ROADMAP.md`: tick items off or add new ones.

Docs describe what players see and do. Keep implementation detail in `docs/wiki/Architecture.md`.

## Code

- Zero runtime dependencies. Node 18+. Game code lives in `plugins/claude-arcade/scripts/`.
- Hooks must never block or break a Claude session: swallow errors, stay fast, and only print
  output where the hook contract allows it.
- XP must only come from real Claude usage (tools, tasks, tokens, kills during real tasks).
  Practice waves, the shop and buffs never grant XP, because the leaderboard depends on it.
- Every game frame line must be exactly the terminal width (`lib.visWidth`). The tests check this.
- Run `npm test` before committing. For visual changes, render `game.js --snapshot` to a PNG
  and look at it.

## Commits

- Short messages describing what changed for players.
- No Claude attribution trailers.
