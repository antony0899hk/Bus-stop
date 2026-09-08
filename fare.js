(() => {
  "use strict";

  const ROUTE_BUS = "https://static.data.gov.hk/td/routes-fares-xml/ROUTE_BUS.xml";
  const ROUTE_GMB = "https://static.data.gov.hk/td/routes-fares-xml/ROUTE_GMB.xml";
  const BUS_FARE = "https://static.data.gov.hk/td/routes-fares-xml/FARE_BUS.xml";
  const GMB_FARE = "https://static.data.gov.hk/td/routes-fares-xml/FARE_GMB.xml";
  const cache = new Map();

  // Safe Boot removed the old helper stack. Keep a tiny bounded helper here so
  // route ETA rendering never depends on legacy scripts.
  if (typeof window.parallel !== "function") {
    window.parallel = async function parallel(items, limit, worker) {
      const list = Array.from(items || []);
      let cursor = 0;
      const n = Math.max(1, Math.min(Number(limit) || 4, 6, list.length || 1));
      async function run() {
        while (cursor < list.length) {
          const i = cursor++;
          try { await worker(list[i], i); } catch {}
        }
      }
      await Promise.all(Array.from({ length:n }, run));
    };
  }

  async function loadXml(url) {
    if (cache.has(url)) return cache.get(url);
    const p = fetch(url, { cache:"force-cache" }).then(r => {
      if (!r.ok) throw new Error(`Fare HTTP ${r.status}`);
      return r.text();
    }).then(text => {
      const xml = new DOMParser().parseFromString(text, "text/xml");
      if (xml.querySelector("parsererror")) throw new Error("Fare XML parse error");
      return xml;
    }).catch(err => { cache.delete(url); throw err; });
    cache.set(url, p);
    return p;
  }

  function textOf(node, names) {
    for (const name of names) {
      const el = node.querySelector(name);
      const v = el?.textContent?.trim();
      if (v) return v;
    }
    return "";
  }

  function norm(v) {
    return String(v || "").replace(/[()（）\s,，.．·・\-]/g, "").toUpperCase();
  }

  function companyMatches(code, op) {
    code = String(code || "").toUpperCase();
    if (op === "KMB") return code.includes("KMB") || code.includes("LWB");
    if (op === "CTB") return code.includes("CTB");
    if (op === "GMB") return code.includes("GMB");
    return true;
  }

  async function routeMeta(ctx = {}) {
    const op = ctx.operator || "KMB";
    const xml = await loadXml(op === "GMB" ? ROUTE_GMB : ROUTE_BUS);
    const route = norm(ctx.route);
    if (!route) return null;
    const orig = norm(ctx.orig), dest = norm(ctx.dest);
    let best = null, bestScore = -1;

    // ROUTE_ID elements are one-per-record and avoid walking every XML node.
    for (const idEl of xml.querySelectorAll("ROUTE_ID")) {
      const n = idEl.parentElement;
      if (!n) continue;
      const name = norm(textOf(n, ["ROUTE_NAMEC","ROUTE_NAMEE"]));
      if (name !== route) continue;
      const company = textOf(n, ["COMPANY_CODE"]);
      if (!companyMatches(company, op)) continue;
      const start = norm(textOf(n, ["LOC_START_NAMEC","LOC_START_NAMEE"]));
      const end = norm(textOf(n, ["LOC_END_NAMEC","LOC_END_NAMEE"]));
      let score = 1;
      if (orig && (start.includes(orig) || orig.includes(start))) score += 3;
      if (dest && (end.includes(dest) || dest.includes(end))) score += 3;
      if (orig && (end.includes(orig) || orig.includes(end))) score -= 1;
      const fare = Number(String(textOf(n, ["FULL_FARE"])).replace(/[^0-9.]/g, ""));
      if (score > bestScore && Number.isFinite(fare) && fare > 0) {
        bestScore = score;
        best = { routeId:textOf(n,["ROUTE_ID"]), fullFare:fare, company, start, end };
      }
    }
    return best;
  }

  async function fillRouteFares(r, stops) {
    const cells = [...document.querySelectorAll("#stops .fare-cell")];
    if (!cells.length) return;
    cells.forEach(el => { el.textContent = "車費載入中"; });
    try {
      const meta = await routeMeta(r);
      if (!meta?.fullFare) throw new Error("fare unavailable");
      const label = `全程 $${Number(meta.fullFare).toFixed(1)}`;
      cells.forEach(el => { if (el.isConnected) el.textContent = label; });
      const header = document.querySelector("#routeHeader .route-title");
      if (header && !header.querySelector(".dz-full-fare")) {
        const fare = document.createElement("div");
        fare.className = "dz-full-fare";
        fare.textContent = label;
        header.appendChild(fare);
      }
    } catch {
      cells.forEach(el => { if (el.isConnected) el.textContent = "車費 —"; });
    }
  }

  // Compatibility exports used by nearby fare enrichment and older code.
  async function loadFareXml(operator) {
    return loadXml(operator === "GMB" ? GMB_FARE : BUS_FARE);
  }
  function routeFareRecords(xml, ctx = {}) {
    const out = [];
    const routeId = String(ctx.routeId || "");
    if (!routeId) return out;
    for (const idEl of xml.querySelectorAll("ROUTE_ID")) {
      if (idEl.textContent.trim() !== routeId) continue;
      const n = idEl.parentElement;
      const on = Number(textOf(n,["ON_SEQ"]));
      const off = Number(textOf(n,["OFF_SEQ"]));
      const fare = Number(String(textOf(n,["PRICE"])).replace(/[^0-9.]/g,""));
      const routeSeq = Number(textOf(n,["ROUTE_SEQ"]));
      const dayCode = Number(textOf(n,["DAY_CODE"]));
      if (Number.isFinite(on) && Number.isFinite(fare) && fare > 0) out.push({seq:on,on,off,fare,routeSeq,dayCode});
    }
    return out;
  }
  function buildFareMap(records = []) {
    const map = new Map();
    for (const r of records) {
      const seq = Number(r.seq || r.on) || 1;
      const fare = Number(r.fare);
      if (Number.isFinite(fare) && fare > 0 && (!map.has(seq) || fare < map.get(seq))) map.set(seq, fare);
    }
    return map;
  }

  window.fillRouteFares = fillRouteFares;
  window.getRouteFareMeta = routeMeta;
  window.loadFareXml = loadFareXml;
  window.routeFareRecords = routeFareRecords;
  window.buildFareMap = buildFareMap;
})();