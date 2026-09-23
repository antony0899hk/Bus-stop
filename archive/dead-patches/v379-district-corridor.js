(() => {
  "use strict";
  const $=s=>document.querySelector(s);
  const BOARD_MAX=8500;
  const LOCAL_RADIUS=1500;
  const DEST_RADIUS=1500;
  const HUB_WALK=260;
  const MAX_CORRIDORS=5;

  const DISTRICTS=[
    ["中西區",/中環|金鐘|上環|西營盤|石塘咀|堅尼地城|山頂/],
    ["灣仔區",/灣仔|銅鑼灣|跑馬地|大坑/],
    ["東區",/北角|鰂魚涌|太古|西灣河|筲箕灣|柴灣|小西灣/],
    ["南區",/香港仔|黃竹坑|鴨脷洲|薄扶林|赤柱|淺水灣/],
    ["油尖旺區",/尖沙咀|佐敦|油麻地|旺角|大角咀/],
    ["深水埗區",/深水埗|長沙灣|荔枝角|美孚|石硤尾/],
    ["九龍城區",/九龍城|土瓜灣|紅磡|何文田|啟德/],
    ["黃大仙區",/黃大仙|鑽石山|慈雲山|彩虹|新蒲崗/],
    ["觀塘區",/觀塘|九龍灣|牛頭角|藍田|油塘|秀茂坪|寶達/],
    ["葵青區",/葵芳|葵興|葵涌|青衣/],
    ["荃灣區",/荃灣|愉景新城|如心|梨木樹/],
    ["屯門區",/屯門|兆康|良景|蝴蝶|置樂/],
    ["元朗區",/元朗|天水圍|朗屏|錦田|洪水橋/],
    ["北區",/上水|粉嶺|聯和墟|古洞|坑頭|河上鄉|打鼓嶺|沙頭角/],
    ["大埔區",/大埔|太和|廣福|富亨|大埔墟/],
    ["沙田區",/沙田|火炭|大圍|馬鞍山|耀安|恆安|烏溪沙|第一城|石門|大學站|中文大學/],
    ["西貢區",/將軍澳|坑口|寶琳|調景嶺|西貢|康城/],
    ["離島區",/東涌|機場|迪士尼|梅窩|大澳|愉景灣/]
  ];

  const TARGET_HUBS={
    "中西區":["紅磡海底隧道","西區海底隧道","金鐘","中環"],
    "灣仔區":["紅磡海底隧道","東區海底隧道","灣仔","銅鑼灣"],
    "東區":["東區海底隧道","北角","鰂魚涌","太古"],
    "南區":["香港仔隧道","黃竹坑","金鐘"],
    "油尖旺區":["旺角","尖沙咀","紅磡","美孚"],
    "深水埗區":["美孚","長沙灣","深水埗"],
    "九龍城區":["紅磡","九龍塘","啟德"],
    "黃大仙區":["鑽石山","黃大仙","大老山隧道"],
    "觀塘區":["大老山隧道","觀塘","藍田","東區海底隧道"],
    "葵青區":["青衣","葵芳","城門隧道"],
    "荃灣區":["城門隧道","大欖隧道","荃灣","如心"],
    "屯門區":["屯門公路轉車站","大欖隧道","屯門"],
    "元朗區":["大欖隧道","元朗","天水圍"],
    "北區":["上水","粉嶺","粉嶺公路轉車站"],
    "大埔區":["大埔","廣福","大學站"],
    "沙田區":["大老山隧道","沙田站","大學站","城門隧道","大圍"],
    "西貢區":["將軍澳隧道","調景嶺","寶琳","坑口"],
    "離島區":["青衣","東涌","機場"]
  };

  const norm=v=>String(v||"").replace(/[\s　]+/g,"");
  const geoStops=()=>typeof allJourneyStops==="function"?allJourneyStops().filter(s=>Number.isFinite(s.lat)&&Number.isFinite(s.lon)):[];
  const d=(a,b)=>a&&b&&typeof distanceMeters==="function"?distanceMeters(a.lat,a.lon,b.lat,b.lon):Infinity;
  function centroid(a){const x=(a||[]).filter(s=>Number.isFinite(s.lat)&&Number.isFinite(s.lon));if(!x.length)return null;return{lat:x.reduce((n,s)=>n+s.lat,0)/x.length,lon:x.reduce((n,s)=>n+s.lon,0)/x.length};}
  function districtOfText(text){const s=norm(text);for(const [name,re] of DISTRICTS)if(re.test(s))return name;return null;}
  function districtOfStops(stops){const count=new Map();for(const s of stops||[]){const k=districtOfText(s.name||s.name_tc||"");if(k)count.set(k,(count.get(k)||0)+1);}return [...count.entries()].sort((a,b)=>b[1]-a[1])[0]?.[0]||null;}
  function around(point,radius,limit=40){if(!point)return[];return geoStops().map(s=>({...s,distance:d(point,s)})).filter(s=>s.distance<=radius).sort((a,b)=>a.distance-b.distance).slice(0,limit);}
  function stopPoint(op,id){const map=op==="KMB"?state.kmbStops:op==="CTB"?state.ctbStops:null;const s=map?.get(String(id));if(!s)return null;const lat=Number(s.lat??s.latitude),lon=Number(s.long??s.lng??s.longitude);if(!Number.isFinite(lat)||!Number.isFinite(lon))return null;return{operator:op,id:String(id),name:journeyStopName(s),lat,lon,stop:s,distance:0};}
  function indexFor(op){return op==="KMB"?journeyState.kmbIndex:op==="CTB"?journeyState.ctbIndex:null;}
  function routeKeyMeta(key){return typeof routeMetaFromKey==="function"?routeMetaFromKey(key):{};}
  function destinationCluster(to){const base=resolvePlace(to,null);const c=centroid(base);if(!c)return base;const more=around(c,DEST_RADIUS,60);const m=new Map();[...base,...more].forEach(s=>m.set(`${s.operator}|${s.id}`,s));return[...m.values()];}

  async function busDirect(origin,dest){const out=[];try{await ensureJourneyIndexes();}catch{};try{if(journeyState.kmbIndex)out.push(...directFromIndex(journeyState.kmbIndex,origin,dest));}catch{};try{if(journeyState.ctbIndex)out.push(...directFromIndex(journeyState.ctbIndex,origin,dest));}catch{};try{if(typeof gmbDirect==="function")out.push(...await gmbDirect(origin,dest));}catch{};return out;}
  async function etaLeg(r){try{r.eta=await journeyEta(r);}catch{}return r;}
  function legMinutes(r){const wait=r?.eta&&typeof etaMinutes==="function"?Math.max(0,etaMinutes(r.eta)):10;return wait+Number(r?.stopCount||0)*1.7+Number(r?.walkMeters||0)/80;}
  async function bestDirect(origin,dest){const rows=(await busDirect(origin,dest)).slice(0,18);await Promise.all(rows.slice(0,8).map(etaLeg));rows.sort((a,b)=>legMinutes(a)-legMinutes(b));return rows[0]||null;}

  function gatewayMatches(targetDistrict){return TARGET_HUBS[targetDistrict]||[];}
  function routesToGateway(originPoint,originDistrict,targetDistrict){
    const hubs=gatewayMatches(targetDistrict),out=[];
    for(const op of ["KMB","CTB"]){const idx=indexFor(op);if(!idx)continue;
      for(const [key,r] of idx.byRoute){let gatePos=-1,gate=null;
        for(let i=1;i<r.stops.length;i++){const p=stopPoint(op,r.stops[i].stop);if(p&&hubs.some(h=>norm(p.name).includes(norm(h)))){gatePos=i;gate=p;break;}}
        if(gatePos<1||!gate)continue;
        let best=null;
        for(let i=0;i<gatePos;i++){const p=stopPoint(op,r.stops[i].stop);if(!p)continue;if(districtOfText(p.name)!==originDistrict)continue;const access=d(originPoint,p);if(access>BOARD_MAX)continue;if(!best||access<best.access)best={p,pos:i,access};}
        if(!best)continue;
        out.push({op,key,route:r,board:best.p,boardPos:best.pos,access:best.access,gate,gatePos,hub:gate.name});
      }
    }
    return out.sort((a,b)=>a.access-b.access||((a.gatePos-a.boardPos)-(b.gatePos-b.boardPos))).slice(0,18);
  }

  async function buildCorridor(c,originPoint,originStops,destinationStops){
    const boardNear=around(c.board,HUB_WALK,20);
    let access=null,accessMin=c.access/80;
    if(c.access>950){access=await bestDirect(originStops,boardNear);if(!access)return null;accessMin=legMinutes(access);}
    const main={kind:"direct",operator:c.op,route:c.route.route,bound:c.route.bound,serviceType:c.route.serviceType,originStop:{...c.board,distance:0},destinationStop:{...c.gate,distance:0},originPos:c.boardPos,destinationPos:c.gatePos,stopCount:c.gatePos-c.boardPos,walkMeters:0,meta:routeKeyMeta(c.key)};
    await etaLeg(main);if(!main.eta)return null;
    const hubNear=around(c.gate,HUB_WALK,28);
    const last=await bestDirect(hubNear,destinationStops);if(!last)return null;
    const total=accessMin+legMinutes(main)+legMinutes(last);
    return{kind:"district_corridor",operator:c.op,route:[access?.route,main.route,last.route].filter(Boolean).join(" → "),transferCount:(access?1:0)+1,stopCount:Number(access?.stopCount||0)+main.stopCount+Number(last.stopCount||0),walkMeters:Number(access?.walkMeters||0)+Number(last.walkMeters||0)+(access?0:c.access),eta:access?.eta||main.eta,_dzDistrictCorridor:true,_dzTotal:total,_dzAccess:access,_dzMain:main,_dzLast:last,_dzHub:c.hub,_dzBoard:c.board};
  }

  async function build(from,to){
    const loc=journeyState?.originLocation;const originStops=loc?around(loc,LOCAL_RADIUS,36):resolvePlace(from,null);const op=loc||centroid(originStops);const dest=destinationCluster(to);const dp=centroid(dest);if(!op||!dp||!originStops.length||!dest.length)return[];
    const originDistrict=districtOfStops(originStops)||districtOfText(from);const targetDistrict=districtOfStops(dest)||districtOfText(to);if(!originDistrict||!targetDistrict||originDistrict===targetDistrict)return[];
    const corridors=routesToGateway(op,originDistrict,targetDistrict);const built=[];
    for(const c of corridors.slice(0,10)){const x=await buildCorridor(c,op,originStops,dest).catch(()=>null);if(x)built.push(x);if(built.length>=8)break;}
    const seen=new Set();return built.sort((a,b)=>a._dzTotal-b._dzTotal).filter(x=>{const k=`${x._dzMain.route}|${norm(x._dzHub)}|${x._dzLast.route}`;if(seen.has(k))return false;seen.add(k);return true;}).slice(0,MAX_CORRIDORS);
  }

  function render(c){const a=c._dzAccess,m=c._dzMain,l=c._dzLast;const mins=Math.max(1,Math.round(c._dzTotal));const first=a?`${a.route} → ${m.route}`:m.route;return `<article class="journey-card district-corridor-card"><div class="journey-rank">◎</div><div class="journey-main"><div class="journey-top"><div><span class="badge ${String(m.operator||'').toLowerCase()}">${escapeHtml(m.operator==='CTB'?'城巴':'九巴')}</span> <strong class="journey-route">${escapeHtml(first)} → ${escapeHtml(l.route)}</strong></div><div class="journey-eta">約 ${mins} 分</div></div><div class="journey-title">${escapeHtml(a?.originStop?.name||c._dzBoard.name)} → ${escapeHtml(c._dzHub)} → ${escapeHtml(l.destinationStop?.name||'目的地')}</div><div class="journey-meta">18區 Corridor：經 ${escapeHtml(c._dzHub)} · 約 ${c.stopCount} 站${c.walkMeters?` · 步行約 ${Math.round(c.walkMeters)}m`:''}</div><div class="journey-note">先選跨區主走廊／大型 Gateway，再由 Gateway 搜尋九巴、城巴及小巴最後一程。</div></div></article>`;}

  if(typeof runJourneySearch==="function"){
    const previous=runJourneySearch;
    runJourneySearch=async function(){const from=$("#journeyFrom")?.value.trim()||"",to=$("#journeyTo")?.value.trim()||"";await previous();const rows=await build(from,to).catch(()=>[]);journeyState.results=journeyState.results.filter(r=>!r?._dzDistrictCorridor);if(rows.length)journeyState.results.push(...rows);try{renderJourneyResults();}catch{};const st=$("#journeyStatus");if(st&&rows.length)st.textContent=`${st.textContent||''}；18區 Corridor 另找到 ${rows.length} 個跨區 Gateway 方案。`;};
  }
  if(typeof renderJourneyResults==="function"){
    const old=renderJourneyResults;renderJourneyResults=function(){const rows=(journeyState?.results||[]).filter(r=>r?._dzDistrictCorridor);if(!rows.length)return old();const original=journeyState.results;journeyState.results=original.filter(r=>!r?._dzDistrictCorridor);old();journeyState.results=original;const box=$("#journeyResults");if(box)rows.sort((a,b)=>a._dzTotal-b._dzTotal).forEach(x=>box.insertAdjacentHTML("beforeend",render(x)));};
  }
  window.dzDistrictCorridor={version:"3.7.9",build};
})();