// The Treasury-linked discount rate study (PREREGISTERED.md, section 8): the rules and the comparison's own logic.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadYields, yieldFor, linkedRule, fixedYieldRule, studyRules, extremeRules, FLOOR, CAP } from '../lib/rates.js';
import { stateOfRow, tierOfRow, conditions, splitLines, extremes, LAST_START } from '../tools/rate-compare.mjs';
import { SNAP_FIELDS } from '../lib/longterm.js';

const csv = 'observation_date,GS10\n2020-05-01,0.67\n2020-06-01,0.73\n2020-07-01,0.62\n2026-09-01,4.99\n2026-10-01,5.13\n';
const near = (a, b) => Math.abs(a - b) < 1e-12;

test('rate study: the yield of the month before the valuation, never a later one', () => {
  const Y = loadYields(csv);
  assert.equal(Y.get('2026-10'), 0.0513);
  assert.ok(near(yieldFor(Y, '2020-07-30'), 0.0073), 'a valuation on 30 July uses the June average, fully known by then');
  assert.ok(near(yieldFor(Y, '2026-11-02'), 0.0513));
  assert.ok(near(yieldFor(Y, '2020-08-31', 3), (0.0062 + 0.0073 + 0.0067) / 3), 'smoothed: the 12 (here 3) months ending the month before');
  assert.throws(() => yieldFor(Y, '2021-03-31'), /no 10-year yield/, 'a missing month never falls back silently');
});

test('rate study: B is the yield plus 4, 5 or 6 points, between the floor and the cap', () => {
  const Y = loadYields(csv);
  const B = linkedRule(Y);
  assert.ok(near(B(0.09, '2026-11-02'), 0.0513 + 0.05), 'typical business: yield + 5 points');
  assert.ok(near(B(0.08, '2026-11-02'), 0.0513 + 0.04));
  assert.equal(B(0.08, '2020-07-30'), FLOOR, 'a strong business in July 2020 would be 4.73%: held at the 5.5% floor');
  assert.equal(fixedYieldRule(0.15)(0.1), CAP, '15% plus 6 points is capped at 15%');
  const S = studyRules(Y, 0.0294);
  assert.ok(near(S.S1(0.09, '2026-11-02'), 0.0513 + 0.05 + 0.0106), 'S1 centred: 1.06 points higher');
  assert.ok(near(S.S2(0.09, '2026-11-02'), 0.09 + 0.5 * (0.0513 - 0.04)), 'S2 half link');
  assert.equal(S.S4(0.08, '2020-07-30'), 0.065, 'S4 floor 6.5%');
  assert.ok(near(S.S5(0.09, '2026-11-02'), 0.0513 + 0.04) && near(S.S6(0.09, '2026-11-02'), 0.0513 + 0.06));
  const E = extremeRules();
  assert.ok(near(E['y5.13'](0.09), 0.1013) && near(E.Aplus1(0.09), 0.1) && Object.keys(E).length === 14);
  assert.ok(near(E['y4.88'](0.08), 0.0888) && near(E['y5.38'](0.1), 0.1138), 'a quarter point either side of today');
});

test('rate study: decisions, kinds of business and the conditions of section 8', () => {
  const row = (o) => SNAP_FIELDS.map((k) => ({ date: '2026-10-30', verdict: 'BUY', quality: 80, health: 75, valuation: 'U', fair: 100, buyBelow: 85, trimAbove: 140, dq: 'H', shariah: 'pass', price: 80, upside: 0.25, confidence: 'High', cap: 20000, growth: 50, trend: 'up', ...o })[k]);
  assert.equal(stateOfRow(row({})), 'buy');
  assert.equal(stateOfRow(row({ price: 90 })), 'hold');
  assert.equal(stateOfRow(row({ price: 150 })), 'trim');
  assert.equal(stateOfRow(row({ verdict: 'AVOID_WEAK' })), 'sell');
  assert.equal(stateOfRow(row({ shariah: 'review' })), 'hold', 'no buy zone without a clear halal pass');
  assert.deepEqual([tierOfRow(row({})), tierOfRow(row({ cap: 5000 })), tierOfRow(row({ health: 30 }))], [0.08, 0.09, 0.1]);
  const W = (from, value, yearly, rnd, spy, worstFall = -0.3) => ({ from, value, yearly, rnd, spy, worstFall });
  const A = { full: { worstFall: -0.3 }, windows: [W('2017-01', 100, 0.1, 0.08, 0.09), W('2018-01', 100, 0.1, 0.08, 0.09), W('2020-01', 100, 0.1, 0.08, 0.09)] };
  const better = { full: { worstFall: -0.31 }, windows: [W('2017-01', 110, 0.12, 0.08, 0.09), W('2018-01', 105, 0.11, 0.08, 0.09), W('2020-01', 101, 0.1, 0.08, 0.09)] };
  const c = conditions(A, better);
  assert.deepEqual([c.all.wins, c.all.losses, c.all.c1, c.all.c2, c.c3, c.h1.c3, c.h2.c3, c.c4], [3, 0, true, true, true, true, true, true]);
  const deeper = conditions(A, { ...better, full: { worstFall: -0.33 } });
  assert.equal(deeper.c3, false, 'a worst fall 3 points deeper fails condition 3');
  const oneHalf = conditions(A, { ...better, windows: [W('2017-01', 120, 0.12, 0.08, 0.09), W('2018-01', 120, 0.12, 0.08, 0.09), W('2020-01', 90, 0.08, 0.08, 0.09)] });
  assert.deepEqual([oneHalf.all.c1, oneHalf.h2.c1, oneHalf.c4], [true, false, false], 'better overall but worse in the second half: condition 4 fails');
  const fallsInHalf = conditions(A, { ...better, windows: [W('2017-01', 110, 0.12, 0.08, 0.09), W('2018-01', 105, 0.11, 0.08, 0.09), W('2020-01', 101, 0.1, 0.08, 0.09, -0.36)] });
  assert.deepEqual([fallsInHalf.c3, fallsInHalf.h1.c3, fallsInHalf.h2.c3, fallsInHalf.c4], [true, true, false, false], 'a period starting in the second half falls 6 points deeper: condition 4 fails');
  const late = conditions(A, { ...better, windows: [...better.windows, W(LAST_START.replace(/10$/, '11'), 50, 0, 0.08, 0.09)] });
  assert.equal(late.all.n, 3, 'a period starting after October 2021 is not one section 8 names');
  const none = conditions({ full: { worstFall: -0.3 }, windows: [] }, { full: { worstFall: -0.3 }, windows: [] });
  assert.deepEqual([none.all.c1, none.all.c2, none.c4], [false, false, false], 'no periods: nothing passes');
  // a quarter point either side of today's yield: the decisions that change
  const lastBy = (bb) => ({ 'y4.88': row({ buyBelow: bb[0] }), 'y5.13': row({ buyBelow: bb[1] }), 'y5.38': row({ buyBelow: bb[2] }) });
  const X = extremes([{ t: 'EDGE', rows: [row({})], last: lastBy([86, 81, 79]) }, { t: 'FIRM', rows: [row({})], last: lastBy([95, 90, 86]) }]);
  assert.deepEqual([X.nearToday.companies, X.nearToday.changed, X.nearToday.examples[0].t, X.nearToday.examples[0].at538], [2, 1, 'EDGE', 'hold']);
  // the variants are split into the 10-year data format, one line per company each, with SPY and skips kept
  const { by, comps } = splitLines([JSON.stringify({ t: '$SPY', px: [] }), JSON.stringify({ t: 'X', skip: 'financial' }), JSON.stringify({ t: 'AAA', rows: [row({})], by: { B: [row({ fair: 90 })] }, px: [] })]);
  assert.equal(comps.length, 1);
  assert.equal(JSON.parse(by.B[2]).rows[0][SNAP_FIELDS.indexOf('fair')], 90);
  assert.equal(by.A.length, 3);
});
