(() => {
  "use strict";

  const extra = window.dzExtraTransit;
  if (!extra) return;

  const norm = v => String(v || "").trim().toLowerCase().replace(/[\s　]+/g, "").replace(/港鐵|地鐵/g, "").replace(/站$/g, "");

  function waitForMtrData(timeout = 5000) {
    if (extra.mtrRows?.length && extra.mtrStations?.size) return Promise.resolve(true);
    return new Promise(resolve => {
      const started = Date.now();
      const timer = setInterval(() => {
        if (extra.mtrRows?.length && extra.mtrStations?.size) {
          clearInterval(timer); resolve(true); return;
        }
        if (Date.now() - started >= timeout) { clearInterval(timer); resolve(false); }
      }, 100);
    });
  }

  function stationCoords(station) {
    if (!station || typeof allJourneyStops !== "function") return null;
    const q = norm(station.name_tc);
    if (!q) return null;
    const matches = allJourneyStops()
      .filter(s => Number.isFinite(s.lat) && Number.isFinite(s.lon))
      .filter(s => norm(s.name).includes(q));
    if (!matches.length) return null;
    const lat = matches.reduce((a,b) => a + Number(b.lat), 0) / matches.length;
    const lon = matches.reduce((a,b) => a + Number(b.lon), 0) / matches.length;
    return { lat, lon };
  }

  function nearestOriginStations(location) {
    if (!location || typeof distanceMeters !== "function") return [];
    const out = [];
    for (const s of extra.mtrStations.values()) {
      const c = stationCoords(s);
      if (!c) continue;
      const d = distanceMeters(location.lat, location.lon, c.lat, c.lon);
      if (Number.isFinite(d) && d <= 1600) out.push({ station:s, distance:d });
    }
    return out.sort((a,b) => a.distance - b.distance).slice(0, 4);
  }

  function textStations(value) {
    const q = norm(value);
    if (!q) return [];
    const out = [];
    for (const s of extra.mtrStations.values()) {
      const tc = norm(s.name_tc), en = norm(s.name_en);
      let rank = 99;
      if (tc === q || en === q) rank = 0;
      else if (tc.startsWith(q) || en.startsWith(q)) rank = 1;
      else if (tc.includes(q) || en.includes(q)) rank = 2;
      if (rank < 99) out.push({ station:s, rank });
    }
    return out.sort((a,b) => a.rank - b.rank).slice(0, 8);
  }

  function shortestPath(starts, ends) {
    const targets = new Set(ends.map(x => x.station.code));
    const queue = starts.map(x => ({ code:x.station.code, path:[x.station.code], lines:[] }));
    const seen = new Set(queue.map(x => x.code));
    while (queue.length) {
      const cur = queue.shift();
      if (targets.has(cur.code)) return cur;
      for (const edge of extra.mtrGraph.get(cur.code) || []) {
        if (seen.has(edge.to)) continue;
        seen.add(edge.to);
        queue.push({ code:edge.to, path:[...cur.path, edge.to], lines:[...cur.lines, edge.line] });
      }
    }
    return null;
  }

  function makeCandidate(path, origins) {
    if (!path?.path?.length) return null;
    const o = extra.mtrStations.get(path.path[0]);
    const d = extra.mtrStations.get(path.path[path.path.length - 1]);
    if (!o || !d) return null;
    const lines = [];
    path.lines.forEach(l => { if (l && lines[lines.length - 1] !== l) lines.push(l); });
    const originHit = origins.find(x => x.station.code === o.code);
    const fare = extra.mtrFares.get(`${o.id}|${d.id}`) ?? extra.mtrFares.get(`${d.id}|${o.id}`) ?? null;
    return {
      kind:"direct", transferCount:Math.max(0, lines.length - 1), operator:"MTR",
      route:lines.join(" → ") || "港鐵", bound:"", serviceType:"1",
      originStop:{id:o.code,name:o.name_tc}, destinationStop:{id:d.code,name:d.name_tc},
      originPos:0, destinationPos:Math.max(1,path.path.length - 1),
      stopCount:Math.max(1,path.path.length - 1), walkMeters:originHit?.distance || 0,
      fare:Number.isFinite(Number(fare)) && Number(fare) > 0 ? Number(fare) : null,
      eta:null, meta:{orig:o.name_tc,dest:d.name_tc}, mtrPath:path.path, mtrLines:lines,
      _dzMtrFallback:true
    };
  }

  async function addMtrFallback() {
    if (!journeyState?.originLocation) return false;
    if (!(await waitForMtrData())) return false;
    const to = document.querySelector("#journeyTo")?.value || "";
    const origins = nearestOriginStations(journeyState.originLocation);
    const dests = textStations(to);
    if (!origins.length || !dests.length) return false;
    const path = shortestPath(origins, dests);
    const c = makeCandidate(path, origins);
    if (!c) return false;
    const duplicate = journeyState.results.some(r => r.operator === "MTR" && String(r.originStop?.id) === String(c.originStop.id) && String(r.destinationStop?.id) === String(c.destinationStop.id));
    if (!duplicate) journeyState.results.push(c);
    return true;
  }

  if (typeof runJourneySearch === "function") {
    const previous = runJourneySearch;
    runJourneySearch = async function() {
      await previous();
      const added = await addMtrFallback().catch(() => false);
      if (added) {
        renderJourneyResults();
        const st = document.querySelector("#journeyStatus");
        if (st) st.textContent = `找到 ${journeyState.results.length} 個候選方案。已包括附近港鐵方案；ETA 及收費以公開資料為準。`;
      }
    };
  }
})();
