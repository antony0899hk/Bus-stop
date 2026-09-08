(() => {
  "use strict";
  const BUILD = "4.0.1";
  const KEY = "daozhan.build";
  const RELOAD_KEY = "daozhan.build.reload";
  window.DZ_BUILD = BUILD;

  function stampVersion(){
    const el = document.querySelector('.app-version');
    if (el) {
      el.textContent = `v${BUILD}`;
      el.setAttribute('aria-label', `版本 v${BUILD}`);
    }
  }

  async function clearOldRuntime(){
    try {
      if ('serviceWorker' in navigator) {
        const regs = await navigator.serviceWorker.getRegistrations();
        await Promise.all(regs.map(r => r.unregister().catch(() => false)));
      }
    } catch {}
    try {
      if (window.caches) {
        const keys = await caches.keys();
        await Promise.all(keys.filter(k => !k.includes(`v${BUILD}`)).map(k => caches.delete(k)));
      }
    } catch {}
  }

  async function ensureFreshBuild(){
    stampVersion();
    let previous = null;
    try { previous = localStorage.getItem(KEY); } catch {}
    if (previous === BUILD) return;
    try { localStorage.setItem(KEY, BUILD); } catch {}
    await clearOldRuntime();
    try {
      if ('serviceWorker' in navigator) {
        await navigator.serviceWorker.register(`./sw.js?v=${encodeURIComponent(BUILD)}`, { updateViaCache:'none' });
      }
    } catch {}
    let alreadyReloaded = false;
    try { alreadyReloaded = sessionStorage.getItem(RELOAD_KEY) === BUILD; } catch {}
    if (!alreadyReloaded) {
      try { sessionStorage.setItem(RELOAD_KEY, BUILD); } catch {}
      const url = new URL(location.href);
      url.searchParams.set('build', BUILD);
      location.replace(url.toString());
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', ensureFreshBuild, { once:true });
  } else {
    ensureFreshBuild();
  }
})();
