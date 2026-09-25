'use strict';
// Monster sprites, biome rosters, bosses and drawing (walk cycles, attack
// wind-ups, hit flashes, elemental tints and per-type death animations).
// Owned by the battle system; battle.js drives the per-monster state fields.

const X = require('./pixel');

// ---------- sprites ----------
// Shaded monster sprites, facing left (toward the hero). Keys: K outline,
// h highlight, G body, g shadow, d deep shadow (per type), plus shared keys:
// W bone/teeth, R red eyes, E glowing eyes, Y gold, b wood, M metal, m dark
// metal, F/O flame, r plume, C ice/soul glow, P magic, S/s stem, L/l leaves.
// Optional per-type fields: fly, hop, death (splat | spiral | collapse |
// topple | poof | dissolve), atk (wind-up frame), ghost (flickers).

const shiftRows = (rows, from, to, n) => rows.map((r, i) => (i >= from && i <= to ? ('.'.repeat(n) + r).slice(0, r.length) : r));
const withRows = (rows, edits) => rows.map((r, i) => (edits[i] !== undefined ? edits[i] : r));

// ----- dungeon -----
const SLIME = [
  ['.....KKKK.....', '...KKhhhGKK...', '..KhhGGGGGgK..', '.KhGGGGGGGGgK.', '.KGGWWGGGWWgK.', 'KGGGWKGGGWKGgK', 'KGGGGGGGGGGGgK', 'KGGGGKKKKGGggK', 'KgGGGGGGGGggdK', '.KggggggggddK.', '..KKKKKKKKKK..'],
  ['..............', '.....KKKK.....', '..KKKhhhGKKK..', '.KhhGGGGGGGgK.', 'KhGGWWGGGWWGgK', 'KGGGWKGGGWKGgK', 'KGGGGGGGGGGGgK', 'KGGGGKKKKGGggK', 'KgGGGGGGGGggdK', 'KgggggggggdddK', '.KKKKKKKKKKKK.'],
];
const BAT = [
  ['K.............K', 'KK...........KK', 'KgK..K...K..KgK', 'KggK.KKKKK.KggK', 'KgggKGRGRGKgggK', '.KggKGGGGGKggK.', '..KK.KGWGK.KK..', '......KKK......'],
  ['...............', '.....K...K.....', '.....KKKKK.....', '.KKKKGRGRGKKKK.', 'KgggKGGGGGKgggK', 'KggK.KGWGK.KggK', 'KgK...KKK...KgK', 'K.............K'],
];
const SKELETON = [
  ['...KKKKKK...', '..KWWWWWgK..', '..KWKWWKgK..', '..KWRWWRgK..', '..KWWWWWgK..', '...KWKWKK...', '....KWWK....', '..KKWWWWKK.M', '.KWKgWWgKWKM', '.KWKKWWKKWKM', '..K.KWWK.KYY', '....KggK..b.', '...KW..WK...', '...KW..WK...', '..KWK..KWK..', '..KK....KK..'],
  ['...KKKKKK...', '..KWWWWWgK..', '..KWKWWKgK..', '..KWRWWRgK..', '..KWWWWWgK..', '...KWKWKK...', '....KWWK..M.', '..KKWWWWKKM.', '.KWKgWWgKWM.', '.KWKKWWKKYY.', '..K.KWWK.bK.', '....KggK....', '...KW..WK...', '..KW....WK..', '.KWK....KWK.', '.KK......KK.'],
];
const SKELETON_ATK = withRows(SKELETON[0], { 6: '....KWWK...M', 7: '..KKWWWWKK.M', 8: '.KWKgWWgKWKM', 9: '.KWKKWWKKWYY', 10: '..K.KWWK.Kb.' });
const GOBLIN = [
  ['.K.........K.', 'KhK.KKKKK.KgK', 'KhGKhGGGGKGgK', '.KGGGGGGGGgK.', '..KGYKGGYKgK.', '..KGGGGGGGgK.', '..KGKWKWKgK.b', '...KKGGgKK.bb', '..KbbbbbbbKbb', '.KGKbbbbbKGK.', '.KGKbbbbbK.K.', '...KGK.KgK...', '...KKK.KKK...'],
  ['.K.........K.', 'KhK.KKKKK.KgK', 'KhGKhGGGGKGgK', '.KGGGGGGGGgK.', '..KGYKGGYKgK.', '..KGGGGGGGgK.', '..KGKKKKKgK..', '...KKGGgKKbb.', '..KbbbbbbbKbbb', '.KGKbbbbbKGK.', '.KGKbbbbbK.K.', '..KGK...KgK..', '..KKK...KKK..'],
];
const GOBLIN_ATK = withRows(GOBLIN[0], { 5: '..KGGGGGGGgKb', 6: '..KGKWKWKgKbb', 7: '...KKGGgKK.bb', 8: '..KbbbbbbbK..' });

// ----- forest -----
const WOLF_A = [
  '...K.K............',
  '..KhKhK........K..',
  '..KhGGGK......KgK.',
  '.KGGRGGhKKKKKKKgK.',
  'KGGGGGGhhhhhhhhGgK',
  'WKKGGGGGGGGGGGGGgK',
  '.KWKGGGGGGGGGGGggK',
  '..KKgGGgggggggKgK.',
  '...KgGK.KggK.KgK..',
  '...KgK...KgK.KgK..',
  '...KK....KK..KK...',
];
const WOLF = [WOLF_A, withRows(WOLF_A, { 5: 'KKKGGGGGGGGGGGGGgK', 6: '.KKKGGGGGGGGGGGggK', 8: '..KgK..KgK..KgK...', 9: '..KK...KgK..KgK...', 10: '.......KK...KK....' })];
const WOLF_ATK = withRows(WOLF_A, { 1: '.KhKhK.........K..', 2: '.KhGGGK.......KgK.', 5: 'WKKGGGGGGGGGGGGGgK', 6: 'W.KWGGGGGGGGGGGggK', 7: 'WKKKgGGgggggggKgK.' });
const SHROOM_A = [
  '....KKKK....',
  '..KKhWGGKK..',
  '.KhWWGGGWgK.',
  'KhGGGGGWWGgK',
  'KGWGGGGGGGgK',
  'KgGGGWGGGggK',
  '.KKKKKKKKKK.',
  '..KSSSSSsK..',
  '..KSKSSKsK..',
  '..KSSSSSsK..',
  '..KSSKKSsK..',
  '...KSSSsK...',
  '..KKK..KKK..',
];
const SHROOM = [SHROOM_A, ['............', ...SHROOM_A.slice(0, 7), '..KSKSSKsK..', '..KSSSSSsK..', '..KSSKKSsK..', '...KSSSsK...', '...KK.KKK...']];
const TREANT_A = [
  '....KKKKKK....',
  '..KKLLLLllKK..',
  '.KLLLlLLYLllK.',
  'KLLlLLLLlLLllK',
  'KLLLYLlLLLLllK',
  '.KlLLLLLLLllK.',
  '..KKKGGGgKKK..',
  '.KK.KGGGgK.KK.',
  'KgGKKEGGEgKKgK',
  '.KGGGGGGGGGgK.',
  '..KKGKKKKgKK..',
  '...KGGGGGgK...',
  '...KGgGGggK...',
  '...KGGgGGgK...',
  '..KGGK..KggK..',
  '.KKKK....KKKK.',
];
const TREANT = [TREANT_A, withRows(shiftRows(TREANT_A, 0, 5, 1), { 14: '...KGK..KgK...', 15: '..KKKK..KKKK..' })];
const TREANT_ATK = withRows(TREANT_A, { 6: 'KK.KKGGGgKK.KK', 7: 'KgK.KGGGgK.KgK', 8: '.KGKKEGGEgKKK.' });

// ----- lava -----
const IMP = [
  ['..K.......K..', '..WK.....KW..', '...WKKKKKW...', '..KhGGGGGgK..', 'K.KGEKGEKgK.K', 'dKKGGGGGGgKKd', 'ddKKGWGWgKKdd', 'dddKKGGgKKddd', '.dKGGGGGGgKd.', '..KGKGGGKgK..', '...KgKGKgK...', '....KK.KK.F..', '........KFOF.'],
  ['..K.......K..', '..WK.....KW..', '...WKKKKKW...', '..KhGGGGGgK..', '..KGEKGEKgK..', '..KGGGGGGgK..', '.KKKGWGWgKKK.', 'KddKKGGgKKddK', 'KddKGGGGGgKdK', '..KGKGGGKgK..', '...KgKGKgK...', '....KK.KK..F.', '........KOFO.'],
];
const FIREBAT = [
  ['O......F......O', 'KO....FOF....OK', 'KgO..KOKOK..OgK', 'KggOKKKKKKKOggK', 'KgggKGEGEGKgggK', '.KggKGGGGGKggK.', '..KK.KGWGK.KK..', '......KKK......'],
  ['......F.F......', '.....KOFOK.....', '.....KKKKK.....', '.KKKKGEGEGKKKK.', 'KgggKGGGGGKgggK', 'KggO.KGWGK.OggK', 'KgO...KKK...OgK', 'O.............O'],
];
const GOLEM_A = [
  '......KKKKK......',
  '.....KhGGGgK.....',
  '.....KFKGKFK.....',
  '..KKKKGOOOgKKKK..',
  '.KhGGKKgggKKGGgK.',
  'KhGGOGhGGGGgGOGgK',
  'KGGOGGGGOGGGGGOgK',
  'KGgKGGOOGGGgKgGgK',
  'KgdKGGGGOGGgKdgdK',
  'KOFKgGGGGGggKFOK.',
  '.KK.KggOgggK.KK..',
  '....KgGKKGgK.....',
  '...KGGgK.KGgK....',
  '...KgOgK.KgOgK...',
  '..KKKKK..KKKKKK..',
];
const GOLEM = [GOLEM_A, withRows(GOLEM_A, { 6: 'KGGOGGGGFGGGGGOgK', 7: 'KGgKGGFFGGGgKgGgK', 12: '...KGGgK..KGgK...', 13: '..KgOgK...KgOgK..', 14: '..KKKKK...KKKKK..' })];
const GOLEM_ATK = withRows(GOLEM_A, { 3: 'KKKKKKGOOOgKKKK..', 4: 'KFOKKKKgggKKGGgK.', 5: 'KOFGOGhGGGGgGOGgK', 9: '.KKKgGGGGGggKFOK.' });

// ----- castle -----
const KNIGHT_A = [
  '.....rrr......',
  '....KrrK......',
  '....KhGGgK....',
  '...KhGGGGgK...',
  '...KKRKKRKK...',
  '...KhGGGGgK..M',
  '..KKKGGGgKKK.M',
  '.KYYKhGGGgKGKM',
  'KYrrYKGGGgKGKM',
  'KYrrYKGGGgKKYY',
  'KYrrYKmmmmK.b.',
  '.KYYKGGKGgK...',
  '..KK.KGKGgK...',
  '....KGGKGgK...',
  '....KGK.KgK...',
  '...KKK..KKK...',
];
const KNIGHT = [KNIGHT_A, withRows(KNIGHT_A, { 13: '....KGGKGgK...', 14: '...KGK...KgK..', 15: '...KK....KKK..' })];
const KNIGHT_ATK = withRows(KNIGHT_A, { 3: '...KhGGGGgK.M.', 4: '...KKRKKRKKM..', 5: '...KhGGGGgKM..', 6: '..KKKGGGgKKM..', 7: '.KYYKhGGGgKYY.', 8: 'KYrrYKGGGgKbK.', 9: 'KYrrYKGGGgKK..' });
const WRAITH_A = [
  '....KKKKK....',
  '...KhGGGgK...',
  '..KhGKKKGgK..',
  '..KGKCKCKgK..',
  '..KGKKKKKgK..',
  '.KhGGKKKGggK.',
  'KWKGGGGGGgKWK',
  'KWKhGGGGGgKWK',
  '.K.KGGGGggK.K',
  '...KGGGGggK..',
  '...KgGGgddK..',
  '....KgGgdK...',
  '.....KgdK....',
  '......KK.....',
];
const WRAITH = [WRAITH_A, withRows(WRAITH_A, { 11: '...KgGgdK....', 12: '..KgdK.......', 13: '..KK.........' })];
const GARGOYLE = [
  ['KK....K..K....KK', 'KgK...WKKW...KgK', 'KggK.KhGGgK.KggK', 'KgggKGRGGRgKgggK', '.KggKGGGGGgKggK.', '.KgggKWKWKKgggK.', '..KgKhGGGGgKgK..', '...KKGGGGGGgKK..', '....KGgGGgGgK...', '...KWKGGGGgKWK..', '...KKKgK.KgKKK..', '....KWK...KWK...'],
  ['......K..K......', '......WKKW......', '.....KhGGgK.....', '....KGRGGRgK....', '.KKKKGGGGGgKKKK.', 'KgggKKWKWKKKgggK', 'KggKKhGGGGgKKggK', 'KgK.KGGGGGGgKKgK', 'K...KGgGGgGgK..K', '...KWKGGGGgKWK..', '...KKKgK.KgKKK..', '....KWK...KWK...'],
];

// ----- bosses (drawn at 2x) -----
const ELDER_A = [
  '...KK.KKKK.KK...',
  '..KLLKLLYLKLlK..',
  '.KLLLLLlLLLLLlK.',
  'KLLlLLLLLLlLYllK',
  'KLLLYLLLLLLLLllK',
  '.KlLLKKKKKKLllK.',
  'KK.KKGGGGGgKK.KK',
  'KgKKGEKGGKEgKKgK',
  '.KGGGGGGGGGGGgK.',
  '..KKGKWKWKWgKK..',
  '...KGKKKKKKgK...',
  '...KGGGgGGGgK...',
  '..KGGgGGGgGggK..',
  '.KGGK.KGgK.KggK.',
  'KKKK..KKKK..KKKK',
];
const ELDER = [ELDER_A, withRows(shiftRows(ELDER_A, 0, 4, 1), { 6: 'KK.KKGGGGGgKK.KK', 13: '.KGGK..KGgK.KggK', 14: 'KKKK...KKKK.KKKK' })];
const ELDER_ATK = withRows(ELDER_A, { 5: 'KKlLLKKKKKKLllKK', 6: 'KgKKKGGGGGgKKKgK', 7: '.KGKGEKGGKEgKgK.' });
const DRAKE_A = [
  '...........K...K..',
  '..KK......KdK.KdK.',
  '.KhGK....KddKKddK.',
  'KhGEGK..KdddKdddK.',
  'KGGGGGK.KddddddK..',
  'WKKGGGGKKdddddK...',
  'KWKKGGGGGKKKKK....',
  '.K..KGGhOOhGGGK...',
  '....KGhOOOOhGGgK..',
  '....KGhOOOOhGGgK..',
  '....KGGhOOhGGGgKKK',
  '....KGGGhhGGGggKgK',
  '...KGGgKKKKKgGgKgK',
  '...KgOK....KgOKgK.',
  '..KKKK....KKKKKK..',
];
const DRAKE_B = withRows(DRAKE_A, {
  0: '..................', 1: '..KK..............', 2: '.KhGK.............', 3: 'KhGEGK...KKKK.KK..',
  4: 'KGGGGGK.KddddKddK.', 5: 'OKKGGGGKKdddddddK.', 6: 'FOKKGGGGGKddddddK.', 7: 'OK..KGGhOOhKKddK..', 8: '....KGhOOOOhGKKK..',
});
const DRAKE = [DRAKE_A, DRAKE_B];
const LICH_A = [
  '.Y.Y.Y.......P..',
  '.YYYYY......PCP.',
  '.KKKKKK......P..',
  'KWWWWWgK.....b..',
  'KWKKWKKK.....b..',
  'KWCKWCKK.....b..',
  'KWWWWWgK.....b..',
  '.KWKWKK......b..',
  'KKGGGGGKK...Wb..',
  'KGhGGGGGgKKKWb..',
  'KGKhGGGGgKWWKb..',
  '.KKGGYGGgKKK.b..',
  '..KGGGGGggK..b..',
  '.KGGGGGGgggK.b..',
  'KGGGGGGGggggKb..',
  'KKKKKKKKKKKKKK..',
];
const LICH = [LICH_A, withRows(LICH_A, { 0: '.Y.Y.Y......PPP.', 1: '.YYYYY.....PCCCP', 2: '.KKKKKK......PPP', 13: '.KGGGGGGgggK.b..', 14: 'KGGGGGGGgggggKb.', 15: '.KKKKKKKKKKKKKb.' })];
const LICH_ATK = withRows(LICH_A, { 0: '.Y.Y.Y.....PPP..', 1: '.YYYYY....PCCCP.', 2: '.KKKKKK...PCCCP.', 3: 'KWWWWWgK...PPPb.' });

const MONSTERS = {
  slime: { name: 'Slime', hp: 12, xp: 2, speed: 0.35, hop: true, death: 'splat', frames: SLIME },
  bat: { name: 'Bat', hp: 9, xp: 2, speed: 0.6, fly: true, death: 'spiral', frames: BAT },
  skeleton: { name: 'Skeleton', hp: 18, xp: 4, speed: 0.3, death: 'collapse', frames: SKELETON, atk: SKELETON_ATK },
  goblin: { name: 'Goblin', hp: 22, xp: 3, speed: 0.4, death: 'topple', frames: GOBLIN, atk: GOBLIN_ATK },
  wolf: { name: 'Dire Wolf', hp: 30, xp: 3, speed: 0.75, death: 'flop', frames: WOLF, atk: WOLF_ATK },
  shroom: { name: 'Sporeling', hp: 34, xp: 3, speed: 0.3, hop: true, death: 'poof', frames: SHROOM },
  treant: { name: 'Treant', hp: 56, xp: 5, speed: 0.2, death: 'topple', frames: TREANT, atk: TREANT_ATK },
  imp: { name: 'Fire Imp', hp: 44, xp: 4, speed: 0.6, fly: true, death: 'dissolve', frames: IMP },
  firebat: { name: 'Fire Bat', hp: 36, xp: 3, speed: 0.75, fly: true, death: 'spiral', frames: FIREBAT },
  golem: { name: 'Magma Golem', hp: 90, xp: 6, speed: 0.2, death: 'collapse', frames: GOLEM, atk: GOLEM_ATK },
  knight: { name: 'Dark Knight', hp: 110, xp: 6, speed: 0.3, death: 'topple', frames: KNIGHT, atk: KNIGHT_ATK },
  wraith: { name: 'Wraith', hp: 80, xp: 5, speed: 0.5, fly: true, ghost: true, death: 'dissolve', frames: WRAITH },
  gargoyle: { name: 'Gargoyle', hp: 95, xp: 5, speed: 0.45, fly: true, death: 'collapse', frames: GARGOYLE },
  // Bosses: hp is the reference HP at level 1; battle.js scales it to the hero's damage.
  boss: { name: 'Goblin Warlord', hp: 300, xp: 60, speed: 0.25, boss: true, death: 'topple', frames: GOBLIN, atk: GOBLIN_ATK },
  elder: { name: 'Elderbark the Ancient', hp: 320, xp: 80, speed: 0.2, boss: true, death: 'topple', frames: ELDER, atk: ELDER_ATK },
  drake: { name: 'Ignarok the Magma Drake', hp: 340, xp: 100, speed: 0.3, boss: true, death: 'collapse', frames: DRAKE, atk: DRAKE_B },
  lich: { name: 'The Lich King', hp: 360, xp: 120, speed: 0.25, boss: true, death: 'dissolve', frames: LICH, atk: LICH_ATK },
};

// Biome rosters (weakest first) and the boss that guards each biome.
const ROSTERS = {
  dungeon: ['slime', 'bat', 'goblin', 'skeleton'],
  forest: ['wolf', 'shroom', 'treant'],
  lava: ['imp', 'firebat', 'golem'],
  castle: ['wraith', 'gargoyle', 'knight'],
};
const BOSSES = { dungeon: 'boss', forest: 'elder', lava: 'drake', castle: 'lich' };

const CROWN = ['.Y.Y.Y.', '.YYYYY.', '.KKKKK.'];
const MONSTER_COLORS = {
  slime: [{ G: [104, 208, 96], g: [60, 150, 64], d: [34, 96, 44], h: [200, 255, 190] }, { G: [96, 160, 240], g: [60, 110, 196], d: [36, 64, 130], h: [200, 230, 255] }, { G: [236, 110, 170], g: [186, 70, 126], d: [120, 40, 84], h: [255, 210, 235] }],
  bat: [{ G: [120, 84, 150], g: [84, 56, 112], d: [50, 32, 70], h: [170, 140, 200] }],
  skeleton: [{ G: [220, 214, 196], g: [150, 144, 130], d: [96, 92, 84], h: [255, 255, 245] }],
  goblin: [{ G: [124, 176, 70], g: [82, 124, 46], d: [50, 80, 30], h: [180, 220, 120] }, { G: [180, 140, 70], g: [130, 96, 44], d: [80, 60, 28], h: [220, 190, 120] }],
  wolf: [{ G: [136, 140, 156], g: [92, 94, 112], d: [58, 58, 74], h: [200, 204, 218] }, { G: [150, 110, 76], g: [104, 74, 50], d: [66, 46, 32], h: [206, 166, 120] }],
  shroom: [{ G: [216, 64, 60], g: [150, 36, 40], d: [96, 20, 28], h: [255, 150, 130] }, { G: [150, 90, 210], g: [100, 56, 150], d: [60, 32, 96], h: [210, 170, 255] }],
  treant: [{ G: [128, 88, 54], g: [88, 58, 36], d: [56, 36, 24], h: [170, 124, 80] }],
  imp: [{ G: [232, 76, 52], g: [168, 44, 36], d: [104, 28, 34], h: [255, 160, 120] }],
  firebat: [{ G: [170, 50, 40], g: [110, 30, 30], d: [70, 20, 24], h: [230, 110, 70] }],
  golem: [{ G: [96, 80, 76], g: [66, 54, 52], d: [40, 32, 32], h: [140, 120, 110] }],
  knight: [{ G: [150, 156, 176], g: [96, 100, 122], d: [60, 62, 80], h: [220, 226, 244] }, { G: [96, 92, 120], g: [62, 58, 84], d: [38, 36, 54], h: [150, 146, 180] }],
  wraith: [{ G: [104, 88, 150], g: [68, 54, 106], d: [40, 30, 66], h: [168, 150, 214] }],
  gargoyle: [{ G: [146, 148, 160], g: [98, 100, 114], d: [62, 64, 78], h: [196, 198, 210] }],
  boss: [{ G: [196, 70, 60], g: [140, 44, 40], d: [90, 26, 26], h: [240, 140, 120] }],
  elder: [{ G: [104, 72, 50], g: [72, 48, 34], d: [44, 30, 22], h: [150, 110, 76], L: [70, 150, 70], l: [40, 100, 50], E: [150, 255, 120] }],
  drake: [{ G: [196, 58, 40], g: [136, 34, 30], d: [96, 26, 34], h: [255, 150, 90] }],
  lich: [{ G: [96, 50, 140], g: [64, 32, 98], d: [40, 20, 64], h: [150, 100, 200] }],
};
const MONSTER_BASE = {
  K: [20, 16, 26], W: [236, 232, 218], R: [255, 64, 56], E: [255, 226, 110], Y: [255, 206, 70], b: [124, 82, 48], M: [196, 202, 216],
  m: [110, 114, 132], F: [255, 238, 150], O: [255, 138, 40], r: [200, 50, 44], C: [140, 240, 255], P: [196, 128, 255],
  S: [238, 218, 180], s: [186, 160, 122], L: [100, 180, 76], l: [58, 120, 50],
};

const DEATH_TICKS = 14, BOSS_DEATH_TICKS = 28;
const scaleOf = (m) => m.scale || (m.boss ? 2 : 1);
const frameSize = (rows) => [rows.reduce((a, r) => Math.max(a, r.length), 0), rows.length];
const monsterSize = (m) => {
  const def = MONSTERS[m.type] || MONSTERS.slime;
  const [fw, fh] = frameSize(def.frames[0]);
  const S = scaleOf(m);
  return [fw * S, fh * S];
};
const paletteFor = (m) => {
  const colors = MONSTER_COLORS[m.type] || MONSTER_COLORS.slime;
  return { ...MONSTER_BASE, ...colors[(m.color || 0) % colors.length] };
};
const deathTicks = (m) => (m.boss ? BOSS_DEATH_TICKS : DEATH_TICKS);

// Paint sprite rows at (x, y) with block scale S. Options: tint, flip, alpha
// (stable dither), off(i, j) -> [dx, dy] per source pixel, or a transform
// (angle in radians, sx/sy scale) around the pivot (px, py), in pixels
// relative to (x, y).
function paint(pc, rows, pal, x, y, S, o = {}) {
  const [fw, fh] = frameSize(rows);
  const alpha = o.alpha == null ? 1 : o.alpha, seed = o.seed || 0, tint = o.tint;
  const color = (k) => (tint ? X.mix(pal[k], tint[0], tint[1]) : pal[k]);
  const visible = (i, j) => alpha >= 1 || X.hash(i * 3 + seed, j * 5 + seed * 7) < alpha;
  const col = (i) => (o.flip ? fw - 1 - i : i);
  x = Math.round(x); y = Math.round(y);
  const sx = o.sx || 1, sy = o.sy || 1, a = o.angle || 0;
  if (!a && sx === 1 && sy === 1) {
    for (let j = 0; j < fh; j++) {
      const row = rows[j];
      for (let i = 0; i < row.length; i++) {
        const k = row[i];
        if (k === '.' || !pal[k] || !visible(i, j)) continue;
        const [ox, oy] = o.off ? o.off(i, j) : [0, 0];
        pc.rect(x + col(i) * S + ox, y + j * S + oy, S, S, color(k));
      }
    }
    return;
  }
  const Wd = fw * S, Hd = fh * S, cos = Math.cos(a), sin = Math.sin(a);
  const pvx = o.px == null ? Wd / 2 : o.px, pvy = o.py == null ? Hd : o.py;
  let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
  for (const [cx, cy] of [[0, 0], [Wd, 0], [0, Hd], [Wd, Hd]]) {
    const u = (cx - pvx) * sx, v = (cy - pvy) * sy;
    const X2 = u * cos - v * sin + pvx, Y2 = u * sin + v * cos + pvy;
    x0 = Math.min(x0, X2); x1 = Math.max(x1, X2); y0 = Math.min(y0, Y2); y1 = Math.max(y1, Y2);
  }
  for (let Y = Math.floor(y0); Y <= Math.ceil(y1); Y++) {
    for (let Xd = Math.floor(x0); Xd <= Math.ceil(x1); Xd++) {
      const u = Xd + 0.5 - pvx, v = Y + 0.5 - pvy;
      const lx = (u * cos + v * sin) / sx + pvx, ly = (-u * sin + v * cos) / sy + pvy;
      if (lx < 0 || ly < 0 || lx >= Wd || ly >= Hd) continue;
      const i = Math.floor(lx / S), j = Math.floor(ly / S);
      const k = rows[j][col(i)];
      if (!k || k === '.' || !pal[k] || !visible(i, j)) continue;
      pc.set(x + Xd, y + Y, color(k));
    }
  }
}

function drawShadow(pc, x, y, w, strength) {
  if (y < 0 || y >= pc.h) return;
  for (let dx = 1; dx < w - 1; dx++) {
    const px = x + dx;
    if (px < 0 || px >= pc.w) continue;
    pc.set(px, y, X.shade(pc.get(px, y) || [0, 0, 0], strength));
  }
}

function drawMonster(pc, m, t, { target = false } = {}) {
  const def = MONSTERS[m.type];
  if (!def) return;
  const pal = paletteFor(m);
  const S = scaleOf(m);
  const [w, h] = monsterSize(m);
  const at = m.at != null ? m.at : t;
  if (m.hp <= 0 && m.dieT != null) return drawDeath(pc, m, def, pal, S, w, h);
  const x = Math.round(m.x), y = Math.round(m.y + (m.yOff || 0));

  let frame;
  if ((m.windup > 0 || (m.slam && m.slam.t > 2)) && def.atk) frame = def.atk;
  else {
    const rate = def.fly ? 1 : m.walking ? 2 : 3;
    frame = def.frames[((at >> rate) + (m.seed || 0)) % def.frames.length];
  }
  let dx = 0, dy = 0;
  if (m.windup > 0) dx += (m.flip ? -1 : 1) * (1 + (at & 1)); // rear back and shiver
  if (m.walking && def.hop && ((at >> 2) + (m.seed || 0)) % 2) dy -= S;
  if (m.shock > 0) dx += at & 1 ? 1 : -1;

  let tint = null;
  if (m.flash > 0) tint = [[255, 255, 255], (m.flash >= 3 ? 0.85 : 0.5) * (m.boss ? 0.55 : 1)];
  else if (m.shock > 0) tint = [[190, 230, 255], 0.6];
  else if (m.windup > 0) tint = [[255, 70, 50], at & 1 ? 0.45 : 0.2];
  else if (m.frozen > 0) tint = [[150, 225, 255], m.boss ? 0.3 : 0.5];
  else if (m.burn > 0 && at & 2) tint = [[255, 140, 40], 0.3];
  else if (m.curse > 0 && at & 2) tint = [[170, 80, 230], 0.3];
  else if (m.enraged) tint = [[255, 40, 30], 0.28 + 0.14 * Math.sin(at * 0.6)];

  // Soft shadow on the floor (flyers get a fainter one).
  const floor = m.floorY != null ? m.floorY : def.fly ? Math.round(m.baseY + h + 8) : Math.round(m.y) + h;
  drawShadow(pc, x, Math.min(pc.h - 1, floor), w, def.fly || m.yOff < -2 ? 0.8 : 0.55);
  if (target) pc.glow(x + w / 2, y + h / 2, Math.max(w, h), [255, 80, 60], 0.12);
  if (m.elite) pc.glow(x + w / 2, y + h / 2, Math.max(w, h), [255, 210, 80], 0.2);
  if (m.boss) pc.glow(x + w / 2, y + h / 2, Math.max(w, h) * 0.8, m.enraged ? [255, 50, 30] : pal.h, m.enraged ? 0.3 : 0.12);
  const ghostA = def.ghost ? 0.78 + 0.22 * Math.sin(at * 0.3) : 1;
  paint(pc, frame, pal, x + dx, y + dy, S, { tint, flip: m.flip, alpha: ghostA, seed: at >> 1 });
  if (m.type === 'boss') paint(pc, CROWN, pal, x + dx + Math.floor(w / 2) - 3 * S, y + dy - 3 * S, S, { tint });
  if (m.elite && !m.boss) pc.sprite(x + dx + Math.floor(w / 2) - 3, y + dy - 3, CROWN, pal);

  // Elemental overlays.
  if (m.frozen > 0) for (let k = 0; k < 4; k++) {
    const ix = x + Math.round(X.hash(k, m.seed || 0) * (w - 1)), iy = y + Math.round(X.hash(m.seed || 0, k + 9) * (h - 1));
    pc.set(ix, iy, [230, 250, 255]); pc.set(ix, iy - 1, [150, 225, 255]);
  }
  if (m.burn > 0) for (let k = 0; k < 3; k++) {
    const fx = x + 1 + Math.round(X.hash(k + at, m.seed || 0) * (w - 3));
    pc.set(fx, y + dy - 1 - ((at + k) % 3), (at + k) % 2 ? [255, 220, 90] : [255, 120, 40]);
  }
  if (m.taunt > 0 && at & 4) pc.label(Math.round(x + w / 2), Math.max(0, Math.floor((y - 8) / 2)), '!', [120, 190, 255], true);

  // Outlined HP bar (bosses get the big one from battle.js).
  if (m.boss) return;
  const bw = Math.max(10, w), bx = x + Math.floor((w - bw) / 2), by = y - (m.elite ? 7 : 4);
  const ratio = Math.max(0, m.hp / m.max);
  const barCol = ratio > 0.6 ? [110, 230, 100] : ratio > 0.3 ? [250, 210, 70] : [255, 80, 70];
  const edge = m.elite ? [255, 206, 70] : pal.K;
  for (let i = -1; i <= bw; i++) { pc.set(bx + i, by - 1, edge); pc.set(bx + i, by + 2, edge); }
  for (let i = 0; i < bw; i++) for (let j = 0; j < 2; j++) pc.set(bx + i, by + j, i < Math.round(bw * ratio) ? X.shade(barCol, j ? 0.75 : 1) : [54, 44, 60]);
  pc.set(bx - 1, by, edge); pc.set(bx - 1, by + 1, edge); pc.set(bx + bw, by, edge); pc.set(bx + bw, by + 1, edge);
}

const easeIn = (k) => k * k;
const bounce = (k) => (k < 0.75 ? easeIn(k / 0.75) : 1 - 0.12 * Math.sin(((k - 0.75) / 0.25) * Math.PI));

// Per-type death animations; m.dieT counts ticks since the killing blow.
function drawDeath(pc, m, def, pal, S, w, h) {
  const p = Math.min(1, m.dieT / deathTicks(m));
  const frame = def.frames[0];
  const x = Math.round(m.x), y = Math.round(m.y);
  const ground = m.floorY != null ? m.floorY : y + h;
  const fade = p < 0.55 ? 1 : Math.max(0, 1 - (p - 0.55) / 0.45);
  const flash = p < 0.12 ? [[255, 255, 255], 0.85] : null;
  const seed = (m.seed || 0) * 13 + 5;
  const fallTo = (k) => y + (ground - h - y) * k;
  const style = m.boss && def.death !== 'dissolve' ? 'boss' : def.death || 'topple';
  const collapse = (k, yy, a) => {
    const [fw, fh] = frameSize(frame);
    paint(pc, frame, pal, x, yy, S, {
      alpha: a, seed, tint: flash,
      off: (i, j) => {
        const tj = fh - 1 - Math.floor((fh - 1 - j) * 0.28);
        const r = X.hash(i + seed, j * 3 + seed);
        return [Math.round(((i - fw / 2) * 0.22 + (r - 0.5) * 2) * k) * S, Math.round((tj - j) * k) * S];
      },
    });
  };
  switch (style) {
    case 'splat': {
      const k = Math.min(1, p * 2.6);
      paint(pc, frame, pal, x, y, S, { sx: 1 + 0.7 * k, sy: Math.max(0.16, 1 - 0.84 * k), px: w / 2, py: h, alpha: fade, seed, tint: flash });
      break;
    }
    case 'spiral': {
      const k = Math.min(1, p * 1.5);
      paint(pc, frame, pal, x + Math.round(Math.sin(p * 14) * 3), fallTo(easeIn(k)), S, { angle: p * Math.PI * 5, px: w / 2, py: h / 2, alpha: fade, seed, tint: flash || [[30, 20, 40], 0.35 * k] });
      break;
    }
    case 'collapse': {
      const drop = def.fly ? Math.min(1, p * 3) : 1;
      const k = def.fly ? Math.max(0, (p - 0.3) / 0.7) : p;
      collapse(easeIn(Math.min(1, k * 1.7)), def.fly ? fallTo(easeIn(drop)) : y, fade);
      break;
    }
    case 'poof': {
      const k = Math.min(1, p * 1.4);
      paint(pc, frame, pal, x, y, S, { sx: 1 + 0.25 * Math.sin(k * Math.PI) - 0.6 * k, sy: 1 - 0.7 * k, px: w / 2, py: h, alpha: 1 - p, seed, tint: flash || [[255, 255, 255], 0.4 * k] });
      break;
    }
    case 'flop': { // roll onto its back, legs up
      const k = Math.min(1, p * 2.4);
      paint(pc, frame, pal, x, y + Math.round(k * h * 0.25), S, { sy: Math.cos(k * Math.PI) || 0.01, px: w / 2, py: h / 2, alpha: fade, seed, tint: flash });
      break;
    }
    case 'dissolve': {
      paint(pc, frame, pal, x, y - Math.round(p * 8 * S), S, { alpha: 1 - p, seed, tint: flash || [[255, 250, 230], 0.5 * p] });
      break;
    }
    case 'boss': {
      // Shudder and flash, then crumble into a heap.
      if (p < 0.45) {
        const j = m.dieT & 1 ? 1 : -1;
        paint(pc, frame, pal, x + j * S, y, S, { tint: m.dieT & 2 ? [[255, 255, 255], 0.75] : [[255, 90, 40], 0.3] });
      } else if (def.death === 'topple') {
        const k = Math.min(1, (p - 0.45) / 0.35);
        paint(pc, frame, pal, x, y, S, { angle: bounce(k) * Math.PI / 2, px: w, py: h, alpha: fade, seed });
      } else collapse(easeIn(Math.min(1, (p - 0.45) / 0.35)), y, fade);
      break;
    }
    default: { // topple: tip over backwards around the rear foot, bounce, fade
      const k = Math.min(1, p * 2.2);
      paint(pc, frame, pal, x, y, S, { angle: bounce(k) * Math.PI / 2, px: w, py: h, alpha: fade, seed, tint: flash });
    }
  }
}

module.exports = { MONSTERS, MONSTER_COLORS, ROSTERS, BOSSES, drawMonster, monsterSize, paletteFor, deathTicks, paint };
