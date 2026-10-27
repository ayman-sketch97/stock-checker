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
