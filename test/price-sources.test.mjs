// Every price source named in the code is listed in lib/price-sources.js, with its licence terms. A new feed cannot be added unnoticed.
import { readFileSync } from 'node:fs';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { PRICE_SOURCES, priceSourceInfo, mayShowToOthers } from '../lib/price-sources.js';
const read = (p) => readFileSync(new URL('../' + p, import.meta.url), 'utf8');
test('every source label in the fetch code and the relay is registered', () => {
  const found = new Set();
  for (const f of ['lib/data.js', 'relay/worker.js']) for (const m of read(f).matchAll(/\bsource: '([^']+)'/g)) found.add(m[1]);
  assert.ok(found.size >= 4, 'found the known sources: ' + [...found].join(', '));
  for (const s of found) assert.ok(PRICE_SOURCES[s], `price source "${s}" is not listed in lib/price-sources.js`);
});
test('all current feeds are free personal-use feeds and none may be shown to others', () => {
  for (const [name, s] of Object.entries(PRICE_SOURCES)) { assert.equal(s.free, true, name); assert.equal(s.licence, 'personal', name); assert.equal(mayShowToOthers(name), false, name); }
  assert.equal(priceSourceInfo('unknown feed'), null);
  assert.equal(mayShowToOthers('unknown feed'), false);
});
