# Swing scanner ranking: historical validation (free data). Rules written before any result was computed.

Written 27 November 2026 (Dubai), before any scanner score was computed on past data. Only price downloads had been started.

Question: does the swing scanner's evidence score (lib/scanner.js, SCAN_VERSION 1.0, unchanged) rank stocks that then beat
random picks, after costs? Nothing in the scanner, the chart analysis, the Shariah rules, the portfolio records or the
risk limits is changed. The long-term shortlist is not re-tested here; it was tested in the 10-year replay (VALIDATION.md,
PREREGISTERED.md sections 1 to 5).

## Data (free only)
- Daily split-adjusted OHLCV from Yahoo Finance's public chart endpoint, 1 Jan 2014 to 25 Nov 2026. Dividend-adjusted closes
  are used for returns. SPY is the market gauge, as on the site.
- Universe: the 800 largest US-listed companies by market value today (site's screen.json, 25 Nov 2026).
  Secondary universe: those of the 800 that the site's screen passes as halal today.

## Method
- Dates: every 20th trading day from 2 Dec 2016 to the last date with 20 trading days of later prices.
- On each date, for each stock, only bars up to that date are used: the real `prepare`, `analyzeTechnical`, `features`,
  `weeklyAnalysis`, the scanner's own `rankerBack` for relative strength, and `scanStock` with the scanner's own rules.
- A stock is "listed" when `scanStock` lists it. Candidates are ranked by the scanner's own order (`rankCandidates`).
- Inputs the free data cannot give for the past are fixed the same for every stock, so they cannot change the ranking:
  Shariah status = pass and data quality = high (gates pass), earnings dates unknown (the earnings gate is skipped and the
  "no earnings soon" check counts as met for everyone). This means the test covers the price and volume part of the scanner.
- Trade: buy at the next session's open, sell at the close 20 trading days after the entry. Costs: 0.10% each way commission
  and half-spread, plus 0.05% each way slippage, so 0.30% round trip, taken off every trade.
- Excess return = trade return minus the average 20-day return (same entry and exit, no costs) of all stocks in the universe.

## Periods
- Development: signals up to 31 Dec 2024. Final out-of-sample: signals from 2 Jan 2025 on. The final period is read once,
  after the development results and this rule are written.
- Regimes: SPY trend up / mixed / down (the site's `regimeFinder`), plus two named windows: 2020 crash (19 Feb to 30 Apr 2020)
  and 2022 bear market (3 Jan to 14 Oct 2022).

## Statistics and decision rule
- Top group: the 10 best-ranked listed stocks on each date (all of them if fewer than 10 are listed).
- Random comparison: on each date, 10 stocks drawn at random from the same listed stocks (2,000 draws), and the all-stock average.
- Per date, the gap = top group's mean net excess return minus the random draws' mean. Rank IC = Spearman of score with excess
  return, over the listed stocks of the date.
- Uncertainty: bootstrap over dates (5,000 resamples, seed 1): 95% interval of the mean gap; t-statistic of the mean rank IC.
- **Edge supported** only if, in BOTH development and final periods: the 95% interval of the mean gap is wholly above zero,
  the mean top-group net excess return is above zero, and the mean rank IC t is above 2.
- **Negative** if in either period the interval of the gap lies wholly below zero.
- **No measurable edge** otherwise. The research-tool label stays unless the first outcome holds.
- Regime and named-window results, the halal subset and the alternative of different top-group sizes (5, 20) are reported but
  cannot change the verdict.

## Limits stated now
- Survivorship: the universe is companies listed today. Companies taken over, delisted or bankrupt since 2016 are missing
  (about 44% of 2016's larger companies, see VALIDATION.md section 14). Free sources drop their prices. This flatters every
  portfolio in absolute terms; the comparison with random picks from the same companies is affected less.
- Size bias: stocks are in because they are large today.
- Point in time: prices and indicators use only past bars. Shariah status and earnings dates are not point in time (see above).
- 20-day trades only; the scanner's own stop and target exits are not simulated. Dates 20 days apart do not overlap.
- Costs are an assumption.
