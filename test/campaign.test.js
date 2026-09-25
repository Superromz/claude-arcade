// The campaign: kingdoms from real projects, chapter objectives measured from
// real usage, one-time rewards that never grant XP, deterministic seasons,
// the codex, and fixed-width rendering of every view.
// Run with: node --test
'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

// A throwaway home, set before any game module computes its paths.
const home = fs.mkdtempSync(path.join(os.tmpdir(), 'arcade-campaign-'));
Object.assign(process.env, { HOME: home, USERPROFILE: home, APPDATA: home, ARCADE_NO_CLIPBOARD: '1' });

const SCRIPTS = path.join(__dirname, '..', 'plugins', 'claude-arcade', 'scripts');
const L = require(path.join(SCRIPTS, 'lib.js'));
const { ui, UI } = require(path.join(SCRIPTS, 'state.js'));
const Ch = require(path.join(SCRIPTS, 'character.js'));
const C = require(path.join(SCRIPTS, 'campaign.js'));

const NOW = Date.UTC(2026, 8, 25, 12);
const key = (p) => (process.platform === 'win32' ? p.toLowerCase() : p);
const proj = (name, xp, quests = 0, extra = {}) => ({ name, path: path.join(home, name), xp, quests, sessions: 1, tools: {}, tokens: { input: 0, output: 0 }, firstSeen: NOW - xp, lastSeen: NOW, ...extra });

function reset(state = {}) {
  fs.rmSync(L.HOME, { recursive: true, force: true });
  fs.mkdirSync(L.HOME, { recursive: true });
  L.saveState({ ...L.loadState(), xp: 500, quests: 3, tools: {}, projects: {}, game: { gold: 100, kills: 0, inventory: [] }, ...state });
  ui.battle.gold = ((state.game || {}).gold) ?? 100;
  ui.battle.kills = 0;
  ui.battle.bosses = 0;
  ui.battle.wave = 0;
  ui.campaign = null;
}
const hero = { ...Ch.defaultCharacter('knight'), name: 'Tester' };
const data = () => ({ state: L.loadState(), cfg: { theme: 'rpg', heroes: [hero] }, sid: 's1', ses: { party: {} }, hero });
const bump = (fn) => L.withLock(() => { const st = L.loadState(); fn(st); L.saveState(st); });
const camp = () => C.campaignOf(L.loadState());
const writeEvents = (evs) => fs.writeFileSync(L.EVENTS_FILE, evs.map((e) => JSON.stringify(e)).join('\n') + '\n');

test('kingdoms: liberation stages, rulers and stable placement', () => {
  assert.strictEqual(C.STAGES[C.stageFor(0)].name, 'Occupied');
  assert.strictEqual(C.STAGES[C.stageFor(200)].name, 'Contested');
  assert.strictEqual(C.STAGES[C.stageFor(900)].name, 'Liberated');
  assert.strictEqual(C.STAGES[C.stageFor(5000)].name, 'Thriving');
  assert.strictEqual(C.STAGES[C.stageFor(20000)].name, 'Legendary');
  // Bosses fought in a project count toward its liberation.
  assert.ok(C.liberation({ xp: 100 }, 2) > C.liberation({ xp: 100 }, 0));

  const a = key(path.join(home, 'alpha')), b = key(path.join(home, 'beta'));
  const st = { projects: { [a]: proj('alpha', 2000, 30), [b]: proj('beta', 10) } };
  const k1 = C.kingdoms(st);
  assert.strictEqual(k1.length, 2);
  const alpha = k1.find((k) => k.name === 'alpha');
  assert.strictEqual(alpha.stage, 2);
  assert.ok(alpha.rulerDown, 'the ruler falls at Liberated');
  assert.ok(C.RULERS.includes(alpha.ruler));
  assert.strictEqual(alpha.ruler, C.rulerOf(a));
  // A new project never moves an older kingdom.
  const g = key(path.join(home, 'gamma'));
  const k2 = C.kingdoms({ projects: { ...st.projects, [g]: proj('gamma', 50, 0, { firstSeen: NOW + 1 }) } });
  for (const k of k1) {
    const same = k2.find((x) => x.key === k.key);
    assert.deepStrictEqual([same.nx, same.ny], [k.nx, k.ny]);
  }
});

test('objectives progress from real usage since the chapter began', () => {
  reset({ quests: 40, tools: { editing: 100 } });
  const d = data();
  C.sync(d, NOW, true);
  let pr = C.progress(d, NOW);
  assert.strictEqual(pr.id, 'ch1');
  // Old work doesn't count toward "since the chapter began" objectives.
  assert.deepStrictEqual(pr.objs.map((o) => o.value), [0, 0, 0]);
  assert.strictEqual(pr.complete, false);

  const p = key(path.join(home, 'app'));
  bump((st) => { st.quests += 2; st.tools.editing += 10; st.projects = { [p]: proj('app', 200, 2) }; });
  d.state = L.loadState();
  pr = C.progress(d, NOW);
  assert.deepStrictEqual(pr.objs.map((o) => o.value), [2, 10, 1]);
  assert.deepStrictEqual(pr.objs.map((o) => o.done), [false, true, true]);
  assert.match(C.campaignSummary(d, NOW), /^Chapter 1: 2\/3$/);

  bump((st) => { st.quests += 5; });
  d.state = L.loadState();
  pr = C.progress(d, NOW);
  assert.ok(pr.complete);
  assert.strictEqual(pr.objs[0].value, 3, 'values are capped at the goal');
  assert.match(C.campaignSummary(d, NOW), /ready to claim/);

  // Standing totals: level objectives use the hero's real level.
  bump((st) => { st.game = { ...st.game, campaign: { ...st.game.campaign, chapter: 2 } }; });
  d.state = L.loadState();
  C.sync(d, NOW, true);
  pr = C.progress(d, NOW);
  assert.strictEqual(pr.id, 'ch3');
  assert.strictEqual(pr.objs.find((o) => o.kind === 'level').value, L.levelFor(500));
});

test('claiming pays a title, a cosmetic and gold once, and never XP', () => {
  reset({ xp: 777, battleXp: 5 });
  const d = data();
  C.sync(d, NOW, true);
  const p = key(path.join(home, 'app'));
  bump((st) => { st.quests += 3; st.tools = { editing: 10 }; st.projects = { [p]: proj('app', 300, 3) }; });
  d.state = L.loadState();
  const paid = C.claim(d, NOW);
  assert.ok(paid);
  assert.strictEqual(paid.title, 'Duckling');
  let st = L.loadState();
  const c = C.campaignOf(st);
  assert.strictEqual(st.xp, 777, 'XP is untouched');
  assert.strictEqual(st.battleXp, 5);
  assert.strictEqual(st.game.gold, 200);
  assert.ok(st.game.inventory.includes('flower'));
  assert.deepStrictEqual(c.done, ['ch1']);
  assert.deepStrictEqual(c.titles, ['Duckling']);
  assert.ok(c.codex.includes('lore:ch1'));
  assert.strictEqual(c.chapter, 1);
  assert.strictEqual(c.base.id, 'ch2', 'the next chapter counts from now');
  assert.strictEqual(C.campaignTitle(d), 'Duckling');

  // A second claim does nothing.
  assert.strictEqual(C.claim(d, NOW), null);
  st = L.loadState();
  assert.strictEqual(st.game.gold, 200);
  assert.strictEqual(st.xp, 777);
});

test('an owned cosmetic is paid out as gold instead', () => {
  reset({ game: { gold: 0, kills: 0, inventory: ['flower'] } });
  const d = data();
  C.sync(d, NOW, true);
  const p = key(path.join(home, 'app'));
  bump((st) => { st.quests += 3; st.tools = { editing: 10 }; st.projects = { [p]: proj('app', 300, 3) }; });
  d.state = L.loadState();
  const paid = C.claim(d, NOW);
  assert.strictEqual(paid.item, null);
  assert.strictEqual(L.loadState().game.gold, 100 + 45);
});

test('keys: Enter claims and plays the finale, which is marked as read', () => {
  reset();
  const d = data();
  C.sync(d, NOW, true);
  const p = key(path.join(home, 'app'));
  bump((st) => { st.quests += 3; st.tools = { editing: 10 }; st.projects = { [p]: proj('app', 300, 3) }; });
  d.state = L.loadState();
  assert.strictEqual(C.campaignKey('j', d), true);
  assert.strictEqual(ui.campaign.view, 'chapter');
  assert.strictEqual(C.campaignKey('\r', d), true);
  assert.strictEqual(ui.campaign.view, 'story');
  assert.strictEqual(ui.campaign.story.id, 'ch1:outro');
  assert.ok(camp().done.includes('ch1'));
  // Enter finishes the line, then advances; Esc closes and marks it read.
  C.campaignKey('\r', d);
  C.campaignKey('\r', d);
  assert.ok(ui.campaign.story.i >= 1);
  assert.strictEqual(C.campaignKey('\x1b', d), true);
  assert.strictEqual(ui.campaign.view, 'chapter');
  assert.ok(camp().seen.includes('ch1:outro'));
  // Esc outside a story is left to the game (quit).
  assert.strictEqual(C.campaignKey('\x1b', d), false);
  assert.strictEqual(C.campaignKey('k', d), true);
  assert.strictEqual(ui.campaign.view, 'codex');
  assert.strictEqual(C.campaignKey('m', d), true);
  assert.strictEqual(ui.campaign.view, 'map');
});

test('boss kills unlock codex pages and count for the kingdom they were fought in', () => {
  const p = path.join(home, 'app');
  reset({ projects: { [key(p)]: proj('app', 10) }, sessions: { s1: { mode: 'idle', since: NOW, hp: 100, combo: 0, party: {}, project: p } } });
  writeEvents([
    { t: NOW - 5000, sid: 's1', kind: 'combo', text: 'Boss defeated: Ignarok the Magma Drake! +100 XP' },
    { t: NOW - 4000, sid: 's1', kind: 'combo', text: 'Wave 3 cleared!' },
  ]);
  const d = data();
  C.sync(d, NOW, true);
  let c = camp();
  assert.ok(c.codex.includes('boss:drake'));
  assert.ok(c.codex.includes('biome:lava'), 'a lava boss means you have been to the lava caves');
  assert.ok(c.codex.includes('class:knight'));
  assert.strictEqual(c.kb[key(p)], 1);
  assert.strictEqual(C.kingdoms(L.loadState())[0].bosses, 1);
  // Seen once only.
  C.sync(data(), NOW, true);
  assert.strictEqual(camp().kb[key(p)], 1);
  // The lava-boss objective of chapter 5 counts it.
  bump((st) => { st.game.campaign.chapter = 4; });
  const pr = C.progress(data(), NOW);
  assert.strictEqual(pr.objs.find((o) => o.kind === 'bossBiome').value, 1);
  c = camp();
  assert.ok(!c.codex.includes('boss:lich'));
});

test('claimed bounties are counted once', () => {
  reset({ game: { gold: 0, kills: 0, bounties: { claimed: ['2026-09-25/d-cast'] } } });
  const d = data();
  C.sync(d, NOW, true);
  assert.strictEqual(camp().bountyN, 1);
  bump((st) => { st.game.bounties.claimed.push('2026-09-25/d-forge'); });
  C.sync(data(), NOW, true);
  C.sync(data(), NOW, true);
  assert.strictEqual(camp().bountyN, 2);
});

test('seasons follow the epilogue and are deterministic by month', () => {
  const a = C.seasonFor(Date.UTC(2026, 8, 1, 0, 0, 1)), b = C.seasonFor(Date.UTC(2026, 8, 30, 23));
  assert.deepStrictEqual(a, b);
  assert.strictEqual(a.id, 'season:2026-09');
  assert.strictEqual(a.objectives.length, 4);
  assert.strictEqual(new Set(a.objectives.map((o) => o.kind)).size, 4);
  const year = Array.from({ length: 12 }, (_, m) => C.seasonFor(Date.UTC(2027, m, 15)).name);
  assert.strictEqual(new Set(year).size, 12, 'no theme repeats within a year');
  assert.notStrictEqual(C.seasonFor(Date.UTC(2026, 9, 2)).id, a.id);

  // After the epilogue the campaign moves on to the current season.
  reset({ game: { gold: 0, kills: 0, inventory: [], campaign: { chapter: C.CHAPTERS.length - 1, done: C.CHAPTERS.slice(0, -1).map((c) => c.id) } } });
  const d = data();
  C.sync(d, NOW, true);
  let pr = C.progress(d, NOW);
  assert.strictEqual(pr.id, 'epilogue');
  assert.ok(pr.complete, 'the epilogue has no objectives');
  assert.ok(C.claim(d, NOW));
  pr = C.progress(data(), NOW);
  assert.strictEqual(pr.kind, 'season');
  assert.strictEqual(pr.id, 'season:2026-09');
  assert.match(C.campaignSummary(data(), NOW), /^Season Sep 2026: 0\/4$/);
});

test('every view is exactly W wide at several sizes and themes', () => {
  const p = path.join(home, 'app');
  const projects = {};
  ['app', 'api', 'site', 'notes', 'dotfiles'].forEach((n, i) => { projects[key(path.join(home, n))] = proj(n, [12000, 3500, 900, 200, 10][i], 10 * i); });
  reset({ xp: 5000, projects, sessions: { s1: { mode: 'idle', since: NOW, hp: 100, combo: 0, party: {}, project: p } } });
  for (const withProjects of [true, false]) {
    if (!withProjects) bump((st) => { st.projects = {}; });
    for (const [W, h] of [[50, 8], [50, 11], [80, 19], [100, 26], [130, 30], [200, 55]]) {
      for (const theme of ['rpg', 'space', 'retro']) {
        for (const view of ['map', 'chapter', 'story', 'codex']) {
          const d = { ...data(), cfg: { theme, heroes: [hero] } };
          ui.campaign = { view, sel: 1, csel: 12, ctop: 0, story: null, msg: null };
          if (view === 'story') { C.openStory(d, 'intro'); ui.campaign.story.i = 1; }
          const lines = C.campaignTab(d, UI[theme], W, h, NOW);
          assert.strictEqual(lines.length, h, `${view} ${W}x${h} ${theme}: ${lines.length} lines`);
          lines.forEach((l, i) => assert.strictEqual(L.visWidth(l), W, `${view} ${W}x${h} ${theme} row ${i}`));
        }
      }
    }
  }
});
