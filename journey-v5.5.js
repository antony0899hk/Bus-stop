(() => {
  "use strict";
  const VERSION="5.5.6",STEP=50,ORIGIN_MAX=400,DEST_MAX=1000,MAX_ORIGIN_STOPS=8,MAX_DEST_STOPS=8,MAX_SEED_ROUTES=18,MAX_DEST_ROUTES=24,MAX_MIDDLE_ROUTES=48;
  const $=s=>document.querySelector(s),tileCache=new Map(),stopDetailCache=new Map(),terminalTransferCache=new Map(),routeSequenceCache=new Map();
  const journeyState=window.journeyState=window.journeyState||{results:[],mode:"fastest",originLocation:null,destinationLocation:null,token:0};
  if(!("destinationLocation" in journeyState))journeyState.destinationLocation=null;
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
    const groups=new Map();
    for(const x of stop.routes||[]){const row={operator:stop.operator,route:String(x.route),bound:String(x.bound||"O").toUpperCase(),serviceType:String(x.serviceType||x.service_type||"1"),eta:null,originStop:stop};groups.set([row.operator,row.route,row.bound,row.serviceType].join("|"),row);}
    let live=[];try{live=(await json(url,15000)).data||[];}catch{}
    for(const x of live){
      if(!x.route)continue;
      const row={operator:stop.operator,route:String(x.route),bound:String(x.dir||x.bound||"O").toUpperCase(),serviceType:String(x.service_type||"1"),eta:validFutureEta(x.eta)?x.eta:null,originStop:stop};
      const key=[row.operator,row.route,row.bound,row.serviceType].join("|"),old=groups.get(key);
      if(!old||(row.eta&&(!old.eta||new Date(row.eta)<new Date(old.eta))))groups.set(key,row);
    }
    return[...groups.values()];
  }
  const etaSortValue=eta=>eta?new Date(eta).getTime():Infinity;
  async function originSeeds(center,token,status){
    const groups=new Map(),checked=new Set();
    for(let radius=STEP;radius<=ORIGIN_MAX;radius+=STEP){
      if(token!==journeyState.token)return[];status.textContent=`起點 ${radius}m：正在搵附近可搭路線…`;
      for(const stop of(await groundStops(center,radius)).slice(0,MAX_ORIGIN_STOPS)){
        const sk=`${stop.operator}|${stop.id}`;if(checked.has(sk))continue;checked.add(sk);let rows=[];try{rows=await routesAtStop(stop);}catch{}
        for(const row of rows){const key=[row.operator,row.route,row.bound,row.serviceType].join("|"),old=groups.get(key);if(!old||row.originStop.distance<old.originStop.distance||new Date(row.eta)<new Date(old.eta))groups.set(key,row);}
      }if(groups.size>=8)break;
    }
    const ranked=[...groups.values()].sort((a,b)=>a.originStop.distance-b.originStop.distance||etaSortValue(a.eta)-etaSortValue(b.eta)),operating=await pool(ranked,6,async row=>{if(row.eta)return row;const active=await window.dzTimetable?.isOperatingNow?.(row);return active===false?null:row;});
    return operating.slice(0,MAX_SEED_ROUTES);
  }
  async function routeSequence(seed){
    const key=[seed.operator,seed.route,seed.bound,seed.serviceType].join("|");if(routeSequenceCache.has(key))return routeSequenceCache.get(key);
    const p=(async()=>{const dir=seed.bound==="I"?"inbound":"outbound",url=seed.operator==="KMB"?`${KMB_API}/route-stop/${encodeURIComponent(seed.route)}/${dir}/${encodeURIComponent(seed.serviceType)}`:`${CTB_API}/route-stop/ctb/${encodeURIComponent(seed.route)}/${dir}`,j=await json(url,300000);return(j.data||[]).filter(x=>seed.operator!=="CTB"||!x.dir||String(x.dir).toUpperCase()===seed.bound).map((x,i)=>({id:String(x.stop||x.stop_id),seq:Number(x.seq||i+1)})).sort((a,b)=>a.seq-b.seq);})();
    routeSequenceCache.set(key,p);return p;
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
    const s=p.seed,stopCount=hit.index-p.originIndex,walkMeters=s.originStop.distance+hit.stop.distance,wait=s.eta?Math.max(0,etaMinutes(s.eta)||0):8;
    return{kind:"direct",operator:s.operator,route:s.route,bound:s.bound,serviceType:s.serviceType,originStop:s.originStop,destinationStop:hit.stop,stopCount,walkMeters,transferCount:0,eta:s.eta,fare:null,meta:p.meta,journeyMinutes:Math.max(1,Math.round(wait+stopCount*2.1+walkMeters/75))};
  }
  async function pool(items,limit,worker){const out=new Array(items.length);let n=0;await Promise.all(Array.from({length:Math.min(limit,items.length)},async()=>{while(n<items.length){const i=n++;try{out[i]=await worker(items[i]);}catch{out[i]=null;}}}));return out.filter(Boolean);}
  async function destinationCandidates(prepared,center,token,status){
    const found=new Map();for(let radius=STEP;radius<=DEST_MAX;radius+=STEP){
      if(token!==journeyState.token)return[];status.textContent=`目的地 ${radius}m：正在由近至遠配對落車站…`;const stops=await groundStops(center,radius);
      for(const p of prepared){const hit=destinationHitByIds(p,stops);if(!hit)continue;const r=makeCandidate(p,hit),key=[r.operator,r.route,r.bound].join("|"),old=found.get(key);if(!old||r.destinationStop.distance<old.destinationStop.distance)found.set(key,r);}if(found.size>=5)break;
    }return[...found.values()];
  }
  function transferHit(first,second){
    const beforeDestination=new Map();
    for(let j=0;j<second.originIndex;j++)beforeDestination.set(second.sequence[j].id,j);
    let best=null;
    for(let i=first.originIndex+1;i<first.sequence.length;i++){
      const j=beforeDestination.get(first.sequence[i].id);if(j==null)continue;
      const cost=(i-first.originIndex)+(second.originIndex-j);if(!best||cost<best.cost)best={firstIndex:i,secondIndex:j,stopId:first.sequence[i].id,cost};
    }
    return best;
  }
  async function stopDetail(operator,id){
    const key=`${operator}|${id}`;if(stopDetailCache.has(key))return stopDetailCache.get(key);
    const p=(async()=>{try{const url=operator==="KMB"?`${KMB_API}/stop/${encodeURIComponent(id)}`:`${CTB_API}/stop/${encodeURIComponent(id)}`,j=await json(url,3600000),s=j.data||{};return{id:String(id),name:s.name_tc||s.name_en||String(id),lat:Number(s.lat),lon:Number(s.long)};}catch{return{id:String(id),name:String(id)};}})();
    stopDetailCache.set(key,p);return p;
  }
  async function terminalTransferOptions(first){
    const key=[first.seed.operator,first.seed.route,first.seed.bound,first.seed.serviceType,first.originIndex].join("|");if(terminalTransferCache.has(key))return terminalTransferCache.get(key);
    const p=(async()=>{const out=[],i=first.sequence.length-1;if(i<=first.originIndex)return out;const detail=await stopDetail(first.seed.operator,first.sequence[i].id);if(!Number.isFinite(detail.lat)||!Number.isFinite(detail.lon))return out;const nearby=(await groundStops(detail,150)).filter(x=>x.operator===first.seed.operator);out.push({firstIndex:i,detail,nearby});return out;})();
    terminalTransferCache.set(key,p);return p;
  }
  function terminalTransferHit(second,options){
    const beforeDestination=new Map();for(let j=0;j<second.originIndex;j++)beforeDestination.set(second.sequence[j].id,j);let best=null;
    for(const option of options)for(const stop of option.nearby){const j=beforeDestination.get(String(stop.id));if(j==null)continue;const cost=(second.originIndex-j)+Number(stop.distance||0)/75;if(!best||cost<best.cost)best={firstIndex:option.firstIndex,secondIndex:j,stopId:String(stop.id),cost,transferStop:option.detail,transferWalkMeters:Number(stop.distance||0)};}
    return best;
  }
  async function staticSeedsAtStops(stops,limit){
    const groups=new Map();
    for(const stop of stops)for(const ref of stop.routes||[]){
      if(Number(ref.total)>0&&Number(ref.seq)>=Number(ref.total))continue;
      const row={operator:stop.operator,route:String(ref.route),bound:String(ref.bound||"O").toUpperCase(),serviceType:String(ref.serviceType||"1"),eta:null,originStop:{...stop,distance:Number(stop.distance||0)},routeSeq:Number(ref.seq)||999};
      const key=[row.operator,row.route,row.bound,row.serviceType].join("|"),old=groups.get(key);if(!old||row.routeSeq<old.routeSeq||row.routeSeq===old.routeSeq&&row.originStop.distance<old.originStop.distance)groups.set(key,row);
    }
    const ranked=[...groups.values()].sort((a,b)=>a.routeSeq-b.routeSeq||a.originStop.distance-b.originStop.distance||Number(a.serviceType)-Number(b.serviceType)),checked=await pool(ranked.slice(0,limit*2),6,async row=>{const active=await window.dzTimetable?.isOperatingNow?.(row);return active===false?null:row;});
    return checked.slice(0,limit);
  }
  async function makeTransferCandidate(first,second,hit){
    const a=first.seed,b=second.seed,transferStop=hit.transferStop||await stopDetail(a.operator,hit.stopId),firstStops=hit.firstIndex-first.originIndex,secondStops=second.originIndex-hit.secondIndex,transferWalkMeters=Number(hit.transferWalkMeters||0),walkMeters=a.originStop.distance+b.originStop.distance+transferWalkMeters,firstWait=a.eta?Math.max(0,etaMinutes(a.eta)||0):8;
    return{kind:"transfer",operator:a.operator,route:a.route,bound:a.bound,serviceType:a.serviceType,originStop:a.originStop,destinationStop:b.originStop,transferStop,transferStopName:transferStop.name,transferWalkMeters,stopCount:firstStops+secondStops,walkMeters,transferCount:1,eta:a.eta,fare:null,first:{operator:a.operator,route:a.route,bound:a.bound,serviceType:a.serviceType,meta:first.meta,stopCount:firstStops},second:{operator:b.operator,route:b.route,bound:b.bound,serviceType:b.serviceType,meta:second.meta,stopCount:secondStops},journeyMinutes:Math.max(1,Math.round(firstWait+8+6+(firstStops+secondStops)*2.1+walkMeters/75))};
  }
  async function makeDoubleTransferCandidate(first,middle,last,firstOption,hit){
    const a=first.seed,b=middle.seed,c=last.seed,secondTransfer=await stopDetail(b.operator,hit.stopId),firstStops=firstOption.firstIndex-first.originIndex,middleStops=hit.firstIndex-middle.originIndex,lastStops=last.originIndex-hit.secondIndex,firstWalk=Number(b.originStop.distance||0),walkMeters=Number(a.originStop.distance||0)+Number(c.originStop.distance||0)+firstWalk,firstWait=a.eta?Math.max(0,etaMinutes(a.eta)||0):8;
    return{kind:"multi_transfer",operator:a.operator,route:a.route,bound:a.bound,serviceType:a.serviceType,originStop:a.originStop,destinationStop:c.originStop,transferCount:2,stopCount:firstStops+middleStops+lastStops,walkMeters,eta:a.eta,fare:null,journeyMinutes:Math.max(1,Math.round(firstWait+16+12+(firstStops+middleStops+lastStops)*2.1+walkMeters/75)),transfers:[firstOption.detail,secondTransfer],legs:[{operator:a.operator,route:a.route,bound:a.bound,serviceType:a.serviceType,meta:first.meta,stopCount:firstStops},{operator:b.operator,route:b.route,bound:b.bound,serviceType:b.serviceType,meta:middle.meta,stopCount:middleStops},{operator:c.operator,route:c.route,bound:c.bound,serviceType:c.serviceType,meta:last.meta,stopCount:lastStops}]};
  }
  async function destinationTransferCandidates(prepared,center,token,status){
    const checked=new Set(),groups=new Map(),found=new Map();
    for(let radius=STEP;radius<=DEST_MAX;radius+=STEP){
      if(token!==journeyState.token)return[];status.textContent=`目的地 ${radius}m：正在配對一程轉車…`;
      for(const stop of(await groundStops(center,radius)).slice(0,MAX_DEST_STOPS)){
        const sk=`${stop.operator}|${stop.id}`;if(checked.has(sk))continue;checked.add(sk);let rows=[];try{rows=await routesAtStop(stop);}catch{}
        for(const row of rows){const key=[row.operator,row.route,row.bound,row.serviceType].join("|"),old=groups.get(key);if(!old||row.originStop.distance<old.originStop.distance||etaSortValue(row.eta)<etaSortValue(old.eta))groups.set(key,row);}
      }
      const destinationPrepared=await pool([...groups.values()].slice(0,MAX_DEST_ROUTES),4,prepareSeed);
      for(const first of prepared){
        const unmatched=[];
        for(const second of destinationPrepared){
          if(first.seed.operator!==second.seed.operator||first.seed.route===second.seed.route&&first.seed.bound===second.seed.bound)continue;
          const hit=transferHit(first,second);if(!hit){unmatched.push(second);continue;}
          const key=[first.seed.operator,first.seed.route,first.seed.bound,second.seed.route,second.seed.bound].join("|");
          if(found.has(key))continue;found.set(key,await makeTransferCandidate(first,second,hit));
        }
        if(found.size>=5)continue;
        const terminalOptions=await terminalTransferOptions(first);
        for(const second of unmatched){const hit=terminalTransferHit(second,terminalOptions);if(!hit)continue;const key=[first.seed.operator,first.seed.route,first.seed.bound,second.seed.route,second.seed.bound].join("|");if(found.has(key))continue;found.set(key,await makeTransferCandidate(first,second,hit));if(found.size>=5)break;}
      }
      if(!found.size&&destinationPrepared.length){
        for(const first of prepared.slice(0,6)){
          const options=await terminalTransferOptions(first);if(!options.length)continue;
          const middleSeeds=await staticSeedsAtStops(options.flatMap(x=>x.nearby),MAX_MIDDLE_ROUTES),middlePrepared=await pool(middleSeeds,6,prepareSeed);
          for(const middle of middlePrepared){
            if(middle.seed.route===first.seed.route&&middle.seed.bound===first.seed.bound)continue;
            for(const last of destinationPrepared){
              if(middle.seed.operator!==last.seed.operator)continue;const hit=transferHit(middle,last);if(!hit)continue;
              const firstOption=options.find(x=>x.nearby.some(s=>String(s.id)===String(middle.seed.originStop.id)))||options[0],key=[first.seed.route,middle.seed.route,last.seed.route].join(">");if(found.has(key))continue;found.set(key,await makeDoubleTransferCandidate(first,middle,last,firstOption,hit));if(found.size>=5)break;
            }
            if(found.size>=5)break;
          }
          if(found.size>=5)break;
        }
      }
      if(found.size>=5)break;
    }
    return[...found.values()];
  }
  function score(r){if(journeyState.mode==="walking")return Number(r.walkMeters||0)*100+Number(r.journeyMinutes||999);if(journeyState.mode==="transfers")return Number(r.transferCount||0)*100000+Number(r.journeyMinutes||999);if(journeyState.mode==="cheapest")return(Number.isFinite(r.fare)?r.fare:999)*1000+Number(r.journeyMinutes||999);return Number(r.journeyMinutes||999)*100+Number(r.walkMeters||0)/20;}
  const resultList=()=>{const sorted=[...journeyState.results].sort((a,b)=>score(a)-score(b)||Number(a.destinationStop?.distance||0)-Number(b.destinationStop?.distance||0)),rows=sorted.slice(0,10),mtr=sorted.find(r=>r.kind==="mtr");if(mtr&&!rows.includes(mtr)){if(rows.length>=10)rows[rows.length-1]=mtr;else rows.push(mtr);rows.sort((a,b)=>score(a)-score(b));}return rows;};
  function renderJourneyResults(){
    const box=$("#journeyResults");if(!box)return;const rows=resultList();if(!rows.length){box.innerHTML='<div class="empty">暫時搵唔到直達、兩次轉車內或合適港鐵方案；可嘗試輸入更完整街名／大廈名。</div>';return;}
    box.innerHTML=rows.map((r,i)=>{if(r.kind==="mtr"){const names=(r.mtrPath||[]).map(c=>window.dzExtraTransit?.mtrStations?.get(c)?.name_tc||c);return`<article class="journey-card journey-mtr-card"><div class="journey-rank">${i+1}</div><div class="journey-main"><div class="journey-top"><div>${operatorBadge("MTR")} <strong class="journey-route">${escapeHtml(r.route||"港鐵")}</strong></div><div class="journey-eta">約 ${Number(r.journeyMinutes)||0} 分鐘</div></div><div class="journey-title">${escapeHtml(names[0]||r.originStop?.name)} → ${escapeHtml(names.at(-1)||r.destinationStop?.name)}</div><div class="journey-meta">${r.transferCount?`轉 ${r.transferCount} 次 · `:""}${r.stopCount} 站 · 接駁步行約 ${Math.round(r.walkMeters||0)}m${r.fare!=null?` · $${Number(r.fare).toFixed(1)}`:""}</div></div></article>`;}
      if(r.kind==="multi_transfer")return`<article class="journey-card journey-transfer-card"><div class="journey-rank">${i+1}</div><div class="journey-main"><div class="journey-top"><div>${r.legs.map((leg,n)=>`${n?'<span class="journey-arrow">→</span> ':''}${operatorBadge(leg.operator)} <button type="button" class="journey-leg-link" data-journey-result="${i}" data-journey-leg="${n}" aria-label="查看 ${escapeHtml(leg.route)} 路線資料">${escapeHtml(leg.route)}</button>`).join(" ")}</div><div class="journey-eta">約 ${r.journeyMinutes} 分鐘</div></div><div class="journey-title">${escapeHtml(r.originStop.name)} → ${escapeHtml(r.transfers[0]?.name||"轉車站")} → ${escapeHtml(r.transfers[1]?.name||"轉車站")} → ${escapeHtml(r.destinationStop.name)}</div><div class="journey-meta">轉 2 次 · ${r.stopCount} 站 · 全程步行約 ${Math.round(r.walkMeters)}m</div><div class="journey-note">每一程路線號碼都可以撳入路線資料 · 第一程下一班 ${escapeHtml(etaLabel(r.eta))}</div></div></article>`;
      if(r.kind==="transfer")return`<article class="journey-card journey-transfer-card"><div class="journey-rank">${i+1}</div><div class="journey-main"><div class="journey-top"><div>${operatorBadge(r.first.operator)} <button type="button" class="journey-leg-link" data-journey-result="${i}" data-journey-leg="0" aria-label="查看 ${escapeHtml(r.first.route)} 路線資料">${escapeHtml(r.first.route)}</button> <span class="journey-arrow">→</span> ${operatorBadge(r.second.operator)} <button type="button" class="journey-leg-link" data-journey-result="${i}" data-journey-leg="1" aria-label="查看 ${escapeHtml(r.second.route)} 路線資料">${escapeHtml(r.second.route)}</button></div><div class="journey-eta">約 ${r.journeyMinutes} 分鐘</div></div><div class="journey-title">${escapeHtml(r.originStop.name)} → ${escapeHtml(r.transferStopName)} → ${escapeHtml(r.destinationStop.name)}</div><div class="journey-meta">轉 1 次 · ${r.stopCount} 站 · 起點步行 ${Math.round(r.originStop.distance)}m · 目的地步行 ${Math.round(r.destinationStop.distance)}m</div><div class="journey-note">每一程路線號碼都可以撳入路線資料 · 第一程下一班 ${escapeHtml(etaLabel(r.eta))}</div></div></article>`;
      return`<button type="button" class="journey-card journey-card-button" data-journey-result="${i}"><div class="journey-rank">${i+1}</div><div class="journey-main"><div class="journey-top"><div>${operatorBadge(r.operator)} <strong class="journey-route">${escapeHtml(r.route)}</strong></div><div class="journey-eta">約 ${r.journeyMinutes} 分鐘</div></div><div class="journey-title">${escapeHtml(r.originStop.name)} → ${escapeHtml(r.destinationStop.name)}</div><div class="journey-meta">直達 · ${r.stopCount} 站 · 起點步行 ${Math.round(r.originStop.distance)}m · 目的地步行 ${Math.round(r.destinationStop.distance)}m</div><div class="journey-note">往 ${escapeHtml(r.meta?.dest||r.destinationStop.name)} · 下一班 <span data-route-eta="${escapeHtml(r.eta||"")}">${escapeHtml(etaLabel(r.eta))}</span></div></div></button>`;}).join("");
  }
  async function locate(){const p=await window.dzNearestStop?.locate?.();if(p)return p;throw Error("未能取得目前位置");}
  async function runJourneySearch(){
    const token=++journeyState.token,button=$("#journeySearchBtn"),status=$("#journeyStatus"),box=$("#journeyResults"),query=$("#journeyTo")?.value.trim()||"";if(!query&&!journeyState.destinationLocation){status.textContent="請輸入目的地，或者用地圖揀位。";return;}
    button.disabled=true;box.innerHTML='<div class="loading">正在取得起點及目的地座標…</div>';
    try{const[origin,destination]=await Promise.all([journeyState.originLocation?Promise.resolve(journeyState.originLocation):locate(),journeyState.destinationLocation?Promise.resolve(journeyState.destinationLocation):geocodeDestination(query)]);journeyState.originLocation=origin;$("#journeyFrom").value="我的位置";if(token!==journeyState.token)return;
      status.textContent=`目的地已定位：${destination.name||query}`;const seeds=await originSeeds(origin,token,status);if(!seeds.length)throw Error("起點 400m 內暫時未有可用路線");
      const prepared=await pool(seeds,4,prepareSeed);if(token!==journeyState.token)return;const direct=await destinationCandidates(prepared,destination,token,status);if(token!==journeyState.token)return;
      const transfers=direct.length>=5?[]:await destinationTransferCandidates(prepared,destination,token,status);if(token!==journeyState.token)return;
      const destinationLabel=destination.name||query||"地圖選擇位置",mtr=await Promise.resolve(window.dzExtraTransit?.mtrJourneyCandidate?.("我的位置",destinationLabel,origin,destination)).catch(()=>null);journeyState.results=[...direct,...transfers,...(mtr?[mtr]:[])];renderJourneyResults();
      status.textContent=journeyState.results.length?`由 ${destination.name||query} 中心逐級搜尋完成；已比較直達、最多兩次轉車及港鐵。`:"由目的地 50m 擴至 1000m，暫時未有兩次轉車內方案。";
    }catch(e){if(token!==journeyState.token)return;journeyState.results=[];renderJourneyResults();status.textContent=`搜尋未完成：${e?.message||"請稍後再試"}。`;}finally{if(token===journeyState.token)button.disabled=false;}
  }
  function shareDestination(){
    const to=$("#journeyTo"),status=$("#journeyStatus"),q=to?.value.trim()||"";
    if(!q&&!journeyState.destinationLocation){status.textContent="請先輸入目的地或者用地圖揀位。";return;}
    const name=prompt("對方名稱（選填）","")||"";
    const u=new URL(location.href);u.searchParams.set("dzshare","1");if(q)u.searchParams.set("to",q);if(name.trim())u.searchParams.set("name",name.trim());
    const d=journeyState.destinationLocation;if(d){u.searchParams.set("lat",Number(d.lat).toFixed(6));u.searchParams.set("lon",Number(d.lon).toFixed(6));u.searchParams.set("label",d.name||q||"分享目的地");}
    const data={title:"到站 · 分享目的地",text:q?`一齊去：${q}`:"一齊去呢個目的地",url:u.toString()};
    if(navigator.share){navigator.share(data).then(()=>status.textContent="已開啟分享，可選 WhatsApp、Signal 或其他 Apps。").catch(e=>{if(e?.name!=="AbortError")status.textContent="未能分享，請再試。";});return;}
    navigator.clipboard?.writeText(u.toString()).then(()=>status.textContent="分享連結已複製，可貼到 WhatsApp、Signal 或其他 Apps。").catch(()=>status.textContent="未能複製分享連結。");
  }
  function loadSharedDestination(){
    const p=new URLSearchParams(location.search);if(p.get("dzshare")!=="1")return;const to=$("#journeyTo"),status=$("#journeyStatus"),q=p.get("to")||p.get("label")||"",lat=Number(p.get("lat")),lon=Number(p.get("lon")),name=p.get("name")||"";
    if(to&&q)to.value=q;if(Number.isFinite(lat)&&Number.isFinite(lon))journeyState.destinationLocation={lat,lon,name:p.get("label")||q||"分享目的地"};
    if(status)status.textContent=`收到${name?" "+name+" 嘅":""}目的地。撳「我的位置」，再搜尋路線。`;
    document.querySelector(".journey-planner")?.scrollIntoView({behavior:"smooth",block:"start"});
  }
  function install(){
    const from=$("#journeyFrom"),to=$("#journeyTo"),swap=$("#journeySwapBtn"),status=$("#journeyStatus");if(from){from.value="我的位置";from.readOnly=true;from.setAttribute("aria-readonly","true");}if(swap)swap.closest(".journey-swap")?.classList.add("hidden");
    if(to&&!$("#journeyMapPick")){const row=document.createElement("div"),pick=document.createElement("button");row.className="journey-destination-row";to.parentNode.insertBefore(row,to);row.appendChild(to);pick.id="journeyMapPick";pick.type="button";pick.textContent="地圖揀位";row.appendChild(pick);pick.addEventListener("click",async()=>{status.textContent="正在開啟地圖…";try{const origin=journeyState.originLocation||(journeyState.originLocation=await locate()),selected=await window.dzMap?.pickDestination?.({initial:origin});if(!selected){status.textContent="已取消地圖揀位。";return;}journeyState.destinationLocation=selected;to.value="地圖選擇位置";status.textContent=`已喺地圖揀位（${selected.lat.toFixed(5)}, ${selected.lon.toFixed(5)}），可搜尋路線。`;}catch(e){status.textContent=`未能開啟地圖：${e?.message||"請稍後再試"}。`;}});to.addEventListener("input",()=>{if(to.value!=="地圖選擇位置")journeyState.destinationLocation=null;});}
    if(status)status.textContent="我的位置 → 輸入目的地或地圖揀位；50m 一級逐步擴大，支援直達及最多兩次轉車。";$("#journeyShareDestination")?.addEventListener("click",shareDestination);loadSharedDestination();
    $("#journeySearchBtn")?.addEventListener("click",e=>{e.preventDefault();e.stopImmediatePropagation();runJourneySearch();});$("#journeyUseLocation")?.addEventListener("click",async e=>{const button=e.currentTarget,old=button.textContent;button.disabled=true;button.textContent="定位中…";status.textContent="正在取得目前位置…";try{journeyState.originLocation=await locate();from.value="我的位置";button.textContent="✓ 已定位";status.textContent="已取得位置，請輸入目的地。";}catch{button.textContent="定位失敗";status.textContent="未能取得位置，請檢查 Safari 定位權限。";}finally{setTimeout(()=>{button.disabled=false;button.textContent=old;},1800);}});
    document.querySelectorAll("[data-journey-mode]").forEach(b=>b.addEventListener("click",()=>{journeyState.mode=b.dataset.journeyMode;document.querySelectorAll("[data-journey-mode]").forEach(x=>x.classList.toggle("active",x===b));renderJourneyResults();}));
    $("#journeyResults")?.addEventListener("click",e=>{const target=e.target.closest("[data-journey-result]");if(!target)return;const r=resultList()[Number(target.dataset.journeyResult)];if(!r||r.kind==="mtr")return;const legs=r.kind==="transfer"?[r.first,r.second]:r.kind==="multi_transfer"?r.legs:[r],requested=target.hasAttribute("data-journey-leg")?Number(target.dataset.journeyLeg):0,leg=legs[requested];if(!leg)return;const route=normalizedRoutes().find(x=>x.operator===leg.operator&&String(x.route)===leg.route&&String(x.bound).toUpperCase()===leg.bound&&String(x.serviceType||"1")===leg.serviceType);if(route)openRoute(route);});
  }
  window.renderJourneyResults=renderJourneyResults;window.runJourneySearch=runJourneySearch;window.dzJourney={version:VERSION,state:journeyState,tileKeys,groundStops,parseAddressResponse,destinationHitByIds,transferHit,score,run:runJourneySearch};
  if(document.readyState==="loading")document.addEventListener("DOMContentLoaded",install,{once:true});else install();
})();
