# Page test: a sync link opens the import card even with a full stop glued on, a damaged link says so, and the paste box works.
# Run: python3 test/sync-link-page.test.py
import asyncio, base64, json, os, sys
HERE = os.path.dirname(os.path.abspath(__file__))
_src = open(os.path.join(HERE, 'scanner-page.test.py'), encoding='utf-8').read().split('async def main', 1)[0]
_ns = {'__file__': os.path.join(HERE, 'scanner-page.test.py')}
exec(compile(_src, 'scanner-page-helpers', 'exec'), _ns)
from playwright.async_api import async_playwright
serve, page_with, weekday_back = _ns['serve'], _ns['page_with'], _ns['weekday_back']
failures = []


def check(cond, msg):
    print(('ok   ' if cond else 'FAIL ') + msg)
    if not cond:
        failures.append(msg)


CODE = base64.urlsafe_b64encode(json.dumps({'v': 1, 'i': [['AAPL', '', 0, 0, 0, 0, 0, 0, 0, 0, '', 1], ['MSFT', '', 0, 0, 0, 0, 0, 0, 0, 0, '', 0]]}).encode()).decode().rstrip('=')


async def main():
    httpd, tmp = serve()
    base = f'http://127.0.0.1:{httpd.server_address[1]}/'
    async with async_playwright() as p:
        b = await p.chromium.launch(executable_path='/usr/bin/google-chrome', args=['--no-sandbox'])
        ctx = await b.new_context(viewport={'width': 390, 'height': 844})
        pg, errs = await page_with(ctx, base, weekday_back(1), {}, '&p=watchlist')
        for name, suffix in [('clean', ''), ('full stop on the end', '.')]:
            await pg.goto(base + '?p=watchlist#w=' + CODE + suffix)
            await pg.reload()
            await pg.wait_for_timeout(1800)
            check(await pg.is_visible('text=Import 2 companies from a sync link?'), f'import card shows ({name})')
        await pg.goto(base + '?p=watchlist#w=abc')
        await pg.reload()
        await pg.wait_for_timeout(1500)
        check(await pg.is_visible('text=looks cut short'), 'a cut-short link says so')
        await pg.goto(base + '?p=watchlist')
        await pg.reload()
        await pg.wait_for_timeout(1500)
        await pg.click('text=Have a sync link? Paste it here')
        await pg.fill('textarea[aria-label="Sync link"]', 'here: ' + base + '?p=watchlist%23w=' + CODE + ' thanks')
        await pg.click('text=Show what it holds')
        await pg.wait_for_timeout(800)
        check(await pg.is_visible('text=Import 2 companies from a sync link?'), 'pasted link (with words around it and %23) shows the import card')
        await pg.click('text=Add to my list')
        await pg.wait_for_timeout(500)
        items = await pg.evaluate("JSON.parse(localStorage.getItem('watch')).items.map((i) => i.t + (i.own ? '*' : ''))")
        check(items == ['AAPL*', 'MSFT'], f'import saved with the own flag: {items}')
        await pg.goto(base + '?p=watchlist')
        await pg.reload()
        await pg.wait_for_timeout(1200)
        await pg.click('text=Have a sync link? Paste it here')
        await pg.fill('textarea[aria-label="Sync link"]', 'own: TTD, ENPH\nWATCH: XOM LLY')
        await pg.click('text=Show what it holds')
        await pg.wait_for_timeout(600)
        check(await pg.is_visible('text=Import 4 companies from a sync link?'), 'a plain ticker list gives an import card')
        await pg.click('text=Replace my list')
        await pg.wait_for_timeout(500)
        items = await pg.evaluate("JSON.parse(localStorage.getItem('watch')).items.map((i) => i.t + (i.own ? '*' : ''))")
        check(items == ['TTD*', 'ENPH*', 'XOM', 'LLY'], f'list import keeps the own flags: {items}')
        check(not errs, f'no page errors {errs[:2]}')
        await b.close()
    sys.exit(1 if failures else 0)


asyncio.run(main())
