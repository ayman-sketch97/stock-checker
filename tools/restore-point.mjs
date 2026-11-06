// Restore points: a verified copy of a site that was live (or is about to be replaced), kept so it can be put back.
//   node tools/restore-point.mjs create <site dir> <out dir> --commit <sha> --source <text> [--run <id>]
//   node tools/restore-point.mjs verify <restore point dir> [--commit <sha>] [--digest <sha256>] [--ledger <deploy-log dir>]
// A restore point is <dir>/manifest.json and <dir>/site/. The manifest names the commit it was built from, the SHA-256 of
// every file and one fingerprint of the whole folder. verify recomputes all of it; it fails (exit 1) on any difference,
// so a restore point that is damaged, altered, for the wrong commit or not witnessed in the deploy log is never trusted.
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { checkSite, folderDigest, sha256File, walk } from './check-site.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
export const MANIFEST_VERSION = 1;

export function hashesOf(dir) {
  const out = {};
  for (const f of walk(dir).filter((x) => !x.dir)) out[f.rel] = sha256File(path.join(dir, f.rel));
  return out;
}

export function createRestorePoint(siteDir, outDir, { commit, source, run = null, pins = null, now = new Date() } = {}) {
  if (!commit) throw new Error('a restore point needs the commit it was built from');
  const check = checkSite(siteDir, { commit, pins, ignoreHidden: true });
  if (!check.ok) throw new Error('the site does not pass its checks: ' + check.problems.join('; '));
  const health = JSON.parse(fs.readFileSync(path.join(siteDir, 'data/health.json'), 'utf8'));
  fs.mkdirSync(path.join(outDir, 'site'), { recursive: true });
  fs.cpSync(siteDir, path.join(outDir, 'site'), { recursive: true });
  const hashes = hashesOf(path.join(outDir, 'site'));
  const manifest = {
    schema: MANIFEST_VERSION, commit, builtAt: health.builtAt || null, priceDate: health.priceDate || null,
    source: source || null, run, createdAt: now.toISOString(), files: Object.keys(hashes).length,
    digest: folderDigest(path.join(outDir, 'site')), hashes,
  };
  fs.writeFileSync(path.join(outDir, 'manifest.json'), JSON.stringify(manifest, null, 1));
  return manifest;
}

export async function verifyRestorePoint(dir, { commit, digest, ledgerDir, pins } = {}) {
  const problems = [];
  const bad = (m) => problems.push(m);
  let m = null;
  try { m = JSON.parse(fs.readFileSync(path.join(dir, 'manifest.json'), 'utf8')); } catch { return { ok: false, problems: ['manifest.json is missing or not valid JSON'] }; }
  if (m.schema !== MANIFEST_VERSION) bad(`unknown manifest version ${m.schema}`);
  if (!/^[0-9a-f]{40}$/.test(String(m.commit || ''))) bad('the manifest names no valid commit');
  if (!/^[0-9a-f]{64}$/.test(String(m.digest || ''))) bad('the manifest has no valid folder fingerprint');
  const site = path.join(dir, 'site');
  if (!fs.existsSync(site)) return { ok: false, problems: [...problems, 'the site folder is missing'] };
  // every file hash, in both directions: nothing altered, nothing missing, nothing added
  const now = hashesOf(site);
  const want = m.hashes || {};
  for (const [rel, h] of Object.entries(want)) {
    if (!(rel in now)) bad(`${rel}: missing from the stored copy`);
    else if (now[rel] !== h) bad(`${rel}: differs from the hash in the manifest`);
  }
  for (const rel of Object.keys(now)) if (!(rel in want)) bad(`${rel}: not in the manifest`);
  if (m.files !== Object.keys(now).length) bad(`the manifest counts ${m.files} files, the copy has ${Object.keys(now).length}`);
  if (folderDigest(site) !== m.digest) bad('the folder fingerprint differs from the manifest');
  // the claimed commit: the manifest, the site's own health report and what the caller expects must all agree
  let siteCommit = null;
  try { siteCommit = JSON.parse(fs.readFileSync(path.join(site, 'data/health.json'), 'utf8')).commit; } catch { /* reported below */ }
  if (siteCommit !== m.commit) bad(`the site was built from ${String(siteCommit).slice(0, 7)}, the manifest claims ${String(m.commit).slice(0, 7)}`);
  if (commit && commit !== m.commit) bad(`expected commit ${commit.slice(0, 7)}, the restore point is ${String(m.commit).slice(0, 7)}`);
  if (digest && digest !== m.digest) bad('the fingerprint is not the one that was verified before');
  // the same security and integrity checks as a new build (no pin check here: the pin may have moved since)
  const c = checkSite(site, { commit: m.commit, pins, ignoreHidden: true });
  for (const p of c.problems) bad(`site check: ${p}`);
  // an independent witness: the deploy log, written when this restore point was made, names the same commit and fingerprint
  if (ledgerDir) {
    const { findWitness } = await import('./deploy-log.mjs');
    const w = findWitness(ledgerDir, m.digest, m.commit);
    if (!w) bad('the deploy log has no entry that witnesses this restore point');
  }
  return { ok: problems.length === 0, problems, manifest: { commit: m.commit, digest: m.digest, files: m.files, builtAt: m.builtAt, priceDate: m.priceDate, source: m.source } };
}

if (import.meta.url === pathToFileURL(process.argv[1] || '').href) {
  const [cmd, a, b] = process.argv.slice(2);
  const opt = (k) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : undefined; };
  const pins = JSON.parse(fs.readFileSync(path.join(HERE, 'vendor-pins.json'), 'utf8'));
  const out = (kv) => { if (process.env.GITHUB_OUTPUT) fs.appendFileSync(process.env.GITHUB_OUTPUT, Object.entries(kv).map(([k, v]) => `${k}=${v}\n`).join('')); };
  try {
    if (cmd === 'create') {
      const m = createRestorePoint(path.resolve(a), path.resolve(b), { commit: opt('--commit'), source: opt('--source'), run: opt('--run') || null, pins });
      console.log(`Restore point made: commit ${m.commit.slice(0, 7)}, ${m.files} files, fingerprint ${m.digest}`);
      out({ commit: m.commit, digest: m.digest });
    } else if (cmd === 'verify') {
      const r = await verifyRestorePoint(path.resolve(a), { commit: opt('--commit'), digest: opt('--digest'), ledgerDir: opt('--ledger') ? path.resolve(opt('--ledger')) : undefined });
      if (!r.ok) { for (const p of r.problems) console.log(`::error::${p}`); console.log(`Restore point NOT verified (${r.problems.length} problem${r.problems.length === 1 ? '' : 's'}). Deployment is blocked.`); process.exit(1); }
      console.log(`Restore point verified: commit ${r.manifest.commit.slice(0, 7)}, ${r.manifest.files} files, prices of ${r.manifest.priceDate}, fingerprint ${r.manifest.digest}`);
      out({ commit: r.manifest.commit, digest: r.manifest.digest });
    } else { console.error('usage: restore-point.mjs create|verify ...'); process.exit(2); }
  } catch (e) { console.log(`::error::${e.message}`); process.exit(1); }
}
