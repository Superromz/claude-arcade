#!/usr/bin/env node
// Development harness for the web view client (not shipped to players).
//
// Starts the REAL web server (web/server.js) against a throwaway home folder,
// so your real ~/.claude is never touched, seeds a hero with progress, and
// plays "Claude" with a script: work phases with tool spells, companions, a
// boss on a long task, victory and its chest, the idle camp, a failed tool,
// and now and then a permission request for the in-game approval dialog.
//
//   node web/client/mock.js [--port 47900] [--fresh] [--lvl 12] [--cls mage] [--theme rpg] [--still]
//
// It prints the link (with the session token) and writes it to
// <sandbox>/url.txt. --still starts with the script paused.
//
// A control endpoint on the next port drives it by hand (dev only):
//   http://127.0.0.1:47901/mock?phase=work|boss|victory|idle|sit|sleep|hurt|approval|levelup|chest|wave
//        &biome=dungeon|forest|lava|castle|auto &theme=rpg|space|retro &cls=mage|... &lvl=N &auto=0|1
//        &tier=wooden|iron|gold|epic|legendary &kind=quest|wave (for phase=chest)
'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');

const argv = process.argv.slice(2);
const arg = (name, def) => { const i = argv.indexOf(`--${name}`); return i >= 0 && argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[i + 1] : def; };
const PORT = Number(arg('port', 47900));
const START_LVL = Number(arg('lvl', 12));
const START_CLS = arg('cls', 'mage');
const START_THEME = arg('theme', 'rpg');

// ---------- sandbox home (before any game module is loaded) ----------

const SANDBOX = path.join(os.tmpdir(), 'claude-arcade-web-mock');
if (argv.includes('--fresh')) fs.rmSync(SANDBOX, { recursive: true, force: true });
fs.mkdirSync(path.join(SANDBOX, '.claude', 'arcade', 'approvals'), { recursive: true });
process.env.HOME = SANDBOX;
process.env.USERPROFILE = SANDBOX;
process.env.APPDATA = path.join(SANDBOX, 'AppData');
process.env.ARCADE_NO_BROWSER = '1';
process.env.ARCADE_WEB_IDLE_MIN = '0';
process.env.ARCADE_NO_CLIPBOARD = '1';
if (os.homedir() !== SANDBOX) { console.error('Could not sandbox the home folder; refusing to run.'); process.exit(1); }

const SCRIPTS = path.join(__dirname, '..', '..', 'scripts');
const ARCADE = path.join(SANDBOX, '.claude', 'arcade');
const xpFor = (lvl) => (100 * lvl * (lvl - 1)) / 2;

function seed() {
  const cfgFile = path.join(ARCADE, 'config.json');
  if (fs.existsSync(cfgFile)) return;
  const now = Date.now();
  const heroes = [
    { id: 'hero-main', name: 'Claudius', cls: START_CLS, primary: 'royal', secondary: 'violet', skin: 'light', hair: 'white', accessory: 'beard', createdAt: now - 864e5 * 20, equipped: { aura: 'sparkle' } },
    { id: 'hero-two', name: 'Sylvara', cls: 'ranger', primary: 'forest', secondary: 'gold', skin: 'tan', hair: 'red', accessory: 'cape', createdAt: now - 864e5 * 5 },
    { id: 'hero-three', name: 'Brakka', cls: 'knight', primary: 'charcoal', secondary: 'crimson', skin: 'brown', hair: 'black', accessory: 'cape', createdAt: now - 864e5 * 2 },
  ];
  const cfg = { theme: START_THEME, ascii: false, toasts: true, heroes, activeHero: 'hero-main', character: heroes[0] };
  const state = {
    xp: xpFor(START_LVL) + 140, quests: 187,
    tools: { editing: 412, running: 380, reading: 900, searching: 310, web: 44, summoning: 38, planning: 61, thinking: 120 },
    achievements: ['first-quest', 'quests-10', 'quests-100', 'forge-1', 'forge-50', 'cast-10', 'cast-100'],
    tokens: { input: 5.2e6, output: 9.1e5 }, tokenXp: 900, battleXp: 300,
    streak: { day: new Date().toISOString().slice(0, 10), count: 6 },
    sessions: {},
    game: {
      gold: 1640, kills: 2310, bosses: 7, bestWave: 23, inventory: ['sparkle', 'party', 'cat', 'wfire'],
      materials: { slime: 9, bone: 12, ember: 7, moonsilver: 3, starlight: 2 },
      guild: [
        { id: 'g1', name: 'Mira Quickstep', cls: 'rogue', type: 'debugger', level: 3, xp: 130, jobs: 6, recruitedAt: now - 864e5 * 3, active: true, activeSince: now - 864e5 },
        { id: 'g2', name: 'Oswin Brightshield', cls: 'knight', type: 'code-reviewer', level: 2, xp: 50, jobs: 3, recruitedAt: now - 864e5 * 2, active: false },
      ],
      recruitOffers: [{ id: 'o1', name: 'Thessaly Starweaver', cls: 'mage', type: 'general-purpose', t: now - 60000 }],
    },
    heroes: {
      'hero-two': { xp: xpFor(6) + 30, quests: 40, tools: { reading: 200, searching: 120 }, achievements: ['first-quest'], tokens: { input: 1e6, output: 1e5 }, tokenXp: 100, battleXp: 20, game: { gold: 210, kills: 380, inventory: [] }, lastPlayed: now - 864e5 * 2 },
      'hero-three': { xp: xpFor(16) + 10, quests: 260, tools: { editing: 900 }, achievements: ['first-quest'], tokens: { input: 1e6, output: 1e5 }, tokenXp: 100, battleXp: 20, game: { gold: 3100, kills: 4100, inventory: [] }, lastPlayed: now - 864e5 * 9 },
    },
    projects: {
      'c:/dev/claude-arcade': { name: 'claude-arcade', path: 'c:/dev/claude-arcade', xp: 5120, quests: 90, tools: { editing: 240, running: 190, summoning: 20 }, tokens: { output: 4.1e5 }, lastSeen: now - 60000 },
      'c:/dev/webshop': { name: 'webshop', path: 'c:/dev/webshop', xp: 2300, quests: 60, tools: { editing: 120, running: 150, summoning: 12 }, tokens: { output: 2.6e5 }, lastSeen: now - 3600e3 * 5 },
      'c:/dev/dotfiles': { name: 'dotfiles', path: 'c:/dev/dotfiles', xp: 410, quests: 12, tools: { editing: 30, running: 22 }, tokens: { output: 4e4 }, lastSeen: now - 864e5 * 3 },
    },
  };
  fs.writeFileSync(cfgFile, JSON.stringify(cfg, null, 2));
  fs.writeFileSync(path.join(ARCADE, 'state.json'), JSON.stringify(state, null, 2));
  const ev = [
    { kind: 'welcome', text: 'Welcome back, Claudius!' },
    { kind: 'prompt', text: 'New quest: add the web view to the arcade' },
    { kind: 'summon', text: 'A Ranger slips out of the shadows to scout: Explore' },
    { kind: 'quest', text: 'Quest complete! Refactored the loot tables. +42 XP' },
    { kind: 'return', text: 'The Ranger returns with news. +5 XP' },
    { kind: 'combo', text: 'Wave 4 cleared! +18 XP' },
  ].map((e, i) => JSON.stringify({ t: now - (6 - i) * 60000, sid: 'mock', ...e }));
  fs.writeFileSync(path.join(ARCADE, 'events.jsonl'), ev.join('\n') + '\n');
}
seed();

const L = require(path.join(SCRIPTS, 'lib.js'));
const LOOT = require(path.join(SCRIPTS, 'loot.js'));
const C = require(path.join(SCRIPTS, 'character.js'));
const server = require(path.join(__dirname, '..', 'server.js'));

// ---------- scripted Claude ----------

const sc = { auto: !argv.includes('--still'), phase: 'idle', phaseT: Date.now(), pi: 0, cycle: 0, approvals: 0, t: 0 };
const PHASES = [['work', 30000], ['victory', 10000], ['idle', 20000], ['work', 24000], ['boss', 40000], ['victory', 10000], ['sit', 16000]];
const MODES = ['editing', 'running', 'reading', 'searching', 'thinking', 'planning', 'web'];
const DETAILS = { editing: 'battle.js', running: 'npm test', reading: 'PROTOCOL.md', searching: 'drawScene', thinking: '', planning: 'todo list', web: 'nodejs.org' };
const PROMPTS = ['Add a web view with WebGL', 'Fix the flaky shop test', 'Refactor the loot tables', 'Write the Web-View wiki page'];

const logEv = (kind, text, extra = {}) => { try { L.logEvent({ sid: 'mock', kind, text, ...extra }); } catch {} };
function session(fn) {
  L.withLock(() => {
    const st = L.loadState();
    st.sessions = st.sessions || {};
    const s = st.sessions.mock || { mode: 'idle', detail: '', since: Date.now(), hp: 100, combo: 0, party: {}, xp: 0 };
    fn(s, st);
    s.project = 'c:/dev/claude-arcade';
    st.sessions.mock = s;
    L.saveState(st);
  });
}

function setPhase(name) {
  const now = Date.now();
  sc.phase = name; sc.phaseT = now;
  session((s) => {
    if (name === 'work' || name === 'boss') {
      s.mode = 'thinking'; s.since = now; s.hp = 84; s.combo = 3;
      s.turn = { start: name === 'boss' ? now - 86000 : now, editing: 3, running: 2, reading: 5, fails: 1, tokens: 40 };
      s.party = { a1: { type: 'Explore', cls: 'ranger', since: now }, a2: { type: 'code-reviewer', cls: 'knight', since: now + 400 }, a3: { type: 'Plan', cls: 'warlock', since: now + 800 } };
    } else if (name === 'victory') { s.mode = 'victory'; s.since = now; s.party = {}; }
    else if (name === 'idle') { s.mode = 'idle'; s.since = now; s.party = {}; }
    else if (name === 'sit') { s.mode = 'idle'; s.since = now - 45000; s.party = {}; }
    else if (name === 'sleep') { s.mode = 'idle'; s.since = now - 200000; s.party = {}; }
  });
  if (name === 'work' || name === 'boss') {
    logEv('prompt', `New quest: ${PROMPTS[sc.cycle++ % PROMPTS.length]}`);
    logEv('summon', 'A Ranger slips out of the shadows to scout: Explore');
  }
  if (name === 'victory') { logEv('quest', `Quest complete! Shipped the web view. +${30 + Math.floor(Math.random() * 30)} XP`); logEv('return', 'The Ranger returns with news. +5 XP'); }
}

function step() {
  sc.t++;
  const now = Date.now();
  if (sc.auto && now - sc.phaseT > PHASES[sc.pi][1]) { sc.pi = (sc.pi + 1) % PHASES.length; setPhase(PHASES[sc.pi][0]); }
  if (sc.phase === 'work' || sc.phase === 'boss') {
    if (sc.t % 12 === 0) {
      const m = MODES[Math.floor(Math.random() * MODES.length)];
      session((s) => { s.mode = m; s.detail = DETAILS[m]; s.since = now; });
      logEv('action', `${m} ${DETAILS[m]}`, { mode: m });
    }
    if (sc.t % 130 === 70) { session((s) => { s.mode = 'hurt'; s.since = now; s.hp = Math.max(20, (s.hp || 100) - 10); }); logEv('hurt', 'Took a hit! A command failed. -10 HP'); }
    if (sc.auto && sc.t % 400 === 200) makeApproval();
  }
}

function makeApproval() {
  const id = `${Date.now().toString(36)}-mock`;
  const reqs = [
    { tool: 'Bash', input: { command: 'npm test -- --watch=false && node scripts/build.js --release', description: 'Run the test suite' } },
    { tool: 'Write', input: { file_path: 'C:/dev/claude-arcade/web/client/index.html' } },
    { tool: 'WebFetch', input: { url: 'https://nodejs.org/api/http.html', prompt: 'Find the SSE example' } },
  ];
  const r = reqs[sc.approvals++ % reqs.length];
  L.writeJSON(path.join(L.APPROVALS_DIR, `${id}.req.json`), { id, sid: 'mock', t: Date.now(), tool: r.tool, input: r.input, cwd: 'C:/dev/claude-arcade' });
  // Nobody runs the PermissionRequest hook here: clean up once it's answered or after 90 s.
  const t0 = Date.now();
  const iv = setInterval(() => {
    const ans = path.join(L.APPROVALS_DIR, `${id}.answer.json`);
    if (fs.existsSync(ans) || Date.now() - t0 > 90000) {
      clearInterval(iv);
      const a = L.readJSON(ans, null);
      if (a) logEv('waiting', `Permission ${a.behavior === 'allow' ? 'allowed' : a.behavior === 'deny' ? 'denied' : 'handed back to Claude'} from the web view`);
      for (const f of [ans, path.join(L.APPROVALS_DIR, `${id}.req.json`)]) try { fs.unlinkSync(f); } catch {}
    }
  }, 300);
}

function control(q) {
  if (q.get('auto') !== null) sc.auto = q.get('auto') !== '0';
  if (q.get('biome')) process.env.ARCADE_BIOME = q.get('biome') === 'auto' ? '' : q.get('biome');
  if (q.get('theme')) { const cfg = L.loadConfig(); cfg.theme = q.get('theme'); L.saveConfig(cfg); }
  if (q.get('cls')) { const cfg = L.loadConfig(); cfg.character = { ...cfg.character, ...C.defaultCharacter(q.get('cls')), name: cfg.character.name, equipped: cfg.character.equipped }; L.saveConfig(cfg); }
  if (q.get('lvl')) L.withLock(() => { const st = L.loadState(); st.xp = xpFor(Number(q.get('lvl'))) + 5; L.saveState(st); });
  if (q.get('clear')) for (const r of L.pendingApprovals()) L.answerApproval(r.id, 'claude');
  const ph = q.get('phase');
  if (ph) {
    if (q.get('auto') === null) sc.auto = false;
    if (['work', 'boss', 'victory', 'idle', 'sit', 'sleep'].includes(ph)) setPhase(ph);
    if (ph === 'hurt') { setPhase('work'); session((s) => { s.mode = 'hurt'; s.since = Date.now(); }); logEv('hurt', 'Took a hit!'); }
    if (ph === 'approval') makeApproval();
    if (ph === 'levelup') L.withLock(() => { const st = L.loadState(); st.xp = xpFor(L.levelFor(st.xp) + 1) + 1; L.saveState(st); });
    if (ph === 'chest') LOOT.present(LOOT.sample(q.get('tier') || 'legendary', q.get('kind') || 'quest'));
  }
  return { ok: true, phase: sc.phase, auto: sc.auto, biome: process.env.ARCADE_BIOME || 'auto' };
}

server.start({ port: PORT, open: false }).then((s) => {
  if (s.already) { console.log(`A web server already runs in this sandbox: ${s.url}`); return; }
  fs.writeFileSync(path.join(SANDBOX, 'url.txt'), s.url);
  console.log(`Claude Arcade web mock: ${s.url}`);
  console.log(`Controls: http://127.0.0.1:${s.port + 1}/mock?phase=boss   (sandbox: ${SANDBOX})`);
  http.createServer((req, res) => {
    const u = new URL(req.url, 'http://127.0.0.1');
    res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
    res.end(JSON.stringify(u.pathname === '/mock' ? control(u.searchParams) : { ok: false }));
  }).listen(s.port + 1, '127.0.0.1');
  setPhase(sc.auto ? PHASES[0][0] : 'idle');
  setInterval(() => { try { step(); } catch (e) { console.error(e); } }, 100);
  const quit = () => s.stop().then(() => process.exit(0));
  process.on('SIGINT', quit); process.on('SIGTERM', quit);
});
