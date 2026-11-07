// Tests for lib/alerts.js, the Alert Centre's bookkeeping (stage 9): which alerts are new, which are the same condition seen
// again, when a price level re-arms, what is announced and what the user can dismiss. Pure functions, so the tests are exact.
// Run: node --test test/alerts.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import * as A from '../lib/alerts.js';

const eq = assert.deepEqual;
const H = 3600 * 1000;
const T0 = Date.parse('2026-11-09T14:00:00Z');
const cond = (key, over = {}) => ({ key, type: 'risk', tone: 'warn', t: 'AAA', text: 'Above the trim level ($250.00): consider selling part.', asOf: 'close of Nov 6', px: 251, ...over });

test('sigOf: the wording without its numbers, so a drifting number is the same condition', () => {
  assert.equal(A.sigOf('Above the trim level ($250.00): consider selling part.'), 'Above the trim level (#): consider selling part.');
  assert.equal(A.sigOf('15.2% of everything you own, above your 15% limit: sell about $3,400'), '# of everything you own, above your # limit: sell about #');
  assert.equal(A.sigOf('Earnings in 3 trading days (Nov 12).'), 'Earnings in # trading days (Nov #).');
  assert.equal(A.sigOf('  a   b '), 'a b');
  assert.equal(A.sigOf(null), '');
  assert.notEqual(A.sigOf('Earnings in the next session'), A.sigOf('Earnings in 3 trading days'));
});

test('cleanRule: only a real ticker, a direction and a positive level pass', () => {
  eq(A.cleanRule({ id: 'a', t: ' aapl ', dir: 'above', level: '$1,234.5' }), { id: 'a', t: 'AAPL', dir: 'above', level: 1234.5, on: true, created: '' });
  eq(A.cleanRule({ id: 'a', t: 'brk-b', dir: 'below', level: 400, on: false, created: '2026-11-09' }), { id: 'a', t: 'BRK-B', dir: 'below', level: 400, on: false, created: '2026-11-09' });
  for (const bad of [null, 5, {}, { t: 'AAPL', dir: 'up', level: 10 }, { t: 'AAPL', dir: 'above', level: 0 }, { t: 'AAPL', dir: 'above', level: -3 },
    { t: 'AAPL', dir: 'above', level: 'abc' }, { t: 'AAPL', dir: 'above', level: Infinity }, { t: 'AAPL', dir: 'above', level: 1e9 }, { t: '', dir: 'above', level: 5 }, { t: 'A B', dir: 'above', level: 5 }, { t: '<b>', dir: 'above', level: 5 }]) {
    assert.equal(A.cleanRule(bad), null, JSON.stringify(bad));
  }
});

test('priceMet: crossing, equality and the 1% band that re-arms a level', () => {
  const up = { dir: 'above', level: 100 };
  const dn = { dir: 'below', level: 100 };
  assert.equal(A.priceMet(up, 100, false), true);
  assert.equal(A.priceMet(up, 99.99, false), false);
  assert.equal(A.priceMet(dn, 100, false), true);
  assert.equal(A.priceMet(dn, 100.01, false), false);
  // already open: it stays open until the price is more than 1% back on the other side
  assert.equal(A.priceMet(up, 99.5, true), true);
  assert.equal(A.priceMet(up, 99, true), true);
  assert.equal(A.priceMet(up, 98.99, true), false);
  assert.equal(A.priceMet(dn, 100.5, true), true);
  assert.equal(A.priceMet(dn, 101.01, true), false);
  for (const px of [null, undefined, NaN, 0, -1, '100']) assert.equal(A.priceMet(up, px, false), false, String(px));
  assert.equal(A.priceMet(null, 100, false), false);
  assert.equal(A.priceMet({ dir: 'sideways', level: 100 }, 100, false), false);
});

test('reconcile: the first sighting opens an alert and reports it as fresh', () => {
  const r = A.reconcile([], [cond('risk:AAA:x')], ['risk'], T0);
  assert.equal(r.history.length, 1);
  assert.equal(r.fresh.length, 1);
  const e = r.history[0];
  assert.equal(e.status, 'open');
  assert.equal(e.first, T0);
  assert.equal(e.notified, false);
  assert.equal(e.dismissed, false);
  assert.equal(e.count, 1);
  assert.equal(e.id, `risk:AAA:x@${T0}`);
});

test('reconcile: the same unchanged condition is never fresh again, however often it is checked', () => {
  let hist = A.reconcile([], [cond('k')], ['risk'], T0).history;
  for (let i = 1; i <= 50; i++) {
    const r = A.reconcile(hist, [cond('k')], ['risk'], T0 + i * 4 * 60000);
    assert.equal(r.fresh.length, 0, `check ${i}`);
    assert.equal(r.history.length, 1);
    hist = r.history;
  }
  assert.equal(hist[0].first, T0);
  assert.equal(hist[0].last, T0 + 50 * 4 * 60000);
});

test('reconcile: an open alert is updated in place when its numbers move (wording and price are refreshed)', () => {
  let r = A.reconcile([], [cond('k', { text: '15.2% of everything you own', px: 100, asOf: 'close of Nov 5' })], ['risk'], T0);
  r = A.reconcile(r.history, [cond('k', { text: '15.4% of everything you own', px: 102, asOf: 'close of Nov 6' })], ['risk'], T0 + H);
  assert.equal(r.fresh.length, 0);
  assert.equal(r.history.length, 1);
  assert.equal(r.history[0].text, '15.4% of everything you own');
  assert.equal(r.history[0].px, 102);
  assert.equal(r.history[0].asOf, 'close of Nov 6');
  assert.equal(r.history[0].first, T0);
});

test('reconcile: a condition that ends is closed, kept in the history, and a different condition opens separately', () => {
  let r = A.reconcile([], [cond('a'), cond('b', { t: 'BBB' })], ['risk'], T0);
  assert.equal(r.fresh.length, 2);
  r = A.reconcile(r.history, [cond('b', { t: 'BBB' })], ['risk'], T0 + H);
  const a = r.history.find((e) => e.key === 'a');
  assert.equal(a.status, 'ended');
  assert.equal(a.ended, T0 + H);
  assert.equal(r.history.find((e) => e.key === 'b').status, 'open');
  assert.equal(r.fresh.length, 0);
});

test('reconcile: a type that could not be checked is left exactly as it was (no data is not "all clear")', () => {
  let r = A.reconcile([], [cond('p', { type: 'price' }), cond('r')], ['price', 'risk'], T0);
  const before = JSON.stringify(r.history);
  const r2 = A.reconcile(r.history, [], ['shariah'], T0 + H);
  assert.equal(JSON.stringify(r2.history), before);
  assert.equal(r2.fresh.length, 0);
  // and a condition of an unchecked type is ignored, not opened
  const r3 = A.reconcile([], [cond('x', { type: 'scanner' })], ['risk'], T0);
  assert.equal(r3.history.length, 0);
});

test('reconcile: back within 24 hours re-opens the earlier alert silently; after 24 hours it is a new, fresh alert', () => {
  let r = A.reconcile([], [cond('k')], ['risk'], T0);
  r = A.reconcile(r.history, [], ['risk'], T0 + H);
  r = A.reconcile(r.history, [cond('k')], ['risk'], T0 + 2 * H);
  assert.equal(r.fresh.length, 0);
  assert.equal(r.history.length, 1);
  assert.equal(r.history[0].status, 'open');
  assert.equal(r.history[0].count, 2);
  assert.equal(r.history[0].ended, null);
  // ends again, and returns after more than 24 hours
  r = A.reconcile(r.history, [], ['risk'], T0 + 3 * H);
  r = A.reconcile(r.history, [cond('k')], ['risk'], T0 + 3 * H + 24 * H + 1);
  assert.equal(r.fresh.length, 1);
  assert.equal(r.history.length, 2);
});

test('reconcile: a re-opened alert keeps the user\'s dismissal', () => {
  let r = A.reconcile([], [cond('k')], ['risk'], T0);
  r = { history: A.dismissAlert(r.history, r.history[0].id) };
  r = A.reconcile(r.history, [], ['risk'], T0 + H);
  r = A.reconcile(r.history, [cond('k')], ['risk'], T0 + 2 * H);
  assert.equal(r.history[0].dismissed, true);
  assert.equal(r.fresh.length, 0);
});

test('reconcile: duplicate keys in one check open one alert; bad input is ignored; the inputs are never changed', () => {
  const hist = [];
  const conds = [cond('k'), cond('k'), null, { type: 'risk' }, cond('')];
  const h0 = JSON.stringify(hist);
  const c0 = JSON.stringify(conds);
  const r = A.reconcile(hist, conds, ['risk'], T0);
  assert.equal(r.history.length, 1);
  assert.equal(JSON.stringify(hist), h0);
  assert.equal(JSON.stringify(conds), c0);
  eq(A.reconcile(undefined, undefined, undefined, T0), { history: [], fresh: [] });
  const open = A.reconcile([], [cond('k')], ['risk'], T0).history;
  const snap = JSON.stringify(open);
  A.reconcile(open, [], ['risk'], T0 + H);
  assert.equal(JSON.stringify(open), snap);
});

test('reconcile: the history is capped; open and undismissed alerts are the last to go', () => {
  let hist = [];
  const conds = [];
  for (let i = 0; i < A.MAX_HISTORY + 40; i++) conds.push(cond(`k${i}`, { t: `T${i}` }));
  hist = A.reconcile([], conds, ['risk'], T0).history;
  assert.equal(hist.length, A.MAX_HISTORY + 40, 'open alerts are never dropped to make room');
  // end all, then add one more: the oldest ended ones go
  hist = A.reconcile(hist, [], ['risk'], T0 + H).history;
  hist = A.reconcile(hist, [cond('fresh1')], ['risk'], T0 + 30 * H).history;
  assert.equal(hist.length, A.MAX_HISTORY);
  assert.ok(hist.some((e) => e.key === 'fresh1' && e.status === 'open'));
});

test('takeNotifications: each new alert is announced once, in a marked history, and never again', () => {
  const r = A.reconcile([], [cond('a'), cond('b', { t: 'BBB' })], ['risk'], T0);
  const n = A.takeNotifications(r.history, r.fresh, null);
  assert.equal(n.send.length, 2);
  assert.ok(n.history.every((e) => e.notified));
  assert.equal(r.history.every((e) => !e.notified), true, 'the input history is not changed');
  const again = A.takeNotifications(n.history, r.fresh, null);
  assert.equal(again.send.length, 0);
  // the next check of the same unchanged conditions has nothing fresh at all
  const r2 = A.reconcile(n.history, [cond('a'), cond('b', { t: 'BBB' })], ['risk'], T0 + H);
  assert.equal(A.takeNotifications(r2.history, r2.fresh, null).send.length, 0);
});

test('takeNotifications: a switched-off type is not announced; at most three at once, the rest counted', () => {
  const r = A.reconcile([], [cond('p', { type: 'price' }), cond('r')], ['price', 'risk'], T0);
  const n = A.takeNotifications(r.history, r.fresh, { types: { price: false } });
  eq(n.send.map((e) => e.type), ['risk']);
  const many = A.reconcile([], Array.from({ length: 7 }, (_, i) => cond(`k${i}`, { t: `T${i}` })), ['risk'], T0);
  const m = A.takeNotifications(many.history, many.fresh, null);
  assert.equal(m.send.length, A.MAX_NOTIFY);
  assert.equal(m.more, 4);
  assert.ok(m.history.every((e) => e.notified), 'all seven are marked, so the rest are not announced later either');
});

test('takeNotifications: a dismissed alert is not announced', () => {
  const r = A.reconcile([], [cond('a')], ['risk'], T0);
  const d = A.dismissAlert(r.history, r.history[0].id);
  assert.equal(A.takeNotifications(d, r.fresh.map((e) => ({ ...e, dismissed: true })), null).send.length, 0);
});

test('baseline: turning notifications on does not announce what is already open', () => {
  const r = A.reconcile([], [cond('a'), cond('b', { t: 'BBB' })], ['risk'], T0);
  const b = A.baseline(r.history);
  assert.ok(b.every((e) => e.notified));
  const r2 = A.reconcile(b, [cond('a'), cond('b', { t: 'BBB' }), cond('c', { t: 'CCC' })], ['risk'], T0 + H);
  eq(A.takeNotifications(r2.history, r2.fresh, null).send.map((e) => e.key), ['c']);
});

test('managing alerts: dismiss, restore, dismiss all, delete (ended only), clear history (ended only)', () => {
  const r = A.reconcile([], [cond('a'), cond('b', { t: 'BBB' }), cond('c', { t: 'CCC' })], ['risk'], T0);
  const [a, b, c] = r.history;
  let h = A.dismissAlert(r.history, a.id);
  assert.equal(h.find((e) => e.id === a.id).dismissed, true);
  assert.equal(h.find((e) => e.id === b.id).dismissed, false);
  h = A.restoreAlert(h, a.id);
  assert.equal(h.find((e) => e.id === a.id).dismissed, false);
  h = A.dismissAll(h);
  assert.ok(h.every((e) => e.dismissed));
  // a condition that is still true cannot be deleted (it would only open again as new)
  assert.equal(A.deleteAlert(h, c.id).length, 3);
  // once it has ended it can
  const ended = A.reconcile(h, [cond('a'), cond('b', { t: 'BBB' })], ['risk'], T0 + H).history;
  assert.equal(ended.find((e) => e.id === c.id).status, 'ended');
  assert.equal(A.deleteAlert(ended, c.id).length, 2);
  // clear history: ended alerts go; alerts still true stay, dismissed or not
  assert.deepEqual(A.clearHistory(ended).map((e) => e.key), ['a', 'b']);
  assert.ok(A.clearHistory(ended).every((e) => e.dismissed));
  eq(A.dismissAlert(undefined, 'x'), []);
});

test('a dismissed alert that is still true is not shown again, announced again, or brought back by clearing the history', () => {
  let r = A.reconcile([], [cond('a')], ['risk'], T0);
  let h = A.dismissAlert(r.history, r.history[0].id);
  h = A.clearHistory(h);
  r = A.reconcile(h, [cond('a')], ['risk'], T0 + H);
  assert.equal(r.fresh.length, 0);
  assert.equal(r.history.length, 1);
  assert.equal(r.history[0].dismissed, true);
});

test('cleanStore: unknown or damaged storage becomes an empty, valid object', () => {
  for (const raw of [null, undefined, 5, 'x', [], {}, { rules: 5, hist: 'x', set: 3 }]) {
    const s = A.cleanStore(raw);
    eq(s.rules, []); eq(s.hist, []);
    eq(s.set, { types: { price: true, scanner: true, risk: true, shariah: true }, notify: false });
    assert.equal(s.v, A.ALERT_VERSION);
  }
  const s = A.cleanStore({
    rules: [{ id: 'a', t: 'aapl', dir: 'above', level: 10 }, { id: '', t: 'MSFT', dir: 'above', level: 10 }, { id: 'c', t: 'X', dir: 'nope', level: 10 }, null],
    hist: [{ id: 'h', key: 'k', type: 'risk', text: 'x', status: 'open' }, { id: 'h2', key: 'k', type: 'trade', text: 'x' }, { id: 'h3', key: 'k', type: 'risk' }, 7],
    set: { types: { scanner: false }, notify: 1 },
  });
  eq(s.rules.map((r) => r.t), ['AAPL']);
  eq(s.hist.map((e) => e.id), ['h']);
  eq(s.set, { types: { price: true, scanner: false, risk: true, shariah: true }, notify: true });
  const many = A.cleanStore({ rules: Array.from({ length: 80 }, (_, i) => ({ id: `r${i}`, t: 'AAPL', dir: 'above', level: 10 + i })) });
  assert.equal(many.rules.length, A.MAX_RULES);
});

test('the library is pure and informational: no storage, network, clock, notifications or orders', () => {
  const src = fs.readFileSync(new URL('../lib/alerts.js', import.meta.url), 'utf8');
  const code = src.split('\n').filter((l) => !/^\s*\/\//.test(l)).join('\n');
  for (const word of ['localStorage', 'fetch(', 'Date.now', 'new Date', 'new Notification', 'Notification.', 'XMLHttpRequest', 'import ', 'require(', 'document.', 'window.']) assert.ok(!code.includes(word), `uses ${word}`);
  for (const word of ['buy(', 'sell(', 'placeOrder', 'submitOrder', 'broker', 'execute']) assert.ok(!code.toLowerCase().includes(word.toLowerCase()), `mentions ${word}`);
});

test('the rules are the stated numbers', () => {
  assert.equal(A.HYSTERESIS, 0.01);
  assert.equal(A.REOPEN_MS, 24 * 3600 * 1000);
  assert.equal(A.MAX_NOTIFY, 3);
  eq([...A.ALERT_TYPES], ['price', 'scanner', 'risk', 'shariah']);
});

test('the page carries exactly the same alert rules as lib/alerts.js', () => {
  const page = fs.readFileSync(new URL('../index.html', import.meta.url), 'utf8');
  const a = page.indexOf('// ---- alerts.js (start)');
  const b = page.indexOf('// ---- alerts.js (end)');
  assert.ok(a > 0 && b > a, 'the page has the alerts.js block');
  const inPage = page.slice(page.indexOf('\n', a) + 1, b).replace(/\s+$/, '').split('\n').map((l) => l.replace(/^  /, '')).join('\n');
  const mod = fs.readFileSync(new URL('../lib/alerts.js', import.meta.url), 'utf8').split('\nexport {')[0].replace(/\s+$/, '');
  assert.equal(inPage, mod, 'index.html and lib/alerts.js must hold the same rules, character for character');
});
