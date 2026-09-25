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
const { visWidth } = require(path.join(SCRIPTS, 'lib.js'));
const home = fs.mkdtempSync(path.join(os.tmpdir(), 'arcade-'));
// APPDATA too, so setup never writes the arcade shim into the real npm dir.
const env = { ...process.env, HOME: home, USERPROFILE: home, APPDATA: home };

const run = (script, input, args = []) =>
  execFileSync(process.execPath, [path.join(SCRIPTS, script), ...args], { input: JSON.stringify(input), env, encoding: 'utf8' });
const hook = (event, extra = {}) => run('hook.js', { hook_event_name: event, session_id: 's1', ...extra });
const toast = (out) => (out ? JSON.parse(out).systemMessage : '');
const state = () => JSON.parse(fs.readFileSync(path.join(home, '.claude', 'arcade', 'state.json'), 'utf8'));

test('session start greets the player', () => {
  assert.match(toast(hook('SessionStart', { source: 'startup' })), /streak/);
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
  assert.match(toast(hook('SubagentStart', { agent_id: 'a1', agent_type: 'Explore' })), /Ranger/);
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
  assert.match(toasts + msg, /Lv 2/);
  assert.match(msg, /Forged \d+ files.*\+\d+ XP in \d+s/);
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

test('game pane renders every tab at a fixed width', () => {
  const strip = (s) => s.replace(/\x1b\[[0-9;?]*[A-Za-z]/g, '');
  for (const tab of ['1', '2', '3', '4']) {
    const out = execFileSync(process.execPath, [path.join(SCRIPTS, 'game.js'), '--snapshot', tab], {
      env: { ...env, COLUMNS: '90', LINES: '26' }, encoding: 'utf8',
    });
    const lines = strip(out.replace(/\n$/, '')).split('\n');
    assert.strictEqual(lines.length, 26, `tab ${tab} height`);
    assert.match(lines[0], /CLAUDE ARCADE/);
    for (const l of lines) assert.strictEqual(visWidth(l), 90, `tab ${tab}: "${l}"`);
  }
});

test('quest log records what happened', () => {
  const log = fs.readFileSync(path.join(home, '.claude', 'arcade', 'events.jsonl'), 'utf8');
  assert.match(log, /"kind":"summon"/);
  assert.match(log, /"kind":"hurt"/);
  assert.match(log, /"kind":"quest"/);
});

test('play prints a launch command outside Windows Terminal', () => {
  const out = execFileSync(process.execPath, [path.join(SCRIPTS, 'arcade.js'), 'play'], {
    env: { ...env, WT_SESSION: '' }, encoding: 'utf8',
  });
  assert.match(out, /game\.js/);
});

test('character creator renders at a fixed width', () => {
  const strip = (s) => s.replace(/\x1b\[[0-9;?]*[A-Za-z]/g, '');
  const out = execFileSync(process.execPath, [path.join(SCRIPTS, 'game.js'), '--snapshot', 'create'], {
    env: { ...env, COLUMNS: '100', LINES: '30', ARCADE_WARMUP: '3' }, encoding: 'utf8',
  });
  const lines = strip(out.replace(/\n$/, '')).split('\n');
  assert.strictEqual(lines.length, 30);
  assert.match(lines[0], /Create your hero/);
  for (const l of lines) assert.strictEqual(visWidth(l), 100, l);
});

test('class bonuses and token XP', () => {
  const C = require(path.join(SCRIPTS, 'character.js'));
  const knight = C.defaultCharacter('knight');
  assert.strictEqual(C.xpFor(knight, 'editing', 5, 0), 8);
  assert.strictEqual(C.xpFor(knight, 'running', 3, 0), 3);
  assert.strictEqual(C.xpFor(C.defaultCharacter('rogue'), 'running', 3, 20), 7);
  // Usage lines repeat per content block; each message id counts once.
  const tr = path.join(home, 'transcript.jsonl');
  const usage = { input_tokens: 100, cache_creation_input_tokens: 2900, output_tokens: 300 };
  fs.writeFileSync(tr, [1, 2].map(() => JSON.stringify({ message: { id: 'm1', usage } })).join('\n') + '\n');
  const offsets = {};
  assert.deepStrictEqual(C.readTokens(tr, offsets, 'k'), { input: 3000, output: 300 });
  assert.deepStrictEqual(C.readTokens(tr, offsets, 'k'), { input: 0, output: 0 }); // incremental
  assert.strictEqual(C.tokenXp({ input: 3000, output: 300 }), 3);
});

test('spells unlock by level and hit harder when stronger', () => {
  const C = require(path.join(SCRIPTS, 'character.js'));
  assert.strictEqual(C.spellFor(1, 'running', 1).id, 'basic');
  assert.strictEqual(C.spellFor(9, 'running', 1).id, 'chain');
  assert.ok(C.damage(C.SPELLS[0], 10, 20) > C.damage(C.SPELLS[0], 1, 5));
});

test('stop hook awards token XP from the transcript', () => {
  const tr = path.join(home, 'transcript2.jsonl');
  fs.writeFileSync(tr, JSON.stringify({ message: { id: 'x', usage: { input_tokens: 30000, output_tokens: 1500 } } }) + '\n');
  hook('UserPromptSubmit', { prompt: 'hello' });
  const msg = toast(hook('Stop', { transcript_path: tr, session_id: 's2' }));
  assert.match(msg, /20 from tokens/);
  assert.strictEqual(state().tokens.output, 1500);
});

test('stats are tracked per project (git root) as well as globally', () => {
  const repo = path.join(home, 'work', 'my-app');
  fs.mkdirSync(path.join(repo, '.git'), { recursive: true });
  fs.mkdirSync(path.join(repo, 'src', 'deep'), { recursive: true });
  const other = path.join(home, 'work', 'notes');
  fs.mkdirSync(other, { recursive: true });
  const before = state().xp;
  hook('SessionStart', { session_id: 'p1', source: 'startup', cwd: path.join(repo, 'src', 'deep') });
  hook('PostToolUse', { session_id: 'p1', tool_name: 'Edit', cwd: path.join(repo, 'src') });
  hook('Stop', { session_id: 'p1', cwd: repo });
  hook('PostToolUse', { session_id: 'p2', tool_name: 'Bash', cwd: other });
  const s = state();
  const projects = Object.values(s.projects);
  const app = projects.find((p) => p.name === 'my-app');
  const notes = projects.find((p) => p.name === 'notes');
  assert.ok(app && notes);
  assert.strictEqual(app.tools.editing, 1);
  assert.strictEqual(app.quests, 1);
  assert.strictEqual(app.sessions, 1);
  assert.strictEqual(notes.tools.running, 1);
  assert.strictEqual(s.xp - before, app.xp + notes.xp); // global = sum of this activity
  assert.match(run('arcade.js', {}, ['stats']), /PROJECTS[\s\S]*my-app[\s\S]*notes/);
});

test('permission requests can be answered from the game pane', async () => {
  const { spawn } = require('child_process');
  const arcade = path.join(home, '.claude', 'arcade');
  fs.mkdirSync(arcade, { recursive: true });
  const ask = (heartbeat, answer) => new Promise((resolve) => {
    if (heartbeat) fs.writeFileSync(path.join(arcade, 'game.alive'), '1'); else fs.rmSync(path.join(arcade, 'game.alive'), { force: true });
    const child = spawn(process.execPath, [path.join(SCRIPTS, 'hook.js')], { env });
    let out = '';
    child.stdout.on('data', (b) => { out += b; });
    child.on('close', () => resolve(out));
    child.stdin.end(JSON.stringify({ hook_event_name: 'PermissionRequest', session_id: 's1', tool_name: 'Bash', tool_input: { command: 'npm test' } }));
    if (!answer) return;
    const dir = path.join(arcade, 'approvals');
    const timer = setInterval(() => {
      fs.writeFileSync(path.join(arcade, 'game.alive'), '1'); // keep the heartbeat fresh
      const req = fs.existsSync(dir) && fs.readdirSync(dir).find((f) => f.endsWith('.req.json'));
      if (req) { clearInterval(timer); fs.writeFileSync(path.join(dir, req.replace('.req.json', '.answer.json')), JSON.stringify({ behavior: answer })); }
    }, 50);
  });
  // No game running: no output, Claude shows its normal dialog.
  assert.strictEqual(await ask(false), '');
  const allow = JSON.parse(await ask(true, 'allow'));
  assert.strictEqual(allow.hookSpecificOutput.decision.behavior, 'allow');
  const deny = JSON.parse(await ask(true, 'deny'));
  assert.strictEqual(deny.hookSpecificOutput.decision.behavior, 'deny');
  assert.strictEqual(await ask(true, 'claude'), ''); // hand back to Claude
  assert.deepStrictEqual(fs.readdirSync(path.join(arcade, 'approvals')), []); // cleaned up
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
