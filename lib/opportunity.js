// Opportunity tracking (stage 8): keep a scanner idea as it stood the day you added it to the watchlist, and follow what the
// price did afterwards, on paper.
//
// A snapshot copies the scanner's entry, stop and targets and never changes them. The outcome is worked out from the daily
// candles after the snapshot date, so the same snapshot and the same candles always give the same answer. It is practice
// bookkeeping: no order is placed, no money is involved, costs are ignored, and a result here is not a track record (the
// Record page's live signal log is the track record, and it is kept by the nightly build, not by this file).
//
// Long only. Rules, in the order they are applied to each candle after the snapshot date:
//   1. Not yet triggered: the idea triggers when a candle's high reaches the entry price. It fills at the entry price, or at
//      the open when the candle opens above it. If that fill price is above the plan's limit (maxEntry), the candle does not
//      fill (a gap too far above the entry is not chased), and later candles can still fill.
//   2. A candle that reaches the stop before any trigger ends the idea as "failed before entry".
//   3. When one candle both triggers the idea and reaches the stop, the stop is assumed to come first (the cautious reading).
//   4. After the fill, a candle that reaches the stop ends it as "stopped" (at the stop, or at the open when it gaps below);
//      a candle that reaches target 1 ends it as "target 1 reached". If one candle reaches both, the stop counts.
//   5. An idea that has not triggered within 15 sessions of the snapshot date expires.
// R is the paper result in units of the risk taken: (exit or latest close - fill) / (fill - stop), before any costs.
//
// index.html carries the same text between the opportunity.js markers (without the export keywords), and
// test/opportunity.test.mjs fails if the two copies differ in any way. This file imports nothing.
const OPP_VERSION = 1;
const OPP_RULES = Object.freeze({ expireSessions: 15 });
const oppNum = (x) => typeof x === 'number' && Number.isFinite(x);
const oppISO = (s) => typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s);

// The snapshot kept in the watchlist item. c is a scanner row (data/scanner.json). Returns null when anything the tracker
// needs is missing: an idea without an entry, a stop and a target is never tracked.
function oppSnapshot(c, today, scanVersion) {
  if (!c || typeof c.ticker !== 'string' || !oppISO(today) || !oppISO(c.asOf)) return null;
  if (![c.entry, c.stop, c.t1].every(oppNum) || !(c.entry > c.stop) || !(c.t1 > c.entry)) return null;
  return {
    v: OPP_VERSION,
    scanVersion: typeof scanVersion === 'string' ? scanVersion : null,
    setup: String(c.setup || ''),
    added: today,
    asOf: c.asOf,
    entry: c.entry,
    maxEntry: oppNum(c.maxEntry) ? c.maxEntry : null,
    stop: c.stop,
    t1: c.t1,
    t2: oppNum(c.t2) ? c.t2 : null,
    rr1: oppNum(c.rr1) ? c.rr1 : null,
    score: oppNum(c.score) ? c.score : null,
    paper: true,
  };
}

const oppR = (px, fill, stop) => (fill > stop ? Math.round(((px - fill) / (fill - stop)) * 100) / 100 : null);

// candles: [[date, open, high, low, close, volume], ...] oldest first (the chart analysis' candles)
function oppOutcome(opp, candles, rules = OPP_RULES) {
  if (!opp || ![opp.entry, opp.stop, opp.t1].every(oppNum) || !oppISO(opp.asOf)) return { state: 'unknown', label: 'Cannot be followed: the saved setup is incomplete', sessions: 0, R: null };
  const after = (Array.isArray(candles) ? candles : []).filter((c) => Array.isArray(c) && oppISO(c[0]) && c[0] > opp.asOf && [c[1], c[2], c[3], c[4]].every(oppNum));
  if (!after.length) return { state: 'waiting', label: `Waiting for entry: buy above $${opp.entry.toFixed(2)}`, sessions: 0, R: null };
  let fill = null;
  let fillDate = null;
  for (let i = 0; i < after.length; i++) {
    const [date, open, high, low, close] = after[i];
    const n = i + 1;
    if (fill === null) {
      const reached = high >= opp.entry;
      const px = Math.max(opp.entry, open);
      const tooFar = oppNum(opp.maxEntry) && px > opp.maxEntry;
      if (reached && !tooFar) {
        fill = px;
        fillDate = date;
        if (low <= opp.stop) return { state: 'stopped', label: `Stop hit on ${date}`, sessions: n, fill, fillDate, exitDate: date, exit: Math.min(opp.stop, open), R: oppR(Math.min(opp.stop, open), fill, opp.stop) };
        if (high >= opp.t1) {
          // the same candle triggered it and reached target 1, and the stop was not reached: target 1 reached
          const ex = Math.max(opp.t1, open);
          return { state: 'target1', label: `Target 1 reached on ${date}`, sessions: n, fill, fillDate, exitDate: date, exit: ex, R: oppR(ex, fill, opp.stop) };
        }
        continue;
      }
      if (low <= opp.stop) return { state: 'invalidated', label: `Failed before entry: price fell to the stop on ${date}`, sessions: n, R: null };
      if (n >= rules.expireSessions) return { state: 'expired', label: `Expired: not triggered within ${rules.expireSessions} sessions`, sessions: n, R: null };
      continue;
    }
    if (low <= opp.stop) {
      const ex = Math.min(opp.stop, open);
      return { state: 'stopped', label: `Stop hit on ${date}`, sessions: n, fill, fillDate, exitDate: date, exit: ex, R: oppR(ex, fill, opp.stop) };
    }
    if (high >= opp.t1) {
      const ex = Math.max(opp.t1, open);
      return { state: 'target1', label: `Target 1 reached on ${date}`, sessions: n, fill, fillDate, exitDate: date, exit: ex, R: oppR(ex, fill, opp.stop) };
    }
  }
  const last = after[after.length - 1];
  if (fill === null) return { state: 'waiting', label: `Waiting for entry: buy above $${opp.entry.toFixed(2)}`, sessions: after.length, R: null };
  const R = oppR(last[4], fill, opp.stop);
  return { state: 'triggered', label: `Triggered on ${fillDate}, still open on paper (${R >= 0 ? '+' : ''}${R.toFixed(2)}R at the ${last[0]} close)`, sessions: after.length, fill, fillDate, R };
}

export { OPP_VERSION, OPP_RULES, oppSnapshot, oppOutcome };
