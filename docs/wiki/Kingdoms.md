# Kingdoms

Every project you work in with Claude is a **kingdom** on the world map in the
[Campaign](Campaign) tab. When you start, the Legacy Monolith's minions occupy it. Your real work
in that project liberates it.

A project is the same thing it is in [Project Stats](Project-Stats): the git repository your
Claude session runs in (or the folder itself outside a repository).

## The world map

Press `m` in the Campaign tab to open the map.

- Each kingdom stands in its own land. The land matches the kingdom's level: **badlands** below
  level 5, **forest** from 5, **lava** from 10 and **snowy highlands** from 15 (a kingdom's level
  comes from the XP earned in that project).
- Its settlement shows its stage: a ruined camp under a purple banner, a village with both
  banners, then a tower, a castle and finally a golden citadel. Liberated kingdoms fly your hero's
  colors.
- Occupied and contested lands are tinted purple by the occupation.
- Roads link each kingdom to its nearest neighbor.
- Your hero stands next to the kingdom of the session you're following.
- The Legacy Monolith looms in the wastes to the east. It cracks a little with every chapter you
  finish, and the wastes shrink.

Kingdoms keep their place: each one's spot is picked from the project itself, and a new project
never moves an old one.

Use `↑` `↓` to select a kingdom. On a wide terminal a panel lists every kingdom with its stage and
how far it is from the next one. On a narrow one the selected kingdom is shown under the map.

## Liberation

A kingdom's liberation score grows with real work in that project:

| Work | Points |
|---|---|
| Each XP earned there | 1 |
| Each quest finished there | 10 |
| Each edit and each command | 1 |
| Each 1,000 output tokens | 1 |
| Each boss defeated while working there | 100 |

## Stages

| Stage | Score | What happens |
|---|---|---|
| Occupied | 0 | The minions hold it |
| Contested | 150 | The fight is on |
| Liberated | 800 | The kingdom's ruler is defeated and your banner goes up |
| Thriving | 3,000 | The kingdom grows into a castle |
| Legendary | 10,000 | A golden citadel |

## Rulers

Each kingdom is held by a **ruler**, one of the game's twelve bosses (from King Gloop to Count
Vessarin). The ruler is picked from the project, so it never changes. It falls when the kingdom
reaches **Liberated**.

## Kingdoms and the campaign

Several chapter objectives are about kingdoms: push back the occupation of one, liberate 1, 2 or
3, work in 3, and make one thrive. See [Campaign](Campaign).

Kingdoms are shared by all your heroes, because they're a record of your real work. Like project
stats, they start with your first session after installing.
