import { readFile, writeFile, mkdir } from "node:fs/promises";

const BUILD_DIR = "runtime";
const GMB_CELL = 0.01;
const GROUND_CELL = 0.005;
const MTR_ROUTES_URL = "https://opendata.mtr.com.hk/data/mtr_bus_routes.csv";
const MTR_STOPS_URL = "https://opendata.mtr.com.hk/data/mtr_bus_stops.csv";
const MTR_FARES_URL = "https://opendata.mtr.com.hk/data/mtr_bus_fares.csv";
const KMB_ROUTE_STOPS_URL = "https://data.etabus.gov.hk/v1/transport/kmb/route-stop";
const CTB_ROUTE_GRAPH_URLS = [
  "https://data.hkbus.app/routeFareList.min.json",
  "https://hkbus.github.io/hk-bus-crawling/routeFareList.min.json"
];

const MTR_REGIONS = {
  "tai-po": new Set(["K12","K14","K17","K18"]),
  "yuen-long-tin-shui-wai": new Set(["K65","K65A","K66","K68","K73","K74","K75A","K75P","K75S","K76","K76S"]),
  "tuen-mun": new Set(["506","K51","K51A","K52","K52A","K52P","K53","K53S","K54","K54A","K58"])
};

function parseCsv(text) {
  const rows=[]; let row=[],cell="",quoted=false;
  for(let i=0;i<text.length;i++){
    const ch=text[i];
    if(ch==='"'){
      if(quoted&&text[i+1]==='"'){cell+='"';i++;} else quoted=!quoted;
    }else if(ch===','&&!quoted){row.push(cell);cell="";}
    else if((ch==='\n'||ch==='\r')&&!quoted){if(ch==='\r'&&text[i+1]==='\n')i++;row.push(cell);cell="";if(row.some(v=>String(v).trim()))rows.push(row);row=[];}
    else cell+=ch;
  }
  if(cell||row.length){row.push(cell);if(row.some(v=>String(v).trim()))rows.push(row);}
  return rows;
}

async function fetchText(url){
  const r=await fetch(url,{headers:{Accept:"text/csv,*/*"}});
  if(!r.ok)throw new Error(`${r.status} ${url}`);
  return await r.text();
}

async function fetchJson(url){
  const r=await fetch(url,{headers:{Accept:"application/json"}});
  if(!r.ok)throw new Error(`${r.status} ${url}`);
  return await r.json();
}

function addRouteRef(refs,operator,stop,route,bound,serviceType="1",seq=null,total=null){
  if(!stop||!route||!bound)return;
  const key=`${operator}|${stop}`,item={route:String(route),bound:String(bound).toUpperCase(),serviceType:String(serviceType||"1"),seq:Number(seq)||null,total:Number(total)||null};
  if(!refs.has(key))refs.set(key,new Map());refs.get(key).set([item.route,item.bound,item.serviceType].join("|"),item);
}

async function buildGroundRouteRefs(){
  const refs=new Map(),failures=[];
  try{
    const j=await fetchJson(KMB_ROUTE_STOPS_URL);
    const groups=new Map();for(const row of j.data||[]){const key=[row.route,row.bound,row.service_type||"1"].join("|");if(!groups.has(key))groups.set(key,[]);groups.get(key).push(row);}
    for(const rows of groups.values()){rows.sort((a,b)=>Number(a.seq)-Number(b.seq));for(const row of rows)addRouteRef(refs,"KMB",String(row.stop||""),row.route,row.bound,row.service_type,row.seq,rows.length);}
  }catch(error){failures.push(`KMB: ${error.message}`);}
  let ctbLoaded=false,lastCtbError=null;
  for(const url of CTB_ROUTE_GRAPH_URLS){
    try{
      const db=await fetchJson(url);
      for(const entry of Object.values(db?.routeList||{})){
        const companies=Array.isArray(entry?.co)?entry.co.map(x=>String(x).toLowerCase()):[];if(!companies.includes("ctb"))continue;
        const route=String(entry?.route||""),bound=String(entry?.bound?.ctb||"").toUpperCase(),stops=entry?.stops?.ctb;if(!route||!["O","I"].includes(bound)||!Array.isArray(stops))continue;
        stops.forEach((stop,index)=>addRouteRef(refs,"CTB",String(stop||""),route,bound,entry?.serviceType||"1",index+1,stops.length));
      }
      ctbLoaded=true;break;
    }catch(error){lastCtbError=error;}
  }
  if(!ctbLoaded)failures.push(`CTB: ${lastCtbError?.message||"route graph unavailable"}`);
  if(failures.length)console.warn(`Ground route references incomplete (${failures.join("; ")}).`);
  return refs;
}

function mtrRegion(route){
  route=String(route||"").trim().toUpperCase();
  for(const [name,set] of Object.entries(MTR_REGIONS))if(set.has(route))return name;
  return null;
}

async function buildMtrBus(){
  await mkdir(`${BUILD_DIR}/mtr-bus`,{recursive:true});
  const [routesText,stopsText,faresText]=await Promise.all([fetchText(MTR_ROUTES_URL),fetchText(MTR_STOPS_URL),fetchText(MTR_FARES_URL)]);
  const routeRows=parseCsv(routesText).slice(1);
  const stopRows=parseCsv(stopsText).slice(1);
  const fareRows=parseCsv(faresText).slice(1);
  const fareMap=new Map(fareRows.map(r=>[String(r[0]||"").trim().toUpperCase(),Number(r[1])]));
  const routeMeta=new Map();
  for(const r of routeRows){
    const route=String(r[0]||"").trim().toUpperCase(); if(!route)continue;
    routeMeta.set(route,{route,desc_tc:String(r[1]||""),desc_en:String(r[2]||""),fare:Number.isFinite(fareMap.get(route))?fareMap.get(route):null});
  }
  const grouped=new Map();
  for(const r of stopRows){
    const route=String(r[0]||"").trim().toUpperCase(),bound=String(r[1]||"").trim().toUpperCase();
    const seq=Number(r[2]),id=String(r[3]||"").trim(),lat=Number(r[4]),lon=Number(r[5]);
    if(!route||!bound||!id||!Number.isFinite(lat)||!Number.isFinite(lon))continue;
    const key=`${route}|${bound}`;
    if(!grouped.has(key))grouped.set(key,[]);
    grouped.get(key).push({id,seq:Number.isFinite(seq)?seq:999,name_tc:String(r[6]||id),name_en:String(r[7]||""),lat,long:lon});
  }
  for(const list of grouped.values())list.sort((a,b)=>a.seq-b.seq);
  const index=[];
  for(const [region,set] of Object.entries(MTR_REGIONS)){
    const routes=[];
    for(const route of set){
      const dirs=[];
      for(const bound of ["O","I","U","D"]){const list=grouped.get(`${route}|${bound}`);if(list?.length)dirs.push({bound,stops:list});}
      if(!dirs.length)continue;
      const meta=routeMeta.get(route)||{route,desc_tc:"",desc_en:"",fare:null};
      const first=dirs[0].stops[0],last=dirs[0].stops.at(-1);
      const item={route,region,orig:first?.name_tc||"",dest:last?.name_tc||"",fare:meta.fare,desc_tc:meta.desc_tc,directions:dirs};
      routes.push(item); index.push({route,region,orig:item.orig,dest:item.dest,fare:item.fare});
    }
    await writeFile(`${BUILD_DIR}/mtr-bus/${region}.json`,JSON.stringify({generated:new Date().toISOString(),region,routes}));
  }
  index.sort((a,b)=>a.route.localeCompare(b.route,undefined,{numeric:true}));
  await writeFile(`${BUILD_DIR}/mtr-bus/index.json`,JSON.stringify({generated:new Date().toISOString(),routes:index}));
  console.log(`Built MTR Bus bundles: ${index.length} routes.`);
}

async function buildGmbTiles(){
  await mkdir(`${BUILD_DIR}/gmb`,{recursive:true});
  const all=[];
  for(let i=0;i<16;i++){
    try{const j=JSON.parse(await readFile(`gmb-stops-${i}.json`,"utf8"));all.push(...(j.data||[]));}catch{}
  }
  const tiles=new Map();
  for(const s of all){
    const lat=Number(s.lat??s.latitude),lon=Number(s.long??s.lng??s.longitude);if(!Number.isFinite(lat)||!Number.isFinite(lon))continue;
    const y=Math.floor(lat/GMB_CELL),x=Math.floor(lon/GMB_CELL),key=`${y}-${x}`;
    if(!tiles.has(key))tiles.set(key,[]);tiles.get(key).push(s);
  }
  await Promise.all([...tiles].map(([key,data])=>writeFile(`${BUILD_DIR}/gmb/tile-${key}.json`,JSON.stringify({cell:GMB_CELL,data}))));
  const routes=[];
  for(let i=0;i<8;i++){
    try{const j=JSON.parse(await readFile(`gmb-routes-${i}.json`,"utf8"));routes.push(...(j.data||[]));}catch{}
  }
  await writeFile(`${BUILD_DIR}/gmb/routes-index.json`,JSON.stringify({generated:new Date().toISOString(),data:routes.map(r=>({operator:"GMB",region:r.region||"",route:r.route,routeId:r.routeId,routeSeq:r.routeSeq,bound:r.bound,serviceType:r.serviceType,orig:r.orig||"",dest:r.dest||""}))}));
  await writeFile(`${BUILD_DIR}/gmb/config.json`,JSON.stringify({cell:GMB_CELL}));
  console.log(`Built ${tiles.size} GMB spatial tiles from ${all.length} stops.`);
}

async function buildGroundTiles(){
  await mkdir(`${BUILD_DIR}/ground`,{recursive:true});
  const tiles=new Map(),routeRefs=await buildGroundRouteRefs();
  for(const [operator,path] of [["KMB","kmb-stops.json"],["CTB","ctb-stops.json"]]){
    const json=JSON.parse(await readFile(path,"utf8"));
    for(const row of json.data||[]){
      const lat=Number(row.lat??row.latitude),lon=Number(row.long??row.lng??row.longitude);
      if(!Number.isFinite(lat)||!Number.isFinite(lon))continue;
      const y=Math.floor(lat/GROUND_CELL),x=Math.floor(lon/GROUND_CELL),key=`${y}-${x}`;
      if(!tiles.has(key))tiles.set(key,[]);
      const id=String(row.stop||row.id),routes=[...(routeRefs.get(`${operator}|${id}`)?.values()||[])];
      tiles.get(key).push({operator,id,name:row.name_tc||"",lat,lon,routes});
    }
  }
  await Promise.all([...tiles].map(([key,data])=>writeFile(`${BUILD_DIR}/ground/tile-${key}.json`,JSON.stringify({cell:GROUND_CELL,data}))));
  await writeFile(`${BUILD_DIR}/ground/config.json`,JSON.stringify({generated:new Date().toISOString(),cell:GROUND_CELL,tileCount:tiles.size,routeRefStops:routeRefs.size}));
  console.log(`Built ${tiles.size} KMB/CTB ground-stop spatial tiles with ${routeRefs.size} stop route-reference sets.`);
}

if(process.argv.includes("--ground-only"))await buildGroundTiles();
else await Promise.all([buildGmbTiles(),buildMtrBus(),buildGroundTiles()]);
