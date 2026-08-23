const CACHE = "daozhan-v2.1.2";
const ASSETS = ["./","./index.html","./styles.css","./app.js","./manifest.json","./icon.svg","./ctb-stops.json","./kmb-stops.json","./ctb-routes.json","./kmb-routes.json"];
self.addEventListener("install", e => e.waitUntil(caches.open(CACHE).then(c => c.addAll(ASSETS))));
self.addEventListener("activate", e => e.waitUntil(Promise.all([
  caches.keys().then(keys=>Promise.all(keys.filter(k=>k!==CACHE).map(k=>caches.delete(k)))),
  self.clients.claim()
])));
self.addEventListener("fetch", e => {
  if(e.request.method!=="GET")return;
  const u=new URL(e.request.url);
  if(u.hostname!==self.location.hostname)return;
  e.respondWith(fetch(e.request).then(r=>{const copy=r.clone();caches.open(CACHE).then(c=>c.put(e.request,copy));return r;}).catch(()=>caches.match(e.request)));
});
