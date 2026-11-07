// Makes test/fixtures/scanner-ok.json: a scanner file for the page tests, written by the site's own scanner code
// (lib/scanner.js, buildScanner) from stand-in chart analyses. The dates are placeholders: the page test sets them to
// the day it runs. Run: node test/make-scanner-fixture.mjs
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const S = await import(path.join(ROOT, 'lib/scanner.js'));

const DATE = '2026-11-05';
const tech = (o = {}, setup = {}, ind = {}) => ({
  ok: true, asOf: DATE, close: 50, trend: 'up', trendLabel: 'Uptrend',
  levels: { high52: 52, low52: 30, supports: [], resistances: [] },
  setup: { setup: 'pullback', status: 'active', entry: 50.5, stop: 47.5, target1: 57, target2: 62, riskPct: 0.0594, rr1: 2.2, rr2: 3.8, zoneLow: 48.5, zoneHigh: 50.8, maxEntry: 52, fill: 'stop', trigger: 'Next session, buy only if price rises above $50.50: a stop-limit buy order.', ...setup },
  indicators: { ema21: 49.6, sma50: 47.9, sma200: 43, rsi: 52, atr: 1.2, atrPct: 0.024, relVolume: 1.1, upDownVolume: 1.5, ...ind },
  chart: { candles: [['2026-11-04', 49, 50, 48.5, 49.5, 1e6], [DATE, 49.6, 50.4, 49.2, 50, 1.2e6]] },
  ...o,
});
const feats = (o = {}) => ({ advUsd: 80e6, pctB: 0.55, bandWidth: 0.09, squeeze: false, macdHist: 0.2, macdHistPrev: 0.1, ...o });
const wk = (o = {}) => ({ trend: 'up', asOfWeek: '2026-10-30', partial: true, close: 49.1, sma50: 45, ema21: 48, ...o });
const base = { sector: 'Technology', capM: 20000, shariah: 'pass', dq: 'high', earn: null, earnDays: null, bars: 1300 };
const pending = [
  { ...base, si: 0, ticker: 'AAPL', name: 'Apple Inc.', tech: tech({ close: 50 }), feats: feats({ squeeze: true }), wk: wk() },
  { ...base, si: 1, ticker: 'MSFT', name: 'Microsoft Corp', tech: tech({ trendLabel: 'Strong uptrend', close: 51, setup: { ...tech().setup, setup: 'trend', status: 'watch', entry: 49.6, trigger: '' } }), feats: feats(), wk: wk() },
  { ...base, si: 2, ticker: 'KO', name: 'Coca Cola Co', sector: 'Consumer Staples', tech: tech({ trend: 'sideways', trendLabel: 'Sideways', setup: { ...tech().setup, setup: 'reversal', status: 'watch' } }, {}, { rsi: 44, upDownVolume: 0.9 }), feats: feats({ pctB: 0.9 }), wk: wk({ trend: 'mixed' }) },
  { ...base, si: 3, ticker: 'JNJ', name: 'Johnson & Johnson', sector: 'Health Care', tech: tech(), feats: feats(), wk: wk(), earn: { date: '2026-11-11', time: 'before open' }, earnDays: 4 },
  { ...base, si: 4, ticker: 'XYZ', name: 'Fails The Screen Inc', tech: tech(), feats: feats(), wk: wk(), shariah: 'fail' },
];
const rsOf = new Map([['AAPL', 88], ['MSFT', 91], ['KO', 55], ['JNJ', 60], ['XYZ', 70]]);
const f = S.buildScanner({
  pending, rsData: pending.map(() => ({ c: new Float64Array(300) })), rsOf, weighted: () => 0, calendar: { size: 800, failures: 0, days: 60, from: '2026-11-06', to: '2027-01-29' },
  regime: 'up', priceDate: DATE, asOf: '2026-11-06T03:30:00.000Z', techVersion: '1.3', stocksWithChart: 2018,
});
fs.writeFileSync(path.join(ROOT, 'test/fixtures/scanner-ok.json'), JSON.stringify(f) + '\n');
console.log(`scanner-ok.json: ${f.rows.map((r) => `${r.ticker} ${r.setup}/${r.status} ${r.score}`).join(', ')}; blocked ${f.blocked.map((b) => b[0]).join(',')}; shariah-hidden ${f.summary.hiddenByShariahScreen}`);
