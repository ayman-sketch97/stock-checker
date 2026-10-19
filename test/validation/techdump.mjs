import { getNasdaqHistory } from '../../lib/data.js';
import { prepare, analyzeTechnical } from '../../lib/technical.js';
import fs from 'node:fs';
for (const t of process.argv.slice(2)) {
  const h = await getNasdaqHistory(t, 20000, 2);
  fs.writeFileSync(`${t}.daily.json`, JSON.stringify(h.daily));
  const P = prepare(h.daily);
  const k = P.n - 1;
  const pick = (a) => a.slice(-300);
  fs.writeFileSync(`${t}.ind.json`, JSON.stringify({ dates: pick(P.dates), e21: pick(P.e21), s50: pick(P.s50), s200: pick(P.s200), rsi: pick(P.r), macd: pick(P.m.line), sig: pick(P.m.signal), atr: pick(P.a) }));
  const T = analyzeTechnical(P);
  console.log(t, P.n, P.dates[0], P.dates[k], JSON.stringify(T.indicators), JSON.stringify(T.setup).slice(0, 300));
}
