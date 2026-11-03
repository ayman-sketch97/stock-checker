// The nightly build's own health: what it could and could not do, so a failure shows on the site instead of quietly
// skewing the advice. Display only: nothing here changes a decision (late data already pauses advice on its own, and
// a run that analyses under 80% of the companies is not published at all).
//
// stats (from tools/build-site.mjs):
//   builtAt, priceDate, commit, universe, analysed, failed: [{t, err}], noHistory, historyOff,
//   verdicts: {code: n}, shariah: {pass, review, fail, other}, earnings: {companies, failures, days},
//   spyDate, lt: {generated, to, rulesVersion} | null, policyVersion, record: record-summary.json | null
export const HEALTH_VERSION = 1;
export const COVERAGE_OK = 0.97;
export const COVERAGE_WARN = 0.9;
export const HISTORY_WARN = 0.05; // more than 5% of companies without a price history: charts and swing signals thin out
export const LT_MAX_DAYS = 40; // the 10-year test runs monthly; older than this, a run was missed

const pct = (x) => `${Math.round(x * 1000) / 10}%`;
const daysBetween = (a, b) => Math.round((Date.parse(b) - Date.parse(a)) / 86400000);

export function healthChecks(s) {
  const checks = [];
  const add = (id, status, label, text) => checks.push({ id, status, label, text });
  const n = s.analysed || 0;

  const cov = s.universe > 0 ? n / s.universe : 0;
  const failed = s.failed || [];
  const sample = failed.slice(0, 5).map((f) => f.t).join(', ');
  add('coverage', cov >= COVERAGE_OK ? 'ok' : cov >= COVERAGE_WARN ? 'warn' : 'bad', 'Companies analysed',
    `${n.toLocaleString('en-US')} of ${(s.universe || 0).toLocaleString('en-US')} (${pct(cov)}).${failed.length ? ` ${failed.length} could not be downloaded tonight (${sample}${failed.length > 5 ? ', …' : ''}); their pages keep yesterday's analysis.` : ''}`);

  const noHist = s.noHistory || 0;
  add('history', s.historyOff ? 'bad' : n > 0 && noHist / n > HISTORY_WARN ? 'warn' : 'ok', 'Price history',
    s.historyOff ? 'The price-history source stopped answering tonight, so charts, swing signals and the chart checks are missing or a day old.'
      : `${(n - noHist).toLocaleString('en-US')} companies with a full price history${noHist ? `; ${noHist} without one (new listings, or a failed download), so no chart or swing signal for them` : ''}.`);

  const v = s.verdicts || {};
  const withheld = Object.entries(v).filter(([k]) => k === 'UNRELIABLE' || k === 'NODATA' || k.startsWith('NA:')).reduce((a, [, c]) => a + c, 0);
  add('withheld', 'info', 'Verdicts withheld',
    `${withheld.toLocaleString('en-US')} companies get no verdict: too little or unreliable data, or a kind the tool cannot judge (foreign filers, REITs, banks). Each page says why.`);

  const sh = s.shariah || {};
  const num = (x) => (x || 0).toLocaleString('en-US');
  add('halal', 'info', 'Halal screen',
    `${num(sh.pass)} pass, ${num(sh.fail)} fail, ${num(sh.review)} unresolved${sh.other ? ` and ${num(sh.other)} not screened (companies the tool cannot analyse: foreign filers, REITs, too little history)` : ''}. Only a clear pass is ever suggested as a buy. Zoya is the final word.`);

  // companies: the analysed companies with a report date on the calendar (the calendar itself lists far more)
  const e = s.earnings || {};
  const weeks = e.days > 0 ? Math.round(e.days / 5) : 0;
  add('earnings', e.failures ? 'warn' : 'ok', 'Earnings dates',
    `${num(e.companies)} of the ${num(n)} companies analysed report${weeks ? ` in the next ${weeks} weeks` : ' soon'}${e.failures ? `; ${e.failures} day${e.failures === 1 ? '' : 's'} of the calendar could not be read, so a few dates may be missing` : ''}.`);

  add('market', s.spyDate && s.spyDate === s.priceDate ? 'ok' : 'warn', 'S&P 500 data',
    s.spyDate === s.priceDate ? `Up to date (close of ${s.priceDate}).` : `Its latest close is ${s.spyDate || 'missing'}, the companies' is ${s.priceDate}: the market trend and comparisons may be a day behind.`);

  const lt = s.lt;
  const ltAge = lt && lt.generated && s.builtAt ? daysBetween(lt.generated, s.builtAt) : null;
  add('lt', !lt ? 'warn' : lt.rulesVersion !== s.policyVersion ? 'warn' : ltAge !== null && ltAge > LT_MAX_DAYS ? 'warn' : 'ok', '10-year test',
    !lt ? 'Its results could not be read tonight; the pages that use them say so.'
      : `Last run ${String(lt.generated || '').slice(0, 10)}${ltAge !== null ? ` (${ltAge} days ago)` : ''}, data to ${lt.to}, ${lt.rulesVersion === s.policyVersion ? 'with your approved rules' : 'with an older version of your rules: the next monthly run brings it up to date'}.`);

  const r = s.record;
  add('record', !r || r.skipped ? 'warn' : r.chain && r.chain.ok === false ? 'bad' : 'ok', 'Permanent record',
    !r || r.skipped ? 'Not updated tonight; the next run adds tonight\'s changes.'
      : r.chain && r.chain.ok === false ? `A file of the record does not match its fingerprint (${r.chain.at || 'unknown day'}): results are not trusted until this is fixed.`
        : `${r.days} day${r.days === 1 ? '' : 's'} recorded, every file intact.`);

  const order = { bad: 0, warn: 1, info: 2, ok: 3 };
  const worst = checks.reduce((w, c) => (order[c.status] < order[w] ? c.status : w), 'ok');
  return { version: HEALTH_VERSION, builtAt: s.builtAt, priceDate: s.priceDate, commit: s.commit || null, worst: worst === 'info' ? 'ok' : worst, checks };
}
