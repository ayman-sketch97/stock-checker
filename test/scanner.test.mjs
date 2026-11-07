// Tests for the swing opportunity scanner (stage 8): Bollinger Bands, weekly candles, the data gates, the fixed evidence
// checklist and its ranking, the explanation text, and that nothing here can change a call or look at a return.
// Run: node --test test/scanner.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import * as S from '../lib/scanner.js';
import { prepare, analyzeTechnical } from '../lib/technical.js';

const eq = assert.deepEqual;
const close = (a, b, d = 1e-9) => assert.ok(Math.abs(a - b) < d, `${a} is not ${b}`);

// ---------------------------------------------------------------- a stand-in chart analysis that passes every gate
const tech = (o = {}) => ({
  ok: true, asOf: '2026-11-05', close: 50, trend: 'up', trendLabel: 'Uptrend',
  levels: { high52: 52, low52: 30, supports: [], resistances: [] },
  setup: { setup: 'pullback', status: 'active', entry: 50.5, stop: 47.5, target1: 57, target2: 62, riskPct: 0.0594, rr1: 2.2, rr2: 3.8, zoneLow: 48.5, zoneHigh: 50.8, maxEntry: 52, fill: 'stop', trigger: 'Next session, buy above $50.50.' },
  indicators: { ema21: 49.6, sma50: 47.9, sma200: 43, rsi: 52, atr: 1.2, atrPct: 0.024, relVolume: 1.1, upDownVolume: 1.5, extensionAtr: 0.3 },
  chart: { candles: [['2026-11-04', 49, 50, 48.5, 49.5, 1e6], ['2026-11-05', 49.6, 50.4, 49.2, 50, 1.2e6]] },
  perf: { r1m: 0.02, r3m: 0.08, r6m: 0.15, r12m: 0.3 },
  ...o,
});
const feats = (o = {}) => ({ advUsd: 80e6, pctB: 0.55, bandWidth: 0.09, squeeze: false, macdHist: 0.2, macdHistPrev: 0.1, ...o });
const wk = (o = {}) => ({ trend: 'up', asOfWeek: '2026-10-30', partial: true, close: 49.1, sma50: 45, ema21: 48, chart: {}, ...o });
const inp = (o = {}) => ({
  ticker: 'AAA', name: 'Alpha Inc', sector: 'Technology', capM: 20000, tech: tech(), feats: feats(), wk: wk(),
  shariah: 'pass', dq: 'high', rs: 82, rsPrev: 70, earn: null, earnDays: null, earningsCal: 'ok', regime: 'up', priceDate: '2026-11-05', bars: 1300, ...o,
});

// ---------------------------------------------------------------- the rules are fixed
test('the weights add up to 100 and the rules are frozen', () => {
  assert.equal(S.SCAN_WEIGHTS.reduce((a, w) => a + w.weight, 0), 100);
  assert.equal(S.SCAN_WEIGHTS.length, 11);
  assert.ok(Object.isFrozen(S.SCAN_RULES) && Object.isFrozen(S.SCAN_WEIGHTS));
  assert.throws(() => { 'use strict'; S.SCAN_RULES.minAdvUsd = 1; }, TypeError);
});

test('the rules and weights are pinned: changing one fails this test until SCAN_VERSION and the docs change with it', () => {
  const h = crypto.createHash('sha256').update(JSON.stringify({ v: S.SCAN_VERSION, rules: S.SCAN_RULES, weights: S.SCAN_WEIGHTS })).digest('hex');
  assert.equal(h, '70abc833a536b4aa98f81f95e5307a8a29f73d357affb5209abf0dadbbeb0bc2', 'PIN: ' + h);
});

// ---------------------------------------------------------------- Bollinger Bands
test('Bollinger Bands: known values, constant series, and the warm-up', () => {
  const v = Array.from({ length: 20 }, (_, i) => i + 1);
  const b = S.bollinger(v, 20, 2);
  close(b.mid[19], 10.5);
  const sd = Math.sqrt((400 - 1) / 12); // population standard deviation of 1..20
  close(b.upper[19], 10.5 + 2 * sd);
  close(b.lower[19], 10.5 - 2 * sd);
  assert.equal(b.mid[18], null);
  assert.equal(b.upper[18], null);
  const flat = S.bollinger(new Array(30).fill(7), 20, 2);
  close(flat.upper[29], 7);
  close(flat.lower[29], 7);
});

// ---------------------------------------------------------------- weekly candles
const d = (date, o, h, l, c, v = 100) => ({ date, o, h, l, c, v });
test('weekly candles: grouped Monday to Friday, high and low across the week, volume added, dated by the last session', () => {
  const w = S.weekly([
    d('2026-10-26', 10, 11, 9, 10.5), d('2026-10-27', 10.5, 12, 10, 11), d('2026-10-28', 11, 11.5, 10.5, 11.2), d('2026-10-29', 11.2, 11.6, 10.9, 11.4), d('2026-10-30', 11.4, 11.9, 11.1, 11.8),
    d('2026-11-02', 11.8, 12.4, 11.7, 12.3), d('2026-11-03', 12.3, 12.6, 12, 12.1),
  ]);
  assert.equal(w.length, 2);
  eq([w[0].date, w[0].o, w[0].h, w[0].l, w[0].c, w[0].v, w[0].days], ['2026-10-30', 10, 12, 9, 11.8, 500, 5]);
  eq([w[1].date, w[1].o, w[1].h, w[1].l, w[1].c, w[1].days], ['2026-11-03', 11.8, 12.6, 11.7, 12.1, 2]);
  assert.equal(w[0].partial, undefined);
  assert.equal(w[1].partial, true); // ends on a Tuesday: a week still in progress
});
test('weekly candles: a last week that ends on a Friday is complete; bad rows are ignored', () => {
  const w = S.weekly([d('2026-10-30', 1, 2, 1, 2), null, { date: '2026-10-29', c: 'x' }, d('2026-10-28', 1, 1, 1, 1)].reverse().filter(Boolean).sort((a, b) => (a.date < b.date ? -1 : 1)));
  assert.equal(w.length, 1);
  assert.equal(w[0].partial, false);
});

// a repeatable made-up series, long enough for every gate
function series(n, drift = 0.0006, seed = 11) {
  let s = seed;
  const rnd = () => (s = (s * 1103515245 + 12345) % 2147483648) / 2147483648;
  const days = [];
  const dt = new Date('2026-11-05T12:00:00Z');
  while (days.length < n) {
    if (dt.getUTCDay() % 6) days.unshift(dt.toISOString().slice(0, 10));
    dt.setUTCDate(dt.getUTCDate() - 1);
  }
  let p = 30;
  return days.map((date) => {
    const o = p;
    p *= 1 + drift + (rnd() - 0.5) * 0.024;
    return { date, o, h: Math.max(o, p) * (1 + rnd() * 0.006), l: Math.min(o, p) * (1 - rnd() * 0.006), c: p, v: Math.round(5e6 + rnd() * 3e6) };
  });
}
test('weekly analysis: chart arrays line up, the trend reads the last completed week, short history gives null', () => {
  const daily = series(1300);
  const a = S.weeklyAnalysis(daily);
  assert.ok(a);
  const n = a.chart.candles.length;
  assert.equal(n, S.SCAN_RULES.weeklyKeep);
  for (const k of ['ema21', 'sma50', 'sma200', 'bbUpper', 'bbLower', 'rsi', 'macd', 'signal', 'hist']) assert.equal(a.chart[k].length, n, k);
  assert.ok(['up', 'down', 'mixed'].includes(a.trend));
  assert.equal(a.partial, a.chart.partialLast);
  // the last candle of a Thursday data set is a partial week: the trend must come from the week before
  assert.equal(a.chart.candles[n - 1][0], daily[daily.length - 1].date);
  assert.ok(a.asOfWeek <= a.chart.candles[n - 1][0]);
  assert.equal(S.weeklyAnalysis(series(200)), null);
  // the 200-week average exists at the end because the indicators run over the whole history, not the kept window
  assert.ok(a.chart.sma200[n - 1] > 0);
});
test('daily bands: as many values as the chart window, lower below upper, and the middle is their average', () => {
  const daily = series(600);
  const closes = daily.map((x) => x.c);
  const b = S.dailyBands(closes);
  assert.equal(b.upper.length, S.SCAN_RULES.dailyKeep);
  assert.equal(b.lower.length, S.SCAN_RULES.dailyKeep);
  assert.equal(b.mid, undefined);
  const full = S.bollinger(closes, 20, 2);
  const off = closes.length - S.SCAN_RULES.dailyKeep;
  for (let i = 0; i < b.upper.length; i++) {
    assert.ok(b.lower[i] < b.upper[i]);
    close((b.upper[i] + b.lower[i]) / 2, full.mid[off + i], 0.011);
  }
});

// ---------------------------------------------------------------- liquidity and band position
test('features: average dollar volume over 50 sessions; unknown when volume is missing', () => {
  const daily = series(400).map((x) => ({ ...x, v: 1e6, c: 20, h: 20.1, l: 19.9, o: 20 }));
  const P = prepare(daily);
  close(S.features(P).advUsd, 20e6, 1);
  const none = prepare(series(400).map((x) => ({ ...x, v: 0 })));
  assert.equal(S.features(none).advUsd, null);
});

// ---------------------------------------------------------------- relative strength change
test('rank among the stocks as they stood N sessions ago: monotone, 1 to 99, null when too few stocks', () => {
  const mk = (g) => ({ c: Float64Array.from({ length: 300 }, (_, i) => 10 * (1 + g) ** i) });
  const data = Array.from({ length: 150 }, (_, k) => mk(0.0005 + k * 0.00002));
  const w = (c, j) => c[j] / c[j - 63] - 1;
  const rank = S.rankerBack(data, 0, w);
  assert.ok(rank);
  const lo = rank(w(data[0].c, 299));
  const hi = rank(w(data[149].c, 299));
  assert.ok(lo >= 1 && hi <= 99 && hi > lo);
  assert.equal(lo, 1);
  assert.equal(hi, 99);
  // 21 sessions back uses each stock's bar 21 earlier, not today's
  const back = S.rankerBack(data, 21, w);
  assert.equal(back(w(data[75].c, 278)), S.rankerBack(data, 0, w)(w(data[75].c, 299)));
  assert.equal(S.rankerBack(data.slice(0, 20), 0, w), null);
  assert.equal(S.rankerBack(data, 40, w)(w(data[0].c, 259)) >= 1, true);
  assert.equal(S.rankerBack(data, 60, w), null); // 60 sessions back leaves under 252 sessions of history
  assert.equal(S.rankerBack(data.map(() => ({ c: new Float64Array(200) })), 0, w), null); // not enough history to rank
});

// ---------------------------------------------------------------- classification
test('only the chart analysis\' own setups are listed; momentum is a leader with no buy point; everything else is no setup', () => {
  assert.equal(S.classify(tech(), 50), 'pullback');
  assert.equal(S.classify(tech({ setup: { ...tech().setup, setup: 'breakout', status: 'watch' } }), 50), 'breakout');
  assert.equal(S.classify(tech({ setup: { ...tech().setup, setup: 'reversal' } }), 50), 'reversal');
  for (const nope of ['extended', 'range', 'downtrend', 'weakening']) assert.equal(S.classify(tech({ setup: { ...tech().setup, setup: nope, status: 'wait' } }), 90), null, nope);
  assert.equal(S.classify(tech({ setup: { ...tech().setup, status: 'none' } }), 90), null);
  const trend = tech({ trendLabel: 'Strong uptrend', close: 51, setup: { ...tech().setup, setup: 'trend', status: 'watch' } });
  assert.equal(S.classify(trend, 85), 'momentum');
  assert.equal(S.classify(trend, 79), null); // not a leader
  assert.equal(S.classify(tech({ trendLabel: 'Uptrend', setup: { ...tech().setup, setup: 'trend', status: 'watch' } }), 90), null); // not a strong uptrend
  assert.equal(S.classify(tech({ trendLabel: 'Strong uptrend', close: 40, setup: { ...tech().setup, setup: 'trend', status: 'watch' } }), 90), null); // not near its high
  assert.equal(S.classify(trend, null), null);
});

// ---------------------------------------------------------------- the data gates
const blockedFor = (o) => {
  const r = S.scanStock(inp(o));
  assert.ok(r.blocked, 'expected a block, got ' + JSON.stringify(Object.keys(r)));
  return r.blocked.reasons.join(' | ');
};
test('a clean candidate is listed', () => {
  const r = S.scanStock(inp());
  assert.ok(r.listed);
  assert.equal(r.listed.ticker, 'AAA');
  assert.equal(r.listed.status, 'ready');
});
test('every critical piece of missing, old or unreliable data keeps a stock off the list, and says why', () => {
  assert.match(blockedFor({ shariah: 'fail' }), /fails the automated Shariah screen/);
  eq(S.scanStock(inp({ shariah: 'fail', bars: 100 })).blocked.keys, ['shariah', 'history']);
  assert.match(blockedFor({ shariah: 'check' }), /needs checking/);
  assert.match(blockedFor({ dq: 'insufficient' }), /insufficient/);
  assert.match(blockedFor({ dq: null }), /insufficient/);
  assert.match(blockedFor({ tech: tech({ asOf: '2026-11-04' }) }), /last price is 2026-11-04/);
  assert.match(blockedFor({ priceDate: null }), /last price is/);
  assert.match(blockedFor({ bars: 250 }), /only 250 daily bars/);
  assert.match(blockedFor({ wk: null }), /weekly history/);
  assert.match(blockedFor({ wk: wk({ trend: null }) }), /weekly history/);
  assert.match(blockedFor({ tech: tech({ close: 4.5 }) }), /below \$5/);
  assert.match(blockedFor({ feats: feats({ advUsd: 4e6 }) }), /dollar volume is \$4\.0M/);
  assert.match(blockedFor({ feats: feats({ advUsd: null }) }), /volume is unknown/);
  assert.match(blockedFor({ tech: tech({ indicators: { ...tech().indicators, atrPct: 0.09 } }) }), /9\.0% of price/);
  assert.match(blockedFor({ tech: tech({ indicators: { ...tech().indicators, atrPct: null } }) }), /volatility is unknown/);
  assert.match(blockedFor({ tech: tech({ setup: { ...tech().setup, target1: null } }) }), /no complete entry, stop and target/);
  assert.match(blockedFor({ tech: tech({ setup: { ...tech().setup, stop: 51 } }) }), /no complete entry/);
  assert.match(blockedFor({ tech: tech({ setup: { ...tech().setup, riskPct: 0.2 } }) }), /20% below the entry/);
  assert.match(blockedFor({ tech: tech({ indicators: { ...tech().indicators, rsi: null } }) }), /indicator is missing/);
  assert.match(blockedFor({ earningsCal: 'unavailable' }), /earnings calendar could not be read/);
  assert.match(blockedFor({ earnDays: 5, earn: { date: '2026-11-12', time: '' } }), /earnings in 5 weekdays \(2026-11-12\)/);
  assert.match(blockedFor({ earnDays: 7, earn: { date: '2026-11-16', time: '' } }), /earnings in 7 weekdays/);
});
test('earnings just outside the block window are listed, but not given the event check', () => {
  const r = S.scanStock(inp({ earnDays: 8, earn: { date: '2026-11-17', time: 'after close' } })).listed;
  assert.ok(r);
  assert.equal(r.checks.find((c) => c.key === 'events').met, false);
  assert.ok(r.invalid.some((x) => /Earnings on 2026-11-17/.test(x)));
});
test('a partly failed earnings calendar lists the stock with a warning and no event credit', () => {
  const r = S.scanStock(inp({ earningsCal: 'partial' })).listed;
  assert.equal(r.checks.find((c) => c.key === 'events').met, false);
  assert.ok(r.flags.includes('calendarPartial'));
});
test('no setup at all is not an error and not a block', () => {
  eq(S.scanStock(inp({ tech: tech({ setup: { ...tech().setup, setup: 'range', status: 'none' } }) })), { none: 'no setup' });
  eq(S.scanStock(inp({ tech: { ok: false } })), { none: 'no chart analysis' });
});

// ---------------------------------------------------------------- the evidence checklist
test('a candidate that meets every check scores 100; one that meets none scores 0; each check is worth its weight', () => {
  const full = S.scanStock(inp()).listed;
  assert.equal(full.checks.length, 11);
  assert.equal(full.score, 100);
  assert.equal(full.metN, 11);
  for (const c of full.checks) assert.equal(c.weight, S.SCAN_WEIGHTS.find((w) => w.key === c.key).weight);
  const weak = S.scanStock(inp({
    wk: wk({ trend: 'down' }), rs: 40, rsPrev: 60, regime: 'down', earnDays: 10, earn: { date: '2026-11-19', time: '' },
    tech: tech({ trend: 'sideways', trendLabel: 'Sideways', setup: { ...tech().setup, rr1: 1.6 }, indicators: { ...tech().indicators, rsi: 30, upDownVolume: 0.8, relVolume: 0.9, ema21: 45, atr: 1.2 } }),
    feats: feats({ pctB: 0.95, macdHist: -0.2, macdHistPrev: -0.1 }),
  })).listed;
  assert.equal(weak.score, 0, JSON.stringify(weak.checks.filter((c) => c.met)));
  assert.equal(weak.metN, 0);
});
test('each check moves the score by exactly its weight', () => {
  const base = S.scanStock(inp()).listed.score;
  const drop = (o, key) => {
    const r = S.scanStock(inp(o)).listed;
    assert.equal(r.checks.find((c) => c.key === key).met === true, false, key);
    assert.equal(base - r.score, S.SCAN_WEIGHTS.find((w) => w.key === key).weight, key);
  };
  drop({ wk: wk({ trend: 'mixed' }) }, 'weekly');
  drop({ tech: tech({ trend: 'sideways' }) }, 'daily');
  drop({ rs: 69, rsPrev: 60 }, 'rs');
  drop({ rsPrev: 78 }, 'rsRising');
  drop({ tech: tech({ indicators: { ...tech().indicators, upDownVolume: 1.0, relVolume: 1.0 } }) }, 'volume');
  drop({ tech: tech({ setup: { ...tech().setup, rr1: 1.9 } }) }, 'rr');
  drop({ tech: tech({ close: 53 }) }, 'notExtended');
  drop({ tech: tech({ indicators: { ...tech().indicators, rsi: 72 } }) }, 'momentum');
  drop({ feats: feats({ pctB: 0.9 }) }, 'bands');
  drop({ earnDays: 9, earn: { date: '2026-11-18', time: '' } }, 'events');
  drop({ regime: 'mixed' }, 'regime');
});
test('unknown data is not credit: a missing RS change or market trend scores nothing and says so', () => {
  const r = S.scanStock(inp({ rsPrev: null, regime: null })).listed;
  assert.equal(r.checks.find((c) => c.key === 'rsRising').met, null);
  assert.equal(r.checks.find((c) => c.key === 'regime').met, null);
  assert.equal(r.score, 100 - 10 - 5);
  assert.ok(r.gaps.some((g) => /not available/.test(g)));
});
test('boundaries are inclusive where the rule says "at least" and "no more than"', () => {
  const at = (o) => S.scanStock(inp(o)).listed.checks;
  assert.equal(at({ rs: 70 }).find((c) => c.key === 'rs').met, true);
  assert.equal(at({ rs: 75, rsPrev: 70 }).find((c) => c.key === 'rsRising').met, true);
  assert.equal(at({ tech: tech({ setup: { ...tech().setup, rr1: 2 } }) }).find((c) => c.key === 'rr').met, true);
  assert.equal(at({ feats: feats({ pctB: 0.8 }) }).find((c) => c.key === 'bands').met, true);
  assert.equal(at({ earnDays: 15, earn: { date: '2026-11-26', time: '' } }).find((c) => c.key === 'events').met, true);
  assert.equal(at({ tech: tech({ indicators: { ...tech().indicators, rsi: 40 } }) }).find((c) => c.key === 'momentum').met, true);
});
test('a breakout is judged on the Bollinger squeeze before it, not on the position in the bands', () => {
  const b = tech({ setup: { ...tech().setup, setup: 'breakout', status: 'active', zoneLow: 49.8 } });
  assert.equal(S.scanStock(inp({ tech: b, feats: feats({ squeeze: true, pctB: 0.99 }) })).listed.checks.find((c) => c.key === 'bands').met, true);
  assert.equal(S.scanStock(inp({ tech: b, feats: feats({ squeeze: false, pctB: 0.3 }) })).listed.checks.find((c) => c.key === 'bands').met, false);
  assert.equal(S.scanStock(inp({ tech: b, feats: feats({ squeeze: null }) })).listed.checks.find((c) => c.key === 'bands').met, null);
});

// ---------------------------------------------------------------- what it says and what it passes through
test('entry, stop, targets and risk/reward are the chart analysis\' numbers, unchanged', () => {
  const t = tech();
  const r = S.scanStock(inp({ tech: t })).listed;
  eq([r.entry, r.stop, r.t1, r.t2, r.riskPct, r.rr1, r.rr2, r.zoneLow, r.zoneHigh, r.maxEntry], [t.setup.entry, t.setup.stop, t.setup.target1, t.setup.target2, t.setup.riskPct, t.setup.rr1, t.setup.rr2, t.setup.zoneLow, t.setup.zoneHigh, t.setup.maxEntry]);
});
test('momentum has no buy point today: it is a watch with the chart analysis\' pullback zone', () => {
  const t = tech({ trendLabel: 'Strong uptrend', close: 51, setup: { ...tech().setup, setup: 'trend', status: 'watch', entry: 49.6 } });
  const r = S.scanStock(inp({ tech: t })).listed;
  assert.equal(r.setup, 'momentum');
  assert.equal(r.status, 'watch');
  assert.match(r.why[0], /no buy point today/);
});
test('every candidate says why it qualifies, what is missing and what would make it wrong', () => {
  const r = S.scanStock(inp({ rs: 60, rsPrev: 60 })).listed;
  assert.ok(r.why.length >= 2 && /Pullback in an uptrend/.test(r.why[0]));
  assert.ok(r.gaps.some((g) => /^Strong relative strength/.test(g)));
  assert.ok(r.invalid.length >= 3);
  assert.match(r.invalid[0], /\$47\.50 \(the stop/);
  assert.ok(r.invalid.some((x) => /50-week average/.test(x)));
  // no promise of a result anywhere in the text
  const all = [...r.why, ...r.gaps, ...r.invalid, ...r.checks.map((c) => c.detail)].join(' ');
  assert.doesNotMatch(all, /guarantee|will rise|certain|sure thing|expected return|profit of/i);
  assert.doesNotMatch(all, /\blive\b/i);
});
test('flags: accumulation, unusual volume, rising strength, squeeze', () => {
  const r = S.scanStock(inp({ feats: feats({ squeeze: true }), tech: tech({ indicators: { ...tech().indicators, upDownVolume: 1.6, relVolume: 2.4 } }) })).listed;
  for (const f of ['accumulation', 'unusualVolume', 'rsRising', 'squeeze']) assert.ok(r.flags.includes(f), f);
  const none = S.scanStock(inp({ rsPrev: 82, feats: feats(), tech: tech({ indicators: { ...tech().indicators, upDownVolume: 1.0, relVolume: 1.0 } }) })).listed;
  eq(none.flags, []);
});

// ---------------------------------------------------------------- ranking
test('ranking: evidence score, then checks met, then A to Z; never a return', () => {
  const mk = (ticker, score, metN) => ({ ticker, score, metN, r12m: 9 - score, t1: 1e9 });
  const out = S.rankCandidates([mk('ZZZ', 70, 8), mk('AAA', 70, 8), mk('MMM', 70, 9), mk('BBB', 85, 7), mk('CCC', 40, 4)]);
  eq(out.map((x) => x.ticker), ['BBB', 'MMM', 'AAA', 'ZZZ', 'CCC']);
  const again = S.rankCandidates(out.slice().reverse());
  eq(again.map((x) => x.ticker), out.map((x) => x.ticker));
  eq(S.evidenceBand(75), 'Strong evidence');
  eq(S.evidenceBand(74), 'Moderate evidence');
  eq(S.evidenceBand(55), 'Moderate evidence');
  eq(S.evidenceBand(54), 'Thin evidence');
  assert.doesNotMatch(fs.readFileSync(new URL('../lib/scanner.js', import.meta.url), 'utf8').split('export function rankCandidates')[1], /\.(r1m|r3m|r6m|r12m|perf|t1|t2|entry|rr1|rr2)\b/);
});

// ---------------------------------------------------------------- with the real chart analysis
test('on made-up price series run through the real chart analysis, nothing crashes and every listed candidate is sound', () => {
  let listed = 0;
  let blocked = 0;
  let none = 0;
  for (let seed = 1; seed <= 60; seed++) {
    const daily = series(1300, 0.0003 + (seed % 7) * 0.0002, seed);
    const P = prepare(daily);
    const T = analyzeTechnical(P);
    const r = S.scanStock({
      ticker: 'T' + seed, name: 'Test ' + seed, tech: T, feats: S.features(P), wk: S.weeklyAnalysis(daily), shariah: 'pass', dq: 'high',
      rs: 50 + (seed % 49), rsPrev: 50, earn: null, earnDays: null, earningsCal: 'ok', regime: 'up', priceDate: daily.at(-1).date, bars: daily.length,
    });
    if (r.none) none++;
    else if (r.blocked) blocked++;
    else {
      listed++;
      const c = r.listed;
      assert.ok(c.entry > c.stop && c.t1 > c.entry, c.ticker);
      assert.ok(c.score >= 0 && c.score <= 100 && c.metN === c.checks.filter((x) => x.met === true).length);
      assert.equal(c.score, c.checks.filter((x) => x.met === true).reduce((a, x) => a + x.weight, 0));
      assert.ok(['pullback', 'breakout', 'reversal', 'momentum'].includes(c.setup));
      JSON.stringify(c); // serialisable
    }
  }
  assert.equal(listed + blocked + none, 60);
  assert.ok(none > 0, 'most days have no setup');
});

test('the same input always gives the same answer, and the input is not changed', () => {
  const i = inp();
  const snap = JSON.stringify(i);
  const a = JSON.stringify(S.scanStock(i));
  const b = JSON.stringify(S.scanStock(i));
  assert.equal(a, b);
  assert.equal(JSON.stringify(i), snap);
});

test('the scanner imports only the indicators of the chart analysis: it cannot reach a recommendation, a verdict or a Shariah rule', () => {
  const src = fs.readFileSync(new URL('../lib/scanner.js', import.meta.url), 'utf8');
  const imports = [...src.matchAll(/^import .* from '(.*)';/gm)].map((m) => m[1]);
  eq(imports, ['./technical.js']);
  assert.doesNotMatch(src, /fetch\(|require\(|process\.|localStorage|writeFile/);
});

// ---------------------------------------------------------------- the nightly file
function universe(n = 160) {
  const rsData = [];
  const pending = [];
  const rows = [];
  for (let seed = 1; seed <= n; seed++) {
    const daily = series(1300, -0.0002 + (seed % 11) * 0.0002, seed * 3);
    const P = prepare(daily);
    const T = analyzeTechnical(P);
    const si = rsData.length;
    rsData.push({ c: Float64Array.from(P.C) });
    rows.push([`S${seed}`, S_rs(P)]);
    const setup = T.setup.setup;
    if (['pullback', 'breakout', 'reversal'].includes(setup) || (setup === 'trend' && T.trendLabel === 'Strong uptrend')) {
      pending.push({ si, ticker: `S${seed}`, name: `Stock ${seed}`, sector: 'X', capM: 5000, tech: T, wk: { ...S.weeklyAnalysis(daily), chart: undefined }, feats: S.features(P), bars: P.n,
        shariah: seed % 5 === 0 ? 'fail' : 'pass', dq: 'high', earn: null, earnDays: null });
    }
  }
  return { rsData, pending, rows };
}
const wRet = (c, j) => 0.4 * (c[j] / c[j - 63] - 1) + 0.3 * (c[j] / c[j - 126] - 1) + 0.3 * (c[j] / c[j - 252] - 1);
function S_rs(P) { return wRet(P.C, P.C.length - 1); }
test('the nightly file: counts add up, ranked, capped, Shariah-screen failures hidden, and no stock appears twice', () => {
  const U = universe();
  const rank0 = S.rankerBack(U.rsData, 0, wRet);
  const rsOf = new Map(U.rows.map(([t, w]) => [t, rank0(w)]));
  const base = { pending: U.pending, rsData: U.rsData, rsOf, weighted: wRet, calendar: { size: 900, failures: 0, days: 60, from: '2026-11-06', to: '2027-01-29' }, regime: 'up', priceDate: '2026-11-05', asOf: '2026-11-06T03:00:00Z', techVersion: '1.3', stocksWithChart: 160 };
  const f = S.buildScanner(base);
  const sm = f.summary;
  assert.ok(U.pending.length > 5, 'the made-up market should produce some setups: ' + U.pending.length);
  assert.equal(sm.listed + sm.blocked + sm.noSetupAfterChecks, U.pending.length);
  assert.equal(f.rows.length, Math.min(sm.listed, S.SCAN_RULES.listMax));
  for (let i = 1; i < f.rows.length; i++) assert.ok(f.rows[i - 1].score >= f.rows[i].score);
  assert.equal(new Set(f.rows.map((r) => r.ticker)).size, f.rows.length);
  const failing = new Set(U.pending.filter((p) => p.shariah === 'fail').map((p) => p.ticker));
  assert.ok(failing.size > 0, 'the made-up market should include some Shariah-screen failures with a setup');
  assert.ok(f.rows.every((r) => !failing.has(r.ticker)), 'no Shariah-screen failure is listed');
  assert.ok(f.blocked.every((b) => b.length === 4 && !failing.has(b[0])), 'the blocked list never names a Shariah-screen failure');
  assert.ok(sm.hiddenByShariahScreen > 0 && sm.hiddenByShariahScreen <= failing.size);
  assert.equal(sm.blockedByGate.shariah, sm.hiddenByShariahScreen);
  assert.equal(f.earningsCalendar.status, 'ok');
  assert.equal(f.rules.minAdvUsd, 10e6);
  assert.equal(f.weights.length, 11);
  assert.match(f.prices, /End-of-day/);
  assert.doesNotMatch(JSON.stringify(f), /\blive\b/i);
  // every listed stock carries the as-of date the file claims
  assert.ok(f.rows.every((r) => r.asOf === f.priceDate));
  JSON.parse(JSON.stringify(f));
});
