# Screener forward check on real data (26 November 2026)

Question: does the chart analysis behind the swing scanner rank stocks that then do better? This is a rough check, not a
validation. It changes no rule and nothing in the app uses it.

Method: `study.mjs` reads the nightly per-stock chart files the site publishes (`data/tech/<TICKER>.json`, 260 daily bars each),
and at 10 cut dates (2 Sep to 23 Oct 2026, every 4th bar) runs the real `prepare` and `analyzeTechnical` on the bars up to that
day only. It then compares the next 20 trading days' return with the same-day average of all stocks. Run: download the files, then
`node studies/screener-forward-check-2026-11/study.mjs <folder>`. Result: `result.json`.

Result (1,913 stocks, 19,130 stock-days): the chart analysis score has a slightly NEGATIVE rank correlation with the next
20 days' excess return (Spearman -0.086; the lower-scoring half beat the higher half, +1.7% vs -1.4%). Excess return vs same-day
average: pullback setups -1.5%, breakouts -1.1%, range -0.7%, reversals +4.2%.

Limits, so this is not over-read: one quarter and one market regime; overlapping 20-day windows (not independent); today's
stock list (survivorship); no costs; only the chart analysis' own score and setups, not the scanner's data gates or evidence
score (those need relative-strength ranks and history the published files do not carry, 260 bars vs the 300 the scanner needs).
It does not show an edge, and it does not prove there is none.

Conclusion: no evidence here that the ranking predicts better returns. The scanner's own docs already say it is not a buy
signal and has no performance record. Changing weights or rules would be a new, preregistered version (a decision for the user).
