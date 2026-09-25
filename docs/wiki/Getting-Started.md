# Getting Started

## What you need

- Claude Code
- Node.js 18 or newer (Claude Code users usually have it already)
- A terminal with 24-bit color for the game pane. Warp, Windows Terminal, iTerm2, Kitty, WezTerm
  and the VS Code terminal all work. The status line works in any terminal.

## 1. Install the plugin

This repository is its own plugin marketplace. In Claude Code:

```
/plugin marketplace add superromz/claude-arcade
/plugin install claude-arcade@claude-arcade
```

To install from a local clone instead, point the marketplace at the folder:

```
/plugin marketplace add /path/to/claude-arcade
```

The plugin installs at user scope, so it's active in every project.

## 2. Run setup

```
/claude-arcade:setup
```

You can pick a theme at the same time: `/claude-arcade:setup rpg`, `space` or `retro`. See
[Biomes and Themes](Biomes-and-Themes).

Plugins can't change the main status line or spinner on their own, so setup does it for you. It:

- adds the animated status line (`statusLine`) and the party rows for agents
  (`subagentStatusLine`) to `~/.claude/settings.json`,
- replaces the spinner verbs and tips with themed ones (`spinnerVerbs`, `spinnerTipsOverride`),
- saves your previous values for those four settings to `~/.claude/arcade/settings-backup.json`,
- copies the display scripts to `~/.claude/arcade/bin/`, so plugin updates don't break your
  status line,
- installs a short `arcade` command that starts the game pane.

Where the `arcade` command goes:

| System | Location |
|---|---|
| Windows | `arcade.cmd` in `%APPDATA%\npm` (already on your PATH if Node's global tools are) |
| macOS and Linux | `~/.local/bin/arcade` (setup only mentions it if that folder is on your PATH) |

If the command can't be installed, setup prints the full `node .../game.js` command to use instead.

After you update the plugin, run `/claude-arcade:setup` again to refresh the copied scripts.

## 3. Open the game pane

The game runs in its own terminal pane next to Claude.

- **Warp:** press `Ctrl+Shift+D` (`Cmd+D` on macOS) to split, then run `arcade` in the new pane.
- **Windows Terminal:** run `/claude-arcade:play` and it opens a split pane for you.
- **Anything else:** split your terminal (or open a second window), then run `arcade`.

`/claude-arcade:play` always helps: it opens the split where it can, and otherwise tells you the
shortcut and copies the launch command to your clipboard.

## 4. Create your hero

The first time the game opens, you land in the character creator. Pick a name, a class and a look,
then press `Enter`. See [Heroes and Classes](Heroes-and-Classes).

## 5. Give Claude a task

![A knight and a ranger companion fighting a goblin while Claude runs npm test](https://raw.githubusercontent.com/Superromz/claude-arcade/main/docs/images/battle.png)

Go back to Claude and ask it to do something. When Claude starts working:

- the status line animates what your hero is doing ("Casting npm test", "Forging auth.ts"),
- monsters attack in the game pane, and every tool call Claude makes casts a spell,
- agents Claude launches join your party,
- when the task ends you get a quest summary with the XP you earned.

That's it. You can play along with the hotbar and your mouse, or just let your hero fight. Between
tasks your hero makes camp, and the gold it collects can be spent in the [Shop](Shop).

## Uninstalling

```
/claude-arcade:uninstall
```

This restores the four settings setup replaced and removes the `arcade` command. Your heroes and XP
stay in `~/.claude/arcade/`, so you can come back later. To remove the hooks as well, run
`/plugin uninstall claude-arcade`. To remove all progress, delete `~/.claude/arcade/`.

## Preview without installing

From a clone of the repo you can watch a scripted turn play out in the status line:

```sh
node demo.js          # rpg theme
node demo.js space
node demo.js retro
```
