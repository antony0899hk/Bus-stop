(() => {
  "use strict";

  const QUICK_KEY = "daozhan.quickPlaces.v3";
  const RECENT_KEY = "daozhan.journeyRecent.v1";
  const MAX_CUSTOM = 6;
  const WALK_M_PER_MIN = 78;
  const STOP_MINUTES = { KMB:2.0, CTB:2.1, GMB:1.8, NLB:2.2, MTR:2.3 };
  const WAIT_FALLBACK = { KMB:12, CTB:12, GMB:10, NLB:15, MTR:6 };
  const OP_PRIORITY = { KMB:0, CTB:1, GMB:2, MTR:3, NLB:4 };

  const esc = v => typeof escapeHtml === "function" ? escapeHtml(v) : String(v ?? "");
  const norm = v => String(v || "").trim().toLowerCase().replace(/[\s　]+/g, "");
  const finiteFare = v => {
    if (v == null || v === "") return null;
    const n = Number(v);
    return Number.isFinite(n) && n > 0 ? n : null;
  };
  const opPriority = op => OP_PRIORITY[String(op || "").toUpperCase()] ?? 99;
  const walkMinutes = meters => Math.max(0, Math.round((Number(meters) || 0) / WALK_M_PER_MIN));
  const travelMinutes = (op, stops) => Math.max(2, Math.round((Number(stops) || 1) * (STOP_MINUTES[op] || 2)));
  const etaWait = iso => {
    if (!iso || typeof etaMinutes !== "function") return null;
    const n = etaMinutes(iso);
    return Number.isFinite(n) ? Math.max(0, n) : null;
  };

  function normalizeStoredPlaces() {
    try {
      const raw = JSON.parse(localStorage.getItem(QUICK_KEY) || "[]");
      if (!Array.isArray(raw)) return;
      const fixed = raw.filter(p => p && (p.id === "home" || p.id === "office"));
      const custom = raw.filter(p => p && p.id !== "home" && p.id !== "office");
      const seenName = new Set(), seenValue = new Set(), out = [];
      for (const p of custom) {
        const nk = norm(p.label), vk = norm(p.value);
        if (!nk && !vk) continue;
        if ((nk && seenName.has(nk)) || (vk && seenValue.has(vk))) continue;
        if (nk) seenName.add(nk);
        if (vk) seenValue.add(vk);
        out.push(p);
        if (out.length >= MAX_CUSTOM) break;
      }
      const next = [...fixed, ...out];
      localStorage.setItem(QUICK_KEY, JSON.stringify(next));
      const rec = JSON.parse(localStorage.getItem(RECENT_KEY) || "[]");
      if (Array.isArray(rec)) {
        const blocked = new Set(next.flatMap(p => [norm(p.label), norm(p.value)]).filter(Boolean));
        const seen = new Set();
        localStorage.setItem(RECENT_KEY, JSON.stringify(rec.filter(v => {
          const k = norm(v);
          if (!k || blocked.has(k) || seen.has(k)) return false;
          seen.add(k); return true;
        }).slice(0,3)));
      }
    } catch {}
  }

  function cleanQuickDom() {
    const row = document.querySelector("#journeyRecentPlaces");
    if (!row) return;
    const seen = new Set();
    [...row.querySelectorAll("button")].forEach(btn => {
      const key = norm(btn.textContent);
      if (!key || seen.has(key)) btn.remove(); else seen.add(key);
    });
    row.classList.toggle("hidden", !row.querySelector("button"));
  }

  normalizeStoredPlaces();
  setTimeout(cleanQuickDom, 50);

  function routeName(r) {
    return String(r?.route || "").toUpperCase().trim();
  }

  function isDeepNight() {
    const d = new Date();
    const mins = d.getHours() * 60 + d.getMinutes();
    return mins >= 90 && mins < 300; // 01:30–04:59
  }

  function isNightRoute(r) {
    return /^(N|NA)\d/i.test(routeName(r));
  }

  function legServiceState(leg, eta) {
    if (eta) return "live";
    if (isDeepNight()) return isNightRoute(leg) ? "night-unknown" : "closed";
    return "unknown";
  }

  function journeyServiceState(r) {
    if (r.kind === "transfer") {
      const a = legServiceState(r.first, r.firstEta);
      const b = legServiceState(r.second, r.secondEta);
      if (a === "closed" || b === "closed") return "closed";
      if (a === "live" && b === "live") return "live";
      if (a === "night-unknown" || b === "night-unknown") return "night-unknown";
      return "unknown";
    }
    return legServiceState(r, r.eta);
  }

  function serviceText(r) {
    const s = journeyServiceState(r);
    if (s === "closed") return "今日服務已完／現時不可用";
    if (s === "night-unknown") return "🌙 夜間路線 · 暫未有班次預報";
    if (s === "live") {
      if (r.kind === "transfer") return "兩段均有班次預報";
      return `${etaLabel(r.eta)}到站`;
    }
    return "未有班次預報 · 路線保留作參考";
  }

  function resultFare(r) {
    const discounted = finiteFare(r?.discountedFare);
    if (discounted) return discounted;
    const direct = finiteFare(r?.fare);
    if (direct) return direct;
    if (Array.isArray(r?.legFares) && r.legFares.length) {
      const legs = r.legFares.map(finiteFare);
      if (legs.every(Boolean)) {
        const total = legs.reduce((a,b)=>a+b,0) - Math.max(0, Number(r.transferDiscount) || 0);
        return total > 0 ? total : null;
      }
    }
    return null;
  }

  function findLegOriginPos(leg, stopId) {
    try {
      const idx = leg.operator === "KMB" ? journeyState.kmbIndex : leg.operator === "CTB" ? journeyState.ctbIndex : null;
      if (!idx) return null;
      const memberships = idx.byStop.get(String(stopId)) || [];
      const hit = memberships.find(m => {
        const rr = idx.byRoute.get(m.routeKey);
        return rr && String(rr.route) === String(leg.route) && (!leg.bound || String(rr.bound) === String(leg.bound)) && (!leg.serviceType || String(rr.serviceType) === String(leg.serviceType));
      });
      return hit?.pos ?? null;
    } catch { return null; }
  }

  async function legFare(leg, stopId) {
    if (!leg || typeof journeyFare !== "function") return null;
    if (leg.operator !== "KMB" && leg.operator !== "CTB") return null;
    const pos = findLegOriginPos(leg, stopId);
    if (pos == null) return null;
    return journeyFare({ kind:"direct", operator:leg.operator, route:leg.route, bound:leg.bound, serviceType:leg.serviceType, originPos:pos });
  }

  async function fetchLegEta(leg, stopId) {
    try {
      if (leg.operator === "KMB") {
        const j = await getJSON(`${KMB_API}/eta/${encodeURIComponent(stopId)}/${encodeURIComponent(leg.route)}/${encodeURIComponent(leg.serviceType || "1")}`, {ttl:0,retries:0});
        const rows=(j.data||[]).filter(x => (!leg.bound || !x.dir || x.dir===leg.bound) && validFutureEta(x.eta)).sort((a,b)=>new Date(a.eta)-new Date(b.eta));
        return rows[0]?.eta || null;
      }
      if (leg.operator === "CTB") {
        const j = await getJSON(`${CTB_API}/eta/ctb/${encodeURIComponent(stopId)}/${encodeURIComponent(leg.route)}`, {ttl:0,retries:0});
        const rows=(j.data||[]).filter(x => (!leg.bound || !x.dir || String(x.dir).toUpperCase()===String(leg.bound).toUpperCase()) && validFutureEta(x.eta)).sort((a,b)=>new Date(a.eta)-new Date(b.eta));
        return rows[0]?.eta || null;
      }
    } catch {}
    return null;
  }

  async function enrichTransfer(r) {
    if (!r || r.kind !== "transfer") return;
    const [firstEta, secondEta, firstFare, secondFare] = await Promise.all([
      fetchLegEta(r.first, r.first?.originStop?.id),
      fetchLegEta(r.second, r.transferStopId),
      legFare(r.first, r.first?.originStop?.id),
      legFare(r.second, r.transferStopId)
    ]);
    r.firstEta = firstEta;
    r.secondEta = secondEta;
    r.eta = firstEta || null;
    const f1 = finiteFare(firstFare), f2 = finiteFare(secondFare);
    if (f1 && f2) r.legFares = [f1, f2];
  }

  function splitWalk(r) {
    const start = Math.max(0, Number(r.kind === "transfer" ? r.first?.originStop?.distance : r.originStop?.distance) || 0);
    const end = Math.max(0, Number(r.kind === "transfer" ? r.second?.destinationStop?.distance : r.destinationStop?.distance) || 0);
    return { start, end, total:start + end };
  }

  function estimate(r) {
    const w = splitWalk(r);
    if (r.kind !== "transfer") {
      const wait = etaWait(r.eta);
      const ride = travelMinutes(r.operator, r.stopCount);
      return { total:walkMinutes(w.total)+(wait ?? (WAIT_FALLBACK[r.operator]||12))+ride, wait, ride, walk:w };
    }
    const firstWait = etaWait(r.firstEta);
    const firstRide = travelMinutes(r.first?.operator, r.first?.stopCount || Math.ceil((Number(r.stopCount)||2)/2));
    const secondEtaFromNow = etaWait(r.secondEta);
    const firstPhase = (firstWait ?? (WAIT_FALLBACK[r.first?.operator]||12)) + firstRide;
    const secondWait = secondEtaFromNow == null ? (WAIT_FALLBACK[r.second?.operator]||12) : Math.max(2, secondEtaFromNow-firstPhase);
    const secondRide = travelMinutes(r.second?.operator, r.second?.stopCount || Math.floor((Number(r.stopCount)||2)/2));
    return { total:walkMinutes(w.total)+firstPhase+secondWait+secondRide, firstWait, firstRide, secondWait, secondRide, walk:w };
  }

  function score(r) {
    const s = journeyServiceState(r);
    if (s === "closed") return 9e9;
    const e = estimate(r), fare = resultFare(r);
    const transfers = Number(r.transferCount || (r.kind === "transfer" ? 1 : 0));
    const walk = e.walk.total;
    const uncertainty = s === "live" ? 0 : s === "night-unknown" ? 25000 : 50000;
    let base;
    if (journeyState.mode === "walking") base = walk*10 + transfers*1500 + e.total;
    else if (journeyState.mode === "transfers") base = transfers*100000 + walk + e.total*10;
    else if (journeyState.mode === "cheapest") base = (fare ?? 999)*1000 + transfers*100 + e.total;
    else base = e.total*100 + transfers*700;
    const op = r.kind === "transfer" ? r.first?.operator : r.operator;
    return uncertainty + base + opPriority(op);
  }

  journeyScore = score;

  function fareText(r) {
    const f = resultFare(r);
    if (f) return `車費約 $${f.toFixed(1)}`;
    if (r.kind === "transfer" && Array.isArray(r.legFares)) return "部分車費未有資料";
    return "車費未有資料";
  }

  function walkSummary(r) {
    const w = splitWalk(r);
    const bits = [];
    if (w.start > 0) bits.push(`先步行約 ${Math.max(1,walkMinutes(w.start))} 分鐘（${Math.round(w.start)}m）到上車站`);
    if (w.end > 0) bits.push(`落車後步行約 ${Math.max(1,walkMinutes(w.end))} 分鐘（${Math.round(w.end)}m）到目的地`);
    return bits.length ? bits.join(" · ") : "上落車步行距離很短";
  }

  function transferName(r) {
    try {
      const map = r.first?.operator === "KMB" ? state.kmbStops : r.first?.operator === "CTB" ? state.ctbStops : state.gmbStops;
      return journeyStopName(map.get(String(r.transferStopId))) || "轉車站";
    } catch { return "轉車站"; }
  }

  function listResults() {
    if (!Array.isArray(journeyState.results)) return [];
    return journeyState.results.filter(r => journeyServiceState(r) !== "closed").sort((a,b)=>score(a)-score(b)).slice(0,12);
  }

  renderJourneyResults = function() {
    const box = document.querySelector("#journeyResults");
    if (!box) return;
    const list = listResults();
    const closedCount = (journeyState.results || []).filter(r => journeyServiceState(r) === "closed").length;
    if (!list.length) {
      box.innerHTML = `<div class="empty">現時搵唔到可行班次${closedCount ? `；已排除 ${closedCount} 個已收車方案` : ""}。系統仍會保留夜間路線作後續搜尋依據。</div>`;
      box._dzRenderedList = [];
      return;
    }
    box.innerHTML = list.map((r,i) => {
      const e = estimate(r), service = journeyServiceState(r);
      const cls = service === "live" ? "" : " dz-no-live";
      if (r.kind === "transfer") {
        return `<article class="journey-card dz-clickable${cls}" data-dz-journey-index="${i}" tabindex="0" role="button"><div class="journey-rank">${i+1}</div><div class="journey-main"><div class="journey-top"><div class="journey-lines"><span>${routeBadge(r.first.operator)} <strong>${esc(r.first.route)}</strong></span><span class="arrow">→</span><span>${routeBadge(r.second.operator)} <strong>${esc(r.second.route)}</strong></span></div><div class="journey-total">約 ${e.total} 分鐘</div></div><div class="journey-title">${esc(stopLabel(r.first.originStop))} → ${esc(transferName(r))} → ${esc(stopLabel(r.second.destinationStop))}</div><div class="journey-meta">轉 1 次 · 約 ${r.stopCount} 個站 · ${esc(fareText(r))}</div><div class="journey-walk-line">🚶 ${esc(walkSummary(r))}</div><div class="journey-note">${esc(serviceText(r))}</div></div></article>`;
      }
      return `<article class="journey-card dz-clickable${cls}" data-dz-journey-index="${i}" tabindex="0" role="button"><div class="journey-rank">${i+1}</div><div class="journey-main"><div class="journey-top"><div>${routeBadge(r.operator)} <strong class="journey-route">${esc(r.route)}</strong></div><div class="journey-total">約 ${e.total} 分鐘</div></div><div class="journey-title">${esc(stopLabel(r.originStop))} → ${esc(stopLabel(r.destinationStop))}</div><div class="journey-meta">直達 · 約 ${r.stopCount} 個站 · ${esc(fareText(r))}</div><div class="journey-walk-line">🚶 ${esc(walkSummary(r))}</div><div class="journey-note">${esc(serviceText(r))}${r.meta?.dest ? ` · 往 ${esc(r.meta.dest)}` : ""}</div></div></article>`;
    }).join("");
    box._dzRenderedList = list;
  };

  function openDetail(index) {
    const box = document.querySelector("#journeyResults");
    const list = box?._dzRenderedList || listResults();
    const r = list[Number(index)];
    if (!r) return;
    document.querySelector(".dz-journey-sheet-backdrop")?.remove();
    const e = estimate(r), w = e.walk;
    const steps = [];
    if (w.start > 0) steps.push(`<div class="dz-step"><b>1</b><div><strong>步行去上車站</strong><small>約 ${Math.max(1,walkMinutes(w.start))} 分鐘 · ${Math.round(w.start)}m</small></div></div>`);
    if (r.kind === "transfer") {
      steps.push(`<div class="dz-step"><b>${steps.length+1}</b><div><strong>${esc(r.first.route)}</strong> → ${esc(transferName(r))}<small>${r.firstEta ? `${esc(etaLabel(r.firstEta))}到站` : esc(serviceText({kind:"direct",...r.first,eta:r.firstEta}))} · 車程約 ${e.firstRide} 分鐘</small></div></div>`);
      steps.push(`<div class="dz-step"><b>${steps.length+1}</b><div><strong>${esc(r.second.route)}</strong> → ${esc(stopLabel(r.second.destinationStop))}<small>${r.secondEta ? `有班次預報` : "暫未有班次預報"} · 等候估算約 ${e.secondWait} 分鐘 · 車程約 ${e.secondRide} 分鐘</small></div></div>`);
    } else {
      steps.push(`<div class="dz-step"><b>${steps.length+1}</b><div><strong>${esc(r.route)}</strong> → ${esc(stopLabel(r.destinationStop))}<small>${r.eta ? `${esc(etaLabel(r.eta))}到站` : esc(serviceText(r))} · 車程約 ${e.ride} 分鐘</small></div></div>`);
    }
    if (w.end > 0) steps.push(`<div class="dz-step"><b>${steps.length+1}</b><div><strong>步行到目的地</strong><small>約 ${Math.max(1,walkMinutes(w.end))} 分鐘 · ${Math.round(w.end)}m</small></div></div>`);
    const modal = document.createElement("div");
    modal.className = "dz-journey-sheet-backdrop";
    modal.innerHTML = `<section class="dz-journey-sheet"><div class="quick-modal-handle"></div><div class="dz-sheet-head"><div><h3>點對點方案</h3><p>全程約 ${e.total} 分鐘</p></div><button type="button" data-dz-close>×</button></div><div class="dz-summary"><span>${esc(fareText(r))}</span><span>${esc(serviceText(r))}</span></div>${steps.join("")}<p class="dz-disclaimer">時間為估算；實際班次、交通及步行速度會影響總時間。</p></section>`;
    document.body.appendChild(modal);
    modal.addEventListener("click", ev => { if (ev.target === modal || ev.target.closest("[data-dz-close]")) modal.remove(); });
  }

  document.addEventListener("click", e => {
    const card = e.target.closest("#journeyResults [data-dz-journey-index]");
    if (card) openDetail(card.dataset.dzJourneyIndex);
  });
  document.addEventListener("keydown", e => {
    const card = e.target.closest?.("#journeyResults [data-dz-journey-index]");
    if (card && (e.key === "Enter" || e.key === " ")) { e.preventDefault(); openDetail(card.dataset.dzJourneyIndex); }
  });

  if (typeof runJourneySearch === "function") {
    const baseRunJourneySearch = runJourneySearch;
    runJourneySearch = async function() {
      await baseRunJourneySearch();
      if (!Array.isArray(journeyState.results) || !journeyState.results.length) return;
      await Promise.all(journeyState.results.filter(r=>r.kind==="transfer").slice(0,12).map(enrichTransfer));
      const status = document.querySelector("#journeyStatus");
      const closed = journeyState.results.filter(r=>journeyServiceState(r)==="closed").length;
      const available = journeyState.results.length - closed;
      if (status) status.textContent = `找到 ${available} 個現時可顯示方案${closed ? `；已排除 ${closed} 個已收車／不可用方案` : ""}。ETA 及車費以公開資料為準。`;
      renderJourneyResults();
    };
  }

  const style = document.createElement("style");
  style.textContent = `.journey-card.dz-clickable{cursor:pointer}.journey-card.dz-no-live{opacity:.76}.journey-total{font-size:18px;font-weight:850;white-space:nowrap}.journey-walk-line{margin-top:7px;font-size:13px;line-height:1.45}.dz-journey-sheet-backdrop{position:fixed;inset:0;background:rgba(0,0,0,.36);z-index:10000;display:flex;align-items:flex-end;justify-content:center}.dz-journey-sheet{width:min(680px,100%);max-height:84vh;overflow:auto;background:var(--card,#fff);color:inherit;border-radius:22px 22px 0 0;padding:12px 18px calc(22px + env(safe-area-inset-bottom))}.dz-sheet-head{display:flex;justify-content:space-between;gap:12px;align-items:flex-start}.dz-sheet-head h3{margin:4px 0}.dz-sheet-head p{margin:0;opacity:.7}.dz-sheet-head button{border:0;background:transparent;font-size:28px;color:inherit}.dz-summary{display:flex;flex-wrap:wrap;gap:8px;margin:14px 0}.dz-summary span{padding:7px 10px;border-radius:999px;background:rgba(127,127,127,.12)}.dz-step{display:flex;gap:12px;padding:12px 0;border-top:1px solid rgba(127,127,127,.18)}.dz-step>b{display:grid;place-items:center;min-width:28px;height:28px;border-radius:50%;background:rgba(127,127,127,.14)}.dz-step small{display:block;margin-top:4px;opacity:.72}.dz-disclaimer{font-size:12px;opacity:.65}.quick-modal-handle{width:42px;height:5px;border-radius:99px;background:rgba(127,127,127,.32);margin:0 auto 8px}`;
  document.head.appendChild(style);
})();