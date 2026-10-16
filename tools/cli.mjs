// Command-line entry used by the in-Claude version: prints one line of JSON.
// node cli.mjs analyze AAPL   |   node cli.mjs search apple
import { loadCompanyData, searchTickers } from '../lib/data.js';
import { analyze } from '../lib/engine.js';
import { analyzeTechnical, techContextFrom } from '../lib/technical.js';

const [cmd, ...rest] = process.argv.slice(2);
const arg = rest.join(' ');
const out = (o) => process.stdout.write(JSON.stringify(o) + '\n');
try {
  if (cmd === 'search') {
    out({ ok: true, results: await searchTickers(arg, 8) });
  } else if (cmd === 'analyze') {
    const data = await loadCompanyData(arg);
    if (data.error) out({ ok: false, error: data.error, suggestions: data.suggestions || [] });
    else {
      const result = analyze(data);
      if (result.ok && data.price?.daily?.length) result.technical = analyzeTechnical(data.price.daily, techContextFrom(result));
      out(result);
    }
  } else {
    out({ ok: false, error: 'Unknown command' });
  }
} catch (e) {
  out({ ok: false, error: 'The data source did not respond properly. Please try again in a minute.', detail: String((e && e.message) || e).slice(0, 200) });
}
