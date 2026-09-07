(() => {
  "use strict";
  const $=s=>document.querySelector(s);
  const MINUTE=60000;

  function etaRows(leg,stopId){
    if(!leg||!stopId||!leg.route)return Promise.resolve([]);
    const op=leg.operator,route=String(leg.route),bound=String(leg.bound||'').toUpperCase();
    if(op==='KMB'){
      return getJSON(`${KMB_API}/eta/${encodeURIComponent(stopId)}/${encodeURIComponent(route)}/${encodeURIComponent(leg.serviceType||'1')}`,{ttl:15000,retries:0})
        .then(j=>(j.data||[]).filter(x=>(!bound||!x.dir||String(x.dir).toUpperCase()===bound)&&validFutureEta(x.eta)).map(x=>Date.parse(x.eta)).filter(Number.isFinite).sort((a,b)=>a-b)).catch(()=>[]);
    }
    if(op==='CTB'){
      return getJSON(`${CTB_API}/eta/ctb/${encodeURIComponent(stopId)}/${encodeURIComponent(route)}`,{ttl:15000,retries:0})
        .then(j=>(j.data||[]).filter(x=>(!bound||!x.dir||String(x.dir).toUpperCase()===bound)&&validFutureEta(x.eta)).map(x=>Date.parse(x.eta)).filter(Number.isFinite).sort((a,b)=>a-b)).catch(()=>[]);
    }
    return Promise.resolve([]);
  }
  function nextAfter(rows,when,minGap=0,maxGap=120){
    const t=(rows||[]).find(x=>x>=when+minGap*MINUTE && x<=when+maxGap*MINUTE);
    return Number.isFinite(t)?t:null;
  }
  const mins=(a,b)=>Math.max(0,Math.round((b-a)/MINUTE));
  const walk=m=>Math.max(0,Math.round(Number(m||0)/80));

  async function refineTransfer(r){
    if(r?.kind!=='transfer'||!['KMB','CTB'].includes(r.first?.operator)||!['KMB','CTB'].includes(r.second?.operator))return null;
    const firstBoard=r.first?.originStop?.id,firstAlight=r.first?.transferStopId||r.transferStopId;
    const secondBoard=r.second?.transferStopId||r.transferStopId,secondAlight=r.second?.destinationStop?.id;
    if(!firstBoard||!firstAlight||!secondBoard||!secondAlight)return null;
    const now=Date.now();
    const [a0,a1,b0,b1]=await Promise.all([etaRows(r.first,firstBoard),etaRows(r.first,firstAlight),etaRows(r.second,secondBoard),etaRows(r.second,secondAlight)]);
    const board1=nextAfter(a0,now,0,90);if(!board1)return null;
    const arrive1=nextAfter(a1,board1,2,90);if(!arrive1)return null;
    const xferWalk=walk(r.transferWalkMeters||0);
    const ready2=arrive1+xferWalk*MINUTE;
    const board2=nextAfter(b0,ready2,0,120);if(!board2)return null;
    const arrive2=nextAfter(b1,board2,2,120);if(!arrive2)return null;
    const originWalk=walk(r.first?.originStop?.distance||0),finalWalk=walk(r.second?.destinationStop?.distance||0);
    const wait1=mins(now,board1),ride1=mins(board1,arrive1),wait2=mins(ready2,board2),ride2=mins(board2,arrive2);
    const total=originWalk+wait1+ride1+xferWalk+wait2+ride2+finalWalk;
    if(total<5||total>240)return null;
    return {total,originWalk,wait1,ride1,xferWalk,wait2,ride2,finalWalk};
  }

  async function refineDirect(r){
    if(r?.kind==='transfer'||!['KMB','CTB'].includes(r?.operator))return null;
    const a=r.originStop?.id,b=r.destinationStop?.id;if(!a||!b)return null;
    const now=Date.now(),[x0,x1]=await Promise.all([etaRows(r,a),etaRows(r,b)]);
    const board=nextAfter(x0,now,0,90);if(!board)return null;
    const arrive=nextAfter(x1,board,2,120);if(!arrive)return null;
    const originWalk=walk(r.originStop?.distance||0),finalWalk=walk(r.destinationStop?.distance||0),wait1=mins(now,board),ride1=mins(board,arrive);
    const total=originWalk+wait1+ride1+finalWalk;if(total<3||total>240)return null;
    return {total,originWalk,wait1,ride1,finalWalk};
  }

  function decorate(){
    const rows=[...(journeyState?.results||[])].sort((a,b)=>(a._dzDisplayMinutes??9999)-(b._dzDisplayMinutes??9999));
    const cards=[...document.querySelectorAll('#journeyResults .journey-card')];
    cards.forEach((card,i)=>{
      const r=rows[i],b=r?._dzLiveBreakdown;if(!r||!b)return;
      const eta=card.querySelector('.journey-eta');if(eta)eta.textContent=`預計 ${Math.round(b.total)} 分鐘`;
      card.querySelector('.dz-live-time-breakdown')?.remove();
      const line=document.createElement('div');line.className='dz-live-time-breakdown';
      if(r.kind==='transfer') line.textContent=`即時計算：等 ${b.wait1} + ${r.first.route} 行車 ${b.ride1} + 轉車等 ${b.wait2} + ${r.second.route} 行車 ${b.ride2}${(b.originWalk+b.xferWalk+b.finalWalk)>0?` + 步行 ${b.originWalk+b.xferWalk+b.finalWalk}`:''} = ${b.total} 分鐘`;
      else line.textContent=`即時計算：等 ${b.wait1} + ${r.route} 行車 ${b.ride1}${(b.originWalk+b.finalWalk)>0?` + 步行 ${b.originWalk+b.finalWalk}`:''} = ${b.total} 分鐘`;
      line.style.cssText='margin-top:8px;font-size:13px;line-height:1.45;color:#9ca0aa';card.appendChild(line);
    });
  }

  if(typeof runJourneySearch!=='function')return;
  const oldRun=runJourneySearch;
  runJourneySearch=async function(){
    await oldRun();
    const rows=[...(journeyState?.results||[])];
    // Keep this bounded for iPhone Safari: refine only the first six displayed candidates.
    for(const r of rows.slice(0,6)){
      let b=null;try{b=r.kind==='transfer'?await refineTransfer(r):await refineDirect(r);}catch{}
      if(b){r._dzLiveBreakdown=b;r._dzDisplayMinutes=b.total;}
    }
    rows.sort((a,b)=>(a._dzDisplayMinutes??9999)-(b._dzDisplayMinutes??9999));
    journeyState.results=rows.slice(0,12);
    try{renderJourneyResults();}catch{}
    setTimeout(decorate,0);
    const st=$('#journeyStatus');if(st)st.textContent='首批候選以兩段實時 ETA 時差計算：等第一程＋第一程行車＋到轉車站後等下一班＋第二程行車＋步行；實時資料不足的方案才保留暫估。';
  };
  window.dzLiveJourney3100={version:'3.10.0',refineTransfer,refineDirect};
})();
