# Contributing to Claude Arcade

Thanks for helping. Claude Arcade is a small, dependency-free Node project, so getting started takes
a minute. This guide covers setup, testing, visual checks, and the few rules that keep the game fair
and the docs current.

## Dev setup

You need Node.js 18 or newer and Claude Code.

```sh
git clone https://github.com/Superromz/claude-arcade
cd claude-arcade
npm test
```

There is no `npm install` step. The project has no dependencies.

To run your working copy inside Claude Code:

```
/plugin marketplace add /path/to/claude-arcade
/plugin install claude-arcade@claude-arcade
/claude-arcade:setup
```

Hooks and slash commands run straight from the plugin folder. The status line and game scripts are
copied to `~/.claude/arcade/bin/`, so run `/claude-arcade:setup` again after changing them. You can
also start the game directly with `node plugins/claude-arcade/scripts/game.js`.

`node demo.js [rpg|space|retro]` plays a scripted turn through the status line without touching your
real settings.

The code lives in `plugins/claude-arcade/scripts/`. See
[Architecture](docs/wiki/Architecture.md) for how the modules, hooks and data files fit together.

## Tests

```sh
npm test
```

This runs `node --test` over `test/`:

- `test/simulate.test.js` runs the real hook, status line and game scripts against a throwaway home
  folder, so your own progress is never touched. It checks XP, combos, HP, agents, toasts, the HUD,
  the quest log, per-project stats, in-game approvals, and that setup and uninstall restore your
  settings exactly.
- `test/shop.test.js` covers the Shop, including that buffs never grant XP.

Every rendered game frame must have **every line exactly the terminal width** (measured with
`lib.visWidth`). The tests check this for every tab and screen. If you add a screen, add the same
check.

Run `npm test` before every commit.

## Snapshots and visual checks

For anything visual, render a frame and look at it. The game can print one frame and exit:

```sh
HOME=/tmp/arcade-shot USERPROFILE=/tmp/arcade-shot \
COLUMNS=130 LINES=36 ARCADE_WARMUP=60 \
node plugins/claude-arcade/scripts/game.js --snapshot 1 > frame.ans
```

- `--snapshot 1` to `6` picks a tab (Adventure, Hero, Party, Trophies, Shop, Projects). `--snapshot create` and `--snapshot roster` render those screens.
- `ARCADE_WARMUP` simulates frames first (default 40) so a battle has time to develop.
- `ARCADE_BIOME=dungeon|forest|lava|castle` and `ARCADE_WEATHER=rain|clear` force a scene, and
  `ARCADE_CELEBRATE=levelup|boss|purchase|achievement` forces a banner.
- Point `HOME` and `USERPROFILE` at a throwaway folder, and put a `config.json` there to choose the
  hero and theme.

Then turn it into a PNG and look at it:

```sh
python tools/ansi2png.py frame.ans frame.png
```

`tools/ansi2png.py` is a dev-only helper and needs Python with Pillow (`pip install pillow`). It isn't
part of the plugin, so it doesn't break the zero-dependency rule. Details are in
[Architecture](docs/wiki/Architecture.md#snapshots-and-pngs).

## The rules

### Docs as we go

Every change that affects behavior updates the docs **in the same commit**:

- `docs/wiki/*.md`: the page for that feature. For a new feature, add a page and link it from
  `Home.md` and `_Sidebar.md`.
- `CHANGELOG.md`: one line under `## Unreleased`, written for players, not about the code.
- `README.md`: only if the change affects the pitch, install, quick start or main controls.
- `ROADMAP.md`: tick items off, or add new ones.

Docs describe what players see and do. Implementation detail belongs in
`docs/wiki/Architecture.md`.

Wiki pages are written to be copied to the GitHub Wiki as they are, so link between them wiki-style,
without `.md`: `[Combat and Spells](Combat-and-Spells)`.

### Zero runtime dependencies

Plain Node 18+ only. No npm packages at runtime. It keeps installs instant and the plugin safe to run
inside every Claude session.

### XP integrity

XP must only come from real Claude usage: tool calls, finished tasks, tokens, and monsters slain
during real tasks. Practice waves, gold, the shop and buffs **never** grant XP. The global leaderboard
depends on levels meaning the same thing for everyone. If you add a way to earn something, make it
gold or cosmetics, not XP, and add a test that proves it.

### Hooks never break Claude

Hooks run inside every Claude session. They must swallow their errors, stay fast, and only print
output where the hook contract allows it. Prefer async hooks. Anything that writes `state.json` goes
through `withLock` in `lib.js`.

## Commits and pull requests

- Keep commit messages short and describe what changed for players, for example "Bosses summon
  minions when they're hurt".
- Don't add AI attribution trailers to commits.
- Make sure `npm test` passes, and attach a screenshot for visual changes.

## License

By contributing, you agree that your contributions are licensed under the [MIT License](LICENSE).
