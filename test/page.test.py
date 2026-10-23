# Page tests for the calculations that live in index.html (journal, portfolio, backup, freshness warnings).
# Run: python3 test/page.test.py   (needs Python Playwright with Chromium; serves the page locally, no network)
import asyncio, datetime as dt, http.server, json, os, re, shutil, sys, tempfile, threading
from playwright.async_api import async_playwright

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
FIX = os.path.join(ROOT, 'test', 'fixtures')
failures = []


def check(cond, msg):
    print(('ok   ' if cond else 'FAIL ') + msg)
    if not cond:
        failures.append(msg)


def near(a, b, tol=1e-6):
    return a is not None and abs(a - b) <= tol


def serve():
    d = tempfile.mkdtemp()
    html = open(os.path.join(ROOT, 'index.html'), encoding='utf-8').read()
    html = html.replace("const MODE = 'server'; /*BUILD:MODE*/", "const MODE = 'static';")
    open(os.path.join(d, 'index.html'), 'w', encoding='utf-8').write(html)
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


async def page_with(ctx, base, price_date, storage=None, path=''):
    screen = json.load(open(os.path.join(FIX, 'screen.json')))
    index = json.load(open(os.path.join(FIX, 'index.json')))
    screen['priceDate'] = index['priceDate'] = price_date

    async def route(r):
        u = r.request.url
        if u.endswith('data/screen.json') or 'data/screen.json?' in u:
            await r.fulfill(status=200, body=json.dumps(screen), headers={'content-type': 'application/json'})
        elif 'data/backtest-summary.json' in u:
            await r.fulfill(status=200, body=open(os.path.join(FIX, 'backtest-summary.json')).read(), headers={'content-type': 'application/json'})
        elif 'data/index.json' in u:
            await r.fulfill(status=200, body=json.dumps(index), headers={'content-type': 'application/json'})
        else:
            await r.fulfill(status=404, body='')
    pg = await ctx.new_page()
    errs = []
    pg.on('pageerror', lambda e: errs.append(str(e)))
    await pg.route(re.compile(r'.*(/data/|quotes\.json).*'), route)
    await pg.goto(base + '?selftest=1')
    if storage is not None:
        await pg.evaluate('(s) => { localStorage.clear(); for (const [k, v] of Object.entries(s)) localStorage.setItem(k, JSON.stringify(v)); }', storage)
        await pg.goto(base + '?selftest=1' + path)
    await pg.wait_for_timeout(1200)
    return pg, errs


async def main():
    httpd, tmp = serve()
    base = f'http://127.0.0.1:{httpd.server_address[1]}/'
    fresh = weekday_back(1)
    async with async_playwright() as p:
        b = await p.chromium.launch()
        ctx = await b.new_context(accept_downloads=True)

        # ---- journal arithmetic
        pg, errs = await page_with(ctx, base, fresh)
        r = await pg.evaluate("__sc.tradeCalc({entry: 100, shares: 10, stop: 95, fees: 2}, 110)")
        check(near(r['pnl'], 98) and near(r['pct'], 0.098) and near(r['R'], 1.96), f'open trade P/L after fees: {r}')
        r = await pg.evaluate("__sc.tradeCalc({entry: 100, shares: 10, stop: 95, fees: 2, closed: '2026-01-10', exit: 90, exitFees: 1})")
        check(near(r['pnl'], -103) and near(r['R'], -2.06), f'closed losing trade includes entry and exit fees: {r}')
        r = await pg.evaluate("__sc.tradeCalc({entry: 100, shares: 10, stop: 95}, null)")
        check(r['pnl'] is None and r['R'] is None, 'no current price gives no P/L (not zero)')
        r = await pg.evaluate("__sc.tradeCalc({entry: 100, shares: 10}, 120)")
        check(near(r['pnl'], 200) and r['R'] is None, 'trade without a stop has P/L but no R')
        s = await pg.evaluate("""__sc.journalStats([
            {entry: 100, shares: 10, stop: 95, fees: 0, closed: '2026-01-10', opened: '2026-01-01', exit: 110, exitFees: 0},
            {entry: 50, shares: 20, stop: 48, fees: 1, closed: '2026-02-10', opened: '2026-02-01', exit: 47, exitFees: 1}])""")
        check(near(s['pnl'], 100 - 62) and near(s['winRate'], 0.5) and near(s['pf'], 100 / 62) and s['days'] == 9, f"journal totals: pnl {s['pnl']}, win {s['winRate']}, pf {s['pf']}, days {s['days']}")

        # ---- trading costs used by the Portfolio page
        c = await pg.evaluate("__sc.tradeCost('LSE_USD', 300, 'fixed', 60)")
        check(near(c['usd'], 4) and near(c['pct'], 4 / 300), f'IBKR fixed, London in USD, $300: {c}')
        c = await pg.evaluate("__sc.tradeCost('OTHER', 300, 'fixed', 60)")
        check(c['usd'] is None, 'unknown market gives no cost figure (not zero)')

        # ---- backup merge
        m = await pg.evaluate("""__sc.mergeBackup(
            {journal: {v: 1, trades: [{id: 'a', t: 'AAPL', entry: 1, shares: 1}]}, watch: {v: 1, items: [{t: 'AAPL', shares: 3}]}, advisor: {v: 1, profile: {x: 1}, other: [{id: 'o1', sym: 'ISDW'}], hp: {}}},
            {trades: [{id: 'a', t: 'AAPL', entry: 9, shares: 9}, {id: 'b', t: 'MSFT', entry: 2, shares: 2}, {id: 'c', t: 'KO', entry: 2, shares: 0}],
             extra: {watch: {items: [{t: 'AAPL', shares: 99}, {t: 'MSFT', shares: 1}]}, advisor: {profile: {x: 2}, other: [{id: 'o1', sym: 'X'}, {id: 'o2', sym: 'SKUK'}], hp: {MSFT: 'long'}}}})""")
        check(m['added'] == {'trades': 1, 'watch': 1, 'holdings': 1}, f"merge adds only missing records: {m['added']}")
        check(m['journal']['trades'][0]['entry'] == 1 and m['watch']['items'][0]['shares'] == 3 and m['advisor']['profile'] == {'x': 1}, 'merge never overwrites what is on the device')
        check(len(m['journal']['trades']) == 2, 'merge rejects a trade with zero shares and keeps no duplicates')
        await pg.close()

        # ---- backup file round trip through the page (save, wipe the browser, load)
        storage = {
            'journal': {'v': 1, 'trades': [{'id': 't1', 't': 'AAPL', 'opened': '2026-01-02', 'entry': 200, 'shares': 2, 'stop': 190, 'fees': 1, 'setup': 'pullback'}], 'backup': None},
            'watch': {'v': 1, 'items': [{'t': 'MSFT', 'added': '2026-01-01', 'shares': 4, 'cost': 400}], 'snap': None, 'prev': None},
            'advisor': {'v': 1, 'profile': None, 'coreName': 'ISDW', 'core': None, 'safe': None, 'hp': {}, 'other': [{'id': 'o1', 'sym': 'ISDW', 'kind': 'fund', 'market': '', 'shares': 10, 'value': 700}]},
        }
        pg, errs = await page_with(ctx, base, fresh, storage, '#')
        await pg.click('#nav button:has-text("Journal")')
        await pg.wait_for_timeout(800)
        async with pg.expect_download() as dl:
            await pg.click('button:has-text("Save backup")')
        path = await (await dl.value).path()
        saved = json.load(open(path))
        check(saved['trades'][0]['id'] == 't1' and saved['extra']['watch']['items'][0]['t'] == 'MSFT' and saved['extra']['advisor']['other'][0]['id'] == 'o1', 'backup file holds journal, watchlist and portfolio holdings')
        await pg.evaluate('localStorage.clear()')
        await pg.reload()
        await pg.wait_for_timeout(800)
        await pg.click('#nav button:has-text("Journal")')
        await pg.wait_for_timeout(600)
        await pg.set_input_files('#page-journal input[type=file]', path)
        await pg.wait_for_timeout(800)
        back = await pg.evaluate("({j: JSON.parse(localStorage.getItem('journal')), w: JSON.parse(localStorage.getItem('watch')), a: JSON.parse(localStorage.getItem('advisor'))})")
        check(back['j']['trades'][0]['entry'] == 200 and back['w']['items'][0]['shares'] == 4 and back['a']['other'][0]['shares'] == 10, 'restore brings back trades, owned shares and holdings')
        check(not errs, f'no page errors during backup round trip {errs}')
        await pg.close()

        # ---- portfolio: missing prices and duplicate positions are stated, not hidden
        prof = {'horizon': 'long', 'drop': 'hold', 'time': 'mid', 'focus': 'half', 'hold': 'auto', 'swing': 'yes', 'broker': 'tiered', 'monthlyAed': 1000}
        storage = {
            'watch': {'v': 1, 'items': [{'t': 'ZZZZ', 'added': '2026-01-01', 'shares': 5, 'cost': 10}, {'t': 'AAPL', 'added': '2026-01-01', 'shares': 2, 'cost': 150}], 'snap': None, 'prev': None},
            'journal': {'v': 1, 'trades': [{'id': 's1', 't': 'AAPL', 'opened': '2026-01-02', 'entry': 200, 'shares': 2, 'stop': 190, 'setup': 'pullback'}], 'backup': None},
            'advisor': {'v': 1, 'profile': prof, 'coreName': 'ISDW', 'core': None, 'safe': None, 'hp': {}, 'other': [{'id': 'o9', 'sym': 'XYZ', 'kind': 'stock', 'market': 'LSE_GBP', 'shares': None, 'value': None}]},
        }
        pg, errs = await page_with(ctx, base, fresh, storage, '#')
        await pg.click('#nav button:has-text("Portfolio")')
        await pg.wait_for_timeout(1500)
        txt = await pg.inner_text('section[aria-label="Your portfolio now"]')
        check('No current price for ZZZZ' in txt, 'holding without a price is flagged as valued at cost')
        check('No price and no value for XYZ' in txt, 'holding with no price and no value is flagged as $0')
        check('counted twice' in txt, 'a stock held and also open as a swing trade is flagged')
        check(not errs, f'no page errors on the Portfolio page {errs}')
        await pg.close()

        # ---- track record: the setups are compared with random entries and the S&P 500, after the same costs
        pg, errs = await page_with(ctx, base, fresh)
        await pg.click('#nav button:has-text("Record")')
        await pg.wait_for_timeout(1200)
        txt = await pg.inner_text('section[aria-label="Against simple alternatives"]')
        check('+0.56%' in txt and '+1.51%' in txt and '+1.42%' in txt, 'benchmark card shows trades and random entries net of 0.2% and SPY')
        check('made less than buying the same stocks on a random day' in txt, 'benchmark card says plainly when the setups lose to random entries')
        check(not errs, f'no page errors on the Record page {errs}')
        await pg.close()

        # ---- stale data warning on the home page
        pg, errs = await page_with(ctx, base, weekday_back(6))
        check(await pg.locator('.hint.stale').count() == 1, 'old data shows a warning')
        await pg.close()
        pg, errs = await page_with(ctx, base, fresh)
        check(await pg.locator('.hint.stale').count() == 0, 'fresh data shows no warning')
        await pg.close()
        await b.close()
    httpd.shutdown()
    shutil.rmtree(tmp, ignore_errors=True)
    print(f'\n{len(failures)} failed' if failures else '\nall page tests passed')
    sys.exit(1 if failures else 0)

asyncio.run(main())
