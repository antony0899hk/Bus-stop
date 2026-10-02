const fs=require('fs'),vm=require('vm'),assert=require('node:assert/strict'),path=require('node:path');

const kmbStops=new Map([
  ['A',{name_tc:'起點站',lat:22.3000,long:114.1000}],
  ['B',{name_tc:'中途站',lat:22.3010,long:114.1010}],
  ['C',{name_tc:'目的地站',lat:22.3020,long:114.1020}]
]);
const ctbStops=new Map([['D',{name_tc:'另一目的地站',lat:22.3021,long:114.1021}]]);
const document={readyState:'loading',addEventListener(){},querySelector(){return null},querySelectorAll(){return []}};
const window={};
const ctx={console,window,document,state:{kmbStops,ctbStops,kmbRoutes:[],ctbRoutes:[]},
  ensureStopCatalog:async()=>{},distanceMeters(a,b,c,d){return Math.hypot((c-a)*111000,(d-b)*102000)},
  setTimeout,clearTimeout,Date,Math,Number,String,Promise};
vm.createContext(ctx);
vm.runInContext(fs.readFileSync(path.join(__dirname,'../journey-v5.5.js'),'utf8'),ctx);

(async()=>{
  const api=window.dzJourney;
  const named=await api.resolvePlace('目的地站');
  assert.equal(named[0].id,'C');
  const nearby=await api.resolvePlace('',{lat:22.3000,lon:114.1000});
  assert.equal(nearby[0].id,'A');
  const hit=api.destinationHit(
    [{operator:'KMB',id:'A',lat:22.3,lon:114.1},{operator:'KMB',id:'B',lat:22.301,lon:114.101},{operator:'KMB',id:'C',lat:22.302,lon:114.102}],
    0,named,{lat:22.302,lon:114.102}
  );
  assert.equal(hit.stop.id,'C');
  assert.equal(hit.index,2);
  assert(api.score({journeyMinutes:10,walkMeters:100,transferCount:0})<api.score({journeyMinutes:20,walkMeters:0,transferCount:0}));
  console.log('Passed: point-to-point V1 resolves places, expands only forward stops, and ranks direct journeys.');
})().catch(error=>{console.error(error);process.exitCode=1;});
