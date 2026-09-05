(() => {
  "use strict";
  const $=s=>document.querySelector(s);
  const cache=new Map();
  let schedulesPromise=null;

  function future(eta){const t=Date.parse(eta||"");return Number.isFinite(t)&&t>Date.now()-60000;}
  function cacheKey(leg){return `${leg?.operator}|${leg?.route}|${leg?.bound||""}|${leg?.serviceType||"1"}`;}

  async function kmbOperating(leg){
    const j=await getJSON(`${KMB_API}/route-eta/${encodeURIComponent(leg.route)}/${encodeURIComponent(leg.serviceType||"1")}`,{ttl:60000,retries:0});
    return (j.data||[]).some(x=>(!leg.bound||!x.dir||String(x.dir).toUpperCase()===String(leg.bound).toUpperCase())&&future(x.eta));
  }
  async function ctbOperating(leg){
    const dir=String(leg.bound||"O").toLowerCase();
    const rs=await getJSON(`${CTB_API}/route-stop/CTB/${encodeURIComponent(leg.route)}/${encodeURIComponent(dir)}`,{ttl:300000,retries:0});
    const first=(rs.data||[])[0]?.stop;
    if(!first)return false;
    const j=await getJSON(`${CTB_API}/eta/CTB/${encodeURIComponent(first)}/${encodeURIComponent(leg.route)}`,{ttl:60000,retries:0});
    return (j.data||[]).some(x=>(!leg.bound||!x.dir||String(x.dir).toUpperCase()===String(leg.bound).toUpperCase())&&future(x.eta));
  }
  function hkNow(){const parts=new Intl.DateTimeFormat("en-CA",{timeZone:"Asia/Hong_Kong",year:"numeric",month:"2-digit",day:"2-digit",hour:"2-digit",minute:"2-digit",hourCycle:"h23"}).formatToParts(new Date());const v=Object.fromEntries(parts.map(x=>[x.type,x.value]));return{date:`${v.year}${v.month}${v.day}`,minutes:Number(v.hour)*60+Number(v.minute)};}
  function shiftDate(yyyymmdd,days){const d=new Date(Date.UTC(Number(yyyymmdd.slice(0,4)),Number(yyyymmdd.slice(4,6))-1,Number(yyyymmdd.slice(6,8))+days));return d.toISOString().slice(0,10).replaceAll("-","");}
  function weekday(date){const d=new Date(Date.UTC(Number(date.slice(0,4)),Number(date.slice(4,6))-1,Number(date.slice(6,8))));return(d.getUTCDay()+6)%7;}
  async function schedules(){if(!schedulesPromise)schedulesPromise=(async()=>{const meta=await getJSON("service-calendars.json",{ttl:86400000,retries:1});const [calendarParts,parts]=await Promise.all([Promise.all(Array.from({length:meta.calendarShards||0},(_,i)=>getJSON(`service-calendars-${i}.json`,{ttl:86400000,retries:1}))),Promise.all(Array.from({length:meta.shards||0},(_,i)=>getJSON(`service-windows-${i}.json`,{ttl:86400000,retries:1})))]);return{calendars:Object.assign({},...calendarParts),windows:Object.assign({},...parts)};})().catch(()=>null);return schedulesPromise;}
  function activeCalendar(c,date){if(!c)return false;if(c.a?.includes(date))return true;if(c.r?.includes(date))return false;return !!c.d?.[weekday(date)];}
  function scheduledNow(data,leg){
    const key=`${leg.operator}|${leg.route}|${String(leg.bound||"O").toUpperCase()}`,sets=data?.windows?.[key];if(!sets)return null;
    const now=hkNow(),checks=[[now.date,now.minutes],[shiftDate(now.date,-1),now.minutes+1440]];
    for(const [date,minute] of checks)for(const [service,range] of Object.entries(sets))if(activeCalendar(data.calendars?.[service],date)&&minute>=range[0]-5&&minute<=range[1]+20)return true;
    return false;
  }
  async function isOperating(leg){
    if(!leg||leg.operator==="MTR")return true;
    const key=cacheKey(leg);if(cache.has(key))return cache.get(key);
    const p=(async()=>{
      try{
        const byTime=scheduledNow(await schedules(),leg);
        if(byTime!==null)return byTime;
        if(leg.operator==="KMB")return await kmbOperating(leg);
        if(leg.operator==="CTB")return await ctbOperating(leg);
        if(leg.operator==="GMB"&&typeof journeyEta==="function")return !!(await journeyEta(leg));
        return true;
      }catch{return false;}
    })();cache.set(key,p);return p;
  }
  function legs(r){
    if(r?.kind==="transfer")return[r.first,r.second];
    if(r?._dzEastRail)return[r._dzAccess?.leg,r._dzExit?.leg].filter(Boolean);
    if(r?._dzMtrChain)return[r._dzAccess?.leg,r._dzExit?.leg].filter(Boolean);
    return r?.operator==="MTR"?[]:[r];
  }
  async function filterRows(rows){
    const checked=await Promise.all((rows||[]).map(async r=>({r,ok:(await Promise.all(legs(r).map(isOperating))).every(Boolean)})));
    return checked.filter(x=>x.ok).map(x=>x.r);
  }

  if(typeof runJourneySearch!=="function")return;
  const previous=runJourneySearch;
  runJourneySearch=async function(){
    document.body.classList.add("dz-journey-searching");
    const box=$("#journeyResults");if(box)box.setAttribute("aria-busy","true");
    try{
      await previous();
      const before=(journeyState.results||[]).length;
      journeyState.results=await filterRows(journeyState.results||[]);
      try{renderJourneyResults();}catch{}
      const removed=before-journeyState.results.length,st=$("#journeyStatus");
      if(st&&removed>0)st.textContent=`${st.textContent||""}；已按今日服務日及現時服務時段隱藏 ${removed} 個不可用方案。`;
    }finally{
      document.body.classList.remove("dz-journey-searching");
      if(box)box.removeAttribute("aria-busy");
    }
  };
  window.dzServiceWindowFilter={version:"3.8.1",isOperating};
})();
