// Tests for the paper-trade simulated exits: the rules are read out of index.html between the SIMEXIT markers.
// Run: node --test test/simexit.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const html = fs.readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const m = /\/\/ SIMEXIT:BEGIN[^\n]*\n([\s\S]*?)\/\/ SIMEXIT:END/.exec(html);
assert.ok(m, 'SIMEXIT markers are in index.html');
const { simExit, simNote, SIM_RULES } = new Function(`${m[1]}; return { simExit, simNote, SIM_RULES };`)();

const trade = (o = {}) => ({ id: 'a', t: 'AAA', paper: true, opened: '2026-11-02', entry: 100, shares: 10, stop: 95, target: 110, fees: 1, closed: null, ...o });
const c = (d, o, h, l, cl) => [d, o, h, l, cl, 1e6];
// 2026-11-02 is a Monday
const quiet = [c('2026-11-03', 100, 102, 98, 101), c('2026-11-04', 101, 103, 99, 102)];
const T = '2026-11-05';

test('nothing reached: stays open, checked through the last candle', () => {
  const r = simExit(trade(), quiet, T);
  assert.deepEqual([r.state, r.checkedThrough, r.stale], ['open', '2026-11-04', false]);
});
test('stop reached inside the day: exit at the stop less 0.10% slippage', () => {
  const r = simExit(trade(), [...quiet, c('2026-11-05', 99, 100, 94, 96)], '2026-11-05');
  assert.deepEqual([r.state, r.trigger, r.gap, r.closed], ['closed', 'stop', false, '2026-11-05']);
  assert.ok(Math.abs(r.exit - 94.905) <= 0.005 + 1e-9, String(r.exit)); // 95 less 0.10%, to the cent
});
test('gap below the stop: the fill is the open, never the stop price', () => {
  const r = simExit(trade(), [...quiet, c('2026-11-05', 90, 92, 88, 91)], T);
  assert.deepEqual([r.trigger, r.gap, r.exit], ['stop', true, 89.91]);
});
test('target reached: exit at the target, no slippage', () => {
  const r = simExit(trade(), [...quiet, c('2026-11-05', 105, 111, 104, 110)], T);
  assert.deepEqual([r.trigger, r.gap, r.exit, r.slippage], ['target', false, 110, 0]);
});
test('gap above the target: the fill is the open', () => {
  const r = simExit(trade(), [...quiet, c('2026-11-05', 115, 118, 114, 117)], T);
  assert.deepEqual([r.trigger, r.gap, r.exit], ['target', true, 115]);
});
test('one candle reaches both: the stop is assumed first', () => {
  const r = simExit(trade(), [c('2026-11-03', 100, 112, 94, 100)], '2026-11-03');
  assert.deepEqual([r.trigger, r.both], ['stop', true]);
});
test('the entry day is never judged', () => {
  const r = simExit(trade(), [c('2026-11-02', 100, 120, 80, 100), ...quiet], T);
  assert.equal(r.state, 'open');
});
test('exit fee is assumed equal to the entry fee, and the original trade is not changed', () => {
  const t = trade();
  const copy = JSON.stringify(t);
  const r = simExit(t, [...quiet, c('2026-11-05', 99, 100, 94, 96)], T);
  assert.equal(r.exitFees, 1);
  assert.equal(JSON.stringify(t), copy);
});
test('real (non-paper) trades are never closed, nor already-closed ones', () => {
  const hit = [c('2026-11-03', 90, 92, 88, 91)];
  assert.equal(simExit(trade({ paper: false }), hit, T).state, 'skip');
  assert.equal(simExit(trade({ paper: undefined }), hit, T).state, 'skip');
  assert.equal(simExit(trade({ closed: '2026-11-04' }), hit, T).state, 'skip');
});
test('a trade with neither stop nor target is not monitored', () => {
  assert.equal(simExit(trade({ stop: null, target: null }), quiet, T).state, 'skip');
});
test('missing prices: flagged for review, never closed', () => {
  for (const cs of [null, [], undefined]) assert.equal(simExit(trade(), cs, T).state, 'review');
});
test('a hole in the prices before a trigger could be judged: review, not a false close', () => {
  const r = simExit(trade(), [c('2026-11-03', 100, 101, 99, 100), c('2026-11-17', 90, 91, 88, 89)], '2026-11-17');
  assert.equal(r.state, 'review');
  assert.match(r.flag, /missing between 2026-11-03 and 2026-11-17/);
});
test('invalid or out-of-order candles: review', () => {
  assert.equal(simExit(trade(), [c('2026-11-03', 100, 99, 101, 100)], T).state, 'review');
  assert.equal(simExit(trade(), [c('2026-11-04', 100, 102, 98, 101), c('2026-11-03', 100, 102, 98, 101)], T).state, 'review');
  assert.equal(simExit(trade(), [['2026-11-03', 'x', 1, 1, 1]], T).state, 'review');
});
test('stale data: stays open and says checking is paused', () => {
  const r = simExit(trade(), quiet, '2026-11-12');
  assert.equal(r.state, 'open');
  assert.equal(r.stale, true);
  assert.match(r.flag, /resumes when the data updates/);
});
test('candles after today are ignored', () => {
  const r = simExit(trade(), [...quiet, c('2026-11-09', 80, 82, 78, 79)], T);
  assert.equal(r.state, 'open');
});
test('the note says simulated, paper, not a broker execution, and explains a gap', () => {
  const r = simExit(trade(), [...quiet, c('2026-11-05', 90, 92, 88, 91)], T);
  const n = simNote(r, trade());
  assert.match(n, /Simulated exit \(price-triggered, paper only, not a broker execution\)/);
  assert.match(n, /opened beyond the stop/);
  assert.match(n, /Slippage 0\.10%/);
});
test('R and profit use the existing risk basis: stop exit is a loss of about 1R plus costs', () => {
  const r = simExit(trade(), [c('2026-11-03', 99, 100, 94, 96)], '2026-11-03');
  const pnl = (r.exit - 100) * 10 - (1 + r.exitFees);
  const R = pnl / ((100 - 95) * 10);
  assert.ok(Math.abs(pnl - (-52.95)) < 0.06, String(pnl)); // (94.905 - 100) x 10 shares, less 1 + 1 fees
  assert.ok(R < -1.05 && R > -1.08, String(R));
});
test('the page wires the check and keeps reopened trades from being re-closed', () => {
  assert.match(html, /autoCloseJournal\(\)\.then/);
  assert.match(html, /x\.noAuto = true/);
  assert.match(html, /tagEl\('Simulated exit', 'warn'\)/);
});
