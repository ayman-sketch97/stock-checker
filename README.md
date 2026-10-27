# Stock Checker

Plain-English analysis of US-listed companies, built from official SEC filings and Nasdaq prices.

- **Home:** a daily brief on the stocks you own and follow: what to do today (if anything), holdings that are down but still healthy, what changed, the companies' own news from their SEC filings, and ideas for new money.
- **Fundamental tab:** quality, balance sheet, growth, fair value, a Shariah (AAOIFI-style) screen, a verdict, a long-term plan (buy below, trim above, and "sell if" rules), dividends with a purification calculator, and a comparison with similar-sized peers.
- **Technical tab:** a daily chart with the 21 EMA, 50 and 200-day averages, RSI, MACD, volume, support and resistance, plus a long-only swing plan (the exact order for the next session, stop, two targets, exits), a position-size calculator, earnings and market-trend warnings, and how the same rules did on that stock and across all stocks.
- **Shortlist:** every company worth $2 billion or more, screened each morning into lists (swing buy signals, quality below fair value, near the buy price, market leaders, dividend payers) with halal, sector, size, strength and earnings filters.
- **Watchlist:** companies you follow and your positions, kept in your browser only, with alerts for verdict and halal changes, new signals, earnings dates, and your own stop and target levels. A sync link copies it to another device.
- **Portfolio:** a target mix (halal index fund and stocks, optionally set by the 10-year test), advice on each holding (sell only when the business weakens or the halal screen fails), and where this month's money goes.
- **Record:** a 10-year test of the long-term picks (each month-end replayed with only the filings known then; rules for judging fixed in advance in `PREREGISTERED.md`, re-run monthly by `.github/workflows/lt-backtest.yml`), a backtest of the swing rules on five years of prices, and a live log of every halal signal since the site started.

The site is rebuilt every weekday morning (US time) by a GitHub Actions workflow (`.github/workflows/update-site.yml`), which runs `node tools/build-site.mjs` and publishes `site/` to GitHub Pages. The live signal log is carried from one day's site to the next (`data/signals.json`). Charts use [TradingView Lightweight Charts](https://github.com/tradingview/lightweight-charts) (Apache-2.0).

Code map: `lib/data.js` (network), `lib/engine.js` (fundamentals), `lib/technical.js` (indicators, setups, trade simulation), `lib/backtest.js` (track record), `lib/signals.js` (live log), `lib/longterm.js` and `lib/ltstats.js` (10-year test), `tools/build-site.mjs` (daily build), `index.html` (the whole page).

Educational tool, not financial advice. Always confirm halal status with a dedicated screener before investing.
