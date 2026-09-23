(() => {
  "use strict";
  // Safari memory guard: nearby search must stay text/ETA-only.
  // Map + continuous geolocation start only after the user explicitly opens the map.
  const originalShow=window.dzMapToggle395?.showMap;
  const state=window.dzNearbyMapState;
  function stopWatch(){
    try{if(state?.watchId!=null&&navigator.geolocation){navigator.geolocation.clearWatch(state.watchId);state.watchId=null;}}catch{}
  }
  stopWatch();
  if(window.dzMapToggle395&&typeof originalShow==='function'){
    window.dzMapToggle395.showMap=async function(){
      const out=await originalShow();
      try{
        if(state?.watchId==null&&navigator.geolocation){
          state.watchId=navigator.geolocation.watchPosition(pos=>{
            const next={lat:pos.coords.latitude,lon:pos.coords.longitude};
            state.lastPosition=state.position;state.position=next;
            state.heading=Number.isFinite(pos.coords.heading)?pos.coords.heading:state.heading;
            const L=window.L;
            if(state.map&&state.userMarker&&L){
              state.userMarker.setLatLng([next.lat,next.lon]);
              if(state.radiusCircle)state.radiusCircle.setLatLng([next.lat,next.lon]);
            }
          },()=>{},{enableHighAccuracy:true,maximumAge:8000,timeout:15000});
        }
      }catch{}
      return out;
    };
    const originalHide=window.dzMapToggle395.hideMap;
    window.dzMapToggle395.hideMap=function(){stopWatch();return originalHide?.();};
  }
  // If an older nearby module already created a hidden Leaflet map in background, release it.
  try{
    const host=document.querySelector('#dz393NearbyMap');
    if(host?.classList.contains('hidden')&&state?.map){state.map.remove();state.map=null;state.userMarker=null;state.radiusCircle=null;state.walkLine=null;state.walkArrow=null;state.stopLayers=[];}
  }catch{}
  window.dzNearbyMemory398={version:'3.9.8',stopWatch};
})();
