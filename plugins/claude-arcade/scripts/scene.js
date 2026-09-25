'use strict';
// Composes the battle scene: background, hero, companions, monsters, effects.

const L = require('./lib');
const M = require('./messages');
const X = require('./pixel');
const C = require('./character');
const SP = require('./sprites');
const { ESC, RESET, BOLD, NOBOLD, fg, bg, UI, TABS, SIDE, ui, snapshotData, currentMode, isBusy } = require('./state');
const { emit, floater, spawnWave, hitMonster, aliveMonsters, COOLDOWN, playerCast, cast, stepBattle, drawShots, drawBattleOverlay } = require('./battle');
const { drawBackground } = require('./backgrounds');

function drawScene(pc, d, pal) {
  ui.frameData = d;
  const t = ui.tick, th = d.cfg.theme, W = pc.w, H = pc.h;
  const floorY = H - Math.max(5, Math.floor(H * 0.18));
  const mode = currentMode(d.ses);
  const partyN = Math.min(4, Object.keys(d.ses.party || {}).length);
  const heroX = Math.max(Math.floor(W * 0.2), 12 * partyN + 4);
  const heroY = floorY - 24 - (mode === 'idle' && (t >> 3) % 2 ? 1 : 0);

  drawBackground(pc, th, floorY, Math.floor(t * (isBusy(mode) ? 0.15 : 0)), t);

  if (mode === 'idle') {
    const fx = heroX + 22;
    pc.glow(fx + 4, floorY - 3, 28, [255, 140, 50], 0.4 + 0.08 * Math.sin(t * 0.7));
    pc.sprite(fx, floorY - 6, X.FIRE[(t >> 2) % 3], X.BASE);
    if (t % 3 === 0) emit(1, fx + 4, floorY - 6, [[255, 200, 90], [255, 120, 40]], { spread: 0.3, up: 0.8, grav: -0.02, life: 14 });
    pc.label(heroX + 6 + ((t >> 3) % 3), Math.max(0, Math.floor((heroY - 4 - ((t >> 2) % 4)) / 2)), (t >> 4) % 2 ? 'z' : 'Z', pal.dim);
  }

  Object.values(d.ses.party || {}).slice(0, 4).forEach((p, i) => {
    const colors = X.CLASS_COLORS[p.cls] || X.CLASS_COLORS.Mage;
    const fresh = Math.min(1, (Date.now() - (p.since || 0)) / 1500);
    SP.drawCompanion(pc, colors, heroX - 12 * (i + 1), floorY - 13 - ((t + i * 3) >> 2 & 1), { alpha: fresh, t: t + i * 2 });
  });

  let pose = 'stand', tint = null;
  if (mode === 'victory' || mode === 'cheer' || mode === 'summoning') pose = 'cheer';
  else if (mode === 'hurt') { pose = 'hurt'; if ((t >> 1) % 2) tint = [[255, 60, 60], 0.55]; }
  else if (isBusy(mode) && (t >> 2) % 6 === 0) pose = 'cheer';
  const jump = (mode === 'victory' || mode === 'cheer') && (t >> 2) % 2 ? 2 : 0;
  const origin = [heroX + 15, heroY + 6];
  ui.heroX = heroX; ui.heroY = heroY;
  SP.drawHero(pc, d.hero, heroX, heroY - jump, { pose, t, tint, action: isBusy(mode) });

  if (mode === 'summoning') {
    const cx = heroX + 30, cy = floorY - 1;
    pc.glow(cx, cy - 4, 18, pal.magic, 0.45);
    for (let a = 0; a < 24; a++) { const ang = a / 24 * 6.28 + t * 0.15; pc.set(cx + Math.cos(ang) * 9, cy + Math.sin(ang) * 2, a % 2 ? pal.magic : [255, 255, 255]); }
  }
  if (mode === 'thinking' && !aliveMonsters().length) {
    const bx = heroX + 26, by = Math.max(5, heroY - 4);
    for (let y = -4; y <= 4; y++) for (let x = -7; x <= 7; x++) if ((x * x) / 49 + (y * y) / 16 <= 1) pc.set(bx + x, by + y, [236, 236, 246]);
    pc.rect(heroX + 17, heroY + 1, 2, 2, [236, 236, 246]); pc.rect(heroX + 20, heroY - 1, 2, 2, [236, 236, 246]);
    pc.label(bx - 1, Math.floor(by / 2), ['?', '…', '!', '✦'][(t >> 3) % 4], pal.ink);
  }
  if (mode === 'waiting' && (t >> 3) % 2) pc.label(heroX + 7, Math.max(0, Math.floor((heroY - 5) / 2)), '!', pal.accent);
  if (mode === 'victory') {
    const cx = heroX + 26;
    pc.sprite(cx, floorY - 8, X.CHEST.open, X.BASE);
    pc.glow(cx + 6, floorY - 6, 18, [255, 210, 80], 0.45);
    if (t % 2 === 0) emit(3, cx + 6, floorY - 7, [[255, 214, 80], [255, 240, 150], [255, 170, 40]], { spread: 0.9, up: 3 });
    if (t % 2 === 0) emit(2, Math.random() * W, 0, [pal.gold, pal.magic, pal.good, pal.bad, pal.accent], { spread: 0.4, up: -0.3, grav: 0.05, life: 50 });
  }

  stepBattle(d, pc, floorY, heroX, origin, pal, mode);
  const front = aliveMonsters().sort((a, b) => a.x - b.x)[0];
  for (const m of ui.battle.monsters) SP.drawMonster(pc, m, t, { target: m === front });
  if (front) {
    const def = SP.MONSTERS[front.type];
    const tag = `${def.name} Lv${front.lvl} · ${Math.max(0, front.hp)}/${front.max} HP · ${ui.battle.practice ? 'practice' : `${front.xp} XP`}`;
    const [fw] = SP.monsterSize(front);
    pc.label(Math.max(0, Math.min(W - tag.length - 1, Math.round(front.x + fw / 2 - tag.length / 2))), Math.max(1, Math.floor((front.y - (front.boss ? 11 : 8)) / 2)), tag, [255, 236, 200], true);
  }
  drawShots(pc);
  drawBattleOverlay(pc, pal, d);

  ui.particles = ui.particles.filter((p) => (p.life -= 1) > 0);
  for (const p of ui.particles) {
    p.x += p.vx; p.y += p.vy; p.vy += p.g;
    if (p.y > floorY - 1) { p.y = floorY - 1; p.vy *= -0.4; p.vx *= 0.7; }
    pc.set(p.x, p.y, p.c);
  }
  ui.floaters = ui.floaters.filter((f) => (f.life -= 1) > 0);
  for (const f of ui.floaters) { f.y -= 0.5; pc.label(Math.floor(f.x), Math.max(0, Math.floor(f.y / 2)), f.text, f.color, f.bold); }

  if (ui.battle.flash > 0) { ui.battle.flash--; pc.px = pc.px.map((c) => X.mix(c, [255, 250, 230], 0.5)); }
  pc.px = pc.px.map((c, i) => { const v = ((i % W) / W - 0.5) * 2; return X.shade(c, 1 - 0.28 * v * v); });
  if (th === 'retro') pc.map((c) => { const l = (c[0] * 0.3 + c[1] * 0.59 + c[2] * 0.11) / 255; const q = Math.round(l * 5) / 5; return [10 + q * 40, 20 + q * 235, 10 + q * 60].map(X.clamp); });
  pc.label(1, 0, ` ${ui.battle.practice ? 'PRACTICE ' : ''}WAVE ${ui.battle.wave} · ${ui.battle.kills} slain · ◉ ${ui.battle.gold} gold `, pal.gold);
}

// Render at a logical resolution sized so the hero is ~40% of the scene height.
function sceneLines(cols, rows, d, pal) {
  const S = Math.max(1, Math.min(4, Math.round((rows * 2) / 62)));
  const lc = Math.ceil(cols / S), lr = Math.ceil(rows / S);
  const small = new X.PixelCanvas(lc, lr);
  drawScene(small, d, pal);
  ui.sceneScale = S;
  let lines;
  if (S === 1) lines = small.lines();
  else {
    const big = new X.PixelCanvas(cols, rows);
    for (let y = 0; y < big.h; y++) for (let x = 0; x < cols; x++) big.px[y * cols + x] = small.px[Math.floor(y / S) * lc + Math.floor(x / S)];
    for (const [k, v] of small.text) { const [c, r] = k.split(',').map(Number); if (c * S < cols) big.text.set(`${c * S},${Math.min(rows - 1, Math.floor(r * S + S / 2))}`, v); }
    lines = big.lines();
  }
  if (ui.battle.shake > 0) { ui.battle.shake--; if (ui.battle.shake % 2) lines = lines.slice(1).concat(lines[0]); }
  return lines;
}

module.exports = { drawScene, sceneLines };
