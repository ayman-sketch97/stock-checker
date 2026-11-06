// The permanent deployment log: an append-only ledger kept on its own branch (deploy-log), one JSON file per run.
//   node tools/deploy-log.mjs verify <ledger dir>                      the chain of entries is intact
//   node tools/deploy-log.mjs add-only <before dir> <after dir>        nothing that existed was changed or removed
//   node tools/deploy-log.mjs append <ledger dir> <entry.json>         add an entry (never overwrites)
//   node tools/deploy-log.mjs compose <ledger dir>                     build tonight's entry from the run (env) and add it
//   node tools/deploy-log.mjs witness <ledger dir> --commit <sha>      restore points the log has recorded for a commit
// Every entry names the analysis commit, the build, the record files written (with hashes), each gate result, the
// deployment result, the live check and any rollback, and says in one field whether the night's recommendations were
// RECORDED, DEPLOYED, both or neither. Each entry carries the hash of the one before it, so an edit anywhere breaks
// the chain. Nothing here touches the recommendation records themselves (the "records" branch).
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { pathToFileURL } from 'node:url';

export const LEDGER_VERSION = 1;
export const STATUSES = ['recorded_and_deployed', 'recorded_not_deployed', 'not_recorded_deployed', 'neither', 'dry_run'];
const HASH_RE = /^[0-9a-f]{64}$/;

export function canonical(v) {
  if (Array.isArray(v)) return '[' + v.map(canonical).join(',') + ']';
  if (v && typeof v === 'object') return '{' + Object.keys(v).sort().filter((k) => v[k] !== undefined).map((k) => JSON.stringify(k) + ':' + canonical(v[k])).join(',') + '}';
  return JSON.stringify(v === undefined ? null : v);
}
export function entryHash(e) {
  const { hash, ...rest } = e;
  return crypto.createHash('sha256').update(canonical(rest)).digest('hex');
}

// recorded = the night's recommendations are in the permanent record; deployed = the site was published AND the live
// site was checked and served that commit. The two are independent, so all four combinations are possible.
export function deriveStatus({ recordState, deployResult, liveResult, dryRun = false }) {
  if (dryRun) return 'dry_run';
  const recorded = recordState === 'saved' || recordState === 'already_saved';
  const deployed = deployResult === 'success' && liveResult === 'success';
  if (recorded && deployed) return 'recorded_and_deployed';
  if (recorded) return 'recorded_not_deployed';
  if (deployed) return 'not_recorded_deployed';
  return 'neither';
}

const entriesDir = (dir) => path.join(dir, 'entries');
export function listEntryFiles(dir) {
  const d = entriesDir(dir);
  if (!fs.existsSync(d)) return [];
  return fs.readdirSync(d).filter((f) => f.endsWith('.json')).sort();
}
export function readEntries(dir) {
  return listEntryFiles(dir).map((f) => ({ file: f, entry: JSON.parse(fs.readFileSync(path.join(entriesDir(dir), f), 'utf8')) }));
}

export function verifyLedger(dir) {
  const problems = [];
  const rows = (() => { try { return readEntries(dir); } catch (e) { problems.push('an entry is not valid JSON: ' + e.message); return []; } })();
  if (!rows.length && !problems.length) problems.push('the log has no entries (it must start with a genesis entry)');
  let prev = null;
  rows.forEach(({ file, entry }, i) => {
    const where = `entries/${file}`;
    if (entry.v !== LEDGER_VERSION) problems.push(`${where}: unknown version ${entry.v}`);
    if (entry.seq !== i) problems.push(`${where}: expected sequence number ${i}, found ${entry.seq}`);
    if (!file.startsWith(String(i).padStart(6, '0') + '-')) problems.push(`${where}: the file name does not match its sequence number`);
    if ((entry.prev ?? null) !== prev) problems.push(`${where}: does not continue from the entry before it`);
    if (!HASH_RE.test(String(entry.hash || '')) || entryHash(entry) !== entry.hash) problems.push(`${where}: its content does not match its hash (edited after it was written)`);
    if (!STATUSES.includes(entry.status) && entry.kind !== 'genesis') problems.push(`${where}: unknown status ${entry.status}`);
    if (entry.status === 'dry_run') problems.push(`${where}: a dry run must never be written to the log`);
    prev = entry.hash;
  });
  return { ok: problems.length === 0, problems, entries: rows.length, head: prev };
}

function allFiles(dir, base = dir, out = []) {
  if (!fs.existsSync(dir)) return out;
  for (const n of fs.readdirSync(dir)) {
    if (n === '.git') continue;
    const p = path.join(dir, n);
    if (fs.statSync(p).isDirectory()) allFiles(p, base, out); else out.push(path.relative(base, p));
  }
  return out.sort();
}
// the log only grows: every file that existed is still there with exactly the same bytes; new files go under entries/
export function checkAddOnly(beforeDir, afterDir) {
  const problems = [];
  for (const rel of allFiles(beforeDir)) {
    const a = path.join(afterDir, rel);
    if (!fs.existsSync(a)) problems.push(`${rel}: removed`);
    else if (!fs.readFileSync(a).equals(fs.readFileSync(path.join(beforeDir, rel)))) problems.push(`${rel}: changed`);
  }
  const before = new Set(allFiles(beforeDir));
  for (const rel of allFiles(afterDir)) if (!before.has(rel) && !rel.startsWith('entries' + path.sep)) problems.push(`${rel}: new file outside entries/`);
  return { ok: problems.length === 0, problems };
}

export function appendEntry(dir, partial, { now = new Date() } = {}) {
  const rows = readEntries(dir);
  const seq = rows.length;
  const prev = rows.length ? rows[rows.length - 1].entry.hash : null;
  const kind = partial.kind || 'run';
  const entry = { v: LEDGER_VERSION, ...partial, kind, seq, prev, recordedAt: partial.recordedAt || now.toISOString() };
  delete entry.hash;
  entry.hash = entryHash(entry);
  const tag = kind === 'genesis' ? 'genesis' : `${kind}-run${entry.run?.id ?? 'x'}-a${entry.run?.attempt ?? 1}`;
  const file = path.join(entriesDir(dir), `${String(seq).padStart(6, '0')}-${tag}.json`);
  fs.mkdirSync(entriesDir(dir), { recursive: true });
  if (fs.existsSync(file)) throw new Error(`${file} already exists; the log never overwrites`);
  fs.writeFileSync(file, JSON.stringify(entry, null, 1) + '\n', { flag: 'wx' });
  return { entry, file };
}

// restore points the log says were made, newest first. An entry witnesses a restore point by naming its commit,
// fingerprint and the run whose artifact holds it.
export function restorePointsFor(dir, commit) {
  return readEntries(dir).map((r) => r.entry).filter((e) => e.restorePoint?.created && (!commit || e.restorePoint.created.commit === commit)).map((e) => ({ seq: e.seq, ...e.restorePoint.created })).reverse();
}
export function findWitness(dir, digest, commit) {
  return restorePointsFor(dir, commit).find((w) => w.digest === digest) || null;
}

const asBool = (v) => v === true || v === 'true';
const parse = (v, d) => { try { return typeof v === 'string' && v ? JSON.parse(v) : (v ?? d); } catch { return d; } };

// builds the entry for one workflow run from the job results and outputs (the workflow's `needs` context)
export function composeRunEntry(needs, env, { dryRun = false } = {}) {
  const res = (j) => needs?.[j]?.result ?? 'missing';
  const out = (j) => needs?.[j]?.outputs ?? {};
  const b = out('build'), vl = out('verify-live'), rp = out('restore-point'), vs = out('verify-site');
  const recordState = b.record_state || 'unknown';
  const gates = {};
  for (const j of ['formulas', 'page-tests', 'security', 'build', 'verify-site', 'restore-point', 'gate']) gates[j] = res(j);
  const deployResult = res('deploy'), liveResult = res('verify-live');
  const rolledBack = res('rollback');
  return {
    kind: 'run',
    run: { id: Number(env.RUN_ID), attempt: Number(env.RUN_ATTEMPT || 1), event: env.EVENT, ref: env.REF, url: `${env.SERVER_URL || 'https://github.com'}/${env.REPO}/actions/runs/${env.RUN_ID}` },
    analysisCommit: env.SHA,
    build: { builtAt: b.built_at || null, priceDate: b.price_date || null, siteDigest: vs.digest || null },
    record: { state: recordState, headBefore: b.record_before || null, headAfter: b.record_after || null, files: parse(b.record_files, []) },
    gates,
    deploy: { result: deployResult },
    live: { result: liveResult, commit: liveResult === 'success' ? env.SHA : null },
    rollback: { result: rolledBack },
    restorePoint: {
      used: rp.used_digest ? { commit: rp.used_commit, digest: rp.used_digest, runId: Number(rp.used_run) } : null,
      created: vl.created_digest ? { commit: vl.created_commit, digest: vl.created_digest, runId: Number(env.RUN_ID), artifact: 'restore-point', manifestFiles: Number(vl.created_files) || null } : null,
    },
    status: deriveStatus({ recordState, deployResult, liveResult, dryRun }),
    rolledBack: rolledBack === 'success',
  };
}

export function composeDrillEntry(env, { used, result, liveCommit }) {
  return {
    kind: 'drill',
    run: { id: Number(env.RUN_ID), attempt: Number(env.RUN_ATTEMPT || 1), event: env.EVENT, ref: env.REF, url: `${env.SERVER_URL || 'https://github.com'}/${env.REPO}/actions/runs/${env.RUN_ID}` },
    analysisCommit: env.SHA,
    drill: { result, restoredCommit: used.commit, restoredDigest: used.digest, restorePointRun: used.runId, liveCommitAfter: liveCommit },
    status: result === 'success' ? 'recorded_and_deployed' : 'neither',
  };
}

if (import.meta.url === pathToFileURL(process.argv[1] || '').href) {
  const [cmd, a, b] = process.argv.slice(2);
  const opt = (k) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : undefined; };
  const fail = (m) => { console.log(`::error::${m}`); process.exit(1); };
  if (cmd === 'verify') {
    const r = verifyLedger(path.resolve(a));
    if (!r.ok) { r.problems.forEach((p) => console.log(`::error::${p}`)); fail(`deploy log NOT intact (${r.problems.length} problem${r.problems.length === 1 ? '' : 's'})`); }
    console.log(`Deploy log intact: ${r.entries} entries, head ${r.head.slice(0, 12)}`);
  } else if (cmd === 'add-only') {
    const r = checkAddOnly(path.resolve(a), path.resolve(b));
    if (!r.ok) { r.problems.forEach((p) => console.log(`::error::${p}`)); fail('the deploy log may only be added to'); }
    console.log('Add-only check passed: nothing that existed was changed or removed.');
  } else if (cmd === 'append') {
    const { entry, file } = appendEntry(path.resolve(a), JSON.parse(fs.readFileSync(path.resolve(b), 'utf8')));
    console.log(`Appended entry ${entry.seq} (${entry.status}) to ${path.basename(file)}`);
  } else if (cmd === 'compose') {
    const needs = JSON.parse(process.env.NEEDS_JSON || '{}');
    const partial = process.env.KIND === 'drill'
      ? composeDrillEntry(process.env, { used: JSON.parse(process.env.USED_JSON), result: process.env.DRILL_RESULT, liveCommit: process.env.LIVE_COMMIT })
      : composeRunEntry(needs, process.env);
    const { entry, file } = appendEntry(path.resolve(a), partial);
    console.log(`Appended entry ${entry.seq}: ${entry.status} (${path.basename(file)})`);
    if (process.env.GITHUB_STEP_SUMMARY) fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, `\n**Deploy log entry ${entry.seq}: ${entry.status}**\n`);
  } else if (cmd === 'witness') {
    console.log(JSON.stringify(restorePointsFor(path.resolve(a), opt('--commit')), null, 1));
  } else { console.error('usage: deploy-log.mjs verify|add-only|append|compose|witness ...'); process.exit(2); }
}
