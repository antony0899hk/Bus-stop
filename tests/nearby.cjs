const fs=require('fs'),vm=require('vm'),assert=require('node:assert/strict');
const nodes=new Map();const node=s=>{if(!nodes.has(s))nodes.set(s,{classList:{add(){},remove(){},toggle(){}},appendChild(){},replaceChildren(){},textContent:'',innerHTML:'',disabled:false});return nodes.get(s)};
const callbacks={};const ctx={console,setTimeout,clearTimeout,AbortController,Map,Number,Date,Infinity,encodeURIComponent,state:{nearby:[],nearbyFilter:'all'},renderNearby(){},escapeHtml:String,operatorBadge:String,etaLabel:()=>'',validFutureEta:x=>!!x,distanceMeters:()=>20,KMB_API:'kmb',navigator:{geolocation:{getCurrentPosition(p,e){callbacks.position=p}}},document:{querySelector:node,querySelectorAll:()=>[],createElement:()=>node('controls')},window:{DZ_BUILD:'test',addEventListener(){}},fetch:async()=>({ok:true,json:async()=>({data:Array.from({length:50},(_,i)=>({stop:String(i),lat:22,long:114,name_tc:'s'+i}))})})};
vm.createContext(ctx);vm.runInContext(fs.readFileSync(require('node:path').join(__dirname,'../nearby.js'),'utf8'),ctx);
(async()=>{
const rows=new Map();ctx.window.dzNearby.mergeRows({operator:'KMB',stopId:'a',distance:10},Array.from({length:60},(_,i)=>({route:String(i),dir:'O',eta:null})),rows);assert.equal(rows.size,60);
ctx.window.dzNearby.mergeRows({operator:'KMB',distance:50},[{route:'0',dir:'O',eta:'2099-01-01'}],rows);assert.equal(rows.size,60);assert.equal(rows.get('KMB|0|O||1').eta,'2099-01-01');
const r=await ctx.window.dzNearby.findStops({lat:22,lon:114},100,0);assert.equal(r.found.length,100);assert.equal(r.sources,2);
ctx.window.dzNearby.search(400);const old=callbacks.position;ctx.window.dzNearby.search(100);old({coords:{latitude:22,longitude:114}});assert.equal(ctx.state.nearby.length,0);assert.equal(node('#nearbyStatus').textContent,'正在取得位置…');
ctx.window.dzNearby.cancel();const cancelled=await ctx.window.dzNearby.findStops({lat:22,lon:114},100,0);assert.equal(cancelled.found.length,0);
console.log('Passed: 60 routes including no ETA; 100 stops without truncation; route deduplication; stale GPS ignored; cancelled scan ignored.');
})().catch(e=>{console.error(e);process.exitCode=1});
