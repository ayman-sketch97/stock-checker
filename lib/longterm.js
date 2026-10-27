// Long-term backtest: replays the fundamental analysis on past month-ends using only what was known on each day
// (filings filed by the day before, and that day's closing price), so the shortlist of the past can be rebuilt and
// followed forward. Pure functions: the data comes from the caller (tools/lt-backtest.mjs or the daily build).
import { analyze, FactBook, splitsFromRestatements } from './engine.js';

export const LT_VERSION = 1;
// one compact row per company and month-end
export const SNAP_FIELDS = ['date', 'verdict', 'quality', 'health', 'valuation', 'fair', 'buyBelow', 'trimAbove', 'dq', 'shariah', 'price', 'upside', 'confidence', 'cap'];
const VAL_CODE = { Undervalued: 'U', 'Fairly valued': 'F', Overvalued: 'O' };
const DQ_CODE = { high: 'H', limited: 'L', insufficient: 'X' };
const r2 = (x, d = 2) => (typeof x === 'number' && Number.isFinite(x) ? Math.round(x * 10 ** d) / 10 ** d : null);
const dayBefore = (d) => new Date(Date.parse(d + 'T00:00:00Z') - 86400000).toISOString().slice(0, 10);

// last trading day of every month in a daily series ([{date, c}], oldest first)
export function monthEnds(daily) {
  const out = [];
  for (let i = 0; i < daily.length; i++) {
    const next = daily[i + 1];
    if (!next || next.date.slice(0, 7) !== daily[i].date.slice(0, 7)) out.push(i);
  }
  return out;
}

// month-end prices for the forward test: [month-end date, its close, the next session's close (when an order based
// on that month-end's numbers could first be filled)]
export function pxRows(daily) {
  return monthEnds(daily).map((i) => [daily[i].date, r2(daily[i].c, 4), daily[i + 1] ? r2(daily[i + 1].c, 4) : null]);
}

// The share-count basis of Nasdaq's prices is today's (split-adjusted). Filed share counts are converted to it with
// every split the filings reveal (including splits after the replayed day: that is only a change of units), plus a
// recent split that today's analysis caught from market data. Returns null when today's share count needed a
// correction that is not a split (share classes, filing errors): those companies are left out of the replay.
export function replaySplits(facts, today) {
  const splits = splitsFromRestatements(new FactBook(facts)).map((s) => ({ date: s.date, ratio: s.ratio }));
  const src = String(today?.sharesSource || '');
  if (/^market data/.test(src)) return null;
  const m = /adjusted for a (\d+)-for-1 split/.exec(src);
  if (m) splits.push({ date: '9999-12-31', ratio: Number(m[1]) });
  return splits;
}

// Analyze one company as of each month-end from `from` on. daily: [{date, o, h, l, c}] split-adjusted, oldest first.
export function replayCompany({ ticker, cik, listing, submissions, facts, daily, splits, from = '2016-12-01' }) {
  const rows = [];
  if (!daily?.length || !splits) return rows;
  const ends = monthEnds(daily);
  const monthly = ends.map((i) => ({ date: daily[i].date, close: daily[i].c }));
  let mi = 0;
  for (const i of ends) {
    const D = daily[i].date;
    while (mi < monthly.length && monthly[mi].date <= D) mi++;
    if (D < from) continue;
    let hi = -Infinity;
    let lo = Infinity;
    for (let k = Math.max(0, i - 251); k <= i; k++) {
      if (daily[k].c > hi) hi = daily[k].c;
      if (daily[k].c < lo) lo = daily[k].c;
    }
    const price = {
      source: 'Nasdaq',
      price: daily[i].c,
      currency: 'USD',
      priceTime: `close on ${D}`,
      high52: hi,
      low52: lo,
      marketCapRef: null,
      monthly: monthly.slice(0, mi),
      splits,
      splitsKnown: true,
    };
    let r;
    try {
      r = analyze({ ticker, cik, listing, submissions, facts, price, fetchedAt: `${D}T21:00:00.000Z`, asOf: dayBefore(D) });
    } catch {
      continue;
    }
    if (!r || !r.ok) continue;
    const fv = r.fairValue;
    rows.push([
      D,
      r.verdict?.code || null,
      r.labels?.quality?.score ?? null,
      r.labels?.health?.score ?? null,
      VAL_CODE[r.labels?.valuation?.label] || null,
      r2(fv?.base),
      r2(r.pricePlan?.buyBelow),
      r2(r.pricePlan?.trimAbove),
      DQ_CODE[r.dataQuality?.level] || null,
      r.labels?.shariah?.status || null,
      r2(daily[i].c),
      r2(fv?.upside, 3),
      r.verdict?.confidence || null,
      // market value that day in $ millions (the site only covers companies worth $2 billion or more)
      typeof r.marketCap === 'number' && Number.isFinite(r.marketCap) ? Math.round(r.marketCap / 1e6) : null,
    ]);
  }
  return rows;
}
