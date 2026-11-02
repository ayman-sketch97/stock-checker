# Changelog

Dated record of changes that affect what the site tells you. The full history is in the git log; how each change was
checked is in `VALIDATION.md`.

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
