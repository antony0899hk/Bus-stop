(() => {
  "use strict";
  const $=(s,r=document)=>r.querySelector(s);
  const $$=(s,r=document)=>[...r.querySelectorAll(s)];
  const state393={radius:100,position:null,heading:null,lastPosition:null,stops:[],target:null,map:null,userMarker:null,radiusCircle:null,walkLine:null,walkArrow:null,stopLayers:[],watchId:null,leafletPromise:null,tileLayer:null,mapToken:0};
  window.dzNearbyMapState=state393;

  function ensureControls(){
    const panel=$(".nearby-panel");if(!panel)return;
    if(!panel.querySelector(".dz393-nearby-actions")){
      const actions=document.createElement("div");actions.className="dz393-nearby-actions";
      const locate=$("#locateBtn");if(locate)actions.appendChild(locate);
      const row=document.createElement("div");row.className="dz393-radius-row";row.setAttribute("aria-label","附近搜尋距離");row.innerHTML='<button type="button" data-dz-radius="100" class="active">100m</button><button type="button" data-dz-radius="200">200m</button><button type="button" data-dz-radius="400">400m</button>';
      actions.appendChild(row);panel.appendChild(actions);
    }
  }
  function mapHost(){
    let host=$("#dz393NearbyMap");if(!host){
      host=document.createElement("section");host.id="dz393NearbyMap";host.className="dz393-nearby-map hidden";host.innerHTML='<div class="dz393-map-head"><div><strong>附近車站地圖</strong><span id="dz393MapMeta">即時位置</span></div><button type="button" id="dz393Recenter">◎</button></div><div class="dz393-map-loading-row">地圖準備中…</div><div id="dz393MapCanvas" class="dz393-map-canvas"></div>';
    }
    const nearby=$("#nearbySection"),more=$("#nearbyMore");
    if(nearby){if(more)more.insertAdjacentElement("afterend",host);else nearby.appendChild(host);}
    return host;
  }
  async function ensureLeaflet(){
    if(window.L)return window.L;if(state393.leafletPromise)return state393.leafletPromise;
    state393.leafletPromise=new Promise((resolve,reject)=>{
      if(!document.querySelector('link[data-dz-leaflet]')){const l=document.createElement('link');l.rel='stylesheet';l.href='https://unpkg.com/leaflet@1.9.4/dist/leaflet.css';l.dataset.dzLeaflet='1';document.head.appendChild(l);}
      const old=document.querySelector('script[data-dz-leaflet]');if(old){if(window.L){resolve(window.L);return;}old.addEventListener('load',()=>resolve(window.L),{once:true});old.addEventListener('error',()=>reject(new Error('地圖元件載入失敗')),{once:true});return;}
      const s=document.createElement('script');s.src='https://unpkg.com/leaflet@1.9.4/dist/leaflet.js';s.async=true;s.dataset.dzLeaflet='1';s.onload=()=>resolve(window.L);s.onerror=()=>reject(new Error('地圖元件載入失敗'));document.head.appendChild(s);
    });return state393.leafletPromise;
  }
  function coords(s){const lat=Number(s?.lat??s?.latitude),lon=Number(s?.long??s?.lng??s?.longitude);return Number.isFinite(lat)&&Number.isFinite(lon)?{lat,lon}:null;}
  function nameOf(s,id){return s?.name_tc||s?.name||s?.stop_name_tc||String(id||"");}
  function collectStops(pos,radius){
    const out=[];for(const [operator,map] of [["KMB",state.kmbStops],["CTB",state.ctbStops],["GMB",state.gmbStops]]){
      const a=[];for(const [id,s] of map){const c=coords(s);if(!c)continue;const d=distanceMeters(pos.lat,pos.lon,c.lat,c.lon);if(Number.isFinite(d)&&d<=radius)a.push({operator,stop:String(id),stopObj:s,lat:c.lat,lon:c.lon,name:nameOf(s,id),distance:d});}
      a.sort((x,y)=>x.distance-y.distance);out.push(...a.slice(0,25));
    }return out.sort((a,b)=>a.distance-b.distance);
  }
  function bearing(a,b){if(!a||!b)return 0;const toRad=x=>x*Math.PI/180,toDeg=x=>x*180/Math.PI;const p1=toRad(a.lat),p2=toRad(b.lat),dl=toRad(b.lon-a.lon);const y=Math.sin(dl)*Math.cos(p2),x=Math.cos(p1)*Math.sin(p2)-Math.sin(p1)*Math.cos(p2)*Math.cos(dl);return (toDeg(Math.atan2(y,x))+360)%360;}
  function displayHeading(pos){const h=Number(pos?.heading);if(Number.isFinite(h)&&h>=0)return h;if(state393.lastPosition&&distanceMeters(state393.lastPosition.lat,state393.lastPosition.lon,pos.lat,pos.lon)>3)return bearing(state393.lastPosition,pos);return Number.isFinite(state393.heading)?state393.heading:0;}
  function opClass(op){return op==="CTB"?"ctb":op==="GMB"?"gmb":"kmb";}
  function userIcon(L,heading){return L.divIcon({className:'dz393-user-icon',html:`<div class="dz393-user-arrow" style="transform:rotate(${heading}deg)">▲</div><span></span>`,iconSize:[34,34],iconAnchor:[17,17]});}
  function stopIcon(L,s){return L.divIcon({className:'dz393-stop-icon',html:`<div class="${opClass(s.operator)}"></div>`,iconSize:[20,20],iconAnchor:[10,10]});}
  function arrowIcon(L,deg,meters){return L.divIcon({className:'dz393-walk-arrow-wrap',html:`<div class="dz393-walk-arrow" style="transform:rotate(${deg}deg)">➜</div><span>${Math.round(meters)}m</span>`,iconSize:[54,34],iconAnchor:[27,17]});}
  function clearWalk(){if(state393.map){if(state393.walkLine)state393.map.removeLayer(state393.walkLine);if(state393.walkArrow)state393.map.removeLayer(state393.walkArrow);}state393.walkLine=state393.walkArrow=null;}
  function drawWalk(){const L=window.L,map=state393.map,p=state393.position,t=state393.target;if(!L||!map||!p||!t)return;clearWalk();const meters=distanceMeters(p.lat,p.lon,t.lat,t.lon),deg=bearing(p,t);state393.walkLine=L.polyline([[p.lat,p.lon],[t.lat,t.lon]],{weight:4,dashArray:'8 8',opacity:.9}).addTo(map);const mid=[(p.lat+t.lat)/2,(p.lon+t.lon)/2];state393.walkArrow=L.marker(mid,{icon:arrowIcon(L,deg,meters),interactive:false}).addTo(map);const meta=$("#dz393MapMeta");if(meta)meta.textContent=`前往 ${t.name} · 約 ${Math.round(meters)}m`;}
  function focusRadius(){const L=window.L;if(!state393.map||!state393.position||!L)return;const c=L.circle([state393.position.lat,state393.position.lon],{radius:state393.radius,opacity:.45,fillOpacity:.06});state393.map.fitBounds(c.getBounds(),{padding:[18,18],maxZoom:19});}
  function idle(fn){if('requestIdleCallback'in window)requestIdleCallback(fn,{timeout:900});else setTimeout(fn,450);}
  function tileReady(host){host.classList.add('map-ready');const row=$(".dz393-map-loading-row",host);if(row)row.textContent='';}
  function installTiles(L,map,host,token){
    if(state393.tileLayer){try{map.removeLayer(state393.tileLayer);}catch{}}
    const primary=L.tileLayer('https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png',{subdomains:'abcd',maxZoom:20,attribution:'© OpenStreetMap © CARTO'});
    state393.tileLayer=primary;let done=false;
    const ok=()=>{if(done||token!==state393.mapToken)return;done=true;tileReady(host);};
    primary.once('tileload',ok);primary.addTo(map);
    setTimeout(()=>{if(done||token!==state393.mapToken)return;try{map.removeLayer(primary);}catch{}const fallback=L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png',{maxZoom:19,attribution:'© OpenStreetMap'});state393.tileLayer=fallback;fallback.once('tileload',ok);fallback.addTo(map);setTimeout(ok,2200);},1800);
  }
  async function renderNearbyMap(){
    const host=mapHost();if(!state393.position)return;host.classList.remove("hidden");host.classList.remove('map-ready');const row=$(".dz393-map-loading-row",host);if(row)row.textContent='地圖準備中…';const token=++state393.mapToken;const L=await ensureLeaflet();
    if(!state393.map){const canvas=$("#dz393MapCanvas");state393.map=L.map(canvas,{zoomControl:true,attributionControl:true});installTiles(L,state393.map,host,token);}else tileReady(host);
    const map=state393.map;state393.stopLayers.forEach(x=>map.removeLayer(x));state393.stopLayers=[];if(state393.radiusCircle)map.removeLayer(state393.radiusCircle);state393.radiusCircle=L.circle([state393.position.lat,state393.position.lon],{radius:state393.radius,weight:2,opacity:.5,fillOpacity:.05}).addTo(map);
    const h=displayHeading({...state393.position,heading:state393.heading});if(state393.userMarker){state393.userMarker.setLatLng([state393.position.lat,state393.position.lon]);state393.userMarker.setIcon(userIcon(L,h));}else state393.userMarker=L.marker([state393.position.lat,state393.position.lon],{icon:userIcon(L,h),zIndexOffset:1000}).addTo(map).bindTooltip('你的位置');
    for(const s of state393.stops){const m=L.marker([s.lat,s.lon],{icon:stopIcon(L,s)}).addTo(map).bindTooltip(`${s.name} · ${Math.round(s.distance)}m`);m.on('click',()=>{state393.target=s;drawWalk();});state393.stopLayers.push(m);}
    if(!state393.target||!state393.stops.some(x=>x.stop===state393.target.stop&&x.operator===state393.target.operator))state393.target=state393.stops[0]||null;drawWalk();focusRadius();setTimeout(()=>map.invalidateSize(),80);
  }
  async function runNearby(radius=state393.radius){
    state393.radius=Number(radius)||100;ensureControls();$$('[data-dz-radius]').forEach(b=>b.classList.toggle('active',Number(b.dataset.dzRadius)===state393.radius));const title=$(".nearby-panel .panel-title");if(title)title.textContent=`📍 ${state393.radius}m 即將到站`;const st=$("#nearbyStatus");if(st)st.textContent='正在取得位置…';const btn=$("#locateBtn");if(btn)btn.disabled=true;
    if(!navigator.geolocation){if(st)st.textContent='此瀏覽器不支援定位。';if(btn)btn.disabled=false;return;}
    navigator.geolocation.getCurrentPosition(async pos=>{
      const p={lat:pos.coords.latitude,lon:pos.coords.longitude};state393.lastPosition=state393.position;state393.position=p;state393.heading=Number.isFinite(pos.coords.heading)?pos.coords.heading:state393.heading;state393.stops=collectStops(p,state393.radius);if(st)st.textContent=`定位成功，搜尋 ${state393.radius}m 內車站…`;
      try{if(typeof loadNearbyEtas==='function')await loadNearbyEtas(state393.stops.map(x=>({operator:x.operator,stop:x.stop,stopObj:x.stopObj,distance:x.distance})));}catch{}
      const sec=$("#nearbySection");sec?.classList.remove('hidden');const count=$("#nearbyCount");if(count)count.textContent=`${state393.radius}m`;if(st)st.textContent=`已搜尋 ${state393.radius}m 範圍，共 ${state393.stops.length} 個附近站點。`;mapHost();idle(()=>renderNearbyMap().catch(()=>{}));startWatch();if(btn)btn.disabled=false;
    },err=>{if(st)st.textContent=err.code===1?'你未允許定位；可以喺瀏覽器設定開啟。':'暫時無法取得位置。';if(btn)btn.disabled=false;},{enableHighAccuracy:true,timeout:12000,maximumAge:15000});
  }
  function startWatch(){if(state393.watchId!=null||!navigator.geolocation)return;state393.watchId=navigator.geolocation.watchPosition(pos=>{const next={lat:pos.coords.latitude,lon:pos.coords.longitude};state393.lastPosition=state393.position;state393.position=next;state393.heading=Number.isFinite(pos.coords.heading)?pos.coords.heading:state393.heading;if(!state393.map)return;const L=window.L;if(state393.userMarker&&L)state393.userMarker.setLatLng([next.lat,next.lon]).setIcon(userIcon(L,displayHeading({...next,heading:state393.heading})));if(state393.radiusCircle)state393.radiusCircle.setLatLng([next.lat,next.lon]);if(state393.target)drawWalk();},()=>{},{enableHighAccuracy:true,maximumAge:5000,timeout:15000});}
  function compactTrafficWarning(){const w=$("#traffic-warning");if(!w||w.dataset.dz394)return;w.dataset.dz394='1';w.classList.add('dz394-warning-compact');w.addEventListener('click',()=>w.classList.toggle('expanded'));}
  document.addEventListener('click',e=>{const radius=e.target.closest?.('[data-dz-radius]');if(radius){e.preventDefault();e.stopImmediatePropagation();runNearby(Number(radius.dataset.dzRadius));return;}if(e.target.closest?.('#locateBtn')){e.preventDefault();e.stopImmediatePropagation();runNearby();return;}if(e.target.closest?.('#dz393Recenter')){e.preventDefault();focusRadius();return;}const card=e.target.closest?.('#nearbyResults .near-card');if(card&&state393.position){const route=card.querySelector('.near-route')?.textContent?.trim(),meta=card.querySelector('.near-meta')?.textContent||'',name=meta.split('·')[0].trim();const match=state393.stops.find(s=>s.name===name)||state393.stops[0];if(match){state393.target=match;drawWalk();}}},true);
  ensureControls();mapHost();compactTrafficWarning();
  window.dzNearby393={version:'3.9.4',runNearby,renderNearbyMap,collectStops};
})();