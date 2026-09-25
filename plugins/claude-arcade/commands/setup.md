---
description: Install the Claude Arcade HUD (animated status line, subagent party rows, themed spinner). Optional theme - rpg, space, retro
argument-hint: "[rpg|space|retro]"
allowed-tools: Bash(node:*)
---
Run this command and show the user its output:

```
node "${CLAUDE_PLUGIN_ROOT}/scripts/arcade.js" setup $ARGUMENTS
```

Then tell them the HUD appears at the bottom of the screen right away (restart Claude Code if it doesn't), that `/claude-arcade:theme` switches themes and `/claude-arcade:uninstall` restores their previous settings.