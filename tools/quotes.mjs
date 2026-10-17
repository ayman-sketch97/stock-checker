// Intraday price snapshot for every company the site covers, from Nasdaq's quotes (20 per request).
// Run every 15 minutes during the session by .github/workflows/quotes.yml, which publishes the file on the "quotes" branch; the site reads it from raw.githubusercontent.com (CORS-enabled).
// Prices are Nasdaq's last sale, usually delayed a few minutes. Output: quotes.json in the current folder.
import fs from 'node:fs';

const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36';
const num = (s) => {
  const n = Number(String(s ?? '').replace(/[$,%\s]/g, ''));
  return Number.isFinite(n) ? n : null;
};
async function getJson(url, tries = 4) {
  let last;
  for (let i = 0; i < tries; i++) {
    try {
      const r = await fetch(url, { headers: { 'User-Agent': UA, Accept: 'application/json' }, signal: AbortSignal.timeout(30000) });
      if (r.ok) return await r.json();
      last = new Error('HTTP ' + r.status);
    } catch (e) {
      last = e;
    }
    await new Promise((res) => setTimeout(res, 3000 * (i + 1)));
  }
  throw last;
}

// the companies the site covers, from the published site's index
const SITE_URL = (process.env.SITE_URL || 'https://ayman-sketch97.github.io/stock-checker/').replace(/\/?$/, '/');
const idx = await getJson(SITE_URL + 'data/index.json?t=' + Date.now());
const ti = (idx?.fields || []).indexOf('ticker');
const tickers = ti >= 0 ? idx.items.map((r) => r[ti]).filter(Boolean) : [];
if (tickers.length < 500) throw new Error('site index has only ' + tickers.length + ' companies');
// Nasdaq's watchlist quote returns up to 20 symbols per request, with today's open and the last sale
const q = {};
const batches = [];
for (let i = 0; i < tickers.length; i += 20) batches.push(tickers.slice(i, i + 20));
let failed = 0;
async function runBatch(b) {
  const qs = b.map((t) => 'symbol=' + encodeURIComponent(t.toLowerCase().replace(/-/g, '.') + '|stocks')).join('&');
  try {
    const j = await getJson('https://api.nasdaq.com/api/quote/watchlist?' + qs, 3);
    for (const r of j?.data || []) {
      const t = String(r.symbol || '').toUpperCase().replace(/\./g, '-');
      const p = num(r.lastSalePrice);
      const prev = num(r.previousClosePrice);
      if (!t || !(p > 0)) continue;
      const chg = prev > 0 ? Math.round((p / prev - 1) * 10000) / 10000 : (num(r.percentageChange) ?? 0) / 100;
      const open = num(r.openingPrice);
      q[t] = [p, chg, open > 0 ? open : null];
    }
  } catch {
    failed++;
  }
}
let next = 0;
await Promise.all(Array.from({ length: 4 }, async () => {
  while (next < batches.length) {
    const b = batches[next++];
    await runBatch(b);
    await new Promise((res) => setTimeout(res, 250));
  }
}));
if (Object.keys(q).length < tickers.length * 0.6) throw new Error(`only ${Object.keys(q).length} quotes (${failed} batches failed)`);
// which session these prices belong to. Nasdaq's quote timestamps can lag, so: while the market is open it is
// today's date in New York; otherwise it is the date of SPY's latest daily bar.
let session = null;
let time = '';
let status = '';
const nyDate = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
time = new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' }).format(new Date()) + ' ET';
try {
  const mi = await getJson('https://api.nasdaq.com/api/market-info', 2);
  status = String(mi?.data?.marketIndicator || '');
} catch (e) {
  console.log('market status unavailable:', e.message);
}
const nyParts = Object.fromEntries(new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', weekday: 'short', hour: 'numeric', hourCycle: 'h23' }).formatToParts(new Date()).map((x) => [x.type, x.value]));
const weekday = !['Sat', 'Sun'].includes(nyParts.weekday);
if (/market open/i.test(status) || (weekday && Number(nyParts.hour) >= 16)) session = nyDate; // open, or today's close
else {
  try {
    const from = new Date(Date.now() - 12 * 86400000).toISOString().slice(0, 10);
    const h = await getJson(`https://api.nasdaq.com/api/quote/SPY/historical?assetclass=etf&fromdate=${from}&todate=${nyDate}&limit=10`, 2);
    const row = h?.data?.tradesTable?.rows?.[0];
    const m = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(String(row?.date || ''));
    if (m) session = `${m[3]}-${m[1]}-${m[2]}`;
  } catch (e) {
    console.log('SPY history unavailable:', e.message);
  }
}
if (!session) throw new Error('could not tell which session the prices belong to');
const out = { v: 1, asOf: new Date().toISOString(), session, time, status, n: Object.keys(q).length, q };
fs.writeFileSync('quotes.json', JSON.stringify(out));
console.log(`quotes: ${out.n} stocks, session ${session}, ${status}, ${time}`);
