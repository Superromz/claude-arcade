// Truecolor pixel renderer for the game pane. Each terminal cell shows two
// vertical pixels using '▀' (top pixel = foreground, bottom = background),
// so a W×H cell area is a W×2H pixel canvas. Also holds the sprites.
'use strict';

const ESC = '\x1b[';
const fgc = ([r, g, b]) => `${ESC}38;2;${r};${g};${b}m`;
const bgc = ([r, g, b]) => `${ESC}48;2;${r};${g};${b}m`;
const clamp = (v) => (v < 0 ? 0 : v > 255 ? 255 : v | 0);
const mix = (a, b, t) => [clamp(a[0] + (b[0] - a[0]) * t), clamp(a[1] + (b[1] - a[1]) * t), clamp(a[2] + (b[2] - a[2]) * t)];
const shade = (c, f) => [clamp(c[0] * f), clamp(c[1] * f), clamp(c[2] * f)];
const hash = (x, y) => { let h = (x * 374761393 + y * 668265263) | 0; h = (h ^ (h >>> 13)) * 1274126177; return ((h ^ (h >>> 16)) >>> 0) / 4294967295; };

class PixelCanvas {
  constructor(cols, rows, bg = [0, 0, 0]) {
    this.cols = cols; this.rows = rows; this.w = cols; this.h = rows * 2;
    this.px = Array.from({ length: this.w * this.h }, () => bg);
    this.text = new Map(); // "col,row" -> [char, fg]
  }
  set(x, y, c) {
    x |= 0; y |= 0;
    if (c && x >= 0 && y >= 0 && x < this.w && y < this.h) { const i = y * this.w + x; this.px[i] = c; if (this.fgMask) this.fgMask[i] = 1; }
  }
  // HD renderer: after the backdrop is drawn, remember which pixels sprites,
  // particles and props set; the upscaler smooths only their stair-step edges.
  beginForeground() { if (this.trackFg) this.fgMask = new Uint8Array(this.w * this.h); }
  get(x, y) { return this.px[(y | 0) * this.w + (x | 0)]; }
  rect(x, y, w, h, c) { for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) this.set(x + i, y + j, c); }
  // Additive light: brighten pixels around (cx, cy) toward color.
  glow(cx, cy, r, color, strength) {
    for (let y = Math.max(0, cy - r | 0); y < Math.min(this.h, cy + r); y++) {
      for (let x = Math.max(0, cx - r | 0); x < Math.min(this.w, cx + r); x++) {
        const d = Math.hypot(x - cx, (y - cy) * 1.1) / r;
        if (d < 1) this.px[y * this.w + x] = mix(this.px[y * this.w + x], color, strength * (1 - d) * (1 - d));
      }
    }
  }
  // Draw a sprite: rows of palette keys, '.' is transparent.
  sprite(x, y, rows, pal, { flip = false, tint = null, alpha = 1 } = {}) {
    const w = Math.max(...rows.map((r) => r.length));
    rows.forEach((row, j) => {
      for (let i = 0; i < row.length; i++) {
        const k = row[i];
        if (k === '.' || !pal[k]) continue;
        if (alpha < 1 && hash(i + x, j + y + (Date.now() >> 7)) > alpha) continue;
        const c = tint ? mix(pal[k], tint[0], tint[1]) : pal[k];
        this.set(flip ? x + w - 1 - i : x + i, y + j, c);
      }
    });
  }
  label(col, row, str, fg, bold = false) {
    let i = 0;
    for (const ch of str) this.text.set(`${col + i++},${row}`, [ch, fg, bold]);
  }
  map(fn) { this.px = this.px.map(fn); }
  lines() {
    const out = [];
    for (let r = 0; r < this.rows; r++) {
      let s = '', cf = '', cb = '';
      for (let x = 0; x < this.cols; x++) {
        const top = this.px[(2 * r) * this.w + x], bot = this.px[(2 * r + 1) * this.w + x];
        const t = this.text.get(`${x},${r}`);
        let ch, f, b;
        if (t) { ch = t[0]; f = (t[2] ? `${ESC}1m` : `${ESC}22m`) + fgc(t[1]); b = bgc(mix(top, bot, 0.5)); }
        else if (top === bot || (top[0] === bot[0] && top[1] === bot[1] && top[2] === bot[2])) { ch = ' '; f = cf; b = bgc(bot); }
        else { ch = '▀'; f = fgc(top); b = bgc(bot); }
        if (f !== cf) { s += f; cf = f; }
        if (b !== cb) { s += b; cb = b; }
        s += ch;
      }
      out.push(s + `${ESC}0m`);
    }
    return out;
  }
}

// ---------- palettes ----------

const BASE = {
  K: [28, 22, 38], S: [240, 196, 150], E: [30, 30, 45], W: [236, 236, 245], B: [214, 170, 60],
  L: [72, 52, 44], w: [120, 80, 45], G: [120, 124, 140], g: [80, 84, 100], Y: [255, 214, 80], O: [255, 160, 40],
  b: [140, 88, 50], F: [255, 220, 90], f: [255, 140, 40], r: [210, 60, 30], P: [170, 110, 255], p: [110, 60, 200],
};
// Hero outfits: hat (H/h) and robe (R/r). Character customization plugs in here.
const OUTFITS = {
  wizard: { H: [110, 70, 200], h: [150, 110, 235], R: [60, 90, 200], r: [40, 60, 150] },
  astronaut: { H: [220, 226, 240], h: [140, 200, 255], R: [230, 232, 240], r: [170, 176, 190], W: [120, 200, 255], B: [255, 120, 60] },
};
const CLASS_COLORS = {
  Ranger: { H: [50, 130, 60], R: [80, 110, 50] }, Sage: { H: [230, 230, 235], R: [200, 200, 215] },
  Paladin: { H: [180, 185, 200], R: [210, 170, 60] }, Warrior: { H: [170, 50, 40], R: [120, 40, 35] },
  Scholar: { H: [120, 80, 50], R: [150, 110, 70] }, Mage: { H: [60, 80, 200], R: [90, 60, 180] },
  Scout: { H: [80, 200, 220], R: [60, 140, 170] }, Navigator: { H: [230, 200, 80], R: [180, 150, 60] },
  Security: { H: [200, 60, 60], R: [140, 50, 50] }, Drone: { H: [180, 180, 200], R: [120, 120, 140] },
};

// ---------- sprites ----------

const HERO = [
  '.....KK.....',
  '....KhHK....',
  '....KhHK....',
  '...KhHHHK...',
  '...KhHHHK...',
  '..KhHHHHHK..',
  '.KKKKKKKKKK.',
  '...KSSSSK...',
  '...KSESEK...',
  '...KWWWWK...',
  '..KRWWWWRK..',
  '.KRRRWWRRRK.',
  '.SRRBBBBRRS.',
  '..KRRRRRRK..',
  '..KRRrrRRK..',
  '..KLLK.KLLK.',
];
const withRows = (base, edits) => base.map((row, i) => (edits[i] !== undefined ? edits[i] : row));
const HERO_FRAMES = {
  stand: HERO,
  walk1: withRows(HERO, { 14: '..KRRrrRRK..', 15: '.KLLK...KLK.' }),
  walk2: withRows(HERO, { 14: '..KRRrrRRK..', 15: '...KLLLLK...' }),
  cheer: withRows(HERO, { 7: 'S..KSSSSK..S', 8: 'SK.KSESEK.KS', 9: '.KRKWWWWKRK.', 12: '..RRBBBBRR..' }),
  hurt: withRows(HERO, { 8: '...KSKSKK...', 9: '...KWEEWK...' }),
};

const MEMBER = [
  '..KKKK..',
  '.KHHHHK.',
  'KHHHHHHK',
  '.KSSSSK.',
  '.KSESEK.',
  '..KSSK..',
  '.KRRRRK.',
  'SRRBBRRS',
  '.KRRRRK.',
  '.KRRRRK.',
  '.KLKKLK.',
  '.KK..KK.',
];
const GOBLIN = [
  ['..K....K..', '.KGK..KGK.', '.KGGGGGGK.', 'KGGYGGYGGK', 'KGGGGGGGGK', '.KGKKKKGK.', '..KGGGGK..', '.KbbbbbbK.', 'KGKbbbbKGK', '..KK..KK..'],
  ['..K....K..', '.KGK..KGK.', '.KGGGGGGK.', 'KGGYGGYGGK', 'KGGGGGGGGK', '.KGKWWKGK.', '..KGGGGK..', 'GKbbbbbbKG', '.KKbbbbKK.', '..KK..KK..'],
];
const CHEST = {
  closed: ['.KKKKKKKKKK.', 'KbbbbbbbbbbK', 'KbYbbbbbbYbK', 'KKKKKYYKKKKK', 'KbbbbYYbbbbK', 'KbYbbbbbbYbK', 'KbbbbbbbbbbK', 'KKKKKKKKKKKK'],
  open: ['.KKKKKKKKKK.', 'KbbbbbbbbbbK', 'KKKKKKKKKKKK', 'KYYOYYYOYYYK', 'KbbbbYYbbbbK', 'KbYbbbbbbYbK', 'KbbbbbbbbbbK', 'KKKKKKKKKKKK'],
};
const FIRE = [
  ['....F....', '...FfF...', '..FffrF..', '..frrrf..', 'w.wwwww.w', '.wwKwKww.'],
  ['...F.....', '...fF....', '..FfrfF..', '..frrrf..', 'w.wwwww.w', '.wwKwKww.'],
  ['.....F...', '....Ff...', '..FfrfF..', '..frrrf..', 'w.wwwww.w', '.wwKwKww.'],
];
const ANVIL = ['KKKKKKKKK.', 'KGGGGGGGGK', '.KgGGGGgK.', '...KGGK...', '..KgGGgK..', '.KKKKKKKK.'];
const CRYSTAL = ['..KK..', '.KPPK.', 'KPPpPK', 'KPpPPK', 'KPPpPK', '.KPPK.', '..KK..'];
const BIRD = [['K.....K', '.KKWKK.', '...K...'], ['.......', 'KKKWKKK', '...K...']];
const TORCH = [['.F.', 'FfF', '.r.', '.w.', '.w.'], ['F..', 'fF.', '.r.', '.w.', '.w.']];
const BOOK = ['KWWKWWK', 'KWWKWWK', '.KKKKK.'];

module.exports = {
  PixelCanvas, mix, shade, hash, clamp, BASE, OUTFITS, CLASS_COLORS,
  HERO_FRAMES, MEMBER, GOBLIN, CHEST, FIRE, ANVIL, CRYSTAL, BIRD, TORCH, BOOK,
};
