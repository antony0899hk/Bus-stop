(() => {
  'use strict';
  const $ = s => document.querySelector(s);
  let radius = 100, generation = 0, shown = 20;
  const controllers = new Set();
  const pause = () => new Promise(r => setTimeout(r, 0));
  function cancel() { generation++; for (const c of controllers) c.abort(); controllers.clear(); const button=$('#locateBtn'); if(button)button.disabled=false; }
  async function json(url, options = {}) {
    const c = new AbortController(); controllers.add(c);
    const timer = setTimeout(() => c.abort(), 10000);
    try { const r = await fetch(url, {...options, signal:c.signal, cache:'no-store'}); if (!r.ok) throw Error(`HTTP ${r.status}`); return await r.json(); }
    finally { clearTimeout(timer); controllers.delete(c); }
  }

  let railNames=new Map();
  const lineNames={EAL:'東鐵綫',TML:'屯馬綫',TWL:'荃灣綫',KTL:'觀塘綫',ISL:'港島綫',TKL:'將軍澳綫',TCL:'東涌綫',AEL:'機場快綫',SIL:'南港島綫',DRL:'迪士尼綫'};
  function publish(rows) {
    state.nearby=[...rows.values()].sort((a,b)=>(a.eta ? new Date(a.eta).getTime() : Infinity)-(b.eta ? new Date(b.eta).getTime() : Infinity) || a.distance-b.distance);
    render();
  }
  async function addMtr(pos,selected,token,rows) {
    const busStops=new Map(), failures=[];
    if(token!==generation)return {stops:[],failures};
    try {
      const catalog=await json('./runtime/mtr-stations.json?v='+encodeURIComponent(window.DZ_BUILD));
      if(token!==generation)return {stops:[],failures};
      if(!Array.isArray(catalog.data)||!catalog.data.length)throw Error('empty railway catalog');
      railNames=new Map(catalog.data.map(s=>[s.code,s.name_tc]));
      for(const s of catalog.data){
        const distance=distanceMeters(pos.lat,pos.lon,Number(s.lat),Number(s.lon));
        if(!Number.isFinite(distance)||distance>selected)continue;
        const key='MTR|'+s.code;
        rows.set(key,{operator:'MTR',key,route:s.name_tc+'站',dest:(s.lines||[]).map(l=>lineNames[l]||l).join('／'),stopId:s.code,stopName:s.name_tc+'站',lat:s.lat,lon:s.lon,distance,eta:null,railStation:s,kind:'rail'});
      }
    }catch(e){if(token===generation)failures.push('港鐵車站資料');}
    if(token!==generation)return {stops:[],failures};
    publish(rows);
    for(const region of ['tai-po','yuen-long-tin-shui-wai','tuen-mun']){
      if(token!==generation)return {stops:[],failures};
      try{
        const bundle=await json('./runtime/mtr-bus/'+region+'.json?v='+encodeURIComponent(window.DZ_BUILD));
        if(token!==generation)return {stops:[],failures};
        if(!Array.isArray(bundle.routes))throw Error('invalid bus catalog');
        for(const route of bundle.routes)for(const dir of route.directions||[])for(const s of dir.stops||[]){
          const distance=distanceMeters(pos.lat,pos.lon,Number(s.lat),Number(s.long));
          if(!Number.isFinite(distance)||distance>selected)continue;
          const key=['MTRB',route.route,dir.bound].join('|');
          const stop={operator:'MTRB',key,route:route.route,bound:dir.bound,serviceType:'1',dest:dir.stops.at(-1)?.name_tc||route.dest||'',stopId:String(s.id),stopName:s.name_tc||s.id,lat:Number(s.lat),lon:Number(s.long),distance,eta:null,mtrBusRegion:region,region};
          if(!busStops.has(key)||distance<busStops.get(key).distance)busStops.set(key,stop);
        }
      }catch(e){if(token===generation)failures.push('港鐵巴士 '+region);}
    }
    if(token!==generation)return {stops:[],failures};
    for(const [key,s] of busStops)rows.set(key,s);
    publish(rows);
    return {stops:[...busStops.values()],failures};
  }
  async function openRailway(x){
    const s=x.railStation;state.selectedRoute=null;
    $('#resultsSection').classList.add('hidden');$('#routeSection').classList.remove('hidden');
    $('#routeHeader').innerHTML='<div class="route-title"><div><div class="number">'+escapeHtml(s.name_tc)+'站</div><div class="dest">'+escapeHtml(x.dest)+'</div>'+operatorBadge('MTR')+'</div></div>';
    $('#directionTabs').innerHTML='';
    const host=$('#stops');host.innerHTML='<div class="loading">正在載入列車班次…</div>';
    const token=generation, header=$('#routeHeader').firstElementChild;let html='';
    for(const line of s.lines||[]){
      try{
        const j=await json('https://rt.data.gov.hk/v1/transport/mtr/getSchedule.php?line='+encodeURIComponent(line)+'&sta='+encodeURIComponent(s.code)+'&lang=TC');
        if(token!==generation||!host.isConnected||$('#routeHeader').firstElementChild!==header)return;
        const d=j.data?.[line+'-'+s.code];let trains='';
        for(const direction of ['UP','DOWN'])for(const t of d?.[direction]||[]){
          const raw=String(t.time||'');const eta=raw.includes('T')?raw:raw.replace(' ','T')+'+08:00';
          const dest=t.dest;
          const name=railNames.get(dest)||dest||'';
          trains+='<div class="stop-row"><div>🚇</div><div><div class="stop-name">往 '+escapeHtml(name)+'</div><div class="etas"><span class="eta-chip">'+escapeHtml(etaLabel(eta))+'</span></div></div><div>'+escapeHtml(t.plat?'月台 '+t.plat:'')+'</div></div>';
        }
        html+='<h2>'+escapeHtml(lineNames[line]||line)+'</h2>'+(trains||'<div class="empty">暫時未有列車預報</div>');
      }catch(e){if(token!==generation||$('#routeHeader').firstElementChild!==header)return;html+='<h2>'+escapeHtml(lineNames[line]||line)+'</h2><div class="empty">列車預報未能更新</div>';}
      host.innerHTML=html;
    }
    if(!html)host.innerHTML='<div class="empty">暫時未有列車預報</div>';
  }

  function render() {
    const rows = state.nearby.filter(x => state.nearbyFilter === 'all' || x.operator === state.nearbyFilter);
    $('#nearbySection').classList.remove('hidden');
    $('#nearbyCount').textContent = `共 ${rows.length} 個路線／車站`;
    $('#nearbyResults').innerHTML = rows.slice(0,shown).map(x => `<button type="button" class="near-card" data-near-key="${escapeHtml(x.key)}"><div>${operatorBadge(x.operator)}</div><div><div class="near-route">${escapeHtml(x.route)}</div><div class="near-dest">→ ${escapeHtml(x.dest || '目的地未提供')}</div><div class="near-meta">${escapeHtml(x.stopName)} · ${Math.round(x.distance)}m</div></div><div class="near-eta">${escapeHtml(x.kind === 'rail' ? '查看班次' : x.error ? '更新失敗' : etaLabel(x.eta))}</div></button>`).join('') || '<div class="empty">暫時未有路線資料；請查看上方搜尋狀態。</div>';
    $('#nearbyMore').classList.toggle('hidden', rows.length <= shown);
    $('#nearbyMore').textContent = `顯示更多（尚有 ${Math.max(0,rows.length-shown)} 條）`;
    $('#nearbyCollapseTop').classList.toggle('hidden',shown <= 20);
  }
  function mergeRows(stop, data, rows) {
    for (const x of data) {
      if (!x.route) continue;
      const eta = validFutureEta(x.eta) ? x.eta : null;
      const key = [stop.operator,x.route,x.dir || '',x.dest_tc || '',x.service_type || '1'].join('|');
      const row = {...stop,key,route:x.route,dest:x.dest_tc || '',bound:x.dir || 'O',serviceType:String(x.service_type || '1'),eta};
      const old = rows.get(key);
      if (!old || (eta && (!old.eta || new Date(eta) < new Date(old.eta))) || (!eta && !old.eta && row.distance < old.distance)) rows.set(key,row);
    }
  }
  async function findStops(pos, selected, token) {
    const found = []; let sources = 0;
    for (const [operator,path] of [['KMB','kmb-stops.json'],['CTB','ctb-stops.json']]) {
      if (token !== generation) return {found:[],sources};
      try {
        const j = await json(`./${path}?v=${window.DZ_BUILD || '5.2.0'}`);
        if (!Array.isArray(j.data)) throw Error('invalid stop catalog');
        sources++;
        for (let i=0;i<j.data.length;i++) {
          if (token !== generation) return {found:[],sources};
          const s=j.data[i], lat=Number(s.lat), lon=Number(s.long ?? s.lng ?? s.longitude);
          if (!Number.isFinite(lat) || !Number.isFinite(lon)) continue;
          const distance=distanceMeters(pos.lat,pos.lon,lat,lon);
          if (distance <= selected) found.push({operator,stopId:String(s.stop || s.id),stopName:s.name_tc || '',lat,lon,distance});
          if (i%700===699) await pause();
        }
      } catch (e) { if (token !== generation) return {found:[],sources}; }
    }
    return {found:found.sort((a,b)=>a.distance-b.distance),sources};
  }
  async function run(position, selected, token) {
    const status=$('#nearbyStatus');
    try {
      const {found:busStops,sources} = await findStops({lat:position.coords.latitude,lon:position.coords.longitude},selected,token);
      if (token !== generation) return;
      const rows=new Map(); let completed=0, failed=0;
      const extra=await addMtr({lat:position.coords.latitude,lon:position.coords.longitude},selected,token,rows);
      if(token!==generation)return;
      const stops=[...busStops,...extra.stops];
      if(!sources&&!rows.size)throw Error('站點資料未能載入');
      for (const stop of stops) {
        if (token !== generation) return;
        status.textContent=`${selected}m：已讀取 ${completed}/${stops.length} 個站／路線（九巴／城巴／港鐵巴士）`;
        try {
          const url=stop.operator==='KMB' ? `${KMB_API}/stop-eta/${encodeURIComponent(stop.stopId)}` : `https://rt.data.gov.hk/v1/transport/batch/stop-eta/CTB/${encodeURIComponent(stop.stopId)}`;
          const j=stop.operator==='MTRB' ? await json('https://rt.data.gov.hk/v1/transport/mtr/bus/getSchedule',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({language:'zh',routeName:stop.route})}) : await json(url);
          if (token !== generation) return;
          if(stop.operator==='MTRB'){
            if(!Array.isArray(j.busStop))throw Error('invalid MTR bus response');
            const s=j.busStop.find(x=>String(x.busStopId)===stop.stopId);
            const seconds=(s?.bus||[]).map(b=>Number(b.arrivalTimeInSecond ?? b.departureTimeInSecond)).filter(n=>Number.isFinite(n)&&n>=0);
            rows.set(stop.key,{...stop,eta:seconds.length?new Date(Date.now()+Math.min(...seconds)*1000).toISOString():null});
          }else{
            if (!Array.isArray(j.data)) throw Error('invalid ETA response');
            mergeRows(stop,j.data,rows);
          }
        } catch(e) { if (token !== generation) return; failed++; if(stop.operator==='MTRB')rows.set(stop.key,{...stop,error:true}); }
        completed++;
        publish(rows); await pause();
      }
      if (token !== generation) return;
      render();
      status.textContent=`${selected}m：${stops.length} 個站、${rows.size} 條回傳路線方向。九巴／城巴／港鐵／港鐵巴士${extra.failures.length?`；未能載入：${extra.failures.join("、")}`:""}${sources<2?'；部分站點來源載入失敗':''}${failed?`；${failed} 個站讀取失敗，結果未齊`:''}。未有 ETA 不代表停駛。`;
    } catch(e) { if (token===generation) status.textContent=`搜尋未完成：${e.message}，可再次搜尋。`; }
    finally { if (token===generation) $('#locateBtn').disabled=false; }
  }
  function search(value=radius) {
    radius=[100,200,400].includes(Number(value))?Number(value):100;
    cancel(); const token=generation, selected=radius; shown=20; state.nearby=[];
    $('#nearbyResults').replaceChildren(); $('#nearbyCount').textContent=''; $('#nearbyMore').classList.add('hidden'); $('#nearbyCollapseTop').classList.add('hidden');
    document.querySelectorAll('[data-dz-radius]').forEach(b=>b.classList.toggle('active',Number(b.dataset.dzRadius)===radius));
    $('.nearby-panel .panel-title').textContent=`📍 ${radius}m 附近路線`;
    $('#nearbyStatus').textContent='正在取得位置…'; $('#locateBtn').disabled=true;
    if (!navigator.geolocation) { $('#nearbyStatus').textContent='此瀏覽器不支援定位'; $('#locateBtn').disabled=false; return; }
    navigator.geolocation.getCurrentPosition(p=>{if(token===generation)run(p,selected,token);},e=>{if(token!==generation)return;$('#nearbyStatus').textContent=e.code===1?'請允許定位':'未能取得位置，可再試';$('#locateBtn').disabled=false;},{enableHighAccuracy:false,maximumAge:60000,timeout:8000});
  }
  const controls=document.createElement('div');
  controls.innerHTML='<div class="filter-row"><button type="button" data-dz-radius="100" class="filter active">100m</button><button type="button" data-dz-radius="200" class="filter">200m</button><button type="button" data-dz-radius="400" class="filter">400m</button></div>';
  $('.nearby-panel').appendChild(controls);
  for(const b of document.querySelectorAll('[data-near-filter]')) if(!['all','KMB','CTB','MTR','MTRB'].includes(b.dataset.nearFilter)) b.hidden=true;
  renderNearby=render;
  window.addEventListener('click',e=>{
    const r=e.target.closest?.('[data-dz-radius]');
    if(r || e.target.closest?.('#locateBtn')) { e.preventDefault(); e.stopImmediatePropagation(); search(r?Number(r.dataset.dzRadius):radius); return; }
    if(e.target.closest?.('#nearbyMore')) { e.stopImmediatePropagation(); shown+=20; render(); return; }
    if(e.target.closest?.('#nearbyCollapseTop')) { e.stopImmediatePropagation(); shown=20; render(); return; }
    const card=e.target.closest?.('[data-near-key]');
    if(card) { e.stopImmediatePropagation(); const x=state.nearby.find(x=>x.key===card.dataset.nearKey); if(!x)return;if(x.kind==='rail'){openRailway(x);return;}if(x.operator==='MTRB'){openRoute({...x,region:x.mtrBusRegion});return;}const r=normalizedRoutes().find(r=>r.operator===x.operator&&String(r.route)===String(x.route)&&r.bound===x.bound&&String(r.serviceType)===x.serviceType); if(r)openRoute(r);else{$('#routeSearch').value=x.route;state.searchFilter=x.operator;renderSearch();} }
  },true);
  window.addEventListener('pagehide',cancel);
  window.dzNearby={version:'5.2.0',search,cancel,findStops,mergeRows,addMtr};
})();
