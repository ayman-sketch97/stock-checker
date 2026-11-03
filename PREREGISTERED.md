# Rules written down before the results

A backtest is only honest if the rules for judging it are fixed before the results are seen. Otherwise it is easy,
even without meaning to, to keep trying until something looks good. This file records those rules and when they were
written. Git keeps the date and time of every change to it.

## 1. How much of the monthly money goes to stocks

Written on 27 October 2026, before the first full 10-year run. Code: `decide()` in `lib/ltstats.js`.

- **Stocks (70% stocks, 30% fund):** 1,000 AED a month put into the list ends above the median of the random
  portfolios over the whole period and in both halves, ends above the S&P 500 over the whole period, and the list's
  stocks beat the average halal stock over the next 12 months with a Newey-West t above 2.
- **Mixed (50/50):** it ends above the random median over the whole period and the list's stocks beat the average
  stock over 12 months, but not all of the above.
- **Fund (20% stocks, 80% fund):** anything else.

## 2. Other ways to build the list

Written on 27 October 2026 and committed at 09:58 UTC (commit 5a277c2); the wider run published its results at
10:01 UTC. By then the first 10-year run, on the companies the site covers today, had shown that the list did not
beat the average halal stock. The wider run (every company worth $250 million or more today) was still running and
its results had not been seen.

Five well-known alternatives from research, each with its settings fixed now (no tuning afterwards):

1. **Momentum:** the 20% of eligible stocks with the highest price return from 12 months to 1 month before the day
   (Jegadeesh and Titman, 1993).
2. **Quality:** the 20% with the highest quality score (the tool's own score of returns on capital, margins and how
   steady they are). This one was already looked at once on the first run, as a portfolio, and did worse than the
   S&P 500. It is kept because it is a standard alternative, not because it looked good.
3. **Quality and momentum:** the 20% with the best average of the two ranks.
4. **Quality and value:** the 20% with the best average of the quality rank and the rank of the discount to fair
   value.
5. **The current list with a trend filter:** the current list, keeping only stocks whose return from 12 months to
   1 month before the day is positive.

"Eligible" means the same as in the rest of the test: halal by the tool's screen, worth $2 billion or more that day,
not a bank or insurer, and data good enough for a verdict.

An alternative replaces the current way of building the list only if all three of these hold:

- **a.** Its stocks beat the average eligible stock over the next 12 months with a Newey-West t of 2.5 or more over
  the whole period. The bar is 2.5 rather than 2 because five alternatives are tried at once.
- **b.** Its stocks beat the average eligible stock in both halves: month-ends before December 2021, and from
  December 2021 on.
- **c.** 1,000 AED a month put into it with the site's rules (best-ranked first, at most 15 stocks, at most 10% of
  the portfolio in one stock or two months of savings while the portfolio is small, sell when the business weakens,
  sell half above the trim price) ends above the median of 100 random portfolios over the whole period and in both
  halves.

If more than one passes, the one with the highest t in (a) is used. If none passes, the list stays as it is and the
money split stays as rule 1 sets it.

If one passes, rule 1 sets the money split from its results, but with at most 50% in stocks until it has 12 months
of live results, because it was picked after the first method failed.

Known bias: the data holds only companies still listed today. The missing ones are mostly failures, and failures
tend to look cheap before they fail, so their absence flatters cheap stocks (alternatives 4 and 5). Failures also
tend to have weak quality and falling prices, so their absence works against alternatives 1 to 3. A pass by 4 or 5
is therefore weaker evidence than a pass by 1, 2 or 3.

## 3. The Portfolio page's own picks

Written on 27 October 2026 at about 10:15 UTC, before they were tested. The data they need (each company's growth
score and price trend on every past month-end) did not exist yet: it comes from a new run of the replay, started
after this was committed.

Section 1 tests the "Quality on sale" list in order of upside. The Portfolio page picks stocks its own way, and that
had not been tested:

- **Long-term picks:** verdict strong buy, buy or watchlist, quality 70 or more, growth 50 or more, financial health
  50 or more, not above the trim price; ranked by a mix of quality, growth and health, with a bonus at or near the
  buy price; at most 2 per sector. Sold when the business weakens or it fails the halal screen; half sold above the
  trim price.
- **Medium-term picks:** the same verdicts, quality 60 or more, health 40 or more, at most 10% above the buy price,
  more than 10% below fair value, and not in a falling trend; ranked mostly by the discount to fair value. Sold as
  above, and also when the price reaches fair value.
- **Short-term picks** need data the test does not have (relative strength and chart setups), so they are not
  tested.

Each tested kind gets 1,000 AED a month with the page's buying rule: the month's money goes to one place, a new stock
while there are fewer than the target number (10 to 12, one per $400 in stocks), otherwise the holding furthest below
its equal share, otherwise the smallest holding. It is compared with 100 portfolios built by the same rules from
random halal stocks the page could suggest, and with the S&P 500. Its ideas (the 6 a month the page shows) are
compared with the average halal stock over 12 months. Each kind is judged by rule 1.

What follows from the results:

- The long-term part of the Portfolio page keeps its own picks if their rule-1 result is at least as good as the
  list's. Otherwise it buys the list in order of upside, as tested in section 1.
- The money split (how much goes to stocks) follows the rule-1 result of whichever method the long-term part uses.
- A kind of pick whose rule-1 result is "fund" gets no new money: its share of the stock money goes to the long-term
  picks. The same applies to the short-term picks until they can be tested.
- These choices are set from this first run and only changed after a review, so the site does not flip from one
  monthly run to the next. Each monthly run reports whether it still agrees with them.
- One small change to the page's buying rule is made at the same time and is part of what is tested: when every
  holding is near its equal share and there are already enough stocks, new money tops up the smallest holding
  instead of starting yet another stock.

## 4. Rule change of 3 November 2026 (owner's policy, not a result of the tests)

Written before the re-run with the new rules. The owner approved these limits as policy for compliance and risk; they
were not chosen by looking at returns, and the judging rules (rule 1 and section 3) stay as they are.

- Every buy needs a clear halal "pass". Before, a held stock whose status was "review" could still be topped up.
- No new buys in a stock that is already 10% of the portfolio, or in a sector that is already 40% of the stocks.
- A stock above 15% of the portfolio, once there are at least the minimum number of stocks, is cut back to 10%.

The page and the 10-year test use the same rules (`POLICY` in `lib/ltstats.js`, `buyCheck` in `index.html`). The
report keeps the result of the old rules for the full period (`plan.<kind>.portfolio.before`), so the effect of the
change can be seen. If the re-run moves the money split, the site follows it, as section 1 says.

## 5. The Portfolio plan judged on many five-year periods (3 November 2026)

Written on 3 November 2026, before any of these numbers were computed. Code: `planWindows()` and `decideWindows()`
in `lib/ltstats.js`.

Why: rule 1 judges the plan on one ten-year path and its two halves, and one path depends heavily on which stocks
happened to be bought first. On the same data, 100 portfolios of random halal stocks built with the same rules ended
between 8.3% and 19.5% a year (10th to 90th percentile), so a single path can land anywhere in a wide band by luck.
The re-run of 3 November showed the two measures disagreeing: the long-term ideas were well ahead of the average
halal stock over the next 12 months (+8.1% a year), while the plan's single path trailed random picks (9.3% a year
against a median of 13.1%). One path cannot settle which is right. That disagreement prompted this change; the pass
marks below are set without knowing how the plan does over many periods.

What is measured, for each kind of pick the Portfolio page buys (long term and medium term):

- Overlapping five-year periods, one starting at each month-end from the first month of the test to the last month
  that has five full years of data after it, with 1,000 AED a month and the page's rules, including the limits of
  3 November (section 4).
- In each period: the plan's yearly return, the median yearly return of 50 random portfolios built by the same rules
  from halal stocks the page could suggest, and the S&P 500.
- Also shown, but not part of the rule: the ideas' returns 24 and 36 months later against the average halal stock.

The money split for a kind of pick, from this run on:

- **Stocks (70%):** the plan beats the random median in at least three quarters of the periods and the S&P 500 in
  at least half of them, and its ideas beat the average halal stock over the next 12 months with a Newey-West t of 2
  or more, and in both halves (month-ends before December 2021, and from December 2021 on).
- **Mixed (50%):** it beats the random median in at least half of the periods, and its ideas beat the average halal
  stock over the next 12 months.
- **Fund (20%):** anything else.

This replaces rule 1 for the kinds of pick the Portfolio page buys. The result of rule 1 on the single path stays in
the report (`decisionSinglePath`) so the two can be compared. Whether the long-term part uses the page's picks or the
list (section 3) is still decided with rule 1 on both, so like is compared with like. The site keeps following
`LONG_METHOD` and `POOLS_WITH_MONEY`, which change only after a review.

Limits of this measure: the periods overlap and come from one decade, so the share of periods removes the luck of the
starting month, not the luck of the decade, and it is not a test of significance. The data still holds only
companies listed today, which flatters every stock portfolio against the S&P 500 (less so against random picks drawn
from the same companies).

## 6. The position-size rules made exact (3 November 2026, owner's policy, not a result of the tests)

Written on 3 November 2026, before any result under these rules was computed. The owner asked for the limits of
section 4 to be defined exactly and applied the same way everywhere, and answered three questions about them:

- **Trim target:** a stock above 15% of the portfolio goes back to 10%, as recorded in section 4 (not to 15%).
- **Any number of stocks:** the trim applies whether the portfolio holds 3 stocks or 30. Section 4 trimmed only once
  there were at least the minimum number of stocks (10 for a portfolio that is half or more in stocks).
- **Buy limit after the buy:** no buy may take a stock above 10% of the portfolio. Section 4 only stopped buys in a
  stock already at 10%, so a stock at 9.9% could still receive a full month's buy and end well above 10%.

The rules, in `lib/policy.js` (the page carries an identical copy, and a test fails if the two differ):

- Weights are shares of the whole portfolio: stocks, funds, sukuk and cash, including money about to be invested.
- New buy: amount <= 10% x total - what is held of that stock. A new stock can take up to 10%; a stock at 9.9% has
  room for 0.1% of the portfolio; at 10% or more, none.
- Trim: if a stock is above 15% of the total (not at 15%), sell enough to bring it back to 10%.
- Sector: no new money for a sector that is already 40% or more of the long-term stocks, measured before the buy (a
  limit after the buy would block the first stock of every new portfolio, which is always 100% of its stocks).
- Orders: a buy or a sale under $100 is not made. Money that no stock can take goes to the fund, as before.
- Rounding: a weight within one billionth of a limit counts as at the limit.

What does not change: the halal "pass" for every buy, the judging rules (sections 1, 3 and 5), and the list's own
simulation (sections 2 and 3), which keeps the cap it was registered with (10% of the portfolio or two months' money).

Three rule sets are kept apart from now on, in the code (`simulatePlan`, option `policy`) and in the results:

- **Original:** the rules before 3 November (`policy: false`); its result stays in the report as `before`.
- **Approved:** this section (`policy: 2`, the default). Every Portfolio page result on the site uses it.
- **Version 1:** the limits as first built on 3 November (`policy: 1`), superseded the same day. Kept only to show what
  this change did; it is not shown on the site.

Anything else run on these data, such as switching one limit off to see what it did, is experimental: it is run after
results are known, it is labelled experimental wherever it appears, and it is never used as evidence for the strategy
or to choose rules.

The re-run uses the same replay data as the last published run. Version 1 and the approved rules are compared side
by side in `VALIDATION.md`. Whatever the comparison shows, these rules stay (they are policy, decided by the owner).
If the money split of section 5 moves, the site shows the new evidence, and keeps it separate from the owner's own
choice of 70% stocks and 30% fund, which is a personal risk decision and is never presented as a test result.

## 7. How the system is judged: decision quality from the permanent record (3 November 2026)

Written on 3 November 2026, when the record held two days and no result had matured (the first one-month results are
due in early December). The owner asked for the permanent record to be the main source of truth for judging the
system, and for the system never to be tuned to improve its historical results after the outcomes are seen. These
measures are fixed before any outcome exists. Any later change gets a new version number and a date, and the old
version keeps being reported next to it.

Common rules, as in stage 2: a call counts from the first close after it was published, against the S&P 500 (SPY) over
the same dates, prices only; a repeat within 30 days counts once; halal changes are recorded but not judged by later
prices. A call has matured when its 12 months (252 trading days) are complete; 1, 3 and 6 months are early reads,
never the verdict. A measure is reported once at least 30 calls have matured for it; until then the page says how
many there are.

1. **False buys:** calls to buy (entered the long-term buy zone, or a new Portfolio page pick) whose stock trailed
   the S&P 500 by more than 10 percentage points over the next 12 months, as a share of the matured buy calls.
2. **False sells:** "business weakened: sell" calls whose stock beat the S&P 500 by more than 10 points over the next
   12 months; and, reported apart, the same for "reached the trim price" (a partial sale).
3. **Broken theses caught:** from stage 5, when each holding has a dated thesis with conditions that would break it:
   the share of broken theses the system flagged before the price fell 20% from the day the thesis was written. Not
   measured before stage 5.
4. **Sales avoided:** a new kind of call, recorded from the first nightly run after this section is in the code: a
   company with a sound verdict that falls 20% or more below the price of its buy call while the verdict stays sound
   (the rule says hold, not sell). Judged by whether it then beat the S&P 500 over the next 12 months.
5. **Oversized positions prevented:** in the 10-year test, the buys the size and sector limits cut or blocked and the
   trims they made, per year. On a device, the Portfolio page counts the buy suggestions it blocked; that count stays
   on the device, because holdings never leave it.
6. **Advice paused on late data:** trading days on which the site's data was two or more trading days late, counted
   from the gaps between the record's day files and the nightly health reports.
7. **Valuation error:** for buy calls with a fair value: the share of the gap between the price and the fair value
   that had closed 12 and 36 months later (the median), and the bias, the median of (price 36 months later divided by
   the fair value at the call, minus 1). A fair value that is right on average has a bias near zero.
8. **Opportunities missed:** halal-pass companies the tool covered that were not in the buy zone at a month-end and
   beat the S&P 500 by more than 20 points over the next 12 months, as a share of all such companies, next to the same
   share among the buy calls. If the calls do not show a higher share, the buy zone adds little.
9. **Against the S&P 500:** for each kind of call, the average return minus the S&P 500's over the same dates at 1,
   3, 6 and 12 months, and the share of calls that beat it.
10. **Risk-adjusted:** a model portfolio holding each buy call in equal parts for 12 months, valued every month: the
    yearly return, the volatility, the worst fall, and the return per unit of volatility with 0% as the base (no
    interest), next to the S&P 500 over the same months. Reported once there are 12 monthly values.

What is never done: the rules that make the calls are not changed because of these measures except through a review
written down beforehand, as in sections 3 to 6. If a review changes a rule, the calls made under the old rule stay in
the record labelled with that rule's version, and every measure is reported per version.
