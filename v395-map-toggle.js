(() => {
  "use strict";
  const $=(s,r=document)=>r.querySelector(s);
  const $$=(s,r=document)=>[...r.querySelectorAll(s)];

  function ensureMapButton(){
    const panel=$(".nearby-panel"); if(!panel) return null;
    let btn=$("#dz395MapToggle");
    if(!btn){
      btn=document.createElement("button");
      btn.id="dz395MapToggle";
      btn.type="button";
      btn.className="dz395-map-toggle";
      btn.textContent="地圖";
      btn.setAttribute("aria-expanded","false");
      const titleWrap=panel.querySelector(":scope > div:first-child") || panel.firstElementChild;
      if(titleWrap) titleWrap.insertAdjacentElement("afterend",btn); else panel.prepend(btn);
    }
    return btn;
  }

  function hideMap(){
    const host=$("#dz393NearbyMap"),btn=ensureMapButton();
    if(host) host.classList.add("hidden");
    if(btn){btn.textContent="地圖";btn.setAttribute("aria-expanded","false");}
  }

  async function showMap(){
    const host=$("#dz393NearbyMap"),btn=ensureMapButton();
    if(btn){btn.disabled=true;btn.textContent="地圖載入中…";}
    try{
      if(window.dzNearby393?.renderNearbyMap) await window.dzNearby393.renderNearbyMap();
      if(host) host.classList.remove("hidden");
      if(btn){btn.textContent="收起地圖";btn.setAttribute("aria-expanded","true");}
    } finally { if(btn) btn.disabled=false; }
  }

  function prewarm(){
    const fn=()=>{
      try{
        const s=window.dzNearbyMapState;
        // Background work only: preload Leaflet assets and keep stop/position data ready.
        // Do not instantiate or display the map until user taps the button.
        if(!window.L && s?.leafletPromise==null){
          if(!document.querySelector('link[data-dz-leaflet]')){
            const l=document.createElement('link');l.rel='preload';l.as='style';l.href='https://unpkg.com/leaflet@1.9.4/dist/leaflet.css';l.dataset.dzLeafletPreload='1';document.head.appendChild(l);
          }
          if(!document.querySelector('link[data-dz-map-preconnect]')){
            const p=document.createElement('link');p.rel='preconnect';p.href='https://a.basemaps.cartocdn.com';p.crossOrigin='anonymous';p.dataset.dzMapPreconnect='1';document.head.appendChild(p);
          }
        }
      }catch{}
    };
    if('requestIdleCallback' in window) requestIdleCallback(fn,{timeout:1200}); else setTimeout(fn,350);
  }

  function install(){
    ensureMapButton();
    hideMap();
    prewarm();
  }

  document.addEventListener('click',e=>{
    const btn=e.target.closest?.('#dz395MapToggle'); if(!btn) return;
    e.preventDefault();e.stopImmediatePropagation();
    const host=$("#dz393NearbyMap");
    const open=btn.getAttribute('aria-expanded')==='true' && host && !host.classList.contains('hidden');
    if(open) hideMap(); else showMap().catch(()=>{btn.textContent='地圖';btn.disabled=false;});
  },true);

  // v3.9.4 auto-renders the nearby map after a search. Keep it hidden even if background
  // preparation finishes; only reveal it when the user explicitly taps 地圖.
  const mo=new MutationObserver(()=>{
    const host=$("#dz393NearbyMap"),btn=$("#dz395MapToggle");
    if(host && btn && btn.getAttribute('aria-expanded')!=='true' && !host.classList.contains('hidden')) host.classList.add('hidden');
  });
  mo.observe(document.documentElement,{subtree:true,childList:true,attributes:true,attributeFilter:['class']});
  install();
  window.dzMapToggle395={version:'3.9.5',showMap,hideMap,prewarm};
})();