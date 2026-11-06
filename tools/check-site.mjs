// Security and data-integrity checks on a BUILT site folder, run before anything is published.
//   node tools/check-site.mjs <site dir> [--commit <sha>]     (the commit defaults to $GITHUB_SHA)
// Fails (exit 1) on the first class of problem it finds, listing every one. It reads the folder only.
// Display-only: it never touches the analysis, the advice or the record.
import fs from 'node:fs';
import crypto from 'node:crypto';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
export const REQUIRED_FILES = [
  'index.html', 'manifest.json', 'favicon.svg', 'robots.txt', '.nojekyll', 'fonts/inter-var-latin.woff2',
  'vendor/lightweight-charts.js', 'data/health.json', 'data/index.json', 'data/screen.json', 'data/record-summary.json',
];
export const JSON_FILES = ['manifest.json', 'data/health.json', 'data/index.json', 'data/screen.json', 'data/record-summary.json'];
// a published page must never carry a credential; these are the shapes GitHub, AWS and private keys take
export const SECRET_PATTERNS = [
  ['GitHub token', /\b(?:ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9]{30,}\b/],
  ['GitHub fine-grained token', /\bgithub_pat_[A-Za-z0-9_]{40,}\b/],
  ['token inside a URL', /x-access-token:[^@\s/]{8,}@/],
  ['AWS access key', /\bAKIA[0-9A-Z]{16}\b/],
  ['private key', /-----BEGIN (?:RSA |EC |OPENSSH |DSA |PGP )?PRIVATE KEY-----/],
  ['bearer credential', /\bAuthorization:\s*Bearer\s+[A-Za-z0-9._~+/=-]{16,}/i],
];
const FORBIDDEN_NAMES = [/^\.git$/, /^\.env/, /\.pem$/, /\.key$/, /^node_modules$/, /^\.npmrc$/, /^records$/, /^id_rsa/];
const TEXT_EXT = /\.(html?|js|mjs|json|css|svg|txt|md|ya?ml|sh|py|csv|xml|webmanifest)$/i;

export function walk(dir, rel = '') {
  const out = [];
  for (const e of fs.readdirSync(path.join(dir, rel), { withFileTypes: true })) {
    const r = rel ? `${rel}/${e.name}` : e.name;
    out.push({ rel: r, dir: e.isDirectory(), link: e.isSymbolicLink() });
    if (e.isDirectory()) out.push(...walk(dir, r));
  }
  return out;
}

export function scanSecrets(dir, files) {
  const problems = [];
  for (const f of files) {
    if (f.dir || !TEXT_EXT.test(f.rel)) continue;
    let text;
    try { text = fs.readFileSync(path.join(dir, f.rel), 'utf8'); } catch { continue; }
    for (const [name, re] of SECRET_PATTERNS) if (re.test(text)) problems.push(`${f.rel}: looks like a ${name}`);
  }
  return problems;
}

export function sha256File(file) { return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex'); }

// a fingerprint of the whole folder (names and bytes), so the folder that was checked can be told from any other
export function folderDigest(dir) {
  const h = crypto.createHash('sha256');
  for (const f of walk(dir).filter((x) => !x.dir).sort((a, b) => (a.rel < b.rel ? -1 : 1))) {
    h.update(f.rel + '\0'); h.update(fs.readFileSync(path.join(dir, f.rel))); h.update('\0');
  }
  return h.digest('hex');
}

export function checkSite(dir, { commit, pins, ignoreHidden = false } = {}) {
  const problems = [];
  const bad = (m) => problems.push(m);
  if (!fs.existsSync(dir) || !fs.statSync(dir).isDirectory()) return { ok: false, problems: [`${dir} is not a folder`], files: 0 };
  const files = walk(dir);

  // 1. nothing that should never be public
  for (const f of files) {
    if (f.link) bad(`${f.rel}: symbolic link (not allowed in a published site)`);
    if (FORBIDDEN_NAMES.some((re) => re.test(path.basename(f.rel)))) bad(`${f.rel}: must not be published`);
  }
  // 2. no credentials in any text file
  problems.push(...scanSecrets(dir, files));
  // 3. every file the page needs is there and not empty
  for (const r of REQUIRED_FILES) {
    if (ignoreHidden && path.basename(r).startsWith('.')) continue; // a published Pages artifact leaves dotfiles out
    const p = path.join(dir, r);
    if (!fs.existsSync(p)) bad(`${r}: missing`);
    else if (r !== '.nojekyll' && fs.statSync(p).size === 0) bad(`${r}: empty`);
  }
  // 4. the data files parse
  const json = {};
  for (const r of JSON_FILES) {
    const p = path.join(dir, r);
    if (!fs.existsSync(p)) continue;
    try { json[r] = JSON.parse(fs.readFileSync(p, 'utf8')); } catch (e) { bad(`${r}: not valid JSON (${e.message.slice(0, 60)})`); }
  }
  // 5. the page went through the build's swaps (a raw template would run in the wrong mode)
  const html = fs.existsSync(path.join(dir, 'index.html')) ? fs.readFileSync(path.join(dir, 'index.html'), 'utf8') : '';
  if (html.includes('/*BUILD:MODE*/') || html.includes('/*SAFE-AREA*/')) bad('index.html: still the unbuilt template');
  if (html && !html.includes("const MODE = 'static';")) bad("index.html: not built in 'static' mode");
  // 6. the data describes a real, complete-looking build, and is the build of THIS commit
  const health = json['data/health.json'];
  if (health) {
    if (!Array.isArray(health.checks) || !health.checks.length) bad('data/health.json: no checks recorded');
    if (!/^\d{4}-\d\d-\d\d/.test(String(health.priceDate || ''))) bad('data/health.json: no price date');
    if (commit) {
      if (!health.commit) bad('data/health.json: no commit recorded');
      else if (health.commit !== commit) bad(`data/health.json: built from ${String(health.commit).slice(0, 7)}, not the commit being deployed (${commit.slice(0, 7)})`);
    }
  }
  const screen = json['data/screen.json'];
  if (screen && !(Array.isArray(screen.rows) && screen.rows.length > 0 && Array.isArray(screen.fields))) bad('data/screen.json: no companies');
  const index = json['data/index.json'];
  if (index && screen && Array.isArray(screen.rows)) {
    const n = Array.isArray(index) ? index.length : Array.isArray(index.rows) ? index.rows.length : Array.isArray(index.companies) ? index.companies.length : null;
    if (n !== null && n === 0) bad('data/index.json: no companies');
  }
  // 7. third-party files are exactly the pinned ones
  for (const [rel, pin] of Object.entries((pins && pins.files) || {})) {
    const p = path.join(dir, rel);
    if (!fs.existsSync(p)) continue; // reported as missing above when required
    const got = sha256File(p);
    if (got !== pin.sha256) bad(`${rel}: differs from the pinned ${pin.package} (${got.slice(0, 12)}…, expected ${pin.sha256.slice(0, 12)}…)`);
  }
  return { ok: problems.length === 0, problems, files: files.filter((f) => !f.dir).length, digest: problems.length ? null : folderDigest(dir) };
}

if (import.meta.url === pathToFileURL(process.argv[1] || '').href) {
  const dir = process.argv[2];
  const ci = process.argv.indexOf('--commit');
  const commit = ci > 0 ? process.argv[ci + 1] : process.env.GITHUB_SHA || '';
  if (!dir) { console.error('usage: node tools/check-site.mjs <site dir> [--commit <sha>] [--no-hidden]'); process.exit(2); }
  const pins = JSON.parse(fs.readFileSync(path.join(HERE, 'vendor-pins.json'), 'utf8'));
  const r = checkSite(path.resolve(dir), { commit, pins, ignoreHidden: process.argv.includes('--no-hidden') });
  if (!r.ok) {
    for (const p of r.problems) console.log(`::error::${p}`);
    console.log(`Site check FAILED: ${r.problems.length} problem${r.problems.length === 1 ? '' : 's'} in ${r.files} files.`);
    process.exit(1);
  }
  console.log(`Site check passed: ${r.files} files, built from ${commit ? commit.slice(0, 7) : '(no commit given)'}, folder fingerprint ${r.digest}`);
  if (process.env.GITHUB_OUTPUT) fs.appendFileSync(process.env.GITHUB_OUTPUT, `digest=${r.digest}\n`);
}
