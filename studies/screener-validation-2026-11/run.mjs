// Swing scanner ranking, historical validation (rules: PREREGISTERED.md in this folder). Changes no rule.
//   node studies/screener-validation-2026-11/run.mjs <pxdir> <universe.json> [--stage dev|all] [--limit N] > signals.json
import fs from 'node:fs';
import { prepare, analyzeTechnical } from '../../lib/technical.js';
import * as SC from '../../lib/scanner.js';
import * as BT from '../../lib/backtest.js';

const [pxdir, uniFile] = process.argv.slice(2);
const LIMIT = Number((process.argv.indexOf('--limit') > 0 && process.argv[process.argv.indexOf('--limit') + 1]) || 0);
let uni = JSON.parse(fs.readFileSync(uniFile));
if (LIMIT) uni = uni.slice(0, LIMIT);
const pi=process.argv.indexOf('--part');const [PART,NPART]=pi>0?process.argv[pi+1].split('/').map(Number):[0,1];
const STEP = 20, HOLD = 20, WIN = 800, FIRST = '2016-12-02';
const iso = (ts) => new Date(ts * 1000).toISOString().slice(0, 10);
function load(t) {
  const j = JSON.parse(fs.readFileSync(`${pxdir}/${t}.json`));
  const d = [];
  for (let i = 0; i < j.t.length; i++) {
    if ([j.o[i], j.h[i], j.l[i], j.c[i], j.a[i]].some((x) => x == null || !(x > 0))) continue;
    d.push({ date: iso(j.t[i]), o: j.o[i], h: j.h[i], l: j.l[i], c: j.c[i], v: j.v[i] || 0, a: j.a[i] });
  }
  return d;
}
const spyD = load('SPY');
const M = prepare(spyD);
const regimeAt = BT.regimeFinder(M);
const dates = spyD.map((x) => x.date);
const S = [];
for (const t of uni) { try { const d = load(t); if (d.length > 400) S.push({ t, d, idx: new Map(d.map((x, i) => [x.date, i])), C: Float64Array.from(d.map((x) => x.c)) }); } catch {} }
console.error('stocks', S.length);
const start = dates.findIndex((x) => x >= FIRST);
const out = [];
let nth = -1;
for (let k = start; k + 1 + HOLD < dates.length; k += STEP) {
  nth++; if (nth % NPART !== PART) continue;
  const date = dates[k], entryDate = dates[k + 1], exitDate = dates[k + 1 + HOLD];
  const regime = regimeAt(date);
  // universe returns and RS populations
  const rsNow = [], rsBack = [], cur = [];
  for (const s of S) {
    const i = s.idx.get(date), e = s.idx.get(entryDate), x = s.idx.get(exitDate);
    if (i == null) continue;
    const c = s.C.subarray(0, i + 1);
    rsNow.push({ c }); rsBack.push({ c });
    let gross = null;
    if (e != null && x != null) { const eo = s.d[e].o * (s.d[e].a / s.d[e].c); gross = s.d[x].a / eo - 1; }
    cur.push({ s, i, c, gross });
  }
  const rkNow = SC.rankerBack(rsNow, 0, BT.rsWeighted), rkBack = SC.rankerBack(rsBack, SC.SCAN_RULES.rsLookback, BT.rsWeighted);
  const grosses = cur.map((x) => x.gross).filter((g) => g != null);
  if (!rkNow || grosses.length < 100) continue;
  const mkt = grosses.reduce((a, b) => a + b, 0) / grosses.length;
  const listed = [];
  for (const x of cur) {
    if (x.gross == null) continue;
    const { s, i } = x;
    const hist = s.d.slice(Math.max(0, i - WIN + 1), i + 1);
    if (hist.length < 300) continue;
    let P, tech;
    try { P = prepare(hist); tech = P && analyzeTechnical(P); } catch { continue; }
    if (!tech || !tech.ok) continue;
    const j = i, wN = BT.rsWeighted(s.C, j);
    const rs = j >= 252 ? rkNow(wN) : null;
    const rsPrev = j - SC.SCAN_RULES.rsLookback >= 252 && rkBack ? rkBack(BT.rsWeighted(s.C, j - SC.SCAN_RULES.rsLookback)) : null;
    let r;
    try {
      const wk = SC.weeklyAnalysis(hist);
      r = SC.scanStock({ ticker: s.t, name: s.t, sector: '', capM: 0, tech, feats: SC.features(P), wk: wk ? { ...wk, chart: undefined } : null, shariah: 'pass', dq: 'high', rs, rsPrev, earn: null, earnDays: null, earningsCal: 'ok', regime, priceDate: tech.asOf, bars: P.n });
    } catch { continue; }
    if (r.listed) listed.push({ t: s.t, score: r.listed.score, metN: r.listed.metN, setup: r.listed.setup, status: r.listed.status, gross: x.gross });
  }
  out.push({ date, regime, mkt, nUniverse: grosses.length, listed: SC.rankCandidates(listed.map((l) => ({ ...l, ticker: l.t }))).map(({ ticker, ...l }) => l) });
  console.error(date, regime, 'universe', grosses.length, 'listed', listed.length);
}
console.log(JSON.stringify(out));
