(() => {
  "use strict";

  const $ = s => document.querySelector(s);
  const ORIGIN_RADIUS = 1800;
  const DEST_RADIUS = 2200;
  const MAX_RAW = 90;
  const MAX_FINAL = 16;
  let token = 0;

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
      .filter(s=>s.distance<=radius)
      .sort((a,b)=>a.distance-b.distance);
    const m=new Map();
    [...base,...all].forEach(s=>{const k=`${s.operator}|${s.id}`;const old=m.get(k);if(!old||Number(s.distance||0)<Number(old.distance||0))m.set(k,s);});
    return [...m.values()].sort((a,b)=>Number(a.distance||0)-Number(b.distance||0)).slice(0,72);
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
      if(leg.operator==="GMB"&&typeof journeyEta==="function") return await journeyEta(leg);
    }catch{}
    return null;
  }

  function rawCandidates(origin,dest){
    const rows=[];
    if(journeyState.kmbIndex){
      rows.push(...directFromIndex(journeyState.kmbIndex,origin.filter(x=>x.operator==="KMB"),dest.filter(x=>x.operator==="KMB")));
      rows.push(...oneTransferFromIndex(journeyState.kmbIndex,origin.filter(x=>x.operator==="KMB"),dest.filter(x=>x.operator==="KMB")));
    }
    if(journeyState.ctbIndex){
      rows.push(...directFromIndex(journeyState.ctbIndex,origin.filter(x=>x.operator==="CTB"),dest.filter(x=>x.operator==="CTB")));
      rows.push(...oneTransferFromIndex(journeyState.ctbIndex,origin.filter(x=>x.operator==="CTB"),dest.filter(x=>x.operator==="CTB")));
    }
    return rows;
  }

  function candidateKey(r){
    if(r.kind==="transfer") return `${r.first?.operator}|${r.first?.route}|${r.first?.originStop?.id}>${r.second?.operator}|${r.second?.route}|${r.transferStopId}|${r.second?.destinationStop?.id}`;
    return `${r.operator}|${r.route}|${r.originStop?.id}|${r.destinationStop?.id}`;
  }

  function dedupe(rows){
    const m=new Map();
    for(const r of rows||[]){const k=candidateKey(r);if(!m.has(k))m.set(k,r);}
    return [...m.values()];
  }

  // Final-stage service policy: generate first, prune only when a route is confirmed unusable.
  // Unknown service state is retained (lower priority) so temporary ETA gaps do not erase valid paths.
  async function finalServiceFilter(rows,myToken){
    const out=[];
    for(const r of rows.slice(0,MAX_RAW)){
      if(myToken!==token)return [];
      if(r.operator==="MTR"||r._dzMtrFallback){r._dzServiceState="rail";out.push(r);continue;}
      if(r.kind==="transfer"){
        const firstEta=await etaForLeg(r.first,r.first?.originStop?.id);
        if(firstEta){
          r.firstEta=firstEta;r.eta=firstEta;r._dzServiceState="confirmed";
          r.secondEta=await etaForLeg(r.second,r.transferStopId);
          r._dzSecondServiceState=r.secondEta?"confirmed":"future-unknown";
          out.push(r);
        }else{
          // Keep as low-priority unknown candidate; do not delete solely because ETA is temporarily absent.
          r._dzServiceState="unknown";r._dzServicePenalty=4500;out.push(r);
        }
      }else{
        const eta=await etaForLeg(r,r.originStop?.id);
        if(eta){r.eta=eta;r._dzServiceState="confirmed";out.push(r);}
        else {r._dzServiceState="unknown";r._dzServicePenalty=5000;out.push(r);}
      }
    }
    return out;
  }

  if(typeof runJourneySearch!=="function")return;
  const previous=runJourneySearch;
  runJourneySearch=async function(){
    const myToken=++token;
    const from=$("#journeyFrom")?.value.trim()||"",to=$("#journeyTo")?.value.trim()||"";
    if(!from||!to)return previous();
    await previous();
    if(myToken!==token)return;
    try{await ensureJourneyIndexes();}catch{}
    const origin=areaStops(from,ORIGIN_RADIUS),dest=areaStops(to,DEST_RADIUS);
    let raw=dedupe([...(journeyState.results||[]),...rawCandidates(origin,dest)]);
    if(typeof gmbDirect==="function"){try{raw=dedupe([...raw,...await gmbDirect(origin,dest)]);}catch{}}
    const filtered=await finalServiceFilter(raw,myToken);if(myToken!==token)return;
    const baseScore=typeof journeyScore==="function"?journeyScore:r=>0;
    journeyScore=r=>baseScore(r)+Number(r._dzServicePenalty||0);
    journeyState.results=dedupe(filtered).sort((a,b)=>journeyScore(a)-journeyScore(b)).slice(0,MAX_FINAL);
    try{renderJourneyResults();}catch{}
    const confirmed=journeyState.results.filter(r=>r._dzServiceState==="confirmed"||r._dzServiceState==="rail").length;
    const unknown=journeyState.results.length-confirmed;
    const st=$("#journeyStatus");
    if(st)st.textContent=`先建立所有可能途徑，再於最後一層檢查服務狀態：${confirmed} 個已確認可行${unknown?`，${unknown} 個班次暫未確認（已降權）`:""}。`;
  };

  window.dzCandidateLastFilter={version:"3.7.3"};
})();