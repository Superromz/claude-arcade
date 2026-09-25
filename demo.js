#!/usr/bin/env node
// Preview the HUD in any terminal without installing anything:
//   node demo.js [rpg|space|retro]
// Plays a scripted turn in a throwaway HOME and redraws the status line in place.
'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

const SCRIPTS = path.join(__dirname, 'plugins', 'claude-arcade', 'scripts');
const home = fs.mkdtempSync(path.join(os.tmpdir(), 'arcade-demo-'));
const env = { ...process.env, HOME: home, USERPROFILE: home };
fs.mkdirSync(path.join(home, '.claude', 'arcade'), { recursive: true });
fs.writeFileSync(path.join(home, '.claude', 'arcade', 'config.json'), JSON.stringify({ theme: process.argv[2] || 'rpg' }));

const run = (script, input) =>
  execFileSync(process.execPath, [path.join(SCRIPTS, script)], { input: JSON.stringify(input), env, encoding: 'utf8' });
const hook = (event, extra = {}) => {
  const out = run('hook.js', { hook_event_name: event, session_id: 'demo', ...extra });
  if (out) toasts.push(JSON.parse(out).systemMessage);
};

const toasts = [];
const script = [
  ['SessionStart', { source: 'startup' }], ['UserPromptSubmit'],
  ['PreToolUse', { tool_name: 'Read', tool_input: { file_path: 'src/auth.ts' } }], ['PostToolUse', { tool_name: 'Read' }],
  ['PreToolUse', { tool_name: 'Grep', tool_input: { pattern: 'validateToken' } }], ['PostToolUse', { tool_name: 'Grep' }],
  ['PreToolUse', { tool_name: 'Agent', tool_input: { description: 'Explore session handling' } }],
  ['SubagentStart', { agent_id: 'a1', agent_type: 'Explore' }], ['SubagentStart', { agent_id: 'a2', agent_type: 'Plan' }],
  ['SubagentStop', { agent_id: 'a1' }], ['SubagentStop', { agent_id: 'a2' }], ['PostToolUse', { tool_name: 'Agent' }],
  ['PreToolUse', { tool_name: 'Edit', tool_input: { file_path: 'src/auth.ts' } }], ['PostToolUse', { tool_name: 'Edit' }],
  ['PreToolUse', { tool_name: 'Bash', tool_input: { description: 'Run the test suite' } }], ['PostToolUseFailure', { tool_name: 'Bash' }],
  ['PreToolUse', { tool_name: 'Edit', tool_input: { file_path: 'src/auth.test.ts' } }], ['PostToolUse', { tool_name: 'Edit' }],
  ['PreToolUse', { tool_name: 'Bash', tool_input: { description: 'Run the test suite' } }], ['PostToolUse', { tool_name: 'Bash' }],
  ['Stop'],
];

let step = 0, lines = 0;
const status = { session_id: 'demo', model: { display_name: 'Opus' }, context_window: { used_percentage: 12 }, cost: { total_cost_usd: 0 } };

const timer = setInterval(() => {
  if (step % 4 === 0) {
    const i = step / 4;
    if (i >= script.length + 3) { clearInterval(timer); process.stdout.write('\n'); fs.rmSync(home, { recursive: true, force: true }); return; }
    if (script[i]) hook(...script[i]);
    status.context_window.used_percentage += 2;
    status.cost.total_cost_usd += 0.03;
  }
  step++;
  // Redraw: move up over the previous frame, clear, print toasts + HUD.
  if (lines) process.stdout.write(`\x1b[${lines}A\x1b[0J`);
  const frame = [...toasts.slice(-4).map((t) => `\x1b[90m│\x1b[0m ${t.split('\n').join('\n\x1b[90m│\x1b[0m ')}`), '', run('statusline.js', status)].join('\n');
  process.stdout.write(frame + '\n');
  lines = frame.split('\n').length;
}, 250);
