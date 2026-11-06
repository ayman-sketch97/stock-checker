// Section 7.3 checked by simulation (VALIDATION.md, section 16): records with no skill at all, built with the
// dependence real calls have (calls made close together share most of their 12 months, and the same company is called
// again and again), judged exactly as the Record page judges them. For each kind of record it counts how often any of
// the six kinds of call would pass by chance (the familywise false-pass rate, at most 2.5% by design), under the test
// that is live (lib/records.js, section 7.3.3) and under the resampling first approved on 3 November (kept here only to
// show why it was replaced). It also counts warnings under no skill, and how often a real edge is found.
// node test/validation/stats73-null.mjs [records per cell = 300] [seed = 20261106] [months = 36,60,120] [live | both]
import { gapTest, judgeKinds, GROUPS } from '../../lib/records.js';

const R = Number(process.argv[2] || 300);
let seed = Number(process.argv[3] || 20261106);
const LENGTHS = (process.argv[4] || '36,60,120').split(',').map(Number);
const BOTH = (process.argv[5] || 'both') === 'both';
const rnd = () => { seed = (seed * 48271) % 2147483647; return seed / 2147483647; };
const normal = () => { let u = 0; while (!u) u = rnd(); return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * rnd()); };
const t3 = () => normal() / Math.sqrt((normal() ** 2 + normal() ** 2 + normal() ** 2) / 3) / Math.sqrt(3); // heavy tails, variance 1
const KINDS = Object.keys(GROUPS);

// one kind's calls over M months: [month, company, gap]. Gap = edge + the company's lasting difference + what calls
// in the same 12 months share + the call's own luck. About 4 calls a month; a few companies are called far more often.
function kindCalls(M, edge, o = {}) {
  const { co = 0.1, period = 0.08, call = 0.3, pool = 60, bursty = false, heavy = false } = o;
  const shocks = Array.from({ length: M + 12 }, () => (normal() * period) / Math.sqrt(12));
  const cos = Array.from({ length: pool }, () => normal() * co);
  const calls = [];
  for (let m = 0; m < M; m++) {
    const shared = shocks.slice(m, m + 12).reduce((a, b) => a + b, 0);
    const k = bursty ? (rnd() < 0.25 ? 6 + Math.floor(rnd() * 25) : Math.floor(rnd() * 2)) : Math.floor(rnd() * 9);
    for (let j = 0; j < k; j++) {
      const c = Math.floor(pool * rnd() ** 2);
      calls.push([24300 + m, `C${c}`, edge + cos[c] + shared + (heavy ? t3() : normal()) * call]);
    }
  }
  return calls;
}

// the resampling approved on 3 November and replaced before going live: months in circular 12-month blocks and
// companies, 2,000 times each, the larger p-value
function rng(s) { let a = s | 0; return () => { a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
function resampledP(calls, horizon, up) {
  const ms = [...new Set(calls.map((c) => c[0]))].sort((a, b) => a - b);
  if (ms.length < 2 * horizon) return null;
  const m0 = ms[0];
  const M = ms[ms.length - 1] - m0 + 1;
  const S = new Float64Array(M);
  const N = new Float64Array(M);
  for (const [m, , g] of calls) { S[m - m0] += g; N[m - m0]++; }
  const byCo = new Map();
  for (const [, t, g] of calls) { const x = byCo.get(t) || [0, 0]; x[0] += g; x[1]++; byCo.set(t, x); }
  const cos = [...byCo.values()];
  const p = (draw, s) => { const r = rng(s); let bad = 0; let n = 0; for (let b = 0; b < 2000; b++) { const x = draw(r); if (!Number.isFinite(x)) continue; n++; if (up ? x <= 0 : x >= 0) bad++; } return (1 + bad) / (1 + n); };
  const blocks = Math.ceil(M / horizon);
  const time = p((r) => { let s = 0; let n = 0; let taken = 0; for (let b = 0; b < blocks; b++) { const st = Math.floor(r() * M); for (let j = 0; j < horizon && taken < M; j++, taken++) { s += S[(st + j) % M]; n += N[(st + j) % M]; } } return n ? s / n : NaN; }, 20261103);
  const company = p((r) => { let s = 0; let n = 0; for (let k = 0; k < cos.length; k++) { const x = cos[Math.floor(r() * cos.length)]; s += x[0]; n += x[1]; } return s / n; }, 20261104);
  return Math.max(time, company);
}

// one record of six kinds; method 'live' or 'replaced'; edges: true edge per kind (none = no skill)
function judge(M, o, method, edges = {}) {
  const groups = {};
  for (const k of KINDS) {
    const up = GROUPS[k].up;
    const calls = kindCalls(M, 0, o).map(([m, c, g]) => [m, c, (up ? 1 : -1) * (g + (edges[k] || 0))]);
    const T = gapTest(calls, { horizon: 12, up });
    const behind = Number.isFinite(T.lo) && (up ? T.hi < 0 : T.lo > 0);
    const p = method === 'live' ? T.p : resampledP(calls, 12, up);
    // wrong calls no more often than random halal stocks, so only the statistics decide
    groups[k] = { h: { '12m': { n: calls.length, matured: calls.length, wrong: 0.3, y: { ...T, p, behind, t10: 0.45, b10: 0.32 } } } };
  }
  judgeKinds(groups);
  const v = (k) => groups[k].h['12m'].verdict;
  return { pass: KINDS.filter((k) => v(k) === 'pass'), warn: KINDS.filter((k) => v(k) === 'warn') };
}

const pct = (a, b) => `${((100 * a) / b).toFixed(1)}%`;
const t0 = Date.now();
const SCEN = { base: {}, 'strong shared periods': { period: 0.15 }, 'strong companies, few': { co: 0.2, pool: 20 }, 'calls in bursts': { bursty: true }, 'heavy tails': { heavy: true }, 'all at once': { period: 0.15, co: 0.2, pool: 20, bursty: true, heavy: true } };
console.log(`No skill: how often at least one of six kinds passes by chance (limit 2.5%), ${R} records a cell`);
console.log(' '.repeat(26) + LENGTHS.map((M) => `${M} months`.padEnd(22)).join(''));
for (const [name, o] of Object.entries(SCEN)) {
  const cells = [];
  for (const M of LENGTHS) {
    let live = 0;
    let old = 0;
    for (let r = 0; r < R; r++) { if (judge(M, o, 'live').pass.length) live++; if (BOTH && judge(M, o, 'replaced').pass.length) old++; }
    cells.push(BOTH ? `live ${pct(live, R).padStart(5)} / old ${pct(old, R).padStart(5)}` : `live ${pct(live, R).padStart(5)}`.padEnd(20));
  }
  console.log(`${name.padEnd(24)}  ${cells.join('   ')}`);
}
let warnKinds = 0;
for (let r = 0; r < R; r++) warnKinds += judge(60, {}, 'live').warn.length;
console.log(`No skill, 60 months: a kind is put under review in ${pct(warnKinds, R * 6)} of kinds (a 90% interval on the bad side: about 5% expected)`);
for (const [M, e] of [[60, 0.1], [120, 0.05], [120, 0.1], [120, 0.15]]) {
  let found = 0;
  for (let r = 0; r < R; r++) if (judge(M, {}, 'live', { buy: e }).pass.includes('buy')) found++;
  console.log(`A true edge of ${e * 100} points a year in one kind over ${M} months: passes in ${pct(found, R)} of records`);
}
console.log(`(${((Date.now() - t0) / 1000).toFixed(0)} s)`);
