// The permanent record (stage 2 of the robo-advisor plan, 3 November 2026).
// Every night the build adds files to the "records" branch, and never edits or deletes one:
//   days/YYYY/YYYY-MM-DD.ndjson  what changed in the tool's calls that day (one event per line), after a header line
//                                that carries the SHA-256 of the previous day's file, so a changed or missing day
//                                breaks the chain (verifyChain)
//   state/YYYY-MM-DD.json        the state the next day is compared with (verdict, halal status, zones, picks, swing
//                                signals). Every day file has one, so removing the latest day shows as well
// How each call did (1, 3, 6 and 12 months later, against the S&P 500) is worked out again every night from these files
// and the prices (followUp). It is not stored in the record, so nothing in the record is ever rewritten.
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { PLAN_POOLS } from './ltstats.js';
import { LOG_FIELDS } from './signals.js';

export const RECORD_VERSION = 1;
// trading days after the call, and their names
export const HORIZONS = [[21, '1m'], [63, '3m'], [126, '6m'], [252, '12m']];
// a company with no analysis (a failed download, or it left the companies analysed) keeps its last state this many
// days, so its return is not taken for a new call; after that it is dropped, and if it comes back it is new
export const MISSING_DAYS = 30;
// the same call on the same company again within this many days stays in the record but is not counted again in the
// results (a price that hovers around the buy price would otherwise count many times)
export const REPEAT_DAYS = 30;
// closed swing signals stay in the state this long (a closed signal never changes, and an older one cannot be new)
const SIG_DAYS = 30;
const S_STATUS = LOG_FIELDS.indexOf('status');
const GOOD = new Set(['BUY_STRONG', 'BUY']);
const WEAK = new Set(['AVOID_WEAK', 'SPECULATIVE']);
const isNum = (x) => typeof x === 'number' && Number.isFinite(x);
const r4 = (x) => (isNum(x) ? Math.round(x * 1e4) / 1e4 : null);
export const sha256 = (s) => createHash('sha256').update(s).digest('hex');
const dayNum = (d) => Math.round(Date.parse(`${d}T00:00:00Z`) / 86400000);
const addDays = (d, n) => new Date((dayNum(d) + n) * 86400000).toISOString().slice(0, 10);
const analysed = (r) => !!(r && r.ticker && r.verdict);

// screen.json (fields + rows) -> one object per company
export function rowsOf(scr) {
  if (!scr || !Array.isArray(scr.fields) || !Array.isArray(scr.rows)) return [];
  return scr.rows.map((r) => Object.fromEntries(scr.fields.map((k, i) => [k, r[i]])));
}

// what the record follows for one company: verdict, halal status, and whether the price is in the long-term buy zone
// (a buy rating, a halal pass and the price at or below the buy price) or above the trim price
export function stateOf(r) {
  const px = isNum(r.price) ? r.price : null;
  return {
    v: r.verdict || '',
    s: r.shariah || '',
    buy: !!(GOOD.has(r.verdict) && r.shariah === 'pass' && isNum(r.buyBelow) && px !== null && px <= r.buyBelow),
    trim: !!(isNum(r.trimAbove) && px !== null && px >= r.trimAbove),
  };
}

// the Portfolio page's picks as the page makes them (index.html, stockIdeasByHold): 6 long-term, then 6 medium-term
// that are not already long-term picks; at most 2 a sector; best score first, ties in the screen's order
export function picksOf(rows) {
  const snap = (r) => ({ verdict: r.verdict, quality: r.quality, growth: r.growth, health: r.health, shariah: r.shariah, price: r.price, buyBelow: r.buyBelow, trimAbove: r.trimAbove, upside: r.upside, trend: r.trend, dq: r.dq === 'insufficient' ? 'X' : 'H', cap: null });
  const taken = new Set();
  const out = {};
  for (const pool of ['long', 'mid']) {
    const P = PLAN_POOLS[pool];
    const cand = rows.filter((r) => r.ticker && P.filter(snap(r))).map((r) => [r, P.score(snap(r))]).sort((a, b) => b[1] - a[1]);
    const per = new Map();
    const list = [];
    for (const [r] of cand) {
      if (taken.has(r.ticker)) continue;
      const k = r.sector || 'Other';
      if ((per.get(k) || 0) >= 2) continue;
      per.set(k, (per.get(k) || 0) + 1);
      list.push(r.ticker);
      if (list.length >= 6) break;
    }
    list.forEach((t) => taken.add(t));
    out[pool] = list;
  }
  return out;
}

// The state of one day, which the next day is compared with: { v, date, co, picks, sig }
//   co: { ticker: [verdict, halal, buy 0/1, trim 0/1, missing since] }. A company with no analysis today keeps its last
//       state (with the date it went missing) for up to MISSING_DAYS
//   picks: { long, mid }: today's picks, plus the last state's picks that have no analysis today (a failed download is
//       not a dropped pick, nor its return a new one)
//   sig: the swing signals (sigState), when tonight's signal log is given
export function stateFile(date, rows, prev = null, sigAfter = null) {
  const co = {};
  for (const r of rows) {
    if (!analysed(r)) continue;
    const s = stateOf(r);
    co[r.ticker] = [s.v, s.s, s.buy ? 1 : 0, s.trim ? 1 : 0];
  }
  for (const [t, x] of Object.entries((prev && prev.co) || {})) {
    if (co[t]) continue;
    const since = x[4] || date || null;
    if (date && since && dayNum(date) - dayNum(since) > MISSING_DAYS) continue;
    co[t] = since ? [x[0], x[1], x[2], x[3], since] : x.slice(0, 4);
  }
  const picks = picksOf(rows);
  const here = new Set(rows.filter(analysed).map((r) => r.ticker));
  for (const pool of ['long', 'mid']) {
    for (const t of ((prev && prev.picks) || {})[pool] || []) if (!here.has(t) && co[t] && !picks[pool].includes(t)) picks[pool].push(t);
  }
  const out = { v: RECORD_VERSION, date, co, picks };
  if (sigAfter) out.sig = sigState(date, sigAfter);
  return out;
}

// swing signals: a fingerprint of each signal still pending or open (to see it fill, close or lapse), and the closed
// ones of the last SIG_DAYS days
const sigKey = (r) => `${r[0]}|${r[1]}`;
const sigHash = (r) => sha256(JSON.stringify(r)).slice(0, 12);
function sigState(date, after) {
  const since = date ? addDays(date, -SIG_DAYS) : null;
  const open = {};
  const closed = [];
  for (const r of after) {
    if (r[S_STATUS] !== 'closed') open[sigKey(r)] = sigHash(r);
    else if (!since || r[1] >= since) closed.push(sigKey(r));
  }
  return { since, open, closed };
}
// every new signal, every change in one (filled, closed), and every one that lapsed (its order never filled)
function sigEvents(ps, after) {
  const ev = [];
  const open = ps.open || {};
  const closed = new Set(ps.closed || []);
  const now = new Set();
  for (const r of after) {
    const k = sigKey(r);
    now.add(k);
    if (Object.hasOwn(open, k)) {
      if (open[k] !== sigHash(r)) ev.push({ k: 'signal', t: r[0], rec: r });
    } else if (!closed.has(k) && (r[S_STATUS] !== 'closed' || !ps.since || r[1] >= ps.since)) ev.push({ k: 'signal', t: r[0], rec: r });
  }
  for (const k of Object.keys(open)) {
    if (now.has(k)) continue;
    const i = k.indexOf('|');
    ev.push({ k: 'signal_lapsed', t: k.slice(0, i), d: k.slice(i + 1) });
  }
  return ev;
}

// What changed since the last recorded state, and the new state. prev: that state (null on the first day: everything
// today is recorded as the starting point); rows: today's companies; sig: { after: tonight's swing signal log, before:
// last night's, used only if the last state has no signals }; date: today
export function dayChange(prev, rows, sig = null, date = null) {
  const next = stateFile(date, rows, prev, sig ? sig.after || [] : null);
  const ev = [];
  const was = (prev && prev.co) || {};
  const by = new Map(rows.filter(analysed).map((r) => [r.ticker, r]));
  const base = (r) => ({ t: r.ticker, px: isNum(r.price) ? r.price : null, v: r.verdict || '', s: r.shariah || '', fair: isNum(r.fair) ? r.fair : null, bb: isNum(r.buyBelow) ? r.buyBelow : null, tr: isNum(r.trimAbove) ? r.trimAbove : null });
  for (const r of by.values()) {
    const n = stateOf(r);
    const w = was[r.ticker];
    const p = w ? { v: w[0], s: w[1], buy: !!w[2], trim: !!w[3] } : null;
    if (!p || p.v !== n.v) ev.push({ k: 'verdict', ...base(r), from: p ? p.v : null });
    if (p && p.s !== n.s) ev.push({ k: 'halal', ...base(r), from: p.s });
    if (n.buy && !(p && p.buy)) ev.push({ k: 'buy_in', ...base(r) });
    if (!n.buy && p && p.buy) ev.push({ k: 'buy_out', ...base(r) });
    if (n.trim && !(p && p.trim)) ev.push({ k: 'trim_in', ...base(r) });
    if (!n.trim && p && p.trim) ev.push({ k: 'trim_out', ...base(r) });
  }
  for (const pool of ['long', 'mid']) {
    const before = ((prev && prev.picks) || {})[pool] || [];
    const now = next.picks[pool];
    for (const t of now) if (!before.includes(t)) ev.push({ k: 'pick_in', pool, ...(by.has(t) ? base(by.get(t)) : { t }) });
    // a pick missing for longer than MISSING_DAYS is dropped without a price (gone)
    for (const t of before) if (!now.includes(t)) ev.push({ k: 'pick_out', pool, ...(by.has(t) ? base(by.get(t)) : { t, gone: true }) });
  }
  if (sig) {
    const after = sig.after || [];
    if (prev && prev.sig) ev.push(...sigEvents(prev.sig, after));
    else if (!prev) { for (const r of after) if (r[S_STATUS] !== 'closed') ev.push({ k: 'signal', t: r[0], rec: r }); } // standing on the first day
    else {
      const old = new Map((sig.before || []).map((r) => [sigKey(r), JSON.stringify(r)]));
      for (const r of after) if (old.get(sigKey(r)) !== JSON.stringify(r)) ev.push({ k: 'signal', t: r[0], rec: r });
    }
  }
  return { events: ev, next };
}
export const dayEvents = (prev, rows, sig = null, date = null) => dayChange(prev, rows, sig, date).events;

// one day's file: a header (with the previous file's SHA-256), then one event per line
export function dayFile({ date, built, prevHash, events, baseline = false }) {
  const head = { v: RECORD_VERSION, date, built, prev: prevHash || null, n: events.length, baseline };
  return [JSON.stringify(head), ...events.map((e) => JSON.stringify(e))].join('\n') + '\n';
}
export function parseDay(text) {
  const lines = String(text).split('\n').filter(Boolean);
  return { head: JSON.parse(lines[0]), events: lines.slice(1).map((l) => JSON.parse(l)) };
}
// day files sort by name; a second file for the same date is named YYYY-MM-DD_2.ndjson, which sorts after the first
export const dayName = (date, k = 1) => `${date}${k > 1 ? `_${k}` : ''}.ndjson`;
// files: [{ name, text }] in name order. ok: every header carries the hash of the file before it
export function verifyChain(files) {
  let prev = null;
  for (const f of files) {
    let head;
    try { head = parseDay(f.text).head; } catch { return { ok: false, at: f.name, why: 'unreadable' }; }
    if ((head.prev || null) !== prev) return { ok: false, at: f.name, why: 'hash' };
    prev = sha256(f.text);
  }
  return { ok: true, days: files.length, last: prev };
}
// every day file has a state file of the same name and the other way round
export function pairCheck(dayNames, stateNames) {
  const a = new Set(dayNames.map((n) => n.replace(/\.ndjson$/, '')));
  const b = new Set(stateNames.map((n) => n.replace(/\.json$/, '')));
  const bad = [...a].filter((x) => !b.has(x)).concat([...b].filter((x) => !a.has(x))).sort();
  return bad.length ? { ok: false, at: bad[0], why: 'missing' } : { ok: true };
}

// which question a call answers, and whether a rise afterwards is good (buy calls) or bad (sell and trim calls)
export function groupOf(e) {
  if (e.k === 'buy_in') return 'buy';
  if (e.k === 'pick_in') return e.pool === 'mid' ? 'pick_mid' : 'pick_long';
  if (e.k === 'trim_in') return 'trim';
  if (e.k === 'verdict' && WEAK.has(e.v) && e.from && !WEAK.has(e.from)) return 'sell_weak';
  // a halal fail is recorded but not judged by later returns: the screen is a rule to follow, not a forecast
  return null;
}
export const GROUPS = {
  buy: { label: 'Entered the long-term buy zone', up: true },
  pick_long: { label: 'New long-term pick (Portfolio page)', up: true },
  pick_mid: { label: 'New medium-term pick (Portfolio page)', up: true },
  trim: { label: 'Reached the trim price', up: false },
  sell_weak: { label: 'Business weakened: sell', up: false },
};

// the first trading day after the call (the call is read the next morning, so it is filled at that session's close)
function nextIndex(d, ymd) {
  let lo = 0;
  let hi = d.length;
  while (lo < hi) { const m = (lo + hi) >> 1; if (d[m] <= ymd) lo = m + 1; else hi = m; }
  return lo;
}
const ymdOf = (date) => Number(String(date).replace(/-/g, ''));

// calls: [{ date, e }] in date order; closesOf(t) -> { d: yyyymmdd numbers ascending, c: closes } or null; spy the
// same. For each group and horizon: calls followed that long, the stock's average return, the S&P 500's over the same
// days, the difference, and how often the stock beat the S&P 500. Calls not yet that old are waiting. n counts the
// calls; rep the repeats not counted (REPEAT_DAYS; seen can be shared between two calls of followUp); gone the calls
// on companies without prices tonight, which are left out.
export function followUp(calls, closesOf, spy, { seen = new Map() } = {}) {
  const out = {};
  for (const g of Object.keys(GROUPS)) out[g] = { ...GROUPS[g], n: 0, rep: 0, gone: 0, h: Object.fromEntries(HORIZONS.map(([, name]) => [name, { n: 0, ret: 0, spy: 0, beat: 0 }])) };
  const haveSpy = !!(spy && spy.d && spy.d.length);
  for (const { date, e } of calls) {
    const g = groupOf(e);
    if (!g) continue;
    const key = `${g}|${e.t}`;
    const day = dayNum(date);
    if (seen.has(key) && day - seen.get(key) < REPEAT_DAYS) { out[g].rep++; continue; }
    seen.set(key, day);
    out[g].n++; // every call is counted, even before its prices can be followed
    if (!haveSpy) continue;
    const cl = closesOf(e.t);
    if (!cl || !cl.d || !cl.d.length) { out[g].gone++; continue; }
    const ymd = ymdOf(date);
    const i0 = nextIndex(cl.d, ymd);
    const j0 = nextIndex(spy.d, ymd);
    if (i0 >= cl.d.length || j0 >= spy.d.length || !(cl.c[i0] > 0) || !(spy.c[j0] > 0)) continue;
    for (const [h, name] of HORIZONS) {
      const i1 = i0 + h;
      if (i1 >= cl.d.length) continue;
      const j1 = nextIndex(spy.d, cl.d[i1]) - 1; // the S&P 500 on the same day (or the last day before it)
      if (j1 <= j0) continue;
      const ret = cl.c[i1] / cl.c[i0] - 1;
      const sp = spy.c[j1] / spy.c[j0] - 1;
      const H = out[g].h[name];
      H.n++;
      H.ret += ret;
      H.spy += sp;
      if (ret > sp) H.beat++;
    }
  }
  return finish(out);
}
function finish(out) {
  for (const g of Object.values(out)) {
    for (const [name, H] of Object.entries(g.h)) {
      g.h[name] = H.n ? { n: H.n, ret: r4(H.ret / H.n), spy: r4(H.spy / H.n), diff: r4((H.ret - H.spy) / H.n), beat: r4(H.beat / H.n) } : { n: 0 };
    }
  }
  return out;
}

// The nightly step: read the record in dir (the "records" branch, checked out), add today's day file and state file if
// anything changed (or if the record is empty: the starting point), and return the summary the Record page shows.
// rows: today's companies (rowsOf); signals: { before, after } swing signal records; closesOf(t) and spy: closes as in
// followUp. Old files are only read, never written.
function listDays(dir) {
  const daysDir = path.join(dir, 'days');
  const files = fs.existsSync(daysDir)
    ? fs.readdirSync(daysDir).flatMap((y) => fs.readdirSync(path.join(daysDir, y)).filter((n) => n.endsWith('.ndjson')).map((n) => ({ name: n, file: path.join(daysDir, y, n) })))
    : [];
  return files.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
}
// the companies with calls in the record: the nightly update fetches their prices even when it no longer analyses them,
// so a company that fell below the size cut-off does not drop out of the results
export function followedTickers(dir) {
  const out = new Set();
  for (const f of listDays(dir)) for (const e of parseDay(fs.readFileSync(f.file, 'utf8')).events) if (e.t && groupOf(e)) out.add(e.t);
  return [...out].sort();
}

export function updateRecord({ dir, date, built, rows, signals = null, closesOf = () => null, spy = null, url = null }) {
  const daysDir = path.join(dir, 'days');
  const stateDir = path.join(dir, 'state');
  const files = listDays(dir);
  const texts = files.map((f) => ({ name: f.name, text: fs.readFileSync(f.file, 'utf8') }));
  const states = fs.existsSync(stateDir) ? fs.readdirSync(stateDir).filter((n) => n.endsWith('.json')).sort() : [];
  const check = (t, s) => { const c = verifyChain(t); return c.ok ? pairCheck(t.map((f) => f.name), s) : c; };
  const before = check(texts, states);
  const prev = states.length ? JSON.parse(fs.readFileSync(path.join(stateDir, states.at(-1)), 'utf8')) : null;
  const { events, next } = dayChange(prev, rows, signals, date);
  let today = null;
  if (events.length || !prev) {
    let k = 1;
    while (texts.some((f) => f.name === dayName(date, k)) || states.includes(dayName(date, k).replace(/\.ndjson$/, '.json'))) k++;
    const name = dayName(date, k);
    const stateName = name.replace(/\.ndjson$/, '.json');
    // both files are made before either is written, so a failure in the making leaves neither
    const text = dayFile({ date, built, prevHash: texts.length ? sha256(texts.at(-1).text) : null, events, baseline: !prev });
    const stateText = JSON.stringify(next);
    fs.mkdirSync(path.join(daysDir, date.slice(0, 4)), { recursive: true });
    fs.mkdirSync(stateDir, { recursive: true });
    fs.writeFileSync(path.join(daysDir, date.slice(0, 4), name), text, { flag: 'wx' }); // never over an existing file
    fs.writeFileSync(path.join(stateDir, stateName), stateText, { flag: 'wx' });
    texts.push({ name, text });
    states.push(stateName);
    today = { file: name, events: events.length, baseline: !prev };
  }
  const calls = [];
  const kinds = {};
  for (const f of texts) {
    const { head, events: ev } = parseDay(f.text);
    for (const e of ev) {
      kinds[e.k] = (kinds[e.k] || 0) + 1;
      calls.push({ date: head.date, e, baseline: !!head.baseline });
    }
  }
  const chain = check(texts, states);
  // the calls standing on the first day (the starting point), then the calls made after it; a repeat within
  // REPEAT_DAYS of a standing call is not counted again
  const seen = new Map();
  const standing = followUp(calls.filter((c) => c.baseline), closesOf, spy, { seen });
  const groups = followUp(calls.filter((c) => !c.baseline), closesOf, spy, { seen });
  return {
    version: RECORD_VERSION,
    since: texts.length ? parseDay(texts[0].text).head.date : null,
    days: texts.length,
    chain: { ok: chain.ok, at: chain.ok ? null : chain.at, why: chain.ok ? null : chain.why, okBefore: before.ok },
    today,
    kinds,
    prices: !!(spy && spy.d && spy.d.length),
    repeatDays: REPEAT_DAYS,
    groups,
    standing,
    recent: calls.filter((c) => !c.baseline && groupOf(c.e)).slice(-60).reverse().map((c) => ({ d: c.date, t: c.e.t, g: groupOf(c.e), px: c.e.px, v: c.e.v })),
    url,
  };
}
