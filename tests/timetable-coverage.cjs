const assert=require('node:assert/strict'),fs=require('node:fs');
const read=name=>JSON.parse(fs.readFileSync(name,'utf8'));
const meta=read('service-calendars.json'),windows=Object.assign({},...Array.from({length:meta.shards},(_,i)=>read(`service-windows-${i}.json`)));
const kmb=read('kmb-routes.json').data.map(r=>({operator:'KMB',route:String(r.route).toUpperCase(),bound:String(r.bound).toUpperCase(),serviceType:String(r.service_type||1)}));
const ctb=read('ctb-routes.json').data.flatMap(r=>['O','I'].map(bound=>({operator:'CTB',route:String(r.route).toUpperCase(),bound,serviceType:'1'})));
const keys=Object.keys(windows),keySet=new Set(keys),byRoute=new Map();
for(const key of keys){const[operator,route]=key.split('|'),routeKey=`${operator}|${route}`;if(!byRoute.has(routeKey))byRoute.set(routeKey,[]);byRoute.get(routeKey).push(key);}
const failed=[];
for(const r of [...kmb,...ctb]){const exact=`${r.operator}|${r.route}|${r.bound}`;if(!keySet.has(exact)&&byRoute.has(`${r.operator}|${r.route}`))failed.push({...r,available:byRoute.get(`${r.operator}|${r.route}`)});}
const kmbKeys=keys.filter(k=>k.startsWith('KMB|')),ctbKeys=keys.filter(k=>k.startsWith('CTB|'));
assert.ok(kmbKeys.length>=1072);assert.ok(ctbKeys.length>=592);
console.log(`Coverage: KMB ${new Set(kmbKeys.map(k=>k.split('|')[1])).size} routes / ${kmbKeys.length} directions; CTB ${new Set(ctbKeys.map(k=>k.split('|')[1])).size} routes / ${ctbKeys.length} directions.`);
console.log(`Data exists but exact bound did not match (${failed.length} catalog directions; first 20):`);
for(const item of failed.slice(0,20))console.log(`- ${item.operator} ${item.route} ${item.bound} serviceType ${item.serviceType}; available: ${item.available.join(', ')}`);
