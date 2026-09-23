(() => {
  "use strict";
  const $ = s => document.querySelector(s);
  const norm = v => String(v || "").trim();
  const NIGHT_RE = /^(N|NA)\d/i;
  const MAX_BASE = 5;
  const MAX_ORIGIN = 12;
  const MAX_VARIANTS_PER_GATEWAY = 3;
  const HUB_RADIUS = 260;

  function indexFor(op){ return op === "KMB" ? journeyState?.kmbIndex : op === "CTB" ? journeyState?.ctbIndex : null; }
  function stopMap(op){ return op === "KMB" ? state?.kmbStops : op === "CTB" ? state?.ctbStops : null; }
  function point(op,id){
    const s = stopMap(op)?.get(String(id)); if(!s) return null;
    const lat = Number(s.lat ?? s.latitude), lon = Number(s.long ?? s.lng ?? s.longitude);
    if(!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
    return {operator:op,id:String(id),lat,lon,name:journeyStopName?.(s) || s.name_tc || String(id),stop:s,distance:0};
  }
  function routeMeta(key){ try{return routeMetaFromKey(key) || {};}catch{return{};} }
  function sig(r){
    if(r?.kind === "transfer") return `${r.first?.operator}|${r.first?.route}>${r.second?.operator}|${r.second?.route}|${r.transferStopId||""}`;
    return `${r?.operator}|${r?.route}|${r?.bound||""}`;
  }
  function nightBlocked(r){
    return NIGHT_RE.test(norm(r?.route)) || NIGHT_RE.test(norm(r?.first?.route)) || NIGHT_RE.test(norm(r?.second?.route));
  }
  function nearbyOrigin(){
    const from = $("#journeyFrom")?.value.trim() || "";
    try { return resolvePlace(from || "我的位置", from === "我的位置" ? journeyState?.originLocation : null).slice(0,MAX_ORIGIN); }
    catch { return []; }
  }
  function transferPoint(r){
    if(!r || r.kind !== "transfer") return null;
    return point(r.second?.operator, r.transferStopId) || point(r.first?.operator, r.first?.transferStopId) || null;
  }
  function firstRoutesToHub(origin, hub, wantedSecond){
    const out=[];
    for(const op of ["KMB","CTB"]){
      const idx=indexFor(op); if(!idx) continue;
      for(const o of origin.filter(x=>x.operator===op)){
        for(const mem of (idx.byStop.get(String(o.id)) || []).slice(0,18)){
          const route=idx.byRoute.get(mem.routeKey); if(!route || NIGHT_RE.test(String(route.route||""))) continue;
          for(let j=mem.pos+1;j<Math.min(route.stops.length,mem.pos+32);j++){
            const p=point(op,route.stops[j].stop); if(!p) continue;
            const d=distanceMeters(p.lat,p.lon,hub.lat,hub.lon);
            if(d>HUB_RADIUS) continue;
            const m=routeMeta(mem.routeKey);
            out.push({
              kind:"transfer", transferCount:1,
              transferStopId:String(wantedSecond.transferStopId), transferStopName:hub.name,
              transferWalkMeters:d,
              first:{...m,operator:op,route:route.route,bound:route.bound,serviceType:route.serviceType,originStop:o,transferStopId:p.id,stopCount:j-mem.pos},
              second:{...wantedSecond.second},
              walkMeters:Number(o.distance||0)+Number(wantedSecond.second?.destinationStop?.distance||0)+d,
              stopCount:(j-mem.pos)+Number(wantedSecond.second?.stopCount||0),
              _dzGatewayVariant:true,
              _dzGatewayName:hub.name
            });
            break;
          }
        }
      }
    }
    const seen=new Set();
    return out.filter(r=>{const k=`${r.first.operator}|${r.first.route}`;if(seen.has(k))return false;seen.add(k);return true;});
  }
  async function operating(r){
    try{
      const fn=window.dzServiceWindowFilter?.isOperating;
      return fn ? await fn(r.first) : true;
    }catch{return true;}
  }
  function rankValue(r){
    if(Number.isFinite(r?._dzDisplayMinutes)) return r._dzDisplayMinutes;
    try{const p=window.dzJourney396?.provisionalMinutes?.(r); if(Number.isFinite(p)) return p;}catch{}
    try{const s=journeyScore?.(r); if(Number.isFinite(s)) return s/100;}catch{}
    return 9999;
  }
  async function diversify(rows){
    rows=(rows||[]).filter(r=>!nightBlocked(r));
    const origin=nearbyOrigin(); if(!origin.length) return rows;
    const bases=rows.filter(r=>r?.kind==="transfer" && r.second?.route).slice(0,MAX_BASE);
    const extras=[];
    for(const base of bases){
      const hub=transferPoint(base); if(!hub) continue;
      const variants=firstRoutesToHub(origin,hub,base);
      let kept=0;
      for(const v of variants){
        if(v.first?.route===base.first?.route) continue;
        if(!(await operating(v))) continue;
        try{const p=window.dzJourney396?.provisionalMinutes?.(v);if(Number.isFinite(p))v._dzDisplayMinutes=p;}catch{}
        extras.push(v); if(++kept>=MAX_VARIANTS_PER_GATEWAY) break;
      }
    }
    const merged=new Map();
    for(const r of [...rows,...extras]){
      if(nightBlocked(r)) continue;
      const k=sig(r); const old=merged.get(k);
      if(!old || rankValue(r)<rankValue(old)) merged.set(k,r);
    }
    return [...merged.values()].sort((a,b)=>rankValue(a)-rankValue(b)).slice(0,12);
  }

  if(typeof runJourneySearch === "function"){
    const previous=runJourneySearch;
    runJourneySearch=async function(){
      await previous();
      journeyState.results=await diversify(journeyState.results||[]);
      try{renderJourneyResults();}catch{}
      const st=$("#journeyStatus");
      if(st && journeyState.results.some(r=>r._dzGatewayVariant)) st.textContent=`${st.textContent||""}；同一主要轉車點已保留多條合理第一程選擇。`;
    };
  }
  window.dzGatewayDiversity3101={version:"3.10.1",diversify};
})();
