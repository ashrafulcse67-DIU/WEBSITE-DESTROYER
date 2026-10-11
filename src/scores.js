import { MAX_SCORE, ROUND_MS, MIN_TIME_MS, CHAR_IDS, checkNick, cleanNick, hmacHex, safeEqual, json, overLimit } from './guards.js';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ip = req => req.headers.get('cf-connecting-ip') || req.headers.get('x-forwarded-for') || 'anon';
const configured = env => !!(env.DB && env.SCORE_SECRET && String(env.SCORE_SECRET).length >= 16);

// POST /api/round  { pid }  ->  signed round token (proves a real round started at server time `ts`)
export async function handleRound(request, env) {
  if (!configured(env)) return json(503, { error: 'leaderboard_not_configured' });
  let body; try { body = await request.json(); } catch { return json(400, { error: 'bad_json' }); }
  if (!body || typeof body.pid !== 'string' || !UUID.test(body.pid)) return json(400, { error: 'bad_pid' });
  if (await overLimit(env, ip(request), 'round', 40, 600000)) return json(429, { error: 'rate_limited' });
  const rid = crypto.randomUUID(), ts = Date.now();
  const sig = await hmacHex(env.SCORE_SECRET, `${rid}.${ts}.${body.pid.toLowerCase()}`);
  return json(200, { rid, ts, sig });
}

// Server-side checks. The score formula is public (see How to Play) so every component can be verified.
export function validateScoreBody(b, now) {
  if (!b || typeof b !== 'object') return 'bad_body';
  const int = v => Number.isInteger(v);
  if (typeof b.rid !== 'string' || !UUID.test(b.rid) || !int(b.ts) || typeof b.sig !== 'string' || typeof b.pid !== 'string' || !UUID.test(b.pid)) return 'bad_token_fields';
  if (!CHAR_IDS.includes(b.char)) return 'bad_char';
  const ne = typeof b.name === 'string' ? checkNick(b.name) : 'nick_invalid'; if (ne) return ne;
  if (!int(b.timeMs) || b.timeMs < MIN_TIME_MS || b.timeMs > ROUND_MS) return 'bad_time';
  if (b.pct !== 100) return 'not_completed';
  const x = b.b; if (!x || ![x.dmg, x.time, x.up, x.acc, x.win].every(int)) return 'bad_breakdown';
  if (x.dmg !== 5000 || x.win !== 2000 || x.up !== 750) return 'breakdown_mismatch';          // 100% implies every tier was unlocked
  if (x.acc < 0 || x.acc > 1000) return 'bad_accuracy';
  const expectedTime = Math.floor((ROUND_MS - b.timeMs) / 1000) * 40;
  if (Math.abs(x.time - expectedTime) > 40) return 'time_bonus_mismatch';
  if (!int(b.score) || b.score !== x.dmg + x.time + x.up + x.acc + x.win || b.score < 1 || b.score > MAX_SCORE) return 'score_mismatch';
  if (b.ts > now + 5000) return 'future_token';
  const wall = now - b.ts;
  if (wall > 45 * 60 * 1000) return 'token_expired';
  if (wall < b.timeMs - 2500) return 'too_fast_for_wall_clock';                              // game time can never exceed real elapsed time
  return null;
}

const RANKED = `
  SELECT id, player_id, display_name, character_id, score, elapsed_time_ms, destruction_percent, created_at FROM (
    SELECT *, ROW_NUMBER() OVER (PARTITION BY player_id ORDER BY score DESC, elapsed_time_ms ASC, id ASC) AS rn
    FROM game_results WHERE completed = 1 AND validation_status = 'ok'
  ) WHERE rn = 1 ORDER BY score DESC, elapsed_time_ms ASC, id ASC LIMIT 10`;

// POST /api/score
export async function handleScore(request, env) {
  if (!configured(env)) return json(503, { error: 'leaderboard_not_configured' });
  let b; try { b = await request.json(); } catch { return json(400, { error: 'bad_json' }); }
  const now = Date.now();
  const bad = validateScoreBody(b, now); if (bad) return json(400, { error: bad });
  const expected = await hmacHex(env.SCORE_SECRET, `${b.rid}.${b.ts}.${b.pid.toLowerCase()}`);
  if (!safeEqual(expected, b.sig)) return json(401, { error: 'bad_signature' });
  if (await overLimit(env, ip(request), 'score', Number(env.SCORE_PER_10MIN || 6), 600000)) return json(429, { error: 'rate_limited' });
  let id;
  try {
    const r = await env.DB.prepare('INSERT INTO game_results (round_id, player_id, display_name, character_id, score, elapsed_time_ms, destruction_percent, completed, validation_status, created_at) VALUES (?,?,?,?,?,?,?,?,?,?)')
      .bind(b.rid, b.pid.toLowerCase(), cleanNick(b.name), b.char, b.score, b.timeMs, 100, 1, 'ok', now).run();
    id = r.meta && r.meta.last_row_id;
  } catch (e) {
    if (/UNIQUE|constraint/i.test(String(e && e.message))) return json(409, { error: 'duplicate_round' });
    return json(500, { error: 'db_error' });
  }
  const best = await env.DB.prepare('SELECT id FROM game_results WHERE player_id = ? AND completed = 1 AND validation_status = ? ORDER BY score DESC, elapsed_time_ms ASC, id ASC LIMIT 1').bind(b.pid.toLowerCase(), 'ok').first();
  const top = (await env.DB.prepare(RANKED).all()).results || [];
  const idx = top.findIndex(r => r.player_id === b.pid.toLowerCase());
  return json(200, { ok: true, status: best && best.id === id ? 'saved' : 'not_best', rank: idx >= 0 ? idx + 1 : null });
}

// GET /api/leaderboard  -> only what the public top 10 needs (no player ids)
export async function handleLeaderboard(env) {
  if (!env.DB) return json(503, { error: 'leaderboard_not_configured' });
  const rows = ((await env.DB.prepare(RANKED).all()).results || []).map(r => ({ name: r.display_name, char: r.character_id, score: r.score, timeMs: r.elapsed_time_ms, pct: r.destruction_percent, at: r.created_at }));
  return json(200, { ok: true, rows, updated: Date.now() }, { 'cache-control': 'public, max-age=10' });
}
