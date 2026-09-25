// Biome backdrops painted at full resolution: each biome is a stack of
// tileable parallax layers (Canvas2D gradients and procedural shapes, painted
// once per size) plus animated pieces drawn every frame (torch flames, god
// rays, the lava river and lavafalls, stained-glass light shafts, twinkling
// stars, rain, embers, fireflies) and the lights they cast.

import { rng, fbm, noise2, mix, shade, rgb, hash } from './util.js';

export const TW = 640; // tile width in logical px (layers wrap every TW)
const H = 180;

function tile(K, h = H) {
  const c = document.createElement('canvas');
  c.width = Math.round(TW * K); c.height = Math.round(h * K);
  const x = c.getContext('2d');
  x.scale(K, K);
  return { c, x };
}
// Draw fn at x, and again one tile over when the shape crosses an edge.
function wrap(x0, w, fn) { fn(x0); if (x0 < w) fn(x0 + TW); if (x0 + w > TW) fn(x0 - TW); }
const vgrad = (x, y0, y1, stops) => { const g = x.createLinearGradient(0, y0, 0, y1); for (const [k, c, a] of stops) g.addColorStop(k, rgb(c, a ?? 1)); return g; };
const hgrad = (x, x0, x1, stops) => { const g = x.createLinearGradient(x0, 0, x1, 0); for (const [k, c, a] of stops) g.addColorStop(k, rgb(c, a ?? 1)); return g; };
function rrect(x, a, b, w, h, r) { x.beginPath(); x.roundRect ? x.roundRect(a, b, w, h, r) : x.rect(a, b, w, h); }
// Soft value-noise texture over a rect, painted at low resolution.
function noiseFill(x, K, x0, y0, w, h, colorAt, res = 2) {
  const cw = Math.ceil(w / res), ch = Math.ceil(h / res);
  const c = document.createElement('canvas'); c.width = cw; c.height = ch;
  const cx = c.getContext('2d'), img = cx.createImageData(cw, ch);
  for (let j = 0; j < ch; j++) for (let i = 0; i < cw; i++) {
    const [r, g, b, a] = colorAt(x0 + i * res, y0 + j * res);
    const o = (j * cw + i) * 4; img.data[o] = r; img.data[o + 1] = g; img.data[o + 2] = b; img.data[o + 3] = a;
  }
  cx.putImageData(img, 0, 0);
  x.imageSmoothingEnabled = true;
  x.drawImage(c, x0, y0, w, h);
}

// ---------- dungeon ----------

function dungeon(r, K, floorY) {
  const R = rng(11);
  // Far: brick wall, alcoves.
  const wall = tile(K);
  {
    const x = wall.x;
    x.fillStyle = vgrad(x, 0, floorY, [[0, [6, 5, 10]], [0.45, [20, 18, 28]], [1, [30, 27, 38]]]);
    x.fillRect(0, 0, TW, floorY + 4);
    for (let row = 0, y = 2; y < floorY; row++, y += 8) {
      let bx = row % 2 ? -8 : 0;
      while (bx < TW) {
        const w = 13 + Math.floor(R() * 8), v = 0.75 + R() * 0.35;
        const base = mix([48, 44, 60], [62, 56, 70], R());
        const c = shade(base, v * (0.55 + 0.45 * (y / floorY)));
        const bw = Math.min(w - 1, TW - bx);
        if (bw > 1) {
          wrap(bx, bw, (px) => {
            rrect(x, px + 0.3, y + 0.3, bw - 0.6, 7.2, 1.2);
            x.fillStyle = vgrad(x, y, y + 8, [[0, mix(c, [255, 255, 255], 0.08)], [0.5, c], [1, shade(c, 0.7)]]);
            x.fill();
            x.fillStyle = rgb([255, 240, 220], 0.05); x.fillRect(px + 1, y + 0.6, bw - 2.5, 0.6);
            if (R() < 0.18) { x.fillStyle = rgb([70, 110, 60], 0.28 + R() * 0.2); x.beginPath(); x.ellipse(px + R() * bw, y + 6, 3 + R() * 4, 1.5 + R() * 1.5, 0, 0, Math.PI * 2); x.fill(); }
            if (R() < 0.08) { x.strokeStyle = rgb([10, 8, 14], 0.7); x.lineWidth = 0.4; x.beginPath(); let cx = px + R() * bw, cy = y + 1; x.moveTo(cx, cy); for (let k = 0; k < 3; k++) { cx += (R() - 0.5) * 4; cy += 2; x.lineTo(cx, cy); } x.stroke(); }
          });
        }
        bx += w;
      }
    }
    // alcoves with bars
    for (const ax of [96, 416]) {
      const aw = 36, top = floorY - 78, bottom = floorY - 6;
      x.save();
      x.beginPath(); x.moveTo(ax, bottom); x.lineTo(ax, top + aw / 2); x.arc(ax + aw / 2, top + aw / 2, aw / 2, Math.PI, 0); x.lineTo(ax + aw, bottom); x.closePath();
      const g = x.createRadialGradient(ax + aw / 2, bottom - 10, 2, ax + aw / 2, top + 20, 60);
      g.addColorStop(0, rgb([26, 20, 26])); g.addColorStop(1, rgb([3, 2, 6]));
      x.fillStyle = g; x.fill();
      x.lineWidth = 3.2; x.strokeStyle = rgb([70, 64, 82]); x.stroke();
      x.lineWidth = 0.8; x.strokeStyle = rgb([110, 102, 120], 0.5); x.stroke();
      x.clip();
      for (let i = 1; i < 7; i++) {
        const bx = ax + (i * aw) / 7;
        x.fillStyle = hgrad(x, bx - 1, bx + 1, [[0, [20, 20, 26]], [0.4, [96, 96, 110]], [1, [26, 26, 32]]]);
        x.fillRect(bx - 0.9, top - 2, 1.8, bottom - top + 4);
      }
      x.fillStyle = rgb([56, 56, 66]); x.fillRect(ax, top + 26, aw, 2); x.fillRect(ax, bottom - 18, aw, 2);
      x.restore();
    }
    // darken toward the ceiling
    x.fillStyle = vgrad(x, 0, 70, [[0, [0, 0, 0], 0.85], [1, [0, 0, 0], 0]]);
    x.fillRect(0, 0, TW, 70);
  }
  // Mid: pillars with torches, chains, cobwebs.
  const mid = tile(K);
  const torches = [];
  {
    const x = mid.x;
    for (const px of [40, 200, 360, 520]) {
      const pw = 24;
      wrap(px - 4, pw + 8, (p0) => {
        const p = p0 + 4;
        x.fillStyle = hgrad(x, p, p + pw, [[0, [18, 16, 24]], [0.25, [74, 68, 86]], [0.45, [92, 86, 104]], [0.8, [40, 36, 50]], [1, [14, 12, 20]]]);
        x.fillRect(p, 0, pw, floorY);
        for (let y = 10; y < floorY; y += 14) { x.fillStyle = rgb([10, 8, 14], 0.8); x.fillRect(p, y, pw, 0.8); x.fillStyle = rgb([255, 255, 255], 0.05); x.fillRect(p, y + 0.8, pw, 0.5); }
        // capital and base
        for (const [y, h] of [[16, 6], [floorY - 10, 10]]) {
          x.fillStyle = hgrad(x, p - 4, p + pw + 4, [[0, [24, 22, 30]], [0.3, [96, 90, 108]], [0.5, [110, 104, 120]], [1, [20, 18, 26]]]);
          x.fillRect(p - 4, y, pw + 8, h);
          x.fillStyle = rgb([255, 255, 255], 0.07); x.fillRect(p - 4, y, pw + 8, 0.7);
        }
        // torch bracket
        const ty = floorY - 64;
        x.fillStyle = rgb([34, 30, 36]); x.fillRect(p + pw / 2 - 5, ty + 8, 10, 2.4);
        x.fillStyle = hgrad(x, p + pw / 2 - 2, p + pw / 2 + 2, [[0, [60, 38, 22]], [0.5, [124, 84, 48]], [1, [50, 30, 18]]]);
        x.beginPath(); x.moveTo(p + pw / 2 - 2.2, ty); x.lineTo(p + pw / 2 + 2.2, ty); x.lineTo(p + pw / 2 + 1.2, ty + 12); x.lineTo(p + pw / 2 - 1.2, ty + 12); x.closePath(); x.fill();
        x.fillStyle = rgb([40, 30, 26]); x.fillRect(p + pw / 2 - 3, ty - 1, 6, 2.5);
        // soot above the torch
        const sg = x.createRadialGradient(p + pw / 2, ty - 14, 1, p + pw / 2, ty - 14, 14);
        sg.addColorStop(0, rgb([0, 0, 0], 0.45)); sg.addColorStop(1, rgb([0, 0, 0], 0));
        x.fillStyle = sg; x.fillRect(p - 10, ty - 30, pw + 20, 30);
      });
      torches.push({ x: px + 12, y: floorY - 67 });
    }
    // chains
    for (const cx of [118, 290, 452, 600]) {
      const len = 24 + (cx % 5) * 6;
      for (let y = 0; y < len; y += 3.2) {
        x.strokeStyle = rgb([60, 58, 70]); x.lineWidth = 0.9;
        x.beginPath(); x.ellipse(cx, y, (y / 3.2) % 2 < 1 ? 1.2 : 0.5, 1.9, 0, 0, Math.PI * 2); x.stroke();
      }
      x.fillStyle = rgb([40, 38, 46]); x.beginPath(); x.arc(cx, len + 2, 2.4, 0, Math.PI * 2); x.fill();
    }
    // cobwebs
    for (const wx of [64, 224, 384, 544]) {
      x.strokeStyle = rgb([220, 220, 235], 0.13); x.lineWidth = 0.35;
      for (let a = 0; a <= 4; a++) { const ang = (a / 4) * Math.PI / 2; x.beginPath(); x.moveTo(wx, 0); x.lineTo(wx + Math.cos(ang) * 22, Math.sin(ang) * 22); x.stroke(); }
      for (let rr = 5; rr <= 20; rr += 5) { x.beginPath(); for (let a = 0; a <= 4; a++) { const ang = (a / 4) * Math.PI / 2, s = a % 2 ? 0.86 : 1; const px = wx + Math.cos(ang) * rr * s, py = Math.sin(ang) * rr * s; a ? x.lineTo(px, py) : x.moveTo(px, py); } x.stroke(); }
    }
  }
  // Near: flagstone floor.
  const floor = tile(K);
  {
    const x = floor.x;
    x.fillStyle = vgrad(x, floorY - 3, H, [[0, [40, 36, 48]], [1, [16, 14, 22]]]);
    x.fillRect(0, floorY - 3, TW, H);
    const rows = [[floorY - 3, 6], [floorY + 3, 8], [floorY + 11, 10], [floorY + 21, 14]];
    rows.forEach(([y, h], ri) => {
      let bx = -R() * 20;
      while (bx < TW) {
        const w = (16 + R() * 14) * (1 + ri * 0.35), c = shade(mix([62, 58, 72], [78, 72, 84], R()), 0.9 - ri * 0.1);
        const bw = Math.min(w, TW - bx);
        if (bw > 2) wrap(bx, bw, (p) => {
          rrect(x, p + 0.4, y + 0.4, bw - 0.8, h - 0.8, 1.4);
          x.fillStyle = vgrad(x, y, y + h, [[0, mix(c, [255, 255, 255], 0.12)], [0.35, c], [1, shade(c, 0.6)]]); x.fill();
          x.fillStyle = rgb([255, 240, 220], 0.07); x.fillRect(p + 1.5, y + 0.6, bw - 3, 0.6);
        });
        bx += w;
      }
    });
    // puddles
    for (const [px, py, w] of [[150, floorY + 8, 22], [330, floorY + 16, 30], [560, floorY + 6, 18]]) {
      x.fillStyle = rgb([14, 18, 30], 0.85); x.beginPath(); x.ellipse(px, py, w / 2, w / 9, 0, 0, Math.PI * 2); x.fill();
      x.strokeStyle = rgb([120, 140, 180], 0.25); x.lineWidth = 0.5; x.beginPath(); x.ellipse(px, py, w / 2 - 1, w / 9 - 0.6, 0, Math.PI * 1.1, Math.PI * 1.9); x.stroke();
    }
    x.fillStyle = vgrad(x, floorY - 3, floorY + 4, [[0, [0, 0, 0], 0.6], [1, [0, 0, 0], 0]]);
    x.fillRect(0, floorY - 3, TW, 7);
  }
  const L = {
    layers: [{ tex: r.texture(wall.c), factor: 0.25 }, { tex: r.texture(mid.c), factor: 0.55 }, { tex: r.texture(floor.c), factor: 1 }],
    ambient: [0.3, 0.29, 0.4],
    dynamic(d) {
      const { T, t, scroll } = d;
      const off = scroll * 0.55;
      for (const tc of torches) for (const k of [-1, 0, 1]) {
        const wx = tc.x + k * TW - (off % TW);
        if (wx < -80 || wx > 400) continue;
        const fl = 0.85 + 0.15 * Math.sin(t * 17 + tc.x) * Math.sin(t * 7.3 + tc.x * 0.3);
        d.flame(wx, tc.y + 2, 7 * fl, 12 * fl, t + tc.x * 0.1);
        d.r.light(wx, tc.y - 2, 95 * fl, [1, 0.58, 0.26], 1.25 * fl);
        d.r.draw(T.glow, 0, 0, 64, 64, wx - 16, tc.y - 18, 32, 32, { pass: 'glow', color: [1, 0.5, 0.2, 0.35 * fl] });
        // reflection in the floor
        d.r.draw(T.glow, 0, 0, 64, 64, wx - 18, floorY + 8, 36, 10, { pass: 'glow', color: [1, 0.5, 0.2, 0.12 * fl] });
      }
      // dust drifting through the torchlight
      for (let i = 0; i < 26; i++) {
        const x = ((hash(i, 3) * 360 + t * (3 + hash(i, 5) * 5)) % 360) - 20, y = 30 + hash(i, 7) * 110 + Math.sin(t * 0.7 + i) * 6;
        const a = 0.25 + 0.25 * Math.sin(t * 1.3 + i * 2);
        d.r.draw(T.core, 0, 0, 32, 32, x - 0.7, y - 0.7, 1.4, 1.4, { pass: 'glow', color: [1, 0.85, 0.6, a] });
      }
      // water drips
      for (let i = 0; i < 3; i++) {
        const period = 3.2 + i, ph = ((t + i * 1.7) % period) / period, dx = 60 + i * 97 + Math.floor(t / period) * 37 % 120;
        const y = 8 + ph * (floorY + 4);
        if (ph < 0.97) d.r.draw(T.pixel, 0, 0, 2, 2, dx, y, 0.8, 1.6, { color: [0.6, 0.7, 0.9, 0.8] });
        else d.ripple(dx, floorY + 6, (ph - 0.97) / 0.03);
      }
    },
  };
  return L;
}

// ---------- forest ----------

function forest(r, K, floorY) {
  const R = rng(21);
  const sky = tile(K);
  {
    const x = sky.x;
    x.fillStyle = vgrad(x, 0, floorY, [[0, [16, 26, 50]], [0.35, [44, 70, 96]], [0.7, [150, 146, 118]], [1, [232, 190, 122]]]);
    x.fillRect(0, 0, TW, floorY + 4);
    for (const sx of [110, 430]) {
      const g = x.createRadialGradient(sx, 40, 0, sx, 40, 110);
      g.addColorStop(0, rgb([255, 236, 190], 0.55)); g.addColorStop(0.3, rgb([255, 210, 150], 0.18)); g.addColorStop(1, rgb([255, 200, 140], 0));
      x.fillStyle = g; x.fillRect(sx - 120, 0, 240, 160);
    }
    for (let i = 0; i < 14; i++) {
      const cx = R() * TW, cy = 14 + R() * 50, w = 30 + R() * 50;
      wrap(cx - w, w * 2, (p) => { x.fillStyle = rgb([255, 236, 220], 0.05 + R() * 0.05); x.beginPath(); x.ellipse(p + w, cy, w, 4 + R() * 4, 0, 0, Math.PI * 2); x.fill(); });
    }
  }
  function pines(x, n, hMin, hMax, base, color, hi, seed) {
    const Rr = rng(seed);
    for (let i = 0; i < n; i++) {
      const cx = (i / n) * TW + Rr() * (TW / n), h = hMin + Rr() * (hMax - hMin), w = h * (0.34 + Rr() * 0.1), tiers = 4 + Math.floor(Rr() * 3);
      wrap(cx - w, w * 2, (p) => {
        const c0 = p + w;
        x.fillStyle = rgb(shade(color, 0.7)); x.fillRect(c0 - 0.8, base - h * 0.2, 1.6, h * 0.2 + 2);
        for (let k = 0; k < tiers; k++) {
          const ty = base - h + (k / tiers) * h * 0.85, tw = w * (0.35 + 0.65 * ((k + 1) / tiers)), th = h / tiers * 1.5;
          x.fillStyle = rgb(color); x.beginPath(); x.moveTo(c0, ty); x.lineTo(c0 + tw, ty + th); x.lineTo(c0 - tw, ty + th); x.closePath(); x.fill();
          if (hi) { x.fillStyle = rgb(hi, 0.35); x.beginPath(); x.moveTo(c0, ty); x.lineTo(c0 - tw * 0.2, ty + th * 0.9); x.lineTo(c0 - tw, ty + th); x.closePath(); x.fill(); }
        }
      });
    }
  }
  const far = tile(K);
  {
    const x = far.x;
    pines(x, 34, 40, 64, floorY - 16, [74, 100, 112], [150, 170, 170], 5);
    x.fillStyle = vgrad(x, floorY - 50, floorY - 10, [[0, [210, 200, 170], 0], [1, [220, 200, 160], 0.55]]);
    x.fillRect(0, floorY - 50, TW, 40);
    pines(x, 26, 50, 80, floorY - 8, [46, 70, 70], [90, 120, 100], 6);
    x.fillStyle = vgrad(x, floorY - 30, floorY, [[0, [190, 180, 150], 0], [1, [180, 170, 140], 0.35]]);
    x.fillRect(0, floorY - 30, TW, 30);
  }
  const mid = tile(K);
  {
    const x = mid.x;
    pines(x, 16, 90, 130, floorY - 2, [22, 40, 34], [60, 90, 60], 8);
    // ferns and bushes along the floor
    for (let i = 0; i < 40; i++) {
      const bx = R() * TW, bw = 8 + R() * 16;
      wrap(bx - bw, bw * 2, (p) => {
        for (let k = 0; k < 7; k++) {
          const a = -Math.PI / 2 + (k - 3) * 0.35, len = bw * (0.5 + R() * 0.5);
          x.strokeStyle = rgb(mix([28, 60, 36], [70, 120, 60], R())); x.lineWidth = 1.4;
          x.beginPath(); x.moveTo(p + bw, floorY); x.quadraticCurveTo(p + bw + Math.cos(a) * len * 0.6, floorY + Math.sin(a) * len * 0.8, p + bw + Math.cos(a) * len, floorY + Math.sin(a) * len * 0.6); x.stroke();
        }
      });
    }
  }
  const near = tile(K);
  {
    const x = near.x;
    // trunks
    for (const [tx, tw] of [[20, 22], [190, 16], [300, 26], [470, 18], [590, 24]]) {
      wrap(tx - 10, tw + 20, (p0) => {
        const p = p0 + 10;
        x.fillStyle = hgrad(x, p, p + tw, [[0, [22, 16, 12]], [0.3, [96, 70, 48]], [0.55, [70, 50, 36]], [1, [16, 12, 10]]]);
        x.beginPath(); x.moveTo(p, 0); x.lineTo(p + tw, 0); x.lineTo(p + tw + 2, floorY - 6); x.quadraticCurveTo(p + tw + 9, floorY + 1, p + tw + 12, floorY + 2); x.lineTo(p - 12, floorY + 2); x.quadraticCurveTo(p - 9, floorY + 1, p - 2, floorY - 6); x.closePath(); x.fill();
        for (let k = 0; k < 16; k++) { x.strokeStyle = rgb([14, 10, 8], 0.5); x.lineWidth = 0.5 + R(); const bx = p + 2 + R() * (tw - 4); x.beginPath(); x.moveTo(bx, R() * 60); x.lineTo(bx + (R() - 0.5) * 3, 40 + R() * (floorY - 40)); x.stroke(); }
        x.fillStyle = rgb([70, 120, 60], 0.45); for (let k = 0; k < 10; k++) { x.beginPath(); x.ellipse(p + 2 + R() * 4, 30 + R() * (floorY - 40), 1.5 + R() * 2, 3 + R() * 5, 0, 0, Math.PI * 2); x.fill(); }
      });
    }
    // canopy
    for (let i = 0; i < 160; i++) {
      const cx = R() * TW, cy = -6 + R() * 26, rr = 6 + R() * 10;
      wrap(cx - rr, rr * 2, (p) => {
        const c = mix([16, 34, 22], [50, 96, 48], R() * (cy + 10) / 40);
        x.fillStyle = rgb(c); x.beginPath(); x.arc(p + rr, cy, rr, 0, Math.PI * 2); x.fill();
        x.fillStyle = rgb([130, 180, 90], 0.12); x.beginPath(); x.arc(p + rr - rr * 0.3, cy - rr * 0.3, rr * 0.5, 0, Math.PI * 2); x.fill();
      });
    }
  }
  const ground = tile(K);
  {
    const x = ground.x;
    x.fillStyle = vgrad(x, floorY - 2, H, [[0, [70, 56, 36]], [0.3, [46, 34, 24]], [1, [22, 16, 12]]]);
    x.fillRect(0, floorY - 2, TW, H);
    noiseFill(x, K, 0, floorY + 2, TW, H - floorY - 2, (px, py) => { const n = fbm(px / 9, py / 5, 3, 3, TW / 9); return [20, 14, 8, n > 0.55 ? (n - 0.55) * 500 : 0]; });
    for (let i = 0; i < 26; i++) { const sx = R() * TW, sy = floorY + 6 + R() * 26, sw = 2 + R() * 4; x.fillStyle = rgb(mix([90, 88, 84], [140, 136, 126], R())); x.beginPath(); x.ellipse(sx, sy, sw, sw * 0.6, 0, 0, Math.PI * 2); x.fill(); x.fillStyle = rgb([255, 255, 255], 0.2); x.beginPath(); x.ellipse(sx - sw * 0.3, sy - sw * 0.25, sw * 0.4, sw * 0.2, 0, 0, Math.PI * 2); x.fill(); }
    for (let i = 0; i < 700; i++) {
      const gx = R() * TW, h = 2 + R() * 5;
      x.strokeStyle = rgb(mix([46, 90, 40], [120, 170, 70], R())); x.lineWidth = 0.6;
      x.beginPath(); x.moveTo(gx, floorY + R() * 1.5); x.lineTo(gx + (R() - 0.5) * 2.5, floorY - h); x.stroke();
    }
    for (let i = 0; i < 40; i++) { x.fillStyle = rgb([[255, 220, 120], [230, 140, 200], [255, 255, 255]][i % 3], 0.9); x.beginPath(); x.arc(R() * TW, floorY - 1 - R() * 3, 0.7, 0, Math.PI * 2); x.fill(); }
  }
  const leaves = Array.from({ length: 10 }, (_, i) => ({ x: hash(i, 1) * 320, y: hash(i, 2) * 140, s: 0.4 + hash(i, 3) * 0.6, c: [[200, 120, 40], [120, 160, 60], [220, 170, 60]][i % 3] }));
  return {
    layers: [{ tex: r.texture(sky.c), factor: 0.03 }, { tex: r.texture(far.c), factor: 0.12 }, { tex: r.texture(mid.c), factor: 0.35 }, { tex: r.texture(near.c), factor: 0.7 }, { tex: r.texture(ground.c), factor: 1 }],
    ambient: [0.62, 0.66, 0.74],
    dynamic(d) {
      const { T, t } = d;
      const rain = d.rain;
      // god rays
      for (let i = 0; i < 5; i++) {
        const x0 = 20 + i * 62 - ((d.scroll * 0.05) % 62), a = (0.1 + 0.07 * Math.sin(t * 0.4 + i * 1.7)) * (1 - rain * 0.8);
        d.r.quad(T.shaft, [0, 0, 1, 1], [x0, -10, x0 + 14 + i * 2, -10, x0 + 70 + i * 4, floorY + 4, x0 + 38, floorY + 4], [1, 0.9, 0.62, a], 'glow');
      }
      // fireflies
      for (let i = 0; i < 16; i++) {
        const x = (hash(i, 9) * 340 + Math.sin(t * 0.3 + i) * 20 + t * 2) % 340 - 10, y = floorY - 8 - hash(i, 4) * 60 + Math.sin(t * 0.9 + i * 3) * 6;
        const a = Math.max(0, Math.sin(t * 1.6 + i * 2.1)) * (1 - rain * 0.7);
        if (a < 0.05) continue;
        d.r.draw(T.glow, 0, 0, 64, 64, x - 4, y - 4, 8, 8, { pass: 'glow', color: [0.75, 1, 0.35, 0.6 * a] });
        d.r.draw(T.core, 0, 0, 32, 32, x - 0.8, y - 0.8, 1.6, 1.6, { pass: 'glow', color: [0.9, 1, 0.6, a] });
        d.r.light(x, y, 18, [0.6, 1, 0.3], 0.5 * a);
      }
      // falling leaves
      for (const lf of leaves) {
        const y = (lf.y + t * 9 * lf.s) % 160, x = (lf.x - t * 6 * lf.s + Math.sin(t * 1.5 + lf.y) * 8 + 400) % 340 - 10;
        d.r.draw(T.pixel, 0, 0, 2, 2, x, y, 1.6, 1, { color: [lf.c[0] / 255, lf.c[1] / 255, lf.c[2] / 255, 0.9], angle: Math.sin(t * 3 + lf.x) * 1.2 });
      }
      if (rain > 0.02) {
        for (let i = 0; i < 90 * rain; i++) {
          const x = (hash(i, 11) * 360 + t * 40) % 360 - 20, y = ((hash(i, 12) * 200 + t * 260) % 200) - 20;
          d.r.quad(T.rain, [0, 0, 1, 1], [x, y, x + 0.6, y, x - 2.6, y + 9, x - 3.2, y + 9], [0.7, 0.8, 1, 0.35 * rain], 'glow');
          if (y > floorY - 4 && y < floorY + 6) d.r.draw(T.ring, 0, 0, 128, 128, x - 3, floorY + (i % 7), 6, 1.5, { pass: 'glow', color: [0.7, 0.8, 1, 0.3 * rain] });
        }
      }
    },
    ambientFor(d) { return d.rain > 0.02 ? [0.5 - d.rain * 0.1, 0.55 - d.rain * 0.08, 0.66] : this.ambient; },
  };
}

// ---------- lava cave ----------

function lava(r, K, floorY) {
  const R = rng(31);
  const bg = tile(K);
  {
    const x = bg.x;
    x.fillStyle = vgrad(x, 0, floorY, [[0, [8, 5, 8]], [0.45, [26, 11, 13]], [0.8, [70, 24, 14]], [1, [112, 42, 18]]]);
    x.fillRect(0, 0, TW, floorY + 4);
    // distant spires lit from below
    for (let i = 0; i < 22; i++) {
      const cx = R() * TW, w = 10 + R() * 24, h = 40 + R() * 70;
      wrap(cx - w, w * 2, (p) => {
        x.fillStyle = vgrad(x, floorY - h, floorY, [[0, [26, 14, 16]], [0.7, [44, 20, 18]], [1, [120, 44, 20]]]);
        x.beginPath(); x.moveTo(p, floorY); for (let k = 0; k <= 6; k++) { const u = k / 6; x.lineTo(p + u * w * 2, floorY - h * Math.sin(u * Math.PI) * (0.7 + R() * 0.3)); } x.closePath(); x.fill();
      });
    }
    // ceiling teeth
    for (let i = 0; i < 60; i++) {
      const cx = R() * TW, w = 3 + R() * 8, h = 8 + R() * 28;
      wrap(cx - w, w * 2, (p) => { x.fillStyle = vgrad(x, 0, h, [[0, [6, 4, 6]], [1, [36, 16, 16]]]); x.beginPath(); x.moveTo(p, -1); x.lineTo(p + w * 2, -1); x.lineTo(p + w + (R() - 0.5) * 2, h); x.closePath(); x.fill(); });
    }
    x.fillStyle = vgrad(x, floorY - 60, floorY, [[0, [255, 90, 30], 0], [1, [255, 110, 40], 0.14]]);
    x.fillRect(0, floorY - 60, TW, 60);
  }
  const falls = [{ x: 120, top: 10, w: 7 }, { x: 350, top: 24, w: 5 }, { x: 540, top: 16, w: 8 }];
  const mid = tile(K);
  {
    const x = mid.x;
    for (const f of falls) wrap(f.x - 14, 28, (p) => { x.fillStyle = rgb([14, 8, 8]); x.beginPath(); x.ellipse(p + 14, f.top, 12, 6, 0, 0, Math.PI * 2); x.fill(); });
    // basalt column clusters
    for (let i = 0; i < 9; i++) {
      const cx = 20 + i * 70 + R() * 30, n = 3 + Math.floor(R() * 4);
      for (let k = 0; k < n; k++) {
        const w = 7 + R() * 4, h = 30 + R() * 50, px = cx + k * (w - 1) - n * 3, top = floorY - 14 - h;
        wrap(px, w, (p) => {
          x.fillStyle = hgrad(x, p, p + w, [[0, [22, 16, 18]], [0.5, [40, 30, 32]], [0.85, [60, 34, 26]], [1, [150, 60, 24]]]);
          x.fillRect(p, top, w, h + 16);
          x.fillStyle = rgb([76, 60, 62]); x.beginPath(); x.moveTo(p, top); x.lineTo(p + w / 2, top - 2.5); x.lineTo(p + w, top); x.lineTo(p + w / 2, top + 2); x.closePath(); x.fill();
          x.fillStyle = rgb([255, 120, 40], 0.3); x.fillRect(p + w - 0.8, top, 0.8, h + 16);
        });
      }
    }
  }
  const ledge = tile(K);
  const cracks = tile(K);
  {
    const x = ledge.x;
    x.fillStyle = vgrad(x, floorY - 4, H, [[0, [52, 36, 36]], [0.1, [34, 24, 26]], [1, [14, 10, 12]]]);
    x.beginPath(); x.moveTo(0, floorY - 2); for (let px = 0; px <= TW; px += 8) x.lineTo(px, floorY - 3 + Math.sin(px * 0.21) * 1.2 + (hash(px, 3) - 0.5) * 1.5); x.lineTo(TW, H); x.lineTo(0, H); x.closePath(); x.fill();
    noiseFill(x, K, 0, floorY, TW, H - floorY, (px, py) => { const n = fbm(px / 7, py / 4, 9, 3, TW / 7); return [8, 6, 8, Math.max(0, n - 0.45) * 520]; });
    x.fillStyle = rgb([255, 130, 60], 0.4); x.fillRect(0, floorY - 3.5, TW, 0.7);
    const c = cracks.x;
    c.lineCap = 'round';
    for (let i = 0; i < 30; i++) {
      let cx = R() * TW, cy = floorY + 2 + R() * 26;
      const pts = [[cx, cy]];
      for (let k = 0; k < 5; k++) { cx += (R() - 0.3) * 10; cy += (R() - 0.5) * 4; pts.push([cx, cy]); }
      for (const [lw, col, a] of [[2.4, [255, 80, 20], 0.35], [0.9, [255, 170, 60], 0.9], [0.35, [255, 240, 180], 1]]) {
        c.strokeStyle = rgb(col, a); c.lineWidth = lw; c.beginPath(); pts.forEach(([a1, b1], k) => (k ? c.lineTo(a1, b1) : c.moveTo(a1, b1))); c.stroke();
      }
    }
    for (const [px, py, w] of [[90, floorY + 14, 26], [410, floorY + 22, 34]]) {
      const g = c.createRadialGradient(px, py, 1, px, py, w / 2);
      g.addColorStop(0, rgb([255, 240, 170])); g.addColorStop(0.5, rgb([255, 130, 40])); g.addColorStop(1, rgb([160, 30, 10], 0));
      c.fillStyle = g; c.save(); c.translate(px, py); c.scale(1, 0.28); c.translate(-px, -py); c.beginPath(); c.arc(px, py, w / 2, 0, Math.PI * 2); c.fill(); c.restore();
      x.fillStyle = rgb([20, 10, 10]); x.save(); x.translate(px, py); x.scale(1, 0.3); x.translate(-px, -py); x.beginPath(); x.arc(px, py, w / 2 + 2, 0, Math.PI * 2); x.fill(); x.restore();
    }
  }
  const crackTex = r.texture(cracks.c);
  return {
    layers: [{ tex: r.texture(bg.c), factor: 0.08 }, { tex: r.texture(mid.c), factor: 0.45 }, { tex: r.texture(ledge.c), factor: 1, after: 'river' }],
    ambient: [0.4, 0.27, 0.26],
    dynamic(d, phase) {
      const { T, t, scroll } = d;
      if (phase === 'river') return; // drawn before the ledge, below
      const offM = scroll * 0.45;
      for (const f of falls) for (const k of [-1, 0, 1]) {
        const wx = f.x + k * TW - (offM % TW);
        if (wx < -40 || wx > 360) continue;
        const hgt = floorY - 14 - f.top;
        d.r.draw(T.lavafall, 0, -t * 60, 16, 128 * (hgt / 64), wx - f.w / 2, f.top, f.w, hgt, { pass: 'glow', color: [1, 0.85, 0.7, 0.95] });
        d.r.draw(T.glow, 0, 0, 64, 64, wx - f.w * 2.5, floorY - 30, f.w * 5, 24, { pass: 'glow', color: [1, 0.45, 0.1, 0.6] });
        d.r.light(wx, floorY - 30, 80, [1, 0.45, 0.15], 0.45);
      }
      // ledge cracks pulse
      const offL = scroll % TW;
      for (const k of [0, 1]) d.r.draw(crackTex, 0, 0, crackTex.w, crackTex.h, k * TW - offL, 0, TW, H, { pass: 'glow', color: [1, 0.9, 0.8, 0.55 + 0.25 * Math.sin(t * 1.3)] });
      // embers
      for (let i = 0; i < 40; i++) {
        const life = ((t * (0.25 + hash(i, 2) * 0.3) + hash(i, 1)) % 1);
        const x = (hash(i, 3) * 340 + Math.sin(t * 2 + i) * 6 - 10), y = floorY - 6 - life * 150;
        const a = Math.sin(life * Math.PI) * 0.9;
        d.r.draw(T.core, 0, 0, 32, 32, x - 1, y - 1, 2, 2, { pass: 'glow', color: [1, 0.55 + 0.3 * hash(i, 4), 0.2, a] });
      }
    },
    // The lava river sits between the mid layer and the ledge.
    river(d) {
      const { T, t, scroll } = d;
      const off = (scroll * 0.8 + t * 6) % 256;
      const y0 = floorY - 15, h = 13;
      d.r.draw(T.lava, off, 0, 320 * 0.8, 32, 0 - 10, y0, 340, h, { color: [0.7, 0.5, 0.4, 1] });
      d.r.draw(T.lava, off * 1.7 + 40, 0, 200, 32, -10, y0, 340, h, { pass: 'glow', color: [0.9, 0.55, 0.3, 0.4] });
      for (let i = 0; i < 7; i++) d.r.light(i * 52 + 10, floorY - 10, 90, [1, 0.42, 0.12], 0.5 + 0.08 * Math.sin(t * 1.7 + i));
    },
  };
}

// ---------- castle ----------

function castle(r, K, floorY) {
  const R = rng(41);
  const PANES = [[200, 44, 64], [52, 84, 206], [236, 186, 64], [56, 160, 96], [150, 70, 190], [60, 170, 200]];
  const windows = [60, 220, 380, 540].map((x) => ({ x, top: 30, bottom: floorY - 40, w: 28 }));
  const wall = tile(K), glass = tile(K);
  {
    const x = wall.x, g = glass.x;
    x.fillStyle = vgrad(x, 0, floorY, [[0, [10, 9, 18]], [0.5, [34, 30, 48]], [1, [48, 42, 62]]]);
    x.fillRect(0, 0, TW, floorY + 4);
    for (let row = 0, y = 0; y < floorY - 22; row++, y += 12) {
      let bx = row % 2 ? -12 : 0;
      while (bx < TW) {
        const w = 22 + R() * 8, c = shade(mix([52, 48, 70], [66, 60, 84], R()), 0.55 + 0.45 * (y / floorY));
        const bw = Math.min(w - 0.8, TW - bx);
        if (bw > 1) wrap(bx, bw, (p) => { x.fillStyle = vgrad(x, y, y + 12, [[0, mix(c, [255, 255, 255], 0.06)], [1, shade(c, 0.78)]]); x.fillRect(p + 0.4, y + 0.4, bw - 0.4, 11.2); });
        bx += w;
      }
    }
    // cornice and wainscot
    x.fillStyle = vgrad(x, 22, 30, [[0, [90, 84, 110]], [0.5, [60, 56, 76]], [1, [24, 20, 32]]]); x.fillRect(0, 22, TW, 8);
    x.fillStyle = vgrad(x, floorY - 24, floorY, [[0, [70, 44, 30]], [1, [40, 24, 18]]]); x.fillRect(0, floorY - 24, TW, 24);
    x.fillStyle = rgb([130, 90, 50]); x.fillRect(0, floorY - 25, TW, 1.4);
    for (let px = 4; px < TW; px += 22) { x.strokeStyle = rgb([24, 14, 10], 0.8); x.lineWidth = 0.8; x.strokeRect(px, floorY - 20, 18, 16); x.strokeStyle = rgb([150, 110, 70], 0.2); x.strokeRect(px + 0.8, floorY - 19.2, 16.4, 14.4); }
    // lancet windows
    for (const wdw of windows) {
      const { x: wx, top, bottom, w } = wdw;
      const shape = (c, inset = 0) => { c.beginPath(); c.moveTo(wx + inset, bottom); c.lineTo(wx + inset, top + w * 0.6); c.quadraticCurveTo(wx + inset, top + inset, wx + w / 2, top - w * 0.2 + inset); c.quadraticCurveTo(wx + w - inset, top + inset, wx + w - inset, top + w * 0.6); c.lineTo(wx + w - inset, bottom); c.closePath(); };
      shape(x, -3); x.fillStyle = rgb([84, 78, 100]); x.fill();
      shape(x, -1.2); x.fillStyle = rgb([30, 26, 40]); x.fill();
      for (const [c, k, a] of [[x, 0.35, 1], [g, 1, 1]]) {
        c.save(); shape(c, 0); c.clip();
        for (let j = 0; j < 20; j++) for (let i = 0; i < 4; i++) {
          const pc = PANES[Math.floor(hash(i + wx, j) * PANES.length)];
          const cc = c === x ? shade(pc, k) : mix(pc, [255, 255, 255], 0.25 + 0.2 * hash(j, i + wx));
          c.fillStyle = rgb(cc, a); c.fillRect(wx + (i * w) / 4, top - 10 + j * 7, w / 4, 7);
        }
        c.strokeStyle = rgb([20, 16, 26], c === x ? 1 : 0.85); c.lineWidth = 0.9;
        for (let i = 1; i < 4; i++) { c.beginPath(); c.moveTo(wx + (i * w) / 4, top - 12); c.lineTo(wx + (i * w) / 4, bottom); c.stroke(); }
        for (let j = 0; j < 20; j++) { c.beginPath(); c.moveTo(wx, top - 10 + j * 7); c.lineTo(wx + w, top - 10 + j * 7); c.stroke(); }
        // rose in the arch
        c.fillStyle = rgb(c === x ? [60, 40, 20] : [255, 220, 120]); c.beginPath(); c.arc(wx + w / 2, top + 4, 4.5, 0, Math.PI * 2); c.fill();
        c.restore();
      }
    }
  }
  const mid = tile(K);
  const candles = [];
  {
    const x = mid.x;
    for (const px of [140, 300, 460, 620]) {
      const pw = 22;
      wrap(px - 6, pw + 12, (p0) => {
        const p = p0 + 6;
        x.fillStyle = hgrad(x, p, p + pw, [[0, [30, 30, 44]], [0.3, [150, 146, 170]], [0.5, [176, 172, 194]], [0.85, [70, 68, 90]], [1, [24, 24, 36]]]);
        x.fillRect(p, 0, pw, floorY);
        for (let fx = p + 3; fx < p + pw - 2; fx += 4) { x.fillStyle = rgb([0, 0, 0], 0.18); x.fillRect(fx, 0, 0.8, floorY); }
        for (const [y, h] of [[34, 6], [floorY - 12, 12]]) { x.fillStyle = hgrad(x, p - 5, p + pw + 5, [[0, [40, 40, 56]], [0.35, [170, 166, 186]], [1, [30, 30, 44]]]); x.fillRect(p - 5, y, pw + 10, h); }
        // banner
        const bx = p + 2, by = 44, bw = pw - 4, bh = 58, red = (px / 160) % 2 < 1;
        const cloth = red ? [150, 28, 40] : [36, 56, 150];
        x.fillStyle = vgrad(x, by, by + bh, [[0, shade(cloth, 1.1)], [1, shade(cloth, 0.7)]]);
        x.beginPath(); x.moveTo(bx, by); x.lineTo(bx + bw, by); x.lineTo(bx + bw, by + bh); x.lineTo(bx + bw / 2, by + bh - 8); x.lineTo(bx, by + bh); x.closePath(); x.fill();
        x.strokeStyle = rgb([236, 190, 70]); x.lineWidth = 1; x.stroke();
        for (let k = 0; k < bw; k += 3) { x.fillStyle = rgb([0, 0, 0], 0.12); x.fillRect(bx + k, by, 1, bh - 6); }
        x.fillStyle = rgb([236, 190, 70]); x.beginPath(); x.moveTo(bx + bw / 2, by + 12); x.lineTo(bx + bw / 2 + 6, by + 22); x.lineTo(bx + bw / 2, by + 34); x.lineTo(bx + bw / 2 - 6, by + 22); x.closePath(); x.fill();
        x.fillStyle = rgb(cloth); x.beginPath(); x.arc(bx + bw / 2, by + 23, 2.6, 0, Math.PI * 2); x.fill();
        x.fillStyle = rgb([200, 160, 60]); x.fillRect(bx - 2, by - 2, bw + 4, 2);
        // sconce
        const sy = floorY - 44;
        x.fillStyle = rgb([200, 160, 70]); x.fillRect(p + pw / 2 - 4, sy + 6, 8, 2); x.fillRect(p + pw / 2 - 1, sy + 8, 2, 4);
        x.fillStyle = rgb([236, 226, 200]); x.fillRect(p + pw / 2 - 1.2, sy, 2.4, 6);
      });
      candles.push({ x: px + 11, y: floorY - 44 });
    }
  }
  const floor = tile(K), refl = tile(K);
  {
    const x = floor.x;
    const rows = [[floorY - 2, 5], [floorY + 3, 7], [floorY + 10, 9], [floorY + 19, 13]];
    rows.forEach(([y, h], ri) => {
      const tw = 16 + ri * 4;
      for (let i = -1, px = -(ri * 7) % tw; px < TW; i++, px += tw) {
        const light = (i + ri) % 2 === 0;
        const c = light ? [200, 194, 206] : [58, 52, 74];
        x.fillStyle = vgrad(x, y, y + h, [[0, shade(c, 0.95)], [1, shade(c, 0.62)]]);
        x.fillRect(px, y, tw, h);
        if (light) { x.strokeStyle = rgb([140, 130, 150], 0.35); x.lineWidth = 0.3; x.beginPath(); x.moveTo(px + 2, y + h * 0.3); x.quadraticCurveTo(px + tw * 0.5, y + h * 0.1, px + tw - 2, y + h * 0.8); x.stroke(); }
      }
    });
    x.fillStyle = vgrad(x, floorY - 2, H, [[0, [255, 255, 255], 0.08], [0.1, [0, 0, 0], 0], [1, [0, 0, 0], 0.55]]);
    x.fillRect(0, floorY - 2, TW, H);
    // red carpet runner
    x.fillStyle = vgrad(x, floorY + 6, floorY + 16, [[0, [150, 24, 36]], [1, [90, 14, 24]]]); x.fillRect(0, floorY + 6, TW, 10);
    x.fillStyle = rgb([226, 180, 70]); x.fillRect(0, floorY + 6, TW, 0.8); x.fillRect(0, floorY + 15.2, TW, 0.8);
    const g = refl.x;
    for (const wdw of windows) {
      const gg = g.createLinearGradient(0, floorY, 0, H);
      gg.addColorStop(0, rgb([200, 200, 255], 0.3)); gg.addColorStop(1, rgb([200, 200, 255], 0));
      g.fillStyle = gg; g.fillRect(wdw.x + 30, floorY, wdw.w + 10, 30);
    }
  }
  const glassTex = r.texture(glass.c), reflTex = r.texture(refl.c);
  return {
    layers: [{ tex: r.texture(wall.c), factor: 0.2 }, { tex: r.texture(mid.c), factor: 0.5 }, { tex: r.texture(floor.c), factor: 1 }],
    ambient: [0.44, 0.44, 0.6],
    dynamic(d) {
      const { T, t, scroll } = d;
      const offW = scroll * 0.2;
      for (const k of [0, 1]) d.r.draw(glassTex, 0, 0, glassTex.w, glassTex.h, k * TW - (offW % TW), 0, TW, H, { pass: 'glow', color: [1, 1, 1, 0.85 + 0.1 * Math.sin(t * 0.5)] });
      for (const wdw of windows) for (const k of [-1, 0, 1]) {
        const wx = wdw.x + k * TW - (offW % TW);
        if (wx < -120 || wx > 330) continue;
        d.r.light(wx + wdw.w / 2, 70, 90, [0.55, 0.55, 1], 0.55);
        for (let i = 0; i < 3; i++) {
          const c = PANES[(i * 2 + Math.floor(wdw.x / 160)) % PANES.length], a = 0.13 + 0.04 * Math.sin(t * 0.6 + i + wdw.x);
          const x0 = wx + (i * wdw.w) / 3;
          d.r.quad(T.shaft, [0, 0, 1, 1], [x0, wdw.top, x0 + wdw.w / 3, wdw.top, x0 + wdw.w / 3 + 64, floorY + 6, x0 + 52, floorY + 6], [c[0] / 255, c[1] / 255, c[2] / 255, a], 'glow');
        }
        for (let m = 0; m < 10; m++) {
          const u = (hash(m, wdw.x) + t * 0.03 * (1 + hash(m, 2))) % 1, x = wx + 10 + u * 60 + Math.sin(t + m) * 3, y = wdw.top + u * (floorY - wdw.top);
          d.r.draw(T.core, 0, 0, 32, 32, x - 0.6, y - 0.6, 1.2, 1.2, { pass: 'glow', color: [1, 0.95, 0.85, 0.35 + 0.3 * Math.sin(t * 2 + m)] });
        }
      }
      const offM = scroll * 0.5;
      for (const c of candles) for (const k of [-1, 0, 1]) {
        const wx = c.x + k * TW - (offM % TW);
        if (wx < -40 || wx > 360) continue;
        const fl = 0.85 + 0.15 * Math.sin(t * 13 + c.x);
        d.flame(wx, c.y + 0.5, 3.2 * fl, 6 * fl, t + c.x);
        d.r.light(wx, c.y - 3, 60 * fl, [1, 0.72, 0.4], 0.95);
      }
      const offF = scroll % TW;
      for (const k of [0, 1]) d.r.draw(reflTex, 0, 0, reflTex.w, reflTex.h, k * TW - offF - offW * 0 , 0, TW, H, { pass: 'glow', color: [1, 1, 1, 0.5] });
    },
  };
}

// ---------- space ----------

const SECTORS = [
  { sky: [[5, 5, 18], [28, 12, 52]], neb: [[120, 40, 170], [30, 90, 170]], planet: [[240, 160, 90], [190, 90, 60]], ring: [220, 200, 170], belt: 0.35, accent: [0, 210, 255] },
  { sky: [[3, 10, 16], [8, 34, 42]], neb: [[30, 160, 140], [40, 90, 190]], planet: [[160, 220, 245], [60, 110, 190]], moon: true, belt: 0.55, accent: [60, 255, 200] },
  { sky: [[14, 4, 8], [46, 14, 20]], neb: [[200, 60, 40], [220, 140, 40]], planet: [[170, 110, 100], [90, 50, 50]], craters: true, belt: 0.85, accent: [255, 140, 60] },
  { sky: [[10, 4, 20], [38, 10, 44]], neb: [[210, 50, 160], [240, 190, 80]], planet: [[236, 204, 150], [170, 110, 70]], bands: true, ring: [200, 170, 220], belt: 0.45, accent: [255, 90, 200] },
];

function space(r, K, floorY, sector = 0) {
  const S = SECTORS[sector] || SECTORS[0];
  const R = rng(51 + sector);
  const sky = tile(K);
  {
    const x = sky.x;
    x.fillStyle = vgrad(x, 0, H, [[0, S.sky[0]], [1, S.sky[1]]]);
    x.fillRect(0, 0, TW, H);
    const [na, nb] = S.neb;
    noiseFill(x, K, 0, 0, TW, floorY, (px, py) => {
      const n1 = fbm(px / 60, py / 40, 3 + sector, 4, TW / 60), n2 = fbm(px / 40 + 9, py / 30, 7 + sector, 4, TW / 40);
      const a = Math.max(0, n1 - 0.45) * 2.4, b = Math.max(0, n2 - 0.5) * 2.2;
      const c = [na[0] * a + nb[0] * b, na[1] * a + nb[1] * b, na[2] * a + nb[2] * b];
      return [Math.min(255, c[0]), Math.min(255, c[1]), Math.min(255, c[2]), Math.min(255, (a + b) * 170)];
    }, 3);
  }
  const stars = tile(K);
  {
    const x = stars.x;
    for (let i = 0; i < 700; i++) {
      const sx = R() * TW, sy = R() * (floorY - 4), s = R() ** 3 * 1.1 + 0.25, c = [[255, 255, 255], [180, 200, 255], [255, 230, 200]][i % 3];
      x.fillStyle = rgb(c, 0.4 + R() * 0.6); x.beginPath(); x.arc(sx, sy, s, 0, Math.PI * 2); x.fill();
    }
  }
  const belt = tile(K);
  {
    const x = belt.x;
    for (let i = 0; i < 70; i++) {
      if (R() > S.belt + 0.3) continue;
      const ax = R() * TW, ay = floorY * (0.2 + 0.12 * Math.sin(ax * 0.02) + 0.14 * R()), rr = 1 + R() * (1.5 + S.belt * 2.5);
      wrap(ax - rr, rr * 2, (p) => {
        const g = x.createRadialGradient(p + rr - rr * 0.4, ay - rr * 0.4, 0, p + rr, ay, rr * 1.2);
        g.addColorStop(0, rgb([190, 176, 160])); g.addColorStop(0.7, rgb([100, 90, 84])); g.addColorStop(1, rgb([40, 36, 40]));
        x.fillStyle = g; x.beginPath();
        for (let k = 0; k < 8; k++) { const a = (k / 8) * Math.PI * 2, q = rr * (0.8 + 0.3 * hash(i, k)); k ? x.lineTo(p + rr + Math.cos(a) * q, ay + Math.sin(a) * q) : x.moveTo(p + rr + Math.cos(a) * q, ay + Math.sin(a) * q); }
        x.closePath(); x.fill();
      });
    }
  }
  const deck = tile(K);
  {
    const x = deck.x;
    x.fillStyle = vgrad(x, floorY, H, [[0, [70, 78, 104]], [1, [22, 24, 36]]]); x.fillRect(0, floorY, TW, H);
    x.fillStyle = rgb([160, 172, 204]); x.fillRect(0, floorY - 0.5, TW, 1.2);
    for (let px = 0; px < TW; px += 24) {
      x.fillStyle = rgb([0, 0, 0], 0.35); x.fillRect(px, floorY + 1, 0.8, H);
      x.fillStyle = rgb([255, 255, 255], 0.08); x.fillRect(px + 0.8, floorY + 1, 0.5, H);
      for (const ry of [floorY + 6, floorY + 22]) { x.fillStyle = rgb([150, 160, 190]); x.beginPath(); x.arc(px + 4, ry, 0.7, 0, Math.PI * 2); x.fill(); }
    }
    x.fillStyle = rgb([30, 34, 48]); x.fillRect(0, floorY + 2, TW, 2.4);
    // hazard stripes at the far edge
    for (let px = 0; px < TW; px += 6) { x.fillStyle = rgb([220, 180, 40], 0.5); x.beginPath(); x.moveTo(px, H - 4); x.lineTo(px + 3, H - 4); x.lineTo(px + 6, H); x.lineTo(px + 3, H); x.closePath(); x.fill(); }
  }
  // planet canvas
  const pr = 26;
  const planet = document.createElement('canvas'); planet.width = planet.height = Math.round(pr * 2.6 * 2 * K);
  {
    const x = planet.getContext('2d'), s = planet.width / (pr * 5.2);
    x.scale(s, s); x.translate(pr * 2.6, pr * 2.6);
    const at = x.createRadialGradient(0, 0, pr * 0.9, 0, 0, pr * 1.5);
    at.addColorStop(0, rgb(S.planet[0], 0.35)); at.addColorStop(1, rgb(S.planet[0], 0));
    x.fillStyle = at; x.beginPath(); x.arc(0, 0, pr * 1.5, 0, Math.PI * 2); x.fill();
    x.save(); x.beginPath(); x.arc(0, 0, pr, 0, Math.PI * 2); x.clip();
    x.fillStyle = vgrad(x, -pr, pr, [[0, S.planet[0]], [1, S.planet[1]]]); x.fillRect(-pr, -pr, pr * 2, pr * 2);
    if (S.bands) for (let k = -pr; k < pr; k += 3) { x.fillStyle = rgb([0, 0, 0], 0.08 + 0.08 * Math.sin(k)); x.fillRect(-pr, k, pr * 2, 1.6); }
    if (S.craters) for (let k = 0; k < 14; k++) { x.fillStyle = rgb([0, 0, 0], 0.18); x.beginPath(); x.arc((hash(k, 1) - 0.5) * pr * 1.6, (hash(k, 2) - 0.5) * pr * 1.6, 1 + hash(k, 3) * 4, 0, Math.PI * 2); x.fill(); }
    if (!S.bands && !S.craters) noiseFill(x, K, -pr, -pr, pr * 2, pr * 2, (px, py) => { const n = fbm(px / 9 + 5, py / 9, 8, 4); return [255, 255, 255, n > 0.55 ? (n - 0.55) * 400 : 0]; }, 1);
    const sh = x.createRadialGradient(-pr * 0.45, -pr * 0.45, pr * 0.1, 0, 0, pr * 1.15);
    sh.addColorStop(0, rgb([255, 255, 255], 0.18)); sh.addColorStop(0.55, rgb([0, 0, 0], 0)); sh.addColorStop(1, rgb([0, 0, 10], 0.85));
    x.fillStyle = sh; x.fillRect(-pr, -pr, pr * 2, pr * 2);
    x.restore();
    if (S.ring) { x.strokeStyle = rgb(S.ring, 0.75); x.lineWidth = 2.6; x.beginPath(); x.ellipse(0, 0, pr * 1.9, pr * 0.36, -0.25, -0.2, Math.PI + 0.2); x.stroke(); x.strokeStyle = rgb(S.ring, 0.35); x.lineWidth = 1; x.beginPath(); x.ellipse(0, 0, pr * 2.15, pr * 0.42, -0.25, -0.2, Math.PI + 0.2); x.stroke(); }
  }
  const planetTex = r.texture(planet);
  const accent = S.accent.map((v) => v / 255);
  return {
    layers: [{ tex: r.texture(sky.c), factor: 0.02 }, { tex: r.texture(stars.c), factor: 0.06, after: 'planet' }, { tex: r.texture(belt.c), factor: 0.35 }, { tex: r.texture(deck.c), factor: 1 }],
    ambient: [0.58, 0.6, 0.76],
    dynamic(d, phase) {
      const { T, t, scroll } = d;
      if (phase === 'planet') return;
      for (let i = 0; i < 9; i++) {
        const x = ((hash(i, 71 + sector) * 480 - t * 1.5 - scroll * 0.1) % 340 + 340) % 340 - 10, y = hash(i, 72 + sector) * (floorY * 0.75);
        const b = 0.5 + 0.5 * Math.sin(t * (1 + hash(i, 3)) + i * 2);
        d.r.draw(T.spark, 0, 0, 32, 32, x - 5, y - 5, 10, 10, { pass: 'glow', color: [0.85, 0.9, 1, 0.5 + 0.5 * b] });
      }
      const st = (t * 0.25) % 6;
      if (st < 0.8) {
        const k = st / 0.8, sx = 60 + k * 220, sy = 20 + k * 50;
        d.r.line(T.line, sx - 26, sy - 8, sx, sy, 2.2, [1, 1, 1, 0.9 * Math.sin(k * Math.PI)]);
      }
      for (let px = -((scroll + t * 8) % 12); px < 330; px += 12) {
        const a = 0.5 + 0.4 * Math.sin(t * 3 - px * 0.05);
        d.r.draw(T.pixel, 0, 0, 2, 2, px, floorY + 2.4, 6, 1.4, { pass: 'glow', color: [...accent, a] });
      }
      for (let i = 0; i < 5; i++) d.r.light(i * 72 + 20, floorY + 2, 60, accent, 0.45);
    },
    planet(d) {
      const x = 250 - d.scroll * 0.04, y = 44, s = pr * 5.2;
      d.r.draw(planetTex, 0, 0, planetTex.w, planetTex.h, x - s / 2, y - s / 2, s, s, {});
    },
  };
}

// ---------- entry ----------

export const BIOMES = { dungeon, forest, lava, castle, space };

// Build (or reuse) the backdrop for a biome at resolution K (device px per
// logical px, capped by the caller).
export function buildBackdrop(r, biome, K, floorY, sector) {
  const fn = BIOMES[biome] || dungeon;
  const bd = fn(r, K, floorY, sector);
  bd.biome = biome; bd.K = K; bd.sector = sector;
  bd.free = () => { for (const l of bd.layers) r.free(l.tex); };
  return bd;
}

// Draw all layers with parallax, the dynamic pieces, and lights.
export function drawBackdrop(bd, d) {
  const { r, scroll } = d;
  for (const l of bd.layers) {
    const off = ((scroll * l.factor) % TW + TW) % TW;
    for (const k of [-1, 0, 1]) {
      const x = k * TW - off;
      if (x > 340 || x + TW < -20) continue;
      r.draw(l.tex, 0, 0, l.tex.w, l.tex.h, x, 0, TW, H, {});
    }
    if (l.after && bd[l.after]) bd[l.after](d);
  }
  bd.dynamic(d);
}

// Retro keeps the biome but dims it so characters own the bright levels.
export { SECTORS };
void noise2;
