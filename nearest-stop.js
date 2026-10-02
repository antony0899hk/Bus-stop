(() => {
  "use strict";
  const MAX_HIGHLIGHT_DISTANCE = 1500;
  let currentLocation = null;

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

  window.dzNearestStop = { version:"5.4.2", remember, find, decorate, maxDistance:MAX_HIGHLIGHT_DISTANCE };
})();
