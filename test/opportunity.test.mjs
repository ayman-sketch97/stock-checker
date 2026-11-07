// Tests for opportunity tracking (stage 8): the snapshot kept in the watchlist, the paper outcome worked out from later
// candles, and that the page carries exactly the same code.
// Run: node --test test/opportunity.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import * as O from '../lib/opportunity.js';

const eq = assert.deepEqual;
const row = (o = {}) => ({ ticker: 'AAA', setup: 'pullback', asOf: '2026-11-05', entry: 50.5, maxEntry: 52, stop: 47.5, t1: 57, t2: 62, rr1: 2.2, score: 85, ...o });
const snap = (o = {}) => O.oppSnapshot(row(o), '2026-11-06', '1.0');
// [date, open, high, low, close, volume]
const c = (date, o, h, l, cl) => [date, o, h, l, cl, 1e6];

test('a snapshot copies the scanner row and says it is paper', () => {
  const s = snap();
  eq(s, { v: 1, scanVersion: '1.0', setup: 'pullback', added: '2026-11-06', asOf: '2026-11-05', entry: 50.5, maxEntry: 52, stop: 47.5, t1: 57, t2: 62, rr1: 2.2, score: 85, paper: true });
});
test('an idea without a complete plan is never tracked', () => {
  for (const bad of [{ entry: null }, { stop: null }, { t1: null }, { stop: 51 }, { t1: 50 }, { asOf: 'yesterday' }, { ticker: 5 }]) assert.equal(O.oppSnapshot(row(bad), '2026-11-06', '1.0'), null, JSON.stringify(bad));
  assert.equal(O.oppSnapshot(null, '2026-11-06', '1.0'), null);
  assert.equal(O.oppSnapshot(row(), 'today', '1.0'), null);
  assert.equal(O.oppSnapshot(row({ t2: undefined, maxEntry: undefined }), '2026-11-06', '1.0').t2, null);
});

test('no candle after the snapshot date: waiting', () => {
  const r = O.oppOutcome(snap(), [c('2026-11-05', 49, 50, 48, 49.5)]);
  eq([r.state, r.sessions], ['waiting', 0]);
  assert.match(r.label, /buy above \$50\.50/);
  eq(O.oppOutcome(snap(), []).state, 'waiting');
  eq(O.oppOutcome(snap(), null).state, 'waiting');
});
test('price never reaches the entry or the stop: still waiting, then expired after 15 sessions', () => {
  const days = (n) => Array.from({ length: n }, (_, i) => c(`2026-11-${String(6 + i).padStart(2, '0')}`, 49, 50, 48.5, 49.5));
  eq(O.oppOutcome(snap(), days(14)).state, 'waiting');
  const r = O.oppOutcome(snap(), days(15));
  eq([r.state, r.sessions], ['expired', 15]);
  assert.match(r.label, /not triggered within 15 sessions/);
});
test('the stop trades before the entry: failed before entry', () => {
  const r = O.oppOutcome(snap(), [c('2026-11-06', 49, 50, 48, 49), c('2026-11-09', 48, 49, 47.4, 47.6)]);
  eq([r.state, r.sessions], ['invalidated', 2]);
  assert.match(r.label, /2026-11-09/);
});
test('triggered, then still open: fills at the entry and reports paper R at the latest close', () => {
  const r = O.oppOutcome(snap(), [c('2026-11-06', 50, 51, 49.8, 50.9), c('2026-11-09', 51, 53, 50.7, 52)]);
  eq(r.state, 'triggered');
  eq([r.fill, r.fillDate, r.sessions], [50.5, '2026-11-06', 2]);
  eq(r.R, 0.5); // (52 - 50.5) / 3
  assert.match(r.label, /Triggered on 2026-11-06, still open on paper \(\+0\.50R at the 2026-11-09 close\)/);
});
test('a gap up through the entry fills at the open; a gap past the limit does not fill that day', () => {
  const gap = O.oppOutcome(snap(), [c('2026-11-06', 51.5, 52, 51.2, 51.8)]);
  eq([gap.state, gap.fill], ['triggered', 51.5]);
  const far = O.oppOutcome(snap(), [c('2026-11-06', 53, 54, 52.5, 53.5)]);
  eq(far.state, 'waiting'); // opened above the limit (52): not chased
  const later = O.oppOutcome(snap(), [c('2026-11-06', 53, 54, 52.5, 53.5), c('2026-11-09', 51, 51.6, 50.4, 51.2)]);
  eq([later.state, later.fill], ['triggered', 51]);
});
test('the stop after the fill ends it at -1R, or worse when it gaps below the stop', () => {
  const stop = O.oppOutcome(snap(), [c('2026-11-06', 50, 51, 49.8, 50.9), c('2026-11-09', 50, 50.2, 47.2, 47.6)]);
  eq([stop.state, stop.exit, stop.R], ['stopped', 47.5, -1]);
  const gapDown = O.oppOutcome(snap(), [c('2026-11-06', 50, 51, 49.8, 50.9), c('2026-11-09', 46, 47, 45.5, 46.5)]);
  eq([gapDown.state, gapDown.exit], ['stopped', 46]);
  assert.ok(gapDown.R < -1);
});
test('target 1 after the fill ends it; a candle that reaches both counts as the stop', () => {
  const t = O.oppOutcome(snap(), [c('2026-11-06', 50, 51, 49.8, 50.9), c('2026-11-09', 51, 57.5, 50.9, 57)]);
  eq([t.state, t.exit], ['target1', 57]);
  eq(t.R, 2.17);
  const both = O.oppOutcome(snap(), [c('2026-11-06', 50, 51, 49.8, 50.9), c('2026-11-09', 51, 58, 47, 55)]);
  eq(both.state, 'stopped');
});
test('the candle that triggers the idea and reaches the stop is a stop; one that triggers and reaches target 1 is target 1', () => {
  eq(O.oppOutcome(snap(), [c('2026-11-06', 50, 51, 47.4, 48)]).state, 'stopped');
  eq(O.oppOutcome(snap(), [c('2026-11-06', 50, 58, 49.9, 57)]).state, 'target1');
});
test('candles on or before the snapshot date are ignored, and bad rows do not break it', () => {
  const r = O.oppOutcome(snap(), [c('2026-11-04', 40, 60, 30, 50), c('2026-11-05', 40, 60, 30, 50), ['2026-11-06', 'x', 1, 1, 1, 1], null, c('2026-11-06', 50, 51, 49.8, 50.9)]);
  eq(r.state, 'triggered');
  eq(r.sessions, 1);
});
test('an incomplete saved setup is reported, never guessed', () => {
  eq(O.oppOutcome({ asOf: '2026-11-05', entry: 50 }, [c('2026-11-06', 1, 2, 1, 2)]).state, 'unknown');
  eq(O.oppOutcome(null, []).state, 'unknown');
});
test('the same snapshot and candles always give the same answer, and nothing is changed', () => {
  const s = snap();
  const cs = [c('2026-11-06', 50, 51, 49.8, 50.9), c('2026-11-09', 51, 53, 50.7, 52)];
  const before = JSON.stringify([s, cs]);
  eq(JSON.stringify(O.oppOutcome(s, cs)), JSON.stringify(O.oppOutcome(s, cs)));
  eq(JSON.stringify([s, cs]), before);
  assert.ok(Object.isFrozen(O.OPP_RULES));
});

test('the library imports nothing, and the page carries exactly the same code', () => {
  const src = fs.readFileSync(new URL('../lib/opportunity.js', import.meta.url), 'utf8');
  eq([...src.matchAll(/^import .* from '(.*)';$/gm)].map((m) => m[1]), [], 'no imports');
  assert.ok(!/\bfetch\(|localStorage|document\.|XMLHttpRequest/.test(src), 'no network, storage or page access');
  const page = fs.readFileSync(new URL('../index.html', import.meta.url), 'utf8');
  const a = page.indexOf('// ---- opportunity.js (start)');
  const b = page.indexOf('// ---- opportunity.js (end)');
  assert.ok(a > 0 && b > a, 'the page has the opportunity.js block');
  const inPage = page.slice(page.indexOf('\n', a) + 1, b).replace(/\s+$/, '').split('\n').map((l) => l.replace(/^  /, '')).join('\n');
  const mod = src.split('\nexport {')[0].replace(/\s+$/, '');
  assert.equal(inPage, mod, 'index.html and lib/opportunity.js must hold the same code, character for character');
});
