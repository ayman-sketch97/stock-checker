import json,glob,random,statistics as st,math
rows=[]
for f in sorted(glob.glob('s24_*.json')): rows+=json.load(open(f))
rows.sort(key=lambda r:r['date'])
scr=json.load(open('screen.json'))['rows']; halal={r[0] for r in scr if r[8]=='pass'}
COST=0.003
NN=[10]
def rankavg(v):
    idx=sorted(range(len(v)),key=lambda i:v[i]);r=[0]*len(v);i=0
    while i<len(v):
        j=i
        while j+1<len(v) and v[idx[j+1]]==v[idx[i]]: j+=1
        for k in range(i,j+1): r[idx[k]]=(i+j)/2
        i=j+1
    return r
def spear(a,b):
    if len(a)<10 or len(set(a))<2: return None
    x,y=rankavg(a),rankavg(b);mx,my=st.mean(x),st.mean(y)
    sxy=sum((p-mx)*(q-my) for p,q in zip(x,y));sxx=sum((p-mx)**2 for p in x);syy=sum((q-my)**2 for q in y)
    return sxy/math.sqrt(sxx*syy) if sxx>0 and syy>0 else None
def per_date(r,N,sub=None):
    L=r['listed']
    if sub: L=[l for l in L if l['t'] in sub]
    if len(L)<3: return None
    ex=[l['gross']-COST-r['mkt'] for l in L]
    top=ex[:N]; 
    ic=spear([l['score'] for l in L],[l['gross'] for l in L])
    return dict(date=r['date'],regime=r['regime'],n=len(L),top=st.mean(top),rand=st.mean(ex),mkt0=0.0,ic=ic,
                topret=st.mean([l['gross'] for l in L[:N]])-COST)
def boot(v,B=5000,seed=1):
    rg=random.Random(seed);n=len(v);m=[]
    for _ in range(B): m.append(sum(v[rg.randrange(n)] for _ in range(n))/n)
    m.sort();return m[int(.025*B)],m[int(.975*B)]
def summ(ds):
    ds=[d for d in ds if d]
    if len(ds)<3: return dict(n_dates=len(ds))
    gap=[d['top']-d['rand'] for d in ds];top=[d['top'] for d in ds];ics=[d['ic'] for d in ds if d['ic'] is not None]
    lo,hi=boot(gap);tlo,thi=boot(top)
    t=st.mean(ics)/(st.stdev(ics)/math.sqrt(len(ics))) if len(ics)>2 and st.stdev(ics)>0 else None
    # drawdown of equal-weight sequence of top-group net returns (compounded per date)
    eq=1;pk=1;dd=0
    for d in ds:
        eq*=1+d['topret']; pk=max(pk,eq); dd=max(dd,1-eq/pk)
    return dict(n_dates=len(ds),n_trades=sum(min(NN[0],d['n']) for d in ds),top_net_excess=round(st.mean(top)*100,2),top_ci=[round(tlo*100,2),round(thi*100,2)],
      gap_vs_random=round(st.mean(gap)*100,2),gap_ci=[round(lo*100,2),round(hi*100,2)],ic=round(st.mean(ics),3),ic_t=round(t,2) if t else None,
      maxdd=round(dd*100,0),hit=round(sum(1 for x in top if x>0)/len(top)*100,0),worst_date=round(min(top)*100,1),avg_listed=round(st.mean(d['n'] for d in ds),0))
DEV=lambda d:d['date']<='2024-12-31'
out={}
for name,sub in [('all800',None),('halal_today',halal)]:
    for N in (10,5,20):
        NN[0]=N
        ds=[per_date(r,N,sub) for r in rows]; ds=[d for d in ds if d]
        out[f'{name}_top{N}']={'dev':summ([d for d in ds if DEV(d)]),'final':summ([d for d in ds if not DEV(d)]),'both':summ(ds)}
ds=[d for d in (per_date(r,10) for r in rows) if d]
out['regimes']={k:summ([d for d in ds if d['regime']==k]) for k in ('up','mixed','down')}
out['crash2020']=summ([d for d in ds if '2020-02-19'<=d['date']<='2020-04-30'])
out['bear2022']=summ([d for d in ds if '2022-01-03'<=d['date']<='2022-10-14'])
out['by_year']={y:summ([d for d in ds if d['date'][:4]==y]) for y in sorted({d['date'][:4] for d in ds})}
# listed vs whole universe, net of cost
al=[(st.mean([l['gross'] for l in r['listed']])-COST-r['mkt']) for r in rows if r['listed']]
out['all_listed_vs_universe_net']={'mean_pct':round(st.mean(al)*100,2),'ci':[round(x*100,2) for x in boot(al)],'n':len(al)}
out['universe_gross_mean_20d_pct']=round(st.mean(r['mkt'] for r in rows)*100,2)
out['dates']=[rows[0]['date'],rows[-1]['date'],len(rows)]
# verdict per prereg
p=out['all800_top10']
def ok(s): return s['gap_ci'][0]>0 and s['top_net_excess']>0 and (s['ic_t'] or 0)>2
def neg(s): return s['gap_ci'][1]<0
out['verdict']='EDGE SUPPORTED' if ok(p['dev']) and ok(p['final']) else ('NEGATIVE' if neg(p['dev']) or neg(p['final']) else 'NO MEASURABLE EDGE')
json.dump(out,open('result.json','w'),indent=1);print(json.dumps(out,indent=1))
