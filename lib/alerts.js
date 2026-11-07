// The Alert Centre's bookkeeping (stage 9). Pure functions: no page, no storage, no clock, no network.
//
// What it is: the part of the Alert Centre that decides which alerts are NEW. The page works out which conditions are true now
// (a custom price level crossed, a scanner setup, a portfolio risk, a Shariah warning) by calling the functions the rest of the
// site already uses, and hands the list to reconcile(). reconcile() keeps the history, opens an alert the first time a condition
// is true, keeps it open while the condition stays true, and closes it when the condition ends. It never works out a price,
// a signal, a limit or a Shariah status, and it never places, suggests or changes an order: every alert is information.
//
// One alert per condition, not per look: an open alert is updated in place, so the same unchanged condition is shown once and
// announced once, however many times the page checks it. Three more rules keep that true when prices move all day:
//   1. what counts as "the same condition" is the alert's wording without its numbers (sigOf), so a share of 15.2% becoming
//      15.4% is the same alert, not a new one;
//   2. a price level, once crossed, is re-armed only after the price is back 1% on the other side of it (HYSTERESIS);
//   3. a condition that ends and comes back within 24 hours (REOPEN_MS) re-opens its earlier alert silently.
// Tests: test/alerts.test.mjs. index.html carries a character-for-character copy between the alerts.js markers.
const ALERT_VERSION = 1;
const ALERT_TYPES = ['price', 'scanner', 'risk', 'shariah'];
const ALERT_TYPE_NAME = { price: 'Price alerts', scanner: 'Scanner setups', risk: 'Portfolio risk', shariah: 'Shariah compliance' };
const HYSTERESIS = 0.01;
const REOPEN_MS = 24 * 3600 * 1000;
const MAX_HISTORY = 300;
const MAX_RULES = 50;
const MAX_NOTIFY = 3; // at most this many browser notifications in one check; the rest are summarised in one

const TICKER = /^[A-Z0-9][A-Z0-9-]{0,14}$/;
const finite = (x) => typeof x === 'number' && Number.isFinite(x);

// the alert's wording without its numbers: dollar amounts, percentages and counts become "#"
function sigOf(text) {
  return String(text == null ? '' : text).replace(/\$?\d[\d,]*(?:\.\d+)?%?/g, '#').replace(/\s+/g, ' ').trim();
}

// a custom price alert as the user typed it, cleaned; null when it cannot be used
function cleanRule(r) {
  if (!r || typeof r !== 'object') return null;
  const t = String(r.t == null ? '' : r.t).trim().toUpperCase();
  const level = typeof r.level === 'string' ? Number(r.level.replace(/[$,\s]/g, '')) : r.level;
  if (!TICKER.test(t) || !(r.dir === 'above' || r.dir === 'below') || !finite(level) || !(level > 0) || level > 1e7) return null;
  return { id: String(r.id || ''), t, dir: r.dir, level: Math.round(level * 10000) / 10000, on: r.on !== false, created: typeof r.created === 'string' ? r.created : '' };
}

// is the level crossed at price px? wasOpen: this rule's alert is already open, so the price must come back 1% past the level to end it
function priceMet(rule, px, wasOpen) {
  if (!finite(px) || !(px > 0) || !rule || !finite(rule.level)) return false;
  if (rule.dir === 'above') return px >= (wasOpen ? rule.level * (1 - HYSTERESIS) : rule.level);
  if (rule.dir === 'below') return px <= (wasOpen ? rule.level * (1 + HYSTERESIS) : rule.level);
  return false;
}

const priceKey = (rule) => `price:${rule.id}`;

// Update the history with the conditions that are true now.
//   history: [{id, key, type, tone, t, text, asOf, px, first, last, status:'open'|'ended', ended, dismissed, notified, count}]
//   conds:   [{key, type, tone, t, text, asOf, px}]   what is true now, for the types that could be checked
//   checked: the types that could be checked this time; open alerts of other types are left exactly as they are
//   now:     milliseconds since 1970 (passed in so the function stays pure)
// Returns {history, fresh}: fresh = the alerts opened this time (never an alert that was already open, and never a re-opened one).
function reconcile(history, conds, checked, now) {
  const hist = (Array.isArray(history) ? history : []).map((e) => ({ ...e }));
  const ck = new Set(checked || []);
  const fresh = [];
  const seen = new Set();
  for (const c of conds || []) {
    if (!c || !c.key || !ck.has(c.type) || seen.has(c.key)) continue;
    seen.add(c.key);
    const open = hist.find((e) => e.key === c.key && e.status === 'open');
    const patch = { tone: c.tone || '', t: c.t || '', text: c.text, asOf: c.asOf || '', px: finite(c.px) ? c.px : null, last: now };
    if (open) { Object.assign(open, patch); continue; }
    // came back soon after it ended: the same alert, silently
    let prev = null;
    for (const e of hist) if (e.key === c.key && e.status === 'ended' && now - (e.ended || 0) < REOPEN_MS && (!prev || e.ended > prev.ended)) prev = e;
    if (prev) { Object.assign(prev, patch, { status: 'open', ended: null, count: (prev.count || 1) + 1 }); continue; }
    const e = { id: `${c.key}@${now}`, key: c.key, type: c.type, ...patch, first: now, status: 'open', ended: null, dismissed: false, notified: false, count: 1 };
    hist.push(e);
    fresh.push(e);
  }
  for (const e of hist) if (e.status === 'open' && ck.has(e.type) && !seen.has(e.key)) { e.status = 'ended'; e.ended = now; }
  return { history: trim(hist), fresh };
}

// oldest ended or dismissed alerts go first when the history is over its size
function trim(hist) {
  if (hist.length <= MAX_HISTORY) return hist;
  const out = hist.slice();
  const order = out.map((e, i) => [e, i]).filter(([e]) => e.status !== 'open' || e.dismissed).sort((a, b) => (a[0].last || 0) - (b[0].last || 0));
  const drop = new Set();
  for (const [, i] of order) { if (out.length - drop.size <= MAX_HISTORY) break; drop.add(i); }
  return out.filter((_, i) => !drop.has(i));
}

// alerts that should be announced now: fresh, of an enabled type, not announced before. Marks them announced in the returned
// history (save it before showing anything, so a second tab or a reload cannot announce them again).
function takeNotifications(history, fresh, settings) {
  const on = new Set(ALERT_TYPES.filter((k) => !settings || !settings.types || settings.types[k] !== false));
  const ids = new Set((fresh || []).filter((e) => !e.notified && !e.dismissed && on.has(e.type)).map((e) => e.id));
  const send = [];
  const out = (history || []).map((e) => {
    if (!ids.has(e.id) || e.notified) return e;
    send.push(e);
    return { ...e, notified: true };
  });
  return { history: out, send: send.slice(0, MAX_NOTIFY), more: Math.max(0, send.length - MAX_NOTIFY) };
}

// switching notifications on must not announce what is already open: mark every open alert as announced
const baseline = (history) => (history || []).map((e) => (e.status === 'open' && !e.notified ? { ...e, notified: true } : e));

// management
const dismissAlert = (history, id) => (history || []).map((e) => (e.id === id ? { ...e, dismissed: true } : e));
const dismissAll = (history) => (history || []).map((e) => (e.status === 'open' && !e.dismissed ? { ...e, dismissed: true } : e));
const restoreAlert = (history, id) => (history || []).map((e) => (e.id === id ? { ...e, dismissed: false } : e));
// only an alert whose condition has ended can be deleted: deleting a condition that is still true would just open it again, as new
const deleteAlert = (history, id) => (history || []).filter((e) => !(e.id === id && e.status === 'ended'));
// clearing the history removes the ended alerts; an alert whose condition is still true stays (dismissed or not), so it is neither
// shown again nor announced again until the condition ends
const clearHistory = (history) => (history || []).filter((e) => e.status === 'open');

// the stored object, repaired: unknown shapes become empty, never an error
function cleanStore(raw) {
  const o = raw && typeof raw === 'object' ? raw : {};
  const rules = (Array.isArray(o.rules) ? o.rules : []).map(cleanRule).filter((r) => r && r.id).slice(0, MAX_RULES);
  const hist = (Array.isArray(o.hist) ? o.hist : []).filter((e) => e && typeof e.id === 'string' && typeof e.key === 'string' && ALERT_TYPES.includes(e.type) && typeof e.text === 'string');
  const types = {};
  for (const k of ALERT_TYPES) types[k] = !(o.set && o.set.types && o.set.types[k] === false);
  return { v: ALERT_VERSION, rules, hist, set: { types, notify: !!(o.set && o.set.notify) } };
}

export {
  ALERT_VERSION, ALERT_TYPES, ALERT_TYPE_NAME, HYSTERESIS, REOPEN_MS, MAX_HISTORY, MAX_RULES, MAX_NOTIFY, sigOf, cleanRule, priceMet, priceKey, reconcile, takeNotifications, baseline, dismissAlert, dismissAll, restoreAlert, deleteAlert, clearHistory, cleanStore,
};
