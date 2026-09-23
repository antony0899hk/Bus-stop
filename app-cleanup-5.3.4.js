(() => {
  "use strict";
  // Safe cleanup hotfix (v5.3.4): fix traffic warning detail duplication.
  // Journey/GMB intentionally stay paused. nearby.js remains the live Nearby owner.
  if (typeof loadTrafficWarning !== "function") return;
  const TD = typeof TD_TRAFFIC !== "undefined" ? TD_TRAFFIC : "https://www.td.gov.hk/tc/special_news/trafficnews.xml";
  const PROXY = "./api/traffic"; // GH Pages has no this proxy; fallback only if TD XML fetch fails
  const esc = typeof escapeHtml === "function" ? escapeHtml : (v="") => String(v);
  const fmt = typeof formatTime === "function" ? formatTime : (v) => v || "—";
  loadTrafficWarning = async function loadTrafficWarningFixed() {
    try {
      let res;
      try { res = await fetch(TD, { headers:{ Accept:"application/xml,text/xml" } }); if (!res.ok) throw new Error(); }
      catch { res = await fetch(PROXY, { headers:{ Accept:"application/xml,text/xml" } }); if (!res.ok) throw new Error(); }
      const text = await res.text(), xml = new DOMParser().parseFromString(text, "text/xml"), val = (n,k) => n.querySelector(k)?.textContent?.trim() || "";
      const cache = JSON.parse(localStorage.getItem("daozhan_warning_first_seen") || "{}");
      state.warnings = [...xml.querySelectorAll("message")].map(n => {
        const id = val(n,"INCIDENT_NUMBER") || val(n,"ID"), updated = val(n,"ANNOUNCEMENT_DATE");
        cache[id] = cache[id] && new Date(cache[id]) < new Date(updated) ? cache[id] : updated;
        return { id, heading:val(n,"INCIDENT_HEADING_CN"), detail:val(n,"INCIDENT_DETAIL_CN"), location:val(n,"LOCATION_CN"), direction:val(n,"DIRECTION_CN"), first:cache[id], updated, status:val(n,"INCIDENT_STATUS_CN"), content:val(n,"CONTENT_CN") };
      }).filter(w => w.status && /封閉|受阻|擠塞|事故|意外|水浸|塌|火警|改道|暫停/.test(`${w.heading}${w.detail}${w.content}`) && !/解封|取消|恢復正常|重開|回復正常/.test(`${w.status}${w.content}`));
      localStorage.setItem("daozhan_warning_first_seen", JSON.stringify(cache));
      const w = state.warnings[0];
      if (w) {
        const mins = Math.max(0, Math.floor((Date.now() - new Date(w.first).getTime()) / 60000));
        $("#warning-text").innerHTML = `<strong>${esc(w.location || w.heading)}${w.direction ? `｜${esc(w.direction)}方向` : ""}${w.detail ? ` ${esc(w.detail)}` : ""}</strong><p>${esc(w.content)}</p>`;
        $("#warning-meta").innerHTML = `<div>運輸署發布：${fmt(w.first)}　最新更新：${fmt(w.updated)}</div><div>已發布／持續 ${mins} 分鐘　狀態：${esc(w.status || "已發布")}</div><div>資料來源：運輸署特別交通消息</div>`;
        $("#traffic-warning").classList.remove("hidden");
        if (typeof renderFavorites === "function") renderFavorites();
      }
    } catch { /* Warning failure must never block ETA. */ }
  };
  // app.js bootstrap already ran; refresh warning with the fixed renderer.
  try { loadTrafficWarning(); } catch {}
})();
