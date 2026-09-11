(() => {
  "use strict";
  const VERSION="4.1.0",CELL=.002;
  const grids={KMB:null,CTB:null},waits={KMB:null,CTB:null};
  let selectedRadius=100;
  const $=s=>document.querySelector(s),sleep=ms=>new Promise(r=>setTimeout(r,ms));
  const coords=s=>{const lat=Number(s?.lat??s?.latitude),lon=Number(s?.long??s?.lng??s?.longitude);return Number.isFinite(lat)&&Number.isFinite(lon)?{lat,lon}:null;};
  const mapFor=op=>op==='KMB'?state.kmbStops:state.ctbStops;
  const stopName=s=>s?.name_tc||s?.name||s?.stop_name_tc||'';
  const keyFor=(lat,lon)=>`${Math.floor(lat/CELL)}:${Math.floor(lon/CELL)}`;

  async function ensureGrid(op){
    if(grids[op])return grids[op];if(waits[op])return waits[op];
    waits[op]=(async()=>{const out=new Map(),src=mapFor(op);if(!src?.size)return out;let n=0;for(const [id,s] of src){const c=coords(s);if(!c)continue;const k=keyFor(c.lat,c.lon);if(!out.has(k))out.set(k,[]);out.get(k).push({operator:op,id:String(id),stop:s,lat:c.lat,lon:c.lon,name:stopName(s)});if((++n%600)===0)await sleep(0);}grids[op]=out;return out;})().finally(()=>waits[op]=null);return waits[op];
  }
  function releaseGrids(){grids.KMB=null;grids.CTB=null;}
  async function nearbyStops(pos,radius,ops=['KMB','CTB'],limitPerOp=8){
    const out=[],latCells=Math.ceil((radius/110540)/CELL)+1,lonCells=Math.ceil((radius/(111320*Math.max(.3,Math.cos(pos.lat*Math.PI/180))))/CELL)+1,cy=Math.floor(pos.lat/CELL),cx=Math.floor(pos.lon/CELL);
    for(const op of ops){const grid=await ensureGrid(op),list=[];for(let y=cy-latCells;y<=cy+latCells;y++)for(let x=cx-lonCells;x<=cx+lonCells;x++)for(const s of grid.get(`${y}:${x}`)||[]){const d=distanceMeters(pos.lat,pos.lon,s.lat,s.lon);if(Number.isFinite(d)&&d<=radius)list.push({...s,distance:d});}list.sort((a,b)=>a.distance-b.distance);out.push(...list.slice(0,limitPerOp));}
    return out.sort((a,b)=>a.distance-b.distance);
  }
  async function ctbEta(s){
    try{const j=await getJSON(`https://rt.data.gov.hk/v1/transport/batch/stop-eta/CTB/${encodeURIComponent(s.id)}`,{ttl:15000,retries:0});if((j.data||[]).length)return j.data||[];}catch{}
    return [];
  }
  async function etaRows(s){
    const rows=[];try{
      if(s.operator==='KMB'){const j=await getJSON(`${KMB_API}/stop-eta/${encodeURIComponent(s.id)}`,{ttl:15000,retries:0});for(const x of (j.data||[]).slice(0,50))if(validFutureEta(x.eta))rows.push({operator:'KMB',route:x.route,dest:x.dest_tc||'',eta:x.eta,remark:x.rmk_tc||'',distance:s.distance,stopId:s.id,stopName:s.name});}
      else if(s.operator==='CTB'){for(const x of (await ctbEta(s)).slice(0,50))if(validFutureEta(x.eta))rows.push({operator:'CTB',route:x.route,dest:x.dest_tc||'',eta:x.eta,remark:x.rmk_tc||'',distance:s.distance,stopId:s.id,stopName:s.name});}
      else if(s.operator==='GMB'){const j=await getJSON(`${GMB_API}/eta/stop/${encodeURIComponent(s.id)}`,{ttl:15000,retries:0});for(const occ of j.data||[]){if(occ.enabled===false)continue;const meta=state.gmbRoutes?.find(r=>String(r.routeId)===String(occ.route_id)&&Number(r.routeSeq)===Number(occ.route_seq));const sr=s.stop?.routes?.find(r=>String(r.routeId)===String(occ.route_id)&&Number(r.routeSeq)===Number(occ.route_seq));for(const e of occ.eta||[])if(validFutureEta(e.timestamp))rows.push({operator:'GMB',route:meta?.route||sr?.route||'小巴',dest:meta?.dest||'',eta:e.timestamp,remark:e.remarks_tc||'',distance:s.distance,stopId:s.id,stopName:s.name});}}
    }catch{}return rows;
  }
  function normStationName(v=''){return String(v).replace(/港鐵/g,'').replace(/站$/,'').replace(/\s+/g,'').trim();}
  async function nearestMtrRow(pos,maxDistance=1400){
    try{const extra=window.dzExtraTransit;if(!extra?.ensureMtrData)return null;await Promise.race([extra.ensureMtrData(),sleep(7000)]);const stations=[...(extra.mtrStations?.values?.()||[])].filter(s=>s?.name_tc);if(!stations.length)return null;const stationByName=new Map(stations.map(s=>[normStationName(s.name_tc),s]));let best=null;const localStops=await nearbyStops(pos,maxDistance,['KMB','CTB'],80);for(const s of localStops){const name=normStationName(s.name);if(!name)continue;for(const [q,station] of stationByName){if(q.length<2||!name.includes(q))continue;if(!best||s.distance<best.distance)best={station,distance:s.distance,lat:s.lat,lon:s.lon,stopId:String(s.id)};}}if(!best)return null;const walkMinutes=Math.max(1,Math.ceil(best.distance/75));return {operator:'MTR',route:best.station.name_tc||'港鐵站',dest:'步行前往港鐵站',eta:new Date(Date.now()+walkMinutes*60000).toISOString(),distance:best.distance,stopId:best.station.code||best.stopId,stopName:best.station.name_tc||'港鐵站',walkMinutes,walking:true,mtrStationCode:best.station.code||'',lat:best.lat,lon:best.lon};}catch{return null;}
  }
  function mergeRows(rows){const seen=new Set();return rows.sort((a,b)=>new Date(a.eta)-new Date(b.eta)).filter(x=>{const k=`${x.operator}|${String(x.route).toUpperCase()}`;if(seen.has(k))return false;seen.add(k);return true;});}

  async function search(radius){
    selectedRadius=[100,200,400].includes(Number(radius))?Number(radius):100;
    const st=$('#nearbyStatus'),btn=$('#locateBtn'),sec=$('#nearbySection'),count=$('#nearbyCount');if(st)st.textContent=`正在取得位置並搜尋 ${selectedRadius}m…`;if(btn)btn.disabled=true;
    if(!navigator.geolocation){if(st)st.textContent='此瀏覽器不支援定位。';if(btn)btn.disabled=false;return;}
    navigator.geolocation.getCurrentPosition(async p=>{try{
      const pos={lat:p.coords.latitude,lon:p.coords.longitude};if(st)st.textContent='定位成功，搜尋附近巴士站…';
      const primary=await nearbyStops(pos,selectedRadius,['KMB','CTB']),primaryRows=[];await Promise.all(primary.map(async s=>primaryRows.push(...await etaRows(s))));
      state.nearby=mergeRows(primaryRows);if(sec)sec.classList.remove('hidden');if(count)count.textContent=`${selectedRadius}m`;try{renderNearby();}catch{}if(btn)btn.disabled=false;
      if(st)st.textContent=`已顯示 ${selectedRadius}m 內九巴／城巴；其他服務按區域背景補上。`;
      try{
        window.dzNearbyPriority3105?.prepareMtr?.();
        const [gmb,mtrBusRows,mtrRow]=await Promise.all([
          window.dzNearbyPriority3105?.scanGmbNearby?.(pos,selectedRadius,6)||Promise.resolve([]),
          window.dzMtrBus?.nearby?.(pos,selectedRadius)||Promise.resolve([]),
          Promise.race([nearestMtrRow(pos,1400),sleep(6000).then(()=>null)])
        ]);
        const gmbRows=[];await Promise.all((gmb||[]).map(async s=>gmbRows.push(...await etaRows(s))));
        state.nearby=mergeRows([...state.nearby,...gmbRows,...(mtrBusRows||[]),...(mtrRow?[mtrRow]:[])]);try{renderNearby();}catch{}
        const mtrText=mtrRow?`；最近港鐵 ${mtrRow.stopName} 約 ${mtrRow.walkMinutes} 分鐘步行`:'';
        if(st)st.textContent=`完成 ${selectedRadius}m 附近搜尋：${primary.length+(gmb||[]).length} 個地面站${mtrText}。`;
      }catch{}
      setTimeout(releaseGrids,0);
    }catch(e){releaseGrids();if(st)st.textContent=`附近搜尋失敗：${e?.message||'未知錯誤'}`;if(btn)btn.disabled=false;}},err=>{releaseGrids();if(st)st.textContent=err.code===1?'你未允許定位。':'暫時無法取得位置。';if(btn)btn.disabled=false;},{enableHighAccuracy:true,maximumAge:8000,timeout:15000});
  }
  window.addEventListener('click',e=>{const rb=e.target.closest?.('[data-dz-radius]');if(rb){e.preventDefault();e.stopImmediatePropagation();selectedRadius=Number(rb.dataset.dzRadius)||100;search(selectedRadius);return;}const b=e.target.closest?.('#locateBtn');if(b){e.preventDefault();e.stopImmediatePropagation();search(selectedRadius);}},true);
  const badge=document.querySelector('.app-version');if(badge){badge.textContent=`v${VERSION}`;badge.setAttribute('aria-label',`版本 v${VERSION}`);}window.dzNearby404={version:VERSION,search,nearbyStops,releaseGrids,nearestMtrRow};
})();