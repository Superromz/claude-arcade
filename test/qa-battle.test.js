// QA: the battle simulation run headless for thousands of ticks. Each
// scenario runs in its own child process (this file re-runs itself with
// QA_BATTLE set) so the game's module-level ui state starts fresh.
// Tests marked { todo: 'bug: ...' } document real bugs found in QA.
// Run with: node --test
'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const SCRIPTS = path.join(__dirname, '..', 'plugins', 'claude-arcade', 'scripts');

// ---------- child: one headless scenario ----------

function scenario(o) {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'arcade-qa-battle-'));
  Object.assign(process.env, { HOME: home, USERPROFILE: home, APPDATA: home, ARCADE_NO_CLIPBOARD: '1' });
  const L = require(path.join(SCRIPTS, 'lib.js'));
  const hero = (id, cls) => ({ id, name: id, cls });
  L.writeJSON(L.CONFIG_FILE, { theme: 'rpg', character: hero('h1', o.cls || 'mage'), heroes: [hero('h1', o.cls || 'mage'), hero('h2', 'knight')], activeHero: 'h1' });
  const now = Date.now();
  const party = {};
  for (let i = 0; i < (o.party || 0); i++) party[`a${i}`] = { type: 'Explore', cls: ['ranger', 'bard', 'warlock', 'rogue'][i % 4], name: 'x', icon: '', since: 0 };
  const ses = { mode: o.idle ? 'idle' : 'running', detail: 'npm test', since: now, hp: 100, combo: 0, party, xp: 0, turn: { start: o.boss ? now - 100000 : now, fails: 0, xp: 0 } };
  L.saveState({ xp: L.xpForLevel(o.lvl || 5), quests: 0, tools: {}, achievements: [], streak: { day: null, count: 0 }, sessions: { s1: ses }, game: { gold: 0, kills: 0 },
    heroes: { h2: { xp: L.xpForLevel(o.otherLvl || 1), quests: 0, tools: {}, achievements: [], game: { gold: 0, kills: 0 } } } });
  const setMode = (mode) => { const st = L.loadState(); st.sessions.s1.mode = mode; st.sessions.s1.since = Date.now(); L.saveState(st); };

  const { ui, UI, SIDE, snapshotData } = require(path.join(SCRIPTS, 'state.js'));
  const { sceneLines } = require(path.join(SCRIPTS, 'scene.js'));
  const P = require(path.join(SCRIPTS, 'panels.js'));
  const B = require(path.join(SCRIPTS, 'battle.js'));
  const { applyOverlay } = require(path.join(SCRIPTS, 'celebrate.js'));
  let LOOT = { lootTick() {}, lootOverlay: (x) => x };
  try { LOOT = require(path.join(SCRIPTS, 'loot.js')); } catch {}

  // Mirrors game.js frame() for the Adventure tab.
  function frame(cols, rows) {
    const d = snapshotData();
    LOOT.lootTick(d);
    const pal = UI[d.cfg.theme] || UI.rpg;
    const W = Math.max(50, cols);
    const out = P.header(d, pal, W);
    const bodyH = Math.max(8, rows - out.length - 2);
    if (W >= 130) {
      const scene = sceneLines(W - SIDE, bodyH, d, pal);
      const side = [...P.heroCard(d, pal, SIDE), ...P.partyList(d, pal, SIDE)];
      side.push(P.sectionHeader(SIDE, pal, 'QUEST LOG'));
      side.push(...P.questLog(d, pal, SIDE, Math.max(0, bodyH - side.length), true));
      for (let i = 0; i < bodyH; i++) out.push(scene[i] + (side[i] || P.panelLine(SIDE, pal.panel, [])));
    } else {
      const sceneH = Math.max(8, Math.min(40, Math.floor(bodyH * 0.62)));
      out.push(...sceneLines(W, sceneH, d, pal));
      out.push(...P.questLog(d, pal, W, bodyH - sceneH));
    }
    out.push(P.hotbar(d, pal, W));
    out.push(P.footer(pal, W, [['q', 'quit']]));
    return { d, lines: LOOT.lootOverlay(applyOverlay(out, d, pal, W, rows), d, pal, W, rows) };
  }

  const res = { kills: 0, bossKills: 0, maxParticles: 0, maxFloaters: 0, maxMonsters: 0, maxShots: 0, maxCoins: 0, celebrations: [], frameMs: [], widthErrors: 0, levelUps: [] };
  const seen = new Set();
  let last = null, lastD = null;
  const W = o.W || 130, H = o.H || 36;
  for (ui.tick = 1; ui.tick <= o.ticks; ui.tick++) {
    if (o.victoryAt === ui.tick) setMode('victory');
    if (o.switchAt === ui.tick) L.switchHero('h2');
    if (o.toolEvery && !o.idle && ui.tick % o.toolEvery === 0) L.logEvent({ sid: 's1', kind: 'action', text: 'Casting npm test', mode: 'running' });
    if (o.practice && !B.aliveMonsters().length && !ui.battle.monsters.some((m) => m.hp > 0)) { ui.battle.practice = true; B.spawnWave(ui.sceneW || 84, Math.floor(ui.heroY + 24), o.lvl || 5); }
    if (o.spam && lastD) for (let k = 0; k < 6; k++) B.playerCast(lastD, k);
    const t0 = process.hrtime.bigint();
    const { d, lines } = frame(W, H);
    res.frameMs.push(Number(process.hrtime.bigint() - t0) / 1e6);
    lastD = d;
    if (lines.some((l) => L.visWidth(l) !== W)) res.widthErrors++;
    for (const m of ui.battle.monsters) if (m.hp <= 0 && !seen.has(m)) { seen.add(m); if (m.boss) res.bossKills++; }
    res.maxParticles = Math.max(res.maxParticles, ui.particles.length);
    res.maxFloaters = Math.max(res.maxFloaters, ui.floaters.length);
    res.maxMonsters = Math.max(res.maxMonsters, ui.battle.monsters.length);
    res.maxShots = Math.max(res.maxShots, ui.battle.shots.length);
    res.maxCoins = Math.max(res.maxCoins, ui.battle.coins.length);
    if (ui.levelUp && !res.levelUps.some((l) => l.t0 === ui.levelUp.t0)) res.levelUps.push(ui.levelUp);
    const c = ui.levelUp ? 'levelUp' : (ui.celebrate && ui.celebrate.kind) || null;
    if (c !== last) { if (c) res.celebrations.push({ kind: c, from: ui.tick }); else if (res.celebrations.length) res.celebrations[res.celebrations.length - 1].to = ui.tick; last = c; }
  }
  Object.assign(res, { kills: ui.battle.kills, wave: ui.battle.wave, xpPending: ui.xpPending || 0, gold: ui.battle.gold, finalCelebrate: ui.celebrate || null });
  const sorted = [...res.frameMs].sort((a, b) => a - b);
  res.frame = { avg: sorted.reduce((a, b) => a + b, 0) / sorted.length, p95: sorted[Math.floor(sorted.length * 0.95)] };
  delete res.frameMs;
  return res;
}

if (process.env.QA_BATTLE) {
  process.stdout.write(JSON.stringify(scenario(JSON.parse(process.env.QA_BATTLE))));
  process.exit(0);
}

// ---------- tests ----------

const test = require('node:test');
const assert = require('node:assert');
const { execFile } = require('child_process');

// Scenarios start as soon as they are declared and run in parallel; each test awaits its own.
const run = (o) => new Promise((resolve, reject) => execFile(process.execPath, [__filename], { env: { ...process.env, QA_BATTLE: JSON.stringify(o) }, encoding: 'utf8', maxBuffer: 1 << 24 }, (err, out) => (err ? reject(err) : resolve(JSON.parse(out)))));
const S = {
  long: run({ ticks: 1500, lvl: 12, party: 2, toolEvery: 20 }),
  boss: run({ ticks: 1300, lvl: 15, boss: true }),
  finisher: run({ ticks: 200, lvl: 20, party: 4, boss: true, victoryAt: 60 }),
  practice: run({ ticks: 800, lvl: 10, idle: true, practice: true, spam: true }),
  hd: run({ ticks: 300, lvl: 15, party: 4, boss: true, W: 220, H: 80, toolEvery: 10 }),
  solo: run({ ticks: 2000, lvl: 5, party: 0 }),
  four: run({ ticks: 2000, lvl: 5, party: 4 }),
  switch: run({ ticks: 40, lvl: 5, otherLvl: 12, switchAt: 20 }),
};
for (const p of Object.values(S)) p.catch(() => {}); // reported by the test that awaits it

test('a long busy fight keeps particles, floaters, shots and monsters bounded', async () => {
  const r = await S.long;
  assert.ok(r.kills > 10, `only ${r.kills} kills in 1500 ticks`);
  assert.ok(r.maxParticles <= 500, `particles ${r.maxParticles}`);
  assert.ok(r.maxFloaters < 80, `floaters ${r.maxFloaters}`);
  assert.ok(r.maxShots < 80, `shots ${r.maxShots}`);
  assert.ok(r.maxMonsters <= 12, `monsters ${r.maxMonsters}`);
  assert.ok(r.maxCoins < 120, `coins ${r.maxCoins}`);
  assert.strictEqual(r.widthErrors, 0);
});

test('boss arrival shows BOSS!, the kill shows VICTORY, and both banners expire', async () => {
  const r = await S.boss;
  assert.strictEqual(r.bossKills, 1, 'the boss should fall within 130 s of fighting');
  const kinds = r.celebrations.map((c) => c.kind);
  assert.strictEqual(kinds[0], 'bossIntro');
  assert.ok(kinds.includes('boss'), kinds.join());
  for (const c of r.celebrations) assert.ok(c.to && c.to - c.from <= 40, `${c.kind} lasted ${c.to - c.from} ticks`);
  assert.strictEqual(r.finalCelebrate, null);
  assert.ok(r.xpPending >= 50, `boss XP ${r.xpPending}`);
});

test('victory lands the finisher on a boss that is still standing', async () => {
  const r = await S.finisher;
  assert.strictEqual(r.bossKills, 1);
  assert.strictEqual(r.wave, 0);
});

test('practice waves pay gold but never XP, even with every key mashed', async () => {
  const r = await S.practice;
  assert.ok(r.kills > 5, `kills ${r.kills}`);
  assert.ok(r.gold > 0);
  assert.strictEqual(r.xpPending, 0);
});

test('a frame stays under 60 ms at 220x80 during a boss fight', async () => {
  const r = await S.hd;
  assert.ok(r.frame.avg < 60, `avg ${r.frame.avg.toFixed(1)} ms`);
  assert.strictEqual(r.widthErrors, 0);
});

test('four companions do not slow the fight to a crawl on a 130-column pane', { todo: 'bug: with 4 companions heroX moves right and monsters queue past sceneW - 12 where aliveMonsters() cannot target them; kills drop to ~30% of a solo hero at 130x36 (battle.js lineup gap / aliveMonsters)' }, async () => {
  const solo = await S.solo, four = await S.four;
  assert.ok(four.kills >= solo.kills * 0.6, `solo ${solo.kills} kills, 4 companions ${four.kills}`);
});

test('switching to a higher-level hero does not play a LEVEL UP banner', { todo: 'bug: celebrate.js compares ui.lastLvl across hero switches, so entering the game as a Lv 12 hero after a Lv 5 one shows LEVEL UP 5 -> 12 with new-skill lines' }, async () => {
  const r = await S.switch;
  assert.deepStrictEqual(r.levelUps, []);
});
