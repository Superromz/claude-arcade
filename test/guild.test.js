// The Guild (recruitable companions), boss variety and the Warlock summon
// bonus. Hooks run as child processes in a throwaway HOME; the guild logic
// and tab are also exercised in-process against the same HOME.
// Run with: node --test
'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

const SCRIPTS = path.join(__dirname, '..', 'plugins', 'claude-arcade', 'scripts');
const home = fs.mkdtempSync(path.join(os.tmpdir(), 'arcade-guild-'));
// APPDATA too, so nothing ever writes into the real npm dir.
const env = { ...process.env, HOME: home, USERPROFILE: home, APPDATA: home, ARCADE_NO_CLIPBOARD: '1' };
Object.assign(process.env, { HOME: home, USERPROFILE: home, APPDATA: home, ARCADE_NO_CLIPBOARD: '1' });

const L = require(path.join(SCRIPTS, 'lib.js'));
const G = require(path.join(SCRIPTS, 'guild.js'));
const MON = require(path.join(SCRIPTS, 'monsters.js'));

const run = (script, input) => execFileSync(process.execPath, [path.join(SCRIPTS, script)], { input: JSON.stringify(input), env, encoding: 'utf8' });
const hook = (event, extra = {}) => run('hook.js', { hook_event_name: event, session_id: 'g1', ...extra });
const toast = (out) => (out ? JSON.parse(out).systemMessage : '');
const state = () => L.loadState();
const game = () => state().game || {};
// A subagent that joins and finishes.
const job = (id, type) => { hook('SubagentStart', { agent_id: id, agent_type: type }); hook('SubagentStop', { agent_id: id }); };
const d = () => ({ state: state() }); // the slice of snapshotData guildKey needs

test('the home directory is sandboxed', () => {
  assert.ok(L.HOME.startsWith(home), L.HOME);
});

test('a finishing subagent offers to join the guild, with a toast and a log entry', () => {
  L.createHero({ name: 'Ada', cls: 'mage' });
  hook('SessionStart', { source: 'startup' });
  job('a1', 'Explore');
  const offers = game().recruitOffers;
  assert.strictEqual(offers.length, 1);
  assert.strictEqual(offers[0].id, 'a1');
  assert.strictEqual(offers[0].cls, 'ranger');
  assert.strictEqual(offers[0].type, 'Explore');
  assert.ok(G.NAMES.ranger.includes(offers[0].name));
  assert.ok(offers[0].t > 0);
  // SubagentStop is a background hook, so the toast shows at the next foreground event.
  assert.match(toast(hook('Stop')), new RegExp(`${offers[0].name} the Ranger wants to join`));
  assert.match(fs.readFileSync(L.EVENTS_FILE, 'utf8'), /"kind":"summon","text":"🤝 .* wants to join/);
});

test('offers are capped at 3, keeping the newest', () => {
  job('a2', 'Plan');
  job('a3', 'code-reviewer');
  job('a4', 'docs-writer');
  const offers = game().recruitOffers;
  assert.deepStrictEqual(offers.map((o) => o.id), ['a2', 'a3', 'a4']);
  assert.strictEqual(new Set(offers.map((o) => o.name)).size, 3);
});

test('accepting an offer moves it into the guild', () => {
  const data = d();
  const guildTab = G.guildTab; // make sure the tab module loads before keys touch ui
  assert.ok(guildTab);
  // Newest offer is listed first and selected: 'a' accepts it.
  assert.strictEqual(G.guildKey('a', data), true);
  const g = game();
  assert.deepStrictEqual(g.recruitOffers.map((o) => o.id), ['a2', 'a3']);
  assert.strictEqual(g.guild.length, 1);
  const m = g.guild[0];
  assert.strictEqual(m.id, 'a4');
  assert.strictEqual(m.cls, 'bard');
  assert.strictEqual(m.level, 1);
  assert.strictEqual(m.xp, 0);
  assert.strictEqual(m.jobs, 0);
  assert.strictEqual(m.active, true);
  assert.ok(m.recruitedAt > 0);
  // Other game fields survive the write.
  assert.ok(Array.isArray(g.inventory));
});

test('dismiss removes an offer; release needs a confirm', () => {
  // Selection 0 is the newest remaining offer (a3).
  assert.strictEqual(G.guildKey('x', d()), true);
  assert.deepStrictEqual(game().recruitOffers.map((o) => o.id), ['a2']);
  // Accept a2 via Enter.
  assert.strictEqual(G.guildKey('\r', d()), true);
  assert.strictEqual(game().guild.length, 2);
  // Select the first recruit and press x once: nothing released yet.
  G.guildKey('\x1b[A', d());
  const { ui } = require(path.join(SCRIPTS, 'state.js'));
  ui.guild.sel = 0;
  G.guildKey('x', d());
  assert.strictEqual(game().guild.length, 2);
  G.guildKey('q', d()); // any other key cancels
  assert.strictEqual(game().guild.length, 2);
  G.guildKey('x', d());
  G.guildKey('x', d());
  assert.strictEqual(game().guild.length, 1);
  assert.strictEqual(game().guild[0].id, 'a2');
});

test('at most 3 recruits fight at once', () => {
  for (const id of ['b1', 'b2', 'b3']) job(id, 'general-purpose');
  let st = state();
  for (const o of st.game.recruitOffers.slice()) {
    const r = G.accept(st, o.id);
    assert.ok(r.ok, r.msg);
  }
  const guild = st.game.guild;
  assert.strictEqual(guild.length, 4);
  assert.strictEqual(guild.filter((g) => g.active).length, 3);
  const resting = guild.find((g) => !g.active);
  assert.strictEqual(G.toggleActive(st, resting.id).ok, false);
  L.saveState(st);
  // The game pane's snapshot shows the active recruits as party members, but
  // they are never written to the session on disk.
  const { snapshotData } = require(path.join(SCRIPTS, 'state.js'));
  const snap = snapshotData();
  const recruits = Object.entries(snap.ses.party).filter(([k]) => k.startsWith('guild:'));
  assert.strictEqual(recruits.length, 3);
  for (const [, p] of recruits) {
    assert.strictEqual(p.type, 'guild');
    assert.strictEqual(p.guild, true);
    assert.ok(p.cls && p.name && p.icon && p.level >= 1);
  }
  assert.ok(!Object.keys(state().sessions.g1.party).some((k) => k.startsWith('guild:')));
  // Resting one frees a slot.
  st = state();
  const fighter = st.game.guild.find((g) => g.active);
  assert.ok(G.toggleActive(st, fighter.id).ok);
  assert.ok(G.toggleActive(st, resting.id).ok);
  assert.strictEqual(st.game.guild.filter((g) => g.active).length, 3);
  L.saveState(st);
});

test('recruits earn companion XP from jobs of their class, never hero XP', () => {
  const st = state();
  st.game.guild = st.game.guild.map((g) => ({ ...g, active: g.id === 'a2' }));
  L.saveState(st);
  const state0 = state();
  const warlock = state0.game.guild.find((g) => g.id === 'a2');
  assert.strictEqual(warlock.cls, 'warlock');
  assert.ok(warlock, 'a2 (Plan) is a Warlock');
  const heroXp = state().xp;
  hook('SubagentStart', { agent_id: 'w1', agent_type: 'Plan' });
  const afterStart = state().xp;
  hook('SubagentStop', { agent_id: 'w1' });
  const after = state();
  // Hero XP from the stop is exactly the normal +5 return bonus.
  assert.strictEqual(after.xp - afterStart, 5);
  assert.ok(afterStart > heroXp);
  const w = after.game.guild.find((g) => g.id === warlock.id);
  assert.strictEqual(w.xp, (warlock.xp || 0) + G.JOB_XP);
  assert.strictEqual(w.jobs, (warlock.jobs || 0) + 1);
  // Other classes, and resting recruits, earn nothing.
  const before = new Map(state0.game.guild.map((g) => [g.id, g.xp || 0]));
  for (const g of after.game.guild.filter((x) => x.id !== warlock.id)) assert.strictEqual(g.xp || 0, before.get(g.id));
  // Levels come from companion XP.
  hook('SubagentStart', { agent_id: 'w2', agent_type: 'Plan' });
  hook('SubagentStop', { agent_id: 'w2' });
  const w2 = state().game.guild.find((g) => g.id === warlock.id);
  assert.strictEqual(w2.level, G.levelFor(w2.xp));
  assert.ok(w2.level >= 2);
});

test('each hero has their own guild', () => {
  const guildA = game().guild.map((g) => g.id);
  assert.ok(guildA.length);
  const { cfg } = L.createHero({ name: 'Bo', cls: 'knight' });
  assert.deepStrictEqual(game().guild || [], []);
  assert.deepStrictEqual(game().recruitOffers || [], []);
  job('c1', 'Explore');
  assert.strictEqual(game().recruitOffers.length, 1);
  const first = L.loadConfig().heroes.find((h) => h.id !== cfg.activeHero);
  L.switchHero(first.id);
  assert.deepStrictEqual(game().guild.map((g) => g.id), guildA);
  assert.ok(!game().recruitOffers.some((o) => o.id === 'c1'));
  L.switchHero(cfg.activeHero);
  assert.strictEqual(game().recruitOffers[0].id, 'c1');
  L.switchHero(first.id);
});

test('warlocks get their +50% summoning bonus', () => {
  const st = state();
  st.sessions.g1.combo = 0;
  L.saveState(st);
  const cfg = L.loadConfig();
  const summonXp = () => { const before = state().xp; hook('SubagentStart', { agent_id: `s${Date.now()}`, agent_type: 'Explore' }); return state().xp - before; };
  cfg.character = { ...cfg.character, cls: 'warlock' }; L.saveConfig(cfg);
  assert.strictEqual(summonXp(), Math.round(L.TOOL_XP.summoning * 1.5));
  cfg.character = { ...cfg.character, cls: 'mage' }; L.saveConfig(cfg);
  assert.strictEqual(summonXp(), L.TOOL_XP.summoning);
});

test('pickBoss never repeats the last two bosses', () => {
  for (const biome of ['dungeon', 'forest', 'lava', 'castle']) {
    assert.ok(MON.BOSS_POOLS[biome].length >= 3, biome);
    const history = [];
    for (let i = 0; i < 300; i++) {
      const b = MON.pickBoss(biome, history, 5 + (i % 20));
      assert.ok(MON.MONSTERS[b] && MON.MONSTERS[b].boss, b);
      assert.ok(!history.slice(-2).includes(b), `${biome}: ${b} after ${history.slice(-2)}`);
      history.push(b);
    }
    // Home bosses show up; later biomes also get returning foes.
    assert.ok(MON.BOSS_POOLS[biome].every((b) => history.includes(b)), biome);
    if (biome !== 'dungeon') assert.ok(history.some((b) => MON.bossBiome(b) !== biome), `${biome} returning foe`);
    else assert.ok(history.every((b) => MON.bossBiome(b) === 'dungeon'));
  }
  // Deterministic with a fixed rng; unknown biomes fall back to the dungeon.
  assert.strictEqual(MON.pickBoss('forest', ['elder', 'spiderqueen'], 1, () => 0.99), 'moonwolf');
  assert.strictEqual(MON.bossBiome(MON.pickBoss('nowhere', [], 1)), 'dungeon');
  assert.strictEqual(MON.BOSSES.forest, 'elder'); // old export unchanged
});

test('every monster sprite is rectangular and uses known colors', () => {
  for (const [type, def] of Object.entries(MON.MONSTERS)) {
    const pal = MON.paletteFor({ type });
    assert.ok(def.frames.length >= 2, type);
    for (const f of [...def.frames, def.atk].filter(Boolean)) {
      for (const row of f) for (const k of row) assert.ok(k === '.' || pal[k], `${type}: key ${k}`);
    }
    if (['goblin', 'boss'].includes(type)) continue; // legacy sprite with a ragged row
    for (const f of [...def.frames, def.atk].filter(Boolean)) assert.strictEqual(new Set(f.map((r) => r.length)).size, 1, type);
  }
  for (const [biome, roster] of Object.entries(MON.ROSTERS)) for (const t of roster) assert.ok(MON.MONSTERS[t] && !MON.MONSTERS[t].boss, `${biome}: ${t}`);
});

test('the guild tab renders lines exactly W wide', () => {
  const { UI, ui } = require(path.join(SCRIPTS, 'state.js'));
  // Add an offer so both sections have content.
  job('e1', 'Explore');
  for (const theme of ['rpg', 'retro']) {
    for (const W of [50, 72, 90, 130, 171]) {
      for (const h of [8, 20, 30]) {
        for (const sel of [0, 1, 3]) {
          ui.guild.sel = sel;
          ui.tick = W + h;
          const lines = G.guildTab(d(), UI[theme], W, h);
          assert.strictEqual(lines.length, h, `h ${W}x${h}`);
          for (const l of lines) assert.strictEqual(L.visWidth(l), W, `${theme} ${W}x${h}: "${l.replace(/\x1b\[[0-9;]*m/g, '')}"`);
        }
      }
    }
  }
  const text = G.guildTab(d(), UI.rpg, 130, 30).join('\n').replace(/\x1b\[[0-9;]*m/g, '');
  assert.match(text, /the Ranger wants to join!/);
  assert.match(text, /Accept/);
  assert.match(text, /Dismiss/);
  assert.match(text, /FIGHTING/);
  // An empty guild renders too.
  const empty = G.guildTab({ state: { game: {} } }, UI.rpg, 80, 16);
  for (const l of empty) assert.strictEqual(L.visWidth(l), 80);
});
