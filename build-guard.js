(() => {
  "use strict";
  const BUILD = "4.0.5";
  const KEY = "daozhan.build";
  const RELOAD_KEY = "daozhan.build.reload";
  window.DZ_BUILD = BUILD;
  function stampVersion(){const el=document.querySelector('.app-version');if(el){el.textContent=`v${BUILD}`;el.setAttribute('aria-label',`版本 v${BUILD}`);}}
  async function clearAllWorkersAndCaches(){try{if('serviceWorker'in navigator){const regs=await navigator.serviceWorker.getRegistrations();await Promise.all(regs.map(r=>r.unregister().catch(()=>false)));}}catch{}try{if(window.caches){const keys=await caches.keys();await Promise.all(keys.map(k=>caches.delete(k)));}}catch{}}
  async function ensureFreshBuild(){stampVersion();const url=new URL(location.href);const urlBuild=url.searchParams.get('build');let previous=null;try{previous=localStorage.getItem(KEY);}catch{}await clearAllWorkersAndCaches();try{localStorage.setItem(KEY,BUILD);}catch{}const needsReload=previous!==BUILD||urlBuild!==BUILD;let alreadyReloaded=false;try{alreadyReloaded=sessionStorage.getItem(RELOAD_KEY)===BUILD&&urlBuild===BUILD;}catch{}if(needsReload&&!alreadyReloaded){try{sessionStorage.setItem(RELOAD_KEY,BUILD);}catch{}url.searchParams.set('build',BUILD);url.searchParams.set('_',Date.now().toString());location.replace(url.toString());return;}stampVersion();}
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',ensureFreshBuild,{once:true});else ensureFreshBuild();
})();