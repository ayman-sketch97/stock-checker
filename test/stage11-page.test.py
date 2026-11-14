# Page tests for stage 11 (trust, clarity and accessibility; display only): consistent pause gating, one data stamp, the three kinds of loading
# problem with retry, unreliable data never drawn as healthy, the records card with an honest storage message, the "which record is which" note,
# page titles and keyboard reach. No formula, threshold, limit or recommendation is tested here; test/validation/same-advice.py covers that.
# Run: python3 test/stage11-page.test.py   (needs Python Playwright with Chromium; serves the page locally, no network)
import asyncio, json, os, re, sys

HERE = os.path.dirname(os.path.abspath(__file__))
_src = open(os.path.join(HERE, 'scanner-page.test.py'), encoding='utf-8').read().split('async def main', 1)[0]
_ns = {'__file__': os.path.join(HERE, 'scanner-page.test.py')}
exec(compile(_src, 'scanner-page-helpers', 'exec'), _ns)
from playwright.async_api import async_playwright
serve, page_with, weekday_back, FIX = _ns['serve'], _ns['page_with'], _ns['weekday_back'], _ns['FIX']
failures = []


def check(cond, msg):
    print(('ok   ' if cond else 'FAIL ') + msg)
    if not cond:
        failures.append(msg)


HELD = {'watch': {'v': 1, 'items': [{'t': 'AAPL', 'added': '2026-01-01', 'shares': 10, 'cost': 200}, {'t': 'KO', 'added': '2026-01-01', 'shares': 3, 'cost': 50}], 'snap': None, 'prev': None}}
ACTION = re.compile(r'(?i)consider selling|sell about|trim level|Buy only above|Entry zone|bring it back to|do not add')
TEXT = "(id) => document.getElementById(id).innerText.replace(/\\s+/g, ' ')"
FAILPATH = re.compile(r'.*(/data/|quotes\.json|vendor/).*')


async def bare_page(ctx, base, handler, storage, path):
    pg = await ctx.new_page()
    errs = []
    pg.on('pageerror', lambda e: errs.append(str(e)))
    await pg.route(FAILPATH, handler)
    await pg.goto(base + '?selftest=1&p=stock')
    await pg.evaluate('(s) => { localStorage.clear(); for (const [k, v] of Object.entries(s)) localStorage.setItem(k, JSON.stringify(v)); }', storage)
    await pg.goto(base + '?selftest=1' + path)
    await pg.wait_for_timeout(1200)
    return pg, errs


async def main():
    httpd, tmp = serve()
    base = f'http://127.0.0.1:{httpd.server_address[1]}/'
    fresh = weekday_back(1)
    late = weekday_back(6)
    async with async_playwright() as p:
        b = await p.chromium.launch()
        ctx = await b.new_context(viewport={'width': 390, 'height': 844})

        # ---- 1. pause gating: late prices hide every "do this" line everywhere, fresh prices still show them
        pg, errs = await page_with(ctx, base, fresh, HELD, '&p=dashboard', zoya=['AAPL', 'KO'])
        t = await pg.evaluate(TEXT, 'page-dashboard')
        check(bool(ACTION.search(t)), 'fresh data: the Dashboard still shows the existing trim and entry lines')
        check(not await pg.evaluate("document.body.classList.contains('advice-paused')"), 'fresh data: advice is not paused')
        check(not errs, f'no page errors on the fresh Dashboard {errs[:2]}')
        await pg.close()
        for name in ['dashboard', 'alerts', 'watchlist', 'scanner', 'advisor', 'shortlist']:
            pg, errs = await page_with(ctx, base, late, HELD, '&p=' + name, zoya=['AAPL', 'KO'])
            vis = await pg.evaluate("[...document.querySelectorAll('#page-" + name + " *')].filter((e) => e.offsetParent && e.children.length === 0).map((e) => e.innerText).join(' ').replace(/\\s+/g, ' ')")
            check(await pg.evaluate("document.body.classList.contains('advice-paused')"), f'late data: ?p={name} marks the page as paused')
            check(not ACTION.search(vis), f'late data: ?p={name} shows no buy, sell or trim line: {(ACTION.search(vis) or [None])[0]}')
            banner = await pg.evaluate("(() => { const e = document.querySelector('.pause-banner'); return e && e.offsetParent ? e.innerText : ''; })()")
            check('Advice paused' in banner, f'late data: ?p={name} shows the pause banner once at the top')
            check(await pg.evaluate("document.querySelectorAll('.pause-banner').length") == 1, f'late data: ?p={name} has exactly one pause banner')
            check(not errs, f'no page errors on late ?p={name} {errs[:2]}')
            await pg.close()

        # ---- 2. one data stamp: the source and the date, worded the same everywhere
        pg, errs = await page_with(ctx, base, fresh, HELD, '&p=dashboard', zoya=['AAPL'])
        stamp = await pg.evaluate("(() => { const e = document.querySelector('.stamp'); return e ? e.innerText.replace(/\\s+/g, ' ') : ''; })()")
        check(bool(re.search(r'(?i)close of', stamp)) and bool(re.search(r'\d{4}', stamp)), f'the data stamp names the close date: {stamp!r}')
        foot = await pg.evaluate("document.querySelector('footer').innerText")
        check('Nasdaq' in foot and 'end-of-day' in foot.lower(), f'the footer says where prices come from and that they are end-of-day: {foot!r}')
        await pg.close()

        # ---- 3. loading problems: offline, missing and damaged are told apart, each with a retry that works
        async def offline(r):
            await r.abort()

        async def missing(r):
            await r.fulfill(status=404, body='')

        async def damaged(r):
            await r.fulfill(status=200, body='{"rows": [', headers={'content-type': 'application/json'})
        for kind, handler, words in [('offline', offline, r'(?i)offline|could not be reached'), ('missing', missing, r'(?i)not on the site'), ('damaged', damaged, r'(?i)could not be read|damaged')]:
            pg, errs = await bare_page(ctx, base, handler, HELD, '&p=dashboard')
            t = await pg.evaluate(TEXT, 'page-dashboard')
            check(bool(re.search(words, t)), f'{kind}: the Dashboard says so: {t[150:330]!r}')
            if kind != 'offline':
                check(not re.search(r'(?i)check your connection', t.split('Retry')[0][-400:]) or kind == 'offline', f'{kind}: it does not blame the connection')
            check(await pg.locator('#page-dashboard button:has-text("Try again")').count() >= 1, f'{kind}: a Try again button is offered')
            check(not errs, f'{kind}: no page errors {errs[:2]}')
            await pg.close()
        # retry recovers once the data is back
        state = {'ok': False}
        screen = json.load(open(os.path.join(FIX, 'screen.json')))
        index = json.load(open(os.path.join(FIX, 'index.json')))
        screen['priceDate'] = index['priceDate'] = fresh

        async def flaky(r):
            u = r.request.url
            if not state['ok']:
                await r.abort()
            elif 'data/screen.json' in u:
                await r.fulfill(status=200, body=json.dumps(screen), headers={'content-type': 'application/json'})
            elif 'data/index.json' in u:
                await r.fulfill(status=200, body=json.dumps(index), headers={'content-type': 'application/json'})
            else:
                await r.fulfill(status=404, body='')
        pg, errs = await bare_page(ctx, base, flaky, HELD, '&p=dashboard')
        state['ok'] = True
        await pg.locator('#page-dashboard button:has-text("Try again")').first.click()
        await pg.wait_for_timeout(1500)
        t = await pg.evaluate(TEXT, 'page-dashboard')
        check('The market today' in t or 'Your portfolio' in t, 'retry: the Dashboard loads after the data comes back')
        await pg.close()

        # ---- 4. unreliable data is never drawn as healthy
        pg, errs = await page_with(ctx, base, fresh, HELD, '', stock='stock-unreliable', zoya=['KO'])
        await pg.goto(base + '?selftest=1&t=KO')
        await pg.wait_for_timeout(1600)
        check(await pg.locator('#result .tiles.unrel').count() == 1, 'unreliable data: the score tiles are drawn muted')
        check(await pg.locator('#result .unrel-note').count() >= 1, 'unreliable data: a note says the scores are not reliable')
        green = await pg.evaluate("[...document.querySelectorAll('#result .tiles.unrel .ring-val')].map((e) => getComputedStyle(e).stroke)")
        check(len(green) > 0 and all('5, 150, 105' not in g and '4, 108, 78' not in g for g in green), f'unreliable data: no ring is drawn in the healthy green: {green[:2]}')
        await pg.close()

        # ---- 5. company page: jump bar, tab switch under the header
        tech_ok = json.load(open(os.path.join(FIX, 'tech-ok.json')))
        pg, errs = await page_with(ctx, base, fresh, HELD, '', stock='stock-ok', extra={'data/tech/KO.json': tech_ok}, zoya=['KO'])
        await pg.goto(base + '?selftest=1&t=KO')
        await pg.wait_for_timeout(1600)
        check(await pg.locator('#result .jumpbar').count() == 1, 'company page: a jump bar sits under the header')
        jumps = await pg.locator('#result .jumps button').all_inner_texts()
        check(len(jumps) >= 4, f'company page: the jump bar lists the sections: {jumps}')
        pos = await pg.evaluate("getComputedStyle(document.querySelector('#result .jumpbar')).position")
        check(pos == 'sticky', 'company page: the jump bar stays in reach while scrolling')
        check(not errs, f'company page: no page errors {errs[:2]}')
        await pg.close()

        # ---- 6. your records card and the storage message
        pg, errs = await page_with(ctx, base, fresh, {}, '&p=dashboard')
        t = await pg.evaluate("document.querySelector('.rec-box').innerText.replace(/\\s+/g, ' ')")
        check('Nothing is recorded yet' in t, 'records card: says so when nothing is recorded')
        await pg.close()
        pg, errs = await page_with(ctx, base, fresh, HELD, '&p=dashboard', zoya=['AAPL'])
        t = await pg.evaluate("document.querySelector('.rec-box').innerText.replace(/\\s+/g, ' ')")
        check('none yet' in t and await pg.evaluate("document.querySelector('.rec-box').classList.contains('rec-due')"), 'records card: holdings and no backup is flagged as due')
        check(re.search(r'(?i)backup file is the only safe copy', t) is not None, 'records card: says a backup file is the only safe copy')
        await pg.close()
        recent = HELD | {'journal': {'v': 1, 'trades': [], 'backup': weekday_back(2)}}
        pg, errs = await page_with(ctx, base, fresh, recent, '&p=dashboard', zoya=['AAPL'])
        t = await pg.evaluate("document.querySelector('.rec-box').innerText.replace(/\\s+/g, ' ')")
        check('days ago' in t and 'Time for a new one' not in t, f'records card: a recent backup shows its age and no reminder: {t[:260]!r}')
        await pg.close()
        # the browser accepts a persistence request: the card must still not promise anything
        ctx2 = await b.new_context(viewport={'width': 390, 'height': 844})
        await ctx2.add_init_script("(() => { const s = { persisted: async () => false, persist: async () => true }; Object.defineProperty(navigator, 'storage', { value: s, configurable: true }); window.__persistCalls = 0; const o = s.persist; s.persist = async () => { window.__persistCalls++; return o(); }; })()")
        pg, errs = await page_with(ctx2, base, fresh, HELD, '&p=dashboard', zoya=['AAPL'])
        await pg.wait_for_timeout(600)
        t = await pg.evaluate("document.querySelector('.rec-box [data-persist]').innerText.replace(/\\s+/g, ' ')")
        check(await pg.evaluate('window.__persistCalls') == 1, 'storage: persistent storage is requested once when there is something to keep')
        check('not a guarantee' in t and not re.search(r'(?i)guaranteed|will be kept|safe from', t), f'storage: an accepted request is described as not a guarantee: {t!r}')
        await pg.close()
        await ctx2.close()
        ctx3 = await b.new_context(viewport={'width': 390, 'height': 844})
        await ctx3.add_init_script("Object.defineProperty(navigator, 'storage', { value: undefined, configurable: true })")
        pg, errs = await page_with(ctx3, base, fresh, HELD, '&p=dashboard', zoya=['AAPL'])
        await pg.wait_for_timeout(400)
        t = await pg.evaluate("document.querySelector('.rec-box [data-persist]').innerText.replace(/\\s+/g, ' ')")
        check('may clear it' in t, f'storage: a browser with no storage API is told the data may be cleared: {t!r}')
        check(not errs, f'storage: no page errors without the storage API {errs[:2]}')
        await pg.close()
        await ctx3.close()
        # the Home Screen note never promises
        pg, errs = await page_with(ctx, base, fresh, HELD, '&p=dashboard', zoya=['AAPL'])
        note = await pg.evaluate("document.querySelector('.rec-box details.which').textContent.replace(/\\s+/g, ' ')")
        check('Add to Home Screen' in note and 'does not guarantee' in note, 'Home Screen note: explains how, and says it does not guarantee anything')
        await pg.goto(base + '?selftest=1&p=journal')
        await pg.wait_for_timeout(800)
        jt = await pg.evaluate(TEXT, 'page-journal')
        check('Home Screen apps keep it' not in jt and 'not a guarantee' in jt, 'Journal note: no longer says Home Screen apps keep the data')
        await pg.close()

        # ---- 7. which record is which
        for name in ['watchlist', 'journal', 'advisor', 'pfledger']:
            pg, errs = await page_with(ctx, base, fresh, HELD, '&p=' + name, zoya=['AAPL'])
            n = await pg.locator(f'#page-{name} details.which').count()
            txt = await pg.evaluate(f"(document.querySelector('#page-{name} details.which') || {{textContent: ''}}).textContent")
            check(n == 1 and all(w in txt for w in ['Watchlist positions', 'Portfolio ledger', 'Journal']), f'?p={name}: has the "which record is which" note')
            await pg.close()

        # ---- 8. titles, landmarks and keyboard reach
        pg, errs = await page_with(ctx, base, fresh, HELD, '&p=dashboard', zoya=['AAPL'])
        await pg.click('#nav button[data-page="shortlist"]')
        await pg.wait_for_timeout(500)
        title = await pg.title()
        check(title.startswith('Shortlist'), f'navigation: the page title follows the page: {title!r}')
        foc = await pg.evaluate("document.activeElement && document.activeElement.id")
        check(foc == 'page-shortlist', f'navigation: focus moves to the new page: {foc!r}')
        check(await pg.evaluate("!!document.getElementById('content') && document.getElementById('skipLink').getAttribute('href') === '#content'"), 'a skip link points at a real target')
        mains = await pg.evaluate("[...document.querySelectorAll('[role=main]')].filter((e) => !e.hidden).length")
        check(mains == 1, f'exactly one visible main landmark: {mains}')
        await pg.close()
        pg, errs = await page_with(ctx, base, fresh, HELD, '&p=pfledger', zoya=['AAPL'])
        await pg.wait_for_timeout(500)
        bad = await pg.evaluate("[...document.querySelectorAll('.tscroll.can-scroll')].filter((e) => e.getAttribute('tabindex') !== '0').length")
        check(bad == 0, 'scrolling tables that overflow can take keyboard focus')
        empty = await pg.evaluate("[...document.querySelectorAll('th')].filter((e) => !e.innerText.trim() && !e.querySelector('.vh')).length")
        check(empty == 0, 'no table header is empty')
        await pg.close()
        await b.close()
    httpd.shutdown()
    print()
    print(f'{len(failures)} failure(s)' if failures else 'all stage 11 page checks passed')
    sys.exit(1 if failures else 0)

asyncio.run(main())
