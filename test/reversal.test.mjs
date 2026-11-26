// Tests for the reversal / pullback plan: the rules are read out of index.html between the REVERSAL markers.
// Run: node --test test/reversal.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const html = fs.readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const m = /\/\/ REVERSAL:BEGIN[^\n]*\n([\s\S]*?)\/\/ REVERSAL:END/.exec(html);
assert.ok(m, 'REVERSAL markers are in index.html');
const { revSetup, revQuality, revPlan, revThesis, REV_DEFAULTS } = new Function(`${m[1]}; return { revSetup, revQuality, revPlan, revThesis, REV_DEFAULTS };`)();

const bar = (i, o, h, l, c) => [`2026-01-${String(i).padStart(2, '0')}`, o, h, l, c, 1e6];
const flat = (n, px) => Array.from({ length: n }, (_, i) => bar(i + 1, px, px + 1, px - 1, px));
test('setup: 25% under the high with a bullish reversal bar is active', () => {
  const c = [...flat(40, 100), bar(41, 78, 79, 74, 75), bar(42, 75, 79, 74, 78)];
  // prior high 79, last close 78 is not above it: no reversal bar
  assert.equal(revSetup(c, 20).reversalBar, false);
  const c2 = [...flat(40, 100), bar(41, 78, 79, 74, 75), bar(42, 75, 82, 74, 80)];
  const s = revSetup(c2, 20);
  assert.ok(s.reversalBar && s.deep && s.active, JSON.stringify(s));
  assert.ok(Math.abs(s.pullbackPct - (101 - 80) / 101 * 100) < 1e-9);
});
test('setup: a shallow pullback is not active even with a reversal bar', () => {
  const c = [...flat(40, 100), bar(41, 95, 96, 94, 95), bar(42, 95, 100, 94, 99)];
  const s = revSetup(c, 20);
  assert.ok(s.reversalBar && !s.deep && !s.active);
});
test('setup: too few candles gives no verdict, not a pass', () => {
  assert.equal(revSetup(flat(10, 100), 20).ok, false);
});
const dd = (o = {}) => ({
  sections: { quality: [{ key: 'op_margin', value: 0.2 }, { key: 'fcf_margin', value: 0.1 }] },
  labels: { health: { score: 60 }, growth: { rate: 0.05 }, quality: { score: 70 } }, dataQuality: { level: 'high' }, ...o,
});
test('quality: all checks pass', () => assert.equal(revQuality(dd()).flag, 'pass'));
test('quality: missing data is unknown, never pass', () => {
  const q = revQuality(dd({ sections: { quality: [{ key: 'op_margin', value: 0.2 }] } }));
  assert.equal(q.flag, 'unknown');
  assert.ok(q.reasons.some((x) => /unknown/.test(x)));
});
test('quality: a failed check fails, insufficient data is unknown', () => {
  assert.equal(revQuality(dd({ labels: { health: { score: 30 }, growth: { rate: 0.05 }, quality: { score: 70 } } })).flag, 'fail');
  assert.equal(revQuality(dd({ dataQuality: { level: 'insufficient' } })).flag, 'unknown');
});
test('plan: cap splits into three equal tranches, adds at -10% and -20%, average and target', () => {
  const p = revPlan({ settings: {}, portfolio: 100000, close: 100, supports: [] });
  assert.equal(p.capDollars, 5000);
  assert.ok(Math.abs(p.tranche - 5000 / 3) < 1e-9);
  assert.deepEqual(p.rows.map((r) => Math.round(r.price * 100) / 100), [100, 90, 80]);
  const shares = p.rows.reduce((a, r) => a + r.shares, 0);
  assert.ok(Math.abs(p.avg - 5000 / shares) < 1e-9);
  assert.ok(Math.abs(p.target - p.avg * 1.25) < 1e-9);
  assert.equal(p.blocks.length, 0);
});
test('plan: the portfolio limit lowers the cap, never raises it', () => {
  assert.equal(revPlan({ settings: { capPct: 5 }, policyCap: 0.03, portfolio: 100000, close: 100 }).capDollars, 3000);
  assert.equal(revPlan({ settings: { capPct: 5 }, policyCap: 0.1, portfolio: 100000, close: 100 }).capDollars, 5000);
});
test('plan: adds are blocked when the cap is reached or all tranches are used', () => {
  assert.equal(revPlan({ portfolio: 100000, close: 100, ownedCost: 5000 }).blocks.length, 1);
  assert.equal(revPlan({ portfolio: 100000, close: 100, tranchesBought: 3 }).blocks.length, 1);
  assert.equal(revPlan({ portfolio: 100000, close: 100, ownedCost: 1000, tranchesBought: 1 }).blocks.length, 0);
});
test('plan: no portfolio value gives no dollar amounts; support within 4% is shown, no stop is ever produced', () => {
  const p = revPlan({ portfolio: null, close: 100, supports: [91.5, 70] });
  assert.equal(p.capDollars, null);
  assert.equal(p.rows[1].support, 91.5);
  assert.equal(p.rows[2].support, null);
  assert.ok(!('stop' in p));
});
test('thesis: warnings come only from the checker numbers', () => {
  assert.deepEqual(revThesis(dd(), revQuality(dd())), []);
  const bad = dd({ sections: { quality: [{ key: 'op_margin', value: 0.2 }, { key: 'fcf_margin', value: -0.1 }] } });
  assert.ok(revThesis(bad, revQuality(bad)).length >= 2);
});
