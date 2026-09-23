(() => {
  "use strict";
  const $=s=>document.querySelector(s);
  const QUICK_KEY="daozhan.quickPlaces.v3",RECENT_KEY="daozhan.journeyRecent.v1";
  const esc=v=>String(v??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
  const read=(k,f)=>{try{return JSON.parse(localStorage.getItem(k))??f}catch{return f}};
  const write=(k,v)=>{try{localStorage.setItem(k,JSON.stringify(v))}catch{}};
  const norm=v=>String(v||"").replace(/[\s　]+/g,"");
  const SPECIAL_EAL_ROUTES=new Set(["848"]);

  function quickPlaces(){const a=read(QUICK_KEY,[]);return Array.isArray(a)?a:[];}
  function renderQuickRows(){
    const list=quickPlaces(),head=$("#journeyQuickPlaces"),sub=$("#journeyRecentPlaces");
    if(head){const fixed=list.filter(p=>p.id==="home"||p.id==="office");head.innerHTML=fixed.map(p=>`<button class="journey-quick-btn" type="button" data-quick="${esc(p.id)}"><span>${p.icon||"📍"}</span><strong>${esc(p.label)}</strong></button>`).join("")+`<button class="journey-quick-btn add" type="button" data-add-quick="1"><span>＋</span><strong>新增</strong></button>`;}
    if(sub){const custom=list.filter(p=>!["home","office"].includes(p.id)),recent=read(RECENT_KEY,[]),parts=[];if(custom.length)parts.push('<span class="recent-label">快捷：</span>'+custom.map(p=>`<button type="button" class="journey-recent-btn custom-quick" data-quick="${esc(p.id)}">${esc(p.label)}</button>`).join(""));if(Array.isArray(recent)&&recent.length)parts.push('<span class="recent-label">最近：</span>'+recent.map(v=>`<button type="button" class="journey-recent-btn" data-recent="${esc(v)}">${esc(v)}</button>`).join(""));sub.innerHTML=parts.join("");sub.classList.toggle("hidden",!parts.length);}
  }
  function closeQuickModal(){const m=$(".quick-modal-backdrop");if(m)m.remove();document.body.classList.remove("dz-quick-open");}
  function nearestStopName(loc){if(typeof allJourneyStops!=="function"||typeof distanceMeters!=="function")return"";let best=null;for(const s of allJourneyStops()){if(!Number.isFinite(s.lat)||!Number.isFinite(s.lon))continue;const d=distanceMeters(loc.lat,loc.lon,s.lat,s.lon);if(!best||d<best.d)best={d,name:s.name||s.name_tc||""};}return best?.name||"";}
  function locate(){return new Promise((resolve,reject)=>navigator.geolocation?navigator.geolocation.getCurrentPosition(p=>resolve({lat:p.coords.latitude,lon:p.coords.longitude}),reject,{enableHighAccuracy:true,timeout:12000,maximumAge:30000}):reject(new Error("no geo")));}
  function openSafeEditor(){
    closeQuickModal();
    const modal=document.createElement("div");modal.className="quick-modal-backdrop dz384-modal";
    modal.innerHTML=`<div class="quick-modal" role="dialog" aria-modal="true" aria-label="新增快捷目的地"><button class="dz384-close" type="button" aria-label="關閉">×</button><div class="quick-modal-handle"></div><h3>新增快捷目的地</h3><label>名稱<input id="quickLabel384" placeholder="例如 Home、Office、女女學校"></label><label>目的地／巴士站<input id="quickValue384" placeholder="例如 上水站、國泰城"></label><button id="quickUseHere384" class="quick-secondary" type="button">📍 用我目前位置設定目的地</button><div id="quickStatus384" class="quick-status"></div><div class="quick-actions"><button data-cancel384 type="button">取消</button><button data-save384 class="primary-btn" type="button">儲存</button></div></div>`;
    document.body.appendChild(modal);document.body.classList.add("dz-quick-open");
    const close=()=>closeQuickModal();
    modal.addEventListener("pointerup",e=>{if(e.target===modal||e.target.closest(".dz384-close")||e.target.closest("[data-cancel384]")){e.preventDefault();close();}},{passive:false});
    modal.querySelector("#quickUseHere384").onclick=async()=>{const st=modal.querySelector("#quickStatus384");st.textContent="正在定位…";try{const loc=await locate(),name=nearestStopName(loc);if(!name)throw 0;modal.querySelector("#quickValue384").value=name;st.textContent=`已設定到最近車站：${name}`;}catch{st.textContent="未能取得位置，請檢查 Safari 定位權限。";}};
    modal.querySelector("[data-save384]").onclick=()=>{const label=modal.querySelector("#quickLabel384").value.trim(),value=modal.querySelector("#quickValue384").value.trim(),st=modal.querySelector("#quickStatus384");if(!label||!value){st.textContent="請輸入名稱及目的地。";return;}const list=quickPlaces();list.push({id:"custom-"+Date.now(),label,value,icon:"📍"});write(QUICK_KEY,list);renderQuickRows();close();};
  }
  document.addEventListener("click",e=>{const add=e.target.closest?.("[data-add-quick]");if(!add)return;e.preventDefault();e.stopImmediatePropagation();openSafeEditor();},true);
  document.addEventListener("keydown",e=>{if(e.key==="Escape")closeQuickModal();});

  function around(point,radius,limit=36){if(!point||typeof allJourneyStops!=="function"||typeof distanceMeters!=="function")return[];return allJourneyStops().filter(s=>Number.isFinite(s.lat)&&Number.isFinite(s.lon)).map(s=>({...s,distance:distanceMeters(point.lat,point.lon,s.lat,s.lon)})).filter(s=>s.distance<=radius).sort((a,b)=>a.distance-b.distance).slice(0,limit);}
  function centroid(a){const x=(a||[]).filter(s=>Number.isFinite(s.lat)&&Number.isFinite(s.lon));if(!x.length)return null;return{lat:x.reduce((n,s)=>n+s.lat,0)/x.length,lon:x.reduce((n,s)=>n+s.lon,0)/x.length};}
  function originData(from){const loc=journeyState?.originLocation;if(loc)return{point:loc,stops:around(loc,1500,40)};const stops=typeof resolvePlace==="function"?resolvePlace(from,null):[];return{point:centroid(stops),stops};}
  async function etaLeg(r){try{if(typeof journeyEta==="function")r.eta=await journeyEta(r)}catch{}return r;}
  function wait(r,def=9){return r?.eta&&typeof etaMinutes==="function"?Math.max(0,etaMinutes(r.eta)):def;}
  function ride(r){return Number(r?.stopCount||0)*1.7+Number(r?.walkMeters||0)/80;}
  function isRacecourse(r){return String(r?._dzExitStation?.code||"").toUpperCase()==="RAC"||SPECIAL_EAL_ROUTES.has(String(r?._dzExit?.leg?.route||"").toUpperCase());}
  async function improveEastRailAccess(rows,from){
    if(!rows.length||typeof gmbDirect!=="function")return 0;const o=originData(from);if(!o.stops.length)return 0;const cache=new Map();let changed=0;
    for(const r of rows){const st=r._dzStart;if(!st||!Number.isFinite(st.lat)||!Number.isFinite(st.lon))continue;const key=st.code||st.name_tc;if(!cache.has(key)){const p=(async()=>{let g=[];try{g=await gmbDirect(o.stops,around(st,600,36));}catch{};await Promise.all(g.slice(0,8).map(etaLeg));return g.filter(x=>x.eta).sort((a,b)=>(wait(a)+ride(a))-(wait(b)+ride(b)))[0]||null;})();cache.set(key,p);}const leg=await cache.get(key);if(!leg)continue;const oldCost=Number(r._dzAccess?.cost??999),newCost=wait(leg)+ride(leg);if(newCost+0.5>=oldCost)continue;const delta=newCost-oldCost;r._dzAccess={kind:"transit",station:st,leg,cost:newCost};r._dzEastRailTotal=Math.max(1,Number(r._dzEastRailTotal||0)+delta);r.eta=leg.eta;r.originStop=leg.originStop||r.originStop;r.walkMeters=Number(leg.walkMeters||0)+Number(r._dzExit?.walkMeters||r._dzExit?.leg?.walkMeters||0);r.stopCount=Number(leg.stopCount||0)+Number(r._dzRailStops||0)+Number(r._dzExit?.leg?.stopCount||0);r.route=[leg.route,"EAL",r._dzExit?.leg?.route].filter(Boolean).join(" → ");changed++;}
    return changed;
  }
  if(typeof runJourneySearch==="function"){
    const previous=runJourneySearch;
    runJourneySearch=async function(){const from=$("#journeyFrom")?.value.trim()||"",to=$("#journeyTo")?.value.trim()||"";await previous();let results=journeyState.results||[],removed=0,added=0;
      const before=results.length;results=results.filter(r=>!r?._dzEastRail||!isRacecourse(r));removed=before-results.length;journeyState.results=results;
      if(!(results||[]).some(r=>r?._dzEastRail)&&window.dzRoutingTune383?.eastRailFallback){const extra=await window.dzRoutingTune383.eastRailFallback(from,to).catch(()=>[]),safe=extra.filter(r=>!isRacecourse(r));if(safe.length){journeyState.results.push(...safe);added=safe.length;}}
      const east=(journeyState.results||[]).filter(r=>r?._dzEastRail&&!isRacecourse(r));const improved=await improveEastRailAccess(east,from);journeyState.results=(journeyState.results||[]).filter(r=>!r?._dzEastRail||!isRacecourse(r));try{renderJourneyResults();}catch{}
      const st=$("#journeyStatus");if(st&&(removed||added||improved))st.textContent=`${st.textContent||""}；東鐵修正：${removed?`移除 ${removed} 個馬場／特別班次；`:""}${added?`補回 ${added} 個正常站方案；`:""}${improved?`更新 ${improved} 個接駁方案（包括小巴比較）。`:""}`;
    };
  }
  window.dzStability384={version:"3.8.4"};
})();