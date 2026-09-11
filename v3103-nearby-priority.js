(() => {
  "use strict";
  const VERSION="4.1.0";
  const nativeFetch=window.fetch.bind(window);
  const stage={version:VERSION,gmbStarted:false,gmbReady:true,mtrReady:false,secondPhaseReady:false,mtrPromise:null,readyPromise:null,readyResolve:null};
  stage.readyPromise=new Promise(resolve=>{stage.readyResolve=resolve;});
  window.dzStageLoader3105=stage;

  function checkReady(){if(!stage.secondPhaseReady&&stage.gmbReady&&stage.mtrReady){stage.secondPhaseReady=true;stage.readyResolve?.();document.dispatchEvent(new CustomEvent("dz:nearby-secondary-ready"));}}
  async function prepareMtr(){if(stage.mtrPromise)return stage.mtrPromise;stage.mtrPromise=(async()=>{try{await window.dzExtraTransit?.ensureMtrData?.();}catch{}stage.mtrReady=true;checkReady();})();return stage.mtrPromise;}
  function startSecondPhase(){stage.gmbStarted=true;prepareMtr();}

  let routeLitePromise=null;
  async function loadGmbRoutesLite(){
    try{if(state?.gmbRoutes?.length)return state.gmbRoutes;}catch{}
    if(routeLitePromise)return routeLitePromise;
    routeLitePromise=(async()=>{
      try{
        const r=await nativeFetch(`./runtime/gmb/routes-index.json?v=${encodeURIComponent(window.DZ_BUILD||VERSION)}`,{cache:"force-cache"});
        if(!r.ok)throw new Error(`HTTP ${r.status}`);
        const j=await r.json(),rows=j.data||[];
        if(typeof state!=="undefined")state.gmbRoutes=rows;
        return rows;
      }catch{return [];}
    })().finally(()=>{routeLitePromise=null;});
    return routeLitePromise;
  }

  let gmbConfigPromise=null;
  async function gmbCell(){
    if(gmbConfigPromise)return gmbConfigPromise;
    gmbConfigPromise=nativeFetch(`./runtime/gmb/config.json?v=${encodeURIComponent(window.DZ_BUILD||VERSION)}`,{cache:"force-cache"})
      .then(r=>r.ok?r.json():{cell:.01}).then(j=>Number(j.cell)||.01).catch(()=>.01);
    return gmbConfigPromise;
  }
  function tileKeys(pos,radius,cell){
    const latCells=Math.ceil((radius/110540)/cell)+1;
    const lonCells=Math.ceil((radius/(111320*Math.max(.3,Math.cos(pos.lat*Math.PI/180))))/cell)+1;
    const cy=Math.floor(pos.lat/cell),cx=Math.floor(pos.lon/cell),out=[];
    for(let y=cy-latCells;y<=cy+latCells;y++)for(let x=cx-lonCells;x<=cx+lonCells;x++)out.push(`${y}-${x}`);
    return out;
  }
  async function scanGmbNearby(pos,radius=100,limit=8){
    const cell=await gmbCell(),found=[],seen=new Set();
    for(const key of tileKeys(pos,radius,cell)){
      try{
        const r=await nativeFetch(`./runtime/gmb/tile-${key}.json?v=${encodeURIComponent(window.DZ_BUILD||VERSION)}`,{cache:"force-cache"});
        if(!r.ok)continue;
        const j=await r.json();
        for(const s of j.data||[]){
          const lat=Number(s.lat??s.latitude),lon=Number(s.long??s.lng??s.longitude);if(!Number.isFinite(lat)||!Number.isFinite(lon))continue;
          const d=typeof distanceMeters==="function"?distanceMeters(pos.lat,pos.lon,lat,lon):Infinity;if(!Number.isFinite(d)||d>radius)continue;
          const id=String(s.stop||s.stop_id||"");if(!id||seen.has(id))continue;seen.add(id);
          found.push({operator:"GMB",id,stop:s,lat,lon,name:s.name_tc||s.name||"",distance:d});
        }
      }catch{}
    }
    found.sort((a,b)=>a.distance-b.distance);
    return found.slice(0,Math.max(1,Number(limit)||8));
  }

  setTimeout(()=>{prepareMtr().catch(()=>{});},300);
  window.dzNearbyPriority3105={version:VERSION,startSecondPhase,prepareMtr,loadGmbRoutesLite,scanGmbNearby,whenReady:()=>stage.readyPromise};
})();