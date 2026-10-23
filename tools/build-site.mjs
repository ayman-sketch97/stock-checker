// Builds the public website into site/: the page, one analysis file per company, the screener table, the
// track record (backtest and live signal log) and a search index.
// GitHub Actions runs this every weekday morning (US time), once the previous session's prices are final
// (.github/workflows/update-site.yml).
//
//   node tools/build-site.mjs                    every US-listed company worth $2B or more
//   node tools/build-site.mjs --only AAPL,MSFT   just these companies (for testing)
//   node tools/build-site.mjs --limit 40         only the 40 largest (for testing)
//   node tools/build-site.mjs --page-only        rebuild the page without fetching data
//   --log-file f.json   read the previous signal log from a file instead of the live site (testing)
//   --no-log            start the signal log empty (testing)
import fs from 'node:fs';
import path from 'node:path';

process.env.STOCKCHECKER_BATCH = '1'; // no caches, polite pacing and retries in lib/data.js
const { getTickerIndex, getSubmissions, getCompanyFacts, getNasdaqScreener, getNasdaqHistory, getEarningsCalendar, normalizeTicker, batchStats } =
  await import('../lib/data.js');
const { analyze } = await import('../lib/engine.js');
const { prepare, analyzeTechnical, techContextFrom, TECH_VERSION } = await import('../lib/technical.js');
const BT = await import('../lib/backtest.js');
const SG = await import('../lib/signals.js');

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const args = process.argv.slice(2);
const arg = (name, dflt) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : dflt;
};
const MIN_CAP = Number(arg('--min-cap', 2e9));
const LIMIT = Number(arg('--limit', 0));
const ONLY = (arg('--only', '') || '').split(',').map(normalizeTicker).filter(Boolean);
const CONCURRENCY = Number(arg('--concurrency', 10));
const OUT = path.resolve(root, arg('--out', 'site'));
const PAGE_ONLY = args.includes('--page-only');
const SITE_URL = (process.env.SITE_URL || 'https://ayman-sketch97.github.io/stock-checker/').replace(/\/?$/, '/');
const LOG_FILE = arg('--log-file', '');
const NO_LOG = args.includes('--no-log');
const BT_YEARS = 5;

// ---------------------------------------------------------------- the page
function buildPage() {
  fs.mkdirSync(OUT, { recursive: true });
  let html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
  const swaps = [
    ["const MODE = 'server'; /*BUILD:MODE*/", "const MODE = 'static';"],
    ['/*SAFE-AREA*/', ':root { padding-top: env(safe-area-inset-top, 0px); padding-bottom: env(safe-area-inset-bottom, 0px); }'],
    ['<head>', '<head>\n<meta name="robots" content="noindex, nofollow">'],
  ];
  for (const [a, b] of swaps) {
    if (!html.includes(a)) throw new Error('page template changed: missing ' + a);
    html = html.replace(a, b);
  }
  fs.writeFileSync(path.join(OUT, 'index.html'), html);
  for (const f of ['favicon.svg', 'manifest.json', 'apple-touch-icon.png', 'icon-192.png', 'icon-512.png']) {
    fs.copyFileSync(path.join(root, f), path.join(OUT, f));
  }
  // unlisted: ask search engines not to index anything
  fs.writeFileSync(path.join(OUT, 'robots.txt'), 'User-agent: *\nDisallow: /\n');
  fs.writeFileSync(path.join(OUT, '.nojekyll'), '');
  // the chart library is served from this site (no third-party CDN); installed by the workflow
  const lwc = path.join(root, 'node_modules/lightweight-charts/dist/lightweight-charts.standalone.production.js');
  if (fs.existsSync(lwc)) {
    fs.mkdirSync(path.join(OUT, 'vendor'), { recursive: true });
    fs.copyFileSync(lwc, path.join(OUT, 'vendor/lightweight-charts.js'));
  } else console.log('note: lightweight-charts not installed; the Technical tab chart will not load from this build');
}

// ---------------------------------------------------------------- helpers
async function pool(items, n, fn) {
  let i = 0;
  const workers = Array.from({ length: Math.min(n, items.length) }, async () => {
    while (i < items.length) {
      const idx = i++;
      await fn(items[idx], idx);
    }
  });
  await Promise.all(workers);
}
const fmtTime = (d) => d.toISOString().slice(0, 16).replace('T', ' ') + ' UTC';
const isNum = (x) => typeof x === 'number' && Number.isFinite(x);
const rd = (x, d = 2) => (isNum(x) ? Math.round(x * 10 ** d) / 10 ** d : null);
const metricOf = (res, key) => {
  for (const sec of Object.values(res.sections || {})) for (const m of sec) if (m.key === key) return isNum(m.value) ? m.value : null;
  return null;
};
// weekdays between two ISO dates (rough trading-day count: ignores holidays)
function weekdaysBetween(a, b) {
  let n = 0;
  const d = new Date(a + 'T00:00:00Z');
  const end = new Date(b + 'T00:00:00Z');
  while (d < end) {
    d.setUTCDate(d.getUTCDate() + 1);
    const w = d.getUTCDay();
    if (w !== 0 && w !== 6) n++;
  }
  return n;
}

async function previousLog() {
  if (NO_LOG) return SG.emptyLog();
  if (LOG_FILE) return SG.parseLog(JSON.parse(fs.readFileSync(LOG_FILE, 'utf8')));
  const url = `${SITE_URL}data/signals.json?t=${Date.now()}`;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const r = await fetch(url, { headers: { 'Cache-Control': 'no-cache' } });
      if (r.status === 404) return SG.emptyLog(); // first run
      if (!r.ok) throw new Error('status ' + r.status);
      return SG.parseLog(await r.json());
    } catch (e) {
      if (attempt === 2) throw new Error(`Could not read the live signal log (${e.message}); not publishing, so the log is not lost.`);
      await new Promise((res) => setTimeout(res, 5000));
    }
  }
}

// ---------------------------------------------------------------- main
buildPage();
if (PAGE_ONLY) {
  console.log('page written to', OUT);
  process.exit(0);
}

const started = new Date();
const dataDir = path.join(OUT, 'data');
fs.rmSync(dataDir, { recursive: true, force: true });
fs.mkdirSync(path.join(dataDir, 'tech'), { recursive: true });

const [{ byTicker }, screener, prevLog] = await Promise.all([getTickerIndex(), getNasdaqScreener(), previousLog()]);
// market gauge: S&P 500 ETF (used only to read the market's trend, never as a holding)
let M = null;
try {
  M = prepare((await getNasdaqHistory('SPY', 20000, 3, 'etf')).daily);
} catch (e) {
  console.log('SPY history unavailable:', e.message);
}
const regimeAt = BT.regimeFinder(M);
let earnings = { byTicker: new Map(), days: 0, failures: 0 };
try {
  earnings = await getEarningsCalendar(60);
  console.log(`earnings calendar: ${earnings.byTicker.size} companies over ${earnings.days} weekdays (${earnings.failures} days failed)`);
} catch (e) {
  console.log('earnings calendar unavailable:', e.message);
}

// only common shares: skip notes, preferred shares, warrants, rights and similar listings
// (their screener "market value" is the parent company's, and the analysis would be wrong)
const NOT_COMMON = /\bnotes?\b|debentures?|preferred|\bwarrants?\b|\brights?\b|tangible equity|units?,? each consisting|%/i;
const logByTicker = new Map();
for (const r of prevLog.records) {
  const t = r[0];
  if (!logByTicker.has(t)) logByTicker.set(t, []);
  logByTicker.get(t).push(r);
}
const tracked = new Set(
  prevLog.records.filter((r) => r[SG.LOG_FIELDS.indexOf('status')] !== 'closed').map((r) => r[0])
); // open trades are followed even if the company drops below the size cut-off
const seen = new Set();
let universe = [];
for (const r of screener) {
  const t = normalizeTicker(r.symbol);
  if (NOT_COMMON.test(r.name)) continue;
  if (seen.has(t) || !byTicker.has(t) || !(r.price > 0)) continue;
  const wanted = ONLY.length ? ONLY.includes(t) : r.marketCap >= MIN_CAP || tracked.has(t);
  if (!wanted) continue;
  seen.add(t);
  universe.push({ t, price: r.price, cap: r.marketCap, sector: r.sector, industry: r.industry, chg: r.pctChange });
}
universe.sort((a, b) => b.cap - a.cap);
if (LIMIT) universe = universe.slice(0, LIMIT);
console.log(`screener rows ${screener.length}; companies to analyze ${universe.length}`);

const items = [];
const screen = [];
const btStocks = [];
const btTrades = [];
const newLog = new Map();
const priceDates = {};
const failed = [];
const counts = {};
const breadth = { n: 0, above50: 0, above200: 0, highs: 0, lows: 0 };
const rsData = []; // per backtested stock: trading days (yyyymmdd) and closes, for relative strength on past dates
let lapsed = 0;
let done = 0;

// Daily history gives the dated closing price, the chart, the backtest and the past-valuation comparison. It gets
// a short timeout, and if Nasdaq keeps failing (e.g. it slows down automated requests) the run carries on without it.
let historyFailsInARow = 0;
let historyOff = false;
async function historyFor(t) {
  if (historyOff) return null;
  try {
    const h = await getNasdaqHistory(t, 10000, 1);
    historyFailsInARow = 0;
    return h;
  } catch {
    if (++historyFailsInARow >= 40 && !historyOff) {
      historyOff = true;
      console.log('Nasdaq price history keeps failing; continuing without charts and past-valuation comparisons.');
    }
    return null;
  }
}

async function one(u) {
  const rec = byTicker.get(u.t);
  const [submissions, facts, hist] = await Promise.all([getSubmissions(rec.cik), getCompanyFacts(rec.cik), historyFor(u.t)]);
  // use the latest daily close (dated) when we have it; the screener price can lag a session
  const lastBar = hist?.daily?.length ? hist.daily[hist.daily.length - 1] : null;
  const px = lastBar ? lastBar.c : u.price;
  if (lastBar) priceDates[lastBar.date] = (priceDates[lastBar.date] || 0) + 1;
  const price = {
    source: 'Nasdaq',
    price: px,
    currency: 'USD',
    priceTime: lastBar ? `close on ${lastBar.date}` : `${fmtTime(started)}, last sale`,
    high52: null,
    low52: null,
    marketCapRef: u.cap * (px / u.price),
    monthly: hist?.monthly || [],
    splits: [],
    splitsKnown: false,
  };
  const res = analyze({ ticker: u.t, cik: rec.cik, listing: rec, submissions, facts, price, fetchedAt: started.toISOString() });
  const earn = earnings.byTicker.get(u.t) || null;
  if (res.ok) res.nextEarnings = earn;
  fs.writeFileSync(path.join(dataDir, `${u.t}.json`), JSON.stringify(res));

  // everything that changes the run-wide totals is applied at the end, so a retry after an error cannot double-count
  let tech = null;
  let trades = [];
  let upd = null;
  const P = hist?.daily?.length ? prepare(hist.daily) : null;
  if (P) {
    tech = analyzeTechnical(P, techContextFrom(res));
    trades = BT.backtestStock(P, { years: BT_YEARS, regimeAt });
    tech.history = BT.stockHistory(trades);
    if (tech.ok) {
      if (earn) {
        const away = weekdaysBetween(tech.asOf, earn.date);
        tech.earnings = { ...earn, tradingDays: away, soon: away <= 10 };
      }
      tech.market = { regime: regimeAt(tech.asOf) };
    }
    fs.writeFileSync(path.join(dataDir, 'tech', `${u.t}.json`), JSON.stringify(tech));
    // live signal log for this stock
    const halalNow = res.ok && res.labels.shariah.status === 'pass';
    upd = SG.updateStock(logByTicker.get(u.t) || [], P, tech.ok && halalNow ? { setup: tech.setup, score: tech.score } : null, {
      ticker: u.t,
      verdict: res.ok ? res.verdict.code : null,
      shariah: res.ok ? res.labels.shariah.status : null,
      regime: tech.ok ? regimeAt(tech.asOf) : null,
    });
  }

  const code = res.ok ? res.verdict.code : 'NA:' + (res.reason || 'error');
  const item = [
    u.t,
    res.name || rec.name,
    res.ok ? res.verdict.code : '',
    res.ok ? res.labels.shariah.status : '',
    res.ok ? res.labels.quality.score : null,
    res.ok ? res.labels.valuation.label : '',
    Math.round(u.cap / 1e6),
    tech?.ok ? tech.setup.setup : '',
    tech?.ok ? tech.score : null,
  ];
  const ok = res.ok;
  const T = tech?.ok ? tech : null;
  const fair = ok ? res.fairValue?.base ?? null : null;
  const row = [
    u.t,
    res.name || rec.name,
    u.sector || '',
    u.industry || '',
    Math.round(u.cap / 1e6),
    rd(px),
    rd(u.chg, 4),
    ok ? res.verdict.code : '',
    ok ? res.labels.shariah.status : '',
    ok ? res.labels.quality.score : null,
    ok ? res.labels.health.score : null,
    ok ? res.labels.growth.score : null,
    ok ? res.labels.valuation.label : '',
    rd(fair),
    isNum(fair) && px > 0 ? rd(fair / px - 1, 3) : null,
    ok ? rd(res.pricePlan?.buyBelow ?? null) : null,
    ok ? rd(metricOf(res, 'pe'), 1) : null,
    ok ? rd(metricOf(res, 'pfcf'), 1) : null,
    ok ? rd(metricOf(res, 'roic'), 3) : null,
    ok ? rd(metricOf(res, 'rev_cagr'), 3) : null,
    ok ? rd(metricOf(res, 'fcf_margin'), 3) : null,
    ok && res.dividends?.pays ? rd(res.dividends.yield, 4) : ok ? 0 : null,
    T ? T.setup.setup : '',
    T ? T.setup.status : '',
    T ? T.score : null,
    T ? T.trend : '',
    T ? T.indicators.rsi : null,
    T ? T.perf.r1m : null,
    T ? T.perf.r3m : null,
    T ? T.perf.r6m : null,
    T ? T.perf.r12m : null,
    null, // relative strength percentile, filled in below
    T && T.levels.high52 ? rd(T.close / T.levels.high52 - 1, 3) : null,
    T ? T.indicators.atrPct : null,
    T ? T.setup.entry : null,
    T ? T.setup.stop : null,
    T ? T.setup.target1 : null,
    T ? T.setup.riskPct : null,
    earn ? earn.date : null,
    T?.history?.summary?.n || 0,
    T?.history?.summary?.n ? T.history.summary.avgR : null,
    ok && res.labels.shariah.status !== 'fail' ? rd(res.purification?.ratio ?? null, 4) : null,
    ok ? rd(res.pricePlan?.trimAbove ?? null) : null,
    T ? T.indicators.ema21 : null,
    // dividend safety: years paid in a row, share of free cash flow paid out (9 = free cash flow is negative), growth
    ok && res.dividends?.pays ? (res.dividends.yearsPaid ?? null) : null,
    ok && res.dividends?.pays ? (isNum(res.dividends.payoutFcf) ? rd(res.dividends.payoutFcf) : (metricOf(res, 'fcf_margin') ?? 1) <= 0 ? 9 : null) : null,
    ok && res.dividends?.pays ? rd(res.dividends.growth5y ?? null, 3) : null,
    // data quality: high, limited or insufficient (insufficient means the verdict is withheld)
    ok ? res.dataQuality?.level || null : null,
  ];
  counts[code] = (counts[code] || 0) + 1;
  items.push(item);
  screen.push(row);
  if (P) {
    const si = btStocks.length;
    btStocks.push([u.t, res.ok ? res.labels.shariah.status : '']);
    rsData[si] = { d: Int32Array.from(P.dates, (x) => Number(x.replace(/-/g, ''))), c: Float64Array.from(P.C) };
    for (const t of trades) if (!t.open) btTrades.push(BT.compactTrade(t, si));
    newLog.set(u.t, upd.records);
    lapsed += upd.lapsed;
  }
  if (tech?.ok) {
    breadth.n++;
    if (isNum(tech.indicators.sma50) && tech.close > tech.indicators.sma50) breadth.above50++;
    if (isNum(tech.indicators.sma200) && tech.close > tech.indicators.sma200) breadth.above200++;
    if (tech.close >= tech.levels.high52 * 0.98) breadth.highs++;
    if (tech.close <= tech.levels.low52 * 1.02) breadth.lows++;
  }
}
const SCREEN_FIELDS = [
  'ticker', 'name', 'sector', 'industry', 'capM', 'price', 'chg', 'verdict', 'shariah', 'quality', 'health', 'growth', 'valuation',
  'fair', 'upside', 'buyBelow', 'pe', 'pfcf', 'roic', 'revGrowth', 'fcfMargin', 'divYield', 'setup', 'status', 'techScore', 'trend',
  'rsi', 'r1m', 'r3m', 'r6m', 'r12m', 'rs', 'offHigh', 'atrPct', 'entry', 'stop', 't1', 'riskPct', 'earnings', 'btN', 'btAvgR', 'impure',
  'trimAbove', 'ema21', 'divYears', 'divFcf', 'divGrowth', 'dq',
];

async function attempt(list, n) {
  const again = [];
  await pool(list, n, async (u) => {
    try {
      await one(u);
    } catch (e) {
      again.push({ ...u, err: String((e && e.message) || e).slice(0, 120) });
    }
    done++;
    if (done % 100 === 0) {
      console.log(`${done} done, ${Math.round((Date.now() - started) / 1000)}s, failures so far ${again.length}, ${JSON.stringify(batchStats)}`);
    }
  });
  return again;
}

let retry = await attempt(universe, CONCURRENCY);
if (retry.length) {
  console.log(`retrying ${retry.length} that failed`);
  done -= retry.length;
  retry = await attempt(retry, 2);
}
failed.push(...retry);

items.sort((a, b) => b[6] - a[6]);
screen.sort((a, b) => b[4] - a[4]);
const priceDate = Object.entries(priceDates).sort((a, b) => b[1] - a[1])[0]?.[0] || null;

// ---- relative strength: rank of the weighted 3/6/12-month return (recent months count most), 1 to 99
{
  const F = Object.fromEntries(SCREEN_FIELDS.map((k, j) => [k, j]));
  const scored = screen
    .map((row) => ({ row, w: [row[F.r3m], row[F.r6m], row[F.r12m]].every(isNum) ? 0.4 * row[F.r3m] + 0.3 * row[F.r6m] + 0.3 * row[F.r12m] : null }))
    .filter((x) => isNum(x.w))
    .sort((a, b) => a.w - b.w);
  scored.forEach((x, k) => (x.row[F.rs] = Math.max(1, Math.min(99, Math.round(((k + 0.5) / scored.length) * 100)))));
}

// ---- relative strength on each backtest signal day (same formula, ranked across every stock that traded that day)
{
  const idxOf = (arr, v) => {
    let lo = 0;
    let hi = arr.length - 1;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      if (arr[mid] === v) return mid;
      if (arr[mid] < v) lo = mid + 1;
      else hi = mid - 1;
    }
    return -1;
  };
  const ranks = new Map();
  for (const t of btTrades) if (!ranks.has(t[2])) ranks.set(t[2], null);
  for (const day of ranks.keys()) {
    const vals = [];
    for (const s of rsData) {
      if (!s) continue;
      const j = idxOf(s.d, day);
      if (j >= 252) vals.push(BT.rsWeighted(s.c, j));
    }
    ranks.set(day, Float64Array.from(vals).sort());
  }
  for (const t of btTrades) {
    const s = rsData[t[0]];
    const j = s ? idxOf(s.d, t[2]) : -1;
    const sorted = ranks.get(t[2]);
    if (j < 252 || !sorted || sorted.length < 20) continue;
    const w = BT.rsWeighted(s.c, j);
    let lo = 0;
    let hi = sorted.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (sorted[mid] < w) lo = mid + 1;
      else hi = mid;
    }
    t[9] = Math.max(1, Math.min(99, Math.round(((lo + 0.5) / sorted.length) * 100)));
  }
}

// ---- market picture
const market = { asOf: priceDate, regime: null, spy: null, breadth: null };
if (M) {
  const j = M.n - 1;
  const ret = (k) => (j - k >= 0 ? rd(M.C[j] / M.C[j - k] - 1, 4) : null);
  market.regime = regimeAt(M.dates[j]);
  market.spy = { date: M.dates[j], close: rd(M.C[j]), sma50: rd(M.s50[j]), sma200: rd(M.s200[j]), r1m: ret(21), r3m: ret(63), r12m: ret(252) };
}
if (breadth.n) {
  market.breadth = {
    n: breadth.n,
    above50: rd(breadth.above50 / breadth.n, 3),
    above200: rd(breadth.above200 / breadth.n, 3),
    highs: breadth.highs,
    lows: breadth.lows,
  };
}

// ---- outputs
const index = {
  asOf: started.toISOString(),
  priceDate,
  minCap: MIN_CAP,
  count: items.length,
  fields: ['ticker', 'name', 'verdict', 'shariah', 'quality', 'valuation', 'marketCapMillions', 'techSetup', 'techScore'],
  items,
};
fs.writeFileSync(path.join(dataDir, 'index.json'), JSON.stringify(index));
fs.writeFileSync(path.join(dataDir, 'screen.json'), JSON.stringify({ asOf: started.toISOString(), priceDate, techVersion: TECH_VERSION, market, fields: SCREEN_FIELDS, rows: screen }));

// track record: site-wide backtest
{
  const all = btTrades.map(BT.expandTrade);
  const halal = all.filter((t) => btStocks[t.stock][1] === 'pass');
  // the filters the site suggests for swing signals: relative strength 70+ and a market that is not falling
  const strong = halal.filter((t) => t.rs >= 70 && t.regime !== 'down');
  const pack = (list, cost = BT.DEFAULT_COST) => ({
    overall: BT.summarize(list, cost),
    bySetup: BT.groupSummary(list, (t) => t.setup, BT.TRADED, cost),
    byRegime: BT.groupSummary(list, (t) => t.regime, BT.REGIMES, cost),
    byScore: BT.groupSummary(list, (t) => BT.scoreBucket(t.score), BT.SCORE_BUCKETS, cost),
    byRS: BT.groupSummary(list, (t) => BT.rsBucket(t.rs), BT.RS_BUCKETS, cost),
    byYear: BT.groupSummary(list, (t) => t.year, [...new Set(list.map((t) => t.year))].sort(), cost),
    histogram: BT.histogram(list, cost),
  });
  const COSTS = [BT.DEFAULT_COST, 0.005, 0.008];
  const firstSignal = btTrades.reduce((m, t) => Math.min(m, t[2]), 99999999);
  // benchmark: the same stocks bought on a random day and held as long, and the S&P 500 over each trade's days
  const mkt = M ? { d: Int32Array.from(M.dates, (x) => Number(x.replace(/-/g, ''))), c: Float64Array.from(M.C) } : null;
  const bench = (list) => BT.benchmarkTrades(list, rsData, mkt, firstSignal, 20211015);
  const summary = {
    version: BT.BT_VERSION,
    asOf: priceDate,
    years: BT_YEARS,
    from: String(firstSignal),
    cost: BT.DEFAULT_COST,
    stocks: btStocks.length,
    buckets: BT.R_BUCKETS.map((b) => b.label),
    all: pack(all),
    halal: pack(halal),
    strong: pack(strong),
    costs: COSTS,
    benchmark: { all: bench(all), halal: bench(halal), strong: bench(strong) },
    byCost: Object.fromEntries(COSTS.slice(1).map((c) => [String(c), { all: pack(all, c), halal: pack(halal, c), strong: pack(strong, c) }])),
  };
  fs.writeFileSync(path.join(dataDir, 'backtest-summary.json'), JSON.stringify(summary));
  fs.writeFileSync(
    path.join(dataDir, 'backtest.json'),
    JSON.stringify({ version: BT.BT_VERSION, asOf: priceDate, cost: BT.DEFAULT_COST, setups: BT.TRADED, regimes: BT.REGIMES, stocks: btStocks, fields: BT.COMPACT_FIELDS, trades: btTrades })
  );
  console.log(`backtest: ${all.length} trades over ${btStocks.length} stocks; all ${JSON.stringify(summary.all.overall)}`);
}

// track record: live signal log (stocks not processed this run keep their records unchanged)
{
  const log = { ...prevLog, records: [] };
  for (const [t, recs] of logByTicker) if (!newLog.has(t)) log.records.push(...recs);
  const SF = Object.fromEntries(SCREEN_FIELDS.map((k, j) => [k, j]));
  const rsNow = new Map(screen.map((row) => [row[SF.ticker], row[SF.rs]]));
  const L = Object.fromEntries(SG.LOG_FIELDS.map((k, j) => [k, j]));
  for (const recs of newLog.values()) {
    for (const r of recs) if (r[L.status] === 'pending' && r[L.rs] == null) r[L.rs] = rsNow.get(r[L.ticker]) ?? null;
    log.records.push(...recs);
  }
  log.lapsed = (prevLog.lapsed || 0) + lapsed;
  log.started = prevLog.started || priceDate;
  log.updated = priceDate;
  SG.trimLog(log, priceDate || started.toISOString().slice(0, 10));
  log.records.sort((a, b) => (a[1] < b[1] ? 1 : a[1] > b[1] ? -1 : a[0] < b[0] ? -1 : 1));
  fs.writeFileSync(path.join(dataDir, 'signals.json'), JSON.stringify(log));
  const st = SG.LOG_FIELDS.indexOf('status');
  const c = { pending: 0, open: 0, closed: 0 };
  for (const r of log.records) c[r[st]] = (c[r[st]] || 0) + 1;
  console.log(`signal log: ${JSON.stringify(c)}, lapsed so far ${log.lapsed}`);
}

const secs = Math.round((Date.now() - started) / 1000);
console.log(`analyzed ${items.length}, failed ${failed.length}, ${secs}s, ${JSON.stringify(batchStats)}`);
console.log('verdicts', JSON.stringify(counts));
console.log('market', JSON.stringify(market));
if (failed.length) console.log('failed:', failed.slice(0, 40).map((f) => `${f.t} (${f.err})`).join('; '));
// a run where most companies failed should not replace yesterday's site
if (!ONLY.length && items.length < universe.length * 0.8) {
  console.error('Too many failures; not publishing this run.');
  process.exit(1);
}
