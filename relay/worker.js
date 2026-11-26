// Quote relay for the stock checker: a Cloudflare Worker (free plan) that holds the Finnhub API key as a secret and
// hands the page a small, read-only quote answer. The key never reaches the page or this repository.
//
//   GET /quotes?s=AAPL,MSFT      up to 12 symbols
//   -> { source, fetchedAt, market: { isOpen, session, holiday, t } | null,
//        quotes: { AAPL: { c, d, dp, h, l, o, pc, t } }, missing: [symbols with no price] }
//
// Finnhub free plan: 60 calls a minute, US stocks only. Each symbol is one call, so answers are kept for 30 seconds
// inside the Worker, and at most 50 upstream calls a minute are made (older answers are returned instead, marked stale).
// The answer says what Finnhub said and when; the page decides how to label it.
const ALLOWED_ORIGINS = ['https://ayman-sketch97.github.io'];
const MAX_SYMBOLS = 12;
const TTL_MS = 30000;
const STALE_MS = 10 * 60000;
const MAX_UPSTREAM_PER_MIN = 50;
const SYMBOL = /^[A-Z]{1,5}([.-][A-Z]{1,2})?$/;

const cache = new Map(); // symbol -> { at, q }
let market = { at: 0, m: null };
let calls = [];

const num = (x) => (typeof x === 'number' && Number.isFinite(x) ? x : null);

function cors(req) {
  const o = req.headers.get('Origin');
  const h = { 'Access-Control-Allow-Methods': 'GET, OPTIONS', 'Access-Control-Max-Age': '86400', Vary: 'Origin' };
  if (o && ALLOWED_ORIGINS.includes(o)) h['Access-Control-Allow-Origin'] = o;
  return h;
}
const json = (req, body, status = 200, extra = {}) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', ...cors(req), ...extra } });

function budget() {
  const now = Date.now();
  calls = calls.filter((t) => now - t < 60000);
  return calls.length < MAX_UPSTREAM_PER_MIN;
}
async function finnhub(path, env) {
  if (!budget()) return null;
  calls.push(Date.now());
  const r = await fetch(`https://finnhub.io/api/v1${path}${path.includes('?') ? '&' : '?'}token=${env.FINNHUB_KEY}`, { signal: AbortSignal.timeout(8000) });
  if (!r.ok) return null;
  return r.json();
}

export default {
  async fetch(req, env) {
    if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors(req) });
    if (req.method !== 'GET') return json(req, { error: 'GET only' }, 405);
    const origin = req.headers.get('Origin');
    if (origin && !ALLOWED_ORIGINS.includes(origin)) return json(req, { error: 'origin not allowed' }, 403);
    const url = new URL(req.url);
    if (url.pathname !== '/quotes') return json(req, { error: 'not found' }, 404);
    if (!env.FINNHUB_KEY) return json(req, { error: 'relay is not configured' }, 503);
    const syms = [...new Set((url.searchParams.get('s') || '').toUpperCase().split(',').map((x) => x.trim()).filter(Boolean))];
    if (!syms.length || syms.length > MAX_SYMBOLS || syms.some((s) => !SYMBOL.test(s))) return json(req, { error: `1 to ${MAX_SYMBOLS} US tickers, comma separated` }, 400);

    const now = Date.now();
    const quotes = {};
    const missing = [];
    const stale = [];
    await Promise.all(
      syms.map(async (s) => {
        const hit = cache.get(s);
        if (hit && now - hit.at < TTL_MS) {
          quotes[s] = hit.q;
          return;
        }
        let q = null;
        try {
          const j = await finnhub(`/quote?symbol=${encodeURIComponent(s)}`, env);
          if (j && num(j.c) > 0 && num(j.t) > 0) q = { c: j.c, d: num(j.d), dp: num(j.dp), h: num(j.h), l: num(j.l), o: num(j.o), pc: num(j.pc), t: j.t };
        } catch {
          q = null;
        }
        if (q) {
          cache.set(s, { at: now, q });
          quotes[s] = q;
        } else if (hit && now - hit.at < STALE_MS) {
          quotes[s] = hit.q;
          stale.push(s);
        } else missing.push(s);
      })
    );
    if (now - market.at > TTL_MS) {
      try {
        const m = await finnhub('/stock/market-status?exchange=US', env);
        if (m && typeof m.isOpen === 'boolean') market = { at: now, m: { isOpen: m.isOpen, session: m.session || null, holiday: m.holiday || null, t: num(m.t) } };
      } catch {
        /* keep the last answer */
      }
    }
    const age = market.m && now - market.at < STALE_MS ? market.m : null;
    if (cache.size > 500) for (const k of [...cache.keys()].slice(0, 100)) cache.delete(k);
    return json(req, { source: 'Finnhub', fetchedAt: Math.floor(now / 1000), market: age, quotes, missing, stale });
  },
};
