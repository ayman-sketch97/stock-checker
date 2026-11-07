// Tests for the investment reports (stage 7): what is sourced, calculated or unavailable, every blocker that withholds a
// report, the call for each strategy, the draft thesis, saving a report as a stage 5 decision, and that nothing here can
// change a verdict, a signal, a valuation, a limit or the Shariah gate.
// Run: node --test test/intel.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import * as I from '../lib/intel.js';
import * as TH from '../lib/thesis.js';

const eq = assert.deepEqual;
const TODAY = '2026-11-06';
const NOW = '2026-11-06T10:00:00.000Z';
const load = (f) => JSON.parse(fs.readFileSync(new URL(`./fixtures/${f}`, import.meta.url), 'utf8'));
const clone = (x) => JSON.parse(JSON.stringify(x));

const healthOk = () => ({
  builtAt: '2026-11-06T02:00:00.000Z',
  checks: [
    { id: 'coverage', status: 'ok', label: 'Companies analysed' }, { id: 'history', status: 'ok', label: 'Price history' }, { id: 'record', status: 'ok', label: 'Permanent record' },
    { id: 'lt', status: 'ok', label: '10-year test' },
  ],
});
// fresh inputs for KO as of the fixture, moved to the days around TODAY
function inputs(over = {}) {
  const d = load('stock-ok.json');
  const T = load('tech-ok.json');
  d.freshness.priceDate = '2026-11-05';
  d.priceTime = 'close on 2026-11-05';
  d.freshness.balanceSheetDate = '2026-09-30';
  d.freshness.daysSinceBalanceSheet = 36;
  d.nextEarnings = { date: '2026-11-20' };
  d.filings = [{ form: '8-K', filed: '2026-10-28', items: ['2.02'] }];
  T.asOf = '2026-11-05';
  const ctx = {
    screenDate: '2026-11-05', health: healthOk(), swingProven: false, swingNote: 'Real money only after at least 6 months of live signals.', owned: false, weight: null,
    sizeSale: 0, limits: { buyCap: 0.1 }, holdingsEntered: true, buy: { ok: true, why: [], room: 5000 }, ledger: { ok: true, reason: 'the Zoya check of 2026-10-01 says compliant' },
    live: null, swingTrade: null,
  };
  const r = { today: TODAY, d, T, ctx };
  for (const [k, v] of Object.entries(over)) {
    if (k === 'd') Object.assign(r.d, v);
    else if (k === 'ctx') Object.assign(r.ctx, v);
    else r[k] = v;
  }
  return r;
}
const gather = (over) => I.intelGather(inputs(over));
const report = (strategy, over) => I.intelReport(gather(over), strategy);
const ids = (arr) => arr.map((x) => x.id);
// an active swing setup on the chart
const activeSwing = { setup: 'pullback', status: 'active', entry: 47.4, stop: 45.94, maxEntry: 48.13, target1: 50.13, target2: 51.79, riskPct: 0.0309, fill: 'stop', trigger: 'Buy above the prior high.' };
const withSetup = (s) => { const x = inputs(); x.T.setup = { ...x.T.setup, ...s }; return x; };

test('approved definitions and constants', () => {
  eq([...I.INTEL_STRATEGIES], ['long', 'position', 'swing']);
  eq(I.INTEL_STRATEGY.long.span, '1 to 5 years or more');
  eq(I.INTEL_STRATEGY.position.span, 'weeks to months');
  eq(I.INTEL_STRATEGY.swing.span, 'days to weeks');
  eq([...I.INTEL_KINDS], ['sourced', 'calculated', 'unavailable']);
  eq({ ...I.INTEL_RULES }, { lateDays: 2, statementsMaxDays: 270, fullPosition: 0.8, livePriceGap: 0.03 });
  eq({ ...I.INTEL_THESIS_HORIZON }, { long: 'long', position: 'short', swing: 'short' });
  assert.throws(() => I.intelReport(gather(), 'medium'), /unknown strategy/);
});

test('a healthy company gets a ready report for each strategy', () => {
  for (const s of I.INTEL_STRATEGIES) {
    const r = report(s);
    eq(ids(r.blockers), [], `${s}: no blockers`);
    eq(r.status, 'ready');
    assert.ok(r.call && ['buy', 'hold', 'trim', 'sell'].includes(r.call.action));
    eq(r.generated, TODAY);
  }
  const r = report('long');
  eq([r.call.action, r.call.label], ['buy', 'Buy']);
  assert.match(r.call.reasons[0], /\$50\.00 is at or below the buy price \(\$67\.87\)/);
  assert.match(r.call.reasons[0], /allows up to \$5,000\.00 more/);
});

test('gather keeps missing values as null and never fills them in', () => {
  const ev = I.intelGather({ today: TODAY, d: null, T: null, ctx: {} });
  eq([ev.hasAnalysis, ev.price, ev.verdict, ev.plan, ev.fair, ev.dq, ev.tech, ev.health, ev.buy, ev.shariah, ev.priceDate, ev.screenDate], [false, null, null, null, null, null, null, null, null, null, null, null]);
  const r = I.intelReport(ev, 'long');
  eq(r.status, 'withheld');
  eq(r.call, null);
  eq(ids(r.blockers), ['no-analysis']);
  const x = inputs();
  x.d.price = 'abc';
  x.d.freshness.priceDate = '2026-13-45';
  const ev2 = I.intelGather(x);
  eq([ev2.price, ev2.priceDate], [null, null]);
});

// every data problem withholds the report, with the exact reason
const BLOCKS = [
  ['no price', 'long', (x) => { x.d.price = null; }, 'no-price'],
  ['no price date', 'long', (x) => { x.d.freshness.priceDate = null; }, 'no-price-date'],
  ['price two trading days late', 'long', (x) => { x.d.freshness.priceDate = '2026-11-03'; }, 'late-price'],
  ['screen missing', 'long', (x) => { x.ctx.screenDate = null; }, 'no-screen'],
  ['screen late', 'long', (x) => { x.ctx.screenDate = '2026-11-03'; }, 'late-screen'],
  ['Shariah result missing', 'long', (x) => { x.d.labels.shariah = {}; }, 'no-shariah'],
  ['data quality missing', 'long', (x) => { x.d.dataQuality = null; }, 'no-data-quality'],
  ['data quality insufficient', 'long', (x) => { x.d.dataQuality = { level: 'insufficient', reasons: ['capital spending looks incomplete'], limits: [] }; }, 'data-quality'],
  ['statement date missing', 'long', (x) => { x.d.freshness.daysSinceBalanceSheet = null; }, 'no-statement-date'],
  ['statements too old', 'long', (x) => { x.d.freshness.daysSinceBalanceSheet = 271; }, 'old-statements'],
  ['no verdict', 'long', (x) => { x.d.verdict = null; }, 'no-verdict'],
  ['unreliable verdict', 'long', (x) => { x.d.verdict = { code: 'UNRELIABLE' }; }, 'unrated'],
  ['not enough history', 'position', (x) => { x.d.verdict = { code: 'NODATA' }; }, 'unrated'],
  ['financial company', 'long', (x) => { x.d.verdict = { code: 'FINANCIAL' }; }, 'unrated'],
  ['no fair value', 'long', (x) => { x.d.pricePlan = null; x.d.fairValueIssues = ['Cash flow is negative.']; }, 'no-fair-value'],
  ['no chart', 'position', (x) => { x.T = null; }, 'no-chart'],
  ['chart too old', 'swing', (x) => { x.T.asOf = '2026-11-03'; }, 'late-chart'],
  ['chart date missing', 'swing', (x) => { x.T.asOf = null; }, 'no-chart-date'],
  ['trend missing', 'position', (x) => { x.T.trend = null; }, 'no-trend'],
  ['health report missing', 'long', (x) => { x.ctx.health = null; }, 'no-health'],
  ['coverage check failed', 'long', (x) => { x.ctx.health.checks[0].status = 'bad'; }, 'health-coverage'],
  ['record chain broken', 'long', (x) => { x.ctx.health.checks[2].status = 'bad'; }, 'health-record'],
  ['price history source down', 'swing', (x) => { x.ctx.health.checks[1].status = 'bad'; }, 'health-history'],
  ['buy check missing', 'long', (x) => { x.ctx.buy = null; }, 'no-buy-check'],
];
for (const [name, strategy, mutate, id] of BLOCKS) {
  test(`blocked: ${name}`, () => {
    const x = inputs();
    mutate(x);
    const r = I.intelReport(I.intelGather(x), strategy);
    assert.ok(ids(r.blockers).includes(id), `expected ${id}, got ${ids(r.blockers)}`);
    eq(r.status, 'withheld');
    eq(r.call, null, 'no call is given');
    eq(I.intelDecision(r, {}, TODAY), null, 'a withheld report cannot be saved as a decision');
    for (const b of r.blockers) assert.ok(b.text.length > 10);
  });
}

test('blockers depend on the strategy: a swing report needs no statements, a long report no chart', () => {
  const x = inputs();
  x.d.freshness.daysSinceBalanceSheet = 400;
  eq(ids(I.intelReport(I.intelGather(x), 'swing').blockers), []);
  eq(ids(I.intelReport(I.intelGather(x), 'long').blockers), ['old-statements']);
  const y = inputs();
  y.T = null;
  eq(ids(I.intelReport(I.intelGather(y), 'long').blockers), []);
  const z = inputs();
  z.ctx.health.checks[1].status = 'bad';
  eq(ids(I.intelReport(I.intelGather(z), 'long').blockers), [], 'a price-history failure does not stop a long-term report');
  z.ctx.health.checks[0].status = 'bad';
  eq(ids(I.intelReport(I.intelGather(z), 'long').blockers), ['health-coverage']);
});

test('a warning is a caution, not a blocker', () => {
  const x = inputs();
  x.ctx.health.checks[3].status = 'warn';
  x.d.dataQuality = { level: 'limited', reasons: ['only 2 years of cash-flow margins'], limits: [] };
  x.d.verdict.confidence = 'Medium';
  x.d.verdict.confidenceReasons = ['a cyclical business'];
  x.d.freshness.stale = ['statements'];
  const r = I.intelReport(I.intelGather(x), 'long');
  eq(ids(r.blockers), []);
  const c = ids(r.cautions);
  for (const k of ['health-lt', 'data-limit', 'confidence', 'old-statements']) assert.ok(c.includes(k), `caution ${k} missing in ${c}`);
  const y = inputs({ ctx: { holdingsEntered: false } });
  assert.ok(ids(I.intelReport(I.intelGather(y), 'long').cautions).includes('no-holdings'));
});

test('a filing link is only kept when it points at the SEC, and policy stops show only on a hold', () => {
  const x = inputs();
  x.d.sources.find((q) => q.item === 'Revenue').url = 'javascript:alert(1)';
  const by = Object.fromEntries(allFacts(I.intelReport(I.intelGather(x), 'long')).map((f) => [f.id, f]));
  eq(by.revenue.url, null);
  eq(by.netincome.url === null || /^https:\/\/www\.sec\.gov\//.test(by.netincome.url), true);
  const stop = ['Technology is already 45% of your stocks'];
  const hold = report('long', { ctx: { buy: { ok: false, why: stop, room: 0 } } });
  eq([hold.call.action, hold.policyStops], ['hold', stop]);
  const sell = report('long', { d: { labels: { ...inputs().d.labels, shariah: { status: 'fail' } } }, ctx: { owned: true, buy: { ok: false, why: stop, room: 0 } } });
  eq([sell.call.action, sell.policyStops], ['sell', []]);
});

test('the live price is only a caution; the report uses the close', () => {
  const r = report('long', { ctx: { live: { p: 55, open: true, session: TODAY } } });
  assert.ok(ids(r.cautions).includes('live-gap'));
  eq(r.call.action, 'buy');
  assert.ok(!ids(report('long', { ctx: { live: { p: 50.5, open: true, session: TODAY } } }).cautions).includes('live-gap'));
});

// ------------------------------------------------------------------ the calls
const callOf = (s, mutate, owned = false) => {
  const x = inputs({ ctx: { owned } });
  if (mutate) mutate(x);
  return I.intelReport(I.intelGather(x), s).call;
};
test('long term: buy, wait, do not buy', () => {
  eq(callOf('long').action, 'buy');
  const wait = callOf('long', (x) => { x.d.price = 80; });
  eq([wait.action, wait.label], ['hold', 'Wait']);
  assert.match(wait.reasons.join(' '), /above the buy price/);
  const dear = callOf('long', (x) => { x.d.price = 120; });
  eq([dear.action, dear.label], ['hold', 'Do not buy']);
  const weak = callOf('long', (x) => { x.d.verdict.code = 'AVOID_WEAK'; });
  eq([weak.action, weak.label], ['hold', 'Do not buy']);
  const watch = callOf('long', (x) => { x.d.verdict.code = 'WATCH'; });
  eq(watch.action, 'hold', 'a verdict that is not a buy rating never gives a buy');
  const fail = callOf('long', (x) => { x.d.labels.shariah.status = 'fail'; });
  eq([fail.action, fail.label], ['hold', 'Do not buy']);
  const rev = callOf('long', (x) => { x.d.labels.shariah.status = 'review'; });
  eq([rev.action, rev.label], ['hold', 'Wait']);
});
test('long term: a buy that breaks your limits or the Shariah ledger becomes a wait with the reasons', () => {
  const c = callOf('long', (x) => { x.ctx.buy = { ok: false, why: ['it is already 12% of your portfolio, and no buy may take a stock above 10%'], room: 0 }; });
  eq([c.action, c.label], ['hold', 'Wait']);
  assert.match(c.reasons.join(' '), /already 12% of your portfolio/);
});
test('long term: owners hold, add, trim and sell by the Portfolio page rules', () => {
  eq(callOf('long', null, true).action, 'buy');
  eq(callOf('long', null, true).label, 'Add');
  const full = callOf('long', (x) => { x.ctx.weight = 0.09; }, true);
  eq([full.action, full.label], ['hold', 'Hold']);
  eq(callOf('long', (x) => { x.d.price = 80; }, true).action, 'hold');
  const trim = callOf('long', (x) => { x.d.price = 115; }, true);
  eq([trim.action, trim.label], ['trim', 'Trim']);
  const size = callOf('long', (x) => { x.ctx.sizeSale = 1200; x.ctx.weight = 0.2; }, true);
  eq(size.action, 'trim');
  assert.match(size.reasons[0], /Sell about \$1,200\.00/);
  eq(callOf('long', (x) => { x.d.labels.shariah.status = 'fail'; }, true).action, 'sell');
  eq(callOf('long', (x) => { x.d.verdict.code = 'SPECULATIVE'; }, true).action, 'sell');
  eq(callOf('long', (x) => { x.d.labels.shariah.status = 'review'; }, true).action, 'hold');
  const nobuy = callOf('long', (x) => { x.ctx.buy = { ok: false, why: ['Technology is already 45% of your stocks'], room: 0 }; }, true);
  eq(nobuy.action, 'hold');
});
test('position investing reuses the short-hold rules and needs the uptrend', () => {
  const up = callOf('position');
  eq([up.action, up.label], ['buy', 'Buy']);
  const down = callOf('position', (x) => { x.T.trend = 'down'; });
  eq([down.action, down.label], ['hold', 'Wait']);
  assert.match(down.reasons.join(' '), /not up/);
  eq(callOf('position', (x) => { x.T.trend = 'down'; }, true).action, 'sell', 'an owner sells when the uptrend breaks');
  eq(callOf('position', (x) => { x.T.trend = 'weakening'; }, true).action, 'sell');
  eq(callOf('position', (x) => { x.d.price = 80; }).action, 'hold');
  eq(callOf('position', (x) => { x.d.price = 115; }, true).action, 'trim');
  eq(callOf('position', (x) => { x.d.labels.shariah.status = 'fail'; }, true).action, 'sell');
  eq(callOf('position', (x) => { x.ctx.buy = { ok: false, why: ['it fails the halal screen'], room: null }; }).action, 'hold');
  // the long-term report is not affected by the chart
  eq(callOf('long', (x) => { x.T.trend = 'down'; }).action, 'buy');
});
test('swing trading: paper only until the live record passes, and only for an active plan', () => {
  const none = callOf('swing');
  eq([none.action, none.label], ['hold', 'Wait']);
  const x = withSetup(activeSwing);
  const paper = I.intelReport(I.intelGather(x), 'swing').call;
  eq([paper.action, paper.label, paper.paperOnly], ['buy', 'Paper buy', true]);
  assert.match(paper.reasons[0], /Entry \$47\.40, limit \$48\.13, stop \$45\.94, target 1 \$50\.13/);
  x.ctx.swingProven = true;
  const real = I.intelReport(I.intelGather(x), 'swing').call;
  eq([real.label, real.paperOnly], ['Buy', false]);
  const old = withSetup(activeSwing);
  old.today = '2026-11-09';
  old.T.asOf = '2026-11-06';
  old.d.freshness.priceDate = '2026-11-06';
  old.ctx.screenDate = '2026-11-06';
  eq(I.intelReport(I.intelGather(old), 'swing').call.label, 'Paper buy', 'a Friday plan is still good on Monday morning');
  const expired = withSetup(activeSwing);
  expired.today = '2026-11-06';
  expired.T.asOf = '2026-11-04';
  expired.d.freshness.priceDate = '2026-11-05';
  const e = I.intelReport(I.intelGather(expired), 'swing').call;
  eq([e.action, e.label], ['hold', 'Wait']);
  assert.match(e.reasons[0], /expired/);
  const blocked = withSetup(activeSwing);
  blocked.ctx.buy = { ok: false, why: ['its halal status is unresolved: confirm it passes on Zoya first'], room: null };
  eq(I.intelReport(I.intelGather(blocked), 'swing').call.action, 'hold');
  const fail = withSetup(activeSwing);
  fail.d.labels.shariah.status = 'fail';
  eq(I.intelReport(I.intelGather(fail), 'swing').call.label, 'Do not buy');
});
test('swing trading: an open Journal trade is measured against its own stop and target', () => {
  const run = (px, trade) => { const x = inputs({ ctx: { swingTrade: trade } }); x.d.price = px; return I.intelReport(I.intelGather(x), 'swing').call; };
  eq(run(44, { stop: 45, target: 52 }).action, 'sell');
  eq(run(53, { stop: 45, target: 52 }).action, 'trim');
  eq(run(48, { stop: 45, target: 52 }).action, 'hold');
  const none = run(48, { stop: null, target: null });
  eq(none.action, 'hold');
  assert.match(none.reasons[0], /no stop or target/);
});
test('the call is the same whatever else is in the report; it comes from the evidence only', () => {
  const a = report('long');
  const b = report('long');
  eq(JSON.stringify(a), JSON.stringify(b), 'same input, same report');
  const x = inputs();
  const before = JSON.stringify(x);
  I.intelReport(I.intelGather(x), 'long');
  eq(JSON.stringify(x), before, 'the inputs are never changed');
});

// ------------------------------------------------------------------ sourced, calculated, unavailable
const allFacts = (r) => r.facts.flatMap((g) => g.items);
test('every fact is marked sourced, calculated or unavailable, with its source and date', () => {
  for (const s of I.INTEL_STRATEGIES) {
    const r = report(s);
    for (const f of allFacts(r)) {
      assert.ok(I.INTEL_KINDS.includes(f.kind), `${f.id}: kind ${f.kind}`);
      if (f.kind === 'unavailable') eq([f.value, f.source, f.asOf], ['not available', null, null], `${f.id} is shown as not available`);
      else assert.ok(f.source, `${f.id} (${f.kind}) names its source`);
      if (f.kind === 'calculated') assert.match(f.source, /^Calculated by this tool/, `${f.id} says it is calculated`);
    }
  }
  const r = report('long');
  const by = Object.fromEntries(allFacts(r).map((f) => [f.id, f]));
  eq(by.price.kind, 'sourced');
  eq(by.revenue.kind, 'sourced');
  assert.match(by.revenue.source, /^SEC filing 10-K, filed 2025-02-15/);
  assert.match(by.revenue.url, /^https:\/\/www\.sec\.gov\//);
  eq(by.fair.kind, 'calculated');
  eq(by.earnings.kind, 'sourced');
  eq(by.earnings.value, '2026-11-20');
});
test('missing data is shown as not available, never guessed', () => {
  const x = inputs();
  x.d.nextEarnings = null;
  x.d.high52 = null;
  x.d.sources = x.d.sources.filter((s) => s.item !== 'Revenue');
  x.d.fairValue = null;
  x.d.marketCap = null;
  const r = I.intelReport(I.intelGather(x), 'long');
  const by = Object.fromEntries(allFacts(r).map((f) => [f.id, f]));
  for (const k of ['earnings', 'range52', 'revenue', 'fair', 'fairrange', 'upside', 'assumptions', 'marketcap']) eq(by[k].kind, 'unavailable', k);
});

test('catalysts are never invented', () => {
  const x = inputs();
  x.d.nextEarnings = null;
  const none = I.intelReport(I.intelGather(x), 'swing');
  eq(none.catalysts.filter((c) => c.kind === 'sourced'), []);
  assert.match(none.catalystNote, /^No reliable catalyst information is available/);
  assert.match(none.catalystNote, /no news, product, guidance or analyst feed/);
  const past = inputs();
  past.d.nextEarnings = { date: '2026-10-01' };
  eq(I.intelReport(I.intelGather(past), 'swing').catalysts, [], 'a results date in the past is not a catalyst');
  const dated = I.intelReport(I.intelGather(inputs()), 'swing');
  eq(dated.catalysts.map((c) => [c.kind, c.date, c.source]), [['sourced', '2026-11-20', 'Nasdaq earnings calendar']]);
  assert.match(dated.catalystNote, /^Only the dated items above are known/);
  // filings are events that already happened, listed apart from catalysts
  eq(dated.recentFilings.map((f) => f.text), ['8-K filed 2026-10-28, items 2.02']);
  // the draft thesis says so when it has none
  const d = I.intelDraft(none, I.intelGather(x));
  assert.match(d.catalysts[0].text, /^None identified from reliable data/);
});

test('the portfolio record is disclosed and the report never claims a complete picture', () => {
  for (const s of I.INTEL_STRATEGIES) {
    const r = report(s);
    eq(r.portfolio.complete, false);
    assert.match(r.portfolio.text, /Portfolio and Watchlist pages/);
    assert.match(r.portfolio.text, /do not use the Portfolio ledger/);
    assert.match(r.portfolio.text, /not a complete portfolio-risk picture/);
    const w = report(s, { ctx: { owned: true, weight: 0.05 } });
    eq(w.portfolio.complete, false);
  }
  assert.match(report('swing').portfolio.text, /open Journal trades/);
});

test('the wording never claims a company is compliant or halal, and has no em dash', () => {
  for (const s of I.INTEL_STRATEGIES) {
    const r = report(s);
    const x = inputs();
    const text = JSON.stringify([r, I.intelDraft(r, I.intelGather(x)), I.intelDecision(r, {}, TODAY)]);
    assert.ok(!/—|–/.test(text), 'no em dash or en dash');
    for (const line of [...(r.call ? [r.call.headline, ...r.call.reasons] : []), r.notes, r.validation, r.rule, r.portfolio.text]) {
      assert.ok(!/\b(is|are) (shariah |halal )?compliant\b|\bpermissible\b/i.test(line), `claims compliance: ${line}`);
    }
  }
  assert.match(report('long').notes, /Zoya has the final word/);
});

test('strategy rules are stated, and the position strategy says it is unvalidated', () => {
  assert.match(report('long').rule, /Portfolio page’s advice rules exactly as they are/);
  assert.match(report('position').rule, /new in stage 7 and has no rules of its own/);
  assert.match(report('position').rule, /not designed or tested for weeks to months/);
  assert.match(report('position').validation, /^Unvalidated/);
  assert.match(report('swing').rule, /paper trade/);
  assert.match(report('swing').validation, /live signals/);
  assert.match(report('long').validation, /not a prediction or a guarantee/);
});

// every number in the dynamic text of a report comes from the evidence, a fixed rule of this file, or a sum of the evidence
test('provenance: every number in a report can be traced to the evidence', () => {
  const nums = (s) => [...String(s).replace(/\d{4}-\d{2}-\d{2}/g, ' ').replace(/,/g, '').matchAll(/\d+(?:\.\d+)?/g)].map((m) => m[0]);
  const fmt = new Set();
  const addNum = (x) => {
    if (typeof x !== 'number' || !Number.isFinite(x)) return;
    for (const dec of [0, 1, 2]) {
      fmt.add(x.toFixed(dec));
      fmt.add((x * 100).toFixed(dec));
      fmt.add((x / 1e9).toFixed(dec));
      fmt.add((x / 1e6).toFixed(dec));
    }
    fmt.add(String(x));
    fmt.add(String(Math.round(x)));
  };
  const walk = (v) => { if (Array.isArray(v)) v.forEach(walk); else if (v && typeof v === 'object') Object.values(v).forEach(walk); else if (typeof v === 'number') addNum(v); else if (typeof v === 'string') nums(v).forEach((n) => fmt.add(n)); };
  for (const s of ['long', 'position', 'swing']) {
    for (const variant of [{}, { ctx: { owned: true, weight: 0.07, sizeSale: 900, live: { p: 55, open: true, session: TODAY } } }]) {
      const x = inputs(variant);
      if (s === 'swing') x.T.setup = { ...x.T.setup, ...activeSwing };
      walk(x);
      for (const v of Object.values(I.INTEL_RULES)) addNum(v);
      for (const n of [0, 1, 2, 3, 4, 5, 10, 12, 90, 100]) fmt.add(String(n));
      const p = x.d.pricePlan;
      for (const [a, b] of [[p.buyBelow, x.d.price], [p.trimAbove, x.d.price], [55, x.d.price]]) { addNum(1 - a / b); addNum(Math.abs(a / b - 1)); }
      const ev = I.intelGather(x);
      const r = I.intelReport(ev, s);
      const dyn = [];
      if (r.call) dyn.push(r.call.headline, ...r.call.reasons);
      dyn.push(...r.blockers.map((b) => b.text), ...r.cautions.map((b) => b.text), ...r.risks.map((k) => k.text), ...r.catalysts.map((k) => k.text), ...r.recentFilings.map((k) => k.text), ...r.conditions);
      for (const f of allFacts(r)) dyn.push(f.value, f.asOf || '');
      for (const f of r.freshness) dyn.push(f.value, f.note);
      const dr = I.intelDraft(r, ev);
      dyn.push(dr.reason, dr.thesis, ...dr.catalysts.map((k) => k.text), ...dr.risks.map((k) => k.text), ...dr.invalidation.map((k) => k.text));
      for (const line of dyn) for (const n of nums(line)) assert.ok(fmt.has(n) || fmt.has(String(Number(n))), `${s}: the number ${n} in "${line}" is not in the evidence`);
    }
  }
});

// ------------------------------------------------------------------ the draft thesis and saving a decision
const th5 = (r) => ({
  asOf: '2026-11-05', price: 50,
  fundamental: { verdict: 'BUY_STRONG', verdictLabel: 'Strong buy candidate', quality: 88, growth: 60, health: 88, dataQuality: 'high' },
  valuation: { label: 'Undervalued', fair: 79.84, buyBelow: 67.87, trimAbove: 110.21, upside: 0.5969 },
  technical: { trend: 'up' },
  risk: { weight: null, limitsAllowBuy: true, limitNotes: [], dataPaused: false },
  shariah: { screen: 'pass', ledgerOk: true, ledgerNote: 'the Zoya check of 2026-10-01 says compliant' },
});
test('no text anywhere shows a code leak, and the ratings read as numbers', () => {
  for (const s of I.INTEL_STRATEGIES) {
    for (const over of [{}, { ctx: { owned: true, weight: 0.05, sizeSale: 700 } }]) {
      const x = inputs(over);
      if (s === 'swing') x.T.setup = { ...x.T.setup, ...activeSwing };
      const ev = I.intelGather(x);
      const r = I.intelReport(ev, s);
      const strings = [];
      const walk = (v) => { if (Array.isArray(v)) v.forEach(walk); else if (v && typeof v === 'object') Object.values(v).forEach(walk); else if (typeof v === 'string') strings.push(v); };
      walk([r, I.intelDraft(r, ev), I.intelDecision(r, th5(r), TODAY)]);
      for (const t of strings) assert.ok(!/\[object|undefined|NaN|\bnull\b/.test(t), `${s}: leaked text in "${t}"`);
    }
  }
  const by = Object.fromEntries(allFacts(report('long')).map((f) => [f.id, f]));
  eq([by.quality.value, by.health.value, by.growth.value.startsWith('60 of 100')], ['88 of 100', '88 of 100', true]);
  const ev = gather();
  assert.match(I.intelDraft(I.intelReport(ev, 'long'), ev).thesis, /business quality 88 of 100, financial health 88 of 100, growth 60 of 100/);
});

test('a draft thesis is labelled, is accepted by the stage 5 record only when saved by the owner, and keeps nothing by itself', () => {
  for (const s of I.INTEL_STRATEGIES) {
    const x = inputs();
    if (s === 'swing') x.T.setup = { ...x.T.setup, ...activeSwing };
    const ev = I.intelGather(x);
    const r = I.intelReport(ev, s);
    const d = I.intelDraft(r, ev);
    assert.match(d.label, /^Tool draft: not your thesis until you edit it and confirm/);
    eq(d.horizon, I.INTEL_THESIS_HORIZON[s]);
    assert.match(d.thesis, /only restates the tool’s numbers/);
    assert.match(d.thesis, /add that yourself/);
    const entry = { kind: 'thesis', t: 'KO', written: TODAY, stance: d.stance, horizon: d.horizon, reason: `Started from a tool draft of ${TODAY}. ${d.reason}`, thesis: d.thesis, catalysts: d.catalysts, risks: d.risks, invalidation: d.invalidation, evidence: th5(r) };
    const saved = TH.appendThesis([], entry, TODAY, NOW);
    assert.ok(saved.ok, `${s}: ${saved.errors}`);
    // the draft alone writes nothing: it is a plain object
    eq(Object.keys(d).sort(), ['catalysts', 'horizon', 'horizonNote', 'invalidation', 'label', 'reason', 'risks', 'stance', 'thesis'].sort());
  }
  const ev = gather();
  const dl = I.intelDraft(I.intelReport(ev, 'long'), ev);
  assert.match(dl.horizonNote, /Long term/);
  const dp = I.intelDraft(I.intelReport(ev, 'position'), ev);
  assert.match(dp.horizonNote, /no “position” horizon/);
  eq(dp.stance, 'considering');
  const owned = gather({ ctx: { owned: true } });
  eq(I.intelDraft(I.intelReport(owned, 'long'), owned).stance, 'owned');
});
test('a draft for a withheld report says the reason must be written by the owner', () => {
  const x = inputs();
  x.d.freshness.priceDate = '2026-11-02';
  const ev = I.intelGather(x);
  const r = I.intelReport(ev, 'long');
  eq(r.status, 'withheld');
  const d = I.intelDraft(r, ev);
  assert.match(d.reason, /withheld a call today; the reason must be written by you/);
});
test('a report with a call saves as a stage 5 decision with its reasons and the data dates', () => {
  for (const s of I.INTEL_STRATEGIES) {
    const x = inputs();
    if (s === 'swing') x.T.setup = { ...x.T.setup, ...activeSwing };
    const ev = I.intelGather(x);
    const r = I.intelReport(ev, s);
    const dec = I.intelDecision(r, th5(r), TODAY);
    eq([dec.kind, dec.t, dec.decided, dec.source], ['decision', 'KO', TODAY, 'stock']);
    assert.ok(dec.call.length <= 40);
    assert.ok(dec.reasons.length >= 5 && dec.reasons.length <= 12);
    assert.match(dec.reasons.join(' '), /Portfolio record used:/);
    assert.match(dec.reasons.join(' '), /Data dates: Price 2026-11-05/);
    const saved = TH.appendThesis([], dec, TODAY, NOW);
    assert.ok(saved.ok, `${s}: ${saved.errors}`);
    assert.ok(TH.verifyThesisLog(saved.entries, TODAY).ok, 'the stage 5 integrity check accepts it');
    eq(saved.entry.action, r.call.action);
    if (s === 'swing') assert.match(dec.reasons.join(' '), /Paper trade only/);
  }
  // a decision can only be saved for today
  const r = report('long');
  const old = I.intelDecision(r, th5(r), TODAY);
  const bad = TH.appendThesis([], { ...old, decided: '2026-11-01' }, TODAY, NOW);
  eq(bad.ok, false);
});
test('saving after a thesis keeps the thesis as it stood, and the original thesis is untouched', () => {
  const ev = gather();
  const r = I.intelReport(ev, 'long');
  const d = I.intelDraft(r, ev);
  const first = TH.appendThesis([], { kind: 'thesis', t: 'KO', written: TODAY, stance: d.stance, horizon: d.horizon, reason: d.reason, thesis: d.thesis, catalysts: d.catalysts, risks: d.risks, invalidation: d.invalidation, evidence: th5(r) }, TODAY, NOW);
  assert.ok(first.ok);
  const before = JSON.stringify(first.entries[0]);
  const dec = TH.appendThesis(first.entries, I.intelDecision(r, th5(r), TODAY), TODAY, NOW);
  assert.ok(dec.ok, dec.errors);
  eq(JSON.stringify(dec.entries[0]), before, 'the first entry is identical after a decision is added');
  eq(dec.entry.thesisRef.n, 0);
});

// ------------------------------------------------------------------ nothing here decides anything else
test('the library imports nothing, and the page carries exactly the same code', () => {
  const src = fs.readFileSync(new URL('../lib/intel.js', import.meta.url), 'utf8');
  eq([...src.matchAll(/^import .* from '(.*)';$/gm)].map((m) => m[1]), [], 'no imports');
  assert.ok(!/\bfetch\(|localStorage|document\.|XMLHttpRequest/.test(src), 'no network, storage or page access');
  const page = fs.readFileSync(new URL('../index.html', import.meta.url), 'utf8');
  const a = page.indexOf('// ---- intel.js (start)');
  const b = page.indexOf('// ---- intel.js (end)');
  assert.ok(a > 0 && b > a, 'the page has the intel.js block');
  const inPage = page.slice(page.indexOf('\n', a) + 1, b).replace(/\s+$/, '').split('\n').map((l) => l.replace(/^  /, '')).join('\n');
  const mod = src.split('\nexport {')[0].replace(/\s+$/, '');
  assert.equal(inPage, mod, 'index.html and lib/intel.js must hold the same rules, character for character');
});
test('the approved policy, thesis and portfolio libraries are untouched by this stage', async (t) => {
  const { execFileSync } = await import('node:child_process');
  let out;
  try { out = execFileSync('git', ['diff', '--name-only', 'eb24496', 'HEAD', '--', 'lib/policy.js', 'lib/thesis.js', 'lib/portfolio.js', 'lib/records.js', 'lib/engine.js', 'lib/shariah-ledger.js', 'lib/health.js', 'lib/technical.js', 'test/portfolio.test.mjs', 'test/thesis.test.mjs'], { encoding: 'utf8', cwd: new URL('..', import.meta.url) }); } catch { t.skip('the stage 6 commit is not in this checkout'); return; }
  eq(out.trim(), '', 'no earlier stage library or test changed');
});
