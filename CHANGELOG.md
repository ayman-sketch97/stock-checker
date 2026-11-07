# Changelog

Dated record of changes that affect what the site tells you. The full history is in the git log; how each change was
checked is in `VALIDATION.md`.

## 7 November 2026: a ledger for your cash, trades, dividends and fees (stage 6)

- A new Portfolio ledger page records the money you put in and take out, your buys and sells, dividends, fees, and
  positions you already held. From that record alone it works out what you hold, the average cost of each position
  (buying fees included), the cash left, your realized profit from sales, your unrealized profit, dividends, fees and
  your total gain. A stock with no price is valued at what it cost, marked, and the total gain is withheld until every
  position has a price.
- It shows each position and each sector against your own limits (one stock up to 10% and trimmed back from 15%, one
  sector up to 40% of your long-term stocks, orders of at least $100, or whatever limits you saved). Before you record a
  buy it shows which rules the buy would break, including the Shariah ledger's answer. A buy that breaks a rule is
  recorded only after you confirm you did it anyway, and the rule check is saved with it. Selling shares you did not
  hold, or spending cash you did not record (borrowing), is refused.
- The record cannot be changed quietly: entries are never edited or removed, each carries the hash of the one before it,
  and a mistake is voided by a new entry that keeps the old one visible. The page compares the ledger with "Your
  portfolio now" and offers to start the ledger from the holdings already there.
- A value line is saved for each price date (only from a full valuation, never rewritten after its date), with a chart.
  The ledger and its history are in the backup file, and a backup from before this change still loads.
- Nothing that advises changed. Every verdict, signal, valuation formula, recommendation, risk limit, Shariah gate and
  permanent record is as before: the advice on the Portfolio page still reads the holdings entered there, and the same
  data shows the same advice word for word, apart from the new "Portfolio ledger" card.
- The ledger and "Your portfolio now" stay two separate records: the first records and measures, the second feeds the
  advice. Both places say so, their totals are never added together, and shares held in both are counted once.
- Limits: the ledger and the Portfolio page's holdings are two records you keep in step (the page shows where they
  differ); dividends and fees are what you type; average cost only, no tax lots, no splits or other corporate actions;
  all in US dollars; the value history starts on the first day it is saved. How it was checked and the full list of
  limits are in `VALIDATION.md`, section 22.

## 7 November 2026: why you own each stock, and a saved record of each call (stage 5, merged into main and live on 7 November 2026, Abu Dhabi time)

- A new Thesis page records, for any stock you own or consider, your reason, the case, the catalysts you expect, the
  risks, and the conditions that would prove you wrong, with the price and the data of the day it was written. Holdings
  with no thesis are listed on the Portfolio page.
- A change of mind is a new version with its reason. The original and every earlier version stay exactly as written, and
  the page shows what changed. A mistake is struck through, never removed, and an edited or removed entry is detected
  (the same tamper-evident chain as the Shariah ledger).
- A "Decision report" on the Portfolio page and on a company page explains a buy, hold, trim or sell call: the page's own
  reasons word for word, the fundamental, valuation, chart, risk and Shariah data of the day, and your thesis, with each
  condition you wrote marked met, not met or for you to judge. Press Save to keep the call and its evidence for judging
  it later. Decisions can only be saved for today.
- It records and explains only. No call, verdict, valuation, limit or Shariah check changed: the same-advice comparison
  against the current site is identical apart from the two new cards. It lives on this device and in the backup file.

## 6 November 2026: a Shariah compliance ledger that gates new buys (stage 4, merged into main and live on 6 November 2026)

- A new Shariah page records, for each stock you hold, what Zoya shows: the status, the date you checked it, the source
  and your evidence. It reminds you to recheck every 90 days, flags a stock that is missing, stale or unclear, and keeps
  a permanent, append-only history: entries are never edited or deleted, a mistake is struck through by a correction,
  and an edited or removed entry is detected.
- New buys are gated. A stock can be suggested for a new buy only when its newest ledger record is from Zoya, says
  compliant and is 90 days old or less. A missing, stale, uncertain, non-Zoya or not-compliant record blocks the buy and
  the page says why. The gate never sells and never decides compliance itself. Stock money the gate keeps out of
  stocks is shown on the monthly plan as cash held back, with the reason and the need for a current, verified Zoya
  compliant record. It is never moved to the index fund, a sukuk fund or anything else, and the 70/30 target does not
  change. When the record is entered, the normal plan returns.
- The 90-day exit countdown starts only when a stock that was compliant on Zoya is confirmed non-compliant, from the
  status-change date you enter. Missing, stale or uncertain data starts nothing and sells nothing.
- Purification is switched off. The earlier estimate and the calculator are removed; the page says purification waits for
  a method confirmed by a qualified Shariah scholar. You can still record an amount a scholar gave you; it is stored,
  never calculated.
- Valuation, recommendations, risk limits and the performance method did not change (VALIDATION.md, section 20).

## 6 November 2026: a data-problem warning on every advice page, and a way back for every deployment

- Every page that shows investment advice now carries a warning when the nightly health check has a failed item. It
  names which checks failed and what each can mean for the advice: price history unavailable (charts, swing signals and
  chart checks are missing or a day old), companies missing (a company may show yesterday's analysis), the track
  record not trusted, or another data problem. Prices that are late and prices that are merely not late are told
  apart. The Record page keeps its own full card. The warning is display only: no calculation, signal, risk limit or
  pause rule changed, and advice is not paused by it.
- Deployment: a verified copy of the version that is live is required before anything replaces it, and if it cannot be
  verified nothing is deployed. Every run is written to a permanent, append-only deployment log (the `deploy-log`
  branch) that says separately whether the night's recommendations were recorded and whether they were deployed.
  Nothing about the advice, the recommendation records or the performance method changed (VALIDATION.md, section 19).

## 6 November 2026: how sure each result is, with calls that overlap (stage 6)

- A kind of call now passes only if its lead over random halal stocks is unlikely to be chance even with all six kinds
  tested together (a one-sided test at 2.5% with a Holm correction, so 0.42% for the strictest), from a test that
  allows at once for calls made close together and for the same company called again and again. It also still needs
  no more wrong calls than random halal stocks. A 90% interval wholly on the bad side puts it under review, as a
  warning only. Before, a 90% interval decided.
- Checked by simulation before release: with no skill at all, the test passes a kind by chance in at most 1.7% of
  records; the resampling first approved did in 10% to 46%, so it was replaced before going live (PREREGISTERED.md,
  section 7.3.3). The cost: a real edge takes years to show, so most kinds will read "undecided" for a long time.
- A result needs calls made in at least 24 different months, and the page shows how many separate 12-month periods
  they cover. The 1 and 3-month columns are early reads, never a test of skill; the 12-month column shows each kind's
  tested verdict.
- The previous method (a 90% interval over the days of the calls) is still worked out and shown beside each verdict,
  for comparison only.
- One switch for dividends, off: prices only for the calls, random halal stocks and the S&P 500 alike, never mixed.
- The companies the 10-year test cannot see are described neutrally: the 44% gap, how it can affect the picks and
  random halal stocks differently, and that its direction and size cannot be measured with free data. The swing test
  says the same of its own gap. The 10-year test's 59 five-year periods are said to overlap (about two independent
  spans).
- The Treasury-linked discount rate study is closed: it failed all six conditions, the fixed 8%, 9% and 10% stay, and
  the study is kept in `studies/rate-study-2026-11/`.
- Rules: PREREGISTERED.md, sections 7.3 to 7.3.3 and 8.1, all written before any result. Record and display only: no
  advice, valuation, buy zone, sell decision or risk limit changes (checked: VALIDATION.md, section 18).

## 3 November 2026: calls measured to the end, and the missing companies disclosed (stage 6)

- Each kind of call (buy zone, long-term pick, medium-term pick, hold, sell, trim) is now shown after 12 months with
  its actual return, the S&P 500's, random halal stocks', how often it was wrong next to the random share, and pass,
  fail or undecided. Shown from 30 calls that have had their 12 months; provisional until 100. Rules fixed first in
  PREREGISTERED.md, section 7.2, before any result.
- The permanent record keeps its own nightly prices of every company in a call or a yardstick, so a company that is
  taken over, delisted or goes bankrupt is still followed to its last price. A call with no prices counts as wrong,
  never as a success. Dividends are not included yet: no free source gives them reliably, so the calls and the S&P
  500 are both measured on prices only, and the page says so.
- The 10-year test now says which companies it cannot see: of the companies large enough to hold in 2016, 44% are
  missing (34% have disappeared), because free price sources drop them. Measured from SEC filings.
- Record and display only: no advice changes.

## 3 November 2026: every result next to random halal stocks (stage 6)

- Each figure on the Record page now sits next to the same figure for every halal-pass company on the same days, with
  a verdict: better than random, worse, or no better so far (from a 90% interval; no verdict from calls on fewer than
  5 days). Written down first in PREREGISTERED.md, section 7.1, at your request.
- New: how often each kind of call went wrong over 12 months (a buy, pick or hold that trailed the S&P 500 by more
  than 10 points; a sell or trim whose stock beat it by more than 10), shown from 30 matured calls next to the random
  rate. Until then the page counts the calls that have had their 12 months.
- Display only: no advice changes.

## 3 November 2026: the record starts the hold calls (stage 6)

- From the next nightly run the record adds the call PREREGISTERED.md, section 7 asked for (measure 4, sales
  avoided): when a stock is 20% below the price of its first buy call while its verdict stays sound and it does not
  fail the halal screen, the rule says hold, not sell, and the record follows whether holding beat the S&P 500. The
  Record page shows these calls in their own row.
- The fall is measured on split-adjusted closes, so a stock split is not taken for a fall. Buy calls already in the
  record count from their own prices. Record files from now on carry version 2.
- Record only: no advice changes.

## 3 November 2026: system health on the Record page (stage 6)

- The nightly run now reports what it could and could not do: companies analysed and any failed downloads, price
  histories, verdicts withheld, the halal screen's counts, earnings dates, the S&P 500 data, the 10-year test (and
  whether it ran with your approved rules) and the permanent record.
- The Record page shows it first, together with how late today's prices are and whether last night's record reached
  GitHub, so a problem is visible before you read any result.
- Display only: it changes no advice. Late data already pauses advice on its own, and a run that analyses under 80% of
  the companies is not published.
- Corrected the same evening: the first night counted every company on the earnings calendar (3,255, more than the
  2,013 the site follows); it now counts only the companies analysed. The halal line now also shows the companies the
  tool cannot screen, so its four numbers add up to the companies analysed.

## 3 November 2026: the position-size rules made exact, your split next to the evidence, holdings by hand

- No buy may take a stock above 10% of everything you own. Before, a stock at 9.9% could still get a full month's buy
  and end well above 10%. The monthly plan caps each buy and sends what is left to the next stock or to the fund.
- A stock above 15% is trimmed back to 10% whatever the number of stocks (before, only from 10 stocks), with the amount
  to sell, on the Portfolio page, in the daily brief and on the Watchlist. The Watchlist's own portfolio check now
  uses the same limits. The Shortlist marks buy candidates your limits block. Orders under $100 are skipped.
- The Portfolio page shows your split (70% stocks, your choice) next to what the 10-year test supports (50%) and
  explains the gap; it no longer invites you to hand your split to the test. The Record page says the evidence is not
  your plan and names the rule set behind each number, with the original rules kept apart.
- Record a stock you own from its page ("I own it") or on the Portfolio page: shares, average cost and the date you
  bought it. Nothing is read from a broker.
- A halal fail now says your rule everywhere: sell within 90 days if Zoya confirms it.
- The 10-year test runs the same rules (`lib/policy.js`, identical in the page). The split the evidence supports is
  unchanged (half in stocks); details in `VALIDATION.md`, section 10.

## 3 November 2026: a stray "null" removed from "What to do now"

- Since stage 1 this morning, every company page printed the word "null" under "What to do now" whenever the data was
  up to date. The same slip could print it on the Record page and in the Technical tab's help; both are fixed.
- Without chart data, "What to do now" now shows the date of the closing price (it was blank) and can show the live
  price; before, it read "close on 2" as the date and hid live prices.
- The page tests now fail whenever a missing value would be printed as text, on every page they open.

## 3 November 2026: a premium look

- A soft aurora and dot grid behind every page, cards with a gradient edge, a glass navigation bar with a lit pill
  for the current page, and buttons with a sheen.
- A company now opens on a quote card: the price, its change, the last six months as a line and the 52-week range.
- Quality, growth and the balance sheet are shown as score rings; valuation and the halal screen as badges.
- List rows carry a thin stripe in the colour of the verdict, page titles the brand's gradient bar.
- Things rise into place when a page opens and the rings fill once. All motion is off when the phone asks for less
  motion, and every colour still comes from the light and dark themes.

## 3 November 2026: the Portfolio plan judged on many five-year periods (stage 6, part 1)

- One ten-year path depends on which stocks happened to be bought first. The 10-year test now also runs the plan over
  59 overlapping five-year periods, one starting each month, against random picks and the S&P 500, with pass marks
  written down before the run (`PREREGISTERED.md`, section 5).
- The long-term plan beat random picks in 64% of the periods and the S&P 500 in 68%; the medium-term plan in 92% and
  93%. The split if you let the test decide moves from 20% in stocks (one path) to 50%.
- The Record page shows the periods next to the single path, and how the ideas did 2 and 3 years later.

## 3 November 2026: the permanent record counts each call from the first close after it was published

- The first file of the record is dated 30 October (the latest closes the data had) but was published on the evening
  of 2 November. Its calls now count from 3 November's close; before, they were credited with 2 November's, which had
  already happened. The record's files are unchanged: only how results are worked out from them.
- On the first days, the Record page no longer shows an empty table of new calls.
- "Business weakened: sell" now counts only a move to "avoid" from a verdict that judged the business sound. A move
  from "not halal" to "avoid" only reveals a verdict that was hidden, and was being counted as a new sell call.

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
