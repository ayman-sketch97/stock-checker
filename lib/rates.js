// US Treasury daily par yield curve: parse the Treasury's CSV into the few figures the site shows. Education only: the curve shape is
// described in words and says nothing about what to buy or sell. Source: home.treasury.gov (US government data, no key needed).
export const RATES_VERSION = 1;
export const TREASURY_URL = (year) => `https://home.treasury.gov/resource-center/data-chart-center/interest-rates/daily-treasury-rates.csv/${year}/all?type=daily_treasury_yield_curve&field_tdr_date_value=${year}&page&_format=csv`;
const COLS = { y3m: '3 Mo', y2y: '2 Yr', y10y: '10 Yr' };
const splitLine = (l) => l.split(',').map((x) => x.replace(/^"|"$/g, '').trim());
const isoOf = (mdy) => { const m = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(mdy || ''); return m ? `${m[3]}-${m[1]}-${m[2]}` : null; };

// -> { asOf, y3m, y2y, y10y, prev: { asOf, y3m, y2y, y10y } } or null when the file does not hold two readable days
export function parseTreasuryCsv(text) {
  const lines = String(text || '').split(/\r?\n/).filter((l) => l.trim());
  if (lines.length < 2) return null;
  const head = splitLine(lines[0]);
  if (head[0] !== 'Date') return null;
  const idx = Object.fromEntries(Object.entries(COLS).map(([k, c]) => [k, head.indexOf(c)]));
  if (Object.values(idx).some((i) => i < 0)) return null;
  const rows = [];
  for (const l of lines.slice(1)) {
    const c = splitLine(l);
    const asOf = isoOf(c[0]);
    if (!asOf) continue;
    const o = { asOf };
    for (const [k, i] of Object.entries(idx)) { const v = Number(c[i]); o[k] = c[i] !== '' && Number.isFinite(v) && v >= 0 && v < 30 ? v : null; }
    if (Object.keys(idx).every((k) => o[k] !== null)) rows.push(o);
  }
  if (rows.length < 2) return null;
  rows.sort((a, b) => (a.asOf < b.asOf ? 1 : -1));
  const [a, b] = rows;
  return { ...a, prev: b };
}

// the shape in plain words, from the 3-month and 10-year yields (percentage points apart)
export function curveShape(r) {
  if (!r || typeof r.y3m !== 'number' || typeof r.y10y !== 'number') return null;
  const d = r.y10y - r.y3m;
  if (d >= 0.25) return 'Longer-term rates are above short-term rates (a normal curve).';
  if (d <= -0.1) return 'Short-term rates are above longer-term rates (an inverted curve).';
  return 'Short-term and longer-term rates are close (a flat curve).';
}
