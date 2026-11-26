import fs from 'node:fs';
import { prepare, analyzeTechnical } from '../../lib/technical.js';
const dir = (process.argv[2] || 'data/tech') + '/';
const FWD = 20;
const rowsAll = [];
for (const f of fs.readdirSync(dir)) {
  let d; try { d = JSON.parse(fs.readFileSync(dir + f)); } catch { continue; }
  const c = d.chart && d.chart.candles; if (!c || c.length < 255) continue;
  const daily = c.map((x) => ({ date: x[0], o: x[1], h: x[2], l: x[3], c: x[4], v: x[5] }));
  const n = daily.length;
  for (let k = 200; k + FWD < n; k += 4) {
    const P = prepare(daily.slice(0, k + 1)); if (!P) continue;
    const T = analyzeTechnical(P); if (!T || !T.ok) continue;
    const fwd = daily[k + FWD].c / daily[k].c - 1;
    const s = T.setup || {};
    let out = null;
    if (s.entry > 0 && s.stop > 0 && s.target1 > s.entry && s.entry > s.stop) {
      let entered = false; out = 'none';
      for (let j = k + 1; j <= k + FWD; j++) {
        const b = daily[j];
        if (!entered) { if (b.h >= s.entry && b.l <= s.entry * 1.0 + 1e9) entered = true; else continue; }
        if (b.l <= s.stop) { out = 'stop'; break; }
        if (b.h >= s.target1) { out = 'target'; break; }
        out = 'open';
      }
    }
    rowsAll.push({ t: f.replace('.json', ''), k, date: daily[k].date, fwd, setup: s.setup, status: s.status, score: T.score, out });
  }
}
const byDate = {}; for (const r of rowsAll) (byDate[r.date] ||= []).push(r.fwd);
const mean = (a) => a.reduce((x, y) => x + y, 0) / (a.length || 1);
const med = (a) => { const b = [...a].sort((x, y) => x - y); return b.length ? b[Math.floor(b.length / 2)] : null; };
for (const d of Object.keys(byDate)) byDate[d] = byDate[d].reduce((x, y) => x + y, 0) / byDate[d].length;
for (const r of rowsAll) r.ex = r.fwd - byDate[r.date];
const pct = (x) => (x == null ? 'n/a' : (x * 100).toFixed(2) + '%');
const out = { stocks: new Set(rowsAll.map((r) => r.t)).size, obs: rowsAll.length, dates: [...new Set(rowsAll.map((r) => r.date))].length };
out.all = { n: rowsAll.length, mean: pct(mean(rowsAll.map((r) => r.fwd))), median: pct(med(rowsAll.map((r) => r.fwd))), up: pct(rowsAll.filter((r) => r.fwd > 0).length / rowsAll.length) };
out.bySetup = {}; out.excessBySetup = {};
for (const st of ['pullback','breakout','reversal','range']) { const a = rowsAll.filter((r) => r.setup === st); out.excessBySetup[st] = { n: a.length, meanExcessVsSameDay: pct(mean(a.map((r) => r.ex))), datesWithSetup: new Set(a.map((r)=>r.date)).size }; }
out.datesMeanFwd = Object.fromEntries(Object.entries(byDate).map(([d,v]) => [d, pct(v)]));
for (const st of ['pullback', 'breakout', 'reversal', 'momentum', 'range', null]) {
  const a = rowsAll.filter((r) => (r.setup || null) === st);
  if (!a.length) continue;
  const act = a.filter((r) => r.status === 'active');
  const fm = (x) => ({ n: x.length, mean: pct(mean(x.map((r) => r.fwd))), median: pct(med(x.map((r) => r.fwd))), up: pct(x.filter((r) => r.fwd > 0).length / (x.length || 1)) });
  const tr = a.filter((r) => r.out === 'stop' || r.out === 'target');
  out.bySetup[st || 'none'] = { all: fm(a), active: act.length ? fm(act) : null, resolved: tr.length, targetFirst: pct(tr.filter((r) => r.out === 'target').length / (tr.length || 1)) };
}
// rank correlation of score with forward return, among rows that have a setup
function spearman(a) {
  const rk = (v) => { const idx = v.map((x, i) => [x, i]).sort((p, q) => p[0] - q[0]); const r = Array(v.length); idx.forEach(([, i], j) => (r[i] = j)); return r; };
  const x = rk(a.map((r) => r.score)), y = rk(a.map((r) => r.ex)); const mx = mean(x), my = mean(y);
  let sxy = 0, sxx = 0, syy = 0; for (let i = 0; i < x.length; i++) { sxy += (x[i] - mx) * (y[i] - my); sxx += (x[i] - mx) ** 2; syy += (y[i] - my) ** 2; }
  return sxy / Math.sqrt(sxx * syy);
}
const withSetup = rowsAll.filter((r) => r.setup && r.setup !== 'range' && Number.isFinite(r.score));
out.scoreVsFwd = { n: withSetup.length, spearman: withSetup.length > 10 ? +spearman(withSetup).toFixed(3) : null, allRows: +spearman(rowsAll.filter((r) => Number.isFinite(r.score))).toFixed(3) };
const q = [...withSetup].sort((a, b) => a.score - b.score); const h = Math.floor(q.length / 2);
out.scoreHalves = { lowHalfMean: pct(mean(q.slice(0, h).map((r) => r.fwd))), highHalfMean: pct(mean(q.slice(h).map((r) => r.fwd))) };
console.log(JSON.stringify(out, null, 1));
