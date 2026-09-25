'use strict';
// Shop items: cosmetics bought with gold that show on the hero, plus
// consumable battle buffs. drawEquipment is called by sprites.drawHero right
// after the body is drawn; "behind" layers (auras, wings, capes) only paint
// pixels outside the hero's silhouette so they read as sitting behind it.

const X = require('./pixel');

// Lazy requires: sprites.js loads this file lazily, and state.js loads sprites.
const sprites = () => require('./sprites');
const character = () => require('./character');
const uiState = () => require('./state').ui;

const RARITY = {
  common: { name: 'Common', color: [190, 198, 214] },
  rare: { name: 'Rare', color: [86, 164, 255] },
  epic: { name: 'Epic', color: [196, 112, 255] },
  legendary: { name: 'Legendary', color: [255, 172, 44] },
};

const SLOTS = ['hat', 'back', 'aura', 'pet', 'weapon', 'buff'];
const SLOT_NAMES = { hat: 'Hats', back: 'Back', aura: 'Auras', pet: 'Pets', weapon: 'Weapon glow', buff: 'Buffs' };
const K = [22, 18, 30];

// ---------- drawing helpers ----------

// Draw palette rows at local (ox, oy); `behind` skips the hero silhouette.
function rowsAt(o, rows, pal, ox, oy, behind = false) {
  rows.forEach((row, j) => {
    for (let i = 0; i < row.length; i++) {
      const c = pal[row[i]];
      if (!c) continue;
      if (behind) o.behind(ox + i, oy + j, c); else o.set(ox + i, oy + j, c);
    }
  });
}

const RAINBOW = [[236, 64, 72], [250, 146, 48], [252, 222, 70], [84, 200, 96], [70, 150, 250], [150, 96, 236]];
const twinkle = (t, k, a, b) => X.mix(a, b, 0.5 + 0.5 * Math.sin(t * 0.45 + k * 1.7));

// ---------- hats (16 wide, drawn over the head; the head is x 4-11, y 5-12) ----------

const HATS = [
  { id: 'party', name: 'Party Hat', price: 60, rarity: 'common', desc: 'Every quest is a celebration.',
    pal: { K, P: [240, 90, 160], Y: [255, 214, 80], W: [255, 255, 255] },
    rows: ['.......WW.......', '.......KK.......', '......KPPK......', '......KYYK......', '.....KPPPPK.....', '.....KYYYYK.....', '....KPPPPPPK....'] },
  { id: 'flower', name: 'Flower Crown', price: 90, rarity: 'common', desc: 'Freshly picked from the forest biome.',
    pal: { P: [255, 140, 196], R: [244, 76, 88], B: [120, 176, 255], o: [255, 232, 96], g: [64, 160, 70], G: [120, 214, 96] },
    rows: ['', '', '', '', '........R.......', '...P...RoR..B...', '..PoPgG.R.GBoB..', '...PgGgGgGgGBg..'] },
  { id: 'tophat', name: 'Top Hat', price: 140, rarity: 'common', desc: 'Dapper. Refined. Slightly too tall.',
    pal: { K, b: [44, 40, 56], c: [70, 64, 88], R: [200, 50, 64] },
    rows: ['', '....KKKKKKKK....', '....KccbbbbK....', '....KcbbbbbK....', '....KcbbbbbK....', '....KRRRRRRK....', '..KKcbbbbbbbKK..', '..KKKKKKKKKKKK..'] },
  { id: 'pirate', name: 'Pirate Hat', price: 260, rarity: 'rare', desc: 'Arr. Plunder those bugs.',
    pal: { K, b: [40, 36, 50], c: [64, 58, 80], W: [240, 236, 224], Y: [236, 188, 64] },
    rows: ['', '', '', '......KKKK......', '..KK.KbbbbK.KK..', '.KcbKbbWWbbKbcK.', '.KcbbbWKKWbbbcK.', 'KcbbbbbWWbbbbbcK', 'KYYYYYYYYYYYYYYK', '.KK..........KK.'] },
  { id: 'wizardstars', name: 'Wizard Hat of Stars', price: 320, rarity: 'rare', desc: 'Woven from a clear night sky.',
    pal: { K, N: [52, 62, 160], n: [80, 92, 200], s: [255, 232, 120], Y: [255, 200, 70] },
    rows: ['..........K.....', '.........KsK....', '.........KNK....', '........KNsK....', '.......KsNNK....', '......KNNNsNK...', '.....KYYYYYYK...', '.KnnnnnnnnnnnnK.', '..KKKKKKKKKKKK..'],
    anim(o, t) { // twinkling stars
      [[10, 1], [10, 3], [8, 4], [10, 5]].forEach(([dx, dy], k) => o.set(dx, dy, twinkle(t, k, [150, 140, 90], [255, 250, 200])));
    } },
  { id: 'horned', name: 'Horned Helm', price: 360, rarity: 'rare', desc: 'Forged in the lava biome.',
    pal: { K, W: [240, 232, 212], w: [188, 172, 146], 7: [226, 230, 240], 8: [160, 166, 182], 9: [98, 102, 120], Y: [232, 186, 62], o: [150, 110, 40] },
    rows: ['', '.W............W.', '.WK..........KW.', '.WwK..KKKK..KwW.', '..wwKK7788KKww..', '...wK778889Kw...', '...K77788889K...', '..KYoYYoYYoYYK..', '..KKKKKKKKKKKK..', '.......88.......'] },
  { id: 'crown', name: 'Royal Crown', price: 650, rarity: 'epic', desc: 'Heavy is the head that ships to prod.',
    pal: { K, Y: [255, 210, 70], y: [196, 136, 36], W: [255, 248, 210], R: [232, 52, 84], B: [70, 150, 255] },
    rows: ['', '....K..KK..K....', '...KYKKYYKKYK...', '...KYYKYYKYYK...', '...KWYYYYYYYK...', '...KYRYBBYRYK...', '...KyyyyyyyyK...'],
    anim(o, t) { // a glint runs across the band
      const g = (t >> 1) % 24;
      if (g < 8) o.set(4 + g, 4, [255, 255, 255]);
    } },
  { id: 'halo', name: 'Halo', price: 1200, rarity: 'legendary', desc: 'For heroes with zero failed builds.',
    pal: {},
    rows: [],
    draw(o, t) {
      const b = Math.round(Math.sin(t * 0.2));
      const gold = [255, 222, 110], hi = [255, 250, 210], lo = [214, 160, 50];
      o.glow(7.5, 2 + b, 8, [255, 230, 140], 0.4);
      for (let dx = 5; dx <= 10; dx++) { o.set(dx, 1 + b, dx === 6 || dx === 7 ? hi : gold); o.set(dx, 3 + b, lo); }
      o.set(4, 2 + b, gold); o.set(11, 2 + b, lo);
    } },
];

// ---------- back items ----------

const WING_L = [ // local x from -6; mirrored for the right wing
  '.K.........', 'KWK........', 'KWWK.......', 'KWWWK......', 'KWwWWK.....', '.KWwWWK....', '.KWWwWWK...',
  '..KWWwWWK..', '..KwWWwWWK.', '...KwWWKKK.', '...KwWK....', '....KK.....',
];

const BACKS = [
  { id: 'jetpack', name: 'Jetpack', price: 380, rarity: 'rare', desc: 'Twin boosters. Flames included.', swatchY: 11,
    draw(o, t) {
      const pal = { K, R: [214, 60, 60], 7: [176, 184, 204], 8: [124, 132, 154], 9: [84, 88, 108], Y: [255, 200, 60] };
      rowsAt(o, ['.KKKKK.', 'KRRRRRK', 'K77788K', 'K77888K', 'KYYYYYK', 'K77888K', 'K78889K', '.K999K.', '..KKK..'], pal, -3, 11, true);
      const fl = [[255, 250, 200], [255, 200, 60], [255, 120, 40], [200, 50, 30]];
      const n = 3 + ((t >> 1) % 3);
      for (let k = 0; k < n; k++) for (let dx = -2; dx <= 0; dx++) {
        if (k > 1 && dx !== -1 && X.hash(dx, k + t) > 0.5) continue;
        o.behind(dx, 20 + k, fl[Math.min(3, k)]);
      }
      o.glow(-1, 22, 5, [255, 150, 60], 0.35);
    } },
  { id: 'rainbowcape', name: 'Rainbow Cape', price: 600, rarity: 'epic', desc: 'Shimmers with every color of the spectrum.', swatchY: 13,
    draw(o, t) {
      for (let dy = 13; dy <= 23; dy++) {
        const trail = Math.round((dy - 13) * 0.7 + Math.sin(t * 0.3 + dy * 0.6) * (dy > 15 ? 1.2 : 0));
        const left = 2 - trail, right = 13;
        for (let dx = left; dx <= right; dx++) {
          const edge = dx === left || dy === 23;
          const c = RAINBOW[(((dy - 13) >> 1) + (t >> 2)) % 6];
          o.behindBody(dx, dy, edge ? X.shade(c, 0.45) : X.mix(c, [255, 255, 255], (dx + dy + (t >> 1)) % 9 === 0 ? 0.5 : 0));
        }
      }
    } },
  { id: 'wings', name: 'Angel Wings', price: 1100, rarity: 'legendary', desc: 'Lighter than air, softer than a green build.', swatchY: 6,
    draw(o, t) {
      const pal = { K: [70, 70, 96], W: [250, 250, 255], w: [196, 206, 236] };
      const lift = [0, 1, 2, 1][(t >> 2) % 4];
      rowsAt(o, WING_L, pal, -6, 5 + lift, true);
      WING_L.forEach((row, j) => { for (let i = 0; i < row.length; i++) if (pal[row[i]]) o.behind(15 - (i - 6), 5 + lift + j, pal[row[i]]); });
      o.glowBehind(7.5, 11, 13, [220, 230, 255], 0.22);
    } },
];

// ---------- auras (behind the hero, with rim light on its outline) ----------

const AURAS = [
  { id: 'sparkle', name: 'Sparkle Aura', price: 300, rarity: 'rare', desc: 'Twinkling stars follow you everywhere.',
    draw(o, t) {
      o.field((dx, dy, d) => { if (d <= 2) o.mixBehind(dx, dy, [255, 200, 240], 0.18 * (1 - d / 3)); });
      const cols = [[255, 240, 140], [255, 150, 220], [140, 230, 255]];
      for (let k = 0; k < 6; k++) {
        const cycle = (t + k * 5) / 14 | 0, life = (t + k * 5) % 14;
        const sx = Math.round(-4 + X.hash(k, cycle) * 23), sy = Math.round(-2 + X.hash(cycle, k + 9) * 26);
        const c = cols[(k + cycle) % 3], big = life > 3 && life < 10;
        o.behind(sx, sy, big ? [255, 255, 255] : c);
        if (big) [[1, 0], [-1, 0], [0, 1], [0, -1]].forEach(([a, b]) => o.behind(sx + a, sy + b, c));
      }
      o.rim([255, 220, 250], 0.2);
    } },
  { id: 'fire', name: 'Fire Aura', price: 550, rarity: 'epic', desc: 'You are, quite literally, on fire.',
    draw(o, t) {
      const red = [220, 50, 30], orange = [255, 140, 30], yellow = [255, 236, 120];
      o.field((dx, dy, d, up) => {
        // Tongues of flame: per-column heights that flicker and rise.
        const n = 0.5 * X.hash(dx, (t >> 1) + Math.floor(dy / 3)) + 0.5 * X.hash(dx >> 1, t >> 2);
        const reach = up ? 1.5 + n * 5 : 0.8 + n * 1.6;
        const k = 1 - d / reach;
        if (k <= 0 || X.hash(dx * 7 + t, dy) > 0.35 + k) return;
        o.mixBehind(dx, dy, k > 0.6 ? yellow : k > 0.3 ? orange : red, 0.3 + 0.65 * k);
      });
      for (let k = 0; k < 4; k++) { // embers
        const life = (t + k * 7) % 18, ex = Math.round(2 + X.hash(k, (t + k * 7) / 18 | 0) * 12);
        o.behind(ex + Math.round(Math.sin((t + k) * 0.5)), 12 - life, life < 9 ? yellow : orange);
      }
      o.rim([255, 150, 50], 0.3);
    } },
  { id: 'frost', name: 'Frost Aura', price: 550, rarity: 'epic', desc: 'A cold snap follows your every step.',
    draw(o, t) {
      o.field((dx, dy, d) => {
        if (d > 3) return;
        const n = X.hash(dx + (t >> 2), dy);
        o.mixBehind(dx, dy, n > 0.93 ? [255, 255, 255] : [150, 220, 255], 0.5 * (1 - d / 3.5));
      });
      for (let k = 0; k < 7; k++) { // drifting snowflakes
        const life = (t + k * 9) % 30, cyc = (t + k * 9) / 30 | 0;
        const sx = Math.round(-4 + X.hash(k, cyc) * 23 + Math.sin((t + k * 4) * 0.2)), sy = -2 + life;
        o.behind(sx, sy, [235, 248, 255]);
        if (k % 3 === 0) { o.behind(sx - 1, sy, [170, 220, 255]); o.behind(sx + 1, sy, [170, 220, 255]); }
      }
      o.rim([180, 236, 255], 0.35);
    } },
  { id: 'shadow', name: 'Shadow Aura', price: 900, rarity: 'legendary', desc: 'Darkness curls around you like smoke.',
    draw(o, t) {
      o.field((dx, dy, d, up) => {
        const n = 0.5 * X.hash(dx >> 1, Math.floor((dy + t * 0.6) / 2)) + 0.5 * X.hash(dx, t >> 3);
        const reach = up ? 2 + n * 5 : 1.2 + n * 2.2;
        const k = 1 - d / reach;
        if (k <= 0 || X.hash(dx + t, dy * 3) > 0.4 + k) return;
        o.mixBehind(dx, dy, k > 0.55 ? [120, 50, 190] : [26, 8, 44], 0.45 + 0.5 * k);
      });
      for (let k = 0; k < 3; k++) { // wisps
        const life = (t + k * 11) % 20, wx = Math.round(1 + X.hash(k, (t + k * 11) / 20 | 0) * 14);
        o.behind(wx + Math.round(Math.sin((t + k * 3) * 0.3) * 1.5), 10 - life, [170, 90, 255]);
      }
      o.rim([190, 110, 255], 0.35);
    } },
];

// ---------- pets (to the hero's left; they walk or hover) ----------

const PETS = [
  { id: 'slime', name: 'Slime Buddy', price: 150, rarity: 'common', desc: 'Bounces happily. Slightly sticky.', ground: true,
    draw(o, t) {
      const pal = { K, G: [110, 220, 110], g: [60, 160, 70], W: [220, 255, 220], E: [20, 30, 20] };
      const ph = (t >> 2) % 4;
      const hop = [0, 2, 3, 1][ph];
      const rows = ph === 0
        ? ['..KKKKK..', '.KGWGGGK.', 'KGGEGEGGK', 'KgGGGGGgK', '.KKKKKKK.']
        : ['...KKK...', '..KWGGK..', '.KGEGEGK.', '.KGGGGGK.', '.KgGGGgK.', '..KKKKK..'];
      rowsAt(o, rows, pal, -10, 24 - rows.length - hop);
    } },
  { id: 'cat', name: 'Cat', price: 200, rarity: 'common', desc: 'Judges your code. Purrs anyway.', ground: true,
    draw(o, t) {
      const pal = { K, O: [242, 152, 64], o: [196, 108, 40], W: [255, 236, 214], E: [40, 30, 20], p: [255, 140, 160] };
      const step = (t >> 2) % 2, tail = (t >> 3) % 2;
      const rows = [
        tail ? 'K.....K.K.' : '.K....K.K.',
        tail ? 'KO...KOKOK' : '.KO..KOKOK',
        '.KO..KEOEK',
        '..KOOOOpOK',
        '..KOoOoWWK',
        '..KOOOOOK.',
        step ? '..KK.KK...' : '...KK.KK..',
      ];
      rowsAt(o, rows, pal, -11, 17);
    } },
  { id: 'owl', name: 'Owl', price: 280, rarity: 'rare', desc: 'Wise, silent, and always watching the logs.',
    draw(o, t) {
      const pal = { K, B: [150, 110, 70], b: [110, 76, 46], W: [250, 240, 220], E: [30, 20, 10], Y: [255, 200, 60], c: [220, 200, 170] };
      const flap = (t >> 2) % 2, bob = Math.round(Math.sin(t * 0.25));
      const blink = t % 50 < 3;
      const rows = [
        '.K....K.',
        '.KBKKBK.',
        blink ? 'KBKKKKBK' : 'KWEWWEWK',
        'KBWYYWBK',
        flap ? 'bKBccBKb' : 'KbBccBbK',
        flap ? '.KBccBK.' : 'KbBccBbK',
        '..KBBK..',
        '..Y..Y..',
      ];
      rowsAt(o, rows, pal, -10, 2 + bob);
    } },
  { id: 'robot', name: 'Robot', price: 520, rarity: 'epic', desc: 'Beep boop. Runs your tests for fun.',
    draw(o, t) {
      const pal = { K, M: [190, 200, 216], m: [130, 138, 160], C: [90, 230, 255], R: [255, 80, 80] };
      const bob = Math.round(Math.sin(t * 0.3)), led = (t >> 3) % 2;
      rowsAt(o, ['....K...', '...KRK..', '..KKKKK.', '.KMMMMMK', '.KMCMCMK', '.KmMMMmK', '..KKKKK.', '...KmK..'], pal, -11, 3 + bob);
      if (led) o.set(-7, 4 + bob, [255, 220, 220]);
      const fl = (t >> 1) % 2 ? [255, 220, 90] : [255, 140, 40];
      o.set(-8, 11 + bob, fl); o.set(-8, 12 + bob, [255, 100, 40]);
      o.glow(-8, 10 + bob, 4, [120, 230, 255], 0.25);
    } },
  { id: 'dragon', name: 'Dragon Whelp', price: 950, rarity: 'legendary', desc: 'Tiny, fierce, and fond of snacks.',
    draw(o, t) {
      const pal = { K, G: [90, 200, 110], g: [50, 140, 80], Y: [255, 214, 90], E: [255, 240, 120], W: [160, 236, 170], R: [255, 110, 60] };
      const up = (t >> 2) % 2, bob = Math.round(Math.sin(t * 0.3) * 1.5);
      const rows = up ? [
        '..K.........',
        '.KWK........',
        '.KWgK...KK..',
        '..KgGK.KGGK.',
        '...KGGGGEGK.',
        'K.KGYYGGGGGK',
        'KGGYYGGK.KK.',
        '.KKK.KK.....',
      ] : [
        '............',
        '............',
        '........KK..',
        '...KKK.KGGK.',
        '..KWgGGGEGK.',
        'K.KWgYGGGGGK',
        'KGGKYGGK.KK.',
        '.KKK.KK.....',
      ];
      rowsAt(o, rows, pal, -12, 3 + bob);
      if (t % 40 < 6) { o.set(0, 8 + bob, pal.R); o.set(1, 8 + bob, [255, 220, 90]); o.glow(1, 8 + bob, 3, [255, 150, 60], 0.4); }
    } },
];

// ---------- weapon glows (at the weapon's tip; the weapon is drawn on top) ----------

// Where each class weapon's business end sits, in the 16×24 box.
const WEAPON_TIP = { staff: [14, 4], bow: [15, 14], sword: [14, 11], familiar: [17, 7], lute: [14, 14], daggers: [14, 16] };

function weaponTip(ch, pose) {
  const C = character();
  const weapon = (C.CLASSES[ch.cls] || C.CLASSES.mage).weapon;
  const [ax, ay] = WEAPON_TIP[weapon] || [13, 18];
  return [ax, pose === 'cheer' && (weapon === 'staff' || weapon === 'sword') ? ay - 4 : ay];
}

function weaponGlow(core, hot, cold) {
  return function draw(o, t) {
    const [ax, ay] = weaponTip(o.ch, o.pose);
    o.glow(ax, ay, 8, core, 0.55 + 0.12 * Math.sin(t * 0.4));
    for (let k = 0; k < 6; k++) {
      const life = (t + k * 4) % 12;
      o.set(ax + Math.round(Math.sin(t * 0.3 + k * 2) * 2), ay - life + 2, life < 4 ? hot : life < 8 ? core : cold);
    }
  };
}

const WEAPONS = [
  { id: 'wfire', name: 'Flame Enchant', price: 240, rarity: 'rare', desc: 'Your weapon smoulders with embers.', draw: weaponGlow([255, 140, 40], [255, 240, 150], [200, 60, 30]) },
  { id: 'wfrost', name: 'Frost Enchant', price: 240, rarity: 'rare', desc: 'Icy mist drifts from your weapon.', draw: weaponGlow([120, 210, 255], [240, 252, 255], [70, 130, 220]) },
  { id: 'wvoid', name: 'Void Enchant', price: 480, rarity: 'epic', desc: 'A sliver of the abyss clings to it.', draw: weaponGlow([170, 70, 255], [240, 200, 255], [60, 20, 110]) },
];

// ---------- consumable buffs (never XP: XP only comes from real Claude usage) ----------

const BUFFS = [
  { id: 'whetstone', name: 'Whetstone', price: 40, rarity: 'common', desc: '+25% damage for 3 waves.', buff: { dmg: 1.25, waves: 3 },
    icon: { pal: { K, G: [150, 150, 164], g: [104, 104, 120], W: [220, 222, 236] }, rows: ['', '.........W......', '....KKKKKWKK....', '...KWWGGGGGGK...', '...KGGGGGGGgK...', '...KgggggggK....', '....KKKKKKK.....'] } },
  { id: 'luckycharm', name: 'Lucky Charm', price: 60, rarity: 'rare', desc: 'Double gold for 3 waves.', buff: { gold: 2, waves: 3 },
    icon: { pal: { K, G: [80, 200, 90], g: [40, 140, 60], Y: [255, 214, 80] }, rows: ['......KK.KK.....', '.....KGGKGGK....', '.....KGgGgGK....', '...KKKGGYGGKKK..', '..KGGgYYYYYgGGK.', '...KKKGGYGGKKK..', '.....KGgKgGK....', '......KKgKK.....', '........gK......', '.........K......'] } },
  { id: 'wardrum', name: 'War Drum', price: 90, rarity: 'rare', desc: '+50% damage for 2 waves.', buff: { dmg: 1.5, waves: 2 },
    icon: { pal: { K, R: [200, 60, 60], r: [140, 40, 40], W: [240, 228, 200], Y: [236, 188, 64] }, rows: ['..K.........K...', '...K.......K....', '....KKKKKKKK....', '...KWWWWWWWWK...', '...KRYRRYRRYK...', '...KRRYRRYRRK...', '...KrrrrrrrrK...', '....KKKKKKKK....'] } },
];

const withSlot = (slot, list) => list.map((it) => ({ ...it, slot }));
const CATALOG = [
  ...withSlot('hat', HATS), ...withSlot('back', BACKS), ...withSlot('aura', AURAS),
  ...withSlot('pet', PETS), ...withSlot('weapon', WEAPONS), ...withSlot('buff', BUFFS),
];
const BY_ID = Object.fromEntries(CATALOG.map((it) => [it.id, it]));
const getItem = (id) => BY_ID[id] || null;

// ---------- hero silhouette (for behind-layers and auras) ----------

const BEARD = { 11: '.....hhhhhh.....', 12: '.....KhhhhK.....', 13: '......KhhK......' };
const BLINK_ROW = '....KSTSSTSK....';
const overlay = (base, top) => { if (!top) return base; let s = ''; for (let i = 0; i < base.length; i++) s += top[i] && top[i] !== '.' ? top[i] : base[i]; return s; };
const classHead = (ch) => { const C = character(); return sprites().HEADS[(C.CLASSES[ch.cls] || C.CLASSES.mage).head] || []; };

// Body rows without class headgear (what shows once a hat replaces it).
function bodyRows(ch, pose, t) {
  const P = sprites().POSES;
  const rows = (P[pose] || P.stand).slice();
  if (pose !== 'hurt' && (t % 45) < 2) rows[10] = BLINK_ROW;
  return ch.accessory === 'beard' ? rows.map((r, i) => overlay(r, BEARD[i])) : rows;
}

const maskCache = new Map();
function silhouette(ch, pose, t, hat) {
  const key = `${ch.cls}|${ch.accessory}|${pose}|${(t % 45) < 2}|${hat ? hat.id : ''}`;
  if (maskCache.has(key)) return maskCache.get(key);
  const head = hat ? hat.rows || [] : classHead(ch);
  const rows = bodyRows(ch, pose, t).map((r, i) => overlay(r, head[i]));
  const on = new Set();
  rows.forEach((r, j) => { for (let i = 0; i < r.length; i++) if (r[i] !== '.') on.add(`${i},${j}`); });
  const body = new Set(on);
  if (ch.accessory === 'cape') for (let j = 13; j < 24; j++) for (let i = 1; i < 15; i++) on.add(`${i},${j}`);
  // Distance from every nearby outside pixel to the silhouette, and whether
  // the silhouette lies below it (flames and smoke rise).
  const pts = [...on].map((s) => s.split(',').map(Number));
  const dist = [];
  for (let dy = -6; dy < 27; dy++) for (let dx = -6; dx < 22; dx++) {
    if (on.has(`${dx},${dy}`)) continue;
    let d = 99, up = false;
    for (const [i, j] of pts) {
      const e = Math.hypot(i - dx, (j - dy) * 0.9);
      if (e < d) { d = e; up = j > dy + 1; }
    }
    if (d <= 7) dist.push([dx, dy, d, up]);
  }
  const edge = pts.filter(([i, j]) => !on.has(`${i - 1},${j}`) || !on.has(`${i + 1},${j}`) || !on.has(`${i},${j - 1}`) || !on.has(`${i},${j + 1}`));
  const res = { on, body, dist, edge };
  if (maskCache.size > 200) maskCache.clear();
  maskCache.set(key, res);
  return res;
}

// ---------- equipment ----------

function equipped(ch) {
  const e = (ch && ch.equipped) || {};
  const out = {};
  for (const slot of SLOTS) { const it = getItem(e[slot]); if (it && it.slot === slot) out[slot] = it; }
  return out;
}

// Called by sprites.drawHero after the body. x, y = top-left of the 16×24 box.
function drawEquipment(pc, ch, { x, y, px, pal, t = 0, pose = 'stand', flip = false } = {}) {
  const eq = equipped(ch);
  if (!Object.keys(eq).length) return;
  if (!px) px = (dx) => (flip ? x + 15 - dx : x + dx);
  const sil = silhouette(ch, pose, t, eq.hat);
  const inBody = (dx, dy) => sil.on.has(`${dx},${dy}`);
  const inPc = (X0, Y0) => X0 >= 0 && Y0 >= 0 && X0 < pc.w && Y0 < pc.h;
  const o = {
    ch, pose, flip, pal,
    set: (dx, dy, c) => pc.set(px(dx), y + dy, c),
    behind: (dx, dy, c) => { if (!inBody(dx, dy)) pc.set(px(dx), y + dy, c); },
    // Like behind, but paints over the class cape (for items that replace it).
    behindBody: (dx, dy, c) => { if (!sil.body.has(`${dx},${dy}`)) pc.set(px(dx), y + dy, c); },
    mixBehind: (dx, dy, c, a) => {
      const X0 = Math.round(px(dx)), Y0 = Math.round(y + dy);
      if (inBody(dx, dy) || !inPc(X0, Y0)) return;
      pc.set(X0, Y0, X.mix(pc.get(X0, Y0), c, Math.min(1, a)));
    },
    glow: (dx, dy, r, c, s) => pc.glow(px(dx), y + dy, r, c, s),
    glowBehind: (dx, dy, r, c, s) => {
      for (let j = -r; j <= r; j++) for (let i = -r; i <= r; i++) {
        const d = Math.hypot(i, j * 1.1) / r;
        if (d < 1) o.mixBehind(Math.round(dx + i), Math.round(dy + j), c, s * (1 - d) * (1 - d));
      }
    },
    field: (fn) => { for (const [dx, dy, d, up] of sil.dist) fn(dx, dy, d, up); },
    rim: (c, a) => { for (const [dx, dy] of sil.edge) { const X0 = px(dx), Y0 = y + dy; if (inPc(X0, Y0)) pc.set(X0, Y0, X.mix(pc.get(X0, Y0), c, a)); } },
  };
  if (eq.aura) eq.aura.draw(o, t);
  if (eq.back) eq.back.draw(o, t);
  if (eq.hat) drawHat(pc, ch, eq.hat, o, { y, px, pal, t, pose });
  if (eq.pet) eq.pet.draw(o, t);
  if (eq.weapon) eq.weapon.draw(o, t);
}

// A hat replaces the class headgear: repaint those pixels with the bare head
// (or the backdrop, estimated from just outside the hero box), then the hat.
function drawHat(pc, ch, hat, o, { y, px, pal, t, pose }) {
  const body = bodyRows(ch, pose, t);
  const sample = (X0, Y0) => (X0 >= 0 && Y0 >= 0 && X0 < pc.w && Y0 < pc.h ? pc.get(X0, Y0) : null);
  classHead(ch).forEach((row, dy) => {
    if (!row) return;
    const a = sample(px(-1), y + dy), b = sample(px(16), y + dy);
    for (let dx = 0; dx < row.length; dx++) {
      if (row[dx] === '.') continue;
      const k = body[dy] && body[dy][dx];
      if (k && k !== '.' && pal[k]) { o.set(dx, dy, pal[k]); continue; }
      const l = a || b, r = b || a;
      if (l) o.set(dx, dy, X.mix(l, r, dx / 15));
    }
  });
  if (hat.rows && hat.rows.length) rowsAt(o, hat.rows, hat.pal, 0, 0);
  if (hat.anim) hat.anim(o, t);
  if (hat.draw) hat.draw(o, t);
}

// ---------- swatches (item art for shop cards) ----------

// Draw an item into a 20×10 pixel area at (ox, oy). Hats, back items, auras
// and weapon glows are shown on a crop of the given hero; pets and buffs alone.
function drawSwatch(pc, item, hero, ox, oy, t = 0) {
  if (item.slot === 'buff') { rowsAt({ set: (dx, dy, c) => pc.set(ox + 2 + dx, oy + dy, c) }, item.icon.rows, item.icon.pal, 0, 0); return; }
  if (item.slot === 'pet') {
    const sx = ox + 14, sy = oy - (item.ground ? 14 : 2);
    const o = { ch: hero, pose: 'stand', set: (dx, dy, c) => pc.set(sx + dx, sy + dy, c), glow: (dx, dy, r, c, s) => pc.glow(sx + dx, sy + dy, r, c, s) };
    o.behind = o.behindBody = o.set;
    item.draw(o, t);
    return;
  }
  const ch = { ...hero, equipped: { [item.slot]: item.id } };
  const tipY = weaponTip(hero, 'stand')[1];
  const off = item.swatchY ?? ({ hat: 0, back: 9, aura: 3, weapon: Math.max(0, Math.min(14, tipY - 5)) }[item.slot] || 0);
  sprites().drawHero(pc, ch, ox + 2, oy - off, { t, pose: 'stand' });
}

// ---------- buffs ----------

function buffs() { const ui = uiState(); return (ui.buffs ||= []); }

// Stack a consumable onto ui.buffs (buying the same one extends it).
function addBuff(id) {
  const it = getItem(id);
  if (!it || !it.buff) return false;
  const list = buffs();
  const cur = list.find((b) => b.id === id);
  if (cur) cur.waves += it.buff.waves; else list.push({ id, waves: it.buff.waves });
  return true;
}

// Call once per wave cleared: counts buffs down and drops expired ones.
function consumeWave() {
  const ui = uiState();
  ui.buffs = buffs().map((b) => ({ ...b, waves: b.waves - 1 })).filter((b) => b.waves > 0);
}

const buffOf = (b) => (getItem(b.id) || {}).buff || {};
const damageMultiplier = () => buffs().reduce((m, b) => m * (buffOf(b).dmg || 1), 1);
const goldMultiplier = () => buffs().reduce((m, b) => m * (buffOf(b).gold || 1), 1);

module.exports = {
  RARITY, SLOTS, SLOT_NAMES, CATALOG, getItem, equipped, drawEquipment, drawSwatch,
  buffs, addBuff, consumeWave, damageMultiplier, goldMultiplier,
};
