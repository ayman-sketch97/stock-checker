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
