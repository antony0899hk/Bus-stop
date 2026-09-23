(() => {
  "use strict";
  const KEY="daozhan.quickPlaces.v3";
  const $=s=>document.querySelector(s);
  const esc=v=>String(v??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
  function places(){try{const a=JSON.parse(localStorage.getItem(KEY)||"[]");return Array.isArray(a)?a:[]}catch{return[]}}
  function render(){
    const row=$("#journeyQuickPlaces");if(!row)return;
    const custom=places().filter(p=>!["home","office"].includes(p.id));
    row.querySelectorAll(".v371-custom").forEach(x=>x.remove());
    let add=row.querySelector("[data-custom-place],[data-add-quick]");
    if(add){add.removeAttribute("data-custom-place");add.setAttribute("data-add-quick","1");add.title="新增快捷地點";const strong=add.querySelector("strong");if(strong)strong.textContent="新增";}
    for(const p of custom){const b=document.createElement("button");b.type="button";b.className="journey-quick-btn v371-custom";b.dataset.quick=p.id;b.title=p.label||"快捷地點";b.innerHTML=`<span>${p.icon||"📍"}</span><strong>${esc(p.label||p.value||"地點")}</strong>`;row.insertBefore(b,add||null);}
    const lower=$("#journeyRecentPlaces");if(lower){lower.querySelectorAll(".custom-quick").forEach(x=>x.remove());lower.querySelectorAll(".recent-label").forEach(x=>{if(x.textContent?.includes("快捷"))x.remove();});if(!lower.textContent.trim())lower.classList.add("hidden");}
  }
  const obs=new MutationObserver(()=>render());
  function boot(){render();const row=$("#journeyQuickPlaces");if(row)obs.observe(row.parentElement||row,{childList:true,subtree:true});document.addEventListener("click",e=>{if(e.target.closest?.("[data-add-quick]"))setTimeout(render,100);},true);}
  if(document.readyState==="loading")document.addEventListener("DOMContentLoaded",boot,{once:true});else boot();
})();