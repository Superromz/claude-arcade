# Status Line and Toasts

You don't need the game pane open to play. The status line and toasts bring the game into Claude
Code itself.

## The status line HUD

After [setup](Getting-Started), Claude Code's status line becomes a two-row HUD that animates once a
second:

```
⚡ ᗧ··  Casting… npm test 12s   ⚔ party 2 🏹🔮
Romz Lv 7 Knight ██████░░░░ 2,140/2,800 XP  ❤ ▰▰▰▰▰▱  🔥 x12 combo  ✦ mana 66%  $1.20 spent  Opus
```

**Row 1: what your hero is doing right now.**

- An animated sprite and a verb for Claude's current activity, such as "Casting" for a command,
  "Forging" for an edit or "Scouting" for a read. See the full list in
  [Biomes and Themes](Biomes-and-Themes#what-claude-is-doing-per-theme).
- What it's working on: the command's description, the file name, the search pattern, the URL.
- A timer while Claude is busy.
- Your party: how many agents are running, with their class icons.

**Row 2: your character sheet.**

| Part | Meaning |
|---|---|
| Name, level, class | Your active hero. Before you create a hero, your title shows instead |
| XP bar | Progress to the next level, with your XP and the XP the next level needs |
| HP | Your hero's health this session. Green, then yellow, then red |
| Combo | Tool calls in a row without a failure. Shows from 3 |
| Mana | How much of Claude's context window is left. Turns red when under 20% |
| $X.XX spent | The session's cost so far, as reported by Claude Code |
| Model | The model Claude is using |

Short moods fade on their own: the victory pose lasts about 8 seconds before your hero rests, and
"Took a hit" lasts 3 seconds.

## Party rows for agents

Each running agent gets its own row under the status line, styled as a party member:

```
🏹 Ranger  scouting ✦✦   ▰▰▰▰▱  42s  Find the auth middleware
🛡 Knight  guarding ✧     ▰▰▰▰▰  12s  Review the login changes
```

Each row shows the companion's class, an animated action, a stamina bar for how much of its context
the agent has left, how long it has been running, and its task. When it finishes it shows "returned",
or "fell" if it failed. See [Companions](Companions) for how agents get their class.

## Themed spinner

Setup replaces Claude's spinner verbs with themed ones ("Rolling for initiative", "Brewing potions",
"Slaying bugs"…) and adds a few game tips to the rotation. Switching the theme with
`/claude-arcade:theme` switches the spinner too.

## Toasts

Toasts are short messages Claude Code prints in the conversation:

| When | Example |
|---|---|
| A session starts or resumes | "Lv 7 Code Knight steps into the dungeon. The bugs tremble. (4-day streak)" |
| An agent joins | "🏹 A Ranger slips out of the shadows to scout: Explore · The party is 2 strong!" |
| A task ends | "🏆 Quest complete! Forged 3 files, cast 2 spells. +48 XP (20 from tokens) in 41s. Flawless!" |
| You level up | "✨ LEVEL UP ✨ Lv 5! You are now a Bug Slayer." plus "📖 New spell learned: Frost Shard!" |
| You unlock an achievement | "🏅 Achievement unlocked: Blacksmith — Make 50 edits" |
| Your hero faints | "💀 You fainted! A passing cleric revives you at full HP." |

The end-of-task summary lists the three things Claude did most, the XP you earned (and how much came
from tokens), how long it took, and "Flawless!" if no tool failed, or how many hits you took. A task
with at most one tool call gets a short "quick errand" message instead.

To keep Claude fast, most hooks run in the background and can't print. Level-ups, achievements and
faints that happen in the middle of a task are saved and shown at the next toast: the end of the
task, the next agent joining, or the next session.

Messages are picked at random from a pool for each theme, so they don't repeat much.

### Turning toasts off

```
/claude-arcade:toggle toasts
```

This hides all toasts, including the welcome greeting at session start. Everything is still recorded
in the game pane's quest log.
