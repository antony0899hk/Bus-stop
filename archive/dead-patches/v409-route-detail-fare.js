(() => {
  "use strict";
  const VERSION = "4.0.16";

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

  window.renderNearby = function renderNearby409() {
    const all = state.nearby.filter(x => state.nearbyFilter === "all" || x.operator === state.nearbyFilter);
    const list = all.slice(0, state.nearbyExpanded ? MAX_NEARBY_COUNT : SHORT_NEARBY_COUNT);
    $("#nearbySection").classList.remove("hidden");
    $("#nearbyCount").textContent = `共 ${all.length} 個附近選項`;
    $("#nearbyResults").innerHTML = list.length ? list.map(x => {
      const isMtr = x.operator === "MTR" && x.walking;
      // Loading and indexing fare XML for every visible card can terminate the
      // iOS PWA.  Route-detail view still loads its fare on demand.
      const fareHtml = isMtr ? '<div class="near-fare near-walk-label">步行</div>' : '<div class="near-fare">點入查車費</div>';
      const etaText = isMtr ? `約 ${Math.max(1, Number(x.walkMinutes)||1)} 分鐘` : etaLabel(x.eta);
      const destText = isMtr ? '港鐵站' : (x.dest || '目的地');
      const metaText = isMtr ? `${Math.round(x.distance)}m · 步行時間` : `${x.stopName} · ${Math.round(x.distance)}m`;
      return `<div class="near-card${isMtr?' dz-near-mtr':''}"><div>${operatorBadge(x.operator)}</div><div><div class="near-route">${escapeHtml(x.route)}</div><div class="near-dest">→ ${escapeHtml(destText)}</div><div class="near-meta">${escapeHtml(metaText)}</div></div>${fareHtml}<div class="near-eta">${escapeHtml(etaText)}</div></div>`;
    }).join("") : '<div class="empty">附近暫時未有可顯示資料。</div>';
    const canToggle = all.length > SHORT_NEARBY_COUNT;
    $("#nearbyMore").classList.toggle("hidden", !canToggle);
    $("#nearbyCollapseTop").classList.toggle("hidden", !canToggle || !state.nearbyExpanded);
    $("#nearbyMore").textContent = state.nearbyExpanded ? "收起 ↑" : "顯示更多 ↓";
  };

  const style = document.createElement("style");
  style.textContent = `.near-card{grid-template-columns:auto minmax(0,1fr) auto auto}.near-fare{align-self:center;white-space:nowrap;color:#c9ccd3;font-size:.9rem;font-weight:700;margin:0 8px}.near-eta{white-space:nowrap}.dz-near-mtr .near-route{font-weight:850}.dz-near-mtr .near-fare{color:#8fbce8}@media(max-width:430px){.near-fare{font-size:.82rem;margin:0 4px}}`;
  document.head.appendChild(style);
})();
