// App entry: token + API, the SSE stream, the render loop, and the chrome
// around the scene (top bar, hotbar, HUD overlays, quest log, approvals,
// keyboard). The other tabs live in tabs.js.

import { Scene } from './scene.js';
import { heroCanvas, companionCanvas, C } from './pixelart.js';
import { $, $$, el, fmt, stripIcons, reducedMotion } from './util.js';
import { renderTab, TAB_KEYS } from './tabs.js';

// ---------- API ----------

const TOKEN = new URLSearchParams(location.search).get('t') || '';
const withT = (p) => `${p}${p.includes('?') ? '&' : '?'}t=${encodeURIComponent(TOKEN)}`;
export async function api(path, body) {
  const res = await fetch(withT(path), body ? { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Arcade-Token': TOKEN }, body: JSON.stringify(body) } : { headers: { 'X-Arcade-Token': TOKEN } });
  let data = null;
  try { data = await res.json(); } catch {}
  if (!res.ok && !data) throw new Error(`HTTP ${res.status}`);
  return data || {};
}

export const app = { assets: null, snap: null, ev: null, tab: 'Adventure', scene: null, busy: false };

export const SPELL_ICON = {
  fireball: '●', frost: '◇', chain: '≈', meteor: '▼', starfall: '☼', multishot: '≡', snare: '#', pierce: '→', rain: '↓', eagle: '∧',
  bash: '■', taunt: '!', whirl: '@', holy: '+', judgment: 'Ω', curse: '§', drain: '∞', imp: 'ж', shadowflame: '▲', doom: 'Ø',
  anthem: '♩', discord: '♯', echo: '∿', crescendo: '≋', encore: '★', backstab: '⌐', poison: '¡', smoke: '○', shadowstep: '⇥', deathmark: '×',
};
export const CLASS_ICON = { mage: '∆', ranger: '»', knight: '†', warlock: '◉', bard: '♪', rogue: '‡' };
export const SPELL_COLOR = {
  fireball: [255, 128, 56], frost: [130, 206, 255], chain: [255, 232, 110], meteor: [255, 96, 72], starfall: [206, 160, 255], multishot: [220, 190, 120], snare: [200, 170, 120], pierce: [230, 236, 255], rain: [210, 180, 120], eagle: [240, 220, 170],
  bash: [150, 200, 255], taunt: [120, 190, 255], whirl: [225, 232, 250], holy: [255, 236, 150], judgment: [255, 214, 90], curse: [190, 110, 250], drain: [236, 80, 110], imp: [255, 130, 50], shadowflame: [170, 90, 255], doom: [150, 80, 220],
  anthem: [255, 200, 90], discord: [255, 110, 170], echo: [200, 170, 255], crescendo: [255, 170, 220], encore: [255, 214, 80], backstab: [230, 90, 90], poison: [130, 225, 90], smoke: [180, 180, 196], shadowstep: [120, 220, 200], deathmark: [240, 70, 80],
};
export const EVENT_ICON = { quest: '★', level: '▲', achievement: '◈', hurt: '×', faint: '†', summon: '◇', return: '«', combo: '»', prompt: '▸', welcome: '◆', waiting: '?', compact: '◐', action: '•' };

export function toast(text, kind = '') {
  if (!text) return;
  const t = el('div', { class: `toast ${kind}`, role: 'status' }, text);
  $('#toasts').append(t);
  setTimeout(() => { t.style.transition = 'opacity .4s'; t.style.opacity = '0'; setTimeout(() => t.remove(), 400); }, 2600);
}

export async function act(type, fields = {}, { quiet = false } = {}) {
  try {
    const r = await api('/api/action', { type, ...fields });
    if (r.snapshot) setSnapshot(r.snapshot);
    if (!quiet || !r.ok) toast(r.message || (r.ok ? '' : 'That did not work'), r.ok ? 'good' : 'bad');
    return r;
  } catch (e) { toast(`Connection problem: ${e.message}`, 'bad'); return { ok: false }; }
}

// ---------- boot ----------

async function boot() {
  const stage = $('#stage');
  const forceCanvas = new URLSearchParams(location.search).get('gl') === '0';
  app.scene = new Scene($('#scene'), $('#overlay'), { forceCanvas });
  window.__arcade = app;
  app.scene.onCoin = () => { const c = $('#goldCounter'); c.classList.remove('pulse'); void c.offsetWidth; c.classList.add('pulse'); };
  const resize = () => { const r = stage.getBoundingClientRect(); app.scene.resize(r.width, r.height, Math.min(2, window.devicePixelRatio || 1)); };
  new ResizeObserver(resize).observe(stage);
  resize();
  buildTabs();
  try {
    app.assets = await api('/api/assets');
    setSnapshot(await api('/api/snapshot'));
  } catch (e) { $('#stageMsg').textContent = `Could not reach the game server (${e.message}). Is it running?`; return; }
  connect();
  requestAnimationFrame(loop);
  bindInput();
}

function connect() {
  const es = new EventSource(withT('/api/stream'));
  es.addEventListener('battle', (m) => { try { const ev = JSON.parse(m.data); app.ev = ev; app.scene.push(ev); } catch {} });
  es.addEventListener('snapshot', (m) => { try { setSnapshot(JSON.parse(m.data)); } catch {} });
  es.onopen = () => { $('#stageMsg').classList.add('gone'); };
  es.onerror = () => { $('#stageMsg').textContent = 'Reconnecting…'; $('#stageMsg').classList.remove('gone'); };
}

let lastFrame = 0;
function loop(ts) {
  requestAnimationFrame(loop);
  if (document.hidden) return;
  if (app.tab !== 'Adventure') { if (ts - lastFrame < 500) return; }
  lastFrame = ts;
  if (app.tab === 'Adventure') {
    try { app.scene.frame(); } catch (e) { if (!loop.err) { loop.err = true; console.error(e); } }
    hud();
  }
  hotbarTick();
}

// ---------- snapshot-driven chrome ----------

export function setSnapshot(s) {
  if (!s) return;
  app.snap = s;
  app.scene && app.scene.setSnapshot(s);
  document.documentElement.dataset.theme = (s.cfg && s.cfg.theme) || 'rpg';
  $$('[data-theme-btn]').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.themeBtn === ((s.cfg && s.cfg.theme) || 'rpg'))));
  topbar(s);
  buildHotbar(s);
  questLog(s);
  partyList(s);
  approvals(s);
  tabBadges(s);
  if (app.tab !== 'Adventure') renderTab(app.tab, $('#view-Other'), s);
  if (s.needsHero && app.tab !== 'Hero') { toast('Create your hero to begin!'); switchTab('Hero'); }
}

function xpInfo(s) {
  if (s.xp && typeof s.xp === 'object') return { v: s.xp.value ?? s.xp.cur, lo: s.xp.lo ?? s.xp.lvlStart, hi: s.xp.hi ?? s.xp.next };
  const lvl = s.lvl || 1, xp = (s.state && s.state.xp) || 0;
  return { v: xp, lo: (100 * lvl * (lvl - 1)) / 2, hi: (100 * (lvl + 1) * lvl) / 2 };
}

let portraitKey = '';
function topbar(s) {
  const h = s.hero || {};
  $('#heroName').textContent = h.name || 'Hero';
  $('#heroLvl').textContent = `Lv ${s.lvl || 1}`;
  const cls = (app.assets && app.assets.classes && app.assets.classes[h.cls]) || { name: h.cls };
  $('#heroSub').textContent = `${cls.name || ''} · ${s.title || ''}`;
  const x = xpInfo(s), p = Math.max(0, Math.min(1, (x.v - x.lo) / Math.max(1, x.hi - x.lo)));
  $('#xpBar .fill').style.width = `${p * 100}%`;
  $('#xpBar').setAttribute('aria-valuenow', Math.round(p * 100));
  $('#xpText').textContent = `${fmt(x.v - x.lo)} / ${fmt(x.hi - x.lo)} ${s.xpLabel || 'XP'} to Lv ${(s.lvl || 1) + 1}`;
  const hp = Math.max(0, Math.min(100, (s.ses && s.ses.hp) ?? 100));
  $('#hpBar .fill').style.width = `${hp}%`;
  $('#hpBar').setAttribute('aria-valuenow', hp);
  $('#hpText').textContent = `❤ ${hp} / 100 HP`;
  $('#cQuests').textContent = fmt((s.state && s.state.quests) || 0);
  $('#cGold').textContent = fmt((s.battle && s.battle.gold) ?? (s.shop && s.shop.gold) ?? ((s.state && s.state.game) || {}).gold ?? 0);
  $('#cStreak').textContent = ((s.state && s.state.streak) || {}).count || 0;
  const key = JSON.stringify(h);
  if (key !== portraitKey) { portraitKey = key; drawPortrait(h); }
}
function drawPortrait(h) {
  const src = heroCanvas(h, { pose: 'stand' }, 3, 2);
  const cv = $('#portrait'), x = cv.getContext('2d');
  x.imageSmoothingEnabled = false;
  x.clearRect(0, 0, cv.width, cv.height);
  // crop the head and shoulders
  x.drawImage(src, (10 - 2) * 3, 2 * 3, 20 * 3, 20 * 3, 4, 8, 88, 88);
}

// ---------- hotbar ----------

let hotKey = '';
function kitOf(s) {
  const cls = (s.hero && s.hero.cls) || 'mage';
  return (app.assets && app.assets.kits && app.assets.kits[cls]) || s.kit || [];
}
function buildHotbar(s) {
  const kit = kitOf(s), cls = (s.hero && s.hero.cls) || 'mage';
  const key = `${cls}:${s.lvl}:${kit.map((k) => k.id).join()}`;
  if (key === hotKey) return;
  hotKey = key;
  const bar = $('#hotbar');
  bar.textContent = '';
  const firstLocked = kit.findIndex((sp) => sp.lvl > (s.lvl || 1));
  kit.forEach((sp, i) => {
    if (firstLocked >= 0 && i > firstLocked) return; // later spells: one line below
    const locked = sp.lvl > (s.lvl || 1);
    const col = sp.id === 'basic' ? null : SPELL_COLOR[sp.id];
    const b = el('button', { class: 'slot', 'data-slot': i, disabled: locked, title: `${sp.name}: ${sp.desc || ''}${locked ? ` (unlocks at level ${sp.lvl})` : ''}`, 'aria-label': `${i + 1}: ${sp.name}${locked ? `, unlocks at level ${sp.lvl}` : ''}`, style: col ? `--sc: rgb(${col})` : '' },
      el('span', { class: 'icon' }, sp.id === 'basic' ? CLASS_ICON[cls] || '•' : SPELL_ICON[sp.id] || '•', el('span', { class: 'sweep' }), el('span', { class: 'cdtext' })),
      el('span', { class: 'key' }, String(i + 1)),
      el('span', {}, el('div', { class: 'nm' }, sp.name), el('div', { class: 'ds' }, locked ? `🔒 Level ${sp.lvl}` : sp.id === 'basic' ? 'Basic attack' : `${(sp.cd / 10).toFixed(0)}s cooldown`)));
    b.addEventListener('click', () => cast(i));
    bar.append(b);
  });
  const w = el('button', { class: 'slot wave-btn', title: 'Summon a practice wave (W). Gold, never XP.' }, el('span', { class: 'icon' }, '⚔'), el('span', { class: 'key' }, 'W'), el('span', {}, el('div', { class: 'nm' }, 'Practice wave'), el('div', { class: 'ds' }, 'Gold, never XP')));
  w.addEventListener('click', () => act('wave'));
  bar.append(w);
  const later = firstLocked >= 0 ? kit.slice(firstLocked + 1) : [];
  $('#hotbarMore').textContent = later.length ? `Later: ${later.map((sp) => `${sp.name} (Lv ${sp.lvl})`).join(' · ')}` : '';
}

const localCd = {};
async function cast(slot) {
  const s = app.snap;
  if (!s) return;
  const sp = kitOf(s)[slot];
  if (!sp) return;
  const b = $(`.slot[data-slot="${slot}"]`);
  if (b && b.disabled) return toast(`${sp.name} unlocks at level ${sp.lvl}`);
  const r = await act('cast', { slot }, { quiet: true });
  if (r.ok) localCd[sp.id] = { t0: performance.now(), len: (sp.cd || 6) * 100 };
}

const prevReady = {};
function hotbarTick() {
  const ev = app.ev, s = app.snap;
  if (!s) return;
  const kit = kitOf(s);
  const hb = ev && ev.hotbar ? Object.fromEntries(ev.hotbar.map((h) => [h.id, h])) : {};
  const hz = (ev && ev.hz) || 10;
  kit.forEach((sp, i) => {
    const b = $(`.slot[data-slot="${i}"]`);
    if (!b) return;
    let p = 0, left = 0;
    const h = hb[sp.id];
    if (h && h.cd > 0) { p = h.cd / Math.max(1, h.cdLen); left = h.cd / hz; }
    else if (localCd[sp.id]) { const e = performance.now() - localCd[sp.id].t0; p = Math.max(0, 1 - e / localCd[sp.id].len); left = (localCd[sp.id].len - e) / 1000; if (p <= 0) delete localCd[sp.id]; }
    b.querySelector('.sweep').style.setProperty('--p', p.toFixed(3));
    b.querySelector('.cdtext').textContent = p > 0 && left > 0.05 ? left.toFixed(1) : '';
    const ready = p <= 0 && !b.disabled;
    b.classList.toggle('ready', ready);
    if (ready && prevReady[sp.id] === false) { b.classList.remove('flash'); void b.offsetWidth; b.classList.add('flash'); }
    prevReady[sp.id] = ready;
  });
}

// ---------- HUD overlays (DOM) ----------

let bannerKey = '', bannerEl = null, bannerT = 0, lootKey = '';
function hud() {
  const sc = app.scene, h = sc.hud, ev = sc.ev;
  if (!ev) return;
  const wave = $('#hudWave');
  const txt = `${h.practice ? '<span class="pr">Practice</span> ' : ''}Wave <b>${h.wave || 0}</b> · ${fmt(h.kills || 0)} slain · <span class="g">◉ ${fmt(h.gold || 0)}</span>`;
  if (wave.innerHTML !== txt) wave.innerHTML = txt;
  $('#cGold').textContent = fmt(h.gold || 0);
  const boss = h.boss, bb = $('#hudBoss');
  if (boss) {
    bb.hidden = false;
    const nm = $('#bossName');
    const t = `${boss.name}${boss.enraged ? ' · Enraged' : ''}`;
    if (nm.textContent !== t) nm.textContent = t;
    nm.classList.toggle('enraged', boss.enraged);
    bb.querySelector('.fill').style.width = `${(boss.hp / boss.max) * 100}%`;
    bb.querySelector('.lag').style.width = `${(boss.lag / boss.max) * 100}%`;
    $('#bossHp').textContent = `${fmt(boss.hp)} / ${fmt(boss.max)}`;
  } else bb.hidden = true;
  $('#letterbox').classList.toggle('on', !!sc.cine && !reducedMotion());

  // Banners: level up, boss intro, victory, loot, trophy.
  let spec = null;
  if (ev.levelUp) {
    const lu = ev.levelUp, kit = kitOf(app.snap || {});
    const fresh = kit.filter((sp) => sp.lvl > lu.from && sp.lvl <= lu.to);
    const next = kit.find((sp) => sp.lvl > lu.to);
    spec = { key: `lu${lu.to}${lu.t0}`, word: 'Level Up', c1: '#ffd650', c2: '#ff8a20', sub: `Level ${lu.to} · ${(app.snap && app.snap.title) || ''}`, sub2: fresh.length ? `New spell: ${fresh.map((sp) => `${sp.name} (key ${kit.indexOf(sp) + 1})`).join(', ')}` : next ? `Next spell at Lv ${next.lvl}: ${next.name}` : 'Every spell is yours. Legendary!' };
  } else if (ev.celebrate && ev.celebrate.kind) {
    const c = ev.celebrate;
    const W = { bossIntro: ['Boss!', '#ff6a5a', '#a01020'], boss: ['Victory', '#ffd650', '#ff5030'], purchase: ['Loot!', '#ffe68a', '#d49a20'], achievement: ['Trophy', '#ffd650', '#b987ff'] }[c.kind];
    spec = { key: `${c.kind}${c.text}`, word: W ? W[0] : '', c1: W && W[1], c2: W && W[2], sub: stripIcons(c.text || '') };
  }
  const bn = $('#banner');
  if (spec && spec.key !== bannerKey) {
    bannerKey = spec.key;
    bn.textContent = '';
    bannerEl = el('div', { class: 'b', style: `--c1:${spec.c1};--c2:${spec.c2}` }, spec.word ? el('div', { class: 'word' }, spec.word) : null, spec.sub ? el('div', { class: 'sub' }, spec.sub) : null, spec.sub2 ? el('div', { class: 'sub2' }, spec.sub2) : null);
    bn.append(bannerEl);
    bannerT = performance.now();
  } else if (!spec && bannerEl && !bannerEl.classList.contains('out')) {
    bannerEl.classList.add('out');
    const e0 = bannerEl; setTimeout(() => e0.remove(), 700);
    bannerKey = '';
  }

  // Loot presentation.
  const L = ev.loot, lq = $('#lootQuest'), lw = $('#lootWave');
  if (L && L.kind === 'quest') {
    lw.hidden = true;
    const k = `${L.text}`;
    const burst = 12;
    if (lootKey !== k) { lootKey = k; lq.textContent = ''; lq.dataset.shown = '0'; $('#stage').querySelectorAll('.loot-entries').forEach((e) => e.remove()); }
    lq.hidden = false;
    if (L.age >= burst && !lq.querySelector('.tier')) {
      const col = L.colors && L.colors.title ? `rgb(${L.colors.title})` : '#ffd650';
      lq.append(el('div', { class: 'tier', style: `color:${col}` }, `${L.tierName || L.tier} Chest`));
      if (L.upgraded) lq.append(el('div', { class: 'up' }, `▲ Upgraded from ${L.from}!`));
      $('#stage').append(el('ul', { class: 'loot-entries' }));
    }
    const ul = $('#stage .loot-entries');
    if (ul) {
      const shown = (L.entries || []).filter((_, i) => L.age >= burst + 4 + i * 2);
      while (ul.children.length < shown.length) {
        const e = shown[ul.children.length];
        ul.append(el('li', { class: e.legendary ? 'legend' : '', style: `color:rgb(${e.color || [255, 255, 255]})` }, `${e.glyph || '•'} ${e.text}`, e.suffix ? el('small', {}, e.suffix) : null));
      }
    }
  } else {
    if (lootKey && !(L && L.kind === 'quest')) { lootKey = ''; lq.hidden = true; lq.textContent = ''; $('#stage').querySelectorAll('.loot-entries').forEach((e) => e.remove()); }
    if (L && L.kind === 'wave') {
      const k = `w${L.text}`;
      if (lw.dataset.k !== k) {
        lw.dataset.k = k; lw.textContent = '';
        lw.style.setProperty('--tier', L.colors && L.colors.title ? `rgb(${L.colors.title})` : '#c9a24a');
        lw.append(el('div', { class: 't' }, `🎁 ${L.tierName || L.tier} chest${L.wave ? ` · wave ${L.wave}` : ''}`));
        for (const e of (L.entries || []).slice(0, 4)) lw.append(el('div', { style: `color:rgb(${e.color || [255, 255, 255]})` }, `${e.glyph || '•'} ${e.text}`));
      }
      lw.hidden = false;
    } else { lw.hidden = true; lw.dataset.k = ''; }
  }
}

// ---------- side panels ----------

let logKey = '';
function questLog(s) {
  const ev = (s.events || []).filter((e) => e.kind !== 'action' || true).slice(-60);
  const key = ev.length ? `${ev.length}:${ev[ev.length - 1].t}` : '0';
  if (key === logKey) return;
  const fresh = logKey !== '';
  logKey = key;
  const ol = $('#questLog');
  const atBottom = ol.scrollTop + ol.clientHeight >= ol.scrollHeight - 30;
  ol.textContent = '';
  const list = ev.filter((e) => e.kind !== 'action').slice(-40);
  list.forEach((e, i) => {
    const li = el('li', { class: `k-${e.kind}`, style: fresh && i < list.length - 1 ? 'animation:none' : '' }, el('span', { class: 'ic', 'aria-hidden': 'true' }, EVENT_ICON[e.kind] || '•'), el('span', { class: 'tx' }, stripIcons(e.text)), el('time', {}, e.t ? new Date(e.t).toTimeString().slice(0, 5) : ''));
    ol.append(li);
  });
  if (!list.length) ol.append(el('li', { class: 'empty' }, 'Your deeds will be written here.'));
  if (atBottom || !fresh) ol.scrollTop = ol.scrollHeight;
}

let partyKey = '';
function partyList(s) {
  const party = Object.entries((s.ses && s.ses.party) || {});
  const key = JSON.stringify(party.map(([id, p]) => [id, p.cls, p.name, p.level]));
  if (key === partyKey) return;
  partyKey = key;
  const box = $('#partyList');
  box.textContent = '';
  if (!party.length) { box.append(el('div', { class: 'empty' }, 'Agents Claude launches join you here.')); return; }
  for (const [id, p] of party) {
    const cv = companionCanvas({ cls: p.cls, name: p.name }, { id, t: 0 }, 2);
    cv.className = '';
    const cls = (app.assets && app.assets.classes[p.cls]) || { name: p.cls };
    box.append(el('div', { class: 'member' }, cv, el('div', {}, el('div', { class: 'n' }, p.name || p.type || cls.name), el('div', { class: 's' }, `${cls.name || p.cls}${p.guild ? ` · guild Lv ${p.level || 1}` : p.type ? ` · ${p.type}` : ''}`))));
  }
}

// ---------- approvals ----------

let apId = null;
function approvals(s) {
  const list = s.approvals || [];
  const req = list[0];
  const m = $('#approval');
  if (!req) { if (!m.hidden) m.hidden = true; apId = null; return; }
  if (apId === req.id) return;
  apId = req.id;
  const input = req.input || {};
  const main = input.command || input.file_path || input.url || input.pattern || input.query || JSON.stringify(input, null, 2);
  $('#apTool').textContent = `${req.tool}${input.description ? ` · ${input.description}` : ''}`;
  $('#apCwd').textContent = (req.cwd || '').split(/[\\/]/).pop();
  $('#apCmd').textContent = main;
  $('#apMore').textContent = list.length > 1 ? `${list.length - 1} more request${list.length > 2 ? 's' : ''} waiting` : 'Allow once never adds a permanent rule. Choose "Answer in Claude" for more options.';
  m.hidden = false;
  m.querySelector('[data-ap="allow"]').focus();
}
async function answer(behavior) {
  if (!apId) return;
  const id = apId;
  $('#approval').hidden = true;
  await act('approval', { id, behavior }, { quiet: true });
  toast(behavior === 'allow' ? 'Allowed once' : behavior === 'deny' ? 'Denied' : 'Handed back to Claude', behavior === 'deny' ? 'bad' : 'good');
}

// ---------- tabs ----------

function buildTabs() {
  const nav = $('#tabs');
  for (const name of TAB_KEYS) {
    const b = el('button', { role: 'tab', id: `tab-${name}`, 'aria-selected': String(name === app.tab), 'aria-controls': name === 'Adventure' ? 'view-Adventure' : 'view-Other' }, name);
    b.addEventListener('click', () => switchTab(name));
    nav.append(b);
  }
}
export function switchTab(name) {
  app.tab = name;
  $$('#tabs button').forEach((b) => b.setAttribute('aria-selected', String(b.textContent.replace(/\d+$/, '') === name || b.id === `tab-${name}`)));
  const adv = name === 'Adventure';
  $('#view-Adventure').hidden = !adv;
  $('#view-Other').hidden = adv;
  if (!adv && app.snap) renderTab(name, $('#view-Other'), app.snap, true);
}
function tabBadges(s) {
  const set = (name, n) => {
    const b = $(`#tab-${name}`);
    if (!b) return;
    let bd = b.querySelector('.badge');
    if (n > 0) { if (!bd) { bd = el('span', { class: 'badge' }); b.append(bd); } bd.textContent = n; } else if (bd) bd.remove();
  };
  const ready = s.bounties ? [...(s.bounties.daily || []), ...(s.bounties.weekly || [])].filter((b) => b.done && !b.claimed).length : 0;
  set('Bounties', ready);
  set('Guild', ((s.guild && s.guild.offers) || []).length);
  set('Skills', (s.skills && s.skills.points && (s.skills.points.avail || s.skills.points.paragon)) || 0);
}

// ---------- input ----------

function bindInput() {
  $('#stage').addEventListener('pointerdown', (e) => {
    if (!app.scene.ev) return;
    const p = app.scene.pick(e.clientX, e.clientY);
    const m = app.scene.monsterUnder(p);
    if (m) {
      app.scene.burst(p.x, p.y, 6, [[255, 255, 255], [255, 220, 120]], { speed: 1.2, life: 300, glow: true });
      act('strike', { x: Math.round(p.x * 10) / 10, y: Math.round(p.y * 10) / 10 }, { quiet: true });
    } else app.scene.burst(p.x, p.y, 3, [[200, 200, 230]], { speed: 0.5, life: 250 });
  });
  $$('[data-theme-btn]').forEach((b) => b.addEventListener('click', () => act('theme', { name: b.dataset.themeBtn }, { quiet: true })));
  $$('#approval [data-ap]').forEach((b) => b.addEventListener('click', () => answer(b.dataset.ap)));
  window.addEventListener('keydown', (e) => {
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    if (!$('#approval').hidden) {
      const k = e.key.toLowerCase();
      if (k === 'y') answer('allow'); else if (k === 'n') answer('deny'); else if (k === 'c') answer('claude');
      if (['y', 'n', 'c'].includes(k)) e.preventDefault();
      return;
    }
    const tag = (e.target && e.target.tagName) || '';
    if (tag === 'INPUT' || tag === 'TEXTAREA' || !$('#dialog').hidden) { if (e.key === 'Escape' && !$('#dialog').hidden) $('#dialog').hidden = true; return; }
    const kit = app.snap ? kitOf(app.snap) : [];
    if (/^[1-9]$/.test(e.key) && Number(e.key) <= kit.length) { cast(Number(e.key) - 1); e.preventDefault(); }
    else if (e.key === ' ' && app.tab === 'Adventure') { cast(0); e.preventDefault(); }
    else if (e.key.toLowerCase() === 'w') act('wave');
    else if (e.key.toLowerCase() === 't') { const th = ['rpg', 'space', 'retro']; const cur = (app.snap && app.snap.cfg && app.snap.cfg.theme) || 'rpg'; act('theme', { name: th[(th.indexOf(cur) + 1) % 3] }, { quiet: true }); }
    else if (e.key === ']' || e.key === '[') { const i = TAB_KEYS.indexOf(app.tab); switchTab(TAB_KEYS[(i + (e.key === ']' ? 1 : TAB_KEYS.length - 1)) % TAB_KEYS.length]); }
  });
  document.addEventListener('visibilitychange', () => { if (!document.hidden) app.scene.lastT = performance.now(); });
}

void C;
boot();
