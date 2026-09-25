#!/usr/bin/env node
// Claude Arcade game pane: a full-screen, animated, interactive view of what
// Claude is doing. Run it in a split pane next to Claude Code:
//
//   node game.js              follow the most recently active session
//   node game.js --snapshot   print one frame and exit (tests / screenshots)
//
// Keys: 1-4 or ←/→ tabs · t theme · s session · space cheer · q quit
'use strict';

const L = require('./lib');
const M = require('./messages');

// ---------- terminal helpers ----------

const ESC = '\x1b[';
const fg = (n) => `${ESC}38;5;${n}m`;
const RESET = `${ESC}0m`, BOLD = `${ESC}1m`, DIM = `${ESC}2m`;

// Theme palettes (xterm-256 colors).
const PALETTE = {
  rpg: { accent: 214, frame: 94, hero: 223, floor: 94, dirt: 58, wall: 238, torch: 208, good: 113, bad: 203, magic: 141, gold: 220, text: 252, dim: 243 },
  space: { accent: 45, frame: 25, hero: 195, floor: 17, dirt: 17, wall: 236, torch: 51, good: 49, bad: 197, magic: 171, gold: 226, text: 253, dim: 242 },
  retro: { accent: 46, frame: 28, hero: 46, floor: 34, dirt: 22, wall: 22, torch: 118, good: 46, bad: 196, magic: 82, gold: 190, text: 46, dim: 28 },
};

function truncVis(s, w) {
  if (L.visWidth(s) <= w) return s;
  let out = '';
  for (const ch of s) { if (L.visWidth(out + ch) > w - 1) break; out += ch; }
  return out + '…';
}
const fitVis = (s, w) => L.padVis(truncVis(s, w), w);

// A grid of [char, color] cells. Sprites treat ' ' as transparent.
class Canvas {
  constructor(w, h) { this.w = w; this.h = h; this.cells = Array.from({ length: h }, () => Array.from({ length: w }, () => [' ', null])); }
  put(x, y, str, color, transparent = false) {
    if (y < 0 || y >= this.h) return;
    let i = 0;
    for (const ch of str) {
      const xx = x + i++;
      if (xx < 0 || xx >= this.w || (transparent && ch === ' ')) continue;
      this.cells[y][xx] = [ch, color];
    }
  }
  sprite(x, y, lines, color) { lines.forEach((l, i) => this.put(x, y + i, l, color, true)); }
  lines() {
    return this.cells.map((row) => {
      let out = '', cur;
      for (const [ch, col] of row) {
        if (col !== cur) { out += col == null ? RESET : fg(col); cur = col; }
        out += ch;
      }
      return out + RESET;
    });
  }
}

// ---------- sprites ----------

const HERO = {
  stand: [' o ', '/|\\', '/ \\'],
  walk: [[' o ', '/|\\', '/ \\'], [' o ', '/|\\', ' |\\'], [' o ', '/|\\', '/ \\'], [' o ', '/|\\', '/| ']],
  sit: ['   ', ' o ', '/L_'],
  cheer: ['\\o/', ' | ', '/ \\'],
  hammerUp: [' o_T', '/|  ', '/ \\'],
  hammerDown: [' o  ', '/|\\_', '/ \\T'],
  cast: [' o__', '/|  ', '/ \\'],
  point: [' o/', '/| ', '/ \\'],
  hurt: [' x ', '\\|/', '/ \\'],
  read: [' o ', '/#\\', '/ \\'],
};
const SHIP = {
  stand: [' /\\ ', '|==|', '/__\\'], walk: [[' /\\ ', '|==|', '/__\\'], [' /\\ ', '|==|', '/**\\']],
  sit: [' /\\ ', '|--|', '/__\\'], cheer: [' /\\ ', '|**|', '/__\\'], hammerUp: [' /\\ ', '|==|', '/__\\'],
  hammerDown: [' /\\ ', '|==|', '/__\\'], cast: [' /\\ ', '|==|=', '/__\\'], point: [' /\\ ', '|==|', '/__\\'],
  hurt: [' /\\ ', '|xx|', '/__\\'], read: [' /\\ ', '|[]|', '/__\\'],
};
const FIRE = [[' ) ', '(.)', '/_\\'], [' ( ', '(,)', '/_\\'], ['(  ', '(.)', '/_\\']];
const ANVIL = ['     ', '.---.', ' | | '];
const GOBLIN = [[' ,,, ', '(o.o)', '/|_|\\'], [' ,,, ', '(>.<)', '-|_|\\']];
const CHEST = [['     ', '[___]', '[_$_]'], [' $ $ ', '[/ \\]', '[_$_]']];
const MAP = ['.~~~.', '|~X~|', "'~~~'"];

// ---------- game state ----------

const ui = { tab: 0, pin: null, cheerUntil: 0, flash: [], tick: 0 };
const TABS = ['Adventure', 'Party', 'Trophies', 'Stats'];

function snapshotData() {
  const cfg = L.loadConfig();
  const state = L.loadState();
  const sessions = Object.entries(state.sessions).sort((a, b) => (b[1].since || 0) - (a[1].since || 0));
  const sid = ui.pin && state.sessions[ui.pin] ? ui.pin : sessions[0] && sessions[0][0];
  const ses = (sid && state.sessions[sid]) || { mode: 'idle', since: Date.now(), hp: 100, combo: 0, party: {} };
  const events = L.readEvents(80).filter((e) => !sid || !e.sid || e.sid === sid);
  return { cfg, state, sessions, sid, ses, events };
}

function currentMode(ses) {
  if (Date.now() < ui.cheerUntil) return 'cheer';
  const age = (Date.now() - (ses.since || 0)) / 1000;
  let mode = ses.mode || 'idle';
  if (mode === 'victory' && age > 8) mode = 'idle';
  if (mode === 'hurt' && age > 3) mode = 'thinking';
  return mode;
}

// ---------- scene ----------

function drawScene(cv, d, P) {
  const { ses, cfg } = d;
  const t = ui.tick;
  const W = cv.w, H = cv.h;
  const ground = H - 2;
  const mode = currentMode(ses);
  const walking = ['reading', 'searching', 'thinking', 'web'].includes(mode);
  const scroll = walking ? Math.floor(t / 2) : 0;
  const space = cfg.theme === 'space';
  const S = space ? SHIP : HERO;

  // Background: torches on a wall, or a scrolling starfield.
  if (space) {
    for (let y = 0; y < ground; y++) for (let x = 0; x < W; x++) {
      const h = (x * 7919 + y * 104729 + Math.floor(scroll / 2) * 31) % 97;
      if (h === 0) cv.put(x, y, '.', P.dim); else if (h === 1) cv.put(x, y, '*', ((t >> 2) + x) % 3 ? P.dim : P.text);
    }
  } else {
    for (let x = 0; x < W; x++) if ((x + scroll) % 18 === 0) {
      cv.put(x, 1, ['i', '!', 'i'][(t + x) % 3], P.torch);
      cv.put(x, 2, '|', P.wall);
    }
  }
  // Floor with a scrolling texture.
  const floorTex = space ? '=-' : cfg.theme === 'retro' ? '[]' : '_.,_ ';
  for (let x = 0; x < W; x++) {
    cv.put(x, ground, space ? '-' : '_', P.floor);
    cv.put(x, ground + 1, floorTex[(x + scroll) % floorTex.length], P.dirt);
  }

  // Hero position: walking modes pace across the room.
  const span = Math.max(1, W - 30);
  const pace = Math.floor(t / 3) % (span * 2);
  let hx = walking ? 12 + (pace < span ? pace : span * 2 - pace) : Math.floor(W / 3);
  const hy = ground - 3;
  const walkFrame = S.walk[Math.floor(t / 2) % S.walk.length];
  const beat = Math.floor(t / 4);

  // Party members follow the hero.
  const party = Object.values(ses.party || {});
  party.slice(0, 4).forEach((p, i) => {
    const px = hx - 5 * (i + 1);
    const head = (p.cls || '?')[0];
    const legs = walking ? (Math.floor(t / 2) + i) % 2 ? '/ \\' : ' |\\' : '/ \\';
    cv.sprite(px, hy, [` ${head} `, '/|\\', legs], [P.good, P.magic, P.accent, P.gold][i % 4]);
  });

  switch (mode) {
    case 'idle': {
      cv.sprite(hx, hy, S.sit, P.hero);
      cv.sprite(hx + 5, hy, FIRE[beat % FIRE.length], beat % 2 ? P.torch : P.gold);
      cv.put(hx + 1, hy - 1 - (beat % 2), beat % 4 < 2 ? 'z' : 'Z', P.dim);
      break;
    }
    case 'thinking': {
      cv.sprite(hx, hy, walkFrame, P.hero);
      const bubble = ['o', 'o O', 'o O (?)', 'o O (...)', 'o O (!)'][beat % 5];
      cv.put(hx + 2, hy - 2, bubble, P.magic);
      break;
    }
    case 'planning': {
      cv.sprite(hx, hy, S.read, P.hero);
      cv.sprite(hx + 5, hy, MAP, P.gold);
      cv.put(hx + 5, hy - 1, ['.', '..', '...', '....'][beat % 4], P.dim);
      break;
    }
    case 'reading': {
      cv.sprite(hx, hy, walkFrame, P.hero);
      cv.put(hx + 1, hy - 1, '[=]', P.gold);
      break;
    }
    case 'searching': {
      cv.sprite(hx, hy, walkFrame, P.hero);
      cv.put(hx + 3, hy, ['o-', 'o=', 'o-'][beat % 3], P.accent);
      cv.put(hx + 1, hy - 1, '?', P.accent);
      break;
    }
    case 'editing': {
      const up = Math.floor(t / 3) % 2 === 0;
      cv.sprite(hx, hy, up ? S.hammerUp : S.hammerDown, P.hero);
      cv.sprite(hx + 4, hy, ANVIL, P.dim);
      if (!up) {
        const sparks = ['*', '\'', '.', '+'];
        for (let i = 0; i < 3; i++) cv.put(hx + 5 + ((t + i * 3) % 5), hy - 1 - ((t + i) % 2), sparks[(t + i) % 4], [P.gold, P.torch, P.accent][i]);
      }
      break;
    }
    case 'running': {
      cv.sprite(hx, hy, S.cast, P.hero);
      const target = W - 8;
      const len = Math.max(0, target - (hx + 4));
      const reach = (t * 3) % (len + 6);
      if (reach < len) cv.put(hx + 4, hy, '~'.repeat(reach) + '>', P.gold);
      const hit = reach >= len;
      cv.sprite(target, hy, hit ? ['\\*/', '-*-', '/*\\'] : ['.-.', '|#|', "'-'"], hit ? P.torch : P.dim);
      break;
    }
    case 'web': {
      cv.sprite(hx, hy, S.point, P.hero);
      const ex = (t * 2) % (W + 6) - 3;
      cv.put(ex, 1, t % 4 < 2 ? '\\v/' : '-v-', P.text);
      break;
    }
    case 'summoning': {
      cv.sprite(hx, hy, S.cheer, P.hero);
      const circle = ['( )', '(*)', '{@}', '<@>'][beat % 4];
      cv.put(hx + 6, ground, circle, P.magic);
      cv.put(hx + 5, hy + 1 - (beat % 3), '* .', P.magic);
      break;
    }
    case 'hurt': {
      cv.sprite(hx, hy, S.hurt, t % 2 ? P.bad : P.hero);
      cv.sprite(hx + 6, hy, GOBLIN[t % 2], P.good);
      cv.put(hx, hy - 1 - (t % 3), '-10', P.bad);
      break;
    }
    case 'victory': case 'cheer': {
      const jump = beat % 2;
      cv.sprite(hx, hy - jump, S.cheer, P.gold);
      if (mode === 'victory') cv.sprite(hx + 5, hy, CHEST[beat % 2], P.gold);
      for (let i = 0; i < 12; i++) {
        const cx = (hx - 10 + ((i * 37 + t * (i % 3 + 1)) % 30));
        const cy = (i * 5 + t) % Math.max(1, hy);
        cv.put(cx, cy, '*+.o'[i % 4], [P.gold, P.magic, P.good, P.bad][i % 4]);
      }
      break;
    }
    case 'waiting': {
      cv.sprite(hx, hy, S.stand, P.hero);
      if (beat % 2) cv.put(hx + 1, hy - 1, '!', P.accent);
      break;
    }
    default:
      cv.sprite(hx, hy, walkFrame, P.hero);
  }
}

// ---------- tabs ----------

function eventColor(kind, P) {
  return { quest: P.gold, level: P.gold, achievement: P.gold, hurt: P.bad, faint: P.bad, summon: P.magic, return: P.magic, combo: P.accent, prompt: P.accent, welcome: P.good }[kind] || P.text;
}

function questLog(d, P, w, h) {
  const rows = d.events.slice(-h).map((e) => {
    const time = new Date(e.t).toTimeString().slice(0, 8);
    return `${fg(P.dim)}${time}${RESET} ${fg(eventColor(e.kind, P))}${fitVis(e.text, w - 9)}${RESET}`;
  });
  while (rows.length < h) rows.unshift(' '.repeat(w));
  return rows;
}

function partyTab(d, P, w, h) {
  const out = [];
  const party = Object.entries(d.ses.party || {});
  out.push(`${BOLD}${fg(P.accent)}Current party${RESET}`);
  if (!party.length) out.push(`${fg(P.dim)}Nobody's here. Ask Claude to use an agent to recruit one.${RESET}`);
  for (const [, p] of party) {
    const secs = Math.round((Date.now() - p.since) / 1000);
    out.push(`  ${p.icon || '*'} ${BOLD}${p.cls}${RESET} ${fg(P.dim)}(${p.type})${RESET}  ${fg(P.good)}on quest for ${secs}s${RESET}`);
  }
  out.push('', `${BOLD}${fg(P.accent)}Recent adventures${RESET}`);
  const hist = d.events.filter((e) => e.kind === 'summon' || e.kind === 'return').slice(-(h - out.length));
  for (const e of hist) out.push(`  ${fg(P.dim)}${new Date(e.t).toTimeString().slice(0, 5)}${RESET} ${fg(eventColor(e.kind, P))}${e.text}${RESET}`);
  return out;
}

function trophiesTab(d, P, w) {
  const got = new Set(d.state.achievements);
  const out = [`${BOLD}${fg(P.accent)}Trophies ${got.size}/${L.ACHIEVEMENTS.length}${RESET}`];
  for (const a of L.ACHIEVEMENTS) {
    const v = Math.min(a.goal, a.value(d.state, d.ses));
    const done = got.has(a.id);
    const b = L.bar(done ? 1 : v / a.goal, 12, '█', '░');
    out.push(`${done ? fg(P.gold) + ' ★ ' : fg(P.dim) + ' ☆ '}${fitVis(a.name, 15)}${RESET} ${fg(done ? P.gold : P.dim)}${b}${RESET} ${fg(P.dim)}${fitVis(`${done ? a.goal : v}/${a.goal}  ${a.desc}`, Math.max(10, w - 36))}${RESET}`);
  }
  return out;
}

function statsTab(d, P, w) {
  const s = d.state;
  const t = L.theme(d.cfg);
  const rows = [
    ['Edits forged', s.tools.editing], ['Commands cast', s.tools.running], ['Files scouted', s.tools.reading],
    ['Searches', s.tools.searching], ['Web & MCP', s.tools.web], ['Allies summoned', s.tools.summoning], ['Plans drawn', s.tools.planning],
  ];
  const max = Math.max(1, ...rows.map((r) => r[1] || 0));
  const out = [
    `${BOLD}${fg(P.accent)}Hero stats${RESET}   ${fg(P.dim)}theme${RESET} ${t.name}   ${fg(P.dim)}quests${RESET} ${s.quests}   ${fg(P.dim)}streak${RESET} ${s.streak.count} days   ${fg(P.dim)}sessions tracked${RESET} ${d.sessions.length}`,
    '',
  ];
  for (const [label, n] of rows) out.push(`  ${fitVis(label, 16)} ${fg(P.accent)}${L.bar((n || 0) / max, Math.max(10, w - 30), '█', ' ')}${RESET} ${n || 0}`);
  return out;
}

// ---------- frame ----------

function frame(cols, rows) {
  const d = snapshotData();
  const P = PALETTE[d.cfg.theme] || PALETTE.rpg;
  const t = L.theme(d.cfg);
  const W = Math.max(40, cols), IW = W - 2;
  const B = (s) => `${fg(P.frame)}${s}${RESET}`;
  const line = (content) => `${B('│')}${L.padVis(content, IW)}${B('│')}`;
  const out = [];

  // Title bar with tabs.
  const tabs = TABS.map((name, i) => (i === ui.tab ? `${BOLD}${fg(P.accent)}[${i + 1} ${name}]${RESET}` : `${fg(P.dim)} ${i + 1} ${name} ${RESET}`)).join('');
  const title = ` CLAUDE ARCADE · ${t.name} `;
  const fill = Math.max(1, IW - L.visWidth(title) - L.visWidth(tabs) - 2);
  out.push(`${B('╭─')}${BOLD}${fg(P.accent)}${title}${RESET}${B('─'.repeat(fill))}${tabs}${B('─╮')}`);

  // Character sheet.
  const lvl = L.levelFor(d.state.xp), lo = L.xpForLevel(lvl), hi = L.xpForLevel(lvl + 1);
  const hp = d.ses.hp ?? 100;
  const mode = currentMode(d.ses);
  const verb = mode === 'cheer' ? 'Cheering!' : (t.modes[mode] || t.modes.thinking).verb;
  const age = Math.max(0, Math.round((Date.now() - (d.ses.since || Date.now())) / 1000));
  const busy = !['idle', 'victory', 'waiting', 'cheer'].includes(mode);
  out.push(line(` ${BOLD}Lv ${lvl}${RESET} ${fg(P.magic)}${L.titleFor(t, lvl)}${RESET}  ${fg(P.gold)}${L.bar((d.state.xp - lo) / (hi - lo), 14)}${RESET} ${fg(P.dim)}${d.state.xp}/${hi} ${t.xpLabel}${RESET}   ${fg(hp > 50 ? P.good : P.bad)}HP ${L.bar(hp / 100, 10, '▰', '▱')} ${hp}${RESET}${d.ses.combo >= 3 ? `   ${fg(P.accent)}combo x${d.ses.combo}${RESET}` : ''}`));
  out.push(line(` ${fg(P.accent)}»${RESET} ${BOLD}${verb}${busy ? '…' : ''}${RESET} ${fg(P.text)}${truncVis(d.ses.detail && mode !== 'victory' ? d.ses.detail : '', IW - 30)}${RESET}${busy && age > 1 ? ` ${fg(P.dim)}${age}s${RESET}` : ''}`));
  out.push(B(`├${'─'.repeat(IW)}┤`));

  const bodyH = Math.max(6, rows - out.length - 1);
  let body;
  if (ui.tab === 0) {
    const sceneH = Math.min(10, Math.max(7, Math.floor(bodyH * 0.55)));
    const cv = new Canvas(IW, sceneH);
    drawScene(cv, d, P);
    body = cv.lines().map((l) => `${B('│')}${l}${B('│')}`);
    const logTitle = ' Quest log ';
    body.push(B(`├─${logTitle}${'─'.repeat(Math.max(0, IW - logTitle.length - 1))}┤`));
    body.push(...questLog(d, P, IW - 1, bodyH - body.length).map((l) => line(' ' + l)));
  } else {
    const content = [partyTab, trophiesTab, statsTab][ui.tab - 1](d, P, IW - 2, bodyH);
    body = content.slice(0, bodyH).map((l) => line(' ' + truncVis(l, IW - 1)));
    while (body.length < bodyH) body.push(line(''));
  }
  out.push(...body.slice(0, bodyH));

  const sess = d.sid ? `${ui.pin ? 'pinned' : 'following'} ${d.sid.slice(0, 8)}` : 'no session yet';
  const keys = ` 1-4 tabs · t theme · s session (${sess}) · space cheer · q quit `;
  out.push(`${B('╰')}${fg(P.dim)}${fitVis(keys, IW)}${RESET}${B('╯')}`);
  return out;
}

// ---------- main loop ----------

function render() {
  const cols = process.stdout.columns || 100, rows = process.stdout.rows || 30;
  const lines = frame(cols, rows).slice(0, rows);
  process.stdout.write(`${ESC}H` + lines.map((l) => l + `${ESC}K`).join('\n') + `${ESC}J`);
}

function onKey(key) {
  const d = snapshotData();
  if (key === 'q' || key === '\x03' || key === '\x1b') return quit();
  if (/^[1-4]$/.test(key)) ui.tab = Number(key) - 1;
  if (key === '\x1b[C' || key === '\t') ui.tab = (ui.tab + 1) % TABS.length;
  if (key === '\x1b[D') ui.tab = (ui.tab + TABS.length - 1) % TABS.length;
  if (key === 't') {
    const names = Object.keys(L.THEMES);
    d.cfg.theme = names[(names.indexOf(d.cfg.theme) + 1) % names.length];
    L.saveConfig(d.cfg);
  }
  if (key === 's') {
    // Cycle: follow latest -> pin each session in turn -> back to latest.
    const ids = d.sessions.map(([id]) => id);
    const i = ui.pin ? ids.indexOf(ui.pin) : -1;
    ui.pin = i + 1 < ids.length ? ids[i + 1] : null;
  }
  if (key === ' ') {
    ui.cheerUntil = Date.now() + 2500;
    L.logEvent({ sid: d.sid, kind: 'combo', text: M.pick(['Huzzah!', 'For glory!', 'The crowd goes wild!', 'You feel encouraged.', 'Morale +1']) });
  }
  render();
}

function quit() {
  process.stdout.write(`${RESET}${ESC}?25h${ESC}?1049l`);
  process.exit(0);
}

if (process.argv.includes('--snapshot')) {
  const tab = Number(process.argv[process.argv.indexOf('--snapshot') + 1]);
  if (tab >= 1 && tab <= 4) ui.tab = tab - 1;
  ui.tick = 7;
  process.stdout.write(frame(Number(process.env.COLUMNS) || 100, Number(process.env.LINES) || 28).join('\n') + '\n');
} else if (!process.stdout.isTTY || !process.stdin.isTTY) {
  console.log('The game needs an interactive terminal. Run it in its own terminal pane: node game.js');
} else {
  process.stdout.write(`${ESC}?1049h${ESC}?25l${ESC}2J`);
  process.stdin.setRawMode(true);
  process.stdin.setEncoding('utf8');
  process.stdin.on('data', onKey);
  process.stdout.on('resize', () => { process.stdout.write(`${ESC}2J`); render(); });
  process.on('SIGINT', quit);
  process.on('exit', () => process.stdout.write(`${RESET}${ESC}?25h${ESC}?1049l`));
  setInterval(() => { ui.tick++; try { render(); } catch {} }, 120);
  render();
}
