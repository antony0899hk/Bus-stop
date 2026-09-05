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

    // If the first bus only moves the passenger within the same ~100m stop cluster,
    // walking to the next boarding point is preferable to using a feeder bus.
    if (near(firstOrigin, transfer)) return true;

    // If the second bus only finishes within the same ~100m cluster as the transfer point,
    // walking should replace that extra bus leg.
    if (near(transfer, secondDest)) return true;

    return false;
  }

  function applyNearbyWalkRule() {
    if (!Array.isArray(journeyState?.results)) return 0;
    const before = journeyState.results.length;
    journeyState.results = journeyState.results.filter(r => !suppressPointlessTransfer(r));
    return before - journeyState.results.length;
  }

  if (typeof runJourneySearch === "function") {
    const previous = runJourneySearch;
    runJourneySearch = async function() {
      await previous();
      const removed = applyNearbyWalkRule();
      if (removed) {
        try { renderJourneyResults(); } catch {}
        const st = $("#journeyStatus");
        if (st) st.textContent = `${st.textContent || ""} 已將 100m 內站點視為步行範圍，移除 ${removed} 個多餘短程轉車方案。`.trim();
      }
    };
  }

  window.dzNearbyStopWalk = { version:"3.7.5", meters:WALK_EQUIV_METERS, apply:applyNearbyWalkRule };
})();
