// The Treasury-linked discount rate study (PREREGISTERED.md, section 8): the 10-year job (tools/lt-backtest.mjs) run on
// one shard of the same companies, with every month-end also valued under rule B and the six sensitivity rules, and the
// last month-end under the extreme yields. It writes only its own file; the live site and the backtest branch are
// untouched. Usage: node tools/rate-study.mjs --shard 0/4 --out out/shard-0.ndjson
// Long-term backtest, step 1: replays the fundamental analysis of every company on the site at each month-end of
// the past ten years, using only what had been filed by then (lib/longterm.js), and saves the results together with
// the month-end prices, one line per company. Step 2 (tools/lt-report.mjs) rebuilds the past shortlists from them
// and follows them forward against the S&P 500 and random picks.
//
//   node tools/lt-backtest.mjs                      every listed US company worth $250 million or more today
//                                                    (about 4,000; 1-2 hours), so that companies that were
//                                                    worth $2 billion in the past and have shrunk are included
//   node tools/lt-backtest.mjs --universe site        only the companies on the live site today ($2B+)
//   node tools/lt-backtest.mjs --sample 150 --seed 7   a fixed random sample (for testing)
//   node tools/lt-backtest.mjs --only AAPL,KO,DECK     just these
//   --out lt-data.ndjson (default)   --concurrency 4   --from 2016-12-01   --min-cap-now 250e6
// Resumable: companies already in the output file are skipped, so a stopped run can be started again.
import fs from 'node:fs';

process.env.STOCKCHECKER_BATCH = '1'; // no caches, polite pacing and retries in lib/data.js
const { getTickerIndex, getSubmissions, getCompanyFacts, getNasdaqHistory, getNasdaqScreener, normalizeTicker } = await import('../lib/data.js');
const { analyze } = await import('../lib/engine.js');
const LT = await import('../lib/longterm.js');
const RATES = await import('../lib/rates.js');

const args = process.argv.slice(2);
const arg = (name, dflt) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : dflt;
};
const OUT = arg('--out', 'rate-study.ndjson');
// --shard k/n: the companies whose place in the sorted list leaves k when divided by n (the study runs in n jobs)
const [SHARD_K, SHARD_N] = (arg('--shard', '0/1') || '0/1').split('/').map(Number);
const Y = RATES.loadYields(fs.readFileSync(arg('--yields', 'study/gs10.csv'), 'utf8'));
const FROM_M = arg('--from', '2016-12-01').slice(0, 7);
const testYields = [...Y.entries()].filter(([m]) => m >= FROM_M && m <= '2026-10').map(([, v]) => v);
const MEAN_YIELD = testYields.reduce((a, b) => a + b, 0) / testYields.length;
const RULES = RATES.studyRules(Y, MEAN_YIELD);
const EXTREMES = RATES.extremeRules();
console.log(`yields: ${Y.size} months, test-period mean ${(MEAN_YIELD * 100).toFixed(2)}% (${testYields.length} months), rules ${Object.keys(RULES).join(' ')}`);
const SITE = (process.env.SITE_URL || 'https://ayman-sketch97.github.io/stock-checker/').replace(/\/?$/, '/');
const ONLY = (arg('--only', '') || '').split(',').map(normalizeTicker).filter(Boolean);
const SAMPLE = Number(arg('--sample', 0));
const SEED = Number(arg('--seed', 7));
const CONCURRENCY = Number(arg('--concurrency', 4));
const FROM = arg('--from', '2016-12-01');
const UNIVERSE = arg('--universe', 'screener');
const MIN_CAP_NOW = Number(arg('--min-cap-now', 250e6));
// only common shares (as in the daily build): notes, preferred shares, warrants and units are left out
const NOT_COMMON = /\bnotes?\b|debentures?|preferred|\bwarrants?\b|\brights?\b|tangible equity|units?,? each consisting|%/i;

// the companies to replay, with today's market value (for the share-count cross-check)
let universe;
if (UNIVERSE === 'site') {
  const scr = await (await fetch(SITE + 'data/screen.json')).json();
  const SF = Object.fromEntries(scr.fields.map((k, j) => [k, j]));
  universe = scr.rows
    .map((r) => ({ t: r[SF.ticker], cap: r[SF.capM] * 1e6, price: r[SF.price], verdict: r[SF.verdict], sector: r[SF.sector] }))
    .filter((u) => u.t && u.verdict !== 'FINANCIAL'); // banks and insurers never reach the shortlist
} else {
  const seen = new Set();
  universe = [];
  for (const r of await getNasdaqScreener()) {
    const t = normalizeTicker(r.symbol);
    if (!t || seen.has(t) || NOT_COMMON.test(r.name) || !(r.price > 0) || !(r.marketCap >= MIN_CAP_NOW)) continue;
    seen.add(t);
    universe.push({ t, cap: r.marketCap, price: r.price, sector: r.sector });
  }
}
universe.sort((a, b) => (a.t < b.t ? -1 : 1));
universe = universe.filter((u, i) => i % SHARD_N === SHARD_K);
if (ONLY.length) universe = universe.filter((u) => ONLY.includes(u.t));
if (SAMPLE) {
  let s = SEED >>> 0 || 1;
  const rnd = () => { s ^= s << 13; s >>>= 0; s ^= s >>> 17; s ^= s << 5; s >>>= 0; return s / 4294967296; };
  for (let i = universe.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [universe[i], universe[j]] = [universe[j], universe[i]]; }
  universe = universe.slice(0, SAMPLE);
}

const done = new Set();
if (fs.existsSync(OUT)) {
  for (const line of fs.readFileSync(OUT, 'utf8').split('\n')) {
    if (!line.trim()) continue;
    try { done.add(JSON.parse(line).t); } catch { /* a line cut off by a stopped run */ }
  }
}
const out = fs.createWriteStream(OUT, { flags: 'a' });
const write = (obj) => new Promise((res) => out.write(JSON.stringify(obj) + '\n', res));

if (!done.has('$SPY') && SHARD_K === 0) {
  const spy = await getNasdaqHistory('SPY', 20000, 3, 'etf');
  await write({ t: '$SPY', px: LT.pxRows(spy.daily) });
}
const { byTicker } = await getTickerIndex();
const queue = universe.filter((u) => !done.has(u.t));
console.log(`companies: ${universe.length}, already done: ${universe.length - queue.length}, to do: ${queue.length}`);
const started = Date.now();
let n = 0;
let skipped = 0;
async function one(u) {
  const rec = byTicker.get(u.t);
  if (!rec) return { t: u.t, skip: 'no SEC record' };
  const submissions = await getSubmissions(rec.cik);
  // banks, insurers and other financial firms never reach the shortlist: not worth replaying
  if (submissions?.sic >= 6000 && submissions.sic < 6800) return { t: u.t, skip: 'financial' };
  const [facts, hist] = await Promise.all([getCompanyFacts(rec.cik), getNasdaqHistory(u.t, 20000, 2)]);
  if (!facts || !hist?.daily?.length) return { t: u.t, skip: 'no data' };
  const last = hist.daily[hist.daily.length - 1];
  // today's analysis, with the same market-value cross-check as the daily build, decides the share-count basis
  const today = analyze({
    ticker: u.t, cik: rec.cik, listing: rec, submissions, facts,
    price: { source: 'Nasdaq', price: last.c, currency: 'USD', priceTime: `close on ${last.date}`, monthly: hist.monthly, splits: [], splitsKnown: false,
      marketCapRef: u.cap > 0 && u.price > 0 ? u.cap * (last.c / u.price) : null },
    fetchedAt: new Date().toISOString(),
  });
  const splits = LT.replaySplits(facts, today);
  if (!splits) return { t: u.t, skip: 'share count needs market data (share classes)' };
  const R = LT.replayCompany({ ticker: u.t, cik: rec.cik, listing: rec, submissions, facts, daily: hist.daily, splits, from: FROM, rules: RULES, extremes: EXTREMES });
  return { t: u.t, sector: u.sector, sic: submissions?.sic ?? null, rows: R.rows, by: R.rowsBy, last: R.lastBy, px: LT.pxRows(hist.daily) };
}
await Promise.all(Array.from({ length: CONCURRENCY }, async () => {
  while (queue.length) {
    const u = queue.shift();
    let res;
    try {
      res = await one(u);
    } catch (e) {
      res = { t: u.t, skip: 'error: ' + String(e.message || e).slice(0, 80) };
    }
    if (res.skip) skipped++;
    await write(res);
    n++;
    if (n % 25 === 0) console.log(`${n} done (${skipped} skipped), ${((Date.now() - started) / 60000).toFixed(1)} min`);
  }
}));
await new Promise((res) => out.end(res));
console.log(`finished shard ${SHARD_K}/${SHARD_N}: ${n} companies (${skipped} skipped) in ${((Date.now() - started) / 60000).toFixed(1)} min -> ${OUT}`);
