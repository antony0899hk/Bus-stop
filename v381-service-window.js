(() => {
  "use strict";
  const $=s=>document.querySelector(s);
  const cache=new Map();

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
  async function isOperating(leg){
    if(!leg||leg.operator==="MTR")return true;
    const key=cacheKey(leg);if(cache.has(key))return cache.get(key);
    const p=(async()=>{
      try{
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
