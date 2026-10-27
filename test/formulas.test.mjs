// Automated checks for the critical formulas. Run: node --test test/
// Reference values are worked out by hand (shown in comments) or taken from published examples, not from the
// code under test.
import test from 'node:test';
import assert from 'node:assert/strict';
import { sma, ema, rsi, atr, macd, prepare, evaluate, simulateTrade } from '../lib/technical.js';
import { analyze, dcf, fiscalYearOf, yearsBetween, businessScreen, FAIR_MAX_RATIO, FactBook, splitsFromRestatements } from '../lib/engine.js';
import { netR, benchmarkTrades, portfolioSim, buyHold } from '../lib/backtest.js';
import { liveProof, LOG_FIELDS, PROOF_H, updateStock } from '../lib/signals.js';
import { monthEnds, pxRows, replaySplits, SNAP_FIELDS } from '../lib/longterm.js';
import { loadData, forwardTest, simulate, simulateSpy, xirrMonthly, nwMean } from '../lib/ltstats.js';

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
    if (opts.revenueSubset) {
      // contract revenue (a subset) for every year, the total only for the last three years
      add('RevenueFromContractWithCustomerExcludingAssessedTax', 'USD', { ...fy, val: rev * 0.7 });
      if (y >= 2022) add('Revenues', 'USD', { ...fy, val: rev });
    } else add('Revenues', 'USD', { ...fy, val: rev });
    if (opts.htm) add('DebtSecuritiesHeldToMaturityAmortizedCostAfterAllowanceForCreditLossCurrent', 'USD', { end: `${y}-12-31`, form: '10-K', filed: `${y + 1}-02-15`, val: opts.htm });
    add('OperatingIncomeLoss', 'USD', { ...fy, val: rev * 0.25 });
    add('NetIncomeLoss', 'USD', { ...fy, val: rev * 0.2 });
    add('IncomeLossFromContinuingOperationsBeforeIncomeTaxesExtraordinaryItemsNoncontrollingInterest', 'USD', { ...fy, val: rev * 0.25 });
    add('IncomeTaxExpenseBenefit', 'USD', { ...fy, val: rev * 0.05 });
    add('NetCashProvidedByUsedInOperatingActivities', 'USD', { ...fy, val: rev * 0.25 });
    if (!opts.noCapex && !(opts.noCapexRecent && y >= 2023)) add(opts.capexTag || 'PaymentsToAcquirePropertyPlantAndEquipment', 'USD', { ...fy, val: rev * (opts.capex ?? 0.05) });
    if (opts.da) add('DepreciationDepletionAndAmortization', 'USD', { ...fy, val: rev * opts.da });
    if (opts.amort) add('AmortizationOfIntangibleAssets', 'USD', { ...fy, val: rev * opts.amort });
    add('InterestExpense', 'USD', { ...fy, val: opts.interest ?? 20e6 });
    if (opts.interestIncome) add('InvestmentIncomeInterest', 'USD', { ...fy, val: rev * opts.interestIncome });
    if (opts.sbc) add('ShareBasedCompensation', 'USD', { ...fy, val: rev * opts.sbc });
    add('WeightedAverageNumberOfDilutedSharesOutstanding', 'shares', { ...fy, val: opts.shares ?? 100e6 });
    add('EarningsPerShareDiluted', 'USD/shares', { ...fy, val: (rev * 0.2) / (opts.shares ?? 100e6) });
    const inst = { end: `${y}-12-31`, form: '10-K', filed: `${y + 1}-02-15` };
    add('Assets', 'USD', { ...inst, val: rev * 2 });
    add('StockholdersEquity', 'USD', { ...inst, val: rev });
    if (!(opts.noCashLatest && y === 2024)) add('CashAndCashEquivalentsAtCarryingValue', 'USD', { ...inst, val: opts.cash ?? 200e6 });
    if (opts.nci) add('MinorityInterest', 'USD', { ...inst, val: opts.nci });
    if (opts.loans) add('NotesReceivableNet', 'USD', { ...inst, val: rev * 2 * opts.loans });
    if (!opts.noDebtEver && !(opts.noDebtLatest && y >= 2024)) add(opts.debtTag || 'LongTermDebt', 'USD', { ...inst, val: opts.debt ?? 400e6 });
    if (opts.combinedLine) add('CashCashEquivalentsAndShortTermInvestments', 'USD', { ...inst, val: 260e6 });
  });
  const sub = { name: 'TEST CO', sic: opts.sic === undefined ? 3571 : opts.sic, recentForms: ['10-K'], latest10K: { form: '10-K' } };
  return analyze({
    ticker: 'TST', cik: 1, listing: { exchange: 'Nasdaq' }, submissions: sub, facts,
    price: { price: opts.price ?? 50, monthly: [], splits: [], splitsKnown: true, source: 'test', priceTime: 'close on 2025-03-14' },
    fetchedAt: opts.fetchedAt || '2025-03-15T00:00:00Z', // 74 days after the last balance sheet, 1 day after the price
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

test('company: interest above 15% of the reported debt means part of the debt is unreadable (red data quality)', () => {
  const r = company({ debt: 1000e6, interest: 170e6 }); // 17% a year: no normal loan costs that much
  assert.equal(r.keyNumbers.debt, null);
  assert.equal(r.dataQuality.level, 'insufficient');
  assert.equal(r.verdict.code, 'UNRELIABLE');
  const ok = company({ debt: 1000e6, interest: 90e6 }); // 9%: plausible, the debt is kept
  assert.equal(ok.keyNumbers.debt, 1000e6);
  assert.ok(!ok.dataGaps.some((t) => /too small/.test(t)));
  // high interest, but whatever debt it implies (60M / 6% = 1B) is under 5% of a $50B market value: kept, with a note
  const small = company({ debt: 100e6, interest: 60e6, price: 500 });
  assert.equal(small.keyNumbers.debt, 100e6);
  assert.ok(small.dataGaps.some((t) => /small next to the market value/.test(t)));
  assert.notEqual(small.dataQuality.level, 'insufficient');
});

test('company: debt tagged as long-term debt including current maturities is read', () => {
  const r = company({ debtTag: 'LongTermDebtAndCapitalLeaseObligationsIncludingCurrentMaturities', debt: 900e6 });
  assert.equal(r.keyNumbers.debt, 900e6);
});

test('company: "cash and short-term investments" line adds the investments once', () => {
  const r = company({ combinedLine: true });
  assert.equal(r.keyNumbers.cash, 260e6); // 200M cash + 60M short-term investments
});

// ---------------------------------------------------------------- stock splits and share counts
function splitCompany({ ratio = 1.5, priceSplits = null } = {}) {
  // a 3-for-2 split in mid-2023: the 2023 10-K restates 2021 and 2022 share counts; 2019-2020 only exist pre-split
  const facts = { 'us-gaap': {}, dei: {} };
  const add = (tag, unit, f) => {
    facts['us-gaap'][tag] ??= { units: {} };
    (facts['us-gaap'][tag].units[unit] ??= []).push({ accn: '0000000000-24-000001', ...f });
  };
  for (const [i, y] of [2019, 2020, 2021, 2022, 2023, 2024].entries()) {
    const rev = 1000e6 * 1.05 ** i;
    const fy = { start: `${y}-01-01`, end: `${y}-12-31`, form: '10-K', filed: `${y + 1}-02-15` };
    for (const [tag, v] of [['Revenues', rev], ['NetIncomeLoss', rev * 0.2], ['NetCashProvidedByUsedInOperatingActivities', rev * 0.25], ['PaymentsToAcquirePropertyPlantAndEquipment', rev * 0.05], ['OperatingIncomeLoss', rev * 0.25]]) add(tag, 'USD', { ...fy, val: v });
    const post = y >= 2023; // filings from Feb 2024 on show post-split counts
    const sh = 100e6 * (post ? ratio : 1);
    add('WeightedAverageNumberOfDilutedSharesOutstanding', 'shares', { ...fy, val: sh });
    add('EarningsPerShareDiluted', 'USD/shares', { ...fy, val: (rev * 0.2) / sh });
    // the 10-K filed in Feb 2024 restates the two prior years
    if (y === 2023) for (const py of [2021, 2022]) {
      const prev = { start: `${py}-01-01`, end: `${py}-12-31`, form: '10-K', filed: '2024-02-15' };
      add('WeightedAverageNumberOfDilutedSharesOutstanding', 'shares', { ...prev, val: 100e6 * ratio });
      add('EarningsPerShareDiluted', 'USD/shares', { ...prev, val: (1000e6 * 1.05 ** (py - 2019) * 0.2) / (100e6 * ratio) });
    }
    const inst = { end: `${y}-12-31`, form: '10-K', filed: `${y + 1}-02-15` };
    add('Assets', 'USD', { ...inst, val: rev * 2 });
    add('StockholdersEquity', 'USD', { ...inst, val: rev });
    add('CashAndCashEquivalentsAtCarryingValue', 'USD', { ...inst, val: 100e6 });
    add('LongTermDebt', 'USD', { ...inst, val: 0 });
  }
  return analyze({
    ticker: 'SPL', cik: 1, listing: {}, submissions: { name: 'SPLIT CO', sic: 3571, latest10K: { form: '10-K' } }, facts,
    price: { price: 20, monthly: [], splits: priceSplits || [], splitsKnown: !!priceSplits, source: 'test' },
    fetchedAt: '2025-06-30T00:00:00Z',
  });
}

test('splits: a 3-for-2 split is read from restated filings and applied to older years', () => {
  const r = splitCompany();
  const shares = r.history.map((h) => h.shares);
  shares.forEach((v) => close(v, 150e6, 1, 'every year on the post-split basis'));
  const eps2019 = r.history.find((h) => h.year === 2019).eps;
  close(eps2019, (1000e6 * 0.2) / 150e6, 0.001, 'EPS divided by the same ratio');
  const dil = r.sections.quality.find((m) => m.key === 'dilution');
  close(dil.value, 0, 1e-6, 'no fake dilution from the split');
});

test('splits: a 2-for-1 split is also handled, and price-data splits take precedence when known', () => {
  splitCompany({ ratio: 2 }).history.forEach((h) => close(h.shares, 200e6, 1));
  // when the price feed lists the split, its date decides (same answer)
  splitCompany({ ratio: 2, priceSplits: [{ date: '2023-07-01', ratio: 2 }] }).history.forEach((h) => close(h.shares, 200e6, 1));
});

test('splits: no restatement means no adjustment', () => {
  splitCompany({ ratio: 1 }).history.forEach((h) => close(h.shares, 100e6, 1));
});

test('company: stock-based pay is a cost: it lowers owner cash flow and fair value', () => {
  const a = company();
  const b = company({ sbc: 0.05 });
  close(b.fairValue.ownerMargin, a.fairValue.ownerMargin - 0.05, 1e-4);
  assert.ok(b.fairValue.base < a.fairValue.base);
  assert.ok(b.fairValue.inputs.sbc > 0);
});

test('company: banks, insurers and brokers get no fair value and no valuation call', () => {
  const r = company({ sic: 6282 });
  assert.equal(r.verdict.code, 'FINANCIAL');
  assert.equal(r.fairValue, null);
  assert.equal(r.pricePlan, null);
  assert.equal(r.labels.valuation.label, 'Not rated (financial firm)');
  assert.ok(r.fairValueIssues[0].startsWith('financial company'));
});

test('company: old statements and old prices are flagged', () => {
  const r = company({ fetchedAt: '2025-09-30T00:00:00Z' });
  assert.ok(r.freshness.stale.includes('statements'));
  assert.ok(r.freshness.stale.includes('price'));
  assert.ok(r.warnings.some((w) => /latest balance sheet/.test(w)));
  assert.equal(company().freshness.stale.length, 0);
});

test('no look-ahead: the picture and plan on day i are the same with or without later data', () => {
  const daily = series(600, (i) => 60 + i * 0.05 + 6 * Math.sin(i / 9) + 2 * Math.sin(i / 2.3));
  const full = prepare(daily);
  let compared = 0;
  for (let i = 250; i < 590; i += 7) {
    const a = evaluate(full, i);
    const b = evaluate(prepare(daily.slice(0, i + 1)), i);
    const pick = (e) => JSON.stringify({ trend: e.trend, score: e.score, setup: { ...e.setup, trigger: undefined, exits: undefined }, sup: e.supports, res: e.resistances, R: e.R, A: e.A });
    assert.equal(pick(a), pick(b), `day ${i}`);
    compared++;
  }
  assert.ok(compared > 40);
});

// ---------------------------------------------------------------- backtest costs and benchmark
test('costs: a round-trip cost is charged against the risk, so it weighs more on tight stops', () => {
  close(netR(1, 0.05, 0.002), 1 - 0.04, 1e-12); // 0.2% cost on a 5% stop = 0.04R
  close(netR(1, 0.02, 0.008), 1 - 0.4, 1e-12); // 0.8% cost on a 2% stop = 0.4R
  close(netR(1, 0.001, 0.002), 1 - 0.4, 1e-12); // risk floored at 0.5% so a near-zero stop cannot blow up the cost
});

test('benchmark: trade return is R x risk; random entries in the stock and in SPY use the same span', () => {
  // a stock that rises exactly 1% per trading day and a market that rises 0.5% per day
  const d = Array.from({ length: 300 }, (_, k) => 20200101 + k);
  const series = [{ d, c: d.map((_, k) => 100 * 1.01 ** k) }];
  const market = { d, c: d.map((_, k) => 50 * 1.005 ** k) };
  const list = [
    { stock: 0, signal: String(d[100]), days: 4, R: 2, riskPct: 0.05 }, // +10% on the position
    { stock: 0, signal: String(d[150]), days: 9, R: -1, riskPct: 0.04 }, // -4%
  ];
  const b = benchmarkTrades(list, series, market, d[0], 7);
  close(b.trade.mean, (0.1 - 0.04) / 2, 1e-9);
  close(b.random.mean, (1.01 ** 5 - 1 + 1.01 ** 10 - 1) / 2, 1e-5); // 5 and 10 closes: days + 1, whatever day is drawn
  close(b.market.mean, (1.005 ** 5 - 1 + 1.005 ** 10 - 1) / 2, 1e-5); // SPY on a random day, same span (stored to 5 decimals)
  assert.equal(b.avgDays, 7);
  // same seed, same answer
  assert.deepEqual(benchmarkTrades(list, series, market, d[0], 7), b);
  // a trade on a stock with no price series is left out, not counted as zero
  assert.equal(benchmarkTrades([...list, { stock: 5, signal: String(d[10]), days: 3, R: 1, riskPct: 0.1 }], series, market, d[0], 7).trade.n, 2);
});

// ---------------------------------------------------------------- fair value: sensitivity and plausibility (round 3)
test('fair value moves the right way with growth, margin, discount rate, cash, debt and share count', () => {
  const p = { revenue0: 1000, margin: 0.2, g1: 0.08, r: 0.09, gT: 0.025, netCash: 0, shares: 10 };
  const v = (o) => dcf({ ...p, ...o }).perShare;
  const b = v({});
  close(v({ netCash: 500 }) - b, 50, 1e-9); // 500 more cash over 10 shares: 50 more a share
  close(v({ netCash: -500 }) - b, -50, 1e-9); // 500 more debt: 50 less a share
  close(v({ shares: 20 }), b / 2, 1e-9); // twice the shares (dilution): half the value per share
  assert.ok(v({ r: 0.1 }) < b && v({ r: 0.08 }) > b, 'a higher discount rate lowers the value');
  // strictly rising, with no jumps, as growth and margin rise
  let prev = -Infinity;
  for (let g = -0.05; g <= 0.2001; g += 0.01) {
    const x = v({ g1: g });
    assert.ok(x > prev, `growth ${g.toFixed(2)}`);
    prev = x;
  }
  prev = -Infinity;
  for (let m = 0.02; m <= 0.4001; m += 0.02) {
    const x = v({ margin: m });
    assert.ok(x > prev, `margin ${m.toFixed(2)}`);
    prev = x;
  }
  // value is proportional to margin (cash flow scales, cash does not)
  close(v({ margin: 0.4 }), 2 * b, 1e-9);
});

test('company: cash, debt, outside shareholders and share count change the fair value by the right amount', () => {
  const a = company();
  close(a.fairValue.base - company({ debt: 600e6 }).fairValue.base, 200e6 / 100e6, 0.011); // 200M more debt
  close(company({ cash: 400e6 }).fairValue.base - a.fairValue.base, 200e6 / 100e6, 0.011); // 200M more cash
  const n = company({ nci: 300e6 });
  close(a.fairValue.base - n.fairValue.base, 300e6 / 100e6, 0.011); // 300M of noncontrolling interests
  assert.equal(n.fairValue.inputs.nci, 300e6);
  close(company({ shares: 200e6 }).fairValue.base, a.fairValue.base / 2, 0.011); // twice the shares
});

test('company: a clean company has high data quality', () => {
  const r = company();
  assert.equal(r.dataQuality.level, 'high');
  assert.deepEqual(r.dataQuality.reasons, []);
});

test('company: capital spending far below depreciation withholds the fair value and the verdict', () => {
  const r = company({ da: 0.1, capex: 0.01 });
  assert.equal(r.fairValue, null);
  assert.ok(r.fairValueIssues.some((t) => /capital spending looks incomplete/.test(t)));
  assert.equal(r.dataQuality.level, 'insufficient');
  assert.equal(r.verdict.code, 'UNRELIABLE');
  assert.equal(r.pricePlan, null);
  // normal spending against the same depreciation is fine
  assert.equal(company({ da: 0.1, capex: 0.05 }).dataQuality.level, 'high');
  // amortization of acquired intangibles is not wear on equipment: no flag when depreciation alone is small
  assert.ok(company({ da: 0.1, amort: 0.09, capex: 0.01 }).fairValue);
});

test('company: oil and gas drilling and rental fleets count as capital spending', () => {
  for (const tag of ['PaymentsToExploreAndDevelopOilAndGasProperties', 'PaymentsToAcquireOilAndGasPropertyAndEquipment', 'PaymentsToAcquireEquipmentOnLease']) {
    const r = company({ capexTag: tag });
    close(r.fairValue.base, company().fairValue.base, 0.011);
  }
});

test('company: no free cash flow in the latest year means no fair value from older years', () => {
  const r = company({ noCapexRecent: true });
  assert.equal(r.fairValue, null);
  assert.ok(r.fairValueIssues.some((t) => /no free cash flow for the latest year/.test(t)));
});

test('company: an estimate 3x the price or more is rejected and the verdict withheld', () => {
  const base = company().fairValue.base; // about 80 at a price of 50
  const r = company({ price: base / (FAIR_MAX_RATIO + 0.5) });
  assert.equal(r.fairValue, null);
  assert.ok(r.fairValueRejected && r.fairValueRejected.ratio >= FAIR_MAX_RATIO);
  assert.equal(r.verdict.code, 'UNRELIABLE');
  assert.equal(r.pricePlan, null);
  assert.ok(company({ price: base / (FAIR_MAX_RATIO - 0.5) }).fairValue, 'just under the limit is kept');
});

test('company: debt larger than the value of the cash flows gives no fair value (never a negative one)', () => {
  const r = company({ debt: 9e9 });
  assert.equal(r.fairValue, null);
  assert.ok(r.fairValueIssues.some((t) => /larger than the value of the cash flows/.test(t)));
});

test('company: regulated utilities get no cash-flow valuation', () => {
  const r = company({ sic: 4911 });
  assert.equal(r.fairValue, null);
  assert.equal(r.labels.valuation.label, 'Not rated (utility)');
  assert.equal(r.dataQuality.level, 'limited');
});

test('company: a large lending book is a data-quality limit', () => {
  const r = company({ loans: 0.3 });
  assert.equal(r.dataQuality.level, 'limited');
  assert.ok(r.dataQuality.reasons.some((t) => /lending business/.test(t)));
});

test('company: statements more than 9 months old withhold the verdict', () => {
  const r = company({ fetchedAt: '2025-10-15T00:00:00Z' });
  assert.equal(r.dataQuality.level, 'insufficient');
  assert.ok(r.dataQuality.reasons.some((t) => /statements are more than 9 months old/.test(t)));
  assert.equal(r.verdict.code, 'UNRELIABLE');
});

test('company: total revenues lead over a smaller contract-revenue subset with a longer history', () => {
  const r = company({ revenueSubset: true });
  const last = r.history[r.history.length - 1];
  close(last.revenue, 1000e6 * 1.1 ** 5, 1); // the total, not 70% of it
});

test('company: held-to-maturity debt securities count as short-term investments', () => {
  const a = company();
  const b = company({ htm: 300e6 });
  close(b.keyNumbers.cash - a.keyNumbers.cash, 300e6, 1);
});

// ---------------------------------------------------------------- portfolio replay: growth and drawdown (round 3)
test('portfolio replay: size from the stop, cost per round trip, booked at the exit', () => {
  const dates = Array.from({ length: 20 }, (_, k) => 20240101 + k);
  const win = { signal: String(dates[1]), days: 3, R: 2, riskPct: 0.05, score: 60 };
  const r = portfolioSim([win], dates, { risk: 0.01, maxPositions: 10, maxWeight: 0.2, cost: 0.002 });
  // 1% risk with a 5% stop = 20% of equity; +10% on the position minus 0.2% cost
  close(r.endValue, 1 + 0.2 * (0.1 - 0.002), 1e-4);
  assert.equal(r.taken, 1);
  assert.equal(r.maxDrawdown, 0);
  close(r.cagr, (1 + 0.2 * 0.098) ** (252 / 18) - 1, 1e-4); // 18 trading days from the fill to the last date
  const loss = portfolioSim([{ ...win, R: -1 }], dates, { cost: 0.002 });
  close(loss.maxDrawdown, 0.2 * (0.05 + 0.002), 1e-4);
});

test('portfolio replay: position limits and no borrowing', () => {
  const dates = Array.from({ length: 30 }, (_, k) => 20240101 + k);
  const six = Array.from({ length: 6 }, (_, j) => ({ signal: String(dates[2]), days: 5, R: 1, riskPct: 0.05, score: 50 + j }));
  const a = portfolioSim(six, dates, { maxPositions: 10 });
  assert.equal(a.taken, 5); // 5 x 20% uses all the cash; the sixth does not fit
  assert.equal(a.skipped, 1);
  const b = portfolioSim(six, dates, { maxPositions: 3 });
  assert.equal(b.taken, 3);
  // a trade that exits on its fill day is booked at once
  const c = portfolioSim([{ signal: String(dates[2]), days: 0, R: 1, riskPct: 0.05 }], dates, { cost: 0 });
  close(c.endValue, 1 + 0.2 * 0.05, 1e-6);
});

test('buy and hold: growth, worst fall and reinvested dividends', () => {
  const d = [1, 2, 3, 4];
  const c = [100, 110, 99, 120];
  const p = buyHold(d, c, 1);
  close(p.endValue, 1.2, 1e-9);
  close(p.maxDrawdown, 1 - 99 / 110, 1e-4);
  const t = buyHold(d, c, 1, [{ date: 3, amount: 2 }]);
  close(t.endValue, (0.01 + (0.01 * 2) / 99) * 120, 1e-4);
});

test('benchmark: random windows can be kept inside a period', () => {
  // rises 1% a day for 150 days, then falls 1% a day
  const d = Array.from({ length: 300 }, (_, k) => 20200101 + k);
  const c = d.map((_, k) => (k < 150 ? 100 * 1.01 ** k : 100 * 1.01 ** 149 * 0.99 ** (k - 149)));
  const list = Array.from({ length: 40 }, (_, j) => ({ stock: 0, signal: String(d[10 + j]), days: 4, R: 1, riskPct: 0.05 }));
  const b = benchmarkTrades(list, [{ d, c }], null, d[0], 3, d[149]);
  close(b.random.mean, 1.01 ** 5 - 1, 1e-6); // every window ends by day 149, so all are rising windows
});

test('company: no debt tags with real interest expense means unknown debt, not zero', () => {
  const quiet = company({ noDebtEver: true, interest: 1e6 }); // little interest: no debt is the likely truth
  assert.equal(quiet.keyNumbers.debt, 0);
  assert.notEqual(quiet.dataQuality.level, 'insufficient');
  const r = company({ noDebtEver: true, interest: 30e6 }); // 30M of interest with no debt tagged
  assert.equal(r.keyNumbers.debt, null);
  assert.equal(r.dataQuality.level, 'insufficient');
  assert.ok(r.warnings.some((w) => /no borrowings are tagged/.test(w)));
});

test('live record gate: each trade followed for 20 trading days, months as the results, proven only after enough months beat SPY', () => {
  // 400 days, SPY up 0.1% a day. A record's fill day is index f; SPY is measured from the close before it (f - 1).
  const dates = Array.from({ length: 400 }, (_, i) => new Date(Date.UTC(2026, 0, 1) + i * 86400000).toISOString().slice(0, 10));
  const C = dates.map((_, i) => 100 * 1.001 ** i);
  const spy = { dates, C };
  const mk = ({ f, status = 'closed', R = null, days = 10, hR = null, riskPct = 0.05, shariah = 'pass' }) => {
    const r = Array(LOG_FIELDS.length).fill(null);
    const set = (k, v) => { r[LOG_FIELDS.indexOf(k)] = v; };
    set('ticker', 'T' + f); set('signal', dates[f - 1]); set('fillDate', status === 'pending' ? null : dates[f]); set('status', status);
    set('shariah', shariah); set('R', R); set('riskPct', riskPct); set('days', status === 'closed' ? days : null); set('hR', hR);
    set('exitDate', status === 'closed' ? dates[f + days] : null);
    return r;
  };
  const spy11 = 1.001 ** 11 - 1; // a 10-day trade: SPY from the close before the fill to the exit
  // 8 months of trades (a fill every other day, January to August), alternating +1R and +0.5R on 5% risk:
  // +3.75% a trade before costs, far above SPY's 1.1% over the same days
  const strong = { started: dates[0], records: Array.from({ length: 121 }, (_, k) => mk({ f: 1 + 2 * k, R: k % 2 ? 1 : 0.5 })) };
  const p = liveProof(strong, spy, { cost: 0.002 });
  assert.equal(p.months, 8);
  assert.equal(p.n, 121);
  assert.equal(p.horizon, PROOF_H);
  assert.ok(Math.abs(p.avgTrade - (0.0375 - 0.002)) < 0.002, `average trade after costs ${p.avgTrade}`);
  assert.ok(Math.abs(p.avgSpy - spy11) < 1e-4, `SPY over the same days ${p.avgSpy}`);
  assert.ok(p.ciLow > 0 && p.proven, 'beats SPY in 8 months: proven');
  // the same edge over 4 months is not enough
  const four = liveProof({ records: strong.records.filter((r) => r[LOG_FIELDS.indexOf('fillDate')] < '2026-05-01') }, spy);
  assert.equal(four.months, 4);
  assert.equal(four.proven, false);
  // trades that lose to SPY are never proven, however many months
  const weak = liveProof({ records: Array.from({ length: 121 }, (_, k) => mk({ f: 1 + 2 * k, R: k % 2 ? 0.3 : -0.2 })) }, spy);
  assert.ok(weak.months === 8 && weak.avgDiff < 0 && !weak.proven, 'loses to SPY: not proven');
  // early exits do not count early: trades filled less than 20 days ago wait, even the ones already stopped out
  const young = liveProof({ records: Array.from({ length: 50 }, (_, k) => mk({ f: 385 + (k % 10), R: -1, days: 1 })) }, spy);
  assert.ok(young.n === 0 && young.months === 0 && young.waiting === 50 && !young.proven, `young stop-outs wait: ${JSON.stringify(young)}`);
  // which trades count, and how: one month of mature trades (minTrades 1 so the single month counts)
  const mixed = { records: [
    mk({ f: 300, status: 'open', R: 0.9, hR: 0.5, riskPct: 0.04 }), // still open after 20 days: its 20-day result hR
    mk({ f: 300, R: -1, days: 5, riskPct: 0.04 }), // closed inside the 20 days: the trade itself
    mk({ f: 300, R: 2, days: 30, hR: 0.8, riskPct: 0.04 }), // closed after 30 days: still its 20-day result
    mk({ f: 300, R: 2, days: 30, riskPct: 0.04 }), // older record without hR: cannot be measured, left out
    mk({ f: 390, R: -1, days: 1 }), mk({ f: 395, status: 'open', R: 0.2 }), // filled under 20 days ago: waiting
    mk({ f: 300, R: 3, days: 5, shariah: 'fail' }), mk({ f: 300, status: 'pending' }), // not halal, not filled: ignored
  ] };
  const m = liveProof(mixed, spy, { minTrades: 1, cost: 0.002 });
  assert.ok(m.n === 3 && m.months === 1 && m.waiting === 2, `counted ${JSON.stringify(m)}`);
  close(m.avgTrade, (0.5 * 0.04 - 1 * 0.04 + 0.8 * 0.04) / 3 - 0.002, 1e-4, 'average of the three 20-day results after costs');
  close(m.avgSpy, (2 * (C[320] / C[299] - 1) + (C[305] / C[299] - 1)) / 3, 1e-4, 'SPY to day 20, or to the exit');
  assert.ok(m.ciLow === null && !m.proven, 'one month: no range, not proven');
  // no market data: nothing can be proven
  assert.equal(liveProof(strong, null).proven, false);
});

test('signal log: each filled trade also gets its result cut off 20 trading days after the fill (hR)', () => {
  const daily = series(300, () => 100); // flat: stop and target are never touched
  const P = prepare(daily);
  const mkRec = (i) => {
    const r = Array(LOG_FIELDS.length).fill(null);
    const set = (k, v) => { r[LOG_FIELDS.indexOf(k)] = v; };
    set('ticker', 'FLAT'); set('signal', P.dates[i]); set('setup', 'pullback'); set('fill', 'stop');
    set('entry', 100.5); set('maxEntry', 103.25); set('stop', 95); set('t1', 120); set('t2', 130); set('shariah', 'pass'); set('status', 'pending');
    return r;
  };
  const F = Object.fromEntries(LOG_FIELDS.map((k, j) => [k, j]));
  const { records } = updateStock([mkRec(260), mkRec(290)], P, null, {});
  const [a, b] = records;
  // signal at 260: filled at 100.5 on bar 261, still open at the end (bar 299), but 20 bars after the fill it was at 100
  assert.equal(a[F.status], 'open');
  close(a[F.hR], (100 - 100.5) / (100.5 - 95), 0.001, 'R at the close 20 trading days after the fill');
  // signal at 290: fewer than 20 bars since the fill, so no 20-day result yet
  assert.equal(b[F.status], 'open');
  assert.equal(b[F.hR], null);
});

// ---------------------------------------------------------------- long-term backtest
test('splits: dated at the first filing whose cover share count jumped, not at the next annual report', () => {
  const ann = (start, end, val, filed, form = '10-K') => ({ start, end, val, filed, form, accn: 'a-' + filed, fy: 0, fp: 'FY' });
  const cov = (end, val, filed, form) => ({ end, val, filed, form, accn: 'a-' + filed });
  const facts = {
    'us-gaap': { WeightedAverageNumberOfDilutedSharesOutstanding: { units: { shares: [
      ann('2022-04-01', '2023-03-31', 26.0e6, '2023-05-20'), ann('2022-04-01', '2023-03-31', 26.0e6, '2024-05-20'),
      ann('2023-04-01', '2024-03-31', 25.6e6, '2024-05-20'),
      ann('2023-04-01', '2024-03-31', 153.6e6, '2025-05-22'), ann('2024-04-01', '2025-03-31', 152.0e6, '2025-05-22'),
    ] } } },
    dei: { EntityCommonStockSharesOutstanding: { units: { shares: [
      cov('2024-05-09', 25.4e6, '2024-05-20', '10-K'), cov('2024-07-20', 25.4e6, '2024-07-25', '10-Q'),
      cov('2024-10-11', 151.9e6, '2024-10-24', '10-Q'), cov('2025-01-16', 151.7e6, '2025-01-30', '10-Q'), cov('2025-05-09', 149.4e6, '2025-05-22', '10-K'),
    ] } } },
  };
  const s = splitsFromRestatements(new FactBook(facts));
  assert.equal(s.length, 1);
  close(s[0].ratio, 6, 0.01, '6-for-1');
  assert.equal(s[0].date, '2024-10-24', 'the first quarterly report with the new count, not the next annual report');
  // seeing only what was filed by a date: the restatement is not known yet, so no split
  assert.equal(splitsFromRestatements(new FactBook(facts, '2025-01-31')).length, 0);
  // the replay takes every split the filings reveal, and leaves out a company whose share count needed market data
  assert.equal(replaySplits(facts, { sharesSource: 'market data (Nasdaq)' }), null);
  const withRecent = replaySplits(facts, { sharesSource: 'shares outstanding as of 2026-07-09, adjusted for a 3-for-1 split' });
  assert.equal(withRecent.length, 2);
  assert.equal(withRecent[1].ratio, 3);
});

test('long-term backtest: month-end prices, forward returns and the shortlist portfolio', () => {
  // month-ends: last trading day of each month, with the next session's close for the order
  const daily = [
    { date: '2020-01-30', c: 10 }, { date: '2020-01-31', c: 11 }, { date: '2020-02-03', c: 12 }, { date: '2020-02-28', c: 13 }, { date: '2020-03-02', c: 14 },
  ];
  assert.deepEqual(monthEnds(daily), [1, 3, 4]);
  assert.deepEqual(pxRows(daily), [['2020-01-31', 11, 12], ['2020-02-28', 13, 14], ['2020-03-02', 14, null]]);
  // xirr: 100 a month for 12 months growing 1% a month is 12.7% a year
  const dep = Array.from({ length: 12 }, (_, k) => [k, 100]);
  const fv = dep.reduce((s, [k, a]) => s + a * 1.01 ** (12 - k), 0);
  close(xirrMonthly(dep, fv, 12), 1.01 ** 12 - 1, 1e-6, 'money-weighted return');
  // Newey-West: the mean is the mean; a steady series has no spread
  assert.equal(nwMean([0.1, 0.1, 0.1, 0.1], 2).mean, 0.1);
  // a toy market: SPY flat; stock A on the shortlist rises 2% a month; stock B (not on it) falls 1% a month
  const months = 40;
  const mk = (t, f, snapAt) => JSON.stringify({ t, rows: Array.from({ length: months }, (_, k) => snapAt(k)).filter(Boolean),
    px: Array.from({ length: months }, (_, k) => [`20${String(10 + Math.floor(k / 12)).padStart(2, '0')}-${String((k % 12) + 1).padStart(2, '0')}-28`, f(k), f(k + 0.03)]) });
  const date = (k) => `20${String(10 + Math.floor(k / 12)).padStart(2, '0')}-${String((k % 12) + 1).padStart(2, '0')}-28`;
  const snap = (k, verdict, upside, extra = {}) => SNAP_FIELDS.map((f) => ({ date: date(k), verdict, quality: 80, health: 80, valuation: 'U', fair: null, buyBelow: null, trimAbove: null, dq: 'H', shariah: 'pass', price: null, upside, confidence: 'High', ...extra })[f]);
  const lines = [
    JSON.stringify({ t: '$SPY', px: Array.from({ length: months }, (_, k) => [date(k), 100, 100]) }),
    mk('A', (k) => 10 * 1.02 ** k, (k) => snap(k, 'BUY', 0.5)),
    mk('B', (k) => 10 * 0.99 ** k, (k) => snap(k, 'PASS', -0.1)),
  ];
  const D = loadData(lines);
  assert.equal(D.months.length, months);
  const f = forwardTest(D, { h: 12 });
  close(f.picks, 1.02 ** 12 / 1.02 ** 0.03 - 1, 1e-3, 'shortlist pick: A over 12 months, bought the next session');
  close(f.spy, 0, 1e-9);
  assert.ok(f.vsUniverse.mean > 0 && f.monthsBeatingSpy === 1, 'A beats the average stock and SPY every month');
  const p = simulate(D, { from: 0, to: months - 1, monthly: 300 });
  assert.equal(p.deposited, 300 * (months - 1));
  assert.ok(p.positions === 1 && p.fundShare > 0.5, `one stock is capped (2 months of money, then 10% of the portfolio); the rest goes to the fund: ${JSON.stringify(p)}`);
  // twelve rising shortlist stocks: the money is spread over them and grows
  const many = [lines[0], ...Array.from({ length: 12 }, (_, j) => mk('S' + j, (k) => 10 * 1.02 ** k, (k) => snap(k, 'BUY', 0.5 - j / 100)))];
  const pm = simulate(loadData(many), { from: 0, to: months - 1, monthly: 300 });
  assert.ok(pm.positions >= 10 && pm.yearly > 0.2 && pm.fundShare < 0.1, `spread over the shortlist and growing: ${JSON.stringify(pm)}`);
  const s = simulateSpy(D, { from: 0, to: months - 1, monthly: 300 });
  assert.ok(Math.abs(s.yearly) < 0.01, 'flat SPY earns about nothing (fees only)');
  // selling rules: A turns weak (verdict AVOID_WEAK) at month 20 while below its average cost
  const lines2 = [lines[0], mk('A', (k) => (k < 20 ? 10 * 1.02 ** k : 10 * 1.02 ** 20 * 0.6), (k) => snap(k, k < 20 ? 'BUY' : 'AVOID_WEAK', 0.5))];
  const D2 = loadData(lines2);
  const healthy = simulate(D2, { from: 0, to: 30, monthly: 300, rule: 'healthy' });
  const wait = simulate(D2, { from: 0, to: 30, monthly: 300, rule: 'wait' });
  assert.ok(healthy.sellsBusiness === 1 && wait.sellsBusiness === 0, `healthy sells the weakened business, wait holds a loser: ${healthy.sellsBusiness}/${wait.sellsBusiness}`);
  // Shariah failure: every rule sells
  const D3 = loadData([lines[0], mk('A', (k) => 10, (k) => snap(k, k < 5 ? 'BUY' : 'AVOID_SHARIAH', 0.5, { shariah: k < 5 ? 'pass' : 'fail' }))]);
  assert.equal(simulate(D3, { from: 0, to: 10, monthly: 300, rule: 'never' }).positions, 0);
});
