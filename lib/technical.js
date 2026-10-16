// Technical analysis on daily candles: trend, momentum, support/resistance, long-only setups and a trade plan.
// Pure functions (no network, no files) so the daily site build, the backtest and the command-line tool share one
// implementation. Built around the "Quality Pullback" toolkit: 21 EMA, 50 SMA, RSI, tiered exits; plus the 200 SMA,
// MACD, ATR, volume. Long-only by design (no short selling), to stay compatible with a Shariah-compliant approach.
//
//   prepare(daily)          indicators for the whole series (once)
//   evaluate(P, i)          the picture and the plan as of bar i, using only data up to bar i
//   simulateTrade(P, i, p)  what the plan from bar i would have done afterwards (used by the backtest and signal log)
//   analyzeTechnical(P)     everything the page shows for the latest bar (accepts prepare() output or daily rows)
//
// A plan is written the evening of signal day i and acted on in the next session only (the site refreshes every
// morning before the US open): pullbacks and reversals use a stop-limit buy just above the signal day's high,
// breakouts and range trades buy at the open with a limit. An order that does not fill simply lapses.

export const TECH_VERSION = '1.3';

const isNum = (x) => typeof x === 'number' && Number.isFinite(x);
const clamp = (x, lo, hi) => Math.max(lo, Math.min(hi, x));
const money = (x) => (isNum(x) ? `$${x >= 1000 ? Math.round(x).toLocaleString('en-US') : x.toFixed(2)}` : 'n/a');

// ---------------------------------------------------------------- indicators
export function sma(values, n) {
  const out = new Array(values.length).fill(null);
  let sum = 0;
  for (let i = 0; i < values.length; i++) {
    sum += values[i];
    if (i >= n) sum -= values[i - n];
    if (i >= n - 1) out[i] = sum / n;
  }
  return out;
}
export function ema(values, n) {
  const out = new Array(values.length).fill(null);
  if (values.length < n) return out;
  const k = 2 / (n + 1);
  let prev = values.slice(0, n).reduce((s, v) => s + v, 0) / n;
  out[n - 1] = prev;
  for (let i = n; i < values.length; i++) {
    prev = values[i] * k + prev * (1 - k);
    out[i] = prev;
  }
  return out;
}
// Wilder's RSI
export function rsi(closes, n = 14) {
  const out = new Array(closes.length).fill(null);
  if (closes.length <= n) return out;
  let gain = 0;
  let loss = 0;
  for (let i = 1; i <= n; i++) {
    const d = closes[i] - closes[i - 1];
    if (d >= 0) gain += d;
    else loss -= d;
  }
  gain /= n;
  loss /= n;
  out[n] = loss === 0 ? 100 : 100 - 100 / (1 + gain / loss);
  for (let i = n + 1; i < closes.length; i++) {
    const d = closes[i] - closes[i - 1];
    gain = (gain * (n - 1) + Math.max(d, 0)) / n;
    loss = (loss * (n - 1) + Math.max(-d, 0)) / n;
    out[i] = loss === 0 ? 100 : 100 - 100 / (1 + gain / loss);
  }
  return out;
}
// Wilder's ATR
export function atr(highs, lows, closes, n = 14) {
  const out = new Array(closes.length).fill(null);
  const tr = closes.map((c, i) =>
    i === 0 ? highs[0] - lows[0] : Math.max(highs[i] - lows[i], Math.abs(highs[i] - closes[i - 1]), Math.abs(lows[i] - closes[i - 1]))
  );
  if (closes.length < n) return out;
  let prev = tr.slice(0, n).reduce((s, v) => s + v, 0) / n;
  out[n - 1] = prev;
  for (let i = n; i < closes.length; i++) {
    prev = (prev * (n - 1) + tr[i]) / n;
    out[i] = prev;
  }
  return out;
}
export function macd(closes, fast = 12, slow = 26, sig = 9) {
  const ef = ema(closes, fast);
  const es = ema(closes, slow);
  const line = closes.map((_, i) => (isNum(ef[i]) && isNum(es[i]) ? ef[i] - es[i] : null));
  const start = line.findIndex(isNum);
  const signal = new Array(closes.length).fill(null);
  if (start >= 0) {
    const sigVals = ema(line.slice(start), sig);
    sigVals.forEach((v, j) => (signal[start + j] = v));
  }
  const hist = line.map((v, i) => (isNum(v) && isNum(signal[i]) ? v - signal[i] : null));
  return { line, signal, hist };
}

// Swing highs/lows over the whole series: a bar whose high (low) is the highest (lowest) within k bars on each side.
// A pivot at bar j is only known k bars later, so evaluate() uses pivots up to i - k.
function allPivots(highs, lows, k) {
  const out = [];
  for (let i = k; i < highs.length - k; i++) {
    let isHigh = true;
    let isLow = true;
    for (let j = i - k; j <= i + k; j++) {
      if (j === i) continue;
      if (highs[j] > highs[i]) isHigh = false;
      if (lows[j] < lows[i]) isLow = false;
      if (!isHigh && !isLow) break;
    }
    if (isHigh) out.push({ i, price: highs[i], kind: 'high' });
    if (isLow) out.push({ i, price: lows[i], kind: 'low' });
  }
  return out;
}
const firstAtOrAfter = (piv, idx) => {
  let lo = 0;
  let hi = piv.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (piv[mid].i < idx) lo = mid + 1;
    else hi = mid;
  }
  return lo;
};

// Group nearby swing points into support/resistance zones
function levels(piv, tol, i) {
  const pts = [...piv].sort((a, b) => a.price - b.price);
  const clusters = [];
  for (const p of pts) {
    const c = clusters[clusters.length - 1];
    if (c && p.price - c.hi <= tol) {
      c.items.push(p);
      c.hi = p.price;
    } else clusters.push({ items: [p], lo: p.price, hi: p.price });
  }
  return clusters.map((c) => {
    const price = c.items.reduce((s, p) => s + p.price, 0) / c.items.length;
    const lastI = Math.max(...c.items.map((p) => p.i));
    const touches = c.items.length;
    const recent = i - lastI <= 60;
    return { price, touches, lastI, score: touches + (recent ? 1 : 0) };
  });
}
const maxOf = (a, from, to) => {
  let m = -Infinity;
  for (let j = Math.max(0, from); j < to; j++) if (a[j] > m) m = a[j];
  return m;
};
const minOf = (a, from, to) => {
  let m = Infinity;
  for (let j = Math.max(0, from); j < to; j++) if (a[j] < m) m = a[j];
  return m;
};

// ---------------------------------------------------------------- prepare
// daily: [{date:'YYYY-MM-DD', o, h, l, c, v}] oldest first (split-adjusted)
export function prepare(daily) {
  const rows = (daily || []).filter((d) => d && isNum(d.c) && d.c > 0 && isNum(d.h) && isNum(d.l));
  if (rows.length < 80) return null;
  const C = rows.map((d) => d.c);
  const H = rows.map((d) => d.h);
  const L = rows.map((d) => d.l);
  const O = rows.map((d) => (isNum(d.o) && d.o > 0 ? d.o : d.c));
  const V = rows.map((d) => (isNum(d.v) ? d.v : 0));
  return {
    rows,
    dates: rows.map((d) => d.date),
    C,
    H,
    L,
    O,
    V,
    n: rows.length,
    e21: ema(C, 21),
    s50: sma(C, 50),
    s200: sma(C, 200),
    r: rsi(C, 14),
    m: macd(C),
    a: atr(H, L, C, 14),
    v50: sma(V, 50),
    piv: allPivots(H, L, 5),
  };
}

const EXITS = {
  trend: [
    'Sell half at target 1, then move the stop up to your entry price (the rest becomes a free trade).',
    'Ride the rest while price holds the 21 EMA; sell it on a daily close below the 21 EMA.',
    'If price hits the stop first, sell everything. Place the stop order when you buy.',
  ],
  reversal: [
    'Sell half at target 1, then move the stop up to your entry price.',
    'Sell the rest at target 2, or on a daily close back below the 21 EMA.',
    'If price hits the stop first, sell everything. Place the stop order when you buy.',
  ],
  range: [
    'Sell half at target 1 (near resistance), then move the stop up to your entry price.',
    'Sell the rest at target 2, or on a daily close back below the 21 EMA.',
    'If price hits the stop first, sell everything: support has broken, so the range trade is wrong.',
  ],
};

// ---------------------------------------------------------------- evaluate (as of bar i)
// Texts (signal explanations and the plan trigger) are functions, so the backtest can skip building them.
export function evaluate(P, i) {
  const { C, H, L, V, e21, s50, s200, r, m, a, v50 } = P;
  const close = C[i];
  const A = a[i] || close * 0.02;
  const E = e21[i];
  const S50 = s50[i];
  const S200 = s200[i];
  const R = r[i];
  const look = Math.min(252, i + 1);
  const hi52 = maxOf(H, i + 1 - look, i + 1);
  const lo52 = minOf(L, i + 1 - look, i + 1);
  const slope50 = isNum(s50[i - 10]) ? S50 / s50[i - 10] - 1 : 0;
  const slope200 = isNum(s200[i - 20]) && isNum(S200) ? S200 / s200[i - 20] - 1 : null;
  const relVol = v50[i] ? V[i] / v50[i] : null;
  let upVol = 0;
  let downVol = 0;
  for (let j = i - 19; j <= i; j++) {
    if (j < 1) continue;
    if (C[j] >= C[j - 1]) upVol += V[j];
    else downVol += V[j];
  }
  const accum = downVol > 0 ? upVol / downVol : null;
  const extATR = isNum(E) ? (close - E) / A : 0;

  // ---- trend
  let trend = 'sideways';
  const fiftyOver200 = !isNum(S200) || S50 > S200;
  if (isNum(S50) && close > S50 && slope50 > 0) trend = fiftyOver200 ? 'up' : 'recovering';
  else if (isNum(S50) && close < S50 && slope50 < 0) trend = fiftyOver200 ? 'weakening' : 'down';
  const strongUp = trend === 'up' && isNum(E) && E > S50 && close > E && close >= hi52 * 0.9;
  const lean = trend === 'sideways' && isNum(S50) && isNum(E) ? (close > S50 && close > E ? 'up' : close < S50 && close < E ? 'down' : null) : null;
  const trendLabel = {
    up: strongUp ? 'Strong uptrend' : 'Uptrend',
    recovering: 'Turning up (recovering)',
    weakening: 'Weakening (below a falling 50 SMA)',
    down: 'Downtrend',
    sideways: lean === 'up' ? 'Sideways, leaning up' : lean === 'down' ? 'Sideways, leaning down' : 'Sideways',
  }[trend];

  // ---- support and resistance (swing points over the last ~1 year that are already confirmed)
  const pFrom = firstAtOrAfter(P.piv, i + 1 - look);
  const pTo = firstAtOrAfter(P.piv, i - 5 + 1);
  const zones = levels(P.piv.slice(pFrom, pTo), Math.max(0.6 * A, close * 0.008), i);
  const supports = zones
    .filter((z) => z.price < close * 0.995 && z.price > close * 0.6)
    .sort((x, y) => y.price - x.price)
    .slice(0, 3);
  const resistances = zones
    .filter((z) => z.price > close * 1.005 && z.price < close * 1.6)
    .sort((x, y) => x.price - y.price)
    .slice(0, 3);
  const nearestSupport = supports[0]?.price ?? null;
  const nearestResistance = resistances[0]?.price ?? null;
  const atHigh = close >= hi52 * 0.985;

  // ---- recent events
  const crossedUp = (x, y, k) => {
    for (let j = i; j > i - k && j > 0; j--) {
      if (isNum(x[j]) && isNum(y[j]) && isNum(x[j - 1]) && isNum(y[j - 1]) && x[j] > y[j] && x[j - 1] <= y[j - 1]) return i - j;
    }
    return -1;
  };
  const crossedDown = (x, y, k) => {
    for (let j = i; j > i - k && j > 0; j--) {
      if (isNum(x[j]) && isNum(y[j]) && isNum(x[j - 1]) && isNum(y[j - 1]) && x[j] < y[j] && x[j - 1] >= y[j - 1]) return i - j;
    }
    return -1;
  };
  const golden = crossedUp(s50, s200, 30);
  const death = crossedDown(s50, s200, 30);
  const macdUp = crossedUp(m.line, m.signal, 5);
  const macdDown = crossedDown(m.line, m.signal, 5);
  let rsiMin15 = Infinity;
  for (let j = Math.max(0, i - 14); j <= i; j++) if (isNum(r[j]) && r[j] < rsiMin15) rsiMin15 = r[j];
  const prior55High = maxOf(H, i - 57, i - 2);
  const prior55Low = minOf(L, i - 57, i - 2);
  const brokeOut = close > prior55High && (C[i - 2] <= prior55High * 1.01 || C[i - 1] <= prior55High * 1.01);
  const low10 = minOf(L, i - 9, i + 1);
  const low15 = minOf(L, i - 14, i + 1);

  // ---- signals
  const sig = [];
  const add = (tone, name, text, weight) => sig.push({ tone, name, text, weight });
  if (isNum(S200)) {
    if (close > S200) add('bull', 'Long-term trend', () => `Price is above the 200-day average (${money(S200)}): the long-term trend is up.`, 10);
    else add('bear', 'Long-term trend', () => `Price is below the 200-day average (${money(S200)}): the long-term trend is down.`, 10);
  }
  if (isNum(S50)) {
    if (close > S50 && slope50 > 0) add('bull', 'Medium-term trend', () => `Above a rising 50-day average (${money(S50)}).`, 8);
    else if (close < S50 && slope50 < 0) add('bear', 'Medium-term trend', () => `Below a falling 50-day average (${money(S50)}).`, 8);
    else add('neutral', 'Medium-term trend', () => `Around the 50-day average (${money(S50)}), which is flat: no clear direction.`, 8);
  }
  if (golden >= 0) add('bull', 'Golden cross', () => `The 50-day average crossed above the 200-day ${golden === 0 ? 'today' : golden + ' days ago'}: a classic sign of a new uptrend.`, 6);
  if (death >= 0) add('bear', 'Death cross', () => `The 50-day average crossed below the 200-day ${death === 0 ? 'today' : death + ' days ago'}: a classic sign of a downtrend.`, 6);
  if (isNum(E) && isNum(S50)) {
    if (E > S50 && close > E) add('bull', '21 EMA', () => `Price is above the 21 EMA (${money(E)}), and the 21 EMA is above the 50 SMA: momentum is on the buyers' side.`, 6);
    else if (close < E && E > S50) add('neutral', '21 EMA', () => `Price dipped below the 21 EMA (${money(E)}) inside an uptrend: this is where pullbacks usually find buyers.`, 6);
    else if (close < E && E < S50) add('bear', '21 EMA', () => `Price is below the 21 EMA (${money(E)}), and the 21 EMA is below the 50 SMA: sellers are in control.`, 6);
  }
  if (isNum(R)) {
    if (R >= 75) add('bear', 'RSI', () => `RSI ${R.toFixed(0)}: overbought. Strong, but a cool-off is likely before the next leg.`, 4);
    else if (R >= 60) add('bull', 'RSI', () => `RSI ${R.toFixed(0)}: strong momentum without being overbought.`, 4);
    else if (R >= 45) add('neutral', 'RSI', () => `RSI ${R.toFixed(0)}: neutral momentum.`, 4);
    else if (R >= 30) add(trend === 'up' ? 'neutral' : 'bear', 'RSI', () => `RSI ${R.toFixed(0)}: momentum has cooled${trend === 'up' ? ', which is normal in a pullback' : ''}.`, 3);
    else add('neutral', 'RSI', () => `RSI ${R.toFixed(0)}: oversold. Selling may be exhausted, but wait for it to turn back up before buying.`, 4);
  }
  if (macdUp >= 0) add('bull', 'MACD', () => `MACD crossed above its signal line ${macdUp === 0 ? 'today' : macdUp + ' days ago'}: momentum is turning up.`, 5);
  else if (macdDown >= 0) add('bear', 'MACD', () => `MACD crossed below its signal line ${macdDown === 0 ? 'today' : macdDown + ' days ago'}: momentum is turning down.`, 5);
  else if (isNum(m.hist[i])) {
    const rising = isNum(m.hist[i - 1]) && m.hist[i] > m.hist[i - 1];
    if (m.hist[i] > 0) add(rising ? 'bull' : 'neutral', 'MACD', () => `MACD is above its signal line${rising ? ' and strengthening' : ' but flattening'}.`, 3);
    else add(rising ? 'neutral' : 'bear', 'MACD', () => `MACD is below its signal line${rising ? ' but improving' : ' and weakening'}.`, 3);
  }
  if (isNum(accum)) {
    if (accum >= 1.4) add('bull', 'Volume', () => `Over the last month, volume on up days was ${accum.toFixed(1)}× volume on down days: buyers are accumulating.`, 4);
    else if (accum <= 0.7) add('bear', 'Volume', () => `Over the last month, volume on down days was ${(1 / accum).toFixed(1)}× volume on up days: sellers are distributing.`, 4);
  }
  if (isNum(relVol) && relVol >= 1.8) {
    const up = C[i] >= C[i - 1];
    add(up ? 'bull' : 'bear', 'Volume spike', () => `Today's volume was ${relVol.toFixed(1)}× its 50-day average on a ${up ? 'rising' : 'falling'} day.`, 3);
  }
  if (atHigh) add('bull', '52-week high', () => `Trading at or near its 52-week high (${money(hi52)}): no sellers stuck at higher prices.`, 4);
  else if (close <= lo52 * 1.08) add('bear', '52-week low', () => `Trading near its 52-week low (${money(lo52)}).`, 4);
  if (brokeOut) add('bull', 'Breakout', () => `Closed above its 3-month high (${money(prior55High)}).`, 4);
  if (close < prior55Low) add('bear', 'Breakdown', () => `Closed below its 3-month low (${money(prior55Low)}).`, 4);
  if (extATR > 2.5) add('bear', 'Stretched', () => `Price is ${extATR.toFixed(1)} ATRs above the 21 EMA: extended, a poor spot to start a new position.`, 3);

  const raw = sig.reduce((s, x) => s + (x.tone === 'bull' ? x.weight : x.tone === 'bear' ? -x.weight : 0), 0);
  const maxW = sig.reduce((s, x) => s + x.weight, 0) || 1;
  const score = Math.round(clamp(50 + (raw / maxW) * 45, 0, 100));
  const label = score >= 70 ? 'Bullish' : score >= 56 ? 'Mildly bullish' : score >= 45 ? 'Neutral' : score >= 31 ? 'Mildly bearish' : 'Bearish';

  // ---- setup and trade plan (long-only)
  const plan = (setup, status, entry, stop, t1, t2, extra = {}) => {
    const risk = isNum(entry) && isNum(stop) ? entry - stop : null;
    const ok = isNum(risk) && risk > 0;
    return {
      setup,
      status,
      entry: isNum(entry) ? round(entry) : null,
      stop: ok ? round(stop) : null,
      target1: ok && isNum(t1) ? round(t1) : null,
      target2: ok && isNum(t2) ? round(t2) : null,
      riskPct: ok ? round(risk / entry, 4) : null,
      maxEntry: ok ? round(entry + 0.5 * risk) : null,
      rr1: ok && isNum(t1) ? round((t1 - entry) / risk, 1) : null,
      rr2: ok && isNum(t2) ? round((t2 - entry) / risk, 1) : null,
      ...extra,
    };
  };
  // stop under the recent swing low (or the 50 SMA when it is close), kept between 1.2 and 3 ATRs of risk
  const stopFor = (entry) => {
    const cands = [low10 - 0.5 * A];
    if (isNum(S50) && S50 < entry && entry - S50 <= 2.5 * A) cands.push(S50 - 0.5 * A);
    const below = cands.filter((x) => x < entry);
    const stop = below.length ? Math.min(...below) : entry - 2 * A;
    return clamp(stop, entry - 3 * A, entry - 1.2 * A);
  };
  // targets: resistance levels 1.5 to 4 risk-units away (T1) and 2.5 to 6 away (T2), else 2R and 3R
  const targetsFor = (entry, stop) => {
    const risk = entry - stop;
    const above = resistances.map((z) => z.price).filter((x) => x > entry);
    if (isNum(hi52) && hi52 > entry && !above.some((x) => Math.abs(x - hi52) < A)) above.push(hi52);
    above.sort((x, y) => x - y);
    const inR = (x, lo, hi) => x - entry >= lo * risk && x - entry <= hi * risk;
    const t1 = above.find((x) => inR(x, 1.5, 4)) ?? entry + 2 * risk;
    const t2 = above.find((x) => x > t1 + 0.5 * risk && inR(x, 2.5, 6)) ?? Math.max(entry + 3 * risk, t1 + risk);
    return [t1, t2];
  };

  const upish = trend === 'up' || trend === 'recovering';
  const zoneLow = isNum(S50) ? Math.min(E, S50) - 0.25 * A : E - A;
  const zoneHigh = isNum(E) ? E + 0.5 * A : close;
  const inPullbackZone = isNum(E) && L[i] <= zoneHigh && close >= zoneLow - 0.5 * A;
  let p;
  if ((upish || trend === 'sideways') && (extATR > 2.5 || R > 75)) {
    // stretched far above the 21 EMA: wait for a pullback
    const entry = E + 0.25 * A;
    const stop = stopFor(entry);
    const [t1, t2] = targetsFor(entry, stop);
    p = plan('extended', 'wait', entry, stop, t1, t2, {
      fill: 'stop',
      zoneLow: round(E - 0.25 * A),
      zoneHigh: round(E + 0.5 * A),
      trigger: () =>
        `${extATR.toFixed(1)} ATRs above the 21 EMA${R > 70 ? `, RSI ${R.toFixed(0)}` : ''}. Don't chase: wait for a pullback toward the 21 EMA (about ${money(E)}), then buy on a daily close back above the prior day's high.`,
    });
  } else if (upish && inPullbackZone && R >= 35 && R <= 58) {
    // the Quality Pullback setup
    const entry = H[i] + 0.01;
    const stop = stopFor(entry);
    const [t1, t2] = targetsFor(entry, stop);
    const confirmed = score >= 45;
    p = plan('pullback', confirmed ? 'active' : 'watch', entry, stop, t1, t2, {
      fill: 'stop',
      zoneLow: round(zoneLow),
      zoneHigh: round(zoneHigh),
      trigger: () =>
        confirmed
          ? `Next session, buy only if price rises above ${money(entry)} (just over today's high): a stop-limit buy order with trigger ${money(entry)} and limit ${money(entry + 0.5 * (entry - stop))}. That shows buyers stepping back in at the 21 EMA / 50 SMA zone. If it does not fill, the signal lapses; the plan updates every morning.${trend === 'recovering' ? ' The long-term trend is still repairing, so use a smaller size.' : ''}`
          : `Signals are mixed (score ${score}/100). No order yet: wait for a stronger day, such as a rise above ${money(H[i])} with MACD turning up.`,
    });
  } else if (brokeOut && (relVol ?? 0) >= 1.3 && trend !== 'down' && trend !== 'weakening') {
    const level = prior55High;
    const entry = close;
    const stop = clamp(level - 1.5 * A, entry - 3 * A, entry - 1.2 * A);
    const [t1, t2] = targetsFor(entry, stop);
    p = plan('breakout', 'active', entry, stop, t1, t2, {
      fill: 'open',
      zoneLow: round(level),
      zoneHigh: round(level + 0.5 * A),
      trigger: () =>
        `Broke above ${money(level)} on ${relVol ? relVol.toFixed(1) + '×' : 'above-average'} volume. Buy at the next open with a limit order at ${money(entry + 0.5 * (entry - stop))}, so a big gap up does not fill (chasing it would make the risk too large). The old high at ${money(level)} should now act as support.`,
    });
  } else if (rsiMin15 < 32 && R > 40 && isNum(E) && close > E && (m.hist[i] ?? 0) > 0) {
    // oversold bounce confirming (counter-trend: smaller size)
    const entry = H[i] + 0.01;
    const stop = clamp(low15 - 0.25 * A, entry - 3.5 * A, entry - 1.2 * A);
    const [t1, t2] = targetsFor(entry, stop);
    // a bounce inside a clear downtrend often fails: only a live signal when the wider picture is not strongly bearish
    const confirmed = score >= 35;
    p = plan('reversal', confirmed ? 'active' : 'watch', entry, stop, t1, t2, {
      fill: 'stop',
      zoneLow: round(E),
      zoneHigh: round(H[i]),
      trigger: () =>
        confirmed
          ? `RSI recovered from ${rsiMin15.toFixed(0)} and price is back above the 21 EMA. Next session, buy only if price rises above ${money(entry)}: a stop-limit buy with trigger ${money(entry)} and limit ${money(entry + 0.5 * (entry - stop))}, with half your usual size (it is against the bigger trend). If it does not fill, the signal lapses.`
          : `RSI recovered from ${rsiMin15.toFixed(0)} and price is back above the 21 EMA, but the trend is still down (score ${score}/100). Wait for a second sign before buying, such as a daily close above the 50 SMA${isNum(S50) ? ` (${money(S50)})` : ''}. If you still take it, use half your usual size.`,
    });
  } else if (trend === 'down') {
    p = plan('downtrend', 'none', null, null, null, null, {
      trigger: () =>
        `No buy setup while the trend is down. Wait for a close back above the 21 EMA (${money(E)}) with RSI recovering above 40, or a reclaim of the 50 SMA (${money(S50)}).`,
    });
  } else if (trend === 'weakening') {
    p = plan('weakening', 'none', null, null, null, null, {
      trigger: () => `No new entry yet. Wait for a daily close back above the 50 SMA (${money(S50)}), or for an oversold reversal to confirm.`,
    });
  } else if (upish) {
    // uptrend, not stretched, not at the buy zone yet
    const entry = E;
    const stop = stopFor(entry);
    const [t1, t2] = targetsFor(entry, stop);
    p = plan('trend', 'watch', entry, stop, t1, t2, {
      fill: 'stop',
      zoneLow: round(zoneLow),
      zoneHigh: round(zoneHigh),
      trigger: () =>
        `Next entry: a pullback into ${money(zoneLow)} to ${money(zoneHigh)} (the 21 EMA / 50 SMA zone)${nearestResistance ? `, or a breakout above ${money(nearestResistance)} on strong volume` : ''}.`,
    });
  } else {
    // sideways: buy near support, sell near resistance
    const s = nearestSupport;
    const res = nearestResistance;
    const pos = isNum(s) && isNum(res) && res > s ? (close - s) / (res - s) : null;
    if (isNum(s) && isNum(res) && close - s <= 1.0 * A && (pos ?? 1) <= 0.35) {
      const entry = Math.max(close, s + 0.2 * A);
      const stop = clamp(s - 1.0 * A, entry - 3 * A, entry - 1.2 * A);
      const [t1, t2] = targetsFor(entry, stop);
      const confirmed = score >= 40 && R >= 38;
      p = plan('range', confirmed ? 'active' : 'watch', entry, stop, t1, t2, {
        fill: 'open',
        zoneLow: round(s),
        zoneHigh: round(s + 0.75 * A),
        trigger: () =>
          confirmed
            ? `It is sitting on support near ${money(s)}. A range trade buys at the next open with a limit order at ${money(entry + 0.5 * (entry - stop))}, and a stop under support: the trade is wrong if price falls to ${money(stop)}.`
            : `Momentum is still weak at support (${money(s)}). Wait for a daily close above the 21 EMA (${money(E)}) before buying.`,
      });
    } else if (isNum(res) && lean === 'up' && score >= 56 && res - close <= 3 * A) {
      const entry = res + 0.1 * A;
      const stop = clamp(res - 1.5 * A, entry - 3 * A, entry - 1.2 * A);
      const [t1, t2] = targetsFor(entry, stop);
      p = plan('breakout', 'watch', entry, stop, t1, t2, {
        fill: 'stop',
        zoneLow: round(res),
        zoneHigh: round(res + 0.5 * A),
        trigger: () =>
          `Buy only on a daily close above ${money(entry)} (just over resistance at ${money(res)}) with volume at least 1.3× normal. Until then there is no edge.`,
      });
    } else {
      p = plan('range', 'none', null, null, null, null, {
        trigger: () =>
          `No edge in the middle of the range. Better entries: near support${isNum(s) ? ` (${money(s)})` : ''} or on a breakout above resistance${isNum(res) ? ` (${money(res)})` : ''}.`,
      });
    }
  }
  p.exits = p.setup === 'range' ? EXITS.range : p.setup === 'reversal' ? EXITS.reversal : EXITS.trend;

  return {
    i,
    close,
    A,
    E,
    S50,
    S200,
    R,
    trend,
    trendLabel,
    lean,
    score,
    label,
    sig,
    setup: p,
    supports,
    resistances,
    hi52,
    lo52,
    slope50,
    slope200,
    relVol,
    accum,
    extATR,
  };
}

// ---------------------------------------------------------------- what the plan from bar i would have done
// The order is for the next session (bar i + 1) only:
//   fill 'stop' (pullback, reversal): fills if that session trades up through plan.entry, at the open when it gaps
//     above; a gap beyond plan.maxEntry (the order's limit) does not fill.
//   fill 'open' (breakout, range): buys at the open, unless it opens above plan.maxEntry or at/below the stop.
// Exits follow the plan as written (see EXITS); gaps fill at the open. On the fill day, and whenever the stop and
// a target fall inside one bar, the stop is assumed to come first (the cautious reading).
// R is gross (before costs): the caller subtracts roundTripCost / riskPct.
export function simulateTrade(P, i, plan, { maxHold = 120 } = {}) {
  const { C, H, L, O, e21, n } = P;
  if (!plan || !isNum(plan.entry) || !isNum(plan.stop) || !isNum(plan.target1) || !(plan.entry > plan.stop)) return { status: 'invalid' };
  const f = i + 1;
  if (f >= n) return { status: 'pending' };
  const maxEntry = isNum(plan.maxEntry) ? plan.maxEntry : plan.entry + 0.5 * (plan.entry - plan.stop);
  let entry;
  if (plan.fill === 'open') {
    if (O[f] > maxEntry || O[f] <= plan.stop) return { status: 'skipped', day: f };
    entry = O[f];
  } else {
    if (H[f] < plan.entry) return { status: 'nofill', day: f };
    if (O[f] > maxEntry) return { status: 'skipped', day: f };
    entry = Math.max(O[f], plan.entry);
  }
  const stop0 = plan.stop;
  const risk = entry - stop0;
  const t1 = plan.target1;
  const t2 = isNum(plan.target2) ? plan.target2 : Infinity;
  const keepsRunning = plan.setup !== 'reversal' && plan.setup !== 'range'; // trend trades trail the 21 EMA, the others take target 2
  let half = false;
  let stop = stop0;
  let r1 = 0;
  const out = (status, k, px, R) => ({ status, fillIdx: f, entry, risk, riskPct: risk / entry, exitIdx: k, exitPx: px, R, hitT1: half, days: k - f });
  const rest = (px) => (half ? r1 + (0.5 * (px - entry)) / risk : (px - entry) / risk);
  for (let k = f; k < n; k++) {
    const first = k === f; // the fill happens during this bar, so its open is already behind us
    if (!first && !half && O[k] >= t1) {
      r1 = (0.5 * (O[k] - entry)) / risk;
      half = true;
      stop = Math.max(stop, entry);
    }
    if (L[k] <= stop) {
      const px = !first && O[k] < stop ? O[k] : stop;
      return out('closed', k, px, rest(px));
    }
    if (!half && H[k] >= t1) {
      r1 = (0.5 * (t1 - entry)) / risk;
      half = true;
      stop = Math.max(stop, entry);
    }
    if (half && !keepsRunning && H[k] >= t2) {
      const px = !first && O[k] > t2 ? O[k] : t2;
      return out('closed', k, px, rest(px));
    }
    if (half && isNum(e21[k]) && C[k] < e21[k]) return out('closed', k, C[k], rest(C[k]));
    if (k - f >= maxHold) return out('closed', k, C[k], rest(C[k]));
  }
  return { ...out('open', null, C[n - 1], rest(C[n - 1])), days: n - 1 - f };
}

// ---------------------------------------------------------------- main
// ctx (optional): { fundamental: { verdict, shariah, buyBelow, fair, bear, bull } }
export function analyzeTechnical(input, ctx = {}) {
  const P = input && Array.isArray(input.C) ? input : prepare(input);
  if (!P) return { ok: false, reason: 'history', error: 'Not enough daily price history for technical analysis.' };
  const { rows, C, O, V, e21, s50, s200, r, m, n } = P;
  const i = n - 1;
  const ev = evaluate(P, i);
  const { close, A, E, S50, S200, R, trend, trendLabel, score, label, supports, resistances, hi52, lo52 } = ev;
  const p = ev.setup;
  if (typeof p.trigger === 'function') p.trigger = p.trigger();

  // ---- guidance (combines the chart with the fundamentals when available)
  const guidance = buildGuidance(p, trend, ctx.fundamental || null, { close, E, S50 });

  // ---- performance over standard windows (for relative strength)
  const ret = (k) => (i - k >= 0 && C[i - k] > 0 ? round(close / C[i - k] - 1, 4) : null);

  // ---- chart data: last ~1 year, rounded
  const W = Math.min(260, n);
  const s = n - W;
  const dp = close >= 1 ? 2 : 4;
  const rd = (x) => (isNum(x) ? Number(x.toFixed(dp)) : null);
  const rd1 = (x) => (isNum(x) ? Number(x.toFixed(1)) : null);
  const rd3 = (x) => (isNum(x) ? Number(x.toPrecision(4)) : null);
  const chart = {
    candles: rows.slice(s).map((d, j) => [d.date, rd(O[s + j]), rd(d.h), rd(d.l), rd(d.c), Math.round(V[s + j])]),
    ema21: e21.slice(s).map(rd),
    sma50: s50.slice(s).map(rd),
    sma200: s200.slice(s).map(rd),
    rsi: r.slice(s).map(rd1),
    macd: m.line.slice(s).map(rd3),
    signal: m.signal.slice(s).map(rd3),
    hist: m.hist.slice(s).map(rd3),
    markers: chartMarkers(P, s, n),
  };

  return {
    ok: true,
    version: TECH_VERSION,
    asOf: rows[i].date,
    close: round(close),
    trend,
    trendLabel,
    score,
    label,
    setup: p,
    guidance,
    levels: {
      supports: supports.map((z) => ({ price: round(z.price), touches: z.touches, distPct: round(z.price / close - 1, 4) })),
      resistances: resistances.map((z) => ({ price: round(z.price), touches: z.touches, distPct: round(z.price / close - 1, 4) })),
      high52: round(hi52),
      low52: round(lo52),
    },
    indicators: {
      ema21: round(E),
      sma50: round(S50),
      sma200: round(S200),
      rsi: isNum(R) ? Math.round(R) : null,
      macd: rd3(m.line[i]),
      macdSignal: rd3(m.signal[i]),
      atr: round(A),
      atrPct: round(A / close, 4),
      relVolume: isNum(ev.relVol) ? round(ev.relVol, 2) : null,
      upDownVolume: isNum(ev.accum) ? round(ev.accum, 2) : null,
      slope50: round(ev.slope50, 4),
      slope200: isNum(ev.slope200) ? round(ev.slope200, 4) : null,
      extensionAtr: round(ev.extATR, 2),
    },
    perf: { r1m: ret(21), r3m: ret(63), r6m: ret(126), r12m: ret(252) },
    signals: ev.sig.map(({ tone, name, text }) => ({ tone, name, text: typeof text === 'function' ? text() : text })),
    chart,
  };
}

function round(x, d = 2) {
  if (!isNum(x)) return null;
  const f = 10 ** d;
  return Math.round(x * f) / f;
}

function chartMarkers(P, s, n) {
  const out = [];
  const { C, H, r, s50, s200, V, v50 } = P;
  let lastOversold = -99;
  for (let j = Math.max(s, 1); j < n; j++) {
    if (s50[j] != null && s200[j] != null && s50[j - 1] != null && s200[j - 1] != null) {
      if (s50[j] > s200[j] && s50[j - 1] <= s200[j - 1]) out.push({ i: j - s, kind: 'golden', text: 'Golden cross' });
      if (s50[j] < s200[j] && s50[j - 1] >= s200[j - 1]) out.push({ i: j - s, kind: 'death', text: 'Death cross' });
    }
    if (j >= 58) {
      const ph = maxOf(H, j - 55, j);
      if (C[j] > ph && C[j - 1] <= ph && v50[j] && V[j] >= 1.3 * v50[j]) out.push({ i: j - s, kind: 'breakout', text: 'Breakout' });
    }
    if (r[j] != null && r[j - 1] != null && r[j - 1] < 30 && r[j] >= 30 && j - lastOversold > 10) {
      out.push({ i: j - s, kind: 'oversold', text: 'RSI turns up from oversold' });
      lastOversold = j;
    }
  }
  return out.slice(-25);
}

function buildGuidance(p, trend, f, v) {
  const lines = [];
  const watchText = {
    pullback: 'The chart has pulled back to the 21 EMA / 50 SMA zone, but the other signals are mixed.',
    breakout: 'The chart is moving sideways just under resistance.',
    range: 'The chart is moving sideways and sitting on support.',
    reversal: 'The chart shows an oversold bounce, but the downtrend is not over yet.',
  };
  const setupText = (p.status === 'watch' && watchText[p.setup]) || {
    pullback: 'The chart is in a Quality Pullback buy zone: an uptrend cooling off at the 21 EMA / 50 SMA.',
    breakout: 'The chart just broke out to a 3-month high on strong volume.',
    reversal: 'The chart shows an oversold bounce that is starting to confirm.',
    extended: 'The price is stretched far above the 21 EMA after a strong run.',
    trend: 'The trend is up, but the price is between buy points.',
    downtrend: 'The chart is in a downtrend.',
    weakening: 'The uptrend is weakening: price slipped below a falling 50-day average.',
    range: 'The chart is moving sideways.',
  }[p.setup];
  lines.push(setupText);
  if (!f) return lines.join(' ');
  if (f.shariah === 'fail') {
    lines.push('It fails the Shariah screen, so there is no trade plan here: it is not one for your portfolio.');
    return lines.join(' ');
  }
  const cheap = ['BUY_STRONG', 'BUY', 'CONTRARIAN'].includes(f.verdict);
  const pricey = f.verdict === 'WATCH';
  const mixed = f.verdict === 'LOOK';
  const live = p.status === 'active';
  const falling = p.setup === 'downtrend' || p.setup === 'weakening';
  const buyBelow = isNum(f.buyBelow) ? money(f.buyBelow) : null;
  if (live && cheap) {
    lines.push(`Fundamentals agree: a good business at a sensible price. Swing traders can follow the plan below; long-term buyers can start a position${buyBelow && v.close > f.buyBelow ? ` and add more below ${buyBelow}` : ''}.`);
  } else if (live && pricey) {
    lines.push(`The business is priced above fair value${isNum(f.fair) ? ` (about ${money(f.fair)})` : ''}, so treat this as a short-term trade only, with smaller size, or wait for the long-term buy zone${buyBelow ? ` below ${buyBelow}` : ''}.`);
  } else if (live && mixed) {
    lines.push('The fundamentals are mixed (see the Fundamental tab), so keep the trade small and respect the stop.');
  } else if (live) {
    lines.push('The fundamentals are weak or unclear, so this is a pure chart trade: keep it small and respect the stop.');
  } else if (falling && cheap) {
    lines.push(`The business looks good value, but the chart is still falling. Long-term buyers can buy in small steps${buyBelow ? ` below ${buyBelow}` : ''}; swing traders should wait for the signal in the plan below.`);
  } else if (falling) {
    lines.push('With the fundamentals not offering a bargain either, there is no reason to step in yet.');
  } else if (cheap) {
    lines.push(`The business looks good value${buyBelow ? ` (long-term buy zone below ${buyBelow})` : ''}. For swing timing, wait for the signal in the plan below.`);
  } else if (pricey) {
    lines.push(`The business is strong but priced above fair value${isNum(f.fair) ? ` (about ${money(f.fair)})` : ''}, so any swing trade should be small and short-term.`);
  } else if (mixed) {
    lines.push('The fundamentals are mixed (see the Fundamental tab), so any trade should be small.');
  } else {
    lines.push('The fundamentals are weak or unclear, so any trade here would be a pure chart trade: keep it small.');
  }
  if (f.shariah === 'review') lines.push('Confirm its halal status before buying.');
  return lines.join(' ');
}

// The fundamental facts the technical guidance needs, taken from an engine result
export function techContextFrom(result) {
  if (!result || !result.ok) return {};
  return {
    fundamental: {
      verdict: result.verdict?.code || null,
      shariah: result.labels?.shariah?.status || null,
      buyBelow: result.pricePlan?.buyBelow ?? result.fairValue?.buyBelow ?? null,
      fair: result.fairValue?.base ?? null,
      bear: result.fairValue?.bear ?? null,
      bull: result.fairValue?.bull ?? null,
    },
  };
}
