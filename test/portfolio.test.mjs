// Tests for the portfolio ledger (stage 6): the append-only, hash-chained record of cash, buys, sells, dividends, fees and
// opening positions; average cost, realized and unrealized profit, cash and gain worked out from it; the limits you
// already have applied to it; value history; joining two copies; and that nothing here can change a call.
// Run: node --test test/portfolio.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import * as P from '../lib/portfolio.js';
import { POLICY_RULES, buyRoom, trimSale, sectorOpen, worthAnOrder } from '../lib/policy.js';
import { anchorOf, checkAnchor, sha256Hex } from '../lib/shariah-ledger.js';

const NOW = '2026-11-06T10:00:00.000Z';
const TODAY = '2026-11-06';
const eq = assert.deepEqual;
const near = (a, b, msg, tol = 1e-6) => assert.ok(Math.abs(a - b) <= tol, `${msg || 'value'}: ${a} vs ${b}`);

const dep = (amount, date = '2026-10-01', o = {}) => ({ kind: 'deposit', date, amount, ...o });
const buy = (t, shares, price, fees = 0, date = '2026-10-02', o = {}) => ({ kind: 'buy', t, date, shares, price, fees, ...o });
const sell = (t, shares, price, fees = 0, date = '2026-10-20', o = {}) => ({ kind: 'sell', t, date, shares, price, fees, ...o });
const open = (t, shares, cost, date = '2026-09-01', o = {}) => ({ kind: 'open', t, date, shares, cost, ...o });
const div = (t, amount, date = '2026-10-25', o = {}) => ({ kind: 'dividend', t, date, amount, ...o });
const fee = (amount, date = '2026-10-26', o = {}) => ({ kind: 'fee', date, amount, ...o });
const wd = (amount, date = '2026-10-27', o = {}) => ({ kind: 'withdraw', date, amount, ...o });
const fix = (fixes, reason = 'entered by mistake') => ({ kind: 'correction', fixes, reason });

function build(list, today = TODAY) {
  let entries = [];
  for (const f of list) {
    const r = P.appendPortfolio(entries, f, today, NOW);
    assert.ok(r.ok, `entry refused: ${JSON.stringify(f)} -> ${r.errors.join('; ')}`);
    entries = r.entries;
  }
  return entries;
}
const add = (entries, f, today = TODAY) => P.appendPortfolio(entries, f, today, NOW);
const refused = (entries, f, part, today = TODAY) => {
  const r = add(entries, f, today);
  assert.equal(r.ok, false, `should have been refused: ${part}`);
  assert.ok(r.errors.some((e) => e.includes(part)), `expected "${part}" in: ${r.errors.join(' | ')}`);
  assert.equal(r.entries, entries, 'a refusal returns the list it was given');
};
const state = (list) => P.pfReplay(build(list));
const pos = (s, t) => s.positions.find((p) => p.t === t);

test('cash, positions and average cost come from the entries alone', () => {
  const s = state([dep(10000), buy('KO', 10, 60, 1), buy('KO', 10, 70, 1)]);
  near(s.cash, 10000 - (600 + 1) - (700 + 1));
  const p = pos(s, 'KO');
  near(p.shares, 20);
  near(p.cost, 1302);
  near(p.avgCost, 65.1, 'fees are part of the cost');
  eq(s.problems, []);
});

test('a sale takes out the average cost and realizes the difference after fees', () => {
  const s = state([dep(10000), buy('KO', 10, 60, 1), buy('KO', 10, 70, 1), sell('KO', 5, 80, 2)]);
  const p = pos(s, 'KO');
  near(p.shares, 15);
  near(p.avgCost, 65.1, 'the average cost does not change when you sell');
  near(s.realized, 5 * 80 - 2 - 5 * 65.1);
  near(s.trades[0].avgCost, 65.1);
  near(s.cash, 10000 - 601 - 701 + (400 - 2));
});

test('selling everything closes the position, keeps what it realized, and a rebuy starts fresh', () => {
  const s = state([dep(10000), buy('KO', 10, 60), sell('KO', 10, 50, 0, '2026-10-10'), buy('KO', 4, 55, 0, '2026-10-15')]);
  near(s.realized, -100);
  near(pos(s, 'KO').shares, 4);
  near(pos(s, 'KO').avgCost, 55, 'the old cost does not leak into the new position');
  near(pos(s, 'KO').realized, -100, 'the result of the earlier round trip stays with the ticker');
  const closed = state([dep(1000), buy('KO', 1, 100), sell('KO', 1, 120)]);
  eq(closed.positions, []);
  eq(closed.closed.map((c) => c.t), ['KO']);
  near(closed.closed[0].realized, 20);
});

test('fractional shares and tiny rounding noise do not leave a ghost position', () => {
  const s = state([dep(1000), buy('VTI', 0.1, 100), buy('VTI', 0.2, 100), sell('VTI', 0.3, 110, 0, '2026-10-21')]);
  eq(s.positions, []);
  near(s.realized, 3);
});

test('dividends and other fees change cash and the totals, and never the average cost', () => {
  const s = state([dep(5000), buy('KO', 10, 60), div('KO', 7.5, '2026-10-25', { tax: 1.5 }), fee(4.99)]);
  near(s.dividends, 7.5);
  near(s.tax, 1.5);
  near(s.otherFees, 4.99);
  near(s.cash, 5000 - 600 + 7.5 - 4.99, 'the dividend amount is the cash received; tax is only recorded');
  near(pos(s, 'KO').avgCost, 60);
  near(pos(s, 'KO').dividends, 7.5);
});

test('opening positions bring in what you already hold without touching cash', () => {
  const s = state([open('KO', 10, 55), dep(500)]);
  near(s.cash, 500);
  near(pos(s, 'KO').cost, 550);
  near(s.invested, 1050, 'what was already held counts as put in at its cost');
});

test('the gain equals realized + unrealized + dividends - other fees, to the cent', () => {
  const s = state([open('AAPL', 5, 150), dep(20000), buy('KO', 10, 60, 1), buy('MSFT', 3, 300, 2), sell('KO', 4, 70, 1), div('KO', 6), fee(10), wd(100)]);
  const v = P.pfValue(s, { priceOf: (t) => ({ AAPL: 190, KO: 65, MSFT: 310 })[t] });
  assert.equal(v.complete, true);
  near(v.gain, s.realized + v.unrealized + s.dividends - s.otherFees, 'the identity', 1e-6);
});

test('the identity holds on random records', () => {
  let seed = 12345;
  const rnd = () => { seed = (seed * 1664525 + 1013904223) % 4294967296; return seed / 4294967296; };
  const tickers = ['KO', 'MSFT', 'SPUS', 'AAPL'];
  for (let run = 0; run < 40; run++) {
    let entries = build([dep(50000, '2026-01-01')]);
    for (let i = 0; i < 60; i++) {
      const t = tickers[Math.floor(rnd() * tickers.length)];
      const day = String(2 + Math.floor(rnd() * 27)).padStart(2, '0');
      const date = `2026-${String(2 + Math.floor(rnd() * 9)).padStart(2, '0')}-${day}`;
      const r = rnd();
      const f = r < 0.4 ? buy(t, Math.round(rnd() * 20 * 100) / 100 + 0.01, Math.round(rnd() * 400 * 100) / 100 + 1, Math.round(rnd() * 5 * 100) / 100, date)
        : r < 0.7 ? sell(t, Math.round(rnd() * 15 * 100) / 100 + 0.01, Math.round(rnd() * 400 * 100) / 100 + 1, Math.round(rnd() * 5 * 100) / 100, date)
          : r < 0.8 ? div(t, Math.round(rnd() * 30 * 100) / 100 + 0.01, date)
            : r < 0.9 ? fee(Math.round(rnd() * 10 * 100) / 100 + 0.01, date)
              : r < 0.95 ? dep(Math.round(rnd() * 1000) + 1, date) : open(t, 3, 100, date);
      const x = add(entries, f);
      if (x.ok) entries = x.entries;
    }
    assert.ok(P.verifyPortfolioLog(entries, TODAY).ok, `run ${run}: the record stays valid`);
    const s = P.pfReplay(entries);
    assert.ok(s.cash >= -1e-6, 'cash is never below zero');
    for (const p of s.positions) assert.ok(p.shares > 0 && p.cost > 0);
    const v = P.pfValue(s, { priceOf: () => 123.45 });
    near(v.gain, s.realized + v.unrealized + s.dividends - s.otherFees, `run ${run} identity`, 1e-4);
    near(v.total, v.positionsValue + s.cash, 'total', 1e-6);
    if (v.rows.length) near(v.rows.reduce((a, r) => a + r.weight, 0) + v.cashWeight, 1, 'weights add up', 1e-9);
  }
});

test('a missing price is never guessed: valued at cost, marked, and the gain is withheld', () => {
  const s = state([dep(5000), buy('KO', 10, 60), buy('XYZ', 2, 100)]);
  const v = P.pfValue(s, { priceOf: (t) => (t === 'KO' ? 66 : null) });
  eq(v.unpriced, ['XYZ']);
  assert.equal(v.complete, false);
  assert.equal(v.gain, null);
  assert.equal(v.gainPct, null);
  const x = v.rows.find((r) => r.t === 'XYZ');
  assert.equal(x.price, null);
  assert.equal(x.unrealized, null);
  assert.equal(x.unrealizedPct, null);
  near(x.value, 200, 'valued at what it cost');
  near(v.unrealized, 60, 'only priced positions count toward the unrealized total');
  assert.equal(P.pfHistLine(v, s, 'h', TODAY), null, 'no history line from a partial valuation');
  const zero = P.pfValue(s, { priceOf: () => 0 });
  assert.equal(zero.complete, false, 'a zero price is not a price');
});

test('entries that make the record impossible are refused', () => {
  const base = build([dep(1000), buy('KO', 10, 50)]);
  refused(base, sell('KO', 11, 60), 'only 10 would be held');
  refused(base, sell('XYZ', 1, 60), 'only 0 would be held');
  refused(base, buy('KO', 100, 50), 'cash would go below zero');
  refused(base, wd(600), 'cash would go below zero');
  refused(base, fee(600), 'cash would go below zero');
  refused(base, div('XYZ', 5), 'before any holding');
  refused(base, dep(10, '2026-11-07'), 'future');
  refused(base, buy('KO', 1, 50, 0, '2099-01-01'), 'future');
});

test('dates decide the order: a back-dated entry is refused if it breaks a later one', () => {
  const base = build([dep(1000, '2026-10-01'), buy('KO', 10, 50, 0, '2026-10-05'), sell('KO', 10, 60, 0, '2026-10-10')]);
  refused(base, sell('KO', 1, 60, 0, '2026-10-02'), 'would be held that day');
  refused(base, wd(900, '2026-10-03'), 'cash would go below zero', TODAY);
  const ok = add(base, dep(50, '2026-10-02'));
  assert.ok(ok.ok, 'a back-dated deposit that breaks nothing is fine');
  const early = add(base, buy('KO', 1, 10, 0, '2026-09-01'));
  assert.equal(early.ok, false, 'cash did not exist yet on that date');
});

test('shapes: unknown kinds and fields, bad numbers, bad tickers, bad dates', () => {
  refused([], { kind: 'gift', date: '2026-10-01', amount: 5 }, 'unknown kind');
  refused([], dep(0), 'amount');
  refused([], dep(-5), 'amount');
  refused([], dep(Infinity), 'amount');
  refused([], dep(NaN), 'amount');
  refused([], dep(5, '2026-02-30'), 'date');
  refused([], dep(5, '10/01/2026'), 'date');
  refused([], { ...dep(5), colour: 'red' }, 'unexpected field');
  refused([], buy('KO', 0, 50), 'shares');
  refused([], buy('KO', 1, 0), 'price');
  refused([], buy('KO', 1, 50, -1), 'fees');
  refused([], buy('k o', 1, 50), 'ticker');
  refused([], { kind: 'buy', date: '2026-10-01', price: 5, shares: 1, fees: 0 }, 't is missing');
  refused([], open('KO', 1, 0), 'cost');
  refused([], dep(5, '2026-10-01', { note: 'x'.repeat(241) }), 'note');
});

test('numbers are rounded to six places so form noise cannot split a hash', () => {
  const r = add([], dep(10.1 + 0.2));
  assert.equal(r.entry.amount, 10.3);
  const a = add(build([dep(100)]), buy('KO', 1 / 3, 10, 0));
  assert.equal(a.entry.shares, 0.333333);
});

test('a buy that broke a rule is recorded only with the confirmation, and the rule check is saved with it', () => {
  const rules = [{ rule: 'buyCap', state: 'fail', text: 'It takes KO to 14.0% of the ledger; your limit is 10%.' }, { rule: 'cash', state: 'pass', text: 'Cash recorded.' }];
  const base = build([dep(10000)]);
  refused(base, buy('KO', 10, 100, 0, '2026-10-02', { rules }), 'confirmation');
  const ok = add(base, buy('KO', 10, 100, 0, '2026-10-02', { rules, acknowledged: true }));
  assert.ok(ok.ok, ok.errors.join('; '));
  eq(ok.entry.rules, rules);
  refused(base, buy('KO', 10, 100, 0, '2026-10-02', { rules: [{ rule: 'cash', state: 'pass', text: 'ok' }], acknowledged: true }), 'confirmation without a broken rule');
  refused(base, buy('KO', 10, 100, 0, '2026-10-02', { rules: [{ rule: 'x', state: 'maybe', text: 'ok' }] }), 'rules');
  refused(base, buy('KO', 10, 100, 0, '2026-10-02', { rules: [{ rule: 'x', state: 'pass', text: 'ok', extra: 1 }] }), 'rules');
});

test('a correction voids an entry for good, keeps it visible, and cannot make the record impossible', () => {
  const e = build([dep(1000), buy('KO', 10, 50), div('KO', 3)]);
  const v = build([dep(1000), buy('KO', 10, 50), div('KO', 3), fix(2)]);
  near(P.pfReplay(v).dividends, 0);
  near(P.pfReplay(v).cash, 500);
  eq(P.pfReplay(v).voided, [2]);
  assert.equal(v.length, 4, 'the voided entry is still in the history');
  refused(e, fix(0), 'impossible');
  refused(v, fix(2), 'already corrected');
  refused(v, fix(3), 'cannot be corrected');
  refused(e, fix(9), 'no such entry');
  refused(e, { kind: 'correction', fixes: 1 }, 'reason');
  const bought = build([dep(1000), buy('KO', 10, 50), fix(1)]);
  eq(P.pfReplay(bought).positions, []);
  near(P.pfReplay(bought).cash, 1000);
});

test('the chain: every kind of tampering shows', () => {
  const e = build([dep(1000), buy('KO', 10, 50), sell('KO', 2, 60), div('KO', 3)]);
  assert.ok(P.verifyPortfolioLog(e, TODAY).ok);
  const clone = () => JSON.parse(JSON.stringify(e));
  const changed = clone(); changed[1].shares = 11;
  assert.ok(P.verifyPortfolioLog(changed).problems.some((p) => p.includes('hash')));
  const removed = clone(); removed.splice(1, 1);
  assert.equal(P.verifyPortfolioLog(removed).ok, false);
  const moved = clone(); [moved[1], moved[2]] = [moved[2], moved[1]];
  assert.equal(P.verifyPortfolioLog(moved).ok, false);
  const rehashed = clone(); rehashed[1].shares = 11;
  assert.equal(P.verifyPortfolioLog(rehashed).ok, false, 'a changed entry with the old hash');
  const extra = clone(); extra.push({ ...extra[0] });
  assert.equal(P.verifyPortfolioLog(extra).ok, false);
  const dated = P.verifyPortfolioLog(e, '2026-10-01');
  assert.ok(dated.problems.some((p) => p.includes('future')), 'dated after "today"');
  assert.equal(P.verifyPortfolioLog('nope').ok, false);
  assert.equal(P.verifyPortfolioLog([null]).ok, false);
  // cut off the end: only the anchor shows it
  const cut = e.slice(0, 3);
  assert.ok(P.verifyPortfolioLog(cut).ok, 'a shorter chain is still a chain');
  assert.equal(checkAnchor(cut, anchorOf(e)).ok, false, 'but it no longer matches the kept anchor');
  assert.equal(checkAnchor(e, anchorOf(e)).ok, true);
});

// re-hash a record after editing one entry, as someone who knows the format could
const canon = (x) => (x === null || typeof x !== 'object' ? JSON.stringify(x) : Array.isArray(x) ? `[${x.map(canon).join(',')}]` : `{${Object.keys(x).filter((k) => x[k] !== undefined).sort().map((k) => `${JSON.stringify(k)}:${canon(x[k])}`).join(',')}}`);
function forge(entries, idx, patch) {
  const out = entries.map((e) => ({ ...e }));
  out.forEach((e, i) => {
    if (i === idx) Object.assign(e, patch);
    if (i > 0) e.prev = out[i - 1].hash;
    const { hash, ...rest } = e;
    e.hash = sha256Hex(canon(rest));
  });
  return out;
}
test('a record that was edited and re-hashed still fails if what it says is impossible', () => {
  const a = build([dep(1000), buy('KO', 10, 90)]);
  assert.ok(P.verifyPortfolioLog(a).ok);
  const lie = forge(a, 0, { amount: 100 });
  const v = P.verifyPortfolioLog(lie);
  assert.equal(v.ok, false);
  assert.ok(v.problems.some((p) => p.includes('cash would go below zero')), v.problems.join(' | '));
  const sold = forge(build([dep(1000), buy('KO', 10, 90), sell('KO', 5, 95)]), 1, { shares: 2 });
  assert.ok(P.verifyPortfolioLog(sold).problems.some((p) => p.includes('would be held that day')));
  assert.equal(P.verifyPortfolioLog(forge(a, 1, { colour: 'red' })).ok, false, 'a field that does not belong');
  // the anchor still shows that the record is not the one that was kept
  assert.equal(checkAnchor(forge(a, 0, { amount: 2000 }), anchorOf(a)).ok, false);
});

test('golden hash: the same entry always hashes the same, so a change in how it is written shows', () => {
  const r = P.appendPortfolio([], dep(1000, '2026-10-01', { note: 'start' }), TODAY, NOW);
  assert.equal(r.entry.hash, GOLDEN_HASH, 'the hash of the first deposit');
  const r2 = P.appendPortfolio(r.entries, buy('KO', 10, 50.25, 1.5), TODAY, NOW);
  assert.equal(r2.entry.prev, r.entry.hash, 'linked to the one before');
  assert.equal(r2.entry.hash, GOLDEN_HASH_2);
});
const GOLDEN_HASH = '7512b6be2f3c7eb9155fef75cab68131045c0c5fb9084675864a46bcad1aa3c4';
const GOLDEN_HASH_2 = 'fae95a1da1cc38153dd72c08acb7467e1141377b1bbdfacfa8670852a51409de';

test('joining a backup: extends, same, older, diverged; a correction keeps pointing at the right entry', () => {
  const base = build([dep(5000), buy('KO', 10, 50)]);
  const longer = build([dep(5000), buy('KO', 10, 50), div('KO', 4)]);
  let m = P.mergePortfolioLogs(base, longer);
  assert.ok(m.ok); assert.equal(m.added, 1); assert.equal(m.entries.length, 3);
  m = P.mergePortfolioLogs(longer, base);
  assert.ok(m.ok); assert.equal(m.added, 0); assert.equal(m.entries, longer);
  m = P.mergePortfolioLogs(base, base);
  assert.ok(m.ok); assert.equal(m.added, 0);
  const here = build([dep(5000), buy('KO', 10, 50), fee(2)]);
  const there = build([dep(5000), buy('KO', 10, 50), div('KO', 4), fix(2)]);
  m = P.mergePortfolioLogs(here, there);
  assert.ok(m.ok, m.note);
  assert.equal(m.added, 2);
  assert.ok(P.verifyPortfolioLog(m.entries).ok);
  const fixEntry = m.entries[m.entries.length - 1];
  assert.equal(fixEntry.kind, 'correction');
  assert.equal(m.entries[fixEntry.fixes].kind, 'dividend', 'the correction was renumbered to point at the joined dividend');
  eq(m.entries.slice(0, 3), here, 'nothing here was changed');
  near(P.pfReplay(m.entries).dividends, 0);
  const again = P.mergePortfolioLogs(m.entries, there);
  assert.equal(again.added, 0, 'joining the same backup twice adds nothing');
});

test('joining two records that would be impossible together adds nothing', () => {
  const a = build([dep(1000), buy('KO', 10, 90, 0, '2026-10-02')]);
  const b = build([dep(1000), buy('MSFT', 3, 300, 0, '2026-10-02')]);
  const m = P.mergePortfolioLogs(a, b);
  assert.equal(m.ok, false);
  assert.equal(m.added, 0);
  assert.equal(m.entries, a);
  assert.ok(/impossible|cash/.test(m.note), m.note);
  const bad = a.map((x) => ({ ...x })); bad[0].amount = 1;
  assert.equal(P.mergePortfolioLogs(a, bad).ok, false);
  assert.equal(P.mergePortfolioLogs(bad, a).ok, false);
});

const RULES = { buyCap: 0.1, trimAt: 0.15, sectorMax: 0.4 };
const px = { KO: 100, MSFT: 100, AAPL: 100, SPUS: 100, ZZZ: 100, PG: 100 };
const sectors = { KO: 'Staples', MSFT: 'Tech', AAPL: 'Tech', PG: 'Health' };
const ctx = (o = {}) => ({ priceOf: (t) => px[t] ?? null, kindOf: (t) => (t === 'SPUS' ? 'fund' : 'stock'), sectorOf: (t) => sectors[t] || null, isSwing: () => false, ...o });
const valued = (list, o) => P.pfValue(state(list), ctx(o));

test('position limits use the policy functions and the limits you saved', () => {
  // total 10000: KO 1000 (10%), MSFT 1600 (16%), AAPL 500 (5%), cash 6900
  const v = valued([dep(10000), buy('KO', 10, 100), buy('MSFT', 16, 100), buy('AAPL', 5, 100)]);
  near(v.total, 10000);
  const ex = P.pfExposure(v, RULES);
  const by = (t) => ex.positions.find((p) => p.t === t);
  assert.equal(by('MSFT').state, 'trim');
  near(by('MSFT').trimBy, trimSale(1600, 10000, 0.15, 0.1), 'the same trim as the policy function (back to the buy limit)');
  near(by('MSFT').trimBy, 600);
  assert.equal(by('KO').state, 'at_cap');
  assert.equal(by('AAPL').state, 'ok');
  near(by('AAPL').room, buyRoom(500, 10000, 0.1));
  // a stricter saved limit changes the answer, a looser one too
  const strict = P.pfExposure(v, { ...RULES, buyCap: 0.03, trimAt: 0.04 });
  assert.equal(strict.positions.find((p) => p.t === 'AAPL').state, 'trim');
  const loose = P.pfExposure(v, { ...RULES, buyCap: 0.2, trimAt: 0.3 });
  assert.equal(loose.positions.find((p) => p.t === 'MSFT').state, 'ok');
  // nothing given: the owner's approved defaults
  eq(P.pfRulesOf(), { buyCap: POLICY_RULES.buyCap, trimAt: POLICY_RULES.trimAt, sectorMax: POLICY_RULES.sectorMax, minOrder: POLICY_RULES.minOrder });
  eq(P.pfRulesOf({ buyCap: -1, trimAt: 'x' }), P.pfRulesOf());
});

test('a trim under the minimum order is flagged, not hidden', () => {
  const v = valued([dep(1000), buy('KO', 1, 100), buy('MSFT', 1, 100)]);
  const ex = P.pfExposure(v, { buyCap: 0.05, trimAt: 0.09, sectorMax: 0.4 });
  const k = ex.positions.find((p) => p.t === 'KO');
  assert.equal(k.state, 'trim_small');
  assert.ok(k.text.includes('under the $100'));
});

test('funds and sukuk are outside the one-stock limits; short-term trades are outside the sector limit', () => {
  const v = valued([dep(10000), buy('SPUS', 50, 100), buy('MSFT', 5, 100)], { isSwing: (t) => t === 'MSFT' });
  const ex = P.pfExposure(v, RULES);
  assert.equal(ex.positions.find((p) => p.t === 'SPUS').state, 'fund');
  eq(ex.sectors, [], 'a fund and a swing trade are not in the long-term sector measure');
  assert.equal(ex.stocksValue, 0);
});

test('the sector limit is a share of the long-term stocks, measured before a buy, as in the policy', () => {
  const v = valued([dep(10000), buy('MSFT', 5, 100), buy('AAPL', 4, 100), buy('KO', 3, 100)]);
  const ex = P.pfExposure(v, RULES);
  const tech = ex.sectors.find((s) => s.sector === 'Tech');
  near(tech.share, 900 / 1200);
  assert.equal(tech.open, false);
  assert.equal(tech.open, sectorOpen(900, 1200, 0.4));
  assert.equal(ex.sectors.find((s) => s.sector === 'Staples').open, true);
  const unknown = valued([dep(1000), buy('ZZZ', 1, 100)]);
  const u = P.pfExposure(unknown, RULES).sectors[0];
  assert.equal(u.known, false);
  assert.equal(u.open, true, 'an unknown sector is neither blocked nor passed: the text says it cannot be checked');
  assert.ok(u.text.includes('cannot be checked'));
});

test('the buy check names every rule and agrees with the policy functions', () => {
  // total 10000: KO 300, MSFT 400, AAPL 300, PG 500 (long-term stocks 1500; tech is 700 of it = 47%)
  const list = [dep(10000), buy('KO', 3, 100), buy('MSFT', 4, 100), buy('AAPL', 3, 100), buy('PG', 5, 100)];
  const v = valued(list);
  const ok = { ok: true, reason: '' };
  const c = (plan, shariah = () => ok) => P.pfBuyCheck(v, RULES, ctx({ shariah }), plan);
  const state_ = (r, rule) => r.checks.find((x) => x.rule === rule).state;
  // 700 more of KO is within the limit (room 700), 701 is not
  assert.equal(state_(c({ t: 'KO', amount: 700 }), 'buyCap'), 'pass');
  near(buyRoom(300, 10000, 0.1), 700);
  assert.equal(state_(c({ t: 'KO', amount: 701 }), 'buyCap'), 'fail');
  assert.equal(c({ t: 'KO', amount: 701 }).ok, false);
  // under the minimum order
  assert.equal(state_(c({ t: 'KO', amount: 99 }), 'minOrder'), 'fail');
  assert.equal(worthAnOrder(99), false);
  assert.equal(state_(c({ t: 'KO', amount: 100 }), 'minOrder'), 'pass');
  // not enough cash
  assert.equal(state_(c({ t: 'ZZZ', amount: 99999 }), 'cash'), 'fail');
  // sector: tech is 700 of 1500 = 47% of the long-term stocks, above the 40% limit
  assert.equal(state_(c({ t: 'MSFT', amount: 100 }), 'sector'), 'fail');
  assert.equal(state_(c({ t: 'KO', amount: 100 }), 'sector'), 'pass');
  assert.equal(state_(c({ t: 'ZZZ', amount: 100 }), 'sector'), 'unknown');
  // the Shariah ledger answer is passed through, never decided here
  const sh = c({ t: 'KO', amount: 100 }, () => ({ ok: false, reason: 'no current Zoya check is recorded' }));
  assert.equal(state_(sh, 'shariah'), 'fail');
  assert.equal(sh.ok, false);
  assert.ok(sh.checks.find((x) => x.rule === 'shariah').text.includes('no current Zoya check'));
  assert.equal(state_(P.pfBuyCheck(v, RULES, ctx(), { t: 'KO', amount: 100 }), 'shariah'), 'unknown');
  // a fund only needs cash
  const f = P.pfBuyCheck(v, RULES, ctx(), { t: 'SPUS', amount: 3000 });
  eq(f.checks.map((x) => x.rule), ['cash']);
  assert.equal(f.ok, true);
  // an empty ledger cannot work out a size limit and says so
  const none = P.pfBuyCheck(P.pfValue(state([]), ctx()), RULES, ctx(), { t: 'KO', amount: 200 });
  assert.equal(none.checks.find((x) => x.rule === 'buyCap').state, 'unknown');
  // the checks can be saved with the entry as they are
  const saved = add(build([dep(10000)]), buy('KO', 12, 100, 0, '2026-10-02', { rules: c({ t: 'KO', amount: 1200 }).checks, acknowledged: true }));
  assert.ok(saved.ok, saved.errors.join('; '));
});

test('a sale preview shows what would be realized without recording anything', () => {
  const s = state([dep(5000), buy('KO', 10, 60, 1), buy('KO', 10, 70, 1)]);
  const p = P.pfSellPreview(s, { t: 'KO', shares: 5, price: 80, fees: 2 });
  assert.equal(p.ok, true);
  near(p.realized, 5 * 80 - 2 - 5 * 65.1);
  assert.equal(P.pfSellPreview(s, { t: 'KO', shares: 21, price: 80 }).ok, false);
  assert.equal(P.pfSellPreview(s, { t: 'XYZ', shares: 1, price: 80 }).ok, false);
  assert.equal(P.pfSellPreview(s, { t: 'KO', shares: 20, price: 80 }).whole, true);
});

test('comparing with the holdings the page already uses changes nothing and names every difference', () => {
  const s = state([dep(5000), buy('KO', 10, 60), buy('MSFT', 3, 300)]);
  const r = P.pfReconcile(s, [{ t: 'KO', shares: 10 }, { t: 'MSFT', shares: 2 }, { t: 'AAPL', shares: 4 }]);
  const st = Object.fromEntries(r.map((x) => [x.t, x.status]));
  eq(st, { AAPL: 'only_holdings', KO: 'match', MSFT: 'differs' });
  assert.equal(P.pfReconcile(s, [{ t: 'KO', shares: 10.00001 }]).find((x) => x.t === 'KO').status, 'match', 'within rounding');
  assert.equal(P.pfReconcile(s, []).find((x) => x.t === 'KO').status, 'only_ledger');
});

test('opening entries are proposed only for what the ledger lacks, and never guess a cost', () => {
  const s = state([]);
  const p = P.pfProposeOpening(s, [{ t: 'KO', shares: 10, cost: 55 }, { t: 'XYZ', shares: 3 }, { t: 'AAPL', shares: 0, cost: 1 }], 1500, TODAY);
  eq(p.entries.map((e) => e.kind + ':' + (e.t || '')), ['open:KO', 'deposit:']);
  eq(p.skipped, [{ t: 'XYZ', why: 'no average cost recorded' }]);
  const built = build(p.entries);
  near(P.pfReplay(built).cash, 1500);
  const again = P.pfProposeOpening(P.pfReplay(built), [{ t: 'KO', shares: 10, cost: 55 }], 1500, TODAY);
  eq(again.entries, [], 'nothing is proposed twice, and cash is proposed only into an empty ledger');
});

test('value history: one line a day, only from a full valuation, never rewriting a past date', () => {
  const s = state([dep(5000), buy('KO', 10, 60)]);
  const v = P.pfValue(s, ctx());
  const line = P.pfHistLine(v, s, 'abc', '2026-11-05');
  assert.equal(P.pfHistOk(line), true);
  near(line.v, v.total);
  near(line.i, 5000);
  let h = P.pfHistAdd([], line);
  assert.equal(h.hist.length, 1);
  const same = P.pfHistAdd(h.hist, line);
  assert.equal(same.hist.length, 1);
  assert.equal(same.note, 'already saved');
  const later = { ...line, d: '2026-11-06', v: line.v + 10, h: 'def' };
  h = P.pfHistAdd(h.hist, later);
  assert.equal(h.hist.length, 2);
  const redo = P.pfHistAdd(h.hist, { ...later, v: later.v + 5, h: 'ghi' });
  assert.equal(redo.hist.length, 2);
  assert.equal(redo.hist[1].v, later.v + 5, 'the line for the latest date can be replaced');
  const past = P.pfHistAdd(h.hist, { ...line, v: 1 });
  assert.equal(past.ok, false, 'a past date is never changed');
  assert.equal(past.hist[0].v, line.v);
  assert.equal(P.pfHistAdd(h.hist, { d: 'x' }).ok, false);
  const partial = P.pfValue(s, { priceOf: () => null });
  assert.equal(P.pfHistLine(partial, s, 'h', TODAY), null);
  assert.equal(P.pfHistLine(v, s, 'h', '2026-13-01'), null);
  const empty = P.pfValue(state([]), ctx());
  assert.equal(P.pfHistLine(empty, state([]), 'h', TODAY), null, 'nothing to record for an empty ledger');
});

test('history from a backup is added by date and never overwrites a line here', () => {
  const mk = (d, v) => ({ d, v, c: 0, i: 0, n: 1, h: '' });
  const m = P.pfHistMerge([mk('2026-11-01', 10), mk('2026-11-03', 30)], [mk('2026-11-02', 20), mk('2026-11-03', 999), { bad: 1 }]);
  eq(m.hist.map((l) => [l.d, l.v]), [['2026-11-01', 10], ['2026-11-02', 20], ['2026-11-03', 30]]);
  assert.equal(m.added, 1);
  eq(P.pfHistMerge(null, null).hist, []);
});

test('the library imports only hashing, dates and the approved policy functions, and the page carries exactly the same code', () => {
  const src = fs.readFileSync(new URL('../lib/portfolio.js', import.meta.url), 'utf8');
  const imports = [...src.matchAll(/^import .* from '(.*)';$/gm)].map((m) => m[1]);
  eq(imports, ['./shariah-ledger.js', './policy.js']);
  const page = fs.readFileSync(new URL('../index.html', import.meta.url), 'utf8');
  const a = page.indexOf('// ---- portfolio.js (start)');
  const b = page.indexOf('// ---- portfolio.js (end)');
  assert.ok(a > 0 && b > a, 'the page has the portfolio.js block');
  const inPage = page.slice(page.indexOf('\n', a) + 1, b).replace(/\s+$/, '').split('\n').map((l) => l.replace(/^  /, '')).join('\n');
  const mod = src.split('\nexport {')[0].replace(/^import [^\n]*\n/gm, '').replace(/\s+$/, '');
  assert.equal(inPage, mod, 'index.html and lib/portfolio.js must hold the same rules, character for character');
  assert.ok(!/fetch\(|XMLHttpRequest|localStorage|document\./.test(src), 'a pure library: no network, storage or page access');
});

test('the approved limits and shapes are unchanged', () => {
  eq([...P.PF_KINDS], ['open', 'buy', 'sell', 'dividend', 'fee', 'deposit', 'withdraw', 'correction']);
  assert.equal(P.PORTFOLIO_VERSION, 1);
  eq(POLICY_RULES, { buyCap: 0.1, trimAt: 0.15, trimTo: 0.1, sectorMax: 0.4, minOrder: 100 });
});
