# Page tests for the calculations that live in index.html (journal, portfolio, backup, freshness warnings).
# Run: python3 test/page.test.py   (needs Python Playwright with Chromium; serves the page locally, no network)
import asyncio, datetime as dt, http.server, json, os, re, shutil, sys, tempfile, threading, urllib.parse
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


async def page_with(ctx, base, price_date, storage=None, path='', stock=None, extra=None, patch=None):
    screen = json.load(open(os.path.join(FIX, 'screen.json')))
    index = json.load(open(os.path.join(FIX, 'index.json')))
    screen['priceDate'] = index['priceDate'] = price_date
    if patch:
        patch(screen)

    async def route(r):
        u = r.request.url
        for k, v in (extra or {}).items():
            if k in u:
                await r.fulfill(status=200, body=json.dumps(v), headers={'content-type': 'application/json'})
                return
        if u.endswith('data/screen.json') or 'data/screen.json?' in u:
            await r.fulfill(status=200, body=json.dumps(screen), headers={'content-type': 'application/json'})
        elif stock and re.search(r'/data/KO\.json', u):
            await r.fulfill(status=200, body=open(os.path.join(FIX, stock + '.json')).read(), headers={'content-type': 'application/json'})
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

        # ---- holdings: repeated long-term buys of one stock are added together, at a weighted average cost with fees
        hd = await pg.evaluate("""__sc.holdingsFrom(
            [{t: 'MSFT', shares: 4, cost: 400, added: '2026-01-01'}, {t: 'NVDA', shares: 3, swing: true}],
            [{t: 'AAPL', setup: 'longterm', entry: 100, shares: 10, fees: 2, opened: '2026-03-01'},
             {t: 'AAPL', setup: 'longterm', entry: 130, shares: 5, fees: 1, opened: '2026-02-01'},
             {t: 'AAPL', setup: 'longterm', entry: 90, shares: 7, opened: '2026-01-15', closed: '2026-02-20', exit: 95},
             {t: 'MSFT', setup: 'longterm', entry: 300, shares: 1, opened: '2026-01-05'},
             {t: 'NVDA', setup: 'pullback', entry: 120, shares: 2, opened: '2026-03-02'},
             {t: 'KO', setup: 'breakout', entry: 60, shares: 5, opened: '2026-03-03'}])""")
        aapl = next((x for x in hd['lt'] if x['t'] == 'AAPL'), None)
        check(aapl is not None and aapl['shares'] == 15 and near(aapl['cost'], (1002 + 651) / 15) and aapl['since'] == '2026-02-01', f'two open long-term buys: shares added, average cost with fees, earliest date: {aapl}')
        msft = [x for x in hd['lt'] if x['t'] == 'MSFT']
        check(len(msft) == 1 and msft[0]['shares'] == 4 and msft[0]['cost'] == 400, 'the Watchlist position wins over a Journal buy of the same stock (no double count)')
        check(sorted((x['t'], x['shares']) for x in hd['sw']) == [('KO', 5), ('NVDA', 2)], f"swing positions: open swing trades, closed trades left out: {hd['sw']}")
        hp = await pg.evaluate("""__sc.holdingsFrom([], [{t: 'AMD', setup: 'pullback', entry: 100, shares: 3, opened: '2026-03-01', paper: true},
            {t: 'AAPL', setup: 'longterm', entry: 100, shares: 2, opened: '2026-03-01', paper: true}])""")
        check(not hp['lt'] and not hp['sw'], f'paper trades are practice: kept out of the portfolio: {hp}')

        # ---- the live-record gate: until it beats the S&P 500, swing signals are paper trades
        await pg.wait_for_timeout(300)
        check(await pg.evaluate("__sc.swingProven()") is False, 'live record not proven in the fixture (2 of 6 months, behind the index)')
        sn = await pg.evaluate("""__sc.swingNow({ setup: { setup: 'pullback', status: 'active', entry: 100, stop: 95, target1: 110, maxEntry: 101, fill: 'stop' }, asOf: '2026-10-26', market: { regime: 'up' } }, null, false)""")
        check(sn['title'].startswith('Paper trade only') and sn['tone'] == 'warn', f'a live buy signal is shown as a paper trade: {sn}')
        rc = await pg.evaluate("__sc.roundTripCost(250, 100)")
        check(near(rc['usd'], 0.9) and near(rc['pct'], 0.0036) and rc['plan'] == 'tiered', f'$250 at IBKR Tiered: about $0.90 to buy and sell: {rc}')
        tm = await pg.evaluate("[__sc.targetMix({horizon: 'long', drop: 'hold', time: 'mid', focus: 'half', hold: 'auto', swing: 'yes'}, false), __sc.targetMix({horizon: 'long', drop: 'hold', time: 'mid', focus: 'half', hold: 'auto', swing: 'yes'}, true)]")
        check(tm[0]['swing'] == 0 and near(tm[0]['core'] + tm[0]['stocks'] + tm[0]['safe'], 1) and any('paper trades only' in w for w in tm[0]['why']), f"not proven: no real money for swing trades: {tm[0]['swing']}, core {tm[0]['core']}")
        check(near(tm[1]['swing'], 0.1), 'proven: the usual 10% swing share')

        # ---- trade size: loss at the stop, and the 1% risk limit
        z = await pg.evaluate("__sc.sizePosition(100, 95, 1000, 10000)")
        check(near(z['shares'], 10) and near(z['loss'], 50) and near(z['maxPos'], 2000) and not z['overLimit'], f'$1,000 at 100 with a stop at 95: 10 shares, $50 at risk, at most $2,000: {z}')
        z = await pg.evaluate("__sc.sizePosition(100, 95, 3000, 10000)")
        check(z['overLimit'], 'a position above the 1% risk size is flagged')
        z = await pg.evaluate("__sc.sizePosition(100, 99.5, 1000, 5000)")
        check(near(z['maxPos'], 5000), 'a very tight stop never suggests more than the whole portfolio')
        check(await pg.evaluate("__sc.sizePosition(100, 100, 1000, 10000)") is None, 'a stop that is not below the entry gives no size')

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
        labels = await pg.evaluate("[...document.querySelectorAll('#page-advisor > section.card')].map((x) => x.getAttribute('aria-label')).slice(0, 4)")
        check(labels == ['About you', 'Your target mix', 'Best halal funds for you', 'This month'], f'core first on the Portfolio page: {labels}')
        mix = await pg.inner_text('section[aria-label="Your target mix"]')
        check('Swing trades' not in mix.split('With ')[0] and 'paper trades only' in mix, 'no swing share while the live record is unproven, and the page says why')
        txt = await pg.inner_text('section[aria-label="Your portfolio now"]')
        check('No current price for ZZZZ' in txt, 'holding without a price is flagged as valued at cost')
        check('No price and no value for XYZ' in txt, 'holding with no price and no value is flagged as $0')
        check('counted twice' in txt, 'a stock held and also open as a swing trade is flagged')
        check(not errs, f'no page errors on the Portfolio page {errs}')
        await pg.close()

        # ---- watchlist portfolio check: a position without a price is named, not silently dropped
        storage = {'watch': {'v': 1, 'items': [{'t': 'ZZZZ', 'added': '2026-01-01', 'shares': 5, 'cost': 10}, {'t': 'AAPL', 'added': '2026-01-01', 'shares': 2, 'cost': 150}], 'snap': None, 'prev': None}}
        pg, errs = await page_with(ctx, base, fresh, storage, '#')
        await pg.click('#nav button:has-text("Watchlist")')
        await pg.wait_for_timeout(1200)
        txt = await pg.inner_text('section[aria-label="Portfolio check"]')
        check('No current price for ZZZZ' in txt and 'left out' in txt and '$684' in txt, f'watchlist check names the unpriced holding and values the rest: {txt[:160]!r}')
        check(not errs, f'no page errors on the Watchlist page {errs}')
        await pg.close()

        # ---- track record: the setups are compared with random entries and the S&P 500, after the same costs
        pg, errs = await page_with(ctx, base, fresh)
        await pg.click('#nav button:has-text("Record")')
        await pg.wait_for_timeout(1200)
        txt = await pg.inner_text('section[aria-label="Against simple alternatives"]')
        check('+0.56%' in txt and '+1.51%' in txt and '+1.42%' in txt, 'benchmark card shows trades and random entries net of 0.2% and SPY')
        check('made less than buying the same stocks on a random day' in txt, 'benchmark card says plainly when the setups lose to random entries')
        txt = await pg.inner_text('section[aria-label="As a portfolio"]')
        check('+1.8%' in txt and '+11.3%' in txt and 'price only, like the trades' in txt and 'counted on neither side' in txt and 'grew more slowly than' in txt, 'portfolio card: growth and worst fall against SPY, prices only on both sides, and says so')
        live = await pg.inner_text('section[aria-label="Live record"]')
        check('Real money: not yet' in live and '320 trades over 2 months have each been followed for 20 trading days' in live, f'the live record says swing signals are not yet for real money, with the numbers: {live[:240]!r}')
        check(not errs, f'no page errors on the Record page {errs}')
        await pg.close()

        # ---- live record with a young log: nothing followed for 20 days yet, and early closes lean towards losses
        pg, errs = await page_with(ctx, base, fresh)
        LF = ['ticker', 'signal', 'setup', 'score', 'entry', 'maxEntry', 'stop', 't1', 't2', 'fill', 'verdict', 'shariah', 'regime', 'version',
              'status', 'fillDate', 'fillPx', 'exitDate', 'exitPx', 'R', 'riskPct', 'hitT1', 'days', 'rs', 'hR']

        def lrec(t, status, R):
            r = dict.fromkeys(LF)
            r.update(ticker=t, signal='2026-10-15', setup='pullback', shariah='pass', status=status, fillDate='2026-10-16', fillPx=100,
                     exitDate='2026-10-19' if status == 'closed' else None, exitPx=95 if status == 'closed' else 101, R=R, riskPct=0.05, days=1)
            return [r[k] for k in LF]
        young = {'version': 1, 'started': '2026-10-15', 'updated': '2026-10-23', 'fields': LF, 'lapsed': 0, 'archived': {'n': 0, 'wins': 0, 'sumR': 0},
                 'records': [lrec('AAA', 'closed', -1), lrec('BBB', 'closed', -1), lrec('CCC', 'open', 0.2), lrec('DDD', 'open', 0.1), lrec('EEE', 'open', -0.3)],
                 'proof': {'n': 0, 'months': 0, 'needMonths': 6, 'horizon': 20, 'waiting': 5, 'cost': 0.002, 'since': '2026-10-15',
                           'avgTrade': None, 'avgSpy': None, 'avgDiff': None, 'ciLow': None, 'ciHigh': None, 'proven': False}}

        async def sig_route(r):
            await r.fulfill(status=200, body=json.dumps(young), headers={'content-type': 'application/json'})
        await pg.route('**/data/signals.json*', sig_route)
        await pg.click('#nav button:has-text("Record")')
        await pg.wait_for_timeout(1200)
        live = await pg.inner_text('section[aria-label="Live record"]')
        check('No trade has been followed for 20 trading days yet (5 are on the way)' in live, f'young log: nothing measured yet, and how many trades are on the way: {live[:240]!r}')
        check('3 trades are still open' in live and 'losing trades tend to finish first' in live, 'young log: warns that early closes lean towards losses')
        check(not errs, f'no page errors on the Record page with a young log {errs}')
        await pg.close()

        # ---- stock page: the data-quality line, and a withheld verdict when the data is not reliable
        pg, errs = await page_with(ctx, base, fresh, None, '', 'stock-unreliable')
        await pg.goto(base + '?selftest=1&t=KO')
        await pg.wait_for_timeout(1500)
        txt = await pg.inner_text('section[aria-label="Verdict"]')
        check('No verdict' in txt and 'Insufficient data' in txt and 'capital spending looks incomplete' in txt.lower(), 'unreliable data: verdict withheld and the reason shown')
        lt = await pg.inner_text('section[aria-label="Long-term entry and exit"]')
        check('No price levels' in lt, 'unreliable data: no buy or sell price levels')
        check(not errs, f'no page errors on an unreliable stock page {errs}')
        await pg.close()
        pg, errs = await page_with(ctx, base, fresh, None, '', 'stock-ok')
        await pg.goto(base + '?selftest=1&t=KO')
        await pg.wait_for_timeout(1500)
        txt = await pg.inner_text('section[aria-label="Verdict"]')
        check('High confidence in the data' in txt and 'Strong buy candidate' in txt, 'clean data: verdict kept, data quality high')
        check(not errs, f'no page errors on a normal stock page {errs}')
        await pg.close()

        # ---- journal: a paper trade is saved as practice and labelled
        pg, errs = await page_with(ctx, base, fresh, {'journal': {'v': 1, 'trades': [], 'backup': None}}, '#')
        await pg.click('#nav button:has-text("Journal")')
        await pg.wait_for_timeout(700)
        await pg.click('button:has-text("Add a trade")')
        f = pg.locator('#page-journal form.editbox')
        await f.locator('input').nth(0).fill('AMD')
        await f.locator('input').nth(2).fill('150')
        await f.locator('input').nth(3).fill('2')
        await f.locator('input').nth(4).fill('140')
        await f.locator('label.chk input[type=checkbox]').check()
        await f.locator('button[type=submit]').click()
        await pg.wait_for_timeout(600)
        saved = await pg.evaluate("JSON.parse(localStorage.getItem('journal')).trades")
        check(len(saved) == 1 and saved[0].get('paper') is True, f'paper trade saved as practice: {saved}')
        opent = await pg.inner_text('section[aria-label="Open trades"]')
        check('Paper' in opent, 'open paper trade is labelled')
        check(not errs, f'no page errors in the journal {errs}')
        await pg.close()

        # ---- home and shortlist: long-term ideas first, swing signals marked as paper trades
        pg, errs = await page_with(ctx, base, fresh)
        await pg.wait_for_timeout(600)
        ideas = await pg.inner_text('section[aria-label="Ideas today"]')
        check(ideas.find('Long term:') >= 0 and ideas.find('Long term:') < ideas.find('Swing signals:'), 'home: long-term ideas come first, swing signals after them')
        await pg.click('#nav button:has-text("Shortlist")')
        await pg.wait_for_timeout(900)
        first = await pg.inner_text('#page-shortlist .presets button[aria-pressed="true"]')
        check(first.strip() == 'Quality on sale', f'shortlist opens on the long-term list: {first!r}')
        await pg.click('#page-shortlist .presets button:has-text("Swing signals")')
        await pg.wait_for_timeout(400)
        check(await pg.locator('#page-shortlist .paper-note').count() == 1, 'the swing list explains that its signals are paper trades')
        check(not errs, f'no page errors on home and shortlist {errs}')
        await pg.close()

        # ---- daily brief: what to do with the stocks you own, losers waited out, company news from filings
        LT = json.load(open(os.path.join(FIX, 'lt-summary.json')))

        def with_events(screen):
            # filings of the last days (ev), the data-quality grade (dq), and KO turned into a long-term buy idea
            screen['fields'] = screen['fields'] + ['ev', 'dq']
            evs = {'AAPL': [f'{fresh}|8-K|4.02'], 'MSFT': [f'{fresh}|8-K|2.02'], 'KO': []}
            vi = screen['fields'].index('verdict')
            for row in screen['rows']:
                row.extend([evs.get(row[0], []), 'high'])
                if row[0] == 'KO':
                    row[vi] = 'BUY'
                    row[screen['fields'].index('trimAbove')] = 120
        pg, errs = await page_with(ctx, base, fresh)
        brief = await pg.inner_text('section[aria-label="Your daily brief"]')
        check('Add the stocks you own' in brief, f'empty brief invites you to add stocks: {brief[:120]!r}')
        await pg.close()
        own = {'watch': {'v': 1, 'items': [{'t': 'AAPL', 'added': '2026-01-01', 'shares': 2, 'cost': 150}, {'t': 'MSFT', 'added': '2026-02-01', 'shares': 1, 'cost': 650},
                                           {'t': 'KO', 'added': '2026-02-01', 'shares': 0}], 'snap': None, 'prev': None}}
        pg, errs = await page_with(ctx, base, fresh, own, '', None, {'data/lt-summary.json': LT}, with_events)
        brief = await pg.inner_text('section[aria-label="Your daily brief"]')
        check('to look at today' in brief and 'Above its trim price' in brief, f'brief: AAPL above its trim price is a thing to look at: {brief[:300]!r}')
        check('Said earlier financial statements can no longer be relied on' in brief, 'brief: a warning filing (8-K item 4.02) on a holding is flagged')
        check('Down, but keep waiting' in brief and 'MSFT' in brief and 'hold and wait' in brief, 'brief: a holding down from cost with a healthy business: hold and wait')
        check('Company news' in brief and 'Results for a quarter or year' in brief, 'brief: routine filings listed as company news')
        check('Ideas for new money' in brief and 'Long term: 3 years or more' in brief and '+8.1% a year for long-term ideas' in brief,
              f'brief: ideas the Portfolio page would buy, with what the 10-year test found: {brief[-400:]!r}')
        bhref = await pg.evaluate("[...document.querySelectorAll('section[aria-label=\"Your daily brief\"] a')].map((a) => a.href).find((x) => x.includes('claude.ai')) || ''")
        check(bhref.startswith('https://claude.ai/new?q=') and 'Holdings: AAPL 2 shares at $150.00' in urllib.parse.unquote(bhref), 'brief: one tap opens the weekly review with today\'s list')
        check(not errs, f'no page errors in the daily brief {errs}')
        # the Watchlist flags the warning filing too, and opens the weekly review with the list as it is today
        await pg.click('#nav button:has-text("Watchlist")')
        await pg.wait_for_timeout(1000)
        att = await pg.inner_text('section[aria-label="Needs attention"]')
        check('can no longer be relied on' in att, 'watchlist: warning filing in Needs attention')
        box = await pg.evaluate("document.querySelector('section[aria-label=\"Weekly review\"] textarea').value")
        check('Holdings: AAPL 2 shares at $150.00' in box and 'Watching: KO' in box and 'Weekly review of my stocks' in box and 'data/TICKER.json' in box, f'weekly review request: {box[-300:]!r}')
        whref = await pg.evaluate("document.querySelector('section[aria-label=\"Weekly review\"] a').href")
        wtext = urllib.parse.unquote(whref.split('?q=', 1)[1]) if '?q=' in whref else ''
        check(whref.startswith('https://claude.ai/new?q=') and wtext == box and len(whref) < 4700, f'weekly review: the button opens Claude with the same request ({len(whref)} characters)')
        # the Portfolio page offers to let the test decide, and then uses its split
        await pg.evaluate("(p) => { localStorage.setItem('advisor', JSON.stringify(p)); }",
                          {'v': 1, 'profile': {'horizon': 'long', 'drop': 'hold', 'time': 'mid', 'focus': 'only', 'hold': 'auto', 'swing': 'no', 'broker': 'tiered', 'monthlyAed': 1000}, 'hp': {}, 'other': []})
        await pg.click('#nav button:has-text("Portfolio")')
        await pg.wait_for_timeout(1200)
        offer = await pg.locator('#page-advisor button:has-text("Let the test decide my split")').count()
        check(offer == 1, 'portfolio: offers to let the 10-year test set the split')
        await pg.click('#page-advisor button:has-text("Let the test decide my split")')
        await pg.wait_for_timeout(1200)
        mix = await pg.inner_text('section[aria-label="Your target mix"]')
        check('You let the 10-year test decide' in mix and '50%' in mix and 'the long-term picks on this page' in mix, f'portfolio: the test of the page\'s own picks sets stocks to 50%: {mix[:300]!r}')
        check('Short-term picks get no real money' in mix and 'short term' not in mix.split('Your stocks')[1].split('\n')[0], 'portfolio: untested short-term picks get no real money, their share goes to the long term')
        hp = await pg.inner_text('section[aria-label="Holding periods"]')
        check('In the 10-year test: its ideas were ahead of the average halal stock by 8.1% a year' in hp and 'beat random picks in one half' in hp, f'portfolio: each holding period shows what the test found: {hp[:400]!r}')
        check(not errs, f'no page errors on the brief, watchlist and portfolio {errs}')
        await pg.close()

        # ---- record: the long-term list test
        pg, errs = await page_with(ctx, base, fresh, None, '', None, {'data/lt-summary.json': LT})
        await pg.click('#nav button:has-text("Record")')
        await pg.wait_for_timeout(1200)
        ltc = await pg.inner_text('section[aria-label="Long-term list test"]')
        check('The list did not beat the average stock' in ltc and '17.6%' in ltc and 'Companies that went bust are missing' in ltc, f'record: the long-term test, its verdict and its limits: {ltc[:200]!r}')
        check('Other ways to build the list' in ltc and 'Ahead, but not clearly more than luck' in ltc and 'Did worse than the average' in ltc and 'None passed every check' in ltc,
              'record: the other methods tried, each with its result in plain words')
        check('The picks the Portfolio page buys' in ltc and 'Half in stocks' in ltc and 'The money split follows the long-term picks' in ltc and 'Short-term picks cannot be tested yet' in ltc,
              'record: the test of the Portfolio page\'s own picks, which sets the split')
        check(not errs, f'no page errors on the record page with the long-term test {errs}')
        await pg.close()

        # ---- stock page: the company's filings
        ko = json.load(open(os.path.join(FIX, 'stock-ok.json')))
        ko['filings'] = [{'form': '8-K', 'filed': fresh, 'items': ['2.02'], 'accession': '0000021344-26-000050', 'doc': 'ko-8k.htm'},
                         {'form': '8-K', 'filed': fresh, 'items': ['4.02'], 'accession': '0000021344-26-000051', 'doc': 'x.htm'},
                         {'form': '10-Q', 'filed': '2026-07-25', 'items': [], 'accession': '0000021344-26-000040', 'doc': 'q.htm'}]
        pg, errs = await page_with(ctx, base, fresh, None, '', 'stock-ok', {'data/KO.json': ko})
        await pg.goto(base + '?selftest=1&t=KO')
        await pg.wait_for_timeout(1500)
        fil = await pg.inner_text('section[aria-label="Latest filings"]')
        check('Results for a quarter or year' in fil and 'can no longer be relied on' in fil and 'warning sign' in fil, f'stock page lists filings and flags the warning sign: {fil[:200]!r}')
        hrefs = await pg.evaluate("[...document.querySelectorAll('section[aria-label=\"Latest filings\"] a')].map((a) => a.href)")
        check('https://www.sec.gov/Archives/edgar/data/1/000002134426000050/ko-8k.htm' in hrefs and len(hrefs) == 3, f'filing links go to the SEC filing itself: {hrefs}')
        check(not errs, f'no page errors on the stock page with filings {errs}')
        await pg.close()

        # ---- your own tickers: any ticker can be added and tracked with the shares, cost and price you enter
        start = {'watch': {'v': 1, 'items': [{'t': 'AAPL', 'added': '2026-01-01', 'shares': 2, 'cost': 150}], 'snap': None, 'prev': None},
                 'advisor': {'v': 1, 'profile': {'horizon': 'long', 'drop': 'hold', 'time': 'mid', 'focus': 'test', 'hold': 'auto', 'swing': 'no', 'broker': 'tiered', 'monthlyAed': 1000}, 'hp': {}, 'other': []}}
        pg, errs = await page_with(ctx, base, fresh, start, '', None, {'data/lt-summary.json': LT})
        await pg.click('#nav button:has-text("Watchlist")')
        await pg.wait_for_timeout(1000)
        async def add(t):
            await pg.fill('input[aria-label="Ticker to add"]', t)
            await pg.press('input[aria-label="Ticker to add"]', 'Enter')
            await pg.wait_for_timeout(600)
            return await pg.inner_text('#page-watchlist')
        txt = await add('ISDW')
        check('is a fund' in txt and 'Open the Portfolio page' in txt, 'own tickers: a fund is sent to the Portfolio page, not added as a stock')
        txt = await add('$$$')
        check('does not look like a ticker' in txt, 'own tickers: nonsense is refused')
        txt = await add('xyz')
        check('is not on the site’s list' in txt and 'Add XYZ as my own ticker' in txt, 'own tickers: a ticker outside the list can be added anyway')
        await pg.click('button:has-text("Add XYZ as my own ticker")')
        await pg.wait_for_timeout(800)
        item = pg.locator('.wl-item', has_text='XYZ')
        itxt = await item.inner_text()
        check('Your own ticker' in itxt and 'No analysis here' in itxt and 'Not analysed here' in itxt, f'own tickers: shown as your own, without analysis: {itxt[:160]!r}')
        check('No price yet' in itxt and 'n/a' not in itxt, 'own tickers: says there is no price yet instead of n/a')
        await item.locator('button:has-text("I own it")').click()
        await item.locator('label:has-text("Shares") input').fill('10')
        await item.locator('label:has-text("Average cost") input').fill('5')
        await item.locator('label:has-text("Its price now") input').fill('6')
        check(await item.locator('text=A swing trade').count() == 0, 'own tickers: no swing levels (they need live prices)')
        await item.locator('button:has-text("Save")').click()
        await pg.wait_for_timeout(800)
        itxt = await pg.locator('.wl-item', has_text='XYZ').inner_text()
        check('10 shares worth $60.00 at your price' in itxt and '+20.0%' in itxt, f'own tickers: value and gain at your price: {itxt[:220]!r}')
        pc = await pg.inner_text('section[aria-label="Portfolio check"]')
        check('Not screened here: XYZ' in pc and 'Every position passes' not in pc, 'own tickers: the portfolio check says they are not screened')
        box = await pg.evaluate("document.querySelector('section[aria-label=\"Weekly review\"] textarea').value")
        check('XYZ 10 shares at $5.00' in box and '(not on the site)' in box and 'look up their latest results' in box, 'own tickers: in the weekly review, for Claude to look up')
        link = await pg.evaluate("document.querySelector('section[aria-label=\"Use on another device\"] textarea').value")
        check(not errs, f'no page errors adding your own ticker {errs}')
        # the daily brief and the Portfolio page count it at your price and say why there is no advice
        await pg.click('#homeBtn')
        await pg.wait_for_timeout(1200)
        brief = await pg.inner_text('section[aria-label="Your daily brief"]')
        check('Your own tickers (not on the site)' in brief and 'XYZ 10 shares at $6.00 (your price' in brief, f'own tickers: listed in the brief: {brief[:400]!r}')
        await pg.click('#nav button:has-text("Portfolio")')
        await pg.wait_for_timeout(1500)
        adv = await pg.inner_text('section[aria-label="Advice on what you hold"]')
        check('Your own ticker: not analysed here' in adv and 'none of the tool’s rules' in adv and 'Counted at the price you entered ($6.00 on' in adv, f'own tickers: the Portfolio page counts it and gives no rule-based advice: {adv[:400]!r}')
        check('Only 2 US stocks, so it is still concentrated (largest: AAPL' in adv and 'no concentration' not in adv, 'a portfolio still being built is called concentrated, not problem-free')
        # its ticker in the brief has no stock page to open, so it goes to the Watchlist
        await pg.click('#homeBtn')
        await pg.wait_for_timeout(1000)
        await pg.click('section[aria-label="Your daily brief"] button.tk:has-text("XYZ")')
        await pg.wait_for_timeout(800)
        check(await pg.locator('#page-watchlist').is_visible(), 'own tickers: the brief opens the Watchlist for them, not an empty stock page')
        check(not errs, f'no page errors with your own ticker on the brief and Portfolio page {errs}')
        await pg.close()
        # the sync link carries it to another device
        pg, errs = await page_with(ctx, base, fresh, {'watch': {'v': 1, 'items': [], 'snap': None, 'prev': None}})
        await pg.goto(base + '?selftest=1&p=watchlist' + link[link.index('#'):])
        await pg.wait_for_timeout(1500)
        await pg.click('button:has-text("Add to my list")')
        await pg.wait_for_timeout(800)
        itxt = await pg.locator('.wl-item', has_text='XYZ').inner_text()
        check('Your own ticker' in itxt and '10 shares worth $60.00 at your price' in itxt, 'own tickers: the sync link copies them with their price')
        check(not errs, f'no page errors importing your own ticker {errs}')
        await pg.close()
        # a typed price goes stale; the size rule still applies to your own tickers once the portfolio is built
        old = (dt.date.today() - dt.timedelta(days=40)).isoformat()
        items = [{'t': 'BIGX', 'added': '2026-01-01', 'shares': 100, 'cost': 8, 'manual': True, 'px': 10, 'pxDate': old}]
        items += [{'t': 'OWN%d' % i, 'added': '2026-01-01', 'shares': 10, 'cost': 5, 'manual': True, 'px': 5, 'pxDate': fresh} for i in range(11)]
        pg, errs = await page_with(ctx, base, fresh, {'watch': {'v': 1, 'items': items, 'snap': None, 'prev': None}, 'advisor': start['advisor']}, '', None, {'data/lt-summary.json': LT})
        await pg.click('#nav button:has-text("Watchlist")')
        await pg.wait_for_timeout(1000)
        itxt = await pg.locator('.wl-item', has_text='BIGX').inner_text()
        check('Your price is from' in itxt, f'own tickers: an old typed price asks to be updated: {itxt[:260]!r}')
        itxt = await pg.locator('.wl-item', has_text='OWN0').inner_text()
        check('Your price is from' not in itxt, 'own tickers: a recent typed price gives no alert')
        await pg.click('#homeBtn')
        await pg.wait_for_timeout(1000)
        brief = await pg.inner_text('section[aria-label="Your daily brief"]')
        check(brief.count('That price is over a month old') == 1, 'own tickers: the brief asks to update an old typed price')
        await pg.click('#nav button:has-text("Portfolio")')
        await pg.wait_for_timeout(1500)
        adv = await pg.inner_text('section[aria-label="Advice on what you hold"]')
        row = await pg.locator('section[aria-label="Advice on what you hold"] .srow', has_text='BIGX').inner_text()
        check('Trim' in row and 'above 15% in one company' in row and 'the size rule is the only one' in row, f'own tickers: the size rule still applies to them: {row[:300]!r}')
        check('still concentrated' not in adv, 'no building-up note once the portfolio has enough stocks')
        check(not errs, f'no page errors with many own tickers {errs}')
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
