#!/usr/bin/env node
// Claude Arcade game pane: a full-screen, animated pixel-art view of what
// Claude is doing. Run it in a split pane next to Claude Code:
//
//   node game.js              follow the most recently active session
//   node game.js --snapshot   print one frame and exit (tests / screenshots)
//
// Keys: 1-4 or ←/→ tabs · t theme · s session · space cheer · q quit
'use strict';

const L = require('./lib');
const M = require('./messages');
const X = require('./pixel');

const ESC = '\x1b[';
const RESET = `${ESC}0m`, BOLD = `${ESC}1m`, NOBOLD = `${ESC}22m`;
const fg = ([r, g, b]) => `${ESC}38;2;${r};${g};${b}m`;
const bg = ([r, g, b]) => `${ESC}48;2;${r};${g};${b}m`;

// UI colors per theme.
const UI = {
  rpg: { panel: [24, 20, 34], panel2: [36, 30, 50], accent: [255, 176, 60], text: [232, 226, 242], dim: [128, 118, 150], good: [120, 220, 120], bad: [255, 92, 92], magic: [185, 135, 255], gold: [255, 214, 80], ink: [24, 20, 34] },
  space: { panel: [10, 14, 30], panel2: [20, 28, 52], accent: [80, 200, 255], text: [226, 236, 255], dim: [110, 130, 170], good: [90, 240, 190], bad: [255, 80, 130], magic: [200, 120, 255], gold: [255, 230, 110], ink: [10, 14, 30] },
  retro: { panel: [6, 18, 6], panel2: [12, 34, 12], accent: [90, 255, 90], text: [140, 255, 140], dim: [50, 140, 50], good: [90, 255, 90], bad: [200, 255, 120], magic: [120, 255, 160], gold: [200, 255, 100], ink: [6, 18, 6] },
};

const TABS = ['Adventure', 'Party', 'Trophies', 'Stats'];
const ui = { tab: 0, pin: null, cheerUntil: 0, tick: 0, hx: null, dir: 1, particles: [], floaters: [], prev: [] };

// ---------- text helpers ----------

function truncVis(s, w) {
  if (L.visWidth(s) <= w) return s;
  let out = '';
  for (const ch of s) { if (L.visWidth(out + ch) > w - 1) break; out += ch; }
  return out + '…';
}

// A full-width line on a colored panel. Parts are [text, color, bold?].
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

// Smooth gradient bar using eighth blocks.
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

// ---------- data ----------

function snapshotData() {
  const cfg = L.loadConfig();
  const state = L.loadState();
  const sessions = Object.entries(state.sessions).sort((a, b) => (b[1].since || 0) - (a[1].since || 0));
  const sid = ui.pin && state.sessions[ui.pin] ? ui.pin : sessions[0] && sessions[0][0];
  const ses = (sid && state.sessions[sid]) || { mode: 'idle', since: Date.now(), hp: 100, combo: 0, party: {} };
  const events = L.readEvents(150).filter((e) => !sid || !e.sid || e.sid === sid);
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

// ---------- particles ----------

function emit(n, x, y, colors, { spread = 1.2, up = 2, grav = 0.12, life = 18 } = {}) {
  for (let i = 0; i < n; i++) {
    ui.particles.push({ x, y, vx: (Math.random() - 0.5) * spread * 2, vy: -Math.random() * up, g: grav, life: life * (0.6 + Math.random() * 0.6), c: colors[i % colors.length] });
  }
  if (ui.particles.length > 400) ui.particles.splice(0, ui.particles.length - 400);
}

function stepParticles(pc, floorY) {
  ui.particles = ui.particles.filter((p) => (p.life -= 1) > 0);
  for (const p of ui.particles) {
    p.x += p.vx; p.y += p.vy; p.vy += p.g;
    if (p.y > floorY - 1) { p.y = floorY - 1; p.vy *= -0.4; p.vx *= 0.7; }
    pc.set(p.x, p.y, p.c);
  }
}

// ---------- scene ----------

function drawBackground(pc, th, floorY, scroll, t) {
  const W = pc.w, H = pc.h;
  const flick = 0.85 + 0.15 * Math.sin(t * 0.9) * Math.sin(t * 0.37);
  if (th === 'space') {
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      let c = X.mix([6, 6, 20], [26, 12, 50], y / H);
      const s = X.hash(x + (scroll >> 1), y);
      if (s > 0.992) c = X.mix(c, [255, 255, 255], 0.5 + 0.5 * Math.sin(t * 0.3 + x));
      else if (s > 0.985) c = X.mix(c, [150, 170, 255], 0.5);
      pc.px[y * W + x] = c;
    }
    pc.glow(W * 0.65, H * 0.3, H * 0.7, [120, 40, 160], 0.35);
    const px = W * 0.85, py = H * 0.28, pr = Math.max(4, H * 0.14);
    for (let y = -pr; y < pr; y++) for (let x = -pr; x < pr; x++) {
      const d = Math.hypot(x, y);
      if (d < pr) pc.set(px + x, py + y, X.shade([230, 140, 80], 0.45 + 0.6 * Math.max(0, (-x - y) / (pr * 1.4) + 0.5)));
    }
    for (let y = floorY; y < H; y++) for (let x = 0; x < W; x++) {
      let c = X.shade([64, 70, 90], 1 - (y - floorY) / (H - floorY + 1) * 0.5);
      if (y === floorY) c = [120, 130, 160];
      if (y === floorY + 2 && (x + scroll) % 10 < 5) c = X.mix([0, 200, 255], c, 0.3 + 0.3 * Math.sin(t * 0.5));
      pc.px[y * W + x] = c;
    }
    return;
  }
  for (let y = 0; y < floorY; y++) {
    const row = y >> 2, off = row % 2 ? 6 : 0;
    for (let x = 0; x < W; x++) {
      const bx = Math.floor((x + off + scroll) / 12);
      const mortar = y % 4 === 3 || (x + off + scroll) % 12 === 0;
      const base = mortar ? [30, 26, 40] : X.shade([54, 47, 68], 0.8 + 0.35 * X.hash(bx, row));
      pc.px[y * W + x] = X.shade(base, 0.55 + 0.45 * (y / floorY));
    }
  }
  for (let y = floorY; y < H; y++) for (let x = 0; x < W; x++) {
    const tx = Math.floor((x + scroll) / 10), ty = Math.floor((y - floorY) / 3);
    let c = X.shade([82, 68, 60], (0.75 + 0.3 * X.hash(tx, ty + 99)) * (1 - (y - floorY) / (H - floorY + 1) * 0.55));
    if (y === floorY) c = [128, 106, 88];
    pc.px[y * W + x] = c;
  }
  // Torches with flickering light.
  const ty = Math.max(2, Math.floor(floorY * 0.32));
  for (let x = -(scroll % 48) + 20; x < W + 10; x += 48) {
    pc.glow(x + 1, ty, 18, [255, 150, 60], 0.42 * flick);
    pc.sprite(x, ty, X.TORCH[(t + x) >> 2 & 1], X.BASE);
  }
}

function drawScene(pc, d, pal) {
  const t = ui.tick;
  const th = d.cfg.theme;
  const W = pc.w, H = pc.h;
  const floorY = H - Math.max(5, Math.floor(H * 0.2));
  const mode = currentMode(d.ses);
  const walking = ['reading', 'searching', 'thinking', 'web'].includes(mode);
  const outfit = th === 'space' ? X.OUTFITS.astronaut : X.OUTFITS.wizard;
  const heroPal = { ...X.BASE, ...outfit };

  // Hero movement: pace while exploring, otherwise stand left of center.
  // Leave room behind the hero for the party.
  const partyN = Math.min(5, Object.keys(d.ses.party || {}).length);
  const home = Math.max(Math.floor(W * 0.3), 11 * partyN + 3);
  const minX = Math.max(Math.floor(W * 0.12), 11 * partyN + 3), maxX = Math.max(minX + 10, Math.floor(W * 0.62));
  if (ui.hx == null) ui.hx = home;
  let target = home;
  if (walking) { target = ui.dir > 0 ? maxX : minX; if (Math.abs(ui.hx - target) < 1) ui.dir *= -1; }
  const moving = Math.abs(ui.hx - target) >= 1;
  if (moving) { const step = walking ? 0.6 : 1.2; ui.hx += Math.sign(target - ui.hx) * Math.min(step, Math.abs(target - ui.hx)); }
  const flip = moving && target < ui.hx;
  const scroll = Math.floor(ui.hx * 0.35);
  const hx = Math.round(ui.hx), hy = floorY - 16 - (mode === 'idle' && (t >> 3) % 2 ? 1 : 0);

  drawBackground(pc, th, floorY, scroll, t);

  // Party members follow the hero and fade in when summoned.
  Object.values(d.ses.party || {}).slice(0, 5).forEach((p, i) => {
    const colors = X.CLASS_COLORS[p.cls] || X.CLASS_COLORS.Mage;
    const px = hx - 11 * (i + 1) + (flip ? 22 * (i + 1) + 4 : 0);
    const bob = (t + i * 3) >> 2 & 1;
    const fresh = Math.min(1, (Date.now() - (p.since || 0)) / 1500);
    pc.sprite(px, floorY - 12 - bob, X.MEMBER, { ...X.BASE, H: colors.H, R: colors.R }, { flip, alpha: fresh });
  });

  // Props and effects per mode.
  const staff = () => {
    const sx = flip ? hx : hx + 11;
    pc.rect(sx, hy + 3, 1, 13, X.BASE.w);
    const orb = X.mix(pal.magic, [255, 255, 255], 0.3 + 0.3 * Math.sin(t * 0.6));
    pc.rect(sx - (flip ? 0 : 0), hy + 1, 2, 2, orb);
    pc.glow(sx, hy + 2, 6, pal.magic, 0.35);
    return [sx, hy + 2];
  };
  let frame = moving ? (t >> 2) % 2 ? X.HERO_FRAMES.walk1 : X.HERO_FRAMES.walk2 : X.HERO_FRAMES.stand;
  let tint = null;

  switch (mode) {
    case 'idle': {
      const fx = hx + 18;
      pc.glow(fx + 4, floorY - 3, 26, [255, 140, 50], 0.35 + 0.08 * Math.sin(t * 0.7));
      pc.sprite(fx, floorY - 6, X.FIRE[(t >> 2) % 3], X.BASE);
      if (t % 3 === 0) emit(1, fx + 4, floorY - 6, [[255, 200, 90], [255, 120, 40]], { spread: 0.3, up: 0.8, grav: -0.02, life: 14 });
      staff();
      pc.label(hx + 3 + ((t >> 3) % 3), Math.floor((hy - 4 - ((t >> 2) % 4)) / 2), (t >> 4) % 2 ? 'z' : 'Z', pal.dim);
      break;
    }
    case 'thinking': {
      staff();
      const bx = flip ? hx - 8 : hx + 18, by = Math.max(5, hy - 10);
      [[flip ? hx - 1 : hx + 12, hy - 1, 1], [flip ? hx - 4 : hx + 15, hy - 4, 2]].forEach(([x, y, r]) => pc.rect(x - r / 2, y - r / 2, r + 1, r + 1, [235, 235, 245]));
      for (let y = -4; y <= 4; y++) for (let x = -7; x <= 7; x++) if ((x * x) / 49 + (y * y) / 16 <= 1) pc.set(bx + x, by + y, [235, 235, 245]);
      pc.label(bx - 1, Math.floor(by / 2), ['?', '…', '!', '✦'][(t >> 3) % 4], pal.ink);
      break;
    }
    case 'planning': case 'reading': {
      pc.sprite(flip ? hx - 2 : hx + 3, hy + 10, X.BOOK, X.BASE);
      if (t % 4 === 0) emit(1, hx + 6, hy + 9, [pal.gold, pal.magic], { spread: 0.4, up: 0.6, grav: -0.03, life: 12 });
      break;
    }
    case 'searching': {
      staff();
      const gx = flip ? hx - 4 : hx + 15, gy = hy + 8;
      for (let a = 0; a < 16; a++) pc.set(gx + Math.cos(a / 16 * 6.28) * 3, gy + Math.sin(a / 16 * 6.28) * 3, X.BASE.G);
      pc.glow(gx, gy, 3, [180, 230, 255], 0.5);
      pc.rect(gx + (flip ? -4 : 2), gy + 3, 2, 1, X.BASE.w);
      break;
    }
    case 'editing': {
      const ax = hx + 15;
      pc.sprite(ax, floorY - 6, X.ANVIL, X.BASE);
      const down = (t >> 2) % 2 === 1;
      if (down) {
        pc.rect(hx + 10, hy + 11, 7, 1, X.BASE.w);
        pc.rect(hx + 16, hy + 9, 3, 4, X.BASE.G);
        if ((t & 3) === 0) emit(8, hx + 18, floorY - 6, [[255, 230, 120], [255, 160, 50], [255, 255, 255]], { spread: 1.4, up: 2.2 });
        pc.glow(hx + 18, floorY - 6, 10, [255, 180, 80], 0.4);
      } else {
        pc.rect(hx + 11, hy + 5, 1, 8, X.BASE.w);
        pc.rect(hx + 9, hy + 3, 5, 3, X.BASE.G);
      }
      break;
    }
    case 'running': {
      const [ox, oy] = staff();
      const cx = Math.floor(W * 0.82);
      const len = cx - ox;
      const reach = (t * 4) % (len + 24);
      if (reach < len) {
        let y = oy;
        for (let i = 0; i < reach; i++) { if (i % 3 === 0) y += Math.round((Math.random() - 0.5) * 3); pc.set(ox + i, y, i > reach - 4 ? [255, 255, 255] : [255, 230, 90]); pc.set(ox + i, y + 1, [255, 170, 40]); }
        pc.glow(ox + reach, y, 8, [255, 230, 120], 0.5);
      } else if (reach < len + 3) emit(14, cx + 3, floorY - 8, [[200, 150, 255], [255, 255, 255], [255, 230, 90]], { spread: 1.6, up: 2.5 });
      const hit = reach >= len && reach < len + 10;
      pc.sprite(cx, floorY - 7, X.CRYSTAL, { ...X.BASE, P: hit ? [255, 255, 255] : X.BASE.P });
      pc.glow(cx + 3, floorY - 4, 10, pal.magic, hit ? 0.6 : 0.25);
      break;
    }
    case 'web': {
      staff();
      const bx = (t * 2) % (W + 20) - 10;
      pc.sprite(bx, Math.floor(H * 0.12) + ((t >> 2) & 1), X.BIRD[(t >> 1) & 1], X.BASE);
      break;
    }
    case 'summoning': {
      frame = X.HERO_FRAMES.cheer;
      const cx = hx + 26, cy = floorY - 1;
      pc.glow(cx, cy - 4, 18, pal.magic, 0.45);
      for (let a = 0; a < 24; a++) {
        const ang = a / 24 * 6.28 + t * 0.15;
        pc.set(cx + Math.cos(ang) * 9, cy + Math.sin(ang) * 2, a % 2 ? pal.magic : [255, 255, 255]);
      }
      if (t % 2 === 0) emit(2, cx + (Math.random() - 0.5) * 16, cy - 1, [pal.magic, [255, 255, 255]], { spread: 0.2, up: 1.2, grav: -0.04, life: 20 });
      break;
    }
    case 'hurt': {
      frame = X.HERO_FRAMES.hurt;
      if ((t >> 1) % 2) tint = [[255, 60, 60], 0.6];
      pc.sprite(hx + 15 - ((t >> 1) % 2) * 2, floorY - 10, X.GOBLIN[(t >> 2) % 2], X.BASE);
      pc.label(hx + 4, Math.max(0, Math.floor((hy - 2 - ((t >> 1) % 6)) / 2)), '-10', pal.bad);
      break;
    }
    case 'victory': case 'cheer': {
      frame = X.HERO_FRAMES.cheer;
      const jump = (t >> 2) % 2 ? 2 : 0;
      if (mode === 'victory') {
        const cx = hx + 18;
        pc.sprite(cx, floorY - 8, X.CHEST.open, X.BASE);
        pc.glow(cx + 6, floorY - 6, 16, [255, 210, 80], 0.45);
        if (t % 2 === 0) emit(3, cx + 6, floorY - 7, [[255, 214, 80], [255, 240, 150], [255, 170, 40]], { spread: 0.9, up: 3 });
      }
      if (t % 2 === 0) emit(2, Math.random() * W, 0, [pal.gold, pal.magic, pal.good, pal.bad, pal.accent], { spread: 0.4, up: -0.3, grav: 0.05, life: 50 });
      pc.sprite(hx, hy - jump, frame, heroPal);
      frame = null;
      break;
    }
    case 'waiting': {
      staff();
      if ((t >> 3) % 2) pc.label(hx + 5, Math.max(0, Math.floor((hy - 5) / 2)), '!', pal.accent);
      break;
    }
    default:
      staff();
  }
  if (frame) pc.sprite(hx, hy, frame, heroPal, { flip, tint });
  stepParticles(pc, floorY);

  // Soft vignette.
  pc.px = pc.px.map((c, i) => { const x = i % W; const v = (x / W - 0.5) * 2; return X.shade(c, 1 - 0.3 * v * v); });
  if (th === 'retro') pc.map((c) => { const l = (c[0] * 0.3 + c[1] * 0.59 + c[2] * 0.11) / 255; const q = Math.round(l * 5) / 5; return [10 + q * 40, 20 + q * 235, 10 + q * 60].map(X.clamp); });
}

// Render the scene at a logical resolution and upscale for big panes.
function sceneLines(cols, rows, d, pal) {
  const S = rows >= 24 && cols >= 120 ? 2 : 1;
  const lc = Math.ceil(cols / S), lr = Math.ceil(rows / S);
  const small = new X.PixelCanvas(lc, lr);
  drawScene(small, d, pal);
  if (S === 1) return small.lines();
  const big = new X.PixelCanvas(cols, rows);
  for (let y = 0; y < big.h; y++) for (let x = 0; x < cols; x++) big.px[y * cols + x] = small.px[Math.floor(y / S) * lc + Math.floor(x / S)];
  for (const [k, v] of small.text) { const [c, r] = k.split(',').map(Number); big.text.set(`${c * S},${r * S}`, v); }
  return big.lines();
}

// ---------- panels ----------

const ICONS = { quest: '★', level: '▲', achievement: '✦', hurt: '✖', faint: '✝', summon: '✧', return: '↩', combo: '≫', prompt: '▸', welcome: '◆', waiting: '!', compact: '☾', action: '·' };

function eventColor(kind, pal) {
  return { quest: pal.gold, level: pal.gold, achievement: pal.gold, hurt: pal.bad, faint: pal.bad, summon: pal.magic, return: pal.magic, combo: pal.accent, prompt: pal.accent, welcome: pal.good, waiting: pal.accent }[kind] || pal.dim;
}

// Collapse runs of identical actions ("Forging lib.js ×3").
function collapse(events) {
  const out = [];
  for (const e of events) {
    const last = out[out.length - 1];
    if (last && e.kind === 'action' && last.kind === 'action' && last.text === e.text) { last.n++; last.t = e.t; continue; }
    out.push({ ...e, n: 1 });
  }
  return out;
}

function questLog(d, pal, W, h) {
  const rows = collapse(d.events).slice(-h).map((e, i, arr) => {
    const time = new Date(e.t).toTimeString().slice(0, 5);
    const text = e.text.replace(/^[\p{Extended_Pictographic}️‍ ]+/u, '') + (e.n > 1 ? ` ×${e.n}` : '');
    const isLast = i === arr.length - 1;
    const panel = isLast ? pal.panel2 : pal.panel;
    return panelLine(W, panel, [[`  ${time} `, pal.dim], [`${ICONS[e.kind] || '·'} `, eventColor(e.kind, pal), true], [text, e.kind === 'action' ? (isLast ? pal.text : pal.dim) : eventColor(e.kind, pal), e.kind !== 'action']]);
  });
  while (rows.length < h) rows.unshift(panelLine(W, pal.panel, []));
  return rows;
}

function partyTab(d, pal, W, h) {
  const party = Object.values(d.ses.party || {});
  const out = [];
  if (party.length) {
    const pc = new X.PixelCanvas(W, 8, pal.panel);
    party.slice(0, Math.floor((W - 4) / 16)).forEach((p, i) => {
      const colors = X.CLASS_COLORS[p.cls] || X.CLASS_COLORS.Mage;
      pc.glow(6 + i * 16 + 4, 12, 9, colors.H, 0.25);
      pc.sprite(4 + i * 16, 2 + ((ui.tick + i * 3) >> 2 & 1), X.MEMBER, { ...X.BASE, H: colors.H, R: colors.R });
      pc.label(2 + i * 16, 7, (p.cls || '').slice(0, 12), pal.text);
    });
    out.push(...pc.lines());
  }
  out.push(panelLine(W, pal.panel2, [['  PARTY ', pal.accent, true], [party.length ? `${party.length} on quest` : 'empty', pal.dim]]));
  if (!party.length) out.push(panelLine(W, pal.panel, [["  Nobody's here. Ask Claude to use an agent to recruit one.", pal.dim]]));
  for (const p of party) {
    const secs = Math.round((Date.now() - p.since) / 1000);
    out.push(panelLine(W, pal.panel, [[`  ${p.cls} `, pal.text, true], [`(${p.type}) `, pal.dim], [`on quest ${secs}s`, pal.good]]));
  }
  out.push(panelLine(W, pal.panel2, [['  RECENT ADVENTURES', pal.accent, true]]));
  const hist = d.events.filter((e) => e.kind === 'summon' || e.kind === 'return');
  for (const e of hist.slice(-(h - out.length))) out.push(panelLine(W, pal.panel, [[`  ${new Date(e.t).toTimeString().slice(0, 5)} `, pal.dim], [e.text.replace(/^[\p{Extended_Pictographic}️ ]+/u, ''), pal.magic]]));
  return out;
}

function trophiesTab(d, pal, W) {
  const got = new Set(d.state.achievements);
  const out = [panelLine(W, pal.panel2, [['  TROPHIES ', pal.accent, true], [`${got.size}/${L.ACHIEVEMENTS.length} unlocked`, pal.dim]])];
  for (const a of L.ACHIEVEMENTS) {
    const v = Math.min(a.goal, a.value(d.state, d.ses));
    const done = got.has(a.id);
    const barW = 16;
    const bar = gradBar(done ? 1 : v / a.goal, barW, done ? pal.gold : pal.dim, done ? pal.accent : pal.magic, pal.panel2);
    const name = a.name.padEnd(15).slice(0, 15);
    out.push(`${bg(pal.panel)}${panelLine(4, pal.panel, [[done ? '  ★ ' : '  ☆ ', done ? pal.gold : pal.dim, true]]).replace(RESET, '')}${bg(pal.panel)}${fg(done ? pal.gold : pal.text)}${name} ${bar}${bg(pal.panel)} ${panelLine(W - 4 - 16 - barW - 1, pal.panel, [[`${done ? a.goal : v}/${a.goal}  `, pal.text], [a.desc, pal.dim]])}`);
  }
  return out;
}

function statsTab(d, pal, W) {
  const s = d.state, t = L.theme(d.cfg);
  const rows = [['Edits forged', s.tools.editing], ['Commands cast', s.tools.running], ['Files scouted', s.tools.reading], ['Searches', s.tools.searching], ['Web & MCP', s.tools.web], ['Allies summoned', s.tools.summoning], ['Plans drawn', s.tools.planning]];
  const max = Math.max(1, ...rows.map((r) => r[1] || 0));
  const out = [
    panelLine(W, pal.panel2, [['  HERO STATS ', pal.accent, true], [`${t.name} · ${s.quests} quests · ${s.streak.count}-day streak · ${d.sessions.length} sessions`, pal.dim]]),
    panelLine(W, pal.panel, []),
  ];
  const barW = Math.max(10, W - 30);
  for (const [label, n] of rows) out.push(`${bg(pal.panel)}${fg(pal.text)}  ${label.padEnd(16)} ${gradBar((n || 0) / max, barW, pal.magic, pal.accent, pal.panel2)}${bg(pal.panel)}${fg(pal.dim)} ${String(n || 0).padEnd(W - barW - 20)}${RESET}`);
  return out;
}

// ---------- frame ----------

function frame(cols, rows) {
  const d = snapshotData();
  const pal = UI[d.cfg.theme] || UI.rpg;
  const t = L.theme(d.cfg);
  const W = Math.max(50, cols);
  const out = [];

  // Header: title pill + tabs.
  const tabs = [];
  TABS.forEach((name, i) => { tabs.push(i === ui.tab ? [` ${i + 1} ${name} `, pal.accent, true] : [` ${i + 1} ${name} `, pal.dim]); });
  out.push(panelLine(W, pal.panel, [[' ◆ CLAUDE ARCADE ', pal.accent, true], [`· ${t.name}`, pal.dim]], [...tabs, [' ', pal.dim]]));

  // Character sheet with gradient bars.
  const lvl = L.levelFor(d.state.xp), lo = L.xpForLevel(lvl), hi = L.xpForLevel(lvl + 1);
  const hp = d.ses.hp ?? 100;
  const xpW = Math.max(10, Math.min(28, Math.floor(W / 6))), hpW = Math.max(8, Math.floor(xpW / 2));
  const sheet = `${bg(pal.panel2)}${BOLD}${fg(pal.text)} Lv ${lvl} ${NOBOLD}${fg(pal.magic)}${L.titleFor(t, lvl)}  ${fg(pal.dim)}XP ${gradBar((d.state.xp - lo) / (hi - lo), xpW, pal.accent, pal.gold, X.mix(pal.panel, pal.text, 0.14))}${bg(pal.panel2)}${fg(pal.dim)} ${d.state.xp}/${hi}   HP ${gradBar(hp / 100, hpW, pal.bad, pal.good, X.mix(pal.panel, pal.text, 0.14))}${bg(pal.panel2)}${fg(pal.dim)} ${hp}`;
  const extra = `${d.ses.combo >= 3 ? `   ≫ combo x${d.ses.combo}` : ''}   ★ ${d.state.quests} quests `;
  const plainSheet = ` Lv ${lvl} ${L.titleFor(t, lvl)}  XP ${' '.repeat(xpW)} ${d.state.xp}/${hi}   HP ${' '.repeat(hpW)} ${hp}`;
  out.push(`${sheet}${fg(pal.accent)}${truncVis(extra, Math.max(0, W - L.visWidth(plainSheet)))}${' '.repeat(Math.max(0, W - L.visWidth(plainSheet) - L.visWidth(truncVis(extra, Math.max(0, W - L.visWidth(plainSheet))))))}${RESET}`);

  // Current action.
  const mode = currentMode(d.ses);
  const verb = mode === 'cheer' ? 'Cheering!' : (t.modes[mode] || t.modes.thinking).verb;
  const age = Math.max(0, Math.round((Date.now() - (d.ses.since || Date.now())) / 1000));
  const busy = !['idle', 'victory', 'waiting', 'cheer'].includes(mode);
  const partyN = Object.keys(d.ses.party || {}).length;
  out.push(panelLine(W, pal.panel, [[' ▶ ', pal.accent, true], [`${verb}${busy ? '…' : ''} `, pal.text, true], [d.ses.detail && mode !== 'victory' ? d.ses.detail : '', pal.accent], [busy && age > 1 ? `  ${age}s` : '', pal.dim]], partyN ? [[`✧ party ${partyN} `, pal.magic, true]] : []));

  const bodyH = Math.max(6, rows - out.length - 1);
  if (ui.tab === 0) {
    const sceneH = Math.max(8, Math.min(40, Math.floor(bodyH * 0.62)));
    out.push(...sceneLines(W, sceneH, d, pal));
    out.push(panelLine(W, pal.panel2, [['  QUEST LOG', pal.accent, true]], [['recent first at the bottom ', pal.dim]]));
    out.push(...questLog(d, pal, W, bodyH - sceneH - 1));
  } else {
    const body = [partyTab, trophiesTab, statsTab][ui.tab - 1](d, pal, W, bodyH).slice(0, bodyH);
    while (body.length < bodyH) body.push(panelLine(W, pal.panel, []));
    out.push(...body);
  }

  const sess = d.sid ? `${ui.pin ? 'pinned' : 'following'} ${d.sid.slice(0, 8)}` : 'no session yet';
  const key = (k, label) => [[` ${k} `, pal.ink, true], [` ${label}  `, pal.dim]];
  const keys = [...key('1-4', 'tabs'), ...key('t', 'theme'), ...key('s', sess), ...key('space', 'cheer'), ...key('q', 'quit')];
  // Key caps: accent background for the key itself.
  let footer = `${bg(pal.panel2)} `;
  let used = 1;
  for (let i = 0; i < keys.length; i += 2) {
    const [k] = keys[i], [lbl] = keys[i + 1];
    if (used + k.length + lbl.length > W) break;
    footer += `${bg(pal.accent)}${fg(pal.ink)}${BOLD}${k}${NOBOLD}${bg(pal.panel2)}${fg(pal.dim)}${lbl}`;
    used += k.length + lbl.length;
  }
  out.push(footer + ' '.repeat(Math.max(0, W - used)) + RESET);
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
    const ids = d.sessions.map(([id]) => id);
    const i = ui.pin ? ids.indexOf(ui.pin) : -1;
    ui.pin = i + 1 < ids.length ? ids[i + 1] : null;
  }
  if (key === ' ') {
    ui.cheerUntil = Date.now() + 2500;
    L.logEvent({ sid: d.sid, kind: 'combo', text: M.pick(['Huzzah!', 'For glory!', 'The crowd goes wild!', 'You feel encouraged.', 'Morale +1']) });
  }
  render(true);
}

function quit() {
  process.stdout.write(`${RESET}${ESC}?25h${ESC}?1049l`);
  process.exit(0);
}

if (process.argv.includes('--snapshot')) {
  const tab = Number(process.argv[process.argv.indexOf('--snapshot') + 1]);
  if (tab >= 1 && tab <= 4) ui.tab = tab - 1;
  for (ui.tick = 0; ui.tick < 12; ui.tick++) frame(Number(process.env.COLUMNS) || 100, Number(process.env.LINES) || 28);
  process.stdout.write(frame(Number(process.env.COLUMNS) || 100, Number(process.env.LINES) || 28).join('\n') + '\n');
} else if (!process.stdout.isTTY || !process.stdin.isTTY) {
  console.log('The game needs an interactive terminal. Run it in its own terminal pane: node game.js');
} else {
  process.stdout.write(`${ESC}?1049h${ESC}?25l${ESC}2J`);
  process.stdin.setRawMode(true);
  process.stdin.setEncoding('utf8');
  process.stdin.on('data', onKey);
  process.stdout.on('resize', () => { process.stdout.write(`${ESC}2J`); render(true); });
  process.on('SIGINT', quit);
  process.on('exit', () => process.stdout.write(`${RESET}${ESC}?25h${ESC}?1049l`));
  setInterval(() => { ui.tick++; try { render(); } catch {} }, 110);
  render(true);
}
