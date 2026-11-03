// Makes test/fixtures/tech-ok.json: a full chart file for the KO test company, written by the site's own engine
// (lib/technical.js and lib/backtest.js) from a made-up but repeatable price series that ends at $50 on 2 Nov 2026.
// Run: node test/make-tech-fixture.mjs
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const { prepare, analyzeTechnical, techContextFrom } = await import(path.join(ROOT, 'lib/technical.js'));
const BT = await import(path.join(ROOT, 'lib/backtest.js'));
const LAST = '2026-11-02';
const LAST_CLOSE = 50;
let seed = 7;
const rnd = () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648;
const days = [];
const d = new Date(LAST + 'T12:00:00Z');
while (days.length < 1300) {
  if (d.getUTCDay() % 6) days.unshift(d.toISOString().slice(0, 10));
  d.setUTCDate(d.getUTCDate() - 1);
}
let p = 30;
const raw = days.map((date, i) => {
  const o = p;
  p *= 1 + 0.0004 + 0.0012 * Math.sin(i / 90) + (rnd() - 0.5) * 0.028;
  return { date, o, h: Math.max(o, p) * (1 + rnd() * 0.008), l: Math.min(o, p) * (1 - rnd() * 0.008), c: p, v: Math.round(8e6 + rnd() * 6e6) };
});
const k = LAST_CLOSE / raw.at(-1).c;
const r2 = (x) => Math.round(x * k * 100) / 100;
const daily = raw.map((x) => ({ date: x.date, o: r2(x.o), h: r2(x.h), l: r2(x.l), c: r2(x.c), v: x.v }));
const stock = JSON.parse(fs.readFileSync(path.join(ROOT, 'test/fixtures/stock-ok.json'), 'utf8'));
const P = prepare(daily);
const tech = analyzeTechnical(P, techContextFrom(stock));
tech.history = BT.stockHistory(BT.backtestStock(P, { years: 5, regimeAt: () => 'up' }));
if (tech.ok) tech.market = { regime: 'up' };
fs.writeFileSync(path.join(ROOT, 'test/fixtures/tech-ok.json'), JSON.stringify(tech) + '\n');
console.log(`tech-ok.json: ok ${tech.ok}, ${tech.asOf}, close ${tech.close}, ${tech.signals.length} signals, setup ${tech.setup.setup} (${tech.setup.status})`);
