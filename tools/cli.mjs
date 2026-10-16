// Command-line entry used by the in-Claude version: prints one line of JSON.
// node cli.mjs analyze AAPL   |   node cli.mjs search apple
// The technical analysis is written next to this file as tech-<TICKER>.b64 (gzip + base64), because the
// connection that carries the output to the page truncates long replies; the page reads that file separately.
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { loadCompanyData, searchTickers } from '../lib/data.js';
import { analyze } from '../lib/engine.js';
import { analyzeTechnical, techContextFrom } from '../lib/technical.js';

const [cmd, ...rest] = process.argv.slice(2);
const arg = rest.join(' ');
const out = (o) => process.stdout.write(JSON.stringify(o) + '\n');
const here = path.dirname(path.resolve(process.argv[1] || '.'));
try {
  if (cmd === 'search') {
    out({ ok: true, results: await searchTickers(arg, 8) });
  } else if (cmd === 'analyze') {
    const data = await loadCompanyData(arg);
    if (data.error) out({ ok: false, error: data.error, suggestions: data.suggestions || [] });
    else {
      const result = analyze(data);
      if (result.ok && result.ticker) {
        const file = path.join(here, `tech-${String(result.ticker).replace(/[^A-Z0-9.-]/gi, '')}.b64`);
        try {
          if (data.price?.daily?.length) {
            const tech = analyzeTechnical(data.price.daily, techContextFrom(result));
            fs.writeFileSync(file, zlib.gzipSync(JSON.stringify(tech), { level: 9 }).toString('base64'));
          } else fs.rmSync(file, { force: true });
        } catch {
          /* the fundamental result still goes out */
        }
      }
      out(result);
    }
  } else {
    out({ ok: false, error: 'Unknown command' });
  }
} catch (e) {
  out({ ok: false, error: 'The data source did not respond properly. Please try again in a minute.', detail: String((e && e.message) || e).slice(0, 200) });
}
