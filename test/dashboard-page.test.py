# Page tests for stage 9 (professional redesign): the Dashboard, the default landing page. It must keep three kinds of
# information apart (your holdings, scanner candidates, system alerts), reuse the data the other pages already read, show a
# plain empty state instead of example figures, and leave every other address and deep link working.
# Reuses the fixture-serving helpers of test/scanner-page.test.py (everything before its main()).
# Run: python3 test/dashboard-page.test.py   (needs Python Playwright with Chromium; serves the page locally, no network)
import asyncio, json, os, re, shutil, sys

HERE = os.path.dirname(os.path.abspath(__file__))
FIX = os.path.join(HERE, 'fixtures')
_src = open(os.path.join(HERE, 'scanner-page.test.py'), encoding='utf-8').read().split('async def main', 1)[0]
_ns = {'__file__': os.path.join(HERE, 'scanner-page.test.py')}
exec(compile(_src, 'scanner-page-helpers', 'exec'), _ns)
from playwright.async_api import async_playwright
serve, page_with, weekday_back, scanner_file = _ns['serve'], _ns['page_with'], _ns['weekday_back'], _ns['scanner_file']
failures = []


def check(cond, msg):
    print(('ok   ' if cond else 'FAIL ') + msg)
    if not cond:
        failures.append(msg)


SCREEN = json.load(open(os.path.join(FIX, 'screen.json')))
ROW = {r[0]: r for r in SCREEN['rows']}  # ticker -> row; index 5 is the price, 6 the day change
PX = lambda t: ROW[t][5]
KINDS = {'Your portfolio': 'you', 'Scanner candidates': 'scan', 'System alerts': 'sys'}
HEALTH_OK = {'worst': 'ok', 'checks': [{'id': 'coverage', 'status': 'ok', 'label': 'Companies analysed', 'text': 'All.'}, {'id': 'record', 'status': 'ok', 'label': 'Permanent record', 'text': 'Intact.'}]}
HEALTH_BAD = {'worst': 'bad', 'checks': [{'id': 'history', 'status': 'bad', 'label': 'Price history', 'text': 'Yesterday’s history file is missing.'}, {'id': 'coverage', 'status': 'warn', 'label': 'Companies analysed', 'text': 'Some missing.'}]}


def watch(items):
    return {'watch': {'v': 1, 'items': items, 'snap': None, 'prev': None}}


async def dash(ctx, base, fresh, **kw):
    kw.setdefault('path', '&p=dashboard')
    pg, errs = await page_with(ctx, base, fresh, **kw)
    await pg.wait_for_timeout(1300)
    return pg, errs


async def text_of(pg, label):
    return await pg.inner_text(f'#page-dashboard section[aria-label="{label}"]')


async def main():
    httpd, tmp = serve()
    base = f'http://127.0.0.1:{httpd.server_address[1]}/'
    fresh = weekday_back(1)
    async with async_playwright() as p:
        b = await p.chromium.launch()
        ctx = await b.new_context(viewport={'width': 1280, 'height': 900})

        # ---- the address with nothing after it opens the Dashboard; every other address still works
        pg, errs = await page_with(ctx, base, fresh, storage={})
        await pg.goto(base + '?selftest=1')
        await pg.wait_for_timeout(1300)
        check(await pg.evaluate("!document.getElementById('page-dashboard').hidden && document.getElementById('page-stock').hidden"), 'the bare address opens the Dashboard')
        check(await pg.evaluate("document.querySelector('#nav button[aria-current=page]').dataset.page") == 'dashboard', 'the Dashboard tab is the highlighted one')
        check(not errs, f'no page errors on the default landing {errs[:2]}')
        await pg.goto(base + '?selftest=1&p=stock')
        await pg.wait_for_timeout(800)
        check(await pg.evaluate("!document.getElementById('page-stock').hidden && document.getElementById('page-dashboard').hidden"), '?p=stock opens the Search page')
        check(await pg.is_visible('#q') and await pg.is_visible('.hero'), '?p=stock shows the search box and the hero')
        await pg.goto(base + '?selftest=1&t=KO')
        await pg.wait_for_timeout(1500)
        check(await pg.evaluate("!document.getElementById('page-stock').hidden && document.getElementById('page-dashboard').hidden"), '?t=KO still opens the Search page, not the Dashboard')
        # moving between the Dashboard and Search with the tabs, the brand and the back button
        await pg.goto(base + '?selftest=1')
        await pg.wait_for_timeout(1000)
        await pg.click('#nav button:has-text("Search")')
        await pg.wait_for_timeout(600)
        check('p=stock' in pg.url and await pg.is_visible('#q'), 'the Search tab opens the Search page at ?p=stock')
        await pg.go_back()
        await pg.wait_for_timeout(800)
        check(await pg.evaluate("!document.getElementById('page-dashboard').hidden"), 'the back button returns to the Dashboard')
        await pg.click('#nav button:has-text("Search")')
        await pg.wait_for_timeout(500)
        await pg.click('#homeBtn')
        await pg.wait_for_timeout(800)
        check(await pg.evaluate("!document.getElementById('page-dashboard').hidden"), 'the brand button goes to the Dashboard')
        check(not errs, f'no page errors moving around {errs[:2]}')
        await pg.close()

        # ---- nothing recorded: plain empty states, no example figures
        pg, errs = await dash(ctx, base, fresh, storage={})
        pf = await text_of(pg, 'Your portfolio')
        check('No holdings are recorded on this device yet' in pf and 'never shows example figures' in pf, f'empty portfolio says so plainly: {pf[:200]!r}')
        check('$' not in pf and not await pg.locator('#page-dashboard .dash-pf table').count(), 'empty portfolio shows no amounts and no table')
        allt = await pg.inner_text('#page-dashboard')
        check(not re.search(r'(?i)lorem|placeholder|sample data|demo data|\bTBD\b|123,456', allt), 'no placeholder wording anywhere on the Dashboard')
        al = await text_of(pg, 'System alerts')
        check('No holdings are recorded, so no Zoya checks are due.' in al and 'Your watchlist is empty' in al, 'empty alerts say there is nothing to check, not that all is well')
        check(not errs, f'no page errors with nothing recorded {errs[:2]}')
        await pg.close()

        # ---- three labelled blocks that do not mix
        held = watch([{'t': 'AAPL', 'added': '2026-01-01', 'shares': 10, 'cost': 200}, {'t': 'KO', 'added': '2026-01-01'}])
        pg, errs = await dash(ctx, base, fresh, storage=held)
        tags = await pg.evaluate("[...document.querySelectorAll('#page-dashboard .dash-card')].map((c) => [c.getAttribute('aria-label'), c.querySelector('.src').innerText, c.querySelector('.src').className])")
        check(sorted(t[0] for t in tags) == sorted(KINDS), f'three cards, one per kind of information: {[t[0] for t in tags]}')
        for label, kind in KINDS.items():
            t = [x for x in tags if x[0] == label]
            check(t and f'src-{kind}' in t[0][2], f'{label}: carries its own source label ({t[0][1] if t else None!r})')
        check(len({t[1] for t in tags}) == 3, 'the three source labels are all different')
        pf, sc, al = await text_of(pg, 'Your portfolio'), await text_of(pg, 'Scanner candidates'), await text_of(pg, 'System alerts')
        check('Paper trade only' in sc and 'Paper trade only' not in pf and 'Paper trade only' not in al, 'the paper-trade warning is in the scanner block only')
        check('Entry set for next session' not in pf and 'Entry set for next session' not in al, 'scanner setups do not appear in the portfolio or the alerts')
        check('your stocks' in pf.lower() and 'your stocks' not in sc.lower() and 'your stocks' not in al.lower(), 'portfolio totals are in the portfolio block only')
        check(await pg.locator('#page-dashboard .dash-alerts .alert-list').count() >= 3 and not await pg.locator('#page-dashboard .dash-pf .alert-list').count(), 'alert lists are in the alerts block only')
        check(not errs, f'no page errors with holdings {errs[:2]}')

        # ---- your portfolio: the figures are the day's data times what you entered
        row = (await pg.inner_text('#page-dashboard .dash-pf tbody tr')).split()
        want_val = f'${PX("AAPL") * 10:,.2f}'
        check(row[0] == 'AAPL' and row[1] == '10' and row[2] == f'${PX("AAPL"):,.2f}' and row[3] == want_val, f'AAPL row: 10 shares at the site price, valued {want_val}: {row}')
        day = f'{ROW["AAPL"][6] * 100:+.1f}%'.replace('+-', '-')
        check(day in ' '.join(row) or day.replace('-', '−') in ' '.join(row), f'the day change is the data’s own ({day}): {row}')
        gain = f'+{(PX("AAPL") / 200 - 1) * 100:.1f}%'
        check(gain in ' '.join(row), f'the change against your cost is price over cost ({gain}): {row}')
        check(f'${PX("AAPL") * 10:,.2f}' in pf and 'as on the Portfolio page' in pf, 'the stock total matches the Portfolio page’s valuation')
        # a price you typed for your own ticker is used and labelled
        own = watch([{'t': 'ZZZ', 'added': '2026-01-01', 'shares': 5, 'cost': 4, 'manual': True, 'px': 5, 'pxDate': fresh}])
        await pg.close()
        pg, errs = await dash(ctx, base, fresh, storage=own)
        r2 = await pg.inner_text('#page-dashboard .dash-pf tbody tr')
        check('ZZZ' in r2 and 'your price' in r2 and '$25.00' in r2, f'your own ticker is valued at the price you entered and labelled: {r2!r}')
        await pg.close()

        # ---- scanner candidates: the same rows, order and paper-only labels as the scanner page
        pg, errs = await dash(ctx, base, fresh, storage={})
        order = await pg.evaluate("[...document.querySelectorAll('#page-dashboard .dash-scan .scan-row .tk')].map((x) => x.innerText)")
        want = [r['ticker'] for r in scanner_file(fresh)['rows']][:5]
        check(order == want, f'candidates are the scanner’s own top rows, in its order: {order}')
        tg = await pg.inner_text('#page-dashboard .dash-scan .scan-row')
        check('Paper only' in tg and 'Blocked: no Zoya record' in tg, 'each candidate keeps its Paper only and Zoya-record labels')
        check('End-of-day closes' in await text_of(pg, 'Scanner candidates'), 'the scanner block says its prices are end-of-day closes')
        await pg.click('#page-dashboard .dash-scan button:has-text("Open the Swing scanner")')
        await pg.wait_for_timeout(700)
        check(await pg.evaluate("!document.getElementById('page-scanner').hidden"), 'the scanner block opens the Swing scanner page')
        await pg.close()
        # no file, no candidates, a late file
        pg, errs = await dash(ctx, base, fresh, storage={}, scanner=None)
        sc = await text_of(pg, 'Scanner candidates')
        check('could not be loaded' in sc and not await pg.locator('#page-dashboard .scan-row').count(), 'no scanner file: says so and lists nothing')
        check(not errs, f'no page errors without a scanner file {errs[:2]}')
        await pg.close()
        empty = scanner_file(fresh)
        empty['rows'] = []
        pg, errs = await dash(ctx, base, fresh, storage={}, scanner=empty)
        check('No candidates tonight' in await text_of(pg, 'Scanner candidates'), 'a night with no candidates says so')
        await pg.close()
        late = weekday_back(5)
        pg, errs = await dash(ctx, base, late, storage=held)
        check('Scanner paused' in await text_of(pg, 'Scanner candidates') and not await pg.locator('#page-dashboard .scan-row').count(), 'a late nightly update pauses the scanner block and lists no candidates')
        check('Advice paused' in await text_of(pg, 'Your portfolio') and 'Advice paused' in await text_of(pg, 'System alerts'), 'a late nightly update is flagged in the portfolio and the alerts')
        await pg.close()

        # ---- system alerts
        pg, errs = await dash(ctx, base, fresh, storage={}, extra={'data/health.json': HEALTH_OK})
        check('every health check passed' in await text_of(pg, 'System alerts'), 'healthy nightly checks are reported as passed')
        await pg.close()
        pg, errs = await dash(ctx, base, fresh, storage={}, extra={'data/health.json': HEALTH_BAD})
        al = await text_of(pg, 'System alerts')
        check('Price history unavailable' in al and '1 other warning' in al and 'every health check passed' not in al, f'failed and warning nightly checks are listed: {al[:260]!r}')
        await pg.close()
        pg, errs = await dash(ctx, base, fresh, storage={})
        check('could not be loaded, so data problems cannot be ruled out' in await text_of(pg, 'System alerts'), 'a missing health report is not read as "all is well"')
        await pg.close()
        gone = watch([{'t': 'GONE', 'added': '2026-01-01'}, {'t': 'AAPL', 'added': '2026-01-01', 'shares': 10, 'cost': 200}])
        pg, errs = await dash(ctx, base, fresh, storage=gone)
        al = await text_of(pg, 'System alerts')
        check('GONE' in al and 'Not in today’s data' in al, 'a followed company missing from the data raises the same alert as the Watchlist page')
        check('AAPL' in al and 'No Shariah record for this holding' in al, 'a holding with no Zoya record is flagged from the Shariah ledger')
        await pg.close()
        one = watch([{'t': 'AAPL', 'added': '2026-01-01', 'shares': 10, 'cost': 200}])
        pg, errs = await dash(ctx, base, fresh, storage=one, zoya=['AAPL'])
        check('All 1 holding is recorded and up to date on Zoya.' in await text_of(pg, 'System alerts'), 'a current Zoya record clears the ledger alert')
        check(not errs, f'no page errors with a current Zoya record {errs[:2]}')
        await pg.close()

        # ---- the alerts match the Watchlist page for the same data (nothing is worked out twice)
        pg, errs = await dash(ctx, base, fresh, storage=gone)
        dash_lines = [x.strip() for x in (await pg.inner_text('#page-dashboard .dash-alerts')).split('\n') if 'Not in today’s data' in x]
        await pg.click('#nav button:has-text("Watchlist")')
        await pg.wait_for_timeout(1500)
        wl_txt = await pg.inner_text('#page-watchlist')
        check(dash_lines and all(re.sub(r'^GONE\s*', '', x)[:60] in wl_txt for x in dash_lines), 'the Dashboard’s watchlist alert wording is the Watchlist page’s own')
        await pg.close()

        # ---- the Search page no longer carries the "Today" stack; the Dashboard carries it once (stage 9 correction)
        TODAY = ['The market today', 'Your daily brief', 'Ideas today', 'Your watchlist']
        pg, errs = await page_with(ctx, base, fresh, storage={}, path='&p=stock')
        await pg.wait_for_timeout(1500)
        check(await pg.evaluate("!document.getElementById('today')"), 'the Search page has no Today section')
        found = [t for t in TODAY if await pg.locator(f'#page-stock section[aria-label="{t}"]').count()]
        check(not found, f'none of the Today cards is on the Search page: {found}')
        check(await pg.is_visible('#q') and await pg.is_visible('#go') and await pg.is_visible('.hero') and await pg.is_visible('#hint'), 'the Search page keeps the hero, the search box, the Analyze button and the hint')
        await pg.fill('#q', 'KO')
        await pg.click('#go')
        await pg.wait_for_timeout(2500)
        check(await pg.evaluate("!document.getElementById('result').hidden || document.getElementById('status').innerText.trim().length > 0"), 'searching still starts the company analysis (the full search flow is covered by test/page.test.py)')
        await pg.click('#nav button:has-text("Search")')
        await pg.wait_for_timeout(500)
        check(not errs, f'no page errors on the Search page {errs[:2]}')
        await pg.close()
        pg, errs = await dash(ctx, base, fresh, storage=gone)
        for t in TODAY[:3]:
            n = await pg.locator(f'#page-dashboard section[aria-label="{t}"]').count()
            check(n == 1, f'the Dashboard shows "{t}" exactly once ({n})')
        check(await pg.locator('#page-dashboard section[aria-label="Your watchlist"]').count() == 0 and 'Watchlist and earnings' in await text_of(pg, 'System alerts'), 'the watchlist is covered once, in the Dashboard alerts')
        dtxt = await pg.inner_text('#page-dashboard')
        check(dtxt.count('S&P 500 ETF (SPY)') == 1, 'the market line appears once on the Dashboard')
        mk = await text_of(pg, 'The market today')
        check('trade above their 50-day average' in mk and 'near a 52-week high' in mk, f'the market card keeps its breadth lines: {mk[:240]!r}')
        ide = await text_of(pg, 'Ideas today')
        check('Long term:' in ide and 'Swing signals:' in ide and ide.find('Long term:') < ide.find('Swing signals:'), 'ideas today: long-term ideas first, then swing signals')
        brf = await text_of(pg, 'Your daily brief')
        check('to look at today' in brf or 'Nothing needs doing today' in brf or 'Add the stocks you own' in brf, f'the daily brief reads as before: {brf[:160]!r}')
        order = await pg.evaluate("[...document.querySelectorAll('#page-dashboard .dash > section')].map((x) => x.getAttribute('aria-label'))")
        check(order == ['The market today', 'System alerts', 'Your portfolio', 'Scanner candidates', 'Your daily brief', 'Ideas today'], f'the Dashboard order is market, alerts, portfolio, scanner, brief, ideas: {order}')
        tags = await pg.evaluate("[...document.querySelectorAll('#page-dashboard .src')].map((x) => x.className)")
        check(len(tags) == 3, f'the three source labels are unchanged: {tags}')
        await pg.click('#page-dashboard section[aria-label="Ideas today"] button:has-text("See all swing signals")')
        await pg.wait_for_timeout(600)
        check(await pg.locator('#page-shortlist').is_visible(), 'the buttons inside the moved cards still work')
        check(not errs, f'no page errors with the Today cards on the Dashboard {errs[:2]}')
        await pg.close()
        await b.close()
    httpd.shutdown()
    shutil.rmtree(tmp, ignore_errors=True)
    print(f'\n{len(failures)} failed' if failures else '\nall dashboard page tests passed')
    sys.exit(1 if failures else 0)

asyncio.run(main())
