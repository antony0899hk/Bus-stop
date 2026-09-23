(() => {
  "use strict";

  const QUICK_KEY = "daozhan.quickPlaces.v3";
  const RECENT_KEY = "daozhan.journeyRecent.v1";
  const MAX_CUSTOM = 6;
  const MAX_RECENT = 3;
  const FINAL_WALK_MAX = 800;
  let reconciling = false;

  const $ = s => document.querySelector(s);
  const norm = v => String(v || "").trim().toLowerCase().replace(/[\s　]+/g, "");
  const esc = v => String(v ?? "").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
  const read = (k,f) => { try { return JSON.parse(localStorage.getItem(k)) ?? f; } catch { return f; } };
  const write = (k,v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} };

  function cleanPlaces() {
    const raw = read(QUICK_KEY, []);
    if (!Array.isArray(raw)) return [];
    const fixed = raw.filter(p => p && (p.id === "home" || p.id === "office"));
    const custom = [];
    const seenLabel = new Set(), seenValue = new Set();
    for (let i = raw.length - 1; i >= 0; i--) {
      const p = raw[i];
      if (!p || p.id === "home" || p.id === "office") continue;
      const l = norm(p.label), v = norm(p.value);
      if (!l || !v || seenLabel.has(l) || seenValue.has(v)) continue;
      seenLabel.add(l); seenValue.add(v); custom.unshift(p);
    }
    const cleaned = [...fixed.slice(0,2), ...custom.slice(0,MAX_CUSTOM)];
    if (JSON.stringify(cleaned) !== JSON.stringify(raw)) write(QUICK_KEY, cleaned);
    return cleaned;
  }

  function reconcileSavedPlaces() {
    if (reconciling) return;
    reconciling = true;
    try {
      const quick = $("#journeyQuickPlaces");
      const recentBox = $("#journeyRecentPlaces");
      if (!quick || !recentBox) return;
      const list = cleanPlaces();
      const custom = list.filter(p => !["home","office"].includes(p.id));
      const add = quick.querySelector("[data-add-quick]");
      quick.querySelectorAll(".dz-custom-place").forEach(n => n.remove());
      for (const p of custom) {
        const b = document.createElement("button");
        b.type = "button";
        b.className = "journey-quick-btn dz-custom-place";
        b.dataset.quick = p.id;
        b.title = p.label;
        b.innerHTML = `<span>${esc(p.icon || "📍")}</span><strong>${esc(p.label)}</strong>`;
        quick.insertBefore(b, add || null);
      }

      const saved = new Set();
      list.forEach(p => { saved.add(norm(p.label)); saved.add(norm(p.value)); });
      const rawRecent = read(RECENT_KEY, []);
      const out = [];
      const seen = new Set();
      for (const v of Array.isArray(rawRecent) ? rawRecent : []) {
        const n = norm(v);
        if (!n || saved.has(n) || seen.has(n)) continue;
        seen.add(n); out.push(String(v).trim());
        if (out.length >= MAX_RECENT) break;
      }
      if (JSON.stringify(out) !== JSON.stringify(rawRecent)) write(RECENT_KEY, out);
      recentBox.innerHTML = out.length ? '<span class="recent-label">最近：</span>' + out.map(v=>`<button type="button" class="journey-recent-btn" data-recent="${esc(v)}">${esc(v)}</button>`).join("") : "";
      recentBox.classList.toggle("hidden", !out.length);
    } finally { reconciling = false; }
  }

  function targetStops() {
    if (typeof resolvePlace !== "function") return [];
    const value = $("#journeyTo")?.value || "";
    try { return resolvePlace(value, null).filter(x => Number.isFinite(x.lat) && Number.isFinite(x.lon)); } catch { return []; }
  }

  function indexFor(op) {
    if (op === "KMB") return journeyState?.kmbIndex;
    if (op === "CTB") return journeyState?.ctbIndex;
    return null;
  }

  function mapFor(op) {
    if (typeof state === "undefined") return null;
    if (op === "KMB") return state.kmbStops;
    if (op === "CTB") return state.ctbStops;
    return null;
  }

  function bestDownstreamWalk(r, targets) {
    const op = r?.first?.operator;
    const idx = indexFor(op), map = mapFor(op);
    if (!idx || !map || !r?.first?.originStop?.id || typeof distanceMeters !== "function") return null;
    const memberships = idx.byStop.get(String(r.first.originStop.id)) || [];
    const mem = memberships.find(m => {
      const route = idx.byRoute.get(m.routeKey);
      return route && String(route.route) === String(r.first.route) && (!r.first.bound || String(route.bound) === String(r.first.bound)) && (!r.first.serviceType || String(route.serviceType) === String(r.first.serviceType));
    }) || memberships.find(m => String(idx.byRoute.get(m.routeKey)?.route) === String(r.first.route));
    if (!mem) return null;
    const route = idx.byRoute.get(mem.routeKey);
    if (!route) return null;
    let best = null;
    for (let pos = mem.pos + 1; pos < route.stops.length; pos++) {
      const rs = route.stops[pos];
      const s = map.get(String(rs.stop));
      if (!s) continue;
      const lat = Number(s.lat ?? s.latitude), lon = Number(s.long ?? s.lng ?? s.longitude);
      if (!Number.isFinite(lat) || !Number.isFinite(lon)) continue;
      let d = Infinity;
      for (const t of targets) {
        const x = distanceMeters(lat, lon, t.lat, t.lon);
        if (Number.isFinite(x) && x < d) d = x;
      }
      if (d <= FINAL_WALK_MAX && (!best || d < best.distance || (d === best.distance && pos < best.pos))) {
        best = { id:String(rs.stop), name:journeyStopName(s) || String(rs.stop), lat, lon, stop:s, distance:d, pos, route, mem };
      }
    }
    return best;
  }

  function addDownstreamFinalWalks() {
    if (!Array.isArray(journeyState?.results)) return 0;
    const targets = targetStops();
    if (!targets.length) return 0;
    const additions = [];
    const replace = new Set();
    for (const r of journeyState.results) {
      if (r?.kind !== "transfer" || !["KMB","CTB"].includes(r.first?.operator)) continue;
      const hit = bestDownstreamWalk(r, targets);
      if (!hit) continue;
      const originWalk = Number(r.first.originStop?.distance || 0);
      const stopCount = Math.max(1, hit.pos - hit.mem.pos);
      additions.push({
        kind:"direct", transferCount:0, operator:r.first.operator, route:r.first.route,
        bound:r.first.bound || hit.route.bound || "", serviceType:r.first.serviceType || hit.route.serviceType || "1",
        originStop:r.first.originStop,
        destinationStop:{id:hit.id,name:hit.name,lat:hit.lat,lon:hit.lon,distance:hit.distance,stop:hit.stop},
        originPos:hit.mem.pos, destinationPos:hit.pos, stopCount,
        walkMeters:originWalk + hit.distance, eta:r.firstEta || null,
        fare:Array.isArray(r.legFares) && Number(r.legFares[0]) > 0 ? Number(r.legFares[0]) : null,
        meta:{orig:r.first.orig || "",dest:`${hit.name}（落車後步行到目的地）`},
        finalWalkMeters:hit.distance, _dzDownstreamFinalWalk:true
      });
      replace.add(`${r.first.operator}|${r.first.route}|${r.first.originStop.id}`);
    }
    if (!additions.length) return 0;
    journeyState.results = journeyState.results.filter(r => r?.kind !== "transfer" || !replace.has(`${r.first?.operator}|${r.first?.route}|${r.first?.originStop?.id}`));
    const seen = new Set(journeyState.results.map(r => `${r.kind}|${r.operator}|${r.route}|${r.originStop?.id}|${r.destinationStop?.id}`));
    for (const a of additions) {
      const k = `${a.kind}|${a.operator}|${a.route}|${a.originStop?.id}|${a.destinationStop?.id}`;
      if (!seen.has(k)) { seen.add(k); journeyState.results.push(a); }
    }
    return additions.length;
  }

  function installRoutingFix() {
    if (typeof runJourneySearch !== "function" || runJourneySearch._dz369) return;
    const previous = runJourneySearch;
    const wrapped = async function() {
      const result = await previous();
      const n = addDownstreamFinalWalks();
      if (n) {
        try { renderJourneyResults(); } catch {}
        const st = $("#journeyStatus");
        if (st) st.textContent = `已優先比較落車後直接步行方案；共 ${journeyState.results.length} 個候選。`;
      }
      reconcileSavedPlaces();
      return result;
    };
    wrapped._dz369 = true;
    runJourneySearch = wrapped;
  }

  function boot() {
    reconcileSavedPlaces();
    installRoutingFix();
    const mo = new MutationObserver(() => reconcileSavedPlaces());
    mo.observe(document.querySelector(".journey-planner") || document.body, {subtree:true, childList:true});
    document.addEventListener("click", e => {
      if (e.target.closest("[data-save], [data-delete], #journeySearchBtn")) setTimeout(reconcileSavedPlaces, 80);
    }, true);
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot, {once:true}); else boot();
})();
