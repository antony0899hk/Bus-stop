(() => {
  "use strict";
  const WALK_EQUIV_METERS = 100;
  const $ = s => document.querySelector(s);

  function stopMap(op) {
    if (op === "KMB") return state?.kmbStops;
    if (op === "CTB") return state?.ctbStops;
    if (op === "GMB") return state?.gmbStops;
    return null;
  }

  function point(op, stopLike, fallbackId = null) {
    if (stopLike && Number.isFinite(Number(stopLike.lat)) && Number.isFinite(Number(stopLike.lon))) {
      return { lat:Number(stopLike.lat), lon:Number(stopLike.lon) };
    }
    const id = String(stopLike?.id || fallbackId || "");
    if (!id) return null;
    const s = stopMap(op)?.get(id);
    if (!s) return null;
    const lat = Number(s.lat ?? s.latitude);
    const lon = Number(s.long ?? s.lng ?? s.longitude);
    return Number.isFinite(lat) && Number.isFinite(lon) ? { lat, lon } : null;
  }

  function near(a,b) {
    if (!a || !b || typeof distanceMeters !== "function") return false;
    return distanceMeters(a.lat,a.lon,b.lat,b.lon) <= WALK_EQUIV_METERS;
  }

  function suppressPointlessTransfer(r) {
    if (r?.kind !== "transfer") return false;

    const firstOrigin = point(r.first?.operator, r.first?.originStop);
    const transfer = point(r.first?.operator, null, r.transferStopId || r.first?.transferStopId);
    const secondDest = point(r.second?.operator, r.second?.destinationStop);

    if (near(firstOrigin, transfer)) return true;
    if (near(transfer, secondDest)) return true;
    return false;
  }

  function routeClass(r) {
    if (r?.kind === "direct" && r?.operator !== "MTR") return 0;
    if (r?.kind === "direct" && r?.operator === "MTR") return 1;
    if (r?._dzMtrBridge) return 2;
    if (r?.kind === "transfer") return 3;
    return 4;
  }

  function fallbackScore(r) {
    const etaMin = r?.eta ? Math.max(0, Math.round((new Date(r.eta).getTime() - Date.now()) / 60000)) : 30;
    return etaMin * 100 + Number(r?.walkMeters || 0) + Number(r?.stopCount || 0) * 40;
  }

  function directFirstSort() {
    if (!Array.isArray(journeyState?.results)) return;
    const score = typeof journeyScore === "function" ? journeyScore : fallbackScore;
    journeyState.results.sort((a,b) => {
      const ca = routeClass(a), cb = routeClass(b);
      if (ca !== cb) return ca - cb;
      return Number(score(a) || 0) - Number(score(b) || 0);
    });
  }

  function applyNearbyWalkRule() {
    if (!Array.isArray(journeyState?.results)) return 0;
    const before = journeyState.results.length;
    journeyState.results = journeyState.results.filter(r => !suppressPointlessTransfer(r));
    directFirstSort();
    return before - journeyState.results.length;
  }

  if (typeof runJourneySearch === "function") {
    const previous = runJourneySearch;
    runJourneySearch = async function() {
      await previous();
      const removed = applyNearbyWalkRule();
      try { renderJourneyResults(); } catch {}
      const st = $("#journeyStatus");
      if (st) {
        const tail = removed ? `；另外移除 ${removed} 個 100m 內多餘短程轉車方案` : "";
        st.textContent = `${st.textContent || ""} 已改為直達方案優先，再顯示轉車方案${tail}。`.trim();
      }
    };
  }

  window.dzNearbyStopWalk = { version:"3.7.6", meters:WALK_EQUIV_METERS, apply:applyNearbyWalkRule, sort:directFirstSort };
})();
