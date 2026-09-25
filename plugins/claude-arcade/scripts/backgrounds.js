'use strict';
// Scene backgrounds per theme.

const L = require('./lib');
const M = require('./messages');
const X = require('./pixel');
const C = require('./character');
const SP = require('./sprites');
const { ESC, RESET, BOLD, NOBOLD, fg, bg, UI, TABS, SIDE, ui, snapshotData, currentMode, isBusy } = require('./state');

// ---------- scene ----------

function drawBackground(pc, th, floorY, scroll, t) {
  const W = pc.w, H = pc.h;
  if (th === 'space') {
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      let c = X.mix([5, 5, 18], [28, 12, 52], y / H);
      const s1 = X.hash(x + Math.floor(t * 0.2), y), s2 = X.hash(x + Math.floor(t * 0.6) + 999, y);
      if (s1 > 0.994) c = X.mix(c, [255, 255, 255], 0.5 + 0.4 * Math.sin(t * 0.3 + x));
      else if (s2 > 0.99) c = X.mix(c, [140, 160, 255], 0.55);
      pc.px[y * W + x] = c;
    }
    pc.glow(W * 0.6, H * 0.35, H * 0.8, [120, 40, 170], 0.3);
    pc.glow(W * 0.25, H * 0.2, H * 0.5, [30, 90, 170], 0.22);
    const px = W * 0.84, py = H * 0.26, pr = Math.max(5, H * 0.13);
    for (let y = -pr; y < pr; y++) for (let x = -pr; x < pr; x++) {
      if (Math.hypot(x, y) < pr) pc.set(px + x, py + y, X.shade(X.mix([240, 160, 90], [190, 90, 60], (y + pr) / (2 * pr)), 0.4 + 0.7 * Math.max(0, (-x - y) / (pr * 1.5) + 0.45)));
    }
    for (let a = 0; a < 200; a++) { const ang = a / 200 * 6.283; const rx = Math.cos(ang) * pr * 1.8, ry = Math.sin(ang) * pr * 0.35; if (ry > 0 || Math.hypot(rx, ry * 3) > pr) pc.set(px + rx, py + ry, [220, 200, 170]); }
    const sx = (t * 5) % (W * 3) - W, sy = (t * 2) % (H * 3) - H;
    if (sx > 0 && sx < W && sy > 0 && sy < floorY) for (let k = 0; k < 8; k++) pc.set(sx - k * 2.5, sy - k, X.shade([255, 255, 255], 1 - k * 0.12));
    for (let y = floorY; y < H; y++) for (let x = 0; x < W; x++) {
      let c = X.shade([64, 70, 92], 1 - (y - floorY) / (H - floorY + 1) * 0.55);
      if (y === floorY) c = [140, 150, 180];
      if ((x + scroll) % 24 === 0) c = X.shade(c, 0.7);
      if (y === floorY + 2 && (x + scroll) % 12 < 6) c = X.mix([0, 210, 255], c, 0.25 + 0.3 * Math.sin(t * 0.4 + x * 0.05));
      pc.px[y * W + x] = c;
    }
    return;
  }
  for (let y = 0; y < floorY; y++) {
    const row = y >> 2, off = row % 2 ? 6 : 0;
    for (let x = 0; x < W; x++) {
      const bx = Math.floor((x + off + scroll) / 12);
      const mortar = y % 4 === 3 || (x + off + scroll) % 12 === 0;
      const base = mortar ? [30, 26, 40] : X.shade([56, 48, 70], 0.78 + 0.36 * X.hash(bx, row));
      pc.px[y * W + x] = X.shade(base, 0.5 + 0.5 * (y / floorY));
    }
  }
  // Arched alcoves and pillars.
  const archW = 56, top = Math.floor(floorY * 0.18);
  for (let ax = -((scroll >> 1) % archW) - archW; ax < W + archW; ax += archW) {
    const cx = ax + 28, rr = 14;
    for (let y = top; y < floorY; y++) for (let x = Math.max(0, ax + 14); x < Math.min(W, ax + 42); x++) {
      if (y > top + rr || Math.hypot(x - cx, y - (top + rr)) < rr) pc.px[y * W + x] = X.shade(pc.px[y * W + x], 0.45);
    }
    for (let y = top; y < floorY; y++) for (let x = ax + 8; x <= ax + 12; x++) if (x >= 0 && x < W) pc.px[y * W + x] = X.shade([80, 70, 96], 0.6 + 0.12 * (x - ax - 8) + 0.3 * (y / floorY));
  }
  for (let y = floorY; y < H; y++) for (let x = 0; x < W; x++) {
    const tx = Math.floor((x + scroll) / 10), ty = Math.floor((y - floorY) / 3);
    let c = X.shade([84, 70, 62], (0.75 + 0.3 * X.hash(tx, ty + 99)) * (1 - (y - floorY) / (H - floorY + 1) * 0.6));
    if (y === floorY) c = [132, 110, 92];
    if ((x + scroll) % 10 === 0 && y > floorY) c = X.shade(c, 0.75);
    pc.px[y * W + x] = c;
  }
  const ty = Math.max(2, Math.floor(floorY * 0.35));
  const flick = 0.85 + 0.15 * Math.sin(t * 0.9) * Math.sin(t * 0.37);
  for (let x = -((scroll >> 1) % archW) - archW + 10; x < W + 10; x += archW) {
    pc.glow(x + 1, ty, 22, [255, 150, 60], 0.45 * flick);
    pc.sprite(x, ty, X.TORCH[(t + x) >> 2 & 1], X.BASE);
  }
  if (ui.dust.length < W / 6) ui.dust.push({ x: Math.random() * W, y: Math.random() * floorY, v: 0.05 + Math.random() * 0.1 });
  for (const p of ui.dust) {
    p.x += p.v; p.y += Math.sin((t + p.x) * 0.05) * 0.05;
    if (p.x >= W) p.x = 0;
    if (p.y >= 0 && p.y < floorY) pc.set(p.x, p.y, X.mix(pc.get(p.x | 0, p.y | 0) || [0, 0, 0], [255, 220, 170], 0.35));
  }
}

module.exports = { drawBackground };
