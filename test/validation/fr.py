import json, sys, urllib.request, io, openpyxl, re, time
UA = {'User-Agent': 'StockCheckerAudit/1.0 audit@stockchecker.local'}
def get(url):
    for i in range(3):
        try:
            return urllib.request.urlopen(urllib.request.Request(url, headers=UA), timeout=60).read()
        except Exception as e:
            err = e; time.sleep(2)
    raise err
def filing(cik, form, n=0):
    j = json.loads(get(f'https://data.sec.gov/submissions/CIK{int(cik):010d}.json'))
    r = j['filings']['recent']
    idx = [i for i, f in enumerate(r['form']) if f == form][n]
    return r['accessionNumber'][idx], r['reportDate'][idx], r['filingDate'][idx]
def report(cik, acc):
    b = get(f'https://www.sec.gov/Archives/edgar/data/{int(cik)}/{acc.replace("-","")}/Financial_Report.xlsx')
    return openpyxl.load_workbook(io.BytesIO(b), data_only=True)
if __name__ == '__main__':
    cik, form = sys.argv[1], sys.argv[2]
    acc, rd, fd = filing(cik, form)
    wb = report(cik, acc)
    print(acc, rd, fd)
    for ws in wb.worksheets[:9]:
        print('==', ws.title, '|', ws.cell(1,1).value)
        for row in ws.iter_rows(min_row=1, max_row=6, values_only=True):
            print('   ', row[:4])
