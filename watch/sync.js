(() => {
  const STORAGE_KEY = "daozhan_favorites_v2";

  function fromBase64Url(value) {
    let normalized = value.replace(/-/g, "+").replace(/_/g, "/");
    while (normalized.length % 4) normalized += "=";
    const binary = atob(normalized);
    const bytes = Uint8Array.from(binary, c => c.charCodeAt(0));
    return new TextDecoder().decode(bytes);
  }

  function showSyncStatus(message, isError = false) {
    document.addEventListener("DOMContentLoaded", () => {
      const host = document.querySelector("#favSection");
      if (!host) return;
      const note = document.createElement("div");
      note.className = isError ? "error" : "muted";
      note.style.margin = "0 0 10px";
      note.textContent = message;
      host.prepend(note);
      setTimeout(() => note.remove(), 5000);
    });
  }

  try {
    const hash = location.hash.startsWith("#") ? location.hash.slice(1) : location.hash;
    const params = new URLSearchParams(hash);
    const encoded = params.get("favorites");
    if (!encoded) return;

    const payload = JSON.parse(fromBase64Url(encoded));
    if (!payload || payload.v !== 1 || !Array.isArray(payload.favorites)) throw new Error("invalid sync payload");

    const cleaned = payload.favorites
      .filter(f => f && f.route && f.stopId && f.operator)
      .map(f => ({
        key: String(f.key || ""),
        operator: String(f.operator || "KMB"),
        route: String(f.route || ""),
        bound: String(f.bound || ""),
        serviceType: String(f.serviceType || "1"),
        routeId: String(f.routeId || ""),
        routeSeq: String(f.routeSeq || ""),
        stopSeq: Number(f.stopSeq || 0),
        stopId: String(f.stopId || ""),
        stopName: String(f.stopName || f.stopId || ""),
        origin: String(f.origin || ""),
        destination: String(f.destination || "")
      }));

    localStorage.setItem(STORAGE_KEY, JSON.stringify(cleaned));
    history.replaceState(null, "", `${location.pathname}${location.search}`);
    showSyncStatus(`✓ 已同步 ${cleaned.length} 個收藏`);
  } catch {
    showSyncStatus("收藏同步連結無效，請由手機版重新產生。", true);
  }
})();
