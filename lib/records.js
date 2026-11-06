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

// 1: from 31 Oct 2026. 2: from 4 Nov 2026, adds the "hold through a fall" call (hold_fall) and the buy calls waiting
// for one (the state's "fall" list). Files keep the version they were written with.
export const RECORD_VERSION = 2;
// the version of how the calls are judged: 4 is PREREGISTERED.md, section 7.3
export const MEASURES_VERSION = 4;
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
// verdicts that judged the business as sound enough to hold: only a move from one of these to a weak verdict is a
// "business weakened" sell call (a move from "not halal", "no verdict (data)" or "too little data" only reveals the
// business verdict that was hidden before)
const SOUND = new Set(['BUY_STRONG', 'BUY', 'CONTRARIAN', 'WATCH', 'LOOK', 'PASS']);
// Measure 4 of PREREGISTERED.md, section 7 (sales avoided): a stock that falls this far below the price of its buy
// call while its verdict stays sound gets a "hold" call, judged like a buy (did it then beat the S&P 500?). The first
// buy call (buy zone or Portfolio page pick) sets the price; the wait ends with the hold call, or as soon as the
// verdict is no longer sound or the stock fails the halal screen (then the rule is no longer to hold).
export const HOLD_FALL = 0.2;
const BUY_CALLS = new Set(['buy_in', 'pick_in']);
const holdable = (v, s) => SOUND.has(v) && s !== 'fail';
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
// last night's, used only if the last state has no signals }; date: today; seed: the buy calls waiting for a fall, when
// the last state was made before the list existed (fallFrom); moveOf(t, date): the stock's change since the close of
// that date from split-adjusted closes, or null if unknown tonight (then no hold call is made tonight). Without
// moveOf the screen's prices are compared directly, which a stock split would fool, so the nightly step always gives it.
export function dayChange(prev, rows, sig = null, date = null, seed = null, moveOf = null) {
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
  // the buy calls waiting for a fall (HOLD_FALL): { ticker: [price at the call, date of the call] }
  const fall = { ...((prev && prev.fall) || seed || {}) };
  for (const r of by.values()) {
    const w = fall[r.ticker];
    if (!w) continue;
    if (!holdable(r.verdict, r.shariah)) { delete fall[r.ticker]; continue; }
    const m = moveOf ? moveOf(r.ticker, w[1]) : isNum(r.price) ? r.price / w[0] - 1 : null;
    if (isNum(m) && m <= -HOLD_FALL + 1e-9) {
      ev.push({ k: 'hold_fall', ...base(r), from: w[0], since: w[1], move: r4(m) });
      delete fall[r.ticker];
    }
  }
  for (const e of ev) if (BUY_CALLS.has(e.k) && isNum(e.px) && e.px > 0 && !fall[e.t] && holdable(e.v, e.s)) fall[e.t] = [e.px, date];
  for (const t of Object.keys(fall)) if (!next.co[t]) delete fall[t];
  next.fall = fall;
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
// the buy calls waiting for a fall, worked out from the day files ([{ head, events }] in order), for a record whose last
// state was made before the list existed: the same rules as dayChange, applied to the calls as they were recorded
export function fallFrom(days) {
  const fall = {};
  for (const { head, events } of days) {
    for (const e of events) {
      if (!e.t) continue;
      if (e.k === 'hold_fall' || ((e.k === 'verdict' || e.k === 'halal') && !holdable(e.v, e.s))) delete fall[e.t];
      else if (BUY_CALLS.has(e.k) && isNum(e.px) && e.px > 0 && !fall[e.t] && holdable(e.v, e.s)) fall[e.t] = [e.px, head.date];
    }
  }
  return fall;
}

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
  if (e.k === 'verdict' && WEAK.has(e.v) && SOUND.has(e.from)) return 'sell_weak';
  if (e.k === 'hold_fall') return 'hold_fall';
  // a halal fail is recorded but not judged by later returns: the screen is a rule to follow, not a forecast
  return null;
}
export const GROUPS = {
  buy: { label: 'Entered the long-term buy zone', up: true },
  pick_long: { label: 'New long-term pick (Portfolio page)', up: true },
  pick_mid: { label: 'New medium-term pick (Portfolio page)', up: true },
  trim: { label: 'Reached the trim price', up: false },
  sell_weak: { label: 'Business weakened: sell', up: false },
  hold_fall: { label: `Fell ${HOLD_FALL * 100}% with the business still sound: hold`, up: true },
};

// the first index whose day is after ymd
function nextIndex(d, ymd) {
  let lo = 0;
  let hi = d.length;
  while (lo < hi) { const m = (lo + hi) >> 1; if (d[m] <= ymd) lo = m + 1; else hi = m; }
  return lo;
}
const ymdOf = (date) => Number(String(date).replace(/-/g, ''));
// A call can only be acted on at a close after it was published. Its day file's "built" time plus 5 h 15 min (4 hours
// from UTC to New York, plus the longest build, 75 minutes) falls on the first New York day whose close is surely
// later. Normally that is the session after the call; when the data lagged (a call dated with Friday's closes but
// published on Monday evening), it is later, so no call is credited with a price nobody could still trade at.
const ACT_LAG_MS = 5.25 * 3600000;
export function actFrom(built) {
  const t = Date.parse(built || '');
  return Number.isFinite(t) ? ymdOf(new Date(t + ACT_LAG_MS).toISOString().slice(0, 10)) : 0;
}

// A company counts as stopped (taken over, delisted, bankrupt) once it has had no close for this many sessions of the
// S&P 500 (PREREGISTERED.md, section 7.2): its return then runs to its last close, and is 0% after that
export const STOP_SESSIONS = 10;
// One switch for dividends, for every figure at once (PREREGISTERED.md, section 7.3): off means prices only for the
// calls, random halal stocks and the S&P 500 alike, so the two are never mixed. The archive keeps any dividend history
// it reads, but nothing uses it while the switch is off. Turning it on needs a dated amendment to section 7.3, which
// also says what a missing history counts as.
export const TOTAL_RETURNS = false;
// the total-return factor from dividends with an ex-date after index i0 and up to index i1 of a series, reinvested at
// the close of the ex-dividend day (the last close on or before it); div: [[yyyymmdd, amount]] ascending
function divFactor(cl, i0, i1, div) {
  let f = 1;
  if (!div || !div.length || i1 <= i0) return f;
  const from = cl.d[i0];
  const to = cl.d[i1];
  for (const [d, a] of div) {
    if (d <= from || d > to || !(a > 0)) continue;
    const k = nextIndex(cl.d, d) - 1;
    if (k >= 0 && cl.c[k] > 0) f *= 1 + a / cl.c[k];
  }
  return f;
}
// One company followed from the first close after both a call's date and its publication (actFrom), over 21, 63,
// 126 and 252 sessions of the S&P 500 (section 7.2): for each horizon [its return, the S&P 500's over the same
// sessions, how it ended ('' normally, 'stop' if it stopped trading first), whether dividends were included], or null
// where the horizon has not come yet. null if it has no prices at all, [] if it cannot be followed yet.
// div: { asOf: yyyymmdd the history was read, div: [[yyyymmdd ex-date, amount]] } or null if never read; spyDiv the
// same for the S&P 500. total: the dividend switch (TOTAL_RETURNS); while it is off, div and spyDiv are not used.
function trail(cl, spy, date, built, div = null, spyDiv = null, total = TOTAL_RETURNS) {
  if (!cl || !cl.d || !cl.d.length) return null;
  const i0 = Math.max(nextIndex(cl.d, ymdOf(date)), nextIndex(cl.d, actFrom(built) - 1));
  if (i0 >= cl.d.length) return [];
  const j0 = nextIndex(spy.d, cl.d[i0] - 1); // the S&P 500 from the same day
  if (j0 >= spy.d.length || !(cl.c[i0] > 0) || !(spy.c[j0] > 0)) return [];
  const last = cl.d.length - 1;
  const stopped = nextIndex(spy.d, cl.d[last]) - 1 <= spy.d.length - 1 - STOP_SESSIONS;
  return HORIZONS.map(([h]) => {
    const j1 = j0 + h;
    if (j1 >= spy.d.length || !(spy.c[j1] > 0)) return null;
    const dh = spy.d[j1];
    // with the switch on, dividends count when both histories were read on or after the horizon session
    const withDiv = !!(total && div && spyDiv && div.asOf >= dh && spyDiv.asOf >= dh);
    let i1 = nextIndex(cl.d, dh) - 1; // the stock's last close on or before that session
    let end = '';
    if (i1 === last && cl.d[last] < dh) {
      if (!stopped) return null; // a few days of prices still to come
      end = 'stop';
    }
    if (i1 < i0 || !(cl.c[i1] > 0)) return null;
    const ret = (cl.c[i1] / cl.c[i0]) * (withDiv ? divFactor(cl, i0, i1, div.div) : 1) - 1;
    const sp = (spy.c[j1] / spy.c[j0]) * (withDiv ? divFactor(spy, j0, j1, spyDiv.div) : 1) - 1;
    return [ret, sp, end, withDiv];
  });
}
// the S&P 500 session a call enters at when the company itself has no prices (to know when an unpriceable call's
// horizon has come): the first session after both its date and its publication
function entrySession(spy, date, built) {
  return Math.max(nextIndex(spy.d, ymdOf(date)), nextIndex(spy.d, actFrom(built) - 1));
}

// The yardstick of PREREGISTERED.md, section 7.1: every company that passed the halal screen on the day of a call,
// followed from the same close over the same days. tickers: those companies; date and built: the call's day file.
// For each horizon: how many could be followed, and their average return, the S&P 500's, the difference, and the
// shares that beat the S&P 500, trailed it by more than 10 points, and beat it by more than 10 and 20 points.
export const YARD_RESAMPLES = 2000;
const YARD_SEED = 20261103;
export function yardstick(tickers, date, built, closesOf, spy, divOf = () => null, spyDiv = null, total = TOTAL_RETURNS) {
  const acc = HORIZONS.map(() => ({ n: 0, ret: 0, spy: 0, beat: 0, t10: 0, b10: 0, b20: 0 }));
  for (const t of tickers) {
    const tr = trail(closesOf(t), spy, date, built, divOf(t), spyDiv, total);
    if (!tr) continue;
    tr.forEach((x, k) => {
      if (!x) return;
      const A = acc[k];
      const rel = x[0] - x[1];
      A.n++; A.ret += x[0]; A.spy += x[1];
      if (rel > 0) A.beat++;
      if (rel < -0.1) A.t10++;
      if (rel > 0.1) A.b10++;
      if (rel > 0.2) A.b20++;
    });
  }
  return acc.map((A) => (A.n ? { n: A.n, ret: A.ret / A.n, spy: A.spy / A.n, rel: (A.ret - A.spy) / A.n, beat: A.beat / A.n, t10: A.t10 / A.n, b10: A.b10 / A.n, b20: A.b20 / A.n } : null));
}
// a small fixed-seed random number generator, so the same record always gives the same interval
function rng(seed) {
  let a = seed | 0;
  return () => { a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
// The previous method (sections 7.1 and 7.2, measures version 3), still worked out for comparison only: it decides
// nothing (section 7.3.2). days: [[sum of the gaps of that day's calls, number of calls]] in day order. The 90% interval
// of the average gap from resampling whole days, 2,000 times with the same seed; none with calls on fewer than 5 days.
export const PREV_MIN_DAYS = 5;
export function dayInterval(days, resamples = YARD_RESAMPLES) {
  if (days.length < PREV_MIN_DAYS) return null;
  const rnd = rng(YARD_SEED);
  const est = new Float64Array(resamples);
  for (let b = 0; b < resamples; b++) {
    let s = 0;
    let c = 0;
    for (let k = 0; k < days.length; k++) { const d = days[Math.floor(rnd() * days.length)]; s += d[0]; c += d[1]; }
    est[b] = s / c;
  }
  est.sort();
  return [est[Math.round(0.05 * (resamples - 1))], est[Math.round(0.95 * (resamples - 1))]];
}
// Student's t distribution, for the test below: the upper tail P(T > t) with df degrees of freedom (through the
// regularised incomplete beta function), and the t below which a share p of the distribution lies
function lgamma(x) {
  const c = [76.18009172947146, -86.50532032941677, 24.01409824083091, -1.231739572450155, 0.1208650973866179e-2, -0.5395239384953e-5];
  let y = x;
  const tmp = x + 5.5 - (x + 0.5) * Math.log(x + 5.5);
  let ser = 1.000000000190015;
  for (const cj of c) ser += cj / ++y;
  return -tmp + Math.log((2.5066282746310005 * ser) / x);
}
function betacf(a, b, x) {
  const TINY = 1e-300;
  let c = 1;
  let d = 1 - ((a + b) * x) / (a + 1);
  if (Math.abs(d) < TINY) d = TINY;
  d = 1 / d;
  let h = d;
  for (let m = 1; m <= 300; m++) {
    const m2 = 2 * m;
    let aa = (m * (b - m) * x) / ((a - 1 + m2) * (a + m2));
    d = 1 + aa * d; if (Math.abs(d) < TINY) d = TINY;
    c = 1 + aa / c; if (Math.abs(c) < TINY) c = TINY;
    d = 1 / d;
    h *= d * c;
    aa = (-(a + m) * (a + b + m) * x) / ((a + m2) * (a + 1 + m2));
    d = 1 + aa * d; if (Math.abs(d) < TINY) d = TINY;
    c = 1 + aa / c; if (Math.abs(c) < TINY) c = TINY;
    d = 1 / d;
    const del = d * c;
    h *= del;
    if (Math.abs(del - 1) < 1e-14) break;
  }
  return h;
}
function ibeta(x, a, b) {
  if (x <= 0) return 0;
  if (x >= 1) return 1;
  const bt = Math.exp(lgamma(a + b) - lgamma(a) - lgamma(b) + a * Math.log(x) + b * Math.log(1 - x));
  return x < (a + 1) / (a + b + 2) ? (bt * betacf(a, b, x)) / a : 1 - (bt * betacf(b, a, 1 - x)) / b;
}
export function tUpper(t, df) {
  if (t === Infinity) return 0;
  if (t === -Infinity) return 1;
  const tail = 0.5 * ibeta(df / (df + t * t), df / 2, 0.5);
  return t >= 0 ? tail : 1 - tail;
}
export function tQuantile(p, df) {
  let lo = 0;
  let hi = 1;
  while (tUpper(hi, df) > 1 - p) hi *= 2;
  for (let i = 0; i < 200; i++) { const mid = (lo + hi) / 2; if (tUpper(mid, df) > 1 - p) lo = mid; else hi = mid; }
  return (lo + hi) / 2;
}

// Section 7.3, as amended in 7.3.3 (6 November 2026, before any result): how sure the gap between the calls and
// random halal stocks is. Calls made close together share most of their measurement period, and the same company can
// be called again and again, so one test allows for both at once. The variance of the average gap is the
// cluster-robust variance over cohorts of call months as long as the horizon (12 months for the 12-month result),
// raised by a third because neighbouring cohorts share on average a sixth of their measurement months, plus the
// cluster-robust variance over companies, each company with all its calls. The p-value and the 90% interval come from
// Student's t with the smaller of the effective numbers of cohorts and of companies, less one, as degrees of freedom
// (effective number: (sum of calls)^2 / sum of calls^2, so a few cohorts or companies holding most calls count as few).
// calls: [[month number (year * 12 + month - 1), company, gap]]; horizon: in months; up: a positive gap is good.
// Returns the months with calls, the months needed (twice the horizon), the separate horizon-long periods the calls
// cover (the most calls whose periods do not overlap), and, once there are enough months, the 90% interval and the
// one-sided p-value of "no better than random halal stocks".
export const MONTHS_PER_HORIZON = { '1m': 1, '3m': 3, '6m': 6, '12m': 12 };
export const OVERLAP_FACTOR = 4 / 3;
const clusters = (calls, key) => { const by = new Map(); for (const c of calls) { const k = key(c); const x = by.get(k) || [0, 0]; x[0] += c[2]; x[1]++; by.set(k, x); } return [...by.values()]; };
const effective = (cl) => cl.reduce((a, [, n]) => a + n, 0) ** 2 / cl.reduce((a, [, n]) => a + n * n, 0);
export function gapTest(calls, { horizon, up = true } = {}) {
  const ms = [...new Set(calls.map((c) => c[0]))].sort((a, b) => a - b);
  let periods = 0;
  let next = -Infinity;
  for (const m of ms) if (m >= next) { periods++; next = m + horizon; }
  const out = { months: ms.length, need: 2 * horizon, periods, short: ms.length < 2 * horizon, lo: null, hi: null, p: null };
  if (out.short) return out;
  const N = calls.length;
  const g = calls.reduce((a, c) => a + c[2], 0) / N;
  const cohorts = clusters(calls, (c) => Math.floor((c[0] - ms[0]) / horizon));
  const companies = clusters(calls, (c) => c[1]);
  if (cohorts.length < 2 || companies.length < 2) return { ...out, cohorts: cohorts.length, companies: companies.length };
  const cr = (cl) => (cl.reduce((a, [S, n]) => a + (S - n * g) ** 2, 0) / (N * N)) * (cl.length / (cl.length - 1));
  const se = Math.sqrt(cr(cohorts) * OVERLAP_FACTOR + cr(companies));
  const df = Math.max(1, Math.floor(Math.min(effective(cohorts), effective(companies))) - 1);
  const good = up ? g : -g;
  const p = tUpper(se > 0 ? good / se : good > 0 ? Infinity : -Infinity, df);
  const tc = tQuantile(0.95, df);
  return { ...out, lo: g - tc * se, hi: g + tc * se, p, df, se: r4(se), cohorts: cohorts.length, companies: companies.length };
}

// Section 7.3: the verdict of each kind of call at 12 months. Only these six results are tested for a pass, as one
// family: a pass needs the one-sided p-value under the Holm threshold at familywise 2.5% (a kind that cannot be tested
// yet counts as p = 1, so the family is always six) and a share of wrong calls no higher than random halal stocks'.
// A 90% interval wholly on the bad side, without correction, marks the kind worse than random, under review. From 30
// matured calls; provisional until 100.
export const PASS_ALPHA = 0.025;
export const MIN_MATURED = 30;
export const FINAL_MATURED = 100;
// the numbers the page shows next to the verdicts, from here, so the two can never disagree
export const THRESHOLDS = { family: Object.keys(GROUPS).length, alpha: PASS_ALPHA, minMatured: MIN_MATURED, finalMatured: FINAL_MATURED, monthsPerHorizon: MONTHS_PER_HORIZON, warnInterval: 0.9, previousMinDays: PREV_MIN_DAYS };
// the verdict the previous method (section 7.2) would give, for comparison only
function previousVerdict(x, m, up) {
  const P = x.y && x.y.prev;
  if (m < MIN_MATURED) return 'waiting';
  if (!P) return 'noyard';
  if (!isNum(P.lo) || !isNum(P.hi)) return 'short';
  const yWrong = up ? x.y.t10 : x.y.b10;
  if ((up ? P.lo > 0 : P.hi < 0) && isNum(x.wrong) && isNum(yWrong) && x.wrong <= yWrong) return 'pass';
  if (up ? P.hi < 0 : P.lo > 0) return 'fail';
  return 'undecided';
}
export function judgeKinds(groups) {
  const rows = Object.keys(GROUPS).map((k) => {
    const x = groups && groups[k] && groups[k].h && groups[k].h['12m'];
    const m = (x && (x.matured || x.n)) || 0;
    const y = (x && x.y) || null;
    const testable = m >= MIN_MATURED && !!y && !y.short && isNum(y.p);
    return { k, x, m, y, testable, p: testable ? y.p : 1 };
  });
  const order = [...rows].sort((a, b) => a.p - b.p);
  let open = true;
  order.forEach((r, i) => {
    r.rank = i + 1;
    r.alpha = PASS_ALPHA / (order.length - i);
    r.holm = open && r.testable && r.p <= r.alpha;
    if (!r.holm) open = false;
  });
  for (const r of rows) {
    if (!r.x) continue;
    const up = GROUPS[r.k].up;
    let verdict = 'waiting';
    if (r.m >= MIN_MATURED) {
      if (!r.y) verdict = 'noyard';
      else if (r.y.short) verdict = 'short';
      else {
        const yWrong = up ? r.y.t10 : r.y.b10;
        if (r.holm && isNum(r.x.wrong) && isNum(yWrong) && r.x.wrong <= yWrong) verdict = 'pass';
        else if (r.y.behind) verdict = 'warn';
        else verdict = 'undecided';
      }
    }
    Object.assign(r.x, { verdict, provisional: r.m < FINAL_MATURED, holm: { p: r.p, rank: r.rank, alpha: r.alpha, of: rows.length }, previous: { version: 3, verdict: previousVerdict(r.x, r.m, up) } });
  }
  return groups;
}

// calls: [{ date, built, e, day }] in date order; closesOf(t) -> { d: yyyymmdd numbers ascending, c: closes } or null;
// spy the same. For each group and horizon: calls followed that long, the stock's average return, the S&P 500's over
// the same days, the difference, how often the stock beat the S&P 500, and the shares that trailed it by more than 10
// points or beat it by more than 10 and 20 points (section 7). With yardOf(call) (an array per horizon from
// yardstick, for the call's day), also the yardstick's figures over the same calls, the gap between the calls and the
// yardstick, and its 90% interval (section 7.1). Calls not yet that old are waiting. n counts the calls; rep the
// repeats not counted (REPEAT_DAYS; seen can be shared between two calls of followUp); gone the calls on companies
// without prices tonight, which are left out.
export function followUp(calls, closesOf, spy, { seen = new Map(), yardOf = null, divOf = () => null, spyDiv = null, total = TOTAL_RETURNS } = {}) {
  const out = {};
  const blank = () => ({ n: 0, ret: 0, spy: 0, beat: 0, t10: 0, b10: 0, b20: 0, st: 0, po: 0, up: 0, yn: 0, yrel: 0, ybeat: 0, yt10: 0, yb10: 0, yb20: 0, calls: [], days: new Map() });
  for (const g of Object.keys(GROUPS)) out[g] = { ...GROUPS[g], n: 0, rep: 0, gone: 0, h: Object.fromEntries(HORIZONS.map(([, name]) => [name, blank()])) };
  const haveSpy = !!(spy && spy.d && spy.d.length);
  for (const c of calls) {
    const { date, built, e } = c;
    const g = groupOf(e);
    if (!g) continue;
    const key = `${g}|${e.t}`;
    const day = dayNum(date);
    if (seen.has(key) && day - seen.get(key) < REPEAT_DAYS) { out[g].rep++; continue; }
    seen.set(key, day);
    out[g].n++; // every call is counted, even before its prices can be followed
    if (!haveSpy) continue;
    const tr = trail(closesOf(e.t), spy, date, built, divOf(e.t), spyDiv, total);
    if (!tr) {
      // no prices at all (neither tonight's nor the record's own): counted, and at every horizon that has come it is
      // an unpriceable call, which counts as wrong and is left out of the averages (section 7.2)
      out[g].gone++;
      const j0 = entrySession(spy, date, built);
      HORIZONS.forEach(([h, name]) => { if (j0 + h < spy.d.length) out[g].h[name].up++; });
      continue;
    }
    if (!tr.length) continue;
    const Y = yardOf && tr.some(Boolean) ? yardOf(c) : null;
    HORIZONS.forEach(([, name], k) => {
      const x = tr[k];
      if (!x) return;
      const H = out[g].h[name];
      const rel = x[0] - x[1];
      H.n++;
      H.ret += x[0];
      H.spy += x[1];
      if (rel > 0) H.beat++;
      if (rel < -0.1) H.t10++;
      if (rel > 0.1) H.b10++;
      if (rel > 0.2) H.b20++;
      if (x[2] === 'stop') H.st++;
      if (!x[3]) H.po++;
      const y = Y && Y[k];
      if (!y) return;
      H.yn++;
      H.yrel += y.rel;
      H.ybeat += y.beat;
      H.yt10 += y.t10;
      H.yb10 += y.b10;
      H.yb20 += y.b20;
      // for section 7.3: the month the call was made, its company, and its gap to that day's yardstick
      H.calls.push([Number(date.slice(0, 4)) * 12 + Number(date.slice(5, 7)) - 1, e.t, rel - y.rel]);
      // for the previous method (section 7.1), kept for comparison: the gaps of each day's calls together
      const dk = `${date}|${built || ''}`;
      const d = H.days.get(dk) || [0, 0];
      d[0] += rel - y.rel;
      d[1]++;
      H.days.set(dk, d);
    });
  }
  return finish(out);
}
function finish(out) {
  for (const g of Object.values(out)) {
    for (const [name, H] of Object.entries(g.h)) {
      const m = H.n + H.up; // matured calls: followed, plus the unpriceable ones
      const wrong = r4(((g.up ? H.t10 : H.b10) + H.up) / m);
      if (!H.n) { g.h[name] = H.up ? { n: 0, up: H.up, matured: m, wrong } : { n: 0 }; continue; }
      const o = { n: H.n, ret: r4(H.ret / H.n), spy: r4(H.spy / H.n), diff: r4((H.ret - H.spy) / H.n), beat: r4(H.beat / H.n), t10: r4(H.t10 / H.n), b10: r4(H.b10 / H.n), b20: r4(H.b20 / H.n), st: H.st, po: H.po, up: H.up, matured: m, wrong };
      if (H.yn) {
        const gap = H.calls.reduce((a, c) => a + c[2], 0) / H.calls.length;
        const T = gapTest(H.calls, { horizon: MONTHS_PER_HORIZON[name], up: g.up });
        // ahead and behind: the 90% interval wholly on the good or the bad side (from the unrounded bounds); p unrounded,
        // since it is compared with the Holm thresholds
        const ahead = isNum(T.lo) && (g.up ? T.lo > 0 : T.hi < 0);
        const behind = isNum(T.lo) && (g.up ? T.hi < 0 : T.lo > 0);
        const days = [...H.days.keys()].sort().map((k) => H.days.get(k));
        const ci = dayInterval(days);
        o.y = { n: H.yn, diff: r4(H.yrel / H.yn), beat: r4(H.ybeat / H.yn), t10: r4(H.yt10 / H.yn), b10: r4(H.yb10 / H.yn), b20: r4(H.yb20 / H.yn), gap: r4(gap), lo: r4(T.lo), hi: r4(T.hi), p: T.p, ahead, behind, months: T.months, need: T.need, periods: T.periods, short: T.short, ...(isNum(T.df) ? { df: T.df, se: T.se, cohorts: T.cohorts, companies: T.companies } : {}),
          // the previous method's interval (section 7.1), for comparison only
          prev: { lo: ci ? r4(ci[0]) : null, hi: ci ? r4(ci[1]) : null, days: days.length } };
      }
      g.h[name] = o;
    }
  }
  return out;
}

// The record's own price archive (section 7.2): prices/YYYY/YYYY-MM-DD.json, one file a night, never changed:
// { v, date, closes: { ticker: close }, div: { ticker: { asOf, div: [[yyyymmdd, amount]] } } }. It keeps the closes of
// every company in a call or in a yardstick of the last PRICE_DAYS days, so a company that leaves the price source
// (taken over, delisted, bankrupt) is still followed to its last close, and the dividend histories read so far.
export const PRICE_DAYS = 400;
export function trackedTickers(dir, date) {
  const out = new Set(followedTickers(dir));
  const stateDir = path.join(dir, 'state');
  if (fs.existsSync(stateDir)) {
    for (const n of fs.readdirSync(stateDir).filter((x) => x.endsWith('.json'))) {
      const d = n.slice(0, 10);
      if (date && dayNum(date) - dayNum(d) > PRICE_DAYS) continue;
      try {
        const st = JSON.parse(fs.readFileSync(path.join(stateDir, n), 'utf8'));
        for (const [t, x] of Object.entries(st.co || {})) if (x[1] === 'pass') out.add(t);
      } catch { /* an unreadable state shows in the chain check */ }
    }
  }
  return [...out].sort();
}
function priceFiles(dir) {
  const pd = path.join(dir, 'prices');
  if (!fs.existsSync(pd)) return [];
  return fs.readdirSync(pd).flatMap((y) => fs.readdirSync(path.join(pd, y)).filter((n) => n.endsWith('.json')).map((n) => path.join(pd, y, n))).sort();
}
// tonight: { closes: { t: close }, div: { t: { asOf, div } } }. A second file for the same date (_2, _3...) keeps only
// what the first did not, so the first observation of a day is never replaced
export function writePrices(dir, date, tonight) {
  if (!tonight || !date) return null;
  const files = priceFiles(dir);
  const same = files.filter((f) => path.basename(f).startsWith(date));
  const seenC = new Set();
  const seenD = new Set();
  for (const f of same) { try { const j = JSON.parse(fs.readFileSync(f, 'utf8')); Object.keys(j.closes || {}).forEach((t) => seenC.add(t)); Object.keys(j.div || {}).forEach((t) => seenD.add(t)); } catch { /* skip */ } }
  const closes = Object.fromEntries(Object.entries(tonight.closes || {}).filter(([t, c]) => !seenC.has(t) && c > 0).sort());
  const div = Object.fromEntries(Object.entries(tonight.div || {}).filter(([t, x]) => !seenD.has(t) && x && Array.isArray(x.div)).sort());
  if (!Object.keys(closes).length && !Object.keys(div).length) return null;
  const name = same.length ? `${date}_${same.length + 1}.json` : `${date}.json`;
  fs.mkdirSync(path.join(dir, 'prices', date.slice(0, 4)), { recursive: true });
  fs.writeFileSync(path.join(dir, 'prices', date.slice(0, 4), name), JSON.stringify({ v: RECORD_VERSION, date, closes, div }), { flag: 'wx' });
  return { file: name, closes: Object.keys(closes).length, div: Object.keys(div).length };
}
// the archive read back: closes as series ({ d, c } as closesOf gives), and each company's dividends merged over every
// time they were read (asOf: the latest)
export function readPrices(dir) {
  const byT = new Map();
  const div = new Map();
  for (const f of priceFiles(dir)) {
    let j;
    try { j = JSON.parse(fs.readFileSync(f, 'utf8')); } catch { continue; }
    const d = ymdOf(j.date);
    for (const [t, c] of Object.entries(j.closes || {})) { if (!byT.has(t)) byT.set(t, new Map()); byT.get(t).set(d, c); }
    for (const [t, x] of Object.entries(j.div || {})) {
      const o = div.get(t) || { asOf: 0, m: new Map() };
      o.asOf = Math.max(o.asOf, x.asOf || d);
      for (const [dd, a] of x.div) o.m.set(dd, a);
      div.set(t, o);
    }
  }
  const series = new Map();
  for (const [t, m] of byT) { const ds = [...m.keys()].sort((a, b) => a - b); series.set(t, { d: Int32Array.from(ds), c: Float64Array.from(ds.map((x) => m.get(x))) }); }
  const divs = new Map([...div].map(([t, o]) => [t, { asOf: o.asOf, div: [...o.m].sort((a, b) => a[0] - b[0]) }]));
  return { series, divs };
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

// tonight: the closes and dividend histories to add to the price archive (writePrices); divOf(t) and spyDiv: dividend
// histories read tonight ({ asOf, div } or null), used before the archive's
export function updateRecord({ dir, date, built, rows, signals = null, closesOf = () => null, spy = null, url = null, tonight = null, divOf = () => null, spyDiv = null }) {
  const daysDir = path.join(dir, 'days');
  const stateDir = path.join(dir, 'state');
  const files = listDays(dir);
  const texts = files.map((f) => ({ name: f.name, text: fs.readFileSync(f.file, 'utf8') }));
  const states = fs.existsSync(stateDir) ? fs.readdirSync(stateDir).filter((n) => n.endsWith('.json')).sort() : [];
  const check = (t, s) => { const c = verifyChain(t); return c.ok ? pairCheck(t.map((f) => f.name), s) : c; };
  const before = check(texts, states);
  const prev = states.length ? JSON.parse(fs.readFileSync(path.join(stateDir, states.at(-1)), 'utf8')) : null;
  const seed = prev && !prev.fall ? fallFrom(texts.map((f) => parseDay(f.text))) : null;
  // a hold call's fall is measured on split-adjusted closes: from the close of the buy call's day to the latest one
  const moveOf = (t, since) => {
    const cl = closesOf(t);
    if (!cl || !cl.d || !cl.d.length || !since) return null;
    const i = nextIndex(cl.d, ymdOf(since)) - 1;
    const j = cl.d.length - 1;
    return i >= 0 && j > i && cl.c[i] > 0 && cl.c[j] > 0 ? cl.c[j] / cl.c[i] - 1 : null;
  };
  const { events, next } = dayChange(prev, rows, signals, date, seed, moveOf);
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
      calls.push({ date: head.date, built: head.built, e, baseline: !!head.baseline, day: f.name });
    }
  }
  const chain = check(texts, states);
  // the calls standing on the first day (the starting point), then the calls made after it; a repeat within
  // REPEAT_DAYS of a standing call is not counted again
  const seen = new Map();
  // the record's own archive first gets tonight's prices; it then stands in for any company the sources no longer give
  const archived = writePrices(dir, date, tonight);
  const A = readPrices(dir);
  const series = (t) => { const x = closesOf(t); return x && x.d && x.d.length ? x : A.series.get(t) || null; };
  const divs = (t) => divOf(t) || A.divs.get(t) || null;
  const spyD = spyDiv || A.divs.get('SPY') || null;
  // the yardstick of each day (section 7.1): the companies that passed the halal screen in that day's state file
  const yards = new Map();
  const yardOf = (c) => {
    if (!yards.has(c.day)) {
      let pass = [];
      try {
        const st = JSON.parse(fs.readFileSync(path.join(stateDir, c.day.replace(/\.ndjson$/, '.json')), 'utf8'));
        pass = Object.entries(st.co || {}).filter(([, x]) => x[1] === 'pass' && !x[4]).map(([t]) => t);
      } catch { /* no state for that day: no yardstick for its calls */ }
      yards.set(c.day, pass.length ? yardstick(pass, c.date, c.built, series, spy, divs, spyD) : null);
    }
    return yards.get(c.day);
  };
  const standing = followUp(calls.filter((c) => c.baseline), series, spy, { seen, yardOf, divOf: divs, spyDiv: spyD });
  // the six kinds of call made since the start are the family tested at 12 months (section 7.3); the calls standing on
  // the first day are the starting point, shown but not tested
  const groups = judgeKinds(followUp(calls.filter((c) => !c.baseline), series, spy, { seen, yardOf, divOf: divs, spyDiv: spyD }));
  return {
    version: RECORD_VERSION,
    measures: MEASURES_VERSION,
    previousMeasures: 3,
    thresholds: THRESHOLDS,
    returns: TOTAL_RETURNS ? 'total' : 'price',
    since: texts.length ? parseDay(texts[0].text).head.date : null,
    days: texts.length,
    chain: { ok: chain.ok, at: chain.ok ? null : chain.at, why: chain.ok ? null : chain.why, okBefore: before.ok },
    today,
    kinds,
    prices: !!(spy && spy.d && spy.d.length),
    repeatDays: REPEAT_DAYS,
    archive: { tonight: archived, companies: A.series.size, dividends: A.divs.size },
    groups,
    standing,
    recent: calls.filter((c) => !c.baseline && groupOf(c.e)).slice(-60).reverse().map((c) => ({ d: c.date, t: c.e.t, g: groupOf(c.e), px: c.e.px, v: c.e.v })),
    url,
  };
}
