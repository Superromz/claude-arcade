# Roadmap

## In progress
- [x] Biomes & weather (dungeon, forest, lava cave, castle; space sectors)
- [x] Hero animation: attack poses, companion sprites, context thought bubbles, idle camp
- [x] Battle feel: monster animations, biome monsters, bosses for long tasks, companion roles
- [x] Panels polish & level-up celebration; creator hooks for the hero roster
- [x] Shop & inventory: hats, back items, auras, pets, weapon glows, battle buffs
- [x] Integrate the above, Shop tab, Projects view, full test + visual pass, release

## Next

0. **UI polish pass** (after the current agents land): group repeated quest-log lines and wrap long ones; let the quest log fill the empty sidebar space; group or iconify the 9 tabs; tighter battle camera with the hero further in and a thinner ground band; stronger contrast and outlines on thought bubbles and damage numbers; clearer XP/HP bars with labels.
1. ✅ **Class skill kits.** Each class gets its own five skills, triggered by what Claude does and
   unlocked at Lv 3/5/8/12/18 (Knight: Shield Bash, Taunt, Whirlwind, Holy Strike, Judgment, and so on).
2. ✅ **Skill tree.** 3 branches per class with capstones; 1 point per level + 1 per boss.
   Respec costs gold. Paragon levels after the tree is full, so progress never ends.
3. ✅ **Recruitable permanent companions** (shipped as the Guild). When an agent finishes a job, you can recruit it. Recruits
   keep a name and class, level up from the jobs they help with, and camp with your hero between
   tasks. Take up to 3 into battle; the rest wait in a Guild tab.
4. ✅ **HD mode (Kitty graphics protocol)**, shipped as opt-in `g` / `/claude-arcade:toggle hd` (images don't display in Warp on Windows). Real images in Warp at ~8×16 pixels per cell,
   HD-2D lighting, bloom and particles. Falls back to half-blocks elsewhere.
5. ✅ **Web view.** `arcade web`: a GPU-rendered local page with lighting, bloom and every tab (0.7.0). Next: Campaign tab in the browser, bigger sprites.
6. **Global leaderboard & async PvP.** Small server, GitHub login, auto-battles from stats/class.

## Open questions
- ~~Skill tree respec: gold or free?~~ Gold, doubling each time.
