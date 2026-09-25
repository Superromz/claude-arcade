'use strict';
// Monster sprites and drawing. Owned by the battle system.

const X = require('./pixel');

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

module.exports = { MONSTERS, MONSTER_COLORS, drawMonster, monsterSize };
