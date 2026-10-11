// Run with:  node --test "test/*.test.mjs"   (Node >= 22.5, uses the built-in node:sqlite to emulate Cloudflare D1)
import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import http from 'node:http';
import worker from '../src/index.js';
import { validateScoreBody } from '../src/scores.js';
import { checkNick, isPrivateIp, isLiteralHostBlocked } from '../src/guards.js';

// ---- minimal D1 emulation ----
function makeD1() {
  const db = new DatabaseSync(':memory:');
  db.exec(readFileSync(new URL('../migrations/0001_init.sql', import.meta.url), 'utf8'));
  return { prepare(sql) { let args = []; const s = { bind(...a) { args = a; return s; },
    async all() { return { results: db.prepare(sql).all(...args).map(r => ({ ...r })) }; },
    async first() { const r = db.prepare(sql).get(...args); return r ? { ...r } : null; },
    async run() { const r = db.prepare(sql).run(...args); return { meta: { last_row_id: Number(r.lastInsertRowid), changes: Number(r.changes) } }; } }; return s; }, raw: db };
}
const SECRET = 'test-secret-test-secret-1234567890';
const mkEnv = (extra = {}) => ({ DB: makeD1(), SCORE_SECRET: SECRET, SCORE_PER_10MIN: '50', ASSETS: { fetch: async () => new Response('asset') }, ...extra });
const call = (env, path, init = {}, ip = '1.1.1.1') => worker.fetch(new Request('https://game.test' + path, { ...init, headers: { 'cf-connecting-ip': ip, 'content-type': 'application/json', ...(init.headers || {}) } }), env, {});
const post = (env, path, body, ip, headers) => call(env, path, { method: 'POST', body: JSON.stringify(body), headers }, ip);
const uuid = () => crypto.randomUUID();
const breakdown = (timeMs, acc = 900) => { const b = { dmg: 5000, time: Math.floor((60000 - timeMs) / 1000) * 40, up: 750, acc, win: 2000 }; return { b, score: b.dmg + b.time + b.up + b.acc + b.win }; };

// plays a round at a faked clock so the wall-clock check passes
async function playRound(env, { pid = uuid(), name = 'SpaceDestroyer99', char = 'nova', timeMs = 40000, acc = 900, ip = '1.1.1.1' } = {}) {
  const tok = await (await post(env, '/api/round', { pid }, ip)).json();
  const real = Date.now; Date.now = () => real() + timeMs + 1000;
  try { const { b, score } = breakdown(timeMs, acc);
    const res = await post(env, '/api/score', { ...tok, pid, name, char, score, b, pct: 100, timeMs }, ip);
    return { res, tok, pid, body: await res.json() };
  } finally { Date.now = real; }
}

test('health reports what is configured', async () => {
  const r = await (await call(mkEnv(), '/api/health')).json();
  assert.deepEqual(r, { ok: true, leaderboard: true, capture: false });
  const r2 = await (await call({ ASSETS: { fetch: async () => new Response('') } }, '/api/health')).json();
  assert.equal(r2.leaderboard, false);
});
test('non-api paths go to static assets', async () => {
  assert.equal(await (await call(mkEnv(), '/index.html')).text(), 'asset');
});
test('valid round is stored and appears on the leaderboard', async () => {
  const env = mkEnv(); const { res, body } = await playRound(env);
  assert.equal(res.status, 200); assert.equal(body.status, 'saved'); assert.equal(body.rank, 1);
  const lb = await (await call(env, '/api/leaderboard')).json();
  assert.equal(lb.rows.length, 1); assert.equal(lb.rows[0].name, 'SpaceDestroyer99'); assert.ok(!('player_id' in lb.rows[0]) && !('pid' in lb.rows[0]));
});
test('replaying the same signed round is rejected (duplicate protection)', async () => {
  const env = mkEnv(); const pid = uuid(); const tok = await (await post(env, '/api/round', { pid })).json();
  const real = Date.now; Date.now = () => real() + 50000;
  try { const { b, score } = breakdown(40000); const body = { ...tok, pid, name: 'Player One', char: 'glitch', score, b, pct: 100, timeMs: 40000 };
    assert.equal((await post(env, '/api/score', body)).status, 200);
    assert.equal((await post(env, '/api/score', body)).status, 409);
  } finally { Date.now = real; }
});
test('tampering is rejected', async () => {
  const env = mkEnv(); const pid = uuid(); const tok = await (await post(env, '/api/round', { pid })).json();
  const real = Date.now; Date.now = () => real() + 50000;
  try { const { b, score } = breakdown(40000); const base = { ...tok, pid, name: 'Player One', char: 'glitch', score, b, pct: 100, timeMs: 40000 };
    assert.equal((await post(env, '/api/score', { ...base, score: score + 1 })).status, 400);                    // score != breakdown
    assert.equal((await post(env, '/api/score', { ...base, b: { ...b, up: 500 }, score: score - 250 })).status, 400);
    assert.equal((await post(env, '/api/score', { ...base, pid: uuid() })).status, 401);                          // token bound to another player
    assert.equal((await post(env, '/api/score', { ...base, sig: 'a'.repeat(64) })).status, 401);
    assert.equal((await post(env, '/api/score', { ...base, name: 'fuck123' })).status, 400);
    assert.equal((await post(env, '/api/score', { ...base, pct: 80 })).status, 400);
    assert.equal((await post(env, '/api/score', { ...base, char: 'hacker' })).status, 400);
    assert.equal((await call(env, '/api/leaderboard').then(r => r.json())).rows.length, 0);
  } finally { Date.now = real; }
});
test('a result faster than real elapsed time is rejected', async () => {
  const env = mkEnv(); const pid = uuid(); const tok = await (await post(env, '/api/round', { pid })).json();
  const { b, score } = breakdown(40000);      // claims 40 s of play, but the token is only milliseconds old
  const r = await post(env, '/api/score', { ...tok, pid, name: 'Speedy', char: 'nova', score, b, pct: 100, timeMs: 40000 });
  assert.equal(r.status, 400); assert.equal((await r.json()).error, 'too_fast_for_wall_clock');
});
test('implausibly fast completion is rejected', () => {
  const { b, score } = breakdown(5000);
  assert.equal(validateScoreBody({ rid: uuid(), ts: Date.now() - 20000, sig: 'x', pid: uuid(), name: 'Speedy', char: 'nova', score, b, pct: 100, timeMs: 5000 }, Date.now()), 'bad_time');
});
test('ranking: score desc, then faster time, then earlier; one best entry per player; top 10 only', async () => {
  const env = mkEnv(); const A = uuid(), B = uuid();
  await playRound(env, { pid: A, name: 'Alpha', timeMs: 40000, acc: 900 });
  await playRound(env, { pid: A, name: 'Alpha', timeMs: 30000, acc: 900 });          // better run by the same player replaces Alpha's slot
  await playRound(env, { pid: B, name: 'Bravo', timeMs: 30000, acc: 900 });          // exact tie with Alpha's best -> earlier submission first
  for (let i = 0; i < 12; i++) await playRound(env, { name: 'Filler' + i, timeMs: 55000, acc: 100 });
  const rows = (await (await call(env, '/api/leaderboard')).json()).rows;
  assert.equal(rows.length, 10);
  assert.deepEqual(rows.slice(0, 2).map(r => r.name), ['Alpha', 'Bravo']);
  assert.equal(rows.filter(r => r.name === 'Alpha').length, 1);
  for (let i = 1; i < rows.length; i++) assert.ok(rows[i - 1].score > rows[i].score || (rows[i - 1].score === rows[i].score && rows[i - 1].timeMs <= rows[i].timeMs));
  const worse = await playRound(env, { pid: A, name: 'Alpha', timeMs: 50000, acc: 300 });
  assert.equal(worse.body.status, 'not_best');
});
test('rate limiting returns 429', async () => {
  const env = mkEnv({ SCORE_PER_10MIN: '2' }); const ip = '9.9.9.9'; const out = [];
  for (let i = 0; i < 4; i++) out.push((await playRound(env, { name: 'Rate' + i, ip })).res.status);
  assert.deepEqual(out.slice(0, 2), [200, 200]); assert.ok(out.includes(429));
});
test('cross-origin POST is blocked, unsupported methods are 405, unknown routes 404', async () => {
  const env = mkEnv();
  assert.equal((await post(env, '/api/round', { pid: uuid() }, '1.1.1.1', { origin: 'https://evil.example' })).status, 403);
  assert.equal((await call(env, '/api/score')).status, 405);
  assert.equal((await call(env, '/api/leaderboard', { method: 'POST', body: '{}' })).status, 405);
  assert.equal((await call(env, '/api/nope')).status, 404);
});
test('no public edit/delete: the API exposes no such route', async () => {
  const env = mkEnv();
  for (const m of ['PUT', 'PATCH', 'DELETE']) for (const p of ['/api/score', '/api/leaderboard', '/api/results']) assert.ok([404, 405].includes((await call(env, p, { method: m })).status));
});
test('database constraints reject invalid rows even if the API were bypassed', () => {
  const { raw } = makeD1(); const ins = (...v) => raw.prepare('INSERT INTO game_results (round_id,player_id,display_name,character_id,score,elapsed_time_ms,destruction_percent,completed,created_at) VALUES (?,?,?,?,?,?,?,?,?)').run(...v);
  assert.throws(() => ins('r1', 'p', 'abc', 'glitch', 99999, 40000, 100, 1, 1));
  assert.throws(() => ins('r2', 'p', 'abc', 'cheater', 5000, 40000, 100, 1, 1));
  assert.throws(() => ins('r3', 'p', 'abc', 'glitch', 5000, 100, 100, 1, 1));
  assert.throws(() => ins('r4', 'p', 'abc', 'glitch', 5000, 40000, 50, 1, 1));
  ins('r5', 'p', 'abc', 'glitch', 5000, 40000, 100, 1, 1); assert.throws(() => ins('r5', 'p', 'abc', 'glitch', 5000, 40000, 100, 1, 1));
});
test('unit: nickname + private address helpers', () => {
  assert.equal(checkNick('ab'), 'nick_short'); assert.equal(checkNick('x'.repeat(17)), 'nick_long'); assert.equal(checkNick('a<b>c'), 'nick_chars'); assert.equal(checkNick('F.u.c.k'), 'nick_chars');
  assert.equal(checkNick('SpaceDestroyer99'), null); assert.equal(checkNick('আশরাফুল'), null);
  for (const ip of ['127.0.0.1', '10.1.2.3', '192.168.0.1', '172.16.5.5', '169.254.169.254', '100.64.0.1', '::1', 'fd00::1', '::ffff:127.0.0.1']) assert.ok(isPrivateIp(ip), ip);
  for (const ip of ['8.8.8.8', '93.184.216.34', '2606:4700::1111']) assert.ok(!isPrivateIp(ip), ip);
  for (const h of ['localhost', 'a.local', '10.0.0.1', '[::1]', 'intranet']) assert.ok(isLiteralHostBlocked(h), h);
});

// ---- snapshot endpoint ----
test('snapshot: SSRF and input guards', async () => {
  const env = mkEnv({ BROWSER: {}, __puppeteer: { launch: async () => { throw new Error('must not launch'); } }, __resolve: async h => h === 'internal.example.com' ? ['10.0.0.8'] : ['93.184.216.34', '10.0.0.9'].slice(0, h === 'mixed.example.com' ? 2 : 1) });
  const g = async (u, ip) => (await call(env, '/api/snapshot?url=' + encodeURIComponent(u), {}, ip));
  const cases = [['file:///etc/passwd', 400], ['javascript:alert(1)', 400], ['https://u:p@example.com', 400], ['http://example.com:22', 400], ['', 400],
    ['http://127.0.0.1/', 403], ['http://localhost/', 403], ['http://169.254.169.254/latest', 403], ['http://[::1]/', 403], ['http://internal.example.com/', 403], ['http://mixed.example.com/', 403]];
  let i = 0; for (const [u, code] of cases) assert.equal((await g(u, '7.7.7.' + i++)).status, code, u);
});
test('snapshot: not configured without a browser binding', async () => {
  assert.equal((await call(mkEnv(), '/api/snapshot?url=https%3A%2F%2Fexample.com')).status, 503);
});
test('snapshot: real capture through a headless browser (needs CHROMIUM_PATH, PUPPETEER_CORE_PATH, TEST_HOST)', { skip: !(process.env.CHROMIUM_PATH && process.env.PUPPETEER_CORE_PATH && process.env.TEST_HOST) }, async () => {
  const pp = createRequire(import.meta.url)(process.env.PUPPETEER_CORE_PATH);
  const srv = http.createServer((q, s) => { s.writeHead(200, { 'content-type': 'text/html' }); s.end('<body style="margin:0;background:#123"><h1 style="font-size:90px;color:#fff">REAL PAGE</h1><div id="cookie-banner" style="position:fixed;bottom:0;background:red;color:#fff;padding:60px">cookies</div></body>'); });
  await new Promise(r => srv.listen(8080, '127.0.0.1', r));
  try {
    const env = mkEnv({ BROWSER: {}, DEBUG_SNAPSHOT: process.env.DEBUG_SNAPSHOT, __resolve: async () => ['93.184.216.34'], __puppeteer: { launch: () => pp.launch({ executablePath: process.env.CHROMIUM_PATH, headless: true, args: ['--no-sandbox', '--disable-gpu'] }) } });
    const t0 = Date.now(); const res = await call(env, '/api/snapshot?url=' + encodeURIComponent(`http://${process.env.TEST_HOST}:8080/`));
    assert.equal(res.status, 200); assert.equal(res.headers.get('content-type'), 'image/jpeg');
    const buf = Buffer.from(await res.arrayBuffer()); assert.ok(buf.length > 2000 && buf[0] === 0xff && buf[1] === 0xd8, 'valid JPEG');
    console.log('      capture took', Date.now() - t0, 'ms,', buf.length, 'bytes');
  } finally { srv.close(); }
});
