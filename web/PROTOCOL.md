# Web view protocol

`arcade web` starts a local server and opens the browser. The browser shows the same game as the
terminal pane (same heroes, progress and live battle), drawn with the GPU at high resolution.

## Server (`web/server.js`, Node built-ins only)

- Binds to **127.0.0.1 only**, port **47800** (the next free port if taken).
- On start it creates a random **session token** and opens `http://127.0.0.1:<port>/?t=<token>`.
  Every `/api/*` request must carry the token (query `t=` or header `X-Arcade-Token`), or it gets a
  403. This stops other websites in the browser from driving the game (no CORS headers are sent).
- It runs the battle simulation **headless**, using the same modules as the terminal game
  (`scene.js` `drawScene` on a small off-screen `PixelCanvas`, which steps `battle.js`, `loot.js`,
  and so on), at a fixed **logical resolution of 320×180 pixels**, 15 ticks/s. `ui.tick` advances
  once per tick, exactly like `game.js`.

## Endpoints

| Method | Path | Returns |
|---|---|---|
| GET | `/` and `/client/*` | Static files from `web/client/` |
| GET | `/api/assets` | Sprite and art data (below). Cache it; changes only on plugin update |
| GET | `/api/snapshot` | Full current data for the panels (below) |
| GET | `/api/stream` | Server-Sent Events: `battle` about 15/s, `snapshot` when state changes |
| POST | `/api/action` | JSON `{ type, ... }`. Performs a player action (below) and returns `{ ok, message?, snapshot? }` |

### `/api/assets`

```js
{
  hero: { BODY, POSES, HEADS, ACCESSORY, CAPE /* rows as strings, same keys as sprites.js */,
          palettes: { COLORS, SKINS, HAIR }, BASE },
  companions: { rows, classColors },          // mini-class sprite data
  monsters: { MONSTERS, MONSTER_COLORS, BOSS_POOLS },
  props: { FIRE, TORCH, CHEST, ANVIL, CRYSTAL, BIRD, BOOK },
  items: { CATALOG, RARITY, SLOTS, SETS, MATERIALS },
  classes: CLASSES, kits: KITS,                // character.js
  themes: { rpg: {...UI palette}, space, retro },
  biomes: ['dungeon', 'forest', 'lava', 'castle']
}
```

Sprite rows are the same palette-key strings the terminal uses (`'.'` is transparent). The client
may draw them crisply scaled, or smooth them. All sizes are in logical pixels.

### `/api/snapshot`

The `d` object the terminal panels use, made JSON-safe:
`{ cfg, hero, heroes (lib.heroList), lvl, title, stats, state: { xp, quests, tools, tokens,
achievements, streak, game, projects }, ses, sid, sessions, events (last 150), achievements
(id, name, desc, goal, value, done), bounties (bounties.board), skills (tree + points), guild,
shop (catalog with owned/equipped/price/craft), tabs }`.

### `battle` event (SSE, about 15/s)

Coordinates are logical pixels in the 320×180 scene, with the floor at `floorY`.

```js
{ tick, mode, biome, theme, W: 320, H: 180, floorY, scroll,
  hero: { x, y, pose, flip, action /* ui.heroAction */, hp, cls, look /* character */ },
  companions: [ { id, cls, name, x, y, attackT, kind, guild } ],
  monsters: [ { id, type, boss, elite, x, y, hp, max, flash, frozen, lunge, dying, lvl, name, color } ],
  shots: [ { x, y, id /* skill id */, color, cls } ], bolts: [ { from, to } ], fx: [ ... ],
  coins: [ { x, y } ], particles: [ { x, y, c } ] /* capped at 300 */,
  floaters: [ { x, y, text, color } ], bubble: { text } | null,
  celebrate: ui.celebrate | null, levelUp: ui.levelUp | null, loot: <current chest presentation> | null,
  wave, kills, gold, practice, boss: { name, hp, max, phase } | null, shake, flash }
```

The client interpolates positions between events for smooth 60 fps motion.

### `POST /api/action`

| `type` | Fields | Does |
|---|---|---|
| `cast` | `slot` (0-5) | Hotbar skill (like keys 1-6) |
| `strike` | `x`, `y` (logical px) | Click-strike a monster |
| `wave` | | Summon a practice wave |
| `tab` | `name` | (client-side only; no call needed) |
| `buy` / `equip` / `unequip` / `craft` | `id` | Shop |
| `learn` / `respec` / `paragon` | `node` / – / `stat` | Skill tree |
| `claim` | `id` | Bounty |
| `guild` | `op: accept/dismiss/toggle/release`, `id` | Guild |
| `hero` | `op: switch/create/edit/delete`, `id`, `look` | Hero roster |
| `approval` | `id`, `behavior: allow/deny/claude` | Answer an in-game permission request |
| `theme` | `name` | Switch theme |

Actions call the same functions the terminal uses, so both views stay in sync. The XP rule holds:
nothing a player does in the web view grants XP.
