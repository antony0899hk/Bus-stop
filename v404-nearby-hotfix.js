(() => {
  "use strict";
  const VERSION = "4.0.16";
  const CELL = 0.002;
  const grids = {KMB:null,CTB:null,GMB:null};
  const waits = {KMB:null,CTB:null,GMB:null};
  let selectedRadius = 100;
  const $ = s => document.querySelector(s);
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  const coords = s => { const lat=Number(s?.lat??s?.latitude),lon=Number(s?.long??s?.lng??s?.longitude); return Number.isFinite(lat)&&Number.isFinite(lon)?{lat,lon}:null; };
  const mapFor = op => op==='KMB'?state.kmbStops:op==='CTB'?state.ctbStops:state.gmbStops;
  const stopName = s => s?.name_tc||s?.name||s?.stop_name_tc||'';
  const keyFor = (lat,lon) => `${Math.floor(lat/CELL)}:${Math.floor(lon/CELL)}`;
  async function waitForData(op,timeout=15000){ const t=Date.now(); while(Date.now()-t<timeout){const m=mapFor(op);if(m&&m.size)return true;await sleep(150);}return false; }
  async function ensureGrid(op){
    if(grids[op])return grids[op]; if(waits[op])return waits[op];
    waits[op]=(async()=>{const out=new Map();if(!await waitForData(op))return out;let n=0;for(const [id,s] of mapFor(op)){const c=coords(s);if(!c)continue;const k=keyFor(c.lat,c.lon);if(!out.has(k))out.set(k,[]);out.get(k).push({operator:op,id:String(id),stop:s,lat:c.lat,lon:c.lon,name:stopName(s)});if((++n%500)===0)await sleep(0);}grids[op]=out;return out;})().finally(()=>waits[op]=null);return waits[op];
  }
  function releaseGrids(){grids.KMB=null;grids.CTB=null;grids.GMB=null;}
  async function nearbyStops(pos,radius,ops){
    const out=[];
    const latCells=Math.ceil((radius/110540)/CELL)+1,lonCells=Math.ceil((radius/(111320*Math.max(.3,Math.cos(pos.lat*Math.PI/180))))/CELL)+1;
    const latCell=Math.floor(pos.lat/CELL),lonCell=Math.floor(pos.lon/CELL);
    for(const op of ops){const grid=await ensureGrid(op),list=[];for(let y=latCell-latCells;y<=latCell+latCells;y++)for(let x=lonCell-lonCells;x<=lonCell+lonCells;x++)for(const s of grid.get(`${y}:${x}`)||[]){const d=distanceMeters(pos.lat,pos.lon,s.lat,s.lon);if(Number.isFinite(d)&&d<=radius)list.push({...s,distance:d});}list.sort((a,b)=>a.distance-b.distance);out.push(...list.slice(0,op==='GMB'?6:8));}
    return out.sort((a,b)=>a.distance-b.distance);
  }
  async function ctbEta(s){
    try{const j=await getJSON(`https://rt.data.gov.hk/v1/transport/batch/stop-eta/CTB/${encodeURIComponent(s.id)}`,{ttl:15000,retries:0});if((j.data||[]).length)return j.data||[];}catch{}
    try{const sr=await getJSON(`https://rt.data.gov.hk/v1.1/transport/batch/stop-route/CTB/${encodeURIComponent(s.id)}`,{ttl:300000,retries:0});const routes=[...new Set((sr.data||[]).map(x=>x.route).filter(Boolean))].slice(0,15),all=[];await Promise.all(routes.map(async route=>{try{const j=await getJSON(`${CTB_API}/eta/ctb/${encodeURIComponent(s.id)}/${encodeURIComponent(route)}`,{ttl:15000,retries:0});all.push(...(j.data||[]));}catch{}}));return all;}catch{return [];}
  }
  async function etaRows(s){
    const rows=[];try{
      if(s.operator==='KMB'){const j=await getJSON(`${KMB_API}/stop-eta/${encodeURIComponent(s.id)}`,{ttl:15000,retries:0});for(const x of (j.data||[]).slice(0,50))if(validFutureEta(x.eta))rows.push({operator:'KMB',route:x.route,dest:x.dest_tc||'',eta:x.eta,remark:x.rmk_tc||'',distance:s.distance,stopId:s.id,stopName:s.name});}
      else if(s.operator==='CTB'){for(const x of (await ctbEta(s)).slice(0,50))if(validFutureEta(x.eta))rows.push({operator:'CTB',route:x.route,dest:x.dest_tc||'',eta:x.eta,remark:x.rmk_tc||'',distance:s.distance,stopId:s.id,stopName:s.name});}
      else{const j=await getJSON(`${GMB_API}/eta/stop/${encodeURIComponent(s.id)}`,{ttl:15000,retries:0});for(const occ of j.data||[]){if(occ.enabled===false)continue;const meta=state.gmbRoutes.find(r=>String(r.routeId)===String(occ.route_id)&&Number(r.routeSeq)===Number(occ.route_seq));for(const e of occ.eta||[])if(validFutureEta(e.timestamp))rows.push({operator:'GMB',route:meta?.route||'小巴',dest:meta?.dest||'',eta:e.timestamp,remark:e.remarks_tc||'',distance:s.distance,stopId:s.id,stopName:s.name});}}
    }catch{}return rows;
  }
  function normStationName(v=''){return String(v).replace(/港鐵/g,'').replace(/站$/,'').replace(/\s+/g,'').trim();}
  async function nearestMtrRow(pos,maxDistance=1400){
    try{
      const extra=window.dzExtraTransit;
      if(!extra?.ensureMtrData)return null;
      await Promise.race([extra.ensureMtrData(),sleep(8000)]);
      const stations=[...(extra.mtrStations?.values?.()||[])].filter(s=>s?.name_tc);
      if(!stations.length)return null;
      const stationByName=new Map(stations.map(s=>[normStationName(s.name_tc),s]));
      let best=null,n=0;
      for(const op of ['KMB','CTB']){
        const m=mapFor(op);if(!m?.size)continue;
        for(const [id,s] of m){
          const c=coords(s);if(!c)continue;
          const d=distanceMeters(pos.lat,pos.lon,c.lat,c.lon);if(!Number.isFinite(d)||d>maxDistance)continue;
          const name=normStationName(stopName(s));
          if(!name)continue;
          for(const [q,station] of stationByName){
            if(q.length<2||!name.includes(q))continue;
            if(!best||d<best.distance)best={station,distance:d,lat:c.lat,lon:c.lon,stopId:String(id)};
          }
          if((++n%700)===0)await sleep(0);
        }
      }
      if(!best)return null;
      const walkMinutes=Math.max(1,Math.ceil(best.distance/75));
      return {operator:'MTR',route:best.station.name_tc||'港鐵站',dest:'步行前往港鐵站',eta:new Date(Date.now()+walkMinutes*60000).toISOString(),distance:best.distance,stopId:best.station.code||best.stopId,stopName:best.station.name_tc||'港鐵站',walkMinutes,walking:true,mtrStationCode:best.station.code||''};
    }catch{return null;}
  }
  function mergeRows(rows){const seen=new Set();return rows.sort((a,b)=>new Date(a.eta)-new Date(b.eta)).filter(x=>{const k=`${x.operator}|${String(x.route).toUpperCase()}`;if(seen.has(k))return false;seen.add(k);return true;});}
  async function search(radius){
    selectedRadius=[100,200,400].includes(Number(radius))?Number(radius):100;const st=$('#nearbyStatus'),btn=$('#locateBtn'),sec=$('#nearbySection'),count=$('#nearbyCount');if(st)st.textContent=`正在取得位置並搜尋 ${selectedRadius}m…`;if(btn)btn.disabled=true;
    if(!navigator.geolocation){if(st)st.textContent='此瀏覽器不支援定位。';if(btn)btn.disabled=false;return;}
    navigator.geolocation.getCurrentPosition(async p=>{try{const pos={lat:p.coords.latitude,lon:p.coords.longitude};if(st)st.textContent='定位成功，搜尋附近巴士站…';const primary=await nearbyStops(pos,selectedRadius,['KMB','CTB']);const primaryRows=[];await Promise.all(primary.map(async s=>primaryRows.push(...await etaRows(s))));state.nearby=mergeRows(primaryRows);if(sec)sec.classList.remove('hidden');if(count)count.textContent=`${selectedRadius}m`;try{renderNearby();}catch{}if(st)st.textContent=primary.length?`已找到 ${primary.length} 個附近巴士站；小巴及港鐵背景補上。`:`${selectedRadius}m 內暫時未找到九巴／城巴站。`;if(btn)btn.disabled=false;
      try{
        window.dzNearbyPriority3105?.startSecondPhase?.();
        const [_,mtrRow]=await Promise.all([Promise.race([window.dzNearbyPriority3105?.whenReady?.()||Promise.resolve(),sleep(10000)]),nearestMtrRow(pos,1400)]);
        grids.GMB=null;const gmb=await nearbyStops(pos,selectedRadius,['GMB']),gmbRows=[];await Promise.all(gmb.map(async s=>gmbRows.push(...await etaRows(s))));
        state.nearby=mergeRows([...state.nearby,...gmbRows,...(mtrRow?[mtrRow]:[])]);try{renderNearby();}catch{}
        const mtrText=mtrRow?`；最近港鐵 ${mtrRow.stopName} 約 ${mtrRow.walkMinutes} 分鐘步行`:'';
        if(st)st.textContent=`完成 ${selectedRadius}m 附近搜尋：${primary.length+gmb.length} 個附近站${mtrText}。`;
      }catch{}
      setTimeout(releaseGrids,0);
    }catch(e){releaseGrids();if(st)st.textContent=`附近搜尋失敗：${e?.message||'未知錯誤'}`;if(btn)btn.disabled=false;}},err=>{releaseGrids();if(st)st.textContent=err.code===1?'你未允許定位。':'暫時無法取得位置。';if(btn)btn.disabled=false;},{enableHighAccuracy:true,maximumAge:8000,timeout:15000});
  }
  window.addEventListener('click',e=>{const rb=e.target.closest?.('[data-dz-radius]');if(rb){e.preventDefault();e.stopImmediatePropagation();selectedRadius=Number(rb.dataset.dzRadius)||100;search(selectedRadius);return;}const b=e.target.closest?.('#locateBtn');if(b){e.preventDefault();e.stopImmediatePropagation();search(selectedRadius);}},true);
  const badge=document.querySelector('.app-version');if(badge){badge.textContent=`v${VERSION}`;badge.setAttribute('aria-label',`版本 v${VERSION}`);}window.dzNearby404={version:VERSION,search,nearbyStops,releaseGrids,nearestMtrRow};
})();