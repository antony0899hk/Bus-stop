(() => {
  const STORAGE_KEY = "daozhan_favorites_v2";

  function loadFavorites() {
    try { return JSON.parse(localStorage.getItem(STORAGE_KEY) || "[]"); }
    catch { return []; }
  }

  function compactFavorite(f) {
    return {
      key: f.key || "",
      operator: f.operator || "KMB",
      route: f.route || "",
      bound: f.bound || "",
      serviceType: f.serviceType || "1",
      routeId: f.routeId || "",
      routeSeq: f.routeSeq || "",
      stopSeq: f.stopSeq || "",
      stopId: f.stopId || "",
      stopName: f.stopName || "",
      origin: f.origin || "",
      destination: f.destination || ""
    };
  }

  function toBase64Url(value) {
    const bytes = new TextEncoder().encode(value);
    let binary = "";
    bytes.forEach(b => binary += String.fromCharCode(b));
    return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
  }

  function makeWatchSyncUrl() {
    const favs = loadFavorites().map(compactFavorite);
    if (!favs.length) return null;
    const payload = toBase64Url(JSON.stringify({ v: 1, favorites: favs }));
    const url = new URL("./watch/", location.href);
    url.hash = `favorites=${payload}`;
    return { url: url.toString(), count: favs.length };
  }

  async function syncToWatch() {
    const data = makeWatchSyncUrl();
    if (!data) {
      alert("未有收藏。請先收藏常搭路線，再同步到 Watch。");
      return;
    }

    const shareData = {
      title: "到站 Watch 收藏同步",
      text: `同步 ${data.count} 個《到站》收藏到手錶`,
      url: data.url
    };

    try {
      if (navigator.share) {
        await navigator.share(shareData);
        return;
      }
      await navigator.clipboard.writeText(data.url);
      alert("Watch 同步連結已複製。將連結傳去手錶並打開，就會自動匯入收藏。");
    } catch (error) {
      if (error?.name === "AbortError") return;
      prompt("複製以下 Watch 同步連結，再喺手錶打開：", data.url);
    }
  }

  document.addEventListener("DOMContentLoaded", () => {
    document.querySelector("#syncWatchFavs")?.addEventListener("click", syncToWatch);
  });
})();
