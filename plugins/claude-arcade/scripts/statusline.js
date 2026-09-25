#!/usr/bin/env node
// Status line: an animated two-row HUD. Run with refreshInterval: 1 so the
// sprite advances one frame per second.
//
//   🔮 ✧✦  Consulting the oracle… 12s                 ⚔ party 2
//   Lv 7 Code Knight ██████░░░░ 2,140/2,800 XP  ❤ ████████ 80  ✦ mana 34%  💰 1.20g
'use strict';

const L = require('./lib');
const { paint, bar } = L;

function main() {
  const input = L.readStdin();
  const cfg = L.loadConfig();
  const t = L.theme(cfg);
  const ascii = cfg.ascii || cfg.theme === 'retro';
  const state = L.loadState();
  const ses = state.sessions[input.session_id || 'default'] || { mode: 'idle', since: Date.now(), hp: 100, combo: 0, party: {} };

  const now = Date.now();
  const age = Math.max(0, Math.floor((now - (ses.since || now)) / 1000));
  let mode = ses.mode || 'idle';
  // Short-lived moods fall back to their resting state.
  if (mode === 'victory' && age > 8) mode = 'idle';
  if (mode === 'hurt' && age > 3) mode = 'thinking';

  const m = t.modes[mode] || t.modes.thinking;
  const frame = m.frames[Math.floor(now / 1000) % m.frames.length];
  const color = { idle: 'gray', victory: 'yellow', hurt: 'red', waiting: 'magenta', summoning: 'cyan', editing: 'yellow', running: 'green' }[mode] || 'blue';

  // Row 1: what the hero is doing right now.
  const busy = !['idle', 'victory', 'waiting'].includes(mode);
  const detail = ses.detail && mode !== 'victory' ? paint('white', ` ${ses.detail}`) : '';
  const timer = busy && age > 1 ? paint('gray', ` ${fmtTime(age)}`) : '';
  const partyN = Object.keys(ses.party || {}).length;
  const party = partyN ? paint('cyan', `   ${t.party} ${partyN}${ascii ? '' : ' ' + partyIcons(partyN, cfg.theme)}`) : '';
  const row1 = `${paint(color, frame)}  ${paint('bold', paint(color, m.verb + (busy ? '…' : '')))}${detail}${timer}${party}`;

  // Row 2: character sheet.
  const lvl = L.levelFor(state.xp);
  const lo = L.xpForLevel(lvl), hi = L.xpForLevel(lvl + 1);
  const xpBar = paint('yellow', bar((state.xp - lo) / (hi - lo), 10, ascii ? '#' : '█', ascii ? '-' : '░'));
  const hp = ses.hp ?? 100;
  const hpColor = hp > 60 ? 'green' : hp > 30 ? 'yellow' : 'red';
  const hpBar = paint(hpColor, bar(hp / 100, 6, ascii ? '=' : '▰', ascii ? '.' : '▱'));

  const parts = [
    `${paint('bold', `Lv ${lvl}`)} ${paint('magenta', L.titleFor(t, lvl))} ${xpBar} ${paint('gray', `${fmt(state.xp)}/${fmt(hi)} ${t.xpLabel}`)}`,
    `${paint('red', t.hpLabel)} ${hpBar}`,
  ];
  if (ses.combo >= 3) parts.push(paint('yellow', `${ascii ? 'x' : '🔥 x'}${ses.combo} combo`));
  const ctx = input.context_window && input.context_window.used_percentage;
  if (ctx != null) parts.push(paint(ctx > 80 ? 'red' : 'blue', `${ascii ? 'MP' : '✦ mana'} ${Math.round(100 - ctx)}%`));
  const cost = input.cost && input.cost.total_cost_usd;
  if (cost) parts.push(paint('yellow', `${ascii ? '$' : '💰 '}${cost.toFixed(2)}g`));
  if (input.model && input.model.display_name) parts.push(paint('gray', input.model.display_name));

  process.stdout.write(`${row1}\n${parts.join('  ')}`);
}

function partyIcons(n, themeName) {
  const icon = { rpg: ['🧝', '🧙', '🛡', '🏹', '🐉'], space: ['🛸', '🛸', '🛸', '🛸', '🛸'] }[themeName] || ['🧝'];
  return Array.from({ length: Math.min(n, 5) }, (_, i) => icon[i % icon.length]).join('') + (n > 5 ? '+' : '');
}

function fmt(n) { return Math.round(n).toLocaleString('en-US'); }
function fmtTime(s) { return s < 60 ? `${s}s` : `${Math.floor(s / 60)}m${String(s % 60).padStart(2, '0')}s`; }

try { main(); } catch (e) { process.stdout.write('🎮 arcade'); }
