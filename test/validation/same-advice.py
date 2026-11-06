# Release check (VALIDATION.md, section 18): the same data shown by two versions of the page, every page and every
# section compared sentence by sentence. A record-and-display release must leave every recommendation, buy zone, sell
# or trim call, position size, valuation and risk-limit message exactly as it was.
# Allowed: any change inside the cards of the evaluation itself (CHANGES_ALLOWED_IN), and the sentences listed in
# ADDED_SENTENCES. Anything else is printed as UNEXPECTED and the check fails.
# Run: python3 test/validation/same-advice.py <old index.html> [new index.html, default ./index.html]
# (old: git show origin/main:index.html > /tmp/old.html)
import asyncio, datetime as dt, http.server, json, os, re, sys, tempfile, threading
from playwright.async_api import async_playwright

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
FIX = os.path.join(ROOT, 'test', 'fixtures')
CHANGES_ALLOWED_IN = {'The permanent record', 'Long-term list test', 'Limits of the test'}
ADDED_SENTENCES = {'The periods overlap: together they hold about two independent five-year spans, and companies that disappeared since 2016 are missing.'}


def serve(path):
    d = tempfile.mkdtemp()
    html = open(path, encoding='utf-8').read()
    assert "const MODE = 'server'; /*BUILD:MODE*/" in html
    open(os.path.join(d, 'index.html'), 'w', encoding='utf-8').write(html.replace("const MODE = 'server'; /*BUILD:MODE*/", "const MODE = 'static';"))

    class Quiet(http.server.SimpleHTTPRequestHandler):
        def log_message(self, *a):
            pass
    httpd = http.server.ThreadingHTTPServer(('127.0.0.1', 0), lambda *a, **k: Quiet(*a, directory=d, **k))
    threading.Thread(target=httpd.serve_forever, daemon=True).start()
    return f'http://127.0.0.1:{httpd.server_address[1]}/'


def weekday_back(n):
    d = dt.date.today()
    while n > 0:
        d -= dt.timedelta(days=1)
        if d.weekday() < 5:
            n -= 1
    return d.isoformat()


FRESH = weekday_back(1)
LOAD = lambda f: json.load(open(os.path.join(FIX, f)))


def with_events(scr):
    # filings of the last days and KO turned into a long-term buy idea (as in test/page.test.py)
    scr['fields'] = scr['fields'] + ['ev', 'dq']
    evs = {'AAPL': [f'{FRESH}|8-K|4.02'], 'MSFT': [f'{FRESH}|8-K|2.02'], 'KO': []}
    vi = scr['fields'].index('verdict')
    for row in scr['rows']:
        row.extend([evs.get(row[0], []), 'high'])
        if row[0] == 'KO':
            row[vi] = 'BUY'
            row[scr['fields'].index('trimAbove')] = 120


def add_rows(scr):
    # NVDA in an already full sector, KO a buy with a trim price, MSFT under halal review (as in test/page.test.py)
    F = {k: i for i, k in enumerate(scr['fields'])}
    nv = list(scr['rows'][0])
    for k, v in {'ticker': 'NVDA', 'name': 'Nvidia', 'sector': 'Technology', 'verdict': 'BUY', 'shariah': 'pass', 'quality': 90, 'growth': 80, 'health': 80, 'price': 100, 'buyBelow': 120, 'trimAbove': 300, 'upside': 0.3, 'fair': 140, 'trend': 'up'}.items():
        nv[F[k]] = v
    scr['rows'].append(nv)
    for r in scr['rows']:
        if r[F['ticker']] == 'KO':
            r[F['verdict']] = 'BUY'
            r[F['trimAbove']] = 120
        if r[F['ticker']] == 'MSFT':
            r[F['shariah']] = 'review'


def both(scr):
    with_events(scr)
    add_rows(scr)


PROF_TEST = {'horizon': 'long', 'drop': 'hold', 'time': 'mid', 'focus': 'test', 'hold': 'auto', 'swing': 'no', 'broker': 'tiered', 'monthlyAed': 1000}
PROF_SWING = {'horizon': 'long', 'drop': 'hold', 'time': 'mid', 'focus': 'half', 'hold': 'auto', 'swing': 'yes', 'broker': 'tiered', 'monthlyAed': 1000}
OWN = {'watch': {'v': 1, 'items': [{'t': 'AAPL', 'added': '2026-01-01', 'shares': 2, 'cost': 150}, {'t': 'MSFT', 'added': '2026-02-01', 'shares': 1, 'cost': 650}, {'t': 'KO', 'added': '2026-02-01', 'shares': 0}], 'snap': None, 'prev': None}}
TRADES = {'v': 1, 'trades': [{'id': 'j1', 't': 'KO', 'setup': 'pullback', 'entry': 58, 'shares': 10, 'stop': 55, 'fees': 1, 'opened': '2026-10-01'},
                             {'id': 'j2', 't': 'AAPL', 'setup': 'longterm', 'entry': 140, 'shares': 3, 'fees': 1, 'opened': '2026-09-01', 'closed': '2026-10-20', 'exit': 150, 'exitFees': 1}], 'backup': None}


def techy(prof):
    return {'watch': {'v': 1, 'items': [{'t': 'AAPL', 'added': '2026-01-01', 'shares': 2, 'cost': 150}, {'t': 'MSFT', 'added': '2026-01-01', 'shares': 1, 'cost': 300}, {'t': 'KO', 'added': '2026-03-01'}], 'snap': None, 'prev': None},
            'advisor': {'v': 1, 'profile': prof, 'hp': {}, 'other': [{'id': 'o1', 'sym': 'ISDW', 'kind': 'fund', 'market': '', 'shares': None, 'value': 5000}]}, 'journal': TRADES}


def record_fixture():
    # the record summary the page tests use: one kind passing, one under review, one too short, early reads
    src = open(os.path.join(ROOT, 'test', 'page.test.py'), encoding='utf-8').read()
    m = re.search(r"        rec_summary = (\{.*?\})\n        pg, errs", src, re.S)
    return eval(m.group(1), {'True': True, 'False': False, 'None': None})


# the data-health report (data/health.json) of a bad night, for the display-only warning banner (deployment safety release)
def _hc(i, st, label, text):
    return {'id': i, 'status': st, 'label': label, 'text': text}


def health_report(bad_id, price_date):
    checks = [_hc('coverage', 'ok', 'Companies analysed', '1,990 of 2,000 (99.5%).'), _hc('history', 'ok', 'Price history', '1,900 companies with a full price history.'),
              _hc('earnings', 'warn', 'Earnings dates', '1 day of the calendar could not be read.'), _hc('record', 'ok', 'Permanent record', '3 days recorded, every file intact.')]
    if bad_id:
        checks = [_hc(bad_id, 'bad', bad_id.title(), 'This check failed tonight.') if c['id'] == bad_id else c for c in checks]
    return {'version': 1, 'builtAt': '2026-11-04T03:30:00Z', 'priceDate': price_date, 'commit': 'abc1234def', 'worst': 'bad' if bad_id else 'warn', 'checks': checks}


# (name, price date, storage, patch of the screen, stock fixture for KO)
SCENARIOS = [
    ('holdings and filings, fresh data', FRESH, OWN, with_events, 'stock-ok'),
    ('profile with limits, fresh data', FRESH, techy(PROF_TEST), both, 'stock-ok'),
    ('half in stocks with swing trades, fresh data', FRESH, techy(PROF_SWING), add_rows, 'stock-ok'),
    ('late data (advice paused)', weekday_back(6), techy(PROF_TEST), both, 'stock-ok'),
    ('unreliable company data', FRESH, techy(PROF_SWING), with_events, 'stock-unreliable'),
    # the same advice on a night when the data health is bad: only the warning banner may differ, never the advice itself
    ('bad data health: price history missing, fresh prices', FRESH, techy(PROF_SWING), both, 'stock-ok', health_report('history', FRESH)),
    ('bad data health: companies missing, holdings', FRESH, OWN, with_events, 'stock-ok', health_report('coverage', FRESH)),
    ('bad data health and late prices', weekday_back(6), techy(PROF_TEST), both, 'stock-ok', health_report('history', weekday_back(6))),
    ('data health only warnings', FRESH, techy(PROF_TEST), both, 'stock-ok', health_report(None, FRESH)),
]
PAGES = ['stock', 'shortlist', 'watchlist', 'record', 'journal', 'advisor']


async def grab(ctx, base, price_date, storage, patch, stock, page, health=None):
    scr = LOAD('screen.json')
    idx = LOAD('index.json')
    scr['priceDate'] = idx['priceDate'] = price_date
    if patch:
        patch(scr)
    data = {'data/screen.json': scr, 'data/index.json': idx, 'data/backtest-summary.json': LOAD('backtest-summary.json'), 'data/lt-summary.json': LOAD('lt-summary.json'),
            'data/record-summary.json': record_fixture(), 'data/KO.json': LOAD(stock + '.json'), 'data/tech/KO.json': LOAD('tech-ok.json')}
    if health:
        data['data/health.json'] = health
    pg = await ctx.new_page()
    errs = []
    pg.on('pageerror', lambda e: errs.append(str(e)))

    async def route(r):
        u = r.request.url.split('?')[0]
        for k, v in data.items():
            if u.endswith(k):
                await r.fulfill(status=200, body=json.dumps(v), headers={'content-type': 'application/json'})
                return
        await r.fulfill(status=404, body='')
    await pg.route(re.compile(r'.*(/data/|quotes\.json).*'), route)
    await pg.goto(base + '?selftest=1')
    await pg.evaluate('(s) => { localStorage.clear(); for (const [k, v] of Object.entries(s)) localStorage.setItem(k, JSON.stringify(v)); }', storage)
    await pg.goto(base + '?selftest=1' + ('&t=KO' if page == 'stock' else ''))
    await pg.wait_for_timeout(1800)
    if page != 'stock':
        await pg.click(f'#nav button[data-page="{page}"]')
        await pg.wait_for_timeout(1800)
    box = '#page-stock' if page == 'stock' else f'#page-{page}'
    secs = await pg.evaluate("""(box) => { const root = document.querySelector(box); const seen = {};
      const all = [...root.querySelectorAll('section')].filter((s) => s.offsetParent !== null && !s.parentElement.closest(box + ' section'));
      const out = all.map((s) => { let k = s.getAttribute('aria-label') || (s.querySelector('h2,h3') || {}).textContent || s.className || '(no label)';
        seen[k] = (seen[k] || 0) + 1; if (seen[k] > 1) k += ' #' + seen[k]; return { label: k, text: s.innerText }; });
      return { full: root.innerText, secs: out }; }""", box)
    secs['banner'] = await pg.evaluate("() => { const b = document.getElementById('healthBanner'); return b && !b.hidden ? b.innerText : ''; }")
    await pg.close()
    return secs, errs


def sentences(text):
    out = []
    for line in text.split('\n'):
        out += [s.strip() for s in re.split(r'(?<=[.!?])\s+(?=[A-Z(])', line) if s.strip()]
    return out


async def main():
    old = serve(sys.argv[1])
    new = serve(sys.argv[2] if len(sys.argv) > 2 else os.path.join(ROOT, 'index.html'))
    bad = []
    explained = []
    totals = {'pages': 0, 'identical': 0, 'sections': 0, 'chars': 0}
    async with async_playwright() as p:
        b = await p.chromium.launch()
        ctx = await b.new_context()
        for sc in SCENARIOS:
            name, date, storage, patch, stock = sc[:5]
            health = sc[5] if len(sc) > 5 else None
            print(f'== {name} (prices of {date}, KO from {stock})')
            for page in PAGES:
                (A, ea), (B, eb) = await grab(ctx, old, date, storage, patch, stock, page, health), await grab(ctx, new, date, storage, patch, stock, page, health)
                totals['pages'] += 1
                # the warning banner is the one thing allowed to differ, and only on a night with a failed ('bad') check
                want_banner = bool(health) and health['worst'] == 'bad' and page != 'record'
                if A['banner']:
                    bad.append(f'{name} / {page}: the old page already shows a banner?')
                if bool(B['banner']) != want_banner:
                    bad.append(f'{name} / {page}: banner shown={bool(B["banner"])}, expected {want_banner}')
                totals['banners'] = totals.get('banners', 0) + (1 if B['banner'] else 0)
                totals['sections'] += len(B['secs'])
                totals['chars'] += len(B['full'])
                if ea or eb:
                    bad.append(f'{name} / {page}: page errors {ea} {eb}')
                if A['full'] == B['full']:
                    totals['identical'] += 1
                    print(f'  {page}: identical ({len(B["secs"])} sections, {len(B["full"])} characters)')
                    continue
                a = {s['label']: s['text'] for s in A['secs']}
                bsec = {s['label']: s['text'] for s in B['secs']}
                labels = sorted(set(a) | set(bsec), key=lambda k: ([s['label'] for s in B['secs']] + list(a)).index(k))
                changed = [k for k in labels if a.get(k) != bsec.get(k)]
                print(f'  {page}: {len(changed)} of {len(labels)} sections differ: {changed}')
                for k in changed:
                    sa, sb = sentences(a.get(k, '')), sentences(bsec.get(k, ''))
                    gone = [s for s in sa if s not in sb]
                    added = [s for s in sb if s not in sa]
                    allowed = k in CHANGES_ALLOWED_IN
                    for s in gone:
                        print(f'      - {s[:300]}')
                        if not allowed:
                            bad.append(f'{name} / {page} / {k}: removed: {s}')
                    for s in added:
                        print(f'      + {s[:300]}')
                        if not allowed and s not in ADDED_SENTENCES:
                            bad.append(f'{name} / {page} / {k}: added: {s}')
                    # exact: with the listed sentences taken out again, the new text must be the old text, character for character
                    stripped = bsec.get(k, '')
                    for s in ADDED_SENTENCES:
                        stripped = stripped.replace(' ' + s, '')
                    if not allowed and stripped != a.get(k, ''):
                        bad.append(f'{name} / {page} / {k}: not the old text once the listed sentences are taken out')
                    elif not allowed:
                        explained.append(f'{name} / {page} / {k}')
    print(f"\n{totals.get('banners', 0)} page views carried the warning banner (bad health nights only); every other word of every page, including each recommendation, buy zone, sell or trim call, position size, valuation and risk-limit message, was compared below")
    print(f"{totals['pages']} page views compared ({totals['sections']} sections, {totals['chars']:,} characters in the new version); {totals['identical']} identical word for word")
    print(f'{len(explained)} sections outside the evaluation cards differ only by the listed sentence(s), checked character for character: {explained}')
    print('UNEXPECTED differences:' if bad else 'No unexpected difference: outside the evaluation cards, the only change is the added sentence(s) listed in ADDED_SENTENCES.')
    for x in bad:
        print('  ' + x)
    sys.exit(1 if bad else 0)


asyncio.run(main())
