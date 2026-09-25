// The battle scene: interpolates the server's battle events (10/s) into
// 60 fps frames, draws the backdrop, characters (the terminal's own sprite
// code, packed into an atlas each animation tick), spells, particles and
// lights through the renderer, and text (damage numbers, name tags, HP bars,
// bubbles) on a 2D overlay canvas.

import { createRenderer, LW, LH } from './gfx.js';
import { makeFxTextures } from './fxtex.js';
import { buildBackdrop, drawBackdrop } from './backgrounds.js';
import { Atlas, renderHero, renderCompanion, renderMonster, renderRows, renderWith, monsterSize, X } from './pixelart.js';
import { clamp01, lerp, mix, hash, ease, lum, reducedMotion, stripIcons } from './util.js';

const WHITE = [1, 1, 1];
const n3 = (c, f = 1) => (c ? [(c[0] / 255) * f, (c[1] / 255) * f, (c[2] / 255) * f] : [1, 1, 1]);
const INK = [22, 18, 30];

export class Scene {
  constructor(canvas, overlay, { forceCanvas = false } = {}) {
    this.canvas = canvas; this.overlay = overlay; this.octx = overlay.getContext('2d');
    this.r = createRenderer(canvas, { forceCanvas });
    this.T = makeFxTextures(this.r);
    this.atlas = new Atlas(1024);
    this.atlasTex = this.r.texture({ data: this.atlas.data, w: 1024, h: 1024 }, { filter: 'nearest' });
    this.events = [];
    this.offset = null; // client clock - server clock (ms), smoothed
    this.bd = null; this.bdKey = '';
    this.floaters = []; this.parts = []; this.trails = new Map();
    this.mon = new Map(); // per-monster client state (hit squash, hp lag)
    this.spriteTick = -1; this.sprites = null;
    this.shake = 0; this.flash = 0; this.hitStop = 0;
    this.cam = { x: 0, y: 0, zoom: 1 };
    this.cine = null; // boss intro cinematic
    this.night = 0; this.rain = 0;
    this.snap = null;
    this.stats = { fps: 0, frames: 0, last: performance.now() };
    this.reduce = reducedMotion();
    this.lastT = performance.now();
    this.hud = { boss: null, wave: 0, kills: 0, gold: 0, practice: false, mode: 'idle', coinsIn: 0 };
    this.onCoin = null;
  }

  get kind() { return this.r.kind; }

  resize(w, h, dpr) {
    this.r.resize(w, h, dpr);
    if (this.overlay.width !== this.canvas.width || this.overlay.height !== this.canvas.height) { this.overlay.width = this.canvas.width; this.overlay.height = this.canvas.height; }
    this.dpr = dpr;
  }

  setSnapshot(s) { this.snap = s; }

  push(ev) {
    const now = Date.now();
    if (ev.t) {
      const off = now - ev.t;
      this.offset = this.offset === null ? off : Math.min(off, this.offset + 2); // track the fastest delivery, drift slowly
      if (Math.abs(off - this.offset) > 3000) this.offset = off;
    }
    ev._hz = ev.hz || 10;
    ev._rt = ev.t || now;
    const prev = this.events[this.events.length - 1];
    if (prev && ev.tick <= prev.tick) this.events.length = 0; // server restarted
    this.events.push(ev);
    if (this.events.length > 8) this.events.shift();
    this.onEvent(ev, prev);
  }

  // ---------- event diffs: spawn client-side juice ----------

  onEvent(ev, prev) {
    const t = performance.now();
    // Floaters: server floaters have no id; one that wasn't there a tick ago
    // (same text, about where it would have risen to) is new.
    const old = (prev && prev.floaters) || [];
    for (const f of ev.floaters || []) {
      const seen = old.some((o) => o.text === f.text && Math.abs(o.x - f.x) < 0.6 && f.y <= o.y + 0.3 && f.y >= o.y - 1.6);
      if (!seen) this.spawnFloater(f, t);
    }
    // Monsters: hits (hp drop), deaths, boss arrival.
    const pm = new Map(((prev && prev.monsters) || []).map((m) => [m.id, m]));
    for (const m of ev.monsters || []) {
      const st = this.mon.get(m.id) || { hitT: -1e9, lag: m.hp, born: t, lastHp: m.hp };
      const p = pm.get(m.id);
      if (p && m.hp < p.hp) { st.hitT = t; st.hitK = Math.min(1, (p.hp - m.hp) / Math.max(1, m.max) * 3 + 0.35); }
      if (p && !p.dying && m.dying) this.onDeath(m, t);
      if (!p && m.boss && !this.cine) this.cine = { t0: t, id: m.id };
      st.lastHp = m.hp;
      this.mon.set(m.id, st);
    }
    for (const id of [...this.mon.keys()]) if (!(ev.monsters || []).some((m) => m.id === id)) this.mon.delete(id);
    // Coins collected: the ones that vanished near the hero.
    if (prev && (prev.coins || []).length > (ev.coins || []).length && ev.hero) {
      const n = prev.coins.length - ev.coins.length;
      for (let i = 0; i < Math.min(n, 4); i++) this.burst(ev.hero.x + 8, ev.hero.y + 10, 5, [[255, 230, 120], [255, 255, 220]], { speed: 0.9, life: 450, glow: true, grav: -0.002 });
      this.hud.coinsIn += n;
      this.onCoin && this.onCoin(n);
    }
    // Screen shake and flash from the server.
    if (ev.shake > 0) this.shake = Math.max(this.shake, Math.min(10, ev.shake) * (this.reduce ? 0.15 : 1));
    if (ev.flash > 0 && !(prev && prev.flash > 0)) this.flash = Math.max(this.flash, this.reduce ? 0.12 : 0.55);
    // Level up and victory confetti.
    if (ev.levelUp && !(prev && prev.levelUp)) this.confetti(90);
    if (ev.celebrate && ev.celebrate.kind === 'boss' && !(prev && prev.celebrate && prev.celebrate.kind === 'boss')) this.confetti(120);
    if (ev.mode === 'victory' && prev && prev.mode !== 'victory') this.confetti(60);
    if (ev.loot && ev.loot.kind === 'quest' && ev.loot.age <= 13 && ev.loot.age >= 11 && !(this.lootBurst === ev.loot.text)) { this.lootBurst = ev.loot.text; this.lootBurstT = t; }
  }

  spawnFloater(f, t) {
    const text = String(f.text);
    const crit = /^CRIT/.test(text), xp = /XP|◉|gold/i.test(text) && /^\+/.test(text), combo = /COMBO/.test(text), big = /[A-Z]{3,}/.test(text) && !crit && !/^[-+]?\d/.test(text);
    this.floaters.push({ text, x: f.x, y: f.y, c: f.color || [255, 240, 170], bold: !!f.bold, crit, xp, combo, big, t0: t, jx: (hash(t | 0, 1) - 0.5) * 6 });
    if (this.floaters.length > 60) this.floaters.splice(0, this.floaters.length - 60);
    if (!xp && !combo && /^-?\d|^CRIT/.test(text)) {
      const col = f.color || [255, 230, 150];
      this.burst(f.x + 3, f.y + 7, crit ? 16 : 6, [col, [255, 255, 255]], { speed: crit ? 1.8 : 1, life: crit ? 500 : 300, glow: true });
      if (crit) { this.rings.push({ x: f.x + 4, y: f.y + 8, t0: t, life: 380, r: 18, c: [255, 190, 90], squash: 1 }); this.shake = Math.max(this.shake, this.reduce ? 0.5 : 3); this.hitStop = 45; }
    }
  }

  onDeath(m, t) {
    const [w, h] = [m.w || 12, m.h || 12];
    const cx = m.x + w / 2, cy = m.y + h / 2;
    this.burst(cx, cy, m.boss ? 70 : 18, [[255, 214, 80], [255, 255, 255], [255, 150, 60]], { speed: m.boss ? 2.6 : 1.4, life: m.boss ? 1100 : 600, glow: true, grav: 0.004 });
    this.rings.push({ x: cx, y: m.y + h, t0: t, life: m.boss ? 900 : 420, r: m.boss ? 90 : 26, c: m.boss ? [255, 214, 80] : [255, 200, 140], squash: 0.25 });
    if (m.boss) { this.finisher = { t0: t, x: cx, w, bottom: m.y + h }; this.flash = this.reduce ? 0.15 : 0.8; this.shake = this.reduce ? 1 : 9; }
  }

  // ---------- client particles ----------

  get rings() { return (this._rings ||= []); }
  burst(x, y, n, colors, { speed = 1, life = 500, glow = false, grav = 0.003, up = 0.6, size = 1 } = {}) {
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2, s = (0.3 + Math.random()) * speed * 0.06;
      this.parts.push({ x, y, vx: Math.cos(a) * s, vy: Math.sin(a) * s - up * 0.05 * speed, g: grav, c: colors[i % colors.length], t0: performance.now(), life: life * (0.6 + Math.random() * 0.7), glow, size: size * (0.7 + Math.random() * 0.6) });
    }
    if (this.parts.length > 1500) this.parts.splice(0, this.parts.length - 1500);
  }
  confetti(n) {
    if (this.reduce) n = Math.round(n / 4);
    const cols = [[255, 90, 90], [255, 200, 60], [90, 220, 120], [90, 170, 255], [200, 110, 255], [255, 255, 255]];
    for (let i = 0; i < n; i++) this.parts.push({ x: Math.random() * LW, y: -10 - Math.random() * 60, vx: (Math.random() - 0.5) * 0.03, vy: 0.02 + Math.random() * 0.03, g: 0.00002, c: cols[i % cols.length], t0: performance.now(), life: 3500 + Math.random() * 1500, confetti: true, spin: Math.random() * 6, size: 1.6 });
  }

  // ---------- timeline ----------

  sample() {
    const E = this.events;
    if (!E.length) return null;
    const last = E[E.length - 1];
    const hz = last._hz || 10;
    const delay = (1000 / hz) * 1.35;
    const now = Date.now() - (this.offset || 0) - delay;
    let A = E[0], B = E[0];
    for (let i = 0; i < E.length; i++) { if (E[i]._rt <= now) A = E[i]; if (E[i]._rt > now) { B = E[i]; break; } B = E[i]; }
    let k = B === A ? 1 : clamp01((now - A._rt) / Math.max(1, B._rt - A._rt));
    if (B === A) k = 0;
    return { A, B, k, hz };
  }

  // ---------- frame ----------

  frame() {
    const nowP = performance.now();
    const dt = Math.min(100, nowP - this.lastT); this.lastT = nowP;
    const s = this.sample();
    this.stats.frames++;
    if (nowP - this.stats.last > 1000) { this.stats.fps = this.stats.frames; this.stats.frames = 0; this.stats.last = nowP; }
    const r = this.r;
    if (!s) { r.begin({ ambient: [0.3, 0.3, 0.4] }); r.end({ bloom: 0 }); this.octx.clearRect(0, 0, this.overlay.width, this.overlay.height); return; }
    const { A, B, k } = s;
    const E = k < 0.5 ? A : B; // discrete fields come from the nearer event
    this.ev = E;
    const t = nowP / 1000;
    const floorY = E.floorY || 148;
    const theme = E.theme || 'rpg';
    const biome = E.biome || 'dungeon';
    const sector = this.snap ? Math.max(0, ['dungeon', 'forest', 'lava', 'castle'].indexOf(this.biomeByLevel())) : 0;

    // Backdrop (rebuilt when biome, sector or resolution changes).
    const K = Math.max(2, Math.min(4, Math.ceil(r.scale)));
    const key = `${biome}:${sector}:${K}:${floorY}`;
    if (key !== this.bdKey) {
      if (this.bd) this.bd.free();
      this.bd = buildBackdrop(r, biome, K, floorY, sector);
      this.bdKey = key;
    }
    const scroll = lerp(A.scroll || 0, B.scroll || 0, k);

    // Camera: shake, boss intro zoom.
    this.shake *= Math.pow(0.9, dt / 16.7);
    this.flash *= Math.pow(0.86, dt / 16.7);
    if (this.hitStop > 0) this.hitStop -= dt;
    const sh = this.shake > 0.05 ? [(Math.random() - 0.5) * this.shake * 0.6, (Math.random() - 0.5) * this.shake * 0.6] : [0, 0];
    let cam = { x: 0, y: 0, zoom: 1 };
    if (this.cine) {
      const age = (nowP - this.cine.t0) / 1000;
      const boss = (B.monsters || []).find((m) => m.id === this.cine.id);
      if (age > 3.6 || !boss) this.cine = null;
      else if (!this.reduce) {
        const z = age < 0.6 ? ease.inOut(age / 0.6) : age < 2.6 ? 1 : 1 - ease.inOut((age - 2.6) / 1);
        cam = { x: ((boss.x + (boss.w || 30) / 2) - LW / 2) * 0.55 * z, y: -10 * z, zoom: 1 + 0.28 * z };
      }
    }
    this.cam = cam;

    // Idle night and rain.
    const pose = E.hero ? E.hero.pose : 'stand';
    this.night += ((pose === 'sleep' ? 1 : 0) - this.night) * Math.min(1, dt / 2500);
    const rainCycle = Math.sin(t / 60) > 0.72 ? 1 : 0;
    this.rain += ((biome === 'forest' ? rainCycle : 0) - this.rain) * Math.min(1, dt / 3000);

    let ambient = (this.bd.ambientFor ? this.bd.ambientFor({ rain: this.rain }) : this.bd.ambient).slice();
    ambient = ambient.map((v, i) => v * (1 - this.night * 0.5) + [0.02, 0.03, 0.08][i] * this.night);
    if (theme === 'retro') ambient = ambient.map((v) => v * 0.5); // characters keep the bright phosphor levels
    r.begin({ ambient, camera: cam, shake: sh });
    this.frameLights = [];
    const light = r.light.bind(r);
    r.light = (x, y, rad, c, s0 = 1) => { this.frameLights.push([x, y, rad, c, s0]); light(x, y, rad, c, s0); };

    const T = this.T;
    const d = { r, T, t, tick: E.tick, scroll, floorY, rain: this.rain, night: this.night, flame: (x, y, w, h, tt, a) => this.flame(x, y, w, h, tt, a), ripple: (x, y, p) => r.draw(T.ring, 0, 0, 128, 128, x - 6 * p, y - 1.5 * p, 12 * p, 3 * p, { pass: 'glow', color: [0.6, 0.7, 1, 0.5 * (1 - p)] }) };
    drawBackdrop(this.bd, d);
    if (this.night > 0.02) this.drawNight(d);
    r.split();

    // Sprites for this animation tick.
    const at = Math.round(A.tick + k * ((B.tick || A.tick) - A.tick));
    if (at !== this.spriteTick || E !== this.spriteEv) this.buildSprites(E, at);

    const hero = E.hero && this.lerpHero(A, B, k);
    const alive = (E.monsters || []).filter((m) => !m.dying);
    if (hero && (E.mode === 'idle' || pose === 'sit' || pose === 'sleep') && !alive.length) this.drawCamp(d, hero, pose);
    if (hero && E.mode === 'victory') this.drawVictory(d, hero);
    if (hero && E.mode === 'summoning') this.drawSummon(d, hero);

    // Effect lights first so characters can pick up rim light from them.
    const shots = this.matchList(A.shots, B.shots, k, (a, b) => a.id === b.id, 12);
    for (const sh0 of shots) r.light(sh0.x, sh0.y, sh0.id === 'meteor' ? 70 : 34, n3(sh0.color), 0.9);
    for (const bo of E.bolts || []) r.light(bo.to[0], bo.to[1], 60, [0.6, 0.8, 1], 1.4);
    if (hero) r.light(hero.x + 8, hero.y + 10, 40, [1, 0.92, 0.8], 0.15);

    // Characters, back to front.
    const draws = [];
    for (const c of E.companions || []) draws.push({ y: c.y + 13, fn: () => this.drawCompanion(A, B, k, c) });
    if (hero) draws.push({ y: hero.y + 24, fn: () => this.drawHero(hero) });
    for (const m of E.monsters || []) draws.push({ y: m.y + (m.h || 12) + (m.boss ? 1 : 0), fn: () => this.drawMonster(A, B, k, m, d) });
    draws.sort((a, b) => a.y - b.y);
    for (const dr of draws) dr.fn();

    // Spells and effects.
    this.drawShots(shots, E, t);
    this.drawBolts(E, t);
    this.drawFx(A, B, k, E, d);
    this.drawCoins(A, B, k, t);
    this.drawParticles(A, B, k);
    this.drawClientParticles(dt);
    this.drawRings(nowP);
    this.drawFinisher(nowP);
    if (E.loot && E.loot.kind === 'quest') this.drawQuestChest(E.loot, t, nowP);

    r.light = light;
    const boss = (E.monsters || []).find((m) => m.boss && !m.dying);
    const enraged = boss && boss.hp / boss.max < 0.35 ? 0.25 + 0.12 * Math.sin(t * 5) : 0;
    const flashC = [1, 0.98, 0.9, Math.min(0.85, this.flash)];
    r.end({ bloom: theme === 'retro' ? 0.5 : 0.8, threshold: 0.95, exposure: 1.0, vignette: 0.6, flash: flashC, retro: theme === 'retro', enrage: this.reduce ? enraged * 0.4 : enraged, grain: 0.012 });

    this.drawOverlay(A, B, k, E, hero, nowP);
    this.hudUpdate(E);
  }

  biomeByLevel() {
    const lvl = (this.snap && this.snap.lvl) || 1;
    return lvl >= 15 ? 'castle' : lvl >= 10 ? 'lava' : lvl >= 5 ? 'forest' : 'dungeon';
  }

  // ---------- interpolation helpers ----------

  lerpHero(A, B, k) {
    const a = A.hero, b = B.hero || a;
    if (!a) return null;
    const far = Math.abs(a.x - b.x) > 30;
    return { ...(k < 0.5 ? a : b), x: far ? b.x : lerp(a.x, b.x, k), y: far ? b.y : lerp(a.y, b.y, k) };
  }
  // Match items between two events (no ids): nearest same-kind item within reach.
  matchList(la = [], lb = [], k, same, reach = 8) {
    const out = [];
    const used = new Set();
    for (const b of lb || []) {
      let best = null, bd = reach * reach;
      (la || []).forEach((a, i) => {
        if (used.has(i) || (same && !same(a, b))) return;
        const dd = (a.x - b.x) ** 2 + (a.y - b.y) ** 2;
        if (dd < bd) { bd = dd; best = i; }
      });
      if (best !== null) { used.add(best); const a = la[best]; out.push({ ...b, x: lerp(a.x, b.x, k), y: lerp(a.y, b.y, k), px: a.x, py: a.y }); }
      else out.push({ ...b, px: b.x, py: b.y, fresh: true });
    }
    return out;
  }
  monsterAt(E, id) { return (E.monsters || []).find((m) => m.id === id) || null; }

  // ---------- sprites ----------

  buildSprites(E, at) {
    this.spriteTick = at; this.spriteEv = E;
    const atlas = this.atlas;
    atlas.reset();
    const S = { hero: null, comps: new Map(), mons: new Map(), props: {} };
    const h = E.hero;
    if (h) {
      const look = h.look || { cls: h.cls };
      const action = h.action && Number.isFinite(h.action.t) ? h.action : h.busy;
      S.hero = renderHero(atlas, look, {
        pose: h.pose || 'stand', t: at, busy: !!h.busy, action: action || null, look: h.lookDir || undefined, hop: !!h.hop,
        hurt: Number.isFinite(h.hurt) ? h.hurt : -1, flinch: Number.isFinite(h.flinch) ? h.flinch : -1, alert: Number.isFinite(h.alert) ? h.alert : 99,
        activity: h.activity || h.cls,
      });
    }
    for (const c of E.companions || []) {
      const attack = Number.isFinite(c.attack) ? c.attack : Number.isFinite(c.attackT) && at - c.attackT >= 0 && at - c.attackT <= 5 ? at - c.attackT : null;
      S.comps.set(c.id, renderCompanion(atlas, { cls: c.cls, name: c.name, guild: c.guild }, { id: c.id, t: c.t || at, attack, walk: !!c.walk, flip: !!c.flip, sit: !!c.sit, sleep: !!c.sleep, alpha: 1 }));
    }
    const prev = this.events.length > 1 ? this.events[this.events.length - 2] : null;
    const pm = new Map(((prev && prev.monsters) || []).map((m) => [m.id, m]));
    for (const m of E.monsters || []) {
      const p = pm.get(m.id);
      const moving = p ? Math.abs(p.x - m.x) > 0.05 : false;
      const mm = { ...m, flash: m.boss ? (m.flash >= 3 ? 1 : 0) : m.flash >= 3 && m.flash !== (p && p.flash) ? m.flash : m.flash > 0 ? 1 : 0, yOff: 0, walking: m.walking ?? moving, flip: m.flip ?? (p ? m.x - p.x > 0.3 : false), enraged: m.enraged ?? (m.boss && m.hp / m.max < 0.35), at: m.at ?? at + (m.seed || 0) * 3, dieT: m.dying ? m.dieT || 0 : null, hp: m.dying ? 0 : m.hp };
      S.mons.set(m.id, renderMonster(atlas, mm, at));
    }
    // Props: campfire logs, victory chest.
    S.props.logs = renderRows(atlas, X.FIRE[0].slice(4), X.BASE);
    S.props.chestOpen = renderRows(atlas, X.CHEST.open, X.BASE);
    S.props.camp = this.campSprite(atlas, E, at);
    S.props.chest = this.lootChestSprite(atlas, E.loot, at);
    this.sprites = S;
    this.r.update(this.atlasTex, { data: atlas.data, w: 1024, h: 1024 }, atlas.usedH + 2);
  }

  blit(spr, x, y, o = {}) {
    if (!spr || !spr.r) return;
    const { r: rc } = spr;
    const sx = o.sx || 1, sy = o.sy || 1;
    const px = x + spr.dx, py = y + spr.dy, w = rc.w, h = rc.h;
    // scale around the pivot (feet)
    const pvx = o.pivot ? o.pivot[0] : px + w / 2, pvy = o.pivot ? o.pivot[1] : py + h;
    const X0 = pvx + (px - pvx) * sx, Y0 = pvy + (py - pvy) * sy;
    this.r.draw(this.atlasTex, rc.x, rc.y, w, h, X0, Y0, w * sx, h * sy, { color: o.color || [1, 1, 1, o.alpha ?? 1], rim: o.rim || null, pass: o.pass || 'base' });
  }

  rimFor(cx, cy, flip) {
    let best = null, bs = 0.05;
    for (const [x, y, rad, c, s] of this.frameLights || []) {
      const dd = Math.hypot(x - cx, y - cy);
      if (dd > rad || dd < 3) continue;
      const v = s * (1 - dd / rad);
      if (v > bs) { bs = v; best = [x, y, c]; }
    }
    if (!best) return [-0.7, -0.7, 0.55, 0.6, 0.9, 0.18]; // soft sky rim from the upper left
    let dx = best[0] - cx, dy = best[1] - cy;
    const len = Math.hypot(dx, dy) || 1;
    dx /= len; dy /= len;
    if (flip) dx = -dx;
    return [dx, dy, best[2][0], best[2][1], best[2][2], Math.min(0.55, 0.2 + bs * 0.6)];
  }

  shadow(cx, y, w, a = 0.5) {
    this.r.draw(this.T.glow, 0, 0, 64, 64, cx - w * 0.75, y - 2.4, w * 1.5, 5, { color: [0, 0, 0, a] });
  }

  drawHero(h) {
    const S = this.sprites && this.sprites.hero;
    if (!S) return;
    const nowP = performance.now();
    // squash and stretch: hurt/flinch squashes, a fresh cast stretches up
    let sx = 1, sy = 1;
    if (Number.isFinite(h.hurt) && h.hurt >= 0 && h.hurt < 4) { const e = 1 - h.hurt / 4; sx = 1 + 0.12 * e; sy = 1 - 0.1 * e; }
    else if (Number.isFinite(h.flinch) && h.flinch >= 0 && h.flinch < 3) { sx = 1.06; sy = 0.95; }
    const act = h.action;
    if (act && this.ev && Number.isFinite(act.t)) { const p = this.ev.tick - act.t; if (p >= 0 && p < 3) { const e = 1 - p / 3; sx *= 1 - 0.05 * e; sy *= 1 + 0.07 * e; } }
    const cx = h.x + 8, feet = h.y + 24;
    const air = h.pose === 'victory' || h.hop ? 0.35 : 0.55;
    this.shadow(cx, feet, 14, air);
    const rim = this.rimFor(cx, h.y + 10, false);
    this.blit(S, h.x, h.y, { sx, sy, pivot: [cx, feet], rim });
    for (const l of S.lights) this.r.light(h.x + l.x, h.y + l.y, l.r * 3, n3(l.c), l.s * 0.9);
    for (const l of S.lights) { const rr = Math.min(6, l.r * 0.55); this.r.draw(this.T.glow, 0, 0, 64, 64, h.x + l.x - rr, h.y + l.y - rr, rr * 2, rr * 2, { pass: 'glow', color: [...n3(l.c), l.s * 0.3] }); }
    this.heroLabels = S.labels.map((lb) => ({ ...lb, x: h.x + lb.x, y: h.y + lb.y }));
    void nowP;
  }

  drawCompanion(A, B, k, c) {
    const S = this.sprites && this.sprites.comps.get(c.id);
    if (!S) return;
    const a = (A.companions || []).find((o) => o.id === c.id), b = (B.companions || []).find((o) => o.id === c.id) || c;
    const x = a && Math.abs(a.x - b.x) < 30 ? lerp(a.x, b.x, k) : b.x, y = a ? lerp(a.y, b.y, k) : b.y;
    this.shadow(x + 5.5, y + 13, 10, 0.45);
    this.blit(S, x, y, { rim: this.rimFor(x + 5, y + 6, c.flip), alpha: c.alpha ?? 1 });
    for (const l of S.lights) this.r.light(x + l.x, y + l.y, l.r * 2.5, n3(l.c), l.s * 0.8);
    for (const lb of S.labels) (this.compLabels ||= []).push({ ...lb, x: x + lb.x, y: y + lb.y });
  }

  drawMonster(A, B, k, m, d) {
    const S = this.sprites && this.sprites.mons.get(m.id);
    const a = (A.monsters || []).find((o) => o.id === m.id), b = (B.monsters || []).find((o) => o.id === m.id) || m;
    const x = a && Math.abs(a.x - b.x) < 30 ? lerp(a.x, b.x, k) : b.x, y = a && Math.abs(a.y - b.y) < 30 ? lerp(a.y, b.y, k) : b.y;
    const w = m.w || monsterSize(m)[0], h = m.h || monsterSize(m)[1];
    m._x = x; m._y = y;
    const st = this.mon.get(m.id);
    const nowP = performance.now();
    let sx = 1, sy = 1;
    if (st && !m.dying) {
      const e = Math.max(0, 1 - (nowP - st.hitT) / 260), kk = st.hitK || 0.5;
      const wob = Math.sin((nowP - st.hitT) / 38) * e;
      sx = 1 + 0.2 * kk * wob * (m.boss ? 0.35 : 1); sy = 1 - 0.16 * kk * wob * (m.boss ? 0.35 : 1);
      if (m.windup > 0) { sx *= 0.94; sy *= 1.06; }
    }
    const floor = m.boss ? y + h : Math.max(y + h, d.floorY - 1);
    const flyer = floor - (y + h) > 3;
    if (!m.dying) this.shadow(x + w / 2, flyer ? d.floorY + 2 : y + h, w * 0.9, flyer ? 0.25 : 0.5);
    if (m.boss && !m.dying) {
      const aura = (m.hp / m.max < 0.35) ? [1, 0.2, 0.1] : [1, 0.7, 0.4];
      this.r.draw(this.T.glow, 0, 0, 64, 64, x - w * 0.4, y - h * 0.4, w * 1.8, h * 1.8, { pass: 'under', color: [...aura, 0.35 + 0.08 * Math.sin(nowP / 300)] });
      this.r.light(x + w / 2, y + h / 2, w * 1.6, aura, 0.7);
    }
    if (m.elite && !m.dying) this.r.light(x + w / 2, y + h / 2, w * 1.4, [1, 0.8, 0.3], 0.5);
    if (m.frozen > 0) this.r.draw(this.T.glow, 0, 0, 64, 64, x - 3, y - 3, w + 6, h + 6, { pass: 'under', color: [0.5, 0.85, 1, 0.4] });
    if (m.burn > 0) { this.r.light(x + w / 2, y + h / 2, 30, [1, 0.5, 0.15], 0.6); if (Math.random() < 0.3) this.burst(x + Math.random() * w, y + Math.random() * h * 0.6, 1, [[255, 200, 80], [255, 120, 40]], { speed: 0.3, life: 500, glow: true, grav: -0.002 }); }
    if (m.poison > 0 && Math.random() < 0.12) this.burst(x + Math.random() * w, y + h * 0.5, 1, [[120, 220, 90]], { speed: 0.2, life: 500, glow: true, grav: 0.002 });
    if (m.curse > 0 && Math.random() < 0.15) this.burst(x + Math.random() * w, y + h * 0.3, 1, [[170, 80, 230]], { speed: 0.2, life: 600, glow: true, grav: -0.002 });
    if (!S) return;
    const fade = m.dying ? Math.max(0, 1 - (m.dieT || 0) / (m.boss ? 30 : 16)) : 1;
    this.blit(S, x, y, { sx, sy, pivot: [x + w / 2, y + h], rim: m.dying ? null : this.rimFor(x + w / 2, y + h / 2, false), alpha: m.dying ? 0.4 + 0.6 * fade : 1 });
    for (const l of S.lights) if (l.s > 0.05) this.r.light(x + l.x, y + l.y, l.r * 2, n3(l.c), l.s);
    for (const lb of S.labels) (this.monLabels ||= []).push({ ...lb, x: x + lb.x, y: y + lb.y });
    // status marks
    if (m.stun > 0) for (let s = 0; s < 3; s++) { const g = nowP / 200 + s * 2.1; this.r.draw(this.T.spark, 0, 0, 32, 32, x + w / 2 + Math.cos(g) * 5 - 2, y - 4 + Math.sin(g) * 1.3 - 2, 4, 4, { pass: 'glow', color: [1, 0.9, 0.4, 0.9] }); }
    if (m.mark > 0) this.r.draw(this.T.ring, 0, 0, 128, 128, x + w / 2 - 4, y - 11, 8, 8, { pass: 'glow', color: [1, 0.25, 0.25, 0.9] });
    if (m.doom > 0) this.r.draw(this.T.ring, 0, 0, 128, 128, x + w / 2 - 3 - m.doom / 10, y - 10 - m.doom / 10, 6 + m.doom / 5, 6 + m.doom / 5, { pass: 'glow', color: [0.66, 0.3, 1, 0.9] });
    if (m.taunt > 0 && (nowP / 250 | 0) % 2) (this.monLabels ||= []).push({ x: x + w / 2, y: y - 9, text: '!', c: [120, 190, 255], bold: true });
  }

  // ---------- props ----------

  campSprite(atlas, E, at) {
    const h = E.hero;
    if (!h) return null;
    const pose = h.pose;
    return renderWith(atlas, 60, 24, 4, 20, (pc) => {
      const floorY = 0, hx = 0, fx = 22;
      // log seat
      for (let x = hx + 1; x <= hx + 13; x++) for (let y = floorY - 4; y < floorY; y++) {
        const rr = y - (floorY - 4);
        let c = [[118, 80, 48], [96, 64, 38], [82, 54, 32], [62, 42, 26]][rr];
        if (x === hx + 13) c = rr === 0 || rr === 3 ? INK : [196, 150, 96];
        else if (rr === 0 && (x + 1) % 5 === 0) c = [140, 100, 62];
        pc.set(x, y, x === hx + 1 ? INK : c);
      }
      // tripod and pot
      const apex = [fx + 4, floorY - 14];
      for (const foot of [[fx - 1, floorY - 1], [fx + 9, floorY - 1]]) {
        const n = Math.max(Math.abs(foot[0] - apex[0]), Math.abs(foot[1] - apex[1]));
        for (let i = 0; i <= n; i++) pc.set(Math.round(foot[0] + (apex[0] - foot[0]) * i / n), Math.round(foot[1] + (apex[1] - foot[1]) * i / n), [74, 50, 32]);
      }
      pc.set(apex[0], apex[1] + 1, [60, 60, 70]); pc.set(apex[0], apex[1] + 2, [60, 60, 70]);
      pc.sprite(fx + 1, floorY - 11, ['.KKKKK.', 'KgGGGgK', 'KgGGggK', '.KgggK.'], { K: INK, G: [96, 98, 112], g: [62, 62, 74] });
      // bedroll
      const bx = fx + 13, by = floorY - 3, blanket = X.shade([124, 74, 206], 1);
      for (let x = bx; x < bx + 14; x++) for (let y = by; y < floorY; y++) {
        const edge = x === bx || x === bx + 13 || y === by, pillow = x < bx + 4;
        pc.set(x, y, edge ? INK : pillow ? [214, 206, 188] : X.shade(blanket, (x - bx) % 4 === 0 ? 0.7 : y === by + 1 ? 1 : 0.8));
      }
      pc.sprite(fx, floorY - 2, X.FIRE[0].slice(4), X.BASE);
      void pose; void at;
    });
  }

  flame(x, y, w, h, tt, a = 1) {
    const T = this.T, fi = T.flameInfo;
    const f = Math.floor((tt * 14) % fi.frames);
    this.r.draw(T.flames, f * fi.fw, 0, fi.fw, fi.fh, x - w, y - h * 1.6, w * 2, h * 2, { pass: 'glow', color: [1, 1, 1, a] });
    this.r.draw(T.glow, 0, 0, 64, 64, x - w * 1.6, y - h * 1.2, w * 3.2, w * 3.2, { pass: 'glow', color: [1, 0.55, 0.2, 0.35 * a] });
  }

  drawCamp(d, h, pose) {
    const S = this.sprites && this.sprites.props.camp;
    const fx = h.x + 22, floorY = d.floorY, t = d.t;
    if (S) this.blit(S, h.x, floorY, { rim: null });
    const lit = pose !== 'sleep';
    const fl = 0.85 + 0.15 * Math.sin(t * 11) * Math.sin(t * 4.3);
    if (lit) {
      this.flame(fx + 4.5, floorY - 2.5, 5 * fl, 7 * fl, t);
      this.r.light(fx + 4, floorY - 6, 110 * fl, [1, 0.55, 0.22], 0.85 * fl);
      if (Math.random() < 0.25) this.burst(fx + 4 + (Math.random() - 0.5) * 3, floorY - 8, 1, [[255, 200, 90], [255, 120, 40]], { speed: 0.35, life: 900, glow: true, grav: -0.0025, up: 1.2 });
      if (Math.random() < 0.06) this.parts.push({ x: fx + 4, y: floorY - 14, vx: 0.002, vy: -0.008, g: 0, c: [150, 150, 160], t0: performance.now(), life: 2600, smoke: true, size: 5 });
    } else {
      this.r.draw(this.T.glow, 0, 0, 64, 64, fx - 4, floorY - 8, 17, 10, { pass: 'glow', color: [1, 0.3, 0.1, 0.5 + 0.15 * Math.sin(t * 2)] });
      this.r.light(fx + 4, floorY - 3, 60, [1, 0.35, 0.15], 0.8 + 0.2 * Math.sin(t * 2));
    }
  }

  drawNight(d) {
    const { r, T, t } = d, n = this.night;
    for (let i = 0; i < 40; i++) {
      const x = hash(i, 11) * 320, y = hash(i, 23) * 70;
      const tw = 0.5 + 0.5 * Math.sin(t * (1 + hash(i, 5) * 2) + i);
      r.draw(T.core, 0, 0, 32, 32, x - 0.8, y - 0.8, 1.6, 1.6, { pass: 'glow', color: [0.9, 0.9, 1, n * tw * 0.8] });
    }
    r.draw(T.glow, 0, 0, 64, 64, 240, 4, 36, 36, { pass: 'glow', color: [0.7, 0.75, 1, 0.45 * n] });
    r.draw(T.core, 0, 0, 32, 32, 252, 16, 12, 12, { pass: 'glow', color: [0.95, 0.95, 0.85, n] });
    for (let k = 0; k < 8; k++) {
      const hx = this.ev && this.ev.hero ? this.ev.hero.x + 26 : 100;
      const x = hx + Math.sin(t * 0.4 + k * 1.7) * (20 + k * 5), y = d.floorY - 8 - k * 2.5 + Math.sin(t * 0.9 + k) * 4;
      const a = Math.max(0, Math.sin(t * 1.8 + k * 2)) * n;
      r.draw(T.glow, 0, 0, 64, 64, x - 3, y - 3, 6, 6, { pass: 'glow', color: [0.7, 1, 0.35, 0.8 * a] });
      r.light(x, y, 16, [0.6, 1, 0.3], 0.6 * a);
    }
  }

  drawVictory(d, h) {
    const S = this.sprites && this.sprites.props.chestOpen;
    const cx = h.x + 26, floorY = d.floorY, t = d.t;
    if (S) this.blit(S, cx, floorY - 8, { rim: this.rimFor(cx + 6, floorY - 4, false) });
    this.r.draw(this.T.beam, 0, 0, 64, 128, cx - 6, floorY - 46, 24, 40, { pass: 'glow', color: [1, 0.85, 0.4, 0.55] });
    this.r.light(cx + 6, floorY - 8, 70, [1, 0.8, 0.35], 1.3);
    if (Math.random() < 0.5) this.burst(cx + 6, floorY - 8, 2, [[255, 214, 80], [255, 240, 150]], { speed: 1.2, life: 700, glow: true, grav: 0.004, up: 2 });
    void t;
  }

  drawSummon(d, h) {
    const cx = h.x + 30, cy = d.floorY - 1, t = d.t;
    this.r.draw(this.T.ring, 0, 0, 128, 128, cx - 14, cy - 4, 28, 8, { pass: 'glow', color: [0.73, 0.53, 1, 0.9] });
    this.r.draw(this.T.ring, 0, 0, 128, 128, cx - 9, cy - 2.5, 18, 5, { pass: 'glow', color: [1, 0.9, 1, 0.6 + 0.3 * Math.sin(t * 6)] });
    this.r.light(cx, cy - 6, 60, [0.7, 0.45, 1], 1.1);
  }

  // ---------- spells ----------

  drawShots(shots, E, t) {
    const r = this.r, T = this.T;
    const seen = new Set();
    for (const s of shots) {
      const c = n3(s.color || [255, 220, 150]);
      const id = s.id || 'basic';
      const key = `${id}:${Math.round(s.px)}:${Math.round(s.py)}`;
      seen.add(key);
      // trail from where it was
      const dx = s.x - s.px, dy = s.y - s.py, len = Math.hypot(dx, dy);
      const ux = len ? dx / len : 1, uy = len ? dy / len : 0;
      const tail = id === 'meteor' ? 16 : id === 'fireball' ? 10 : 7;
      const arrow = (id === 'basic' || id === 'arrow' || id === 'multishot') && (s.cls === 'ranger' || s.ally === 'ranger' || id === 'multishot');
      if (arrow) {
        r.line(T.pixel, s.x - ux * 6, s.y - uy * 6, s.x, s.y, 0.9, [0.85, 0.72, 0.5, 1], 'base');
        r.line(T.pixel, s.x - ux * 1.5, s.y - uy * 1.5, s.x + ux * 0.5, s.y + uy * 0.5, 1.2, [0.95, 0.95, 1, 1], 'base');
        r.line(T.line, s.x - ux * 12, s.y - uy * 12, s.x, s.y, 2.2, [...c, 0.35]);
        continue;
      }
      if (/anthem|encore|note/.test(id) || (id === 'basic' && s.cls === 'bard')) {
        (this.noteLabels ||= []).push({ x: s.x, y: s.y, text: (t * 4 | 0) % 2 ? '♪' : '♫', c: s.color || [255, 200, 90] });
        r.draw(T.glow, 0, 0, 64, 64, s.x - 5, s.y - 5, 10, 10, { pass: 'glow', color: [...c, 0.6] });
        r.light(s.x, s.y, 24, c, 0.6);
        continue;
      }
      r.line(T.line, s.x - ux * tail, s.y - uy * tail, s.x, s.y, id === 'meteor' ? 6 : 3.2, [...c, 0.75]);
      const size = id === 'meteor' ? 7 : id === 'fireball' ? 5 : id === 'doom' ? 6 : 3.4;
      r.draw(T.glow, 0, 0, 64, 64, s.x - size * 1.6, s.y - size * 1.6, size * 3.2, size * 3.2, { pass: 'glow', color: [...c, 0.8] });
      r.draw(T.core, 0, 0, 32, 32, s.x - size / 2, s.y - size / 2, size, size, { pass: 'glow', color: [1, 1, 1, 0.95] });
      if (id === 'frost' || id === 'starfall') r.draw(T.spark, 0, 0, 32, 32, s.x - size, s.y - size, size * 2, size * 2, { pass: 'glow', color: [...c, 0.9], angle: t * 4 });
      // magic trail sparks
      if (Math.random() < (id === 'meteor' || id === 'fireball' ? 0.9 : 0.4)) this.burst(s.x - ux * 2, s.y - uy * 2, 1, [s.color || [255, 220, 150], [255, 255, 255]], { speed: 0.35, life: 350, glow: true, grav: id === 'meteor' || id === 'fireball' ? -0.001 : 0.001 });
    }
  }

  drawBolts(E, t) {
    const r = this.r, T = this.T;
    for (const bo of E.bolts || []) {
      const [x1, y1] = bo.from, [x2, y2] = bo.to;
      const n = Math.max(3, Math.ceil(Math.hypot(x2 - x1, y2 - y1) / 6));
      let px = x1, py = y1;
      const seed = Math.floor(t * 30);
      for (let i = 1; i <= n; i++) {
        const u = i / n;
        const jx = i === n ? 0 : (hash(i, seed) - 0.5) * 7, jy = i === n ? 0 : (hash(seed, i) - 0.5) * 7;
        const nx = x1 + (x2 - x1) * u + jx, ny = y1 + (y2 - y1) * u + jy;
        r.line(T.line, px, py, nx, ny, 5, [0.55, 0.75, 1, 0.8]);
        r.line(T.line, px, py, nx, ny, 1.6, [1, 1, 1, 1]);
        if (i % 3 === 1) r.line(T.line, nx, ny, nx + (hash(i, seed + 1) - 0.5) * 12, ny + (hash(i + 3, seed) - 0.3) * 10, 1.2, [0.6, 0.8, 1, 0.7]);
        px = nx; py = ny;
      }
      r.draw(T.glow, 0, 0, 64, 64, x2 - 10, y2 - 10, 20, 20, { pass: 'glow', color: [0.6, 0.8, 1, 0.9] });
    }
  }

  drawFx(A, B, k, E, d) {
    const r = this.r, T = this.T, t = d.t;
    const fa = A.fx || [], fb = B.fx || [];
    const list = k < 0.5 ? fa : fb;
    const tgt = (f) => { const m = this.monsterAt(E, f.targetId); return m ? [(m._x ?? m.x) + (m.w || 12) / 2, (m._y ?? m.y) + (m.h || 12) / 2, m] : f.tx != null ? [f.tx, f.ty ?? f.y, null] : null; };
    for (const f0 of list) {
      const f = { ...f0 };
      const other = (k < 0.5 ? fb : fa).find((o) => o.kind === f.kind && Math.abs((o.x || 0) - (f.x || 0)) < 12);
      const ft = (f.t || 0) + (k < 0.5 ? k : k - 1);
      if (other && typeof f.x === 'number' && typeof other.x === 'number') f.x = k < 0.5 ? lerp(f.x, other.x, k) : lerp(other.x, f.x, k);
      const life = Math.max(1, f.life || 10), p = clamp01(ft / life);
      const col = f.color ? n3(f.color) : [1, 1, 1];
      switch (f.kind) {
        case 'nova': {
          const rad = 3 + ft * 2;
          r.draw(T.ring, 0, 0, 128, 128, f.x - rad, f.y - rad * 0.55, rad * 2, rad * 1.1, { pass: 'glow', color: [0.75, 0.95, 1, 1 - p] });
          r.draw(T.ring, 0, 0, 128, 128, f.x - rad * 0.7, f.y - rad * 0.4, rad * 1.4, rad * 0.8, { pass: 'glow', color: [0.5, 0.85, 1, 0.7 * (1 - p)] });
          r.light(f.x, f.y, rad * 2, [0.55, 0.85, 1], 1 - p);
          break;
        }
        case 'trap': {
          const shut = ft >= 5;
          r.line(T.pixel, f.x - 4, f.y - 1, f.x + 4, f.y - 1, 1, [0.45, 0.4, 0.35, 1], 'base');
          for (const [dx, dy] of shut ? [[-2, -2], [0, -3], [2, -2]] : [[-4, -3], [-3, -2], [3, -2], [4, -3]]) r.draw(T.pixel, 0, 0, 2, 2, f.x + dx, f.y + dy, 1, 1, { color: [0.9, 0.9, 0.95, 1] });
          if (shut && ft < 9) r.draw(T.glow, 0, 0, 64, 64, f.x - 6, f.y - 7, 12, 12, { pass: 'glow', color: [1, 0.95, 0.8, 0.6] });
          break;
        }
        case 'pierce': {
          const x = f.x + (k < 0.5 ? 0 : 0);
          r.line(T.line, x - 20, f.y, x, f.y, 3, [0.8, 0.88, 1, 0.9]);
          r.line(T.pixel, x - 5, f.y, x + 1, f.y, 1, [1, 1, 1, 1], 'base');
          r.light(x, f.y, 30, [0.8, 0.88, 1], 0.8);
          break;
        }
        case 'rain': {
          const left = f.x - (f.r || 22), right = f.x + (f.r || 22);
          if (ft <= (f.volleys || 4) * 4 + 2) for (let c = 0; c < 14; c++) {
            const ax = left + ((c * 37 + t * 90) % Math.max(1, right - left));
            const ay = ((c * 13 + ft * 16) % (d.floorY - 2));
            r.line(T.pixel, ax + 1.5, ay - 5, ax, ay, 0.8, [0.8, 0.65, 0.4, 1], 'base');
            r.line(T.line, ax + 3, ay - 10, ax, ay, 1.5, [1, 0.9, 0.7, 0.3]);
          }
          break;
        }
        case 'eagle': {
          const up = (t * 8 | 0) % 2;
          r.draw(T.pixel, 0, 0, 2, 2, f.x - 2, f.y, 5, 2, { color: [0.77, 0.59, 0.35, 1] });
          for (let i = 1; i <= 5; i++) r.draw(T.pixel, 0, 0, 2, 2, f.x - i, f.y + (up ? -i * 0.6 : i * 0.3), 1, 1, { color: [0.59, 0.4, 0.23, 1] });
          r.line(T.line, f.x - 26, f.y + 1, f.x - 2, f.y + 1, 3, [1, 0.94, 0.78, 0.5]);
          break;
        }
        case 'bash': {
          const rad = 2 + ft;
          r.draw(T.ring, 0, 0, 128, 128, f.x - 3 - rad, f.y - rad, rad * 2, rad * 2, { pass: 'glow', color: [0.6, 0.8, 1, 1 - p] });
          r.light(f.x, f.y, 30, [0.6, 0.8, 1], 1 - p);
          break;
        }
        case 'shout': case 'echo': {
          const c = f.kind === 'echo' ? [0.78, 0.66, 1] : [0.47, 0.75, 1];
          for (let j = 0; j < 3; j++) { const rad = ft * 3 - j * 6; if (rad > 0) r.draw(T.ring, 0, 0, 128, 128, f.x - rad, f.y - rad * 0.6, rad * 2, rad * 1.2, { pass: 'glow', color: [...c, 0.8 * (1 - p)] }); }
          break;
        }
        case 'whirl': {
          const cx = f.x + 6, cy = f.y;
          for (let j = 0; j < 3; j++) {
            const g = t * 11 + j * 2.1, rad = 10 + (f.r || 30) * 0.3;
            for (let i = 0; i < 6; i++) { const g1 = g - i * 0.14, g2 = g - (i + 1) * 0.14; r.line(T.line, cx + Math.cos(g1) * rad, cy + Math.sin(g1) * rad * 0.45, cx + Math.cos(g2) * rad, cy + Math.sin(g2) * rad * 0.45, 2.6, [0.92, 0.95, 1, 0.9 - i * 0.14]); }
          }
          r.light(cx, cy, 50, [0.8, 0.85, 1], 0.7);
          break;
        }
        case 'pillar': {
          const tp = tgt(f);
          if (tp) {
            const bottom = tp[2] ? (tp[2]._y ?? tp[2].y) + (tp[2].h || 12) : tp[1] + 8;
            const half = Math.max(1.5, 7 - Math.abs(ft - 4) * 1.2), reach = Math.min(1, ft / 4) * bottom;
            r.draw(T.beam, 0, 0, 64, 128, tp[0] - half * 2, bottom - reach, half * 4, reach, { pass: 'glow', color: [1, 0.92, 0.6, 0.9 * (1 - p * 0.6)] });
            r.draw(T.beam, 0, 0, 64, 128, tp[0] - half * 0.7, bottom - reach, half * 1.4, reach, { pass: 'glow', color: [1, 1, 1, 0.9 * (1 - p * 0.6)] });
            r.light(tp[0], bottom - 10, 80, [1, 0.9, 0.55], 1.6 * (1 - p));
          }
          break;
        }
        case 'hammer': {
          const tt = ft - (f.delay || 0), tp = tgt(f);
          if (tt >= 0 && tt <= 7 && tp) {
            const y = -6 + (tp[1] - 4 + 6) * Math.min(1, tt / 6);
            r.draw(T.pixel, 0, 0, 2, 2, tp[0] - 3.5, y - 2, 7, 3, { color: [1, 0.88, 0.5, 1] });
            r.draw(T.pixel, 0, 0, 2, 2, tp[0] - 0.5, y - 7, 1, 5, { color: [0.78, 0.62, 0.35, 1] });
            r.draw(T.glow, 0, 0, 64, 64, tp[0] - 8, y - 8, 16, 16, { pass: 'glow', color: [1, 0.86, 0.43, 0.8] });
            r.light(tp[0], y, 40, [1, 0.85, 0.4], 1);
          }
          break;
        }
        case 'beam': {
          const tp = tgt(f), h = this.ev && this.ev.hero;
          if (tp && h) {
            const hx = h.x + 10, hy = h.y + 8, n = 14;
            let px = tp[0], py = tp[1];
            for (let i = 1; i <= n; i++) { const u = i / n, nx = tp[0] + (hx - tp[0]) * u, ny = tp[1] + (hy - tp[1]) * u + Math.sin(u * 12 + t * 8) * 1.8; r.line(T.line, px, py, nx, ny, 3, [1, 0.3, 0.4, 0.85 * (1 - p * 0.5)]); px = nx; py = ny; }
            r.light(tp[0], tp[1], 30, [1, 0.3, 0.4], 0.8);
          }
          break;
        }
        case 'cone': {
          const len = Math.max(4, (f.tx || f.x + 40) - f.x);
          for (let i = 0; i < len; i += 3) {
            const spread = 1 + i * 0.28;
            r.draw(T.smoke, 0, 0, 64, 64, f.x + i - spread, f.y - spread, spread * 2, spread * 2, { pass: 'glow', color: [0.55, 0.2, 0.85, 0.35 * (1 - p)] });
          }
          r.light(f.x + len / 2, f.y, len, [0.6, 0.25, 0.95], 1 - p);
          if (Math.random() < 0.8) this.burst(f.x + Math.random() * len, f.y + (Math.random() - 0.5) * len * 0.4, 1, [[200, 150, 255], [120, 50, 200]], { speed: 0.4, life: 400, glow: true, grav: -0.002 });
          break;
        }
        case 'notes': for (let j = 0; j < 4; j++) { const ph = (ft + j * 5) % 18; (this.noteLabels ||= []).push({ x: f.x - 8 + j * 5, y: f.y - ph, text: j % 2 ? '♪' : '♫', c: f.color || [255, 200, 120] }); } break;
        case 'ring': {
          const rad = Math.min(f.r || 20, 2 + ft * 3);
          r.draw(T.ring, 0, 0, 128, 128, f.x - rad, f.y - rad * 0.5, rad * 2, rad, { pass: 'glow', color: [...col, 0.9 * (1 - p)] });
          break;
        }
        case 'wave': {
          for (let j = 0; j < 3; j++) { const x = f.x - j * 4; r.quad(T.line, [0, 0, 1, 1], [x - 2.5, f.y - 10 + j * 2, x + 1, f.y - 10 + j * 2, x + 1, f.y + 10 - j * 2, x - 2.5, f.y + 10 - j * 2], [1, 0.75 - j * 0.1, 0.9, 0.8 - j * 0.22], 'glow'); }
          r.light(f.x, f.y, 40, [1, 0.7, 0.9], 0.7);
          break;
        }
        case 'cloud': {
          const fade = life - ft < 10 ? (life - ft) / 10 : 1;
          for (let j = 0; j < 7; j++) {
            const cx = f.x + Math.sin(j * 2.3 + t * 0.5) * 12, cy = f.y - (j % 3) * 4 + Math.cos(j + t * 0.7) * 2, rad = 7 + (j % 3) * 2;
            r.draw(T.smoke, 0, 0, 64, 64, cx - rad, cy - rad, rad * 2, rad * 2, { color: [0.55, 0.55, 0.62, 0.55 * fade] });
          }
          break;
        }
        case 'step': {
          const tt = ft - (f.delay || 0), tp = tgt(f);
          if (tt >= 1 && tt <= 5 && tp) { r.line(T.line, tp[0] - 5, tp[1] - 5, tp[0] + 5, tp[1] + 5, 2.2, [0.8, 1, 0.95, 1]); r.line(T.line, tp[0] - 5, tp[1] + 5, tp[0] + 5, tp[1] - 5, 2.2, [0.5, 0.9, 0.8, 1]); }
          break;
        }
        default: break;
      }
    }
    // floor shockwaves
    for (const rg of (k < 0.5 ? A.rings : B.rings) || []) {
      const a = Math.max(0, rg.life / 10), rad = rg.r + (k < 0.5 ? k : k - 1) * 3;
      r.draw(T.ring, 0, 0, 128, 128, rg.x - rad, rg.y - rad * 0.22, rad * 2, rad * 0.44, { pass: 'glow', color: [...n3(rg.c || [255, 214, 80]), 0.9 * a] });
    }
    for (const ds of E.dashes || []) {
      const kk = ds.t <= 4 ? ds.t / 4 : 1 - (ds.t - 4) / 5;
      const px = ds.x0 + (ds.tx - ds.x0) * kk, py = ds.y0 + (ds.ty - ds.y0) * kk * 0.5;
      r.line(T.line, px - 14 * (ds.t <= 4 ? 1 : -1), py, px, py, 4, [0.3, 0.9, 0.8, 0.7]);
      if (ds.t >= 4 && ds.t <= 6) r.line(T.line, ds.tx + 2, ds.ty - 4, ds.tx + 5, ds.ty + 4, 2, [0.9, 1, 0.95, 1]);
    }
    if (E.shield && E.hero) {
      const cx = E.hero.x + 8, cy = E.hero.y + 12;
      r.draw(T.ring, 0, 0, 128, 128, cx - 14, cy - 16, 28, 32, { pass: 'glow', color: [0.55, 0.8, 1, 0.14 + 0.05 * Math.sin(t * 4)] });
    }
  }

  drawCoins(A, B, k, t) {
    const coins = this.matchList(A.coins, B.coins, k, null, 10);
    for (const c of coins) {
      const f = Math.floor((t * 10 + c.x) % 4);
      this.r.draw(this.T.coin, f * 8, 0, 8, 8, c.x - 1.6, c.y - 1.6, 3.2, 3.2, { color: [1, 1, 1, 1] });
      this.r.draw(this.T.glow, 0, 0, 64, 64, c.x - 3, c.y - 3, 6, 6, { pass: 'glow', color: [1, 0.8, 0.3, 0.45] });
      if (Math.random() < 0.15) this.burst(c.x, c.y, 1, [[255, 240, 170]], { speed: 0.1, life: 300, glow: true, grav: 0 });
    }
  }

  drawParticles(A, B, k) {
    const ps = this.matchList(A.particles, B.particles, k, (a, b) => a.c && b.c && a.c[0] === b.c[0] && a.c[1] === b.c[1], 5);
    for (const p of ps) {
      const c = n3(p.c);
      const a = p.fresh ? k : 1;
      this.r.draw(this.T.pixel, 0, 0, 2, 2, p.x - 0.5, p.y - 0.5, 1, 1, { pass: 'glow', color: [...c, a] });
      if (lum(p.c) > 0.45) this.r.draw(this.T.glow, 0, 0, 64, 64, p.x - 2, p.y - 2, 4, 4, { pass: 'glow', color: [...c, 0.35 * a] });
    }
  }

  drawClientParticles(dt) {
    const now = performance.now(), r = this.r, T = this.T;
    const step = this.hitStop > 0 ? dt * 0.15 : dt;
    this.parts = this.parts.filter((p) => now - p.t0 < p.life);
    for (const p of this.parts) {
      p.vy += p.g * step; p.x += p.vx * step; p.y += p.vy * step;
      const age = (now - p.t0) / p.life, a = 1 - age;
      const c = n3(p.c);
      if (p.confetti) {
        p.vx += Math.sin(now / 300 + p.spin) * 0.00002 * step;
        const w = 1.8 * Math.abs(Math.cos(now / 160 + p.spin));
        r.draw(T.pixel, 0, 0, 2, 2, p.x - w / 2, p.y - 0.6, Math.max(0.3, w), 1.2, { color: [...c, Math.min(1, a * 3)], angle: p.spin + now / 500 });
      } else if (p.smoke) {
        const s = p.size * (1 + age * 1.5);
        r.draw(T.smoke, 0, 0, 64, 64, p.x - s / 2, p.y - s / 2, s, s, { color: [0.35, 0.35, 0.4, 0.25 * a] });
      } else {
        const s = p.size || 1;
        r.draw(T.core, 0, 0, 32, 32, p.x - s, p.y - s, s * 2, s * 2, { pass: 'glow', color: [...c, a] });
        if (p.glow && s > 0.8) r.draw(T.glow, 0, 0, 64, 64, p.x - 3 * s, p.y - 3 * s, 6 * s, 6 * s, { pass: 'glow', color: [...c, 0.25 * a] });
      }
    }
  }

  drawRings(now) {
    this._rings = this.rings.filter((g) => now - g.t0 < g.life);
    for (const g of this._rings) {
      const p = (now - g.t0) / g.life, rad = g.r * ease.outCubic(p);
      this.r.draw(this.T.ring, 0, 0, 128, 128, g.x - rad, g.y - rad * g.squash, rad * 2, rad * 2 * g.squash, { pass: 'glow', color: [...n3(g.c), 0.9 * (1 - p)] });
    }
  }

  drawFinisher(now) {
    const f = this.finisher;
    if (!f) return;
    const p = (now - f.t0) / 1100;
    if (p > 1) { this.finisher = null; return; }
    const half = Math.min(f.w / 2 + 4, 4 + p * 60), a = p < 0.2 ? p / 0.2 : 1 - (p - 0.2) / 0.8;
    this.r.draw(this.T.beam, 0, 0, 64, 128, f.x - half * 1.5, -10, half * 3, f.bottom + 10, { pass: 'glow', color: [1, 0.9, 0.55, a] });
    this.r.draw(this.T.beam, 0, 0, 64, 128, f.x - half * 0.5, -10, half, f.bottom + 10, { pass: 'glow', color: [1, 1, 1, a] });
    this.r.light(f.x, f.bottom - 10, 160, [1, 0.9, 0.6], 2 * a);
  }

  // ---------- loot chest (quest chests take over the screen) ----------

  lootChestSprite(atlas, loot, at) {
    if (!loot) return null;
    const c = loot.colors || {};
    const body = c.body || [150, 98, 52], dark = c.dark || X.shade(body, 0.6), trim = c.trim || [118, 122, 136], hi = c.trimHi || X.mix(trim, [255, 255, 255], 0.5), lock = c.lock || [220, 200, 120];
    const W = 26, burst = loot.kind === 'wave' ? 7 : 12, open = loot.age >= burst;
    return renderWith(atlas, W + 4, 34, 2, 14, (pc) => {
      const base = 20, lid = 9, top = 20 - 11;
      // base box
      for (let y = top; y < base; y++) for (let x = 0; x < W; x++) {
        const edge = x === 0 || x === W - 1 || y === base - 1;
        const band = x === 3 || x === W - 4;
        let col = edge ? INK : band ? trim : (y - top) % 4 === 0 ? dark : body;
        if (band && y === top + 1) col = hi;
        pc.set(x, y, col);
      }
      // lid (closed sits on the base; open flies up)
      const ly = open ? top - lid - 3 - Math.min(6, (loot.age - burst) * 2) : top - lid;
      for (let y = ly; y < ly + lid; y++) for (let x = 0; x < W; x++) {
        const rr = y - ly;
        const round = (rr === 0 && (x < 2 || x > W - 3)) || (rr === 1 && (x < 1 || x > W - 2));
        if (round) continue;
        const edge = x === 0 || x === W - 1 || rr === 0 || rr === lid - 1;
        const band = x === 3 || x === W - 4;
        pc.set(x, y, edge ? INK : band ? trim : rr < 3 ? X.mix(body, [255, 255, 255], 0.18) : body);
      }
      if (!open) { for (const [dx, dy] of [[0, 0], [1, 0], [0, 1], [1, 1], [0, 2], [1, 2]]) pc.set(W / 2 - 1 + dx, top - 2 + dy, lock); pc.set(W / 2 - 1, top - 1, INK); }
      void at;
    });
  }

  drawQuestChest(loot, t, now) {
    const S = this.sprites && this.sprites.props.chest;
    const age = loot.age, burst = 12;
    const cx = 160, baseY = 118;
    // dim the stage
    this.r.draw(this.T.pixel, 0, 0, 2, 2, -40, -40, 400, 260, { color: [0, 0, 0, Math.min(0.55, age / 10)] });
    const drop = age < 6 ? ease.outBack(age / 6) : 1;
    const shake = age >= 6 && age < burst ? Math.sin(t * 60) * (age - 6) * 0.25 : 0;
    const scale = 2;
    if (S) {
      const y = baseY - 34 * scale + (1 - drop) * -120;
      if (age >= burst - 5) {
        const k = age < burst ? (age - (burst - 5)) / 5 : 1;
        const rays = 12;
        for (let i = 0; i < rays; i++) {
          const a = (i / rays) * Math.PI * 2 + t * 0.4, len = (age >= burst ? 150 : 40) * k;
          const x2 = cx + Math.cos(a) * len, y2 = baseY - 28 + Math.sin(a) * len;
          this.r.line(this.T.line, cx, baseY - 28, x2, y2, age >= burst ? 16 : 5, [...n3((loot.colors && loot.colors.glow) || [255, 214, 120]), 0.35 * k]);
        }
        this.r.draw(this.T.glow, 0, 0, 64, 64, cx - 60 * k, baseY - 80 * k, 120 * k, 110 * k, { pass: 'glow', color: [...n3((loot.colors && loot.colors.glow) || [255, 220, 130]), 0.4 * k] });
        this.r.light(cx, baseY - 30, 180, n3((loot.colors && loot.colors.glow) || [255, 214, 120]), 2 * k);
      }
      this.blit(S, cx - 15 * scale + shake, y + 14 * scale, { sx: scale, sy: scale, pivot: [cx - 15 * scale + shake - S.dx, y + 14 * scale - S.dy] });
    }
    if (this.lootBurstT && now - this.lootBurstT < 60) {
      this.lootBurstT = 0;
      this.flash = this.reduce ? 0.15 : 0.7;
      this.burst(cx, baseY - 30, 80, [[255, 214, 80], [255, 255, 200], [255, 150, 60]], { speed: 2.8, life: 1400, glow: true, grav: 0.003, up: 1.4 });
      this.burst(cx, baseY - 30, 30, [[120, 220, 255], [200, 120, 255], [120, 255, 160]], { speed: 2, life: 1600, glow: true, grav: 0.002, up: 1.2, size: 1.6 });
    }
  }

  // ---------- 2D overlay: text ----------

  drawOverlay(A, B, k, E, hero, now) {
    const o = this.octx, r = this.r;
    o.setTransform(1, 0, 0, 1, 0, 0);
    o.clearRect(0, 0, this.overlay.width, this.overlay.height);
    const K = r.k;
    const X0 = (x) => r.tx(x), Y0 = (y) => r.ty(y);
    const font = (px, w = 700) => `${w} ${Math.round(px)}px ui-monospace, "Cascadia Mono", "Segoe UI Mono", Consolas, Menlo, monospace`;
    o.textAlign = 'center'; o.textBaseline = 'middle';
    o.lineJoin = 'round';

    // Monster HP bars and the front monster's name tag.
    const alive = (E.monsters || []).filter((m) => !m.dying && !m.boss && !m.entering);
    const front = alive.slice().sort((a, b) => a.x - b.x)[0];
    for (const m of alive) {
      const x = m._x ?? m.x, y = m._y ?? m.y, w = m.w || 12;
      const st = this.mon.get(m.id);
      if (st) st.lag = Math.max(m.hp, (st.lag ?? m.hp) - Math.max(0.2, ((st.lag ?? m.hp) - m.hp) * 0.06));
      const ratio = Math.max(0, m.hp / m.max), lag = st ? Math.max(ratio, st.lag / m.max) : ratio;
      const bw = Math.max(14, w) * K, bh = Math.max(3, 2.2 * K), bx = X0(x + w / 2) - bw / 2, by = Y0(y - (m.elite ? 9 : 5));
      o.fillStyle = 'rgba(10,6,14,0.85)'; o.fillRect(bx - 1.5, by - 1.5, bw + 3, bh + 3);
      o.fillStyle = 'rgba(255,240,210,0.85)'; o.fillRect(bx, by, bw * lag, bh);
      const g = o.createLinearGradient(0, by, 0, by + bh);
      const c = ratio > 0.6 ? ['#8ef07a', '#3fa83a'] : ratio > 0.3 ? ['#ffe070', '#c89a20'] : ['#ff7a6a', '#b02a24'];
      g.addColorStop(0, c[0]); g.addColorStop(1, c[1]);
      o.fillStyle = g; o.fillRect(bx, by, bw * ratio, bh);
      o.strokeStyle = m.elite ? '#ffcf4a' : 'rgba(0,0,0,0.9)'; o.lineWidth = m.elite ? 1.5 * this.dpr : 1; o.strokeRect(bx - 1, by - 1, bw + 2, bh + 2);
      if (m === front) {
        const tag = `${m.name || m.type} Lv${m.lvl || 1}${m.xp ? ` · ${m.xp} XP` : E.practice ? ' · practice' : ''}`;
        o.font = font(Math.max(10, 2.6 * K), 700);
        o.lineWidth = 3 * this.dpr; o.strokeStyle = 'rgba(8,4,12,0.85)'; o.strokeText(tag, X0(x + w / 2), by - 2.6 * K);
        o.fillStyle = m.elite ? '#ffd76a' : '#ffe9cf'; o.fillText(tag, X0(x + w / 2), by - 2.6 * K);
      }
    }

    // Labels from sprite code (notes, alert marks) and sleep z's.
    const labels = [...(this.heroLabels || []), ...(this.compLabels || []), ...(this.monLabels || []), ...(this.noteLabels || [])];
    this.compLabels = []; this.monLabels = []; this.noteLabels = [];
    o.font = font(Math.max(10, 3.4 * K), 800);
    for (const lb of labels) {
      o.lineWidth = 3 * this.dpr; o.strokeStyle = 'rgba(10,6,16,0.8)'; o.strokeText(lb.text, X0(lb.x + 0.5), Y0(lb.y + 1));
      o.fillStyle = `rgb(${lb.c || [255, 220, 120]})`; o.fillText(lb.text, X0(lb.x + 0.5), Y0(lb.y + 1));
    }
    if (hero && hero.pose === 'sleep') {
      for (let kk = 0; kk < 2; kk++) {
        const ph = ((now / 1000 * 3 + kk * 1.5) % 3) / 3;
        o.globalAlpha = Math.sin(ph * Math.PI);
        o.font = font((2.4 + kk * 1.2) * K, 800); o.fillStyle = '#c8c8f0';
        o.fillText(kk ? 'Z' : 'z', X0(hero.x + 11 + ph * 5), Y0(hero.y + 6 - ph * 10));
      }
      o.globalAlpha = 1;
    }

    // Thought / speech bubble.
    if (E.bubble && E.bubble.text && hero && !(E.loot && E.loot.kind === 'quest')) this.drawBubble(o, E.bubble, hero, K, font);

    // Floaters: pop, rise, fade.
    this.floaters = this.floaters.filter((f) => now - f.t0 < (f.combo ? 1600 : f.crit ? 1300 : 1100));
    for (const f of this.floaters) {
      const age = (now - f.t0) / (f.combo ? 1600 : f.crit ? 1300 : 1100);
      const pop = f.crit ? 1 + 0.9 * (1 - ease.outBack(Math.min(1, age * 7))) : 1 + 0.5 * (1 - ease.outCubic(Math.min(1, age * 8)));
      const rise = ease.outCubic(age) * (f.combo ? 10 : 14);
      const a = age > 0.7 ? 1 - (age - 0.7) / 0.3 : 1;
      const size = (f.crit ? 5.2 : f.combo ? 4.6 : f.xp ? 3.4 : f.big ? 3.8 : 3.6) * K * pop * 0.95;
      const x = X0(f.x + 3 + f.jx * age), y = Y0(f.y - rise);
      o.globalAlpha = a;
      o.font = font(size, 900);
      o.lineWidth = Math.max(3, size * 0.2); o.strokeStyle = 'rgba(12,6,16,0.92)';
      o.strokeText(f.text, x, y);
      if (f.crit || f.combo) {
        const g = o.createLinearGradient(0, y - size / 2, 0, y + size / 2);
        g.addColorStop(0, f.combo ? '#fff0ff' : '#fff6b0'); g.addColorStop(0.5, `rgb(${f.c})`); g.addColorStop(1, f.combo ? '#b03aa8' : '#c2410c');
        o.fillStyle = g;
        o.shadowColor = `rgba(${f.c},0.9)`; o.shadowBlur = size * 0.6;
      } else { o.fillStyle = `rgb(${f.c})`; o.shadowBlur = 0; }
      o.fillText(f.text, x, y);
      o.shadowBlur = 0;
    }
    o.globalAlpha = 1;
    void A; void B; void k;
  }

  drawBubble(o, b, hero, K, font) {
    const text = stripIcons(b.text);
    if (!text) return;
    const speech = b.speech ?? /^(Ouch!|Your move!|Need your OK|ALLOWED|DENIED)/.test(text);
    const size = Math.max(11, 3 * K);
    o.font = font(size, 700);
    const tw = Math.min(o.measureText(text).width, 60 * K), pad = size * 0.7;
    const bw = tw + pad * 2, bh = size + pad * 1.2;
    let x = this.r.tx(hero.x + 8) - bw * 0.25, y = this.r.ty(hero.y - 6) - bh;
    x = Math.max(6, Math.min(this.overlay.width - bw - 6, x)); y = Math.max(6, y);
    o.save();
    o.shadowColor = 'rgba(0,0,0,0.45)'; o.shadowBlur = 10 * this.dpr; o.shadowOffsetY = 2 * this.dpr;
    o.fillStyle = speech ? '#fffaf0' : 'rgba(248,246,236,0.96)';
    o.beginPath(); o.roundRect ? o.roundRect(x, y, bw, bh, bh / 2) : o.rect(x, y, bw, bh); o.fill();
    o.shadowBlur = 0; o.shadowOffsetY = 0;
    o.strokeStyle = 'rgba(22,18,30,0.9)'; o.lineWidth = 1.5 * this.dpr; o.stroke();
    const tx = this.r.tx(hero.x + 8);
    if (speech) { o.beginPath(); o.moveTo(tx - 5 * this.dpr, y + bh - 1); o.lineTo(tx, y + bh + 8 * this.dpr); o.lineTo(tx + 5 * this.dpr, y + bh - 1); o.closePath(); o.fillStyle = '#fffaf0'; o.fill(); o.stroke(); }
    else { for (const [dx, dy, rr] of [[0, 6, 3], [-3, 12, 1.8]]) { o.beginPath(); o.arc(tx + dx * this.dpr, y + bh + dy * this.dpr, rr * this.dpr, 0, Math.PI * 2); o.fillStyle = '#f8f6ec'; o.fill(); o.stroke(); } }
    o.fillStyle = '#16121e'; o.textAlign = 'center';
    let s = text;
    while (o.measureText(s).width > tw && s.length > 3) s = s.slice(0, -2) + '…';
    o.fillText(s, x + bw / 2, y + bh / 2 + 1);
    o.restore();
  }

  hudUpdate(E) {
    const boss = (E.monsters || []).find((m) => m.boss && !m.dying);
    const h = this.hud;
    h.wave = E.wave; h.kills = E.kills; h.gold = E.gold; h.practice = E.practice; h.mode = E.mode;
    if (boss) {
      h.bossLag = h.boss && h.boss.id === boss.id ? Math.max(boss.hp, h.bossLag - Math.max(0.5, (h.bossLag - boss.hp) * 0.04)) : boss.hp;
      h.boss = { id: boss.id, name: (E.boss && E.boss.name) || boss.name, hp: boss.hp, max: boss.max, lag: h.bossLag, enraged: boss.hp / boss.max < 0.35 };
    } else h.boss = null;
  }

  // client px -> logical scene px
  pick(clientX, clientY) {
    const rect = this.canvas.getBoundingClientRect();
    const dx = (clientX - rect.left) * (this.canvas.width / rect.width), dy = (clientY - rect.top) * (this.canvas.height / rect.height);
    const r = this.r;
    return { x: (dx - this.canvas.width / 2) / r.k + LW / 2 + this.cam.x, y: (dy - this.canvas.height / 2) / r.k + LH / 2 + this.cam.y };
  }
  monsterUnder(p) {
    const E = this.ev;
    if (!E) return null;
    return (E.monsters || []).find((m) => !m.dying && p.x >= (m._x ?? m.x) - 3 && p.x <= (m._x ?? m.x) + (m.w || 12) + 3 && p.y >= (m._y ?? m.y) - 4 && p.y <= (m._y ?? m.y) + (m.h || 12) + 4) || null;
  }
}

export { mix, WHITE };
