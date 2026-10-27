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

Written on 27 October 2026 at about 10:15 UTC. By then the first 10-year run, on the companies the site covers
today, had shown that the list did not beat the average halal stock. The wider run (every company worth $250 million
or more today) was still running and its results had not been seen.

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
