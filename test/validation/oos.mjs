// Out-of-sample check of the swing rules. The rules and the shortlist filters were written while looking at the
// backtest from October 2021 on; the years before that were never examined. This replays the same frozen rules
// on a fixed random sample of today's stocks over nine years and reports the unseen period (to October 2021)
// separately from the seen one. Also: costs, a random-entry benchmark, and a portfolio replay (growth and worst
// fall) against SPY with dividends.
// Usage: node test/validation/oos.mjs [sampleSize=400] [seed=11] [spy-dividends.json]   (needs network: site data, Nasdaq)
// spy-dividends.json (optional): [{"date": "YYYY-MM-DD", "amount": 1.23}, ...], SPY's ex-dividend dates and cash
// amounts from any source you trust (for example SPY's distribution history from the fund manager). Without it, the
// SPY comparison is price only, like the trades.
import fs from 'node:fs';
import { getNasdaqHistory } from '../../lib/data.js';
import { prepare } from '../../lib/technical.js';
import * as BT from '../../lib/backtest.js';

const N = Number(process.argv[2] || 400);
const SEED = Number(process.argv[3] || 11);
const SPLIT = 20211015; // first signal date of the site's backtest (the period the rules were developed on)
const SITE = 'https://ayman-sketch97.github.io/stock-checker/';

let s = SEED >>> 0 || 1;
const rnd = () => { s ^= s << 13; s >>>= 0; s ^= s >>> 17; s ^= s << 5; s >>>= 0; return s / 4294967296; };
const bt = await (await fetch(SITE + 'data/backtest.json')).json();
const pool = bt.stocks.map(([t, sh]) => ({ t, sh })).sort((a, b) => (a.t < b.t ? -1 : 1)); // fixed order, so the seed decides the sample
for (let i = pool.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [pool[i], pool[j]] = [pool[j], pool[i]]; }
const sample = pool.slice(0, N);

const spy = prepare((await getNasdaqHistory('SPY', 20000, 3, 'etf')).daily);
const regimeAt = BT.regimeFinder(spy);
const dates = spy.dates.map((d) => Number(d.replace(/-/g, '')));
// SPY dividends (ex-dividend dates and amounts) from a local file, for a total-return benchmark
const divs = process.argv[4]
  ? JSON.parse(fs.readFileSync(process.argv[4], 'utf8')).map((v) => ({ date: Number(String(v.date).replace(/-/g, '')), amount: Number(v.amount) }))
  : [];

const trades = [];
const series = [];
const q = sample.map((x, i) => ({ ...x, i }));
let done = 0;
await Promise.all(Array.from({ length: 4 }, async () => {
  while (q.length) {
    const x = q.shift();
    try {
      const h = await getNasdaqHistory(x.t, 20000, 2, 'stocks');
      if (!h?.daily || h.daily.length < 600) continue;
      const P = prepare(h.daily);
      series[x.i] = { d: Int32Array.from(P.dates, (d) => Number(d.replace(/-/g, ''))), c: Float64Array.from(P.C) };
      for (const t of BT.backtestStock(P, { years: 9, regimeAt })) {
        if (t.open) continue;
        trades.push({ stock: x.i, setup: t.setup, signal: t.signal.replace(/-/g, ''), days: t.days, R: t.R, riskPct: t.riskPct, regime: t.regime, score: t.score, halal: x.sh === 'pass' });
      }
    } catch { /* skip a stock whose history cannot be loaded */ }
    if (++done % 50 === 0) console.log(`${done} of ${sample.length} stocks`);
  }
}));

// relative strength on each signal day, ranked within the sample (same formula as the site)
const idxOf = (arr, v) => { let lo = 0; let hi = arr.length - 1; while (lo <= hi) { const m = (lo + hi) >> 1; if (arr[m] === v) return m; if (arr[m] < v) lo = m + 1; else hi = m - 1; } return -1; };
const byDay = new Map();
for (const t of trades) if (!byDay.has(t.signal)) byDay.set(t.signal, null);
for (const day of byDay.keys()) {
  const v = [];
  for (const x of series) { if (!x) continue; const j = idxOf(x.d, Number(day)); if (j >= 252) v.push(BT.rsWeighted(x.c, j)); }
  byDay.set(day, Float64Array.from(v).sort());
}
for (const t of trades) {
  const x = series[t.stock]; const j = x ? idxOf(x.d, Number(t.signal)) : -1; const srt = byDay.get(t.signal);
  if (j < 252 || !srt || srt.length < 20) { t.rs = null; continue; }
  const w = BT.rsWeighted(x.c, j); let lo = 0; let hi = srt.length;
  while (lo < hi) { const m = (lo + hi) >> 1; if (srt[m] < w) lo = m + 1; else hi = m; }
  t.rs = Math.max(1, Math.min(99, Math.round(((lo + 0.5) / srt.length) * 100)));
}

const pct = (x) => (x == null ? 'n/a' : `${(x * 100).toFixed(1)}%`);
const out = { sample: sample.length, loaded: series.filter(Boolean).length, trades: trades.length, split: SPLIT, periods: {} };
console.log(`\nsample ${out.loaded} of ${N} stocks loaded, ${trades.length} closed trades, SPY dividends: ${divs.length}`);
for (const [name, keep] of [['unseen (to Oct 2021)', (t) => Number(t.signal) < SPLIT], ['seen (Oct 2021 on)', (t) => Number(t.signal) >= SPLIT]]) {
  const P = trades.filter(keep);
  const uni = { all: P, halal: P.filter((t) => t.halal), strong: P.filter((t) => t.halal && t.rs >= 70 && t.regime !== 'down') };
  const res = {};
  console.log(`\n== ${name}: ${P.length} trades, signals ${Math.min(...P.map((t) => +t.signal))} to ${Math.max(...P.map((t) => +t.signal))}`);
  for (const [u, list] of Object.entries(uni)) {
    const by = Object.fromEntries([0.002, 0.005, 0.008].map((c) => [c, BT.summarize(list, c)]));
    const winEnd = name.startsWith('unseen') ? SPLIT : null; // random windows stay inside the period
    const bm = BT.benchmarkTrades(list, series, { d: Int32Array.from(dates), c: Float64Array.from(spy.C) }, Math.min(...list.map((t) => +t.signal)), 7, winEnd);
    res[u] = { byCost: by, benchmark: bm, bySetup: BT.groupSummary(list, (t) => t.setup, BT.TRADED, 0.002) };
    const b = by[0.002];
    console.log(`  ${u.padEnd(6)} n ${String(b.n).padStart(5)}  avg R after 0.2%: ${b.avgR} [${b.ci}]  0.5%: ${by[0.005].avgR}  0.8%: ${by[0.008].avgR}  win ${pct(b.winRate)}  PF ${b.pf}`);
    console.log(`         per trade before costs: setups ${pct(bm.trade.mean)}  random entry ${pct(bm.random.mean)}  SPY ${pct(bm.market.mean)}`);
  }
  // portfolio replay over the period's own dates, against SPY bought at the first fill
  const lastDay = name.startsWith('unseen') ? SPLIT : dates[dates.length - 1];
  const dd = dates.filter((d) => d <= lastDay);
  for (const u of ['halal', 'strong']) {
    const ps = BT.portfolioSim(uni[u], dd, { risk: 0.01, maxPositions: 10, maxWeight: 0.2, cost: 0.002 });
    res[u].portfolio = ps;
    console.log(`  portfolio ${u.padEnd(6)} CAGR ${pct(ps.cagr)}  worst fall ${pct(ps.maxDrawdown)}  invested ${pct(ps.avgExposure)} of the time  trades ${ps.taken} (skipped ${ps.skipped})`);
  }
  const from = res.halal.portfolio.from;
  const closes = spy.C.slice(0, dd.length);
  res.spy = { price: BT.buyHold(dd, closes, from), total: divs.length ? BT.buyHold(dd, closes, from, divs) : null };
  console.log(`  SPY buy and hold from ${from}: CAGR ${pct(res.spy.price.cagr)} (price) / ${res.spy.total ? pct(res.spy.total.cagr) : 'n/a'} (with dividends), worst fall ${pct(res.spy.price.maxDrawdown)} (price)`);
  out.periods[name] = res;
}
fs.writeFileSync('oos.json', JSON.stringify(out));
