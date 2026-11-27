# Swing scanner ranking: historical validation result (27 November 2026)

Rules: `PREREGISTERED.md` (sha256 cd395c6d041f41f12ba7ecf6d68c65066707f8e5699aef3754dd4b30daa34d43, written before any
score was computed). Code: `fetch.py` (free Yahoo prices), `run.mjs` (the real scanner on past bars, unchanged), `analyze.py`.
Numbers: `result.json`. Nothing in the scanner, weights, thresholds, Shariah rules, portfolio records or risk limits was changed.

## Verdict: no measurable edge (research-tool label stays)

Test: 125 dates, 2 Dec 2016 to 16 Oct 2026, every 20th trading day; 800 largest US companies today; on each date the
scanner's 10 best-ranked listed stocks, bought at the next open, sold 20 trading days later, 0.30% round-trip cost.
Excess = return minus the average of all 800 stocks over the same days.

| Period | Dates | Top 10, net, vs all stocks | Top 10 vs random listed stocks (95% interval) | Rank IC (t) | Worst fall of the top-10 sequence |
|---|---:|---:|---|---|---:|
| Development (to Dec 2024) | 102 | -0.51% per trade | -0.09 pts (-0.60 to +0.43) | -0.005 (-0.29) | 36% |
| Final out-of-sample (2025 on) | 23 | -0.74% per trade | -0.03 pts (-1.73 to +1.71) | -0.019 (-0.53) | 19% |

The pass rule needed the interval above zero, positive net excess and IC t above 2 in both periods. None held.
The ranking does no better than picking at random among the stocks the scanner already lists. Listing itself does not
help: all listed stocks trailed the 800-stock average by 0.47% per trade after costs (interval -0.80 to -0.18; about 0.17
before costs, so within noise of zero before costs).

Top 5 and top 20 groups, and the halal-today subset: all intervals include zero (`result.json`). Not used for the verdict.

## By regime (top 10, vs random listed stocks; 20-day dates, so counts are small)

| Regime | Dates | Top 10 net vs all | Gap vs random (95%) |
|---|---:|---:|---|
| S&P 500 trend up | 97 | -0.56% | -0.15 (-0.75 to +0.44) |
| Mixed | 14 | +1.38% | +1.67 (+0.49 to +2.88) |
| Down | 14 | -2.41% | -1.35 (-2.68 to +0.11) |
| 2022 bear (Jan to Oct) | 10 | -0.87% | -0.85 (-2.87 to +1.18) |
| 2020 crash (Feb 19 to Apr 30) | 2 | not enough dates | |

Years: only 2021 was clearly below random (-1.72 pts, interval -3.07 to -0.38). The "mixed" gain is one of many cuts and
is not evidence of an edge (many regimes and years looked at, none part of the rule).

## Limits
- Survivorship: companies listed today only; failed and taken-over companies missing (about 44% of 2016's larger
  companies, VALIDATION.md section 14). Free sources drop their prices. Absolute returns are flattered; the comparison with
  random picks from the same companies suffers less.
- Not point in time: today's largest 800 (size bias); Shariah status and earnings dates were held equal for every stock, so
  the test covers the price and volume part of the scanner only.
- Only 20-day buy-and-hold trades; the scanner's own stop and target exits were not simulated. 20-day spacing gives few
  dates in short episodes (2020 crash: 2).
- Costs are an assumption (0.30% round trip). Statistical power: with 23 final dates, only a gap of about 2 points would
  have shown. "No measurable edge" is not "proven no edge".
- The development and final periods were computed in the same run, after the rule was written; no setting was changed
  afterwards. The final period is short.
- Long-term shortlist: not re-tested here; see the 10-year replay in VALIDATION.md and PREREGISTERED.md sections 1 to 5.
