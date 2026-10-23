# Print rows of filing pages (notes and details, e.g. the debt note) whose name matches a pattern.
# Usage: python3 notes.py CIK 10-K|10-Q page-regex [row-regex]
import sys, re, io
import pandas as pd
import xml.etree.ElementTree as ET
from fr import get, filing
cik, form, pg = sys.argv[1], sys.argv[2], re.compile(sys.argv[3], re.I)
rp = re.compile(sys.argv[4] if len(sys.argv) > 4 else r'.', re.I)
acc, rd, fd = filing(cik, form)
base = f'https://www.sec.gov/Archives/edgar/data/{int(cik)}/{acc.replace("-","")}/'
fs = ET.fromstring(get(base + 'FilingSummary.xml'))
print(form, acc, rd)
n = 0
for r in fs.iter('Report'):
    name = r.findtext('ShortName') or ''
    if not pg.search(name) or not r.findtext('HtmlFileName'): continue
    n += 1
    if n > 4: break
    html = get(base + r.findtext('HtmlFileName')).decode('utf-8', 'ignore')
    try: tbl = pd.read_html(io.StringIO(html))[0]
    except Exception: continue
    cols = [' / '.join(str(x) for x in c) if isinstance(c, tuple) else str(c) for c in tbl.columns]
    print('==', name, '|', ' || '.join(c[:50] for c in cols[:4]))
    for _, row in tbl.iterrows():
        label = re.sub(r'\s+', ' ', str(row.iloc[0])).strip()
        if rp.search(label): print('  ', label[:90], '|', ' | '.join(str(v) for v in row.iloc[1:4]))
