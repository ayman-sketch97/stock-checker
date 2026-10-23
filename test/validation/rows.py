# Print statement rows (label and first value columns) of a company's latest 10-K or 10-Q, for reading figures by hand
# where the label parser in val.py fails (unusual labels, extra columns, 12-month columns, share scales).
# Usage: python3 rows.py CIK 10-K|10-Q [regex]
import sys, re, io
import pandas as pd
from fr import get, filing
from val import stmts, kind
cik, form = sys.argv[1], sys.argv[2]
pat = re.compile(sys.argv[3] if len(sys.argv) > 3 else r'.', re.I)
acc, rd, fd = filing(cik, form)
print(form, acc, rd)
for name, url in stmts(cik, acc):
    k = kind(name)
    if not k: continue
    html = get(url).decode('utf-8', 'ignore')
    unit = re.search(r'(in (millions|thousands|billions)[^<]{0,60})', html, re.I)
    tbl = pd.read_html(io.StringIO(html))[0]
    cols = [' / '.join(str(x) for x in c) if isinstance(c, tuple) else str(c) for c in tbl.columns]
    print(f'== {k} | {name} | {unit.group(1) if unit else "units?"}')
    print('   cols:', ' || '.join(c[:60] for c in cols[1:8]))
    for _, row in tbl.iterrows():
        label = re.sub(r'\s+', ' ', str(row.iloc[0])).strip()
        if pat.search(label):
            vals = [str(v) for v in row.iloc[1:8]]
            print('  ', label[:80], '|', ' | '.join(vals))
