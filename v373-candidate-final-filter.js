(() => {
  "use strict";
  const $ = s => document.querySelector(s);
  const ORIGIN_RADIUS = 1500;
  const DEST_RADIUS = 1800;
  let token = 0;

  const isNightRoute = r => /^(N|NA)\d/i.test(String(r || "").trim());

  function centroid(list){
    const a=(list||[]).filter(s=>Number.isFinite(s.lat)&&Number.isFinite(s.lon));
    if(!a.length)return null;
    return {lat:a.reduce((n,s)=>n+Number(s.lat),0)/a.length,lon:a.reduce((n,s)=>n+Number(s.lon),0)/a.length};
  }

  function areaStops(value,radius){
    const base=typeof resolvePlace==="function"?resolvePlace(value,null):[];
    const c=centroid(base);
    if(!c||typeof allJourneyStops!=="function")return base;
    const all=allJourneyStops().filter(s=>Number.isFinite(s.lat)&&Number.isFinite(s.lon))
      .map(s=>({...s,distance:distanceMeters(c.lat,c.lon,s.lat,s.lon)}))
      .filter(s=>s.distance<=radius).sort((a,b)=>a.distance-b.distance);
    const m=new Map();
    [...base,...all].forEach(s=>{const k=`${s.operator}|${s.id}`;const old=m.get(k);if(!old||Number(s.distance||0)<Number(old.distance||0))m.set(k,s);});
    return [...m.values()].sort((a,b)=>Number(a.distance||0)-Number(b.distance||0)).slice(0,70);
  }

  async function etaForLeg(leg,stopId){
    try{
      if(!leg||!stopId)return null;
      if(leg.operator==="KMB"){
        const j=await getJSON(`${KMB_API}/eta/${encodeURIComponent(stopId)}/${encodeURIComponent(leg.route)}/${encodeURIComponent(leg.serviceType||"1")}`,{ttl:0,retries:0});
        return (j.data||[]).filter(x=>(!leg.bound||!x.dir||String(x.dir).toUpperCase()===String(leg.bound).toUpperCase())&&validFutureEta(x.eta)).sort((a,b)=>new Date(a.eta)-new Date(b.eta))[0]?.eta||null;
      }
      if(leg.operator==="CTB"){
        const j=await getJSON(`${CTB_API}/eta/ctb/${encodeURIComponent(stopId)}/${encodeURIComponent(leg.route)}`,{ttl:0,retries:0});
        return (j.data||[]).filter(x=>(!leg.bound||!x.dir||String(x.dir).toUpperCase()===String(leg.bound).toUpperCase())&&validFutureEta(x.eta)).sort((a,b)=>new Date(a.eta)-new Date(b.eta))[0]?.eta||null;
      }
    }catch{}
    return null;
  }

  function routeKey(r){
    if(r.kind==="transfer")return `${r.first?.operator}|${r.first?.route}|${r.first?.originStop?.id}>${r.second?.operator}|${r.second?.route}|${r.transferStopId}|${r.second?.destinationStop?.id}`;
    return `${r.operator}|${r.route}|${r.originStop?.id}|${r.destinationStop?.id}`;
  }

  function dedupe(rows){
    const m=new Map();
    for(const r of rows||[]){const k=routeKey(r);if(!m.has(k))m.set(k,r);}
    return [...m.values()];
  }

  async function generateBroadCandidates(from,to){
    const origin=areaStops(from,ORIGIN_RADIUS),dest=areaStops(to,DEST_RADIUS);
    let rows=[];
    if(typeof ensureJourneyIndexes==="function")await ensureJourneyIndexes();
    if(journeyState.kmbIndex){
      rows.push(...directFromIndex(journeyState.kmbIndex,origin.filter(x=>x.operator==="KMB"),dest.filter(x=>x.operator==="KMB")));
      rows.push(...oneTransferFromIndex(journeyState.kmbIndex,origin.filter(x=>x.operator==="KMB"),dest.filter(x=>x.operator==="KMB")));
    }
    if(journeyState.ctbIndex){
      rows.push(...directFromIndex(journeyState.ctbIndex,origin.filter(x=>x.operator==="CTB"),dest.filter(x=>x.operator==="CTB")));
      rows.push(...oneTransferFromIndex(journeyState.ctbIndex,origin.filter(x=>x.operator==="CTB"),dest.filter(x=>x.operator==="CTB")));
    }
    if(typeof gmbDirect==="function"){try{rows.push(...await gmbDirect(origin,dest));}catch{}}
    return dedupe(rows);
  }

  async function finalViabilityFilter(rows,myToken){
    const out=[];
    for(const r of rows.slice(0,80)){
      if(myToken!==token)return [];
      if(r.operator==="MTR"||r._dzMtrFallback||r._dzCatchment){out.push(r);continue;}
      if(r.kind==="transfer"){
        const firstEta=await etaForLeg(r.first,r.first?.originStop?.id);
        if(!firstEta)continue;
        r.firstEta=firstEta;r.eta=firstEta;
        // Candidate-first principle: the second leg is a future boarding event.
        // Keep it unless there is positive evidence it is unavailable.
        const secondEta=await etaForLeg(r.second,r.transferStopId);
        r.secondEta=secondEta||null;
        r._dzFutureTransfer=!secondEta;
        out.push(r);
        continue;
      }
      if(r.operator==="GMB"){
        const eta=typeof journeyEta==="function"?await journeyEta(r):null;
        if(eta){r.eta=eta;out.push(r);}continue;
      }
      const eta=await etaForLeg(r,r.originStop?.id);
      if(eta){r.eta=eta;out.push(r);}
    }
    return dedupe(out);
  }

  if(typeof runJourneySearch!=="function")return;
  const previous=runJourneySearch;
  runJourneySearch=async function(){
    const myToken=++token;
    const from=$("#journeyFrom")?.value.trim()||"",to=$("#journeyTo")?.value.trim()||"";
    await previous();
    if(myToken!==token||!from||!to)return;

    // Always preserve candidates already found, then add a broad candidate pool.
    let pool=[...(journeyState.results||[])];
    try{pool.push(...await generateBroadCandidates(from,to));}catch{}
    pool=dedupe(pool);

    const viable=await finalViabilityFilter(pool,myToken);
    if(myToken!==token)return;
    if(viable.length){
      journeyState.results=viable.slice(0,20);
      try{renderJourneyResults();}catch{}
      const st=$("#journeyStatus");
      if(st)st.textContent=`先建立 ${pool.length} 個可能方案，再於最後一層按現時可出發狀態篩選，保留 ${viable.length} 個方案。第二程屬未來轉車，暫時無 ETA 不會提早刪除。`;
    }
  };

  window.dzCandidateFirstRouting={version:"3.7.3"};
})();