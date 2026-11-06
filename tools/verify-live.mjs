// After a deployment: read the LIVE site and confirm it is the commit that was deployed.
//   node tools/verify-live.mjs <site url> <expected commit> [--wait 300]
// Retries while GitHub Pages and its cache catch up (up to --wait seconds), then fails. Reads only.
import { pathToFileURL } from 'node:url';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export async function verifyOnce(base, commit, fetchImpl = fetch) {
  const root = base.replace(/\/?$/, '/');
  const bust = `?verify=${Date.now()}`;
  const get = async (rel) => {
    const res = await fetchImpl(root + rel + bust, { headers: { 'cache-control': 'no-cache' } });
    return { status: res.status, text: await res.text() };
  };
  const page = await get('');
  if (page.status !== 200) return { ok: false, why: `the page answered ${page.status}` };
  if (page.text.includes('/*BUILD:MODE*/')) return { ok: false, why: 'the live page is the unbuilt template' };
  const h = await get('data/health.json');
  if (h.status !== 200) return { ok: false, why: `data/health.json answered ${h.status}` };
  let health;
  try { health = JSON.parse(h.text); } catch { return { ok: false, why: 'data/health.json is not valid JSON' }; }
  if (health.commit !== commit) return { ok: false, why: `live is commit ${String(health.commit || 'unknown').slice(0, 7)}, expected ${commit.slice(0, 7)}`, live: health.commit };
  return { ok: true, live: health.commit, builtAt: health.builtAt, priceDate: health.priceDate };
}

export async function verifyLive(base, commit, { waitSeconds = 300, everySeconds = 15, fetchImpl = fetch, log = console.log } = {}) {
  const deadline = Date.now() + waitSeconds * 1000;
  let last;
  for (;;) {
    try { last = await verifyOnce(base, commit, fetchImpl); } catch (e) { last = { ok: false, why: `could not read the site (${e.message})` }; }
    if (last.ok) return last;
    log(`not yet: ${last.why}`);
    if (Date.now() + everySeconds * 1000 > deadline) return last;
    await sleep(everySeconds * 1000);
  }
}

if (import.meta.url === pathToFileURL(process.argv[1] || '').href) {
  const [base, commit] = process.argv.slice(2);
  const wi = process.argv.indexOf('--wait');
  const wait = wi > 0 ? Number(process.argv[wi + 1]) : 300;
  if (!base || !commit) { console.error('usage: node tools/verify-live.mjs <site url> <commit> [--wait seconds]'); process.exit(2); }
  const r = await verifyLive(base, commit, { waitSeconds: wait });
  if (!r.ok) { console.log(`::error::Live verification FAILED: ${r.why}`); process.exit(1); }
  console.log(`Live verification passed: ${base} serves commit ${r.live}, built ${r.builtAt}, prices of ${r.priceDate}.`);
}
