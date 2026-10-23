# Sensitivity check of the fair value on real companies: how the base value per share moves when one input
# changes, recomputed with code written separately from lib/engine.js (same formula as dcfcheck.py).
# Expected directions: more growth, margin or cash raise the value; a higher discount rate, more debt or more
# shares (dilution) lower it. Cash and debt move the value by exactly their amount per share.
# Run test/validation/eng.mjs first (it writes <TICKER>.v3.json here).
# Usage: python3 test/validation/dcfsens.py AAPL MSFT ...
import json, sys


def per_share(rev, margin, g1, r, gT, net_cash, shares):
    cfs = []
    for y in range(1, 11):
        g = g1 if y <= 5 else g1 + (gT - g1) * (y - 5) / 5
        rev *= 1 + g
        cfs.append(rev * margin)
    pv = sum(c / (1 + r) ** (k + 1) for k, c in enumerate(cfs))
    tv = cfs[-1] * (1 + gT) / (r - gT)
    return (pv + tv / (1 + r) ** 10 + net_cash) / shares


bad = 0
print(f"{'':6} {'price':>8} {'base':>8} {'g+5pt':>7} {'g-5pt':>7} {'m+20%':>7} {'m-20%':>7} {'r+1pt':>7} {'r-1pt':>7} {'cash+':>7} {'debt+':>7} {'sh+10%':>7}")
for t in sys.argv[1:]:
    res = json.load(open(f'{t}.v3.json'))
    f = res.get('fairValue')
    if not f:
        print(f'{t:6} no fair value: {(res.get("fairValueIssues") or ["?"])[0][:90]}')
        continue
    i, s = f['inputs'], f['scenarios']['base']
    p = dict(rev=i['revenue'], margin=s['margin'], g1=s['growth'], r=f['discountRate'], gT=f['terminalGrowth'],
             net_cash=i['netCash'] - (i.get('nci') or 0), shares=i['shares'])
    base = per_share(**p)
    mcap = res['price'] * i['shares']
    v = {
        'g+5pt': per_share(**{**p, 'g1': p['g1'] + 0.05}), 'g-5pt': per_share(**{**p, 'g1': p['g1'] - 0.05}),
        'm+20%': per_share(**{**p, 'margin': p['margin'] * 1.2}), 'm-20%': per_share(**{**p, 'margin': p['margin'] * 0.8}),
        'r+1pt': per_share(**{**p, 'r': p['r'] + 0.01}), 'r-1pt': per_share(**{**p, 'r': p['r'] - 0.01}),
        'cash+': per_share(**{**p, 'net_cash': p['net_cash'] + 0.1 * mcap}),  # cash worth 10% of market value
        'debt+': per_share(**{**p, 'net_cash': p['net_cash'] - 0.1 * mcap}),  # debt worth 10% of market value
        'sh+10%': per_share(**{**p, 'shares': p['shares'] * 1.1}),
    }
    ch = {k: x / base - 1 for k, x in v.items()}
    ok = (v['g+5pt'] > base > v['g-5pt'] and v['m+20%'] > base > v['m-20%'] and v['r+1pt'] < base < v['r-1pt']
          and abs((v['cash+'] - base) - 0.1 * res['price']) < 1e-6 * res['price']
          and abs((base - v['debt+']) - 0.1 * res['price']) < 1e-6 * res['price']
          and abs(v['sh+10%'] - base / 1.1) < 1e-9 * base)
    bad += not ok
    print(f"{t:6} {res['price']:8.2f} {base:8.2f} " + ' '.join(f"{ch[k] * 100:+6.1f}%" for k in v) + ('' if ok else '  WRONG DIRECTION'))
print('all directions as expected' if not bad else f'{bad} companies moved the wrong way')
