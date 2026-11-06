# Validation report (19 October 2026, second and third rounds 23 October 2026, fourth and fifth rounds 27 October 2026, audit and stage 1 on 3 November 2026)

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

## 7. The 10-year test of the stock picks (27 October 2026)

### How it works

- **Replay.** At every month-end from December 2016 to October 2026, each company's analysis is run again with only
  the filings filed by the day before and that day's closing price (`lib/longterm.js`, `tools/lt-backtest.mjs`).
  Orders fill at the next session's close. Prices are Nasdaq's, adjusted for splits, not dividends. Filed share
  counts are converted to today's basis with every split the filings reveal; a split is dated at the first filing
  whose cover share count jumped (DECK's fair value was 6 times too low in late 2024 before this fix).
- **Companies.** Every US common stock worth $250 million or more today (3,539 replayed; banks and insurers skipped;
  2,638 with usable results). On each month-end only companies worth $2 billion or more that day count, as on the
  site. This brings back companies that were big and have since shrunk, which a test of today's site list would
  miss. Companies that went bust, were taken over or fell below $250 million are still missing.
- **Questions.** (1) Did the picks beat the average halal stock the tool could judge, and the S&P 500 (SPY), 12, 24
  and 36 months later? Months overlap, so the t statistics are Newey-West. (2) What would 1,000 AED a month
  ($272.29) have become with the site's rules, against SPY and against 100 portfolios of random halal stocks with
  the same rules, over the whole period and in each half (split at December 2021)? Costs: the larger of $0.35 and
  $0.0035 a share, plus 0.05% for the spread.
- **Rules fixed in advance.** How the results are judged was written down before they were seen, in
  `PREREGISTERED.md` (git keeps the times). Rule 1 decides how much of the monthly money goes to stocks: 70% if the
  portfolio beat the random median over the whole period and both halves, beat SPY, and the picks beat the average
  stock with t above 2; 50% if it beat the random median over the whole period and the picks were ahead of the
  average stock; 20% otherwise.
- **Monthly.** `.github/workflows/lt-backtest.yml` re-runs everything on the 4th of each month and publishes
  `lt-summary.json` to the `backtest` branch; the daily build copies it to the site.

### The "Quality on sale" list (strong buy, buy, possible bargain), most upside first

| | 1 year later | 3 years later |
|---|---|---|
| Stocks on the list | +14.7% | +45.8% |
| The average halal stock | +13.6% | +42.6% |
| S&P 500 (SPY) | +13.7% | +44.1% |

- Ahead of the average stock by 1.1 points a year (t 0.8): within what luck produces. Before December 2021: -0.2
  points; from December 2021: +2.8 (t 1.7).
- By verdict, 1 year later: strong buy +16.7%, possible bargain +15.1%, buy +14.1%, watchlist +13.2%, avoid (weak
  fundamentals) +12.2%. The order is the right one, but no gap is clearly more than luck (t 1.3 or less).
- 1,000 AED a month, most upside first, at most 15 stocks: 20.4% a year (worst fall -33%) against SPY 13.9% and the
  random median 11.2% (8 in 10 random portfolios between 7.1% and 15.7%). First half 21.0% against a random median
  of 20.8%; second half 18.7% against 10.7%. The lead held in all 18 variations tried (10, 15 or 20 stocks, six
  different start months). But five stocks (EME, META, KLAC, SIG, LRCX) made 76% of the gain, and random picks from
  the list itself had a median of 13% to 16% a year, so most of the lead comes from buying the most upside first;
  in the 12-month test, the 15 stocks with the most upside were ahead only after 2021 (-0.5 points before, +9.8
  after).
- Rule 1: **mixed** (half the monthly money to stocks). Not "stocks": the picks' lead over the average stock is
  within luck (t 0.8; the rule needs more than 2), and the first half only just beat the random middle (20.8% here,
  21.5% in the first wider run, which had 3 fewer companies and drew different random portfolios).
- The first run, on the site's 1,977 companies only, gave +16.5% for the list against +17.6% for the average stock
  ("fund"). Adding the companies that shrank lowered the average stock far more (17.6% to 13.6%) than the list:
  that run flattered the average stock most.
- Check of the random portfolios: they can buy weak businesses that the rules sell a month later. Leaving those out
  gives a random median of 11.8% (halves 22.0% and 14.0%): the same verdict.

### Five other ways to build the list (PREREGISTERED.md, section 2)

Each needed to beat the average stock with t 2.5 or more, in both halves, and as a portfolio against random picks.

| Method | Against the average stock, 1 year later | Halves | Portfolio beat random | Result |
|---|---|---|---|---|
| Momentum (best 20% of 12-1 month returns) | +4.3 (t 1.7) | +2.9 / +5.7 | yes | failed: could be luck |
| Quality (best 20% of quality scores) | +0.1 (t 0.1) | +1.2 / -1.3 | no | failed |
| Quality and momentum | +1.4 (t 1.5) | +0.6 / +2.2 | yes | failed: could be luck |
| Quality and value | +1.4 (t 1.0) | +0.3 / +2.8 | yes | failed: could be luck |
| The list, rising stocks only | +1.4 (t 0.9) | -0.9 / +3.9 | yes | failed |

None passed, so the list stays as it is. Momentum came closest. Its portfolio figure is not a fair test of it: the
site's rules never sell a stock for dropping out of the top 20%, so most of its money ended in the fund.

**A finding after the fact (it does not count).** While looking into these results, the 15 stocks on the list with
the best quality score turned out ahead of the average stock by 4.8 points a year (t 4.6), in both halves (+4.1 and
+5.6). It was found by looking, after the planned tests failed, so it is a lead to check on new data, not a result.

### The picks the Portfolio page actually buys (PREREGISTERED.md, section 3)

The page's monthly plan does not buy the list in order of upside: it has its own long-term and medium-term picks
and puts each month's money into one place. Testing them needed each company's growth score and price trend on
every past month-end, so the replay was run again with those (version 2) after the rules for judging were
committed (87d663e). The short-term picks need relative strength and chart setups, which the replay does not have.

| | Long-term picks | Medium-term picks |
|---|---|---|
| Their 6 ideas a month, 1 year later, against the average stock | +8.1 points a year (t 2.1) | +3.5 (t 1.4) |
| The same by half (before / from December 2021) | +1.3 / +16.8 | -1.8 / +10.1 |
| 1,000 AED a month with the page's rules, a year | 11.7% (worst fall -34%) | 22.9% (worst fall -29%) |
| Random halal stocks, same rules (middle of 100) | 11.0% (8 in 10: 4.4% to 19.8%) | 14.9% (10.5% to 20.8%) |
| S&P 500 | 13.9% | 13.9% |
| First half: picks / random middle / SPY | 18.7% / 21.1% / 18.7% | 24.2% / 19.3% / 18.7% |
| Second half | 17.1% / 13.3% / 16.7% | 25.4% / 16.1% / 16.7% |
| Rule 1 | mixed | mixed |

What follows by the rules written in advance: the long-term part keeps the page's own picks (as good as the list by
rule 1), the money split follows them (half in stocks), the medium-term picks get their share of the stock money,
and the short-term picks get none until they can be tested. `lib/ltstats.js` holds these as `LONG_METHOD` and
`POOLS_WITH_MONEY`; each monthly run reports whether it still agrees (`review` in the summary).

Checks made afterwards, which the rules did not cover:

- **Robustness.** Each was re-run with 6 to 8, 10 to 12 and 15 to 18 stocks and six start months (December 2016 to
  May 2017), against 40 random portfolios each. The medium-term picks beat the random middle in 18 of 18. The
  long-term picks did in only 5 of 18 (5.1% to 17.5% a year): their result depends on which stocks happened to be
  bought in the first year.
- **Why the long-term portfolio gives back its ideas' lead.** The ideas are good (the 6 best beat the average stock
  by 8.1 points a year; all stocks passing the long-term filter, about 62 a month, by 3.2 points, t 3.0). But a
  long-term holding is almost never sold (no sale for a weaker business in 10 years), so after the first 10 to 12
  months the portfolio holds the same stocks and new money tops up whichever is smallest. Five stocks (UI, KLAC,
  META, FFIV, AYI) made more than all the gain; the other 14 lost money together. Removing the trims did not help
  (10.6%). Buying the best current idea each month instead (the rule used for the list) beat its random middle in
  18 of 18, but most of the money then ended in the index fund because few ideas had room left. This was found by
  looking, so nothing was changed; it is recorded as a lead for the monthly review.
- **Medium-term concentration.** 62 stocks were bought over the 10 years (sales at fair value make room for new
  ones); the top five (FIX, FTNT, IESC, KLAC, MEDP) made 62% of the gain.

### What changed on the site

- **Home: a daily brief.** Your stocks' value and today's move, what to do (halal screen failed, business weakened,
  above the trim price, warning filings), holdings that are down but whose business is healthy ("hold and wait"),
  what changed since your last visit, the companies' own news from their SEC filings, and ideas for new money from
  the Portfolio page's picks with what the test found.
- **Company news from filings.** Each stock page lists the last 4 months of filings in plain English (results,
  restatements, auditor changes, listing notices, late reports, large stakes, share sales), with warning signs
  marked; the daily build adds the last 14 days of filings to the screen data for the brief and the Watchlist.
- **Hold while the business is healthy.** The Portfolio page and the Watchlist say "sell" only when the business
  weakens (verdict "Avoid: weak fundamentals" or "Speculative") or the halal screen fails, and "hold and wait" for a
  fall when the business is still healthy.
- **Let the test decide.** A new answer to "Funds or stocks?" takes the split from the monthly test (now half and
  half); the Portfolio page offers it once. Medium-term and short-term shares move to the long term when their picks
  get no money (now: short term), with the reason shown.
- **Buying rule.** When every holding is near its equal share and there are already enough stocks, new money tops up
  the smallest holding (as tested) instead of starting another stock.
- **Concentration warning.** "Above 15% of everything in one company" is only shown once you hold the minimum number
  of stocks; before that, every early holding is a big share and the plan spreads new money anyway. The Portfolio
  page says so ("Only 2 US stocks, so it is still concentrated…") instead of "no concentration problems found", which
  contradicted the Watchlist's Portfolio check.
- **Record page.** A card with the 10-year test: the list, by verdict, the portfolio against SPY and random picks,
  the halves, the five other methods, and the Portfolio page's picks.
- **Your own tickers.** Any ticker can be added to the Watchlist, not only the site's list: it is tracked with the
  shares, average cost and price you enter, counted at that price in the brief, the Portfolio check and the Portfolio
  page, marked "not screened" for halal status, and given no rule-based advice (the tool has no analysis for it),
  except the size rule, which needs none: above 15% of everything once the portfolio is built, it says trim. A typed
  price older than a month asks to be updated (Watchlist and brief), because the value, the mix and the monthly plan
  use it. In the brief its ticker opens the Watchlist, since it has no stock page. The weekly review asks Claude to
  look it up. Funds are sent to the Portfolio page instead, so the plan counts them as the fund part. The sync link
  and the backup carry these tickers and their prices.
- **Weekly review.** "Start my weekly review" (Watchlist, and in the daily brief) opens a new Claude chat with the
  review instructions and the stocks on the Watchlist that day, so it follows a list that changes from week to week
  and nothing is stored outside the device. A Saturday reminder (a Claude scheduled task) points to it.

### Limits

- Companies that went bust, were taken over or fell below $250 million are missing. This flatters cheap-looking
  picks most: the list and the medium-term picks.
- Prices only: dividends are left out on every side.
- One stretch of US history (2016 to 2026), in which large growth companies did unusually well.
- Each portfolio's result rests on a handful of big winners. Read the random range, not the single figure.
- The rules for judging were fixed in advance, but the methods themselves existed before the test, so a good
  result is still one draw from one decade.

## 8. What is not validated

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

## 9. Audit and stage 1 (3 November 2026)

### Re-checks during the audit

- **Figures against the SEC's data, in separate code.** Apple's twelve-month revenue, net income, operating cash flow
  and capital spending to 27 June 2026 (annual report plus nine months, less the prior nine months) and Microsoft's to
  30 September 2026 (its 10-Q filed 28 October): 8 of 8 match the site to the dollar. Apple's cash matches exactly;
  its debt differs by $47 million (0.06%, two debt tags for the same notes).
- **Fair value.** Apple's bear, base and bull values rebuilt from the published inputs with a separate DCF: within
  $0.06 of the site.
- **Indicators.** Apple's EMA 21, SMA 50 and 200, RSI 14, MACD, signal line, ATR 14 and relative volume over the last
  100 days, recomputed in pandas: equal to the decimals the site shows.
- **Coverage.** Of 2,038 companies, 466 get no verdict, each with a stated reason (foreign filers, REITs, new
  listings, re-registered holding companies such as ExxonMobil); 162 more are withheld for insufficient data.

### Stage 1: what changed

One risk check (`buyCheck`) now decides every buy suggestion, on every page; the limits the owner approved on 3
November are its defaults and can be changed on the Portfolio page. A buy needs a clear halal "pass"; no new buys in a
stock already 10% of the portfolio or a sector already 40% of the stocks; a stock above 15% is trimmed back to about
10% once there are enough stocks; 0.5% of the portfolio at risk per swing trade (was 1%); two or more trading days of
late data pause every action. Tests: 59 formula tests (new: the simulation never buys a "review" stock, never buys
above the size or sector limit, and trims winners above 15%), 119 page checks (new: each rule on the stock page, the
brief, the Watchlist, the Portfolio advice, the monthly plan, the ideas, the limits card and the late-data pause).

### The 10-year test re-run with the limits

The rules were written down before the re-run (`PREREGISTERED.md`, section 4). The replay data is the one of 27
October; only the buying and selling rules changed. 1,000 AED a month, December 2016 to October 2026:

| Portfolio page picks | Before the limits | With the limits | Random picks, same rules (middle) | S&P 500 |
| --- | --- | --- | --- | --- |
| Long term, a year | 11.7% | 9.3% | 13.1% | 13.9% |
| Long term, worst fall | -33.7% | -38.1% | | -25.4% |
| Medium term, a year | 22.9% | 20.8% | 14.6% | 13.9% |
| Medium term, worst fall | -28.7% | -32.2% | | -25.4% |

By the pre-registered rule the long-term picks now count as "fund" (they trail random picks and the S&P 500), so the
split for "let the test decide" moves from half and half to 20% stocks and 80% fund. The medium-term picks stay
"mixed". The run also reports that the list now did better than the page's long-term picks (`review.agrees` false);
the site keeps the page's picks until a review, as section 3 of `PREREGISTERED.md` says.

Which limit did what (long-term picks, one rule added at a time, same data):

| Rules | A year | Worst fall |
| --- | --- | --- |
| Before the limits | 11.7% | -33.7% |
| Halal "pass" for every buy | 11.6% | -34.2% |
| plus the 10% limit on new buys | 16.9% | -35.4% |
| plus the 15% trim back to 10% (no sector limit) | 15.4% | -35.0% |
| pass and the 40% sector limit only | 9.9% | -37.6% |
| All the approved limits | 9.3% | -38.1% |

Read with care: one path through one decade, survivor-only data (failed companies are missing, which is exactly the
risk that limits protect against, so the test cannot credit them for it), and these are results seen after the fact.
They are a reason to review the 40% sector limit and the trim size with the owner, not a licence to pick the rule set
that scored best.

### Stage 2: the permanent record

Every nightly update now adds the day's changes in the tool's calls to the `records` branch: verdict changes, halal
status changes, entries into and out of the long-term buy zone and the trim zone, the Portfolio page's picks coming
and going, and every swing signal that appears, fills, closes or lapses (`lib/records.js`). The first file holds the
starting point (every company's verdict that day, and the calls standing then). Each file starts with the SHA-256 of
the file before it, and every day file has a state file of the same name, so an edited day, a removed day and a
removed latest day all show; the save script (`tools/save-record.sh`) refuses to push if any existing file would
change or disappear. Each night is compared with the last state saved in the record, not with the night before, so a
night that fails to save loses nothing: its changes are recorded the next night. The site is published even if the
record cannot be read or saved, and the Record page says so.

How each call did is recomputed every night, from the first close after the call was published to 21, 63, 126 and
252 trading days later, against the S&P 500 over the same dates; it is never written into the record. Rules fixed
before the first results, so they cannot be tuned to them:

- A call is filled at the first close after both its date and its publication: the day file's start time plus 5 hours
  15 minutes (4 hours from UTC to New York plus the longest build) gives the first New York day whose close is surely
  later. Normally that is the next session. The first live file shows why it matters: it is dated 30 October (the
  latest closes the data had) but was published on the evening of 2 November, so its calls count from 3 November's
  close, not from 2 November's, which had already happened.

- A company with no data for a night keeps its last state for up to 30 days, so a failed download is not a sell
  followed by a new buy call. After 30 days it is dropped, and if it returns it is new.
- The same call on the same company again within 30 days stays in the record but is not counted again in the
  results. Without this, a price hovering at the buy price would count many times.
- Every company with a call is priced each night, even after it drops below the $2B cut-off, so a company that fell
  does not quietly leave the results. Calls on companies with no prices at all (delisted, bought, a changed ticker)
  are counted and shown as left out, because leaving out a collapse flatters the results.
- Halal changes are recorded but not judged by later prices: the screen is a rule to follow, not a forecast.
- "Business weakened: sell" counts only a move to "avoid" or "speculative" from a verdict that judged the business
  sound enough to hold (strong buy, buy, possible bargain, watchlist, worth a look, pass). The second night showed
  why: it had 6 such moves, all from "not halal" (5 to "avoid", 1 to "speculative"): the halal status changed and
  revealed the business verdict that was there all along. None came from a sound business. Fixed on 3 November, before any result existed.

A dry run on a saved copy of the real site data (16 October 2026, 1,563 companies): a starting file of 2,240 events
(255 KB, 37 KB compressed) and a state file of 55 KB; the same data the next night adds nothing; one company missing
and one price halved adds exactly one event (the trim zone left) and keeps the missing company's state.

Tests: the events between two days; a night without data (no call, state and pick kept, dropped after 30 days and new
when it returns); swing signals that are new, filled, closed between two nights or lapsed, while an old closed one is
not new; an edit, a removal and a removed latest day each breaking the chain; a second file on the same day sorting
after the first; the follow-up counting only calls old enough, starting at the first close after publication (a call published after a close is not credited with it), a repeat within 30 days
counted once, the S&P 500 taken on the same dates when its own list misses a day, and calls without prices counted
as left out; the save script adding a new day and refusing a changed old one; and the nightly step end to end in a
temporary record (it writes nothing when nothing changed, and catches an edited file on the next run). The Journal now
keeps what the tool said on the day a trade is logged, and the results show trades with the tool and against it side
by side. 67 formula tests and 134 page checks pass.

Live check (3 November): the first run wrote the starting point to the `records` branch (2,279 events: 1,559
verdicts, 41 in the buy zone, 384 above the trim price, 12 picks, 283 open swing signals; one day file of 273 KB and
its state file), the chain is intact, and the Record page shows the card with every result waiting. The second run
(2 November's closes) added a second day of 406 events on top of the first, chained to it: 306 swing signal changes,
34 verdict changes, 27 halal changes (earnings season brings new quarterly balance sheets), 11 lapsed signals, 3 buy
zone entries, 9 trim zone entries and 5 new picks.

Limits: the record starts on the first night it runs, so the first one-month results arrive about a month later and
mean little until there are many calls; prices only (no dividends, no costs); results for a call are recomputed from
the price history each night (about ten years of daily prices), so matured results should be sealed into the record
too before calls start falling out of that history, which is planned with the better-evidence stage.

### Stage 6, part 1: the Portfolio plan judged on many five-year periods

The money split rule judged the plan on one ten-year path, and one path depends on which stocks happened to be bought
first: 100 random portfolios with the same rules ended between 8.3% and 19.5% a year (10th to 90th percentile). The
re-run of 3 November had the two measures disagreeing (the long-term ideas +8.1% a year ahead of the average halal
stock, the single path behind random picks). Section 5 of `PREREGISTERED.md` (committed in b9952cd before anything
below was computed) judges each kind of pick on overlapping five-year periods, one starting at each month-end, against
50 random portfolios with the same rules and the S&P 500 (`planWindows`, `decideWindows` in `lib/ltstats.js`).

Results on the replay of 27 October (2,638 companies, December 2016 to October 2026):

| | Long term | Medium term |
| --- | --- | --- |
| Ideas against the average halal stock, 1 year later | +8.1% (t 2.1) | +3.5% (t 1.4) |
| Same, first half / second half | +1.3% / +16.8% | -1.8% / +10.1% |
| Same, 2 years later (in total) | +11.1% (t 1.4) | +3.1% (t 0.8) |
| Same, 3 years later (in total) | +16.7% (t 1.0) | +3.0% (t 0.4) |
| One 10-year path: plan / random median / S&P 500, a year | 9.3% / 13.1% / 13.9% | 20.8% / 14.6% / 13.9% |
| 59 five-year periods: beat random picks / beat the S&P 500 | 64% / 68% | 92% / 93% |
| Middle period: plan / random / S&P 500, a year | 16.9% / 11.6% / 13.5% | 19.5% / 13.0% / 13.5% |
| Middle period against the S&P 500 (worst to best) | +3.5% (-8.0% to +17.9%) | +7.3% (-2.3% to +16.4%) |
| Result on one path (rule 1) | fund (20% in stocks) | mixed (50%) |
| Result on the five-year periods (section 5) | mixed (50%) | mixed (50%) |

What it means: the single path of the long-term plan started at an unlucky moment; most five-year periods did better
than random picks and the S&P 500. By the pass marks written down beforehand, the evidence supports about half of
the money in stocks, not 70%: the long-term plan beat random picks in 64% of the periods where 75% was needed, and
its ideas' lead over the average stock came almost entirely from 2022 on (first half +1.3%, t 0.3). The medium-term
plan was stronger as a portfolio (it sells at fair value), but its ideas trailed the average stock in the first half,
so it is "mixed" too. The split if you let the test decide moves from 20% stocks to 50%.

Limits: the periods overlap and all come from one decade, so they remove the luck of the starting month, not of the
decade; and the data holds only companies still listed today, which flatters every stock portfolio against the S&P
500. Still open from section 3: on one path the list (rule 1: mixed) did better than the page's long-term picks (rule 1:
fund), so the run does not agree with the fixed choice to use the page's picks (`review.agrees` false); judging the
list on the same five-year periods comes first, before any change.

Tests: the periods are counted and dated right, a plan of rising stocks wins every period against random picks and
a rising S&P 500, each pass mark is checked on its own edge (t just below 2, one half behind, 74% of periods, 49%
against the S&P 500 or random picks, ideas behind the average, no periods at all), and the report keeps the single-path
result and the 2- and 3-year results next to the periods. 68 formula tests and 135 page checks pass.

### A stray "null" on the company page (found while checking the new look)

The preview screenshots of the new design showed the word "null" under "What to do now". The browser's own `append`
and `replaceChildren` print a missing child as that word (the page's `h()` helper skips them), and stage 1 handed one
over whenever the data was up to date, so every company page showed it from the stage 1 release on 3 November until
this fix. A search of the page's code for the same slip found two more, fixed too: the Record page without five-year
results, and the Technical tab's help in the version without the site. While checking, a second fault showed up:
without chart data the closing date was read from "close on 2026-11-02" as "close on 2", which left the date blank
and made the live price look older than the close, so it was never shown.

The page tests now report any missing value handed to these browser functions on every page they open (run on the
version before the fix, the check names `paintAction`, the function at fault), and a new test opens the Technical tab
with a full chart file made by the site's own engine (`test/make-tech-fixture.mjs`) with every section open. A sweep
of every page and section, with fresh and late data and with holdings, found nothing else. 68 formula tests and 139
page checks pass.

## 10. The policy completed (3 November 2026)

### The position-size rules made exact

The owner asked for the limits to be defined exactly and applied the same way everywhere, and decided three points:
a stock above 15% goes back to 10% (as recorded), the trim applies at any number of stocks (it used to wait for 10),
and no buy may take a stock above 10% (it used to stop only buys in a stock already at 10%). The rules were written
down in `PREREGISTERED.md`, section 6, at 15:27 UTC on 3 November (commit 3c8b285); the re-run below finished at
15:35 UTC. They are policy, chosen for risk; the comparison shows what they did and is not evidence for the strategy.

One copy of the rules (`lib/policy.js`) runs the 10-year test, and the page carries the same text; a test fails if
the two differ by one character. Every page now uses it: the monthly plan (each buy capped, what is left goes to the
next stock or the fund), the stock page (what to do now, and how much room is left), the Portfolio page (trims at any
number of stocks, with the amount to sell; "Add" with the room left), the daily brief and the Watchlist (the same
trim; the Watchlist's own check of 40% of holdings and 50% in one sector is replaced by your limits), and the
Shortlist (buy candidates your limits block are marked).

| Case | Before (version 1) | Now (approved) |
| --- | --- | --- |
| A stock you do not hold | any buy | up to 10% of everything you own, after the buy |
| A stock at 9.9% | a full month's buy, so it could end at 11% to 14% | room for 0.1% of the portfolio: bought only if that is $100 or more |
| Exactly 10% | no new buys | no new buys |
| Between 10% and 15% | held | held |
| Exactly 15% | not trimmed | not trimmed |
| Above 15%, 10 or more stocks | trimmed back to 10% | trimmed back to 10% |
| Above 15%, fewer than 10 stocks | not trimmed (a warning) | trimmed back to 10% |
| A sector at 40% of your stocks | no new buys | no new buys (unchanged) |
| An order under $100 | not made | not made, for buys and trims |

The 10-year test with both versions, on the replay data of the published run of 3 November (the local run of version
1 reproduced that published summary exactly, apart from its timestamp):

| | Long term, version 1 | Long term, approved | Medium term, version 1 | Medium term, approved |
| --- | --- | --- | --- | --- |
| One 10-year path, a year | 9.3% | 11.8% | 20.8% | 20.6% |
| Random picks, same rules (median) | 13.1% | 12.9% | 14.6% | 14.9% |
| S&P 500 | 13.9% | 13.9% | 13.9% | 13.9% |
| Worst fall | -38.1% | -32.9% | -32.2% | -29.8% |
| Money the limits sent to the fund | 0% | 2.5% | 0% | 5.3% |
| 59 five-year periods: beat random picks / the S&P 500 | 64% / 68% | 66% / 73% | 92% / 93% | 97% / 95% |
| Middle period against the S&P 500 (worst to best) | +3.5% (-8.0% to +17.9%) | +4.0% (-6.7% to +21.2%) | +7.4% (-2.3% to +16.4%) | +6.6% (-1.9% to +13.4%) |
| What the evidence supports (section 5) | half in stocks | half in stocks | half in stocks | half in stocks |

What it means: the split the evidence supports does not move: half in stocks. The long-term path did better mainly
because version 1 let buys overshoot 10% and then had to trim; that is a reason the new rule is cleaner, not a reason
to trust the picks more, since a better backtest under rules picked for risk is still one decade of survivor-only
data. No experimental variant was run for this change.

Tests: 71 formula tests (new: every boundary of the rules, 5, 10 and 15 stocks, the page copy identical to
`lib/policy.js`, trims at any number of stocks, the three rule sets kept apart) and 187 page checks (new: the same
boundaries in the browser, the risk check at 9.9% and 10%, 5, 10 and 15 stocks on the Portfolio page, the monthly
plan's cap and a portfolio too small for a stock, the room on the stock page, the limits card, your split next to the
evidence, the rule sets named on the Record page, and holdings recorded by hand). The page tests now also fail on
any missing value handed to the browser's own append functions.

### Your split and the evidence, kept apart

The Portfolio page shows your split (70% stocks, your choice) next to what the 10-year test supports (50%) and
explains the gap, and no longer invites you to hand the split to the test; the Record page says the evidence is not
your plan and names the rule set behind each number, with the original rules kept apart.

### Holdings recorded by hand

Stage 3 no longer reads broker statements. A stock you own is recorded on its page ("I own it": shares, average cost,
the date you bought it if you like) or on the Portfolio page ("Add a stock you own", which also takes tickers the site
does not cover, at a price you type). Both write the same Watchlist entry that every page and every limit check reads,
so nothing is counted twice.

Live check (3 November, 16:10 UTC): the reviewed commit went live unchanged (main fast-forwarded to it), the page
tests passed in CI, and the 10-year summary was rebuilt in CI with the approved rules from the same replay data. It
matches the local run exactly: long term 11.8% a year, worst fall -32.9%, 66% / 73% of the five-year periods;
the evidence still supports half in stocks.

## 11. Stage 6, part 2: system health (3 November 2026)

The nightly build writes `data/health.json` (`lib/health.js`): companies analysed against the list it started from
(97% and up fine, 90% to 97% a warning, under 90% a problem; under 80% the site is not published at all), failed
downloads by name, companies without a price history (a warning above 5%, a problem if the source stopped
answering), verdicts withheld, the halal screen's counts, earnings dates, whether the S&P 500 data is as recent as the
companies', the 10-year test (a warning if it is missing, more than 40 days old, or run with an older version of the
rules) and the permanent record (a problem if a file does not match its fingerprint). The Record page shows these
first, with two checks only the device can make: how late today's prices are, and whether last night's record
reached GitHub. Display only; no advice depends on it.

Tests: every threshold on its boundary (97.0% and 96.95%, 5% of price histories, 40 days, the rules version, a
broken chain, a skipped night) and the card on a normal night, with the record not saved, with a broken record, and
with no report at all. 72 formula tests and 195 page checks pass.

Corrected the same evening, after the first live night: the earnings line counted every company on the calendar
(3,255, more than the 2,013 analysed). It now counts the companies analysed that report in the next 12 weeks, and the
halal line shows the companies the tool cannot screen, so its four numbers add up to the companies analysed. Tested
with the numbers adding up, no empty group, and one failed calendar day.

## 12. Stage 6, part 3: the hold call, measure 4 of section 7 (3 November 2026)

Section 7 of PREREGISTERED.md says this call is recorded from the first nightly run after it is in the code, so it
comes before the other measures, which can all be worked out later from what the record already keeps. The record
(`lib/records.js`, now version 2) keeps the first buy call of each company (the buy zone or a Portfolio page pick)
with its price and date. When the stock is 20% or more below that price while its verdict stays sound (the same
verdicts that make a later weak verdict a sell call) and it does not fail the halal screen, the record adds a hold
call, judged like a buy: did it beat the S&P 500 afterwards? A weak verdict or a halal fail ends the wait (the rule is
then no longer to hold), and so does the hold call itself; a later buy call starts a new one. The fall is measured on
split-adjusted closes from the close of the buy call's day, so a split is not taken for a fall, and with no closes
that night no call is made. The record's first three days were written before this list existed, so the list is
rebuilt from their day files on the first run, with the same rules.

Tests: 19.99% down is not a call and exactly 20% is; one call per buy call; a weak verdict, a halal fail, a new buy
call after them; a missing company keeps its wait for 30 days; the list rebuilt from day files equals the one kept
night by night; the nightly step on a record whose last state has no list; a 2-for-1 split; no closes. 73 formula
tests and 196 page checks pass.

## 13. Stage 6, part 4: the random-stock yardstick, section 7.1 (3 November 2026)

Pre-registered first (PREREGISTERED.md, section 7.1, its own commit), then built. Every figure on the Record page now
has the same figure for every company that passed the halal screen on the day of the call (from that day's state
file), followed from the same close over the same days (`lib/records.js`: `yardstick`, used by `followUp`). Each cell
says whether the gap is more than noise: a 90% interval from resampling the days of the calls, 2,000 times with a
fixed seed, and no verdict from calls on fewer than 5 days. Measures 1, 2 and 4 (how often each kind of call went
wrong over 12 months) are shown from 30 matured calls, next to the same share for the yardstick; until then the page
says how many calls have had their 12 months. The calls' own figures did not change: the code that follows a call was
moved into one function shared with the yardstick, and the earlier tests pass unchanged, except that a close of zero
is now skipped instead of read as a 100% loss.

One known bias: a company that passed the screen on a past day but is no longer analysed and has no call of its own
has no prices, so it drops out of the yardstick. That leaves out some companies that collapsed or were taken over,
which makes the yardstick look better than it was: buy and hold calls are then judged a little harshly, sell and trim
calls a little kindly.

Tests: the yardstick of one day (a company without prices left out, the tail shares), six calls each paired with its
own day, the gap and an interval above zero when the calls always win, no interval from 4 days, an interval across
zero when half the calls win and half lose, the same interval from the same record, the nightly step reading each
day's state file (a company that failed the screen that day is left out), and the page with each verdict and with the
wrong-call shares. 75 formula tests and 199 page checks pass.

## 14. Survivorship: which companies the benchmarks cannot see (3 November 2026)

Asked for by the owner: can taken-over, delisted and bankrupt companies be included in the halal-pass benchmark?

The 10-year test holds only companies listed today (`tools/lt-backtest.mjs` builds its list from today's listings).
To measure what that leaves out, `tools/survivorship-check.py` takes every company with a public float of $250 million
or more on its mid-2016 10-K cover page (the SEC's XBRL frames), and follows each one through its SEC filing history.
Of the 1,485 non-financial companies (banks, insurers and REITs left out, as the tool does):

| What happened by November 2026 | Companies | Share |
| --- | ---: | ---: |
| In the 10-year test | 832 | 56.0% |
| Taken over or merged (merger proxy, tender offer or Rule 425 filings) | 422 | 28.4% |
| Bankrupt (8-K item 1.03) | 52 | 3.5% |
| Delisted or deregistered, reason not filed, or stopped filing | 32 | 2.2% |
| Still files with the SEC, no listed shares | 78 | 5.3% |
| Listed, public float now under $250 million | 39 | 2.6% |
| Listed, missing for another reason (another exchange, a changed ticker) | 30 | 2.0% |

So 44% of the companies an investor could have held in 2016 are missing from the test. They cannot be added with free
data: the SEC keeps their filings, so their halal screen and fair value could be worked out, but the free price
sources the site uses (Nasdaq, Yahoo) drop a company's prices once it is gone. Full coverage needs a paid
survivorship-free database (for example CRSP, Norgate or EODHD), which the plan does not use. The missing companies
pull in both directions: takeovers usually come at a premium, while bankruptcies and shrinking companies lose most of
their value. The research on missing delisting returns finds the losses dominate: Shumway (1997) found the omitted
returns large, and Shumway and Warther (1999) estimated -55% for the missing performance-related delisting returns of
Nasdaq stocks. So the test's own returns are most likely flattered. Random halal stocks are drawn from the same
companies, so the comparison with them is affected less, but not free of it.

A second, smaller bias comes from choosing companies by today's size: a company small in 2016 that grew is in the
test. Keeping only companies that were large enough at the time hardly changes the base rates (trailing the S&P 500
by more than 10 points: 45.0% with every company, 45.3% at $250 million or more at the time, 44.4% at $2 billion or
more) but lowers the average 12-month return against the S&P 500 from +1.8 to +0.2 and -1.0 points.

What is done about it: the Record page shows the table's figures next to the 10-year results, and the permanent record
now keeps its own prices (section 15), so it does not have the gap. A version of the 10-year test that applies the
size cut at each past date, and so adds the shrunk companies, is a candidate for review; it would change the evidence
shown, so it would be compared and shown first, as any decision-changing change is.

Sources: [Shumway (1997), The Delisting Bias in CRSP Data](https://econpapers.repec.org/RePEc:bla:jfinan:v:52:y:1997:i:1:p:327-40);
[Shumway and Warther (1999), The Delisting Bias in CRSP's Nasdaq Data](https://ideas.repec.org/a/bla/jfinan/v54y1999i6p2361-2379.html).

Correction, 6 November 2026: the sentences above that call the test's own returns "most likely flattered" and the
comparison with random halal stocks "affected less" go further than the evidence. The research cited covers delistings
for poor performance, not takeovers, the largest missing group (28%), and nothing measures which missing companies the
picks or random picks would have held. The wording now used everywhere (PREREGISTERED.md, section 7.3.2) says that
neither the direction nor the size of the effect can be measured with free data, and explains how it can differ
between the picks and random halal stocks. The same applies to earlier sections of this file that give the missing
companies a direction.

## 15. Section 7.2 in the code: every call measured to the end (3 November 2026)

Written down first (PREREGISTERED.md, section 7.2, its own commit), then built in `lib/records.js`:

- Horizons are counted in sessions of the S&P 500 from the entry session, and the stock's price at a horizon is its
  last close on or before that session (before, sessions of the stock itself; the same for any stock that trades
  every day).
- The record keeps its own price archive (`prices/YYYY/YYYY-MM-DD.json` on the records branch, one file a night,
  never replaced, a second run that day adding only what the first did not have): the close of every company in a
  call or in a yardstick of the last 400 days, and the dividend histories read. A company the sources no longer give
  is followed from the archive, and once it has had no close for 10 sessions of the S&P 500 it is treated as stopped:
  its return runs to its last close, then 0%.
- A call with no prices anywhere is unpriceable: at every horizon that has come it counts as wrong and is left out of
  the averages.
- Dividends: the code reinvests them at the ex-day close and counts them at a horizon only when both the stock's and
  the S&P 500's histories were read on or after its session; otherwise prices only for both, and the page counts those
  calls. No source is switched on, because none of the site's free sources gives them reliably today: Yahoo's chart
  data refuses the site's requests (429, too many requests), and Nasdaq's dividend history gave none for companies
  that pay every quarter (Coca-Cola, Procter & Gamble, Johnson & Johnson, and the S&P 500 fund itself) while giving
  full histories for Nasdaq-listed ones such as Microsoft (checked on 3 Nov 2026). A source that reads only some
  companies would bias the comparison, so every call is measured on prices only, for the stock and the S&P 500 alike,
  and the page says so. If a reliable source is added later, it is written down as a dated amendment and applied to
  every call, old and new, with the prices-only figures kept next to it.
- The Record page shows each kind of call after 12 months, from 30 matured calls: return, S&P 500, difference, random
  halal stocks, wrong calls next to the random share, the calls that stopped trading, had no prices or were measured
  on prices only, and pass, fail or undecided (provisional until 100 calls).

Tests: a company that stops trading (followed to its last close, then cash), one only a few sessions behind (it
waits), an unpriceable call (wrong, out of the averages), dividends reinvested at the ex-day close, a dividend history
read too early (prices only for both), the archive (the first observation of a day is kept, a second file adds only
what is new, dividends merged), the companies tracked, a company followed from the archive after the source dropped
it, and the page with each verdict. 77 formula tests and 201 page checks pass.


## 16. Section 7.3 in the code: how sure a result is, and one switch for dividends (6 November 2026)

Section 7.3 was written down first (its own commit, 3 November, before any call had reached its first month); the
details the code needed were added as 7.3.1, the owner's neutral wording on the missing companies as 7.3.2, and the
test that replaced the resampling as 7.3.3, all before any result. Built in `lib/records.js`; record and display only.

**The final checks before release, and what showed each one:**

| Check (the owner's, 6 November) | How it was confirmed |
| --- | --- |
| Only the six 12-month kinds can pass | `judgeKinds` gives verdicts only to the 12-month results of the calls made since the start; tests check that the 1, 3 and 6-month reads and the calls standing on day one never get one, and that the family is exactly buy, long-term pick, medium-term pick, trim, sell and hold |
| The Holm correction is right | 3,000 random sets of six p-values (tiny, borderline and large, some kinds not testable): the kinds that pass are exactly those an independent Holm step-down at 2.5% allows, every time; the strictest threshold is 2.5% / 6 = 0.42% |
| Company and time dependence are allowed for | Failed at first, then fixed (below) |
| At least 24 distinct months | 23 months is too short, 24 is enough (tests) |
| 30 matured calls, provisional below 100 | one set of numbers (`THRESHOLDS`) in the record and on the page; tests check both |
| A 90% warning is never shown as skill | the warning reads "under review (a warning, not a verdict on skill)"; early reads say "early read, not a test of skill"; the 12-month column shows each kind's tested verdict, never the 90% interval's direction (page checks) |

**The dependence check, and why the method changed before going live.** `test/validation/stats73-null.mjs` builds
records with no skill at all but with the dependence real calls have (a company's lasting difference from random stocks,
what calls in the same 12 months share, call-by-call luck; about four calls a month; a few companies called far more
often), in six versions from mild to harsh, over 36, 60 and 120 months, and judges them exactly as the Record page does.
The resampling first approved (months in 12-month blocks and companies, the larger p-value) passed at least one of the
six kinds by chance in 10% to 46% of records, against the 2.5% section 7.3 promises: with overlapping 12-month periods,
a few years of calls hold only a few independent periods, and resampling them understates the uncertainty. The two-way
test of section 7.3.3 (cohorts of call months and companies together, Student's t with the smaller effective number of
cohorts or companies, less one, as degrees of freedom) passed a kind by chance in 0% to 1% of records, in every version
(300 records a cell), and in at most 1.7% over 120 and 240 months (1,000 records a cell: `node
test/validation/stats73-null.mjs 1000 20261106 120,240 live`). With no skill, it put 1.4% to 1.5% of kinds under review
over 60 months (about 5% expected from a 90% interval). Its price is power: a true edge of 10 points a year in one kind
passes in 27% to 28% of ten-year records and in under 1% of five-year ones; 15 points, in 71% to 76% of ten-year records.

| Records with no skill: a kind passes by chance | 36 months | 60 months | 120 months |
| --- | ---: | ---: | ---: |
| Live test (7.3.3), harshest version | 0.0% | 0.0% | 1.0% |
| Resampling approved on 3 November, replaced | 10% to 46% | 11% to 31% | 10% to 24% |

**Also in this release:**

- The previous method (sections 7.1 and 7.2: the 90% interval from resampling the days of the calls, a pass when it is
  wholly on the good side and the wrong calls are no more common than random halal stocks') is still worked out each
  night and shown beside each 12-month verdict, labelled "for comparison only". On a simulated record its figures match
  the code it replaces exactly (472 of 472 figures, and the same verdicts).
- `TOTAL_RETURNS`, off: dividends are used nowhere, for the calls, random halal stocks and the S&P 500 alike, so the two
  kinds of return are never mixed. The archive keeps any dividend history it reads. Turning it on needs a dated
  amendment.
- The missing companies are described neutrally everywhere on the page (section 7.3.2): measured gap, how it can
  affect the picks and random halal stocks differently, and that neither its direction nor its size can be measured
  with free data. Section 14 has a dated correction. The 10-year test's 59 overlapping five-year periods are said to
  hold about two independent spans.
- Calls whose prices are missing tonight are described as the rule treats them (counted, and wrong at every horizon
  that has come), instead of "left out".

Not changed: anything that makes or sizes a recommendation. The calls themselves (what is recorded each night),
valuations, buy zones, sell and trim decisions, the halal screen and the risk limits come from code this release does
not touch (section 18).

Tests: 80 formula tests and the page checks pass (section 18 has the run).

## 17. The Treasury-linked discount rate study, closed (6 November 2026)

Pre-registered in PREREGISTERED.md, section 8, run once on its own branch, with the result and the owner's decision in
section 8.1. Before the run, the fixed-rate side of the study was checked against the published 10-year test: the
study's job and the 10-year job gave the same rows for MSFT and KO (120 months each, byte for byte), and on the
10-year data of 3 November the comparison gave the fixed rates exactly the published plan result (11.84% a year,
worst fall 32.88%, the same 59 five-year periods). Run 1 (4 November) valued every month-end of 2,634 companies under
the fixed rates, the linked rate and six sensitivity rules, and the linked rate failed all six conditions. On
6 November the owner closed the study: the fixed 8%, 9% and 10% stay, and no variant is adopted, the 6.5% floor
included. The study's code never left its branch; the write-up, the comparison's full output and the yields it used
are kept in `studies/rate-study-2026-11/`, and the raw data under the tag `rate-study-run-1`.

## 18. Release checks: section 7.3 changes the evaluation only (6 November 2026)

The owner approved section 7.3 for release as an evaluation-only update: it must not change recommendations, buy
zones, sell decisions, valuations or risk limits. Four checks against the version live before it (main at
`594afce`), each a script in `test/validation/` that can be run again.

**1. Which code changed** (`changed-code.mjs`: every function parsed, named by where it sits, and its own code
compared with the code of the functions inside it set apart, so a change is pinned to the function that holds it).

| File | Result |
| --- | --- |
| `lib/engine.js`, `policy.js`, `longterm.js`, `ltstats.js`, `data.js`, `health.js`, `signals.js`, `technical.js`, `backtest.js` | identical |
| `tools/` (all seven files) and the three workflows | identical |
| `index.html` | 9 of its 989 functions changed, none added or removed; the markup and the constants unchanged |
| `lib/records.js` | the follow-up and the nightly summary changed; the test, the verdicts and the previous method added |

The nine functions in the page: the permanent-record card (`recordCard` and four functions inside it), the notes of
the 10-year test card (`ltCard`) and of "Read this before trusting the numbers" (`limitsCard`), and `windowsLine`,
which gains one sentence on the five-year periods. None of them makes, sizes or pauses a recommendation.
`lib/records.js` feeds nothing that gives advice: only the nightly build imports it, to write
`data/record-summary.json`, and the page reads that file only on the Record page, for the health card (unchanged)
and the permanent record. In it, `gapInterval` became `dayInterval` with its code unchanged; `trail`, `yardstick`
and `followUp` gained the dividends switch, off; `finish` and `updateRecord` add the test of section 7.3.3 and the
verdicts.

**2. Same data, same advice** (`same-advice.py`): the live page and the new page given identical data in five
situations, with every page opened in each: holdings with new filings; a profile with limits, a sector already full
and a stock under halal review; half in stocks with swing trades; prices six trading days late, so advice is paused;
unreliable company data. 30 page views, 217 sections, about 209,000 characters.

- The Stock, Shortlist, Watchlist and Journal pages are identical word for word in all five situations, and so is
  the Portfolio page without a profile: 21 of the 30 page views.
- The Record page: only the three evaluation cards differ (the permanent record, the 10-year test card and "Read this
  before trusting the numbers"); its other ten sections are identical.
- The Portfolio page: "Your target mix" and "Holding periods" differ only by the added sentence ("The periods overlap:
  together they hold about two independent five-year spans, and companies that disappeared since 2016 are missing.").
  With it taken out, all six such sections are identical character for character.
- The check catches a real change: with the trim target made 10% lower in one function, it failed at once ("sell
  about $561.66" became "$573.89").

**3. Same record, same figures** (`same-figures.mjs`): one synthetic record of 400 nights (60 companies whose prices
wander and whose verdicts change: 490 calls, 182 of them with their 12 months) run through the live `lib/records.js`
and the new one. All 837 figures the live version reports come out the same: returns, the S&P 500, random halal
stocks, beat rates, wrong calls, the counts and the previous 90% interval, which is now kept beside the new test
(`y.prev`). What the release adds is new; nothing already measured is rewritten.

**4. Tests**

| Run | Formula tests | Page checks |
| --- | ---: | ---: |
| On this computer, before merging | 80 of 80 | 206 of 206 |
| GitHub, on the release commit `10ab6c3` (Update site, run 71) | 80 of 80 | 206 of 206 |

Run 71 then built and deployed the site, with the build, the page tests and the deploy all passing and the night's
record saved with its chain intact. The live page is the release commit's `index.html` byte for byte, apart from the
three changes every build makes (static mode, the safe-area padding and the no-indexing tag). The live
`record-summary.json` carries measures version 4, the thresholds above and a verdict only on the six 12-month kinds,
all "waiting" since no call has reached 12 months yet. The simulation results are in section 16.

The previous method and its results stay available: the page shows the previous verdict beside each new one, the
nightly summary keeps its figures (`y.prev` and `previous`), PREREGISTERED.md sections 7.1 and 7.2 are unchanged
(sections 7.3 to 7.3.3 and 8.1 were only added), and the last version before this release is `594afce`.

## 19. Deployment safety: a way back, a permanent log and a data-problem warning (6 November 2026)

This release changes how the site is published and adds a warning. It changes no advice, valuation, buy zone, sell
decision, risk limit, Sharia rule or performance method, and it never writes to the recommendation records.

**What it does**

1. **A warning when the nightly data is bad.** Every page that shows advice (stock, shortlist, watchlist, advisor,
   journal) shows a banner when the health report has a failed item. It names each failed check, says what that can
   mean for the advice, separates "prices late" from "prices not late", and says plainly that advice is not paused.
   The Record page already shows the full card, so the banner is not repeated there. Display only.
2. **A verified restore point before every deployment.** The version that is live is kept as a restore point (a
   manifest of the commit, the SHA-256 of every file and one fingerprint of the whole folder, plus the files). Before
   a deployment the pipeline finds the restore point of the live commit through the deploy log, downloads it and
   re-checks it: every file hash in both directions, the file count, the fingerprint, that the site's own health file
   names the claimed commit, the same security and integrity checks as a new build, and that the deploy log witnesses
   it. If any check fails, or none is found, the `restore-point` job fails and the gate blocks the deployment. After a
   deployment that checks out live, the new live version becomes the next restore point (kept 45 days; the rule is
   at least 30). If the live check fails after a deployment, the pipeline redeploys the verified restore point.
   The first restore point is the version live before this release, commit `3506f0f`, made by run 42231862362
   (fingerprint `321af507b307101dfe7ae3ee7dabd1d9c9e4dfc3fd71c09984892fdb7cd7902a`, 4,059 files).
3. **A permanent deployment log.** The `deploy-log` branch holds one JSON file per run under `entries/`, each carrying
   the hash of the one before it. An entry names the analysis commit, the build (time, price date, site fingerprint),
   the record files written with their hashes, each gate result, the deployment result, the live check, any rollback
   and the restore point used and made. One field, `status`, says separately whether the recommendations were
   recorded and whether they were deployed: `recorded_and_deployed`, `recorded_not_deployed`, `not_recorded_deployed`
   or `neither`. The log is only added to (a check refuses any change to an earlier file), and a GitHub ruleset on the
   branch refuses deletion and non-fast-forward pushes. Branch runs only rehearse an entry and never push it.

**How to repair and rehearse**

- If a ledger job fails after a deployment, the next run's `restore-point` job blocks (the live version then has no
  witness). Repair: re-run the failed ledger job; it appends the missing entry.
- After the first successful deployment from `main`, run the manual workflow `Restore drill`. It finds and verifies the
  saved version, redeploys it, checks the live site serves that commit, and writes a `drill` entry. Run it again
  after any change to the pipeline. The next normal run puts the current version back.
- To remove the ruleset: Settings, Rules, Rulesets, "deploy-log is append-only".

**Checks before release**

| Check | Result |
| --- | --- |
| Formula and tool tests, GitHub, commit `38fd4f3` (Update site, run 81) | 176 of 176 (80 formula, 46 gate and site, 50 restore point and log) |
| Page checks, same run | 292 of 292, including the banner on all 6 pages for 5 bad cases and the no-banner cases |
| Workflow contract test, same run | passed |
| Secret scan, same run | passed, 81 tracked files |
| Same advice, before and after (`test/validation/same-advice.py`) | 54 of 54 scenarios identical; the `lib/` files are byte for byte the same; the only function-level difference is the banner code |
| Restore point checks, GitHub (Simulate restore protection failures, run 42235226843) | the real restore point verifies; 12 deliberate breaks were each caught (a byte changed, a file deleted, a file added, another commit named, wrong expected commit, wrong expected fingerprint, a manifest hash edited, no manifest, no witness in the log, an edited log entry, a removed log entry, the live site unreadable) |
| Deploy log, same run | a dry run leaves the log head unchanged; a force push and a branch deletion on `deploy-log` were both refused by the server |
| Full pipeline on the branch, no breaks (run 42235063378) | every required job passed, the gate passed, deploy, live check and rollback were skipped (branch), the ledger job rehearsed entry 1 and did not push |
| Deployment blocked when the restore point cannot be verified (run 42237339668, branch `sim-block`, one line changed so the live site is looked up at a page that does not exist) | `restore-point` failed ("No verified restore point for the live version: the live site's data/health.json answered 404"); the other five required jobs passed; the gate printed "BLOCKED restore-point: failure" and failed; deploy, live check and rollback were skipped; the rehearsed log entry was not pushed |
| Branch testing cannot change permanent state | before and after the run: `records` `768a882`, `main` `3506f0f`, `deploy-log` `a053ff0` and the latest Pages deployment (`3506f0f`) were all unchanged; the record step reported `not_run` |

### Release outcome: first deployment from main, 6 November 2026

`deploy-safety` was merged into `main` by fast-forward (`3506f0f` to `72047e9`, no merge commit). The first run on
`main` (Update site, run 42240679957) behaved as follows.

| Step | Result |
| --- | --- |
| Attempt 1: tests, security, restore point, build, site check, gate | all passed; the restore point for the live version (`3506f0f`, fingerprint `321af507...`) was verified before anything was replaced |
| Attempt 1: Pages deployment | **failed**: GitHub Pages stayed in "syncing_files" for the full 10 minutes and the deploy action cancelled it. The live site stayed on `3506f0f`. The cause is not known; it looks like a GitHub Pages delay, not our code, and is not confirmed |
| Attempt 1: deploy log | entry 1 `recorded_not_deployed` (the night's record was saved, the deployment failed, nothing live changed) |
| Attempt 2 (re-run of the failed deploy job only, the same gated package, no rebuild, no code change) | deployed in about 4.5 minutes (normal is 9 to 33 seconds); the live check passed, `72047e9`, prices of 5 November, health ok |
| Attempt 2: deploy log | entry 2 `recorded_and_deployed`; it repeats the record files saved in attempt 1, because attempt 2 wrote none |
| New restore point | commit `72047e9`, 4,003 files, fingerprint `b8ad70500f6bb8e0f134be67a361521d5d573b47880462c0beacdbe4f3549f63`, made by run 42240679957, kept 45 days |
| Restore drill (run 42250260119) | found and verified the restore point of the live version (`72047e9`), re-checked every file hash and the fingerprint, redeployed the identical saved files without rebuilding, and the live site served `72047e9` afterwards (built 15:16 UTC, unchanged); entry 3 `drill` `recorded_and_deployed` |
| Afterwards | deploy log intact (4 entries, add-only); permanent record chain intact (11 day files, every link and every day/state pair checked with the project's own checker; the night's addition was two new files and nothing existing changed); `lib/`, the pre-registered rules and the studies are byte for byte what they were before the merge |

Limits of this check: the drill verified the stored copy file by file immediately before redeploying it, and the live
site was checked by commit and build time; the live files were not independently downloaded and hashed from outside.
To repair a deployment that fails again: stop, do not rebuild, re-run only the failed deploy job once, and read the
deploy log entry. Temporary test branches (`seed-restore-point`, `sim-restore`, `sim-block`) were deleted.


## 20. Stage 4: the Shariah compliance ledger (6 November 2026, merged into main as c99218a and live)

The ledger records what Zoya shows for each stock you hold. After the owner's four decisions of 6 November it also does
two jobs it did not do before: it **blocks new buys** of a stock without a current Zoya compliant record, and it
**counts the 90-day exit period** only from a confirmed compliant-to-non-compliant change. It still decides nothing
about Shariah compliance: **Zoya stays the final authority**. The ledger holds what you copied from Zoya, with the date,
the source and the evidence, and the gate only reads it.

**The four decisions, as built**

1. **Purification is off.** The earlier estimate (the "Purification" figure on the Portfolio page, the calculator on every
   stock page, the "impure share" text and the "Purify dividends with the calculator" lines) is removed. Where it was,
   the page says purification is inactive and pending a method confirmed by a qualified Shariah scholar. No purification
   amount is calculated, estimated or displayed anywhere. The ledger can still store an amount a scholar or other named
   source gave you, with who gave it; those records are kept exactly as entered, counted but never added up or
   interpreted. Records already kept are not touched.
2. **Gate on new buys.** A new buy passes only when the stock's newest ledger check is from Zoya, says compliant, is
   90 days old or less, and the ledger itself passes its own integrity check. Anything else blocks the buy and the page
   says why in plain words: no record; nothing from Zoya; a newer entry that is not from Zoya; Zoya shows not
   compliant; Zoya showed questionable; the check is stale or dated in the future; the date could not be read; or the
   ledger failed its check. The gate is applied inside the one risk check that every buy surface already uses (the
   Advisor plan, ideas, holding advice, the stock page long-term and swing answers, the Shortlist and the Watchlist), so
   no surface can show a buy the gate has blocked. The gate never decides compliance: it only requires that a Zoya
   record exists, says compliant and is current. It never sells, trims or changes a hold.

   **Blocked stock money is held as cash (change of 6 November, second round).** The approved allocation is 70% stocks
   and 30% funds. When the gate keeps stock money out of stocks, the monthly plan no longer sends it to the index fund,
   a sukuk fund or anything else. It shows a line "Held as cash: Shariah ledger" with the amount, names the stocks held
   back and the reason for each, and says that a current, verified Zoya-compliant record in the Shariah ledger is
   required before that part of the stock allocation can be used. The target mix and the portfolio figures are not
   touched. How it is worked out: the plan is computed twice, once with the gate and once as if every ledger record were
   current and compliant (a measuring stick, never shown). The stock money the gate keeps out is the difference between
   the two. Whatever your size and sector limits leave over is treated exactly as before, so with the gate passing
   nothing changes. The fund amount is therefore the same whether the ledger is empty, stale, non-compliant or
   compliant, and it can never rise because of a blocked stock buy. When a record is entered and is current and
   compliant, the normal plan returns (tested to the cent, including on the same page after entering it). The held cash
   is not tracked between months: it stays your cash, and because stocks stay behind the target the plan keeps pointing
   new money at them once the record is in.
3. **The 90-day exit period.** The countdown starts only for a stock that had a Zoya compliant record and then a Zoya
   non-compliant one, and only from the confirmed status-change date you entered. A first-ever non-compliant record, a
   missing change date, a stale check, a questionable result or a record not from Zoya starts no countdown and
   triggers no sale. The page says "the 90-day countdown has not started" and why. There is no fallback to the check
   date. The compliance history and every date stay in the append-only ledger.
4. **Validation** is below. It was merged only after the owner's approval of commit c99218a (see "Merge and deployment" at the end of this section). Stage 5 was not started.

**What it records and flags (unchanged from the first Stage 4 build)**: status (compliant, non_compliant, questionable),
the date verified, the source (Zoya app, Zoya website, Zoya report, or "not Zoya", which counts for nothing), required
evidence; a recheck every 90 days with a "due soon" flag 14 days before; transition detection; exit tracking (not
started, in progress, completed) with flags for a missed deadline, a late exit and an exit marked completed while the
stock is still held; an append-only SHA-256 hash chain with corrections that strike an entry through; an anchor kept in
a second key and in the backup; and flags for missing, stale and uncertain data. The ledger lives on your device (saved
in the browser, carried in the backup file) because holdings are not in the public repository.

**What did not change.** Every file in `lib/` is byte for byte the same as on main except the new
`lib/shariah-ledger.js` (SHA-1 compared, git object hashes). Valuation, recommendation rules, the portfolio risk limits,
the performance methodology and the policy files are untouched. The only workflow change is one extra step that runs
the ledger tests (`test/workflow.test.py` checks it). In `index.html` the lines removed from main are: the purification
estimate and calculator, the text that sent you to the calculator, the buy risk check and the surfaces that show its
result (which now also report a ledger block), and the lines for the backup, page list and Portfolio card order. No
formula, threshold, limit or signal was edited. No paid service, subscription, API key or recurring cost was added: the
ledger is local code with no network call, and the secret scan passes.

**Evidence** (all run on the branch before commit)

| Check | Result |
|---|---|
| Ledger tests (`test/shariah-ledger.test.mjs`) | 40 of 40 |
| Do those tests fail when the logic is wrong? | 16 deliberate breakages of the gate, the countdown and purification (stale at 91 or 89 days, integrity check ignored, missing record passes, a status not from Zoya counts, a newer non-Zoya entry ignored, non-compliant or questionable or future-dated or unreadable-date passes, oldest check used, countdown from the check date, countdown without an earlier compliant record, 91-day window, purification marked active, purification records dropped): all 16 caught. The 18 library breakages from the first build were not repeated; the tests that caught them are unchanged except where the countdown rule changed |
| Page tests (`test/page.test.py`) | 466 of 466: the existing buy-logic tests now run with a seeded compliant Zoya record, plus new tests for every gate outcome on the plan, ideas, holding advice, stock page, Shortlist and Watchlist, the countdown cases on the ledger page, purification off everywhere, and preserved purification records; and for the held-cash plan: valid records (stocks bought, nothing held), an empty ledger, a ledger with other tickers only, stale, non-compliant, questionable and non-Zoya records (the whole stock part held as cash, the fund amount unchanged to the cent, the month's total unchanged, the reason and the Zoya requirement shown, no index-fund wording, the target mix and portfolio figures identical), one stock cleared and the others held, the plan returning to the normal one after the record is entered, a plan where the fund has its own share, and a stocks-only plan |
| Other node suites and workflow rules | formulas 80 of 80, deploy safety 46 of 46, restore and log 50 of 50, workflow rules all hold |
| Secret scan | 83 tracked files, no credentials found |
| Same advice, ledger current (`same-advice.py --ledger=current`, old = main) | 54 page views compared (395 sections, 378,007 characters): 29 identical word for word; every other section differs only by the purification sentences, the sentences pointing to the ledger, or the new ledger card, checked in order character for character. No unexpected difference |
| Same advice, ledger empty (`--ledger=empty`) | 54 page views compared (395 sections, 380,363 characters): 22 identical. Every added sentence is about the ledger or purification, and the number of sell, trim and take-profit calls on every page is exactly the old number: the gate holds buys back, it never sells. No unexpected difference |
| Does the held-cash test fail when the plan is wrong? | 3 deliberate breakages of the plan: the held money added to the fund, the held-cash line never shown, the gate not measured against the ungated plan: all 3 caught (the fund amount or the held amount came out wrong) |
| `lib/` files compared with main | all existing files identical; 1 new file |
| GitHub CI | Passed. Update site, run 86, started by hand (workflow_dispatch) on commit 6650562 of this branch: formulas, page-tests, security, restore-point, build, verify-site, gate and ledger all succeeded; deploy, verify-live, rollback and keepalive were skipped by design, because a branch other than main never deploys. Nothing was written to the permanent record or the deploy log (its newest entry is older than the run), and main is unchanged. https://github.com/ayman-sketch97/stock-checker/actions/runs/42276269754. The earlier run 85 passed on the previous commit (bf3c293). The other three workflows (Update prices, Long-term backtest, Restore drill) were not run: they publish the prices and backtest data branches or redeploy the live site (the drill runs only on main), so they are not checks on this change; the tools they run are unchanged from main. |

**Limits and disclosures**

- **An empty ledger blocks every new stock buy.** The stock part of the monthly plan is shown as cash held back, not
  invested, until each stock you would buy has a current Zoya compliant record in your ledger. That is the rule you
  set; the ledger has to be filled before the stock ideas return, and meanwhile new money is not put to work in stocks.
- **One existing wording is unchanged.** When your own size and sector limits (not the ledger) leave no stock that can
  take the money, the plan still says "No stock fits right now: add it to the index fund instead" and shows the amount
  on a "Stocks" line, as on main. That is the approved limits rule and was not part of this change; say so if you want
  it held as cash too.
- **Small stock share.** If the month's stock part is under $100 the plan moves it to the index fund before any ledger
  check, as on main (a minimum order rule, not a ledger block).
- **Stocks only.** Funds, ETFs and sukuk are not tracked or gated.
- **Swing text for paper trades** (the warning-toned line on a paper-trade swing) is not gated. Live swing buy signals and
  every long-term buy surface are.
- **Purification amounts entered before this change** (none exist in the repository; any in a browser) remain visible only
  in each stock's ledger history, not in a total.
- **Device-local.** The chain makes an edited or removed entry visible; it cannot stop someone with access to your device
  from replacing the whole ledger and its anchor together (only a backup kept elsewhere would show that). Two devices
  differ until you save a backup on one and load it on the other.
- **You type what Zoya shows.** Nothing is fetched from Zoya, so the ledger and therefore the gate are only as current as
  you keep them. The 90-day limit is what forces the recheck.
- **A first-ever non-compliant record starts no countdown.** To start one, record a Zoya compliant check first, or the
  change date with an earlier compliant record. This is deliberate and follows decision 3.
- The tool's own halal screen is still shown and still applies; the ledger gate is in addition to it, not instead.
- Nothing here is financial or Shariah advice. The purification method must come from a qualified Shariah scholar, and
  no purification feature will be built until you supply it and approve it.

**Merge and deployment (6 November 2026, 19:58 UTC)**

After the owner approved commit c99218a, main was moved from 3e90c7a to c99218a as a fast-forward (no force, no new merge
commit, so the merge commit is c99218a itself). Nothing in the code changed between approval and merge.

| Check | Result |
|---|---|
| main after the merge | c99218a, identical to the approved branch head |
| First push | Started no workflow, because the head commit message carries `[skip ci]`. The deployment was therefore started by hand on main. |
| GitHub CI, Update site, run 87 (https://github.com/ayman-sketch97/stock-checker/actions/runs/42281640175) | Passed on c99218a: formulas, page-tests, security, restore-point, build, verify-site, gate, deploy, verify-live and ledger all succeeded; rollback and keepalive were skipped because no rollback was needed. |
| GitHub Pages deployment | Deployment 7609506063 for c99218a ended in `success`. |
| Live site | The verify-live job, which reads the live site and checks it serves this commit, passed. The site address loads normally. |
| Deploy log | Entry `000005-run-run42281640175-a1.json` was appended on the deploy-log branch (commit cce15db). |
| Rollback | Not needed, not run. |

Not independently repeated: a direct download of the live page from the session that did the merge was refused by that
session's network rules, so the live check rests on the verify-live job and the Pages deployment record above, plus a
page-load check that showed no error.

**Stage 4 is complete.** Stage 5 has not been started and waits for the owner's instruction.

---

## 21. Stage 5: the investment thesis and decision record (7 November 2026, merged into main as cbb6c13 and live)

Stage 5 records why you own or consider each stock, what you expect, what could go wrong and what would prove you wrong;
keeps every later change as a new version; and saves the buy, hold, trim or sell call the page showed you, with a plain
explanation and the evidence of that day, so the call can be judged later. It **records and explains. It decides
nothing**: it quotes the call and the reasons that the existing rules already produced, and it changes no verdict,
signal, valuation formula, recommendation, risk limit or Shariah gate.

**What was built, against the six requirements**

1. **The reason for owning or considering each stock.** A thesis has a required reason, a position (owned or
   considering) and a time horizon. The Portfolio page lists every holding with no thesis; any ticker, held or not, can
   have one (company page or the new Thesis page).
2. **The original thesis, catalysts, risks and invalidation conditions.** All are required (write "none identified" if
   that is the honest answer). A condition can be left for you to judge or tied to one of five checks the page can run on
   the saved data: price at or below, price at or above, business rating Avoid or Speculative, fails the tool's Shariah
   screen, chart trend down or weakening. The evidence of the day (price, rating, fair value, buy and trim prices, trend,
   position size and limits result, Shariah screen and ledger result) is saved with the first version.
3. **Changes over time without overwriting.** A change is a *revision*: a complete new version plus a required reason. The
   original and every earlier version stay exactly as written; the page shows each version and what changed (was, now). A
   mistake is struck through by a *correction*, never removed; a thesis that a later revision, decision or closing cites
   cannot be struck through. Closing a thesis (no longer own or consider) is also an entry, and a new thesis may then be
   written for the same stock.
4. **Clear explanations for buy, hold, trim and sell.** A decision report is built from the saved fields only: the
   headline, the page's own reasons word for word, one line each for fundamentals, valuation, chart, risk and Shariah, and
   your thesis with each written condition marked met, not met, not checkable or for you to judge. A sale or trim with no
   condition met says that it comes from the tool's rules, not from your thesis. Missing data says "not available"; nothing
   is filled in. The wording never says a company is compliant or halal (Zoya has the final word).
5. **Links to fundamental, valuation, technical, risk and Sharia data.** Every decision stores those five groups as
   they stood on the page that day (from the same screener row the permanent record uses, the buy check's limits result,
   and the Shariah ledger gate), with the date of the data.
6. **The original decision and evidence preserved.** A decision entry holds the call in the page's own words, the four-way
   action, the reasons, the evidence, a copy of the thesis as it then stood, which conditions were met, the explanation,
   and when it was really recorded. Decisions can only be saved for today, so they cannot be back-dated. The explanation
   and the condition results are rebuilt by the integrity check and must match what was saved.

**Append-only.** The record is a SHA-256 hash chain like the Shariah ledger (stage 4), with an anchor kept in a second
key and in the backup file. Entries are never edited or removed; the chain and the anchor show an edited, removed,
reordered or cut-off entry; nothing can be added while the check fails; joining a backup never overwrites what is on the
device (references are translated and the original number and hash kept in `origin`).

**Where it appears.** A new Thesis page (reached from the Portfolio page); a "Thesis and decisions" card on the Portfolio
page (one line per holding, a decision report on today's call, and a Save button); a "Your thesis" card on each company
page (a thesis line, and a report on a long-term *buy* call when the page's call is a buy). Calls that are not buy, hold,
trim or sell (Paused, Review, Check halal, Your call) are named as such and cannot be saved as a decision. "Take profit"
is saved as a sale, "Add" as a buy.

**What did not change.** Every file in `lib/` is the same as on main except the new `lib/thesis.js` (compared with
`git diff origin/main -- lib`: one new file). It imports only the hashing and date helpers of `lib/shariah-ledger.js`.
In `index.html` the only lines removed from main are nine one-line edits: the Advice list's row object (a hidden `dec`
field was added, which is not displayed), the Portfolio card order, the backup, merge and restore lines, the backup
button's enabled test, the page list, the navigation highlight and the test hook. No formula, threshold, limit or signal
was edited. The only workflow change is one extra step that runs the thesis tests (`test/workflow.test.py` checks it).
No paid service, subscription, API key or recurring cost was added; the record is local code with no network call.

**Evidence** (all run on the branch before commit)

| Check | Result |
|---|---|
| Thesis tests (`test/thesis.test.mjs`) | 20 of 20: required fields, strict evidence, written conditions, one open thesis per stock, versions and diffs, tamper checks (edit, remove, reorder, cut off, forged explanation), decisions and explanations for buy, hold, trim and sell, missing data, today-only decisions, corrections, closing, overview, joining backups, wording, and that the page carries exactly the library's code |
| Do those tests fail when the logic is wrong? | 15 deliberate breakages of the library (price boundary, back-dating allowed, hash not checked, explanation not rebuilt, empty revision accepted, second open thesis accepted, page's reasons not quoted, cited thesis voidable, merge not translating references, caller-supplied explanation honoured, integrity check skipped, missing thesis not stated, met condition dropped, evidence not strict, closing without a reason): 15 of 15 caught |
| Page tests (`test/page.test.py`) | 511 of 511 (466 before, 45 new): the Portfolio card, writing and revising a thesis through the page, the original kept byte for byte, the history, a decision report that quotes the Advice list's sentences word for word, an edited decision caught on both pages, nothing added to a failed record, late data (paused rows cannot be saved), a met condition shown without changing any advice, the company page (saving a buy; a buy the ledger blocks cannot be saved), backup and merge, and no page errors |
| Other node suites and workflow rules | formulas 80 of 80, Shariah ledger 40 of 40, deploy safety 46 of 46, restore and log 50 of 50, workflow rules all hold |
| Same advice, ledger current (`same-advice.py --ledger=current`, old = main `4f74903`) | 54 page views compared (411 sections, 382,399 characters): 38 identical word for word; the only differences are the two new sections ("Thesis and decisions", "Your thesis"), listed in `ADDED_SECTIONS`. No unexpected difference |
| Same advice, ledger empty (`--ledger=empty`) | 54 page views compared (411 sections, 384,755 characters): 38 identical; only the same new sections differ, and the number of sell, trim and take-profit calls on every page is unchanged. No unexpected difference |
| Advice and the plan with a record present | Tested on the page: with a thesis, a saved decision or a met condition, the Advice list rows and this month's plan are exactly as without |
| Secret scan | no credentials found |
| GitHub CI (full workflow dispatched on the branch, run 88, code commit `a9c641e`) | passed: security, restore-point, formulas, page-tests, build, verify-site, gate and ledger all succeeded. verify-live, deploy, rollback and keepalive were skipped, as designed for any branch other than main. Main (`4f74903`) and the deploy log were not touched |

**Limits and disclosures**

- **A call is kept only when you press Save.** Nothing is recorded automatically, so calls you do not save are not
  preserved here. (An automatic record of every change of call would be a design change; it is not built, and it is
  yours to decide.) The site's own permanent record of its nightly calls (section 7 of `PREREGISTERED.md`) is unchanged.
- **Device-local.** Holdings are not in the public repository, so the thesis record lives in this browser and in the
  backup file, like the journal and the Shariah ledger. The chain shows an edited or removed entry; it cannot stop
  someone with access to your device from replacing the whole record. Two devices differ until you load a backup.
- **The measure "broken theses caught" is not computed.** `PREREGISTERED.md` (measure 3) needs dated theses with
  conditions and the price on the day each was written; Stage 5 saves exactly that, but the measure itself lives on the
  server record and would need the thesis file to leave your device. That is not built and is for you to decide.
- **Evidence is what the page held.** It is the nightly screen row (rating, scores, fair value, buy and trim prices, trend)
  as shown that day, not a full set of statements, and not a later correction. A ticker the site does not analyse (an own
  ticker) has mostly empty evidence, said as such. For judging a call later, use the date and price saved with it.
- **Which calls can be saved.** The Advice list's Add, Hold, Trim, Sell and Take profit, and a long-term buy on a company
  page. Swing-trade signals, the monthly plan's lines, ideas, shortlist tags and requests to check something are not
  decisions in this record.
- **Written conditions** are compared only with the saved data and only the five listed checks; the rest are yours to
  judge. A met condition is shown, never acted on: no alert is sent and nothing is sold. An unmet one is not a reason to hold.
- **A thesis can be written for a date earlier than today** (you may have owned the stock for months); the time it was
  really recorded is saved separately. Decisions cannot.
- **The explanations are fixed templates** filled from the saved fields; nothing is generated or estimated.
- **Your action** on a saved decision is free text you type; it is not checked against your journal or holdings.
- Nothing here is financial or Shariah advice. Zoya remains the final Shariah authority.

**Merge and deployment (6 November 2026, 21:49 to 21:52 UTC, which is 7 November in Abu Dhabi)**

After the owner approved commit cbb6c13, main was moved from 4f74903 to cbb6c13 as a fast-forward (no force, no new merge
commit, so the merge commit is cbb6c13 itself). Nothing in the code changed between approval and merge.

| Check | Result |
|---|---|
| main after the merge | cbb6c13, identical to the approved branch head |
| First push | Started no workflow, because the head commit message carries `[skip ci]`. The deployment was therefore started by hand on main. |
| GitHub CI, Update site, run 89 (https://github.com/ayman-sketch97/stock-checker/actions/runs/42297405563) | Passed on cbb6c13: formulas, page-tests, security, restore-point, build, verify-site, gate, deploy, verify-live and ledger all succeeded; rollback and keepalive were skipped because no rollback was needed. |
| GitHub Pages deployment | Deployment 7611613689 for cbb6c13 ended in `success`; the previous deployment (c99218a) became inactive. |
| Live site | The verify-live job, which reads the live site and checks it serves this commit, passed, and the deploy log entry records the live commit as cbb6c13. |
| Deploy log | Entry `000006-run-run42297405563-a1.json` was appended on the deploy-log branch (commit 5a304f4): deploy `success`, live `success`, rollback `skipped`. |
| Permanent record | This run also saved its normal nightly record for the price date 5 November 2026 (records branch commit b756fda), as every main run does. It is unrelated to Stage 5. |
| Rollback | Not needed, not run. |

Not independently repeated: a direct download of the live page from the session that did the merge was not attempted
through any route other than the workflow, so the live check rests on the verify-live job, the Pages deployment record
and the deploy log entry above. The Thesis page and the new cards were tested through the page tests (511 checks), not
through a person using the live site; the owner's own browser use will be the first live use.

**Stage 5 is complete.** Stage 6 has not been started and waits for the owner's instruction.
