(() => {
  "use strict";

  const VERSION = "5.5.0";
  const MAX_ORIGIN_STOPS = 10;
  const MAX_SEED_ROUTES = 18;
  const DEST_WALK_LIMIT = 650;
  const $ = s => document.querySelector(s);
  const norm = value => String(value || "").normalize("NFKC").toLowerCase().replace(/[\s　()（）-]+/g, "");

  const journeyState = window.journeyState = window.journeyState || {
    results: [], mode: "fastest", originLocation: null, token: 0
  };

  function stopPoint(operator, id, stop, distance = 0) {
    const lat = Number(stop?.lat ?? stop?.latitude);
    const lon = Number(stop?.long ?? stop?.lng ?? stop?.lon ?? stop?.longitude);
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
    return { operator, id:String(id), name:stop?.name_tc || stop?.name_en || String(id), lat, lon, distance };
  }

  function allJourneyStops() {
    const out = [];
    for (const [operator, map] of [["KMB", state.kmbStops], ["CTB", state.ctbStops]]) {
      for (const [id, stop] of map) {
        const point = stopPoint(operator, id, stop);
        if (point) out.push(point);
      }
    }
    return out;
  }

  function nearestStops(location) {
    const all = allJourneyStops().map(stop => ({...stop, distance:distanceMeters(location.lat, location.lon, stop.lat, stop.lon)}));
    for (const radius of [100, 200, 400]) {
      const hit = all.filter(stop => stop.distance <= radius).sort((a,b) => a.distance - b.distance).slice(0, MAX_ORIGIN_STOPS);
      if (hit.length >= 2 || radius === 400) return hit;
    }
    return [];
  }

  async function resolvePlace(value, location = null) {
    await ensureStopCatalog();
    if (location) return nearestStops(location);
    const query = norm(value);
    if (!query) return [];
    const exact = [], partial = [];
    for (const stop of allJourneyStops()) {
      const name = norm(stop.name);
      if (name === query) exact.push(stop);
      else if (name.includes(query) || query.includes(name)) partial.push(stop);
    }
    const source = exact.length ? exact : partial;
    return source.slice(0, 30);
  }

  function centerOf(stops) {
    const valid = stops.filter(s => Number.isFinite(s.lat) && Number.isFinite(s.lon));
    if (!valid.length) return null;
    return { lat:valid.reduce((n,s) => n+s.lat,0)/valid.length, lon:valid.reduce((n,s) => n+s.lon,0)/valid.length };
  }

  async function routesAtStop(stop) {
    const url = stop.operator === "KMB"
      ? `${KMB_API}/stop-eta/${encodeURIComponent(stop.id)}`
      : `https://rt.data.gov.hk/v1/transport/batch/stop-eta/CTB/${encodeURIComponent(stop.id)}`;
    const json = await getJSON(url, {ttl:15000, retries:0});
    return (json.data || []).filter(row => row.route && validFutureEta(row.eta)).map(row => ({
      operator:stop.operator, route:String(row.route), bound:String(row.dir || row.bound || "O").toUpperCase(),
      serviceType:String(row.service_type || "1"), eta:row.eta, originStop:stop
    }));
  }

  async function seedRoutes(originStops, token) {
    const groups = new Map();
    for (const stop of originStops) {
      if (token !== journeyState.token) return [];
      let rows = [];
      try { rows = await routesAtStop(stop); } catch {}
      for (const row of rows) {
        const key = [row.operator,row.route,row.bound,row.serviceType].join("|");
        const old = groups.get(key);
        if (!old || new Date(row.eta) < new Date(old.eta) || row.originStop.distance < old.originStop.distance) groups.set(key,row);
      }
    }
    return [...groups.values()].sort((a,b) => new Date(a.eta)-new Date(b.eta)).slice(0, MAX_SEED_ROUTES);
  }

  async function routeStops(seed) {
    let rows = [];
    if (seed.operator === "KMB") {
      const direction = seed.bound === "I" ? "inbound" : "outbound";
      const json = await getJSON(`${KMB_API}/route-stop/${encodeURIComponent(seed.route)}/${direction}/${encodeURIComponent(seed.serviceType)}`, {ttl:300000,retries:0});
      rows = json.data || [];
    } else {
      const direction = seed.bound === "I" ? "inbound" : "outbound";
      const json = await getJSON(`${CTB_API}/route-stop/ctb/${encodeURIComponent(seed.route)}/${direction}`, {ttl:300000,retries:0});
      rows = (json.data || []).filter(row => !row.dir || String(row.dir).toUpperCase() === seed.bound);
    }
    const map = seed.operator === "KMB" ? state.kmbStops : state.ctbStops;
    return rows.map((row,index) => {
      const id = String(row.stop || row.stop_id);
      const point = stopPoint(seed.operator, id, map.get(id) || row);
      return point ? {...point, seq:Number(row.seq || index+1)} : null;
    }).filter(Boolean).sort((a,b) => a.seq-b.seq);
  }

  function destinationHit(stops, start, destinationStops, destinationCenter) {
    const ids = new Set(destinationStops.filter(s => s.operator === stops[start]?.operator).map(s => s.id));
    let best = null;
    for (let i=start+1; i<stops.length; i++) {
      const stop = stops[i];
      const walk = destinationCenter ? distanceMeters(stop.lat, stop.lon, destinationCenter.lat, destinationCenter.lon) : Infinity;
      if (!ids.has(stop.id) && walk > DEST_WALK_LIMIT) continue;
      const candidate = {stop,index:i,walk:ids.has(stop.id) ? 0 : walk};
      if (!best || candidate.walk < best.walk) best = candidate;
      if (ids.has(stop.id)) break;
    }
    return best;
  }

  function routeMetadata(seed) {
    if (seed.operator === "KMB") {
      const r = state.kmbRoutes.find(x => String(x.route)===seed.route && String(x.bound).toUpperCase()===seed.bound && String(x.service_type||"1")===seed.serviceType);
      return {orig:r?.orig_tc||"",dest:r?.dest_tc||""};
    }
    const r = state.ctbRoutes.find(x => String(x.route)===seed.route);
    return seed.bound === "I" ? {orig:r?.dest_tc||"",dest:r?.orig_tc||""} : {orig:r?.orig_tc||"",dest:r?.dest_tc||""};
  }

  async function directCandidate(seed, destinationStops, destinationCenter) {
    const stops = await routeStops(seed);
    let originIndex = stops.findIndex(s => s.id === seed.originStop.id);
    if (originIndex < 0) originIndex = stops.findIndex(s => distanceMeters(s.lat,s.lon,seed.originStop.lat,seed.originStop.lon) < 120);
    if (originIndex < 0) return null;
    const hit = destinationHit(stops, originIndex, destinationStops, destinationCenter);
    if (!hit) return null;
    const meta = routeMetadata(seed), stopCount = hit.index-originIndex;
    const wait = Math.max(0, etaMinutes(seed.eta) || 0), walkMeters = Number(seed.originStop.distance||0)+Number(hit.walk||0);
    return {
      kind:"direct", operator:seed.operator, route:seed.route, bound:seed.bound, serviceType:seed.serviceType,
      originStop:stops[originIndex], destinationStop:hit.stop, originPos:originIndex, destinationPos:hit.index,
      stopCount, walkMeters, transferCount:0, eta:seed.eta, fare:null, meta,
      journeyMinutes:Math.max(1, Math.round(wait + stopCount*2.1 + walkMeters/75))
    };
  }

  async function mapPool(items, limit, worker) {
    const output = new Array(items.length); let next = 0;
    await Promise.all(Array.from({length:Math.min(limit,items.length)}, async () => {
      while (next < items.length) { const i=next++; try { output[i]=await worker(items[i],i); } catch { output[i]=null; } }
    }));
    return output.filter(Boolean);
  }

  function score(result) {
    if (journeyState.mode === "walking") return Number(result.walkMeters||0)*100 + Number(result.journeyMinutes||999);
    if (journeyState.mode === "transfers") return Number(result.transferCount||0)*100000 + Number(result.journeyMinutes||999);
    if (journeyState.mode === "cheapest") return (Number.isFinite(result.fare)?result.fare:999)*1000 + Number(result.journeyMinutes||999);
    return Number(result.journeyMinutes||999)*100 + Number(result.walkMeters||0)/20;
  }

  function resultList() { return [...journeyState.results].sort((a,b) => score(a)-score(b)).slice(0,10); }

  function renderJourneyResults() {
    const box = $("#journeyResults"); if (!box) return;
    const rows = resultList();
    if (!rows.length) { box.innerHTML='<div class="empty">暫時搵唔到直達巴士或合適港鐵方案，可嘗試輸入較接近嘅車站名稱。</div>'; return; }
    box.innerHTML = rows.map((r,index) => {
      if (r.kind === "mtr") {
        const names=(r.mtrPath||[]).map(code=>window.dzExtraTransit?.mtrStations?.get(code)?.name_tc||code);
        return `<article class="journey-card journey-mtr-card"><div class="journey-rank">${index+1}</div><div class="journey-main"><div class="journey-top"><div>${operatorBadge("MTR")} <strong class="journey-route">${escapeHtml(r.route||"港鐵")}</strong></div><div class="journey-eta">約 ${Number(r.journeyMinutes)||0} 分鐘</div></div><div class="journey-title">${escapeHtml(names[0]||r.originStop?.name)} → ${escapeHtml(names.at(-1)||r.destinationStop?.name)}</div><div class="journey-meta">${r.transferCount?`轉 ${r.transferCount} 次 · `:""}${r.stopCount} 站${r.fare!=null?` · $${Number(r.fare).toFixed(1)}`:""}</div><div class="journey-note">${escapeHtml(names.join(" → "))}</div></div></article>`;
      }
      return `<button type="button" class="journey-card journey-card-button" data-journey-result="${index}"><div class="journey-rank">${index+1}</div><div class="journey-main"><div class="journey-top"><div>${operatorBadge(r.operator)} <strong class="journey-route">${escapeHtml(r.route)}</strong></div><div class="journey-eta">約 ${r.journeyMinutes} 分鐘</div></div><div class="journey-title">${escapeHtml(r.originStop.name)} → ${escapeHtml(r.destinationStop.name)}</div><div class="journey-meta">直達 · ${r.stopCount} 站 · 步行約 ${Math.round((r.walkMeters||0)/10)*10} 米</div><div class="journey-note">往 ${escapeHtml(r.meta?.dest||r.destinationStop.name)} · 下一班 <span data-route-eta="${escapeHtml(r.eta||"")}">${escapeHtml(etaLabel(r.eta))}</span></div></div></button>`;
    }).join("");
  }

  async function locate() {
    const remembered = await window.dzNearestStop?.locate?.();
    if (remembered) return remembered;
    throw new Error("未能取得位置");
  }

  async function runJourneySearch() {
    const token=++journeyState.token, button=$("#journeySearchBtn"), status=$("#journeyStatus"), box=$("#journeyResults");
    const from=$("#journeyFrom")?.value.trim()||"", to=$("#journeyTo")?.value.trim()||"";
    if (!to) { status.textContent="請先輸入終點。"; return; }
    button.disabled=true; box.innerHTML='<div class="loading">正在由起點附近路線逐條搜尋…</div>'; status.textContent="100m → 200m → 400m 尋找起點附近車站。";
    try {
      let location = journeyState.originLocation;
      if (!from || from === "我的位置") { location=await locate(); journeyState.originLocation=location; $("#journeyFrom").value="我的位置"; }
      else journeyState.originLocation=null;
      const [origins,destinations] = await Promise.all([resolvePlace(from,location),resolvePlace(to,null)]);
      if (token!==journeyState.token) return;
      const originCenter=location||centerOf(origins), destinationCenter=centerOf(destinations);
      if (!origins.length) throw new Error("搵唔到起點附近車站");
      status.textContent="已搵到起點車站，正在核對可直達目的地嘅路線。";
      const seeds=await seedRoutes(origins,token);
      const direct=await mapPool(seeds,4,seed=>directCandidate(seed,destinations,destinationCenter));
      if (token!==journeyState.token) return;
      const mtr=await Promise.resolve(window.dzExtraTransit?.mtrJourneyCandidate?.(from,to,originCenter,destinationCenter)).catch(()=>null);
      const unique=new Map();
      for (const r of direct) { const key=[r.operator,r.route,r.bound].join("|"); if(!unique.has(key)||score(r)<score(unique.get(key)))unique.set(key,r); }
      journeyState.results=[...unique.values(),...(mtr?[mtr]:[])];
      renderJourneyResults();
      status.textContent=journeyState.results.length
        ? `已比較 ${direct.length} 個直達巴士方案${mtr?"及港鐵方案":""}；只查起點命中路線，沒有全港掃描。`
        : "暫時未有直達方案；下一版再加入一次轉車。";
    } catch (error) {
      if (token!==journeyState.token) return;
      journeyState.results=[]; renderJourneyResults(); status.textContent=`搜尋未完成：${error?.message||"請稍後再試"}。`;
    } finally { if (token===journeyState.token) button.disabled=false; }
  }

  function install() {
    const status=$("#journeyStatus"); if(status)status.textContent="已重新開放：九巴／城巴直達＋港鐵比較；下一階段加入一次轉車。";
    $("#journeySearchBtn")?.addEventListener("click",event=>{event.preventDefault();event.stopImmediatePropagation();runJourneySearch();});
    $("#journeyUseLocation")?.addEventListener("click",async()=>{
      const status=$("#journeyStatus"); status.textContent="正在取得目前位置…";
      try { journeyState.originLocation=await locate(); $("#journeyFrom").value="我的位置"; status.textContent="已取得位置，請輸入終點。"; }
      catch { status.textContent="未能取得位置，請檢查定位權限。"; }
    });
    document.querySelectorAll("[data-journey-mode]").forEach(button=>button.addEventListener("click",()=>{
      journeyState.mode=button.dataset.journeyMode;
      document.querySelectorAll("[data-journey-mode]").forEach(x=>x.classList.toggle("active",x===button));
      renderJourneyResults();
    }));
    $("#journeyResults")?.addEventListener("click",event=>{
      const card=event.target.closest("[data-journey-result]"); if(!card)return;
      const result=resultList()[Number(card.dataset.journeyResult)]; if(!result||result.kind==="mtr")return;
      const route=normalizedRoutes().find(r=>r.operator===result.operator&&String(r.route)===String(result.route)&&String(r.bound).toUpperCase()===result.bound&&String(r.serviceType||"1")===result.serviceType);
      if(route)openRoute(route);
    });
  }

  window.allJourneyStops=allJourneyStops;
  window.resolvePlace=resolvePlace;
  window.renderJourneyResults=renderJourneyResults;
  window.runJourneySearch=runJourneySearch;
  window.dzJourney={version:VERSION,state:journeyState,resolvePlace,destinationHit,score,run:runJourneySearch};
  if(document.readyState==="loading")document.addEventListener("DOMContentLoaded",install,{once:true});else install();
})();
