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
  and so on), at a fixed **logical resolution of 320×180 pixels**, **10 ticks/s** (the terminal game's rate:
  every battle timer, including the wave pacing that caps kill XP, counts ticks). `ui.tick` advances
  once per tick, exactly like `game.js`.

## Endpoints

| Method | Path | Returns |
|---|---|---|
| GET | `/` and `/client/*` | Static files from `web/client/` |
| GET | `/api/assets` | Sprite and art data (below). Cache it; changes only on plugin update |
| GET | `/api/snapshot` | Full current data for the panels (below) |
| GET | `/api/stream` | Server-Sent Events: `battle` every tick (10/s), `snapshot` when state changes |
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

### `battle` event (SSE, every tick, 10/s)

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

## Server implementation notes (web/server.js)

These extend the contract above; nothing listed earlier was removed.

- **Tick rate is 10/s, not 15.** Every event carries `hz` and `t` (server ms); interpolate on those.
- **Ownership.** While it runs, the server owns the battle: it writes `~/.claude/arcade/web.lock`
  (`{ pid, port, url, started }`), the game heartbeat `game.alive` every second (so in-game approvals
  work from the browser), and banks gold, kills and kill XP every 3 s under the state lock, like
  `game.js`. A second `arcade web` reuses the running server. It stops on Ctrl+C, the `quit` action,
  `/claude-arcade:web stop`, or after `ARCADE_WEB_IDLE_MIN` minutes (default 30, 0 = never) with no
  stream open.
- **Security.** Requests whose `Host` isn't `127.0.0.1:<port>` or `localhost:<port>` get a 403
  (DNS rebinding). Action bodies are capped at 16 KB (413). Bad input gets 400, unknown ids 404, both
  as `{ ok: false, message }`. Static files: `/` is `client/index.html`, `/client/*` maps into
  `web/client/`; dot segments, dotfiles and anything resolving outside it are refused.
- **SSE.** On connect the stream sends `retry: 2000`, a `snapshot` and the latest `battle`. Keepalive
  comments every 15 s. Slow readers skip `battle` frames until they catch up. At most 16 streams.
- **Action replies** always include the new `snapshot` (also pushed to every stream).

### Extra fields

- `battle`: `hz`, `t`; `hero.{ busy, lookDir, hop, hurt, flinch, alert }` (the animation inputs
  `scene.js` passes to `drawHero`); `companions[].{ attack, walk, flip, sit, sleep, alpha, level, t }`;
  `monsters[].{ w, h, scale, minion, windup, stun, burn, curse, poison, bleed, taunt, mark, doom, dieT,
  entering, phase, seed, xp }` (`id` is stable for a monster's life; `xp` is 0 in practice waves);
  `fx` entries are copied with monster references replaced by `<key>Id` / `<key>Ids`; `dashes`,
  `rings`, `shield`; `hotbar: [{ id, name, lvl, locked, cd, cdLen }]` (ticks); `buffs`; `approval`
  (true while a permission request waits; the details are in `snapshot.approvals`); `loot` is
  `{ kind, tier, tierName, colors, text, entries, wave, practice, upgraded, from, legendary, age,
  revealAt, duration }`.
- `snapshot`: `needsHero` (no hero yet: show the creator, then `hero create`), `xp: { value, lo, hi }`,
  `themeName`, `xpLabel`, `battle: { gold, kills, wave, bosses, practice }` (live gold; `state.game.gold`
  lags up to 3 s), `approvals: [{ id, tool, input, cwd, t }]`, `messages: { shop, skills, bounties,
  guild }` (`{ text, good }` or null), `web: { hz, W, H, terminalOpen }`. `bounties` is `{ day, week,
  daily, weekly }` with items `{ id, def, name, desc, period, goal, value, done, claimed, gold, buff,
  endsAt }`. `skills` is `{ cls, tree: [{ name, color, nodes: [{ id, b, n, name, max, desc, lvl, rank,
  blocked }] }], tierLvl, points, paragon, respecs, respecCost }`. `guild` is `{ members, offers,
  maxActive, maxGuild }`. `shop` is `{ gold, slots, slotNames, buffs, materials, items: [{ id, name,
  slot, price, rarity, desc, set, loot, buff, owned, equipped, craft, canCraft, canBuy }] }`.
- `assets`: `hero.{ FACES, SIT_LEGS, paletteKeys }`, `CAPE` is `{ still, flutter }`; `companions.rows`
  is `{ BODY, WALK, SIT, HEADS }` (HEADS: `[yOffset, rows]` per head), `companions.classColors[cls]` has
  the class's head, weapon and palette keys 1-6, `companions.skins/hair` are the pools a companion's
  look is hashed from; `monsters.{ ROSTERS, palettes (per type, per color index, fully resolved),
  sizes }`; `looks` (creator options); `loot.TIERS`; `skills.{ PARAGON, TIER_LVL }`; `fallbacks`
  lists tables copied because `sprites.js` doesn't export them yet.

### Action details

| `type` | Fields |
|---|---|
| `cast` | `slot`: 0 to the kit length - 1 (0-5 today) |
| `strike` | `x`, `y`; replies `{ ok, hit }` |
| `wave` | Refused while any monster of the current wave is alive |
| `unequip` | `id`: an item id or a slot name |
| `learn` | `node`: a node id from `snapshot.skills` (`"mage.0.1"`) or `{ b, n }` |
| `paragon` | `stat`: `dmg`, `gold`, `crit` (or 0-2) |
| `respec` | No confirm on the server: the client confirms first |
| `claim` | `id`: a bounty `id` from the snapshot |
| `hero` | `create` needs `look` (`name` 1-16 of letters, digits, space, `. ' -`; `cls`, `primary`, `secondary`, `skin`, `hair`, `accessory` from `assets.looks`); `edit` takes a partial `look` (and switches to `id` first); `delete` refuses the last hero; the client confirms deletes |
| `quit` | Stops the server (saves first) |

## Additions (difficulty update)

Additive fields only. Monsters: `affixes[]`, `shield`, `shieldMax`, `armor`, `resist`, `weak`, `enraged`,
`split`, `fleeing`, `stun`, `charm`, `sleep`, `fear`, `goldMult`. Battle: `tier { id, name, label, level, color, hp, gold, loot }`,
`heroHp`, `heroHpMax`, `barrier`, `ko { t, until }`, `knockouts`, `pets[]`, `fx[]`.
