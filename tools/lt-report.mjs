// Long-term backtest, step 2 (see lib/ltstats.js): reads the replayed analyses from step 1 and writes the summary the
// site shows (lt-summary.json), plus a readable report on the console.
//   node tools/lt-report.mjs [lt-data.ndjson] [lt-summary.json] [--runs 50]
import fs from 'node:fs';
import { loadData, report } from '../lib/ltstats.js';

const args = process.argv.slice(2).filter((a) => !a.startsWith('--'));
const runsAt = process.argv.indexOf('--runs');
const runs = runsAt > 0 ? Number(process.argv[runsAt + 1]) : 50;
const IN = args[0] || 'lt-data.ndjson';
const OUT = args[1] || 'lt-summary.json';
const D = loadData(fs.readFileSync(IN, 'utf8').split('\n'));
const t0 = Date.now();
const R = report(D, { randomRuns: runs });
R.generated = new Date().toISOString();
fs.writeFileSync(OUT, JSON.stringify(R));
const pc = (x) => (typeof x === 'number' ? (x * 100).toFixed(1) + '%' : 'n/a');
const line = (name, f) => `  ${name.padEnd(12)} ${pc(f.picks)} picks | ${pc(f.universe)} avg halal stock | ${pc(f.spy)} SPY | vs SPY ${pc(f.vsSpy.mean)} (t ${f.vsSpy.t}) | vs avg ${pc(f.vsUniverse.mean)} (t ${f.vsUniverse.t}) | ${f.monthsWithPicks} months, ${f.avgPicks} picks/month`;
console.log(`${R.companies} companies, ${R.from} to ${R.to} (${((Date.now() - t0) / 1000).toFixed(1)}s)`);
console.log('Forward returns of the shortlist (bought the session after each month-end):');
for (const h of ['h12', 'h24', 'h36']) console.log(line(h, R.forward[h]));
console.log('12-month variants:');
for (const [k, f] of Object.entries(R.variants)) console.log(line(k, f));
console.log('By year (12 months ahead): ' + R.forward.h12.byYear.map((y) => `${y.year} ${pc(y.picks)}/${pc(y.universe)}/${pc(y.spy)}`).join('  '));
for (const [name, p] of Object.entries(R.portfolio)) {
  console.log(`Portfolio ${name} ${p.from} to ${p.to}, ${R.monthly}/month:`);
  for (const k of ['shortlist', 'shortlistWait', 'shortlistNever', 'shortlistHighData', 'spy']) {
    const s = p[k];
    console.log(`  ${k.padEnd(18)} yearly ${pc(s.yearly)}  value ${s.finalValue} of ${s.deposited} deposited  worst fall ${pc(s.worstFall)}${s.buys != null ? `  buys ${s.buys} sells ${s.sells} (business ${s.sellsBusiness}, trims ${s.sellsTrim}) idle ${s.idleMonths} fees ${s.fees} positions ${s.positions}` : ''}`);
  }
  console.log(`  random (${p.random.runs} runs) yearly p10 ${pc(p.random.yearly.p10)} median ${pc(p.random.yearly.median)} p90 ${pc(p.random.yearly.p90)}`);
}
console.log(`The list's 12-month test by half (month-ends before ${R.middle}, and from it):`);
for (const [k, f] of Object.entries(R.forwardHalves)) console.log(`  ${k}: ${pc(f.picks)} picks | ${pc(f.universe)} avg | vs avg ${pc(f.vsUniverse.mean)} (t ${f.vsUniverse.t}) | ${f.months} months`);
console.log('Other ways to build the list (PREREGISTERED.md):');
for (const [k, a] of Object.entries(R.alternatives)) {
  const f = a.forward;
  console.log(`  ${k.padEnd(16)} vs avg ${pc(f.h12.vsUniverse.mean)} (t ${f.h12.vsUniverse.t}), halves ${pc(f.half1.vsUniverse.mean)} / ${pc(f.half2.vsUniverse.mean)}, ${f.h12.avgPicks} picks/month | portfolio ${pc(a.portfolio.full.yearly)} (halves ${pc(a.portfolio.half1.yearly)} / ${pc(a.portfolio.half2.yearly)}, fund ${pc(a.portfolio.full.fundShare)}) | checks ${JSON.stringify(a.checks)} -> ${a.pass ? 'PASS' : 'fail'}`);
}
console.log('Passed:', R.alternativePassed);
console.log('The list by rule 1:', JSON.stringify(R.listDecision));
console.log('The Portfolio page picks (PREREGISTERED.md, section 3):');
for (const [k, p] of Object.entries(R.plan)) {
  const f = p.forward;
  console.log(`  ${k}: 6 ideas a month vs avg ${pc(f.h12.vsUniverse.mean)} (t ${f.h12.vsUniverse.t}), halves ${pc(f.half1.vsUniverse.mean)} / ${pc(f.half2.vsUniverse.mean)}; ideas ${pc(f.h12.picks)} vs avg ${pc(f.h12.universe)} vs SPY ${pc(f.h12.spy)}`);
  for (const per of ['full', 'half1', 'half2']) {
    const x = p.portfolio[per];
    console.log(`    ${per} ${x.from}..${x.to}: plan ${pc(x.shortlist.yearly)} (value ${x.shortlist.finalValue} of ${x.shortlist.deposited}, worst ${pc(x.shortlist.worstFall)}, fund ${pc(x.shortlist.fundShare)}) | random median ${pc(x.random.yearly.median)} (p10 ${pc(x.random.yearly.p10)}, p90 ${pc(x.random.yearly.p90)}) | SPY ${pc(x.spy.yearly)}`);
  }
  console.log(`    rule 1: ${JSON.stringify(p.decision)}`);
}
console.log('What the rules say on this run:', JSON.stringify(R.review), '| pools with money:', JSON.stringify(R.pools));
console.log('Decision:', JSON.stringify(R.decision));
