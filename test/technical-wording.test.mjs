import test from 'node:test';
import assert from 'node:assert/strict';
import { evaluate, prepare } from '../lib/technical.js';

// Wording only: a cross one day ago reads "1 day ago", not "1 days ago".
test('signal texts never say "1 days ago"', () => {
  let seen = 0;
  for (let seed = 1; seed <= 40; seed++) {
    let x = 100, s = seed * 7919;
    const rnd = () => ((s = (s * 1103515245 + 12345) % 2147483648) / 2147483648);
    const rows = [];
    for (let d = 0; d < 400; d++) {
      const o = x; x = Math.max(5, x * (1 + (rnd() - 0.48) * 0.04));
      rows.push({ date: new Date(Date.UTC(2025, 0, 1 + d)).toISOString().slice(0, 10), o, h: Math.max(o, x) * 1.01, l: Math.min(o, x) * 0.99, c: x, v: 1e6 });
    }
    const P = prepare(rows);
    for (let i = 250; i < 400; i++) for (const sg of evaluate(P, i).sig) {
      const t = typeof sg.text === 'function' ? sg.text() : sg.text;
      if (/ago/.test(t)) seen++;
      assert.doesNotMatch(t, /\b1 days ago/);
    }
  }
  assert.ok(seen > 0, 'the test must exercise cross texts');
});

// Support/resistance zones: nearby swing points merge, but a run of them must not chain into one wide band.
import { levels } from '../lib/technical.js';
test('a zone is at most 2 tolerances wide, even when swing points chain', () => {
  const tol = 4;
  // 12 swing highs each 2 apart (within tolerance of the previous), spanning 22 = 5.5 tolerances
  const piv = Array.from({ length: 12 }, (_, k) => ({ i: k * 10, price: 100 + k * 2, kind: 'high' }));
  const zones = levels(piv, tol, 200);
  assert.ok(zones.length >= 3, 'a long chain splits into several zones');
  for (const z of zones) {
    const own = piv.filter((p) => Math.abs(p.price - z.price) <= 2 * tol);
    assert.ok(own.length >= z.touches);
    assert.ok(z.touches <= 5, 'at most 5 points of the chain in one zone');
  }
  // close points still merge
  assert.equal(levels([{ i: 1, price: 100 }, { i: 9, price: 101 }, { i: 20, price: 102 }], tol, 30).length, 1);
});
