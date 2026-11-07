// Stage 8 must not change any recommendation rule, investment policy or Shariah calculation of stages 1 to 7.
// This pins the libraries that hold them by sha256, taken from main commit 32c4fd4 (the commit stage 8 started from). If one of these
// files changes, this test fails and the change has to be reviewed and approved on purpose: update the hash only with that approval.
// lib/intel.js is the one exception: stage 8 changed two strings there (a comment and a warning that called a delayed last-sale price
// "live"). The test undoes exactly those two strings and checks the file is then identical to the commit stage 8 started from.
// Run: node --test test/stage8-untouched.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import crypto from 'node:crypto';

const sha = (file) => crypto.createHash('sha256').update(fs.readFileSync(new URL(`../${file}`, import.meta.url))).digest('hex');

const PINNED = {
  'lib/policy.js': 'dd72d797ceeca0cfd60dbdedbd3d9d8d76090ee76f6b5c6839a7e7b11617b409',
  'lib/thesis.js': 'f8b243c1cf7e734d5ab6ba9174ea267895a57de696fe78d4559dd216d160b664',
  'lib/portfolio.js': 'f526d054751fdf52456e38b2fc9f15d2e6e29492424fd6c5267c3eda55071ec1',
  'lib/records.js': 'd4cab8bb2c381b9a8503e202eb6db0fb1ca7ebf73ba88278d74748c1f0843407',
  'lib/engine.js': 'bc16abd68312ae33f9b2195f2b84f8f50969ac3929efdac1edc01acf68d05213',
  'lib/shariah-ledger.js': 'f9ebd96c0cc049d6c63b013359f0f265755ebb51c86dee6584b71767edf5b7a8',
  'lib/health.js': 'caa4e262afc101f8fc5dd4ec4d34b9a504b37c2ed949c70c9421f71202f839f3',
  'lib/technical.js': '909156951eda0b122a95432a8b944f997eb1cd2bf347049eac6d22ad76ef8df2',
  'lib/backtest.js': '9a7f66f6d8af0df21390faf069274c2d4032c32fc015a4abed6f2e61565319bb',
  'lib/signals.js': '345dd43c435b6a43a0c9ab58d74226afb09e24c95f6517b085be77edd9da1387',
  'lib/data.js': 'e17ce1aa7e5a108de37bb2d0081145383e3f0f370fe17cea488b2447799fd1c9',
  'lib/longterm.js': '37768115b9b7c280890997db764f763a0db0ca83c1485a72229d1f43bc01a916',
  'lib/ltstats.js': '9264e5ff366f977810c725abef1414ab46d8b3f767c1aa0852f0f87e69cbab58',
};
const INTEL_BASE = '3fc811ac00b693974ba17d3822390a4835cd24be52cbbd68e22a9363aa7dff05';

for (const [file, want] of Object.entries(PINNED)) {
  test(`${file} is exactly as it was when stage 8 started`, () => {
    assert.equal(sha(file), want, `${file} changed: stage 8 may not change recommendation rules, policies or Shariah calculations`);
  });
}

test('lib/intel.js differs from the starting commit only by the two "live" wording changes', () => {
  let s = fs.readFileSync(new URL('../lib/intel.js', import.meta.url), 'utf8');
  const swaps = [
    ['limits, live (a delayed last-sale quote), swingTrade', 'limits, live (a delayed live quote), swingTrade'],
    ['`The delayed last-sale price (${ivMoney(ev.live.p)})', '`The delayed live price (${ivMoney(ev.live.p)})'],
  ];
  for (const [now, before] of swaps) {
    assert.equal(s.split(now).length - 1, 1, `expected exactly one: ${now}`);
    s = s.replace(now, before);
  }
  assert.equal(crypto.createHash('sha256').update(s).digest('hex'), INTEL_BASE);
});

test('stage 8 libraries never import the recommendation, policy or Shariah code', () => {
  const imports = (file) => [...fs.readFileSync(new URL(`../${file}`, import.meta.url), 'utf8').matchAll(/^import .* from '(.*)';$/gm)].map((m) => m[1]);
  assert.deepEqual(imports('lib/scanner.js'), ['./technical.js']);
  assert.deepEqual(imports('lib/opportunity.js'), []);
});

test('the scanner file is a separate file: the chart analysis and the screener keep their own names', () => {
  const b = fs.readFileSync(new URL('../tools/build-site.mjs', import.meta.url), 'utf8');
  assert.ok(b.includes("'scanner.json'") || b.includes('scanner.json'), 'the build writes data/scanner.json');
  assert.ok(b.includes('tech-ext'), 'the weekly and Bollinger data go to data/tech-ext/, not into data/tech/');
});
