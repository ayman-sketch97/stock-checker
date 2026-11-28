// US Treasury yields: CSV parsing and the plain-words curve shape. Run: node --test test/rates.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { parseTreasuryCsv, curveShape } from '../lib/rates.js';

const CSV = 'Date,"1 Mo","3 Mo","2 Yr","10 Yr"\n11/25/2026,4.27,4.34,4.61,4.85\n11/27/2026,4.27,4.35,4.69,4.94\n';
test('latest day first, with the day before it', () => {
  const r = parseTreasuryCsv(CSV);
  assert.equal(r.asOf, '2026-11-27');
  assert.deepEqual([r.y3m, r.y2y, r.y10y], [4.35, 4.69, 4.94]);
  assert.equal(r.prev.asOf, '2026-11-25');
});
test('bad or short files give null, never a made-up number', () => {
  assert.equal(parseTreasuryCsv(''), null);
  assert.equal(parseTreasuryCsv('Date,"3 Mo"\n11/27/2026,4.3\n'), null);
  assert.equal(parseTreasuryCsv('Date,"3 Mo","2 Yr","10 Yr"\n11/27/2026,4.3,N/A,4.9\n11/25/2026,4.3,4.5,4.9\n'), null);
  assert.equal(parseTreasuryCsv('<html>blocked</html>'), null);
});
test('curve shape in plain words, no verdicts', () => {
  assert.match(curveShape({ y3m: 4.35, y10y: 4.94 }), /normal curve/);
  assert.match(curveShape({ y3m: 5.2, y10y: 4.1 }), /inverted curve/);
  assert.match(curveShape({ y3m: 4.3, y10y: 4.35 }), /flat curve/);
  assert.equal(curveShape(null), null);
  assert.ok(!/buy|sell/i.test(curveShape({ y3m: 5, y10y: 4 })));
});
