'use strict';
// The big cosmetics catalog: extra hats, back items, auras, pets, weapon
// glows and buffs, plus the newer slots (trails, mounts, camp tents, banners,
// campfire colors and outfits for guild recruits). items.js calls build()
// with its drawing helpers and merges the result into its CATALOG.
//
// Drawing conventions (see items.js): hero items draw in the hero's 16×24
// box through `o` (o.set / o.behind / o.glow / o.field / o.rim...). Mounts,
// tents, banners and fires draw on any pixel target with set(x, y, c).

function build(h) {
  const { X, K, RAINBOW, rowsAt, weaponGlow, weaponTip, starGlow, wingsAt } = h;
  const W0 = [255, 255, 255];
  const cyc = (list, t, speed = 0.15) => { const k = (t * speed) % list.length, i = Math.floor(k); return X.mix(list[i], list[(i + 1) % list.length], k - i); };

  // ---------- hats ----------

  const HATS = [
    { id: 'beanie', name: 'Hacker Beanie', price: 80, rarity: 'common', set: 'Night Shift', desc: 'Warm, dark, and full of terminal tabs.',
      pal: { K, B: [52, 58, 72], b: [36, 40, 52], W: [120, 230, 120] },
      rows: ['', '', '.......KK.......', '......KWWK......', '.....KKKKKK.....', '....KBBBBBBK....', '...KBbBbBbBbK...', '...KBBBBBBBBK...', '...KbbbbbbbbK...'] },
    { id: 'bucket', name: 'Bucket Hat', price: 70, rarity: 'common', desc: 'For touching grass between deploys.',
      pal: { K, T: [230, 200, 120], t: [190, 158, 90] },
      rows: ['', '', '.....KKKKKK.....', '....KTTTTTTK....', '....KttttttK....', '...KTTTTTTTTK...', '..KTTTTTTTTTTK..', '..KKKKKKKKKKKK..'] },
    { id: 'cone', name: 'Traffic Cone', price: 70, rarity: 'common', desc: 'Under construction. Mind the gap.',
      pal: { K, O: [255, 120, 30], W: [250, 250, 250] },
      rows: ['.......KK.......', '......KOOK......', '......KWWK......', '.....KOOOOK.....', '.....KWWWWK.....', '....KOOOOOOK....', '..KKKKKKKKKKKK..'] },
    { id: 'holiday', name: 'Holiday Hat', price: 90, rarity: 'common', desc: 'Ho ho hotfix.',
      pal: { K, R: [220, 40, 50], W: [250, 250, 250] },
      rows: ['............KK..', '..........KKWWK.', '........KKRRKK..', '......KKRRRRK...', '.....KRRRRRRK...', '....KRRRRRRRRK..', '...KWWWWWWWWWWK.', '...KWWWWWWWWWWK.'] },
    { id: 'chef', name: "Chef's Toque", price: 100, rarity: 'common', desc: 'Cooks up clean code, no spaghetti.',
      pal: { K, W: [250, 250, 250], w: [206, 206, 218] },
      rows: ['.....KK..KK.....', '....KWWKKWWK....', '...KWWWWWWWWK...', '...KWWWWWWWWK...', '....KWWWWWWK....', '....KwwwwwwK....', '....KWWWWWWK....'] },
    { id: 'propeller', name: 'Propeller Cap', price: 110, rarity: 'common', desc: 'Achieves liftoff on good days.',
      pal: { K, R: [230, 60, 60], B: [60, 120, 230], Y: [255, 214, 80] },
      rows: ['', '', '', '.......KK.......', '.....KKRRKK.....', '....KRRBBRRK....', '...KRRBBBBRRK...', '...KKKKKKKKKKKKK'],
      anim(o, t) {
        const f = (t >> 1) % 3, R = [230, 60, 60], Y = [255, 214, 80];
        if (f === 0) { for (let x = 4; x <= 7; x++) o.set(x, 2, R); for (let x = 8; x <= 11; x++) o.set(x, 2, Y); }
        else if (f === 1) { for (let x = 6; x <= 9; x++) o.set(x, 2, (x & 1) ? R : Y); }
        else { o.set(7, 2, R); o.set(8, 2, Y); }
      } },
    { id: 'cowboy', name: 'Cowboy Hat', price: 130, rarity: 'common', set: 'Wild West', desc: 'This terminal ain\'t big enough for two linters.',
      pal: { K, b: [150, 100, 60], R: [120, 40, 30] },
      rows: ['', '', '.....KKKKKK.....', '....KbbKKbbK....', '....KbbbbbbK....', 'K...KRRRRRRK...K', 'KbbbbbbbbbbbbbbK', '.KKKKKKKKKKKKKK.'] },
    { id: 'antennae', name: 'Bug Antennae', price: 240, rarity: 'rare', desc: 'It\'s not a bug, it\'s a feature.',
      pal: { K, Y: [120, 255, 140], G: [60, 180, 90], g: [40, 130, 60] },
      rows: ['', '...K........K...', '....K......K....', '.....K....K.....', '.....K....K.....', '....KGGGGGGK....', '....KgGgGgGK....'],
      anim(o, t) { const b = (t >> 2) % 2; o.set(2 + b, 0, [120, 255, 140]); o.set(13 - b, 0, [120, 255, 140]); o.glow(7.5, 0, 5, [120, 255, 140], 0.15); } },
    { id: 'gradcap', name: 'Graduation Cap', price: 250, rarity: 'rare', desc: 'Senior engineer, as of today.',
      pal: { K, D: [40, 40, 56], Y: [255, 214, 80] },
      rows: ['', '', '.....KKKKKK.....', '..KKKDDDDDDKKK..', 'KKDDDDDDDDDDDDKK', '..KKKKDDDDKKKKY.', '....KDDDDDDK..Y.', '....KKKKKKKK..Y.', '..............YY'] },
    { id: 'headphones', name: 'Noise-Cancelling Headphones', price: 280, rarity: 'rare', desc: 'Do not disturb: in the zone.',
      pal: { K, M: [60, 60, 72], R: [230, 60, 80] },
      rows: ['', '', '', '.....KKKKKK.....', '....KMMMMMMK....', '...KMK....KMK...', '...KM......MK...', '..KKMK....KMKK..', '..KRRK....KRRK..', '..KRRK....KRRK..', '..KRRK....KRRK..', '...KK......KK...'],
      anim(o, t) { const ph = t % 24; if (ph < 12) o.set(15 + (ph >> 3), 6 - (ph >> 2), ph < 6 ? [255, 214, 80] : [180, 150, 255]); } },
    { id: 'witch', name: 'Witch Hat', price: 300, rarity: 'rare', desc: 'Brews potions and regexes.',
      pal: { K, P: [60, 40, 90], G: [140, 220, 90] },
      rows: ['...........KK...', '.........KKPK...', '........KPPK....', '.......KPPPK....', '......KPPPPK....', '.....KPPPPPPK...', '.....KGGGGGGK...', '.KKKKPPPPPPPPKKK', '..KKKKKKKKKKKK..'] },
    { id: 'laurel', name: 'Laurel Wreath', price: 330, rarity: 'rare', desc: 'For a flawless victory lap.',
      pal: { K, G: [120, 200, 90], g: [70, 140, 60], Y: [255, 214, 80] },
      rows: ['', '', '', '', '...G.G....G.G...', '..GgGgGYYGgGgG..', '...gGgGggGgGg...'] },
    { id: 'kabuto', name: 'Samurai Kabuto', price: 380, rarity: 'rare', desc: 'Refactors with a single clean cut.',
      pal: { K, R: [170, 40, 40], Y: [255, 200, 60] },
      rows: ['..Y..........Y..', '...Y........Y...', '....YY....YY....', '......YYYY......', '....KKKKKKKK....', '...KRRRRRRRRK...', '..KRRKKKKKKRRK..', '..KK........KK..', '..KRK......KRK..', '...K........K...'] },
    { id: 'froghat', name: 'Frog Hat', price: 540, rarity: 'epic', desc: 'Ribbit. Also: shipit.',
      pal: { K, G: [110, 200, 90], g: [70, 150, 60], W: [250, 250, 250], E: [20, 20, 20], R: [230, 110, 130] },
      rows: ['', '...KKK....KKK...', '..KWWEK..KEWWK..', '..KWEEKKKKEEWK..', '..KGGGGGGGGGGK..', '.KGGGGGGGGGGGGK.', '.KGgGGRRRRGGgGK.', '..KKKKKKKKKKKK..'],
      anim(o, t) { if (t % 40 < 3) for (const x of [3, 4, 5, 10, 11, 12]) { o.set(x, 2, [110, 200, 90]); o.set(x, 3, [70, 150, 60]); } } },
    { id: 'icecrown', name: 'Frost Crown', price: 600, rarity: 'epic', set: 'Frostbound', desc: 'Keeps your takes ice cold.',
      pal: { K, C: [170, 230, 255], c: [110, 180, 230], W: [255, 255, 255] },
      rows: ['', '', '.....C....C.....', '....KCK..KCK....', '...KCWCKKCWCK...', '...KCCCCCCCCK...', '...KcCcCcCcCK...'],
      anim(o, t) { const k = (t >> 2) % 8; if (k < 3) o.set([5, 10, 7][k], [3, 3, 5][k], [255, 255, 255]); o.glow(7.5, 4, 6, [170, 230, 255], 0.18); } },
    { id: 'socrown', name: 'Stack Overflow Crown', price: 720, rarity: 'epic', set: 'Ship It', desc: 'Copied from the top answer. It works.',
      pal: { K, O: [244, 128, 36], G: [188, 187, 187] },
      rows: ['..........OO....', '........OOO.....', '......OOOO......', '.....OOOOOO.....', '...KG......GK...', '...KG.OOOO.GK...', '...KGGGGGGGGK...'],
      anim(o, t) { const g = (t >> 1) % 20; if (g < 6) o.set(5 + g, 3, [255, 220, 170]); } },
    { id: 'voidcrown', name: 'Void Crown', price: 1300, rarity: 'legendary', desc: 'Stares into the abyss. The abyss files a bug.',
      pal: { K, V: [60, 40, 90], v: [34, 22, 52], P: [200, 120, 255] },
      rows: ['', '....K..KK..K....', '...KVKKVVKKVK...', '...KVVKVVKVVK...', '...KVVVVVVVVK...', '...KVPVVVVPVK...', '...KvvvvvvvvK...'],
      anim(o, t) {
        o.glow(7.5, 1, 7, [150, 70, 255], 0.3);
        for (const [x, k] of [[4, 0], [7, 1], [8, 2], [11, 3]]) {
          const hgt = 1 + Math.round(2 * X.hash(x, (t >> 1) + k));
          for (let j = 0; j < hgt; j++) o.set(x, 1 - j, j ? [120, 50, 200] : [220, 170, 255]);
        }
      } },
  ];

  // ---------- back items ----------

  // A cape that trails behind, colored per pixel by fn(dx, dy, t, edge).
  function cape(fn) {
    return function draw(o, t) {
      for (let dy = 13; dy <= 23; dy++) {
        const trail = Math.round((dy - 13) * 0.7 + Math.sin(t * 0.3 + dy * 0.6) * (dy > 15 ? 1.2 : 0));
        const left = 2 - trail;
        for (let dx = left; dx <= 13; dx++) o.behindBody(dx, dy, fn(dx, dy, t, dx === left || dy === 23, left));
      }
    };
  }

  const BACKS = [
    { id: 'backpack', name: 'Backpack', price: 120, rarity: 'common', desc: 'Snacks, chargers and one mystery cable.', swatchY: 10,
      draw(o) { rowsAt(o, ['.KKKKKK.', 'KGGGGGGK', 'KGgGGgGK', 'KGGGGGGK', 'KYYYYYYK', 'KGGGGGGK', 'KgGGGGgK', '.KKKKKK.'], { K, G: [70, 130, 200], g: [50, 96, 150], Y: [255, 214, 80] }, -4, 12, true); } },
    { id: 'poncho', name: 'Poncho', price: 140, rarity: 'common', set: 'Wild West', desc: 'Stripes for days. Tumbleweeds optional.', swatchY: 13,
      draw: cape((dx, dy, t, edge) => { const c = [[200, 70, 50], [240, 190, 80], [80, 150, 120], [240, 190, 80]][((dy - 13) >> 1) % 4]; return edge ? X.shade(c, 0.5) : c; }) },
    { id: 'guitar', name: 'Guitar on Back', price: 160, rarity: 'common', desc: 'Wonderwall, available on request.', swatchY: 8,
      draw(o) {
        const B = [150, 90, 40], b = [110, 64, 30], N = [70, 46, 30];
        for (let k = 0; k < 11; k++) o.behind(-2 + k, 22 - k, k < 5 ? B : N);
        for (let j = -2; j <= 2; j++) for (let i = -2; i <= 2; i++) if (i * i + j * j <= 5) o.behind(-1 + i, 20 + j, (i + j) % 3 ? B : b);
        o.behind(-1, 20, K);
      } },
    { id: 'backflag', name: 'Battle Flag', price: 300, rarity: 'rare', desc: 'A sashimono that reads LGTM.', swatchY: 0,
      draw(o, t) {
        for (let y = -2; y <= 14; y++) o.behind(0, y, [90, 64, 40]);
        for (let i = 0; i < 6; i++) for (let j = 0; j < 7; j++) {
          const w = Math.round(Math.sin(t * 0.3 + i * 0.8) * (i / 6));
          o.behind(-1 - i, -1 + j + w, (i + j) % 5 === 0 ? [255, 255, 255] : [220, 60, 60]);
        }
      } },
    { id: 'snowcape', name: 'Snow Cape', price: 360, rarity: 'rare', set: 'Frostbound', desc: 'Fresh powder, every commit.', swatchY: 13,
      draw: cape((dx, dy, t, edge) => (edge ? [110, 170, 230] : X.hash(dx, dy + (t >> 3)) > 0.9 ? [180, 220, 255] : [236, 244, 255])) },
    { id: 'batwings', name: 'Bat Wings', price: 420, rarity: 'rare', desc: 'For late-night debugging sessions.', swatchY: 6,
      draw(o, t) { const pal = { K: [40, 20, 50], W: [110, 60, 130], w: [70, 34, 90] }; wingsAt(o, t, (k, i, j) => (k === 'W' && (i * 2 + j) % 5 === 0 ? pal.w : pal[k]), null); } },
    { id: 'butterfly', name: 'Butterfly Wings', price: 580, rarity: 'epic', desc: 'Your refactor had a butterfly effect.', swatchY: 6,
      draw(o, t) {
        const pal = [[255, 140, 200], [140, 200, 255], [255, 220, 120]];
        wingsAt(o, t, (k, i, j) => (k === 'K' ? [60, 30, 70] : pal[((i + j + (t >> 3)) >> 1) % 3]), [255, 180, 230]);
      } },
    { id: 'mergecape', name: 'Merge Conflict Cape', price: 640, rarity: 'epic', set: 'Ship It', desc: '<<<<<<< HEAD, ======= yours, >>>>>>> theirs.', swatchY: 13,
      draw: cape((dx, dy, t, edge, left) => {
        if (dy === 17 || dy === 20) return (dx + (t >> 1)) % 2 ? [255, 255, 255] : [90, 90, 110];
        const c = dx < (left + 13) / 2 ? [220, 70, 70] : [70, 190, 90];
        return edge ? X.shade(c, 0.5) : c;
      }) },
    { id: 'dragonwings', name: 'Dragon Wings', price: 1250, rarity: 'legendary', desc: 'Scaled, fireproof and extremely dramatic.', swatchY: 6,
      draw(o, t) {
        const pal = { K: [70, 16, 16], W: [200, 50, 40], w: [255, 150, 60] };
        wingsAt(o, t, (k, i, j) => (k === 'W' && (i + j) % 4 === 0 ? pal.w : pal[k]), [255, 110, 50]);
        if (t % 30 < 6) o.glow(-4, 22, 5, [255, 150, 60], 0.4);
      } },
  ];

  // ---------- auras ----------

  const AURAS = [
    { id: 'bubbleaura', name: 'Bubble Aura', price: 150, rarity: 'common', desc: 'Pop-up bubbles, the good kind.',
      draw(o, t) {
        o.field((dx, dy, d) => { if (d <= 1.5) o.mixBehind(dx, dy, [150, 220, 255], 0.2); });
        for (let k = 0; k < 6; k++) {
          const life = (t + k * 6) % 26, c = (t + k * 6) / 26 | 0;
          const bx = Math.round(-3 + X.hash(k, c) * 21), by = 24 - life;
          o.behind(bx, by, [220, 245, 255]);
          if (k % 2) { o.behind(bx + 1, by, [150, 210, 255]); o.behind(bx, by - 1, [150, 210, 255]); }
        }
      } },
    { id: 'leafaura', name: 'Leaf Swirl', price: 160, rarity: 'common', desc: 'Autumn in the forest biome.',
      draw(o, t) {
        const cols = [[220, 120, 40], [240, 180, 60], [120, 180, 70]];
        for (let k = 0; k < 7; k++) {
          const a = t * 0.12 + k * 0.9;
          const x = Math.round(7.5 + Math.cos(a) * 11), y = Math.round(12 + Math.sin(a * 0.7 + k) * 10);
          o.behind(x, y, cols[k % 3]); o.behind(x + 1, y, X.shade(cols[k % 3], 0.75));
        }
      } },
    { id: 'heartaura', name: 'Heart Aura', price: 180, rarity: 'common', desc: 'Loves every PR. Even the big ones.',
      draw(o, t) {
        o.field((dx, dy, d) => { if (d <= 2.5) o.mixBehind(dx, dy, [255, 120, 170], 0.22 * (1 - d / 3)); });
        for (let k = 0; k < 4; k++) {
          const life = (t + k * 7) % 28, c = (t + k * 7) / 28 | 0;
          const hx = Math.round(-3 + X.hash(k, c) * 20), hy = 22 - life, col = life < 18 ? [255, 90, 140] : [200, 70, 120];
          for (const [i, j] of [[0, 0], [2, 0], [0, 1], [1, 1], [2, 1], [1, 2]]) o.behind(hx + i, hy + j, col);
        }
      } },
    { id: 'musicaura', name: 'Music Aura', price: 300, rarity: 'rare', desc: 'Lo-fi beats to code to.',
      draw(o, t) {
        for (let k = 0; k < 4; k++) {
          const life = (t + k * 8) % 30, c = (t + k * 8) / 30 | 0;
          const nx = Math.round(-4 + X.hash(k, c) * 22 + Math.sin(life * 0.3) * 1.5), ny = 20 - life;
          const col = [[255, 214, 80], [180, 150, 255], [120, 220, 255]][k % 3];
          o.behind(nx, ny, col); o.behind(nx + 1, ny, col); o.behind(nx + 1, ny - 1, col); o.behind(nx + 1, ny - 2, col); o.behind(nx + 2, ny - 2, col);
        }
      } },
    { id: 'coffeeaura', name: 'Coffee Aura', price: 320, rarity: 'rare', set: 'Night Shift', desc: 'Runs on dark roast and stack traces.',
      draw(o, t) {
        o.field((dx, dy, d, up) => { if (d <= 3) o.mixBehind(dx, dy, up ? [140, 90, 50] : [90, 56, 34], 0.35 * (1 - d / 3.5)); });
        for (let k = 0; k < 3; k++) { // steam curls
          const base = [2, 7, 12][k];
          for (let j = 0; j < 7; j++) {
            const y = -1 - j - ((t >> 1) % 3), x = base + Math.round(Math.sin(t * 0.25 + j * 0.8 + k) * 1.5);
            o.mixBehind(x, y, [235, 230, 225], 0.55 - j * 0.07);
          }
        }
        for (let k = 0; k < 3; k++) { const a = t * 0.1 + k * 2.1; o.behind(Math.round(7.5 + Math.cos(a) * 11), Math.round(14 + Math.sin(a) * 7), [110, 66, 34]); }
        o.rim([200, 140, 80], 0.2);
      } },
    { id: 'staticaura', name: 'Static Charge', price: 380, rarity: 'rare', desc: 'Do not touch the server rack.',
      draw(o, t) {
        o.field((dx, dy, d) => {
          if (d > 2.5) return;
          const n = X.hash(dx * 3 + t, dy * 7 + (t >> 1));
          if (n > 0.93) o.mixBehind(dx, dy, [255, 250, 180], 0.9);
          else if (d <= 1.2) o.mixBehind(dx, dy, [120, 160, 255], 0.2);
        });
        o.rim([200, 220, 255], (t >> 1) % 3 ? 0.15 : 0.45);
      } },
    { id: 'rgbaura', name: 'RGB Gaming Aura', price: 560, rarity: 'epic', desc: '+10 FPS. Scientifically unproven.',
      draw(o, t) {
        o.field((dx, dy, d) => { if (d <= 2.2) o.mixBehind(dx, dy, cyc(RAINBOW, t + dy * 0.6, 0.25), 0.55 * (1 - d / 2.6)); });
        o.rim(cyc(RAINBOW, t, 0.25), 0.35);
      } },
    { id: 'matrixaura', name: 'Matrix Rain', price: 600, rarity: 'epic', desc: 'There is no spoon. There is only prod.',
      draw(o, t) {
        for (let col = -5; col <= 20; col += 2) {
          if (X.hash(col, 3) < 0.35) continue;
          const speed = 1 + (X.hash(col, 5) * 2 | 0), head = ((t * speed + (X.hash(col, 7) * 40 | 0)) % 40) - 8;
          for (let j = 0; j < 7; j++) {
            const y = head - j;
            if (y < -4 || y > 26) continue;
            o.mixBehind(col, y, j === 0 ? [220, 255, 220] : [40, 220, 90], j === 0 ? 0.95 : 0.7 - j * 0.09);
          }
        }
      } },
    { id: 'radiant', name: 'Radiant Aura', price: 620, rarity: 'epic', desc: 'Shines like a passing test suite.',
      draw(o, t) {
        o.glowBehind(7.5, 12, 14, [255, 230, 150], 0.3 + 0.08 * Math.sin(t * 0.2));
        for (let k = 0; k < 5; k++) {
          const x = [-3, 1, 7, 13, 18][k], ph = (t + k * 5) % 20;
          for (let y = -4; y < 26; y++) if (Math.abs(y - (26 - ph * 1.5)) < 6) o.mixBehind(x, y, [255, 240, 180], 0.35);
        }
        o.rim([255, 230, 150], 0.3);
      } },
    { id: 'glitchaura', name: 'Glitch Aura', price: 1150, rarity: 'legendary', desc: 'Undefined is not a function. Stylishly.',
      draw(o, t) {
        const off = (t >> 1) % 7 === 0 ? 2 : 1;
        o.field((dx, dy, d) => {
          if (d > 1.6) return;
          if (X.hash(dy, t >> 1) > 0.5) o.mixBehind(dx - off, dy, [255, 40, 200], 0.7);
          else o.mixBehind(dx + off, dy, [40, 240, 255], 0.7);
        });
        for (let k = 0; k < 4; k++) { const y = Math.floor(X.hash(k, t >> 1) * 24), x0 = Math.floor(X.hash(t >> 1, k) * 10) - 4; for (let i = 0; i < 5; i++) o.behind(x0 + i * 4, y, k % 2 ? [255, 40, 200] : [40, 240, 255]); }
        o.rim([255, 255, 255], (t % 5) ? 0.1 : 0.5);
      } },
  ];

  // ---------- pets ----------

  const PETS = [
    { id: 'turtle', name: 'Turtle', price: 160, rarity: 'common', desc: 'Slow and steady passes CI.', ground: true,
      draw(o, t) {
        const pal = { K, G: [90, 170, 90], g: [60, 120, 60], S: [160, 120, 60], s: [110, 80, 40], E: [20, 20, 20] };
        const peek = (t >> 4) % 3 !== 0, step = (t >> 3) % 2;
        rowsAt(o, ['...KKKK....', '..KSsSsK...', '.KSsSsSsK' + (peek ? 'KK' : ''), '.KSSSSSSKGEK'.slice(0, peek ? 12 : 9), 'KgGgGgGgGGK'.slice(0, peek ? 11 : 9), step ? '.KG..KG....' : '..KG..KG...'], pal, -12, 18);
      } },
    { id: 'bee', name: 'Bumblebee', price: 140, rarity: 'common', desc: 'Buzzes around your hot paths.',
      draw(o, t) {
        const bob = Math.round(Math.sin(t * 0.5) * 1.5), w = (t >> 1) % 2;
        const pal = { K, Y: [255, 214, 60], W: [220, 240, 255], E: [20, 20, 20] };
        rowsAt(o, [w ? '..WW.WW' : '.......', w ? '...W.W.' : '..WWWW.', '.KYKYKE', 'KYKYKYK', '.KKKKK.'], pal, -10, 4 + bob);
      } },
    { id: 'bat', name: 'Bat', price: 170, rarity: 'common', desc: 'Hangs upside down in your logs.',
      draw(o, t) {
        const flap = (t >> 1) % 2, bob = Math.round(Math.sin(t * 0.4) * 2);
        const pal = { K: [40, 30, 50], B: [80, 60, 100], E: [255, 80, 80] };
        rowsAt(o, flap ? ['B.......B', 'BB.K.K.BB', '.BBKEKBB.', '...KKK...'] : ['.........', '...K.K...', 'BBBKEKBBB', 'B..KKK..B'], pal, -12, 3 + bob);
      } },
    { id: 'fox', name: 'Fox Kit', price: 190, rarity: 'common', desc: 'Quick, brown, jumps over lazy dogs.', ground: true,
      draw(o, t) {
        const pal = { K, O: [240, 130, 50], W: [255, 240, 230], E: [30, 20, 20] };
        const step = (t >> 2) % 2, wag = (t >> 3) % 2;
        rowsAt(o, ['......K.K.', '......KOKOK', wag ? 'W.....KEOEK' : '.W....KEOEK', 'OW...KOOWWK', '.OKKKOOOOK.', '..KOOOOOK..', step ? '..K.K.K.K..' : '...K.K.K.K.'], pal, -12, 17);
      } },
    { id: 'cloudpet', name: 'Rain Cloud', price: 260, rarity: 'rare', desc: 'Follows you around. Mostly drizzles.',
      draw(o, t) {
        const bob = Math.round(Math.sin(t * 0.2));
        rowsAt(o, ['...WWW....', '.WWWWWWW..', 'WWWEWWEWW.', 'WWWWWWWWWW', '.wwwwwwww.'], { W: [230, 236, 248], w: [180, 190, 210], E: [60, 70, 90] }, -12, 2 + bob);
        for (let k = 0; k < 3; k++) { const ph = (t + k * 4) % 10; o.set(-11 + k * 3, 8 + bob + ph, [120, 180, 255]); }
      } },
    { id: 'duck', name: 'Rubber Duck', price: 260, rarity: 'rare', set: 'Night Shift', desc: 'Explain your bug to it. It listens.', ground: true,
      draw(o, t) {
        const pal = { K, Y: [255, 214, 60], y: [220, 170, 40], O: [255, 130, 40], E: [20, 20, 20] };
        const bob = (t >> 3) % 2;
        rowsAt(o, ['....KKK..', '...KYYYK.', '...KYEYOO', 'K..KYYYK.', 'KYKYYYYYK', 'KYYYYyYYK', '.KyyyyyK.', '..KKKKK..'], pal, -11, 16 + bob);
        if (t % 60 < 12) o.set(-3, 14, [255, 255, 255]);
      } },
    { id: 'penguin', name: 'Penguin', price: 280, rarity: 'rare', set: 'Frostbound', desc: 'Dressed for the standup.', ground: true,
      draw(o, t) {
        const pal = { K, B: [40, 44, 60], W: [245, 245, 250], O: [255, 160, 40], E: [20, 20, 20] };
        const wd = (t >> 3) % 2;
        rowsAt(o, ['..KKKK..', '.KBBBBK.', '.KBWEWBO', 'KBWWWWBK', wd ? 'BKWWWWKB' : 'KBWWWWBK', '.KBWWBK.', '..OKKO..'], pal, -11, 17);
      } },
    { id: 'ghostpet', name: "Lil' Ghost", price: 300, rarity: 'rare', desc: 'Haunts deprecated functions.',
      draw(o, t) {
        const bob = Math.round(Math.sin(t * 0.25) * 2), wav = (t >> 2) % 2;
        const rows = ['..WWWW..', '.WWWWWW.', 'WWEWWEWW', 'WWWWWWWW', 'WWWWoWWW', 'WWWWWWWW', wav ? 'W.WW.WW.' : '.WW.WW.W'];
        rows.forEach((r, j) => { for (let i = 0; i < r.length; i++) if (r[i] !== '.') o.set(-12 + i, 3 + bob + j, r[i] === 'E' || r[i] === 'o' ? [40, 40, 70] : [236, 240, 255]); });
        o.glow(-8, 7 + bob, 6, [200, 210, 255], 0.2);
      } },
    { id: 'octopus', name: 'Octopus', price: 320, rarity: 'rare', desc: 'Eight arms, eight open pull requests.', ground: true,
      draw(o, t) {
        const pal = { K, P: [200, 100, 200], p: [150, 60, 150], E: [255, 255, 255], e: [20, 20, 20] };
        const w = (t >> 2) % 2;
        rowsAt(o, ['..KKKK..', '.KPPPPK.', 'KPEePEeK'.replace('Ee', 'eE'), 'KPPPPPPK', '.KpPPpK.', w ? 'KP.PP.PK' : 'P.PP.PP.', w ? 'P.P..P.P' : '.P..P..P'], pal, -11, 17);
      } },
    { id: 'crab', name: 'Rust Crab', price: 560, rarity: 'epic', desc: 'Memory safe and fearless.', ground: true,
      draw(o, t) {
        const pal = { K, R: [240, 110, 40], r: [190, 70, 30], E: [20, 20, 20], W: [255, 255, 255] };
        const side = Math.round(Math.sin(t * 0.3) * 1.5), snap = (t >> 2) % 2;
        rowsAt(o, [snap ? 'KK.......KK' : 'K.K.....K.K', '.KK.W.W.KK.', '..KKEKEKK..', '.KRRRRRRRK.', 'KRRrRRRrRRK', '.KrKrKrKrK.', '.K.K...K.K.'], pal, -12 + side, 17);
      } },
    { id: 'mimic', name: 'Mini Mimic', price: 640, rarity: 'epic', desc: 'It was never a treasure chest.', ground: true,
      draw(o, t) {
        const pal = { K, B: [150, 98, 52], b: [100, 64, 34], Y: [255, 214, 80], R: [230, 60, 80], W: [255, 255, 255] };
        const open = (t >> 3) % 3 === 0, hop = open ? 1 : 0;
        const rows = open
          ? ['.KKKKKKKK.', 'KBBBBBBBBK', 'KYYYYYYYYK', 'KW.W.W.W.K', 'K.RRRRRR.K', 'KW.W.W.W.K', 'KBBYYBBBBK', 'KbbbbbbbbK', '.KKKKKKKK.']
          : ['', '', '.KKKKKKKK.', 'KBBBBBBBBK', 'KYYYYYYYYK', 'KBBBKKBBBK', 'KBBBYYBBBK', 'KbbbbbbbbK', '.KKKKKKKK.'];
        rowsAt(o, rows, pal, -12, 15 - hop);
      } },
    { id: 'phoenixchick', name: 'Phoenix Chick', price: 1150, rarity: 'legendary', desc: 'Reborn after every failed build.',
      draw(o, t) {
        const bob = Math.round(Math.sin(t * 0.3) * 2), flap = (t >> 1) % 2;
        const fire = [[255, 250, 200], [255, 214, 80], [255, 140, 40], [214, 60, 30]];
        o.glow(-8, 7 + bob, 7, [255, 150, 60], 0.4);
        const rows = [flap ? 'o......o' : '........', flap ? 'oo.YY.oo' : '...YY...', '.oYYYYo.', 'ooYEYYYO', '..YYYY..', '...rr...', '..r..r..'];
        rows.forEach((r, j) => { for (let i = 0; i < r.length; i++) {
          const k = r[i];
          if (k === '.') continue;
          o.set(-12 + i, 3 + bob + j, k === 'E' ? [40, 10, 10] : k === 'O' ? [255, 120, 30] : k === 'o' ? fire[2 + ((i + t) & 1)] : k === 'r' ? fire[3] : fire[1]);
        } });
        for (let k = 0; k < 3; k++) { const ph = (t + k * 4) % 12; o.set(-8 + (k - 1), 10 + bob + ph, ph < 6 ? fire[1] : fire[3]); }
      } },
  ];

  // ---------- weapon glows ----------

  function rgbGlow(o, t) {
    const [ax, ay] = weaponTip(o.ch, o.pose);
    const c = cyc(RAINBOW, t, 0.3);
    o.glow(ax, ay, 8, c, 0.6);
    for (let k = 0; k < 6; k++) { const life = (t + k * 4) % 12; o.set(ax + Math.round(Math.sin(t * 0.3 + k * 2) * 2), ay - life + 2, cyc(RAINBOW, t + k * 3, 0.3)); }
  }
  function dripGlow(core, drip) {
    const base = weaponGlow(core, [240, 255, 240], X.shade(core, 0.5));
    return function draw(o, t) {
      base(o, t);
      const [ax, ay] = weaponTip(o.ch, o.pose);
      for (let k = 0; k < 3; k++) { const ph = (t + k * 5) % 15; o.set(ax - 1 + k, ay + 1 + ph, ph < 10 ? drip : X.shade(drip, 0.6)); }
    };
  }
  function boltGlow(o, t) {
    const [ax, ay] = weaponTip(o.ch, o.pose);
    o.glow(ax, ay, 9, [180, 200, 255], 0.5 + ((t >> 1) % 2) * 0.2);
    if ((t >> 1) % 3 === 0) {
      let x = ax, y = ay;
      for (let k = 0; k < 6; k++) { x += Math.round(X.hash(k, t) * 2 - 1); y -= 1; o.set(x, y, k ? [200, 220, 255] : [255, 255, 255]); }
    }
    o.set(ax, ay, [255, 255, 255]);
  }
  function checkGlow(o, t) {
    const [ax, ay] = weaponTip(o.ch, o.pose);
    o.glow(ax, ay, 8, [80, 220, 110], 0.55);
    const ph = t % 20;
    if (ph < 10) { const y = ay - 3 - (ph >> 1); for (const [i, j] of [[-2, 0], [-1, 1], [0, 0], [1, -1], [2, -2]]) o.set(ax + i, y + j, [200, 255, 210]); }
  }

  const WEAPONS = [
    { id: 'wglitter', name: 'Glitter', price: 120, rarity: 'common', desc: 'Gets everywhere. Forever.', draw: starGlow([255, 180, 230], [255, 255, 255], [200, 120, 200]) },
    { id: 'wheart', name: 'Love Glow', price: 140, rarity: 'common', desc: 'Every hit is a compliment.', draw: weaponGlow([255, 110, 160], [255, 220, 235], [200, 60, 110]) },
    { id: 'wbubble', name: 'Bubble Wand', price: 150, rarity: 'common', desc: 'Pew. Pop. Pew.', draw: dripGlow([150, 220, 255], [220, 245, 255]) },
    { id: 'wsun', name: 'Sunfire', price: 260, rarity: 'rare', desc: 'Warm glow of a green dashboard.', draw: weaponGlow([255, 200, 60], [255, 255, 200], [230, 120, 30]) },
    { id: 'wgreen', name: 'Green Build Glow', price: 260, rarity: 'rare', set: 'Ship It', desc: 'All checks have passed.', draw: checkGlow },
    { id: 'wpoison', name: 'Venom Drip', price: 280, rarity: 'rare', desc: 'Drips with deprecated APIs.', draw: dripGlow([150, 220, 60], [120, 255, 80]) },
    { id: 'wrgb', name: 'RGB Enchant', price: 520, rarity: 'epic', desc: 'The weapon now has a mechanical keyboard.', draw: rgbGlow },
    { id: 'wholy', name: 'Holy Light', price: 540, rarity: 'epic', desc: 'Blessed by the code review gods.', draw: starGlow([255, 240, 170], [255, 255, 255], [220, 180, 90]) },
    { id: 'wstorm', name: 'Storm Enchant', price: 600, rarity: 'epic', desc: 'Crackles with 10,000 volts of CI.', draw: boltGlow },
    { id: 'wshadow', name: 'Shadowflame', price: 1100, rarity: 'legendary', desc: 'Black fire that burns only bugs.', draw: weaponGlow([90, 20, 140], [220, 150, 255], [20, 0, 40]) },
  ];

  // ---------- buffs ----------

  const icon = (pal, rows) => ({ pal: { K, ...pal }, rows });
  const BUFFS = [
    { id: 'coffee', name: 'Espresso', price: 30, rarity: 'common', desc: '+15% damage for 2 waves.', buff: { dmg: 1.15, waves: 2 },
      icon: icon({ W: [250, 250, 250], C: [110, 66, 34], s: [220, 220, 230] }, ['', '......s.s.......', '.......s.s......', '....KKKKKKKK....', '....KCCCCCCKKK..', '....KWWWWWWK.K..', '....KWWWWWWKKK..', '.....KWWWWK.....', '......KKKK......']) },
    { id: 'pizza', name: 'Pizza Slice', price: 35, rarity: 'common', desc: '+10% damage for 5 waves.', buff: { dmg: 1.1, waves: 5 },
      icon: icon({ Y: [255, 214, 90], R: [220, 60, 50], B: [200, 140, 70] }, ['', '....KKKKKKKK....', '....KBBBBBBK....', '.....KYRYYK.....', '.....KYYRYK.....', '......KYYK......', '......KRYK......', '.......KK.......']) },
    { id: 'piggybank', name: 'Piggy Bank', price: 45, rarity: 'common', desc: '+25% gold for 3 waves.', buff: { gold: 1.25, waves: 3 },
      icon: icon({ P: [255, 150, 180], p: [220, 110, 140], E: [20, 20, 20], Y: [255, 214, 80] }, ['', '.......KYK......', '....KKKKKKKK....', '...KPPPPPPPPK...', '..KPPEPPPPPPPK..', '..PPPPPPPPPPPK..', '...KPPPPPPPPK...', '....KpK..KpK....']) },
    { id: 'energydrink', name: 'Energy Drink', price: 70, rarity: 'rare', desc: '+40% damage for 1 wave.', buff: { dmg: 1.4, waves: 1 },
      icon: icon({ G: [120, 240, 90], g: [70, 170, 60], S: [200, 206, 220] }, ['', '......KSSK......', '......KGGK......', '......KGgK......', '......KGGK......', '......KgGK......', '......KGGK......', '......KSSK......']) },
    { id: 'treasuremap', name: 'Treasure Map', price: 80, rarity: 'rare', desc: '+50% gold for 4 waves.', buff: { gold: 1.5, waves: 4 },
      icon: icon({ T: [230, 200, 140], t: [190, 150, 90], R: [220, 50, 50] }, ['', '...KKKKKKKKKK...', '...KTTtTTTTtK...', '...KTtTTRTTTK...', '...KTTTTTRTTK...', '...KtTTRTTTtK...', '...KTTTTTTTTK...', '...KKKKKKKKKK...']) },
    { id: 'hotfix', name: 'Hotfix Potion', price: 110, rarity: 'rare', desc: '+30% damage and +30% gold for 3 waves.', buff: { dmg: 1.3, gold: 1.3, waves: 3 },
      icon: icon({ L: [120, 220, 255], l: [70, 160, 220], W: [255, 255, 255], c: [150, 110, 70] }, ['', '.......KK.......', '......KccK......', '.......KK.......', '......KLLK......', '.....KLWLLK.....', '....KLWLLLLK....', '....KLLLLLlK....', '.....KllllK.....', '......KKKK......']) },
    { id: 'goldenkeyboard', name: 'Golden Keyboard', price: 200, rarity: 'epic', desc: 'Two and a half times the gold for 3 waves.', buff: { gold: 2.5, waves: 3 },
      icon: icon({ Y: [255, 214, 80], y: [200, 150, 40], W: [255, 250, 220] }, ['', '', '..KKKKKKKKKKKK..', '..KYWYWYWYWYYK..', '..KYYWYWYWYWYK..', '..KYYYWWWWYYYK..', '..KyyyyyyyyyyK..', '..KKKKKKKKKKKK..']) },
    { id: 'duckoracle', name: 'Rubber Duck Oracle', price: 250, rarity: 'legendary', loot: true, desc: '+50% damage and +50% gold for 3 waves.', buff: { dmg: 1.5, gold: 1.5, waves: 3 },
      icon: icon({ Y: [255, 214, 60], O: [255, 130, 40], E: [20, 20, 20], S: [180, 150, 255] }, ['..S..........S..', '....KKK.........', '...KYYYK........', '...KYEYOO.......', 'K..KYYYK.....S..', 'KYKYYYYYK.......', 'KYYYYYYYK.......', '.KYYYYYK........', '..KKKKK.........']) },
  ];

  // ---------- trails (behind the hero while it moves or attacks) ----------

  function trail(kind, cols, { n = 8, life = 12 } = {}) {
    const step = Math.max(1, Math.ceil(life / n));
    return function draw(o, t) {
      if (kind === 'rainbow') {
        for (let x = -1; x >= -16; x--) for (let s = 0; s < 6; s++) {
          const y = 11 + s + Math.round(Math.sin(t * 0.5 + x * 0.6) * 1);
          o.mixBehind(x, y, RAINBOW[s], Math.max(0, 0.95 + x * 0.05));
        }
        return;
      }
      if (kind === 'ghost') {
        for (let k = 1; k <= 3; k++) for (const [dx, dy] of o.silPts || []) if ((dx + dy + k) % 2 === 0 || k === 1) o.mixBehind(dx - k * 5, dy, cols[0], 0.5 - k * 0.13);
        return;
      }
      if (kind === 'tumbleweed') {
        const ph = t % 24, x = -3 - ph, y = 20 - Math.abs(Math.round(Math.sin(ph * 0.5) * 3));
        for (let j = -2; j <= 2; j++) for (let i = -2; i <= 2; i++) if (i * i + j * j <= 5 && (i + j + (t >> 1)) % 2 === 0) o.behind(x + i, y + j, (i * j) % 2 ? cols[0] : cols[1]);
        for (let k = 1; k < 4; k++) o.mixBehind(x + 3 + k * 2, 23, [180, 150, 110], 0.4);
        return;
      }
      if (kind === 'comet') {
        const y = 14;
        for (let x = -1; x >= -18; x--) {
          const w = Math.max(0, 3 - Math.floor(-x / 6));
          for (let j = -w; j <= w; j++) o.mixBehind(x, y + j + Math.round(Math.sin(t * 0.4 + x * 0.3)), x > -4 ? W0 : cyc(cols, -x + t, 0.2), 0.9 + x * 0.045);
        }
        for (let k = 0; k < 4; k++) { const ph = (t + k * 3) % 12; o.behind(-3 - ph * 1.5, 10 + Math.round(X.hash(k, (t + k * 3) / 12 | 0) * 8), W0); }
        return;
      }
      for (let k = 0; k < n; k++) {
        const a = (t + k * step) % life, cy = Math.floor((t + k * step) / life);
        const fade = 1 - a / life;
        let x = 1 - Math.round(a * 1.3), y = 9 + Math.floor(X.hash(k, cy) * 14);
        const c = cols[(k + cy) % cols.length];
        if (kind === 'sparkle') {
          o.mixBehind(x, y, a < 3 ? W0 : c, fade);
          if (a >= 1 && a < 4) for (const [i, j] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) o.mixBehind(x + i, y + j, c, fade * 0.7);
        } else if (kind === 'flame') {
          y = 16 + Math.floor(X.hash(k, cy) * 7) - Math.round(a * 0.6);
          o.mixBehind(x, y, cols[Math.min(cols.length - 1, Math.floor(a / life * cols.length))], 0.4 + 0.6 * fade);
          o.mixBehind(x - 1, y, cols[Math.min(cols.length - 1, Math.floor(a / life * cols.length) + 1)], 0.5 * fade);
        } else if (kind === 'bubbles') {
          y -= Math.round(a * 0.5);
          if (k % 2) { o.mixBehind(x, y, c, fade); } else { for (const [i, j] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) o.mixBehind(x + i, y + j, c, fade); }
        } else if (kind === 'hearts') {
          y -= Math.round(a * 0.4);
          for (const [i, j] of [[0, 0], [2, 0], [0, 1], [1, 1], [2, 1], [1, 2]]) o.mixBehind(x + i, y + j, c, fade);
        } else if (kind === 'leaves' || kind === 'snow') {
          y += Math.round(a * (kind === 'snow' ? 0.5 : 0.7));
          x += Math.round(Math.sin((t + k) * 0.5));
          o.mixBehind(x, y, c, fade); if (kind === 'leaves') o.mixBehind(x + 1, y, X.shade(c, 0.7), fade);
          else if (k % 3 === 0) for (const [i, j] of [[1, 1], [-1, -1], [1, -1], [-1, 1]]) o.mixBehind(x + i, y + j, c, fade * 0.6);
        } else if (kind === 'keycaps') {
          y = 12 + Math.floor(X.hash(k, cy) * 10) - Math.round(a * 0.3);
          for (let j = 0; j < 3; j++) for (let i = 0; i < 3; i++) o.mixBehind(x + i, y + j, i === 1 && j === 1 ? [40, 40, 50] : j === 2 ? X.shade(c, 0.7) : c, fade);
        } else if (kind === 'binary') {
          const one = X.hash(k, cy + 5) > 0.5;
          for (let j = 0; j < 3; j++) { o.mixBehind(x, y + j, c, fade); if (!one && j !== 1) o.mixBehind(x + 1, y + j, c, fade); if (!one) o.mixBehind(x + 2, y + j, c, fade); }
        } else o.mixBehind(x, y, c, fade);
      }
    };
  }

  const TRAILS = [
    { id: 'tumbleweed', name: 'Tumbleweed', price: 100, rarity: 'common', set: 'Wild West', desc: 'Rolls in whenever it gets quiet.', trail: trail('tumbleweed', [[170, 130, 70], [120, 90, 50]]) },
    { id: 'bubbletrail', name: 'Bubble Trail', price: 110, rarity: 'common', desc: 'A foamy wake behind every step.', trail: trail('bubbles', [[200, 240, 255], [140, 210, 255]]) },
    { id: 'sparkletrail', name: 'Stardust Trail', price: 120, rarity: 'common', desc: 'Leaves a little shine behind.', trail: trail('sparkle', [[255, 236, 140], [255, 170, 230], [150, 230, 255]]) },
    { id: 'leaftrail', name: 'Falling Leaves', price: 120, rarity: 'common', desc: 'Autumn follows you around.', trail: trail('leaves', [[220, 120, 40], [240, 180, 60], [140, 190, 70]]) },
    { id: 'hearttrail', name: 'Heart Trail', price: 130, rarity: 'common', desc: 'Spreads love, one footstep at a time.', trail: trail('hearts', [[255, 90, 140], [255, 150, 190]], { n: 5, life: 14 }) },
    { id: 'snowtrail', name: 'Snowfall', price: 240, rarity: 'rare', set: 'Frostbound', desc: 'A cold front on your heels.', trail: trail('snow', [[240, 248, 255], [180, 220, 255]], { n: 10 }) },
    { id: 'keycaps', name: 'Keycap Trail', price: 260, rarity: 'rare', set: 'Night Shift', desc: 'Clack clack clack.', trail: trail('keycaps', [[230, 230, 240], [255, 214, 80], [120, 200, 255]], { n: 5, life: 14 }) },
    { id: 'binarytrail', name: 'Binary Trail', price: 280, rarity: 'rare', desc: '01001000 01001001', trail: trail('binary', [[80, 240, 120], [40, 180, 80]], { n: 6, life: 14 }) },
    { id: 'flametrail', name: 'Flame Trail', price: 300, rarity: 'rare', desc: 'Leaves scorch marks on the dungeon floor.', trail: trail('flame', [[255, 250, 200], [255, 214, 80], [255, 140, 40], [214, 60, 30], [90, 30, 20]], { n: 10 }) },
    { id: 'rainbowtrail', name: 'Rainbow Trail', price: 600, rarity: 'epic', desc: 'Nyan nyan nyan nyan.', trail: trail('rainbow', RAINBOW) },
    { id: 'afterimage', name: 'Afterimage', price: 650, rarity: 'epic', desc: 'Too fast for the eye. Or the linter.', trail: trail('ghost', [[140, 200, 255]]) },
    { id: 'comet', name: 'Comet Trail', price: 1200, rarity: 'legendary', desc: 'Streaks across the sky like a hotfix at 5pm.', trail: trail('comet', [[150, 190, 255], [200, 150, 255], [255, 226, 140]]) },
  ];

  // ---------- mounts (idle at camp) ----------

  const HORSE = [
    '..............KK....',
    '.............KMBK...',
    '............KMBBBK..',
    '............KMBEBBK.',
    '............KMBBBBBK',
    '...........KMBBKKKK.',
    '..........KMBBK.....',
    '.KK......KMBBBK.....',
    'KTTKKKKKKBBBBBK.....',
    'KTK.KBBBBBBBBBK.....',
    'KT..KBBBBBBBBbK.....',
    '....KbBBBBBBbbK.....',
    '.....KbK...KbK......',
    '.....KbK...KbK......',
    '.....KHK...KHK......',
  ];
  const WOLF = [
    '...............K.K..',
    '..............KGKGK.',
    '..............KGGGK.',
    '.............KGGEGGK',
    '.............KGGGGGGK',
    '..K..........KGGGKKK',
    '.KGK.KKKKKKKKGGGK...',
    'KGGKKGGGGGGGGGGK....',
    'KGK.KGGGGGGGGGGK....',
    '...KgGGGGGGGGggK....',
    '....KgK.....KgK.....',
    '....KgK.....KgK.....',
    '....KKK.....KKK.....',
  ];
  const BEAR = [
    '.............KK.KK..',
    '............KWWKWWK.',
    '...........KWWWWWWWK',
    '...........KWWEWWWWK',
    '...........KWWWWWKKK',
    '..KKKKKKKKKWWWWWK...',
    '.KWWWWWWWWWWWWWK....',
    'KWWWWWWWWWWWWWWK....',
    'KwWWWWWWWWWWWWwK....',
    'KwwWWWWWWWWWWwwK....',
    '.KwwK.KwwK.KwwK.....',
    '.KKKK.KKKK.KKKK.....',
  ];
  const SNAIL = [
    '..................K.K',
    '..................E.E',
    '.....KKKKKK.......K.K',
    '....KSSSSSSK......K.K',
    '...KSSsssSSSK....KBBK',
    '...KSsSSSsSSK...KBBBBK',
    '...KSsSsSsSSK..KBBBBBK',
    '...KSSsssSSSKKKBBBBBK',
    '..KBKSSSSSSKBBBBBBBK',
    '.KBBBKKKKKKBBBBBBBK',
    'KBBBBBBBBBBBBBBBBK',
    'KKKKKKKKKKKKKKKKK',
  ];
  const ROCKET = [
    '.....KK.....', '....KRRK....', '...KRRRRK...', '...KWWWWK...', '..KWWBBWWK..', '..KWBCCBWK..', '..KWWBBWWK..',
    '..KWWWWWWK..', '..KWRRRRWK..', '..KWWWWWWK..', '.KRKWWWWKRK.', 'KRRKWWWWKRRK', 'KRRKKKKKKRRK', 'KK..KGGK..KK',
  ];

  // Draw rows at (x, y) on target `s` (s.set), mirrored when flip.
  function blitRows(s, rows, pal, x, y, flip, recolor) {
    const w = Math.max(...rows.map((r) => r.length));
    rows.forEach((row, j) => { for (let i = 0; i < row.length; i++) {
      const k = row[i];
      if (k === '.') continue;
      const c = recolor ? recolor(k, i, j) : pal[k];
      if (c) s.set(flip ? x + w - 1 - i : x + i, y + j, c);
    } });
  }
  // Four-legged mounts: tail swish, head bob, blinking, and a lowered head
  // with shut eyes while asleep. Head = columns >= headFrom in rows < 7.
  function beast(rows, pal, { tailRows = [], extra, recolor, lid = 'B', headFrom = 9 } = {}) {
    return function draw(s, x, floorY, t, st = {}) {
      const top = floorY - rows.length;
      const blink = st.sleep || t % 50 < 3;
      const bob = st.sleep ? 2 : (t >> 4) % 4 === 1 ? 1 : 0;
      const swish = (t >> 3) % 2;
      const body = [], head = [];
      rows.forEach((row, j) => {
        let r = blink ? row.replace(/E/g, lid) : row;
        if (swish && tailRows.includes(j)) r = '.' + r.slice(0, 3) + r.slice(4);
        body.push(j < 7 ? r.slice(0, headFrom) : r);
        head.push(j < 7 ? '.'.repeat(headFrom) + r.slice(headFrom) : '');
      });
      const w = Math.max(...rows.map((r) => r.length));
      const padded = (list) => list.map((r) => r + '.'.repeat(Math.max(0, w - r.length)));
      blitRows(s, padded(body), pal, x, top, st.flip, recolor);
      blitRows(s, padded(head), pal, x, top + bob, st.flip, recolor);
      if (extra) extra(s, x, top, t, st);
      if (st.sleep) { const ph = t % 30; if (ph < 20) s.set(x + (st.flip ? 1 : w - 2) + (ph >> 3), top - 2 - (ph >> 2), [200, 200, 236]); }
    };
  }
  const mountAt = (draw, w, h) => ({ w, h, draw });

  const MOUNTS = [
    { id: 'snail', name: 'Giant Snail', price: 250, rarity: 'common', desc: 'Slow but steady, like the CI queue.',
      mount: mountAt(function draw(s, x, floorY, t, st = {}) {
        const pal = { K, S: [230, 140, 80], s: [170, 90, 50], B: [150, 210, 120], E: [20, 20, 20] };
        const wob = (t >> 3) % 2;
        blitRows(s, SNAIL.map((r, j) => (j < 2 && wob ? '.' + r.slice(0, -1) : r)), pal, x, floorY - SNAIL.length, st.flip);
        for (let k = 1; k < 5; k++) s.set(st.flip ? x + 18 + k * 2 : x - k * 2, floorY - 1, [170, 230, 190]);
      }, 22, 12) },
    { id: 'pony', name: 'Pony', price: 400, rarity: 'rare', set: 'Wild West', desc: 'Yeehaw, in the most gentle way.',
      mount: mountAt(beast(HORSE, { K, B: [170, 110, 60], b: [120, 76, 40], M: [70, 44, 30], T: [70, 44, 30], E: [20, 20, 20], H: [50, 40, 40] }, { tailRows: [7, 8, 9, 10] }), 20, 15) },
    { id: 'hoverboard', name: 'Hoverboard', price: 450, rarity: 'rare', desc: 'Floats one pixel above your problems.',
      mount: mountAt(function draw(s, x, floorY, t) {
        const y = floorY - 6 + Math.round(Math.sin(t * 0.25));
        for (let i = 0; i < 18; i++) { s.set(x + i, y, i === 0 || i === 17 ? K : [80, 90, 120]); s.set(x + i, y + 1, i < 2 || i > 15 ? K : i % 4 === 0 ? [255, 214, 80] : [60, 200, 255]); }
        for (let i = 2; i < 16; i += 3) s.set(x + i, y + 2 + ((t >> 1) + i) % 2, [120, 230, 255]);
        s.glow && s.glow(x + 9, floorY - 2, 8, [80, 200, 255], 0.3);
      }, 18, 8) },
    { id: 'wolfmount', name: 'Dire Wolf', price: 700, rarity: 'epic', desc: 'Good boy. Very large. Very good.',
      mount: mountAt(beast(WOLF, { K, G: [120, 124, 140], g: [80, 84, 100], E: [255, 220, 80] }, { tailRows: [5, 6, 7, 8], lid: 'G' }), 21, 13) },
    { id: 'polarbear', name: 'Polar Bear', price: 680, rarity: 'epic', set: 'Frostbound', desc: 'A cold, fluffy, 600-kilo hug.',
      mount: mountAt(beast(BEAR, { K, W: [240, 244, 250], w: [200, 208, 222], E: [20, 20, 20] }, { lid: 'W' }), 20, 12) },
    { id: 'rocket', name: 'Deploy Rocket', price: 750, rarity: 'epic', set: 'Ship It', desc: 'Parked and fueled for the next release.',
      mount: mountAt(function draw(s, x, floorY, t, st = {}) {
        const pal = { K, R: [220, 60, 60], W: [230, 232, 240], B: [80, 90, 110], C: [120, 220, 255], G: [120, 124, 140] };
        blitRows(s, ROCKET, pal, x + 4, floorY - ROCKET.length, st.flip);
        if (!st.sleep) for (let k = 0; k < 3; k++) { const ph = (t + k * 5) % 15; s.set(x + 9 + ((ph >> 2) * (k - 1)), floorY - 1 - (ph >> 2), X.mix([200, 200, 210], [120, 120, 130], ph / 15)); }
        if ((t >> 2) % 2) s.set(x + 9, floorY - 11, [180, 255, 255]);
      }, 20, 14) },
    { id: 'unicorn', name: 'Unicorn', price: 1400, rarity: 'legendary', desc: 'Pure magic. Probably a microservice.',
      mount: mountAt(beast(HORSE, { K, B: [245, 245, 255], b: [200, 200, 225], M: [255, 120, 200], T: [255, 120, 200], E: [60, 40, 90], H: [255, 214, 80] }, {
        tailRows: [7, 8, 9, 10],
        recolor: (k, i, j) => (k === 'M' || k === 'T' ? RAINBOW[(j + i) % 6] : ({ K, B: [245, 245, 255], b: [200, 200, 225], E: [60, 40, 90], H: [255, 214, 80] })[k]),
        extra(s, x, top, t, st) {
          const f = (dx) => (st.flip ? x + 19 - dx : x + dx);
          s.set(f(16), top, [255, 236, 140]); s.set(f(17), top - 1, [255, 214, 80]); s.set(f(18), top - 2, [255, 250, 220]);
          if (t % 12 < 4) s.set(f(18), top - 4, [255, 255, 255]);
        },
      }), 20, 15) },
    { id: 'drake', name: 'Ember Drake', price: 1400, rarity: 'legendary', loot: true, craft: { ember: 24, starlight: 6 }, desc: 'Sleeps on a pile of your gold. Snores smoke.',
      mount: mountAt(beast(WOLF, { K: [60, 14, 14], G: [200, 60, 40], g: [140, 36, 26], E: [255, 230, 80] }, {
        tailRows: [5, 6, 7, 8], lid: 'G',
        extra(s, x, top, t, st) {
          const f = (dx) => (st.flip ? x + 20 - dx : x + dx);
          for (let i = 0; i < 6; i++) for (let j = 0; j <= i >> 1; j++) s.set(f(7 + i), top + 3 + j + (i >> 1), [230, 110, 60]);
          const ph = t % 20; if (ph < 10) s.set(f(21 + (ph >> 2)), top + 4 - (ph >> 1), X.mix([180, 180, 190], [90, 90, 100], ph / 10));
        },
      }), 21, 13) },
  ];

  // ---------- camp tents ----------

  const EMBLEMS = {
    star: ['..#..', '.###.', '#####', '.###.', '.#.#.'],
    check: ['....#', '...##', '#.##.', '###..', '.#...'],
    cup: ['.#.#.', '#####', '####.', '####.', '.##..'],
    skull: ['.###.', '#.#.#', '#####', '.#.#.', '.###.'],
    heart: ['##.##', '#####', '#####', '.###.', '..#..'],
    flake: ['#.#.#', '.###.', '#####', '.###.', '#.#.#'],
    shoe: ['#...#', '#...#', '#...#', '##.##', '.###.'],
    bug: ['#...#', '.###.', '#####', '.###.', '#.#.#'],
    flame: ['..#..', '.##..', '.###.', '#####', '.###.'],
    crown: ['#.#.#', '#####', '#####', '.....', '.....'],
  };

  // A tent standing on baseY, x = left edge, w × h pixels.
  function drawTent(s, x, baseY, w, h, tent, t) {
    const { style, c1, c2 = X.shade(c1, 0.75), trim = K } = tent;
    const top = baseY - h, mid = x + (w - 1) / 2;
    const put = (px, py, c) => s.set(Math.round(px), Math.round(py), c);
    if (style === 'dome' || style === 'igloo') {
      for (let j = 0; j < h; j++) {
        const k = 1 - (j / h), half = Math.round((w / 2) * Math.sqrt(1 - (1 - j / h) ** 2) * 1.0);
        for (let i = -half; i <= half; i++) {
          const px = mid + i, edge = Math.abs(i) === half || j === 0 && Math.abs(i) < 2;
          let c = edge ? trim : i < -half / 3 ? c1 : c2;
          if (style === 'igloo' && !edge && ((j % 3 === 0) || ((Math.round(px) + (Math.floor(j / 3) % 2) * 2) % 4 === 0))) c = X.shade(c1, 0.8);
          if (style === 'dome' && !edge && Math.abs(i) === Math.round(half / 2)) c = X.shade(c1, 0.7);
          put(px, top + j, c);
        }
        void k;
      }
      const dh = Math.round(h * 0.55), dw = Math.max(2, Math.round(w * 0.14));
      for (let j = 0; j < dh; j++) for (let i = -dw; i <= dw; i++) if (i * i / (dw * dw) + (j - dh) ** 2 / (dh * dh) <= 1) put(mid + i, baseY - 1 - j, [30, 24, 36]);
      return;
    }
    if (style === 'box') { // cardboard fort
      const bt = top + 3;
      for (let j = bt; j < baseY; j++) for (let i = 0; i < w; i++) put(x + i, j, i === 0 || i === w - 1 || j === bt || j === baseY - 1 ? trim : (i + j) % 7 === 0 ? c2 : c1);
      for (let i = 0; i < 5; i++) { put(x + i, bt - 1 - (i >> 1), c2); put(x + w - 1 - i, bt - 1 - (i >> 1), c2); }
      for (let j = 0; j < 6; j++) for (let i = 0; i < 5; i++) put(x + Math.round(w / 2) - 2 + i, baseY - 1 - j, [40, 30, 24]);
      for (let i = 0; i < 4; i++) put(x + 3 + i, bt + 3, [220, 50, 50]);
      return;
    }
    const roofH = style === 'pavilion' ? Math.round(h * 0.45) : h;
    const peakY = top;
    for (let j = 0; j < h; j++) {
      const y = peakY + j;
      let half;
      if (style === 'pavilion') half = j < roofH ? Math.round(((j + 1) / roofH) * (w / 2)) : Math.round(w / 2) - 1;
      else if (style === 'teepee') half = Math.round(((j + 1) / h) * (w / 2) * 0.8);
      else half = Math.round(((j + 1) / h) * (w / 2));
      for (let i = -half; i <= half; i++) {
        const edge = Math.abs(i) === half || (style === 'pavilion' && j === roofH);
        let c = edge ? trim : i < 0 ? c1 : c2;
        if (!edge && style === 'striped') c = (Math.floor((i + w) / 2) % 2) ? c1 : c2;
        if (!edge && style === 'pavilion') c = j < roofH ? ((Math.floor((i + w) / 3) % 2) ? c1 : c2) : ((Math.floor((i + w) / 4) % 2) ? c1 : X.shade(c1, 0.8));
        if (!edge && style === 'teepee' && (j === Math.round(h * 0.4) || j === Math.round(h * 0.4) + 2)) c = (i + j) % 3 ? c2 : [240, 220, 160];
        put(mid + i, y, c);
      }
      if (style === 'pavilion' && j === roofH) for (let i = -half; i <= half; i += 2) put(mid + i, y + 1, c2);
    }
    // Door.
    const dh = Math.round(h * 0.55);
    for (let j = 0; j < dh; j++) { const half = Math.round(((j + 1) / dh) * (w * 0.14)); for (let i = -half; i <= half; i++) put(mid + i, baseY - dh + j, i === -half || i === half ? X.shade(c1, 0.55) : [30, 24, 36]); }
    if (style === 'teepee') { put(mid - 2, peakY - 2, [110, 80, 50]); put(mid - 1, peakY - 1, [110, 80, 50]); put(mid + 2, peakY - 2, [110, 80, 50]); put(mid + 1, peakY - 1, [110, 80, 50]); }
    if (style === 'striped' || style === 'pavilion') { // pennant
      for (let j = 1; j <= 4; j++) put(mid, peakY - j, [110, 80, 50]);
      for (let i = 1; i <= 4; i++) for (let j = 0; j < 3 - (i >> 1); j++) put(mid + i, peakY - 4 + j + Math.round(Math.sin(t * 0.3 + i) * 0.6), tent.flag || [255, 214, 80]);
    }
  }

  const TENTS = [
    { id: 'tent_box', name: 'Cardboard Fort', price: 90, rarity: 'common', desc: 'Works on my machine.', tent: { style: 'box', c1: [200, 160, 100], c2: [160, 120, 70], trim: [90, 64, 40] } },
    { id: 'tent_canvas', name: 'Canvas Tent', price: 150, rarity: 'common', desc: 'A classic A-frame for classic adventurers.', tent: { style: 'aframe', c1: [214, 196, 150], c2: [180, 160, 116], trim: [90, 70, 50] } },
    { id: 'tent_dome', name: 'Dome Tent', price: 180, rarity: 'common', desc: 'Waterproof, bugproof, not bug-free.', tent: { style: 'dome', c1: [80, 150, 230], c2: [60, 116, 190], trim: [30, 50, 90] } },
    { id: 'tent_teepee', name: 'Teepee', price: 320, rarity: 'rare', set: 'Wild West', desc: 'Painted with the story of your longest quest.', tent: { style: 'teepee', c1: [230, 210, 170], c2: [200, 170, 120], trim: [110, 80, 50] } },
    { id: 'tent_igloo', name: 'Igloo', price: 360, rarity: 'rare', set: 'Frostbound', desc: 'Surprisingly cozy. Surprisingly cold.', tent: { style: 'igloo', c1: [236, 244, 255], c2: [210, 226, 246], trim: [140, 170, 210] } },
    { id: 'tent_circus', name: 'Circus Tent', price: 380, rarity: 'rare', desc: 'Welcome to the standup.', tent: { style: 'striped', c1: [230, 60, 60], c2: [250, 246, 236], trim: [120, 30, 30], flag: [255, 214, 80] } },
    { id: 'tent_royal', name: 'Royal Pavilion', price: 700, rarity: 'epic', desc: 'Silk walls, golden trim, zero bugs allowed.', tent: { style: 'pavilion', c1: [120, 60, 190], c2: [255, 214, 80], trim: [60, 30, 100], flag: [255, 90, 120] } },
  ];

  // ---------- banners ----------

  function drawBanner(s, x, baseY, h, banner, t) {
    const { cloth, trim = [255, 214, 80], emblem = 'star', ink = [255, 255, 255] } = banner;
    const top = baseY - h;
    for (let y = top; y < baseY; y++) s.set(x, y, [96, 70, 44]);
    s.set(x, top - 1, trim); s.set(x - 1, top, trim); s.set(x + 1, top, trim);
    const cw = 8, ch = 11, em = EMBLEMS[emblem] || EMBLEMS.star;
    for (let i = 0; i < cw; i++) {
      const wy = Math.round(Math.sin(t * 0.3 + i * 0.7) * (i / cw) * 1.3);
      const bottom = ch - (i >= 3 && i <= 4 ? 2 : i === 2 || i === 5 ? 1 : 0);
      for (let j = 0; j < bottom; j++) {
        const edge = j === 0 || j === bottom - 1 || i === cw - 1;
        let c = typeof cloth === 'function' ? cloth(i, j, t) : cloth;
        if (edge) c = trim;
        const ex = i - 2, ey = j - 3;
        if (ex >= 0 && ex < 5 && ey >= 0 && ey < 5 && em[ey][ex] === '#') c = ink;
        s.set(x + 1 + i, top + 1 + j + wy, X.shade(c, 1 - (i % 3 === 2 ? 0.1 : 0)));
      }
    }
  }

  const BANNERS = [
    { id: 'bn_heart', name: 'Heart Pennant', price: 110, rarity: 'common', desc: 'Camp is where the heart is.', banner: { cloth: [230, 90, 130], emblem: 'heart' } },
    { id: 'bn_guild', name: 'Guild Standard', price: 120, rarity: 'common', desc: 'Rally the party under one star.', banner: { cloth: [60, 90, 200], emblem: 'star' } },
    { id: 'bn_west', name: 'Horseshoe Flag', price: 140, rarity: 'common', set: 'Wild West', desc: 'Lucky, and a little dusty.', banner: { cloth: [160, 100, 60], emblem: 'shoe', ink: [230, 230, 240] } },
    { id: 'bn_coffee', name: 'Coffee Guild Banner', price: 260, rarity: 'rare', set: 'Night Shift', desc: 'Est. 3 a.m.', banner: { cloth: [90, 56, 34], emblem: 'cup', ink: [250, 240, 220] } },
    { id: 'bn_skull', name: 'Jolly Roger', price: 280, rarity: 'rare', desc: 'Arr. We plunder technical debt.', banner: { cloth: [30, 30, 40], emblem: 'skull', trim: [220, 220, 230] } },
    { id: 'bn_frost', name: 'Frost Standard', price: 300, rarity: 'rare', set: 'Frostbound', desc: 'Winter is compiling.', banner: { cloth: [80, 150, 220], emblem: 'flake', trim: [236, 244, 255] } },
    { id: 'bn_ship', name: 'Ship It Flag', price: 300, rarity: 'rare', set: 'Ship It', desc: 'Raised on every green release.', banner: { cloth: [40, 160, 80], emblem: 'check' } },
    { id: 'bn_bug', name: 'Bug Bounty Banner', price: 500, rarity: 'epic', desc: 'Wanted: dead or alive (preferably fixed).', banner: { cloth: (i, j, t) => ((i + j + (t >> 2)) % 4 ? [230, 60, 60] : [255, 120, 60]), emblem: 'bug', ink: [20, 20, 20] } },
    { id: 'bn_royal', name: 'Royal Standard', price: 900, rarity: 'legendary', desc: 'For the ruler of the repo.', banner: { cloth: (i, j, t) => X.mix([120, 50, 190], [200, 90, 255], 0.5 + 0.5 * Math.sin(t * 0.2 + i * 0.5)), emblem: 'crown', ink: [255, 214, 80] } },
  ];

  // ---------- campfire colors (X.FIRE palette keys F, f, r) ----------

  const FIRES = [
    { id: 'fire_rose', name: 'Rose Fire', price: 150, rarity: 'common', desc: 'Smells faintly of strawberries.', fire: { F: [255, 200, 230], f: [255, 110, 170], r: [200, 50, 120], glow: [255, 110, 170] } },
    { id: 'fire_ember', name: 'Cowboy Coffee Fire', price: 160, rarity: 'common', set: 'Wild West', desc: 'Low and slow, perfect for a pot of joe.', fire: { F: [255, 200, 110], f: [230, 110, 40], r: [160, 50, 20], glow: [230, 120, 40] } },
    { id: 'fire_blue', name: 'Blue Flame', price: 240, rarity: 'rare', set: 'Frostbound', desc: 'Burns hot and looks cool.', fire: { F: [220, 245, 255], f: [90, 170, 255], r: [40, 80, 200], glow: [90, 170, 255] } },
    { id: 'fire_green', name: 'Ghostfire', price: 260, rarity: 'rare', desc: 'Lit by a very polite ghost.', fire: { F: [220, 255, 220], f: [100, 240, 120], r: [30, 150, 70], glow: [100, 240, 120] } },
    { id: 'fire_purple', name: 'Arcane Fire', price: 480, rarity: 'epic', desc: 'Fueled by pure mana (and old tickets).', fire: { F: [240, 210, 255], f: [190, 110, 255], r: [110, 50, 200], glow: [190, 110, 255] } },
    { id: 'fire_gold', name: 'Golden Hearth', price: 520, rarity: 'epic', desc: 'Warms your hands and your purse.', fire: { F: [255, 255, 220], f: [255, 214, 80], r: [220, 150, 40], glow: [255, 214, 80] } },
    { id: 'fire_rainbow', name: 'Prismatic Fire', price: 1000, rarity: 'legendary', desc: 'Every color, all at once, forever.', fire: { rainbow: true, glow: [255, 180, 120] } },
  ];

  // ---------- recruit outfits (guild recruits in your party) ----------

  const OUTFITS = [
    { id: 'of_party', name: 'Party Hats', price: 120, rarity: 'common', desc: 'Every recruit gets a cone. Every day is launch day.',
      outfit: { tint: null, pal: { K, P: [240, 90, 160], Y: [255, 214, 80] }, hat: ['.....K.....', '....KPK....', '...KPYPK...', '..KKKKKKK..'] } },
    { id: 'of_team', name: 'Team Jerseys', price: 150, rarity: 'common', desc: 'Matching blue for the whole squad.',
      outfit: { tint: [60, 120, 230], pal: { K, R: [255, 255, 255] }, hat: ['.KRRRRRRRK.'], hatDy: 2 } },
    { id: 'of_cowboy', name: 'Posse Hats', price: 260, rarity: 'rare', set: 'Wild West', desc: 'Ride with the posse.',
      outfit: { tint: [170, 110, 60], pal: { K, b: [150, 100, 60] }, hat: ['', '...KKKKK...', '...KbbbK...', 'KbbbbbbbbbK'] } },
    { id: 'of_hoodie', name: 'Night Shift Hoodies', price: 280, rarity: 'rare', set: 'Night Shift', desc: 'Hoods up. Headphones on. Ship.',
      outfit: { tint: [70, 76, 92], pal: { K, B: [52, 58, 72], W: [120, 230, 120] }, hat: ['.....K.....', '....KWK....', '...KBBBK...', '..KBBBBBK..'] } },
    { id: 'of_pirate', name: 'Pirate Crew', price: 300, rarity: 'rare', desc: 'Every recruit a scallywag.',
      outfit: { tint: [190, 50, 50], pal: { K, b: [40, 36, 50], W: [240, 236, 224] }, hat: ['', '..K.KKK.K..', '.KbKbWbKbK.', 'KKKKKKKKKKK'] } },
    { id: 'of_frost', name: 'Frost Cloaks', price: 300, rarity: 'rare', set: 'Frostbound', desc: 'Ice-blue cloaks with fur hoods.',
      outfit: { tint: [120, 190, 240], pal: { K, C: [236, 244, 255], c: [170, 210, 240] }, hat: ['', '...KKKKK...', '..KCCCCCK..', '.KCc...cCK.'] } },
    { id: 'of_ship', name: 'Release Crew', price: 560, rarity: 'epic', set: 'Ship It', desc: 'Hard hats on: we\'re deploying.',
      outfit: { tint: [60, 180, 90], pal: { K, Y: [255, 214, 60] }, hat: ['', '....KKK....', '...KYYYK...', '.KKYYYYYKK.'] } },
    { id: 'of_royal', name: 'Royal Guard', price: 600, rarity: 'epic', desc: 'Gold-trimmed, and very serious about it.',
      outfit: { tint: [220, 180, 60], pal: { K, Y: [255, 214, 80], R: [220, 50, 70] }, hat: ['', '..K.K.K.K..', '..KYKYKYK..', '..KYRYRYK..'] } },
  ];

  const slot = (s, list) => list.map((it) => ({ ...it, slot: s }));
  return {
    items: [
      ...slot('hat', HATS), ...slot('back', BACKS), ...slot('aura', AURAS), ...slot('pet', PETS), ...slot('weapon', WEAPONS), ...slot('buff', BUFFS),
      ...slot('trail', TRAILS), ...slot('mount', MOUNTS), ...slot('tent', TENTS), ...slot('banner', BANNERS), ...slot('fire', FIRES), ...slot('outfit', OUTFITS),
    ],
    drawTent, drawBanner, blitRows,
  };
}

module.exports = { build };
