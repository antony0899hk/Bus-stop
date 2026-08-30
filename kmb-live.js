(() => {
  "use strict";
  if (typeof getJSON !== "function") return;

  const baseGetJSON = getJSON;
  const isKmbEta = url => /data\.etabus\.gov\.hk\/v1\/transport\/kmb\/(?:eta|stop-eta|route-eta)\//.test(String(url));

  async function fetchKmbLive(url, retries = 1) {
    let lastError;
    for (let attempt = 0; attempt <= retries; attempt++) {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 12000);
      try {
        const res = await fetch(url, {
          headers: { Accept: "application/json", "Cache-Control": "no-cache" },
          cache: "no-store",
          signal: controller.signal
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const value = await res.json();
        if (value && value.generated_timestamp) {
          window.dzKmbFeedGeneratedAt = value.generated_timestamp;
          window.dzKmbFeedReceivedAt = new Date().toISOString();
        }
        return value;
      } catch (error) {
        lastError = error;
        if (attempt < retries) await new Promise(resolve => setTimeout(resolve, 250 * (attempt + 1)));
      } finally {
        clearTimeout(timer);
      }
    }
    throw lastError;
  }

  getJSON = async function(url, options = {}) {
    if (isKmbEta(url)) return fetchKmbLive(url, options.retries ?? 1);
    return baseGetJSON(url, options);
  };

  window.dzKmbEtaMode = "live-no-store";
})();
