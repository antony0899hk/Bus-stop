(() => {
  "use strict";
  const $=s=>document.querySelector(s);
  const QUICK_KEY="daozhan.quickPlaces.v3";
  let activeField="to";

  function readPlaces(){try{return JSON.parse(localStorage.getItem(QUICK_KEY)||"[]")}catch{return[]}}
  function target(){return activeField==="from"?$("#journeyFrom"):$("#journeyTo")}
  function setValue(v){const el=target();if(!el)return;el.value=v;el.focus();el.select?.();if(el.id==="journeyFrom"&&typeof journeyState!=="undefined"&&v!=="我的位置")journeyState.originLocation=null;}
  function setupInputs(){
    for(const [id,field] of [["#journeyFrom","from"],["#journeyTo","to"]]){
      const el=$(id);if(!el)continue;
      el.addEventListener("focus",()=>{activeField=field;setTimeout(()=>el.select(),0)});
      el.addEventListener("click",()=>{activeField=field;el.select()});
    }
    const loc=$("#journeyUseLocation");
    loc?.addEventListener("click",()=>{activeField="from";setTimeout(()=>$("#journeyFrom")?.select(),50)});
  }
  function relabel(){
    const add=document.querySelector("[data-add-quick]");
    if(add){add.removeAttribute("data-add-quick");add.dataset.customPlace="1";add.title="自訂地點";const strong=add.querySelector("strong");if(strong)strong.textContent="自訂";}
    const row=$("#journeyRecentPlaces");
    if(row){row.querySelectorAll(".recent-label").forEach(x=>{if(x.textContent?.includes("快捷"))x.remove()});row.querySelectorAll(".custom-quick").forEach(x=>x.remove());}
  }
  function openCustom(){
    document.querySelector(".dz-custom-place")?.remove();
    const wrap=document.createElement("div");wrap.className="quick-modal-backdrop dz-custom-place";
    wrap.innerHTML='<div class="quick-modal" role="dialog" aria-modal="true"><div class="quick-modal-handle"></div><h3>自訂地點</h3><label>地點／車站<input id="dzCustomValue" placeholder="例如 耀安、上水站、國泰城"></label><div class="quick-status">會填入你目前選緊嘅起點或終點，不會新增做快捷按鈕。</div><div class="quick-actions"><button type="button" data-close>取消</button><button type="button" class="primary-btn" data-use>套用</button></div></div>';
    document.body.appendChild(wrap);
    wrap.addEventListener("click",e=>{if(e.target===wrap)wrap.remove()});
    wrap.querySelector("[data-close]").onclick=()=>wrap.remove();
    wrap.querySelector("[data-use]").onclick=()=>{const v=wrap.querySelector("#dzCustomValue").value.trim();if(v){setValue(v);wrap.remove();}};
    setTimeout(()=>wrap.querySelector("#dzCustomValue")?.focus(),30);
  }
  function handleQuick(e){
    const custom=e.target.closest?.("[data-custom-place]");
    if(custom){e.preventDefault();e.stopImmediatePropagation();openCustom();return;}
    const q=e.target.closest?.("[data-quick]");
    if(!q)return;
    const item=readPlaces().find(x=>x.id===q.dataset.quick);
    if(!item)return;
    e.preventDefault();e.stopImmediatePropagation();
    if(!item.value){
      // Long-standing Home/Office editor remains available from the original module via context menu.
      q.dispatchEvent(new MouseEvent("contextmenu",{bubbles:true,cancelable:true}));
      return;
    }
    setValue(item.value);
  }
  function boot(){setupInputs();relabel();document.addEventListener("click",handleQuick,true);}
  if(document.readyState==="loading")document.addEventListener("DOMContentLoaded",boot,{once:true});else boot();
})();