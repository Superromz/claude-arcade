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
const frameSize = (rows) => [rows.reduce((a, r) => Math.max(a, r.length), 0), rows.length];

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

// ----- more regulars (two per biome) -----
// Rows are padded to the widest row so flipped sprites stay aligned.
const norm = (rows) => { const w = frameSize(rows)[0]; return rows.map((r) => r.padEnd(w, '.')); };

const RAT_A = norm([
  '..KK.............',
  '.KhhK..KKKKKK....',
  'KhGGKKKhhhhGGK...',
  'KGRGGGhGGGGGGgK..',
  'WGGGGGGGGGGGGGgK.',
  '.KKGGGGGGGGGGggKK',
  '..KKgggggggggKKdK',
  '...KgK.KgK.KgK.dK',
  '...KK..KK..KK...K',
]);
const RAT = [RAT_A, withRows(RAT_A, { 7: '..KgK..KgK..KgKdK', 8: '..KK...KK...KK..K' })];
const RAT_ATK = withRows(RAT_A, { 4: 'W.KGGGGGGGGGGGgK.', 5: 'WKKGGGGGGGGGGggKK' });

const MIMIC_A = norm([
  '..............',
  '.KKKKKKKKKKKK.',
  'KhGGGGGGGGGGgK',
  'KhGGGGYYGGGGgK',
  'KMMMMMYYMMMMmK',
  'KdEdddddddEddK',
  'KMMMMMMMMMMMmK',
  'KGGGGGGGGGGGgK',
  'KGGGGKYYKGGGgK',
  'KgGGGGGGGGGggK',
  'KMMMMMMMMMMMmK',
  '.KKKKKKKKKKKK.',
]);
const MIMIC_B = norm([
  '.KKKKKKKKKKKK.',
  'KhGGGGGGGGGGgK',
  'KMMMMMYYMMMMmK',
  'KWdWdWdWdWdWdK',
  'KdEdddddddEddK',
  'KddrrrrrrrdddK',
  'KdWdWdWdWdWdWK',
  'KMMMMMMMMMMMmK',
  'KGGGGKYYKGGGgK',
  'KgGGGGGGGGGggK',
  'KMMMMMMMMMMMmK',
  '.KKKKKKKKKKKK.',
]);
const MIMIC = [MIMIC_A, MIMIC_A, MIMIC_B, MIMIC_A];
const MIMIC_ATK = withRows(MIMIC_B, { 5: 'rrrrrrrrrrdddK', 6: 'KrWdWdWdWdWdWK' });

const SPIDER_A = norm([
  '.......KKK.......',
  '.....KKhGgKK.....',
  '..K.KhGYGYGgK.K..',
  '.K.KKGhGYGGgKK.K.',
  'K.K.KGGGGGGgK.K.K',
  'K.KKRGRGGRGRgKK.K',
  '.K..KGGGGGGgK..K.',
  '.K.K.KKWKWKK.K.K.',
  'K..K.........K..K',
]);
const SPIDER = [SPIDER_A, withRows(SPIDER_A, { 4: '.KK.KGGGGGGgK.KK.', 7: '..KK.KKWKWKK.KK..', 8: '.K..K.......K..K.' })];
const SPIDER_ATK = withRows(SPIDER_A, { 6: '.K..KGGWGWGgK..K.', 7: '.K.K.KKWKWKK.K.K.', 8: 'K..K..W...W..K..K' });

const BOAR_A = norm([
  '.......KKKKKKK....',
  '..K.KKdddddddKK...',
  '.KhKhGdhhhhhhGgK..',
  'KhGGGGGGGGGGGGGgK.',
  'KGRGGGhGGGGGGGGggK',
  'KGGGGGGGGGGGGGGggK',
  'WWKGGGGGGGGGGGgggK',
  'KWKKgGGgggggGggdK.',
  '.K.KgGK.KggKKgK...',
  '...KgK...KgK.KgK..',
  '...KK....KK..KK...',
]);
const BOAR = [BOAR_A, withRows(BOAR_A, { 8: '.K.KgK..KgK..KgK..', 9: '..KgK..KgK..KgK...', 10: '..KK...KK...KK....' })];
const BOAR_ATK = withRows(BOAR_A, { 3: 'KhGGGGGGGGGGGGGgK.', 4: 'KGRGGGhGGGGGGGGggK', 5: 'WGGGGGGGGGGGGGGggK', 6: 'WWKGGGGGGGGGGGgggK', 7: 'WWKKgGGgggggGggdK.' });

const SALA_A = norm([
  '.KKKK....F.F.F....',
  'KhGGhK..KOKOKOK...',
  'KGEGGGKKhhhhhhGK..',
  'KGGGGGGGGOGGGOGgK.',
  'KrrGGGGGGGGGGGGggK',
  '.KKKgGGgggggGGgggK',
  '..KgK.KgK..KgKKKgK',
  '..KK..KK...KK..KK.',
]);
const SALA = [SALA_A, withRows(SALA_A, { 0: '.KKKK...F.F.F.....', 1: 'KhGGhK..KFKFKFK...', 6: '.KgK..KgK..KgK.KgK', 7: '.KK...KK...KK..KK.' })];
const SALA_ATK = withRows(SALA_A, { 3: 'KGGGGGGGGOGGGOGgK.', 4: 'OFrrGGGGGGGGGGGggK', 5: 'FOKKgGGgggggGGgggK' });

const WISP_A = norm([
  '.....h......',
  '....hG..h...',
  '..h.GGh.G...',
  '...GGhhGG.h.',
  '..GGhWWhGG..',
  '.gGhWKWKhGg.',
  '.gGhWWWWhGg.',
  '.ggGhhhhGgg.',
  '..dgGGGGgd..',
  '...dggggd...',
  '....dgd.....',
  '.....d......',
]);
const WISP = [WISP_A, withRows(WISP_A, { 0: '......h.....', 1: '..h..Gh.....', 2: '...hGG..hG..', 3: '..GGhhGGG...', 10: '.....dgd....', 11: '......d.....' })];

const CULTIST_A = norm([
  '....KKKK....',
  '...KhGGgK...',
  '..KhGGGGgK..',
  '..KGKKKKgK..',
  '..KGKEEKgK..',
  '..KGKKKKgK..',
  '.KhGGGGGggK.',
  'KPKhGGGGGgK.',
  'PCPKGGYGGgK.',
  'KPKGGGYGGggK',
  '.K.KGGGGGggK',
  '...KGGGGgggK',
  '..KGGGGGggdK',
  '..KgGGGggddK',
  '..KKKKKKKKKK',
]);
const CULTIST = [CULTIST_A, withRows(CULTIST_A, { 7: 'KCKhGGGGGgK.', 8: 'CPCKGGYGGgK.', 9: 'KCKGGGYGGggK', 12: '.KGGGGGGggdK', 13: '.KgGGGGggddK', 14: '.KKKKKKKKKKK' })];
const CULTIST_ATK = withRows(CULTIST_A, { 3: 'KPKGKKKKgK..', 4: 'PCPGKEEKgK..', 5: 'KPKGKKKKgK..', 6: '.KhGGGGGggK.', 7: '.KKhGGGGGgK.', 8: '..KKGGYGGgK.', 9: '..KGGGYGGggK' });

const ARMOR_A = norm([
  '....KKKKK...W',
  '...KhGGGgK.WM',
  '...KGKKKgK.WM',
  '...KGCKCgK.MW',
  '...KGKKKgK.bK',
  '..KKKGGgKKKbK',
  '.KhGKhGGgKGbK',
  'KhGGKGGGgKGb.',
  'KGgKKGGGgKKb.',
  '.KK.KdddgK.b.',
  '....KGGKgK.b.',
  '...KGGK.KgK..',
  '...KGK..KgK..',
  '..KGGK..KggK.',
  '..KKKK..KKKK.',
]);
const ARMOR = [ARMOR_A, withRows(ARMOR_A, { 3: '...KGKKKgK.MW', 11: '...KGGK..KgK.', 12: '..KGK....KgK.', 13: '.KGGK....KggK', 14: '.KKKK....KKKK' })];
const ARMOR_ATK = withRows(ARMOR_A, { 0: 'W...KKKKK....', 1: 'MW.KhGGGgK...', 2: 'MWbKGKKKgK...', 3: '.KbbGCKCgK...', 4: '...bGKKKgK...', 5: '..KKKGGgKK...', 6: '.KhGKhGGgK...', 7: 'KhGGKGGGgK...', 8: 'KGgKKGGGgK...', 9: '.KK.KdddgK...', 10: '....KGGKgK...' });

// ----- more bosses (drawn at 2x) -----
const GLOOP_A = norm([
  '.......Y.Y.Y......',
  '.......YYYYY......',
  '......KKKKKKK.....',
  '....KKhhhGGGGKK...',
  '...KhhGGGGGGGGgK..',
  '..KhGGGGGGGGGGGgK.',
  '.KhGGWWGGGGWWGGGgK',
  '.KGGGWKGGGGWKGGGgK',
  'KhGGGGGGGGGGGGGGgK',
  'KGGGGGKKKKKKGGGggK',
  'KGGGGGKWWWWKGGGggK',
  'KgGGGGGKKKKGGGgggK',
  'KggGGGGGGGGGGggddK',
  '.KgggggggggggggddK',
  '..KKKKKKKKKKKKKKK.',
]);
const GLOOP = [GLOOP_A, ['..................', ...GLOOP_A.slice(0, 4), ...GLOOP_A.slice(5)]];
const GLOOP_ATK = withRows(GLOOP_A, { 9: 'KGGGGKKKKKKKKGGggK', 10: 'KGGGGKWdddddWKGggK', 11: 'KgGGGKdddddddKgggK', 12: 'KggGGKKWWWWKKggddK' });

const BONES_A = norm([
  '.....KKKKKK.......',
  '....KWWWWWgK......',
  '...KWWWWWWWgK.....',
  '...KWKKWKKWgK.....',
  '...KWKCWKCWgK.....',
  '...KWWWKWWWgK.....',
  '....KWKWKWgK...KK.',
  '.KK..KKKKKK...KWWK',
  'KWWKKWWWWWWKK.KWgK',
  'KWKKWKgWWgKWKKWgK.',
  '.KKWKKWWWWKKWKWgK.',
  '..KWKgKWWKgKWWgK..',
  '...KK.KWWK.KKKK...',
  '.....KWKKWK.......',
  '....KWK..KWK......',
  '...KWWK..KWWK.....',
  '...KKK....KKK.....',
]);
const BONES = [BONES_A, withRows(shiftRows(BONES_A, 0, 5, 1), { 14: '....KWK...KWK.....', 15: '...KWWK...KWWK....', 16: '...KKK.....KKK....' })];
const BONES_ATK = withRows(BONES_A, { 3: '...KWKKWKKWgK.....', 5: '...KWWWKWWWgK.....', 6: '...KWWWWWWgK......', 7: '.KK.KWKWKWK.KK....', 8: 'KWWKKKKKKKKKWWK...', 9: 'KWKKWKgWWgKWKWWK..' });

const QUEEN_A = norm([
  '......KKKKKK......',
  '....KKhGGGGgKK....',
  '...KhGGYGGYGGgK...',
  '...KGGGGYYGGGgK...',
  '.K.KgGGGGGGGGgK.K.',
  'K.K.KKgGGGGgKK.K.K',
  'K..KKhGGGGGGgKK..K',
  '.KK.KGRGRRGRGK.KK.',
  'K..KKGGGGGGGgKK..K',
  'K.K..KWKGGKWK..K.K',
  '.K..K.KWKKWK.K..K.',
  'K..K...K..K...K..K',
  '..K............K..',
]);
const QUEEN = [QUEEN_A, withRows(QUEEN_A, { 4: 'K..KgGGGGGGGGgK..K', 5: '.KK.KKgGGGGgKK.KK.', 10: 'K..KK.KWKKWK.KK..K', 11: '.KK.....KK.....KK.', 12: '..................' })];
const QUEEN_ATK = withRows(QUEEN_A, { 9: 'K.K..KWKGGKWK..K.K', 10: '.K..KKWWKKWWKK..K.', 11: 'K..K..W....W..K..K', 12: '..K...C....C..K...' });

const MOON_A = norm([
  '...K.K......K.K.K.',
  '..KhKhK...KhKhKhK.',
  '..KhGGGK.KhhhhhhhK',
  '.KGGCGGhKhhhhhhhhK',
  'KGGGGGGhhhGGGGGGgK',
  'WKKGGGGGGGGGGGGGgK',
  'KWKKGGGGGGGGGGGggK',
  'WKWKgGGgggggggKgK.',
  '.K.KgGK.KggK.KgKK.',
  '...KgGK..KgK.KgK..',
  '..KGgK..KGgK.KgK..',
  '..KKKK..KKKK.KKK..',
]);
const MOON = [MOON_A, withRows(MOON_A, { 8: '.K.KgK..KgK..KgK..', 9: '..KgK..KgK..KgK...', 10: '.KGgK.KGgK..KgK...', 11: '.KKKK.KKKK..KKK...' })];
const MOON_ATK = withRows(MOON_A, { 1: '.KhKhK.....KhKhKhK', 2: '.KhGGGK...KhhhhhhK', 5: 'WKKGGGGGGGGGGGGGgK', 6: 'W.KWGGGGGGGGGGGggK', 7: 'WKKKgGGgggggggKgK.' });

const FIEND_A = norm([
  '..W..........W....',
  '..WK........KW....',
  '...WKKKKKKKKW.....',
  '...KhGGGGGGgK.....',
  '...KGEKGGKEgK.....',
  '..KKGGGGGGGgKK....',
  '.KdKGWKWKWKgKdK...',
  'KddKKGGGGGgKKddK..',
  'KdddKhGGGGgKdddK..',
  'KddKGGhGGGGgKddK..',
  '.KKGGKGGGGKgGKK...',
  '..KGK.KGGGgK.KgK..',
  '..KFK.KGGgK..KFK..',
  '.....KGgKGgK......',
  '....KGGK.KGgK.....',
  '...KKKK...KKKK....',
]);
const FIEND = [FIEND_A, withRows(FIEND_A, { 6: 'KddKGWKWKWKgKddK..', 7: 'KdddKGGGGGgKdddK..', 8: '.KddKhGGGGgKddK...', 9: '..KKGGhGGGGgKK....', 12: '..KOK.KGGgK..KOK..' })];
const FIEND_ATK = withRows(FIEND_A, { 8: 'OFOdKhGGGGgKdddK..', 9: 'FFFKGGhGGGGgKddK..', 10: 'OFGGKKGGGGKgGKK...', 11: '.KKK..KGGGgK.KgK..', 12: '......KGGgK..KFK..' });

const WYRM_A = norm([
  '.....KKKKKK.......',
  '...KKhhGGGGKK.....',
  '..KhGGGGGGGGgK....',
  '.KhGEKGGGGGGGgK...',
  'KWGGGGGGGGGGGgK...',
  'KdWKKKKKGGGGGgK...',
  'KOdddddKGhGGggK...',
  'KdWKKKKKGhGGggK...',
  'KWGGGGKKhGGGggK...',
  '.KKKKK.KhOhGggK...',
  '......KhGGGGggK...',
  '......KhGOGGgK....',
  '.....KhGGGGggK....',
  '...KKOOhGGGggKKK..',
  '.KOOFFOOOOOOOOOOK.',
  'KOFFFOOOFFOOOFOOOK',
  '.KKKKKKKKKKKKKKKK.',
]);
const WYRM = [WYRM_A, withRows(shiftRows(WYRM_A, 0, 9, 1), { 14: '.KOFFOOOOOFOOOOOK.', 15: 'KOOFFOOOOFFOOOFOOK' })];
const WYRM_ATK = withRows(WYRM_A, { 4: 'KWGGGGGGGGGGGgK...', 5: 'dWKKKKKKGGGGGgK...', 6: 'OFOddddKGhGGggK...', 7: 'FOFdddKKGhGGggK...', 8: 'OWKKKKKKhGGGggK...', 9: '.WGGGGKKhOhGggK...', 10: '.KKKKKKhGGGGggK...' });

const DK_A = norm([
  '..W......W........',
  '..WK....KW........',
  '...KKKKKK.........',
  '..KhGGGGgK......M.',
  '..KGKKKKgK.....MM.',
  '..KGCKKCgK....MM..',
  '..KGGKKGgK...MM...',
  '.KKKGGGgKKK.MM....',
  'KrKhGGGGGgKKYK....',
  'KrKGGhGGGgKYbK....',
  'KrrKGGGGgKGKK.....',
  'KrrKmmYmmKGK......',
  '.KrKGGKGGgK.......',
  '..KKGGKGGgK.......',
  '...KGGK.KGgK......',
  '..KGGK...KGgK.....',
  '..KKKK...KKKK.....',
]);
const DK = [DK_A, withRows(DK_A, { 8: 'KrKhGGGGGgKKYK....', 12: 'KrrKGGKGGgK.......', 13: '.KKKGGKGGgK.......', 14: '...KGGK..KGgK.....', 15: '...KGK....KGgK....', 16: '..KKKK...KKKKK....' })];
const DK_ATK = withRows(DK_A, { 3: '..KhGGGGgK........', 4: '..KGKKKKgK........', 5: '..KGCKKCgK........', 6: 'MMKGGKKGgK........', 7: '.MMMGGGgKKK.......', 8: 'KrKMMYGGGgK.......', 9: 'KrKGYbGGGgK.......', 10: 'KrrKbGGGgKK.......', 11: 'KrrKmmYmmK........' });

const VAMP_A = norm([
  '......KKKK......',
  '.....KddddK.....',
  '....KddddddK....',
  '....KdSSdSdK....',
  '...KKSRSSRSKK...',
  'KK.KdSSSSSSdK.KK',
  'KdKKdKSWWSKdKKdK',
  'KddKKKSSSSKKKddK',
  'KdddKGKYYKGKdddK',
  'KddKGGKrrKGGKddK',
  '.KdKGGrrrrGGKdK.',
  '..KKGGrrrrGGKK..',
  '...KGGrrrrGGK...',
  '..KGGGrrrrGGgK..',
  '.KGGGGrrrrGGggK.',
  'KKKKKKKKKKKKKKKK',
]);
const VAMP = [VAMP_A, withRows(VAMP_A, { 4: 'K..KKSRSSRSKK..K', 5: 'KdKKdSSSSSSdKKdK', 6: 'KddKdKSWWSKdKddK', 7: 'KdddKKSSSSKKdddK', 8: '.KddKGKYYKGKddK.', 9: '..KKGGKrrKGGKK..', 10: '...KGGrrrrGGK...', 11: '...KGGrrrrGGK...' })];
const VAMP_ATK = withRows(VAMP_A, { 0: 'K.....KKKK.....K', 1: 'dK...KddddK...Kd', 2: 'ddK.KddddddK.Kdd', 3: 'dddKKdSSdSdKKddd', 4: 'ddddKSRSSRSKdddd', 5: 'dddKdSSSSSSdKddd', 6: 'ddKKdKWSSWKdKKdd', 7: 'dK.KKKSWWSKKK.Kd', 8: 'K..KGKKYYKGK...K', 9: '...KGGKrrKGGK...', 10: '...KGGrrrrGGK...', 11: '...KGGrrrrGGK...' });

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
  rat: { name: 'Giant Rat', hp: 14, xp: 2, speed: 0.55, death: 'flop', frames: RAT, atk: RAT_ATK },
  mimic: { name: 'Mimic', hp: 26, xp: 4, speed: 0.3, hop: true, death: 'collapse', frames: MIMIC, atk: MIMIC_ATK },
  spider: { name: 'Web Spider', hp: 32, xp: 3, speed: 0.55, death: 'flop', frames: SPIDER, atk: SPIDER_ATK },
  boar: { name: 'Tusked Boar', hp: 44, xp: 4, speed: 0.6, death: 'flop', frames: BOAR, atk: BOAR_ATK },
  salamander: { name: 'Salamander', hp: 50, xp: 4, speed: 0.45, death: 'flop', frames: SALA, atk: SALA_ATK },
  cinder: { name: 'Cinder Wisp', hp: 38, xp: 3, speed: 0.65, fly: true, ghost: true, death: 'dissolve', frames: WISP },
  cultist: { name: 'Shadow Cultist', hp: 85, xp: 5, speed: 0.35, death: 'dissolve', frames: CULTIST, atk: CULTIST_ATK },
  armor: { name: 'Haunted Armor', hp: 105, xp: 6, speed: 0.25, death: 'collapse', frames: ARMOR, atk: ARMOR_ATK },
  // Bosses: hp is the reference HP at level 1; battle.js scales it to the hero's damage.
  // Optional boss fields: flavor (arrival line), aura (glow color), atkTint (wind-up flash).
  boss: { name: 'Goblin Warlord', hp: 300, xp: 60, speed: 0.25, boss: true, death: 'topple', frames: GOBLIN, atk: GOBLIN_ATK, flavor: 'Bangs his shield and calls the horde.', aura: [255, 140, 90] },
  slimeking: { name: 'King Gloop', hp: 290, xp: 60, speed: 0.2, boss: true, hop: true, death: 'splat', frames: GLOOP, atk: GLOOP_ATK, flavor: 'Wobbles in, crown and all.', aura: [120, 255, 210], atkTint: [120, 255, 200] },
  bonelord: { name: 'Skullmaw the Bone Tyrant', hp: 310, xp: 65, speed: 0.25, boss: true, death: 'collapse', frames: BONES, atk: BONES_ATK, flavor: 'Rattles up from the ossuary.', aura: [140, 240, 255], atkTint: [140, 240, 255] },
  elder: { name: 'Elderbark the Ancient', hp: 320, xp: 80, speed: 0.2, boss: true, death: 'topple', frames: ELDER, atk: ELDER_ATK, flavor: 'The forest itself wakes up.', aura: [150, 255, 120] },
  spiderqueen: { name: 'Arachnessa the Brood Queen', hp: 300, xp: 80, speed: 0.35, boss: true, death: 'flop', frames: QUEEN, atk: QUEEN_ATK, flavor: 'Descends on a silver thread.', aura: [255, 210, 90], atkTint: [180, 255, 120] },
  moonwolf: { name: 'Fenrath the Moon Wolf', hp: 310, xp: 85, speed: 0.45, boss: true, death: 'flop', frames: MOON, atk: MOON_ATK, flavor: 'Howls, and the moon answers.', aura: [170, 220, 255], atkTint: [170, 220, 255] },
  drake: { name: 'Ignarok the Magma Drake', hp: 340, xp: 100, speed: 0.3, boss: true, death: 'collapse', frames: DRAKE, atk: DRAKE_B, flavor: 'Rises from the lava, wings ablaze.', aura: [255, 150, 60] },
  infernal: { name: 'Balgoroth the Pit Fiend', hp: 350, xp: 100, speed: 0.3, boss: true, death: 'collapse', frames: FIEND, atk: FIEND_ATK, flavor: 'Steps through a gate of fire.', aura: [255, 90, 40], atkTint: [255, 170, 40] },
  magmaworm: { name: 'Scorchmaw the Lava Wyrm', hp: 330, xp: 95, speed: 0.15, boss: true, death: 'collapse', frames: WYRM, atk: WYRM_ATK, flavor: 'Bursts out of the molten floor.', aura: [255, 190, 70], atkTint: [255, 200, 80] },
  lich: { name: 'The Lich King', hp: 360, xp: 120, speed: 0.25, boss: true, death: 'dissolve', frames: LICH, atk: LICH_ATK, flavor: 'Cold light fills the hall.', aura: [190, 140, 255] },
  deathknight: { name: 'Sir Mordred the Death Knight', hp: 370, xp: 120, speed: 0.25, boss: true, death: 'topple', frames: DK, atk: DK_ATK, flavor: 'Draws a blade that drinks the light.', aura: [140, 240, 255], atkTint: [120, 220, 255] },
  vampire: { name: 'Count Vessarin', hp: 350, xp: 115, speed: 0.35, boss: true, death: 'dissolve', frames: VAMP, atk: VAMP_ATK, flavor: 'Unfolds his cape into the night.', aura: [255, 60, 90], atkTint: [255, 40, 80] },
};

// Biome rosters (weakest first) and the boss that guards each biome.
// The dungeon's first entries are also its early-level roster (see battle.js).
const ROSTERS = {
  dungeon: ['slime', 'bat', 'goblin', 'skeleton', 'rat', 'mimic'],
  forest: ['wolf', 'shroom', 'treant', 'spider', 'boar'],
  lava: ['imp', 'firebat', 'golem', 'salamander', 'cinder'],
  castle: ['wraith', 'gargoyle', 'knight', 'cultist', 'armor'],
};
// BOSSES keeps each biome's original guardian; BOSS_POOLS is every boss a biome can send.
const BOSSES = { dungeon: 'boss', forest: 'elder', lava: 'drake', castle: 'lich' };
const BOSS_POOLS = {
  dungeon: ['boss', 'slimeking', 'bonelord'],
  forest: ['elder', 'spiderqueen', 'moonwolf'],
  lava: ['drake', 'infernal', 'magmaworm'],
  castle: ['lich', 'deathknight', 'vampire'],
};
const BIOME_ORDER = ['dungeon', 'forest', 'lava', 'castle'];
const RETURNING_CHANCE = 0.2;

// The biome a boss belongs to (null for regular monsters).
function bossBiome(type) {
  for (const b of BIOME_ORDER) if (BOSS_POOLS[b].includes(type)) return b;
  return null;
}

// Pick the next boss for a biome. Never one of the last two bosses in
// history (oldest first). Past the dungeon, sometimes a boss from an earlier
// biome comes back for a rematch (a "returning foe"); the caller can check
// bossBiome(type) !== biome to announce it and fight it at a higher level.
function pickBoss(biome, history = [], lvl = 1, rnd = Math.random) {
  const home = BOSS_POOLS[biome] ? biome : 'dungeon';
  const recent = new Set((history || []).slice(-2));
  const fresh = (list) => list.filter((t) => !recent.has(t));
  const earlier = BIOME_ORDER.slice(0, BIOME_ORDER.indexOf(home)).flatMap((b) => BOSS_POOLS[b]);
  const returning = fresh(earlier);
  let pool = fresh(BOSS_POOLS[home]);
  if (returning.length && lvl >= 5 && rnd() < RETURNING_CHANCE) pool = returning;
  if (!pool.length) pool = fresh([...BOSS_POOLS[home], ...earlier]);
  if (!pool.length) pool = BOSS_POOLS[home];
  return pool[Math.min(pool.length - 1, Math.floor(rnd() * pool.length))];
}

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
  rat: [{ G: [138, 120, 112], g: [96, 82, 78], d: [62, 52, 50], h: [196, 178, 168] }, { G: [110, 96, 80], g: [76, 64, 52], d: [48, 40, 32], h: [164, 146, 120] }],
  mimic: [{ G: [150, 98, 54], g: [104, 66, 36], d: [52, 18, 30], h: [206, 150, 90], M: [214, 178, 90], m: [150, 118, 56], r: [226, 70, 90] }],
  spider: [{ G: [70, 58, 84], g: [46, 38, 58], d: [30, 24, 40], h: [124, 108, 146] }, { G: [96, 70, 50], g: [66, 48, 34], d: [42, 30, 22], h: [150, 116, 84] }],
  boar: [{ G: [132, 90, 62], g: [94, 62, 42], d: [58, 36, 26], h: [184, 136, 96] }],
  salamander: [{ G: [224, 112, 44], g: [168, 70, 32], d: [104, 38, 26], h: [255, 190, 110], r: [255, 90, 120] }],
  cinder: [{ G: [255, 150, 50], g: [220, 80, 40], d: [140, 36, 30], h: [255, 236, 140], W: [255, 255, 230] }],
  cultist: [{ G: [128, 30, 50], g: [88, 20, 36], d: [54, 12, 24], h: [184, 64, 84], E: [255, 90, 70] }],
  armor: [{ G: [170, 128, 70], g: [120, 88, 46], d: [60, 46, 30], h: [226, 190, 120] }],
  slimeking: [{ G: [70, 196, 170], g: [40, 140, 124], d: [24, 88, 80], h: [190, 255, 236] }],
  bonelord: [{ G: [220, 214, 196], g: [150, 144, 130], d: [96, 92, 84], h: [255, 255, 245], W: [232, 226, 206] }],
  spiderqueen: [{ G: [60, 44, 90], g: [40, 28, 64], d: [24, 16, 40], h: [120, 96, 170], R: [255, 70, 70], Y: [255, 190, 60] }],
  moonwolf: [{ G: [170, 186, 214], g: [120, 134, 168], d: [76, 86, 116], h: [236, 244, 255] }],
  infernal: [{ G: [196, 48, 40], g: [140, 30, 30], d: [80, 18, 30], h: [255, 120, 80] }],
  magmaworm: [{ G: [90, 64, 60], g: [62, 42, 40], d: [36, 22, 24], h: [150, 110, 90] }],
  deathknight: [{ G: [70, 76, 96], g: [46, 50, 66], d: [28, 30, 42], h: [130, 140, 170], r: [150, 26, 40] }],
  vampire: [{ G: [70, 20, 44], g: [46, 12, 30], d: [22, 16, 28], h: [120, 50, 80], S: [236, 226, 236], r: [196, 30, 50] }],
};
const MONSTER_BASE = {
  K: [20, 16, 26], W: [236, 232, 218], R: [255, 64, 56], E: [255, 226, 110], Y: [255, 206, 70], b: [124, 82, 48], M: [196, 202, 216],
  m: [110, 114, 132], F: [255, 238, 150], O: [255, 138, 40], r: [200, 50, 44], C: [140, 240, 255], P: [196, 128, 255],
  S: [238, 218, 180], s: [186, 160, 122], L: [100, 180, 76], l: [58, 120, 50],
};

const DEATH_TICKS = 14, BOSS_DEATH_TICKS = 28;
const scaleOf = (m) => m.scale || (m.boss ? 2 : 1);
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
  else if (m.windup > 0) tint = [def.atkTint || [255, 70, 50], at & 1 ? 0.45 : 0.2];
  else if (m.frozen > 0) tint = [[150, 225, 255], m.boss ? 0.3 : 0.5];
  else if (m.burn > 0 && at & 2) tint = [[255, 140, 40], 0.3];
  else if (m.curse > 0 && at & 2) tint = [[170, 80, 230], 0.3];
  else if (m.enraged) tint = [[255, 40, 30], 0.28 + 0.14 * Math.sin(at * 0.6)];

  // Soft shadow on the floor (flyers get a fainter one).
  const floor = m.floorY != null ? m.floorY : def.fly ? Math.round(m.baseY + h + 8) : Math.round(m.y) + h;
  drawShadow(pc, x, Math.min(pc.h - 1, floor), w, def.fly || m.yOff < -2 ? 0.8 : 0.55);
  if (target) pc.glow(x + w / 2, y + h / 2, Math.max(w, h), [255, 80, 60], 0.12);
  if (m.elite) pc.glow(x + w / 2, y + h / 2, Math.max(w, h), [255, 210, 80], 0.2);
  if (m.boss) pc.glow(x + w / 2, y + h / 2, Math.max(w, h) * 0.8, m.enraged ? [255, 50, 30] : def.aura || pal.h, m.enraged ? 0.3 : 0.12);
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
  const aff = m.affixes || [];
  if (aff.includes('regen') && !(m.burn > 0) && !(m.poison > 0) && m.hp < m.max) for (let k = 0; k < 3; k++) {
    const ph = (at + k * 5) % 12;
    pc.set(x + 1 + Math.round(X.hash(k, (at / 12) | 0) * (w - 2)), y + h - 2 - ph, ph < 6 ? [150, 255, 150] : [90, 200, 90]);
  }
  if (aff.includes('swift') && m.walking) for (let k = 0; k < 3; k++) for (let i = 0; i < 3 + k; i++) pc.set(x + w + 1 + i + (at % 2), y + 2 + k * Math.max(2, Math.floor(h / 3)), [255, 240, 150]);
  if (aff.includes('vampiric') && (m.vampT || 0) > 0) { m.vampT--; pc.glow(x + w / 2, y + h / 2, Math.max(w, h) * 0.7, [220, 30, 60], 0.35); }
  if (m.shield > 0) for (let k = 0; k < 20; k++) {
    const g = (k / 20) * Math.PI * 2 + at * 0.05;
    if ((k + (at >> 2)) % 3) pc.set(x + w / 2 + Math.cos(g) * (w / 2 + 2), y + h / 2 + Math.sin(g) * (h / 2 + 2), [120, 220, 255]);
  }

  // Outlined HP bar (bosses get the big one from battle.js).
  if (m.boss) return;
  const bw = Math.max(10, w), bx = x + Math.floor((w - bw) / 2), by = y - (m.elite ? 7 : 4);
  const ratio = Math.max(0, m.hp / m.max);
  const barCol = ratio > 0.6 ? [110, 230, 100] : ratio > 0.3 ? [250, 210, 70] : [255, 80, 70];
  const edge = aff.includes('armored') ? [176, 186, 206] : m.elite ? [255, 206, 70] : pal.K;
  for (let i = -1; i <= bw; i++) { pc.set(bx + i, by - 1, edge); pc.set(bx + i, by + 2, edge); }
  for (let i = 0; i < bw; i++) for (let j = 0; j < 2; j++) pc.set(bx + i, by + j, i < Math.round(bw * ratio) ? X.shade(barCol, j ? 0.75 : 1) : [54, 44, 60]);
  pc.set(bx - 1, by, edge); pc.set(bx - 1, by + 1, edge); pc.set(bx + bw, by, edge); pc.set(bx + bw, by + 1, edge);
  // Shield bar above the HP bar, and one pip per affix above that.
  let top = by - 1;
  if (m.shieldMax > 0 && m.shield > 0) {
    top = by - 3;
    for (let i = 0; i < bw; i++) pc.set(bx + i, by - 2, i < Math.round(bw * m.shield / m.shieldMax) ? [120, 220, 255] : [40, 60, 80]);
  }
  aff.forEach((a, i) => {
    const c = affixColor(m, a), px = bx + i * 3;
    if (a === 'weak' && at & 4) return;
    pc.set(px, top - 1, c); pc.set(px + 1, top - 1, c);
  });
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

// ---------- difficulty ----------

// Difficulty tiers by hero level. hp: monster HP multiplier; hit: a normal
// monster's hit as a share of the hero's battle HP; aggro: attack rate;
// gold: gold per kill; loot: bonus added to chest scores; chance/max:
// affixes on normal monsters; elite: [min, max] affixes on elites; boss:
// affixes on bosses. XP never depends on the tier.
const DIFFICULTY = [
  { id: 'normal', name: 'Normal', min: 1, hp: 1, hit: 0.04, aggro: 1, gold: 1, loot: 0, chance: 0, max: 0, elite: [1, 1], boss: 0, color: [140, 220, 120] },
  { id: 'veteran', name: 'Veteran', min: 20, hp: 1.2, hit: 0.12, aggro: 1.1, gold: 1.25, loot: 2, chance: 0.15, max: 1, elite: [1, 2], boss: 0, color: [120, 190, 255] },
  { id: 'heroic', name: 'Heroic', min: 35, hp: 1.3, hit: 0.3, aggro: 1.2, gold: 1.5, loot: 4, chance: 0.35, max: 1, elite: [2, 3], boss: 1, color: [255, 176, 60] },
  { id: 'mythic', name: 'Mythic', min: 50, hp: 1.9, hit: 0.36, aggro: 1.3, gold: 2, loot: 6, chance: 0.6, max: 2, elite: [3, 3], boss: 2, color: [255, 90, 90] },
  { id: 'abyss', name: 'Abyss', min: 60, hp: 2.2, hit: 0.4, aggro: 1.35, gold: 2.5, loot: 8, chance: 0.8, max: 2, elite: [3, 3], boss: 2, color: [190, 110, 255] },
];
// Abyss has no cap: a new Abyss level every 3 hero levels past 60.
function difficultyFor(lvl, force) {
  const f = force || process.env.ARCADE_TIER || '';
  let base, n = 0;
  if (f) {
    const [id, lv] = String(f).split(':');
    base = DIFFICULTY.find((t) => t.id === id);
    if (base && base.id === 'abyss') n = Math.max(1, Number(lv) || 1);
  }
  if (!base) {
    base = [...DIFFICULTY].reverse().find((t) => (lvl || 1) >= t.min) || DIFFICULTY[0];
    if (base.id === 'abyss') n = 1 + Math.floor(((lvl || 60) - 60) / 3);
  }
  const t = { ...base, index: DIFFICULTY.indexOf(base), level: n, label: n ? `${base.name.toUpperCase()} ${n}` : base.name.toUpperCase() };
  if (n) {
    t.hp = base.hp * Math.pow(1.06, n - 1);
    t.hit = Math.min(0.5, base.hit + 0.008 * (n - 1));
    t.aggro = Math.min(1.8, base.aggro + 0.02 * (n - 1));
    t.gold = base.gold + 0.2 * (n - 1);
    t.loot = base.loot + (n - 1);
    t.max = Math.min(4, base.max + Math.floor((n - 1) / 4));
    t.elite = [3, Math.min(5, 3 + Math.floor(n / 4))];
    t.boss = Math.min(4, base.boss + Math.floor(n / 5));
  }
  return t;
}

// ---------- affixes ----------

// Harder difficulty tiers give monsters affixes (rolled in battle.js). Each
// shows as a colored pip over the HP bar and a word on the name tag.
const ELEMENT_COLOR = { fire: [255, 120, 40], frost: [140, 220, 255], lightning: [255, 236, 100], shadow: [170, 90, 240], holy: [255, 230, 150], physical: [205, 200, 190] };
const AFFIXES = {
  armored: { name: 'Armored', color: [176, 186, 206], desc: 'Every hit is reduced by a flat amount. Damage over time ignores armor.' },
  shielded: { name: 'Shielded', color: [110, 210, 255], desc: 'A shield bar must break before HP drops. Lightning and heavy skills break it faster.' },
  swift: { name: 'Swift', color: [255, 240, 120], desc: 'Moves and attacks faster.' },
  regen: { name: 'Regenerating', color: [110, 230, 110], desc: 'Heals over time, unless burning or poisoned.' },
  vampiric: { name: 'Vampiric', color: [225, 40, 70], desc: 'Heals itself when it hits you.' },
  splitting: { name: 'Splitting', color: [200, 130, 255], desc: 'Splits into two smaller monsters when it dies.' },
  enraged: { name: 'Enraging', color: [255, 90, 40], desc: 'Below 30% HP it hits harder and faster.' },
  resist: { name: 'Resistant', color: [150, 150, 170], desc: 'Takes half damage from one element.' },
  weak: { name: 'Weak', color: [255, 255, 255], desc: 'Takes +50% damage from one element.' },
};
const cap1 = (w) => w.charAt(0).toUpperCase() + w.slice(1);
// Name-tag words, e.g. "Armored Swift Fire-proof".
function affixLabel(m) {
  return (m.affixes || []).map((a) => (a === 'resist' ? `${cap1(m.resist || 'fire')}-proof` : a === 'weak' ? `${cap1(m.weak || 'fire')}-weak` : (AFFIXES[a] || {}).name)).filter(Boolean).join(' ');
}
const affixColor = (m, a) => (a === 'resist' ? ELEMENT_COLOR[m.resist] : a === 'weak' ? ELEMENT_COLOR[m.weak] : null) || (AFFIXES[a] || {}).color || [255, 255, 255];

module.exports = { MONSTERS, MONSTER_COLORS, ROSTERS, BOSSES, BOSS_POOLS, pickBoss, bossBiome, drawMonster, monsterSize, paletteFor, deathTicks, paint, AFFIXES, ELEMENT_COLOR, affixLabel, affixColor, DIFFICULTY, difficultyFor };
