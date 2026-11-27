// A Form 25-NSE is filed for exchange moves as well as real delistings (AAPL, KO, IBM and about 50 other large names carry one).
// The page must not call it a flat "warning sign" for every stock; deregistration forms (15-12B/G) stay a warning sign.
import { readFileSync } from 'node:fs';
import assert from 'node:assert/strict';
const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const m = /'25-NSE': \['([^']+)', '([a-z]*)'\]/.exec(html);
assert.ok(m, '25-NSE entry exists');
assert.equal(m[2], 'warn', '25-NSE is "worth reading", not a warning sign');
assert.match(m[1], /moving to another exchange/);
assert.match(m[1], /leaving the market/);
assert.match(html, /'15-12B': \['[^']+', 'bad'\]/);
assert.match(html, /'15-12G': \['[^']+', 'bad'\]/);
console.log('ok   25-NSE wording');
