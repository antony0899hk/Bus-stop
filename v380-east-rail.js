(() => {
  "use strict";
  const $=s=>document.querySelector(s);
  const extra=window.dzExtraTransit;
  const LINE="EAL";
  const ACCESS_RADIUS=1200;
  const STATION_RADIUS=520;
  const DEST_RADIUS=1400;
  const MAX_START_DISTANCE=6500;
  const MAX_SCAN=8;
  const EXTRA_SCAN=4;
  const EARLY_STOP_MARGIN=22;
  const EAL_COORDS={
    ADM:[22.2795,114.1654],EXC:[22.2831,114.1731],HUH:[22.3030,114.1810],MKK:[22.3213,114.1726],KOT:[22.3369,114.1761],TAW:[22.3727,114.1786],SHT:[22.3810,114.1870],FOT:[22.3952,114.1983],RAC:[22.4007,114.2021],UNI:[22.4134,114.2101],TAP:[22.4445,114.1706],TWO:[22.4511,114.1612],FAN:[22.4920,114.1392],SHS:[22.5011,114.1279],LOW:[22.5284,114.1132],LMC:[22.5159,114.0657]
  };

  const geoStops=()=>typeof allJourneyStops==="function"?allJourneyStops().filter(s=>Number.isFinite(s.lat)&&Number.isFinite(s.lon)):[];
  const dist=(a,b)=>a&&b&&typeof distanceMeters==="function"?distanceMeters(a.lat,a.lon,b.lat,b.lon):Infinity;
  function centroid(a){const x=(a||[]).filter(s=>Number.isFinite(s.lat)&&Number.isFinite(s.lon));if(!x.length)return null;return{lat:x.reduce((n,s)=>n+s.lat,0)/x.length,lon:x.reduce((n,s)=>n+s.lon,0)/x.length};}
  function around(point,radius,limit=40){if(!point)return[];return geoStops().map(s=>({...s,distance:dist(point,s)})).filter(s=>s.distance<=radius).sort((a,b)=>a.distance-b.distance).slice(0,limit);}
  function stationCoords(st){const fixed=EAL_COORDS[String(st?.code||"").toUpperCase()];if(fixed)return{lat:fixed[0],lon:fixed[1]};const q=String(st?.name_tc||"").replace(/站$/,'');if(!q)return null;const hits=geoStops().filter(s=>String(s.name||"").includes(q));return hits.length?centroid(hits):null;}
  function lineStations(){
    if(!extra?.mtrRows?.length)return[];
    const groups=new Map();
    for(const r of extra.mtrRows.filter(x=>String(x.line).toUpperCase()===LINE)){
      const k=String(r.dir||"");if(!groups.has(k))groups.set(k,[]);groups.get(k).push(r);
    }
    const lists=[...groups.values()].map(a=>a.sort((x,y)=>x.seq-y.seq)).sort((a,b)=>b.length-a.length);
    const raw=lists[0]||[];const seen=new Set();
    return raw.filter(r=>{if(seen.has(r.code))return false;seen.add(r.code);return true;}).map(r=>extra.mtrStations.get(r.code)||r);
  }
  function expandDestination(value){const base=typeof resolvePlace==="function"?resolvePlace(value,null):[];const c=centroid(base);if(!c)return base;const more=around(c,DEST_RADIUS,60),m=new Map();[...base,...more].forEach(s=>m.set(`${s.operator}|${s.id}`,s));return[...m.values()];}
  function originData(from){const loc=journeyState?.originLocation;if(loc)return{point:loc,stops:around(loc,ACCESS_RADIUS,40)};const stops=typeof resolvePlace==="function"?resolvePlace(from,null):[];return{point:centroid(stops),stops};}
  function nearestStation(point,list){let best=null;for(let i=0;i<list.length;i++){const c=stationCoords(list[i]);if(!c)continue;const d=dist(point,c);if(!best||d<best.distance)best={station:list[i],coords:c,index:i,distance:d};}return best;}

  function localBus(origin,dest){const out=[];try{if(journeyState?.kmbIndex)out.push(...directFromIndex(journeyState.kmbIndex,origin,dest));}catch{};try{if(journeyState?.ctbIndex)out.push(...directFromIndex(journeyState.ctbIndex,origin,dest));}catch{};return out;}
  async function withEta(r){try{if(typeof journeyEta==="function")r.eta=await journeyEta(r);}catch{}return r;}
  function futureLegCost(r){if(!r)return 999;return 7+Number(r.stopCount||0)*1.7+Number(r.walkMeters||0)/80;}
  function accessLegCost(r){const wait=r?.eta&&typeof etaMinutes==="function"?Math.max(0,etaMinutes(r.eta)):9;return wait+Number(r?.stopCount||0)*1.7+Number(r?.walkMeters||0)/80;}
  async function bestAccess(origin,dest){let rows=localBus(origin,dest).slice(0,10);try{if(rows.length<2&&typeof gmbDirect==="function")rows.push(...await gmbDirect(origin,dest));}catch{};await Promise.all(rows.slice(0,5).map(withEta));rows=rows.filter(r=>r.eta).sort((a,b)=>accessLegCost(a)-accessLegCost(b));return rows[0]||null;}
  async function bestLastMile(origin,dest,allowGmb=true){let rows=localBus(origin,dest).slice(0,12);try{if(allowGmb&&rows.length<2&&typeof gmbDirect==="function")rows.push(...await gmbDirect(origin,dest));}catch{};rows.sort((a,b)=>futureLegCost(a)-futureLegCost(b));return rows[0]||null;}

  async function accessPlan(originPoint,originStops,start){
    const stationStops=around(start.coords,STATION_RADIUS,28);
    if(start.distance<=950)return{kind:"walk",station:start.station,coords:start.coords,walkMeters:start.distance,cost:start.distance/80};
    const leg=await bestAccess(originStops,stationStops);if(!leg)return null;
    return{kind:"transit",station:start.station,coords:start.coords,leg,cost:accessLegCost(leg)};
  }
  function scanIndexes(startIndex,targetIndex,length){
    const dir=targetIndex>=startIndex?1:-1,out=[];let i=startIndex+dir;
    while(i>=0&&i<length&&out.length<MAX_SCAN){out.push(i);i+=dir;}
    return{indexes:out,dir,next:i};
  }
  async function exitPlan(station,coords,destinationStops,destPoint,allowGmb){
    const sd=dist(coords,destPoint);
    if(sd<=1050)return{kind:"walk",station,coords,walkMeters:sd,cost:sd/80};
    const stationStops=around(coords,STATION_RADIUS,28);if(!stationStops.length)return null;
    const leg=await bestLastMile(stationStops,destinationStops,allowGmb);if(!leg)return null;
    return{kind:"transit",station,coords,leg,cost:futureLegCost(leg)};
  }
  function makeChain(access,startIdx,exitIdx,exit,stations){
    const railStops=Math.abs(exitIdx-startIdx),railCost=4+railStops*2.8,total=access.cost+railCost+exit.cost;
    const route=[access.leg?.route,"EAL",exit.leg?.route].filter(Boolean).join(" → ");
    return{kind:"east_rail_chain",operator:"MTR",route,transferCount:(access.kind==="transit"?1:0)+(exit.kind==="transit"?1:0),stopCount:railStops+Number(access.leg?.stopCount||0)+Number(exit.leg?.stopCount||0),walkMeters:Number(access.walkMeters||access.leg?.walkMeters||0)+Number(exit.walkMeters||exit.leg?.walkMeters||0),eta:access.leg?.eta||null,originStop:access.leg?.originStop||{id:stations[startIdx].code,name:stations[startIdx].name_tc},destinationStop:exit.leg?.destinationStop||{id:stations[exitIdx].code,name:stations[exitIdx].name_tc},_dzEastRail:true,_dzEastRailTotal:total,_dzAccess:access,_dzExit:exit,_dzRailStops:railStops,_dzStart:stations[startIdx],_dzExitStation:stations[exitIdx]};
  }

  async function build(from,to){
    if(typeof extra?.ensureMtrData==="function")await extra.ensureMtrData();
    const stations=lineStations();if(stations.length<3)return[];
    const o=originData(from),dest=expandDestination(to),dp=centroid(dest);if(!o.point||!o.stops.length||!dp||!dest.length)return[];
    const start=nearestStation(o.point,stations);if(!start||start.distance>MAX_START_DISTANCE)return[];
    const target=nearestStation(dp,stations);if(!target||target.index===start.index)return[];
    const access=await accessPlan(o.point,o.stops,start);if(!access)return[];
    const plan=scanIndexes(start.index,target.index,stations.length),rows=[];let best=Infinity;
    async function scanOne(idx,rank){const st=stations[idx],c=stationCoords(st);if(!c)return;const rail=4+Math.abs(idx-start.index)*2.8;if(rows.length>=3&&rail>best+EARLY_STOP_MARGIN)return;const exit=await exitPlan(st,c,dest,dp,rank<4);if(!exit)return;const chain=makeChain(access,start.index,idx,exit,stations);rows.push(chain);best=Math.min(best,chain._dzEastRailTotal);}
    for(let n=0;n<plan.indexes.length;n++)await scanOne(plan.indexes[n],n);
    if(rows.length<2){let i=plan.next;for(let n=0;n<EXTRA_SCAN&&i>=0&&i<stations.length;n++,i+=plan.dir)await scanOne(i,MAX_SCAN+n);}
    const seen=new Set();return rows.sort((a,b)=>a._dzEastRailTotal-b._dzEastRailTotal).filter(r=>{const k=`${r._dzExitStation.code}|${r._dzExit.leg?.operator||'W'}|${r._dzExit.leg?.route||'W'}`;if(seen.has(k))return false;seen.add(k);return true;}).slice(0,4);
  }
  function shouldHandle(from,to){
    if(!to||!extra?.mtrRows?.some(x=>String(x.line).toUpperCase()===LINE))return false;
    const stations=lineStations(),o=originData(from);if(!o.point||!stations.length)return false;const n=nearestStation(o.point,stations);return !!n&&n.distance<=MAX_START_DISTANCE;
  }
  function render(c){const a=c._dzAccess,e=c._dzExit,mins=Math.max(1,Math.round(c._dzEastRailTotal));const access=a.kind==="walk"?`步行 → ${a.station.name_tc}`:`${a.leg.route} → ${a.station.name_tc}`;const exit=e.kind==="walk"?`${e.station.name_tc} → 步行`:`${e.station.name_tc} → ${e.leg.route}`;return `<article class="journey-card journey-mtr-card"><div class="journey-rank">🚇</div><div class="journey-main"><div class="journey-top"><div><span class="badge mtr">東鐵</span> <strong class="journey-route">${escapeHtml(c.route||'EAL')}</strong></div><div class="journey-eta">約 ${mins} 分</div></div><div class="journey-title">${escapeHtml(access)} → 東鐵綫 → ${escapeHtml(exit)}</div><div class="journey-meta">Line-first：${escapeHtml(c._dzStart.name_tc)} → ${escapeHtml(c._dzExitStation.name_tc)} · 東鐵約 ${c._dzRailStops} 站${c.walkMeters?` · 步行約 ${Math.round(c.walkMeters)}m`:''}</div><div class="journey-note">先鎖定最近東鐵站，只掃同一方向最多 ${MAX_SCAN} 個站；每個站再用巴士／小巴搜尋最後一程，明顯落後會提早停止。</div></div></article>`;}

  window.dzEastRailEngine={version:"3.8.0",line:LINE,build,shouldHandle};

  if(typeof runJourneySearch==="function"){
    const previous=runJourneySearch;
    runJourneySearch=async function(){const from=$("#journeyFrom")?.value.trim()||"",to=$("#journeyTo")?.value.trim()||"";await previous();journeyState.results=journeyState.results.filter(r=>!r?._dzEastRail);try{if(typeof extra?.ensureMtrData==="function")await extra.ensureMtrData();}catch{}if(!shouldHandle(from,to))return;const rows=await build(from,to).catch(()=>[]);journeyState.results=journeyState.results.filter(r=>!r?._dzMtrChain);if(rows.length)journeyState.results.push(...rows);try{renderJourneyResults();}catch{};const st=$("#journeyStatus");if(st)st.textContent=`${st.textContent||''}；東鐵 Line-first 掃描 ${rows.length?`找到 ${rows.length} 個方案`:'暫無合適方案'}。`;};
  }
  if(typeof renderJourneyResults==="function"){
    const old=renderJourneyResults;renderJourneyResults=function(){const rows=(journeyState?.results||[]).filter(r=>r?._dzEastRail);if(!rows.length)return old();const original=journeyState.results;journeyState.results=original.filter(r=>!r?._dzEastRail);old();journeyState.results=original;const box=$("#journeyResults");if(box)rows.sort((a,b)=>a._dzEastRailTotal-b._dzEastRailTotal).forEach(r=>box.insertAdjacentHTML("beforeend",render(r)));};
  }
})();
