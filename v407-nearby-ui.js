(() => {
  "use strict";
  const VERSION='4.0.16';
  const $=s=>document.querySelector(s);
  let map=null, layer=null, userMarker=null;

  function updateActive(r){
    r=Number(r)||100;
    document.querySelectorAll('[data-dz-radius]').forEach(b=>b.classList.toggle('active',Number(b.dataset.dzRadius)===r));
    const t=$('.nearby-panel .panel-title'); if(t)t.textContent=`📍 ${r}m 即將到站`;
  }
  function installControls(){
    const panel=$('.nearby-panel'); if(!panel) return;
    if(!$('#dz407NearbyControls')){
      const box=document.createElement('div'); box.id='dz407NearbyControls'; box.className='dz407-controls';
      box.innerHTML='<div class="dz407-row"><button id="dz407MapBtn" type="button">地圖</button></div><div class="dz407-row dz407-radius"><button type="button" data-dz-radius="100" class="active">100m</button><button type="button" data-dz-radius="200">200m</button><button type="button" data-dz-radius="400">400m</button></div>';
      const locate=$('#locateBtn');
      if(locate){ const wrap=document.createElement('div'); wrap.className='dz407-actions'; panel.appendChild(wrap); wrap.appendChild(locate); wrap.appendChild(box); }
      else panel.appendChild(box);
    }
    updateActive(100);
  }
  async function ensureLeaflet(){
    if(window.L)return window.L;
    if(!document.querySelector('link[data-dz407-leaflet]')){const l=document.createElement('link');l.rel='stylesheet';l.href='https://unpkg.com/leaflet@1.9.4/dist/leaflet.css';l.dataset.dz407Leaflet='1';document.head.appendChild(l);}
    return await new Promise((resolve,reject)=>{const old=document.querySelector('script[data-dz407-leaflet]');if(old){old.addEventListener('load',()=>resolve(window.L),{once:true});old.addEventListener('error',reject,{once:true});return;}const s=document.createElement('script');s.src='https://unpkg.com/leaflet@1.9.4/dist/leaflet.js';s.async=true;s.dataset.dz407Leaflet='1';s.onload=()=>resolve(window.L);s.onerror=reject;document.head.appendChild(s);});
  }
  function stopCoords(row){const m=row.operator==='KMB'?state.kmbStops:row.operator==='CTB'?state.ctbStops:state.gmbStops;const s=m?.get(String(row.stopId));if(!s)return null;const lat=Number(s.lat??s.latitude),lon=Number(s.long??s.lng??s.longitude);return Number.isFinite(lat)&&Number.isFinite(lon)?{lat,lon,name:s.name_tc||row.stopName||row.route}:null;}
  function ensureHost(){let host=$('#dz407Map');if(host)return host;host=document.createElement('section');host.id='dz407Map';host.className='dz407-map hidden';host.innerHTML='<div id="dz407MapCanvas"></div>';const sec=$('#nearbySection');if(sec)sec.appendChild(host);return host;}
  async function showMap(){const host=ensureHost(),btn=$('#dz407MapBtn');if(!host)return;if(!host.classList.contains('hidden')){host.classList.add('hidden');if(btn)btn.textContent='地圖';return;}if(btn){btn.disabled=true;btn.textContent='地圖載入中…';}try{const L=await ensureLeaflet();const pos=await new Promise((resolve,reject)=>navigator.geolocation.getCurrentPosition(p=>resolve({lat:p.coords.latitude,lon:p.coords.longitude}),reject,{enableHighAccuracy:true,maximumAge:8000,timeout:12000}));host.classList.remove('hidden');if(!map){map=L.map($('#dz407MapCanvas'),{zoomControl:true});L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',{maxZoom:19,attribution:'© OpenStreetMap'}).addTo(map);layer=L.layerGroup().addTo(map);}else layer.clearLayers();if(userMarker)map.removeLayer(userMarker);userMarker=L.marker([pos.lat,pos.lon]).addTo(map).bindTooltip('你的位置');const pts=[[pos.lat,pos.lon]];for(const r of (state.nearby||[]).slice(0,24)){const c=stopCoords(r);if(!c)continue;pts.push([c.lat,c.lon]);L.marker([c.lat,c.lon]).addTo(layer).bindTooltip(`${r.route} · ${c.name}`);}if(pts.length>1)map.fitBounds(pts,{padding:[20,20],maxZoom:18});else map.setView([pos.lat,pos.lon],17);setTimeout(()=>map.invalidateSize(),80);if(btn)btn.textContent='收起地圖';}catch{if(btn)btn.textContent='地圖';}finally{if(btn)btn.disabled=false;}}

  window.addEventListener('click',e=>{const r=e.target.closest?.('[data-dz-radius]');if(r){updateActive(Number(r.dataset.dzRadius)||100);return;}if(e.target.closest?.('#dz407MapBtn')){e.preventDefault();e.stopImmediatePropagation();showMap();}},true);
  function syncFromStatus(){const s=$('#nearbyStatus')?.textContent||'';const m=s.match(/\b(100|200|400)m\b/);if(m)updateActive(Number(m[1]));}
  const status=$('#nearbyStatus');if(status){new MutationObserver(syncFromStatus).observe(status,{childList:true,subtree:true,characterData:true});}

  const style=document.createElement('style');style.textContent='.nearby-panel{align-items:stretch}.dz407-actions{display:flex;gap:10px;align-items:center;flex-wrap:wrap}.dz407-controls{display:flex;gap:10px;align-items:center;flex-wrap:wrap}.dz407-row{display:flex;gap:8px}.dz407-row button{border:1px solid var(--border);background:var(--bg);color:var(--text);border-radius:999px;padding:9px 14px;font-weight:750}.dz407-radius button.active{background:var(--text);color:var(--bg)}#dz407MapBtn{min-width:74px}.dz407-map{margin-top:12px;border-radius:16px;overflow:hidden;border:1px solid var(--border)}#dz407MapCanvas{height:280px;width:100%}@media(max-width:520px){.nearby-panel{display:block}.dz407-actions{margin-top:12px}.dz407-controls{width:100%;justify-content:space-between}.dz407-radius{flex:1}.dz407-radius button{flex:1}.dz407-actions>#locateBtn{width:100%}}';document.head.appendChild(style);
  installControls();

  if(!document.querySelector('script[data-dz409]')){const s=document.createElement('script');s.src=`v409-route-detail-fare.js?v=${VERSION}`;s.dataset.dz409='1';document.body.appendChild(s);}
  const badge=$('.app-version');if(badge){badge.textContent=`v${VERSION}`;badge.setAttribute('aria-label',`版本 v${VERSION}`);}window.dzNearbyUI407={version:VERSION,showMap,updateActive};
})();