(() => {
  "use strict";
  const VERSION="4.0.20";
  const API="https://rt.data.gov.hk/v1/transport/mtr/bus/getSchedule";
  const ROUTES=[
    ["506","屯門碼頭","兆麟"],["K12","大埔墟站","八號花園"],["K14","大埔超級城","大埔墟站"],["K17","大埔墟站","富善"],["K18","大埔墟站","廣福"],
    ["K51","富泰","大欖"],["K51A","富泰","掃管笏"],["K52","悅湖山莊","龍鼓灘"],["K52A","屯門站","曾咀"],["K52P","龍鼓灘","屯門站"],
    ["K53","屯門站","掃管笏（循環）"],["K53S","屯門站","業旺邨（循環）"],["K54","和田邨","屯門市中心（循環）"],["K54A","和田邨","兆康站"],["K58","富泰","掃管笏"],
    ["K65","元朗站","流浮山"],["K65A","天水圍站","流浮山"],["K66","朗屏","大棠黃泥墩村"],["K68","元朗工業邨","元朗公園（循環）"],["K73","天恆","元朗西"],
    ["K74","天水圍市中心","凹頭（循環）"],["K75A","天水圍站","洪水橋（循環）"],["K75P","天瑞","洪水橋（循環）"],["K75S","天水圍站","洪福邨（循環）"],["K76","天恆","天水圍站"],["K76S","濕地公園路","天盛苑／天水圍站"]
  ].map(([route,orig,dest])=>({operator:"MTRB",route,orig,dest,bound:"",serviceType:"1",routeId:route}));
  const STOP_META={
    "K12-U010":["大埔墟站",22.444414,114.169471],"K12-U020":["大埔超級城",22.450971,114.169957],"K12-U030":["八號花園",22.452836,114.166496],
    "K12-D010":["八號花園",22.452836,114.166496],"K12-D020":["大埔超級城",22.451278,114.170087],"K12-D030":["新達廣場",22.443712,114.16991],"K12-D040":["大埔墟站",22.444414,114.169471],
    "K14-D010":["大埔超級城",22.451278,114.170087],"K14-D020":["新達廣場",22.443712,114.16991],"K14-D030":["大埔墟站",22.444414,114.169471],
    "K17-U010":["大埔墟站",22.444414,114.169471],"K17-U020":["大埔中心第五期",22.453021,114.172331],"K17-U030":["怡雅苑",22.454538,114.174428],"K17-U040":["富善",22.454322,114.174098],
    "K17-D010":["富善",22.454322,114.174098],"K17-D020":["新達廣場",22.443712,114.16991],"K17-D030":["大埔墟站",22.444414,114.169471],
    "K18-U010":["大埔墟站",22.444414,114.169471],"K18-U020":["宏福苑",22.447531,114.17473],"K18-U030":["廣福",22.4487,114.174398],
    "K18-D010":["廣福",22.4487,114.174398],"K18-D020":["新達廣場",22.443712,114.16991],"K18-D030":["大埔墟站",22.444414,114.169471]
  };
  const badge=()=>'<span class="badge mtr">港鐵巴士</span>';
  async function schedule(route){
    const c=new AbortController(),timer=setTimeout(()=>c.abort(),12000);
    try{const r=await fetch(API,{method:"POST",headers:{"Content-Type":"application/json","Accept":"application/json"},body:JSON.stringify({language:"zh",routeName:String(route)}),signal:c.signal});if(!r.ok)throw new Error(`HTTP ${r.status}`);return await r.json();}finally{clearTimeout(timer);}
  }
  function etaChips(stop){
    const list=(stop.bus||[]).map(b=>{const s=Number(b.departureTimeInSecond);const a=Number(b.arrivalTimeInSecond);const sec=Number.isFinite(s)&&s>=0?s:a;return Number.isFinite(sec)&&sec>=0&&sec<108000?Math.max(0,Math.round(sec/60)):null;}).filter(x=>x!==null).slice(0,3);
    return list.length?list.map(m=>`<span class="eta-chip">${m===0?'即將到站':`${m} 分鐘`}</span>`).join(''):'<span class="eta-chip">未有預報</span>';
  }
  function renderStops(data){
    const groups={U:[],D:[],X:[]};
    for(const s of data.busStop||[]){const id=String(s.busStopId||'');const dir=/-U/.test(id)?'U':/-D/.test(id)?'D':'X';groups[dir].push(s);}
    const section=(title,list)=>list.length?`<div class="small-muted" style="padding:10px 4px 6px">${title}</div>${list.map((s,i)=>{const id=String(s.busStopId||'');const meta=STOP_META[id];const name=meta?.[0]||id;return `<div class="stop-row" data-stop-id="${escapeHtml(id)}"><div class="stop-no">${i+1}</div><div><div class="stop-name">${escapeHtml(name)}</div><div class="etas">${etaChips(s)}</div></div></div>`;}).join('')}`:'';
    return section('往程',groups.U)+section('回程',groups.D)+section('服務站',groups.X);
  }
  const oldBadge=operatorBadge;
  operatorBadge=function(op){return op==='MTRB'?badge():oldBadge(op);};
  const oldNormalized=normalizedRoutes;
  normalizedRoutes=function(){return [...oldNormalized(),...ROUTES];};
  const oldOpen=openRoute;
  openRoute=async function(r){
    if(r?.operator!=='MTRB')return oldOpen(r);
    state.selectedRoute=r;$('#resultsSection')?.classList.add('hidden');$('#routeSection')?.classList.remove('hidden');
    $('#routeHeader').innerHTML=`<div class="route-title"><div><div class="number">${escapeHtml(r.route)}</div><div class="dest">${escapeHtml(r.orig)} ↔ ${escapeHtml(r.dest)}</div>${badge()}</div></div>`;
    $('#directionTabs').innerHTML='';$('#stops').innerHTML='<div class="loading">正在載入港鐵巴士 ETA…</div>';
    try{const data=await schedule(r.route);$('#stops').innerHTML=renderStops(data)||'<div class="empty">暫時未有站點資料。</div>';}
    catch{$('#stops').innerHTML='<div class="empty">暫時未能取得港鐵巴士 ETA，請稍後再試。</div>';}
  };
  function installFilter(){
    const row=document.querySelector('.search-filters');if(!row||row.querySelector('[data-search-filter="MTRB"]'))return;
    const b=document.createElement('button');b.className='filter mtr-filter';b.dataset.searchFilter='MTRB';b.textContent='港鐵巴士';row.appendChild(b);
    b.addEventListener('click',()=>{state.searchFilter='MTRB';row.querySelectorAll('[data-search-filter]').forEach(x=>x.classList.toggle('active',x===b));if($('#routeSearch')?.value.trim())renderSearch();});
  }
  installFilter();
  window.dzMtrBus={version:VERSION,routes:ROUTES,stopMeta:STOP_META,schedule};
})();