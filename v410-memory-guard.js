(() => {
  "use strict";
  const VERSION="4.0.10";
  const sleep=ms=>new Promise(r=>setTimeout(r,ms));

  // Keep route-detail ETA fan-out modest on iPhone Safari.
  window.parallel = async function parallel(items, limit, worker){
    const list=Array.from(items||[]); let next=0;
    const n=Math.max(1,Math.min(Number(limit)||3,3,list.length||1));
    async function run(){while(next<list.length){const i=next++;try{await worker(list[i],i);}catch{}if((i&3)===3)await sleep(0);}}
    await Promise.all(Array.from({length:n},run));
  };

  function clearResponseCache(){
    try{
      if(typeof responseCache!=="undefined"&&responseCache?.clear) responseCache.clear();
    }catch{}
  }

  function releaseTransientNearby(){
    try{window.dzNearby404?.releaseGrids?.();}catch{}
    try{window.dzReleaseFareMemory?.();}catch{}
    clearResponseCache();
    // Keep visible nearby results on screen, but drop non-essential expanded state.
    try{if(typeof state!=="undefined") state.nearbyExpanded=false;}catch{}
  }

  // Static JSON is already copied into state; retaining the same parsed payloads in
  // responseCache doubles memory for no benefit. Periodically discard those copies.
  function trimStaticCopies(){
    try{
      if(typeof responseCache==="undefined") return;
      for(const key of [...responseCache.keys()]){
        if(/(?:^|\/)gmb-(?:routes|stops)-\d+\.json(?:$|\?)/i.test(key)||/(?:^|\/)(?:kmb|ctb)-(?:routes|stops)\.json(?:$|\?)/i.test(key)) responseCache.delete(key);
      }
    }catch{}
  }

  setTimeout(trimStaticCopies,3000);
  setInterval(trimStaticCopies,15000);

  // Before a route search starts, free temporary nearby/fare/network caches first.
  window.addEventListener("click",e=>{
    if(e.target.closest?.("#searchBtn")) releaseTransientNearby();
  },true);
  window.addEventListener("keydown",e=>{
    if(e.key==="Enter"&&e.target?.id==="routeSearch") releaseTransientNearby();
  },true);

  window.dzMemoryGuard410={version:VERSION,releaseTransientNearby,trimStaticCopies};
})();