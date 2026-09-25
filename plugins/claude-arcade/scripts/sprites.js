// Composable 16×24 hero sprites: body + headgear + accessory layers, colored
// from the player's choices with 3-tone ramps (light / mid / shadow), plus
// per-class weapons drawn in code at the hand anchors.
'use strict';

const X = require('./pixel');
const C = require('./character');

const ramp = (c) => [X.mix(c, [255, 255, 255], 0.32), c, X.shade(c, 0.62)];

// Body. Keys: K outline, S/T skin, h hair, E eye, 1-3 primary, Y belt, v boots.
const BODY = [
  '................', '................', '................', '................', '................',
  '......KKKK......',
  '.....KhhhhK.....',
  '....KhhhhhhK....',
  '....KhSSSShK....',
  '....KSSSSSSK....',
  '....KSESSESK....',
  '....KSSSSSTK....',
  '.....KTSSTK.....',
  '....KK1221KK....',
  '...K11222223K...',
  '..K1122222233K..',
  '..K1122222233K..',
  '..K1122222233K..',
  '.KSKYYYYYYYYKSK.',
  '..KK12222233KK..',
  '...K1222223K....',
  '...K122K223K....',
  '...KvvK.KvvK....',
  '...KKKK.KKKK....',
];
const edit = (rows, e) => rows.map((r, i) => (e[i] !== undefined ? e[i] : r));
const POSES = {
  stand: BODY,
  walk1: edit(BODY, { 21: '...K122K223K....', 22: '..KvvK...KvvK...', 23: '..KKKK...KKKK...' }),
  walk2: edit(BODY, { 21: '....K12223K.....', 22: '....KvvvvK......', 23: '....KKKKKK......' }),
  cheer: edit(BODY, { 9: '..SKSSSSSSKS....'.slice(0, 16), 10: '..1KSESSESK1....', 11: '..1KSSSSSTK1....', 12: '..1.KTSSTK.1....', 13: '..KKK1221KKK....', 18: '..KKYYYYYYYYKK..' }),
  hurt: edit(BODY, { 10: '....KSKSSKSK....', 11: '....KSSEESTK....' }),
};
// Fix cheer rows so arms sit symmetrically either side of the head.
POSES.cheer = edit(BODY, {
  8: '..S.KhSSSShK.S..', 9: '..1.KSSSSSSK.1..', 10: '..1.KSESSESK.1..', 11: '..1.KSSSSSTK.1..', 12: '..1K.KTSSTK.K1..',
  13: '..KKKK1221KKKK..', 18: '..KKYYYYYYYYKK..',
});
const BLINK_ROW = '....KSTSSTSK....';

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
  return {
    K: [22, 18, 30], S: skin, T: X.shade(skin, 0.8), h: C.HAIR[ch.hair] || C.HAIR.brown, E: [24, 24, 40],
    1: p1, 2: p2, 3: p3, 4: s4, 5: s5, 6: s6, 7: [226, 230, 240], 8: [160, 166, 182], 9: [98, 102, 120],
    Y: [232, 186, 62], v: [72, 52, 42], W: [236, 232, 220], P: [190, 130, 255],
  };
}

// Returns layered sprite rows for a pose; the caller draws cape first.
function build(ch, pose, t) {
  const cls = C.CLASSES[ch.cls] || C.CLASSES.mage;
  let rows = (POSES[pose] || POSES.stand).slice();
  if (pose !== 'hurt' && (t % 45) < 2) rows[10] = BLINK_ROW;
  const acc = ACCESSORY[ch.accessory];
  if (acc) rows = rows.map((r, i) => overlay(r, acc[i]));
  const head = HEADS[cls.head] || [];
  rows = rows.map((r, i) => overlay(r, head[i]));
  return rows;
}

function overlay(base, top) {
  if (!top) return base;
  let out = '';
  for (let i = 0; i < base.length; i++) out += top[i] && top[i] !== '.' ? top[i] : base[i];
  return out;
}

// Draw the full hero at (x, y) = top-left of the 16×24 box.
function drawHero(pc, ch, x, y, { pose = 'stand', t = 0, flip = false, tint = null, action = null, glowColor } = {}) {
  const pal = palette(ch);
  const cls = C.CLASSES[ch.cls] || C.CLASSES.mage;
  const px = (dx) => (flip ? x + 15 - dx : x + dx);
  // Shadow on the floor.
  for (let dx = 2; dx < 14; dx++) pc.set(px(dx), y + 24, X.shade(pc.get(Math.max(0, Math.min(pc.w - 1, px(dx))), Math.min(pc.h - 1, y + 24)) || [0, 0, 0], 0.55));
  if (ch.accessory === 'cape') pc.sprite(x, y, CAPE((t >> 3) % 2), pal, { flip, tint });
  pc.sprite(x, y, build(ch, pose, t), pal, { flip, tint });
  drawWeapon(pc, cls.weapon, px, y, pal, t, pose, action, glowColor);
}

// Weapons at the hand anchors (right hand ≈ (13,18), left hand ≈ (2,18)).
function drawWeapon(pc, weapon, px, y, pal, t, pose, action, glowColor) {
  const up = pose === 'cheer';
  const set = (dx, dy, c) => pc.set(px(dx), y + dy, c);
  switch (weapon) {
    case 'staff': {
      for (let dy = up ? 1 : 5; dy <= 23; dy++) set(14, dy, dy % 5 === 0 ? [96, 62, 36] : [138, 92, 52]);
      const oy = up ? -1 : 3;
      const orb = X.mix(pal.P, [255, 255, 255], 0.3 + 0.3 * Math.sin(t * 0.5));
      set(14, oy, orb); set(15, oy, orb); set(14, oy + 1, orb); set(15, oy + 1, pal.P); set(13, oy + 1, pal.P);
      pc.glow(px(14), y + oy + 1, 7, glowColor || pal.P, 0.35);
      return [px(14), y + oy + 1];
    }
    case 'bow': {
      for (let dy = 10; dy <= 23; dy++) { const bend = Math.round(Math.sin((dy - 10) / 13 * Math.PI) * 2); set(14 + bend, dy, [150, 100, 55]); set(14, dy, [220, 220, 220]); }
      if (action) for (let dx = 8; dx < 17; dx++) set(dx, 16, dx > 14 ? pal[7] : [150, 100, 55]);
      return [px(16), y + 16];
    }
    case 'sword': {
      const bx = 14, top = up ? 4 : 9;
      for (let dy = top; dy < top + 8; dy++) { set(bx, dy, pal[7]); set(bx + 1, dy, pal[8]); }
      set(bx - 1, top + 8, pal.Y); set(bx, top + 8, pal.Y); set(bx + 1, top + 8, pal.Y); set(bx + 2, top + 8, pal.Y); set(bx, top + 9, [110, 70, 40]);
      for (let dy = 14; dy < 21; dy++) for (let dx = 0; dx < 4; dx++) set(dx, dy, dx === 0 || dy === 14 || dy === 20 ? pal.K : dy === 17 && dx > 0 ? pal.Y : pal[5]);
      return [px(bx), y + top];
    }
    case 'familiar': {
      const fy = 6 + Math.round(Math.sin(t * 0.25) * 2);
      const eye = (t % 40) < 2 ? pal.P : [255, 255, 255];
      [[16, fy], [17, fy], [16, fy + 1], [17, fy + 1], [15, fy + 1], [18, fy + 1]].forEach(([dx, dy], i) => set(dx, dy, i < 2 ? eye : pal.P));
      pc.glow(px(17), y + fy, 8, pal.P, 0.4);
      return [px(17), y + fy];
    }
    case 'lute': {
      for (let i = 0; i < 6; i++) set(9 + i, 19 - i, [150, 100, 55]);
      for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) if (dx * dx + dy * dy <= 5) set(8 + dx, 19 + dy, dx * dx + dy * dy <= 1 ? [60, 40, 25] : [196, 140, 70]);
      if (action && t % 6 < 3) pc.label(Math.floor(px(15) + 1), Math.floor((y + 10 - (t % 6)) / 2), '♪', [255, 214, 80]);
      return [px(14), y + 13];
    }
    case 'daggers': {
      [[1, 15], [14, 15]].forEach(([dx, dy]) => { set(dx, dy, pal[7]); set(dx, dy + 1, pal[7]); set(dx, dy + 2, pal.Y); });
      return [px(14), y + 15];
    }
  }
  return [px(14), y + 12];
}

// Small companion sprite, colored per agent class.
function drawCompanion(pc, colors, x, y, { flip = false, alpha = 1, t = 0 } = {}) {
  const pal = { K: [22, 18, 30], S: [240, 200, 160], E: [24, 24, 40], Y: [232, 186, 62], v: [72, 52, 42], 1: X.mix(colors.R, [255, 255, 255], 0.3), 2: colors.R, 3: X.shade(colors.R, 0.62), 4: X.mix(colors.H, [255, 255, 255], 0.3), 5: colors.H, 6: X.shade(colors.H, 0.62) };
  const rows = [
    '...KKKKK...', '..K45555K..', '.K4555556K.', '.KKSSSSSKK.', '..KSESESK..', '..KSSSSTK..',
    '..KK122KK..', '.K1122223K.', 'KSK12223KSK', '.KK12223KK.', '..K12K23K..', (t >> 2) % 2 ? '..KvK.KvK..' : '.KvK...KvK.', '..KKK.KKK..',
  ];
  for (let dx = 1; dx < 10; dx++) pc.set(flip ? x + 10 - dx : x + dx, y + 13, X.shade(pc.get(Math.max(0, Math.min(pc.w - 1, x + dx)), Math.min(pc.h - 1, y + 13)) || [0, 0, 0], 0.6));
  pc.sprite(x, y, rows, pal, { flip, alpha });
}

// ---------- monsters ----------
// Shaded monster sprites. Keys: K outline, h highlight, G body, g shadow,
// d deep shadow, W bone/teeth, R eyes, Y gold, b wood, M metal.

const MONSTERS = {
  slime: { name: 'Slime', hp: 12, xp: 2, speed: 0.35, frames: [
    ['.....KKKK.....', '...KKhhhGKK...', '..KhhGGGGGgK..', '.KhGGGGGGGGgK.', '.KGGWWGGGWWgK.', 'KGGGWKGGGWKGgK', 'KGGGGGGGGGGGgK', 'KGGGGKKKKGGggK', 'KgGGGGGGGGggdK', '.KggggggggddK.', '..KKKKKKKKKK..'],
    ['..............', '.....KKKK.....', '..KKKhhhGKKK..', '.KhhGGGGGGGgK.', 'KhGGWWGGGWWGgK', 'KGGGWKGGGWKGgK', 'KGGGGGGGGGGGgK', 'KGGGGKKKKGGggK', 'KgGGGGGGGGggdK', 'KgggggggggdddK', '.KKKKKKKKKKKK.']] },
  bat: { name: 'Bat', hp: 9, xp: 2, speed: 0.6, fly: true, frames: [
    ['K.............K', 'KK...........KK', 'KgK..K...K..KgK', 'KggK.KKKKK.KggK', 'KgggKGRGRGKgggK', '.KggKGGGGGKggK.', '..KK.KGWGK.KK..', '......KKK......'],
    ['...............', '.....K...K.....', '.....KKKKK.....', '.KKKKGRGRGKKKK.', 'KgggKGGGGGKgggK', 'KggK.KGWGK.KggK', 'KgK...KKK...KgK', 'K.............K']] },
  skeleton: { name: 'Skeleton', hp: 18, xp: 4, speed: 0.3, frames: [
    ['...KKKKKK...', '..KWWWWWgK..', '..KWKWWKgK..', '..KWRWWRgK..', '..KWWWWWgK..', '...KWKWKK...', '....KWWK....', '..KKWWWWKK.M', '.KWKgWWgKWKM', '.KWKKWWKKWKM', '..K.KWWK.KYY', '....KggK..b.', '...KW..WK...', '...KW..WK...', '..KWK..KWK..', '..KK....KK..'],
    ['...KKKKKK...', '..KWWWWWgK..', '..KWKWWKgK..', '..KWRWWRgK..', '..KWWWWWgK..', '...KWKWKK...', '....KWWK..M.', '..KKWWWWKKM.', '.KWKgWWgKWM.', '.KWKKWWKKYY.', '..K.KWWK.bK.', '....KggK....', '...KW..WK...', '..KW....WK..', '.KWK....KWK.', '.KK......KK.']] },
  goblin: { name: 'Goblin', hp: 22, xp: 3, speed: 0.4, frames: [
    ['.K.........K.', 'KhK.KKKKK.KgK', 'KhGKhGGGGKGgK', '.KGGGGGGGGgK.', '..KGYKGGYKgK.', '..KGGGGGGGgK.', '..KGKWKWKgK.b', '...KKGGgKK.bb', '..KbbbbbbbKbb', '.KGKbbbbbKGK.', '.KGKbbbbbK.K.', '...KGK.KgK...', '...KKK.KKK...'],
    ['.K.........K.', 'KhK.KKKKK.KgK', 'KhGKhGGGGKGgK', '.KGGGGGGGGgK.', '..KGYKGGYKgK.', '..KGGGGGGGgK.', '..KGKKKKKgK..', '...KKGGgKKbb.', '..KbbbbbbbKbbb', '.KGKbbbbbKGK.', '.KGKbbbbbK.K.', '..KGK...KgK..', '..KKK...KKK..']] },
};
MONSTERS.boss = { ...MONSTERS.goblin, name: 'Goblin Warlord', hp: 90, xp: 25, speed: 0.25, boss: true };
const CROWN = ['.Y.Y.Y.', '.YYYYY.', '.KKKKK.'];
const MONSTER_COLORS = {
  slime: [{ G: [104, 208, 96], g: [60, 150, 64], d: [34, 96, 44], h: [200, 255, 190] }, { G: [96, 160, 240], g: [60, 110, 196], d: [36, 64, 130], h: [200, 230, 255] }, { G: [236, 110, 170], g: [186, 70, 126], d: [120, 40, 84], h: [255, 210, 235] }],
  bat: [{ G: [120, 84, 150], g: [84, 56, 112], d: [50, 32, 70], h: [170, 140, 200] }],
  skeleton: [{ G: [220, 214, 196], g: [150, 144, 130], d: [96, 92, 84], h: [255, 255, 245] }],
  goblin: [{ G: [124, 176, 70], g: [82, 124, 46], d: [50, 80, 30], h: [180, 220, 120] }, { G: [180, 140, 70], g: [130, 96, 44], d: [80, 60, 28], h: [220, 190, 120] }],
  boss: [{ G: [196, 70, 60], g: [140, 44, 40], d: [90, 26, 26], h: [240, 140, 120] }],
};
const MONSTER_BASE = { K: [20, 16, 26], W: [236, 232, 218], R: [255, 64, 56], Y: [255, 206, 70], b: [124, 82, 48], M: [196, 202, 216] };
const monsterSize = (m) => { const f = MONSTERS[m.type].frames[0]; const S = m.boss ? 2 : 1; return [Math.max(...f.map((r) => r.length)) * S, f.length * S]; };

function drawMonster(pc, m, t, { target = false } = {}) {
  const def = MONSTERS[m.type];
  const colors = MONSTER_COLORS[m.type] || MONSTER_COLORS.slime;
  const pal = { ...MONSTER_BASE, ...colors[m.color % colors.length] };
  const frame = def.frames[((t >> 2) + m.seed) % 2];
  const S = m.boss ? 2 : 1;
  const [w, h] = monsterSize(m);
  const x = Math.round(m.x), y = Math.round(m.y);
  const tint = m.flash > 0 ? [[255, 255, 255], 0.8] : m.frozen > 0 ? [[150, 225, 255], 0.5] : null;
  // Soft shadow.
  const sy = def.fly ? Math.round(m.baseY + h + 8) : y + h;
  for (let dx = 1; dx < w - 1; dx++) pc.set(x + dx, Math.min(pc.h - 1, sy), X.shade(pc.get(Math.max(0, Math.min(pc.w - 1, x + dx)), Math.min(pc.h - 1, sy)) || [0, 0, 0], def.fly ? 0.8 : 0.55));
  if (target) pc.glow(x + w / 2, y + h / 2, Math.max(w, h), [255, 80, 60], 0.12);
  frame.forEach((row, j) => { for (let i = 0; i < row.length; i++) {
    const k = row[i]; if (k === '.' || !pal[k]) continue;
    pc.rect(x + i * S, y + j * S, S, S, tint ? X.mix(pal[k], tint[0], tint[1]) : pal[k]);
  } });
  if (m.boss) pc.sprite(x + Math.floor(w / 2) - 3, y - 3, CROWN, pal);
  // Outlined HP bar, green → yellow → red.
  const bw = Math.max(10, w), bx = x + Math.floor((w - bw) / 2), by = y - (m.boss ? 7 : 4);
  const ratio = Math.max(0, m.hp / m.max);
  const col = ratio > 0.6 ? [110, 230, 100] : ratio > 0.3 ? [250, 210, 70] : [255, 80, 70];
  for (let i = -1; i <= bw; i++) { pc.set(bx + i, by - 1, pal.K); pc.set(bx + i, by + 2, pal.K); }
  for (let i = 0; i < bw; i++) for (let j = 0; j < 2; j++) pc.set(bx + i, by + j, i < Math.round(bw * ratio) ? X.shade(col, j ? 0.75 : 1) : [54, 44, 60]);
  pc.set(bx - 1, by, pal.K); pc.set(bx - 1, by + 1, pal.K); pc.set(bx + bw, by, pal.K); pc.set(bx + bw, by + 1, pal.K);
}

module.exports = { MONSTERS, drawMonster, monsterSize, build, drawHero, drawCompanion, palette, POSES, HEADS };
