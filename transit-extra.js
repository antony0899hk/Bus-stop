(() => {
  "use strict";

  const NLB_API = "https://rt.data.gov.hk/v2/transport/nlb";
  const MTR_LINES_CSV = "https://opendata.mtr.com.hk/data/mtr_lines_and_stations.csv";
  const MTR_FARES_CSV = "https://opendata.mtr.com.hk/data/mtr_lines_fares.csv";
  const MTR_SCHEDULE = "https://rt.data.gov.hk/v1/transport/mtr/getSchedule.php";
  const MTR_RADIUS = 550;

  const extra = {
    nlbRoutes: [],
    nlbStops: new Map(),
    nlbRouteStops: new Map(),
    nlbPromise: null,
    mtrRows: [],
    mtrStations: new Map(),
    mtrGraph: new Map(),
    mtrFares: new Map(),
    mtrPromise: null
  };

  window.dzExtraTransit = extra;

  function splitRouteName(name="") {
    const parts = String(name).split(/\s*>\s*/);
    return { orig: parts[0] || "", dest: parts.slice(1).join(" > ") || "" };
  }

  function csvParse(text) {
    const rows=[]; let row=[], cell="", quoted=false;
    for(let i=0;i<text.length;i++){
      const ch=text[i];
      if(ch==='"'){
        if(quoted && text[i+1]==='"'){cell+='"';i++;}
        else quoted=!quoted;
      } else if(ch===',' && !quoted){row.push(cell);cell="";}
      else if((ch==='\n'||ch==='\r') && !quoted){
        if(ch==='\r'&&text[i+1]==='\n')i++;
        row.push(cell);cell="";
        if(row.some(v=>String(v).trim()))rows.push(row);
        row=[];
      } else cell+=ch;
    }
    if(cell||row.length){row.push(cell);if(row.some(v=>String(v).trim()))rows.push(row);}
    return rows;
  }

  async function ensureNlbRoutes() {
    if (extra.nlbRoutes.length) return extra.nlbRoutes;
    if (extra.nlbPromise) return extra.nlbPromise;
    extra.nlbPromise = getJSON(`${NLB_API}/route.php?action=list`, { ttl: 3600000, retries:1 })
      .then(j => {
        extra.nlbRoutes = (j.routes || []).map(r => {
          const names = splitRouteName(r.routeName_c || r.routeName_e || "");
          return {
            operator:"NLB", route:String(r.routeNo || ""), routeId:String(r.routeId),
            orig:names.orig, dest:names.dest, bound:"", serviceType:"1",
            overnightRoute:Number(r.overnightRoute)||0, specialRoute:Number(r.specialRoute)||0
          };
        });
        return extra.nlbRoutes;
      }).finally(()=>{extra.nlbPromise=null;});
    return extra.nlbPromise;
  }

  async function nlbStopsForRoute(routeId) {
    routeId=String(routeId);
    if (extra.nlbRouteStops.has(routeId)) return extra.nlbRouteStops.get(routeId);
    const j = await getJSON(`${NLB_API}/stop.php?action=list&routeId=${encodeURIComponent(routeId)}`, { ttl:3600000, retries:1 });
    const stops=(j.stops||[]).map((s,i)=>({
      stop:String(s.stopId), seq:i+1, name_tc:s.stopName_c||"", lat:Number(s.latitude), long:Number(s.longitude),
      fare:Number(s.fare), fareHoliday:Number(s.fareHoliday), routeId
    }));
    stops.forEach(s=>{
      const old=extra.nlbStops.get(s.stop)||{};
      extra.nlbStops.set(s.stop,{...old,...s,stop:s.stop,name_tc:s.name_tc,lat:s.lat,long:s.long});
    });
    extra.nlbRouteStops.set(routeId,stops);
    return stops;
  }

  async function ensureNlbCatalog() {
    const routes=await ensureNlbRoutes();
    const pending=routes.filter(r=>!extra.nlbRouteStops.has(String(r.routeId)));
    let i=0;
    await Promise.all(Array.from({length:6},async()=>{
      while(i<pending.length){const r=pending[i++];try{await nlbStopsForRoute(r.routeId);}catch{}}
    }));
  }

  function mtrStationApproxCoords(station) {
    if (!station || typeof allJourneyStops !== "function") return null;
    const q = String(station.name_tc||"").replace(/站$/,'');
    if (!q) return null;
    const candidates=allJourneyStops().filter(s=>Number.isFinite(s.lat)&&Number.isFinite(s.lon)&&String(s.name||'').includes(q));
    if (!candidates.length) return null;
    const c=candidates[0]; return {lat:c.lat,lon:c.lon};
  }

  function addGraphEdge(a,b,line){
    if(!extra.mtrGraph.has(a))extra.mtrGraph.set(a,[]);
    if(!extra.mtrGraph.has(b))extra.mtrGraph.set(b,[]);
    if(!extra.mtrGraph.get(a).some(x=>x.to===b&&x.line===line))extra.mtrGraph.get(a).push({to:b,line});
    if(!extra.mtrGraph.get(b).some(x=>x.to===a&&x.line===line))extra.mtrGraph.get(b).push({to:a,line});
  }

  async function ensureMtrData() {
    if (extra.mtrRows.length) return;
    if (extra.mtrPromise) return extra.mtrPromise;
    extra.mtrPromise=(async()=>{
      const [lr,fr] = await Promise.all([
        fetch(MTR_LINES_CSV,{cache:"force-cache"}).then(r=>{if(!r.ok)throw new Error(`MTR lines HTTP ${r.status}`);return r.text();}),
        fetch(MTR_FARES_CSV,{cache:"force-cache"}).then(r=>r.ok?r.text():"").catch(()=>"")
      ]);
      const rows=csvParse(lr);
      const header=rows.shift().map(x=>String(x).trim().toUpperCase());
      const idx=(...names)=>{for(const n of names){const i=header.indexOf(n);if(i>=0)return i;}return -1;};
      const iLine=idx("LINE_CODE","LINE CODE"), iDir=idx("DIRECTION"), iCode=idx("STATION_CODE","STATION CODE"), iId=idx("STATION_ID","STATION ID"), iTc=idx("CHINESE_NAME","CHINESE NAME"), iEn=idx("ENGLISH_NAME","ENGLISH NAME"), iSeq=idx("SEQUENCE");
      extra.mtrRows=rows.map(r=>({line:r[iLine]||r[0],dir:r[iDir]||r[1],code:r[iCode]||r[2],id:r[iId]||r[3],name_tc:r[iTc]||r[4],name_en:r[iEn]||r[5],seq:Number(r[iSeq]||r[6])})).filter(x=>x.line&&x.code&&x.name_tc&&Number.isFinite(x.seq));
      for(const r of extra.mtrRows){
        if(!extra.mtrStations.has(r.code)) extra.mtrStations.set(r.code,{code:r.code,id:r.id,name_tc:r.name_tc,name_en:r.name_en,lines:new Set()});
        extra.mtrStations.get(r.code).lines.add(r.line);
      }
      const byLineDir=new Map();
      for(const r of extra.mtrRows){const k=`${r.line}|${r.dir}`;if(!byLineDir.has(k))byLineDir.set(k,[]);byLineDir.get(k).push(r);}
      for(const list of byLineDir.values()){
        list.sort((a,b)=>a.seq-b.seq);
        for(let i=0;i<list.length-1;i++) addGraphEdge(list[i].code,list[i+1].code,list[i].line);
      }
      if(fr){
        const fares=csvParse(fr), fh=fares.shift().map(x=>String(x).trim().toUpperCase());
        const fi=n=>fh.indexOf(n), sId=fi("SRC_STATION_ID"), dId=fi("DEST_STATION_ID"), fId=fi("OCT_ADT_FARE");
        if(sId>=0&&dId>=0&&fId>=0){fares.forEach(r=>{const f=Number(r[fId]);if(Number.isFinite(f))extra.mtrFares.set(`${r[sId]}|${r[dId]}`,f);});}
      }
    })().finally(()=>{extra.mtrPromise=null;});
    return extra.mtrPromise;
  }

  function mtrMatch(value, location=null){
    const q=String(value||"").trim().replace(/\s+/g,"").replace(/港鐵/g,"").replace(/站$/,'');
    const out=[];
    for(const s of extra.mtrStations.values()){
      const tc=String(s.name_tc||"").replace(/站$/,'');
      const en=String(s.name_en||"").toLowerCase().replace(/\s+/g,'');
      let rank=99;
      if(location){const c=mtrStationApproxCoords(s);if(!c)continue;const d=distanceMeters(location.lat,location.lon,c.lat,c.lon);if(d<=MTR_RADIUS)out.push({...s,operator:"MTR",lat:c.lat,lon:c.lon,distance:d,rank:d});continue;}
      const qq=q.toLowerCase();
      if(tc===q||en===qq)rank=0; else if(tc.includes(q)||en.includes(qq))rank=1;
      if(rank<99)out.push({...s,operator:"MTR",distance:0,rank});
    }
    return out.sort((a,b)=>a.rank-b.rank).slice(0,12);
  }

  function shortestMtrPath(startCodes,endCodes){
    const target=new Set(endCodes), queue=[]; const seen=new Set();
    for(const s of startCodes){queue.push({code:s,path:[s],lines:[]});seen.add(s);}
    while(queue.length){
      const cur=queue.shift(); if(target.has(cur.code))return cur;
      for(const edge of extra.mtrGraph.get(cur.code)||[]){if(seen.has(edge.to))continue;seen.add(edge.to);queue.push({code:edge.to,path:[...cur.path,edge.to],lines:[...cur.lines,edge.line]});}
    }
    return null;
  }

  async function mtrEta(line,stationCode){
    try{
      const j=await getJSON(`${MTR_SCHEDULE}?line=${encodeURIComponent(line)}&sta=${encodeURIComponent(stationCode)}`,{ttl:10000,retries:0});
      const key=`${line}-${stationCode}`; const d=j.data?.[key]; if(!d)return null;
      const all=[...(d.UP||[]),...(d.DOWN||[])].filter(x=>x.time).sort((a,b)=>String(a.time).localeCompare(String(b.time)));
      return all[0]?.time||null;
    }catch{return null;}
  }

  async function mtrJourneyCandidate(fromValue,toValue,originLocation){
    await ensureMtrData();
    const origins=mtrMatch(fromValue,originLocation), dests=mtrMatch(toValue,null);
    if(!origins.length||!dests.length)return null;
    const path=shortestMtrPath(origins.map(x=>x.code),dests.map(x=>x.code));
    if(!path)return null;
    const o=extra.mtrStations.get(path.path[0]), d=extra.mtrStations.get(path.path[path.path.length-1]);
    const uniqueLines=[]; path.lines.forEach(l=>{if(uniqueLines[uniqueLines.length-1]!==l)uniqueLines.push(l);});
    const fare=extra.mtrFares.get(`${o.id}|${d.id}`) ?? extra.mtrFares.get(`${d.id}|${o.id}`) ?? null;
    const eta=uniqueLines[0]?await mtrEta(uniqueLines[0],o.code):null;
    return {kind:"mtr",operator:"MTR",route:uniqueLines.join(" → "),transferCount:Math.max(0,uniqueLines.length-1),stopCount:Math.max(0,path.path.length-1),walkMeters:origins.find(x=>x.code===o.code)?.distance||0,fare,eta,originStop:{id:o.code,name:o.name_tc},destinationStop:{id:d.code,name:d.name_tc},mtrPath:path.path,mtrLines:uniqueLines};
  }

  function nlbBadge(){return '<span class="badge nlb">嶼巴</span>';}

  function installNlbUi(){
    document.querySelectorAll('.filter-row').forEach(row=>{
      const isSearch=row.classList.contains('search-filters');
      const attr=isSearch?'data-search-filter':'data-near-filter';
      if(row.querySelector(`[${attr}="NLB"]`))return;
      const mtr=row.querySelector(`[${attr}="MTR"]`);
      const b=document.createElement('button');b.className='filter nlb-filter';b.setAttribute(attr,'NLB');b.textContent='嶼巴';
      if(mtr)mtr.insertAdjacentElement('beforebegin',b);else row.appendChild(b);
      if(isSearch)b.addEventListener('click',()=>{state.searchFilter='NLB';row.querySelectorAll('[data-search-filter]').forEach(x=>x.classList.toggle('active',x===b));if(document.querySelector('#routeSearch').value.trim())renderSearch();});
      else b.addEventListener('click',()=>{state.nearbyFilter='NLB';state.nearbyExpanded=false;row.querySelectorAll('[data-near-filter]').forEach(x=>x.classList.toggle('active',x===b));renderNearby();});
    });
  }

  const originalBadge=operatorBadge;
  operatorBadge=function(op){if(op==='NLB')return nlbBadge();return originalBadge(op);};

  const originalNormalized=normalizedRoutes;
  normalizedRoutes=function(){return [...originalNormalized(),...extra.nlbRoutes];};

  const originalOpenRoute=openRoute;
  openRoute=async function(r){
    if(r?.operator!=='NLB')return originalOpenRoute(r);
    state.selectedRoute=r;
    document.querySelector('#resultsSection').classList.add('hidden');
    document.querySelector('#routeSection').classList.remove('hidden');
    document.querySelector('#routeHeader').innerHTML=`<div class="route-title"><div><div class="number">${escapeHtml(r.route)}</div><div class="dest">${escapeHtml(r.orig)} ↔ ${escapeHtml(r.dest)}</div>${nlbBadge()}</div></div>`;
    document.querySelector('#directionTabs').innerHTML='';
    document.querySelector('#stops').innerHTML='<div class="loading">正在載入嶼巴站點及 ETA…</div>';
    try{
      const stops=await nlbStopsForRoute(r.routeId);
      document.querySelector('#stops').innerHTML=stops.map((s,i)=>`<div class="stop-row" data-stop-id="${escapeHtml(s.stop)}"><div class="stop-no">${i+1}</div><div><div class="stop-name">${escapeHtml(s.name_tc||s.stop)}</div><div class="etas"><span class="eta-chip">載入 ETA…</span>${Number.isFinite(s.fare)?`<span class="eta-chip">$${s.fare.toFixed(1)}${Number.isFinite(s.fareHoliday)&&s.fareHoliday!==s.fare?`／假日 $${s.fareHoliday.toFixed(1)}`:''}</span>`:''}</div></div></div>`).join('');
      await parallel(stops,4,async s=>{
        try{
          const j=await getJSON(`${NLB_API}/stop.php?action=estimatedArrivals&routeId=${encodeURIComponent(r.routeId)}&stopId=${encodeURIComponent(s.stop)}&language=zh`,{ttl:20000,retries:0});
          const etas=(j.estimatedArrivals||[]).map(x=>({eta:String(x.estimatedArrivalTime||'').replace(' ','T')+'+08:00',rmk_tc:x.routeVariantName||''})).filter(x=>validFutureEta(x.eta)).slice(0,3);
          fillEta(s.stop,etas);
        }catch{fillEta(s.stop,[]);}
      });
    }catch(e){document.querySelector('#stops').innerHTML=`<div class="error">嶼巴資料暫時未能載入：${escapeHtml(e.message)}</div>`;}
  };

  async function supplementNlbNearby(){
    try{
      await ensureNlbCatalog();
      const pos=await new Promise((resolve,reject)=>navigator.geolocation.getCurrentPosition(resolve,reject,{enableHighAccuracy:true,timeout:12000,maximumAge:30000}));
      const candidates=[];
      for(const [id,s] of extra.nlbStops){const d=distanceMeters(pos.coords.latitude,pos.coords.longitude,Number(s.lat),Number(s.long));if(Number.isFinite(d)&&d<=100)candidates.push({id,s,d});}
      candidates.sort((a,b)=>a.d-b.d);
      const rows=[];
      await parallel(candidates.slice(0,12),4,async c=>{
        for(const r of extra.nlbRoutes){const stops=extra.nlbRouteStops.get(String(r.routeId))||[];const hit=stops.find(x=>x.stop===c.id);if(!hit)continue;
          try{const j=await getJSON(`${NLB_API}/stop.php?action=estimatedArrivals&routeId=${encodeURIComponent(r.routeId)}&stopId=${encodeURIComponent(c.id)}&language=zh`,{ttl:20000,retries:0});for(const e of j.estimatedArrivals||[]){const eta=String(e.estimatedArrivalTime||'').replace(' ','T')+'+08:00';if(validFutureEta(eta))rows.push({operator:'NLB',route:r.route,dest:r.dest,eta,remark:e.routeVariantName||'',distance:c.d,stopId:c.id,stopName:c.s.name_tc||'',fare:Number(hit.fare)});}}catch{}
        }
      });
      state.nearby.push(...rows);
      const seen=new Set(); state.nearby=state.nearby.sort((a,b)=>new Date(a.eta)-new Date(b.eta)).filter(x=>{const k=[x.operator,x.route,x.eta,x.stopId,x.dest].join('|');if(seen.has(k))return false;seen.add(k);return true;});
      renderNearby();
    }catch{}
  }

  const oldRenderNearby=renderNearby;
  renderNearby=function(){
    oldRenderNearby();
    document.querySelectorAll('#nearbyResults .near-card').forEach(card=>{
      const route=card.querySelector('.near-route')?.textContent?.trim(); const meta=card.querySelector('.near-meta')?.textContent||'';
      const stopName=meta.split('·')[0].trim(); const x=state.nearby.find(v=>String(v.route)===route&&v.stopName===stopName);
      if(x?.operator==='NLB'&&Number.isFinite(x.fare)&&!card.querySelector('.near-fare')) card.querySelector('.near-meta')?.insertAdjacentHTML('beforeend',`<span class="near-fare"> · $${Number(x.fare).toFixed(1)}</span>`);
    });
  };

  document.querySelector('#locateBtn')?.addEventListener('click',()=>setTimeout(supplementNlbNearby,150));

  const oldRunJourney=runJourneySearch;
  runJourneySearch=async function(){
    const originValue=document.querySelector('#journeyFrom').value;
    const destinationValue=document.querySelector('#journeyTo').value;
    await Promise.allSettled([ensureNlbCatalog(),ensureMtrData()]);
    await oldRunJourney();

    const norm=v=>String(v||'').trim().toLowerCase().replace(/[\s　]+/g,'');
    const qO=norm(originValue), qD=norm(destinationValue);
    const loc=journeyState.originLocation;
    const nlbCandidates=[];
    for(const r of extra.nlbRoutes){const stops=extra.nlbRouteStops.get(String(r.routeId))||[];let origins=[],dests=[];
      if(loc) origins=stops.map((s,i)=>({s,i,d:distanceMeters(loc.lat,loc.lon,s.lat,s.long)})).filter(x=>Number.isFinite(x.d)&&x.d<=JOURNEY_RADIUS);
      else origins=stops.map((s,i)=>({s,i,d:0})).filter(x=>norm(x.s.name_tc).includes(qO));
      dests=stops.map((s,i)=>({s,i,d:0})).filter(x=>norm(x.s.name_tc).includes(qD));
      for(const o of origins){const d=dests.find(x=>x.i>o.i);if(!d)continue;let eta=null;try{const j=await getJSON(`${NLB_API}/stop.php?action=estimatedArrivals&routeId=${encodeURIComponent(r.routeId)}&stopId=${encodeURIComponent(o.s.stop)}&language=zh`,{ttl:20000,retries:0});const e=(j.estimatedArrivals||[])[0];if(e)eta=String(e.estimatedArrivalTime||'').replace(' ','T')+'+08:00';}catch{}
        nlbCandidates.push({kind:'direct',transferCount:0,operator:'NLB',route:r.route,bound:'',serviceType:'1',routeId:r.routeId,originStop:{id:o.s.stop,name:o.s.name_tc},destinationStop:{id:d.s.stop,name:d.s.name_tc},originPos:o.i,destinationPos:d.i,stopCount:d.i-o.i,walkMeters:o.d+d.d,meta:{orig:r.orig,dest:r.dest},eta,fare:Number(o.s.fare)});break;}
    }
    const mtr=await mtrJourneyCandidate(originValue,destinationValue,loc).catch(()=>null);
    if(nlbCandidates.length) journeyState.results.push(...nlbCandidates.slice(0,12));
    if(mtr) journeyState.results.push(mtr);
    renderJourneyResults();
    const st=document.querySelector('#journeyStatus');if(st)st.textContent=st.textContent.replace('九巴／龍運、城巴及綠色專線小巴','九巴／龍運、城巴、綠色專線小巴、嶼巴及港鐵');
  };

  const oldRenderJourney=renderJourneyResults;
  function appendMtrCards(items){
    const box=document.querySelector('#journeyResults'); if(!box)return;
    for(const mtr of items){
      const names=mtr.mtrPath.map(c=>extra.mtrStations.get(c)?.name_tc||c);
      box.insertAdjacentHTML('beforeend',`<article class="journey-card journey-mtr-card"><div class="journey-rank">🚇</div><div class="journey-main"><div class="journey-top"><div><span class="badge mtr">MTR</span> <strong>${escapeHtml(mtr.route||'港鐵')}</strong></div><div class="journey-eta">${mtr.eta?escapeHtml(mtr.eta.split(' ')[1]?.slice(0,5)||mtr.eta):'列車班次密'}</div></div><div class="journey-title">${escapeHtml(names[0])} → ${escapeHtml(names[names.length-1])}</div><div class="journey-meta">${mtr.transferCount?`轉 ${mtr.transferCount} 次 · `:''}約 ${mtr.stopCount} 站${mtr.fare!=null?` · $${Number(mtr.fare).toFixed(1)}`:''}</div><div class="journey-note">${escapeHtml(names.join(' → '))}</div></div></article>`);
    }
  }
  renderJourneyResults=function(){
    const only=journeyState.results.filter(r=>r.kind!=='mtr');
    const mtr=journeyState.results.filter(r=>r.kind==='mtr');
    const original=journeyState.results; journeyState.results=only; oldRenderJourney(); journeyState.results=original;
    appendMtrCards(mtr);
  };

  document.querySelector('#journeySearchBtn')?.addEventListener('click',e=>{
    e.preventDefault(); e.stopImmediatePropagation(); runJourneySearch();
  },true);

  async function init(){
    installNlbUi();
    const status=document.querySelector('#status');
    try{await ensureNlbRoutes(); if(status&&status.textContent.includes('已載入')) status.textContent=status.textContent.replace('九巴＋城巴＋小巴','九巴＋城巴＋小巴＋嶼巴');}catch{}
    ensureMtrData().catch(()=>{});
    const js=document.querySelector('#journeyStatus');if(js)js.textContent='支援九巴／龍運、城巴、綠色專線小巴、嶼巴及港鐵；直達優先，並嘗試一次轉車方案。';
  }

  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',init,{once:true});else init();
})();