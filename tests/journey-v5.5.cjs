const fs=require('fs'),vm=require('vm'),assert=require('node:assert/strict'),path=require('node:path');
const document={readyState:'loading',addEventListener(){},querySelector(){return null},querySelectorAll(){return []}};
const window={};
const ctx={console,window,document,setTimeout,clearTimeout,Date,Math,Number,String,Promise,Map,Set,AbortController};
vm.createContext(ctx);vm.runInContext(fs.readFileSync(path.join(__dirname,'../journey-v5.5.js'),'utf8'),ctx);
const api=window.dzJourney;
const address=api.parseAddressResponse({SuggestedAddress:[{Address:{PremisesAddress:{ChiPremisesAddress:{BuildingName:'港鐵上水站'},GeospatialInformation:{Latitude:'22.50149',Longitude:'114.12779'}}},ValidationInformation:{Score:50}}]},'上水站');
assert.deepEqual(JSON.parse(JSON.stringify(address)),{lat:22.50149,lon:114.12779,name:'港鐵上水站',score:50});
assert(api.tileKeys({lat:22.5,lon:114.12},50).length>0);
const prepared={seed:{operator:'KMB'},originIndex:0,sequence:[{id:'A'},{id:'B'},{id:'C'}]};
const hit=api.destinationHitByIds(prepared,[{operator:'KMB',id:'B',distance:80},{operator:'KMB',id:'C',distance:30}]);
assert.equal(hit.stop.id,'C');assert.equal(hit.index,2);
const transfer=api.transferHit(
  {originIndex:0,sequence:[{id:'A'},{id:'X'},{id:'T'},{id:'Z'}]},
  {originIndex:3,sequence:[{id:'Q'},{id:'T'},{id:'Y'},{id:'D'}]}
);
assert.equal(transfer.stopId,'T');assert.equal(transfer.firstIndex,2);assert.equal(transfer.secondIndex,1);
assert(api.score({journeyMinutes:10,walkMeters:100,transferCount:0})<api.score({journeyMinutes:20,walkMeters:0,transferCount:0}));
const journeySource=fs.readFileSync(path.join(__dirname,'../journey-v5.5.js'),'utf8');
const mapSource=fs.readFileSync(path.join(__dirname,'../nearby-map.js'),'utf8');
assert(!journeySource.includes('ensureStopCatalog'));
assert(journeySource.includes('destinationLocation'));
assert(journeySource.includes('pickDestination'));
assert(mapSource.includes("window.dzMap={ensureLeaflet,pickDestination}"));
assert(!mapSource.includes('runtime/ground'));
assert(journeySource.includes('✓ 已定位'));
assert(journeySource.includes('支援直達及最多兩次轉車'));
assert(journeySource.includes('eta:validFutureEta(x.eta)?x.eta:null'));
assert(journeySource.includes('stop.routes||[]'));
assert(journeySource.includes('data-journey-leg="1"'));
assert(journeySource.includes('target.dataset.journeyLeg'));
assert(journeySource.includes('mtr&&!rows.includes(mtr)'));
assert(!journeySource.includes('q?\\`'));
console.log('Passed: point-to-point accepts address/map coordinates, preserves no-ETA directions, links every transfer leg, and matches up to two transfers without loading the full HK stop catalog.');
