// Every screen, every tab, at small / medium / large sizes: each line must be
// exactly the terminal width, or the terminal wraps it and the layout breaks.
'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

const SCRIPTS = path.join(__dirname, '..', 'plugins', 'claude-arcade', 'scripts');
const { visWidth } = require(path.join(SCRIPTS, 'lib.js'));
const { TABS } = require(path.join(SCRIPTS, 'state.js'));
const home = fs.mkdtempSync(path.join(os.tmpdir(), 'arcade-widths-'));
const env = { ...process.env, HOME: home, USERPROFILE: home, APPDATA: home, ARCADE_NO_CLIPBOARD: '1', ARCADE_WARMUP: '5' };

// Some activity so panels have content.
for (const ev of [
  { hook_event_name: 'SessionStart', source: 'startup' },
  { hook_event_name: 'UserPromptSubmit', prompt: 'fix the login bug' },
  { hook_event_name: 'PostToolUse', tool_name: 'Edit', cwd: home },
  { hook_event_name: 'SubagentStart', agent_id: 'a1', agent_type: 'Explore' },
  { hook_event_name: 'PreToolUse', tool_name: 'Bash', tool_input: { description: 'Run the tests' } },
]) execFileSync(process.execPath, [path.join(SCRIPTS, 'hook.js')], { input: JSON.stringify({ session_id: 's1', ...ev }), env });

const screens = [...TABS.map((_, i) => String(i + 1)), 'roster', 'create'];
for (const [cols, rows] of [[50, 16], [80, 24], [200, 60]]) {
  test(`every screen is exactly ${cols} wide at ${cols}x${rows}`, () => {
    for (const screen of screens) {
      const out = execFileSync(process.execPath, [path.join(SCRIPTS, 'game.js'), '--snapshot', screen], { env: { ...env, COLUMNS: String(cols), LINES: String(rows) }, encoding: 'utf8' });
      out.replace(/\n$/, '').split('\n').forEach((line, i) => assert.strictEqual(visWidth(line), cols, `${screen} row ${i}`));
    }
  });
}
