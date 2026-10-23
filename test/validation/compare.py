import json, datetime as dt
E = json.load(open('engine.json'))
OV = {  # values read by hand from the filing statements where the label parser cannot (segment layouts, footnote columns)
 'CAT': {'k': {'revenue': 67589e6, 'netIncome': 8884e6, 'eps': 18.81, 'shares': 472.3e6, 'debt': (5514+35+7085+10678+20018)*1e6, 'securities': 0},
         'q': {'revenue': 37958e6, 'revenue_prior': 30818e6, 'netIncome': 6142e6, 'netIncome_prior': 4182e6, 'debt': (5046+8026+21384+35+10655)*1e6, 'securities': 0}},
 'COST': {'k': {'eps': 20.76, 'shares': 444.427e6, 'cash': 20207e6, 'securities': 1094e6, 'debt': (2248+3914)*1e6, 'equity': 35803e6}},
 'CVX': {'k': {'netIncome': 12299e6, 'cash': 6293e6, 'securities': 0, 'debt': (977+39781)*1e6, 'equity': 186450e6, 'eps': 6.63},
         'q': {'cash': 8527e6, 'securities': 0, 'debt': (401+36674)*1e6, 'equity': 189883e6, 'netIncome': 14282e6, 'netIncome_prior': 5990e6}},
 'NVDA': {'k': {'capex': -6042e6}},
 # third round (October 2026): read by hand from the statements and the debt notes (rows.py, notes.py)
 'MSFT': {'k': {'shares': 7453e6, 'eps': 17.95, 'ocf': 182935e6}},
 'GOOGL': {'k': {'debt': (46547 + 1996) * 1e6}, 'q': {'debt': (98165 + 1999) * 1e6}},  # carrying value incl. current portion
 'META': {'q': {'debt': (80922 + 2747) * 1e6}},
 'AMZN': {'k': {'debt': (65648 + 2748) * 1e6}, 'q': {'debt': (128894 + 3330 + 325) * 1e6}},
 'HIMS': {'k': {'revenue': 2347637e3, 'netIncome': 128365e3, 'eps': 0.51, 'shares': 258230547, 'equity': 540928e3, 'debt': 972580e3,
                'securities': (348876 + 351263) * 1e3},
          'q': {'debt': 1365299e3, 'equity': 324072e3, 'securities': 231237e3}},
 'VRT': {'k': {'shares': 390652824, 'equity': 3941.3e6}, 'q': {'equity': 4757.6e6}},
 'MELI': {'k': {'revenue': 28893e6, 'shares': 50697320, 'capex': -1343e6, 'equity': 6748e6, 'debt': (4623 + 4570) * 1e6},
          'q': {'debt': (6482 + 4144) * 1e6, 'equity': 7834e6}},
 'KO': {'k': {'revenue': 47941e6, 'netIncome': 13107e6, 'equity': 32169e6, 'debt': (1551 + 1822 + 42119) * 1e6, 'securities': (3602 + 1934) * 1e6}},
 'BKNG': {'k': {'ocf': 9409e6, 'capex': -322e6, 'equity': -5578e6, 'debt': 18736e6, 'cash': 17203e6, 'securities': 0},
          'q': {'equity': -10783e6, 'debt': 20180e6, 'cash': 17214e6, 'securities': 0}},
 'DE': {'k': {'revenue': 45684e6, 'netIncome': 5027e6, 'capex': -1360e6, 'debt': (13796 + 6596 + 43544) * 1e6, 'securities': 1411e6},
        'q': {'debt': (17115 + 6095 + 40626) * 1e6, 'securities': 1350e6}},
}
# 12-month figures printed directly in the 10-Q (Amazon shows a trailing-twelve-month column)
OVT = {'AMZN': {'ocf': 161403e6, 'capex': 173028e6}}
def days(a, b): return abs((dt.date.fromisoformat(a) - dt.date.fromisoformat(b)).days)
rows = []
def cmp(t, period, item, off, eng, tol=0.005):
    if off is None or eng is None:
        rows.append([t, period, item, off, eng, None, 'not compared'])
        return
    d = (eng - off) / abs(off) if off else (0 if eng == 0 else 1)
    rows.append([t, period, item, off, eng, d, 'OK' if abs(d) <= tol else 'DIFF'])
for t, e in E.items():
    V = json.load(open(f'{t}.val.json'))
    k = {**V['k']['vals'], **OV.get(t, {}).get('k', {})}
    q = {**V['q']['vals'], **OV.get(t, {}).get('q', {})}
    kd, qd = V['k']['reportDate'], V['q']['reportDate']
    h = next((r for r in e['history'] if days(r['end'], kd) <= 12), None)
    P = f'FY {kd}'
    if h:
        for item, ev in [('revenue', h['revenue']), ('netIncome', h['netIncome']), ('eps', h['eps']), ('shares', h['shares']), ('ocf', h['ocf']),
                         ('capex', h['capex']), ('equity', h['equity']), ('debt', h['debt'])]:
            ov = k.get(item)
            if item == 'capex' and ov is not None: ov = abs(ov)
            cmp(t, P, item, ov, ev, 0.011 if item == 'eps' else 0.005)
        cash_off = (k.get('cash') or 0) + (k.get('securities') or 0) if k.get('cash') is not None else None
        cmp(t, P, 'cash+investments', cash_off, (h['cash'] or 0) + (h['investments'] or 0) if h['cash'] is not None else None)
    if qd > kd:
        Q = f'TTM/BS {qd}'
        for item, name in [('revenue', 'Revenue'), ('netIncome', 'Net income')]:
            if None not in (k.get(item), q.get(item), q.get(item + '_prior')):
                off = k[item] + q[item] - q[item + '_prior']
                s = e['src'][name]
                cmp(t, Q, item + ' (12 months)', off, s['value'] if s['period'] and qd in s['period'] else None)
        for item, name in [('ocf', 'Operating cash flow'), ('capex', 'Capital spending')]:
            s = e['src'][name]
            if item in OVT.get(t, {}):
                cmp(t, Q, item + ' (12 months)', OVT[t][item], s['value'] if s['period'] and qd in s['period'] else None)
            elif None not in (k.get(item), q.get(item), q.get(item + '_prior')):
                off = abs(k[item] + q[item] - q[item + '_prior'])
                cmp(t, Q, item + ' (12 months)', off, s['value'] if s['period'] and qd in s['period'] else None)
        if e['bs'] == qd:
            cmp(t, Q, 'cash+investments', (q.get('cash') or 0) + (q.get('securities') or 0) if q.get('cash') is not None else None, e['key']['cash'])
            cmp(t, Q, 'debt', q.get('debt'), e['key']['debt'])
            cmp(t, Q, 'equity', q.get('equity'), e['key']['equity'])
json.dump(rows, open('compare.json', 'w'))
ok = sum(1 for r in rows if r[6] == 'OK'); diff = [r for r in rows if r[6] == 'DIFF']; nc = [r for r in rows if r[6] == 'not compared']
print(f'compared {ok + len(diff)}: {ok} within tolerance, {len(diff)} differ, {len(nc)} not compared')
for r in diff: print('DIFF', r[0], r[1], r[2], 'official', r[3], 'engine', r[4], f'{r[5]*100:.2f}%')
for r in nc: print('NC  ', r[0], r[1], r[2], r[3], r[4])
