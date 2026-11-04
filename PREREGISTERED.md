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

### 7.1 Amendment, 3 November 2026: every rate next to a random-stock yardstick (measures, version 2)

Added at the owner's request on the evening of 3 November 2026 (UTC), when the record held three days and no result
had matured. It changes no call, no threshold and no horizon: it adds what each rate is compared with. The rates as
first written (version 1) are still reported.

Why: in the 10-year data (2,012 companies, month-ends from December 2016 to October 2025, halal-pass companies only,
72,335 stock-months), 45% of stocks trailed the S&P 500 by more than 10 points over the next 12 months, 32% beat it by
more than 10 points and 23.5% beat it by more than 20 points. The data holds only companies still listed today, so
the true share of large losses is higher. A rate on its own says little: a false-buy rate of 40% would be better than
chance.

The yardstick: for measures 1, 2, 4, 8 and 9, at every horizon (the early reads included), the same figure for every
company that passed the halal screen on the day of the call (the record's state file of that day says which), followed
from the same close, over the same days, with the same prices. Each call is paired with its own day's yardstick, so a
kind of call made mostly in a falling market is compared with that same falling market.

How it is read: the calls' figure, the yardstick's, and the gap between them, with a 90% interval for the gap found by
resampling the days on which the calls were made (2,000 resamples with a fixed seed, so the same record always gives
the same interval; calls made on the same day move together, so days are resampled, not calls). With calls on fewer
than 5 days, no interval is given. If the interval includes zero, the page says the calls are no better than random
halal stocks so far. For buy and hold calls, better means a higher return than the yardstick and fewer large losses;
for sell and trim calls, the opposite.

Unchanged: measure 3 is judged against each thesis's own conditions, 5 and 6 are counts, 7 compares the price with
the fair value, and 10 already compares with the S&P 500. Companies without prices that night are left out of the
yardstick, as they are of the calls.

### 7.2 Frozen before the first result: how each call is measured, and when a kind of call passes or fails (measures, version 3)

Written on the evening of 3 November 2026 (UTC), at the owner's request, when the record held four days and no call
had reached even its first month. These definitions are frozen and will not be changed after any result is seen. The
owner may still change them before the first one-month results (due in early December 2026); any such change is
added here as a dated amendment, and nothing after that. Sections 7 and 7.1 stay as written; where this section is
more precise, it decides.

**Kinds of call, each reported separately:** entered the long-term buy zone (buy); new long-term pick; new
medium-term pick; fell 20% with the business still sound (hold); business weakened (sell); reached the trim price
(trim). Halal changes are recorded but not judged by later prices. Swing signals are judged in their own paper record.

**Entry and horizons:** a call is entered at the first close after both its date and its publication (stage 2). Its
horizons are 21, 63, 126 and 252 trading sessions of the S&P 500 (SPY) after the entry session; the stock's price at
a horizon is its last close on or before that session. 252 sessions (12 months) gives the verdict; the others are
early reads.

**Returns:** total returns, with dividends reinvested at the close of the ex-dividend day, for the stock and for SPY
over exactly the same sessions, when the dividend histories of both were read from the site's price sources;
otherwise prices only for both, and the page counts the calls measured on prices only. No costs or taxes.

**Companies that stop trading** (taken over, merged, delisted, bankrupt): from the first nightly run with this
section in the code, the record keeps each night's closing price of every company that is in a call or in a
yardstick, so a company that disappears from the price source is still followed. Its return runs to its last close
and is 0% after that (held as cash) until the horizon; it counts at that return, and the page shows how many calls
ended this way. A company counts as stopped once it has had no close for 10 sessions of SPY.

**Unpriceable calls:** a call with no close after it (so no entry price), or whose prices can be read neither from the
source nor from the record's own archive when its horizon comes, is unpriceable. It counts as a wrong call whatever
the kind, is left out of the average returns, and is counted on the page. Missing data never counts as a success.

**Wrong calls (measures 1, 2 and 4):** a buy, pick or hold call is wrong if its 12-month total return trails SPY's by
more than 10 percentage points; a sell or trim call is wrong if the stock's 12-month total return beats SPY's by more
than 10 points; an unpriceable call is wrong.

**Shown for each kind at 12 months, from 30 matured calls** (until then, the number that have matured): the number of
calls; their average 12-month return; SPY's average over the same days; the difference; the yardstick's difference
(section 7.1); the gap between the calls and the yardstick with its 90% interval; the share of wrong calls next to
the yardstick's share under the same rule; and the counts of calls that stopped trading, were measured on prices
only, or were unpriceable. The 1, 3 and 6 month reads are shown the same way, labelled early.

**When a kind of call passes or fails** (from 30 matured calls made on at least 5 different days):

- passes if the 90% interval of its gap to the yardstick lies wholly on the good side (above zero for buy, pick and
  hold calls; below zero for sell and trim calls) and its share of wrong calls is no higher than the yardstick's;
- fails if that interval lies wholly on the bad side;
- otherwise it is undecided: no better than random halal stocks so far.

A pass or a fail from fewer than 100 matured calls is shown as provisional. A fail never changes a rule by itself: it
starts a review written down beforehand (section 7), and calls made under an old rule keep that rule's label.

**The other measures:**

- 3, broken theses caught (from stage 5): a thesis is broken when one of its own written conditions is met; it was
  caught if the system flagged it before the price fell 20% below its price on the day the thesis was written.
  Passes if at least half of 10 or more broken theses were caught: catching fewer means the warnings mostly come too
  late to act on.
- 5, oversized positions prevented: counts per year from the 10-year test (buys capped or blocked, trims made) and
  their effect on return and worst fall against the original rules. A description of what the rules do, with no
  pass or fail.
- 6, advice paused on late data: fails if more than 10 trading days in any 12 months had data two or more trading
  days late. More than about one day in 25 makes the daily advice unreliable to follow.
- 7, valuation error: for buy calls with a fair value, passes if at 36 months the median call has closed at least
  half of the gap between its price and its fair value and the bias is within 15% either way. A fair value the price
  never approaches, or one off by more than 15% on average, should not set buy prices.
- 8, opportunities missed: the buy zone adds value if the share of buy calls that beat SPY by more than 20 points over
  12 months is higher than the same share among the halal-pass companies outside the buy zone at the same
  month-ends, with a 90% interval above zero (month-ends resampled, 2,000 times, fixed seed).
- 9, against the S&P 500: shown for every kind at every horizon; the yardstick comparison above decides pass or fail.
- 10, risk-adjusted: the model portfolio passes if its return per unit of volatility is at least SPY's over the same
  months and its worst fall is no more than 10 points deeper. Shown from 12 monthly values, judged from 36.

**Why these numbers.** In the 10-year data (halal-pass companies, 72,335 stock-months, prices only, companies still
listed today), a stock's 12-month return minus SPY's had quartiles of -27.6, -5.9 and +18.0 points; 45% trailed by
more than 10 points, 32% beat by more than 10, 23.5% beat by more than 20, and 23% were within 10 points either way.
The average of 30 random stock-months ranged from -13.2 to +21.7 points (5th to 95th percentile of 2,000 draws), so
30 calls can show only a large effect. That is why a verdict rests on the interval against the yardstick, not on a
fixed share, and why it stays provisional until 100 calls. The 10-point line is the one written in section 7; with
the yardstick's share beside it, what decides is whether the calls are wrong less often than random halal stocks.

## 8. Study: a discount rate linked to the 10-year Treasury yield (3 November 2026, before any run)

Asked for by the owner: research and test a Treasury-linked discount rate on a separate branch, compare it with the
fixed rates on identical data and assumptions, with sensitivity tests, extreme interest-rate scenarios and checks for
valuation instability, and change nothing until he has reviewed and approved the comparison. Written before any run.

**A, the current rule (stays unless the owner approves a change):** 8% for strong businesses, 9% for typical ones,
10% for weaker or small ones (lib/engine.js), terminal growth 2.5%.

**B, the variant tested:** the 10-year Treasury yield plus 4, 5 or 6 points for the same three kinds of business, so
the fixed rates read as a 4% risk-free rate plus a premium. The yield is the monthly average (FRED, series GS10) of
the month before each valuation date, so no later data is used. Floor 5.5% (3 points above terminal growth, so the
terminal value stays finite and stable); cap 15%.

**Identical everything else:** the same companies, filings, prices, month-ends, approved plan rules (version 2) and
costs; only the discount rate differs. The study runs from its own branch and writes to its own output; the live
site, the record and the published 10-year results are not touched.

**Sensitivity runs** (all reported; none can be adopted on its own):

- S1, centred: the premium raised by 1.06 points, so the average rate over the test's months (mean yield 2.94%,
  December 2016 to October 2026) equals the fixed rates. This separates moving with rates from a lower average rate.
- S2, half link: the fixed rate plus half of (yield minus 4%).
- S3, smoothed: the 12-month average yield instead of the month's.
- S4, higher floor: 6.5%.
- S5 and S6: the premium 1 point lower and 1 point higher.

**Extreme rate scenarios** (on today's companies and their latest filings): fair values with the 10-year yield at
0.5%, 2%, 4%, 5.13% (October 2026), 8%, 10% and 15% (near the 1981 high of 15.32%): the median change in fair value
against the fixed rates, the share of halal-pass companies in the buy zone, and how many hit the floor or the cap.
B fails if, anywhere between 2% and 8%, a 1-point move in the yield changes the median fair value by more than 50%.

**Valuation instability** (A against B over the test's months):

- I1, the median and 95th percentile of the monthly change in each company's fair value;
- I2, buy-zone churn: entries plus exits per company per year;
- I3, the median change in fair value for a 1-point change in the discount rate, for each kind of business.

B fails the stability check if I2 is more than 25% above A's, or the 95th percentile of I1 is more than 1.5 times A's:
advice that flips with every move in rates cannot be followed.

**B can be proposed for adoption only if all of these hold** (otherwise the fixed rates stay):

1. On the five-year periods of the 10-year test, B's final value beats A's in more periods than it loses.
2. B's shares of periods beating random halal stocks and beating the S&P 500 are not lower than A's.
3. B's worst fall is no more than 2 points deeper than A's.
4. 1 to 3 hold in both halves of the starting months (December 2016 to April 2019, and May 2019 to October 2021).
5. The extreme-scenario and stability checks pass.
6. At least three of S1 to S4 also meet 1 and 3, so the result does not hang on one setting.

Even then the change is shown to the owner and made only with his approval. Every run, its settings and its results
are kept, whatever they show.

**Known limits:** the 10-year data misses the companies that disappeared (VALIDATION.md, section 14), equally for A
and B; and one decade with one big rate cycle (0.62% in July 2020 to 5.13% in October 2026) is a small sample, so a
pass is evidence, not proof.

### 7.3 The final method, frozen before the first result: confidence, dependence, multiple measures, dividends and missing companies (measures, version 4)

Written on 3 November 2026 (UTC) at the owner's request, before any call has reached its first month. Where it differs
from sections 7.1 and 7.2, this section decides. It is final: nothing in it changes after a result is seen, and a change
the owner asks for before the first one-month results (early December 2026) is added as a dated amendment.

**Why 90%, and what replaces it.** Section 7.1 used a 90% two-sided interval, which is the same as a 95% one-sided
test: the usual level for a question with one direction (is this kind of call better than random?), and quicker to
show an effect with few calls. It is too lenient for declaring skill, because the calls are not independent and there
are many measures (both below). So the bar is now set by what each mistake costs:

- A pass (better than random halal stocks) needs a one-sided test at 2.5%, the same as a 95% two-sided interval,
  after a Holm correction across the six kinds of call, using the more cautious of the two resampling methods below.
- A warning comes sooner: a 90% interval wholly on the bad side, without correction, marks a kind of call as "worse
  than random, under review". A false alarm costs a review; a false pass could put money behind calls with no skill.

**Calls that are not independent.** Calls are correlated in three ways: calls made close together share most of their
measurement period (two 12-month periods a month apart overlap by 11 months); the same company can be called more
than once (a buy, then a pick, then a hold); and calls on the same day share the market's move. Pairing each call with
its own day's yardstick removes the shared market move. For the other two, the gap between the calls and the yardstick
is resampled in two ways, 2,000 times each with a fixed seed:

- by time: calls are grouped by the month they were made, and months are drawn in circular blocks of consecutive
  months as long as the horizon (12 months for the 12-month result, 1 for the 1-month read), so overlapping periods
  stay together;
- by company: companies are drawn with all their calls together.

Each bound uses the more cautious of the two (the lower of the two lower bounds, the higher of the two upper bounds),
and the test uses the larger of the two one-sided p-values. A result also needs calls in at least twice as many months
as its horizon (24 months for the 12-month result); with fewer, the page says the record is too short to judge. The
page shows how many non-overlapping 12-month periods the calls cover, so many calls made in one year are not taken for
a long record. This replaces the day resampling of section 7.1.

**Many measures.** Six kinds of call, four horizons and the other measures make dozens of comparisons. Tested one by
one at 5%, about one in twenty would look good by chance; across ten independent tests the chance of at least one
false pass is 40% (1 - 0.95^10). So only the six 12-month results are tested for a pass, as one family with the Holm
correction. The 1, 3 and 6-month reads are early reads and never pass. Measures 3 and 5 to 10 keep their thresholds
from section 7.2 but are supporting evidence: they can raise a warning or agree with a result, never establish skill
on their own. The 10-year test's five-year periods overlap too: its 59 periods hold about two independent five-year
spans, so its shares (beat random halal stocks, beat the S&P 500) describe the test; they are not 59 separate results.

**Dividends: never mixed.** Every return shown, for the calls, the random yardstick, the S&P 500, and the 10-year test
with its random picks, is measured on prices only until one source gives reliable dividend histories for every tracked
company and the S&P 500. Then every figure switches together, by a dated amendment, with the price-only figures kept
beside them. This replaces the per-call rule of section 7.2, which could have mixed the two. The page says prices only
wherever a return is shown.

**Missing companies.** The 10-year test lacks 44% of the companies an investor could have held in mid-2016
(VALIDATION.md, section 14), so its comparison with random halal stocks is not unbiased, and the gap can push the
strategy and the random picks in different directions:

- Bankruptcies (3.5%) and other collapses would have lowered the random picks' results; the strategy's quality and
  debt filters would probably have avoided many of them. Their absence probably understates the strategy's edge.
- Takeovers (28%) usually come at a premium. A strategy that buys cheap, sound companies may have held more takeover
  targets than random picks did; their absence may understate its returns, though some takeovers rescue failing firms.
- Companies that shrank or stopped being listed (8%), the cheap-for-a-reason "value traps": a strategy that buys
  below fair value is more exposed to them than random picks. Their absence may overstate its edge.
- Against the S&P 500, which has no such gap, the test's results are probably overstated.

The net direction cannot be measured with free data. The historical results are incomplete evidence: they can show a
large failure, not prove skill. Only the permanent record, complete from 3 November 2026 thanks to its own price
archive, can judge the system's skill.
