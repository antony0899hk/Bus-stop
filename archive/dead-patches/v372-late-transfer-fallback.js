(() => {
  "use strict";

  const $ = s => document.querySelector(s);
  const ORIGIN_RADIUS = 1500;
  const DEST_RADIUS = 1800;
  let token = 0;

  function centroid(list) {
    const a = (list || []).filter(s => Number.isFinite(s.lat) && Number.isFinite(s.lon));
    if (!a.length) return null;
    return {
      lat: a.reduce((n,s)=>n+Number(s.lat),0) / a.length,
      lon: a.reduce((n,s)=>n+Number(s.lon),0) / a.length
    };
  }

  function areaStops(value, radius) {
    const base = typeof resolvePlace === "function" ? resolvePlace(value, null) : [];
    const c = centroid(base);
    if (!c || typeof allJourneyStops !== "function") return base;
    const all = allJourneyStops()
      .filter(s => Number.isFinite(s.lat) && Number.isFinite(s.lon))
      .map(s => ({...s, distance: distanceMeters(c.lat,c.lon,s.lat,s.lon)}))
      .filter(s => s.distance <= radius)
      .sort((a,b) => a.distance - b.distance);
    const m = new Map();
    [...base, ...all].forEach(s => {
      const k = `${s.operator}|${s.id}`;
      const old = m.get(k);
      if (!old || Number(s.distance||0) < Number(old.distance||0)) m.set(k,s);
    });
    return [...m.values()].sort((a,b)=>Number(a.distance||0)-Number(b.distance||0)).slice(0,60);
  }

  async function etaForLeg(leg, stopId) {
    try {
      if (!leg || !stopId) return null;
      if (leg.operator === "KMB") {
        const j = await getJSON(`${KMB_API}/eta/${encodeURIComponent(stopId)}/${encodeURIComponent(leg.route)}/${encodeURIComponent(leg.serviceType||"1")}`, {ttl:0,retries:0});
        return (j.data||[])
          .filter(x => (!leg.bound || !x.dir || String(x.dir).toUpperCase()===String(leg.bound).toUpperCase()) && validFutureEta(x.eta))
          .sort((a,b)=>new Date(a.eta)-new Date(b.eta))[0]?.eta || null;
      }
      if (leg.operator === "CTB") {
        const j = await getJSON(`${CTB_API}/eta/ctb/${encodeURIComponent(stopId)}/${encodeURIComponent(leg.route)}`, {ttl:0,retries:0});
        return (j.data||[])
          .filter(x => (!leg.bound || !x.dir || String(x.dir).toUpperCase()===String(leg.bound).toUpperCase()) && validFutureEta(x.eta))
          .sort((a,b)=>new Date(a.eta)-new Date(b.eta))[0]?.eta || null;
      }
    } catch {}
    return null;
  }

  async function lateFallback(myToken) {
    if (!journeyState || journeyState.results?.length) return false;
    const from = $("#journeyFrom")?.value.trim() || "";
    const to = $("#journeyTo")?.value.trim() || "";
    if (!from || !to || typeof ensureJourneyIndexes !== "function") return false;

    await ensureJourneyIndexes();
    if (myToken !== token) return false;

    const origin = areaStops(from, ORIGIN_RADIUS);
    const dest = areaStops(to, DEST_RADIUS);
    let rows = [];

    if (journeyState.kmbIndex) {
      rows.push(...directFromIndex(journeyState.kmbIndex, origin.filter(x=>x.operator==="KMB"), dest.filter(x=>x.operator==="KMB")));
      rows.push(...oneTransferFromIndex(journeyState.kmbIndex, origin.filter(x=>x.operator==="KMB"), dest.filter(x=>x.operator==="KMB")));
    }
    if (journeyState.ctbIndex) {
      rows.push(...directFromIndex(journeyState.ctbIndex, origin.filter(x=>x.operator==="CTB"), dest.filter(x=>x.operator==="CTB")));
      rows.push(...oneTransferFromIndex(journeyState.ctbIndex, origin.filter(x=>x.operator==="CTB"), dest.filter(x=>x.operator==="CTB")));
    }
    if (typeof gmbDirect === "function") {
      try { rows.push(...await gmbDirect(origin,dest)); } catch {}
    }

    const checked = [];
    for (const r of rows.slice(0,50)) {
      if (myToken !== token) return false;
      if (r.kind === "transfer") {
        const firstEta = await etaForLeg(r.first, r.first?.originStop?.id);
        if (!firstEta) continue;
        r.firstEta = firstEta;
        r.eta = firstEta;
        // The second leg is checked opportunistically only. At a future transfer point,
        // a missing ETA now must not invalidate an otherwise operating journey.
        r.secondEta = await etaForLeg(r.second, r.transferStopId);
        r._dzFutureTransfer = !r.secondEta;
        checked.push(r);
      } else if (r.operator === "GMB") {
        const eta = await journeyEta(r);
        if (eta) { r.eta = eta; checked.push(r); }
      } else {
        const eta = await etaForLeg(r, r.originStop?.id);
        if (eta) { r.eta = eta; checked.push(r); }
      }
      if (checked.length >= 12) break;
    }

    if (!checked.length) return false;
    journeyState.results = checked;
    try { renderJourneyResults(); } catch {}
    const st = $("#journeyStatus");
    if (st) st.textContent = `已擴闊起點／目的地搜尋，找到 ${checked.length} 個現時可出發方案；轉車後一程會到達轉車點時再確認 ETA。`;
    return true;
  }

  if (typeof runJourneySearch === "function") {
    const previous = runJourneySearch;
    runJourneySearch = async function() {
      const myToken = ++token;
      await previous();
      if (myToken !== token) return;
      await lateFallback(myToken);
    };
  }
})();