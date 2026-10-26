// Forward signal log: every buy signal the site shows is recorded on the day it appears and then followed with
// the same rules as the backtest (simulateTrade). Unlike the backtest, nothing in it can be tuned afterwards:
// it is the record of what the site actually said. The log lives in the published site (data/signals.json) and
// each daily build reads yesterday's copy, updates it and publishes it again.
import { simulateTrade, TECH_VERSION } from './technical.js';
import { TRADED, netR, DEFAULT_COST } from './backtest.js';

export const LOG_VERSION = 1;
// one record per signal, stored as an array to keep the file small
export const LOG_FIELDS = [
  'ticker', 'signal', 'setup', 'score', 'entry', 'maxEntry', 'stop', 't1', 't2', 'fill', 'verdict', 'shariah', 'regime', 'version',
  'status', 'fillDate', 'fillPx', 'exitDate', 'exitPx', 'R', 'riskPct', 'hitT1', 'days', 'rs',
];
const F = Object.fromEntries(LOG_FIELDS.map((k, j) => [k, j]));
const KEEP_DAYS = 400; // closed signals older than this are folded into the running totals

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

// Has the live record earned the right to real money? Every closed signal on a halal stock still in the log (the last
// KEEP_DAYS days) is compared with SPY over the same days (signal-day close to exit-day close), after costs. The site
// calls swing signals proven only with at least `need` such trades and a 95% lower bound above zero for the trade's
// return minus SPY's. Until then it labels them paper trades. spy: { dates: ['YYYY-MM-DD', ...], C: closes }.
export function liveProof(log, spy, { need = 100, cost = DEFAULT_COST } = {}) {
  const out = { n: 0, need, cost, since: log && log.started ? log.started : null, avgTrade: null, avgSpy: null, avgDiff: null, ciLow: null, ciHigh: null, proven: false };
  if (!log || !Array.isArray(log.records) || !spy || !Array.isArray(spy.dates)) return out;
  const at = new Map(spy.dates.map((d, i) => [d, i]));
  const num = (x) => typeof x === 'number' && Number.isFinite(x);
  const diffs = [];
  let sumTrade = 0;
  let sumSpy = 0;
  for (const r of log.records) {
    if (r[F.status] !== 'closed' || r[F.shariah] !== 'pass' || !num(r[F.R]) || !num(r[F.riskPct])) continue;
    const a = at.get(r[F.signal]);
    const b = at.get(r[F.exitDate]);
    if (a === undefined || b === undefined || b <= a || !(spy.C[a] > 0)) continue;
    const trade = r[F.R] * r[F.riskPct] - cost; // return on the money in the trade, after buying and selling costs
    const market = spy.C[b] / spy.C[a] - 1;
    diffs.push(trade - market);
    sumTrade += trade;
    sumSpy += market;
  }
  const n = diffs.length;
  out.n = n;
  if (!n) return out;
  const mean = diffs.reduce((s, x) => s + x, 0) / n;
  out.avgTrade = r2(sumTrade / n, 4);
  out.avgSpy = r2(sumSpy / n, 4);
  out.avgDiff = r2(mean, 4);
  if (n > 1) {
    const sd = Math.sqrt(diffs.reduce((s, x) => s + (x - mean) ** 2, 0) / (n - 1));
    out.ciLow = r2(mean - (1.96 * sd) / Math.sqrt(n), 4);
    out.ciHigh = r2(mean + (1.96 * sd) / Math.sqrt(n), 4);
  }
  out.proven = n >= need && num(out.ciLow) && out.ciLow > 0;
  return out;
}
