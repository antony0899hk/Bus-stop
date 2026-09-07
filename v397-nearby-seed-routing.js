(() => {
  "use strict";
  const $=s=>document.querySelector(s);
  const norm=v=>String(v||'').trim();
  const opIndex=op=>op==='KMB'?journeyState?.kmbIndex:op==='CTB'?journeyState?.ctbIndex:null;
  const stopMap=op=>op==='KMB'?state.kmbStops:op==='CTB'?state.ctbStops:null;
  const stopPoint=(op,id)=>{const s=stopMap(op)?.get(String(id));if(!s)return null;const lat=Number(s.lat??s.latitude),lon=Number(s.long??s.lng??s.longitude);return Number.isFinite(lat)&&Number.isFinite(lon)?{operator:op,id:String(id),name:journeyStopName(s),lat,lon,stop:s,distance:0}:null;};
  const keyOf=r=>r?.kind==='transfer'?`${r.first?.operator}|${r.first?.route}>${r.second?.operator}|${r.second?.route}`:`${r?.operator}|${r?.route}|${r?.bound||''}`;
  function nearbySeeds(){
    const rows=[...(state?.nearby||[])].filter(x=>['KMB','CTB'].includes(x.operator)&&x.route&&x.stopId);
    rows.sort((a,b)=>{const ea=a.eta?new Date(a.eta).getTime():Infinity,eb=b.eta?new Date(b.eta).getTime():Infinity;return ea-eb||Number(a.distance||0)-Number(b.distance||0);});
    const seen=new Set(),out=[];for(const x of rows){const k=`${x.operator}|${x.route}|${x.stopId}`;if(seen.has(k))continue;seen.add(k);out.push(x);if(out.length>=8)break;}return out;
  }
  function destinationSets(to){const rows=typeof resolvePlace==='function'?resolvePlace(to,null):[];return{rows,byOp:{KMB:new Set(rows.filter(x=>x.operator==='KMB').map(x=>String(x.id))),CTB:new Set(rows.filter(x=>x.operator==='CTB').map(x=>String(x.id)))}};}
  function routeAtSeed(seed){const idx=opIndex(seed.operator);if(!idx)return[];const out=[];for(const [rk,r] of idx.byRoute){if(String(r.route)!==String(seed.route))continue;const p=r.stops.findIndex(s=>String(s.stop)===String(seed.stopId));if(p>=0)out.push({rk,r,p});}return out;}
  function nearbyTransferStops(p,op){
    if(!p)return[];const map=stopMap(op),out=[];for(const [id,s] of map||[]){const lat=Number(s.lat??s.latitude),lon=Number(s.long??s.lng??s.longitude);if(!Number.isFinite(lat)||!Number.isFinite(lon))continue;const d=distanceMeters(p.lat,p.lon,lat,lon);if(d<=240)out.push({operator:op,id:String(id),name:journeyStopName(s),lat,lon,stop:s,distance:d});}return out.sort((a,b)=>a.distance-b.distance).slice(0,12);
  }
  function findSecondLeg(op,board,destSet){
    const idx=opIndex(op);if(!idx||!destSet?.size)return[];const out=[];
    for(const mem of idx.byStop.get(String(board.id))||[]){const r=idx.byRoute.get(mem.routeKey);if(!r)continue;for(let j=mem.pos+1;j<r.stops.length;j++){if(!destSet.has(String(r.stops[j].stop)))continue;const dest=stopPoint(op,r.stops[j].stop);if(dest)out.push({routeKey:mem.routeKey,r,mem,dest,j});break;}}
    return out;
  }
  async function buildSeeded(to){
    try{if(typeof ensureJourneyIndexes==='function')await ensureJourneyIndexes();}catch{}
    const seeds=nearbySeeds();if(!seeds.length)return[];const d=destinationSets(to),built=[];
    for(const seed of seeds){
      for(const firstRef of routeAtSeed(seed).slice(0,2)){
        const first=firstRef.r,start=firstRef.p;
        for(let i=start+1;i<Math.min(first.stops.length,start+36);i++){
          const firstStop=stopPoint(seed.operator,first.stops[i].stop);if(!firstStop)continue;
          for(const op2 of ['KMB','CTB']){
            const boards=op2===seed.operator?[firstStop]:nearbyTransferStops(firstStop,op2);
            for(const board of boards.slice(0,5)){
              for(const s2 of findSecondLeg(op2,board,d.byOp[op2]).slice(0,3)){
                const fm=routeMetaFromKey(firstRef.rk),sm=routeMetaFromKey(s2.routeKey);
                built.push({kind:'transfer',transferCount:1,first:{...fm,originStop:{operator:seed.operator,id:String(seed.stopId),name:seed.stopName||'',distance:Number(seed.distance||0)},transferStopId:firstStop.id,stopCount:i-start},second:{...sm,transferStopId:board.id,destinationStop:s2.dest,stopCount:s2.j-s2.mem.pos},transferStopId:firstStop.id,transferStopName:firstStop.name,walkMeters:Number(seed.distance||0)+Number(board.distance||0),stopCount:(i-start)+(s2.j-s2.mem.pos),firstEta:seed.eta||null,eta:seed.eta||null,_dzSeededNearby:true,_dzSeedRoute:seed.route});
              }
            }
          }
          if(built.filter(x=>x._dzSeedRoute===seed.route).length>=4)break;
        }
      }
    }
    const m=new Map();for(const r of built){const k=keyOf(r);if(!m.has(k))m.set(k,r);}return[...m.values()].slice(0,10);
  }
  if(typeof runJourneySearch==='function'){
    const old=runJourneySearch;
    runJourneySearch=async function(){
      await old();
      const from=$('#journeyFrom')?.value.trim()||'',to=$('#journeyTo')?.value.trim()||'';
      if(from!=='我的位置' || !journeyState?.originLocation || !to)return;
      let seeded=[];try{seeded=await buildSeeded(to);}catch{}
      if(!seeded.length)return;
      const m=new Map();for(const r of [...seeded,...(journeyState.results||[])]){const k=keyOf(r);if(!m.has(k))m.set(k,r);}
      let rows=[...m.values()];const pm=window.dzJourney396?.provisionalMinutes;if(pm)rows.forEach(r=>r._dzDisplayMinutes=pm(r));rows.sort((a,b)=>(a._dzDisplayMinutes??9999)-(b._dzDisplayMinutes??9999));journeyState.results=rows.slice(0,12);try{renderJourneyResults();}catch{}
      const st=$('#journeyStatus');if(st)st.textContent=`先由附近實際可搭路線展開，再沿途找可轉車站往目的地；加入 ${seeded.length} 個附近路線種子方案。`;
    };
  }
  window.dzNearbySeed397={version:'3.9.7',buildSeeded};
})();