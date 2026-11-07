// Swing opportunity scanner (stage 8 of the robo-advisor plan, November 2026).
//
// What it is: a list of setup candidates for trades that last days to weeks, taken from the chart analysis the site already
// makes every night (lib/technical.js), checked against hard data gates and ranked by a fixed evidence checklist. It adds
// only what the chart analysis does not have: weekly candles, Bollinger Bands, average dollar volume, the change in
// relative strength, and an explanation of why a stock is listed and what would make the setup wrong. Entry, stop,
// targets and risk/reward are the chart analysis' own numbers: nothing here prices a trade.
//
// What it is not: a buy signal, a prediction or a recommendation. It never orders anything. Every candidate is a paper
// trade idea until the live record passes its gate (the page decides that, not this file), and a candidate is not
// Shariah approved: the automated screen is an early warning, and the page also asks for a current Zoya check in the
// Shariah ledger before it calls anything tradable.
//
// Ranking: by the evidence score below (fixed weights, written before any result was looked at), never by a predicted
// or past return. Ties are broken by the number of checks met, then alphabetically. The weights and thresholds in this
// file are not tuned to results: changing one is a new version of the scanner (SCAN_VERSION) and is documented.
//
// A stock is left out, with the reason recorded, when a critical piece of data is missing, old or unreliable.
//
// Pure functions: no network, no files. Imports only the indicators of lib/technical.js.
import { sma, ema, rsi, macd } from './technical.js';

export const SCAN_VERSION = '1.0';

const isNum = (x) => typeof x === 'number' && Number.isFinite(x);

// ---------------------------------------------------------------- the fixed rules
export const SCAN_RULES = Object.freeze({
  // data gates: any failure removes the stock from the list
  minDailyBars: 300, // about 60 weeks: enough for the 200-day average, the 52-week range and 50 weekly bars
  minPrice: 5, // dollars
  minAdvUsd: 10e6, // 50-day average dollar volume (price x shares traded)
  maxAtrPct: 0.08, // average daily range above 8% of the price: too wild for the stop rules to mean anything
  maxRiskPct: 0.15, // the chart analysis' stop is more than 15% below the entry: too wide for a swing trade
  earningsBlockDays: 7, // weekdays: earnings this close fall inside a swing trade, so no setup is listed
  earningsCalendarMaxFailedDays: 3, // days of the earnings calendar that could not be read before it counts as unreliable
  // evidence thresholds
  rsStrong: 70, // relative strength rank (1 to 99)
  rsMomentum: 80, // a momentum setup needs a leader
  rsRise: 5, // rank points gained over rsLookback sessions
  rsLookback: 21,
  rrMin: 2, // reward to the first target / risk to the stop
  extendedAtr: 1.5, // ATRs above the 21 EMA
  rsiLow: 40,
  rsiHigh: 70,
  accumMin: 1.2, // volume on up days / volume on down days, last 20 sessions
  spikeMin: 1.5, // today's volume / 50-day average, on an up day
  accumFlag: 1.4,
  unusualVolume: 2,
  pctBMax: 0.8, // price at most 80% of the way up the Bollinger Bands
  squeezeLook: 120, // sessions the band width is compared with
  squeezeWindow: 20, // sessions before the signal in which the bands were narrowest
  squeezeQuantile: 0.25,
  eventClearDays: 15, // weekdays to the next earnings date for the event check to pass
  nearHigh: 0.05, // a momentum setup is within 5% of its 52-week high
  weeklyKeep: 156, // weekly bars sent to the chart (three years)
  dailyKeep: 260, // daily bars of Bollinger Bands sent to the chart (the same window as the daily chart)
  listMax: 300, // most candidates written to the page file
});

// The evidence checklist: 11 checks, 100 points. A check that is not met, or cannot be worked out, scores nothing.
export const SCAN_WEIGHTS = Object.freeze([
  { key: 'weekly', label: 'Weekly trend agrees', weight: 15, rule: 'The last completed weekly close is above a rising 50-week average.' },
  { key: 'daily', label: 'Daily trend and structure', weight: 15, rule: 'Price is above a rising 50-day average, and the 50-day is above the 200-day.' },
  { key: 'rs', label: 'Strong relative strength', weight: 15, rule: 'Relative strength rank is 70 or higher (1 to 99, against every stock the site screens).' },
  { key: 'rsRising', label: 'Relative strength improving', weight: 10, rule: 'The rank is at least 5 points higher than 21 sessions ago.' },
  { key: 'volume', label: 'Volume supports the setup', weight: 10, rule: 'Volume on up days is at least 1.2 times volume on down days over 20 sessions, or today is an up day on 1.5 times normal volume.' },
  { key: 'rr', label: 'Reward is at least twice the risk', weight: 10, rule: 'The first target is at least 2 times as far from the entry as the stop is.' },
  { key: 'notExtended', label: 'Not stretched', weight: 5, rule: 'Price is no more than 1.5 ATRs above the 21 EMA.' },
  { key: 'momentum', label: 'Momentum healthy', weight: 5, rule: 'RSI is between 40 and 70, and the MACD histogram is above zero or rising.' },
  { key: 'bands', label: 'Bollinger Bands agree', weight: 5, rule: 'Pullbacks, reversals and momentum: price is no more than 80% of the way up the bands. Breakouts: the bands were narrow (lowest quarter of 120 sessions) in the 20 sessions before.' },
  { key: 'events', label: 'No earnings soon', weight: 5, rule: 'The next earnings date is known to be at least 15 weekdays away, or the calendar shows none in the next 60 weekdays.' },
  { key: 'regime', label: 'Market trend supportive', weight: 5, rule: 'The S&P 500 ETF is above its 200-day average with the 50-day above the 200-day.' },
]);

export const SETUP_LABEL = Object.freeze({
  pullback: 'Pullback',
  breakout: 'Breakout',
  reversal: 'Trend reversal',
  momentum: 'Momentum',
});

// ---------------------------------------------------------------- indicators the chart analysis does not have
// Bollinger Bands: a simple average of n closes, plus and minus k population standard deviations.
export function bollinger(values, n = 20, k = 2) {
  const mid = sma(values, n);
  const upper = new Array(values.length).fill(null);
  const lower = new Array(values.length).fill(null);
  for (let i = n - 1; i < values.length; i++) {
    let s = 0;
    for (let j = i - n + 1; j <= i; j++) s += (values[j] - mid[i]) ** 2;
    const sd = Math.sqrt(s / n);
    upper[i] = mid[i] + k * sd;
    lower[i] = mid[i] - k * sd;
  }
  return { mid, upper, lower };
}

// Monday of the week of an ISO date
function weekStart(date) {
  const d = new Date(date + 'T00:00:00Z');
  const back = (d.getUTCDay() + 6) % 7;
  d.setUTCDate(d.getUTCDate() - back);
  return d.toISOString().slice(0, 10);
}
const weekday = (date) => new Date(date + 'T00:00:00Z').getUTCDay(); // 0 Sunday ... 5 Friday

// Weekly candles from daily ones (oldest first). A week is Monday to Friday; its date is its last trading day. The last
// week is marked partial unless its last session is a Friday (a week that ends early for a holiday is treated as partial:
// the cautious reading).
export function weekly(daily) {
  const rows = (daily || []).filter((d) => d && isNum(d.c) && d.c > 0 && isNum(d.h) && isNum(d.l));
  const out = [];
  let cur = null;
  let key = '';
  for (const d of rows) {
    const k = weekStart(d.date);
    if (k !== key) {
      if (cur) out.push(cur);
      cur = { date: d.date, o: isNum(d.o) && d.o > 0 ? d.o : d.c, h: d.h, l: d.l, c: d.c, v: isNum(d.v) ? d.v : 0, days: 1 };
      key = k;
    } else {
      cur.date = d.date;
      cur.h = Math.max(cur.h, d.h);
      cur.l = Math.min(cur.l, d.l);
      cur.c = d.c;
      cur.v += isNum(d.v) ? d.v : 0;
      cur.days++;
    }
  }
  if (cur) out.push(cur);
  if (out.length) out[out.length - 1].partial = weekday(out[out.length - 1].date) !== 5;
  return out;
}

// Weekly picture: the chart series (last weeklyKeep bars, indicators worked out on the whole history) and the weekly trend
// on the last COMPLETED week. Returns null when there is not enough history.
export function weeklyAnalysis(daily, rules = SCAN_RULES) {
  const bars = weekly(daily);
  if (bars.length < 60) return null;
  const C = bars.map((b) => b.c);
  const e21 = ema(C, 21);
  const s50 = sma(C, 50);
  const s200 = sma(C, 200);
  const r = rsi(C, 14);
  const bb = bollinger(C, 20, 2);
  const n = bars.length;
  const k = bars[n - 1].partial ? n - 2 : n - 1; // last completed week
  let trend = null;
  if (isNum(s50[k]) && isNum(s50[k - 4])) {
    if (C[k] > s50[k] && s50[k] > s50[k - 4]) trend = 'up';
    else if (C[k] < s50[k] && s50[k] < s50[k - 4]) trend = 'down';
    else trend = 'mixed';
  }
  const keep = Math.min(rules.weeklyKeep, n);
  const s = n - keep;
  const dp = C[n - 1] >= 1 ? 2 : 4;
  const rd = (x) => (isNum(x) ? Number(x.toFixed(dp)) : null);
  const rd1 = (x) => (isNum(x) ? Number(x.toFixed(1)) : null);
  return {
    trend,
    asOfWeek: bars[k].date,
    partial: !!bars[n - 1].partial,
    close: rd(C[k]),
    sma50: rd(s50[k]),
    ema21: rd(e21[k]),
    chart: {
      candles: bars.slice(s).map((b) => [b.date, rd(b.o), rd(b.h), rd(b.l), rd(b.c), Math.round(b.v)]),
      ema21: e21.slice(s).map(rd),
      sma50: s50.slice(s).map(rd),
      sma200: s200.slice(s).map(rd),
      bbUpper: bb.upper.slice(s).map(rd),
      bbMid: bb.mid.slice(s).map(rd),
      bbLower: bb.lower.slice(s).map(rd),
      rsi: r.slice(s).map(rd1),
      partialLast: !!bars[n - 1].partial,
    },
  };
}

// Daily Bollinger Bands for the chart's window (aligned with the last dailyKeep candles of the chart analysis)
export function dailyBands(closes, rules = SCAN_RULES) {
  const bb = bollinger(closes, 20, 2);
  const n = closes.length;
  const s = Math.max(0, n - rules.dailyKeep);
  const dp = closes[n - 1] >= 1 ? 2 : 4;
  const rd = (x) => (isNum(x) ? Number(x.toFixed(dp)) : null);
  return { upper: bb.upper.slice(s).map(rd), mid: bb.mid.slice(s).map(rd), lower: bb.lower.slice(s).map(rd) };
}

// What the scanner needs from the daily series beyond the chart analysis: liquidity and the band position.
// P is lib/technical.js prepare() output.
export function features(P, rules = SCAN_RULES) {
  const { C, V, n } = P;
  const i = n - 1;
  let usd = 0;
  let cnt = 0;
  for (let j = Math.max(0, i - 49); j <= i; j++) {
    if (isNum(V[j]) && V[j] > 0 && isNum(C[j])) {
      usd += V[j] * C[j];
      cnt++;
    }
  }
  const advUsd = cnt >= 40 ? usd / cnt : null; // fewer than 40 sessions with volume: unknown
  const bb = bollinger(C, 20, 2);
  const width = C.map((c, j) => (isNum(bb.mid[j]) && bb.mid[j] > 0 ? (bb.upper[j] - bb.lower[j]) / bb.mid[j] : null));
  const pctB = isNum(bb.upper[i]) && bb.upper[i] > bb.lower[i] ? (C[i] - bb.lower[i]) / (bb.upper[i] - bb.lower[i]) : null;
  // a squeeze: the narrowest band width of the last squeezeWindow sessions is in the lowest quarter of the last squeezeLook sessions
  const hist = width.slice(Math.max(0, i - rules.squeezeLook + 1), i + 1).filter(isNum).sort((a, b) => a - b);
  let squeeze = null;
  if (hist.length >= rules.squeezeLook * 0.8) {
    const recent = width.slice(Math.max(0, i - rules.squeezeWindow + 1), i + 1).filter(isNum);
    if (recent.length) {
      const q = hist[Math.floor(rules.squeezeQuantile * (hist.length - 1))];
      squeeze = Math.min(...recent) <= q;
    }
  }
  return { advUsd, pctB: isNum(pctB) ? pctB : null, bandWidth: isNum(width[i]) ? width[i] : null, squeeze, macdHist: P.m.hist[i], macdHistPrev: P.m.hist[i - 1] };
}

// ---------------------------------------------------------------- relative strength change
// rankerAt(rsData, dateInt, weighted): a function that turns a weighted return into a rank 1 to 99 among every stock that
// traded that day. rsData: [{d: Int32Array of YYYYMMDD, c: Float64Array of closes}] (holes allowed). weighted(c, j) as in lib/backtest.js.
export function rankerAt(rsData, dateInt, weighted) {
  const vals = [];
  for (const s of rsData) {
    if (!s) continue;
    const j = indexOfDate(s.d, dateInt);
    if (j >= 252) vals.push(weighted(s.c, j));
  }
  const sorted = Float64Array.from(vals).sort();
  if (sorted.length < 100) return null; // too few stocks to rank against: unknown, never guessed
  return (w) => {
    let lo = 0;
    let hi = sorted.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (sorted[mid] < w) lo = mid + 1;
      else hi = mid;
    }
    return Math.max(1, Math.min(99, Math.round(((lo + 0.5) / sorted.length) * 100)));
  };
}
export function indexOfDate(arr, v) {
  let lo = 0;
  let hi = arr.length - 1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (arr[mid] === v) return mid;
    if (arr[mid] < v) lo = mid + 1;
    else hi = mid - 1;
  }
  return -1;
}

// ---------------------------------------------------------------- one stock
const money = (x) => (isNum(x) ? `$${x >= 1000 ? Math.round(x).toLocaleString('en-US') : x.toFixed(2)}` : 'n/a');

// What kind of setup is this, if any? Only the chart analysis' own setups count; 'momentum' is a leader in a strong uptrend
// that the chart analysis has not yet given a buy point (its 'trend' setup: the entry is its pullback zone).
export function classify(tech, rs, rules = SCAN_RULES) {
  const s = tech.setup;
  if (!s) return null;
  if ((s.setup === 'pullback' || s.setup === 'breakout' || s.setup === 'reversal') && (s.status === 'active' || s.status === 'watch')) return s.setup;
  if (s.setup === 'trend' && tech.trendLabel === 'Strong uptrend' && isNum(rs) && rs >= rules.rsMomentum && tech.levels && tech.levels.high52 && tech.close >= tech.levels.high52 * (1 - rules.nearHigh)) return 'momentum';
  return null;
}

// in: {
//   ticker, name, sector, capM,
//   tech        analyzeTechnical() result (ok)
//   feats       features()
//   wk          weeklyAnalysis() or null
//   shariah     'pass' | 'fail' | 'check' (the automated screen)
//   dq          data quality level of the company analysis ('high', 'limited', 'insufficient') or null
//   rs, rsPrev  relative strength rank now and rules.rsLookback sessions ago (null when unknown)
//   earn        {date, time} or null; earnDays weekdays to it or null
//   earningsCal 'ok' | 'partial' | 'unavailable'
//   regime      'up' | 'mixed' | 'down' | null
//   priceDate   the modal last-session date of the whole run
//   bars        number of daily bars in the history
// }
// Returns { listed: candidate } or { blocked: {ticker, name, setup, reasons} } or { none: reason } (no setup at all).
export function scanStock(inp, rules = SCAN_RULES) {
  const { tech, feats, wk } = inp;
  if (!tech || !tech.ok) return { none: 'no chart analysis' };
  const type = classify(tech, inp.rs, rules);
  if (!type) return { none: 'no setup' };
  const s = tech.setup;
  const I = tech.indicators;

  // ---- gates: critical data must be present, fresh and reliable
  const gates = [];
  const gate = (key, ok, bad) => gates.push({ key, ok: !!ok, detail: ok ? '' : bad });
  gate('shariah', inp.shariah === 'pass', inp.shariah === 'fail' ? 'fails the automated Shariah screen' : 'the automated Shariah screen needs checking');
  gate('quality', inp.dq && inp.dq !== 'insufficient', 'the company data is missing or insufficient');
  gate('fresh', inp.priceDate && tech.asOf === inp.priceDate, `last price is ${tech.asOf || 'unknown'}, not the run's ${inp.priceDate || 'date'}`);
  gate('history', inp.bars >= rules.minDailyBars, `only ${inp.bars || 0} daily bars of history (needs ${rules.minDailyBars})`);
  gate('weekly', !!wk && wk.trend !== null, 'not enough weekly history');
  gate('price', isNum(tech.close) && tech.close >= rules.minPrice, `price is below $${rules.minPrice}`);
  gate('liquidity', feats && isNum(feats.advUsd) && feats.advUsd >= rules.minAdvUsd, feats && isNum(feats.advUsd) ? `average daily dollar volume is $${(feats.advUsd / 1e6).toFixed(1)}M, below $${rules.minAdvUsd / 1e6}M` : 'trading volume is unknown');
  gate('volatility', isNum(I.atrPct) && I.atrPct <= rules.maxAtrPct, isNum(I.atrPct) ? `daily range ${(I.atrPct * 100).toFixed(1)}% of price is above ${rules.maxAtrPct * 100}%` : 'volatility is unknown');
  gate('plan', [s.entry, s.stop, s.target1, s.riskPct, s.rr1].every(isNum) && s.entry > s.stop, 'the chart analysis has no complete entry, stop and target');
  gate('risk', isNum(s.riskPct) && s.riskPct <= rules.maxRiskPct, isNum(s.riskPct) ? `the stop is ${(s.riskPct * 100).toFixed(0)}% below the entry, wider than ${rules.maxRiskPct * 100}%` : 'risk is unknown');
  gate('indicators', [I.rsi, I.ema21, I.sma50, I.atr].every(isNum), 'an indicator is missing');
  gate('calendar', inp.earningsCal !== 'unavailable', 'the earnings calendar could not be read, so earnings risk is unknown');
  gate('earnings', !(isNum(inp.earnDays) && inp.earnDays <= rules.earningsBlockDays), isNum(inp.earnDays) ? `earnings in ${inp.earnDays} weekdays (${inp.earn.date}) fall inside a swing trade` : '');
  const failed = gates.filter((g) => !g.ok);
  if (failed.length) return { blocked: { ticker: inp.ticker, name: inp.name, setup: type, reasons: failed.map((g) => g.detail) } };

  // ---- the evidence checklist
  const spikeUp = isNum(I.relVolume) && I.relVolume >= rules.spikeMin && lastUp(tech);
  const histNow = feats.macdHist;
  const histUp = isNum(histNow) && (histNow > 0 || (isNum(feats.macdHistPrev) && histNow > feats.macdHistPrev));
  const dailyUp = tech.trend === 'up' && isNum(I.sma200) && I.sma50 > I.sma200;
  const ev = {};
  const put = (key, met, detail) => (ev[key] = { met, detail });
  put('weekly', wk.trend === 'up', wk.trend === 'up' ? `Weekly close ${money(wk.close)} is above a rising 50-week average (${money(wk.sma50)}).` : `Weekly trend is ${wk.trend === 'down' ? 'down' : 'not clearly up'} (weekly close ${money(wk.close)}, 50-week average ${money(wk.sma50)}).`);
  put('daily', dailyUp, dailyUp ? `Above a rising 50-day average (${money(I.sma50)}), which is above the 200-day (${money(I.sma200)}).` : `The daily trend is ${tech.trendLabel.toLowerCase()}, so it is not a clean uptrend.`);
  put('rs', isNum(inp.rs) ? inp.rs >= rules.rsStrong : null, isNum(inp.rs) ? `Relative strength rank ${inp.rs} of 99.` : 'Relative strength is not available.');
  const rsGain = isNum(inp.rs) && isNum(inp.rsPrev) ? inp.rs - inp.rsPrev : null;
  put('rsRising', rsGain === null ? null : rsGain >= rules.rsRise, rsGain === null ? 'The change in relative strength is not available.' : `Relative strength rank ${rsGain >= 0 ? 'rose' : 'fell'} ${Math.abs(rsGain)} points in ${rules.rsLookback} sessions (${inp.rsPrev} to ${inp.rs}).`);
  const accum = I.upDownVolume;
  const volOk = (isNum(accum) && accum >= rules.accumMin) || spikeUp;
  put('volume', !!volOk, volOk ? (isNum(accum) && accum >= rules.accumMin ? `Volume on up days is ${accum.toFixed(1)} times volume on down days over the last 20 sessions.` : `Today was an up day on ${I.relVolume.toFixed(1)} times normal volume.`) : `Volume does not confirm: up-day to down-day volume is ${isNum(accum) ? accum.toFixed(1) : 'n/a'}.`);
  const rr = s.rr1;
  put('rr', rr >= rules.rrMin, `Reward to the first target is ${rr.toFixed(1)} times the risk to the stop.`);
  const ext = isNum(I.ema21) && isNum(I.atr) && I.atr > 0 ? (tech.close - I.ema21) / I.atr : null;
  put('notExtended', ext === null ? null : ext <= rules.extendedAtr, ext === null ? 'Distance from the 21 EMA is unknown.' : `Price is ${ext.toFixed(1)} ATRs from the 21 EMA.`);
  const momOk = I.rsi >= rules.rsiLow && I.rsi <= rules.rsiHigh && histUp;
  put('momentum', momOk, `RSI ${I.rsi}${histUp ? ', MACD histogram positive or rising' : ', MACD histogram negative and falling'}.`);
  let bandsOk = null;
  let bandsText = 'Bollinger Bands are not available.';
  if (type === 'breakout') {
    bandsOk = feats.squeeze;
    bandsText = feats.squeeze === null ? 'Not enough history to judge the Bollinger Band squeeze.' : feats.squeeze ? 'The Bollinger Bands were unusually narrow before this move (a squeeze).' : 'No Bollinger Band squeeze came before this move.';
  } else if (isNum(feats.pctB)) {
    bandsOk = feats.pctB <= rules.pctBMax;
    bandsText = `Price sits ${Math.round(feats.pctB * 100)}% of the way up its Bollinger Bands${bandsOk ? '' : ', pressing the upper band'}.`;
  }
  put('bands', bandsOk, bandsText);
  const ed = inp.earnDays;
  const evOk = inp.earningsCal === 'ok' ? (isNum(ed) ? ed >= rules.eventClearDays : true) : false;
  put('events', evOk, inp.earningsCal !== 'ok' ? 'The earnings calendar is incomplete today, so earnings risk cannot be cleared.' : isNum(ed) ? `Next earnings ${inp.earn.date}${inp.earn.time ? ' (' + inp.earn.time + ')' : ''}, ${ed} weekdays away${evOk ? '' : ': close to the trade'}.` : 'No earnings date in the next 60 weekdays (dates are estimates until the company confirms them).');
  put('regime', inp.regime === null ? null : inp.regime === 'up', inp.regime === null ? 'The market trend is not available.' : `The S&P 500 trend is ${inp.regime === 'up' ? 'up' : inp.regime === 'down' ? 'down' : 'mixed'}.`);

  let score = 0;
  let metN = 0;
  const checks = SCAN_WEIGHTS.map((w) => {
    const e = ev[w.key];
    if (e.met === true) {
      score += w.weight;
      metN++;
    }
    return { key: w.key, label: w.label, weight: w.weight, met: e.met, detail: e.detail };
  });

  // ---- flags (filters on the page)
  const flags = [];
  if (isNum(accum) && accum >= rules.accumFlag && !(ext > rules.extendedAtr)) flags.push('accumulation');
  if (isNum(I.relVolume) && I.relVolume >= rules.unusualVolume) flags.push('unusualVolume');
  if (rsGain !== null && rsGain >= rules.rsRise) flags.push('rsRising');
  if (feats.squeeze) flags.push('squeeze');
  if (inp.earningsCal !== 'ok') flags.push('calendarPartial');

  // ---- the explanation
  const setupWhy = {
    pullback: `Pullback in an uptrend: price is at the 21 EMA / 50 SMA support zone (${money(s.zoneLow)} to ${money(s.zoneHigh)}) with RSI ${I.rsi}.`,
    breakout: s.status === 'active' ? `Breakout: closed above its 3-month high (${money(s.zoneLow)})${isNum(I.relVolume) ? ' on ' + I.relVolume.toFixed(1) + ' times normal volume' : ''}.` : `Breakout watch: price is pressing against resistance near ${money(s.zoneLow)}; it triggers on a daily close above ${money(s.entry)} with at least 1.3 times normal volume.`,
    reversal: `Trend reversal: RSI recovered from oversold and price is back above the 21 EMA (${money(I.ema21)}); this is a counter-trend idea and the chart analysis sizes it smaller.`,
    momentum: `Momentum leader: strong uptrend within ${(Math.max(0, 1 - tech.close / tech.levels.high52) * 100).toFixed(0)}% of its 52-week high with relative strength ${inp.rs}. It has no buy point today; the chart analysis' entry zone is a pullback to ${money(s.zoneLow)} to ${money(s.zoneHigh)}.`,
  }[type];
  const why = [setupWhy, ...checks.filter((c) => c.met === true && c.key !== 'rr').slice(0, 5).map((c) => c.detail)];
  const gaps = checks.filter((c) => c.met !== true).map((c) => `${c.label}: ${c.detail}`);
  const invalid = [`A fall to ${money(s.stop)} (the stop, ${(s.riskPct * 100).toFixed(1)}% below the entry) means the setup was wrong.`];
  if (isNum(I.sma50)) invalid.push(`A daily close below the 50-day average (${money(I.sma50)}) damages the daily trend.`);
  if (isNum(wk.sma50)) invalid.push(`A weekly close below the 50-week average (${money(wk.sma50)}) breaks the weekly trend.`);
  if (isNum(ed) && ed <= 30) invalid.push(`Earnings on ${inp.earn.date}: the stop does not protect against an earnings gap.`);
  if (type === 'breakout') invalid.push(`A close back below the breakout level (${money(s.zoneLow)}) means the breakout failed.`);
  if (inp.regime === 'down') invalid.push('The market trend is down, which works against most long setups.');

  const cand = {
    ticker: inp.ticker,
    name: inp.name,
    sector: inp.sector || '',
    capM: inp.capM,
    setup: type,
    status: s.status === 'active' ? 'ready' : 'watch',
    score,
    metN,
    close: tech.close,
    asOf: tech.asOf,
    entry: s.entry,
    zoneLow: s.zoneLow ?? null,
    zoneHigh: s.zoneHigh ?? null,
    maxEntry: s.maxEntry ?? null,
    stop: s.stop,
    t1: s.target1,
    t2: s.target2 ?? null,
    riskPct: s.riskPct,
    rr1: s.rr1,
    rr2: s.rr2 ?? null,
    fill: s.fill || null,
    trigger: typeof s.trigger === 'string' ? s.trigger : '',
    rs: inp.rs ?? null,
    rsPrev: inp.rsPrev ?? null,
    rsi: I.rsi,
    atrPct: I.atrPct,
    relVol: I.relVolume ?? null,
    accum: isNum(accum) ? accum : null,
    advUsdM: Math.round(feats.advUsd / 1e5) / 10,
    pctB: isNum(feats.pctB) ? Math.round(feats.pctB * 100) / 100 : null,
    weekly: wk.trend,
    earnings: inp.earn ? inp.earn.date : null,
    earnDays: isNum(ed) ? ed : null,
    flags,
    checks,
    why,
    gaps,
    invalid,
  };
  return { listed: cand };
}

function lastUp(tech) {
  const c = tech.chart && tech.chart.candles;
  if (!c || c.length < 2) return false;
  return c[c.length - 1][4] >= c[c.length - 2][4];
}

// ---------------------------------------------------------------- ranking
export function evidenceBand(score) {
  return score >= 75 ? 'Strong evidence' : score >= 55 ? 'Moderate evidence' : 'Thin evidence';
}
// Highest evidence score first; then more checks met; then A to Z. Nothing here looks at a return, past or predicted.
export function rankCandidates(list) {
  return [...list].sort((a, b) => b.score - a.score || b.metN - a.metN || (a.ticker < b.ticker ? -1 : a.ticker > b.ticker ? 1 : 0));
}
