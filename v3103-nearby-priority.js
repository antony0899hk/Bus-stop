(() => {
  "use strict";

  const nativeFetch = window.fetch.bind(window);
  const stage = {
    version: "4.0.18-stream",
    gmbStarted: false,
    gmbReady: true,
    mtrReady: false,
    secondPhaseReady: false,
    skippedGmbStopShards: 0,
    mtrPromise: null,
    readyPromise: null,
    readyResolve: null
  };

  stage.readyPromise = new Promise(resolve => { stage.readyResolve = resolve; });
  window.dzStageLoader3105 = stage;

  function isLocalGmbStopShard(input) {
    try {
      const raw = typeof input === "string" ? input : input?.url;
      if (!raw) return false;
      const url = new URL(raw, location.href);
      return url.origin === location.origin && /\/gmb-stops-\d+\.json$/i.test(url.pathname);
    } catch { return false; }
  }

  function emptyJsonResponse() {
    return new Response(JSON.stringify({data:[]}), {
      status: 200,
      headers: {"Content-Type":"application/json","Cache-Control":"no-store"}
    });
  }

  // iPhone Safari safety:
  // Do not load all 16 territory-wide GMB stop shards into memory during boot/nearby.
  // GMB route metadata still loads normally, and route detail can fetch its own stops live.
  window.fetch = function stagedFetch(input, init) {
    if (!isLocalGmbStopShard(input)) return nativeFetch(input, init);
    stage.skippedGmbStopShards++;
    return Promise.resolve(emptyJsonResponse());
  };

  function checkReady() {
    if (!stage.secondPhaseReady && stage.gmbReady && stage.mtrReady) {
      stage.secondPhaseReady = true;
      stage.readyResolve?.();
      document.dispatchEvent(new CustomEvent("dz:nearby-secondary-ready"));
    }
  }

  async function prepareMtr() {
    if (stage.mtrPromise) return stage.mtrPromise;
    stage.mtrPromise = (async () => {
      try {
        const fn = window.dzExtraTransit?.ensureMtrData;
        if (typeof fn === "function") await fn();
      } catch {}
      stage.mtrReady = true;
      checkReady();
    })();
    return stage.mtrPromise;
  }

  // Kept for compatibility with journey code. It no longer expands the full
  // GMB stop database; it only prepares the lightweight MTR catalogue.
  function startSecondPhase() {
    stage.gmbStarted = true;
    prepareMtr();
  }

  let routeLitePromise = null;
  async function loadGmbRoutesLite() {
    try { if (typeof state !== "undefined" && state.gmbRoutes?.length) return state.gmbRoutes; } catch {}
    if (routeLitePromise) return routeLitePromise;
    routeLitePromise = (async () => {
      const rows = [];
      for (let i = 0; i < 8; i++) {
        try {
          const res = await nativeFetch(`./gmb-routes-${i}.json?v=${encodeURIComponent(window.DZ_BUILD || "4.0.18")}`, { cache:"force-cache" });
          if (!res.ok) continue;
          const j = await res.json();
          rows.push(...(j.data || []));
        } catch {}
        await new Promise(r => setTimeout(r, 0));
      }
      try {
        state.gmbRoutes = rows;
        const status = document.querySelector("#status");
        if (status && status.textContent.includes("小巴按需要載入")) {
          status.textContent = status.textContent.replace("；小巴按需要載入", "＋小巴");
        }
      } catch {}
      return rows;
    })().finally(() => { routeLitePromise = null; });
    return routeLitePromise;
  }

  async function scanGmbNearby(pos, radius=100, limit=8) {
    const found = [], seen = new Set();
    for (let i = 0; i < 16; i++) {
      try {
        const res = await nativeFetch(`./gmb-stops-${i}.json?v=${encodeURIComponent(window.DZ_BUILD || "4.0.18")}`, { cache:"force-cache" });
        if (!res.ok) continue;
        const j = await res.json();
        for (const s of (j.data || [])) {
          const lat = Number(s.lat ?? s.latitude), lon = Number(s.long ?? s.lng ?? s.longitude);
          if (!Number.isFinite(lat) || !Number.isFinite(lon)) continue;
          const d = typeof distanceMeters === "function" ? distanceMeters(pos.lat,pos.lon,lat,lon) : Infinity;
          if (!Number.isFinite(d) || d > radius) continue;
          const id = String(s.stop || s.stop_id || "");
          if (!id || seen.has(id)) continue;
          seen.add(id);
          found.push({operator:"GMB",id,stop:s,lat,lon,name:s.name_tc||s.name||"",distance:d});
        }
      } catch {}
      await new Promise(r => setTimeout(r, 0));
    }
    found.sort((a,b)=>a.distance-b.distance);
    return found.slice(0, Math.max(1, Number(limit)||8));
  }

  setTimeout(() => { loadGmbRoutesLite().catch(()=>{}); }, 500);

  window.dzNearbyPriority3105 = {
    version: stage.version,
    startSecondPhase,
    prepareMtr,
    loadGmbRoutesLite,
    scanGmbNearby,
    whenReady: () => stage.readyPromise
  };
})();