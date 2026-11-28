// Accounting red-flag screen. Education only: it shows how a company's reported numbers compare with its own history and with its
// peers in the same run. It never says a company is cheating and never changes a score, a limit or a Shariah result.
// Input: SEC companyfacts ("facts" object, see data.js getCompanyFacts). Output: plain numbers, or null when a figure is not reported.
export const REDFLAGS_VERSION = 1;
const DAY = 86400000;
const TAGS = {
  netIncome: ['NetIncomeLoss', 'ProfitLoss'],
  cfo: ['NetCashProvidedByUsedInOperatingActivities', 'NetCashProvidedByUsedInOperatingActivitiesContinuingOperations'],
  revenue: ['Revenues', 'RevenueFromContractWithCustomerExcludingAssessedTax', 'SalesRevenueNet', 'RevenueFromContractWithCustomerIncludingAssessedTax'],
  receivables: ['AccountsReceivableNetCurrent', 'ReceivablesNetCurrent', 'AccountsReceivableNet'],
  assets: ['Assets'],
};
const num = (x) => (typeof x === 'number' && Number.isFinite(x) ? x : null);

// one value per fiscal year end, from 10-K filings only, latest filing wins. Flows must span about a year.
function annual(facts, names, flow) {
  const gaap = (facts && facts['us-gaap']) || {};
  let best = new Map();
  for (const name of names) {
    const rows = gaap[name]?.units?.USD;
    if (!Array.isArray(rows)) continue;
    const byEnd = new Map();
    for (const r of rows) {
      if (!r || r.form !== '10-K' || !r.end || num(r.val) === null) continue;
      if (flow) {
        if (!r.start) continue;
        const span = (Date.parse(r.end) - Date.parse(r.start)) / DAY;
        if (!(span >= 340 && span <= 390)) continue;
      }
      const old = byEnd.get(r.end);
      if (!old || String(r.filed || '') > String(old.filed || '')) byEnd.set(r.end, r);
    }
    // the tag that is used for the most recent year wins, so an old tag that was dropped years ago never hides the current one
    const out = new Map([...byEnd.entries()].map(([e, r]) => [e, r.val]));
    const newest = (m) => [...m.keys()].sort().pop() || '';
    if (out.size && (!best.size || newest(out) > newest(best))) best = out;
  }
  return best;
}

// Benford first-digit spread over every annual 10-K value in the file. Footnote only: many honest companies differ from it.
export function benfordSpread(facts) {
  const gaap = (facts && facts['us-gaap']) || {};
  const counts = Array(10).fill(0);
  let n = 0;
  for (const k of Object.keys(gaap)) {
    const rows = gaap[k]?.units?.USD;
    if (!Array.isArray(rows)) continue;
    const seen = new Set();
    for (const r of rows) {
      if (!r || r.form !== '10-K' || num(r.val) === null) continue;
      const v = Math.abs(r.val);
      if (v < 10) continue;
      const key = r.end + '|' + r.start + '|' + v;
      if (seen.has(key)) continue;
      seen.add(key);
      const d = Number(String(v).replace(/^0\.0*/, '')[0]);
      if (d >= 1 && d <= 9) { counts[d]++; n++; }
    }
  }
  if (n < 300) return { n, mad: null };
  let mad = 0;
  for (let d = 1; d <= 9; d++) mad += Math.abs(counts[d] / n - Math.log10(1 + 1 / d));
  return { n, mad: mad / 9 };
}

export function redflagMetrics(facts) {
  const ni = annual(facts, TAGS.netIncome, true);
  const cfo = annual(facts, TAGS.cfo, true);
  const rev = annual(facts, TAGS.revenue, true);
  const rec = annual(facts, TAGS.receivables, false);
  const assets = annual(facts, TAGS.assets, false);
  const ends = [...ni.keys()].filter((e) => cfo.has(e)).sort();
  if (!ends.length) return { ok: false, reason: 'No annual net income and operating cash flow in the SEC filings.' };
  const years = ends.slice(-3);
  const last = years[years.length - 1];
  const prevOf = (m, e) => {
    const t = Date.parse(e);
    return [...m.keys()].filter((k) => { const d = (t - Date.parse(k)) / DAY; return d > 330 && d < 400; }).map((k) => m.get(k))[0] ?? null;
  };
  // 1. cash conversion: operating cash flow divided by net income (only meaningful when profit is positive)
  const sumNi = years.reduce((s, e) => s + ni.get(e), 0);
  const sumCfo = years.reduce((s, e) => s + cfo.get(e), 0);
  const conv = sumNi > 0 ? sumCfo / sumNi : null;
  // 2. accruals ratio: (net income - operating cash flow) / average total assets
  const a1 = assets.get(last);
  const a0 = prevOf(assets, last);
  const avgA = a1 != null && a0 != null ? (a1 + a0) / 2 : a1 ?? null;
  const accruals = avgA ? (ni.get(last) - cfo.get(last)) / avgA : null;
  // 3. receivables growth minus sales growth, in percentage points
  const r1 = rec.get(last), r0 = prevOf(rec, last), v1 = rev.get(last), v0 = prevOf(rev, last);
  let recGap = null, recGrowth = null, revGrowth = null;
  if (r1 != null && r0 > 0 && v1 != null && v0 > 0) {
    recGrowth = r1 / r0 - 1;
    revGrowth = v1 / v0 - 1;
    recGap = (recGrowth - revGrowth) * 100;
  }
  return { ok: true, v: REDFLAGS_VERSION, fyEnd: last, years: years.length, conv, accruals, recGap, recGrowth, revGrowth, benford: benfordSpread(facts) };
}

const pctRank = (vals, x) => vals.filter((v) => v < x).length / vals.length;
// "worse" direction: low conversion, high accruals, high receivables gap
const DIR = { conv: -1, accruals: 1, recGap: 1 };
const PEER_MIN = 8;

export function redflagCard(m, peerMetrics, peerLabel) {
  if (!m || !m.ok) return { ok: false, reason: (m && m.reason) || 'Not enough data.' };
  const checks = [];
  const defs = [
    ['conv', 'Cash vs profit', 'Operating cash flow as a share of net income, last ' + m.years + ' years combined'],
    ['accruals', 'Accruals ratio', 'Profit not backed by cash, as a share of average total assets'],
    ['recGap', 'Receivables vs sales', 'Growth of receivables minus growth of sales, in points'],
  ];
  for (const [k, title, what] of defs) {
    const value = m[k];
    if (value == null) { checks.push({ key: k, title, what, value: null, note: 'Not reported in the SEC filings, so unknown.' }); continue; }
    const peers = (peerMetrics || []).map((p) => p && p.ok ? p[k] : null).filter((v) => v != null);
    let rank = null, unusual = null;
    if (peers.length >= PEER_MIN) {
      rank = pctRank(peers, value);
      const worse = DIR[k] > 0 ? rank : 1 - rank;
      unusual = worse >= 0.9;
    }
    checks.push({ key: k, title, what, value, peers: peers.length, rank, unusual });
  }
  const b = m.benford && m.benford.mad != null ? { mad: m.benford.mad, n: m.benford.n, note: 'Footnote only. Many honest companies differ from this pattern, and it proves nothing alone.' } : null;
  return { ok: true, v: REDFLAGS_VERSION, fyEnd: m.fyEnd, peerLabel: peerLabel || null, checks, benford: b, wording: 'Unusual vs peers, read the filing.' };
}
