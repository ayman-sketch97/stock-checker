import json,os,sys,time,urllib.request,concurrent.futures as cf
d=json.load(open('screen.json'));rows=sorted([r for r in d['rows'] if isinstance(r[4],(int,float))],key=lambda r:-r[4])[:800]
tick=[r[0] for r in rows]+['SPY']
os.makedirs('px',exist_ok=True)
def get(t):
    f=f'px/{t}.json'
    if os.path.exists(f): return t,'cached'
    sym=t.replace('.','-')
    url=f'https://query1.finance.yahoo.com/v8/finance/chart/{sym}?period1=1388534400&period2=1796000000&interval=1d&events=div%7Csplit&includeAdjustedClose=true'
    for a in range(4):
        try:
            req=urllib.request.Request(url,headers={'User-Agent':'Mozilla/5.0'})
            j=json.load(urllib.request.urlopen(req,timeout=30))
            r=j['chart']['result'][0];q=r['indicators']['quote'][0];adj=r['indicators']['adjclose'][0]['adjclose']
            json.dump({'t':r['timestamp'],'o':q['open'],'h':q['high'],'l':q['low'],'c':q['close'],'v':q['volume'],'a':adj},open(f,'w'));return t,'ok'
        except Exception as e:
            err=str(e)[:60];time.sleep(2+a*3)
    return t,'fail '+err
res=[]
with cf.ThreadPoolExecutor(4) as ex:
    for t,s in ex.map(get,tick):
        res.append((t,s))
print(sum(1 for t,s in res if s.startswith('fail')),'failed of',len(res));print([x for x in res if x[1].startswith('fail')][:20])
json.dump(rows and [r[0] for r in rows],open('universe.json','w'))
