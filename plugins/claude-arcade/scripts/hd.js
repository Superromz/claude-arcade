'use strict';
// HD rendering: draws the battle scene as a real image with the Kitty graphics
// protocol instead of '▀' half-blocks, so a game pixel is a few screen pixels
// instead of a whole character cell.
//
//   detect / probe    decide whether HD is on and measure the cell size in px
//   renderScene       logical PixelCanvas -> RGBA at device resolution
//                     (edge-smoothed upscale, soft backdrop, bloom, vignette,
//                     labels rasterized with a built-in 5x7 font)
//   Presenter         Kitty encoding, placement, frame skipping on backpressure
//   png               minimal PNG encoder (for --snapshot-hd)
//
// Zero dependencies: only node's zlib.

const zlib = require('zlib');

// ---------- detection ----------

const state = { on: false, cw: 8, ch: 17, source: 'default', graphics: null, render: true, quality: 1 };

// Env var beats config, config beats auto-detection.
function detect(env = process.env, cfg = {}) {
  const v = String(env.ARCADE_HD || '').toLowerCase();
  if (['1', 'true', 'on', 'yes'].includes(v)) return { on: true, why: 'ARCADE_HD' };
  if (['0', 'false', 'off', 'no'].includes(v)) return { on: false, why: 'ARCADE_HD' };
  if (cfg && cfg.hd === true) return { on: true, why: 'config' };
  if (cfg && cfg.hd === false) return { on: false, why: 'config' };
  const tp = String(env.TERM_PROGRAM || ''), term = String(env.TERM || '');
  const capable = tp === 'WarpTerminal' || !!env.KITTY_WINDOW_ID || term === 'xterm-kitty' ||
    tp === 'WezTerm' || /ghostty/i.test(tp) || /ghostty/i.test(term);
  // On Windows the console layer can drop image escapes, so HD waits for an
  // explicit opt-in there (after `arcade --hd-test` shows the test square).
  if (capable && process.platform === 'win32') return { on: false, why: 'Windows: opt in with g or /claude-arcade:toggle hd after --hd-test' };
  return { on: capable, why: capable ? `auto (${tp || term || 'kitty'})` : 'auto' };
}

// Ask the terminal for its cell size (CSI 16 t, else CSI 14 t / window size)
// and whether it answers a Kitty graphics query. DA1 (CSI c) is the sentinel:
// every terminal answers it, so we stop waiting as soon as it arrives.
// keep: the game is already reading input; leave raw mode and flow alone.
function probe(stdin, stdout, ms = 300, { keep = false } = {}) {
  return new Promise((resolve) => {
    const res = { cw: 0, ch: 0, graphics: null, da1: false, source: 'default' };
    if (!stdin || !stdin.isTTY || !stdout || !stdout.isTTY) return resolve(res);
    let buf = '', done = false;
    const wasRaw = stdin.isRaw;
    const finish = () => {
      if (done) return; done = true;
      clearTimeout(timer);
      stdin.removeListener('data', onData);
      if (!keep) { try { stdin.setRawMode(wasRaw); } catch {} stdin.pause(); }
      let m = buf.match(/\x1b\[6;(\d+);(\d+)t/);
      if (m && +m[1] > 0 && +m[2] > 0) Object.assign(res, { ch: +m[1], cw: +m[2], source: 'CSI 16 t' });
      else if ((m = buf.match(/\x1b\[4;(\d+);(\d+)t/)) && stdout.columns && stdout.rows && +m[1] > 0) {
        Object.assign(res, { ch: Math.round(+m[1] / stdout.rows), cw: Math.round(+m[2] / stdout.columns), source: 'CSI 14 t' });
      }
      res.da1 = /\x1b\[\?[\d;]*c/.test(buf);
      if (/\x1b_Gi=31;OK/.test(buf)) res.graphics = true;
      else if (/\x1b_Gi=31;/.test(buf)) res.graphics = false;
      else if (res.da1) res.graphics = false; // answered DA1 but not the graphics query
      resolve(res);
    };
    const onData = (d) => { buf += Buffer.isBuffer(d) ? d.toString('latin1') : String(d); if (/\x1b\[\?[\d;]*c/.test(buf)) setTimeout(finish, 15); };
    const timer = setTimeout(finish, ms);
    if (!keep) try { stdin.setRawMode(true); } catch {}
    stdin.on('data', onData);
    stdin.resume();
    stdout.write('\x1b_Gi=31,s=1,v=1,a=q,t=d,f=24;AAAA\x1b\\\x1b[16t\x1b[14t\x1b[c');
  });
}

// Detect + probe; fills `state`. Call once at startup before input handlers.
async function init({ stdin = process.stdin, stdout = process.stdout, env = process.env, cfg = {} } = {}) {
  const det = detect(env, cfg);
  state.on = det.on; state.why = det.why;
  if (!det.on) return state;
  const cell = String(env.ARCADE_CELL || '').match(/^(\d+)x(\d+)$/);
  if (cell) Object.assign(state, { cw: +cell[1], ch: +cell[2], source: 'ARCADE_CELL' });
  else {
    const p = await probe(stdin, stdout);
    state.graphics = p.graphics;
    if (p.cw >= 4 && p.ch >= 8) Object.assign(state, { cw: p.cw, ch: p.ch, source: p.source });
  }
  return state;
}

// ---------- 5x7 bitmap font ----------
// Column-major, LSB = top row (row 7 is for descenders). ASCII 32..126.
const FONT_HEX =
  '0000000000' + '00005f0000' + '0007000700' + '147f147f14' + '242a7f2a12' + '2313086462' + '3649552250' + '0005030000' +
  '001c224100' + '0041221c00' + '082a1c2a08' + '08083e0808' + '0050300000' + '0808080808' + '0060600000' + '2010080402' +
  '3e5149453e' + '00427f4000' + '4261514946' + '2141454b31' + '1814127f10' + '2745454539' + '3c4a494930' + '0171090503' +
  '3649494936' + '064949291e' + '0036360000' + '0056360000' + '0814224100' + '1414141414' + '0041221408' + '0201510906' +
  '3249794136' + '7e1111117e' + '7f49494936' + '3e41414122' + '7f4141221c' + '7f49494941' + '7f09090101' + '3e41415132' +
  '7f0808087f' + '00417f4100' + '2040413f01' + '7f08142241' + '7f40404040' + '7f0204027f' + '7f0408107f' + '3e4141413e' +
  '7f09090906' + '3e4151215e' + '7f09192946' + '4649494931' + '01017f0101' + '3f4040403f' + '1f2040201f' + '7f2018207f' +
  '6314081463' + '0304780403' + '6151494543' + '007f414100' + '0204081020' + '0041417f00' + '0402010204' + '4040404040' +
  '0001020400' + '2054545478' + '7f48444438' + '3844444420' + '384444487f' + '3854545418' + '087e090102' + '081454543c' +
  '7f08040478' + '00447d4000' + '2040443d00' + '007f102844' + '00417f4000' + '7c04180478' + '7c08040478' + '3844444438' +
  '7c14141408' + '081414187c' + '7c08040408' + '4854545420' + '043f444020' + '3c4040207c' + '1c2040201c' + '3c4030403c' +
  '4428102844' + '0c5050503c' + '4464544c44' + '0008364100' + '00007f0000' + '0041360800' + '0804081008';
const EXTRA = {
  g: '98a4a4a47c', j: '8080847d00', p: 'fc24242418', q: '18242424fc', y: '1ca0a0a07c',
  '·': '0000080000', '•': '001c1c1c00', '◉': '1c3e363e1c', '…': '4000400040', '♪': '20701f0200', '♫': '60701e637f',
  '♥': '0c1e3c1e0c', '★': '0a1e7c1e0a', '▶': '7f3e1c0800', '◀': '081c3e7f00', '◆': '081c3e1c08', '─': '0808080808',
  '✦': '0808361408', '⚔': '4122140814', '✓': '1020100804', '✗': '2214081422', '×': '2214081422', '←': '081c2a0808',
  '→': '08082a1c08', '↑': '0402ff0204', '↓': '2040ff4020', '°': '0006090600', '–': '0808080808', '—': '0808080808',
  '“': '0003000300', '”': '0003000300', '‘': '0003000000', '’': '0003000000', '█': '7f7f7f7f7f',
};
const glyphCache = new Map();
function glyph(ch) {
  let g = glyphCache.get(ch);
  if (g) return g;
  const code = ch.codePointAt(0);
  let hex = EXTRA[ch];
  if (!hex && code >= 32 && code <= 126) hex = FONT_HEX.slice((code - 32) * 10, (code - 32) * 10 + 10);
  if (!hex) hex = code > 0x2000 ? '003e3e3e00' : FONT_HEX.slice(31 * 10, 32 * 10); // symbols: a block, else '?'
  g = [];
  for (let i = 0; i < 5; i++) g.push(parseInt(hex.slice(i * 2, i * 2 + 2), 16));
  glyphCache.set(ch, g);
  return g;
}

// Draw a string into an RGBA buffer. (x, y) is the top-left of the first
// glyph box; each char advances `adv` px. Bright text gets a dark outline.
function drawText(buf, W, H, x, y, str, color, { scale = 1, adv = 6 * scale, bold = false, outline = null } = {}) {
  const chars = [...str];
  const put = (px, py, c, a = 1) => {
    if (px < 0 || py < 0 || px >= W || py >= H) return;
    const o = (py * W + px) * 4;
    buf[o] = buf[o] + (c[0] - buf[o]) * a; buf[o + 1] = buf[o + 1] + (c[1] - buf[o + 1]) * a; buf[o + 2] = buf[o + 2] + (c[2] - buf[o + 2]) * a; buf[o + 3] = 255;
  };
  const cells = (fn) => chars.forEach((ch, k) => {
    const g = glyph(ch), gx = x + k * adv + Math.floor((adv - (5 + (bold ? 1 : 0)) * scale) / 2);
    for (let col = 0; col < 5; col++) for (let row = 0; row < 8; row++) if (g[col] >> row & 1) {
      fn(gx + col * scale, y + row * scale);
      if (bold) fn(gx + (col + 1) * scale, y + row * scale);
    }
  });
  if (outline) cells((px, py) => {
    for (let j = -1; j <= scale; j++) for (let i = -1; i <= scale; i++) put(px + i, py + j, outline, 0.85);
  });
  cells((px, py) => { for (let j = 0; j < scale; j++) for (let i = 0; i < scale; i++) put(px + i, py + j, color); });
}

// ---------- scene rendering ----------

const clamp8 = (v) => (v < 0 ? 0 : v > 255 ? 255 : v);
const lum = (c) => (c >> 16) * 3 + ((c >> 8) & 255) * 6 + (c & 255);
const sim = (a, b) => Math.abs((a >> 16) - (b >> 16)) + Math.abs(((a >> 8) & 255) - ((b >> 8) & 255)) + Math.abs((a & 255) - (b & 255)) <= 30;

// Pick the pitch (device px per game pixel) for a scene devH device px tall.
// Aim for ~90 game px of height (the 24px hero is a quarter of the scene in a
// small pane), but never coarser than 10 device px per game pixel: in big
// panes the world gets wider and taller instead of blockier.
function pitchFor(devH) {
  const env = Number(process.env.ARCADE_HD_PITCH);
  if (env >= 1) return Math.floor(env);
  return Math.max(3, Math.min(10, Math.round(devH / 90)));
}
// Label font: 5x7 glyphs at an integer scale close to the terminal's text size.
const fontScale = (ch) => Math.max(1, Math.round(ch / 8));

// Per-pitch lookup: which corner triangle each sub-pixel falls in and how much
// (anti-aliased) coverage it gets. Corners are cut along a 45° line, EPX-style.
const subCache = new Map();
function subTable(p) {
  let t = subCache.get(p);
  if (t) return t;
  const corner = new Uint8Array(p * p), w = new Float32Array(p * p);
  for (let j = 0; j < p; j++) for (let i = 0; i < p; i++) {
    const u = (i + 0.5) / p, v = (j + 0.5) / p;
    const d = [0.5 - (u + v), 0.5 - (1 - u + v), 0.5 - (u + 1 - v), 0.5 - (2 - u - v)];
    let best = 0, bw = 0;
    for (let k = 0; k < 4; k++) {
      const cov = Math.max(0, Math.min(1, (d[k] * p) / Math.SQRT2 + 0.5));
      if (cov > bw) { bw = cov; best = k + 1; }
    }
    corner[j * p + i] = bw > 0 ? best : 0; w[j * p + i] = bw;
  }
  t = { corner, w };
  subCache.set(p, t);
  return t;
}

// Separable box blur (in place on three float planes), run twice ≈ gaussian.
function blur(planes, w, h, r) {
  const tmp = new Float32Array(Math.max(w, h));
  for (const a of planes) for (let pass = 0; pass < 2; pass++) {
    for (let y = 0; y < h; y++) {
      const o = y * w;
      for (let x = 0; x < w; x++) tmp[x] = a[o + x];
      let s = 0;
      for (let k = -r; k <= r; k++) s += tmp[Math.max(0, Math.min(w - 1, k))];
      for (let x = 0; x < w; x++) {
        a[o + x] = s / (2 * r + 1);
        s += tmp[Math.min(w - 1, x + r + 1)] - tmp[Math.max(0, x - r)];
      }
    }
    for (let x = 0; x < w; x++) {
      for (let y = 0; y < h; y++) tmp[y] = a[y * w + x];
      let s = 0;
      for (let k = -r; k <= r; k++) s += tmp[Math.max(0, Math.min(h - 1, k))];
      for (let y = 0; y < h; y++) {
        a[y * w + x] = s / (2 * r + 1);
        s += tmp[Math.min(h - 1, y + r + 1)] - tmp[Math.max(0, y - r)];
      }
    }
  }
}

// Bright-pass + two blur radii at logical resolution (cheap: ~100x70 px).
function bloomPlanes(col, lw, lh) {
  const n = lw * lh;
  const a = [new Float32Array(n), new Float32Array(n), new Float32Array(n)];
  const b = [new Float32Array(n), new Float32Array(n), new Float32Array(n)];
  let any = false;
  for (let i = 0; i < n; i++) {
    const c = col[i], r = c >> 16, g = (c >> 8) & 255, bl = c & 255;
    const m = Math.max(r, g, bl), mn = Math.min(r, g, bl);
    let k = (m - 165) / 90 + (m - mn) / 600;
    if (k <= 0) continue;
    k = Math.min(1, k); k *= k;
    any = true;
    a[0][i] = b[0][i] = r * k; a[1][i] = b[1][i] = g * k; a[2][i] = b[2][i] = bl * k;
  }
  if (!any) return null;
  blur(a, lw, lh, 1);
  blur(b, lw, lh, 4);
  for (let c = 0; c < 3; c++) for (let i = 0; i < n; i++) a[c][i] = a[c][i] * 0.55 + b[c][i] * 0.75;
  return a;
}

let lastBuf = null;
const frameBuffer = (n) => (lastBuf && lastBuf.length === n ? lastBuf : (lastBuf = Buffer.allocUnsafe(n)));

// Render a logical PixelCanvas to RGBA at `pitch` device px per game pixel.
//   outW/outH  crop of the upscaled image (the scene's cell rect in px)
//   adv        px per label character
//   edges      'fg' (sprites, props, particles) or 'all': which pixels get their
//            stair-step corners cut; the backdrop stays crisp by default
// The vignette is applied per game pixel, so device rows inside one game pixel
// stay identical and deflate squeezes them well; only bloom is per device px.
function renderScene(pc, { pitch, outW, outH, adv = 12, shakeY = 0, bloom = 0.6, vignette = 0.25, edges = process.env.ARCADE_HD_EDGES || 'fg' }) {
  const lw = pc.w, lh = pc.h, n = lw * lh, p = pitch;
  const W = outW || lw * p, H = outH || lh * p;
  const col = new Int32Array(n);
  for (let y = 0; y < lh; y++) {
    const v = (y / lh) * 2 - 1, vy = 1 - vignette * Math.abs(v) ** 3;
    for (let x = 0; x < lw; x++) {
      const u = (x / lw) * 2 - 1, k = vy * (1 - vignette * 0.3 * u * u), i = y * lw + x;
      const c = pc.px[i] || [0, 0, 0];
      col[i] = (clamp8(c[0] * k | 0) << 16) | (clamp8(c[1] * k | 0) << 8) | clamp8(c[2] * k | 0);
    }
  }
  const mask = edges === 'fg' ? pc.fgMask || null : null;

  // Corner donors: index of the neighbour whose colour fills that corner
  // triangle (EPX rule, cut along a 45° line), or -1.
  const donor = [new Int32Array(n).fill(-1), new Int32Array(n).fill(-1), new Int32Array(n).fill(-1), new Int32Array(n).fill(-1)];
  for (let y = 0; y < lh; y++) for (let x = 0; x < lw; x++) {
    const i = y * lw + x;
    if (mask && !mask[i]) continue;
    const u = y > 0 ? i - lw : i, d = y < lh - 1 ? i + lw : i, l = x > 0 ? i - 1 : i, r = x < lw - 1 ? i + 1 : i;
    const C = col[i], U = col[u], D = col[d], Lf = col[l], R = col[r];
    // In a 2x2 checker both diagonals would cut each other into an X: let the
    // darker colour (usually the outline) keep its diagonal connection.
    const ok = (diag, donorC) => !sim(col[diag], C) || lum(donorC) < lum(C);
    if (sim(Lf, U) && !sim(Lf, D) && !sim(U, R) && !sim(U, C) && ok(u - (x > 0 ? 1 : 0), U)) donor[0][i] = u;
    if (sim(U, R) && !sim(U, Lf) && !sim(R, D) && !sim(U, C) && ok(u + (x < lw - 1 ? 1 : 0), U)) donor[1][i] = u;
    if (sim(D, Lf) && !sim(D, R) && !sim(Lf, U) && !sim(D, C) && ok(d - (x > 0 ? 1 : 0), D)) donor[2][i] = d;
    if (sim(R, D) && !sim(R, U) && !sim(D, Lf) && !sim(D, C) && ok(d + (x < lw - 1 ? 1 : 0), D)) donor[3][i] = d;
  }
  const bl = bloom > 0 ? bloomPlanes(col, lw, lh) : null;
  // Where bloom is visible at all (dilated by one pixel for the bilinear taps).
  let lit = null;
  if (bl) {
    const raw = new Uint8Array(n);
    for (let i = 0; i < n; i++) raw[i] = bl[0][i] + bl[1][i] + bl[2][i] > 3 ? 1 : 0;
    lit = new Uint8Array(n);
    for (let y = 0; y < lh; y++) for (let x = 0; x < lw; x++) {
      let on = 0;
      for (let j = -1; j <= 1 && !on; j++) for (let k = -1; k <= 1; k++) {
        const yy = y + j, xx = x + k;
        if (yy >= 0 && xx >= 0 && yy < lh && xx < lw && raw[yy * lw + xx]) { on = 1; break; }
      }
      lit[y * lw + x] = on;
    }
  }

  // Per output column / row: logical index, sub-pixel, bilinear taps.
  const mk = (N, L) => {
    const ix = new Int32Array(N), sub = new Int32Array(N), a0 = new Int32Array(N), a1 = new Int32Array(N), t = new Float32Array(N);
    for (let k = 0; k < N; k++) {
      const q = Math.min(L * p - 1, Math.max(0, k));
      ix[k] = Math.floor(q / p); sub[k] = q % p;
      const f = (q + 0.5) / p - 0.5, f0 = Math.floor(f);
      a0[k] = Math.max(0, Math.min(L - 1, f0)); a1[k] = Math.max(0, Math.min(L - 1, f0 + 1)); t[k] = f - f0;
    }
    return { ix, sub, a0, a1, t };
  };
  const cx = mk(W, lw), cy = mk(H, lh);
  const { corner, w: cov } = subTable(p);
  const k = bloom;

  const out = frameBuffer(W * H * 4);
  for (let Y = 0; Y < H; Y++) {
    const sy = Math.max(0, Y - shakeY);
    const ly = cy.ix[sy], j = cy.sub[sy], y0 = cy.a0[sy] * lw, y1 = cy.a1[sy] * lw, ty = cy.t[sy];
    let o = Y * W * 4;
    for (let X = 0; X < W; X++, o += 4) {
      const i = ly * lw + cx.ix[X], c = col[i];
      let r = c >> 16, g = (c >> 8) & 255, b = c & 255;
      const s = j * p + cx.sub[X], cr = corner[s];
      if (cr) {
        const dn = donor[cr - 1][i];
        if (dn >= 0) {
          const dc = col[dn], a = cov[s];
          r += ((dc >> 16) - r) * a; g += (((dc >> 8) & 255) - g) * a; b += ((dc & 255) - b) * a;
        }
      }
      if (lit && lit[i]) {
        const x0 = cx.a0[X], x1 = cx.a1[X], tx = cx.t[X];
        const i00 = y0 + x0, i01 = y0 + x1, i10 = y1 + x0, i11 = y1 + x1;
        const w00 = (1 - tx) * (1 - ty) * k, w01 = tx * (1 - ty) * k, w10 = (1 - tx) * ty * k, w11 = tx * ty * k;
        const P = bl[0], Q = bl[1], Z = bl[2];
        const br = P[i00] * w00 + P[i01] * w01 + P[i10] * w10 + P[i11] * w11;
        const bg = Q[i00] * w00 + Q[i01] * w01 + Q[i10] * w10 + Q[i11] * w11;
        const bb = Z[i00] * w00 + Z[i01] * w01 + Z[i10] * w10 + Z[i11] * w11;
        // Screen blend: brightens without clipping to white.
        r = 255 - ((255 - r) * (255 - (br > 255 ? 255 : br))) / 255;
        g = 255 - ((255 - g) * (255 - (bg > 255 ? 255 : bg))) / 255;
        b = 255 - ((255 - b) * (255 - (bb > 255 ? 255 : bb))) / 255;
      }
      out[o] = r; out[o + 1] = g; out[o + 2] = b; out[o + 3] = 255;
    }
  }
  drawLabels(out, W, H, pc, p, adv, shakeY);
  return { rgba: out, w: W, h: H };
}

// Labels are placed on the logical canvas as (col,row) text cells. A run of
// adjacent cells starts at its scaled column and then advances one terminal
// cell per character (same rule as the half-block renderer).
function drawLabels(buf, W, H, pc, p, adv, shakeY) {
  if (!pc.text || !pc.text.size) return;
  const cells = [...pc.text].map(([k, v]) => [...k.split(',').map(Number), v]).sort((a, b) => a[1] - b[1] || a[0] - b[0]);
  const scale = Math.max(1, Math.floor(adv / 6));
  const runs = [];
  let cur = null;
  for (const [c, r, v] of cells) {
    if (cur && r === cur.r && c === cur.last + 1 && v[1] === cur.fg && !!v[2] === cur.bold) { cur.s += v[0]; cur.last = c; continue; }
    if (cur && r === cur.r && c === cur.last + 1) { // style change inside a run: keep the pen position
      const x = cur.x + [...cur.s].length * adv;
      runs.push(cur); cur = { r, x, last: c, s: v[0], fg: v[1], bold: !!v[2] };
      continue;
    }
    if (cur) runs.push(cur);
    cur = { r, x: c * p, last: c, s: v[0], fg: v[1], bold: !!v[2] };
  }
  if (cur) runs.push(cur);
  for (const run of runs) {
    const fg = run.fg || [255, 255, 255];
    const lum = fg[0] * 0.3 + fg[1] * 0.59 + fg[2] * 0.11;
    const y = Math.round((2 * run.r + 1) * p - (7 * scale) / 2) + shakeY;
    drawText(buf, W, H, run.x, y, run.s, fg, { scale, adv, bold: run.bold, outline: lum > 90 ? [14, 10, 22] : null });
  }
}

// ---------- Kitty graphics protocol ----------

const APC = '\x1b_G', ST = '\x1b\\';

// One image transmission, chunked into 4096-byte base64 payloads.
function kittyTransmit(rgba, w, h, { id, action = 'T', cols, rows, compress = true, level = 1, extra = '' }) {
  const data = compress ? zlib.deflateSync(rgba, { level }) : rgba;
  const b64 = data.toString('base64');
  let ctrl = `a=${action},f=32,s=${w},v=${h},i=${id},q=2${compress ? ',o=z' : ''}`;
  if (cols && rows) ctrl += `,c=${cols},r=${rows}`;
  if (action === 'T') ctrl += ',C=1';
  ctrl += extra;
  const parts = [];
  for (let k = 0; k < b64.length || k === 0; k += 4096) {
    const chunk = b64.slice(k, k + 4096), more = k + 4096 < b64.length ? 1 : 0;
    parts.push(k === 0 ? `${APC}${ctrl},m=${more};${chunk}${ST}` : `${APC}m=${more};${chunk}${ST}`);
  }
  return parts.join('');
}
const kittyPlace = ({ id, pid = 1, x, y, w, h, cols, rows }) =>
  `${APC}a=p,i=${id},p=${pid},x=${x},y=${y},w=${w},h=${h},c=${cols},r=${rows},C=1,q=2${ST}`;
const kittyDelete = (id) => `${APC}a=d,d=I,i=${id},q=2${ST}`;

// Parse our own escape output back into images (used by tests).
function kittyDecode(s) {
  const imgs = [];
  let cur = null;
  for (const m of s.matchAll(/\x1b_G([^;\x1b]*)(?:;([^\x1b]*))?\x1b\\/g)) {
    const ctrl = Object.fromEntries(m[1].split(',').filter(Boolean).map((kv) => kv.split('=')));
    if (!cur && ctrl.a && ctrl.a !== 'T' && ctrl.a !== 't') continue;
    if (!cur) cur = { ctrl, b64: '' };
    cur.b64 += m[2] || '';
    if (ctrl.m === '0' || ctrl.m === undefined) {
      let data = Buffer.from(cur.b64, 'base64');
      if (cur.ctrl.o === 'z') data = zlib.inflateSync(data);
      imgs.push({ ctrl: cur.ctrl, w: +cur.ctrl.s, h: +cur.ctrl.v, rgba: data });
      cur = null;
    }
  }
  return imgs;
}

// Sends frames with double-buffered ids (the new image is placed before the
// old one is deleted, so there is no blank flash) and skips frames while the
// previous write is still draining.
class Presenter {
  constructor(out = process.stdout) {
    this.out = out; this.ids = [7301, 7302]; this.flip = 0; this.shown = null;
    this.draining = false; this.cost = 30; this.every = 1; this.n = 0; this.skipped = 0;
  }
  // Should this tick render a fresh HD image?
  ready() {
    if (this.draining) { this.skipped++; return false; }
    return this.n++ % this.every === 0;
  }
  write(s) {
    if (!s) return;
    if (!this.out.write(s)) { this.draining = true; this.out.once('drain', () => { this.draining = false; }); }
  }
  // frame: { rgba, w, h, cols, rows }, at 1-based terminal (row, col). clean:
  // row ranges [from, to) inside the image that are not covered by text overlays.
  present(frame, row, col, clean = null) {
    const t0 = Date.now();
    const id = this.ids[this.flip ^= 1];
    let s;
    const all = !clean || (clean.length === 1 && clean[0][0] === 0 && clean[0][1] === frame.rows);
    if (all) s = `\x1b[${row};${col}H` + kittyTransmit(frame.rgba, frame.w, frame.h, { id, cols: frame.cols, rows: frame.rows });
    else {
      s = kittyTransmit(frame.rgba, frame.w, frame.h, { id, action: 't' });
      const rowPx = frame.h / frame.rows;
      clean.forEach(([a, b], k) => {
        const y = Math.round(a * rowPx), h = Math.round(b * rowPx) - y;
        if (h > 0) s += `\x1b[${row + a};${col}H` + kittyPlace({ id, pid: k + 1, x: 0, y, w: frame.w, h, cols: frame.cols, rows: b - a });
      });
    }
    if (this.shown && this.shown !== id) s += kittyDelete(this.shown);
    this.shown = id;
    this.write(s);
    this.track(Date.now() - t0 + (frame.cost || 0));
  }
  // Adapt: if a frame costs more than ~70ms, render every 2nd/3rd tick and
  // lower the image resolution a notch; recover when there is headroom.
  track(ms) {
    this.cost = this.cost * 0.8 + ms * 0.2;
    this.every = this.cost > 140 ? 3 : this.cost > 70 ? 2 : 1;
    if (this.cost > 110) state.quality = Math.max(0.4, state.quality * 0.9);
    else if (this.cost < 45 && state.quality < 1) state.quality = Math.min(1, state.quality * 1.05);
  }
  hide() {
    if (!this.shown) return '';
    const s = this.ids.map(kittyDelete).join('');
    this.shown = null;
    this.write(s);
    return s;
  }
  deleteAll() { return this.ids.map(kittyDelete).join(''); }
}

// ---------- PNG ----------

const CRC = new Int32Array(256).map((_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c; });
const crc32 = (buf) => { let c = -1; for (let i = 0; i < buf.length; i++) c = CRC[(c ^ buf[i]) & 255] ^ (c >>> 8); return (c ^ -1) >>> 0; };
function png(rgba, w, h) {
  const chunk = (type, data) => {
    const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
    const td = Buffer.concat([Buffer.from(type, 'ascii'), data]);
    const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td));
    return Buffer.concat([len, td, crc]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 6; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  const raw = Buffer.alloc((w * 4 + 1) * h);
  for (let y = 0; y < h; y++) { raw[y * (w * 4 + 1)] = 0; rgba.copy(raw, y * (w * 4 + 1) + 1, y * w * 4, (y + 1) * w * 4); }
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw, { level: 6 })), chunk('IEND', Buffer.alloc(0))]);
}

// ---------- test image ----------

// A 96x96 gradient square with a white frame and "HD" in the middle.
function testImage(size = 96) {
  const buf = Buffer.alloc(size * size * 4);
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const o = (y * size + x) * 4, u = x / (size - 1), v = y / (size - 1);
    const edge = x < 2 || y < 2 || x >= size - 2 || y >= size - 2;
    buf[o] = edge ? 255 : Math.round(255 * u); buf[o + 1] = edge ? 255 : Math.round(255 * v); buf[o + 2] = edge ? 255 : Math.round(255 * (1 - u * v));
    buf[o + 3] = 255;
  }
  drawText(buf, size, size, Math.floor(size / 2) - 18, Math.floor(size / 2) - 10, 'HD', [255, 255, 255], { scale: 3, adv: 18, outline: [0, 0, 0] });
  return { rgba: buf, w: size, h: size };
}

module.exports = { state, detect, probe, init, pitchFor, fontScale, renderScene, drawText, glyph, kittyTransmit, kittyPlace, kittyDelete, kittyDecode, Presenter, png, crc32, testImage };
