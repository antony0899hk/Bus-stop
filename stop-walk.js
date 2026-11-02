(() => {
  "use strict";
  const esc = value => String(value ?? "").replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
  const distance = (a, b) => {
    const rad = x => x * Math.PI / 180, r = 6371000;
    const p1 = rad(a.lat), p2 = rad(b.lat), dp = rad(b.lat - a.lat), dl = rad(b.lon - a.lon);
    const h = Math.sin(dp / 2) ** 2 + Math.cos(p1) * Math.cos(p2) * Math.sin(dl / 2) ** 2;
    return Math.round(2 * r * Math.asin(Math.sqrt(h)));
  };
  const appleUrl = (name, point, origin) => {
    const params = new URLSearchParams({daddr: `${point.lat},${point.lon}`, dirflg: "w", q: name});
    if (origin) params.set("saddr", `${origin.lat},${origin.lon}`);
    return `https://maps.apple.com/?${params}`;
  };
  const googleUrl = (name, point, origin) => {
    const params = new URLSearchParams({api: "1", destination: `${point.lat},${point.lon}`, travelmode: "walking"});
    if (origin) params.set("origin", `${origin.lat},${origin.lon}`);
    return `https://www.google.com/maps/dir/?${params}`;
  };
  function ensureDialog() {
    let dialog = document.querySelector("#stopWalkDialog");
    if (dialog) return dialog;
    dialog = document.createElement("dialog");
    dialog.id = "stopWalkDialog";
    dialog.className = "stop-walk-dialog";
    dialog.innerHTML = '<div class="stop-walk-head"><div><small>步行前往</small><h2></h2></div><button type="button" class="stop-walk-close" aria-label="關閉">×</button></div><p class="stop-walk-distance">正在取得你的位置…</p><p class="stop-walk-hint">選擇地圖 App 查看實際步行路線及轉彎指示。</p><div class="stop-walk-actions"><a class="primary-btn stop-walk-apple" target="_blank" rel="noopener">Apple 地圖</a><a class="stop-walk-google" target="_blank" rel="noopener">Google Maps</a></div>';
    document.body.appendChild(dialog);
    dialog.querySelector(".stop-walk-close").addEventListener("click", () => dialog.close());
    dialog.addEventListener("click", event => { if (event.target === dialog) dialog.close(); });
    return dialog;
  }
  document.addEventListener("click", async event => {
    const button = event.target.closest?.(".stop-walk-link");
    if (!button) return;
    event.preventDefault();
    const name = button.dataset.walkName || button.textContent.trim();
    const point = {lat:Number(button.dataset.walkLat), lon:Number(button.dataset.walkLon)};
    const dialog = ensureDialog(), status = dialog.querySelector(".stop-walk-distance");
    dialog.querySelector("h2").textContent = name;
    const apple = dialog.querySelector(".stop-walk-apple"), google = dialog.querySelector(".stop-walk-google");
    const valid = Number.isFinite(point.lat) && Number.isFinite(point.lon);
    const fallback = encodeURIComponent(name);
    apple.href = valid ? appleUrl(name, point, null) : `https://maps.apple.com/?q=${fallback}`;
    google.href = valid ? googleUrl(name, point, null) : `https://www.google.com/maps/search/?api=1&query=${fallback}`;
    status.textContent = valid ? "正在取得你的位置…" : "呢個站暫時冇座標，會用站名喺地圖搜尋。";
    if (!dialog.open) dialog.showModal();
    if (!valid) return;
    const location = await window.dzNearestStop?.locate?.();
    if (!dialog.open || dialog.querySelector("h2").textContent !== name) return;
    if (location) {
      const metres = distance(location, point);
      status.textContent = `你距離車站約 ${metres < 1000 ? `${metres} 米` : `${(metres / 1000).toFixed(1)} 公里`}（直線距離）`;
      apple.href = appleUrl(name, point, location);
      google.href = googleUrl(name, point, location);
    } else {
      status.textContent = "未能取得目前位置；地圖會以你的位置作起點。";
      apple.href = `https://maps.apple.com/?saddr=Current%20Location&daddr=${point.lat},${point.lon}&dirflg=w&q=${encodeURIComponent(name)}`;
      google.href = `https://www.google.com/maps/dir/?api=1&origin=My%20Location&destination=${point.lat},${point.lon}&travelmode=walking`;
    }
  });
  window.dzStopWalk = {distance, appleUrl, googleUrl};
})();
