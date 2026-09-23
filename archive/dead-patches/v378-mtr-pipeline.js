(() => {
  "use strict";
  const extra = window.dzExtraTransit;
  const $ = s => document.querySelector(s);
  const ACCESS_STOP_RADIUS = 1000;
  const STATION_STOP_RADIUS = 500;
  const DEST_CLUSTER_RADIUS = 1400;
  const ACCESS_STATION_MAX = 5500;
  const EXIT_STATION_MAX = 7000;

  function geoStops(){
    return typeof allJourneyStops === "function" ? allJourneyStops().filter(s=>Number.isFinite(s.lat)&&Number.isFinite(s.lon)) : [];
  }
  function dist(a,b){
    if(!a||!b||typeof distanceMeters!=="function")return Infinity;
    return distanceMeters(a.lat,a.lon,b.lat,b.lon);
  }
  function centroid(stops){
    const a=(stops||[]).filter(s=>Number.isFinite(s.lat)&&Number.isFinite(s.lon));
    if(!a.length)return null;
    return {lat:a.reduce((n,s)=>n+s.lat,0)/a.length,lon:a.reduce((n,s)=>n+s.lon,0)/a.length};
  }
  function around(point,radius,limit=40){
    if(!point)return [];
    return geoStops().map(s=>({...s,distance:dist(point,s)})).filter(s=>s.distance<=radius).sort((a,b)=>a.distance-b.distance).slice(0,limit);
  }
  function expandDestination(value){
    const base=typeof resolvePlace==="function"?resolvePlace(value,null):[];
    const c=centroid(base); if(!c)return base;
    const more=around(c,DEST_CLUSTER_RADIUS,60); const m=new Map();
    [...base,...more].forEach(s=>{const k=`${s.operator}|${s.id}`;if(!m.has(k)||(s.distance||0)<(m.get(k).distance||0))m.set(k,s);});
    return [...m.values()];
  }
  function stationCoords(st){
    const q=String(st?.name_tc||"").replace(/站$/,''); if(!q)return null;
    const hits=geoStops().filter(s=>String(s.name||"").includes(q)); if(!hits.length)return null;
    return centroid(hits);
  }
  function stationList(point,max){
    if(!extra?.mtrStations?.size||!point)return [];
    const out=[];
    for(const s of extra.mtrStations.values()){
      const c=stationCoords(s); if(!c)continue;
      const d=dist(point,c); if(d<=max)out.push({station:s,coords:c,distance:d});
    }
    return out.sort((a,b)=>a.distance-b.distance);
  }
  function shortestRail(a,b){
    if(!extra?.mtrGraph?.size)return null;
    const q=[{code:a,path:[a],lines:[]}],seen=new Set([a]);
    while(q.length){const cur=q.shift();if(cur.code===b)return cur;for(const e of extra.mtrGraph.get(cur.code)||[]){if(seen.has(e.to))continue;seen.add(e.to);q.push({code:e.to,path:[...cur.path,e.to],lines:[...cur.lines,e.line]});}}
    return null;
  }
  function compactLines(lines){const out=[];(lines||[]).forEach(x=>{if(x&&out[out.length-1]!==x)out.push(x)});return out;}

  async function busDirect(origin,dest){
    const out=[];
    try{if(typeof ensureJourneyIndexes==="function")await ensureJourneyIndexes();}catch{}
    try{if(typeof directFromIndex==="function"&&journeyState?.kmbIndex)out.push(...directFromIndex(journeyState.kmbIndex,origin,dest));}catch{}
    try{if(typeof directFromIndex==="function"&&journeyState?.ctbIndex)out.push(...directFromIndex(journeyState.ctbIndex,origin,dest));}catch{}
    try{if(typeof gmbDirect==="function")out.push(...await gmbDirect(origin,dest));}catch{}
    return out;
  }
  async function withEta(r){
    if(!r)return null;
    try{if(typeof journeyEta==="function")r.eta=await journeyEta(r);}catch{}
    return r;
  }
  function legCost(r){
    if(!r)return 999;
    const eta=r.eta&&typeof etaMinutes==="function"?Math.max(0,etaMinutes(r.eta)):12;
    return eta + Number(r.stopCount||0)*1.8 + Number(r.walkMeters||0)/80;
  }
  async function bestDirect(origin,dest){
    const c=(await busDirect(origin,dest)).slice(0,16);
    await Promise.all(c.slice(0,8).map(withEta));
    c.sort((a,b)=>legCost(a)-legCost(b));
    return c[0]||null;
  }

  async function accessPlans(originPoint,originStops){
    const plans=[];
    for(const x of stationList(originPoint,ACCESS_STATION_MAX).slice(0,6)){
      const stationStops=around(x.coords,STATION_STOP_RADIUS,30);
      if(x.distance<=1100)plans.push({station:x.station,coords:x.coords,kind:"walk",walkMeters:x.distance,cost:x.distance/80});
      const feeder=await bestDirect(originStops,stationStops);
      if(feeder)plans.push({station:x.station,coords:x.coords,kind:"transit",leg:feeder,cost:legCost(feeder)});
    }
    const best=new Map();for(const p of plans){const k=p.station.code;if(!best.has(k)||p.cost<best.get(k).cost)best.set(k,p);}return [...best.values()].sort((a,b)=>a.cost-b.cost).slice(0,4);
  }
  async function exitPlans(destPoint,destinationStops){
    const plans=[];
    for(const x of stationList(destPoint,EXIT_STATION_MAX).slice(0,14)){
      const stationStops=around(x.coords,STATION_STOP_RADIUS,30);
      if(x.distance<=1400)plans.push({station:x.station,coords:x.coords,kind:"walk",walkMeters:x.distance,cost:x.distance/80});
      const last=await bestDirect(stationStops,destinationStops);
      if(last)plans.push({station:x.station,coords:x.coords,kind:"transit",leg:last,cost:legCost(last)});
    }
    const best=new Map();for(const p of plans){const k=p.station.code;if(!best.has(k)||p.cost<best.get(k).cost)best.set(k,p);}return [...best.values()].sort((a,b)=>a.cost-b.cost).slice(0,8);
  }

  function makeChain(a,e,path,destPoint){
    const lines=compactLines(path.lines), railStops=Math.max(1,path.path.length-1), railTransfers=Math.max(0,lines.length-1);
    const railCost=railStops*2.1+railTransfers*5;
    const total=a.cost+railCost+e.cost;
    const first=a.leg, last=e.leg;
    const route=[first?.route, lines.join(" → ")||"MTR", last?.route].filter(Boolean).join(" → ");
    return {
      kind:"mtr_chain",operator:"MTR",route,transferCount:(a.kind==="transit"?1:0)+railTransfers+(e.kind==="transit"?1:0),stopCount:railStops+Number(first?.stopCount||0)+Number(last?.stopCount||0),walkMeters:Number(a.walkMeters||first?.walkMeters||0)+Number(e.walkMeters||last?.walkMeters||0),eta:first?.eta||null,
      originStop:first?.originStop||{id:a.station.code,name:a.station.name_tc},destinationStop:last?.destinationStop||{id:e.station.code,name:e.station.name_tc},
      _dzMtrChain:true,_dzMtrTotal:total,_dzAccess:a,_dzExit:e,_dzRailPath:path.path,_dzRailLines:lines,_dzDestPoint:destPoint
    };
  }

  async function buildMtrChains(from,to){
    if(!extra?.mtrStations?.size||!extra?.mtrGraph?.size)return [];
    const loc=journeyState?.originLocation;
    let originStops,op;
    if(loc){op=loc;originStops=around(loc,ACCESS_STOP_RADIUS,36);}else{originStops=typeof resolvePlace==="function"?resolvePlace(from,null):[];op=centroid(originStops);}
    const destinationStops=expandDestination(to),dp=centroid(destinationStops);
    if(!op||!dp||!originStops.length||!destinationStops.length)return [];
    const [access,exits]=await Promise.all([accessPlans(op,originStops),exitPlans(dp,destinationStops)]);
    const chains=[];
    for(const a of access)for(const e of exits){if(a.station.code===e.station.code)continue;const path=shortestRail(a.station.code,e.station.code);if(!path)continue;chains.push(makeChain(a,e,path,dp));}
    const seen=new Set();return chains.sort((a,b)=>a._dzMtrTotal-b._dzMtrTotal).filter(c=>{const k=`${c._dzAccess.station.code}|${c._dzExit.station.code}|${c._dzAccess.leg?.route||'W'}|${c._dzExit.leg?.route||'W'}`;if(seen.has(k))return false;seen.add(k);return true;}).slice(0,3);
  }

  function renderChain(c){
    const a=c._dzAccess,e=c._dzExit;const access=a.kind==="walk"?`步行 → ${a.station.name_tc}`:`${a.leg.route} → ${a.station.name_tc}`;
    const exit=e.kind==="walk"?`${e.station.name_tc} → 步行`:`${e.station.name_tc} → ${e.leg.route}`;
    const mins=Math.max(1,Math.round(c._dzMtrTotal));
    return `<article class="journey-card journey-mtr-card"><div class="journey-rank">🚇</div><div class="journey-main"><div class="journey-top"><div><span class="badge mtr">MTR</span> <strong class="journey-route">${escapeHtml(c.route)}</strong></div><div class="journey-eta">約 ${mins} 分</div></div><div class="journey-title">${escapeHtml(access)} → ${escapeHtml(c._dzRailLines.join(' → ')||'港鐵')} → ${escapeHtml(exit)}</div><div class="journey-meta">Gateway：${escapeHtml(a.station.name_tc)} → ${escapeHtml(e.station.name_tc)} · 約 ${c.stopCount} 站${c.walkMeters?` · 步行約 ${Math.round(c.walkMeters)}m`:''}</div><div class="journey-note">港鐵獨立搜尋：會比較最近站同可快速接駁目的地嘅 Gateway Station，再按完整行程時間排序。</div></div></article>`;
  }

  if(typeof runJourneySearch==="function"){
    const previous=runJourneySearch;
    runJourneySearch=async function(){
      const from=$("#journeyFrom")?.value.trim()||"",to=$("#journeyTo")?.value.trim()||"";
      await previous();
      if(window.dzEastRailEngine?.shouldHandle?.(from,to)){
        journeyState.results=journeyState.results.filter(r=>!r?._dzMtrChain);
        return;
      }
      const chains=await buildMtrChains(from,to).catch(()=>[]);
      journeyState.results=journeyState.results.filter(r=>!r?._dzMtrChain);
      if(chains.length)journeyState.results.push(...chains);
      try{renderJourneyResults();}catch{}
      const st=$("#journeyStatus");if(st&&chains.length)st.textContent=`${st.textContent||''}；另找到 ${chains.length} 個 MTR Gateway 方案。`;
    };
  }

  if(typeof renderJourneyResults==="function"){
    const oldRender=renderJourneyResults;
    renderJourneyResults=function(){
      const chains=(journeyState?.results||[]).filter(r=>r?._dzMtrChain);
      if(!chains.length)return oldRender();
      const original=journeyState.results;journeyState.results=original.filter(r=>!r?._dzMtrChain);oldRender();journeyState.results=original;
      const box=$("#journeyResults");if(box)chains.sort((a,b)=>a._dzMtrTotal-b._dzMtrTotal).forEach(c=>box.insertAdjacentHTML("beforeend",renderChain(c)));
    };
  }

  window.dzMtrPipeline={version:"3.7.8",build:buildMtrChains};
})();