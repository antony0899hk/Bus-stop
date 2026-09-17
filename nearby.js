(() => {
  'use strict';
  const $ = s => document.querySelector(s);
  let radius = 50, generation = 0, shown = 20;
  let showNoEta = false;
  const selectedDirections = new Map();
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
          if(!validFutureEta(eta))continue;
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


  const normalizeRoute = value => String(value || '').trim().toUpperCase();
  const normalizeDest = value => String(value || '').normalize('NFKC').replace(/\s+/g,'').trim();
  function groupRoutes(input) {
    const groups = new Map();
    for (const row of input) {
      const route = normalizeRoute(row.route);
      const key = row.kind === 'rail' ? 'MTR|'+row.stopId : [row.operator,row.operator==='GMB'?(row.region||''):'',route].join('|');
      if (!groups.has(key)) groups.set(key,{key,operator:row.operator,route:row.route,directions:[]});
      const group=groups.get(key);
      const directionKey=row.kind==='rail'?String(row.stopId):[row.bound||'',normalizeDest(row.dest)].join('|');
      const existing=group.directions.find(x=>x.directionKey===directionKey);
      if(!existing) group.directions.push({...row,directionKey,members:[row]});
      else {
        existing.members.push(row);
        const oldTime=existing.eta?new Date(existing.eta).getTime():Infinity;
        const newTime=row.eta?new Date(row.eta).getTime():Infinity;
        if(newTime<oldTime || (newTime===oldTime && row.distance<existing.distance)){
          const members=existing.members;Object.assign(existing,row,{directionKey,members});
        }
      }
    }
    return [...groups.values()];
  }
  function visibleGroups(){
    const rank=x=>x.kind==='rail'?0:x.eta&&!x.error?1:2;
    return groupRoutes(state.nearby.filter(x=>state.nearbyFilter==='all'||x.operator===state.nearbyFilter)).sort((a,b)=>{
      const x=activeRow(a),y=activeRow(b);
      return rank(x)-rank(y) || (rank(x)===1?new Date(x.eta)-new Date(y.eta):0) || x.distance-y.distance || normalizeRoute(x.route).localeCompare(normalizeRoute(y.route),undefined,{numeric:true});
    });
  }
  function activeRow(group) {
    return group.directions.find(x=>x.directionKey===selectedDirections.get(group.key)) || group.directions[0];
  }
  function render() {
    const groups=visibleGroups();
    const hasForecast=g=>g.directions.some(x=>x.kind==='rail'||x.eta&&!x.error);
    const noEtaCount=groups.filter(g=>!hasForecast(g)).length;
    const displayed=showNoEta?groups:groups.filter(hasForecast);
    $('#nearbySection').classList.remove('hidden');
    $('#nearbyCount').textContent=`共 ${groups.length} 個路線／車站`;
    $('#nearbyResults').innerHTML=displayed.slice(0,shown).map(group=>{
      const x=activeRow(group);
      const toggle=x.kind!=='rail'&&group.directions.length>1 ? `<button type="button" class="near-direction-switch" data-near-switch="${escapeHtml(group.key)}" aria-label="${escapeHtml(x.route)} 切換方向" title="切換方向">⇄</button>` : '';
      return `<article class="near-card near-route-group"><button type="button" class="near-main" data-near-key="${escapeHtml(x.key)}"><div>${operatorBadge(x.operator)}</div><div><div class="near-route">${escapeHtml(x.route)}</div><div class="near-dest">→ ${escapeHtml(x.dest||'目的地未提供')}</div><div class="near-meta">${escapeHtml(x.stopName)} · ${Math.round(x.distance)}m</div></div><div class="near-eta">${escapeHtml(x.kind==='rail'?'查看班次':x.error?'更新失敗':etaLabel(x.eta))}</div></button>${toggle}</article>`;
    }).join('')||(noEtaCount&&!showNoEta?'<div class="empty">附近路線暫時未有預報，撳「更多」查看；未有預報不代表停駛。</div>':'<div class="empty">此範圍暫時未有結果，可撳「＋50 米」擴大搜尋。</div>');
    $('#nearbyMore').classList.toggle('hidden',displayed.length<=shown&&(showNoEta||!noEtaCount));
    $('#nearbyMore').textContent=!showNoEta&&noEtaCount?`更多（包括 ${noEtaCount} 條未有預報路線）`:`顯示更多（尚有 ${Math.max(0,displayed.length-shown)} 個）`;
    $('#nearbyCollapseTop').classList.toggle('hidden',shown<=20&&!showNoEta);
  }
  function mergeRows(stop, data, rows) {
    for (const x of data) {
      if (!x.route) continue;
      const eta = validFutureEta(x.eta) ? x.eta : null;
      const bound=x.dir || x.bound || 'O';
      const catalog=stop.operator==='CTB'?state.ctbRoutes:state.kmbRoutes;
      const meta=(catalog||[]).find(r=>normalizeRoute(r.route)===normalizeRoute(x.route)&&(stop.operator==='CTB'||r.bound===bound&&String(r.service_type||'1')===String(x.service_type||'1')));
      const dest=x.dest_tc || (stop.operator==='CTB'&&bound==='I'?meta?.orig_tc:meta?.dest_tc) || '';
      const key = [stop.operator,x.route,bound,dest,x.service_type || '1'].join('|');
      const row = {...stop,key,route:x.route,dest,bound,serviceType:String(x.service_type || '1'),eta};
      const old = rows.get(key);
      if (!old || (eta && (!old.eta || new Date(eta) < new Date(old.eta))) || (!eta && !old.eta && row.distance < old.distance)) rows.set(key,row);
    }
  }
  async function findStops(pos, selected, token) {
    const found = []; const seenStops=new Set(); let sources = 0;
    for (const [operator,path] of [['KMB','kmb-stops.json'],['CTB','ctb-stops.json']]) {
      if (token !== generation) return {found:[],sources};
      try {
        const j = await json(`./${path}?v=${window.DZ_BUILD || '5.3.1'}`);
        if (!Array.isArray(j.data)) throw Error('invalid stop catalog');
        sources++;
        for (let i=0;i<j.data.length;i++) {
          if (token !== generation) return {found:[],sources};
          const s=j.data[i], lat=Number(s.lat), lon=Number(s.long ?? s.lng ?? s.longitude);
          if (!Number.isFinite(lat) || !Number.isFinite(lon)) continue;
          const distance=distanceMeters(pos.lat,pos.lon,lat,lon);
          const id=String(s.stop||s.id),key=operator+'|'+id;
          if(distance<=selected&&!seenStops.has(key)){seenStops.add(key);found.push({operator,stopId:id,stopName:s.name_tc||'',lat,lon,distance});}
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
      const mtrSchedules=new Map();
      const extra=await addMtr({lat:position.coords.latitude,lon:position.coords.longitude},selected,token,rows);
      if(token!==generation)return;
      const stops=[...busStops,...extra.stops];
      if(!sources&&!rows.size)throw Error('站點資料未能載入');
      for (const stop of stops) {
        if (token !== generation) return;
        status.textContent=`${selected}m：已讀取 ${completed}/${stops.length} 個站／路線（九巴／城巴／港鐵巴士）`;
        try {
          const url=stop.operator==='KMB' ? `${KMB_API}/stop-eta/${encodeURIComponent(stop.stopId)}` : `https://rt.data.gov.hk/v1/transport/batch/stop-eta/CTB/${encodeURIComponent(stop.stopId)}`;
          let j;
          if(stop.operator==='MTRB'){
            if(mtrSchedules.has(stop.route))j=mtrSchedules.get(stop.route);
            else {j=await json('https://rt.data.gov.hk/v1/transport/mtr/bus/getSchedule',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({language:'zh',routeName:stop.route})});mtrSchedules.set(stop.route,j);}
          }else j=await json(url);
          if (token !== generation) return;
          if(stop.operator==='MTRB'){
            if(!Array.isArray(j.busStop))throw Error('invalid MTR bus response');
            const s=j.busStop.find(x=>String(x.busStopId)===stop.stopId);
            const seconds=(s?.bus||[]).map(b=>{const a=b.arrivalTimeInSecond==null?NaN:Number(b.arrivalTimeInSecond),d=b.departureTimeInSecond==null?NaN:Number(b.departureTimeInSecond);return Number.isFinite(a)&&a>=0?a:d;}).filter(n=>Number.isFinite(n)&&n>=0);
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
      status.textContent=`${selected}m：${stops.length} 個站、${groupRoutes([...rows.values()]).length} 個路線／車站。九巴／城巴／港鐵／港鐵巴士${extra.failures.length?`；未能載入：${extra.failures.join("、")}`:""}${sources<2?'；部分站點來源載入失敗':''}${failed?`；${failed} 個站讀取失敗，結果未齊`:''}。未有 ETA 不代表停駛。`;
    } catch(e) { if (token===generation) status.textContent=`搜尋未完成：${e.message}，可再次搜尋。`; }
    finally { if (token===generation) $('#locateBtn').disabled=false; }
  }
  function search(value=radius) {
    radius=Number.isFinite(Number(value))?Math.max(50,Math.min(1000,Math.round(Number(value)/50)*50)):50;
    cancel(); const token=generation, selected=radius; shown=20; showNoEta=false; state.nearby=[]; selectedDirections.clear();
    $('#nearbyResults').replaceChildren(); $('#nearbyCount').textContent=''; $('#nearbyMore').classList.add('hidden'); $('#nearbyCollapseTop').classList.add('hidden');
    const radiusLabel=$('#nearRadiusValue');if(radiusLabel)radiusLabel.textContent=radius+' 米';
    const minus=$('[data-radius-step="-50"]');if(minus)minus.disabled=radius<=50;
    const plus=$('[data-radius-step="50"]');if(plus)plus.disabled=radius>=1000;
    $('.nearby-panel .panel-title').textContent=`📍 ${radius}m 附近路線`;
    $('#nearbyStatus').textContent='正在取得位置…'; $('#locateBtn').disabled=true;
    if (!navigator.geolocation) { $('#nearbyStatus').textContent='此瀏覽器不支援定位'; $('#locateBtn').disabled=false; return; }
    navigator.geolocation.getCurrentPosition(p=>{if(token===generation)run(p,selected,token);},e=>{if(token!==generation)return;$('#nearbyStatus').textContent=e.code===1?'請允許定位':'未能取得位置，可再試';$('#locateBtn').disabled=false;},{enableHighAccuracy:false,maximumAge:60000,timeout:8000});
  }
  const controls=document.createElement('div');
  controls.innerHTML='<div class="filter-row near-radius-controls"><button type="button" data-radius-step="-50" class="filter" disabled aria-label="縮細搜尋範圍 50 米">−50 米</button><strong id="nearRadiusValue" aria-live="polite">50 米</strong><button type="button" data-radius-step="50" class="filter" aria-label="擴大搜尋範圍 50 米">＋50 米</button></div>';
  $('.nearby-panel').appendChild(controls);
  for(const b of document.querySelectorAll('[data-near-filter]')) if(!['all','KMB','CTB','MTR','MTRB'].includes(b.dataset.nearFilter)) b.hidden=true;
  renderNearby=render;
  window.addEventListener('click',e=>{
    const swap=e.target.closest?.('[data-near-switch]');
    if(swap){e.preventDefault();e.stopImmediatePropagation();const group=visibleGroups().find(g=>g.key===swap.dataset.nearSwitch);if(!group)return;const active=activeRow(group);const next=group.directions[(group.directions.indexOf(active)+1)%group.directions.length];selectedDirections.set(group.key,next.directionKey);render();const replacement=[...document.querySelectorAll('[data-near-switch]')].find(b=>b.dataset.nearSwitch===group.key);replacement?.focus({preventScroll:true});return;}
    const step=e.target.closest?.('[data-radius-step]');
    if(step){e.preventDefault();e.stopImmediatePropagation();search(radius+Number(step.dataset.radiusStep));return;}
    const r=e.target.closest?.('[data-dz-radius]');
    if(r || e.target.closest?.('#locateBtn')) { e.preventDefault(); e.stopImmediatePropagation(); search(r?Number(r.dataset.dzRadius):radius); return; }
    if(e.target.closest?.('#nearbyMore')) { e.stopImmediatePropagation(); showNoEta=true; shown+=20; render(); return; }
    if(e.target.closest?.('#nearbyCollapseTop')) { e.stopImmediatePropagation(); shown=20; showNoEta=false; render(); return; }
    const card=e.target.closest?.('[data-near-key]');
    if(card) { e.stopImmediatePropagation(); const x=state.nearby.find(x=>x.key===card.dataset.nearKey); if(!x)return;if(x.kind==='rail'){openRailway(x);return;}if(x.operator==='MTRB'){openRoute({...x,region:x.mtrBusRegion});return;}const r=normalizedRoutes().find(r=>r.operator===x.operator&&String(r.route)===String(x.route)&&r.bound===x.bound&&String(r.serviceType)===x.serviceType); if(r)openRoute(r);else{$('#routeSearch').value=x.route;state.searchFilter=x.operator;renderSearch();} }
  },true);
  window.addEventListener('pagehide',cancel);
  window.dzNearby={version:'5.3.1',search,cancel,findStops,mergeRows,addMtr,groupRoutes};
})();
