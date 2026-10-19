import json, sys, pandas as pd, numpy as np
def wilder(s, n):
    # Wilder smoothing seeded with the simple mean of the first n values
    out = np.full(len(s), np.nan); v = s.values
    out[n-1] = v[:n].mean()
    for i in range(n, len(v)): out[i] = (out[i-1]*(n-1) + v[i]) / n
    return pd.Series(out, index=s.index)
worst = {}
for t in sys.argv[1:]:
    d = pd.DataFrame(json.load(open(f'{t}.daily.json')))
    c, h, l = d.c, d.h, d.l
    ind = json.load(open(f'{t}.ind.json'))
    ref = {}
    ref['e21'] = c.ewm(span=21, adjust=False).mean()
    ref['s50'] = c.rolling(50).mean(); ref['s200'] = c.rolling(200).mean()
    delta = c.diff()
    g = delta.clip(lower=0); lo = (-delta).clip(lower=0)
    ag = wilder(g.iloc[1:], 14).reindex(c.index); al = wilder(lo.iloc[1:], 14).reindex(c.index)
    ref['rsi'] = 100 - 100/(1 + ag/al)
    m = c.ewm(span=12, adjust=False).mean() - c.ewm(span=26, adjust=False).mean()
    ref['macd'] = m; ref['sig'] = m.ewm(span=9, adjust=False).mean()
    tr = pd.concat([h-l, (h-c.shift()).abs(), (l-c.shift()).abs()], axis=1).max(axis=1); tr.iloc[0] = h.iloc[0]-l.iloc[0]
    ref['atr'] = wilder(tr, 14)
    n = len(ind['dates'])
    assert ind['dates'][-1] == d.date.iloc[-1]
    row = []
    for k in ['e21','s50','s200','rsi','macd','sig','atr']:
        mine = np.array([np.nan if x is None else x for x in ind[k]], float)
        r = ref[k].values[-n:]
        err = np.nanmax(np.abs(mine - r))
        scale = np.nanmax(np.abs(r))
        row.append(f'{k} maxAbsErr={err:.2e} ({err/scale:.1e} rel) last mine={mine[-1]:.4f} ref={r[-1]:.4f}')
    print(t, d.date.iloc[-1]); print('   ' + '\n   '.join(row))
