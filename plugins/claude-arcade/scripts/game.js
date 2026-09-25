#!/usr/bin/env node
// Claude Arcade game pane: your hero battles waves of monsters while Claude
// works. Every tool call is a spell; higher levels unlock stronger spells.
//
//   node game.js                       play (follows the latest session)
//   node game.js --snapshot [tab]      print one frame and exit
//   node game.js --snapshot create     print the character creator
//   node game.js --snapshot-hd out.png render the HD scene to a PNG
//   node game.js --hd-test             check that this terminal shows Kitty images
//
// Keys: 1-6 / space cast spells · click monsters to strike · w summon a wave
//       tab or ←→ views · c hero · t theme · p session · q quit
'use strict';

const L = require('./lib');
const M = require('./messages');
const X = require('./pixel');
const C = require('./character');
const SP = require('./sprites');
const { ESC, RESET, BOLD, NOBOLD, fg, bg, UI, TABS, SIDE, ui, snapshotData, currentMode, isBusy } = require('./state');
const { emit, floater, spawnWave, hitMonster, aliveMonsters, COOLDOWN, playerCast, cast, stepBattle, drawShots } = require('./battle');
const { drawScene, sceneLines } = require('./scene');
const { truncVis, panelLine, gradBar, barPart, ICONS, eventColor, collapse, stripIcon, questLog, fmtNum, heroCard, partyList, partyTab, trophiesTab, heroTab, hotbar, header, footer } = require('./panels');
const { FIELDS, FIELD_LABEL, OPTIONS, openCreator, creatorFrame, creatorKey } = require('./creator');
const { openRoster, rosterFrame, rosterKey } = require('./roster');
const { shopTab, shopKey } = require('./shop');
const { projectsTab } = require('./projects');
const { guildTab, guildKey } = require('./guild');
const { bountiesTab, bountiesKey } = require('./bounties');
const { skillsTab, skillsKey } = require('./skills');
const { lootTick, lootOverlay, lootKey } = require('./loot');
// Tab bodies by name, so TABS order can change freely.
const TAB_FN = { Hero: heroTab, Skills: skillsTab, Party: partyTab, Guild: guildTab, Bounties: bountiesTab, Trophies: trophiesTab, Shop: shopTab, Projects: projectsTab };
const { applyOverlay } = require('./celebrate');
const { sectionHeader } = require('./panels');
const HD = require('./hd');

// ---------- frame ----------

function frame(cols, rows) {
  const d = snapshotData();
  if (ui.screen === 'roster') return rosterFrame(cols, rows);
  if (ui.screen === 'create') return creatorFrame(cols, rows, d);
  lootTick(d); // before the scene steps the battle, so wave/quest ends are seen first
  const pal = UI[d.cfg.theme] || UI.rpg;
  const W = Math.max(50, cols);
  const out = header(d, pal, W);
  const bodyH = Math.max(8, rows - out.length - 2);
  const top = out.length;

  if (ui.tab === 0) {
    if (W >= 130) {
      const sceneW = W - SIDE;
      const scene = sceneLines(sceneW, bodyH, d, pal);
      ui.layout = { top, cols: sceneW, rows: bodyH };
      const side = [...heroCard(d, pal, SIDE), ...partyList(d, pal, SIDE)];
      side.push(sectionHeader(SIDE, pal, 'QUEST LOG'));
      side.push(...questLog(d, pal, SIDE, Math.max(0, bodyH - side.length), true));
      for (let i = 0; i < bodyH; i++) out.push(scene[i] + (side[i] || panelLine(SIDE, pal.panel, [])));
    } else {
      const sceneH = Math.max(8, Math.min(40, Math.floor(bodyH * 0.62)));
      out.push(...sceneLines(W, sceneH, d, pal));
      ui.layout = { top, cols: W, rows: sceneH };
      out.push(sectionHeader(W, pal, 'QUEST LOG', [[`wave ${ui.battle.wave} · ${ui.battle.kills} slain`, pal.dim]]));
      out.push(...questLog(d, pal, W, bodyH - sceneH - 1));
    }
  } else {
    ui.layout = null;
    const body = TAB_FN[TABS[ui.tab]](d, pal, W, bodyH).slice(0, bodyH);
    while (body.length < bodyH) body.push(panelLine(W, pal.panel, []));
    out.push(...body);
  }
  const sess = d.sid ? `${ui.pin ? 'pinned' : 'following'} ${d.sid.slice(0, 8)}` : 'no session';
  out.push(hotbar(d, pal, W));
  ui.hotbarRow = out.length;
  const keys = TABS[ui.tab] === 'Shop'
    ? [['←→↑↓', 'browse'], ['enter', 'buy / equip'], ['u', 'unequip'], ['tab', 'view'], ['q', 'quit']]
    : TABS[ui.tab] === 'Skills'
    ? [['↑↓←→', 'move'], ['enter', 'learn'], ['r', 'respec'], ['tab', 'view'], ['q', 'quit']]
    : TABS[ui.tab] === 'Bounties'
    ? [['←→↑↓', 'select'], ['enter', 'claim'], ['tab', 'view'], ['q', 'quit']]
    : TABS[ui.tab] === 'Guild'
    ? [['↑↓←→', 'select'], ['a', 'accept'], ['x', 'dismiss / release'], ['enter', 'fight / rest'], ['tab', 'view'], ['q', 'quit']]
    : [['1-6', 'cast'], ['click', 'strike'], ['w', 'wave'], ['tab', 'view'], ['h', 'heroes'], ['c', 'look'], ['t', 'theme'], ['g', 'HD'], ['p', sess], ['q', 'quit']];
  out.push(footer(pal, W, keys));
  return lootOverlay(applyOverlay(out, d, pal, W, rows), d, pal, W, rows);
}

// ---------- main loop ----------

let presenter = null; // HD (Kitty image) output, when HD mode is on

function render(force = false) {
  const cols = process.stdout.columns || 100, rows = process.stdout.rows || 30;
  const hd = HD.state.on && presenter;
  if (hd) HD.state.render = presenter.ready();
  ui.hdFrame = null; ui.hdBlank = null;
  const pal = UI[L.loadConfig().theme] || UI.rpg;
  const lines = quitDialog(approvalDialog(frame(cols, rows).slice(0, rows), cols, rows, pal), cols, rows, pal);
  let s = '';
  lines.forEach((l, i) => { if (force || ui.prev[i] !== l) s += `${ESC}${i + 1};1H${l}`; });
  ui.prev = lines;
  if (hd) { if (s) presenter.write(s); presentHD(lines); }
  else if (s) process.stdout.write(s);
}

// Place the HD scene image over its blank rows. Rows that a dialog or
// celebration overlay drew over are left out so the text stays visible.
function presentHD(lines) {
  const lay = ui.layout;
  if (!ui.hdBlank || !lay) return presenter.hide(); // no scene on screen this frame
  const f = ui.hdFrame;
  if (!f) return; // frame skipped (terminal still busy): keep the last image
  const clean = [];
  let a = -1;
  for (let r = 0; r <= f.rows; r++) {
    const ok = r < f.rows && String(lines[lay.top + r] || '').startsWith(ui.hdBlank);
    if (ok && a < 0) a = r;
    if (!ok && a >= 0) { clean.push([a, r]); a = -1; }
  }
  if (!clean.length) return presenter.hide();
  presenter.present(f, lay.top + 1, 1, clean);
}

// Switch HD on/off live and remember the choice (bound to a key in onKey).
function toggleHD() {
  const cfg = L.loadConfig();
  if (HD.state.on) {
    if (presenter) presenter.hide();
    HD.state.on = false; cfg.hd = false;
  } else {
    HD.state.on = true; cfg.hd = true;
    presenter = presenter || new HD.Presenter(process.stdout);
    // Started without HD: measure the cell size now (replies also reach onKey, which ignores them).
    if (HD.state.source === 'default') {
      HD.state.source = 'probing';
      HD.probe(process.stdin, process.stdout, 300, { keep: true }).then((p) => {
        if (p.cw >= 4 && p.ch >= 8) Object.assign(HD.state, { cw: p.cw, ch: p.ch, source: p.source });
        else HD.state.source = 'fallback';
      });
    }
  }
  L.saveConfig(cfg);
  ui.prev = [];
  render(true);
}

function onKey(key) {
  const d = snapshotData();
  if (key === '\x03') return quit();
  if (ui.confirmQuit) {
    if (key.toLowerCase() === 'y' || key === '\r' || key === '\n') return quit();
    ui.confirmQuit = false;
    return render(true);
  }
  if (approvalKey(key)) return render(true);
  if (ui.screen === 'game' && lootKey(key)) return render(true);
  if (ui.screen === 'roster') { rosterAction(rosterKey(key), d); return render(true); }
  if (ui.screen === 'create') { creatorKey(key, d); return render(true); }
  if (key === 'h') { ui.dirty = true; saveProgress(); openRoster(); return render(true); }
  if (key.startsWith('\x1b[<')) return onMouse(key, d);
  if (TABS[ui.tab] === 'Skills' && key !== '\t' && skillsKey(key, d)) return render(true);
  if (key === 'q' || key === '\x1b') return askQuit();
  if (key === 'g') return toggleHD();
  if (TABS[ui.tab] === 'Shop' && key !== '\t' && key !== 'q' && shopKey(key, d)) return render(true);
  if (TABS[ui.tab] === 'Guild' && key !== '\t' && key !== 'q' && guildKey(key, d)) return render(true);
  if (TABS[ui.tab] === 'Bounties' && key !== '\t' && key !== 'q' && bountiesKey(key, d)) return render(true);
  if (/^[1-6]$/.test(key)) playerCast(d, Number(key) - 1);
  if (key === ' ') playerCast(d, 0);
  if (key === 'w' && !aliveMonsters().length) { ui.battle.practice = true; spawnWave(ui.sceneW || 200, Math.floor(ui.heroY + 24), d.lvl); }
  if (key === '\x1b[C' || key === '\t') ui.tab = (ui.tab + 1) % TABS.length;
  if (key === '\x1b[D') ui.tab = (ui.tab + TABS.length - 1) % TABS.length;
  if (key === 'c') openCreator(d);
  if (key === 't') {
    const names = Object.keys(L.THEMES);
    d.cfg.theme = names[(names.indexOf(d.cfg.theme) + 1) % names.length];
    L.saveConfig(d.cfg);
  }
  if (key === 'p') {
    const ids = d.sessions.map(([id]) => id);
    const i = ui.pin ? ids.indexOf(ui.pin) : -1;
    ui.pin = i + 1 < ids.length ? ids[i + 1] : null;
  }
  render(true);
}

// SGR mouse: "\x1b[<b;col;rowM". Left click strikes monsters, casts from the
// hotbar or switches tabs.
function onMouse(seq, d) {
  for (const m of seq.matchAll(/\x1b\[<(\d+);(\d+);(\d+)([Mm])/g)) {
    const [btn, col, row, kind] = [Number(m[1]), Number(m[2]), Number(m[3]), m[4]];
    if (kind !== 'M' || (btn & 3) !== 0 || btn >= 32) continue;
    if (row === 1 && ui.tabZones) { const z = ui.tabZones.find((z) => col >= z.from && col <= z.to); if (z) ui.tab = z.tab; continue; }
    if (row === ui.hotbarRow + 1 && ui.hotbarZones) { const z = ui.hotbarZones.find((z) => col >= z.from && col <= z.to); if (z) playerCast(d, z.slot); continue; }
    const lay = ui.layout;
    if (!lay || row <= lay.top || row > lay.top + lay.rows || col > lay.cols) continue;
    const S = ui.sceneScale || 1;
    const px = (col - 1) / S, py = ((row - 1 - lay.top) * 2 + 1) / S;
    const target = aliveMonsters().find((mo) => { const [mw, mh] = SP.monsterSize(mo); return px >= mo.x - 3 && px <= mo.x + mw + 3 && py >= mo.y - 4 && py <= mo.y + mh + 4; });
    if (target && (ui.cooldowns.click || 0) <= ui.tick) {
      ui.cooldowns.click = ui.tick + 3;
      const stat = d.stats[C.CLASSES[d.hero.cls].stat] || 10;
      hitMonster(target, Math.max(1, Math.round(C.damage(C.SPELLS[0], d.lvl, stat) * 0.8 * require('./items').damageMultiplier())), [255, 255, 255]);
      emit(6, px, py, [[255, 255, 255], [255, 220, 120]], { spread: 1.2, up: 1.5 });
    } else if (!target) emit(3, px, py, [[200, 200, 220]], { spread: 0.6, up: 0.8, life: 8 });
  }
  render(true);
}

// Bank gold and kills in state.json (under the same lock the hooks use).
function saveProgress() {
  if (!ui.dirty) return;
  ui.dirty = false;
  try {
    L.withLock(() => {
      const st = L.loadState();
      if (ui.xpPending) { st.xp += ui.xpPending; st.battleXp = (st.battleXp || 0) + ui.xpPending; ui.xpPending = 0; }
      st.game = { ...(st.game || {}), bosses: Math.max((st.game || {}).bosses || 0, ui.battle.bosses || 0), gold: ui.battle.gold, kills: ui.battle.kills, bestWave: Math.max((st.game || {}).bestWave || 0, ui.battle.wave) };
      L.saveState(st);
    });
  } catch {}
}

// ---------- in-game approvals ----------

// A permission request from Claude Code shown as a modal encounter over
// whatever screen is open. The full command is always shown (wrapped).
function approvalDialog(lines, cols, rows, pal) {
  const req = L.pendingApprovals()[0];
  ui.approval = req || null;
  if (!req) return lines;
  const W = Math.min(cols - 4, 96), left = Math.floor((cols - W) / 2);
  const input = req.input || {};
  const main = input.command || input.file_path || input.url || input.pattern || input.query || JSON.stringify(input);
  const wrap = (text, w) => { const out = []; for (const para of String(text).split('\n')) { let s = para; do { out.push(s.slice(0, w)); s = s.slice(w); } while (s.length); } return out; };
  const body = wrap(main, W - 6).slice(0, Math.max(3, rows - 14));
  const more = wrap(main, W - 6).length - body.length;
  const blink = (ui.tick >> 3) % 2;
  const edge = blink ? pal.accent : pal.bad;
  const box = [
    `${fg(edge)}╭${'─'.repeat(W - 2)}╮`,
    ['  ⚔ A COMMAND BLOCKS YOUR PATH!', pal.accent, true],
    [`  ${req.tool}${input.description ? ' · ' + input.description : ''}`, pal.text, true],
    [`  ${require('path').basename(req.cwd || '') || ''}`, pal.dim],
    ['', pal.text],
    ...body.map((l) => [`   ${l}`, pal.gold]),
    ...(more > 0 ? [[`   … ${more} more line${more > 1 ? 's' : ''} — press C to review in Claude`, pal.dim]] : []),
    ['', pal.text],
    ['KEYS'],
    `${fg(edge)}╰${'─'.repeat(W - 2)}╯`,
  ];
  const top = Math.max(1, Math.floor((rows - box.length) / 2));
  const out = lines.slice();
  box.forEach((b, i) => {
    let content;
    if (typeof b === 'string') content = `${bg(pal.panel2)}${b}${RESET}`;
    else if (b[0] === 'KEYS') {
      const key = (k, label, c) => `${bg(c)}${fg(pal.ink)}${BOLD} ${k} ${NOBOLD}${bg(pal.panel2)}${fg(pal.text)} ${label}   `;
      const keys = `  ${key('Y', 'Allow once', pal.good)}${key('N', 'Deny', pal.bad)}${key('C', 'Answer in Claude', pal.dim)}`;
      content = `${bg(pal.panel2)}${fg(edge)}│${keys}${' '.repeat(Math.max(0, W - 2 - L.visWidth('  ' + ' Y  Allow once    N  Deny    C  Answer in Claude   ')))}${fg(edge)}│${RESET}`;
    } else content = `${bg(pal.panel2)}${fg(edge)}│${panelLine(W - 2, pal.panel2, [[b[0], b[1], b[2]]]).replace(RESET, '')}${bg(pal.panel2)}${fg(edge)}│${RESET}`;
    const row = top + i;
    if (row < out.length) out[row] = `${bg(pal.panel)}${' '.repeat(left)}${content}${bg(pal.panel)}${' '.repeat(Math.max(0, cols - left - W))}${RESET}`;
  });
  return out;
}

function approvalKey(key) {
  const req = ui.approval;
  if (!req) return false;
  const k = key.toLowerCase();
  if (k === 'y') { L.answerApproval(req.id, 'allow'); floater(ui.heroX, ui.heroY - 6, 'ALLOWED!', [120, 230, 120], true); }
  else if (k === 'n') { L.answerApproval(req.id, 'deny'); floater(ui.heroX, ui.heroY - 6, 'DENIED', [255, 90, 90], true); }
  else if (k === 'c') L.answerApproval(req.id, 'claude');
  else return true; // swallow other keys while the dialog is open
  ui.approval = null;
  return true;
}

// ---------- hero roster ----------

// Load the active hero's banked gold and kills and reset the battlefield.
function enterGame() {
  const g = L.loadState().game || {};
  Object.assign(ui.battle, { monsters: [], shots: [], bolts: [], coins: [], wave: 0, practice: false, waveXp: 0, gold: g.gold || 0, kills: g.kills || 0, bosses: g.bosses || 0, lastEventT: Date.now() });
  ui.xpPending = 0;
  ui.screen = 'game';
}

function newHero() {
  openCreator(snapshotData());
  ui.create.ch = C.defaultCharacter(['mage', 'ranger', 'knight', 'warlock', 'bard', 'rogue'][Math.floor(Math.random() * 6)]);
  ui.create.ch.name = 'Hero';
  ui.create.isNew = true;
  ui.create.title = 'Create a new hero';
  ui.create.onDone = (look) => { L.createHero(look); enterGame(); };
  ui.create.onCancel = () => { if ((L.loadConfig().heroes || []).length) openRoster(); else quit(); };
}

function rosterAction(a, d) {
  if (!a) return;
  if (a.quit) return askQuit();
  if (a.play) return enterGame();
  if (a.create) return newHero();
  if (a.edit) {
    openCreator(snapshotData());
    ui.create.title = `Edit ${ui.create.ch.name}`;
    ui.create.onDone = (look) => { const cfg = L.loadConfig(); cfg.character = { ...cfg.character, ...look }; L.saveConfig(cfg); openRoster(); };
    ui.create.onCancel = () => openRoster();
  }
}

function askQuit() {
  ui.confirmQuit = true;
  render(true);
}

// "Leave the game?" box over the current screen. Y or Enter quits; any other key stays.
function quitDialog(lines, cols, rows, pal) {
  if (!ui.confirmQuit) return lines;
  const busy = ui.screen === 'game' && ui.frameData && isBusy(currentMode(ui.frameData.ses));
  const W = Math.min(cols - 2, 46), left = Math.max(0, Math.floor((cols - W) / 2));
  const body = [
    ['Leave the game?', pal.accent, true],
    [busy ? 'Your hero is mid-battle. Progress is saved,' : 'Your progress is saved. Claude keeps', pal.text],
    [busy ? 'and Claude keeps working without you.' : 'earning XP while the game is closed.', pal.text],
  ];
  const key = (k, label, c) => `${bg(c)}${fg(pal.ink)}${BOLD} ${k} ${NOBOLD}${bg(pal.panel2)}${fg(pal.text)} ${label}  `;
  const keysPlain = ' Y  Quit    N  Stay  ';
  const box = [
    `${bg(pal.panel2)}${fg(pal.accent)}╭${'─'.repeat(W - 2)}╮${RESET}`,
    ...body.map(([t, c, b]) => `${bg(pal.panel2)}${fg(pal.accent)}│${panelLine(W - 2, pal.panel2, [['  ' + t, c, b]]).replace(RESET, '')}${bg(pal.panel2)}${fg(pal.accent)}│${RESET}`),
    `${bg(pal.panel2)}${fg(pal.accent)}│${' '.repeat(W - 2)}│${RESET}`,
    `${bg(pal.panel2)}${fg(pal.accent)}│  ${key('Y', 'Quit', pal.bad)}${key('N', 'Stay', pal.good)}${' '.repeat(Math.max(0, W - 24))}${fg(pal.accent)}│${RESET}`,
    `${bg(pal.panel2)}${fg(pal.accent)}╰${'─'.repeat(W - 2)}╯${RESET}`,
  ];
  const top = Math.max(0, Math.floor((rows - box.length) / 2));
  const out = lines.slice();
  box.forEach((b, i) => {
    const r = top + i;
    if (r < out.length) out[r] = `${bg(pal.panel)}${' '.repeat(left)}${b}${bg(pal.panel)}${' '.repeat(Math.max(0, cols - left - W))}${RESET}`;
  });
  return out;
}

function quit() {
  saveProgress();
  try { require('fs').unlinkSync(L.HEARTBEAT); } catch {}
  process.stdout.write(`${presenter ? presenter.deleteAll() : ''}${RESET}${ESC}?1000l${ESC}?1006l${ESC}?25h${ESC}?1049l`);
  process.exit(0);
}

if (process.argv.includes('--hd-test')) {
  (async () => {
    const out = process.stdout;
    const det = HD.detect(process.env, L.loadConfig());
    const p = await HD.probe(process.stdin, out);
    const img = HD.testImage(96);
    const cw = p.cw || 8, ch = p.ch || 17, c = Math.max(4, Math.round(96 / cw)), r = Math.max(2, Math.round(96 / ch));
    out.write(`\n${'\n'.repeat(r)}${ESC}${r}A\r` + HD.kittyTransmit(img.rgba, img.w, img.h, { id: 7399, cols: c, rows: r }) + `${ESC}${r}B\r\n`);
    console.log('Do you see a colored gradient square above? If yes, HD mode works in this terminal.');
    console.log('');
    console.log(`  terminal:        ${process.env.TERM_PROGRAM || process.env.TERM || 'unknown'}`);
    console.log(`  HD mode:         ${det.on ? 'on' : 'off'} (${det.why})`);
    console.log(`  cell size:       ${p.cw ? `${p.cw}x${p.ch}px (${p.source})` : 'not reported, using 8x17'}`);
    console.log(`  graphics query:  ${p.graphics === true ? 'OK' : p.graphics === false ? 'no answer' : 'no reply at all'}`);
    console.log('');
    console.log('Turn HD on or off with ARCADE_HD=1 / ARCADE_HD=0, "hd": true/false in ~/.claude/arcade/config.json, or g in the game.');
    process.exit(0);
  })();
} else if (process.argv.includes('--snapshot-hd')) {
  const file = process.argv[process.argv.indexOf('--snapshot-hd') + 1] || 'scene-hd.png';
  const cols = Number(process.env.COLUMNS) || 100, rows = Number(process.env.LINES) || 28;
  const cell = String(process.env.ARCADE_CELL || '8x16').match(/^(\d+)x(\d+)$/) || [0, 8, 16];
  Object.assign(HD.state, { on: true, cw: Number(cell[1]), ch: Number(cell[2]), render: false });
  ui.battle.lastEventT = 0;
  const g = L.loadState().game || {};
  ui.battle.gold = g.gold || 0; ui.battle.kills = g.kills || 0;
  const warm = Number(process.env.ARCADE_WARMUP) || 40;
  for (ui.tick = 0; ui.tick < warm; ui.tick++) frame(cols, rows);
  HD.state.render = true;
  const t0 = Date.now();
  frame(cols, rows);
  const f = ui.hdFrame;
  if (!f) { console.error('No scene in this view.'); process.exit(1); }
  require('fs').writeFileSync(file, HD.png(f.rgba, f.w, f.h));
  console.log(`${file}: ${f.w}x${f.h}px for ${f.cols}x${f.rows} cells, rendered in ${f.cost}ms (frame ${Date.now() - t0}ms)`);
} else if (process.argv.includes('--snapshot')) {
  const arg = process.argv[process.argv.indexOf('--snapshot') + 1];
  const cols = Number(process.env.COLUMNS) || 100, rows = Number(process.env.LINES) || 28;
  if (arg === 'create') openCreator(snapshotData());
  else if (arg === 'roster') openRoster();
  else if (Number(arg) >= 1 && Number(arg) <= TABS.length) ui.tab = Number(arg) - 1;
  ui.battle.lastEventT = 0; // replay recent events as spells
  const g = L.loadState().game || {};
  ui.battle.gold = g.gold || 0; ui.battle.kills = g.kills || 0;
  const warm = Number(process.env.ARCADE_WARMUP) || 40;
  for (ui.tick = 0; ui.tick < warm; ui.tick++) frame(cols, rows);
  if (process.env.ARCADE_CONFIRM_QUIT) ui.confirmQuit = true;
  const pal0 = UI[L.loadConfig().theme] || UI.rpg;
  process.stdout.write(quitDialog(frame(cols, rows), cols, rows, pal0).join('\n') + '\n');
} else if (!process.stdout.isTTY || !process.stdin.isTTY) {
  console.log('The game needs an interactive terminal. Run it in its own terminal pane: node game.js');
} else {
  const g = L.loadState().game || {};
  ui.battle.gold = g.gold || 0; ui.battle.kills = g.kills || 0;
  process.stdout.write(`${ESC}?1049h${ESC}?25l${ESC}2J${ESC}?1000h${ESC}?1006h`);
  const start = () => {
    if (HD.state.on) presenter = new HD.Presenter(process.stdout);
    process.stdin.setRawMode(true);
    process.stdin.setEncoding('utf8');
    process.stdin.on('data', onKey);
    process.stdin.resume();
    process.stdout.on('resize', () => { if (presenter) presenter.hide(); process.stdout.write(`${ESC}2J`); render(true); });
    process.on('SIGINT', quit);
    process.on('exit', () => {
      saveProgress();
      process.stdout.write(`${presenter ? presenter.deleteAll() : ''}${RESET}${ESC}?1000l${ESC}?1006l${ESC}?25h${ESC}?1049l`);
    });
    setInterval(saveProgress, 3000);
    const beat = () => { try { require('fs').writeFileSync(L.HEARTBEAT, String(Date.now())); } catch {} };
    beat(); setInterval(beat, 1000);
    if ((L.loadConfig().heroes || []).length) openRoster(); else newHero();
    setInterval(() => { ui.tick++; try { render(); } catch {} }, 100);
    render(true);
  };
  // HD needs the cell size in pixels: ask the terminal first (<=300ms, only when HD is on).
  HD.init({ cfg: L.loadConfig() }).catch(() => { HD.state.on = false; }).then(start);
}
