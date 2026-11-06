# Rate study, run 1 (4 November 2026): results

Run from commit 60d29ee: six shards from 08:33 to 08:51 UTC, the comparison until 09:05 UTC. The results are on the
`rate-study-results` branch (commit 51b704d, tagged `rate-study-run-1` so a later run cannot replace them):
`report.json`, the five-year periods of each rule and the raw shards. 2,634 companies, month-ends from December 2016
to November 2026, 50 random portfolios per period, prices only, the same data for every rule.

**Under section 8, B fails all six conditions, so the fixed 8%, 9% and 10% stay.** The live site is unchanged.

| Condition (section 8) | A, fixed rates | B, yield + 4, 5 or 6 points | |
|---|---|---|---|
| 1. Five-year periods won against the other | | 12 of 59 (47 lost) | fail |
| 2. Periods beating random halal stocks / the S&P 500 | 63% / 73% | 29% / 24% | fail |
| 3. Worst fall on the 10-year path | -32.9% | -38.6% (5.7 points deeper; limit 2) | fail |
| 4. Periods starting Dec 2016 to Apr 2019 | beat random 31%, S&P 500 59%, deepest fall -37.9% | won 10 of 29; beat random 7%, S&P 500 17%, deepest fall -40.4% | fail |
| 4. Periods starting May 2019 to Oct 2021 | beat random 93%, S&P 500 87%, deepest fall -34.6% | won 2 of 30; beat random 50%, S&P 500 30%, deepest fall -37.4% | fail |
| 5. Extremes: largest change in the median fair value for 1 point of yield, 2% to 8% | | 20% (limit 50%) | pass |
| 5. Stability: buy-zone entries and exits per company-year | 0.134 | 0.185 (38% more; limit 25%) | fail |
| 5. Stability: 95th percentile of the monthly change in fair value | 46.2% | 47.2% (limit 1.5 times) | pass |
| 6. Sensitivity rules S1 to S4 meeting conditions 1 and 3 | | none (3 needed) | fail |

The plan (1,000 AED a month, the long-term picks): A made 11.0% a year on the 10-year path and a median 18.1% a year
over the five-year periods; B 9.0% and 10.2%. Random halal stocks under the same rules: 11.1% (median period); the
S&P 500: 13.5%.

## Why B lost

- **It bought most when money was cheapest.** With the 10-year yield at 0.6% to 3%, B's fair values were far above
  A's: the median company's was 40% higher in 2017, 92% in 2020 and 75% in 2021. In the five years to November 2021
  B had 74% more company-months in the buy zone (2,350 against 1,353) and 45% fewer in the trim zone. When rates rose
  in 2022 its fair values fell back to A's and below (today 17% under A's), so what it had bought as cheap was not.
- **By starting year** (periods won by B, and the median gap a year): 2017, 8 of 12 (+0.4 points); 2018, 1 of 12
  (-3.6); 2019, 0 of 12 (-8.3); 2020, 0 of 12 (-9.9); 2021, 2 of 10 (-14.2). B won only while the low-rate rally ran.
- **It is the movement, not only the lower average:** S1, centred so that its average rate over the decade equals the
  fixed rates, still lost 48 of 59 periods. The less the rate moves, the less it lost: half link (S2) 39, a 12-month
  average (S3) 36.

## The sensitivity rules

| Rule | Periods won / lost against A | Beat random / S&P 500 | Worst fall (10-year path) | 10-year path, a year |
|---|---|---|---|---|
| S1, centred (+1.06 points) | 11 / 48 | 61% / 61% | -42.4% | 11.4% |
| S2, half the yield's move | 20 / 39 | 69% / 63% | -29.6% | 12.0% |
| S3, 12-month average yield | 23 / 36 | 56% / 49% | -31.1% | 10.9% |
| S4, floor 6.5% | 28 / 31 | 76% / 81% | -35.4% | 18.6% |
| S5, premium 1 point lower | 21 / 38 | 46% / 37% | -35.8% | 10.6% |
| S6, premium 1 point higher | 13 / 46 | 58% / 53% | -32.2% | 5.8% |

S4 has the best single path, but it loses more periods than it wins, its worst fall is 2.5 points deeper than A's and
its median period (15.9% a year) is below A's (18.1%). Section 8 says no sensitivity rule can be adopted on its own;
choosing one now, after seeing the results, would be fitting a rule to this decade.

## Valuations and decisions

- Median fair value under B against A, by year: 2017 1.40, 2018 1.24, 2019 1.42, 2020 1.92, 2021 1.75, 2022 1.25,
  2023 1.04, 2024 0.97, 2025 0.95, 2026 0.93. At October 2026's 5.13%: 0.83.
- The same decision (buy, hold, trim or sell) in 91% of company-months: 84% to November 2021, 96% after.
- Today, 146 of the 1,060 companies valued under both would get a different decision. Among halal-pass companies,
  for example: NVDA, META, MCK, SLB, TEL, BR and RS would leave the buy zone; MSFT, SYK, HUBB, DGX and DOV would reach
  the trim price; INTU, SCCO and TPR would enter the buy zone, because their lower fair value takes their upside
  under 60%, where the engine stops treating them as contrarian. 2.5% of halal-pass companies would be in the buy
  zone, against 5.1% now.

## Extreme rates (today's companies)

| 10-year yield | 0.5% | 2% | 3% | 4% | 5% | 5.13% | 6% | 7% | 8% | 10% | 15% |
|---|---|---|---|---|---|---|---|---|---|---|---|
| Median fair value against A | 2.19 | 1.52 | 1.22 | 1.00 | 0.84 | 0.83 | 0.73 | 0.63 | 0.56 | 0.46 | 0.46 |
| Halal-pass companies in the buy zone | 7.7% | 7.5% | 6.9% | 5.1% | 2.4% | 2.5% | 1.2% | 1.1% | 1.2% | 0.7% | 0.5% |
| At the 5.5% floor / the 15% cap | 527 / 0 | 0 / 0 | 0 / 0 | 0 / 0 | 0 / 0 | 0 / 0 | 0 / 0 | 0 / 0 | 0 / 0 | 0 / 1,851 | 0 / 2,008 |

One more point on the discount rate lowers fair values by 16.6% for strong businesses, 15.1% for typical ones and
15.7% for weaker ones (median).

## Small yield moves and unstable advice

- Under B every fair value moves every month (median 3.3%; A's change only with new filings).
- In the 81% of months when the yield moved a quarter point or less, B's decision changed while A's stayed in 2.7% of
  company-months, about the same as in all months (2.8%): the extra changes come from prices meeting a line that moves,
  not from the size of the yield's move.
- A quarter point either side of 5.13% today changes the decision of 68 of 2,008 companies (41 halal-pass).
- 163 companies change decision more than once between a 2% and an 8% yield (for example ADP: hold, buy, hold, hold,
  trim): a lower rate can push the upside above 60% and make a buy contrarian. With fixed rates that rule moves only
  with the price and the filings; tied to the yield it would also flip advice back and forth as rates move.

## Limits

One decade with one large rate cycle; the 59 periods overlap and hold about two independent five-year spans; the
companies that disappeared since 2016 are missing for A and B alike (VALIDATION.md, section 14); prices only. The run
fetched its data afresh, so A here (11.0% a year, beating random halal stocks in 63% of periods) differs slightly from
the published 10-year test of 3 November (11.8%, 66%): the same rules on data a day later. A and B share the same data.
