(() => {
  "use strict";
  const VERSION = "4.0.11";
  let index = 0;

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
    if (!Array.isArray(state?.warnings) || !state.warnings.length) return;
    if (index < 0) index = state.warnings.length - 1;
    if (index >= state.warnings.length) index = 0;
    const w = state.warnings[index];
    const mins = Math.max(0, Math.floor((Date.now() - new Date(w.first).getTime()) / 60000));
    const text = document.querySelector('#warning-text');
    const meta = document.querySelector('#warning-meta');
    if (text) text.innerHTML = `<strong>${esc(w.location || w.heading)}${w.direction ? `｜${esc(w.direction)}方向` : ''}${w.detail ? ` ${esc(w.detail)}` : ''}</strong><p>${esc(w.content || '')}</p>`;
    if (meta) meta.innerHTML = `<div>運輸署發布：${fmt(w.first)}　最新更新：${fmt(w.updated)}</div><div>已發布／持續 ${mins} 分鐘　狀態：${esc(w.status || '已發布')}</div><div>資料來源：運輸署特別交通消息</div>`;
    const nav = ensureNav();
    if (nav) {
      const count = nav.querySelector('[data-traffic-count]');
      if (count) count.textContent = `${index + 1} / ${state.warnings.length}`;
      nav.classList.toggle('hidden', state.warnings.length <= 1);
    }
  }

  document.addEventListener('click', e => {
    if (e.target.closest?.('[data-traffic-prev]')) { index--; renderCurrent(); }
    if (e.target.closest?.('[data-traffic-next]')) { index++; renderCurrent(); }
  });

  const warning = document.querySelector('#traffic-warning');
  if (warning) {
    new MutationObserver(() => {
      if (Array.isArray(state?.warnings) && state.warnings.length) {
        ensureNav();
        const count = document.querySelector('[data-traffic-count]');
        if (count) count.textContent = `${index + 1} / ${state.warnings.length}`;
      }
    }).observe(warning, { attributes:true, attributeFilter:['class'] });
  }

  const style = document.createElement('style');
  style.textContent = '.dz4011-traffic-nav{display:flex;align-items:center;justify-content:space-between;gap:10px;margin-top:10px;padding-top:10px;border-top:1px solid rgba(255,255,255,.12)}.dz4011-traffic-nav button{border:1px solid rgba(255,255,255,.18);background:rgba(255,255,255,.05);color:inherit;border-radius:999px;padding:8px 12px;font-weight:700}.dz4011-traffic-nav span{font-size:.9rem;opacity:.8}.dz4011-traffic-nav.hidden{display:none}';
  document.head.appendChild(style);

  window.dzTrafficNav4011 = { version: VERSION, renderCurrent };
})();