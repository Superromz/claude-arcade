// Daily, weekly and monthly bounties: deterministic picks, progress from real
// usage, one-time claims that pay gold and never XP, and fixed-width
// rendering. Also checks every achievement value is safe on a bare state.
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

// First day from T0 whose `tier` board posts the bounty `id`.
function dayWith(id, tier = 'daily') {
  for (let i = 0; i < 3000; i++) {
    const t = T0 + i * DAY;
    if (B.pickBounties(t)[tier].some((b) => b.id === id)) return t;
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
const find = (bd, id) => bd.all.find((x) => x.def.id === id);

test('the pools are big, unique, and pay gold (and real buffs) only', () => {
  const I = require(path.join(SCRIPTS, 'items.js'));
  assert.ok(B.DAILY.length >= 40, `daily ${B.DAILY.length}`);
  assert.ok(B.WEEKLY.length >= 25, `weekly ${B.WEEKLY.length}`);
  assert.ok(B.MONTHLY.length >= 12, `monthly ${B.MONTHLY.length}`);
  const all = [...B.DAILY, ...B.WEEKLY, ...B.MONTHLY];
  assert.strictEqual(new Set(all.map((b) => b.id)).size, all.length);
  for (const b of all) {
    assert.ok(b.gold > 0 && b.goal > 0 && typeof b.value === 'function', b.id);
    assert.ok(!('xp' in b), `${b.id} must not give XP`);
    if (b.buff) assert.ok((I.getItem(b.buff) || {}).buff, `${b.id}: ${b.buff} is not a buff`);
  }
});

test('daily, weekly and monthly picks are deterministic from the date', () => {
  const morning = Date.UTC(2026, 2, 10, 1), evening = Date.UTC(2026, 2, 10, 23);
  const a = B.pickBounties(morning), b = B.pickBounties(evening);
  for (const tier of ['daily', 'weekly', 'monthly']) assert.deepStrictEqual(a[tier].map((x) => x.id), b[tier].map((x) => x.id));
  assert.deepStrictEqual([a.daily.length, a.weekly.length, a.monthly.length], [3, 2, 2]);
  for (const list of [a.daily, a.weekly, a.monthly]) assert.strictEqual(new Set(list.map((x) => x.group)).size, list.length);
  // Same month, same monthly board; the board changes from day to day.
  assert.deepStrictEqual(B.pickBounties(Date.UTC(2026, 2, 1)).monthly.map((x) => x.id), B.pickBounties(Date.UTC(2026, 2, 31, 23)).monthly.map((x) => x.id));
  const boards = new Set();
  for (let i = 0; i < 7; i++) boards.add(B.pickBounties(T0 + i * DAY).daily.map((x) => x.id).join());
  assert.ok(boards.size > 1);
  const months = new Set();
  for (let m = 0; m < 12; m++) months.add(B.pickBounties(Date.UTC(2026, m, 15)).monthly.map((x) => x.id).join());
  assert.ok(months.size > 1);
  // Weeks start on Monday, months on the 1st (UTC).
  assert.strictEqual(B.weekKey(T0), B.weekKey(T0 + 6 * DAY));
  assert.notStrictEqual(B.weekKey(T0), B.weekKey(T0 + 7 * DAY));
  assert.strictEqual(B.monthKey(Date.UTC(2026, 2, 31, 23)), 'mo-2026-03');
  assert.strictEqual(B.monthKey(Date.UTC(2026, 3, 1)), 'mo-2026-04');
});

test('progress is read from the quest log since the day started', () => {
  const now = dayWith('d-cast');
  reset();
  writeEvents([
    ...Array.from({ length: 3 }, () => ({ t: now - DAY, sid: 's1', kind: 'action', mode: 'running', text: 'Casting' })), // yesterday
    ...Array.from({ length: 4 }, () => ({ t: now - 60000, sid: 's1', kind: 'action', mode: 'running', text: 'Casting' })),
  ]);
  const it = find(B.board(data(), now), 'd-cast');
  assert.strictEqual(it.value, 4);
  assert.strictEqual(it.done, false);
  writeEvents([...Array.from({ length: 6 }, () => ({ t: now - 1000, sid: 's1', kind: 'action', mode: 'running', text: 'Casting' }))]);
  const again = find(B.board(data(), now), 'd-cast');
  assert.strictEqual(again.value, 5); // capped at the goal
  assert.strictEqual(again.done, true);
  // Finished progress is remembered even after the quest log is trimmed.
  writeEvents([{ t: now - 10, sid: 's1', kind: 'welcome', text: 'hi' }]);
  assert.strictEqual(find(B.board(data(), now), 'd-cast').done, true);
});

test('the quest log tells chests, guild news and quests apart', () => {
  const t = T0;
  const a = B.aggregate([
    { t, sid: 's1', kind: 'prompt' },
    { t, sid: 's1', kind: 'quest', text: '🏆 Quest complete!' },
    { t, sid: 's1', kind: 'quest', text: '🎁 Gold Chest: 120 gold, Slime Gel ×2, Ember Core ×1, Skull Helm (rare)!' },
    { t, sid: 's1', kind: 'quest', text: '🎁 Iron Chest (wave 4): 50 gold, Bone Shard ×3!' },
    { t, sid: 's1', kind: 'quest', text: '🎁 Wooden Chest (practice wave 2): 20 gold!' },
    { t, sid: 's1', kind: 'summon', text: '🏹 A Ranger slips out of the shadows' },
    { t, sid: 's1', kind: 'summon', text: '🤝 Lark the Bard wants to join your guild!' },
    { t, sid: 's1', kind: 'summon', text: '⭐ Lark the Bard reached guild level 2!' },
    { t, sid: 's1', kind: 'combo', text: 'Boss defeated: King Gloop! +60 XP' },
    { t, sid: 's1', kind: 'combo', text: '⚔ Allowed in game: Bash' },
  ], t - 1);
  assert.strictEqual(a.quests, 1);
  assert.strictEqual(a.flawless, 1);
  assert.strictEqual(a.chests, 2); // practice chests don't count
  assert.strictEqual(a.tiers.gold, 1);
  assert.strictEqual(a.tiers.iron, 1);
  assert.strictEqual(a.questChests, 1);
  assert.strictEqual(a.mats, 6);
  assert.strictEqual(a.loot, 1);
  assert.strictEqual(a.summon, 1);
  assert.strictEqual(a.offers, 1);
  assert.strictEqual(a.recruitUps, 1);
  assert.strictEqual(a.bosses, 1);
  assert.strictEqual(a.approvals, 1);
  assert.strictEqual(a.sessions, 1);
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
  assert.strictEqual(find(B.board(data(), now), 'd-flawless').value, 2);
});

test('counters in state count against the day baseline', () => {
  const now = dayWith('d-forge');
  reset({ tools: { editing: 50 } });
  writeEvents([]);
  B.board(data(), now); // takes the baseline
  assert.strictEqual(L.loadState().game.bounties.day, B.dayKey(now));
  const st = L.loadState();
  st.tools.editing = 57;
  L.saveState(st);
  assert.strictEqual(find(B.board(data(), now), 'd-forge').value, 7);
});

test('a finished bounty pays gold once and never XP', () => {
  const now = dayWith('d-summon');
  reset();
  writeEvents([{ t: now - 1000, sid: 's1', kind: 'summon', text: 'A Ranger joins' }, { t: now - 900, sid: 's1', kind: 'summon', text: 'A Mage joins' }]);
  const d = data();
  const xp = d.state.xp;
  const it = find(B.board(d, now), 'd-summon');
  assert.ok(it.done && !it.claimed);
  assert.strictEqual(B.claim(it, d), true);
  assert.strictEqual(ui.battle.gold, 100 + it.def.gold);
  const st = L.loadState();
  assert.strictEqual(st.game.gold, 100 + it.def.gold);
  assert.strictEqual(st.xp, xp);
  assert.ok(st.game.bounties.claimed.includes(it.key));
  assert.strictEqual(st.game.bounties.stats.daily, 1);
  // A second claim, even from a stale copy, pays nothing.
  assert.strictEqual(B.claim({ ...it, claimed: false }, data()), false);
  assert.strictEqual(L.loadState().game.gold, 100 + it.def.gold);
  assert.strictEqual(find(B.board(data(), now), 'd-summon').claimed, true);
  assert.match(B.bountySummary(data(), now), /claimed/);
});

test('monthly bounties claim once, count toward trophies and keep other fields', () => {
  const now = dayWith('m-projects-5', 'monthly');
  const projects = Object.fromEntries([1, 2, 3, 4, 5].map((i) => [`p${i}`, { name: `p${i}`, lastSeen: now - 1000 }]));
  reset({ projects, game: { gold: 100, kills: 7, inventory: ['cat'], guild: [{ id: 'g', cls: 'bard', level: 2 }] } });
  writeEvents([]);
  const d = data();
  const it = find(B.board(d, now), 'm-projects-5');
  assert.strictEqual(it.period, 'monthly');
  assert.ok(it.done);
  assert.strictEqual(B.claim(it, d), true);
  assert.strictEqual(B.claim(it, d), false);
  const st = L.loadState();
  assert.strictEqual(st.game.gold, 100 + it.def.gold);
  assert.strictEqual(st.game.bounties.stats.monthly, 1);
  assert.strictEqual(st.xp, 500);
  assert.deepStrictEqual(st.game.inventory, ['cat']);
  assert.strictEqual(st.game.kills, 7);
  assert.strictEqual(st.game.guild.length, 1);
  const trophy = L.ACHIEVEMENTS.find((a) => a.id === 'bounty-m1');
  assert.strictEqual(trophy.value(st), 1);
  // Next month the claim list starts over but lifetime stats stay.
  B.board(data(), now + 32 * DAY);
  const later = L.loadState().game.bounties;
  assert.ok(!later.claimed.includes(it.key));
  assert.strictEqual(later.stats.monthly, 1);
});

test('arrows select and Enter claims', () => {
  const now = dayWith('d-summon');
  reset();
  writeEvents([{ t: now - 1000, sid: 's1', kind: 'summon' }, { t: now - 900, sid: 's1', kind: 'summon' }]);
  const d = data();
  assert.ok(find(B.board(d, now), 'd-summon'));
  // Real time decides the board inside bountiesKey, so just steer and check wrap.
  assert.strictEqual(B.bountiesKey('\x1b[B', d), true);
  assert.strictEqual(ui.bounties.sel, 1);
  assert.strictEqual(B.bountiesKey('\x1b[A', d), true);
  assert.strictEqual(B.bountiesKey('\x1b[A', d), true);
  assert.strictEqual(ui.bounties.sel, B.board(d).all.length - 1); // wraps
  assert.strictEqual(B.bountiesKey('x', d), false);
  assert.strictEqual(B.bountiesKey('\r', d), true);
  assert.match(B.bountySummary(d, now), /1\/7 bounties ready/);
});

test('the bounty board is exactly W wide at every size and theme', () => {
  const now = dayWith('d-cast');
  reset({ streak: { day: B.dayKey(now), count: 5 } });
  writeEvents(Array.from({ length: 5 }, () => ({ t: now - 1000, sid: 's1', kind: 'action', mode: 'running' })));
  const d = data();
  for (const theme of Object.keys(UI)) {
    for (const [W, h] of [[40, 10], [60, 22], [90, 24], [130, 30], [200, 12]]) {
      for (let sel = 0; sel < 7; sel++) {
        ui.bounties.sel = sel;
        const lines = B.bountiesTab(d, UI[theme], W, h, now);
        assert.strictEqual(lines.length, h, `${theme} ${W}x${h} height`);
        for (const l of lines) assert.strictEqual(L.visWidth(l), W, `${theme} ${W}x${h}: "${l.replace(/\x1b\[[0-9;]*m/g, '')}"`);
      }
    }
  }
});

// ---------- achievements ----------

const OLD_IDS = ['first-quest', 'quests-10', 'quests-100', 'quests-500', 'quests-1000', 'forge-1', 'forge-50', 'forge-500', 'forge-2000',
  'cast-10', 'cast-100', 'cast-1000', 'scout-200', 'scout-2000', 'web-25', 'web-250', 'plan-10', 'plan-100', 'all-rounder', 'tools-10k',
  'summon-1', 'summon-25', 'summon-100', 'full-party', 'party-5', 'combo-25', 'combo-50', 'combo-100', 'streak-3', 'streak-7', 'streak-14',
  'streak-30', 'streak-100', 'lvl-5', 'lvl-10', 'lvl-20', 'lvl-30', 'tokens-100k', 'tokens-1m', 'tokens-10m', 'projects-3', 'projects-10',
  'projects-25', 'kills-100', 'kills-1000', 'wave-10', 'boss-1', 'boss-10', 'gold-500', 'gold-5000', 'heroes-2', 'heroes-5', 'night-owl',
  'early-bird', 'weekend', 'marathon', 'scar-tissue', 'untouchable'];

test('there are 120+ unique achievements and every old id still exists', () => {
  const A = L.ACHIEVEMENTS;
  assert.ok(A.length >= 120, `only ${A.length}`);
  assert.strictEqual(new Set(A.map((a) => a.id)).size, A.length);
  assert.strictEqual(new Set(A.map((a) => a.name)).size, A.length);
  const ids = new Set(A.map((a) => a.id));
  for (const id of OLD_IDS) assert.ok(ids.has(id), id);
  for (const a of A) assert.ok(a.goal > 0 && a.name && a.desc, a.id);
});

test('achievement values are numbers on empty, broken and busy states', () => {
  const now = Date.now();
  const states = [
    {}, L.loadState(),
    { tools: null, game: null, streak: null, tokens: null, projects: null, sessions: null, quests: null },
    { game: { skills: { nodes: null, paragon: null }, guild: 'nope', inventory: null, materials: null, chests: null, bounties: null, bossTypes: null } },
  ];
  const sessions = [undefined, null, {}, { mode: 'victory', since: now }, { mode: 'victory', since: now, turn: null, party: null }, { mode: 'victory', since: now, turn: { start: now - 5000, fails: 2, editing: 3 }, hp: 20, party: { a: {} } }];
  for (const a of L.ACHIEVEMENTS) {
    for (const s of states) for (const ses of sessions) {
      const v = a.value(s, ses);
      assert.ok(typeof v === 'number' && Number.isFinite(v), `${a.id}: ${v}`);
    }
  }
  // A fresh hero has earned nothing yet (the secret quest-time ones need a finished quest).
  const early = L.ACHIEVEMENTS.filter((a) => a.value({}, undefined) >= a.goal).map((a) => a.id);
  assert.deepStrictEqual(early.filter((id) => !id.startsWith('class-') && !id.startsWith('heroes-') && id !== 'full-outfit'), []);
});

test('game-side trophies read the counters the game keeps', () => {
  const v = (id, s, ses) => L.ACHIEVEMENTS.find((a) => a.id === id).value(s, ses);
  const game = {
    chests: { wooden: 3, legendary: 1 }, crafted: 2, bosses: 4, bossTypes: { slimeking: 1, boss: 2, bonelord: 1 },
    inventory: ['skullhelm', 'bonewings', 'bonepup', 'wbone'], materials: { slime: 1, bone: 1, ember: 1, moonsilver: 1, starlight: 12 },
    skills: { nodes: { 'mage.0.4': 1, 'mage.1.4': 1, 'mage.0.0': 3 }, paragon: { dmg: 2 }, respecs: 1 },
    guild: [{ cls: 'bard', level: 6, jobs: 30, active: true }, { cls: 'mage', level: 1, jobs: 25 }],
    bounties: { stats: { daily: 3, weekly: 1, monthly: 0 } },
  };
  const s = { game };
  assert.strictEqual(v('chests-1', s), 4);
  assert.strictEqual(v('chest-legendary-1', s), 1);
  assert.strictEqual(v('craft-1', s), 2);
  assert.strictEqual(v('boss-slimeking', s), 1);
  assert.strictEqual(v('bosses-dungeon', s), 3);
  assert.strictEqual(v('set-bonecaller', s), 4);
  assert.strictEqual(v('sets-all', s), 1);
  assert.strictEqual(v('mats-kinds', s), 5);
  assert.strictEqual(v('capstone-1', s), 2);
  assert.strictEqual(v('skill-15', s), 5);
  assert.strictEqual(v('paragon-1', s), 2);
  assert.strictEqual(v('respec-1', s), 1);
  assert.strictEqual(v('recruit-5', s), 6);
  assert.strictEqual(v('guild-jobs-50', s), 55);
  assert.strictEqual(v('bounty-1', s), 3);
  assert.strictEqual(v('bounty-all-150', s), 4);
  // Secret quest-time trophies judge the quest that just ended.
  const midnight = new Date(2026, 9, 31, 1, 30).getTime();
  const ses = { mode: 'victory', since: midnight, hp: 20, turn: { start: midnight - 40000, fails: 0, editing: 3, running: 3 } };
  assert.strictEqual(v('night-owl', {}, ses), 1);
  assert.strictEqual(v('spooky', {}, ses), 1);
  assert.strictEqual(v('speedrunner', {}, ses), 1);
  assert.strictEqual(v('last-stand', {}, ses), 1);
  assert.strictEqual(v('night-owl', {}, { ...ses, mode: 'thinking' }), 0);
});

test('set and boss trophies match items.js and monsters.js', () => {
  const I = require(path.join(SCRIPTS, 'items.js'));
  const MON = require(path.join(SCRIPTS, 'monsters.js'));
  const byId = Object.fromEntries(L.ACHIEVEMENTS.map((a) => [a.id, a]));
  for (const set of Object.keys(I.SETS)) {
    const pieces = I.CATALOG.filter((it) => it.set === set).map((it) => it.id);
    const a = byId[`set-${set.toLowerCase()}`];
    assert.ok(a, `no trophy for ${set}`);
    assert.strictEqual(a.goal, pieces.length, set);
    assert.strictEqual(a.value({ game: { inventory: pieces } }), pieces.length, set);
  }
  for (const [biome, types] of Object.entries(MON.BOSS_POOLS)) {
    assert.ok(byId[`bosses-${biome}`], biome);
    for (const t of types) assert.ok(byId[`boss-${t}`], `no trophy for boss ${t}`);
  }
});
