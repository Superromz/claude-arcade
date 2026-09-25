#!/usr/bin/env node
// Claude Arcade game pane: your hero battles waves of monsters while Claude
// works. Every tool call is a spell; higher levels unlock stronger spells.
//
//   node game.js                       play (follows the latest session)
//   node game.js --snapshot [tab]      print one frame and exit
//   node game.js --snapshot create     print the character creator
//
// Keys: 1-5 / space cast spells · click monsters to strike · w summon a wave
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

// ---------- frame ----------

function frame(cols, rows) {
  const d = snapshotData();
  if (ui.screen === 'create') return creatorFrame(cols, rows, d);
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
      side.push(panelLine(SIDE, pal.panel2, [[' QUEST LOG', pal.accent, true]]));
      side.push(...questLog(d, pal, SIDE, Math.max(0, bodyH - side.length), true));
      for (let i = 0; i < bodyH; i++) out.push(scene[i] + (side[i] || panelLine(SIDE, pal.panel, [])));
    } else {
      const sceneH = Math.max(8, Math.min(40, Math.floor(bodyH * 0.62)));
      out.push(...sceneLines(W, sceneH, d, pal));
      ui.layout = { top, cols: W, rows: sceneH };
      out.push(panelLine(W, pal.panel2, [['  QUEST LOG', pal.accent, true]], [[`wave ${ui.battle.wave} · ${ui.battle.kills} slain `, pal.dim]]));
      out.push(...questLog(d, pal, W, bodyH - sceneH - 1));
    }
  } else {
    ui.layout = null;
    const body = [heroTab, partyTab, trophiesTab][ui.tab - 1](d, pal, W, bodyH).slice(0, bodyH);
    while (body.length < bodyH) body.push(panelLine(W, pal.panel, []));
    out.push(...body);
  }
  const sess = d.sid ? `${ui.pin ? 'pinned' : 'following'} ${d.sid.slice(0, 8)}` : 'no session';
  out.push(hotbar(d, pal, W));
  ui.hotbarRow = out.length;
  out.push(footer(pal, W, [['1-6', 'cast'], ['click', 'strike'], ['w', 'wave'], ['tab', 'view'], ['c', 'hero'], ['t', 'theme'], ['p', sess], ['q', 'quit']]));
  return out;
}

// ---------- main loop ----------

function render(force = false) {
  const cols = process.stdout.columns || 100, rows = process.stdout.rows || 30;
  const lines = frame(cols, rows).slice(0, rows);
  let s = '';
  lines.forEach((l, i) => { if (force || ui.prev[i] !== l) s += `${ESC}${i + 1};1H${l}`; });
  ui.prev = lines;
  if (s) process.stdout.write(s);
}

function onKey(key) {
  const d = snapshotData();
  if (key === '\x03') return quit();
  if (ui.screen === 'create') { creatorKey(key, d); return render(true); }
  if (key.startsWith('\x1b[<')) return onMouse(key, d);
  if (key === 'q' || key === '\x1b') return quit();
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
      hitMonster(target, Math.max(1, Math.round(C.damage(C.SPELLS[0], d.lvl, stat) * 0.8)), [255, 255, 255]);
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
      st.game = { ...(st.game || {}), gold: ui.battle.gold, kills: ui.battle.kills, bestWave: Math.max((st.game || {}).bestWave || 0, ui.battle.wave) };
      L.saveState(st);
    });
  } catch {}
}

function quit() {
  saveProgress();
  process.stdout.write(`${RESET}${ESC}?1000l${ESC}?1006l${ESC}?25h${ESC}?1049l`);
  process.exit(0);
}

if (process.argv.includes('--snapshot')) {
  const arg = process.argv[process.argv.indexOf('--snapshot') + 1];
  const cols = Number(process.env.COLUMNS) || 100, rows = Number(process.env.LINES) || 28;
  if (arg === 'create') openCreator(snapshotData());
  else if (Number(arg) >= 1 && Number(arg) <= 4) ui.tab = Number(arg) - 1;
  ui.battle.lastEventT = 0; // replay recent events as spells
  const g = L.loadState().game || {};
  ui.battle.gold = g.gold || 0; ui.battle.kills = g.kills || 0;
  const warm = Number(process.env.ARCADE_WARMUP) || 40;
  for (ui.tick = 0; ui.tick < warm; ui.tick++) frame(cols, rows);
  process.stdout.write(frame(cols, rows).join('\n') + '\n');
} else if (!process.stdout.isTTY || !process.stdin.isTTY) {
  console.log('The game needs an interactive terminal. Run it in its own terminal pane: node game.js');
} else {
  const g = L.loadState().game || {};
  ui.battle.gold = g.gold || 0; ui.battle.kills = g.kills || 0;
  process.stdout.write(`${ESC}?1049h${ESC}?25l${ESC}2J${ESC}?1000h${ESC}?1006h`);
  process.stdin.setRawMode(true);
  process.stdin.setEncoding('utf8');
  process.stdin.on('data', onKey);
  process.stdout.on('resize', () => { process.stdout.write(`${ESC}2J`); render(true); });
  process.on('SIGINT', quit);
  process.on('exit', () => { saveProgress(); process.stdout.write(`${RESET}${ESC}?1000l${ESC}?1006l${ESC}?25h${ESC}?1049l`); });
  setInterval(saveProgress, 3000);
  if (!C.getCharacter(L.loadConfig())) openCreator(snapshotData());
  setInterval(() => { ui.tick++; try { render(); } catch {} }, 100);
  render(true);
}
