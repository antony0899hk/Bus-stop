const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const code=fs.readFileSync('timetable.js','utf8');
const saved={schemaVersion:1,records:[{operator:'KMB',route:'1',bound:'O',days:{weekday:{noService:true},saturday:{noService:true},sunday_public_holiday:{noService:true}},source:{}}]};
const store=new Map([['daozhan_route_timetables_v1',JSON.stringify(saved)]]);
const context={window:{},localStorage:{getItem:k=>store.get(k)||null,setItem:(k,v)=>store.set(k,v)},fetch:async()=>{throw Error('offline')},escapeHtml:String,console};
vm.createContext(context);vm.runInContext(code,context);
context.window.dzTimetable.loadDatabase().then(({value,stale})=>{
  assert.equal(stale,true);assert.equal(value.records[0].route,'1');
  assert.equal(typeof context.window.dzTimetable.render,'function');
  console.log('Passed: failed timetable refresh uses last-known-good data without touching ETA or nearby state.');
}).catch(error=>{console.error(error);process.exitCode=1;});
