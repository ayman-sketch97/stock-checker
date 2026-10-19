// Automated checks for the critical formulas. Run: node --test test/
// Reference values are worked out by hand (shown in comments) or taken from published examples, not from the
// code under test.
import test from 'node:test';
import assert from 'node:assert/strict';
import { sma, ema, rsi, atr, macd, prepare, evaluate, simulateTrade } from '../lib/technical.js';
import { analyze, dcf, fiscalYearOf, yearsBetween, businessScreen } from '../lib/engine.js';

const close = (a, b, tol, msg) => assert.ok(Math.abs(a - b) <= tol, `${msg ?? ''} expected ${b}, got ${a}`);

// ---------------------------------------------------------------- technical indicators
test('SMA: simple average of the last n values', () => {
  const s = sma([1, 2, 3, 4, 5], 3);
  assert.deepEqual(s.slice(0, 2), [null, null]);
  close(s[2], 2, 1e-12); // (1+2+3)/3
  close(s[4], 4, 1e-12); // (3+4+5)/3
});

test('EMA: seeded with the SMA, then k = 2/(n+1)', () => {
  const e = ema([1, 2, 3, 4, 5], 3);
  close(e[2], 2, 1e-12); // seed (1+2+3)/3
  close(e[3], 3, 1e-12); // 4*0.5 + 2*0.5
  close(e[4], 4, 1e-12); // 5*0.5 + 3*0.5
});

test("RSI: Wilder's method on the StockCharts example closes", () => {
  // Closes from the StockCharts ChartSchool RSI example (14 periods). Expected values computed by hand from the
  // definition (first average = simple mean of 14 gains/losses, then (prev x 13 + current) / 14). StockCharts'
  // published table (70.53, 66.32, 66.55, 69.41, 66.36, 57.97) rounds its intermediate averages, so it differs by <0.1.
  const c = [44.34, 44.09, 44.15, 43.61, 44.33, 44.83, 45.1, 45.42, 45.84, 46.08, 45.89, 46.03, 45.61, 46.28, 46.28, 46.0, 46.03, 46.41, 46.22, 45.64];
  const r = rsi(c, 14);
  assert.equal(r[13], null);
  const expected = [70.4641, 66.2496, 66.4809, 69.3469, 66.2947, 57.915];
  expected.forEach((v, k) => close(r[14 + k], v, 0.0005, `RSI bar ${14 + k}`));
  const published = [70.53, 66.32, 66.55, 69.41, 66.36, 57.97];
  published.forEach((v, k) => close(r[14 + k], v, 0.1, `RSI bar ${14 + k} vs published`));
});

test('RSI: 100 when there are no losses', () => {
  const r = rsi([1, 2, 3, 4, 5, 6], 3);
  assert.equal(r[3], 100);
});

test("ATR: true range and Wilder smoothing", () => {
  const H = [10, 11, 12, 11, 13];
  const L = [9, 10, 10, 9, 11];
  const C = [9.5, 10.5, 11, 10, 12.5];
  // TR: 1 (H-L), max(1,|11-9.5|,|10-9.5|)=1.5, max(2,|12-10.5|,|10-10.5|)=2, max(2,|11-11|,|9-11|)=2, max(2,|13-10|,|11-10|)=3
  const a = atr(H, L, C, 3);
  close(a[2], (1 + 1.5 + 2) / 3, 1e-12);
  close(a[3], (a[2] * 2 + 2) / 3, 1e-12);
  close(a[4], (a[3] * 2 + 3) / 3, 1e-12);
});

test('MACD: line = EMA12 - EMA26, signal = EMA9 of the line, histogram = line - signal', () => {
  const c = Array.from({ length: 80 }, (_, i) => 100 + 10 * Math.sin(i / 6) + i * 0.2);
  const m = macd(c);
  const e12 = ema(c, 12);
  const e26 = ema(c, 26);
  close(m.line[79], e12[79] - e26[79], 1e-12);
  const sig = ema(m.line.slice(25), 9);
  close(m.signal[79], sig[sig.length - 1], 1e-12);
  close(m.hist[79], m.line[79] - m.signal[79], 1e-12);
});

// ---------------------------------------------------------------- trade plan arithmetic and timing
function series(n, f) {
  return Array.from({ length: n }, (_, i) => {
    const c = f(i);
    return { date: new Date(Date.UTC(2020, 0, 1) + i * 86400000).toISOString().slice(0, 10), o: c * 0.998, h: c * 1.01, l: c * 0.99, c, v: 1e6 + (i % 7) * 1e5 };
  });
}

test('trade plans: stop below entry, R-multiples and limit price consistent', () => {
  const daily = series(400, (i) => 50 + i * 0.1 + 3 * Math.sin(i / 5));
  const P = prepare(daily);
  let checked = 0;
  for (let i = 250; i < P.n; i++) {
    const p = evaluate(P, i).setup;
    if (p.entry == null || p.stop == null) continue;
    checked++;
    const risk = p.entry - p.stop;
    assert.ok(risk > 0, 'stop must be below entry');
    close(p.riskPct, risk / p.entry, 1e-3);
    close(p.maxEntry, p.entry + 0.5 * risk, 0.011);
    if (p.target1 != null) {
      assert.ok(p.target1 > p.entry, 'target 1 above entry');
      close(p.rr1, (p.target1 - p.entry) / risk, 0.06);
    }
    if (p.target2 != null) assert.ok(p.target2 >= p.target1, 'target 2 at or above target 1');
  }
  assert.ok(checked > 20, `expected plans to check, got ${checked}`);
});

test('simulateTrade: orders act only on the next session, never the signal day', () => {
  const daily = series(200, () => 100);
  const P = prepare(daily);
  const i = 150;
  // stop-buy above the next bar's high: no fill
  const plan = { setup: 'pullback', fill: 'stop', entry: 102, stop: 95, target1: 110, target2: 120, maxEntry: 105.5 };
  assert.equal(simulateTrade(P, i, plan).status, 'nofill');
  // stop-buy inside the next bar's range: fills on bar i+1 at the trigger price
  const t = simulateTrade(P, i, { ...plan, entry: 100.5, stop: 97, maxEntry: 102.25 });
  assert.equal(t.fillIdx, i + 1);
  close(t.entry, 100.5, 1e-9);
  // the last bar has no next session yet
  assert.equal(simulateTrade(P, P.n - 1, plan).status, 'pending');
  // gap above the limit: skipped
  P.O[i + 1] = 106;
  P.H[i + 1] = 107;
  assert.equal(simulateTrade(P, i, plan).status, 'skipped');
});

// ---------------------------------------------------------------- fundamentals helpers
test('fiscal year labels: 52/53-week years ending in early January belong to the prior year', () => {
  assert.equal(fiscalYearOf('2023-01-01'), 2022); // JNJ fiscal 2022
  assert.equal(fiscalYearOf('2023-12-31'), 2023);
  assert.equal(fiscalYearOf('2026-01-25'), 2026); // NVIDIA calls this fiscal 2026
  assert.equal(fiscalYearOf('2025-09-27'), 2025);
  close(yearsBetween('2021-01-03', '2025-12-28'), 4.98, 0.01); // JNJ: ~5 years, not 4
});

test('DCF: zero growth equals the perpetuity value', () => {
  // FCF 10 a year forever at 10%: EV = 10 / 0.10 = 100
  const v = dcf({ revenue0: 100, margin: 0.1, g1: 0, gT: 0, r: 0.1, netCash: 0, shares: 1 });
  close(v.ev, 100, 1e-9);
});

test('DCF: constant growth equals the Gordon growth value', () => {
  // FCF next year 100*1.02*0.1 = 10.2, growing 2% forever at 10%: EV = 10.2 / 0.08 = 127.5
  const v = dcf({ revenue0: 100, margin: 0.1, g1: 0.02, gT: 0.02, r: 0.1, netCash: 0, shares: 1 });
  close(v.ev, 127.5, 1e-9);
});

test('DCF: net cash and shares applied once', () => {
  const v = dcf({ revenue0: 100, margin: 0.1, g1: 0, gT: 0, r: 0.1, netCash: -30, shares: 7 });
  close(v.equity, 70, 1e-9);
  close(v.perShare, 10, 1e-9);
  assert.throws(() => dcf({ revenue0: 100, margin: 0.1, g1: 0, gT: 0.1, r: 0.1, netCash: 0, shares: 1 }));
});

test('Shariah business screen: unknown industry is REVIEW, never PASS', () => {
  assert.equal(businessScreen(null, 'Some Co', 'XYZ').status, 'review');
  assert.equal(businessScreen(6022, 'A Bank', 'BNK').status, 'fail');
  assert.equal(businessScreen(3571, 'Computer Maker', 'CMP').status, 'pass');
  assert.equal(businessScreen(5812, 'Burger Chain', 'BRG').status, 'review');
});

// ---------------------------------------------------------------- a full synthetic company
function company(opts = {}) {
  const facts = { 'us-gaap': {}, dei: {} };
  const add = (tag, unit, f) => {
    facts['us-gaap'][tag] ??= { units: {} };
    (facts['us-gaap'][tag].units[unit] ??= []).push({ accn: '0000000000-25-000001', ...f });
  };
  const years = [2019, 2020, 2021, 2022, 2023, 2024];
  years.forEach((y, i) => {
    const rev = 1000e6 * 1.1 ** i;
    const fy = { start: `${y}-01-01`, end: `${y}-12-31`, form: '10-K', filed: `${y + 1}-02-15` };
    add('Revenues', 'USD', { ...fy, val: rev });
    add('OperatingIncomeLoss', 'USD', { ...fy, val: rev * 0.25 });
    add('NetIncomeLoss', 'USD', { ...fy, val: rev * 0.2 });
    add('IncomeLossFromContinuingOperationsBeforeIncomeTaxesExtraordinaryItemsNoncontrollingInterest', 'USD', { ...fy, val: rev * 0.25 });
    add('IncomeTaxExpenseBenefit', 'USD', { ...fy, val: rev * 0.05 });
    add('NetCashProvidedByUsedInOperatingActivities', 'USD', { ...fy, val: rev * 0.25 });
    if (!opts.noCapex) add('PaymentsToAcquirePropertyPlantAndEquipment', 'USD', { ...fy, val: rev * 0.05 });
    add('InterestExpense', 'USD', { ...fy, val: opts.interest ?? 20e6 });
    if (opts.interestIncome) add('InvestmentIncomeInterest', 'USD', { ...fy, val: rev * opts.interestIncome });
    add('WeightedAverageNumberOfDilutedSharesOutstanding', 'shares', { ...fy, val: 100e6 });
    add('EarningsPerShareDiluted', 'USD/shares', { ...fy, val: (rev * 0.2) / 100e6 });
    const inst = { end: `${y}-12-31`, form: '10-K', filed: `${y + 1}-02-15` };
    add('Assets', 'USD', { ...inst, val: rev * 2 });
    add('StockholdersEquity', 'USD', { ...inst, val: rev });
    if (!(opts.noCashLatest && y === 2024)) add('CashAndCashEquivalentsAtCarryingValue', 'USD', { ...inst, val: 200e6 });
    if (!(opts.noDebtLatest && y >= 2024)) add(opts.debtTag || 'LongTermDebt', 'USD', { ...inst, val: opts.debt ?? 400e6 });
    if (opts.combinedLine) add('CashCashEquivalentsAndShortTermInvestments', 'USD', { ...inst, val: 260e6 });
  });
  const sub = { name: 'TEST CO', sic: opts.sic === undefined ? 3571 : opts.sic, recentForms: ['10-K'], latest10K: { form: '10-K' } };
  return analyze({
    ticker: 'TST', cik: 1, listing: { exchange: 'Nasdaq' }, submissions: sub, facts,
    price: { price: 50, monthly: [], splits: [], splitsKnown: true, source: 'test', priceTime: 'close on 2025-06-30' },
    fetchedAt: '2025-06-30T00:00:00Z',
  });
}

test('company: growth rate measured over the real span between period ends', () => {
  const r = company();
  const g = r.sections.growth.find((m) => m.key === 'rev_cagr');
  close(g.value, 0.1, 0.002); // revenue grows exactly 10% a year
});

test('company: DCF uses unlevered cash flow and subtracts debt once', () => {
  const r = company();
  const f = r.fairValue;
  assert.ok(f, 'fair value expected');
  // unlevered owner margin = (OCF 25% - capex 5% + interest 20M x (1 - 20% tax)) / revenue, last year
  const rev = 1000e6 * 1.1 ** 5;
  close(f.scenarios.base.margin, median3([0, 1, 2, 3, 4].map((i) => (0.2 * 1000e6 * 1.1 ** (i + 1) + 16e6) / (1000e6 * 1.1 ** (i + 1))).concat([(0.2 * rev + 16e6) / rev])), 1e-4);
  close(f.inputs.netCash, 200e6 - 400e6, 1);
  assert.ok(f.bear < f.base && f.base < f.bull, 'bear < base < bull');
  close(f.marginOfSafety, 1 - 50 / f.base, 1e-3);
});
function median3(a) {
  const s = [...a].sort((x, y) => x - y);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

test('company: missing cash on the latest balance sheet is never read as zero', () => {
  const r = company({ noCashLatest: true });
  // the 2023 figure is more than 200 days old, so cash is unknown
  assert.equal(r.keyNumbers.cash, null);
  assert.equal(r.fairValue, null);
  assert.ok(r.fairValueIssues.some((t) => /cash/.test(t)));
  assert.equal(r.shariah.status, 'review');
  assert.ok(r.dataGaps.some((t) => /Cash is not reported/.test(t)));
});

test('company: debt reported before but missing now is unknown, not zero', () => {
  const r = company({ noDebtLatest: true });
  assert.equal(r.keyNumbers.debt, null);
  assert.equal(r.shariah.status, 'review');
  const sh = r.shariah.checks.find((c) => c.key === 'sh_debt');
  assert.equal(sh.pass, null);
});

test('company: missing capital spending leaves free cash flow unknown', () => {
  const r = company({ noCapex: true });
  assert.equal(r.keyNumbers.fcf, null);
});

test('company: Shariah income check uses reported interest, and fails at 5% or more', () => {
  assert.equal(company({ interestIncome: 0.01 }).shariah.checks.find((c) => c.key === 'sh_income').pass, true);
  assert.equal(company({ interestIncome: 0.06 }).shariah.status, 'fail');
});

test('company: no industry code gives REVIEW', () => {
  assert.equal(company({ sic: null }).shariah.status, 'review');
});

test('company: debt too small for the interest paid is treated as unknown', () => {
  const r = company({ debt: 50e6, interest: 120e6 });
  assert.equal(r.keyNumbers.debt, null);
  assert.equal(r.shariah.status, 'review');
  assert.ok(r.dataGaps.some((t) => /too small/.test(t)));
});

test('company: debt tagged as long-term debt including current maturities is read', () => {
  const r = company({ debtTag: 'LongTermDebtAndCapitalLeaseObligationsIncludingCurrentMaturities', debt: 900e6 });
  assert.equal(r.keyNumbers.debt, 900e6);
});

test('company: "cash and short-term investments" line adds the investments once', () => {
  const r = company({ combinedLine: true });
  assert.equal(r.keyNumbers.cash, 260e6); // 200M cash + 60M short-term investments
});
