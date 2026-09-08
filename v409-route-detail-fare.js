(() => {
  "use strict";
  const VERSION = "4.0.9";

  // Safe Boot removed the old helper stack, but app.js route-detail still calls parallel().
  // Restore one small bounded helper instead of loading the legacy routing wrappers again.
  window.parallel = async function parallel(items, limit, worker) {
    const list = Array.from(items || []);
    const n = Math.max(1, Math.min(Number(limit) || 1, 6));
    let next = 0;
    async function run() {
      while (next < list.length) {
        const i = next++;
        try { await worker(list[i], i); } catch (_) {}
        if ((i & 7) === 7) await new Promise(r => setTimeout(r, 0));
      }
    }
    await Promise.all(Array.from({ length: Math.min(n, list.length) }, run));
  };

  // Full-fare lookup is deliberately lazy: nearby ETA renders first; fare data loads afterwards.
  // This keeps the nearby search responsive and avoids bringing fare data into the boot path.
  const fareIndexes = new Map();
  const farePromises = new Map();
  const routeXml = {
    BUS: "https://static.data.gov.hk/td/routes-fares-xml/ROUTE_BUS.xml",
    GMB: "https://static.data.gov.hk/td/routes-fares-xml/ROUTE_GMB.xml"
  };
  const txt = (n, tag) => n.querySelector(tag)?.textContent?.trim() || "";
  const norm = v => String(v || "").trim().toUpperCase();

  async function fareIndex(kind) {
    if (fareIndexes.has(kind)) return fareIndexes.get(kind);
    if (farePromises.has(kind)) return farePromises.get(kind);
    const p = (async () => {
      const res = await fetch(routeXml[kind], { cache: "force-cache" });
      if (!res.ok) throw new Error(`Fare HTTP ${res.status}`);
      const xml = new DOMParser().parseFromString(await res.text(), "text/xml");
      const index = new Map();
      for (const n of xml.querySelectorAll("*")) {
        if (!n.children || n.children.length < 4) continue;
        const route = txt(n, "ROUTE_NAMEC") || txt(n, "ROUTE_NAMEE");
        const fareRaw = txt(n, "FULL_FARE");
        if (!route || !fareRaw) continue;
        const fare = Number(String(fareRaw).replace(/[^0-9.]/g, ""));
        if (!Number.isFinite(fare) || fare <= 0) continue;
        const company = norm(txt(n, "COMPANY_CODE"));
        const key = `${company}|${norm(route)}`;
        if (!index.has(key) || fare < index.get(key)) index.set(key, fare);
        const anyKey = `*|${norm(route)}`;
        if (!index.has(anyKey) || fare < index.get(anyKey)) index.set(anyKey, fare);
      }
      fareIndexes.set(kind, index);
      return index;
    })().finally(() => farePromises.delete(kind));
    farePromises.set(kind, p);
    return p;
  }

  async function fullFare(operator, route) {
    const kind = operator === "GMB" ? "GMB" : "BUS";
    const index = await fareIndex(kind);
    const companies = operator === "KMB" ? ["KMB", "LWB"] : operator === "CTB" ? ["CTB"] : ["GMB"];
    for (const c of companies) {
      const v = index.get(`${c}|${norm(route)}`);
      if (Number.isFinite(v)) return v;
    }
    return index.get(`*|${norm(route)}`) ?? null;
  }
  window.dzFullFare409 = fullFare;

  function fareText(v) {
    return Number.isFinite(v) ? `全程 $${Number(v).toFixed(Number(v) % 1 ? 1 : 0)}` : "車費 —";
  }

  async function fillVisibleNearbyFares() {
    const nodes = [...document.querySelectorAll("[data-near-fare-route]")];
    const jobs = new Map();
    for (const el of nodes) {
      const op = el.dataset.nearFareOp;
      const route = el.dataset.nearFareRoute;
      const key = `${op}|${route}`;
      if (!jobs.has(key)) jobs.set(key, fullFare(op, route).catch(() => null));
      jobs.get(key).then(v => { if (el.isConnected) el.textContent = fareText(v); });
    }
  }

  // Replace only the nearby renderer. Search/radius logic remains untouched.
  window.renderNearby = function renderNearby409() {
    const all = state.nearby.filter(x => state.nearbyFilter === "all" || x.operator === state.nearbyFilter);
    const list = all.slice(0, state.nearbyExpanded ? MAX_NEARBY_COUNT : SHORT_NEARBY_COUNT);
    $("#nearbySection").classList.remove("hidden");
    $("#nearbyCount").textContent = `共 ${all.length} 個即將班次`;
    $("#nearbyResults").innerHTML = list.length ? list.map(x => `<div class="near-card"><div>${operatorBadge(x.operator)}</div><div><div class="near-route">${escapeHtml(x.route)}</div><div class="near-dest">→ ${escapeHtml(x.dest || "目的地")}</div><div class="near-meta">${escapeHtml(x.stopName)} · ${Math.round(x.distance)}m</div></div><div class="near-fare" data-near-fare-op="${escapeHtml(x.operator)}" data-near-fare-route="${escapeHtml(x.route)}">車費…</div><div class="near-eta">${escapeHtml(etaLabel(x.eta))}</div></div>`).join("") : '<div class="empty">附近暫時未有可顯示 ETA。</div>';
    const canToggle = all.length > SHORT_NEARBY_COUNT;
    $("#nearbyMore").classList.toggle("hidden", !canToggle);
    $("#nearbyCollapseTop").classList.toggle("hidden", !canToggle || !state.nearbyExpanded);
    $("#nearbyMore").textContent = state.nearbyExpanded ? "收起 ↑" : "顯示更多 ↓";
    setTimeout(fillVisibleNearbyFares, 0);
  };

  const style = document.createElement("style");
  style.textContent = `.near-card{grid-template-columns:auto minmax(0,1fr) auto auto}.near-fare{align-self:center;white-space:nowrap;color:#c9ccd3;font-size:.9rem;font-weight:700;margin:0 8px}.near-eta{white-space:nowrap}@media(max-width:430px){.near-fare{font-size:.82rem;margin:0 4px}}`;
  document.head.appendChild(style);
})();