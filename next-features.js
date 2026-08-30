(() => {
  "use strict";
  const QUICK_KEY = "daozhan.quickPlaces.v3";
  const LEGACY_QUICK_KEY = "daozhan.quickPlaces.v2";
  const RECENT_KEY = "daozhan.journeyRecent.v1";
  const MAX_RECENT = 3;
  const q = (s,r=document) => r.querySelector(s);
  const qa = (s,r=document) => [...r.querySelectorAll(s)];
  const fareCache = new Map();

  function read(key, fallback) { try { return JSON.parse(localStorage.getItem(key)) ?? fallback; } catch { return fallback; } }
  function write(key, value) { try { localStorage.setItem(key, JSON.stringify(value)); } catch {} }
  function esc(v) { return String(v ?? "").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c])); }

  function defaultPlaces(){ return [{id:"home",label:"Home",icon:"🏠",value:""},{id:"office",label:"Office",icon:"🏢",value:""}]; }
  function places() {
    let list = read(QUICK_KEY, null);
    if (!Array.isArray(list)) {
      const old = read(LEGACY_QUICK_KEY, null);
      list = Array.isArray(old) ? old : defaultPlaces();
      write(QUICK_KEY, list);
    }
    return list;
  }
  function savePlaces(v) { write(QUICK_KEY, v); }
  function recent() { return read(RECENT_KEY, []); }
  function remember(v) {
    v = String(v || "").trim();
    if (!v || v === "我的位置") return;
    const a = recent().filter(x => x !== v); a.unshift(v); write(RECENT_KEY, a.slice(0,MAX_RECENT)); renderSubRow();
  }

  function installUI() {
    const planner = q(".journey-planner");
    if (!planner || q("#journeyQuickPlaces")) return;
    const head = planner.querySelector(".section-head");
    if (!head) return;

    const h2 = head.querySelector("h2");
    const beta = head.querySelector(".coming");
    const titleGroup = document.createElement("div");
    titleGroup.className = "journey-title-group";
    if (h2) titleGroup.appendChild(h2);
    if (beta) titleGroup.appendChild(beta);
    head.appendChild(titleGroup);

    const quick = document.createElement("div");
    quick.id = "journeyQuickPlaces";
    quick.className = "journey-quick-row journey-quick-inline";
    head.appendChild(quick);

    const sub = document.createElement("div");
    sub.id = "journeyRecentPlaces";
    sub.className = "journey-recent-row hidden";
    head.insertAdjacentElement("afterend", sub);

    const swap = q(".journey-swap");
    if (swap) swap.innerHTML = '<button id="journeySwapBtn" type="button" aria-label="交換起點終點">⇅</button>';
    renderPlaces(); renderSubRow(); decorateNearbyCards();
  }

  function renderPlaces() {
    const box = q("#journeyQuickPlaces"); if (!box) return;
    const list = places();
    const fixed = list.filter(p => p.id === "home" || p.id === "office");
    box.innerHTML = fixed.map(p => `<button class="journey-quick-btn" type="button" data-quick="${esc(p.id)}" title="${esc(p.label)}"><span>${p.icon||"📍"}</span><strong>${esc(p.label)}</strong></button>`).join("") + '<button class="journey-quick-btn add" type="button" data-add-quick="1" title="新增快捷目的地"><span>＋</span><strong>新增</strong></button>';
  }

  function renderSubRow() {
    const box = q("#journeyRecentPlaces"); if (!box) return;
    const custom = places().filter(p => !["home","office"].includes(p.id));
    const a = recent();
    const parts = [];
    if (custom.length) parts.push('<span class="recent-label">快捷：</span>' + custom.map(p=>`<button type="button" class="journey-recent-btn custom-quick" data-quick="${esc(p.id)}">${esc(p.label)}</button>`).join(""));
    if (a.length) parts.push('<span class="recent-label">最近：</span>' + a.map(v=>`<button type="button" class="journey-recent-btn" data-recent="${esc(v)}">${esc(v)}</button>`).join(""));
    box.innerHTML = parts.join("");
    box.classList.toggle("hidden", !parts.length);
  }

  function locate() { return new Promise((resolve,reject)=>navigator.geolocation ? navigator.geolocation.getCurrentPosition(p=>resolve({lat:p.coords.latitude,lon:p.coords.longitude}),reject,{enableHighAccuracy:true,timeout:12000,maximumAge:30000}) : reject(new Error("不支援定位"))); }
  function nearestStopName(loc) {
    if (typeof allJourneyStops !== "function" || typeof distanceMeters !== "function") return "";
    return allJourneyStops().filter(s=>Number.isFinite(s.lat)&&Number.isFinite(s.lon)).map(s=>({...s,d:distanceMeters(loc.lat,loc.lon,s.lat,s.lon)})).sort((a,b)=>a.d-b.d)[0]?.name || "";
  }

  function openEditor(id=null) {
    let list = places(), item = id ? list.find(x=>x.id===id) : null;
    q(".quick-modal-backdrop")?.remove();
    const modal = document.createElement("div"); modal.className="quick-modal-backdrop";
    modal.innerHTML = `<div class="quick-modal" role="dialog" aria-modal="true"><div class="quick-modal-handle"></div><h3>${item?"設定快捷目的地":"新增快捷目的地"}</h3><label>名稱<input id="quickLabel" value="${esc(item?.label || "")}" placeholder="例如 Home、Office、女女學校"></label><label>目的地／巴士站<input id="quickValue" value="${esc(item?.value || "")}" placeholder="例如 上水站、國泰城"></label><button id="quickUseHere" class="quick-secondary" type="button">📍 用我目前位置設定目的地</button><div id="quickModalStatus" class="quick-status"></div><div class="quick-actions"><button data-close type="button">取消</button>${item && !["home","office"].includes(item.id)?'<button data-delete type="button">刪除</button>':""}<button data-save class="primary-btn" type="button">儲存</button></div></div>`;
    document.body.appendChild(modal);
    modal.addEventListener("click",e=>{ if(e.target===modal) modal.remove(); });
    modal.querySelector("[data-close]").onclick=()=>modal.remove();
    modal.querySelector("[data-delete]")?.addEventListener("click",()=>{ list=list.filter(x=>x.id!==item.id); savePlaces(list); renderPlaces(); renderSubRow(); modal.remove(); });
    modal.querySelector("#quickUseHere").onclick=async()=>{ const st=modal.querySelector("#quickModalStatus"); st.textContent="正在定位…"; try { const loc=await locate(); const name=nearestStopName(loc); if (!name) throw new Error(); modal.querySelector("#quickValue").value=name; st.textContent=`已設定到最近車站：${name}`; } catch { st.textContent="未能取得位置，請檢查 Safari 定位權限。"; } };
    modal.querySelector("[data-save]").onclick=()=>{ const label=modal.querySelector("#quickLabel").value.trim(), value=modal.querySelector("#quickValue").value.trim(); if(!label||!value){modal.querySelector("#quickModalStatus").textContent="請輸入名稱及目的地。";return;} if(item){Object.assign(item,{label,value});} else {list.push({id:"custom-"+Date.now(),label,value,icon:"📍"});} savePlaces(list); renderPlaces(); renderSubRow(); modal.remove(); };
    setTimeout(()=>modal.querySelector("#quickLabel")?.focus(),30);
  }

  async function runQuick(item) {
    if (!item.value) return openEditor(item.id);
    const status=q("#journeyStatus"), from=q("#journeyFrom"), to=q("#journeyTo");
    if (!status || !from || !to) return;
    try {
      status.textContent=`正在定位，準備前往 ${item.label}…`;
      const loc=await locate();
      if(typeof journeyState!=="undefined") journeyState.originLocation=loc;
      from.value="我的位置"; to.value=item.value;
      remember(item.value);
      status.textContent=`正在搜尋：我的位置 → ${item.label}…`;
      if(typeof runJourneySearch==="function") await runJourneySearch(); else q("#journeySearchBtn")?.click();
      requestAnimationFrame(()=>q("#journeyResults")?.scrollIntoView({behavior:"smooth",block:"nearest"}));
    } catch (e) { status.textContent="未能取得目前位置或搜尋路線，請檢查 Safari 定位權限後再試。"; }
  }

  async function fareForNearby(x){
    if (!x || typeof loadFareXml!=="function" || typeof routeFareRecords!=="function" || typeof buildFareMap!=="function") return null;
    const key=`${x.operator}|${x.route}`;
    if (fareCache.has(key)) return fareCache.get(key);
    const p=(async()=>{
      try{
        const xml=await loadFareXml(x.operator);
        const rec=routeFareRecords(xml,{operator:x.operator,route:x.route});
        if(!rec.length) return null;
        const map=buildFareMap(rec);
        const exact=Number(x.stopSeq||x.seq||0);
        if(exact && map.has(exact)) return {fare:map.get(exact), exact:true};
        const full=map.get(1) ?? rec.map(r=>Number(r.fare)).filter(Number.isFinite).sort((a,b)=>b-a)[0];
        return Number.isFinite(full)?{fare:full,exact:false}:null;
      }catch{return null;}
    })();
    fareCache.set(key,p); return p;
  }

  function matchingNearby(card){
    if(typeof state==="undefined" || !Array.isArray(state.nearby)) return null;
    const route=card.querySelector(".near-route")?.textContent?.trim();
    const meta=card.querySelector(".near-meta")?.textContent||"";
    const name=meta.split("·")[0].trim();
    return state.nearby.find(v=>String(v.route)===String(route)&&String(v.stopName)===String(name)) || state.nearby.find(v=>String(v.route)===String(route));
  }

  function decorateNearbyCards(){
    qa("#nearbyResults .near-card").forEach(card=>{
      if(card.dataset.dzReady) return;
      const x=matchingNearby(card); if(!x) return;
      card.dataset.dzReady="1"; card.dataset.stopId=String(x.stopId||""); card.dataset.operator=String(x.operator||"");
      card.setAttribute("role","button"); card.setAttribute("tabindex","0");
      const meta=card.querySelector(".near-meta");
      if(meta && !meta.querySelector(".near-fare")) meta.insertAdjacentHTML("beforeend", ' <span class="near-fare">· 車費載入中</span>');
      fareForNearby(x).then(f=>{
        const el=card.querySelector(".near-fare"); if(!el||!card.isConnected)return;
        el.textContent=f?`· ${f.exact?"車費":"全程"} $${Number(f.fare).toFixed(1)}`:"";
      });
    });
  }

  document.addEventListener("click", e=>{
    const swap=e.target.closest("#journeySwapBtn"); if(swap){ const a=q("#journeyFrom"),b=q("#journeyTo"); [a.value,b.value]=[b.value,a.value]; if(typeof journeyState!=="undefined" && a.value!=="我的位置") journeyState.originLocation=null; return; }
    const add=e.target.closest("[data-add-quick]"); if(add){ e.preventDefault(); return openEditor(); }
    const quick=e.target.closest("[data-quick]"); if(quick){ e.preventDefault(); const p=places().find(x=>x.id===quick.dataset.quick); if(p) runQuick(p); return; }
    const r=e.target.closest("[data-recent]"); if(r){ q("#journeyTo").value=r.dataset.recent; q("#journeyTo").focus(); return; }
    const card=e.target.closest("#nearbyResults .near-card[data-stop-id]"); if(card && typeof openStopNearbySheet==="function"){ e.preventDefault(); const x=matchingNearby(card); if(x) openStopNearbySheet(x.operator,x.stopId,x.stopName); }
  });
  document.addEventListener("keydown",e=>{ const card=e.target.closest?.("#nearbyResults .near-card[data-stop-id]"); if(card && (e.key==="Enter"||e.key===" ")){e.preventDefault();card.click();} });
  document.addEventListener("contextmenu",e=>{ const b=e.target.closest("[data-quick]"); if(!b)return; e.preventDefault(); openEditor(b.dataset.quick); });
  q("#journeySearchBtn")?.addEventListener("click",()=>{remember(q("#journeyFrom")?.value);remember(q("#journeyTo")?.value);},true);
  const mo=new MutationObserver(()=>decorateNearbyCards()); mo.observe(document.documentElement,{subtree:true,childList:true});
  if(document.readyState==="loading") document.addEventListener("DOMContentLoaded",installUI,{once:true}); else installUI();
})();