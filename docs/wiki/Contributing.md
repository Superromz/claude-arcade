# Contributing

Claude Arcade is open source (MIT) and contributions are welcome: monsters, spells, themes, biomes,
fixes, tests and docs.

The full guide is
[CONTRIBUTING.md](https://github.com/Superromz/claude-arcade/blob/main/CONTRIBUTING.md) in the
repository. The short version:

## Get set up

```sh
git clone https://github.com/Superromz/claude-arcade
cd claude-arcade
npm test
```

There's nothing to install: the project has zero dependencies and needs only Node 18+. To try your
changes in Claude Code, add your clone as a marketplace with `/plugin marketplace add /path/to/claude-arcade`,
install the plugin, and run `/claude-arcade:setup` again after each change to the status line
scripts.

## The rules

1. **Docs as we go.** Every change that affects what players see updates the docs in the same
   commit: the wiki page for the feature, one line under `## Unreleased` in `CHANGELOG.md`, the README
   if it changes the pitch, install, quick start or main controls, and `ROADMAP.md`.
2. **Zero runtime dependencies.** Plain Node only.
3. **XP integrity.** XP only comes from real Claude usage: tools, finished tasks, tokens, and kills
   during real tasks. Practice waves, gold, the shop and buffs never grant XP. The leaderboard depends
   on it.
4. **Hooks never break Claude.** Swallow errors, stay fast, and only print where the hook contract
   allows.
5. **Every game frame line is exactly the terminal width.** The tests check this.
6. **Look at visual changes.** Render a snapshot and turn it into a PNG with
   `python tools/ansi2png.py`, then look at it. See [Architecture](Architecture#snapshots-and-pngs).

## Good first contributions

- A new monster for one of the biomes.
- A new cosmetic for the [Shop](Shop).
- New flavor text for a theme in `messages.js`.
- A new achievement.
- Fixes to these docs.

See the [Roadmap](Roadmap) for bigger pieces of work.
