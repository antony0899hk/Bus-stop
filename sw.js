// Retired worker: no cache mutation and no client navigation.
self.addEventListener("install",()=>self.skipWaiting());
self.addEventListener("activate",event=>event.waitUntil(self.clients.claim()));
