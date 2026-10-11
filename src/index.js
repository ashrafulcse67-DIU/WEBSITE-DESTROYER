import { json } from './guards.js';
import { handleSnapshot } from './snapshot.js';
import { handleScrape } from './scrape.js';
import { handleRound, handleScore, handleLeaderboard } from './scores.js';

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    if (!url.pathname.startsWith('/api/')) return env.ASSETS ? env.ASSETS.fetch(request) : new Response('Not found', { status: 404 });

    // Same-origin only for browsers (blocks other sites from driving the API from a visitor's browser).
    const origin = request.headers.get('origin');
    if (request.method === 'POST' && origin && origin !== url.origin) return json(403, { error: 'bad_origin' });

    try {
      switch (url.pathname) {
        case '/api/health':
          return json(200, { ok: true, leaderboard: !!(env.DB && env.SCORE_SECRET && String(env.SCORE_SECRET).length >= 16), capture: !!env.BROWSER });
        case '/api/snapshot':    return request.method === 'GET'  ? await handleSnapshot(request, env, ctx) : json(405, { error: 'method_not_allowed' });
        case '/api/scrape':      return request.method === 'GET'  ? await handleScrape(request, env, ctx)  : json(405, { error: 'method_not_allowed' });
        case '/api/round':       return request.method === 'POST' ? await handleRound(request, env)          : json(405, { error: 'method_not_allowed' });
        case '/api/score':       return request.method === 'POST' ? await handleScore(request, env)          : json(405, { error: 'method_not_allowed' });
        case '/api/leaderboard': return request.method === 'GET'  ? await handleLeaderboard(env)             : json(405, { error: 'method_not_allowed' });
        default: return json(404, { error: 'not_found' });
      }
    } catch (e) {
      if (env.DEBUG_SNAPSHOT) console.error(e);
      return json(500, { error: 'server_error' });
    }
  }
};
