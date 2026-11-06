# Release check (VALIDATION.md, section 18): the same data shown by two versions of the page, every page and every
# section compared sentence by sentence. A record-and-display release must leave every recommendation, buy zone, sell
# or trim call, position size, valuation and risk-limit message exactly as it was.
# Allowed: any change inside the cards of the evaluation itself (CHANGES_ALLOWED_IN), and the sentences listed in
# ADDED_SENTENCES, and whole new sections that carry no advice (ADDED_SECTIONS). Anything else is printed as UNEXPECTED and the check fails.
# Run: python3 test/validation/same-advice.py <old index.html> [new index.html, default ./index.html] [--ledger=current|empty]
# (old: git show origin/main:index.html > /tmp/old.html)
# The new page has a Shariah gate on new buys (stage 4), so it is run in two ledger states:
#   --ledger=current (default): every ticker has a current Zoya check that says compliant. The gate passes everything, so the new page must say
#       exactly what the old one said: only the purification sentences and the new ledger card may differ.
#   --ledger=empty: no ledger at all. Buy suggestions are held back and say why. Every added sentence must be about the ledger or purification,
#       and the number of sell, trim and take-profit calls on every page must be exactly the old number: the gate never sells.
import asyncio, datetime as dt, http.server, json, os, re, sys, tempfile, threading
from playwright.async_api import async_playwright

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
FIX = os.path.join(ROOT, 'test', 'fixtures')
CHANGES_ALLOWED_IN = {'The permanent record', 'Long-term list test', 'Limits of the test'}
# A whole section that exists only in the new version and carries no advice (stage 4: the Shariah ledger summary card; stage 5: the thesis cards on
# the Portfolio and company pages, which only record and explain the calls shown elsewhere; stage 6: the portfolio ledger summary card on the
# Portfolio page, which only reports what you recorded and how it sits against your own limits).
# It is allowed only as an addition: a section of the same name in the old version would be compared like any other.
ADDED_SECTIONS = {'Shariah ledger', 'Thesis and decisions', 'Your thesis', 'Portfolio ledger'}
# Stage 4 (decision of 6 November): purification is switched off. Sentences about purification, and the sentences that point to the ledger instead,
# may be removed or added; the rest of the section must be the old text, in the same order. Nothing here is about a buy, a sell, a size or a limit.
PUR_RE = re.compile(r'(?i)purif|impure|dividend income|calculator|^It pays no cash dividend\.$|^Record what Zoya shows for each stock in the Shariah ledger|^Open the Shariah ledger$|^The Shariah ledger can keep a record of an amount you were given\.$|^Off$|^pending a scholar-approved method$')
PUR_STAT = re.compile(r'(?i)Purification\n[^\n]*\n[^\n]*')
# an added sentence that only the empty-ledger run may contain: about the ledger or the record of a Zoya check
LEDGER_RE = re.compile(r'(?i)ledger|Zoya check|^Blocked: |no record|not from Zoya|questionable on Zoya|not compliant on Zoya|^Holding and selling are not affected\.$|^Until then it stays as cash')
SALE_RE = re.compile(r'\b(Sell|Trim|Take profit|sell about|Sell about)\b')
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


SEED = r"""(ts) => { if (!(window.__sc && window.__sc.shariah)) return false; const S = window.__sc.shariah; const p = (n) => String(n).padStart(2, '0'); const d = new Date(); d.setDate(d.getDate() - 3);
  const checked = `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`; const t0 = new Date(); const today = `${t0.getFullYear()}-${p(t0.getMonth() + 1)}-${p(t0.getDate())}`;
  let e = []; for (const t of ts) e = S.appendEntry(e, { kind: 'check', t, status: 'compliant', checked, source: 'zoya_app', evidence: 'validation fixture: a Zoya screen' }, today, new Date().toISOString()).entries;
  localStorage.setItem('shariah', JSON.stringify({ v: 1, entries: e })); localStorage.setItem('shariah_anchor', JSON.stringify(S.anchorOf(e))); return true; }"""


async def grab(ctx, base, price_date, storage, patch, stock, page, health=None, ledger=None):
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
    if ledger == 'current':
        await pg.evaluate(SEED, [r[0] for r in scr['rows']])  # only the new page has the ledger; on the old page this does nothing
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
    args = [a for a in sys.argv[1:] if not a.startswith('--')]
    mode = next((a.split('=', 1)[1] for a in sys.argv[1:] if a.startswith('--ledger=')), 'current')
    assert mode in ('current', 'empty'), 'use --ledger=current or --ledger=empty'
    print(f'Ledger state for the new page: {mode}')
    old = serve(args[0])
    new = serve(args[1] if len(args) > 1 else os.path.join(ROOT, 'index.html'))
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
                (A, ea), (B, eb) = await grab(ctx, old, date, storage, patch, stock, page, health, mode), await grab(ctx, new, date, storage, patch, stock, page, health, mode)
                # the purification figure on the Watchlist (a label, a value, a line under it) is switched off: it is compared as one unit
                for X in (A, B):
                    X['full'] = PUR_STAT.sub('Purification: (figure)', X['full'])
                    for sec in X['secs']:
                        sec['text'] = PUR_STAT.sub('Purification: (figure)', sec['text'])
                totals['pages'] += 1
                # the warning banner is the one thing allowed to differ, and only on a night with a failed ('bad') check
                want_banner = bool(health) and health['worst'] == 'bad' and page != 'record'
                # the baseline may already carry the banner (main has had it since the deployment-safety release): then the new
                # page must show exactly the same words. Against an older baseline without it, the line below still decides.
                if A['banner'] and A['banner'] != B['banner']:
                    bad.append(f'{name} / {page}: the banner words differ between the old and the new page')
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
                if mode == 'empty':
                    # the gate holds buys back; it must never add or remove a sale, a trim or a take-profit call
                    # only a section that the old page does not have is left out of the new count: one that both versions have (the Shariah
                    # ledger and the thesis cards, when the old page is a later one) is compared like any other
                    count = lambda secs, skip: sum(len(SALE_RE.findall(x['text'])) for x in secs if x['label'] not in skip)
                    new_only = {k for k in ADDED_SECTIONS if k not in a}
                    if count(A['secs'], ()) != count(B['secs'], new_only):
                        bad.append(f'{name} / {page}: the number of sell, trim or take-profit calls changed ({count(A["secs"], ())} -> {count(B["secs"], new_only)})')
                print(f'  {page}: {len(changed)} of {len(labels)} sections differ: {changed}')
                for k in changed:
                    sa, sb = sentences(a.get(k, '')), sentences(bsec.get(k, ''))
                    gone = [s for s in sa if s not in sb]
                    added = [s for s in sb if s not in sa]
                    allowed = k in CHANGES_ALLOWED_IN
                    ok_rm = lambda x: bool(PUR_RE.search(x))
                    ok_add = lambda x: x in ADDED_SENTENCES or bool(PUR_RE.search(x)) or (mode == 'empty' and bool(LEDGER_RE.search(x)))
                    if k in ADDED_SECTIONS and k not in a:
                        for s in sb:
                            print(f'      + {s[:300]}')
                        explained.append(f'{name} / {page} / {k} (new section)')
                        continue
                    for s in gone:
                        print(f'      - {s[:300]}')
                        # with the ledger empty, buy suggestions are held back, so buy sentences go; the sale count above is what must not move
                        if not allowed and not ok_rm(s) and mode == 'current':
                            bad.append(f'{name} / {page} / {k}: removed: {s}')
                    for s in added:
                        print(f'      + {s[:300]}')
                        if not allowed and not ok_add(s):
                            bad.append(f'{name} / {page} / {k}: added: {s}')
                    # exact (ledger current): with the allowed purification and ledger sentences taken out of both, the sections are the same, in the same order
                    if not allowed and mode == 'current':
                        if [x for x in sb if not ok_add(x)] != [x for x in sa if not ok_rm(x)]:
                            bad.append(f'{name} / {page} / {k}: not the old text once the allowed sentences are taken out')
                        else:
                            explained.append(f'{name} / {page} / {k}')
    print(f"\n{totals.get('banners', 0)} page views carried the warning banner (bad health nights only); every other word of every page, including each recommendation, buy zone, sell or trim call, position size, valuation and risk-limit message, was compared below")
    print(f"{totals['pages']} page views compared ({totals['sections']} sections, {totals['chars']:,} characters in the new version); {totals['identical']} identical word for word")
    print(f'{len(explained)} sections outside the evaluation cards differ only by the listed sentence(s), checked character for character: {explained}')
    print('UNEXPECTED differences:' if bad else ('No unexpected difference: outside the evaluation cards, the only changes are the purification sentences, the new ledger card and the listed added sentences.' if mode == 'current' else 'No unexpected difference: with the ledger empty, every added sentence is about the ledger or purification, and no sale, trim or take-profit call was added or removed.'))
    for x in bad:
        print('  ' + x)
    sys.exit(1 if bad else 0)


asyncio.run(main())
