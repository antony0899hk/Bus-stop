(() => {
  "use strict";

  const WALK_RADIUS = 800;
  const TRANSFER_WALK = 220;
  const MAX_ORIGIN_STOPS = 18;
  const MAX_DEST_STOPS = 24;
  const MAX_FIRST_ROUTES = 18;
  const MAX_TRANSFER_STOPS_PER_ROUTE = 18;
  const MAX_RESULTS = 12;
  let token = 0;

  const HUB_WORDS = [
    "粉嶺公路轉車站","大老山隧道","獅子山隧道","城門隧道","沙田站","大學站",
    "九龍塘","鑽石山","黃大仙","觀塘","九龍灣","紅磡","旺角","太子","深水埗","荔枝角","尖沙咀","油塘","藍田"
  ];

  const $ = s => document.querySelector(s);
  const norm = v => String(v || "").trim().toLowerCase().replace(/[\s　]+/g, "");
  const isNightRoute = r => /^(N|NA)\d/i.test(String(r || ""));
  const nightHours = () => { const d=new Date(),m=d.getHours()*60+d.getMinutes(); return m>=90&&m<300; };
  const timeout = (p, ms, fallback=null) => Promise.race([Promise.resolve(p).catch(()=>fallback),new Promise(r=>setTimeout(()=>r(fallback),ms))]);

  function stopMap(op){
    if(typeof state==="undefined") return null;
    return op==="KMB"?state.kmbStops:op==="CTB"?state.ctbStops:op==="GMB"?state.gmbStops:null;
  }
  function stopPoint(op,id){
    const s=stopMap(op)?.get(String(id)); if(!s) return null;
    const lat=Number(s.lat??s.latitude), lon=Number(s.long??s.lng??s.longitude);
    if(!Number.isFinite(lat)||!Number.isFinite(lon)) return null;
    return {operator:op,id:String(id),name:journeyStopName(s)||String(id),lat,lon,stop:s,distance:0};
  }
  function indexFor(op){ return op==="KMB"?journeyState.kmbIndex:op==="CTB"?journeyState.ctbIndex:null; }
  function routeMeta(key){ return typeof routeMetaFromKey==="function"?routeMetaFromKey(key):{}; }
  function isHubName(name){ const n=norm(name); return HUB_WORDS.some(x=>n.includes(norm(x))); }
  function transferBonus(name){ return isHubName(name)?-12:0; }

  async function fetchEta(op, stopId, route, bound, serviceType="1"){
    try{
      if(!stopId||!route) return null;
      if(op==="KMB"){
        const j=await getJSON(`${KMB_API}/eta/${encodeURIComponent(stopId)}/${encodeURIComponent(route)}/${encodeURIComponent(serviceType||"1")}`,{ttl:0,retries:0});
        return (j.data||[]).filter(x=>(!bound||!x.dir||String(x.dir).toUpperCase()===String(bound).toUpperCase())&&validFutureEta(x.eta)).sort((a,b)=>new Date(a.eta)-new Date(b.eta))[0]?.eta||null;
      }
      if(op==="CTB"){
        const j=await getJSON(`${CTB_API}/eta/ctb/${encodeURIComponent(stopId)}/${encodeURIComponent(route)}`,{ttl:0,retries:0});
        return (j.data||[]).filter(x=>(!bound||!x.dir||String(x.dir).toUpperCase()===String(bound).toUpperCase())&&validFutureEta(x.eta)).sort((a,b)=>new Date(a.eta)-new Date(b.eta))[0]?.eta||null;
      }
    }catch{}
    return null;
  }

  function directCandidates(origin,destination){
    const out=[];
    if(journeyState.kmbIndex) out.push(...directFromIndex(journeyState.kmbIndex,origin.filter(x=>x.operator==="KMB"),destination.filter(x=>x.operator==="KMB")));
    if(journeyState.ctbIndex) out.push(...directFromIndex(journeyState.ctbIndex,origin.filter(x=>x.operator==="CTB"),destination.filter(x=>x.operator==="CTB")));
    return out;
  }

  function nearbyTransferStops(point, op, allStops){
    return allStops.filter(s=>s.operator===op&&Number.isFinite(s.lat)&&Number.isFinite(s.lon))
      .map(s=>({...s,_xferWalk:distanceMeters(point.lat,point.lon,s.lat,s.lon)}))
      .filter(s=>s._xferWalk<=TRANSFER_WALK)
      .sort((a,b)=>a._xferWalk-b._xferWalk)
      .slice(0,8);
  }

  function buildTransfers(origin,destination){
    const out=[], seen=new Set();
    const all=allJourneyStops().filter(s=>Number.isFinite(s.lat)&&Number.isFinite(s.lon));
    const destByOp={KMB:new Set(destination.filter(s=>s.operator==="KMB").map(s=>s.id)),CTB:new Set(destination.filter(s=>s.operator==="CTB").map(s=>s.id))};

    for(const firstOp of ["KMB","CTB"]){
      const idx=indexFor(firstOp); if(!idx) continue;
      const origins=origin.filter(s=>s.operator===firstOp).slice(0,MAX_ORIGIN_STOPS);
      let firstRouteCount=0;
      for(const o of origins){
        for(const mem of idx.byStop.get(o.id)||[]){
          if(firstRouteCount++>MAX_FIRST_ROUTES) break;
          const first=idx.byRoute.get(mem.routeKey); if(!first) continue;
          const routeStops=first.stops.slice(mem.pos+1,mem.pos+1+MAX_TRANSFER_STOPS_PER_ROUTE);
          for(const fs of routeStops){
            const p=stopPoint(firstOp,fs.stop); if(!p) continue;
            for(const secondOp of ["KMB","CTB"]){
              const idx2=indexFor(secondOp); if(!idx2) continue;
              const transferStops=secondOp===firstOp?[{...p,_xferWalk:0}]:nearbyTransferStops(p,secondOp,all);
              for(const ts of transferStops){
                for(const mem2 of idx2.byStop.get(ts.id)||[]){
                  if(secondOp===firstOp&&mem2.routeKey===mem.routeKey) continue;
                  const second=idx2.byRoute.get(mem2.routeKey); if(!second) continue;
                  let dj=-1, dest=null;
                  for(let j=mem2.pos+1;j<second.stops.length;j++){
                    if(destByOp[secondOp].has(second.stops[j].stop)){ dj=j; dest=destination.find(x=>x.operator===secondOp&&x.id===second.stops[j].stop); break; }
                  }
                  if(dj<0||!dest) continue;
                  const m1=routeMeta(mem.routeKey), m2=routeMeta(mem2.routeKey);
                  const key=`${firstOp}|${first.route}|${o.id}|${fs.stop}>${secondOp}|${second.route}|${ts.id}|${dest.id}`;
                  if(seen.has(key)) continue; seen.add(key);
                  const tname=p.name||ts.name||"轉車站";
                  out.push({
                    kind:"transfer",transferCount:1,transferStopId:ts.id,transferStopName:tname,transferWalkMeters:Number(ts._xferWalk||0),
                    first:{...m1,operator:firstOp,route:first.route,bound:first.bound,serviceType:first.serviceType,originStop:o,transferStopId:fs.stop,stopCount:fs.pos-mem.pos},
                    second:{...m2,operator:secondOp,route:second.route,bound:second.bound,serviceType:second.serviceType,transferStopId:ts.id,destinationStop:dest,stopCount:dj-mem2.pos},
                    walkMeters:Number(o.distance||0)+Number(dest.distance||0)+Number(ts._xferWalk||0),
                    stopCount:(fs.pos-mem.pos)+(dj-mem2.pos),_hubBonus:transferBonus(tname)
                  });
                }
              }
            }
          }
        }
      }
    }
    return out;
  }

  function walkingDominates(r){
    if(r.kind!=="transfer") return false;
    const originWalk=Number(r.first?.originStop?.distance||0);
    const transferWalk=Number(r.transferWalkMeters||0);
    const firstStops=Number(r.first?.stopCount||0);
    if(firstStops<=2 && originWalk+transferWalk<=WALK_RADIUS) return true;
    return false;
  }

  async function validate(rows, myToken){
    const candidates=rows.filter(r=>!(!nightHours()&&(isNightRoute(r.route)||isNightRoute(r.first?.route)||isNightRoute(r.second?.route))));
    const checked=[];
    for(const r of candidates.slice(0,30)){
      if(myToken!==token) return [];
      if(r.kind==="direct"){
        if(r.operator==="MTR"||r._dzMtrBridge){checked.push(r);continue;}
        const eta=await timeout(fetchEta(r.operator,r.originStop?.id,r.route,r.bound,r.serviceType),1700,null);
        if(eta){r.eta=eta;checked.push(r);}
      }else{
        const [a,b]=await Promise.all([
          timeout(fetchEta(r.first?.operator,r.first?.originStop?.id,r.first?.route,r.first?.bound,r.first?.serviceType),1700,null),
          timeout(fetchEta(r.second?.operator,r.transferStopId,r.second?.route,r.second?.bound,r.second?.serviceType),1700,null)
        ]);
        if(a&&b){r.firstEta=a;r.secondEta=b;r.eta=a;checked.push(r);}
      }
    }
    return checked;
  }

  function score(r){
    const eta=typeof etaMinutes==="function"&&r.eta?Math.max(0,etaMinutes(r.eta)):0;
    const stops=Number(r.stopCount||0), walk=Number(r.walkMeters||0), transfers=Number(r.transferCount||0);
    const hub=Number(r._hubBonus||0), xferWalk=Number(r.transferWalkMeters||0);
    if(journeyState.mode==="walking") return walk*8+transfers*900+stops*8+eta*25+hub;
    if(journeyState.mode==="transfers") return transfers*100000+walk+stops*10+eta+hub;
    if(journeyState.mode==="cheapest") return transfers*1500+stops*12+walk+eta*20+hub;
    return eta*100+stops*16+walk/10+transfers*700+xferWalk/5+hub;
  }

  function dedupe(rows){
    const m=new Map();
    for(const r of rows){
      const k=r.kind==="transfer"?`${r.first.operator}|${r.first.route}>${r.second.operator}|${r.second.route}|${r.transferStopId}`:`${r.operator}|${r.route}|${r.originStop?.id}|${r.destinationStop?.id}`;
      if(!m.has(k)||score(r)<score(m.get(k))) m.set(k,r);
    }
    return [...m.values()];
  }

  async function searchV2(){
    const myToken=++token, btn=$("#journeySearchBtn"), st=$("#journeyStatus"), box=$("#journeyResults");
    const from=$("#journeyFrom")?.value.trim()||"", to=$("#journeyTo")?.value.trim()||"";
    if(!to){if(st)st.textContent="請先輸入終點。";return;}
    if(btn)btn.disabled=true; if(box)box.innerHTML='<div class="loading">正在建立合理轉乘路線…</div>'; if(st)st.textContent="正在比較直達、合理轉車點及實時 ETA…";
    try{
      await timeout(ensureJourneyIndexes(),5000,null);
      const origin=resolvePlace(from||"我的位置",from==="我的位置"?journeyState.originLocation:null).slice(0,MAX_ORIGIN_STOPS);
      const destination=resolvePlace(to,null).slice(0,MAX_DEST_STOPS);
      if(!origin.length||!destination.length){journeyState.results=[];renderJourneyResults();if(st)st.textContent="搵唔到起點或終點附近車站。";return;}
      let rows=[...directCandidates(origin,destination),...buildTransfers(origin,destination).filter(r=>!walkingDominates(r))];
      rows=dedupe(rows).sort((a,b)=>score(a)-score(b)).slice(0,30);
      const live=await validate(rows,myToken); if(myToken!==token)return;
      journeyState.results=dedupe(live).sort((a,b)=>score(a)-score(b)).slice(0,MAX_RESULTS);
      journeyScore=score;
      try{renderJourneyResults();}catch{}
      if(window.dzAddMtrFallback){await timeout(window.dzAddMtrFallback(),3500,false);try{renderJourneyResults();}catch{}}
      if(st)st.textContent=journeyState.results.length?`已確認 ${journeyState.results.length} 個現時有班次方案；短距離步行已優先，無 ETA／夜車／多餘 feeder 已排除。`:`暫時未搵到可確認實時班次嘅合理方案。`;
    }catch(e){if(st)st.textContent=`搜尋失敗：${e?.message||"未知錯誤"}`;if(box)box.innerHTML='<div class="error">點到點搜尋暫時失敗。</div>';}
    finally{if(btn)btn.disabled=false;}
  }

  window.dzRoutingEngineV2={search:searchV2,version:"3.7.0"};
  runJourneySearch=searchV2;
})();