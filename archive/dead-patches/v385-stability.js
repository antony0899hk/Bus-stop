(() => {
  "use strict";
  const $=s=>document.querySelector(s);
  const QUICK_KEY="daozhan.quickPlaces.v3";
  const SPECIAL_EAL_ROUTES=new Set(["848","272P","38B"]);
  const esc=v=>String(v??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
  const read=(k,f)=>{try{return JSON.parse(localStorage.getItem(k))??f}catch{return f}};
  const write=(k,v)=>{try{localStorage.setItem(k,JSON.stringify(v));return true}catch{return false}};

  function ensureDefaults(list){
    if(!Array.isArray(list))list=[];
    if(!list.some(x=>x.id==="home"))list.unshift({id:"home",label:"Home",icon:"🏠",value:""});
    if(!list.some(x=>x.id==="office"))list.splice(1,0,{id:"office",label:"Office",icon:"🏢",value:""});
    return list;
  }
  function rerenderQuick(){
    const list=ensureDefaults(read(QUICK_KEY,[])),head=$("#journeyQuickPlaces"),sub=$("#journeyRecentPlaces");
    write(QUICK_KEY,list);
    if(head){const fixed=list.filter(p=>p.id==="home"||p.id==="office");head.innerHTML=fixed.map(p=>`<button class="journey-quick-btn" type="button" data-quick="${esc(p.id)}"><span>${p.icon||"📍"}</span><strong>${esc(p.label)}</strong></button>`).join("")+`<button class="journey-quick-btn add" type="button" data-add-quick="1"><span>＋</span><strong>新增</strong></button>`;}
    if(sub){const custom=list.filter(p=>!["home","office"].includes(p.id));const recent=read("daozhan.journeyRecent.v1",[]);const parts=[];if(custom.length)parts.push('<span class="recent-label">快捷：</span>'+custom.map(p=>`<button type="button" class="journey-recent-btn custom-quick" data-quick="${esc(p.id)}">${esc(p.label)}</button>`).join(""));if(Array.isArray(recent)&&recent.length)parts.push('<span class="recent-label">最近：</span>'+recent.map(v=>`<button type="button" class="journey-recent-btn" data-recent="${esc(v)}">${esc(v)}</button>`).join(""));sub.innerHTML=parts.join("");sub.classList.toggle("hidden",!parts.length);}
  }
  function closeModal(){document.querySelectorAll(".quick-modal-backdrop").forEach(x=>x.remove());document.body.classList.remove("dz-quick-open");}
  function save384(modal){
    const label=modal?.querySelector("#quickLabel384")?.value.trim()||"";
    const value=modal?.querySelector("#quickValue384")?.value.trim()||"";
    const st=modal?.querySelector("#quickStatus384");
    if(!label||!value){if(st)st.textContent="請輸入名稱及目的地。";return false;}
    const list=ensureDefaults(read(QUICK_KEY,[]));
    list.push({id:"custom-"+Date.now(),label,value,icon:"📍"});
    if(!write(QUICK_KEY,list)){if(st)st.textContent="儲存失敗，請檢查 Safari 私隱／儲存空間設定。";return false;}
    rerenderQuick();
    closeModal();
    try{document.activeElement?.blur?.();}catch{}
    return true;
  }
  let lastSave=0;
  function saveHandler(e){
    const btn=e.target?.closest?.("[data-save384]");if(!btn)return;
    const now=Date.now();if(now-lastSave<500)return;
    lastSave=now;e.preventDefault();e.stopImmediatePropagation();
    save384(btn.closest(".quick-modal-backdrop"));
  }
  document.addEventListener("pointerdown",saveHandler,true);
  document.addEventListener("touchend",saveHandler,{capture:true,passive:false});
  document.addEventListener("click",saveHandler,true);

  function specialEastRail(r){
    if(!r?._dzEastRail)return false;
    const exit=String(r?._dzExit?.leg?.route||"").toUpperCase();
    const chain=String(r?.route||"").toUpperCase().split(/\s*→\s*/);
    return SPECIAL_EAL_ROUTES.has(exit)||chain.some(x=>SPECIAL_EAL_ROUTES.has(x));
  }
  function transferKey(r){
    if(r?.kind==="transfer"&&r.first&&r.second)return `${r.first.operator||""}|${r.first.route||""}→${r.second.operator||""}|${r.second.route||""}`;
    if(r?._dzDistrictCorridor&&r._dzMain&&r._dzLast)return `C|${r._dzAccess?.route||""}|${r._dzMain.route||""}→${r._dzLast.route||""}`;
    return null;
  }
  function dedupeResults(rows){
    const seen=new Set(),out=[];
    for(const r of rows||[]){
      if(specialEastRail(r))continue;
      const k=transferKey(r);
      if(k&&seen.has(k))continue;
      if(k)seen.add(k);
      out.push(r);
    }
    return out;
  }
  if(typeof runJourneySearch==="function"){
    const previous=runJourneySearch;
    runJourneySearch=async function(){
      await previous();
      const before=(journeyState.results||[]).length;
      journeyState.results=dedupeResults(journeyState.results||[]);
      const removed=before-journeyState.results.length;
      try{renderJourneyResults();}catch{}
      const st=$("#journeyStatus");if(st&&removed)st.textContent=`${st.textContent||""}；已合併重複轉乘及移除 ${removed} 個重複／特別班次方案。`;
    };
  }
  window.dzStability385={version:"3.8.5",dedupeResults};
})();
