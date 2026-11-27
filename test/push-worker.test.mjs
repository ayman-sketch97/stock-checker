// The phone-notification Worker's rules: one baseline, then only changes are reported, each once; no amounts are ever stored.
import test from 'node:test';
import assert from 'node:assert/strict';
import { evaluate, digest, weekdaysBetween } from '../relay/push-worker.js';

const FIELDS = ['ticker', 'price', 'buyBelow', 'shariah', 'quality', 'health', 'verdict', 'ev'];
const screen = (rows, priceDate = '2026-11-25') => ({ fields: FIELDS, rows, priceDate });
const NOW = Date.parse('2026-11-27T04:30:00Z'); // Friday
const okHealth = { priceDate: '2026-11-26', worst: 'ok' };

test('first sight sets the baseline and says nothing', () => {
  const r = evaluate([{ t: 'AAA', held: true }], {}, screen([['AAA', 90, 100, 'pass', 80, 80, 'BUY', []]]), okHealth, NOW);
  assert.deepEqual(r.lines, []);
  assert.equal(r.state.tick.AAA.zone, true);
});

test('buy price is reported once when crossed, with a 5% band before it re-arms', () => {
  let r = evaluate([{ t: 'AAA' }], {}, screen([['AAA', 120, 100, 'pass', 80, 80, 'BUY', []]], '2026-11-24'), okHealth, NOW);
  r = evaluate([{ t: 'AAA' }], r.state, screen([['AAA', 99, 100, 'pass', 80, 80, 'BUY', []]], '2026-11-25'), okHealth, NOW);
  assert.equal(r.lines.length, 1);
  assert.match(r.lines[0], /under its buy price/);
  r = evaluate([{ t: 'AAA' }], r.state, screen([['AAA', 98, 100, 'pass', 80, 80, 'BUY', []]], '2026-11-26'), okHealth, NOW);
  assert.equal(r.lines.length, 0); // already in the zone: not repeated
  r = evaluate([{ t: 'AAA' }], r.state, screen([['AAA', 102, 100, 'pass', 80, 80, 'BUY', []]], '2026-11-27'), okHealth, NOW);
  assert.equal(r.state.tick.AAA.zone, true); // inside the band: still armed off
  r = evaluate([{ t: 'AAA' }], r.state, screen([['AAA', 90, 100, 'pass', 80, 80, 'BUY', []]], '2026-11-28'), okHealth, NOW);
  assert.equal(r.lines.length, 0);
});

test('a company that fails the halal screen never raises a buy-price alert', () => {
  let r = evaluate([{ t: 'AAA' }], {}, screen([['AAA', 120, 100, 'pass', 80, 80, 'BUY', []]], '2026-11-24'), okHealth, NOW);
  r = evaluate([{ t: 'AAA' }], r.state, screen([['AAA', 90, 100, 'fail', 80, 80, 'AVOID_SHARIAH', []]]), okHealth, NOW);
  assert.ok(!r.lines.some((l) => /buy price/.test(l)));
  assert.ok(r.lines.some((l) => /halal status changed/.test(l)));
});

test('a holding that gets weaker is reported; the same company on the watchlist only is not', () => {
  const base = screen([['AAA', 120, 100, 'pass', 90, 90, 'BUY', []]], '2026-11-24');
  const next = screen([['AAA', 120, 100, 'pass', 70, 75, 'BUY', []]]);
  for (const held of [true, false]) {
    let r = evaluate([{ t: 'AAA', held }], {}, base, okHealth, NOW);
    r = evaluate([{ t: 'AAA', held }], r.state, next, okHealth, NOW);
    assert.equal(r.lines.filter((l) => /fell/.test(l)).length, held ? 2 : 0);
  }
});

test('serious filings on a holding are reported once', () => {
  let r = evaluate([{ t: 'AAA', held: true }], {}, screen([['AAA', 120, 100, 'pass', 90, 90, 'BUY', ['2026-11-20|8-K|8.01']]], '2026-11-24'), okHealth, NOW);
  r = evaluate([{ t: 'AAA', held: true }], r.state, screen([['AAA', 120, 100, 'pass', 90, 90, 'BUY', ['2026-11-20|8-K|8.01', '2026-11-25|8-K|4.02']]]), okHealth, NOW);
  assert.equal(r.lines.filter((l) => /4\.02/.test(l)).length, 1);
  r = evaluate([{ t: 'AAA', held: true }], r.state, screen([['AAA', 120, 100, 'pass', 90, 90, 'BUY', ['2026-11-25|8-K|4.02']]], '2026-11-26'), okHealth, NOW);
  assert.equal(r.lines.length, 0);
});

test('stale data is reported once, then again after three days', () => {
  const stale = { priceDate: '2026-11-20', worst: 'ok' };
  let r = evaluate([], {}, null, stale, NOW);
  assert.equal(r.lines.length, 1);
  r = evaluate([], r.state, null, stale, NOW + 3600 * 1000);
  assert.equal(r.lines.length, 0);
  r = evaluate([], r.state, null, stale, NOW + 4 * 24 * 3600 * 1000);
  assert.equal(r.lines.length, 1);
});

test('tickers the site does not cover are skipped, and a removed ticker is forgotten', () => {
  let r = evaluate([{ t: 'ZZZ' }, { t: 'AAA' }], {}, screen([['AAA', 90, 100, 'pass', 80, 80, 'BUY', []]]), okHealth, NOW);
  assert.ok(r.state.tick.AAA && !r.state.tick.ZZZ);
  r = evaluate([], r.state, screen([['AAA', 90, 100, 'pass', 80, 80, 'BUY', []]], '2026-11-26'), okHealth, NOW);
  assert.deepEqual(r.state.tick, {});
});

test('the digest is one message, short, and says information only', () => {
  const d = digest(['a', 'b', 'c', 'd', 'e', 'f', 'g']);
  assert.match(d.title, /7 things/);
  assert.match(d.body, /\+2 more/);
  assert.match(d.body, /Information only/);
  assert.doesNotMatch(d.body + d.title, /\b(buy now|sell now|you should)\b/i);
});

test('weekday counting skips weekends', () => {
  assert.equal(weekdaysBetween('2026-11-20', '2026-11-26'), 4);
});
