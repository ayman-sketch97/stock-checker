# Validation report (19 October 2026, second and third rounds 23 October 2026, fourth round 27 October 2026)

What was checked, how, and what is still wrong. Nothing here claims the tool is error-free: it records the
evidence for the 16 companies tested against their filings and the limits that remain.

## 1. Automated formula tests

`node --test test/formulas.test.mjs` (53 tests, all passing; run by every build before publishing).
Reference values are worked out by hand or from published definitions, not from the code under test:

- SMA, EMA (SMA-seeded, k = 2/(n+1)), Wilder RSI (StockCharts example closes), Wilder ATR, MACD (12/26/9).
- Trade plans: stop below entry, risk %, R-multiples, limit price; orders act only on the next session.
- Fiscal-year labels for 52/53-week years; growth spans measured between period-end dates.
- DCF: zero growth equals the perpetuity value; constant growth equals the Gordon value; net cash and shares applied once.
- Missing cash, missing debt, missing capital spending and implausibly small debt give "unknown", never zero.
- Shariah: unknown industry and missing data give REVIEW; reported interest income at 5% or more fails.
- Stock splits read from share counts restated in later filings (3:2 and 2:1, with and without split data from prices).
- Stock-based pay lowers owner cash flow and the fair value; banks, insurers and brokers get no fair value.
- Statements more than 135 days old and prices more than 4 days old are flagged.
- No look-ahead: the setup and plan on day i are the same whether or not later prices exist.
- Backtest costs are charged against the risk (risk floored at 0.5%); the benchmark uses R x risk for trades and
  the same span for random entries in the stock and in SPY.
- Data quality: a clean company is "high"; incomplete capital spending, missing cash or debt, statements more than
  9 months old, a cash-flow estimate at 3 times the price or more, or debt and other claims larger than the business
  give "insufficient", which withholds the verdict, the price levels and the Portfolio picks.
- Interest above 15% of the reported debt (and over $50M a year) means part of the debt is unreadable: debt unknown,
  unless the debt it implies at 6% is under 5% of the market value (then kept, with a note).
- The fair value moves the right way, by the right amount, when growth, margin, discount rate, cash, debt, minority
  interests or the share count change.
- Portfolio replay: position size from the stop (1% risk), at most 10 positions and 20% in one, exits booked before
  entries, skipped signals counted; buy and hold with and without reinvested dividends.

`python3 test/page.test.py` (Playwright, run on every push): journal P/L with fees, trading costs, backup save,
wipe and restore round trip and merge rules, Portfolio warnings for missing prices and for a stock counted twice,
repeated buys combined at a weighted average cost, trade size and the 1% risk limit, the Watchlist check naming
holdings without a price, the stale-data banner, the benchmark and portfolio cards on the Record page, and stock
pages with a withheld and a normal verdict.

## 2. Financial figures against the filings

Method: for each company, the latest 10-K and 10-Q financial statements were read from the SEC filing itself
(the statement pages listed in each filing's FilingSummary.xml), independently of the XBRL company-facts API the
tool uses. Trailing 12 months from the filings = fiscal year + this year-to-date - last year-to-date.
Tolerance 0.5% (EPS 1%). Where the statement layout could not be parsed automatically (Caterpillar's segment
columns, Costco and Chevron footnote columns), the figure was read from the statement by hand
(`test/validation/compare.py`, `OV`).

Filings used: AAPL 0000320193-25-000079 and -26-000020; NVDA 0001045810-26-000021 and -26-000075;
JNJ 0000200406-26-000016 and -26-000153; CAT 0000018230-26-000008 and -26-000046; COST 0000909832-26-000093
(its latest 10-Q is older than the 10-K, so no 12-month check); CVX 0000093410-26-000078 and -26-000167.

Result: 87 figures compared, 82 within tolerance, 5 differences (explained below), 1 not compared.

| Company | Period | Figure | Filing | Stock Checker | Difference | Result |
|---|---|---|---|---|---|---|
| AAPL | FY 2025-09-27 | revenue | 416.161B | 416.161B | +0.00% | OK |
| AAPL | FY 2025-09-27 | netIncome | 112.010B | 112.010B | +0.00% | OK |
| AAPL | FY 2025-09-27 | eps | 7.46 | 7.46 | +0.00% | OK |
| AAPL | FY 2025-09-27 | shares | 15,004.7M | 15,004.7M | +0.00% | OK |
| AAPL | FY 2025-09-27 | ocf | 111.482B | 111.482B | +0.00% | OK |
| AAPL | FY 2025-09-27 | capex | 12.715B | 12.715B | +0.00% | OK |
| AAPL | FY 2025-09-27 | equity | 73.733B | 73.733B | +0.00% | OK |
| AAPL | FY 2025-09-27 | debt | 98.657B | 98.679B | +0.02% | OK |
| AAPL | FY 2025-09-27 | cash+investments | 132.420B | 132.420B | +0.00% | OK |
| AAPL | TTM/BS 2026-06-27 | revenue (12 months) | 466.823B | 466.823B | +0.00% | OK |
| AAPL | TTM/BS 2026-06-27 | netIncome (12 months) | 128.930B | 128.930B | +0.00% | OK |
| AAPL | TTM/BS 2026-06-27 | ocf (12 months) | 146.724B | 146.724B | +0.00% | OK |
| AAPL | TTM/BS 2026-06-27 | capex (12 months) | 10.041B | 10.041B | +0.00% | OK |
| AAPL | TTM/BS 2026-06-27 | cash+investments | 146.517B | 146.517B | +0.00% | OK |
| AAPL | TTM/BS 2026-06-27 | debt | 84.344B | 84.297B | -0.06% | OK |
| AAPL | TTM/BS 2026-06-27 | equity | 107.520B | 107.520B | +0.00% | OK |
| NVDA | FY 2026-01-25 | revenue | 215.938B | 215.938B | +0.00% | OK |
| NVDA | FY 2026-01-25 | netIncome | 120.067B | 120.067B | +0.00% | OK |
| NVDA | FY 2026-01-25 | eps | 4.90 | 4.90 | +0.00% | OK |
| NVDA | FY 2026-01-25 | shares | 24,514.0M | 24,514.0M | +0.00% | OK |
| NVDA | FY 2026-01-25 | ocf | 102.718B | 102.718B | +0.00% | OK |
| NVDA | FY 2026-01-25 | capex | 6.042B | 6.042B | +0.00% | OK |
| NVDA | FY 2026-01-25 | equity | 157.293B | 157.293B | +0.00% | OK |
| NVDA | FY 2026-01-25 | debt | 8.468B | 8.468B | +0.00% | OK |
| NVDA | FY 2026-01-25 | cash+investments | 62.556B | 49.670B | -20.60% | DIFF |
| NVDA | TTM/BS 2026-07-26 | revenue (12 months) | 302.970B | 302.970B | +0.00% | OK |
| NVDA | TTM/BS 2026-07-26 | netIncome (12 months) | 192.880B | 192.880B | +0.00% | OK |
| NVDA | TTM/BS 2026-07-26 | ocf (12 months) | 134.360B | 134.360B | +0.00% | OK |
| NVDA | TTM/BS 2026-07-26 | cash+investments | 56.586B | 56.586B | +0.00% | OK |
| NVDA | TTM/BS 2026-07-26 | debt | 33.366B | 33.366B | +0.00% | OK |
| NVDA | TTM/BS 2026-07-26 | equity | 228.984B | 228.984B | +0.00% | OK |
| JNJ | FY 2025-12-28 | revenue | 94.193B | 94.193B | +0.00% | OK |
| JNJ | FY 2025-12-28 | netIncome | 26.804B | 26.804B | +0.00% | OK |
| JNJ | FY 2025-12-28 | eps | 11.03 | 11.03 | +0.00% | OK |
| JNJ | FY 2025-12-28 | shares | 2,429.4M | 2,429.4M | +0.00% | OK |
| JNJ | FY 2025-12-28 | ocf | 24.530B | 24.530B | +0.00% | OK |
| JNJ | FY 2025-12-28 | capex | 4.832B | 4.832B | +0.00% | OK |
| JNJ | FY 2025-12-28 | equity | 81.544B | 81.544B | +0.00% | OK |
| JNJ | FY 2025-12-28 | debt | 47.933B | 47.938B | +0.01% | OK |
| JNJ | FY 2025-12-28 | cash+investments | 20.102B | 20.102B | +0.00% | OK |
| JNJ | TTM/BS 2026-06-28 | revenue (12 months) | 97.929B | 97.929B | +0.00% | OK |
| JNJ | TTM/BS 2026-06-28 | netIncome (12 months) | 21.037B | 21.037B | +0.00% | OK |
| JNJ | TTM/BS 2026-06-28 | ocf (12 months) | 27.608B | 27.608B | +0.00% | OK |
| JNJ | TTM/BS 2026-06-28 | capex (12 months) | 5.364B | 5.364B | +0.00% | OK |
| JNJ | TTM/BS 2026-06-28 | cash+investments | 20.758B | 20.758B | +0.00% | OK |
| JNJ | TTM/BS 2026-06-28 | debt | 49.036B | 49.036B | +0.00% | OK |
| JNJ | TTM/BS 2026-06-28 | equity | 84.971B | 84.971B | +0.00% | OK |
| CAT | FY 2025-12-31 | revenue | 67.589B | 67.589B | +0.00% | OK |
| CAT | FY 2025-12-31 | netIncome | 8.884B | 8.884B | +0.00% | OK |
| CAT | FY 2025-12-31 | eps | 18.81 | 18.81 | +0.00% | OK |
| CAT | FY 2025-12-31 | shares | 472.3M | 472.3M | +0.00% | OK |
| CAT | FY 2025-12-31 | ocf | 11.739B | 11.739B | +0.00% | OK |
| CAT | FY 2025-12-31 | capex | 2.821B | 2.821B | +0.00% | OK |
| CAT | FY 2025-12-31 | equity | 21.318B | 21.318B | +0.00% | OK |
| CAT | FY 2025-12-31 | debt | 43.330B | 43.330B | +0.00% | OK |
| CAT | FY 2025-12-31 | cash+investments | 9.980B | 9.980B | +0.00% | OK |
| CAT | TTM/BS 2026-06-30 | revenue (12 months) | 74.729B | 74.729B | +0.00% | OK |
| CAT | TTM/BS 2026-06-30 | netIncome (12 months) | 10.844B | 10.844B | +0.00% | OK |
| CAT | TTM/BS 2026-06-30 | ocf (12 months) | 13.569B | 13.569B | +0.00% | OK |
| CAT | TTM/BS 2026-06-30 | capex (12 months) | 2.871B | 2.871B | +0.00% | OK |
| CAT | TTM/BS 2026-06-30 | cash+investments | 6.713B | 6.713B | +0.00% | OK |
| CAT | TTM/BS 2026-06-30 | debt | 45.146B | 43.330B | -4.02% | DIFF |
| CAT | TTM/BS 2026-06-30 | equity | 19.394B | 19.394B | +0.00% | OK |
| COST | FY 2026-08-30 | revenue | 303.154B | 303.154B | +0.00% | OK |
| COST | FY 2026-08-30 | netIncome | 9.226B | 9.226B | +0.00% | OK |
| COST | FY 2026-08-30 | eps | 20.76 | 20.76 | +0.00% | OK |
| COST | FY 2026-08-30 | shares | 444.4M | 444.4M | +0.00% | OK |
| COST | FY 2026-08-30 | ocf | 15.817B | 15.817B | +0.00% | OK |
| COST | FY 2026-08-30 | capex | 6.435B | 6.435B | +0.00% | OK |
| COST | FY 2026-08-30 | equity | 35.803B | 35.803B | +0.00% | OK |
| COST | FY 2026-08-30 | debt | 6.162B | 6.162B | +0.00% | OK |
| COST | FY 2026-08-30 | cash+investments | 21.301B | 21.301B | +0.00% | OK |
| CVX | FY 2025-12-31 | revenue | 184.432B | 189.031B | +2.49% | DIFF |
| CVX | FY 2025-12-31 | netIncome | 12.299B | 12.299B | +0.00% | OK |
| CVX | FY 2025-12-31 | eps | 6.63 | 6.63 | +0.00% | OK |
| CVX | FY 2025-12-31 | shares | n/a | 1,856.0M |  | not compared |
| CVX | FY 2025-12-31 | ocf | 33.939B | 33.939B | +0.00% | OK |
| CVX | FY 2025-12-31 | capex | 17.347B | 17.347B | +0.00% | OK |
| CVX | FY 2025-12-31 | equity | 186.450B | 186.450B | +0.00% | OK |
| CVX | FY 2025-12-31 | debt | 40.758B | 50.699B | +24.39% | DIFF |
| CVX | FY 2025-12-31 | cash+investments | 6.293B | 6.293B | +0.00% | OK |
| CVX | TTM/BS 2026-06-30 | revenue (12 months) | 208.711B | 215.261B | +3.14% | DIFF |
| CVX | TTM/BS 2026-06-30 | netIncome (12 months) | 20.591B | 20.591B | +0.00% | OK |
| CVX | TTM/BS 2026-06-30 | ocf (12 months) | 45.321B | 45.321B | +0.00% | OK |
| CVX | TTM/BS 2026-06-30 | capex (12 months) | 18.309B | 18.309B | +0.00% | OK |
| CVX | TTM/BS 2026-06-30 | cash+investments | 8.527B | 8.527B | +0.00% | OK |
| CVX | TTM/BS 2026-06-30 | debt | 37.075B | 37.075B | +0.00% | OK |
| CVX | TTM/BS 2026-06-30 | equity | 189.883B | 189.883B | +0.00% | OK |
### Remaining differences

- **NVDA cash + investments at Jan 25, 2026 (-20.6%).** The balance-sheet line "Marketable securities" ($51.95B)
  includes $12.9B of marketable equity securities. The tool counts only cash and interest-bearing (debt)
  securities, which is what the Shariah cash test needs; the valuation therefore leaves those shares out
  (conservative). Same definition at July 26, 2026, where it matches the filing exactly.
- **CAT debt at Jun 30, 2026 (-4.0%).** Caterpillar's 10-Q tags its debt with company-specific XBRL tags. The tool
  cannot read them, says so on the page, and carries the Dec 31, 2025 figure forward.
- **CVX revenue (+2.5% / +3.1%).** Chevron's standard "Revenues" tag is "Total revenues and other income" (it
  includes income from equity affiliates and other income). The tool uses it consistently, so margins are
  slightly understated versus "Sales and other operating revenues".
- **CVX debt at Dec 31, 2025 (+24%).** Chevron's "DebtCurrent" tag ($10.9B) includes short-term debt that the
  balance sheet reclassifies to long-term, so it is counted twice for that year-end. The latest balance sheet
  (Jun 30, 2026, used for the Shariah ratios and the fair value) matches exactly; only the history (ROIC for
  2025) is affected.

## 3. Prices and technical indicators

- Daily prices (Nasdaq) against Yahoo Finance for the last 250 sessions: largest close difference 0.001%,
  largest high/low difference 0.003% for all six stocks (`test/validation/pxcheck.py`).
- EMA-21, SMA-50, SMA-200, RSI-14, MACD line and signal, ATR-14 recomputed independently with pandas over the
  last 300 sessions: maximum difference 1e-12 or smaller for all six stocks (`test/validation/techcheck.py`).
- Plan arithmetic for the latest bar checked by hand for NVDA and AAPL (risk, R-multiples, limit price, stop rule).

## 4. Second round (23 October 2026)

### Fair value recomputed independently

`test/validation/dcfcheck.py` recomputes bear, base and bull per share from the inputs shown on the page, with
code written separately from the engine (run `test/validation/eng.mjs` first).

| Company | Largest difference of 3 scenarios |
|---|---|
| AAPL | 0.019% |
| MSFT | 0.026% |
| NVDA | 0.005% |
| JNJ | 0.011% |
| KO | 0.020% |
| CAT | 0.006% |
| CVX | 0.030% |
| AVGO | 0.008% |
| JPM | no fair value (financial company), as intended |

The differences come from growth and margin being shown rounded to 4 decimals. Net cash equals cash minus debt in
every case, and the share count is the cover-page count of the latest filing.

### Stock splits

The price provider (Nasdaq) reports no split events, so splits come from the filings
(`test/validation/splitcheck.mjs`):

| Stock | Actual split | Found in the filings |
|---|---|---|
| NVDA | 4:1 July 2021, 10:1 June 2024 | 3.998x (10-K of March 2022), 10.000x (10-K of February 2025) |
| AVGO | 10:1 July 2024 | 10.005x (10-K of December 2024) |
| CMG | 50:1 June 2024 | 50.000x (10-K of February 2025) |
| WMT | 3:1 February 2024 | 3.000x (10-K of March 2024) |
| AAPL | 7:1 June 2014, 4:1 August 2020 | 7.000x (October 2014), 4.000x (October 2020) |
| GOOGL | 20:1 July 2022 | not found, but the share history is consistent across years (14.1 to 12.2 billion) |

A split is found only once an annual report restates the earlier share counts. Until then, the market-value
cross-check (Nasdaq market value divided by price) corrects the share count and per-share history and shows a
warning.

### Backtest: costs, periods and benchmark

`test/validation/btbench.py` on the published backtest (51,927 trades on 2,017 stocks, October 2021 to October
2026). Average result per trade in R:

| | 0.2% cost | 0.5% cost | 0.8% cost |
|---|---|---|---|
| Pullback | -0.002 | -0.056 | -0.110 |
| Breakout | +0.009 | -0.054 | -0.118 |
| Reversal | +0.082 | +0.051 | +0.021 |
| Range | +0.071 | -0.005 | -0.080 |
| All stocks | +0.036 | -0.023 | -0.081 |
| Halal | +0.086 | +0.031 | -0.025 |
| Halal, RS 70+, market not falling | +0.141 | +0.090 | +0.039 (range -0.005 to +0.084) |

Period split with the rules unchanged (0.2% cost): October 2021 to 2023, -0.077R per trade; 2024 to October
2026, +0.120R. By year at 0.5% cost: 2021 -0.34R, 2022 -0.28R, 2023 +0.07R, 2024 +0.12R, 2025 +0.12R, 2026
-0.10R. Results follow the market. The rules have no fitted parameters, so a walk-forward re-fit does not apply;
the period split is the out-of-sample check. The RS 70+ and market filters were set with the whole period
visible, so their extra edge is not tested out of sample.

Benchmark, return on the money in each trade over the same span (signal-day close to exit-day close):

| | Before costs | After 0.2% |
|---|---|---|
| Halal trades, all 17,787 (site build) | +1.04% | +0.84% |
| Same stocks bought on a random day, held as long (site build) | +2.21% | +2.01% |
| SPY bought on a random day, held as long (site build) | +1.23% | no cost charged |
| Sample of 156 stocks, 4,254 trades: setups | +0.76% | +0.56% |
| Same sample, random day, held as long | +1.56% | +1.36% |
| SPY bought on a random day, held as long (sample) | +1.11% | no cost charged |

Random-entry figures move by a few tenths of a percent between builds because the random days differ (95% range
about 0.4 points either side). The setups have not beaten random entries in the same stocks held for the same time. The gains come from the
market rising. The Record page shows this comparison, recomputed by every build. Not modelled: delisted
companies (survivorship bias, results look better than reality), dividends (prices are not dividend-adjusted),
and overlapping positions competing for the same money.

### Data freshness and unsupported companies

- Each analysis records the price date, balance-sheet date and fiscal year end, and the stock page shows a warning
  when the balance sheet is more than 135 days old or the price more than 4 days old (live AAPL: balance sheet 118
  days old, price 1 day old, no warning). The home page warns when the site's data is 2 or more weekdays late.
- Banks, insurers and brokers (industry codes 6000 to 6799) get no fair value and are labelled "Not rated
  (financial firm)" (live JPM).
- Stock-based pay is subtracted before valuation and shown next to the inputs (live AAPL: $13.7B a year, 10% of
  free cash flow).

## 5. Third round (23 October 2026)

### Figures against the filings: 10 more companies

Same method as section 2. Where the label parser fails, the statement rows and the debt notes were read by hand
(`test/validation/rows.py`, `notes.py`; the values are in `compare.py`, `OV`). The companies were picked for
unusual structures: a lending business (MELI), a captive finance arm (DE), negative equity (BKNG), held-to-maturity
securities (VRT), convertible notes (HIMS), trailing-12-month columns (AMZN), plus MSFT, GOOGL, META and KO.

Filings used (10-K, then 10-Q): MSFT 0001193125-26-323660 (its 10-Q is older than the 10-K, so no 12-month check);
GOOGL 0001652044-26-000018 and -26-000071; META 0001628280-26-003942 and -26-066773; AMZN 0001018724-26-000004 and
-26-000026; HIMS 0001773751-26-000022 and -26-000163; VRT 0001674101-26-000008 and 0001628280-26-050609;
MELI 0001099590-26-000006 and -26-000023; KO 0001628280-26-010047 and -26-050503; BKNG 0001075531-26-000009 and
-26-000037; DE 0001104659-25-122321 and 0001104659-26-102213.

Result: 135 figures compared, 124 within tolerance, 11 differences (explained below), 4 not compared.

| Company | Period | Figure | Filing | Stock Checker | Difference | Result |
|---|---|---|---|---|---|---|
| MSFT | FY 2026-06-30 | revenue | 331.839B | 331.839B | +0.00% | OK |
| MSFT | FY 2026-06-30 | netIncome | 133.749B | 133.749B | +0.00% | OK |
| MSFT | FY 2026-06-30 | eps | 17.95 | 17.95 | +0.00% | OK |
| MSFT | FY 2026-06-30 | shares | 7,453.0M | 7,453.0M | +0.00% | OK |
| MSFT | FY 2026-06-30 | ocf | 182.935B | 182.935B | +0.00% | OK |
| MSFT | FY 2026-06-30 | capex | 115.948B | 115.948B | +0.00% | OK |
| MSFT | FY 2026-06-30 | equity | 442.387B | 442.387B | +0.00% | OK |
| MSFT | FY 2026-06-30 | debt | 40.294B | 40.294B | +0.00% | OK |
| MSFT | FY 2026-06-30 | cash+investments | 76.843B | 76.843B | +0.00% | OK |
| GOOGL | FY 2025-12-31 | revenue | 402.836B | 402.836B | +0.00% | OK |
| GOOGL | FY 2025-12-31 | netIncome | 132.170B | 132.170B | +0.00% | OK |
| GOOGL | FY 2025-12-31 | eps | 10.81 | 10.81 | +0.00% | OK |
| GOOGL | FY 2025-12-31 | shares | n/a | 12,230.0M |  | not compared |
| GOOGL | FY 2025-12-31 | ocf | 164.713B | 164.713B | +0.00% | OK |
| GOOGL | FY 2025-12-31 | capex | 91.447B | 91.447B | +0.00% | OK |
| GOOGL | FY 2025-12-31 | equity | 415.265B | 415.265B | +0.00% | OK |
| GOOGL | FY 2025-12-31 | debt | 48.543B | 49.085B | +1.12% | DIFF |
| GOOGL | FY 2025-12-31 | cash+investments | 126.843B | 127.219B | +0.30% | OK |
| GOOGL | TTM/BS 2026-06-30 | revenue (12 months) | 445.866B | 445.866B | +0.00% | OK |
| GOOGL | TTM/BS 2026-06-30 | netIncome (12 months) | 244.205B | 244.205B | +0.00% | OK |
| GOOGL | TTM/BS 2026-06-30 | ocf (12 months) | 185.675B | 185.675B | +0.00% | OK |
| GOOGL | TTM/BS 2026-06-30 | capex (12 months) | 132.402B | 132.402B | +0.00% | OK |
| GOOGL | TTM/BS 2026-06-30 | cash+investments | 242.474B | 242.474B | +0.00% | OK |
| GOOGL | TTM/BS 2026-06-30 | debt | 100.164B | 100.164B | +0.00% | OK |
| GOOGL | TTM/BS 2026-06-30 | equity | 640.480B | 640.480B | +0.00% | OK |
| META | FY 2025-12-31 | revenue | 200.966B | 200.966B | +0.00% | OK |
| META | FY 2025-12-31 | netIncome | 60.458B | 60.458B | +0.00% | OK |
| META | FY 2025-12-31 | eps | 23.49 | 23.49 | +0.00% | OK |
| META | FY 2025-12-31 | shares | 2,574.0M | 2,574.0M | +0.00% | OK |
| META | FY 2025-12-31 | ocf | 115.800B | 115.800B | +0.00% | OK |
| META | FY 2025-12-31 | capex | 69.691B | 69.691B | +0.00% | OK |
| META | FY 2025-12-31 | equity | 217.243B | 217.243B | +0.00% | OK |
| META | FY 2025-12-31 | debt | 58.744B | 58.744B | +0.00% | OK |
| META | FY 2025-12-31 | cash+investments | 81.592B | 81.592B | +0.00% | OK |
| META | TTM/BS 2026-09-30 | revenue (12 months) | 241.605B | 241.605B | +0.00% | OK |
| META | TTM/BS 2026-09-30 | netIncome (12 months) | 75.249B | 75.249B | +0.00% | OK |
| META | TTM/BS 2026-09-30 | ocf (12 months) | 133.087B | 133.087B | +0.00% | OK |
| META | TTM/BS 2026-09-30 | capex (12 months) | 104.438B | 104.438B | +0.00% | OK |
| META | TTM/BS 2026-09-30 | cash+investments | 82.449B | 82.449B | +0.00% | OK |
| META | TTM/BS 2026-09-30 | debt | 83.669B | 83.669B | +0.00% | OK |
| META | TTM/BS 2026-09-30 | equity | 272.386B | 272.386B | +0.00% | OK |
| AMZN | FY 2025-12-31 | revenue | 716.924B | 716.924B | +0.00% | OK |
| AMZN | FY 2025-12-31 | netIncome | 77.670B | 77.670B | +0.00% | OK |
| AMZN | FY 2025-12-31 | eps | 7.17 | 7.17 | +0.00% | OK |
| AMZN | FY 2025-12-31 | shares | 10,827.0M | 10,827.0M | +0.00% | OK |
| AMZN | FY 2025-12-31 | ocf | 139.514B | 139.514B | +0.00% | OK |
| AMZN | FY 2025-12-31 | capex | 131.819B | 131.819B | +0.00% | OK |
| AMZN | FY 2025-12-31 | equity | 411.065B | 411.065B | +0.00% | OK |
| AMZN | FY 2025-12-31 | debt | 68.396B | 69.291B | +1.31% | DIFF |
| AMZN | FY 2025-12-31 | cash+investments | 123.029B | 123.029B | +0.00% | OK |
| AMZN | TTM/BS 2026-06-30 | revenue (12 months) | 775.680B | 775.680B | +0.00% | OK |
| AMZN | TTM/BS 2026-06-30 | netIncome (12 months) | 135.281B | 135.281B | +0.00% | OK |
| AMZN | TTM/BS 2026-06-30 | ocf (12 months) | 161.403B | 161.403B | +0.00% | OK |
| AMZN | TTM/BS 2026-06-30 | capex (12 months) | 173.028B | 173.028B | +0.00% | OK |
| AMZN | TTM/BS 2026-06-30 | cash+investments | 122.988B | 122.988B | +0.00% | OK |
| AMZN | TTM/BS 2026-06-30 | debt | 132.549B | 133.320B | +0.58% | DIFF |
| AMZN | TTM/BS 2026-06-30 | equity | 551.620B | 551.620B | +0.00% | OK |
| HIMS | FY 2025-12-31 | revenue | 2.348B | 2.348B | +0.00% | OK |
| HIMS | FY 2025-12-31 | netIncome | 0.128B | 0.128B | +0.00% | OK |
| HIMS | FY 2025-12-31 | eps | 0.51 | 0.51 | +0.00% | OK |
| HIMS | FY 2025-12-31 | shares | 258.2M | 258.2M | +0.00% | OK |
| HIMS | FY 2025-12-31 | ocf | 0.300B | 0.300B | +0.00% | OK |
| HIMS | FY 2025-12-31 | capex | 0.226B | 0.243B | +7.32% | DIFF |
| HIMS | FY 2025-12-31 | equity | 0.541B | 0.541B | +0.00% | OK |
| HIMS | FY 2025-12-31 | debt | 0.973B | 0.973B | +0.00% | OK |
| HIMS | FY 2025-12-31 | cash+investments | 0.929B | 0.929B | +0.00% | OK |
| HIMS | TTM/BS 2026-06-30 | cash+investments | 0.841B | 0.841B | +0.00% | OK |
| HIMS | TTM/BS 2026-06-30 | debt | 1.365B | 1.365B | +0.00% | OK |
| HIMS | TTM/BS 2026-06-30 | equity | 0.324B | 0.324B | +0.00% | OK |
| VRT | FY 2025-12-31 | revenue | 10.230B | 10.230B | +0.00% | OK |
| VRT | FY 2025-12-31 | netIncome | 1.333B | 1.333B | +0.00% | OK |
| VRT | FY 2025-12-31 | eps | 3.41 | 3.41 | +0.00% | OK |
| VRT | FY 2025-12-31 | shares | 390.7M | 390.7M | +0.00% | OK |
| VRT | FY 2025-12-31 | ocf | 2.114B | 2.114B | -0.00% | OK |
| VRT | FY 2025-12-31 | capex | 0.220B | 0.220B | +0.00% | OK |
| VRT | FY 2025-12-31 | equity | 3.941B | 3.941B | +0.00% | OK |
| VRT | FY 2025-12-31 | debt | 2.913B | 2.913B | +0.00% | OK |
| VRT | FY 2025-12-31 | cash+investments | 1.828B | 1.828B | +0.00% | OK |
| VRT | TTM/BS 2026-06-30 | revenue (12 months) | 11.480B | 11.480B | +0.00% | OK |
| VRT | TTM/BS 2026-06-30 | netIncome (12 months) | 1.732B | 1.732B | +0.00% | OK |
| VRT | TTM/BS 2026-06-30 | ocf (12 months) | 3.354B | 3.354B | +0.00% | OK |
| VRT | TTM/BS 2026-06-30 | capex (12 months) | 0.424B | 0.424B | +0.00% | OK |
| VRT | TTM/BS 2026-06-30 | cash+investments | 3.111B | 3.111B | +0.00% | OK |
| VRT | TTM/BS 2026-06-30 | debt | 2.940B | 2.940B | +0.00% | OK |
| VRT | TTM/BS 2026-06-30 | equity | 4.758B | 4.758B | +0.00% | OK |
| MELI | FY 2025-12-31 | revenue | 28.893B | 28.893B | +0.00% | OK |
| MELI | FY 2025-12-31 | netIncome | 1.997B | 1.997B | +0.00% | OK |
| MELI | FY 2025-12-31 | eps | 39.40 | 39.40 | +0.00% | OK |
| MELI | FY 2025-12-31 | shares | 50.7M | 50.7M | +0.00% | OK |
| MELI | FY 2025-12-31 | ocf | 12.116B | 12.116B | +0.00% | OK |
| MELI | FY 2025-12-31 | capex | 1.343B | 1.343B | +0.00% | OK |
| MELI | FY 2025-12-31 | equity | 6.748B | 6.748B | +0.00% | OK |
| MELI | FY 2025-12-31 | debt | 9.193B | 9.432B | +2.60% | DIFF |
| MELI | FY 2025-12-31 | cash+investments | 6.299B | 6.299B | +0.00% | OK |
| MELI | TTM/BS 2026-06-30 | netIncome (12 months) | 1.863B | 1.863B | +0.00% | OK |
| MELI | TTM/BS 2026-06-30 | ocf (12 months) | 13.905B | 13.905B | +0.00% | OK |
| MELI | TTM/BS 2026-06-30 | cash+investments | 5.730B | 5.730B | +0.00% | OK |
| MELI | TTM/BS 2026-06-30 | debt | 10.626B | 10.913B | +2.70% | DIFF |
| MELI | TTM/BS 2026-06-30 | equity | 7.834B | 7.834B | +0.00% | OK |
| KO | FY 2025-12-31 | revenue | 47.941B | 47.941B | +0.00% | OK |
| KO | FY 2025-12-31 | netIncome | 13.107B | 13.107B | +0.00% | OK |
| KO | FY 2025-12-31 | eps | 3.04 | 3.04 | +0.00% | OK |
| KO | FY 2025-12-31 | shares | 4,313.0M | 4,313.0M | +0.00% | OK |
| KO | FY 2025-12-31 | ocf | 7.408B | 7.408B | +0.00% | OK |
| KO | FY 2025-12-31 | capex | 2.112B | 2.112B | +0.00% | OK |
| KO | FY 2025-12-31 | equity | 32.169B | 32.169B | +0.00% | OK |
| KO | FY 2025-12-31 | debt | 45.492B | 45.436B | -0.12% | OK |
| KO | FY 2025-12-31 | cash+investments | 15.806B | 13.872B | -12.24% | DIFF |
| KO | TTM/BS 2026-07-03 | ocf (12 months) | 16.342B | n/a |  | not compared |
| KO | TTM/BS 2026-07-03 | capex (12 months) | 2.045B | n/a |  | not compared |
| BKNG | FY 2025-12-31 | revenue | 26.917B | 26.917B | +0.00% | OK |
| BKNG | FY 2025-12-31 | netIncome | 5.404B | 5.404B | +0.00% | OK |
| BKNG | FY 2025-12-31 | eps | 165.57 | 165.57 | +0.00% | OK |
| BKNG | FY 2025-12-31 | shares | 32.6M | 32.6M | +0.00% | OK |
| BKNG | FY 2025-12-31 | ocf | 9.409B | 9.409B | +0.00% | OK |
| BKNG | FY 2025-12-31 | capex | 0.322B | 0.322B | +0.00% | OK |
| BKNG | FY 2025-12-31 | equity | -5.578B | -5.578B | +0.00% | OK |
| BKNG | FY 2025-12-31 | debt | 18.736B | 18.736B | +0.00% | OK |
| BKNG | FY 2025-12-31 | cash+investments | 17.203B | 17.203B | +0.00% | OK |
| BKNG | TTM/BS 2026-06-30 | revenue (12 months) | 28.241B | 28.241B | +0.00% | OK |
| BKNG | TTM/BS 2026-06-30 | netIncome (12 months) | 7.209B | 7.209B | +0.00% | OK |
| BKNG | TTM/BS 2026-06-30 | ocf (12 months) | 9.859B | 9.859B | +0.00% | OK |
| BKNG | TTM/BS 2026-06-30 | capex (12 months) | 0.320B | 0.320B | +0.00% | OK |
| BKNG | TTM/BS 2026-06-30 | cash+investments | 17.214B | 17.214B | +0.00% | OK |
| BKNG | TTM/BS 2026-06-30 | debt | 20.180B | 20.180B | +0.00% | OK |
| BKNG | TTM/BS 2026-06-30 | equity | -10.783B | -10.783B | +0.00% | OK |
| DE | FY 2025-11-02 | revenue | 45.684B | 45.684B | +0.00% | OK |
| DE | FY 2025-11-02 | netIncome | 5.027B | 5.027B | +0.00% | OK |
| DE | FY 2025-11-02 | eps | 18.50 | 18.50 | +0.00% | OK |
| DE | FY 2025-11-02 | shares | 271.7M | 271.7M | +0.00% | OK |
| DE | FY 2025-11-02 | ocf | 7.459B | 7.459B | +0.00% | OK |
| DE | FY 2025-11-02 | capex | 1.360B | 2.868B | +110.88% | DIFF |
| DE | FY 2025-11-02 | equity | 25.950B | 25.950B | +0.00% | OK |
| DE | FY 2025-11-02 | debt | 63.936B | 13.796B | -78.42% | DIFF |
| DE | FY 2025-11-02 | cash+investments | 9.687B | 8.276B | -14.57% | DIFF |
| DE | TTM/BS 2026-08-02 | netIncome (12 months) | 4.891B | 4.873B | -0.37% | OK |
| DE | TTM/BS 2026-08-02 | cash+investments | 10.278B | 8.928B | -13.13% | DIFF |
| DE | TTM/BS 2026-08-02 | debt | 63.836B | unknown |  | not compared (shown as unknown) |
| DE | TTM/BS 2026-08-02 | equity | 27.990B | 27.990B | +0.00% | OK |

Fixed because of this check:

- **MELI revenue was 30% too low.** The engine used the contract-revenue tag (sales only). It now prefers the total
  line ("Net revenues and financial income") when it is more than 3% larger for the same period.
- **VRT held-to-maturity securities** were not counted as investments. They are now.
- **DE debt** (below): the latest balance sheet now gives "debt unknown", red data quality and no verdict.

Remaining differences:

- **DE debt (-78%).** Deere reports its long-term borrowings ($43.5B) and most securitization borrowings under its
  own tags, so only short-term borrowings ($13.8B) are read. On the latest balance sheet the interest check now
  catches this: $2.9B of interest in the last 12 months is 17% of the $17.1B read, so debt is shown as unknown and
  the verdict is withheld. Before this round the check needed 20%, and the page showed "High confidence in the
  data" with $47B of debt missing. The yearly history (ROIC) still uses the understated figure.
- **DE capital spending (+111%).** The engine takes the larger capital-spending tag, which for Deere is equipment
  bought for its leasing business ($2.87B), not property and equipment ($1.36B). Both are cash spent; neither alone
  is a clean figure for a company with a finance arm.
- **KO cash (-12%) and DE cash (-15% / -13%).** Marketable securities held as longer-term or insurance investments
  (KO $1.93B, DE $1.41B / $1.35B) are not counted as cash. Conservative: the fair value is slightly lower.
- **MELI debt (+2.6% / +2.7%).** The sum of MercadoLibre's debt tags is $0.24B to $0.29B above the balance-sheet
  line "Loans payable and other financial liabilities". Not resolved.
- **GOOGL December 2025 debt (+1.1%) and AMZN debt (+1.3% / +0.6%).** The engine reads the face value of the notes;
  the balance sheet shows the carrying value after unamortized discounts (AMZN: plus short-term borrowings). GOOGL
  June 2026 and META match exactly.
- **HIMS capital spending (+7.3%).** The 10-K carries two tags: the cash-flow line ($226.0M) and a second total
  ($242.6M). The engine takes the larger. Conservative.

Not compared: GOOGL diluted shares (only in a note); KO's 12-month figures (SEC's company-facts data had not yet
added KO's July 10-Q, so the page flags KO's statements as more than 4 months old; about 105 companies were in the
same position on 23 October); DE's latest debt (shown as unknown, as intended). Parser problems resolved by hand:
Amazon's 10-Q prints trailing-12-month columns (read directly: operating cash flow $161.403B and capital spending
$173.028B, both exact), Vertiv's share count is in units under a "millions" header, Microsoft's EPS and share-count
rows carry the same label, Booking's statements have an extra empty column.

Effect of the 15% rule on the live site: six companies moved to insufficient data (Deere, TechnipFMC, PENN
Entertainment, TeraWulf, Goldman Sachs and Flagstar; the last four already failed the Shariah screen). TechnipFMC was
a false alarm: the debt its interest implies at 6% is under 3% of its market value, too small to matter. The rule now
applies only when that implied debt is more than 5% of the market value; below that the figure is used with a note
(yellow).

### Fair value: the 10 stocks named for review

Arithmetic (`dcfcheck.py`): largest difference 0.159% (COST, from inputs shown rounded), all others 0.03% or less.
AMZN and HIMS get no fair value (free cash flow after stock-based pay is not steadily positive) and JPM none (bank).

Sensitivity (`dcfsens.py`, recomputed independently), change in the base value per share:

| | Price | Base value | Growth +5 pts | Growth -5 pts | Margin +20% | Margin -20% | Discount +1 pt | Discount -1 pt | Cash +10% of market value | Debt +10% of market value | Shares +10% |
|---|---|---|---|---|---|---|---|---|---|---|---|
| AAPL | 347.86 | 215.87 | +31.9% | -24.5% | +19.6% | -19.6% | -15.8% | +22.9% | +16.1% | -16.1% | -9.1% |
| MSFT | 524.86 | 422.92 | +31.0% | -24.1% | +19.8% | -19.8% | -16.6% | +24.1% | +12.4% | -12.4% | -9.1% |
| GOOGL | 323.52 | 242.64 | +29.6% | -23.0% | +19.0% | -19.0% | -16.1% | +23.4% | +13.3% | -13.3% | -9.1% |
| META | 646.34 | 837.38 | +30.7% | -24.0% | +20.0% | -20.0% | -17.1% | +24.9% | +7.7% | -7.7% | -9.1% |
| NVDA | 212.74 | 247.67 | +30.6% | -23.9% | +19.9% | -19.9% | -17.0% | +24.8% | +8.6% | -8.6% | -9.1% |
| COST | 1007.97 | 506.01 | +30.3% | -23.3% | +18.6% | -18.6% | -15.0% | +21.8% | +19.9% | -19.9% | -9.1% |
| VRT | 193.82 | 211.39 | +30.6% | -23.9% | +20.0% | -20.0% | -17.1% | +24.8% | +9.2% | -9.2% | -9.1% |

Every change moves the value the right way. Cash and debt move it by exactly their amount per share, and 10% more
shares divide it by 1.1. The model is sound but sensitive: 5 points of growth either way moves the value by about
+30% / -24%, and 1 point of discount rate by about -16% / +24%. Read the fair value as a range, not a number.

### Data quality status on the live site

Build of 23 October 2026 (before the 15% rule; after it and the 5% refinement: 530 high, 877 limited, 156
insufficient, 55 shown as "No verdict (data)"): 2,021 rows, of which 533 high, 877 limited, 153 insufficient and
458 not analysed (foreign filers, funds, too little history). Of the 153, 56 show "No verdict (data)"; the others
fail the Shariah screen (86), have no usable figures (7) or are financial firms (4), which are shown first. No fair
value is 3 times the price or more and none is negative; 110 are below a third of the price.

### Backtest out of sample

The rules and the suggested filters were written while looking at signals from October 2021 on. `oos.mjs` replays
the frozen rules on a random sample of 400 of the site's stocks (seed 11) from November 2017, and reports the years
before October 15, 2021 (never examined) separately. Average result per trade in R, 95% range in brackets:

| | Unseen: Nov 2017 to Oct 2021 | Seen: Oct 2021 to Oct 2026 |
|---|---|---|
| All stocks, after 0.2% | +0.195 (+0.154 to +0.237), 6,476 trades | +0.050 (+0.018 to +0.083), 10,210 trades |
| Halal, after 0.2% | +0.284 (+0.213 to +0.356), 2,304 trades | +0.083 (+0.025 to +0.142), 3,251 trades |
| Halal, after 0.8% | +0.168 | -0.028 |
| Halal, RS 70+, market not falling, after 0.2% | +0.183 (+0.068 to +0.298), 961 trades | +0.157 (+0.050 to +0.264), 1,083 trades |
| Halal per trade before costs: setups / same stocks on a random day / SPY on a random day | 2.7% / 3.2% / 1.7% | 1.1% / 2.2% / 1.3% |

- The setups made money per trade in the unseen years too. But buying the same stocks on a random day and holding
  as long made more in both periods: the timing adds nothing measurable; the gains come from owning stocks in a
  rising market.
- The RS 70+ and market filter, chosen while looking at 2021 to 2026, did worse than plain halal signals on the
  unseen years (+0.18R against +0.28R). Its edge in the later period is probably fitted to that period.

Portfolio replay with stated rules (1% of the account at risk per trade, at most 10 open, no position above 20%,
0.2% cost, signals skipped when the money is in use; prices only):

| Period | Halal signals | Halal, RS 70+, market not falling | SPY bought and held (price only) |
|---|---|---|---|
| Nov 2017 to Oct 2021, sample | +3.8% a year, worst fall 30% | +6.0%, worst fall 37% | +14.8%, worst fall 34% |
| Oct 2021 to Oct 2026, sample | +8.9%, worst fall 25% | +5.1%, worst fall 22% | +11.3%, worst fall 25% |
| Oct 2021 to Oct 2026, all of the site's stocks (Record page, two builds the same day) | +0.8% and -0.6%, worst fall 32% to 34% | +5.1%, worst fall 33% | +11.3%, worst fall 25% |

An earlier run the same day drew a different sample of 400 (the stock list order changed between builds; the script
now sorts it first): the halal portfolio made +16.3% a year in 2017 to 2021 (SPY with dividends +16.9%) and +1.8% in
2021 to 2026. Most signals are skipped because 10 positions are already open, so the result depends heavily on which
signals happen to get the money; a single portfolio figure is not reliable. None of the portfolios beat holding the
S&P 500 once dividends are counted, and the worst falls are understated because open trades are counted at their
entry price.

### Dividends

- The Record page compares the trades and SPY on prices only and says so. Yahoo refused the build's dividend
  download this round and the tool does not work around that; checked separately the same day with Yahoo's
  dividend data, dividends added about 1.5 points a year to SPY from October 2021 to October 2026 (12.8% against
  11.3%). `oos.mjs` accepts a dividend file for this comparison.
- Swing trades hold about 24 trading days; at a 1% to 1.5% yield a trade that spans an ex-dividend date collects
  roughly 0.1% of the position. Not included; it would not change any conclusion above.

### Portfolio calculations

- Tested (page tests): trade P/L with entry and exit fees; win rate and profit factor; repeated long-term buys
  combined at a weighted average cost including fees (10 shares at $100 plus a $2 fee and 5 at $130 plus $1 give
  15 shares at $110.20); a Watchlist position wins over Journal buys of the same stock (no double count); closed
  trades left out; holdings without a price named; trade size ($1,000 at $100 with a stop at $95 risks $50) and
  the 1% risk limit, capped at the whole portfolio.
- Fixed: the Portfolio page used only the first long-term Journal buy of a stock (shares missing, average cost
  wrong); the Watchlist check silently left out holdings without a price; the size calculator now says a gap below
  the stop loses more than planned.
- Not built, so not tested: deposits and withdrawals, dividends received, currency conversion and realized P/L
  across cash movements. The broker statement remains the record for those.

## 6. Fourth round (27 October 2026)

### The real-money test for swing signals

- What it controls: until the live record passes the test below, swing signals are labelled paper trades on every
  page (stock, Technical tab, home, Shortlist, Watchlist alerts), the Portfolio plan gives swing trading no money,
  and the Journal keeps paper trades out of holdings and results. Missing or unreadable test data counts as failed.
- First version (8cbf59e, same day): each closed live trade on a halal stock compared with SPY over the same days,
  passing at 100 trades with a 95% lower bound above zero. Checked against the live log that evening (304 signals
  since 15 October 2026): the 58 closed trades were nearly all stop-outs (52 at exactly -1R), -6.9% a trade
  against -0.7% for SPY, while 213 trades were still open. A stop sits closer than a target, so losing trades
  tend to finish first; a closed-trade test judges whichever kind finishes first, and in a market where quick
  winners come first it could pass on luck. Trades opened the same week also move together, and the log adds 35
  to 40 signals a day, so 100 closed trades could arrive within a week. That version was replaced.
- Now: every filled halal trade is followed for 20 trading days after its fill (or to its exit, if sooner) with
  the same rules, and counts once those days are over, whether it closed or not, so which trades count depends
  only on the calendar. Trades are grouped by the month of their fill and each month (10 or more trades) is one
  result. Passing needs at least 6 months and a 95% lower bound (Student t on the monthly averages) above zero for
  the trade's return minus SPY's, after 0.2% costs. SPY is measured from the close before the fill. The 20-day
  result is stored in the log (hR); the trades that closed before this change all closed within 20 days, so their
  result is their 20-day result.
- When it can pass: the first trades reach 20 trading days in mid-November 2026, so six months of results exist
  in early April 2027 at the earliest. Until then the page shows how many trades are on the way.
- Tests: an 8-month edge passes, the same edge over 4 months fails, losing trades fail however many months, young
  stop-outs wait, and each counting rule (still open, closed inside and after the 20 days, older records without
  hR, not halal, not filled); hR on a flat price series; the Record page with and without measured trades.
- Limits: trades bought at the end of a month are measured into the next one, so neighbouring months overlap a
  little; six months is a minimum, not proof that an edge will last; SPY is compared on prices only.

### Design

- New look checked with the page tests and with screenshots at 360, 400, 768, 1024 and 1280 px in light and dark
  modes: no page scrolls sideways; body, muted and status text and the buttons meet WCAG AA contrast (4.5:1 or
  more) in both modes; the font is served from the site itself (no third-party requests).

## 7. What is not validated

- Companies outside the 16 tested; foreign filers (20-F/40-F), REITs, banks and insurers are not analysed.
- Companies with a finance or lending arm (DE, CAT, MELI): debt and cash flow mix two businesses. DE is now withheld,
  MELI is withheld by the 3-times rule, CAT's latest debt is carried forward from the annual report.
- Company-specific XBRL tags are not read; the tool states which figure is missing or carried forward.
- The Shariah screen cannot see impermissible revenue inside business segments; confirm on Zoya or Musaffa. The
  screen was not compared with an external screener; use Zoya for Shariah decisions.
- Survivorship bias in the backtest (delisted companies are missing, which flatters every figure). Dividends and
  overlapping positions are covered in section 5.
- Portfolio: there is no ledger for deposits, withdrawals, dividends received or currency conversion, so total
  return and realized P/L across cash movements are not tracked; trade P/L includes the fees you enter.
- SEC's company-facts data can lag the filings by weeks (about 105 companies on 23 October 2026); the page flags
  statements older than 4 months and withholds the verdict past 9 months.
- The fair value is a model with stated assumptions, not a measured fact.
