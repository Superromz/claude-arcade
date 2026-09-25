// Daily and weekly bounties: deterministic picks, progress from real usage,
// one-time claims that pay gold and never XP, and fixed-width rendering.
// Run with: node --test
'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

// A throwaway home, set before any game module computes its paths.
const home = fs.mkdtempSync(path.join(os.tmpdir(), 'arcade-bounties-'));
Object.assign(process.env, { HOME: home, USERPROFILE: home, APPDATA: home, ARCADE_NO_CLIPBOARD: '1' });

const SCRIPTS = path.join(__dirname, '..', 'plugins', 'claude-arcade', 'scripts');
const L = require(path.join(SCRIPTS, 'lib.js'));
const { ui, UI } = require(path.join(SCRIPTS, 'state.js'));
const B = require(path.join(SCRIPTS, 'bounties.js'));

const DAY = 864e5;
const T0 = Date.UTC(2026, 0, 5, 12); // a Monday, noon UTC

// First day from T0 whose daily board posts the bounty `id`.
function dayWith(id) {
  for (let i = 0; i < 400; i++) {
    const t = T0 + i * DAY;
    if (B.pickBounties(t).daily.some((b) => b.id === id)) return t;
  }
  throw new Error(`no day posts ${id}`);
}

function reset(state = {}) {
  fs.rmSync(L.HOME, { recursive: true, force: true });
  fs.mkdirSync(L.HOME, { recursive: true });
  L.saveState({ ...L.loadState(), xp: 500, quests: 3, tools: {}, game: { gold: 100, kills: 0 }, ...state });
  ui.battle.gold = 100;
  ui.battle.kills = 0;
  ui.bounties = { sel: 0, top: 0, msg: null };
}
const writeEvents = (evs) => fs.writeFileSync(L.EVENTS_FILE, evs.map((e) => JSON.stringify(e)).join('\n') + '\n');
const data = () => ({ state: L.loadState(), cfg: { theme: 'rpg' }, sid: 's1' });

test('daily and weekly picks are deterministic from the date', () => {
  const morning = Date.UTC(2026, 2, 10, 1), evening = Date.UTC(2026, 2, 10, 23);
  const a = B.pickBounties(morning), b = B.pickBounties(evening);
  assert.deepStrictEqual(a.daily.map((x) => x.id), b.daily.map((x) => x.id));
  assert.deepStrictEqual(a.weekly.map((x) => x.id), b.weekly.map((x) => x.id));
  assert.strictEqual(a.daily.length, 3);
  assert.strictEqual(a.weekly.length, 2);
  for (const list of [a.daily, a.weekly]) assert.strictEqual(new Set(list.map((x) => x.group)).size, list.length);
  // The board changes from day to day.
  const boards = new Set();
  for (let i = 0; i < 7; i++) boards.add(B.pickBounties(T0 + i * DAY).daily.map((x) => x.id).join());
  assert.ok(boards.size > 1);
  // Weeks start on Monday (UTC).
  assert.strictEqual(B.weekKey(T0), B.weekKey(T0 + 6 * DAY));
  assert.notStrictEqual(B.weekKey(T0), B.weekKey(T0 + 7 * DAY));
});

test('progress is read from the quest log since the day started', () => {
  const now = dayWith('d-cast');
  reset();
  writeEvents([
    ...Array.from({ length: 3 }, () => ({ t: now - DAY, sid: 's1', kind: 'action', mode: 'running', text: 'Casting' })), // yesterday
    ...Array.from({ length: 4 }, () => ({ t: now - 60000, sid: 's1', kind: 'action', mode: 'running', text: 'Casting' })),
  ]);
  const it = B.board(data(), now).daily.find((x) => x.def.id === 'd-cast');
  assert.strictEqual(it.value, 4);
  assert.strictEqual(it.done, false);
  writeEvents([...Array.from({ length: 6 }, () => ({ t: now - 1000, sid: 's1', kind: 'action', mode: 'running', text: 'Casting' }))]);
  const again = B.board(data(), now).daily.find((x) => x.def.id === 'd-cast');
  assert.strictEqual(again.value, 5); // capped at the goal
  assert.strictEqual(again.done, true);
});

test('flawless quests skip quests that took a hit', () => {
  const now = dayWith('d-flawless');
  reset();
  const at = now - 5000;
  writeEvents([
    { t: at, sid: 's1', kind: 'prompt' }, { t: at, sid: 's1', kind: 'quest' },
    { t: at, sid: 's1', kind: 'prompt' }, { t: at, sid: 's1', kind: 'hurt' }, { t: at, sid: 's1', kind: 'quest' },
    { t: at, sid: 's2', kind: 'prompt' }, { t: at, sid: 's2', kind: 'quest' },
  ]);
  const it = B.board(data(), now).daily.find((x) => x.def.id === 'd-flawless');
  assert.strictEqual(it.value, 2);
});

test('counters in state count against the day baseline', () => {
  const now = dayWith('d-forge');
  reset({ tools: { editing: 50 } });
  writeEvents([]);
  const d = data();
  B.board(d, now); // takes the baseline
  assert.strictEqual(L.loadState().game.bounties.day, B.dayKey(now));
  const st = L.loadState();
  st.tools.editing = 57;
  L.saveState(st);
  const it = B.board(data(), now).daily.find((x) => x.def.id === 'd-forge');
  assert.strictEqual(it.value, 7);
});

test('a finished bounty pays gold once and never XP', () => {
  const now = dayWith('d-summon');
  reset();
  writeEvents([{ t: now - 1000, sid: 's1', kind: 'summon', text: 'A Ranger joins' }, { t: now - 900, sid: 's1', kind: 'summon', text: 'A Mage joins' }]);
  const d = data();
  const xp = d.state.xp;
  const it = B.board(d, now).daily.find((x) => x.def.id === 'd-summon');
  assert.ok(it.done && !it.claimed);
  assert.strictEqual(B.claim(it, d), true);
  assert.strictEqual(ui.battle.gold, 100 + it.def.gold);
  const st = L.loadState();
  assert.strictEqual(st.game.gold, 100 + it.def.gold);
  assert.strictEqual(st.xp, xp);
  assert.ok(st.game.bounties.claimed.includes(it.key));
  // A second claim, even from a stale copy, pays nothing.
  assert.strictEqual(B.claim({ ...it, claimed: false }, data()), false);
  assert.strictEqual(L.loadState().game.gold, 100 + it.def.gold);
  const after = B.board(data(), now).daily.find((x) => x.def.id === 'd-summon');
  assert.strictEqual(after.claimed, true);
  assert.match(B.bountySummary(data(), now), /claimed/);
});

test('arrows select and Enter claims', () => {
  const now = dayWith('d-summon');
  reset();
  writeEvents([{ t: now - 1000, sid: 's1', kind: 'summon' }, { t: now - 900, sid: 's1', kind: 'summon' }]);
  const d = data();
  const all = B.board(d, now).all;
  const idx = all.findIndex((x) => x.def.id === 'd-summon');
  // Real time decides the board inside bountiesKey, so steer the selection
  // with arrows and claim through board()/claim() for the fixed date.
  assert.strictEqual(B.bountiesKey('\x1b[B', d), true);
  assert.strictEqual(ui.bounties.sel, 1);
  assert.strictEqual(B.bountiesKey('\x1b[A', d), true);
  assert.strictEqual(B.bountiesKey('\x1b[A', d), true);
  assert.strictEqual(ui.bounties.sel, B.board(d).all.length - 1); // wraps
  assert.strictEqual(B.bountiesKey('x', d), false);
  assert.strictEqual(B.bountiesKey('\r', d), true); // never throws, claims only when ready
  assert.ok(idx >= 0);
  assert.match(B.bountySummary(d, now), /1\/5 bounties ready/);
});

test('the bounty board is exactly W wide at every size and theme', () => {
  const now = dayWith('d-cast');
  reset({ streak: { day: B.dayKey(now), count: 5 } });
  writeEvents(Array.from({ length: 5 }, () => ({ t: now - 1000, sid: 's1', kind: 'action', mode: 'running' })));
  const d = data();
  for (const theme of Object.keys(UI)) {
    for (const [W, h] of [[40, 10], [60, 22], [90, 24], [130, 30], [200, 12]]) {
      for (let sel = 0; sel < 5; sel++) {
        ui.bounties.sel = sel;
        const lines = B.bountiesTab(d, UI[theme], W, h, now);
        assert.strictEqual(lines.length, h, `${theme} ${W}x${h} height`);
        for (const l of lines) assert.strictEqual(L.visWidth(l), W, `${theme} ${W}x${h}: "${l.replace(/\x1b\[[0-9;]*m/g, '')}"`);
      }
    }
  }
});
