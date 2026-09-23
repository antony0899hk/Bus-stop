// Citybus journey-planner compatibility layer.
// The old Citybus V1 bulk route-stop endpoint was retired. For the planner's
// static route graph, use the same maintained bulk database source already
// used to prepare the app's Citybus stop dataset. Live route detail and ETA
// requests continue to use the official Citybus V2 API in app.js/journey.js.

const JOURNEY_CTB_BULK_SOURCES = [
  "https://data.hkbus.app/routeFareList.min.json",
  "https://hkbus.github.io/hk-bus-crawling/routeFareList.min.json"
];

async function buildCtbJourneyIndexV2Compat() {
  let lastError = null;

  for (const url of JOURNEY_CTB_BULK_SOURCES) {
    try {
      const db = await getJSON(url, { ttl: 12 * 60 * 60 * 1000, retries: 0 });
      const routeList = db?.routeList || {};
      const rows = [];

      for (const entry of Object.values(routeList)) {
        const companies = Array.isArray(entry?.co) ? entry.co.map(x => String(x).toLowerCase()) : [];
        if (!companies.includes("ctb")) continue;

        const route = String(entry?.route || "");
        const bound = String(entry?.bound?.ctb || "").toUpperCase();
        const stops = entry?.stops?.ctb;
        if (!route || !["O", "I"].includes(bound) || !Array.isArray(stops) || !stops.length) continue;

        const serviceType = String(entry?.serviceType || 1);
        stops.forEach((stop, index) => {
          if (stop == null || stop === "") return;
          rows.push({
            route,
            stop: String(stop),
            bound,
            service_type: serviceType,
            seq: index + 1
          });
        });
      }

      if (!rows.length) throw new Error("Citybus bulk route graph is empty");
      return buildRouteIndex(rows, "CTB");
    } catch (error) {
      lastError = error;
    }
  }

  throw lastError || new Error("Citybus route graph unavailable");
}

// Replace only the index-building stage. This keeps all existing journey
// rendering, ETA, fare and sorting behaviour unchanged.
ensureJourneyIndexes = async function ensureJourneyIndexesFixed() {
  if (journeyState.kmbIndex && journeyState.ctbIndex) return;
  if (journeyState.indexPromise) return journeyState.indexPromise;

  journeyState.indexPromise = (async () => {
    const jobs = [];

    if (!journeyState.kmbIndex) {
      jobs.push(
        getJSON(JOURNEY_KMB_ROUTE_STOP, { ttl: 12 * 60 * 60 * 1000, retries: 1 })
          .then(j => { journeyState.kmbIndex = buildRouteIndex(j.data || [], "KMB"); })
      );
    }

    if (!journeyState.ctbIndex) {
      jobs.push(
        buildCtbJourneyIndexV2Compat()
          .then(index => { journeyState.ctbIndex = index; })
      );
    }

    await Promise.allSettled(jobs);

    if (!journeyState.kmbIndex && !journeyState.ctbIndex) {
      throw new Error("暫時未能建立巴士路線索引");
    }
  })().finally(() => { journeyState.indexPromise = null; });

  return journeyState.indexPromise;
};
