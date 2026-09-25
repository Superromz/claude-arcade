# Roadmap

This is a summary. The source of truth is
[ROADMAP.md](https://github.com/Superromz/claude-arcade/blob/main/ROADMAP.md) in the repository.

## Shipped in 0.5.0

These were on the "In progress" list and are now in the game:

- Biomes and weather: dungeon, forest, lava cave, castle, and space sectors. See
  [Biomes and Themes](Biomes-and-Themes).
- Biome monsters, elite waves, and boss fights with phases for long tasks. See
  [Combat and Spells](Combat-and-Spells).
- Hero attack animations per class, mini-class companions, thought bubbles, and the idle camp. See
  [Camp and Celebrations](Camp-and-Celebrations).
- Polished panels, and LEVEL UP, VICTORY and LOOT banners.
- The [Shop](Shop): hats, back items, auras, pets, weapon glows and battle buffs.
- The Projects tab. See [Project Stats](Project-Stats).

## Next

1. **Class skill kits.** Each class gets five skills of its own, triggered by what Claude does and
   unlocked at levels 3, 5, 8, 12 and 18. For example the Knight: Shield Bash, Taunt, Whirlwind, Holy
   Strike, Judgment.
2. **Skill tree.** Three branches per class, with capstones. One point per level plus one per boss.
   Respec costs gold. After the tree is full, paragon levels keep progress going forever.
3. **Recruitable companions.** When an agent finishes a job, you can recruit it. Recruits keep a name
   and class, level up from the jobs they help with, and camp with your hero between tasks. Take up
   to three into battle; the rest wait in a Guild tab.
4. **HD mode.** Real images through the Kitty graphics protocol (supported in Warp), at about 8×16
   pixels per cell, with HD-2D lighting, bloom and particles. Falls back to half-blocks elsewhere.
5. **WebGL view.** `/claude-arcade:play --web`: a GPU-rendered local page at 60 fps with shaders.
6. **Global leaderboard and async PvP.** A small server with GitHub login. Compare your hero with
   everyone else's, and fight auto-battles decided by stats and class.

## Open questions

- Should a skill tree respec cost gold (the current plan) or be free?

Have an idea? Open an issue or see [Contributing](Contributing).
