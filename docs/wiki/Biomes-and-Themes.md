# Biomes and Themes

## Biomes

The battlefield changes as your hero levels up. Each biome has its own background, lighting,
monsters and boss.

![Forest, lava cave, castle and space backgrounds](https://raw.githubusercontent.com/Superromz/claude-arcade/main/docs/images/biomes.png)

| Biome | Levels | Monsters | Boss |
|---|---|---|---|
| Dungeon | 1 to 4 | Slime, Bat, Goblin, Skeleton | Goblin Warlord |
| Forest | 5 to 9 | Dire Wolf, Sporeling, Treant | Elderbark the Ancient |
| Lava cave | 10 to 14 | Fire Imp, Fire Bat, Magma Golem | Ignarok the Magma Drake |
| Castle | 15 and up | Wraith, Gargoyle, Dark Knight | The Lich King |

![A mage fighting a slime in the forest](https://raw.githubusercontent.com/Superromz/claude-arcade/main/docs/images/forest.png)

In the dungeon, new players start with only slimes and bats. Goblins join at level 2 and skeletons at
level 3. The forest has weather, so sometimes it rains.

Scenes are drawn in layers that scroll at different speeds (parallax), with torchlight, glow and
particles. See [Combat and Spells](Combat-and-Spells) for how bosses work.

## Themes

The theme changes the words, colors and icons everywhere: status line, spinner, toasts and game
pane.

| Theme | Name | Look |
|---|---|---|
| `rpg` | Dungeon Crawl | Fantasy. Your hero "forges" files, "casts" commands and "sends the scout eagle" to the web |
| `space` | Star Command | Sci-fi. "Repairing hull", "Firing thrusters", "Hailing frequencies". Biomes become space sectors |
| `retro` | 8-Bit Arcade | Green-screen arcade. XP becomes PTS, and the status line uses plain ASCII |

Switch themes any time:

```
/claude-arcade:theme space
```

This also swaps the themed spinner verbs and tips. Pressing `t` in the game pane cycles the theme too,
but only `/claude-arcade:theme` updates the spinner.

### ASCII mode

The retro theme is ASCII-only in the status line, so it's safe for fonts without emoji. To drop the
emoji from the status line in any theme, run:

```
/claude-arcade:toggle ascii
```

The game pane always uses block characters and 24-bit color.

## What Claude is doing, per theme

| Claude is… | rpg | space | retro |
|---|---|---|---|
| thinking | Consulting the oracle | Computing trajectory | THINKING |
| planning | Drawing the battle map | Plotting a course | LOADING LEVEL |
| reading a file | Scouting | Scanning | READING |
| searching | Searching the dungeon | Sweeping the sector | SEARCHING |
| editing | Forging | Repairing hull | BUILDING |
| running a command | Casting | Firing thrusters | RUNNING |
| web or MCP | Sending the scout eagle | Hailing frequencies | DOWNLOADING |
| launching agents | Summoning the party | Launching drones | PLAYERS JOINING |
| a tool failed | Took a hit | Hull breach | OUCH! |
| waiting on you | Awaiting your command | Awaiting orders | PRESS START |
| done | Quest complete! | Mission accomplished! | STAGE CLEAR! |
| idle | Resting at the tavern | Orbiting | INSERT COIN |

## Adding a theme

Themes live in `THEMES` in `plugins/claude-arcade/scripts/lib.js`, with flavor text in
`messages.js` and game pane colors in `state.js`. See [Architecture](Architecture) and
[Contributing](Contributing).
