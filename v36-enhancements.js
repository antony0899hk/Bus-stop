(() => {
  "use strict";

  const OP_PRIORITY = { KMB:0, CTB:1, GMB:2, MTR:3, NLB:4 };
  const WALK_METERS_PER_MIN = 78;
  const SMART_RADII = [300,500,800,1000];
  const QUICK_KEY = "daozhan.quickPlaces.v3";
  const RECENT_KEY = "daozhan.journeyRecent.v1";

  const esc = v => (typeof escapeHtml === "function" ? escapeHtml(v) : String(v ?? ""));
  const opPriority = op => OP_PRIORITY[String(op || "").toUpperCase()] ?? 99;
  window.dzOperatorPriority = opPriority;
  window.dzSmartJourneyRadii = SMART_RADII.slice();

  function walkText(meters) {
    const m = Math.max(0, Number(meters) || 0);
    const mins = Math.max(1, Math.round(m / WALK_METERS_PER_MIN));
    return `🚶 ${m >= 1000 ? `${(m/1000).toFixed(1)}km` : `${Math.round(m)}m`} · 約 ${mins} 分鐘`;
  }
  window.dzWalkText = walkText;

  if (typeof resolvePlace === "function" && typeof allJourneyStops === "function" && typeof distanceMeters === "function") {
    const baseResolvePlace = resolvePlace;
    resolvePlace = function(value, location = null) {
      if (!location) return baseResolvePlace(value, null);
      const candidates = allJourneyStops()
        .filter(s => Number.isFinite(s.lat) && Number.isFinite(s.lon))
        .map(s => ({ ...s, distance: distanceMeters(location.lat, location.lon, s.lat, s.lon) }))
        .sort((a,b) => a.distance - b.distance);
      let chosen = SMART_RADII[SMART_RADII.length - 1];
      for (const radius of SMART_RADII) {
        const count = candidates.filter(s => s.distance <= radius).length;
        chosen = radius;
        if (count >= 8 || (radius >= 500 && count >= 4)) break;
      }
      window.dzJourneyResolvedRadius = chosen;
      return candidates.filter(s => s.distance <= chosen).slice(0, 28);
    };
  }

  if (typeof routeMatches === "function") {
    const baseRouteMatches = routeMatches;
    routeMatches = function(q) {
      const rows = baseRouteMatches(q);
      if (typeof state === "undefined" || state.searchFilter !== "all") return rows;
      const normalizedQ = String(q || "").trim().toUpperCase();
      return rows.sort((a,b) => {
        const ae = String(a.route || "").toUpperCase() === normalizedQ ? 0 : 1;
        const be = String(b.route || "").toUpperCase() === normalizedQ ? 0 : 1;
        return ae - be || opPriority(a.operator) - opPriority(b.operator) ||
          String(a.route).localeCompare(String(b.route), undefined, {numeric:true});
      });
    };
  }

  if (typeof renderNearby === "function") {
    const baseRenderNearby = renderNearby;
    renderNearby = function() {
      if (typeof state !== "undefined" && Array.isArray(state.nearby)) {
        state.nearby = state.nearby
          .filter(x => x && x.eta && (typeof validFutureEta !== "function" || validFutureEta(x.eta)))
          .sort((a,b) => new Date(a.eta) - new Date(b.eta) || opPriority(a.operator) - opPriority(b.operator));
      }
      return baseRenderNearby();
    };
  }

  if (typeof fillEta === "function") {
    fillEta = function(stopId, etas) {
      const row = [...document.querySelectorAll(".stop-row")].find(x => x.dataset.stopId === String(stopId));
      if (!row) return;
      const box = row.querySelector(".etas");
      if (!box) return;
      box.innerHTML = etas.length ? etas.map((e,i) => {
        const stamp = e?.eta || "";
        const label = stamp && typeof etaLabel === "function" ? etaLabel(stamp) : "未有預報";
        return `<span class="eta-chip ${i===0?"soon":""}" data-live-eta="${esc(stamp)}">${i===0?"下一班":`第${i+1}班`} · <span class="eta-live-label">${esc(label)}</span>${e?.rmk_tc?` · ${esc(e.rmk_tc)}`:""}</span>`;
      }).join("") : '<span class="eta-chip">未有預報</span>';
    };
  }

  function effectiveFare(r) {
    if (Number.isFinite(Number(r?.discountedFare))) return Number(r.discountedFare);
    if (Number.isFinite(Number(r?.fare))) return Number(r.fare);
    if (Array.isArray(r?.legFares)) {
      const valid = r.legFares.map(Number).filter(Number.isFinite);
      if (valid.length === r.legFares.length) return valid.reduce((a,b)=>a+b,0) - (Number(r.transferDiscount)||0);
    }
    return null;
  }

  if (typeof journeyScore === "function") {
    journeyScore = function(r) {
      const etaM = r.eta && typeof etaMinutes === "function" ? etaMinutes(r.eta) : 30;
      const transferCount = Number(r.transferCount || 0);
      const stopCount = Number(r.stopCount || 0);
      const walkMeters = Number(r.walkMeters || 0);
      let score;
      if (journeyState.mode === "walking") score = walkMeters + transferCount * 150;
      else if (journeyState.mode === "transfers") score = transferCount * 10000 + stopCount * 10 + etaM;
      else if (journeyState.mode === "cheapest") {
        const fare = effectiveFare(r);
        score = fare == null ? 99999 : fare * 100 + transferCount * 20;
      } else score = etaM * 4 + stopCount * 2 + transferCount * 15 + Math.round(walkMeters / 80);
      const op = r.kind === "transfer" ? r.first?.operator : r.operator;
      return score * 100 + opPriority(op);
    };
  }

  async function fetchLegEta(leg, stopId) {
    try {
      const op = leg.operator;
      if (op === "KMB") {
        const j = await getJSON(`${KMB_API}/eta/${encodeURIComponent(stopId)}/${encodeURIComponent(leg.route)}/${encodeURIComponent(leg.serviceType || "1")}`, {ttl:0,retries:0});
        const rows=(j.data||[]).filter(x => (!leg.bound || !x.dir || x.dir===leg.bound) && validFutureEta(x.eta)).sort((a,b)=>new Date(a.eta)-new Date(b.eta));
        return rows[0]?.eta || null;
      }
      if (op === "CTB") {
        const j = await getJSON(`${CTB_API}/eta/ctb/${encodeURIComponent(stopId)}/${encodeURIComponent(leg.route)}`, {ttl:0,retries:0});
        const rows=(j.data||[]).filter(x => (!leg.bound || !x.dir || String(x.dir).toUpperCase()===String(leg.bound).toUpperCase()) && validFutureEta(x.eta)).sort((a,b)=>new Date(a.eta)-new Date(b.eta));
        return rows[0]?.eta || null;
      }
    } catch {}
    return null;
  }

  async function verifyTransfer(r) {
    if (!r || r.kind !== "transfer" || r._dzVerified) return;
    r._dzVerified = true;
    const [firstEta, secondEta] = await Promise.all([
      fetchLegEta(r.first, r.first?.originStop?.id),
      fetchLegEta(r.second, r.transferStopId)
    ]);
    r.firstEta = firstEta;
    r.secondEta = secondEta;
    r.eta = firstEta && secondEta ? firstEta : null;

    if (r.eta && typeof journeyFare === "function") {
      try {
        const firstPseudo = {kind:"direct", operator:r.first.operator, route:r.first.route, bound:r.first.bound, serviceType:r.first.serviceType, originPos:0};
        const secondPseudo = {kind:"direct", operator:r.second.operator, route:r.second.route, bound:r.second.bound, serviceType:r.second.serviceType, originPos:0};
        const fares = await Promise.all([journeyFare(firstPseudo), journeyFare(secondPseudo)]);
        if (fares.every(x => Number.isFinite(Number(x)))) r.legFares = fares.map(Number);
      } catch {}
    }
  }

  function journeyList() {
    if (typeof journeyState === "undefined" || !Array.isArray(journeyState.results)) return [];
    return [...journeyState.results]
      .filter(r => r.kind === "transfer" ? !!(r.firstEta && r.secondEta) : !!r.eta)
      .sort((a,b) => journeyScore(a) - journeyScore(b))
      .slice(0,12);
  }

  if (typeof renderJourneyResults === "function") {
    renderJourneyResults = function() {
      const box = document.querySelector("#journeyResults");
      if (!box) return;
      const list = journeyList();
      if (!list.length) {
        box.innerHTML = '<div class="empty">暫時未有可確認正在服務嘅方案；系統會自動由 300m 擴大至最多 1km 搜尋附近車站。</div>';
        return;
      }
      box.innerHTML = list.map((r,i) => {
        const walk = r.walkMeters ? ` · ${walkText(r.walkMeters)}` : "";
        if (r.kind === "transfer") {
          const transferMap = r.first.operator === "KMB" ? state.kmbStops : state.ctbStops;
          const transferName = journeyStopName(transferMap.get(String(r.transferStopId))) || "轉車站";
          const fare = effectiveFare(r);
          const discount = Number(r.transferDiscount || 0);
          const fareText = fare != null ? ` · 總車費 $${fare.toFixed(1)}` : "";
          const discountButton = discount > 0 ? `<button class="journey-discount" type="button" data-discount-detail="${i}">↔$ 優惠</button>` : "";
          return `<article class="journey-card"><div class="journey-rank">${i+1}</div><div class="journey-main"><div class="journey-lines"><span>${routeBadge(r.first.operator)} <strong>${esc(r.first.route)}</strong></span><span class="arrow">→</span><span>${routeBadge(r.second.operator)} <strong>${esc(r.second.route)}</strong></span></div><div class="journey-title">${esc(stopLabel(r.first.originStop))} → ${esc(transferName)} → ${esc(stopLabel(r.second.destinationStop))}</div><div class="journey-meta">轉 1 次 · 約 ${r.stopCount} 個站${walk}${fareText} ${discountButton}</div><div class="journey-note">兩段均已確認有當前 ETA；轉乘時間仍屬 Beta 估算。</div></div></article>`;
        }
        const fare = effectiveFare(r);
        return `<article class="journey-card"><div class="journey-rank">${i+1}</div><div class="journey-main"><div class="journey-top"><div>${routeBadge(r.operator)} <strong class="journey-route">${esc(r.route)}</strong></div><div class="journey-eta" data-live-eta="${esc(r.eta)}">${esc(etaLabel(r.eta))}</div></div><div class="journey-title">${esc(stopLabel(r.originStop))} → ${esc(stopLabel(r.destinationStop))}</div><div class="journey-meta">直達 · 約 ${r.stopCount} 個站${walk}${fare != null ? ` · 車費 $${fare.toFixed(1)}` : ""}</div><div class="journey-note">${esc(r.meta?.dest ? `往 ${r.meta.dest}` : "")}</div></div></article>`;
      }).join("");
    };
  }

  const routeFareCache = new Map();
  async function fareMapForRoute(r) {
    if (!r || typeof loadFareXml !== "function" || typeof routeFareRecords !== "function" || typeof buildFareMap !== "function") return null;
    const key = `${r.operator}|${r.route}|${r.bound || ""}`;
    if (routeFareCache.has(key)) return routeFareCache.get(key);
    const promise = (async () => {
      try {
        const xml = await loadFareXml(r.operator);
        const records = routeFareRecords(xml, {operator:r.operator, route:r.route, bound:r.bound});
        if (!records.length) return null;
        return { records, map:buildFareMap(records) };
      } catch { return null; }
    })();
    routeFareCache.set(key, promise);
    return promise;
  }

  async function decorateSearchFares() {
    if (typeof routeMatches !== "function" || typeof state === "undefined") return;
    const input = document.querySelector("#routeSearch");
    const cards = [...document.querySelectorAll("#results .route-card")];
    if (!input || !cards.length) return;
    const rows = routeMatches(input.value);
    await Promise.all(cards.map(async (card,i) => {
      const r = rows[i]; if (!r || ["MTR","NLB"].includes(r.operator)) return;
      const data = await fareMapForRoute(r); if (!data || !card.isConnected) return;
      const fares = [...data.map.values()].map(Number).filter(Number.isFinite);
      if (!fares.length) return;
      const full = data.map.get(1) ?? Math.max(...fares);
      const info = card.querySelector(".route-info"); if (!info || info.querySelector(".dz-route-fare")) return;
      info.insertAdjacentHTML("beforeend", `<div class="route-sub dz-route-fare">全程車費 $${Number(full).toFixed(1)}</div>`);
    }));
  }

  async function decorateRouteDetailFares() {
    if (typeof state === "undefined" || !state.selectedRoute) return;
    const r = state.selectedRoute;
    if (["MTR","NLB"].includes(r.operator)) return;
    const data = await fareMapForRoute(r); if (!data) return;
    const fares = [...data.map.values()].map(Number).filter(Number.isFinite);
    if (fares.length) {
      const full = data.map.get(1) ?? Math.max(...fares);
      const header = document.querySelector("#routeHeader .route-title");
      if (header && !header.querySelector(".dz-header-fare")) {
        header.insertAdjacentHTML("beforeend", `<div class="dz-header-fare">全程 $${Number(full).toFixed(1)}</div>`);
      }
    }
    [...document.querySelectorAll("#stops .stop-row")].forEach((row,i) => {
      const fare = data.map.get(i+1);
      const name = row.querySelector(".stop-name");
      if (name && fare != null && !row.querySelector(".dz-stop-fare")) {
        name.insertAdjacentHTML("afterend", `<div class="dz-stop-fare">由此站上車 $${Number(fare).toFixed(1)}</div>`);
      }
    });
  }

  if (typeof renderSearch === "function") {
    const baseRenderSearch = renderSearch;
    renderSearch = function() {
      const v = baseRenderSearch();
      Promise.resolve().then(decorateSearchFares);
      return v;
    };
  }

  if (typeof renderRouteDetail === "function") {
    const baseRenderRouteDetail = renderRouteDetail;
    renderRouteDetail = async function() {
      const v = await baseRenderRouteDetail();
      await decorateRouteDetailFares();
      return v;
    };
  }

  async function enrichTransfers() {
    if (typeof journeyState === "undefined" || !Array.isArray(journeyState.results)) return;
    const pending = journeyState.results.filter(r => r.kind === "transfer" && !r._dzVerified).slice(0,8);
    if (!pending.length) return;
    await Promise.all(pending.map(verifyTransfer));
    if (typeof renderJourneyResults === "function") renderJourneyResults();
  }

  function updateLiveLabels() {
    document.querySelectorAll("[data-live-eta]").forEach(el => {
      const stamp = el.getAttribute("data-live-eta");
      if (!stamp || typeof etaLabel !== "function") return;
      const target = el.querySelector(".eta-live-label") || el;
      target.textContent = etaLabel(stamp);
    });
  }

  let refreshing = false;
  async function refreshVisibleJourneyEtas() {
    if (refreshing || document.hidden || typeof journeyState === "undefined") return;
    if (!document.querySelector("#journeyResults .journey-card")) return;
    refreshing = true;
    try {
      const direct = journeyState.results.filter(r => r.kind === "direct").slice(0,12);
      await Promise.all(direct.map(async r => { r.eta = await journeyEta(r); }));
      journeyState.results.filter(r => r.kind === "transfer").forEach(r => { r._dzVerified = false; });
      await enrichTransfers();
      if (typeof renderJourneyResults === "function") renderJourneyResults();
    } finally { refreshing = false; }
  }

  function cleanupQuickRecent() {
    const box = document.querySelector("#journeyRecentPlaces");
    if (!box) return;
    let places = [], recent = [];
    try { places = JSON.parse(localStorage.getItem(QUICK_KEY) || "[]") || []; } catch {}
    try { recent = JSON.parse(localStorage.getItem(RECENT_KEY) || "[]") || []; } catch {}

    const customs = places.filter(p => !["home","office"].includes(p.id)).slice(0,6);
    if (places.filter(p => !["home","office"].includes(p.id)).length > 6) {
      const fixed = places.filter(p => ["home","office"].includes(p.id));
      localStorage.setItem(QUICK_KEY, JSON.stringify([...fixed, ...customs]));
    }
    const blocked = new Set(customs.flatMap(p => [String(p.label||"").trim().toLowerCase(), String(p.value||"").trim().toLowerCase()]).filter(Boolean));
    const cleanRecent = [];
    for (const v of recent) {
      const t = String(v||"").trim();
      const key = t.toLowerCase();
      if (!t || blocked.has(key) || cleanRecent.some(x => x.toLowerCase() === key)) continue;
      cleanRecent.push(t);
      if (cleanRecent.length >= 3) break;
    }

    const parts = [];
    if (customs.length) parts.push('<span class="recent-label">快捷：</span>' + customs.map(p => `<button type="button" class="journey-recent-btn custom-quick" data-quick="${esc(p.id)}">${esc(p.label)}</button>`).join(""));
    if (cleanRecent.length) parts.push('<span class="recent-label">最近：</span>' + cleanRecent.map(v => `<button type="button" class="journey-recent-btn" data-recent="${esc(v)}">${esc(v)}</button>`).join(""));
    const html = parts.join("");
    if (box.innerHTML !== html) box.innerHTML = html;
    box.classList.toggle("hidden", !parts.length);
  }

  function installSmartRangeLabel() {
    const planner = document.querySelector(".journey-planner");
    const modes = document.querySelector(".journey-mode-row");
    if (!planner || !modes || document.querySelector("#journeySmartRange")) return;
    const div = document.createElement("div");
    div.id = "journeySmartRange";
    div.className = "journey-smart-range";
    div.textContent = "🚶 智能步行範圍：300m → 500m → 800m → 1km";
    modes.insertAdjacentElement("beforebegin", div);
  }

  const observer = new MutationObserver(() => {
    cleanupQuickRecent();
    installSmartRangeLabel();
    if (document.querySelector("#journeyResults .journey-card")) enrichTransfers();
  });

  function boot() {
    cleanupQuickRecent();
    installSmartRangeLabel();
    observer.observe(document.documentElement, {subtree:true, childList:true});
    setInterval(updateLiveLabels, 15000);
    setInterval(refreshVisibleJourneyEtas, 60000);
    document.addEventListener("visibilitychange", () => { if (!document.hidden) { updateLiveLabels(); refreshVisibleJourneyEtas(); } });
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot, {once:true});
  else boot();
})();