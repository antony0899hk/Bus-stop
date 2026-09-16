(() => {
  'use strict';
  const $ = s => document.querySelector(s);
  let radius = 100, generation = 0, shown = 20;
  const controllers = new Set();
  const pause = () => new Promise(r => setTimeout(r, 0));
  function cancel() { generation++; for (const c of controllers) c.abort(); controllers.clear(); }
  async function json(url) {
    const c = new AbortController(); controllers.add(c);
    const timer = setTimeout(() => c.abort(), 10000);
    try { const r = await fetch(url, {signal:c.signal, cache:'no-store'}); if (!r.ok) throw Error(`HTTP ${r.status}`); return await r.json(); }
    finally { clearTimeout(timer); controllers.delete(c); }
  }
  function render() {
    const rows = state.nearby.filter(x => state.nearbyFilter === 'all' || x.operator === state.nearbyFilter);
    $('#nearbySection').classList.remove('hidden');
    $('#nearbyCount').textContent = `共 ${rows.length} 條路線方向`;
    $('#nearbyResults').innerHTML = rows.slice(0,shown).map(x => `<button type="button" class="near-card" data-near-key="${escapeHtml(x.key)}"><div>${operatorBadge(x.operator)}</div><div><div class="near-route">${escapeHtml(x.route)}</div><div class="near-dest">→ ${escapeHtml(x.dest || '目的地未提供')}</div><div class="near-meta">${escapeHtml(x.stopName)} · ${Math.round(x.distance)}m</div></div><div class="near-eta">${escapeHtml(x.error ? '更新失敗' : etaLabel(x.eta))}</div></button>`).join('') || '<div class="empty">暫時未有路線資料；請查看上方搜尋狀態。</div>';
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
        const j = await json(`./${path}?v=${window.DZ_BUILD || '5.1.0'}`);
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
      const {found:stops,sources} = await findStops({lat:position.coords.latitude,lon:position.coords.longitude},selected,token);
      if (token !== generation) return;
      if (!sources) throw Error('站點資料未能載入');
      const rows=new Map(); let completed=0, failed=0;
      for (const stop of stops) {
        if (token !== generation) return;
        status.textContent=`${selected}m：已讀取 ${completed}/${stops.length} 個站（九巴／城巴）`;
        try {
          const url=stop.operator==='KMB' ? `${KMB_API}/stop-eta/${encodeURIComponent(stop.stopId)}` : `https://rt.data.gov.hk/v1/transport/batch/stop-eta/CTB/${encodeURIComponent(stop.stopId)}`;
          const j=await json(url);
          if (token !== generation) return;
          if (!Array.isArray(j.data)) throw Error('invalid ETA response');
          mergeRows(stop,j.data,rows);
        } catch(e) { if (token !== generation) return; failed++; }
        completed++;
        state.nearby=[...rows.values()].sort((a,b)=>(a.eta ? new Date(a.eta).getTime() : Infinity)-(b.eta ? new Date(b.eta).getTime() : Infinity) || a.distance-b.distance);
        render(); await pause();
      }
      if (token !== generation) return;
      render();
      status.textContent=`${selected}m：${stops.length} 個站、${rows.size} 條回傳路線方向。九巴／城巴${sources<2?'；部分站點來源載入失敗':''}${failed?`；${failed} 個站讀取失敗，結果未齊`:''}。未有 ETA 不代表停駛。`;
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
  for(const b of document.querySelectorAll('[data-near-filter]')) if(!['all','KMB','CTB'].includes(b.dataset.nearFilter)) b.hidden=true;
  renderNearby=render;
  window.addEventListener('click',e=>{
    const r=e.target.closest?.('[data-dz-radius]');
    if(r || e.target.closest?.('#locateBtn')) { e.preventDefault(); e.stopImmediatePropagation(); search(r?Number(r.dataset.dzRadius):radius); return; }
    if(e.target.closest?.('#nearbyMore')) { e.stopImmediatePropagation(); shown+=20; render(); return; }
    if(e.target.closest?.('#nearbyCollapseTop')) { e.stopImmediatePropagation(); shown=20; render(); return; }
    const card=e.target.closest?.('[data-near-key]');
    if(card) { e.stopImmediatePropagation(); const x=state.nearby.find(x=>x.key===card.dataset.nearKey); if(!x)return;const r=normalizedRoutes().find(r=>r.operator===x.operator&&String(r.route)===String(x.route)&&r.bound===x.bound&&String(r.serviceType)===x.serviceType); if(r)openRoute(r);else{$('#routeSearch').value=x.route;state.searchFilter=x.operator;renderSearch();} }
  },true);
  window.addEventListener('pagehide',cancel);
  window.dzNearby={version:'5.1.0',search,cancel,findStops,mergeRows};
})();
