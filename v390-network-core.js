(() => {
  "use strict";
  const $=s=>document.querySelector(s);
  const extra=window.dzExtraTransit;
  const MAJOR_HUBS=["城門隧道","大欖隧道","屯門公路轉車站","粉嶺公路轉車站","大老山隧道","沙田站","大學站","大圍站","九龍塘站","鑽石山站","觀塘站","荃灣站","葵芳站","青衣站","紅磡站","旺角東站"];
  const SPECIAL_ROUTES=new Set(["848"]);
  const norm=v=>String(v||"").replace(/[\s　]+/g,"");
  const pointOfStops=a=>{const x=(a||[]).filter(s=>Number.isFinite(s.lat)&&Number.isFinite(s.lon));if(!x.length)return null;return{lat:x.reduce((n,s)=>n+s.lat,0)/x.length,lon:x.reduce((n,s)=>n+s.lon,0)/x.length};};
  const geoStops=()=>typeof allJourneyStops==="function"?allJourneyStops().filter(s=>Number.isFinite(s.lat)&&Number.isFinite(s.lon)):[];
  const dist=(a,b)=>a&&b&&typeof distanceMeters==="function"?distanceMeters(a.lat,a.lon,b.lat,b.lon):Infinity;
  function around(point,radius,limit=40){if(!point)return[];return geoStops().map(s=>({...s,distance:dist(point,s)})).filter(s=>s.distance<=radius).sort((a,b)=>a.distance-b.distance).slice(0,limit);}
  function originData(from){const loc=journeyState?.originLocation;if(loc)return{point:loc,stops:around(loc,1500,40)};const stops=typeof resolvePlace==="function"?resolvePlace(from,null):[];return{point:pointOfStops(stops),stops};}
  function destinationData(to){const base=typeof resolvePlace==="function"?resolvePlace(to,null):[];const p=pointOfStops(base);return{point:p,stops:p?around(p,1500,70):base};}
  function hubPenalty(name){return MAJOR_HUBS.some(h=>norm(name).includes(norm(h)))?3:6;}
  function walkMinutes(m){m=Math.max(0,Number(m||0));if(m<400)return m/80;if(m<=800)return m/75;return m/70;}
  function etaWait(eta,def=8){try{return eta&&typeof etaMinutes==="function"?Math.max(0,etaMinutes(eta)):def}catch{return def}}
  function generalizedMinutes(r){
    for(const v of [r?._dzGeneralized,r?._dzTotal,r?._dzEastRailTotal,r?._dzMtrTotal,r?.estimatedMinutes]){const n=Number(v);if(Number.isFinite(n)&&n>=0)return n;}
    const walk=walkMinutes(r?.walkMeters);
    if(r?.kind==="transfer"){
      const firstWait=etaWait(r.firstEta||r.eta,8),secondWait=r.secondEta?etaWait(r.secondEta,6):6;
      const ride=(Number(r.first?.stopCount||0)+Number(r.second?.stopCount||0))*1.7;
      const hp=hubPenalty(r.transferStopName||r.transferStopId||"");
      return firstWait+secondWait+ride+walk+hp;
    }
    const base=etaWait(r?.eta,10)+Number(r?.stopCount||0)*1.7+walk;
    return base+Math.max(0,Number(r?.transferCount||0))*5;
  }
  function dominates(a,b){
    const ta=generalizedMinutes(a),tb=generalizedMinutes(b),xa=Number(a?.transferCount||0),xb=Number(b?.transferCount||0),wa=Number(a?.walkMeters||0),wb=Number(b?.walkMeters||0);
    return ta<=tb&&xa<=xb&&wa<=wb&&(ta<tb||xa<xb||wa<wb);
  }
  function dominancePrune(rows){
    const a=(rows||[]).filter(Boolean),out=[];
    for(let i=0;i<a.length;i++){
      let killed=false;for(let j=0;j<a.length;j++){if(i!==j&&dominates(a[j],a[i])){killed=true;break;}}
      if(!killed)out.push(a[i]);
    }
    return out;
  }
  function stationCoords(st){
    if(!st)return null;if(Number.isFinite(st.lat)&&Number.isFinite(st.lon))return{lat:st.lat,lon:st.lon};
    const q=norm(String(st.name_tc||"").replace(/站$/,""));if(!q)return null;
    const hits=geoStops().filter(s=>norm(s.name||s.name_tc||"").includes(q));if(!hits.length)return null;
    return{lat:hits.reduce((n,s)=>n+s.lat,0)/hits.length,lon:hits.reduce((n,s)=>n+s.lon,0)/hits.length};
  }
  function stationStops(st){const p=stationCoords(st);return p?around(p,600,36):[];}
  function lineChanges(lines){let n=0,last=null;for(const l of lines||[]){if(last&&l!==last)n++;last=l;}return n;}
  function weightedMtrPath(start,end){
    if(!extra?.mtrGraph?.size)return null;const q=[{code:start,cost:0,path:[start],lines:[]}],best=new Map([[start,0]]);
    while(q.length){q.sort((a,b)=>a.cost-b.cost);const cur=q.shift();if(cur.code===end)return cur;if(cur.cost>best.get(cur.code))continue;
      for(const e of extra.mtrGraph.get(cur.code)||[]){const last=cur.lines[cur.lines.length-1],change=last&&last!==e.line?4.5:0,cost=cur.cost+2.2+change;if(cost<(best.get(e.to)??Infinity)){best.set(e.to,cost);q.push({code:e.to,cost,path:[...cur.path,e.to],lines:[...cur.lines,e.line]});}}
    }return null;
  }
  async function directRows(origin,dest){
    const out=[];try{if(typeof ensureJourneyIndexes==="function")await ensureJourneyIndexes();}catch{}
    try{if(journeyState?.kmbIndex)out.push(...directFromIndex(journeyState.kmbIndex,origin,dest));}catch{}
    try{if(journeyState?.ctbIndex)out.push(...directFromIndex(journeyState.ctbIndex,origin,dest));}catch{}
    if(out.length<8)try{if(typeof gmbDirect==="function")out.push(...await gmbDirect(origin,dest));}catch{}
    return out.filter(r=>!SPECIAL_ROUTES.has(String(r.route||"").toUpperCase()));
  }
  function legEstimate(r){return 7+Number(r?.stopCount||0)*1.7+walkMinutes(r?.walkMeters);}
  async function bestAccess(origin,st){const ss=stationStops(st);if(!ss.length)return null;const rows=await directRows(origin,ss);return rows.sort((a,b)=>legEstimate(a)-legEstimate(b))[0]||null;}
  async function bestExit(st,dest){const ss=stationStops(st);if(!ss.length)return null;const rows=await directRows(ss,dest);return rows.sort((a,b)=>legEstimate(a)-legEstimate(b))[0]||null;}
  async function mtrGraphCandidates(from,to){
    if(!extra?.ensureMtrData)return[];try{await extra.ensureMtrData();}catch{return[];}if(!extra.mtrStations?.size)return[];
    const o=originData(from),d=destinationData(to);if(!o.point||!d.point||!o.stops.length||!d.stops.length)return[];
    const stations=[...extra.mtrStations.values()].map(st=>{const p=stationCoords(st);return p?{...st,...p}:null;}).filter(Boolean);
    let entries=stations.map(st=>({...st,d:dist(o.point,st)})).sort((a,b)=>a.d-b.d).slice(0,5),exits=stations.map(st=>({...st,d:dist(d.point,st)})).sort((a,b)=>a.d-b.d).slice(0,12);
    const entryRows=[];for(const st of entries){if(st.d<=900)entryRows.push({st,cost:walkMinutes(st.d),walk:st.d,leg:null});else{const leg=await bestAccess(o.stops,st);if(leg)entryRows.push({st,cost:legEstimate(leg),walk:Number(leg.walkMeters||0),leg});}}
    const exitRows=[];for(const st of exits){if(st.d<=900)exitRows.push({st,cost:walkMinutes(st.d),walk:st.d,leg:null});else{const leg=await bestExit(st,d.stops);if(leg)exitRows.push({st,cost:legEstimate(leg),walk:Number(leg.walkMeters||0),leg});}}
    const built=[];for(const a of entryRows.slice(0,3))for(const b of exitRows.slice(0,8)){if(a.st.code===b.st.code)continue;const p=weightedMtrPath(a.st.code,b.st.code);if(!p)continue;const lines=[];p.lines.forEach(l=>{if(lines[lines.length-1]!==l)lines.push(l);});const total=a.cost+p.cost+b.cost;built.push({kind:"direct",operator:"MTR",route:[a.leg?.route,...lines,b.leg?.route].filter(Boolean).join(" → "),transferCount:(a.leg?1:0)+lineChanges(p.lines)+(b.leg?1:0),stopCount:p.path.length-1+Number(a.leg?.stopCount||0)+Number(b.leg?.stopCount||0),walkMeters:Number(a.walk||0)+Number(b.walk||0),eta:a.leg?.eta||null,originStop:a.leg?.originStop||{id:a.st.code,name:a.st.name_tc},destinationStop:b.leg?.destinationStop||{id:b.st.code,name:b.st.name_tc},estimatedMinutes:total,_dzMtrGraph:true,_dzMtrEntry:a.st,_dzMtrExit:b.st,_dzMtrPath:p.path,_dzMtrLines:lines,_dzAccess:a,_dzExit:b});}
    const seen=new Set();return built.sort((a,b)=>a.estimatedMinutes-b.estimatedMinutes).filter(r=>{const k=`${r._dzMtrEntry.code}|${r._dzMtrExit.code}|${r.route}`;if(seen.has(k))return false;seen.add(k);return true;}).slice(0,3);
  }
  function routeKey(r){if(r?._dzMtrGraph)return`MTR|${r.route}`;if(r?.kind==="transfer")return`${r.first?.operator}|${r.first?.route}>${r.second?.operator}|${r.second?.route}`;return`${r?.operator}|${r?.route}`;}
  function dedupe(rows){const m=new Map();for(const r of rows||[]){const k=routeKey(r);if(!m.has(k)||generalizedMinutes(r)<generalizedMinutes(m.get(k)))m.set(k,r);}return[...m.values()];}
  if(typeof runJourneySearch==="function"){
    const previous=runJourneySearch;
    runJourneySearch=async function(){const from=$("#journeyFrom")?.value.trim()||"",to=$("#journeyTo")?.value.trim()||"";await previous();let graph=[];try{graph=await mtrGraphCandidates(from,to);}catch{}
      let rows=dedupe([...(journeyState.results||[]),...graph]);rows=dominancePrune(rows);rows.sort((a,b)=>generalizedMinutes(a)-generalizedMinutes(b));journeyState.results=rows.slice(0,12);try{renderJourneyResults();}catch{}
      const st=$("#journeyStatus");if(st&&graph.length)st.textContent=`${st.textContent||""}；MTR Sub-Graph 加入 ${graph.length} 個鐵路網絡方案，並已做優勢剪枝。`;
    };
  }
  window.dzNetworkCore390={version:"3.9.0",weightedMtrPath,mtrGraphCandidates,dominancePrune,generalizedMinutes};
})();