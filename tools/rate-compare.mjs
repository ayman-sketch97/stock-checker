// Compares the fixed discount rates (A) with the Treasury-linked rule (B) and the sensitivity rules (S1 to S6), as
// PREREGISTERED.md, section 8 sets out, from the shards written by tools/rate-study.mjs.
// Usage: node tools/rate-compare.mjs out/shard-0.ndjson ... --out results
import fs from 'node:fs';
import path from 'node:path';
import { loadData, simulatePlan, simulatePlanRandom, simulateSpy, WINDOW_MONTHS } from '../lib/ltstats.js';
import { SNAP_FIELDS } from '../lib/longterm.js';
import { loadYields, EXTREME_YIELDS, FLOOR, CAP, TIER_RF } from '../lib/rates.js';

const args = process.argv.slice(2);
const outDir = args.includes('--out') ? args[args.indexOf('--out') + 1] : 'results';
const yieldsFile = args.includes('--yields') ? args[args.indexOf('--yields') + 1] : 'study/gs10.csv';
const runs = args.includes('--runs') ? Number(args[args.indexOf('--runs') + 1]) : 50;
const files = args.filter((a, i) => !a.startsWith('--') && !['--out', '--yields', '--runs'].includes(args[i - 1]));
export const VARIANTS = ['A', 'B', 'S1', 'S2', 'S3', 'S4', 'S5', 'S6'];
// the five-year periods section 8 names start from December 2016 to October 2021, in two halves split after April
// 2019; the halves of the decade itself split at December 2021, as in the 10-year test (lib/ltstats.js, report)
export const LAST_START = '2021-10';
export const HALF_START = '2019-04';
export const MID_MONTH = '2021-12';
const F = Object.fromEntries(SNAP_FIELDS.map((k, i) => [k, i]));
const isNum = (x) => typeof x === 'number' && Number.isFinite(x);
const r4 = (x) => (Number.isFinite(x) ? Math.round(x * 1e4) / 1e4 : null);
const q = (xs, p) => { if (!xs.length) return null; const s = [...xs].sort((a, b) => a - b); return s[Math.min(s.length - 1, Math.max(0, Math.round(p * (s.length - 1))))]; };

// buy, trim, sell or hold, as the record reads a company (lib/records.js, stateOf), plus the weakened-business sell
export function stateOfRow(r) {
  if (!r) return null;
  const v = r[F.verdict];
  const px = r[F.price];
  if (v === 'AVOID_WEAK' || v === 'SPECULATIVE') return 'sell';
  if (Number.isFinite(r[F.trimAbove]) && px >= r[F.trimAbove]) return 'trim';
  if ((v === 'BUY_STRONG' || v === 'BUY') && r[F.shariah] === 'pass' && Number.isFinite(r[F.buyBelow]) && px <= r[F.buyBelow]) return 'buy';
  return 'hold';
}
// the kind of business behind the fixed rate (lib/engine.js): strong 8%, typical 9%, weaker or small 10%
export function tierOfRow(r) {
  const qy = r[F.quality];
  const hl = r[F.health];
  const cap = r[F.cap];
  if (qy < 50 || hl < 40 || (Number.isFinite(cap) && cap < 2000)) return 0.1;
  if (qy >= 70 && hl >= 70 && cap > 10000) return 0.08;
  return 0.09;
}

// one company line per variant, in the 10-year data's own format, so the same simulation runs on each
export function splitLines(lines) {
  const by = Object.fromEntries(VARIANTS.map((v) => [v, []]));
  const comps = [];
  for (const line of lines) {
    if (!line.trim()) continue;
    const o = JSON.parse(line);
    if (o.t === '$SPY' || o.skip) { for (const v of VARIANTS) by[v].push(line); continue; }
    comps.push(o);
    for (const v of VARIANTS) by[v].push(JSON.stringify({ t: o.t, sector: o.sector, sic: o.sic, rows: v === 'A' ? o.rows : (o.by && o.by[v]) || [], px: o.px }));
  }
  return { by, comps };
}

// valuations and decisions of one variant against A, month by month
export function compareRows(comps, v, Y) {
  const ratios = [];
  const byYear = {};
  const T = {};
  const halves = { first: {}, second: {} };
  const moves = { A: [], V: [] };
  const buyChurn = { A: 0, V: 0 };
  const changes = { A: 0, V: 0 };
  let compYears = 0;
  const flips = [];
  // for context: every month-to-month step, the steps with a small yield move, and the variant's decision changing
  // while A's stays (in all steps, and in the small-move steps)
  const steps = { all: 0, small: 0, variantOnly: 0, variantOnlySmall: 0 };
  for (const o of comps) {
    const A = new Map(o.rows.map((r) => [r[F.date], r]));
    const Vr = new Map(((o.by && o.by[v]) || []).map((r) => [r[F.date], r]));
    const dates = [...A.keys()].filter((d) => Vr.has(d)).sort();
    compYears += dates.length / 12;
    let pa = null;
    let pv = null;
    for (const d of dates) {
      const a = A.get(d);
      const b = Vr.get(d);
      if (a[F.fair] > 0 && b[F.fair] > 0) {
        const x = b[F.fair] / a[F.fair];
        ratios.push(x);
        (byYear[d.slice(0, 4)] ||= []).push(x);
      }
      const sa = stateOfRow(a);
      const sb = stateOfRow(b);
      const key = `${sa}>${sb}`;
      T[key] = (T[key] || 0) + 1;
      const half = d < MID_MONTH ? halves.first : halves.second;
      half[key] = (half[key] || 0) + 1;
      if (pa && pv) {
        if (pa[F.fair] > 0 && a[F.fair] > 0) moves.A.push(Math.abs(a[F.fair] / pa[F.fair] - 1));
        if (pv[F.fair] > 0 && b[F.fair] > 0) moves.V.push(Math.abs(b[F.fair] / pv[F.fair] - 1));
        const ba = stateOfRow(pa) === 'buy';
        const bb = stateOfRow(pv) === 'buy';
        if (ba !== (sa === 'buy')) buyChurn.A++;
        if (bb !== (sb === 'buy')) buyChurn.V++;
        if (stateOfRow(pa) !== sa) changes.A++;
        if (stateOfRow(pv) !== sb) changes.V++;
        // a small move in the yield (a quarter point or less) that flips the variant's decision while A's stays put
        const ym = (s) => s.slice(0, 7);
        const prev = (s) => { const [y, m] = s.split('-').map(Number); return m === 1 ? `${y - 1}-12` : `${y}-${String(m - 1).padStart(2, '0')}`; };
        const y1 = Y.get(prev(ym(d)));
        const y0 = Y.get(prev(prev(ym(d))));
        const small = Number.isFinite(y1) && Number.isFinite(y0) && Math.abs(y1 - y0) <= 0.0025;
        const variantOnly = stateOfRow(pv) !== sb && stateOfRow(pa) === sa;
        steps.all++;
        if (small) steps.small++;
        if (variantOnly) steps.variantOnly++;
        if (small && variantOnly) { steps.variantOnlySmall++; flips.push({ t: o.t, d, from: stateOfRow(pv), to: sb, yieldMove: r4(y1 - y0) }); }
      }
      pa = a;
      pv = b;
    }
  }
  const stat = (xs) => ({ n: xs.length, p25: r4(q(xs, 0.25)), median: r4(q(xs, 0.5)), p75: r4(q(xs, 0.75)) });
  return {
    fairRatio: stat(ratios),
    fairRatioByYear: Object.fromEntries(Object.entries(byYear).map(([y, xs]) => [y, r4(q(xs, 0.5))])),
    decisions: T,
    decisionsByHalf: halves,
    I1: { A: { median: r4(q(moves.A, 0.5)), p95: r4(q(moves.A, 0.95)) }, V: { median: r4(q(moves.V, 0.5)), p95: r4(q(moves.V, 0.95)) } },
    I2: { A: r4(buyChurn.A / compYears), V: r4(buyChurn.V / compYears) },
    decisionChangesPerYear: { A: r4(changes.A / compYears), V: r4(changes.V / compYears) },
    // the share of steps in which only the variant's decision changed: if it is no higher when the yield barely
    // moved, the changes come from prices meeting a different line, not from the yield
    smallMoveFlips: {
      n: flips.length, steps: steps.all, smallMoveSteps: steps.small,
      shareWhenSmallMove: steps.small ? r4(steps.variantOnlySmall / steps.small) : null,
      shareAllSteps: steps.all ? r4(steps.variantOnly / steps.all) : null,
      examples: flips.slice(0, 12),
    },
  };
}

// the plan on the five-year periods, the whole path and each half of the decade, for one variant's data. Only the
// periods section 8 names (starting up to LAST_START) are run; a period without a number is left out, as in the
// 10-year test (lib/ltstats.js, planWindows)
export function planResults(D, first, last, mid, rnd = runs) {
  const brief = (p) => ({ yearly: p.yearly, finalValue: p.finalValue, worstFall: p.worstFall });
  const full = brief(simulatePlan(D, { from: first, to: last, pool: 'long' }));
  const halves = mid > first && mid < last
    ? { h1: brief(simulatePlan(D, { from: first, to: mid, pool: 'long' })), h2: brief(simulatePlan(D, { from: mid, to: last, pool: 'long' })) }
    : null;
  const W = [];
  for (let s = first; s + WINDOW_MONTHS <= last && D.months[s] <= LAST_START; s++) {
    const e = s + WINDOW_MONTHS;
    const p = simulatePlan(D, { from: s, to: e, pool: 'long' });
    const r = rnd ? simulatePlanRandom(D, { from: s, to: e, pool: 'long' }, rnd).yearly.median : null;
    const spy = simulateSpy(D, { from: s, to: e }).yearly;
    if (isNum(p.yearly) && isNum(spy) && (!rnd || isNum(r))) W.push({ from: D.months[s], value: p.finalValue, yearly: p.yearly, worstFall: p.worstFall, rnd: r, spy });
  }
  return { full, halves, windows: W };
}

// the six conditions of section 8 for one variant against A. Condition 3 on the whole decade is the plan's worst
// fall on the 10-year path; within each half of the starting months (condition 4) it is the deepest fall of any
// period starting in that half
export function conditions(PA, PV) {
  const halfOf = (w) => (w.from <= HALF_START ? 'h1' : 'h2');
  const ge = (x, y) => isNum(x) && isNum(y) && x >= y;
  const res = {};
  for (const part of ['all', 'h1', 'h2']) {
    const pick = (P) => P.windows.filter((w) => w.from <= LAST_START && (part === 'all' || halfOf(w) === part));
    const v = pick(PV);
    const aBy = new Map(pick(PA).map((w) => [w.from, w]));
    const a = v.map((w) => aBy.get(w.from)).filter(Boolean); // the same starting months only
    let wins = 0;
    let losses = 0;
    for (const w of v) { const x = aBy.get(w.from); if (x && w.value > x.value) wins++; else if (x && w.value < x.value) losses++; }
    const share = (P, f) => (P.length ? r4(P.filter(f).length / P.length) : null);
    const deepest = (P) => (P.length ? Math.min(...P.map((w) => w.worstFall)) : null);
    res[part] = {
      n: v.length, wins, losses,
      c1: wins > losses,
      beatRandom: { A: share(a, (w) => w.yearly > w.rnd), V: share(v, (w) => w.yearly > w.rnd) },
      beatSpy: { A: share(a, (w) => w.yearly > w.spy), V: share(v, (w) => w.yearly > w.spy) },
      worstFall: { A: deepest(a), V: deepest(v) },
    };
    res[part].c2 = ge(res[part].beatRandom.V, res[part].beatRandom.A) && ge(res[part].beatSpy.V, res[part].beatSpy.A);
    res[part].c3 = ge(res[part].worstFall.V, res[part].worstFall.A - 0.02);
  }
  const worst = { A: PA.full.worstFall, V: PV.full.worstFall };
  const c3 = ge(worst.V, worst.A - 0.02); // falls are negative: no more than 2 points deeper
  return { ...res, worstFall: worst, c3, c4: ['h1', 'h2'].every((h) => res[h].c1 && res[h].c2 && res[h].c3) };
}

// the extreme yields on today's companies: valuations against A, the buy zone, and the floor and cap
export function extremes(comps) {
  const out = {};
  const ratioAt = {};
  const statesAt = {};
  for (const y of EXTREME_YIELDS) {
    const k = `y${(y * 100).toFixed(2)}`;
    const xs = [];
    let buy = 0;
    let halal = 0;
    let floor = 0;
    let cap = 0;
    for (const o of comps) {
      const a = o.rows[o.rows.length - 1];
      const e = o.last && o.last[k];
      if (!a || !e) continue;
      if (a[F.fair] > 0 && e[F.fair] > 0) xs.push(e[F.fair] / a[F.fair]);
      if (e[F.shariah] === 'pass') { halal++; if (stateOfRow(e) === 'buy') buy++; }
      const rate = tierOfRow(e) + y - TIER_RF;
      if (rate <= FLOOR) floor++;
      if (rate >= CAP) cap++;
      (statesAt[o.t] ||= {})[k] = stateOfRow(e);
    }
    ratioAt[k] = q(xs, 0.5);
    out[k] = { yield: y, companies: xs.length, medianFairVsA: r4(q(xs, 0.5)), buyShareOfHalal: halal ? r4(buy / halal) : null, atFloor: floor, atCap: cap };
  }
  // the stability check: a one-point move between 2% and 8% may not move the median fair value by more than 50%
  const grid = [0.02, 0.03, 0.04, 0.05, 0.06, 0.07, 0.08].map((y) => `y${(y * 100).toFixed(2)}`);
  const steps = [];
  for (let k = 1; k < grid.length; k++) {
    const a = ratioAt[grid[k - 1]];
    const b = ratioAt[grid[k]];
    steps.push({ from: grid[k - 1], to: grid[k], change: a && b ? r4(b / a - 1) : null });
  }
  const unstable = steps.filter((s) => s.change !== null && Math.abs(s.change) > 0.5);
  // companies whose decision changes more than once across the one-point grid (not one clean switch)
  const zigzag = [];
  for (const [t, st] of Object.entries(statesAt)) {
    const seq = grid.map((k) => st[k]).filter(Boolean);
    let changes = 0;
    for (let k = 1; k < seq.length; k++) if (seq[k] !== seq[k - 1]) changes++;
    if (changes > 1) zigzag.push({ t, seq });
  }
  // I3: the change in fair value for one more point of discount rate, by kind of business
  const I3 = {};
  for (const o of comps) {
    const a = o.rows[o.rows.length - 1];
    const e = o.last && o.last.Aplus1;
    if (!a || !e || !(a[F.fair] > 0) || !(e[F.fair] > 0)) continue;
    (I3[tierOfRow(a)] ||= []).push(e[F.fair] / a[F.fair] - 1);
  }
  // a quarter point either side of today's yield (5.13%): the companies whose decision under B would change
  const near = [];
  let nearN = 0;
  for (const o of comps) {
    const L = o.last || {};
    const m = L['y5.13'];
    if (!m) continue;
    nearN++;
    const s0 = stateOfRow(m);
    const lo = L['y4.88'] ? stateOfRow(L['y4.88']) : null;
    const hi = L['y5.38'] ? stateOfRow(L['y5.38']) : null;
    if ((lo && lo !== s0) || (hi && hi !== s0)) near.push({ t: o.t, at488: lo, at513: s0, at538: hi, halal: m[F.shariah] });
  }
  const nearToday = { companies: nearN, changed: near.length, changedHalalPass: near.filter((r) => r.halal === 'pass').length, examples: near.slice(0, 20) };
  return { scenarios: out, steps, c5extreme: unstable.length === 0, unstable, zigzag: { n: zigzag.length, examples: zigzag.slice(0, 12) }, nearToday, I3: Object.fromEntries(Object.entries(I3).map(([k, xs]) => [k, { n: xs.length, median: r4(q(xs, 0.5)) }])) };
}

// the latest month: today's valuations side by side, and the largest changes
export function latest(comps, v) {
  const rows = [];
  for (const o of comps) {
    const a = o.rows[o.rows.length - 1];
    const b = ((o.by && o.by[v]) || []).find((r) => a && r[F.date] === a[F.date]);
    if (!a || !b || !(a[F.fair] > 0) || !(b[F.fair] > 0)) continue;
    rows.push({ t: o.t, date: a[F.date], price: a[F.price], fairA: a[F.fair], fairB: b[F.fair], change: r4(b[F.fair] / a[F.fair] - 1), stateA: stateOfRow(a), stateB: stateOfRow(b), halal: a[F.shariah] });
  }
  rows.sort((x, y) => Math.abs(y.change) - Math.abs(x.change));
  const changed = rows.filter((r) => r.stateA !== r.stateB);
  return { companies: rows.length, decisionChanges: changed.length, largest: rows.slice(0, 15), changedHalal: changed.filter((r) => r.halal === 'pass').slice(0, 25) };
}

async function main() {
  const lines = files.flatMap((f) => fs.readFileSync(f, 'utf8').split('\n'));
  const { by, comps } = splitLines(lines);
  const Y = loadYields(fs.readFileSync(yieldsFile, 'utf8'));
  const D = Object.fromEntries(VARIANTS.map((v) => [v, loadData(by[v])]));
  const months = D.A.months;
  // the same start and middle as the 10-year test (lib/ltstats.js, report)
  const first = months.findIndex((m, k) => D.A.comps.filter((c) => c.snap[k]).length >= Math.max(20, D.A.comps.length * 0.3));
  if (first < 0) throw new Error('too few companies with valuations to start the plan');
  const last = months.length - 1;
  const mid = months.findIndex((m) => m >= MID_MONTH) >= 0 ? months.findIndex((m) => m >= MID_MONTH) : Math.floor((first + last) / 2);
  const P = {};
  for (const v of VARIANTS) { P[v] = planResults(D[v], first, last, mid); console.log(`${v}: plan ${P[v].full.yearly} a year, worst fall ${P[v].full.worstFall}, ${P[v].windows.length} periods`); }
  const report = { generated: new Date().toISOString(), companies: comps.length, from: months[first], to: months[last], mid: months[mid], runs, variants: {} };
  for (const v of VARIANTS.slice(1)) report.variants[v] = { plan: P[v].full, halves: P[v].halves, conditions: conditions(P.A, P[v]), rows: compareRows(comps, v, Y), latest: latest(comps, v) };
  report.A = { plan: P.A.full, halves: P.A.halves };
  report.extremes = extremes(comps);
  const B = report.variants.B;
  const stable = B.rows.I2.V <= 1.25 * B.rows.I2.A && B.rows.I1.V.p95 <= 1.5 * B.rows.I1.A.p95;
  const sens = ['S1', 'S2', 'S3', 'S4'].filter((s) => report.variants[s].conditions.all.c1 && report.variants[s].conditions.c3);
  report.decision = {
    c1: B.conditions.all.c1, c2: B.conditions.all.c2, c3: B.conditions.c3, c4: B.conditions.c4,
    c5: report.extremes.c5extreme && stable, stability: { I1: B.rows.I1, I2: B.rows.I2 },
    c6: sens.length >= 3, sensitivityPassing: sens,
  };
  report.decision.allPass = ['c1', 'c2', 'c3', 'c4', 'c5', 'c6'].every((k) => report.decision[k]);
  fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(path.join(outDir, 'report.json'), JSON.stringify(report, null, 1));
  for (const v of VARIANTS) fs.writeFileSync(path.join(outDir, `windows-${v}.json`), JSON.stringify(P[v].windows));
  console.log('decision', JSON.stringify(report.decision));
}
if (import.meta.url === `file://${process.argv[1]}`) await main();
