// Tests of the deployment-safety tools (tools/deploy-gate.mjs, tools/check-site.mjs, tools/verify-live.mjs).
// Each rule has a case that must pass and cases that must be blocked, so a gate that lets everything through is caught.
// Run: node --test test/deploy-safety.test.mjs   (no network: the live check talks to a local server)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { evaluateGate } from '../tools/deploy-gate.mjs';
import { checkSite, folderDigest, sha256File, REQUIRED_FILES } from '../tools/check-site.mjs';
import { verifyOnce, verifyLive } from '../tools/verify-live.mjs';

const SHA = 'a'.repeat(40);
const OTHER = 'b'.repeat(40);
const REQUIRED = ['formulas', 'page-tests', 'security', 'restore-point', 'build', 'verify-site'];
const ok = (...names) => Object.fromEntries(names.map((n) => [n, { result: 'success' }]));

// ------------------------------------------------------------------ the gate
test('gate: all required checks succeeded -> pass', () => {
  const g = evaluateGate(ok(...REQUIRED), REQUIRED);
  assert.equal(g.pass, true);
  assert.equal(g.blocked.length, 0);
});

for (const bad of ['failure', 'skipped', 'cancelled']) {
  for (const job of REQUIRED) {
    test(`gate: ${job} ${bad} -> blocked`, () => {
      const needs = ok(...REQUIRED);
      needs[job] = { result: bad };
      const g = evaluateGate(needs, REQUIRED);
      assert.equal(g.pass, false);
      assert.deepEqual(g.blocked.map((r) => r.job), [job]);
    });
  }
}

test('gate: a required check that is missing from needs -> blocked', () => {
  const needs = ok('formulas', 'page-tests', 'security', 'build');
  const g = evaluateGate(needs, REQUIRED);
  assert.equal(g.pass, false);
  assert.equal(g.blocked[0].result, 'missing');
});

test('gate: nothing required, no needs, or malformed needs -> blocked, never passes by default', () => {
  assert.equal(evaluateGate(ok(...REQUIRED), []).pass, false);
  assert.equal(evaluateGate(null, REQUIRED).pass, false);
  assert.equal(evaluateGate({ formulas: 'success' }, ['formulas']).pass, false);
  assert.equal(evaluateGate({ formulas: { result: 'Success' } }, ['formulas']).pass, false);
});

test('gate: extra jobs that are not required do not matter', () => {
  const needs = { ...ok(...REQUIRED), extra: { result: 'failure' } };
  assert.equal(evaluateGate(needs, REQUIRED).pass, true);
});

// ------------------------------------------------------------------ the site check
const VENDOR = 'window.LightweightCharts = {};\n';
function goodSite(commit = SHA) {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'site-'));
  const put = (rel, text) => { fs.mkdirSync(path.dirname(path.join(d, rel)), { recursive: true }); fs.writeFileSync(path.join(d, rel), text); };
  put('index.html', "<html><script>const MODE = 'static';</script></html>");
  put('manifest.json', '{"name":"x"}');
  put('favicon.svg', '<svg/>');
  put('robots.txt', 'User-agent: *\nDisallow: /\n');
  put('.nojekyll', '');
  put('fonts/inter-var-latin.woff2', 'font');
  put('vendor/lightweight-charts.js', VENDOR);
  put('data/health.json', JSON.stringify({ commit, builtAt: '2026-11-06T09:00:00Z', priceDate: '2026-11-05', worst: 'ok', checks: [{ id: 'coverage' }] }));
  put('data/index.json', JSON.stringify([{ t: 'AAA' }]));
  put('data/screen.json', JSON.stringify({ fields: ['ticker'], rows: [['AAA']] }));
  put('data/record-summary.json', '{"days":1}');
  return { d, put };
}
function pinsFor(d) { return { files: { 'vendor/lightweight-charts.js': { package: 'test@1', sha256: sha256File(path.join(d, 'vendor/lightweight-charts.js')) } } }; }

test('site check: a complete, clean site built from the right commit passes', () => {
  const { d } = goodSite();
  const r = checkSite(d, { commit: SHA, pins: pinsFor(d) });
  assert.deepEqual(r.problems, []);
  assert.equal(r.ok, true);
  assert.match(r.digest, /^[0-9a-f]{64}$/);
});

test('site check: the real pin file is well formed', () => {
  const pins = JSON.parse(fs.readFileSync(new URL('../tools/vendor-pins.json', import.meta.url), 'utf8'));
  for (const [rel, p] of Object.entries(pins.files)) { assert.match(p.sha256, /^[0-9a-f]{64}$/, rel); assert.ok(REQUIRED_FILES.includes(rel)); }
});

const mutations = {
  'a missing data file': (s) => fs.rmSync(path.join(s.d, 'data/screen.json')),
  'an empty page': (s) => s.put('index.html', ''),
  'invalid JSON': (s) => s.put('data/index.json', '{broken'),
  'no companies': (s) => s.put('data/screen.json', JSON.stringify({ fields: ['ticker'], rows: [] })),
  'a different commit': (s) => s.put('data/health.json', JSON.stringify({ commit: OTHER, priceDate: '2026-11-05', checks: [{}] })),
  'no commit recorded': (s) => s.put('data/health.json', JSON.stringify({ priceDate: '2026-11-05', checks: [{}] })),
  'an unbuilt template': (s) => s.put('index.html', "<script>const MODE = 'server'; /*BUILD:MODE*/</script>"),
  'a GitHub token in a data file': (s) => s.put('data/note.json', JSON.stringify({ t: 'ghp_' + 'A1b2C3d4E5'.repeat(4) })),
  'a token inside a URL': (s) => s.put('index.html', "<script>const MODE = 'static'; const u='https://" + 'x-access-token:' + 'abcdef1234567890@github.com/x' + "';</script>"),
  'a private key': (s) => s.put('data/key.json', '-----BEGIN ' + 'PRIVATE KEY-----'),
  'a .git folder': (s) => s.put('.git/config', 'x'),
  'an .env file': (s) => s.put('.env', 'A=1'),
  'a changed chart library': (s) => s.put('vendor/lightweight-charts.js', 'window.evil = 1;\n'),
  'a symbolic link': (s) => fs.symlinkSync('/etc/passwd', path.join(s.d, 'data/link.json')),
  'no checks in health.json': (s) => s.put('data/health.json', JSON.stringify({ commit: SHA, priceDate: '2026-11-05', checks: [] })),
};
for (const [name, mutate] of Object.entries(mutations)) {
  test(`site check: ${name} -> blocked`, () => {
    const s = goodSite();
    const pins = pinsFor(s.d); // pins describe the good library
    mutate(s);
    const r = checkSite(s.d, { commit: SHA, pins });
    assert.equal(r.ok, false, `expected a problem for: ${name}`);
    assert.ok(r.problems.length >= 1);
  });
}

test('site check: a folder that does not exist is blocked', () => {
  assert.equal(checkSite(path.join(os.tmpdir(), 'no-such-site-' + Date.now()), { commit: SHA }).ok, false);
});

test('folder digest changes when any byte or name changes', () => {
  const s = goodSite();
  const a = folderDigest(s.d);
  assert.equal(folderDigest(s.d), a);
  s.put('data/index.json', JSON.stringify([{ t: 'AAB' }]));
  const b = folderDigest(s.d);
  assert.notEqual(a, b);
  s.put('extra.txt', 'x');
  assert.notEqual(b, folderDigest(s.d));
});

// ------------------------------------------------------------------ the live check
function liveServer(handler) {
  return new Promise((resolve) => {
    const srv = http.createServer(handler);
    srv.listen(0, '127.0.0.1', () => resolve({ srv, base: `http://127.0.0.1:${srv.address().port}/site/` }));
  });
}
const serveSite = (commit, page = "<script>const MODE = 'static';</script>") => (req, res) => {
  const u = new URL(req.url, 'http://x');
  if (u.pathname === '/site/') { res.end(page); return; }
  if (u.pathname === '/site/data/health.json') { res.end(JSON.stringify({ commit, builtAt: 'b', priceDate: 'p' })); return; }
  res.statusCode = 404; res.end('no');
};

test('live check: the live site serves the deployed commit -> pass', async () => {
  const { srv, base } = await liveServer(serveSite(SHA));
  const r = await verifyOnce(base, SHA);
  srv.close();
  assert.equal(r.ok, true);
});

test('live check: the live site serves another commit -> fail', async () => {
  const { srv, base } = await liveServer(serveSite(OTHER));
  const r = await verifyOnce(base, SHA);
  srv.close();
  assert.equal(r.ok, false);
  assert.match(r.why, /expected/);
});

test('live check: missing page, missing health file, broken JSON, unbuilt template -> fail', async () => {
  for (const handler of [
    (q, s) => { s.statusCode = 404; s.end('x'); },
    (q, s) => { if (q.url.includes('health')) { s.statusCode = 404; s.end('x'); } else s.end('page'); },
    (q, s) => { if (q.url.includes('health')) s.end('{nope'); else s.end('page'); },
    serveSite(SHA, '/*BUILD:MODE*/'),
  ]) {
    const { srv, base } = await liveServer(handler);
    const r = await verifyOnce(base, SHA);
    srv.close();
    assert.equal(r.ok, false);
  }
});

test('live check: waits for the new version to appear, and gives up if it never does', async () => {
  let hits = 0;
  const { srv, base } = await liveServer((q, s) => serveSite(hits++ >= 4 ? SHA : OTHER)(q, s));
  const got = await verifyLive(base, SHA, { waitSeconds: 5, everySeconds: 0.05, log: () => {} });
  srv.close();
  assert.equal(got.ok, true);
  const stuck = await liveServer(serveSite(OTHER));
  const never = await verifyLive(stuck.base, SHA, { waitSeconds: 0.3, everySeconds: 0.05, log: () => {} });
  stuck.srv.close();
  assert.equal(never.ok, false);
});

test('live check: an unreachable site is a failure, not a pass', async () => {
  const r = await verifyLive('http://127.0.0.1:9/site/', SHA, { waitSeconds: 0.2, everySeconds: 0.05, log: () => {} });
  assert.equal(r.ok, false);
});
