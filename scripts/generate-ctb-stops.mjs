import { writeFile } from 'node:fs/promises';

// HK Bus Crawling refreshes this normalized cache daily from official feeds.
// It avoids thousands of Citybus per-stop API calls and their rate limit.
const SOURCE='https://data.hkbus.app/routeFareList.min.json';
const source=await fetch(SOURCE).then(r=>{if(!r.ok)throw Error(r.status);return r.json();});
const byOfficial=new Map();
for(const [canonical,mappings] of Object.entries(source.stopMap||{})){
  const info=source.stopList?.[canonical];
  if(!info)continue;
  for(const [company,official] of mappings){
    if(company!=='ctb'||byOfficial.has(official))continue;
    byOfficial.set(official,{
      stop:official,
      name_tc:info.name?.zh||'',
      name_en:info.name?.en||'',
      lat:String(info.location?.lat??''),
      long:String(info.location?.lng??'')
    });
  }
}
const data=[...byOfficial.values()].sort((a,b)=>a.stop.localeCompare(b.stop));
await writeFile(new URL('../ctb-stops.json',import.meta.url),JSON.stringify({generated:new Date().toISOString(),source:SOURCE,data}));
const routeMap=new Map();
for(const r of Object.values(source.routeList||{})){
  if(!r.co?.includes('ctb'))continue;
  const candidate={route:r.route,orig_tc:r.orig?.zh||'',dest_tc:r.dest?.zh||''};
  if(!routeMap.has(r.route)||r.bound?.ctb==='O')routeMap.set(r.route,candidate);
}
const routes=[...routeMap.values()].sort((a,b)=>a.route.localeCompare(b.route,undefined,{numeric:true}));
await writeFile(new URL('../ctb-routes.json',import.meta.url),JSON.stringify({generated:new Date().toISOString(),source:SOURCE,data:routes}));
console.log(`Wrote ${data.length} Citybus stops and ${routes.length} routes`);
