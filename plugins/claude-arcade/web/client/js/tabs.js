// The non-battle tabs: Hero (with the roster and the creator), Skills, Party,
// Guild, Bounties, Trophies, Shop and Projects. Each renders from the
// snapshot and performs actions through POST /api/action.

import { el, fmt, ago, stripIcons, $ } from './util.js';
import { heroCanvas, companionCanvas, rowsCanvas, itemById } from './pixelart.js';
import { app, act, EVENT_ICON, SPELL_ICON, CLASS_ICON, SPELL_COLOR } from './main.js';

export const TAB_KEYS = ['Adventure', 'Hero', 'Skills', 'Party', 'Guild', 'Bounties', 'Trophies', 'Shop', 'Projects'];

const ui = { shopSlot: 'hat', shopSel: null };
const RARITY = { common: [190, 198, 214], rare: [86, 164, 255], epic: [196, 112, 255], legendary: [255, 172, 44] };
const rc = (r) => `rgb(${RARITY[r] || RARITY.common})`;
const classes = () => (app.assets && app.assets.classes) || {};
const clsName = (c) => (classes()[c] || { name: c }).name;

export function renderTab(name, root, s, fresh = false) {
  // keep the scroll position across live updates
  const y = window.scrollY;
  const fn = { Hero: heroTab, Skills: skillsTab, Party: partyTab, Guild: guildTab, Bounties: bountiesTab, Trophies: trophiesTab, Shop: shopTab, Projects: projectsTab }[name];
  root.textContent = '';
  if (fn) root.append(fn(s));
  if (!fresh) window.scrollTo(0, y);
}

const title = (text, ...right) => el('div', { class: 'title-row' }, el('h2', {}, text), el('span', { class: 'spacer' }), ...right);
const card = (h, ...kids) => el('div', { class: 'card' }, h ? el('h3', {}, h) : null, ...kids);
const bar = (p, color) => el('div', { class: 'minibar' }, el('div', { style: `width:${Math.max(0, Math.min(1, p)) * 100}%${color ? `;background:${color}` : ''}` }));

export function confirmBox(text, ok = 'Confirm', danger = false) {
  return new Promise((resolve) => {
    const box = $('#dialogBox'), m = $('#dialog');
    box.textContent = '';
    const done = (v) => { m.hidden = true; resolve(v); };
    const yes = el('button', { class: `btn ${danger ? 'bad' : 'primary'}` }, ok), no = el('button', { class: 'btn' }, 'Cancel');
    yes.onclick = () => done(true); no.onclick = () => done(false);
    box.append(el('p', { style: 'font-size:15px;margin:0 0 16px' }, text), el('div', { class: 'ap-actions' }, yes, no));
    m.hidden = false; no.focus();
  });
}

// ---------- Hero ----------

function heroTab(s) {
  const h = s.hero || {}, st = s.state || {};
  const cv = heroCanvas(h, { pose: 'cheer', t: 3 }, 6, 4);
  cv.className = 'portrait-big';
  const stats = s.stats || {};
  const main = (classes()[h.cls] || {}).stat;
  const smax = Math.max(20, ...Object.values(stats));
  const kit = (app.assets && app.assets.kits && app.assets.kits[h.cls]) || [];
  const tools = st.tools || {};
  const deeds = [['Edits forged', tools.editing], ['Commands cast', tools.running], ['Files scouted', tools.reading], ['Searches', tools.searching], ['Web & MCP', tools.web], ['Allies summoned', tools.summoning], ['Plans drawn', tools.planning]];
  const dmax = Math.max(1, ...deeds.map((d) => d[1] || 0));
  const game = st.game || {};
  return el('div', {},
    title(`${h.name || 'Hero'}`, el('span', { class: 'pill' }, `${clsName(h.cls)} · Lv ${s.lvl}`), el('button', { class: 'btn', onclick: () => creator('edit', h) }, 'Edit look'), el('button', { class: 'btn primary', onclick: () => creator('create') }, '+ New hero')),
    el('div', { class: 'grid cols2' },
      card('Hero', el('div', { style: 'display:grid;grid-template-columns:minmax(110px,150px) 1fr;gap:14px;align-items:center' }, cv,
        el('div', {},
          el('div', { style: 'font:700 18px var(--title)' }, s.title || ''),
          el('div', { class: 'muted', style: 'margin-bottom:8px' }, (classes()[h.cls] || {}).desc || ''),
          ...Object.entries(stats).map(([k, v]) => el('div', { class: 'stat-row' }, el('span', { style: k === main ? 'color:var(--accent2);font-weight:700' : '' }, `${k}${k === main ? ' ★' : ''}`), bar(v / smax), el('b', {}, v))),
          el('div', { class: 'stat-row' }, el('span', {}, 'Gold'), el('span'), el('b', { style: 'color:var(--gold)' }, fmt((s.battle && s.battle.gold) ?? game.gold))),
          el('div', { class: 'stat-row' }, el('span', {}, 'Monsters slain'), el('span'), el('b', {}, fmt((s.battle && s.battle.kills) ?? game.kills))),
          el('div', { class: 'stat-row' }, el('span', {}, 'Tokens out'), el('span'), el('b', {}, fmt((st.tokens || {}).output))),
          el('div', { class: 'stat-row' }, el('span', {}, 'Bosses'), el('span'), el('b', {}, fmt(game.bosses || 0)))))),
      card('Spellbook', el('div', { class: 'grid' }, ...kit.map((sp, i) => {
        const locked = sp.lvl > s.lvl, col = sp.id === 'basic' ? null : SPELL_COLOR[sp.id];
        return el('div', { style: `display:flex;gap:10px;align-items:center;${locked ? 'opacity:.45' : ''}` },
          el('span', { class: 'slot', style: `padding:0;border:0;background:none;box-shadow:none;${col ? `--sc:rgb(${col})` : ''}` }, el('span', { class: 'icon' }, sp.id === 'basic' ? CLASS_ICON[h.cls] || '•' : SPELL_ICON[sp.id] || '•')),
          el('div', {}, el('b', {}, `${i + 1}. ${sp.name}`), el('span', { class: 'muted' }, locked ? `  · unlocks at Lv ${sp.lvl}` : ''), el('div', { class: 'muted', style: 'font-size:12px' }, sp.desc || '')));
      }))),
      card('Deeds', ...deeds.map(([k, v]) => el('div', { class: 'stat-row' }, el('span', {}, k), bar((v || 0) / dmax), el('b', {}, fmt(v || 0)))),
        el('div', { class: 'muted', style: 'margin-top:8px' }, `${st.quests || 0} quests · ${(st.streak || {}).count || 0}-day streak`)),
      card('Hero roster', el('div', { class: 'grid cards' }, ...(s.heroes || []).map((hr) => {
        const c = heroCanvas(hr, { pose: 'stand' }, 3, 3);
        return el('div', { class: 'item', style: `--rc:${hr.active ? 'var(--accent)' : 'var(--edge-hi)'}` },
          c, el('div', { class: 'nm' }, hr.name), el('div', { class: 'muted' }, `${clsName(hr.cls)} · Lv ${hr.level} · ${fmt(hr.xp)} XP`),
          el('div', { class: 'muted', style: 'font-size:12px' }, `★ ${hr.quests} quests · ◉ ${fmt(hr.gold)} · ${fmt(hr.kills)} slain · ${hr.active ? 'playing now' : ago(hr.lastPlayed)}`),
          el('div', { class: 'row' }, hr.active ? el('span', { class: 'tag', style: 'color:var(--accent)' }, '▶ Active') : el('button', { class: 'btn small primary', onclick: () => act('hero', { op: 'switch', id: hr.id }) }, 'Play as'),
            (s.heroes || []).length > 1 ? el('button', { class: 'btn small bad', onclick: async () => { if (await confirmBox(`Delete ${hr.name} and all of their progress? This can't be undone.`, 'Delete', true) && await confirmBox(`Really delete ${hr.name}?`, 'Yes, delete', true)) act('hero', { op: 'delete', id: hr.id }); } }, 'Delete') : null));
      })))));
}

// Character creator (modal): create a hero or edit the active one's look.
export function creator(mode, base) {
  const A = app.assets || {}, looks = A.looks || {}, P = (A.hero && A.hero.palettes) || {};
  const def = (cls) => { const c = classes()[cls] || {}; return { cls, primary: c.primary, secondary: c.secondary, accessory: c.accessory }; };
  let look = mode === 'edit' ? { name: base.name, cls: base.cls, primary: base.primary, secondary: base.secondary, skin: base.skin, hair: base.hair, accessory: base.accessory, equipped: base.equipped } : { name: '', ...def('mage'), skin: 'light', hair: 'brown' };
  const box = $('#dialogBox'), m = $('#dialog');
  const render = () => {
    box.textContent = '';
    const cv = heroCanvas(look, { pose: 'cheer', t: 2 }, 5, 3);
    cv.className = 'portrait-big'; cv.style.maxWidth = '180px';
    const swatch = (field, pal) => el('div', { class: 'swatches' }, ...(looks[field] || Object.keys(pal || {})).map((k) => el('button', { title: k, 'aria-label': `${field} ${k}`, 'aria-pressed': String(look[field] === k), style: `background:rgb(${(pal || {})[k] || [128, 128, 128]})`, onclick: () => { look[field] = k; render(); } })));
    const opts = (field, list, label = (x) => x) => el('div', { class: 'opt' }, ...list.map((k) => el('button', { 'aria-pressed': String(look[field] === k), onclick: () => { if (field === 'cls') look = { ...look, ...def(k) }; else look[field] = k; render(); } }, label(k))));
    const name = el('input', { type: 'text', value: look.name || '', maxlength: '16', placeholder: 'Your hero\'s name', 'aria-label': 'Name' });
    name.addEventListener('input', () => { look.name = name.value; });
    const cls = classes()[look.cls] || {};
    const go = el('button', { class: 'btn primary', onclick: async () => {
      const nm = (look.name || '').trim();
      if (!/^[\w .'-]{1,16}$/.test(nm)) return name.focus();
      const payload = { name: nm, cls: look.cls, primary: look.primary, secondary: look.secondary, skin: look.skin, hair: look.hair, accessory: look.accessory };
      const r = await act('hero', mode === 'edit' ? { op: 'edit', id: base.id || (app.snap.cfg && app.snap.cfg.activeHero), look: payload } : { op: 'create', look: payload });
      if (r.ok) m.hidden = true;
    } }, mode === 'edit' ? 'Save changes' : 'Begin your adventure');
    box.append(
      el('h2', { style: 'margin:0 0 12px;font:700 22px var(--title);color:var(--accent2);text-transform:uppercase;letter-spacing:.06em' }, mode === 'edit' ? 'Change your look' : 'Create a hero'),
      el('div', { style: 'display:grid;grid-template-columns:180px 1fr;gap:18px;align-items:start' },
        el('div', {}, cv, el('div', { style: 'text-align:center;font-weight:700;margin-top:6px' }, cls.name || ''), el('div', { class: 'muted', style: 'font-size:12px;text-align:center' }, cls.desc || '')),
        el('div', { class: 'form-grid' },
          el('label', {}, 'Name'), name,
          el('label', {}, 'Class'), opts('cls', looks.cls || Object.keys(classes()), (k) => clsName(k)),
          el('label', {}, 'Robe'), swatch('primary', P.COLORS),
          el('label', {}, 'Trim'), swatch('secondary', P.COLORS),
          el('label', {}, 'Skin'), swatch('skin', P.SKINS),
          el('label', {}, 'Hair'), swatch('hair', P.HAIR),
          el('label', {}, 'Accessory'), opts('accessory', looks.accessory || ['none', 'cape', 'beard', 'scarf']))),
      el('div', { class: 'ap-actions', style: 'margin-top:16px;justify-content:flex-end' }, el('button', { class: 'btn', onclick: () => { m.hidden = true; } }, 'Cancel'), go));
  };
  render();
  m.hidden = false;
  setTimeout(() => { const i = box.querySelector('input'); if (i) i.focus(); }, 30);
}

// ---------- Skills ----------

function skillsTab(s) {
  const sk = s.skills;
  if (!sk) return el('div', { class: 'empty' }, 'The skill tree is not available.');
  const P = sk.points || {};
  const pills = [el('span', { class: 'pill', style: 'color:var(--accent2)' }, `${P.avail || 0} point${P.avail === 1 ? '' : 's'} to spend`), el('span', { class: 'pill' }, `${P.spent || 0} / ${P.total || 0} ranks`), el('span', { class: 'pill' }, `${P.bosses || 0} from bosses`)];
  const respec = el('button', { class: 'btn', disabled: !P.spent, onclick: async () => { if (await confirmBox(`Refund every skill point for ◉ ${sk.respecCost} gold?`, `Respec for ${sk.respecCost} gold`)) act('respec'); } }, `Respec (◉ ${sk.respecCost})`);
  return el('div', {},
    title(`${clsName(sk.cls)} skill tree`, ...pills, respec),
    el('div', { class: 'tree' }, ...(sk.tree || []).map((br) => el('div', { class: 'card branch', style: `--bc:rgb(${br.color || [255, 200, 100]})` }, el('h3', {}, br.name),
      ...br.nodes.map((n, i) => {
        const blocked = n.blocked ?? n.blocker ?? '';
        const can = !blocked;
        const learned = n.rank > 0;
        const b = el('button', { class: `node ${learned ? 'learned' : ''} ${can ? 'can' : ''} ${blocked && !learned ? 'locked' : ''} ${i === br.nodes.length - 1 ? 'cap' : ''}`, title: blocked || 'Click to learn a rank', onclick: () => can ? act('learn', { node: n.id }) : null, 'aria-label': `${n.name}, rank ${n.rank} of ${n.max}. ${n.desc} ${blocked}` },
          el('div', { class: 'row', style: 'display:flex;justify-content:space-between' }, el('span', { class: 'nn' }, n.name), el('span', { class: 'muted', style: 'font:11px var(--mono)' }, `Lv ${n.lvl}`)),
          el('div', { class: 'nd' }, n.desc),
          el('div', { class: 'pips' }, ...Array.from({ length: n.max }, (_, k) => el('i', { class: k < n.rank ? 'on' : '' }))),
          blocked && n.rank < n.max ? el('div', { class: 'muted', style: 'font-size:11px;margin-top:4px' }, blocked) : null);
        return b;
      })))),
    P.full ? card('Paragon', el('div', { class: 'muted', style: 'margin-bottom:8px' }, `${P.paragon || 0} paragon point${P.paragon === 1 ? '' : 's'}: small permanent boosts with no cap.`),
      el('div', { class: 'ap-actions' }, ...(sk.paragon || []).map((p) => el('button', { class: 'btn', disabled: !P.paragon, onclick: () => act('paragon', { stat: p.id }) }, `${p.name} (${p.rank ?? p.value ?? 0}) · ${p.desc}`)))) : el('p', { class: 'muted' }, 'Learn every rank to unlock paragon points. The tree never grants XP.'));
}

// ---------- Party ----------

function partyTab(s) {
  const party = Object.entries((s.ses && s.ses.party) || {});
  const hist = (s.events || []).filter((e) => e.kind === 'summon' || e.kind === 'return').slice(-20).reverse();
  return el('div', {}, title('Party', el('span', { class: 'pill' }, `${party.length} fighting`)),
    el('div', { class: 'grid cards' }, ...(party.length ? party.map(([id, p]) => {
      const cv = companionCanvas({ cls: p.cls, name: p.name }, { id, t: 0 }, 5);
      return el('div', { class: 'item', style: '--rc:var(--magic)' }, cv, el('div', { class: 'nm' }, p.name || p.type || clsName(p.cls)), el('div', { class: 'muted' }, `${clsName(p.cls)}${p.guild ? ` · guild recruit Lv ${p.level || 1}` : ` · ${p.type || 'agent'}`}`), el('div', { class: 'muted', style: 'font-size:12px' }, p.since ? `out for ${ago(p.since).replace(' ago', '')}` : ''));
    }) : [el('div', { class: 'empty' }, 'Agents Claude launches join your party here.')])),
    el('div', { style: 'height:14px' }),
    card('Recent adventures', el('ol', { class: 'quest-log', style: 'max-height:none' }, ...(hist.length ? hist.map((e) => el('li', { class: `k-${e.kind}` }, el('span', { class: 'ic' }, EVENT_ICON[e.kind] || '•'), el('span', { class: 'tx' }, stripIcons(e.text)), el('time', {}, new Date(e.t).toTimeString().slice(0, 5)))) : [el('li', { class: 'empty' }, 'No companions have fought beside you yet.')]))));
}

// ---------- Guild ----------

function guildTab(s) {
  const g = s.guild || { members: [], offers: [] };
  const members = g.members || [], offers = g.offers || [];
  const active = members.filter((m) => m.active).length;
  const lvlXp = (n) => 20 * n * (n - 1);
  return el('div', {},
    title('Guild', el('span', { class: 'pill' }, `${members.length} / ${g.maxGuild || g.max || 12} recruits`), el('span', { class: 'pill' }, `${active} / ${g.maxActive || 3} fighting`)),
    offers.length ? card('Wants to join', el('div', { class: 'grid cards' }, ...offers.map((o) => el('div', { class: 'item', style: '--rc:var(--accent)' },
      companionCanvas({ cls: o.cls, name: o.name }, { id: o.id }, 4), el('div', { class: 'nm' }, o.name), el('div', { class: 'muted' }, `${clsName(o.cls)} · was a ${o.type || 'agent'}`),
      el('div', { class: 'row' }, el('button', { class: 'btn small good', onclick: () => act('guild', { op: 'accept', id: o.id }) }, 'Accept'), el('button', { class: 'btn small', onclick: () => act('guild', { op: 'dismiss', id: o.id }) }, 'Dismiss')))))) : null,
    el('div', { style: 'height:14px' }),
    card('Recruits', members.length ? el('div', { class: 'grid cards' }, ...members.map((m) => {
      const lv = m.level || 1, lo = lvlXp(lv), hi = lvlXp(lv + 1);
      return el('div', { class: 'item', style: `--rc:${m.active ? 'var(--good)' : 'var(--edge-hi)'}` },
        companionCanvas({ cls: m.cls, name: m.name }, { id: m.id, sit: !m.active }, 4),
        el('div', { class: 'nm' }, m.name), el('div', { class: 'muted' }, `${clsName(m.cls)} · Lv ${lv} · ${m.jobs || 0} jobs`), bar(((m.xp || 0) - lo) / Math.max(1, hi - lo)),
        el('div', { class: 'row' }, el('button', { class: `btn small ${m.active ? '' : 'good'}`, onclick: () => act('guild', { op: 'toggle', id: m.id }) }, m.active ? 'Rest' : 'Fight'),
          el('button', { class: 'btn small bad', onclick: async () => { if (await confirmBox(`Release ${m.name} from the guild?`, 'Release', true)) act('guild', { op: 'release', id: m.id }); } }, 'Release')));
    })) : el('div', { class: 'empty' }, 'When one of Claude\'s agents finishes, it may ask to join. Recruits fight in every battle and level up.')));
}

// ---------- Bounties ----------

function bountiesTab(s) {
  const b = s.bounties || { daily: [], weekly: [] };
  const left = (t) => { const ms = Math.max(0, (t || 0) - Date.now()); const h = Math.floor(ms / 3600e3); return h >= 24 ? `${Math.floor(h / 24)}d ${h % 24}h` : `${h}h ${Math.floor((ms % 3600e3) / 60e3)}m`; };
  const section = (name, list) => card(`${name}${list[0] ? ` · resets in ${left(list[0].endsAt)}` : ''}`, el('div', { class: 'grid cards' }, ...list.map((it) => {
    const state = it.claimed ? '✓ claimed' : it.done ? '★ ready to claim' : `${Math.round((it.value / it.goal) * 100)}%`;
    const buffName = it.buff ? ((itemById(it.buff) || {}).name || it.buff) : null;
    return el('div', { class: 'item', style: `--rc:${it.claimed ? 'var(--dim)' : it.done ? 'var(--gold)' : 'var(--accent)'}` },
      el('div', { class: 'row' }, el('div', { class: 'nm' }, it.name), el('span', { class: 'pill gold' }, `◉ ${it.gold}${buffName ? ` + ${buffName}` : ''}`)),
      el('div', { class: 'ds' }, it.desc), bar(it.value / it.goal, it.done ? 'linear-gradient(90deg,var(--gold),var(--accent))' : null),
      el('div', { class: 'row' }, el('span', { class: 'muted' }, `${fmt(it.value)} / ${fmt(it.goal)} · ${state}`), it.done && !it.claimed ? el('button', { class: 'btn small primary', onclick: () => act('claim', { id: it.id }) }, 'Claim') : null));
  })));
  const all = [...(b.daily || []), ...(b.weekly || [])];
  return el('div', {}, title('Bounty board', el('span', { class: 'pill' }, `${all.filter((x) => x.claimed).length} claimed`), el('span', { class: 'pill gold' }, `${all.filter((x) => x.done && !x.claimed).length} ready`)),
    el('div', { class: 'grid' }, section('Daily', b.daily || []), section('Weekly', b.weekly || [])),
    el('p', { class: 'muted' }, 'Bounties pay gold (and sometimes a buff), never XP.'));
}

// ---------- Trophies ----------

function trophiesTab(s) {
  const list = s.achievements || [];
  return el('div', {}, title('Trophies', el('span', { class: 'pill gold' }, `${list.filter((a) => a.done).length} / ${list.length}`)),
    el('div', { class: 'grid cards' }, ...list.map((a) => el('div', { class: `item badge-card ${a.done ? 'done' : ''}`, style: `--rc:${a.done ? 'var(--gold)' : 'var(--edge)'};flex-direction:row` },
      el('div', { class: 'ring', style: `--p:${a.done ? 1 : Math.min(1, a.value / a.goal)}` }, el('span', {}, a.done ? '★' : '◇')),
      el('div', {}, el('div', { class: 'nm', style: a.done ? 'color:var(--gold)' : 'color:var(--text)' }, a.name), el('div', { class: 'ds' }, a.desc), el('div', { class: 'muted', style: 'font:11px var(--mono)' }, `${fmt(a.value)} / ${fmt(a.goal)}`))))));
}

// ---------- Shop ----------

function shopTab(s) {
  const sh = s.shop || { items: [] };
  const names = sh.slotNames || { hat: 'Hats', back: 'Back', aura: 'Auras', pet: 'Pets', weapon: 'Weapon glow', buff: 'Buffs' };
  const slots = sh.slots || Object.keys(names);
  if (!slots.includes(ui.shopSlot)) ui.shopSlot = slots[0];
  const items = sh.items.filter((it) => it.slot === ui.shopSlot);
  const sel = sh.items.find((it) => it.id === ui.shopSel) || items[0];
  const hero = s.hero || {};
  const preview = heroCanvas(sel && sel.slot !== 'buff' ? { ...hero, equipped: { ...(hero.equipped || {}), [sel.slot]: sel.id } } : hero, { pose: 'stand', t: 4 }, 6, 10);
  preview.className = 'portrait-big';
  const mats = sh.materials || [];
  const buffs = sh.buffs || [];
  const act1 = (it) => {
    if (it.equipped) return el('button', { class: 'btn small', onclick: () => act('unequip', { id: it.id }) }, 'Unequip');
    if (it.owned && it.slot !== 'buff') return el('button', { class: 'btn small primary', onclick: () => act('equip', { id: it.id }) }, 'Equip');
    if (it.loot) return it.craft ? el('button', { class: 'btn small primary', disabled: !it.canCraft, onclick: () => act('craft', { id: it.id }) }, 'Craft') : el('span', { class: 'tag' }, '✦ Chests only');
    return el('button', { class: 'btn small primary', disabled: !(it.canBuy ?? it.affordable), onclick: () => act('buy', { id: it.id }) }, `Buy ◉ ${it.price}`);
  };
  const iconFor = (it) => {
    const full = itemById(it.id);
    if (full && full.icon && full.icon.rows) return rowsCanvas(full.icon.rows, full.icon.pal, 3);
    const c = heroCanvas({ ...hero, equipped: { [it.slot]: it.id } }, { pose: 'stand', t: 4 }, 3, 12);
    return c;
  };
  return el('div', {},
    title('Shop', el('span', { class: 'pill gold' }, `◉ ${fmt(sh.gold)} gold`), ...mats.filter((m) => (m.n ?? m.have) > 0).map((m) => el('span', { class: 'pill', style: `color:rgb(${m.color})`, title: m.name }, `◆ ${m.n ?? m.have} ${m.name}`))),
    buffs.length ? el('p', { class: 'muted' }, `Active buffs: ${buffs.map((b) => `${(itemById(b.id) || {}).name || b.id} (${b.waves} waves)`).join(', ')}`) : null,
    el('div', { class: 'chips', role: 'tablist' }, ...slots.map((sl) => el('button', { class: 'chip', 'aria-pressed': String(sl === ui.shopSlot), onclick: () => { ui.shopSlot = sl; ui.shopSel = null; renderTab('Shop', $('#view-Other'), app.snap); } }, names[sl] || sl))),
    el('div', { style: 'display:grid;grid-template-columns:260px 1fr;gap:14px;align-items:start' },
      card('Preview', preview, sel ? el('div', {}, el('div', { class: 'nm', style: `font:700 17px var(--title);color:${rc(sel.rarity)}` }, sel.name), el('div', { class: 'muted' }, `${sel.rarity}${sel.set ? ` · ${sel.set} set` : ''}`), el('p', {}, sel.desc || ''),
        sel.craft ? el('div', { class: 'muted' }, 'Recipe: ', ...sel.craft.map((m) => el('span', { style: `color:${m.have >= m.need ? `rgb(${m.color})` : 'var(--bad)'};margin-right:8px` }, `◆ ${m.have}/${m.need} ${m.name}`))) : null, act1(sel)) : null),
      el('div', { class: 'grid cards' }, ...items.map((it) => el('div', { class: `item ${sel && sel.id === it.id ? 'sel' : ''}`, style: `--rc:${rc(it.rarity)};cursor:pointer`, tabindex: '0', onclick: (e) => { if (e.target.tagName === 'BUTTON') return; ui.shopSel = it.id; renderTab('Shop', $('#view-Other'), app.snap); } },
        iconFor(it), el('div', { class: 'nm' }, it.name), el('div', { class: 'ds' }, it.desc || ''),
        el('div', { class: 'row' }, el('span', { class: 'tag' }, it.rarity), it.equipped ? el('span', { class: 'tag', style: 'color:var(--good)' }, '✓ Equipped') : it.owned && it.slot !== 'buff' ? el('span', { class: 'tag', style: 'color:var(--accent)' }, 'Owned') : !it.loot ? el('span', { class: 'pill gold', style: (it.canBuy ?? true) ? '' : 'color:var(--bad)' }, `◉ ${it.price}`) : null),
        el('div', { class: 'row' }, act1(it)))))),
    el('p', { class: 'muted' }, 'Nothing in the Shop ever gives XP. Buffs last for the current session.'));
}

// ---------- Projects ----------

function projectsTab(s) {
  const rows = Object.values((s.state && s.state.projects) || {}).sort((a, b) => (b.xp || 0) - (a.xp || 0));
  const max = Math.max(1, ...rows.map((p) => p.xp || 0));
  const here = s.ses && s.ses.project;
  return el('div', {}, title('Projects', el('span', { class: 'pill' }, `${rows.length} tracked · all heroes`)),
    rows.length ? card(null, el('table', { class: 'proj' },
      el('thead', {}, el('tr', {}, ...['Project', '', 'XP', 'Quests', 'Edits', 'Cmds', 'Agents', 'Tokens', 'Active'].map((h) => el('th', {}, h)))),
      el('tbody', {}, ...rows.map((p) => el('tr', { class: p.path === here ? 'here' : '' }, el('td', {}, `${p.path === here ? '▸ ' : ''}${p.name}`), el('td', { style: 'width:30%' }, bar((p.xp || 0) / max)),
        ...[p.xp, p.quests, (p.tools || {}).editing, (p.tools || {}).running, (p.tools || {}).summoning, (p.tokens || {}).output].map((v) => el('td', {}, fmt(v || 0))), el('td', {}, ago(p.lastSeen))))))) : el('div', { class: 'empty' }, 'Stats start with your next Claude session in any project.'),
    el('p', { class: 'muted' }, '▸ marks the project of the session you are following. This is your usage; hero XP is separate.'));
}
