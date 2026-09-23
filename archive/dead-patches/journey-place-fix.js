(() => {
  "use strict";

  const SMART_RADII = [300, 500, 800, 1000];
  if (typeof resolvePlace !== "function" || typeof allJourneyStops !== "function" || typeof distanceMeters !== "function") return;

  const baseResolvePlace = resolvePlace;

  function expandAroundAnchor(anchor, seedIds) {
    if (!anchor || !Number.isFinite(anchor.lat) || !Number.isFinite(anchor.lon)) return [];
    const all = allJourneyStops()
      .filter(s => Number.isFinite(s.lat) && Number.isFinite(s.lon))
      .map(s => ({ ...s, distance: distanceMeters(anchor.lat, anchor.lon, s.lat, s.lon) }))
      .sort((a,b) => a.distance - b.distance);

    let chosen = SMART_RADII[SMART_RADII.length - 1];
    for (const radius of SMART_RADII) {
      const count = all.filter(s => s.distance <= radius).length;
      chosen = radius;
      if (count >= 12 || (radius >= 500 && count >= 8)) break;
    }

    const picked = all.filter(s => s.distance <= chosen).slice(0, 36);
    const seen = new Set(picked.map(s => `${s.operator}|${s.id}`));
    for (const seed of seedIds) {
      const key = `${seed.operator}|${seed.id}`;
      if (!seen.has(key)) {
        picked.unshift({ ...seed, distance: 0 });
        seen.add(key);
      }
    }
    window.dzJourneyDestinationRadius = chosen;
    return picked.slice(0, 40);
  }

  resolvePlace = function(value, location = null) {
    if (location) return baseResolvePlace(value, location);

    const seeds = baseResolvePlace(value, null);
    if (!Array.isArray(seeds) || !seeds.length) return seeds;

    const usable = seeds.filter(s => Number.isFinite(s.lat) && Number.isFinite(s.lon));
    if (!usable.length) return seeds;

    // Prefer an exact/short-name match as the geographic anchor for area names
    // such as 葵芳, 旺角 or 尖沙咀, then include nearby stops whose names differ.
    const anchor = usable.slice().sort((a,b) => {
      const ar = Number.isFinite(a.rank) ? a.rank : 9;
      const br = Number.isFinite(b.rank) ? b.rank : 9;
      return ar - br || String(a.name || "").length - String(b.name || "").length;
    })[0];

    return expandAroundAnchor(anchor, usable);
  };
})();
