# HD Graphics

By default the battle scene is drawn with text characters: every character cell shows two
colored "pixels" (`▀`). That works in any terminal, but in a big pane the pixels get chunky.

**HD mode** draws the scene as a real image using the
[Kitty graphics protocol](https://sw.kovidgoyal.net/kitty/graphics-protocol/). It uses your
screen's actual pixels instead of character cells, so pixels are much finer, diagonals are
smoothed, and torches, spells and lava glow. Panels, bars and text stay as normal terminal text.

## Supported terminals

Warp, kitty, WezTerm and Ghostty. Other terminals keep the text renderer automatically.

## Turning it on

1. Check that your terminal shows images:
   ```
   arcade --hd-test
   ```
   You should see a colored gradient square marked "HD". The test also prints the detected
   terminal, the cell size, and whether the terminal answered the graphics query.
2. If you see the square, turn HD on:
   - press **`g`** in the game pane, or
   - run `/claude-arcade:toggle hd` (it's saved for next time).

On macOS and Linux, HD turns on by itself in supported terminals. On **Windows** it's opt-in,
because the Windows console layer can drop image data. If that happens, the scene shows as
blank rows. Press `g` to switch back.

## Tuning

| Setting | Effect |
|---|---|
| `"hd": true/false` in `~/.claude/arcade/config.json` | Force HD on or off |
| `ARCADE_HD=1` / `ARCADE_HD=0` | Same, for one run |
| `ARCADE_CELL=9x19` | Your cell size in pixels, if the terminal doesn't report it (pixels look slightly soft otherwise) |
| `ARCADE_HD_PITCH=6` | Screen pixels per game pixel (default: picked from the pane height) |
| `ARCADE_HD_EDGES=all` | Also smooth the background's edges |

A big pane shows a larger world with the same fine pixels, rather than bigger blocks. HD adapts
its frame rate (about 8–15 fps) and resolution to keep the terminal responsive.
