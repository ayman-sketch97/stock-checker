# Validation report (19 October 2026, second round 23 October 2026)

What was checked, how, and what is still wrong. Nothing here claims the tool is error-free: it records the
evidence for the six companies tested and the limits that remain.

## 1. Automated formula tests

`node --test test/formulas.test.mjs` (32 tests, all passing; run by every build before publishing).
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

`python3 test/page.test.py` (Playwright, run on every push): journal P/L with fees, trading costs, backup save,
wipe and restore round trip and merge rules, Portfolio warnings for missing prices and for a stock counted twice,
the stale-data banner, and the benchmark card on the Record page.

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

## 5. What is not validated

- Companies outside the six tested; foreign filers (20-F/40-F), REITs, banks and insurers are not analysed.
- Company-specific XBRL tags are not read; the tool states which figure is missing or carried forward.
- The Shariah screen cannot see impermissible revenue inside business segments; confirm on Zoya or Musaffa. The
  screen was not compared with an external screener; use Zoya for Shariah decisions.
- Survivorship bias, dividends and overlapping positions in the backtest (see section 4).
- Portfolio: there is no ledger for deposits, withdrawals, dividends received or currency conversion, so total
  return and realized P/L across cash movements are not tracked; trade P/L includes the fees you enter.
- The fair value is a model with stated assumptions, not a measured fact.
