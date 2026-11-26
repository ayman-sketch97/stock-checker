// Tests for the quote freshness wording: the rules are read out of index.html between the FRESH markers.
// Run: node --test test/freshness.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const html = fs.readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const m = /\/\/ FRESH:BEGIN[^\n]*\n([\s\S]*?)\/\/ FRESH:END/.exec(html);
assert.ok(m, 'FRESH markers are in index.html');
const { quoteFreshness } = new Function(`${m[1]}; return { quoteFreshness };`)();
const T0 = Date.parse('2026-11-25T15:00:00Z');
const at = (min) => T0 + min * 60000;

test('open market, fresh file: delayed, with its age', () => {
  const f = quoteFreshness('2026-11-25T15:00:00Z', at(12), true);
  assert.deepEqual([f.state, f.ageMin, f.stale], ['delayed', 12, false]);
  assert.match(f.text, /delayed prices, updated 12 min ago/);
});
test('open market, file older than 35 minutes: stale, said plainly', () => {
  const f = quoteFreshness('2026-11-25T15:00:00Z', at(36), true);
  assert.deepEqual([f.state, f.stale], ['stale', true]);
  assert.match(f.text, /^STALE: prices last updated 36 min ago/);
  assert.equal(quoteFreshness('2026-11-25T15:00:00Z', at(35), true).state, 'delayed');
});
test('hours and days are written in hours and days', () => {
  assert.match(quoteFreshness('2026-11-25T15:00:00Z', at(180), true).text, /3 h ago/);
  assert.match(quoteFreshness('2026-11-25T15:00:00Z', at(3 * 1440), false).text, /3 d ago/);
});
test('market closed is not called stale just for being old', () => {
  const f = quoteFreshness('2026-11-25T15:00:00Z', at(600), false);
  assert.deepEqual([f.state, f.stale], ['closed', false]);
});
test('a missing or unreadable time is never presented as fresh', () => {
  for (const bad of [undefined, null, '', 'yesterday']) { const f = quoteFreshness(bad, at(5), true); assert.deepEqual([f.state, f.stale], ['unknown', true]); }
});
test('the old "a few minutes behind" wording is gone from the page', () => {
  assert.doesNotMatch(html, /a few minutes behind/);
});
