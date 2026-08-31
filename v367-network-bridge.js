(() => {
  "use strict";

  const extra = window.dzExtraTransit;
  const FINAL_WALK_ADD = 800;
  const FINAL_WALK_REPLACE = 500;
  const GATEWAY_STOP_RADIUS = 700;
  const GATEWAY_SEARCH_RADIUS = 12000;

  const $ = s => document.querySelector(s);
  const norm = v => String(v || "").trim().toLowerCase().replace(/[\s　]+/g, "").replace(/港鐵|地鐵/g, "").replace(/站$/g, "");
  const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
  const timeout = (p, ms, fallback = null) => Promise.race([
    Promise.resolve(p).catch(() => fallback),
    delay(ms).then(() => fallback)
  ]);

  function stopMap(op) {
    if (typeof state === "undefined") return null;
    if (op === "KMB") return state.kmbStops;
    if (op === "CTB") return state.ctbStops;
    if (op === "GMB") return state.gmbStops;
    return null;
  }

  function stopPoint(op, id) {
    const map = stopMap(op);
    const s = map?.get(String(id));
    if (!s) return null;
    const lat = Number(s.lat ?? s.latitude);
    const lon = Number(s.long ?? s.lng ?? s.longitude);
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
    return { id:String(id), name:journeyStopName(s) || String(id), lat, lon, stop:s };
  }

  function minDistanceToTargets(point, targets) {
    if (!point || typeof distanceMeters !== "function") return Infinity;
    let best = Infinity;
    for (const t of targets || []) {
      if (!Number.isFinite(t.lat) || !Number.isFinite(t.lon)) continue;
      const d = distanceMeters(point.lat, point.lon, t.lat, t.lon);
      if (Number.isFinite(d) && d < best) best = d;
    }
    return best;
  }

  function addFinalWalkShortcuts() {
    if (!Array.isArray(journeyState?.results) || typeof resolvePlace !== "function") return 0;
    const to = $("#journeyTo")?.value || "";
    const targets = resolvePlace(to, null).filter(t => Number.isFinite(t.lat) && Number.isFinite(t.lon));
    if (!targets.length) return 0;

    const additions = [];
    const replaceKeys = new Set();
    for (const r of journeyState.results) {
      if (r?.kind !== "transfer" || !r.first?.originStop || !r.transferStopId) continue;
      const point = stopPoint(r.first.operator, r.transferStopId);
      if (!point) continue;
      const finalWalk = minDistanceToTargets(point, targets);
      if (!Number.isFinite(finalWalk) || finalWalk > FINAL_WALK_ADD) continue;

      const originWalk = Number(r.first.originStop?.distance || 0);
      const c = {
        kind:"direct", transferCount:0,
        operator:r.first.operator, route:r.first.route, bound:r.first.bound || "", serviceType:r.first.serviceType || "1",
        originStop:r.first.originStop,
        destinationStop:{ id:point.id, name:point.name, lat:point.lat, lon:point.lon, distance:finalWalk, stop:point.stop },
        originPos:Number(r.first.originPos || 0),
        destinationPos:Number(r.first.originPos || 0) + Math.max(1, Number(r.first.stopCount || 1)),
        stopCount:Math.max(1, Number(r.first.stopCount || 1)),
        walkMeters:originWalk + finalWalk,
        eta:r.firstEta || null,
        fare:Array.isArray(r.legFares) && Number(r.legFares[0]) > 0 ? Number(r.legFares[0]) : null,
        meta:{ orig:r.first.orig || "", dest:`${point.name}（落車後步行到目的地）` },
        _dzFinalWalk:true,
        finalWalkMeters:finalWalk
      };
      additions.push(c);
      if (finalWalk <= FINAL_WALK_REPLACE) {
        replaceKeys.add(`${r.first.operator}|${r.first.route}|${r.transferStopId}`);
      }
    }

    if (replaceKeys.size) {
      journeyState.results = journeyState.results.filter(r => {
        if (r?.kind !== "transfer") return true;
        return !replaceKeys.has(`${r.first?.operator}|${r.first?.route}|${r.transferStopId}`);
      });
    }

    const seen = new Set(journeyState.results.map(r => `${r.kind}|${r.operator || r.first?.operator}|${r.route || r.first?.route}|${r.originStop?.id || r.first?.originStop?.id}|${r.destinationStop?.id || r.transferStopId}`));
    for (const c of additions) {
      const k = `${c.kind}|${c.operator}|${c.route}|${c.originStop?.id}|${c.destinationStop?.id}`;
      if (!seen.has(k)) { seen.add(k); journeyState.results.push(c); }
    }
    return additions.length;
  }

  function stationCoords(station) {
    if (!station || typeof allJourneyStops !== "function") return null;
    const q = norm(station.name_tc);
    if (!q) return null;
    const hits = allJourneyStops().filter(s => Number.isFinite(s.lat) && Number.isFinite(s.lon) && norm(s.name).includes(q));
    if (!hits.length) return null;
    return {
      lat:hits.reduce((n,s) => n + Number(s.lat), 0) / hits.length,
      lon:hits.reduce((n,s) => n + Number(s.lon), 0) / hits.length
    };
  }

  function destinationStations(value) {
    if (!extra?.mtrStations?.size) return [];
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
    return out.sort((a,b) => a.rank - b.rank).slice(0, 6);
  }

  function nearestGatewayStations(location) {
    if (!location || !extra?.mtrStations?.size || typeof distanceMeters !== "function") return [];
    const out = [];
    for (const station of extra.mtrStations.values()) {
      const c = stationCoords(station);
      if (!c) continue;
      const d = distanceMeters(location.lat, location.lon, c.lat, c.lon);
      if (Number.isFinite(d) && d <= GATEWAY_SEARCH_RADIUS) out.push({ station, coords:c, distance:d });
    }
    return out.sort((a,b) => a.distance - b.distance).slice(0, 5);
  }

  function shortestMtrPath(startCode, targetCodes) {
    const targets = new Set(targetCodes);
    const queue = [{ code:startCode, path:[startCode], lines:[] }];
    const seen = new Set([startCode]);
    while (queue.length) {
      const cur = queue.shift();
      if (targets.has(cur.code)) return cur;
      for (const edge of extra?.mtrGraph?.get(cur.code) || []) {
        if (seen.has(edge.to)) continue;
        seen.add(edge.to);
        queue.push({ code:edge.to, path:[...cur.path, edge.to], lines:[...cur.lines, edge.line] });
      }
    }
    return null;
  }

  function gatewayStops(gateway) {
    if (typeof allJourneyStops !== "function" || typeof distanceMeters !== "function") return [];
    return allJourneyStops().filter(s => Number.isFinite(s.lat) && Number.isFinite(s.lon)).map(s => ({
      ...s,
      distance:distanceMeters(gateway.coords.lat, gateway.coords.lon, s.lat, s.lon)
    })).filter(s => Number.isFinite(s.distance) && s.distance <= GATEWAY_STOP_RADIUS)
      .sort((a,b) => a.distance - b.distance).slice(0, 36);
  }

  function bestFirstLeg(origin, gatewayStopsList) {
    const rows = [];
    if (journeyState.kmbIndex) rows.push(...directFromIndex(journeyState.kmbIndex, origin.filter(x => x.operator === "KMB"), gatewayStopsList.filter(x => x.operator === "KMB")));
    if (journeyState.ctbIndex) rows.push(...directFromIndex(journeyState.ctbIndex, origin.filter(x => x.operator === "CTB"), gatewayStopsList.filter(x => x.operator === "CTB")));
    return rows.sort((a,b) => (Number(a.walkMeters)||0) + (Number(a.stopCount)||0)*80 - ((Number(b.walkMeters)||0) + (Number(b.stopCount)||0)*80))[0] || null;
  }

  async function buildMtrBridge() {
    if (!extra?.mtrStations?.size || !journeyState?.originLocation) return null;
    const to = $("#journeyTo")?.value || "";
    const dests = destinationStations(to);
    if (!dests.length) return null;

    const origin = resolvePlace("我的位置", journeyState.originLocation);
    if (!origin.length) return null;
    const gateways = nearestGatewayStations(journeyState.originLocation);
    for (const gateway of gateways) {
      const path = shortestMtrPath(gateway.station.code, dests.map(x => x.station.code));
      if (!path || path.path.length < 2) continue;
      const gs = gatewayStops(gateway);
      let first = bestFirstLeg(origin, gs);

      if (!first && typeof gmbDirect === "function") {
        const gmb = await timeout(gmbDirect(origin, gs), 3200, []);
        if (Array.isArray(gmb) && gmb.length) first = gmb.sort((a,b) => (Number(a.walkMeters)||0) + (Number(a.stopCount)||0)*70 - ((Number(b.walkMeters)||0) + (Number(b.stopCount)||0)*70))[0];
      }
      if (!first) continue;

      const d = extra.mtrStations.get(path.path[path.path.length - 1]);
      if (!d) continue;
      const lines = [];
      path.lines.forEach(l => { if (l && lines[lines.length - 1] !== l) lines.push(l); });
      const mtrFare = extra.mtrFares.get(`${gateway.station.id}|${d.id}`) ?? extra.mtrFares.get(`${d.id}|${gateway.station.id}`) ?? null;

      const [firstEta, firstFare] = await Promise.all([
        timeout(typeof journeyEta === "function" ? journeyEta(first) : null, 1800, null),
        timeout(typeof journeyFare === "function" ? journeyFare(first) : null, 1800, null)
      ]);

      const result = {
        kind:"transfer", transferCount:1,
        first:{
          operator:first.operator, route:first.route, bound:first.bound || "", serviceType:first.serviceType || "1",
          originStop:first.originStop, transferStopId:first.destinationStop?.id, stopCount:first.stopCount,
          orig:first.meta?.orig || "", dest:first.meta?.dest || gateway.station.name_tc
        },
        second:{
          operator:"MTR", route:lines.join(" → ") || "港鐵", bound:"", serviceType:"1",
          transferStopId:first.destinationStop?.id,
          destinationStop:{ id:d.code, name:d.name_tc },
          stopCount:Math.max(1, path.path.length - 1), orig:gateway.station.name_tc, dest:d.name_tc
        },
        transferStopId:first.destinationStop?.id,
        walkMeters:Number(first.walkMeters || 0),
        stopCount:Number(first.stopCount || 0) + Math.max(1, path.path.length - 1),
        firstEta:firstEta || first.eta || null,
        secondEta:null,
        legFares:(Number(firstFare) > 0 && Number(mtrFare) > 0) ? [Number(firstFare), Number(mtrFare)] : undefined,
        _dzMtrBridge:true,
        mtrPath:path.path,
        mtrLines:lines
      };
      return result;
    }
    return null;
  }

  function renderAndStatus(extraText = "") {
    try { renderJourneyResults(); } catch {}
    const st = $("#journeyStatus");
    if (st && extraText) st.textContent = extraText;
  }

  if (typeof runJourneySearch === "function") {
    const previous = runJourneySearch;
    runJourneySearch = async function() {
      await previous();
      await delay(250);

      const addedWalk = addFinalWalkShortcuts();
      if (addedWalk) renderAndStatus(`已優先加入「落車後直接步行」方案；ETA／車費會繼續背景更新。`);

      const hasUseful = Array.isArray(journeyState.results) && journeyState.results.some(r => r.kind === "direct" || r.operator === "MTR" || r._dzMtrBridge);
      const bridge = await timeout(buildMtrBridge(), hasUseful ? 4200 : 6500, null);
      if (bridge) {
        const duplicate = journeyState.results.some(r => r._dzMtrBridge && r.first?.route === bridge.first?.route && r.second?.destinationStop?.id === bridge.second?.destinationStop?.id);
        if (!duplicate) journeyState.results.push(bridge);
        addFinalWalkShortcuts();
        renderAndStatus(`已加入巴士／小巴接駁港鐵方案，共 ${journeyState.results.length} 個候選；會繼續補 ETA／車費。`);
      }
    };
  }

  window.dzAddFinalWalkShortcuts = addFinalWalkShortcuts;
  window.dzBuildMtrBridge = buildMtrBridge;
})();
