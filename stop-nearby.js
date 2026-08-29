(() => {
  const STOP_RADIUS_METERS = 100;
  let catalogsPromise = null;

  function distanceMeters(aLat, aLon, bLat, bLon) {
    const R = 6371000;
    const toRad = x => x * Math.PI / 180;
    const p1 = toRad(aLat), p2 = toRad(bLat);
    const dp = toRad(bLat - aLat), dl = toRad(bLon - aLon);
    const h = Math.sin(dp / 2) ** 2 + Math.cos(p1) * Math.cos(p2) * Math.sin(dl / 2) ** 2;
    return 2 * R * Math.asin(Math.sqrt(h));
  }

  async function getLocalJSON(path) {
    const res = await fetch(path, { cache: "force-cache", headers: { Accept: "application/json" } });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return res.json();
  }

  function toMap(data) {
    const map = new Map();
    for (const s of data || []) {
      const id = String(s.stop ?? s.stop_id ?? s.id ?? "");
      if (id) map.set(id, s);
    }
    return map;
  }

  async function loadCatalogs() {
    if (catalogsPromise) return catalogsPromise;
    catalogsPromise = Promise.all([
      getLocalJSON("./kmb-stops.json"),
      getLocalJSON("./ctb-stops.json"),
      getLocalJSON("./gmb-stops.json")
    ]).then(([kmb, ctb, gmb]) => ({
      KMB: toMap(kmb.data || kmb),
      CTB: toMap(ctb.data || ctb),
      GMB: toMap(gmb.data || gmb)
    })).catch(error => {
      catalogsPromise = null;
      throw error;
    });
    return catalogsPromise;
  }

  function currentOperator() {
    const badge = document.querySelector("#routeHeader .badge");
    if (!badge) return null;
    if (badge.classList.contains("ctb")) return "CTB";
    if (badge.classList.contains("gmb")) return "GMB";
    return "KMB";
  }

  function coords(stop) {
    const lat = Number(stop?.lat ?? stop?.latitude);
    const lon = Number(stop?.long ?? stop?.lng ?? stop?.longitude);
    return Number.isFinite(lat) && Number.isFinite(lon) ? { lat, lon } : null;
  }

  function decorateStopNames(root = document) {
    root.querySelectorAll?.("#stops .stop-name").forEach(el => {
      if (el.dataset.stopNearbyReady) return;
      el.dataset.stopNearbyReady = "1";
      el.setAttribute("role", "button");
      el.setAttribute("tabindex", "0");
      el.setAttribute("aria-label", `${el.textContent.trim()}：查看此站附近路線`);
      el.title = "查看此站附近路線";
      el.classList.add("stop-nearby-link");
    });
  }

  async function openStopNearby(nameEl) {
    const row = nameEl.closest(".stop-row");
    const stopId = row?.dataset.stopId;
    const operator = currentOperator();
    if (!stopId || !operator) return;

    const status = document.querySelector("#nearbyStatus");
    const stopName = nameEl.textContent.trim() || "此站";
    if (status) status.textContent = `正在搜尋「${stopName}」100m 內路線…`;
    nameEl.setAttribute("aria-busy", "true");

    try {
      const catalogs = await loadCatalogs();
      const originStop = catalogs[operator].get(String(stopId));
      const origin = coords(originStop);
      if (!origin) throw new Error("站點座標暫時不可用");

      const nearbyStops = [];
      for (const op of ["KMB", "CTB", "GMB"]) {
        const candidates = [];
        for (const [id, stopObj] of catalogs[op]) {
          const c = coords(stopObj);
          if (!c) continue;
          const distance = distanceMeters(origin.lat, origin.lon, c.lat, c.lon);
          if (distance <= STOP_RADIUS_METERS) {
            candidates.push({ operator: op, stop: String(id), stopObj, distance });
          }
        }
        candidates.sort((a, b) => a.distance - b.distance);
        nearbyStops.push(...candidates.slice(0, 15));
      }

      if (typeof loadNearbyEtas !== "function") throw new Error("附近 ETA 功能未載入");
      await loadNearbyEtas(nearbyStops);
      if (status) status.textContent = `已顯示「${stopName}」100m 內即將到站路線。`;
      document.querySelector("#nearbySection")?.scrollIntoView({ behavior: "smooth", block: "start" });
    } catch (error) {
      if (status) status.textContent = `未能載入「${stopName}」附近路線：${error.message}`;
    } finally {
      nameEl.removeAttribute("aria-busy");
    }
  }

  document.addEventListener("click", event => {
    const nameEl = event.target.closest?.("#stops .stop-name");
    if (!nameEl) return;
    event.preventDefault();
    openStopNearby(nameEl);
  });

  document.addEventListener("keydown", event => {
    if (event.key !== "Enter" && event.key !== " ") return;
    const nameEl = event.target.closest?.("#stops .stop-name");
    if (!nameEl) return;
    event.preventDefault();
    openStopNearby(nameEl);
  });

  const observer = new MutationObserver(() => decorateStopNames());
  observer.observe(document.documentElement, { childList: true, subtree: true });
  decorateStopNames();

  const style = document.createElement("style");
  style.textContent = `
    #stops .stop-nearby-link {
      cursor: pointer;
      text-decoration: underline;
      text-decoration-style: dotted;
      text-underline-offset: 3px;
      touch-action: manipulation;
    }
    #stops .stop-nearby-link::after {
      content: "  ›";
      opacity: .5;
      font-weight: 700;
    }
    #stops .stop-nearby-link:focus-visible {
      outline: 2px solid currentColor;
      outline-offset: 3px;
      border-radius: 4px;
    }
  `;
  document.head.appendChild(style);
})();
