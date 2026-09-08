(() => {
  "use strict";

  // Keep the expensive nearby-seed routing experiment disabled for Safari stability.
  window.dzNearbySeed397 = {
    version: "3.9.9-disabled",
    disabled: true,
    reason: "Safari stability"
  };

  // Nearby ETA UX rule: each physical route number should appear once only,
  // regardless of direction, stop, or multiple ETA occurrences. Because the
  // source array is already sorted by ETA, the first row kept is the soonest
  // available occurrence of that operator+route.
  function dedupeNearbyRoutes() {
    if (typeof state === "undefined" || !Array.isArray(state.nearby)) return;
    const seen = new Set();
    state.nearby = state.nearby
      .slice()
      .sort((a,b) => new Date(a.eta) - new Date(b.eta))
      .filter(x => {
        const key = `${String(x.operator || "")}|${String(x.route || "").toUpperCase()}`;
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      });
  }

  if (typeof loadNearbyEtas === "function") {
    const previousLoadNearbyEtas = loadNearbyEtas;
    loadNearbyEtas = async function() {
      const out = await previousLoadNearbyEtas.apply(this, arguments);
      dedupeNearbyRoutes();
      try { if (typeof renderNearby === "function") renderNearby(); } catch {}
      return out;
    };
  }

  // Also protect re-renders/filter changes from any older cached duplicate state.
  if (typeof renderNearby === "function") {
    const previousRenderNearby = renderNearby;
    renderNearby = function() {
      dedupeNearbyRoutes();
      return previousRenderNearby.apply(this, arguments);
    };
  }

  window.dzNearbyDedupe399 = {
    version: "3.9.9",
    dedupeNearbyRoutes
  };

  // Load the bounded live transfer-time refiner after all existing routing wrappers.
  // Important: do NOT overwrite the visible app version here. The page/build owns
  // the version label; the previous hard-coded v3.10.0 here made every newer build
  // look stale even after GitHub Pages had deployed successfully.
  const live=document.createElement('script');
  live.src='v3100-live-transfer-time.js';
  live.async=false;
  document.body.appendChild(live);
})();
