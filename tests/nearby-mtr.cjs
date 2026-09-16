const fs=require('fs'),vm=require('vm'),assert=require('node:assert/strict');
const nodes=new Map();const node=s=>{if(!nodes.has(s))nodes.set(s,{classList:{add(){},remove(){},toggle(){}},appendChild(){},replaceChildren(){},textContent:'',innerHTML:'',disabled:false});return nodes.get(s)};
const filters=['all','KMB','CTB','GMB','NLB','MTR','MTRB'].map(f=>({dataset:{nearFilter:f},hidden:false}));
let requests=[],fail=false;
const directions=['O','I'].map(bound=>({bound,stops:[{id:bound,lat:22,long:114,name_tc:bound}]}));
const bundle={routes:Array.from({length:10},(_,i)=>({route:'K'+i,directions}))};
const ctx={console,setTimeout,clearTimeout,AbortController,Map,Number,Date,Infinity,encodeURIComponent,state:{nearby:[],nearbyFilter:'all'},renderNearby(){},escapeHtml:String,operatorBadge:String,etaLabel:()=>'',validFutureEta:x=>!!x,distanceMeters:()=>20,KMB_API:'kmb',navigator:{},document:{querySelector:node,querySelectorAll:s=>s==='[data-near-filter]'?filters:[],createElement:()=>node('controls')},window:{DZ_BUILD:'test',addEventListener(){}},fetch:async url=>{requests.push(url);if(fail)throw Error('network');return {ok:true,json:async()=>url.includes('mtr-stations')?{data:[{code:'SHS',name_tc:'上水',lines:['EAL'],lat:22,lon:114}]}:bundle}}};
vm.createContext(ctx);vm.runInContext(fs.readFileSync(require('node:path').join(__dirname,'../nearby.js'),'utf8'),ctx);
(async()=>{
assert.equal(filters.find(f=>f.dataset.nearFilter==='GMB').hidden,true);assert.equal(filters.find(f=>f.dataset.nearFilter==='NLB').hidden,true);assert.equal(filters.find(f=>f.dataset.nearFilter==='MTR').hidden,false);assert.equal(filters.find(f=>f.dataset.nearFilter==='MTRB').hidden,false);
const rows=new Map();const result=await ctx.window.dzNearby.addMtr({lat:22,lon:114},400,0,rows);assert.equal(rows.size,21);assert.equal(result.stops.length,20);assert.equal(rows.get('MTR|SHS').dest,'東鐵綫');assert.equal(rows.get('MTRB|K0|I').dest,'I');assert.equal(requests.filter(u=>u.includes('getSchedule')).length,0);
ctx.window.dzNearby.cancel();ctx.state.nearby=[{key:'new'}];const stale=await ctx.window.dzNearby.addMtr({lat:22,lon:114},100,0,new Map());assert.equal(stale.stops.length,0);assert.equal(ctx.state.nearby[0].key,'new');
fail=true;const failed=await ctx.window.dzNearby.addMtr({lat:22,lon:114},100,1,new Map());assert.equal(failed.failures.length,4);
console.log('Passed: East Rail, 20 MTR bus route directions, no automatic train ETA, GMB/NLB excluded, stale results ignored, source failures isolated.');
})().catch(e=>{console.error(e);process.exitCode=1});
