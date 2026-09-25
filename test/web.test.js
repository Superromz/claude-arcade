// Web view server: runs web/server.js as a child process against a throwaway
// home folder and checks the token, assets, snapshot, the SSE battle stream,
// actions and static file safety (see web/PROTOCOL.md).
// Run with: node --test
'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');
const { spawn } = require('child_process');

const SERVER = path.join(__dirname, '..', 'web', 'server.js');
const home = fs.mkdtempSync(path.join(os.tmpdir(), 'arcade-web-'));
const ARCADE = path.join(home, '.claude', 'arcade');
// APPDATA too, like simulate.test.js; the browser and clipboard stay untouched.
const env = { ...process.env, HOME: home, USERPROFILE: home, APPDATA: home, ARCADE_NO_CLIPBOARD: '1', ARCADE_NO_BROWSER: '1', ARCADE_WEB_PORT: '0', ARCADE_WEB_IDLE_MIN: '0' };

const readJSON = (f) => JSON.parse(fs.readFileSync(path.join(ARCADE, f), 'utf8'));
let child, port, token;

function request(method, p, { body, headers = {}, raw } = {}) {
  return new Promise((resolve, reject) => {
    const data = raw !== undefined ? raw : body !== undefined ? JSON.stringify(body) : null;
    const req = http.request({ host: '127.0.0.1', port, method, path: p, headers: { ...(data !== null ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data) } : {}), ...headers } }, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => {
        const text = Buffer.concat(chunks).toString('utf8');
        let json = null;
        try { json = JSON.parse(text); } catch {}
        resolve({ status: res.statusCode, headers: res.headers, text, json });
      });
    });
    req.on('error', reject);
    if (data !== null) req.write(data);
    req.end();
  });
}
const api = (p) => `${p}${p.includes('?') ? '&' : '?'}t=${token}`;
const action = (body) => request('POST', api('/api/action'), { body });

// Collect SSE events until `until(events)` is true (or time runs out).
function stream(until, ms = 8000) {
  return new Promise((resolve, reject) => {
    const events = [];
    let buf = '';
    const req = http.get({ host: '127.0.0.1', port, path: api('/api/stream') }, (res) => {
      assert.match(res.headers['content-type'], /text\/event-stream/);
      res.setEncoding('utf8');
      res.on('data', (c) => {
        buf += c;
        let i;
        while ((i = buf.indexOf('\n\n')) >= 0) {
          const block = buf.slice(0, i); buf = buf.slice(i + 2);
          const ev = (block.match(/^event: (.*)$/m) || [])[1];
          const data = (block.match(/^data: (.*)$/m) || [])[1];
          if (ev && data) events.push({ event: ev, data: JSON.parse(data) });
        }
        if (until(events)) { clearTimeout(timer); req.destroy(); resolve(events); }
      });
    });
    const timer = setTimeout(() => { req.destroy(); reject(new Error(`stream timed out after ${events.length} events`)); }, ms);
    req.on('error', (e) => { if (!req.destroyed) reject(e); });
  });
}

test.before(async () => {
  fs.mkdirSync(ARCADE, { recursive: true });
  // One knight hero with banked gold and some XP.
  fs.writeFileSync(path.join(ARCADE, 'config.json'), JSON.stringify({ theme: 'rpg', character: { name: 'Webby', cls: 'knight', primary: 'charcoal', secondary: 'crimson', skin: 'light', hair: 'brown', accessory: 'cape' } }));
  fs.writeFileSync(path.join(ARCADE, 'state.json'), JSON.stringify({ xp: 250, quests: 3, tools: {}, achievements: [], sessions: {}, streak: { day: null, count: 0 }, game: { gold: 1000, kills: 42, bosses: 1, inventory: [] } }));
  child = spawn(process.execPath, [SERVER], { env, stdio: ['ignore', 'pipe', 'pipe', 'ipc'] });
  let out = '';
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`server did not start: ${out}`)), 15000);
    child.stdout.on('data', (c) => {
      out += c;
      const m = out.match(/http:\/\/127\.0\.0\.1:(\d+)\/\?t=([0-9a-f]+)/);
      if (m) { port = Number(m[1]); token = m[2]; clearTimeout(timer); resolve(); }
    });
    child.stderr.on('data', (c) => { out += c; });
    child.on('exit', (code) => reject(new Error(`server exited (${code}): ${out}`)));
  });
});

test.after(async () => {
  if (child && child.exitCode === null) {
    const exited = new Promise((r) => child.once('exit', r));
    child.send({ type: 'shutdown' });
    await Promise.race([exited, new Promise((r) => setTimeout(r, 5000))]);
    if (child.exitCode === null) child.kill();
  }
  try { fs.rmSync(home, { recursive: true, force: true }); } catch {}
});

test('it owns the battle: web.lock and a fresh heartbeat', () => {
  const lock = readJSON('web.lock');
  assert.strictEqual(lock.port, port);
  assert.strictEqual(lock.pid, child.pid);
  assert.match(lock.url, new RegExp(`^http://127\\.0\\.0\\.1:${port}/\\?t=${token}$`));
  const beat = Number(fs.readFileSync(path.join(ARCADE, 'game.alive'), 'utf8'));
  assert.ok(Date.now() - beat < 3000);
});

test('api requests without the right token get a 403', async () => {
  for (const p of ['/api/snapshot', '/api/assets', '/api/stream', '/api/snapshot?t=nope']) {
    assert.strictEqual((await request('GET', p)).status, 403, p);
  }
  assert.strictEqual((await request('POST', '/api/action', { body: { type: 'wave' } })).status, 403);
  // The header works as well as the query string.
  assert.strictEqual((await request('GET', '/api/snapshot', { headers: { 'X-Arcade-Token': token } })).status, 200);
  // Requests for another host name (DNS rebinding) are refused.
  assert.strictEqual((await request('GET', api('/api/snapshot'), { headers: { Host: `evil.example:${port}` } })).status, 403);
  // No CORS headers are ever sent.
  const r = await request('GET', api('/api/snapshot'), { headers: { Origin: 'https://evil.example' } });
  assert.strictEqual(r.headers['access-control-allow-origin'], undefined);
});

test('assets carry the sprite and art data', async () => {
  const r = await request('GET', api('/api/assets'));
  assert.strictEqual(r.status, 200);
  const a = r.json;
  assert.ok(Array.isArray(a.hero.BODY) && a.hero.BODY.every((row) => typeof row === 'string'));
  for (const k of ['POSES', 'HEADS', 'ACCESSORY', 'CAPE', 'palettes', 'BASE']) assert.ok(a.hero[k], `hero.${k}`);
  assert.ok(a.hero.ACCESSORY.beard && a.hero.ACCESSORY.scarf);
  assert.ok(a.companions.rows.BODY.length && a.companions.classColors.knight);
  assert.ok(a.monsters.MONSTERS.slime.frames.length);
  assert.ok(a.monsters.MONSTER_COLORS && a.monsters.BOSS_POOLS);
  for (const k of ['FIRE', 'TORCH', 'CHEST', 'ANVIL', 'CRYSTAL', 'BIRD', 'BOOK']) assert.ok(a.props[k], `props.${k}`);
  assert.ok(a.items.CATALOG.length > 10 && a.items.RARITY && a.items.SLOTS && a.items.MATERIALS);
  assert.ok(a.classes.mage && a.kits.mage.length);
  assert.deepStrictEqual(Object.keys(a.themes).sort(), ['retro', 'rpg', 'space']);
  assert.ok(a.themes.rpg.accent);
  assert.deepStrictEqual(a.biomes, ['dungeon', 'forest', 'lava', 'castle']);
  // Cacheable: a matching ETag gets a 304.
  assert.ok(r.headers.etag);
  assert.strictEqual((await request('GET', api('/api/assets'), { headers: { 'If-None-Match': r.headers.etag } })).status, 304);
});

test('snapshot has the panel data', async () => {
  const r = await request('GET', api('/api/snapshot'));
  assert.strictEqual(r.status, 200);
  const s = r.json;
  for (const k of ['cfg', 'hero', 'heroes', 'lvl', 'title', 'stats', 'state', 'ses', 'sessions', 'events', 'achievements', 'bounties', 'skills', 'guild', 'shop', 'tabs']) assert.ok(k in s, k);
  assert.strictEqual(s.hero.name, 'Webby');
  assert.strictEqual(s.heroes.length, 1);
  assert.strictEqual(s.state.xp, 250);
  assert.strictEqual(s.battle.gold, 1000);
  assert.ok(s.achievements.every((a) => 'goal' in a && 'value' in a && 'done' in a));
  assert.ok(s.skills.tree.length === 3 && s.skills.tree[0].nodes[0].id === 'knight.0.0');
  assert.ok(s.shop.items.every((it) => 'owned' in it && 'equipped' in it && 'price' in it));
  assert.ok(s.bounties.daily.length && s.bounties.daily.every((b) => typeof b.id === 'string'));
  assert.deepStrictEqual(s.tabs.slice(0, 2), ['Adventure', 'Hero']);
});

test('the stream sends a snapshot and battle events', async () => {
  const events = await stream((ev) => ev.filter((e) => e.event === 'battle').length >= 2);
  assert.strictEqual(events[0].event, 'snapshot');
  const b = events.find((e) => e.event === 'battle').data;
  assert.strictEqual(b.W, 320);
  assert.strictEqual(b.H, 180);
  assert.ok(b.floorY > 0 && b.floorY < 180);
  assert.strictEqual(typeof b.hero.x, 'number');
  assert.ok(b.hero.pose);
  assert.strictEqual(b.hero.cls, 'knight');
  assert.ok(Array.isArray(b.monsters) && Array.isArray(b.particles) && b.particles.length <= 300);
  const ticks = events.filter((e) => e.event === 'battle').map((e) => e.data.tick);
  assert.ok(ticks[1] > ticks[0]);
});

test('a practice wave spawns monsters and never grants XP', async () => {
  const r = await action({ type: 'wave' });
  assert.strictEqual(r.status, 200);
  assert.strictEqual(r.json.ok, true);
  assert.ok(r.json.snapshot && r.json.snapshot.battle.practice);
  const events = await stream((ev) => ev.some((e) => e.event === 'battle' && e.data.monsters.length));
  const b = events.find((e) => e.event === 'battle' && e.data.monsters.length).data;
  assert.strictEqual(b.practice, true);
  assert.ok(b.monsters.every((m) => m.xp === 0 && m.name && m.max > 0));
  // A second wave waits until this one is cleared.
  assert.strictEqual((await action({ type: 'wave' })).json.ok, false);
  // Strike and cast go through; nothing moves XP.
  const m = b.monsters[0];
  assert.strictEqual((await action({ type: 'strike', x: m.x + 2, y: m.y + 2 })).json.ok, true);
  assert.strictEqual((await action({ type: 'cast', slot: 0 })).status, 200);
  assert.strictEqual(readJSON('state.json').xp, 250);
});

test('buying in the shop spends gold and saves the item', async () => {
  const snap = (await request('GET', api('/api/snapshot'))).json;
  const it = snap.shop.items.filter((x) => !x.loot && x.slot !== 'buff' && !x.owned).sort((a, b) => a.price - b.price)[0];
  const gold = snap.battle.gold;
  const r = await action({ type: 'buy', id: it.id });
  assert.strictEqual(r.json.ok, true, r.json.message);
  const after = r.json.snapshot.shop.items.find((x) => x.id === it.id);
  assert.ok(after.owned && after.equipped);
  assert.strictEqual(r.json.snapshot.battle.gold, gold - it.price);
  assert.ok(readJSON('state.json').game.inventory.includes(it.id));
  assert.strictEqual(readJSON('config.json').character.equipped[it.slot], it.id);
  // Buying it again is refused; XP never moves.
  assert.strictEqual((await action({ type: 'buy', id: it.id })).json.ok, false);
  assert.strictEqual(readJSON('state.json').xp, 250);
});

test('action input is validated', async () => {
  const cases = [
    [{ type: 'buy', id: 42 }, 400], [{ type: 'buy', id: 'no-such-item' }, 404], [{ type: 'cast', slot: 99 }, 400], [{ type: 'cast', slot: 1.5 }, 400],
    [{ type: 'strike', x: 'a', y: 1 }, 400], [{ type: 'theme', name: 'neon' }, 400], [{ type: 'hero', op: 'nuke' }, 400],
    [{ type: 'hero', op: 'create', look: { cls: 'mage', name: '<script>' } }, 400], [{ type: 'learn', node: 'mage.0.0' }, 400],
    [{ type: 'approval', id: '../../x', behavior: 'allow' }, 404], [{ type: 'guild', op: 'accept' }, 400], [{ type: 'bogus' }, 400], [[1, 2], 400],
  ];
  for (const [body, status] of cases) assert.strictEqual((await action(body)).status, status, JSON.stringify(body));
  assert.strictEqual((await request('POST', api('/api/action'), { raw: '{not json' })).status, 400);
  assert.strictEqual((await request('POST', api('/api/action'), { raw: JSON.stringify({ type: 'wave', pad: 'x'.repeat(64 * 1024) }) })).status, 413);
  assert.strictEqual((await request('GET', api('/api/action'))).status, 405);
});

test('static files never escape web/client', async () => {
  const probes = ['/client/../server.js', '/client/..%2f..%2fweb%2fserver.js', '/client/%2e%2e/server.js', '/client/..%5cserver.js',
    '/client/..%5c..%5cpackage.json', '/..%2fserver.js', '/client/%2e%2e%2fPROTOCOL.md', '/client/.%2e/PROTOCOL.md', '/server.js', '/client/%00'];
  for (const p of probes) {
    const r = await request('GET', p);
    assert.notStrictEqual(r.status, 200, p);
    assert.ok(!r.text.includes('Web view protocol') && !r.text.includes('use strict'), p);
  }
});

test('shutting down saves and releases the battle', async () => {
  const exited = new Promise((r) => child.once('exit', r));
  child.send({ type: 'shutdown' });
  const code = await exited;
  assert.strictEqual(code, 0);
  assert.ok(!fs.existsSync(path.join(ARCADE, 'web.lock')));
  assert.ok(!fs.existsSync(path.join(ARCADE, 'game.alive')));
  assert.strictEqual(readJSON('state.json').xp, 250);
});
