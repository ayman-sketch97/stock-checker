// Track record of the technical rules.
//
// backtestStock() replays the rules day by day over past prices: each day sees only data up to that day (no
// look-ahead), the plan is the one the site would have shown that evening, and the order is acted on the next
// session exactly as written (see simulateTrade in technical.js). One position per stock at a time.
//
// Honest limits, shown on the page next to every number:
//  - Survivorship: the test runs on companies that are big and listed today. Companies that shrank, went bust or
//    were bought out are missing, so results look better than reality.
//  - Prices are adjusted for splits but not dividends, and fills assume you got the trigger or open price.
//  - Costs are charged as a round-trip percentage of the position (DEFAULT_COST unless the page changes it).
import { evaluate, simulateTrade, TECH_VERSION } from './technical.js';

export const BT_VERSION = `${TECH_VERSION}.1`;
export const TRADED = ['pullback', 'breakout', 'reversal', 'range'];
export const REGIMES = ['up', 'mixed', 'down'];
export const DEFAULT_COST = 0.002; // round trip: 0.1% each way (commission + spread on a liquid large cap)

const isNum = (x) => typeof x === 'number' && Number.isFinite(x);
const r2 = (x, d = 3) => (isNum(x) ? Math.round(x * 10 ** d) / 10 ** d : null);

// Market regime from an index ETF's prepared prices (SPY): up = above a rising-trend 200-day average with the
// 50-day above the 200-day; down = the mirror image; mixed = anything in between.
export function regimeFinder(M) {
  if (!M) return () => null;
  const idx = new Map(M.dates.map((d, j) => [d, j]));
  const at = (j) => {
    const c = M.C[j];
    const a50 = M.s50[j];
    const a200 = M.s200[j];
    if (!isNum(a50) || !isNum(a200)) return null;
    if (c > a200 && a50 > a200) return 'up';
    if (c < a200 && a50 < a200) return 'down';
    return 'mixed';
  };
  return (date) => {
    let j = idx.get(date);
    if (j == null) {
      // a date the ETF did not trade (rare): use the last session before it
      let lo = 0;
      let hi = M.dates.length - 1;
      if (date < M.dates[0]) return null;
      while (lo < hi) {
        const mid = (lo + hi + 1) >> 1;
        if (M.dates[mid] <= date) lo = mid;
        else hi = mid - 1;
      }
      j = lo;
    }
    return at(j);
  };
}

export function backtestStock(P, { years = 5, regimeAt = null } = {}) {
  const trades = [];
  if (!P || P.n < 300) return trades;
  const start = Math.max(260, P.n - Math.round(years * 252));
  let i = start;
  while (i < P.n - 1) {
    const ev = evaluate(P, i);
    const p = ev.setup;
    if (p.status === 'active' && TRADED.includes(p.setup)) {
      const t = simulateTrade(P, i, p);
      if (t.status === 'closed' || t.status === 'open') {
        trades.push({
          setup: p.setup,
          signal: P.dates[i],
          fill: P.dates[t.fillIdx],
          exit: t.exitIdx == null ? null : P.dates[t.exitIdx],
          entry: t.entry,
          exitPx: t.exitPx,
          R: t.R,
          riskPct: t.riskPct,
          hitT1: t.hitT1,
          days: t.days,
          score: ev.score,
          regime: regimeAt ? regimeAt(P.dates[i]) : null,
          open: t.status === 'open',
        });
        if (t.status === 'open') break;
        i = t.exitIdx; // the exit day's close can already produce the next signal
        continue;
      }
    }
    i++;
  }
  return trades;
}

// R after costs: a round-trip cost is a fixed share of the position, so it weighs more when the stop is tight
export const netR = (R, riskPct, cost = DEFAULT_COST) => R - cost / Math.max(riskPct, 0.005);

// Summary statistics of closed trades (net of costs). ci is a rough 95% range for the average.
export function summarize(list, cost = DEFAULT_COST) {
  const R = [];
  let t1 = 0;
  let days = 0;
  for (const t of list) {
    if (t.open) continue;
    R.push(netR(t.R, t.riskPct, cost));
    if (t.hitT1) t1++;
    days += t.days;
  }
  const n = R.length;
  if (!n) return { n: 0 };
  let sum = 0;
  let win = 0;
  let gw = 0;
  let gl = 0;
  for (const x of R) {
    sum += x;
    if (x > 0) {
      win++;
      gw += x;
    } else gl -= x;
  }
  const mean = sum / n;
  const sd = n > 1 ? Math.sqrt(R.reduce((s, x) => s + (x - mean) ** 2, 0) / (n - 1)) : null;
  const se = isNum(sd) ? sd / Math.sqrt(n) : null;
  const sorted = [...R].sort((a, b) => a - b);
  const median = n % 2 ? sorted[(n - 1) / 2] : (sorted[n / 2 - 1] + sorted[n / 2]) / 2;
  return {
    n,
    winRate: r2(win / n),
    avgR: r2(mean),
    medianR: r2(median),
    ci: isNum(se) && n >= 5 ? [r2(mean - 1.96 * se), r2(mean + 1.96 * se)] : null,
    pf: gl > 0 ? r2(gw / gl, 2) : null,
    avgWin: win ? r2(gw / win) : null,
    avgLoss: n - win ? r2(-gl / (n - win)) : null,
    t1Rate: r2(t1 / n),
    avgDays: Math.round(days / n),
    best: r2(sorted[n - 1]),
    worst: r2(sorted[0]),
  };
}

// Distribution of results (net R) in fixed buckets, for a histogram
export const R_BUCKETS = [
  { label: 'Worse than -1R (gap)', max: -1.25 },
  { label: 'About -1R (stopped)', max: -0.75 },
  { label: '-0.75 to 0', max: 0 },
  { label: '0 to +0.5R', max: 0.5 },
  { label: '+0.5 to +1R', max: 1 },
  { label: '+1 to +2R', max: 2 },
  { label: '+2 to +3R', max: 3 },
  { label: 'Above +3R', max: Infinity },
];
export function histogram(list, cost = DEFAULT_COST) {
  const out = R_BUCKETS.map(() => 0);
  for (const t of list) {
    if (t.open) continue;
    const x = netR(t.R, t.riskPct, cost);
    const k = R_BUCKETS.findIndex((b) => x <= b.max);
    out[k < 0 ? out.length - 1 : k]++;
  }
  return out;
}

export const scoreBucket = (s) => (s >= 70 ? '70+' : s >= 60 ? '60-69' : s >= 50 ? '50-59' : 'below 50');
export const SCORE_BUCKETS = ['below 50', '50-59', '60-69', '70+'];
// relative strength percentile on the signal day (computed across all stocks by the site build)
export const rsBucket = (s) => (s == null ? null : s >= 85 ? '85+' : s >= 70 ? '70-84' : s >= 50 ? '50-69' : 'below 50');
export const RS_BUCKETS = ['below 50', '50-69', '70-84', '85+'];
// weighted 3/6/12-month return used for relative strength (recent months count most); j must be >= 252
export const rsWeighted = (c, j) => 0.4 * (c[j] / c[j - 63] - 1) + 0.3 * (c[j] / c[j - 126] - 1) + 0.3 * (c[j] / c[j - 252] - 1);

export function groupSummary(list, keyFn, keys, cost = DEFAULT_COST) {
  const groups = new Map(keys.map((k) => [k, []]));
  for (const t of list) {
    const k = keyFn(t);
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k).push(t);
  }
  return [...groups.entries()].filter(([k]) => k != null).map(([key, l]) => ({ key, ...summarize(l, cost) }));
}

// What the stock page shows: this stock's own record (small sample, so the page says so) and its recent trades
export function stockHistory(trades, cost = DEFAULT_COST) {
  const recent = trades.slice(-40).map((t) => ({
    setup: t.setup,
    signal: t.signal,
    fill: t.fill,
    exit: t.exit,
    entry: r2(t.entry, 2),
    exitPx: r2(t.exitPx, 2),
    R: r2(netR(t.R, t.riskPct, cost), 2),
    days: t.days,
    open: t.open || undefined,
  }));
  return { version: BT_VERSION, cost, summary: summarize(trades, cost), bySetup: groupSummary(trades, (t) => t.setup, TRADED, cost).filter((g) => g.n), recent };
}

// Compact rows for the site-wide file:
// [stock, setup, signal yyyymmdd, days, R x100 (gross), risk% x1000, hit T1, regime, score, relative strength]
export const COMPACT_FIELDS = ['stock', 'setup', 'signal', 'days', 'R100', 'risk1000', 'hitT1', 'regime', 'score', 'rs'];
export function compactTrade(t, stockIdx) {
  return [
    stockIdx,
    TRADED.indexOf(t.setup),
    Number(t.signal.replace(/-/g, '')),
    t.days,
    Math.round(t.R * 100),
    Math.round(t.riskPct * 1000),
    t.hitT1 ? 1 : 0,
    t.regime ? REGIMES.indexOf(t.regime) : -1,
    t.score,
    null, // relative strength: filled in by the site build once every stock is loaded
  ];
}
export function expandTrade(row) {
  return {
    stock: row[0],
    setup: TRADED[row[1]],
    signal: String(row[2]),
    year: Math.floor(row[2] / 10000),
    days: row[3],
    R: row[4] / 100,
    riskPct: row[5] / 1000,
    hitT1: !!row[6],
    regime: row[7] >= 0 ? REGIMES[row[7]] : null,
    score: row[8],
    rs: row[9] ?? null,
  };
}

// Benchmark for the backtest: what the same money would have made without the setups' timing. For each trade:
// its return on the position (R x risk, before costs); the same stock bought at the close of a random day in the
// test window and held for the same span; and the S&P 500 (SPY) bought on another random day and held as long.
// Spans are days + 1 trading days (signal-day close to exit-day close). SPY over the trade's own dates is not used:
// stops are hit in clusters on market down days, so that comparison would be biased by the trades' own outcomes.
// A fixed seed keeps the numbers stable for the same data. series[stock] and market are { d: yyyymmdd numbers
// ascending, c: closes }. `to` (yyyymmdd, optional) keeps the random windows inside a period.
export function benchmarkTrades(list, series, market, from, seed = 1, to = null) {
  let s = seed >>> 0 || 1;
  const rnd = () => {
    s ^= s << 13; s >>>= 0;
    s ^= s >>> 17;
    s ^= s << 5; s >>>= 0;
    return s / 4294967296;
  };
  const firstAtOrAfter = (d, v) => {
    let lo = 0;
    let hi = d.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (d[mid] < v) lo = mid + 1;
      else hi = mid;
    }
    return lo < d.length ? lo : -1;
  };
  const stats = (x) => {
    const n = x.length;
    if (!n) return { n: 0, mean: null, ci: null };
    const mean = x.reduce((a, b) => a + b, 0) / n;
    const sd = n > 1 ? Math.sqrt(x.reduce((a, b) => a + (b - mean) ** 2, 0) / (n - 1)) : null;
    const se = isNum(sd) ? sd / Math.sqrt(n) : null;
    return { n, mean: r2(mean, 5), ci: isNum(se) && n >= 5 ? [r2(mean - 1.96 * se, 5), r2(mean + 1.96 * se, 5)] : null };
  };
  const trade = [];
  const random = [];
  const mkt = [];
  let days = 0;
  const start = Number(from);
  for (const t of list) {
    const p = series[t.stock];
    if (!p || !isNum(t.R) || !isNum(t.riskPct) || !(t.days >= 0)) continue;
    const span = t.days + 1;
    const lo = firstAtOrAfter(p.d, start);
    const endIdx = to ? firstAtOrAfter(p.d, Number(to) + 1) : -1; // first day after the window, if one is set
    const hi = (endIdx >= 0 ? endIdx - 1 : p.c.length - 1) - span;
    if (lo < 0 || hi < lo) continue;
    const j = lo + Math.floor(rnd() * (hi - lo + 1));
    if (!(p.c[j] > 0) || !(p.c[j + span] > 0)) continue;
    trade.push(t.R * t.riskPct);
    random.push(p.c[j + span] / p.c[j] - 1);
    days += t.days;
    if (market) {
      const mlo = firstAtOrAfter(market.d, start);
      const mEnd = to ? firstAtOrAfter(market.d, Number(to) + 1) : -1;
      const mhi = (mEnd >= 0 ? mEnd - 1 : market.c.length - 1) - span;
      if (mlo >= 0 && mhi >= mlo) {
        const k = mlo + Math.floor(rnd() * (mhi - mlo + 1));
        if (market.c[k] > 0 && market.c[k + span] > 0) mkt.push(market.c[k + span] / market.c[k] - 1);
      }
    }
  }
  return { trade: stats(trade), random: stats(random), market: stats(mkt), avgDays: trade.length ? Math.round(days / trade.length) : null };
}

// Portfolio replay of the backtest trades under stated rules, for growth (CAGR) and worst fall (drawdown):
// each trade risks `risk` of current equity (the stop distance sets the size), no position is larger than
// `maxWeight` of equity, at most `maxPositions` are open, and there is no borrowing (a trade that does not fit in
// the cash left is skipped). Orders fill the session after the signal and exit `days` later; on the same day,
// higher-scored signals go first. Equity counts an open trade at cost and books its result when it closes, so
// swings inside open trades are left out and the drawdown is understated. dates: trading days as yyyymmdd numbers.
export function portfolioSim(trades, dates, { risk = 0.01, maxPositions = 10, maxWeight = 0.2, cost = DEFAULT_COST } = {}) {
  const at = new Map();
  dates.forEach((d, i) => at.set(d, i));
  const ev = [];
  for (const t of trades) {
    const i = at.get(Number(t.signal));
    if (i === undefined || !isNum(t.R) || !isNum(t.riskPct) || !(t.days >= 0)) continue;
    const entry = i + 1;
    const exit = entry + t.days;
    if (exit >= dates.length) continue;
    ev.push({ t, entry, exit });
  }
  if (!ev.length) return { taken: 0 };
  ev.sort((a, b) => a.entry - b.entry || (b.t.score ?? 0) - (a.t.score ?? 0) || (b.t.rs ?? 0) - (a.t.rs ?? 0));
  let cash = 1;
  let open = [];
  let taken = 0;
  let skipped = 0;
  let k = 0;
  let exposure = 0;
  const first = ev[0].entry;
  const last = dates.length - 1;
  const curve = [];
  const book = (p) => { cash += p.size * (1 + p.ret - cost); };
  for (let d = first; d <= last; d++) {
    open = open.filter((p) => (p.exit === d ? (book(p), false) : true));
    while (k < ev.length && ev[k].entry === d) {
      const e = ev[k++];
      const invested = open.reduce((s, p) => s + p.size, 0);
      const equity = cash + invested;
      const size = Math.min((risk * equity) / Math.max(e.t.riskPct, 0.005), maxWeight * equity);
      if (open.length >= maxPositions || size > cash + 1e-12) {
        skipped++;
        continue;
      }
      cash -= size;
      const p = { size, ret: e.t.R * e.t.riskPct, exit: e.exit };
      taken++;
      if (e.exit === d) book(p);
      else open.push(p);
    }
    const invested = open.reduce((s, p) => s + p.size, 0);
    curve.push(cash + invested);
    exposure += invested / (cash + invested);
  }
  const days = curve.length;
  const end = curve[days - 1];
  let peak = -Infinity;
  let maxDD = 0;
  for (const v of curve) {
    if (v > peak) peak = v;
    maxDD = Math.max(maxDD, 1 - v / peak);
  }
  const years = {};
  let prevEnd = 1;
  for (let j = 0; j < days; j++) {
    const y = Math.floor(dates[first + j] / 10000);
    if (j === days - 1 || Math.floor(dates[first + j + 1] / 10000) !== y) {
      years[y] = r2(curve[j] / prevEnd - 1, 4);
      prevEnd = curve[j];
    }
  }
  return {
    taken,
    skipped,
    from: dates[first],
    to: dates[last],
    endValue: r2(end, 4),
    cagr: r2(end ** (252 / days) - 1, 4),
    maxDrawdown: r2(maxDD, 4),
    avgExposure: r2(exposure / days, 3),
    years,
    rules: { risk, maxPositions, maxWeight, cost },
  };
}

// Buy and hold over trading days `from`..end of `closes`, with dividends (if given) reinvested at the close of the
// ex-dividend day: growth per year and the worst fall from a peak (daily closes).
export function buyHold(dates, closes, from, divs = []) {
  const start = dates.findIndex((d) => d >= from);
  if (start < 0) return null;
  const div = new Map(divs.map((x) => [x.date, x.amount]));
  let units = 1 / closes[start];
  let peak = -Infinity;
  let maxDD = 0;
  let v = 1;
  for (let j = start; j < closes.length; j++) {
    const a = div.get(dates[j]);
    if (a && j > start) units += (units * a) / closes[j];
    v = units * closes[j];
    if (v > peak) peak = v;
    maxDD = Math.max(maxDD, 1 - v / peak);
  }
  const days = closes.length - start;
  return { from: dates[start], endValue: r2(v, 4), cagr: r2(v ** (252 / days) - 1, 4), maxDrawdown: r2(maxDD, 4), dividends: divs.length > 0 };
}
