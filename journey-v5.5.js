(() => {
  "use strict";
  const VERSION="5.5.1",STEP=50,ORIGIN_MAX=400,DEST_MAX=1000,MAX_ORIGIN_STOPS=8,MAX_SEED_ROUTES=18;
  const $=s=>document.querySelector(s),tileCache=new Map();
  const journeyState=window.journeyState=window.journeyState||{results:[],mode:"fastest",originLocation:null,token:0};
  let groundCell=0.005;

  async function json(url,ttl=300000){
    if(typeof getJSON==="function")return getJSON(url,{ttl,retries:0});
    const c=new AbortController(),timer=setTimeout(()=>c.abort(),10000);
    try{const r=await fetch(url,{headers:{Accept:"application/json"},signal:c.signal});if(!r.ok)throw Error(`HTTP ${r.status}`);return await r.json();}finally{clearTimeout(timer);}
  }
  function tileKeys(center,radius,cell=groundCell){
    const ys=Math.max(1,Math.ceil((radius/110540)/cell)),xs=Math.max(1,Math.ceil((radius/(111320*Math.max(.3,Math.cos(center.lat*Math.PI/180))))/cell));
    const y=Math.floor(center.lat/cell),x=Math.floor(center.lon/cell),out=[];
    for(let iy=y-ys;iy<=y+ys;iy++)for(let ix=x-xs;ix<=x+xs;ix++)out.push(`${iy}-${ix}`);return out;
  }
  async function loadTile(key){
    if(tileCache.has(key))return tileCache.get(key);
    const p=fetch(`./runtime/ground/tile-${key}.json?v=${encodeURIComponent(window.DZ_BUILD||VERSION)}`,{cache:"force-cache"}).then(r=>r.ok?r.json():{data:[]}).then(x=>Array.isArray(x.data)?x.data:[]).catch(()=>[]);
    tileCache.set(key,p);return p;
  }
  async function groundStops(center,radius){
    try{const c=await json(`./runtime/ground/config.json?v=${encodeURIComponent(window.DZ_BUILD||VERSION)}`,3600000);if(Number(c.cell)>0)groundCell=Number(c.cell);}catch{}
    const rows=(await Promise.all(tileKeys(center,radius).map(loadTile))).flat(),seen=new Set(),out=[];
    for(const row of rows){const lat=Number(row.lat),lon=Number(row.lon),distance=distanceMeters(center.lat,center.lon,lat,lon),key=`${row.operator}|${row.id}`;if(!seen.has(key)&&Number.isFinite(distance)&&distance<=radius){seen.add(key);out.push({...row,lat,lon,distance});}}
    return out.sort((a,b)=>a.distance-b.distance);
  }
  function parseAddressResponse(payload,query=""){
    for(const s of Array.isArray(payload?.SuggestedAddress)?payload.SuggestedAddress:[]){
      const p=s?.Address?.PremisesAddress||{},g=p.GeospatialInformation||{},lat=Number(g.Latitude),lon=Number(g.Longitude);if(!Number.isFinite(lat)||!Number.isFinite(lon))continue;
      const c=p.ChiPremisesAddress||{},e=p.EngPremisesAddress||{};return{lat,lon,name:String(c.BuildingName||c.ChiEstate?.EstateName||c.ChiStreet?.StreetName||e.BuildingName||query),score:Number(s.ValidationInformation?.Score)||0};
    }return null;
  }
  async function geocodeDestination(query){
    const r=await fetch(`https://www.als.gov.hk/lookup?q=${encodeURIComponent(query)}&n=10`,{headers:{Accept:"application/json"}});if(!r.ok)throw Error(`地址搜尋 HTTP ${r.status}`);
    const result=parseAddressResponse(await r.json(),query);if(!result)throw Error("搵唔到目的地位置");return result;
  }
  async function routesAtStop(stop){
    const url=stop.operator==="KMB"?`${KMB_API}/stop-eta/${encodeURIComponent(stop.id)}`:`https://rt.data.gov.hk/v1/transport/batch/stop-eta/CTB/${encodeURIComponent(stop.id)}`;
    const j=await json(url,15000);return(j.data||[]).filter(x=>x.route&&validFutureEta(x.eta)).map(x=>({operator:stop.operator,route:String(x.route),bound:String(x.dir||x.bound||"O").toUpperCase(),serviceType:String(x.service_type||"1"),eta:x.eta,originStop:stop}));
  }
  async function originSeeds(center,token,status){
    const groups=new Map(),checked=new Set();
    for(let radius=STEP;radius<=ORIGIN_MAX;radius+=STEP){
      if(token!==journeyState.token)return[];status.textContent=`起點 ${radius}m：正在搵附近可搭路線…`;
      for(const stop of(await groundStops(center,radius)).slice(0,MAX_ORIGIN_STOPS)){
        const sk=`${stop.operator}|${stop.id}`;if(checked.has(sk))continue;checked.add(sk);let rows=[];try{rows=await routesAtStop(stop);}catch{}
        for(const row of rows){const key=[row.operator,row.route,row.bound,row.serviceType].join("|"),old=groups.get(key);if(!old||row.originStop.distance<old.originStop.distance||new Date(row.eta)<new Date(old.eta))groups.set(key,row);}
      }if(groups.size>=8)break;
    }return[...groups.values()].sort((a,b)=>a.originStop.distance-b.originStop.distance||new Date(a.eta)-new Date(b.eta)).slice(0,MAX_SEED_ROUTES);
  }
  async function routeSequence(seed){
    const dir=seed.bound==="I"?"inbound":"outbound",url=seed.operator==="KMB"?`${KMB_API}/route-stop/${encodeURIComponent(seed.route)}/${dir}/${encodeURIComponent(seed.serviceType)}`:`${CTB_API}/route-stop/ctb/${encodeURIComponent(seed.route)}/${dir}`;
    const j=await json(url,300000);return(j.data||[]).filter(x=>seed.operator!=="CTB"||!x.dir||String(x.dir).toUpperCase()===seed.bound).map((x,i)=>({id:String(x.stop||x.stop_id),seq:Number(x.seq||i+1)})).sort((a,b)=>a.seq-b.seq);
  }
  function routeMetadata(seed){
    if(seed.operator==="KMB"){const r=state.kmbRoutes.find(x=>String(x.route)===seed.route&&String(x.bound).toUpperCase()===seed.bound&&String(x.service_type||"1")===seed.serviceType);return{orig:r?.orig_tc||"",dest:r?.dest_tc||""};}
    const r=state.ctbRoutes.find(x=>String(x.route)===seed.route);return seed.bound==="I"?{orig:r?.dest_tc||"",dest:r?.orig_tc||""}:{orig:r?.orig_tc||"",dest:r?.dest_tc||""};
  }
  async function prepareSeed(seed){const sequence=await routeSequence(seed),originIndex=sequence.findIndex(x=>x.id===seed.originStop.id);return originIndex<0?null:{seed,sequence,originIndex,meta:routeMetadata(seed)};}
  function destinationHitByIds(prepared,stops){
    const map=new Map(stops.filter(x=>x.operator===prepared.seed.operator).map(x=>[String(x.id),x]));let best=null;
    for(let i=prepared.originIndex+1;i<prepared.sequence.length;i++){const hit=map.get(prepared.sequence[i].id);if(hit&&(!best||hit.distance<best.stop.distance))best={index:i,stop:hit};}return best;
  }
  function makeCandidate(p,hit){
    const s=p.seed,stopCount=hit.index-p.originIndex,walkMeters=s.originStop.distance+hit.stop.distance,wait=Math.max(0,etaMinutes(s.eta)||0);
    return{kind:"direct",operator:s.operator,route:s.route,bound:s.bound,serviceType:s.serviceType,originStop:s.originStop,destinationStop:hit.stop,stopCount,walkMeters,transferCount:0,eta:s.eta,fare:null,meta:p.meta,journeyMinutes:Math.max(1,Math.round(wait+stopCount*2.1+walkMeters/75))};
  }
  async function pool(items,limit,worker){const out=new Array(items.length);let n=0;await Promise.all(Array.from({length:Math.min(limit,items.length)},async()=>{while(n<items.length){const i=n++;try{out[i]=await worker(items[i]);}catch{out[i]=null;}}}));return out.filter(Boolean);}
  async function destinationCandidates(prepared,center,token,status){
    const found=new Map();for(let radius=STEP;radius<=DEST_MAX;radius+=STEP){
      if(token!==journeyState.token)return[];status.textContent=`目的地 ${radius}m：正在由近至遠配對落車站…`;const stops=await groundStops(center,radius);
      for(const p of prepared){const hit=destinationHitByIds(p,stops);if(!hit)continue;const r=makeCandidate(p,hit),key=[r.operator,r.route,r.bound].join("|"),old=found.get(key);if(!old||r.destinationStop.distance<old.destinationStop.distance)found.set(key,r);}if(found.size>=5)break;
    }return[...found.values()];
  }
  function score(r){if(journeyState.mode==="walking")return Number(r.walkMeters||0)*100+Number(r.journeyMinutes||999);if(journeyState.mode==="transfers")return Number(r.transferCount||0)*100000+Number(r.journeyMinutes||999);if(journeyState.mode==="cheapest")return(Number.isFinite(r.fare)?r.fare:999)*1000+Number(r.journeyMinutes||999);return Number(r.journeyMinutes||999)*100+Number(r.walkMeters||0)/20;}
  const resultList=()=>[...journeyState.results].sort((a,b)=>score(a)-score(b)||Number(a.destinationStop?.distance||0)-Number(b.destinationStop?.distance||0)).slice(0,10);
  function renderJourneyResults(){
    const box=$("#journeyResults");if(!box)return;const rows=resultList();if(!rows.length){box.innerHTML='<div class="empty">暫時搵唔到直達巴士或合適港鐵方案；可嘗試輸入更完整街名／大廈名。</div>';return;}
    box.innerHTML=rows.map((r,i)=>{if(r.kind==="mtr"){const names=(r.mtrPath||[]).map(c=>window.dzExtraTransit?.mtrStations?.get(c)?.name_tc||c);return`<article class="journey-card journey-mtr-card"><div class="journey-rank">${i+1}</div><div class="journey-main"><div class="journey-top"><div>${operatorBadge("MTR")} <strong class="journey-route">${escapeHtml(r.route||"港鐵")}</strong></div><div class="journey-eta">約 ${Number(r.journeyMinutes)||0} 分鐘</div></div><div class="journey-title">${escapeHtml(names[0]||r.originStop?.name)} → ${escapeHtml(names.at(-1)||r.destinationStop?.name)}</div><div class="journey-meta">${r.transferCount?`轉 ${r.transferCount} 次 · `:""}${r.stopCount} 站${r.fare!=null?` · $${Number(r.fare).toFixed(1)}`:""}</div></div></article>`;}
      return`<button type="button" class="journey-card journey-card-button" data-journey-result="${i}"><div class="journey-rank">${i+1}</div><div class="journey-main"><div class="journey-top"><div>${operatorBadge(r.operator)} <strong class="journey-route">${escapeHtml(r.route)}</strong></div><div class="journey-eta">約 ${r.journeyMinutes} 分鐘</div></div><div class="journey-title">${escapeHtml(r.originStop.name)} → ${escapeHtml(r.destinationStop.name)}</div><div class="journey-meta">直達 · ${r.stopCount} 站 · 起點步行 ${Math.round(r.originStop.distance)}m · 目的地步行 ${Math.round(r.destinationStop.distance)}m</div><div class="journey-note">往 ${escapeHtml(r.meta?.dest||r.destinationStop.name)} · 下一班 <span data-route-eta="${escapeHtml(r.eta||"")}">${escapeHtml(etaLabel(r.eta))}</span></div></div></button>`;}).join("");
  }
  async function locate(){const p=await window.dzNearestStop?.locate?.();if(p)return p;throw Error("未能取得目前位置");}
  async function runJourneySearch(){
    const token=++journeyState.token,button=$("#journeySearchBtn"),status=$("#journeyStatus"),box=$("#journeyResults"),query=$("#journeyTo")?.value.trim()||"";if(!query){status.textContent="請先輸入目的地名稱、街名或大廈名。";return;}
    button.disabled=true;box.innerHTML='<div class="loading">正在取得起點及目的地座標…</div>';
    try{const[origin,destination]=await Promise.all([journeyState.originLocation?Promise.resolve(journeyState.originLocation):locate(),geocodeDestination(query)]);journeyState.originLocation=origin;$("#journeyFrom").value="我的位置";if(token!==journeyState.token)return;
      status.textContent=`目的地已定位：${destination.name||query}`;const seeds=await originSeeds(origin,token,status);if(!seeds.length)throw Error("起點 400m 內暫時未有可用即時路線");
      const prepared=await pool(seeds,4,prepareSeed);if(token!==journeyState.token)return;const direct=await destinationCandidates(prepared,destination,token,status);if(token!==journeyState.token)return;
      const mtr=await Promise.resolve(window.dzExtraTransit?.mtrJourneyCandidate?.("我的位置",query,origin,destination)).catch(()=>null);journeyState.results=[...direct,...(mtr?[mtr]:[])];renderJourneyResults();
      status.textContent=journeyState.results.length?`由 ${destination.name||query} 中心逐級搜尋完成；只載入命中範圍 tiles／路線。`:"由目的地 50m 擴至 1000m，暫時未有直達方案。";
    }catch(e){if(token!==journeyState.token)return;journeyState.results=[];renderJourneyResults();status.textContent=`搜尋未完成：${e?.message||"請稍後再試"}。`;}finally{if(token===journeyState.token)button.disabled=false;}
  }
  function install(){
    const from=$("#journeyFrom"),swap=$("#journeySwapBtn"),status=$("#journeyStatus");if(from){from.value="我的位置";from.readOnly=true;from.setAttribute("aria-readonly","true");}if(swap)swap.closest(".journey-swap")?.classList.add("hidden");
    if(status)status.textContent="第一階段：我的位置 → 目的地名稱／街名；50m 一級逐步擴大搜尋。";
    $("#journeySearchBtn")?.addEventListener("click",e=>{e.preventDefault();e.stopImmediatePropagation();runJourneySearch();});$("#journeyUseLocation")?.addEventListener("click",async()=>{status.textContent="正在取得目前位置…";try{journeyState.originLocation=await locate();status.textContent="已取得位置，請輸入目的地。";}catch{status.textContent="未能取得位置，請檢查定位權限。";}});
    document.querySelectorAll("[data-journey-mode]").forEach(b=>b.addEventListener("click",()=>{journeyState.mode=b.dataset.journeyMode;document.querySelectorAll("[data-journey-mode]").forEach(x=>x.classList.toggle("active",x===b));renderJourneyResults();}));
    $("#journeyResults")?.addEventListener("click",e=>{const card=e.target.closest("[data-journey-result]");if(!card)return;const r=resultList()[Number(card.dataset.journeyResult)];if(!r||r.kind==="mtr")return;const route=normalizedRoutes().find(x=>x.operator===r.operator&&String(x.route)===r.route&&String(x.bound).toUpperCase()===r.bound&&String(x.serviceType||"1")===r.serviceType);if(route)openRoute(route);});
  }
  window.renderJourneyResults=renderJourneyResults;window.runJourneySearch=runJourneySearch;window.dzJourney={version:VERSION,state:journeyState,tileKeys,groundStops,parseAddressResponse,destinationHitByIds,score,run:runJourneySearch};
  if(document.readyState==="loading")document.addEventListener("DOMContentLoaded",install,{once:true});else install();
})();
