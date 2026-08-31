(() => {
  "use strict";

  let searchToken = 0;
  const FIRST_RESULT_BUDGET = 8500;
  const INDEX_BUDGET = 5000;
  const ENRICH_BUDGET = 4500;

  const $ = s => document.querySelector(s);
  const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
  const timeout = (promise, ms, fallback = null) => Promise.race([
    Promise.resolve(promise).catch(() => fallback),
    delay(ms).then(() => fallback)
  ]);

  function snapshotInputs() {
    return {
      from: $("#journeyFrom")?.value || "",
      to: $("#journeyTo")?.value || "",
      mode: journeyState?.mode || "fastest"
    };
  }

  function restoreInputs(snap) {
    if (!snap) return;
    const from = $("#journeyFrom"), to = $("#journeyTo");
    if (from && snap.from && from.value !== snap.from) from.value = snap.from;
    if (to && snap.to && to.value !== snap.to) to.value = snap.to;
    if (journeyState && snap.mode) journeyState.mode = snap.mode;
  }

  function currentLocation(timeoutMs = 4000) {
    if (journeyState?.originLocation) return Promise.resolve(journeyState.originLocation);
    if (!navigator.geolocation) return Promise.resolve(null);
    return new Promise(resolve => {
      let settled = false;
      const done = value => { if (!settled) { settled = true; resolve(value); } };
      const timer = setTimeout(() => done(null), timeoutMs);
      navigator.geolocation.getCurrentPosition(pos => {
        clearTimeout(timer);
        const loc = { lat:pos.coords.latitude, lon:pos.coords.longitude };
        journeyState.originLocation = loc;
        done(loc);
      }, () => { clearTimeout(timer); done(null); }, {
        enableHighAccuracy:true, timeout:timeoutMs, maximumAge:30000
      });
    });
  }

  function dedupe(rows) {
    const map = new Map();
    for (const r of rows || []) {
      if (!r) continue;
      const key = r.kind === "transfer"
        ? `${r.first?.operator}|${r.first?.route}|${r.transferStopId}|${r.second?.operator}|${r.second?.route}|${r.second?.destinationStop?.id || ""}`
        : `${r.operator}|${r.route}|${r.originStop?.id || ""}|${r.destinationStop?.id || ""}`;
      if (!map.has(key)) map.set(key, r);
    }
    return [...map.values()];
  }

  function renderFastStatus(text) {
    const st = $("#journeyStatus");
    if (st) st.textContent = text;
  }

  function renderSafe(snap) {
    try { renderJourneyResults(); } catch {}
    restoreInputs(snap);
  }

  async function enrichDirect(rows, token, snap) {
    const jobs = rows.filter(r => r.kind === "direct" && r.operator !== "MTR").slice(0, 14).map(async r => {
      const [eta, fare] = await Promise.all([
        timeout(typeof journeyEta === "function" ? journeyEta(r) : null, ENRICH_BUDGET, null),
        timeout(typeof journeyFare === "function" ? journeyFare(r) : null, ENRICH_BUDGET, null)
      ]);
      if (token !== searchToken) return;
      if (eta) r.eta = eta;
      if (fare != null && Number(fare) > 0) r.fare = Number(fare);
    });
    await Promise.allSettled(jobs);
    if (token !== searchToken) return;
    renderSafe(snap);
  }

  async function addGmb(origin, destination, token, snap) {
    if (typeof gmbDirect !== "function") return;
    const rows = await timeout(gmbDirect(origin, destination), 6500, []);
    if (token !== searchToken || !Array.isArray(rows) || !rows.length) return;
    journeyState.results = dedupe([...journeyState.results, ...rows]);
    renderSafe(snap);
    enrichDirect(rows, token, snap).catch(() => {});
  }

  async function addMtr(token, snap) {
    if (typeof window.dzAddMtrFallback !== "function") return;
    const added = await timeout(window.dzAddMtrFallback(), 5000, false);
    if (token !== searchToken) return;
    if (added) renderSafe(snap);
  }

  async function fastJourneySearch() {
    const token = ++searchToken;
    const button = $("#journeySearchBtn");
    const box = $("#journeyResults");
    const started = Date.now();

    if (!button || !box) return;

    let fromValue = $("#journeyFrom")?.value?.trim() || "";
    const toValue = $("#journeyTo")?.value?.trim() || "";
    if (!toValue) {
      renderFastStatus("請先輸入終點。");
      return;
    }

    button.disabled = true;

    if (!fromValue) {
      renderFastStatus("未填起點，正在使用你目前位置…");
      const loc = await currentLocation(4000);
      if (!loc) {
        button.disabled = false;
        renderFastStatus("未能取得目前位置，請允許定位或輸入起點。");
        return;
      }
      fromValue = "我的位置";
      const from = $("#journeyFrom");
      if (from) from.value = fromValue;
    } else if (fromValue === "我的位置" && !journeyState.originLocation) {
      renderFastStatus("正在更新目前位置…");
      const loc = await currentLocation(4000);
      if (!loc) {
        button.disabled = false;
        renderFastStatus("未能取得目前位置，請再試一次或輸入起點。");
        return;
      }
    }

    const snap = snapshotInputs();
    box.innerHTML = '<div class="loading">正在快速建立路線…</div>';
    renderFastStatus("先搵可行路線，ETA／車費會喺結果出現後補上…");

    try {
      const indexReady = await timeout(ensureJourneyIndexes(), INDEX_BUDGET, false);
      if (token !== searchToken) return;

      const origin = resolvePlace(fromValue, journeyState.originLocation);
      const destination = resolvePlace(toValue, null);

      if (!origin.length || !destination.length) {
        journeyState.results = [];
        renderSafe(snap);
        renderFastStatus("搵唔到起點或終點附近車站，請用較短地名／站名再試。");
        return;
      }

      const baseRows = [];
      if (indexReady !== false) {
        if (journeyState.kmbIndex) {
          baseRows.push(...directFromIndex(journeyState.kmbIndex, origin.filter(x => x.operator === "KMB"), destination.filter(x => x.operator === "KMB")));
          baseRows.push(...oneTransferFromIndex(journeyState.kmbIndex, origin, destination));
        }
        if (journeyState.ctbIndex) {
          baseRows.push(...directFromIndex(journeyState.ctbIndex, origin.filter(x => x.operator === "CTB"), destination.filter(x => x.operator === "CTB")));
          baseRows.push(...oneTransferFromIndex(journeyState.ctbIndex, origin, destination));
        }
      }

      journeyState.results = dedupe(baseRows).slice(0, 40);
      renderSafe(snap);

      const elapsed = Date.now() - started;
      if (journeyState.results.length) {
        renderFastStatus(`先顯示 ${journeyState.results.length} 個候選方案（${(elapsed/1000).toFixed(1)} 秒）。ETA／車費及其他交通工具正背景更新…`);
      } else {
        renderFastStatus("巴士基本路線暫未找到，正在補充小巴／港鐵方案…");
      }

      const background = [
        enrichDirect(journeyState.results, token, snap),
        addGmb(origin, destination, token, snap),
        addMtr(token, snap)
      ];

      timeout(Promise.allSettled(background), Math.max(1000, FIRST_RESULT_BUDGET - elapsed), null).then(() => {
        if (token !== searchToken) return;
        renderSafe(snap);
        const total = journeyState.results.length;
        const seconds = ((Date.now() - started) / 1000).toFixed(1);
        renderFastStatus(total
          ? `找到 ${total} 個候選方案（${seconds} 秒內先出路線，ETA／車費可能繼續更新）。`
          : "10 秒內暫未找到可行方案；可以改用較闊地名，系統亦會保留你輸入內容。"
        );
      }).catch(() => {});
    } catch (e) {
      box.innerHTML = '<div class="error">點到點搜尋暫時失敗，其他 ETA 功能仍可使用。</div>';
      renderFastStatus(`搜尋失敗：${e?.message || "未知錯誤"}`);
      restoreInputs(snap);
    } finally {
      button.disabled = false;
      restoreInputs(snap);
    }
  }

  if (typeof runJourneySearch === "function") runJourneySearch = fastJourneySearch;
  window.dzFastJourneySearch = fastJourneySearch;
})();
