'use strict';
// Text UI panels: header, footer, hotbar, hero card, tabs, quest log.

const L = require('./lib');
const M = require('./messages');
const X = require('./pixel');
const C = require('./character');
const SP = require('./sprites');
const { ESC, RESET, BOLD, NOBOLD, fg, bg, UI, TABS, SIDE, ui, snapshotData, currentMode, isBusy } = require('./state');
const { emit, floater, spawnWave, hitMonster, aliveMonsters, COOLDOWN, playerCast, cast, stepBattle, drawShots } = require('./battle');

// ---------- text helpers ----------

function truncVis(s, w) {
  if (w <= 0) return '';
  if (L.visWidth(s) <= w) return s;
  let out = '';
  for (const ch of s) { if (L.visWidth(out + ch) > w - 1) break; out += ch; }
  return out + '…';
}

function panelLine(width, panel, parts, right = []) {
  const render = (ps) => ps.map(([t, c, b]) => `${b ? BOLD : ''}${fg(c)}${t}${b ? NOBOLD : ''}`).join('');
  const plain = (ps) => ps.map((p) => p[0]).join('');
  const rw = L.visWidth(plain(right));
  let left = parts, lw = L.visWidth(plain(parts));
  if (lw + rw > width) {
    const room = Math.max(0, width - rw);
    left = []; let used = 0;
    for (const [t, c, b] of parts) {
      if (used >= room) break;
      const s = truncVis(t, room - used); left.push([s, c, b]); used += L.visWidth(s);
    }
    lw = used;
  }
  return `${bg(panel)}${render(left)}${' '.repeat(Math.max(0, width - lw - rw))}${render(right)}${RESET}`;
}

function gradBar(ratio, width, c1, c2, track) {
  const r = Math.max(0, Math.min(1, ratio)) * width;
  const full = Math.floor(r), part = Math.floor((r - full) * 8);
  let s = '';
  for (let i = 0; i < width; i++) {
    const c = X.mix(c1, c2, width > 1 ? i / (width - 1) : 0);
    if (i < full) s += `${fg(c)}█`;
    else if (i === full && part > 0) s += `${fg(c)}${bg(track)}${' ▏▎▍▌▋▊▉'[part]}`;
    else s += `${fg(track)}█`;
  }
  return s;
}

const barPart = (ratio, width, c1, c2, pal, panel) => `${gradBar(ratio, width, c1, c2, X.mix(panel, pal.text, 0.14))}${bg(panel)}`;

// ---------- panels ----------

const ICONS = { quest: '★', level: '▲', achievement: '✦', hurt: '✖', faint: '✝', summon: '✧', return: '↩', combo: '≫', prompt: '▸', welcome: '◆', waiting: '!', compact: '☾', action: '·' };

function eventColor(kind, pal) {
  return { quest: pal.gold, level: pal.gold, achievement: pal.gold, hurt: pal.bad, faint: pal.bad, summon: pal.magic, return: pal.magic, combo: pal.accent, prompt: pal.accent, welcome: pal.good, waiting: pal.accent }[kind] || pal.dim;
}

function collapse(events) {
  const out = [];
  for (const e of events) {
    const last = out[out.length - 1];
    if (last && e.kind === 'action' && last.kind === 'action' && last.text === e.text) { last.n++; last.t = e.t; continue; }
    out.push({ ...e, n: 1 });
  }
  return out;
}

const stripIcon = (s) => s.replace(/^[\p{Extended_Pictographic}️‍ ]+/u, '');

function questLog(d, pal, W, h, compact = false) {
  const last = d.events[d.events.length - 1];
  const rows = collapse(d.events.filter((e) => !compact || e.kind !== 'action' || e === last)).slice(-h).map((e, i, arr) => {
    const time = new Date(e.t).toTimeString().slice(0, 5);
    const text = stripIcon(e.text) + (e.n > 1 ? ` ×${e.n}` : '');
    const isLast = i === arr.length - 1;
    return panelLine(W, isLast ? pal.panel2 : pal.panel, [[compact ? ' ' : `  ${time} `, pal.dim], [`${ICONS[e.kind] || '·'} `, eventColor(e.kind, pal), true], [text, e.kind === 'action' ? (isLast ? pal.text : pal.dim) : eventColor(e.kind, pal), e.kind !== 'action']]);
  });
  while (rows.length < h) rows.unshift(panelLine(W, pal.panel, []));
  return rows;
}

function fmtNum(n) { return n >= 1e6 ? `${(n / 1e6).toFixed(1)}M` : n >= 1e3 ? `${(n / 1e3).toFixed(1)}k` : String(n || 0); }

// Hero card: portrait + stats + spellbook. Used by the sidebar and Hero tab.

function heroCard(d, pal, W, { big = false } = {}) {
  const out = [];
  const cls = C.CLASSES[d.hero.cls];
  const t = L.theme(d.cfg);
  out.push(panelLine(W, pal.panel2, [[` ${d.hero.name} `, pal.accent, true], [`Lv ${d.lvl} ${cls.name}`, pal.text]], [[`${L.titleFor(t, d.lvl)} `, pal.magic]]));
  const pw = 18, ph = 13;
  const pc = new X.PixelCanvas(pw, ph, pal.panel);
  pc.glow(9, 16, 14, C.COLORS[d.hero.primary] || pal.magic, 0.25);
  for (let x = 0; x < pw; x++) pc.set(x, 25, X.mix(pal.panel, pal.text, 0.1));
  SP.drawHero(pc, d.hero, 1, 1, { t: ui.tick, pose: (ui.tick >> 5) % 4 === 3 ? 'cheer' : 'stand' });
  const portrait = pc.lines();
  const statW = W - pw, barW = Math.max(6, statW - 12);
  const maxStat = Math.max(20, ...Object.values(d.stats));
  const statColors = { STR: pal.bad, INT: pal.magic, DEX: pal.good, WIS: [110, 190, 255], CHA: pal.gold };
  const right = [panelLine(statW, pal.panel, [[` ${cls.desc}`, pal.dim]])];
  for (const [k, v] of Object.entries(d.stats)) {
    right.push(`${bg(pal.panel)}${fg(k === cls.stat ? pal.accent : pal.text)}${k === cls.stat ? BOLD : ''} ${k}${NOBOLD} ${barPart(v / maxStat, barW, X.shade(statColors[k], 0.7), statColors[k], pal, pal.panel)}${fg(pal.dim)} ${String(v).padEnd(statW - barW - 6)}${RESET}`);
  }
  const lo = L.xpForLevel(d.lvl), hi = L.xpForLevel(d.lvl + 1);
  right.push(`${bg(pal.panel)}${fg(pal.dim)} XP  ${barPart((d.state.xp - lo) / (hi - lo), barW, pal.accent, pal.gold, pal, pal.panel)}${fg(pal.dim)} ${`${Math.round((d.state.xp - lo) / (hi - lo) * 100)}%`.padEnd(statW - barW - 6)}${RESET}`);
  const tok = d.state.tokens || { input: 0, output: 0 };
  right.push(panelLine(statW, pal.panel, [[' Tokens ', pal.dim], [`${fmtNum(tok.output)} out · ${fmtNum(tok.input)} in`, pal.text]]));
  right.push(panelLine(statW, pal.panel, [[' Slain ', pal.dim], [`${ui.battle.kills}`, pal.text, true], ['  Gold ', pal.dim], [`◉ ${ui.battle.gold}`, pal.gold, true]]));
  while (right.length < ph) right.push(panelLine(statW, pal.panel, []));
  for (let i = 0; i < ph; i++) out.push(portrait[i] + right[i]);
  out.push(panelLine(W, pal.panel2, [[' SPELLBOOK', pal.accent, true]]));
  const spells = C.SPELLS.map((s) => {
    const known = s.lvl <= d.lvl;
    const name = s.id === 'basic' ? C.BASIC_NAMES[d.hero.cls] : s.name;
    return [known ? `✦ ${name}` : `· ${name} (Lv ${s.lvl})`, known ? pal.gold : pal.dim, known];
  });
  const perRow = big ? 3 : 2, colW = Math.floor(W / perRow);
  for (let i = 0; i < spells.length; i += perRow) {
    out.push(spells.slice(i, i + perRow).map(([s, c, b], j, arr) => panelLine(j === arr.length - 1 ? W - colW * (arr.length - 1) : colW, pal.panel, [[' ' + s, c, b]])).join(''));
  }
  return out;
}

function partyList(d, pal, W) {
  const party = Object.values(d.ses.party || {});
  const out = [panelLine(W, pal.panel2, [[' COMPANIONS ', pal.accent, true], [party.length ? `${party.length} fighting` : 'none', pal.dim]])];
  if (!party.length) out.push(panelLine(W, pal.panel, [[' Agents Claude launches join you here.', pal.dim]]));
  for (const p of party) out.push(panelLine(W, pal.panel, [[` ${p.cls} `, (X.CLASS_COLORS[p.cls] || X.CLASS_COLORS.Mage).H, true], [`${p.type} · ${Math.round((Date.now() - p.since) / 1000)}s`, pal.dim]]));
  return out;
}

function partyTab(d, pal, W, h) {
  const party = Object.values(d.ses.party || {});
  const out = [];
  if (party.length) {
    const pc = new X.PixelCanvas(W, 9, pal.panel);
    party.slice(0, Math.floor((W - 4) / 16)).forEach((p, i) => {
      const colors = X.CLASS_COLORS[p.cls] || X.CLASS_COLORS.Mage;
      pc.glow(8 + i * 16, 12, 9, colors.H, 0.25);
      SP.drawCompanion(pc, colors, 3 + i * 16, 2 + ((ui.tick + i * 3) >> 2 & 1), { t: ui.tick + i });
      pc.label(2 + i * 16, 8, (p.cls || '').slice(0, 12), pal.text);
    });
    out.push(...pc.lines());
  }
  out.push(...partyList(d, pal, W));
  out.push(panelLine(W, pal.panel2, [['  RECENT ADVENTURES', pal.accent, true]]));
  const hist = d.events.filter((e) => e.kind === 'summon' || e.kind === 'return');
  for (const e of hist.slice(-Math.max(0, h - out.length))) out.push(panelLine(W, pal.panel, [[`  ${new Date(e.t).toTimeString().slice(0, 5)} `, pal.dim], [stripIcon(e.text), pal.magic]]));
  return out;
}

function trophiesTab(d, pal, W) {
  const got = new Set(d.state.achievements);
  const out = [panelLine(W, pal.panel2, [['  TROPHIES ', pal.accent, true], [`${got.size}/${L.ACHIEVEMENTS.length} unlocked`, pal.dim]])];
  const barW = 16;
  for (const a of L.ACHIEVEMENTS) {
    const v = Math.min(a.goal, a.value(d.state, d.ses));
    const done = got.has(a.id);
    const name = a.name.padEnd(15).slice(0, 15);
    out.push(`${bg(pal.panel)}${fg(done ? pal.gold : pal.dim)}${BOLD}${done ? '  ★ ' : '  ☆ '}${NOBOLD}${fg(done ? pal.gold : pal.text)}${name} ${barPart(done ? 1 : v / a.goal, barW, done ? pal.gold : pal.dim, done ? pal.accent : pal.magic, pal, pal.panel)} ${panelLine(W - 4 - 16 - barW - 1, pal.panel, [[`${done ? a.goal : v}/${a.goal}  `, pal.text], [a.desc, pal.dim]])}`);
  }
  return out;
}

function heroTab(d, pal, W) {
  const out = heroCard(d, pal, W, { big: true });
  const s = d.state;
  const rows = [['Edits forged', s.tools.editing], ['Commands cast', s.tools.running], ['Files scouted', s.tools.reading], ['Searches', s.tools.searching], ['Web & MCP', s.tools.web], ['Allies summoned', s.tools.summoning], ['Plans drawn', s.tools.planning]];
  const max = Math.max(1, ...rows.map((r) => r[1] || 0));
  out.push(panelLine(W, pal.panel2, [[' DEEDS ', pal.accent, true], [`${s.quests} quests · ${s.streak.count}-day streak · press c to edit your hero`, pal.dim]]));
  const barW = Math.max(10, W - 30);
  for (const [label, n] of rows) out.push(`${bg(pal.panel)}${fg(pal.text)}  ${label.padEnd(16)} ${barPart((n || 0) / max, barW, pal.magic, pal.accent, pal, pal.panel)}${fg(pal.dim)} ${String(n || 0).padEnd(W - barW - 20)}${RESET}`);
  return out;
}

// Skill hotbar: one slot per spell with a cooldown fill. Records click zones.
function hotbar(d, pal, W) {
  let s = `${bg(pal.panel)} `, used = 1;
  const zones = [];
  const slotW = Math.max(14, Math.min(22, Math.floor((W - 2) / C.SPELLS.length)));
  C.SPELLS.forEach((sp, i) => {
    if (used + slotW > W) return;
    const known = sp.lvl <= d.lvl;
    const name = sp.id === 'basic' ? C.BASIC_NAMES[d.hero.cls] : sp.name;
    const cd = Math.max(0, (ui.cooldowns[sp.id] || 0) - ui.tick);
    const ready = known && cd === 0;
    const label = ` ${i + 1} ${known ? name : `Lv ${sp.lvl}`}`;
    const inner = slotW - 1;
    const fill = known ? Math.round(inner * (1 - cd / COOLDOWN[sp.id])) : 0;
    const text = truncVis(label, inner).padEnd(inner);
    let cell = '';
    [...text].forEach((ch, j) => { cell += `${bg(!known ? pal.panel2 : j < fill ? X.mix(pal.panel2, pal.accent, ready ? 0.55 : 0.3) : pal.panel2)}${fg(ready ? pal.text : pal.dim)}${ch}`; });
    s += `${ready ? BOLD : ''}${cell}${NOBOLD}${bg(pal.panel)} `;
    zones.push({ from: used + 1, to: used + inner, slot: i });
    used += slotW;
  });
  ui.hotbarZones = zones;
  return s + ' '.repeat(Math.max(0, W - used)) + RESET;
}

// ---------- header / footer ----------

function header(d, pal, W) {
  const t = L.theme(d.cfg);
  const out = [];
  const tabs = TABS.map((name, i) => (i === ui.tab ? [` ${i + 1} ${name} `, pal.accent, true] : [` ${i + 1} ${name} `, pal.dim]));
  out.push(panelLine(W, pal.panel, [[' ◆ CLAUDE ARCADE ', pal.accent, true], [`· ${t.name}`, pal.dim]], [...tabs, [' ', pal.dim]]));
  let tx = W - 1 - tabs.reduce((n, [s]) => n + L.visWidth(s), 0);
  ui.tabZones = tabs.map(([s], i) => { const z = { from: tx + 1, to: tx + L.visWidth(s), tab: i }; tx += L.visWidth(s); return z; });
  const hp = d.ses.hp ?? 100;
  const lo = L.xpForLevel(d.lvl), hi = L.xpForLevel(d.lvl + 1);
  const xpW = Math.max(10, Math.min(28, Math.floor(W / 6))), hpW = Math.max(8, Math.floor(xpW / 2));
  const clsName = C.CLASSES[d.hero.cls].name;
  const left = ` ${d.hero.name} · Lv ${d.lvl} ${clsName}  XP `;
  const mid = ` ${d.state.xp}/${hi}   HP `;
  const tail = ` ${hp}${d.ses.combo >= 3 ? `   ≫ combo x${d.ses.combo}` : ''}   ★ ${d.state.quests} quests`;
  const used = L.visWidth(left) + xpW + L.visWidth(mid) + hpW;
  const tailT = truncVis(tail, W - used);
  out.push(`${bg(pal.panel2)}${BOLD}${fg(pal.text)} ${d.hero.name}${NOBOLD}${fg(pal.dim)} · ${fg(pal.magic)}Lv ${d.lvl} ${clsName}${fg(pal.dim)}  XP ${barPart((d.state.xp - lo) / (hi - lo), xpW, pal.accent, pal.gold, pal, pal.panel2)}${fg(pal.dim)}${mid}${barPart(hp / 100, hpW, pal.bad, pal.good, pal, pal.panel2)}${fg(pal.accent)}${tailT}${' '.repeat(Math.max(0, W - used - L.visWidth(tailT)))}${RESET}`);
  const mode = currentMode(d.ses);
  const verb = mode === 'cheer' ? 'Cheering!' : (t.modes[mode] || t.modes.thinking).verb;
  const age = Math.max(0, Math.round((Date.now() - (d.ses.since || Date.now())) / 1000));
  const busy = isBusy(mode);
  const partyN = Object.keys(d.ses.party || {}).length;
  out.push(panelLine(W, pal.panel, [[' ▶ ', pal.accent, true], [`${verb}${busy ? '…' : ''} `, pal.text, true], [d.ses.detail && mode !== 'victory' ? d.ses.detail : '', pal.accent], [busy && age > 1 ? `  ${age}s` : '', pal.dim]], partyN ? [[`✧ ${partyN} companion${partyN > 1 ? 's' : ''} `, pal.magic, true]] : []));
  return out;
}

function footer(pal, W, keys) {
  let s = `${bg(pal.panel2)} `, used = 1;
  for (const [k, lbl] of keys) {
    const kk = ` ${k} `, ll = ` ${lbl}  `;
    if (used + L.visWidth(kk) + L.visWidth(ll) > W) break;
    s += `${bg(pal.accent)}${fg(pal.ink)}${BOLD}${kk}${NOBOLD}${bg(pal.panel2)}${fg(pal.dim)}${ll}`;
    used += L.visWidth(kk) + L.visWidth(ll);
  }
  return s + ' '.repeat(Math.max(0, W - used)) + RESET;
}

module.exports = { truncVis, panelLine, gradBar, barPart, ICONS, eventColor, collapse, stripIcon, questLog, fmtNum, heroCard, partyList, partyTab, trophiesTab, heroTab, hotbar, header, footer };
