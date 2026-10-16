// Data loading: SEC EDGAR (official filings) + Nasdaq/Yahoo/CNBC (price), with memory and disk caches.
// Everything here is network I/O; the analysis itself lives in engine.js and is pure.
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const SEC_UA =
  process.env.SEC_USER_AGENT ||
  'StockChecker/1.0 (personal fundamental-analysis tool; non-commercial)';
const BROWSER_UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36';

// Batch mode (the daily site build) fetches thousands of companies: no caches, polite pacing, retries.
const BATCH = process.env.STOCKCHECKER_BATCH === '1';
const nextSlot = new Map();
async function pace(key, gapMs) {
  if (!BATCH) return;
  const now = Date.now();
  const slot = Math.max(now, nextSlot.get(key) || 0);
  nextSlot.set(key, slot + gapMs);
  if (slot > now) await new Promise((r) => setTimeout(r, slot - now));
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
// counters the daily build prints, so slowdowns are visible in the log
export const batchStats = { secRetries: 0, secThrottled: 0, nasdaqRetries: 0 };
let secGap = 130; // ms between SEC requests; grows if the SEC asks us to slow down

const cache = new Map(); // key -> { t, v }
function cacheGet(key, maxAgeMs) {
  if (BATCH && key !== 'tickers') return undefined;
  const hit = cache.get(key);
  if (hit && Date.now() - hit.t < maxAgeMs) return hit.v;
  return undefined;
}
function cacheSet(key, v) {
  if (BATCH && key !== 'tickers') return v;
  cache.set(key, { t: Date.now(), v });
  if (cache.size > 60) {
    // drop oldest entries (simple LRU-ish trim)
    const keys = [...cache.entries()].sort((a, b) => a[1].t - b[1].t).slice(0, 15).map((e) => e[0]);
    keys.forEach((k) => cache.delete(k));
  }
  return v;
}

async function fetchWithTimeout(url, opts = {}, ms = 12000) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), ms);
  try {
    return await fetch(url, { ...opts, signal: ctrl.signal });
  } finally {
    clearTimeout(timer);
  }
}

// Disk cache for SEC responses (each command-line run is a fresh process; serverless /tmp survives warm starts)
const DISK_DIR = path.join(os.tmpdir(), 'stockchecker-cache');
const diskFile = (key) => path.join(DISK_DIR, createHash('sha1').update(key).digest('hex') + '.json');
function diskGet(key, maxAgeMs) {
  if (BATCH) return undefined;
  try {
    const f = diskFile(key);
    if (Date.now() - fs.statSync(f).mtimeMs > maxAgeMs) return undefined;
    return fs.readFileSync(f, 'utf8');
  } catch {
    return undefined;
  }
}
function diskSet(key, text) {
  if (BATCH) return;
  try {
    fs.mkdirSync(DISK_DIR, { recursive: true });
    fs.writeFileSync(diskFile(key), text);
    if (Math.random() < 0.05) {
      for (const f of fs.readdirSync(DISK_DIR)) {
        const full = path.join(DISK_DIR, f);
        if (Date.now() - fs.statSync(full).mtimeMs > 24 * 3600 * 1000) fs.unlinkSync(full);
      }
    }
  } catch {
    /* disk cache is optional */
  }
}

async function secJson(url, ms = 15000, ttlMs = 0) {
  if (ttlMs) {
    const cached = diskGet(url, ttlMs);
    if (cached) {
      try {
        return JSON.parse(cached);
      } catch {
        /* refetch */
      }
    }
  }
  let r;
  for (let attempt = 0; ; attempt++) {
    await pace('sec', secGap); // SEC allows 10 requests a second; stay well under
    try {
      r = await fetchWithTimeout(
        url,
        { headers: { 'User-Agent': SEC_UA, Accept: 'application/json', 'Accept-Encoding': 'gzip, deflate' } },
        ms
      );
    } catch (e) {
      if (BATCH && attempt < 3) { batchStats.secRetries++; await sleep(1500 * (attempt + 1)); continue; }
      throw e;
    }
    // 403/429 from data.sec.gov means "too many requests": back off, then continue more slowly
    if (BATCH && (r.status === 403 || r.status === 429) && attempt < 4) {
      batchStats.secThrottled++;
      secGap = Math.min(Math.round(secGap * 1.5), 600);
      await sleep(30000 * (attempt + 1));
      continue;
    }
    if (BATCH && r.status >= 500 && attempt < 3) { batchStats.secRetries++; await sleep(3000 * (attempt + 1)); continue; }
    break;
  }
  if (r.status === 404) return null;
  if (!r.ok) throw new Error(`SEC request failed (${r.status}) for ${url}`);
  const text = await r.text();
  const j = JSON.parse(text);
  if (ttlMs) diskSet(url, text);
  return j;
}

// ---------- Ticker list ----------
export async function getTickerIndex() {
  const hit = cacheGet('tickers', 12 * 3600 * 1000);
  if (hit) return hit;
  const j = await secJson('https://www.sec.gov/files/company_tickers_exchange.json', 20000, 12 * 3600 * 1000);
  const fields = j.fields; // ["cik","name","ticker","exchange"]
  const iCik = fields.indexOf('cik');
  const iName = fields.indexOf('name');
  const iTicker = fields.indexOf('ticker');
  const iEx = fields.indexOf('exchange');
  const byTicker = new Map();
  const list = [];
  for (const row of j.data) {
    const rec = { cik: row[iCik], name: row[iName], ticker: String(row[iTicker]).toUpperCase(), exchange: row[iEx] };
    if (!byTicker.has(rec.ticker)) byTicker.set(rec.ticker, rec);
    list.push(rec);
  }
  return cacheSet('tickers', { byTicker, list });
}

export function normalizeTicker(raw) {
  return String(raw || '')
    .trim()
    .toUpperCase()
    .replace(/^\$/, '')
    .replace(/[.\/]/g, '-')
    .replace(/\s+/g, '');
}

export async function searchTickers(q, limit = 8) {
  const { list } = await getTickerIndex();
  const query = String(q || '').trim().toUpperCase();
  if (!query) return [];
  const exOk = (e) => e === 'NYSE' || e === 'Nasdaq' || e === 'CBOE' || e === 'NYSE American' || e === 'NYSE Arca';
  const scored = [];
  for (const r of list) {
    const name = String(r.name).toUpperCase();
    let s = 0;
    if (r.ticker === query) s = 100;
    else if (r.ticker.startsWith(query)) s = 70 - r.ticker.length;
    else if (name.startsWith(query)) s = 60;
    else if (name.includes(' ' + query) || name.includes(query)) s = 40;
    if (!s) continue;
    if (exOk(r.exchange)) s += 10;
    if (r.ticker.includes('-')) s -= 3; // preferreds/units/warrants rank lower
    scored.push([s, r]);
  }
  scored.sort((a, b) => b[0] - a[0]);
  const seen = new Set();
  const out = [];
  for (const [, r] of scored) {
    if (seen.has(r.cik + r.ticker)) continue;
    seen.add(r.cik + r.ticker);
    out.push({ ticker: r.ticker, name: r.name, exchange: r.exchange || '' });
    if (out.length >= limit) break;
  }
  return out;
}

// ---------- SEC company data ----------
const pad10 = (cik) => String(cik).padStart(10, '0');

export async function getSubmissions(cik) {
  const key = 'sub:' + cik;
  const hit = cacheGet(key, 6 * 3600 * 1000);
  if (hit) return hit;
  const j = await secJson(`https://data.sec.gov/submissions/CIK${pad10(cik)}.json`, 15000, 6 * 3600 * 1000);
  if (!j) return null;
  // keep only what we need (the full object is large)
  const recent = j.filings?.recent || {};
  const forms = recent.form || [];
  const slim = {
    name: j.name,
    sic: j.sic ? Number(j.sic) : null,
    sicDescription: j.sicDescription || '',
    fiscalYearEnd: j.fiscalYearEnd || '',
    tickers: j.tickers || [],
    exchanges: j.exchanges || [],
    category: j.category || '',
    entityType: j.entityType || '',
    recentForms: forms.slice(0, 200),
    latest10K: null,
    latest10Q: null,
  };
  for (let i = 0; i < forms.length; i++) {
    const f = forms[i];
    const rec = {
      form: f,
      filed: recent.filingDate?.[i],
      reportDate: recent.reportDate?.[i],
      accession: recent.accessionNumber?.[i],
      doc: recent.primaryDocument?.[i],
    };
    if (!slim.latest10K && (f === '10-K' || f === '20-F' || f === '40-F')) slim.latest10K = rec;
    if (!slim.latest10Q && f === '10-Q') slim.latest10Q = rec;
    if (slim.latest10K && slim.latest10Q) break;
  }
  return cacheSet(key, slim);
}

export async function getCompanyFacts(cik) {
  const key = 'facts:' + cik;
  const hit = cacheGet(key, 6 * 3600 * 1000);
  if (hit) return hit;
  const j = await secJson(`https://data.sec.gov/api/xbrl/companyfacts/CIK${pad10(cik)}.json`, 25000, 6 * 3600 * 1000);
  if (!j) return null;
  return cacheSet(key, j.facts || {});
}

// ---------- Prices (Nasdaq API first, then Yahoo chart API, then CNBC quote) ----------
function isoDate(unixSec) {
  return new Date(unixSec * 1000).toISOString().slice(0, 10);
}
const money = (s) => {
  const n = Number(String(s ?? '').replace(/[$,\s]/g, ''));
  return Number.isFinite(n) ? n : null;
};
const NASDAQ_HEADERS = {
  'User-Agent': BROWSER_UA,
  Accept: 'application/json, text/plain, */*',
  'Accept-Language': 'en-US,en;q=0.9',
  Origin: 'https://www.nasdaq.com',
  Referer: 'https://www.nasdaq.com/',
};

async function nasdaqJson(path, ms = 9000, maxAttempts = BATCH ? 3 : 1) {
  for (let attempt = 0; ; attempt++) {
    await pace('nasdaq', 200);
    try {
      const r = await fetchWithTimeout(`https://api.nasdaq.com/api/${path}`, { headers: NASDAQ_HEADERS }, ms);
      if (!r.ok) throw new Error('nasdaq ' + r.status);
      const j = await r.json();
      if (!j || !j.data) throw new Error('nasdaq empty');
      return j.data;
    } catch (e) {
      if (attempt + 1 < maxAttempts) { batchStats.nasdaqRetries++; await sleep(2000 * (attempt + 1)); continue; }
      throw e;
    }
  }
}
// Nasdaq's daily history table -> [{date, o, h, l, c, v}], oldest first (prices are split-adjusted)
function dailyFromRows(rows) {
  const out = [];
  for (const row of rows || []) {
    const m = String(row.date || '').match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
    const c = money(row.close);
    if (!m || !c) continue;
    const h = money(row.high);
    const l = money(row.low);
    const o = money(row.open);
    out.push({ date: `${m[3]}-${m[1]}-${m[2]}`, o: o || c, h: h || Math.max(c, o || c), l: l || Math.min(c, o || c), c, v: money(row.volume) || 0 });
  }
  return out.sort((a, b) => (a.date < b.date ? -1 : 1));
}
// Month-end closes (last trading day of each month)
function monthlyFromDaily(daily) {
  const byMonth = new Map();
  for (const d of daily) byMonth.set(d.date.slice(0, 7), { date: d.date, close: d.c });
  return [...byMonth.values()];
}
const historyPath = (sym) => {
  const today = new Date();
  const from = new Date(today.getTime() - 10 * 365.25 * 86400000).toISOString().slice(0, 10);
  const to = today.toISOString().slice(0, 10);
  return `quote/${sym}/historical?assetclass=stocks&fromdate=${from}&todate=${to}&limit=9999`;
};
// 10 years of daily candles plus month-end closes for one ticker (used by the daily site build)
export async function getNasdaqHistory(ticker, ms = 20000, maxAttempts = 3) {
  const sym = encodeURIComponent(ticker.replace(/-/g, '.'));
  const hist = await nasdaqJson(historyPath(sym), ms, maxAttempts);
  const daily = dailyFromRows(hist.tradesTable?.rows);
  return { daily, monthly: monthlyFromDaily(daily) };
}
// Every US-listed stock with its last price and market value, in one request (used by the daily site build)
export async function getNasdaqScreener() {
  const data = await nasdaqJson('screener/stocks?tableonly=true&download=true', 30000);
  return (data.rows || []).map((r) => ({
    symbol: String(r.symbol || '').trim(),
    name: String(r.name || '').trim(),
    price: money(r.lastsale),
    marketCap: money(r.marketCap),
    country: r.country || '',
    sector: r.sector || '',
  }));
}

async function getNasdaqPrice(ticker) {
  const sym = encodeURIComponent(ticker.replace(/-/g, '.'));
  const [info, summary, hist] = await Promise.allSettled([
    nasdaqJson(`quote/${sym}/info?assetclass=stocks`),
    nasdaqJson(`quote/${sym}/summary?assetclass=stocks`),
    nasdaqJson(historyPath(sym), 15000),
  ]);
  if (info.status !== 'fulfilled') return null;
  const pd = info.value.primaryData || {};
  const price = money(pd.lastSalePrice);
  if (!price) return null;
  let marketCapRef = null;
  let high52 = null;
  let low52 = null;
  if (summary.status === 'fulfilled') {
    const sd = summary.value.summaryData || {};
    marketCapRef = money(sd.MarketCap?.value);
    const hl = String(sd.FiftTwoWeekHighLow?.value || '').split('/');
    if (hl.length === 2) {
      high52 = money(hl[0]);
      low52 = money(hl[1]);
    }
  }
  const daily = hist.status === 'fulfilled' ? dailyFromRows(hist.value.tradesTable?.rows) : [];
  const monthly = monthlyFromDaily(daily);
  return {
    source: 'Nasdaq',
    price,
    currency: 'USD',
    priceTime: pd.lastTradeTimestamp || null,
    high52,
    low52,
    marketCapRef,
    monthly,
    daily,
    splits: [],
    splitsKnown: false,
  };
}

async function getCnbcPrice(ticker) {
  const sym = encodeURIComponent(ticker.replace(/-/g, '.'));
  const url = `https://quote.cnbc.com/quote-html-webservice/restQuote/symbolType/symbol?symbols=${sym}&requestMethod=itv&noform=1&partnerId=2&fund=1&exthrs=1&output=json`;
  const r = await fetchWithTimeout(url, { headers: { 'User-Agent': BROWSER_UA, Accept: 'application/json' } }, 8000);
  if (!r.ok) return null;
  const j = await r.json();
  const q = j?.FormattedQuoteResult?.FormattedQuote?.[0];
  const price = money(q?.last);
  if (!price) return null;
  return {
    source: 'CNBC',
    price,
    currency: 'USD',
    priceTime: q.last_time || null,
    high52: money(q.yrhiprice),
    low52: money(q.yrloprice),
    marketCapRef: null,
    monthly: [],
    splits: [],
    splitsKnown: false,
  };
}

export async function getPriceData(ticker) {
  const key = 'px:' + ticker;
  const hit = cacheGet(key, 15 * 60 * 1000);
  if (hit) return hit;
  try {
    const nq = await getNasdaqPrice(ticker);
    if (nq && nq.monthly.length > 24) return cacheSet(key, nq);
    if (nq) {
      // price is fine but history is missing: try to borrow history (and split data) from Yahoo
      const y = await getYahooPrice(ticker).catch(() => null);
      if (y && y.monthly.length > 24) return cacheSet(key, { ...nq, monthly: y.monthly, splits: y.splits, splitsKnown: y.splitsKnown });
      return cacheSet(key, nq);
    }
  } catch (e) {
    /* fall through */
  }
  const y = await getYahooPrice(ticker).catch(() => null);
  if (y) return cacheSet(key, y);
  const c = await getCnbcPrice(ticker).catch(() => null);
  if (c) return cacheSet(key, c);
  return null;
}

async function getYahooPrice(ticker) {
  const sym = encodeURIComponent(ticker);
  for (const host of ['query1', 'query2']) {
    try {
      const url = `https://${host}.finance.yahoo.com/v8/finance/chart/${sym}?range=10y&interval=1mo&events=split&includePrePost=false`;
      const r = await fetchWithTimeout(url, { headers: { 'User-Agent': BROWSER_UA, Accept: 'application/json' } }, 8000);
      if (!r.ok) continue;
      const j = await r.json();
      const res = j?.chart?.result?.[0];
      if (!res?.meta) continue;
      const meta = res.meta;
      const ts = res.timestamp || [];
      const closes = res.indicators?.quote?.[0]?.close || [];
      const monthly = [];
      for (let i = 0; i < ts.length; i++) {
        if (typeof closes[i] === 'number' && Number.isFinite(closes[i])) monthly.push({ date: isoDate(ts[i]), close: closes[i] });
      }
      const splits = Object.values(res.events?.splits || {})
        .map((s) => ({ date: isoDate(s.date), ratio: s.numerator && s.denominator ? s.numerator / s.denominator : null }))
        .filter((s) => s.ratio && Number.isFinite(s.ratio) && s.ratio > 0)
        .sort((a, b) => (a.date < b.date ? -1 : 1));
      const price = meta.regularMarketPrice ?? (monthly.length ? monthly[monthly.length - 1].close : null);
      if (!price) continue;
      return {
        source: 'Yahoo Finance',
        price,
        currency: meta.currency || 'USD',
        priceTime: meta.regularMarketTime ? new Date(meta.regularMarketTime * 1000).toISOString() : null,
        high52: meta.fiftyTwoWeekHigh ?? null,
        low52: meta.fiftyTwoWeekLow ?? null,
        marketCapRef: null,
        monthly,
        splits,
        splitsKnown: true,
      };
    } catch (e) {
      // try next host
    }
  }
  return null;
}

// ---------- One call that gathers everything the engine needs ----------
export async function loadCompanyData(rawTicker) {
  const ticker = normalizeTicker(rawTicker);
  if (!/^[A-Z0-9-]{1,12}$/.test(ticker)) {
    return { error: 'Please enter a valid US ticker symbol, for example AAPL or MSFT.', status: 400 };
  }
  const { byTicker } = await getTickerIndex();
  const rec = byTicker.get(ticker);
  if (!rec) {
    const suggestions = await searchTickers(rawTicker, 6);
    return {
      error: `"${ticker}" was not found among US-listed companies that file with the SEC.`,
      suggestions,
      status: 404,
    };
  }
  const [submissions, facts, price] = await Promise.all([
    getSubmissions(rec.cik),
    getCompanyFacts(rec.cik),
    getPriceData(ticker),
  ]);
  return { ticker, cik: rec.cik, listing: rec, submissions, facts, price, fetchedAt: new Date().toISOString() };
}
