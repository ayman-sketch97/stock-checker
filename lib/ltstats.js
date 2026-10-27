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

// Question 1: forward returns of the shortlist, h months after each month-end (bought at the next session's close).
// pick(snapshot, month index, company index) says whether a stock was picked that month.
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
    for (let ci = 0; ci < D.comps.length; ci++) {
      const c = D.comps[ci];
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
      if (pick(s, k, ci)) {
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

// Other ways to build the list, fixed in PREREGISTERED.md before the wider run's results were seen.
// 12-1 month price momentum at month-end k, known that day: the close a month earlier over the close 12 months
// earlier (the latest month is skipped, as in the research it comes from)
export function momentum(c, k) {
  if (k < 12) return null;
  const a = c[k - 12];
  const b = c[k - 1];
  return a > 0 && b > 0 ? b / a - 1 : null;
}
// percentile rank (0 worst .. 1 best) of every item that has a number under `key`; ties share their average rank
export function pctRanks(items, key) {
  const a = items.filter((x) => isNum(x[key])).sort((x, y) => x[key] - y[key]);
  const out = new Map();
  for (let i = 0; i < a.length;) {
    let j = i;
    while (j + 1 < a.length && a[j + 1][key] === a[i][key]) j++;
    const r = a.length > 1 ? (i + j) / 2 / (a.length - 1) : 0.5;
    for (let m = i; m <= j; m++) out.set(a[m].ci, r);
    i = j + 1;
  }
  return out;
}
// the best 20% by score, best first; stocks tied with the last one are kept rather than dropped at random
export function topShare(scored, share = 0.2) {
  const a = scored.filter((x) => isNum(x.score)).sort((x, y) => y.score - x.score);
  if (!a.length) return [];
  const cut = a[Math.max(1, Math.round(a.length * share)) - 1].score;
  return a.filter((x) => x.score >= cut).map((x) => x.ci);
}
export const ALTERNATIVES = {
  momentum: 'Momentum: the 20% with the best price trend',
  quality: 'Quality: the 20% with the best quality score',
  qualityMomentum: 'Quality and momentum',
  qualityValue: 'Quality and value',
  listTrend: 'The current list, rising stocks only',
};
export const ALT_T = 2.5; // the bar for alternatives: five are tried at once
// each alternative's picks at every month-end, best first: { name: [month index] -> [company index] }
export function altPicks(D) {
  const out = Object.fromEntries(Object.keys(ALTERNATIVES).map((n) => [n, new Array(D.months.length).fill(null)]));
  for (let k = 0; k < D.months.length; k++) {
    const items = [];
    D.comps.forEach((c, ci) => {
      const s = c.snap[k];
      if (!eligible(s) || !(c.n[k] > 0)) return;
      items.push({ ci, s, q: isNum(s.quality) ? s.quality : null, m: momentum(c.c, k), u: isNum(s.upside) ? s.upside : null });
    });
    if (!items.length) continue;
    const rq = pctRanks(items, 'q');
    const rm = pctRanks(items, 'm');
    const ru = pctRanks(items, 'u');
    const avg = (ra, rb) => items.map((x) => ({ ci: x.ci, score: ra.has(x.ci) && rb.has(x.ci) ? (ra.get(x.ci) + rb.get(x.ci)) / 2 : null }));
    out.momentum[k] = topShare(items.map((x) => ({ ci: x.ci, score: x.m })));
    out.quality[k] = topShare(items.map((x) => ({ ci: x.ci, score: x.q })));
    out.qualityMomentum[k] = topShare(avg(rq, rm));
    out.qualityValue[k] = topShare(avg(rq, ru));
    out.listTrend[k] = items.filter((x) => inShortlist(x.s) && isNum(x.m) && x.m > 0).sort((a, b) => (b.u ?? -9) - (a.u ?? -9)).map((x) => x.ci);
  }
  return out;
}
// ---- The Portfolio page's own picks (index.html stockIdeasByHold and "This month's plan"), tested the same way.
// The page suggests stocks for each holding period with its own filters and scores, at most 2 per sector, and puts
// each month's stock money into one place: a new stock while there are fewer than the target number, otherwise the
// holding furthest below its equal share. The short-term picks need data the test does not have (relative
// strength, chart setups), so only the long-term and medium-term picks are tested.
const NO_IDEA = new Set(['AVOID_WEAK', 'SPECULATIVE', 'AVOID_SHARIAH', 'FINANCIAL', 'NODATA', 'UNRELIABLE']);
const ideaBase = (s) => !!s && s.shariah === 'pass' && isNum(s.price) && s.price > 0 && !NO_IDEA.has(s.verdict) && s.dq !== 'X' && bigEnough(s);
const cheapBonus = (s) => (isNum(s.buyBelow) && s.buyBelow > 0 ? (s.price <= s.buyBelow ? 15 : s.price <= s.buyBelow * 1.1 ? 8 : 0) : 0);
const GOOD3 = ['BUY_STRONG', 'BUY', 'WATCH'];
export const PLAN_POOLS = {
  long: {
    label: 'Long-term picks (Portfolio page)',
    filter: (s) => ideaBase(s) && GOOD3.includes(s.verdict) && (s.quality ?? 0) >= 70 && (s.growth ?? 0) >= 50 && (s.health ?? 0) >= 50 && !(isNum(s.trimAbove) && s.price >= s.trimAbove),
    score: (s) => (s.quality ?? 0) * 0.4 + (s.growth ?? 0) * 0.35 + (s.health ?? 0) * 0.1 + cheapBonus(s) + (s.verdict === 'BUY_STRONG' ? 6 : 0),
  },
  mid: {
    label: 'Medium-term picks (Portfolio page)',
    filter: (s) => ideaBase(s) && GOOD3.includes(s.verdict) && (s.quality ?? 0) >= 60 && (s.health ?? 0) >= 40 && isNum(s.buyBelow) && s.buyBelow > 0 && s.price <= s.buyBelow * 1.1 && isNum(s.upside) && s.upside > 0.1 && !['down', 'weakening'].includes(s.trend),
    score: (s) => Math.min(s.upside, 0.6) * 60 + (s.quality ?? 0) * 0.3 + (s.growth ?? 0) * 0.2,
    takeProfit: true, // medium term: sell at fair value
  },
};
// the page's ideas on month-end k: best score first, at most 2 per sector, n of them, skipping held stocks
export function planIdeas(D, k, poolName, n = 6, skip = null) {
  const P = PLAN_POOLS[poolName];
  const a = [];
  D.comps.forEach((c, ci) => { const s = c.snap[k]; if (P.filter(s) && c.n[k] > 0 && !(skip && skip.has(ci))) a.push([ci, P.score(s), c.sector || 'Other']); });
  a.sort((x, y) => y[1] - x[1]);
  const out = [];
  const per = new Map();
  for (const [ci, , sec] of a) {
    if ((per.get(sec) || 0) >= 2) continue;
    per.set(sec, (per.get(sec) || 0) + 1);
    out.push(ci);
    if (out.length >= n) break;
  }
  return out;
}
// 1,000 AED a month with the page's buying and selling rules. pick 'plan' (the page's ideas) or 'random' (random
// halal stocks the tool could judge, with the same rules). Sale money is reinvested the same way; what no stock can
// take goes to the index fund (SPY here), as on the page.
export function simulatePlan(D, { from, to, monthly = AED_MONTH, pool = 'long', pick = 'plan', seed = 1, minStocks = 10, maxStocks = 12, minOrder = 100, onTrade = null } = {}) {
  const P = PLAN_POOLS[pool];
  const rnd = rng32(seed);
  const pos = new Map(); // ci -> { sh, cost, trimK }
  const last = new Map();
  let cash = 0;
  let fundSh = 0;
  let toFund = 0;
  let fees = 0;
  let buys = 0;
  let sells = 0;
  let sellsBusiness = 0;
  let sellsTrim = 0;
  let sellsProfit = 0;
  let peak = 0;
  let index = 1;
  let worst = 0;
  let prevValue = null;
  const deposits = [];
  const px = (ci, arr, k) => {
    const v = D.comps[ci][arr][k];
    if (v > 0) { last.set(ci, v); return v; }
    return last.get(ci) ?? null;
  };
  const posValue = (ci, arr, k) => { const p = pos.get(ci); const v = p ? px(ci, arr, k) : null; return p && v > 0 ? p.sh * v : 0; };
  const valueAt = (k, arr = 'c') => {
    let v = cash + fundSh * (D.spy[arr][k] || D.spy.c[k] || 0);
    for (const ci of pos.keys()) v += posValue(ci, arr, k);
    return v;
  };
  for (let k = from; k <= to; k++) {
    const v0 = valueAt(k);
    if (prevValue !== null && prevValue > 0) {
      index *= v0 / prevValue;
      peak = Math.max(peak, index);
      worst = Math.min(worst, index / peak - 1);
    } else peak = index;
    if (k === to) break;
    cash += monthly;
    deposits.push([k, monthly]);
    // selling rules on this month-end's analysis, filled at the next session's close
    for (const [ci, p] of [...pos]) {
      const s = D.comps[ci].snap[k];
      const fill = D.comps[ci].n[k];
      const close = D.comps[ci].c[k];
      if (!s || !(fill > 0)) continue;
      let frac = 0;
      let why = '';
      if (s.verdict === 'AVOID_SHARIAH' || s.shariah === 'fail') { frac = 1; why = 'shariah'; }
      else if (SELL_BUSINESS.has(s.verdict)) { frac = 1; why = 'business'; sellsBusiness++; }
      else if (P.takeProfit && isNum(s.fair) && close >= s.fair) { frac = 1; why = 'fair value'; sellsProfit++; }
      else if (isNum(s.trimAbove) && close >= s.trimAbove && k - (p.trimK ?? -99) >= 6) { frac = 0.5; why = 'trim'; sellsTrim++; p.trimK = k; }
      if (!frac) continue;
      const sh = p.sh * frac;
      const value = sh * fill;
      const fee = orderCost(value, fill);
      cash += value - fee;
      fees += fee;
      sells++;
      if (onTrade) onTrade({ k, t: D.comps[ci].t, side: 'sell', why, value, cost: p.cost * frac, verdict: s.verdict });
      if (frac === 1) pos.delete(ci);
      else { p.sh -= sh; p.cost *= 1 - frac; }
    }
    // buying, as the page's monthly plan does: the month's money goes to one place (a new stock while there are
    // fewer than the target number, otherwise the holding furthest below its equal share, otherwise the smallest
    // holding); money from sales is placed the same way, at least a month's worth at a time
    for (let guard = 0; guard < 40 && cash >= minOrder; guard++) {
      const total = valueAt(k, 'n');
      const nTarget = Math.max(minStocks, Math.min(maxStocks, Math.floor(total / 400) || minStocks));
      const each = total / Math.max(nTarget, pos.size || 1);
      const ok = (ci) => { const s = D.comps[ci].snap[k]; return !!s && s.shariah !== 'fail' && s.verdict !== 'AVOID_SHARIAH' && !SELL_BUSINESS.has(s.verdict) && !(isNum(s.trimAbove) && D.comps[ci].c[k] >= s.trimAbove) && D.comps[ci].n[k] > 0; };
      const okList = [...pos.keys()].filter(ok).sort((a, b) => posValue(a, 'n', k) - posValue(b, 'n', k));
      const under = okList.filter((ci) => posValue(ci, 'n', k) < each * 0.8);
      const held = new Set(pos.keys());
      let idea = null;
      if (pick === 'random') {
        const c = [];
        D.comps.forEach((cc, ci) => { if (!held.has(ci) && eligible(cc.snap[k]) && ideaBase(cc.snap[k]) && cc.n[k] > 0) c.push(ci); });
        if (c.length) idea = c[Math.floor(rnd() * c.length)];
      } else idea = planIdeas(D, k, pool, 1, held)[0] ?? null;
      let ci = null;
      if (pos.size < nTarget && idea !== null) ci = idea;
      else if (under.length) ci = under[0];
      else if (okList.length) ci = okList[0];
      else if (idea !== null) ci = idea;
      if (ci === null) break;
      const fill = D.comps[ci].n[k];
      const room = pos.has(ci) ? Math.max(each - posValue(ci, 'n', k), 0) : each;
      const amt = Math.min(cash, Math.max(room, monthly));
      if (amt < minOrder) break;
      const fee = orderCost(amt, fill);
      const sh = (amt - fee) / fill;
      const p = pos.get(ci);
      if (p) { p.sh += sh; p.cost += amt; } else pos.set(ci, { sh, cost: amt, trimK: null });
      last.set(ci, fill);
      cash -= amt;
      fees += fee;
      buys++;
      if (onTrade) onTrade({ k, t: D.comps[ci].t, side: 'buy', value: amt, verdict: D.comps[ci].snap[k]?.verdict });
    }
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
  if (onTrade) for (const [ci, p] of pos) onTrade({ k: to, t: D.comps[ci].t, side: 'hold', value: p.sh * (px(ci, 'c', to) || 0), cost: p.cost });
  return {
    deposited: Math.round(deposited),
    finalValue: Math.round(finalValue),
    gain: r4(finalValue / deposited - 1),
    yearly: r4(xirrMonthly(deposits, finalValue, to)),
    worstFall: r4(worst),
    positions: pos.size,
    fundShare: r4(toFund / Math.max(deposited, 1)),
    buys,
    sells,
    sellsBusiness,
    sellsTrim,
    sellsProfit,
    fees: Math.round(fees),
  };
}
// Set by the rules in PREREGISTERED.md (section 3) from the first run with the data they need, and changed only after
// a review: which picks the long-term part of the Portfolio page uses ('page': its own; 'list': the list in order of
// upside), and which kinds of pick get real money (the short-term picks cannot be tested yet).
export const LONG_METHOD = 'page';
export const POOLS_WITH_MONEY = { long: true, mid: true, short: false };
export function simulatePlanRandom(D, opt, runs = 50) {
  const res = [];
  for (let s = 1; s <= runs; s++) res.push(simulatePlan(D, { ...opt, pick: 'random', seed: 3000 + s }));
  const ys = res.map((r) => r.yearly).filter(isNum);
  const vs = res.map((r) => r.finalValue);
  return { runs, yearly: { p10: r4(quant(ys, 0.1)), median: r4(quant(ys, 0.5)), p90: r4(quant(ys, 0.9)) }, finalValue: { p10: Math.round(quant(vs, 0.1)), median: Math.round(quant(vs, 0.5)), p90: Math.round(quant(vs, 0.9)) } };
}

const fwdBrief = (f) => ({ picks: f.picks, universe: f.universe, spy: f.spy, avgPicks: f.avgPicks, months: f.monthsWithPicks, vsUniverse: f.vsUniverse, vsSpy: f.vsSpy, monthsBeatingUniverse: f.monthsBeatingUniverse });
const simBrief = (p) => ({ yearly: p.yearly, finalValue: p.finalValue, deposited: p.deposited, worstFall: p.worstFall, fundShare: p.fundShare });

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
  // the 12-month test on month-ends before the middle, and from the middle on
  const halves = (pick) => ({ half1: forwardTest(D, { h: 12, from: first, to: mid - 1 + 12, pick }), half2: forwardTest(D, { h: 12, from: mid, pick }) });
  const fh = halves(inShortlist);
  const forwardHalves = { half1: fwdBrief(fh.half1), half2: fwdBrief(fh.half2) };
  const verdictIs = (v) => (s) => s?.verdict === v && s.shariah === 'pass' && bigEnough(s);
  const variants = {
    highData: forwardTest(D, { h: 12, from: first, pick: (s) => inShortlist(s) && s.dq === 'H' }),
    strongBuy: forwardTest(D, { h: 12, from: first, pick: verdictIs('BUY_STRONG') }),
    buy: forwardTest(D, { h: 12, from: first, pick: verdictIs('BUY') }),
    contrarian: forwardTest(D, { h: 12, from: first, pick: verdictIs('CONTRARIAN') }),
    watch: forwardTest(D, { h: 12, from: first, pick: verdictIs('WATCH') }),
    avoidWeak: forwardTest(D, { h: 12, from: first, pick: verdictIs('AVOID_WEAK') }),
  };
  // other ways to build the list, judged by the three checks in PREREGISTERED.md
  const picks = altPicks(D);
  const alternatives = {};
  const beatsRandom = (p, per) => isNum(p.yearly) && isNum(per.random?.yearly?.median) && p.yearly > per.random.yearly.median;
  for (const [name, label] of Object.entries(ALTERNATIVES)) {
    const byK = picks[name];
    const sets = byK.map((a) => (a ? new Set(a) : null));
    const inAlt = (s, k, ci) => !!sets[k] && sets[k].has(ci);
    const chooser = (DD, k) => byK[k] || [];
    const f12 = forwardTest(D, { h: 12, from: first, pick: inAlt });
    const h = halves(inAlt);
    const sim = (from, to) => simBrief(simulate(D, { from, to, rule: 'healthy', pick: chooser }));
    const pf = { full: sim(first, last), half1: sim(first, mid), half2: sim(mid, last) };
    const checks = {
      beatsAverage: isNum(f12.vsUniverse.mean) && f12.vsUniverse.mean > 0 && isNum(f12.vsUniverse.t) && f12.vsUniverse.t >= ALT_T,
      bothHalves: isNum(h.half1.vsUniverse.mean) && h.half1.vsUniverse.mean > 0 && isNum(h.half2.vsUniverse.mean) && h.half2.vsUniverse.mean > 0,
      beatsRandom: beatsRandom(pf.full, full) && beatsRandom(pf.half1, half1) && beatsRandom(pf.half2, half2),
    };
    alternatives[name] = {
      label,
      forward: { h12: fwdBrief(f12), half1: fwdBrief(h.half1), half2: fwdBrief(h.half2) },
      portfolio: pf,
      checks,
      pass: checks.beatsAverage && checks.bothHalves && checks.beatsRandom,
    };
  }
  const passing = Object.entries(alternatives).filter(([, a]) => a.pass).sort((x, y) => y[1].forward.h12.vsUniverse.t - x[1].forward.h12.vsUniverse.t);
  const listDecision = decide({ full, half1, half2, fwd12: forward.h12 });
  // the Portfolio page's own picks, judged by the same rule (PREREGISTERED.md, section 3)
  const plan = {};
  const spyOf = { full: full.spy, half1: half1.spy, half2: half2.spy };
  for (const [name, P] of Object.entries(PLAN_POOLS)) {
    const ideasAt = months.map((_, k) => new Set(planIdeas(D, k, name, 6)));
    const inIdeas = (s, k, ci) => ideasAt[k].has(ci);
    const f12 = forwardTest(D, { h: 12, from: first, pick: inIdeas });
    const hv = halves(inIdeas);
    const per = (from, to, key) => ({ from: months[from], to: months[to], shortlist: simBrief(simulatePlan(D, { from, to, pool: name })), random: simulatePlanRandom(D, { from, to, pool: name }, randomRuns), spy: spyOf[key] });
    const pf = { full: per(first, last, 'full'), half1: per(first, mid, 'half1'), half2: per(mid, last, 'half2') };
    plan[name] = {
      label: P.label,
      forward: { h12: fwdBrief(f12), half1: fwdBrief(hv.half1), half2: fwdBrief(hv.half2) },
      portfolio: pf,
      decision: decide({ full: pf.full, half1: pf.half1, half2: pf.half2, fwd12: f12 }),
    };
  }
  // What the rules in PREREGISTERED.md (section 3) say on this data: the long-term part of the Portfolio page keeps its
  // own picks unless the list did better by rule 1, and a kind of pick whose result is "fund" gets no money. The site
  // follows LONG_METHOD and POOLS_WITH_MONEY, which are only changed after a review, so it does not flip from one
  // monthly run to the next; `review` shows when a run disagrees with them.
  const TIER = { fund: 0, mixed: 1, stocks: 2 };
  const review = {
    longUses: TIER[plan.long.decision.verdict] >= TIER[listDecision.verdict] ? 'page' : 'list',
    midEarns: plan.mid.decision.verdict !== 'fund',
  };
  review.agrees = review.longUses === LONG_METHOD && review.midEarns === POOLS_WITH_MONEY.mid;
  const decision = { ...(LONG_METHOD === 'page' ? plan.long.decision : listDecision), method: LONG_METHOD };
  const pools = { ...POOLS_WITH_MONEY };
  return {
    version: STATS_VERSION,
    companies: D.comps.length,
    from: months[first],
    to: months[last],
    middle: months[mid],
    monthly: Math.round(AED_MONTH),
    forward,
    forwardHalves,
    variants,
    portfolio: { full, half1, half2 },
    alternatives,
    alternativePassed: passing.length ? passing[0][0] : null,
    listDecision,
    plan,
    pools,
    review,
    decision,
  };
}
