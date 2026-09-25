'use strict';
// Composes the battle scene: background, camp, hero, companions, monsters,
// effects, the hero's thought bubble and the camp recap sign.

const X = require('./pixel');
const C = require('./character');
const SP = require('./sprites');
const { ui, currentMode, isBusy, biomeFor } = require('./state');
const { emit, aliveMonsters, stepBattle, drawShots, drawBattleOverlay } = require('./battle');
const BG = require('./backgrounds');
const HD = require('./hd');

// Everything drawn after the backdrop counts as foreground for the HD renderer.
function drawBackground(pc, ...args) {
  BG.drawBackground(pc, ...args);
  if (pc.beginForeground) pc.beginForeground();
}

const REST_STEP = 6; // the party rests this far behind its battle spot and marches in
const SIT_AFTER = 30, SLEEP_AFTER = 180; // idle seconds before sitting down / dozing off
const INK = [22, 18, 30], PAPER = [248, 246, 236];

// Walk the party offset one pixel per tick toward its target.
function stepMarch(target, t, hold) {
  const m = ui.march || (ui.march = { off: target, t, walking: false });
  if (m.t !== t) {
    m.t = t;
    m.walking = !hold && m.off !== target;
    if (m.walking) m.off += Math.sign(target - m.off);
  }
  return m;
}

// ---------- camp ----------

function drawCamp(pc, { hx, fx, rollX, floorY, t, stage, hero }) {
  // Bedroll.
  const bx = rollX, by = floorY - 3, blanket = C.COLORS[hero.secondary] || C.COLORS.violet;
  for (let x = bx; x < bx + 14; x++) for (let y = by; y < floorY; y++) {
    const edge = x === bx || x === bx + 13 || y === by;
    const pillow = x < bx + 4;
    pc.set(x, y, edge ? INK : pillow ? [214, 206, 188] : X.shade(blanket, (x - bx) % 4 === 0 ? 0.7 : y === by + 1 ? 1 : 0.8));
  }
  // Log seat.
  for (let x = hx + 1; x <= hx + 13; x++) for (let y = floorY - 4; y < floorY; y++) {
    const r = y - (floorY - 4);
    let c = [[118, 80, 48], [96, 64, 38], [82, 54, 32], [62, 42, 26]][r];
    if (x === hx + 13) c = r === 0 || r === 3 ? INK : [196, 150, 96];
    else if (r === 0 && (x + 1) % 5 === 0) c = [140, 100, 62];
    pc.set(x, y, x === hx + 1 ? INK : c);
  }
  pc.set(hx + 12, floorY - 3, [150, 110, 70]);
  // Tripod and pot.
  const apex = [fx + 4, floorY - 14];
  for (const foot of [[fx - 1, floorY - 1], [fx + 9, floorY - 1]]) {
    const n = Math.max(Math.abs(foot[0] - apex[0]), Math.abs(foot[1] - apex[1]));
    for (let i = 0; i <= n; i++) pc.set(Math.round(foot[0] + (apex[0] - foot[0]) * i / n), Math.round(foot[1] + (apex[1] - foot[1]) * i / n), [74, 50, 32]);
  }
  const lit = stage !== 'sleep';
  if (lit) {
    pc.glow(fx + 4, floorY - 3, 28, [255, 140, 50], 0.4 + 0.08 * Math.sin(t * 0.7));
    pc.sprite(fx, floorY - 6, X.FIRE[(t >> 2) % 3], X.BASE);
    if (t % 3 === 0) emit(1, fx + 4, floorY - 6, [[255, 200, 90], [255, 120, 40]], { spread: 0.3, up: 0.8, grav: -0.02, life: 14 });
  } else {
    // Embers: logs with a slow red pulse.
    pc.glow(fx + 4, floorY - 2, 14, [255, 90, 40], 0.22 + 0.06 * Math.sin(t * 0.2));
    pc.sprite(fx, floorY - 2, X.FIRE[0].slice(4), X.BASE);
    for (let i = 0; i < 5; i++) if (X.hash(i, t >> 2) > 0.35) pc.set(fx + 2 + i, floorY - 2 - (i % 2), X.hash(i, t >> 3) > 0.5 ? [255, 120, 40] : [200, 50, 30]);
  }
  pc.set(apex[0], apex[1] + 1, [60, 60, 70]); pc.set(apex[0], apex[1] + 2, [60, 60, 70]);
  const pot = ['.KKKKK.', 'KgGGGgK', 'KgGGggK', '.KgggK.'];
  pc.sprite(fx + 1, floorY - 11, pot, { K: INK, G: [96, 98, 112], g: [62, 62, 74] });
  if (lit) for (let k = 0; k < 6; k++) {
    const ph = (t + k * 4) % 24;
    if (ph < 16) pc.set(fx + 4 + Math.round(Math.sin(t * 0.25 + k) * 1.5), floorY - 12 - ph, X.mix(pc.get(fx + 4, Math.max(0, floorY - 12 - ph)) || [0, 0, 0], [220, 220, 230], 0.55 - ph * 0.03));
  }
}

// Darken toward night, then add stars and a moon where the biome has a sky.
function drawNight(pc, { night, floorY, biome, t, fx }) {
  pc.px = pc.px.map((c) => X.mix(X.shade(c, 1 - 0.35 * night), [10, 14, 40], 0.25 * night));
  if (biome === 'forest' || biome === 'castle') {
    const top = Math.floor(floorY * 0.45);
    for (let k = 0; k < 16; k++) {
      const x = Math.floor(X.hash(k, 11) * pc.w), y = Math.floor(X.hash(k, 23) * top);
      if ((t + k * 7) % 24 < 18) pc.set(x, y, X.mix(pc.get(x, y), [230, 230, 255], 0.8 * night));
    }
    const mx = Math.floor(pc.w * 0.82), my = 5;
    pc.glow(mx, my, 10, [200, 210, 255], 0.3 * night);
    for (let y = -2; y <= 2; y++) for (let x = -2; x <= 2; x++) if (x * x + y * y <= 5 && !((x - 1) ** 2 + y * y <= 3)) pc.set(mx + x, my + y, X.mix(pc.get(mx + x, my + y), [236, 236, 214], night));
  }
  // Fireflies drifting around the camp.
  for (let k = 0; k < 6; k++) {
    const x = fx + 4 + Math.sin(t * 0.04 + k * 1.7) * (18 + k * 4), y = floorY - 6 - k * 2 + Math.sin(t * 0.09 + k) * 3;
    if ((t + k * 5) % 16 < 10) { pc.set(x, y, [210, 255, 120]); pc.glow(x, y, 3, [190, 255, 90], 0.3 * night); }
  }
}

// ---------- recap sign ----------

const stripIcons = (s) => String(s || '').replace(/[\u{1F000}-\u{1FFFF}\u{2600}-\u{27BF}\u{2B00}-\u{2BFF}️]/gu, '').replace(/\s+/g, ' ').trim();
const trunc = (s, n) => ([...s].length > n ? [...s].slice(0, n - 1).join('') + '…' : s);

function questSummary(text) {
  const s = stripIcons(text);
  const m = s.match(/([A-Z][^.!]*?)\.\s*\+(\d+)\s*(XP|PTS)/);
  if (m) return `${m[1].trim()} +${m[2]} ${m[3]}`;
  const q = s.match(/\+(\d+)\s*(XP|PTS)/);
  return q ? `quick quest +${q[1]} ${q[2]}` : s;
}

function recapLines(d, t) {
  const quests = (d.events || []).filter((e) => e.kind === 'quest');
  const lines = [];
  const last = quests[quests.length - 1];
  if (last) lines.push(trunc(`Last: ${questSummary(last.text)}`, 26));
  const midnight = new Date(); midnight.setHours(0, 0, 0, 0);
  const today = quests.filter((e) => (e.t || 0) >= midnight.getTime());
  const xp = today.reduce((n, e) => n + Number((stripIcons(e.text).match(/\+(\d+)\s*(XP|PTS)/) || [])[1] || 0), 0);
  lines.push(`Today: ${today.length} quest${today.length === 1 ? '' : 's'}${xp ? ` +${xp} XP` : ''}`);
  const streak = ((d.state && d.state.streak) || {}).count || 0;
  if (streak) lines.push(`Streak: ${streak} day${streak === 1 ? '' : 's'}`);
  lines.push((t >> 3) % 3 ? 'w: practice' : '');
  return lines;
}

// A small wooden board hanging from the top-right corner.
function drawRecap(pc, d, pal, t) {
  const lines = recapLines(d, t);
  const n = Math.max(...lines.map(textW), Math.ceil(10 / (ui.sceneScale || 1)));
  const W = pc.w, x0 = W - n - 5, x1 = W - 2;
  if (x0 < W * 0.45 || pc.rows < 12) return;
  const r0 = 2, y0 = 2 * r0 - 2, y1 = 2 * (r0 + lines.length) + 1;
  for (const cx of [x0 + 2, x1 - 2]) for (let y = 0; y < y0; y++) pc.set(cx, y, y % 2 ? [150, 150, 160] : [96, 96, 108]);
  for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
    const edge = x === x0 || x === x1 || y === y0 || y === y1;
    const rim = x === x0 + 1 || x === x1 - 1 || y === y0 + 1 || y === y1 - 1;
    if (edge && (x === x0 || x === x1) && (y === y0 || y === y1)) continue;
    pc.set(x, y, edge ? INK : rim ? [104, 70, 40] : (y - y0) % 4 === 0 ? [122, 84, 50] : [138, 96, 58]);
  }
  pc.set(x0 + 2, y0 + 1, [200, 200, 210]); pc.set(x1 - 2, y0 + 1, [200, 200, 210]);
  lines.forEach((l, i) => { if (l) pc.label(x0 + 3, r0 + i, l, i === lines.length - 1 ? pal.accent : [252, 236, 200], i === 0); });
}

// ---------- thought / speech bubble ----------

const VERB = { reading: 'Reading', editing: 'Editing', searching: 'Searching', running: 'Running', web: 'Browsing', summoning: 'Summoning', planning: 'Planning' };
const MUSINGS = {
  mage: ['Hmm, arcane…', 'The runes align…', 'More mana, please'],
  knight: ['For the codebase!', 'Hold the line!', 'Shields up!'],
  rogue: ['Quick and quiet…', 'In and out…', 'Nobody saw that'],
  ranger: ['Tracking the bug…', 'Steady aim…', 'Tracks lead here…'],
  bard: ['A tale of tests…', 'This needs a song', 'Encore!'],
  warlock: ['The void answers…', 'Dark pacts compile', 'Whispers…'],
};

function bubbleFor(d, mode, t, cls) {
  if (mode === 'waiting') return { text: (t >> 5) % 2 ? 'Need your OK' : 'Your move!', speech: true };
  if (mode === 'hurt') return t - (ui.hurtT || 0) < 16 ? { text: 'Ouch!', speech: true } : null;
  if (!isBusy(mode)) return null;
  const detail = stripIcons(d.ses.detail);
  let main = '';
  if (mode !== 'thinking') main = detail ? (mode === 'running' && /^[A-Z][a-z]+\b/.test(detail) ? detail : `${VERB[mode] || 'Working on'} ${detail}`) : `${VERB[mode] || 'Working'}…`;
  else {
    const q = (d.events || []).filter((e) => e.kind === 'prompt').pop();
    if (q) main = stripIcons(q.text).replace(/^New quest:\s*/i, '');
  }
  const muse = MUSINGS[cls] || MUSINGS.mage;
  const text = !main || Math.floor(t / 40) % 3 === 2 ? muse[Math.floor(t / 120) % muse.length] : main;
  return { text: trunc(text, 28), speech: false };
}

function dot(pc, x, y, big) {
  const cells = big ? [[0, 0], [1, 0], [0, 1], [1, 1]] : [[0, 0]];
  const own = new Set(cells.map(([a, b]) => `${a},${b}`));
  for (const [a, b] of cells) for (const [i, j] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) if (!own.has(`${a + i},${b + j}`)) pc.set(x + a + i, y + b + j, INK);
  for (const [a, b] of cells) pc.set(x + a, y + b, PAPER);
}

const textW = (s) => Math.ceil([...s].length / (ui.textScale || ui.sceneScale || 1));

function drawBubble(pc, b, hx, heroY) {
  const n = textW(b.text), W = pc.w;
  let r = Math.floor((heroY - 8) / 2);
  const side = r < 1;
  if (side) r = Math.max(1, Math.floor((heroY + 6) / 2));
  const c = Math.max(3, Math.min(W - n - 3, side ? hx + 20 : hx + 4));
  const x0 = c - 2, x1 = c + n + 1, y0 = 2 * r - 2, y1 = 2 * r + 3;
  for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
    const ex = x === x0 || x === x1, ey = y === y0 || y === y1;
    if (ex && ey) continue;
    pc.set(x, y, ex || ey ? INK : PAPER);
  }
  for (const [x, y] of [[x0 + 1, y0 + 1], [x1 - 1, y0 + 1], [x0 + 1, y1 - 1], [x1 - 1, y1 - 1]]) pc.set(x, y, INK);
  if (!side) {
    const tx = Math.max(x0 + 2, Math.min(x1 - 4, hx + 8));
    if (b.speech) {
      pc.set(tx, y1, PAPER); pc.set(tx + 1, y1, PAPER); pc.set(tx, y1 + 1, PAPER);
      pc.set(tx - 1, y1 + 1, INK); pc.set(tx + 1, y1 + 1, INK); pc.set(tx, y1 + 2, INK); pc.set(tx + 2, y1, INK);
    } else { dot(pc, tx, y1 + 2, true); dot(pc, tx - 1, y1 + 6, false); }
  }
  pc.label(c, r, b.text, INK);
}

// ---------- scene ----------

function drawScene(pc, d, pal) {
  ui.frameData = d;
  const t = ui.tick, th = d.cfg.theme, W = pc.w, H = pc.h;
  const floorY = H - Math.max(5, Math.floor(H * 0.18));
  const mode = currentMode(d.ses);
  const busy = isBusy(mode);
  const cls = C.CLASSES[d.hero.cls] ? d.hero.cls : 'mage';
  const party = Object.entries(d.ses.party || {}).slice(0, 4);
  const heroX = Math.max(Math.floor(W * 0.2), 12 * party.length + 4); // battle position
  const heroY = floorY - 24;
  const alive = aliveMonsters().sort((a, b) => a.x - b.x);
  const idleSecs = mode === 'idle' ? (Date.now() - (d.ses.since || 0)) / 1000 : 0;
  const stage = mode !== 'idle' ? 'awake' : idleSecs < SIT_AFTER ? 'stand' : idleSecs < SLEEP_AFTER ? 'sit' : 'sleep';

  // Mode transitions: the moment a hit lands, and waking up when work starts.
  if (mode !== ui.sceneMode) {
    if (mode === 'hurt') ui.hurtT = t;
    if (ui.sceneMode === 'idle' && busy) ui.alertT = t;
    ui.sceneMode = mode;
  }
  const alertK = ui.alertT !== undefined && busy ? t - ui.alertT : 99;
  const alerting = alertK < 6;

  // The party rests a few steps back and marches in when a battle starts.
  const restOff = -Math.min(REST_STEP, Math.max(0, heroX - 12 * party.length - 2));
  const fighting = alive.length > 0 && (busy || ui.battle.practice);
  const march = stepMarch(fighting ? 0 : restOff, t, mode === 'victory' || alerting);
  const hx = heroX + march.off, fx = hx + 22;

  if (ui.scrollT !== t) { ui.scrollT = t; ui.scroll = (ui.scroll || 0) + (busy ? 0.15 : 0); }
  drawBackground(pc, th, floorY, Math.floor(ui.scroll || 0), t);

  const night = stage === 'sleep' ? Math.min(1, (idleSecs - SLEEP_AFTER) / 20) : 0;
  const biome = th === 'space' ? 'space' : biomeFor(d.lvl);
  if (night > 0) drawNight(pc, { night, floorY, biome, t, fx });
  // Companions stand in line behind the hero, or sit around the fire (facing it).
  const seated = !alerting && (stage === 'sit' || stage === 'sleep');
  let right = 0, left = 0;
  const seats = party.map(() => {
    if (!seated) return null;
    const rx = fx + 12 + right * 12;
    if (rx + 11 < W - 1) { right++; return [rx, true]; }
    return [hx - 14 - 12 * left++, false];
  });
  const camp = mode === 'idle' || alerting;
  if (camp) {
    const rx = fx + 13 + right * 12;
    drawCamp(pc, { hx, fx, rollX: rx + 14 < W - 1 ? rx : hx - 16, floorY, t, stage: alerting ? 'awake' : stage, hero: d.hero });
  }
  const allies = ui.battle.allyState;
  party.forEach(([id, p], i) => {
    const fresh = Math.min(1, (Date.now() - (p.since || 0)) / 1500);
    const walkIn = Math.round((1 - fresh) * 10);
    let x = hx - 12 * (i + 1) - walkIn, flip = false;
    if (seats[i]) [x, flip] = seats[i];
    let attack = null;
    const st = allies && allies[id];
    if (st && Number.isFinite(st.attackT)) { const k = t - st.attackT; if (k >= 0 && k <= 5) attack = k; }
    else if (!allies && fighting) { const ph = (t + i * 7) % 28; if (ph <= 5) attack = ph; }
    const walk = !seated && (march.walking || walkIn > 0 || (busy && !alive.length));
    const hop = alertK < 3 ? 1 : 0;
    SP.drawCompanion(pc, p, x, floorY - 13 - hop, { id, t: t + i * 2, attack, walk, flip, sit: seated && stage === 'sit', sleep: seated && stage === 'sleep', alpha: fresh });
  });

  // Hero pose.
  let pose = 'stand', look = null, hop = false;
  if (alerting) pose = 'alert';
  else if (mode === 'victory') pose = 'victory';
  else if (mode === 'cheer' || mode === 'summoning') pose = 'cheer';
  else if (mode === 'hurt') pose = 'hurt';
  else if (march.walking || (busy && !alive.length)) pose = 'walk';
  else if (stage === 'sit') pose = 'sit';
  else if (stage === 'sleep') pose = 'sleep';
  else if (stage === 'stand') {
    const ph = Math.floor(t / 20) % 8;
    if (ph === 1) look = 'left';
    else if (ph === 2) look = 'right';
    else if (ph === 4) pose = 'stretch';
    else if (ph === 6) hop = t % 4 < 2;
  }
  const jump = mode === 'cheer' && (t >> 2) % 2 ? 2 : 0;
  // A monster's lunge that lands unguarded makes the hero flinch.
  if (mode !== 'hurt' && alive.some((m) => m.lunge === 3 && m.x - heroX < 40 && !ui.battle.shield && !(m.taunt > 0))) ui.flinchT = t;
  // Attack animation: the last cast, or a wind-up just before the next auto-attack.
  let action = ui.heroAction && t >= ui.heroAction.t && t - ui.heroAction.t <= 6 ? ui.heroAction : null;
  if (busy && alive.length && !alerting) {
    const every = Math.max(6, Math.round(24 - d.lvl * 1.2));
    const until = (every - (t % every)) % every;
    if (until <= 2 && (!action || t - action.t >= 4)) {
      const sp = C.spellFor(d.lvl, mode, t + until + ui.battle.kills);
      action = { kind: sp.id === 'basic' ? 'swing' : 'cast', spell: sp.id, t: t + until };
    }
  }
  const origin = [hx + 15, heroY + 6];
  ui.heroX = hx; ui.heroY = heroY;
  SP.drawHero(pc, d.hero, hx, heroY - jump, {
    pose, t, busy, action: action || busy, look, hop, activity: cls,
    hurt: mode === 'hurt' && ui.hurtT !== undefined ? t - ui.hurtT : -1,
    flinch: ui.flinchT !== undefined ? t - ui.flinchT : -1,
    alert: alertK,
  });

  if (stage === 'sleep' && !alerting) {
    for (let k = 0; k < 2; k++) {
      const ph = (t + k * 15) % 30;
      pc.label(Math.floor(hx + 11 + ph / 8), Math.max(0, Math.floor((heroY + 8 - ph / 2.5) / 2)), k ? 'Z' : 'z', [200, 200, 236]);
    }
  }
  if (mode === 'summoning') {
    const cx = hx + 30, cy = floorY - 1;
    pc.glow(cx, cy - 4, 18, pal.magic, 0.45);
    for (let a = 0; a < 24; a++) { const ang = a / 24 * 6.28 + t * 0.15; pc.set(cx + Math.cos(ang) * 9, cy + Math.sin(ang) * 2, a % 2 ? pal.magic : [255, 255, 255]); }
  }
  if (mode === 'victory') {
    const cx = hx + 26;
    pc.sprite(cx, floorY - 8, X.CHEST.open, X.BASE);
    pc.glow(cx + 6, floorY - 6, 18, [255, 210, 80], 0.45);
    if (t % 2 === 0) emit(3, cx + 6, floorY - 7, [[255, 214, 80], [255, 240, 150], [255, 170, 40]], { spread: 0.9, up: 3 });
    if (t % 2 === 0) emit(2, Math.random() * W, 0, [pal.gold, pal.magic, pal.good, pal.bad, pal.accent], { spread: 0.4, up: -0.3, grav: 0.05, life: 50 });
  }

  stepBattle(d, pc, floorY, heroX, origin, pal, mode);
  const front = aliveMonsters().sort((a, b) => a.x - b.x)[0];
  for (const m of ui.battle.monsters) SP.drawMonster(pc, m, t, { target: m === front });
  if (front && !front.boss) {
    const def = SP.MONSTERS[front.type];
    const tag = `${def.name} Lv${front.lvl} · ${Math.max(0, front.hp)}/${front.max} HP · ${ui.battle.practice ? 'practice' : `${front.xp} XP`}`;
    const [fw] = SP.monsterSize(front), tw = textW(tag);
    pc.label(Math.max(0, Math.min(W - tw - 1, Math.round(front.x + fw / 2 - tw / 2))), Math.max(1, Math.floor((front.y - (front.boss ? 11 : 8)) / 2)), tag, [255, 236, 200], true);
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

  if (mode === 'idle' && !alerting) drawRecap(pc, d, pal, t);
  const bubble = bubbleFor(d, mode, t, cls);
  if (bubble && !alerting) drawBubble(pc, bubble, hx, heroY);

  if (ui.battle.flash > 0) { ui.battle.flash--; pc.px = pc.px.map((c) => X.mix(c, [255, 250, 230], 0.5)); }
  pc.px = pc.px.map((c, i) => { const v = ((i % W) / W - 0.5) * 2; return X.shade(c, 1 - 0.28 * v * v); });
  if (th === 'retro') pc.map((c) => { const l = (c[0] * 0.3 + c[1] * 0.59 + c[2] * 0.11) / 255; const q = Math.round(l * 5) / 5; return [10 + q * 40, 20 + q * 235, 10 + q * 60].map(X.clamp); });
  pc.label(1, 0, ` ${ui.battle.practice ? 'PRACTICE ' : ''}WAVE ${ui.battle.wave} · ${ui.battle.kills} slain · ◉ ${ui.battle.gold} gold `, pal.gold);
}

// Render at a logical resolution sized so the hero is ~40% of the scene height.
function sceneLines(cols, rows, d, pal) {
  if (HD.state.on) return sceneLinesHD(cols, rows, d, pal);
  const S = Math.max(1, Math.min(4, Math.round((rows * 2) / 62)));
  const lc = Math.ceil(cols / S), lr = Math.ceil(rows / S);
  const small = new X.PixelCanvas(lc, lr);
  ui.sceneScale = S; ui.textScale = null;
  drawScene(small, d, pal);
  let lines;
  if (S === 1) lines = small.lines();
  else {
    const big = new X.PixelCanvas(cols, rows);
    for (let y = 0; y < big.h; y++) for (let x = 0; x < cols; x++) big.px[y * cols + x] = small.px[Math.floor(y / S) * lc + Math.floor(x / S)];
    // Keep each label's characters together: a run of adjacent cells starts at
    // its scaled column and continues cell by cell (text does not scale).
    const cells = [...small.text].map(([k, v]) => [...k.split(',').map(Number), v]).sort((a, b) => a[1] - b[1] || a[0] - b[0]);
    let start = -2, prev = -2, prow = -1;
    for (const [c, r, v] of cells) {
      if (r !== prow || c !== prev + 1) start = c;
      const x = start * S + (c - start);
      prev = c; prow = r;
      if (x < cols) big.text.set(`${x},${Math.min(rows - 1, Math.floor(r * S + S / 2))}`, v);
    }
    lines = big.lines();
  }
  if (ui.battle.shake > 0) { ui.battle.shake--; if (ui.battle.shake % 2) lines = lines.slice(1).concat(lines[0]); }
  return lines;
}

// HD: draw the scene at a finer logical resolution and hand an RGBA frame to
// game.js (ui.hdFrame), which places it over these blank rows as a Kitty image.
// Rows stay exactly `cols` wide so the text layout is unchanged.
function sceneLinesHD(cols, rows, d, pal) {
  const { cw, ch } = HD.state;
  const devW = cols * cw, devH = rows * ch;
  const p = HD.pitchFor(devH);
  const lw = Math.ceil(devW / p), lr = Math.ceil(devH / p / 2);
  const pc = new X.PixelCanvas(lw, lr);
  pc.trackFg = true;
  const adv = 6 * HD.fontScale(ch); // label glyph advance in device px
  ui.sceneScale = p / cw; // game px per text cell (mouse mapping)
  ui.textScale = p / adv; // game px per label character
  drawScene(pc, d, pal);
  let shake = 0;
  if (ui.battle.shake > 0) { ui.battle.shake--; if (ui.battle.shake % 2) shake = Math.round(ch / 2); }
  ui.hdFrame = null;
  if (HD.state.render !== false) {
    const t0 = Date.now();
    // Under load render at a coarser pitch; the terminal stretches it to the cell rect.
    const q = HD.state.quality || 1, po = Math.max(1, Math.round(p * q)), k = po / p;
    const img = HD.renderScene(pc, { pitch: po, outW: Math.round(devW * k), outH: Math.round(devH * k), adv: Math.max(4, Math.round(adv * k)), shakeY: Math.round(shake * k) });
    ui.hdFrame = { ...img, cols, rows, cost: Date.now() - t0 };
  }
  const blank = `\x1b[48;2;${pal.panel.join(';')}m${' '.repeat(cols)}\x1b[0m`;
  ui.hdBlank = blank;
  return Array.from({ length: rows }, () => blank);
}

module.exports = { drawScene, sceneLines };
