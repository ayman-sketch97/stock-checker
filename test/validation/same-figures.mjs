// Release check (VALIDATION.md, section 18): the same record run through an earlier version of lib/records.js and
// through this one, to show that no figure already measured changes: returns, the S&P 500, random halal stocks, beat
// rates, wrong calls, counts and the previous 90% interval must all come out the same. Only what the release adds may
// differ (the test of section 7.3.3 and the verdicts). A synthetic record of about 18 months: 60 companies, prices that
// wander, verdicts that change, so every kind of call is made and many reach 12 months.
// node test/validation/same-figures.mjs [old git ref = origin/main] [seed = 20261106]
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const ROOT = path.dirname(path.dirname(path.dirname(new URL(import.meta.url).pathname)));
const REF = process.argv[2] || 'origin/main';
let seed = Number(process.argv[3] || 20261106);
const rnd = () => { seed = (seed * 48271) % 2147483647; return seed / 2147483647; };

// the earlier lib/, as it was at REF, in a folder of its own
const oldLib = fs.mkdtempSync(path.join(os.tmpdir(), 'oldlib-'));
for (const f of execFileSync('git', ['-C', ROOT, 'ls-tree', '--name-only', `${REF}:lib`], { encoding: 'utf8' }).trim().split('\n'))
  fs.writeFileSync(path.join(oldLib, f), execFileSync('git', ['-C', ROOT, 'show', `${REF}:lib/${f}`], { maxBuffer: 64 << 20 }));
const OLD = await import(path.join(oldLib, 'records.js'));
const NEW = await import(path.join(ROOT, 'lib', 'records.js'));

// trading days from 4 November 2026
const days = [];
for (let d = new Date(Date.UTC(2026, 10, 4)); days.length < 400; d.setUTCDate(d.getUTCDate() + 1)) if (d.getUTCDay() % 6) days.push(d.toISOString().slice(0, 10));
const ymd = (s) => Number(s.replace(/-/g, ''));
const D = Int32Array.from(days.map(ymd));

const fields = ['ticker', 'sector', 'price', 'verdict', 'shariah', 'quality', 'health', 'growth', 'fair', 'upside', 'buyBelow', 'trimAbove', 'trend', 'dq'];
const T = Array.from({ length: 60 }, (_, i) => `T${String(i).padStart(2, '0')}`);
const SECT = ['Tech', 'Health', 'Industrials', 'Staples', 'Energy'];
const px = {};
const co = {};
for (const t of T) {
  const drift = (rnd() - 0.5) * 0.0016;
  const vol = 0.01 + rnd() * 0.02;
  let p = 50 + rnd() * 150;
  const c = [];
  for (let i = 0; i < days.length; i++) { const u = rnd() || 1e-9; p *= Math.exp(drift + vol * Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * rnd())); c.push(p); }
  px[t] = Float64Array.from(c);
  co[t] = { sector: SECT[Math.floor(rnd() * SECT.length)], shariah: rnd() < 0.8 ? 'pass' : 'fail', verdict: 'WATCH', fair: c[0] * (0.9 + rnd() * 0.6) };
}
{ let p = 100; px.SPY = Float64Array.from(days.map(() => (p *= Math.exp(0.0003 + 0.01 * (rnd() - 0.5) * 2)))); }
const VERDICTS = ['BUY', 'WATCH', 'AVOID_WEAK', 'AVOID_PRICEY'];
const rowsAt = (i) => {
  for (const t of T) if (rnd() < 0.03) co[t].verdict = VERDICTS[Math.floor(rnd() * VERDICTS.length)];
  return { fields, rows: T.map((t) => {
    const c = co[t];
    const p = px[t][i];
    return fields.map((k) => ({ ticker: t, sector: c.sector, price: Math.round(p * 100) / 100, verdict: c.verdict, shariah: c.shariah, quality: 70, health: 70, growth: 60, fair: c.fair, upside: c.fair / p - 1, buyBelow: c.fair * 0.85, trimAbove: c.fair * 1.3, trend: 'up', dq: 'high' })[k]);
  }) };
};
const upTo = (s, i) => ({ d: D.slice(0, i + 1), c: s.slice(0, i + 1) });

const dirs = { old: fs.mkdtempSync(path.join(os.tmpdir(), 'rec-old-')), new: fs.mkdtempSync(path.join(os.tmpdir(), 'rec-new-')) };
let A;
let B;
const t0 = Date.now();
for (let i = 0; i < days.length; i++) {
  const scr = rowsAt(i);
  const args = (R) => ({ date: days[i], built: `${days[i]}T22:00:00Z`, rows: R.rowsOf(scr), closesOf: (t) => (px[t] ? upTo(px[t], i) : null), spy: upTo(px.SPY, i), url: 'x' });
  A = OLD.updateRecord({ dir: dirs.old, ...args(OLD) });
  B = NEW.updateRecord({ dir: dirs.new, ...args(NEW) });
}

// every figure the earlier version reported, compared with the same figure now; the earlier 90% interval (y.lo, y.hi,
// y.days) now sits in y.prev, because y.lo and y.hi are the interval of the section 7.3.3 test
let same = 0;
const diffs = [];
const cmp = (a, b, where) => {
  if (a !== null && typeof a === 'object' && !Array.isArray(a)) {
    for (const k of Object.keys(a)) {
      if (where.endsWith('.y') && ['lo', 'hi', 'days'].includes(k)) { cmp(a[k], b.prev && b.prev[k], `${where}.prev.${k}`); continue; }
      cmp(a[k], b ? b[k] : undefined, `${where}.${k}`);
    }
    return;
  }
  if (JSON.stringify(a) === JSON.stringify(b)) same++;
  else diffs.push(`${where}: ${JSON.stringify(a)} -> ${JSON.stringify(b)}`);
};
for (const part of ['groups', 'standing']) cmp(A[part], B[part], part);
for (const k of Object.keys(A)) if (!['groups', 'standing'].includes(k)) cmp(A[k], B[k], k);
const calls = Object.values(B.groups).reduce((a, g) => a + g.n, 0);
const matured = Object.values(B.groups).reduce((a, g) => a + (g.h['12m'].matured || 0), 0);
console.log(`${days.length} nights (${days[0]} to ${days[days.length - 1]}), ${calls} calls since the start, ${matured} with their 12 months; ${((Date.now() - t0) / 1000).toFixed(0)} s`);
console.log(`figures the earlier version reported: ${same + diffs.length}; the same now: ${same}; different: ${diffs.length}`);
for (const x of diffs.slice(0, 40)) console.log('  ' + x);
const verdicts = Object.entries(B.groups).map(([k, g]) => `${k} ${g.h['12m'].verdict}${g.h['12m'].previous ? ` (previous method: ${g.h['12m'].previous.verdict})` : ''}`);
console.log('12-month verdicts now:', verdicts.join('; '));
process.exit(diffs.length ? 1 : 0);
