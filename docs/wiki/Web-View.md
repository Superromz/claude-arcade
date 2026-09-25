# Web View

The terminal draws the game with text characters, so the pixels stay chunky. The **web view** opens
the same game in your browser and draws it with the GPU at full resolution: painted parallax
backdrops, real lighting, bloom, particles and smooth 60 fps animation. It's the same hero, the same
progress and the same live battle as the terminal pane, just much prettier.

Everything stays on your machine. The page talks only to a small server on `127.0.0.1`, protected by
a random session key in the link.

## Opening it

```
arcade web
```

Your browser opens on the Adventure tab. Keep the tab open while you work: the battle follows Claude
exactly like the game pane does. Closing the tab doesn't stop your progress; the terminal and the
status line keep counting.

## What you'll see

- **The battle scene.** Each biome is a layered, scrolling painting: torchlit dungeon walls with
  dripping water, a dusk forest with god rays, fireflies and passing rain, a lava cave with a flowing
  lava river and lavafalls, a throne hall with stained-glass light shafts, and the starfields of the
  space theme. Torches, fires, lava and spells light the characters around them.
- **Your hero and party.** The same pixel sprites and animations as the terminal (attack poses,
  casting, hurt flashes, camp activities, cosmetics from the Shop), drawn crisply with soft shadows
  and rim light from nearby fires and spells.
- **Combat juice.** Damage numbers pop and float, crits flash with a shockwave, hits squash the
  monster, gold coins fly to your hero, and big blows shake the screen.
- **Big moments.** A boss arrives with a cinematic zoom and letterbox, its HP bar slides in at the
  bottom, and a finisher beam ends it. VICTORY, LEVEL UP, LOOT! and TROPHY banners, confetti, and the
  full chest opening for quest chests (wave chests pop up in the corner).
- **Camp.** Between tasks your hero sits by a crackling fire. After a few quiet minutes night falls,
  stars come out and fireflies drift around the camp.

## The page

| Part | What it shows |
|---|---|
| Top bar | Your hero, level and title, XP and HP bars, quests, gold, daily streak and the theme switch |
| Adventure | The battle scene, the spell hotbar, your companions and the live quest log |
| Hero | Portrait, stats, spellbook, deeds, the hero roster (play as, delete, new hero) and the look editor |
| Skills | Your class's skill tree: click a node to learn a rank, respec, paragon |
| Party | Companions fighting now and their recent adventures |
| Guild | Recruit offers (accept or dismiss) and your recruits (fight, rest, release) |
| Bounties | Daily and weekly bounties with progress, and a Claim button when one is done |
| Trophies | Every achievement with its progress |
| Shop | Items by slot with a live preview on your hero: buy, equip, unequip and craft |
| Projects | Stats per project |

Tabs with something waiting show a badge: skill points to spend, a recruit offer, bounties ready to
claim.

## Controls

| Input | Action |
|---|---|
| `1`-`9` or click a hotbar slot | Cast that spell (the slot shows its cooldown as a sweep) |
| `Space` | Basic attack |
| Click a monster | Strike it |
| `W` or the Practice wave slot | Summon a practice wave (gold, never XP) |
| `[` `]` | Previous or next tab |
| `T` | Cycle the theme (rpg, space, retro) |
| `Y` / `N` / `C` | Answer a permission request: allow once, deny, or answer in Claude |
| `Esc` | Close a dialog |

The hotbar shows the spells you know plus the next one to unlock; the rest are listed under it.

## Permission requests

When Claude asks for permission while the web view is open, the page shows the same encounter as the
game pane: the tool, its description, the project and the full command. **Allow once** never adds a
permanent rule. **Answer in Claude** hands the request back to Claude's own dialog. See
[In-Game Approvals](In-Game-Approvals).

## Themes

The theme switch in the top bar changes the whole page: **rpg** (warm fantasy), **space** (cool blue
with space sectors as backdrops) and **retro** (a green phosphor screen with scanlines). It's the
same setting as `/claude-arcade:theme`.

## Performance and accessibility

- The scene renders with WebGL2 at your screen's pixel density and runs at 60 fps on an average
  laptop. Browsers without WebGL2 get a Canvas2D version (no bloom or rim light). Add `&gl=0` to the
  link to force it.
- Rendering pauses while the tab is hidden, and other tabs only redraw when their data changes.
- With **reduce motion** turned on in your system settings, screen shake, flashes, the boss zoom and
  confetti are toned down and animations are shortened.
- Buttons and tabs are keyboard-focusable, and the quest log and messages are announced to screen
  readers.
- No external fonts, scripts or images: the page works offline.

Nothing you do in the web view gives XP. XP only comes from real Claude usage.

## For contributors

The client is plain HTML, CSS and ES modules in `plugins/claude-arcade/web/client/` (no build step, no dependencies). It
follows the contract in `plugins/claude-arcade/web/PROTOCOL.md`.

| File | Role |
|---|---|
| `index.html`, `css/style.css` | Page layout, themes and the premium-fantasy styling |
| `js/main.js` | Token and API, the SSE stream, render loop, top bar, hotbar, HUD, quest log, approvals, keys |
| `js/tabs.js` | Hero (roster, creator), Skills, Party, Guild, Bounties, Trophies, Shop, Projects |
| `js/scene.js` | Interpolates the 10/s battle events to 60 fps; characters, spells, particles, lights, text overlay |
| `js/gfx.js` | Renderer: WebGL2 (base pass, half-res light map, emissive pass, bloom, tone map, CRT) and a Canvas2D fallback |
| `js/backgrounds.js` | Painted parallax biomes and their animated pieces and lights |
| `js/fxtex.js` | Procedural glow, flame, lava, ring, spark and coin textures |
| `js/pixelart.js` | Runs the terminal's sprite code on a transparent target and packs sprites into an atlas |
| `js/game.gen.js` | Generated: the plugin's sprite modules wrapped for the browser |

`game.gen.js` is built from `plugins/claude-arcade/scripts/` (pixel, character, sprites, monsters,
items and what they require), so the web view draws heroes, weapon rigs, cosmetics and monsters with
exactly the terminal's code. After changing any of those files, run:

```sh
node plugins/claude-arcade/web/client/sync.js           # regenerate
node plugins/claude-arcade/web/client/sync.js --check   # fails if it's out of date
```

### Development harness

`plugins/claude-arcade/web/client/mock.js` runs the real web server against a throwaway home folder (your real
`~/.claude` is never touched), seeds a level 12 hero with gear, recruits and projects, and plays
"Claude" with a script: work phases with tool spells and companions, a boss on a long task,
victory and its chest, the camp, failed tools and the occasional permission request.

```sh
node plugins/claude-arcade/web/client/mock.js --fresh          # prints the link with its session token
node plugins/claude-arcade/web/client/mock.js --still --lvl 16 --cls knight --theme space
```

A control endpoint on the next port drives it by hand:

```
http://127.0.0.1:47901/mock?phase=boss            work | boss | victory | idle | sit | sleep | hurt | wave
http://127.0.0.1:47901/mock?phase=chest&tier=legendary
http://127.0.0.1:47901/mock?phase=levelup
http://127.0.0.1:47901/mock?phase=approval        (clear=1 answers pending ones)
http://127.0.0.1:47901/mock?biome=lava&theme=retro&lvl=20&auto=1
```
