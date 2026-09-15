(() => {
  "use strict";

  // Stable nearby mode: one lightweight search owns the controls. It never
  // creates a duplicate all-Hong-Kong index or starts background ETA fan-out.
  const VERSION="4.2.0";
  const RADII=[100,200,400], MAX_STOPS=4, MAX_ROWS_PER_STOP=6;
  let selectedRadius=100, searchToken=0;
  const activeControllers=new Set();
  const $=s=>document.querySelector(s),pause=()=>new Promise(r=>setTimeout(r,0));

  const point=s=>{const lat=Number(s?.lat??s?.latitude),lon=Number(s?.long??s?.lng??s?.longitude);return Number.isFinite(lat)&&Number.isFinite(lon)?{lat,lon}:null;};
  const nameOf=s=>s?.name_tc||s?.name||s?.stop_name_tc||"";

  function insertNearest(list,row){list.push(row);list.sort((a,b)=>a.distance-b.distance);if(list.length>MAX_STOPS)list.pop();}
  async function nearestStops(pos,radius,token){
    const found=[];
    for(const [operator,map] of [["KMB",state.kmbStops],["CTB",state.ctbStops]]){
      let i=0;
      for(const [id,stop] of map||[]){
        if(token!==searchToken)return [];
        const c=point(stop);
        if(c){const distance=distanceMeters(pos.lat,pos.lon,c.lat,c.lon);if(Number.isFinite(distance)&&distance<=radius)insertNearest(found,{operator,id:String(id),stop,name:nameOf(stop),distance});}
        if((++i%700)===0)await pause();
      }
    }
    return found;
  }
  function abortActiveRequests(){for(const controller of activeControllers)controller.abort();activeControllers.clear();}
  async function fetchJson(url,timeout=4500){
    const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),timeout);
    activeControllers.add(controller);
    try{const r=await fetch(url,{headers:{Accept:"application/json"},cache:"no-store",signal:controller.signal});if(!r.ok)throw new Error(`HTTP ${r.status}`);return await r.json();}
    finally{clearTimeout(timer);activeControllers.delete(controller);}
  }
  async function etaRows(stop){
    try{
      const rows=[];
      if(stop.operator==="KMB"){
        const j=await fetchJson(`${KMB_API}/stop-eta/${encodeURIComponent(stop.id)}`);
        for(const x of j.data||[]){if(validFutureEta(x.eta))rows.push({operator:"KMB",route:x.route,dest:x.dest_tc||"",eta:x.eta,remark:x.rmk_tc||"",distance:stop.distance,stopId:stop.id,stopName:stop.name});if(rows.length>=MAX_ROWS_PER_STOP)break;}
      }else{
        const j=await fetchJson(`https://rt.data.gov.hk/v1/transport/batch/stop-eta/CTB/${encodeURIComponent(stop.id)}`);
        for(const x of j.data||[]){if(validFutureEta(x.eta))rows.push({operator:"CTB",route:x.route,dest:x.dest_tc||"",eta:x.eta,remark:x.rmk_tc||"",distance:stop.distance,stopId:stop.id,stopName:stop.name});if(rows.length>=MAX_ROWS_PER_STOP)break;}
      }
      return rows;
    }catch{return [];}
  }
  function merge(rows){const seen=new Set();return rows.sort((a,b)=>new Date(a.eta)-new Date(b.eta)).filter(row=>{const key=`${row.operator}|${String(row.route).toUpperCase()}`;if(seen.has(key))return false;seen.add(key);return true;});}
  function clearNearbyResponses(){try{for(const key of [...responseCache.keys()])if(/(?:stop-eta|batch\/stop-eta|etagmb)/i.test(key))responseCache.delete(key);}catch{}}
  function finish(token,button){if(token===searchToken&&button)button.disabled=false;}

  function search(radius){
    selectedRadius=RADII.includes(Number(radius))?Number(radius):100;
    abortActiveRequests();
    const token=++searchToken,button=$("#locateBtn"),status=$("#nearbyStatus"),section=$("#nearbySection"),count=$("#nearbyCount");
    if(button)button.disabled=true;if(status)status.textContent=`正在搜尋 ${selectedRadius}m 內最近巴士站…`;
    if(!navigator.geolocation){if(status)status.textContent="此瀏覽器不支援定位。";finish(token,button);return;}
    navigator.geolocation.getCurrentPosition(async position=>{
      try{
        const pos={lat:position.coords.latitude,lon:position.coords.longitude};
        const stops=await nearestStops(pos,selectedRadius,token);if(token!==searchToken)return;
        const rows=[];
        // Sequential requests are deliberate: Safari never holds a burst of ETA
        // responses in memory while it is already rendering the page.
        for(const stop of stops){if(token!==searchToken)return;rows.push(...await etaRows(stop));if(token!==searchToken)return;await pause();}
        if(token!==searchToken)return;
        state.nearby=merge(rows);state.nearbyExpanded=false;
        if(section)section.classList.remove("hidden");if(count)count.textContent=`${selectedRadius}m`;try{renderNearby();}catch{}
        if(status)status.textContent=stops.length?`已顯示 ${selectedRadius}m 內最近 ${stops.length} 個巴士站。`:`${selectedRadius}m 內未找到九巴／城巴站。`;
      }catch{if(token===searchToken&&status)status.textContent="附近搜尋暫時未能完成，請稍後再試。";}
      finally{clearNearbyResponses();finish(token,button);}
    },error=>{if(token===searchToken&&status)status.textContent=error.code===1?"你未允許定位。":"暫時無法取得位置。";finish(token,button);},{enableHighAccuracy:false,maximumAge:60000,timeout:8000});
  }

  // app.js deliberately has no nearby click handler. This capture listener is
  // the sole entry point, including when a cached page has other click handlers.
  window.addEventListener("click",event=>{
    const radiusButton=event.target.closest?.("[data-dz-radius]");
    if(radiusButton){event.preventDefault();event.stopImmediatePropagation();search(Number(radiusButton.dataset.dzRadius)||100);return;}
    if(event.target.closest?.("#locateBtn")){event.preventDefault();event.stopImmediatePropagation();search(selectedRadius);}
  },true);

  const badge=$(".app-version");if(badge){badge.textContent=`v${VERSION}`;badge.setAttribute("aria-label",`版本 v${VERSION}`);}
  window.dzNearby404={version:VERSION,search,nearestStops,cancel:()=>{searchToken++;abortActiveRequests();clearNearbyResponses();}};
})();
