import { parseTarget, hostAllowed, isLiteralHostBlocked, json, overLimit } from './guards.js';

const VIEW_W = 1280, VIEW_H = 563;          // same aspect ratio as the in-game page area (900 x 396)
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36 WebsiteDestroyerBot/1.0';
const sleep = ms => new Promise(r => setTimeout(r, ms));
const withTimeout = (p, ms) => Promise.race([p, sleep(ms)]);
const memHits = new Map();

async function render(env, puppeteer, target, totalMs) {
  const browser = await puppeteer.launch(env.BROWSER);
  try {
    const page = await browser.newPage();
    await page.setUserAgent(UA);
    await page.setViewport({ width: VIEW_W, height: VIEW_H, deviceScaleFactor: 1 });
    await page.setExtraHTTPHeaders({ 'Accept-Language': 'en-US,en;q=0.9' });
    await page.setRequestInterception(true);
    page.on('dialog', d => d.dismiss().catch(() => {}));
    page.on('request', async req => {
      try {
        const u = new URL(req.url());
        if (u.protocol === 'data:' || u.protocol === 'blob:' || u.protocol === 'about:') return req.continue();
        if (u.protocol !== 'http:' && u.protocol !== 'https:') return req.abort('blockedbyclient');
        if (['media', 'websocket', 'eventsource', 'ping'].includes(req.resourceType())) return req.abort('blockedbyclient');
        // top-level navigations (incl. redirects) get the full DNS check; sub-requests the literal-host check
        const nav = req.isNavigationRequest() && req.frame() === page.mainFrame();
        const ok = nav ? await hostAllowed(env, u.hostname) : !isLiteralHostBlocked(u.hostname);
        return ok ? req.continue() : req.abort('blockedbyclient');
      } catch { try { req.abort(); } catch {} }
    });
    const resp = await page.goto(target.href, { waitUntil: 'domcontentloaded', timeout: Math.min(12000, totalMs - 6000) });
    if (!resp) throw new Error('no_response');
    await withTimeout(page.waitForNetworkIdle({ idleTime: 700, timeout: 5000 }).catch(() => {}), 5500);        // "running the page"
    await withTimeout(page.evaluate(async () => {                                                                // "waking up lazy content"
      const pause = ms => new Promise(r => setTimeout(r, ms));
      try { await document.fonts.ready; } catch {}
      const h = document.documentElement.scrollHeight;
      for (let y = 0; y < Math.min(h, 2400); y += 500) { window.scrollTo(0, y); await pause(110); }
      window.scrollTo(0, 0); await pause(250);
      for (const el of document.querySelectorAll('[id*="cookie" i],[class*="cookie" i],[id*="consent" i],[class*="consent" i]')) {
        const p = getComputedStyle(el).position; if (p === 'fixed' || p === 'sticky') el.style.setProperty('display', 'none', 'important');
      }
      await Promise.all([...document.images].filter(i => !i.complete).slice(0, 40).map(i => new Promise(r => { i.onload = i.onerror = r; setTimeout(r, 1800); })));
    }).catch(() => {}), 6000);                                                                                   // "loading fonts and images"
    return await page.screenshot({ type: 'jpeg', quality: 72, clip: { x: 0, y: 0, width: VIEW_W, height: VIEW_H } });
  } finally { try { await browser.close(); } catch {} }
}

// GET /api/snapshot?url=…  ->  image/jpeg of the page as a real browser renders it. Never returns the raw response body.
export async function handleSnapshot(request, env, ctx) {
  if (!env.BROWSER && !env.__puppeteer) return json(503, { error: 'capture_not_configured' });
  const reqUrl = new URL(request.url);
  const parsed = parseTarget(reqUrl.searchParams.get('url'));
  if (parsed.err) return json(400, { error: parsed.err });
  const ipAddr = request.headers.get('cf-connecting-ip') || 'anon';
  const max = Number(env.SNAP_PER_MIN || 6);
  let limited;
  if (env.DB) limited = await overLimit(env, ipAddr, 'snap', max, 60000);
  else { const now = Date.now(), a = (memHits.get(ipAddr) || []).filter(t => now - t < 60000); a.push(now); memHits.set(ipAddr, a); if (memHits.size > 500) memHits.clear(); limited = a.length > max; }
  if (limited) return json(429, { error: 'rate_limited' });
  if (!(await hostAllowed(env, parsed.url.hostname))) return json(403, { error: 'host_not_allowed' });

  const cacheKey = new Request('https://snapshot.cache/' + encodeURIComponent(parsed.url.href));
  try { if (typeof caches !== 'undefined' && caches.default) { const hit = await caches.default.match(cacheKey); if (hit) return hit; } } catch {}
  const totalMs = Number(env.TOTAL_MS || 22000);
  try {
    const puppeteer = env.__puppeteer || (await import('@cloudflare/puppeteer')).default;
    const img = await Promise.race([render(env, puppeteer, parsed.url, totalMs), sleep(totalMs).then(() => { throw new Error('timeout'); })]);
    const res = new Response(img, { status: 200, headers: { 'content-type': 'image/jpeg', 'cache-control': 'public, max-age=1800' } });
    try { if (typeof caches !== 'undefined' && caches.default && ctx && ctx.waitUntil) ctx.waitUntil(caches.default.put(cacheKey, res.clone())); } catch {}
    return res;
  } catch (e) {
    const msg = String((e && e.message) || e);
    if (env.DEBUG_SNAPSHOT) console.error('snapshot error', e);
    return json(msg === 'timeout' ? 504 : 502, { error: msg === 'timeout' ? 'timeout' : 'render_failed' });
  }
}
