// Tests for the assessment-vs-eligibility card: the text rules are read out of index.html between the ASSESS markers.
// Run: node --test test/assessment.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const html = fs.readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const m = /\/\/ ASSESS:BEGIN[^\n]*\n([\s\S]*?)\/\/ ASSESS:END/.exec(html);
assert.ok(m, 'ASSESS markers are in index.html');
const { assessmentOf, eligibilityOf } = new Function(`${m[1]}; return { assessmentOf, eligibilityOf };`)();

const ok = { ok: true, why: [], limitsOk: true, ledger: { ok: true } };
const noLedger = { ok: false, why: ['its halal status is unresolved: confirm it passes on Zoya first'], limitsOk: true, ledger: { ok: false } };

test('missing or unreliable data never becomes a positive assessment', () => {
  for (const [code, unrel] of [['UNRELIABLE', true], ['BUY', true], ['BUY_STRONG', true], ['NODATA', false], ['FINANCIAL', false], [undefined, false], ['AVOID_SHARIAH', false]]) {
    assert.equal(assessmentOf(code, unrel, 'insufficient', 'Undervalued', 90).kind, 'none', String(code));
  }
});
test('each verdict maps to the stated assessment', () => {
  const k = (c) => assessmentOf(c, false, 'high', 'x', 50).kind;
  assert.deepEqual(['BUY_STRONG', 'BUY', 'CONTRARIAN', 'WATCH', 'LOOK', 'PASS', 'AVOID_WEAK', 'SPECULATIVE'].map(k), ['positive', 'positive', 'opportunity', 'neutral', 'neutral', 'neutral', 'negative', 'negative']);
});
test('limited data adds a caution to a conclusion but not to "no conclusion"', () => {
  assert.match(assessmentOf('BUY', false, 'limited', 'x', 50).text, /confirm the key figures/);
  assert.doesNotMatch(assessmentOf('UNRELIABLE', true, 'limited', 'x', 50).text, /confirm the key figures/);
});
test('a good assessment never makes a blocked stock eligible', () => {
  const e = eligibilityOf(noLedger, false, false, null);
  assert.equal(e.ok, false);
  assert.match(e.text, /not currently eligible for a new purchase/);
  assert.ok(e.needs.some((n) => /Zoya/.test(n)));
  assert.ok(e.needs.some((n) => /do not treat it as halal/.test(n)));
});
test('unreliable data blocks eligibility even when limits and the ledger pass', () => {
  const e = eligibilityOf(ok, true, false, null);
  assert.equal(e.ok, false);
  assert.ok(e.needs.some((n) => /reliable financial data/.test(n)));
});
test('eligible means limits, ledger and data all pass; it is still not a buy signal', () => {
  const e = eligibilityOf(ok, false, false, null);
  assert.equal(e.ok, true);
  assert.match(e.text, /not a buy signal/);
});
test('a failed halal screen and a stale update each say what has to change', () => {
  const e = eligibilityOf({ ok: false, why: ['it fails the halal screen'], limitsOk: true, ledger: { ok: false } }, false, true, { missed: 3 });
  assert.equal(e.ok, false);
  assert.ok(e.needs.some((n) => /fails the halal screen/.test(n)));
  assert.ok(e.needs.some((n) => /nightly update/.test(n)));
});
test('before the screen loads the card is pending and never eligible', () => {
  const e = eligibilityOf(null, false, false, null);
  assert.equal(e.pending, true);
  assert.equal(e.ok, false);
});
test('no text calls an unverified stock halal', () => {
  for (const c of ['BUY', 'UNRELIABLE', 'AVOID_SHARIAH', 'CONTRARIAN']) assert.doesNotMatch(assessmentOf(c, false, 'high', 'x', 50).text, /\bhalal\b(?! screen)/i);
  assert.doesNotMatch(eligibilityOf(noLedger, false, false, null).text, /is halal|are halal/i);
});
test('the page paints the card and replaces it with the live one', () => {
  assert.match(html, /tech\.assess = assessmentCard\(d, d\.price, null\)/);
  assert.match(html, /t\.assess\.replaceWith\(na\)/);
});
