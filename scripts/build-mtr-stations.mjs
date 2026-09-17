import {mkdir,writeFile,readFile} from 'node:fs/promises';
const linesURL='https://opendata.mtr.com.hk/data/mtr_lines_and_stations.csv';
const venuesURL='https://mapapi.hkmapservice.gov.hk/ogc/wfs/indoor/mtr_venue_polygon?service=WFS&version=1.1.0&request=GetFeature&outputFormat=application%2Fjson&srsName=EPSG:4326';
async function fetchOK(url){const r=await fetch(url,{signal:AbortSignal.timeout(45000)});if(!r.ok)throw Error(`${r.status} ${url}`);return r;}
function csv(text){const rows=[];let row=[],s='',quoted=false;for(let i=0;i<text.length;i++){const c=text[i];if(c==='"'){if(quoted&&text[i+1]==='"'){s+='"';i++;}else quoted=!quoted;}else if(c===','&&!quoted){row.push(s);s='';}else if((c==='\n'||c==='\r')&&!quoted){if(c==='\r'&&text[i+1]==='\n')i++;row.push(s);if(row.some(Boolean))rows.push(row);row=[];s='';}else s+=c;}if(s||row.length){row.push(s);rows.push(row);}return rows;}
const norm=s=>String(s||'').toLowerCase().replace(/港鐵|mtr|station|站|[\s()（）_-]/g,'');
function points(coords,out=[]){if(!Array.isArray(coords))return out;if(typeof coords[0]==='number'){let [lon,lat]=coords;if(lon>21&&lon<23&&lat>113&&lat<115)[lon,lat]=[lat,lon];if(lon>113&&lon<115&&lat>21&&lat<23)out.push([lon,lat]);}else for(const c of coords)points(c,out);return out;}
async function refresh(){
const [raw,geo]=await Promise.all([fetchOK(linesURL).then(r=>r.text()),fetchOK(venuesURL).then(r=>r.json())]);
if(!Array.isArray(geo.features)||!geo.features.length)throw Error('No official station geometries');
const rows=csv(raw.replace(/^\uFEFF/,'')),head=rows.shift().map(h=>h.trim().toUpperCase().replaceAll(' ','_'));
const pick=(r,k)=>r[head.indexOf(k)]||'';const stations=new Map();
for(const r of rows){const code=pick(r,'STATION_CODE'),line=pick(r,'LINE_CODE');if(!code||!line)continue;const s=stations.get(code)||{code,name_tc:pick(r,'CHINESE_NAME'),name_en:pick(r,'ENGLISH_NAME'),lines:[]};if(!s.lines.includes(line))s.lines.push(line);stations.set(code,s);}
const features=geo.features.map(f=>({values:Object.values(f.properties||{}).filter(v=>typeof v==='string').map(norm),points:points(f.geometry?.coordinates)}));
const data=[],missing=[];
for(const s of stations.values()){
const names=[norm(s.name_tc),norm(s.name_en)].filter(Boolean);
const matches=features.filter(f=>f.points.length&&f.values.some(v=>names.includes(v)||v===norm(s.code)));
if(!matches.length){missing.push(s.code);continue;}
const pts=matches.flatMap(f=>f.points),lon=pts.reduce((a,p)=>a+p[0],0)/pts.length,lat=pts.reduce((a,p)=>a+p[1],0)/pts.length;
data.push({...s,lat,lon});
}
console.log(`Matched ${data.length}/${stations.size} official railway stations. Missing: ${missing.join(',')}`);
if(data.length<stations.size*.85||missing.some(c=>stations.get(c)?.lines.includes('EAL')))throw Error('Station geometry coverage incomplete; refusing to publish');
await mkdir('runtime',{recursive:true});await writeFile('runtime/mtr-stations.json',JSON.stringify({generated:new Date().toISOString(),source:[linesURL,venuesURL],distanceReference:'station-building-centre',data}));
}
async function reusePublished(){
  const catalog=JSON.parse(await readFile(new URL('../data/mtr-stations-validated.json',import.meta.url),'utf8'));
  const data=catalog.data;
  if(!Array.isArray(data)||data.length<97||catalog.distanceReference!=='station-building-centre'||!catalog.generated||!Array.isArray(catalog.source)||!catalog.source.includes(venuesURL))throw Error('Published railway catalog provenance/coverage invalid');
  const codes=new Set();
  for(const s of data){
    if(!s.code||codes.has(s.code)||!s.name_tc||!Array.isArray(s.lines)||!s.lines.length||!Number.isFinite(s.lat)||!Number.isFinite(s.lon)||s.lat<21||s.lat>23||s.lon<113||s.lon>115)throw Error('Invalid published station '+s.code);
    codes.add(s.code);
  }
  for(const code of ['ADM','EXC','HUH','MKK','KOT','TAW','SHT','FOT','UNI','TAP','TWO','FAN','SHS','LOW','LMC'])if(!data.some(s=>s.code===code&&s.lines.includes('EAL')))throw Error('Missing East Rail station '+code);
  await mkdir('runtime',{recursive:true});
  // Preserve original generation date and official provenance, not a fresh-data claim.
  await writeFile('runtime/mtr-stations.json',JSON.stringify(catalog));
  console.log(`Reused ${data.length} previously published official stations; generated ${catalog.generated}.`);
}
if(process.argv.includes('--reuse-published'))await reusePublished();
else await refresh();
