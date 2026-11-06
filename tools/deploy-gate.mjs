// The deployment gate: the site is published only if EVERY required job succeeded. A job that failed, was skipped,
// was cancelled or is missing counts as not passed. Used by the "gate" job of .github/workflows/update-site.yml.
//   NEEDS_JSON='{"formulas":{"result":"success"}, ...}' REQUIRED=formulas,page-tests node tools/deploy-gate.mjs
// (NEEDS_JSON is the workflow's `toJSON(needs)`.) Exit 0 only when all required results are exactly "success".
import { pathToFileURL } from 'node:url';

export function evaluateGate(needs, required) {
  const rows = required.map((job) => {
    const result = needs && needs[job] && typeof needs[job].result === 'string' ? needs[job].result : 'missing';
    return { job, result, pass: result === 'success' };
  });
  const blocked = rows.filter((r) => !r.pass);
  return { pass: rows.length > 0 && blocked.length === 0, rows, blocked };
}

if (import.meta.url === pathToFileURL(process.argv[1] || '').href) {
  const required = (process.env.REQUIRED || '').split(',').map((s) => s.trim()).filter(Boolean);
  let needs = null;
  try { needs = JSON.parse(process.env.NEEDS_JSON || ''); } catch { /* treated as nothing passed */ }
  const g = evaluateGate(needs, required);
  for (const r of g.rows) console.log(`${r.pass ? 'pass   ' : 'BLOCKED'} ${r.job}: ${r.result}`);
  if (!required.length) console.log('::error::No required checks were listed, so nothing can pass.');
  if (!g.pass) {
    console.log(`::error::Deployment blocked: ${g.blocked.map((r) => `${r.job} ${r.result}`).join(', ') || 'no required checks'}. The live site is unchanged.`);
    process.exit(1);
  }
  console.log('All required checks passed.');
}
