const CACHE = "daozhan-v3.1.0";
const CORE = ["./", "./index.html", "./styles.css", "./app.js", "./fare.js", "./manifest.json", "./icon.svg"];
const DATA = ["./ctb-stops.json", "./kmb-stops.json", "./ctb-routes.json", "./kmb-routes.json", ...Array.from({length:8},(_,i)=>`./gmb-routes-${i}.json`), ...Array.from({length:16},(_,i)=>`./gmb-stops-${i}.json`)];
self.addEventListener("install", event => {
  self.skipWaiting();
  event.waitUntil(caches.open(CACHE).then(cache => cache.addAll(CORE).then(() => Promise.allSettled(DATA.map(path => cache.add(path))))));
});
self.addEventListener("activate", event => event.waitUntil(Promise.all([caches.keys().then(keys => Promise.all(keys.filter(key => key !== CACHE).map(key => caches.delete(key)))), self.clients.claim()])));
self.addEventListener("fetch", event => {
  if (event.request.method !== "GET") return;
  const url = new URL(event.request.url);
  if (url.hostname !== self.location.hostname) return;
  event.respondWith(fetch(event.request).then(response => { if (response.ok) { const copy = response.clone(); caches.open(CACHE).then(cache => cache.put(event.request, copy)); } return response; }).catch(() => caches.match(event.request)));
});
