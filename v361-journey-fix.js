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
    const n = Number(v);
    return Number.isFinite(n) && n > 0 ? n : null;
  };
  const opPriority = op => OP_PRIORITY[String(op || "").toUpperCase()] ?? 99;
  const walkMinutes = meters => Math.max(0, Math.round((Number(meters) || 0) / WALK_M_PER_MIN));
  const etaWait = iso => {
    if (!iso || typeof etaMinutes !== "function") return null;
    const n = etaMinutes(iso);
    return Number.isFinite(n) ? Math.max(0, n) : null;
  };
  const travelMinutes = (op, stops) => Math.max(2, Math.round((Number(stops) || 1) * (STOP_MINUTES[op] || 2)));

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
        const clean = rec.filter(v => {
          const k = norm(v);
          if (!k || blocked.has(k) || seen.has(k)) return false;
          seen.add(k); return true;
        }).slice(0,3);
        localStorage.setItem(RECENT_KEY, JSON.stringify(clean));
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
    const labels = [...row.querySelectorAll(".recent-label")];
    labels.forEach(label => {
      let n = label.nextElementSibling, has = false;
      while (n && !n.classList.contains("recent-label")) { if (n.tagName === "BUTTON") has = true; n = n.nextElementSibling; }
      if (!has) label.remove();
    });
    row.classList.toggle("hidden", !row.querySelector("button"));
  }

  normalizeStoredPlaces();
  setTimeout(cleanQuickDom, 50);

  function resultFare(r) {
    const discounted = finiteFare(r?.discountedFare);
    if (discounted) return discounted;
    const direct = finiteFare(r?.fare);
    if (direct) return direct;
    if (Array.isArray(r?.legFares)) {
      const legs = r.legFares.map(finiteFare);
      if (legs.length && legs.every(Boolean)) {
        const discount = Math.max(0, Number(r.transferDiscount) || 0);
        const total = legs.reduce((a,b)=>a+b,0) - discount;
        return total > 0 ? total : null;
      }
    }
    return null;
  }

  function estimateDirect(r) {
    const walk = walkMinutes(r.walkMeters);
    const wait = etaWait(r.eta);
    const ride = travelMinutes(r.operator, r.stopCount);
    const unknownWait = WAIT_FALLBACK[r.operator] || 12;
    return { walk, wait, ride, total:walk + (wait ?? unknownWait) + ride, live:wait != null };
  }

  function estimateTransfer(r) {
    const walk = walkMinutes(r.walkMeters);
    const firstWait = etaWait(r.firstEta || r.eta);
    const firstRide = travelMinutes(r.first?.operator, r.first?.stopCount || Math.ceil((Number(r.stopCount)||2)/2));
    const arrivalAtTransfer = (firstWait ?? (WAIT_FALLBACK[r.first?.operator] || 12)) + firstRide;
    const secondRaw = etaWait(r.secondEta);
    const secondWait = secondRaw == null ? (WAIT_FALLBACK[r.second?.operator] || 12) : Math.max(2, secondRaw - arrivalAtTransfer);
    const secondRide = travelMinutes(r.second?.operator, r.second?.stopCount || Math.floor((Number(r.stopCount)||2)/2));
    return { walk, firstWait, firstRide, secondWait, secondRide, total:walk + (firstWait ?? (WAIT_FALLBACK[r.first?.operator] || 12)) + firstRide + secondWait + secondRide, live:firstWait != null && secondRaw != null };
  }

  function estimate(r) { return r?.kind === "transfer" ? estimateTransfer(r) : estimateDirect(r); }

  function revisedScore(r) {
    const e = estimate(r);
    const fare = resultFare(r);
    const transfers = Number(r.transferCount || (r.kind === "transfer" ? 1 : 0));
    const walk = Number(r.walkMeters || 0);
    const livePenalty = e.live ? 0 : 100000;
    let score;
    if (typeof journeyState !== "undefined" && journeyState.mode === "walking") score = walk * 10 + transfers * 1500 + e.total;
    else if (typeof journeyState !== "undefined" && journeyState.mode === "transfers") score = transfers * 100000 + walk + e.total * 10;
    else if (typeof journeyState !== "undefined" && journeyState.mode === "cheapest") score = (fare ?? 999) * 1000 + transfers * 100 + e.total;
    else score = e.total * 100 + transfers * 700;
    return livePenalty + score + opPriority(r.kind === "transfer" ? r.first?.operator : r.operator);
  }

  if (typeof journeyScore === "function") journeyScore = revisedScore;

  function statusText(r) {
    if (r.kind === "transfer") {
      if (r.firstEta && r.secondEta) return "兩段均有班次預報";
      if (r.firstEta || r.secondEta) return "部分班次未有預報";
      return "未有班次預報 · 路線仍保留作參考";
    }
    return r.eta ? `${etaLabel(r.eta)}到站` : "未有班次預報";
  }

  function fareText(r) {
    const f = resultFare(r);
    return f ? ` · 車費 $${f.toFixed(1)}` : " · 車費未有資料";
  }

  function walkText(m) {
    const meters = Math.max(0, Math.round(Number(m) || 0));
    const mins = walkMinutes(meters);
    return `🚶 ${meters >= 1000 ? `${(meters/1000).toFixed(1)}km` : `${meters}m`} · 約 ${Math.max(1,mins)} 分鐘`;
  }

  function transferName(r) {
    try {
      const map = r.first?.operator === "KMB" ? state.kmbStops : r.first?.operator === "CTB" ? state.ctbStops : state.gmbStops;
      return journeyStopName(map.get(String(r.transferStopId))) || "轉車站";
    } catch { return "轉車站"; }
  }

  function listResults() {
    if (typeof journeyState === "undefined" || !Array.isArray(journeyState.results)) return [];
    const rows = [...journeyState.results];
    rows.sort((a,b) => revisedScore(a) - revisedScore(b));
    return rows.slice(0,12);
  }

  if (typeof renderJourneyResults === "function") {
    renderJourneyResults = function() {
      const box = document.querySelector("#journeyResults");
      if (!box) return;
      const list = listResults();
      if (!list.length) {
        box.innerHTML = '<div class="empty">暫時搵唔到路線資料。系統會由附近車站擴大搜尋；即使未有 ETA，找到實際路線都會保留顯示。</div>';
        return;
      }
      box.innerHTML = list.map((r,i) => {
        const e = estimate(r);
        const liveClass = e.live ? "" : " dz-no-live";
        if (r.kind === "transfer") {
          return `<article class="journey-card dz-clickable${liveClass}" data-dz-journey-index="${i}" tabindex="0" role="button"><div class="journey-rank">${i+1}</div><div class="journey-main"><div class="journey-top"><div class="journey-lines"><span>${routeBadge(r.first.operator)} <strong>${esc(r.first.route)}</strong></span><span class="arrow">→</span><span>${routeBadge(r.second.operator)} <strong>${esc(r.second.route)}</strong></span></div><div class="journey-total">約 ${e.total} 分鐘</div></div><div class="journey-title">${esc(stopLabel(r.first.originStop))} → ${esc(transferName(r))} → ${esc(stopLabel(r.second.destinationStop))}</div><div class="journey-meta">轉 1 次 · 約 ${r.stopCount} 個站 · ${walkText(r.walkMeters)}${fareText(r)}</div><div class="journey-note">${esc(statusText(r))} · 已計轉車等候；如果直接步行更快／更平，直達方案會優先。</div></div></article>`;
        }
        return `<article class="journey-card dz-clickable${liveClass}" data-dz-journey-index="${i}" tabindex="0" role="button"><div class="journey-rank">${i+1}</div><div class="journey-main"><div class="journey-top"><div>${routeBadge(r.operator)} <strong class="journey-route">${esc(r.route)}</strong></div><div class="journey-total">約 ${e.total} 分鐘</div></div><div class="journey-title">${esc(stopLabel(r.originStop))} → ${esc(stopLabel(r.destinationStop))}</div><div class="journey-meta">直達 · 約 ${r.stopCount} 個站 · ${walkText(r.walkMeters)}${fareText(r)}</div><div class="journey-note">${esc(statusText(r))}${r.meta?.dest ? ` · 往 ${esc(r.meta.dest)}` : ""}</div></div></article>`;
      }).join("");
      box._dzRenderedList = list;
    };
  }

  function openDetail(index) {
    const box = document.querySelector("#journeyResults");
    const list = box?._dzRenderedList || listResults();
    const r = list[Number(index)];
    if (!r) return;
    document.querySelector(".dz-journey-sheet-backdrop")?.remove();
    const e = estimate(r);
    const fare = resultFare(r);
    let body = "";
    if (r.kind === "transfer") {
      body = `<div class="dz-step"><b>1</b><div><strong>${esc(r.first.route)}</strong> ${esc(stopLabel(r.first.originStop))} → ${esc(transferName(r))}<small>${r.firstEta ? `${esc(etaLabel(r.firstEta))}到站` : "未有班次預報"} · 估算車程約 ${e.firstRide} 分鐘</small></div></div><div class="dz-step"><b>2</b><div><strong>${esc(r.second.route)}</strong> ${esc(transferName(r))} → ${esc(stopLabel(r.second.destinationStop))}<small>${r.secondEta ? `現有預報 ${esc(etaLabel(r.secondEta))}` : "未有班次預報"} · 估算轉車等候約 ${e.secondWait} 分鐘 · 車程約 ${e.secondRide} 分鐘</small></div></div>`;
    } else {
      body = `<div class="dz-step"><b>1</b><div><strong>${esc(r.route)}</strong> ${esc(stopLabel(r.originStop))} → ${esc(stopLabel(r.destinationStop))}<small>${r.eta ? `${esc(etaLabel(r.eta))}到站` : "未有班次預報"} · 估算車程約 ${e.ride} 分鐘</small></div></div>`;
    }
    const modal = document.createElement("div");
    modal.className = "dz-journey-sheet-backdrop";
    modal.innerHTML = `<section class="dz-journey-sheet"><div class="quick-modal-handle"></div><div class="dz-sheet-head"><div><h3>點對點方案</h3><p>全程約 ${e.total} 分鐘</p></div><button type="button" data-dz-close>×</button></div><div class="dz-summary"><span>${walkText(r.walkMeters)}</span><span>${fare ? `總車費約 $${fare.toFixed(1)}` : "車費未有資料"}</span><span>${esc(statusText(r))}</span></div>${body}<p class="dz-disclaimer">時間為估算，已計步行、候車及轉車等候；實際時間會受交通及班次影響。</p></section>`;
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

  const style = document.createElement("style");
  style.textContent = `.journey-card.dz-clickable{cursor:pointer}.journey-card.dz-no-live{opacity:.78}.journey-total{font-size:18px;font-weight:850;white-space:nowrap}.dz-journey-sheet-backdrop{position:fixed;inset:0;background:rgba(0,0,0,.36);z-index:10000;display:flex;align-items:flex-end;justify-content:center}.dz-journey-sheet{width:min(100%,620px);max-height:84vh;overflow:auto;background:#fff;border-radius:22px 22px 0 0;padding:14px 16px calc(20px + env(safe-area-inset-bottom));box-shadow:0 -12px 35px rgba(0,0,0,.22);color:#111}.dz-sheet-head{display:flex;align-items:flex-start;justify-content:space-between;gap:12px}.dz-sheet-head h3{margin:0;font-size:20px}.dz-sheet-head p{margin:4px 0 0;font-size:18px;font-weight:850}.dz-sheet-head button{width:36px;height:36px;border:0;border-radius:50%;font-size:24px}.dz-summary{display:flex;gap:7px;flex-wrap:wrap;margin:14px 0}.dz-summary span{padding:6px 9px;border-radius:999px;background:#f3f4f6;font-size:12px}.dz-step{display:grid;grid-template-columns:30px 1fr;gap:10px;padding:12px 0;border-top:1px solid #eee}.dz-step>b{width:28px;height:28px;border-radius:50%;display:grid;place-items:center;background:#111;color:#fff}.dz-step strong{font-size:18px}.dz-step small{display:block;margin-top:5px;line-height:1.4;opacity:.68}.dz-disclaimer{font-size:11px;line-height:1.45;opacity:.55;margin:12px 0 0}@media(prefers-color-scheme:dark){.dz-journey-sheet{background:#1c1c1e;color:#fff}.dz-summary span{background:#2c2c2e}.dz-step{border-color:#333}.dz-step>b{background:#fff;color:#111}}`;
  document.head.appendChild(style);

  function sanitizeZeroFares(root=document) {
    root.querySelectorAll?.(".dz-route-fare,.dz-header-fare,.dz-stop-fare,.near-fare").forEach(el => {
      if (/\$0(?:\.0+)?(?:\D|$)/.test(el.textContent || "")) el.textContent = "車費未有資料";
    });
  }

  const observer = new MutationObserver(() => {
    normalizeStoredPlaces();
    cleanQuickDom();
    sanitizeZeroFares();
  });
  observer.observe(document.documentElement, {subtree:true, childList:true});
  sanitizeZeroFares();

  window.dzJourneyFixVersion = "3.6.1";
})();
