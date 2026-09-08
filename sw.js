const CACHE = "daozhan-v3.10.5";
const CORE = ["./", "./index.html", "./styles.css", "./journey.css", "./next-features.css", "./v384-stability.css", "./v386-ranking-details.css", "./v391-maps.css", "./v393-nearby-map.css", "./v395-map-toggle.css", "./v3103-nearby-priority.js", "./app.js", "./kmb-live.js", "./stop-nearby.js", "./fare.js", "./watch-sync.js", "./journey.js", "./journey-ctb-fix.js", "./traffic-regions.js", "./next-features.js", "./transit-extra.js", "./v36-enhancements.js", "./v361-journey-fix.js", "./legacy-demo-cleanup.js", "./journey-place-fix.js", "./v364-area-routing.js", "./v365-mtr-fallback.js", "./v366-fast-journey.js", "./v367-network-bridge.js", "./v3610-speed-ui.js", "./v3612-journey-live-filter.js", "./v370-routing-engine.js", "./v370-journey-ui.js", "./v371-access-progress.js", "./v371-ui-fix.js", "./v372-late-transfer-fallback.js", "./v373-candidate-final-filter.js", "./v375-nearby-stop-walk.js", "./v378-mtr-pipeline.js", "./v379-district-corridor.js", "./v380-east-rail.js", "./v381-service-window.js", "./v383-routing-tune.js", "./v384-stability.js", "./v385-stability.js", "./v386-ranking-details.js", "./v390-network-core.js", "./v391-local-transit-db.js", "./v391-maps.js", "./v393-nearby-map.js", "./v395-map-toggle.js", "./v396-time-stability.js", "./v397-nearby-seed-routing.js", "./v3100-live-transfer-time.js", "./v3101-gateway-diversity.js", "./service-windows.json", "./manifest.json", "./icon.svg", "./watch/", "./watch/index.html", "./watch/watch.css", "./watch/watch.js", "./watch/sync.js"];

// Safari stability: only pre-cache the app shell. Large route/stop shards are
// runtime-cached on demand. v3.10.5 keeps GMB/MTR dormant until nearby or
// point-to-point search actually needs them.
self.addEventListener("install", event => {
  self.skipWaiting();
  event.waitUntil(caches.open(CACHE).then(cache => cache.addAll(CORE)));
});

self.addEventListener("activate", event => event.waitUntil(Promise.all([
  caches.keys().then(keys => Promise.all(keys.filter(key => key !== CACHE).map(key => caches.delete(key)))),
  self.clients.claim()
])));

self.addEventListener("fetch", event => {
  if (event.request.method !== "GET") return;
  const url = new URL(event.request.url);
  if (url.hostname !== self.location.hostname) return;
  event.respondWith(fetch(event.request).then(response => {
    if (response.ok) {
      const copy = response.clone();
      caches.open(CACHE).then(cache => cache.put(event.request, copy));
    }
    return response;
  }).catch(() => caches.match(event.request)));
});