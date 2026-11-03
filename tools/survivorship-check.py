"""How many companies the 10-year test misses because it holds only companies listed today (survivorship bias).

Run on 3 November 2026 (VALIDATION.md, section 14). Uses only the SEC's free data:
  1. the XBRL frames API: every filer's public float on its 10-K cover page as of mid-2016, mid-2024 and mid-2025
  2. the submissions API: each mid-2016 company's industry (SIC), current tickers and filing history, which shows a
     takeover (merger proxies, tender offers, Rule 425 filings), a bankruptcy (8-K item 1.03) or a delisting (Form 25,
     Form 15)
  3. the 10-year test's own list of companies (lt-data.ndjson.gz on the backtest branch)
Usage: python3 tools/survivorship-check.py lt-data.ndjson.gz
"""
import gzip, json, sys, time, threading
from collections import Counter
from concurrent.futures import ThreadPoolExecutor
import requests

UA = {'User-Agent': 'StockChecker/1.0 (personal fundamental-analysis tool; non-commercial)', 'Accept-Encoding': 'gzip, deflate'}
MIN_FLOAT = 250e6
MERGER = {'DEFM14A', 'DEFM14C', 'PREM14A', 'PREM14C', 'SC TO-T', 'SC TO-T/A', 'SC 14D9', 'SC 14D9/A', '425', 'SC 13E3', 'SC 13E3/A'}
DELIST = {'25-NSE', '25', '15-12B', '15-12G', '15-15D', '15F-12B'}
REG = {'10-K', '10-Q', '10-K/A', '10-Q/A', '20-F', '40-F', '10-KT'}


def frame(period):
    r = requests.get(f'https://data.sec.gov/api/xbrl/frames/dei/EntityPublicFloat/USD/{period}.json', headers=UA, timeout=60)
    r.raise_for_status()
    return r.json()['data']


lock, last = threading.Lock(), [0.0]


def submissions(cik):
    for _ in range(4):
        with lock:  # at most about 8 requests a second, under the SEC's limit of 10
            wait = last[0] + 0.12 - time.time()
            if wait > 0:
                time.sleep(wait)
            last[0] = time.time()
        try:
            r = requests.get(f'https://data.sec.gov/submissions/CIK{cik:010d}.json', headers=UA, timeout=30)
        except requests.RequestException:
            time.sleep(2)
            continue
        if r.status_code == 200:
            j = r.json()
            rc = j.get('filings', {}).get('recent', {})
            f = list(zip(rc.get('form', []), rc.get('filingDate', []), rc.get('items', []) or [''] * len(rc.get('form', []))))
            return cik, {'sic': j.get('sic'), 'tickers': j.get('tickers') or [], 'f': f[:400]}
        if r.status_code == 404:
            return cik, None
        time.sleep(3)
    return cik, None


def main(lt_path):
    lt = {}
    with gzip.open(lt_path, 'rt') as fh:
        for line in fh:
            o = json.loads(line)
            if o.get('t') != '$SPY':
                lt[o['t']] = o.get('skip') or 'ok'
    big16 = {x['cik']: x for x in frame('CY2016Q2I') if x['val'] >= MIN_FLOAT}
    recent = {}
    for x in frame('CY2024Q2I') + frame('CY2025Q2I'):
        recent[x['cik']] = max(recent.get(x['cik'], 0), x['val'])
    with ThreadPoolExecutor(6) as ex:
        subs = dict(ex.map(submissions, list(big16)))
    out = Counter()
    for cik, v in subs.items():
        if not v:
            out['no SEC data'] += 1
            continue
        sic = int(v['sic']) if str(v.get('sic') or '').isdigit() else 0
        if 6000 <= sic <= 6799:
            continue  # banks, insurers and REITs: the tool does not analyse them
        if any(f[0] in REG and f[1] >= '2025-07-01' for f in v['f']):
            if any(t in lt for t in v['tickers']):
                k = 'in the 10-year test'
            elif not v['tickers']:
                k = 'still files with the SEC, no listed share'
            elif recent.get(cik, 0) < MIN_FLOAT:
                k = 'listed, shrunk below the size cut-off'
            else:
                k = 'listed, missing for another reason (another exchange, a changed ticker)'
        else:
            forms = {f[0] for f in v['f'][:120]}
            items = ' '.join(str(f[2]) for f in v['f'][:120] if f[0].startswith('8-K'))
            k = ('gone: bankruptcy' if '1.03' in items else 'gone: taken over or merged' if forms & MERGER
                 else 'gone: delisted, reason not filed' if forms & DELIST else 'gone: stopped filing, reason unknown')
        out[k] += 1
    total = sum(n for k, n in out.items() if k != 'no SEC data')
    print(f'non-financial companies with a public float of ${MIN_FLOAT / 1e6:.0f}M or more in mid-2016: {total}')
    for k, n in out.most_common():
        print(f'{n:6d} {n / total:7.1%}  {k}')


if __name__ == '__main__':
    main(sys.argv[1])
