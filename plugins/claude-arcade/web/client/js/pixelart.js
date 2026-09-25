// Pixel sprites for the GPU: runs the terminal's own sprite code (game.gen.js)
// against a transparent target, packs the results into one RGBA atlas each
// animation tick, and reports the glows the sprite code asked for as lights.

import { X, C, MON, I, SP, shimUi } from './game.gen.js';

// ---------- alpha-aware color math ----------
// The terminal canvas is always opaque. Here a pixel can be transparent, so
// colors carry an optional alpha in [3] (0-255, default opaque) and mixing
// toward a transparent pixel keeps the partial coverage (auras, smoke).
const TRANSPARENT = Object.freeze([0, 0, 0, 0]);
const cl = (v) => (v < 0 ? 0 : v > 255 ? 255 : v);
const mix0 = X.mix, shade0 = X.shade;
X.mix = (a, b, t) => {
  if (!a) a = TRANSPARENT;
  const aa = a[3] ?? 255, ba = b[3] ?? 255;
  if (aa === 255 && ba === 255) return mix0(a, b, t);
  const ra = aa + (ba - aa) * t;
  if (ra <= 0.5) return TRANSPARENT;
  const wa = aa * (1 - t), wb = ba * t;
  return [cl((a[0] * wa + b[0] * wb) / ra), cl((a[1] * wa + b[1] * wb) / ra), cl((a[2] * wa + b[2] * wb) / ra), cl(ra)];
};
X.shade = (c, f) => { const s = shade0(c, f); return c && c[3] !== undefined ? [s[0], s[1], s[2], c[3]] : s; };

export { X, C, MON, I, SP };
export const game = { ui: shimUi };

// ---------- transparent pixel target (PixelCanvas-compatible) ----------

class Target {
  constructor(w, h) { this.w = w; this.h = h; this.cols = 1e4; this.rows = 1e4; this.px = new Array(w * h).fill(null); this.lights = []; this.labels = []; }
  clear() { this.px.fill(null); this.lights.length = 0; this.labels.length = 0; }
  set(x, y, c) {
    x = Math.round(x); y = Math.round(y);
    if (!c || x < 0 || y < 0 || x >= this.w || y >= this.h) return;
    // A fully transparent color erases (a shop hat repaints the class headgear
    // with the backdrop, which here is transparent).
    this.px[y * this.w + x] = c[3] !== undefined && c[3] < 3 ? null : c;
  }
  get(x, y) { x = Math.round(x); y = Math.round(y); if (x < 0 || y < 0 || x >= this.w || y >= this.h) return TRANSPARENT; return this.px[y * this.w + x] || TRANSPARENT; }
  rect(x, y, w, h, c) { for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) this.set(x + i, y + j, c); }
  glow(cx, cy, r, color, s) { if (s > 0.01) this.lights.push({ x: cx, y: cy, r, c: color, s }); }
  sprite(x, y, rows, pal, { flip = false, tint = null } = {}) {
    const w = Math.max(...rows.map((r) => r.length));
    rows.forEach((row, j) => {
      for (let i = 0; i < row.length; i++) {
        const k = row[i];
        if (k === '.' || !pal[k]) continue;
        this.set(flip ? x + w - 1 - i : x + i, y + j, tint ? X.mix(pal[k], tint[0], tint[1]) : pal[k]);
      }
    });
  }
  label(col, row, str, fg, bold) { this.labels.push({ x: col, y: row * 2, text: str, c: fg, bold }); }
}

const pool = new Map();
function target(w, h) {
  const k = `${w}x${h}`;
  let t = pool.get(k);
  if (!t) { t = new Target(w, h); pool.set(k, t); } else t.clear();
  return t;
}

// ---------- atlas ----------

export class Atlas {
  constructor(size = 1024) {
    this.size = size; this.data = new Uint8ClampedArray(size * size * 4);
    this.reset();
  }
  reset() { this.x = 0; this.y = 0; this.rowH = 0; this.usedH = 0; this.data.fill(0, 0, this.size * Math.min(this.size, this.lastH || this.size) * 4); this.lastH = 0; this.version = (this.version || 0) + 1; }
  alloc(w, h) {
    if (this.x + w + 1 > this.size) { this.x = 0; this.y += this.rowH + 1; this.rowH = 0; }
    if (this.y + h > this.size) return null;
    const r = { x: this.x, y: this.y, w, h };
    this.x += w + 1; this.rowH = Math.max(this.rowH, h);
    this.usedH = Math.max(this.usedH, this.y + h);
    this.lastH = this.usedH + 1;
    return r;
  }
  // Copy a target's pixels in, cropped to their bounding box.
  put(tg) {
    let x0 = tg.w, y0 = tg.h, x1 = -1, y1 = -1;
    const P = tg.px, W = tg.w;
    for (let y = 0; y < tg.h; y++) for (let x = 0; x < W; x++) if (P[y * W + x]) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
    if (x1 < 0) return null;
    const w = x1 - x0 + 1, h = y1 - y0 + 1;
    const r = this.alloc(w, h);
    if (!r) return null;
    const D = this.data, S = this.size;
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const c = P[(y + y0) * W + x + x0];
      if (!c) continue;
      const o = ((r.y + y) * S + r.x + x) * 4;
      D[o] = c[0]; D[o + 1] = c[1]; D[o + 2] = c[2]; D[o + 3] = c[3] ?? 255;
    }
    return { ...r, lx: x0, ly: y0 };
  }
}

// ---------- sprites ----------
// Each render returns { r: atlas rect, dx, dy: where the rect's top-left sits
// relative to the object's own origin (logical px), lights, labels }.

const HERO_PAD_X = 28, HERO_PAD_Y = 16;
export function renderHero(atlas, ch, opts) {
  const tg = target(16 + HERO_PAD_X * 2, 24 + HERO_PAD_Y + 10);
  try { SP.drawHero(tg, ch, HERO_PAD_X, HERO_PAD_Y, opts); } catch (e) { console.warn('drawHero', e); }
  return pack(atlas, tg, HERO_PAD_X, HERO_PAD_Y);
}

export function renderCompanion(atlas, who, opts) {
  const tg = target(11 + 28, 13 + 20);
  try { SP.drawCompanion(tg, who, 12, 12, opts); } catch (e) { console.warn('drawCompanion', e); }
  return pack(atlas, tg, 12, 12);
}

export function monsterSize(m) { try { return MON.monsterSize(m); } catch { return [12, 12]; } }

export function renderMonster(atlas, m, t) {
  const [w, h] = monsterSize(m);
  const padX = h + 10, padY = h + 12;
  const tg = target(w + padX * 2, h + padY + 12);
  const y = m.y + (m.yOff || 0);
  const local = { ...m, x: padX + (m.x - Math.round(m.x)), y: padY + (m.y - Math.round(m.y)) };
  if (m.floorY != null) local.floorY = Math.round(m.floorY - m.y) + padY;
  if (m.baseY != null) local.baseY = m.baseY - m.y + padY;
  if (m.dying != null && m.dieT == null) local.dieT = m.dying;
  try { MON.drawMonster(tg, local, t, {}); } catch (e) { console.warn('drawMonster', e); }
  // The terminal draws a small HP bar over normal monsters; the web view
  // draws its own, so erase those rows.
  if (!m.boss && !(m.hp <= 0)) {
    const bw = Math.max(10, w), bx = padX + Math.floor((w - bw) / 2), by = Math.round(padY + (m.yOff || 0)) - (m.elite ? 7 : 4);
    for (let j = by - 1; j <= by + 2; j++) for (let i = bx - 1; i <= bx + bw; i++) if (i >= 0 && j >= 0 && i < tg.w && j < tg.h) tg.px[j * tg.w + i] = null;
  }
  void y;
  return pack(atlas, tg, padX, padY);
}

export function renderRows(atlas, rows, pal, opts = {}) {
  const w = Math.max(...rows.map((r) => r.length)), h = rows.length;
  const tg = target(w, h);
  tg.sprite(0, 0, rows, pal, opts);
  return pack(atlas, tg, 0, 0);
}

// Draw anything with a PixelCanvas-like callback: fn(target) in local coords
// offset by (ox, oy).
export function renderWith(atlas, w, h, ox, oy, fn) {
  const tg = target(w, h);
  try { fn(tg); } catch (e) { console.warn('renderWith', e); }
  return pack(atlas, tg, ox, oy);
}

function pack(atlas, tg, ox, oy) {
  const r = atlas.put(tg);
  const lights = tg.lights.map((l) => ({ ...l, x: l.x - ox, y: l.y - oy }));
  const labels = tg.labels.map((l) => ({ ...l, x: l.x - ox, y: l.y - oy }));
  if (!r) return { r: null, lights, labels };
  return { r, dx: r.lx - ox, dy: r.ly - oy, lights, labels };
}

// A standalone 2D canvas of a hero, for portraits in the panels.
export function heroCanvas(ch, opts = {}, scale = 4, pad = 6) {
  const tg = new Target(16 + pad * 2 + 16, 24 + pad * 2);
  try { SP.drawHero(tg, ch, pad + 8, pad, { t: 0, pose: 'stand', ...opts }); } catch (e) { console.warn(e); }
  return targetToCanvas(tg, scale, opts.canvas);
}
export function companionCanvas(who, opts = {}, scale = 4) {
  const tg = new Target(11 + 12, 13 + 8);
  try { SP.drawCompanion(tg, who, 6, 5, { t: 0, ...opts }); } catch (e) { console.warn(e); }
  return targetToCanvas(tg, scale, opts.canvas);
}
export function monsterCanvas(type, scale = 3, color = 0) {
  const m = { type, x: 4, y: 4, hp: 1, max: 1, color, seed: 0 };
  const [w, h] = monsterSize(m);
  const tg = new Target(w + 8, h + 8);
  try { MON.drawMonster(tg, { ...m, floorY: h + 4, boss: false }, 0, {}); } catch (e) { console.warn(e); }
  return targetToCanvas(tg, scale);
}
export function rowsCanvas(rows, pal, scale = 3) {
  const w = Math.max(1, ...rows.map((r) => r.length)), h = Math.max(1, rows.length);
  const tg = new Target(w, h);
  tg.sprite(0, 0, rows, pal);
  return targetToCanvas(tg, scale);
}

export function targetToCanvas(tg, scale, canvas) {
  const cv = canvas || document.createElement('canvas');
  cv.width = tg.w * scale; cv.height = tg.h * scale;
  const small = new ImageData(tg.w, tg.h);
  tg.px.forEach((c, i) => { if (c) { small.data[i * 4] = c[0]; small.data[i * 4 + 1] = c[1]; small.data[i * 4 + 2] = c[2]; small.data[i * 4 + 3] = c[3] ?? 255; } });
  const tmp = document.createElement('canvas');
  tmp.width = tg.w; tmp.height = tg.h;
  tmp.getContext('2d').putImageData(small, 0, 0);
  const ctx = cv.getContext('2d');
  ctx.imageSmoothingEnabled = false;
  ctx.clearRect(0, 0, cv.width, cv.height);
  ctx.drawImage(tmp, 0, 0, cv.width, cv.height);
  cv.lights = tg.lights;
  return cv;
}

export const catalog = () => I.CATALOG;
export const itemById = (id) => I.getItem(id);
