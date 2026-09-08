const BUILD = "4.0.3";

// Temporary Safari safe mode: this worker exists only to retire any previously
// installed worker/cache. It deliberately does not intercept fetches.
self.addEventListener("install", event => {
  self.skipWaiting();
});

self.addEventListener("activate", event => {
  event.waitUntil((async () => {
    try {
      const keys = await caches.keys();
      await Promise.all(keys.map(key => caches.delete(key)));
    } catch {}
    try { await self.registration.unregister(); } catch {}
    try {
      const windows = await self.clients.matchAll({type:"window", includeUncontrolled:true});
      await Promise.all(windows.map(async client => {
        try {
          const u = new URL(client.url);
          if (u.origin !== self.location.origin) return;
          if (u.searchParams.get("build") === BUILD) return;
          u.searchParams.set("build", BUILD);
          u.searchParams.set("_", Date.now().toString());
          await client.navigate(u.toString());
        } catch {}
      }));
    } catch {}
  })());
});
