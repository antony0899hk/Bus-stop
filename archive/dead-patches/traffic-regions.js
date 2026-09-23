(() => {
  "use strict";
  const REGIONS=["香港島","九龍","新界"];
  const ISLAND=/香港島|中環|金鐘|灣仔|銅鑼灣|北角|鰂魚涌|太古|筲箕灣|柴灣|香港仔|黃竹坑|薄扶林|西環|堅尼地城|跑馬地|山頂/;
  const KOWLOON=/九龍|尖沙咀|佐敦|油麻地|旺角|深水埗|長沙灣|荔枝角|九龍城|土瓜灣|紅磡|黃大仙|鑽石山|彩虹|觀塘|藍田|油塘|啟德/;
  function region(w){const s=`${w.location||""} ${w.heading||""} ${w.detail||""} ${w.content||""}`;if(ISLAND.test(s))return"香港島";if(KOWLOON.test(s))return"九龍";return"新界";}
  function severity(w){const s=`${w.heading||""}${w.detail||""}${w.content||""}`;if(/全線封閉|封閉|暫停/.test(s))return 0;if(/嚴重|意外|事故|火警|水浸|塌/.test(s))return 1;if(/受阻|改道/.test(s))return 2;if(/擠塞|交通繁忙/.test(s))return 3;return 4;}
  function safe(v){return typeof escapeHtml==="function"?escapeHtml(v):String(v??"");}
  function render(){
    if(typeof state==="undefined"||!Array.isArray(state.warnings)||state.warnings.length<2)return false;
    const host=document.querySelector("#traffic-warning"),text=document.querySelector("#warning-text"),meta=document.querySelector("#warning-meta");if(!host||!text)return false;
    const groups=new Map(REGIONS.map(r=>[r,[]]));state.warnings.forEach(w=>groups.get(region(w)).push(w));groups.forEach(a=>a.sort((x,y)=>severity(x)-severity(y)||new Date(y.updated||0)-new Date(x.updated||0)));
    text.innerHTML=REGIONS.map(r=>{const a=groups.get(r);if(!a.length)return"";return `<section class="traffic-region"><div class="traffic-region-head"><strong>${r}</strong><span>${a.length} 宗</span></div><div class="traffic-region-scroll">${a.map((w,i)=>`<article class="traffic-incident"><div class="traffic-index">${i+1}/${a.length}</div><strong>${safe(w.location||w.heading||"交通消息")}${w.direction?`｜${safe(w.direction)}方向`:""}</strong>${w.detail?`<div>${safe(w.detail)}</div>`:""}${w.content?`<div>${safe(w.content)}</div>`:""}<small>運輸署發布：${typeof formatTime==="function"?formatTime(w.first):"—"}　更新：${typeof formatTime==="function"?formatTime(w.updated):"—"}</small></article>`).join("")}</div></section>`;}).join("");
    if(meta)meta.innerHTML='<div>按區域查看；同區多宗事故可左右滑動看下一宗。</div><div>排序：封路／嚴重事故 → 受阻／改道 → 擠塞，再按最新更新。</div>';
    host.classList.remove("hidden");return true;
  }
  let tries=0;const timer=setInterval(()=>{tries++;if(render()||tries>20)clearInterval(timer);},600);
})();
