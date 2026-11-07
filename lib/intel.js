// Investment reports (stage 7 of the robo-advisor plan, November 2026).
//
// What it is: one report per company and strategy that gathers what the tool already knows (the filings, the price, the
// valuation, the chart, the Shariah screen, your size and sector limits), says whether the data is good enough to
// give a call, and if it is, quotes the call the tool's existing rules produce: buy, hold, trim or sell. It also drafts a
// thesis for you to edit and confirm. It explains and records. It adds no valuation formula, no verdict, no signal, no
// limit and no Shariah rule, and nothing in it buys or sells anything.
//
// Strategies (approved 7 November 2026): long-term investing (1 to 5 years or more), position investing (weeks to
// months), swing trading (days to weeks, paper only until the live record passes its gate).
//
// Every line of a report is one of three kinds, and says which:
//   sourced      read from a filing, a price feed or a calendar, with where and as of when
//   calculated   worked out by this tool from those, with the method named
//   unavailable  not known: shown as "not available", never filled in
//
// A report is withheld (no call at all) when a critical piece of data is missing, old or unreliable. Every blocker is
// listed. Policy stops (an unresolved Shariah screen, your size and sector limits, the Shariah ledger) do not withhold the
// report; they turn a buy into a wait and say why.
//
// Which portfolio record it reads: the holdings you entered on the Portfolio and Watchlist pages, the same ones the
// Portfolio page's advice uses. It does not read the Portfolio ledger (stage 6). The two records stay separate, so the
// report never claims a complete portfolio-risk picture.
//
// index.html carries the same text between the intel.js markers (without the export line), and test/intel.test.mjs
// fails if the two copies differ in any way. This file imports nothing.
const INTEL_VERSION = 1;
const INTEL_STRATEGIES = Object.freeze(['long', 'position', 'swing']);
const INTEL_STRATEGY = Object.freeze({
  long: { label: 'Long-term investing', short: 'long-term', span: '1 to 5 years or more' },
  position: { label: 'Position investing', short: 'position', span: 'weeks to months' },
  swing: { label: 'Swing trading', short: 'swing', span: 'days to weeks' },
});
const INTEL_KINDS = Object.freeze(['sourced', 'calculated', 'unavailable']);
// the numbers this file adds to the evidence (the provenance test lets exactly these through)
const INTEL_RULES = Object.freeze({ lateDays: 2, statementsMaxDays: 270, fullPosition: 0.8, livePriceGap: 0.03 });
// the stage 5 thesis record has three horizons; a draft uses the nearest one and says so
const INTEL_THESIS_HORIZON = Object.freeze({ long: 'long', position: 'short', swing: 'short' });
// health checks (lib/health.js) that withhold a report when they are bad
const INTEL_CRITICAL_CHECKS = Object.freeze({ long: ['coverage', 'record'], position: ['coverage', 'record', 'history'], swing: ['coverage', 'record', 'history'] });
const INTEL_GOOD = Object.freeze(['BUY_STRONG', 'BUY']);
const INTEL_WEAK = Object.freeze(['AVOID_WEAK', 'SPECULATIVE']);
const INTEL_UNRATED = Object.freeze(['UNRELIABLE', 'NODATA', 'FINANCIAL']);
const INTEL_BROKEN = Object.freeze(['down', 'weakening']);
const INTEL_VERDICT_WORD = Object.freeze({
  BUY_STRONG: 'Strong buy candidate', BUY: 'Buy candidate', CONTRARIAN: 'Contrarian', WATCH: 'Watch', LOOK: 'Worth a look', PASS: 'Pass',
  AVOID_WEAK: 'Avoid: weak business', SPECULATIVE: 'Speculative', AVOID_SHARIAH: 'Avoid: fails the Shariah screen', UNRELIABLE: 'No verdict: unreliable data',
  NODATA: 'Not enough history', FINANCIAL: 'Not rated: financial company',
});

// ---------------------------------------------------------------- small helpers
const ivNum = (x) => typeof x === 'number' && Number.isFinite(x);
const ivStr = (x, max = 200) => (typeof x === 'string' && x.trim() ? x.trim().slice(0, max) : null);
function ivISO(s) {
  if (typeof s !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const t = Date.parse(`${s}T00:00:00Z`);
  return Number.isFinite(t) && new Date(t).toISOString().slice(0, 10) === s;
}
const ivMoney = (x) => `$${x.toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ',')}`;
const ivPct = (x, d = 0) => `${(x * 100).toFixed(d)}%`;
function ivBig(x) {
  const a = Math.abs(x);
  const sign = x < 0 ? '-' : '';
  if (a >= 1e9) return `${sign}$${(a / 1e9).toFixed(2)}B`;
  if (a >= 1e6) return `${sign}$${(a / 1e6).toFixed(1)}M`;
  return `${sign}$${Math.round(a).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',')}`;
}
// whole weekdays strictly between two dates (the same count the page's pause rule uses); null if either is not a date
function ivLate(from, to) {
  if (!ivISO(from) || !ivISO(to)) return null;
  if (to <= from) return 0;
  let n = 0;
  for (let t = Date.parse(`${from}T12:00:00Z`) + 86400000; t < Date.parse(`${to}T12:00:00Z`); t += 86400000) {
    const wd = new Date(t).getUTCDay();
    if (wd !== 0 && wd !== 6) n++;
  }
  return n;
}
function ivCut(s, max) {
  const t = String(s).replace(/\s+/g, ' ').trim();
  if (t.length <= max) return t;
  const head = t.slice(0, max - 3);
  const stop = Math.max(head.lastIndexOf('. '), head.lastIndexOf('; '), head.lastIndexOf(', '), head.lastIndexOf(' '));
  return `${head.slice(0, stop > max * 0.5 ? stop : head.length).replace(/[.,;:\s]+$/, '')}...`;
}
function ivFirst(s) {
  const m = /^[\s\S]*?[.!?](\s|$)/.exec(String(s || ''));
  return (m ? m[0] : String(s || '')).trim();
}

// ---------------------------------------------------------------- the evidence
// raw: { today, d, T, ctx }
//   d    the company's full analysis file (data/<ticker>.json), or null
//   T    the chart analysis (data/tech/<ticker>.json), or null
//   ctx  what the page adds: screenDate, health (data/health.json), swingProven and swingNote, owned (a Portfolio-page
//        holding), weight, sizeSale, buy (the page's buy check), limits, live (a delayed live quote), swingTrade
// Nothing is guessed: a missing value stays null and the report says "not available".
function intelGather(raw) {
  const r = raw || {};
  const c = r.ctx || {};
  const d = r.d && typeof r.d === 'object' && r.d.ok !== false ? r.d : null;
  const T = r.T && typeof r.T === 'object' && r.T.ok ? r.T : null;
  const lab = (d && d.labels) || {};
  const fresh = (d && d.freshness) || null;
  const plan = d && d.pricePlan && ivNum(d.pricePlan.buyBelow) && ivNum(d.pricePlan.trimAbove) ? d.pricePlan : null;
  const setup = T && T.setup && typeof T.setup === 'object' ? T.setup : null;
  const h = c.health && Array.isArray(c.health.checks) ? c.health : null;
  const buy = c.buy && typeof c.buy === 'object' ? c.buy : null;
  const trade = c.swingTrade && typeof c.swingTrade === 'object' ? c.swingTrade : null;
  return {
    today: ivISO(r.today) ? r.today : null,
    ticker: ivStr(d && d.ticker, 20) || ivStr(r.ticker, 20),
    name: ivStr(d && d.name, 120),
    hasAnalysis: !!d,
    methodVersion: ivStr(d && d.methodVersion, 20),
    price: d && ivNum(d.price) ? d.price : null,
    priceSource: ivStr(d && d.priceSource, 60),
    priceTime: ivStr(d && d.priceTime, 60),
    priceDate: fresh && ivISO(fresh.priceDate) ? fresh.priceDate : null,
    high52: d && ivNum(d.high52) ? d.high52 : null,
    low52: d && ivNum(d.low52) ? d.low52 : null,
    marketCap: d && ivNum(d.marketCap) ? d.marketCap : null,
    verdict: ivStr(d && d.verdict && d.verdict.code, 30),
    confidence: ivStr(d && d.verdict && d.verdict.confidence, 20),
    confidenceReasons: d && d.verdict && Array.isArray(d.verdict.confidenceReasons) ? d.verdict.confidenceReasons.filter((x) => typeof x === 'string').slice(0, 6) : [],
    quality: lab.quality && ivNum(lab.quality.score) ? lab.quality.score : null,
    healthScore: lab.health && ivNum(lab.health.score) ? lab.health.score : null,
    growth: lab.growth && ivNum(lab.growth.score) ? lab.growth.score : null,
    growthLabel: ivStr(lab.growth && lab.growth.label, 60),
    valuationLabel: ivStr(lab.valuation && lab.valuation.label, 40),
    shariah: lab.shariah && ['pass', 'fail', 'review'].includes(lab.shariah.status) ? lab.shariah.status : null,
    plan,
    fair: d && d.fairValue && ivNum(d.fairValue.base) ? d.fairValue : null,
    fairIssues: d && Array.isArray(d.fairValueIssues) ? d.fairValueIssues.filter((x) => typeof x === 'string').slice(0, 3) : [],
    dq: d && d.dataQuality && ['high', 'limited', 'insufficient'].includes(d.dataQuality.level)
      ? { level: d.dataQuality.level, reasons: (d.dataQuality.reasons || []).filter((x) => typeof x === 'string').slice(0, 8), limits: (d.dataQuality.limits || []).filter((x) => typeof x === 'string').slice(0, 8) } : null,
    fresh: fresh ? {
      balanceSheetDate: ivISO(fresh.balanceSheetDate) ? fresh.balanceSheetDate : null,
      daysSinceBalanceSheet: ivNum(fresh.daysSinceBalanceSheet) ? fresh.daysSinceBalanceSheet : null,
      stale: Array.isArray(fresh.stale) ? fresh.stale.filter((x) => typeof x === 'string') : [],
    } : null,
    sources: d && Array.isArray(d.sources) ? d.sources : [],
    risks: d && Array.isArray(d.risks) ? d.risks.filter((x) => typeof x === 'string').slice(0, 6) : [],
    sellIf: d && Array.isArray(d.sellIf) ? d.sellIf.filter((x) => typeof x === 'string').slice(0, 6) : [],
    nextEarnings: d && d.nextEarnings && ivISO(d.nextEarnings.date) ? { date: d.nextEarnings.date } : null,
    filings: d && Array.isArray(d.filings) ? d.filings.filter((f) => f && typeof f.form === 'string' && ivISO(f.filed)).slice(0, 12) : [],
    tech: T ? {
      asOf: ivISO(T.asOf) ? T.asOf : null,
      close: ivNum(T.close) ? T.close : null,
      trend: ivStr(T.trend, 20),
      trendLabel: ivStr(T.trendLabel, 60),
      regime: ivStr(T.market && T.market.regime, 20),
      earningsSoon: !!(T.earnings && T.earnings.soon),
      setup: setup ? {
        setup: ivStr(setup.setup, 30), status: ivStr(setup.status, 20), entry: ivNum(setup.entry) ? setup.entry : null, stop: ivNum(setup.stop) ? setup.stop : null,
        maxEntry: ivNum(setup.maxEntry) ? setup.maxEntry : null, target1: ivNum(setup.target1) ? setup.target1 : null, target2: ivNum(setup.target2) ? setup.target2 : null,
        riskPct: ivNum(setup.riskPct) ? setup.riskPct : null, trigger: ivStr(setup.trigger, 400),
      } : null,
    } : null,
    screenDate: ivISO(c.screenDate) ? c.screenDate : null,
    health: h ? { builtAt: ivStr(c.health.builtAt, 40), checks: h.checks.filter((k) => k && typeof k.id === 'string').map((k) => ({ id: k.id, status: k.status, label: ivStr(k.label, 60) || k.id })) } : null,
    swingProven: c.swingProven === true,
    swingNote: ivStr(c.swingNote, 600),
    owned: c.owned === true,
    weight: ivNum(c.weight) ? c.weight : null,
    sizeSale: ivNum(c.sizeSale) && c.sizeSale > 0 ? c.sizeSale : 0,
    buyCap: c.limits && ivNum(c.limits.buyCap) ? c.limits.buyCap : null,
    holdingsEntered: c.holdingsEntered === true,
    buy: buy ? { ok: buy.ok === true, why: Array.isArray(buy.why) ? buy.why.filter((x) => typeof x === 'string').slice(0, 6) : [], room: ivNum(buy.room) ? buy.room : null } : null,
    ledger: c.ledger && typeof c.ledger === 'object' ? { ok: c.ledger.ok === true, reason: ivStr(c.ledger.reason, 240) } : null,
    live: c.live && ivNum(c.live.p) ? { p: c.live.p, open: c.live.open === true, session: ivISO(c.live.session) ? c.live.session : null } : null,
    swingTrade: trade ? { stop: ivNum(trade.stop) ? trade.stop : null, target: ivNum(trade.target) ? trade.target : null, paper: trade.paper === true } : null,
  };
}

// ---------------------------------------------------------------- the data gate
// Blockers withhold the whole report. Cautions are shown and change nothing.
function intelGate(ev, strategy) {
  const blockers = [];
  const cautions = [];
  const block = (id, text) => blockers.push({ id, text });
  const warn = (id, text) => cautions.push({ id, text });
  const needFundamentals = strategy !== 'swing';
  const needChart = strategy !== 'long';
  if (!ev.hasAnalysis) {
    block('no-analysis', 'The company’s analysis could not be loaded, so there is nothing to base a call on.');
    return { blockers, cautions };
  }
  if (ev.price === null) block('no-price', 'There is no current price.');
  if (ev.priceDate === null) block('no-price-date', 'The date of the price is not known.');
  const lateP = ivLate(ev.priceDate, ev.today);
  if (lateP !== null && lateP >= INTEL_RULES.lateDays) block('late-price', `The price is from ${ev.priceDate}, ${lateP} trading days ago: the nightly update is late.`);
  if (ev.screenDate === null) block('no-screen', 'The nightly screen could not be read, so the data date and your limits cannot be checked.');
  else {
    const lateS = ivLate(ev.screenDate, ev.today);
    if (lateS !== null && lateS >= INTEL_RULES.lateDays) block('late-screen', `The nightly screen is from ${ev.screenDate}, ${lateS} trading days ago: advice is paused.`);
    if (ev.priceDate && ev.screenDate !== ev.priceDate) warn('dates-differ', `The company file is dated ${ev.priceDate} and the screen ${ev.screenDate}.`);
  }
  if (ev.shariah === null) block('no-shariah', 'The Shariah screen result is missing.');
  if (needFundamentals) {
    if (ev.dq === null) block('no-data-quality', 'The data-quality check is missing.');
    else if (ev.dq.level === 'insufficient') block('data-quality', `The tool rates the data insufficient: ${ev.dq.reasons.join('; ') || 'no reason given'}.`);
    else if (ev.dq.level === 'limited') for (const x of ev.dq.reasons) warn('data-limit', `Data limit: ${x}.`);
    const days = ev.fresh ? ev.fresh.daysSinceBalanceSheet : null;
    if (days === null) block('no-statement-date', 'The date of the latest financial statements is not known.');
    else if (days > INTEL_RULES.statementsMaxDays) block('old-statements', `The latest financial statements are ${days} days old (the limit is ${INTEL_RULES.statementsMaxDays}).`);
    else if (ev.fresh.stale.includes('statements')) warn('old-statements', 'The latest financial statements are more than 4 months old; a newer report may be late.');
    if (ev.verdict === null) block('no-verdict', 'There is no verdict for this company.');
    else if (INTEL_UNRATED.includes(ev.verdict)) block('unrated', `The tool gives this company no usable verdict (${INTEL_VERDICT_WORD[ev.verdict]}).`);
    if (ev.plan === null) block('no-fair-value', `There is no reliable fair-value estimate${ev.fairIssues.length ? `: ${ev.fairIssues[0].replace(/\.$/, '')}` : ''}, so there is no buy or trim price.`);
    if (ev.confidence && ev.confidence !== 'High') warn('confidence', `Confidence in the verdict is ${ev.confidence}${ev.confidenceReasons.length ? `: ${ev.confidenceReasons.join('; ')}` : ''}.`);
  }
  if (needChart) {
    if (ev.tech === null) block('no-chart', 'There is no chart analysis (not enough price history, or the file could not be loaded).');
    else {
      const lateT = ivLate(ev.tech.asOf, ev.today);
      if (ev.tech.asOf === null) block('no-chart-date', 'The date of the chart analysis is not known.');
      else if (lateT !== null && lateT >= INTEL_RULES.lateDays) block('late-chart', `The chart analysis is from ${ev.tech.asOf}, ${lateT} trading days ago.`);
      if (ev.tech.trend === null) block('no-trend', 'The chart trend is missing.');
    }
  }
  if (ev.health === null) block('no-health', 'The nightly health report could not be read, so the data cannot be confirmed.');
  else {
    const critical = INTEL_CRITICAL_CHECKS[strategy] || [];
    for (const k of ev.health.checks) {
      if (k.status === 'bad' && critical.includes(k.id)) block(`health-${k.id}`, `A nightly health check failed: ${k.label}.`);
      else if (k.status === 'bad' || k.status === 'warn') warn(`health-${k.id}`, `Nightly health check (${k.status === 'bad' ? 'failed' : 'warning'}): ${k.label}.`);
    }
  }
  if (ev.buy === null && !blockers.some((b) => b.id === 'no-screen')) block('no-buy-check', 'Your size and sector limits could not be checked.');
  if (!blockers.length) {
    if (ev.tech && ev.tech.earningsSoon && strategy !== 'long') warn('earnings-soon', 'Results are due within about 10 trading days: the price can move sharply.');
    if (ev.tech && ev.tech.regime === 'down' && strategy === 'swing') warn('market-down', 'The market is falling: swing signals have worked less well; consider half size.');
    if (ev.live && ev.price && Math.abs(ev.live.p / ev.price - 1) >= INTEL_RULES.livePriceGap) warn('live-gap', `The delayed live price (${ivMoney(ev.live.p)}) differs from the close used here (${ivMoney(ev.price)}) by ${ivPct(Math.abs(ev.live.p / ev.price - 1), 1)}. This report uses the close.`);
    if (!ev.holdingsEntered) warn('no-holdings', 'No holdings are entered on the Portfolio or Watchlist pages, so the single-stock and sector limits could not be checked against your portfolio.');
  }
  return { blockers, cautions };
}

// ---------------------------------------------------------------- the call
// Reuses the tool's existing rules (the Portfolio page's advice rules and the company page's buy and swing answers).
// Nothing is tuned here; if a rule is not met the answer is to wait.
const ivCall = (action, label, headline, reasons, extra) => ({ action, label, headline, reasons, paperOnly: false, ...(extra || {}) });
function ivBuyStops(ev) {
  const stops = [];
  if (ev.buy && ev.buy.ok === false) for (const w of ev.buy.why) stops.push(w);
  return stops;
}
function ivSharedExit(ev, owned) {
  if (ev.shariah === 'fail') {
    return owned
      ? ivCall('sell', 'Sell', 'It fails the Shariah screen now.', ['It fails the tool’s Shariah screen. Confirm on Zoya (the final word); if it still fails, your rule is to sell within 90 days and purify any gain as your scholar advises.'])
      : ivCall('hold', 'Do not buy', 'It fails the Shariah screen.', ['It fails the tool’s Shariah screen, so it is not a candidate. Zoya has the final word.']);
  }
  if (INTEL_WEAK.includes(ev.verdict)) {
    const why = `The business is rated “${INTEL_VERDICT_WORD[ev.verdict]}”${ev.quality !== null ? ` (quality ${ev.quality} of 100)` : ''}, whatever the price.`;
    return owned ? ivCall('sell', 'Sell', 'The business itself got worse.', [why]) : ivCall('hold', 'Do not buy', 'Not a buy at any price.', [why]);
  }
  return null;
}
function ivValuationLine(ev) {
  const p = ev.plan;
  return `Buy price ${ivMoney(p.buyBelow)}, trim price ${ivMoney(p.trimAbove)}, fair value ${ivMoney(p.fair)}, price now ${ivMoney(ev.price)}.`;
}
function ivBuyOrWait(ev, owned, stops, whyBuy, strategyWord) {
  if (stops.length) return ivCall('hold', owned ? 'Hold' : 'Wait', `Blocked by your limits or the Shariah checks.`, [`${whyBuy} But not for you now: ${stops.join('; ')}.`]);
  const room = ev.buy && ev.buy.room !== null ? ` Your limit for one stock allows up to ${ivMoney(ev.buy.room)} more in it now.` : '';
  return ivCall('buy', owned ? 'Add' : 'Buy', `${owned ? 'Add' : 'Buy'} (${strategyWord}).`, [`${whyBuy}${room}`]);
}
function intelCall(ev, strategy) {
  const owned = strategy === 'swing' ? !!ev.swingTrade : ev.owned;
  const px = ev.price;
  const exit = strategy === 'swing' ? (ev.shariah === 'fail' ? ivSharedExit(ev, owned) : null) : ivSharedExit(ev, owned);
  if (exit) return exit;
  const stops = ivBuyStops(ev);
  const p = ev.plan;
  if (strategy === 'swing') return ivSwingCall(ev, owned, stops);
  const size = ev.sizeSale > 0 && owned ? ivCall('trim', 'Trim', 'The position is above your size limit.', [`It is ${ev.weight !== null ? ivPct(ev.weight, 1) : 'over the limit'} of everything you own, above your limit for one company. Sell about ${ivMoney(ev.sizeSale)} to bring it back.`]) : null;
  const trend = ev.tech ? ev.tech.trend : null;
  if (strategy === 'position' && owned && trend !== null && INTEL_BROKEN.includes(trend)) {
    return ivCall('sell', 'Sell', 'The uptrend has broken.', [`The chart trend is “${trend}”. The rule the tool applies to a short hold says to sell when the uptrend breaks.`]);
  }
  if (owned && p && px >= p.trimAbove) return ivCall('trim', 'Trim', 'Above its trim price.', [`${ivMoney(px)} is at or above the trim price (${ivMoney(p.trimAbove)}): sell part and stop adding.`]);
  if (size) return size;
  if (ev.shariah === 'review') return ivCall('hold', owned ? 'Hold' : 'Wait', 'The Shariah screen is unresolved.', ['The tool’s Shariah screen is unresolved (close to a limit, or unclear). Check it on Zoya before adding anything; if it fails, your 90-day exit rule starts.']);
  const goodVerdict = INTEL_GOOD.includes(ev.verdict);
  const cheap = px <= p.buyBelow;
  const word = INTEL_STRATEGY[strategy].short;
  if (strategy === 'long') {
    if (goodVerdict && cheap) {
      if (owned && ev.weight !== null && ev.buyCap !== null && ev.weight >= ev.buyCap * INTEL_RULES.fullPosition) return ivCall('hold', 'Hold', 'Below its buy price, but already a full position.', [`${ivValuationLine(ev)} It is ${ivPct(ev.weight, 1)} of everything you own, close to your ${ivPct(ev.buyCap, 0)} limit.`]);
      return ivBuyOrWait(ev, owned, stops, `${ivMoney(px)} is at or below the buy price (${ivMoney(p.buyBelow)}) and the business is rated “${INTEL_VERDICT_WORD[ev.verdict]}”.`, word);
    }
    if (!owned && px >= p.trimAbove) return ivCall('hold', 'Do not buy', 'Expensive.', [`${ivMoney(px)} is at or above the trim price (${ivMoney(p.trimAbove)}).`]);
    const why = [];
    if (!goodVerdict) why.push(`The business is rated “${INTEL_VERDICT_WORD[ev.verdict] || ev.verdict}”, not a buy rating.`);
    if (!cheap) why.push(`${ivMoney(px)} is above the buy price (${ivMoney(p.buyBelow)}), about ${ivPct(1 - p.buyBelow / px, 0)} higher than it.`);
    why.push(owned ? 'Passes the Shariah screen and its holding rule: hold and wait. You will be told if the business weakens.' : ivValuationLine(ev));
    return ivCall('hold', owned ? 'Hold' : 'Wait', owned ? 'Hold.' : 'Wait for a better price.', why);
  }
  // position investing: the rules the tool already applies to a short hold (the uptrend must be intact)
  const up = trend === 'up';
  if (goodVerdict && cheap && up) return ivBuyOrWait(ev, owned, stops, `${ivMoney(px)} is at or below the buy price (${ivMoney(p.buyBelow)}), the business is rated “${INTEL_VERDICT_WORD[ev.verdict]}” and the chart trend is up.`, word);
  const why = [];
  if (!goodVerdict) why.push(`The business is rated “${INTEL_VERDICT_WORD[ev.verdict] || ev.verdict}”, not a buy rating.`);
  if (!cheap) why.push(`${ivMoney(px)} is above the buy price (${ivMoney(p.buyBelow)}).`);
  if (!up) why.push(`The chart trend is “${trend}”, not up.`);
  return ivCall('hold', owned ? 'Hold' : 'Wait', owned ? 'Hold.' : 'Wait: not every condition is met.', why);
}
function ivSwingCall(ev, owned) {
  const t = ev.tech;
  const p = t.setup;
  const px = ev.price;
  if (owned) {
    const tr = ev.swingTrade;
    if (tr.stop === null && tr.target === null) return ivCall('hold', 'Hold', 'Hold, but no stop or target is recorded.', ['Your open swing trade has no stop or target in the Journal. Set a stop and never move it lower.']);
    if (tr.stop !== null && px <= tr.stop) return ivCall('sell', 'Sell', 'The price is at or below your stop.', [`${ivMoney(px)} is at or below your stop (${ivMoney(tr.stop)}): the plan says to exit.`]);
    if (tr.target !== null && px >= tr.target) return ivCall('trim', 'Trim', 'The price reached your target.', [`${ivMoney(px)} is at or above your target (${ivMoney(tr.target)}): the plan says to sell half and move the stop up to your entry.`]);
    return ivCall('hold', 'Hold', 'Hold the swing trade.', [`${ivMoney(px)} is between your stop${tr.stop !== null ? ` (${ivMoney(tr.stop)})` : ''} and your target${tr.target !== null ? ` (${ivMoney(tr.target)})` : ''}.`]);
  }
  const active = p && p.status === 'active' && p.entry !== null && p.stop !== null;
  if (!active) {
    if (p && (p.status === 'watch' || p.status === 'wait')) return ivCall('hold', 'Wait', 'No buy signal yet.', [p.trigger ? ivFirst(p.trigger) : 'The chart shows a setup forming but no buy signal.']);
    return ivCall('hold', 'No trade', 'There is no swing setup on the chart.', ['There is no buy setup on the chart right now.']);
  }
  if (ivLate(t.asOf, ev.today) >= 1) return ivCall('hold', 'Wait', 'The plan is out of date.', [`The plan was written for the session after ${t.asOf} and has expired. It is rebuilt overnight; check again tomorrow.`]);
  const tail = `Entry ${ivMoney(p.entry)}${p.maxEntry !== null ? `, limit ${ivMoney(p.maxEntry)}` : ''}, stop ${ivMoney(p.stop)}${p.target1 !== null ? `, target 1 ${ivMoney(p.target1)}` : ''}.`;
  const stops = ivBuyStops(ev);
  if (stops.length) return ivCall('hold', 'Wait', 'Blocked by your limits or the Shariah checks.', [`A buy signal exists (${tail}) But not for you now: ${stops.join('; ')}.`]);
  const paper = !ev.swingProven;
  return ivCall('buy', paper ? 'Paper buy' : 'Buy', paper ? 'Buy signal for the next session: paper trade only.' : 'Buy signal for the next session.', [`Buy signal for the next session. ${tail}`], { paperOnly: paper });
}

// ---------------------------------------------------------------- facts, each marked sourced, calculated or unavailable
function ivFact(id, label, value, kind, source, asOf, url) {
  const none = value === null || value === undefined || value === '';
  return { id, label, value: none ? 'not available' : String(value), kind: none ? 'unavailable' : kind, source: none ? null : source || null, asOf: none ? null : asOf || null, url: none ? null : url || null };
}
function ivSec(ev, item) {
  const s = ev.sources.find((x) => x && x.item === item);
  if (!s || !ivNum(s.value)) return null;
  return s;
}
function ivSecFact(ev, id, item, label) {
  const s = ivSec(ev, item);
  if (!s) return ivFact(id, label, null);
  const src = s.form && s.filed ? `SEC filing ${s.form}, filed ${s.filed}${s.tag ? ` (${s.tag})` : ''}` : s.tag ? String(s.tag) : 'SEC filings';
  const safe = typeof s.url === 'string' && /^https:\/\/www\.sec\.gov\//.test(s.url) ? s.url : null;
  return ivFact(id, label, ivBig(s.value), 'sourced', src, s.period || null, safe);
}
function intelFacts(ev, strategy) {
  const calc = (name) => `Calculated by this tool: ${name}${ev.methodVersion ? ` (method ${ev.methodVersion})` : ''}`;
  const groups = [];
  const price = [
    ivFact('price', 'Price', ev.price !== null ? ivMoney(ev.price) : null, 'sourced', ev.priceSource ? `Price feed: ${ev.priceSource}` : 'Price feed', ev.priceTime || ev.priceDate),
    ivFact('range52', '52-week range', ev.low52 !== null && ev.high52 !== null ? `${ivMoney(ev.low52)} to ${ivMoney(ev.high52)}` : null, 'sourced', ev.priceSource ? `Price feed: ${ev.priceSource}` : 'Price feed', ev.priceDate),
    ivFact('marketcap', 'Market value', ev.marketCap !== null ? ivBig(ev.marketCap) : null, 'calculated', calc('price times shares outstanding'), ev.priceDate),
  ];
  groups.push({ title: 'Price', items: price });
  if (strategy !== 'swing') {
    groups.push({
      title: 'From the company’s filings',
      items: [
        ivSecFact(ev, 'revenue', 'Revenue', 'Revenue'), ivSecFact(ev, 'netincome', 'Net income', 'Net income'), ivSecFact(ev, 'ocf', 'Operating cash flow', 'Operating cash flow'),
        ivSecFact(ev, 'capex', 'Capital spending', 'Capital spending'), ivSecFact(ev, 'cash', 'Cash and investments', 'Cash and investments'), ivSecFact(ev, 'debt', 'Debt (interest-bearing)', 'Debt'),
        ivFact('bsdate', 'Latest balance sheet', ev.fresh && ev.fresh.balanceSheetDate ? `${ev.fresh.balanceSheetDate}${ev.fresh.daysSinceBalanceSheet !== null ? ` (${ev.fresh.daysSinceBalanceSheet} days ago)` : ''}` : null, 'sourced', 'SEC filings', ev.fresh && ev.fresh.balanceSheetDate),
      ],
    });
    groups.push({
      title: 'The tool’s ratings',
      items: [
        ivFact('verdict', 'Verdict', ev.verdict ? INTEL_VERDICT_WORD[ev.verdict] || ev.verdict : null, 'calculated', calc('the verdict from quality, health, growth, valuation and data quality'), ev.priceDate),
        ivFact('quality', 'Business quality', ev.quality !== null ? `${ev.quality} of 100` : null, 'calculated', calc('returns on capital, margins and cash conversion from the filings'), ev.priceDate),
        ivFact('health', 'Financial health', ev.healthScore !== null ? `${ev.healthScore} of 100` : null, 'calculated', calc('debt, interest cover and liquidity from the filings'), ev.priceDate),
        ivFact('growth', 'Growth', ev.growth !== null ? `${ev.growth} of 100${ev.growthLabel ? `, ${ev.growthLabel.toLowerCase()}` : ''}` : null, 'calculated', calc('revenue growth from the filings'), ev.priceDate),
        ivFact('confidence', 'Confidence in the verdict', ev.confidence, 'calculated', calc('how predictable the business is'), ev.priceDate),
        ivFact('dq', 'Data quality', ev.dq ? ev.dq.level : null, 'calculated', calc('checks on the age and completeness of the data'), ev.priceDate),
      ],
    });
    const f = ev.fair;
    groups.push({
      title: 'Valuation',
      items: [
        ivFact('fair', 'Fair value (base case)', f ? ivMoney(f.base) : null, 'calculated', calc('discounted cash flow from the filings'), ev.priceDate),
        ivFact('fairrange', 'Fair value range (bear to bull)', f && ivNum(f.bear) && ivNum(f.bull) ? `${ivMoney(f.bear)} to ${ivMoney(f.bull)}` : null, 'calculated', calc('discounted cash flow, three scenarios'), ev.priceDate),
        ivFact('buyprice', 'Buy price', ev.plan ? ivMoney(ev.plan.buyBelow) : null, 'calculated', calc('fair value less a required margin of safety'), ev.priceDate),
        ivFact('trimprice', 'Trim price', ev.plan ? ivMoney(ev.plan.trimAbove) : null, 'calculated', calc('the higher of the bull case and 25% above fair value'), ev.priceDate),
        ivFact('upside', 'Distance to fair value', f && ivNum(f.upside) ? ivPct(f.upside, 0) : null, 'calculated', calc('fair value against the price'), ev.priceDate),
        ivFact('assumptions', 'Main assumptions', f && ivNum(f.assumedGrowth) && ivNum(f.discountRate) ? `growth ${ivPct(f.assumedGrowth, 1)} a year, discount rate ${ivPct(f.discountRate, 1)}, ${ivNum(f.terminalShare) ? `${ivPct(f.terminalShare, 0)} of the value comes from after year 10` : 'terminal share not available'}` : null, 'calculated', calc('assumptions behind the estimate; they are estimates, not facts'), ev.priceDate),
      ],
    });
  }
  const t = ev.tech;
  const s = t && t.setup;
  const chart = [
    ivFact('trend', 'Chart trend', t && t.trend ? `${t.trend}${t.trendLabel ? ` (${t.trendLabel})` : ''}` : null, 'calculated', 'Calculated by this tool from daily prices: 21, 50 and 200-day averages', t && t.asOf),
  ];
  if (strategy === 'swing') {
    chart.push(
      ivFact('setup', 'Swing setup', s && s.setup ? `${s.setup}, ${s.status || 'no status'}` : null, 'calculated', 'Calculated by this tool from daily prices (technical analysis)', t && t.asOf),
      ivFact('entry', 'Entry, limit', s && s.entry !== null ? `${ivMoney(s.entry)}${s.maxEntry !== null ? `, limit ${ivMoney(s.maxEntry)}` : ''}` : null, 'calculated', 'Calculated by this tool: the plan for the next session only', t && t.asOf),
      ivFact('stop', 'Stop', s && s.stop !== null ? ivMoney(s.stop) : null, 'calculated', 'Calculated by this tool from recent lows and volatility', t && t.asOf),
      ivFact('targets', 'Targets', s && s.target1 !== null ? `${ivMoney(s.target1)}${s.target2 !== null ? `, ${ivMoney(s.target2)}` : ''}` : null, 'calculated', 'Calculated by this tool from the risk on the trade', t && t.asOf),
    );
  }
  groups.push({ title: 'Chart', items: chart });
  groups.push({
    title: 'Shariah',
    items: [
      ivFact('shariah', 'Shariah screen', ev.shariah ? ({ pass: 'passes the tool’s screen', fail: 'fails', review: 'needs checking' })[ev.shariah] : null, 'calculated', calc('AAOIFI-style ratios from the filings and the market value'), ev.priceDate),
      ivFact('ledger', 'Your Shariah ledger', ev.ledger ? (ev.ledger.ok ? `no block${ev.ledger.reason ? `: ${ev.ledger.reason}` : ''}` : `blocks new buys: ${ev.ledger.reason || 'see the ledger'}`) : null, 'sourced', 'Your own Shariah ledger on this device (Zoya checks you recorded)', null),
    ],
  });
  groups.push({
    title: 'Dates',
    items: [ivFact('earnings', 'Next results date', ev.nextEarnings ? ev.nextEarnings.date : null, 'sourced', 'Nasdaq earnings calendar', ev.priceDate)],
  });
  return groups;
}

// ---------------------------------------------------------------- the report
const INTEL_RULE_TEXT = Object.freeze({
  long: 'Uses the long-term price plan and the Portfolio page’s advice rules exactly as they are: the business must be rated a buy, pass the Shariah screen and fit your limits; a buy needs the price at or below the buy price; owners trim at the trim price or when a position is over the size limit, and sell if the Shariah screen fails or the business is rated Avoid or Speculative.',
  position: 'Position investing is new in stage 7 and has no rules of its own. It applies the rules the tool already uses for a short hold: the business rated a buy, the Shariah screen passed, the price at or below the buy price, and the chart uptrend intact; owners sell when the uptrend breaks, trim at the trim price or over the size limit. Those rules were written for 3 to 12 months and were not designed or tested for weeks to months.',
  swing: 'Uses the chart analysis and the swing plan exactly as the Technical tab shows them: a buy only on an active signal, for the next session only, with its stop and targets. Owners are measured against the stop and target in their own Journal trade. Until the live record passes its gate, every swing buy is a paper trade.',
});
function intelReport(ev, strategy) {
  if (!INTEL_STRATEGIES.includes(strategy)) throw new Error(`unknown strategy "${strategy}"`);
  const S = INTEL_STRATEGY[strategy];
  const gate = intelGate(ev, strategy);
  const call = gate.blockers.length ? null : intelCall(ev, strategy);
  const stops = ev.buy && ev.buy.ok === false ? ev.buy.why.slice() : [];
  const p = ev.plan;
  const e = ev.nextEarnings;
  const upcoming = e && ev.today && e.date >= ev.today ? e : null;
  const catalysts = [];
  if (upcoming) catalysts.push({ text: `Results due ${upcoming.date}.`, date: upcoming.date, kind: 'sourced', source: 'Nasdaq earnings calendar' });
  if (p && ev.price !== null && ev.price > p.buyBelow && strategy !== 'swing') catalysts.push({ text: `The price would enter the buy zone at ${ivMoney(p.buyBelow)} (now ${ivMoney(ev.price)}).`, date: null, kind: 'calculated', source: 'Calculated by this tool: the buy price' });
  const filings = ev.filings.map((f) => ({ text: `${f.form} filed ${f.filed}${f.items && f.items.length ? `, items ${f.items.join(', ')}` : ''}`, kind: 'sourced', source: 'SEC filing list' }));
  const risks = [];
  for (const r of ev.risks) risks.push({ text: r, kind: 'calculated', source: 'Calculated by this tool from the filings' });
  if (ev.shariah === 'review') risks.push({ text: 'The Shariah screen needs confirming before any buy.', kind: 'calculated', source: 'Calculated by this tool from the filings' });
  if (ev.fair && ivNum(ev.fair.bear) && ivNum(ev.fair.bull)) risks.push({ text: `Fair value is an estimate: the bear to bull range is ${ivMoney(ev.fair.bear)} to ${ivMoney(ev.fair.bull)}.`, kind: 'calculated', source: 'Calculated by this tool: discounted cash flow' });
  if (ev.dq && ev.dq.level === 'limited') for (const x of ev.dq.reasons.slice(0, 4)) risks.push({ text: `Data limit: ${x}.`, kind: 'calculated', source: 'Calculated by this tool: data-quality checks' });
  if (strategy !== 'long' && ev.tech && ev.tech.earningsSoon) risks.push({ text: 'Results are due soon: the price can gap in either direction.', kind: 'sourced', source: 'Nasdaq earnings calendar' });
  const conditions = [];
  if (p && strategy !== 'swing') {
    conditions.push(`A buy needs the price at or below ${ivMoney(p.buyBelow)} and a buy rating${strategy === 'position' ? ' and an intact uptrend' : ''}.`);
    conditions.push(`Owners trim at or above ${ivMoney(p.trimAbove)}.`);
    conditions.push(strategy === 'position' ? 'An owner sells if the uptrend breaks, the Shariah screen fails, or the business is rated Avoid or Speculative.' : 'An owner sells if the Shariah screen fails or the business is rated Avoid or Speculative.');
  }
  if (strategy === 'swing' && ev.tech && ev.tech.setup && ev.tech.setup.stop !== null) conditions.push(`The plan is void if the price falls to the stop (${ivMoney(ev.tech.setup.stop)}).`);
  const lateP = ivLate(ev.priceDate, ev.today);
  const lateT = ev.tech ? ivLate(ev.tech.asOf, ev.today) : null;
  const freshness = [
    { label: 'Price', value: ev.priceDate || 'not available', note: lateP === null ? '' : `${lateP} trading day${lateP === 1 ? '' : 's'} late` },
    { label: 'Nightly screen', value: ev.screenDate || 'not available', note: '' },
    { label: 'Latest financial statements', value: ev.fresh && ev.fresh.balanceSheetDate ? ev.fresh.balanceSheetDate : 'not available', note: ev.fresh && ev.fresh.daysSinceBalanceSheet !== null ? `${ev.fresh.daysSinceBalanceSheet} days old` : '' },
    { label: 'Chart analysis', value: ev.tech && ev.tech.asOf ? ev.tech.asOf : 'not available', note: lateT === null ? '' : `${lateT} trading day${lateT === 1 ? '' : 's'} late` },
    { label: 'Nightly build', value: ev.health && ev.health.builtAt ? ev.health.builtAt.slice(0, 10) : 'not available', note: '' },
  ];
  return {
    version: INTEL_VERSION,
    ticker: ev.ticker,
    name: ev.name,
    strategy,
    strategyLabel: S.label,
    span: S.span,
    generated: ev.today,
    status: call ? 'ready' : 'withheld',
    call,
    blockers: gate.blockers,
    cautions: gate.cautions,
    policyStops: call && call.action === 'hold' ? stops : [],
    facts: intelFacts(ev, strategy),
    catalysts,
    catalystNote: upcoming || catalysts.length
      ? 'Only the dated items above are known. This tool has no news, product, guidance or analyst feed, so no other catalyst is assumed.'
      : 'No reliable catalyst information is available. This tool has no news, product, guidance or analyst feed, and no results date is on file, so none is assumed.',
    recentFilings: filings,
    risks,
    freshness,
    portfolio: {
      record: 'The holdings you entered on the Portfolio and Watchlist pages',
      held: strategy === 'swing' ? !!ev.swingTrade : ev.owned,
      weight: ev.weight,
      complete: false,
      text: `Position size and your limits use the holdings you entered on the Portfolio and Watchlist pages (${strategy === 'swing' ? 'for a swing trade, your open Journal trades' : 'the same record the Portfolio page’s advice uses'}). They do not use the Portfolio ledger (stage 6). Cash, funds, other brokers and anything recorded only in the ledger are not seen here, so this is not a complete portfolio-risk picture. Weights use the totals the buy check uses; the Portfolio page\u2019s own advice can use a slightly different total, so a trim for position size can differ between the two.`,
    },
    rule: INTEL_RULE_TEXT[strategy],
    validation: strategy === 'position'
      ? 'Unvalidated: this strategy has no rules or track record of its own yet.'
      : strategy === 'swing'
        ? (ev.swingNote || 'Paper trade only until the live record passes its gate.')
        : 'Whether the tool’s calls beat the market is judged on the Record page by rules fixed in advance. This report is not a prediction or a guarantee.',
    conditions,
    notes: 'Educational tool, not financial advice. Nothing here buys or sells anything. Zoya has the final word on a company\u2019s Shariah status.',
  };
}

// ---------------------------------------------------------------- a decision to save in the stage 5 record
// The stage 5 record keeps the call, the reasons and the evidence exactly as saved. Only a report with a call can be saved.
function intelDecision(report, evidence, today) {
  if (!report || !report.call || !ivISO(today)) return null;
  const c = report.call;
  const S = INTEL_STRATEGY[report.strategy];
  const reasons = [
    `Investment report, ${S.label.toLowerCase()} (${S.span}): ${c.headline}`,
    ...c.reasons,
    `Rule applied: ${report.rule}`,
    ...(c.paperOnly ? ['Paper trade only: swing signals are practice until the live record passes its gate.'] : []),
    ...(report.cautions.length ? [`Cautions: ${report.cautions.map((x) => x.text).join(' ')}`] : []),
    `Data dates: ${report.freshness.map((f) => `${f.label} ${f.value}`).join('; ')}.`,
    `Portfolio record used: ${report.portfolio.text}`,
    report.validation,
  ].map((s) => ivCut(s, 1500)).slice(0, 12);
  return { kind: 'decision', t: report.ticker, decided: today, action: c.action, call: ivCut(`${c.label} (${S.short})`, 40), source: 'stock', reasons, evidence };
}

// ---------------------------------------------------------------- a thesis draft, for you to edit and confirm
// A draft only restates the tool's own numbers. It has no view of the business model or the competition: that part is yours.
// Nothing is saved until you confirm; the stage 5 record then keeps your edited text as your thesis.
function intelDraft(report, ev) {
  if (!report || !ev) return null;
  const S = INTEL_STRATEGY[report.strategy];
  const owned = report.portfolio.held;
  const parts = [];
  if (ev.quality !== null) parts.push(`The tool rates the business quality ${ev.quality} of 100`);
  if (ev.healthScore !== null) parts.push(`financial health ${ev.healthScore} of 100`);
  if (ev.growth !== null) parts.push(`growth ${ev.growth} of 100`);
  const rated = parts.length ? `${parts.join(', ')}.` : 'The tool has no ratings for this business.';
  const val = ev.plan && ev.fair
    ? ` Its fair-value estimate is ${ivMoney(ev.fair.base)} (range ${ivMoney(ev.fair.bear)} to ${ivMoney(ev.fair.bull)}), with a buy price of ${ivMoney(ev.plan.buyBelow)}, against ${ev.price !== null ? ivMoney(ev.price) : 'an unknown price'} on ${ev.priceDate || 'an unknown date'}. These are estimates.`
    : ' The tool has no reliable fair-value estimate.';
  const callLine = report.call ? ` Today’s call under the ${S.short} rules is “${report.call.label}”.` : ' A call was withheld because the data did not pass the checks.';
  const caution = ' This draft only restates the tool’s numbers. It says nothing about what the business does, its moat or its competitors: add that yourself.';
  const reason = `Considered for ${S.label.toLowerCase()} (${S.span}). ${report.call ? `The tool’s call today is “${report.call.label}”: ${report.call.headline}` : 'The tool withheld a call today; the reason must be written by you.'}`;
  const cats = report.catalysts.filter((x) => x.kind === 'sourced' && x.date).map((x) => ({ text: ivCut(`${x.text} (${x.source})`, 240), by: x.date }));
  const risks = report.risks.map((x) => ({ text: ivCut(x.text, 240) })).slice(0, 8);
  const inv = [];
  inv.push({ text: 'The Shariah screen fails.', rule: { type: 'fails_shariah_screen' } });
  if (report.strategy !== 'swing') inv.push({ text: 'The business is rated Avoid or Speculative.', rule: { type: 'business_weakens' } });
  if (report.strategy !== 'long') inv.push({ text: 'The chart uptrend breaks.', rule: { type: 'trend_breaks' } });
  if (ev.plan && report.strategy !== 'swing') inv.push({ text: `The price reaches the trim price (${ivMoney(ev.plan.trimAbove)}): the valuation case is used up.`, rule: { type: 'price_above', value: ev.plan.trimAbove } });
  if (report.strategy === 'swing' && ev.tech && ev.tech.setup && ev.tech.setup.stop !== null) inv.push({ text: `The price falls to the plan’s stop (${ivMoney(ev.tech.setup.stop)}).`, rule: { type: 'price_below', value: ev.tech.setup.stop } });
  return {
    label: 'Tool draft: not your thesis until you edit it and confirm',
    stance: owned ? 'owned' : 'considering',
    horizon: INTEL_THESIS_HORIZON[report.strategy],
    horizonNote: report.strategy === 'long'
      ? 'Saved as “Long term” in the thesis record (3 years or more).'
      : `The thesis record has no “${S.short}” horizon, so it is saved as “Short term” (3 to 12 months), the nearest one. The text says ${S.short}.`,
    reason: ivCut(reason, 480),
    thesis: ivCut(`${rated}${val}${callLine}${caution}`, 1200),
    catalysts: cats.length ? cats : [{ text: 'None identified from reliable data. This tool has no news or analyst feed.' }],
    risks: risks.length ? risks : [{ text: 'None identified by the tool. That is not evidence that there are none.' }],
    invalidation: inv,
  };
}

export {
  INTEL_VERSION, INTEL_STRATEGIES, INTEL_STRATEGY, INTEL_KINDS, INTEL_RULES, INTEL_THESIS_HORIZON,
  intelGather, intelGate, intelCall, intelFacts, intelReport, intelDecision, intelDraft,
};
