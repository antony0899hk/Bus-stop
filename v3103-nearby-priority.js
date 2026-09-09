(() => {
  "use strict";

  const nativeFetch = window.fetch.bind(window);
  const stage = {
    version: "4.0.17-safe",
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

  window.dzNearbyPriority3105 = {
    version: stage.version,
    startSecondPhase,
    prepareMtr,
    whenReady: () => stage.readyPromise
  };
})();