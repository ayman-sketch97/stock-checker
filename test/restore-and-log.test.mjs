// Tests of restore protection and the permanent deployment log
// (tools/restore-point.mjs, tools/find-restore-point.mjs, tools/deploy-log.mjs, tools/ledger-push.sh, tools/record-state.sh).
// Every rule has a case that must pass and cases that must be blocked. No network: GitHub is replaced by local fakes,
// the deploy log's remote by a local bare repository.
// Run: node --test test/restore-and-log.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync, spawnSync } from 'node:child_process';
import { sha256File } from '../tools/check-site.mjs';
import { createRestorePoint, verifyRestorePoint } from '../tools/restore-point.mjs';
import { appendEntry, verifyLedger, checkAddOnly, deriveStatus, composeRunEntry, composeDrillEntry, restorePointsFor, findWitness, entryHash } from '../tools/deploy-log.mjs';
import { findRestorePoint } from '../tools/find-restore-point.mjs';

const ROOT = path.resolve(new URL('..', import.meta.url).pathname);
const SHA = 'a'.repeat(40);
const OTHER = 'b'.repeat(40);
const tmp = (p = 't-') => fs.mkdtempSync(path.join(os.tmpdir(), p));
const put = (d, rel, text) => { fs.mkdirSync(path.dirname(path.join(d, rel)), { recursive: true }); fs.writeFileSync(path.join(d, rel), text); };
const VENDOR = 'window.LightweightCharts = {};\n';
function goodSite(commit = SHA, extra = '') {
  const d = tmp('site-');
  put(d, 'index.html', "<html><script>const MODE = 'static';</script></html>" + extra);
  put(d, 'manifest.json', '{"name":"x"}');
  put(d, 'favicon.svg', '<svg/>');
  put(d, 'robots.txt', 'User-agent: *\n');
  put(d, 'fonts/inter-var-latin.woff2', 'font');
  put(d, 'vendor/lightweight-charts.js', VENDOR);
  put(d, 'data/health.json', JSON.stringify({ commit, builtAt: '2026-11-06T09:00:00Z', priceDate: '2026-11-05', worst: 'ok', checks: [{ id: 'coverage' }] }));
  put(d, 'data/index.json', JSON.stringify([{ t: 'AAA' }]));
  put(d, 'data/screen.json', JSON.stringify({ fields: ['ticker'], rows: [['AAA']] }));
  put(d, 'data/record-summary.json', '{"days":1}');
  return d; // note: no .nojekyll, like a published Pages artifact
}
const pinsFor = (d) => ({ files: { 'vendor/lightweight-charts.js': { package: 'test@1', sha256: sha256File(path.join(d, 'vendor/lightweight-charts.js')) } } });
function goodRestorePoint(commit = SHA) {
  const site = goodSite(commit); const out = tmp('rp-');
  const m = createRestorePoint(site, out, { commit, source: 'test', run: 7, pins: pinsFor(site) });
  return { dir: out, manifest: m, pins: pinsFor(site) };
}

// ------------------------------------------------------------------ restore points
test('restore point: made from a clean site, it verifies against its commit, fingerprint and every file hash', async () => {
  const { dir, manifest, pins } = goodRestorePoint();
  assert.equal(manifest.commit, SHA);
  assert.match(manifest.digest, /^[0-9a-f]{64}$/);
  assert.equal(manifest.files, Object.keys(manifest.hashes).length);
  const v = await verifyRestorePoint(dir, { commit: SHA, digest: manifest.digest, pins });
  assert.deepEqual(v.problems, []);
  assert.equal(v.ok, true);
});

test('restore point: a site that fails the site checks cannot become a restore point', () => {
  const site = goodSite(); fs.rmSync(path.join(site, 'data/screen.json'));
  assert.throws(() => createRestorePoint(site, tmp('rp-'), { commit: SHA, pins: pinsFor(site) }), /does not pass/);
  assert.throws(() => createRestorePoint(goodSite(), tmp('rp-'), { commit: OTHER }), /does not pass/); // built from another commit than claimed
  assert.throws(() => createRestorePoint(goodSite(), tmp('rp-'), {}), /needs the commit/);
});

const tamper = {
  'a changed byte in a file': (d) => put(d, 'site/index.html', "<html><script>const MODE = 'static';</script></html> "),
  'a deleted file': (d) => fs.rmSync(path.join(d, 'site/data/index.json')),
  'an added file': (d) => put(d, 'site/extra.txt', 'x'),
  'a changed file hash in the manifest': (d) => { const m = JSON.parse(fs.readFileSync(path.join(d, 'manifest.json'), 'utf8')); m.hashes['index.html'] = '0'.repeat(64); fs.writeFileSync(path.join(d, 'manifest.json'), JSON.stringify(m)); },
  'a manifest that claims another commit': (d) => { const m = JSON.parse(fs.readFileSync(path.join(d, 'manifest.json'), 'utf8')); m.commit = OTHER; fs.writeFileSync(path.join(d, 'manifest.json'), JSON.stringify(m)); },
  'a site whose own health report names another commit': (d) => { put(d, 'site/data/health.json', JSON.stringify({ commit: OTHER, priceDate: '2026-11-05', checks: [{}] })); },
  'a wrong folder fingerprint in the manifest': (d) => { const m = JSON.parse(fs.readFileSync(path.join(d, 'manifest.json'), 'utf8')); m.digest = 'f'.repeat(64); fs.writeFileSync(path.join(d, 'manifest.json'), JSON.stringify(m)); },
  'a missing manifest': (d) => fs.rmSync(path.join(d, 'manifest.json')),
  'a manifest that is not JSON': (d) => put(d, 'manifest.json', '{broken'),
  'a missing site folder': (d) => fs.rmSync(path.join(d, 'site'), { recursive: true }),
  'a credential added to a page': (d) => put(d, 'site/data/note.json', JSON.stringify({ t: 'ghp_' + 'A1b2C3d4E5'.repeat(4) })),
};
for (const [name, mutate] of Object.entries(tamper)) {
  test(`restore point: ${name} -> not verified`, async () => {
    const { dir, pins } = goodRestorePoint();
    mutate(dir);
    const v = await verifyRestorePoint(dir, { commit: SHA, pins });
    assert.equal(v.ok, false, `expected a problem for: ${name}`);
    assert.ok(v.problems.length >= 1);
  });
}

test('restore point: the wrong expected commit, or a fingerprint other than the one verified before -> not verified', async () => {
  const { dir, manifest, pins } = goodRestorePoint();
  assert.equal((await verifyRestorePoint(dir, { commit: OTHER, pins })).ok, false);
  assert.equal((await verifyRestorePoint(dir, { commit: SHA, digest: 'e'.repeat(64), pins })).ok, false);
  assert.equal((await verifyRestorePoint(dir, { commit: SHA, digest: manifest.digest, pins })).ok, true);
});

test('restore point: without a witness entry in the deploy log it is not trusted; with one it is', async () => {
  const { dir, manifest, pins } = goodRestorePoint();
  const led = tmp('led-');
  appendEntry(led, { kind: 'genesis', note: 'empty' });
  assert.equal((await verifyRestorePoint(dir, { commit: SHA, ledgerDir: led, pins })).ok, false);
  appendEntry(led, { kind: 'run', run: { id: 7, attempt: 1 }, status: 'recorded_and_deployed', restorePoint: { created: { commit: SHA, digest: manifest.digest, runId: 7 } } });
  assert.equal((await verifyRestorePoint(dir, { commit: SHA, ledgerDir: led, pins })).ok, true);
  // a witness for another fingerprint does not count
  const led2 = tmp('led-');
  appendEntry(led2, { kind: 'genesis' });
  appendEntry(led2, { kind: 'run', run: { id: 7, attempt: 1 }, status: 'neither', restorePoint: { created: { commit: SHA, digest: 'd'.repeat(64), runId: 7 } } });
  assert.equal((await verifyRestorePoint(dir, { commit: SHA, ledgerDir: led2, pins })).ok, false);
});

// ------------------------------------------------------------------ the deploy log
const runNeeds = (over = {}) => ({
  formulas: { result: 'success', outputs: {} }, 'page-tests': { result: 'success', outputs: {} }, security: { result: 'success', outputs: {} },
  'restore-point': { result: 'success', outputs: { used_commit: OTHER, used_digest: 'c'.repeat(64), used_run: '5' } },
  build: { result: 'success', outputs: { record_state: 'saved', record_before: 'r1', record_after: 'r2', record_files: '[{"path":"days/2026/x.ndjson","sha256":"' + '1'.repeat(64) + '"}]', built_at: '2026-11-06T09:00:00Z', price_date: '2026-11-05' } },
  'verify-site': { result: 'success', outputs: { digest: 'd'.repeat(64) } }, gate: { result: 'success', outputs: {} },
  deploy: { result: 'success', outputs: {} },
  'verify-live': { result: 'success', outputs: { created_commit: SHA, created_digest: 'd'.repeat(64), created_files: '12' } },
  rollback: { result: 'skipped', outputs: {} }, ...over,
});
const ENV = { RUN_ID: '99', RUN_ATTEMPT: '1', EVENT: 'schedule', REF: 'refs/heads/main', SHA, REPO: 'o/r' };

test('deploy log: entries chain together and the whole log verifies', () => {
  const led = tmp('led-');
  appendEntry(led, { kind: 'genesis' });
  for (let i = 0; i < 3; i++) appendEntry(led, composeRunEntry(runNeeds(), { ...ENV, RUN_ID: String(100 + i) }));
  const v = verifyLedger(led);
  assert.deepEqual(v.problems, []);
  assert.equal(v.entries, 4);
  const rows = fs.readdirSync(path.join(led, 'entries')).sort();
  assert.match(rows[0], /^000000-genesis\.json$/);
  assert.match(rows[3], /^000003-run-run102-a1\.json$/);
});

test('deploy log: every entry names the analysis commit, build, record files with hashes, gates, deployment, live check and restore points', () => {
  const e = composeRunEntry(runNeeds(), ENV);
  assert.equal(e.analysisCommit, SHA);
  assert.deepEqual(e.build, { builtAt: '2026-11-06T09:00:00Z', priceDate: '2026-11-05', siteDigest: 'd'.repeat(64) });
  assert.equal(e.record.files[0].path, 'days/2026/x.ndjson');
  assert.match(e.record.files[0].sha256, /^[0-9a-f]{64}$/);
  for (const g of ['formulas', 'page-tests', 'security', 'restore-point', 'build', 'verify-site', 'gate']) assert.equal(e.gates[g], 'success');
  assert.equal(e.deploy.result, 'success');
  assert.deepEqual(e.live, { result: 'success', commit: SHA });
  assert.equal(e.restorePoint.used.commit, OTHER);
  assert.equal(e.restorePoint.created.digest, 'd'.repeat(64));
  assert.equal(e.status, 'recorded_and_deployed');
});

test('deploy log: recorded and deployed are separate facts, all four combinations are told apart', () => {
  const st = (over) => composeRunEntry(runNeeds(over), ENV).status;
  const noRecord = { build: { result: 'success', outputs: { record_state: 'failed' } } };
  const noDeploy = { deploy: { result: 'failure', outputs: {} }, 'verify-live': { result: 'skipped', outputs: {} } };
  assert.equal(st({}), 'recorded_and_deployed');
  assert.equal(st(noDeploy), 'recorded_not_deployed');                  // the record saved, the deployment failed
  assert.equal(st(noRecord), 'not_recorded_deployed');
  assert.equal(st({ ...noRecord, ...noDeploy }), 'neither');
  assert.equal(st({ 'verify-live': { result: 'failure', outputs: {} }, rollback: { result: 'success', outputs: {} } }), 'recorded_not_deployed'); // live check failed: not deployed
  assert.equal(composeRunEntry(runNeeds({ 'verify-live': { result: 'failure', outputs: {} }, rollback: { result: 'success', outputs: {} } }), ENV).rolledBack, true);
  assert.equal(st({ build: { result: 'success', outputs: { record_state: 'already_saved' } } }), 'recorded_and_deployed');
  assert.equal(st({ build: { result: 'success', outputs: { record_state: 'not_run' } } }), 'not_recorded_deployed');
  assert.equal(deriveStatus({ recordState: 'saved', deployResult: 'success', liveResult: 'success', dryRun: true }), 'dry_run');
  assert.equal(composeRunEntry(runNeeds({ gate: { result: 'failure', outputs: {} }, deploy: { result: 'skipped', outputs: {} }, 'verify-live': { result: 'skipped', outputs: {} } }), ENV).gates.gate, 'failure');
});

test('deploy log: a job missing from the run is recorded as missing, never as success', () => {
  const needs = runNeeds(); delete needs['verify-site'];
  const e = composeRunEntry(needs, ENV);
  assert.equal(e.gates['verify-site'], 'missing');
});

const tamperLog = {
  'an edited entry': (d) => { const f = path.join(d, 'entries', fs.readdirSync(path.join(d, 'entries')).sort()[1]); const e = JSON.parse(fs.readFileSync(f, 'utf8')); e.analysisCommit = OTHER; fs.writeFileSync(f, JSON.stringify(e)); },
  'an edited entry whose hash was recomputed': (d) => { const f = path.join(d, 'entries', fs.readdirSync(path.join(d, 'entries')).sort()[1]); const e = JSON.parse(fs.readFileSync(f, 'utf8')); e.status = 'neither'; e.hash = entryHash(e); fs.writeFileSync(f, JSON.stringify(e)); },
  'a deleted entry': (d) => fs.rmSync(path.join(d, 'entries', fs.readdirSync(path.join(d, 'entries')).sort()[1])),
  'a missing first entry': (d) => fs.rmSync(path.join(d, 'entries', fs.readdirSync(path.join(d, 'entries')).sort()[0])),
  'two entries swapped': (d) => { const n = fs.readdirSync(path.join(d, 'entries')).sort(); const a = path.join(d, 'entries', n[1]), b = path.join(d, 'entries', n[2]); const t = fs.readFileSync(a); fs.writeFileSync(a, fs.readFileSync(b)); fs.writeFileSync(b, t); },
  'an entry that is not JSON': (d) => put(d, 'entries/' + fs.readdirSync(path.join(d, 'entries')).sort()[2], '{nope'),
  'a dry run written to the log': (d) => { const f = path.join(d, 'entries', fs.readdirSync(path.join(d, 'entries')).sort()[3]); const e = JSON.parse(fs.readFileSync(f, 'utf8')); e.status = 'dry_run'; e.hash = entryHash(e); fs.writeFileSync(f, JSON.stringify(e)); },
};
for (const [name, mutate] of Object.entries(tamperLog)) {
  test(`deploy log: ${name} -> the log is no longer intact`, () => {
    const led = tmp('led-');
    appendEntry(led, { kind: 'genesis' });
    for (let i = 0; i < 3; i++) appendEntry(led, composeRunEntry(runNeeds(), { ...ENV, RUN_ID: String(100 + i) }));
    assert.equal(verifyLedger(led).ok, true);
    mutate(led);
    assert.equal(verifyLedger(led).ok, false, `expected a problem for: ${name}`);
  });
}
test('deploy log: an empty log is not intact', () => assert.equal(verifyLedger(tmp('led-')).ok, false));

test('deploy log: add-only check allows new entries and refuses any change, removal or file outside entries/', () => {
  const before = tmp('led-'); appendEntry(before, { kind: 'genesis' }); put(before, 'README.md', 'about');
  const grow = tmp('led-'); fs.cpSync(before, grow, { recursive: true }); appendEntry(grow, composeRunEntry(runNeeds(), ENV));
  assert.deepEqual(checkAddOnly(before, grow).problems, []);
  const edit = tmp('led-'); fs.cpSync(grow, edit, { recursive: true }); put(edit, 'README.md', 'changed');
  assert.equal(checkAddOnly(before, edit).ok, false);
  const rewrite = tmp('led-'); fs.cpSync(grow, rewrite, { recursive: true }); const f = path.join(rewrite, 'entries', '000000-genesis.json'); fs.writeFileSync(f, fs.readFileSync(f, 'utf8') + ' ');
  assert.equal(checkAddOnly(before, rewrite).ok, false);
  const remove = tmp('led-'); fs.cpSync(grow, remove, { recursive: true }); fs.rmSync(path.join(remove, 'entries', '000000-genesis.json'));
  assert.equal(checkAddOnly(before, remove).ok, false);
  const stray = tmp('led-'); fs.cpSync(grow, stray, { recursive: true }); put(stray, 'other.txt', 'x');
  assert.equal(checkAddOnly(before, stray).ok, false);
});

test('deploy log: finds the restore points recorded for a commit, newest first, and only exact matches', () => {
  const led = tmp('led-');
  appendEntry(led, { kind: 'genesis', restorePoint: { created: { commit: SHA, digest: '1'.repeat(64), runId: 1 } } });
  appendEntry(led, composeRunEntry(runNeeds(), ENV));
  const w = restorePointsFor(led, SHA);
  assert.deepEqual(w.map((x) => x.runId), [99, 1]);
  assert.equal(findWitness(led, '1'.repeat(64), SHA).runId, 1);
  assert.equal(findWitness(led, '1'.repeat(64), OTHER), null);
  assert.equal(findWitness(led, '9'.repeat(64), SHA), null);
  assert.deepEqual(restorePointsFor(led, OTHER), []);
});

test('deploy log: a rollback drill is recorded as its own kind of entry', () => {
  const e = composeDrillEntry(ENV, { used: { commit: SHA, digest: 'd'.repeat(64), runId: 5 }, result: 'success', liveCommit: SHA });
  assert.equal(e.kind, 'drill');
  assert.equal(e.drill.restoredCommit, SHA);
});

// ------------------------------------------------------------------ finding the restore point before a deploy
function fakeGithub(rp, { expired = false, corrupt = null } = {}) {
  return {
    listArtifacts: async () => [{ id: 1, name: 'restore-point', expired }],
    fetchArtifact: async (_id, dir) => { fs.cpSync(rp.dir, dir, { recursive: true }); if (corrupt) corrupt(dir); },
  };
}
function ledgerWith(rp, runId = 7, commit = SHA) {
  const led = tmp('led-');
  appendEntry(led, { kind: 'genesis' });
  appendEntry(led, { kind: 'run', run: { id: runId, attempt: 1 }, status: 'recorded_and_deployed', restorePoint: { created: { commit, digest: rp.manifest.digest, runId } } });
  return led;
}

test('finder: the live version has a witnessed, intact restore point -> found', async () => {
  const rp = goodRestorePoint();
  const r = await findRestorePoint({ ledgerDir: ledgerWith(rp), liveCommit: SHA, outDir: tmp('out-'), ...fakeGithub(rp) });
  assert.equal(r.manifest.digest, rp.manifest.digest);
  assert.equal(r.witness.runId, 7);
});

const findCases = {
  'the artifact has expired': async (rp) => ({ led: ledgerWith(rp), gh: fakeGithub(rp, { expired: true }) }),
  'the stored copy was altered': async (rp) => ({ led: ledgerWith(rp), gh: fakeGithub(rp, { corrupt: (d) => put(d, 'site/index.html', 'evil') }) }),
  'a file of the stored copy is missing': async (rp) => ({ led: ledgerWith(rp), gh: fakeGithub(rp, { corrupt: (d) => fs.rmSync(path.join(d, 'site/robots.txt')) }) }),
  'the deploy log has no restore point for the live commit': async (rp) => ({ led: ledgerWith(rp, 7, OTHER), gh: fakeGithub(rp) }),
  'the deploy log does not know this fingerprint': async (rp) => { const led = tmp('led-'); appendEntry(led, { kind: 'genesis', restorePoint: { created: { commit: SHA, digest: '9'.repeat(64), runId: 7 } } }); return { led, gh: fakeGithub(rp) }; },
  'the deploy log was edited': async (rp) => { const led = ledgerWith(rp); const f = path.join(led, 'entries', fs.readdirSync(path.join(led, 'entries')).sort()[1]); fs.writeFileSync(f, fs.readFileSync(f, 'utf8').replace('recorded_and_deployed', 'neither')); return { led, gh: fakeGithub(rp) }; },
  'the download fails': async (rp) => ({ led: ledgerWith(rp), gh: { listArtifacts: async () => [{ id: 1, name: 'restore-point', expired: false }], fetchArtifact: async () => { throw new Error('boom'); } } }),
  'GitHub cannot list the artifacts': async (rp) => ({ led: ledgerWith(rp), gh: { listArtifacts: async () => { throw new Error('503'); }, fetchArtifact: async () => {} } }),
};
for (const [name, build] of Object.entries(findCases)) {
  test(`finder: ${name} -> no restore point, deployment blocked`, async () => {
    const rp = goodRestorePoint();
    const { led, gh } = await build(rp);
    await assert.rejects(findRestorePoint({ ledgerDir: led, liveCommit: SHA, outDir: tmp('out-'), ...gh }), /./);
  });
}

test('finder: if the newest restore point is damaged but an older one for the same commit is intact, the intact one is used', async () => {
  const good = goodRestorePoint();
  const led = tmp('led-');
  appendEntry(led, { kind: 'genesis', restorePoint: { created: { commit: SHA, digest: good.manifest.digest, runId: 1 } } });
  appendEntry(led, { kind: 'run', run: { id: 2, attempt: 1 }, status: 'recorded_and_deployed', restorePoint: { created: { commit: SHA, digest: 'a1'.repeat(32), runId: 2 } } });
  const gh = { listArtifacts: async () => [{ id: 1, name: 'restore-point', expired: false }], fetchArtifact: async (_i, dir) => fs.cpSync(good.dir, dir, { recursive: true }) };
  const r = await findRestorePoint({ ledgerDir: led, liveCommit: SHA, outDir: tmp('out-'), ...gh });
  assert.equal(r.witness.runId, 1); // run 2's copy has a different fingerprint than the one witnessed, so it was refused
});

// ------------------------------------------------------------------ scripts, with a local bare repository as the remote
const git = (cwd, ...a) => execFileSync('git', a, { cwd, encoding: 'utf8', env: { ...process.env, GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@t', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@t' } });
function remoteLedger() {
  const bare = tmp('bare-') + '/r.git';
  fs.mkdirSync(bare); git(bare, 'init', '-q', '--bare', '-b', 'deploy-log');
  const seed = tmp('seed-'); git(seed, 'init', '-q', '-b', 'deploy-log');
  appendEntry(seed, { kind: 'genesis' }); put(seed, 'README.md', 'the deploy log');
  git(seed, 'add', '-A'); git(seed, 'commit', '-q', '-m', 'genesis'); git(seed, 'push', '-q', bare, 'HEAD:deploy-log');
  return bare;
}
const headOf = (bare) => git(bare, 'rev-parse', 'deploy-log').trim();
function runPush(bare, { push, env = {} } = {}) {
  return spawnSync('bash', ['tools/ledger-push.sh'], { cwd: ROOT, encoding: 'utf8', env: { ...process.env, LEDGER_URL: bare, PUSH: push ? 'true' : 'false', NEEDS_JSON: JSON.stringify(runNeeds()), ...ENV, ...env, LEDGER_WORK: tmp('work-') } });
}

test('ledger push: a run that is not on main builds and checks its entry but never changes the log', () => {
  const bare = remoteLedger(); const before = headOf(bare);
  const r = runPush(bare, { push: false });
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.match(r.stdout, /not pushed/);
  assert.equal(headOf(bare), before);
});

test('ledger push: a run on main adds exactly one new entry on top of the existing ones', () => {
  const bare = remoteLedger(); const before = headOf(bare);
  const r = runPush(bare, { push: true });
  assert.equal(r.status, 0, r.stdout + r.stderr);
  const check = tmp('check-'); git(check, 'clone', '-q', bare, 'c');
  const dir = path.join(check, 'c');
  assert.equal(verifyLedger(dir).entries, 2);
  assert.equal(git(dir, 'rev-list', '--count', 'HEAD').trim(), '2');
  assert.equal(git(dir, 'rev-parse', 'HEAD~1').trim(), before); // history only grew
  assert.equal(git(dir, 'diff', '--name-status', before, 'HEAD').trim().split('\n').every((l) => l.startsWith('A')), true);
});

test('ledger push: if another run pushed first, it starts again from the new head and nothing is overwritten', () => {
  const bare = remoteLedger();
  // reject the first push the way a lost race would, then accept
  const flag = path.join(tmp('flag-'), 'once');
  fs.writeFileSync(path.join(bare, 'hooks', 'pre-receive'), `#!/bin/sh\nif [ ! -e "${flag}" ]; then touch "${flag}"; echo "simulated: remote moved on" >&2; exit 1; fi\n`, { mode: 0o755 });
  const r = runPush(bare, { push: true });
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.match(r.stdout, /starting again/);
  const check = tmp('check-'); git(check, 'clone', '-q', bare, 'c');
  assert.equal(verifyLedger(path.join(check, 'c')).entries, 2);
});

test('ledger push: a competing run lands between clone and push -> ours is added on top, theirs is kept (no force)', () => {
  const bare = remoteLedger();
  const hooks = tmp('hooks-'); const flag = path.join(hooks, 'once'); const rival = path.join(hooks, 'rival.mjs');
  fs.writeFileSync(rival, `import { appendEntry } from ${JSON.stringify(path.join(ROOT, 'tools/deploy-log.mjs'))};\nappendEntry(process.argv[2], { kind: 'run', run: { id: 500, attempt: 1 }, status: 'neither' });\n`);
  fs.writeFileSync(path.join(hooks, 'pre-push'), `#!/bin/sh\nif [ ! -e "${flag}" ]; then touch "${flag}"; d=$(mktemp -d); git clone -q "${bare}" "$d/c" && node "${rival}" "$d/c" && git -C "$d/c" add -A && git -C "$d/c" -c user.name=x -c user.email=x@x commit -qm rival && git -C "$d/c" push -q origin HEAD:deploy-log; fi\nexit 0\n`, { mode: 0o755 });
  const r = runPush(bare, { push: true, env: { GIT_CONFIG_COUNT: '1', GIT_CONFIG_KEY_0: 'core.hooksPath', GIT_CONFIG_VALUE_0: hooks } });
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.match(r.stdout, /starting again/);
  const check = tmp('check-'); git(check, 'clone', '-q', bare, 'c');
  const dir = path.join(check, 'c');
  assert.equal(verifyLedger(dir).entries, 3);
  const names = fs.readdirSync(path.join(dir, 'entries')).sort();
  assert.match(names[1], /run500/); assert.match(names[2], /run99/); // the rival's entry is still there, ours came after it
});

test('ledger push: a damaged log on the remote stops the run before anything is added', () => {
  const bare = remoteLedger();
  const w = tmp('w-'); git(w, 'clone', '-q', bare, 'c'); const c = path.join(w, 'c');
  const f = path.join(c, 'entries', '000000-genesis.json'); fs.writeFileSync(f, fs.readFileSync(f, 'utf8').replace('genesis', 'GENESIS'));
  git(c, 'commit', '-qam', 'tamper'); git(c, 'push', '-q', 'origin', 'HEAD:deploy-log');
  const before = headOf(bare);
  const r = runPush(bare, { push: true });
  assert.notEqual(r.status, 0);
  assert.equal(headOf(bare), before);
});

test('ledger push: no remote log means failure, never a silent success', () => {
  const r = runPush('/nonexistent/path.git', { push: true });
  assert.notEqual(r.status, 0);
});

// ------------------------------------------------------------------ what happened to the permanent record
function recordRepo(withFiles = true) {
  const d = tmp('rec-'); const r = path.join(d, 'records'); fs.mkdirSync(r); git(r, 'init', '-q', '-b', 'records');
  if (withFiles) { put(r, 'days/2026/2026-11-05.ndjson', 'a\n'); git(r, 'add', '-A'); git(r, 'commit', '-qm', 'one'); }
  return r;
}
const recordState = (dir, before, isMain, outcome) => {
  const out = execFileSync('bash', ['tools/record-state.sh', dir, before, isMain, outcome], { cwd: ROOT, encoding: 'utf8' });
  return Object.fromEntries(out.trim().split('\n').map((l) => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1)]));
};

test('record state: a run on main that adds a file says saved and lists the file with its hash', () => {
  const r = recordRepo(); const before = git(r, 'rev-parse', 'HEAD').trim();
  put(r, 'days/2026/2026-11-06.ndjson', 'b\n'); git(r, 'add', '-A'); git(r, 'commit', '-qm', 'two');
  const s = recordState(r, before, 'true', 'success');
  assert.equal(s.record_state, 'saved'); assert.equal(s.record_before, before);
  const files = JSON.parse(s.record_files);
  assert.deepEqual(files.map((f) => f.path), ['days/2026/2026-11-06.ndjson']);
  assert.equal(files[0].sha256, execFileSync('sha256sum', [path.join(r, 'days/2026/2026-11-06.ndjson')], { encoding: 'utf8' }).split(' ')[0]);
});
test('record state: a first record in a brand new branch is saved', () => {
  const r = recordRepo(false); put(r, 'days/2026/a.ndjson', 'a\n'); git(r, 'add', '-A'); git(r, 'commit', '-qm', 'first');
  const s = recordState(r, 'none', 'true', 'success');
  assert.equal(s.record_state, 'saved'); assert.equal(JSON.parse(s.record_files).length, 1);
});
test('record state: nothing new tonight is already_saved; a failed save is failed; no record dir is unavailable; a branch run is not_run', () => {
  const r = recordRepo(); const head = git(r, 'rev-parse', 'HEAD').trim();
  assert.equal(recordState(r, head, 'true', 'success').record_state, 'already_saved');
  assert.equal(recordState(r, head, 'true', 'failure').record_state, 'failed');
  assert.equal(recordState(path.join(tmp('x-'), 'records'), 'none', 'true', 'success').record_state, 'unavailable');
  const branch = recordState(r, head, 'false', 'skipped');
  assert.equal(branch.record_state, 'not_run'); assert.equal(branch.record_files, '[]');
});
test('record state: reading it never changes the record', () => {
  const r = recordRepo(); const head = git(r, 'rev-parse', 'HEAD').trim(); const status = git(r, 'status', '--porcelain');
  recordState(r, head, 'true', 'success');
  assert.equal(git(r, 'rev-parse', 'HEAD').trim(), head); assert.equal(git(r, 'status', '--porcelain'), status);
});
