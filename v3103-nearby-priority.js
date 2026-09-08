(() => {
  "use strict";
  const $=(s,r=document)=>r.querySelector(s);
  const $$=(s,r=document)=>[...r.querySelectorAll(s)];
  let token=0;

  async function prepareMtr(){
    try{
      const p=window.dzExtraTransit?.ensureMtrData?.();
      if(p) await Promise.race([p,new Promise(r=>setTimeout(r,1800))]);
    }catch{}
  }

  async function run(radius){
    const my=++token;
    const r=Number(radius)||100;
    $$('[data-dz3103-radius]').forEach(b=>b.classList.toggle('active',Number(b.dataset.dz3103Radius)===r));
    const status=$('#nearbyStatus');
    if(status)status.textContent='先準備 MTR／巴士資料…';
    await prepareMtr();
    if(my!==token)return;
    if(status)status.textContent='MTR 已準備，載入巴士；小巴稍後補上…';
    await window.dzNearby393?.runNearby?.(r);
  }

  function install(){
    // v393 registered a document-level capture handler for #locateBtn and
    // [data-dz-radius]. Rename those hooks so only this staged controller fires.
    const locate=$('#locateBtn');
    if(locate){
      locate.id='dz3103LocateBtn';
      locate.addEventListener('click',e=>{e.preventDefault();run(window.dzNearbyMapState?.radius||100);});
    }
    $$('[data-dz-radius]').forEach(b=>{
      b.dataset.dz3103Radius=b.dataset.dzRadius;
      b.removeAttribute('data-dz-radius');
      b.addEventListener('click',e=>{e.preventDefault();run(Number(b.dataset.dz3103Radius));});
    });
  }

  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',install,{once:true});else install();
  window.dzNearbyPriority3103={version:'3.10.3',run,prepareMtr};
})();