(() => {
  "use strict";
  const DATA_URL = "./data/route-timetables.json", STORAGE_KEY = "daozhan_route_timetables_v1";
  let databasePromise;
  const dayLabels = { weekday:"星期一至五", saturday:"星期六", sunday_public_holiday:"星期日及公眾假期" };
  function validDatabase(v) { return v && v.schemaVersion === 1 && Array.isArray(v.records) && v.records.every(r => r?.operator && r?.route && r?.bound && r?.days); }
  function readLastGood() { try { const v=JSON.parse(localStorage.getItem(STORAGE_KEY)||"null"); return validDatabase(v)?v:null; } catch (_) { return null; } }
  async function loadDatabase() {
    if (databasePromise) return databasePromise;
    databasePromise=(async()=>{const lastGood=readLastGood();try{const response=await fetch(DATA_URL,{cache:"no-cache"});if(!response.ok)throw new Error(`HTTP ${response.status}`);const fresh=await response.json();if(!validDatabase(fresh))throw new Error("invalid timetable database");try{localStorage.setItem(STORAGE_KEY,JSON.stringify(fresh));}catch(_){}return{value:fresh,stale:false};}catch(error){return{value:lastGood||{schemaVersion:1,records:[]},stale:true};}})();
    return databasePromise;
  }
  function findRecord(records, route) { const op=route.operator==="MTRB"?"MTRB":route.operator,bound=String(route.bound||"O").toUpperCase();return records.find(r=>r.operator===op&&String(r.route).toUpperCase()===String(route.route).toUpperCase()&&String(r.bound).toUpperCase()===bound&&(!r.serviceType||String(r.serviceType)===String(route.serviceType||"1"))); }
  function renderDay(day, service) {
    if (!service || service.noService) return `<div class="timetable-day"><h4>${dayLabels[day]}</h4><p class="timetable-empty">不設服務</p></div>`;
    const departures=Array.isArray(service.departures)?service.departures:[];
    if(departures.length)return `<div class="timetable-day"><h4>${dayLabels[day]}</h4><div class="timetable-departures">${departures.map(x=>`<time>${escapeHtml(x)}</time>`).join("")}</div></div>`;
    const periods=Array.isArray(service.periods)?service.periods:[],first=service.first||periods[0]?.start||"—",last=service.last||periods.at(-1)?.end||"—";
    return `<div class="timetable-day"><h4>${dayLabels[day]}</h4><div class="timetable-first-last"><span>首班 <strong>${escapeHtml(first)}</strong></span><span>尾班 <strong>${escapeHtml(last)}</strong></span></div>${periods.map(p=>`<div class="timetable-period"><span>${escapeHtml(p.start)}–${escapeHtml(p.end)}</span><strong>${escapeHtml(p.headway)} 分鐘</strong></div>`).join("")}</div>`;
  }
  function renderRecord(record, stale) { const s=record.source||{};return `<details class="route-timetable" open><summary>總站開車時間</summary><div class="timetable-grid">${["weekday","saturday","sunday_public_holiday"].map(d=>renderDay(d,record.days[d])).join("")}</div><div class="timetable-meta">${stale?'<span class="timetable-stale">目前使用上次有效版本</span>':""}<span>生效：${escapeHtml(s.effectiveDate||"官方頁面未列明")}</span><span>最後核實：${escapeHtml(s.lastVerified||"—")}</span>${s.url?`<a href="${escapeHtml(s.url)}" target="_blank" rel="noopener noreferrer">官方來源 ↗</a>`:""}</div></details>`; }
  function placeholder(){return '<div class="route-next-arrival route-service" data-route-timetable><small>服務時間／總站開車</small><strong>時間表載入中…</strong></div>';}
  async function render(route,target){if(!target)return;const{value,stale}=await loadDatabase(),record=findRecord(value.records,route);target.innerHTML=record?renderRecord(record,stale):'<div class="route-next-arrival route-service"><small>服務時間／總站開車</small><strong>小型資料庫暫未收錄此路線</strong></div>';}
  window.dzTimetable={loadDatabase,render,placeholder,findRecord,renderRecord};
})();
