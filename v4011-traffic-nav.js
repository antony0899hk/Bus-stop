(() => {
  "use strict";
  const VERSION = "4.0.12";
  let index = 0;
  let loading = false;

  function esc(v='') { return typeof escapeHtml === 'function' ? escapeHtml(v) : String(v); }
  function fmt(v) { return typeof formatTime === 'function' ? formatTime(v) : (v || '—'); }

  function ensureNav() {
    const box = document.querySelector('#traffic-warning');
    if (!box) return null;
    let nav = document.querySelector('#dz4011TrafficNav');
    if (!nav) {
      nav = document.createElement('div');
      nav.id = 'dz4011TrafficNav';
      nav.className = 'dz4011-traffic-nav';
      nav.innerHTML = '<button type="button" data-traffic-prev>‹ 上一則</button><span data-traffic-count></span><button type="button" data-traffic-next>下一則 ›</button>';
      box.appendChild(nav);
    }
    return nav;
  }

  function renderCurrent() {
    const list = Array.isArray(window.state?.warnings) ? window.state.warnings : (typeof state !== 'undefined' && Array.isArray(state.warnings) ? state.warnings : []);
    const box = document.querySelector('#traffic-warning');
    if (!box) return;
    if (!list.length) { box.classList.add('hidden'); return; }
    if (index < 0) index = list.length - 1;
    if (index >= list.length) index = 0;
    const w = list[index];
    const firstMs = new Date(w.first || w.updated || Date.now()).getTime();
    const mins = Number.isFinite(firstMs) ? Math.max(0, Math.floor((Date.now() - firstMs) / 60000)) : 0;
    const text = document.querySelector('#warning-text');
    const meta = document.querySelector('#warning-meta');
    if (text) text.innerHTML = `<strong>${esc(w.location || w.heading)}${w.direction ? `｜${esc(w.direction)}方向` : ''}${w.detail ? ` ${esc(w.detail)}` : ''}</strong><p>${esc(w.content || '')}</p>`;
    if (meta) meta.innerHTML = `<div>運輸署發布：${fmt(w.first)}　最新更新：${fmt(w.updated)}</div><div>已發布／持續 ${mins} 分鐘　狀態：${esc(w.status || '已發布')}</div><div>資料來源：運輸署特別交通消息</div>`;
    box.classList.remove('hidden');
    const nav = ensureNav();
    if (nav) {
      const count = nav.querySelector('[data-traffic-count]');
      if (count) count.textContent = `${index + 1} / ${list.length}`;
      nav.classList.toggle('hidden', list.length <= 1);
    }
  }

  async function loadNow() {
    if (loading) return;
    loading = true;
    try {
      // app.js already defines the lightweight Transport Department loader.
      // Call it independently of bootstrap so traffic alerts do not wait for GMB/MTR staged loading.
      if (typeof loadTrafficWarning === 'function') await loadTrafficWarning();
      renderCurrent();
    } catch (_) {
      // Keep the card hidden if TD data is temporarily unavailable.
    } finally { loading = false; }
  }

  document.addEventListener('click', e => {
    if (e.target.closest?.('[data-traffic-prev]')) { index--; renderCurrent(); }
    if (e.target.closest?.('[data-traffic-next]')) { index++; renderCurrent(); }
  });

  const warning = document.querySelector('#traffic-warning');
  if (warning) {
    new MutationObserver(() => {
      const list = typeof state !== 'undefined' && Array.isArray(state.warnings) ? state.warnings : [];
      if (list.length) renderCurrent();
    }).observe(warning, { attributes:true, attributeFilter:['class'] });
  }

  const style = document.createElement('style');
  style.textContent = '.dz4011-traffic-nav{display:flex;align-items:center;justify-content:space-between;gap:10px;margin-top:10px;padding-top:10px;border-top:1px solid rgba(255,255,255,.12)}.dz4011-traffic-nav button{border:1px solid rgba(255,255,255,.18);background:rgba(255,255,255,.05);color:inherit;border-radius:999px;padding:8px 12px;font-weight:700}.dz4011-traffic-nav span{font-size:.9rem;opacity:.8}.dz4011-traffic-nav.hidden{display:none}';
  document.head.appendChild(style);

  // Load immediately; refresh occasionally without blocking nearby/search features.
  setTimeout(loadNow, 0);
  setInterval(loadNow, 5 * 60 * 1000);

  window.dzTrafficNav4011 = { version: VERSION, renderCurrent, loadNow };
})();