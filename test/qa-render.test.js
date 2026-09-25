// QA: every screen at many terminal sizes, glyph widths, and hostile text.
// Tests marked { todo: 'bug: ...' } document real bugs found in QA; they run
// but don't fail the suite. Run with: node --test
'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

const SCRIPTS = path.join(__dirname, '..', 'plugins', 'claude-arcade', 'scripts');
const L = require(path.join(SCRIPTS, 'lib.js'));
const { TABS } = require(path.join(SCRIPTS, 'state.js'));

const SGR = /\x1b\[[0-9;]*m/g;
const strip = (s) => s.replace(SGR, '');

// Width a real terminal gives a character: wide for Emoji_Presentation and
// East Asian Wide/Fullwidth, zero for joiners, selectors and combining marks.
function termWidth(s) {
  let w = 0;
  for (const ch of strip(String(s))) {
    const cp = ch.codePointAt(0);
    if (cp === 0x200d || cp === 0xfe0f || cp === 0xfe0e || (cp >= 0x300 && cp < 0x370) || (cp >= 0x1f3fb && cp <= 0x1f3ff)) continue;
    if (/\p{Emoji_Presentation}/u.test(ch)) { w += 2; continue; }
    if ((cp >= 0x1100 && cp <= 0x115f) || (cp >= 0x2e80 && cp <= 0xa4cf) || (cp >= 0xac00 && cp <= 0xd7a3) || (cp >= 0xf900 && cp <= 0xfaff) || (cp >= 0xff00 && cp <= 0xff60) || (cp >= 0xffe0 && cp <= 0xffe6)) { w += 2; continue; }
    w += 1;
  }
  return w;
}

function sandbox() {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'arcade-qa-render-'));
  const env = { ...process.env, HOME: home, USERPROFILE: home, APPDATA: home, ARCADE_NO_CLIPBOARD: '1' };
  const hook = (event, extra = {}) => execFileSync(process.execPath, [path.join(SCRIPTS, 'hook.js')], {
    input: JSON.stringify({ hook_event_name: event, session_id: 's1', cwd: SCRIPTS, ...extra }), env,
  });
  const snap = (screen, cols, rows, extraEnv = {}) => execFileSync(process.execPath, [path.join(SCRIPTS, 'game.js'), '--snapshot', String(screen)], {
    env: { ...env, COLUMNS: String(cols), LINES: String(rows), ARCADE_WARMUP: '6', ...extraEnv }, encoding: 'utf8',
  }).replace(/\n$/, '').split('\n');
  const lib = (code) => execFileSync(process.execPath, ['-e', `const L=require(${JSON.stringify(path.join(SCRIPTS, 'lib.js'))});${code}`], { env });
  return { home, env, hook, snap, lib };
}

// One busy world with two heroes, a party and a failure, shared by the size sweep.
const world = sandbox();
world.lib("L.createHero({name:'Zed',cls:'knight'});L.createHero({name:'Averyveryveryverylongheroname',cls:'bard'});");
world.hook('SessionStart', { source: 'startup' });
world.hook('UserPromptSubmit', { prompt: 'Fix the parser and add tests' });
for (const tool of ['Edit', 'Bash', 'Read', 'Grep', 'WebFetch', 'TodoWrite']) {
  world.hook('PreToolUse', { tool_name: tool, tool_input: { file_path: '/x/parser.js', command: 'npm test', pattern: 'foo' } });
  world.hook('PostToolUse', { tool_name: tool });
}
for (const [id, type] of [['a1', 'Explore'], ['a2', 'general-purpose'], ['a3', 'Plan']]) world.hook('SubagentStart', { agent_id: id, agent_type: type });
world.hook('PostToolUseFailure', { tool_name: 'Bash' });

const SIZES = [[50, 16], [80, 24], [100, 30], [130, 36], [180, 50], [220, 80]];
const SCREENS = [...TABS.map((_, i) => String(i + 1)), 'roster', 'create'];
const rendered = {}; // `${screen}@${cols}x${rows}` -> lines

for (const [cols, rows] of SIZES) {
  test(`every screen is exactly ${cols}x${rows} (visWidth)`, () => {
    for (const screen of SCREENS) {
      const lines = world.snap(screen, cols, rows);
      rendered[`${screen}@${cols}x${rows}`] = lines;
      assert.strictEqual(lines.length, rows, `${screen} at ${cols}x${rows}: ${lines.length} lines`);
      lines.forEach((l, i) => assert.strictEqual(L.visWidth(l), cols, `${screen} at ${cols}x${rows}, row ${i}: ${JSON.stringify(strip(l))}`));
    }
  });
}

test('rendered frames only use glyphs whose terminal width matches visWidth', { todo: 'bug: ⚔ and 🛡 (text presentation, 1 cell) count as 2 in lib.visWidth, ＋ (fullwidth, 2 cells) counts as 1; roster cards and quest log rows misalign in real terminals' }, () => {
  const bad = new Map();
  for (const [key, lines] of Object.entries(rendered)) {
    for (const ch of new Set([...strip(lines.join(''))])) {
      if (ch.codePointAt(0) < 0x80) continue;
      if (L.visWidth(ch) !== termWidth(ch)) bad.set(ch, key);
    }
  }
  assert.deepStrictEqual([...bad.keys()], [], [...bad].map(([c, k]) => `${c} U+${c.codePointAt(0).toString(16)} in ${k}`).join(', '));
});

test('visWidth agrees with terminals on text-presentation symbols', { todo: 'bug: lib.visWidth treats every Extended_Pictographic char in U+2600-27BF as wide and U+2B50 as narrow; it should follow Emoji_Presentation (or a trailing U+FE0F)' }, () => {
  for (const [s, w] of [['⚔', 1], ['🛡', 1], ['❤', 1], ['☠', 1], ['⚡', 2], ['⭐', 2], ['＋', 2], ['❤️', 2]]) {
    assert.strictEqual(L.visWidth(s), w, `${s} U+${s.codePointAt(0).toString(16)}`);
  }
});

test('visWidth counts flags, skin tones and ZWJ families as one wide glyph', { todo: 'bug: regional-indicator pairs, skin-tone modifiers and ZWJ sequences are summed per code point' }, () => {
  for (const s of ['🇺🇸', '👍🏽', '👨‍👩‍👧']) assert.strictEqual(L.visWidth(s), 2, s);
});

test('a CJK or emoji prompt in the thought bubble keeps the frame width', { todo: 'bug: PixelCanvas.label (pixel.js) puts one code point per cell, so wide and zero-width chars shift the rest of the row' }, () => {
  for (const prompt of ['修复这个错误 please', 'family 👨‍👩‍👧 done', 'café café']) {
    const w = sandbox();
    w.hook('UserPromptSubmit', { prompt });
    for (const [cols, rows] of [[90, 26], [130, 36]]) {
      const lines = w.snap('1', cols, rows);
      lines.forEach((l, i) => assert.strictEqual(L.visWidth(l), cols, `${JSON.stringify(prompt)} ${cols}x${rows} row ${i}: ${JSON.stringify(strip(l))}`));
    }
  }
});

test('control characters and escape sequences from prompts never reach the terminal', { todo: 'bug: prompt text and tool details pass raw ESC/BEL/BS through to the frame (terminal escape injection, e.g. OSC 52 clipboard writes or clear screen)' }, () => {
  const w = sandbox();
  w.hook('UserPromptSubmit', { prompt: 'clear \x1b[2J title \x1b]0;pwned\x07 bell\x07 back\x08' });
  w.hook('PreToolUse', { tool_name: 'Bash', tool_input: { command: 'echo \x1b[8mhidden\x1b[0m' } });
  const out = w.snap('1', 130, 36).join('\n');
  assert.ok(!/[\x00-\x09\x0b-\x1f\x7f]/.test(out.replace(SGR, '')), 'the Adventure tab contains raw control characters');
});

test('the Trophies header fits narrow panes', { todo: 'bug: the TROPHY HALL row is 4 columns too wide below ~75 columns (panels.js trophiesTab header)' }, () => {
  const trophies = String(TABS.indexOf('Trophies') + 1);
  for (const cols of [56, 64, 70]) {
    const lines = world.snap(trophies, cols, 22);
    lines.forEach((l, i) => assert.strictEqual(L.visWidth(l), cols, `${cols} cols row ${i}: ${JSON.stringify(strip(l))}`));
  }
});

test('short panes keep the hotbar and footer on screen', { todo: 'bug: at 12 rows the frame is 13-14 lines; the live renderer slices to rows, which drops the footer with the quit key' }, () => {
  for (const screen of ['1', '2', 'create']) assert.strictEqual(world.snap(screen, 100, 12).length, 12, screen);
});

test('panes narrower than 50 columns still fit', { todo: 'bug: game frames clamp to 50 columns (W = max(50, cols)), so a 40-column pane wraps every line' }, () => {
  for (const screen of ['1', 'roster', 'create']) {
    const lines = world.snap(screen, 40, 16);
    lines.forEach((l, i) => assert.ok(L.visWidth(l) <= 40, `${screen} row ${i} is ${L.visWidth(l)} wide`));
  }
});
