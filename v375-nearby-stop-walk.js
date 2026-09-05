(() => {
  "use strict";
  const WALK_EQUIV_METERS = 100;
  const TARGET_BUCKET_METERS = 350;
  const $ = s => document.querySelector(s);

  function stopMap(op) {
    if (op === "KMB") return state?.kmbStops;
    if (op === "CTB") return state?.ctbStops;
    if (op === "GMB") return state?.gmbStops;
    return null;
  }

  function point(op, stopLike, fallbackId = null) {
    if (stopLike && Number.isFinite(Number(stopLike.lat)) && Number.isFinite(Number(stopLike.lon))) return { lat:Number(stopLike.lat), lon:Number(stopLike.lon) };
    const id = String(stopLike?.id || fallbackId || "");
    const s = id ? stopMap(op)?.get(id) : null;
    if (!s) return null;
    const lat = Number(s.lat ?? s.latitude), lon = Number(s.long ?? s.lng ?? s.longitude);
    return Number.isFinite(lat) && Number.isFinite(lon) ? { lat, lon } : null;
  }

  function meters(a,b) {
    if (!a || !b || typeof distanceMeters !== "function") return Infinity;
    return distanceMeters(a.lat,a.lon,b.lat,b.lon);
  }
  function near(a,b) { return meters(a,b) <= WALK_EQUIV_METERS; }

  function suppressPointlessTransfer(r) {
    if (r?.kind !== "transfer") return false;
    const firstOrigin = point(r.first?.operator, r.first?.originStop);
    const transfer = point(r.first?.operator, null, r.transferStopId || r.first?.transferStopId);
    const secondDest = point(r.second?.operator, r.second?.destinationStop);
    return near(firstOrigin, transfer) || near(transfer, secondDest);
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

  function targetPoint(r) {
    if (r?.kind === "direct") return point(r.operator, r.destinationStop);
    if (r?.kind === "transfer") return point(r.first?.operator, null, r.transferStopId || r.first?.transferStopId);
    return null;
  }

  function originPoint(r) {
    if (r?.kind === "direct") return point(r.operator, r.originStop);
    if (r?.kind === "transfer") return point(r.first?.operator, r.first?.originStop);
    return null;
  }

  function destinationAnchor() {
    const direct = (journeyState?.results || []).filter(r => r?.kind === "direct").map(r => point(r.operator, r.destinationStop)).filter(Boolean);
    if (direct.length) return direct[0];
    return null;
  }

  function targetKey(p) {
    if (!p) return "unknown";
    const latStep = TARGET_BUCKET_METERS / 111320;
    const lonStep = TARGET_BUCKET_METERS / (111320 * Math.max(.2, Math.cos(p.lat * Math.PI / 180)));
    return `${Math.round(p.lat/latStep)}:${Math.round(p.lon/lonStep)}`;
  }

  function targetFirstPrune() {
    if (!Array.isArray(journeyState?.results)) return 0;
    const score = typeof journeyScore === "function" ? journeyScore : fallbackScore;
    const dest = destinationAnchor();
    const best = new Map();
    const keep = [];

    for (const r of journeyState.results) {
      if (r?.kind !== "transfer") { keep.push(r); continue; }
      const o = originPoint(r), t = targetPoint(r);
      if (!t) { keep.push(r); continue; }

      // First leg must normally make geographic progress toward the destination.
      if (dest && o && meters(t,dest) > meters(o,dest) + 250) continue;

      // Routes that reach the same useful target are alternatives: keep the best first-leg option only.
      const key = targetKey(t);
      const firstEta = r.firstEta || r.eta || null;
      const etaMin = firstEta ? Math.max(0, Math.round((new Date(firstEta).getTime() - Date.now()) / 60000)) : 30;
      const firstStops = Number(r.first?.stopCount || 0);
      const accessWalk = Number(r.first?.originStop?.distance || 0);
      const accessCost = etaMin * 4 + firstStops * 2 + Math.round(accessWalk / 80) + Number(score(r) || 0) * .05;
      const old = best.get(key);
      if (!old || accessCost < old.cost) best.set(key, { r, cost:accessCost });
    }
    for (const x of best.values()) keep.push(x.r);
    const removed = journeyState.results.length - keep.length;
    journeyState.results = keep;
    return removed;
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

  function applyRules() {
    if (!Array.isArray(journeyState?.results)) return { walk:0, target:0 };
    const before = journeyState.results.length;
    journeyState.results = journeyState.results.filter(r => !suppressPointlessTransfer(r));
    const walk = before - journeyState.results.length;
    const target = targetFirstPrune();
    directFirstSort();
    return { walk, target };
  }

  if (typeof runJourneySearch === "function") {
    const previous = runJourneySearch;
    runJourneySearch = async function() {
      await previous();
      const removed = applyRules();
      try { renderJourneyResults(); } catch {}
      const st = $("#journeyStatus");
      if (st) {
        const notes = [];
        if (removed.walk) notes.push(`移除 ${removed.walk} 個 100m 內多餘短程轉車`);
        if (removed.target) notes.push(`合併 ${removed.target} 個同 Target 較慢／逆向方案`);
        st.textContent = `${st.textContent || ""} 已採用 Target-first：同一有效落點只保留較快第一程，直達優先${notes.length ? `；${notes.join("；")}` : ""}。`.trim();
      }
    };
  }

  window.dzNearbyStopWalk = { version:"3.7.7", meters:WALK_EQUIV_METERS, targetBucketMeters:TARGET_BUCKET_METERS, apply:applyRules, sort:directFirstSort };
})();
