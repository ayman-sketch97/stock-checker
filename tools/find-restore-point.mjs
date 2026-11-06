// Before a deployment: find, download and verify the restore point of the version that is live right now.
//   node tools/find-restore-point.mjs --ledger <deploy-log dir> --repo <owner/name> --live-url <url> --out <dir>
// Reads the live site's commit, asks the deploy log which restore points it recorded for that commit (newest first),
// downloads each one from the run that made it and verifies it (every file hash, the commit, the site checks, the
// deploy log's own witness entry). The first that verifies is used. If none does, exit 1: deployment is blocked.
// Needs GH_TOKEN with read access to Actions. Reads only; it changes nothing.
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { restorePointsFor, verifyLedger } from './deploy-log.mjs';
import { verifyRestorePoint } from './restore-point.mjs';

export async function readLiveCommit(url, fetchImpl = fetch) {
  const res = await fetchImpl(url.replace(/\/?$/, '/') + `data/health.json?find=${Date.now()}`, { headers: { 'cache-control': 'no-cache' } });
  if (res.status !== 200) throw new Error(`the live site's data/health.json answered ${res.status}`);
  const c = (await res.json()).commit;
  if (!/^[0-9a-f]{40}$/.test(String(c || ''))) throw new Error('the live site does not say which commit it was built from');
  return c;
}

export async function findRestorePoint({ ledgerDir, liveCommit, outDir, listArtifacts, fetchArtifact }) {
  const led = verifyLedger(ledgerDir);
  if (!led.ok) throw new Error('the deploy log is not intact: ' + led.problems.join('; '));
  const witnessed = restorePointsFor(ledgerDir, liveCommit);
  if (!witnessed.length) throw new Error(`the deploy log has no restore point recorded for the live version (${liveCommit.slice(0, 7)})`);
  const tried = [];
  for (const w of witnessed) {
    let arts;
    try { arts = await listArtifacts(w.runId); } catch (e) { tried.push(`run ${w.runId}: could not list artifacts (${e.message})`); continue; }
    const a = arts.find((x) => x.name === 'restore-point' && !x.expired);
    if (!a) { tried.push(`run ${w.runId}: the restore-point artifact is missing or has expired`); continue; }
    const dir = path.join(outDir, String(w.runId));
    fs.rmSync(dir, { recursive: true, force: true });
    fs.mkdirSync(dir, { recursive: true });
    try { await fetchArtifact(a.id, dir); } catch (e) { tried.push(`run ${w.runId}: download failed (${e.message})`); continue; }
    const v = await verifyRestorePoint(dir, { commit: liveCommit, digest: w.digest, ledgerDir });
    if (v.ok) return { dir, witness: w, manifest: v.manifest };
    tried.push(`run ${w.runId}: ${v.problems.join('; ')}`);
  }
  throw new Error('no restore point could be verified: ' + tried.join(' | '));
}

function githubApi(repo, token) {
  const h = { authorization: `Bearer ${token}`, accept: 'application/vnd.github+json', 'x-github-api-version': '2022-11-28' };
  return {
    async listArtifacts(runId) {
      const r = await fetch(`https://api.github.com/repos/${repo}/actions/runs/${runId}/artifacts?per_page=100`, { headers: h });
      if (r.status !== 200) throw new Error(`GitHub answered ${r.status}`);
      return (await r.json()).artifacts;
    },
    async fetchArtifact(id, dir) {
      const r = await fetch(`https://api.github.com/repos/${repo}/actions/artifacts/${id}/zip`, { headers: h });
      if (r.status !== 200) throw new Error(`GitHub answered ${r.status}`);
      const zip = path.join(dir, '.download.zip');
      fs.writeFileSync(zip, Buffer.from(await r.arrayBuffer()));
      execFileSync('unzip', ['-q', zip, '-d', dir]);
      fs.rmSync(zip);
    },
  };
}

if (import.meta.url === pathToFileURL(process.argv[1] || '').href) {
  const opt = (k) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : undefined; };
  const out = (kv) => { if (process.env.GITHUB_OUTPUT) fs.appendFileSync(process.env.GITHUB_OUTPUT, Object.entries(kv).map(([k, v]) => `${k}=${v}\n`).join('')); };
  try {
    const live = await readLiveCommit(opt('--live-url'));
    console.log(`The live site is commit ${live.slice(0, 7)}.`);
    const api = githubApi(opt('--repo'), process.env.GH_TOKEN);
    const r = await findRestorePoint({ ledgerDir: path.resolve(opt('--ledger')), liveCommit: live, outDir: path.resolve(opt('--out')), ...api });
    console.log(`Restore point verified: commit ${r.manifest.commit.slice(0, 7)}, ${r.manifest.files} files, prices of ${r.manifest.priceDate}, fingerprint ${r.manifest.digest}, made by run ${r.witness.runId}.`);
    out({ commit: r.manifest.commit, digest: r.manifest.digest, run: r.witness.runId, dir: r.dir });
  } catch (e) {
    console.log(`::error::No verified restore point for the live version: ${e.message}`);
    console.log('Deployment is blocked until a restore point can be verified.');
    process.exit(1);
  }
}
