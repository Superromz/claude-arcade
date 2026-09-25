// Composable 16×24 hero sprites and small companion sprites.
//
// The hero is assembled every frame from layers: a body template (legs, torso,
// head, face), class headgear and accessory overlays, arms drawn in code from
// shoulder to hand, and a per-class weapon rig. Each frame comes from a small
// animation state (pose, attack progress, hurt timer), so attacks, knockback,
// breathing and the victory dance are just hand positions, angles and offsets.
'use strict';

const X = require('./pixel');
const C = require('./character');

const WHITE = [255, 255, 255];
const ramp = (c) => [X.mix(c, WHITE, 0.32), c, X.shade(c, 0.62)];
const lerp = (a, b, k) => a + (b - a) * k;
const lerpP = (a, b, k) => [lerp(a[0], b[0], k), lerp(a[1], b[1], k)];
const N4 = [[1, 0], [-1, 0], [0, 1], [0, -1]];
const dirOf = (deg) => [Math.cos((deg * Math.PI) / 180), Math.sin((deg * Math.PI) / 180)];
const at = (table, p) => table[Math.max(0, Math.min(table.length - 1, p))];
const WOOD = [150, 100, 55], WOOD_D = [100, 64, 34], WOOD_L = [200, 146, 78], STRING = [236, 228, 206];

// ---------- layer ----------
// Off-screen pixels in sprite-local coordinates, blitted with flip/tint/alpha.
const key = (x, y) => (x + 512) * 2048 + (y + 512);
class Layer {
  constructor() { this.px = new Map(); this.glows = []; this.labels = []; }
  set(x, y, c) { if (!c) return; x = Math.round(x); y = Math.round(y); this.px.set(key(x, y), [x, y, c]); }
  rows(rows, pal, ox = 0, oy = 0) {
    rows.forEach((r, j) => { if (r) for (let i = 0; i < r.length; i++) if (r[i] !== '.' && pal[r[i]]) this.set(ox + i, oy + j, pal[r[i]]); });
  }
  line(a, b, c) { for (const [x, y] of linePts(a, b)) this.set(x, y, c); }
  // Pixels plus a K outline on every neighbour that isn't part of the shape.
  stamp(pts, K) {
    const own = new Set(pts.map(([x, y]) => key(Math.round(x), Math.round(y))));
    for (const [x, y] of pts) for (const [dx, dy] of N4) { const nx = Math.round(x) + dx, ny = Math.round(y) + dy; if (!own.has(key(nx, ny))) this.set(nx, ny, K); }
    for (const [x, y, c] of pts) this.set(x, y, c);
  }
  glow(x, y, r, c, s) { this.glows.push([x, y, r, c, s]); }
  label(x, y, str, c) { this.labels.push([x, y, str, c]); }
  blit(pc, x, y, { flip = false, tint = null, alpha = 1, w = 16, dx = 0 } = {}) {
    const mx = (lx) => (flip ? x + w - 1 - (lx + dx) : x + lx + dx);
    const seed = Date.now() >> 7;
    for (const [lx, ly, c] of this.px.values()) {
      if (alpha < 1 && X.hash(lx + x, ly + y + seed) > alpha) continue;
      pc.set(mx(lx), y + ly, tint ? X.mix(c, tint[0], tint[1]) : c);
    }
    for (const [gx, gy, r, c, s] of this.glows) pc.glow(mx(gx), y + gy, r, c, s * alpha);
    for (const [lx, ly, str, c] of this.labels) {
      const col = Math.floor(mx(lx)), row = Math.floor((y + ly) / 2);
      if (col >= 0 && row >= 0 && col < pc.cols && row < pc.rows) pc.label(col, row, str, c);
    }
  }
}

function linePts(a, b) {
  const [x0, y0] = a.map(Math.round), [x1, y1] = b.map(Math.round);
  const n = Math.max(1, Math.abs(x1 - x0), Math.abs(y1 - y0));
  const out = [];
  for (let i = 0; i <= n; i++) {
    const p = [Math.round(lerp(x0, x1, i / n)), Math.round(lerp(y0, y1, i / n))];
    const q = out[out.length - 1];
    if (!q || q[0] !== p[0] || q[1] !== p[1]) out.push(p);
  }
  return out;
}

// ---------- hero body ----------
// Keys: K outline, S/T skin, h/H hair, E eye, m mouth, 1-3 primary, Y/y belt,
// v/u boots. Arms are not part of the template; they are drawn in code.
const BODY = [
  '................', '................', '................', '................', '................',
  '......KKKK......',
  '.....KhhhhK.....',
  '....KhHHhhhK....',
  '....KhSSSShK....',
  '....KSSSSSTK....',
  '....KSESSESK....',
  '....KSSSSSTK....',
  '.....KTSSTK.....',
  '....KK1221KK....',
  '...K11222223K...',
  '...K12222233K...',
  '...K12222233K...',
  '...K12222233K...',
  '...KYYYyyYYYK...',
  '...K12222233K...',
  '....K122223K....',
  '....K12KK23K....',
  '...KvvuKKvvuK...',
  '...KKKK..KKKK...',
];
const edit = (rows, e) => rows.map((r, i) => (e[i] !== undefined ? e[i] : r));
const FACES = {
  blink: { 10: '....KSTSSTSK....' },
  sleep: { 10: '....KShSShSK....' },
  wince: { 10: '....KSKSSKSK....', 11: '....KSSEESTK....' },
  happy: { 11: '....KSSmmSTK....' },
  lookL: { 10: '....KESSESSK....' },
  lookR: { 10: '....KSSESSEK....' },
  yawn: { 10: '....KSTSSTSK....', 11: '....KSSmmSTK....', 12: '.....KTmmTK.....' },
  surprise: { 9: '....KSESSESK....', 11: '....KSSSmSTK....' },
};
// Seated legs for the camp poses (the upper body sits two pixels lower).
const SIT_LEGS = { 21: '...K1222222223K.', 22: '...KKKKKKKK23vK.', 23: '..........KvvuK.' };
const POSES = {
  stand: BODY,
  walk1: edit(BODY, { 21: '...K12K..K23K...', 22: '..KvvuK..KvvuK..', 23: '..KKKKK..KKKKK..' }),
  walk2: edit(BODY, { 21: '.....K1223K.....', 22: '....KvvvvuK.....', 23: '....KKKKKKK.....' }),
  cheer: edit(BODY, FACES.happy),
  hurt: edit(BODY, FACES.wince),
};

// Headgear drawn over the head. Keys 4-6 secondary, 7-9 metal, W bone, P magic.
const HEADS = {
  wizard: ['.........K......', '........K5K.....', '.......K556K....', '......K4556K....', '.....K45556K....', '....K445556K....', '..KKYYYYYYYYKK..', '..K4455555566K..', '...KKKKKKKKKK...'],
  hood: ['', '', '', '', '......KKKK......', '.....K4555K.....', '....K455556K....', '...K4K....K6K...', '...K5K....K6K...', '...K5K....K6K...', '...K5K....K6K...', '...K56K..K66K...', '....K6KKKK6K....'],
  helm: ['', '........55......', '.......5456.....', '......K556K.....', '.....KKKKKK.....', '....K778889K....', '....K788889K....', '....K788889K....', '....KKKKKKKK....', '....K8K..K9K....', '....K8K..K9K....'],
  horns: ['', '..K..........K..', '..WK........KW..', '...WK......KW...', '....WKKKKKKW....', '...K45555556K...', '...K5K....K6K...', '...K5K....K6K...', '...K5K....K6K...', '...K5K....K6K...', '...K56K..K66K...', '....K6KKKK6K....'],
  cap: ['', '', '', '..........P.....', '.........PP.....', '.....KKKKPK.....', '....K4555556K...', '...KK4555566KK..', '....KKKKKKKK....'],
  mask: ['', '', '', '', '', '.....K5555K.....', '....K455556K....', '....KKKKKK5K5...', '............5...', '', '....K6E66E6K....'],
};
const ACCESSORY = {
  beard: { 11: '.....hhhhhh.....', 12: '.....KhhhhK.....', 13: '......KhhK......' },
  scarf: { 13: '....K5555556K...', 14: '...........56...', 15: '............6...' },
};
const CAPE = (flutter) => [
  ...Array(13).fill(''), '...KKKKKKKKKK...', '..K5555555555K..', '..K5555555555K..', '..K5555555555K..', '..K5555555555K..',
  '..K6555555555K..', '..K6555555556K..', flutter ? '.K66555555556K..' : '..K6655555566K..', flutter ? 'K666655555566K..' : '.K666555555666K.', flutter ? 'KKKKKK6666KKK...' : '.KKKKKKKKKKKKKK.',
];

function palette(ch) {
  const [p1, p2, p3] = ramp(C.COLORS[ch.primary] || C.COLORS.royal);
  const [s4, s5, s6] = ramp(C.COLORS[ch.secondary] || C.COLORS.violet);
  const skin = C.SKINS[ch.skin] || C.SKINS.light;
  const hair = C.HAIR[ch.hair] || C.HAIR.brown;
  return {
    K: [22, 18, 30], S: skin, T: X.shade(skin, 0.8), h: hair, H: X.mix(hair, WHITE, 0.35), E: [24, 24, 40], m: [150, 58, 66],
    1: p1, 2: p2, 3: p3, 4: s4, 5: s5, 6: s6, 7: [226, 230, 240], 8: [160, 166, 182], 9: [98, 102, 120],
    Y: [232, 186, 62], y: [176, 128, 40], v: [84, 60, 46], u: [52, 36, 30], W: [236, 232, 220], P: [190, 130, 255],
  };
}

// Body rows for a pose (legs + face) with accessory and headgear overlaid.
// `face` overrides the expression; omit it for the default blink.
function build(ch, pose = 'stand', t = 0, face) {
  const cls = C.CLASSES[ch.cls] || C.CLASSES.mage;
  let rows = (POSES[pose] || POSES.stand).slice();
  const f = face !== undefined ? face : pose !== 'hurt' && t % 45 < 2 ? 'blink' : null;
  if (f && FACES[f]) rows = edit(rows, FACES[f]);
  const acc = ACCESSORY[ch.accessory];
  if (acc) rows = rows.map((r, i) => overlay(r, acc[i]));
  // A shop hat (items.js) replaces the class headgear.
  if (ch.equipped && ch.equipped.hat) return rows;
  const head = HEADS[cls.head] || [];
  return rows.map((r, i) => overlay(r, head[i]));
}

function overlay(base, top) {
  if (!top) return base;
  let out = '';
  for (let i = 0; i < base.length; i++) out += top[i] && top[i] !== '.' ? top[i] : base[i];
  return out;
}

// ---------- hero animation state ----------

const SPELL_COLOR = { fireball: [255, 140, 40], frost: [140, 230, 255], chain: [150, 210, 255], meteor: [255, 110, 40], starfall: [255, 240, 180] };
const BASIC_COLOR = { mage: [255, 230, 110], ranger: [200, 150, 90], knight: [235, 240, 255], warlock: [184, 104, 255], bard: [255, 160, 210], rogue: [200, 205, 220] };
const SH_FORE = [13, 14], SH_BACK = [1, 14], REST_FORE = [14, 18], REST_BACK = [1, 18];
const RAISE = [0.5, 1, 1, 1, 0.8, 0.55, 0.3, 0.12, 0]; // spell-cast arm raise by progress -2..6

// Turn the draw options into offsets, hand targets and expression.
function heroState(o) {
  const { pose, t, action, hurt, flinch, sleep, busy, cls } = o; // plus o.look, o.hop, o.alert, o.activity
  const s = {
    dx: 0, dy: 0, legs: 'stand', face: t % 45 < 2 ? 'blink' : null, headDy: 0, headDx: 0, flip: false,
    fore: REST_FORE.slice(), back: REST_BACK.slice(), raise: 0, castK: 0, cheer: false, glint: false,
    act: null, tint: o.tint || null, glowBack: null, glowFore: null, busy, sleep, moving: false, pose, oy: 0, sit: false,
  };
  if (action && typeof action === 'object' && Number.isFinite(action.t)) {
    const p = t - action.t;
    if (p >= -2 && p <= 6) s.act = { kind: action.kind === 'cast' ? 'cast' : 'swing', spell: action.spell, p, color: SPELL_COLOR[action.spell] || BASIC_COLOR[cls] || BASIC_COLOR.mage };
  }
  const swing = (d) => { s.fore = [REST_FORE[0] - d, REST_FORE[1]]; s.back = [REST_BACK[0] + d, REST_BACK[1]]; };
  switch (pose) {
    case 'walk': { const ph = (t >> 1) % 2; s.legs = ph ? 'walk2' : 'walk1'; s.dy = ph ? -1 : 0; swing(ph ? 1 : -1); s.moving = true; break; }
    case 'walk1': s.legs = 'walk1'; swing(-1); break;
    case 'walk2': s.legs = 'walk2'; swing(1); break;
    case 'cheer': s.fore = [14, 8]; s.back = [0, 8]; s.face = 'happy'; s.cheer = true; break;
    case 'hurt': {
      const k = hurt >= 0 ? hurt : 99;
      s.face = 'wince'; s.fore = [13, 11]; s.back = [0, 12]; s.legs = k < 4 ? 'walk1' : 'stand';
      s.dx = -([3, 3, 2, 2, 1, 1][k] || 0); s.headDx = k < 4 ? -1 : 0;
      if (!o.tint) s.tint = k < 2 ? [WHITE, 0.85] : k < 7 ? (k % 2 ? null : [[255, 60, 60], 0.55]) : (t >> 1) % 4 === 0 ? [[255, 60, 60], 0.4] : null;
      break;
    }
    case 'stretch': s.fore = [14, 7]; s.back = [0, 7]; s.face = 'yawn'; s.cheer = true; break;
    case 'alert': {
      // Jolted awake when work starts: hop up, arms out, "!".
      const k = o.alert >= 0 ? o.alert : 99;
      s.dy = -([3, 3, 2, 1][k] || 0); s.fore = [16, 11]; s.back = [0, 11]; s.face = 'surprise';
      s.legs = k < 3 ? 'walk2' : 'walk1'; s.cheer = true; s.alertMark = true;
      break;
    }
    case 'sit': case 'sleep': {
      s.sit = true; s.oy = 2; s.activity = pose === 'sleep' ? 'sleep' : o.activity || cls;
      const period = pose === 'sleep' ? 36 : 24;
      s.headDy = t % period >= period / 2 ? 1 : 0;
      if (pose === 'sleep') { s.face = 'sleep'; s.headDy += 1; s.headDx = 1; s.fore = [12, 20]; s.back = [3, 20]; }
      else { s.fore = [12, 19]; s.back = [3, 20]; }
      break;
    }
    case 'victory': {
      const beat = (t >> 2) % 4, air = t % 4 === 1 || t % 4 === 2;
      s.face = 'happy';
      if (beat % 2 === 0) { s.fore = [14, 8]; s.back = [0, 8]; s.cheer = true; s.dy = air ? -2 : 0; s.legs = air ? 'walk2' : 'stand'; s.flip = beat === 2; }
      else { s.raise = 1; s.glint = true; s.back = [3, 17]; s.dy = beat === 3 && air ? -1 : 0; s.legs = beat === 3 ? 'walk1' : 'stand'; }
      break;
    }
    default: {
      // Idle breathing: the head sinks a pixel on each exhale; faster in battle.
      const period = sleep ? 32 : busy ? 12 : 24;
      s.headDy = t % period >= period / 2 ? 1 : 0;
      if (sleep) s.face = 'sleep';
      if (busy) s.legs = 'walk1';
      if (o.look === 'left' || o.look === 'right') s.face = o.look === 'left' ? 'lookL' : 'lookR';
      if (o.hop) s.dy = -1;
    }
  }
  if (flinch >= 0 && flinch < 3 && pose !== 'hurt') {
    s.dx -= flinch < 2 ? 1 : 0; s.face = 'wince';
    if (!s.tint && flinch === 0) s.tint = [[255, 90, 90], 0.35];
  }
  if (s.act) {
    s.headDy = 0;
    if (!s.moving && pose !== 'hurt') s.legs = 'walk1';
    if (s.act.kind === 'cast') {
      const r = at(RAISE, s.act.p + 2);
      s.raise = Math.max(s.raise, r); s.castK = r;
      s.back = lerpP(s.back, [0, 10], r);
      if (r > 0.4) s.glowBack = s.act.color;
    }
  }
  if (s.raise > 0 && !s.cheer) s.fore = lerpP(s.fore, [13, 9], s.raise);
  return s;
}

// ---------- hero drawing helpers ----------

// Outlined two-pixel arm from shoulder to hand; returns the two hand cells.
function limb(L, from, to, pal, lit) {
  const pts = linePts(from, to);
  const a = pts[0], b = pts[pts.length - 1];
  const o = Math.abs(b[0] - a[0]) > Math.abs(b[1] - a[1]) ? [0, 1] : [1, 0];
  const cells = [];
  pts.forEach(([x, y], i) => {
    const hand = i === pts.length - 1;
    cells.push([x, y, hand ? pal.S : lit ? pal[1] : pal[2]], [x + o[0], y + o[1], hand ? pal.T : lit ? pal[2] : pal[3]]);
  });
  L.stamp(cells, pal.K);
  return cells.slice(-2);
}

function paintHand(L, FX, cells, pal, glow, t) {
  for (const [x, y, c] of cells) L.set(x, y, glow ? X.mix(c, glow, 0.55) : c);
  if (!glow) return;
  const [hx, hy] = cells[0];
  L.glow(hx + 0.5, hy, 6, glow, 0.55);
  for (let k = 0; k < 2; k++) { const a = t * 1.3 + k * Math.PI; FX.set(hx + 0.5 + Math.cos(a) * 2.5, hy + Math.sin(a) * 2.2, X.mix(glow, WHITE, 0.6)); }
}

function sparkleRing(L, cx, cy, r, c, t, n) {
  for (let k = 0; k < n; k++) { const a = t * 0.6 + (k * 2 * Math.PI) / n; L.set(cx + Math.cos(a) * r, cy + Math.sin(a) * r * 0.9, X.mix(c, WHITE, 0.6)); }
}

function glint(L, [x, y], c, t) {
  const r = 1 + ((t >> 1) % 2);
  L.set(x, y, WHITE);
  for (let k = 1; k <= r; k++) { const cc = X.mix(c, WHITE, 0.5 / k); L.set(x + k, y, cc); L.set(x - k, y, cc); L.set(x, y + k, cc); L.set(x, y - k, cc); }
  L.glow(x, y, 5, c, 0.35);
}

// Back arm (and anything it holds), then fore arm and its weapon, then the
// fore hand on top so it reads as gripping the weapon.
function arms(ctx, { backItem, foreItem } = {}) {
  const { B, F, FX, pal, s, t } = ctx;
  const bh = limb(B, [SH_BACK[0], SH_BACK[1] + s.oy], s.back, pal, true);
  const hideBack = backItem ? backItem(bh) : false;
  if (!hideBack) paintHand(B, FX, bh, pal, s.glowBack, t);
  const fh = limb(F, [SH_FORE[0], SH_FORE[1] + s.oy], s.fore, pal, false);
  if (foreItem) foreItem(fh, [fh[1][0], fh[0][1]]);
  paintHand(F, FX, fh, pal, s.glowFore, t);
}

// ---------- weapon rigs ----------

// Mage: staff thrust for the basic attack, staff raise (via s.raise) for spells.
const STAFF_THRUST = [
  { h: [12, 16], a: -100, dx: -1 }, { h: [12, 15], a: -106, dx: -1 },
  { h: [17, 13], a: -58, dx: 1, flare: 1 }, { h: [17, 13], a: -58, dx: 1, flare: 0.7 },
  { h: [16, 15], a: -68 }, { h: [15, 17], a: -78 }, { h: [15, 18], a: -86 }, { h: [14, 18], a: -90 }, { h: [14, 18], a: -90 },
];
function rigStaff(ctx) {
  const { s, t, pal } = ctx, a = s.act;
  let ang = -90, flare = 0;
  if (a && a.kind === 'swing') { const k = at(STAFF_THRUST, a.p + 2); s.fore = k.h.slice(); ang = k.a; s.dx += k.dx || 0; flare = k.flare || 0; }
  flare = Math.max(flare, s.castK, s.glint ? 0.6 : 0);
  const orbC = a ? a.color : ctx.glowColor || pal.P;
  if (s.castK > 0.4) s.glowFore = a.color;
  arms(ctx, {
    foreItem: (fh) => {
      const g = [fh[1][0] + 1, fh[0][1]], d = dirOf(ang), n = [-d[1], d[0]];
      const P = (k, m = 0) => [g[0] + d[0] * k + n[0] * m, g[1] + d[1] * k + n[1] * m];
      const pts = [];
      for (let k = -5; k <= 12; k++) pts.push([...P(k), k % 4 === 0 ? WOOD_D : k < 0 ? WOOD : WOOD_L]);
      pts.push([...P(13, 1), pal.Y], [...P(13, -1), pal.Y], [...P(13), pal.y]);
      const [ox, oy] = P(14.5).map((v) => Math.round(v - 0.5));
      const orb = X.mix(orbC, WHITE, 0.2 + 0.2 * Math.sin(t * 0.5) + flare * 0.4);
      pts.push([ox, oy, X.mix(orb, WHITE, 0.65)], [ox + 1, oy, orb], [ox, oy + 1, orb], [ox + 1, oy + 1, X.shade(orbC, 0.7)]);
      ctx.F.stamp(pts, pal.K);
      ctx.F.glow(ox + 0.5, oy + 0.5, 7 + flare * 6, orbC, 0.35 + flare * 0.35);
      if (flare > 0.3) sparkleRing(ctx.FX, ox + 0.5, oy + 0.5, 3.2 + flare, orbC, t, 4);
      if (s.glint) glint(ctx.FX, [ox + 0.5, oy - 2], orbC, t);
      ctx.tip = [ox, oy];
    },
  });
}

// Knight: a real overhead arc with a crescent trail, shield on the back arm.
const SWORD_SWING = [
  { h: [10, 11], a: -150, dx: -1 }, { h: [10, 9], a: -125, dx: -1 },
  { h: [17, 12], a: -25, dx: 1, tr: [-125, -25, 1] }, { h: [17, 16], a: 35, dx: 1, tr: [-70, 35, 0.85] },
  { h: [16, 18], a: 55, dx: 1, tr: [10, 55, 0.45] }, { h: [15, 18], a: 20 }, { h: [15, 18], a: -20 }, { h: [14, 18], a: -45 }, { h: [14, 18], a: -55 },
];
const SHIELD = ['KKKKK', 'K7Y5K', 'KYYYK', 'K5Y6K', 'K5Y6K', '.K6K.', '..K..'];
function rigSword(ctx) {
  const { s, pal, t } = ctx, a = s.act;
  let ang = s.busy || a ? -55 : -78, trail = null;
  if (s.raise) ang = lerp(ang, -90, s.raise);
  if (s.cheer) ang = -90;
  if (s.pose === 'hurt') ang = -40;
  if (a && a.kind === 'swing') { const k = at(SWORD_SWING, a.p + 2); s.fore = k.h.slice(); ang = k.a; s.dx += k.dx || 0; trail = k.tr; }
  if (trail) {
    const [a0, a1, str] = trail;
    for (let deg = a0; deg <= a1; deg += 3) {
      const f = (deg - a0) / Math.max(1, a1 - a0), d = dirOf(deg);
      for (let r = lerp(12, 6.5, f); r <= 13.5; r += 0.6) ctx.FXb.set(SH_FORE[0] + d[0] * r, SH_FORE[1] + d[1] * r, X.mix([70, 96, 160], WHITE, f * str));
    }
  }
  arms(ctx, {
    backItem: (bh) => {
      const [hx, hy] = bh[0];
      ctx.B.rows(SHIELD, pal, hx - 1, hy - 4);
      if ((t >> 3) % 5 === 0) ctx.B.set(hx, hy - 3, WHITE);
      return true;
    },
    foreItem: (fh, g) => {
      const d = dirOf(ang), n = [-d[1], d[0]];
      const P = (k, m = 0) => [g[0] + d[0] * k + n[0] * m, g[1] + d[1] * k + n[1] * m];
      const pts = [[...P(-1.4), pal.Y], [...P(0), [110, 70, 40]]];
      for (const m of [-1, 0, 1]) pts.push([...P(1.2, m), m ? pal.y : pal.Y]);
      for (let k = 2; k <= 8; k++) pts.push([...P(k, 0.9), pal[8]]);
      for (let k = 2; k <= 9; k++) pts.push([...P(k), k === 9 ? WHITE : pal[7]]);
      ctx.F.stamp(pts, pal.K);
      ctx.tip = P(9.5);
      if (s.glint || s.castK > 0.4) glint(ctx.FX, P(9.5), s.castK > 0.4 ? a.color : [255, 250, 220], t);
    },
  });
}

// Ranger: bow comes up, the string draws back to the chest, then snaps.
const BOW_SHOT = [
  { h: [16, 13], nock: 12, back: [11, 13] }, { h: [16, 13], nock: 10, back: [9, 13] },
  { h: [16, 13], vib: 1, streak: 1, back: [6, 11] }, { h: [16, 13], vib: -1, back: [6, 12] },
  { h: [16, 14], back: [4, 15] }, { h: [15, 16], back: [3, 17] }, { h: [15, 17], back: [2, 18] }, { h: [14, 18], back: [1, 18] }, { h: [14, 18], back: [1, 18] },
];
function rigBow(ctx) {
  const { s, pal, t } = ctx, a = s.act;
  let k = null;
  if (a && a.kind === 'swing') { k = at(BOW_SHOT, a.p + 2); s.fore = k.h.slice(); s.back = k.back.slice(); }
  const aiming = k && a.p <= 1;
  arms(ctx, {
    foreItem: (fh, g) => {
      const cx = g[0] + 1, cy = g[1] - (aiming ? 0 : 2), tipX = cx - 2;
      const pts = [];
      for (let u = -6; u <= 6; u++) pts.push([cx - Math.round(2 * (u / 6) ** 2), cy + u, Math.abs(u) >= 6 ? WOOD_D : Math.abs(u) <= 1 ? pal.v : WOOD]);
      ctx.F.stamp(pts, pal.K);
      if (k && k.nock !== undefined) {
        ctx.F.line([tipX, cy - 5], [k.nock, cy], STRING); ctx.F.line([k.nock, cy], [tipX, cy + 5], STRING);
        for (let x = k.nock; x <= cx + 2; x++) ctx.F.set(x, cy, WOOD_L);
        ctx.F.set(cx + 3, cy, pal[7]); ctx.F.set(cx + 4, cy, WHITE); ctx.F.set(k.nock, cy - 1, pal[5]); ctx.F.set(k.nock, cy + 1, pal[5]);
        if (a.p === -1) glint(ctx.FX, [cx + 4, cy], a.color, t);
      } else {
        for (let u = -5; u <= 5; u++) ctx.F.set(tipX + (k && k.vib && Math.abs(u) <= 2 ? k.vib : 0), cy + u, STRING);
      }
      if (k && k.streak) for (let x = cx + 3; x < cx + 11; x++) ctx.FX.set(x, cy, X.mix([120, 110, 90], WHITE, (x - cx) / 12));
      if (s.glint || s.castK > 0.4) glint(ctx.FX, [cx, cy - 7], s.castK > 0.4 ? a.color : [255, 250, 220], t);
      ctx.tip = [cx + 4, cy];
    },
  });
}

// Rogue: cock the dagger overhead, hurl it, then draw a fresh one.
const DAGGER_THROW = [
  { h: [11, 10], a: -160, dx: -1 }, { h: [11, 8], a: -140, dx: -1 },
  { h: [17, 12], dx: 1, fly: 21 }, { h: [17, 13], dx: 1 }, { h: [16, 15] },
  { h: [15, 17] }, { h: [14, 18] }, { h: [14, 18], a: -45, glint: 1 }, { h: [14, 18], a: -45 },
];
function dagger(L, g, ang, pal) {
  const d = dirOf(ang), n = [-d[1], d[0]];
  const P = (k, m = 0) => [g[0] + d[0] * k + n[0] * m, g[1] + d[1] * k + n[1] * m];
  L.stamp([[...P(0), pal.v], [...P(1, -1), pal.Y], [...P(1, 1), pal.Y], [...P(1), pal.y], [...P(2), pal[7]], [...P(3), pal[7]], [...P(4), WHITE]], pal.K);
  return P(4);
}
function rigDaggers(ctx) {
  const { s, pal, t } = ctx, a = s.act;
  let ang = s.busy || a ? -40 : -75, k = null;
  if (s.raise) ang = lerp(ang, -90, s.raise);
  if (a && a.kind === 'swing') { k = at(DAGGER_THROW, a.p + 2); s.fore = k.h.slice(); s.dx += k.dx || 0; ang = k.a; }
  arms(ctx, {
    backItem: (bh) => { dagger(ctx.B, [bh[0][0], bh[0][1] + 1], 95, pal); return false; },
    foreItem: (fh, g) => {
      if (ang === undefined) return;
      const tip = dagger(ctx.F, g, ang, pal);
      ctx.tip = tip;
      if ((k && k.glint) || s.glint || s.castK > 0.4) glint(ctx.FX, tip, s.castK > 0.4 ? a.color : [255, 250, 220], t);
    },
  });
  if (k && k.fly) {
    const y = 12;
    for (let x = 15; x < k.fly; x++) ctx.FX.set(x, y, X.mix([90, 96, 120], WHITE, (x - 15) / (k.fly - 15)));
    ctx.FX.stamp([[k.fly, y, pal.v], [k.fly + 1, y, pal[7]], [k.fly + 2, y, pal[7]], [k.fly + 3, y, WHITE]], pal.K);
  }
}

// Bard: lute across the chest; strumming sends notes and rings forward.
function rigLute(ctx) {
  const { s, pal, t, B, FX } = ctx, a = s.act, oy = s.oy;
  const strum = a && a.p >= -1 && a.p <= 4;
  const campStrum = s.sit && t % 8 < 4;
  if (!s.cheer && s.pose !== 'hurt' && s.pose !== 'victory') {
    s.fore = [12, 14 + oy];
    s.back = [6, (strum ? (t % 2 ? 17 : 19) : campStrum ? (t % 2 ? 17 : 18) : 18) + oy];
    s.glowBack = a && a.kind === 'cast' && strum ? a.color : null;
  }
  // Lute body, sound hole, neck and headstock (outlined over the torso).
  const pts = [];
  for (let dy = -2; dy <= 2; dy++) for (let dx = -3; dx <= 2; dx++) {
    if ((dx + 0.5) ** 2 / 9 + dy * dy / 6 > 1) continue;
    pts.push([7 + dx, 19 + dy + oy, dx === 0 && dy === 0 ? [60, 40, 25] : dx + dy < -1 ? WOOD_L : dx + dy > 1 ? WOOD_D : [184, 128, 64]]);
  }
  for (const [x, y] of linePts([10, 17 + oy], [14, 13 + oy])) pts.push([x, y, WOOD_D]);
  pts.push([15, 12 + oy, WOOD_D], [15, 11 + oy, pal.Y]);
  B.stamp(pts, pal.K);
  B.line([6, 19 + oy], [13, 14 + oy], X.mix(STRING, WOOD, 0.35));
  if (s.sit) {
    if (campStrum) B.glow(7, 19 + oy, 5, [255, 200, 120], 0.25);
    const ph = t % 24;
    if (ph < 14) FX.label(15 + (ph >> 2), 13 - ph, ph % 8 < 4 ? '♪' : '♫', [255, 214, 120]);
  }
  if (strum) {
    const col = a.kind === 'cast' ? a.color : BASIC_COLOR.bard, p = a.p + 1;
    if (strum && t % 2) B.glow(7, 19, 6, col, 0.4);
    for (let r = 0; r < 2; r++) {
      const rad = 4 + p * 2 + r * 3;
      for (let deg = -50; deg <= 50; deg += 12) { const d = dirOf(deg); FX.set(9 + d[0] * rad, 17 + d[1] * rad, X.mix(col, WHITE, 0.3 - r * 0.2)); }
    }
    if (a.p >= 0) FX.label(16 + a.p, 12 - a.p * 2, a.p % 2 ? '♫' : '♪', col);
  } else if (s.busy && t % 6 < 3) FX.label(16, 10 - (t % 6), '♪', [255, 214, 80]);
  if (s.glint) glint(FX, [15, 10], [255, 220, 120], t);
  arms(ctx);
  ctx.tip = [15, 12];
}

// Warlock: a winged imp familiar that lunges at the enemy.
const FAMILIAR_LUNGE = [
  { f: [15, 3], h: [14, 15] }, { f: [14, 2], h: [15, 13] },
  { f: [25, 10], h: [17, 12], tr: 1 }, { f: [29, 12], h: [17, 12], bite: 1 }, { f: [25, 9], h: [16, 13] },
  { f: [21, 7], h: [15, 15] }, { f: [19, 6], h: [14, 17] }, { h: [14, 18] }, { h: [14, 18] },
];
function imp(L, FX, [fx, fy], t, pal, glow) {
  fx = Math.round(fx); fy = Math.round(fy);
  const P = pal.P, p = X.shade(P, 0.6), eye = t % 40 < 2 ? P : [255, 236, 140];
  const up = (t >> 1) % 2;
  const pts = [
    [fx + 1, fy - 1, p], [fx + 4, fy - 1, p],
    [fx, fy, P], [fx + 1, fy, P], [fx + 2, fy, eye], [fx + 3, fy, P], [fx + 4, fy, eye],
    [fx, fy + 1, p], [fx + 1, fy + 1, P], [fx + 2, fy + 1, P], [fx + 3, fy + 1, P], [fx + 4, fy + 1, p],
    [fx + 1, fy + 2, p], [fx + 3, fy + 2, p],
    ...(up ? [[fx - 1, fy, p], [fx - 2, fy - 1, P], [fx - 3, fy - 2, p]] : [[fx - 1, fy + 1, p], [fx - 2, fy + 2, P], [fx - 3, fy + 2, p]]),
  ];
  L.stamp(pts, pal.K);
  L.glow(fx + 2, fy + 1, 8, glow || P, 0.4);
}
function rigFamiliar(ctx) {
  const { s, pal, t } = ctx, a = s.act;
  const home = [17, 5 + Math.round(Math.sin(t * 0.25) * 2)];
  let f = home, k = null, glow = null;
  if (a && a.kind === 'swing') { k = at(FAMILIAR_LUNGE, a.p + 2); s.fore = k.h.slice(); f = k.f || home; if (a.p >= -1 && a.p <= 2) s.glowFore = a.color; }
  if (s.castK > 0.3 || s.pose === 'victory') {
    const ang = t * 0.7;
    f = [6 + Math.cos(ang) * 11, 4 + Math.sin(ang) * 3];
    glow = a ? a.color : pal.P;
    if (a) s.glowFore = a.color;
  }
  arms(ctx);
  if (k && k.tr) ctx.FXb.line(home, f, X.shade(pal.P, 0.7));
  if (k && k.tr) for (const [x, y] of linePts(home, f)) ctx.FXb.set(x, y + 1, X.shade(pal.P, 0.45));
  imp(ctx.F, ctx.FX, f, t, pal, glow);
  if (k && k.bite) for (let i = -2; i <= 2; i++) { ctx.FX.set(f[0] + 6 + i, f[1] + 1 + i, WHITE); ctx.FX.set(f[0] + 6 + i, f[1] + 1 - i, X.mix(pal.P, WHITE, 0.5)); }
  if (glow) sparkleRing(ctx.FX, f[0] + 2, f[1] + 1, 4, glow, t, 3);
  ctx.tip = [f[0] + 4, f[1]];
}

const RIGS = { staff: rigStaff, sword: rigSword, bow: rigBow, daggers: rigDaggers, lute: rigLute, familiar: rigFamiliar };

// ---------- camp activities (seated, coordinates include the 2px sit offset) ----------

function campRest(ctx) { arms(ctx); }

// Mage: a spellbook floats in front, pages flipping in a soft glow.
function campBook(ctx) {
  const { s, pal, t, F, FX } = ctx;
  s.fore = [13, 17]; s.back = [3, 20];
  arms(ctx);
  const bx = 15, by = 12 + Math.round(Math.sin(t * 0.2));
  const page = [240, 234, 214], pageS = [200, 192, 170], ink = [130, 116, 120];
  const pts = [];
  for (let i = 0; i < 7; i++) {
    pts.push([bx + i, by, i === 3 ? pageS : (i === 1 || i === 5) && t % 16 < 12 ? ink : page]);
    pts.push([bx + i, by + 1, i === 3 ? pageS : i === 2 || i === 4 ? ink : page]);
    pts.push([bx + i, by + 2, pal[5]]);
  }
  F.stamp(pts, pal.K);
  const f = (t >> 1) % 6;
  if (f < 4) FX.set(...[[bx + 5, by - 1], [bx + 4, by - 2], [bx + 2, by - 2], [bx + 1, by - 1]][f], page);
  F.glow(bx + 3, by + 1, 9, pal.P, 0.28 + 0.08 * Math.sin(t * 0.3));
  for (let k = 0; k < 3; k++) { const ph = (t + k * 5) % 12; FX.set(bx + 1 + ((k * 5 + (t >> 2)) % 6), by - 1 - (ph >> 1), X.mix(pal.P, WHITE, 0.5)); }
  ctx.tip = [bx + 3, by];
}

// Knight: sword across the lap, a rag running along the blade.
function campPolish(ctx) {
  const { s, pal, t, FX } = ctx;
  const ph = t % 16, rx = Math.round(8 + (ph < 8 ? ph : 16 - ph) * 0.75), y = 20;
  s.back = [4, 19]; s.fore = [rx, 18];
  arms(ctx, {
    backItem: () => {
      const pts = [[2, y, pal.Y], [3, y, [110, 70, 40]], [4, y - 1, pal.Y], [4, y, pal.Y], [4, y + 1, pal.Y]];
      for (let x = 5; x <= 15; x++) pts.push([x, y, x === 15 ? WHITE : pal[7]]);
      ctx.B.stamp(pts, pal.K);
      return false;
    },
  });
  if (ph % 8 === 4) glint(FX, [rx + 1, y], [255, 250, 220], t);
  else FX.set(rx + 2, y, WHITE);
  ctx.tip = [15, y];
}

// Ranger: fletching an arrow with a small knife; shavings drop away.
function campFletch(ctx) {
  const { s, pal, t, FX } = ctx;
  s.back = [6, 18]; s.fore = [12 + (t % 6 < 3 ? 0 : 1), 17];
  arms(ctx, {
    backItem: () => {
      const pts = [];
      for (let x = 5; x <= 13; x++) pts.push([x, 18, WOOD_L]);
      pts.push([14, 18, pal[7]], [15, 18, WHITE], [5, 17, pal[5]], [5, 19, pal[5]], [6, 17, pal[4]]);
      ctx.B.stamp(pts, pal.K);
      return false;
    },
    foreItem: (fh, g) => ctx.F.stamp([[g[0], g[1] - 1, pal[8]], [g[0], g[1] - 2, WHITE]], pal.K),
  });
  for (let k = 0; k < 3; k++) { const ph = (t + k * 4) % 12; if (ph < 5) FX.set(12 + k + (ph >> 1), 19 + ph, WOOD_L); }
  ctx.tip = [15, 18];
}

// Warlock: gazing into a crystal ball, purple light swirling inside.
function campCrystal(ctx) {
  const { s, pal, t, F, FX } = ctx;
  s.fore = [14, 16]; s.back = [3, 20]; s.glowFore = X.mix(pal.P, WHITE, 0.2);
  arms(ctx);
  const cx = 17, cy = 20, pts = [];
  for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) if (dx * dx + dy * dy <= 5) pts.push([cx + dx, cy + dy, X.mix([60, 30, 110], pal.P, 0.4 + 0.15 * (-dx - dy))]);
  pts.push([cx - 1, cy + 3, WOOD_D], [cx, cy + 3, WOOD_D], [cx + 1, cy + 3, WOOD_D]);
  F.stamp(pts, pal.K);
  F.set(cx - 1, cy - 1, X.mix(pal.P, WHITE, 0.7));
  for (let k = 0; k < 2; k++) { const a = t * 0.5 + k * Math.PI; FX.set(cx + Math.cos(a) * 1.2, cy + Math.sin(a) * 1.2, k ? [255, 180, 255] : WHITE); }
  F.glow(cx, cy, 10 + 2 * Math.sin(t * 0.25), pal.P, 0.45);
  ctx.tip = [cx, cy - 2];
}

// Rogue: flipping a coin, a gold pixel arcing up and back into the hand.
function campCoin(ctx) {
  const { s, pal, t, F, FX } = ctx;
  s.fore = [13, 18]; s.back = [3, 20];
  arms(ctx);
  const ph = t % 14;
  const cy = ph < 10 ? 16 - Math.sin((ph / 10) * Math.PI) * 10 : 16, cx = 15;
  FX.set(cx, cy, ph < 10 && t % 2 ? pal.y : pal.Y);
  if (ph >= 10 || t % 2 === 0) FX.set(cx + 1, cy, pal.Y);
  F.glow(cx, cy, 4, [255, 220, 90], 0.3);
  if (ph === 5) glint(FX, [cx, Math.round(cy) - 1], [255, 220, 90], t);
  ctx.tip = [cx, cy];
}

// Asleep, slumped on the log: arms limp in the lap.
function campSleep(ctx) { arms(ctx); }

const CAMP = { mage: campBook, knight: campPolish, ranger: campFletch, warlock: campCrystal, rogue: campCoin, bard: rigLute, sleep: campSleep };

// Draw the full hero at (x, y) = top-left of the 16×24 box.
// opts: pose ('stand'|'walk'|'walk1'|'walk2'|'cheer'|'hurt'|'victory'|'stretch'|
// 'alert'|'sit'|'sleep'), t (tick), action (ui.heroAction {kind, spell, t}, or
// true for "busy"), busy, hurt / flinch / alert (ticks since it started), look
// ('left'|'right'), hop, activity (camp activity, defaults to the class),
// sleep (closed eyes while standing), flip, tint, alpha, glowColor.
// Returns the weapon tip in canvas pixels (or null).
function drawHero(pc, ch, x, y, opts = {}) {
  const { pose = 'stand', t = 0, flip = false, tint = null, action = null, glowColor, hurt = -1, flinch = -1, sleep = false, alpha = 1, look, hop, alert = -1, activity } = opts;
  const busy = opts.busy !== undefined ? !!opts.busy : action === true;
  const cls = C.CLASSES[ch.cls] ? ch.cls : 'mage', def = C.CLASSES[cls];
  const pal = palette(ch);
  const s = heroState({ pose, t, action, hurt, flinch, sleep, busy, cls, tint, look, hop, alert, activity });
  const ctx = { B: new Layer(), F: new Layer(), FXb: new Layer(), FX: new Layer(), pal, s, t, glowColor, tip: null };

  if (ch.accessory === 'cape') ctx.B.rows(CAPE(s.moving || s.dx ? (t >> 1) % 2 : (t >> 3) % 2).slice(0, s.sit ? 22 : 24), pal, 0, s.oy);
  const rows = build(ch, s.legs, t, s.face);
  if (s.sit) {
    rows.forEach((r, j) => { if (j >= 14 && j <= 18) ctx.B.rows([r], pal, 0, j + 2); });
    for (const j of [21, 22, 23]) ctx.B.rows([SIT_LEGS[j]], pal, 0, j);
    rows.forEach((r, j) => { if (j < 14) ctx.B.rows([r], pal, s.headDx, j + 2 + s.headDy); });
    (CAMP[s.activity] || campRest)(ctx);
  } else {
    rows.forEach((r, j) => { if (j >= 14) ctx.B.rows([r], pal, 0, j); });
    rows.forEach((r, j) => { if (j < 14) ctx.B.rows([r], pal, s.headDx, j + s.headDy); });
    (RIGS[def.weapon] || rigStaff)(ctx);
  }
  if (s.alertMark) ctx.FX.label(8, -3, '!', [255, 220, 80]);

  const fl = flip !== s.flip, sx = fl ? -s.dx : s.dx;
  const px = (dx) => (fl ? x + 15 - dx - s.dx : x + dx + s.dx);
  // Floor shadow, smaller while airborne.
  const air = s.dy < 0 ? 2 : 0;
  for (let dx = 2 + air; dx < 14 - air; dx++) {
    const gx = X.clamp(x + sx + dx), gy = Math.min(pc.h - 1, y + 24);
    if (gx < pc.w && gy >= 0) pc.set(gx, gy, X.shade(pc.get(gx, gy) || [0, 0, 0], 0.55));
  }
  const by = y + s.dy, bo = { flip: fl, tint: s.tint, alpha, dx: s.dx };
  ctx.B.blit(pc, x, by, bo);
  // Equipped cosmetics from the shop (items.js) sit between body and weapon.
  try { require('./items').drawEquipment(pc, ch, { x: x + sx, y: by, px, pal, t, pose, flip: fl, headDy: s.headDy, headDx: s.headDx }); } catch {}
  ctx.FXb.blit(pc, x, by, { ...bo, tint: null });
  ctx.F.blit(pc, x, by, bo);
  ctx.FX.blit(pc, x, by, { ...bo, tint: null });
  return ctx.tip ? [px(ctx.tip[0]), by + ctx.tip[1]] : null;
}

// ---------- companions ----------
// Party members are small (11×13) versions of the hero classes, colored from
// the class defaults with skin and hair picked by a hash of the party id.

const COMP_BODY = [
  '...KKKKK...',
  '..KhhhhhK..',
  '.KhHhhhhhK.',
  '.KhSSSSShK.',
  '..KSESESK..',
  '..KSSSSTK..',
  '..KK122KK..',
  '.K1122223K.',
  'KSK12223K..',
  '.KKYYYYYK..',
  '..K12K23K..',
  '..KvvKvvK..',
  '..KKKKKKK..',
];
const COMP_WALK = { 10: '.K12K.K23K.', 11: '.KvvK.KvvK.', 12: '.KKKK.KKKK.' };
const COMP_SIT = '..K12223vvK';
const COMP_HEADS = {
  wizard: [-4, ['.....KK....', '....K55K...', '....K455K..', '...K4556K..', '..K45556K..', '.KYYYYYYYK.', 'KK4455566KK']],
  hood: [-1, ['...KKKK....', '..K4555K...', '.K455555K..', '.K4555556K.', '.K5SSSSS6K.', '.K5SESES6K.']],
  helm: [-2, ['....K55K...', '...K555K...', '..KK778KK..', '.K7788889K.', '.K7888889K.', '.K8SS8SS9K.', '.K8SESES9K.']],
  horns: [-2, ['.W.......W.', '.WK.....KW.', '..WKKKKKW..', '..K45556K..', '.K4555556K.', '.K5SSSSS6K.', '.K5SESES6K.']],
  cap: [-3, ['........P..', '.......PP..', '...KKKKKP..', '..K455556K.', '.K45YY5566K']],
  mask: [0, ['...KKKKK...', '..K45555K..', '.K4555556K.', '.K5SSSSS6K.', '.K5SESES6K.', '..K55556K..']],
};
const LEGACY_CLS = { sage: 'warlock', paladin: 'knight', warrior: 'rogue', scholar: 'bard', scout: 'ranger', navigator: 'bard', security: 'knight', drone: 'mage' };

// Accepts a class id, a party entry ({cls}), or a legacy X.CLASS_COLORS entry.
function companionClass(who, cls) {
  let c = cls || (typeof who === 'string' ? who : who && who.cls);
  if (!c && who && who.H) c = Object.keys(X.CLASS_COLORS).find((k) => X.CLASS_COLORS[k] === who);
  c = String(c || 'mage').toLowerCase();
  c = LEGACY_CLS[c] || c;
  return C.CLASSES[c] ? c : 'mage';
}
function seedOf(id) { let h = 7; for (const ch of String(id)) h = (h * 31 + ch.charCodeAt(0)) | 0; return Math.abs(h); }

function compPalette(cls, seed) {
  const def = C.CLASSES[cls];
  const [p1, p2, p3] = ramp(C.COLORS[def.primary] || C.COLORS.royal);
  const [s4, s5, s6] = ramp(C.COLORS[def.secondary] || C.COLORS.violet);
  const skins = Object.values(C.SKINS), hairs = Object.values(C.HAIR);
  const skin = skins[Math.floor(X.hash(seed % 9973, 7) * skins.length) % skins.length];
  const hair = hairs[Math.floor(X.hash(seed % 7919, 13) * hairs.length) % hairs.length];
  return {
    K: [22, 18, 30], S: skin, T: X.shade(skin, 0.8), h: hair, H: X.mix(hair, WHITE, 0.35), E: [24, 24, 40],
    1: p1, 2: p2, 3: p3, 4: s4, 5: s5, 6: s6, 7: [226, 230, 240], 8: [160, 166, 182], 9: [98, 102, 120],
    Y: [232, 186, 62], y: [176, 128, 40], v: [84, 60, 46], W: [236, 232, 220], P: [190, 130, 255],
  };
}

// Right arm from the shoulder (8,7) to the hand, drawn after the weapon so
// the hand sits on the grip.
function compArm(F, hand, pal, oy = 0) {
  const pts = linePts([8, 7 + oy], hand).slice(1);
  if (!pts.length) return;
  F.stamp(pts.map(([x, y], i) => [x, y, i === pts.length - 1 ? pal.S : pal[2]]), pal.K);
}

// Class rigs for companions. p = attack progress (0..5) or null.
const COMP_RIGS = {
  staff(c, p) { // Mage blasts an area: staff thrust skyward, orb flares.
    const lift = p === null ? 0 : [3, 3, 2, 1, 0, 0][p] || 0;
    const hand = [9, 8 - lift], top = -lift;
    const pts = [];
    for (let y = top; y <= 12 - lift; y++) pts.push([10, y, y % 4 === 0 ? WOOD_D : WOOD]);
    const oy = top - 2, orbC = c.pal.P;
    pts.push([10, oy, X.mix(orbC, WHITE, 0.6)], [11, oy, orbC], [10, oy + 1, orbC], [11, oy + 1, X.shade(orbC, 0.7)]);
    c.F.stamp(pts, c.pal.K);
    const flare = p !== null && p <= 2 ? 1 - p * 0.3 : 0;
    c.F.glow(10.5, oy + 0.5, 5 + flare * 6, orbC, 0.3 + flare * 0.4);
    if (flare) { sparkleRing(c.FX, 10.5, oy + 0.5, 3 + p, [255, 200, 120], c.t, 5); c.FX.glow(16, 6, 8, [255, 160, 80], 0.25 * flare); }
    return hand;
  },
  bow(c, p) { // Ranger fires first: full draw, then release with a crit glint.
    const aim = p !== null && p <= 2, cx = aim ? 12 : 11, cy = aim ? 7 : 8;
    const pts = [];
    for (let u = -4; u <= 4; u++) pts.push([cx - Math.round(1.6 * (u / 4) ** 2), cy + u, Math.abs(u) === 4 ? WOOD_D : WOOD]);
    c.F.stamp(pts, c.pal.K);
    if (p === 0) {
      c.F.line([cx - 2, cy - 3], [6, cy], STRING); c.F.line([6, cy], [cx - 2, cy + 3], STRING);
      for (let x = 6; x <= cx + 2; x++) c.F.set(x, cy, x > cx ? c.pal[7] : WOOD_L);
      glint(c.FX, [cx + 3, cy], [255, 220, 120], c.t);
    } else {
      for (let u = -3; u <= 3; u++) c.F.set(cx - 2 + (p === 1 && Math.abs(u) <= 1 ? 1 : 0), cy + u, STRING);
      if (p === 1) for (let x = cx + 2; x < cx + 9; x++) c.FX.set(x, cy, X.mix([120, 110, 90], [255, 240, 180], (x - cx) / 9));
    }
    return aim ? [10, cy] : [9, 8];
  },
  sword(c, p) { // Knight taunts: sword up, shield raised, a ward shimmer.
    const up = p !== null && p <= 3;
    const hand = up ? [9, 5] : [9, 8], ang = up ? -90 : -75;
    const d = dirOf(ang), g = [hand[0] + 1, hand[1]];
    const P = (k, m = 0) => [g[0] + d[0] * k - d[1] * m, g[1] + d[1] * k + d[0] * m];
    const pts = [[...P(1, -1), c.pal.Y], [...P(1), c.pal.Y], [...P(1, 1), c.pal.Y]];
    for (let k = 2; k <= 6; k++) pts.push([...P(k), k === 6 ? WHITE : c.pal[7]]);
    c.F.stamp(pts, c.pal.K);
    const sy = up ? 4 : 6;
    c.B.rows(['KKKK', 'K5YK', 'KYYK', 'K56K', '.KK.'], c.pal, -1, sy);
    if (up && p <= 1) glint(c.FX, P(6), [255, 250, 220], c.t);
    if (up && p >= 1) { c.B.glow(1, sy + 2, 7, [120, 200, 255], 0.35); c.FX.label(4, -3, '!', [255, 90, 70]); }
    return hand;
  },
  familiar(c, p) { // Warlock curses: the imp darts in, leaving a purple trail.
    const home = [12, 1 + Math.round(Math.sin(c.t * 0.25))];
    const f = p === null ? home : [[17, 4], [21, 6], [18, 4], [14, 2], home, home][p] || home;
    if (p !== null && p <= 2) c.FXb.line(home, f, X.shade(c.pal.P, 0.55));
    const up = (c.t >> 1) % 2, P = c.pal.P, dk = X.shade(P, 0.6);
    c.F.stamp([[f[0], f[1], P], [f[0] + 1, f[1], P], [f[0] + 2, f[1], [255, 236, 140]], [f[0] + 1, f[1] + 1, dk], [f[0], f[1] - 1, dk], [f[0] + 2, f[1] - 1, dk], [f[0] - 1, f[1] + (up ? -1 : 1), dk]], c.pal.K);
    c.F.glow(f[0] + 1, f[1], 5, P, 0.35 + (p !== null && p <= 2 ? 0.3 : 0));
    if (p !== null && p <= 3) sparkleRing(c.FX, f[0] + 1, f[1], 3, [150, 60, 220], c.t, 3);
    return p !== null && p <= 2 ? [9, 6] : [9, 8];
  },
  lute(c, p) { // Bard buffs the party: strum, golden notes and a warm glow.
    const bob = p !== null && p <= 3 ? -1 : 0;
    const pts = [];
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) pts.push([5 + dx, 9 + dy + bob, dx === 0 && dy === 0 ? [60, 40, 25] : dx + dy < 0 ? WOOD_L : WOOD]);
    pts.push([7, 8 + bob, WOOD_D], [8, 7 + bob, WOOD_D], [9, 6 + bob, WOOD_D], [10, 5 + bob, c.pal.Y]);
    c.B.stamp(pts, c.pal.K);
    if (p !== null && p <= 4) {
      c.B.glow(5, 9, 9, [255, 214, 100], 0.3);
      c.FX.label(11 + (p >> 1), 2 - p, p % 2 ? '♫' : '♪', [255, 214, 80]);
    }
    return [8, (p !== null && p <= 3 && c.t % 2) ? 7 + bob : 8 + bob];
  },
  daggers(c, p) { // Rogue bursts a single target: dash, stab, slash marks.
    c.dx = p === null ? 0 : [3, 3, 2, 1, 0, 0][p] || 0;
    const stab = p !== null && p <= 2;
    const hand = stab ? [10, 8] : [9, 8];
    const tip = dagger(c.F, [hand[0] + 1, hand[1]], stab ? 0 : -60, c.pal);
    dagger(c.B, [1, 9], 95, c.pal);
    if (stab) {
      for (let x = -3; x <= 0; x++) c.FXb.set(x + 2, 8, X.shade(c.pal[5], 0.5));
      if (p <= 1) for (let i = -2; i <= 2; i++) { c.FX.set(tip[0] + 2 + i, 8 + i, WHITE); c.FX.set(tip[0] + 2 + i, 8 - i, X.mix(c.pal[5], WHITE, 0.5)); }
    }
    return hand;
  },
};

// Small companion sprite. `who` is a party entry ({cls}), a class id, or a
// legacy X.CLASS_COLORS entry. opts: t, flip, alpha, id (for skin/hair),
// attack (progress 0..5 or null), walk.
function drawCompanion(pc, who, x, y, opts = {}) {
  const { flip = false, alpha = 1, t = 0, walk = false } = opts;
  const sit = !!(opts.sit || opts.sleep), dozing = !!opts.sleep;
  const attack = Number.isFinite(opts.attack) ? opts.attack : null;
  const cls = companionClass(who, opts.cls), def = C.CLASSES[cls];
  const id = opts.id !== undefined ? opts.id : (who && typeof who === 'object' && (who.id || who.name)) || cls;
  const pal = compPalette(cls, seedOf(id));
  if (dozing) pal.E = pal.h;
  const c = { B: new Layer(), F: new Layer(), FXb: new Layer(), FX: new Layer(), pal, t, dx: 0 };
  const step = walk && (t >> 1) % 2;
  const dy = walk ? (step ? -1 : 0) : 0;
  const headDy = (!walk && attack === null && t % (dozing ? 30 : 20) >= (dozing ? 15 : 10) ? 1 : 0) + (sit ? 2 : 0);
  const rows = step ? edit(COMP_BODY, COMP_WALK) : COMP_BODY;
  const [hy, head] = COMP_HEADS[def.head] || [0, []];
  if (sit) {
    rows.forEach((r, j) => { if (j >= 6 && j <= 9) c.B.rows([r], pal, 0, j + 2); });
    c.B.rows([COMP_SIT], pal, 0, 12);
  } else rows.forEach((r, j) => { if (j >= 6) c.B.rows([r], pal, 0, j); });
  rows.forEach((r, j) => { if (j < 6) c.B.rows([r], pal, 0, j + headDy); });
  head.forEach((r, j) => c.B.rows([r], pal, 0, hy + j + headDy));
  if (sit) compArm(c.F, [9, 11], pal, 2);
  else compArm(c.F, (COMP_RIGS[def.weapon] || COMP_RIGS.staff)(c, attack), pal);
  // Floor shadow.
  for (let dx = 1; dx < 10; dx++) {
    const gx = X.clamp(x + dx + (flip ? -c.dx : c.dx)), gy = Math.min(pc.h - 1, y + 13);
    if (gx < pc.w && gy >= 0) pc.set(gx, gy, X.shade(pc.get(gx, gy) || [0, 0, 0], 0.6));
  }
  const bo = { flip, alpha, w: 11, dx: c.dx };
  c.B.blit(pc, x, y + dy, bo);
  c.FXb.blit(pc, x, y + dy, bo);
  c.F.blit(pc, x, y + dy, bo);
  c.FX.blit(pc, x, y + dy, bo);
}

const MON = require('./monsters');

module.exports = { MONSTERS: MON.MONSTERS, drawMonster: MON.drawMonster, monsterSize: MON.monsterSize, build, drawHero, drawCompanion, palette, POSES, HEADS, companionClass,
  // Raw sprite data for the web view (/api/assets).
  BODY, FACES, SIT_LEGS, ACCESSORY, CAPE, COMP_BODY, COMP_WALK, COMP_SIT, COMP_HEADS };
