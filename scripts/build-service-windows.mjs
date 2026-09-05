import fs from "node:fs";
import path from "node:path";

const source=process.argv[2];
const output=process.argv[3]||".";
if(!source)throw new Error("Usage: node scripts/build-service-windows.mjs <unzipped-gtfs-directory> [output]");

function csv(text){
  const rows=[];let row=[],cell="",quoted=false;
  for(let i=0;i<text.length;i++){
    const ch=text[i];
    if(ch==='"'){if(quoted&&text[i+1]==='"'){cell+='"';i++;}else quoted=!quoted;}
    else if(ch===','&&!quoted){row.push(cell);cell="";}
    else if((ch==='\n'||ch==='\r')&&!quoted){if(ch==='\r'&&text[i+1]==='\n')i++;row.push(cell);cell="";if(row.some(Boolean))rows.push(row);row=[];}
    else cell+=ch;
  }
  if(cell||row.length){row.push(cell);rows.push(row);}return rows;
}
function table(name){const rows=csv(fs.readFileSync(path.join(source,name),"utf8"));const head=rows.shift();return rows.map(r=>Object.fromEntries(head.map((h,i)=>[h,r[i]||""])));}
function mins(t){const m=String(t||"").match(/^(\d+):(\d+)/);return m?Number(m[1])*60+Number(m[2]):null;}

const routes=new Map(table("routes.txt").map(r=>[r.route_id,r]));
const calendars={};
for(const c of table("calendar.txt"))calendars[c.service_id]={d:[c.monday,c.tuesday,c.wednesday,c.thursday,c.friday,c.saturday,c.sunday].map(Number),a:[],r:[]};
for(const x of table("calendar_dates.txt")){
  if(!calendars[x.service_id])calendars[x.service_id]={d:[0,0,0,0,0,0,0],a:[],r:[]};
  (x.exception_type==="1"?calendars[x.service_id].a:calendars[x.service_id].r).push(x.date);
}
const frequency=new Map();
for(const f of table("frequencies.txt")){
  const a=mins(f.start_time),b=mins(f.end_time);if(a==null||b==null)continue;
  const old=frequency.get(f.trip_id)||[a,b];old[0]=Math.min(old[0],a);old[1]=Math.max(old[1],b);frequency.set(f.trip_id,old);
}
const windows={};
for(const t of table("trips.txt")){
  const route=routes.get(t.route_id);if(!route)continue;
  const parts=t.trip_id.split("-");const direction=parts[1]==="2"?"I":"O";
  const suffix=parts.at(-1);const exact=/^\d{4}$/.test(suffix)?Number(suffix.slice(0,2))*60+Number(suffix.slice(2)):null;
  const range=frequency.get(t.trip_id)||[exact,exact];if(range[0]==null)continue;
  const agencies=route.agency_id.split("+").map(x=>x.toUpperCase()==="GMB"?"GMB":x.toUpperCase()==="CTB"?"CTB":x.toUpperCase()==="NLB"?"NLB":x.toUpperCase()==="KMB"?"KMB":x.toUpperCase()).filter(x=>["KMB","CTB","GMB","NLB"].includes(x));
  for(const agency of agencies){
    const key=`${agency}|${route.route_short_name}|${direction}`;
    if(!windows[key])windows[key]={};const old=windows[key][t.service_id]||[range[0],range[1]];
    old[0]=Math.min(old[0],range[0]);old[1]=Math.max(old[1],range[1]);windows[key][t.service_id]=old;
  }
}
fs.mkdirSync(output,{recursive:true});
const shardCount=12,calendarShardCount=4,shards=Array.from({length:shardCount},()=>({})),calendarShards=Array.from({length:calendarShardCount},()=>({}));
for(const [key,value] of Object.entries(windows)){let h=0;for(const ch of key)h=(h*31+ch.charCodeAt(0))>>>0;shards[h%shardCount][key]=value;}
for(const [key,value] of Object.entries(calendars))calendarShards[Number(key)%calendarShardCount][key]=value;
fs.writeFileSync(path.join(output,"service-calendars.json"),JSON.stringify({generated:new Date().toISOString(),calendarShards:calendarShardCount,shards:shardCount}));
calendarShards.forEach((values,i)=>fs.writeFileSync(path.join(output,`service-calendars-${i}.json`),JSON.stringify(values)));
shards.forEach((routes,i)=>fs.writeFileSync(path.join(output,`service-windows-${i}.json`),JSON.stringify(routes)));
