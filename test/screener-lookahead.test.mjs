// No-look-ahead tests for the screener / swing scanner (area 2 audit, November 2026).
// A screen run on day i may use only bars up to day i. These tests walk made-up price histories forward and check, at many
// cut dates, that nothing the scanner reads at day i changes when the bars after day i change or are missing.
// They test the real functions (lib/technical.js, lib/scanner.js) and change no rule.
// Run: node --test test/screener-lookahead.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import * as S from '../lib/scanner.js';
import { prepare, analyzeTechnical } from '../lib/technical.js';

function series(n, drift, seed) {
  let s = seed;
  const rnd = () => (s = (s * 1103515245 + 12345) % 2147483648) / 2147483648;
  const days = [];
  const dt = new Date('2026-11-05T12:00:00Z');
  while (days.length < n) {
    if (dt.getUTCDay() % 6) days.unshift(dt.toISOString().slice(0, 10));
    dt.setUTCDate(dt.getUTCDate() - 1);
  }
  let p = 30;
  return days.map((date) => {
    const o = p;
    p *= 1 + drift + (rnd() - 0.5) * 0.03;
    return { date, o, h: Math.max(o, p) * (1 + rnd() * 0.006), l: Math.min(o, p) * (1 - rnd() * 0.006), c: p, v: Math.round(5e6 + rnd() * 3e6) };
  });
}
const same = (a, b, msg) => {
  if (a === null || b === null || a === undefined || b === undefined) return assert.equal(a, b, msg);
  assert.ok(Math.abs(a - b) <= 1e-9 * Math.max(1, Math.abs(a)), `${msg}: ${a} vs ${b}`);
};
const CUTS = [320, 411, 500, 611, 722, 833, 944, 1055, 1166, 1299];

test('indicators on day i are the same whether or not later bars exist', () => {
  for (const seed of [3, 8, 21]) {
    const full = series(1300, 0.0004, seed);
    const PF = prepare(full);
    for (const n of CUTS) {
      const PT = prepare(full.slice(0, n));
      const i = n - 1;
      for (const k of ['e21', 's50', 's200', 'r', 'a', 'v50']) same(PF[k][i], PT[k][i], `${k} seed ${seed} day ${i}`);
      same(PF.m.hist[i], PT.m.hist[i], `macd hist seed ${seed} day ${i}`);
      const bf = S.bollinger(PF.C, 20, 2);
      const bt = S.bollinger(PT.C, 20, 2);
      same(bf.upper[i], bt.upper[i], `bollinger upper seed ${seed} day ${i}`);
      same(bf.lower[i], bt.lower[i], `bollinger lower seed ${seed} day ${i}`);
    }
  }
});

test('scanner features on day i read nothing after day i', () => {
  for (const seed of [5, 13]) {
    const full = series(1300, 0.0005, seed);
    const PF = prepare(full);
    for (const n of CUTS) {
      const view = S.features({ ...PF, C: PF.C, V: PF.V, n });
      const real = S.features(prepare(full.slice(0, n)));
      for (const k of Object.keys(real)) same(view[k], real[k], `${k} seed ${seed} cut ${n}`);
    }
  }
});

test('relative strength rank "N sessions ago" ignores each stock\'s last N bars', () => {
  const w = (c, j) => c[j] / c[j - 126] - 1;
  const mk = (g, seed, junk) => {
    const d = series(400, g, seed);
    const c = Float64Array.from(d.map((x) => x.c));
    if (junk) for (let j = c.length - junk; j < c.length; j++) c[j] = c[j] * (j % 2 ? 5 : 0.2); // future bars made wild
    return { c };
  };
  const clean = Array.from({ length: 120 }, (_, k) => mk(0.0001 + k * 0.00001, 100 + k, 0));
  const wild = Array.from({ length: 120 }, (_, k) => mk(0.0001 + k * 0.00001, 100 + k, 21));
  const a = S.rankerBack(clean, 21, w);
  const b = S.rankerBack(wild, 21, w);
  assert.ok(a && b);
  for (const k of [0, 30, 60, 90, 119]) {
    const j = 400 - 1 - 21;
    assert.equal(a(w(clean[k].c, j)), b(w(wild[k].c, j)), `stock ${k}: rank 21 sessions ago must not depend on the last 21 bars`);
  }
});

test('the weekly trend read on Monday to Thursday is the same as the one read the Friday before (the open week is never used)', () => {
  const full = series(1300, 0.0004, 31);
  let checked = 0;
  for (let i = 700; i < 1290; i++) {
    const d = new Date(full[i].date + 'T00:00:00Z').getUTCDay();
    if (d !== 5) continue; // a Friday: the week is complete
    const fri = S.weeklyAnalysis(full.slice(0, i + 1));
    for (let k = 1; k <= 4; k++) {
      const mid = S.weeklyAnalysis(full.slice(0, i + 1 + k));
      if (!fri || !mid) continue;
      assert.equal(mid.trend, fri.trend, `week of ${full[i].date}, day +${k}`);
      checked++;
    }
  }
  assert.ok(checked > 100, 'enough weeks were compared');
});

test('walk forward: at every cut date a listed candidate has a plan that sits on bars up to that date, and no gate is skipped', () => {
  let listed = 0;
  for (let seed = 1; seed <= 25; seed++) {
    const full = series(1300, 0.0003 + (seed % 5) * 0.0003, seed);
    for (const n of [600, 800, 1000, 1150, 1300]) {
      const daily = full.slice(0, n);
      const P = prepare(daily);
      const T = analyzeTechnical(P);
      const r = S.scanStock({ ticker: 'T' + seed, name: 'x', tech: T, feats: S.features(P), wk: S.weeklyAnalysis(daily), shariah: 'pass', dq: 'high',
        rs: 85, rsPrev: 70, earn: null, earnDays: null, earningsCal: 'ok', regime: 'up', priceDate: daily.at(-1).date, bars: daily.length });
      if (!r.listed) continue;
      listed++;
      const c = r.listed;
      assert.equal(T.asOf, daily.at(-1).date);
      assert.ok(c.entry > c.stop, 'stop under entry');
      assert.ok(c.stop > Math.min(...P.L) * 0.5 && c.t1 < Math.max(...P.H) * 3, 'levels are on the scale of the history so far');
      // a stale price date blocks it
      const stale = S.scanStock({ ticker: 'T', name: 'x', tech: T, feats: S.features(P), wk: S.weeklyAnalysis(daily), shariah: 'pass', dq: 'high',
        rs: 85, rsPrev: 70, earn: null, earnDays: null, earningsCal: 'ok', regime: 'up', priceDate: '2099-01-01', bars: daily.length });
      assert.ok(stale.blocked || stale.none, 'a price that is not the run date never lists');
    }
  }
  assert.ok(listed > 0, 'the walk found some candidates to check');
});
