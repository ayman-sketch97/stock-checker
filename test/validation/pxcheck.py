import json, urllib.request, datetime as dt
UA = {'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36'}
for t in ['AAPL','NVDA','JNJ','CAT','COST','CVX']:
    nd = {d['date']: d for d in json.load(open(f'{t}.daily.json'))}
    j = json.loads(urllib.request.urlopen(urllib.request.Request(f'https://query2.finance.yahoo.com/v8/finance/chart/{t}?range=1y&interval=1d', headers=UA), timeout=30).read())
    r = j['chart']['result'][0]; q = r['indicators']['quote'][0]
    n = 0; worst = (0, None); hl = 0
    for i, ts in enumerate(r['timestamp']):
        d = dt.datetime.utcfromtimestamp(ts + r['meta']['gmtoffset']).date().isoformat()
        if d not in nd or q['close'][i] is None: continue
        n += 1
        e = abs(nd[d]['c'] / q['close'][i] - 1)
        if e > worst[0]: worst = (e, d, nd[d]['c'], round(q['close'][i], 4))
        hl = max(hl, abs(nd[d]['h'] / q['high'][i] - 1), abs(nd[d]['l'] / q['low'][i] - 1))
    print(t, 'days', n, 'max close diff', f'{worst[0]*100:.3f}%', worst[1:], 'max high/low diff', f'{hl*100:.3f}%')
