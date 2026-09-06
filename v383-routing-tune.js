(() => {
  "use strict";
  const $=s=>document.querySelector(s);
  const extra=window.dzExtraTransit;
  const EAST_RAIL=[
    ["SHS","上水站",22.5011,114.1279],["FAN","粉嶺站",22.4920,114.1392],["TWO","太和站",22.4511,114.1612],["TAP","大埔墟站",22.4445,114.1706],
    ["UNI","大學站",22.4134,114.2101],["RAC","馬場站",22.4007,114.2021],["FOT","火炭站",22.3952,114.1983],["SHT","沙田站",22.3810,114.1870],
    ["TAW","大圍站",22.3727,114.1786],["KOT","九龍塘站",22.3369,114.1761],["MKK","旺角東站",22.3213,114.1726],["HUH","紅磡站",22.3030,114.1810],
    ["EXC","會展站",22.2831,114.1731],["ADM","金鐘站",22.2795,114.1654]
  ].map(([code,name_tc,lat,lon])=>({code,name_tc,lat,lon}));
  const NORTH_RE=/上水|粉嶺|聯和墟|古洞|坑頭|河上鄉|打鼓嶺|沙頭角/;
  const WEST_DEST_RE=/葵芳|葵興|葵涌|青衣|荃灣|如心|梨木樹/;
  const VIA_HUBS=["大欖隧道","元朗","天水圍","錦上路"];
  const norm=v=>String(v||"").replace(/[\s　]+/g,"");
  const geoStops=()=>typeof allJourneyStops==="function"?allJourneyStops().filter(s=>Number.isFinite(s.lat)&&Number.isFinite(s.lon)):[];
  const dist=(a,b)=>a&&b&&typeof distanceMeters==="function"?distanceMeters(a.lat,a.lon,b.lat,b.lon):Infinity;
  function centroid(a){const x=(a||[]).filter(s=>Number.isFinite(s.lat)&&Number.isFinite(s.lon));if(!x.length)return null;return{lat:x.reduce((n,s)=>n+s.lat,0)/x.length,lon:x.reduce((n,s)=>n+s.lon,0)/x.length};}
  function around(point,radius,limit=40){if(!point)return[];return geoStops().map(s=>({...s,distance:dist(point,s)})).filter(s=>s.distance<=radius).sort((a,b)=>a.distance-b.distance).slice(0,limit);}
  function originData(from){const loc=journeyState?.originLocation;if(loc)return{point:loc,stops:around(loc,1500,40)};const stops=typeof resolvePlace==="function"?resolvePlace(from,null):[];return{point:centroid(stops),stops};}
  function destinationData(to){const base=typeof resolvePlace==="function"?resolvePlace(to,null):[];const c=centroid(base);if(!c)return{stops:base,point:null};const more=around(c,1500,70),m=new Map();[...base,...more].forEach(s=>m.set(`${s.operator}|${s.id}`,s));const stops=[...m.values()];return{stops,point:centroid(stops)};}
  function nearestStation(point){let best=null;EAST_RAIL.forEach((s,i)=>{const d=dist(point,s);if(!best||d<best.distance)best={...s,index:i,distance:d};});return best;}
  function stationStops(st){return around(st,560,32);}
  async function directRows(origin,dest,withGmb=true){
    const out=[];try{if(typeof ensureJourneyIndexes==="function")await ensureJourneyIndexes();}catch{}
    try{if(journeyState?.kmbIndex)out.push(...directFromIndex(journeyState.kmbIndex,origin,dest));}catch{}
    try{if(journeyState?.ctbIndex)out.push(...directFromIndex(journeyState.ctbIndex,origin,dest));}catch{}
    if(withGmb&&out.length<2)try{if(typeof gmbDirect==="function")out.push(...await gmbDirect(origin,dest));}catch{}
    return out;
  }
  async function withEta(r){try{r.eta=await journeyEta(r);}catch{}return r;}
  function wait(r,def=8){return r?.eta&&typeof etaMinutes==="function"?Math.max(0,etaMinutes(r.eta)):def;}
  function ride(r){return Number(r?.stopCount||0)*1.7+Number(r?.walkMeters||0)/80;}
  async function bestNow(origin,dest){let rows=(await directRows(origin,dest,true)).slice(0,12);await Promise.all(rows.slice(0,6).map(withEta));return rows.filter(r=>r.eta).sort((a,b)=>(wait(a)+ride(a))-(wait(b)+ride(b)))[0]||null;}
  async function bestFuture(origin,dest,limit=2){let rows=(await directRows(origin,dest,true)).slice(0,18);return rows.sort((a,b)=>(7+ride(a))-(7+ride(b))).slice(0,limit);}

  async function eastRailFallback(from,to){
    const o=originData(from),d=destinationData(to);if(!o.point||!o.stops.length||!d.point||!d.stops.length)return[];
    const start=nearestStation(o.point),target=nearestStation(d.point);if(!start||!target||start.distance>6500||start.index===target.index)return[];
    let access=null,accessCost=start.distance/80;if(start.distance>1000){access=await bestNow(o.stops,stationStops(start));if(!access)return[];accessCost=wait(access)+ride(access);}
    const dir=target.index>start.index?1:-1,rows=[];let best=Infinity,scanned=0;
    for(let i=start.index+dir;i>=0&&i<EAST_RAIL.length&&scanned<8;i+=dir,scanned++){
      const st=EAST_RAIL[i],railStops=Math.abs(i-start.index),railCost=4+railStops*2.8;if(rows.length>=3&&railCost>best+22)break;
      let exits=[];const sd=dist(st,d.point);if(sd<=1050)exits=[{kind:"walk",walkMeters:sd,cost:sd/80}];else exits=(await bestFuture(stationStops(st),d.stops,2)).map(leg=>({kind:"transit",leg,cost:7+ride(leg)}));
      for(const exit of exits){const total=accessCost+railCost+exit.cost;rows.push({kind:"east_rail_chain",operator:"MTR",route:[access?.route,"EAL",exit.leg?.route].filter(Boolean).join(" → "),transferCount:(access?1:0)+(exit.leg?1:0),stopCount:railStops+Number(access?.stopCount||0)+Number(exit.leg?.stopCount||0),walkMeters:Number(access?.walkMeters||(!access?start.distance:0))+Number(exit.walkMeters||exit.leg?.walkMeters||0),eta:access?.eta||null,originStop:access?.originStop||{id:start.code,name:start.name_tc},destinationStop:exit.leg?.destinationStop||{id:st.code,name:st.name_tc},_dzEastRail:true,_dzEastRailTotal:total,_dzAccess:access?{kind:"transit",station:start,leg:access,cost:accessCost}:{kind:"walk",station:start,walkMeters:start.distance,cost:accessCost},_dzExit:exit.leg?{kind:"transit",station:st,leg:exit.leg,cost:exit.cost}:{kind:"walk",station:st,walkMeters:exit.walkMeters,cost:exit.cost},_dzRailStops:railStops,_dzStart:start,_dzExitStation:st,_dz383Fallback:true});best=Math.min(best,total);}
    }
    const seen=new Set();return rows.sort((a,b)=>a._dzEastRailTotal-b._dzEastRailTotal).filter(r=>{const k=`${r._dzExitStation.code}|${r._dzExit?.leg?.route||"W"}`;if(seen.has(k))return false;seen.add(k);return true;}).slice(0,4);
  }

  function stopPoint(op,id){const map=op==="KMB"?state.kmbStops:op==="CTB"?state.ctbStops:null,s=map?.get(String(id));if(!s)return null;const lat=Number(s.lat??s.latitude),lon=Number(s.long??s.lng??s.longitude);if(!Number.isFinite(lat)||!Number.isFinite(lon))return null;return{operator:op,id:String(id),name:journeyStopName(s),lat,lon,stop:s,distance:0};}
  function routeMeta(key){return typeof routeMetaFromKey==="function"?routeMetaFromKey(key):{};}
  function viaMainlines(originPoint){const out=[];for(const op of ["KMB","CTB"]){const idx=op==="KMB"?journeyState?.kmbIndex:journeyState?.ctbIndex;if(!idx)continue;for(const [key,r] of idx.byRoute){let gate=null,gatePos=-1;for(let i=1;i<r.stops.length;i++){const p=stopPoint(op,r.stops[i].stop);if(p&&VIA_HUBS.some(h=>norm(p.name).includes(norm(h)))){gate=p;gatePos=i;break;}}if(!gate)continue;let board=null;for(let i=0;i<gatePos;i++){const p=stopPoint(op,r.stops[i].stop);if(!p||!NORTH_RE.test(norm(p.name)))continue;const access=dist(originPoint,p);if(access<=8500&&(!board||access<board.access))board={p,pos:i,access};}if(board)out.push({op,key,r,gate,gatePos,board:board.p,boardPos:board.pos,access:board.access});}}
    return out.sort((a,b)=>a.access-b.access||((a.gatePos-a.boardPos)-(b.gatePos-b.boardPos))).slice(0,16);
  }
  async function viaDistrictCorridors(from,to){
    const o=originData(from),d=destinationData(to);if(!o.point||!d.point||!o.stops.length||!d.stops.length)return[];
    const originText=[from,...o.stops.slice(0,12).map(s=>s.name||s.name_tc||"")].join(" "),destText=[to,...d.stops.slice(0,20).map(s=>s.name||s.name_tc||"")].join(" ");if(!NORTH_RE.test(norm(originText))||!WEST_DEST_RE.test(norm(destText)))return[];
    const built=[];for(const c of viaMainlines(o.point).slice(0,10)){
      const boardNear=around(c.board,280,24);let access=null,accessCost=c.access/80;if(c.access>950){access=await bestNow(o.stops,boardNear);if(!access)continue;accessCost=wait(access)+ride(access);}
      const main={kind:"direct",operator:c.op,route:c.r.route,bound:c.r.bound,serviceType:c.r.serviceType,originStop:{...c.board,distance:0},destinationStop:{...c.gate,distance:0},originPos:c.boardPos,destinationPos:c.gatePos,stopCount:c.gatePos-c.boardPos,walkMeters:0,meta:routeMeta(c.key)};
      if(!access){await withEta(main);if(!main.eta)continue;}
      const lasts=await bestFuture(around(c.gate,300,32),d.stops,2);for(const last of lasts){const mainCost=wait(main,8)+ride(main),total=accessCost+mainCost+7+ride(last);built.push({kind:"district_corridor",operator:c.op,route:[access?.route,main.route,last.route].filter(Boolean).join(" → "),transferCount:(access?1:0)+1,stopCount:Number(access?.stopCount||0)+main.stopCount+Number(last.stopCount||0),walkMeters:Number(access?.walkMeters||0)+Number(last.walkMeters||0)+(access?0:c.access),eta:access?.eta||main.eta||null,_dzDistrictCorridor:true,_dzTotal:total,_dzAccess:access,_dzMain:main,_dzLast:last,_dzHub:c.gate.name,_dzBoard:c.board,_dzViaDistrict:true});}
      if(built.length>=8)break;
    }
    const seen=new Set();return built.sort((a,b)=>a._dzTotal-b._dzTotal).filter(x=>{const k=`${x._dzMain.route}|${norm(x._dzHub)}|${x._dzLast.route}`;if(seen.has(k))return false;seen.add(k);return true;}).slice(0,4);
  }

  let schedPromise=null;
  async function schedules(){if(!schedPromise)schedPromise=(async()=>{const meta=await getJSON("service-calendars.json",{ttl:86400000,retries:1});const [cs,ws]=await Promise.all([Promise.all(Array.from({length:meta.calendarShards||0},(_,i)=>getJSON(`service-calendars-${i}.json`,{ttl:86400000,retries:1}))),Promise.all(Array.from({length:meta.shards||0},(_,i)=>getJSON(`service-windows-${i}.json`,{ttl:86400000,retries:1})))]);return{calendars:Object.assign({},...cs),windows:Object.assign({},...ws)};})().catch(()=>null);return schedPromise;}
  function hkNow(){const p=new Intl.DateTimeFormat("en-CA",{timeZone:"Asia/Hong_Kong",year:"numeric",month:"2-digit",day:"2-digit",hour:"2-digit",minute:"2-digit",hourCycle:"h23"}).formatToParts(new Date()),v=Object.fromEntries(p.map(x=>[x.type,x.value]));return{date:`${v.year}${v.month}${v.day}`,minutes:Number(v.hour)*60+Number(v.minute)};}
  function shiftDate(date,days){const x=new Date(Date.UTC(+date.slice(0,4),+date.slice(4,6)-1,+date.slice(6,8)+days));return x.toISOString().slice(0,10).replaceAll("-","");}
  function weekday(date){const x=new Date(Date.UTC(+date.slice(0,4),+date.slice(4,6)-1,+date.slice(6,8)));return(x.getUTCDay()+6)%7;}
  function active(c,date){if(!c)return false;if(c.a?.includes(date))return true;if(c.r?.includes(date))return false;return !!c.d?.[weekday(date)];}
  async function scheduledAt(leg,offset){if(!leg||leg.operator==="MTR")return true;const data=await schedules();const key=`${leg.operator}|${leg.route}|${String(leg.bound||"O").toUpperCase()}`,sets=data?.windows?.[key];if(!sets)return null;const n=hkNow(),total=n.minutes+Math.max(0,Math.round(offset||0)),day=Math.floor(total/1440),minute=((total%1440)+1440)%1440,date=shiftDate(n.date,day),checks=[[date,minute],[shiftDate(date,-1),minute+1440]];for(const [dt,m] of checks)for(const [service,range] of Object.entries(sets))if(active(data.calendars?.[service],dt)&&m>=range[0]-5&&m<=range[1]+20)return true;return false;}
  async function keepFutureService(r){let leg=null,offset=0;if(r?._dzDistrictCorridor){leg=r._dzLast;offset=(r._dzAccess?wait(r._dzAccess)+ride(r._dzAccess):0)+wait(r._dzMain,8)+ride(r._dzMain);}else if(r?._dzEastRail){leg=r._dzExit?.leg;offset=Number(r._dzAccess?.cost||0)+4+Number(r._dzRailStops||0)*2.8;}else if(r?.kind==="transfer"){leg=r.second;offset=wait(r.first,8)+ride(r.first);}if(!leg)return true;const x=await scheduledAt(leg,offset);return x!==false;}

  if(typeof runJourneySearch==="function"){
    const previous=runJourneySearch;
    runJourneySearch=async function(){const from=$("#journeyFrom")?.value.trim()||"",to=$("#journeyTo")?.value.trim()||"";await previous();let added=0;
      if(!(journeyState.results||[]).some(r=>r?._dzEastRail)){const e=await eastRailFallback(from,to).catch(()=>[]);if(e.length){journeyState.results.push(...e);added+=e.length;}}
      const via=await viaDistrictCorridors(from,to).catch(()=>[]);if(via.length){const seen=new Set((journeyState.results||[]).map(r=>r?._dzDistrictCorridor?`${r._dzMain?.route}|${norm(r._dzHub)}|${r._dzLast?.route}`:""));for(const x of via){const k=`${x._dzMain.route}|${norm(x._dzHub)}|${x._dzLast.route}`;if(!seen.has(k)){journeyState.results.push(x);seen.add(k);added++;}}}
      const checked=await Promise.all((journeyState.results||[]).map(async r=>({r,ok:await keepFutureService(r)})));const before=journeyState.results.length;journeyState.results=checked.filter(x=>x.ok).map(x=>x.r);const removed=before-journeyState.results.length;
      try{renderJourneyResults();}catch{};const st=$("#journeyStatus");if(st){if(added)st.textContent=`${st.textContent||""}；v3.8.3 補充 ${added} 個東鐵／中途區域方案。`;if(removed)st.textContent=`${st.textContent||""}；已按預計轉車時間隱藏 ${removed} 個屆時未有服務方案。`;}
    };
  }
  window.dzRoutingTune383={version:"3.8.3",eastRailFallback,viaDistrictCorridors,scheduledAt};
})();
