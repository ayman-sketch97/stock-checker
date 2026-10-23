# Independent check of the fair value (DCF) figures. Recomputes bear, base and bull per share from the inputs the
# page shows (revenue, owner margin, growth, discount rate, terminal growth, cash minus debt and minority interests,
# shares) with code
# written separately from lib/engine.js. Run test/validation/eng.mjs first; it writes <TICKER>.v3.json files here.
# Usage: python3 test/validation/dcfcheck.py AAPL MSFT NVDA ...
import json, sys


def per_share(rev, margin, g1, r, gT, net_cash, shares):
    cfs = []
    for y in range(1, 11):
        g = g1 if y <= 5 else g1 + (gT - g1) * (y - 5) / 5  # 5 years at g1, then a straight fade to gT by year 10
        rev *= 1 + g
        cfs.append(rev * margin)
    pv = sum(c / (1 + r) ** (k + 1) for k, c in enumerate(cfs))
    tv = cfs[-1] * (1 + gT) / (r - gT)  # Gordon value of year-11 cash flow
    return (pv + tv / (1 + r) ** 10 + net_cash) / shares


worst = 0.0
for t in sys.argv[1:]:
    res = json.load(open(f'{t}.v3.json'))
    f = res.get('fairValue')
    if not f or 'inputs' not in f:
        print(f'{t:5} no fair value: {"; ".join(res.get("fairValueIssues") or [])}')
        continue
    i = f['inputs']
    assert abs(i['netCash'] - (i['cash'] - i['debt'])) < 1, f'{t}: net cash is not cash minus debt'
    for sc in ('bear', 'base', 'bull'):
        s = f['scenarios'][sc]
        # value for common shareholders: cash minus debt, minus outside shareholders' part of subsidiaries (book)
        v = per_share(i['revenue'], s['margin'], s['growth'], f['discountRate'], f['terminalGrowth'], i['netCash'] - (i.get('nci') or 0), i['shares'])
        d = v / f[sc] - 1
        worst = max(worst, abs(d))
        print(f'{t:5} {sc:4} independent {v:9.2f}   page {f[sc]:9.2f}   difference {d * 100:+.3f}%')
print(f'largest difference {worst * 100:.3f}% (growth and margin are shown rounded to 4 decimals)')
