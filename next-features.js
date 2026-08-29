(() => {
  "use strict";
  const QUICK_KEY = "daozhan.quickPlaces.v2";
  const RECENT_KEY = "daozhan.journeyRecent.v1";
  const MAX_RECENT = 3;
  const q = s => document.querySelector(s);

  function read(key, fallback) { try { return JSON.parse(localStorage.getItem(key)) ?? fallback; } catch { return fallback; } }
  function write(key, value) { localStorage.setItem(key, JSON.stringify(value)); }
  function esc(v) { return String(v ?? "").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c])); }
  function places() { return read(QUICK_KEY, [{id:"home",label:"Home",icon:"🏠",value:""},{id:"office",label:"Office",icon:"🏢",value:""}]); }
  function savePlaces(v) { write(QUICK_KEY, v); }
  function recent() { return read(RECENT_KEY, []); }
  function remember(v) {
    v = String(v || "").trim();
    if (!v || v === "我的位置") return;
    const a = recent().filter(x => x !== v); a.unshift(v); write(RECENT_KEY, a.slice(0,MAX_RECENT)); renderRecent();
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

    const recentBox = document.createElement("div");
    recentBox.id = "journeyRecentPlaces";
    recentBox.className = "journey-recent-row";
    head.insertAdjacentElement("afterend", recentBox);

    const swap = q(".journey-swap");
    if (swap) swap.innerHTML = '<button id="journeySwapBtn" type="button" aria-label="交換起點終點">⇅</button>';
    renderPlaces(); renderRecent();
  }

  function renderPlaces() {
    const box = q("#journeyQuickPlaces"); if (!box) return;
    box.innerHTML = places().slice(0,2).map(p => `<button class="journey-quick-btn" type="button" data-quick="${esc(p.id)}" title="${esc(p.label)}"><span>${p.icon||"📍"}</span><strong>${esc(p.label)}</strong></button>`).join("") + '<button class="journey-quick-btn add" type="button" data-add-quick="1" title="新增快捷目的地"><span>＋</span><strong>新增</strong></button>';
  }
  function renderRecent() {
    const box = q("#journeyRecentPlaces"); if (!box) return;
    const a = recent();
    box.classList.toggle("hidden", !a.length);
    box.innerHTML = a.length ? '<span class="recent-label">最近：</span>' + a.map(v=>`<button type="button" class="journey-recent-btn" data-recent="${esc(v)}">${esc(v)}</button>`).join("") : "";
  }

  function locate() { return new Promise((resolve,reject)=>navigator.geolocation ? navigator.geolocation.getCurrentPosition(p=>resolve({lat:p.coords.latitude,lon:p.coords.longitude}),reject,{enableHighAccuracy:true,timeout:12000,maximumAge:30000}) : reject(new Error("不支援定位"))); }
  function nearestStopName(loc) {
    if (typeof allJourneyStops !== "function" || typeof distanceMeters !== "function") return "";
    return allJourneyStops().filter(s=>Number.isFinite(s.lat)&&Number.isFinite(s.lon)).map(s=>({...s,d:distanceMeters(loc.lat,loc.lon,s.lat,s.lon)})).sort((a,b)=>a.d-b.d)[0]?.name || "";
  }

  function openEditor(id=null) {
    let list = places(), item = id ? list.find(x=>x.id===id) : null;
    const modal = document.createElement("div"); modal.className="quick-modal-backdrop";
    modal.innerHTML = `<div class="quick-modal"><div class="quick-modal-handle"></div><h3>${item?"設定快捷目的地":"新增快捷目的地"}</h3><label>名稱<input id="quickLabel" value="${esc(item?.label || "")}" placeholder="例如 Home、Office、女女學校"></label><label>目的地／巴士站<input id="quickValue" value="${esc(item?.value || "")}" placeholder="例如 上水站、國泰城"></label><button id="quickUseHere" class="quick-secondary" type="button">📍 用我目前位置設定目的地</button><div id="quickModalStatus" class="quick-status"></div><div class="quick-actions"><button data-close type="button">取消</button>${item && !["home","office"].includes(item.id)?'<button data-delete type="button">刪除</button>':""}<button data-save class="primary-btn" type="button">儲存</button></div></div>`;
    document.body.appendChild(modal);
    modal.querySelector("[data-close]").onclick=()=>modal.remove();
    modal.querySelector("[data-delete]")?.addEventListener("click",()=>{ list=list.filter(x=>x.id!==item.id); savePlaces(list); renderPlaces(); modal.remove(); });
    modal.querySelector("#quickUseHere").onclick=async()=>{ const st=modal.querySelector("#quickModalStatus"); st.textContent="正在定位…"; try { const loc=await locate(); const name=nearestStopName(loc); if (!name) throw new Error(); modal.querySelector("#quickValue").value=name; st.textContent=`已設定到最近車站：${name}`; } catch { st.textContent="未能取得位置，請檢查 Safari 定位權限。"; } };
    modal.querySelector("[data-save]").onclick=()=>{ const label=modal.querySelector("#quickLabel").value.trim(), value=modal.querySelector("#quickValue").value.trim(); if(!label||!value){modal.querySelector("#quickModalStatus").textContent="請輸入名稱及目的地。";return;} if(item){Object.assign(item,{label,value});} else {list.push({id:"custom-"+Date.now(),label,value,icon:"📍"});} savePlaces(list); renderPlaces(); modal.remove(); };
  }

  async function runQuick(item) {
    if (!item.value) return openEditor(item.id);
    const status=q("#journeyStatus"), from=q("#journeyFrom"), to=q("#journeyTo");
    try {
      status.textContent=`正在定位，準備前往 ${item.label}…`;
      const loc=await locate();
      if(typeof journeyState!=="undefined") journeyState.originLocation=loc;
      from.value="我的位置";
      to.value=item.value;
      from.dispatchEvent(new Event("input",{bubbles:true}));
      to.dispatchEvent(new Event("input",{bubbles:true}));
      remember(item.value);
      status.textContent=`正在搜尋：我的位置 → ${item.label}…`;
      if(typeof runJourneySearch==="function") await runJourneySearch();
      else {
        const searchBtn=q("#journeySearchBtn");
        if (!searchBtn) throw new Error("search unavailable");
        searchBtn.click();
      }
      requestAnimationFrame(()=>q("#journeyResults")?.scrollIntoView({behavior:"smooth",block:"nearest"}));
    }
    catch { status.textContent="未能取得目前位置或搜尋路線，請檢查 Safari 定位權限後再試。"; }
  }

  document.addEventListener("click", e=>{
    const swap=e.target.closest("#journeySwapBtn"); if(swap){ const a=q("#journeyFrom"),b=q("#journeyTo"); [a.value,b.value]=[b.value,a.value]; if(typeof journeyState!=="undefined" && a.value!=="我的位置") journeyState.originLocation=null; return; }
    const add=e.target.closest("[data-add-quick]"); if(add) return openEditor();
    const quick=e.target.closest("[data-quick]"); if(quick){ const p=places().find(x=>x.id===quick.dataset.quick); if(p) runQuick(p); return; }
    const r=e.target.closest("[data-recent]"); if(r){ q("#journeyTo").value=r.dataset.recent; q("#journeyTo").focus(); }
  });
  document.addEventListener("contextmenu",e=>{ const b=e.target.closest("[data-quick]"); if(!b)return; e.preventDefault(); openEditor(b.dataset.quick); });
  q("#journeySearchBtn")?.addEventListener("click",()=>{remember(q("#journeyFrom")?.value);remember(q("#journeyTo")?.value);},true);
  if(document.readyState==="loading") document.addEventListener("DOMContentLoaded",installUI,{once:true}); else installUI();
})();