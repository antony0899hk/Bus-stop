(() => {
  "use strict";
  const $=s=>document.querySelector(s);
  let arranging=false;

  function etaWait(eta,def=9){
    try{return eta&&typeof etaMinutes==="function"?Math.max(0,etaMinutes(eta)):def}catch{return def}
  }
  function explicitMinutes(r){
    for(const v of [r?._dzTotal,r?._dzEastRailTotal,r?._dzMtrTotal,r?._dzJourneyTotal,r?.totalMinutes,r?.estimatedMinutes]){
      const n=Number(v);if(Number.isFinite(n)&&n>=0)return n;
    }
    if(r?.kind==="transfer"){
      const firstWait=etaWait(r.firstEta||r.eta,8), secondWait=r.secondEta?etaWait(r.secondEta,6):6;
      const ride=(Number(r.first?.stopCount||0)+Number(r.second?.stopCount||0))*1.7;
      return firstWait+secondWait+ride+Number(r.walkMeters||0)/80;
    }
    if(r?.kind==="direct") return etaWait(r.eta,12)+Number(r.stopCount||0)*1.7+Number(r.walkMeters||0)/80;
    return null;
  }
  function score(r){
    if(typeof journeyState!=="undefined"&&journeyState.mode==="fastest"){
      const n=explicitMinutes(r);if(Number.isFinite(n))return n;
    }
    try{return typeof window.dz386OldScore==="function"?window.dz386OldScore(r):99999}catch{return 99999}
  }

  if(typeof journeyScore==="function"){
    window.dz386OldScore=journeyScore;
    journeyScore=score;
  }

  function cardMinutes(card){
    const eta=card.querySelector(".journey-eta")?.textContent||"";
    let m=eta.match(/(?:約\s*)?(\d+)\s*分/);
    if(m)return Number(m[1]);
    m=(card.textContent||"").match(/(?:約\s*)?(\d+)\s*分(?:鐘)?/);
    return m?Number(m[1]):9999;
  }
  function arrangeCards(){
    if(arranging)return;const box=$("#journeyResults");if(!box)return;
    const cards=[...box.children].filter(x=>x.classList?.contains("journey-card"));if(cards.length<2)return;
    if(typeof journeyState!=="undefined"&&journeyState.mode!=="fastest")return;
    arranging=true;
    const sorted=cards.map((card,i)=>({card,i,min:cardMinutes(card)})).sort((a,b)=>a.min-b.min||a.i-b.i);
    for(const x of sorted)box.appendChild(x.card);
    [...box.querySelectorAll(":scope > .journey-card")].forEach((card,i)=>{const rank=card.querySelector(".journey-rank");if(rank&&!/[🚇◎]/.test(rank.textContent||""))rank.textContent=String(i+1);card.dataset.dz386Index=String(i);card.setAttribute("role","button");card.setAttribute("tabindex","0");card.setAttribute("aria-label",`查看路線方案 ${i+1} 詳情`);});
    arranging=false;
  }
  function scheduleArrange(){requestAnimationFrame(()=>requestAnimationFrame(arrangeCards));}

  function cleanText(el){return (el?.textContent||"").replace(/\s+/g," ").trim();}
  function openDetails(card){
    $(".dz386-detail-backdrop")?.remove();
    const route=cleanText(card.querySelector(".journey-route"))||cleanText(card.querySelector(".journey-lines"))||cleanText(card.querySelector(".journey-top > div:first-child"))||"路線方案";
    const title=cleanText(card.querySelector(".journey-title"));
    const meta=cleanText(card.querySelector(".journey-meta"));
    const note=cleanText(card.querySelector(".journey-note"));
    const eta=cleanText(card.querySelector(".journey-eta"));
    const wrap=document.createElement("div");wrap.className="dz386-detail-backdrop";
    wrap.innerHTML=`<section class="dz386-detail-sheet" role="dialog" aria-modal="true"><div class="dz386-handle"></div><button class="dz386-close" type="button" aria-label="關閉">×</button><div class="dz386-kicker">路線詳情</div><h3>${typeof escapeHtml==="function"?escapeHtml(route):route}</h3>${eta?`<div class="dz386-time">${typeof escapeHtml==="function"?escapeHtml(eta):eta}</div>`:""}${title?`<div class="dz386-title">${typeof escapeHtml==="function"?escapeHtml(title):title}</div>`:""}${meta?`<div class="dz386-meta">${typeof escapeHtml==="function"?escapeHtml(meta):meta}</div>`:""}${note?`<div class="dz386-note">${typeof escapeHtml==="function"?escapeHtml(note):note}</div>`:""}<div class="dz386-tip">可撳其他方案逐個比較；最快模式會按總預計時間重新排序。</div></section>`;
    document.body.appendChild(wrap);
    const close=()=>wrap.remove();wrap.addEventListener("click",e=>{if(e.target===wrap||e.target.closest(".dz386-close"))close();});
  }

  document.addEventListener("click",e=>{
    const card=e.target.closest?.("#journeyResults .journey-card");if(!card)return;
    if(e.target.closest("button,a,input,select,textarea"))return;
    e.preventDefault();openDetails(card);
  });
  document.addEventListener("keydown",e=>{
    const card=e.target.closest?.("#journeyResults .journey-card");if(card&&(e.key==="Enter"||e.key===" ")){e.preventDefault();openDetails(card);}if(e.key==="Escape")$(".dz386-detail-backdrop")?.remove();
  });

  const box=$("#journeyResults");if(box){new MutationObserver(()=>scheduleArrange()).observe(box,{childList:true,subtree:true,characterData:true});scheduleArrange();}
  if(typeof renderJourneyResults==="function"){
    const oldRender=renderJourneyResults;
    renderJourneyResults=function(){const out=oldRender.apply(this,arguments);scheduleArrange();return out;};
  }
  window.dzRanking386={version:"3.8.6",explicitMinutes,arrangeCards};
})();