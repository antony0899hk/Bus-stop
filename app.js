const KMB_API = "https://data.etabus.gov.hk/v1/transport/kmb";
const CTB_API = "https://rt.data.gov.hk/v2/transport/citybus";
const GMB_API = "https://data.etagmb.gov.hk";
const TD_TRAFFIC = "https://www.td.gov.hk/tc/special_news/trafficnews.xml";
const TRAFFIC_PROXY = "./api/traffic";
const SHORT_NEARBY_COUNT = 8;
const MAX_NEARBY_COUNT = 40;
const GMB_ROUTE_PARTS = 8;
const GMB_STOP_PARTS = 16;

const state = {
  kmbRoutes: [], ctbRoutes: [], gmbRoutes: [],
  kmbStops: new Map(), ctbStops: new Map(), gmbStops: new Map(),
  selectedRoute: null,
  favorites: loadFavorites(),
  nearby: [], nearbyFilter: "all", nearbyExpanded: false,
  searchFilter: "all", warnings: []
};

const responseCache = new Map();
const $ = s => document.querySelector(s);
const $$ = s => [...document.querySelectorAll(s)];
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

function escapeHtml(v = "") {
  return String(v).replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
}
function loadFavorites() {
  try { return JSON.parse(localStorage.getItem("daozhan_favorites_v2") || "[]"); }
  catch { return []; }
}
function saveFavorites() { localStorage.setItem("daozhan_favorites_v2", JSON.stringify(state.favorites)); }

async function getJSON(url, { ttl = 30000, retries = 1 } = {}) {
  const cached = responseCache.get(url);
  if (cached && Date.now() - cached.time < ttl) return cached.value;
  let last;
  for (let attempt = 0; attempt <= retries; attempt++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 12000);
    try {
      const res = await fetch(url, { headers: { Accept: "application/json" }, signal: controller.signal });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const value = await res.json();
      responseCache.set(url, { time: Date.now(), value });
      return value;
    } catch (error) {
      last = error;
      if (attempt < retries) await sleep(350 * (attempt + 1));
    } finally { clearTimeout(timer); }
  }
  throw last;
}
function etaMinutes(iso) {
  if (!iso) return null;
  return Math.max(0, Math.round((new Date(iso) - new Date()) / 60000));
}
function validFutureEta(iso) {
  const t = new Date(iso).getTime();
  return Number.isFinite(t) && t >= Date.now() - 60000 && t <= Date.now() + 3 * 60 * 60 * 1000;
}
function etaLabel(iso) {
  if (!iso) return "未有預報";
  const m = etaMinutes(iso);
  return m === 0 ? "即將到站" : `${m} 分鐘`;
}
function distanceMeters(aLat, aLon, bLat, bLon) {
  const R = 6371000, toRad = x => x * Math.PI / 180;
  const p1 = toRad(aLat), p2 = toRad(bLat), dp = toRad(bLat - aLat), dl = toRad(bLon - aLon);
  const h = Math.sin(dp / 2) ** 2 + Math.cos(p1) * Math.cos(p2) * Math.sin(dl / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}
function operatorBadge(op) {
  if (op === "CTB") return '<span class="badge ctb">城巴</span>';
  if (op === "GMB") return '<span class="badge gmb">小巴</span>';
  if (op === "MTR") return '<span class="badge mtr">MTR</span>';
  return '<span class="badge kmb">九巴</span>';
}
function stopMapFor(op) {
  return op === "KMB" ? state.kmbStops : op === "CTB" ? state.ctbStops : state.gmbStops;
}

async function bootstrap() {
  const errors = [];
  const jobs = [
    getJSON("./kmb-routes.json", { ttl: 3600000 }).then(j => state.kmbRoutes = j.data || []).catch(() => errors.push("九巴路線")),
    getJSON("./kmb-stops.json", { ttl: 3600000 }).then(j => (j.data || []).forEach(s => state.kmbStops.set(String(s.stop), s))).catch(() => errors.push("九巴站點")),
    getJSON("./ctb-routes.json", { ttl: 3600000 }).then(j => state.ctbRoutes = j.data || []).catch(() => errors.push("城巴路線")),
    getJSON("./ctb-stops.json", { ttl: 3600000 }).then(j => (j.data || []).forEach(s => state.ctbStops.set(String(s.stop), s))).catch(() => errors.push("城巴站點")),
    Promise.all(Array.from({length:GMB_ROUTE_PARTS}, (_,i) => getJSON(`./gmb-routes-${i}.json`, { ttl:3600000 }))).then(parts => state.gmbRoutes = parts.flatMap(j => j.data || [])).catch(() => errors.push("小巴路線")),
    Promise.all(Array.from({length:GMB_STOP_PARTS}, (_,i) => getJSON(`./gmb-stops-${i}.json`, { ttl:3600000 }))).then(parts => parts.flatMap(j => j.data || []).forEach(s => state.gmbStops.set(String(s.stop), s))).catch(() => errors.push("小巴站點"))
  ];
  await Promise.allSettled(jobs);
  const total = normalizedRoutes().length;
  $("#status").textContent = total
    ? `已載入 ${total} 個路線方向（九巴＋城巴＋小巴）。`
    : "暫時未能載入路線資料。";
  if (errors.length) $("#status").textContent += ` 未能載入：${errors.join("、")}；其他營辦商仍可使用。`;
  renderFavorites();
  loadTrafficWarning();
}

function normalizedRoutes() {
  const kmb = state.kmbRoutes.map(r => ({ operator:"KMB", route:r.route, orig:r.orig_tc || "", dest:r.dest_tc || "", bound:r.bound, serviceType:r.service_type }));
  const ctb = state.ctbRoutes.flatMap(r => [
    { operator:"CTB", route:r.route, orig:r.orig_tc || "", dest:r.dest_tc || "", bound:"O", serviceType:"1" },
    { operator:"CTB", route:r.route, orig:r.dest_tc || "", dest:r.orig_tc || "", bound:"I", serviceType:"1" }
  ]);
  const gmb = state.gmbRoutes.map(r => ({ ...r, operator:"GMB", serviceType:String(r.routeSeq || r.serviceType || 1), bound:r.bound || (Number(r.routeSeq) === 1 ? "O" : "I") }));
  return [...kmb, ...ctb, ...gmb];
}
function routeMatches(q) {
  q = q.trim().toUpperCase();
  if (!q) return [];
  const unique = new Map();
  normalizedRoutes()
    .filter(r => state.searchFilter === "all" || r.operator === state.searchFilter)
    .filter(r => String(r.route).toUpperCase().includes(q))
    .forEach(r => {
      const key = [r.operator, r.route, r.bound, r.routeId || "", r.orig, r.dest].join("|");
      if (!unique.has(key) || String(r.serviceType) === "1") unique.set(key, r);
    });
  return [...unique.values()].sort((a, b) => {
    const ae = String(a.route).toUpperCase() === q ? 0 : 1, be = String(b.route).toUpperCase() === q ? 0 : 1;
    return ae - be || String(a.route).localeCompare(String(b.route), undefined, { numeric:true }) || a.operator.localeCompare(b.operator);
  }).slice(0, 50);
}
function renderSearch() {
  const q = $("#routeSearch").value;
  const matches = routeMatches(q);
  $("#resultsSection").classList.remove("hidden");
  $("#routeSection").classList.add("hidden");
  const mtrOnly = state.searchFilter === "MTR";
  $("#results").innerHTML = matches.length ? matches.map((r, i) => `
    <button class="route-card" data-result="${i}">
      <div class="route-number">${escapeHtml(r.route)}<div class="opdot">${operatorBadge(r.operator)}</div></div>
      <div class="route-info">
        <div class="route-destination">${escapeHtml(r.orig)} → ${escapeHtml(r.dest)}</div>
        <div class="route-sub">${r.operator === "GMB" ? `方向 ${escapeHtml(r.routeSeq)}` : r.bound === "O" ? "去程" : "回程"}</div>
      </div><div class="chevron">›</div>
    </button>`).join("") : `<div class="empty">${mtrOnly ? "MTR 路線搜尋暫未開放，已保留資料架構。" : "搵唔到相關路線。"}</div>`;
  $$("[data-result]").forEach(b => b.addEventListener("click", () => openRoute(matches[Number(b.dataset.result)])));
}

async function openRoute(r) {
  state.selectedRoute = r;
  $("#resultsSection").classList.add("hidden");
  $("#routeSection").classList.remove("hidden");
  await renderRouteDetail();
}
function variants(r) {
  const seen = new Set();
  return normalizedRoutes().filter(x => x.operator === r.operator && String(x.route) === String(r.route))
    .filter(x => { const k = `${x.bound}|${x.routeId || ""}|${x.serviceType}|${x.dest}`; if (seen.has(k)) return false; seen.add(k); return true; });
}
async function renderRouteDetail() {
  const r = state.selectedRoute;
  if (!r) return;
  $("#routeHeader").innerHTML = `<div class="route-title"><div><div class="number">${escapeHtml(r.route)}</div><div class="dest">${escapeHtml(r.orig)} ↔ ${escapeHtml(r.dest)}</div>${operatorBadge(r.operator)}</div></div>`;
  const vv = variants(r);
  $("#directionTabs").innerHTML = vv.slice(0, 6).map((x, i) => `<button data-variant="${i}" class="${x.bound === r.bound && x.dest === r.dest && x.routeId === r.routeId ? "active" : ""}">往 ${escapeHtml(x.dest)}</button>`).join("");
  $$("[data-variant]").forEach(b => b.addEventListener("click", () => { const x = vv[Number(b.dataset.variant)]; if (x) { state.selectedRoute = x; renderRouteDetail(); } }));
  $("#stops").innerHTML = '<div class="loading">正在載入站點及 ETA…</div>';
  try {
    if (r.operator === "KMB") await renderKmbRoute(r);
    else if (r.operator === "CTB") await renderCtbRoute(r);
    else await renderGmbRoute(r);
  } catch (error) {
    $("#stops").innerHTML = `<div class="error">此路線暫時未能載入：${escapeHtml(error.message)}。其他營辦商不受影響。</div>`;
  }
}
async function renderKmbRoute(r) {
  const dir = r.bound === "O" ? "outbound" : "inbound";
  const j = await getJSON(`${KMB_API}/route-stop/${encodeURIComponent(r.route)}/${dir}/${encodeURIComponent(r.serviceType)}`, { ttl:300000 });
  const stops = j.data || [];
  renderStopRows(stops, r, "KMB");
  await parallel(stops, 5, async rs => {
    const j = await getJSON(`${KMB_API}/eta/${encodeURIComponent(rs.stop)}/${encodeURIComponent(r.route)}/${encodeURIComponent(r.serviceType)}`, { ttl:20000 });
    const etas = (j.data || []).filter(x => x.dir === r.bound && Number(x.seq) === Number(rs.seq)).sort((a,b) => Number(a.eta_seq || 99) - Number(b.eta_seq || 99)).slice(0,3);
    fillEta(rs.stop, etas);
  });
}
async function renderCtbRoute(r) {
  const dir = r.bound === "I" ? "inbound" : "outbound";
  const j = await getJSON(`${CTB_API}/route-stop/ctb/${encodeURIComponent(r.route)}/${dir}`, { ttl:300000 });
  const stops = (j.data || []).filter(x => !x.dir || x.dir === r.bound);
  renderStopRows(stops, r, "CTB");
  await parallel(stops, 5, async rs => {
    const j = await getJSON(`${CTB_API}/eta/ctb/${encodeURIComponent(rs.stop)}/${encodeURIComponent(r.route)}`, { ttl:20000 });
    const etas = (j.data || []).filter(x => !r.bound || !x.dir || String(x.dir).toLowerCase() === String(r.bound).toLowerCase()).sort((a,b) => Number(a.eta_seq || 99) - Number(b.eta_seq || 99)).slice(0,3);
    fillEta(rs.stop, etas);
  });
}
async function renderGmbRoute(r) {
  const j = await getJSON(`${GMB_API}/route-stop/${encodeURIComponent(r.routeId)}/${encodeURIComponent(r.routeSeq)}`, { ttl:300000 });
  const stops = (j.data?.route_stops || []).map(s => ({ stop:String(s.stop_id), seq:s.stop_seq, name_tc:s.name_tc }));
  stops.forEach(s => {
    const old = state.gmbStops.get(s.stop) || {};
    state.gmbStops.set(s.stop, { ...old, stop:s.stop, name_tc:s.name_tc || old.name_tc });
  });
  renderStopRows(stops, r, "GMB");
  await parallel(stops, 4, async rs => {
    const j = await getJSON(`${GMB_API}/eta/route-stop/${encodeURIComponent(r.routeId)}/${encodeURIComponent(r.routeSeq)}/${encodeURIComponent(rs.seq)}`, { ttl:20000 });
    const data = j.data || {};
    const etas = data.enabled === false ? [] : (data.eta || []).map(e => ({ eta:e.timestamp, rmk_tc:e.remarks_tc || "", eta_seq:e.eta_seq }));
    fillEta(rs.stop, etas.sort((a,b) => Number(a.eta_seq || 99) - Number(b.eta_seq || 99)).slice(0,3));
  });
}
function renderStopRows(stops, r, op) {
  const stopMap = stopMapFor(op);
  $("#stops").innerHTML = stops.map((rs, i) => {
    const id = String(rs.stop || rs.stop_id);
    const s = stopMap.get(id);
    const stopSeq = Number(rs.seq || rs.stop_seq || i + 1);
    const key = favKey(op, r.route, r.bound, r.serviceType, id, r.routeId, stopSeq);
    const fav = state.favorites.some(f => f.key === key);
    return `<div class="stop-row" data-stop-id="${escapeHtml(id)}"><div class="stop-no">${i+1}</div><div><div class="stop-name">${escapeHtml(s?.name_tc || rs.name_tc || id)}</div><div class="etas"><span class="eta-chip">載入 ETA…</span></div></div><button class="fav-btn" data-fav-stop="${escapeHtml(id)}" data-stop-seq="${stopSeq}" aria-label="收藏此站">${fav ? "★" : "☆"}</button></div>`;
  }).join("");
  $$("[data-fav-stop]").forEach(b => b.addEventListener("click", () => toggleFavorite(r, b.dataset.favStop, op, Number(b.dataset.stopSeq))));
}
function fillEta(stopId, etas) {
  const row = $$(".stop-row").find(x => x.dataset.stopId === String(stopId));
  if (!row) return;
  const box = row.querySelector(".etas");
  box.innerHTML = etas.length ? etas.map((e,i) => `<span class="eta-chip ${i === 0 ? "soon" : ""}">${i === 0 ? "下一班" : `第${i+1}班`} · ${escapeHtml(etaLabel(e.eta))}${e.rmk_tc ? ` · ${escapeHtml(e.rmk_tc)}` : ""}</span>`).join("") : '<span class="eta-chip">未有預報</span>';
}
async function parallel(items, n, fn) {
  const q = [...items];
  await Promise.all(Array.from({ length:Math.min(n, q.length) }, async () => { while (q.length) { const x = q.shift(); try { await fn(x); } catch {} } }));
}
function favKey(op, route, bound, serviceType, stopId, routeId = "", stopSeq = "") { return `${op}|${route}|${bound}|${serviceType}|${routeId}|${stopId}|${stopSeq}`; }
function toggleFavorite(r, stopId, op, stopSeq) {
  const s = stopMapFor(op).get(String(stopId));
  const key = favKey(op, r.route, r.bound, r.serviceType, stopId, r.routeId, stopSeq);
  const idx = state.favorites.findIndex(f => f.key === key);
  if (idx >= 0) state.favorites.splice(idx, 1);
  else state.favorites.push({ key, operator:op, route:r.route, bound:r.bound, serviceType:r.serviceType, routeId:r.routeId || "", routeSeq:r.routeSeq || "", stopSeq, stopId:String(stopId), stopName:s?.name_tc || String(stopId), origin:r.orig, destination:r.dest });
  saveFavorites(); renderFavorites(); renderRouteDetail();
}
async function getFavoriteEtas(f) {
  let data = [];
  if (f.operator === "KMB") {
    const j = await getJSON(`${KMB_API}/eta/${encodeURIComponent(f.stopId)}/${encodeURIComponent(f.route)}/${encodeURIComponent(f.serviceType)}`, { ttl:20000 });
    data = (j.data || []).filter(x => (!x.dir || x.dir === f.bound) && validFutureEta(x.eta));
  } else if (f.operator === "CTB") {
    const j = await getJSON(`${CTB_API}/eta/ctb/${encodeURIComponent(f.stopId)}/${encodeURIComponent(f.route)}`, { ttl:20000 });
    data = (j.data || []).filter(x => (!x.dir || x.dir === f.bound) && validFutureEta(x.eta));
  } else {
    const j = await getJSON(`${GMB_API}/eta/route-stop/${encodeURIComponent(f.routeId)}/${encodeURIComponent(f.routeSeq || f.serviceType)}/${encodeURIComponent(f.stopSeq)}`, { ttl:20000 });
    data = j.data?.enabled === false ? [] : (j.data?.eta || []).map(e => ({ eta:e.timestamp, rmk_tc:e.remarks_tc || "" })).filter(x => validFutureEta(x.eta));
  }
  return data.sort((a,b) => new Date(a.eta) - new Date(b.eta)).slice(0,3);
}
function favoriteWarning(f) {
  const hay = `${f.origin} ${f.destination} ${f.stopName}`;
  return state.warnings.find(w => w.location && hay.includes(w.location));
}
function renderFavorites() {
  if (!state.favorites.length) { $("#favoritesSection").classList.add("hidden"); return; }
  $("#favoritesSection").classList.remove("hidden");
  $("#favorites").innerHTML = state.favorites.map((f,i) => `<article class="favorite-card"><button class="favorite-main" data-fav="${i}"><div class="favorite-top"><strong>${escapeHtml(f.route)}</strong>${operatorBadge(f.operator)}</div><div class="favorite-stop"><strong>${escapeHtml(f.stopName)}</strong> → ${escapeHtml(f.destination)}</div><div class="favorite-etas" data-fav-eta="${i}"><span>正在更新 ETA…</span></div></button><button class="remove-fav" data-remove-fav="${i}" aria-label="移除 ${escapeHtml(f.route)} 收藏">移除</button></article>`).join("");
  $$("[data-fav]").forEach(b => b.addEventListener("click", () => {
    const f = state.favorites[Number(b.dataset.fav)];
    const r = normalizedRoutes().find(x => x.operator === f.operator && String(x.route) === String(f.route) && String(x.bound) === String(f.bound) && (!f.routeId || String(x.routeId) === String(f.routeId)));
    if (r) openRoute(r);
  }));
  $$("[data-remove-fav]").forEach(b => b.addEventListener("click", () => { state.favorites.splice(Number(b.dataset.removeFav), 1); saveFavorites(); renderFavorites(); }));
  state.favorites.forEach(async (f,i) => {
    const box = $(`[data-fav-eta="${i}"]`); if (!box) return;
    try {
      const etas = await getFavoriteEtas(f); if (!box.isConnected) return;
      box.innerHTML = etas.length ? etas.map(e => `<strong>${escapeHtml(etaLabel(e.eta))}</strong>`).join('<span class="eta-sep">｜</span>') : '<span>未有預報</span>';
      const warning = favoriteWarning(f);
      if (warning) box.insertAdjacentHTML("afterend", `<div class="fav-warning">⚠️ 可能受${escapeHtml(warning.location)}${escapeHtml(warning.detail)}影響</div>`);
    } catch { if (box.isConnected) box.innerHTML = '<span>暫時未能更新 ETA</span>'; }
  });
}

// ---------- Nearby 100m ----------
async function locateNearby() {
  if (!navigator.geolocation) { $("#nearbyStatus").textContent = "此瀏覽器不支援定位。"; return; }
  $("#nearbyStatus").textContent = "正在取得位置…"; $("#locateBtn").disabled = true;
  navigator.geolocation.getCurrentPosition(async pos => {
    try {
      const { latitude, longitude } = pos.coords;
      $("#nearbyStatus").textContent = "定位成功，搜尋 100m 內車站…";
      const nearbyStops = [];
      for (const [operator, map] of [["KMB",state.kmbStops],["CTB",state.ctbStops],["GMB",state.gmbStops]]) {
        const candidates = [];
        for (const [id,s] of map) {
          const lon = Number(s.long ?? s.lng ?? s.longitude), lat = Number(s.lat ?? s.latitude);
          const d = distanceMeters(latitude, longitude, lat, lon);
          if (Number.isFinite(d) && d <= 100) candidates.push({ operator, stop:String(id), stopObj:s, distance:d });
        }
        candidates.sort((a,b) => a.distance - b.distance);
        nearbyStops.push(...candidates.slice(0, 15));
      }
      await loadNearbyEtas(nearbyStops);
      $("#nearbyStatus").textContent = "已搜尋 100m 範圍。";
    } catch (error) { $("#nearbyStatus").textContent = `附近資料載入失敗：${error.message}`; }
    finally { $("#locateBtn").disabled = false; }
  }, error => {
    $("#nearbyStatus").textContent = error.code === 1 ? "你未允許定位；可以喺瀏覽器設定開啟。" : "暫時無法取得位置。";
    $("#locateBtn").disabled = false;
  }, { enableHighAccuracy:true, timeout:12000, maximumAge:30000 });
}
async function loadNearbyEtas(stops) {
  state.nearby = [];
  await parallel(stops, 4, async s => {
    let rows = [];
    try {
      if (s.operator === "KMB") {
        const j = await getJSON(`${KMB_API}/stop-eta/${encodeURIComponent(s.stop)}`, { ttl:20000 });
        rows = (j.data || []).slice(0, 40).map(x => ({ operator:"KMB", route:x.route, dest:x.dest_tc || "", eta:x.eta, remark:x.rmk_tc || "", distance:s.distance, stopId:s.stop, stopName:s.stopObj.name_tc || "" }));
      } else if (s.operator === "CTB") {
        let j;
        try { j = await getJSON(`https://rt.data.gov.hk/v1/transport/batch/stop-eta/CTB/${encodeURIComponent(s.stop)}`, { ttl:20000 }); }
        catch {
          const sr = await getJSON(`https://rt.data.gov.hk/v1.1/transport/batch/stop-route/CTB/${encodeURIComponent(s.stop)}`, { ttl:300000 });
          const routes = [...new Set((sr.data || []).map(x => x.route).filter(Boolean))].slice(0, 15), temp = [];
          await parallel(routes, 3, async route => { try { const e = await getJSON(`${CTB_API}/eta/ctb/${encodeURIComponent(s.stop)}/${encodeURIComponent(route)}`, { ttl:20000 }); temp.push(...(e.data || [])); } catch {} });
          j = { data:temp };
        }
        rows = (j.data || []).slice(0, 50).map(x => ({ operator:"CTB", route:x.route, dest:x.dest_tc || "", eta:x.eta, remark:x.rmk_tc || "", distance:s.distance, stopId:s.stop, stopName:s.stopObj.name_tc || "" }));
      } else {
        const j = await getJSON(`${GMB_API}/eta/stop/${encodeURIComponent(s.stop)}`, { ttl:20000 });
        for (const occurrence of j.data || []) {
          if (occurrence.enabled === false) continue;
          const route = state.gmbRoutes.find(r => String(r.routeId) === String(occurrence.route_id) && Number(r.routeSeq) === Number(occurrence.route_seq));
          for (const e of occurrence.eta || []) rows.push({ operator:"GMB", route:route?.route || s.stopObj.routes?.find(x => String(x.routeId) === String(occurrence.route_id))?.route || "小巴", dest:route?.dest || "", eta:e.timestamp, remark:e.remarks_tc || "", distance:s.distance, stopId:s.stop, stopName:s.stopObj.name_tc || "" });
        }
      }
    } catch { return; }
    state.nearby.push(...rows.filter(x => validFutureEta(x.eta)));
  });
  const seen = new Set();
  state.nearby = state.nearby.sort((a,b) => new Date(a.eta) - new Date(b.eta)).filter(x => {
    const key = [x.operator,x.route,x.eta,x.stopId,x.dest].join("|");
    if (seen.has(key)) return false; seen.add(key); return true;
  });
  state.nearbyExpanded = false; renderNearby();
}
function renderNearby() {
  const all = state.nearby.filter(x => state.nearbyFilter === "all" || x.operator === state.nearbyFilter);
  const list = all.slice(0, state.nearbyExpanded ? MAX_NEARBY_COUNT : SHORT_NEARBY_COUNT);
  $("#nearbySection").classList.remove("hidden");
  $("#nearbyCount").textContent = `共 ${all.length} 個即將班次`;
  $("#nearbyResults").innerHTML = list.length ? list.map(x => `<div class="near-card"><div>${operatorBadge(x.operator)}</div><div><div class="near-route">${escapeHtml(x.route)}</div><div class="near-dest">→ ${escapeHtml(x.dest || "目的地")}</div><div class="near-meta">${escapeHtml(x.stopName)} · ${Math.round(x.distance)}m</div></div><div class="near-eta">${escapeHtml(etaLabel(x.eta))}</div></div>`).join("") : '<div class="empty">100m 內暫時未有可顯示 ETA。</div>';
  const canToggle = all.length > SHORT_NEARBY_COUNT;
  $("#nearbyMore").classList.toggle("hidden", !canToggle);
  $("#nearbyCollapseTop").classList.toggle("hidden", !canToggle || !state.nearbyExpanded);
  $("#nearbyMore").textContent = state.nearbyExpanded ? "收起 ↑" : "顯示更多 ↓";
}
function toggleNearby() {
  state.nearbyExpanded = !state.nearbyExpanded; renderNearby();
  if (!state.nearbyExpanded) $("#nearbySection").scrollIntoView({ behavior:"smooth", block:"start" });
}

// ---------- Traffic warning ----------
async function loadTrafficWarning() {
  try {
    let res;
    try { res = await fetch(TD_TRAFFIC, { headers:{ Accept:"application/xml,text/xml" } }); if (!res.ok) throw new Error(); }
    catch { res = await fetch(TRAFFIC_PROXY, { headers:{ Accept:"application/xml,text/xml" } }); if (!res.ok) throw new Error(); }
    const text = await res.text(), xml = new DOMParser().parseFromString(text, "text/xml"), val = (n,k) => n.querySelector(k)?.textContent?.trim() || "";
    const cache = JSON.parse(localStorage.getItem("daozhan_warning_first_seen") || "{}");
    state.warnings = [...xml.querySelectorAll("message")].map(n => {
      const id = val(n,"INCIDENT_NUMBER") || val(n,"ID"), updated = val(n,"ANNOUNCEMENT_DATE");
      cache[id] = cache[id] && new Date(cache[id]) < new Date(updated) ? cache[id] : updated;
      return { id, heading:val(n,"INCIDENT_HEADING_CN"), detail:val(n,"INCIDENT_DETAIL_CN"), location:val(n,"LOCATION_CN"), direction:val(n,"DIRECTION_CN"), first:cache[id], updated, status:val(n,"INCIDENT_STATUS_CN"), content:val(n,"CONTENT_CN") };
    }).filter(w => w.status && /封閉|受阻|擠塞|事故|意外|水浸|塌|火警|改道|暫停/.test(`${w.heading}${w.detail}${w.content}`) && !/解封|取消|恢復正常|重開|回復正常/.test(`${w.status}${w.content}`));
    localStorage.setItem("daozhan_warning_first_seen", JSON.stringify(cache));
    const w = state.warnings[0];
    if (w) {
      const mins = Math.max(0, Math.floor((Date.now() - new Date(w.first).getTime()) / 60000));
      $("#warning-text").innerHTML = `<strong>${escapeHtml(w.location || w.heading)}${w.direction ? `｜${escapeHtml(w.direction)}方向` : ""}${w.detail ? ` ${escapeHtml(w.detail)}` : ""}</strong><p>${escapeHtml(w.content)}</p>`;
      $("#warning-meta").innerHTML = `<div>運輸署發布：${formatTime(w.first)}　最新更新：${formatTime(w.updated)}</div><div>已發布／持續 ${mins} 分鐘　狀態：${escapeHtml(w.status || "已發布")}</div><div>資料來源：運輸署特別交通消息</div>`;
      $("#traffic-warning").classList.remove("hidden"); renderFavorites();
    }
  } catch { /* Warning failure must never block ETA. */ }
}
function formatTime(v) { return v ? new Intl.DateTimeFormat("zh-HK", { hour:"2-digit", minute:"2-digit", hour12:false }).format(new Date(v)) : "—"; }

$("#searchBtn").addEventListener("click", renderSearch);
$("#routeSearch").addEventListener("keydown", e => { if (e.key === "Enter") renderSearch(); });
$("#routeSearch").addEventListener("input", () => { if ($("#routeSearch").value.trim().length >= 2) renderSearch(); });
$("#backBtn").addEventListener("click", () => { $("#routeSection").classList.add("hidden"); $("#resultsSection").classList.remove("hidden"); });
$("#clearFavs").addEventListener("click", () => { state.favorites = []; saveFavorites(); renderFavorites(); });
$("#locateBtn").addEventListener("click", locateNearby);
$("#nearbyMore").addEventListener("click", toggleNearby);
$("#nearbyCollapseTop").addEventListener("click", toggleNearby);
$$("[data-near-filter]").forEach(b => b.addEventListener("click", () => { state.nearbyFilter = b.dataset.nearFilter; state.nearbyExpanded = false; $$("[data-near-filter]").forEach(x => x.classList.toggle("active", x === b)); renderNearby(); }));
$$("[data-search-filter]").forEach(b => b.addEventListener("click", () => { state.searchFilter = b.dataset.searchFilter; $$("[data-search-filter]").forEach(x => x.classList.toggle("active", x === b)); if ($("#routeSearch").value.trim()) renderSearch(); }));

if ("serviceWorker" in navigator) navigator.serviceWorker.register("sw.js").catch(() => {});
bootstrap();
