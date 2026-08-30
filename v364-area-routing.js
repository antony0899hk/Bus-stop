(() => {
  "use strict";

  const AREA_RADIUS = 1000;
  const AREA_MIN_CLUSTER = 6;
  const EXPLICIT_NODE_RE = /(站|station|mtr|港鐵|地鐵)$/i;
  const norm = v => String(v || "").trim().toLowerCase().replace(/[\s　]+/g, "");

  function isExplicitNode(value) {
    return EXPLICIT_NODE_RE.test(String(value || "").trim());
  }

  function baseMatches(value) {
    if (typeof allJourneyStops !== "function") return [];
    const q = norm(value);
    if (!q) return [];
    return allJourneyStops().map(s => {
      const n = norm(s.name);
      let rank = 99;
      if (n === q) rank = 0;
      else if (n.startsWith(q)) rank = 1;
      else if (n.includes(q)) rank = 2;
      return { ...s, rank };
    }).filter(s => s.rank < 99)
      .sort((a,b) => a.rank - b.rank || String(a.name).length - String(b.name).length);
  }

  function representative(value) {
    const matches = baseMatches(value).filter(s => Number.isFinite(s.lat) && Number.isFinite(s.lon));
    if (!matches.length) return null;
    return matches[0];
  }

  function areaCluster(value) {
    if (isExplicitNode(value)) return [];
    const center = representative(value);
    if (!center || typeof distanceMeters !== "function") return [];
    const candidates = allJourneyStops()
      .filter(s => Number.isFinite(s.lat) && Number.isFinite(s.lon))
      .map(s => ({ ...s, distance: distanceMeters(center.lat, center.lon, s.lat, s.lon), areaCenter:center.name }))
      .filter(s => Number.isFinite(s.distance) && s.distance <= AREA_RADIUS)
      .sort((a,b) => a.distance - b.distance);
    return candidates.slice(0, Math.max(AREA_MIN_CLUSTER, 36));
  }

  if (typeof resolvePlace === "function") {
    const previousResolvePlace = resolvePlace;
    resolvePlace = function(value, location = null) {
      if (location) return previousResolvePlace(value, location);
      const exact = previousResolvePlace(value, null);
      if (isExplicitNode(value)) return exact;
      const clustered = areaCluster(value);
      if (!clustered.length) return exact;
      const merged = new Map();
      [...exact, ...clustered].forEach(s => {
        const key = `${s.operator}|${s.id}`;
        const old = merged.get(key);
        if (!old || (Number(s.distance)||0) < (Number(old.distance)||0)) merged.set(key, s);
      });
      return [...merged.values()].sort((a,b) => (Number(a.rank ?? 9)-Number(b.rank ?? 9)) || (Number(a.distance)||0)-(Number(b.distance)||0)).slice(0,40);
    };
  }

  window.dzDestinationIntent = function(value) {
    return isExplicitNode(value) ? "node" : "area";
  };
  window.dzAreaRadius = AREA_RADIUS;
})();
