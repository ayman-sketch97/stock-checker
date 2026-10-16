# Stock Checker

Plain-English analysis of US-listed companies, built from official SEC filings and Nasdaq prices.

- **Fundamental tab:** quality, balance sheet, growth, fair value, a Shariah (AAOIFI-style) screen, a verdict, and a long-term plan (buy below, trim above, and "sell if" rules).
- **Technical tab:** a daily chart with the 21 EMA, 50 and 200-day averages, RSI, MACD, volume, support and resistance, plus a long-only swing plan (entry trigger, stop, two targets, exits) and a position-size calculator.

The site is rebuilt every weekday morning (US time) by a GitHub Actions workflow (`.github/workflows/update-site.yml`), which runs `node tools/build-site.mjs` and publishes `site/` to GitHub Pages. Charts use [TradingView Lightweight Charts](https://github.com/tradingview/lightweight-charts) (Apache-2.0).

Educational tool, not financial advice. Always confirm halal status with a dedicated screener before investing.
