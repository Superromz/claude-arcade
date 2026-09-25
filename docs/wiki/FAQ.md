# FAQ

### Does it slow Claude down?

No. Most hooks run in the background, and the few that run in the foreground (session start, agent
start, task end) finish in a fraction of a second. If anything goes wrong inside Claude Arcade, the
error is swallowed and Claude carries on. The only hook that waits is the permission request, and
only while the game pane is open and asking you.

### Does it send my data anywhere?

No. There are no network requests at all. See [Privacy and Data](Privacy-and-Data).

### Do I need the game pane open?

No. The status line, spinner and toasts work on their own, and your hero still earns XP. The game
pane adds the battles, the hero screens and in-game approvals.

### Which terminals work?

The status line works in any terminal. The game pane needs 24-bit color and a font with the `▀`
block character: Warp, Windows Terminal, iTerm2, Kitty, WezTerm, VS Code and most modern terminals
are fine. For fonts without emoji, use the `retro` theme or `/claude-arcade:toggle ascii`.

### `arcade` isn't found.

Setup puts the command in a folder that should be on your PATH: `%APPDATA%\npm` on Windows, or
`~/.local/bin` on macOS and Linux. If that folder isn't on your PATH, add it, or run
`/claude-arcade:play`, which prints the full `node .../game.js` command you can use instead.

### The status line disappeared or looks old after an update.

Run `/claude-arcade:setup` again. It refreshes the copied scripts in `~/.claude/arcade/bin/`.

### I already had a custom status line.

Setup saves it before replacing it, and `/claude-arcade:uninstall` puts it back.

### Can I cheat XP with practice waves?

No. Practice waves (`w`) only give gold. XP comes only from real Claude usage, because the future
global leaderboard depends on it. See [Progression and XP](Progression-and-XP).

### Why did my combo reset?

A tool call failed, or you sent a new prompt. Combos count within a single task.

### My hero fainted. Did I lose anything?

No. Your hero is revived at full HP. HP is just for fun (and for bragging about flawless tasks).

### I use several Claude sessions at once. Which one does the game show?

The most recent one. Press `p` to pin a different session; keep pressing to cycle, and it goes back to
following the latest.

### Does changing class reset my level?

No. Your XP and level stay. The new class's bonus applies to XP you earn from then on. If you want a
fresh start with a different class, create a second hero on the [Hero Roster](Hero-Roster).

### Can I turn off the messages in the conversation?

Yes: `/claude-arcade:toggle toasts`. See [Status Line and Toasts](Status-Line-and-Toasts).

### I don't want to answer permission prompts in the game.

Run `/claude-arcade:toggle approvals`. See [In-Game Approvals](In-Game-Approvals).

### My buffs disappeared.

Buffs from the Shop last for the current game session and count down per cleared wave. Closing the
game pane ends them. Cosmetics are kept forever.

### How do I remove it completely?

Run `/claude-arcade:uninstall`, then `/plugin uninstall claude-arcade`. To remove your progress too,
delete `~/.claude/arcade/`.
