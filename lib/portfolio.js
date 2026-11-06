import { sha256Hex, isDateISO, LEDGER_GENESIS } from './shariah-ledger.js';
import { POLICY_RULES, buyRoom, trimSale, sectorOpen, worthAnOrder } from './policy.js';
// The portfolio ledger (stage 6 of the robo-advisor plan, November 2026).
//
// What it is: your own record of the money and the trades behind your portfolio: cash put in and taken out, buys,
// sells, dividends, fees, and positions you already held when you started the record. From that record alone it works
// out what you hold, the average cost of each position, the cash left, the profit and loss you have made (realized)
// and not yet made (unrealized), and how big each position and sector is against the limits you already have. It
// records and measures. It never decides, never changes a verdict, a buy or sell signal, a valuation, a limit or the
// Shariah gate, and nothing in it buys or sells anything.
//
// How it behaves:
//   - Append-only. An entry is never edited or removed. A mistake is answered with a "correction" entry that voids the
//     wrong one (it stays in the history, struck through). Each entry carries the SHA-256 of the one before it, so a
//     changed, removed or reordered entry shows (verifyPortfolioLog). Entries cut off the end show only against the
//     anchor (anchorOf in the ledger block), which is kept apart and travels with the backup file.
//   - Everything else is worked out from the entries, in the order of their dates (ties: the order they were recorded):
//     positions, average cost, cash, realized profit, dividends and fees. Nothing derived is stored, so nothing derived
//     can disagree with the entries. An entry that would make the record impossible is refused: selling more shares
//     than were held that day, or spending more cash than was recorded (that would be borrowing, which the plan rules out).
//   - Average cost: a buy adds its cost (shares x price + fees) to the position; a sale takes out the average cost of the
//     shares sold; realized profit is what the sale brought in after fees, minus that cost. Fees on a buy are part of
//     its cost, fees on a sale reduce its proceeds.
//   - A price that is missing is never guessed. A position without a price is valued at what it cost and marked so, its
//     unrealized result is shown as not available, and the total gain is withheld until every position has a price.
//   - Limits: the one-stock limits (buy cap, trim line), the sector limit and the minimum order are the ones in
//     lib/policy.js, with the values passed in (the owner's saved limits). Funds and sukuk are not under the one-stock
//     limits, as in the rules. Weights here are shares of what this ledger holds (positions at market plus cash).
//   - A buy that breaks a rule can be recorded (it already happened) only after you confirm it, and the rule check
//     of that day is saved with it.
//
// index.html carries the same text between the portfolio.js markers (without the import and export lines), and
// test/portfolio.test.mjs fails if the two copies differ in any way.
const PORTFOLIO_VERSION = 1;
const PF_KINDS = Object.freeze(['open', 'buy', 'sell', 'dividend', 'fee', 'deposit', 'withdraw', 'correction']);
const PF_LIMITS = Object.freeze({ note: 240, reason: 240, rules: 6, ruleName: 24, ruleText: 300 });
const PF_EPS = 1e-6;
const PF_STATES = Object.freeze(['pass', 'fail', 'unknown']);

// ---------------------------------------------------------------- small helpers
const pfNum = (x) => typeof x === 'number' && Number.isFinite(x);
const pfPos = (x) => pfNum(x) && x > 0;
const pfNonNeg = (x) => pfNum(x) && x >= 0;
const pfText = (s, max) => typeof s === 'string' && s.trim().length > 0 && s.length <= max;
const pfRound = (x) => (pfNum(x) ? Math.round(x * 1e6) / 1e6 : x);
const PF_TICKER = /^[A-Z0-9][A-Z0-9.-]{0,14}$/;
const PF_HEX = /^[0-9a-f]{64}$/;
function pfCanon(x) {
  if (x === null || typeof x !== 'object') return JSON.stringify(x);
  if (Array.isArray(x)) return `[${x.map(pfCanon).join(',')}]`;
  return `{${Object.keys(x).filter((k) => x[k] !== undefined).sort().map((k) => `${JSON.stringify(k)}:${pfCanon(x[k])}`).join(',')}}`;
}
function pfHashOf(entry) {
  const { hash, ...rest } = entry;
  return sha256Hex(pfCanon(rest));
}
const pfMoney = (x) => `${x < 0 ? '-' : ''}$${Math.abs(x).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const pfPct = (x, d = 0) => `${(x * 100).toFixed(d)}%`;
const pfShares = (x) => String(Math.round(x * 1e6) / 1e6);

// ---------------------------------------------------------------- the shape of each kind of entry
const PF_FIELDS = {
  open: { req: ['t', 'date', 'shares', 'cost'], opt: ['note'] },
  buy: { req: ['t', 'date', 'shares', 'price', 'fees'], opt: ['note', 'rules', 'acknowledged'] },
  sell: { req: ['t', 'date', 'shares', 'price', 'fees'], opt: ['note'] },
  dividend: { req: ['t', 'date', 'amount'], opt: ['tax', 'note'] },
  fee: { req: ['date', 'amount'], opt: ['t', 'note'] },
  deposit: { req: ['date', 'amount'], opt: ['note'] },
  withdraw: { req: ['date', 'amount'], opt: ['note'] },
  correction: { req: ['fixes', 'reason'], opt: [] },
};
const PF_META = ['v', 'n', 'kind', 'recorded', 'prev', 'hash', 'origin'];
const PF_CHECK = {
  t: (x) => typeof x === 'string' && PF_TICKER.test(x),
  date: (x) => isDateISO(x),
  shares: pfPos, price: pfPos, cost: pfPos, amount: pfPos,
  fees: pfNonNeg, tax: pfNonNeg,
  note: (x) => typeof x === 'string' && x.length > 0 && x.length <= PF_LIMITS.note,
  reason: (x) => pfText(x, PF_LIMITS.reason),
  fixes: (x) => Number.isInteger(x) && x >= 0,
  acknowledged: (x) => x === true,
  rules: (x) => Array.isArray(x) && x.length > 0 && x.length <= PF_LIMITS.rules && x.every((r) => r && typeof r === 'object' && !Array.isArray(r)
    && Object.keys(r).sort().join() === 'rule,state,text' && pfText(r.rule, PF_LIMITS.ruleName) && PF_STATES.includes(r.state) && pfText(r.text, PF_LIMITS.ruleText)),
};
const PF_FIELD_WORDS = { t: 'a ticker', date: 'a real date (YYYY-MM-DD)', shares: 'a number of shares above 0', price: 'a price above 0', cost: 'an average cost above 0', amount: 'an amount above 0', fees: 'fees of 0 or more', tax: 'tax of 0 or more', note: 'a short note', reason: 'a reason', fixes: 'the number of the entry to correct', acknowledged: 'the confirmation', rules: 'the saved rule check' };
function pfShapeProblems(e) {
  const out = [];
  if (!e || typeof e !== 'object' || Array.isArray(e)) return ['not an entry'];
  if (e.v !== PORTFOLIO_VERSION) out.push('unknown version');
  if (!Number.isInteger(e.n) || e.n < 0) out.push('bad number');
  if (typeof e.recorded !== 'string' || !Number.isFinite(Date.parse(e.recorded))) out.push('bad recorded time');
  if (typeof e.prev !== 'string' || !PF_HEX.test(e.prev)) out.push('bad link to the entry before');
  if (typeof e.hash !== 'string' || !PF_HEX.test(e.hash)) out.push('bad hash');
  if (e.origin !== undefined && !(e.origin && typeof e.origin === 'object' && Number.isInteger(e.origin.n) && typeof e.origin.hash === 'string' && PF_HEX.test(e.origin.hash))) out.push('bad origin');
  const spec = PF_FIELDS[e.kind];
  if (!spec) { out.push(`unknown kind "${e.kind}"`); return out; }
  const allowed = new Set([...PF_META, ...spec.req, ...spec.opt]);
  for (const k of Object.keys(e)) if (!allowed.has(k)) out.push(`unexpected field "${k}"`);
  for (const k of spec.req) if (e[k] === undefined) out.push(`${k} is missing`);
  for (const k of [...spec.req, ...spec.opt]) if (e[k] !== undefined && !PF_CHECK[k](e[k])) out.push(`${k} must be ${PF_FIELD_WORDS[k] || 'valid'}`);
  if (e.kind === 'buy' && Array.isArray(e.rules) && e.rules.some((r) => r && r.state === 'fail') && e.acknowledged !== true) out.push('a buy that broke a rule was saved without the confirmation');
  if (e.kind === 'buy' && e.acknowledged === true && !(Array.isArray(e.rules) && e.rules.some((r) => r && r.state === 'fail'))) out.push('a confirmation without a broken rule');
  return out;
}

// ---------------------------------------------------------------- working it all out from the entries
// Returns the positions, the cash, the totals and every problem that makes the record impossible. Entries voided by a
// correction take no part. They are replayed in date order, ties in the order recorded.
function pfReplay(entries) {
  const problems = [];
  const voided = new Set((entries || []).filter((e) => e && e.kind === 'correction').map((e) => e.fixes));
  const live = (entries || []).filter((e) => e && e.kind !== 'correction' && !voided.has(e.n))
    .sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : a.n - b.n));
  const book = new Map(); // every ticker ever recorded: its position and its running totals
  let cash = 0;
  const tot = { deposits: 0, withdrawals: 0, openCost: 0, realized: 0, dividends: 0, tax: 0, tradeFees: 0, otherFees: 0, bought: 0, sold: 0 };
  const trades = [];
  const get = (t) => {
    if (!book.has(t)) book.set(t, { t, shares: 0, cost: 0, realized: 0, dividends: 0, tax: 0, tradeFees: 0, firstDate: null, lastDate: null });
    return book.get(t);
  };
  const touch = (p, d) => { if (!p.firstDate) p.firstDate = d; p.lastDate = d; };
  const at = (e) => `entry ${e.n} (${e.date})`;
  for (const e of live) {
    if (e.kind === 'open') {
      const p = get(e.t); p.shares += e.shares; p.cost += e.shares * e.cost; tot.openCost += e.shares * e.cost; touch(p, e.date);
    } else if (e.kind === 'buy') {
      const p = get(e.t); const c = e.shares * e.price + e.fees;
      p.shares += e.shares; p.cost += c; p.tradeFees += e.fees; tot.tradeFees += e.fees; tot.bought += e.shares * e.price; cash -= c; touch(p, e.date);
    } else if (e.kind === 'sell') {
      const p = get(e.t);
      if (e.shares > p.shares + PF_EPS) { problems.push(`${at(e)}: selling ${pfShares(e.shares)} ${e.t} but only ${pfShares(p.shares)} would be held that day`); continue; }
      const whole = e.shares >= p.shares - PF_EPS;
      const out = whole ? p.cost : (p.cost / p.shares) * e.shares;
      const net = e.shares * e.price - e.fees;
      const realized = net - out;
      trades.push({ n: e.n, date: e.date, t: e.t, shares: e.shares, price: e.price, fees: e.fees, avgCost: out / e.shares, proceeds: net, realized });
      p.shares = whole ? 0 : p.shares - e.shares; p.cost = whole ? 0 : p.cost - out; p.realized += realized; p.tradeFees += e.fees;
      tot.realized += realized; tot.tradeFees += e.fees; tot.sold += e.shares * e.price; cash += net; touch(p, e.date);
    } else if (e.kind === 'dividend') {
      if (!book.has(e.t)) { problems.push(`${at(e)}: a dividend for ${e.t} before any holding of it was recorded`); continue; }
      const p = get(e.t); p.dividends += e.amount; p.tax += e.tax || 0; tot.dividends += e.amount; tot.tax += e.tax || 0; cash += e.amount; touch(p, e.date);
    } else if (e.kind === 'fee') {
      tot.otherFees += e.amount; cash -= e.amount;
    } else if (e.kind === 'deposit') { tot.deposits += e.amount; cash += e.amount; }
    else if (e.kind === 'withdraw') { tot.withdrawals += e.amount; cash -= e.amount; }
    if (cash < -PF_EPS) problems.push(`${at(e)}: cash would go below zero (${pfMoney(cash)}). Record the money you put in first: the plan rules out borrowing`);
  }
  for (const p of book.values()) if (p.shares < PF_EPS) { p.shares = 0; p.cost = 0; }
  const positions = [...book.values()].filter((p) => p.shares > 0).map((p) => ({ ...p, avgCost: p.cost / p.shares })).sort((a, b) => (a.t < b.t ? -1 : 1));
  const closed = [...book.values()].filter((p) => p.shares === 0).map((p) => ({ ...p })).sort((a, b) => (a.t < b.t ? -1 : 1));
  const invested = tot.deposits - tot.withdrawals + tot.openCost;
  return { positions, closed, cash: Math.abs(cash) < PF_EPS ? 0 : cash, ...tot, invested, trades, count: live.length, voided: [...voided].sort((a, b) => a - b), problems };
}

// ---------------------------------------------------------------- building, adding and checking entries
function pfBuild(prevEntries, fields, recordedISO) {
  const n = prevEntries.length;
  const prev = n ? prevEntries[n - 1].hash : LEDGER_GENESIS;
  const body = { v: PORTFOLIO_VERSION, n, ...fields, recorded: recordedISO, prev };
  for (const k of Object.keys(body)) if (body[k] === undefined || body[k] === '') delete body[k];
  return { ...body, hash: pfHashOf(body) };
}
const PF_NUMERIC = ['shares', 'price', 'cost', 'amount', 'fees', 'tax'];
function pfTidy(fields) {
  const o = { ...fields };
  for (const k of ['note', 'reason']) if (typeof o[k] === 'string') { o[k] = o[k].trim(); if (!o[k]) delete o[k]; }
  if (typeof o.t === 'string') { o.t = o.t.trim().toUpperCase(); if (!o.t) delete o.t; }
  for (const k of PF_NUMERIC) if (pfNum(o[k])) o[k] = pfRound(o[k]);
  if ((o.kind === 'buy' || o.kind === 'sell') && o.fees === undefined) o.fees = 0;
  if (o.kind === 'dividend' && (o.tax === 0 || o.tax === undefined)) delete o.tax;
  if (Array.isArray(o.rules)) { o.rules = o.rules.map((r) => (r && typeof r === 'object' && !Array.isArray(r) ? { ...r, text: typeof r.text === 'string' ? r.text.trim() : r.text } : r)); if (!o.rules.length) delete o.rules; }
  if (o.acknowledged !== true) delete o.acknowledged;
  return o;
}
// add one entry. Returns { ok, entries, entry, errors }; the array passed in is never changed.
// today and nowISO are passed in so that tests can fix them.
function appendPortfolio(entries, fields, today, nowISO) {
  const f = pfTidy(fields || {});
  const fail = (...errors) => ({ ok: false, entries, entry: null, errors });
  const chain = verifyPortfolioLog(entries);
  if (!chain.ok) return fail('the record does not pass its integrity check, so nothing can be added until that is looked at');
  if (!isDateISO(today)) return fail('today is not a real date');
  if (!PF_KINDS.includes(f.kind)) return fail(`unknown kind "${f.kind}"`);
  const { kind, ...rest } = f;
  const cand = pfBuild(entries, { kind, ...rest }, nowISO);
  const shape = pfShapeProblems(cand);
  if (shape.length) return fail(...shape);
  if (kind !== 'correction' && cand.date > today) return fail('the date is in the future');
  if (kind === 'correction') {
    const target = entries[f.fixes];
    if (!target) return fail('there is no such entry to correct');
    if (target.kind === 'correction') return fail('a correction cannot be corrected; record the right entry instead');
    if (entries.some((x) => x.kind === 'correction' && x.fixes === f.fixes)) return fail('that entry is already corrected');
  }
  const after = pfReplay([...entries, cand]);
  if (after.problems.length) return fail(kind === 'correction' ? `voiding this entry would make the record impossible: ${after.problems[0]}` : after.problems[0]);
  return { ok: true, entries: [...entries, cand], entry: cand, errors: [] };
}
// check the whole chain: numbering, links, hashes, shapes, references and that the record is possible
function verifyPortfolioLog(entries, today) {
  const problems = [];
  if (!Array.isArray(entries)) return { ok: false, count: 0, head: null, problems: ['the record is not a list'] };
  let prev = LEDGER_GENESIS;
  entries.forEach((e, i) => {
    const at = `entry ${i}`;
    if (!e || typeof e !== 'object') { problems.push(`${at}: not an entry`); return; }
    if (e.n !== i) problems.push(`${at}: numbered ${e.n}, so an entry was removed, added or moved`);
    if (e.prev !== prev) problems.push(`${at}: does not link to the entry before it`);
    if (pfHashOf(e) !== e.hash) problems.push(`${at}: its content does not match its hash (it was changed)`);
    const shape = pfShapeProblems(e);
    for (const s of shape) problems.push(`${at}: ${s}`);
    if (!shape.length && e.kind === 'correction') {
      const tg = entries[e.fixes];
      if (!(e.fixes < i) || !tg || tg.kind === 'correction') problems.push(`${at}: corrects an entry that is not an earlier entry`);
      else if (entries.some((x, j) => j !== i && x && x.kind === 'correction' && x.fixes === e.fixes && j < i)) problems.push(`${at}: that entry was already corrected`);
    }
    if (today && isDateISO(today) && isDateISO(e.date) && e.date > today) problems.push(`${at}: dated in the future`);
    prev = e.hash;
  });
  if (!problems.length) for (const p of pfReplay(entries).problems) problems.push(p);
  const last = entries[entries.length - 1];
  return { ok: problems.length === 0, count: entries.length, head: last && typeof last.hash === 'string' ? last.hash : null, problems };
}

// ---------------------------------------------------------------- joining two copies (a backup into this device)
// Nothing on this device is changed or removed: entries only the backup has are added after the ones here, with the
// number a correction refers to translated and the original number and hash kept in `origin`. If the joined record
// would be impossible (for example cash below zero), nothing is merged.
function mergePortfolioLogs(local, incoming) {
  const a = verifyPortfolioLog(local);
  const b = verifyPortfolioLog(incoming);
  if (!a.ok) return { ok: false, entries: local, added: 0, note: 'The portfolio record on this device does not pass its own check, so nothing was merged.' };
  if (!b.ok) return { ok: false, entries: local, added: 0, note: 'The portfolio record in the backup does not pass its own check, so nothing was merged.' };
  let common = 0;
  while (common < local.length && common < incoming.length && local[common].hash === incoming[common].hash) common++;
  if (common === incoming.length) return { ok: true, entries: local, added: 0, note: common === local.length ? 'The backup portfolio record is the same as this one.' : 'This device already has more than the backup.' };
  if (common === local.length) return { ok: true, entries: incoming.slice(), added: incoming.length - common, note: 'The backup extends this record; the new entries were added.' };
  const known = new Set();
  for (const e of local) { known.add(e.hash); if (e.origin) known.add(e.origin.hash); }
  const map = new Map();
  for (let i = 0; i < common; i++) map.set(i, i);
  let out = local.slice();
  let added = 0;
  for (let i = common; i < incoming.length; i++) {
    const e = incoming[i];
    if (known.has(e.hash)) {
      const same = out.find((x) => x.hash === e.hash || (x.origin && x.origin.hash === e.hash));
      if (same) map.set(i, same.n);
      continue;
    }
    const { n, prev, hash, v, recorded, origin, ...fields } = e;
    if (e.kind === 'correction') {
      if (!map.has(e.fixes)) continue;
      fields.fixes = map.get(e.fixes);
      if (out.some((x) => x.kind === 'correction' && x.fixes === fields.fixes)) continue;
    }
    const next = pfBuild(out, { ...fields, origin: { n: e.n, hash: e.hash } }, recorded);
    out = [...out, next];
    map.set(i, next.n);
    known.add(e.hash);
    added++;
  }
  const check = verifyPortfolioLog(out);
  if (!check.ok) return { ok: false, entries: local, added: 0, note: `Joining the two records would make the record impossible (${check.problems[0]}), so nothing was merged.` };
  return { ok: true, entries: out, added, note: added ? `${added} entr${added === 1 ? 'y' : 'ies'} from the backup were added after the ones on this device.` : 'Nothing new in the backup.' };
}

// ---------------------------------------------------------------- valuing what is held
// ctx: priceOf(t) -> a price in dollars or null; kindOf(t) -> 'stock' | 'fund' (default stock); sectorOf(t) -> a sector or
// null; isSwing(t) -> true for a short-term trade (outside the sector limit, as in the rules).
function pfValue(state, ctx = {}) {
  const priceOf = ctx.priceOf || (() => null);
  const rows = state.positions.map((p) => {
    const px = priceOf(p.t);
    const priced = pfPos(px);
    const value = priced ? px * p.shares : p.cost;
    const kind = ctx.kindOf ? ctx.kindOf(p.t) : 'stock';
    return {
      t: p.t, shares: p.shares, avgCost: p.avgCost, cost: p.cost, price: priced ? px : null, priced, value,
      unrealized: priced ? value - p.cost : null, unrealizedPct: priced && p.cost > 0 ? (value - p.cost) / p.cost : null,
      kind, sector: kind === 'stock' ? ((ctx.sectorOf && ctx.sectorOf(p.t)) || null) : null, swing: kind === 'stock' && !!(ctx.isSwing && ctx.isSwing(p.t)),
      realized: p.realized, dividends: p.dividends, firstDate: p.firstDate,
    };
  });
  const positionsValue = rows.reduce((s, r) => s + r.value, 0);
  const total = positionsValue + state.cash;
  for (const r of rows) r.weight = total > 0 ? r.value / total : 0;
  const unpriced = rows.filter((r) => !r.priced).map((r) => r.t);
  const complete = unpriced.length === 0;
  const unrealized = rows.filter((r) => r.priced).reduce((s, r) => s + r.unrealized, 0);
  return {
    rows, cash: state.cash, positionsValue, total, unpriced, complete, unrealized,
    cashWeight: total > 0 ? state.cash / total : 0,
    // the whole gain is only worked out when every position has a price; otherwise it would be a guess
    gain: complete ? total - state.invested : null,
    gainPct: complete && state.invested > 0 ? (total - state.invested) / state.invested : null,
  };
}

// ---------------------------------------------------------------- the limits you already have, applied to the ledger
// rules: { buyCap, trimAt, sectorMax, minOrder? } (your saved limits; the defaults are POLICY_RULES)
function pfRulesOf(rules) {
  const r = rules || {};
  return { buyCap: pfPos(r.buyCap) ? r.buyCap : POLICY_RULES.buyCap, trimAt: pfPos(r.trimAt) ? r.trimAt : POLICY_RULES.trimAt, sectorMax: pfPos(r.sectorMax) ? r.sectorMax : POLICY_RULES.sectorMax, minOrder: pfPos(r.minOrder) ? r.minOrder : POLICY_RULES.minOrder };
}
function pfExposure(valued, rules) {
  const L = pfRulesOf(rules);
  const total = valued.total;
  const positions = valued.rows.map((r) => {
    if (r.kind !== 'stock') return { t: r.t, weight: r.weight, state: 'fund', trimBy: 0, text: 'A fund or sukuk line: the one-stock limits do not apply to it.' };
    const sale = trimSale(r.value, total, L.trimAt, L.buyCap);
    if (sale > 0) {
      return worthAnOrder(sale, L.minOrder)
        ? { t: r.t, weight: r.weight, state: 'trim', trimBy: sale, text: `${pfPct(r.weight, 1)} of the ledger, above your ${pfPct(L.trimAt)} line: the size rule trims about ${pfMoney(sale)} to bring it back to ${pfPct(L.buyCap)}.` }
        : { t: r.t, weight: r.weight, state: 'trim_small', trimBy: sale, text: `${pfPct(r.weight, 1)} of the ledger, above your ${pfPct(L.trimAt)} line, but the trim (${pfMoney(sale)}) is under the ${pfMoney(L.minOrder)} an order needs.` };
    }
    const room = buyRoom(r.value, total, L.buyCap);
    if (!(room > 0)) return { t: r.t, weight: r.weight, state: 'at_cap', trimBy: 0, text: `${pfPct(r.weight, 1)} of the ledger: at your ${pfPct(L.buyCap)} limit, so no more buying.` };
    return { t: r.t, weight: r.weight, state: 'ok', trimBy: 0, room, text: `${pfPct(r.weight, 1)} of the ledger: room for ${worthAnOrder(room, L.minOrder) ? pfMoney(room) : `${pfMoney(room)} (under the ${pfMoney(L.minOrder)} an order needs)`} more under your ${pfPct(L.buyCap)} limit.` };
  });
  // the sector limit is a share of the long-term stocks only
  const lt = valued.rows.filter((r) => r.kind === 'stock' && !r.swing);
  const stocksValue = lt.reduce((s, r) => s + r.value, 0);
  const by = new Map();
  for (const r of lt) { const k = r.sector || 'Sector unknown'; by.set(k, (by.get(k) || 0) + r.value); }
  const sectors = [...by].map(([sector, value]) => {
    const share = stocksValue > 0 ? value / stocksValue : 0;
    const open = sector === 'Sector unknown' ? true : sectorOpen(value, stocksValue, L.sectorMax);
    return { sector, value, share, open, known: sector !== 'Sector unknown', text: sector === 'Sector unknown' ? 'The site has no sector for these, so the sector limit cannot be checked for them.' : open ? `${pfPct(share, 0)} of your long-term stocks, under the ${pfPct(L.sectorMax)} limit.` : `${pfPct(share, 0)} of your long-term stocks: at or above the ${pfPct(L.sectorMax)} limit, so no new money here.` };
  }).sort((a, b) => b.value - a.value);
  return { positions, sectors, stocksValue, rules: L };
}
// the rule check for a buy of `amount` dollars of ticker t (before it, or as it was when you made it).
// ctx.shariah(t) -> { ok, reason } is the Shariah ledger's answer, passed in by the page (null: not available).
function pfBuyCheck(valued, rules, ctx, plan) {
  const L = pfRulesOf(rules);
  const t = plan.t;
  const amount = plan.amount;
  const checks = [];
  const kind = ctx && ctx.kindOf ? ctx.kindOf(t) : 'stock';
  const row = valued.rows.find((r) => r.t === t);
  const held = row ? row.value : 0;
  const total = valued.total;
  checks.push(amount <= valued.cash + PF_EPS
    ? { rule: 'cash', state: 'pass', text: `Cash recorded: ${pfMoney(valued.cash)}.` }
    : { rule: 'cash', state: 'fail', text: `This needs ${pfMoney(amount)} but the ledger holds ${pfMoney(valued.cash)} in cash. Record the money you put in first: borrowing is ruled out.` });
  if (kind !== 'stock') return { ok: checks.every((c) => c.state !== 'fail'), checks };
  checks.push(worthAnOrder(amount, L.minOrder)
    ? { rule: 'minOrder', state: 'pass', text: `At least the ${pfMoney(L.minOrder)} an order needs.` }
    : { rule: 'minOrder', state: 'fail', text: `${pfMoney(amount)} is under the ${pfMoney(L.minOrder)} an order needs.` });
  if (!(total > 0)) checks.push({ rule: 'buyCap', state: 'unknown', text: 'No value is recorded yet, so the one-stock limit cannot be worked out.' });
  else {
    const room = buyRoom(held, total, L.buyCap);
    checks.push(amount <= room + PF_EPS
      ? { rule: 'buyCap', state: 'pass', text: `It takes ${t} to ${pfPct((held + amount) / total, 1)} of the ledger, within your ${pfPct(L.buyCap)} limit (room: ${pfMoney(room)}).` }
      : { rule: 'buyCap', state: 'fail', text: `It takes ${t} to ${pfPct((held + amount) / total, 1)} of the ledger; your limit for one stock is ${pfPct(L.buyCap)} (room: ${pfMoney(room)}).` });
  }
  const sector = ctx && ctx.sectorOf ? ctx.sectorOf(t) : null;
  const swing = !!(ctx && ctx.isSwing && ctx.isSwing(t));
  if (swing) checks.push({ rule: 'sector', state: 'pass', text: 'A short-term trade: outside the sector limit.' });
  else if (!sector) checks.push({ rule: 'sector', state: 'unknown', text: 'The site has no sector for it, so the sector limit could not be checked.' });
  else {
    const ex = pfExposure(valued, L);
    const cur = ex.sectors.find((s) => s.sector === sector);
    const open = !cur || sectorOpen(cur.value, ex.stocksValue, L.sectorMax);
    checks.push(open ? { rule: 'sector', state: 'pass', text: `${sector} is ${pfPct(cur ? cur.share : 0)} of your long-term stocks, under the ${pfPct(L.sectorMax)} limit.` }
      : { rule: 'sector', state: 'fail', text: `${sector} is already ${pfPct(cur.share)} of your long-term stocks; the limit stops new money in a sector at ${pfPct(L.sectorMax)}.` });
  }
  const sh = ctx && ctx.shariah ? ctx.shariah(t) : null;
  checks.push(!sh ? { rule: 'shariah', state: 'unknown', text: 'The Shariah ledger answer was not available.' }
    : sh.ok ? { rule: 'shariah', state: 'pass', text: 'The Shariah ledger has a current Zoya check that says compliant.' }
      : { rule: 'shariah', state: 'fail', text: `Shariah ledger: ${sh.reason}` });
  return { ok: checks.every((c) => c.state !== 'fail'), checks };
}
// what a sale would realize, before it is recorded
function pfSellPreview(state, plan) {
  const p = state.positions.find((x) => x.t === plan.t);
  if (!p) return { ok: false, error: `${plan.t} is not held in the ledger` };
  if (plan.shares > p.shares + PF_EPS) return { ok: false, error: `only ${pfShares(p.shares)} ${plan.t} held` };
  const whole = plan.shares >= p.shares - PF_EPS;
  const out = whole ? p.cost : (p.cost / p.shares) * plan.shares;
  const net = plan.shares * plan.price - (plan.fees || 0);
  return { ok: true, avgCost: p.avgCost, proceeds: net, costOut: out, realized: net - out, whole };
}

// ---------------------------------------------------------------- the holdings the rest of the page already uses
// holdings: [{ t, shares, cost }] from "Your portfolio now". Nothing is written; this only compares.
function pfReconcile(state, holdings) {
  const led = new Map(state.positions.map((p) => [p.t, p.shares]));
  const had = new Map();
  for (const h of holdings || []) if (h && h.t && pfPos(h.shares)) had.set(h.t, (had.get(h.t) || 0) + h.shares);
  const tickers = [...new Set([...led.keys(), ...had.keys()])].sort();
  return tickers.map((t) => {
    const a = led.get(t) || 0;
    const b = had.get(t) || 0;
    const status = a && !b ? 'only_ledger' : !a && b ? 'only_holdings' : Math.abs(a - b) <= 1e-4 ? 'match' : 'differs';
    return { t, ledger: a, holdings: b, status };
  });
}
// the opening entries that would bring the current holdings (and cash) into an empty or partly filled ledger.
// A holding with no cost is skipped and named: its average cost would be a guess.
function pfProposeOpening(state, holdings, cashNow, today) {
  const known = new Set([...state.positions, ...state.closed].map((p) => p.t));
  const entries = [];
  const skipped = [];
  for (const h of holdings || []) {
    if (!h || !h.t || known.has(h.t)) continue;
    if (!pfPos(h.shares)) continue;
    if (!pfPos(h.cost)) { skipped.push({ t: h.t, why: 'no average cost recorded' }); continue; }
    entries.push({ kind: 'open', t: h.t, date: today, shares: h.shares, cost: h.cost, note: 'Opening position from Your portfolio' });
  }
  if (pfPos(cashNow) && state.count === 0) entries.push({ kind: 'deposit', date: today, amount: cashNow, note: 'Opening cash from Your portfolio' });
  return { entries, skipped };
}

// ---------------------------------------------------------------- value history
// One line per date, saved only when every position had a price (a partial total would be a guess). h = the ledger head
// the line was taken at. Past dates are never changed; the line for the latest date can be replaced while that date lasts.
const PF_HIST_KEYS = ['d', 'v', 'c', 'i', 'n', 'h'];
function pfHistLine(valued, state, head, date) {
  if (!isDateISO(date) || !valued.complete || (!valued.rows.length && !(valued.cash > 0))) return null;
  return { d: date, v: pfRound(valued.total), c: pfRound(valued.cash), i: pfRound(state.invested), n: valued.rows.length, h: head || '' };
}
function pfHistOk(l) {
  return !!l && typeof l === 'object' && Object.keys(l).sort().join() === [...PF_HIST_KEYS].sort().join() && isDateISO(l.d) && pfNonNeg(l.v) && pfNonNeg(l.c) && pfNum(l.i) && Number.isInteger(l.n) && l.n >= 0 && typeof l.h === 'string';
}
function pfHistAdd(hist, line) {
  const list = Array.isArray(hist) ? hist.filter(pfHistOk) : [];
  if (!pfHistOk(line)) return { ok: false, hist: list, note: 'no line to add' };
  const last = list.length ? list[list.length - 1] : null;
  if (last && line.d < last.d) return { ok: false, hist: list, note: 'an earlier date than the last line; past lines are never changed' };
  if (last && line.d === last.d) {
    if (last.h === line.h && last.v === line.v) return { ok: true, hist: list, note: 'already saved' };
    return { ok: true, hist: [...list.slice(0, -1), line], note: 'replaced the line for today' };
  }
  return { ok: true, hist: [...list, line], note: 'added' };
}
function pfHistMerge(local, incoming) {
  const a = Array.isArray(local) ? local.filter(pfHistOk) : [];
  const b = Array.isArray(incoming) ? incoming.filter(pfHistOk) : [];
  const have = new Set(a.map((l) => l.d));
  const add = b.filter((l) => !have.has(l.d));
  const out = [...a, ...add].sort((x, y) => (x.d < y.d ? -1 : 1));
  return { hist: out, added: add.length };
}

export {
  PORTFOLIO_VERSION, PF_KINDS, PF_LIMITS,
  appendPortfolio, verifyPortfolioLog, mergePortfolioLogs, pfReplay, pfValue, pfExposure, pfBuyCheck, pfSellPreview,
  pfReconcile, pfProposeOpening, pfHistLine, pfHistAdd, pfHistMerge, pfHistOk, pfShapeProblems, pfRulesOf,
};
