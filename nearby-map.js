(() => {
  "use strict";
  const $=s=>document.querySelector(s);
  let map=null,layer=null,userMarker=null,pickerMap=null,pickerMarker=null,pickerUserMarker=null;

  async function ensureLeaflet(){
    if(window.L)return window.L;
    if(!document.querySelector('link[data-dz407-leaflet]')){const l=document.createElement('link');l.rel='stylesheet';l.href='https://unpkg.com/leaflet@1.9.4/dist/leaflet.css';l.dataset.dz407Leaflet='1';document.head.appendChild(l);}
    return await new Promise((resolve,reject)=>{const old=document.querySelector('script[data-dz407-leaflet]');if(old){old.addEventListener('load',()=>resolve(window.L),{once:true});old.addEventListener('error',reject,{once:true});return;}const s=document.createElement('script');s.src='https://unpkg.com/leaflet@1.9.4/dist/leaflet.js';s.async=true;s.dataset.dz407Leaflet='1';s.onload=()=>resolve(window.L);s.onerror=reject;document.head.appendChild(s);});
  }
  function stopCoords(row){
    if(Number.isFinite(Number(row?.lat))&&Number.isFinite(Number(row?.lon)))return {lat:Number(row.lat),lon:Number(row.lon),name:row.stopName||row.route};
    const m=row.operator==='KMB'?state.kmbStops:row.operator==='CTB'?state.ctbStops:row.operator==='GMB'?state.gmbStops:null;if(!m)return null;const s=m.get(String(row.stopId));if(!s)return null;const lat=Number(s.lat??s.latitude),lon=Number(s.long??s.lng??s.longitude);return Number.isFinite(lat)&&Number.isFinite(lon)?{lat,lon,name:s.name_tc||row.stopName||row.route}:null;
  }
  function ensureHost(){let host=$('#dz407Map');if(host)return host;host=document.createElement('section');host.id='dz407Map';host.className='dz407-map hidden';host.innerHTML='<div id="dz407MapCanvas"></div>';$('#nearbySection')?.appendChild(host);return host;}
  async function showMap(){const host=ensureHost(),btn=$('#dz407MapBtn');if(!host)return;if(!host.classList.contains('hidden')){host.classList.add('hidden');if(btn)btn.textContent='地圖';return;}if(btn){btn.disabled=true;btn.textContent='地圖載入中…';}try{const L=await ensureLeaflet();const pos=await new Promise((resolve,reject)=>navigator.geolocation.getCurrentPosition(p=>resolve({lat:p.coords.latitude,lon:p.coords.longitude}),reject,{enableHighAccuracy:true,maximumAge:8000,timeout:12000}));host.classList.remove('hidden');if(!map){map=L.map($('#dz407MapCanvas'),{zoomControl:true});L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',{maxZoom:19,attribution:'© OpenStreetMap'}).addTo(map);layer=L.layerGroup().addTo(map);}else layer.clearLayers();if(userMarker)map.removeLayer(userMarker);userMarker=L.marker([pos.lat,pos.lon]).addTo(map).bindTooltip('你的位置');const pts=[[pos.lat,pos.lon]];for(const r of (state.nearby||[]).slice(0,24)){const c=stopCoords(r);if(!c)continue;pts.push([c.lat,c.lon]);L.marker([c.lat,c.lon]).addTo(layer).bindTooltip(`${r.route} · ${c.name}`);}if(pts.length>1)map.fitBounds(pts,{padding:[20,20],maxZoom:18});else map.setView([pos.lat,pos.lon],17);setTimeout(()=>map.invalidateSize(),80);if(btn)btn.textContent='收起地圖';}catch{if(btn)btn.textContent='地圖';}finally{if(btn)btn.disabled=false;}}

  function ensurePicker(){
    let host=$('#dzMapPicker');if(host)return host;
    host=document.createElement('div');host.id='dzMapPicker';host.className='dz-map-picker hidden';host.setAttribute('role','dialog');host.setAttribute('aria-modal','true');host.setAttribute('aria-labelledby','dzMapPickerTitle');
    host.innerHTML='<div class="dz-map-picker-sheet"><div class="dz-map-picker-head"><div><strong id="dzMapPickerTitle">喺地圖揀目的地</strong><small>撳一下地圖落針，可拖動微調</small></div><button type="button" data-map-cancel aria-label="關閉">×</button></div><div id="dzMapPickerCanvas"></div><div id="dzMapPickerStatus">請撳目的地位置</div><div class="dz-map-picker-actions"><button type="button" data-map-cancel>取消</button><button type="button" data-map-confirm disabled>使用呢個位置</button></div></div>';
    document.body.appendChild(host);return host;
  }
  async function pickDestination({initial}={}){
    const L=await ensureLeaflet(),host=ensurePicker(),center=Number.isFinite(Number(initial?.lat))&&Number.isFinite(Number(initial?.lon))?{lat:Number(initial.lat),lon:Number(initial.lon)}:{lat:22.3193,lon:114.1694};
    host.classList.remove('hidden');document.body.classList.add('dz-map-picker-open');
    const status=host.querySelector('#dzMapPickerStatus'),confirm=host.querySelector('[data-map-confirm]');confirm.disabled=true;status.textContent='請撳目的地位置';
    if(!pickerMap){pickerMap=L.map($('#dzMapPickerCanvas'),{zoomControl:true});L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',{maxZoom:19,attribution:'© OpenStreetMap'}).addTo(pickerMap);}
    if(pickerMarker){pickerMap.removeLayer(pickerMarker);pickerMarker=null;}if(pickerUserMarker){pickerMap.removeLayer(pickerUserMarker);pickerUserMarker=null;}
    pickerUserMarker=L.circleMarker([center.lat,center.lon],{radius:8,color:'#fff',weight:3,fillColor:'#1677ff',fillOpacity:1}).addTo(pickerMap).bindTooltip('你的位置');pickerMap.setView([center.lat,center.lon],16);setTimeout(()=>pickerMap.invalidateSize(),80);
    let selected=null;
    const setPoint=latlng=>{selected={lat:Number(latlng.lat),lon:Number(latlng.lng),name:'地圖選擇位置'};if(!pickerMarker){pickerMarker=L.marker([selected.lat,selected.lon],{draggable:true}).addTo(pickerMap);pickerMarker.on('dragend',()=>setPoint(pickerMarker.getLatLng()));}else pickerMarker.setLatLng([selected.lat,selected.lon]);status.textContent=`已選擇：${selected.lat.toFixed(5)}, ${selected.lon.toFixed(5)}`;confirm.disabled=false;};
    pickerMap.off('click');pickerMap.on('click',e=>setPoint(e.latlng));
    return await new Promise(resolve=>{const close=value=>{host.classList.add('hidden');document.body.classList.remove('dz-map-picker-open');host.querySelectorAll('[data-map-cancel]').forEach(b=>b.removeEventListener('click',cancel));confirm.removeEventListener('click',accept);document.removeEventListener('keydown',key);resolve(value);},cancel=()=>close(null),accept=()=>selected&&close(selected),key=e=>{if(e.key==='Escape')cancel();};host.querySelectorAll('[data-map-cancel]').forEach(b=>b.addEventListener('click',cancel));confirm.addEventListener('click',accept);document.addEventListener('keydown',key);});
  }

  const btn=document.createElement('button');btn.id='dz407MapBtn';btn.type='button';btn.className='filter';btn.textContent='地圖';$('.nearby-panel')?.appendChild(btn);btn.addEventListener('click',showMap);
  const style=document.createElement('style');style.textContent='#dz407MapCanvas{height:280px;width:100%}.dz407-map{margin-top:12px}';document.head.appendChild(style);
  window.dzMap={ensureLeaflet,pickDestination};
})();
