const fs=require('fs'),vm=require('vm'),assert=require('node:assert/strict'),path=require('node:path');

const lines=[
  'LINE_CODE,DIRECTION,STATION_CODE,STATION_ID,CHINESE_NAME,ENGLISH_NAME,SEQUENCE',
  'EAL,U,AAA,1,甲站,Alpha,1',
  'EAL,U,BBB,2,乙站,Beta,2',
  'EAL,U,CCC,3,丙站,Gamma,3'
].join('\n');
const stations={data:[
  {code:'AAA',lat:0,lon:0},
  {code:'BBB',lat:0,lon:5},
  {code:'CCC',lat:0,lon:10}
]};
const fares='SRC_STATION_ID,DEST_STATION_ID,OCT_ADT_FARE\n1,3,12.3';
const document={readyState:'loading',addEventListener(){},querySelectorAll(){return[]},querySelector(){return null},createElement(){return{}}};
const window={DZ_BUILD:'test'};
const ctx={
  console,window,document,Map,Set,Number,String,Promise,Math,encodeURIComponent,
  state:{nearby:[]},renderNearby(){},renderSearch(){},operatorBadge:()=>'',normalizedRoutes:()=>[],openRoute(){},escapeHtml:String,
  validFutureEta:()=>true,fillEta(){},parallel:async()=>{},allJourneyStops:()=>[],getJSON:async()=>({}),
  distanceMeters:(a,b,c,d)=>Math.abs(Number(b)-Number(d))*1000,
  fetch:async url=>url.includes('mtr_lines_and_stations')?{ok:true,text:async()=>lines}:url.includes('mtr_lines_fares')?{ok:true,text:async()=>fares}:{ok:true,json:async()=>stations}
};
vm.createContext(ctx);
vm.runInContext(fs.readFileSync(path.join(__dirname,'../transit-extra.js'),'utf8'),ctx);

(async()=>{
  const candidate=await window.dzExtraTransit.mtrJourneyCandidate('我的位置','目的地',{lat:0,lon:1.4},{lat:0,lon:8.4});
  assert(candidate,'MTR should remain a candidate when both access legs are beyond the old 550m limit');
  assert.equal(candidate.originStop.id,'AAA');
  assert.equal(candidate.destinationStop.id,'CCC');
  assert.equal(Math.round(candidate.walkMeters),3000);
  assert.equal(candidate.originAccessMeters,1400);
  assert.equal(Math.round(candidate.destinationAccessMeters),1600);
  const tooFar=await window.dzExtraTransit.mtrJourneyCandidate('我的位置','目的地',{lat:0,lon:2.1},{lat:0,lon:7.9});
  assert.equal(tooFar,null);
  console.log('Passed: MTR candidates use the nearest stations within the expanded 2km access range and include access walking time.');
})().catch(error=>{console.error(error);process.exitCode=1;});
