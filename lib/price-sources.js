// The one list of where prices come from, and on what terms. Display only: nothing reads this to decide a price or a signal.
// Every price feed the project uses must be listed here (test/price-sources.test.mjs checks the code against this list).
// licence 'personal' = free feed used for the owner's own research only. It must not be shown to paying users.
// To use a licensed feed later, add an entry with licence 'commercial' and point the fetch code at it; nothing else changes.
export const PRICE_SOURCES = Object.freeze({
  Nasdaq: { use: 'end-of-day closes and history', licence: 'personal', free: true },
  CNBC: { use: 'backup end-of-day price', licence: 'personal', free: true },
  'Yahoo Finance': { use: 'backup history and split dates', licence: 'personal', free: true },
  Finnhub: { use: 'delayed intraday quotes through the relay (display only)', licence: 'personal', free: true },
});
export const priceSourceInfo = (name) => PRICE_SOURCES[name] || null;
// true only for a listed source whose licence allows showing it to other people
export const mayShowToOthers = (name) => { const s = priceSourceInfo(name); return Boolean(s && s.licence === 'commercial'); };
