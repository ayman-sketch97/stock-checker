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


STRAY_CHILD = r"""(() => {
  const kinds = [Element.prototype, Document.prototype, DocumentFragment.prototype, CharacterData.prototype];
  for (const proto of kinds) for (const m of ['append', 'prepend', 'replaceChildren', 'before', 'after', 'replaceWith']) {
    if (!Object.prototype.hasOwnProperty.call(proto, m)) continue;
    const f = proto[m];
    proto[m] = function (...xs) {
      if (xs.some((x) => x === null || x === undefined || typeof x === 'boolean'))
        console.error(`stray child: ${m}(${xs.map((x) => (x instanceof Node ? x.nodeName : typeof x === 'string' ? 'text' : String(x))).join(', ')}) ${(new Error().stack.split('\n')[2] || '').trim()}`);
      return f.apply(this, xs);
    };
  }
})();"""


def weekday_back(n):
    d = dt.date.today()
    while n > 0:
        d -= dt.timedelta(days=1)
        if d.weekday() < 5:
            n -= 1
    return d.isoformat()


# A ledger with one current Zoya check that says compliant for each ticker, written by the page's own code. Tests of the
# buy suggestions, plan and limits start from this, so they test the limits and not the Shariah gate (which has its own tests).
SEED_LEDGER = r"""(ts) => { const S = window.__sc.shariah; const p = (n) => String(n).padStart(2, '0'); const d = new Date(); d.setDate(d.getDate() - 3);
  const checked = `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`; const t0 = new Date(); const today = `${t0.getFullYear()}-${p(t0.getMonth() + 1)}-${p(t0.getDate())}`;
  let e = []; for (const t of ts) e = S.appendEntry(e, { kind: 'check', t, status: 'compliant', checked, source: 'zoya_app', evidence: 'test fixture: a Zoya screen' }, today, new Date().toISOString()).entries;
  localStorage.setItem('shariah', JSON.stringify({ v: 1, entries: e })); localStorage.setItem('shariah_anchor', JSON.stringify(S.anchorOf(e))); }"""


async def page_with(ctx, base, price_date, storage=None, path='', stock=None, extra=None, patch=None, zoya=None):
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
    # a null, undefined or true/false child passed to the browser's own append() is printed as that word on the page,
    # so every test that checks for page errors also fails on one of these
    pg.on('console', lambda m: errs.append(m.text) if m.text.startswith('stray child') else None)
    await pg.add_init_script(STRAY_CHILD)
    await pg.route(re.compile(r'.*(/data/|quotes\.json).*'), route)
    await pg.goto(base + '?selftest=1')
    if storage is not None:
        await pg.evaluate('(s) => { localStorage.clear(); for (const [k, v] of Object.entries(s)) localStorage.setItem(k, JSON.stringify(v)); }', storage)
        if zoya:
            await pg.evaluate(SEED_LEDGER, [r[0] for r in screen['rows']] if zoya == 'all' else list(zoya))
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

        # ---- trade size: loss at the stop, and the risk limit (1% given explicitly; the approved default is 0.5%)
        z = await pg.evaluate("__sc.sizePosition(100, 95, 1000, 10000, 0.01)")
        check(near(z['shares'], 10) and near(z['loss'], 50) and near(z['maxPos'], 2000) and not z['overLimit'], f'$1,000 at 100 with a stop at 95: 10 shares, $50 at risk, at most $2,000: {z}')
        z = await pg.evaluate("__sc.sizePosition(100, 95, 3000, 10000, 0.01)")
        check(z['overLimit'], 'a position above the 1% risk size is flagged')
        z = await pg.evaluate("__sc.sizePosition(100, 99.5, 1000, 5000, 0.01)")
        check(near(z['maxPos'], 5000), 'a very tight stop never suggests more than the whole portfolio')
        check(await pg.evaluate("__sc.sizePosition(100, 100, 1000, 10000)") is None, 'a stop that is not below the entry gives no size')
        z = await pg.evaluate("__sc.sizePosition(100, 95, 1500, 10000)")
        check(near(z['maxPos'], 1000) and z['overLimit'], f'the approved default risks 0.5% a trade: at most $1,000 here, so $1,500 is flagged: {z}')

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
        act = await pg.inner_text('section.card.act')
        check('null' not in act and 'undefined' not in act, f'"What to do now" with fresh data shows no stray "null": {act[:160]!r}')
        check('Closing price, Mar 14' in act, f'without chart data the date comes from "close on 2025-03-14" (it used to be blank, which also hid live prices): {act[:60]!r}')
        check(not errs, f'no page errors on a normal stock page {errs}')
        await pg.close()
        # the Technical tab with a full chart file, written by the site's own engine (test/make-tech-fixture.mjs), every section open
        tech_ok = json.load(open(os.path.join(FIX, 'tech-ok.json')))
        pg, errs = await page_with(ctx, base, fresh, None, '', 'stock-ok', {'data/tech/KO.json': tech_ok})
        await pg.goto(base + '?selftest=1&t=KO')
        await pg.wait_for_timeout(1500)
        await pg.locator('button:has-text("Technical")').first.click()
        await pg.wait_for_timeout(1200)
        for det in await pg.locator('#page-stock details summary').all():
            try:
                await det.click(timeout=800)
            except Exception:
                pass
        await pg.wait_for_timeout(400)
        tt = await pg.inner_text('#page-stock')
        check('Signals' in tt and 'Closing price, Nov 2' in tt and not re.search(r'\bnull\b|\bundefined\b|\bNaN\b', tt), f'Technical tab: signals and the chart date shown, no missing values printed: {tt[:120]!r}')
        check(not errs, f'no page errors on the Technical tab {errs}')
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
        # the size rule applies at any number of stocks (PREREGISTERED.md, section 6): on its own, MSFT is 44% of the two
        # stocks, so the brief says trim it
        pg, errs = await page_with(ctx, base, fresh, own, '', None, {'data/lt-summary.json': LT}, with_events)
        brief = await pg.inner_text('section[aria-label="Your daily brief"]')
        check('MSFT' in brief and 'of everything you own, above your 15% limit: sell about $' in brief and 'to bring it back to 10%' in brief, f'brief: with nothing else recorded, MSFT is 44% of everything and is trimmed: {brief[:500]!r}')
        await pg.close()
        # with the rest of the portfolio recorded ($10,000 in cash and funds), no stock is above 15%
        own['advisor'] = {'v': 1, 'profile': None, 'hp': {}, 'other': [{'id': 'o1', 'sym': 'CASH', 'kind': 'cash', 'market': '', 'shares': None, 'value': 10000}]}
        pg, errs = await page_with(ctx, base, fresh, own, '', None, {'data/lt-summary.json': LT}, with_events, zoya='all')
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
        # the Portfolio page shows your own split next to what the test supports, says when they differ, and never nudges
        # you to switch (3 Nov 2026: 70/30 is a personal risk decision, not a test result)
        await pg.evaluate("(p) => { localStorage.setItem('advisor', JSON.stringify(p)); }",
                          {'v': 1, 'profile': {'horizon': 'long', 'drop': 'hold', 'time': 'mid', 'focus': 'stocks', 'hold': 'auto', 'swing': 'no', 'broker': 'tiered', 'monthlyAed': 1000}, 'hp': {}, 'other': []})
        await pg.click('#nav button:has-text("Portfolio")')
        await pg.wait_for_timeout(1200)
        offer = await pg.locator('#page-advisor button:has-text("Let the test decide my split")').count()
        check(offer == 0, 'portfolio: no nudge to hand your split to the test')
        mix = await pg.inner_text('section[aria-label="Your target mix"]')
        check('your split (your choice)' in mix.lower() and '70% stocks' in mix and 'not a result of the 10-year test' in mix and 'what the 10-year test supports' in mix.lower() and '50% stocks · 50% index fund' in mix
              and 'They differ: your split puts 20% more of everything in stocks than the test supports' in mix and 'Mixed evidence' in mix and 'it beat random picks in 60% of them' in mix,
              f'portfolio: your 70% and the test\'s 50% side by side, with the gap explained: {mix[:900]!r}')
        check('a personal risk decision, not a result of the 10-year test' in mix, 'portfolio: the reasons call 70% your own risk decision')
        # choosing "Let the 10-year test decide" in the answers hands the split to the evidence
        await pg.evaluate("(p) => { localStorage.setItem('advisor', JSON.stringify(p)); }",
                          {'v': 1, 'profile': {'horizon': 'long', 'drop': 'hold', 'time': 'mid', 'focus': 'test', 'hold': 'auto', 'swing': 'no', 'broker': 'tiered', 'monthlyAed': 1000}, 'hp': {}, 'other': []})
        await pg.click('#nav button:has-text("Watchlist")')
        await pg.wait_for_timeout(500)
        await pg.click('#nav button:has-text("Portfolio")')
        await pg.wait_for_timeout(1200)
        mix = await pg.inner_text('section[aria-label="Your target mix"]')
        check('so your split is the evidence' in mix, f'portfolio: with the test deciding, your split is the evidence: {mix[:300]!r}')
        check('You let the 10-year test decide' in mix and '50%' in mix and 'the long-term picks on this page' in mix, f'portfolio: the test of the page\'s own picks sets stocks to 50%: {mix[:300]!r}')
        check('Short-term picks get no real money' in mix and 'short term' not in mix.split('Your stocks')[1].split('\n')[0], 'portfolio: untested short-term picks get no real money, their share goes to the long term')
        hp = await pg.inner_text('section[aria-label="Holding periods"]')
        check('In the 10-year test: its ideas were ahead of the average halal stock by 8.1% a year' in hp and 'beat random picks in one half' in hp
              and 'Over 59 five-year periods (starting each month from Dec 2016 to Oct 2021), it beat random picks in 60% of them and the S&P 500 in 40%. The periods overlap: together they hold about two independent five-year spans' in hp, f'portfolio: each holding period shows what the test found: {hp[:600]!r}')
        check(not errs, f'no page errors on the brief, watchlist and portfolio {errs}')
        await pg.close()

        # ---- record: the long-term list test
        pg, errs = await page_with(ctx, base, fresh, None, '', None, {'data/lt-summary.json': LT})
        await pg.click('#nav button:has-text("Record")')
        await pg.wait_for_timeout(1200)
        ltc = await pg.inner_text('section[aria-label="Long-term list test"]')
        check('The list did not beat the average stock' in ltc and '17.6%' in ltc and 'Companies that disappeared are missing' in ltc and 'Whether that flatters or understates the results, against random halal stocks or the S&P 500, cannot be measured with free data' in ltc, f'record: the long-term test, its verdict and its limits: {ltc[:200]!r}')
        check('Other ways to build the list' in ltc and 'Ahead, but not clearly more than luck' in ltc and 'Did worse than the average' in ltc and 'None passed every check' in ltc,
              'record: the other methods tried, each with its result in plain words')
        check('The picks the Portfolio page buys' in ltc and 'Half in stocks' in ltc and 'The money split follows the long-term picks' in ltc and 'Short-term picks cannot be tested yet' in ltc,
              'record: the test of the Portfolio page\'s own picks, which sets the split')
        check('The same with the original rules (before 3 Nov 2026), for comparison only' in ltc and '+11.7%' in ltc and '+22.9%' in ltc, 'record: the original rules\' result is kept apart from the approved one')
        check('1,000 AED a month with your limits of 3 Nov 2026 (first version), a year' in ltc and 'What the evidence supports' in ltc, f'record: the rule set behind the numbers is named: {ltc[-2500:-1500]!r}')
        check('Five-year periods (59, starting each month from Dec 2016 to Oct 2021): beat random picks / beat the S&P 500' in ltc and '60% / 40%' in ltc
              and 'Result on one 10-year path' in ltc and 'Mostly in the fund' in ltc and 'Since 3 Nov 2026 the test result comes from the five-year periods' in ltc and '+12.4% / +18.7%' in ltc,
              f'record: the plan judged on many five-year periods, with the single path next to it: {ltc[-1500:]!r}')
        check('Companies the test cannot see. It holds only companies listed today.' in ltc and '34% have since disappeared (28% taken over or merged, 3.5% bankrupt' in ltc and 'Free price sources do not keep the prices of companies that disappeared' in ltc
              and 'flatters whichever side would have held more of them' in ltc and 'removes their deal prices from whichever side would have held more of those' in ltc and 'Which side would have held more of either is not known' in ltc
              and 'cannot be measured with free data' in ltc and 'it can show a large failure, not prove skill' in ltc and 'affected less' not in ltc and 'probably flattered' not in ltc and 'may understate' not in ltc and 'would have hurt random' not in ltc
              and 'about two independent five-year spans' in ltc,
              'record: the 10-year test says which companies it cannot see, how that can bias each comparison, and that its periods overlap')
        lim = await pg.inner_text('section[aria-label="Limits of the test"]')
        check('That can make the results look better or worse than they would have been, and free data cannot show which or by how much.' in lim and 'look better than reality' not in lim,
              f'record: the swing test states its survivorship gap without claiming a direction: {lim[:300]!r}')
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
        check('Only 2 US stocks, so the stock part is still concentrated (largest: AAPL' in adv and 'no concentration' not in adv, 'a portfolio still being built is called concentrated, not problem-free')
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
        check('Trim' in row and 'above your 15% limit for one company' in row and 'only the size rule can be applied' in row, f'own tickers: the size rule still applies to them: {row[:300]!r}')
        check('still concentrated' not in adv, 'no building-up note once the portfolio has enough stocks')
        check(not errs, f'no page errors with many own tickers {errs}')
        await pg.close()

        # ---- stage 1 (3 Nov 2026): one risk check for every buy suggestion: halal "pass", your limits, late data
        prof = {'horizon': 'long', 'drop': 'hold', 'time': 'mid', 'focus': 'test', 'hold': 'auto', 'swing': 'no', 'broker': 'tiered', 'monthlyAed': 1000}
        # the stock page: an unresolved halal status turns a buy price into "check halal status first"
        ko_review = json.load(open(os.path.join(FIX, 'stock-ok.json')))
        ko_review['labels']['shariah']['status'] = 'review'
        pg, errs = await page_with(ctx, base, fresh, None, '', None, {'data/KO.json': ko_review})
        await pg.goto(base + '?selftest=1&t=KO')
        await pg.wait_for_timeout(1500)
        act = await pg.inner_text('.act-row >> nth=0')
        check('Check halal status first' in act and 'Strong buy price now' not in act, f'stock page: no buy while the halal status is unresolved: {act[:160]!r}')
        check(not errs, f'no page errors on the stock page halal check {errs}')
        await pg.close()
        # the stock page: a stock that is already most of the portfolio is blocked by the 10% limit
        heavy = {'watch': {'v': 1, 'items': [{'t': 'KO', 'added': '2026-01-01', 'shares': 100, 'cost': 50}, {'t': 'AAPL', 'added': '2026-01-01', 'shares': 1, 'cost': 150}], 'snap': None, 'prev': None},
                 'advisor': {'v': 1, 'profile': prof, 'hp': {}, 'other': []}}
        pg, errs = await page_with(ctx, base, fresh, heavy, '', 'stock-ok')
        await pg.goto(base + '?selftest=1&t=KO')
        await pg.wait_for_timeout(1800)
        act = await pg.inner_text('.act-row >> nth=0')
        check('Blocked by your limits' in act and 'of your portfolio' in act and '10%' in act, f'stock page: the 10% limit blocks adding to a stock that is most of the portfolio: {act[:220]!r}')
        note = await pg.inner_text('section[aria-label="What to do now"], .act-h')
        check(not errs, f'no page errors on the stock page limit check {errs}')
        await pg.close()
        # the Portfolio page: a holding under review says so, never "Passes the halal screen"; a sector already above 40%
        # gets no new buys, so the plan and the ideas skip it
        def add_rows(scr):
            F = {k: i for i, k in enumerate(scr['fields'])}
            base_row = list(scr['rows'][0])
            nv = list(base_row)
            for k, v in {'ticker': 'NVDA', 'name': 'Nvidia', 'sector': 'Technology', 'verdict': 'BUY', 'shariah': 'pass', 'quality': 90, 'growth': 80, 'health': 80, 'price': 100, 'buyBelow': 120, 'trimAbove': 300, 'upside': 0.3, 'fair': 140, 'trend': 'up'}.items():
                nv[F[k]] = v
            scr['rows'].append(nv)
            for r in scr['rows']:
                if r[F['ticker']] == 'KO':
                    r[F['verdict']] = 'BUY'; r[F['trimAbove']] = 120
                if r[F['ticker']] == 'MSFT':
                    r[F['shariah']] = 'review'
        techy = {'watch': {'v': 1, 'items': [{'t': 'AAPL', 'added': '2026-01-01', 'shares': 2, 'cost': 150}, {'t': 'MSFT', 'added': '2026-01-01', 'shares': 1, 'cost': 300}], 'snap': None, 'prev': None},
                 'advisor': {'v': 1, 'profile': prof, 'hp': {}, 'other': [{'id': 'o1', 'sym': 'ISDW', 'kind': 'fund', 'market': '', 'shares': None, 'value': 5000}]}}
        pg, errs = await page_with(ctx, base, fresh, techy, '', None, {'data/lt-summary.json': LT}, patch=add_rows, zoya='all')
        await pg.click('#nav button:has-text("Portfolio")')
        await pg.wait_for_timeout(1800)
        adv = await pg.inner_text('section[aria-label="Advice on what you hold"]')
        msft = await pg.locator('section[aria-label="Advice on what you hold"] .srow', has_text='MSFT').inner_text()
        check('Check halal' in msft and 'unresolved' in msft and 'Passes the halal screen' not in msft, f'portfolio: a holding under review is called unresolved: {msft[:200]!r}')
        plan_txt = await pg.inner_text('section[aria-label="This month"]')
        check('NVDA' not in plan_txt and 'MSFT' not in plan_txt, f'portfolio: the plan buys neither a sector above 40% nor a stock under review: {plan_txt[:400]!r}')
        fit = await pg.inner_text('section[aria-label="Stocks that fit you"]')
        check('NVDA' in fit and 'Blocked by your limits' in fit and 'Technology is already' in fit, f'portfolio: the idea in the full sector is shown as blocked, with the reason: {fit[:500]!r}')
        lim = await pg.inner_text('section[aria-label="Your limits"]')
        check('approved on 3 November 2026' in lim, 'portfolio: the limits card shows the approved limits')
        # change a limit: the risk per swing trade becomes 1% and the stock page says so
        await pg.locator('section[aria-label="Your limits"] label:has-text("swing trade") input').fill('1')
        await pg.click('section[aria-label="Your limits"] button:has-text("Save limits")')
        await pg.wait_for_timeout(900)
        lim = await pg.inner_text('section[aria-label="Your limits"]')
        check('You changed them' in lim, 'portfolio: a changed limit is saved and marked as changed')
        risk = await pg.evaluate("JSON.parse(localStorage.getItem('advisor')).limits.swingRisk")
        check(near(risk, 0.01), f'portfolio: the new limit is stored as 1%: {risk}')
        z = await pg.evaluate("__sc.sizePosition(100, 95, 1000, 10000)")
        check(near(z['maxPos'], 2000), f'the position size follows the changed limit: {z}')
        check(not errs, f'no page errors with the limits on the Portfolio page {errs}')
        await pg.close()
        # late data: every action is paused, the numbers stay
        pg, errs = await page_with(ctx, base, weekday_back(6), techy, '', None, {'data/lt-summary.json': LT}, patch=add_rows)
        brief = await pg.inner_text('section[aria-label="Your daily brief"]')
        check('Advice paused' in brief and 'To do' not in brief and 'Ideas for new money' not in brief, f'brief: late data pauses the to-do list and the ideas: {brief[:300]!r}')
        await pg.click('#nav button:has-text("Portfolio")')
        await pg.wait_for_timeout(1800)
        adv = await pg.inner_text('section[aria-label="Advice on what you hold"]')
        plan_txt = await pg.inner_text('section[aria-label="This month"]')
        check('Advice paused' in adv and 'Paused' in adv and 'Advice paused' in plan_txt, 'portfolio: late data pauses the advice and the monthly plan')
        check(not errs, f'no page errors with late data {errs}')
        await pg.close()

        # ---- stage 2 (3 Nov 2026): the permanent record on the Record page, and the tool's view kept with each trade
        rec_summary = {'version': 2, 'measures': 4, 'previousMeasures': 3, 'thresholds': {'family': 6, 'alpha': 0.025, 'minMatured': 30, 'finalMatured': 100, 'warnInterval': 0.9, 'previousMinDays': 5}, 'returns': 'price', 'since': '2026-11-03', 'days': 4, 'chain': {'ok': True, 'at': None, 'okBefore': True}, 'today': None, 'kinds': {'verdict': 1500, 'buy_in': 40},
                       'groups': {'buy': {'label': 'Entered the long-term buy zone', 'up': True, 'n': 12, 'h': {'1m': {'n': 5, 'ret': 0.03, 'spy': 0.01, 'diff': 0.02, 'beat': 0.6, 'y': {'n': 5, 'diff': 0.01, 'beat': 0.5, 't10': 0.1, 'b10': 0.2, 'b20': 0.1, 'gap': 0.01, 'lo': -0.02, 'hi': 0.04, 'p': 0.3, 'ahead': False, 'behind': False, 'months': 2, 'need': 2, 'periods': 2, 'short': False}}, '3m': {'n': 0}, '6m': {'n': 0}, '12m': {'n': 0, 'verdict': 'waiting'}}},
                                  'trim': {'label': 'Reached the trim price', 'up': False, 'n': 31, 'h': {'1m': {'n': 0}, '3m': {'n': 0}, '6m': {'n': 0}, '12m': {'n': 31, 'matured': 31, 'wrong': 0.29, 'st': 1, 'po': 31, 'up': 0, 'ret': 0.08, 'spy': 0.1, 'diff': -0.02, 'beat': 0.4, 't10': 0.3, 'b10': 0.29, 'b20': 0.1, 'verdict': 'short', 'provisional': True, 'previous': {'version': 3, 'verdict': 'short'}, 'y': {'n': 31, 'diff': 0.0, 'beat': 0.45, 't10': 0.44, 'b10': 0.32, 'b20': 0.22, 'gap': -0.02, 'lo': None, 'hi': None, 'p': None, 'ahead': False, 'behind': False, 'months': 3, 'need': 24, 'periods': 1, 'short': True}}}},
                                  'sell_weak': {'label': 'Business weakened: sell', 'up': False, 'n': 40, 'h': {'1m': {'n': 0}, '3m': {'n': 0}, '6m': {'n': 0}, '12m': {'n': 40, 'matured': 40, 'wrong': 0.45, 'st': 0, 'po': 40, 'up': 0, 'ret': 0.2, 'spy': 0.1, 'diff': 0.1, 'beat': 0.6, 't10': 0.1, 'b10': 0.45, 'b20': 0.3, 'verdict': 'warn', 'provisional': True, 'previous': {'version': 3, 'verdict': 'fail'}, 'y': {'n': 40, 'diff': 0.0, 'beat': 0.45, 't10': 0.44, 'b10': 0.32, 'b20': 0.22, 'gap': 0.1, 'lo': 0.03, 'hi': 0.17, 'p': 0.99, 'ahead': False, 'behind': True, 'months': 25, 'need': 24, 'periods': 3, 'short': False}}}},
                                  'hold_fall': {'label': 'Fell 20% with the business still sound: hold', 'up': True, 'n': 6, 'h': {'1m': {'n': 0}, '3m': {'n': 6, 'ret': 0.05, 'spy': 0.01, 'diff': 0.04, 'beat': 0.67, 'y': {'n': 6, 'diff': -0.01, 'beat': 0.4, 't10': 0.3, 'b10': 0.1, 'b20': 0.05, 'gap': 0.05, 'lo': 0.01, 'hi': 0.09, 'p': 0.01, 'ahead': True, 'behind': False, 'months': 6, 'need': 6, 'periods': 6, 'short': False}}, '6m': {'n': 0}, '12m': {'n': 34, 'matured': 35, 'up': 1, 'st': 0, 'po': 34, 'ret': 0.15, 'spy': 0.1, 'diff': 0.05, 'wrong': 0.3, 'beat': 0.6, 't10': 0.27, 'b10': 0.4, 'b20': 0.2, 'verdict': 'pass', 'provisional': True, 'previous': {'version': 3, 'verdict': 'pass'}, 'y': {'n': 34, 'diff': -0.02, 'beat': 0.45, 't10': 0.44, 'b10': 0.3, 'b20': 0.2, 'gap': 0.07, 'lo': 0.01, 'hi': 0.12, 'p': 0.001, 'ahead': True, 'behind': False, 'months': 26, 'need': 24, 'periods': 3, 'short': False}}}}},
                       'standing': {}, 'recent': [{'d': '2026-11-06', 't': 'MSFT', 'g': 'hold_fall', 'px': 320, 'v': 'BUY'}, {'d': '2026-11-05', 't': 'KO', 'g': 'buy', 'px': 60, 'v': 'BUY'}], 'url': 'https://github.com/ayman-sketch97/stock-checker/tree/records'}
        pg, errs = await page_with(ctx, base, fresh, None, '', None, {'data/lt-summary.json': LT, 'data/record-summary.json': rec_summary})
        await pg.click('#nav button:has-text("Record")')
        await pg.wait_for_timeout(1500)
        rc = await pg.inner_text('section[aria-label="The permanent record"]')
        check('every file intact' in rc and '4 days recorded' in rc and '+2.0%' in rc and '5 followed, 60% beat it' in rc and '12 calls' in rc and 'waiting' in rc and 'lower is better' in rc and 'KO, entered the long-term buy zone at $60.00' in rc,
              f'record: the permanent record card shows the chain, the follow-up and the latest calls: {rc[:400]!r}')
        check('Fell 20% with the business still sound: hold' in rc and '6 calls' in rc and 'MSFT, fell 20% with the business still sound: hold at $320.00' in rc and 'the rule says hold, not sell' in rc,
              f'record: the hold-through-a-fall calls get their own row and are explained: {rc[:900]!r}')
        # sections 7.1 and 7.3: each figure next to random halal stocks on the same days; the 1 and 3-month columns are
        # early reads, judged only when the gap is more than noise and the calls span enough months
        check('Random halal stocks, same days: +1.0% · no clear difference from random halal stocks so far (early read, not a test of skill)' in rc and 'Random halal stocks, same days: -1.0% · ahead of random halal stocks so far (early read, not a test of skill)' in rc,
              f'record: the yardstick and its early read in each cell: {rc[:1500]!r}')
        table = rc.split('Each kind of call after 12 months')[0]
        check('better than random' not in table and 'passes' not in table.replace('passes (below)', ''), 'record: no early read and no 90% interval in the table says better than random or passes')
        check('Random halal stocks, same days: 0.0% · too few months of calls to judge' in rc and 'Random halal stocks, same days: -2.0% · passes (below)' in rc and 'Random halal stocks, same days: 0.0% · worse than random: under review (below)' in rc,
              f'record: the 12-month column shows each kind\'s tested verdict, not the 90% interval: {table[-900:]!r}')
        check('(prices only)' in rc and 'The 1 and 3-month columns are early reads' in rc and 'not evidence of skill' in rc and 'Only the 12-month results below are tested' in rc, 'record: the table says prices only and which columns are early reads')
        # measures 1, 2 and 4: wrong calls, shown from 30 matured calls, next to the yardstick, judged as one family
        check('Reached the trim price: 31 calls have had their 12 months (provisional until 100).' in rc and 'Calls made in 3 months, 1 separate 12-month period.' in rc and 'Return +8.0%, S&P 500 +10.0% over the same days: -2.0%; random halal stocks 0.0%.' in rc
              and 'Wrong calls: 29% (random halal stocks 32%).' in rc and '1 stopped trading (followed to the last price).' in rc and 'measured on prices only' not in rc and 'Too short a record to judge: calls in 3 months, 24 needed.' in rc
              and 'Entered the long-term buy zone: waiting, 0 of 30 calls have had their 12 months.' in rc and '45% of halal stocks trailed' in rc and 'Holm correction' in rc and 'at least 24 different months' in rc,
              f'record: each kind of call after 12 months: {rc[-2600:]!r}')
        check('Fell 20% with the business still sound: hold: 35 calls have had their 12 months' in rc and '1 without prices, counted as wrong' in rc and 'Passes: better than random halal stocks, unlikely to be chance even with all six kinds of call tested together.' in rc,
              'record: a kind of call that passes, with an unpriceable call counted as wrong')
        check('Business weakened: sell: 40 calls have had their 12 months' in rc and 'Calls made in 25 months, 3 separate 12-month periods.' in rc and 'Worse than random halal stocks: under review (a warning, not a verdict on skill).' in rc,
              'record: a kind of call worse than random is put under review, as a warning only')
        check('Previous method, for comparison only (section 7.2, more lenient): would pass.' in rc and 'Previous method, for comparison only (section 7.2, more lenient): would fail.' in rc and 'Previous method, for comparison only (section 7.2, more lenient): too few days of calls.' in rc
              and 'it decides nothing' in rc and 'a warning, never evidence of skill' in rc, 'record: the previous method stays visible beside each verdict, for comparison only')
        hrefs = await pg.evaluate("[...document.querySelectorAll('section[aria-label=\"The permanent record\"] a')].map((a) => a.href)")
        check('https://github.com/ayman-sketch97/stock-checker/tree/records' in hrefs, 'record: links to every file on GitHub')
        check(not errs, f'no page errors on the permanent record card {errs}')
        await pg.close()
        # problems are shown, not hidden: a missing day, a night not saved, no prices, repeats and companies left out
        bad = {**rec_summary, 'chain': {'ok': False, 'at': '2026-11-05', 'why': 'missing', 'okBefore': True}, 'saved': False, 'prices': False, 'repeatDays': 30,
               'groups': {**rec_summary['groups'], 'buy': {**rec_summary['groups']['buy'], 'rep': 2, 'gone': 1}}}
        for fix, want, what in [(bad, ['a day is missing (2026-11-05)', 'could not be saved to GitHub', 'Prices could not be loaded tonight', 'Not counted again: 2 repeats', 'Without prices tonight: 1 call', 'they count as wrong, never as a success'], 'problems'),
                                ({'skipped': 'not read', 'url': rec_summary['url']}, ['could not be read tonight', 'every file on GitHub'], 'a skipped night'),
                                ({**rec_summary, 'days': 1, 'recent': [], 'groups': {k: {**g, 'n': 0, 'h': {h: {'n': 0} for h in g['h']}} for k, g in rec_summary['groups'].items()},
                                  'standing': {'buy': {**rec_summary['groups']['buy'], 'n': 41, 'h': {h: {'n': 0} for h in rec_summary['groups']['buy']['h']}},
                                               'sell_weak': {'label': 'Business weakened: sell', 'up': False, 'n': 0, 'h': {'1m': {'n': 0}, '3m': {'n': 0}, '6m': {'n': 0}, '12m': {'n': 0}}}}},
                                 ['No new calls yet', '41 calls', 'first close after it was published'], 'the first day')]:
            pg, errs = await page_with(ctx, base, fresh, None, '', None, {'data/lt-summary.json': LT, 'data/record-summary.json': fix})
            await pg.click('#nav button:has-text("Record")')
            await pg.wait_for_timeout(1500)
            rc = await pg.inner_text('section[aria-label="The permanent record"]')
            check(all(w in rc for w in want), f'record: {what} are shown on the card: {rc[:700]!r}')
            if what == 'the first day':
                check('Business weakened' not in rc and '0 calls' not in rc, f'record: the first day shows no empty rows: {rc[:700]!r}')
            check(not errs, f'no page errors showing {what} {errs}')
            await pg.close()
        # the journal keeps what the tool said when you logged the trade (KO is rated "watch", outside its buy zone here)
        pg, errs = await page_with(ctx, base, fresh, {'journal': {'v': 1, 'trades': [], 'backup': None}})
        await pg.click('#nav button:has-text("Journal")')
        await pg.wait_for_timeout(900)
        await pg.click('button:has-text("Add a trade")')
        await pg.wait_for_timeout(500)
        await pg.fill('label:has-text("Ticker") input', 'KO')
        await pg.fill('label:has-text("Buy price") input', '90')
        await pg.fill('label:has-text("Shares") input', '3')
        await pg.select_option('select[aria-label="Setup"]', 'longterm')
        await pg.click('button:has-text("Add to journal")')
        await pg.wait_for_timeout(900)
        tool = await pg.evaluate("JSON.parse(localStorage.getItem('journal')).trades[0].tool")
        check(tool is not None and tool.get('v') == 'WATCH' and tool.get('s') == 'pass' and tool.get('buy') is False, f'journal: a new trade keeps what the tool said that day: {tool}')
        jt = await pg.inner_text('#page-journal')
        check('When you bought, the tool said: ' in jt and 'halal pass' in jt, 'journal: the trade shows what the tool said')
        check(not errs, f'no page errors keeping the tool view {errs}')
        await pg.close()
        # closed trades: with the tool and against it, side by side
        closed = [{'id': 'c1', 't': 'KO', 'opened': '2026-01-02', 'entry': 50, 'shares': 2, 'setup': 'longterm', 'closed': '2026-03-02', 'exit': 60, 'tool': {'d': '2026-01-01', 'v': 'BUY', 's': 'pass', 'buy': True, 'sig': ''}},
                  {'id': 'c2', 't': 'MSFT', 'opened': '2026-01-02', 'entry': 100, 'shares': 1, 'setup': 'longterm', 'closed': '2026-03-02', 'exit': 90, 'tool': {'d': '2026-01-01', 'v': 'WATCH', 's': 'pass', 'buy': False, 'sig': ''}}]
        pg, errs = await page_with(ctx, base, fresh, {'journal': {'v': 1, 'trades': closed, 'backup': None}})
        await pg.click('#nav button:has-text("Journal")')
        await pg.wait_for_timeout(900)
        res = await pg.inner_text('section[aria-label="Your results"]')
        check('Trades the tool agreed with when you bought: 1 (average +20.0% a trade); trades against it: 1 (average -10.0%)' in res, f'journal: results with the tool and against it: {res[-300:]!r}')
        check(not errs, f'no page errors in the with-or-against results {errs}')
        await pg.close()

        # ---- the position-size rules made exact (PREREGISTERED.md, section 6): the page runs lib/policy.js
        pg, errs = await page_with(ctx, base, fresh)
        v = await pg.evaluate('''() => { const S = __sc; return {
            r0: S.buyRoom(0, 10000), r99: S.buyRoom(990, 10000), w99: S.worthAnOrder(S.buyRoom(990, 10000)), r99b: S.buyRoom(9900, 100000), w99b: S.worthAnOrder(S.buyRoom(9900, 100000)),
            r10: S.buyRoom(1000, 10000), rNoise: S.buyRoom(0.1 * 3, 3), r12: S.buyRoom(1200, 10000), rNew: S.buyRoom(900, 10000),
            t15: S.trimSale(1500, 10000), t1501: S.trimSale(1501, 10000), t20: S.trimSale(2000, 10000), t12: S.trimSale(1200, 10000),
            s40: S.sectorOpen(400, 1000), s39: S.sectorOpen(399.99, 1000), sz50: S.sizeTrim(2000, 10000), szSmall: S.sizeTrim(160, 1000), rules: S.POLICY_RULES }; }''')
        check(v['r0'] == 1000 and abs(v['r99'] - 10) < 1e-9 and v['w99'] is False and abs(v['r99b'] - 100) < 1e-9 and v['w99b'] is True, f'page rules: a new stock takes up to 10%; 9.9% leaves 0.1% of the portfolio, an order only if that is $100 or more: {v}')
        check(v['r10'] == 0 and v['rNoise'] == 0 and v['r12'] == 0 and abs(v['rNew'] - 100) < 1e-9, 'page rules: at 10% (even with a rounding error) and above, no room')
        check(v['t15'] == 0 and abs(v['t1501'] - 501) < 1e-9 and abs(v['t20'] - 1000) < 1e-9 and v['t12'] == 0, 'page rules: exactly 15% is kept, above it goes back to 10%, between 10% and 15% is held')
        check(v['s40'] is False and v['s39'] is True and abs(v['sz50'] - 1000) < 1e-9 and v['szSmall'] == 0, 'page rules: a sector at 40% is closed; a trim under $100 is not worth an order')
        check(v['rules'] == {'buyCap': 0.1, 'trimAt': 0.15, 'trimTo': 0.1, 'sectorMax': 0.4, 'minOrder': 100}, f"page rules: the approved numbers {v['rules']}")
        # the risk check: a stock at 9.9% of a $10,000 portfolio is blocked (room $10), of a $100,000 one allowed (room $100)
        bc = await pg.evaluate('''() => { __sc.shariah.SHL.add({ kind: 'check', t: 'AAA', status: 'compliant', checked: (() => { const d = new Date(); d.setDate(d.getDate() - 3); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; })(), source: 'zoya_app', evidence: 'test fixture' });
            const scr = { by: new Map([['AAA', { shariah: 'pass', sector: 'Tech' }]]), priceDate: __sc.screen().priceDate };
            const snap = (v, tot) => ({ byT: new Map([['AAA', v]]), bySector: new Map([['Tech', v]]), usVal: tot * 0.7, total: tot, n: 7 });
            return [__sc.buyCheck('AAA', scr, snap(990, 10000)), __sc.buyCheck('AAA', scr, snap(9900, 100000)), __sc.buyCheck('AAA', scr, snap(1000, 10000)), __sc.buyCheck('AAA', scr, snap(900, 9000), 1000)]; }''')
        check(not bc[0]['ok'] and 'leaves room for $10.00, under the $100.00 an order needs' in bc[0]['why'][0], f"risk check: 9.9% of $10,000 is blocked: {bc[0]}")
        check(bc[1]['ok'] and abs(bc[1]['room'] - 100) < 1e-6, f"risk check: 9.9% of $100,000 can take $100: {bc[1]}")
        check(not bc[2]['ok'] and 'no buy may take a stock above 10%' in bc[2]['why'][0], f"risk check: exactly 10% is blocked: {bc[2]}")
        check(bc[3]['ok'] and abs(bc[3]['room'] - 100) < 1e-6, f"risk check: the month's money counts in the portfolio ($900 of $9,000 plus $1,000 coming): {bc[3]}")
        check(not errs, f'no page errors checking the rules {errs}')
        await pg.close()
        # 5, 10 and 15 stocks on the Portfolio page, $10,000 in all: the size rule applies at every count
        def book(vals, cash):
            items = [{'t': 'P%02d' % i, 'added': '2026-01-01', 'shares': v / 100, 'cost': 100, 'manual': True, 'px': 100, 'pxDate': fresh} for i, v in enumerate(vals)]
            return {'watch': {'v': 1, 'items': items, 'snap': None, 'prev': None},
                    'advisor': {'v': 1, 'profile': {'horizon': 'long', 'drop': 'hold', 'time': 'mid', 'focus': 'stocks', 'hold': 'auto', 'swing': 'no', 'broker': 'fixed', 'monthlyAed': 0}, 'hp': {}, 'other': [{'id': 'o1', 'sym': 'CASH', 'kind': 'cash', 'market': '', 'shares': None, 'value': cash}]}}
        cases = [(5, [2000, 1000, 1000, 1000, 1000], 4000, {'P00': 'Sell about $1,000.00 (10 shares) to bring it back to 10%'}, ['P01', 'P04']),
                 (10, [1600] + [600] * 9, 3000, {'P00': 'Sell about $600.00 (6 shares) to bring it back to 10%'}, ['P01', 'P09']),
                 (15, [1500, 1550] + [300] * 13, 3050, {'P01': 'Sell about $550.00 (5.5 shares) to bring it back to 10%'}, ['P00', 'P02'])]
        for n, vals, cash, trims, kept in cases:
            pg, errs = await page_with(ctx, base, fresh, book(vals, cash), '', None, {'data/lt-summary.json': LT})
            await pg.click('#nav button:has-text("Portfolio")')
            await pg.wait_for_timeout(1500)
            rows = await pg.evaluate("[...document.querySelectorAll('section[aria-label=\"Advice on what you hold\"] .srow')].map((e) => e.innerText)")
            byT = {r.split('\n')[0].strip(): r for r in rows}
            for t, want in trims.items():
                check(t in byT and 'Trim' in byT[t] and want in byT[t], f'{n} stocks: {t} is trimmed back to 10%: {byT.get(t, "")[:300]!r}')
            for t in kept:
                check(t in byT and 'Trim' not in byT[t], f'{n} stocks: {t} is not trimmed (at or under 15%): {byT.get(t, "")[:200]!r}')
            check(not errs, f'no page errors with {n} stocks {errs}')
            await pg.close()
        # the monthly plan: a buy is capped at the room left, and what is left over goes to the fund; too small a portfolio
        # gets no stock at all (MSFT is the fixture's long-term idea)
        for cash, want, what in [(1500, ['MSFT', 'Capped at $177.23', 'Includes $13.38 your limits leave over'], 'capped'), (500, ['No stock fits right now', 'skipped because your limits block it'], 'too small')]:
            st = book([], cash)
            st['advisor']['profile']['monthlyAed'] = 1000
            pg, errs = await page_with(ctx, base, fresh, st, '', None, {'data/lt-summary.json': LT}, zoya='all')
            await pg.click('#nav button:has-text("Portfolio")')
            await pg.wait_for_timeout(1500)
            plan = await pg.inner_text('section[aria-label="This month"]')
            check(all(w in plan for w in want), f'monthly plan ({what}): {plan[:700]!r}')
            check(not errs, f'no page errors in the monthly plan ({what}) {errs}')
            await pg.close()
        # the stock page says how much room is left; the limits card states the rules exactly
        pg, errs = await page_with(ctx, base, fresh, book([], 10000), '', 'stock-ok', zoya='all')
        await pg.goto(base + '?selftest=1&t=KO')
        await pg.wait_for_timeout(1800)
        act = await pg.inner_text('.act-row >> nth=0')
        check('Your 10% limit for one stock allows up to $1,000.00 more in it now' in act, f'stock page: the room left under the 10% limit: {act[:300]!r}')
        await pg.close()
        pg, errs = await page_with(ctx, base, fresh, book([1000], 9000), '', None, {'data/lt-summary.json': LT})
        await pg.click('#nav button:has-text("Portfolio")')
        await pg.wait_for_timeout(1500)
        lim = await pg.inner_text('section[aria-label="Your limits"]')
        check('a stock at 9.9% has room for only 0.1% of the portfolio, and at 10% none' in lim and 'whether you hold 3 stocks or 30' in lim and 'No buy may take a stock above this share' in lim, f'limits card: the exact rules in words: {lim[:900]!r}')
        check(not errs, f'no page errors on the limits card {errs}')
        await pg.close()

        # ---- holdings recorded by hand (3 Nov 2026, instead of broker statements): from a company's page and the Portfolio page
        prof0 = {'horizon': 'long', 'drop': 'hold', 'time': 'mid', 'focus': 'stocks', 'hold': 'auto', 'swing': 'no', 'broker': 'fixed', 'monthlyAed': 0}
        pg, errs = await page_with(ctx, base, fresh, {'watch': {'v': 1, 'items': [], 'snap': None, 'prev': None}, 'advisor': {'v': 1, 'profile': prof0, 'hp': {}, 'other': []}}, '', 'stock-ok')
        await pg.goto(base + '?selftest=1&t=KO')
        await pg.wait_for_timeout(1500)
        own = await pg.inner_text('.own-row')
        check('Do you own it?' in own, f'stock page: offers to record a holding: {own!r}')
        await pg.click('.own-row button:has-text("I own it")')
        await pg.wait_for_timeout(300)
        await pg.click('.own-row button:has-text("Save holding")')
        await pg.wait_for_timeout(300)
        bad = await pg.inner_text('.own-row')
        check('Not saved. Enter the number of shares' in bad and 'your average cost per share' in bad, f'stock page: an empty form is not saved: {bad[-200:]!r}')
        await pg.fill('.own-row label:has-text("Shares") input', '10')
        await pg.fill('.own-row label:has-text("Average cost") input', '45')
        await pg.fill('.own-row label:has-text("Date bought") input', '2099-01-01')
        await pg.click('.own-row button:has-text("Save holding")')
        await pg.wait_for_timeout(300)
        check('not in the future' in await pg.inner_text('.own-row'), 'stock page: a date in the future is refused')
        await pg.fill('.own-row label:has-text("Date bought") input', '2026-01-15')
        await pg.click('.own-row button:has-text("Save holding")')
        await pg.wait_for_timeout(800)
        own = await pg.inner_text('.own-row')
        check('You own 10 shares at $45.00 average (+11.1%)' in own and 'Edit holding' in own, f'stock page: the holding is shown under the quote card: {own!r}')
        w = await pg.evaluate("JSON.parse(localStorage.getItem('watch')).items")
        check(len(w) == 1 and w[0]['t'] == 'KO' and w[0]['shares'] == 10 and w[0]['cost'] == 45 and w[0]['bought'] == '2026-01-15', f'stock page: saved as an owned Watchlist entry: {w}')
        check(await pg.get_attribute('.co-name .star', 'aria-pressed') == 'true', 'stock page: the star shows it is on the Watchlist')
        await pg.click('#nav button:has-text("Portfolio")')
        await pg.wait_for_timeout(1500)
        now = await pg.inner_text('section[aria-label="Your portfolio now"]')
        check('KO' in now and '$920.00' in now, f'portfolio: the holding from the stock page is counted (10 shares at the list price of $92): {now[:500]!r}')
        check(not errs, f'no page errors recording a holding on the stock page {errs}')
        await pg.close()
        pg, errs = await page_with(ctx, base, fresh, {'watch': {'v': 1, 'items': [], 'snap': None, 'prev': None}, 'advisor': {'v': 1, 'profile': {'horizon': 'long', 'drop': 'hold', 'time': 'mid', 'focus': 'stocks', 'hold': 'auto', 'swing': 'no', 'broker': 'fixed', 'monthlyAed': 0}, 'hp': {}, 'other': []}})
        await pg.click('#nav button:has-text("Portfolio")')
        await pg.wait_for_timeout(1500)
        await pg.fill('section[aria-label="Your portfolio now"] input[aria-label="Ticker of a US stock you own"]', 'msft')
        await pg.click('section[aria-label="Your portfolio now"] button:has-text("Add a stock you own")')
        await pg.wait_for_timeout(300)
        await pg.fill('section[aria-label="Your portfolio now"] label:has-text("Shares") input', '2')
        await pg.fill('section[aria-label="Your portfolio now"] label:has-text("Average cost") input', '400')
        await pg.click('section[aria-label="Your portfolio now"] button:has-text("Save holding")')
        await pg.wait_for_timeout(1500)
        now = await pg.inner_text('section[aria-label="Your portfolio now"]')
        check('MSFT' in now and '$1,078.88' in now, f'portfolio: a stock added by hand is counted at the latest price: {now[:600]!r}')
        # a ticker the site does not cover needs its price; a fund belongs with the funds
        await pg.fill('section[aria-label="Your portfolio now"] input[aria-label="Ticker of a US stock you own"]', 'ZZZZ')
        await pg.click('section[aria-label="Your portfolio now"] button:has-text("Add a stock you own")')
        await pg.wait_for_timeout(300)
        note = await pg.inner_text('section[aria-label="Your portfolio now"]')
        check('ZZZZ is not on the site’s list' in note and 'Its price now' in note, 'portfolio: a ticker not on the site asks for its price')
        await pg.fill('section[aria-label="Your portfolio now"] label:has-text("Shares") input', '5')
        await pg.fill('section[aria-label="Your portfolio now"] label:has-text("Average cost") input', '10')
        await pg.fill('section[aria-label="Your portfolio now"] label:has-text("Its price now") input', '12')
        await pg.click('section[aria-label="Your portfolio now"] button:has-text("Save holding")')
        await pg.wait_for_timeout(1500)
        now = await pg.inner_text('section[aria-label="Your portfolio now"]')
        check('ZZZZ' in now and '$60.00' in now, f'portfolio: your own ticker is counted at your price: {now[:700]!r}')
        await pg.fill('section[aria-label="Your portfolio now"] input[aria-label="Ticker of a US stock you own"]', 'ISDW')
        await pg.click('section[aria-label="Your portfolio now"] button:has-text("Add a stock you own")')
        await pg.wait_for_timeout(300)
        check('ISDW is a fund' in await pg.inner_text('section[aria-label="Your portfolio now"]'), 'portfolio: a fund is sent to the funds section')
        # sold: the holding goes, the Watchlist entry stays
        await pg.click('section[aria-label="Your portfolio now"] tr:has-text("MSFT") button:has-text("Sold")')
        await pg.wait_for_timeout(1500)
        w = await pg.evaluate("JSON.parse(localStorage.getItem('watch')).items")
        ms = [x for x in w if x['t'] == 'MSFT']
        check(len(ms) == 1 and not ms[0].get('shares'), f'portfolio: "Sold" clears the holding and keeps MSFT on the Watchlist: {ms}')
        check(not errs, f'no page errors recording holdings on the Portfolio page {errs}')
        await pg.close()

        # ---- system health on the Record page (lib/health.js, written by the nightly build)
        hl = {'version': 1, 'builtAt': '2026-11-04T03:30:00Z', 'priceDate': fresh, 'commit': 'abc1234def', 'worst': 'ok', 'checks': [
            {'id': 'coverage', 'status': 'ok', 'label': 'Companies analysed', 'text': '1,990 of 2,000 (99.5%).'},
            {'id': 'withheld', 'status': 'info', 'label': 'Verdicts withheld', 'text': '350 companies get no verdict.'},
            {'id': 'record', 'status': 'ok', 'label': 'Permanent record', 'text': '3 days recorded, every file intact.'}]}
        for what, fix, rs, want in [
                ('a normal night', hl, {'days': 3, 'chain': {'ok': True}}, ['Everything the nightly run checks is working.', 'Companies analysed. 1,990 of 2,000', 'From the close of', 'Built from version abc1234']),
                ('a record not saved', hl, {'days': 3, 'chain': {'ok': True}, 'saved': False}, ['Working, with 1 thing to know.', 'could not be saved to GitHub']),
                ('a broken record', {**hl, 'worst': 'bad', 'checks': hl['checks'][:2] + [{'id': 'record', 'status': 'bad', 'label': 'Permanent record', 'text': 'A file of the record does not match its fingerprint.'}]}, {'days': 3, 'chain': {'ok': False}}, ['1 problem needs attention', 'does not match its fingerprint']),
                ('no report', None, {'days': 3, 'chain': {'ok': True}}, ['could not be read'])]:
            extra = {'data/lt-summary.json': LT, 'data/record-summary.json': {**rec_summary, **rs}}
            if fix is not None:
                extra['data/health.json'] = fix
            pg, errs = await page_with(ctx, base, fresh, None, '', None, extra)
            await pg.click('#nav button:has-text("Record")')
            await pg.wait_for_timeout(1500)
            hc = await pg.inner_text('section[aria-label="System health"]')
            check(all(w in hc for w in want), f'system health ({what}): {hc[:500]!r}')
            check(not errs, f'no page errors on the system health card ({what}) {errs}')
            await pg.close()

        # ---- data-health banner on every page that shows advice (display only: no pause, no change to any figure)
        def hchk(i, st, label, text):
            return {'id': i, 'status': st, 'label': label, 'text': text}
        base_checks = [hchk('coverage', 'ok', 'Companies analysed', '1,990 of 2,000 (99.5%).'), hchk('history', 'ok', 'Price history', '1,900 companies with a full price history.'),
                       hchk('earnings', 'warn', 'Earnings dates', '1 day of the calendar could not be read.'), hchk('record', 'ok', 'Permanent record', '3 days recorded, every file intact.')]
        def with_check(i, st, text):
            return [hchk(i, st, i.title(), text) if c['id'] == i else c for c in base_checks]
        hb_base = {'version': 1, 'builtAt': '2026-11-04T03:30:00Z', 'priceDate': fresh, 'commit': 'abc1234def', 'worst': 'bad'}
        hb_cases = [
            ('history unavailable', {**hb_base, 'checks': with_check('history', 'bad', 'The price-history source stopped answering tonight, so charts, swing signals and the chart checks are missing or a day old.')}, fresh,
             ['Data problem tonight', 'Price history unavailable', 'swing trade idea as unconfirmed', 'stopped answering tonight', 'Prices: not late', 'not about the prices', '1 other warning'], ['Prices: late']),
            ('companies missing', {**hb_base, 'checks': with_check('coverage', 'bad', '1,500 of 2,000 (75%).')}, fresh,
             ['Companies missing tonight', 'keep yesterday', '1,500 of 2,000'], ['Price history unavailable']),
            ('record not trusted', {**hb_base, 'checks': with_check('record', 'bad', 'A file of the record does not match its fingerprint.')}, fresh,
             ['Track record not trusted', 'worked out separately'], ['Price history unavailable']),
            ('unknown check', {**hb_base, 'checks': base_checks + [hchk('newcheck', 'bad', 'A new check', 'Something new failed.')]}, fresh,
             ['Other data problem: A new check', 'Something new failed.'], []),
            ('late prices as well', {**hb_base, 'priceDate': weekday_back(6), 'checks': with_check('history', 'bad', 'The price-history source stopped answering tonight.')}, weekday_back(6),
             ['Price history unavailable', 'Prices: late', 'Advice paused'], ['Prices: not late']),
        ]
        for what, fix, pdate, want, absent in hb_cases:
            for pname in ['stock', 'shortlist', 'watchlist', 'advisor', 'journal', 'record']:
                pg, errs = await page_with(ctx, base, pdate, None, '', None, {'data/lt-summary.json': LT, 'data/record-summary.json': rec_summary, 'data/health.json': fix})
                if pname != 'stock':
                    await pg.click(f'#nav button[data-page="{pname}"]')
                await pg.wait_for_timeout(900)
                vis = await pg.locator('#healthBanner').is_visible()
                if pname == 'record':
                    check(not vis, f'health banner ({what}): not repeated on the Record page, which has the full card')
                else:
                    txt = (await pg.inner_text('#healthBanner')) if vis else ''
                    check(vis and all(w in txt for w in want) and not any(a in txt for a in absent), f'health banner ({what}) on {pname}: {txt[:300]!r}')
                    if what != 'late prices as well':
                        check(await pg.locator('.hint.stale').count() == 0, f'health banner ({what}) on {pname}: advice is not paused by it')
                check(not errs, f'no page errors with the health banner ({what}, {pname}) {errs}')
                await pg.close()
        for what, fix in [('a normal night', {**hb_base, 'worst': 'ok', 'checks': base_checks}), ('only warnings', {**hb_base, 'worst': 'warn', 'checks': with_check('earnings', 'warn', 'x')}), ('no report', None)]:
            extra = {'data/lt-summary.json': LT, 'data/record-summary.json': rec_summary}
            if fix is not None:
                extra['data/health.json'] = fix
            pg, errs = await page_with(ctx, base, fresh, None, '', None, extra)
            await pg.click('#nav button[data-page="watchlist"]')
            await pg.wait_for_timeout(900)
            check(not await pg.locator('#healthBanner').is_visible(), f'no health banner for {what}')
            check(not errs, f'no page errors without a health banner ({what}) {errs}')
            await pg.close()

        # ---- Shariah ledger (stage 4): the page, the form, storage, the integrity check and the backup
        today = dt.date.today()
        iso = lambda d: d.isoformat()
        ago = lambda n: iso(today - dt.timedelta(days=n))
        hold = {'watch': {'v': 1, 'items': [{'t': 'AAA', 'added': '2026-01-01', 'shares': 10, 'cost': 100}, {'t': 'BBB', 'added': '2026-01-01', 'shares': 5, 'cost': 50}], 'snap': None, 'prev': None}}

        async def lg_record(pg, ticker, status, date, source, evidence, change=None):
            form = pg.locator('#page-shariah form.editbox').first
            await form.locator('select[aria-label="Ticker"]').select_option(ticker)
            await form.locator('select[aria-label="Status on Zoya"]').select_option(status)
            await form.locator('input[type=date]').first.fill(date)
            await form.locator('select[aria-label="Source"]').select_option(source)
            await form.locator('textarea').fill(evidence)
            if change:
                await form.locator('input[type=date]').nth(1).fill(change)
            await form.locator('button[type=submit]').click()
            await pg.wait_for_timeout(400)

        lg_store = lambda pg: pg.evaluate("JSON.parse(localStorage.getItem('shariah') || 'null')")
        pg, errs = await page_with(ctx, base, fresh, hold, '&p=shariah')
        txt = await pg.inner_text('#page-shariah')
        check('Shariah ledger' in txt and 'AAA' in txt and 'BBB' in txt, 'ledger page lists both holdings')
        check(txt.count('Not recorded') == 2 and 'No Shariah record for this holding' in txt, 'a holding with no record is flagged as missing, not assumed compliant')
        check('Inactive: pending a scholar-approved method' in txt and 'pending a method confirmed by a qualified Shariah scholar' in txt, 'purification shows as inactive pending a scholar-approved method')
        check(await pg.locator('#nav button[aria-current="page"]').inner_text() == 'Portfolio', 'the Portfolio tab stays highlighted on the ledger page')
        check(await pg.locator('#page-shariah a[href^="https://zoya.finance/stocks/"]').count() == 2, 'each holding links to its Zoya page')

        # a check without evidence is refused and nothing is stored
        await lg_record(pg, 'AAA', 'compliant', ago(3), 'zoya_app', '')
        check('evidence is required' in await pg.inner_text('#page-shariah form.editbox'), 'no evidence: refused with a clear message')
        check(await lg_store(pg) is None, 'a refused entry is not stored')
        # a future date is refused
        await lg_record(pg, 'AAA', 'compliant', iso(today + dt.timedelta(days=1)), 'zoya_app', 'x')
        check(await lg_store(pg) is None, 'a future date is not stored')

        await lg_record(pg, 'AAA', 'compliant', ago(3), 'zoya_app', 'Zoya app screen, status Compliant')
        txt = await pg.inner_text('#page-shariah')
        due = iso(today - dt.timedelta(days=3) + dt.timedelta(days=90))
        check('Recorded as compliant on Zoya' in txt and f'Recheck due {due}' in txt, f'compliant check shows its 90-day recheck date {due}')
        st = await lg_store(pg)
        check(st and len(st['entries']) == 1 and st['entries'][0]['evidence'] == 'Zoya app screen, status Compliant', 'the entry is stored on this device with its evidence')
        check(await pg.evaluate("JSON.parse(localStorage.getItem('shariah_anchor')).count") == 1, 'the anchor is stored in its own key')

        # unconfirmed source counts for nothing
        await lg_record(pg, 'BBB', 'compliant', ago(2), 'other', 'a blog post')
        txt = await pg.inner_text('#page-shariah')
        check('Unconfirmed: compliant (not from Zoya)' in txt and 'Nothing here comes from Zoya' in txt, 'a status from another source is kept but flagged as unconfirmed')

        # compliant -> not compliant opens the 90-day exit deadline, counted from the change date
        change = ago(10)
        await pg.locator('#page-shariah form.editbox').first.locator('select[aria-label="Status on Zoya"]').select_option('non_compliant')
        await lg_record(pg, 'AAA', 'non_compliant', ago(1), 'zoya_web', 'Zoya site shows Not Compliant', change)
        txt = await pg.inner_text('#page-shariah')
        dl = iso(today - dt.timedelta(days=10) + dt.timedelta(days=90))
        check('Changed from compliant to not compliant' in txt, 'the change from compliant to not compliant is detected')
        check(f'Exit deadline {dl}' in txt and '80 days left' in txt, f'exit deadline is 90 days from the change date: {dl}, 80 days left')
        check(not await pg.locator('#page-shariah form.editbox').first.locator('input[type=date]').nth(1).is_visible(), 'the change-date field is hidden again after saving')

        # exit steps
        card = pg.locator('#page-shariah section[aria-label="AAA"]')
        await card.locator('button:has-text("Update the exit")').click()
        xf = card.locator('form.editbox')
        await xf.locator('select').select_option('in_progress')
        await xf.locator('input[type=text]').fill('sell order placed')
        await xf.locator('button[type=submit]').click()
        await pg.wait_for_timeout(400)
        txt = await pg.inner_text('#page-shariah section[aria-label="AAA"]')
        check('Exit: In progress' in txt, 'the exit step is recorded and shown')
        st = await lg_store(pg)
        check([e['kind'] for e in st['entries']] == ['check', 'check', 'check', 'exit'], 'entries are only ever added: ' + str([e['kind'] for e in st['entries']]))

        # a correction strikes an entry through and keeps it
        before = len(st['entries'])
        card = pg.locator('#page-shariah section[aria-label="BBB"]')
        await card.locator('summary').click()
        await card.locator('button.tk:has-text("Correct")').first.click()
        await card.locator('input[type=text]').first.fill('read the wrong stock')
        await card.locator('button:has-text("Strike through")').click()
        await pg.wait_for_timeout(400)
        st = await lg_store(pg)
        check(len(st['entries']) == before + 1 and st['entries'][-1]['kind'] == 'correction' and st['entries'][1]['status'] == 'compliant', 'a correction adds an entry and leaves the original in place')
        check(await pg.locator('#page-shariah section[aria-label="BBB"] .lg-void').count() == 1, 'the corrected entry shows struck through')
        check('Not recorded' in await pg.inner_text('#page-shariah section[aria-label="BBB"]'), 'after the correction BBB has no counted record again')
        ok_chain = await pg.evaluate("(() => { const s = JSON.parse(localStorage.getItem('shariah')); return __sc.shariah.verifyLedger(s.entries).ok; })()")
        check(ok_chain, 'the chain verifies in the browser with the same code as the tests')
        check('History intact' in await pg.inner_text('#page-shariah'), 'the page says the history is intact')
        check(not errs, f'no page errors on the ledger page {errs}')

        # the Portfolio summary (profile filled in so the full page renders)
        full = {**hold, 'advisor': {'v': 1, 'profile': {'horizon': 'long', 'drop': 'hold', 'time': 'mid', 'focus': 'test', 'hold': 'auto', 'swing': 'no', 'broker': 'tiered', 'monthlyAed': 1000}, 'coreName': 'ISDW', 'core': None, 'safe': None, 'hp': {}, 'other': []}}
        pg, errs = await page_with(ctx, base, fresh, full, '&p=advisor')
        await pg.wait_for_timeout(800)
        card = pg.locator('#page-advisor section[aria-label="Shariah ledger"]')
        check(await card.count() == 1, 'Portfolio page shows the Shariah ledger summary card')
        if await card.count():
            check('need' in await card.inner_text() and 'Zoya is the final word' in await card.inner_text(), 'the summary says what needs action and that Zoya is final')
            await card.locator('button:has-text("Open the ledger")').click()
            await pg.wait_for_timeout(500)
            check(await pg.locator('#page-shariah').is_visible(), 'the button opens the ledger page')
        check(not errs, f'no page errors on the Portfolio page with the ledger card {errs}')
        await pg.close()

        # tampering with the stored history is caught and blocks adding
        pg, errs = await page_with(ctx, base, fresh, hold, '&p=shariah')
        await lg_record(pg, 'AAA', 'compliant', ago(5), 'zoya_app', 'screen')
        await lg_record(pg, 'BBB', 'compliant', ago(4), 'zoya_app', 'screen')
        await pg.evaluate("(() => { const s = JSON.parse(localStorage.getItem('shariah')); s.entries[0].status = 'non_compliant'; localStorage.setItem('shariah', JSON.stringify(s)); })()")
        await pg.goto(base + '?selftest=1&p=shariah')
        await pg.wait_for_timeout(1000)
        txt = await pg.inner_text('#page-shariah')
        check('failed its check' in txt and 'does not match its hash' in txt, 'an edited entry is reported by the page')
        await lg_record(pg, 'AAA', 'compliant', ago(1), 'zoya_app', 'another')
        check(len((await lg_store(pg))['entries']) == 2, 'nothing can be added to a ledger that fails its check')
        await pg.evaluate("(() => { const s = JSON.parse(localStorage.getItem('shariah')); s.entries[0].status = 'compliant'; s.entries.pop(); localStorage.setItem('shariah', JSON.stringify(s)); })()")
        await pg.goto(base + '?selftest=1&p=shariah')
        await pg.wait_for_timeout(1000)
        txt = await pg.inner_text('#page-shariah')
        check('failed its check' in txt and 'removed' in txt, 'entries cut off the end are caught by the anchor')
        await pg.close()

        # no horizontal scroll on a phone
        pg, errs = await page_with(ctx, base, fresh, hold, '&p=shariah')
        await pg.set_viewport_size({'width': 390, 'height': 844})
        await lg_record(pg, 'AAA', 'non_compliant', ago(1), 'zoya_app', 'a long piece of evidence ' * 12, ago(2))
        await pg.wait_for_timeout(300)
        wide = await pg.evaluate('document.documentElement.scrollWidth - window.innerWidth')
        check(wide <= 1, f'the ledger page does not scroll sideways on a phone ({wide}px over)')
        await pg.close()

        # backup round trip: the ledger travels in the backup file, is joined not overwritten, and a damaged copy is refused
        pg, errs = await page_with(ctx, base, fresh, hold, '&p=shariah')
        await lg_record(pg, 'AAA', 'compliant', ago(5), 'zoya_app', 'screen')
        await lg_record(pg, 'BBB', 'non_compliant', ago(2), 'zoya_app', 'screen B', ago(4))
        await pg.click('#nav button:has-text("Journal")')
        await pg.wait_for_timeout(800)
        async with pg.expect_download() as dl:
            await pg.click('button:has-text("Save backup")')
        path = await (await dl.value).path()
        saved = json.load(open(path))
        check(len(saved['extra']['shariah']['entries']) == 2 and saved['extra']['shariah']['anchor']['count'] == 2, 'the backup file holds the ledger and its anchor')
        keep = lambda: [e['hash'] for e in saved['extra']['shariah']['entries']]
        await pg.evaluate('localStorage.clear()')
        await pg.goto(base + '?selftest=1&p=journal')
        await pg.wait_for_timeout(900)
        await pg.set_input_files('#page-journal input[type=file]', path)
        await pg.wait_for_timeout(900)
        back = await lg_store(pg)
        check(back and [e['hash'] for e in back['entries']] == keep(), 'restoring a backup brings the ledger back unchanged')
        check('Shariah ledger:' in await pg.inner_text('#page-journal'), 'the restore message mentions the ledger')
        await pg.wait_for_timeout(1500)
        await pg.set_input_files('#page-journal input[type=file]', path)
        await pg.wait_for_timeout(600)
        check(len((await lg_store(pg))['entries']) == 2, 'loading the same backup again adds nothing')
        await pg.wait_for_timeout(1500)
        # a backup with an edited entry is not merged
        bad = json.loads(json.dumps(saved))
        bad['extra']['shariah']['entries'][0]['status'] = 'non_compliant'
        bp = os.path.join(tmp, 'bad-backup.json'); json.dump(bad, open(bp, 'w'))
        await pg.evaluate('localStorage.clear()')
        await pg.goto(base + '?selftest=1&p=journal')
        await pg.wait_for_timeout(900)
        await pg.set_input_files('#page-journal input[type=file]', bp)
        await pg.wait_for_timeout(600)
        check(await lg_store(pg) is None and 'does not pass its own check' in await pg.inner_text('#page-journal'), 'a backup whose ledger was edited is refused, nothing is imported')
        await pg.wait_for_timeout(1500)
        # a backup with entries cut off the end is not merged
        cut = json.loads(json.dumps(saved))
        cut['extra']['shariah']['entries'] = cut['extra']['shariah']['entries'][:1]
        cp = os.path.join(tmp, 'cut-backup.json'); json.dump(cut, open(cp, 'w'))
        await pg.set_input_files('#page-journal input[type=file]', cp)
        await pg.wait_for_timeout(600)
        check(await lg_store(pg) is None and 'removed' in await pg.inner_text('#page-journal'), 'a backup with entries cut off the end is refused')
        check(not errs, f'no page errors during the ledger backup tests {errs}')
        await pg.close()

        # ---- stage 4, decisions of 6 November: purification is off, new buys need a current Zoya check in the ledger, the
        # 90-day countdown starts only from a confirmed move from compliant. The tests above use a compliant ledger; these use every other state.
        SEED_SPEC = r"""(specs) => { const S = window.__sc.shariah; const p = (n) => String(n).padStart(2, '0');
          const iso = (n) => { const d = new Date(); d.setDate(d.getDate() - n); return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`; };
          let e = []; for (const x of specs) { const f = x.kind === 'purification' ? { kind: 'purification', t: x.t, action: 'due', amount: x.amount, currency: 'USD', asOf: iso(x.ago), basis: 'Scholar X, fixture' }
              : { kind: 'check', t: x.t, status: x.status, checked: iso(x.ago), source: x.source || 'zoya_app', evidence: 'test fixture' };
            if (x.change != null) f.changeDate = iso(x.change);
            const r = S.appendEntry(e, f, iso(0), new Date().toISOString()); if (!r.ok) throw new Error(r.errors.join('; ')); e = r.entries; }
          localStorage.setItem('shariah', JSON.stringify({ v: 1, entries: e })); localStorage.setItem('shariah_anchor', JSON.stringify(window.__sc.shariah.anchorOf(e))); }"""

        async def ko_action(specs, tamper=False, st=None):
            pg, errs = await page_with(ctx, base, fresh, st or book([], 10000), '', 'stock-ok')
            if specs is not None:
                await pg.evaluate(SEED_SPEC, specs)
            if tamper:
                await pg.evaluate("() => { const d = JSON.parse(localStorage.getItem('shariah')); d.entries[0].evidence = 'edited afterwards'; localStorage.setItem('shariah', JSON.stringify(d)); }")
            await pg.goto(base + '?selftest=1&t=KO')
            await pg.wait_for_timeout(1500)
            act = await pg.inner_text('.act-row >> nth=0')
            await pg.close()
            return act, errs

        ALLOW = 'Your 10% limit for one stock allows up to $1,000.00 more in it now'
        gate_cases = [
            ('no ledger at all', None, 'Blocked by the Shariah ledger', 'no record in your Shariah ledger'),
            ('empty ledger', [], 'Blocked by the Shariah ledger', 'no record in your Shariah ledger'),
            ('only another ticker has a record', [{'t': 'AAPL', 'status': 'compliant', 'ago': 3}], 'Blocked by the Shariah ledger', 'no record in your Shariah ledger'),
            ('compliant on Zoya, 3 days ago', [{'t': 'KO', 'status': 'compliant', 'ago': 3}], None, None),
            ('compliant on Zoya, 89 days ago', [{'t': 'KO', 'status': 'compliant', 'ago': 89}], None, None),
            ('compliant on Zoya, 90 days ago (the recheck day)', [{'t': 'KO', 'status': 'compliant', 'ago': 90}], None, None),
            ('compliant on Zoya, 91 days ago: stale', [{'t': 'KO', 'status': 'compliant', 'ago': 91}], 'Blocked by the Shariah ledger', 'is stale: last checked'),
            ('compliant on Zoya, 400 days ago: stale', [{'t': 'KO', 'status': 'compliant', 'ago': 400}], 'Blocked by the Shariah ledger', 'is stale: last checked'),
            ('not compliant on Zoya', [{'t': 'KO', 'status': 'compliant', 'ago': 60}, {'t': 'KO', 'status': 'non_compliant', 'ago': 5, 'change': 8}], 'Blocked by the Shariah ledger', 'Zoya shows it as not compliant'),
            ('questionable on Zoya', [{'t': 'KO', 'status': 'compliant', 'ago': 60}, {'t': 'KO', 'status': 'questionable', 'ago': 5}], 'Blocked by the Shariah ledger', 'questionable'),
            ('compliant, but not from Zoya', [{'t': 'KO', 'status': 'compliant', 'ago': 3, 'source': 'other'}], 'Blocked by the Shariah ledger', 'nothing in your Shariah ledger for it comes from Zoya'),
            ('Zoya compliant, then a newer entry that is not from Zoya', [{'t': 'KO', 'status': 'compliant', 'ago': 30}, {'t': 'KO', 'status': 'compliant', 'ago': 3, 'source': 'other'}], 'Blocked by the Shariah ledger', 'not from Zoya, so its status is not confirmed'),
            ('back to compliant after not compliant', [{'t': 'KO', 'status': 'compliant', 'ago': 60}, {'t': 'KO', 'status': 'non_compliant', 'ago': 20, 'change': 22}, {'t': 'KO', 'status': 'compliant', 'ago': 2}], None, None),
        ]
        for name, specs, title, reason in gate_cases:
            act, errs = await ko_action(specs)
            if title is None:
                check(ALLOW in act and 'Blocked' not in act, f'new-buy gate, {name}: the buy is allowed: {act[:260]!r}')
            else:
                check(title in act and reason in act and ALLOW not in act, f'new-buy gate, {name}: blocked, with the reason: {act[:300]!r}')
            check(not errs, f'no page errors in the new-buy gate case {name} {errs}')
        act, errs = await ko_action([{'t': 'KO', 'status': 'compliant', 'ago': 3}], tamper=True)
        check('Blocked by the Shariah ledger' in act and 'failed its own check' in act and ALLOW not in act, f'new-buy gate, ledger edited afterwards: blocked, with the reason: {act[:300]!r}')

        # the same gate on the Portfolio page: the plan gives a blocked stock no money and says why; a held stock is not sold for it
        gl_state = {'watch': {'v': 1, 'items': [{'t': 'AAPL', 'added': '2026-01-01', 'shares': 2, 'cost': 150}, {'t': 'MSFT', 'added': '2026-01-01', 'shares': 1, 'cost': 300}, {'t': 'KO', 'added': '2026-03-01'}], 'snap': None, 'prev': None},
                    'advisor': {'v': 1, 'profile': {'horizon': 'long', 'drop': 'hold', 'time': 'mid', 'focus': 'test', 'hold': 'auto', 'swing': 'no', 'broker': 'tiered', 'monthlyAed': 1000}, 'hp': {}, 'other': [{'id': 'o1', 'sym': 'ISDW', 'kind': 'fund', 'market': '', 'shares': None, 'value': 5000}]}}

        async def advice(specs):
            pg, errs = await page_with(ctx, base, fresh, gl_state, '', None, {'data/lt-summary.json': LT}, with_events)
            if specs is not None:
                await pg.evaluate(SEED_SPEC, specs)
            await pg.goto(base + '?selftest=1&p=advisor')
            await pg.wait_for_timeout(1800)
            rows = await pg.evaluate("[...document.querySelectorAll('section[aria-label=\"Advice on what you hold\"] .srow')].map((e) => e.innerText)")
            plan = await pg.inner_text('section[aria-label="This month"]')
            full = await pg.inner_text('#page-advisor')
            await pg.close()
            return {r.split('\n')[0].strip(): r for r in rows}, plan, full, errs
        every = [{'t': t, 'status': 'compliant', 'ago': 3} for t in ('AAPL', 'MSFT', 'KO')]
        base_rows, base_plan, base_full, e0 = await advice(every)
        for name, specs in [('no ledger', None), ('stale', [{'t': t, 'status': 'compliant', 'ago': 120} for t in ('AAPL', 'MSFT', 'KO')]),
                            ('non-compliant, never recorded as compliant', [{'t': t, 'status': 'non_compliant', 'ago': 3, 'change': 5} for t in ('AAPL', 'MSFT', 'KO')]),
                            ('questionable', [{'t': t, 'status': 'questionable', 'ago': 3} for t in ('AAPL', 'MSFT', 'KO')])]:
            rows, plan, full, errs = await advice(specs)
            acts = {t: (r.split('\n')[1] if '\n' in r else '') for t, r in rows.items()}
            base_acts = {t: (r.split('\n')[1] if '\n' in r else '') for t, r in base_rows.items()}
            moved = {t: (base_acts.get(t), acts.get(t)) for t in set(acts) | set(base_acts) if acts.get(t) != base_acts.get(t)}
            check(all(b == 'Add' and a == 'Hold' for b, a in moved.values()), f'ledger {name}: the only change to what you hold is that an Add becomes a Hold, never a sale: {moved}')
            check(not any(a in ('Sell', 'Trim', 'Take profit') and base_acts.get(t) != a for t, a in acts.items()), f'ledger {name}: nothing is sold or trimmed because of it')
            check('KO' not in plan.split('Shariah ledger:')[0] or 'Shariah ledger' in plan, f'ledger {name}: the plan does not send money to a blocked stock without saying so')
            check(not errs, f'no page errors on the Portfolio page, ledger {name} {errs}')
        rows, plan, full, errs = await advice(None)
        check('Shariah ledger: no new money goes to AAPL, MSFT' in plan, f'portfolio, no ledger: the plan says which stocks get no new money and why: {plan[-500:]!r}')
        check('Holding and selling are not affected' in plan, 'the plan note says holding and selling are not affected')

        # the Shortlist marks a buy candidate that has no current Zoya check; and the reason is a few words, not a bare "blocked"
        pg, errs = await page_with(ctx, base, fresh, {}, '&p=shortlist', None, None, with_events)
        sl_txt = await pg.inner_text('#page-shortlist')
        check('Blocked: no Zoya record' in sl_txt, f'shortlist: a buy candidate without a Zoya record in the ledger is marked: {sl_txt[:400]!r}')
        await pg.evaluate(SEED_SPEC, [{'t': 'AAPL', 'status': 'compliant', 'ago': 3}, {'t': 'MSFT', 'status': 'non_compliant', 'ago': 3, 'change': 4}, {'t': 'KO', 'status': 'compliant', 'ago': 100}])
        await pg.goto(base + '?selftest=1&p=shortlist')
        await pg.wait_for_timeout(1500)
        sl_txt = await pg.inner_text('#page-shortlist')
        check('Blocked: Zoya check stale' in sl_txt or 'Blocked: not compliant on Zoya' in sl_txt or 'KO' not in sl_txt, f'shortlist: stale and non-compliant records are named in the tag: {sl_txt[:400]!r}')
        check(not errs, f'no page errors on the Shortlist {errs}')
        await pg.close()

        # ---- the ledger page: the countdown starts only from a confirmed move from compliant, with the change date
        async def ledger_text(specs, held=('AAA',)):
            st = {'watch': {'v': 1, 'items': [{'t': t, 'added': '2026-01-01', 'shares': 10, 'cost': 100} for t in held], 'snap': None, 'prev': None}}
            pg, errs = await page_with(ctx, base, fresh, st, '&p=shariah')
            await pg.evaluate(SEED_SPEC, specs)
            await pg.goto(base + '?selftest=1&p=shariah')
            await pg.wait_for_timeout(900)
            t = await pg.inner_text('#page-shariah section[aria-label="AAA"]')
            await pg.close()
            return t, errs
        t1, e1 = await ledger_text([{'t': 'AAA', 'status': 'non_compliant', 'ago': 3, 'change': 5}])
        check('Exit deadline' not in t1 and 'countdown has not started' in t1 and 'no earlier Zoya check that said compliant' in t1, f'ledger page: a first-ever not-compliant record starts no countdown even with a change date: {t1[:500]!r}')
        t2, e2 = await ledger_text([{'t': 'AAA', 'status': 'compliant', 'ago': 40}, {'t': 'AAA', 'status': 'non_compliant', 'ago': 3}])
        check('Exit deadline' not in t2 and 'status-change date is not recorded' in t2 and 'countdown has not started' in t2, f'ledger page: a confirmed move without its change date starts no countdown: {t2[:500]!r}')
        dl2 = (today - dt.timedelta(days=12) + dt.timedelta(days=90)).isoformat()
        t3, e3 = await ledger_text([{'t': 'AAA', 'status': 'compliant', 'ago': 40}, {'t': 'AAA', 'status': 'non_compliant', 'ago': 3, 'change': 12}])
        check(f'Exit deadline {dl2}' in t3 and '78 days left' in t3, f'ledger page: compliant then not compliant, with the change date: deadline {dl2}: {t3[:500]!r}')
        t4, e4 = await ledger_text([{'t': 'AAA', 'status': 'compliant', 'ago': 120}])
        check('Exit deadline' not in t4 and 'stale' in t4 and 'New buys: blocked' in t4, f'ledger page: a stale record starts no countdown and blocks new buys, and says so: {t4[:500]!r}')
        t5, e5 = await ledger_text([{'t': 'AAA', 'status': 'compliant', 'ago': 40}, {'t': 'AAA', 'status': 'questionable', 'ago': 3}])
        check('Exit deadline' not in t5 and 'New buys: blocked' in t5 and 'questionable' in t5, f'ledger page: a questionable record starts no countdown and blocks new buys: {t5[:500]!r}')
        t6, e6 = await ledger_text([{'t': 'AAA', 'status': 'compliant', 'ago': 3}])
        check('New buys: the ledger allows them' in t6 and 'Your limits and the site’s other checks still apply' in t6, f'ledger page: a current Zoya compliant record says new buys are allowed, and that the other checks still apply: {t6[:500]!r}')
        check(not (e1 or e2 or e3 or e4 or e5 or e6), f'no page errors on the ledger page cases {[e1, e2, e3, e4, e5, e6]}')

        # ---- purification is off: no amount, estimate or calculator anywhere, and the old records are kept
        div_extra = json.load(open(os.path.join(FIX, 'stock-ok.json')))
        div_extra['dividends'] = {'pays': True, 'yield': 0.031, 'perShare': 1.84, 'paidPerShare': 1.84, 'payoutProfit': 0.62, 'payoutFcf': 0.7, 'yearsPaid': 12, 'growth5y': 0.05, 'special': False}
        pg, errs = await page_with(ctx, base, fresh, book([], 10000), '&t=KO', None, {'data/KO.json': div_extra})
        await pg.wait_for_timeout(1000)
        dv = await pg.inner_text('#divCard') if await pg.locator('#divCard').count() else ''
        check('Dividend yield' in dv and '3.10%' in dv, f'dividend card: yield and payout are still shown: {dv[:300]!r}')
        check('Off, pending a scholar-approved method' in dv and 'does not calculate, estimate or show an amount to purify' in dv, f'dividend card: purification is off, pending a scholar-approved method: {dv[-400:]!r}')
        check('purify about' not in dv and 'Impure share' not in dv and '0.50%' not in dv and '0.5%' not in dv and await pg.locator('#divCard input').count() == 0, 'dividend card: no calculator, no amount and no percentage to purify')
        check(await pg.locator('#divCard button:has-text("Open the Shariah ledger")').count() == 1, 'dividend card: a way to the Shariah ledger for keeping a record')
        whole = await pg.evaluate("document.documentElement.textContent")
        check('Purify dividends with the calculator' not in whole and 'Purification calculator' not in whole and 'is estimated from interest income' not in whole, 'no text anywhere sends you to a purification calculator or estimate')
        check(not errs, f'no page errors on the dividend card {errs}')
        await pg.close()
        wl = {'watch': {'v': 1, 'items': [{'t': 'AAPL', 'added': '2026-01-01', 'shares': 2, 'cost': 150}, {'t': 'MSFT', 'added': '2026-01-01', 'shares': 1, 'cost': 300}], 'snap': None, 'prev': None}}
        pg, errs = await page_with(ctx, base, fresh, wl, '&p=watchlist')
        wtxt = await pg.inner_text('#page-watchlist')
        check(re.search(r'(?i)Purification\s+Off\s+pending a scholar-approved method', wtxt) is not None, f'watchlist: the purification figure is replaced by Off, pending a scholar-approved method: {wtxt[:600]!r}')
        check('Purification is switched off: no amount is calculated or estimated' in wtxt and 'estimated from the last 12 months of dividends' not in wtxt, 'watchlist: the estimate note is replaced')
        check(not errs, f'no page errors on the watchlist {errs}')
        await pg.close()
        pg, errs = await page_with(ctx, base, fresh, gl_state, '&p=advisor', None, {'data/lt-summary.json': LT}, with_events)
        ptxt = await pg.inner_text('#page-advisor')
        check('Purification is switched off until a qualified Shariah scholar gives you a method' in ptxt and 'with the calculator' not in ptxt, 'portfolio page: the old "purify with the calculator" step is replaced')
        await pg.close()
        # records kept before the change are preserved, exactly as entered, and no total or figure is made from them
        st = {'watch': {'v': 1, 'items': [{'t': 'AAA', 'added': '2026-01-01', 'shares': 10, 'cost': 100}], 'snap': None, 'prev': None}}
        pg, errs = await page_with(ctx, base, fresh, st, '&p=shariah')
        await pg.evaluate(SEED_SPEC, [{'t': 'AAA', 'status': 'compliant', 'ago': 3}, {'kind': 'purification', 't': 'AAA', 'amount': 12.5, 'ago': 2}, {'kind': 'purification', 't': 'AAA', 'amount': 3.25, 'ago': 1}])
        await pg.goto(base + '?selftest=1&p=shariah')
        await pg.wait_for_timeout(900)
        pc = await pg.inner_text('#page-shariah section[aria-label="Purification"]')
        check('Inactive: pending a scholar-approved method' in pc and 'does not calculate, estimate or show purification amounts' in pc, f'ledger page: purification is marked inactive, pending a scholar-approved method: {pc[:400]!r}')
        check('2 records kept' in pc and '12.5' not in pc and '3.25' not in pc and 'Totals' not in pc, f'ledger page: records are kept but no amount or total is shown in the purification card: {pc!r}')
        hist = await pg.evaluate("document.querySelector('#page-shariah section[aria-label=\"AAA\"]').textContent")
        check('Purification due: 12.5 USD' in hist and 'Purification due: 3.25 USD' in hist and 'basis: Scholar X, fixture' in hist, 'ledger page: both earlier records are still in the stock history, exactly as entered, with their basis')
        stv = await lg_store(pg)
        check(len(stv['entries']) == 3 and [e['kind'] for e in stv['entries']] == ['check', 'purification', 'purification'], 'the history is untouched: three entries')
        check(await pg.evaluate("window.__sc.shariah.verifyLedger(JSON.parse(localStorage.getItem('shariah')).entries).ok"), 'the chain of the earlier records still verifies')
        check(not errs, f'no page errors on the purification card {errs}')
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
