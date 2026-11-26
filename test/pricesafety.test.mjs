// Tests for the nightly build's price-data safety: backup source, sanity check, lateness, jump report, health card.
// Run: node --test test/pricesafety.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { dailyFromYahoo, refuseDaily, getYahooDaily, tradingDaysLate, jumpsSince, priceDataCheck } from '../lib/pricesafety.js';

const mkChart = (n, last = 100, off = -18000) => {
  const ts = [], close = [];
  let t = Date.UTC(2025, 0, 6, 14, 30) / 1000; // a Monday, 9:30 New York
  for (let i = 0; i < n; i++) {
    while ([0, 6].includes(new Date(t * 1000).getUTCDay())) t += 86400;
    ts.push(t); close.push(last - (n - 1 - i) * 0.01); t += 86400;
  }
  return { chart: { result: [{ meta: { gmtoffset: off }, timestamp: ts, indicators: { quote: [{ close, open: close, high: close, low: close, volume: close.map(() => 1000) }] } }] } };
};
const okFetch = (body) => async () => ({ ok: true, json: async () => body });

test('Yahoo series is read oldest first, dated in New York time, skipping empty bars', () => {
  const j = mkChart(3);
  j.chart.result[0].indicators.quote[0].close[1] = null;
  const d = dailyFromYahoo(j);
  assert.equal(d.length, 2);
  assert.equal(d[0].date, '2025-01-06');
  assert.ok(d[0].date < d[1].date);
  assert.deepEqual(dailyFromYahoo({}), []);
});
test('a good fallback series passes; wrong, short or unordered ones are refused with a reason', () => {
  const d = dailyFromYahoo(mkChart(300, 100));
  assert.equal(refuseDaily(d, 100), '');
  assert.equal(refuseDaily(d, 110), '');
  assert.match(refuseDaily(d, 200), /does not match/);
  assert.match(refuseDaily(d.slice(0, 50), 100), /only 50 bars/);
  assert.match(refuseDaily(d, 0), /no reference price/);
  assert.match(refuseDaily([...d].reverse(), 100), /out of order/);
});
test('getYahooDaily tries the second host when the first fails, and throws when both do', async () => {
  const calls = [];
  const f = async (url) => { calls.push(url); return calls.length === 1 ? { ok: false, status: 429 } : { ok: true, json: async () => mkChart(5) }; };
  const d = await getYahooDaily('AAPL', { fetchFn: f });
  assert.equal(d.length, 5);
  assert.match(calls[0], /query1/);
  assert.match(calls[1], /query2/);
  await assert.rejects(getYahooDaily('AAPL', { fetchFn: async () => ({ ok: false, status: 500 }) }));
  await assert.rejects(getYahooDaily('AAPL', { fetchFn: okFetch({}) }));
});
test('lateness counts weekdays after the close date, from 4:30pm New York', () => {
  const at = (iso) => new Date(iso);
  assert.equal(tradingDaysLate('2026-11-25', at('2026-11-26T03:15:00Z')), 0); // Wed 22:15 NY, Wed close is current
  assert.equal(tradingDaysLate('2026-11-25', at('2026-11-26T14:00:00Z')), 0); // Thu 9am NY, Thu not closed yet
  assert.equal(tradingDaysLate('2026-11-25', at('2026-11-27T14:00:00Z')), 1); // Fri 9am, Thursday missing (Thanksgiving)
  assert.equal(tradingDaysLate('2026-11-20', at('2026-11-25T03:15:00Z')), 2); // Fri close, Mon and Tue missing
  assert.equal(tradingDaysLate('2026-11-20', at('2026-11-23T03:15:00Z')), 0); // weekend: Friday is current
  assert.equal(tradingDaysLate(null), null);
  assert.equal(tradingDaysLate('yesterday'), null);
});
test('jump report lists only big moves, largest first, and ignores missing prices', () => {
  const j = jumpsSince({ A: 100, B: 40, C: 10, D: null, E: 5 }, { A: 101, B: 100, C: 30, D: 10 });
  assert.deepEqual(j.map((x) => x.t), ['C', 'B']);
  assert.equal(j[0].move, -0.667);
  assert.deepEqual(jumpsSince({}, {}), []);
});
test('price-data card: ok when current and clean, warns plainly otherwise, absent without stats', () => {
  assert.equal(priceDataCheck(undefined), null);
  const ok = priceDataCheck({ lateDays: 0, fallback: [], refused: 0, jumps: [], jumpCount: 0 });
  assert.equal(ok.status, 'ok');
  const bad = priceDataCheck({ lateDays: 3, fallback: ['AAA'], refused: 1, jumps: [{ t: 'ZZZ' }], jumpCount: 1 });
  assert.equal(bad.status, 'warn');
  assert.match(bad.text, /3 trading days behind/);
  assert.match(bad.text, /backup price source/);
  assert.match(bad.text, /ZZZ/);
  assert.equal(priceDataCheck({ lateDays: null }).status, 'warn');
  assert.equal(priceDataCheck({ lateDays: 1, fallback: [], refused: 0, jumpCount: 0 }).status, 'ok');
});
