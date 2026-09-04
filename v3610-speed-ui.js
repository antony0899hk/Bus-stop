(() => {
  "use strict";
  const status = document.querySelector("#status");
  if (!status) return;
  const started = Date.now();
  const timer = setInterval(() => {
    try {
      const coreReady = typeof state !== "undefined" && ((state.kmbRoutes?.length || 0) + (state.ctbRoutes?.length || 0) > 0);
      if (coreReady) {
        status.classList.add("hidden");
        clearInterval(timer);
        return;
      }
    } catch {}
    if (Date.now() - started > 8000) clearInterval(timer);
  }, 80);
})();
