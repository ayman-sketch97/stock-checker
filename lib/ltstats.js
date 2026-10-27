// Long-term backtest, step 2: rebuilds the long-term shortlist of each past month-end from the replayed analyses
// (lib/longterm.js, tools/lt-backtest.mjs) and follows it forward. Two questions:
// 1. Were the shortlisted stocks good opportunities? Their price return over the next 12, 24 and 36 months against
//    the S&P 500 (SPY) and against the average halal stock the tool could analyze on the same day.
// 2. What would have happened to the money? 1,000 AED a month put into the top of the shortlist with a selling
//    rule, against the same money in SPY and in random halal stocks with the same rules.
// Every stock in the data is still listed today: companies that went bust or were bought are missing. That
// flatters stock picking against SPY, most of all for deeply discounted stocks (the ones that recovered are in the
// data, the ones that failed are not), so the fair test of the shortlist is against random picks from the same
// stocks, which share the bias. Prices are not adjusted for dividends on either side.
import { SNAP_FIELDS } from './longterm.js';

export const STATS_VERSION = 1;
export const SHORTLIST = ['BUY_STRONG', 'BUY', 'CONTRARIAN']; // the site's "Quality on sale" list
export const SELL_BUSINESS = new Set(['AVOID_WEAK', 'SPECULATIVE']); // the business got worse
export const AED_MONTH = 1000 / 3.6725; // 1,000 AED in dollars
const isNum = (x) => typeof x === 'number' && Number.isFinite(x);
const r4 = (x) => (isNum(x) ? Math.round(x * 1e4) / 1e4 : null);
const mean = (a) => (a.length ? a.reduce((s, x) => s + x, 0) / a.length : null);
const quant = (a, q) => {
  if (!a.length) return null;
  const s = [...a].sort((x, y) => x - y);
  const i = (s.length - 1) * q;
  const lo = Math.floor(i);
  return s[lo] + (s[Math.min(lo + 1, s.length - 1)] - s[lo]) * (i - lo);
};

// Like the site, only companies worth $2 billion or more on the day count. The data also holds companies that are
// smaller today (down to a few hundred million), so stocks that were big then and shrank since are not missing.
export const MIN_CAP_M = 2000;
const bigEnough = (s) => s.cap == null || s.cap >= MIN_CAP_M;
export const inShortlist = (s) => !!s && SHORTLIST.includes(s.verdict) && s.shariah === 'pass' && bigEnough(s);
// the halal stocks the tool could judge that day (random picks and the "average stock" come from these)
export const eligible = (s) => !!s && s.shariah === 'pass' && !['NODATA', 'FINANCIAL', 'UNRELIABLE', 'AVOID_SHARIAH'].includes(s.verdict) && bigEnough(s);

// ndjson lines from tools/lt-backtest.mjs -> month-aligned arrays
export function loadData(lines) {
  let spyRow = null;
  const raw = [];
  for (const line of lines) {
    if (!line || !line.trim()) continue;
    let o;
    try { o = JSON.parse(line); } catch { continue; }
    if (o.t === '$SPY') spyRow = o;
    else if (!o.skip && Array.isArray(o.rows) && Array.isArray(o.px)) raw.push(o);
  }
  if (!spyRow) throw new Error('no SPY prices in the data');
  const months = spyRow.px.map((p) => p[0].slice(0, 7));
  const at = new Map(months.map((m, k) => [m, k]));
  const align = (px) => {
    const c = new Array(months.length).fill(null);
    const n = new Array(months.length).fill(null);
    for (const [d, close, next] of px) {
      const k = at.get(d.slice(0, 7));
      if (k === undefined) continue;
      c[k] = close;
      n[k] = next;
    }
    return { c, n };
  };
  const spy = align(spyRow.px);
  const F = Object.fromEntries(SNAP_FIELDS.map((f, j) => [f, j]));
  const comps = raw.map((o) => {
    const { c, n } = align(o.px);
    const snap = new Array(months.length).fill(null);
    for (const r of o.rows) {
      const k = at.get(String(r[F.date]).slice(0, 7));
      if (k === undefined) continue;
      snap[k] = Object.fromEntries(SNAP_FIELDS.map((f, j) => [f, r[j]]));
    }
    return { t: o.t, sector: o.sector || '', snap, c, n };
  });
  return { months, spy, comps };
}

// Newey-West mean and t: monthly results with overlapping holding windows are not independent
export function nwMean(x, lag) {
  const n = x.length;
  if (n < 3) return { mean: n ? mean(x) : null, se: null, t: null, n };
  const m = mean(x);
  const e = x.map((v) => v - m);
  let s = e.reduce((a, v) => a + v * v, 0) / n;
  for (let L = 1; L <= lag && L < n; L++) {
    let g = 0;
    for (let i = L; i < n; i++) g += e[i] * e[i - L];
    s += 2 * (1 - L / (lag + 1)) * (g / n);
  }
  const se = Math.sqrt(Math.max(s, 0) / n);
  return { mean: m, se, t: se > 0 ? m / se : null, n };
}

// Question 1: forward returns of the shortlist, h months after each month-end (bought at the next session's close)
export function forwardTest(D, { h = 12, pick = inShortlist, base = eligible, from = 0, to = D.months.length - 1 } = {}) {
  const rows = [];
  for (let k = from; k + h <= to; k++) {
    const s0 = D.spy.n[k];
    const s1 = D.spy.c[k + h];
    if (!(s0 > 0 && s1 > 0)) continue;
    const spyR = s1 / s0 - 1;
    let pn = 0;
    let ps = 0;
    let beat = 0;
    let un = 0;
    let us = 0;
    for (const c of D.comps) {
      const s = c.snap[k];
      if (!s) continue;
      const a = c.n[k];
      const b = c.c[k + h];
      if (!(a > 0 && b > 0)) continue;
      const r = b / a - 1;
      if (base(s)) {
        un++;
        us += r;
      }
      if (pick(s)) {
        pn++;
        ps += r;
        if (r > spyR) beat++;
      }
    }
    if (!un) continue;
    rows.push({ month: D.months[k], spy: spyR, uni: us / un, nUni: un, picks: pn ? ps / pn : null, nPicks: pn, beat: pn ? beat / pn : null });
  }
  const withPicks = rows.filter((r) => isNum(r.picks));
  const vsSpy = nwMean(withPicks.map((r) => r.picks - r.spy), h - 1);
  const vsUni = nwMean(withPicks.map((r) => r.picks - r.uni), h - 1);
  const uniVsSpy = nwMean(rows.map((r) => r.uni - r.spy), h - 1);
  const ann = (x) => (isNum(x) && x > -1 ? (1 + x) ** (12 / h) - 1 : null);
  return {
    h,
    months: rows.length,
    monthsWithPicks: withPicks.length,
    avgPicks: r4(mean(withPicks.map((r) => r.nPicks))),
    picks: r4(mean(withPicks.map((r) => r.picks))),
    picksAnnual: r4(ann(mean(withPicks.map((r) => r.picks)))),
    universe: r4(mean(withPicks.map((r) => r.uni))),
    spy: r4(mean(withPicks.map((r) => r.spy))),
    vsSpy: { mean: r4(vsSpy.mean), t: r4(vsSpy.t), n: vsSpy.n },
    vsUniverse: { mean: r4(vsUni.mean), t: r4(vsUni.t), n: vsUni.n },
    universeVsSpy: { mean: r4(uniVsSpy.mean), t: r4(uniVsSpy.t), n: uniVsSpy.n },
    monthsBeatingSpy: withPicks.length ? r4(withPicks.filter((r) => r.picks > r.spy).length / withPicks.length) : null,
    monthsBeatingUniverse: withPicks.length ? r4(withPicks.filter((r) => r.picks > r.uni).length / withPicks.length) : null,
    picksBeatingSpy: r4(mean(withPicks.map((r) => r.beat))),
    byYear: Object.entries(
      withPicks.reduce((acc, r) => {
        const y = r.month.slice(0, 4);
        (acc[y] = acc[y] || []).push(r);
        return acc;
      }, {})
    ).map(([y, a]) => ({ year: y, picks: r4(mean(a.map((r) => r.picks))), universe: r4(mean(a.map((r) => r.uni))), spy: r4(mean(a.map((r) => r.spy))), avgPicks: r4(mean(a.map((r) => r.nPicks))) })),
  };
}

// broker cost for one order: IBKR Tiered-like, $0.35 minimum or $0.0035 a share, plus 0.05% for the spread
export const orderCost = (value, price) => Math.max(0.35, 0.0035 * (value / price)) + 0.0005 * value;

function rng32(seed) {
  let s = seed >>> 0 || 1;
  return () => {
    s ^= s << 13; s >>>= 0; s ^= s >>> 17; s ^= s << 5; s >>>= 0;
    return s / 4294967296;
  };
}
// money-weighted yearly return of monthly deposits and a final value (deposits at month k, value at month `end`)
export function xirrMonthly(deposits, finalValue, end) {
  const f = (r) => deposits.reduce((s, [k, amt]) => s + amt * (1 + r) ** (end - k), 0) - finalValue;
  let lo = -0.2;
  let hi = 0.2;
  if (f(lo) * f(hi) > 0) return null;
  for (let i = 0; i < 100; i++) {
    const mid = (lo + hi) / 2;
    if (f(lo) * f(mid) <= 0) hi = mid;
    else lo = mid;
  }
  return (1 + (lo + hi) / 2) ** 12 - 1;
}

// Question 2: monthly deposits into the top of the list.
// rule 'healthy': sell everything when the business gets worse (verdict weak or loss-making), sell half above the
//   trim level (at most every 6 months), otherwise hold through any fall;
// rule 'wait': the same, but never sell at a loss for a weaker business (only a sale at or above the average cost);
// rule 'never': never sell for business or price reasons.
// All rules sell a stock that fails the Shariah screen. pick 'shortlist' (best upside first) or 'random'.
// Money that cannot go into a stock this month (no stock fits under the caps) goes into the index fund (SPY here),
// as the Portfolio page says; the fund part is never sold.
export function simulate(D, { from, to, monthly = AED_MONTH, rule = 'healthy', pick = 'shortlist', seed = 1, maxPos = 15, maxWeight = 0.1, minOrder = 100, filter = inShortlist, onTrade = null } = {}) {
  const rnd = rng32(seed);
  const pos = new Map(); // comp index -> { sh, cost, trimK }
  const last = new Map(); // comp index -> last known close (for months a stock has no price)
  let cash = 0;
  let fundSh = 0;
  let toFund = 0;
  let fees = 0;
  let buys = 0;
  let sells = 0;
  let sellsBusiness = 0;
  let sellsTrim = 0;
  let idleMonths = 0;
  let peak = 0;
  let index = 1;
  let worst = 0;
  let prevValue = null;
  const deposits = [];
  const priceAt = (ci, arr, k) => {
    const v = D.comps[ci][arr][k];
    if (v > 0) {
      last.set(ci, v);
      return v;
    }
    return last.get(ci) ?? null;
  };
  const valueAt = (k, arr = 'c') => {
    let v = cash + fundSh * (D.spy[arr][k] || D.spy.c[k] || 0);
    for (const [ci, p] of pos) {
      const px = priceAt(ci, arr, k);
      if (px > 0) v += p.sh * px;
    }
    return v;
  };
  for (let k = from; k <= to; k++) {
    // month-end value before this month's deposit: the growth since last month, for the worst-fall figure
    const v0 = valueAt(k);
    if (prevValue !== null && prevValue > 0) {
      index *= v0 / prevValue;
      peak = Math.max(peak, index);
      worst = Math.min(worst, index / peak - 1);
    } else peak = index;
    if (k === to) break; // the last month-end only values the portfolio
    cash += monthly;
    deposits.push([k, monthly]);
    // decisions on this month-end's analysis, orders filled at the next session's close
    for (const [ci, p] of [...pos]) {
      const s = D.comps[ci].snap[k];
      const px = D.comps[ci].n[k];
      if (!s || !(px > 0)) continue;
      const avg = p.cost / p.sh;
      let frac = 0;
      if (s.verdict === 'AVOID_SHARIAH') frac = 1;
      else if (rule !== 'never' && SELL_BUSINESS.has(s.verdict) && (rule === 'healthy' || px >= avg)) {
        frac = 1;
        sellsBusiness++;
      } else if (rule !== 'never' && isNum(s.trimAbove) && D.comps[ci].c[k] >= s.trimAbove && k - (p.trimK ?? -99) >= 6) {
        frac = 0.5;
        sellsTrim++;
        p.trimK = k;
      }
      if (!frac) continue;
      const sh = p.sh * frac;
      const value = sh * px;
      const fee = orderCost(value, px);
      cash += value - fee;
      fees += fee;
      sells++;
      if (onTrade) onTrade({ k, t: D.comps[ci].t, side: 'sell', why: frac === 1 ? (s.verdict === 'AVOID_SHARIAH' ? 'shariah' : 'business') : 'trim', value, cost: p.cost * frac, verdict: s.verdict });
      if (frac === 1) pos.delete(ci);
      else {
        p.sh -= sh;
        p.cost *= 1 - frac;
      }
    }
    const total = valueAt(k, 'n');
    const cap = Math.max(maxWeight * total, 2 * monthly);
    // candidates in order of preference: the list sorted by upside, or a random order (of the list, or of every
    // eligible stock), or a custom chooser
    let cands = [];
    const shuffle = (a) => {
      for (let i = a.length - 1; i > 0; i--) {
        const j = Math.floor(rnd() * (i + 1));
        [a[i], a[j]] = [a[j], a[i]];
      }
      return a;
    };
    if (typeof pick === 'function') cands = pick(D, k, rnd);
    else if (pick === 'shortlist' || pick === 'shortlistRandom') {
      D.comps.forEach((c, ci) => { if (filter(c.snap[k]) && c.n[k] > 0) cands.push(ci); });
      if (pick === 'shortlist') cands.sort((a, b) => (D.comps[b].snap[k].upside ?? -9) - (D.comps[a].snap[k].upside ?? -9));
      else shuffle(cands);
    } else {
      D.comps.forEach((c, ci) => { if (eligible(c.snap[k]) && c.n[k] > 0) cands.push(ci); });
      shuffle(cands);
    }
    let bought = false;
    for (const ci of cands) {
      if (cash < minOrder) break;
      const p = pos.get(ci);
      if (!p && pos.size >= maxPos) continue;
      const px = D.comps[ci].n[k];
      const room = cap - (p ? p.sh * px : 0);
      if (room < minOrder) continue;
      const amt = Math.min(cash, room);
      const fee = orderCost(amt, px);
      const sh = (amt - fee) / px;
      if (p) {
        p.sh += sh;
        p.cost += amt;
      } else pos.set(ci, { sh, cost: amt, trimK: null });
      last.set(ci, px);
      cash -= amt;
      fees += fee;
      buys++;
      bought = true;
      if (onTrade) onTrade({ k, t: D.comps[ci].t, side: 'buy', value: amt, verdict: D.comps[ci].snap[k]?.verdict, upside: D.comps[ci].snap[k]?.upside });
    }
    if (!bought && cash >= minOrder) idleMonths++;
    if (cash >= minOrder && D.spy.n[k] > 0) {
      const fee = orderCost(cash, D.spy.n[k]);
      fundSh += (cash - fee) / D.spy.n[k];
      fees += fee;
      toFund += cash;
      cash = 0;
    }
    prevValue = valueAt(k, 'n');
  }
  const finalValue = valueAt(to);
  const deposited = deposits.reduce((s, d) => s + d[1], 0);
  if (onTrade) for (const [ci, p] of pos) onTrade({ k: to, t: D.comps[ci].t, side: 'hold', value: p.sh * (priceAt(ci, 'c', to) || 0), cost: p.cost });
  return {
    deposited: Math.round(deposited),
    finalValue: Math.round(finalValue),
    gain: r4(finalValue / deposited - 1),
    yearly: r4(xirrMonthly(deposits, finalValue, to)),
    worstFall: r4(worst),
    positions: pos.size,
    cashLeft: Math.round(cash),
    fundShare: r4(toFund / Math.max(deposited, 1)),
    buys,
    sells,
    sellsBusiness,
    sellsTrim,
    fees: Math.round(fees),
    idleMonths,
  };
}

// the same deposits into SPY
export function simulateSpy(D, { from, to, monthly = AED_MONTH } = {}) {
  let sh = 0;
  let fees = 0;
  let peak = 0;
  let index = 1;
  let worst = 0;
  let prev = null;
  const deposits = [];
  for (let k = from; k <= to; k++) {
    const v0 = sh * (D.spy.c[k] || 0);
    if (prev !== null && prev > 0) {
      index *= v0 / prev;
      peak = Math.max(peak, index);
      worst = Math.min(worst, index / peak - 1);
    } else peak = index;
    if (k === to) break;
    const px = D.spy.n[k];
    if (!(px > 0)) continue;
    const fee = orderCost(monthly, px);
    sh += (monthly - fee) / px;
    fees += fee;
    deposits.push([k, monthly]);
    prev = sh * px;
  }
  const finalValue = sh * D.spy.c[to];
  const deposited = deposits.reduce((s, d) => s + d[1], 0);
  return { deposited: Math.round(deposited), finalValue: Math.round(finalValue), gain: r4(finalValue / deposited - 1), yearly: r4(xirrMonthly(deposits, finalValue, to)), worstFall: r4(worst), fees: Math.round(fees) };
}

// random picks with the same rules, many times: the range a stock picker with no skill would have landed in
export function simulateRandom(D, opt, runs = 50) {
  const res = [];
  for (let s = 1; s <= runs; s++) res.push(simulate(D, { ...opt, pick: 'random', seed: 1000 + s }));
  const ys = res.map((r) => r.yearly).filter(isNum);
  const vs = res.map((r) => r.finalValue);
  return { runs, yearly: { p10: r4(quant(ys, 0.1)), median: r4(quant(ys, 0.5)), p90: r4(quant(ys, 0.9)) }, finalValue: { p10: Math.round(quant(vs, 0.1)), median: Math.round(quant(vs, 0.5)), p90: Math.round(quant(vs, 0.9)) } };
}

// The rule for how much of the monthly money goes to stocks, written down before the full test was run:
// 'stocks' (70% stocks, 30% fund): the shortlist portfolio beat the median of random picks over the whole period
//   and in both halves, beat SPY over the whole period, and its picks beat the average halal stock over 12 months
//   (Newey-West t above 2);
// 'mixed' (50/50): it beat the median random portfolio over the whole period and its picks beat the average stock
//   over 12 months, but not all of the above;
// 'fund' (20% stocks, 80% fund): otherwise.
export function decide({ full, half1, half2, fwd12 }) {
  const beatsRandom = (p) => isNum(p?.shortlist?.yearly) && isNum(p?.random?.yearly?.median) && p.shortlist.yearly > p.random.yearly.median;
  const picksBeatUni = isNum(fwd12?.vsUniverse?.mean) && fwd12.vsUniverse.mean > 0;
  const strong = beatsRandom(full) && beatsRandom(half1) && beatsRandom(half2) && full.shortlist.yearly > full.spy.yearly && picksBeatUni && fwd12.vsUniverse.t > 2;
  if (strong) return { verdict: 'stocks', stocks: 0.7, fund: 0.3 };
  if (beatsRandom(full) && picksBeatUni) return { verdict: 'mixed', stocks: 0.5, fund: 0.5 };
  return { verdict: 'fund', stocks: 0.2, fund: 0.8 };
}

// everything the site shows, for one data set
export function report(D, { randomRuns = 50 } = {}) {
  const months = D.months;
  const first = months.findIndex((m, k) => D.comps.filter((c) => c.snap[k]).length >= Math.max(20, D.comps.length * 0.3));
  const last = months.length - 1;
  const mid = months.findIndex((m) => m >= '2021-12') >= 0 ? months.findIndex((m) => m >= '2021-12') : Math.floor((first + last) / 2);
  const period = (from, to) => {
    const base = { from, to };
    const r = {
      from: months[from],
      to: months[to],
      shortlist: simulate(D, { ...base, rule: 'healthy' }),
      shortlistWait: simulate(D, { ...base, rule: 'wait' }),
      shortlistNever: simulate(D, { ...base, rule: 'never' }),
      shortlistHighData: simulate(D, { ...base, rule: 'healthy', filter: (s) => inShortlist(s) && s.dq === 'H' }),
      spy: simulateSpy(D, base),
      random: simulateRandom(D, { ...base, rule: 'healthy' }, randomRuns),
    };
    return r;
  };
  const full = period(first, last);
  const half1 = period(first, mid);
  const half2 = period(mid, last);
  const fwd = (opt) => ({ h12: forwardTest(D, { ...opt, h: 12, from: first }), h24: forwardTest(D, { ...opt, h: 24, from: first }), h36: forwardTest(D, { ...opt, h: 36, from: first }) });
  const forward = fwd({});
  const variants = {
    highData: forwardTest(D, { h: 12, from: first, pick: (s) => inShortlist(s) && s.dq === 'H' }),
    strongBuy: forwardTest(D, { h: 12, from: first, pick: (s) => s?.verdict === 'BUY_STRONG' && s.shariah === 'pass' }),
    buy: forwardTest(D, { h: 12, from: first, pick: (s) => s?.verdict === 'BUY' && s.shariah === 'pass' }),
    contrarian: forwardTest(D, { h: 12, from: first, pick: (s) => s?.verdict === 'CONTRARIAN' && s.shariah === 'pass' }),
    watch: forwardTest(D, { h: 12, from: first, pick: (s) => s?.verdict === 'WATCH' && s.shariah === 'pass' }),
    avoidWeak: forwardTest(D, { h: 12, from: first, pick: (s) => s?.verdict === 'AVOID_WEAK' && s.shariah === 'pass' }),
  };
  const decision = decide({ full, half1, half2, fwd12: forward.h12 });
  return {
    version: STATS_VERSION,
    companies: D.comps.length,
    from: months[first],
    to: months[last],
    monthly: Math.round(AED_MONTH),
    forward,
    variants,
    portfolio: { full, half1, half2 },
    decision,
  };
}
