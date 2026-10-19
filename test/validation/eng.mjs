import { loadCompanyData } from '../../lib/data.js';
import { analyze } from '../../lib/engine.js';
import fs from 'node:fs';
const out = {};
for (const t of process.argv.slice(2)) {
  const r = analyze(await loadCompanyData(t));
  fs.writeFileSync(`${t}.v3.json`, JSON.stringify(r));
  const src = Object.fromEntries(r.sources.map((s) => [s.item, s]));
  out[t] = { history: r.history, key: r.keyNumbers, bs: r.asOf.balanceSheet, src, shares: r.shares, gaps: r.dataGaps };
}
fs.writeFileSync('engine.json', JSON.stringify(out));
for (const [t, o] of Object.entries(out)) console.log(t, o.bs, JSON.stringify(o.src['Cash and investments']), JSON.stringify(o.gaps));
