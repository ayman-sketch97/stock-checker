// Accounting red-flag screen: pure numbers from SEC company facts. Run: node --test test/redflags.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { redflagMetrics, redflagCard } from '../lib/redflags.js';

const fl = (y, v) => ({ start: y + '-01-01', end: y + '-12-31', val: v, form: '10-K', filed: (y + 1) + '-02-01' });
const ins = (y, v) => ({ end: y + '-12-31', val: v, form: '10-K', filed: (y + 1) + '-02-01' });
const facts = (o = {}) => ({ 'us-gaap': {
  NetIncomeLoss: { units: { USD: [fl(2021, 100), fl(2022, 110), fl(2023, 120)] } },
  NetCashProvidedByUsedInOperatingActivities: { units: { USD: [fl(2021, 80), fl(2022, 81), fl(2023, 82)] } },
  Revenues: { units: { USD: [fl(2022, 1000), fl(2023, 1100)] } },
  AccountsReceivableNetCurrent: { units: { USD: [ins(2022, 100), ins(2023, 150)] } },
  Assets: { units: { USD: [ins(2022, 2000), ins(2023, 2100)] } },
  ...o } });

test('the three ratios', () => {
  const m = redflagMetrics(facts());
  assert.equal(m.ok, true);
  assert.ok(Math.abs(m.conv - 243 / 330) < 1e-9);
  assert.ok(Math.abs(m.accruals - (120 - 82) / 2050) < 1e-9);
  assert.ok(Math.abs(m.recGap - 40) < 1e-6);
});
test('a newer tag wins over an old dropped one', () => {
  const m = redflagMetrics(facts({ SalesRevenueNet: { units: { USD: [fl(2015, 5), fl(2016, 6)] } } }));
  assert.ok(Math.abs(m.recGap - 40) < 1e-6);
});
test('quarterly or non-10-K values are ignored; missing stays unknown', () => {
  const f = facts({ AccountsReceivableNetCurrent: { units: { USD: [{ ...ins(2023, 150), form: '10-Q' }] } } });
  assert.equal(redflagMetrics(f).recGap, null);
  assert.equal(redflagMetrics({ 'us-gaap': {} }).ok, false);
});
test('peer comparison needs 8 peers, and wording has no verdicts', () => {
  const m = redflagMetrics(facts());
  const few = redflagCard(m, [m, m], 'x');
  assert.ok(few.checks.every((c) => c.unusual === null));
  const peers = Array.from({ length: 10 }, () => ({ ok: true, conv: 1.2, accruals: -0.02, recGap: 2 }));
  const c = redflagCard(m, peers, 'x');
  assert.equal(c.checks.find((k) => k.key === 'conv').unusual, true);
  assert.equal(c.checks.find((k) => k.key === 'accruals').unusual, true);
  assert.ok(!/buy|sell|fraud/i.test(JSON.stringify(c)));
});
