# Project Stats

Besides your hero's totals, Claude Arcade keeps stats for each project you work on.

## What counts as a project

A project is the git repository your Claude session is in: Claude Arcade walks up from the working
folder to the nearest folder with a `.git` in it. Outside a repository, the working folder itself is
the project. So every subfolder of a repo counts toward the same project.

## What's tracked

| Stat | Meaning |
|---|---|
| XP | XP earned while working in this project |
| Quests | Tasks Claude finished here |
| Sessions | Claude sessions started or resumed here |
| Tools | Edits, commands, reads, searches, web, agents and plans |
| Tokens | Input and output tokens used here |
| First seen, last active | When you first and last worked here |

Project stats are shared by all your heroes. They are a record of your work, not of one hero.

## Seeing them

### In the game: the Projects tab

Tab 6 in the game pane lists every project, most XP first, with an XP bar, quests, edits, commands,
agents, output tokens and when you were last active there. The project of the session you're
following is marked with ▸.

![The Projects tab with two projects](https://raw.githubusercontent.com/Superromz/claude-arcade/main/docs/images/projects.png)

### In Claude: /claude-arcade:stats

```
/claude-arcade:stats
```

This prints your hero sheet:

- your active hero's level, title, XP bar, quests, streak and tool counts,
- **HEROES**: your [roster](Hero-Roster) with each hero's level, class, XP, quests and gold,
- **PROJECTS**: a leaderboard of your projects, most XP first,
- **ACHIEVEMENTS**: which of the 13 you've unlocked.

The project leaderboard looks like this:

```
PROJECTS (3)
Project       XP  Quests  Edits   Cmds  Agents   Tokens  Last active
my-app      2140      38    212     96      14    412.3k  2026-09-25
api          860      17     71     40       3    120.0k  2026-09-24
notes         45       2      3      1       0      2.1k  2026-09-20
```

The Tokens column shows output tokens.

Stats start with your next session after installing, so older work isn't counted.
