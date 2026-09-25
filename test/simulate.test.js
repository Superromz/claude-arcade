// End-to-end check: feed hook events through hook.js in a throwaway HOME and
// assert on the resulting state, toasts and rendered HUD.
// Run with: node --test
'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

const SCRIPTS = path.join(__dirname, '..', 'plugins', 'claude-arcade', 'scripts');
const home = fs.mkdtempSync(path.join(os.tmpdir(), 'arcade-'));
const env = { ...process.env, HOME: home, USERPROFILE: home };

const run = (script, input, args = []) =>
  execFileSync(process.execPath, [path.join(SCRIPTS, script), ...args], { input: JSON.stringify(input), env, encoding: 'utf8' });
const hook = (event, extra = {}) => run('hook.js', { hook_event_name: event, session_id: 's1', ...extra });
const toast = (out) => (out ? JSON.parse(out).systemMessage : '');
const state = () => JSON.parse(fs.readFileSync(path.join(home, '.claude', 'arcade', 'state.json'), 'utf8'));

test('session start greets the player', () => {
  assert.match(toast(hook('SessionStart', { source: 'startup' })), /Lv 1 .*streak/);
});

test('tool use earns XP and builds a combo', () => {
  hook('UserPromptSubmit');
  for (let i = 0; i < 12; i++) hook('PostToolUse', { tool_name: 'Edit' });
  const s = state();
  assert.strictEqual(s.tools.editing, 12);
  assert.strictEqual(s.sessions.s1.combo, 12);
  assert.ok(s.xp >= 60);
});

test('pre tool use sets the mode shown in the HUD', () => {
  hook('PreToolUse', { tool_name: 'Bash', tool_input: { command: 'npm test', description: 'Run the test suite' } });
  const hud = run('statusline.js', { session_id: 's1', context_window: { used_percentage: 34 }, cost: { total_cost_usd: 1.2 } });
  assert.match(hud, /Casting/);
  assert.match(hud, /Run the test suite/);
  assert.match(hud, /mana 66%/);
  assert.strictEqual(hud.split('\n').length, 2);
});

test('subagents join and leave the party', () => {
  assert.match(toast(hook('SubagentStart', { agent_id: 'a1', agent_type: 'Explore' })), /Explore joined your party/);
  assert.deepStrictEqual(Object.keys(state().sessions.s1.party), ['a1']);
  assert.match(run('statusline.js', { session_id: 's1' }), /party 1/);
  hook('SubagentStop', { agent_id: 'a1' });
  assert.deepStrictEqual(Object.keys(state().sessions.s1.party), []);
});

test('failures cost HP and break the combo', () => {
  hook('PostToolUseFailure', { tool_name: 'Bash' });
  const ses = state().sessions.s1;
  assert.strictEqual(ses.hp, 90);
  assert.strictEqual(ses.combo, 0);
});

test('stop completes the quest, levels up and unlocks achievements', () => {
  let toasts = '';
  for (let i = 0; i < 5; i++) toasts += toast(hook('PostToolUse', { tool_name: 'Edit' })); // push past 100 XP
  const msg = toast(hook('Stop'));
  assert.match(toasts + msg, /LEVEL UP! Lv 2/);
  assert.match(msg, /Quest complete! \+\d+ XP/);
  assert.match(msg, /First Blood/);
  assert.strictEqual(state().quests, 1);
});

test('subagent rows render as party members', () => {
  const out = run('subagents.js', { columns: 100, tasks: [
    { id: 't1', type: 'Explore', status: 'running', description: 'Find auth code', tokenCount: 20000, contextWindowSize: 200000 },
  ] });
  const row = JSON.parse(out);
  assert.strictEqual(row.id, 't1');
  assert.match(row.content, /Ranger/);
});

test('hooks never fail on garbage input', () => {
  execFileSync(process.execPath, [path.join(SCRIPTS, 'hook.js')], { input: 'not json', env });
});

test('setup and uninstall round-trip user settings', () => {
  const settingsFile = path.join(home, '.claude', 'settings.json');
  fs.writeFileSync(settingsFile, JSON.stringify({ model: 'opus', statusLine: { type: 'command', command: 'mine' } }));
  run('arcade.js', {}, ['setup', 'retro']);
  const s = JSON.parse(fs.readFileSync(settingsFile, 'utf8'));
  assert.match(s.statusLine.command, /statusline\.js/);
  assert.strictEqual(s.statusLine.refreshInterval, 1);
  assert.strictEqual(s.spinnerVerbs.mode, 'replace');
  assert.match(run('statusline.js', { session_id: 's1' }), /PTS/); // retro theme
  run('arcade.js', {}, ['uninstall']);
  assert.deepStrictEqual(JSON.parse(fs.readFileSync(settingsFile, 'utf8')), { model: 'opus', statusLine: { type: 'command', command: 'mine' } });
});
