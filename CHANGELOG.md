# Changelog

Dated record of changes that affect what the site tells you. The full history is in the git log; how each change was
checked is in `VALIDATION.md`.

## 3 November 2026: the permanent record counts each call from the first close after it was published

- The first file of the record is dated 30 October (the latest closes the data had) but was published on the evening
  of 2 November. Its calls now count from 3 November's close; before, they were credited with 2 November's, which had
  already happened. The record's files are unchanged: only how results are worked out from them.
- On the first days, the Record page no longer shows an empty table of new calls.

## 3 November 2026: stage 2 of the robo-advisor plan (the permanent record)

- Every night the tool's calls (verdict changes, halal status changes, buy-zone and trim-zone entries, the Portfolio
  page's picks, swing signals) are added to the `records` branch. Files are only ever added; each carries the
  fingerprint of the one before, and the save step refuses any change to an old file.
- The Record page shows how the calls did after 1, 3, 6 and 12 months against the S&P 500, and whether every file
  still matches its fingerprint. Fixed before the first call: a night of missing data is not a new call, a repeat of
  the same call within 30 days counts once, companies that fall below the size cut-off are still priced, and calls
  that can no longer be priced are shown as left out rather than dropped quietly.
- The Journal keeps what the tool said on the day you log a trade, and your results show trades with the tool and
  against it.

## 3 November 2026: stage 1 of the robo-advisor plan (safety)

From the audit of 3 November (the "Stock Checker audit and robo-advisor plan" document). Limits approved by the owner
the same day.

- One risk check (`buyCheck` in `index.html`) now decides every buy suggestion on every page: the stock page, the daily
  brief, the Watchlist alerts, the Portfolio page advice, the monthly plan and the stock ideas.
- A buy needs a clear halal "pass". A stock under "review" is never suggested and gets no new money; the Portfolio page
  says "Check halal" instead of "Passes the halal screen".
- Your limits: no new buys in a stock already 10% of the portfolio, or in a sector already 40% of your stocks; trim a
  stock above 15% back to about 10% once you hold enough stocks; 0.5% of the portfolio at risk per swing trade (was
  1%). Editable on the Portfolio page ("Your limits").
- When the nightly update is two or more trading days late, every action is paused (brief, advice, monthly plan, stock
  page); the numbers stay readable.
- A holding with unreliable data, or a bank or insurer, is marked "Review" instead of "Passes".
- The 10-year test uses the same rules (`POLICY` in `lib/ltstats.js`) and keeps the old rules' result for comparison
  (`PREREGISTERED.md`, section 4).
- Re-run of the 10-year test with these rules (same data as 27 October): the long-term picks returned 9.3% a year
  (11.7% before the limits), against 13.9% for the S&P 500 and 13.1% for random picks under the same rules. By the
  pre-registered rule, "let the test decide" now suggests 20% stocks and 80% fund (it was half and half). Most of the
  drop comes from the 40% sector limit; the 10% limit on new buys alone raised the result. Details in `VALIDATION.md`,
  section 9. The Record page shows the result before and after the limits.
