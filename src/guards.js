// Shared validation + SSRF helpers (pure functions, no Cloudflare-only APIs, so they are unit-testable in Node).

export const MAX_SCORE = 11150;           // 5000 damage + 2400 time + 750 upgrades + 1000 accuracy + 2000 victory
export const ROUND_MS = 60000;
export const MIN_TIME_MS = 12000;         // faster than this is not credible for a 100% destruction
export const CHAR_IDS = ['glitch', 'boom', 'nova', 'hole'];
const BAD_WORDS = ['fuck', 'shit', 'bitch', 'cunt', 'nigg', 'rape', 'nazi', 'porn', 'dick', 'pussy', 'slut', 'whore', 'asshole'];

export function checkNick(raw) {
  if (typeof raw !== 'string') return 'nick_invalid';
  const s = raw.normalize('NFKC').replace(/\s+/g, ' ').trim();
  const len = [...s].length;
  if (len < 3) return 'nick_short';
  if (len > 16) return 'nick_long';
  if (!/^[\p{L}\p{N}\p{M}_\- ]+$/u.test(s)) return 'nick_chars';
  const map = { '0': 'o', '1': 'i', '3': 'e', '4': 'a', '5': 's', '$': 's', '@': 'a', '!': 'i' };
  const low = s.toLowerCase().replace(/[01345$@!]/g, m => map[m]).replace(/[\s_\-]/g, '');
  if (BAD_WORDS.some(w => low.includes(w))) return 'nick_rude';
  return null;
}
export const cleanNick = raw => raw.normalize('NFKC').replace(/\s+/g, ' ').trim();

function isIPv4(h) { return /^\d{1,3}(\.\d{1,3}){3}$/.test(h) && h.split('.').every(n => +n <= 255); }
export function isPrivateIp(ip) {
  ip = String(ip).toLowerCase();
  if (isIPv4(ip)) {
    const [a, b] = ip.split('.').map(Number);
    return a === 0 || a === 10 || a === 127 || a >= 224 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127) || (a === 192 && b === 0) || (a === 198 && (b === 18 || b === 19));
  }
  if (ip.includes(':')) {
    if (ip === '::' || ip === '::1') return true;
    if (ip.startsWith('::ffff:')) { const rest = ip.slice(7); return isIPv4(rest) ? isPrivateIp(rest) : true; }
    return /^(fc|fd|fe[89ab])/.test(ip) || ip.startsWith('ff') || ip.startsWith('64:ff9b');
  }
  return true;
}
export function isLiteralHostBlocked(host) {
  const h = String(host).replace(/^\[|\]$/g, '').toLowerCase();
  if (!h || h === 'localhost' || /\.(localhost|local|internal|lan|home|corp|invalid)$/.test(h)) return true;
  if (isIPv4(h) || h.includes(':')) return isPrivateIp(h);
  return !h.includes('.');
}
export function parseTarget(raw) {
  let u; try { u = new URL(String(raw || '').trim()); } catch { return { err: 'invalid_url' }; }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') return { err: 'bad_scheme' };
  if (u.username || u.password) return { err: 'credentials_not_allowed' };
  if (u.port && !['80', '443', '8080', '8443'].includes(u.port)) return { err: 'port_not_allowed' };
  if (u.href.length > 2000) return { err: 'too_long' };
  return { url: u };
}

// Resolve through DNS-over-HTTPS (Workers have no dns.lookup). Tests inject env.__resolve.
const dnsCache = new Map();
export async function resolveHost(env, host) {
  if (env.__resolve) return env.__resolve(host);
  const hit = dnsCache.get(host); if (hit && Date.now() - hit.t < 60000) return hit.ips;
  const ips = [];
  for (const type of ['A', 'AAAA']) {
    const r = await fetch(`https://cloudflare-dns.com/dns-query?name=${encodeURIComponent(host)}&type=${type}`, { headers: { accept: 'application/dns-json' } });
    if (!r.ok) throw new Error('dns_failed');
    const j = await r.json();
    for (const a of j.Answer || []) if (a.type === 1 || a.type === 28) ips.push(a.data);
  }
  dnsCache.set(host, { ips, t: Date.now() }); if (dnsCache.size > 500) dnsCache.clear();
  return ips;
}
// true only when the host is not a private/loopback/metadata address (every resolved address must be public).
export async function hostAllowed(env, host) {
  if (isLiteralHostBlocked(host)) return false;
  const h = String(host).replace(/^\[|\]$/g, '');
  if (isIPv4(h) || h.includes(':')) return !isPrivateIp(h);
  try { const ips = await resolveHost(env, h); return ips.length > 0 && ips.every(ip => !isPrivateIp(ip)); } catch { return false; }
}

// ---- crypto helpers ----
const enc = new TextEncoder();
export async function hmacHex(secret, msg) {
  const k = await crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const sig = await crypto.subtle.sign('HMAC', k, enc.encode(msg));
  return [...new Uint8Array(sig)].map(b => b.toString(16).padStart(2, '0')).join('');
}
export function safeEqual(a, b) { if (typeof a !== 'string' || typeof b !== 'string' || a.length !== b.length) return false; let d = 0; for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i); return d === 0; }
export const json = (code, obj, extra = {}) => new Response(JSON.stringify(obj), { status: code, headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', ...extra } });

// Rate limiting through D1 (per salted IP hash). Returns true when the caller is over the limit.
export async function overLimit(env, ip, bucket, max, windowMs) {
  const now = Date.now();
  const key = bucket + ':' + (await hmacHex(env.SCORE_SECRET || 'unset', 'ip|' + ip)).slice(0, 24);
  if (!env.DB) return false;
  await env.DB.prepare('DELETE FROM rate_events WHERE ts < ?').bind(now - 3600000).run();
  const row = await env.DB.prepare('SELECT COUNT(*) AS n FROM rate_events WHERE key = ? AND ts > ?').bind(key, now - windowMs).first();
  await env.DB.prepare('INSERT INTO rate_events (key, ts) VALUES (?, ?)').bind(key, now).run();
  return (row ? row.n : 0) >= max;
}
