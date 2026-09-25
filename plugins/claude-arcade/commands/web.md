---
description: Open Claude Arcade in your browser - the same hero and live battle, drawn in high resolution. Add "stop" to close it
argument-hint: "[stop]"
allowed-tools: Bash(node:*)
---
!`node "${CLAUDE_PLUGIN_ROOT}/scripts/arcade.js" web $ARGUMENTS`

The command above already ran; don't run anything. Relay its output to the user in one or two lines, keeping the link if it printed one.
