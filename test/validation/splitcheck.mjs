// Stock splits found in the filings (share counts restated by a later annual report), next to any splits the price
// provider reports. Usage: node test/validation/splitcheck.mjs NVDA AVGO CMG WMT AAPL GOOGL
import { loadCompanyData } from '../../lib/data.js';
import { FactBook, splitsFromRestatements } from '../../lib/engine.js';

for (const t of process.argv.slice(2)) {
  const d = await loadCompanyData(t);
  const found = splitsFromRestatements(new FactBook(d.facts)).map((s) => `${s.ratio.toFixed(3)}x (first restated filing ${s.date})`);
  const px = (d.price?.splits || []).map((s) => `${s.ratio}x on ${s.date}`);
  console.log(t.padEnd(6), 'filings:', found.join(', ') || 'none', '| price data:', px.join(', ') || 'none');
}
