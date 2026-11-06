// The Shariah compliance ledger (stage 4 of the robo-advisor plan, November 2026).
//
// What it is: a record of what Zoya shows for each stock you hold, kept by you, with the date, the source and the
// evidence. It never decides whether a company is Shariah compliant and never turns a number from this tool into a
// compliance claim: Zoya is the final authority, and every status here is one that you copied from Zoya (or marked as
// not from Zoya, which then counts for nothing).
//
// How it behaves:
//   - Append-only. An entry is never edited or removed. A mistake is answered with a "correction" entry that voids the
//     wrong one (the wrong one stays in the history, struck through). Each entry carries the SHA-256 of the one before
//     it, so a changed, removed or reordered entry shows (verifyLedger). Removing the last entries shows only against
//     the anchor (anchorOf), which is kept separately and travels with the backup file.
//   - Recheck every 90 days after the last Zoya check. Past 90 days the record is stale.
//   - The 90-day exit countdown starts only when a stock that the ledger holds as compliant (a Zoya check) is later
//     confirmed on Zoya as non-compliant AND the status-change date that Zoya shows is recorded. The deadline is 90 days
//     from that date. Missing, stale, uncertain (questionable) or non-Zoya data never starts it, and nothing here ever
//     sells anything. A first-ever non-compliant record, or one without a change date, has no deadline: it is flagged
//     in plain words, never guessed.
//   - shariahGate() answers one question for the buy checks: does this stock have a current Zoya check, recorded in
//     this ledger, that says compliant? Anything else blocks a new buy and says why. It reads the record; it never
//     decides compliance.
//   - Purification is NOT calculated, estimated or shown. The ledger can keep an amount that you enter, with the basis
//     that gave it, but there is no formula anywhere in this file, and PURIFICATION.active is false until a qualified
//     Shariah scholar supplies a method and the owner approves building it.
//
// index.html carries the same text between the shariah-ledger.js markers (without the word "export"), and
// test/formulas.test.mjs fails if the two copies differ in any way. Nothing here touches valuation, buy or sell
// signals, risk limits or the performance method.
const LEDGER_VERSION = 1;
const LEDGER_RULES = Object.freeze({ recheckDays: 90, exitDays: 90, dueSoonDays: 14 });
const LEDGER_STATUSES = Object.freeze(['compliant', 'non_compliant', 'questionable']);
// the sources: only a Zoya source can confirm a status. Anything else is recorded but counts as unconfirmed.
const LEDGER_SOURCES = Object.freeze({ zoya_app: 'Zoya app', zoya_web: 'Zoya website', zoya_report: 'Zoya report', other: 'Not Zoya' });
const LEDGER_EXIT = Object.freeze(['not_started', 'in_progress', 'completed']);
const LEDGER_KINDS = Object.freeze(['check', 'exit', 'purification', 'correction']);
const LEDGER_GENESIS = '0'.repeat(64);
const PURIFICATION = Object.freeze({
  active: false,
  status: 'pending_scholar_method',
  message: 'Purification is inactive, pending a method confirmed by a qualified Shariah scholar. This tool does not calculate, estimate or show purification amounts, and it stays that way until you supply that method and approve building it. You can still keep a record of an amount a scholar or another named source gave you, with who gave it. Records already kept are preserved.',
});

// ---------------------------------------------------------------- dates (YYYY-MM-DD, calendar days, UTC)
const LG_DAY = 86400000;
const lgDayNum = (d) => Math.round(Date.parse(`${d}T00:00:00Z`) / LG_DAY);
function addDaysISO(d, n) { return new Date((lgDayNum(d) + n) * LG_DAY).toISOString().slice(0, 10); }
function isDateISO(s) {
  if (typeof s !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const ms = Date.parse(`${s}T00:00:00Z`);
  return Number.isFinite(ms) && new Date(ms).toISOString().slice(0, 10) === s;
}
function daysBetweenISO(a, b) { return lgDayNum(b) - lgDayNum(a); }

// ---------------------------------------------------------------- SHA-256 (synchronous, so the page and the tests run the same code)
const LG_K = [];
const LG_H0 = [];
(function lgInitSha() {
  let n = 2;
  while (LG_K.length < 64) {
    let prime = true;
    for (let d = 2; d * d <= n; d++) if (n % d === 0) { prime = false; break; }
    if (prime) {
      if (LG_H0.length < 8) LG_H0.push(Math.floor((Math.sqrt(n) % 1) * 4294967296) >>> 0);
      LG_K.push(Math.floor((Math.cbrt(n) % 1) * 4294967296) >>> 0);
    }
    n++;
  }
})();
function sha256Hex(text) {
  const bytes = new TextEncoder().encode(String(text));
  const len = bytes.length;
  const total = ((len + 9 + 63) >> 6) << 6;
  const buf = new Uint8Array(total);
  buf.set(bytes);
  buf[len] = 0x80;
  const dv = new DataView(buf.buffer);
  dv.setUint32(total - 8, Math.floor((len * 8) / 4294967296));
  dv.setUint32(total - 4, (len * 8) >>> 0);
  const H = LG_H0.slice();
  const w = new Uint32Array(64);
  const rotr = (x, k) => (x >>> k) | (x << (32 - k));
  for (let off = 0; off < total; off += 64) {
    for (let i = 0; i < 16; i++) w[i] = dv.getUint32(off + i * 4);
    for (let i = 16; i < 64; i++) {
      const s0 = rotr(w[i - 15], 7) ^ rotr(w[i - 15], 18) ^ (w[i - 15] >>> 3);
      const s1 = rotr(w[i - 2], 17) ^ rotr(w[i - 2], 19) ^ (w[i - 2] >>> 10);
      w[i] = (w[i - 16] + s0 + w[i - 7] + s1) >>> 0;
    }
    let [a, b, c, d, e, f, g, hh] = H;
    for (let i = 0; i < 64; i++) {
      const S1 = rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25);
      const ch = (e & f) ^ (~e & g);
      const t1 = (hh + S1 + ch + LG_K[i] + w[i]) >>> 0;
      const S0 = rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22);
      const mj = (a & b) ^ (a & c) ^ (b & c);
      const t2 = (S0 + mj) >>> 0;
      hh = g; g = f; f = e; e = (d + t1) >>> 0; d = c; c = b; b = a; a = (t1 + t2) >>> 0;
    }
    H[0] = (H[0] + a) >>> 0; H[1] = (H[1] + b) >>> 0; H[2] = (H[2] + c) >>> 0; H[3] = (H[3] + d) >>> 0;
    H[4] = (H[4] + e) >>> 0; H[5] = (H[5] + f) >>> 0; H[6] = (H[6] + g) >>> 0; H[7] = (H[7] + hh) >>> 0;
  }
  return H.map((x) => x.toString(16).padStart(8, '0')).join('');
}
// the same text for the same entry every time: keys sorted, no whitespace
function lgCanon(x) {
  if (x === null || typeof x !== 'object') return JSON.stringify(x);
  if (Array.isArray(x)) return `[${x.map(lgCanon).join(',')}]`;
  return `{${Object.keys(x).filter((k) => x[k] !== undefined).sort().map((k) => `${JSON.stringify(k)}:${lgCanon(x[k])}`).join(',')}}`;
}
function lgHashOf(entry) {
  const { hash, ...rest } = entry;
  return sha256Hex(lgCanon(rest));
}

// ---------------------------------------------------------------- one entry: shape rules
const LG_TICKER = /^[A-Z0-9][A-Z0-9-]{0,14}$/;
const lgNum = (x) => typeof x === 'number' && Number.isFinite(x);
const lgText = (s, max) => typeof s === 'string' && s.trim().length > 0 && s.length <= max;
const lgOptText = (s, max) => s === undefined || (typeof s === 'string' && s.length <= max);
const LG_FIELDS = {
  check: ['status', 'checked', 'source', 'evidence', 'changeDate'],
  exit: ['exitStatus', 'on', 'note'],
  purification: ['action', 'amount', 'currency', 'asOf', 'basis', 'note'],
  correction: ['fixes', 'note'],
};
// problems with the fields of an entry, whatever the situation (an empty list is a well-formed entry)
function lgShapeProblems(e) {
  const p = [];
  if (!e || typeof e !== 'object') return ['not an entry'];
  if (!LEDGER_KINDS.includes(e.kind)) return [`unknown kind "${e.kind}"`];
  if (typeof e.t !== 'string' || !LG_TICKER.test(e.t)) p.push('ticker is missing or not valid');
  const allowed = new Set(['v', 'n', 'kind', 't', 'recorded', 'prev', 'hash', 'origin', ...LG_FIELDS[e.kind]]);
  for (const k of Object.keys(e)) if (!allowed.has(k)) p.push(`unexpected field "${k}"`);
  if (e.kind === 'check') {
    if (!LEDGER_STATUSES.includes(e.status)) p.push('status must be compliant, non_compliant or questionable');
    if (!isDateISO(e.checked)) p.push('the verification date is missing or not a real date');
    if (!Object.prototype.hasOwnProperty.call(LEDGER_SOURCES, e.source)) p.push('the source is missing or unknown');
    if (!lgText(e.evidence, 600)) p.push('evidence is required (what you saw: the screen, the report and its date, a reference)');
    if (e.changeDate !== undefined) {
      if (!isDateISO(e.changeDate)) p.push('the status-change date is not a real date');
      else if (e.status !== 'non_compliant') p.push('a status-change date only goes with a non_compliant status');
      else if (isDateISO(e.checked) && e.changeDate > e.checked) p.push('the status-change date cannot be after the verification date');
    }
  } else if (e.kind === 'exit') {
    if (!LEDGER_EXIT.includes(e.exitStatus)) p.push('exit status must be not_started, in_progress or completed');
    if (!isDateISO(e.on)) p.push('the exit date is missing or not a real date');
    if (!lgOptText(e.note, 400)) p.push('note is too long');
  } else if (e.kind === 'purification') {
    if (e.action !== 'due' && e.action !== 'paid') p.push('purification action must be due or paid');
    if (!lgNum(e.amount) || !(e.amount > 0)) p.push('the amount must be a number above zero');
    if (typeof e.currency !== 'string' || !/^[A-Z]{3}$/.test(e.currency)) p.push('the currency must be a 3-letter code');
    if (!isDateISO(e.asOf)) p.push('the date is missing or not a real date');
    if (!lgText(e.basis, 300)) p.push('the basis is required: who supplied the method or the amount');
    if (!lgOptText(e.note, 400)) p.push('note is too long');
  } else if (e.kind === 'correction') {
    if (!Number.isInteger(e.fixes) || e.fixes < 0) p.push('the entry being corrected is missing');
    if (!lgText(e.note, 400)) p.push('a correction needs a reason');
  }
  return p;
}

// ---------------------------------------------------------------- the chain
function lgBuild(prevEntries, fields, recordedISO) {
  const n = prevEntries.length;
  const prev = n ? prevEntries[n - 1].hash : LEDGER_GENESIS;
  const body = { v: LEDGER_VERSION, n, ...fields, recorded: recordedISO, prev };
  for (const k of Object.keys(body)) if (body[k] === undefined || body[k] === '') delete body[k];
  return { ...body, hash: lgHashOf(body) };
}
const lgIsZoya = (src) => src === 'zoya_app' || src === 'zoya_web' || src === 'zoya_report';
const lgTrim = (f) => {
  const o = { ...f };
  for (const k of ['evidence', 'note', 'basis']) if (typeof o[k] === 'string') o[k] = o[k].trim();
  if (typeof o.t === 'string') o.t = o.t.trim().toUpperCase();
  if (typeof o.currency === 'string') o.currency = o.currency.trim().toUpperCase();
  if (o.changeDate === '' || o.changeDate === null) delete o.changeDate;
  if (o.note === '') delete o.note;
  return o;
};
// add one entry. Returns { ok, entries, entry, errors }; the array passed in is never changed.
// today and nowISO are passed in so that tests can fix them.
function appendEntry(entries, fields, today, nowISO) {
  const f = lgTrim(fields || {});
  const errors = lgShapeProblems({ ...f });
  const fail = (...more) => ({ ok: false, entries, entry: null, errors: [...errors, ...more] });
  if (errors.length) return fail();
  if (!isDateISO(today)) return fail('today is not a real date');
  const chain = verifyLedger(entries);
  if (!chain.ok) return fail('the ledger does not pass its integrity check, so nothing can be added until that is looked at');
  const dateFields = f.kind === 'check' ? [['checked', f.checked], ['changeDate', f.changeDate]] : f.kind === 'exit' ? [['on', f.on]] : f.kind === 'purification' ? [['asOf', f.asOf]] : [];
  for (const [name, d] of dateFields) if (d !== undefined && d > today) errors.push(`${name} is in the future`);
  if (f.kind === 'exit') {
    const run = lgRuns(entries, f.t).find((r) => !r.closed);
    if (!run) errors.push(`${f.t} has no open non-compliant record, so there is nothing to exit`);
    else {
      if (run.exit && run.exit.exitStatus === 'completed') errors.push('the exit is already completed; use a correction if it was recorded by mistake');
      if (run.changeDate && f.on < run.changeDate) errors.push('the exit date is before the status-change date');
    }
  }
  if (f.kind === 'correction') {
    const target = entries[f.fixes];
    if (!target) errors.push('there is no such entry to correct');
    else if (target.kind === 'correction') errors.push('a correction cannot be corrected; record the right entry instead');
    else if (target.t !== f.t) errors.push('the entry belongs to another ticker');
    else if (entries.some((x) => x.kind === 'correction' && x.fixes === f.fixes)) errors.push('that entry is already corrected');
  }
  if (errors.length) return fail();
  const entry = lgBuild(entries, f, nowISO);
  return { ok: true, entries: [...entries, entry], entry, errors: [] };
}
// check the whole chain: numbering, links, hashes, shapes, and that corrections point at real earlier entries
function verifyLedger(entries, today) {
  const problems = [];
  if (!Array.isArray(entries)) return { ok: false, count: 0, head: null, problems: ['the ledger is not a list'] };
  let prev = LEDGER_GENESIS;
  entries.forEach((e, i) => {
    const at = `entry ${i}`;
    if (!e || typeof e !== 'object') { problems.push(`${at}: not an entry`); return; }
    if (e.n !== i) problems.push(`${at}: numbered ${e.n}, so an entry was removed, added or moved`);
    if (e.prev !== prev) problems.push(`${at}: does not link to the entry before it`);
    if (lgHashOf(e) !== e.hash) problems.push(`${at}: its content does not match its hash (it was changed)`);
    for (const s of lgShapeProblems(e)) problems.push(`${at}: ${s}`);
    if (e.kind === 'correction') {
      const tg = entries[e.fixes];
      if (!(e.fixes < i) || !tg || tg.kind === 'correction' || tg.t !== e.t) problems.push(`${at}: corrects an entry that is not an earlier entry of the same ticker`);
    }
    if (today && isDateISO(today)) {
      const ds = e.kind === 'check' ? [e.checked, e.changeDate] : e.kind === 'exit' ? [e.on] : e.kind === 'purification' ? [e.asOf] : [];
      if (ds.some((d) => isDateISO(d) && d > today)) problems.push(`${at}: dated in the future`);
    }
    prev = e.hash;
  });
  return { ok: problems.length === 0, count: entries.length, head: entries.length ? entries[entries.length - 1].hash : null, problems };
}
// the anchor: how many entries there are and the last hash. Kept apart from the entries, so that cutting entries off the
// end (which leaves a valid chain) shows when the two are compared (checkAnchor).
function anchorOf(entries) {
  return { v: LEDGER_VERSION, count: entries.length, head: entries.length ? entries[entries.length - 1].hash : LEDGER_GENESIS };
}
function checkAnchor(entries, anchor) {
  if (!anchor) return { ok: true, note: 'no anchor saved yet' };
  if (!Number.isInteger(anchor.count) || anchor.count < 0) return { ok: false, note: 'the saved anchor is not valid' };
  if (anchor.count > entries.length) return { ok: false, note: `the anchor says ${anchor.count} entries, only ${entries.length} found: entries were removed` };
  const at = anchor.count ? entries[anchor.count - 1].hash : LEDGER_GENESIS;
  return at === anchor.head ? { ok: true, note: 'matches the anchor' } : { ok: false, note: 'the entries up to the anchor are not the ones that were saved: history was replaced' };
}

// ---------------------------------------------------------------- reading one ticker
const lgVoided = (entries) => new Set(entries.filter((e) => e.kind === 'correction').map((e) => e.fixes));
const lgDateOf = (e) => (e.kind === 'check' ? e.checked : e.kind === 'exit' ? e.on : e.asOf);
// a status can only be set by a check in date order (a late entry for an earlier date does not become the current one)
function lgEvents(entries, t) {
  const voided = lgVoided(entries);
  return entries
    .filter((e) => e.t === t && (e.kind === 'check' || e.kind === 'exit') && !voided.has(e.n))
    .sort((a, b) => (lgDateOf(a) < lgDateOf(b) ? -1 : lgDateOf(a) > lgDateOf(b) ? 1 : (a.kind === b.kind ? 0 : a.kind === 'check' ? -1 : 1) || a.n - b.n));
}
// the periods in which Zoya showed a stock as non-compliant. Opened by a Zoya non-compliant check, closed by a Zoya
// compliant one. Questionable results and anything not from Zoya neither open nor close a period.
function lgRuns(entries, t) {
  const runs = [];
  let run = null;
  let lastConfirmed = null;
  const transitions = [];
  for (const e of lgEvents(entries, t)) {
    if (e.kind === 'check' && lgIsZoya(e.source)) {
      if (e.status === 'compliant') {
        if (run) { run.closed = { n: e.n, checked: e.checked }; run = null; }
        lastConfirmed = 'compliant';
      } else if (e.status === 'non_compliant') {
        if (!run) {
          const fromCompliant = lastConfirmed === 'compliant';
          run = { startN: e.n, firstSeen: e.checked, fromCompliant, changeDate: e.changeDate || null, deadline: null, exits: [], exit: null, closed: null };
          runs.push(run);
          if (fromCompliant) transitions.push({ from: 'compliant', to: 'non_compliant', n: e.n, checked: e.checked, changeDate: run.changeDate });
        } else if (!run.changeDate && e.changeDate) run.changeDate = e.changeDate;
        lastConfirmed = 'non_compliant';
      } else if (e.status === 'questionable') {
        if (lastConfirmed === 'compliant') transitions.push({ from: 'compliant', to: 'questionable', n: e.n, checked: e.checked, changeDate: null });
      }
    } else if (e.kind === 'exit' && run) {
      run.exits.push(e);
      run.exit = e; // the last one in date order
    }
  }
  // the countdown: only after a confirmed move from compliant, and only from the change date Zoya shows
  for (const r of runs) r.deadline = r.fromCompliant && r.changeDate ? addDaysISO(r.changeDate, LEDGER_RULES.exitDays) : null;
  runs.transitions = transitions;
  return runs;
}
const LG_LEVEL = { bad: 0, warn: 1, info: 2, ok: 3 };
// everything the ledger knows about one ticker on a given day. held: whether it is in the holdings now.
function holdingState(entries, t, today, held) {
  const flags = [];
  const flag = (level, code, text) => flags.push({ level, code, text });
  const voided = lgVoided(entries);
  const mine = entries.filter((e) => e.t === t);
  const checks = lgEvents(entries, t).filter((e) => e.kind === 'check');
  const latest = checks[checks.length - 1] || null;
  const zoyaChecks = checks.filter((e) => lgIsZoya(e.source));
  const latestZoya = zoyaChecks[zoyaChecks.length - 1] || null;
  const runs = lgRuns(entries, t);
  const open = runs.find((r) => !r.closed) || null;
  const transitions = runs.transitions;
  const S = { compliant: 'compliant', non_compliant: 'not compliant', questionable: 'questionable' };

  // the headline: what the last record says, and how far it can be trusted
  let status = 'none';
  let headline = 'Not recorded';
  if (latest) {
    status = latest.status;
    headline = !lgIsZoya(latest.source) ? `Unconfirmed: ${S[latest.status]} (not from Zoya)` : latest.status === 'questionable' ? 'Questionable on Zoya' : `Recorded as ${S[latest.status]} on Zoya`;
  }

  // the recheck clock runs from the last Zoya check
  let recheckDue = null;
  let daysToRecheck = null;
  let recheck = 'none';
  if (latestZoya) {
    recheckDue = addDaysISO(latestZoya.checked, LEDGER_RULES.recheckDays);
    daysToRecheck = daysBetweenISO(today, recheckDue);
    recheck = daysToRecheck < 0 ? 'overdue' : daysToRecheck <= LEDGER_RULES.dueSoonDays ? 'due_soon' : 'ok';
  }
  const exited = !!(open && open.exit && open.exit.exitStatus === 'completed');
  const watching = !!held || (open && !exited); // a stock you sold after a completed exit no longer needs rechecks

  if (!latest) {
    if (held) flag('bad', 'missing', 'No Shariah record for this holding. Look it up on Zoya and record what it shows.');
  } else {
    if (!latestZoya) flag('bad', 'no_zoya', 'Nothing here comes from Zoya. A status from any other source is not confirmed, so check Zoya and record it.');
    else if (watching) {
      if (recheck === 'overdue') flag('bad', 'stale', `Zoya was last checked on ${latestZoya.checked}, ${-daysToRecheck} day${daysToRecheck === -1 ? '' : 's'} past the ${LEDGER_RULES.recheckDays}-day recheck. The record is stale: check Zoya again.`);
      else if (recheck === 'due_soon') flag('warn', 'due_soon', daysToRecheck === 0 ? 'Recheck on Zoya is due today.' : `Recheck on Zoya is due on ${recheckDue} (in ${daysToRecheck} day${daysToRecheck === 1 ? '' : 's'}).`);
    }
    if (latest.status === 'questionable' && lgIsZoya(latest.source)) flag('warn', 'uncertain', `Zoya showed this as questionable on ${latest.checked}. Treat it as unresolved until a later Zoya check says compliant or not compliant.`);
    if (latest !== latestZoya && !lgIsZoya(latest.source) && latestZoya) flag('warn', 'unconfirmed_latest', `The latest entry (${latest.checked}) is not from Zoya, so it is not counted. The last Zoya check is ${latestZoya.checked}.`);
  }
  for (const tr of transitions) {
    if (tr.to === 'non_compliant') flag('bad', 'transition', `Changed from compliant to not compliant: confirmed on Zoya ${tr.checked}${tr.changeDate ? `, status-change date ${tr.changeDate}` : ', no status-change date recorded yet'}.`);
    else flag('warn', 'transition', `Zoya moved this from compliant to questionable on ${tr.checked}.`);
  }
  if (open) {
    if (!open.fromCompliant) flag('bad', 'no_prior_compliant', `Zoya shows this as not compliant (first recorded ${open.firstSeen}), but this ledger has no earlier Zoya check that said compliant, so the ${LEDGER_RULES.exitDays}-day countdown has not started and no deadline is shown. If Zoya showed it as compliant before, record that earlier check with its date and evidence. Otherwise decide the next step with Zoya and your scholar.`);
    else if (!open.changeDate) flag('bad', 'no_change_date', `Zoya moved this from compliant to not compliant (confirmed ${open.firstSeen}), but the status-change date is not recorded, so the ${LEDGER_RULES.exitDays}-day countdown has not started. Find the date Zoya shows for the change and record it with another check.`);
    const left = open.deadline ? daysBetweenISO(today, open.deadline) : null;
    const ex = open.exit ? open.exit.exitStatus : 'not_started';
    if (open.deadline) {
      if (ex === 'completed') flag(open.exit.on > open.deadline ? 'warn' : 'ok', 'exit_done', open.exit.on > open.deadline ? `Exit completed on ${open.exit.on}, after the ${open.deadline} deadline.` : `Exit completed on ${open.exit.on}, before the ${open.deadline} deadline.`);
      else if (left < 0) flag('bad', 'exit_overdue', `The exit deadline (${open.deadline}) passed ${-left} day${left === -1 ? '' : 's'} ago and the exit is ${ex === 'in_progress' ? 'only in progress' : 'not started'}.`);
      else flag(left <= 14 ? 'bad' : 'warn', 'exit_open', `Exit deadline ${open.deadline}: ${left} day${left === 1 ? '' : 's'} left (${LEDGER_RULES.exitDays} days from ${open.changeDate}). Exit ${ex === 'in_progress' ? 'in progress' : 'not started'}.`);
    } else if (ex === 'completed') flag('info', 'exit_done', `Exit completed on ${open.exit.on}.`);
    if (exited && held) flag('warn', 'still_held', 'The exit is marked completed but this stock is still in your holdings. Update your holdings, or correct the exit entry.');
  }
  if (latestZoya && latestZoya.status === 'compliant' && runs.length && runs[runs.length - 1].closed) flag('info', 'back_to_compliant', `Zoya showed this as compliant again on ${runs[runs.length - 1].closed.checked}; the earlier non-compliant period and its deadline stay in the history.`);
  const backdated = mine.filter((e) => e.kind === 'check' && !voided.has(e.n) && mine.some((x) => x.kind === 'check' && !voided.has(x.n) && x.n < e.n && x.checked > e.checked));
  if (backdated.length) flag('info', 'backdated', `${backdated.length} check${backdated.length === 1 ? ' was' : 's were'} entered after a later-dated one. The history keeps the order they were entered; the status follows the check dates.`);
  const out = flags.filter((f) => f.text);
  out.sort((a, b) => LG_LEVEL[a.level] - LG_LEVEL[b.level]);
  const worst = out.length ? out[0].level : latest ? 'ok' : 'info';
  return {
    t, held: !!held, status, headline,
    confirmed: !!(latestZoya && latest === latestZoya),
    lastCheck: latest ? { n: latest.n, checked: latest.checked, source: latest.source, evidence: latest.evidence } : null,
    lastZoyaCheck: latestZoya ? { n: latestZoya.n, checked: latestZoya.checked, source: latestZoya.source, evidence: latestZoya.evidence } : null,
    recheck, recheckDue, daysToRecheck,
    run: open ? { startN: open.startN, firstSeen: open.firstSeen, fromCompliant: open.fromCompliant, changeDate: open.changeDate, deadline: open.deadline, daysLeft: open.deadline ? daysBetweenISO(today, open.deadline) : null, exitStatus: open.exit ? open.exit.exitStatus : 'not_started', exitDate: open.exit ? open.exit.on : null, exitNote: open.exit ? open.exit.note || null : null } : null,
    transitions,
    runs: runs.map((r) => ({ startN: r.startN, changeDate: r.changeDate, deadline: r.deadline, closed: r.closed, exitStatus: r.exit ? r.exit.exitStatus : 'not_started' })),
    flags: out, worst,
    history: mine.map((e) => ({ ...e, voided: voided.has(e.n) })),
  };
}
// the whole page: one row per held stock, plus any other ticker that has entries, worst first
function ledgerView(entries, heldTickers, today) {
  const heldSet = new Set(heldTickers || []);
  const tickers = [...new Set([...heldSet, ...entries.map((e) => e.t)])];
  const rows = tickers.map((t) => holdingState(entries, t, today, heldSet.has(t)));
  // a stock that is not held and has no open problem is background; held stocks and open problems come first
  rows.sort((a, b) => LG_LEVEL[a.worst] - LG_LEVEL[b.worst] || (b.held ? 1 : 0) - (a.held ? 1 : 0) || (a.t < b.t ? -1 : 1));
  const count = (lvl) => rows.filter((r) => r.held && r.worst === lvl).length;
  return {
    rows,
    summary: { held: rows.filter((r) => r.held).length, bad: count('bad'), warn: count('warn'), ok: count('ok') + count('info') },
    integrity: verifyLedger(entries, today),
    purification: PURIFICATION,
  };
}
// The buy gate. May a NEW buy of this stock be suggested, as far as the ledger goes? Yes only when the newest check in the
// ledger is from Zoya, says compliant, and is no older than the recheck period. A missing, non-Zoya, questionable,
// non-compliant or stale record blocks it, and so does a ledger that failed its own check (intact = false). This reads
// the record you made; it never decides whether a company is compliant, and it never asks anything of the tool's own screen.
// Selling, holding and the exit countdown are not touched by it.
function shariahGate(entries, t, today, intact = true) {
  const block = (code, reason) => ({ ok: false, code, reason, status: null, checked: null });
  if (!intact) return block('integrity', 'the Shariah ledger failed its own check, so none of its records can be relied on');
  const checks = lgEvents(Array.isArray(entries) ? entries : [], t).filter((e) => e.kind === 'check');
  const latest = checks[checks.length - 1] || null;
  if (!latest) return block('missing', 'it has no record in your Shariah ledger: look it up on Zoya and record what it shows');
  const zoya = checks.filter((e) => lgIsZoya(e.source));
  const latestZoya = zoya[zoya.length - 1] || null;
  const out = (code, reason) => ({ ok: false, code, reason, status: (latestZoya || latest).status, checked: (latestZoya || latest).checked });
  if (!latestZoya) return out('no_zoya', 'nothing in your Shariah ledger for it comes from Zoya, so its status is not confirmed');
  if (latest !== latestZoya) return out('unconfirmed_latest', `its newest ledger entry (${latest.checked}) is not from Zoya, so its status is not confirmed: check Zoya and record it`);
  if (latestZoya.status === 'non_compliant') return out('non_compliant', `Zoya shows it as not compliant (checked ${latestZoya.checked})`);
  if (latestZoya.status === 'questionable') return out('uncertain', `Zoya showed it as questionable (checked ${latestZoya.checked}): it stays blocked until a later Zoya check says compliant`);
  if (!isDateISO(today)) return out('no_date', 'today’s date could not be read, so the age of its Zoya check cannot be worked out');
  const age = daysBetweenISO(latestZoya.checked, today);
  if (age < 0) return out('future', `its Zoya check is dated ${latestZoya.checked}, which is in the future`);
  if (age > LEDGER_RULES.recheckDays) return out('stale', `its Zoya check is stale: last checked ${latestZoya.checked}, ${age} days ago, and a recheck is due every ${LEDGER_RULES.recheckDays} days`);
  return { ok: true, code: 'ok', reason: '', status: 'compliant', checked: latestZoya.checked };
}
// amounts you entered, exactly as entered. Nothing is added up, calculated, estimated or suggested.
function purificationRecords(entries, t) {
  const voided = lgVoided(entries);
  const rows = entries.filter((e) => e.kind === 'purification' && (!t || e.t === t) && !voided.has(e.n));
  return { active: PURIFICATION.active, status: PURIFICATION.status, message: PURIFICATION.message, rows };
}

// ---------------------------------------------------------------- joining two copies (a backup into this device)
// The two copies are chains from the same start. If one holds the other, the longer one wins. If they split (an entry was
// added on each device), the entries that are only in the incoming copy are added to the end of this one, each marked with
// where it came from, so adding the same backup again changes nothing. Nothing in this copy is ever changed or removed.
function mergeLedgers(local, incoming) {
  const a = verifyLedger(local);
  const b = verifyLedger(incoming);
  if (!a.ok) return { ok: false, entries: local, added: 0, note: 'The ledger on this device does not pass its own check, so nothing was merged.' };
  if (!b.ok) return { ok: false, entries: local, added: 0, note: 'The ledger in the backup does not pass its own check, so nothing was merged.' };
  let common = 0;
  while (common < local.length && common < incoming.length && local[common].hash === incoming[common].hash) common++;
  if (common === incoming.length) return { ok: true, entries: local, added: 0, note: common === local.length ? 'The backup ledger is the same as this one.' : 'This device already has more than the backup.' };
  if (common === local.length) return { ok: true, entries: incoming.slice(), added: incoming.length - common, note: 'The backup extends this ledger; the new entries were added.' };
  const known = new Set();
  for (const e of local) { known.add(e.hash); if (e.origin) known.add(e.origin.hash); }
  const map = new Map(); // incoming entry number -> number on this device
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
    const next = lgBuild(out, { ...fields, origin: { n: e.n, hash: e.hash } }, recorded);
    out = [...out, next];
    map.set(i, next.n);
    known.add(e.hash);
    added++;
  }
  return { ok: true, entries: out, added, note: added ? `${added} entr${added === 1 ? 'y' : 'ies'} from the backup were added after the ones on this device.` : 'Nothing new in the backup.' };
}

export {
  LEDGER_VERSION, LEDGER_RULES, LEDGER_STATUSES, LEDGER_SOURCES, LEDGER_EXIT, LEDGER_KINDS, LEDGER_GENESIS, PURIFICATION,
  sha256Hex, isDateISO, addDaysISO, daysBetweenISO, appendEntry, verifyLedger, anchorOf, checkAnchor, holdingState, ledgerView, shariahGate, purificationRecords, mergeLedgers,
};
