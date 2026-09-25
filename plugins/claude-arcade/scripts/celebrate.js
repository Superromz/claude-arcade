'use strict';
// Celebration overlays drawn on top of a finished game frame:
//   - LEVEL UP (detected from the level rising between frames via ui.lastLvl)
//   - ui.celebrate = { kind: 'boss' | 'purchase' | 'achievement', text, until }
//     set by other systems. `until` is an epoch time in ms (Date.now() + ms);
//     small numbers are treated as a ui.tick deadline instead.
//
// applyOverlay(lines, d, pal, W, H) returns new lines of the same widths.
// The frame's cells under the banner are parsed back into pixels, darkened,
// and the banner (block-letter title, subtitle, sparkles) is composited on top.
//
// ARCADE_CELEBRATE=levelup|boss|purchase|achievement[:age] forces a banner
// frozen at that age (in ticks) for snapshots.

const L = require('./lib');
const X = require('./pixel');
const C = require('./character');
const { RESET, BOLD, NOBOLD, fg, bg, ui } = require('./state');

const BLACK = [0, 0, 0], WHITE = [255, 255, 255];
const LEVELUP_TICKS = 32; // ~3.2 s at 10 fps

// ---------- block font (5 px tall, drawn with ▀ ▄ █) ----------

const FONT = {
  A: ['.##.', '#..#', '####', '#..#', '#..#'], B: ['###.', '#..#', '###.', '#..#', '###.'],
  C: ['.###', '#...', '#...', '#...', '.###'], D: ['###.', '#..#', '#..#', '#..#', '###.'],
  E: ['####', '#...', '###.', '#...', '####'], F: ['####', '#...', '###.', '#...', '#...'],
  G: ['.###', '#...', '#.##', '#..#', '.###'], H: ['#..#', '#..#', '####', '#..#', '#..#'],
  I: ['###', '.#.', '.#.', '.#.', '###'], J: ['..##', '...#', '...#', '#..#', '.##.'],
  K: ['#..#', '#.#.', '##..', '#.#.', '#..#'], L: ['#...', '#...', '#...', '#...', '####'],
  M: ['#...#', '##.##', '#.#.#', '#...#', '#...#'], N: ['#..#', '##.#', '#.##', '#..#', '#..#'],
  O: ['.##.', '#..#', '#..#', '#..#', '.##.'], P: ['###.', '#..#', '###.', '#...', '#...'],
  Q: ['.##.', '#..#', '#..#', '#.#.', '.#.#'], R: ['###.', '#..#', '###.', '#.#.', '#..#'],
  S: ['.###', '#...', '.##.', '...#', '###.'], T: ['#####', '..#..', '..#..', '..#..', '..#..'],
  U: ['#..#', '#..#', '#..#', '#..#', '.##.'], V: ['#...#', '#...#', '.#.#.', '.#.#.', '..#..'],
  W: ['#...#', '#...#', '#.#.#', '##.##', '#...#'], X: ['#...#', '.#.#.', '..#..', '.#.#.', '#...#'],
  Y: ['#...#', '.#.#.', '..#..', '..#..', '..#..'], Z: ['####', '...#', '..#.', '.#..', '####'],
  0: ['.##.', '#..#', '#..#', '#..#', '.##.'], 1: ['.#.', '##.', '.#.', '.#.', '###'],
  2: ['###.', '...#', '.##.', '#...', '####'], 3: ['###.', '...#', '.##.', '...#', '###.'],
  4: ['#..#', '#..#', '####', '...#', '...#'], 5: ['####', '#...', '###.', '...#', '###.'],
  6: ['.##.', '#...', '###.', '#..#', '.##.'], 7: ['####', '...#', '..#.', '.#..', '.#..'],
  8: ['.##.', '#..#', '.##.', '#..#', '.##.'], 9: ['.##.', '#..#', '.###', '...#', '.##.'],
  '!': ['#', '#', '#', '.', '#'], ' ': ['..', '..', '..', '..', '..'],
};

// Glyph layout: [{ch, x, rows}] and total width in font pixels.
function layoutWord(word) {
  let x = 0; const glyphs = [];
  for (const ch of word.toUpperCase()) {
    const g = FONT[ch] || FONT[' '];
    glyphs.push({ ch, x, rows: g });
    x += g[0].length + 1;
  }
  return { glyphs, w: Math.max(0, x - 1) };
}

// ---------- parsing a rendered line back into cells ----------

function parseLine(line, W) {
  const cells = [];
  let f = null, b = null, bold = false;
  const re = /\x1b\[([0-9;?]*)([A-Za-z])|([\s\S])/gu;
  for (const m of String(line).matchAll(re)) {
    if (m[3] === undefined) {
      if (m[2] !== 'm') continue;
      const p = m[1].split(';').map((v) => (v === '' ? 0 : Number(v)));
      for (let i = 0; i < p.length; i++) {
        if (p[i] === 0) { f = null; b = null; bold = false; }
        else if (p[i] === 1) bold = true;
        else if (p[i] === 22) bold = false;
        else if (p[i] === 39) f = null;
        else if (p[i] === 49) b = null;
        else if ((p[i] === 38 || p[i] === 48) && p[i + 1] === 2) { const c = p.slice(i + 2, i + 5); if (p[i] === 38) f = c; else b = c; i += 4; }
      }
      continue;
    }
    const ch = m[3], w = L.visWidth(ch);
    if (w === 0) { if (cells.length) cells[cells.length - 1].ch += ch; continue; }
    const back = b || BLACK, fore = f || [220, 220, 220];
    const cell = { ch, f: fore, bold, top: back, bot: back, text: false, w };
    if (ch === '▀') { cell.top = fore; cell.bot = back; }
    else if (ch === '▄') { cell.top = back; cell.bot = fore; }
    else if (ch === '█') { cell.top = fore; cell.bot = fore; }
    else if (ch !== ' ') cell.text = true;
    cells.push(cell);
    if (w === 2) cells.push({ cont: true, ch: '', f: fore, bold, top: back, bot: back, text: true, w: 0 });
  }
  while (cells.length < W) cells.push({ ch: ' ', f: [220, 220, 220], bold: false, top: BLACK, bot: BLACK, text: false, w: 1 });
  cells.length = W;
  return cells;
}

function renderCells(cells) {
  let s = '', cf = '', cb = '', cbold = false;
  const emit = (ch, f, b, bold) => {
    const fs = f ? fg(f) : cf, bs = bg(b);
    if (bold !== cbold) { s += bold ? BOLD : NOBOLD; cbold = bold; }
    if (fs !== cf) { s += fs; cf = fs; }
    if (bs !== cb) { s += bs; cb = bs; }
    s += ch;
  };
  const pixel = (c) => {
    if (c.top[0] === c.bot[0] && c.top[1] === c.bot[1] && c.top[2] === c.bot[2]) emit(' ', null, c.bot, false);
    else emit('▀', c.top, c.bot, false);
  };
  for (let i = 0; i < cells.length; i++) {
    const c = cells[i];
    if (c.label) { emit(c.label, c.lf, X.mix(c.top, c.bot, 0.5), c.lbold); continue; }
    if (c.text && !c.dirty && !c.cont) {
      if (c.w === 2) {
        const nx = cells[i + 1];
        if (nx && nx.cont && !nx.dirty && !nx.label) { emit(c.ch, c.f, c.top, c.bold); i++; continue; }
        pixel(c); continue;
      }
      emit(c.ch, c.f, c.top, c.bold); continue;
    }
    pixel(c);
  }
  return s + RESET;
}

// ---------- celebration state ----------

function spellsBetween(from, to) {
  return C.SPELLS.filter((s) => s.lvl > from && s.lvl <= to);
}

function currentCelebration(d, pal) {
  const forced = process.env.ARCADE_CELEBRATE;
  if (forced) {
    const [kind, a] = forced.split(':');
    const age = Number(a) || 12;
    if (kind === 'levelup') return levelUpSpec(d, pal, Math.max(1, (d.lvl || 3) - 1), d.lvl || 3, age, LEVELUP_TICKS);
    return eventSpec(pal, { kind, text: { boss: 'The Goblin King falls! +120 gold', purchase: 'Crimson Cape equipped', achievement: 'Blacksmith: make 50 edits' }[kind] || 'Well done!' }, age, 40);
  }
  if (ui.levelUp) {
    const lu = ui.levelUp, age = ui.tick - lu.t0;
    if (age >= 0 && age < LEVELUP_TICKS) return levelUpSpec(d, pal, lu.from, lu.to, age, LEVELUP_TICKS);
    ui.levelUp = null;
  }
  const c = ui.celebrate;
  if (c && c.kind) {
    if (c._t0 === undefined) c._t0 = ui.tick;
    const until = Number(c.until) || 0;
    const left = until > 1e12 ? (until - Date.now()) / 100 : until ? until - ui.tick : 30 - (ui.tick - c._t0);
    if (left > 0) return eventSpec(pal, c, ui.tick - c._t0, (ui.tick - c._t0) + left);
    ui.celebrate = null;
  }
  return null;
}

function levelUpSpec(d, pal, from, to, age, dur) {
  const t = L.theme(d.cfg || {});
  const lines = [[[`Level ${to}`, pal.gold, true], ['  ·  ', pal.dim], [L.titleFor(t, to), pal.text, true]]];
  const fresh = spellsBetween(from, to);
  let P = null;
  try { P = require('./panels'); } catch {}
  for (const s of fresh.slice(0, 2)) {
    const icon = P ? P.spellIcon(s, d) : '*', col = P ? P.spellColor(s, pal) : pal.magic;
    const name = P ? P.spellName(s, d) : s.name;
    lines.push([['New spell unlocked  ', pal.dim], [`${icon} ${name}`, col, true], [`  · key ${C.SPELLS.indexOf(s) + 1}`, pal.dim]]);
  }
  if (!fresh.length) {
    const next = C.SPELLS.find((s) => s.lvl > to);
    lines.push(next ? [['Next spell at ', pal.dim], [`Lv ${next.lvl}`, pal.accent, true], [`: ${next.name}`, pal.dim]] : [['Every spell is yours. Legendary!', pal.magic, true]]);
  }
  return { word: 'LEVEL UP', colors: [WHITE, pal.gold, pal.accent], lines, age, dur, sparkle: [pal.gold, WHITE, pal.accent] };
}

function eventSpec(pal, c, age, dur) {
  const text = String(c.text || '');
  if (c.kind === 'bossIntro') return { word: 'BOSS!', colors: [WHITE, pal.bad, X.shade(pal.bad, 0.6)], lines: [[['! ', pal.bad, true], [text || 'A boss approaches!', pal.text, true]]], age, dur, sparkle: [pal.bad, pal.gold] };
  if (c.kind === 'boss') return { word: 'VICTORY', colors: [WHITE, pal.gold, pal.bad], lines: [[['× ', pal.bad, true], [text || 'Boss defeated!', pal.text, true]]], age, dur, sparkle: [pal.gold, pal.bad, WHITE] };
  if (c.kind === 'achievement') return { word: 'TROPHY', colors: [WHITE, pal.gold, pal.magic], lines: [[['★ ', pal.gold, true], [text || 'Achievement unlocked', pal.text, true]]], age, dur, sparkle: [pal.gold, pal.magic, WHITE] };
  if (c.kind === 'purchase') return { word: 'LOOT!', colors: [WHITE, pal.gold, X.shade(pal.gold, 0.7)], lines: [[['◉ ', pal.gold, true], [text || 'Item purchased', pal.text, true]]], age, dur, sparkle: [pal.gold, WHITE] };
  return { word: null, lines: [[['★ ', pal.accent, true], [text, pal.text, true]]], age, dur, sparkle: [pal.accent, WHITE] };
}

// ---------- compositing ----------

function applyOverlay(lines, d, pal, W, H) {
  if (!Array.isArray(lines) || !lines.length) return lines;
  if (typeof d.lvl === 'number') {
    if (typeof ui.lastLvl === 'number' && d.lvl > ui.lastLvl) ui.levelUp = { from: ui.lastLvl, to: d.lvl, t0: ui.tick };
    ui.lastLvl = d.lvl;
  }
  const spec = currentCelebration(d, pal);
  if (!spec) return lines;
  try { return draw(lines, d, pal, W, Math.min(H || lines.length, lines.length), spec); } catch { return lines; }
}

const hash = (a, b) => X.hash(a * 7 + 13, b * 31 + 5);

function draw(lines, d, pal, W, H, spec) {
  const { age, dur } = spec;
  // Big word: 2x scale when there is room, 1x otherwise, plain text if tiny.
  let word = spec.word ? layoutWord(spec.word) : null;
  let S = 0;
  if (word) S = word.w * 2 + 8 <= W && H >= 30 ? 2 : word.w + 6 <= W ? 1 : 0;
  if (!S) word = null;
  const wordRows = word ? Math.ceil((5 * S + S) / 2) : 0; // + drop shadow
  const textRows = spec.lines.length;
  const core = 1 + wordRows + (word ? 1 : 0) + textRows + 1;
  const top0 = 3, bot0 = H - 2; // keep header and hotbar/footer clear
  if (bot0 - top0 < core) return lines;
  const mid = Math.floor((top0 + bot0) / 2);
  const coreTop = Math.max(top0, Math.min(bot0 - core, mid - Math.floor(core / 2)));
  const bandTop = Math.max(top0, coreTop - 2), bandBot = Math.min(bot0, coreTop + core + 2); // [bandTop, bandBot)

  // Envelope: open over 4 ticks, fade out over the last 6.
  const open = Math.min(1, (age + 1) / 4);
  const alpha = Math.max(0, Math.min(1, (dur - age) / 6)) * open;
  const tint = X.mix(pal.panel, BLACK, 0.55);

  const rows = [];
  for (let r = bandTop; r < bandBot; r++) rows.push(parseLine(lines[r], W));
  const pxH = rows.length * 2;
  const coreY0 = (coreTop - bandTop) * 2, coreY1 = coreY0 + core * 2;
  const centerY = (coreY0 + coreY1) / 2, halfOpen = ((coreY1 - coreY0) / 2) * open;
  // pixel accessors over the band
  const getPx = (x, y) => { const c = rows[y >> 1][x]; return (y & 1) ? c.bot : c.top; };
  const setPx = (x, y, col) => {
    if (x < 0 || x >= W || y < 0 || y >= pxH) return;
    const c = rows[y >> 1][x];
    if (c.text) { c.dirty = true; c.text = false; }
    if (c.cont) { c.dirty = true; }
    if (y & 1) c.bot = col; else c.top = col;
  };
  // 1) darken: strong inside the opened core, soft falloff outside it
  for (let y = 0; y < pxH; y++) {
    const dist = Math.abs(y + 0.5 - centerY) - halfOpen;
    const k = (dist <= 0 ? 0.86 : Math.max(0, 0.5 - dist * 0.1)) * alpha;
    if (k <= 0) continue;
    for (let x = 0; x < W; x++) {
      const c = rows[y >> 1][x];
      if (y & 1) c.bot = X.mix(c.bot, tint, k); else c.top = X.mix(c.top, tint, k);
      if (c.text && !(y & 1)) c.f = X.mix(c.f, tint, k);
    }
  }
  const inCore = (y) => Math.abs(y + 0.5 - centerY) <= halfOpen;
  // 2) gilded edges on the core, brightest in the middle
  const edgeC = spec.colors ? spec.colors[1] : pal.gold;
  for (const ey of [Math.round(centerY - halfOpen), Math.round(centerY + halfOpen) - 1]) {
    if (ey < 0 || ey >= pxH) continue;
    for (let x = 0; x < W; x++) {
      const f = Math.max(0, 1 - Math.abs(x - W / 2) / (W / 2)) ** 0.6;
      setPx(x, ey, X.mix(getPx(x, ey), edgeC, f * alpha * 0.9));
    }
  }
  // 3) block-letter word
  const letterPx = new Set();
  if (word) {
    const wx0 = Math.floor((W - word.w * S) / 2), wy0 = coreY0 + 2;
    const [cTop, cMid, cBot] = spec.colors;
    const sheen = ((age * 3) % (word.w * S + 60)) - 30;
    const outline = X.shade(cBot, 0.25);
    word.glyphs.forEach((g, gi) => {
      const ta = age - gi * 0.8;
      if (ta < 0) return;
      const drop = ta < 3 ? -Math.round((3 - ta) * S * 1.5) : 0;
      const bob = ta >= 3 ? Math.round(Math.sin(age * 0.45 + gi * 0.9) * 0.6 * (S > 1 ? 1 : 0)) : 0;
      const oy = wy0 + drop + bob;
      const on = (gx, gy) => gy >= 0 && gy < 5 && gx >= 0 && gx < g.rows[0].length && g.rows[gy][gx] === '#';
      // shadow + outline first, then fill
      for (let gy = -1; gy <= 5; gy++) for (let gx = -1; gx <= g.rows[0].length; gx++) {
        if (on(gx, gy)) continue;
        const near = on(gx - 1, gy) || on(gx + 1, gy) || on(gx, gy - 1) || on(gx, gy + 1) || on(gx - 1, gy - 1);
        if (!near) continue;
        for (let sy = 0; sy < S; sy++) for (let sx = 0; sx < S; sx++) {
          const x = wx0 + (g.x + gx) * S + sx, y = oy + gy * S + sy;
          if (y >= coreY0 && inCore(y)) setPx(x, y, X.mix(getPx(x, y), outline, alpha * 0.9));
        }
      }
      for (let gy = 0; gy < 5; gy++) for (let gx = 0; gx < g.rows[0].length; gx++) {
        if (!on(gx, gy)) continue;
        for (let sy = 0; sy < S; sy++) for (let sx = 0; sx < S; sx++) {
          const x = wx0 + (g.x + gx) * S + sx, y = oy + gy * S + sy;
          if (!inCore(y)) continue;
          const v = (gy * S + sy) / (5 * S - 1);
          let col = v < 0.35 ? X.mix(cTop, cMid, v / 0.35) : X.mix(cMid, cBot, (v - 0.35) / 0.65);
          const sd = Math.abs((x - wx0) - (y - wy0) * 0.7 - sheen);
          if (sd < 3) col = X.mix(col, WHITE, 0.65 * (1 - sd / 3));
          setPx(x, y, X.mix(getPx(x, y), col, alpha));
          letterPx.add(x + ',' + y);
        }
      }
    });
  }
  // 4) subtitle lines (text labels centered, fading in after the word lands)
  const textAlpha = alpha * Math.max(0, Math.min(1, (age - (word ? 5 : 1)) / 4));
  const textRow0 = (coreTop - bandTop) + 1 + wordRows + (word ? 1 : 0);
  spec.lines.forEach((parts, li) => {
    const r = textRow0 + li;
    if (r >= rows.length || !inCore(r * 2) || textAlpha <= 0) return;
    const plain = parts.map((p) => p[0]).join('');
    const tw = L.visWidth(plain);
    let x = Math.max(0, Math.floor((W - tw) / 2));
    for (const [t, col, b] of parts) {
      for (const ch of t) {
        if (x >= W) break;
        const cell = rows[r][x];
        cell.label = ch; cell.lf = X.mix(X.mix(cell.top, cell.bot, 0.5), col, textAlpha); cell.lbold = !!b;
        cell.text = false; cell.dirty = true;
        x += 1;
      }
    }
  });
  // 5) sparkles across the band, twinkling in 4-tick cycles
  const sparkCols = spec.sparkle || [pal.gold, WHITE];
  const n = Math.max(8, Math.floor(W / 7));
  for (let k = 0; k < n; k++) {
    const cyc = Math.floor((age + k * 3) / 5), ph = (age + k * 3) % 5;
    const x = Math.floor(hash(k, cyc) * W), y = Math.floor(hash(cyc, k + 99) * pxH);
    if (letterPx.has(x + ',' + y)) continue;
    const col = sparkCols[k % sparkCols.length];
    const a = alpha * [0.6, 1, 1, 0.7, 0.3][ph];
    const put = (px, py, f) => { if (!letterPx.has(px + ',' + py) && px >= 0 && px < W && py >= 0 && py < pxH && !rows[py >> 1][px].label) setPx(px, py, X.mix(getPx(px, py), col, a * f)); };
    put(x, y, 1);
    if (ph === 1 || ph === 2 || ph === 3) { put(x - 1, y, 0.7); put(x + 1, y, 0.7); put(x, y - 1, 0.7); put(x, y + 1, 0.7); }
    if (ph === 2) { put(x - 2, y, 0.35); put(x + 2, y, 0.35); put(x, y - 2, 0.35); put(x, y + 2, 0.35); }
  }
  const out = lines.slice();
  rows.forEach((cells, i) => { out[bandTop + i] = renderCells(cells); });
  return out;
}

module.exports = { applyOverlay, layoutWord, parseLine, renderCells, FONT };
