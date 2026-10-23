# Backtest checks: results per setup after 0.2%, 0.5% and 0.8% round-trip costs, an early/late period split, results
# by year, and a benchmark on a fixed random sample of stocks (the setups' trades against buying the same stock on a
# random day and holding it as long, and against SPY bought on a random day and held as long).
# Usage:
#   curl -s -o backtest.json https://ayman-sketch97.github.io/stock-checker/data/backtest.json
#   python3 test/validation/btbench.py sample backtest.json > sample.txt
#   node test/validation/btfetch.mjs SPY $(cat sample.txt)
#   python3 test/validation/btbench.py run backtest.json hist.json
import json, math, random, statistics as st, sys

mode, bt_file = sys.argv[1], sys.argv[2]
b = json.load(open(bt_file))
stocks = b['stocks']
if mode == 'sample':
    random.seed(7)
    print(' '.join(s[0] for s in random.sample(stocks, 160)))
    sys.exit(0)

H = json.load(open(sys.argv[3]))
SETUPS = b['setups']
T = [dict(stock=r[0], setup=SETUPS[r[1]], sig=str(r[2]), days=r[3], R=r[4] / 100, risk=r[5] / 1000, regime=r[7], rs=r[9]) for r in b['trades']]


def net_r(t, cost):  # same rule as lib/backtest.js netR: the cost is charged against the risk, risk floored at 0.5%
    return t['R'] - cost / max(t['risk'], 0.005)


def ci(x):
    m = st.mean(x)
    se = st.stdev(x) / math.sqrt(len(x))
    return m, m - 1.96 * se, m + 1.96 * se


def line(name, x):
    m, lo, hi = ci(x)
    return f'{name:<24} n={len(x):>6}  avg {m:+.3f}R  [{lo:+.3f}, {hi:+.3f}]'


halal = [t for t in T if stocks[t['stock']][1] == 'pass']
strong = [t for t in halal if t['rs'] is not None and t['rs'] >= 70 and t['regime'] != 2]
print(f"backtest {b['version']} as of {b['asOf']}: {len(T)} trades on {len(stocks)} stocks")
print('\n== average result per trade, by round-trip cost')
for c in (0.002, 0.005, 0.008):
    print(f'-- cost {c * 100:.1f}%')
    for s in SETUPS:
        print('  ' + line(s, [net_r(t, c) for t in T if t['setup'] == s]))
    print('  ' + line('all', [net_r(t, c) for t in T]))
    print('  ' + line('halal', [net_r(t, c) for t in halal]))
    print('  ' + line('halal, RS 70+, not down', [net_r(t, c) for t in strong]))

print('\n== period split (rules unchanged), 0.2% cost')
for lab, keep in (('to 2023', lambda t: t['sig'] < '20240101'), ('2024 on', lambda t: t['sig'] >= '20240101')):
    for s in SETUPS + ['all']:
        x = [net_r(t, 0.002) for t in T if keep(t) and (s == 'all' or t['setup'] == s)]
        print(f'  {lab:<8}' + line(s, x))

print('\n== by year, 0.5% cost')
for y in sorted({t['sig'][:4] for t in T}):
    print('  ' + line(y, [net_r(t, 0.005) for t in T if t['sig'][:4] == y]))

# benchmark on the sample: span = days + 1 closes (signal-day close to exit-day close), as on the site
spy = H['SPY']
random.seed(1)
rows = []
start = str(min(r[2] for r in b['trades']))
spy_lo = next(k for k, (dd, _) in enumerate(spy) if dd.replace('-', '') >= start)
for t in T:
    h = H.get(stocks[t['stock']][0])
    if not isinstance(h, list) or len(h) < 300:
        continue
    d = [x[0].replace('-', '') for x in h]
    c = [x[1] for x in h]
    span = t['days'] + 1
    lo = next((k for k, v in enumerate(d) if v >= start), None)
    hi = len(c) - 1 - span
    if lo is None or hi < lo:
        continue
    j = random.randint(lo, hi)
    k = random.randint(spy_lo, len(spy) - 1 - span)  # SPY on another random day, same span
    rows.append((t['R'] * t['risk'], c[j + span] / c[j] - 1, spy[k + span][1] / spy[k][1] - 1))
print(f'\n== benchmark on {len({stocks[t["stock"]][0] for t in T if isinstance(H.get(stocks[t["stock"]][0]), list)})} sample stocks: {len(rows)} trades, return on the money in each trade')
for name, k in (('setup trades, before costs', 0), ('same stock, random day', 1), ('SPY, random day', 2)):
    v = [r[k] for r in rows if r[k] is not None]
    m, lo, hi = ci(v)
    print(f'  {name:<28} {m * 100:+.2f}%  [{lo * 100:+.2f}, {hi * 100:+.2f}]  sd {st.stdev(v) * 100:.1f}%')
for c in (0.002, 0.005, 0.008):
    tr = st.mean(r[0] for r in rows) - c
    rn = st.mean(r[1] for r in rows) - c
    print(f'  after {c * 100:.1f}% costs: setups {tr * 100:+.2f}%, random entries {rn * 100:+.2f}%')
