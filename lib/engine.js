// Fundamental analysis engine.
// Input: raw SEC companyfacts + submissions + price data (see data.js).
// Output: a beginner-friendly verdict with every number explained.
// Pure functions only: no network access here, so it is easy to test.

export const METHOD_VERSION = '1.0';

// ---------------------------------------------------------------- helpers
const DAY = 86400000;
const tms = (d) => Date.parse(String(d).slice(0, 10) + 'T00:00:00Z');
const daysBetween = (a, b) => (tms(b) - tms(a)) / DAY;
const isNum = (x) => typeof x === 'number' && Number.isFinite(x);
const clamp = (x, lo, hi) => Math.min(hi, Math.max(lo, x));
const div = (a, b) => (isNum(a) && isNum(b) && b !== 0 ? a / b : null);
const round = (x, d = 4) => (isNum(x) ? Math.round(x * 10 ** d) / 10 ** d : null);
function median(arr) {
  const a = arr.filter(isNum).sort((x, y) => x - y);
  if (!a.length) return null;
  const m = Math.floor(a.length / 2);
  return a.length % 2 ? a[m] : (a[m - 1] + a[m]) / 2;
}
function mean(arr) {
  const a = arr.filter(isNum);
  return a.length ? a.reduce((s, x) => s + x, 0) / a.length : null;
}
function stdev(arr) {
  const a = arr.filter(isNum);
  if (a.length < 3) return null;
  const m = mean(a);
  return Math.sqrt(a.reduce((s, x) => s + (x - m) ** 2, 0) / (a.length - 1));
}
function cagr(first, last, years) {
  if (!isNum(first) || !isNum(last) || first <= 0 || last <= 0 || !years) return null;
  return (last / first) ** (1 / years) - 1;
}
const pctTxt = (x, d = 0) => (isNum(x) ? (x * 100).toFixed(d) + '%' : 'n/a');
function moneyTxt(x) {
  if (!isNum(x)) return 'n/a';
  const a = Math.abs(x);
  const s = x < 0 ? '-' : '';
  if (a >= 1e12) return `${s}$${(a / 1e12).toFixed(2)}T`;
  if (a >= 1e9) return `${s}$${(a / 1e9).toFixed(1)}B`;
  if (a >= 1e6) return `${s}$${(a / 1e6).toFixed(0)}M`;
  return `${s}$${a.toFixed(0)}`;
}

// ---------------------------------------------------------------- XBRL tags
// Several tags can hold the same concept (companies switch tags over the years),
// so each concept lists candidates in priority order.
const T = {
  revenue: [
    'Revenues',
    'RevenueFromContractWithCustomerExcludingAssessedTax',
    'RevenueFromContractWithCustomerIncludingAssessedTax',
    'SalesRevenueNet',
    'SalesRevenueGoodsNet',
    'SalesRevenueServicesNet',
    'RevenuesNetOfInterestExpense',
  ],
  costOfRevenue: [
    'CostOfRevenue',
    'CostOfGoodsAndServicesSold',
    'CostOfGoodsSold',
    'CostOfServices',
    'CostOfGoodsAndServiceExcludingDepreciationDepletionAndAmortization',
  ],
  grossProfit: ['GrossProfit'],
  operatingIncome: ['OperatingIncomeLoss'],
  netIncome: ['NetIncomeLoss', 'NetIncomeLossAvailableToCommonStockholdersBasic', 'ProfitLoss'],
  pretax: [
    'IncomeLossFromContinuingOperationsBeforeIncomeTaxesExtraordinaryItemsNoncontrollingInterest',
    'IncomeLossFromContinuingOperationsBeforeIncomeTaxesMinorityInterestAndIncomeLossFromEquityMethodInvestments',
  ],
  tax: ['IncomeTaxExpenseBenefit'],
  interestExpense: ['InterestExpense', 'InterestExpenseNonoperating', 'InterestExpenseDebt', 'InterestAndDebtExpense'],
  interestIncome: ['InvestmentIncomeInterest', 'InvestmentIncomeInterestAndDividend', 'InterestIncomeOther'],
  ocf: ['NetCashProvidedByUsedInOperatingActivities', 'NetCashProvidedByUsedInOperatingActivitiesContinuingOperations'],
  capex: [
    'PaymentsToAcquirePropertyPlantAndEquipment',
    'PaymentsToAcquireProductiveAssets',
    'PaymentsForCapitalImprovements',
    'PaymentsToAcquireOtherPropertyPlantAndEquipment',
  ],
  capSoftware: ['PaymentsToDevelopSoftware'],
  sbc: ['ShareBasedCompensation', 'AllocatedShareBasedCompensationExpense'],
  da: [
    'DepreciationDepletionAndAmortization',
    'DepreciationAmortizationAndAccretionNet',
    'DepreciationAndAmortization',
    'Depreciation',
  ],
  eps: ['EarningsPerShareDiluted', 'EarningsPerShareBasicAndDiluted', 'EarningsPerShareBasic'],
  shares: [
    'WeightedAverageNumberOfDilutedSharesOutstanding',
    'WeightedAverageNumberOfShareOutstandingBasicAndDiluted',
    'WeightedAverageNumberOfSharesOutstandingBasic',
  ],
  // balance sheet (instant values)
  cash: [
    'CashAndCashEquivalentsAtCarryingValue',
    'CashCashEquivalentsRestrictedCashAndRestrictedCashEquivalents',
    'Cash',
    'CashAndDueFromBanks',
  ],
  stInv: [
    'ShortTermInvestments',
    'MarketableSecuritiesCurrent',
    'AvailableForSaleSecuritiesDebtSecuritiesCurrent',
    'AvailableForSaleSecuritiesCurrent',
    'HeldToMaturitySecuritiesCurrent',
    'OtherShortTermInvestments',
  ],
  ltInv: [
    'MarketableSecuritiesNoncurrent',
    'AvailableForSaleSecuritiesDebtSecuritiesNoncurrent',
    'HeldToMaturitySecuritiesNoncurrent',
    'AvailableForSaleSecuritiesNoncurrent',
  ],
  equity: ['StockholdersEquity', 'StockholdersEquityIncludingPortionAttributableToNoncontrollingInterest'],
  assets: ['Assets'],
  curAssets: ['AssetsCurrent'],
  curLiab: ['LiabilitiesCurrent'],
  ltdTotal: ['LongTermDebt'],
  ltdNoncurrent: [
    'LongTermDebtNoncurrent',
    'LongTermDebtAndCapitalLeaseObligations',
    'LongTermNotesPayable',
    'ConvertibleNotesPayableNoncurrent',
    'SeniorLongTermNotes',
    'LongTermNotesAndLoans',
    'LongTermLoansPayable',
    'UnsecuredLongTermDebt',
    'OtherLongTermDebtNoncurrent',
  ],
  ltdCurrent: [
    'LongTermDebtCurrent',
    'LongTermDebtAndCapitalLeaseObligationsCurrent',
    'LongTermNotesPayableCurrent',
    'NotesPayableCurrent',
    'LoansPayableCurrent',
    'NotesAndLoansPayableCurrent',
  ],
  debtTotal: ['DebtLongtermAndShorttermCombinedAmount'],
  debtCurrent: ['DebtCurrent'],
  stBorrow: ['ShortTermBorrowings', 'CommercialPaper', 'ShortTermBankLoansAndNotesPayable', 'LinesOfCreditCurrent'],
};
const DEBT_TAGS = [...T.ltdTotal, ...T.ltdNoncurrent, ...T.ltdCurrent, ...T.debtCurrent, ...T.stBorrow, ...T.debtTotal];

// ---------------------------------------------------------------- fact book
class FactBook {
  constructor(facts) {
    this.facts = facts || {};
    this.memo = new Map();
  }
  list(tag, unit) {
    const k = `L|${tag}|${unit}`;
    if (this.memo.has(k)) return this.memo.get(k);
    let arr = [];
    for (const ns of ['us-gaap', 'dei']) {
      const node = this.facts[ns]?.[tag];
      if (node?.units?.[unit]) {
        arr = node.units[unit];
        break;
      }
    }
    arr = arr.filter((f) => f && f.end && isNum(f.val) && f.form);
    this.memo.set(k, arr);
    return arr;
  }
  hasAny(tags) {
    return tags.some((t) => this.facts['us-gaap']?.[t]);
  }
  // annual (duration ~1 year) values from annual reports, keyed by period end
  annualMap(tag, unit = 'USD') {
    const k = `A|${tag}|${unit}`;
    if (this.memo.has(k)) return this.memo.get(k);
    const m = new Map();
    for (const f of this.list(tag, unit)) {
      if (!f.start) continue;
      const d = daysBetween(f.start, f.end);
      if (d < 340 || d > 390) continue;
      if (!/^(10-K|20-F|40-F)/.test(f.form)) continue;
      const prev = m.get(f.end);
      if (!prev || f.filed > prev.filed) m.set(f.end, { val: f.val, filed: f.filed, start: f.start, end: f.end, tag });
    }
    const out = dedupeClose(m);
    this.memo.set(k, out);
    return out;
  }
  // instant (balance sheet) values from 10-K/10-Q, keyed by date
  instantMap(tag, unit = 'USD') {
    const k = `I|${tag}|${unit}`;
    if (this.memo.has(k)) return this.memo.get(k);
    const m = new Map();
    for (const f of this.list(tag, unit)) {
      if (f.start) continue;
      if (!/^(10-K|10-Q|20-F|40-F)/.test(f.form)) continue;
      const prev = m.get(f.end);
      if (!prev || f.filed > prev.filed) m.set(f.end, { val: f.val, filed: f.filed, end: f.end, tag });
    }
    this.memo.set(k, m);
    return m;
  }
  // merge several candidate tags into one annual series
  annualSeries(tags, unit = 'USD', mode = 'first') {
    const maps = tags.map((t) => this.annualMap(t, unit));
    const ends = new Set();
    maps.forEach((m) => m.forEach((_, e) => ends.add(e)));
    const out = new Map();
    for (const e of [...ends].sort()) {
      let pick = null;
      for (const m of maps) {
        const v = valueAt(m, e, 12);
        if (!v) continue;
        if (mode === 'first') {
          pick = v;
          break;
        }
        if (!pick || v.val > pick.val) pick = v;
      }
      if (pick) out.set(e, pick);
    }
    return dedupeClose(out);
  }
  // One primary tag (the one with the most recent data); other tags only fill missing years,
  // and only when they agree with the primary where both exist (avoids mixing gross and net revenue).
  annualSeriesConsistent(tags, unit = 'USD') {
    const maps = tags.map((t) => ({ tag: t, m: this.annualMap(t, unit) })).filter((x) => x.m.size);
    if (!maps.length) return { series: new Map(), tag: null };
    const latestOf = (m) => [...m.keys()].sort().pop();
    maps.sort((a, b) => {
      const la = latestOf(a.m);
      const lb = latestOf(b.m);
      if (Math.abs(daysBetween(la, lb)) > 20) return la < lb ? 1 : -1;
      if (b.m.size !== a.m.size) return b.m.size - a.m.size;
      return tags.indexOf(a.tag) - tags.indexOf(b.tag);
    });
    const out = new Map(maps[0].m);
    for (const other of maps.slice(1)) {
      const ratios = [];
      for (const [e, v] of other.m) {
        const pv = valueAt(out, e, 12);
        if (pv && pv.val) ratios.push(v.val / pv.val);
      }
      let ok;
      if (ratios.length) ok = ratios.every((r) => r > 0.97 && r < 1.03);
      else {
        const firstOut = [...out.keys()].sort()[0];
        const lastOther = latestOf(other.m);
        const gap = daysBetween(lastOther, firstOut);
        const r = out.get(firstOut).val / other.m.get(lastOther).val;
        ok = gap > 300 && gap < 400 && r > 0.8 && r < 1.5;
      }
      if (!ok) continue;
      for (const [e, v] of other.m) if (!valueAt(out, e, 12)) out.set(e, v);
    }
    return { series: dedupeClose(new Map([...out.entries()].sort())), tag: maps[0].tag };
  }
  instantAt(tags, date, mode = 'first', tol = 12) {
    const vals = [];
    for (const t of tags) {
      const v = valueAt(this.instantMap(t), date, tol);
      if (v) vals.push(v);
    }
    if (!vals.length) return null;
    if (mode === 'max') return vals.reduce((a, b) => (b.val > a.val ? b : a)).val;
    return vals[0].val;
  }
}

function dedupeClose(map) {
  const keys = [...map.keys()].sort();
  const res = new Map();
  let lastKey = null;
  for (const k of keys) {
    if (lastKey && daysBetween(lastKey, k) < 20) {
      const a = res.get(lastKey);
      const b = map.get(k);
      if ((b.filed || '') > (a.filed || '')) {
        res.delete(lastKey);
        res.set(k, b);
        lastKey = k;
      }
      continue;
    }
    res.set(k, map.get(k));
    lastKey = k;
  }
  return res;
}

function valueAt(map, date, tolDays = 12) {
  if (!map || !date) return null;
  if (map.has(date)) return map.get(date);
  let best = null;
  let bestD = Infinity;
  for (const [k, v] of map) {
    const d = Math.abs(daysBetween(k, date));
    if (d < bestD) {
      bestD = d;
      best = v;
    }
  }
  return bestD <= tolDays ? best : null;
}

// Trailing-twelve-months for one tag: last annual + (this year-to-date - last year's same period)
function ttmForTag(fb, tag, unit, fyEnd) {
  const annual = fb.annualMap(tag, unit);
  const fy = valueAt(annual, fyEnd, 12);
  if (!fy) return null;
  const list = fb.list(tag, unit).filter((f) => f.start);
  let ytd = null;
  for (const f of list) {
    if (tms(f.end) <= tms(fy.end) + 20 * DAY) continue;
    if (Math.abs(daysBetween(fy.end, f.start) - 1) > 12) continue;
    const dur = daysBetween(f.start, f.end);
    if (dur < 75 || dur > 300) continue;
    if (!ytd || f.end > ytd.end || (f.end === ytd.end && f.filed > ytd.filed)) ytd = f;
  }
  if (!ytd) return { val: fy.val, end: fy.end, method: 'FY', tag };
  const dur = daysBetween(ytd.start, ytd.end);
  const target = tms(ytd.end) - 364 * DAY;
  let prior = null;
  let bestDiff = Infinity;
  for (const f of list) {
    if (Math.abs(daysBetween(f.start, f.end) - dur) > 12) continue;
    const diff = Math.abs(tms(f.end) - target) / DAY;
    if (diff > 12) continue;
    if (diff < bestDiff || (diff === bestDiff && prior && f.filed > prior.filed)) {
      prior = f;
      bestDiff = diff;
    }
  }
  if (!prior) return { val: fy.val, end: fy.end, method: 'FY', tag };
  return {
    val: fy.val + ytd.val - prior.val,
    end: ytd.end,
    method: 'TTM',
    tag,
    ytd: ytd.val,
    ytdPrior: prior.val,
    ytdMonths: Math.round(dur / 30.44),
  };
}

function ttm(fb, tags, unit, fyEnd, mode = 'first') {
  const results = tags.map((t) => ttmForTag(fb, t, unit, fyEnd)).filter(Boolean);
  if (!results.length) return null;
  const latest = results.reduce((m, r) => (r.end > m ? r.end : m), '');
  const cands = results.filter((r) => r.end === latest);
  if (mode === 'max') return cands.reduce((a, b) => (b.val > a.val ? b : a));
  return cands[0];
}

// ---------------------------------------------------------------- splits
function splitFactorAfter(splits, filedDate) {
  let f = 1;
  for (const s of splits || []) if (filedDate && s.date > filedDate) f *= s.ratio;
  return f;
}

// ---------------------------------------------------------------- Shariah business screen (by SEC industry code)
const SIC_FAIL = {
  2082: 'Beer brewing (alcohol)',
  2084: 'Wine production (alcohol)',
  2085: 'Distilled liquor (alcohol)',
  5180: 'Alcohol wholesale',
  5181: 'Alcohol wholesale',
  5182: 'Alcohol wholesale',
  5813: 'Bars (alcohol)',
  2100: 'Tobacco',
  2111: 'Tobacco',
  2120: 'Tobacco',
  2130: 'Tobacco',
  2131: 'Tobacco',
  5194: 'Tobacco wholesale',
  6021: 'Conventional bank (interest-based)',
  6022: 'Conventional bank (interest-based)',
  6029: 'Conventional bank (interest-based)',
  6035: 'Savings bank (interest-based)',
  6036: 'Savings bank (interest-based)',
  6099: 'Banking services (interest-based)',
  6111: 'Credit agency (interest-based lending)',
  6141: 'Consumer lending (interest-based)',
  6153: 'Business lending (interest-based)',
  6159: 'Lending (interest-based)',
  6162: 'Mortgage lending (interest-based)',
  6163: 'Loan brokerage (interest-based)',
  6172: 'Finance leasing (interest-based)',
  6189: 'Asset-backed securities (interest-based)',
  6199: 'Finance services (interest-based)',
  6211: 'Brokerage / investment banking (margin interest)',
  6311: 'Conventional insurance',
  6321: 'Conventional insurance',
  6324: 'Conventional health insurance',
  6331: 'Conventional insurance',
  6351: 'Conventional insurance',
  6361: 'Conventional insurance',
  6399: 'Conventional insurance',
  6411: 'Insurance brokerage',
  7948: 'Racing / betting',
};
const SIC_REVIEW = {
  2011: 'Meat packing (may include pork)',
  2013: 'Processed meats (may include pork)',
  5810: 'Restaurants and cafes (may sell pork or alcohol)',
  5812: 'Restaurants (may sell pork or alcohol)',
  7900: 'Entertainment and recreation',
  5311: 'Department stores (may sell alcohol or pork)',
  5331: 'Variety stores (may sell alcohol or pork)',
  5399: 'General merchandise (may sell alcohol or pork)',
  5411: 'Grocery stores (sell alcohol and pork)',
  5412: 'Convenience stores (sell alcohol/tobacco)',
  7011: 'Hotels (often casinos and alcohol)',
  7990: 'Amusement and recreation (may include gambling)',
  7812: 'Film and TV production (entertainment)',
  7819: 'Film services (entertainment)',
  7822: 'Film distribution (entertainment)',
  7830: 'Movie theaters (entertainment)',
  7841: 'Video streaming/rental (entertainment)',
  4833: 'TV broadcasting (entertainment)',
  4841: 'Cable and pay TV (entertainment)',
  3480: 'Weapons and ammunition',
  3482: 'Weapons and ammunition',
  3483: 'Weapons and ammunition',
  3484: 'Weapons and ammunition',
  3489: 'Weapons and ammunition',
  3760: 'Missiles and defense',
  6200: 'Securities and commodity exchanges',
  6282: 'Asset management',
  6722: 'Investment fund',
  6726: 'Investment fund',
  6798: 'Real estate investment trust (depends on tenants and debt)',
};
// Known gambling operators whose industry code (hotels, recreation) does not reveal it
const TICKER_FAIL = {
  LVS: 'Casino operator (gambling)',
  WYNN: 'Casino operator (gambling)',
  MGM: 'Casino operator (gambling)',
  CZR: 'Casino operator (gambling)',
  PENN: 'Casino and betting operator (gambling)',
  DKNG: 'Sports betting (gambling)',
  FLUT: 'Sports betting (gambling)',
  BYD: 'Casino operator (gambling)',
  RRR: 'Casino operator (gambling)',
  CHDN: 'Racing and betting (gambling)',
  MCRI: 'Casino operator (gambling)',
  GDEN: 'Casino operator (gambling)',
  MLCO: 'Casino operator (gambling)',
  IGT: 'Lottery and gaming machines (gambling)',
  LNW: 'Gaming machines (gambling)',
  ACEL: 'Gaming machines (gambling)',
  BALY: 'Casino operator (gambling)',
  RSI: 'Online betting (gambling)',
  SGHC: 'Online betting (gambling)',
  GAMB: 'Betting affiliate (gambling)',
};
function businessScreen(sic, name, ticker) {
  const n = String(name || '');
  if (ticker && TICKER_FAIL[ticker]) return { status: 'fail', reason: TICKER_FAIL[ticker] };
  if (/smithfield|\bpork\b/i.test(n)) return { status: 'fail', reason: 'Pork products' };
  if (/casino|gaming|betting|lottery|sportsbook|wagering/i.test(n))
    return { status: 'fail', reason: 'Company name suggests gambling' };
  if (/brewing|brewery|winery|distiller|liquor|cannabis|marijuana/i.test(n))
    return { status: 'fail', reason: 'Company name suggests alcohol or cannabis' };
  if (sic && SIC_FAIL[sic]) return { status: 'fail', reason: SIC_FAIL[sic] };
  if (sic && SIC_REVIEW[sic]) return { status: 'review', reason: SIC_REVIEW[sic] };
  if (sic >= 6000 && sic < 6800) return { status: 'review', reason: 'Financial services company' };
  return { status: 'pass', reason: 'Core business is not in a prohibited industry' };
}

// ---------------------------------------------------------------- DCF
function dcf({ revenue0, margin, g1, r, gT = 0.025, netCash, shares }) {
  let rev = revenue0;
  let pv = 0;
  let fcf = 0;
  for (let y = 1; y <= 10; y++) {
    const g = y <= 5 ? g1 : g1 + (gT - g1) * ((y - 5) / 5);
    rev *= 1 + g;
    fcf = rev * margin;
    pv += fcf / (1 + r) ** y;
  }
  const tv = (fcf * (1 + gT)) / (r - gT);
  pv += tv / (1 + r) ** 10;
  const equity = pv + netCash;
  return { equity, perShare: equity / shares };
}
function impliedGrowth(params, targetEquity) {
  let lo = -0.3;
  let hi = 0.8;
  const f = (g) => dcf({ ...params, g1: g }).equity - targetEquity;
  if (f(hi) < 0) return { value: hi, capped: 'above' };
  if (f(lo) > 0) return { value: lo, capped: 'below' };
  for (let i = 0; i < 60; i++) {
    const mid = (lo + hi) / 2;
    if (f(mid) > 0) hi = mid;
    else lo = mid;
  }
  return { value: (lo + hi) / 2, capped: null };
}

// ---------------------------------------------------------------- scoring helpers
function band(value, steps, fallback = null) {
  // steps: [[threshold, points, rating], ...] sorted descending by threshold; value >= threshold matches
  if (!isNum(value)) return fallback;
  for (const [th, pts, rating] of steps) if (value >= th) return { pts, rating };
  const last = steps[steps.length - 1];
  return { pts: 0, rating: last ? 'bad' : 'na' };
}
function bandLow(value, steps, fallback = null) {
  // lower is better: value <= threshold matches
  if (!isNum(value)) return fallback;
  for (const [th, pts, rating] of steps) if (value <= th) return { pts, rating };
  return { pts: 0, rating: 'bad' };
}
function metric(key, label, value, fmt, scored, max, note) {
  return {
    key,
    label,
    value: isNum(value) ? round(value, 6) : value ?? null,
    fmt,
    rating: scored ? scored.rating : 'na',
    points: scored ? scored.pts : null,
    max,
    note: note || '',
  };
}

// ---------------------------------------------------------------- main
export function analyze(data) {
  const { ticker, cik, listing, submissions, facts, price: px } = data;
  const warnings = [];
  const fb = new FactBook(facts);
  const sub = submissions || {};
  const name = niceName(sub.name || listing?.name || ticker);
  const sic = sub.sic || null;
  const base = {
    ok: true,
    methodVersion: METHOD_VERSION,
    ticker,
    cik,
    name,
    exchange: listing?.exchange || (sub.exchanges || [])[0] || '',
    sic,
    industry: sub.sicDescription || '',
    links: buildLinks(ticker, cik, sub),
    fetchedAt: data.fetchedAt,
  };

  // --- can we analyze this company at all?
  const usgaap = facts?.['us-gaap'];
  if (!usgaap || !Object.keys(usgaap).length) {
    const foreign =
      !!facts?.['ifrs-full'] ||
      ['20-F', '40-F'].includes(sub.latest10K?.form) ||
      (sub.recentForms || []).some((f) => f === '20-F' || f === '40-F');
    return {
      ...base,
      ok: false,
      reason: foreign ? 'foreign' : 'nofacts',
      error: foreign
        ? `${name} files its reports under international accounting rules (IFRS), which this tool does not read yet. Try a US company.`
        : `No financial statements were found for ${ticker}. It may be an ETF, fund, SPAC, or a very new listing.`,
    };
  }
  const annualForm = sub.latest10K?.form || '';
  if (annualForm === '20-F' || annualForm === '40-F') {
    return {
      ...base,
      ok: false,
      reason: 'foreign',
      error: `${name} is a foreign company that files a ${annualForm} instead of a US 10-K (often in another currency, with US shares that represent a different number of home-market shares). This version only handles companies that file 10-K reports.`,
    };
  }
  if (sic === 6798) {
    return {
      ...base,
      ok: false,
      reason: 'reit',
      error: `${name} is a REIT (real estate investment trust). REITs are valued with special measures like FFO that this tool does not calculate yet, so a verdict here would be misleading.`,
    };
  }
  const revUnits = Object.keys(usgaap.Revenues?.units || usgaap.RevenueFromContractWithCustomerExcludingAssessedTax?.units || {});
  if (revUnits.length && !revUnits.includes('USD')) {
    return {
      ...base,
      ok: false,
      reason: 'currency',
      error: `${name} reports its financials in ${revUnits[0]}, not US dollars. This version only handles companies that report in USD.`,
    };
  }

  const splits = px?.splits || [];
  const splitsKnown = !!px?.splitsKnown;

  // --- annual series
  const S = (tags, unit = 'USD', mode = 'first') => fb.annualSeries(tags, unit, mode);
  let revPick = fb.annualSeriesConsistent(T.revenue, 'USD');
  if (revPick.series.size < 2) revPick = { series: S(T.revenue, 'USD', 'first'), tag: null };
  const sRev = revPick.series;
  const sNI = S(T.netIncome);
  const sGP = S(T.grossProfit);
  const sCOGS = S(T.costOfRevenue);
  const sOI = S(T.operatingIncome);
  const sPretax = S(T.pretax);
  const sTax = S(T.tax);
  const sIntExp = S(T.interestExpense);
  const sIntInc = S(T.interestIncome);
  const sOCF = S(T.ocf);
  const sCapex = S(T.capex, 'USD', 'max');
  const sCapSw = S(T.capSoftware);
  const sSBC = S(T.sbc);
  const sDA = S(T.da);
  const sEPS = S(T.eps, 'USD/shares');
  const sShares = S(T.shares, 'shares');

  const refSeries = sRev.size >= 2 ? sRev : sNI;
  let ends = [...refSeries.keys()].sort().slice(-11);
  if (ends.length < 2) {
    const forms = sub.recentForms || [];
    const newListing = forms.some((f) => /^(S-1|F-1|424B[14])/.test(f)) && !forms.includes('10-K');
    const bigCompany = isNum(px?.marketCapRef) && px.marketCapRef > 5e9;
    return {
      ...base,
      ok: false,
      reason: 'history',
      error: newListing
        ? `${name} went public recently and hasn't filed two annual reports yet, so its fundamentals can't be judged here. Check again after its next annual report.`
        : bigCompany
        ? `${name} recently changed its SEC registration (for example by creating a new holding company), so its long history is filed under an older ID that this tool can't link yet. Fundamentals can't be judged from the new filings alone.`
        : `Not enough annual reports on file for ${ticker} to analyze (needs at least 2 years). Very new companies cannot be judged on fundamentals yet.`,
    };
  }
  const fyEnd = ends[ends.length - 1];
  if (daysBetween(fyEnd, data.fetchedAt.slice(0, 10)) > 500) {
    warnings.push(`The latest annual report on file ends ${fyEnd}. The company may have stopped filing, so these numbers may be outdated.`);
  }

  // Debt at one date. Returns null when the filing for that date used none of the tags we read.
  const debtExact = (date) => {
    const g = (tags) => fb.instantAt(tags, date);
    const ltdTotal = g(T.ltdTotal);
    const ltdNon = g(T.ltdNoncurrent);
    const ltdCur = g(T.ltdCurrent);
    const debtCur = g(T.debtCurrent);
    const st = g(T.stBorrow);
    if ([ltdTotal, ltdNon, ltdCur, debtCur, st].every((v) => v === null)) {
      const combined = g(T.debtTotal);
      return combined === null ? null : combined;
    }
    if (isNum(debtCur)) {
      const lt = isNum(ltdNon) ? ltdNon : isNum(ltdTotal) ? ltdTotal - (ltdCur || 0) : 0;
      return lt + debtCur;
    }
    const lt = isNum(ltdTotal) ? ltdTotal : (ltdNon || 0) + (ltdCur || 0);
    return lt + (st || 0);
  };
  // Quarterly reports sometimes tag debt differently from annual ones. Never read that as "no debt":
  // fall back to the closest earlier balance sheet (within ~9 months) that has debt figures.
  const debtAt = (date) => {
    const exact = debtExact(date);
    if (exact !== null) return exact;
    const dates = new Set();
    for (const t of DEBT_TAGS) {
      for (const k of fb.instantMap(t).keys()) if (k < date && daysBetween(k, date) <= 280) dates.add(k);
    }
    for (const k of [...dates].sort().reverse()) {
      const v = debtExact(k);
      if (v !== null) return v;
    }
    return 0;
  };
  const bsAt = (date) => ({
    cash: fb.instantAt(T.cash, date) ?? 0,
    stInv: fb.instantAt(T.stInv, date, 'max') ?? 0,
    ltInv: fb.instantAt(T.ltInv, date, 'max') ?? 0,
    debt: debtAt(date),
    equity: fb.instantAt(T.equity, date),
    assets: fb.instantAt(T.assets, date),
    curAssets: fb.instantAt(T.curAssets, date),
    curLiab: fb.instantAt(T.curLiab, date),
  });

  const rows = ends.map((end) => {
    const v = (m) => valueAt(m, end, 12)?.val ?? null;
    const rev = v(sRev);
    let gp = v(sGP);
    const cogs = v(sCOGS);
    if (!isNum(gp) && isNum(rev) && isNum(cogs)) gp = rev - cogs;
    const ni = v(sNI);
    const pretax = v(sPretax);
    const tax = v(sTax);
    const intExp = v(sIntExp);
    let oi = v(sOI);
    if (!isNum(oi) && isNum(pretax)) oi = pretax + (intExp || 0);
    const ocf = v(sOCF);
    const capexBase = v(sCapex);
    const capexTag = valueAt(sCapex, end, 12)?.tag;
    const capSw = capexTag === 'PaymentsToAcquireProductiveAssets' ? 0 : v(sCapSw) || 0;
    const capex = isNum(capexBase) ? capexBase + capSw : isNum(ocf) ? capSw : null;
    const fcf = isNum(ocf) ? ocf - (capex || 0) : null;
    const sbc = v(sSBC);
    const da = v(sDA);
    const sh = valueAt(sShares, end, 12);
    const ep = valueAt(sEPS, end, 12);
    const shFactor = sh ? splitFactorAfter(splits, sh.filed) : 1;
    const epFactor = ep ? splitFactorAfter(splits, ep.filed) : 1;
    let shares = sh ? sh.val * shFactor : null;
    if (isNum(shares) && shares > 0 && shares < 1e5) shares *= 1e6; // some filers tag share counts in millions
    let eps = ep ? ep.val / epFactor : null;
    // cross-check share count with profit / EPS (fixes scale errors in filings)
    if (isNum(ni) && isNum(eps) && Math.abs(eps) >= 0.1 && Math.sign(ni) === Math.sign(eps) && ni !== 0) {
      const implied = ni / eps;
      if (!isNum(shares) || shares / implied < 0.7 || shares / implied > 1.4) shares = implied;
    }
    if (!isNum(eps) && isNum(ni) && isNum(shares) && shares > 0) eps = ni / shares;
    const bs = bsAt(end);
    let taxRate = div(tax, pretax);
    if (!isNum(taxRate) || taxRate < 0 || taxRate > 0.4) taxRate = 0.21;
    return {
      end,
      year: Number(end.slice(0, 4)),
      rev,
      gp,
      oi,
      ni,
      pretax,
      tax,
      taxRate,
      intExp,
      intInc: v(sIntInc),
      ocf,
      capex,
      fcf,
      sbc,
      da,
      shares,
      eps,
      ...bs,
    };
  });

  // Fallback split detection when price history (with split events) is unavailable
  if (!splitsKnown) {
    for (let i = rows.length - 2; i >= 0; i--) {
      const a = rows[i];
      const b = rows[i + 1];
      if (!isNum(a.shares) || !isNum(b.shares) || a.shares <= 0) continue;
      const r = b.shares / a.shares;
      const k = Math.round(r);
      if (k >= 2 && k <= 50 && Math.abs(r - k) / k < 0.08) {
        for (let j = 0; j <= i; j++) {
          if (isNum(rows[j].shares)) rows[j].shares *= k;
          if (isNum(rows[j].eps)) rows[j].eps /= k;
        }
        warnings.push('A stock split was detected in the share count history and adjusted for automatically.');
      }
    }
  }

  // per-year derived metrics
  rows.forEach((r, i) => {
    const prev = rows[i - 1];
    r.grossMargin = div(r.gp, r.rev);
    r.opMargin = div(r.oi, r.rev);
    r.netMargin = div(r.ni, r.rev);
    r.fcfMargin = div(r.fcf, r.rev);
    r.fcfAfterSbc = isNum(r.fcf) ? r.fcf - (r.sbc || 0) : null;
    r.ownerMargin = div(r.fcfAfterSbc, r.rev);
    r.sbcPct = div(r.sbc, r.rev);
    r.ebitda = isNum(r.oi) ? r.oi + (r.da || 0) : null;
    const ic = (b) => (isNum(b.equity) ? b.debt + b.equity - b.cash - b.stInv : null);
    const icNow = ic(r);
    const icPrev = prev ? ic(prev) : null;
    let icAvg = isNum(icNow) && isNum(icPrev) ? (icNow + icPrev) / 2 : icNow;
    const nopat = isNum(r.oi) ? r.oi * (1 - r.taxRate) : null;
    if (isNum(icAvg) && icAvg <= 0 && isNum(r.equity)) {
      const alt = r.debt + r.equity;
      icAvg = alt > 0 ? alt : null;
    }
    r.roic = isNum(icAvg) && icAvg > 0 ? div(nopat, icAvg) : null;
    const eqAvg = prev && isNum(prev.equity) && isNum(r.equity) ? (prev.equity + r.equity) / 2 : r.equity;
    r.roe = isNum(eqAvg) && eqAvg > 0 ? div(r.ni, eqAvg) : null;
    r.revGrowth = prev ? (isNum(prev.rev) && prev.rev > 0 ? div(r.rev, prev.rev) - 1 : null) : null;
  });

  const last = rows[rows.length - 1];
  const lastN = (n) => rows.slice(-n);
  const yearsOfData = rows.filter((r) => isNum(r.rev) || isNum(r.ni)).length;

  // --- latest balance sheet and trailing-twelve-month figures
  const assetsMap = fb.instantMap('Assets');
  const bsDate = [...assetsMap.keys()].sort().pop() || fyEnd;
  const bsNow = bsAt(bsDate);
  const ttmOf = (tags, unit = 'USD', mode = 'first') => ttm(fb, tags, unit, fyEnd, mode);
  const tRev = (() => {
    if (!revPick.tag) return ttmOf(T.revenue, 'USD', 'first');
    const primary = ttmForTag(fb, revPick.tag, 'USD', fyEnd);
    if (primary && primary.method === 'TTM') return primary;
    // primary tag has no quarterly data: borrow quarters from a tag that matches it for the last fiscal year
    const fyVal = valueAt(sRev, fyEnd, 12)?.val;
    for (const t of T.revenue) {
      if (t === revPick.tag) continue;
      const r = ttmForTag(fb, t, 'USD', fyEnd);
      if (!r || r.method !== 'TTM') continue;
      const fyT = valueAt(fb.annualMap(t, 'USD'), fyEnd, 12)?.val;
      if (fyVal && fyT && Math.abs(fyT / fyVal - 1) < 0.03) return r;
    }
    return primary || ttmOf(T.revenue, 'USD', 'first');
  })();
  const tNI = ttmOf(T.netIncome);
  const tGP = ttmOf(T.grossProfit);
  const tCOGS = ttmOf(T.costOfRevenue);
  const tOI = ttmOf(T.operatingIncome);
  const tOCF = ttmOf(T.ocf);
  const tCapex = ttmOf(T.capex, 'USD', 'max');
  const tCapSw = ttmOf(T.capSoftware);
  const tSBC = ttmOf(T.sbc);
  const tDA = ttmOf(T.da);
  const tInt = ttmOf(T.interestExpense);
  const tIntInc = ttmOf(T.interestIncome);
  const tPretax = ttmOf(T.pretax);
  const val = (x, fallback) => (x && isNum(x.val) ? x.val : fallback);
  const now = {
    rev: val(tRev, last.rev),
    ni: val(tNI, last.ni),
    oi: val(tOI, last.oi),
    ocf: val(tOCF, last.ocf),
    sbc: val(tSBC, last.sbc),
    da: val(tDA, last.da),
    intExp: val(tInt, last.intExp),
    intInc: val(tIntInc, last.intInc),
    pretax: val(tPretax, last.pretax),
  };
  let gpNow = val(tGP, null);
  if (!isNum(gpNow) && tCOGS && tRev && tCOGS.end === tRev.end) gpNow = tRev.val - tCOGS.val;
  now.gp = isNum(gpNow) ? gpNow : last.gp;
  if (!isNum(now.oi) && isNum(now.pretax)) now.oi = now.pretax + (now.intExp || 0);
  const capexNow = val(tCapex, last.capex) ?? 0;
  const capSwNow = tCapex?.tag === 'PaymentsToAcquireProductiveAssets' ? 0 : val(tCapSw, 0) || 0;
  now.capex = capexNow + capSwNow;
  now.fcf = isNum(now.ocf) ? now.ocf - now.capex : null;
  now.fcfAfterSbc = isNum(now.fcf) ? now.fcf - (now.sbc || 0) : null;
  now.ebitda = isNum(now.oi) ? now.oi + (now.da || 0) : null;
  const ttmEnd = tRev?.end || tNI?.end || fyEnd;
  const ttmLabel = tRev?.method === 'TTM' ? `12 months to ${ttmEnd}` : `fiscal year ending ${fyEnd}`;

  // recent growth: this fiscal year-to-date vs. same period last year (or latest full year)
  let recentGrowth = null;
  let recentGrowthLabel = '';
  if (tRev?.method === 'TTM' && isNum(tRev.ytdPrior) && tRev.ytdPrior > 0) {
    recentGrowth = tRev.ytd / tRev.ytdPrior - 1;
    recentGrowthLabel = `first ${tRev.ytdMonths} months of this fiscal year vs. last year`;
  } else if (isNum(last.revGrowth)) {
    recentGrowth = last.revGrowth;
    recentGrowthLabel = `fiscal ${last.year} vs. prior year`;
  }

  // --- shares outstanding now (split-adjusted)
  let sharesNow = null;
  let sharesSource = '';
  {
    let best = null;
    for (const tag of T.shares) {
      for (const f of fb.list(tag, 'shares')) {
        if (!f.start) continue;
        const dur = daysBetween(f.start, f.end);
        if (!best || f.end > best.end || (f.end === best.end && dur < best.dur) || (f.end === best.end && dur === best.dur && f.filed > best.filed))
          best = { ...f, dur };
      }
      if (best) break;
    }
    if (best && daysBetween(best.end, bsDate) > 550) best = null; // stale (e.g. tag no longer used)
    if (best) {
      let v = best.val * splitFactorAfter(splits, best.filed);
      if (v > 0 && v < 1e5) v *= 1e6; // filer tagged shares in millions
      sharesNow = v;
      sharesSource = `diluted weighted average, period ending ${best.end}`;
    }
    const deiAll = fb.list('EntityCommonStockSharesOutstanding', 'shares');
    const dei = deiAll.filter((f) => daysBetween(f.end, bsDate) < 550);
    if (dei.length) {
      const latestEnd = dei.reduce((m, f) => (f.end > m ? f.end : m), '');
      const sameDate = dei.filter((f) => f.end === latestEnd);
      const latestFiled = sameDate.reduce((m, f) => (f.filed > m ? f.filed : m), '');
      const vals = sameDate.filter((f) => f.filed === latestFiled);
      let total = vals.reduce((s, f) => s + f.val, 0) * splitFactorAfter(splits, latestFiled);
      if (total > 0 && total < 1e5) total *= 1e6;
      const ratio = isNum(sharesNow) ? total / sharesNow : null;
      if (total > 0 && (!isNum(sharesNow) || (ratio > 0.8 && ratio < 1.25 && (!best || latestEnd >= best.end)))) {
        sharesNow = total;
        sharesSource = `shares outstanding as of ${latestEnd} (cover of latest filing)`;
      }
    }
    if (!isNum(sharesNow) && isNum(last.shares)) {
      sharesNow = last.shares;
      sharesSource = 'diluted weighted average, latest fiscal year';
    }
  }

  // --- cross-check with the market-data provider's market value (catches splits after the
  //     latest filing, share-class quirks like Berkshire, and scale errors in filings)
  if (isNum(px?.marketCapRef) && isNum(px?.price) && px.price > 0) {
    const refShares = px.marketCapRef / px.price;
    if (!isNum(sharesNow) || sharesNow <= 0) {
      sharesNow = refShares;
      sharesSource = 'market data (Nasdaq)';
    } else {
      const r = refShares / sharesNow;
      if (r > 1.25) {
        const k = Math.round(r);
        const isSplit = !splitsKnown && k >= 2 && k <= 50 && Math.abs(r - k) / k < 0.06 && /period ending|as of/.test(sharesSource);
        const factor = isSplit ? k : r;
        sharesNow *= factor;
        rows.forEach((row) => {
          if (isNum(row.shares)) row.shares *= factor;
          if (isNum(row.eps)) row.eps /= factor;
        });
        warnings.push(
          isSplit
            ? `A recent ${k}-for-1 stock split (after the latest filing) was detected and adjusted for.`
            : 'The share count in the filings did not match market data (multiple share classes or unusual reporting), so it was adjusted to match.'
        );
        sharesSource = isSplit ? `${sharesSource}, adjusted for a ${k}-for-1 split` : 'market data (Nasdaq)';
      }
    }
  }

  // --- price and market value
  const price = px?.price ?? null;
  const marketCap = isNum(price) && isNum(sharesNow) ? price * sharesNow : null;
  if (!isNum(price)) warnings.push('Live price could not be loaded, so valuation and the Shariah ratios that need market value are limited.');
  if (px && (px.monthly || []).length < 24) warnings.push('Price history was unavailable; comparisons with past valuations are skipped.');
  const cashAll = bsNow.cash + bsNow.stInv + bsNow.ltInv;
  const netCash = cashAll - bsNow.debt;
  const ev = isNum(marketCap) ? marketCap - netCash : null;

  // ================================================================ SHARIAH
  const bizScreen = businessScreen(sic, name, ticker);
  const shChecks = [];
  const denom = isNum(marketCap) ? marketCap : null;
  const denomLabel = 'market value';
  const debtRatio = div(bsNow.debt, denom);
  const secRatio = div(bsNow.cash + bsNow.stInv + bsNow.ltInv, denom);
  const intIncRatio = isNum(now.intInc) && isNum(now.rev) && now.rev > 0 ? now.intInc / now.rev : null;
  const checkLimit = (v, lim) => (isNum(v) ? v < lim : null);
  shChecks.push({
    key: 'sh_business',
    label: 'Business activity',
    value: bizScreen.reason,
    pass: bizScreen.status === 'pass' ? true : bizScreen.status === 'fail' ? false : null,
    limit: 'No alcohol, pork, gambling, conventional finance/insurance, tobacco, adult content',
  });
  shChecks.push({
    key: 'sh_debt',
    label: `Interest-bearing debt / ${denomLabel}`,
    value: round(debtRatio, 4),
    fmt: 'pct',
    pass: checkLimit(debtRatio, 0.3),
    limit: 'below 30%',
    borderline: isNum(debtRatio) && debtRatio >= 0.25 && debtRatio < 0.3,
  });
  shChecks.push({
    key: 'sh_cash',
    label: `Cash + interest-bearing securities / ${denomLabel}`,
    value: round(secRatio, 4),
    fmt: 'pct',
    pass: checkLimit(secRatio, 0.3),
    limit: 'below 30%',
    borderline: isNum(secRatio) && secRatio >= 0.25 && secRatio < 0.3,
  });
  shChecks.push({
    key: 'sh_income',
    label: 'Interest income / revenue',
    value: round(intIncRatio, 4),
    fmt: 'pct',
    pass: isNum(intIncRatio) ? intIncRatio < 0.05 : null,
    limit: 'below 5%',
    borderline: isNum(intIncRatio) && intIncRatio >= 0.04 && intIncRatio < 0.05,
    note: isNum(intIncRatio) ? '' : 'Not reported separately',
  });
  const finFails = shChecks.filter((c) => c.key !== 'sh_business' && c.pass === false);
  const finUnknown = shChecks.filter((c) => (c.key === 'sh_debt' || c.key === 'sh_cash') && c.pass === null);
  const borderline = shChecks.filter((c) => c.borderline);
  let shStatus;
  let shHeadline;
  if (bizScreen.status === 'fail') {
    shStatus = 'fail';
    shHeadline = `Not Shariah-compliant: ${bizScreen.reason.toLowerCase()}`;
  } else if (finFails.length) {
    shStatus = 'fail';
    shHeadline = `Not Shariah-compliant: ${finFails.map((c) => c.label.split(' / ')[0].toLowerCase() + ' too high').join(', ')}`;
  } else if (bizScreen.status === 'review') {
    shStatus = 'review';
    shHeadline = `Needs checking: ${bizScreen.reason.toLowerCase()}`;
  } else if (finUnknown.length) {
    shStatus = 'review';
    shHeadline = 'Needs checking: some ratios could not be calculated';
  } else if (borderline.length) {
    shStatus = 'review';
    shHeadline = 'Passes, but close to the limits (can flip with price moves)';
  } else {
    shStatus = 'pass';
    shHeadline = 'Passes the AAOIFI-style screen';
  }
  const shariah = {
    status: shStatus,
    headline: shHeadline,
    checks: shChecks,
    business: bizScreen,
    note:
      'Approximation of the AAOIFI method using SEC data and the live price. It cannot see the "less than 5% impermissible revenue" detail inside segments, so always confirm on Zoya or Musaffa before buying.',
  };

  // ================================================================ QUALITY
  const r5 = lastN(5);
  const roicMed = median(r5.map((r) => r.roic));
  const roicYearsGood = r5.filter((r) => isNum(r.roic) && r.roic >= 0.1).length;
  const roicYearsKnown = r5.filter((r) => isNum(r.roic)).length;
  const gmVals = r5.map((r) => r.grossMargin).filter(isNum);
  const gmMed = median(gmVals);
  const gmRange = gmVals.length >= 3 ? Math.max(...gmVals) - Math.min(...gmVals) : null;
  const opMarginNow = div(now.oi, now.rev);
  const opMed5 = median(r5.map((r) => r.opMargin));
  const fcfMargins3 = [...lastN(3).map((r) => r.fcfMargin), div(now.fcf, now.rev)];
  const fcfMarginMed = median(fcfMargins3);
  const r3 = lastN(3);
  const sumNI3 = r3.reduce((s, r) => s + (r.ni || 0), 0);
  const sumFCF3 = r3.reduce((s, r) => s + (r.fcf || 0), 0);
  const fcfConversion = sumNI3 > 0 ? sumFCF3 / sumNI3 : null;
  const profitYears = r5.filter((r) => isNum(r.ni) && r.ni > 0).length;
  const profitKnown = r5.filter((r) => isNum(r.ni)).length;
  const shareRows = rows.filter((r) => isNum(r.shares) && r.shares > 0);
  let shareCagr = null;
  let shareYears = 0;
  if (shareRows.length >= 3) {
    const window = shareRows.slice(-6);
    shareYears = window[window.length - 1].year - window[0].year;
    shareCagr = cagr(window[0].shares, window[window.length - 1].shares, shareYears);
  }
  const sbcPctNow = div(now.sbc, now.rev);

  const opVals = r5.map((r) => r.opMargin).filter(isNum);
  const opRange = opVals.length >= 3 ? Math.max(...opVals) - Math.min(...opVals) : null;
  const stabilityRange = isNum(gmRange) ? gmRange : opRange;
  const highRoic = isNum(roicMed) && roicMed >= 0.15;

  const qm = [];
  qm.push(
    metric(
      'roic',
      'Return on invested capital (5-yr median)',
      roicMed,
      'pct',
      band(roicMed, [
        [0.2, 30, 'good'],
        [0.15, 25, 'good'],
        [0.1, 16, 'ok'],
        [0.06, 7, 'bad'],
      ]) || { pts: 12, rating: 'na' },
      30
    )
  );
  qm.push(
    metric(
      'roic_consistency',
      'Years with ROIC above 10% (last 5)',
      roicYearsKnown ? `${roicYearsGood} of ${roicYearsKnown}` : null,
      'text',
      roicYearsKnown
        ? roicYearsGood >= 5
          ? { pts: 10, rating: 'good' }
          : roicYearsGood === 4
          ? { pts: 7, rating: 'good' }
          : roicYearsGood === 3
          ? { pts: 4, rating: 'ok' }
          : { pts: 0, rating: 'bad' }
        : { pts: 4, rating: 'na' },
      10
    )
  );
  // margins: absolute levels differ a lot by industry (a supermarket earns 3%, software 30%),
  // so a business that still earns high returns on capital keeps most of these points
  const gmScore = band(gmMed, [
    [0.6, 8, 'good'],
    [0.4, 6, 'good'],
    [0.25, 3, 'ok'],
    [0, 1, 'bad'],
  ]) || { pts: 4, rating: 'na' };
  const opScore = band(opMarginNow, [
    [0.25, 7, 'good'],
    [0.15, 5, 'good'],
    [0.08, 3, 'ok'],
    [0, 1, 'bad'],
  ]) || { pts: 3, rating: 'na' };
  let marginPts = gmScore.pts + opScore.pts;
  let marginNote = '';
  if (highRoic && marginPts < 10 && isNum(opMarginNow) && opMarginNow > 0) {
    marginPts = 10;
    marginNote = 'Thin margins, but high returns on capital show the business model works (high volume, low price)';
  }
  qm.push(
    metric('gross_margin', 'Gross margin (5-yr median)', gmMed, 'pct', { pts: null, rating: gmScore.rating }, null, isNum(gmMed) ? '' : 'Company does not report gross profit')
  );
  qm.push(
    metric(
      'op_margin',
      'Operating margin (last 12 months)',
      opMarginNow,
      'pct',
      { pts: marginPts, rating: marginNote ? 'ok' : opScore.rating },
      15,
      marginNote || 'Points shown here cover both margins'
    )
  );
  qm.push(
    metric(
      'margin_stability',
      'Margin swing over 5 years',
      stabilityRange,
      'pts',
      bandLow(stabilityRange, [
        [0.03, 7, 'good'],
        [0.06, 5, 'good'],
        [0.1, 2, 'ok'],
      ]) || { pts: 3, rating: 'na' },
      7
    )
  );
  qm.push(
    metric(
      'fcf_margin',
      'Free cash flow margin (recent median)',
      fcfMarginMed,
      'pct',
      band(fcfMarginMed, [
        [0.15, 6, 'good'],
        [0.08, 4, 'good'],
        [0.03, 2, 'ok'],
        [0, 1, 'bad'],
      ]) || { pts: 2, rating: 'na' },
      6
    )
  );
  qm.push(
    metric(
      'fcf_conversion',
      'Cash conversion (free cash flow / profit, 3 yrs)',
      fcfConversion,
      'pct',
      band(fcfConversion, [
        [0.9, 8, 'good'],
        [0.7, 5, 'ok'],
        [0.5, 2, 'bad'],
      ]) || { pts: 2, rating: 'na' },
      8
    )
  );
  qm.push(
    metric(
      'profit_consistency',
      'Profitable years (last 5)',
      profitKnown ? `${profitYears} of ${profitKnown}` : null,
      'text',
      profitKnown
        ? profitYears >= 5
          ? { pts: 8, rating: 'good' }
          : profitYears === 4
          ? { pts: 5, rating: 'ok' }
          : { pts: 0, rating: 'bad' }
        : { pts: 3, rating: 'na' },
      8
    )
  );
  qm.push(
    metric(
      'dilution',
      `Share count change per year (${shareYears || 5} yrs)`,
      shareCagr,
      'pct',
      bandLow(shareCagr, [
        [0.0, 8, 'good'],
        [0.02, 5, 'ok'],
        [0.04, 2, 'bad'],
      ]) || { pts: 3, rating: 'na' },
      8
    )
  );
  qm.push(
    metric(
      'sbc',
      'Stock-based pay as % of revenue',
      sbcPctNow,
      'pct',
      bandLow(sbcPctNow, [
        [0.05, 8, 'good'],
        [0.1, 5, 'ok'],
        [0.15, 2, 'bad'],
      ]) || { pts: 5, rating: 'na' },
      8
    )
  );
  const qualityScore = Math.round(qm.reduce((s, m) => s + (m.points || 0), 0));

  // ================================================================ FINANCIAL HEALTH
  const netDebt = bsNow.debt - cashAll;
  const ndEbitda = isNum(now.ebitda) && now.ebitda > 0 ? netDebt / now.ebitda : null;
  const intCover = isNum(now.intExp) && Math.abs(now.intExp) > 0 && isNum(now.oi) ? now.oi / Math.abs(now.intExp) : null;
  const currentRatio = div(bsNow.curAssets, bsNow.curLiab);
  const debtToEquity = isNum(bsNow.equity) && bsNow.equity > 0 ? bsNow.debt / bsNow.equity : null;
  const debtToFcf = isNum(now.fcf) && now.fcf > 0 ? bsNow.debt / now.fcf : null;
  const hm = [];
  let ndScore;
  if (netDebt <= 0) ndScore = { pts: 35, rating: 'good' };
  else if (!isNum(ndEbitda)) ndScore = { pts: 0, rating: 'bad' };
  else
    ndScore = bandLow(ndEbitda, [
      [1, 30, 'good'],
      [2, 22, 'good'],
      [3, 12, 'ok'],
      [4, 5, 'bad'],
    ]);
  hm.push(
    metric(
      'net_debt_ebitda',
      'Net debt / EBITDA',
      netDebt <= 0 ? 'Net cash' : ndEbitda,
      netDebt <= 0 ? 'text' : 'x',
      ndScore,
      35,
      netDebt <= 0 ? `Holds ${moneyTxt(-netDebt)} more cash than debt` : isNum(ndEbitda) ? '' : 'Earnings before interest are negative'
    )
  );
  let icScore;
  if (bsNow.debt <= 0 || (isNum(now.intExp) && Math.abs(now.intExp) < 1)) icScore = { pts: 25, rating: 'good' };
  else if (!isNum(intCover)) icScore = { pts: 12, rating: 'na' };
  else
    icScore = band(intCover, [
      [15, 25, 'good'],
      [8, 20, 'good'],
      [4, 12, 'ok'],
      [2, 5, 'bad'],
    ]);
  hm.push(
    metric(
      'interest_cover',
      'Interest coverage (operating profit / interest)',
      bsNow.debt <= 0 ? 'No debt' : intCover,
      bsNow.debt <= 0 ? 'text' : 'x',
      icScore,
      25,
      !isNum(intCover) && bsNow.debt > 0 ? 'Interest expense not reported separately' : ''
    )
  );
  hm.push(
    metric(
      'current_ratio',
      'Current ratio (short-term assets / short-term bills)',
      currentRatio,
      'x',
      band(currentRatio, [
        [1.5, 15, 'good'],
        [1.0, 10, 'ok'],
        [0.8, 5, 'bad'],
      ]) || { pts: 8, rating: 'na' },
      15
    )
  );
  let deScore;
  if (isNum(debtToEquity))
    deScore = bandLow(debtToEquity, [
      [0.5, 10, 'good'],
      [1, 7, 'ok'],
      [2, 3, 'bad'],
    ]);
  else if (isNum(bsNow.equity) && bsNow.equity <= 0) deScore = { pts: isNum(ndEbitda) && ndEbitda < 3 ? 5 : 0, rating: 'na' };
  else deScore = { pts: 5, rating: 'na' };
  hm.push(
    metric(
      'debt_equity',
      'Debt / equity',
      debtToEquity,
      'x',
      deScore,
      10,
      isNum(bsNow.equity) && bsNow.equity <= 0 ? 'Negative equity (often caused by large buybacks)' : ''
    )
  );
  let dfScore;
  if (bsNow.debt <= 0) dfScore = { pts: 15, rating: 'good' };
  else if (!isNum(debtToFcf)) dfScore = { pts: 0, rating: 'bad' };
  else
    dfScore = bandLow(debtToFcf, [
      [3, 15, 'good'],
      [5, 8, 'ok'],
      [8, 3, 'bad'],
    ]);
  hm.push(
    metric(
      'debt_fcf',
      'Years of free cash flow to repay all debt',
      bsNow.debt <= 0 ? 'No debt' : debtToFcf,
      bsNow.debt <= 0 ? 'text' : 'years',
      dfScore,
      15,
      bsNow.debt > 0 && !isNum(debtToFcf) ? 'Free cash flow is negative' : ''
    )
  );
  const healthScore = Math.round(hm.reduce((s, m) => s + (m.points || 0), 0));

  // ================================================================ GROWTH
  const revRows = rows.filter((r) => isNum(r.rev) && r.rev > 0);
  const pickSpan = (arr, maxYears) => {
    if (arr.length < 2) return null;
    const lastR = arr[arr.length - 1];
    let firstR = arr[0];
    for (const r of arr) {
      if (lastR.year - r.year <= maxYears) {
        firstR = r;
        break;
      }
    }
    const yrs = lastR.year - firstR.year;
    return yrs >= 1 ? { first: firstR, last: lastR, years: yrs } : null;
  };
  const span5 = pickSpan(revRows, 5);
  const span3 = pickSpan(revRows, 3);
  const revCagr5 = span5 ? cagr(span5.first.rev, span5.last.rev, span5.years) : null;
  const revCagr3 = span3 ? cagr(span3.first.rev, span3.last.rev, span3.years) : null;
  const growthYears = span5?.years || 0;
  const epsRows = rows.filter((r) => isNum(r.eps));
  const epsSpan = pickSpan(epsRows, 5);
  const epsCagr = epsSpan ? cagr(epsSpan.first.eps, epsSpan.last.eps, epsSpan.years) : null;
  const epsNote =
    epsSpan && (!isNum(epsCagr) || epsSpan.first.eps <= 0 || epsSpan.last.eps <= 0) ? 'Not meaningful (losses in start or end year)' : '';
  // FCF per share, smoothed with 2-year averages at each end (cash flow is lumpy)
  let fcfpsCagr = null;
  {
    const fr = rows.filter((r) => isNum(r.fcf) && isNum(r.shares) && r.shares > 0).slice(-6);
    if (fr.length >= 4) {
      const ps = fr.map((r) => r.fcf / r.shares);
      const a = (ps[0] + ps[1]) / 2;
      const b = (ps[ps.length - 1] + ps[ps.length - 2]) / 2;
      const yrs = fr[fr.length - 1].year - fr[0].year - 1;
      fcfpsCagr = yrs >= 1 ? cagr(a, b, yrs) : null;
    }
  }
  const last5Growth = rows.slice(-5).map((r) => r.revGrowth).filter(isNum);
  const upYears = last5Growth.filter((g) => g > 0).length;
  const gm = [];
  const growthSteps = [
    [0.2, 30, 'good'],
    [0.15, 25, 'good'],
    [0.1, 19, 'good'],
    [0.06, 12, 'ok'],
    [0.03, 6, 'ok'],
    [0, 2, 'bad'],
  ];
  gm.push(
    metric(
      'rev_cagr',
      `Revenue growth per year (${growthYears || 'n/a'} yrs)`,
      revCagr5,
      'pct',
      band(revCagr5, growthSteps) || { pts: 0, rating: 'na' },
      30
    )
  );
  gm.push(
    metric(
      'eps_cagr',
      `Earnings per share growth per year (${epsSpan?.years || 'n/a'} yrs)`,
      epsCagr,
      'pct',
      band(
        epsCagr,
        growthSteps.map(([a, p, r]) => [a, Math.round((p * 25) / 30), r])
      ) || { pts: 0, rating: 'na' },
      25,
      epsNote
    )
  );
  gm.push(
    metric(
      'fcfps_cagr',
      'Free cash flow per share growth per year',
      fcfpsCagr,
      'pct',
      band(
        fcfpsCagr,
        growthSteps.map(([a, p, r]) => [a, Math.round((p * 20) / 30), r])
      ) || { pts: 0, rating: 'na' },
      20
    )
  );
  gm.push(
    metric(
      'growth_consistency',
      'Years revenue grew (last 5)',
      last5Growth.length ? `${upYears} of ${last5Growth.length}` : null,
      'text',
      last5Growth.length
        ? upYears >= 5
          ? { pts: 15, rating: 'good' }
          : upYears === 4
          ? { pts: 10, rating: 'good' }
          : upYears === 3
          ? { pts: 5, rating: 'ok' }
          : { pts: 0, rating: 'bad' }
        : { pts: 0, rating: 'na' },
      15
    )
  );
  let momentum = null;
  if (isNum(recentGrowth) && isNum(revCagr5)) {
    const diff = recentGrowth - revCagr5;
    momentum = diff >= -0.02 ? { pts: 10, rating: 'good' } : diff >= -0.07 ? { pts: 5, rating: 'ok' } : { pts: 0, rating: 'bad' };
  }
  gm.push(metric('recent_growth', 'Recent revenue growth', recentGrowth, 'pct', momentum || { pts: 3, rating: 'na' }, 10, recentGrowthLabel));
  const growthScore = Math.round(gm.reduce((s, m) => s + (m.points || 0), 0));
  const tinyBase = span5 && span5.first.rev < 0.1 * span5.last.rev && span5.first.rev < 1e9;
  const gRef = isNum(revCagr5) && isNum(revCagr3) ? Math.min(revCagr5, revCagr3) : isNum(revCagr5) ? revCagr5 : revCagr3;
  let growthLabel = 'Unknown';
  if (isNum(gRef)) growthLabel = gRef >= 0.15 ? 'High growth' : gRef >= 0.07 ? 'Steady growth' : gRef >= 0.02 ? 'Slow growth' : gRef >= -0.02 ? 'Not growing' : 'Shrinking';
  if (tinyBase && isNum(gRef)) growthLabel += ' (from a small base)';

  // ================================================================ VALUATION
  const vm = [];
  const pe = isNum(marketCap) && isNum(now.ni) && now.ni > 0 ? marketCap / now.ni : null;
  const pfcf = isNum(marketCap) && isNum(now.fcf) && now.fcf > 0 ? marketCap / now.fcf : null;
  const evEbit = isNum(ev) && isNum(now.oi) && now.oi > 0 ? ev / now.oi : null;
  const ownerYield = isNum(marketCap) && isNum(now.fcfAfterSbc) ? now.fcfAfterSbc / marketCap : null;
  const peg = isNum(pe) && isNum(epsCagr) && epsCagr > 0.02 ? pe / (epsCagr * 100) : null;

  // historical multiples at each fiscal year end
  const monthly = px?.monthly || [];
  const priceAt = (date) => {
    const ym = date.slice(0, 7);
    let candidate = null;
    for (const p of monthly) {
      if (p.date.slice(0, 7) === ym) return p.close;
      if (p.date <= date) candidate = p.close;
    }
    return candidate;
  };
  const histPE = [];
  const histPFCF = [];
  const histRows = [];
  if (monthly.length > 12) {
    for (const r of rows.slice(-7)) {
      if (r.end < monthly[0].date) continue;
      const p = priceAt(r.end);
      if (!isNum(p) || !isNum(r.shares)) continue;
      const mc = p * r.shares;
      const yPE = isNum(r.ni) && r.ni > 0 ? mc / r.ni : null;
      const yPF = isNum(r.fcf) && r.fcf > 0 ? mc / r.fcf : null;
      if (isNum(yPE)) histPE.push(yPE);
      if (isNum(yPF)) histPFCF.push(yPF);
      histRows.push({ year: r.year, price: round(p, 2), pe: round(yPE, 1), pfcf: round(yPF, 1) });
    }
  }
  const medPE = histPE.length >= 3 ? median(histPE) : null;
  const medPFCF = histPFCF.length >= 3 ? median(histPFCF) : null;
  let histRatio = null;
  let histBasis = '';
  if (isNum(pfcf) && isNum(medPFCF)) {
    histRatio = pfcf / medPFCF;
    histBasis = `price/free cash flow ${pfcf.toFixed(1)}x vs. its usual ${medPFCF.toFixed(1)}x`;
  } else if (isNum(pe) && isNum(medPE)) {
    histRatio = pe / medPE;
    histBasis = `P/E ${pe.toFixed(1)}x vs. its usual ${medPE.toFixed(1)}x`;
  }

  // DCF on owner free cash flow (FCF minus stock-based pay)
  const ownerMargins = [...lastN(5).map((r) => r.ownerMargin), div(now.fcfAfterSbc, now.rev)];
  const ownerMarginNorm = median(ownerMargins);
  const gHist = gRef;
  let gBase = null;
  if (isNum(gHist) && isNum(recentGrowth)) gBase = 0.5 * gHist + 0.5 * recentGrowth;
  else gBase = isNum(gHist) ? gHist : recentGrowth;
  if (isNum(gBase)) gBase = clamp(gBase, -0.05, 0.2);
  const losing = (isNum(now.ni) ? now.ni <= 0 : true) && (isNum(now.fcf) ? now.fcf <= 0 : true);
  // discount rate by risk: strong businesses 8%, typical 9%, weaker or small 10%
  let discount = 0.09;
  if (qualityScore >= 70 && healthScore >= 70 && (marketCap || 0) > 10e9) discount = 0.08;
  if (qualityScore < 50 || healthScore < 40 || (isNum(marketCap) && marketCap < 2e9)) discount = 0.1;
  let fair = null;
  if (isNum(marketCap) && isNum(sharesNow) && isNum(now.rev) && now.rev > 0 && isNum(ownerMarginNorm) && ownerMarginNorm > 0.005 && isNum(gBase)) {
    const p0 = { revenue0: now.rev, netCash, shares: sharesNow, r: discount, gT: 0.025 };
    const baseV = dcf({ ...p0, margin: ownerMarginNorm, g1: gBase });
    const bearV = dcf({ ...p0, margin: ownerMarginNorm * 0.85, g1: Math.max(gBase - 0.05, -0.05) });
    const bullV = dcf({ ...p0, margin: ownerMarginNorm * 1.1, g1: Math.min(gBase + 0.04, 0.25) });
    const implied = impliedGrowth({ ...p0, margin: ownerMarginNorm }, marketCap);
    fair = {
      base: round(baseV.perShare, 2),
      bear: round(bearV.perShare, 2),
      bull: round(bullV.perShare, 2),
      buyBelow: round(baseV.perShare * 0.85, 2),
      upside: round(baseV.perShare / price - 1, 4),
      assumedGrowth: round(gBase, 4),
      historicalGrowth: round(gHist, 4),
      impliedGrowth: round(implied.value, 4),
      impliedCapped: implied.capped,
      ownerMargin: round(ownerMarginNorm, 4),
      discountRate: discount,
      terminalGrowth: 0.025,
      price: round(price, 2),
    };
  }

  const scoreUpside = (u) => (u >= 0.25 ? 1 : u >= 0.1 ? 0.5 : u > -0.1 ? 0 : u > -0.25 ? -0.5 : -1);
  const scoreHist = (x) => (x <= 0.75 ? 1 : x <= 0.9 ? 0.5 : x < 1.1 ? 0 : x < 1.3 ? -0.5 : -1);
  const scorePeg = (p) => (p <= 1 ? 1 : p <= 1.5 ? 0.5 : p <= 2.2 ? 0 : p <= 3 ? -0.5 : -1);
  // Valuation label is anchored on the cash-flow estimate (which also sets the fair value shown),
  // with the historical-multiple and PEG checks able to nudge it.
  const sDcf = fair && isNum(fair.upside) ? scoreUpside(fair.upside) : null;
  const sHist = isNum(histRatio) ? scoreHist(histRatio) : null;
  const sPeg = isNum(peg) ? scorePeg(peg) : null;
  const others = [sHist, sPeg].filter(isNum);
  const otherAvg = others.length ? mean(others) : null;
  let valScore = null;
  let valuationBasis = 'none';
  if (isNum(sDcf)) {
    valScore = isNum(otherAvg) ? 0.65 * sDcf + 0.35 * otherAvg : sDcf;
    valuationBasis = 'dcf';
  } else if (isNum(otherAvg)) {
    valScore = otherAvg;
    valuationBasis = 'multiples';
  }
  let valuationLabel = 'Not measurable';
  if (losing) valuationLabel = 'Not measurable (losing money)';
  else if (isNum(valScore)) valuationLabel = valScore >= 0.3 ? 'Undervalued' : valScore <= -0.3 ? 'Overvalued' : 'Fairly valued';
  const rate3 = (s) => (s > 0 ? 'good' : s < 0 ? 'bad' : 'ok');
  vm.push(
    metric(
      'dcf_upside',
      'Upside to estimated fair value',
      fair ? fair.upside : null,
      'pctSigned',
      isNum(sDcf) ? { pts: null, rating: rate3(sDcf) } : null,
      null,
      fair ? `Fair value about $${fair.base.toFixed(2)} vs. price $${price.toFixed(2)}` : 'Could not estimate (no steady free cash flow after stock-based pay)'
    )
  );
  vm.push(
    metric(
      'implied_growth',
      'Growth the price assumes (next 5 yrs, per year)',
      fair ? fair.impliedGrowth : null,
      'pct',
      fair && isNum(gHist) ? { pts: null, rating: fair.impliedGrowth <= gHist - 0.02 ? 'good' : fair.impliedGrowth <= gHist + 0.03 ? 'ok' : 'bad' } : null,
      null,
      fair && isNum(gHist) ? `vs. about ${pctTxt(gHist, 0)} a year in the past` : ''
    )
  );
  vm.push(
    metric(
      'hist_multiple',
      'Price vs. its own past valuation',
      histRatio,
      'xRel',
      isNum(sHist) ? { pts: null, rating: rate3(sHist) } : null,
      null,
      histBasis || 'Not enough price history'
    )
  );
  vm.push(metric('peg', 'PEG ratio (P/E ÷ earnings growth)', peg, 'x', isNum(sPeg) ? { pts: null, rating: rate3(sPeg) } : null, null, isNum(peg) ? '' : 'Needs positive earnings growth'));
  vm.push(metric('pe', 'P/E ratio (last 12 months)', pe, 'x', null, null, isNum(pe) ? '' : 'No profit, so P/E is not meaningful'));
  vm.push(metric('pfcf', 'Price / free cash flow', pfcf, 'x', null, null));
  vm.push(metric('ev_ebit', 'EV / operating profit', evEbit, 'x', null, null));
  vm.push(metric('owner_yield', 'Owner cash yield (FCF after stock pay / market value)', ownerYield, 'pct', null, null));
  const valuationScore = isNum(valScore) ? Math.round(((valScore + 1) / 2) * 100) : null;

  // ================================================================ QUALITATIVE EVIDENCE
  // The numbers can't see the future, but they leave footprints. These checks turn the classic
  // "qualitative" questions into evidence a beginner can read.
  const gmNow = div(now.gp, now.rev);
  const roic10 = rows.slice(-10).filter((r) => isNum(r.roic));
  const highRoicYears = roic10.filter((r) => r.roic >= 0.15).length;
  const roicShare = roic10.length ? highRoicYears / roic10.length : 0;
  const pricedForDecline =
    !!fair && isNum(fair.impliedGrowth) && isNum(gBase) && ((fair.impliedGrowth < 0 && gBase > 0.03) || fair.impliedGrowth < gBase - 0.1);
  const deepDiscount = !!fair && fair.upside > 0.6;

  // moat footprints
  let moatLevel = 'Little evidence';
  if (roic10.length >= 5 && roicShare >= 0.8 && ((isNum(stabilityRange) && stabilityRange <= 0.06) || (isNum(gmMed) && gmMed >= 0.4))) moatLevel = 'Strong evidence';
  else if (roic10.length >= 3 && roicShare >= 0.5) moatLevel = 'Some evidence';
  const moatPoints = [];
  if (roic10.length) moatPoints.push(`Earned 15%+ on invested capital in ${highRoicYears} of the last ${roic10.length} years. Without protection from competitors, returns that high usually get competed away.`);
  if (isNum(stabilityRange)) moatPoints.push(stabilityRange <= 0.06 ? `Margins stayed steady (moved only ${(stabilityRange * 100).toFixed(1)} points in 5 years), a sign of pricing power.` : `Margins moved ${(stabilityRange * 100).toFixed(1)} points in 5 years, so pricing power looks less certain.`);
  if (last5Growth.length) moatPoints.push(`Revenue grew in ${upYears} of the last ${last5Growth.length} years.`);

  // decline / disruption warning signs
  const declineSigns = [];
  if (isNum(recentGrowth) && recentGrowth < 0) declineSigns.push(`Revenue is shrinking right now (${pctTxt(recentGrowth, 1)} vs. last year).`);
  else if (isNum(recentGrowth) && isNum(revCagr5) && recentGrowth < revCagr5 - 0.07) declineSigns.push(`Growth is slowing sharply: ${pctTxt(recentGrowth, 1)} recently vs. ${pctTxt(revCagr5, 1)} a year before.`);
  if (isNum(opMarginNow) && isNum(opMed5) && opMarginNow < opMed5 - 0.05) declineSigns.push(`Operating margin dropped to ${pctTxt(opMarginNow)} from a typical ${pctTxt(opMed5)}. Competition or rising costs may be biting.`);
  if (isNum(gmNow) && isNum(gmMed) && gmNow < gmMed - 0.03) declineSigns.push(`Gross margin slipped to ${pctTxt(gmNow)} from a typical ${pctTxt(gmMed)}, a possible sign of pricing pressure.`);
  const roicLast = roic10.length ? roic10[roic10.length - 1].roic : null;
  const roicPrior = median(roic10.slice(-5, -1).map((r) => r.roic));
  const roicDropped = isNum(roicLast) && isNum(roicPrior) && roicPrior > 0.08 && roicLast < roicPrior * 0.7;
  if (roicDropped) declineSigns.push(`Returns on capital fell to ${pctTxt(roicLast)} last year from a typical ${pctTxt(roicPrior)} (a big acquisition or rising costs can cause this).`);
  if (pricedForDecline) {
    const imp = fair.impliedCapped === 'below' ? 'a steep decline' : `${pctTxt(fair.impliedGrowth, 0)} a year`;
    declineSigns.push(`The market is pricing in ${imp} for revenue, while it grew about ${pctTxt(gHist, 0)} a year. Investors expect a big slowdown, and they may know something the past numbers don't show.`);
  }

  // management and capital allocation
  const mgmt = [];
  if (isNum(shareCagr)) {
    if (shareCagr < -0.01) mgmt.push({ tone: 'good', text: `Buys back shares (count down ${pctTxt(-shareCagr, 1)} a year), returning cash to owners.` });
    else if (shareCagr > 0.03) mgmt.push({ tone: 'bad', text: `Issues lots of new shares (count up ${pctTxt(shareCagr, 1)} a year), shrinking your ownership.` });
    else mgmt.push({ tone: 'ok', text: 'Share count is roughly stable.' });
  }
  const r3ago = rows.length >= 4 ? rows[rows.length - 4] : null;
  if (r3ago && isNum(r3ago.ebitda) && r3ago.ebitda > 0 && isNum(now.ebitda) && now.ebitda > 0) {
    const nd3 = (r3ago.debt - (r3ago.cash + r3ago.stInv + r3ago.ltInv)) / r3ago.ebitda;
    const ndNow = netDebt / now.ebitda;
    if (ndNow > nd3 + 1 && ndNow > 1.5) mgmt.push({ tone: 'bad', text: `Debt is rising faster than earnings (net debt went from ${nd3.toFixed(1)}x to ${ndNow.toFixed(1)}x EBITDA in 3 years).` });
    else if (ndNow < nd3 - 0.5) mgmt.push({ tone: 'good', text: 'Has been paying down debt relative to earnings.' });
  }
  const roicEarly = median(rows.slice(-6, -3).map((r) => r.roic));
  const roicRecent = median(rows.slice(-3).map((r) => r.roic));
  if (isNum(roicEarly) && isNum(roicRecent)) {
    if (roicRecent > roicEarly + 0.03 && !roicDropped) mgmt.push({ tone: 'good', text: `Returns on capital are improving (${pctTxt(roicEarly)} → ${pctTxt(roicRecent)}), so new investments are paying off.` });
    else if (roicRecent < roicEarly - 0.05) mgmt.push({ tone: 'bad', text: `Returns on capital are falling (${pctTxt(roicEarly)} → ${pctTxt(roicRecent)}), so new spending earns less than before.` });
  }
  if (isNum(sbcPctNow) && sbcPctNow > 0.1) mgmt.push({ tone: 'bad', text: `Pays employees heavily in stock (${pctTxt(sbcPctNow)} of revenue).` });

  // ================================================================ LABELS + VERDICT
  const qualityLabel = qualityScore >= 70 ? 'High quality' : qualityScore >= 50 ? 'Average quality' : 'Low quality';
  const healthLabel = healthScore >= 70 ? 'Strong' : healthScore >= 40 ? 'OK' : 'Weak';
  const isFinancial = sic >= 6000 && sic < 6800;
  if (isFinancial) warnings.push('Banks, insurers and other financial companies are judged with different metrics (book value, loan quality). Treat these scores with caution.');

  // confidence
  const fcfMarginVol = stdev(lastN(6).map((r) => r.fcfMargin));
  const conf = [];
  let confidence = 'High';
  const lower = (lvl, why) => {
    if (lvl === 'Low') confidence = 'Low';
    else if (confidence === 'High') confidence = 'Medium';
    conf.push(why);
  };
  if (yearsOfData < 5) lower('Low', 'less than 5 years of history');
  if (!isNum(price)) lower('Low', 'no live price');
  if (isNum(fcfMarginVol) && fcfMarginVol > 0.08) lower('Medium', 'cash flows swing a lot year to year');
  if (profitKnown && profitYears < 4) lower('Medium', 'profits have not been consistent');
  if (isFinancial) lower('Low', 'financial-sector metrics');
  if (valuationBasis === 'multiples') lower('Medium', 'value estimated from multiples only');
  if (valuationBasis === 'none' && !losing) lower('Low', 'no valuation signal available');
  if (declineSigns.length >= 2) lower('Medium', 'warning signs of a slowdown');
  if (valuationLabel === 'Undervalued' && (pricedForDecline || deepDiscount)) lower('Medium', 'the market strongly disagrees with the past numbers');

  const contrarian = valuationLabel === 'Undervalued' && (pricedForDecline || deepDiscount);
  let code;
  if (shStatus === 'fail') code = 'AVOID_SHARIAH';
  else if (yearsOfData < 3) code = 'NODATA';
  else if (isFinancial) code = 'FINANCIAL';
  else if (losing) code = 'SPECULATIVE';
  else if (qualityScore < 50 || healthScore < 40) code = 'AVOID_WEAK';
  else if (qualityScore >= 70) {
    if (valuationLabel === 'Undervalued') {
      if (contrarian) code = 'CONTRARIAN';
      else code = confidence === 'High' && healthScore >= 55 && declineSigns.length === 0 ? 'BUY_STRONG' : 'BUY';
    } else if (valuationLabel === 'Fairly valued') code = declineSigns.length >= 2 ? 'LOOK' : 'BUY';
    else if (valuationLabel === 'Overvalued') code = 'WATCH';
    else code = 'LOOK';
  } else {
    code = valuationLabel === 'Undervalued' ? 'LOOK' : 'PASS';
  }
  const buyBelowTxt = fair ? `$${fair.buyBelow.toFixed(2)}` : 'a lower price';
  const debtNote = healthScore < 55 ? ' Note: it carries meaningful debt, so keep the position small.' : '';
  const signNote = declineSigns.length ? ' Check the warning signs below first.' : '';
  const V = {
    AVOID_SHARIAH: {
      title: 'Avoid: not Shariah-compliant',
      tone: 'bad',
      summary: `${shHeadline.replace(/^Not Shariah-compliant: /, 'Reason: ')}. The analysis below is shown for learning only.`,
    },
    NODATA: { title: 'Not enough history to judge', tone: 'neutral', summary: 'There are fewer than 3 years of annual reports. Fundamentals need a track record.' },
    FINANCIAL: {
      title: 'Not a good fit for this tool',
      tone: 'neutral',
      summary:
        'This is a financial company (bank, broker, insurer or asset manager). They are judged with different measures, like book value and loan quality, so the scores here would be misleading. Many are also not Shariah-compliant: check Zoya or Musaffa.',
    },
    SPECULATIVE: {
      title: 'Speculative: not profitable',
      tone: 'bad',
      summary:
        'The company is losing money and burning cash, so a fundamentals-based value cannot be calculated. Its price depends on profits that may or may not arrive. Not a fit for someone relying on fundamentals.',
    },
    AVOID_WEAK: {
      title: 'Avoid: weak fundamentals',
      tone: 'bad',
      summary:
        qualityScore < 50
          ? 'The business does not earn strong, reliable returns on its capital. Even if the price looks cheap, low-quality companies are often cheap for a reason.'
          : 'The balance sheet carries too much risk (debt relative to earnings). A bad year could hurt shareholders badly.',
    },
    BUY_STRONG: {
      title: 'Strong buy candidate',
      tone: 'good',
      summary:
        'High-quality business, healthy balance sheet, no warning signs, and the price is below its estimated fair value. It passes every check in this tool. Before buying, read the business check below and run the deep-dive research.',
    },
    BUY: {
      title: 'Buy candidate',
      tone: 'good',
      summary:
        (valuationLabel === 'Undervalued'
          ? 'High-quality business priced below its estimated fair value, with a few cautions (see confidence and warning signs).'
          : 'High-quality business at a roughly fair price. Paying a fair price for quality usually works well over many years.') +
        ' Consider buying in a few smaller steps instead of all at once.' +
        debtNote +
        signNote,
    },
    CONTRARIAN: {
      title: 'Possible bargain: find out why it is this cheap',
      tone: 'warn',
      summary: fair
        ? `By its past numbers this is a high-quality business, priced far below its estimated value (about $${fair.base.toFixed(0)}). But the price assumes ${fair.impliedCapped === 'below' ? 'a steep decline' : pctTxt(fair.impliedGrowth, 0) + ' revenue growth a year'} while it grew about ${pctTxt(gHist, 0)}. The market expects trouble the past numbers don't show yet. If the market is wrong, this is a big opportunity; if it is right, it's a value trap. Run the deep-dive research below, and if you buy, start small.`
        : 'Looks very cheap against its history. Find out why before buying.',
    },
    WATCH: {
      title: 'Watchlist: great business, price too high',
      tone: 'warn',
      summary: `The business is strong, but today's price already assumes a lot of future growth. Put it on your watchlist and consider buying nearer ${buyBelowTxt}.`,
    },
    LOOK: {
      title: 'Worth a closer look',
      tone: 'warn',
      summary:
        qualityScore >= 70
          ? declineSigns.length >= 2
            ? 'Strong past numbers, but warning signs are appearing (see below). Research what is changing before buying.'
            : 'Strong business, but the tool could not judge the price reliably. Check the valuation before buying.'
          : 'An average business at a cheap price. It could work, but cheap stocks are often cheap for a reason. Research why the market is pessimistic before buying.',
    },
    PASS: {
      title: 'Pass: nothing special',
      tone: 'neutral',
      summary: 'An average business without a price advantage. There are likely better opportunities.',
    },
  }[code];
  let title = V.title;
  if (shStatus === 'review' && ['BUY_STRONG', 'BUY', 'LOOK', 'WATCH', 'CONTRARIAN'].includes(code)) title += ' (confirm halal status first)';

  // ---- strengths and risks in plain words
  const strengths = [];
  const risks = [];
  if (isNum(roicMed) && roicMed >= 0.15) strengths.push(`Earns about ${pctTxt(roicMed)} a year on the money invested in the business (15%+ is excellent).`);
  if (isNum(gmMed) && gmMed >= 0.5 && isNum(gmRange) && gmRange <= 0.08) strengths.push(`High, stable gross margin (${pctTxt(gmMed)}), a sign of pricing power.`);
  if (netDebt <= 0) strengths.push(`More cash than debt (net cash of ${moneyTxt(-netDebt)}).`);
  if (isNum(revCagr5) && revCagr5 >= 0.1) strengths.push(`Revenue grew ${pctTxt(revCagr5, 1)} a year over ${growthYears} years.`);
  if (isNum(shareCagr) && shareCagr < -0.01) strengths.push(`Share count shrinking ${pctTxt(-shareCagr, 1)} a year from buybacks, so each share owns more of the company.`);
  if (isNum(fcfConversion) && fcfConversion >= 1) strengths.push('Profits are fully backed by real cash flow.');
  if (valuationLabel === 'Undervalued' && fair) strengths.push(`Price is below the estimated fair value of about $${fair.base.toFixed(0)}.`);
  if (isNum(ndEbitda) && ndEbitda > 3) risks.push(`Heavy debt: net debt is ${ndEbitda.toFixed(1)}x a year of operating cash earnings (EBITDA).`);
  if (isNum(intCover) && intCover < 4) risks.push(`Interest payments take a big bite: operating profit covers interest only ${intCover.toFixed(1)}x.`);
  if (isNum(shareCagr) && shareCagr > 0.03) risks.push(`Share count growing ${pctTxt(shareCagr, 1)} a year, so your slice of the company shrinks.`);
  if (isNum(sbcPctNow) && sbcPctNow > 0.1) risks.push(`Heavy stock-based pay (${pctTxt(sbcPctNow)} of revenue) is a real cost to shareholders.`);
  if (isNum(revCagr5) && revCagr5 < 0) risks.push(`Revenue has been shrinking (${pctTxt(revCagr5, 1)} a year).`);
  if (isNum(roicMed) && roicMed < 0.08) risks.push(`Low returns on capital (${pctTxt(roicMed)}), so growth may not create much value.`);
  if (losing) risks.push('Losing money and burning cash.');
  if (isNum(fcfMarginVol) && fcfMarginVol > 0.08) risks.push('Cash flow swings a lot from year to year, which makes the value harder to estimate.');
  if (valuationLabel === 'Overvalued' && fair) {
    const imp = fair.impliedCapped === 'above' ? 'more than 80%' : pctTxt(fair.impliedGrowth, 0);
    risks.push(`The price assumes about ${imp} revenue growth a year for 5 years; it has grown about ${pctTxt(gHist, 0)} a year.`);
  }
  if (valuationLabel === 'Undervalued' && pricedForDecline && fair) risks.push(`The market expects a sharp slowdown: the price assumes ${fair.impliedCapped === 'below' ? 'a steep decline' : pctTxt(fair.impliedGrowth, 0) + ' revenue growth a year'}. Find out why before trusting the cheap price.`);
  if (shStatus === 'review') risks.push(`Shariah status needs confirming: ${bizScreen.status === 'review' ? bizScreen.reason.toLowerCase() : 'ratios near the limits or incomplete'}.`);

  // ---- the questions numbers can't settle, each with what the evidence suggests
  const questions = [
    {
      q: 'Why will this company be bigger in 5 to 10 years?',
      hint: isNum(gRef)
        ? `Track record: revenue grew about ${pctTxt(gRef, 0)} a year${isNum(recentGrowth) ? `, and ${pctTxt(recentGrowth, 0)} recently` : ''}. Ask whether the reasons behind that growth are still in place.`
        : 'Not enough history to judge the growth story.',
    },
    {
      q: 'What protects it from competitors (its moat)?',
      hint: `${moatLevel} in the numbers. ${moatLevel === 'Strong evidence' ? 'Something is protecting its profits: find out what (brand, network effects, switching costs, scale).' : 'Profits look exposed to competition.'}`,
    },
    {
      q: 'What could break the business (new technology like AI, new rivals, regulation)?',
      hint: declineSigns.length ? `${declineSigns.length} warning sign${declineSigns.length > 1 ? 's' : ''} in the recent numbers (listed above).` : 'No warning signs in the recent numbers yet. Disruption often shows up in the news before it shows up in the numbers.',
    },
    {
      q: 'Is management trustworthy and sensible with your money?',
      hint: mgmt.length ? mgmt.map((m) => m.text).join(' ') : 'Not enough data on capital allocation.',
    },
    {
      q: 'Why is the price where it is?',
      hint: fair && isNum(gHist) ? `The price assumes about ${fair.impliedCapped ? (fair.impliedCapped === 'above' ? '80%+' : 'a decline') : pctTxt(fair.impliedGrowth, 0)} growth a year vs. ${pctTxt(gHist, 0)} in the past. Decide who you believe: the market or the track record.` : 'The tool could not estimate what the price assumes.',
    },
  ];

  // ---- research prompt for Claude (kept short so it fits in a link)
  const fmtUsd = (x) => (isNum(x) ? '$' + (x >= 100 ? x.toFixed(0) : x.toFixed(2)) : 'n/a');
  const claudePrompt = [
    `Act as a patient investing mentor for a beginner long-term investor (several-year holds, strictly halal stocks only).`,
    `A fundamentals screener analyzed ${name} (${ticker}) at ${fmtUsd(price)}. Verdict: ${title}.`,
    `Scores: quality ${qualityScore}/100, balance sheet ${healthScore}/100, revenue growth ${pctTxt(gRef, 0)}/yr, valuation ${valuationLabel}${fair ? ` (fair value ~${fmtUsd(fair.base)}, range ${fmtUsd(fair.bear)}-${fmtUsd(fair.bull)}; price implies ${fair.impliedCapped ? 'extreme' : pctTxt(fair.impliedGrowth, 0)} growth/yr vs ${pctTxt(gHist, 0)} historically)` : ''}. Shariah screen: ${shariahLabel(shStatus)}.`,
    `Use web search and cite sources. Explain simply:`,
    `1) How it makes money. 2) Its moat, and whether it is getting stronger or weaker. 3) The biggest threats over the next 5 years (AI or tech disruption, competitors, regulation), with recent news. 4) Management quality: track record, insider buying/selling, use of cash. 5) Who is right about future growth, the market or the track record? 6) Halal status on Zoya or Musaffa.`,
    `Finish with a clear call (buy now, buy gradually, wait for a lower price, or avoid), the 3 main reasons, and what would change your mind.`,
  ].join('\n');

  const qualitative = {
    moat: { level: moatLevel, points: moatPoints },
    warningSigns: declineSigns,
    management: mgmt,
    questions,
  };

  // ---- history for charts
  const history = rows.slice(-10).map((r) => ({
    year: r.year,
    end: r.end,
    revenue: r.rev,
    netIncome: r.ni,
    fcf: r.fcf,
    opMargin: round(r.opMargin, 4),
    grossMargin: round(r.grossMargin, 4),
    roic: round(r.roic, 4),
    shares: r.shares,
    eps: round(r.eps, 3),
  }));

  // ---- long-term entry and exit plan (valuation-based; no stop loss, exits are thesis breaks)
  let pricePlan = null;
  if (fair && isNum(fair.base) && fair.base > 0) {
    const buyBelow = fair.buyBelow;
    const strongBuyBelow = round(isNum(fair.bear) && fair.bear < buyBelow ? fair.bear : fair.base * 0.7, 2);
    const trimAbove = round(Math.max(isNum(fair.bull) ? fair.bull : 0, fair.base * 1.25), 2);
    const zone = price <= strongBuyBelow ? 'strong-buy' : price <= buyBelow ? 'buy' : price < trimAbove ? 'hold' : 'trim';
    pricePlan = { buyBelow, strongBuyBelow, fair: fair.base, trimAbove, zone };
  }
  const sellIf = [];
  sellIf.push(
    `It stops passing the Shariah screen${isNum(debtRatio) && debtRatio >= 0.2 ? ` (interest-bearing debt is already ${(debtRatio * 100).toFixed(0)}% of market value; the limit is 30%)` : ''}.`
  );
  if (!isFinancial) sellIf.push(`Its quality score falls below 50 (now ${qualityScore}): returns on capital are collapsing.`);
  sellIf.push('Revenue shrinks two years in a row without a clear, temporary reason.');
  if (!isFinancial) {
    sellIf.push(
      `Debt climbs above 3 times yearly cash earnings (EBITDA)${isNum(ndEbitda) ? `; it is ${ndEbitda <= 0 ? 'net cash' : ndEbitda.toFixed(1) + '×'} now` : ''}.`
    );
  }
  sellIf.push('The reason you bought it no longer holds. Re-check the five questions after every quarterly report.');

  return {
    ...base,
    price: round(price, 2),
    priceTime: px?.priceTime || null,
    priceSource: px?.source || null,
    high52: px?.high52 ?? null,
    low52: px?.low52 ?? null,
    marketCap,
    shares: sharesNow,
    sharesSource,
    asOf: { fiscalYearEnd: fyEnd, ttm: ttmLabel, balanceSheet: bsDate },
    verdict: { code, title, tone: V.tone, summary: V.summary, confidence, confidenceReasons: conf },
    labels: {
      quality: { label: isFinancial ? 'Not rated (financial firm)' : qualityLabel, score: qualityScore },
      health: { label: isFinancial ? 'Not rated (financial firm)' : healthLabel, score: healthScore },
      growth: { label: growthLabel, score: growthScore, rate: round(gRef, 4), recent: isNum(recentGrowth) ? round(recentGrowth, 4) : null },
      valuation: { label: valuationLabel, score: valuationScore },
      shariah: { label: shStatus === 'pass' ? 'Passes screen' : shStatus === 'fail' ? 'Fails' : 'Needs checking', status: shStatus },
    },
    fairValue: fair,
    pricePlan,
    sellIf,
    valuationBasis,
    qualitative,
    claudePrompt,
    strengths: strengths.slice(0, 5),
    risks: risks.slice(0, 6),
    sections: { quality: qm, health: hm, growth: gm, valuation: vm },
    shariah,
    keyNumbers: {
      revenue: now.rev,
      netIncome: now.ni,
      fcf: now.fcf,
      sbc: now.sbc,
      cash: cashAll,
      debt: bsNow.debt,
      equity: bsNow.equity,
    },
    history,
    historicalMultiples: histRows,
    warnings: [...new Set(warnings)],
    yearsOfData,
  };
}

const NAME_SMALL = new Set(['INC', 'INC.', 'CORP', 'CORP.', 'CO', 'CO.', 'LTD', 'LTD.', 'PLC', 'LLC', 'LP', 'L.P.', 'HOLDINGS', 'GROUP', 'THE', 'OF', 'AND', 'COMPANY', 'CORPORATION', 'INCORPORATED', 'TRUST', 'FUND']);
function niceName(raw) {
  let n = String(raw || '').replace(/\s*\/\s*[A-Z]{2,3}\s*\/?\s*$/, '').replace(/\s+/g, ' ').trim();
  if (/[a-z]/.test(n)) return n; // already mixed case
  return n
    .split(' ')
    .map((w) => {
      if (!w) return w;
      if (NAME_SMALL.has(w)) return w.charAt(0) + w.slice(1).toLowerCase();
      if (w.length <= 3 || /[&0-9]/.test(w)) return w;
      return w.charAt(0) + w.slice(1).toLowerCase();
    })
    .join(' ');
}

function shariahLabel(st) {
  return st === 'pass' ? 'passes the AAOIFI-style ratios' : st === 'fail' ? 'fails' : 'needs checking';
}

function buildLinks(ticker, cik, sub) {
  const t = String(ticker || '');
  const links = {
    musaffa: `https://musaffa.com/stock/${t}/`,
    zoya: `https://zoya.finance/stocks/${t.toLowerCase()}`,
    stockanalysis: `https://stockanalysis.com/stocks/${t.toLowerCase().replace(/-/g, '.')}/`,
    secFilings: `https://www.sec.gov/cgi-bin/browse-edgar?action=getcompany&CIK=${String(cik).padStart(10, '0')}&type=10-K&dateb=&owner=include&count=40`,
  };
  const k = sub?.latest10K;
  if (k?.accession && k?.doc) {
    links.latestAnnualReport = `https://www.sec.gov/Archives/edgar/data/${Number(cik)}/${k.accession.replace(/-/g, '')}/${k.doc}`;
    links.latestAnnualReportDate = k.filed;
  }
  return links;
}
