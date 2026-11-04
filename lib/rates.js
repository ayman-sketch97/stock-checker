// Discount-rate rules for the study in PREREGISTERED.md, section 8. The live site does not use this file.
// A rule maps (the fixed tier rate: 0.08, 0.09 or 0.10; the valuation's as-of date 'YYYY-MM-DD') to a rate.
export const TIER_RF = 0.04; // the fixed tiers read as a 4% risk-free rate plus 4, 5 or 6 points
export const FLOOR = 0.055;
export const CAP = 0.15;
const clamp = (x, lo, hi) => Math.min(hi, Math.max(lo, x));

// FRED's GS10 csv ('observation_date,GS10' then 'YYYY-MM-01,4.99') -> Map 'YYYY-MM' -> yield as a decimal
export function loadYields(csv) {
  const Y = new Map();
  for (const line of String(csv).trim().split('\n').slice(1)) {
    const [d, v] = line.split(',');
    const x = Number(v);
    if (d && Number.isFinite(x)) Y.set(d.slice(0, 7), x / 100);
  }
  return Y;
}
const prevMonth = (ym) => { const [y, m] = ym.split('-').map(Number); return m === 1 ? `${y - 1}-12` : `${y}-${String(m - 1).padStart(2, '0')}`; };
// the monthly average yield of the month before the valuation's month (so it was fully known by then), or the
// average of the `smooth` months ending there. Throws if a month is missing: a gap must never fall back silently
export function yieldFor(Y, asOf, smooth = 1) {
  let ym = prevMonth(String(asOf).slice(0, 7));
  let sum = 0;
  for (let k = 0; k < smooth; k++) {
    if (!Y.has(ym)) throw new Error(`no 10-year yield for ${ym}`);
    sum += Y.get(ym);
    ym = prevMonth(ym);
  }
  return sum / smooth;
}
// rate = tier + shift + beta * (yield - TIER_RF), kept between floor and cap
export function linkedRule(Y, { shift = 0, beta = 1, smooth = 1, floor = FLOOR, cap = CAP } = {}) {
  return (tier, asOf) => clamp(tier + shift + beta * (yieldFor(Y, asOf, smooth) - TIER_RF), floor, cap);
}
// a fixed yield for every date (the extreme scenarios)
export function fixedYieldRule(y, { floor = FLOOR, cap = CAP } = {}) {
  return (tier) => clamp(tier + y - TIER_RF, floor, cap);
}
// the variants of section 8: B and the six sensitivity runs. meanYield: the test months' average (S1)
export function studyRules(Y, meanYield) {
  return {
    B: linkedRule(Y),
    S1: linkedRule(Y, { shift: TIER_RF - meanYield }),
    S2: linkedRule(Y, { beta: 0.5 }),
    S3: linkedRule(Y, { smooth: 12 }),
    S4: linkedRule(Y, { floor: 0.065 }),
    S5: linkedRule(Y, { shift: -0.01 }),
    S6: linkedRule(Y, { shift: 0.01 }),
  };
}
// the extreme yields of section 8 (with a one-point grid from 2% to 8% for the stability check), and the fixed
// tiers plus one point (I3)
export const EXTREME_YIELDS = [0.005, 0.02, 0.03, 0.04, 0.05, 0.0513, 0.06, 0.07, 0.08, 0.1, 0.15];
// a quarter point either side of October 2026's 5.13%: which of today's decisions a small move in the yield flips
export const NEAR_YIELDS = [0.0488, 0.0538];
export function extremeRules() {
  const out = Object.fromEntries([...EXTREME_YIELDS, ...NEAR_YIELDS].map((y) => [`y${(y * 100).toFixed(2)}`, fixedYieldRule(y)]));
  out.Aplus1 = (tier) => tier + 0.01;
  return out;
}
