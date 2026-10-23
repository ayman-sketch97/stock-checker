// Daily prices for the backtest benchmark (btbench.py). SPY is fetched as an ETF, everything else as a stock.
// Usage: node test/validation/btfetch.mjs SPY AAPL MSFT ...   (writes hist.json in the current folder)
import fs from 'node:fs';
import { getNasdaqHistory } from '../../lib/data.js';

const out = {};
const queue = process.argv.slice(2);
await Promise.all(Array.from({ length: 4 }, async () => {
  while (queue.length) {
    const t = queue.shift();
    try {
      const h = await getNasdaqHistory(t, 20000, 2, t === 'SPY' ? 'etf' : 'stocks');
      out[t] = (h?.daily || []).map((x) => [x.date, x.c]);
    } catch (e) {
      out[t] = { err: e.message };
    }
  }
}));
fs.writeFileSync('hist.json', JSON.stringify(out));
console.log(`${Object.values(out).filter((v) => Array.isArray(v) && v.length > 500).length} of ${Object.keys(out).length} with 2+ years of prices`);
