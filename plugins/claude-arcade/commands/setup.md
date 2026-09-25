---
description: Install the Claude Arcade HUD (animated status line, subagent party rows, themed spinner). Optional theme - rpg, space, retro
argument-hint: "[rpg|space|retro]"
allowed-tools: Bash(node:*)
---
!`node "${CLAUDE_PLUGIN_ROOT}/scripts/arcade.js" setup $ARGUMENTS`

The command above already ran; don't run anything. In two short lines tell the user it's installed, and that /claude-arcade:play opens the interactive game pane next to Claude.
