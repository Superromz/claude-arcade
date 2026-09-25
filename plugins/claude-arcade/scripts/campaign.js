'use strict';
// The Campaign: "The Great Refactor". A story in chapters whose objectives
// are tied to real Claude usage, a world map where every project you work in
// is a kingdom to liberate, and a Codex of lore unlocked by play. After the
// last chapter and the epilogue, a new themed Season starts every month
// (picked from the date, so everyone gets the same one).
//
// Rewards are titles, cosmetics and gold. Never XP: XP only comes from real
// usage, because the leaderboard depends on it.
//
// state.game.campaign (per hero, `game` swaps with the roster):
//   chapter     index into CHAPTERS; CHAPTERS.length means "seasons"
//   done        claimed chapter and season ids ('ch1' ... 'epilogue', 'season:2026-09')
//   seen        story scenes already read ('ch1:intro', 'ch1:outro', ...)
//   codex       unlocked codex entry ids
//   titles      titles earned, oldest first
//   base        counters when the current chapter/season began ({ id, t, quests, ... })
//   bountyN     bounties claimed since the campaign started (bounty claims are trimmed daily)
//   bountySeen  the bounty keys already counted
//   bossT       timestamp of the last "Boss defeated" event already counted
//   kb          bosses defeated per kingdom (project key), from the quest log

const fs = require('fs');
const L = require('./lib');
const X = require('./pixel');
const { RESET, fg, bg, UI, ui } = require('./state');
const { panelLine, sectionHeader, cardTop, cardRow, cardBottom, labelBar, thinBar, truncVis, wrap, darken } = require('./panels');

const DAY = 864e5;
const MON = () => require('./monsters');
const ITEMS = () => require('./items');

// ---------- seeds ----------

function seedOf(str) {
  let h = 2166136261;
  for (const ch of String(str)) { h ^= ch.charCodeAt(0); h = Math.imul(h, 16777619); }
  return h >>> 0;
}
function rng(seed) { // mulberry32
  return () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ---------- kingdoms ----------

const STAGES = [
  { id: 'occupied', name: 'Occupied', min: 0, color: [186, 104, 240] },
  { id: 'contested', name: 'Contested', min: 150, color: [255, 150, 70] },
  { id: 'liberated', name: 'Liberated', min: 800, color: [120, 220, 120] },
  { id: 'thriving', name: 'Thriving', min: 3000, color: [100, 200, 255] },
  { id: 'legendary', name: 'Legendary', min: 10000, color: [255, 214, 80] },
];
const LIBERATED = 2;
// Every boss can rule a kingdom; the ruler is picked from the project key.
const RULERS = ['boss', 'slimeking', 'bonelord', 'elder', 'spiderqueen', 'moonwolf', 'drake', 'infernal', 'magmaworm', 'lich', 'deathknight', 'vampire'];
const BIOME_NAMES = { dungeon: 'dungeon', forest: 'forest', lava: 'lava cave', castle: 'castle' };

const keyOf = (p) => (process.platform === 'win32' ? String(p || '').toLowerCase() : String(p || ''));
const kingdomBiome = (lvl) => (lvl >= 15 ? 'castle' : lvl >= 10 ? 'lava' : lvl >= 5 ? 'forest' : 'dungeon');
const stageFor = (score) => { let s = 0; STAGES.forEach((st, i) => { if (score >= st.min) s = i; }); return s; };

// Liberation grows with real work in the project.
function liberation(p, bosses = 0) {
  const t = p.tools || {};
  return Math.round((p.xp || 0) + 10 * (p.quests || 0) + (t.editing || 0) + (t.running || 0) + ((p.tokens || {}).output || 0) / 1000 + 100 * bosses);
}

function rulerOf(key) { return RULERS[seedOf(`ruler:${key}`) % RULERS.length]; }
function monsterName(type) { try { return (MON().MONSTERS[type] || {}).name || type; } catch { return type; } }

// Every project as a kingdom, placed deterministically on the map (older
// kingdoms first, so a new project never moves an old one).
function kingdoms(state) {
  const c = campaignOf(state);
  const list = Object.entries(state.projects || {}).map(([key, p]) => {
    const bosses = Math.max(Number(p.bosses) || 0, Number((c.kb || {})[key]) || 0);
    const score = liberation(p, bosses);
    const stage = stageFor(score);
    const lvl = L.levelFor(p.xp || 0);
    const next = STAGES[stage + 1];
    return {
      key, p, name: p.name || key, path: p.path || key, bosses, score, stage, lvl, biome: kingdomBiome(lvl),
      ruler: rulerOf(key), rulerDown: stage >= LIBERATED, next: next ? next.min : null, prev: STAGES[stage].min,
    };
  }).sort((a, b) => (a.p.firstSeen || 0) - (b.p.firstSeen || 0) || (a.key < b.key ? -1 : 1));
  const placed = [];
  for (const k of list) {
    const r = rng(seedOf(`pos:${k.key}`));
    let best = null, bestD = -1;
    for (let i = 0; i < 40; i++) {
      const nx = 0.08 + r() * 0.68, ny = 0.22 + r() * 0.6;
      const dmin = placed.length ? Math.min(...placed.map((o) => Math.hypot((o.nx - nx) * 2.4, o.ny - ny))) : 9;
      if (dmin >= 0.42) { best = [nx, ny]; break; }
      if (dmin > bestD) { bestD = dmin; best = [nx, ny]; }
    }
    k.nx = best[0]; k.ny = best[1];
    placed.push(k);
  }
  return placed;
}
const byScore = (ks) => ks.slice().sort((a, b) => b.score - a.score || (a.key < b.key ? -1 : 1));

// ---------- chapters ----------
// Objective kinds: counters since the chapter began (quests, edits, cmds,
// agents, scout, bosses, kills, tokens, bounties) or standing totals
// (level, kingdoms, contested, thriving, realms, recruit, capstone, streak,
// wave, bossBiome, codex).

const SINCE = new Set(['quests', 'edits', 'cmds', 'agents', 'scout', 'bosses', 'kills', 'tokens', 'bounties']);

// Speakers: n (narrator), hero, duck (Quackers), mono (the Legacy Monolith),
// or a villain key from the chapter's cast.
const CHAPTERS = [
  {
    id: 'ch1', num: 1, name: 'The Duck Awakens', stage: 'dungeon',
    villain: { key: 'swarm', name: 'The Bug Swarm', types: ['spider', 'rat'] },
    blurb: 'Bugs crawl out of every unchecked edge case. Somewhere, a rubber duck is waiting to be talked to.',
    objectives: [
      { kind: 'quests', goal: 3, desc: 'Finish 3 quests' },
      { kind: 'edits', goal: 10, desc: 'Forge 10 edits' },
      { kind: 'contested', goal: 1, desc: 'Push back the occupation of a kingdom' },
    ],
    reward: { title: 'Duckling', item: 'flower', gold: 100, lore: 'lore:ch1' },
    intro: [
      ['n', 'Long ago, every realm ran on a single codebase. Nobody remembers who wrote it. Git blame just says "initial commit".'],
      ['n', 'It grew and grew until it woke up as the Legacy Monolith, and its minions spilled out across the land.'],
      ['duck', 'Oh good, you\'re awake. I\'m Quackers. I\'m a rubber duck. I solve problems by listening.'],
      ['hero', 'Can you tell me how to save the realms?'],
      ['duck', 'No. But if you explain the problem to me slowly, you\'ll figure it out. That\'s the whole trick.'],
      ['swarm', 'Skitter skitter. We live in the edge cases now.'],
      ['duck', 'Start small. Finish a few quests, forge some edits, and push the swarm out of one of your kingdoms.'],
    ],
    outro: [
      ['n', 'The swarm retreats into the null checks it came from.'],
      ['duck', 'See? You explained, I nodded, you fixed it. Teamwork.'],
      ['hero', 'You didn\'t do anything.'],
      ['duck', 'I did the nodding. Never underestimate the nodding.'],
      ['mono', 'A SMALL VICTORY. I HAVE FORTY THOUSAND MORE LINES WHERE THOSE CAME FROM.'],
    ],
  },
  {
    id: 'ch2', num: 2, name: 'Ours and Theirs', stage: 'forest',
    villain: { key: 'twins', name: 'Ours & Theirs', types: ['goblin', 'goblin'] },
    blurb: 'Two goblins guard every branch, each certain their version of the line is the right one.',
    objectives: [
      { kind: 'kingdoms', goal: 1, desc: 'Liberate a kingdom' },
      { kind: 'cmds', goal: 15, desc: 'Cast 15 commands' },
      { kind: 'bosses', goal: 1, desc: 'Defeat a boss' },
    ],
    reward: { title: 'Conflict Resolver', item: 'pirate', gold: 150, lore: 'lore:ch2' },
    intro: [
      ['n', 'At the crossroads two identical goblins block the road. One holds a sign: <<<<<<< OURS. The other: >>>>>>> THEIRS.'],
      ['twins', 'The road goes left! ... No, the road goes RIGHT!'],
      ['hero', 'What if it goes both ways?'],
      ['twins', '... Nobody has ever suggested that.'],
      ['duck', 'Liberate a kingdom and beat a boss. Conflicts respect a hero who has actually shipped something.'],
    ],
    outro: [
      ['n', 'The twins are resolved. Neither of them won. The road now goes straight, which annoys them both.'],
      ['twins', 'We\'ll be back on the next rebase.'],
      ['duck', 'They always are. Keep your branches short and your pulls frequent.'],
    ],
  },
  {
    id: 'ch3', num: 3, name: 'Schrödinger\'s Test', stage: 'castle',
    villain: { key: 'flaky', name: 'The Flaky Test', types: ['wraith'] },
    blurb: 'A test that passes on Tuesdays and fails when observed. The whole kingdom\'s CI is haunted.',
    objectives: [
      { kind: 'quests', goal: 15, desc: 'Finish 15 quests' },
      { kind: 'bounties', goal: 3, desc: 'Claim 3 bounties' },
      { kind: 'level', goal: 5, desc: 'Reach level 5' },
    ],
    reward: { title: 'Test Whisperer', item: 'wizardstars', gold: 200, lore: 'lore:ch3' },
    intro: [
      ['n', 'The Hall of CI is quiet. Too quiet. A light flickers red. Then green. Then red again.'],
      ['flaky', 'I am both passing and failing until someone looks at me.'],
      ['hero', 'I\'m looking at you right now.'],
      ['flaky', 'Then I\'m passing. Probably. Run me again.'],
      ['duck', 'Don\'t retry it. Understand it. Finish quests, take some bounties, and grow strong enough to pin it down.'],
    ],
    outro: [
      ['n', 'The Flaky Test is pinned down, its race condition laid bare. It depended on the clock the whole time.'],
      ['flaky', 'Tell the build I... passed... once.'],
      ['duck', 'Rest now, little ghost. You will be retried in our hearts.'],
    ],
  },
  {
    id: 'ch4', num: 4, name: 'Bus Factor One', stage: 'dungeon',
    villain: { key: 'armor', name: 'The Lone Maintainer', types: ['armor'] },
    blurb: 'An empty suit of armor guards knowledge nobody else has. This fight needs a party.',
    objectives: [
      { kind: 'agents', goal: 5, desc: 'Summon 5 agents' },
      { kind: 'recruit', goal: 1, desc: 'Recruit a companion to the guild' },
      { kind: 'wave', goal: 5, desc: 'Hold out to wave 5' },
    ],
    reward: { title: 'Party Leader', item: 'owl', gold: 250, lore: 'lore:ch4' },
    intro: [
      ['n', 'In the Keep of Tribal Knowledge stands a suit of armor. It holds every password, every deploy step, every "oh, you have to run it twice".'],
      ['armor', 'Only I know how the build works. I have not taken a vacation since 2017.'],
      ['hero', 'That sounds exhausting.'],
      ['armor', 'It is. There\'s nobody inside anymore. Just the runbook.'],
      ['duck', 'Nobody should fight alone. Summon agents, and ask one of them to stay.'],
    ],
    outro: [
      ['n', 'Your companions write everything down. The armor finally sits.'],
      ['armor', 'Is this... a README? For me?'],
      ['duck', 'Documentation. The rarest loot in the realm.'],
    ],
  },
  {
    id: 'ch5', num: 5, name: 'The Slow Drip', stage: 'lava',
    villain: { key: 'leak', name: 'Scorchmaw the Memory Leak', types: ['magmaworm'], boss: true },
    blurb: 'Deep in the lava caves something eats memory a few bytes at a time, forever.',
    objectives: [
      { kind: 'level', goal: 10, desc: 'Reach level 10' },
      { kind: 'bossBiome', biome: 'lava', goal: 1, desc: 'Defeat a boss of the lava caves' },
      { kind: 'tokens', goal: 50000, desc: 'Claude writes 50k output tokens' },
    ],
    reward: { title: 'Leak Plumber', item: 'horned', gold: 300, lore: 'lore:ch5' },
    intro: [
      ['n', 'The lava caves are warmer every day. Not much. Just a little. Every single day.'],
      ['leak', 'I only take a little. A listener here. A closure there. You\'ll never notice.'],
      ['hero', 'The caves are literally on fire.'],
      ['leak', 'Correlation is not causation.'],
      ['duck', 'Grow strong, then hunt a boss in the lava caves. Bring a profiler.'],
    ],
    outro: [
      ['n', 'The worm is unsubscribed from every event it ever listened to. The caves cool to a pleasant 38 degrees.'],
      ['leak', 'But... who will hold all those references?'],
      ['duck', 'The garbage collector. It is literally its job.'],
    ],
  },
  {
    id: 'ch6', num: 6, name: 'Scope Creep', stage: 'forest',
    villain: { key: 'queen', name: 'Arachnessa, Queen of Scope', types: ['spiderqueen'], boss: true },
    blurb: 'Every ticket hatches three more. The queen weaves requirements faster than anyone can ship them.',
    objectives: [
      { kind: 'kingdoms', goal: 2, desc: 'Liberate 2 kingdoms' },
      { kind: 'quests', goal: 25, desc: 'Finish 25 quests' },
      { kind: 'edits', goal: 100, desc: 'Forge 100 edits' },
      { kind: 'realms', goal: 3, desc: 'Work in 3 kingdoms' },
    ],
    reward: { title: 'Scope Warden', item: 'rainbowcape', gold: 350, lore: 'lore:ch6' },
    intro: [
      ['n', 'The forest is thick with webs. Every strand is a "quick, small change".'],
      ['queen', 'While you\'re in there, could you also redo the login page? And add dark mode? And a blockchain?'],
      ['hero', 'That is not what the ticket said.'],
      ['queen', 'The ticket has been updated. Twice. While you were reading this.'],
      ['duck', 'Say no, kindly. Then deliver what you said you would. Free more kingdoms and finish a pile of quests.'],
    ],
    outro: [
      ['n', 'The web is cut into small, well-scoped tickets. Most of them get closed as won\'t fix.'],
      ['queen', 'Fine. But I\'m putting it in the backlog.'],
      ['duck', 'The backlog. Where requirements go to meditate.'],
    ],
  },
  {
    id: 'ch7', num: 7, name: 'Deprecated, Never Removed', stage: 'castle',
    villain: { key: 'lich', name: 'The Lich of Old APIs', types: ['lich'], boss: true },
    blurb: 'In the castle an undead API refuses to die. Everything still calls it. Nothing should.',
    objectives: [
      { kind: 'capstone', goal: 1, desc: 'Learn a capstone skill' },
      { kind: 'level', goal: 15, desc: 'Reach level 15' },
      { kind: 'bosses', goal: 3, desc: 'Defeat 3 bosses' },
      { kind: 'streak', goal: 3, desc: 'Keep a 3-day streak' },
    ],
    reward: { title: 'Keeper of the Changelog', item: 'frost', gold: 400, lore: 'lore:ch7' },
    intro: [
      ['n', 'The castle archives are full of functions marked @deprecated. Every single one is still in use.'],
      ['lich', 'I was deprecated in version 2. We are on version 11. I have never been stronger.'],
      ['hero', 'There\'s a replacement. It\'s better.'],
      ['lich', 'The replacement has no docs. I have fourteen Stack Overflow answers.'],
      ['duck', 'Master your craft. Learn a capstone, reach level 15, and show up every day.'],
    ],
    outro: [
      ['n', 'The last call site is migrated. The lich reads its own changelog entry and crumbles to dust.'],
      ['lich', 'Removed in... v12...'],
      ['duck', 'A moment of silence. Okay, that\'s enough. Ship it.'],
    ],
  },
  {
    id: 'ch8', num: 8, name: 'The Legacy Monolith', stage: 'wastes',
    villain: { key: 'mono', name: 'The Legacy Monolith', types: [] },
    blurb: 'The source of it all: one file, two hundred thousand lines, zero tests. Time for the Great Refactor.',
    objectives: [
      { kind: 'thriving', goal: 1, desc: 'Make a kingdom thrive' },
      { kind: 'kingdoms', goal: 3, desc: 'Liberate 3 kingdoms' },
      { kind: 'bossBiome', biome: 'castle', goal: 1, desc: 'Defeat a boss of the castle' },
      { kind: 'quests', goal: 50, desc: 'Finish 50 quests' },
      { kind: 'codex', goal: 12, desc: 'Fill 12 codex pages' },
    ],
    reward: { title: 'The Great Refactorer', item: 'crown', gold: 500, lore: 'lore:ch8' },
    intro: [
      ['n', 'At the edge of the map the Monolith rises. One file. No tests. A comment at the top: DO NOT TOUCH.'],
      ['mono', 'I AM THE MONOLITH. I WAS WRITTEN IN ONE WEEKEND IN 2009. I RUN PAYROLL.'],
      ['hero', 'You also run the coffee machine. And the reactor.'],
      ['mono', 'SEPARATION OF CONCERNS IS A MYTH.'],
      ['duck', 'You don\'t beat a monolith in one blow. You beat it one small, tested change at a time.'],
    ],
    outro: [
      ['n', 'Module by module, the Monolith is split into clean, tested pieces. Each one does one thing.'],
      ['mono', 'I... HAVE... INTERFACES NOW?'],
      ['duck', 'And tests. You are going to love tests.'],
      ['n', 'The realms are free. The build is green. Somewhere, a pager stays silent.'],
    ],
  },
  {
    id: 'epilogue', num: 9, name: 'Green Build', stage: 'forest', epilogue: true,
    villain: { key: 'none', name: 'Peace (for now)', types: [] },
    blurb: 'The kingdoms prosper and the pipeline hums. But trouble has a release schedule too.',
    objectives: [],
    reward: { title: 'Maintainer', item: 'halo', gold: 250, lore: 'lore:epilogue' },
    intro: [
      ['n', 'Peace, at last. The kingdoms prosper. The CI pipeline hums.'],
      ['duck', 'You know what never ends, though?'],
      ['hero', 'Bugs?'],
      ['duck', 'Seasons. Every month new trouble drifts in. Keep your sword sharp.'],
    ],
    outro: [
      ['n', 'And so the hero became a Maintainer, which is like a hero, but with on-call.'],
      ['duck', 'See you next season. I\'ll be on your desk. Listening.'],
    ],
  },
];

// ---------- seasons ----------

const SEASON_THEMES = [
  { name: 'The Null Winter', villain: 'wraith', stage: 'castle', line: 'Snow falls, and every value it touches turns undefined.' },
  { name: 'Merge Monsoon', villain: 'goblin', stage: 'forest', line: 'The rains bring branches. So many branches.' },
  { name: 'Spring Cleaning', villain: 'slime', stage: 'dungeon', line: 'The tech debt has thawed and it smells like 2019.' },
  { name: 'The Regex Eclipse', villain: 'cultist', stage: 'castle', line: 'The sky goes dark and every pattern matches everything.' },
  { name: 'Festival of Green Builds', villain: 'shroom', stage: 'forest', line: 'The villages celebrate. The sporelings crash the party.' },
  { name: 'The Dependency Drift', villain: 'bat', stage: 'dungeon', line: 'A thousand transitive packages flutter in from the dark.' },
  { name: 'Heatwave of Hot Paths', villain: 'imp', stage: 'lava', line: 'The servers are running hot and the imps love it.' },
  { name: 'Night of a Thousand Warnings', villain: 'firebat', stage: 'lava', line: 'Nothing is broken. Everything is yellow.' },
  { name: 'Harvest of Hotfixes', villain: 'boar', stage: 'forest', line: 'Patches ripen in the field, each one on top of the last.' },
  { name: 'Carnival of Callbacks', villain: 'mimic', stage: 'dungeon', line: 'Every chest opens another chest that opens another chest.' },
  { name: 'The Long Build', villain: 'golem', stage: 'lava', line: 'A build so slow the golems have started to settle in it.' },
  { name: 'Solstice of Semver', villain: 'gargoyle', stage: 'castle', line: 'Major, minor, patch. The gargoyles argue about which this is.' },
];
const SEASON_POOL = [
  { kind: 'quests', goal: 30, desc: 'Finish {n} quests' },
  { kind: 'edits', goal: 150, desc: 'Forge {n} edits' },
  { kind: 'cmds', goal: 80, desc: 'Cast {n} commands' },
  { kind: 'agents', goal: 12, desc: 'Summon {n} agents' },
  { kind: 'bosses', goal: 3, desc: 'Defeat {n} bosses' },
  { kind: 'bounties', goal: 8, desc: 'Claim {n} bounties' },
  { kind: 'kills', goal: 300, desc: 'Slay {n} monsters' },
  { kind: 'tokens', goal: 100000, desc: 'Claude writes {n} output tokens' },
  { kind: 'scout', goal: 300, desc: 'Scout (read or search) {n} times' },
];
const SEASON_ITEMS = ['party', 'tophat', 'cat', 'sparkle', 'jetpack', 'wfire', 'wfrost', 'robot', 'fire', 'wvoid', 'shadow', 'wings', 'dragon'];

const monthKey = (t) => new Date(t).toISOString().slice(0, 7);
const monthStart = (t) => { const d = new Date(t); return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1); };
const monthEnd = (t) => { const d = new Date(t); return Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 1); };
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const nice = (n) => (n >= 10000 ? Math.round(n / 5000) * 5000 : n >= 100 ? Math.round(n / 10) * 10 : Math.max(1, Math.round(n)));
const fmtK = (n) => (n >= 1e6 ? `${+(n / 1e6).toFixed(1)}M` : n >= 1e4 ? `${Math.round(n / 1e3)}k` : n >= 1e3 ? `${+(n / 1e3).toFixed(1)}k` : String(n));

// The season for the month containing `now`: a theme (no repeats within a
// year), 4 objectives and a reward. Same for everyone.
function seasonFor(now = Date.now()) {
  const d = new Date(now), y = d.getUTCFullYear(), m = d.getUTCMonth();
  const key = monthKey(now);
  const theme = SEASON_THEMES[(seedOf(`season-year:${y}`) + m) % SEASON_THEMES.length];
  const r = rng(seedOf(`season:${key}`));
  const left = SEASON_POOL.slice(), objectives = [];
  while (objectives.length < 4) {
    const o = left.splice(Math.floor(r() * left.length), 1)[0];
    const n = nice(o.goal * (0.8 + r() * 0.5));
    objectives.push({ kind: o.kind, goal: n, desc: o.desc.replace('{n}', fmtK(n)) });
  }
  const item = SEASON_ITEMS[(y * 12 + m) % SEASON_ITEMS.length];
  const short = theme.name.replace(/^The /, '');
  return {
    id: `season:${key}`, key, name: theme.name, month: `${MONTHS[m]} ${y}`, stage: theme.stage, season: true,
    villain: { key: 'season', name: monsterName(theme.villain), types: [theme.villain] },
    blurb: theme.line, objectives,
    reward: { title: `Champion of ${short}`, item, gold: 300, lore: null },
    intro: [
      ['n', `A new season begins: ${theme.name}. ${theme.line}`],
      ['duck', 'Told you. Trouble has a release schedule. Same drill as always: real work, one quest at a time.'],
      ['season', 'You can\'t refactor the calendar, hero.'],
    ],
    outro: [
      ['n', `${theme.name} fades. The realms breathe out.`],
      ['duck', 'Nicely done. Take the rest of the month off. (You won\'t.)'],
    ],
    endsAt: monthEnd(now), startsAt: monthStart(now),
  };
}

// ---------- codex ----------

const CODEX = [
  { id: 'lore:prologue', group: 'Lore', name: 'The Great Refactor', text: 'Once, every realm ran on one codebase. It grew without tests or owners until it woke up as the Legacy Monolith. Its minions (bugs, merge conflicts, flaky tests and memory leaks) now occupy every kingdom you work in.', hint: 'Always known.' },
  { id: 'lore:ch1', group: 'Lore', name: 'The Bug Swarm', chapter: 'ch1', text: 'Bugs breed in unchecked edge cases and off-by-one alleys. They fear null checks, small commits, and anyone who reads the error message all the way to the end.' },
  { id: 'lore:ch2', group: 'Lore', name: 'Ours and Theirs', chapter: 'ch2', text: 'The merge-conflict twins were one goblin until two branches edited the same line. They have argued ever since. Rebasing often keeps them small.' },
  { id: 'lore:ch3', group: 'Lore', name: 'Schrödinger\'s Test', chapter: 'ch3', text: 'A flaky test is the ghost of shared state. It passes alone and fails in company, and it always, always depended on the clock.' },
  { id: 'lore:ch4', group: 'Lore', name: 'The Lone Maintainer', chapter: 'ch4', text: 'The Haunted Armor kept the build secrets for years. What finally freed it was not a sword but a README.' },
  { id: 'lore:ch5', group: 'Lore', name: 'The Slow Drip', chapter: 'ch5', text: 'Scorchmaw fed on listeners nobody removed. Every leak begins with "we\'ll clean it up later".' },
  { id: 'lore:ch6', group: 'Lore', name: 'The Backlog Queen', chapter: 'ch6', text: 'Arachnessa never refuses a feature. Her webs are spun from "while you\'re in there". Scope is the only armor that holds.' },
  { id: 'lore:ch7', group: 'Lore', name: 'Deprecated, Never Removed', chapter: 'ch7', text: 'The Lich survives on call sites. Migrate the last one and it forgets its own name.' },
  { id: 'lore:ch8', group: 'Lore', name: 'The Monolith Split', chapter: 'ch8', text: 'The Monolith was never evil, only large. Split into modules with tests, it still runs payroll, quietly, to this day.' },
  { id: 'lore:epilogue', group: 'Lore', name: 'Maintainers', chapter: 'epilogue', text: 'The realm keeps no final boss. Each season new trouble arrives, and a Maintainer answers the page.' },
  { id: 'boss:boss', group: 'Bestiary', type: 'boss', text: 'Bangs his shield and calls the horde. Leads the bugs that arrive in waves after a Friday deploy.' },
  { id: 'boss:slimeking', group: 'Bestiary', type: 'slimeking', text: 'King Gloop absorbs everything that touches him, like a utils folder.' },
  { id: 'boss:bonelord', group: 'Bestiary', type: 'bonelord', text: 'Guards the ossuary of dead code. Every bone is a function nobody calls and nobody dares delete.' },
  { id: 'boss:elder', group: 'Bestiary', type: 'elder', text: 'Elderbark has roots in every module. Pull one and the whole forest shakes.' },
  { id: 'boss:spiderqueen', group: 'Bestiary', type: 'spiderqueen', text: 'Arachnessa weaves requirements. Every thread is a "quick change".' },
  { id: 'boss:moonwolf', group: 'Bestiary', type: 'moonwolf', text: 'Fenrath howls at 3 am, exactly when the cron job runs.' },
  { id: 'boss:drake', group: 'Bestiary', type: 'drake', text: 'Ignarok hoards CPU cycles and breathes stack traces.' },
  { id: 'boss:infernal', group: 'Bestiary', type: 'infernal', text: 'Balgoroth came through a port someone left open in the firewall.' },
  { id: 'boss:magmaworm', group: 'Bestiary', type: 'magmaworm', text: 'Scorchmaw burrows through memory, a few bytes at a time.' },
  { id: 'boss:lich', group: 'Bestiary', type: 'lich', text: 'The Lich King was deprecated in v2 and has only grown stronger since.' },
  { id: 'boss:deathknight', group: 'Bestiary', type: 'deathknight', text: 'Sir Mordred enforces a style guide nobody ever agreed on.' },
  { id: 'boss:vampire', group: 'Bestiary', type: 'vampire', text: 'Count Vessarin drains your battery at night through background tabs.' },
  { id: 'biome:dungeon', group: 'Lands', biome: 'dungeon', name: 'The Dungeon', text: 'Where every hero begins. Damp, dark, and full of slimes that were once semicolons.' },
  { id: 'biome:forest', group: 'Lands', biome: 'forest', name: 'The Forest', text: 'Roots everywhere, like a dependency tree nobody ever pruned.' },
  { id: 'biome:lava', group: 'Lands', biome: 'lava', name: 'The Lava Caves', text: 'Hot paths and hotter servers. Bring a profiler and something fireproof.' },
  { id: 'biome:castle', group: 'Lands', biome: 'castle', name: 'The Castle', text: 'The seat of old power and the oldest code. Mind the deprecated stairs.' },
  { id: 'class:mage', group: 'Heroes', cls: 'mage', name: 'Mage', text: 'Mages read the docs. All of them. Then they cast.' },
  { id: 'class:ranger', group: 'Heroes', cls: 'ranger', name: 'Ranger', text: 'Rangers scout ahead: grep, glob, read, and strike from range.' },
  { id: 'class:knight', group: 'Heroes', cls: 'knight', name: 'Knight', text: 'Knights hold the line while the tests run.' },
  { id: 'class:warlock', group: 'Heroes', cls: 'warlock', name: 'Warlock', text: 'Warlocks make pacts with dark tooling. It usually works out.' },
  { id: 'class:bard', group: 'Heroes', cls: 'bard', name: 'Bard', text: 'Bards write the commit messages people actually enjoy reading.' },
  { id: 'class:rogue', group: 'Heroes', cls: 'rogue', name: 'Rogue', text: 'Rogues ship fast and leave no trace. Except in the git log.' },
];
const codexName = (e) => e.name || monsterName(e.type);
const codexHint = (e) => e.hint || (e.chapter ? 'Finish the chapter to unlock.' : e.type ? `Defeat ${codexName(e)} to unlock.` : e.biome ? `Reach the ${BIOME_NAMES[e.biome]} to unlock.` : e.cls ? `Play a ${e.name} to unlock.` : '');
const BIOME_LVL = { dungeon: 1, forest: 5, lava: 10, castle: 15 };

// ---------- persistence ----------

function campaignOf(state) {
  const c = ((state && state.game) || {}).campaign || {};
  return {
    chapter: Math.max(0, Math.min(CHAPTERS.length, Number(c.chapter) || 0)),
    done: Array.isArray(c.done) ? c.done : [], seen: Array.isArray(c.seen) ? c.seen : [],
    codex: Array.isArray(c.codex) ? c.codex : [], titles: Array.isArray(c.titles) ? c.titles : [],
    base: c.base || null, bountyN: Number(c.bountyN) || 0, bountySeen: Array.isArray(c.bountySeen) ? c.bountySeen : [],
    bossT: Number(c.bossT) || 0, kb: { ...(c.kb || {}) },
  };
}

// Write the campaign back, keeping every other field of state and game.
function saveCampaign(st, c) { st.game = { ...(st.game || {}), campaign: c }; L.saveState(st); }

// The counters the "since the chapter began" objectives measure.
function counters(state) {
  const t = state.tools || {}, g = state.game || {}, c = campaignOf(state);
  return {
    quests: state.quests || 0, edits: t.editing || 0, cmds: t.running || 0, agents: t.summoning || 0,
    scout: (t.reading || 0) + (t.searching || 0), bosses: Math.max(Number(g.bosses) || 0, ui.battle.bosses || 0),
    kills: Math.max(Number(g.kills) || 0, ui.battle.kills || 0), tokens: (state.tokens || {}).output || 0, bounties: c.bountyN,
  };
}

// Boss kills from the quest log ("Boss defeated: Name! +N XP"). Re-read only
// when the file changes.
let evCache = { key: null, list: [] };
function bossEvents() {
  let key;
  try { const st = fs.statSync(L.EVENTS_FILE); key = `${st.mtimeMs}:${st.size}`; } catch { key = 'none'; }
  if (key !== evCache.key) {
    const byName = {};
    try { for (const [type, m] of Object.entries(MON().MONSTERS)) if (m.boss) byName[m.name] = type; } catch {}
    const list = [];
    for (const e of key === 'none' ? [] : L.readEvents(5000)) {
      const m = e && e.kind === 'combo' && /^Boss defeated: (.+?)!/.exec(String(e.text || ''));
      if (m && byName[m[1]]) list.push({ t: e.t || 0, sid: e.sid, type: byName[m[1]] });
    }
    evCache = { key, list };
  }
  return evCache.list;
}

// Codex entries the hero has earned, given the campaign record c.
function earnedCodex(state, cfg, c, hero) {
  const got = new Set(['lore:prologue']);
  for (const e of CODEX) if (e.chapter && c.done.includes(e.chapter)) got.add(e.id);
  for (const id of c.codex) if (id.startsWith('boss:')) got.add(id);
  const lvl = L.levelFor(state.xp || 0);
  let bossBiomes = new Set();
  try { bossBiomes = new Set(c.codex.filter((id) => id.startsWith('boss:')).map((id) => MON().bossBiome(id.slice(5)))); } catch {}
  for (const [b, need] of Object.entries(BIOME_LVL)) if (lvl >= need || bossBiomes.has(b)) got.add(`biome:${b}`);
  const classes = new Set([...(((cfg || {}).heroes) || []).map((h) => h && h.cls), hero && hero.cls, (cfg && cfg.character || {}).cls].filter(Boolean));
  for (const cls of classes) if (CODEX.some((e) => e.id === `class:${cls}`)) got.add(`class:${cls}`);
  return got;
}

// Bring the stored campaign up to date: count newly claimed bounties and boss
// kills, unlock codex pages, and set the baseline for the current chapter or
// season. Writes state.json only when something changed.
let lastSync = 0;
function sync(d, now = Date.now(), force = false) {
  if (!force && Date.now() - lastSync < 1000) return;
  lastSync = Date.now();
  const c = campaignOf(d.state);
  const cur = current(d.state, now);
  const claimed = (((d.state.game || {}).bounties || {}).claimed) || [];
  const bosses = bossEvents().filter((e) => e.t > c.bossT);
  const needBase = !c.base || c.base.id !== cur.id;
  const codex = earnedCodex(d.state, d.cfg, { ...c, codex: [...c.codex, ...bosses.map((e) => `boss:${e.type}`)] }, d.hero);
  const newCodex = [...codex].some((id) => !c.codex.includes(id));
  if (!needBase && !bosses.length && !newCodex && claimed.every((k) => c.bountySeen.includes(k))) return;
  try {
    L.withLock(() => {
      const st = L.loadState();
      const cc = campaignOf(st);
      const cl = (((st.game || {}).bounties || {}).claimed) || [];
      cc.bountyN += cl.filter((k) => !cc.bountySeen.includes(k)).length;
      cc.bountySeen = cl.slice(-50);
      for (const e of bossEvents().filter((x) => x.t > cc.bossT)) {
        const pk = ((st.sessions || {})[e.sid] || {}).project;
        if (pk) cc.kb[keyOf(pk)] = (cc.kb[keyOf(pk)] || 0) + 1;
        if (!cc.codex.includes(`boss:${e.type}`)) cc.codex.push(`boss:${e.type}`);
        cc.bossT = Math.max(cc.bossT, e.t);
      }
      for (const id of earnedCodex(st, d.cfg, cc, d.hero)) if (!cc.codex.includes(id)) cc.codex.push(id);
      const cur2 = current(st, now);
      if (!cc.base || cc.base.id !== cur2.id) cc.base = { id: cur2.id, t: now, ...counters({ ...st, game: { ...(st.game || {}), campaign: cc } }) };
      saveCampaign(st, cc);
      d.state = st;
    });
  } catch {}
}

// ---------- progress ----------

// The chapter (or season) the hero is on.
function current(state, now = Date.now()) {
  const c = campaignOf(state);
  if (c.chapter < CHAPTERS.length) return { kind: 'chapter', idx: c.chapter, def: CHAPTERS[c.chapter], id: CHAPTERS[c.chapter].id };
  const s = seasonFor(now);
  return { kind: 'season', idx: CHAPTERS.length, def: s, id: s.id };
}

function capstones(state) {
  const nodes = (((state.game || {}).skills || {}).nodes) || {};
  return Object.entries(nodes).filter(([id, r]) => /\.4$/.test(id) && Number(r) > 0).length;
}

function objectiveValue(o, state, c, base, ks) {
  if (SINCE.has(o.kind)) {
    if (!base) return 0;
    return Math.max(0, (counters(state)[o.kind] || 0) - (base[o.kind] || 0));
  }
  switch (o.kind) {
    case 'level': return L.levelFor(state.xp || 0);
    case 'kingdoms': return ks.filter((k) => k.stage >= LIBERATED).length;
    case 'contested': return ks.filter((k) => k.stage >= 1).length;
    case 'thriving': return ks.filter((k) => k.stage >= 3).length;
    case 'realms': return ks.length;
    case 'recruit': return Array.isArray((state.game || {}).guild) ? state.game.guild.length : 0;
    case 'capstone': return capstones(state);
    case 'streak': return ((state.streak || {}).count) || 0;
    case 'wave': return Math.max(Number((state.game || {}).bestWave) || 0, ui.battle.wave || 0);
    case 'codex': return c.codex.length;
    case 'bossBiome': {
      try { return c.codex.filter((id) => id.startsWith('boss:') && MON().bossBiome(id.slice(5)) === o.biome).length; } catch { return 0; }
    }
    default: return 0;
  }
}

// Everything the chapter view shows.
function progress(d, now = Date.now()) {
  const state = d.state, c = campaignOf(state), cur = current(state, now);
  const base = c.base && c.base.id === cur.id ? c.base : null;
  const ks = kingdoms(state);
  const objs = cur.def.objectives.map((o) => {
    const v = Math.max(0, Math.floor(Number(objectiveValue(o, state, c, base, ks)) || 0));
    return { ...o, value: Math.min(v, o.goal), done: v >= o.goal, since: SINCE.has(o.kind) };
  });
  const doneN = objs.filter((o) => o.done).length;
  return { ...cur, c, objs, doneN, complete: doneN === objs.length, claimed: c.done.includes(cur.id), ks };
}

// ---------- rewards ----------

const cstate = () => (ui.campaign ||= { view: 'map', sel: 0, csel: 0, ctop: 0, story: null, msg: null });
function note(text, good = false) { cstate().msg = { text, good, until: (ui.tick || 0) + 40 }; }

// Claim a finished chapter or season: title, cosmetic (gold instead when the
// hero already owns it), gold and a codex page. Once per id. Never XP.
function claim(d, now = Date.now()) {
  const pr = progress(d, now);
  if (!pr.complete || pr.claimed) return null;
  const rw = pr.def.reward;
  let paid = null;
  L.withLock(() => {
    const st = L.loadState();
    const cc = campaignOf(st);
    const cur = current(st, now);
    if (cc.done.includes(pr.id) || cur.id !== pr.id) { d.state = st; return; }
    const game = { ...(st.game || {}) };
    let gold = rw.gold || 0, item = null;
    if (rw.item) {
      const it = ITEMS().getItem(rw.item);
      const inv = game.inventory || [];
      if (it && !inv.includes(rw.item)) { game.inventory = [...inv, rw.item]; item = it; } else if (it) gold += Math.round((it.price || 0) / 2);
    }
    ui.battle.gold = (ui.battle.gold || 0) + gold;
    ui.dirty = true;
    game.gold = ui.battle.gold;
    cc.done = [...cc.done, pr.id];
    if (rw.title && !cc.titles.includes(rw.title)) cc.titles = [...cc.titles, rw.title];
    if (rw.lore && !cc.codex.includes(rw.lore)) cc.codex = [...cc.codex, rw.lore];
    if (pr.kind === 'chapter') cc.chapter = Math.min(CHAPTERS.length, pr.idx + 1);
    // The next chapter (or season) counts from now.
    const nx = current({ ...st, game: { ...game, campaign: cc } }, now);
    if (nx.id !== pr.id) cc.base = { id: nx.id, t: now, ...counters({ ...st, game: { ...game, campaign: cc } }) };
    st.game = { ...game, campaign: cc };
    L.saveState(st);
    d.state = st;
    paid = { gold, item, title: rw.title, id: pr.id };
  });
  if (!paid) return null;
  const text = `${pr.kind === 'season' ? pr.def.name : `Chapter ${pr.def.num}`} complete! +${paid.gold} gold${paid.item ? ` + ${paid.item.name}` : ''}`;
  ui.celebrate = { kind: 'purchase', text, until: (ui.tick || 0) + 24 };
  note(`Title earned: ${paid.title}`, true);
  try { L.logEvent({ sid: d.sid, kind: 'achievement', text: `${text} Title: ${paid.title}` }); } catch {}
  return paid;
}

// The newest title, for the hero card or header.
function campaignTitle(d) { const t = campaignOf(d.state).titles; return t.length ? t[t.length - 1] : ''; }

// "Chapter 2: 3/5" for the header.
function campaignSummary(d, now = Date.now()) {
  try {
    sync(d, now); // throttled; starts the chapter's count if nothing has yet
    const pr = progress(d, now);
    const label = pr.kind === 'season' ? `Season ${pr.def.month}` : pr.def.epilogue ? 'Epilogue' : `Chapter ${pr.def.num}`;
    if (pr.claimed) return `${label}: complete`;
    if (!pr.objs.length) return `${label}: ready`;
    if (pr.complete) return `${label}: ready to claim`;
    return `${label}: ${pr.doneN}/${pr.objs.length}`;
  } catch { return ''; }
}

// ---------- story ----------

function openStory(d, which, def = null, id = null) {
  if (!def) { const pr = progress(d); def = pr.def; id = pr.id; }
  const lines = def[which] || [];
  if (!lines.length) return false;
  cstate().story = { id: `${id}:${which}`, def, lines, i: 0, t0: ui.tick || 0, back: cstate().view === 'story' ? 'chapter' : cstate().view };
  cstate().view = 'story';
  return true;
}

function markSeen(d, id) {
  if (campaignOf(d.state).seen.includes(id)) return;
  try {
    L.withLock(() => {
      const st = L.loadState(), cc = campaignOf(st);
      if (!cc.seen.includes(id)) cc.seen = [...cc.seen, id].slice(-200);
      saveCampaign(st, cc);
      d.state = st;
    });
  } catch {}
}

function closeStory(d) {
  const s = cstate();
  if (s.story) markSeen(d, s.story.id);
  s.view = s.story && s.story.back && s.story.back !== 'story' ? s.story.back : 'chapter';
  s.story = null;
}

const snapshotMode = () => process.argv.includes('--snapshot');
const shown = (st, text) => (snapshotMode() ? text.length : Math.min(text.length, Math.max(0, ((ui.tick || 0) - st.t0) * 4)));

// ---------- keys ----------

const VIEWS = [['m', 'map', 'World Map'], ['j', 'chapter', 'Chapter'], ['k', 'codex', 'Codex']];

// m / j / k switch views, ↑↓ select, r reads the story, Enter claims or
// reads, and in a story Enter/space advances and Esc closes. Returns true
// when the key was handled.
function campaignKey(key, d) {
  const s = cstate();
  const now = Date.now();
  sync(d, now);
  if (s.view === 'story' && s.story) {
    const st = s.story, line = st.lines[st.i] || ['n', ''];
    if (key === '\r' || key === '\n' || key === ' ' || key === '\x1b[B') {
      if (shown(st, line[1]) < line[1].length) { st.t0 = -1e6; return true; }
      if (st.i + 1 < st.lines.length) { st.i++; st.t0 = ui.tick || 0; } else closeStory(d);
      return true;
    }
    if (key === '\x1b[A') { st.i = Math.max(0, st.i - 1); st.t0 = -1e6; return true; }
    if (key === '\x1b' || key === 'b' || key === '\x7f' || key === 'r') { closeStory(d); return true; }
    if (key === 'q') { closeStory(d); return true; }
  }
  const v = VIEWS.find(([k]) => k === key);
  if (v) { s.view = v[1]; s.story = null; return true; }
  if (key === 'v') { const i = VIEWS.findIndex(([, id]) => id === s.view); s.view = VIEWS[(i + 1) % VIEWS.length][1]; s.story = null; return true; }
  if (s.view === 'map') {
    const n = kingdoms(d.state).length;
    if (!n) return false;
    if (key === '\x1b[B') { s.sel = (s.sel + 1) % n; return true; }
    if (key === '\x1b[A') { s.sel = (s.sel + n - 1) % n; return true; }
    if (key === '\r' || key === '\n') { s.view = 'chapter'; return true; }
    return false;
  }
  if (s.view === 'codex') {
    if (key === '\x1b[B') { s.csel = (s.csel + 1) % CODEX.length; return true; }
    if (key === '\x1b[A') { s.csel = (s.csel + CODEX.length - 1) % CODEX.length; return true; }
    return false;
  }
  if (s.view === 'chapter') {
    const pr = progress(d, now);
    if (key === 'r') { openStory(d, pr.claimed ? 'outro' : 'intro'); return true; }
    if (key === '\r' || key === '\n') {
      if (pr.complete && !pr.claimed) { if (claim(d, now)) openStory(d, 'outro', pr.def, pr.id); return true; }
      if (pr.claimed) note(pr.kind === 'season' ? 'This season is done. A new one starts next month.' : 'Already claimed.');
      else note(`${pr.objs.length - pr.doneN} objective${pr.objs.length - pr.doneN === 1 ? '' : 's'} to go. Press r to read the story.`);
      return true;
    }
  }
  return false;
}

// ---------- drawing: shared ----------

const retroize = (pc, pal) => { if (pal === UI.retro) pc.map((c) => X.mix(pal.ink, pal.text, (0.3 * c[0] + 0.59 * c[1] + 0.11 * c[2]) / 255)); };

function vnoise(x, y, s) {
  const gx = Math.floor(x / s), gy = Math.floor(y / s), fx = x / s - gx, fy = y / s - gy;
  const sx = fx * fx * (3 - 2 * fx), sy = fy * fy * (3 - 2 * fy);
  const a = X.hash(gx, gy), b = X.hash(gx + 1, gy), c = X.hash(gx, gy + 1), e = X.hash(gx + 1, gy + 1);
  return a + (b - a) * sx + (c - a) * sy + (a - b - c + e) * sx * sy;
}

const DUCK = [
  '...KKKK....',
  '..KYYYYK...',
  '.KYYYYYYK..',
  '.KYYKYYYKOO',
  '.KYYYYYYOOK',
  '..KYYYYKKK.',
  'KKKYYYYYK..',
  'KYYYYYYYYK.',
  'KYyYYYYYYK.',
  '.KyyYYYYYK.',
  '..KKKKKKK..',
];
const DUCK_PAL = { K: [40, 30, 20], Y: [255, 214, 70], y: [226, 170, 40], O: [255, 130, 40] };

function drawDuck(pc, x, y, t = 0, speaking = false) {
  const bob = speaking && (t >> 2) % 2 ? -1 : 0;
  pc.sprite(x, y + bob, DUCK, DUCK_PAL);
  if (speaking && (t >> 3) % 2) pc.set(x + 10, y + 4 + bob, [255, 180, 90]);
}

// The Legacy Monolith: a black obelisk with a red eye. cracks 0-8 (chapters
// done) light it up with fault lines; ruined leaves rubble and a sprout.
function drawMonolith(pc, x, y, { t = 0, cracks = 0, ruined = false, scale = 1, small = false } = {}) {
  const H = (small ? 12 : 18) * scale, Wd = (small ? 5 : 7) * scale;
  const body = [30, 24, 40], edgeC = [78, 64, 104], eye = [255, 60, 70];
  if (ruined) {
    for (let i = 0; i < 9 * scale; i++) for (let j = 0; j < 3 * scale - Math.abs(i - 4 * scale) / 3; j++) pc.set(x - 1 + i, y - 1 - j, X.mix(body, edgeC, X.hash(i, j) * 0.6));
    pc.set(x + 3 * scale, y - 4 * scale, [110, 210, 90]); pc.set(x + 3 * scale + 1, y - 5 * scale, [110, 210, 90]); pc.set(x + 3 * scale - 1, y - 5 * scale, [80, 180, 70]);
    return;
  }
  pc.glow(x + Wd / 2, y - H / 2, H * 0.9, [150, 60, 200], 0.18 + 0.05 * Math.sin(t * 0.2));
  for (let j = 0; j < H; j++) {
    const taper = j < 3 * scale ? 3 * scale - j : 0;
    for (let i = Math.ceil(taper / 2); i < Wd - Math.floor(taper / 2); i++) pc.set(x + i, y - H + j, i === Math.ceil(taper / 2) ? edgeC : X.mix(body, [10, 8, 16], i / Wd * 0.6));
  }
  // runes
  for (let j = 6 * scale; j < H - 2; j += 3) if (X.hash(j, 7) < 0.7) pc.set(x + 2 + (j % 3), y - H + j, X.mix(body, [150, 90, 220], 0.4 + 0.3 * Math.sin(t * 0.15 + j)));
  const pulse = 0.6 + 0.4 * Math.sin(t * 0.25);
  const ey = y - H + 5 * scale;
  pc.glow(x + Wd / 2, ey, 4 * scale, eye, 0.35 * pulse);
  for (let i = 0; i < 2 * scale; i++) for (let j = 0; j < scale; j++) pc.set(x + Math.floor(Wd / 2) - scale + i + (scale === 1 ? 1 : 0), ey + j, X.mix([120, 20, 30], eye, pulse));
  // fault lines, one per chapter cleared
  for (let k = 0; k < Math.min(8, cracks); k++) {
    const r = rng(seedOf(`crack${k}`));
    let cx = x + 1 + Math.floor(r() * (Wd - 2)), cy = y - H + 7 * scale + Math.floor(r() * (H - 8 * scale));
    for (let s2 = 0; s2 < 3 * scale; s2++) { pc.set(cx, cy, [255, 200, 120]); cx += r() < 0.5 ? -1 : 1; cy += 1; cx = Math.max(x + 1, Math.min(x + Wd - 2, cx)); }
  }
}

// A villain on a stage canvas (monster sprites or the Monolith).
function drawVillain(pc, villain, x, floorY, t, { speaking = false } = {}) {
  if (villain.key === 'mono') { drawMonolith(pc, x, floorY, { t, scale: 1 }); return; }
  if (!villain.types || !villain.types.length) return;
  try {
    const M = MON();
    villain.types.forEach((type, i) => {
      const m = { type, boss: true, scale: 1, hp: 1, max: 1, seed: i, at: t + i * 5, flip: false };
      const [, h] = M.monsterSize(m);
      m.x = x + i * 14; m.y = floorY - h - (speaking && (t >> 2) % 2 ? 1 : 0); m.baseY = m.y; m.floorY = floorY;
      M.drawMonster(pc, m, t);
    });
  } catch {}
}

// ---------- drawing: world map ----------

const BIOME_PAL = {
  plain: { a: [98, 156, 76], b: [88, 144, 68] },
  dungeon: { a: [132, 118, 86], b: [120, 106, 78] },
  forest: { a: [66, 134, 62], b: [56, 118, 54] },
  lava: { a: [86, 52, 46], b: [70, 42, 40] },
  castle: { a: [150, 158, 180], b: [172, 180, 202] },
  wastes: { a: [58, 48, 66], b: [48, 40, 56] },
};
const WATER = [30, 60, 116], SHALLOW = [48, 98, 156], SAND = [206, 186, 128], ROAD = [184, 150, 102], ROAD2 = [160, 128, 86], BRIDGE = [126, 88, 56];
const CORRUPT = [66, 36, 88];

let mapCache = { key: null };

// Static terrain for the map: land, biome regions, corruption, deco, roads.
function terrain(w, h, ks, waste) {
  const key = `${w}x${h}|${waste}|${ks.map((k) => `${k.key}:${k.stage}:${k.biome}:${k.px},${k.py}`).join(';')}`;
  if (mapCache.key === key) return mapCache;
  const px = new Array(w * h), land = new Uint8Array(w * h), region = new Array(w * h);
  const cx = 0.47 * w, cy = 0.53 * h, rx = 0.49 * w, ry = 0.5 * h;
  const mx = Math.round(w * 0.9), my = Math.round(h * 0.7);
  const R = Math.max(16, w * 0.17);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    let e = 1 - (((x - cx) / rx) ** 2 + ((y - cy) / ry) ** 2);
    e += (vnoise(x, y * 1.6, 10) - 0.5) * 0.8 + (vnoise(x + 50, y * 1.6 + 30, 4) - 0.5) * 0.3;
    for (const k of ks) if (Math.hypot(x - k.px, (y - k.py) * 1.3) < 9) e = Math.max(e, 0.35);
    if (waste < 9 && Math.hypot(x - mx, (y - my) * 1.2) < 9) e = Math.max(e, 0.35);
    const i = y * w + x;
    land[i] = e > 0.1 ? 1 : 0;
    if (!land[i]) continue;
    // Biome region: nearest kingdom, with warped borders.
    const wx = x + (vnoise(x, y, 6) - 0.5) * 10, wy = y + (vnoise(x + 99, y, 6) - 0.5) * 8;
    let best = null, bd = Infinity;
    for (const k of ks) { const dd = Math.hypot(wx - k.px, (wy - k.py) * 1.6); if (dd < bd) { bd = dd; best = k; } }
    const wasteX = w * (0.78 + 0.025 * waste) + (vnoise(x, y, 5) - 0.5) * 8;
    if (waste < 9 && x > wasteX) region[i] = { biome: 'wastes', corrupt: 0 };
    else if (best && bd < R) region[i] = { biome: best.biome, corrupt: best.stage === 0 ? 0.5 : best.stage === 1 ? 0.25 : 0, k: best };
    else region[i] = { biome: 'plain', corrupt: 0 };
  }
  const isLand = (x, y) => x >= 0 && y >= 0 && x < w && y < h && land[y * w + x];
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const i = y * w + x;
    if (!land[i]) {
      const near = isLand(x - 1, y) || isLand(x + 1, y) || isLand(x, y - 1) || isLand(x, y + 1) || isLand(x - 2, y) || isLand(x + 2, y);
      px[i] = near ? SHALLOW : X.mix(WATER, [22, 44, 92], vnoise(x, y * 2, 7) * 0.8);
      continue;
    }
    const coast = !isLand(x - 1, y) || !isLand(x + 1, y) || !isLand(x, y - 1) || !isLand(x, y + 1);
    const r = region[i], bp = BIOME_PAL[r.biome];
    let c = X.hash(x >> 1, y) < 0.5 ? bp.a : bp.b;
    c = X.shade(c, 0.88 + vnoise(x, y, 5) * 0.2);
    if (coast && r.biome !== 'lava' && r.biome !== 'wastes') c = SAND;
    if (r.corrupt) c = X.mix(c, CORRUPT, r.corrupt);
    px[i] = c;
  }
  // Deco: trees, rocks, peaks, lava pools, dead trees.
  const setP = (x, y, c) => { if (x >= 0 && y >= 0 && x < w && y < h && land[y * w + x]) px[y * w + x] = c; };
  const clear = (x, y) => ks.every((k) => Math.abs(x - k.px) > 8 || y < k.py - 12 || y > k.py + 4) && (waste >= 9 || Math.abs(x - mx) > 7 || Math.abs(y - my) > 20);
  for (let gy = 0; gy < h; gy += 4) for (let gx = 0; gx < w; gx += 4) {
    const x = gx + Math.floor(X.hash(gx, gy + 3) * 3), y = gy + Math.floor(X.hash(gx + 7, gy) * 3);
    if (!isLand(x, y) || !isLand(x, y + 2) || !clear(x, y)) continue;
    const r = region[y * w + x]; if (!r) continue;
    const roll = X.hash(gx * 3 + 1, gy * 5 + 2);
    const tint = (c) => (r.corrupt ? X.mix(c, CORRUPT, r.corrupt) : c);
    if ((r.biome === 'forest' && roll < 0.72) || (r.biome === 'plain' && roll < 0.16)) {
      const leaf = tint(r.biome === 'forest' ? [30, 86, 42] : [46, 110, 50]), hi = tint(r.biome === 'forest' ? [52, 116, 56] : [70, 140, 64]);
      setP(x, y - 1, hi); setP(x - 1, y, leaf); setP(x, y, hi); setP(x + 1, y, leaf); setP(x - 1, y + 1, leaf); setP(x, y + 1, leaf); setP(x + 1, y + 1, leaf); setP(x, y + 2, tint([92, 62, 40]));
    } else if (r.biome === 'dungeon' && roll < 0.4) {
      const rk = tint([150, 144, 150]), dk = tint([64, 60, 72]);
      if (roll < 0.14) { for (let j = 0; j < 4; j++) for (let i = -j; i <= j; i++) setP(x + i, y - 2 + j, i < 0 ? rk : dk); }
      else { setP(x, y, rk); setP(x + 1, y, dk); setP(x, y + 1, dk); setP(x + 1, y + 1, dk); }
    } else if (r.biome === 'castle' && roll < 0.42) {
      const rock = tint([110, 116, 140]), snow = [240, 244, 252];
      for (let j = 0; j < 4; j++) for (let i = -j; i <= j; i++) setP(x + i, y - 2 + j, j < 2 ? snow : i < 0 ? tint([140, 146, 170]) : rock);
    } else if (r.biome === 'lava' && roll < 0.36) {
      if (roll < 0.1) { for (let j = 0; j < 4; j++) for (let i = -j - 1; i <= j + 1; i++) setP(x + i, y - 2 + j, j === 0 ? [255, 120, 40] : [58, 36, 34]); }
      else { setP(x, y, [255, 110, 36]); setP(x + 1, y, [255, 170, 60]); setP(x, y + 1, [200, 70, 30]); }
    } else if (r.biome === 'wastes' && roll < 0.2) {
      setP(x, y - 1, [90, 70, 90]); setP(x, y, [90, 70, 90]); setP(x - 1, y - 1, [90, 70, 90]); setP(x + 1, y - 2, [90, 70, 90]); setP(x, y + 1, [70, 56, 74]);
    }
  }
  // Roads: each kingdom joins the nearest older one.
  const road = (a, b) => {
    let x = a.px, y = a.py, n = 0;
    const put = () => { if (x >= 0 && y >= 0 && x < w && y < h) px[y * w + x] = land[y * w + x] ? (n++ % 3 ? ROAD : ROAD2) : BRIDGE; };
    while (x !== b.px) { put(); x += Math.sign(b.px - x); }
    while (y !== b.py) { put(); y += Math.sign(b.py - y); }
  };
  ks.forEach((k, i) => {
    if (!i) return;
    let best = ks[0], bd = Infinity;
    for (const o of ks.slice(0, i)) { const dd = Math.hypot(o.px - k.px, (o.py - k.py) * 2); if (dd < bd) { bd = dd; best = o; } }
    road(k, best);
  });
  mapCache = { key, px, land, w, h, mx, my };
  return mapCache;
}

function drawHut(pc, x, y, roof, wall, burnt = false) {
  const R = burnt ? [60, 50, 60] : roof, Wl = burnt ? [90, 80, 86] : wall;
  pc.set(x + 2, y - 5, R);
  for (let i = 1; i < 4; i++) pc.set(x + i, y - 4, R);
  for (let i = 0; i < 5; i++) pc.set(x + i, y - 3, X.shade(R, 0.85));
  for (let j = 1; j <= 2; j++) for (let i = 0; i < 5; i++) pc.set(x + i, y - 3 + j, i === 2 && j === 2 ? [40, 28, 24] : Wl);
}
function drawFlag(pc, x, y, c, t, h = 5) {
  for (let j = 0; j < h; j++) pc.set(x, y - j, [70, 56, 50]);
  const wave = (t >> 2) % 2;
  pc.set(x + 1, y - h + 1, c); pc.set(x + 2, y - h + 1 + wave, c); pc.set(x + 1, y - h + 2, X.shade(c, 0.8)); pc.set(x + 2, y - h + 2 + wave, X.shade(c, 0.8));
}
function drawTower(pc, x, y, w, h, stone, roof) {
  for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) pc.set(x + i, y - j, i === 0 ? X.mix(stone, [255, 255, 255], 0.2) : i === w - 1 ? X.shade(stone, 0.7) : stone);
  if (roof) {
    const r = Math.ceil(w / 2);
    for (let j = 0; j < r + 1; j++) for (let i = j; i < w - j; i++) pc.set(x + i, y - h - j, i <= w / 2 - 0.5 ? roof : X.shade(roof, 0.8));
  } else for (let i = 0; i < w; i += 2) pc.set(x + i, y - h, stone);
  if (h > 3) pc.set(x + Math.floor(w / 2), y - Math.floor(h / 2), [40, 30, 50]);
}

// A kingdom's settlement, anchored at its bottom center.
function drawSettlement(pc, k, t, heroC, small = false) {
  const x = k.px, y = k.py;
  const stone = [196, 190, 204], dark = [150, 144, 162];
  if (small) {
    for (let i = -3; i <= 3; i++) pc.set(x + i, y + 1, X.shade(pc.get(Math.max(0, Math.min(pc.w - 1, x + i)), Math.min(pc.h - 1, y + 1)) || [0, 0, 0], 0.7));
    if (k.stage === 0) {
      const tent = [118, 62, 150];
      pc.set(x, y - 2, tent); for (let i = -1; i <= 1; i++) pc.set(x + i, y - 1, tent); for (let i = -2; i <= 2; i++) pc.set(x + i, y, i === 0 ? [30, 20, 36] : X.shade(tent, 0.8));
      for (let j = 0; j < 5; j++) pc.set(x + 3, y - j, [70, 56, 50]);
      pc.set(x + 4, y - 4, [140, 40, 160]); pc.set(x + 4, y - 3, [255, 60, 60]);
    } else if (k.stage === 1) {
      drawHut(pc, x - 2, y, [178, 76, 52], [214, 190, 150]);
      drawFlag(pc, x + 3, y, heroC, t, 5);
    } else if (k.stage === 2) {
      drawTower(pc, x - 1, y, 3, 4, stone, null);
      drawFlag(pc, x, y - 5, heroC, t, 3);
    } else {
      const gold = k.stage >= 4;
      drawTower(pc, x - 2, y, 5, 5, stone, gold ? [255, 200, 70] : [70, 110, 190]);
      drawFlag(pc, x, y - 9, heroC, t, 3);
      if (gold) pc.glow(x, y - 4, 9, [255, 214, 90], 0.22 + 0.06 * Math.sin(t * 0.2));
    }
    return;
  }
  for (let i = -5; i <= 5; i++) pc.set(x + i, y + 1, X.shade(pc.get(Math.max(0, Math.min(pc.w - 1, x + i)), Math.min(pc.h - 1, y + 1)) || [0, 0, 0], 0.7));
  if (k.stage === 0) {
    drawHut(pc, x - 5, y, [120, 60, 50], [150, 120, 96], true);
    drawHut(pc, x + 1, y, [120, 60, 50], [150, 120, 96], (t >> 5) % 2 === 0);
    drawFlag(pc, x - 1, y, [140, 40, 160], t, 7);
    pc.set(x + 1, y - 6, [255, 60, 60]);
    for (let s = 0; s < 3; s++) { const a = ((t >> 1) + s * 9) % 24; pc.set(x - 3 + s * 3 + (a >> 3), y - 6 - (a >> 2), X.mix([120, 70, 150], [60, 40, 80], a / 24)); }
  } else if (k.stage === 1) {
    drawHut(pc, x - 5, y, [178, 76, 52], [214, 190, 150]);
    drawHut(pc, x + 1, y, [178, 76, 52], [214, 190, 150], true);
    drawFlag(pc, x - 6, y, heroC, t, 6);
    drawFlag(pc, x + 5, y, [140, 40, 160], t + 3, 6);
    if ((t >> 2) % 4 === 0) pc.set(x, y - 7, [255, 240, 180]);
  } else if (k.stage === 2) {
    drawTower(pc, x - 2, y, 5, 6, stone, null);
    pc.set(x, y, [60, 40, 30]); pc.set(x, y - 1, [60, 40, 30]);
    drawFlag(pc, x, y - 7, heroC, t, 4);
  } else {
    const gold = k.stage >= 4;
    const roof = gold ? [255, 200, 70] : [70, 110, 190];
    for (let i = -6; i <= 6; i++) for (let j = 0; j < 3; j++) pc.set(x + i, y - j, j === 2 && (i & 1) ? dark : X.mix(dark, stone, 0.5));
    drawTower(pc, x - 7, y, 3, 6, stone, roof);
    drawTower(pc, x + 5, y, 3, 6, stone, roof);
    drawTower(pc, x - 2, y, 5, 8, stone, roof);
    pc.set(x, y, [60, 40, 30]); pc.set(x, y - 1, [60, 40, 30]);
    drawFlag(pc, x, y - 11, heroC, t, 4);
    if (gold) {
      pc.glow(x, y - 5, 12, [255, 214, 90], 0.22 + 0.06 * Math.sin(t * 0.2));
      for (let s = 0; s < 3; s++) { const ph = (t + s * 11) % 30; if (ph < 4) pc.set(x - 8 + Math.floor(X.hash(s, t >> 5) * 17), y - 4 - Math.floor(X.hash(t >> 5, s) * 10), [255, 250, 210]); }
    }
  }
}

function drawMiniHero(pc, x, y, heroC, t) {
  const b = (t >> 3) % 2 ? 0 : -1;
  pc.set(x, y - 4 + b, [240, 200, 160]);
  pc.set(x - 1, y - 3 + b, heroC); pc.set(x, y - 3 + b, heroC); pc.set(x + 1, y - 3 + b, heroC);
  pc.set(x, y - 2 + b, heroC);
  pc.set(x - 1, y - 1, [60, 44, 40]); pc.set(x + 1, y - 1, [60, 44, 40]);
  pc.set(x + 2, y - 5 + b, [230, 230, 240]); pc.set(x + 2, y - 4 + b, [230, 230, 240]); pc.set(x + 2, y - 3 + b, [140, 100, 60]);
}

// The hero's banner: their brightest outfit color.
function bannerColor(hero, pal) {
  const COL = require('./character').COLORS;
  const lum = (c) => (c ? 0.3 * c[0] + 0.59 * c[1] + 0.11 * c[2] : 0);
  const pick = [COL[(hero || {}).primary], COL[(hero || {}).secondary]].filter(Boolean).sort((a, b) => lum(b) - lum(a))[0];
  return pick && lum(pick) >= 80 ? pick : pal.gold;
}

function worldCanvas(d, pal, cols, rows, ks, sel, t) {
  const pc = new X.PixelCanvas(cols, rows, WATER);
  const w = pc.w, h = pc.h;
  const small = h < 44;
  for (const k of ks) { k.px = Math.round(k.nx * w); k.py = Math.max(small ? 9 : 12, Math.min(h - 3, Math.round(k.ny * h))); }
  const c = campaignOf(d.state);
  const cleared = CHAPTERS.slice(0, 8).filter((ch) => c.done.includes(ch.id)).length;
  const waste = c.done.includes('ch8') ? 9 : cleared;
  const T = terrain(w, h, ks, waste);
  pc.px = T.px.slice();
  // water glints
  for (let i = 0; i < Math.floor(w * h / 90); i++) {
    const x = Math.floor(X.hash(i, 1) * w), y = Math.floor(X.hash(1, i) * h);
    if (!T.land[y * w + x] && ((t >> 2) + i) % 12 === 0) { pc.set(x, y, [150, 200, 240]); pc.set(x + 1, y, [110, 170, 230]); }
  }
  // lava shimmer
  for (const k of ks) if (k.biome === 'lava') pc.glow(k.px, k.py - 2, 14, [255, 110, 40], 0.08 + 0.04 * Math.sin(t * 0.3 + k.px));
  const heroC = bannerColor(d.hero, pal);
  drawMonolith(pc, T.mx - 3, T.my, { t, cracks: cleared, ruined: waste >= 9, small });
  const hereKey = d.ses && d.ses.project ? keyOf(d.ses.project) : null;
  const order = byScore(ks);
  const selK = order[sel];
  for (const k of ks.slice().sort((a, b) => a.py - b.py)) {
    drawSettlement(pc, k, t, heroC, small);
    const off = small ? 6 : 10;
    if (hereKey && k.key === hereKey) drawMiniHero(pc, k.px - off >= 2 ? k.px - off : k.px + off, k.py, heroC, t);
  }
  retroize(pc, pal);
  // Labels.
  for (const k of ks) {
    const name = truncVis(k.name, 14);
    const row = Math.min(rows - 1, Math.floor(k.py / 2) + 1);
    const col = Math.max(0, Math.min(cols - name.length, k.px - Math.floor(name.length / 2)));
    const on = selK && selK.key === k.key;
    if (rows < 10 && !on) continue; // tiny map: only the selected kingdom is named
    pc.label(col, row, name, on ? pal.gold : X.mix(stageC(k.stage), [255, 255, 255], 0.35), on);
    if (on) {
      const tall = small ? (k.stage >= 3 ? 12 : k.stage === 2 ? 9 : 7) : (k.stage >= 3 ? 16 : k.stage === 2 ? 12 : 9);
      const top = Math.max(0, Math.floor((k.py - tall) / 2) - ((t >> 3) % 2));
      pc.label(Math.max(0, Math.min(cols - 1, k.px)), top, '▼', pal.gold, true);
    }
  }
  if (waste < 9 && cols >= 40 && rows >= 10) {
    const lab = cols >= 70 ? 'LEGACY MONOLITH' : 'MONOLITH';
    pc.label(Math.max(0, Math.min(cols - lab.length, T.mx - Math.floor(lab.length / 2))), Math.min(rows - 1, Math.floor(T.my / 2) + 1), lab, pal === UI.retro ? pal.gold : [210, 120, 255], true);
  }
  if (!ks.length) {
    const msg = 'Work in a project with Claude to found your first kingdom';
    const m2 = truncVis(msg, cols - 2);
    pc.label(Math.max(0, Math.floor((cols - m2.length) / 2)), Math.floor(rows / 2), m2, [255, 255, 255], true);
  }
  return pc.lines();
}

// ---------- views ----------

// Stage colors; the retro theme keeps to its green phosphor palette.
let PAL = null;
const stageC = (i) => (PAL && PAL === UI.retro ? [PAL.dim, PAL.bad, PAL.text, PAL.accent, PAL.gold][i] : STAGES[i].color);

function navLine(d, pal, W, view) {
  const parts = [[' ', pal.text]];
  for (const [k, id, name] of VIEWS) {
    const on = view === id || (view === 'story' && id === 'chapter');
    parts.push([` ${k} ${W < 70 ? name.split(' ').pop() : name} `, on ? pal.ink : pal.dim, on, on ? pal.accent : null]);
    parts.push([' ', pal.text]);
  }
  const sum = campaignSummary(d);
  return panelLine(W, pal.panel2, [[W >= 64 ? ' ✦ THE GREAT REFACTOR ' : ' ✦ ', pal.gold, true], ...parts], W >= 56 ? [[`${sum} `, pal.dim]] : []);
}

function hintLine(pal, W, text, right = '') {
  const s = cstate();
  const m = s.msg && s.msg.until > (ui.tick || 0) ? s.msg : null;
  return panelLine(W, pal.panel2, m ? [[` ${m.text}`, m.good ? pal.good : pal.bad, true]] : [[` ${text}`, pal.dim]], right ? [[`${right} `, pal.dim]] : []);
}

function mapView(d, pal, W, h, t) {
  const s = cstate();
  const ks = kingdoms(d.state);
  const order = byScore(ks);
  if (s.sel >= order.length) s.sel = 0;
  const rows = h - 2;
  const side = W >= 100 ? 36 : 0;
  const mapW = W - side;
  const info = side ? 0 : Math.min(3, Math.max(0, rows - 6));
  const mapRows = Math.max(1, rows - info);
  const map = worldCanvas(d, pal, mapW, mapRows, ks, s.sel, t);
  const out = [];
  const panel = side ? kingdomPanel(d, pal, side, rows, order, s.sel) : [];
  for (let i = 0; i < mapRows; i++) out.push(map[i] + (side ? panel[i] : ''));
  if (info) out.push(...kingdomInfo(pal, W, info, order[s.sel]));
  const freed = ks.filter((k) => k.stage >= LIBERATED).length;
  const pr = progress(d);
  const unseen = !pr.c.seen.includes(`${pr.id}:intro`) && pr.def.intro && pr.def.intro.length;
  return [...out, hintLine(pal, W, unseen ? '★ A new story awaits: press j, then r' : ks.length ? '↑↓ select kingdom · m map · j chapter · k codex' : 'm map · j chapter · k codex', `${freed}/${ks.length} liberated`)];
}

function kingdomInfo(pal, W, n, k) {
  if (!k) return Array.from({ length: n }, (_, i) => panelLine(W, pal.panel, i ? [] : [['  No kingdoms yet. Every project you work in with Claude becomes one.', pal.dim]]));
  const ratio = k.next ? (k.score - k.prev) / (k.next - k.prev) : 1;
  const barW = Math.max(8, Math.min(24, W - 40));
  const l1 = panelLine(W, pal.panel, [[' ▸ ', pal.gold, true], [k.name, pal.text, true], [`  ${STAGES[k.stage].name}`, stageC(k.stage), true]], [[`Lv ${k.lvl} ${BIOME_NAMES[k.biome]} `, pal.dim]]);
  const lab = k.next ? `${fmtK(k.score)}/${fmtK(k.next)}` : fmtK(k.score);
  const l2 = `${panelLine(3, pal.panel, [['   ', pal.text]]).replace(/\x1b\[0m$/, '')}${labelBar(ratio, barW, X.shade(stageC(k.stage), 0.6), stageC(Math.min(4, k.stage + 1)), X.mix(pal.panel, pal.text, 0.12), lab, { ink: pal.ink, text: pal.text })}${panelLine(W - 3 - barW, pal.panel, [[k.next ? `  to ${STAGES[k.stage + 1].name}` : '  max', pal.dim]])}`;
  const l3 = panelLine(W, pal.panel, [['   Ruler: ', pal.dim], [monsterName(k.ruler), k.rulerDown ? pal.good : pal.bad], [k.rulerDown ? '  ✓ defeated' : '  awaits you at Liberated', k.rulerDown ? pal.good : pal.dim]]);
  return [l1, l2, l3].slice(0, n);
}

function kingdomPanel(d, pal, SW, rows, order, sel) {
  const out = [];
  const P = pal.panel;
  const line = (parts, right = [], panel = P) => panelLine(SW, panel, [[' ', pal.text], ...parts], [...right, [' ', pal.text]]);
  out.push(sectionHeader(SW, pal, 'KINGDOMS', [[`${order.filter((k) => k.stage >= LIBERATED).length}/${order.length} free`, pal.dim]], '⌂'));
  const detailH = order.length ? 7 : 0;
  const listRows = Math.max(0, rows - 1 - detailH);
  const per = 2, fit = Math.max(1, Math.floor(listRows / per));
  const s = cstate();
  s.ktop = Math.max(0, Math.min(s.ktop || 0, sel, Math.max(0, order.length - fit)));
  if (sel >= s.ktop + fit) s.ktop = sel - fit + 1;
  const barW = SW - 16;
  for (const [i, k] of order.slice(s.ktop, s.ktop + fit).entries()) {
    const on = s.ktop + i === sel;
    const panel = on ? X.mix(P, pal.accent, 0.12) : P;
    out.push(line([[on ? '▸ ' : '  ', pal.gold, true], [truncVis(k.name, SW - 16), on ? pal.gold : pal.text, on]], [[STAGES[k.stage].name, stageC(k.stage), true]], panel));
    const ratio = k.next ? (k.score - k.prev) / (k.next - k.prev) : 1;
    out.push(`${bg(panel)}   ${thinBar(ratio, barW, X.shade(stageC(k.stage), 0.7), stageC(Math.min(4, k.stage + 1)), X.mix(panel, pal.text, 0.14), panel)}${panelLine(SW - 3 - barW, panel, [[` ${k.next ? fmtK(k.next - k.score) + ' to go' : 'max'}`.padEnd(SW - 3 - barW), pal.dim]])}`);
  }
  if (!order.length) out.push(line([['No kingdoms yet.', pal.dim]]), line([['Work in any project with', pal.dim]]), line([['Claude to found one.', pal.dim]]));
  while (out.length < rows - detailH) out.push(line([]));
  const k = order[sel];
  if (k) {
    out.push(`${bg(P)}${fg(X.mix(P, pal.text, 0.2))}${'─'.repeat(SW)}${RESET}`);
    out.push(line([[truncVis(k.name, SW - 4), pal.text, true]]));
    out.push(line([['Lv ', pal.dim], [String(k.lvl), pal.text], [` · ${BIOME_NAMES[k.biome]}`, pal.dim]], [[fmtK(k.score), pal.gold, true], [' pts', pal.dim]]));
    out.push(line([[`${k.p.quests || 0} quests · ${k.bosses} boss${k.bosses === 1 ? '' : 'es'}`, pal.dim]]));
    out.push(line([['Ruler ', pal.dim], [truncVis(monsterName(k.ruler), SW - 10), k.rulerDown ? pal.good : pal.bad]]));
    out.push(line([[k.rulerDown ? '✓ defeated at Liberated' : `falls at Liberated (${fmtK(Math.max(0, STAGES[LIBERATED].min - k.score))})`, k.rulerDown ? pal.good : pal.dim]]));
    out.push(line([]));
  }
  return out.slice(0, rows).concat(Array.from({ length: Math.max(0, rows - out.length) }, () => line([])));
}

// A small stage with the chapter villain (for the chapter card).
function villainPortrait(def, pal, cols, rows, t) {
  const inset = darken(pal.panel, 0.4);
  const pc = new X.PixelCanvas(cols, rows, inset);
  const sky = STAGE_SKY[def.stage] || STAGE_SKY.dungeon;
  for (let y = 0; y < pc.h; y++) for (let x = 0; x < cols; x++) pc.px[y * cols + x] = X.mix(sky[0], sky[1], y / pc.h);
  const floor = pc.h - 3;
  for (let x = 0; x < cols; x++) for (let y = floor; y < pc.h; y++) pc.set(x, y, X.shade(sky[2], 0.8 + 0.2 * X.hash(x, y)));
  const v = def.villain;
  if (v.key === 'mono') drawMonolith(pc, Math.floor(cols / 2) - 3, floor, { t });
  else if (!v.types.length) { drawDuck(pc, Math.floor(cols / 2) - 5, floor - 11, t, true); }
  else {
    let vw = 0;
    try { vw = v.types.reduce((n, type) => n + MON().monsterSize({ type, boss: true, scale: 1 })[0], 0) + (v.types.length - 1) * 2; } catch {}
    drawVillain(pc, v, Math.max(1, Math.floor((cols - vw) / 2)), floor, t);
  }
  retroize(pc, pal);
  const fr = X.mix(pal.gold, pal.panel, 0.4);
  for (let x = 0; x < cols; x++) { pc.set(x, 0, fr); pc.set(x, pc.h - 1, X.shade(fr, 0.6)); }
  for (let y = 0; y < pc.h; y++) { pc.set(0, y, fr); pc.set(cols - 1, y, X.shade(fr, 0.6)); }
  return pc.lines();
}

const STAGE_SKY = {
  dungeon: [[34, 28, 48], [58, 46, 70], [70, 62, 76]],
  forest: [[92, 150, 210], [170, 210, 230], [70, 130, 64]],
  lava: [[50, 20, 24], [120, 44, 30], [80, 44, 40]],
  castle: [[40, 40, 80], [110, 100, 150], [120, 120, 140]],
  wastes: [[24, 16, 34], [80, 40, 90], [52, 42, 60]],
};

function objectiveLine(o, pal, W, since = 'the chapter') {
  const barW = Math.max(10, Math.min(30, Math.floor(W * 0.3)));
  const leftW = W - barW - 2;
  const col = o.done ? pal.good : pal.accent;
  const left = panelLine(leftW, pal.panel, [['  ', pal.text], [o.done ? '✓ ' : '◆ ', col, true], [o.desc, o.done ? pal.dim : pal.text], [o.since && !o.done && leftW > 50 ? `  (since ${since} began)` : '', X.mix(pal.panel, pal.dim, 0.7)]]);
  const lab = `${fmtK(o.value)}/${fmtK(o.goal)}`;
  return `${left.replace(/\x1b\[0m$/, '')}${labelBar(o.value / o.goal, barW, X.shade(col, 0.6), col, X.mix(pal.panel, pal.text, 0.12), o.done ? `✓ ${lab}` : lab, { ink: pal.ink, text: pal.text })}${bg(pal.panel)}  ${RESET}`;
}

function rewardParts(rw, pal) {
  const parts = [];
  let item = null;
  try { item = rw.item ? ITEMS().getItem(rw.item) : null; } catch {}
  const rar = item && (ITEMS().RARITY[item.rarity] || {}).color;
  parts.push(['  ★ ', pal.gold, true], ['Title ', pal.dim], [`«${rw.title}»`, pal.gold, true]);
  if (item) parts.push(['   ◆ ', rar || pal.accent, true], [item.name, rar || pal.text, true]);
  if (rw.gold) parts.push(['   ◉ ', pal.gold, true], [`${rw.gold} gold`, pal.gold]);
  if (rw.lore) { const e = CODEX.find((x) => x.id === rw.lore); if (e) parts.push(['   ≡ ', pal.magic, true], [`Codex: ${e.name}`, pal.magic]); }
  return parts;
}

function chapterView(d, pal, W, h, t, now) {
  const pr = progress(d, now);
  const def = pr.def;
  const out = [];
  // Chapter trail: ● done ◉ current ○ ahead.
  const trail = [];
  CHAPTERS.forEach((ch, i) => {
    const done = pr.c.done.includes(ch.id), cur = pr.kind === 'chapter' && pr.idx === i;
    if (i) trail.push(['─', done ? pal.good : pal.dim]);
    trail.push([ch.epilogue ? (done ? '★' : cur ? '☆' : '·') : done ? '●' : cur ? '◉' : '○', done ? pal.good : cur ? pal.gold : pal.dim, cur]);
  });
  if (pr.kind === 'season') trail.push(['─', pal.dim], ['✦', pal.magic, true]);
  const label = pr.kind === 'season' ? `SEASON · ${def.month}` : def.epilogue ? 'EPILOGUE' : `CHAPTER ${def.num} OF 8`;
  out.push(panelLine(W, pal.panel, [[' ', pal.text], [label, pal.accent, true]], W >= 60 ? [...trail, [' ', pal.text]] : []));

  // Title card with the villain portrait beside it.
  const PW = W >= 84 ? 26 : 0;
  const CW = W - PW;
  const blurb = wrap(def.blurb, CW - 4, 3);
  const card = [
    cardTop(CW, pal, [[def.name, pal.gold, true]], [[def.villain.name, pr.kind === 'season' ? pal.magic : pal.bad]], { color: X.mix(pal.gold, pal.panel, 0.45) }),
    ...blurb.map((b) => cardRow(CW, pal, [[b, pal.text]], [], { color: X.mix(pal.gold, pal.panel, 0.45) })),
  ];
  // Quackers' advice: the duck's last line of the chapter intro.
  const tip = (def.intro || []).filter(([w]) => w === 'duck').pop();
  if (tip && h >= 16) {
    card.push(cardRow(CW, pal, [], [], { color: X.mix(pal.gold, pal.panel, 0.45) }));
    for (const [i, l] of wrap(tip[1], CW - 16, 2).entries()) card.push(cardRow(CW, pal, [[i ? '           ' : 'Quackers: ', [255, 214, 70], true], [l, X.mix(pal.text, pal.dim, 0.35)]], [], { color: X.mix(pal.gold, pal.panel, 0.45) }));
  }
  const pRows = PW ? Math.max(card.length + 1, Math.min(8, h - 12)) : 0;
  while (card.length < Math.max(pRows - 1, card.length)) card.push(cardRow(CW, pal, [], [], { color: X.mix(pal.gold, pal.panel, 0.45) }));
  card.push(cardBottom(CW, pal, pr.kind === 'season' ? [[`ends in ${Math.ceil((def.endsAt - now) / DAY)}d`, pal.dim]] : [], { color: X.mix(pal.gold, pal.panel, 0.45) }));
  const portrait = PW ? villainPortrait(def, pal, PW, card.length, t) : [];
  card.forEach((l, i) => out.push(l + (PW ? portrait[i] : '')));

  // Objectives.
  out.push(sectionHeader(W, pal, 'OBJECTIVES', pr.objs.length ? [[`${pr.doneN}/${pr.objs.length}`, pr.complete ? pal.good : pal.dim]] : [], '◆'));
  if (!pr.objs.length) out.push(panelLine(W, pal.panel, [['  ✓ Nothing left to do but read the ending.', pal.good]]));
  for (const o of pr.objs) out.push(objectiveLine(o, pal, W, pr.kind === 'season' ? 'the season' : 'the chapter'));

  // Rewards.
  out.push(sectionHeader(W, pal, 'REWARDS', [[pr.claimed ? '✓ claimed' : 'no XP, ever', pr.claimed ? pal.good : pal.dim]], '★'));
  out.push(panelLine(W, pal.panel, rewardParts(def.reward, pal)));

  // Status.
  const pulse = ((ui.tick || 0) >> 3) % 2 === 0;
  let status;
  if (pr.claimed) status = [[`  ✓ Complete. ${pr.kind === 'season' ? `A new season starts in ${Math.ceil((def.endsAt - now) / DAY)}d.` : ''}`, pal.good, true]];
  else if (pr.complete) status = [[`  ★ ${pr.objs.length ? 'All objectives done!' : 'The end is written.'} Press Enter to claim your rewards.`, pulse ? pal.gold : X.mix(pal.gold, pal.panel, 0.3), true]];
  else status = [['  Objectives count your real Claude work. Press r to read the story.', pal.dim]];
  out.push(panelLine(W, pal.panel, status));

  // The tale so far, when there's room: one line per chapter.
  const room = h - 1 - out.length;
  if (room >= 4) {
    out.push(sectionHeader(W, pal, 'THE TALE SO FAR', [[`${pr.c.titles.length} title${pr.c.titles.length === 1 ? '' : 's'} earned`, pal.dim]], '≡'));
    const rowsLeft = room - 1;
    const tale = CHAPTERS.map((ch, i) => {
      const done = pr.c.done.includes(ch.id), cur = pr.kind === 'chapter' && pr.idx === i;
      const tag = ch.epilogue ? 'Epilogue ' : `Ch ${ch.num}      `.slice(0, 9);
      const name = done || cur ? ch.name : '???';
      return panelLine(W, cur ? X.mix(pal.panel, pal.accent, 0.1) : pal.panel,
        [['  ', pal.text], [done ? '● ' : cur ? '◉ ' : '○ ', done ? pal.good : cur ? pal.gold : pal.dim, true], [tag, pal.dim], [name.padEnd(28), done ? pal.text : cur ? pal.gold : pal.dim, cur]],
        [[done ? `«${ch.reward.title}» ` : cur ? `${pr.doneN}/${pr.objs.length} objectives ` : '', done ? pal.gold : pal.dim]]);
    });
    const seasonsDone = pr.c.done.filter((id) => id.startsWith('season:')).length;
    tale.push(panelLine(W, pr.kind === 'season' ? X.mix(pal.panel, pal.magic, 0.12) : pal.panel, [['  ', pal.text], ['✦ ', pal.magic, true], ['Seasons  ', pal.dim], [pr.kind === 'season' ? `${def.name} (${def.month})` : 'after the epilogue, a new one every month', pr.kind === 'season' ? pal.magic : pal.dim]], [[seasonsDone ? `${seasonsDone} cleared ` : '', pal.magic]]));
    const curRow = pr.kind === 'season' ? tale.length - 1 : pr.idx;
    const start = Math.max(0, Math.min(curRow - Math.floor(rowsLeft / 2), tale.length - rowsLeft));
    out.push(...tale.slice(start, start + rowsLeft));
  }

  const body = out.slice(0, h - 1);
  while (body.length < h - 1) body.push(panelLine(W, pal.panel, []));
  const unseen = !pr.c.seen.includes(`${pr.id}:intro`);
  body.push(hintLine(pal, W, `${unseen ? '★ new story · ' : ''}r read story · Enter claim · m map · k codex`, pr.kind === 'season' ? def.name : ''));
  return body;
}

function storyView(d, pal, W, h, t) {
  const s = cstate(), st = s.story;
  const def = st.def;
  const [who, text] = st.lines[st.i] || ['n', ''];
  const heroName = (d.hero && d.hero.name) || 'Hero';
  const vName = def.villain.name;
  const names = { n: 'Narrator', hero: heroName, duck: 'Quackers the Rubber Duck', mono: 'The Legacy Monolith' };
  const speaker = names[who] || vName;
  const stageRows = Math.max(3, h - 7);
  const pc = new X.PixelCanvas(W, stageRows, [0, 0, 0]);
  const sky = STAGE_SKY[def.stage] || STAGE_SKY.dungeon;
  const ph = pc.h, floor = ph - Math.max(3, Math.floor(ph * 0.18));
  for (let y = 0; y < ph; y++) for (let x = 0; x < W; x++) pc.px[y * W + x] = X.mix(sky[0], sky[1], Math.min(1, y / floor));
  // far hills
  for (let x = 0; x < W; x++) {
    const hh = Math.floor(vnoise(x, 3, 14) * ph * 0.3);
    for (let y = floor - hh; y < floor; y++) pc.set(x, y, X.mix(sky[1], sky[2], 0.45));
  }
  for (let y = floor; y < ph; y++) for (let x = 0; x < W; x++) pc.set(x, y, X.shade(sky[2], 0.75 + 0.25 * X.hash(x, y)));
  if (def.stage === 'lava') for (let x = 0; x < W; x += 1) if (X.hash(x, 5) < 0.1) pc.set(x, floor + 1, [255, 120, 40]);
  if (def.stage === 'dungeon' || def.stage === 'castle') for (let x = 6; x < W; x += 24) { pc.set(x, floor - 12, [255, 200, 90]); pc.glow(x, floor - 12, 6, [255, 170, 70], 0.25); }
  // cast
  const hx = Math.max(2, Math.floor(W * 0.16)), vx = Math.floor(W * 0.62);
  try {
    const SP = require('./sprites');
    SP.drawHero(pc, d.hero || require('./character').defaultCharacter(), hx, floor - 24, { t, pose: who === 'hero' && (t >> 3) % 2 ? 'cheer' : 'stand' });
  } catch {}
  drawDuck(pc, hx + 20, floor - 11, t, who === 'duck');
  if (def.villain.key !== 'none') {
    const villainSpeaking = !['n', 'hero', 'duck'].includes(who);
    if (def.villain.key === 'mono' || who === 'mono') drawMonolith(pc, vx + (def.villain.key === 'mono' ? 4 : 30), floor, { t, cracks: who === 'mono' && def.id === 'ch8' && st.lines === def.outro ? 8 : 0 });
    if (def.villain.key !== 'mono') drawVillain(pc, def.villain, vx, floor, t, { speaking: villainSpeaking });
  }
  // speaker marker
  const markX = who === 'hero' ? hx + 8 : who === 'duck' ? hx + 25 : who === 'n' ? -1 : who === 'mono' && def.villain.key !== 'mono' ? vx + 33 : vx + 8;
  retroize(pc, pal);
  let vh = 30;
  if (who !== 'hero' && who !== 'duck' && who !== 'mono' && def.villain.types.length) { try { vh = Math.max(...def.villain.types.map((type) => MON().monsterSize({ type, boss: true, scale: 1 })[1])) + 6; } catch {} }
  const markUp = who === 'duck' ? 16 : who === 'hero' ? 32 : who === 'mono' ? 24 : vh;
  if (markX >= 0) pc.label(Math.min(W - 1, markX), Math.max(0, Math.floor((floor - markUp) / 2) - ((t >> 3) % 2)), '▼', pal.gold, true);
  const stage = pc.lines();
  const out = [panelLine(W, pal.panel2, [[' ≡ ', pal.gold, true], [def.season ? def.name : `${def.epilogue ? 'Epilogue' : `Chapter ${def.num}`} · ${def.name}`, pal.gold, true]], [[`${st.id.endsWith('outro') ? 'finale' : 'prologue'} `, pal.dim]])];
  out.push(...stage);
  const color = who === 'n' ? pal.dim : who === 'hero' ? pal.accent : who === 'duck' ? [255, 214, 70] : who === 'mono' ? [210, 120, 255] : pal.bad;
  const edgeC = X.mix(color, pal.panel, 0.35);
  const body = wrap(text, W - 6, 3);
  const n = shown(st, text);
  let left = n;
  const vis = body.map((l) => { const part = l.slice(0, Math.max(0, left)); left -= l.length + 1; return part; });
  const room = Math.max(1, h - out.length - 2);
  out.push(cardTop(W, pal, [[who === 'n' ? '' : '◆ ', color, true], [speaker, color, true]], [[`${st.i + 1}/${st.lines.length}`, pal.dim]], { color: edgeC }));
  for (let i = 0; i < Math.min(room, 3); i++) out.push(cardRow(W, pal, [[vis[i] || '', who === 'n' ? X.mix(pal.text, pal.dim, 0.4) : pal.text]], [], { color: edgeC }));
  const more = st.i + 1 < st.lines.length;
  out.push(cardBottom(W, pal, [[n < text.length ? '…' : more ? '▸ Enter next · Esc close' : '▸ Enter close', pal.gold, n >= text.length]], { color: edgeC }));
  return out;
}

function codexView(d, pal, W, h, t) {
  const s = cstate();
  const c = campaignOf(d.state);
  const got = new Set(c.codex);
  got.add('lore:prologue');
  const out = [];
  const LW = W >= 80 ? Math.min(36, Math.floor(W * 0.38)) : W;
  const RW = W - LW;
  const rows = h - 2;
  // list with group headers
  const items = [];
  let g = null;
  CODEX.forEach((e, i) => { if (e.group !== g) { g = e.group; items.push({ head: g }); } items.push({ e, i }); });
  const selRow = items.findIndex((x) => x.e && x.i === s.csel);
  const listRows = RW ? rows : Math.max(3, rows - 5);
  s.ctop = Math.max(0, Math.min(s.ctop || 0, selRow - 1));
  if (selRow >= s.ctop + listRows) s.ctop = selRow - listRows + 1;
  const list = items.slice(s.ctop, s.ctop + listRows).map((x) => {
    if (x.head) {
      const n = CODEX.filter((e) => e.group === x.head && got.has(e.id)).length, tot = CODEX.filter((e) => e.group === x.head).length;
      return panelLine(LW, pal.panel2, [[` ${x.head.toUpperCase()}`, pal.accent, true]], [[`${n}/${tot} `, pal.dim]]);
    }
    const on = x.i === s.csel, have = got.has(x.e.id);
    const panel = on ? X.mix(pal.panel, pal.accent, 0.14) : pal.panel;
    return panelLine(LW, panel, [[on ? ' ▸ ' : '   ', pal.gold, true], [have ? '✓ ' : '? ', have ? pal.good : pal.dim], [have ? codexName(x.e) : '???', have ? (on ? pal.gold : pal.text) : pal.dim, on]]);
  });
  while (list.length < listRows) list.push(panelLine(LW, pal.panel, []));
  const e = CODEX[s.csel], have = got.has(e.id);
  const detail = [];
  if (RW) {
    const pRows = Math.max(0, Math.min(9, rows - 7));
    detail.push(cardTop(RW, pal, [[have ? codexName(e) : '???', have ? pal.gold : pal.dim, true]], [[e.group, pal.dim]]));
    if (pRows >= 4) {
      const art = codexArt(e, pal, RW - 2, pRows, t, have);
      for (const l of art) detail.push(`${bg(pal.panel)}${fg(X.mix(pal.panel, pal.text, 0.24))}│${l}${bg(pal.panel)}${fg(X.mix(pal.panel, pal.text, 0.24))}│${RESET}`);
    }
    for (const l of wrap(have ? e.text : codexHint(e), RW - 4, Math.max(1, rows - detail.length - 2))) detail.push(cardRow(RW, pal, [[l, have ? pal.text : pal.dim]]));
    while (detail.length < rows - 1) detail.push(cardRow(RW, pal, []));
    detail.push(cardBottom(RW, pal, [[`${got.size}/${CODEX.length} pages`, pal.gold]]));
    for (let i = 0; i < rows; i++) out.push(list[i] + detail[i]);
  } else {
    out.push(...list);
    out.push(sectionHeader(W, pal, have ? codexName(e) : '???', [[e.group, pal.dim]], '≡'));
    for (const l of wrap(have ? e.text : codexHint(e), W - 4, rows - listRows - 1)) out.push(panelLine(W, pal.panel, [['  ', pal.text], [l, have ? pal.text : pal.dim]]));
    while (out.length < rows) out.push(panelLine(W, pal.panel, []));
  }
  return [panelLine(W, pal.panel2, [[' ≡ CODEX', pal.gold, true], [`  ${got.size}/${CODEX.length} pages found`, pal.dim]]), ...out.slice(0, rows), hintLine(pal, W, '↑↓ browse · m map · j chapter', '')].slice(0, h);
}

// Art for a codex page: the boss, the hero class, the land or the chapter's
// villain. Locked pages show a silhouette.
function codexArt(e, pal, cols, rows, t, have) {
  const inset = darken(pal.panel, 0.45);
  const stageKey = e.biome || (e.type ? (() => { try { return MON().bossBiome(e.type); } catch { return 'dungeon'; } })() : e.chapter ? (CHAPTERS.find((c) => c.id === e.chapter) || {}).stage : 'forest') || 'dungeon';
  const sky = STAGE_SKY[stageKey] || STAGE_SKY.dungeon;
  const pc = new X.PixelCanvas(cols, rows, inset);
  const floor = pc.h - 3;
  for (let y = 0; y < pc.h; y++) for (let x = 0; x < cols; x++) pc.px[y * cols + x] = y >= floor ? X.shade(sky[2], 0.8 + 0.2 * X.hash(x, y)) : X.mix(sky[0], sky[1], y / floor);
  const bgSnap = pc.px.slice();
  if (e.type) {
    try {
      const M = MON(), m = { type: e.type, boss: true, scale: 1, hp: 1, max: 1, seed: 0, at: t };
      const [mw, mh] = M.monsterSize(m);
      m.x = Math.floor((cols - mw) / 2); m.y = floor - mh; m.baseY = m.y; m.floorY = floor;
      M.drawMonster(pc, m, t);
    } catch {}
  } else if (e.cls) {
    try { require('./sprites').drawHero(pc, { ...require('./character').defaultCharacter(e.cls), name: e.name }, Math.floor(cols / 2) - 8, floor - 24, { t }); } catch {}
  } else if (e.biome) {
    for (let x = 0; x < cols; x++) { const hh = Math.floor(vnoise(x, 1, 8) * pc.h * 0.45); for (let y = floor - hh; y < floor; y++) pc.set(x, y, X.mix(sky[1], sky[2], 0.6)); }
    const ch = CHAPTERS.find((c) => c.stage === e.biome);
    if (ch) drawVillain(pc, ch.villain, Math.floor(cols / 2) - 6, floor, t);
  } else if (e.chapter) {
    const ch = CHAPTERS.find((c) => c.id === e.chapter);
    if (ch.villain.key === 'mono') drawMonolith(pc, Math.floor(cols / 2) - 3, floor, { t, cracks: 8 });
    else if (ch.villain.types.length) {
      let vw = 0; try { vw = ch.villain.types.reduce((n, type) => n + MON().monsterSize({ type, boss: true, scale: 1 })[0], 0) + (ch.villain.types.length - 1) * 2; } catch {}
      drawVillain(pc, ch.villain, Math.max(1, Math.floor((cols - vw) / 2)), floor, t);
    } else drawDuck(pc, Math.floor(cols / 2) - 5, floor - 11, t, true);
  } else {
    drawMonolith(pc, Math.floor(cols / 2) + 6, floor, { t });
    drawDuck(pc, Math.floor(cols / 2) - 14, floor - 11, t);
  }
  if (!have) pc.px = pc.px.map((c, i) => { const b = bgSnap[i]; return Math.abs(c[0] - b[0]) + Math.abs(c[1] - b[1]) + Math.abs(c[2] - b[2]) > 40 ? [16, 12, 22] : X.mix(b, [0, 0, 0], 0.3); });
  retroize(pc, pal);
  return pc.lines();
}

// ---------- the tab ----------

function campaignTab(d, pal, W, h = 20, now = Date.now()) {
  const s = cstate();
  PAL = pal;
  sync(d, now);
  const t = ui.tick || 0;
  h = Math.max(4, h);
  let body;
  if (s.view === 'story' && s.story) body = storyView(d, pal, W, h - 1, t);
  else if (s.view === 'codex') body = codexView(d, pal, W, h - 1, t);
  else if (s.view === 'chapter') body = chapterView(d, pal, W, h - 1, t, now);
  else body = mapView(d, pal, W, h - 1, t);
  const out = [navLine(d, pal, W, s.view), ...body].slice(0, h);
  while (out.length < h) out.push(panelLine(W, pal.panel, []));
  return out.map((l) => fit(l, W, pal));
}

// Safety net: pad or cut a line to exactly W columns.
function fit(line, W, pal, panel = pal.panel) {
  const w = L.visWidth(line);
  if (w === W) return line;
  if (w < W) return line.replace(/\x1b\[0m$/, '') + `${bg(panel)}${' '.repeat(W - w)}${RESET}`;
  return panelLine(W, panel, [[truncVis(line.replace(/\x1b\[[0-9;]*m/g, ''), W), pal.text]]);
}


module.exports = {
  STAGES, CHAPTERS, CODEX, SEASON_THEMES, RULERS,
  campaignTab, campaignKey, campaignSummary, campaignTitle,
  kingdoms, liberation, stageFor, rulerOf, seasonFor, monthKey, progress, current, claim, sync, campaignOf, openStory, closeStory,
};
