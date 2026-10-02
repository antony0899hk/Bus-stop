(() => {
  "use strict";
  const MAX_HIGHLIGHT_DISTANCE = 1500;
  let currentLocation = null;
  let locatePromise = null;
  let countdownTimer = null;

  function remember(position) {
    const source = position?.coords || position || {};
    const lat = Number(source.latitude ?? source.lat);
    const lon = Number(source.longitude ?? source.lon ?? source.lng ?? source.long);
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
    currentLocation = { lat, lon, accuracy:Number(source.accuracy) || null, updatedAt:Date.now() };
    return currentLocation;
  }

  function find(stops, coordsFor, location = currentLocation) {
    if (!location || !Array.isArray(stops) || typeof coordsFor !== "function") return null;
    let nearest = null;
    stops.forEach((stop, index) => {
      const coords = coordsFor(stop, index) || {};
      const lat = Number(coords.lat ?? coords.latitude);
      const lon = Number(coords.lon ?? coords.lng ?? coords.long ?? coords.longitude);
      if (!Number.isFinite(lat) || !Number.isFinite(lon)) return;
      const distance = distanceMeters(location.lat, location.lon, lat, lon);
      if (!nearest || distance < nearest.distance) nearest = { index, distance };
    });
    return nearest;
  }

  function locate() {
    if (typeof navigator === "undefined" || !navigator.geolocation) return Promise.resolve(null);
    if (locatePromise) return locatePromise;
    locatePromise = new Promise(resolve => navigator.geolocation.getCurrentPosition(
      position => resolve(remember(position)),
      () => resolve(null),
      { enableHighAccuracy:false, maximumAge:30000, timeout:6000 }
    )).finally(() => { locatePromise = null; });
    return locatePromise;
  }

  function decorate(stops, coordsFor, root = document.querySelector("#stops")) {
    if (!root) return null;
    const rows = [...root.querySelectorAll(".stop-row")];
    rows.forEach(row => row.classList.remove("nearest-stop"));
    root.querySelectorAll(".nearest-stop-badge").forEach(badge => badge.remove());
    const nearest = find(stops, coordsFor);
    if (!nearest || nearest.distance > MAX_HIGHLIGHT_DISTANCE || !rows[nearest.index]) return null;
    const row = rows[nearest.index];
    row.classList.add("nearest-stop");
    const name = row.querySelector(".stop-name");
    if (name) {
      const badge = (root.ownerDocument || document).createElement("div");
      badge.className = "nearest-stop-badge";
      badge.textContent = `📍 最近車站 · ${Math.round(nearest.distance)}米`;
      name.insertAdjacentElement("afterend", badge);
    }
    return nearest;
  }

  function refreshEtaCountdown(root = document) {
    if (typeof etaLabel !== "function") return;
    root.querySelectorAll("[data-route-eta]").forEach(node => {
      const eta = node.dataset.routeEta;
      if (eta) node.textContent = etaLabel(eta);
    });
  }

  function startCountdown() {
    if (countdownTimer !== null || typeof setInterval !== "function") return;
    countdownTimer = setInterval(() => { if (!document.hidden) refreshEtaCountdown(); }, 10000);
  }

  startCountdown();
  window.addEventListener?.("visibilitychange", () => { if (!document.hidden) refreshEtaCountdown(); });
  window.addEventListener?.("pageshow", refreshEtaCountdown);

  window.dzNearestStop = { version:"5.4.3", remember, locate, find, decorate, refreshEtaCountdown, maxDistance:MAX_HIGHLIGHT_DISTANCE };
})();
