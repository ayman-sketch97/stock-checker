// Position-size rules, approved by the owner on 3 Nov 2026 and made exact the same day (PREREGISTERED.md, section 6).
// This file runs the 10-year test (lib/ltstats.js). index.html carries the same text between the policy.js markers
// (without the word "export"), and test/formulas.test.mjs fails if the two copies differ in any way.
//
// Weights are shares of the whole portfolio: stocks, funds, sukuk and cash, including money about to be invested.
// The sector limit is the one exception: a share of the long-term stocks only.
//   new buy:  amount <= buyCap x total - value   (no buy may take a stock above 10%; a new stock can take up to 10%)
//   trim:     if value / total > trimAt, sell value - trimTo x total   (above 15%, back to 10%, at any number of stocks)
//   sector:   no new money once sector value / stock value >= sectorMax   (40%, measured before the buy)
//   orders:   a buy or a sale under minOrder dollars is not made
const POLICY_VERSION = 2;
const POLICY_RULES = { buyCap: 0.1, trimAt: 0.15, trimTo: 0.1, sectorMax: 0.4, minOrder: 100 };
const POLICY_EPS = 1e-9; // rounding noise only: 9.99% is below 10%, and 10% plus a rounding error is still 10%
// the most that may go into one stock now; value: what you hold of it (0 for a new stock)
function buyRoom(value, total, cap = POLICY_RULES.buyCap) {
  if (!(total > 0)) return 0;
  const room = cap * total - (value > 0 ? value : 0);
  return room > POLICY_EPS * total ? room : 0;
}
// how much of a stock to sell to bring it back within the limit (0 at or below trimAt)
function trimSale(value, total, at = POLICY_RULES.trimAt, to = POLICY_RULES.trimTo) {
  if (!(total > 0) || !(value > 0)) return 0;
  return value / total > at + POLICY_EPS ? value - to * total : 0;
}
// may a sector take new money? Measured before the buy: a cap after the buy would block the first stock of every new
// portfolio, which is always 100% of its stocks
function sectorOpen(sectorValue, stocksValue, max = POLICY_RULES.sectorMax) {
  return !(stocksValue > 0 && sectorValue / stocksValue >= max - POLICY_EPS);
}
// is an amount worth an order?
function worthAnOrder(amount, min = POLICY_RULES.minOrder) {
  return amount >= min - POLICY_EPS;
}

export { POLICY_VERSION, POLICY_RULES, POLICY_EPS, buyRoom, trimSale, sectorOpen, worthAnOrder };
