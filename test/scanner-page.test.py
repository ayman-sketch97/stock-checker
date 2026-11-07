# Page tests for stage 8 (screener and market data): the Swing scanner page, the Shortlist strategy filter, the daily and weekly
# chart with Bollinger Bands, opportunity tracking on the Watchlist, the link into the Stage 7 investment report, and the
# price-freshness wording.
# Run: python3 test/scanner-page.test.py   (needs Python Playwright with Chromium; serves the page locally, no network;
# the pinned chart library is read from LWC_FILE or node_modules, and the chart checks are skipped, loudly, if it is missing)
import asyncio, datetime as dt, http.server, json, os, re, shutil, sys, tempfile, threading
from playwright.async_api import async_playwright

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
FIX = os.path.join(ROOT, 'test', 'fixtures')
LWC_FILE = os.environ.get('LWC_FILE') or os.path.join(ROOT, 'node_modules/lightweight-charts/dist/lightweight-charts.standalone.production.js')
failures = []


def check(cond, msg):
    print(('ok   ' if cond else 'FAIL ') + msg)
    if not cond:
        failures.append(msg)


def serve():
    d = tempfile.mkdtemp()
    html = open(os.path.join(ROOT, 'index.html'), encoding='utf-8').read()
    html = html.replace("const MODE = 'server'; /*BUILD:MODE*/", "const MODE = 'static';")
    open(os.path.join(d, 'index.html'), 'w', encoding='utf-8').write(html)
    # the site's own font, served next to the page as on the real site: without it a runner falls back to a wider system font and the tab labels measure differently
    shutil.copytree(os.path.join(ROOT, 'fonts'), os.path.join(d, 'fonts'))

    class Quiet(http.server.SimpleHTTPRequestHandler):
        def log_message(self, *a):
            pass
    handler = lambda *a, **k: Quiet(*a, directory=d, **k)
    httpd = http.server.ThreadingHTTPServer(('127.0.0.1', 0), handler)
    threading.Thread(target=httpd.serve_forever, daemon=True).start()
    return httpd, d


def weekday_back(n):
    d = dt.date.today()
    while n > 0:
        d -= dt.timedelta(days=1)
        if d.weekday() < 5:
            n -= 1
    return d.isoformat()


STRAY_CHILD = r"""(() => {
  for (const proto of [Element.prototype, Document.prototype, DocumentFragment.prototype, CharacterData.prototype]) for (const m of ['append', 'prepend', 'replaceChildren', 'before', 'after', 'replaceWith']) {
    if (!Object.prototype.hasOwnProperty.call(proto, m)) continue;
    const f = proto[m];
    proto[m] = function (...xs) {
      if (xs.some((x) => x === null || x === undefined || typeof x === 'boolean')) console.error(`stray child: ${m} ${(new Error().stack.split('\n')[2] || '').trim()}`);
      return f.apply(this, xs);
    };
  }
})();"""

# one current Zoya check that says compliant for each ticker, written by the page's own code (as in test/page.test.py)
SEED_LEDGER = r"""(ts) => { const S = window.__sc.shariah; const p = (n) => String(n).padStart(2, '0'); const d = new Date(); d.setDate(d.getDate() - 3);
  const checked = `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`; const t0 = new Date(); const today = `${t0.getFullYear()}-${p(t0.getMonth() + 1)}-${p(t0.getDate())}`;
  let e = []; for (const t of ts) e = S.appendEntry(e, { kind: 'check', t, status: 'compliant', checked, source: 'zoya_app', evidence: 'test fixture: a Zoya screen' }, today, new Date().toISOString()).entries;
  localStorage.setItem('shariah', JSON.stringify({ v: 1, entries: e })); localStorage.setItem('shariah_anchor', JSON.stringify(S.anchorOf(e))); }"""


def scanner_file(price_date, late_days=0):
    f = json.load(open(os.path.join(FIX, 'scanner-ok.json')))
    f['priceDate'] = price_date
    for r in f['rows']:
        r['asOf'] = price_date
    return f


def bt_summary(proven):
    bt = json.load(open(os.path.join(FIX, 'backtest-summary.json')))
    if proven:
        bt['liveProof'] = {'months': 8, 'n': 60, 'needMonths': 6, 'horizon': 20, 'avgDiff': 0.02, 'proven': True}
    else:
        bt['liveProof'] = {'months': 1, 'n': 4, 'needMonths': 6, 'horizon': 20, 'avgDiff': 0.0, 'proven': False}
    return bt


async def page_with(ctx, base, price_date, storage=None, path='', stock=None, extra=None, proven=False, scanner='ok', chart=False, zoya=None):
    screen = json.load(open(os.path.join(FIX, 'screen.json')))
    index = json.load(open(os.path.join(FIX, 'index.json')))
    screen['priceDate'] = index['priceDate'] = price_date
    scan = scanner_file(price_date) if scanner == 'ok' else scanner

    async def route(r):
        u = r.request.url
        for k, v in (extra or {}).items():
            if k in u:
                await r.fulfill(status=200, body=json.dumps(v), headers={'content-type': 'application/json'})
                return
        if 'data/scanner.json' in u:
            if scan is None:
                await r.fulfill(status=404, body='')
            else:
                await r.fulfill(status=200, body=json.dumps(scan), headers={'content-type': 'application/json'})
        elif 'data/screen.json' in u:
            await r.fulfill(status=200, body=json.dumps(screen), headers={'content-type': 'application/json'})
        elif stock and re.search(r'/data/KO\.json', u):
            await r.fulfill(status=200, body=open(os.path.join(FIX, stock + '.json')).read(), headers={'content-type': 'application/json'})
        elif 'data/backtest-summary.json' in u:
            await r.fulfill(status=200, body=json.dumps(bt_summary(proven)), headers={'content-type': 'application/json'})
        elif 'data/index.json' in u:
            await r.fulfill(status=200, body=json.dumps(index), headers={'content-type': 'application/json'})
        elif u.endswith('vendor/lightweight-charts.js') and chart:
            await r.fulfill(status=200, body=open(LWC_FILE).read(), headers={'content-type': 'application/javascript'})
        else:
            await r.fulfill(status=404, body='')
    pg = await ctx.new_page()
    errs = []
    pg.on('pageerror', lambda e: errs.append(str(e)))
    pg.on('console', lambda m: errs.append(m.text) if m.text.startswith('stray child') else None)
    await pg.add_init_script(STRAY_CHILD)
    await pg.route(re.compile(r'.*(/data/|quotes\.json|vendor/).*'), route)
    await pg.goto(base + '?selftest=1&p=stock')  # the tests' default page is the Search page; the default landing is the Dashboard (test/dashboard-page.test.py)
    if storage is not None or zoya:
        await pg.evaluate('(s) => { localStorage.clear(); for (const [k, v] of Object.entries(s)) localStorage.setItem(k, JSON.stringify(v)); }', storage or {})
        if zoya:
            await pg.evaluate(SEED_LEDGER, list(zoya))
    await pg.goto(base + '?selftest=1' + (path or '&p=stock'))
    await pg.wait_for_timeout(1200)
    return pg, errs


async def main():
    httpd, tmp = serve()
    base = f'http://127.0.0.1:{httpd.server_address[1]}/'
    fresh = weekday_back(1)
    tech_ok = json.load(open(os.path.join(FIX, 'tech-ok.json')))
    ext_ok = json.load(open(os.path.join(FIX, 'tech-ext-ok.json')))
    async with async_playwright() as p:
        b = await p.chromium.launch()
        ctx = await b.new_context()

        # ---- the scanner page: contents, order and the paper-only wording
        pg, errs = await page_with(ctx, base, fresh, {}, '&p=scanner')
        txt = await pg.inner_text('#page-scanner')
        rows = await pg.locator('#page-scanner details.scan-row').all()
        check(len(rows) == 3, f'the scanner lists the three stocks the file lists: {len(rows)}')
        order = [(await r.locator('.tk').inner_text()).strip() for r in rows]
        check(order == ['AAPL', 'MSFT', 'KO'], f'ranked by evidence score, ties A to Z: {order}')
        check('Swing scanner' in txt and 'not buy signals' in txt, 'the page says these are ideas, not buy signals')
        check(txt.count('Paper only') == 3, f'every candidate is marked paper only: {txt.count("Paper only")}')
        check('Paper trade only.' in txt and 'Zoya is the final authority' in txt, 'the status card says paper only and that Zoya is the final authority')
        check('End-of-day closes' in txt and 'Not real-time' in txt, 'prices are labelled end-of-day and not real-time')
        check(not re.search(r'(?i)\blive (price|quote|chart|data)|real-time price', txt.replace('Not real-time', '')), 'no delayed or end-of-day price is called live')
        check('1 left out by the Shariah screen' in txt and '1 setup left out for missing or unreliable data' in txt, f'the counts of left-out stocks are shown: {txt[txt.find("candidate"):][:230]!r}')
        check('JNJ' not in txt and 'XYZ' not in txt, 'a stock left out for earnings or for the Shariah screen is not listed')
        check(not re.search(r'\bnull\b|\bundefined\b|\bNaN\b', txt), 'no missing values printed')
        first = rows[0]
        check('Entry set for next session' in await first.inner_text() and 'Buy only above' in await first.inner_text(), 'a ready candidate shows its entry price')
        check('Entry zone' in await rows[1].inner_text() and 'Watch: no entry today' in await rows[1].inner_text(), 'a momentum candidate has an entry zone and no entry today')
        check('reward/risk' in await first.inner_text() and 'stop' in await first.inner_text() and 'target 1' in await first.inner_text(), 'stop, target and reward/risk are shown')
        await first.locator('summary').click()
        full = await first.inner_text()
        check('Why it is listed' in full and 'What would make it wrong' in full and 'The evidence checklist (10 of 11 met)' in full, 'an expanded row explains why, what invalidates it, and the checklist')
        check(await first.locator('table.scan-checks tbody tr').count() == 11, 'the checklist has 11 checks')
        check('Not eligible for real money now' in full and 'no record in your Shariah ledger' in full, 'without a ledger entry the row says it is not eligible, and why')
        check('Paper only: practise this' in full, 'the paper-only instruction is shown')
        check('Blocked: no Zoya record' in await first.inner_text(), 'the ledger gate tag is shown on the row')
        check(not errs, f'no page errors on the scanner {errs}')
        await pg.close()

        # ---- with a current Zoya check in the ledger
        pg, errs = await page_with(ctx, base, fresh, {}, '&p=scanner', zoya=['AAPL', 'MSFT', 'KO'])
        t = await pg.inner_text('#page-scanner')
        check(t.count('Zoya check current') == 3 and 'Blocked' not in t, 'with current Zoya checks the rows say so and nothing is blocked')
        check(t.count('Paper only') == 3, 'a current Zoya check does not remove the paper-only label')
        await pg.close()
        pg, errs = await page_with(ctx, base, fresh, {}, '&p=scanner')
        await pg.locator('label.chk:has-text("Only with a current Zoya check") input').check()
        await pg.wait_for_timeout(300)
        check(await pg.locator('#page-scanner details.scan-row').count() == 0, 'the Zoya filter hides every row when the ledger is empty')
        await pg.close()

        # ---- after the live record passes its gate
        pg, errs = await page_with(ctx, base, fresh, {}, '&p=scanner', proven=True, zoya=['AAPL'])
        t = await pg.inner_text('#page-scanner')
        check('The live record has passed its gate.' in t and t.count('Paper only') == 0, 'when the gate has passed the paper-only label is gone')
        check(t.count('Meets the live rules') == 1 and t.count('Blocked: no Zoya record') == 2, 'only the stock with a current Zoya check meets the live rules; the others stay blocked')
        check('still only an idea' in t, 'the page still calls a candidate an idea')
        await pg.locator('#page-scanner details.scan-row').first.locator('summary').click()
        check('0.5%' in await pg.inner_text('#page-scanner details.scan-row'), 'the 0.5% portfolio risk rule is quoted only when trading is approved')
        await pg.close()
        pg, errs = await page_with(ctx, base, fresh, {}, '&p=scanner')
        await pg.locator('#page-scanner details.scan-row').first.locator('summary').click()
        check('0.5%' not in await pg.inner_text('#page-scanner details.scan-row'), 'the 0.5% rule is not applied while the strategy is paper only')
        await pg.close()

        # ---- filters
        pg, errs = await page_with(ctx, base, fresh, {}, '&p=scanner')
        await pg.select_option('#page-scanner select[aria-label="Setup type"]', 'momentum')
        await pg.wait_for_timeout(300)
        r = await pg.locator('#page-scanner details.scan-row .tk').all_inner_texts()
        check(r == ['MSFT'], f'the setup filter keeps only momentum: {r}')
        await pg.select_option('#page-scanner select[aria-label="Setup type"]', '')
        await pg.select_option('#page-scanner select[aria-label="Evidence"]', '75')
        await pg.wait_for_timeout(300)
        r = await pg.locator('#page-scanner details.scan-row .tk').all_inner_texts()
        check(r == ['AAPL', 'MSFT'], f'the evidence filter keeps 75 and above: {r}')
        await pg.select_option('#page-scanner select[aria-label="Evidence"]', '0')
        await pg.select_option('#page-scanner select[aria-label="Signal"]', 'squeeze')
        await pg.wait_for_timeout(300)
        r = await pg.locator('#page-scanner details.scan-row .tk').all_inner_texts()
        check(r == ['AAPL'], f'the signal filter keeps the Bollinger squeeze: {r}')
        await pg.close()

        # ---- data problems: no candidates are shown
        pg, errs = await page_with(ctx, base, fresh, {}, '&p=scanner', scanner=None)
        t = await pg.inner_text('#page-scanner')
        check('scanner file could not be loaded' in t and await pg.locator('details.scan-row').count() == 0, 'a missing scanner file shows an error and no candidates')
        await pg.close()
        late = weekday_back(6)
        pg, errs = await page_with(ctx, base, fresh, {}, '&p=scanner', scanner=scanner_file(late))
        t = await pg.inner_text('#page-scanner')
        check('Scanner paused' in t and await pg.locator('details.scan-row').count() == 0, 'a scanner file that is days late is paused and shows no candidates')
        await pg.close()
        bad = scanner_file(fresh)
        bad['earningsCalendar'] = {'status': 'unavailable', 'days': 0, 'failures': 9, 'from': None, 'to': None}
        bad['rows'] = []
        pg, errs = await page_with(ctx, base, fresh, {}, '&p=scanner', scanner=bad)
        t = await pg.inner_text('#page-scanner')
        check('earnings calendar could not be read' in t and 'no candidate is listed' in t, 'an unreadable earnings calendar is said plainly')
        await pg.close()

        # ---- tracking an idea on the Watchlist, and following it on paper
        aapl_tech = {'ok': True, 'chart': {'candles': [[fresh, 49.6, 50.4, 49.2, 50, 1000000], ['2999-01-02', 50.2, 51.5, 50.1, 51.2, 1000000], ['2999-01-03', 51.2, 52.5, 51, 52.2, 1000000]]}}
        pg, errs = await page_with(ctx, base, fresh, {}, '&p=scanner', extra={'data/tech/AAPL.json': aapl_tech})
        row = pg.locator('#page-scanner details.scan-row').first
        await row.locator('summary').click()
        await row.locator('button:has-text("Track on the Watchlist")').click()
        await pg.wait_for_timeout(300)
        w = await pg.evaluate("JSON.parse(localStorage.getItem('watch'))")
        it = next((i for i in w['items'] if i['t'] == 'AAPL'), None)
        o = it and it.get('opp')
        check(bool(o) and o['entry'] == 50.5 and o['stop'] == 47.5 and o['t1'] == 57 and o['paper'] is True and o['asOf'] == fresh, f'the idea is saved with its plan as it stood: {o}')
        check(await row.locator('button:has-text("Tracking on the Watchlist")').is_disabled(), 'the track button is disabled once saved')
        await pg.goto(base + '?selftest=1&p=watchlist')
        await pg.wait_for_timeout(1200)
        wl = await pg.inner_text('#page-watchlist')
        check('Tracked swing ideas (1)' in wl and 'Open on paper' in wl and 'Paper' in wl, f'the Watchlist follows it: {wl[wl.find("Tracked"):][:260]!r}')
        check('No order is placed' in wl and 'not a track record' in wl, 'the Watchlist says it is bookkeeping, not a track record')
        check('stop 47.50' in wl.replace('$', '') or '$47.50' in wl, 'the saved stop is shown')
        await pg.locator('#page-watchlist button:has-text("Stop tracking")').click()
        await pg.wait_for_timeout(500)
        w = await pg.evaluate("JSON.parse(localStorage.getItem('watch'))")
        check(not any('opp' in i and i['opp'] for i in w['items']) and any(i['t'] == 'AAPL' for i in w['items']), 'stopping tracking removes only the paper idea; the stock stays on the Watchlist')
        check(not errs, f'no page errors tracking an idea {errs}')
        await pg.close()
        # no prices to follow: said, not guessed
        pg, errs = await page_with(ctx, base, fresh, {'watch': {'v': 1, 'items': [{'t': 'AAPL', 'added': fresh, 'addPx': 50, 'opp': {'v': 1, 'setup': 'pullback', 'added': fresh, 'asOf': fresh, 'entry': 50.5, 'stop': 47.5, 't1': 57, 'score': 90, 'paper': True}}], 'snap': None, 'prev': None}}, '&p=watchlist')
        wl = await pg.inner_text('#page-watchlist')
        check('No prices today' in wl and 'cannot be worked out' in wl, 'without price history the outcome is reported as unknown')
        await pg.close()

        # ---- the link into the Stage 7 investment report
        pg, errs = await page_with(ctx, base, fresh, {}, '&p=scanner', stock='stock-ok', extra={'data/tech/KO.json': tech_ok})
        ko = pg.locator('#page-scanner details.scan-row', has_text='KO')
        await ko.locator('summary').click()
        await ko.locator('button:has-text("Open the investment report")').click()
        await pg.wait_for_timeout(2500)
        check('report=swing' in pg.url and 't=KO' in pg.url, f'the link carries the ticker and the swing strategy: {pg.url}')
        pressed = await pg.locator('section[aria-label="Investment report"] .chip[aria-pressed="true"]').all_inner_texts()
        rep = await pg.inner_text('section[aria-label="Investment report"]')
        check(len(pressed) == 1 and pressed[0].startswith('Swing trading'), f'the swing report opens by itself: {pressed}')
        check('Swing trading' in rep and ('Paper' in rep or 'paper' in rep), f'the report is the Stage 7 swing report, paper only: {rep[:400]!r}')
        check(not errs, f'no page errors opening the report {errs}')
        await pg.close()

        # ---- the Shortlist strategy filter
        pg, errs = await page_with(ctx, base, fresh, {}, '&p=shortlist')
        strat = await pg.locator('#page-shortlist .strategies button').all_inner_texts()
        check(strat == ['All strategies', 'Long-term investing (1 to 5 years or more)', 'Position investing (weeks to months)', 'Swing trading (days to weeks)'], f'the three Stage 7 strategies are offered: {strat}')
        await pg.click('#page-shortlist .strategies button:has-text("Swing trading")')
        await pg.wait_for_timeout(500)
        lists = await pg.locator('#page-shortlist .presets button').all_inner_texts()
        check(lists == ['Swing signals', 'Swing scanner'], f'the swing strategy shows the swing lists and the scanner: {lists}')
        await pg.click('#page-shortlist .strategies button:has-text("Long-term")')
        await pg.wait_for_timeout(500)
        lists = await pg.locator('#page-shortlist .presets button').all_inner_texts()
        check(lists == ['Quality on sale', 'Near buy price', 'Dividends'], f'the long-term strategy shows the fundamental lists: {lists}')
        pressed = await pg.locator('#page-shortlist .presets button[aria-pressed="true"]').all_inner_texts()
        check(len(pressed) == 1, f'one list is selected: {pressed}')
        await pg.click('#page-shortlist .strategies button:has-text("Position")')
        await pg.wait_for_timeout(500)
        check(await pg.locator('#page-shortlist .presets button').all_inner_texts() == ['Leaders'], 'the position strategy shows the leaders list')
        await pg.click('#page-shortlist .strategies button:has-text("Swing trading")')
        await pg.click('#page-shortlist .presets button:has-text("Swing scanner")')
        await pg.wait_for_timeout(900)
        check('p=scanner' in pg.url and await pg.locator('#page-scanner details.scan-row').count() == 3, 'the Swing scanner button opens the scanner')
        check(await pg.locator('#nav button[aria-current="page"]').inner_text() == 'Shortlist', 'the scanner sits under the Shortlist in the navigation')
        check(not errs, f'no page errors on the strategy filter {errs}')
        await pg.close()

        # ---- the chart: daily and weekly, Bollinger Bands, and where the prices come from
        if not os.path.exists(LWC_FILE):
            if os.environ.get('CI'):
                check(False, 'the pinned chart library is installed (the chart checks cannot be skipped in CI)')
            else:
                print('SKIP chart checks: the chart library is not installed (npm install lightweight-charts@5.2.1, or set LWC_FILE)')
        else:
            pg, errs = await page_with(ctx, base, fresh, {}, '', stock='stock-ok', extra={'data/tech/KO.json': tech_ok, 'data/tech-ext/KO.json': ext_ok}, chart=True)
            await pg.goto(base + '?selftest=1&t=KO')
            await pg.wait_for_timeout(1500)
            await pg.locator('button:has-text("Technical")').first.click()
            await pg.wait_for_timeout(2500)
            card = pg.locator('section[aria-label="Price chart"]')
            tf = await card.locator('[aria-label="Timeframe"] button').all_inner_texts()
            check(tf == ['Daily', 'Weekly'], f'the chart offers daily and weekly: {tf}')
            src = await card.locator('.chart-src').inner_text()
            check('Nasdaq end-of-day prices' in src and 'Not real-time' in src and 'Nov 2' in src, f'the chart says where the prices come from and how old they are: {src!r}')
            check(await card.locator('canvas').count() > 0, 'the daily chart is drawn')
            check(await card.locator('button:has-text("Bollinger Bands (20, 2)")').count() == 1, 'the Bollinger Bands toggle is offered')
            leg0 = await card.locator('.legend').inner_text()
            check('Bands' not in leg0, 'the bands are off until switched on')
            await card.locator('button:has-text("Bollinger Bands (20, 2)")').click()
            await pg.wait_for_timeout(300)
            leg1 = await card.locator('.legend').inner_text()
            check(re.search(r'Bands \d+\.\d+ to \d+\.\d+', leg1) is not None, f'switching them on shows the band values: {leg1[-60:]!r}')
            await card.locator('[aria-label="Timeframe"] button:has-text("Weekly")').click()
            await pg.wait_for_timeout(1500)
            src = await card.locator('.chart-src').inner_text()
            keys = await card.locator('.pane-keys').inner_text()
            leg = await card.locator('.legend').inner_text()
            check('Weekly candles built by this site' in src and 'in progress' in src and 'Not real-time' in src, f'the weekly chart says how it is built: {src!r}')
            check('21-week EMA' in leg and '50-week SMA' in leg and '200-week SMA' in leg and 'Week to' in leg, f'weekly averages are named as weekly: {leg[:150]!r}')
            check('Each candle is one week' in keys, 'the weekly chart explains its candles')
            ranges = await card.locator('.ranges button').all_inner_texts()
            check(ranges[-3:] == ['6M', '1Y', '3Y'], f'weekly ranges are in weeks: {ranges}')
            check(await card.locator('canvas').count() > 0 and 'could not load' not in await card.inner_text(), 'the weekly chart is drawn')
            await pg.reload()
            await pg.wait_for_timeout(1500)
            await pg.locator('button:has-text("Technical")').first.click()
            await pg.wait_for_timeout(2000)
            check(await pg.locator('section[aria-label="Price chart"] [aria-label="Timeframe"] button[aria-pressed="true"]').inner_text() == 'Weekly', 'the chosen timeframe is remembered on this device')
            check(not errs, f'no page errors on the charts {errs}')
            await pg.close()
            # without the extra file there is a daily chart and no weekly view
            pg, errs = await page_with(ctx, base, fresh, {}, '', stock='stock-ok', extra={'data/tech/KO.json': tech_ok}, chart=True)
            await pg.goto(base + '?selftest=1&t=KO')
            await pg.wait_for_timeout(1500)
            await pg.locator('button:has-text("Technical")').first.click()
            await pg.wait_for_timeout(2000)
            card = pg.locator('section[aria-label="Price chart"]')
            check(await card.locator('[aria-label="Timeframe"] button:has-text("Weekly")').is_disabled(), 'without the weekly file the weekly button is off')
            check('Bollinger Bands are not available' in await card.locator('.chart-src').inner_text() and await card.locator('button:has-text("Bollinger Bands")').count() == 0, 'without the file the bands are not offered, and the page says so')
            check(await card.locator('canvas').count() > 0, 'the daily chart still draws')
            check(not errs, f'no page errors without the weekly file {errs}')
            await pg.close()

        # ---- price wording on the stock page
        pg, errs = await page_with(ctx, base, fresh, {}, '', stock='stock-ok', extra={'data/tech/KO.json': tech_ok}, chart=False)
        await pg.goto(base + '?selftest=1&t=KO')
        await pg.wait_for_timeout(1500)
        await pg.locator('button:has-text("Technical")').first.click()
        await pg.wait_for_timeout(1000)
        st = await pg.inner_text('#page-stock')
        check('Intraday prices (TradingView)' in st and 'This site has no real-time prices' in st, 'the TradingView block does not call its prices live')
        check(not re.search(r'(?i)live (price|chart)', st), 'no "live price" or "live chart" wording on the stock page')
        await pg.close()

        await b.close()
    httpd.shutdown()
    shutil.rmtree(tmp, ignore_errors=True)
    print(f'\n{len(failures)} failed' if failures else '\nall scanner page tests passed')
    sys.exit(1 if failures else 0)

asyncio.run(main())
