'use strict';
// Scene backgrounds. The rpg and retro themes pick a biome from the hero level
// (dungeon, forest, lava cave, castle throne hall), and the space theme picks
// a sector the same way. Each scene is built from far/mid/near parallax layers
// driven by `scroll` and animated by `t` (ui.tick, 10 fps). Everything here
// is drawn before the characters, so it stays darker and lower in contrast
// behind the fighting area.
//
// ARCADE_BIOME forces a biome (see state.js). ARCADE_WEATHER=rain|clear forces
// the forest weather, for screenshots.

const X = require('./pixel');
const { ui, biomeFor, BIOMES } = require('./state');

const { mix, shade, hash, clamp } = X;
const lerp = (a, b, f) => a + (b - a) * f;
const smooth = (f) => f * f * (3 - 2 * f);
const mod = (a, n) => ((a % n) + n) % n;

// ---------- helpers ----------

// Smooth 1D value noise in 0..1.
function noise1(x, seed) {
  const i = Math.floor(x);
  return lerp(hash(i, seed), hash(i + 1, seed), smooth(x - i));
}

// Smooth 2D value noise in 0..1, periodic in x with period p lattice cells.
function noise2(x, y, seed, p) {
  const ix = Math.floor(x), iy = Math.floor(y), fx = smooth(x - ix), fy = smooth(y - iy);
  const a = mod(ix, p) + seed * 1013, b = mod(ix + 1, p) + seed * 1013;
  return lerp(lerp(hash(a, iy), hash(b, iy), fx), lerp(hash(a, iy + 1), hash(b, iy + 1), fx), fy);
}

// Multi-stop gradient: stops = [[pos, color], ...] with pos ascending.
function gradient(stops, f) {
  if (f <= stops[0][0]) return stops[0][1];
  for (let i = 1; i < stops.length; i++) {
    if (f <= stops[i][0]) { const [p0, c0] = stops[i - 1], [p1, c1] = stops[i]; return mix(c0, c1, (f - p0) / (p1 - p0)); }
  }
  return stops[stops.length - 1][1];
}

function blend(pc, x, y, c, a) {
  x = Math.round(x); y = Math.round(y);
  if (x < 0 || y < 0 || x >= pc.w || y >= pc.h || a <= 0) return;
  const i = y * pc.w + x;
  pc.px[i] = mix(pc.px[i], c, Math.min(1, a));
}

function add(pc, x, y, c, a) {
  x = Math.round(x); y = Math.round(y);
  if (x < 0 || y < 0 || x >= pc.w || y >= pc.h || a <= 0) return;
  const i = y * pc.w + x, p = pc.px[i];
  pc.px[i] = [clamp(p[0] + c[0] * a), clamp(p[1] + c[1] * a), clamp(p[2] + c[2] * a)];
}

// Cheap additive light with quadratic falloff (no sqrt per pixel).
function light(pc, cx, cy, r, c, s) {
  if (s <= 0 || r <= 0) return;
  const W = pc.w, P = pc.px, r2 = r * r;
  const y0 = Math.max(0, Math.floor(cy - r)), y1 = Math.min(pc.h - 1, Math.ceil(cy + r));
  const x0 = Math.max(0, Math.floor(cx - r)), x1 = Math.min(W - 1, Math.ceil(cx + r));
  for (let y = y0; y <= y1; y++) {
    const dy = (y - cy) * 1.1, dy2 = dy * dy;
    if (dy2 >= r2) continue;
    for (let x = x0; x <= x1; x++) {
      const dx = x - cx, d2 = dx * dx + dy2;
      if (d2 >= r2) continue;
      let f = 1 - d2 / r2; f = f * f * s;
      const i = y * W + x, p = P[i];
      P[i] = [clamp(p[0] + c[0] * f), clamp(p[1] + c[1] * f), clamp(p[2] + c[2] * f)];
    }
  }
}

// Solid rows (sky, walls): one shared color array per row.
function fillRows(pc, y0, y1, colorOf) {
  const W = pc.w, rows = [];
  for (let y = y0; y < y1; y++) {
    const c = colorOf(y);
    rows.push(c);
    for (let x = 0; x < W; x++) pc.px[y * W + x] = c;
  }
  return rows;
}

// Heat shimmer: shift whole rows sideways by a pixel, like air over a fire.
function shimmer(pc, y0, y1, t, amp) {
  const W = pc.w;
  for (let y = Math.max(0, y0); y < Math.min(pc.h, y1); y++) {
    const s = Math.round(Math.sin(y * 0.7 + t * 0.45) * amp * ((y - y0) / Math.max(1, y1 - y0)));
    if (!s) continue;
    const row = pc.px.slice(y * W, y * W + W);
    for (let x = 0; x < W; x++) pc.px[y * W + x] = row[Math.min(W - 1, Math.max(0, x + s))];
  }
}

// Ambient particles live here, reset whenever the scene or pane size changes.
const FX = { key: '', pools: {} };
function pool(key, name) {
  if (FX.key !== key) { FX.key = key; FX.pools = {}; }
  return FX.pools[name] || (FX.pools[name] = []);
}

// ---------- dungeon ----------

// Cobweb offsets for a ceiling corner (radial threads plus sagging arcs).
const WEB = (() => {
  const pts = new Set(), R = 9;
  for (const deg of [0, 25, 50, 72, 90]) {
    const a = deg * Math.PI / 180;
    for (let r = 1; r <= R; r++) pts.add(`${Math.round(Math.cos(a) * r)},${Math.round(Math.sin(a) * r)}`);
  }
  for (const r of [3, 6, 8.5]) {
    for (let a = 0; a <= 90; a += 6) {
      const rad = a * Math.PI / 180, sag = 1 + 0.12 * Math.sin(rad * 4);
      pts.add(`${Math.round(Math.cos(rad) * r * sag)},${Math.round(Math.sin(rad) * r * sag)}`);
    }
  }
  return [...pts].map((s) => s.split(',').map(Number));
})();

function dungeon(pc, floorY, scroll, t, key) {
  const W = pc.w, H = pc.h, P = pc.px;
  const far = Math.floor(scroll * 0.5), near = scroll;

  // Far: brick wall with bevels and creeping moss.
  for (let y = 0; y < floorY; y++) {
    const row = y >> 2, off = row % 2 ? 6 : 0, lit = 0.4 + 0.6 * (y / floorY), yk = y % 4;
    for (let x = 0; x < W; x++) {
      const wx = x + off + far, bx = Math.floor(wx / 12);
      let c;
      if (yk === 3 || wx % 12 === 0) c = [30, 26, 40];
      else {
        c = shade([56, 48, 70], (0.78 + 0.36 * hash(bx, row)) * (yk === 0 ? 1.1 : yk === 2 ? 0.92 : 1));
        const moss = hash(bx, row + 77);
        if (moss > 0.7 && hash(wx, y) < (moss - 0.7) * 3.3 * (0.3 + y / floorY)) c = mix(c, [64, 96, 54], 0.45);
      }
      P[y * W + x] = shade(c, lit);
    }
  }

  // Far: arched alcoves (some barred cells), stone rims, pillars.
  const archW = 56, top = Math.floor(floorY * 0.18), rr = 14, a0 = -(far % archW) - archW;
  for (let ax = a0; ax < W + archW; ax += archW) {
    const id = Math.round((ax + far) / archW), cx = ax + 28, cy = top + rr;
    const barred = hash(id, 31) < 0.3;
    for (let y = Math.max(0, top - 2); y < floorY; y++) {
      const dy2 = (y - cy) * (y - cy);
      for (let x = Math.max(0, ax + 12); x < Math.min(W, ax + 44); x++) {
        const d2 = (x - cx) * (x - cx) + dy2, i = y * W + x;
        const inside = x >= ax + 14 && x < ax + 42 && (y > cy || d2 < rr * rr);
        if (inside) {
          let c = shade(P[i], 0.42);
          if (barred && ((x - ax - 14) % 4 === 2 || y === cy + 3)) c = (x - ax - 14) % 4 === 2 && y % 7 === 0 ? [70, 68, 84] : [42, 40, 52];
          P[i] = c;
        } else if (y <= cy && d2 < (rr + 2.5) * (rr + 2.5) && d2 >= rr * rr) {
          const seg = Math.floor(Math.atan2(y - cy, x - cx) * 3);
          P[i] = shade([86, 76, 100], (0.7 + 0.25 * hash(seg, id)) * (0.55 + 0.45 * (y / floorY)) * ((seg & 1) ? 1 : 0.9));
        }
      }
    }
    for (let y = top; y < floorY; y++) for (let x = ax + 8; x <= ax + 12; x++) if (x >= 0 && x < W) P[y * W + x] = X.shade([80, 70, 96], 0.6 + 0.12 * (x - ax - 8) + 0.3 * (y / floorY));
    // Cobwebs in the ceiling corners beside some pillars.
    if (hash(id, 41) < 0.6) for (const [dx, dy] of WEB) blend(pc, ax + 13 + dx, dy, [200, 200, 215], 0.36);
    if (hash(id, 42) < 0.4) for (const [dx, dy] of WEB) blend(pc, ax + 7 - dx, dy, [200, 200, 215], 0.36);
  }

  // Near: flagstone floor with damp puddles.
  for (let y = floorY; y < H; y++) for (let x = 0; x < W; x++) {
    const wx = x + near, tx = Math.floor(wx / 10), ty = Math.floor((y - floorY) / 3);
    let c = shade([84, 70, 62], (0.75 + 0.3 * hash(tx, ty + 99)) * (1 - (y - floorY) / (H - floorY + 1) * 0.6));
    if (y === floorY) c = [132, 110, 92];
    else if (wx % 10 === 0 || (y - floorY) % 3 === 0) c = shade(c, 0.78);
    P[y * W + x] = c;
  }

  // Torches on the pillars.
  const ty = Math.max(2, Math.floor(floorY * 0.35));
  const flick = 0.85 + 0.15 * Math.sin(t * 0.9) * Math.sin(t * 0.37);
  for (let x = a0 + 9; x < W + 10; x += archW) {
    light(pc, x + 1, ty + 1, 20, [255, 130, 50], 0.5 * flick);
    pc.sprite(x, ty, X.TORCH[(t + x) >> 2 & 1], X.BASE);
  }

  // Near: chains hanging from the ceiling, swaying a little.
  for (let i = Math.floor(near / 31) - 1; i <= Math.floor((near + W) / 31) + 1; i++) {
    if (hash(i, 901) < 0.5) continue;
    const cx0 = i * 31 + Math.floor(hash(i, 902) * 20) - near;
    const len = Math.floor(floorY * (0.12 + 0.28 * hash(i, 903)));
    const sw = Math.sin(t * 0.08 + i * 1.7) * 1.3;
    for (let y = 0; y <= len; y++) {
      const x = Math.round(cx0 + sw * (y / len) * (y / len)), k = y % 4;
      if (k === 0) { pc.set(x - 1, y, [54, 52, 64]); pc.set(x, y, [118, 116, 132]); pc.set(x + 1, y, [54, 52, 64]); }
      else pc.set(x, y, k === 2 ? [40, 38, 50] : [96, 94, 110]);
    }
    const hx = Math.round(cx0 + sw);
    for (const [dx, dy] of [[-1, 1], [1, 1], [-1, 2], [0, 2], [1, 2]]) pc.set(hx + dx, len + dy, [84, 82, 98]);
  }

  // Water dripping from the ceiling into puddles.
  for (let i = Math.floor(near / 23) - 1; i <= Math.floor((near + W) / 23) + 1; i++) {
    if (hash(i, 911) < 0.55) continue;
    const x = i * 23 + Math.floor(hash(i, 912) * 16) - near;
    if (x < -4 || x > W + 4) continue;
    for (let dx = -3; dx <= 3; dx++) {
      blend(pc, x + dx, floorY + 1, [70, 100, 140], 0.4 + 0.15 * Math.sin(t * 0.3 + dx));
      if (Math.abs(dx) < 2) blend(pc, x + dx, floorY + 2, [60, 86, 120], 0.35);
    }
    const period = 34 + Math.floor(hash(i, 913) * 30), ph = (t + Math.floor(hash(i, 914) * 60)) % period, form = 12;
    if (ph < form) { blend(pc, x, 0, [150, 190, 230], ph / form); continue; }
    const s = ph - form, y = 0.12 * s * s, hit = Math.sqrt((floorY - 1) / 0.12);
    if (y < floorY - 1) { pc.set(x, y, [160, 200, 240]); blend(pc, x, y - 1, [120, 160, 210], 0.45); }
    else if (s - hit < 3) {
      const k = s - hit;
      blend(pc, x - 1 - k, floorY - 1 - (k < 1 ? 1 : 0), [170, 210, 245], 0.8);
      blend(pc, x + 1 + k, floorY - 1 - (k < 1 ? 1 : 0), [170, 210, 245], 0.8);
      blend(pc, x, floorY + 1, [200, 230, 255], 0.6);
    }
  }

  // Dust drifting through the torchlight.
  const dust = pool(key, 'dust');
  if (dust.length < W / 6) dust.push({ x: Math.random() * W, y: Math.random() * floorY, v: 0.05 + Math.random() * 0.1 });
  for (const p of dust) {
    p.x += p.v; p.y += Math.sin((t + p.x) * 0.05) * 0.05;
    if (p.x >= W) p.x = 0;
    if (p.y >= 0 && p.y < floorY) blend(pc, p.x, p.y, [255, 220, 170], 0.35);
  }
}

// ---------- forest ----------

const FOREST_SKY = [[0, [14, 22, 42]], [0.4, [40, 62, 84]], [0.72, [120, 122, 108]], [1, [168, 146, 104]]];

// Rain comes and goes: about a fifth of the time, in ~5 minute cycles.
function rainAmount(t) {
  const w = process.env.ARCADE_WEATHER;
  if (w === 'rain') return 1;
  if (w === 'clear') return 0;
  return Math.max(0, Math.min(1, (Math.sin(t * 0.0021 - 1.3) - 0.6) * 5));
}

// Tiered conifer silhouettes. Fills each column from the highest tree top
// down to baseY using colorAt(y, x, wx).
function conifers(pc, off, spacing, hMin, hMax, seed, baseY, hill, colorAt) {
  const W = pc.w;
  for (let x = 0; x < W; x++) {
    const wx = x + off, i0 = Math.floor(wx / spacing);
    let top = baseY;
    for (let i = i0 - 2; i <= i0 + 2; i++) {
      if (hash(i, seed) < 0.12) continue;
      const cx = i * spacing + hash(i, seed + 1) * spacing * 0.7;
      const h = hMin + (hMax - hMin) * hash(i, seed + 2);
      const tY = baseY - h - hill * noise1(cx / 40, seed + 3);
      const dx = Math.abs(wx - cx), T = Math.max(3, Math.round(h / 6));
      for (let d = 0; d < h + hill; d++) {
        if (tY + d >= top) break;
        if (0.3 + Math.floor(d / T) * T * 0.26 + (d % T) * 0.55 >= dx) { top = tY + d; break; }
      }
    }
    for (let y = Math.max(0, Math.ceil(top)); y < baseY; y++) pc.px[y * W + x] = colorAt(y, x, wx, y - top);
  }
}

function forest(pc, floorY, scroll, t, key) {
  const W = pc.w, H = pc.h, P = pc.px;
  const rain = rainAmount(t), clear = 1 - rain;
  const f1 = Math.floor(scroll * 0.2), f2 = Math.floor(scroll * 0.45), f3 = Math.floor(scroll * 0.75), nr = scroll;

  const sky = fillRows(pc, 0, floorY, (y) => mix(gradient(FOREST_SKY, y / floorY), [52, 58, 70], rain * 0.6));
  light(pc, W * 0.3 - scroll * 0.05, floorY * 0.66, floorY * 0.55, [255, 180, 100], 0.4 * clear);

  // Far: hazy hills of pines.
  conifers(pc, f1, 6, floorY * 0.2, floorY * 0.38, 301, floorY, floorY * 0.12,
    (y, x, wx, d) => mix(sky[y], [34, 58, 70], d < 1 ? 0.55 : 0.72));
  for (let y = Math.floor(floorY * 0.62); y < floorY; y++) {
    const a = ((y - floorY * 0.62) / (floorY * 0.38)) * (0.3 + 0.2 * rain);
    for (let x = 0; x < W; x++) P[y * W + x] = mix(P[y * W + x], [130, 136, 124], a);
  }

  // Mid: darker, taller pines.
  conifers(pc, f2, 13, floorY * 0.42, floorY * 0.72, 401, floorY, floorY * 0.08,
    (y, x, wx, d) => shade(d < 1 ? [44, 66, 58] : [22, 40, 40], 0.9 + 0.18 * hash(wx, y)));
  for (let y = Math.floor(floorY * 0.78); y < floorY; y++) {
    const a = ((y - floorY * 0.78) / (floorY * 0.22)) * 0.22;
    for (let x = 0; x < W; x++) P[y * W + x] = mix(P[y * W + x], [110, 120, 108], a);
  }

  // God rays slanting down from the upper left.
  if (clear > 0) {
    const k = 0.6, umin = -Math.ceil(floorY * k), ray = new Float32Array(W - umin + 2);
    const br = clear * (0.8 + 0.2 * Math.sin(t * 0.03));
    for (let u = umin; u <= W + 1; u++) ray[u - umin] = Math.max(0, noise1((u + Math.floor(scroll * 0.3)) / 3, 555) - 0.55) * 2.6 * br;
    for (let y = 0; y < floorY; y++) {
      const fade = 0.4 * (0.3 + 0.65 * (1 - y / floorY));
      for (let x = 0; x < W; x++) {
        const r = ray[Math.round(x - y * k) - umin];
        if (r > 0.02) { const i = y * W + x, p = P[i], f = r * fade; P[i] = [clamp(p[0] + 255 * f), clamp(p[1] + 230 * f), clamp(p[2] + 160 * f)]; }
      }
    }
  }

  // Mid-near: ferns and bushes along the forest floor.
  for (let x = 0; x < W; x++) {
    const wx = x + f3, h = 1 + 5 * noise1(wx / 4, 610) * noise1(wx / 13, 611);
    for (let y = Math.max(0, Math.floor(floorY - h)); y < floorY; y++) {
      P[y * W + x] = hash(wx, y + 3) > 0.78 ? [48, 82, 50] : [24, 46, 34];
    }
  }

  // Near: big trunks and the canopy overhead.
  for (let i = Math.floor(nr / 47) - 1; i <= Math.floor((nr + W) / 47) + 1; i++) {
    if (hash(i, 701) < 0.35) continue;
    const cx = i * 47 + Math.floor(hash(i, 702) * 24) - nr, tw = 4 + Math.floor(hash(i, 703) * 3);
    for (let y = 0; y < floorY; y++) {
      const flare = y > floorY - 5 ? (y - floorY + 5) * 0.7 : 0;
      const x0 = Math.floor(cx - tw / 2 - flare), x1 = Math.ceil(cx + tw / 2 + flare);
      for (let x = Math.max(0, x0); x <= Math.min(W - 1, x1); x++) {
        let c = shade([30, 25, 24], 0.85 + 0.3 * hash(x + nr, Math.floor(y / 3)));
        if (x === x0) c = [52, 44, 38];
        else if (x === x1) c = [18, 16, 18];
        P[y * W + x] = c;
      }
    }
  }
  for (let x = 0; x < W; x++) {
    const wx = x + nr, cb = floorY * (0.06 + 0.12 * noise1(wx / 9, 720) + 0.06 * noise1(wx / 3.5, 721));
    for (let y = 0; y < cb + 2; y++) {
      if (y >= cb && hash(wx, y + 5) > (cb + 2 - y) / 2.5) continue;
      const hl = hash(wx, y + 9);
      P[y * W + x] = hl > 0.84 ? [44, 72, 44] : hl < 0.08 ? mix(sky[y], [20, 34, 26], 0.5) : [16, 30, 24];
    }
  }

  // Ground: grass edge, soil, stones.
  for (let y = floorY; y < H; y++) {
    const dep = (y - floorY) / (H - floorY + 1);
    for (let x = 0; x < W; x++) {
      const wx = x + nr, hv = hash(wx, y);
      let c;
      if (y === floorY) c = hv > 0.5 ? [82, 128, 60] : [66, 112, 52];
      else if (y === floorY + 1) c = hv > 0.5 ? [52, 88, 44] : [70, 60, 40];
      else {
        c = shade([66, 50, 36], (0.8 + 0.3 * hv) * (1 - dep * 0.55));
        if (hash(Math.floor(wx / 4), Math.floor((y - floorY) / 2) + 50) > 0.9) c = shade([64, 58, 56], 1 - dep * 0.5);
      }
      if (rain && y === floorY + 1 && hash(Math.floor(wx / 6), 88) > 0.7) c = mix(c, [110, 130, 160], 0.4 * rain);
      P[y * W + x] = c;
    }
  }
  for (let x = 0; x < W; x++) {
    const h = hash(x + nr, 3);
    if (h > 0.55) pc.set(x, floorY - 1, [58, 104, 48]);
    if (h > 0.84) pc.set(x, floorY - 2, [70, 120, 54]);
    if (h > 0.975) pc.set(x, floorY - 2, hash(x + nr, 4) > 0.5 ? [236, 206, 90] : [224, 120, 170]);
  }

  // Fireflies (fewer in the rain).
  const flies = pool(key, 'flies');
  while (flies.length < Math.max(4, W / 9)) flies.push({ x: Math.random() * W, y: floorY * (0.3 + Math.random() * 0.65), vx: 0, vy: 0, ph: Math.random() * 6.3 });
  flies.forEach((f, n) => {
    f.vx = Math.max(-0.25, Math.min(0.25, f.vx + (Math.random() - 0.5) * 0.06));
    f.vy = Math.max(-0.15, Math.min(0.15, f.vy + (Math.random() - 0.5) * 0.05));
    f.x = mod(f.x + f.vx, W); f.y = Math.max(floorY * 0.25, Math.min(floorY - 2, f.y + f.vy));
    if (n / flies.length > 1 - rain * 0.8) return;
    const b = Math.max(0, Math.sin(t * 0.18 + f.ph));
    if (b < 0.1) return;
    add(pc, f.x, f.y, [200, 255, 110], b);
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) add(pc, f.x + dx, f.y + dy, [120, 170, 50], b * 0.35);
  });

  // Falling leaves.
  const LEAF = [[206, 120, 40], [226, 176, 64], [168, 70, 34], [130, 150, 56]];
  const leaves = pool(key, 'leaves');
  while (leaves.length < Math.max(3, W / 14)) leaves.push({ x: Math.random() * W, y: Math.random() * floorY, ph: Math.random() * 6.3, v: 0.15 + Math.random() * 0.2, c: LEAF[Math.floor(Math.random() * LEAF.length)] });
  for (const l of leaves) {
    l.y += l.v * (1 + rain); l.x += Math.sin(t * 0.12 + l.ph) * 0.35 - 0.12 - rain * 0.3;
    if (l.y >= floorY || l.x < -2) { l.y = Math.random() * floorY * 0.2; l.x = Math.random() * (W + 20); }
    pc.set(l.x, l.y, l.c);
    if (Math.sin(t * 0.3 + l.ph) > 0) pc.set(l.x + 1, l.y, shade(l.c, 0.75));
  }

  // Rain streaks and splashes.
  if (rain > 0) {
    const n = Math.floor(W * floorY / 45 * rain);
    for (let i = 0; i < n; i++) {
      const sp = 2.6 + hash(i, 12) * 1.2, y = (hash(i, 13) * (floorY + 8) + t * sp) % (floorY + 8) - 4;
      const x = mod(hash(i, 11) * (W + 20) - y * 0.3 - t * 0.6, W + 20) - 10;
      if (y >= floorY) {
        if (y < floorY + 1.5) { blend(pc, x - 1, floorY - 1, [170, 190, 220], 0.6); blend(pc, x + 1, floorY - 1, [170, 190, 220], 0.6); }
        continue;
      }
      for (let k = 0; k < 3; k++) blend(pc, x + k * 0.3, y - k, [170, 190, 225], 0.5 - k * 0.14);
    }
  }
}

// ---------- lava cave ----------

const LAVA_SKY = [[0, [10, 6, 10]], [0.45, [30, 12, 14]], [0.8, [76, 24, 16]], [1, [130, 44, 18]]];

function lavaColor(v) {
  return v < 0.5 ? mix([196, 44, 10], [255, 128, 24], v * 2) : mix([255, 128, 24], [255, 222, 110], (v - 0.5) * 2);
}

function lava(pc, floorY, scroll, t, key) {
  const W = pc.w, H = pc.h, P = pc.px;
  const f1 = Math.floor(scroll * 0.25), f2 = Math.floor(scroll * 0.5), nr = scroll;
  const rh = Math.max(3, Math.round(floorY * 0.12)), ry = floorY - rh;
  const pulse = 0.85 + 0.15 * Math.sin(t * 0.07);

  fillRows(pc, 0, ry, (y) => shade(gradient(LAVA_SKY, y / ry), pulse * 0.95 + 0.05));

  // Far: cave ceiling teeth and distant rock spires lit from below.
  for (let x = 0; x < W; x++) {
    const wx = x + f1;
    const ceil = floorY * (0.06 + 0.14 * noise1(wx / 6, 21)) + (hash(Math.floor(wx / 3), 22) > 0.72 ? floorY * 0.14 * (1 - Math.abs(mod(wx, 3) - 1)) : 0);
    for (let y = 0; y < Math.min(ry, ceil); y++) P[y * W + x] = shade([30, 16, 18], 0.7 + 0.3 * (y / ceil));
    const top = ry - floorY * (0.12 + 0.34 * noise1(wx / 11, 23) * noise1(wx / 4, 24));
    for (let y = Math.max(0, Math.floor(top)); y < ry; y++) P[y * W + x] = mix([28, 14, 16], [96, 34, 18], ((y - top) / (ry - top)) ** 2 * pulse);
  }
  // Far: lavafalls pouring from clefts.
  for (let i = Math.floor(f1 / 97) - 1; i <= Math.floor((f1 + W) / 97) + 1; i++) {
    if (hash(i, 51) < 0.3) continue;
    const cx = i * 97 + Math.floor(hash(i, 52) * 50) - f1, top = Math.floor(floorY * (0.12 + 0.1 * hash(i, 53)));
    if (cx < -12 || cx > W + 12) continue;
    light(pc, cx + 1.5, ry, 16, [255, 90, 20], 0.35 * pulse);
    for (let y = top; y < ry; y++) for (let dx = 0; dx < 3; dx++) {
      const v = hash(cx + dx + i * 7, Math.floor(y * 0.5 - t * 1.2));
      pc.set(cx + dx, y, shade(lavaColor(0.3 + 0.5 * v), dx === 1 ? 0.95 : 0.7));
    }
    for (let dx = -2; dx < 6; dx++) pc.set(cx + dx, ry - 1, lavaColor(0.8 + 0.2 * Math.sin(t * 0.5 + dx)));
  }

  // Mid: clusters of basalt columns.
  for (let x = 0; x < W; x++) {
    const wx = x + f2, id = Math.floor(wx / 5), clus = noise1(wx / 23, 31);
    if (clus < 0.5) continue;
    const hc = floorY * (0.12 + 0.32 * hash(id, 32)) * Math.min(1, (clus - 0.5) * 4);
    if (hc < 2) continue;
    const top = Math.floor(ry - hc), seam = mod(wx, 5) === 0, edge = mod(wx, 5) === 4;
    for (let y = Math.max(0, top); y < ry; y++) {
      const g = ((y - top) / hc) ** 2;
      let c = mix([40, 28, 30], [150, 52, 24], g * 0.65 * pulse);
      if (seam) c = shade(c, 0.5); else if (edge) c = shade(c, 0.78);
      if (y - top < 2) c = y === top ? [92, 66, 62] : [70, 50, 48];
      P[y * W + x] = c;
    }
  }

  // Lava river behind the ledge: flowing surface with drifting crust.
  const flow = t * 0.6 + scroll * 0.6;
  for (let y = ry; y < floorY; y++) {
    const r = y - ry;
    for (let x = 0; x < W; x++) {
      const wx = x + flow;
      let v = 0.5 + 0.3 * Math.sin(wx * 0.35 + r * 1.3 + t * 0.2) + 0.2 * noise1(wx / 3, 60 + r);
      if (r === 0) v = Math.min(1, v + 0.3);
      let c = shade(lavaColor(v * pulse), r === 0 ? 1 : 0.68);
      const cr = noise1(wx / 5, 40 + r);
      if (cr > 0.56 && r > 0) c = mix(c, [58, 16, 10], Math.min(0.9, (cr - 0.56) * 5));
      P[y * W + x] = c;
    }
  }
  // Near bank: a dark basalt lip in front of the river, so the feet of the
  // fighters sit against rock instead of bright lava.
  for (let x = 0; x < W; x++) {
    const wx = x + Math.floor(scroll * 0.85), bh = 2 + Math.floor(4 * noise1(wx / 6, 70) + 1.5 * hash(Math.floor(wx / 2), 71));
    for (let y = floorY - bh; y < floorY; y++) P[y * W + x] = y === floorY - bh ? mix([60, 34, 30], [200, 90, 40], 0.55 * pulse) : shade([38, 26, 28], 0.8 + 0.25 * hash(wx, y));
  }
  shimmer(pc, Math.floor(ry - floorY * 0.4), ry, t, 1);
  for (let x = 0; x < W; x++) if (hash(Math.floor((x + flow) / 2), Math.floor(t / 3)) > 0.95) blend(pc, x, ry - 1, [255, 240, 180], 0.8);

  // Near: basalt ledge with glowing cracks.
  const fh = H - floorY;
  for (let y = floorY; y < H; y++) {
    const j = y - floorY, row = Math.floor(j / 3), off = row % 2 ? 4 : 0, dep = j / (fh + 1);
    for (let x = 0; x < W; x++) {
      const wx = x + nr + off, tx = Math.floor(wx / 8), hv = hash(tx, row + 300);
      let c;
      if (j === 0) c = [150, 76, 48];
      else if (j === 1) c = [84, 52, 46];
      else if ((wx % 8 === 0 || j % 3 === 0) && hash(tx * 3 + (wx % 8 === 0 ? 1 : 0), row + 900) > 0.35) c = mix([40, 14, 10], [255, 110, 30], (0.35 + 0.3 * Math.sin(t * 0.12 + hv * 6)) * (1 - dep * 0.7) * pulse);
      else if (wx % 8 === 0 || j % 3 === 0) c = shade([30, 22, 24], 1 - dep * 0.5);
      else c = shade([54, 40, 42], (0.75 + 0.35 * hv) * (1 - dep * 0.55));
      P[y * W + x] = c;
    }
  }
  // Near: small lava pools set into the ledge.
  for (let i = Math.floor(nr / 71) - 1; i <= Math.floor((nr + W) / 71) + 1; i++) {
    if (hash(i, 81) < 0.45) continue;
    const cx = i * 71 + Math.floor(hash(i, 82) * 40) - nr, cy = floorY + fh * 0.6, rx = 4 + Math.floor(hash(i, 83) * 4);
    if (cx < -rx - 10 || cx > W + rx + 10) continue;
    for (let y = Math.floor(cy - 2); y <= Math.ceil(cy + 2); y++) for (let x = cx - rx - 1; x <= cx + rx + 1; x++) {
      const e = ((x - cx) / rx) ** 2 + ((y - cy) / 1.8) ** 2;
      if (e < 1) pc.set(x, y, lavaColor((0.55 + 0.35 * Math.sin(x * 0.7 + t * 0.3) + (y < cy ? 0.1 : 0)) * pulse));
      else if (e < 1.6) pc.set(x, y, [120, 44, 22]);
    }
    light(pc, cx, cy - 1, rx + 5, [255, 100, 30], 0.28 * pulse);
  }

  // Embers rising off the lava.
  const embers = pool(key, 'embers');
  while (embers.length < W / 4) embers.push({ life: 0, max: 1 });
  for (const e of embers) {
    if (e.life <= 0) {
      e.x = Math.random() * W; e.y = ry + Math.random() * rh; e.vy = -(0.25 + Math.random() * 0.55);
      e.ph = Math.random() * 6.3; e.max = e.life = 25 + Math.floor(Math.random() * 45); e.big = Math.random() < 0.15;
    }
    e.life--; e.y += e.vy; e.x += Math.sin(t * 0.2 + e.ph) * 0.25;
    const f = e.life / e.max, c = f > 0.6 ? [255, 220, 120] : f > 0.3 ? [255, 130, 40] : [190, 50, 20];
    if (e.y < 0) { e.life = 0; continue; }
    add(pc, e.x, e.y, c, 0.5 + 0.5 * f);
    if (e.big) add(pc, e.x, e.y + 1, c, 0.3 * f);
  }
}

// ---------- castle throne hall ----------

const CASTLE_WALL = [[0, [12, 10, 20]], [0.5, [36, 32, 50]], [1, [52, 46, 66]]];
const PANES = [[200, 44, 64], [52, 84, 206], [236, 186, 64], [56, 160, 96], [150, 70, 190], [60, 170, 200]];
const CREST = ['..Y..', 'Y.Y.Y', 'YYYYY', '.YYY.', '..Y..'];

function castle(pc, floorY, scroll, t, key) {
  const W = pc.w, H = pc.h, P = pc.px;
  const f1 = Math.floor(scroll * 0.3), f2 = Math.floor(scroll * 0.6), nr = scroll;
  const WS = 64, hw = 5, wy0 = Math.floor(floorY * 0.14), wy1 = Math.floor(floorY * 0.6), archH = hw * 2;
  const panel = floorY - Math.max(4, Math.floor(floorY * 0.16));
  const pane = (id, cx, cy) => PANES[Math.floor(hash(id * 7 + cx, cy + 40) * PANES.length)];

  // Far: ashlar wall, cornice, wooden wainscot.
  const wall = fillRows(pc, 0, floorY, (y) => gradient(CASTLE_WALL, y / floorY));
  for (let y = 0; y < floorY; y++) {
    const c0 = wall[y];
    if (y >= panel) {
      for (let x = 0; x < W; x++) {
        const wx = x + f1;
        P[y * W + x] = y === panel ? [96, 70, 52] : y === panel + 1 ? [60, 42, 34] : shade([56, 38, 34], wx % 9 === 0 ? 0.6 : wx % 9 === 1 ? 1.15 : 0.9 + 0.1 * hash(Math.floor(wx / 9), 7));
      }
      continue;
    }
    const row = Math.floor(y / 5), off = row % 2 ? 6 : 0;
    for (let x = 0; x < W; x++) {
      const wx = x + f1 + off;
      P[y * W + x] = y % 5 === 4 || wx % 12 === 0 ? shade(c0, 0.62) : shade(c0, 0.88 + 0.22 * hash(Math.floor(wx / 12), row));
    }
  }
  const corn = Math.max(1, wy0 - 3);
  for (let x = 0; x < W; x++) { pc.set(x, corn, [74, 68, 90]); pc.set(x, corn + 1, (x + f1) % 3 ? [50, 46, 62] : [30, 26, 38]); }

  // Far: tall stained-glass lancet windows.
  const winAt = (sx) => { const w = sx + f1, id = Math.floor(w / WS); return [id, w - id * WS - 32]; };
  const glow = 0.85 + 0.15 * Math.sin(t * 0.05);
  for (let i = Math.floor(f1 / WS) - 1; i <= Math.floor((f1 + W) / WS) + 1; i++) {
    const cx = i * WS + 32 - f1;
    if (cx < -hw - 3 || cx > W + hw + 3) continue;
    for (let y = wy0 - 1; y <= wy1 + 1; y++) {
      const yy = y - wy0, half = yy < archH ? hw * Math.sqrt(Math.max(0, yy / archH)) : hw;
      for (let dx = -hw - 1; dx <= hw + 1; dx++) {
        const x = cx + dx;
        if (x < 0 || x >= W) continue;
        const ad = Math.abs(dx);
        if (y >= wy0 && y <= wy1 && ad <= half) {
          const lead = mod(dx + hw, 3) === 0 || yy % 4 === 0;
          P[y * W + x] = lead ? [26, 22, 32] : shade(pane(i, Math.floor((dx + hw) / 3), Math.floor(yy / 4)), glow * (0.8 + 0.2 * (1 - yy / (wy1 - wy0))));
        } else if (y >= wy0 - 1 && y <= wy1 + 1 && ad <= half + 1.5) P[y * W + x] = [92, 86, 108];
      }
    }
    for (let dx = -hw - 2; dx <= hw + 2; dx++) pc.set(cx + dx, wy1 + 2, [110, 102, 126]);
  }

  // Mid: pillars with banners and candle sconces.
  const capY = Math.floor(floorY * 0.12), bl = Math.max(8, Math.floor(floorY * 0.36)), sconceY = Math.floor(floorY * 0.62);
  const SH = [0.45, 0.62, 0.82, 0.96, 1.0, 0.9, 0.72, 0.5];
  for (let i = Math.floor(f2 / WS) - 1; i <= Math.floor((f2 + W) / WS) + 1; i++) {
    const cx = i * WS - f2;
    if (cx < -10 || cx > W + 10) continue;
    for (let y = 0; y < floorY; y++) {
      const cap = y >= capY && y < capY + 3, base = y >= floorY - 3;
      const hwp = cap ? 6 : base ? 5 : 4;
      for (let dx = -hwp; dx < hwp; dx++) {
        const s = SH[Math.min(7, Math.floor((dx + hwp) / (2 * hwp) * 8))] * (0.5 + 0.5 * (y / floorY));
        let c = shade(cap || base ? [112, 106, 128] : [92, 88, 108], s);
        if (!cap && !base && (dx === -2 || dx === 1)) c = shade(c, 0.86);
        if ((cap && y === capY + 2) || (base && y === floorY - 3)) c = shade(c, 0.7);
        pc.set(cx + dx, y, c);
      }
    }
    // Banner: rod, swaying cloth, gold trim, crest, swallowtail.
    const by = capY + 4, red = mod(i, 2) === 0, cloth = red ? [150, 26, 42] : [36, 52, 136], gold = [222, 172, 62];
    for (let dx = -5; dx <= 5; dx++) pc.set(cx + dx, by - 1, [124, 92, 44]);
    for (let r = 0; r < bl; r++) {
      const sw = Math.round(Math.sin(t * 0.12 + i * 1.3 + r * 0.08) * (r / bl) * 1.6);
      const fold = 0.82 + 0.18 * Math.sin(r * 0.5 - t * 0.2);
      for (let dx = -3; dx <= 3; dx++) {
        if (r >= bl - 3 && Math.abs(dx) <= r - (bl - 3)) continue;
        const edge = Math.abs(dx) === 3 || r === 0;
        pc.set(cx + dx + sw, by + r, edge ? shade(gold, fold) : shade(cloth, fold * (dx < 0 ? 1.05 : 0.92)));
      }
      const cr = r - 3;
      if (cr >= 0 && cr < CREST.length) for (let k = 0; k < 5; k++) if (CREST[cr][k] === 'Y') pc.set(cx - 2 + k + sw, by + r, shade(gold, fold));
    }
    // Sconce with a flickering candle.
    const fl = 0.8 + 0.2 * Math.sin(t * 0.9 + i) * Math.sin(t * 0.33 + i * 2);
    light(pc, cx, sconceY - 4, 13, [255, 170, 80], 0.45 * fl);
    for (let dx = -2; dx <= 2; dx++) pc.set(cx + dx, sconceY, [150, 112, 48]);
    pc.set(cx, sconceY + 1, [110, 80, 36]);
    for (let k = 1; k <= 3; k++) pc.set(cx, sconceY - k, [236, 226, 206]);
    pc.set(cx, sconceY - 4, [255, 214, 110]);
    if ((t + i) % 5 < 3) pc.set(cx, sconceY - 5, [255, 244, 190]);
  }

  // Light shafts from the windows, striped by pane color, down to the floor.
  const k = 0.55, wyc = Math.floor((wy0 + wy1) / 2), br = 0.17 * glow;
  for (let y = wyc; y < H; y++) {
    const along = (y - wyc) / (H - wyc), a = br * (y >= floorY ? 1.4 : 1) * (1 - along * 0.55);
    for (let x = 0; x < W; x++) {
      const sx = x - (y - wyc) * k, [id, dx] = winAt(Math.round(sx));
      if (Math.abs(dx) > hw - 1 || (y <= wy1 + 1 && Math.abs(x - (id * WS + 32 - f1)) <= hw + 1)) continue;
      const c = pane(id, Math.floor((dx + hw) / 3), 99), i = y * W + x, p = P[i];
      P[i] = [clamp(p[0] + c[0] * a), clamp(p[1] + c[1] * a), clamp(p[2] + c[2] * a)];
    }
  }

  // Near: checkered marble floor in perspective.
  for (let y = floorY; y < H; y++) {
    const j = y - floorY, s = (1 + j * 0.14) * 7, rowIdx = Math.floor(Math.sqrt(j * 2.4));
    const dep = j / (H - floorY);
    for (let x = 0; x < W; x++) {
      const u = (x - W / 2) / s + nr / 7, tu = Math.floor(u), i = y * W + x, p = P[i];
      let c;
      if (j === 0) c = [128, 118, 140];
      else {
        const dark = (tu + rowIdx) % 2 !== 0;
        c = dark ? shade([40, 36, 54], 0.9 + 0.2 * hash(tu, rowIdx)) : shade([150, 144, 162], 0.88 + 0.12 * hash(tu, rowIdx));
        if (!dark && Math.abs(Math.sin(u * 2.3 + rowIdx * 1.7 + (x + nr) * 0.05)) < 0.08) c = shade(c, 0.82);
        c = shade(c, 0.8 + 0.2 * dep);
      }
      // Keep the shaft colors (already added above) as reflections on the marble.
      P[i] = j > 0 ? mix(c, p, 0.35) : c;
    }
  }

  // Dust motes glittering in the light.
  const motes = pool(key, 'motes');
  while (motes.length < W / 5) motes.push({ x: Math.random() * W, y: Math.random() * floorY, v: 0.02 + Math.random() * 0.06, ph: Math.random() * 6.3 });
  for (const m of motes) {
    m.y += m.v; m.x += Math.sin(t * 0.05 + m.ph) * 0.05;
    if (m.y >= floorY) { m.y = 0; m.x = Math.random() * W; }
    const [, dx] = winAt(Math.round(m.x - (m.y - wyc) * k));
    const lit = m.y > wyc && Math.abs(dx) <= hw - 1;
    blend(pc, m.x, m.y, [255, 240, 200], lit ? 0.75 : 0.15);
  }
}

// ---------- space ----------

const SECTORS = [
  { sky: [[5, 5, 18], [28, 12, 52]], neb: [[120, 40, 170], [30, 90, 170]], planet: [[240, 160, 90], [190, 90, 60]], ring: [220, 200, 170], belt: 0.35, accent: [0, 210, 255] },
  { sky: [[3, 10, 16], [8, 34, 42]], neb: [[30, 160, 140], [40, 90, 190]], planet: [[160, 220, 245], [60, 110, 190]], moon: true, belt: 0.55, accent: [60, 255, 200] },
  { sky: [[14, 4, 8], [46, 14, 20]], neb: [[200, 60, 40], [220, 140, 40]], planet: [[170, 110, 100], [90, 50, 50]], craters: true, belt: 0.85, accent: [255, 140, 60] },
  { sky: [[10, 4, 20], [38, 10, 44]], neb: [[210, 50, 160], [240, 190, 80]], planet: [[236, 204, 150], [170, 110, 70]], bands: true, ring: [200, 170, 220], belt: 0.45, accent: [255, 90, 200] },
];

// Nebula clouds are costly noise, so cache them per size and sector.
const NEB = { key: '', a: null, b: null, pw: 0 };
function nebula(W, H, sector) {
  const key = `${W}x${H}:${sector}`;
  if (NEB.key === key) return NEB;
  const cells = Math.ceil((W * 2) / 12), pw = cells * 12;
  const a = new Float32Array(pw * H), b = new Float32Array(pw * H);
  for (let y = 0; y < H; y++) for (let x = 0; x < pw; x++) {
    const n1 = 0.65 * noise2(x / 12, y / 12, 3 + sector, cells) + 0.35 * noise2(x / 6, y / 6, 7 + sector, cells * 2);
    const n2 = 0.65 * noise2(x / 16, y / 10, 11 + sector, Math.ceil(pw / 16)) + 0.35 * noise2(x / 5, y / 5, 13 + sector, Math.ceil(pw / 5));
    a[y * pw + x] = Math.max(0, n1 - 0.42) * 2.2;
    b[y * pw + x] = Math.max(0, n2 - 0.5) * 2.4;
  }
  Object.assign(NEB, { key, a, b, pw });
  return NEB;
}

function space(pc, floorY, scroll, t, key, lvl) {
  const W = pc.w, H = pc.h, P = pc.px;
  const sector = Math.max(0, BIOMES.indexOf(biomeFor(lvl))), S = SECTORS[sector];
  const neb = nebula(W, H, sector), noff = Math.floor(t * 0.03 + scroll * 0.1);
  const [na, nb] = S.neb;

  // Far: sky, nebula, two star layers.
  for (let y = 0; y < floorY; y++) {
    const base = mix(S.sky[0], S.sky[1], y / H);
    for (let x = 0; x < W; x++) {
      const ni = y * neb.pw + mod(x + noff, neb.pw), ia = neb.a[ni] * 0.55, ib = neb.b[ni] * 0.4;
      let c = [clamp(base[0] + na[0] * ia + nb[0] * ib), clamp(base[1] + na[1] * ia + nb[1] * ib), clamp(base[2] + na[2] * ia + nb[2] * ib)];
      const s1 = hash(x + Math.floor(t * 0.2 + scroll * 0.2), y), s2 = hash(x + Math.floor(t * 0.6 + scroll * 0.5) + 999, y);
      if (s1 > 0.994) c = mix(c, [255, 255, 255], 0.5 + 0.4 * Math.sin(t * 0.3 + x));
      else if (s2 > 0.99) c = mix(c, [140, 160, 255], 0.55);
      P[y * W + x] = c;
    }
  }
  // A few bright twinkling stars with cross flares.
  for (let i = 0; i < 4; i++) {
    const x = Math.floor(mod(hash(i, 71 + sector) * W * 1.5 - t * 0.1, W)), y = Math.floor(hash(i, 72 + sector) * floorY * 0.7);
    const b = 0.6 + 0.4 * Math.sin(t * 0.25 + i * 2);
    blend(pc, x, y, [255, 255, 255], b);
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) blend(pc, x + dx, y + dy, [200, 210, 255], b * 0.45);
  }

  // Planet (very far) with sector features.
  const px = Math.round(W * 0.84 - scroll * 0.05), py = Math.round(floorY * 0.3), pr = Math.max(5, Math.round(H * 0.13));
  light(pc, px, py, pr * 2, S.planet[0], 0.12);
  for (let y = -pr; y <= pr; y++) for (let x = -pr; x <= pr; x++) {
    const d2 = x * x + y * y;
    if (d2 >= pr * pr) continue;
    let c = mix(S.planet[0], S.planet[1], (y + pr) / (2 * pr));
    if (S.bands) c = shade(c, 0.82 + 0.18 * Math.sin(y * 1.3 + Math.sin(x * 0.3 + t * 0.02) * 1.5));
    if (S.craters && hash(Math.floor((x + pr) / 3), Math.floor((y + pr) / 3) + 5) > 0.8) c = shade(c, 0.75);
    const lit = 0.35 + 0.75 * Math.max(0, (-x - y) / (pr * 1.5) + 0.45);
    pc.set(px + x, py + y, shade(c, d2 > (pr - 1) * (pr - 1) ? lit * 1.15 : lit));
  }
  if (S.ring) {
    for (let a = 0; a < 240; a++) {
      const ang = a / 240 * 6.283, rx = Math.cos(ang) * pr * 1.8, ry = Math.sin(ang) * pr * 0.35;
      if (ry > 0 || rx * rx + ry * ry * 9 > pr * pr) pc.set(px + rx, py + ry, shade(S.ring, 0.75 + 0.25 * Math.cos(ang)));
    }
  }
  if (S.moon) {
    const ang = t * 0.01, mx = px + Math.cos(ang) * pr * 2.2, my = py + Math.sin(ang) * pr * 0.6;
    if (Math.sin(ang) > 0 || Math.abs(Math.cos(ang)) * pr * 2.2 > pr + 2) {
      for (let y = -2; y <= 2; y++) for (let x = -2; x <= 2; x++) if (x * x + y * y <= 5) pc.set(mx + x, my + y, shade([200, 200, 210], 0.6 + 0.12 * (-x - y)));
    }
  }

  // Mid: asteroid belt drifting across the upper sky.
  const aoff = t * 0.35 + scroll * 0.6, sp = 9;
  for (let i = Math.floor(aoff / sp) - 1; i <= Math.floor((aoff + W) / sp) + 1; i++) {
    if (hash(i, 91 + sector) > S.belt) continue;
    const x = i * sp + hash(i, 92) * sp - aoff, y = floorY * (0.18 + 0.12 * Math.sin(i * 0.21) + 0.14 * hash(i, 93));
    const r = 0.8 + hash(i, 94) * (1.2 + S.belt * 1.6), spin = t * 0.02 * (hash(i, 95) - 0.5);
    for (let dy = -Math.ceil(r); dy <= Math.ceil(r); dy++) for (let dx = -Math.ceil(r); dx <= Math.ceil(r); dx++) {
      const bump = 0.75 + 0.5 * hash(i * 13 + Math.round(Math.atan2(dy, dx) * 2 + spin), 96);
      if (dx * dx + dy * dy * 1.3 > r * r * bump) continue;
      const l = 0.55 + 0.25 * ((dx - dy) / (r + 0.5));
      pc.set(x + dx, y + dy, shade([150, 136, 124], l * (0.8 + 0.3 * hash(i, dx * 7 + dy))));
    }
  }
  // Belt dust haze.
  for (let x = 0; x < W; x++) {
    const y = Math.round(floorY * (0.25 + 0.12 * Math.sin((x + aoff) / sp * 0.21)));
    if (hash(Math.floor(x + aoff), 97) > 0.7) blend(pc, x, y + Math.floor(hash(Math.floor(x + aoff), 98) * 6) - 3, [180, 170, 160], 0.3);
  }

  // Shooting star.
  const sx = (t * 5) % (W * 3) - W, sy = (t * 2) % (H * 3) - H;
  if (sx > 0 && sx < W && sy > 0 && sy < floorY) for (let k = 0; k < 8; k++) pc.set(sx - k * 2.5, sy - k, X.shade([255, 255, 255], 1 - k * 0.12));

  // Near: metal deck with a running light strip.
  for (let y = floorY; y < H; y++) for (let x = 0; x < W; x++) {
    let c = X.shade([64, 70, 92], 1 - (y - floorY) / (H - floorY + 1) * 0.55);
    if (y === floorY) c = [140, 150, 180];
    if ((x + scroll) % 24 === 0) c = X.shade(c, 0.7);
    if (y === floorY + 2 && (x + scroll) % 12 < 6) c = X.mix(S.accent, c, 0.25 + 0.3 * Math.sin(t * 0.4 + x * 0.05));
    P[y * W + x] = c;
  }
}

// ---------- entry ----------

const BIOME_DRAW = { dungeon, forest, lava, castle };

function drawBackground(pc, th, floorY, scroll, t) {
  const d = ui.frameData || {};
  const lvl = d.lvl || 1;
  const biome = th === 'space' ? 'space' : biomeFor(lvl);
  const key = `${biome}:${pc.w}x${pc.h}:${floorY}`;
  if (biome === 'space') space(pc, floorY, scroll, t, key, lvl);
  else (BIOME_DRAW[biome] || dungeon)(pc, floorY, scroll, t, key);
  // Retro is squashed to five green levels later (scene.js). Dim the backdrop
  // so it sits in the lowest levels (sky vs. trees, lava vs. rock still
  // differ) and the characters keep the bright ones.
  if (th === 'retro') pc.px = pc.px.map((c) => { const l = (c[0] * 0.3 + c[1] * 0.59 + c[2] * 0.11) * 0.55; return shade(c, l > 95 ? 0.55 * 95 / l : 0.55); });
}

module.exports = { drawBackground };
