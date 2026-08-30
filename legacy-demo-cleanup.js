(() => {
  "use strict";
  const QUICK_KEY = "daozhan.quickPlaces.v3";
  const RECENT_KEY = "daozhan.journeyRecent.v1";
  const CLEANUP_KEY = "daozhan.cleanup.demoPlaces.v1";

  const norm = v => String(v || "").trim().toLowerCase().replace(/[\s　]+/g, "");
  const demoQuickLabels = new Set(["mother"]);
  const demoRecentValues = new Set(["mongkok", "耀安邨"]);

  try {
    if (!localStorage.getItem(CLEANUP_KEY)) {
      const quick = JSON.parse(localStorage.getItem(QUICK_KEY) || "[]");
      if (Array.isArray(quick)) {
        const cleaned = quick.filter(p => {
          if (!p || p.id === "home" || p.id === "office") return true;
          return !demoQuickLabels.has(norm(p.label));
        });
        localStorage.setItem(QUICK_KEY, JSON.stringify(cleaned));
      }

      const recent = JSON.parse(localStorage.getItem(RECENT_KEY) || "[]");
      if (Array.isArray(recent)) {
        const cleaned = recent.filter(v => !demoRecentValues.has(norm(v)));
        localStorage.setItem(RECENT_KEY, JSON.stringify(cleaned));
      }
      localStorage.setItem(CLEANUP_KEY, "1");
    }
  } catch {}

  function cleanVisibleDemoButtons() {
    const row = document.querySelector("#journeyRecentPlaces");
    if (!row) return;
    [...row.querySelectorAll("button")].forEach(btn => {
      const text = norm(btn.textContent);
      if (demoQuickLabels.has(text) || demoRecentValues.has(text)) btn.remove();
    });
    [...row.querySelectorAll(".recent-label")].forEach(label => {
      let n = label.nextElementSibling;
      let hasButton = false;
      while (n && !n.classList.contains("recent-label")) {
        if (n.tagName === "BUTTON") hasButton = true;
        n = n.nextElementSibling;
      }
      if (!hasButton) label.remove();
    });
    row.classList.toggle("hidden", !row.querySelector("button"));
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", () => setTimeout(cleanVisibleDemoButtons, 80), { once:true });
  } else {
    setTimeout(cleanVisibleDemoButtons, 80);
  }
})();