(() => {
  "use strict";

  const $ = s => document.querySelector(s);
  const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
  let activeToken = 0;

  const isNightRoute = route => /^(N|NA)\d/i.test(String(route || "").trim());
  const isNightHours = () => {
    const d = new Date();
    const mins = d.getHours() * 60 + d.getMinutes();
    return mins >= 90 && mins < 300;
  };

  async function fetchEta(op, stopId, route, bound, serviceType = "1") {
    try {
      if (!stopId || !route) return null;
      if (op === "KMB") {
        const j = await getJSON(`${KMB_API}/eta/${encodeURIComponent(stopId)}/${encodeURIComponent(route)}/${encodeURIComponent(serviceType || "1")}`, { ttl:0, retries:0 });
        const rows = (j.data || [])
          .filter(x => (!bound || !x.dir || String(x.dir).toUpperCase() === String(bound).toUpperCase()) && validFutureEta(x.eta))
          .sort((a,b) => new Date(a.eta) - new Date(b.eta));
        return rows[0]?.eta || null;
      }
      if (op === "CTB") {
        const j = await getJSON(`${CTB_API}/eta/ctb/${encodeURIComponent(stopId)}/${encodeURIComponent(route)}`, { ttl:0, retries:0 });
        const rows = (j.data || [])
          .filter(x => (!bound || !x.dir || String(x.dir).toUpperCase() === String(bound).toUpperCase()) && validFutureEta(x.eta))
          .sort((a,b) => new Date(a.eta) - new Date(b.eta));
        return rows[0]?.eta || null;
      }
    } catch {}
    return null;
  }

  async function enrichCandidate(r) {
    if (!r) return r;
    if (r.kind === "transfer") {
      if (!isNightHours() && (isNightRoute(r.first?.route) || isNightRoute(r.second?.route))) {
        r._dzLiveEligible = false;
        r._dzRejectReason = "night-route";
        return r;
      }
      const [firstEta, secondEta] = await Promise.all([
        fetchEta(r.first?.operator, r.first?.originStop?.id, r.first?.route, r.first?.bound, r.first?.serviceType),
        fetchEta(r.second?.operator, r.transferStopId, r.second?.route, r.second?.bound, r.second?.serviceType)
      ]);
      r.firstEta = firstEta;
      r.secondEta = secondEta;
      r.eta = firstEta || null;
      r._dzLiveEligible = Boolean(firstEta && secondEta);
      if (!r._dzLiveEligible) r._dzRejectReason = "missing-live-eta";
      return r;
    }

    if (!isNightHours() && isNightRoute(r.route)) {
      r._dzLiveEligible = false;
      r._dzRejectReason = "night-route";
      return r;
    }
    const eta = r.eta || await fetchEta(r.operator, r.originStop?.id, r.route, r.bound, r.serviceType);
    if (eta) r.eta = eta;
    r._dzLiveEligible = Boolean(eta || r.operator === "MTR" || r._dzMtrBridge);
    if (!r._dzLiveEligible) r._dzRejectReason = "missing-live-eta";
    return r;
  }

  async function applyLiveGate(token) {
    if (!Array.isArray(journeyState?.results)) return;
    const rows = journeyState.results.slice(0, 36);
    await Promise.allSettled(rows.map(enrichCandidate));
    if (token !== activeToken) return;

    const kept = journeyState.results.filter(r => r?._dzLiveEligible === true);
    const removed = journeyState.results.length - kept.length;
    journeyState.results = kept;

    try { renderJourneyResults(); } catch {}
    const st = $("#journeyStatus");
    if (st) {
      if (kept.length) {
        st.textContent = `已確認 ${kept.length} 個現時有實時班次方案${removed > 0 ? `；已隱藏 ${removed} 個未確認／非服務時段方案` : ""}。`;
      } else {
        st.textContent = "暫時未搵到兩段都可確認實時班次嘅方案；不顯示估算路線，避免誤導。";
      }
    }
  }

  if (typeof runJourneySearch === "function") {
    const previous = runJourneySearch;
    runJourneySearch = async function() {
      const token = ++activeToken;
      await previous();
      // Let the existing fast-search layer seed candidates first, then validate live service.
      await delay(350);
      await applyLiveGate(token);
    };
  }

  window.dzApplyJourneyLiveGate = applyLiveGate;
})();
