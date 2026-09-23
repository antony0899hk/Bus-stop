(() => {
  "use strict";
  const $=s=>document.querySelector(s);
  const routeGeometryCache=new Map();
  const journeyGeometryCache=new Map();
  let leafletPromise=null;

  const mapFor=op=>op==="KMB"?state.kmbStops:op==="CTB"?state.ctbStops:op==="GMB"?state.gmbStops:null;
  const point=(op,id)=>{const s=mapFor(op)?.get(String(id));const lat=Number(s?.lat??s?.latitude),lon=Number(s?.long??s?.lng??s?.longitude);return Number.isFinite(lat)&&Number.isFinite(lon)?{lat,lon,name:s?.name_tc||s?.name||String(id)}:null;};
  const routeKey=r=>[r?.operator,r?.route,r?.bound||"",r?.serviceType||"1",r?.routeId||"",r?.routeSeq||""].join("|");

  async function ensureLeaflet(){
    if(window.L)return window.L;if(leafletPromise)return leafletPromise;
    leafletPromise=new Promise((resolve,reject)=>{
      if(!document.querySelector('link[data-dz-leaflet]')){const l=document.createElement('link');l.rel='stylesheet';l.href='https://unpkg.com/leaflet@1.9.4/dist/leaflet.css';l.dataset.dzLeaflet='1';document.head.appendChild(l);}
      const s=document.createElement('script');s.src='https://unpkg.com/leaflet@1.9.4/dist/leaflet.js';s.async=true;s.onload=()=>resolve(window.L);s.onerror=()=>reject(new Error('地圖元件載入失敗'));document.head.appendChild(s);
    });
    return leafletPromise;
  }

  async function fetchRouteGeometry(r){
    const key=routeKey(r);if(routeGeometryCache.has(key))return routeGeometryCache.get(key);
    const task=(async()=>{
      let rows=[];
      if(r.operator==='KMB'){
        const dir=r.bound==='O'?'outbound':'inbound';
        const j=await getJSON(`${KMB_API}/route-stop/${encodeURIComponent(r.route)}/${dir}/${encodeURIComponent(r.serviceType||'1')}`,{ttl:300000,retries:0});rows=j.data||[];
      }else if(r.operator==='CTB'){
        const dir=r.bound==='I'?'inbound':'outbound';
        const j=await getJSON(`${CTB_API}/route-stop/ctb/${encodeURIComponent(r.route)}/${dir}`,{ttl:300000,retries:0});rows=(j.data||[]).filter(x=>!x.dir||x.dir===r.bound);
      }else if(r.operator==='GMB'&&r.routeId){
        const j=await getJSON(`${GMB_API}/route-stop/${encodeURIComponent(r.routeId)}/${encodeURIComponent(r.routeSeq||r.serviceType||1)}`,{ttl:300000,retries:0});rows=(j.data?.route_stops||[]).map(x=>({stop:String(x.stop_id),seq:x.stop_seq}));
      }
      const pts=rows.map((x,i)=>{const p=point(r.operator,x.stop||x.stop_id);return p?{...p,id:String(x.stop||x.stop_id),seq:Number(x.seq||x.stop_seq||i+1)}:null;}).filter(Boolean);
      return {points:pts,route:r};
    })().catch(()=>({points:[],route:r}));
    routeGeometryCache.set(key,task);return task;
  }

  function indexRoute(op,route,bound,serviceType='1'){
    const idx=op==='KMB'?journeyState?.kmbIndex:op==='CTB'?journeyState?.ctbIndex:null;if(!idx)return null;
    for(const x of idx.byRoute.values())if(String(x.route)===String(route)&&(!bound||String(x.bound)===String(bound))&&(!serviceType||String(x.serviceType)===String(serviceType)))return x;
    return null;
  }
  function indexSegment(op,route,bound,serviceType,startId,endId){
    const r=indexRoute(op,route,bound,serviceType);if(!r)return[];let a=r.stops.findIndex(x=>String(x.stop)===String(startId)),b=r.stops.findIndex((x,i)=>i>=Math.max(0,a)&&String(x.stop)===String(endId));if(a<0||b<a)return[];
    return r.stops.slice(a,b+1).map(x=>point(op,x.stop)).filter(Boolean);
  }
  function mtrPoint(code){
    const st=window.dzExtraTransit?.mtrStations?.get(code);if(!st)return null;
    const q=String(st.name_tc||'').replace(/站$/,'');const hits=typeof allJourneyStops==='function'?allJourneyStops().filter(s=>Number.isFinite(s.lat)&&Number.isFinite(s.lon)&&String(s.name||'').includes(q)):[];
    if(!hits.length)return null;return{lat:hits.reduce((n,s)=>n+s.lat,0)/hits.length,lon:hits.reduce((n,s)=>n+s.lon,0)/hits.length,name:st.name_tc||code};
  }
  function seg(type,points,label){return points?.length>1?{type,points,label}:null;}
  async function journeyGeometry(r){
    const key=r?._dzMapKey||(r._dzMapKey=`j-${Math.random().toString(36).slice(2)}`);if(journeyGeometryCache.has(key))return journeyGeometryCache.get(key);
    const task=(async()=>{
      const segments=[];
      if(r?._dzMtrGraph){
        const a=r._dzAccess?.leg,b=r._dzExit?.leg;
        if(a){const p=indexSegment(a.operator,a.route,a.bound,a.serviceType,a.originStop?.id,a.destinationStop?.id||a.transferStopId);const s=seg('bus',p,a.route);if(s)segments.push(s);}
        const mp=(r._dzMtrPath||[]).map(mtrPoint).filter(Boolean);const ms=seg('mtr',mp,(r._dzMtrLines||[]).join(' → '));if(ms)segments.push(ms);
        if(b){const p=indexSegment(b.operator,b.route,b.bound,b.serviceType,b.originStop?.id||b.transferStopId,b.destinationStop?.id);const s=seg('bus',p,b.route);if(s)segments.push(s);}
      }else if(r?.kind==='transfer'){
        let p=indexSegment(r.first?.operator,r.first?.route,r.first?.bound,r.first?.serviceType,r.first?.originStop?.id,r.first?.transferStopId);let s=seg('bus',p,r.first?.route);if(s)segments.push(s);
        const tp=point(r.second?.operator,r.transferStopId),fp=point(r.first?.operator,r.first?.transferStopId);if(fp&&tp&&Math.hypot(fp.lat-tp.lat,fp.lon-tp.lon)>0.00005)segments.push({type:'walk',points:[fp,tp],label:'步行轉車'});
        p=indexSegment(r.second?.operator,r.second?.route,r.second?.bound,r.second?.serviceType,r.transferStopId,r.second?.destinationStop?.id);s=seg('bus',p,r.second?.route);if(s)segments.push(s);
      }else if(r?.kind==='direct'){
        if(r.operator==='MTR'&&r._dzMtrPath){const p=r._dzMtrPath.map(mtrPoint).filter(Boolean),s=seg('mtr',p,r.route);if(s)segments.push(s);}
        else {let p=indexSegment(r.operator,r.route,r.bound,r.serviceType,r.originStop?.id,r.destinationStop?.id);if(p.length<2&&['KMB','CTB','GMB'].includes(r.operator)){const g=await fetchRouteGeometry(r);const a=g.points.findIndex(x=>x.id===String(r.originStop?.id)),b=g.points.findIndex((x,i)=>i>=Math.max(0,a)&&x.id===String(r.destinationStop?.id));if(a>=0&&b>=a)p=g.points.slice(a,b+1);}const s=seg('bus',p,r.route);if(s)segments.push(s);}
      }
      const all=segments.flatMap(x=>x.points);return{segments,all};
    })();journeyGeometryCache.set(key,task);return task;
  }

  function prewarmJourney(){const rows=(journeyState?.results||[]).slice(0,5);rows.forEach(r=>{journeyGeometry(r).catch(()=>{});});}
  function prewarmRoutes(rows){(rows||[]).slice(0,6).forEach(r=>{if(['KMB','CTB'].includes(r.operator))fetchRouteGeometry(r).catch(()=>{});});}

  function addMarkers(L,map,points){if(!points.length)return;L.circleMarker([points[0].lat,points[0].lon],{radius:7,weight:3,fillOpacity:1}).addTo(map).bindTooltip('起點');L.circleMarker([points.at(-1).lat,points.at(-1).lon],{radius:7,weight:3,fillOpacity:1}).addTo(map).bindTooltip('終點');}
  async function renderMap(el,geometry,{showStops=false}={}){
    if(!el)return;el.innerHTML='<div class="dz-map-loading">正在載入路線地圖…</div>';
    const L=await ensureLeaflet();if(!geometry?.all?.length){el.innerHTML='<div class="dz-map-empty">暫時未有足夠座標畫出路線。</div>';return;}
    el.innerHTML='';const map=L.map(el,{zoomControl:true,attributionControl:true});L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',{maxZoom:19,attribution:'© OpenStreetMap'}).addTo(map);
    for(const s of geometry.segments){const latlngs=s.points.map(p=>[p.lat,p.lon]);L.polyline(latlngs,{weight:s.type==='mtr'?6:5,opacity:.88,dashArray:s.type==='walk'?'8 8':null}).addTo(map).bindTooltip(s.label||'路線');if(showStops)s.points.forEach((p,i)=>L.circleMarker([p.lat,p.lon],{radius:i===0||i===s.points.length-1?5:3,weight:1,fillOpacity:1}).addTo(map).bindTooltip(p.name||''));}
    addMarkers(L,map,geometry.all);const bounds=L.latLngBounds(geometry.all.map(p=>[p.lat,p.lon]));map.fitBounds(bounds.pad(.12));setTimeout(()=>map.invalidateSize(),80);
  }

  async function showRouteMap(r){
    const g=await fetchRouteGeometry(r);const host=document.createElement('div');host.className='dz-route-map-card';host.innerHTML='<div class="dz-map-head"><strong>路線地圖</strong><span>按站序顯示</span></div><div class="dz-map-canvas"></div>';
    const ref=$("#directionTabs");ref?.insertAdjacentElement('afterend',host);await renderMap(host.querySelector('.dz-map-canvas'),{segments:[{type:'bus',points:g.points,label:String(r.route)}],all:g.points},{showStops:true});
  }

  async function openJourneyMap(card,r){
    document.querySelector('.dz391-map-backdrop')?.remove();const wrap=document.createElement('div');wrap.className='dz391-map-backdrop';wrap.innerHTML='<section class="dz391-map-sheet" role="dialog" aria-modal="true"><div class="dz391-map-handle"></div><button class="dz391-map-close" type="button" aria-label="關閉">×</button><div class="dz391-map-title">路線地圖</div><div class="dz391-map-sub">'+escapeHtml((card.querySelector('.journey-lines')?.textContent||card.querySelector('.journey-route')?.textContent||'點對點方案').replace(/\s+/g,' ').trim())+'</div><div class="dz391-map-canvas"></div></section>';document.body.appendChild(wrap);wrap.addEventListener('click',e=>{if(e.target===wrap||e.target.closest('.dz391-map-close'))wrap.remove();});
    const g=await journeyGeometry(r);await renderMap(wrap.querySelector('.dz391-map-canvas'),g,{showStops:false});
  }

  if(typeof renderSearch==='function'){
    const old=renderSearch;renderSearch=function(){const out=old.apply(this,arguments);try{prewarmRoutes(routeMatches($("#routeSearch")?.value||''));}catch{}return out;};
  }
  if(typeof openRoute==='function'){
    const old=openRoute;openRoute=async function(r){document.querySelector('.dz-route-map-card')?.remove();const out=await old.apply(this,arguments);if(['KMB','CTB'].includes(r?.operator))showRouteMap(r).catch(()=>{});return out;};
  }
  if(typeof renderJourneyResults==='function'){
    const old=renderJourneyResults;renderJourneyResults=function(){const out=old.apply(this,arguments);setTimeout(prewarmJourney,0);return out;};
  }
  document.addEventListener('click',e=>{
    const card=e.target.closest?.('#journeyResults .journey-card');if(!card)return;if(e.target.closest('button,a,input,select,textarea'))return;
    const cards=[...document.querySelectorAll('#journeyResults .journey-card')],i=cards.indexOf(card),rows=[...(journeyState?.results||[])];if(i<0||!rows[i])return;
    e.preventDefault();e.stopImmediatePropagation();openJourneyMap(card,rows[i]).catch(()=>{});
  },true);
  window.dzMaps391={version:'3.9.1',fetchRouteGeometry,journeyGeometry,prewarmJourney};
})();