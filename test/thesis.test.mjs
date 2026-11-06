// Tests for the investment thesis and decision record (stage 5): the thesis and its versions, the append-only history
// and its tamper checks, the explanation of buy, hold, trim and sell calls, the evidence saved with each, the written
// conditions, joining two copies, and that nothing here can change a call.
// Run: node --test test/thesis.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import * as T from '../lib/thesis.js';

const NOW = '2026-11-06T10:00:00.000Z';
const TODAY = '2026-11-06';
const eq = assert.deepEqual;

const ev = (o = {}) => ({
  asOf: '2026-11-06', price: 100,
  fundamental: { verdict: 'BUY', verdictLabel: 'Buy candidate', quality: 80, growth: 70, health: 75, dataQuality: 'high' },
  valuation: { label: 'Undervalued', fair: 130, buyBelow: 104, trimAbove: 160, upside: 0.3 },
  technical: { trend: 'up' },
  risk: { weight: 0.08, limitsAllowBuy: true, limitNotes: [], dataPaused: false },
  shariah: { screen: 'pass', ledgerOk: true, ledgerNote: 'the Zoya check of 2026-10-01 says compliant' },
  ...o,
});
const thesis = (o = {}) => ({
  kind: 'thesis', t: 'KO', written: '2026-11-01', stance: 'owned', horizon: 'long',
  reason: 'Steady cash flows that fund a growing dividend.', thesis: 'A global brand with pricing power and a strong balance sheet.',
  catalysts: [{ text: 'New product lines in 2027', by: '2027-03-01' }], risks: [{ text: 'Sugar taxes' }],
  invalidation: [{ text: 'Price falls to $80 or lower', rule: { type: 'price_below', value: 80 } }, { text: 'The brand loses pricing power' }],
  evidence: ev(), ...o,
});
const decision = (o = {}) => ({ kind: 'decision', t: 'KO', decided: TODAY, action: 'hold', call: 'Hold', source: 'portfolio', reasons: ['Passes the halal screen and its holding rule.'], evidence: ev(), ...o });
const rev = (o = {}) => { const { written, ...rest } = thesis(); return { ...rest, kind: 'revision', revised: '2026-11-06', revises: 0, change: 'Growth slowed; I now value the dividend more.', reason: 'Steady cash flows and a safer dividend.', ...o }; };

function build(list, today = TODAY) {
  let entries = [];
  for (const f of list) {
    const r = T.appendThesis(entries, f, today, NOW);
    assert.ok(r.ok, `entry refused: ${JSON.stringify(f).slice(0, 120)} -> ${r.errors.join('; ')}`);
    entries = r.entries;
  }
  return entries;
}
const add = (entries, f, today = TODAY) => T.appendThesis(entries, f, today, NOW);
const refused = (entries, f, part, today = TODAY) => {
  const r = add(entries, f, today);
  assert.equal(r.ok, false, `should have been refused: ${part}`);
  assert.ok(r.errors.some((e) => e.includes(part)), `expected "${part}" in: ${r.errors.join(' | ')}`);
  assert.equal(r.entries, entries, 'a refusal returns the list it was given');
};

test('a thesis needs a reason, the case, catalysts, risks and conditions that would break it', () => {
  const ok = add([], thesis());
  assert.ok(ok.ok, ok.errors.join('; '));
  assert.equal(ok.entry.kind, 'thesis');
  assert.equal(ok.entry.n, 0);
  for (const [k, part] of [['reason', 'reason'], ['thesis', 'thesis is required'], ['catalysts', 'catalysts'], ['risks', 'risks'], ['invalidation', 'invalidation']]) {
    const f = thesis(); delete f[k];
    refused([], f, part);
  }
  refused([], thesis({ reason: '   ' }), 'reason');
  refused([], thesis({ catalysts: [] }), 'at least one');
  refused([], thesis({ stance: 'maybe' }), 'stance');
  refused([], thesis({ horizon: 'forever' }), 'horizon');
  refused([], thesis({ t: 'not a ticker!' }), 'ticker');
  refused([], thesis({ written: '2026-02-30' }), 'date written');
  refused([], thesis({ reason: 'x'.repeat(601) }), 'reason');
  refused([], thesis({ risks: Array.from({ length: 9 }, (_, i) => ({ text: `r${i}` })) }), 'at most');
  refused([], { ...thesis(), extra: 1 }, 'unexpected field "extra"');
});

test('written conditions: only known checks, and a price check needs a price', () => {
  refused([], thesis({ invalidation: [{ text: 'x', rule: { type: 'moon_phase' } }] }), 'unknown check');
  refused([], thesis({ invalidation: [{ text: 'x', rule: { type: 'price_below' } }] }), 'price must be a number above zero');
  refused([], thesis({ invalidation: [{ text: 'x', rule: { type: 'price_below', value: -5 } }] }), 'above zero');
  refused([], thesis({ invalidation: [{ text: 'x', rule: { type: 'fails_shariah_screen', value: 3 } }] }), 'takes no value');
  assert.ok(add([], thesis({ invalidation: [{ text: 'a', rule: { type: 'business_weakens' } }, { text: 'b', rule: { type: 'trend_breaks' } }, { text: 'c', rule: { type: 'price_above', value: 200 } }, { text: 'd', rule: { type: 'fails_shariah_screen' } }] })).ok);
});

test('the evidence is strict: every group present, null for "not available", nothing invented', () => {
  assert.ok(add([], thesis({ evidence: ev({ price: null, fundamental: { verdict: null, verdictLabel: null, quality: null, growth: null, health: null, dataQuality: null } }) })).ok);
  const bad = ev(); delete bad.valuation;
  refused([], thesis({ evidence: bad }), 'valuation');
  refused([], thesis({ evidence: ev({ price: 'cheap' }) }), 'price');
  refused([], thesis({ evidence: { ...ev(), invented: 1 } }), 'unexpected evidence field');
  refused([], thesis({ evidence: ev({ technical: { trend: 'up', extra: 2 } }) }), 'unexpected evidence field');
  const missing = ev(); delete missing.fundamental.growth;
  refused([], thesis({ evidence: missing }), 'missing (use null');
  refused([], thesis({ evidence: ev({ risk: { weight: 0.1, limitsAllowBuy: 'yes', limitNotes: [], dataPaused: false } }) }), 'limitsAllowBuy');
});

test('one open thesis per stock; a second one is refused until the first is closed', () => {
  const e = build([thesis()]);
  refused(e, thesis({ written: '2026-11-05' }), 'already has an open thesis');
  const closed = build([thesis(), { kind: 'close', t: 'KO', on: '2026-11-06', note: 'Sold the position.' }]);
  assert.equal(T.thesisState(closed, 'KO').status, 'closed');
  const again = add(closed, thesis({ written: '2026-11-06', reason: 'Back in: better price now.' }));
  assert.ok(again.ok, again.errors.join('; '));
  const s = T.thesisState(again.entries, 'KO');
  assert.equal(s.status, 'open');
  assert.equal(s.earlier.length, 1, 'the first thesis is kept as an earlier one');
  assert.equal(s.original.reason, 'Back in: better price now.');
});

test('a change of mind is a new version with a reason; the original is never altered', () => {
  const e0 = build([thesis()]);
  const frozen = JSON.stringify(e0);
  const r = add(e0, rev());
  assert.ok(r.ok, r.errors.join('; '));
  assert.equal(JSON.stringify(e0), frozen, 'the list passed in is not changed');
  assert.equal(JSON.stringify(r.entries[0]), JSON.stringify(e0[0]), 'the original entry is identical');
  const s = T.thesisState(r.entries, 'KO');
  assert.equal(s.versions.length, 2);
  assert.equal(s.original.reason, 'Steady cash flows that fund a growing dividend.');
  assert.equal(s.current.reason, 'Steady cash flows and a safer dividend.');
  const ch = T.thesisChanges(s.versions[0], s.versions[1]);
  eq(ch.map((c) => c.field), ['reason']);
  assert.match(ch[0].before, /growing dividend/);
  assert.match(ch[0].after, /safer dividend/);
  refused(e0, rev({ change: '' }), 'reason for the change');
  refused(e0, rev({ reason: thesis().reason }), 'nothing in the thesis changed');
  refused(e0, rev({ revises: 5 }), 'not the latest');
  refused([], rev(), 'no open thesis');
  refused(e0, rev({ revised: '2026-10-01' }), 'before the version it revises');
  // revising twice: the second must name the first revision
  const two = build([thesis(), rev(), rev({ revises: 1, reason: 'Third wording of the reason.', change: 'Reworded.' })]);
  assert.equal(T.thesisState(two, 'KO').versions.length, 3);
  refused(r.entries, rev({ revises: 0, reason: 'Another.', change: 'x' }), 'not the latest');
});

test('changes between versions list every field that differs, and only those', () => {
  const a = thesis();
  const b = { ...thesis(), risks: [{ text: 'Sugar taxes' }, { text: 'A new rival' }], invalidation: [{ text: 'Price falls to $70 or lower', rule: { type: 'price_below', value: 70 } }], horizon: 'mid' };
  eq(T.thesisChanges(a, b).map((c) => c.field), ['horizon', 'risks', 'invalidation']);
  eq(T.thesisChanges(a, { ...a }), []);
});

test('the history is append-only and tamper-evident', () => {
  const e = build([thesis(), decision(), rev(), decision({ action: 'trim', call: 'Trim', reasons: ['Above its trim price.'] })]);
  assert.ok(T.verifyThesisLog(e).ok);
  const edited = JSON.parse(JSON.stringify(e)); edited[0].reason = 'rewritten afterwards';
  assert.equal(T.verifyThesisLog(edited).ok, false);
  assert.ok(T.verifyThesisLog(edited).problems.some((p) => /changed/.test(p)));
  const removed = e.filter((_, i) => i !== 1);
  assert.equal(T.verifyThesisLog(removed).ok, false);
  const reordered = [e[0], e[2], e[1], e[3]];
  assert.equal(T.verifyThesisLog(reordered).ok, false);
  // cutting entries off the end leaves a valid chain: only the anchor shows it
  const cut = e.slice(0, 2);
  assert.ok(T.verifyThesisLog(cut).ok);
  // a forged explanation or condition result is caught even when the hash is recomputed by someone who owns the device
  const forged = JSON.parse(JSON.stringify(e)); forged[1].explanation.headline = 'Sell KO: everything is fine';
  assert.equal(T.verifyThesisLog(forged).ok, false);
  // nothing can be added to a record that fails its check
  const r = add(edited, decision());
  assert.equal(r.ok, false);
  assert.ok(r.errors.some((m) => /integrity/.test(m)));
});

test('a decision keeps the call as the page showed it, the evidence of the day and the thesis as it stood', () => {
  const e = build([thesis()]);
  const evid = ev({ price: 70, technical: { trend: 'down' } });
  const r = add(e, decision({ action: 'sell', call: 'Take profit', reasons: ['Reached its fair value ($130): your medium-term rule says sell.'], evidence: evid, userAction: 'I plan to sell half next week.' }));
  assert.ok(r.ok, r.errors.join('; '));
  const d = r.entry;
  assert.equal(d.kind, 'decision');
  eq(d.evidence, evid);
  assert.equal(d.call, 'Take profit');
  assert.equal(d.action, 'sell');
  assert.equal(d.userAction, 'I plan to sell half next week.');
  assert.equal(d.thesisRef.n, 0);
  assert.equal(d.thesisRef.hash, e[0].hash);
  assert.equal(d.thesisCopy.reason, thesis().reason);
  assert.equal(d.recorded, NOW, 'when it was really recorded is kept');
  // revising the thesis later does not alter the decision already saved
  const later = build([thesis(), decision({ evidence: evid }), rev()]);
  assert.equal(later[1].thesisCopy.reason, thesis().reason);
  assert.equal(T.thesisState(later, 'KO').current.reason, 'Steady cash flows and a safer dividend.');
});

test('the explanation covers fundamentals, valuation, chart, risk, Shariah and the thesis, and quotes the page', () => {
  const e = build([thesis()]);
  for (const [action, call, reason] of [['buy', 'Add', 'Below its buy price ($104.00).'], ['hold', 'Hold', 'Passes the halal screen and its holding rule.'], ['trim', 'Trim', 'Above its trim price ($160.00): sell part and stop adding.'], ['sell', 'Sell', 'The business itself got worse.']]) {
    const r = add(e, decision({ action, call, reasons: [reason] }));
    assert.ok(r.ok, r.errors.join('; '));
    const x = r.entry.explanation;
    assert.match(x.headline, new RegExp(`^${action[0].toUpperCase()}${action.slice(1)} KO on ${TODAY}\\.`));
    eq(x.why, [reason], 'the page’s own reasons, word for word');
    assert.equal(x.data.length, 5);
    assert.match(x.data[0], /^Fundamentals: rated “Buy candidate”, business quality 80 of 100, growth 70 of 100, financial health 75 of 100, data quality high\.$/);
    assert.match(x.data[1], /^Valuation: price \$100\.00, valued as “Undervalued”, fair value \$130\.00, buy at or below \$104\.00, trim at or above \$160\.00, upside to fair value 30%\.$/);
    assert.match(x.data[2], /^Chart: the trend is up\.$/);
    assert.match(x.data[3], /^Risk: this stock is 8% of your portfolio/);
    assert.match(x.data[4], /^Shariah: the tool’s screen shows “pass”; your Shariah ledger: .* Zoya has the final word\.$/);
    assert.ok(x.thesis.some((l) => l.startsWith('Your thesis (written 2026-11-01)')));
    assert.ok(x.thesis.some((l) => l.startsWith('Catalysts you expected')));
    assert.ok(x.thesis.some((l) => l.startsWith('Risks you named')));
    assert.ok(x.thesis.some((l) => l.includes('Would break it')));
  }
});

test('missing data is said to be missing, never filled in; a stock with no thesis is said to have none', () => {
  const empty = ev({ price: null, fundamental: { verdict: null, verdictLabel: null, quality: null, growth: null, health: null, dataQuality: null }, valuation: { label: null, fair: null, buyBelow: null, trimAbove: null, upside: null }, technical: { trend: null }, risk: { weight: null, limitsAllowBuy: null, limitNotes: [], dataPaused: false }, shariah: { screen: null, ledgerOk: null, ledgerNote: null } });
  const r = add([], decision({ evidence: empty }));
  assert.ok(r.ok, r.errors.join('; '));
  const x = r.entry.explanation;
  eq(x.data, ['Fundamentals: not available for this stock.', 'Valuation: not available for this stock.', 'Chart: not available for this stock.', 'Risk: not available for this stock.', 'Shariah: not available for this stock. Zoya has the final word.']);
  eq(x.thesis, ['No thesis is recorded for KO, so this call could not be checked against your own reasons.']);
  assert.equal(r.entry.thesisRef, undefined);
  eq(r.entry.conditions, []);
});

test('written conditions are checked against the saved evidence only, and a met one changes no call', () => {
  const cond = (type, value) => ({ text: `c-${type}`, rule: value === undefined ? { type } : { type, value } });
  const e = build([thesis({ invalidation: [cond('price_below', 80), cond('price_above', 150), cond('business_weakens'), cond('fails_shariah_screen'), cond('trend_breaks'), { text: 'free text' }] })]);
  const calm = add(e, decision()).entry;
  eq(calm.conditions.map((c) => c.state), ['not_met', 'not_met', 'not_met', 'not_met', 'not_met', 'judge']);
  const bad = ev({ price: 79.99, fundamental: { ...ev().fundamental, verdict: 'AVOID_WEAK' }, shariah: { screen: 'fail', ledgerOk: false, ledgerNote: 'no record' }, technical: { trend: 'weakening' } });
  const hit = add(e, decision({ evidence: bad })).entry;
  eq(hit.conditions.map((c) => c.state), ['met', 'not_met', 'met', 'met', 'met', 'judge']);
  assert.ok(hit.explanation.thesis.some((l) => l.startsWith('A condition you wrote down as breaking the thesis is met.') && l.includes('does not change the call')));
  assert.equal(hit.action, 'hold', 'the action is the page’s call, whatever the conditions say');
  assert.equal(add(e, decision({ evidence: ev({ price: 80 }) })).entry.conditions[0].state, 'met', 'at the price counts');
  assert.equal(add(e, decision({ evidence: ev({ price: 150 }) })).entry.conditions[1].state, 'met', 'at the price counts');
  const unknown = add(e, decision({ evidence: ev({ price: null, fundamental: { ...ev().fundamental, verdict: null }, shariah: { screen: null, ledgerOk: null, ledgerNote: null }, technical: { trend: null } }) })).entry;
  eq(unknown.conditions.map((c) => c.state), ['unknown', 'unknown', 'unknown', 'unknown', 'unknown', 'judge']);
  assert.match(unknown.explanation.thesis.find((l) => l.includes('c-price_below')), /cannot be checked: the data was not available/);
  // a sale or a trim with no condition met says it comes from the rules
  const sale = add(e, decision({ action: 'sell', call: 'Sell' })).entry;
  assert.ok(sale.explanation.thesis.some((l) => /comes from the tool’s rules, not from your thesis/.test(l)));
});

test('a decision can only be saved for today, and the caller cannot supply the derived parts', () => {
  const e = build([thesis()]);
  refused(e, decision({ decided: '2026-11-05' }), 'only be saved for today');
  refused(e, decision({ decided: '2026-11-07' }), 'only be saved for today');
  refused(e, decision({ action: 'wait' }), 'action must be');
  refused(e, decision({ reasons: [] }), 'reasons');
  refused(e, decision({ call: '' }), 'wording of the call');
  refused(e, decision({ source: 'tv' }), 'source');
  const forged = add(e, { ...decision(), explanation: { headline: 'Sell it all' }, conditions: [{ text: 'x', state: 'met' }], thesisCopy: { reason: 'planted' }, thesisRef: { n: 0, hash: 'x', version: 1, of: 1 } });
  assert.ok(forged.ok, forged.errors.join('; '));
  assert.match(forged.entry.explanation.headline, /^Hold KO/);
  assert.notEqual(forged.entry.thesisCopy.reason, 'planted');
  assert.ok(T.verifyThesisLog(forged.entries).ok);
});

test('a mistake is voided by a correction that stays in the history; a cited thesis cannot be voided', () => {
  const e = build([thesis(), decision()]);
  const fix = add(e, { kind: 'correction', t: 'KO', fixes: 1, note: 'Saved on the wrong stock by mistake.' });
  assert.ok(fix.ok, fix.errors.join('; '));
  const s = T.thesisState(fix.entries, 'KO');
  assert.equal(s.decisions.length, 0);
  assert.equal(s.voided.length, 1);
  assert.equal(fix.entries[1].kind, 'decision', 'the voided entry is still there');
  refused(fix.entries, { kind: 'correction', t: 'KO', fixes: 1, note: 'again' }, 'already corrected');
  refused(fix.entries, { kind: 'correction', t: 'KO', fixes: 2, note: 'x' }, 'cannot be corrected');
  refused(e, { kind: 'correction', t: 'KO', fixes: 9, note: 'x' }, 'no such entry');
  refused(e, { kind: 'correction', t: 'AAPL', fixes: 1, note: 'x' }, 'another ticker');
  refused(e, { kind: 'correction', t: 'KO', fixes: 1, note: '' }, 'reason');
  // the thesis is cited by the decision above, so it cannot be voided first
  refused(e, { kind: 'correction', t: 'KO', fixes: 0, note: 'typo' }, 'refers to this entry');
  // once the citing entries are voided, the thesis can be
  const both = add(fix.entries, { kind: 'correction', t: 'KO', fixes: 0, note: 'typo' });
  assert.ok(both.ok, both.errors.join('; '));
  assert.equal(T.thesisState(both.entries, 'KO').status, 'none');
  // voiding the latest revision returns to the version before it
  const r = build([thesis(), rev()]);
  const v = add(r, { kind: 'correction', t: 'KO', fixes: 1, note: 'Wrong text.' });
  assert.ok(v.ok);
  assert.equal(T.thesisState(v.entries, 'KO').current.n, 0);
});

test('closing a thesis, and a closing that does not fit', () => {
  const e = build([thesis()]);
  refused(e, { kind: 'close', t: 'KO', on: '2026-11-06', note: '' }, 'why you no longer');
  refused(e, { kind: 'close', t: 'KO', on: '2026-10-01', note: 'Sold.' }, 'before the thesis was written');
  refused(e, { kind: 'close', t: 'KO', on: '2026-11-09', note: 'Sold.' }, 'future');
  refused([], { kind: 'close', t: 'KO', on: '2026-11-06', note: 'Sold.' }, 'no open thesis');
  const c = add(e, { kind: 'close', t: 'KO', on: '2026-11-06', note: 'Sold the position.' });
  assert.ok(c.ok);
  assert.equal(c.entry.thesisN, 0);
  refused(c.entries, { kind: 'close', t: 'KO', on: '2026-11-06', note: 'Again.' }, 'no open thesis');
  refused(c.entries, rev(), 'no open thesis');
});

test('the overview shows holdings without a thesis, and a written condition that is met today', () => {
  const e = build([thesis(), thesis({ t: 'AAPL', invalidation: [{ text: 'Trend breaks', rule: { type: 'trend_breaks' } }] })]);
  const rows = T.thesisOverview(e, ['KO', 'AAPL', 'MSFT'], { KO: ev(), AAPL: ev({ technical: { trend: 'down' } }) });
  const by = Object.fromEntries(rows.map((r) => [r.t, r]));
  assert.equal(by.KO.level, 'ok');
  assert.equal(by.AAPL.level, 'bad');
  eq(by.AAPL.met, ['Trend breaks']);
  assert.equal(by.MSFT.level, 'warn');
  assert.match(by.MSFT.text, /No thesis recorded for this holding/);
  // a thesis for a stock that is not held yet is listed without a warning
  const only = T.thesisOverview(build([thesis({ stance: 'considering' })]), [], {});
  assert.equal(only[0].level, 'ok');
});

test('joining a backup: nothing here is changed, the new entries are added, references follow', () => {
  const base = build([thesis()]);
  const local = add(base, decision({ reasons: ['Local decision.'] })).entries;
  const other = add(base, rev()).entries;
  const other2 = add(other, decision({ action: 'trim', call: 'Trim', reasons: ['Backup decision after the revision.'] })).entries;
  const m = T.mergeThesisLogs(local, other2);
  assert.ok(m.ok, m.note);
  assert.equal(m.added, 2);
  assert.equal(JSON.stringify(m.entries.slice(0, local.length)), JSON.stringify(local), 'this device’s entries are untouched');
  assert.ok(T.verifyThesisLog(m.entries).ok);
  const rv = m.entries.find((x) => x.kind === 'revision');
  assert.equal(rv.revises, 0);
  assert.ok(rv.origin && rv.origin.n === 1);
  const dec = m.entries[m.entries.length - 1];
  assert.equal(dec.thesisRef.n, rv.n, 'the decision points at the revision as it is numbered here');
  assert.equal(dec.thesisRef.hash, rv.hash);
  // adding the same backup again changes nothing
  const again = T.mergeThesisLogs(m.entries, other2);
  assert.equal(again.added, 0);
  assert.equal(JSON.stringify(again.entries), JSON.stringify(m.entries));
  // a backup that extends, one that is the same, one that is behind
  assert.equal(T.mergeThesisLogs(base, local).added, 1);
  assert.equal(T.mergeThesisLogs(local, local).added, 0);
  assert.equal(T.mergeThesisLogs(local, base).added, 0);
  // a record that fails its own check is never merged
  const broken = JSON.parse(JSON.stringify(other2)); broken[0].reason = 'edited';
  const bad = T.mergeThesisLogs(local, broken);
  assert.equal(bad.ok, false);
  assert.equal(bad.entries, local);
});

test('the saved record is complete for judging a call later: the price, the date, the call, the evidence', () => {
  const e = build([thesis()]);
  const d = add(e, decision({ action: 'buy', call: 'Add', evidence: ev({ asOf: '2026-11-04', price: 98.5 }) })).entry;
  assert.equal(d.evidence.asOf, '2026-11-04');
  assert.equal(d.evidence.price, 98.5);
  assert.equal(d.action, 'buy');
  assert.equal(d.decided, TODAY);
  assert.ok(d.recorded && d.hash && d.prev);
  const th = T.thesisState(e, 'KO').original;
  assert.equal(th.evidence.price, 100, 'the price on the day the thesis was written is saved with it');
});

test('wording: no explanation claims a stock is compliant, halal or permissible', () => {
  const e = build([thesis()]);
  const x = add(e, decision()).entry.explanation;
  for (const line of [x.headline, ...x.data]) assert.ok(!/\b(is|are) (shariah |halal )?compliant\b|\bhalal\b|\bpermissible\b/i.test(line), `claims compliance: ${line}`);
});

test('the library imports nothing that decides a call, and the page carries exactly the same code', () => {
  const src = fs.readFileSync(new URL('../lib/thesis.js', import.meta.url), 'utf8');
  const imports = [...src.matchAll(/^import .* from '(.*)';$/gm)].map((m) => m[1]);
  eq(imports, ['./shariah-ledger.js'], 'the only import is the ledger’s hashing and date helpers');
  const page = fs.readFileSync(new URL('../index.html', import.meta.url), 'utf8');
  const a = page.indexOf('// ---- thesis.js (start)');
  const b = page.indexOf('// ---- thesis.js (end)');
  assert.ok(a > 0 && b > a, 'the page has the thesis.js block');
  const inPage = page.slice(page.indexOf('\n', a) + 1, b).replace(/\s+$/, '').split('\n').map((l) => l.replace(/^  /, '')).join('\n');
  const mod = src.split('\nexport {')[0].replace(/^import [^\n]*\n/, '').replace(/\s+$/, '');
  assert.equal(inPage, mod, 'index.html and lib/thesis.js must hold the same rules, character for character');
});

test('the approved limits and shapes are unchanged', () => {
  eq([...T.THESIS_KINDS], ['thesis', 'revision', 'decision', 'close', 'correction']);
  eq([...T.THESIS_ACTIONS], ['buy', 'hold', 'trim', 'sell']);
  eq([...T.THESIS_STANCES], ['owned', 'considering']);
  eq([...T.THESIS_HORIZONS], ['long', 'mid', 'short']);
  eq([...T.THESIS_RULE_TYPES], ['price_below', 'price_above', 'business_weakens', 'fails_shariah_screen', 'trend_breaks']);
  assert.equal(T.THESIS_VERSION, 1);
});
