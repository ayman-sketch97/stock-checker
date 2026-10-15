# Stock Checker

Plain-English fundamental analysis of US-listed companies: quality, balance sheet, growth, fair value, a Shariah (AAOIFI-style) screen and a verdict, built from official SEC filings and Nasdaq prices.

The site is rebuilt every weekday after the US market closes by a GitHub Actions workflow (`.github/workflows/update-site.yml`), which runs `node tools/build-site.mjs` and publishes `site/` to GitHub Pages.

Educational tool, not financial advice. Always confirm halal status with a dedicated screener before investing.
