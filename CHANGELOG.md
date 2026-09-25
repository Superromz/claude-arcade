# Changelog

All notable changes to Claude Arcade are listed here, written for players. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and versions follow
[Semantic Versioning](https://semver.org/).

## Unreleased

## [0.6.0] - 2026-09-25

### Added
- **Loot chests** after every wave and every finished prompt: Wooden to Legendary, rated by difficulty (tools, time, recovered failures, tokens, agents, bosses). Gold, gear, materials, buffs and rare legendaries, plus loot-only item sets and crafting in the Shop. Never XP.
- **Class skills:** every class has its own five skills with their own effects (e.g. Knight: Shield Bash, Taunt, Whirlwind, Holy Strike, Judgment).
- **Skill tree:** 3 branches per class with capstones, a point per level and per boss, gold respec (doubling), and endless paragon points. New Skills tab.
- Bosses now rotate through each biome's pool, with occasional rematches.
- **HD graphics:** in Kitty-graphics terminals (Warp, kitty, WezTerm, Ghostty) the battle scene can be drawn as a real image with finer pixels, smooth diagonals and glow. Check with `arcade --hd-test`, then press `g` in the game or run `/claude-arcade:toggle hd`. On by default on macOS/Linux; opt-in on Windows.
- **Bounties:** 3 daily and 2 weekly challenges that pay gold (and sometimes buffs) for real Claude work. New Bounties tab.
- 45 new achievements (58 in all, including secret ones) and titles up to level 32, with three times more message variety.
- **Guild:** finished agents can ask to join; recruit up to 12, take 3 into battle, and level them up. New Guild tab.
- 12 bosses (3 per biome) that rotate without repeats, plus rematches with earlier bosses, and 8 new monsters.

### Fixed
- The Warlock's +50% XP from agents applies again.
- A boss arriving now shows a BOSS! banner instead of VICTORY.

## [0.5.0] - 2026-09-25

### Added

- A **Shop** tab (tab 5): spend gold on hats, back items, auras, pets and weapon glows that show on
  your hero, or on battle buffs (Whetstone, Lucky Charm, War Drum) that boost damage or gold for a
  few waves. Nothing in the shop gives XP.
- A **Projects** tab (tab 6) with your stats for each project.
- Banners over the battle for LEVEL UP (with your new title and any new spell), boss VICTORY and
  LOOT when you buy something.
- An idle camp between tasks: your hero stands by the fire, sits down to a class activity after 30
  seconds, and falls asleep after 3 minutes. A board shows your last quest, today's quests and your
  streak.
- Thought bubbles that show what your hero is doing, and speech bubbles when Claude needs you.
- Attack animations for each class, and companions drawn as smaller versions of their hero class
  with their own attack poses.
- Class portraits for companions on the Party tab.
- Refreshed panels and hotbar, and a nicer character creator that shows each class's stats and
  spells.
- Monster walk cycles, attack wind-ups and death animations.
- Monsters for each biome: dire wolves, sporelings and treants in the forest; fire imps, fire bats
  and magma golems in the lava cave; wraiths, gargoyles and dark knights in the castle.
- Every 5th wave is an elite wave, led by the toughest monster in the biome.
- Boss fights for long tasks. When one task runs past 90 seconds, a biome boss arrives. Bosses summon
  minions, become enraged and telegraph ground slams, and your hero lands a finisher when Claude is
  done.
- Companion battle roles: Knights taunt and shield, Rangers strike first, Warlocks curse, Bards
  inspire the party, Rogues dash in for bursts, and Mages blast groups.
- Four biomes that change with your level (dungeon, forest, lava cave, castle), with weather in the
  forest. The space theme gets matching space sectors.
- Answer Claude's permission requests from the game pane: Y allows once, N denies, C answers in
  Claude. Turn it off with `/claude-arcade:toggle approvals`.
- A short `arcade` command to start the game pane from any terminal pane.
- Hero roster: keep several heroes, each with their own look and progress. Switch, create, edit and
  delete heroes from the roster screen (`h` in the game).
- Stats per project (by git repository), and a project leaderboard in `/claude-arcade:stats`.
- Agents join your party as one of the six hero classes, based on what the agent does.
  General-purpose agents make a mixed party.
- A public roadmap, a changelog and a full wiki.

### Changed

- The game pane now has six tabs: Adventure, Hero, Party, Trophies, Shop and Projects. Switch with
  `tab`, the arrow keys or a click. The number keys are the spell hotbar.
- `/claude-arcade:stats` now also lists your heroes and your projects.
- Each agent now counts once, when it joins your party. The agent tool call no longer gives XP of its
  own.

### Fixed

- The welcome message at session start now respects `/claude-arcade:toggle toasts`.
- In the space and retro themes, agents now get a message for their own class instead of always
  "Scout".
- `/claude-arcade:stats` no longer shows garbled characters on Windows consoles.
- `/claude-arcade:toggle` now lists `approvals` as an option.

## [0.4.0] - 2026-09-25

### Added

- Character creator: name, class, robe and trim colors, skin, hair and an accessory, with a live
  preview.
- Six hero classes (Mage, Ranger, Knight, Warlock, Bard, Rogue), each with a main stat and an XP
  bonus.
- Monster battles in the game pane. Waves attack while Claude works, and every tool call casts a
  spell.
- A spellbook that grows with your level: Fireball, Frost Shard, Chain Lightning, Meteor and
  Starfall.
- Play along: cast from the hotbar with `1`-`6` or `space`, click monsters to strike them, and summon
  a practice wave with `w`.
- Gold drops from monsters.
- XP from real token usage, read from your Claude Code transcripts.
- Stats (STR, INT, DEX, WIS, CHA) that grow from how you use Claude.

### Changed

- The Stats view became the Hero tab, with your portrait, stats and spellbook.

## [0.3.0] - 2026-09-25

### Added

- The game pane is now pixel art, drawn with half-block characters in 24-bit color, with lighting
  and particles.

### Changed

- Cleaner quest log.

### Fixed

- Background agent notifications no longer start a new quest each time.

## [0.2.0] - 2026-09-25

### Added

- The interactive game pane, opened with `/claude-arcade:play`, with Adventure, Party, Trophies and
  Stats views.
- Richer themed messages that don't repeat, and an end-of-task summary ("Forged 3 files, cast 2
  spells. +48 XP in 41s. Flawless!").

### Changed

- Quieter hooks: tool calls no longer add "running hook" lines. Level-ups and achievements earned
  mid-task show at the end of the task.

## [0.1.0] - 2026-09-25

### Added

- First release.
- An animated two-row status line HUD: what Claude is doing, your level, XP, HP, combo, mana
  (context left) and the session cost.
- XP and levels from tool use and finished tasks, with a new title every level.
- HP that drops when tools fail and heals when tasks finish, and combos for long runs without a
  failure.
- 13 achievements and a daily streak.
- Subagents shown as party members in their own status rows.
- A themed spinner with game tips.
- Toasts at session start, when agents join, and at the end of each task.
- Three themes: Dungeon Crawl (rpg), Star Command (space) and 8-Bit Arcade (retro, ASCII-only).
- Commands: `/claude-arcade:setup`, `:theme`, `:stats`, `:toggle` and `:uninstall`. Setup backs up
  your settings and uninstall restores them.
- `node demo.js` to preview the HUD without installing.
