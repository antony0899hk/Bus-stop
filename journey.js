const JOURNEY_KMB_ROUTE_STOP = "https://data.etabus.gov.hk/v1/transport/kmb/route-stop";
const JOURNEY_CTB_ROUTE_STOP = "https://rt.data.gov.hk/v1/transport/citybus-nwfb/route-stop/ctb";
const JOURNEY_RADIUS = 300;
const JOURNEY_TRANSFER_LIMIT = 12;

const journeyState = {
  mode: "fastest",
  originLocation: null,
  kmbIndex: null,
  ctbIndex: null,
  indexPromise: null,
  results: []
};

const j$ = s => document.querySelector(s);

function journeyStopName(stop) {
  return stop?.name_tc || stop?.name || stop?.stop_name_tc || "";
}

function allJourneyStops() {
  const out = [];
  if (typeof state === "undefined") return out;
  for (const [operator, map] of [["KMB", state.kmbStops], ["CTB", state.ctbStops], ["GMB", state.gmbStops]]) {
    for (const [id, stop] of map) {
      const name = journeyStopName(stop);
      const lat = Number(stop.lat ?? stop.latitude);
      const lon = Number(stop.long ?? stop.lng ?? stop.longitude);
      if (!name) continue;
      out.push({ operator, id:String(id), name, lat, lon, stop });
    }
  }
  return out;
}

function normalizePlace(v) {
  return String(v || "").trim().toLowerCase().replace(/[\s　]+/g, "");
}

function resolvePlace(value, location = null) {
  const stops = allJourneyStops();
  if (location) {
    return stops
      .filter(s => Number.isFinite(s.lat) && Number.isFinite(s.lon))
      .map(s => ({ ...s, distance: distanceMeters(location.lat, location.lon, s.lat, s.lon) }))
      .filter(s => s.distance <= JOURNEY_RADIUS)
      .sort((a,b) => a.distance - b.distance)
      .slice(0, 18);
  }
  const q = normalizePlace(value);
  if (!q) return [];
  return stops.map(s => {
    const name = normalizePlace(s.name);
    let rank = 99;
    if (name === q) rank = 0;
    else if (name.startsWith(q)) rank = 1;
    else if (name.includes(q)) rank = 2;
    return { ...s, rank, distance:0 };
  }).filter(s => s.rank < 99)
    .sort((a,b) => a.rank - b.rank || a.name.length - b.name.length)
    .slice(0, 24);
}

function buildRouteIndex(rows, operator) {
  const byRoute = new Map();
  const byStop = new Map();
  for (const row of rows || []) {
    const stop = String(row.stop || row.stop_id || "");
    const route = String(row.route || "");
    if (!stop || !route) continue;
    const bound = String(row.bound || row.dir || row.direction || "");
    const serviceType = String(row.service_type || row.serviceType || "1");
    const key = `${operator}|${route}|${bound}|${serviceType}`;
    const seq = Number(row.seq || row.stop_seq || row.stopSeq || 0);
    if (!byRoute.has(key)) byRoute.set(key, { operator, route, bound, serviceType, stops:[] });
    byRoute.get(key).stops.push({ stop, seq });
  }
  for (const r of byRoute.values()) {
    r.stops.sort((a,b) => a.seq - b.seq);
    r.stops.forEach((s, idx) => {
      s.pos = idx;
      if (!byStop.has(s.stop)) byStop.set(s.stop, []);
      byStop.get(s.stop).push({ routeKey:`${r.operator}|${r.route}|${r.bound}|${r.serviceType}`, pos:idx, seq:s.seq });
    });
  }
  return { byRoute, byStop };
}

async function ensureJourneyIndexes() {
  if (journeyState.kmbIndex && journeyState.ctbIndex) return;
  if (journeyState.indexPromise) return journeyState.indexPromise;
  journeyState.indexPromise = (async () => {
    const [kmb, ctb] = await Promise.allSettled([
      getJSON(JOURNEY_KMB_ROUTE_STOP, { ttl: 12 * 60 * 60 * 1000, retries:1 }),
      getJSON(JOURNEY_CTB_ROUTE_STOP, { ttl: 12 * 60 * 60 * 1000, retries:1 })
    ]);
    if (kmb.status === "fulfilled") journeyState.kmbIndex = buildRouteIndex(kmb.value.data || [], "KMB");
    if (ctb.status === "fulfilled") journeyState.ctbIndex = buildRouteIndex(ctb.value.data || [], "CTB");
    if (!journeyState.kmbIndex && !journeyState.ctbIndex) throw new Error("暫時未能建立路線索引");
  })().finally(() => { journeyState.indexPromise = null; });
  return journeyState.indexPromise;
}

function routeMetaFromKey(key) {
  const [operator, route, bound, serviceType] = key.split("|");
  let meta = null;
  if (typeof normalizedRoutes === "function") {
    meta = normalizedRoutes().find(r => r.operator === operator && String(r.route) === route && String(r.bound || "") === bound && String(r.serviceType || "1") === serviceType);
  }
  return { operator, route, bound, serviceType, orig:meta?.orig || "", dest:meta?.dest || "" };
}

function directFromIndex(index, originStops, destinationStops) {
  if (!index) return [];
  const destinationIds = new Set(destinationStops.filter(s => s.operator === [...index.byRoute.values()][0]?.operator).map(s => s.id));
  const results = [];
  for (const origin of originStops) {
    if (!index.byStop.has(origin.id)) continue;
    for (const membership of index.byStop.get(origin.id)) {
      const r = index.byRoute.get(membership.routeKey);
      if (!r) continue;
      for (let i = membership.pos + 1; i < r.stops.length; i++) {
        const d = r.stops[i];
        if (!destinationIds.has(d.stop)) continue;
        const destination = destinationStops.find(x => x.id === d.stop && x.operator === r.operator);
        const meta = routeMetaFromKey(membership.routeKey);
        results.push({
          kind:"direct", transferCount:0, operator:r.operator, route:r.route, bound:r.bound, serviceType:r.serviceType,
          originStop:origin, destinationStop:destination, originPos:membership.pos, destinationPos:i,
          stopCount:i-membership.pos, walkMeters:(origin.distance || 0)+(destination?.distance || 0), meta
        });
        break;
      }
    }
  }
  return results;
}

function oneTransferFromIndex(index, originStops, destinationStops) {
  if (!index) return [];
  const op = [...index.byRoute.values()][0]?.operator;
  const destinationIds = new Set(destinationStops.filter(s => s.operator === op).map(s => s.id));
  const out = [];
  const seen = new Set();
  for (const origin of originStops.filter(s => s.operator === op)) {
    for (const firstMem of index.byStop.get(origin.id) || []) {
      const first = index.byRoute.get(firstMem.routeKey);
      if (!first) continue;
      const transferCandidates = first.stops.slice(firstMem.pos + 1, firstMem.pos + 1 + JOURNEY_TRANSFER_LIMIT);
      for (const transferStop of transferCandidates) {
        for (const secondMem of index.byStop.get(transferStop.stop) || []) {
          if (secondMem.routeKey === firstMem.routeKey) continue;
          const second = index.byRoute.get(secondMem.routeKey);
          if (!second) continue;
          for (let j = secondMem.pos + 1; j < second.stops.length; j++) {
            if (!destinationIds.has(second.stops[j].stop)) continue;
            const dest = destinationStops.find(x => x.id === second.stops[j].stop && x.operator === op);
            const key = `${firstMem.routeKey}>${transferStop.stop}>${secondMem.routeKey}>${dest?.id}`;
            if (seen.has(key)) break;
            seen.add(key);
            out.push({
              kind:"transfer", transferCount:1,
              first:{ ...routeMetaFromKey(firstMem.routeKey), originStop:origin, transferStopId:transferStop.stop, stopCount:transferStop.pos-firstMem.pos },
              second:{ ...routeMetaFromKey(secondMem.routeKey), transferStopId:transferStop.stop, destinationStop:dest, stopCount:j-secondMem.pos },
              transferStopId:transferStop.stop,
              walkMeters:(origin.distance || 0)+(dest?.distance || 0),
              stopCount:(transferStop.pos-firstMem.pos)+(j-secondMem.pos)
            });
            break;
          }
        }
      }
    }
  }
  return out.slice(0, 30);
}

async function gmbDirect(originStops, destinationStops) {
  const out = [];
  const destIds = new Set(destinationStops.filter(s => s.operator === "GMB").map(s => s.id));
  for (const origin of originStops.filter(s => s.operator === "GMB").slice(0,8)) {
    const refs = Array.isArray(origin.stop?.routes) ? origin.stop.routes : [];
    for (const ref of refs.slice(0,12)) {
      const routeId = ref.routeId ?? ref.route_id;
      const routeSeq = ref.routeSeq ?? ref.route_seq ?? 1;
      if (!routeId) continue;
      try {
        const j = await getJSON(`${GMB_API}/route-stop/${encodeURIComponent(routeId)}/${encodeURIComponent(routeSeq)}`, { ttl:300000, retries:0 });
        const stops = j.data?.route_stops || [];
        const oi = stops.findIndex(s => String(s.stop_id) === origin.id);
        if (oi < 0) continue;
        const di = stops.findIndex((s,i) => i > oi && destIds.has(String(s.stop_id)));
        if (di < 0) continue;
        const dest = destinationStops.find(x => x.operator === "GMB" && x.id === String(stops[di].stop_id));
        const meta = state.gmbRoutes.find(r => String(r.routeId) === String(routeId) && Number(r.routeSeq) === Number(routeSeq));
        out.push({ kind:"direct", transferCount:0, operator:"GMB", route:meta?.route || ref.route || "小巴", routeId, routeSeq, serviceType:String(routeSeq), bound:meta?.bound || "", originStop:origin, destinationStop:dest, originPos:oi, destinationPos:di, stopCount:di-oi, walkMeters:(origin.distance||0)+(dest?.distance||0), meta:{ orig:meta?.orig||"", dest:meta?.dest||"" } });
      } catch {}
    }
  }
  return out;
}

async function journeyEta(result) {
  try {
    if (result.kind === "transfer") return null;
    if (result.operator === "KMB") {
      const j = await getJSON(`${KMB_API}/eta/${encodeURIComponent(result.originStop.id)}/${encodeURIComponent(result.route)}/${encodeURIComponent(result.serviceType)}`, { ttl:20000, retries:0 });
      const rows = (j.data || []).filter(x => (!result.bound || !x.dir || x.dir === result.bound) && validFutureEta(x.eta)).sort((a,b)=>new Date(a.eta)-new Date(b.eta));
      return rows[0]?.eta || null;
    }
    if (result.operator === "CTB") {
      const j = await getJSON(`${CTB_API}/eta/ctb/${encodeURIComponent(result.originStop.id)}/${encodeURIComponent(result.route)}`, { ttl:20000, retries:0 });
      const rows = (j.data || []).filter(x => (!result.bound || !x.dir || String(x.dir).toUpperCase() === String(result.bound).toUpperCase()) && validFutureEta(x.eta)).sort((a,b)=>new Date(a.eta)-new Date(b.eta));
      return rows[0]?.eta || null;
    }
    const j = await getJSON(`${GMB_API}/eta/route-stop/${encodeURIComponent(result.routeId)}/${encodeURIComponent(result.routeSeq)}/${encodeURIComponent(result.originPos+1)}`, { ttl:20000, retries:0 });
    return (j.data?.eta || []).map(x=>x.timestamp).filter(validFutureEta).sort()[0] || null;
  } catch { return null; }
}

async function journeyFare(result) {
  if (result.kind !== "direct" || typeof loadFareXml !== "function" || typeof routeFareRecords !== "function") return null;
  try {
    const xml = await loadFareXml(result.operator);
    const records = routeFareRecords(xml, { operator:result.operator, route:result.route, bound:result.bound });
    const map = buildFareMap(records);
    return map.get(result.originPos + 1) ?? null;
  } catch { return null; }
}

function journeyScore(r) {
  const etaM = r.eta ? etaMinutes(r.eta) : 30;
  if (journeyState.mode === "walking") return r.walkMeters + r.transferCount * 150;
  if (journeyState.mode === "transfers") return r.transferCount * 10000 + r.stopCount * 10 + etaM;
  if (journeyState.mode === "cheapest") return r.fare == null ? 99999 : r.fare * 100 + r.transferCount * 20;
  return etaM * 4 + r.stopCount * 2 + r.transferCount * 15 + Math.round(r.walkMeters / 80);
}

function stopLabel(stop) {
  return stop?.name || stop?.id || "車站";
}

function routeBadge(op) {
  return operatorBadge(op);
}

function renderJourneyResults() {
  const box = j$("#journeyResults");
  const list = [...journeyState.results].sort((a,b)=>journeyScore(a)-journeyScore(b)).slice(0,12);
  if (!list.length) {
    box.innerHTML = '<div class="empty">暫時搵唔到合適直達／一次轉車方案。可以試較闊嘅站名，例如「上水」或「尖沙咀」。</div>';
    return;
  }
  box.innerHTML = list.map((r,i) => {
    if (r.kind === "transfer") {
      const transferMap = r.first.operator === "KMB" ? state.kmbStops : state.ctbStops;
      const transferName = journeyStopName(transferMap.get(String(r.transferStopId))) || "轉車站";
      return `<article class="journey-card"><div class="journey-rank">${i+1}</div><div class="journey-main"><div class="journey-lines"><span>${routeBadge(r.first.operator)} <strong>${escapeHtml(r.first.route)}</strong></span><span class="arrow">→</span><span>${routeBadge(r.second.operator)} <strong>${escapeHtml(r.second.route)}</strong></span></div><div class="journey-title">${escapeHtml(stopLabel(r.first.originStop))} → ${escapeHtml(transferName)} → ${escapeHtml(stopLabel(r.second.destinationStop))}</div><div class="journey-meta">轉 1 次 · 約 ${r.stopCount} 個站${r.walkMeters ? ` · 步行約 ${Math.round(r.walkMeters)}m` : ""}</div><div class="journey-note">轉車方案暫以路線／站序估算，實際班次請逐段確認 ETA。</div></div></article>`;
    }
    return `<article class="journey-card"><div class="journey-rank">${i+1}</div><div class="journey-main"><div class="journey-top"><div>${routeBadge(r.operator)} <strong class="journey-route">${escapeHtml(r.route)}</strong></div><div class="journey-eta">${r.eta ? escapeHtml(etaLabel(r.eta)) : "未有 ETA"}</div></div><div class="journey-title">${escapeHtml(stopLabel(r.originStop))} → ${escapeHtml(stopLabel(r.destinationStop))}</div><div class="journey-meta">直達 · 約 ${r.stopCount} 個站${r.walkMeters ? ` · 步行約 ${Math.round(r.walkMeters)}m` : ""}${r.fare != null ? ` · $${Number(r.fare).toFixed(1)}` : ""}</div><div class="journey-note">${escapeHtml(r.meta?.dest ? `往 ${r.meta.dest}` : "")}</div></div></article>`;
  }).join("");
}

async function runJourneySearch() {
  const button = j$("#journeySearchBtn");
  const status = j$("#journeyStatus");
  const originValue = j$("#journeyFrom").value;
  const destinationValue = j$("#journeyTo").value;
  const origin = resolvePlace(originValue, journeyState.originLocation);
  const destination = resolvePlace(destinationValue);
  if (!origin.length || !destination.length) {
    status.textContent = "搵唔到起點或終點車站，請輸入較短地名／站名。";
    return;
  }
  button.disabled = true;
  status.textContent = "正在建立路線索引及搵最快方案…";
  j$("#journeyResults").innerHTML = '<div class="loading">搜尋中…</div>';
  try {
    await ensureJourneyIndexes();
    const direct = [
      ...directFromIndex(journeyState.kmbIndex, origin.filter(x=>x.operator==="KMB"), destination.filter(x=>x.operator==="KMB")),
      ...directFromIndex(journeyState.ctbIndex, origin.filter(x=>x.operator==="CTB"), destination.filter(x=>x.operator==="CTB")),
      ...(await gmbDirect(origin, destination))
    ];
    const transfers = [
      ...oneTransferFromIndex(journeyState.kmbIndex, origin, destination),
      ...oneTransferFromIndex(journeyState.ctbIndex, origin, destination)
    ];
    const uniq = new Map();
    [...direct, ...transfers].forEach(r => {
      const key = r.kind === "direct" ? `${r.operator}|${r.route}|${r.originStop.id}|${r.destinationStop?.id}` : `${r.first.operator}|${r.first.route}>${r.second.route}|${r.transferStopId}`;
      if (!uniq.has(key)) uniq.set(key,r);
    });
    journeyState.results = [...uniq.values()].slice(0,40);
    await Promise.all(journeyState.results.filter(r=>r.kind==="direct").slice(0,18).map(async r => {
      [r.eta, r.fare] = await Promise.all([journeyEta(r), journeyFare(r)]);
    }));
    status.textContent = `找到 ${journeyState.results.length} 個候選方案。ETA 及收費以公開資料為準；轉車時間屬 Beta 估算。`;
    renderJourneyResults();
  } catch (e) {
    status.textContent = `點對點暫時未能搜尋：${e.message}`;
    j$("#journeyResults").innerHTML = '<div class="error">其他 ETA 功能仍可正常使用。</div>';
  } finally { button.disabled = false; }
}

function useJourneyLocation() {
  if (!navigator.geolocation) return;
  const btn = j$("#journeyUseLocation");
  btn.disabled = true;
  j$("#journeyStatus").textContent = "正在取得目前位置…";
  navigator.geolocation.getCurrentPosition(pos => {
    journeyState.originLocation = { lat:pos.coords.latitude, lon:pos.coords.longitude };
    j$("#journeyFrom").value = "我的位置";
    j$("#journeyStatus").textContent = `已使用目前位置，起點會搜尋 ${JOURNEY_RADIUS}m 內車站。`;
    btn.disabled = false;
  }, () => {
    j$("#journeyStatus").textContent = "未能取得目前位置。";
    btn.disabled = false;
  }, { enableHighAccuracy:true, timeout:12000, maximumAge:30000 });
}

function initJourneyPlanner() {
  const search = j$("#journeySearchBtn");
  if (!search) return;
  search.addEventListener("click", runJourneySearch);
  j$("#journeyUseLocation").addEventListener("click", useJourneyLocation);
  j$("#journeyFrom").addEventListener("input", () => { if (j$("#journeyFrom").value !== "我的位置") journeyState.originLocation = null; });
  document.querySelectorAll("[data-journey-mode]").forEach(btn => btn.addEventListener("click", () => {
    journeyState.mode = btn.dataset.journeyMode;
    document.querySelectorAll("[data-journey-mode]").forEach(x => x.classList.toggle("active", x === btn));
    if (journeyState.results.length) renderJourneyResults();
  }));
}

window.addEventListener("load", initJourneyPlanner);
