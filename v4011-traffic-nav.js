(() => {
  "use strict";
  const VERSION = "4.0.15";
  const LOCAL_URL = "./traffic.json";
  const TD_URL = "https://www.td.gov.hk/tc/special_news/trafficnews.xml";
  let index = 0;
  let loading = false;
  let rowsCache = [];

  function esc(v='') { return typeof escapeHtml === 'function' ? escapeHtml(v) : String(v); }
  function fmt(v) { try { return v ? new Intl.DateTimeFormat('zh-HK',{hour:'2-digit',minute:'2-digit',hour12:false}).format(new Date(v)) : '—'; } catch { return v || '—'; } }
  function val(n, k) { return n.querySelector(k)?.textContent?.trim() || ''; }

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

  function currentList() {
    // Keep an independent snapshot. app.js may still update state.warnings later
    // when its slower bootstrap finishes; that must not erase this navigator.
    if (rowsCache.length) return rowsCache;
    try { return Array.isArray(state.warnings) ? state.warnings : []; } catch { return []; }
  }

  function renderCurrent() {
    const list = currentList();
    const box = document.querySelector('#traffic-warning');
    if (!box) return;
    if (!list.length) { box.classList.add('hidden'); return; }
    if (index < 0) index = list.length - 1;
    if (index >= list.length) index = 0;
    const w = list[index] || list[0];
    const firstMs = new Date(w.first || w.updated || Date.now()).getTime();
    const mins = Number.isFinite(firstMs) ? Math.max(0, Math.floor((Date.now() - firstMs) / 60000)) : 0;
    const text = document.querySelector('#warning-text');
    const meta = document.querySelector('#warning-meta');
    if (text) text.innerHTML = `<strong>${esc(w.location || w.heading || '特別交通消息')}${w.direction ? `｜${esc(w.direction)}方向` : ''}${w.detail ? ` ${esc(w.detail)}` : ''}</strong><p>${esc(w.content || '')}</p>`;
    if (meta) meta.innerHTML = `<div>運輸署發布：${fmt(w.first || w.updated)}　最新更新：${fmt(w.updated)}</div><div>已發布／持續 ${mins} 分鐘　狀態：${esc(w.status || '最新情況')}</div><div>資料來源：運輸署特別交通消息</div>`;
    box.classList.remove('hidden');
    const nav = ensureNav();
    if (nav) {
      const count = nav.querySelector('[data-traffic-count]');
      if (count) count.textContent = `${index + 1} / ${list.length}`;
      nav.classList.toggle('hidden', list.length <= 1);
    }
  }

  function normalizeRows(rows) {
    const cache = (() => { try { return JSON.parse(localStorage.getItem('daozhan_warning_first_seen') || '{}'); } catch { return {}; } })();
    const out = (Array.isArray(rows) ? rows : []).map((w,i) => {
      const id = w.id || `td-${i}`;
      const updated = w.updated || new Date().toISOString();
      if (!cache[id]) cache[id] = updated;
      return {...w, id, first:w.first || cache[id], updated};
    }).filter(w => w.heading || w.location || w.content)
      .filter(w => !/解封|恢復正常|重開|回復正常|已恢復正常/.test(`${w.status||''}${w.content||''}`));
    try { localStorage.setItem('daozhan_warning_first_seen', JSON.stringify(cache)); } catch {}
    return out;
  }

  function parseTraffic(text) {
    const xml = new DOMParser().parseFromString(text, 'text/xml');
    if (xml.querySelector('parsererror')) throw new Error('TD XML parse error');
    let nodes = [...xml.querySelectorAll('message')];
    if (!nodes.length) nodes = [...xml.querySelectorAll('list')];
    return normalizeRows(nodes.map((n, i) => ({
      id: val(n,'INCIDENT_NUMBER') || val(n,'ID') || val(n,'msgID') || val(n,'MESSAGE_ID') || `td-${i}`,
      heading: val(n,'INCIDENT_HEADING_CN') || val(n,'ChinShort') || val(n,'TITLE_TC'),
      detail: val(n,'INCIDENT_DETAIL_CN') || val(n,'DETAIL_TC'),
      location: val(n,'LOCATION_CN') || val(n,'LOCATION_TC'),
      direction: val(n,'DIRECTION_CN') || val(n,'DIRECTION_TC'),
      updated: val(n,'ANNOUNCEMENT_DATE') || val(n,'ReferenceDate') || val(n,'UPDATE_TIME') || new Date().toISOString(),
      status: val(n,'INCIDENT_STATUS_CN') || val(n,'CurrentStatus') || val(n,'STATUS_TC') || '最新情況',
      content: val(n,'CONTENT_CN') || val(n,'ChinText') || val(n,'ChinShort') || val(n,'CONTENT_TC')
    })));
  }

  async function loadLocal() {
    const res = await fetch(`${LOCAL_URL}?_=${Date.now()}`, {cache:'no-store'});
    if (!res.ok) throw new Error(`local traffic HTTP ${res.status}`);
    const j = await res.json();
    return normalizeRows(j.warnings || []);
  }

  async function loadDirect() {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 8000);
    try {
      const res = await fetch(`${TD_URL}?_=${Date.now()}`, {cache:'no-store',signal:controller.signal,headers:{Accept:'application/xml,text/xml,*/*'}});
      if (!res.ok) throw new Error(`TD HTTP ${res.status}`);
      return parseTraffic(await res.text());
    } finally { clearTimeout(timer); }
  }

  async function loadNow() {
    if (loading) return;
    loading = true;
    try {
      let rows = [];
      try { rows = await loadLocal(); }
      catch { try { rows = await loadDirect(); } catch {} }
      if (rows.length) {
        rowsCache = rows;
        try { state.warnings = rows.slice(); } catch {}
        if (index >= rowsCache.length) index = 0;
        renderCurrent();
      }
    } finally { loading = false; }
  }

  document.addEventListener('click', e => {
    const prev = e.target.closest?.('[data-traffic-prev]');
    const next = e.target.closest?.('[data-traffic-next]');
    if (!prev && !next) return;
    e.preventDefault();
    e.stopPropagation();
    if (prev) index--;
    if (next) index++;
    renderCurrent();
  }, true);

  const style = document.createElement('style');
  style.textContent = '.dz4011-traffic-nav{display:flex;align-items:center;justify-content:space-between;gap:10px;margin-top:10px;padding-top:10px;border-top:1px solid rgba(255,255,255,.12)}.dz4011-traffic-nav button{border:1px solid rgba(255,255,255,.18);background:rgba(255,255,255,.05);color:inherit;border-radius:999px;padding:8px 12px;font-weight:700}.dz4011-traffic-nav span{font-size:.9rem;opacity:.8}.dz4011-traffic-nav.hidden{display:none}';
  document.head.appendChild(style);

  setTimeout(loadNow, 0);
  setInterval(loadNow, 5 * 60 * 1000);
  window.dzTrafficNav4011 = { version: VERSION, renderCurrent, loadNow, getRows:()=>rowsCache.slice() };
})();