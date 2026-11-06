// Scans every file tracked by git for credentials (the same patterns tools/check-site.mjs applies to the built site).
//   node tools/scan-repo.mjs
import { execFileSync } from 'node:child_process';
import { scanSecrets } from './check-site.mjs';

const root = execFileSync('git', ['rev-parse', '--show-toplevel'], { encoding: 'utf8' }).trim();
const tracked = execFileSync('git', ['-C', root, 'ls-files', '-z'], { encoding: 'utf8' }).split('\0').filter(Boolean);
const problems = scanSecrets(root, tracked.map((rel) => ({ rel, dir: false })));
if (problems.length) {
  for (const p of problems) console.log(`::error::${p}`);
  console.log(`Secret scan FAILED: ${problems.length} problem${problems.length === 1 ? '' : 's'} in ${tracked.length} tracked files.`);
  process.exit(1);
}
console.log(`Secret scan passed: ${tracked.length} tracked files, no credentials found.`);
