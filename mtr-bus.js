(() => {
  "use strict";
  const API = "https://rt.data.gov.hk/v1/transport/mtr/bus/getSchedule";
  const STOPS_CSV = "https://opendata.mtr.com.hk/data/mtr_bus_stops.csv";
  const ROUTES = [
    ["506","屯門碼頭","兆麟"],["K12","大埔墟站","八號花園"],["K14","大埔超級城","大埔墟站"],["K17","大埔墟站","富善"],["K18","大埔墟站","廣福"],
    ["K51","富泰","大欖"],["K51A","富泰","掃管笏"],["K52","悅湖山莊","龍鼓灘"],["K52A","屯門站","曾咀"],["K52P","龍鼓灘","屯門站"],
    ["K53","屯門站","掃管笏（循環綫）"],["K53S","屯門站","業旺邨特別班（循環綫）"],["K54","和田邨","屯門市中心（循環綫）"],["K54A","和田邨","兆康站"],["K58","富泰","掃管笏"],
    ["K65","元朗站","流浮山"],["K65A","天水圍站","流浮山"],["K66","朗屏","大棠黃泥墩村"],["K68","元朗工業邨","元朗公園（循環綫）"],["K73","天恆","元朗西"],
    ["K74","天水圍市中心","凹頭（循環綫）"],["K75A","天水圍站","洪水橋（循環綫）"],["K75P","天瑞","洪水橋（循環綫）"],["K75S","天水圍站","洪福邨（循環綫）"],["K76","天恆","天水圍站"],["K76S","濕地公園路","天盛苑／天水圍站"]
  ].map(([route,orig,dest]) => ({operator:"MTR",kind:"MTRBUS",route,orig,dest,bound:"O",serviceType:"1"}));

  const oldNormalizedRoutes = normalizedRoutes;
  normalizedRoutes = function(){ return [...oldNormalizedRoutes(), ...ROUTES]; };

  function csvRows(text){
    const rows=[]; let row=[],cell="",q=false;
    for(let i=0;i<text.length;i++){const c=text[i],n=text[i+1];if(c==='"'){if(q&&n==='"'){cell+='"';i++;}else q=!q;}else if(c===','&&!q){row.push(cell);cell="";}else if((c==='\n'||c==='\r')&&!q){if(c==='\r'&&n==='\n')i++;row.push(cell);if(row.some(Boolean))rows.push(row);row=[];cell="";}else cell+=c;}
    if(cell||row.length){row.push(cell);rows.push(row);} return rows;
  }
  let stopRowsPromise=null;
  async function loadStops(){
    if(stopRowsPromise)return stopRowsPromise;
    stopRowsPromise=fetch(STOPS_CSV,{cache:"force-cache"}).then(r=>{if(!r.ok)throw new Error(`MTR stops HTTP ${r.status}`);return r.text();}).then(text=>{
      const rows=csvRows(text); if(rows.length<2)return [];
      const h=rows[0].map(x=>String(x).trim().toUpperCase());
      const pick=(names)=>{for(const n of names){const i=h.indexOf(n);if(i>=0)return i;}return -1;};
      const iRoute=pick(["ROUTE NAME","ROUTE_NAME","ROUTE","ROUTE NO.","ROUTE NO"]), iId=pick(["STATION ID","STATION_ID","STOP ID","STOP_ID"]), iTc=pick(["STATION NAME (CHI)","STATION_NAME_CHI","STOP NAME (CHI)","STOP_NAME_CHI","STATION NAME CHI"]), iLat=pick(["STATION LATITUDE","STATION_LATITUDE","LATITUDE"]), iLon=pick(["STATION LONGITUDE","STATION_LONGITUDE","LONGITUDE"]);
      return rows.slice(1).map(r=>({route:iRoute>=0?r[iRoute]:String(r[iId]||'').split('-')[0],id:r[iId]||'',name:r[iTc]||r[iId]||'',lat:Number(r[iLat]),lon:Number(r[iLon])})).filter(x=>x.id);
    }).catch(e=>{stopRowsPromise=null;throw e;});
    return stopRowsPromise;
  }
  async function schedule(route){
    const res=await fetch(API,{method:"POST",headers:{"Content-Type":"application/json","Accept":"application/json"},body:JSON.stringify({language:"zh",routeName:String(route)})});
    if(!res.ok)throw new Error(`MTR Bus HTTP ${res.status}`); return res.json();
  }
  function etaChips(stop){
    const buses=(stop?.bus||[]).filter(b=>Number(b.arrivalTimeInSecond)<108000).slice(0,3);
    if(!buses.length)return '<span class="eta-chip muted">未有預報</span>';
    return buses.map(b=>{const sec=Math.max(0,Number(b.arrivalTimeInSecond)||0),m=Math.max(0,Math.round(sec/60));const txt=sec<60?'即將到站':`${m} 分鐘`;return `<span class="eta-chip">${escapeHtml(txt)}</span>`;}).join('');
  }
  async function renderMtrBusRoute(r){
    const [meta,j]=await Promise.all([loadStops().catch(()=>[]),schedule(r.route)]);
    const live=j.busStop||[]; const byId=new Map(meta.filter(x=>String(x.route).toUpperCase()===String(r.route).toUpperCase()).map(x=>[String(x.id),x]));
    if(!live.length){$("#stops").innerHTML='<div class="empty">港鐵暫時未提供此路線到站資料。</div>';return;}
    $("#stops").innerHTML=live.map((s,i)=>{const m=byId.get(String(s.busStopId));return `<div class="stop-row" data-stop-id="${escapeHtml(s.busStopId||'')}"><div class="stop-no">${i+1}</div><div><div class="stop-name">${escapeHtml(m?.name||s.busStopId||'港鐵巴士站')}</div><div class="etas">${etaChips(s)}</div></div><div class="stop-actions"><div class="fare-cell">港鐵巴士</div></div></div>`;}).join('');
  }
  const oldRenderRouteDetail=renderRouteDetail;
  renderRouteDetail=async function(){
    const r=state.selectedRoute;
    if(!r||r.kind!=="MTRBUS")return oldRenderRouteDetail();
    $("#routeHeader").innerHTML=`<div class="route-title"><div><div class="number">${escapeHtml(r.route)}</div><div class="dest">${escapeHtml(r.orig)} ↔ ${escapeHtml(r.dest)}</div>${operatorBadge("MTR")}</div></div>`;
    $("#directionTabs").innerHTML='';
    $("#stops").innerHTML='<div class="loading">正在載入港鐵巴士站點及 ETA…</div>';
    try{await renderMtrBusRoute(r);}catch(e){$("#stops").innerHTML=`<div class="error">港鐵巴士資料暫時未能載入：${escapeHtml(e?.message||'未知錯誤')}</div>`;}
  };
  window.dzMtrBus={version:"4.0.20",routes:ROUTES,loadStops,schedule};
})();