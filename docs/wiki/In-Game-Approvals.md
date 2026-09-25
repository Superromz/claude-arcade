# In-Game Approvals

When Claude asks for permission to run something, you can answer from the game pane without
switching back to Claude.

## How it looks

While the game pane is open, a permission request shows up over whatever screen you're on as an
encounter:

```
╭─────────────────────────────────────────────────────╮
│  ⚔ A COMMAND BLOCKS YOUR PATH!                      │
│  Bash · Run the test suite                          │
│  my-app                                             │
│                                                     │
│   npm test                                          │
│                                                     │
│   Y  Allow once    N  Deny    C  Answer in Claude   │
╰─────────────────────────────────────────────────────╯
```

It shows the tool, its description, the project folder, and the full command (or file, URL or
search) it wants to run, wrapped so nothing is hidden. If the command is too long for the pane, the
dialog tells you how many lines are left and suggests pressing `C` to review it in Claude.

## Answering

| Key | What happens |
|---|---|
| `Y` | Allow this one request. Your hero shouts "ALLOWED!" |
| `N` | Deny it. Claude is told you denied it from the game pane |
| `C` | Hand it back. Claude shows its normal permission dialog |

While the dialog is open, other keys are ignored so you can't answer by accident. If several requests
arrive, they're shown one at a time, oldest first. Your answer is logged in the quest log.

## When Claude shows its own dialog instead

Claude Arcade never answers for you. You get Claude's normal dialog when:

- the game pane isn't open (the game sends a heartbeat every second, and requests only go to the game
  if it's alive),
- you close the game while a request is waiting,
- nobody answers within **90 seconds**,
- you press `C`,
- in-game approvals are turned off.

## Allow once only

`Y` always means "allow this one time". It never adds a permanent rule to your Claude settings. If
you want an "always allow" rule, press `C` and choose it in Claude's own dialog.

## Turning it off

```
/claude-arcade:toggle approvals
```

Run it again to turn it back on. It's on by default.
