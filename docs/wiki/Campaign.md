# Campaign

The Campaign tab gives your hero a story to follow. It's called **The Great Refactor**: the realms
are overrun by the minions of the **Legacy Monolith** (bugs, merge conflicts, flaky tests and
memory leaks), and your hero sets out to free them, one real task at a time.

The campaign has 8 chapters and an epilogue. After that, a new **Season** starts every month.

## The tab

The Campaign tab has three views. Switch between them with a key:

| Key | View |
|---|---|
| `m` | **World Map**: your projects as kingdoms (see [Kingdoms](Kingdoms)) |
| `j` | **Chapter**: the current chapter, its objectives, rewards and the tale so far |
| `k` | **Codex**: lore pages you've unlocked |
| `v` | Next view |

In the Chapter view:

| Key | Action |
|---|---|
| `r` | Read the chapter's story |
| `Enter` | Claim the rewards once every objective is done |

In a story scene, `Enter` or `space` shows the next line (press it once to skip the typing), `↑`
goes back a line, and `Esc` closes the scene. On the map and in the Codex, `↑` `↓` move the
selection.

The game header shows where you are, for example `Chapter 2: 3/5`.

## Chapters

Each chapter opens with a short scene. You'll meet **Quackers**, a rubber duck who solves problems
by listening, and each chapter's villain. Every chapter has 3 to 5 objectives tied to what you
actually do in Claude Code.

| # | Chapter | Villain | Objectives |
|---|---|---|---|
| 1 | The Duck Awakens | The Bug Swarm | Finish 3 quests · Forge 10 edits · Push back the occupation of a kingdom |
| 2 | Ours and Theirs | The merge-conflict twins | Liberate a kingdom · Cast 15 commands · Defeat a boss |
| 3 | Schrödinger's Test | The Flaky Test | Finish 15 quests · Claim 3 bounties · Reach level 5 |
| 4 | Bus Factor One | The Lone Maintainer | Summon 5 agents · Recruit a companion to the guild · Hold out to wave 5 |
| 5 | The Slow Drip | Scorchmaw the Memory Leak | Reach level 10 · Defeat a boss of the lava caves · Claude writes 50k output tokens |
| 6 | Scope Creep | Arachnessa, Queen of Scope | Liberate 2 kingdoms · Finish 25 quests · Forge 100 edits · Work in 3 kingdoms |
| 7 | Deprecated, Never Removed | The Lich of Old APIs | Learn a capstone skill · Reach level 15 · Defeat 3 bosses · Keep a 3-day streak |
| 8 | The Legacy Monolith | The Legacy Monolith | Make a kingdom thrive · Liberate 3 kingdoms · Defeat a boss of the castle · Finish 50 quests · Fill 12 codex pages |
| | Epilogue: Green Build | | Read the ending |

### How progress is counted

- **Counting objectives** (quests, edits, commands, agents, bosses, bounties, tokens and so on)
  count from the moment the chapter begins. Work you did before doesn't count, so every chapter
  is a fresh push. The chapter view marks these with "since the chapter began".
- **Standing objectives** (your level, kingdoms liberated, guild recruits, capstones, your streak,
  your best wave, codex pages, bosses of a given land) look at where you are now, so they may
  already be done when the chapter opens.
- A chapter starts counting the first time the Campaign tab (or the header) looks at it, and the
  next one starts the moment you claim the previous one.

## Rewards

Finishing a chapter pays:

- a **title** for your hero,
- a **cosmetic** from the [Shop](Shop) catalog, added to your inventory (if you already own it you
  get half its price in gold instead),
- **gold**,
- a **Codex** page with the chapter's lore.

| Chapter | Title | Cosmetic | Gold |
|---|---|---|---|
| 1 | Duckling | Flower Crown | 100 |
| 2 | Conflict Resolver | Pirate Hat | 150 |
| 3 | Test Whisperer | Wizard Hat of Stars | 200 |
| 4 | Party Leader | Owl | 250 |
| 5 | Leak Plumber | Horned Helm | 300 |
| 6 | Scope Warden | Rainbow Cape | 350 |
| 7 | Keeper of the Changelog | Frost Aura | 400 |
| 8 | The Great Refactorer | Royal Crown | 500 |
| Epilogue | Maintainer | Halo | 250 |

The campaign **never gives XP**. Your level only grows from real Claude usage (see
[Progression and XP](Progression-and-XP)), which keeps the future leaderboard fair.

Each reward is paid once. Claiming again does nothing.

## Seasons

After the epilogue the campaign turns into **Seasons**. Every calendar month (UTC) brings a
themed season, such as *The Null Winter*, *Merge Monsoon* or *The Regex Eclipse*, with a short
scene, 4 objectives and a reward:

- the title **Champion of** the season's name,
- a cosmetic that rotates every month,
- 300 gold.

Season objectives always count from the start of the season (the first time you open it that
month). Everyone gets the same season and objectives in the same month, and a theme never repeats
within a year. An unclaimed season is gone when the month ends.

## The Codex

The Codex collects lore pages, 32 in all:

| Section | Unlocked by |
|---|---|
| Lore | Finishing each chapter (the first page is always open) |
| Bestiary | Defeating each of the 12 bosses |
| Lands | Reaching a land (dungeon at level 1, forest 5, lava caves 10, castle 15) or beating one of its bosses |
| Heroes | Playing each of the six classes (any hero in your [roster](Hero-Roster)) |

Locked pages show a silhouette and a hint. Boss kills are read from the quest log, so a boss you
defeated recently is added the next time you open the Campaign tab.

## Heroes

Each hero in your [roster](Hero-Roster) has their own campaign: chapter, titles, codex and
rewards. Kingdoms are shared, because they're your real projects.
