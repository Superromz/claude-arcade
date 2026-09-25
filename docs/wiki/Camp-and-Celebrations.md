# Camp and Celebrations

Your hero is alive even when nothing is happening. Between tasks it makes camp, while Claude works it
tells you what it's thinking, and big moments get a banner.

## The idle camp

When Claude is idle, the battlefield turns into a camp with a fire, and your companions gather
around it. The longer things stay quiet, the more your hero settles in:

| Idle for | Your hero |
|---|---|
| Under 30 seconds | Stands by the fire |
| 30 seconds to 3 minutes | Sits down and does a class activity |
| Over 3 minutes | Falls asleep. Night falls and the fire burns down |

![Each of the six classes sitting at the campfire doing its own activity](https://raw.githubusercontent.com/Superromz/claude-arcade/main/docs/images/camp.png)

Class activities:

| Class | At camp |
|---|---|
| Mage | Reads a spellbook |
| Knight | Polishes their sword |
| Ranger | Fletches arrows |
| Warlock | Gazes into a crystal |
| Rogue | Flips a coin |
| Bard | Strums the lute |

As soon as Claude starts working again, your hero jumps up with an alert, the party marches back
into position, and the next wave comes in.

### The recap board

A small wooden board hangs in the corner of the camp with:

- **Last:** a summary of the last quest and the XP it gave,
- **Today:** how many quests you've finished today and the XP they earned,
- **Streak:** your daily streak,
- a reminder that `w` starts a practice wave.

## Thought bubbles

While Claude works, a thought bubble over your hero shows what it's doing, based on Claude's current
activity: "Editing auth.ts", "Run the test suite", "Searching validateToken". While Claude is thinking,
the bubble shows the quest you gave it (your prompt). Now and then your hero muses in character
instead ("For the codebase!" for a Knight, "The runes align…" for a Mage).

Speech bubbles appear too: "Your move!" or "Need your OK" when Claude is waiting for you, and "Ouch!"
when a tool fails.

## Hero animations

Your hero is assembled from layers every frame, so it moves naturally: it breathes, walks, flinches
when hit, and does a victory dance when a task ends. Each class has its own attack animations for its
weapon: the Knight's sword swing, the Ranger's bow, the Mage's staff, and so on. Spells get a casting
pose, and cosmetics from the [Shop](Shop) move with the hero.

![Animation sheet for the Knight: idle, walk, attacks, casting, hurt, cheer, sit and sleep](https://raw.githubusercontent.com/Superromz/claude-arcade/main/docs/images/knight-sheet.png)

Companions are smaller versions of the hero classes, with their own attack poses. See
[Companions](Companions).

## Banners

Big moments get a full-width banner drawn over the scene in block letters:

| Banner | When |
|---|---|
| **LEVEL UP** | Your hero reaches a new level. Shows the new level and title, and any spell you just unlocked with its hotbar key, or the level of your next spell |
| **BOSS!** | A boss arrives during a long task |
| **VICTORY** | A boss is defeated |
| **LOOT!** | You buy something in the [Shop](Shop) |

![The LEVEL UP banner announcing Level 3, Apprentice Coder, and the new Fireball spell](https://raw.githubusercontent.com/Superromz/claude-arcade/main/docs/images/level-up.png)

Banners fade after a few seconds. The same moments also appear in the quest log and, for level ups,
as a toast in Claude (see [Status Line and Toasts](Status-Line-and-Toasts)).
