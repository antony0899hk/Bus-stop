const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const code=fs.readFileSync('timetable.js','utf8');
const detail={operator:'KMB',route:'1',bound:'O',serviceType:'1',days:{weekday:{first:'05:35',last:'23:40',periods:[{start:'05:35',end:'23:40',headway:'10-15'}]},saturday:{noService:true},sunday_public_holiday:{noService:true}},source:{url:'https://example.test',effectiveDate:'2026-01-01',lastVerified:'2026-09-20'}};
const detailDb={schemaVersion:1,records:[detail]};
const service={meta:{generated:'2026-09-05T00:00:00Z'},calendars:{287:{d:[1,1,1,1,1,0,0]},288:{d:[0,0,0,0,0,1,0]},384:{d:[0,0,0,0,0,0,0],a:['20261001']},448:{d:[0,0,0,0,0,0,1]}},windows:{'KMB|1|O':{287:[335,1420]},'KMB|270A|O':{287:[330,1380],288:[340,1390],384:[360,1445],448:[350,1500]},'KMB|NIGHT|O':{287:[1380,90]},'KMB|ONLY-I|I':{287:[360,1200]}}};
const store=new Map();
const responses=new Map();
const response=value=>({ok:true,json:async()=>value});
function contextWith(fetchImpl){const warnings=[];const context={window:{},localStorage:{getItem:k=>store.get(k)||null,setItem:(k,v)=>store.set(k,v)},fetch:fetchImpl,escapeHtml:v=>String(v),console:{log:console.log,warn:(...x)=>warnings.push(x)}};vm.createContext(context);vm.runInContext(code,context);context.warnings=warnings;return context;}

(async()=>{
  // Exact operator + route + bound + serviceType wins; same-bound fallback is next.
  let c=contextWith(async()=>{throw Error('unused')});
  const api=c.window.dzTimetable;
  assert.equal(api.detailedMatch([detail],{operator:'KMB',route:'1',bound:'O',serviceType:'1'}).match,'exact');
  assert.equal(api.detailedMatch([{...detail,serviceType:'2'}],{operator:'KMB',route:'1',bound:'O',serviceType:'9'}).match,'bound');

  // A mismatched direction code is accepted only when both endpoint names confirm it.
  const codedWrong={...detail,bound:'I',origin:'上水站',destination:'尖沙咀東'};
  assert.equal(api.detailedMatch([codedWrong],{operator:'KMB',route:'1',bound:'O',serviceType:'9',orig:'上水站',dest:'尖沙咀東'}).match,'endpoints');
  assert.equal(api.detailedMatch([codedWrong],{operator:'KMB',route:'1',bound:'O',serviceType:'9',orig:'尖沙咀東',dest:'上水站'}).record,null);

  // Cross-midnight windows keep their duration and label the next day explicitly.
  const night=api.basicDays({287:[1380,90]},service.calendars);
  assert.equal(night.weekday.first,1380);assert.equal(night.weekday.last,1530);assert.equal(api.formatMinutes(1530),'翌日 01:30');
  const detailedOvernight=api.renderRecord({...detail,days:{...detail.days,weekday:{first:'06:30',last:'00:45',periods:[{start:'19:55',end:'00:45',headway:'15-20'}]}}},false);
  assert.match(detailedOvernight,/尾班 <strong>翌日 00:45/);assert.match(detailedOvernight,/19:55–翌日 00:45/);

  // Detailed data has priority even when a service-window fallback exists.
  responses.set('./data/route-timetables.json',detailDb);responses.set('./service-calendars.json',{generated:service.meta.generated,calendarShards:1,shards:1});responses.set('./service-calendars-0.json',service.calendars);responses.set('./service-windows-0.json',service.windows);
  c=contextWith(async url=>response(responses.get(url)));let target={innerHTML:''};
  await c.window.dzTimetable.render({operator:'KMB',route:'1',bound:'O',serviceType:'1'},target);
  assert.match(target.innerHTML,/詳細官方時間表/);assert.match(target.innerHTML,/10-15 分鐘/);assert.doesNotMatch(target.innerHTML,/班次間隔暫未提供/);

  // Missing detail falls back to service windows without inventing headways.
  responses.set('./data/route-timetables.json',{schemaVersion:1,records:[]});store.clear();c=contextWith(async url=>response(responses.get(url)));target={innerHTML:''};
  await c.window.dzTimetable.render({operator:'KMB',route:'270A',bound:'O',serviceType:'1'},target);
  assert.match(target.innerHTML,/基本服務時間/);assert.match(target.innerHTML,/首班 <strong>05:30/);assert.match(target.innerHTML,/尾班 <strong>翌日 01:00/);assert.match(target.innerHTML,/班次間隔暫未提供/);

  // A wrong bound is not silently swapped and produces a development diagnostic.
  target={innerHTML:''};await c.window.dzTimetable.render({operator:'KMB',route:'ONLY-I',bound:'O',serviceType:'1'},target);
  assert.match(target.innerHTML,/時間表暫未收錄/);assert.match(target.innerHTML,/官方時間表/);assert.equal(c.warnings.length,1);assert.equal([...c.warnings[0][1].basicCandidates].join(','),'KMB|ONLY-I|I');
  console.log('Diagnostic (data exists but did not match):',JSON.stringify(c.warnings[0][1]));

  // Both detailed and service-window refresh failures use their last-good copies.
  store.clear();store.set('daozhan_route_timetables_v1',JSON.stringify(detailDb));store.set('daozhan_service_windows_v1',JSON.stringify(service));
  c=contextWith(async()=>{throw Error('offline')});
  const [cachedDetail,cachedService]=await Promise.all([c.window.dzTimetable.loadDatabase(),c.window.dzTimetable.loadServiceData()]);
  assert.equal(cachedDetail.stale,true);assert.equal(cachedDetail.value.records[0].route,'1');assert.equal(cachedService.stale,true);assert.ok(cachedService.value.windows['KMB|270A|O']);
  console.log('Passed: detailed priority, service-window fallback, serviceType/bound matching, endpoint-confirmed direction, cross-midnight, missing data, diagnostics and last-good cache.');
})().catch(error=>{console.error(error);process.exitCode=1;});
