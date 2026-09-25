// QA: the hook lifecycle end to end in a throwaway HOME: XP accounting,
// synthetic prompts, subagents, concurrency, hero switching, approvals and
// token XP. Tests marked { todo: 'bug: ...' } document real bugs found in QA.
// Run with: node --test
'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync, spawn } = require('child_process');

const SCRIPTS = path.join(__dirname, '..', 'plugins', 'claude-arcade', 'scripts');
const C = require(path.join(SCRIPTS, 'character.js'));
const LIB = require(path.join(SCRIPTS, 'lib.js'));

function sandbox() {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'arcade-qa-hooks-'));
  const dir = path.join(home, '.claude', 'arcade');
  const env = { ...process.env, HOME: home, USERPROFILE: home, APPDATA: home, ARCADE_NO_CLIPBOARD: '1' };
  const hook = (event, extra = {}) => {
    const out = execFileSync(process.execPath, [path.join(SCRIPTS, 'hook.js')], {
      input: JSON.stringify({ hook_event_name: event, session_id: 's1', ...extra }), env, encoding: 'utf8',
    });
    return out ? JSON.parse(out) : {};
  };
  const hookAsync = (event, extra = {}) => new Promise((resolve) => {
    const p = spawn(process.execPath, [path.join(SCRIPTS, 'hook.js')], { env });
    let out = '';
    p.stdout.on('data', (b) => { out += b; });
    p.on('exit', () => resolve(out));
    p.stdin.end(JSON.stringify({ hook_event_name: event, session_id: 's1', ...extra }));
  });
  const state = () => JSON.parse(fs.readFileSync(path.join(dir, 'state.json'), 'utf8'));
  // Run lib.js code inside the sandbox (lib resolves HOME when it loads).
  const lib = (code) => JSON.parse(execFileSync(process.execPath, ['-e',
    `const L=require(${JSON.stringify(path.join(SCRIPTS, 'lib.js'))});const r=(()=>{${code}})();process.stdout.write(JSON.stringify(r===undefined?null:r));`],
  { env, encoding: 'utf8' }) || 'null');
  const mkproject = (name) => { const p = path.join(home, 'work', name); fs.mkdirSync(path.join(p, '.git'), { recursive: true }); return p; };
  return { home, dir, env, hook, hookAsync, state, lib, mkproject };
}

test('XP adds up exactly over a full turn (tools, subagent, stop)', () => {
  const w = sandbox();
  w.lib("L.createHero({name:'Ann',cls:'mage'})");
  w.hook('SessionStart', { source: 'startup' });
  w.hook('UserPromptSubmit', { prompt: 'do it' });
  const hero = { cls: 'mage' };
  let expected = 0, combo = 0;
  for (const tool of ['Bash', 'Bash', 'Edit', 'Read', 'WebSearch']) {
    w.hook('PreToolUse', { tool_name: tool });
    w.hook('PostToolUse', { tool_name: tool });
    combo += 1;
    const mode = LIB.modeForTool(tool);
    expected += C.xpFor(hero, mode, LIB.TOOL_XP[mode], combo);
  }
  // Launching an agent: the Agent tool call itself earns nothing, the join does.
  w.hook('PostToolUse', { tool_name: 'Agent' });
  w.hook('SubagentStart', { agent_id: 'a1', agent_type: 'Explore' });
  expected += C.xpFor(hero, 'summoning', LIB.TOOL_XP.summoning, combo);
  w.hook('SubagentStop', { agent_id: 'a1' });
  expected += 5;
  w.hook('Stop');
  expected += 10;
  const s = w.state();
  assert.strictEqual(s.xp, expected);
  assert.strictEqual(s.sessions.s1.turn.xp, expected);
  assert.strictEqual(s.quests, 1);
  assert.strictEqual(s.tools.summoning, 1);
});

test('synthetic "<" prompts continue the quest instead of starting a new one', () => {
  const w = sandbox();
  w.hook('UserPromptSubmit', { prompt: 'real prompt' });
  for (let i = 0; i < 4; i++) w.hook('PostToolUse', { tool_name: 'Read' });
  const start = w.state().sessions.s1.turn.start;
  w.hook('UserPromptSubmit', { prompt: '<task-notification>agent done</task-notification>' });
  let ses = w.state().sessions.s1;
  assert.strictEqual(ses.turn.start, start);
  assert.strictEqual(ses.combo, 4);
  w.hook('UserPromptSubmit', { prompt: '  next real prompt' });
  ses = w.state().sessions.s1;
  assert.strictEqual(ses.combo, 0);
  assert.notStrictEqual(ses.turn.start, start);
});

test('a SubagentStop for an unknown agent leaves the other party members alone', { todo: 'bug: hook.js SubagentStop falls back to deleting the first party member when agent_id is unknown or missing' }, () => {
  const w = sandbox();
  w.hook('SubagentStart', { agent_id: 'a1', agent_type: 'Explore' });
  w.hook('SubagentStart', { agent_id: 'a2', agent_type: 'Plan' });
  w.hook('SubagentStop', { agent_id: 'ghost' });
  assert.deepStrictEqual(Object.keys(w.state().sessions.s1.party).sort(), ['a1', 'a2']);
});

test('a SubagentStop with no matching agent earns no XP', { todo: 'bug: hook.js SubagentStop grants +5 XP even when no agent was in the party (XP without real usage)' }, () => {
  const w = sandbox();
  w.hook('UserPromptSubmit', { prompt: 'x' });
  const before = w.state().xp;
  w.hook('SubagentStop', { agent_id: 'never-started' });
  w.hook('SubagentStop', {});
  assert.strictEqual(w.state().xp, before);
});

test('20 hooks fired at once lose no updates', async () => {
  const w = sandbox();
  w.hook('UserPromptSubmit', { prompt: 'x' });
  await Promise.all(Array.from({ length: 20 }, () => w.hookAsync('PostToolUse', { tool_name: 'Read' })));
  const s = w.state();
  assert.strictEqual(s.tools.reading, 20);
  assert.strictEqual(s.sessions.s1.combo, 20);
  assert.ok(!fs.existsSync(path.join(w.dir, 'state.lock')), 'lock left behind');
});

test('a burst of 80 hooks loses no updates and leaves no temp files', { todo: 'bug: lib.withLock gives up after 1.5 s and runs unlocked, and writeJSON renames fail with EPERM on Windows while another process reads state.json; ~10-45% of updates are lost and orphan state.json.<pid>.tmp files pile up' }, async () => {
  const w = sandbox();
  w.hook('UserPromptSubmit', { prompt: 'x' });
  await Promise.all(Array.from({ length: 80 }, () => w.hookAsync('PostToolUse', { tool_name: 'Read' })));
  assert.strictEqual(w.state().tools.reading, 80);
  assert.deepStrictEqual(fs.readdirSync(w.dir).filter((f) => f.endsWith('.tmp')), []);
});

test('heroes keep separate progress across create, switch and delete', () => {
  const w = sandbox();
  const a = w.lib("return L.createHero({name:'A',cls:'mage'}).cfg.activeHero");
  w.hook('UserPromptSubmit', { prompt: 'x' });
  w.hook('PostToolUse', { tool_name: 'Edit' });
  w.hook('Stop');
  const aXp = w.state().xp;
  assert.ok(aXp > 0);
  const b = w.lib("return L.createHero({name:'B',cls:'rogue'}).cfg.activeHero");
  assert.strictEqual(w.state().xp, 0, 'a new hero starts at 0 XP');
  w.hook('UserPromptSubmit', { prompt: 'y' });
  w.hook('Stop');
  const bXp = w.state().xp;
  w.lib(`L.switchHero(${JSON.stringify(a)})`);
  assert.strictEqual(w.state().xp, aXp);
  assert.strictEqual(w.state().heroes[b].xp, bXp);
  w.lib(`L.deleteHero(${JSON.stringify(a)})`);
  assert.strictEqual(w.state().xp, bXp, 'deleting the active hero loads the next one');
  w.lib("L.switchHero('no-such-hero')");
  assert.strictEqual(w.state().xp, bXp);
});

test('a new hero does not inherit project-count trophies from another hero', { todo: 'bug: state.projects is shared by all heroes but projects-3/10/25 are per-hero achievements, so a brand-new hero unlocks Wanderer on its first event' }, () => {
  const w = sandbox();
  w.lib("L.createHero({name:'A',cls:'mage'})");
  for (const name of ['p1', 'p2', 'p3']) w.hook('PostToolUse', { tool_name: 'Read', cwd: w.mkproject(name) });
  assert.ok(w.state().achievements.includes('projects-3'));
  w.lib("L.createHero({name:'B',cls:'knight'})");
  w.hook('PostToolUse', { tool_name: 'Read', cwd: w.mkproject('p1') });
  assert.ok(!w.state().achievements.includes('projects-3'));
});

test('an in-game "deny" answer is passed back to Claude', async () => {
  const w = sandbox();
  fs.mkdirSync(w.dir, { recursive: true });
  const beat = setInterval(() => fs.writeFileSync(path.join(w.dir, 'game.alive'), '1'), 200);
  fs.writeFileSync(path.join(w.dir, 'game.alive'), '1');
  try {
    const pending = w.hookAsync('PermissionRequest', { tool_name: 'Bash', tool_input: { command: 'rm -rf /' }, cwd: w.home });
    let req = [];
    for (let i = 0; i < 60 && !req.length; i++) { await new Promise((r) => setTimeout(r, 100)); req = w.lib('return L.pendingApprovals()'); }
    assert.strictEqual(req.length, 1);
    w.lib(`L.answerApproval(${JSON.stringify(req[0].id)}, 'deny')`);
    const out = JSON.parse(await pending);
    assert.strictEqual(out.hookSpecificOutput.decision.behavior, 'deny');
    assert.deepStrictEqual(w.lib('return L.pendingApprovals()'), []);
  } finally { clearInterval(beat); }
});

test('stale approval requests from a dead hook are not shown forever', { todo: 'bug: lib.pendingApprovals has no age limit and answering never deletes the .req.json, so a request left by a killed hook (Esc in Claude, closed terminal) keeps the modal open and swallows keys' }, () => {
  const w = sandbox();
  const dir = path.join(w.dir, 'approvals');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'old.req.json'), JSON.stringify({ id: 'old', t: Date.now() - 10 * 60 * 1000, tool: 'Bash', input: { command: 'ls' } }));
  assert.deepStrictEqual(w.lib('return L.pendingApprovals().map((r) => r.id)'), []);
});

// A transcript line in Claude Code's format with one assistant message.
const usageLine = (id, output, input = 0) => JSON.stringify({ type: 'assistant', message: { id, role: 'assistant', usage: { input_tokens: input, output_tokens: output } } });

test('token XP counts each assistant message once across Stop hooks', () => {
  const w = sandbox();
  const tr = path.join(w.home, 't.jsonl');
  fs.writeFileSync(tr, [usageLine('m1', 1500), usageLine('m1', 1500), usageLine('m2', 3000, 30000)].join('\n') + '\n');
  w.hook('Stop', { transcript_path: tr });
  const first = w.state();
  assert.strictEqual(first.tokens.output, 4500);
  assert.strictEqual(first.tokenXp, C.tokenXp({ output: 4500, input: 30000 }));
  w.hook('Stop', { transcript_path: tr }); // nothing new appended
  assert.strictEqual(w.state().tokenXp, first.tokenXp);
});

test('a resumed or forked session does not re-award tokens already counted', { todo: 'bug: token offsets are keyed by session id, so a transcript copied into a new session (claude --resume / --fork-session) is read from byte 0 and its old usage earns XP again (up to 8 MB per resume)' }, () => {
  const w = sandbox();
  const lines = [usageLine('m1', 15000, 60000), usageLine('m2', 15000)];
  const a = path.join(w.home, 'a.jsonl'), b = path.join(w.home, 'b.jsonl');
  fs.writeFileSync(a, lines.join('\n') + '\n');
  w.hook('Stop', { transcript_path: a, session_id: 'old' });
  const xp = w.state().tokenXp;
  fs.writeFileSync(b, lines.join('\n') + '\n'); // the resumed session's copy of the history
  w.hook('Stop', { transcript_path: b, session_id: 'new' });
  assert.strictEqual(w.state().tokenXp, xp);
});
