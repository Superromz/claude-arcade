// Procedural effect textures, painted once with Canvas2D and uploaded to the
// renderer: soft glow, ring, soft line, beam, spark, smoke, flame frames,
// lava and lavafall strips, a rain streak and a coin.

import { noise2, fbm, rng } from './util.js';

const cv = (w, h) => { const c = document.createElement('canvas'); c.width = w; c.height = h; return c; };

function glow() {
  const c = cv(64, 64), x = c.getContext('2d');
  const g = x.createRadialGradient(32, 32, 0, 32, 32, 32);
  for (let i = 0; i <= 10; i++) { const k = i / 10; g.addColorStop(k, `rgba(255,255,255,${Math.exp(-k * k * 4.5) * (1 - k)})`); }
  x.fillStyle = g; x.fillRect(0, 0, 64, 64);
  return c;
}
function core() { // tighter hot core
  const c = cv(32, 32), x = c.getContext('2d');
  const g = x.createRadialGradient(16, 16, 0, 16, 16, 16);
  g.addColorStop(0, 'rgba(255,255,255,1)'); g.addColorStop(0.25, 'rgba(255,255,255,0.8)'); g.addColorStop(0.6, 'rgba(255,255,255,0.15)'); g.addColorStop(1, 'rgba(255,255,255,0)');
  x.fillStyle = g; x.fillRect(0, 0, 32, 32);
  return c;
}
function ring() {
  const c = cv(128, 128), x = c.getContext('2d');
  const g = x.createRadialGradient(64, 64, 40, 64, 64, 64);
  g.addColorStop(0, 'rgba(255,255,255,0)'); g.addColorStop(0.55, 'rgba(255,255,255,0.25)'); g.addColorStop(0.8, 'rgba(255,255,255,1)'); g.addColorStop(0.9, 'rgba(255,255,255,0.5)'); g.addColorStop(1, 'rgba(255,255,255,0)');
  x.fillStyle = g; x.fillRect(0, 0, 128, 128);
  return c;
}
function line() { // soft across its width (v), flat along (u)
  const c = cv(4, 32), x = c.getContext('2d');
  const g = x.createLinearGradient(0, 0, 0, 32);
  g.addColorStop(0, 'rgba(255,255,255,0)'); g.addColorStop(0.35, 'rgba(255,255,255,0.35)'); g.addColorStop(0.5, 'rgba(255,255,255,1)'); g.addColorStop(0.65, 'rgba(255,255,255,0.35)'); g.addColorStop(1, 'rgba(255,255,255,0)');
  x.fillStyle = g; x.fillRect(0, 0, 4, 32);
  return c;
}
function beam() { // bright at the top, fading down; soft sides
  const c = cv(64, 128), x = c.getContext('2d');
  for (let i = 0; i < 64; i++) {
    const k = Math.abs(i - 31.5) / 32, side = Math.exp(-k * k * 5);
    const g = x.createLinearGradient(0, 0, 0, 128);
    g.addColorStop(0, `rgba(255,255,255,${side * 0.9})`); g.addColorStop(0.6, `rgba(255,255,255,${side * 0.45})`); g.addColorStop(1, 'rgba(255,255,255,0)');
    x.fillStyle = g; x.fillRect(i, 0, 1, 128);
  }
  return c;
}
function shaft() { // a light shaft: soft sides, even along its length, fading at the far end
  const c = cv(32, 128), x = c.getContext('2d');
  for (let i = 0; i < 32; i++) {
    const k = Math.abs(i - 15.5) / 16, side = Math.max(0, 1 - k * k) ** 1.5;
    const g = x.createLinearGradient(0, 0, 0, 128);
    g.addColorStop(0, `rgba(255,255,255,${side * 0.2})`); g.addColorStop(0.15, `rgba(255,255,255,${side})`); g.addColorStop(0.75, `rgba(255,255,255,${side * 0.6})`); g.addColorStop(1, 'rgba(255,255,255,0)');
    x.fillStyle = g; x.fillRect(i, 0, 1, 128);
  }
  return c;
}
function spark() {
  const c = cv(32, 32), x = c.getContext('2d');
  x.translate(16, 16);
  for (const [w, h, a] of [[1.6, 15, 1], [15, 1.6, 1], [1, 9, 0.6]]) {
    const g = x.createRadialGradient(0, 0, 0, 0, 0, Math.max(w, h));
    g.addColorStop(0, `rgba(255,255,255,${a})`); g.addColorStop(1, 'rgba(255,255,255,0)');
    x.fillStyle = g; x.beginPath(); x.ellipse(0, 0, w, h, 0, 0, Math.PI * 2); x.fill();
  }
  const g = x.createRadialGradient(0, 0, 0, 0, 0, 5);
  g.addColorStop(0, 'rgba(255,255,255,1)'); g.addColorStop(1, 'rgba(255,255,255,0)');
  x.fillStyle = g; x.fillRect(-6, -6, 12, 12);
  return c;
}
function smoke() {
  const c = cv(64, 64), x = c.getContext('2d'), img = x.createImageData(64, 64);
  for (let j = 0; j < 64; j++) for (let i = 0; i < 64; i++) {
    const dx = (i - 32) / 32, dy = (j - 32) / 32, d = Math.sqrt(dx * dx + dy * dy);
    const n = fbm(i / 14, j / 14, 5, 3);
    const a = Math.max(0, 1 - d * (1.1 - n * 0.5)) ** 1.6;
    const o = (j * 64 + i) * 4;
    img.data[o] = img.data[o + 1] = img.data[o + 2] = 255; img.data[o + 3] = a * 255;
  }
  x.putImageData(img, 0, 0);
  return c;
}
function pixel() { const c = cv(2, 2), x = c.getContext('2d'); x.fillStyle = '#fff'; x.fillRect(0, 0, 2, 2); return c; }

// Flame frames: a teardrop of layered heat, distorted by scrolling noise.
// White texture with baked color (drawn additively).
function flames(n = 12) {
  const FW = 32, FH = 48, c = cv(FW * n, FH), x = c.getContext('2d');
  const img = x.createImageData(FW * n, FH);
  for (let f = 0; f < n; f++) for (let j = 0; j < FH; j++) for (let i = 0; i < FW; i++) {
    const u = (i - FW / 2 + 0.5) / (FW / 2), v = j / FH; // v: 0 top, 1 bottom
    const up = 1 - v;
    const wob = (noise2(i / 6, (j + f * 5) / 5, 3, 1e6) - 0.5) * 0.5 * up;
    const width = Math.sin(Math.min(1, v * 1.25) * Math.PI * 0.62) * (0.35 + 0.65 * v) + 0.02;
    const d = Math.abs(u + wob) / Math.max(0.05, width);
    const n2 = noise2(i / 4, (j + f * 9) / 4, 7, 1e6);
    let heat = Math.max(0, 1 - d) * (0.55 + 0.45 * v) * (0.75 + 0.5 * n2);
    if (v < 0.12) heat *= v / 0.12;
    const o = (j * FW * n + f * FW + i) * 4;
    const t = Math.min(1, heat * 1.6);
    // black-body-ish ramp: red -> orange -> yellow -> white
    const r = Math.min(255, 255 * Math.min(1, t * 2.2));
    const g = Math.min(255, 255 * Math.max(0, t * 1.7 - 0.45));
    const b = Math.min(255, 255 * Math.max(0, t * 2 - 1.35));
    img.data[o] = r; img.data[o + 1] = g; img.data[o + 2] = b; img.data[o + 3] = Math.min(255, heat * 400);
  }
  x.putImageData(img, 0, 0);
  return { canvas: c, frames: n, fw: FW, fh: FH };
}

// A tileable strip of flowing lava (u wraps), baked color.
function lava(w = 256, h = 32) {
  const c = cv(w, h), x = c.getContext('2d'), img = x.createImageData(w, h);
  for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) {
    const n = fbm(i / 18, j / 7, 11, 4, w / 18);
    const crust = fbm(i / 9 + 50, j / 5, 13, 3, w / 9);
    let t = 0.35 + n * 0.9 - Math.max(0, crust - 0.55) * 2.2;
    t = Math.max(0, Math.min(1.2, t));
    const o = (j * w + i) * 4;
    const edge = Math.min(1, Math.min(j, h - 1 - j) / 3);
    img.data[o] = Math.min(255, 90 + 200 * t);
    img.data[o + 1] = Math.min(255, 20 + 200 * Math.max(0, t - 0.35));
    img.data[o + 2] = Math.min(255, 10 + 160 * Math.max(0, t - 0.85));
    img.data[o + 3] = 255 * (0.35 + 0.65 * edge);
  }
  x.putImageData(img, 0, 0);
  return c;
}
function lavafall(w = 16, h = 128) {
  const c = cv(w, h), x = c.getContext('2d'), img = x.createImageData(w, h);
  for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) {
    const u = (i - w / 2 + 0.5) / (w / 2);
    const n = fbm(i / 3, j / 14, 21, 3, 1e6);
    const side = Math.max(0, 1 - u * u);
    const t = side * (0.55 + 0.7 * n);
    const o = (j * w + i) * 4;
    img.data[o] = 255; img.data[o + 1] = Math.min(255, 60 + 200 * Math.max(0, t - 0.3)); img.data[o + 2] = Math.min(255, 30 + 200 * Math.max(0, t - 0.8));
    img.data[o + 3] = Math.min(255, t * 300);
  }
  x.putImageData(img, 0, 0);
  // make it tile vertically by cross-fading the ends
  return c;
}
function rain() {
  const c = cv(4, 32), x = c.getContext('2d');
  const g = x.createLinearGradient(0, 0, 0, 32);
  g.addColorStop(0, 'rgba(255,255,255,0)'); g.addColorStop(1, 'rgba(255,255,255,0.9)');
  x.fillStyle = g; x.fillRect(1, 0, 2, 32);
  return c;
}
// Gold coin, 6 frames of a spin, pixel art.
function coin() {
  const rows = [
    ['..KKKK..', '.KYYYyK.', 'KYWYYYyK', 'KYYYYYyK', 'KYYYYYyK', 'KyYYYyyK', '.KyyyyK.', '..KKKK..'],
    ['...KK...', '..KYyK..', '.KWYYyK.', '.KYYYyK.', '.KYYYyK.', '.KyYyyK.', '..KyyK..', '...KK...'],
    ['...KK...', '...KK...', '...WK...', '...YK...', '...YK...', '...yK...', '...KK...', '...KK...'],
  ];
  const pal = { K: [120, 70, 10], Y: [255, 214, 70], y: [214, 150, 30], W: [255, 250, 210] };
  const c = cv(8 * 4, 8), x = c.getContext('2d');
  [0, 1, 2, 1].forEach((f, k) => rows[f].forEach((r, j) => { for (let i = 0; i < 8; i++) { const p = pal[r[i]]; if (!p) continue; x.fillStyle = `rgb(${p})`; x.fillRect(k * 8 + i, j, 1, 1); } }));
  return c;
}
function gem() {
  const c = cv(16, 16), x = c.getContext('2d');
  x.fillStyle = '#fff';
  x.beginPath(); x.moveTo(8, 1); x.lineTo(15, 7); x.lineTo(8, 15); x.lineTo(1, 7); x.closePath(); x.fill();
  x.fillStyle = 'rgba(0,0,0,0.25)'; x.beginPath(); x.moveTo(8, 7); x.lineTo(15, 7); x.lineTo(8, 15); x.closePath(); x.fill();
  x.fillStyle = 'rgba(255,255,255,1)'; x.fillRect(5, 4, 2, 2);
  return c;
}

export function makeFxTextures(r) {
  const nearest = { filter: 'nearest' };
  const fl = flames();
  const T = {
    glow: r.texture(glow()), core: r.texture(core()), ring: r.texture(ring()), line: r.texture(line()), beam: r.texture(beam()), shaft: r.texture(shaft()),
    spark: r.texture(spark()), smoke: r.texture(smoke()), pixel: r.texture(pixel(), nearest), flames: r.texture(fl.canvas), lava: r.texture(lava(), { wrap: 'repeat' }),
    lavafall: r.texture(lavafall(), { wrap: 'repeat' }), rain: r.texture(rain()), coin: r.texture(coin(), nearest), gem: r.texture(gem()),
  };
  T.flameInfo = fl;
  return T;
}

export { rng };
