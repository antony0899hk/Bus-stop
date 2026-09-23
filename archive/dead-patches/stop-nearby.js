(() => {
  "use strict";
  const RADIUS = 100;
  const $ = (s,r=document) => r.querySelector(s);
  const $$ = (s,r=document) => [...r.querySelectorAll(s)];
  const fareCache = new Map();

  function coords(stop){const lat=Number(stop?.lat??stop?.latitude),lon=Number(stop?.long??stop?.lng??stop?.longitude);return Number.isFinite(lat)&&Number.isFinite(lon)?{lat,lon}:null;}
  function maps(){return typeof state==="undefined"?[]:[["KMB",state.kmbStops],["CTB",state.ctbStops],["GMB",state.gmbStops]];}
  function stopObj(op,id){return maps().find(x=>x[0]===op)?.[1]?.get(String(id));}
  function opFromRoute(){return typeof state!=="undefined"?state?.selectedRoute?.operator:null;}
  function nameOf(stop,id){return stop?.name_tc||stop?.name||stop?.stop_name_tc||String(id||"");}
  function badge(op){return typeof operatorBadge==="function"?operatorBadge(op):op;}
  function etaText(iso){return typeof etaLabel==="function"?etaLabel(iso):"";}
  function safe(v){return typeof escapeHtml==="function"?escapeHtml(v):String(v??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));}

  function nearbyStops(origin){
    const out=[];
    for(const [op,map] of maps()){
      const a=[];
      for(const [id,s] of map){const c=coords(s);if(!c)continue;const d=distanceMeters(origin.lat,origin.lon,c.lat,c.lon);if(Number.isFinite(d)&&d<=RADIUS)a.push({operator:op,stop:String(id),stopObj:s,distance:d});}
      a.sort((x,y)=>x.distance-y.distance);out.push(...a.slice(0,10));
    }
    return out;
  }

  async function ctbEtaRows(s){
    let rows=[];
    try{
      const j=await getJSON(`https://rt.data.gov.hk/v1/transport/batch/stop-eta/CTB/${encodeURIComponent(s.stop)}`,{ttl:20000,retries:0});
      rows=(j.data||[]);
    }catch{}
    if(rows.length) return rows;
    try{
      const sr=await getJSON(`https://rt.data.gov.hk/v1.1/transport/batch/stop-route/CTB/${encodeURIComponent(s.stop)}`,{ttl:300000,retries:0});
      const routes=[...new Set((sr.data||[]).map(x=>x.route).filter(Boolean))].slice(0,18);
      const temp=[];
      await parallel(routes,3,async route=>{try{const e=await getJSON(`${CTB_API}/eta/ctb/${encodeURIComponent(s.stop)}/${encodeURIComponent(route)}`,{ttl:20000,retries:0});temp.push(...(e.data||[]));}catch{}});
      return temp;
    }catch{return [];}
  }

  async function etaRows(s){
    const rows=[];
    try{
      if(s.operator==="KMB"){
        const j=await getJSON(`${KMB_API}/stop-eta/${encodeURIComponent(s.stop)}`,{ttl:20000,retries:0});
        for(const x of (j.data||[]).slice(0,45)) if(validFutureEta(x.eta)) rows.push({operator:"KMB",route:x.route,dest:x.dest_tc||"",eta:x.eta,remark:x.rmk_tc||"",distance:s.distance,stopId:s.stop,stopName:nameOf(s.stopObj,s.stop),stopSeq:Number(x.seq)||0,bound:x.dir||""});
      }else if(s.operator==="CTB"){
        const data=await ctbEtaRows(s);
        for(const x of data.slice(0,50)) if(validFutureEta(x.eta)) rows.push({operator:"CTB",route:x.route,dest:x.dest_tc||"",eta:x.eta,remark:x.rmk_tc||"",distance:s.distance,stopId:s.stop,stopName:nameOf(s.stopObj,s.stop),stopSeq:Number(x.seq)||0,bound:x.dir||""});
      }else{
        const j=await getJSON(`${GMB_API}/eta/stop/${encodeURIComponent(s.stop)}`,{ttl:20000,retries:0});
        for(const occ of j.data||[]){if(occ.enabled===false)continue;const meta=state.gmbRoutes.find(r=>String(r.routeId)===String(occ.route_id)&&Number(r.routeSeq)===Number(occ.route_seq));for(const e of occ.eta||[]) if(validFutureEta(e.timestamp)) rows.push({operator:"GMB",route:meta?.route||"小巴",dest:meta?.dest||"",eta:e.timestamp,remark:e.remarks_tc||"",distance:s.distance,stopId:s.stop,stopName:nameOf(s.stopObj,s.stop),stopSeq:Number(occ.stop_seq)||0,bound:meta?.bound||""});}
      }
    }catch{}
    return rows;
  }

  async function fareFor(x){
    if(typeof loadFareXml!=="function"||typeof routeFareRecords!=="function"||typeof buildFareMap!=="function") return null;
    const key=`${x.operator}|${x.route}|${x.bound||""}|${x.stopSeq||0}`;
    if(fareCache.has(key)) return fareCache.get(key);
    const p=(async()=>{try{const xml=await loadFareXml(x.operator);const rec=routeFareRecords(xml,{operator:x.operator,route:x.route,bound:x.bound});if(!rec.length)return null;const map=buildFareMap(rec);if(x.stopSeq&&map.has(Number(x.stopSeq)))return {fare:map.get(Number(x.stopSeq)),exact:true};const f=map.get(1)??rec.map(r=>Number(r.fare)).filter(Number.isFinite).sort((a,b)=>b-a)[0];return Number.isFinite(f)?{fare:f,exact:false}:null;}catch{return null;}})();
    fareCache.set(key,p);return p;
  }

  function closeSheet(){$(".stop-sheet-backdrop")?.remove();}
  function shell(title){closeSheet();const el=document.createElement("div");el.className="stop-sheet-backdrop";el.innerHTML=`<section class="stop-sheet" role="dialog" aria-modal="true"><div class="stop-sheet-handle"></div><div class="stop-sheet-head"><div><strong>${safe(title)}</strong><div class="stop-sheet-meta">100m 內巴士／小巴即將到站</div></div><button class="stop-sheet-close" aria-label="關閉">×</button></div><div class="stop-sheet-list"><div class="loading">正在搜尋附近班次…</div></div></section>`;document.body.appendChild(el);el.addEventListener("click",e=>{if(e.target===el||e.target.closest(".stop-sheet-close"))closeSheet();});return el;}

  async function openByStop(op,id,title=""){
    const s=stopObj(op,id),c=coords(s);if(!c){return;}
    const sheet=shell(title||nameOf(s,id));
    const stops=nearbyStops(c), all=[];
    await parallel(stops,4,async x=>all.push(...await etaRows(x)));
    const seen=new Set();
    const list=all.sort((a,b)=>new Date(a.eta)-new Date(b.eta)).filter(x=>{const k=[x.operator,x.route,x.stopId,x.eta].join("|");if(seen.has(k))return false;seen.add(k);return true;}).slice(0,24);
    const box=$(".stop-sheet-list",sheet);if(!box)return;
    box.innerHTML=list.length?list.map((x,i)=>`<button class="stop-sheet-row" type="button" data-row="${i}" data-open-route="${safe(x.operator)}|${safe(x.route)}"><span>${badge(x.operator)}</span><span><span class="stop-sheet-route">${safe(x.route)}</span><span class="stop-sheet-meta">${safe(x.stopName)} → ${safe(x.dest||"目的地")} · ${Math.round(x.distance)}m <span class="stop-sheet-fare">· 車費載入中</span></span></span><span class="stop-sheet-eta">${safe(etaText(x.eta))}</span></button>`).join(""):'<div class="empty">附近暫時未有可顯示 ETA。</div>';
    list.forEach(async(x,i)=>{const f=await fareFor(x),el=box.querySelector(`[data-row="${i}"] .stop-sheet-fare`);if(el&&el.isConnected)el.textContent=f?`· ${f.exact?"車費":"全程"} $${Number(f.fare).toFixed(1)}`:"";});
  }

  function decorate(){
    $$("#stops .stop-name").forEach(el=>{if(el.dataset.stopNearbyReady)return;el.dataset.stopNearbyReady="1";el.classList.add("stop-nearby-link");el.setAttribute("role","button");el.setAttribute("tabindex","0");});
    $$("#nearbyResults .near-card").forEach(el=>{el.classList.add("stop-nearby-card");el.setAttribute("role","button");el.setAttribute("tabindex","0");});
    $$("#favorites .favorite-stop strong").forEach(el=>{el.classList.add("stop-nearby-link");el.setAttribute("role","button");el.setAttribute("tabindex","0");});
  }

  document.addEventListener("click",e=>{
    const routeBtn=e.target.closest("[data-open-route]");if(routeBtn){const [op,route]=routeBtn.dataset.openRoute.split("|");const r=normalizedRoutes().find(x=>x.operator===op&&String(x.route)===route);if(r){closeSheet();openRoute(r);}return;}
    const routeStop=e.target.closest("#stops .stop-name");if(routeStop){e.preventDefault();const row=routeStop.closest(".stop-row");const op=opFromRoute();if(op&&row?.dataset.stopId)openByStop(op,row.dataset.stopId,routeStop.textContent.trim());return;}
    const near=e.target.closest("#nearbyResults .near-card");if(near){const route=near.querySelector(".near-route")?.textContent?.trim(),meta=near.querySelector(".near-meta")?.textContent||"",name=meta.split("·")[0].trim();const x=state.nearby.find(v=>String(v.route)===String(route)&&String(v.stopName)===String(name))||state.nearby.find(v=>String(v.route)===String(route));if(x){e.preventDefault();openByStop(x.operator,x.stopId,x.stopName);}return;}
    const fav=e.target.closest("#favorites .favorite-stop strong");if(fav){const card=fav.closest(".favorite-card"),idx=$$("#favorites .favorite-card").indexOf(card),f=state.favorites[idx];if(f)openByStop(f.operator,f.stopId,f.stopName);}
  });
  document.addEventListener("keydown",e=>{if(!["Enter"," "].includes(e.key))return;const el=e.target.closest?.(".stop-nearby-link,.stop-nearby-card");if(el){e.preventDefault();el.click();}});
  const mo=new MutationObserver(decorate);mo.observe(document.documentElement,{subtree:true,childList:true});decorate();
  window.openStopNearbySheet=openByStop;
})();