# Roadmap

## In progress
- [x] Biomes & weather (dungeon, forest, lava cave, castle; space sectors)
- [ ] Hero animation: attack poses, companion sprites, context thought bubbles, idle camp
- [ ] Battle feel: monster animations, biome monsters, bosses for long tasks, companion roles
- [ ] Panels polish & level-up celebration; creator hooks for the hero roster
- [ ] Shop & inventory: hats, back items, auras, pets, weapon glows, battle buffs
- [ ] Integrate the above, Shop tab, Projects view, full test + visual pass, release

## Next
1. **Class skill kits.** Each class gets its own five skills, triggered by what Claude does and
   unlocked at Lv 3/5/8/12/18 (Knight: Shield Bash, Taunt, Whirlwind, Holy Strike, Judgment, and so on).
2. **Skill tree.** 3 branches per class with capstones; 1 point per level + 1 per boss.
   Respec costs gold. Paragon levels after the tree is full, so progress never ends.
3. ✅ **Recruitable permanent companions** (shipped as the Guild). When an agent finishes a job, you can recruit it. Recruits
   keep a name and class, level up from the jobs they help with, and camp with your hero between
   tasks. Take up to 3 into battle; the rest wait in a Guild tab.
4. **HD mode (Kitty graphics protocol).** Real images in Warp at ~8×16 pixels per cell,
   HD-2D lighting, bloom and particles. Falls back to half-blocks elsewhere.
5. **WebGL view.** `/claude-arcade:play --web`: a GPU-rendered local page at 60 fps with shaders.
6. **Global leaderboard & async PvP.** Small server, GitHub login, auto-battles from stats/class.

## Open questions
- Skill tree respec: gold (recommended) or free?
