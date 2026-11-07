# Page tests for stage 9 (professional redesign): navigation, sub-navigation and layout at phone, tablet and desktop widths in
# the light and dark themes. Reuses the fixture-serving helpers of test/scanner-page.test.py (everything before its main()).
# Run: python3 test/layout-page.test.py   (needs Python Playwright with Chromium; serves the page locally, no network)
import asyncio, os, re, shutil, sys

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


ALL = ['stock', 'shortlist', 'scanner', 'watchlist', 'record', 'journal', 'advisor', 'shariah', 'thesis', 'pfledger']
TABS = [('stock', 'Search'), ('shortlist', 'Shortlist'), ('watchlist', 'Watchlist'), ('record', 'Record'), ('journal', 'Journal'), ('advisor', 'Portfolio')]
PARENT = {'scanner': 'shortlist', 'shariah': 'advisor', 'thesis': 'advisor', 'pfledger': 'advisor'}
GROUPS = {
    'shortlist': ['shortlist', 'scanner'],
    'advisor': ['advisor', 'pfledger', 'thesis', 'shariah'],
}
SIZES = [(390, 844), (820, 1100), (1280, 900)]


async def main():
    httpd, tmp = serve()
    base = f'http://127.0.0.1:{httpd.server_address[1]}/'
    fresh = weekday_back(1)
    async with async_playwright() as p:
        b = await p.chromium.launch()
        ctx = await b.new_context(viewport={'width': 1280, 'height': 900})

        # ---- the top-level tabs and every address
        pg, errs = await page_with(ctx, base, fresh)
        tabs = await pg.evaluate("[...document.querySelectorAll('#nav button')].map((x) => [x.dataset.page, x.innerText.trim()])")
        check(tabs == [list(t) for t in TABS], f'the tabs are Search, Shortlist, Watchlist, Record, Journal, Portfolio with their data-page ids unchanged: {tabs}')
        await pg.close()
        for name in ALL:
            pg, errs = await page_with(ctx, base, fresh, path='' if name == 'stock' else '&p=' + name)
            vis = await pg.evaluate("(ids) => ids.filter((k) => { const e = document.getElementById('page-' + k); return e && !e.hidden; })", ALL)
            check(vis == [name], f'?p={name} shows only page-{name}: {vis}')
            cur = await pg.evaluate("[...document.querySelectorAll('#nav button[aria-current=\"page\"]')].map((x) => x.dataset.page)")
            check(cur == [PARENT.get(name, name)], f'?p={name} highlights the {PARENT.get(name, name)} tab: {cur}')
            check(not errs, f'no page errors on ?p={name} {errs[:2]}')
            await pg.close()

        # ---- sub-navigation: shown for the two groups, hidden elsewhere, links every page of the group
        for name in ALL:
            pg, errs = await page_with(ctx, base, fresh, path='' if name == 'stock' else '&p=' + name)
            group = PARENT.get(name, name)
            items = await pg.evaluate("[...document.querySelectorAll('#subnav button')].map((x) => [x.dataset.page, x.getAttribute('aria-current')])")
            hidden = await pg.evaluate("document.getElementById('subnav').hidden")
            if group in GROUPS:
                check(not hidden and [i[0] for i in items] == GROUPS[group], f'?p={name}: the sub-navigation lists {GROUPS[group]}: {items}')
                check([i[0] for i in items if i[1] == 'page'] == [name], f'?p={name}: the current page is marked in the sub-navigation')
            else:
                check(hidden and not items, f'?p={name}: no sub-navigation on a page with no group')
            await pg.close()
        for group, members in GROUPS.items():
            pg, errs = await page_with(ctx, base, fresh, path='&p=' + group)
            for m in members[1:]:
                await pg.click(f'#subnav button[data-page="{m}"]')
                check(await pg.evaluate('location.search') == '?selftest=1&p=' + m or (await pg.evaluate('location.search')).endswith('p=' + m), f'sub-navigation to {m} updates the address')
                check(await pg.evaluate(f"!document.getElementById('page-{m}').hidden"), f'sub-navigation opens page-{m}')
                check(await pg.evaluate(f"document.querySelector('#nav button[aria-current=page]').dataset.page") == group, f'{m} keeps the {group} tab highlighted')
            await pg.go_back()
            check(not errs, f'no page errors using the {group} sub-navigation {errs[:2]}')
            await pg.close()

        # ---- tab bar: docked at the bottom on phones and tablets, in the header on desktop, never covering the content
        await ctx.close()
        for theme in ['light', 'dark']:
            for (w, h) in SIZES:
                ctx = await b.new_context(viewport={'width': w, 'height': h}, color_scheme=theme)
                pg, errs = await page_with(ctx, base, fresh, path='&p=shortlist')
                box = await pg.evaluate("(() => { const n = document.getElementById('nav'); const r = n.getBoundingClientRect(); const cs = getComputedStyle(n); return { pos: cs.position, top: r.top, bottom: r.bottom, left: r.left, right: r.right, vh: innerHeight, vw: innerWidth }; })()")
                if w < 1024:
                    check(box['pos'] == 'fixed' and abs(box['bottom'] - box['vh']) < 1 and box['left'] == 0 and abs(box['right'] - box['vw']) < 1, f'{w}px {theme}: the tab bar is docked to the bottom edge, full width: {box}')
                    await pg.evaluate('window.scrollTo(0, document.documentElement.scrollHeight)')
                    foot = await pg.evaluate("(() => { const f = document.querySelector('footer'); return f.getBoundingClientRect().bottom - parseFloat(getComputedStyle(f).paddingBottom); })()")
                    nav_top = await pg.evaluate("document.getElementById('nav').getBoundingClientRect().top")
                    check(foot <= nav_top + 1, f'{w}px {theme}: the end of the page sits above the tab bar (end of footer text {foot:.0f}, bar top {nav_top:.0f})')
                    small = await pg.evaluate("[...document.querySelectorAll('#nav button')].filter((x) => { const r = x.getBoundingClientRect(); return r.height < 44 || r.width < 44; }).length")
                    check(small == 0, f'{w}px {theme}: every tab is at least 44px each way')
                else:
                    check(box['pos'] != 'fixed' and box['top'] < 100, f'{w}px {theme}: the tabs sit in the header: {box}')
                # ---- no sideways scroll and nothing wider than the screen, on every page
                for name in ALL:
                    await pg.goto(base + '?selftest=1' + ('' if name == 'stock' else '&p=' + name))
                    await pg.wait_for_timeout(250)
                    ov = await pg.evaluate('document.documentElement.scrollWidth - document.documentElement.clientWidth')
                    check(ov <= 0, f'{w}px {theme} ?p={name}: no horizontal scroll (overflow {ov})')
                check(not errs, f'{w}px {theme}: no page errors {errs[:2]}')
                await pg.close()
                await ctx.close()
        await b.close()
    httpd.shutdown()
    shutil.rmtree(tmp, ignore_errors=True)
    print(f'\n{len(failures)} failed' if failures else '\nall layout page tests passed')
    sys.exit(1 if failures else 0)

asyncio.run(main())
