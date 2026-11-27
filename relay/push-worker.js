// Phone notifications for the stock checker: a Cloudflare Worker (free plan) with one KV namespace bound as PUSH.
//
// What it holds: for each phone or laptop you switch notifications on for, the browser's push address and your ticker list
// (tickers and an "owned" flag only: no amounts, no prices you paid). It holds no keys of yours. It makes its own push signing
// key the first time it is asked and keeps it in the KV namespace.
// What it does: each Tuesday to Saturday morning (cron) it reads the PUBLIC site files (data/screen.json and data/health.json),
// compares them with what it saw last time, and if something changed it sends one empty push. The phone's service worker then
// asks /pending for the text and shows ONE notification. Nothing is bought or sold; the text says "information only".
//
//   GET  /vapid                      -> { publicKey }
//   POST /subscribe  { subscription, list: [{ t, held }], v }   -> { id }
//   POST /list       { id, list }    -> { ok }                   (the app re-sends the list when you change it)
//   POST /unsubscribe { id }         -> { ok }
//   GET  /pending?id=...             -> { title, body, at } of the last digest
//   POST /test       { id }          -> sends a test push now
//
// A change is reported once (edge-triggered); a price level has a 5% band so it does not flap; at most one notification a day.

const ALLOWED_ORIGINS = ['https://ayman-sketch97.github.io'];
const SITE = 'https://ayman-sketch97.github.io/stock-checker/';
const PUSH_HOSTS = [/^fcm\.googleapis\.com$/, /(^|\.)push\.apple\.com$/, /^updates\.push\.services\.mozilla\.com$/, /(^|\.)notify\.windows\.com$/, /^push\.services\.mozilla\.com$/];
const MAX_SUBS = 5;
const MAX_LIST = 200;
const TICKER = /^[A-Z0-9][A-Z0-9-]{0,14}$/;
const BAND = 1.05; // a "buy price" alert re-arms only after the price is 5% above it
const DROP = 10; // quality or health points lost before a holding is called weaker
const STALE_DAYS = 2; // trading days
const REMIND_MS = 3 * 24 * 3600 * 1000;
const MAX_LINES = 5;

const isNum = (x) => typeof x === 'number' && Number.isFinite(x);
const b64u = (buf) => btoa(String.fromCharCode(...new Uint8Array(buf))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const fromB64u = (s) => Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/')), (c) => c.charCodeAt(0));
const utf8 = (s) => new TextEncoder().encode(s);

// ---------------------------------------------------------------- the rules (pure: easy to test)
const SHARIAH_WORDS = { pass: 'passes the halal screen', review: 'needs a recheck', fail: 'fails the halal screen' };
const WEAK_VERDICTS = new Set(['AVOID_WEAK', 'SPECULATIVE']);
const BAD_FILING = (ev) => {
  const [, form = '', items = ''] = String(ev).split('|');
  if (/^15-?(12[BG]|15D)/i.test(form) || /^15$/.test(form)) return 'registration ended (form ' + form + ')';
  if (/^8-K/.test(form) && /(^|,)4\.02(,|$)/.test(items)) return 'earlier results may need correcting (8-K item 4.02)';
  if (/^8-K/.test(form) && /(^|,)4\.01(,|$)/.test(items)) return 'auditor changed (8-K item 4.01)';
  if (/^8-K/.test(form) && /(^|,)3\.01(,|$)/.test(items)) return 'listing notice (8-K item 3.01)';
  if (/^25-NSE/.test(form)) return 'exchange form 25-NSE filed (worth reading, not always a delisting)';
  return null;
};

export function weekdaysBetween(fromISO, toISO) {
  // whole weekdays after fromISO up to and including toISO
  let n = 0;
  const d = new Date(fromISO + 'T00:00:00Z');
  const end = new Date(toISO + 'T00:00:00Z');
  while (d < end) { d.setUTCDate(d.getUTCDate() + 1); const w = d.getUTCDay(); if (w !== 0 && w !== 6) n++; }
  return n;
}
function lastWeekday(nowMs) {
  const d = new Date(nowMs);
  do { d.setUTCDate(d.getUTCDate() - 1); } while (d.getUTCDay() === 0 || d.getUTCDay() === 6);
  return d.toISOString().slice(0, 10);
}

// list: [{ t, held }]; state: what was seen last time ({} the first time); screen: parsed screen.json; health: parsed health.json
// returns { lines: [text], state }. The first time a ticker is seen it only sets the baseline: nothing is announced.
export function evaluate(list, state, screen, health, nowMs) {
  const st = { tick: { ...(state && state.tick) }, staleAt: (state && state.staleAt) || 0, lastDate: (state && state.lastDate) || '' };
  const lines = [];
  const F = screen && Array.isArray(screen.fields) ? screen.fields : [];
  const ix = (k) => F.indexOf(k);
  const rows = new Map();
  if (F.length && Array.isArray(screen.rows)) for (const r of screen.rows) rows.set(r[ix('ticker')], r);
  const g = (r, k) => r[ix(k)];
  const fresh = screen && screen.priceDate && screen.priceDate !== st.lastDate;
  if (fresh) {
    for (const it of list) {
      const r = rows.get(it.t);
      if (!r) continue; // not in the site's list (small or foreign companies): nothing can be checked
      const prev = st.tick[it.t];
      const price = g(r, 'price'), buy = g(r, 'buyBelow'), sh = g(r, 'shariah') || '', q = g(r, 'quality'), hl = g(r, 'health'), vd = g(r, 'verdict') || '';
      const ev = Array.isArray(g(r, 'ev')) ? g(r, 'ev') : [];
      const judged = vd && vd !== 'NODATA' && vd !== 'UNRELIABLE';
      const inZone = judged && sh !== 'fail' && isNum(price) && isNum(buy) && price <= buy;
      const cur = { zone: !!inZone, sh, q: isNum(q) ? q : null, hl: isNum(hl) ? hl : null, vd, ev: ev.slice(0, 40), qRef: isNum(q) ? q : null, hRef: isNum(hl) ? hl : null };
      if (prev) {
        if (!prev.zone && inZone) lines.push(`${it.t}: $${price.toFixed(2)} is under its buy price of $${buy.toFixed(2)} (the checker's own estimate).`);
        cur.zone = inZone ? true : (isNum(price) && isNum(buy) && price > buy * BAND ? false : prev.zone);
        if (prev.sh && sh && prev.sh !== sh) lines.push(`${it.t}: halal status changed, it now ${SHARIAH_WORDS[sh] || 'has no result'}. Confirm on Zoya or Musaffa.`);
        if (it.held) {
          cur.qRef = Math.max(prev.qRef == null ? -1 : prev.qRef, cur.q == null ? -1 : cur.q); if (cur.qRef < 0) cur.qRef = null;
          cur.hRef = Math.max(prev.hRef == null ? -1 : prev.hRef, cur.hl == null ? -1 : cur.hl); if (cur.hRef < 0) cur.hRef = null;
          const dq = cur.qRef != null && cur.q != null ? cur.qRef - cur.q : 0;
          const dh = cur.hRef != null && cur.hl != null ? cur.hRef - cur.hl : 0;
          if (dq >= DROP) { lines.push(`${it.t}: business quality score fell from ${cur.qRef} to ${cur.q}.`); cur.qRef = cur.q; }
          if (dh >= DROP) { lines.push(`${it.t}: financial health score fell from ${cur.hRef} to ${cur.hl}.`); cur.hRef = cur.hl; }
          if (WEAK_VERDICTS.has(vd) && !WEAK_VERDICTS.has(prev.vd || '')) lines.push(`${it.t}: the checker now rates it "${vd === 'AVOID_WEAK' ? 'weak business' : 'speculative'}".`);
          const seen = new Set(prev.ev || []);
          for (const e of ev) if (!seen.has(e)) { const why = BAD_FILING(e); if (why) lines.push(`${it.t}: new filing, ${why}.`); }
        }
      }
      st.tick[it.t] = cur;
    }
    st.lastDate = screen.priceDate;
  }
  // old entries for tickers no longer on the list are dropped
  const keep = new Set(list.map((x) => x.t));
  for (const k of Object.keys(st.tick)) if (!keep.has(k)) delete st.tick[k];
  // stale data: once, then a reminder after three days
  const lag = health && health.priceDate ? weekdaysBetween(health.priceDate, lastWeekday(nowMs)) : 0;
  const bad = health && health.worst && !['ok', 'info'].includes(health.worst);
  if ((lag >= STALE_DAYS || bad) && nowMs - st.staleAt >= REMIND_MS) {
    lines.push(lag >= STALE_DAYS ? `The nightly data is ${lag} trading days old (last prices ${health.priceDate}). Advice is paused until the next update.` : 'The nightly data check reported a problem. Read the status note on the site before acting.');
    st.staleAt = nowMs;
  } else if (lag < STALE_DAYS && !bad) st.staleAt = 0;
  return { lines, state: st };
}

export function digest(lines) {
  const shown = lines.slice(0, MAX_LINES);
  const more = lines.length - shown.length;
  return {
    title: lines.length === 1 ? 'Stock Checker: 1 thing worth a look' : `Stock Checker: ${lines.length} things worth a look`,
    body: shown.join('\n') + (more > 0 ? `\n+${more} more in the Alert Centre.` : '') + '\nInformation only, not advice.',
  };
}

// ---------------------------------------------------------------- web push without a payload (only the signed header is needed)
async function vapidKeys(env) {
  let v = await env.PUSH.get('vapid', 'json');
  if (v) return v;
  const kp = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify']);
  v = { pub: b64u(await crypto.subtle.exportKey('raw', kp.publicKey)), jwk: await crypto.subtle.exportKey('jwk', kp.privateKey) };
  await env.PUSH.put('vapid', JSON.stringify(v));
  return v;
}
async function authHeader(v, endpoint) {
  const aud = new URL(endpoint).origin;
  const head = b64u(utf8(JSON.stringify({ typ: 'JWT', alg: 'ES256' })));
  const claims = b64u(utf8(JSON.stringify({ aud, exp: Math.floor(Date.now() / 1000) + 12 * 3600, sub: SITE })));
  const key = await crypto.subtle.importKey('jwk', v.jwk, { name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign']);
  const sig = await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, key, utf8(`${head}.${claims}`));
  return `vapid t=${head}.${claims}.${b64u(sig)}, k=${v.pub}`;
}
async function push(env, sub) {
  const v = await vapidKeys(env);
  const res = await fetch(sub.endpoint, { method: 'POST', headers: { Authorization: await authHeader(v, sub.endpoint), TTL: '43200', Urgency: 'normal' } });
  return res.status;
}

// ---------------------------------------------------------------- storage
async function sha(s) { return [...new Uint8Array(await crypto.subtle.digest('SHA-256', utf8(s)))].slice(0, 10).map((b) => b.toString(16).padStart(2, '0')).join(''); }
const getIds = async (env) => (await env.PUSH.get('ids', 'json')) || [];
const getSub = (env, id) => env.PUSH.get('sub:' + id, 'json');
const putSub = (env, id, o) => env.PUSH.put('sub:' + id, JSON.stringify(o));
async function dropSub(env, id) {
  await env.PUSH.delete('sub:' + id); await env.PUSH.delete('pending:' + id);
  await env.PUSH.put('ids', JSON.stringify((await getIds(env)).filter((x) => x !== id)));
}
function cleanList(list) {
  if (!Array.isArray(list)) return [];
  const out = []; const seen = new Set();
  for (const x of list.slice(0, MAX_LIST)) {
    const t = x && typeof x.t === 'string' ? x.t.trim().toUpperCase() : '';
    if (TICKER.test(t) && !seen.has(t)) { seen.add(t); out.push({ t, held: !!x.held }); }
  }
  return out;
}

// ---------------------------------------------------------------- http
function cors(req) {
  const o = req.headers.get('Origin');
  const h = { 'Access-Control-Allow-Methods': 'GET, POST, OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type', 'Access-Control-Max-Age': '86400', Vary: 'Origin' };
  if (o && ALLOWED_ORIGINS.includes(o)) h['Access-Control-Allow-Origin'] = o;
  return h;
}
const reply = (req, body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', ...cors(req) } });

async function fetchJson(url) {
  try { const r = await fetch(url, { cf: { cacheTtl: 0 } }); return r.ok ? await r.json() : null; } catch { return null; }
}

export async function run(env, nowMs = Date.now()) {
  const [screen, health] = await Promise.all([fetchJson(SITE + 'data/screen.json'), fetchJson(SITE + 'data/health.json')]);
  if (!screen && !health) return { skipped: 'site files unreachable' };
  let sent = 0;
  for (const id of await getIds(env)) {
    const o = await getSub(env, id);
    if (!o) continue;
    const r = evaluate(o.list || [], o.state || {}, screen, health, nowMs);
    o.state = r.state;
    if (r.lines.length) {
      const d = digest(r.lines);
      await env.PUSH.put('pending:' + id, JSON.stringify({ ...d, at: nowMs }));
      const code = await push(env, o.sub);
      if (code === 404 || code === 410) { await dropSub(env, id); continue; }
      sent++;
    }
    await putSub(env, id, o);
  }
  return { sent };
}

export default {
  async fetch(req, env) {
    if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors(req) });
    const url = new URL(req.url);
    const origin = req.headers.get('Origin');
    if (req.method === 'POST' && (!origin || !ALLOWED_ORIGINS.includes(origin))) return reply(req, { error: 'not allowed' }, 403);
    try {
      if (req.method === 'GET' && url.pathname === '/vapid') return reply(req, { publicKey: (await vapidKeys(env)).pub });
      if (req.method === 'GET' && url.pathname === '/pending') {
        const id = url.searchParams.get('id') || '';
        const p = /^[0-9a-f]{20}$/.test(id) ? await env.PUSH.get('pending:' + id, 'json') : null;
        return reply(req, p || { title: 'Stock Checker', body: 'Open the Alert Centre to read what changed. Information only, not advice.', at: 0 });
      }
      if (req.method === 'POST') {
        const body = await req.json().catch(() => ({}));
        if (url.pathname === '/subscribe') {
          const s = body.subscription;
          if (!s || typeof s.endpoint !== 'string' || !s.endpoint.startsWith('https://')) return reply(req, { error: 'bad subscription' }, 400);
          if (!PUSH_HOSTS.some((re) => re.test(new URL(s.endpoint).hostname))) return reply(req, { error: 'push service not allowed' }, 400);
          const id = await sha(s.endpoint);
          const ids = await getIds(env);
          if (!ids.includes(id)) {
            if (ids.length >= MAX_SUBS) return reply(req, { error: 'too many devices' }, 409);
            await env.PUSH.put('ids', JSON.stringify([...ids, id]));
          }
          const old = await getSub(env, id);
          await putSub(env, id, { sub: { endpoint: s.endpoint }, list: cleanList(body.list), state: (old && old.state) || {}, at: Date.now() });
          return reply(req, { id });
        }
        if (url.pathname === '/list' || url.pathname === '/unsubscribe' || url.pathname === '/test') {
          const id = String(body.id || '');
          const o = /^[0-9a-f]{20}$/.test(id) ? await getSub(env, id) : null;
          if (!o) return reply(req, { error: 'unknown device' }, 404);
          if (url.pathname === '/unsubscribe') { await dropSub(env, id); return reply(req, { ok: true }); }
          if (url.pathname === '/list') { o.list = cleanList(body.list); await putSub(env, id, o); return reply(req, { ok: true, count: o.list.length }); }
          await env.PUSH.put('pending:' + id, JSON.stringify({ title: 'Stock Checker: test', body: 'Phone notifications work. Real alerts arrive only when something changes. Information only.', at: Date.now() }));
          return reply(req, { ok: true, status: await push(env, o.sub) });
        }
      }
      return reply(req, { error: 'not found' }, 404);
    } catch (e) {
      return reply(req, { error: 'failed' }, 500);
    }
  },
  async scheduled(event, env, ctx) { ctx.waitUntil(run(env)); },
};
