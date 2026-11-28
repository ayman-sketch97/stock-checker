# Page test: a company outside the covered list (LWAY, a small cap) gets a plain "not analysed yet" card, can be added to holdings or
# watchlist, invents no numbers, and the add survives. Run: python3 test/uncovered-page.test.py
import asyncio, json, os, sys
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


async def main():
    httpd, tmp = serve()
    base = f'http://127.0.0.1:{httpd.server_address[1]}/'
    async with async_playwright() as p:
        b = await p.chromium.launch(executable_path='/usr/bin/google-chrome', args=['--no-sandbox'])
        ctx = await b.new_context(viewport={'width': 390, 'height': 844})
        pg, errs = await page_with(ctx, base, weekday_back(1), {}, '&p=stock')
        await pg.fill('#q', 'LWAY')
        await pg.click('#go')
        await pg.wait_for_timeout(1500)
        txt = await pg.inner_text('#status')
        check('LWAY: not analysed yet' in txt and '$2 billion' in txt and 'nothing is guessed' in txt, f'plain not-analysed card: {txt[:200]!r}')
        check(await pg.is_visible('text=Add to my holdings') and await pg.is_visible('text=Add to my watchlist') and await pg.is_visible('text=Halal check on Zoya'), 'add buttons and the Zoya link are offered')
        check(not any(w in txt.lower() for w in ('buy now', 'sell now', 'score:')), 'no verdict or invented figure is shown')
        await pg.click('text=Add to my holdings')
        await pg.wait_for_timeout(400)
        it = await pg.evaluate("JSON.parse(localStorage.getItem('watch')).items.find((i) => i.t === 'LWAY')")
        check(it and it.get('own') is True and it.get('manual') is True, f'LWAY is saved as an own holding: {it}')
        check(not errs, f'no page errors {errs[:2]}')
        await b.close()
    sys.exit(1 if failures else 0)


asyncio.run(main())
