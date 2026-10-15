// Builds the public website into site/: the page, one analysis file per company, and a search index.
// GitHub Actions runs this every weekday after the US market closes (.github/workflows/update-site.yml).
//
//   node tools/build-site.mjs                    every US-listed company worth $2B or more
//   node tools/build-site.mjs --only AAPL,MSFT   just these companies (for testing)
//   node tools/build-site.mjs --limit 40         only the 40 largest (for testing)
//   node tools/build-site.mjs --page-only        rebuild the page without fetching data
import fs from 'node:fs';
import path from 'node:path';

process.env.STOCKCHECKER_BATCH = '1'; // no caches, polite pacing and retries in lib/data.js
const { getTickerIndex, getSubmissions, getCompanyFacts, getNasdaqScreener, getNasdaqMonthly, normalizeTicker, batchStats } =
  await import('../lib/data.js');
const { analyze } = await import('../lib/engine.js');

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

// ---------------------------------------------------------------- main
buildPage();
if (PAGE_ONLY) {
  console.log('page written to', OUT);
  process.exit(0);
}

const started = new Date();
const dataDir = path.join(OUT, 'data');
fs.rmSync(dataDir, { recursive: true, force: true });
fs.mkdirSync(dataDir, { recursive: true });

const { byTicker } = await getTickerIndex();
const screener = await getNasdaqScreener();
// only common shares: skip notes, preferred shares, warrants, rights and similar listings
// (their screener "market value" is the parent company's, and the analysis would be wrong)
const NOT_COMMON = /\bnotes?\b|debentures?|preferred|\bwarrants?\b|\brights?\b|tangible equity|units?,? each consisting|%/i;
const seen = new Set();
let universe = [];
for (const r of screener) {
  const t = normalizeTicker(r.symbol);
  if (NOT_COMMON.test(r.name)) continue;
  if (seen.has(t) || !byTicker.has(t) || !(r.price > 0)) continue;
  if (ONLY.length ? !ONLY.includes(t) : !(r.marketCap >= MIN_CAP)) continue;
  seen.add(t);
  universe.push({ t, price: r.price, cap: r.marketCap });
}
universe.sort((a, b) => b.cap - a.cap);
if (LIMIT) universe = universe.slice(0, LIMIT);
console.log(`screener rows ${screener.length}; companies to analyze ${universe.length}`);

const priceTime = fmtTime(started);
const items = [];
const failed = [];
const counts = {};
let done = 0;

// Price history only feeds the "past valuation" comparison, so it gets a short timeout, and if Nasdaq
// keeps failing (e.g. it slows down automated requests) the run carries on without it.
let historyFailsInARow = 0;
let historyOff = false;
async function monthlyFor(t) {
  if (historyOff) return [];
  try {
    const m = await getNasdaqMonthly(t, 8000, 1);
    historyFailsInARow = 0;
    return m;
  } catch {
    if (++historyFailsInARow >= 40 && !historyOff) {
      historyOff = true;
      console.log('Nasdaq price history keeps failing; continuing without past-valuation comparisons.');
    }
    return [];
  }
}

async function one(u) {
  const rec = byTicker.get(u.t);
  const [submissions, facts, monthly] = await Promise.all([getSubmissions(rec.cik), getCompanyFacts(rec.cik), monthlyFor(u.t)]);
  const price = {
    source: 'Nasdaq',
    price: u.price,
    currency: 'USD',
    priceTime,
    high52: null,
    low52: null,
    marketCapRef: u.cap,
    monthly,
    splits: [],
    splitsKnown: false,
  };
  const res = analyze({ ticker: u.t, cik: rec.cik, listing: rec, submissions, facts, price, fetchedAt: started.toISOString() });
  fs.writeFileSync(path.join(dataDir, `${u.t}.json`), JSON.stringify(res));
  const code = res.ok ? res.verdict.code : 'NA:' + (res.reason || 'error');
  counts[code] = (counts[code] || 0) + 1;
  items.push([
    u.t,
    res.name || rec.name,
    res.ok ? res.verdict.code : '',
    res.ok ? res.labels.shariah.status : '',
    res.ok ? res.labels.quality.score : null,
    res.ok ? res.labels.valuation.label : '',
    Math.round(u.cap / 1e6),
  ]);
}

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
const index = {
  asOf: started.toISOString(),
  minCap: MIN_CAP,
  count: items.length,
  fields: ['ticker', 'name', 'verdict', 'shariah', 'quality', 'valuation', 'marketCapMillions'],
  items,
};
fs.writeFileSync(path.join(dataDir, 'index.json'), JSON.stringify(index));

const secs = Math.round((Date.now() - started) / 1000);
console.log(`analyzed ${items.length}, failed ${failed.length}, ${secs}s, ${JSON.stringify(batchStats)}`);
console.log('verdicts', JSON.stringify(counts));
if (failed.length) console.log('failed:', failed.slice(0, 40).map((f) => `${f.t} (${f.err})`).join('; '));
// a run where most companies failed should not replace yesterday's site
if (!ONLY.length && items.length < universe.length * 0.8) {
  console.error('Too many failures; not publishing this run.');
  process.exit(1);
}
