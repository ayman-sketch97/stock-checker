# Page test: cloud backup. The copy is encrypted on the device before it leaves; a reinstall (empty storage) restores from the recovery key;
# an empty device never overwrites the copy; turning off deletes it. A stand-in Worker keeps the copies in memory (no network).
# Run: python3 test/cloud-page.test.py
import asyncio, json, os, re, sys
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


BASE_W = 'https://w.example.workers.dev'


async def mock_worker(ctx, db, log):
    async def route(r):
        req = r.request
        body = json.loads(req.post_data or '{}')
        path = req.url.replace(BASE_W, '')
        log.append((path, req.post_data or ''))
        hdr = {'content-type': 'application/json', 'access-control-allow-origin': '*', 'access-control-allow-headers': 'Content-Type'}
        if req.method == 'OPTIONS':
            await r.fulfill(status=204, headers=hdr); return
        i = body.get('id')
        if path == '/sync/put':
            db[i] = body['data']; await r.fulfill(status=200, body='{"ok":true}', headers=hdr)
        elif path == '/sync/get':
            if i in db: await r.fulfill(status=200, body=json.dumps({'data': db[i]}), headers=hdr)
            else: await r.fulfill(status=404, body='{"error":"none"}', headers=hdr)
        elif path == '/sync/delete':
            db.pop(i, None); await r.fulfill(status=200, body='{"ok":true}', headers=hdr)
        else:
            await r.fulfill(status=404, body='{}', headers=hdr)
    await ctx.route(BASE_W + '/**', route)


async def main():
    httpd, tmp = serve()
    base = f'http://127.0.0.1:{httpd.server_address[1]}/'
    fresh = weekday_back(1)
    async with async_playwright() as p:
        b = await p.chromium.launch(executable_path='/usr/bin/google-chrome', args=['--no-sandbox'])
        ctx = await b.new_context(viewport={'width': 1000, 'height': 1200})
        db, log = {}, []
        await mock_worker(ctx, db, log)
        seed = {'watch': {'v': 1, 'items': [{'t': 'AAPL', 'added': '2026-11-01', 'addPx': None, 'own': True}, {'t': 'NVDA', 'added': '2026-11-02', 'addPx': None}], 'snap': None, 'prev': None}}
        pg, errs = await page_with(ctx, base, fresh, storage=seed, path='&p=dashboard')
        await pg.wait_for_timeout(1500)
        txt = await pg.inner_text('.rec-box')
        check('Cloud backup' in txt and 'Off.' in txt and 'Restore from a cloud backup' in txt, f'the records card offers cloud backup (off) and restore: {txt[:300]}')
        await pg.fill('.cloud-box input[aria-label="Backup Worker address"]', BASE_W)
        await pg.click('text=Turn on cloud backup')
        await pg.wait_for_timeout(1500)
        key = await pg.input_value('.cloud-key')
        check(key.startswith('scr1.') and len(key) > 60, f'a recovery key is shown: {key[:12]}...')
        check(len(db) == 1, 'one copy was stored in the Worker')
        raw = json.dumps(db)
        check('AAPL' not in raw and 'NVDA' not in raw and 'watch' not in raw, 'the stored copy is scrambled: no ticker or field name is readable in it')
        sent = ' '.join(x[1] for x in log)
        check(BASE_W not in sent and key not in sent, 'the recovery key and the address are never sent to the Worker')
        # a change is saved by "Back up now"
        await pg.evaluate("(() => { const w = JSON.parse(localStorage.getItem('watch')); w.items.push({ t: 'MSFT', added: '2026-11-03', addPx: null }); localStorage.setItem('watch', JSON.stringify(w)); })()")
        await pg.reload(); await pg.wait_for_timeout(1500)
        await pg.click('text=Back up now'); await pg.wait_for_timeout(1200)
        check(len(db) == 1 and sum(1 for x in log if x[0] == '/sync/put') >= 2, 'a later change is saved to the same copy')
        await pg.close()

        # a reinstall: empty storage, restore from the key
        pg, errs = await page_with(ctx, base, fresh, storage={}, path='&p=dashboard')
        await pg.wait_for_timeout(1500)
        puts = sum(1 for x in log if x[0] == '/sync/put')
        await pg.click('summary:has-text("Restore from a cloud backup")')
        await pg.fill('input[aria-label="Recovery key to restore from"]', 'scr1.nonsense')
        await pg.click('button:text-is("Restore")'); await pg.wait_for_timeout(600)
        check('not a recovery key' in await pg.inner_text('.cloud-box'), 'a wrong key is refused with a plain message')
        await pg.fill('input[aria-label="Recovery key to restore from"]', key)
        await pg.click('button:text-is("Restore")'); await pg.wait_for_timeout(2500)
        items = await pg.evaluate("JSON.parse(localStorage.getItem('watch') || '{\"items\":[]}').items.map((i) => i.t).sort()")
        check(items == ['AAPL', 'MSFT', 'NVDA'], f'the lists come back after a reinstall: {items}')
        own = await pg.evaluate("JSON.parse(localStorage.getItem('watch')).items.find((i) => i.t === 'AAPL').own")
        check(own is True, 'the "I own it" flag came back')
        check(await pg.evaluate("!!JSON.parse(localStorage.getItem('cloud'))"), 'the restored device keeps backing up to the same copy')
        # a fresh empty device with the same key turned on must not wipe the copy
        await pg.evaluate("localStorage.removeItem('watch')")
        await pg.click('text=Back up now') if await pg.is_visible('text=Back up now') else None
        await pg.wait_for_timeout(800)
        blob = json.loads(json.dumps(db))
        check(len(db) == 1, 'an empty device did not replace the copy with nothing')
        # wrong key cannot read a real copy
        other = 'scr1.' + __import__('base64').urlsafe_b64encode(json.dumps({'u': BASE_W, 's': 'x' * 32}).encode()).decode().rstrip('=')
        await pg.wait_for_timeout(1500)
        await pg.click('summary:has-text("Restore from a cloud backup")')
        await pg.fill('input[aria-label="Recovery key to restore from"]', other)
        await pg.click('button:text-is("Restore")'); await pg.wait_for_timeout(1000)
        check('No backup was found' in await pg.inner_text('.cloud-box'), 'a key that does not match any copy finds nothing')
        # a second phone signed in with the same key: opening the site joins the newer copy in, without removing anything
        import base64
        sec = json.loads(base64.urlsafe_b64decode(key[5:] + '=' * (-len(key[5:]) % 4)))['s']
        pg2, errs2 = await page_with(ctx, base, fresh, storage={'cloud': {'url': BASE_W, 'secret': sec, 'last': '', 'hash': ''}, 'watch': {'v': 1, 'items': [{'t': 'KO', 'added': '2026-11-04', 'addPx': None}], 'snap': None, 'prev': None}}, path='&p=dashboard')
        await pg2.wait_for_timeout(9000)
        items2 = await pg2.evaluate("JSON.parse(localStorage.getItem('watch')).items.map((i) => i.t).sort()")
        check(items2 == ['AAPL', 'KO', 'MSFT', 'NVDA'], f'a second phone with the same key gets the lists and keeps its own stock: {items2}')
        await pg2.close()
        # turn off deletes the copy
        await pg.reload(); await pg.wait_for_timeout(1500)
        pg.on('dialog', lambda d: asyncio.ensure_future(d.accept()))
        await pg.click('text=Turn off and delete the cloud copy'); await pg.wait_for_timeout(1200)
        check(len(db) == 0 and not await pg.evaluate("localStorage.getItem('cloud')"), 'turning off deletes the cloud copy and forgets the key here')
        check(not errs, f'no page errors {errs[:2]}')
        await b.close()
    sys.exit(1 if failures else 0)


asyncio.run(main())
