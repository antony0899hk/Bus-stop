(() => {
  "use strict";
  const $ = s => document.querySelector(s);

  function getCurrentLocation() {
    return new Promise((resolve, reject) => {
      if (!navigator.geolocation) return reject(new Error("不支援定位"));
      navigator.geolocation.getCurrentPosition(
        pos => resolve({ lat: pos.coords.latitude, lon: pos.coords.longitude }),
        reject,
        { enableHighAccuracy: true, timeout: 12000, maximumAge: 30000 }
      );
    });
  }

  async function ensureDefaultOrigin() {
    const from = $("#journeyFrom");
    if (!from) return false;
    const raw = from.value.trim();
    if (raw && raw !== "我的位置") return true;

    from.value = "我的位置";
    if (typeof journeyState !== "undefined" && journeyState.originLocation) return true;

    const status = $("#journeyStatus");
    if (status) status.textContent = "正在取得目前位置作為起點…";
    try {
      const loc = await getCurrentLocation();
      if (typeof journeyState !== "undefined") journeyState.originLocation = loc;
      if (status) status.textContent = "已使用目前位置作為起點。";
      return true;
    } catch {
      if (status) status.textContent = "未能取得目前位置，請檢查 Safari 定位權限，或手動輸入起點。";
      return false;
    }
  }

  function initDefaultOrigin() {
    const from = $("#journeyFrom");
    if (from && !from.value.trim()) from.value = "我的位置";
  }

  if (typeof runJourneySearch === "function") {
    const previous = runJourneySearch;
    runJourneySearch = async function() {
      const ok = await ensureDefaultOrigin();
      if (!ok) return;
      return previous();
    };
  }

  const searchBtn = $("#journeySearchBtn");
  searchBtn?.addEventListener("click", () => {
    const from = $("#journeyFrom");
    if (from && !from.value.trim()) from.value = "我的位置";
  }, true);

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", initDefaultOrigin, { once: true });
  } else {
    initDefaultOrigin();
  }

  window.dzDefaultOrigin = { version: "3.7.4", ensure: ensureDefaultOrigin };
})();
