(() => {
  "use strict";
  const ACCESS_RADII=[300,500,800,1000,1500];
  const DEST_RADIUS=1400;
  const $=s=>document.querySelector(s);
  const extra=window.dzExtraTransit;

  function allGeoStops(){return typeof allJourneyStops==="function"?allJourneyStops().filter(s=>Number.isFinite(s.lat)&&Number.isFinite(s.lon)):[];}
  function centroid(stops){const a=stops.filter(s=>Number.isFinite(s.lat)&&Number.isFinite(s.lon));if(!a.length)return null;return {lat:a.reduce((n,s)=>n+s.lat,0)/a.length,lon:a.reduce((n,s)=>n+s.lon,0)/a.length};}
  function expandedOrigin(location){
    if(!location)return [];
    const stops=allGeoStops().map(s=>({...s,distance:distanceMeters(location.lat,location.lon,s.lat,s.lon)})).sort((a,b)=>a.distance-b.distance);
    for(const r of ACCESS_RADII){const hit=stops.filter(s=>s.distance<=r).slice(0,28);if(hit.length>=6||r===ACCESS_RADII[ACCESS_RADII.length-1])return hit;}
    return [];
  }
  function destinationCluster(value){
    const base=resolvePlace(value,null);
    const c=centroid(base);
    if(!c)return base;
    const nearby=allGeoStops().map(s=>({...s,distance:distanceMeters(c.lat,c.lon,s.lat,s.lon)})).filter(s=>s.distance<=DEST_RADIUS);
    const m=new Map();[...base,...nearby].forEach(s=>{const k=`${s.operator}|${s.id}`;if(!m.has(k)||(s.distance||0)<(m.get(k).distance||0))m.set(k,s);});
    return [...m.values()].sort((a,b)=>(a.distance||0)-(b.distance||0)).slice(0,44);
  }
  function progressPenalty(r,originCenter,destCenter){
    if(!originCenter||!destCenter)return 0;
    let p=null;
    if(r.kind==="transfer"){
      const op=r.first?.operator, id=r.first?.transferStopId||r.transferStopId;
      const map=op==="KMB"?state.kmbStops:op==="CTB"?state.ctbStops:state.gmbStops;
      const s=map?.get(String(id)); if(s)p={lat:Number(s.lat??s.latitude),lon:Number(s.long??s.lng??s.longitude)};
    }else if(r.destinationStop)p={lat:r.destinationStop.lat,lon:r.destinationStop.lon};
    if(!p||!Number.isFinite(p.lat)||!Number.isFinite(p.lon))return 0;
    const start=distanceMeters(originCenter.lat,originCenter.lon,destCenter.lat,destCenter.lon);
    const remain=distanceMeters(p.lat,p.lon,destCenter.lat,destCenter.lon);
    if(remain>start*1.08)return 2500+Math.round((remain-start)/20);
    return -Math.max(0,Math.round((start-remain)/80));
  }
  function stationCoords(st){
    const q=String(st?.name_tc||"").replace(/站$/,''); if(!q)return null;
    const hits=allGeoStops().filter(s=>String(s.name||"").includes(q)); if(!hits.length)return null;
    return {lat:hits.reduce((n,s)=>n+s.lat,0)/hits.length,lon:hits.reduce((n,s)=>n+s.lon,0)/hits.length};
  }
  function nearestMtrStations(point,max=1800){
    if(!extra?.mtrStations||!point)return [];
    const out=[]; for(const s of extra.mtrStations.values()){const c=stationCoords(s);if(!c)continue;const d=distanceMeters(point.lat,point.lon,c.lat,c.lon);if(d<=max)out.push({station:s,coords:c,distance:d});}
    return out.sort((a,b)=>a.distance-b.distance).slice(0,5);
  }
  function shortestMtr(starts,ends){
    if(!extra?.mtrGraph)return null; const targets=new Set(ends.map(x=>x.station.code)),q=starts.map(x=>({code:x.station.code,path:[x.station.code],lines:[]})),seen=new Set(q.map(x=>x.code));
    while(q.length){const cur=q.shift();if(targets.has(cur.code))return cur;for(const e of extra.mtrGraph.get(cur.code)||[]){if(seen.has(e.to))continue;seen.add(e.to);q.push({code:e.to,path:[...cur.path,e.to],lines:[...cur.lines,e.line]});}}
    return null;
  }
  async function addRailCatchment(originCenter,destCenter){
    if(!extra?.mtrRows?.length||!originCenter||!destCenter)return false;
    const starts=nearestMtrStations(originCenter,1800), ends=nearestMtrStations(destCenter,1800); if(!starts.length||!ends.length)return false;
    const path=shortestMtr(starts,ends); if(!path)return false;
    const o=extra.mtrStations.get(path.path[0]),d=extra.mtrStations.get(path.path[path.path.length-1]); if(!o||!d)return false;
    const lines=[];path.lines.forEach(l=>{if(l&&lines[lines.length-1]!==l)lines.push(l);});
    const c={kind:"direct",operator:"MTR",route:lines.join(" → ")||"港鐵",transferCount:Math.max(0,lines.length-1),stopCount:Math.max(1,path.path.length-1),walkMeters:(starts.find(x=>x.station.code===o.code)?.distance||0)+(ends.find(x=>x.station.code===d.code)?.distance||0),originStop:{id:o.code,name:o.name_tc},destinationStop:{id:d.code,name:d.name_tc},eta:null,fare:null,_dzMtrFallback:true,_dzCatchment:true};
    const dup=journeyState.results.some(r=>r.operator==="MTR"&&r.originStop?.id===c.originStop.id&&r.destinationStop?.id===c.destinationStop.id); if(!dup)journeyState.results.push(c); return true;
  }

  if(typeof runJourneySearch!=="function")return;
  const previous=runJourneySearch;
  runJourneySearch=async function(){
    const from=$("#journeyFrom")?.value.trim()||"",to=$("#journeyTo")?.value.trim()||"";
    const loc=journeyState?.originLocation;
    await previous();
    const origin=loc?expandedOrigin(loc):resolvePlace(from,null);
    const dest=destinationCluster(to);
    const oc=loc||centroid(origin), dc=centroid(dest);
    try{
      if(typeof gmbDirect==="function"){
        const g=await gmbDirect(origin,dest); for(const r of g){r._dzProgress=progressPenalty(r,oc,dc);const eta=await journeyEta(r);if(eta){r.eta=eta;journeyState.results.push(r);}}
      }
    }catch{}
    try{await addRailCatchment(oc,dc);}catch{}
    journeyState.results.forEach(r=>{if(r._dzProgress==null)r._dzProgress=progressPenalty(r,oc,dc);});
    const baseScore=typeof journeyScore==="function"?journeyScore:r=>0;
    journeyScore=r=>baseScore(r)+Number(r._dzProgress||0);
    try{renderJourneyResults();}catch{}
    const st=$("#journeyStatus");
    if(st&&journeyState.results.length)st.textContent=`已按起點逐層擴大至最多 1.5km，並以「向目的地收斂」重新排序 ${journeyState.results.length} 個可行方案。`;
  };
})();