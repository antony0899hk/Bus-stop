(() => {
  "use strict";

  const VERSION = "4.0.0";
  const CELL = 0.002;
  const NEARBY_RADII = [100, 200, 400];
  const NEAR_CAP = { KMB: 6, CTB: 6, GMB: 5 };
  const MAX_SEED_ROUTES = 14;
  const MAX_TRANSFER_CANDIDATES = 36;
  const MAX_RESULTS = 12;
  const HUB_WORDS = [
    "城門隧道","大欖隧道","大老山隧道","粉嶺公路轉車站","轉車站",
    "沙田站","大圍站","大學站","九龍塘站","鑽石山站","青衣站"
  ];

  const grid = { KMB:null, CTB:null, GMB:null };
  const gridPromise = { KMB:null, CTB:null, GMB:null };
  let journeyToken = 0;

  const $ = s => document.querySelector(s);
  const yieldUI = () => new Promise(r => setTimeout(r, 0));
  const norm = v => String(v || "").trim().toLowerCase().replace(/[\s　]+/g, "");
  const coords = s => {
    const lat = Number(s?.lat ?? s?.latitude), lon = Number(s?.long ?? s?.lng ?? s?.longitude);
    return Number.isFinite(lat) && Number.isFinite(lon) ? {lat,lon} : null;
  };
  const mapFor = op => op === "KMB" ? state?.kmbStops : op === "CTB" ? state?.ctbStops : op === "GMB" ? state?.gmbStops : null;
  const keyFor = (lat,lon) => `${Math.floor(lat/CELL)}:${Math.floor(lon/CELL)}`;
  const hubRank = name => HUB_WORDS.some(x => norm(name).includes(norm(x))) ? 0 : 1;
  const nightRoute = r => /^(N|NA)\d/i.test(String(r || ""));
  const nightNow = () => { const d=new Date(),m=d.getHours()*60+d.getMinutes(); return m>=90 && m<300; };

  async function ensureGrid(op){
    if(grid[op]) return grid[op];
    if(gridPromise[op]) return gridPromise[op];
    gridPromise[op] = (async()=>{
      const out = new Map(), src = mapFor(op);
      if(!src) return out;
      let n=0;
      for(const [id,s] of src){
        const c=coords(s); if(!c) continue;
        const k=keyFor(c.lat,c.lon);
        if(!out.has(k)) out.set(k,[]);
        out.get(k).push({operator:op,id:String(id),stop:s,lat:c.lat,lon:c.lon,name:journeyStopName?.(s)||s?.name_tc||String(id)});
        if((++n % 700) === 0) await yieldUI();
      }
      grid[op]=out;
      return out;
    })().finally(()=>{gridPromise[op]=null;});
    return gridPromise[op];
  }

  async function spatialStops(pos,radius,operators=["KMB","CTB","GMB"]){
    const out=[];
    const latCells=Math.ceil((radius/110540)/CELL)+1;
    const lonCells=Math.ceil((radius/(111320*Math.max(.3,Math.cos(pos.lat*Math.PI/180))))/CELL)+1;
    const cy=Math.floor(pos.lat/CELL), cx=Math.floor(pos.lon/CELL);
    for(const op of operators){
      const g=await ensureGrid(op), list=[];
      for(let y=cy-latCells;y<=cy+latCells;y++){
        for(let x=cx-lonCells;x<=cx+lonCells;x++){
          for(const s of g.get(`${y}:${x}`)||[]){
            const d=distanceMeters(pos.lat,pos.lon,s.lat,s.lon);
            if(Number.isFinite(d)&&d<=radius) list.push({...s,distance:d});
          }
        }
      }
      list.sort((a,b)=>a.distance-b.distance);
      out.push(...list.slice(0,NEAR_CAP[op]||5));
    }
    return out.sort((a,b)=>a.distance-b.distance);
  }

  async function etaRowsForStop(s){
    const rows=[];
    try{
      if(s.operator==="KMB"){
        const j=await getJSON(`${KMB_API}/stop-eta/${encodeURIComponent(s.id)}`,{ttl:15000,retries:0});
        for(const x of (j.data||[]).slice(0,50)) if(validFutureEta(x.eta)) rows.push({operator:"KMB",route:x.route,dest:x.dest_tc||"",eta:x.eta,remark:x.rmk_tc||"",distance:s.distance,stopId:s.id,stopName:s.name,stopSeq:Number(x.seq)||0,bound:x.dir||""});
      }else if(s.operator==="CTB"){
        let data=[];
        try{const j=await getJSON(`https://rt.data.gov.hk/v1/transport/batch/stop-eta/CTB/${encodeURIComponent(s.id)}`,{ttl:15000,retries:0});data=j.data||[];}catch{}
        for(const x of data.slice(0,50)) if(validFutureEta(x.eta)) rows.push({operator:"CTB",route:x.route,dest:x.dest_tc||"",eta:x.eta,remark:x.rmk_tc||"",distance:s.distance,stopId:s.id,stopName:s.name,stopSeq:Number(x.seq)||0,bound:x.dir||""});
      }else if(s.operator==="GMB"){
        const j=await getJSON(`${GMB_API}/eta/stop/${encodeURIComponent(s.id)}`,{ttl:15000,retries:0});
        for(const occ of j.data||[]){
          if(occ.enabled===false) continue;
          const meta=state.gmbRoutes.find(r=>String(r.routeId)===String(occ.route_id)&&Number(r.routeSeq)===Number(occ.route_seq));
          for(const e of occ.eta||[]) if(validFutureEta(e.timestamp)) rows.push({operator:"GMB",route:meta?.route||"小巴",dest:meta?.dest||"",eta:e.timestamp,remark:e.remarks_tc||"",distance:s.distance,stopId:s.id,stopName:s.name,stopSeq:Number(occ.stop_seq)||0,bound:meta?.bound||""});
        }
      }
    }catch{}
    return rows;
  }

  async function runNearbyOnly(radius=100){
    radius=NEARBY_RADII.includes(Number(radius))?Number(radius):100;
    const st=$("#nearbyStatus"),btn=$("#locateBtn"),sec=$("#nearbySection"),count=$("#nearbyCount");
    if(st)st.textContent=`正在搜尋附近 ${radius}m…`;
    if(btn)btn.disabled=true;
    if(!navigator.geolocation){if(st)st.textContent="此瀏覽器不支援定位。";if(btn)btn.disabled=false;return;}
    navigator.geolocation.getCurrentPosition(async p=>{
      try{
        const pos={lat:p.coords.latitude,lon:p.coords.longitude};
        if(window.dzNearbyMapState){window.dzNearbyMapState.position=pos;window.dzNearbyMapState.radius=radius;}
        const primary=await spatialStops(pos,radius,["KMB","CTB"]);
        const rows=[];
        await Promise.all(primary.map(async s=>rows.push(...await etaRowsForStop(s))));
        const seen=new Set();
        state.nearby=rows.sort((a,b)=>new Date(a.eta)-new Date(b.eta)).filter(x=>{const k=`${x.operator}|${String(x.route).toUpperCase()}`;if(seen.has(k))return false;seen.add(k);return true;});
        if(sec)sec.classList.remove("hidden"); if(count)count.textContent=`${radius}m`;
        try{renderNearby();}catch{}
        if(st)st.textContent=`已顯示 ${radius}m 內巴士；小巴背景補上。`;
        if(btn)btn.disabled=false;
        await yieldUI();
        const gmb=await spatialStops(pos,radius,["GMB"]), gmbRows=[];
        await Promise.all(gmb.map(async s=>gmbRows.push(...await etaRowsForStop(s))));
        const merged=[...state.nearby,...gmbRows].sort((a,b)=>new Date(a.eta)-new Date(b.eta));
        const seen2=new Set(); state.nearby=merged.filter(x=>{const k=`${x.operator}|${String(x.route).toUpperCase()}`;if(seen2.has(k))return false;seen2.add(k);return true;});
        try{renderNearby();}catch{}
        if(window.dzNearbyMapState) window.dzNearbyMapState.stops=[...primary,...gmb].map(x=>({operator:x.operator,stop:x.id,stopObj:x.stop,lat:x.lat,lon:x.lon,name:x.name,distance:x.distance}));
        if(st)st.textContent=`完成 ${radius}m 附近搜尋；只查附近站及其 ETA。`;
      }catch(e){if(st)st.textContent="附近資料暫時未能載入。";if(btn)btn.disabled=false;}
    },err=>{if(st)st.textContent=err.code===1?"你未允許定位。":"暫時無法取得位置。";if(btn)btn.disabled=false;},{enableHighAccuracy:true,maximumAge:8000,timeout:15000});
  }

  function routeIndex(op){return op==="KMB"?journeyState.kmbIndex:op==="CTB"?journeyState.ctbIndex:null;}
  function stopPoint(op,id){
    const s=mapFor(op)?.get(String(id)),c=coords(s);if(!s||!c)return null;
    return {operator:op,id:String(id),name:journeyStopName(s)||String(id),lat:c.lat,lon:c.lon,stop:s,distance:0};
  }
  function destinationCluster(value){
    const found=resolvePlace(value,null).filter(x=>Number.isFinite(x.lat)&&Number.isFinite(x.lon));
    if(!found.length)return {stops:[],anchor:null};
    const best=found.slice(0,12),anchor={lat:best.reduce((a,x)=>a+x.lat,0)/best.length,lon:best.reduce((a,x)=>a+x.lon,0)/best.length};
    return {stops:found.map(x=>({...x,distance:distanceMeters(x.lat,x.lon,anchor.lat,anchor.lon)})),anchor};
  }
  async function originSeedStops(value){
    let anchor=null;
    if((!value||value==="我的位置")&&journeyState.originLocation) anchor=journeyState.originLocation;
    if(!anchor){
      const found=resolvePlace(value,null).filter(x=>Number.isFinite(x.lat)&&Number.isFinite(x.lon));
      if(found.length){const best=found.slice(0,8);anchor={lat:best.reduce((a,x)=>a+x.lat,0)/best.length,lon:best.reduce((a,x)=>a+x.lon,0)/best.length};}
    }
    if(!anchor)return [];
    const all=[],seen=new Set();
    for(const r of [100,200]){
      for(const s of await spatialStops(anchor,r,["KMB","CTB"])){const k=`${s.operator}|${s.id}`;if(!seen.has(k)){seen.add(k);all.push(s);}}
    }
    const routeCount=()=>new Set(all.flatMap(s=>(routeIndex(s.operator)?.byStop.get(s.id)||[]).map(m=>m.routeKey))).size;
    if(routeCount()<2){for(const s of await spatialStops(anchor,400,["KMB","CTB"])){const k=`${s.operator}|${s.id}`;if(!seen.has(k)){seen.add(k);all.push(s);}}}
    return all;
  }
  function destinationMatch(route,fromPos,dest,anchor){
    let best=null;
    const exact=new Map(dest.filter(x=>x.operator===route.operator).map(x=>[x.id,x]));
    for(let i=fromPos+1;i<route.stops.length;i++){
      const rs=route.stops[i];
      let d=exact.get(rs.stop)||null;
      if(!d&&anchor){const p=stopPoint(route.operator,rs.stop);if(p){const walk=distanceMeters(p.lat,p.lon,anchor.lat,anchor.lon);if(walk<=700)d={...p,distance:walk};}}
      if(d){best={pos:i,destination:d};break;}
    }
    return best;
  }
  function directFromSeeds(seeds,dest,anchor){
    const out=[];
    for(const s of seeds){const idx=routeIndex(s.operator);if(!idx)continue;for(const mem of idx.byStop.get(s.id)||[]){const r=idx.byRoute.get(mem.routeKey);if(!r)continue;const hit=destinationMatch(r,mem.pos,dest,anchor);if(!hit)continue;out.push({kind:"direct",transferCount:0,operator:r.operator,route:r.route,bound:r.bound,serviceType:r.serviceType,originStop:{...s,distance:s.distance||0},destinationStop:hit.destination,originPos:mem.pos,destinationPos:hit.pos,stopCount:hit.pos-mem.pos,walkMeters:Number(s.distance||0)+Number(hit.destination.distance||0)});}}
    return out;
  }
  function progressiveTransfers(seeds,dest,anchor){
    const out=[],seenRoute=new Set(),seedRoutes=[];
    for(const s of seeds){const idx=routeIndex(s.operator);if(!idx)continue;for(const mem of idx.byStop.get(s.id)||[]){if(seenRoute.has(mem.routeKey))continue;seenRoute.add(mem.routeKey);seedRoutes.push({s,mem,idx});}}
    for(const pack of seedRoutes.slice(0,MAX_SEED_ROUTES)){
      const {s,mem,idx}=pack,first=idx.byRoute.get(mem.routeKey);if(!first)continue;
      const downstream=first.stops.slice(mem.pos+1).map(rs=>{const p=stopPoint(first.operator,rs.stop);return p?{...rs,p,_hub:hubRank(p.name)}:null;}).filter(Boolean).sort((a,b)=>a._hub-b._hub||a.pos-b.pos);
      for(const fs of downstream.slice(0,24)){
        const memberships=idx.byStop.get(fs.stop)||[];
        for(const mem2 of memberships){
          if(mem2.routeKey===mem.routeKey)continue;
          const second=idx.byRoute.get(mem2.routeKey);if(!second)continue;
          if(!nightNow()&&(nightRoute(first.route)||nightRoute(second.route)))continue;
          const hit=destinationMatch(second,mem2.pos,dest,anchor);if(!hit)continue;
          const key=`${mem.routeKey}>${fs.stop}>${mem2.routeKey}`;if(out.some(x=>x._key===key))continue;
          out.push({_key:key,kind:"transfer",transferCount:1,transferStopId:fs.stop,transferStopName:fs.p.name,transferWalkMeters:0,
            first:{...routeMetaFromKey(mem.routeKey),operator:first.operator,route:first.route,bound:first.bound,serviceType:first.serviceType,originStop:{...s,distance:s.distance||0},transferStopId:fs.stop,stopCount:fs.pos-mem.pos},
            second:{...routeMetaFromKey(mem2.routeKey),operator:second.operator,route:second.route,bound:second.bound,serviceType:second.serviceType,transferStopId:fs.stop,destinationStop:hit.destination,stopCount:hit.pos-mem2.pos},
            walkMeters:Number(s.distance||0)+Number(hit.destination.distance||0),stopCount:(fs.pos-mem.pos)+(hit.pos-mem2.pos),_gateway:fs._hub===0});
          if(out.length>=MAX_TRANSFER_CANDIDATES)return out;
        }
      }
    }
    return out;
  }
  async function firstEta(r){
    try{
      const leg=r.kind==="transfer"?r.first:r,stop=r.kind==="transfer"?r.first.originStop?.id:r.originStop?.id;
      if(!stop)return null;
      if(leg.operator==="KMB"){const j=await getJSON(`${KMB_API}/eta/${encodeURIComponent(stop)}/${encodeURIComponent(leg.route)}/${encodeURIComponent(leg.serviceType||"1")}`,{ttl:15000,retries:0});return (j.data||[]).filter(x=>(!leg.bound||!x.dir||String(x.dir).toUpperCase()===String(leg.bound).toUpperCase())&&validFutureEta(x.eta)).sort((a,b)=>new Date(a.eta)-new Date(b.eta))[0]?.eta||null;}
      if(leg.operator==="CTB"){const j=await getJSON(`${CTB_API}/eta/ctb/${encodeURIComponent(stop)}/${encodeURIComponent(leg.route)}`,{ttl:15000,retries:0});return (j.data||[]).filter(x=>(!leg.bound||!x.dir||String(x.dir).toUpperCase()===String(leg.bound).toUpperCase())&&validFutureEta(x.eta)).sort((a,b)=>new Date(a.eta)-new Date(b.eta))[0]?.eta||null;}
    }catch{} return null;
  }
  function score(r){
    if(Number.isFinite(r._dzDisplayMinutes))return r._dzDisplayMinutes*100+Number(r.walkMeters||0)/20;
    const eta=r.eta&&typeof etaMinutes==="function"?Math.max(0,etaMinutes(r.eta)):30,walk=Number(r.walkMeters||0),stops=Number(r.stopCount||0),x=Number(r.transferCount||0),gateway=r._gateway?-120:0;
    if(journeyState.mode==="walking")return walk*8+x*1200+stops*8+eta*20+gateway;
    if(journeyState.mode==="transfers")return x*100000+walk+stops*10+eta+gateway;
    return eta*100+stops*15+walk/10+x*650+gateway;
  }
  function dedupe(rows){const m=new Map();for(const r of rows){const k=r.kind==="transfer"?`${r.first.operator}|${r.first.route}>${r.second.operator}|${r.second.route}`:`${r.operator}|${r.route}`;if(!m.has(k)||score(r)<score(m.get(k)))m.set(k,r);}return [...m.values()];}
  async function refineTop(rows){
    for(const r of rows.slice(0,6)){
      try{const b=r.kind==="transfer"?await window.dzLiveJourney3100?.refineTransfer?.(r):await window.dzLiveJourney3100?.refineDirect?.(r);if(b){r._dzLiveBreakdown=b;r._dzDisplayMinutes=b.total;}}catch{}
    }
  }
  function decorateLive(){
    const rows=[...(journeyState.results||[])].sort((a,b)=>score(a)-score(b)),cards=[...document.querySelectorAll("#journeyResults .journey-card")];
    cards.forEach((card,i)=>{const r=rows[i],b=r?._dzLiveBreakdown;if(!r||!b)return;let eta=card.querySelector(".journey-eta");if(!eta){eta=document.createElement("div");eta.className="journey-eta";card.querySelector(".journey-main")?.prepend(eta);}eta.textContent=`預計 ${Math.round(b.total)} 分鐘`;});
  }

  async function runProgressiveJourney(){
    const my=++journeyToken,btn=$("#journeySearchBtn"),st=$("#journeyStatus"),box=$("#journeyResults"),from=$("#journeyFrom")?.value.trim()||"",to=$("#journeyTo")?.value.trim()||"";
    if(!to){if(st)st.textContent="請先輸入終點。";return;}
    if(btn)btn.disabled=true;if(box)box.innerHTML='<div class="loading">100m → 200m 搜尋附近可搭路線…</div>';if(st)st.textContent="先搜尋起點附近路線，再沿路線找轉車 Gateway。";
    try{
      await ensureJourneyIndexes();
      const seeds=await originSeedStops(from||"我的位置"),destInfo=destinationCluster(to);
      if(!seeds.length||!destInfo.stops.length){journeyState.results=[];renderJourneyResults();if(st)st.textContent="搵唔到起點或終點附近車站。";return;}
      if(my!==journeyToken)return;
      let rows=[...directFromSeeds(seeds,destInfo.stops,destInfo.anchor),...progressiveTransfers(seeds,destInfo.stops,destInfo.anchor)];
      rows=dedupe(rows).sort((a,b)=>score(a)-score(b)).slice(0,24);
      const active=[];for(const r of rows.slice(0,18)){const eta=await firstEta(r);if(eta){r.eta=eta;if(r.kind==="transfer")r.firstEta=eta;active.push(r);}if(my!==journeyToken)return;}
      await refineTop(active);
      journeyState.results=dedupe(active).sort((a,b)=>score(a)-score(b)).slice(0,MAX_RESULTS);
      window.journeyScore=score;
      try{renderJourneyResults();decorateLive();}catch{}
      if(window.dzAddMtrFallback){await Promise.race([Promise.resolve(window.dzAddMtrFallback()).catch(()=>false),new Promise(r=>setTimeout(()=>r(false),3500))]);try{journeyState.results=dedupe(journeyState.results).sort((a,b)=>score(a)-score(b)).slice(0,MAX_RESULTS);renderJourneyResults();decorateLive();}catch{}}
      if(st)st.textContent="v4：附近路線做起點 → 沿線 Gateway → 只展開可到目的地方向 → MTR 同場比較 → live ETA 排名。";
    }catch(e){if(st)st.textContent=`搜尋失敗：${e?.message||"未知錯誤"}`;if(box)box.innerHTML='<div class="error">點到點搜尋暫時失敗。</div>';}
    finally{if(btn)btn.disabled=false;}
  }

  // Make this engine authoritative. Legacy journey listeners call the global function,
  // while nearby clicks are captured here so the older whole-map scan does not run.
  window.runJourneySearch=runProgressiveJourney;
  try{runJourneySearch=runProgressiveJourney;}catch{}
  document.addEventListener("click",e=>{
    const radiusBtn=e.target.closest?.("[data-dz-radius]");
    if(radiusBtn){e.preventDefault();e.stopImmediatePropagation();runNearbyOnly(Number(radiusBtn.dataset.dzRadius)||100);return;}
    const locate=e.target.closest?.("#locateBtn");
    if(locate){e.preventDefault();e.stopImmediatePropagation();const r=Number(window.dzNearbyMapState?.radius)||100;runNearbyOnly(r);}
  },true);

  const badge=document.querySelector(".app-version");if(badge){badge.textContent=`v${VERSION}`;badge.setAttribute("aria-label",`版本 v${VERSION}`);}
  window.dzProgressiveEngine400={version:VERSION,runNearbyOnly,runJourney:runProgressiveJourney,spatialStops};
})();
