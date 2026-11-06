import { sha256Hex, isDateISO, anchorOf, checkAnchor, LEDGER_GENESIS } from './shariah-ledger.js';
// The investment thesis and decision record (stage 5 of the robo-advisor plan, November 2026).
//
// What it is: your own written reason for owning or considering a stock (the thesis, the catalysts you expect, the
// risks, and the conditions that would break it), every later change to that thesis, and a saved copy of each
// buy, hold, trim or sell call the page showed you, with the evidence behind it on that day. It records and explains.
// It never decides, never changes a verdict, a buy or sell signal, a valuation, a limit or the Shariah gate, and
// nothing in it sells or buys anything.
//
// How it behaves:
//   - Append-only. An entry is never edited or removed. A mistake is answered with a "correction" entry that voids the
//     wrong one (it stays in the history, struck through). Each entry carries the SHA-256 of the one before it, so a
//     changed, removed or reordered entry shows (verifyThesisLog). Entries cut off the end show only against the anchor
//     (anchorOf in the ledger block), which is kept apart and travels with the backup file.
//   - A change of mind is a "revision": a complete new version of the thesis plus the reason for the change. The
//     original and every earlier version stay exactly as written.
//   - A decision entry freezes the call as the page showed it (its own wording and reasons), the evidence of that day
//     (fundamentals, valuation, chart, risk, Shariah), the thesis as it then stood and which of your written conditions
//     were met. The explanation is built from those saved fields by explainDecision; verifyThesisLog rebuilds it and
//     fails if it differs. Decisions are only saved for today, so they cannot be back-dated.
//   - Your conditions are checked against the saved evidence only where they are numbers or the tool's own labels
//     (price, business rating, Shariah screen, chart trend). The rest are marked "for you to judge". A met condition
//     is shown to you; it changes no call.
//
// index.html carries the same text between the thesis.js markers (without the import and export lines), and
// test/thesis.test.mjs fails if the two copies differ in any way.
const THESIS_VERSION = 1;
const THESIS_KINDS = Object.freeze(['thesis', 'revision', 'decision', 'close', 'correction']);
const THESIS_STANCES = Object.freeze(['owned', 'considering']);
const THESIS_HORIZONS = Object.freeze(['long', 'mid', 'short']);
const THESIS_ACTIONS = Object.freeze(['buy', 'hold', 'trim', 'sell']);
const THESIS_SOURCES = Object.freeze(['portfolio', 'stock']);
// a written condition can name one of these checks, which the page can test against the saved evidence
const THESIS_RULE_TYPES = Object.freeze(['price_below', 'price_above', 'business_weakens', 'fails_shariah_screen', 'trend_breaks']);
const THESIS_LIMITS = Object.freeze({ reason: 600, thesis: 1200, item: 240, items: 8, change: 400, note: 400, call: 40, userAction: 300, reasons: 12, reasonText: 1500, notes: 6, noteText: 300 });
const TH_WEAK_VERDICTS = Object.freeze(['AVOID_WEAK', 'SPECULATIVE']);
const TH_BROKEN_TRENDS = Object.freeze(['down', 'weakening']);

// ---------------------------------------------------------------- small helpers
const thNum = (x) => typeof x === 'number' && Number.isFinite(x);
const thText = (s, max) => typeof s === 'string' && s.trim().length > 0 && s.length <= max;
const thOptText = (s, max) => s === undefined || (typeof s === 'string' && s.length <= max);
const thNullNum = (x) => x === null || thNum(x);
const thNullText = (x, max) => x === null || (typeof x === 'string' && x.length <= max);
const TH_TICKER = /^[A-Z0-9][A-Z0-9-]{0,14}$/;
function thCanon(x) {
  if (x === null || typeof x !== 'object') return JSON.stringify(x);
  if (Array.isArray(x)) return `[${x.map(thCanon).join(',')}]`;
  return `{${Object.keys(x).filter((k) => x[k] !== undefined).sort().map((k) => `${JSON.stringify(k)}:${thCanon(x[k])}`).join(',')}}`;
}
function thHashOf(entry) {
  const { hash, ...rest } = entry;
  return sha256Hex(thCanon(rest));
}
const thMoney = (x) => `$${x.toFixed(2)}`;
const thPct0 = (x) => `${Math.round(x * 100)}%`;
const thJoin = (a) => a.join('; ');

// ---------------------------------------------------------------- the evidence saved with a thesis or a decision
// Every key is required and may be null ("not available"); nothing is guessed. Numbers are the tool's own, as shown.
const TH_EVIDENCE_SHAPE = {
  fundamental: ['verdict', 'verdictLabel', 'quality', 'growth', 'health', 'dataQuality'],
  valuation: ['label', 'fair', 'buyBelow', 'trimAbove', 'upside'],
  technical: ['trend'],
  risk: ['weight', 'limitsAllowBuy', 'limitNotes', 'dataPaused'],
  shariah: ['screen', 'ledgerOk', 'ledgerNote'],
};
function thEvidenceProblems(ev) {
  const p = [];
  if (!ev || typeof ev !== 'object' || Array.isArray(ev)) return ['the evidence is missing'];
  const top = new Set(['asOf', 'price', ...Object.keys(TH_EVIDENCE_SHAPE)]);
  for (const k of Object.keys(ev)) if (!top.has(k)) p.push(`unexpected evidence field "${k}"`);
  if (!(ev.asOf === null || isDateISO(ev.asOf))) p.push('evidence date is not a real date');
  if (!thNullNum(ev.price)) p.push('evidence price is not a number');
  for (const [group, keys] of Object.entries(TH_EVIDENCE_SHAPE)) {
    const g = ev[group];
    if (!g || typeof g !== 'object' || Array.isArray(g)) { p.push(`evidence "${group}" is missing`); continue; }
    for (const k of Object.keys(g)) if (!keys.includes(k)) p.push(`unexpected evidence field "${group}.${k}"`);
    for (const k of keys) if (!(k in g)) p.push(`evidence "${group}.${k}" is missing (use null when not available)`);
  }
  if (p.length) return p;
  const f = ev.fundamental;
  for (const k of ['quality', 'growth', 'health']) if (!thNullNum(f[k])) p.push(`evidence fundamental.${k} must be a number or null`);
  for (const k of ['verdict', 'verdictLabel', 'dataQuality']) if (!thNullText(f[k], 80)) p.push(`evidence fundamental.${k} must be text or null`);
  const v = ev.valuation;
  for (const k of ['fair', 'buyBelow', 'trimAbove', 'upside']) if (!thNullNum(v[k])) p.push(`evidence valuation.${k} must be a number or null`);
  if (!thNullText(v.label, 80)) p.push('evidence valuation.label must be text or null');
  if (!thNullText(ev.technical.trend, 40)) p.push('evidence technical.trend must be text or null');
  const r = ev.risk;
  if (!thNullNum(r.weight)) p.push('evidence risk.weight must be a number or null');
  if (!(r.limitsAllowBuy === null || typeof r.limitsAllowBuy === 'boolean')) p.push('evidence risk.limitsAllowBuy must be true, false or null');
  if (typeof r.dataPaused !== 'boolean') p.push('evidence risk.dataPaused must be true or false');
  if (!Array.isArray(r.limitNotes) || r.limitNotes.length > THESIS_LIMITS.notes || r.limitNotes.some((s) => typeof s !== 'string' || s.length > THESIS_LIMITS.noteText)) p.push('evidence risk.limitNotes must be a short list of text');
  const s = ev.shariah;
  if (!thNullText(s.screen, 20)) p.push('evidence shariah.screen must be text or null');
  if (!(s.ledgerOk === null || typeof s.ledgerOk === 'boolean')) p.push('evidence shariah.ledgerOk must be true, false or null');
  if (!thNullText(s.ledgerNote, THESIS_LIMITS.noteText)) p.push('evidence shariah.ledgerNote must be text or null');
  return p;
}

// ---------------------------------------------------------------- the thesis itself
function thListProblems(list, name, withRule) {
  const p = [];
  if (!Array.isArray(list) || list.length < 1) return [`${name}: at least one is required (write "none identified" if that is the honest answer)`];
  if (list.length > THESIS_LIMITS.items) return [`${name}: at most ${THESIS_LIMITS.items}`];
  list.forEach((x, i) => {
    const at = `${name} ${i + 1}`;
    if (!x || typeof x !== 'object' || Array.isArray(x)) { p.push(`${at}: not valid`); return; }
    const allowed = new Set(['text', ...(name === 'catalysts' ? ['by'] : []), ...(withRule ? ['rule'] : [])]);
    for (const k of Object.keys(x)) if (!allowed.has(k)) p.push(`${at}: unexpected field "${k}"`);
    if (!thText(x.text, THESIS_LIMITS.item)) p.push(`${at}: text is required (up to ${THESIS_LIMITS.item} characters)`);
    if (x.by !== undefined && !isDateISO(x.by)) p.push(`${at}: the expected date is not a real date`);
    if (x.rule !== undefined) {
      const r = x.rule;
      if (!r || typeof r !== 'object' || !THESIS_RULE_TYPES.includes(r.type)) p.push(`${at}: unknown check`);
      else {
        const needsValue = r.type === 'price_below' || r.type === 'price_above';
        for (const k of Object.keys(r)) if (k !== 'type' && k !== 'value') p.push(`${at}: unexpected field "rule.${k}"`);
        if (needsValue && !(thNum(r.value) && r.value > 0)) p.push(`${at}: the price must be a number above zero`);
        if (!needsValue && r.value !== undefined) p.push(`${at}: this check takes no value`);
      }
    }
  });
  return p;
}
function thBodyProblems(e) {
  const p = [];
  if (!THESIS_STANCES.includes(e.stance)) p.push('stance must be owned or considering');
  if (!THESIS_HORIZONS.includes(e.horizon)) p.push('horizon must be long, mid or short');
  if (!thText(e.reason, THESIS_LIMITS.reason)) p.push(`the reason for owning or considering it is required (up to ${THESIS_LIMITS.reason} characters)`);
  if (!thText(e.thesis, THESIS_LIMITS.thesis)) p.push(`the thesis is required (up to ${THESIS_LIMITS.thesis} characters)`);
  p.push(...thListProblems(e.catalysts, 'catalysts', false));
  p.push(...thListProblems(e.risks, 'risks', false));
  p.push(...thListProblems(e.invalidation, 'invalidation', true));
  p.push(...thEvidenceProblems(e.evidence));
  return p;
}
const TH_BODY = ['stance', 'horizon', 'reason', 'thesis', 'catalysts', 'risks', 'invalidation', 'evidence'];
const TH_COPY = ['stance', 'horizon', 'written', 'reason', 'thesis', 'catalysts', 'risks', 'invalidation'];
const TH_FIELDS = {
  thesis: ['written', ...TH_BODY],
  revision: ['revised', 'revises', 'change', ...TH_BODY],
  decision: ['decided', 'action', 'call', 'source', 'reasons', 'evidence', 'thesisRef', 'thesisCopy', 'conditions', 'explanation', 'userAction'],
  close: ['on', 'thesisN', 'note'],
  correction: ['fixes', 'note'],
};
const TH_STATES = Object.freeze(['met', 'not_met', 'unknown', 'judge']);

// ---------------------------------------------------------------- checking a written condition against saved evidence
function conditionState(cond, ev) {
  const r = cond && cond.rule;
  if (!r) return 'judge';
  const e = ev || {};
  const price = thNum(e.price) ? e.price : null;
  if (r.type === 'price_below') return price === null ? 'unknown' : price <= r.value ? 'met' : 'not_met';
  if (r.type === 'price_above') return price === null ? 'unknown' : price >= r.value ? 'met' : 'not_met';
  if (r.type === 'business_weakens') {
    const v = e.fundamental && e.fundamental.verdict;
    return !v ? 'unknown' : TH_WEAK_VERDICTS.includes(v) ? 'met' : 'not_met';
  }
  if (r.type === 'fails_shariah_screen') {
    const s = e.shariah && e.shariah.screen;
    return !s ? 'unknown' : s === 'fail' ? 'met' : 'not_met';
  }
  if (r.type === 'trend_breaks') {
    const t = e.technical && e.technical.trend;
    return !t ? 'unknown' : TH_BROKEN_TRENDS.includes(t) ? 'met' : 'not_met';
  }
  return 'judge';
}
function conditionStates(thesis, ev) {
  if (!thesis || !Array.isArray(thesis.invalidation)) return [];
  return thesis.invalidation.map((c) => ({ text: c.text, state: conditionState(c, ev) }));
}
const TH_STATE_TEXT = { met: 'met on the saved data', not_met: 'not met on the saved data', unknown: 'cannot be checked: the data was not available', judge: 'for you to judge' };

// ---------------------------------------------------------------- the explanation of a decision
const TH_ACTION_WORD = { buy: 'Buy', hold: 'Hold', trim: 'Trim', sell: 'Sell' };
// Built only from what is saved in the decision. The page's own reasons are quoted word for word.
function explainDecision(d) {
  const ev = d.evidence || {};
  const f = ev.fundamental || {};
  const v = ev.valuation || {};
  const rk = ev.risk || {};
  const sh = ev.shariah || {};
  const word = TH_ACTION_WORD[d.action] || d.action;
  const headline = `${word} ${d.t} on ${d.decided}. The page showed “${d.call}”.`;
  const why = (d.reasons || []).slice();
  const data = [];
  const fp = [];
  if (f.verdictLabel) fp.push(`rated “${f.verdictLabel}”`);
  if (thNum(f.quality)) fp.push(`business quality ${Math.round(f.quality)} of 100`);
  if (thNum(f.growth)) fp.push(`growth ${Math.round(f.growth)} of 100`);
  if (thNum(f.health)) fp.push(`financial health ${Math.round(f.health)} of 100`);
  if (f.dataQuality) fp.push(`data quality ${f.dataQuality}`);
  data.push(fp.length ? `Fundamentals: ${fp.join(', ')}.` : 'Fundamentals: not available for this stock.');
  const vp = [];
  if (thNum(ev.price)) vp.push(`price ${thMoney(ev.price)}`);
  if (v.label) vp.push(`valued as “${v.label}”`);
  if (thNum(v.fair)) vp.push(`fair value ${thMoney(v.fair)}`);
  if (thNum(v.buyBelow)) vp.push(`buy at or below ${thMoney(v.buyBelow)}`);
  if (thNum(v.trimAbove)) vp.push(`trim at or above ${thMoney(v.trimAbove)}`);
  if (thNum(v.upside)) vp.push(`upside to fair value ${thPct0(v.upside)}`);
  data.push(vp.length ? `Valuation: ${vp.join(', ')}.` : 'Valuation: not available for this stock.');
  data.push(ev.technical && ev.technical.trend ? `Chart: the trend is ${ev.technical.trend}.` : 'Chart: not available for this stock.');
  const rp = [];
  if (thNum(rk.weight)) rp.push(`this stock is ${thPct0(rk.weight)} of your portfolio`);
  if (rk.limitsAllowBuy === true) rp.push('your size and sector limits allow a new buy');
  if (rk.limitsAllowBuy === false) rp.push(`your limits do not allow a new buy${rk.limitNotes && rk.limitNotes.length ? ` (${thJoin(rk.limitNotes)})` : ''}`);
  if (rk.dataPaused) rp.push('the nightly data was late, so advice was paused');
  data.push(rp.length ? `Risk: ${rp.join(', ')}.` : 'Risk: not available for this stock.');
  const sp = [];
  if (sh.screen) sp.push(`the tool’s screen shows “${sh.screen}”`);
  if (sh.ledgerNote) sp.push(`your Shariah ledger: ${sh.ledgerNote}`);
  data.push(sp.length ? `Shariah: ${sp.join('; ')}. Zoya has the final word.` : 'Shariah: not available for this stock. Zoya has the final word.');
  const th = [];
  const c = d.thesisCopy;
  if (!c) th.push(`No thesis is recorded for ${d.t}, so this call could not be checked against your own reasons.`);
  else {
    const ref = d.thesisRef || {};
    th.push(`Your thesis (written ${c.written}${ref.of > 1 ? `, version ${ref.version} of ${ref.of}` : ''}), ${c.stance === 'owned' ? 'you own it' : 'you are considering it'}: ${c.reason}`);
    th.push(`The case: ${c.thesis}`);
    th.push(`Catalysts you expected: ${thJoin(c.catalysts.map((x) => x.text + (x.by ? ` (by ${x.by})` : '')))}.`);
    th.push(`Risks you named: ${thJoin(c.risks.map((x) => x.text))}.`);
    const conds = d.conditions || [];
    for (const x of conds) th.push(`Would break it: “${x.text}”: ${TH_STATE_TEXT[x.state]}.`);
    const met = conds.filter((x) => x.state === 'met');
    if (met.length) th.push('A condition you wrote down as breaking the thesis is met. Review the thesis. This does not change the call above.');
    else if (d.action === 'sell' || d.action === 'trim') th.push('None of your written conditions is met on the saved data, so this call comes from the tool’s rules, not from your thesis.');
  }
  return { headline, why, data, thesis: th };
}

// ---------------------------------------------------------------- shape rules for one entry
function thShapeProblems(e) {
  const p = [];
  if (!e || typeof e !== 'object') return ['not an entry'];
  if (!THESIS_KINDS.includes(e.kind)) return [`unknown kind "${e.kind}"`];
  if (typeof e.t !== 'string' || !TH_TICKER.test(e.t)) p.push('ticker is missing or not valid');
  const allowed = new Set(['v', 'n', 'kind', 't', 'recorded', 'prev', 'hash', 'origin', ...TH_FIELDS[e.kind]]);
  for (const k of Object.keys(e)) if (!allowed.has(k)) p.push(`unexpected field "${k}"`);
  if (e.kind === 'thesis') {
    if (!isDateISO(e.written)) p.push('the date written is missing or not a real date');
    p.push(...thBodyProblems(e));
  } else if (e.kind === 'revision') {
    if (!isDateISO(e.revised)) p.push('the revision date is missing or not a real date');
    if (!Number.isInteger(e.revises) || e.revises < 0) p.push('the version being revised is missing');
    if (!thText(e.change, THESIS_LIMITS.change)) p.push('a revision needs the reason for the change');
    p.push(...thBodyProblems(e));
  } else if (e.kind === 'decision') {
    if (!isDateISO(e.decided)) p.push('the decision date is missing or not a real date');
    if (!THESIS_ACTIONS.includes(e.action)) p.push('action must be buy, hold, trim or sell');
    if (!thText(e.call, THESIS_LIMITS.call)) p.push('the page’s own wording of the call is required');
    if (!THESIS_SOURCES.includes(e.source)) p.push('source must be portfolio or stock');
    if (!Array.isArray(e.reasons) || e.reasons.length < 1 || e.reasons.length > THESIS_LIMITS.reasons || e.reasons.some((s) => !thText(s, THESIS_LIMITS.reasonText))) p.push('the reasons the page gave are required');
    p.push(...thEvidenceProblems(e.evidence));
    if (!thOptText(e.userAction, THESIS_LIMITS.userAction)) p.push('what you did is too long');
    const hasRef = e.thesisRef !== null && e.thesisRef !== undefined;
    const hasCopy = e.thesisCopy !== null && e.thesisCopy !== undefined;
    if (hasRef !== hasCopy) p.push('the thesis link and the saved thesis must go together');
    if (hasRef) {
      const r = e.thesisRef;
      if (!r || !Number.isInteger(r.n) || r.n < 0 || typeof r.hash !== 'string' || !Number.isInteger(r.version) || !Number.isInteger(r.of) || r.version < 1 || r.of < r.version) p.push('the thesis link is not valid');
      const c = e.thesisCopy;
      if (!c || typeof c !== 'object') p.push('the saved thesis is not valid');
      else {
        for (const k of Object.keys(c)) if (!TH_COPY.includes(k)) p.push(`unexpected field "thesisCopy.${k}"`);
        if (!THESIS_STANCES.includes(c.stance) || !THESIS_HORIZONS.includes(c.horizon) || !isDateISO(c.written) || !thText(c.reason, THESIS_LIMITS.reason) || !thText(c.thesis, THESIS_LIMITS.thesis)) p.push('the saved thesis is not valid');
        else p.push(...thListProblems(c.catalysts, 'catalysts', false), ...thListProblems(c.risks, 'risks', false), ...thListProblems(c.invalidation, 'invalidation', true));
      }
    }
    if (!Array.isArray(e.conditions)) p.push('the condition results are missing');
    else if (e.conditions.some((x) => !x || typeof x.text !== 'string' || !TH_STATES.includes(x.state))) p.push('a condition result is not valid');
    if (!e.explanation || typeof e.explanation !== 'object') p.push('the explanation is missing');
  } else if (e.kind === 'close') {
    if (!isDateISO(e.on)) p.push('the date is missing or not a real date');
    if (!Number.isInteger(e.thesisN) || e.thesisN < 0) p.push('the thesis being closed is missing');
    if (!thText(e.note, THESIS_LIMITS.note)) p.push('say why you no longer own or consider it');
  } else if (e.kind === 'correction') {
    if (!Number.isInteger(e.fixes) || e.fixes < 0) p.push('the entry being corrected is missing');
    if (!thText(e.note, THESIS_LIMITS.note)) p.push('a correction needs a reason');
  }
  return p;
}
// the explanation and the condition results are derived from the saved fields, so they can be rebuilt and compared
function thDerived(e) {
  const conditions = e.thesisCopy ? conditionStates(e.thesisCopy, e.evidence) : [];
  return { conditions, explanation: explainDecision({ ...e, conditions }) };
}

// ---------------------------------------------------------------- reading
const thVoided = (entries) => new Set(entries.filter((e) => e.kind === 'correction').map((e) => e.fixes));
// everything recorded for one ticker, voided entries left out (they stay in `all` for display)
function thesisState(entries, t) {
  const voided = thVoided(entries);
  const all = entries.filter((e) => e.t === t);
  const live = all.filter((e) => !voided.has(e.n) && e.kind !== 'correction');
  const starts = live.filter((e) => e.kind === 'thesis');
  const original = starts.length ? starts[starts.length - 1] : null;
  const closes = original ? live.filter((e) => e.kind === 'close' && e.n > original.n) : [];
  const versions = original ? [original, ...live.filter((e) => e.kind === 'revision' && e.n > original.n)] : [];
  const current = versions.length ? versions[versions.length - 1] : null;
  const status = !original ? 'none' : closes.length ? 'closed' : 'open';
  return {
    status,
    original,
    versions,
    current,
    closed: closes.length ? closes[closes.length - 1] : null,
    decisions: live.filter((e) => e.kind === 'decision'),
    earlier: starts.slice(0, -1),
    voided: all.filter((e) => voided.has(e.n)),
    all,
  };
}
const TH_FIELD_NAMES = { stance: 'owned or considering', horizon: 'time horizon', reason: 'reason for owning or considering it', thesis: 'the case', catalysts: 'catalysts', risks: 'risks', invalidation: 'conditions that would break it' };
const thListText = (x) => (Array.isArray(x) ? x.map((i) => i.text + (i.by ? ` (by ${i.by})` : '') + (i.rule ? ` [${i.rule.type}${i.rule.value !== undefined ? ` ${i.rule.value}` : ''}]` : '')).join('; ') : String(x));
// what changed from one version to the next, in plain words (the earlier version is never altered)
function thesisChanges(a, b) {
  const out = [];
  for (const k of ['stance', 'horizon', 'reason', 'thesis', 'catalysts', 'risks', 'invalidation']) {
    if (thCanon(a[k]) !== thCanon(b[k])) out.push({ field: k, name: TH_FIELD_NAMES[k], before: thListText(a[k]), after: thListText(b[k]) });
  }
  return out;
}
// one line per holding: has it a thesis, and does a written condition show as met on the latest evidence given
function thesisOverview(entries, heldTickers, latestEvidence) {
  const tickers = new Set([...(heldTickers || []), ...entries.filter((e) => e.kind === 'thesis').map((e) => e.t)]);
  const rows = [];
  for (const t of [...tickers].sort()) {
    const s = thesisState(entries, t);
    const held = (heldTickers || []).includes(t);
    const ev = latestEvidence && latestEvidence[t];
    const met = s.status === 'open' && ev ? conditionStates(s.current, ev).filter((x) => x.state === 'met').map((x) => x.text) : [];
    const level = held && s.status !== 'open' ? 'warn' : met.length ? 'bad' : 'ok';
    const text = s.status === 'none' ? (held ? 'No thesis recorded for this holding.' : 'No thesis.')
      : s.status === 'closed' ? (held ? 'The last thesis was closed, but you hold it again: write a new one.' : 'Closed.')
        : met.length ? `A condition you wrote is met today: ${thJoin(met)}.` : `Thesis recorded${s.versions.length > 1 ? ` (${s.versions.length} versions)` : ''}.`;
    rows.push({ t, held, status: s.status, versions: s.versions.length, decisions: s.decisions.length, met, level, text });
  }
  return rows;
}

// ---------------------------------------------------------------- the chain
function thBuild(prevEntries, fields, recordedISO) {
  const n = prevEntries.length;
  const prev = n ? prevEntries[n - 1].hash : LEDGER_GENESIS;
  const body = { v: THESIS_VERSION, n, ...fields, recorded: recordedISO, prev };
  for (const k of Object.keys(body)) if (body[k] === undefined || body[k] === '') delete body[k];
  return { ...body, hash: thHashOf(body) };
}
function thTidyList(list) {
  if (!Array.isArray(list)) return list;
  return list.map((x) => {
    if (!x || typeof x !== 'object') return x;
    const o = { ...x };
    if (typeof o.text === 'string') o.text = o.text.trim();
    if (o.by === '' || o.by === null) delete o.by;
    if (o.rule === null) delete o.rule;
    return o;
  });
}
const thTrim = (f) => {
  const o = { ...f };
  for (const k of ['reason', 'thesis', 'change', 'note', 'call', 'userAction']) if (typeof o[k] === 'string') o[k] = o[k].trim();
  if (typeof o.t === 'string') o.t = o.t.trim().toUpperCase();
  if (o.userAction === '') delete o.userAction;
  for (const k of ['catalysts', 'risks', 'invalidation']) if (k in o) o[k] = thTidyList(o[k]);
  if (Array.isArray(o.reasons)) o.reasons = o.reasons.map((s) => (typeof s === 'string' ? s.trim() : s));
  return o;
};
const thPick = (e, keys) => { const o = {}; for (const k of keys) if (e[k] !== undefined) o[k] = e[k]; return o; };
// add one entry. Returns { ok, entries, entry, errors }; the array passed in is never changed.
// today and nowISO are passed in so that tests can fix them.
function appendThesis(entries, fields, today, nowISO) {
  const f = thTrim(fields || {});
  const errors = [];
  const fail = (...more) => ({ ok: false, entries, entry: null, errors: [...errors, ...more] });
  // derived fields are never taken from the caller
  if (f.kind === 'decision') for (const k of ['thesisRef', 'thesisCopy', 'conditions', 'explanation']) delete f[k];
  if (f.kind === 'close') delete f.thesisN;
  const chain = verifyThesisLog(entries);
  if (!chain.ok) return fail('the record does not pass its integrity check, so nothing can be added until that is looked at');
  if (!isDateISO(today)) return fail('today is not a real date');
  if (!THESIS_KINDS.includes(f.kind)) return fail(`unknown kind "${f.kind}"`);
  const st = typeof f.t === 'string' && TH_TICKER.test(f.t) ? thesisState(entries, f.t) : null;
  const open = !!st && st.status === 'open';
  let full = f;
  if (f.kind === 'decision' && open) {
    // the decision keeps the thesis as it stands now
    const cur = st.current;
    full = { ...f, thesisRef: { n: cur.n, hash: cur.hash, version: st.versions.length, of: st.versions.length }, thesisCopy: { ...thPick(cur, TH_COPY), written: st.original.written } };
  }
  if (f.kind === 'close') {
    if (!open) return fail(st ? `${f.t} has no open thesis to close` : 'ticker is missing or not valid');
    full = { ...f, thesisN: st.current.n };
  }
  if (f.kind === 'decision') {
    errors.push(...thShapeProblems({ ...full, conditions: [], explanation: {} }));
    if (!errors.length) full = { ...full, ...thDerived(full) };
  } else errors.push(...thShapeProblems(full));
  if (errors.length) return fail();
  const dated = f.kind === 'thesis' ? [['written', f.written]] : f.kind === 'revision' ? [['revised', f.revised]] : f.kind === 'close' ? [['on', f.on]] : [];
  for (const [name, d] of dated) if (d > today) errors.push(`${name} is in the future`);
  if (f.kind === 'decision' && f.decided !== today) errors.push('a decision can only be saved for today, so that it cannot be back-dated');
  if (f.kind === 'thesis' && open) errors.push(`${f.t} already has an open thesis; write a revision instead, or close it first`);
  if (f.kind === 'revision') {
    if (!open) errors.push(`${f.t} has no open thesis to revise`);
    else {
      if (f.revises !== st.current.n) errors.push('the version being revised is not the latest one; reload and revise the latest');
      if (!thesisChanges(st.current, f).length) errors.push('nothing in the thesis changed, so there is nothing to record');
      if (f.revised < (st.current.kind === 'thesis' ? st.current.written : st.current.revised)) errors.push('the revision date is before the version it revises');
    }
  }
  if (f.kind === 'close' && f.on < st.original.written) errors.push('the closing date is before the thesis was written');
  if (f.kind === 'correction') {
    const target = entries[f.fixes];
    if (!target) errors.push('there is no such entry to correct');
    else if (target.kind === 'correction') errors.push('a correction cannot be corrected; record the right entry instead');
    else if (target.t !== f.t) errors.push('the entry belongs to another ticker');
    else if (entries.some((x) => x.kind === 'correction' && x.fixes === f.fixes)) errors.push('that entry is already corrected');
    else if (target.kind === 'thesis' || target.kind === 'revision') {
      const voided = thVoided(entries);
      const later = entries.filter((x) => x.t === f.t && x.n > target.n && !voided.has(x.n));
      if (later.some((x) => (x.kind === 'revision' && x.revises === target.n) || (x.kind === 'decision' && x.thesisRef && x.thesisRef.n === target.n) || (x.kind === 'close' && x.thesisN === target.n))) errors.push('a later revision, decision or closing refers to this entry; correct those first, or record a revision');
    }
  }
  if (errors.length) return fail();
  const entry = thBuild(entries, full, nowISO);
  return { ok: true, entries: [...entries, entry], entry, errors: [] };
}
// check the whole chain: numbering, links, hashes, shapes, references, and that every explanation can be rebuilt
function verifyThesisLog(entries, today) {
  const problems = [];
  if (!Array.isArray(entries)) return { ok: false, count: 0, head: null, problems: ['the record is not a list'] };
  let prev = LEDGER_GENESIS;
  entries.forEach((e, i) => {
    const at = `entry ${i}`;
    if (!e || typeof e !== 'object') { problems.push(`${at}: not an entry`); return; }
    if (e.n !== i) problems.push(`${at}: numbered ${e.n}, so an entry was removed, added or moved`);
    if (e.prev !== prev) problems.push(`${at}: does not link to the entry before it`);
    if (thHashOf(e) !== e.hash) problems.push(`${at}: its content does not match its hash (it was changed)`);
    const shape = thShapeProblems(e);
    for (const s of shape) problems.push(`${at}: ${s}`);
    const at0 = (k) => entries[k];
    if (!shape.length) {
      if (e.kind === 'revision') {
        const tg = at0(e.revises);
        if (!(e.revises < i) || !tg || tg.t !== e.t || (tg.kind !== 'thesis' && tg.kind !== 'revision')) problems.push(`${at}: revises an entry that is not an earlier version of the same thesis`);
      }
      if (e.kind === 'close') {
        const tg = at0(e.thesisN);
        if (!(e.thesisN < i) || !tg || tg.t !== e.t || (tg.kind !== 'thesis' && tg.kind !== 'revision')) problems.push(`${at}: closes an entry that is not a version of the same thesis`);
      }
      if (e.kind === 'correction') {
        const tg = at0(e.fixes);
        if (!(e.fixes < i) || !tg || tg.kind === 'correction' || tg.t !== e.t) problems.push(`${at}: corrects an entry that is not an earlier entry of the same ticker`);
      }
      if (e.kind === 'decision') {
        if (e.thesisRef) {
          const tg = at0(e.thesisRef.n);
          if (!(e.thesisRef.n < i) || !tg || tg.t !== e.t || tg.hash !== e.thesisRef.hash || (tg.kind !== 'thesis' && tg.kind !== 'revision')) problems.push(`${at}: its thesis link does not match the entry it names`);
        }
        const d = thDerived(e);
        if (thCanon(d.conditions) !== thCanon(e.conditions)) problems.push(`${at}: the condition results do not match the saved evidence`);
        if (thCanon(d.explanation) !== thCanon(e.explanation)) problems.push(`${at}: the explanation does not match what was saved`);
      }
    }
    if (today && isDateISO(today)) {
      const ds = e.kind === 'thesis' ? [e.written] : e.kind === 'revision' ? [e.revised] : e.kind === 'decision' ? [e.decided] : e.kind === 'close' ? [e.on] : [];
      if (ds.some((d) => isDateISO(d) && d > today)) problems.push(`${at}: dated in the future`);
    }
    prev = e.hash;
  });
  return { ok: problems.length === 0, count: entries.length, head: entries.length ? entries[entries.length - 1].hash : null, problems };
}

// ---------------------------------------------------------------- joining two copies (a backup into this device)
// Nothing on this device is changed or removed: entries only this backup has are added after the ones here, with the
// numbers they refer to translated and the original number and hash kept in `origin`.
function mergeThesisLogs(local, incoming) {
  const a = verifyThesisLog(local);
  const b = verifyThesisLog(incoming);
  if (!a.ok) return { ok: false, entries: local, added: 0, note: 'The thesis record on this device does not pass its own check, so nothing was merged.' };
  if (!b.ok) return { ok: false, entries: local, added: 0, note: 'The thesis record in the backup does not pass its own check, so nothing was merged.' };
  let common = 0;
  while (common < local.length && common < incoming.length && local[common].hash === incoming[common].hash) common++;
  if (common === incoming.length) return { ok: true, entries: local, added: 0, note: common === local.length ? 'The backup thesis record is the same as this one.' : 'This device already has more than the backup.' };
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
    if (e.kind === 'revision') {
      if (!map.has(e.revises)) continue;
      fields.revises = map.get(e.revises);
    }
    if (e.kind === 'close') {
      if (!map.has(e.thesisN)) continue;
      fields.thesisN = map.get(e.thesisN);
    }
    if (e.kind === 'decision' && e.thesisRef) {
      if (!map.has(e.thesisRef.n)) continue;
      fields.thesisRef = { ...e.thesisRef, n: map.get(e.thesisRef.n), hash: out[map.get(e.thesisRef.n)].hash };
    }
    const next = thBuild(out, { ...fields, origin: { n: e.n, hash: e.hash } }, recorded);
    out = [...out, next];
    map.set(i, next.n);
    known.add(e.hash);
    added++;
  }
  const check = verifyThesisLog(out);
  if (!check.ok) return { ok: false, entries: local, added: 0, note: 'Joining the two records would break the integrity check, so nothing was merged.' };
  return { ok: true, entries: out, added, note: added ? `${added} entr${added === 1 ? 'y' : 'ies'} from the backup were added after the ones on this device.` : 'Nothing new in the backup.' };
}

export {
  THESIS_VERSION, THESIS_KINDS, THESIS_STANCES, THESIS_HORIZONS, THESIS_ACTIONS, THESIS_SOURCES, THESIS_RULE_TYPES, THESIS_LIMITS,
  appendThesis, verifyThesisLog, thesisState, thesisChanges, thesisOverview, conditionState, conditionStates, explainDecision, mergeThesisLogs, thEvidenceProblems,
};
