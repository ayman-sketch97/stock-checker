// Price-data safety for the nightly build. Display and data-source safety only: no recommendation, threshold,
// formula or stored record uses anything in here.
//   - a second free source (Yahoo Finance chart data, no key) used only when Nasdaq's daily history fails for a company
//   - a sanity check that refuses a fallback series that does not match the price Nasdaq's screener gave
//   - a lateness count in trading days, so a stale build is reported plainly or stops instead of publishing quietly
//   - a comparison with the last good published price, so a jump nobody can explain is shown, not hidden
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36';

export const LATE_WARN_DAYS = 2; // trading days behind: health shows a warning
export const LATE_FAIL_DAYS = 4; // trading days behind: the build stops and the live site is left untouched
export const FALLBACK_TOLERANCE = 0.25; // fallback close must be within 25% of the screener price
export const JUMP_FLAG = 0.4; // a move of more than 40% since the last published price is listed in health

// Yahoo's daily series -> [{date, o, h, l, c, v}], oldest first, dated in the exchange's own time zone.
export function dailyFromYahoo(j) {
  const res = j?.chart?.result?.[0];
  if (!res || !Array.isArray(res.timestamp)) return [];
  const q = res.indicators?.quote?.[0] || {};
  const off = Number(res.meta?.gmtoffset) || 0;
  const out = [];
  for (let i = 0; i < res.timestamp.length; i++) {
    const c = q.close?.[i];
    if (!(typeof c === 'number' && c > 0)) continue;
    const num = (x, d) => (typeof x === 'number' && x > 0 ? x : d);
    const o = num(q.open?.[i], c);
    out.push({
      date: new Date((res.timestamp[i] + off) * 1000).toISOString().slice(0, 10),
      o,
      h: num(q.high?.[i], Math.max(c, o)),
      l: num(q.low?.[i], Math.min(c, o)),
      c,
      v: num(q.volume?.[i], 0),
    });
  }
  return out.sort((a, b) => (a.date < b.date ? -1 : 1));
}

// Is this fallback series safe to use in place of Nasdaq's? Returns '' when yes, otherwise the reason it is refused.
export function refuseDaily(daily, refPrice, { minBars = 250, tolerance = FALLBACK_TOLERANCE } = {}) {
  if (!Array.isArray(daily) || daily.length < minBars) return `only ${daily?.length || 0} bars`;
  for (let i = 1; i < daily.length; i++) if (!(daily[i].date > daily[i - 1].date)) return 'dates out of order';
  const last = daily[daily.length - 1].c;
  if (!(refPrice > 0)) return 'no reference price to check against';
  if (Math.abs(last / refPrice - 1) > tolerance) return `last close ${last} does not match the screener price ${refPrice}`;
  return '';
}

// Yahoo daily history for one ticker. fetchFn is injectable so tests never touch the network.
export async function getYahooDaily(ticker, { fetchFn = fetch, timeoutMs = 10000, hosts = ['query1', 'query2'] } = {}) {
  const sym = encodeURIComponent(ticker);
  let lastErr = null;
  for (const host of hosts) {
    try {
      const r = await fetchFn(`https://${host}.finance.yahoo.com/v8/finance/chart/${sym}?range=10y&interval=1d&includePrePost=false`, {
        headers: { 'User-Agent': UA, Accept: 'application/json' },
        signal: AbortSignal.timeout(timeoutMs),
      });
      if (!r.ok) { lastErr = new Error('yahoo ' + r.status); continue; }
      const daily = dailyFromYahoo(await r.json());
      if (daily.length) return daily;
      lastErr = new Error('yahoo empty');
    } catch (e) {
      lastErr = e;
    }
  }
  throw lastErr || new Error('yahoo failed');
}

// The same weekday count the site's own pause rule thinks in: weekdays after priceDate up to the last session that
// should have closed by `now` (New York time, close at 16:00, prices final from 16:30). Holidays are not known here,
// so a holiday counts as a late day; the warn and fail limits leave room for a long weekend.
export function tradingDaysLate(priceDate, now = new Date()) {
  if (!/^\d{4}-\d\d-\d\d$/.test(String(priceDate || ''))) return null;
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit', hour: 'numeric', minute: 'numeric', hourCycle: 'h23' }).formatToParts(now).map((x) => [x.type, x.value]));
  const nyToday = `${p.year}-${p.month}-${p.day}`;
  let last = new Date(nyToday + 'T00:00:00Z');
  if (Number(p.hour) * 60 + Number(p.minute) < 16 * 60 + 30) last = new Date(last.getTime() - 86400000);
  let n = 0;
  for (let d = new Date(priceDate + 'T00:00:00Z'); ; ) {
    d = new Date(d.getTime() + 86400000);
    if (d > last) break;
    const wd = d.getUTCDay();
    if (wd !== 0 && wd !== 6) n++;
  }
  return n;
}

// Compare tonight's prices with the last good published ones. Returns the tickers that moved more than `flag`.
export function jumpsSince(tonight, lastGood, flag = JUMP_FLAG) {
  const out = [];
  for (const [t, p] of Object.entries(tonight || {})) {
    const q = lastGood?.[t];
    if (!(p > 0) || !(q > 0)) continue;
    const move = p / q - 1;
    if (Math.abs(move) > flag) out.push({ t, now: p, was: q, move: Math.round(move * 1000) / 1000 });
  }
  return out.sort((a, b) => Math.abs(b.move) - Math.abs(a.move));
}

// The "Price data" card for the health report (display only). lib/health.js is frozen by test/stage8-untouched, so the
// build appends this card to the checks it returns.
export function priceDataCheck(pdat) {
  if (!pdat) return null;
  const fb = pdat.fallback || [];
  const late = pdat.lateDays;
  const parts = [];
  parts.push(late === null || late === undefined ? 'The latest close date is unknown.' : late === 0 ? 'Prices are from the latest close.' : `Prices are ${late} trading day${late === 1 ? '' : 's'} behind (holidays count as late days).`);
  if (fb.length) parts.push(`${fb.length} compan${fb.length === 1 ? 'y' : 'ies'} used the backup price source because Nasdaq's history failed (${fb.slice(0, 5).join(', ')}${fb.length > 5 ? ', …' : ''}); their pages name it.`);
  if (pdat.refused) parts.push(`${pdat.refused} backup price series ${pdat.refused === 1 ? 'was' : 'were'} refused because ${pdat.refused === 1 ? 'it' : 'they'} did not match Nasdaq's price.`);
  if (pdat.jumpCount) parts.push(`${pdat.jumpCount} price${pdat.jumpCount === 1 ? '' : 's'} moved more than 40% since the last build (${(pdat.jumps || []).slice(0, 5).map((j) => j.t).join(', ')}${pdat.jumpCount > 5 ? ', …' : ''}); a split or a data error, so check before relying on them.`);
  const warn = late === null || late === undefined || late >= LATE_WARN_DAYS || fb.length || pdat.refused || pdat.jumpCount;
  return { id: 'pricedata', status: warn ? 'warn' : 'ok', label: 'Price data', text: parts.join(' ') };
}
