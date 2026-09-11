(() => {
  "use strict";
  const VERSION="4.1.0";
  const API="https://rt.data.gov.hk/v1/transport/mtr/bus/getSchedule";
  const ROUTE_REGION={
    K12:"tai-po",K14:"tai-po",K17:"tai-po",K18:"tai-po",
    K65:"yuen-long-tin-shui-wai",K65A:"yuen-long-tin-shui-wai",K66:"yuen-long-tin-shui-wai",K68:"yuen-long-tin-shui-wai",K73:"yuen-long-tin-shui-wai",K74:"yuen-long-tin-shui-wai",K75A:"yuen-long-tin-shui-wai",K75P:"yuen-long-tin-shui-wai",K75S:"yuen-long-tin-shui-wai",K76:"yuen-long-tin-shui-wai",K76S:"yuen-long-tin-shui-wai",
    "506":"tuen-mun",K51:"tuen-mun",K51A:"tuen-mun",K52:"tuen-mun",K52A:"tuen-mun",K52P:"tuen-mun",K53:"tuen-mun",K53S:"tuen-mun",K54:"tuen-mun",K54A:"tuen-mun",K58:"tuen-mun"
  };
  const ROUTES=Object.entries(ROUTE_REGION).map(([route,region])=>({operator:"MTRB",route,region,orig:"",dest:"",bound:"",serviceType:"1",routeId:route}));
  const bundleCache=new Map(),scheduleCache=new Map();
  const badge=()=>'<span class="badge mtr">港鐵巴士</span>';

  function regionForPosition(pos){
    const centers=[
      ["tai-po",22.449,114.169],
      ["yuen-long-tin-shui-wai",22.455,114.035],
      ["tuen-mun",22.397,113.973]
    ];
    let best=null;
    for(const [region,lat,lon] of centers){const d=distanceMeters(pos.lat,pos.lon,lat,lon);if(!best||d<best.d)best={region,d};}
    return best&&best.d<18000?best.region:null;
  }
  async function loadBundle(region){
    if(!region)return null;if(bundleCache.has(region))return bundleCache.get(region);
    const p=fetch(`./runtime/mtr-bus/${region}.json?v=${encodeURIComponent(window.DZ_BUILD||VERSION)}`,{cache:"force-cache"})
      .then(r=>{if(!r.ok)throw new Error(`HTTP ${r.status}`);return r.json();})
      .catch(()=>({region,routes:[]}));
    bundleCache.set(region,p);return p;
  }
  async function schedule(route){
    route=String(route).toUpperCase();const cached=scheduleCache.get(route);if(cached&&Date.now()-cached.time<15000)return cached.value;
    const c=new AbortController(),timer=setTimeout(()=>c.abort(),10000);
    try{
      const r=await fetch(API,{method:"POST",headers:{"Content-Type":"application/json","Accept":"application/json"},body:JSON.stringify({language:"zh",routeName:route}),signal:c.signal});
      if(!r.ok)throw new Error(`HTTP ${r.status}`);const value=await r.json();scheduleCache.set(route,{time:Date.now(),value});return value;
    }finally{clearTimeout(timer);}
  }
  function minutesForStop(scheduleData,stopId){
    const s=(scheduleData?.busStop||[]).find(x=>String(x.busStopId)===String(stopId));if(!s)return [];
    return (s.bus||[]).map(b=>{const a=Number(b.arrivalTimeInSecond),d=Number(b.departureTimeInSecond),sec=Number.isFinite(d)&&d>=0?d:a;return Number.isFinite(sec)&&sec>=0&&sec<108000?Math.max(0,Math.round(sec/60)):null;}).filter(x=>x!==null).slice(0,3);
  }
  function etaChips(minutes){return minutes.length?minutes.map(m=>`<span class="eta-chip">${m===0?'即將到站':`${m} 分鐘`}</span>`).join(""):'<span class="eta-chip">未有預報</span>';}
  function routeMeta(route,bundle){
    const r=(bundle?.routes||[]).find(x=>String(x.route).toUpperCase()===String(route).toUpperCase());
    if(!r)return null;return {...r,operator:"MTRB",routeId:r.route,serviceType:"1",bound:""};
  }
  function allStops(route){return (route?.directions||[]).flatMap(d=>(d.stops||[]).map(s=>({...s,bound:d.bound})));}

  async function nearby(pos,radius=100){
    const region=regionForPosition(pos);if(!region)return [];
    const bundle=await loadBundle(region),candidates=[];
    for(const route of bundle.routes||[]){
      for(const s of allStops(route)){
        const d=distanceMeters(pos.lat,pos.lon,Number(s.lat),Number(s.long));
        if(Number.isFinite(d)&&d<=radius)candidates.push({route,stop:s,distance:d});
      }
    }
    const byRoute=new Map();for(const c of candidates){const k=c.route.route;if(!byRoute.has(k)||c.distance<byRoute.get(k).distance)byRoute.set(k,c);}
    const out=[];
    for(const c of [...byRoute.values()].slice(0,12)){
      try{
        const data=await schedule(c.route.route),mins=minutesForStop(data,c.stop.id);if(!mins.length)continue;
        out.push({operator:"MTRB",route:c.route.route,dest:c.route.dest||"",eta:new Date(Date.now()+mins[0]*60000).toISOString(),distance:c.distance,stopId:c.stop.id,stopName:c.stop.name_tc||c.stop.id,lat:c.stop.lat,lon:c.stop.long,mtrBusRegion:region});
      }catch{}
    }
    return out.sort((a,b)=>new Date(a.eta)-new Date(b.eta));
  }

  async function renderRoute(r){
    const region=r.region||ROUTE_REGION[String(r.route).toUpperCase()],bundle=await loadBundle(region),meta=routeMeta(r.route,bundle);
    if(!meta)throw new Error("暫時未有路線資料");
    state.selectedRoute={...r,...meta};
    $('#resultsSection')?.classList.add('hidden');$('#routeSection')?.classList.remove('hidden');
    $('#routeHeader').innerHTML=`<div class="route-title"><div><div class="number">${escapeHtml(meta.route)}</div><div class="dest">${escapeHtml(meta.orig)} ↔ ${escapeHtml(meta.dest)}</div>${badge()}${Number.isFinite(meta.fare)?`<div class="route-sub">全程 $${Number(meta.fare).toFixed(1)}</div>`:''}</div></div>`;
    const dirs=meta.directions||[];let active=0;
    const paint=async()=>{
      $('#directionTabs').innerHTML=dirs.map((d,i)=>`<button data-mtrb-dir="${i}" class="${i===active?'active':''}">往 ${escapeHtml(d.stops?.at(-1)?.name_tc||meta.dest)}</button>`).join('');
      const dir=dirs[active]||{stops:[]};$('#stops').innerHTML='<div class="loading">正在載入港鐵巴士 ETA…</div>';
      let data=null;try{data=await schedule(meta.route);}catch{}
      $('#stops').innerHTML=(dir.stops||[]).map((s,i)=>`<div class="stop-row" data-stop-id="${escapeHtml(s.id)}"><div class="stop-no">${i+1}</div><div><div class="stop-name">${escapeHtml(s.name_tc||s.id)}</div><div class="etas">${etaChips(minutesForStop(data,s.id))}</div></div></div>`).join('')||'<div class="empty">暫時未有站點資料。</div>';
      document.querySelectorAll('[data-mtrb-dir]').forEach(b=>b.addEventListener('click',()=>{active=Number(b.dataset.mtrbDir)||0;paint();}));
    };
    await paint();
  }

  const oldBadge=operatorBadge;operatorBadge=function(op){return op==='MTRB'?badge():oldBadge(op);};
  const oldNormalized=normalizedRoutes;normalizedRoutes=function(){return [...oldNormalized(),...ROUTES];};
  const oldOpen=openRoute;openRoute=async function(r){return r?.operator==='MTRB'?renderRoute(r):oldOpen(r);};

  function installFilters(){
    for(const [selector,attr,label] of [['.search-filters','data-search-filter','港鐵巴士'],['#nearbySection .filter-row','data-near-filter','港鐵巴士']]){
      const row=document.querySelector(selector);if(!row||row.querySelector(`[${attr}="MTRB"]`))continue;
      const b=document.createElement('button');b.className='filter mtr-filter';b.setAttribute(attr,'MTRB');b.textContent=label;row.appendChild(b);
      if(attr==='data-search-filter')b.addEventListener('click',()=>{state.searchFilter='MTRB';row.querySelectorAll('[data-search-filter]').forEach(x=>x.classList.toggle('active',x===b));if($('#routeSearch')?.value.trim())renderSearch();});
      else b.addEventListener('click',()=>{state.nearbyFilter='MTRB';state.nearbyExpanded=false;row.querySelectorAll('[data-near-filter]').forEach(x=>x.classList.toggle('active',x===b));renderNearby();});
    }
  }
  installFilters();
  window.dzMtrBus={version:VERSION,routes:ROUTES,regionForPosition,loadBundle,schedule,nearby,renderRoute,stopCoords:async row=>({lat:Number(row.lat),lon:Number(row.lon),name:row.stopName||row.route})};
})();