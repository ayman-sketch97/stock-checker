// Forward signal log: every buy signal the site shows is recorded on the day it appears and then followed with
// the same rules as the backtest (simulateTrade). Unlike the backtest, nothing in it can be tuned afterwards:
// it is the record of what the site actually said. The log lives in the published site (data/signals.json) and
// each daily build reads yesterday's copy, updates it and publishes it again.
import { simulateTrade, TECH_VERSION } from './technical.js';
import { TRADED, netR, DEFAULT_COST } from './backtest.js';

export const LOG_VERSION = 1;
// one record per signal, stored as an array to keep the file small. hR (added later, so older records lack it):
// the trade's R when cut off PROOF_H trading days after its fill, the live record's fair test (see liveProof)
export const LOG_FIELDS = [
  'ticker', 'signal', 'setup', 'score', 'entry', 'maxEntry', 'stop', 't1', 't2', 'fill', 'verdict', 'shariah', 'regime', 'version',
  'status', 'fillDate', 'fillPx', 'exitDate', 'exitPx', 'R', 'riskPct', 'hitT1', 'days', 'rs', 'hR',
];
const F = Object.fromEntries(LOG_FIELDS.map((k, j) => [k, j]));
const KEEP_DAYS = 400; // closed signals older than this are folded into the running totals
export const PROOF_H = 20; // trading days each live trade is followed for the real-money test (about a month)

export function emptyLog() {
  return { version: LOG_VERSION, started: null, updated: null, fields: LOG_FIELDS, records: [], lapsed: 0, archived: { n: 0, wins: 0, sumR: 0 } };
}

export function parseLog(json) {
  if (!json || json.version !== LOG_VERSION || !Array.isArray(json.records)) return emptyLog();
  return { ...emptyLog(), ...json, fields: LOG_FIELDS };
}

export const rec = (r) => Object.fromEntries(LOG_FIELDS.map((k, j) => [k, r[j]]));

const planOf = (r) => ({ setup: r[F.setup], entry: r[F.entry], maxEntry: r[F.maxEntry], stop: r[F.stop], target1: r[F.t1], target2: r[F.t2], fill: r[F.fill] });
const r2 = (x, d = 2) => (typeof x === 'number' && Number.isFinite(x) ? Math.round(x * 10 ** d) / 10 ** d : null);

// Bring one stock's records up to date with its latest prices, then add today's signal if there is one.
// P: prepare() output for the stock; ev: evaluate() of its latest bar; meta: { verdict, shariah, regime }
// Returns the stock's new record list and how many pending orders lapsed (did not fill).
export function updateStock(records, P, ev, meta) {
  const out = [];
  let lapsed = 0;
  for (const r of records) {
    const status = r[F.status];
    if (status === 'closed') {
      out.push(r);
      continue;
    }
    const i = P.dates.indexOf(r[F.signal]);
    if (i < 0) {
      out.push(r); // the history no longer covers it (should not happen within 10 years): keep as is
      continue;
    }
    const t = simulateTrade(P, i, planOf(r));
    if (t.status === 'pending') {
      out.push(r);
      continue;
    }
    if (t.status === 'nofill' || t.status === 'skipped' || t.status === 'invalid') {
      lapsed++;
      continue;
    }
    const n = [...r];
    n[F.status] = t.status; // 'open' or 'closed'
    n[F.fillDate] = P.dates[t.fillIdx];
    n[F.fillPx] = r2(t.entry);
    n[F.exitDate] = t.exitIdx == null ? null : P.dates[t.exitIdx];
    n[F.exitPx] = r2(t.exitPx);
    n[F.R] = r2(t.R, 3);
    n[F.riskPct] = r2(t.riskPct, 4);
    n[F.hitT1] = t.hitT1 ? 1 : 0;
    n[F.days] = t.days;
    // the same trade with the same rules, but sold at the close PROOF_H trading days after the fill if still open
    const th = simulateTrade(P, i, planOf(r), { maxHold: PROOF_H });
    n[F.hR] = th.status === 'closed' ? r2(th.R, 3) : null;
    out.push(n);
  }
  const busy = out.some((r) => r[F.status] === 'open' || r[F.status] === 'pending');
  const p = ev?.setup;
  const date = P.dates[P.n - 1];
  if (!busy && p && p.status === 'active' && TRADED.includes(p.setup) && !out.some((r) => r[F.signal] === date)) {
    const r = new Array(LOG_FIELDS.length).fill(null);
    r[F.ticker] = meta.ticker;
    r[F.signal] = date;
    r[F.setup] = p.setup;
    r[F.score] = ev.score;
    r[F.entry] = p.entry;
    r[F.maxEntry] = p.maxEntry;
    r[F.stop] = p.stop;
    r[F.t1] = p.target1;
    r[F.t2] = p.target2;
    r[F.fill] = p.fill;
    r[F.verdict] = meta.verdict || null;
    r[F.shariah] = meta.shariah || null;
    r[F.regime] = meta.regime || null;
    r[F.version] = TECH_VERSION;
    r[F.status] = 'pending';
    out.push(r);
  }
  return { records: out, lapsed };
}

// Fold old closed records into the running totals so the file stays small
export function trimLog(log, today) {
  const cutoff = new Date(new Date(today + 'T00:00:00Z').getTime() - KEEP_DAYS * 86400000).toISOString().slice(0, 10);
  const keep = [];
  for (const r of log.records) {
    if (r[F.status] === 'closed' && r[F.exitDate] && r[F.exitDate] < cutoff) {
      const R = netR(r[F.R], r[F.riskPct], DEFAULT_COST);
      log.archived.n++;
      if (R > 0) log.archived.wins++;
      log.archived.sumR = r2(log.archived.sumR + R, 3);
    } else keep.push(r);
  }
  log.records = keep;
  return log;
}

// Has the live record earned the right to real money? A young record misleads in three ways, and the test avoids each:
// - Early exits. A stop sits closer than a target, so losing trades tend to finish first (in some markets quick
//   winners do). Judging only closed trades would judge whichever kind finishes first. So every filled trade on a
//   halal stock is followed for exactly PROOF_H trading days after its fill (or to its exit, if sooner), and it counts
//   once those days are over, whether it has closed or not. Which trades count depends only on the calendar.
// - Trades that move together. Signals bunch up, and trades open at the same time share the market's moves, so 300
//   trades from one month are not 300 separate results. The trades are grouped by the calendar month of their fill
//   and each month (with at least minTrades trades) is one result.
// - Luck. Each trade's return after costs is compared with SPY's from the close before its fill to the end of the same
//   days. Swing signals count as proven only with at least needMonths months and a 95% lower bound (Student t on the
//   monthly averages) above zero for trade minus SPY. Until then the site labels them paper trades.
// spy: { dates: ['YYYY-MM-DD', ...], C: closes }, the same trading days as the stocks.
const T975 = [12.706, 4.303, 3.182, 2.776, 2.571, 2.447, 2.365, 2.306, 2.262, 2.228, 2.201, 2.179, 2.16, 2.145, 2.131, 2.12, 2.11, 2.101, 2.093, 2.086];
export function liveProof(log, spy, { needMonths = 6, minTrades = 10, horizon = PROOF_H, cost = DEFAULT_COST } = {}) {
  const out = {
    n: 0, months: 0, needMonths, horizon, waiting: 0, cost, since: log && log.started ? log.started : null,
    avgTrade: null, avgSpy: null, avgDiff: null, ciLow: null, ciHigh: null, proven: false,
  };
  if (!log || !Array.isArray(log.records) || !spy || !Array.isArray(spy.dates) || !Array.isArray(spy.C)) return out;
  const at = new Map(spy.dates.map((d, i) => [d, i]));
  const last = spy.dates.length - 1;
  const num = (x) => typeof x === 'number' && Number.isFinite(x);
  const byMonth = new Map();
  for (const r of log.records) {
    const st = r[F.status];
    if ((st !== 'open' && st !== 'closed') || r[F.shariah] !== 'pass' || !num(r[F.riskPct]) || typeof r[F.fillDate] !== 'string') continue;
    const f = at.get(r[F.fillDate]);
    if (f === undefined || f < 1) continue;
    if (f + horizon > last) {
      out.waiting++; // filled, but not yet followed for the full `horizon` days
      continue;
    }
    let R = null;
    let b = f + horizon;
    if (st === 'closed' && num(r[F.R]) && num(r[F.days]) && r[F.days] <= horizon) {
      R = r[F.R]; // closed inside the window: the cut-off trade is the trade itself
      const e = at.get(r[F.exitDate]);
      if (e !== undefined && e >= f) b = e;
    } else if (num(r[F.hR])) R = r[F.hR];
    if (R === null || !(spy.C[f - 1] > 0) || !(spy.C[b] > 0)) continue;
    const trade = R * r[F.riskPct] - cost; // return on the money in the trade, after buying and selling costs
    const market = spy.C[b] / spy.C[f - 1] - 1;
    const m = r[F.fillDate].slice(0, 7);
    const g = byMonth.get(m) || { n: 0, trade: 0, market: 0 };
    g.n++;
    g.trade += trade;
    g.market += market;
    byMonth.set(m, g);
  }
  const months = [...byMonth.values()].filter((g) => g.n >= minTrades);
  const k = months.length;
  out.months = k;
  out.n = months.reduce((s, g) => s + g.n, 0);
  if (!k) return out;
  const mean = (a) => a.reduce((s, x) => s + x, 0) / a.length;
  const mt = months.map((g) => g.trade / g.n);
  const ms = months.map((g) => g.market / g.n);
  const d = mt.map((x, j) => x - ms[j]);
  const md = mean(d);
  out.avgTrade = r2(mean(mt), 4);
  out.avgSpy = r2(mean(ms), 4);
  out.avgDiff = r2(md, 4);
  if (k > 1) {
    const sd = Math.sqrt(d.reduce((s, x) => s + (x - md) ** 2, 0) / (k - 1));
    const half = ((T975[k - 2] || 2.0) * sd) / Math.sqrt(k);
    out.ciLow = r2(md - half, 4);
    out.ciHigh = r2(md + half, 4);
  }
  out.proven = k >= needMonths && num(out.ciLow) && out.ciLow > 0;
  return out;
}
