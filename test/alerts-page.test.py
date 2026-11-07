# Page tests for stage 9: the Alert Centre. Custom price alerts, scanner setup alerts, portfolio risk alerts and Shariah alerts;
# browser notifications while the site is open; the history and how it is managed. The rules under test: an unchanged condition
# is shown once and announced once; every alert says which price or data it used and how old it is; late or missing data pauses
# an alert type without closing its open alerts; nothing is ever placed, suggested or changed as an order; nothing new is fetched.
# Reuses the fixture-serving helpers of test/scanner-page.test.py (everything before its main()).
# Run: python3 test/alerts-page.test.py   (needs Python Playwright with Chromium; serves the page locally, no network)
import asyncio, datetime as dt, json, os, re, shutil, sys, time

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
FIELDS = SCREEN['fields']
IDX = {k: i for i, k in enumerate(FIELDS)}
TODAY = dt.date.today().isoformat()
# a stand-in for the browser's Notification: records every notification in localStorage so a reload cannot hide a repeat
STUB = r"""(() => {
  const jp = (k, d) => { try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : d; } catch { return d; } };
  class N {
    constructor(title, opts) { const l = jp('__notes', []); l.push({ title, body: (opts && opts.body) || '', tag: (opts && opts.tag) || '' }); localStorage.setItem('__notes', JSON.stringify(l)); }
    close() {}
  }
  Object.defineProperty(N, 'permission', { get: () => jp('__perm', 'default') });
  N.requestPermission = async () => { if (jp('__perm', 'default') !== 'denied') localStorage.setItem('__perm', JSON.stringify('granted')); return jp('__perm', 'default'); };
  window.Notification = N;
})();"""
NO_NOTIFY = "(() => { delete window.Notification; })();"


def screen_with(price_date, prices=None, shariah=None):
    s = json.loads(json.dumps(SCREEN))
    s['priceDate'] = price_date
    for r in s['rows']:
        if prices and r[0] in prices:
            r[IDX['price']] = prices[r[0]]
        if shariah and r[0] in shariah:
            r[IDX['shariah']] = shariah[r[0]]
    return s


def alerts_store(rules=None, hist=None, notify=False, types=None):
    return {'alerts': {'v': 1, 'rules': rules or [], 'hist': hist or [], 'set': {'types': types or {}, 'notify': notify}}}


def rule(i, t, d, level, on=True):
    return {'id': i, 't': t, 'dir': d, 'level': level, 'on': on, 'created': '2026-11-01'}


def entry(key, typ, t, text, asof='close of Nov 5', status='open', dismissed=False, notified=True):
    now = int(time.time() * 1000)
    return {'id': f'{key}@{now - 5000}', 'key': key, 'type': typ, 'tone': 'warn', 't': t, 'text': text, 'asOf': asof, 'px': 100, 'first': now - 5000, 'last': now - 5000,
            'status': status, 'ended': None if status == 'open' else now - 4000, 'dismissed': dismissed, 'notified': notified, 'count': 1}


async def ac(ctx, base, fresh, storage=None, wait=1700, **kw):
    kw.setdefault('path', '&p=alerts')
    pg, errs = await page_with(ctx, base, fresh, storage=storage, **kw)
    await pg.wait_for_timeout(wait)
    return pg, errs


async def reload(pg, wait=1700, url=None):
    await pg.goto(url or pg.url)
    await pg.wait_for_timeout(wait)


async def rows(pg, state=None, typ=None):
    sel = '#page-alerts li[data-key]' + (f'[data-state="{state}"]' if state else '') + (f'[data-type="{typ}"]' if typ else '')
    return await pg.evaluate("(s) => [...document.querySelectorAll(s)].map((li) => ({ key: li.dataset.key, type: li.dataset.type, state: li.dataset.state, text: li.innerText.replace(/\\s+/g, ' ').trim() }))", sel)


async def notes(pg):
    return await pg.evaluate("JSON.parse(localStorage.getItem('__notes') || '[]')")


async def stored(pg):
    return await pg.evaluate("JSON.parse(localStorage.getItem('alerts') || 'null')")


async def add_rule(pg, t, direction, level):
    await pg.fill('.alert-form input[aria-label="Ticker"]', t)
    await pg.select_option('.alert-form select', direction)
    await pg.fill('.alert-form input[aria-label="Price level in dollars"]', level)
    await pg.click('.alert-form button[type=submit]')
    await pg.wait_for_timeout(900)


async def main():
    httpd, tmp = serve()
    base = f'http://127.0.0.1:{httpd.server_address[1]}/'
    fresh = weekday_back(1)
    async with async_playwright() as p:
        b = await p.chromium.launch()
        ctx = await b.new_context(viewport={'width': 1280, 'height': 1000})

        # ---- the page, its place in the navigation, and what an empty Alert Centre shows
        reqs = []
        pg, errs = await page_with(ctx, base, fresh, storage={}, path='&p=dashboard')
        pg.on('request', lambda r: reqs.append(r.url))
        await pg.wait_for_timeout(1200)
        check(await pg.is_visible('#toAlertCentre'), 'the Dashboard offers a button to the Alert Centre')
        sub = await pg.evaluate("[...document.querySelectorAll('#subnav button')].map((x) => [x.dataset.page, x.innerText.trim()])")
        check([s[0] for s in sub] == ['dashboard', 'alerts'] and sub[0][1] == 'Overview' and sub[1][1].startswith('Alert Centre'), f'the Dashboard group lists Overview and Alert Centre: {sub}')
        await pg.click('#toAlertCentre')
        await pg.wait_for_timeout(1500)
        check('p=alerts' in pg.url and await pg.evaluate("!document.getElementById('page-alerts').hidden && document.getElementById('page-dashboard').hidden"), 'the button opens ?p=alerts')
        check(await pg.evaluate("document.querySelector('#nav button[aria-current=page]').dataset.page") == 'dashboard', 'the Dashboard tab stays highlighted on the Alert Centre')
        check((await pg.inner_text('#page-alerts h1')).strip() == 'Alert Centre', 'the page is titled Alert Centre')
        txt = await pg.inner_text('#page-alerts')
        check('No price alerts yet.' in txt and 'Ended and dismissed alerts are kept here.' in txt, 'empty rules and empty history say so')
        sc = await rows(pg, typ='scanner')
        check(len(sc) == 1 and sc[0]['key'] == 'scan:AAPL:pullback', f'the one scanner setup with an entry set (AAPL) is an alert, the two watch-only candidates are not: {sc}')
        check('Paper trade only' in sc[0]['text'] and 'Pullback' in sc[0]['text'], f'the scanner alert keeps the paper-only label and the setup name: {sc[0]["text"]}')
        check(re.search(r'opened \d{4}-\d\d-\d\d \d\d:\d\d UTC', sc[0]['text']) and 'data: scanner close of' in sc[0]['text'], 'every alert shows when it opened and which data it used')
        check('Information only' in txt or 'information only' in txt.lower(), 'the page says alerts are information only')
        btns = await pg.evaluate("[...document.querySelectorAll('#page-alerts button')].map((x) => x.innerText.trim())")
        check(not [x for x in btns if re.search(r'\b(buy|sell|order|execute|place|trade)\b', x, re.I)], f'no button places, suggests or changes an order: {btns}')
        fr = await pg.inner_text('#page-alerts section[aria-label="Data freshness"]')
        check('close of' in fr and 'Last checked' in fr and 'no email or text message' in fr, f'the freshness card gives the price time, the check time and the no-email promise: {fr[:300]}')
        check(await pg.evaluate("document.querySelector('#subnav button[data-page=alerts]').innerText.includes('(1)')"), 'the sub-navigation shows the number of open alerts')
        check(not errs, f'no page errors {errs[:2]}')
        hosts = {re.sub(r'^https?://([^/]+)/.*$', r'\1', u) for u in reqs}
        check(all(h_.startswith('127.0.0.1') or h_ == 'raw.githubusercontent.com' for h_ in hosts), f'nothing outside the site and its existing quotes file was requested: {hosts}')
        await pg.close()

        # ---- custom price alerts: add, validate, trigger, pause, delete
        pg, errs = await ac(ctx, base, fresh, {})
        await add_rule(pg, 'aapl', 'above', '$300')
        pr = await rows(pg, typ='price')
        check(len(pr) == 1 and 'AAPL is at or above your $300.00 level: $342.00 now.' in pr[0]['text'], f'an AAPL level below the price opens an alert with the price that crossed it: {pr}')
        check('data: close of' in pr[0]['text'], 'the price alert states the close it used')
        await add_rule(pg, 'AAPL', 'below', '100')
        tr = await pg.evaluate("[...document.querySelectorAll('#page-alerts tr[data-rule]')].map((r) => r.innerText.replace(/\\s+/g, ' ').trim())")
        check(len(tr) == 2 and 'Reached' in tr[0] and 'Waiting' in tr[1], f'the rules table shows Reached and Waiting: {tr}')
        check(len(await rows(pg, typ='price')) == 1, 'a level that is not crossed opens nothing')
        for (t, d, lv, why) in [('A B', 'above', '10', 'a ticker with a space'), ('AAPL', 'above', '0', 'a zero level'), ('AAPL', 'above', 'abc', 'text instead of a level'), ('<b>', 'above', '10', 'markup as a ticker'), ('ZZZZ', 'above', '10', 'a stock with no price in the data')]:
            before = len((await stored(pg))['rules'])
            await add_rule(pg, t, d, lv)
            after = len((await stored(pg))['rules'])
            msg = await pg.inner_text('.alert-form + .note') if await pg.is_visible('.alert-form + .note') else ''
            check(after == before and msg, f'{why} is refused with a message: {msg[:70]}')
        before = len((await stored(pg))['rules'])
        await add_rule(pg, 'AAPL', 'above', '300')
        check(len((await stored(pg))['rules']) == before, 'the same price alert twice is refused')
        await pg.click('tr[data-rule] >> nth=0 >> button[data-act=toggle]')
        await pg.wait_for_timeout(900)
        st = await pg.evaluate("[...document.querySelectorAll('#page-alerts tr[data-rule]')][0].innerText")
        check('Paused' in st and not await rows(pg, 'open', 'price') and len(await rows(pg, 'ended', 'price')) == 1, 'pausing a rule closes its alert and keeps it in the history')
        await pg.click('tr[data-rule] >> nth=0 >> button[data-act=toggle]')
        await pg.wait_for_timeout(900)
        check(len(await rows(pg, 'open', 'price')) == 1, 'resuming the rule re-opens the same alert (within a day, so quietly)')
        await pg.click('tr[data-rule] >> nth=1 >> button[data-act=remove]')
        await pg.wait_for_timeout(900)
        check(len((await stored(pg))['rules']) == 1, 'a rule can be deleted')
        check(not errs, f'no page errors {errs[:2]}')
        await pg.close()

        # ---- the same unchanged condition: one alert, one notification, however often it is checked or its numbers move
        nctx = await b.new_context(viewport={'width': 1280, 'height': 1000})
        await nctx.add_init_script(STUB)
        st0 = {'__perm': 'granted', **alerts_store([rule('r1', 'AAPL', 'above', 300)], notify=True)}
        pg, errs = await ac(nctx, base, fresh, st0)
        n1 = await notes(pg)
        check(sorted(n['tag'] for n in n1) == ['price:r1', 'scan:AAPL:pullback'], f'each new alert is announced once: {[n["tag"] for n in n1]}')
        pn = [n for n in n1 if n['tag'] == 'price:r1'][0]
        check(pn['title'] == 'Price alerts: AAPL' and 'close of' in pn['body'] and 'Information only: no order was placed.' in pn['body'], f'a notification names the kind, the stock, the data time and that it is information only: {pn}')
        for i in range(3):
            await reload(pg)
        check(len(await notes(pg)) == 2, 'reloading the page three times announces nothing again')
        s0 = await stored(pg)
        check(len([e for e in s0['hist'] if e['status'] == 'open']) == 2, 'and the history still holds two alerts, not more')

        async def with_price(px, wait=1700):
            await pg.close()
            sc = screen_with(fresh, {'AAPL': px})
            return await ac(nctx, base, fresh, None, extra={'data/screen.json': sc}, wait=wait)
        pg, errs = await with_price(345.0)
        pr = await rows(pg, typ='price')
        check(len(pr) == 1 and '$345.00 now' in pr[0]['text'], f'the number moved: the same alert shows the new price: {pr}')
        check(len(await notes(pg)) == 2, 'a moving number is not a new condition: no new notification')
        pg, errs = await with_price(298.0)
        pr = await rows(pg, 'open', 'price')
        check(len(pr) == 1 and '$298.00 now' in pr[0]['text'], 'inside the 1% band below the level the alert stays open (no flicker)')
        pg, errs = await with_price(296.0)
        check(len(await rows(pg, 'open', 'price')) == 0 and len(await rows(pg, 'ended', 'price')) == 1, 'more than 1% back through the level it ends, and stays in the history')
        pg, errs = await with_price(301.0)
        pr = await rows(pg, 'open', 'price')
        check(len(pr) == 1 and 'seen 2 times' in pr[0]['text'] and len(await notes(pg)) == 2, f'crossing again within a day re-opens the same alert without a second notification: {pr}')
        check(not errs, f'no page errors {errs[:2]}')
        await pg.close()

        # ---- turning notifications on: nothing already open is announced; later alerts are; turning them off stops them
        st1 = {'__perm': 'default', **alerts_store([rule('r1', 'AAPL', 'above', 300)], notify=False)}
        pg, errs = await ac(nctx, base, fresh, st1)
        txt = await pg.inner_text('#page-alerts section[aria-label="Notification settings"]')
        check(txt.startswith('Browser notifications') and 'Off.' in txt and len(await notes(pg)) == 0, f'notifications start off and announce nothing: {txt[:160]}')
        await pg.click('#notifyBtn')
        await pg.wait_for_timeout(1500)
        txt = await pg.inner_text('#page-alerts section[aria-label="Notification settings"]')
        check('On.' in txt and (await stored(pg))['set']['notify'] is True, 'the button turns them on')
        check(len(await notes(pg)) == 0, 'the alerts already open when they were switched on are not announced')
        await add_rule(pg, 'KO', 'above', '50')
        n = await notes(pg)
        check(len(n) == 1 and n[0]['title'] == 'Price alerts: KO', f'a new alert after that is announced exactly once: {n}')
        await pg.click('#notifyBtn')
        await pg.wait_for_timeout(1200)
        await add_rule(pg, 'MSFT', 'above', '100')
        check(len(await notes(pg)) == 1 and len(await rows(pg, 'open', 'price')) == 3, 'with notifications off the alert still appears, and nothing is announced')
        await pg.close()
        pg, errs = await ac(nctx, base, fresh, {'__perm': 'denied', **alerts_store([], notify=False)})
        txt = await pg.inner_text('#page-alerts section[aria-label="Notification settings"]')
        check('blocked' in txt and not await pg.is_visible('#notifyBtn'), 'a browser that has blocked notifications says so and offers no button')
        await pg.close()
        await nctx.close()
        uctx = await b.new_context(viewport={'width': 1280, 'height': 1000})
        await uctx.add_init_script(NO_NOTIFY)
        pg, errs = await ac(uctx, base, fresh, {})
        txt = await pg.inner_text('#page-alerts section[aria-label="Notification settings"]')
        check('does not support notifications' in txt and not await pg.is_visible('#notifyBtn') and len(await rows(pg, 'open')) == 1, 'a browser without notifications says so, and the alerts still show here')
        check(not errs, f'no page errors without the Notification API {errs[:2]}')
        await pg.close()
        await uctx.close()

        # ---- managing alerts: dismiss, restore, dismiss all, clear history, and a dismissed condition is not brought back
        pg, errs = await ac(ctx, base, fresh, alerts_store([rule('r1', 'AAPL', 'above', 300), rule('r2', 'KO', 'below', 100)]))
        check(len(await rows(pg, 'open')) == 3, 'two price alerts and the scanner setup are open')
        await pg.click('#page-alerts li[data-type=price] >> nth=0 >> button[data-act=dismiss]')
        await pg.wait_for_timeout(700)
        check(len(await rows(pg, 'open')) == 2 and len(await rows(pg, 'dismissed')) == 1, 'dismissing moves one alert to the history')
        check(await pg.evaluate("document.querySelector('#subnav button[data-page=alerts]').innerText.includes('(2)')"), 'the count in the sub-navigation follows')
        await reload(pg)
        check(len(await rows(pg, 'open')) == 2 and len(await rows(pg, 'dismissed')) == 1, 'a dismissed alert stays dismissed after a reload')
        await pg.click('#page-alerts li[data-state=dismissed] button[data-act=restore]')
        await pg.wait_for_timeout(700)
        check(len(await rows(pg, 'open')) == 3 and not await rows(pg, 'dismissed'), 'restore brings it back')
        await pg.click('#dismissAll')
        await pg.wait_for_timeout(700)
        check(not await rows(pg, 'open') and len(await rows(pg, 'dismissed')) == 3, 'dismiss all clears the open list')
        await pg.click('#clearHist')
        await pg.wait_for_timeout(700)
        await reload(pg)
        check(not await rows(pg, 'open') and len(await rows(pg, 'dismissed')) == 3, 'clearing the history does not bring a still-true condition back')
        check(not await pg.query_selector('#page-alerts li[data-state=dismissed] button[data-act=delete]'), 'an alert whose condition is still true cannot be deleted')
        await pg.click('tr[data-rule] >> nth=0 >> button[data-act=remove]')
        await pg.wait_for_timeout(1000)
        check(len(await rows(pg, 'ended')) == 1, 'when a condition ends, its alert is kept as ended')
        await pg.click('#page-alerts li[data-state=ended] button[data-act=delete]')
        await pg.wait_for_timeout(700)
        check(not await rows(pg, 'ended'), 'an ended alert can be deleted')
        # the kinds
        await pg.click('input[data-kind=scanner]')
        await pg.wait_for_timeout(1000)
        s1 = await stored(pg)
        check(s1['set']['types']['scanner'] is False and not await rows(pg, 'open', 'scanner'), 'switching a kind off closes its open alerts and stores the choice')
        await reload(pg)
        check(not await pg.is_checked('input[data-kind=scanner]') and await pg.is_checked('input[data-kind=price]'), 'the choice survives a reload')
        await pg.close()

        # ---- portfolio risk and Shariah alerts reuse the Watchlist, Journal and Shariah ledger rules
        held = {'watch': {'v': 1, 'items': [
            {'t': 'KO', 'added': '2026-01-01', 'shares': 10, 'cost': 50, 'swing': True, 'stop': 95, 't1': 120},
            {'t': 'MSFT', 'added': '2026-01-01', 'shares': 5, 'cost': 400}], 'snap': None, 'prev': None},
            'journal': {'v': 1, 'backup': None, 'trades': [
                {'t': 'AAPL', 'setup': 'pullback', 'opened': '2026-10-01', 'entry': 350, 'shares': 5, 'stop': 345, 'target': 400, 'fees': 0, 'closed': False},
                {'t': 'MSFT', 'setup': 'pullback', 'opened': '2026-10-01', 'entry': 540, 'shares': 5, 'stop': 560, 'target': 600, 'fees': 0, 'closed': False, 'paper': True}]}}
        sc = screen_with(fresh, None, {'MSFT': 'fail'})
        pg, errs = await ac(ctx, base, fresh, held, zoya=['KO'], extra={'data/screen.json': sc})
        rk = await rows(pg, 'open', 'risk')
        texts = ' | '.join(r['text'] for r in rk)
        check(any('KO' in r['text'] and 'At or below your stop ($95.00): the plan says sell.' in r['text'] for r in rk), f'a held swing stock at its stop is a risk alert, worded as on the Watchlist: {texts[:300]}')
        check(any('AAPL' in r['text'] and 'At or below your stop ($345.00)' in r['text'] and 'open trade in your Journal' in r['text'] for r in rk), 'an open real Journal trade at its stop is a risk alert')
        check(not any('MSFT' in r['text'] and '560' in r['text'] for r in rk), 'a paper trade in the Journal is not a portfolio risk')
        check(not any('Fails the Shariah' in r['text'] for r in rk), 'a Shariah failure is never listed twice: it is not a risk alert')
        sh = await rows(pg, 'open', 'shariah')
        check(any(r['key'] == 'shariah:MSFT:fail' and 'Fails the Shariah screen now' in r['text'] and 'screen of' in r['text'] for r in sh), f'a held stock that fails the nightly screen is a Shariah alert: {[r["text"][:90] for r in sh]}')
        check(any('ledger' in r['key'] and 'MSFT' in r['text'] for r in sh), 'a held stock with no current Zoya check in the ledger is a Shariah alert')
        check(not any('ledger' in r['key'] and r['text'].startswith('KO') for r in sh), 'a stock with a current Zoya check is not')
        check(not errs, f'no page errors {errs[:2]}')
        # the Dashboard shows the same facts
        await pg.goto(base + '?selftest=1&p=dashboard')
        await pg.wait_for_timeout(1500)
        dt_ = await pg.inner_text('#page-dashboard section[aria-label="System alerts"]')
        check('Alert Centre' in dt_ and 'open alert' in dt_, 'the Dashboard summarises the open alerts and links to the Alert Centre')
        await pg.close()

        # ---- late or missing data pauses a kind and never closes what is open
        stale_day = weekday_back(5)
        seed = alerts_store([rule('r1', 'AAPL', 'above', 300)], hist=[entry('price:r1', 'price', 'AAPL', 'AAPL is at or above your $300.00 level: $342.00 now.'), entry('scan:AAPL:pullback', 'scanner', 'AAPL', 'Pullback: entry set for next session above $50.50.')])
        seed['watch'] = {'v': 1, 'items': [{'t': 'MSFT', 'added': '2026-01-01'}], 'snap': None, 'prev': None}
        pg, errs = await ac(ctx, base, stale_day, seed, extra={'data/screen.json': screen_with(stale_day, None, {'MSFT': 'fail'})}, scanner=scanner_file(stale_day))
        fr = await pg.inner_text('#page-alerts section[aria-label="Data freshness"]')
        check('late' in fr.lower() and 'paused' in fr.lower(), f'late nightly data is stated: {fr[:260]}')
        op = await rows(pg, 'open')
        check({r['type'] for r in op} >= {'price', 'scanner'} and not await rows(pg, 'ended'), f'open price and scanner alerts stay open while the data is late: {[r["key"] for r in op]}')
        check(any(r['key'] == 'shariah:MSFT:fail' for r in op), 'Shariah alerts are still checked when prices are late')
        tr = await pg.inner_text('tr[data-rule]')
        check('Paused: data late' in tr, f'the rule says why it is not checked: {tr[:120]}')
        check(len([n for n in (await stored(pg))['hist'] if n['type'] == 'price']) == 1, 'no price alert was added or closed')
        await pg.close()
        pg, errs = await ac(ctx, base, fresh, seed, scanner=None)
        fr = await pg.inner_text('#page-alerts section[aria-label="Data freshness"]')
        check('could not be loaded' in fr, f'a missing scanner file is stated: {fr[:260]}')
        check(len(await rows(pg, 'open', 'scanner')) == 1 and len(await rows(pg, 'open', 'price')) == 1, 'the open scanner alert is not closed because its file did not load')
        await pg.close()
        pg, errs = await ac(ctx, base, fresh, seed, scanner=scanner_file(weekday_back(4)))
        fr = await pg.inner_text('#page-alerts section[aria-label="Data freshness"]')
        check('paused' in fr.lower() and len(await rows(pg, 'open', 'scanner')) == 1, 'a scanner file that is two or more sessions late pauses scanner alerts and leaves the open one')
        await pg.close()

        # ---- timestamps: delayed live price with its New York time, and your own price with its date
        quotes = {'session': fresh, 'time': '10:32 AM ET', 'status': 'Market Open', 'q': {'AAPL': [350.0, 0.01, 340.0]}}
        pg, errs = await ac(ctx, base, fresh, alerts_store([rule('r1', 'AAPL', 'above', 345)]), extra={'quotes.json': quotes})
        pr = await rows(pg, 'open', 'price')
        check(len(pr) == 1 and '$350.00 now' in pr[0]['text'] and 'delayed last sale, 10:32 am New York' in pr[0]['text'], f'a live price alert shows the delayed last sale and its time: {pr}')
        await pg.close()
        own = {'watch': {'v': 1, 'items': [{'t': 'ZZZZ', 'added': '2026-11-01', 'addPx': None, 'manual': True, 'px': 50, 'pxDate': TODAY}], 'snap': None, 'prev': None}}
        pg, errs = await ac(ctx, base, fresh, {**own, **alerts_store([rule('r1', 'ZZZZ', 'below', 60)])})
        pr = await rows(pg, 'open', 'price')
        check(len(pr) == 1 and '$50.00 now' in pr[0]['text'] and 'your own price from' in pr[0]['text'], f'a price you entered yourself is labelled as yours, with its date: {pr}')
        await pg.close()

        # ---- damaged storage, and a narrow phone screen
        pg, errs = await ac(ctx, base, fresh, {'alerts': 'junk'})
        check(not errs and (await pg.inner_text('#page-alerts h1')) == 'Alert Centre', f'unreadable saved alerts are ignored, not an error {errs[:2]}')
        await pg.close()
        for theme in ['light', 'dark']:
            mctx = await b.new_context(viewport={'width': 390, 'height': 844}, color_scheme=theme)
            pg, errs = await ac(mctx, base, fresh, {**held, **alerts_store([rule('r1', 'AAPL', 'above', 300), rule('r2', 'KO', 'below', 100)])}, zoya=['KO'])
            ov = await pg.evaluate('document.documentElement.scrollWidth - document.documentElement.clientWidth')
            check(ov <= 0 and not errs, f'390px {theme}: the Alert Centre with alerts, rules and history has no sideways scroll {errs[:2]}')
            await pg.close()
            await mctx.close()
        await b.close()
    httpd.shutdown()
    shutil.rmtree(tmp, ignore_errors=True)
    print(f'\n{len(failures)} failed' if failures else '\nall Alert Centre page tests passed')
    sys.exit(1 if failures else 0)

asyncio.run(main())
