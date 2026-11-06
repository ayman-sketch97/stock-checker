// Tests for the Shariah compliance ledger (stage 4): the 90-day dates, status changes, missing and stale data, the
// append-only history and its tamper checks, joining two copies, and that purification is stored but never calculated.
// Run: node --test test/shariah-ledger.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createHash } from 'node:crypto';
import * as L from '../lib/shariah-ledger.js';

const NOW = '2026-11-06T10:00:00.000Z';
const eq = assert.deepEqual;
const flagCodes = (s) => s.flags.map((f) => f.code);
const hasFlag = (s, code, level) => s.flags.some((f) => f.code === code && (!level || f.level === level));

// add entries one by one; every one must be accepted unless the caller says otherwise
function build(list, today = '2026-11-06') {
  let entries = [];
  for (const f of list) {
    const r = L.appendEntry(entries, f, today, NOW);
    assert.ok(r.ok, `entry refused: ${JSON.stringify(f)} -> ${r.errors.join('; ')}`);
    entries = r.entries;
  }
  return entries;
}
const chk = (t, status, checked, extra = {}) => ({ kind: 'check', t, status, checked, source: 'zoya_app', evidence: `Zoya screen on ${checked}`, ...extra });
const state = (entries, t, today, held = true) => L.holdingState(entries, t, today, held);
// an independent way to add days (Date.UTC arithmetic), so the tests do not just repeat the code under test
const plusDays = (d, n) => { const [y, m, dd] = d.split('-').map(Number); const x = new Date(Date.UTC(y, m - 1, dd)); x.setUTCDate(x.getUTCDate() + n); return x.toISOString().slice(0, 10); };

test('SHA-256 matches Node for every length around the block boundaries, and for non-ASCII text', () => {
  const cases = [];
  for (let n = 0; n <= 200; n++) cases.push('x'.repeat(n));
  cases.push('abc', 'héllo ✓ 日本語 '.repeat(30), JSON.stringify({ a: 1, b: [1, 2, 3] }));
  for (const s of cases) assert.equal(L.sha256Hex(s), createHash('sha256').update(s).digest('hex'), `length ${s.length}`);
});

test('dates: real calendar dates only, and adding days crosses months, years and leap days', () => {
  assert.ok(L.isDateISO('2026-11-06') && L.isDateISO('2028-02-29'));
  for (const bad of ['2026-02-30', '2027-02-29', '2026-13-01', '2026-1-1', '', null, undefined, 20261106, '2026-11-06T00:00:00Z']) assert.equal(L.isDateISO(bad), false, String(bad));
  assert.equal(L.addDaysISO('2026-01-01', 90), '2026-04-01');
  assert.equal(L.addDaysISO('2027-12-01', 90), '2028-02-29');
  assert.equal(L.addDaysISO('2026-11-06', 90), '2027-02-04');
  assert.equal(L.daysBetweenISO('2026-11-06', '2027-02-04'), 90);
  assert.equal(L.daysBetweenISO('2026-11-06', '2026-11-05'), -1);
});

test('the exit deadline is exactly 90 days from the status-change date, in every calendar situation', () => {
  const dates = ['2026-01-01', '2026-05-31', '2026-10-15', '2026-11-06', '2027-12-01', '2027-11-30', '2028-01-15', '2026-12-31', '2028-03-01', '2029-12-31'];
  for (const d of dates) {
    const e = build([chk('AAA', 'compliant', plusDays(d, -20)), chk('AAA', 'non_compliant', d)], '2030-01-01');
    const s = state(e, 'AAA', d);
    assert.equal(s.run.changeDate, d);
    assert.equal(s.run.deadline, plusDays(d, 90), `deadline for ${d}`);
    assert.equal(s.run.daysLeft, 90);
  }
  assert.equal(plusDays('2027-12-01', 90), '2028-02-29', 'the independent date arithmetic agrees about the leap day');
});

test('the deadline counts from the change date Zoya shows, not from the day you checked', () => {
  const e = build([chk('AAA', 'compliant', '2026-08-01'), chk('AAA', 'non_compliant', '2026-11-05', { changeDate: '2026-10-01' })]);
  const s = state(e, 'AAA', '2026-11-06');
  assert.equal(s.run.changeDate, '2026-10-01');
  assert.equal(s.run.deadline, plusDays('2026-10-01', 90));
  assert.equal(s.run.daysLeft, L.daysBetweenISO('2026-11-06', s.run.deadline));
  // with no change date the check date is the date the change was seen
  const e2 = build([chk('AAA', 'compliant', '2026-08-01'), chk('AAA', 'non_compliant', '2026-11-05')]);
  assert.equal(state(e2, 'AAA', '2026-11-06').run.deadline, plusDays('2026-11-05', 90));
});

test('deadline day by day: 90 days left, the last day, and overdue the day after', () => {
  const e = build([chk('AAA', 'compliant', '2026-06-01'), chk('AAA', 'non_compliant', '2026-07-01')], '2026-11-06');
  const dl = plusDays('2026-07-01', 90); // 2026-09-29
  const at = (today) => state(e, 'AAA', today);
  assert.equal(at('2026-07-01').run.daysLeft, 90);
  assert.equal(at(dl).run.daysLeft, 0);
  assert.ok(hasFlag(at(dl), 'exit_open', 'bad'), 'on the last day it is still open, and urgent');
  assert.ok(!hasFlag(at(dl), 'exit_overdue'));
  assert.equal(at(plusDays(dl, 1)).run.daysLeft, -1);
  assert.ok(hasFlag(at(plusDays(dl, 1)), 'exit_overdue', 'bad'));
  assert.ok(!hasFlag(at(plusDays(dl, -20)), 'exit_open', 'bad') || at(plusDays(dl, -20)).run.daysLeft <= 14, 'urgent only inside 14 days');
  assert.ok(hasFlag(at(plusDays(dl, -30)), 'exit_open', 'warn'));
});

test('recheck every 90 days after the last Zoya check, with the boundaries exact', () => {
  const e = build([chk('AAA', 'compliant', '2026-08-01')]);
  const due = plusDays('2026-08-01', 90);
  const at = (days) => state(e, 'AAA', plusDays(due, days));
  assert.equal(at(0).recheckDue, due);
  assert.equal(at(-30).recheck, 'ok');
  assert.equal(at(-15).recheck, 'ok');
  assert.equal(at(-14).recheck, 'due_soon');
  assert.equal(at(-1).recheck, 'due_soon');
  assert.equal(at(0).recheck, 'due_soon');
  assert.ok(flagCodes(at(0)).includes('due_soon'));
  assert.equal(at(1).recheck, 'overdue');
  assert.ok(hasFlag(at(1), 'stale', 'bad'));
  assert.equal(at(1).worst, 'bad');
});

test('a fresh check restarts the 90-day clock', () => {
  const e = build([chk('AAA', 'compliant', '2026-05-01'), chk('AAA', 'compliant', '2026-10-20')]);
  const s = state(e, 'AAA', '2026-11-06');
  assert.equal(s.recheckDue, plusDays('2026-10-20', 90));
  assert.equal(s.recheck, 'ok');
});

test('compliant to non-compliant is detected, and only a Zoya check can cause it', () => {
  const e = build([chk('AAA', 'compliant', '2026-08-01'), chk('AAA', 'non_compliant', '2026-10-30')]);
  const s = state(e, 'AAA', '2026-11-06');
  assert.equal(s.transitions.length, 1);
  eq([s.transitions[0].from, s.transitions[0].to], ['compliant', 'non_compliant']);
  assert.ok(hasFlag(s, 'transition', 'bad'));
  assert.equal(s.run.fromCompliant, true);
  // the same change from a source that is not Zoya is kept but does nothing
  const e2 = build([chk('BBB', 'compliant', '2026-08-01'), chk('BBB', 'non_compliant', '2026-10-30', { source: 'other' })]);
  const s2 = state(e2, 'BBB', '2026-11-06');
  assert.equal(s2.run, null);
  assert.equal(s2.transitions.length, 0);
  assert.ok(hasFlag(s2, 'unconfirmed_latest', 'warn'));
  assert.match(s2.headline, /^Unconfirmed/);
});

test('questionable neither opens nor closes an exit period, but a move from compliant is flagged', () => {
  const e = build([chk('AAA', 'compliant', '2026-08-01'), chk('AAA', 'questionable', '2026-09-15')]);
  const s = state(e, 'AAA', '2026-11-06');
  assert.equal(s.run, null);
  assert.equal(s.transitions[0].to, 'questionable');
  assert.ok(hasFlag(s, 'uncertain', 'warn') && hasFlag(s, 'transition', 'warn'));
  // inside an open period, a questionable check does not stop the clock
  const e2 = build([chk('AAA', 'compliant', '2026-06-01'), chk('AAA', 'non_compliant', '2026-07-01'), chk('AAA', 'questionable', '2026-08-01')]);
  const s2 = state(e2, 'AAA', '2026-11-06');
  assert.equal(s2.run.deadline, plusDays('2026-07-01', 90));
  // and a second non-compliant check does not move the deadline
  const e3 = build([chk('AAA', 'compliant', '2026-06-01'), chk('AAA', 'non_compliant', '2026-07-01'), chk('AAA', 'non_compliant', '2026-10-01')]);
  assert.equal(state(e3, 'AAA', '2026-11-06').run.deadline, plusDays('2026-07-01', 90));
});

test('a first record of non-compliant has no deadline unless the change date is given: never guessed', () => {
  const e = build([chk('AAA', 'non_compliant', '2026-10-01')]);
  const s = state(e, 'AAA', '2026-11-06');
  assert.ok(s.run);
  assert.equal(s.run.deadline, null);
  assert.equal(s.run.changeDate, null);
  assert.ok(hasFlag(s, 'no_change_date', 'bad'));
  assert.equal(s.transitions.length, 0);
  const e2 = build([chk('AAA', 'non_compliant', '2026-10-01', { changeDate: '2026-09-10' })]);
  const s2 = state(e2, 'AAA', '2026-11-06');
  assert.equal(s2.run.deadline, plusDays('2026-09-10', 90));
  assert.ok(!hasFlag(s2, 'no_change_date'));
  // a later check that supplies the date fills it in, once
  const e3 = build([chk('AAA', 'non_compliant', '2026-10-01'), chk('AAA', 'non_compliant', '2026-10-20', { changeDate: '2026-09-10' })]);
  assert.equal(state(e3, 'AAA', '2026-11-06').run.deadline, plusDays('2026-09-10', 90));
});

test('back to compliant closes the period; the old deadline stays in the history; a later change opens a new one', () => {
  const e = build([chk('AAA', 'compliant', '2026-01-10'), chk('AAA', 'non_compliant', '2026-02-01'), chk('AAA', 'compliant', '2026-03-01'), chk('AAA', 'non_compliant', '2026-09-01')]);
  const s = state(e, 'AAA', '2026-11-06');
  assert.equal(s.runs.length, 2);
  assert.ok(s.runs[0].closed);
  assert.equal(s.runs[0].deadline, plusDays('2026-02-01', 90));
  assert.equal(s.run.deadline, plusDays('2026-09-01', 90));
  assert.equal(s.transitions.length, 2);
  const e2 = build([chk('AAA', 'compliant', '2026-01-10'), chk('AAA', 'non_compliant', '2026-02-01'), chk('AAA', 'compliant', '2026-03-01')]);
  const s2 = state(e2, 'AAA', '2026-11-06');
  assert.equal(s2.run, null);
  assert.ok(hasFlag(s2, 'back_to_compliant', 'info'));
  assert.equal(s2.history.length, 3, 'nothing was removed');
});

test('a check entered late for an earlier date does not become the current status', () => {
  const e = build([chk('AAA', 'compliant', '2026-10-20'), chk('AAA', 'non_compliant', '2026-09-01')]);
  const s = state(e, 'AAA', '2026-11-06');
  assert.equal(s.status, 'compliant');
  assert.equal(s.lastZoyaCheck.checked, '2026-10-20');
  assert.ok(hasFlag(s, 'backdated', 'info'));
  // it still happened: the earlier non-compliant date opened and the later compliant check closed a period
  assert.equal(s.runs.length, 1);
  assert.ok(s.runs[0].closed);
});

test('exit tracking: steps, dates, completion before or after the deadline, and refusals', () => {
  let e = build([chk('AAA', 'compliant', '2026-08-01'), chk('AAA', 'non_compliant', '2026-10-01')]);
  assert.equal(state(e, 'AAA', '2026-11-06').run.exitStatus, 'not_started');
  const x1 = L.appendEntry(e, { kind: 'exit', t: 'AAA', exitStatus: 'in_progress', on: '2026-10-10', note: 'order placed' }, '2026-11-06', NOW);
  assert.ok(x1.ok); e = x1.entries;
  let s = state(e, 'AAA', '2026-11-06');
  eq([s.run.exitStatus, s.run.exitDate, s.run.exitNote], ['in_progress', '2026-10-10', 'order placed']);
  const x2 = L.appendEntry(e, { kind: 'exit', t: 'AAA', exitStatus: 'completed', on: '2026-10-20' }, '2026-11-06', NOW);
  assert.ok(x2.ok); e = x2.entries;
  s = state(e, 'AAA', '2026-11-06', false);
  assert.equal(s.run.exitStatus, 'completed');
  assert.ok(hasFlag(s, 'exit_done', 'ok'));
  assert.ok(!flagCodes(s).includes('stale') && !flagCodes(s).includes('missing'), 'a sold stock needs no more rechecks');
  // nothing more can be added after completion
  assert.equal(L.appendEntry(e, { kind: 'exit', t: 'AAA', exitStatus: 'in_progress', on: '2026-10-25' }, '2026-11-06', NOW).ok, false);
  // marked completed but still held
  assert.ok(hasFlag(state(e, 'AAA', '2026-11-06', true), 'still_held', 'warn'));
  // completed after the deadline is recorded as late
  let late = build([chk('BBB', 'compliant', '2026-01-01'), chk('BBB', 'non_compliant', '2026-02-01')]);
  late = L.appendEntry(late, { kind: 'exit', t: 'BBB', exitStatus: 'completed', on: plusDays('2026-02-01', 95) }, '2026-11-06', NOW).entries;
  assert.ok(hasFlag(state(late, 'BBB', '2026-11-06', false), 'exit_done', 'warn'));
});

test('exit entries are refused when there is nothing to exit, when dated before the change, or in the future', () => {
  const none = build([chk('AAA', 'compliant', '2026-08-01')]);
  assert.equal(L.appendEntry(none, { kind: 'exit', t: 'AAA', exitStatus: 'in_progress', on: '2026-11-01' }, '2026-11-06', NOW).ok, false);
  assert.equal(L.appendEntry([], { kind: 'exit', t: 'AAA', exitStatus: 'in_progress', on: '2026-11-01' }, '2026-11-06', NOW).ok, false);
  const e = build([chk('AAA', 'compliant', '2026-08-01'), chk('AAA', 'non_compliant', '2026-10-01')]);
  assert.equal(L.appendEntry(e, { kind: 'exit', t: 'AAA', exitStatus: 'in_progress', on: '2026-09-30' }, '2026-11-06', NOW).ok, false);
  assert.equal(L.appendEntry(e, { kind: 'exit', t: 'AAA', exitStatus: 'in_progress', on: '2026-11-07' }, '2026-11-06', NOW).ok, false);
  assert.equal(L.appendEntry(e, { kind: 'exit', t: 'AAA', exitStatus: 'sold', on: '2026-11-01' }, '2026-11-06', NOW).ok, false);
});

test('missing data is flagged: no record, nothing from Zoya, stale, questionable', () => {
  // a holding with no record
  const v = L.ledgerView([], ['AAA', 'BBB'], '2026-11-06');
  assert.equal(v.summary.held, 2);
  assert.equal(v.summary.bad, 2);
  for (const r of v.rows) { assert.equal(r.status, 'none'); assert.equal(r.headline, 'Not recorded'); assert.ok(hasFlag(r, 'missing', 'bad')); }
  // a record, but not from Zoya
  const e = build([chk('AAA', 'compliant', '2026-10-01', { source: 'other' })]);
  const s = state(e, 'AAA', '2026-11-06');
  assert.ok(hasFlag(s, 'no_zoya', 'bad'));
  assert.equal(s.confirmed, false);
  assert.match(s.headline, /Unconfirmed/);
  assert.equal(s.recheckDue, null);
  // stale
  const old = build([chk('AAA', 'compliant', '2026-05-01')]);
  assert.ok(hasFlag(state(old, 'AAA', '2026-11-06'), 'stale', 'bad'));
  // questionable on Zoya
  const q = build([chk('AAA', 'questionable', '2026-10-30')]);
  const sq = state(q, 'AAA', '2026-11-06');
  assert.ok(hasFlag(sq, 'uncertain', 'warn'));
  assert.equal(sq.headline, 'Questionable on Zoya');
  // a ticker you do not hold and never recorded is not flagged as missing
  assert.equal(state([], 'ZZZ', '2026-11-06', false).flags.length, 0);
});

test('the view sorts the worst first and counts only what you hold', () => {
  const e = build([chk('OK1', 'compliant', '2026-10-20'), chk('OLD', 'compliant', '2026-04-01'), chk('GONE', 'compliant', '2026-01-01')]);
  const v = L.ledgerView(e, ['OK1', 'OLD', 'NEW1'], '2026-11-06');
  eq(v.rows.map((r) => r.t).slice(0, 2).sort(), ['NEW1', 'OLD']);
  assert.equal(v.rows.at(-1).t === 'GONE' || v.rows.at(-1).t === 'OK1', true);
  eq([v.summary.held, v.summary.bad, v.summary.ok], [3, 2, 1]);
  assert.ok(v.rows.some((r) => r.t === 'GONE' && !r.held), 'an old ticker with entries stays listed, not held');
});

test('entries are validated: evidence, source, status, dates, tickers, and the change date rules', () => {
  const ok = chk('AAA', 'compliant', '2026-10-01');
  const bad = (patch, why) => assert.equal(L.appendEntry([], { ...ok, ...patch }, '2026-11-06', NOW).ok, false, why);
  assert.equal(L.appendEntry([], ok, '2026-11-06', NOW).ok, true);
  bad({ evidence: '' }, 'evidence required');
  bad({ evidence: '   ' }, 'blank evidence');
  bad({ evidence: 'x'.repeat(601) }, 'evidence too long');
  bad({ source: 'zoya' }, 'unknown source');
  bad({ source: undefined }, 'no source');
  bad({ status: 'halal' }, 'unknown status');
  bad({ checked: '2026-02-30' }, 'not a date');
  bad({ checked: '2026-11-07' }, 'future date');
  bad({ t: '' }, 'no ticker');
  bad({ t: 'A B' }, 'bad ticker');
  bad({ kind: 'trade' }, 'bad kind');
  bad({ changeDate: '2026-09-01' }, 'change date only with non_compliant');
  bad({ status: 'non_compliant', changeDate: '2026-10-02' }, 'change date after the check');
  bad({ status: 'non_compliant', changeDate: '2026-11-30', checked: '2026-10-01' }, 'change date in the future');
  bad({ extra: 1 }, 'unknown field');
  // a ticker is stored in capitals and the text is trimmed
  const r = L.appendEntry([], { ...ok, t: ' aapl ', evidence: '  seen  ' }, '2026-11-06', NOW);
  eq([r.entry.t, r.entry.evidence], ['AAPL', 'seen']);
});

test('append-only: adding never changes the list passed in, and corrections strike an entry through without removing it', () => {
  const e0 = build([chk('AAA', 'compliant', '2026-08-01'), chk('AAA', 'non_compliant', '2026-10-01')]);
  const frozen = JSON.stringify(e0);
  Object.freeze(e0); e0.forEach(Object.freeze);
  const r = L.appendEntry(e0, { kind: 'correction', t: 'AAA', fixes: 1, note: 'typed the wrong status' }, '2026-11-06', NOW);
  assert.ok(r.ok);
  assert.equal(JSON.stringify(e0), frozen);
  assert.equal(r.entries.length, 3);
  eq(r.entries.slice(0, 2), e0);
  const s = state(r.entries, 'AAA', '2026-11-06');
  assert.equal(s.run, null, 'the voided non-compliant check no longer counts');
  assert.equal(s.transitions.length, 0);
  assert.equal(s.status, 'compliant');
  const h = s.history.find((x) => x.n === 1);
  assert.equal(h.voided, true);
  assert.equal(h.status, 'non_compliant', 'what was written is still readable');
  assert.ok(L.verifyLedger(r.entries).ok);
});

test('corrections: a reason is required, and not for a missing entry, another ticker, a correction, or an entry already struck', () => {
  const e = build([chk('AAA', 'compliant', '2026-08-01'), chk('BBB', 'compliant', '2026-08-01')]);
  const c = (patch) => L.appendEntry(e, { kind: 'correction', t: 'AAA', fixes: 0, note: 'typo', ...patch }, '2026-11-06', NOW);
  assert.ok(c({}).ok);
  assert.equal(c({ note: '' }).ok, false);
  assert.equal(c({ fixes: 9 }).ok, false);
  assert.equal(c({ fixes: 1 }).ok, false, 'entry 1 belongs to BBB');
  assert.equal(c({ fixes: -1 }).ok, false);
  const e2 = c({}).entries;
  assert.equal(L.appendEntry(e2, { kind: 'correction', t: 'AAA', fixes: 0, note: 'again' }, '2026-11-06', NOW).ok, false, 'already struck');
  assert.equal(L.appendEntry(e2, { kind: 'correction', t: 'AAA', fixes: 2, note: 'undo' }, '2026-11-06', NOW).ok, false, 'a correction cannot be corrected');
});

function sample() {
  return build([chk('AAA', 'compliant', '2026-05-01'), chk('BBB', 'compliant', '2026-06-01'), chk('AAA', 'non_compliant', '2026-09-01'),
    { kind: 'exit', t: 'AAA', exitStatus: 'in_progress', on: '2026-09-10' }, chk('BBB', 'questionable', '2026-10-01'), chk('AAA', 'compliant', '2026-10-15'),
    { kind: 'correction', t: 'BBB', fixes: 4, note: 'wrong stock' }, chk('CCC', 'compliant', '2026-10-20')]);
}

test('history integrity: an untouched ledger passes and each kind of tampering is caught', () => {
  const e = sample();
  const v = L.verifyLedger(e, '2026-11-06');
  assert.ok(v.ok, v.problems.join('; '));
  assert.equal(v.count, 8);
  const clone = () => JSON.parse(JSON.stringify(e));
  // 1. a field changed
  let t = clone(); t[2].status = 'compliant';
  assert.equal(L.verifyLedger(t).ok, false, 'edited status');
  t = clone(); t[0].evidence = 'something else';
  assert.equal(L.verifyLedger(t).ok, false, 'edited evidence');
  t = clone(); t[3].on = '2026-10-30';
  assert.equal(L.verifyLedger(t).ok, false, 'edited exit date');
  // 2. an entry removed from the middle
  t = clone(); t.splice(3, 1);
  assert.equal(L.verifyLedger(t).ok, false, 'removed entry');
  // 3. two entries swapped
  t = clone(); [t[1], t[2]] = [t[2], t[1]];
  assert.equal(L.verifyLedger(t).ok, false, 'reordered');
  // 4. an entry inserted
  t = clone(); t.splice(2, 0, { ...t[1] });
  assert.equal(L.verifyLedger(t).ok, false, 'inserted copy');
  // 5. the first entry removed
  t = clone(); t.shift();
  assert.equal(L.verifyLedger(t).ok, false, 'first removed');
  // 6. a hash edited to hide a change
  t = clone(); t[2].status = 'compliant'; t[2].hash = 'f'.repeat(64);
  assert.equal(L.verifyLedger(t).ok, false, 'forged hash');
  // 7. a field added
  t = clone(); t[1].secret = 1;
  assert.equal(L.verifyLedger(t).ok, false, 'extra field');
  // 8. not a list
  assert.equal(L.verifyLedger(null).ok, false);
  assert.equal(L.verifyLedger({}).ok, false);
  // a future-dated entry (checked against today)
  const fut = JSON.parse(JSON.stringify(e)); fut[7].checked = '2027-01-01';
  assert.equal(L.verifyLedger(fut, '2026-11-06').ok, false);
});

test('cutting entries off the end leaves a valid chain, so the anchor is what shows it', () => {
  const e = sample();
  const anchor = L.anchorOf(e);
  assert.equal(anchor.count, 8);
  assert.ok(L.checkAnchor(e, anchor).ok);
  const cut = e.slice(0, 6);
  assert.ok(L.verifyLedger(cut).ok, 'a shorter chain is still a valid chain');
  const c = L.checkAnchor(cut, anchor);
  assert.equal(c.ok, false);
  assert.match(c.note, /removed/);
  // the same history rewritten from entry 3 on, with every hash recomputed, is caught by the anchor too
  let w = e.slice(0, 3);
  w = L.appendEntry(w, chk('AAA', 'compliant', '2026-09-02'), '2026-11-06', NOW).entries;
  while (w.length < 8) w = L.appendEntry(w, chk('CCC', 'compliant', '2026-10-20'), '2026-11-06', NOW).entries;
  assert.ok(L.verifyLedger(w).ok, 'a fully re-hashed chain looks valid on its own');
  assert.equal(L.checkAnchor(w, anchor).ok, false, 'but it is not the history that was anchored');
  assert.ok(L.checkAnchor(e, null).ok);
  assert.equal(L.checkAnchor(e, { count: -1, head: 'x' }).ok, false);
  assert.ok(L.checkAnchor([], L.anchorOf([])).ok);
});

test('nothing can be added to a ledger that fails its own check', () => {
  const t = JSON.parse(JSON.stringify(sample())); t[1].status = 'questionable';
  const r = L.appendEntry(t, chk('AAA', 'compliant', '2026-11-01'), '2026-11-06', NOW);
  assert.equal(r.ok, false);
  assert.match(r.errors.join(' '), /integrity/);
  assert.equal(r.entries, t);
});

test('every entry links to the one before and the first starts from the fixed genesis value', () => {
  const e = sample();
  assert.equal(e[0].prev, L.LEDGER_GENESIS);
  for (let i = 1; i < e.length; i++) assert.equal(e[i].prev, e[i - 1].hash);
  e.forEach((x, i) => assert.equal(x.n, i));
  assert.equal(new Set(e.map((x) => x.hash)).size, e.length);
  // the same fields give the same hash, a different one gives a different hash
  const a = build([chk('AAA', 'compliant', '2026-08-01')]);
  const b = build([chk('AAA', 'compliant', '2026-08-01')]);
  assert.equal(a[0].hash, b[0].hash);
  const c = build([chk('AAA', 'compliant', '2026-08-02')]);
  assert.notEqual(a[0].hash, c[0].hash);
});

test('joining two copies: the same, ahead, behind, split, again, and refused when either is damaged', () => {
  const base = build([chk('AAA', 'compliant', '2026-08-01'), chk('AAA', 'non_compliant', '2026-10-01')]);
  const phone = L.appendEntry(base, { kind: 'exit', t: 'AAA', exitStatus: 'in_progress', on: '2026-10-05' }, '2026-11-06', NOW).entries;
  const ipad = L.appendEntry(base, chk('BBB', 'compliant', '2026-10-06'), '2026-11-06', '2026-11-06T11:00:00.000Z').entries;
  // same
  let m = L.mergeLedgers(base, base);
  assert.ok(m.ok && m.added === 0 && m.entries === base);
  // incoming extends
  m = L.mergeLedgers(base, phone);
  assert.ok(m.ok && m.added === 1);
  eq(m.entries, phone);
  // incoming is behind
  m = L.mergeLedgers(phone, base);
  assert.ok(m.ok && m.added === 0);
  assert.equal(m.entries, phone);
  // into an empty device
  m = L.mergeLedgers([], phone);
  assert.ok(m.ok && m.added === 3);
  eq(m.entries, phone);
  // a split: both keep what they had; the other device's entries are added after, marked with where they came from
  m = L.mergeLedgers(phone, ipad);
  assert.ok(m.ok && m.added === 1, m.note);
  assert.equal(m.entries.length, 4);
  eq(m.entries.slice(0, 3), phone, 'nothing on this device changed');
  assert.deepEqual(m.entries[3].origin, { n: 2, hash: ipad[2].hash });
  assert.ok(L.verifyLedger(m.entries).ok);
  assert.equal(state(m.entries, 'BBB', '2026-11-06').status, 'compliant');
  // the same backup again changes nothing
  const again = L.mergeLedgers(m.entries, ipad);
  assert.ok(again.ok && again.added === 0);
  assert.equal(again.entries.length, 4);
  // and the other direction reaches the same facts
  const rev = L.mergeLedgers(ipad, phone);
  assert.ok(rev.ok && rev.added === 1);
  const facts = (es) => es.map((x) => [x.kind, x.t, x.status || x.exitStatus, x.checked || x.on]).sort().join('|');
  assert.equal(facts(rev.entries), facts(m.entries));
  // refused when damaged
  const dmg = JSON.parse(JSON.stringify(ipad)); dmg[1].status = 'compliant';
  assert.equal(L.mergeLedgers(phone, dmg).ok, false);
  assert.equal(L.mergeLedgers(dmg, phone).ok, false);
});

test('joining keeps corrections pointing at the right entry after a split', () => {
  const base = build([chk('AAA', 'compliant', '2026-08-01')]);
  const a = L.appendEntry(base, chk('AAA', 'non_compliant', '2026-10-01'), '2026-11-06', NOW).entries; // n1 on device A
  const b0 = L.appendEntry(base, chk('BBB', 'compliant', '2026-10-02'), '2026-11-06', NOW).entries; // n1 on device B
  const b = L.appendEntry(b0, { kind: 'correction', t: 'BBB', fixes: 1, note: 'wrong stock' }, '2026-11-06', NOW).entries; // n2 voids n1
  const m = L.mergeLedgers(a, b);
  assert.ok(m.ok && m.added === 2, m.note);
  assert.ok(L.verifyLedger(m.entries).ok);
  const corr = m.entries[3];
  assert.equal(corr.kind, 'correction');
  assert.equal(corr.fixes, 2, 'it points at BBB’s check, which is now entry 2, not at AAA’s entry 1');
  assert.equal(state(m.entries, 'AAA', '2026-11-06').run.deadline, plusDays('2026-10-01', 90), 'AAA is untouched');
  assert.equal(state(m.entries, 'BBB', '2026-11-06').status, 'none');
});

test('purification is stored but never calculated, and it cannot change a compliance result', () => {
  assert.equal(L.PURIFICATION.active, false);
  assert.match(L.PURIFICATION.message, /inactive/i);
  assert.match(L.PURIFICATION.message, /qualified Shariah scholar/);
  const names = Object.keys(L).join(' ').toLowerCase();
  assert.ok(!/calc|estimat|formula|percent|rate/.test(names.replace('rules', '')), 'no purification function is exported: ' + names);
  const src = fs.readFileSync(new URL('../lib/shariah-ledger.js', import.meta.url), 'utf8');
  assert.ok(!/^import /m.test(src), 'the ledger imports nothing: it cannot reach the engine, the signals or the policy');
  const code = src.split('\n').filter((l) => !l.trim().startsWith('//')).join('\n');
  assert.ok(!/interest|impure|dividend/i.test(code), 'no purification inputs are read');
  // an amount needs a basis, a positive number, a currency and a real date
  const p = (patch) => L.appendEntry([], { kind: 'purification', t: 'AAA', action: 'due', amount: 12.5, currency: 'USD', asOf: '2026-11-01', basis: 'Scholar X, email of 1 Nov', ...patch }, '2026-11-06', NOW);
  assert.ok(p({}).ok);
  for (const patch of [{ basis: '' }, { amount: 0 }, { amount: -1 }, { amount: NaN }, { amount: '12' }, { currency: 'usd1' }, { currency: '' }, { asOf: '2026-12-01' }, { action: 'estimate' }]) assert.equal(p(patch).ok, false, JSON.stringify(patch));
  // recorded amounts are only listed and added up as entered
  let e = p({}).entries;
  e = L.appendEntry(e, { kind: 'purification', t: 'AAA', action: 'paid', amount: 5, currency: 'USD', asOf: '2026-11-02', basis: 'Paid to charity Y' }, '2026-11-06', NOW).entries;
  e = L.appendEntry(e, { kind: 'purification', t: 'AAA', action: 'due', amount: 3.25, currency: 'AED', asOf: '2026-11-03', basis: 'Scholar X' }, '2026-11-06', NOW).entries;
  const pr = L.purificationRecords(e);
  assert.equal(pr.active, false);
  eq(pr.enteredTotals, { due: { USD: 12.5, AED: 3.25 }, paid: { USD: 5 } });
  // they change nothing in the compliance state
  const withOnly = state(e, 'AAA', '2026-11-06');
  assert.equal(withOnly.status, 'none');
  assert.ok(hasFlag(withOnly, 'missing') || !withOnly.lastCheck);
  const checks = build([chk('AAA', 'compliant', '2026-10-20')]);
  const both = L.appendEntry(checks, { kind: 'purification', t: 'AAA', action: 'due', amount: 9, currency: 'USD', asOf: '2026-11-01', basis: 'Scholar X' }, '2026-11-06', NOW).entries;
  const s1 = state(checks, 'AAA', '2026-11-06'); const s2 = state(both, 'AAA', '2026-11-06');
  eq([s2.status, s2.headline, s2.recheckDue, flagCodes(s2)], [s1.status, s1.headline, s1.recheckDue, flagCodes(s1)]);
  // a struck-through amount no longer counts
  const voided = L.appendEntry(both, { kind: 'correction', t: 'AAA', fixes: 1, note: 'wrong amount' }, '2026-11-06', NOW).entries;
  eq(L.purificationRecords(voided).enteredTotals, {});
  assert.equal(L.ledgerView(e, ['AAA'], '2026-11-06').purification.active, false);
});

test('Zoya stays the authority: with no Zoya entry nothing is ever shown as compliant', () => {
  const none = state([], 'AAA', '2026-11-06');
  assert.equal(none.status, 'none');
  const notZoya = build([chk('AAA', 'compliant', '2026-10-20', { source: 'other' })]);
  const s = state(notZoya, 'AAA', '2026-11-06');
  assert.doesNotMatch(s.headline, /^Recorded as compliant/);
  assert.equal(s.confirmed, false);
  // every "compliant" headline names Zoya
  const z = state(build([chk('AAA', 'compliant', '2026-10-20')]), 'AAA', '2026-11-06');
  assert.match(z.headline, /on Zoya/);
  assert.equal(z.confirmed, true);
  // all the words the ledger shows for a stock, on every path, avoid claiming compliance on its own
  const texts = [];
  for (const list of [[], [chk('A', 'compliant', '2026-10-20')], [chk('A', 'compliant', '2026-10-20', { source: 'other' })], [chk('A', 'questionable', '2026-10-20')], [chk('A', 'non_compliant', '2026-10-20')], [chk('A', 'compliant', '2026-05-01'), chk('A', 'non_compliant', '2026-10-20')]]) {
    const st = state(build(list), 'A', '2026-11-06'); texts.push(st.headline, ...st.flags.map((f) => f.text));
  }
  for (const t of texts) assert.ok(!/\b(is|are) (shariah |halal )?compliant\b|\bhalal\b|\bpermissible\b/i.test(t), `claims compliance: ${t}`);
});

test('the page carries exactly the same ledger rules as lib/shariah-ledger.js', () => {
  const page = fs.readFileSync(new URL('../index.html', import.meta.url), 'utf8');
  const a = page.indexOf('// ---- shariah-ledger.js (start)');
  const b = page.indexOf('// ---- shariah-ledger.js (end)');
  assert.ok(a > 0 && b > a, 'the page has the shariah-ledger.js block');
  const inPage = page.slice(page.indexOf('\n', a) + 1, b).replace(/\s+$/, '').split('\n').map((l) => l.replace(/^  /, '')).join('\n');
  const mod = fs.readFileSync(new URL('../lib/shariah-ledger.js', import.meta.url), 'utf8').split('\nexport {')[0].replace(/\s+$/, '');
  assert.equal(inPage, mod, 'index.html and lib/shariah-ledger.js must hold the same rules, character for character');
});

test('the rules are the approved numbers and nothing else changed shape', () => {
  eq({ ...L.LEDGER_RULES }, { recheckDays: 90, exitDays: 90, dueSoonDays: 14 });
  eq([...L.LEDGER_STATUSES], ['compliant', 'non_compliant', 'questionable']);
  eq(Object.keys(L.LEDGER_SOURCES), ['zoya_app', 'zoya_web', 'zoya_report', 'other']);
  assert.throws(() => { 'use strict'; L.LEDGER_RULES.recheckDays = 1; }, TypeError);
});
