# Progression and XP

Your hero grows from real Claude usage and nothing else. Practice waves, gold and (later) shop items
never give XP. That keeps levels honest for the global leaderboard on the [Roadmap](Roadmap).

## Where XP comes from

| Source | XP |
|---|---|
| Edit or write a file | 5 |
| Run a command | 3 |
| Read a file, search (grep, glob) | 1 |
| Web fetch, web search or an MCP tool | 2 |
| Plan or update todos | 4 |
| An agent joins your party | 10 |
| An agent returns | 5 |
| Any other tool | 1 |
| Finish a task (Claude stops and hands back to you) | 10 |
| Monsters slain during a real task | shown on each monster's name tag, about 5 to 15 per wave |
| Bosses | 50 to 150 |
| Tokens | 1 per 150 output tokens, plus 1 per 3,000 fresh input tokens |

Launching an agent is counted once, when the agent joins your party. The agent tool call itself
doesn't add XP or count toward your combo.

Tool XP gets your [class bonus](Heroes-and-Classes#how-the-bonus-works) (+50% for your class's
specialty) and the combo bonus below.

### Token XP

Claude Arcade reads the token usage in your local Claude Code transcripts at the end of each task,
and in an agent's transcript when the agent finishes. Output tokens count at 1 XP per 150. Input
tokens count at 1 XP per 3,000, and only "fresh" input counts (new input and prompt-cache writes,
not cache reads), so a long conversation isn't counted again on every turn. The end-of-task toast
shows how much of your XP came from tokens, for example "+48 XP (20 from tokens)".

## Levels

Level *n* needs **50 × n × (n − 1)** total XP.

| Level | Total XP | Unlocks |
|---|---|---|
| 2 | 100 | |
| 3 | 300 | Fireball |
| 4 | 600 | |
| 5 | 1,000 | Frost Shard, forest biome |
| 8 | 2,800 | Chain Lightning |
| 10 | 4,500 | Lava cave biome, *Double Digits* achievement |
| 12 | 6,600 | Meteor |
| 15 | 10,500 | Castle biome |
| 18 | 15,300 | Starfall |
| 20 | 19,000 | |

Every level up gives you a toast in Claude and a **LEVEL UP** banner in the game pane, and each new
spell is announced ("New spell learned: Fireball!").

### Titles

You get a new title with each level up to level 11, where you reach the top title. Titles depend on
the theme:

| Theme | Titles (level 1 to 11+) |
|---|---|
| rpg | Peasant, Squire, Apprentice Coder, Code Knight, Bug Slayer, Refactor Paladin, Merge Sorcerer, Archmage of Types, Legendary Hacker, Mythic Architect, Elder Code God |
| space | Cadet, Ensign, Lieutenant, Commander, Captain, Commodore, Rear Admiral, Vice Admiral, Admiral, Fleet Admiral, Galactic Legend |
| retro | NOOB, PLAYER 1, CHALLENGER, HI-SCORER, COMBO KING, BOSS SLAYER, SPEEDRUNNER, GRANDMASTER, LEGEND, MAX LEVEL, KILL SCREEN |

## HP

Each Claude session starts your hero at 100 HP.

- A **failed tool call** costs 10 HP.
- A **finished task** heals 20 HP.
- At 0 HP your hero faints and is revived at full HP by a passing cleric. There's no penalty beyond
  the embarrassment.

## Combo

Your combo counts tool calls in a row without a failure. It resets when a tool fails and when you
send a new prompt.

Every successful tool call earns bonus XP equal to your combo divided by 10 (rounded down): +1 per
call from a 10-hit combo, +2 from 20, and so on. The Rogue doubles this. The status line shows your
combo once it reaches 3, and the quest log cheers every 10 hits.

## Stats

Your hero has five stats that grow with the square root of how much you do each kind of work, so
early work counts most and nothing runs away:

| Stat | Grows from |
|---|---|
| STR | Edits |
| INT | Commands |
| DEX | Reading and searching |
| WIS | Web, MCP and planning, plus a little from output tokens |
| CHA | Agents |

Every stat also gets +1 per level, and your class's main stat gets +5. Your main stat boosts your
damage in battle. You can see your stats on the Hero tab.

## Achievements

There are 13 achievements. The Trophies tab shows each one with a progress bar.

![The Trophies tab with 3 of 13 achievements unlocked](https://raw.githubusercontent.com/Superromz/claude-arcade/main/docs/images/trophies.png)

| Achievement | How to get it |
|---|---|
| First Blood | Complete your first turn |
| Centurion | Complete 100 turns |
| Blacksmith | Make 50 edits |
| Master Smith | Make 500 edits |
| Spellslinger | Run 100 commands |
| Pathfinder | Read or search 200 times |
| Party Up | Summon your first subagent |
| Guild Master | Summon 25 subagents |
| Full Party | Have 3 subagents running at once |
| Combo x25 | 25 tool calls in a row without a failure |
| Dedicated | Play 3 days in a row |
| Obsessed | Play 7 days in a row |
| Double Digits | Reach level 10 |

## Daily streak

Your streak counts the days in a row on which you started at least one Claude session. Days follow
UTC. The welcome toast at the start of each session shows your streak.

## Gold

Gold comes from monsters slain in the game pane, including practice waves. It doesn't affect XP or
level. Spend it in the [Shop](Shop).
