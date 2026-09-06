(() => {
  "use strict";

  const VERSION = "3.9.1";
  const DB_NAME = "daozhan-transit-db";
  const STORE = "datasets";
  const DB_VERSION = 1;
  const REFRESH_MS = 15 * 24 * 60 * 60 * 1000;
  const MASTER_KMB = "https://data.etabus.gov.hk/v1/transport/kmb/route-stop";
  const MASTER_CTB = "https://rt.data.gov.hk/v1/transport/citybus-nwfb/route-stop/ctb";
  const BUS_FARE = "https://static.data.gov.hk/td/routes-fares-xml/FARE_BUS.xml";
  const GMB_FARE = "https://static.data.gov.hk/td/routes-fares-xml/FARE_GMB.xml";

  let dbPromise = null;
  const inFlightRefresh = new Map();

  function openDb() {
    if (!window.indexedDB) return Promise.resolve(null);
    if (dbPromise) return dbPromise;
    dbPromise = new Promise(resolve => {
      try {
        const req = indexedDB.open(DB_NAME, DB_VERSION);
        req.onupgradeneeded = () => {
          const db = req.result;
          if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE, { keyPath: "key" });
        };
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => resolve(null);
        req.onblocked = () => resolve(null);
      } catch { resolve(null); }
    });
    return dbPromise;
  }

  async function readRecord(key) {
    const db = await openDb();
    if (!db) return null;
    return new Promise(resolve => {
      try {
        const tx = db.transaction(STORE, "readonly");
        const req = tx.objectStore(STORE).get(key);
        req.onsuccess = () => resolve(req.result || null);
        req.onerror = () => resolve(null);
      } catch { resolve(null); }
    });
  }

  async function writeRecord(key, value, kind = "json") {
    const db = await openDb();
    if (!db) return;
    return new Promise(resolve => {
      try {
        const tx = db.transaction(STORE, "readwrite");
        tx.objectStore(STORE).put({ key, value, kind, savedAt: Date.now(), version: VERSION });
        tx.oncomplete = () => resolve();
        tx.onerror = () => resolve();
        tx.onabort = () => resolve();
      } catch { resolve(); }
    });
  }

  const ageOf = rec => rec?.savedAt ? Date.now() - Number(rec.savedAt) : Infinity;
  const isFresh = rec => ageOf(rec) < REFRESH_MS;

  function isLiveUrl(url) {
    const s = String(url || "");
    return /\/eta\//i.test(s) || /estimatedArrivals/i.test(s) || /getSchedule/i.test(s) || /traffic/i.test(s);
  }

  function isStaticTransitJson(url) {
    const s = String(url || "");
    if (isLiveUrl(s)) return false;
    if (/\/route-stop(?:\/|$)/i.test(s)) return true;
    if (/\/route\.php\?action=list/i.test(s)) return true;
    if (/\/stop\.php\?action=list/i.test(s)) return true;
    return false;
  }

  function deriveKmbRoute(master, url) {
    const m = String(url).match(/\/kmb\/route-stop\/([^/]+)\/(outbound|inbound)\/([^/?#]+)/i);
    if (!m || !Array.isArray(master?.data)) return null;
    const route = decodeURIComponent(m[1]);
    const bound = m[2].toLowerCase() === "outbound" ? "O" : "I";
    const serviceType = decodeURIComponent(m[3]);
    const data = master.data.filter(r => String(r.route) === route && String(r.bound) === bound && String(r.service_type || "1") === serviceType);
    return data.length ? { data } : null;
  }

  async function derivedFromMaster(url) {
    const kmb = await readRecord(`json:${MASTER_KMB}`);
    if (kmb?.value) {
      const d = deriveKmbRoute(kmb.value, url);
      if (d) return d;
    }
    return null;
  }

  const originalGetJSON = window.getJSON;

  async function refreshJson(url, opts) {
    const key = `json:${url}`;
    if (inFlightRefresh.has(key)) return inFlightRefresh.get(key);
    const p = Promise.resolve()
      .then(() => originalGetJSON(url, { ...(opts || {}), ttl: 0 }))
      .then(async value => { await writeRecord(key, value, "json"); return value; })
      .finally(() => inFlightRefresh.delete(key));
    inFlightRefresh.set(key, p);
    return p;
  }

  async function localGetJSON(url, opts = {}) {
    if (typeof originalGetJSON !== "function" || !isStaticTransitJson(url)) return originalGetJSON(url, opts);
    const key = `json:${url}`;
    const rec = await readRecord(key);
    if (rec?.value) {
      if (!isFresh(rec)) refreshJson(url, opts).catch(() => {});
      return rec.value;
    }

    const derived = await derivedFromMaster(url);
    if (derived) {
      writeRecord(key, derived, "json").catch(() => {});
      return derived;
    }

    try { return await refreshJson(url, opts); }
    catch (err) {
      const stale = await readRecord(key);
      if (stale?.value) return stale.value;
      throw err;
    }
  }

  if (typeof originalGetJSON === "function") {
    window.getJSON = localGetJSON;
    try { getJSON = localGetJSON; } catch {}
  }

  function parseXml(text) {
    const xml = new DOMParser().parseFromString(text, "text/xml");
    if (xml.querySelector("parsererror")) throw new Error("Fare XML parse error");
    return xml;
  }

  async function fetchFareText(url) {
    const res = await fetch(url, { cache: "no-cache" });
    if (!res.ok) throw new Error(`Fare HTTP ${res.status}`);
    const text = await res.text();
    await writeRecord(`text:${url}`, text, "text");
    return text;
  }

  const originalFareLoader = window.loadFareXml;
  async function localFareLoader(operator) {
    const url = operator === "GMB" ? GMB_FARE : BUS_FARE;
    const key = `text:${url}`;
    const rec = await readRecord(key);
    if (rec?.value) {
      if (!isFresh(rec)) fetchFareText(url).catch(() => {});
      try { return parseXml(rec.value); } catch {}
    }
    try { return parseXml(await fetchFareText(url)); }
    catch (err) {
      if (typeof originalFareLoader === "function") return originalFareLoader(operator);
      throw err;
    }
  }

  if (typeof originalFareLoader === "function") {
    window.loadFareXml = localFareLoader;
    try { loadFareXml = localFareLoader; } catch {}
  }

  async function warmCore() {
    const jobs = [];
    if (typeof originalGetJSON === "function") {
      for (const url of [MASTER_KMB, MASTER_CTB]) {
        jobs.push((async () => {
          const rec = await readRecord(`json:${url}`);
          if (!rec?.value) await refreshJson(url, { ttl: 0, retries: 1 });
          else if (!isFresh(rec)) refreshJson(url, { ttl: 0, retries: 1 }).catch(() => {});
        })());
      }
    }
    await Promise.allSettled(jobs);
    try { localStorage.setItem("daozhan.transitDb.lastWarm", String(Date.now())); } catch {}
  }

  function boot() {
    setTimeout(() => warmCore().catch(() => {}), 1800);
  }

  window.dzLocalTransitDB391 = {
    version: VERSION,
    refreshDays: 15,
    warmCore,
    readRecord,
    isFresh
  };

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot, { once: true });
  else boot();
})();
