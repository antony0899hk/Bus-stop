(() => {
  "use strict";
  const $=s=>document.querySelector(s);
  const cache=new Map();
  const CACHE_MS=4*60*1000;

  function wait(eta,def){
    try{return eta&&typeof etaMinutes==='function'?Math.max(0,etaMinutes(eta)):def}catch{return def}
  }
  function walkMinutes(m){return Math.max(0,Number(m||0))/80;}
  function structuralKey(r){
    if(r?._dzMtrGraph)return `MTR|${r.route}|${r._dzMtrEntry?.code||''}|${r._dzMtrExit?.code||''}`;
    if(r?.kind==='transfer')return `${r.first?.operator}|${r.first?.route}>${r.second?.operator}|${r.second?.route}`;
    if(r?._dzDistrictCorridor)return `C|${r.route}|${r._dzHub||''}`;
    return `${r?.operator||''}|${r?.route||''}|${r?.bound||''}`;
  }
  function provisionalMinutes(r){
    if(r?._dzMtrGraph){
      const n=Number(r.estimatedMinutes??r._dzMtrTotal);if(Number.isFinite(n))return Math.max(0,n);
    }
    const stops=Math.max(0,Number(r?.stopCount||0));
    const transfers=Math.max(0,Number(r?.transferCount||0));
    const firstWait=wait(r?.firstEta||r?.eta,8);
    const secondWait=r?.secondEta?wait(r.secondEta,7):(transfers?7:0);
    const ride=stops*2.8;
    const transferCost=transfers*5;
    const total=firstWait+secondWait+ride+walkMinutes(r?.walkMeters)+transferCost;
    return Math.max(1,Math.round(total));
  }
  function mergeStable(queryKey,rows){
    const now=Date.now(),old=cache.get(queryKey);
    const m=new Map();
    for(const r of rows||[])m.set(structuralKey(r),r);
    if(old&&now-old.time<CACHE_MS){
      for(const r of old.rows||[])if(!m.has(structuralKey(r)))m.set(structuralKey(r),r);
    }
    const out=[...m.values()];cache.set(queryKey,{time:now,rows:out});return out;
  }
  function softPrune(rows){
    const out=[];
    for(const r of rows||[]){
      const t=provisionalMinutes(r),x=Number(r?.transferCount||0),w=Number(r?.walkMeters||0);
      const dominated=(rows||[]).some(a=>{
        if(a===r)return false;
        const ta=provisionalMinutes(a),xa=Number(a?.transferCount||0),wa=Number(a?.walkMeters||0);
        return ta<=t-15 && xa<x && wa<=w-150;
      });
      if(!dominated){r._dzDisplayMinutes=t;out.push(r);}
    }
    return out;
  }
  function updateTimeLabels(){
    const cards=[...document.querySelectorAll('#journeyResults .journey-card')];
    const rows=[...(journeyState?.results||[])].sort((a,b)=>(a._dzDisplayMinutes??9999)-(b._dzDisplayMinutes??9999));
    cards.forEach((card,i)=>{
      const r=rows[i];if(!r)return;
      const n=r._dzDisplayMinutes??provisionalMinutes(r);
      const eta=card.querySelector('.journey-eta');
      if(eta)eta.textContent=`暫估 ${Math.round(n)} 分鐘`;
      const walker=document.createTreeWalker(card,NodeFilter.SHOW_TEXT);
      const nodes=[];while(walker.nextNode())nodes.push(walker.currentNode);
      for(const node of nodes){if(/^\s*約\s*\d+\s*分鐘\s*$/.test(node.nodeValue||''))node.nodeValue=`暫估 ${Math.round(n)} 分鐘`;}
    });
  }

  if(typeof journeyScore==='function'){
    const old=journeyScore;
    journeyScore=function(r){
      if(journeyState?.mode==='fastest')return Number(r?._dzDisplayMinutes??provisionalMinutes(r));
      return old(r);
    };
  }
  if(typeof renderJourneyResults==='function'){
    const oldRender=renderJourneyResults;
    renderJourneyResults=function(){const out=oldRender.apply(this,arguments);setTimeout(updateTimeLabels,0);return out;};
  }
  if(typeof runJourneySearch==='function'){
    const oldRun=runJourneySearch;
    runJourneySearch=async function(){
      const from=$('#journeyFrom')?.value.trim()||'',to=$('#journeyTo')?.value.trim()||'',mode=journeyState?.mode||'fastest';
      await oldRun();
      let rows=mergeStable(`${from}|${to}|${mode}`,journeyState?.results||[]);
      rows=softPrune(rows).sort((a,b)=>provisionalMinutes(a)-provisionalMinutes(b));
      journeyState.results=rows.slice(0,12);
      try{renderJourneyResults();}catch{}
      const st=$('#journeyStatus');
      if(st)st.textContent='時間暫為估算總時間（等車＋行車估算＋轉車＋步行）；未接入歷史實際行車時間前只作排序參考。';
    };
  }
  window.dzJourney396={version:'3.9.6',provisionalMinutes,mergeStable,softPrune};
})();