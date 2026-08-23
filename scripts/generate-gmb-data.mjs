import { writeFile } from "node:fs/promises";

const API = "https://data.etagmb.gov.hk";
const regions = ["HKI", "KLN", "NT"];
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));

async function json(url, retries = 7) {
  let last;
  for (let i = 0; i < retries; i++) {
    try {
      const response = await fetch(url, { headers:{ Accept:"application/json" } });
      if (!response.ok) throw new Error(`${response.status} ${url}`);
      const value = await response.json();
      await pause(140);
      return value;
    } catch (error) {
      last = error;
      const rateLimited = String(error.message).startsWith("403") || String(error.message).startsWith("429");
      await pause(rateLimited ? 2500 * (i + 1) : 450 * (i + 1));
    }
  }
  throw last;
}
async function pool(items, limit, worker) {
  const q = [...items], results = [];
  await Promise.all(Array.from({ length:Math.min(limit, q.length) }, async () => {
    while (q.length) {
      const item = q.shift();
      try { results.push(await worker(item)); }
      catch (error) { console.warn(error.message); }
    }
  }));
  return results;
}

async function fromOfficialApi() {
  const routeList = (await json(`${API}/route`)).data?.routes || {};
  const routeCodes = regions.flatMap(region => (routeList[region] || []).map(route => ({ region, route:String(route) })));
  const variantsNested = await pool(routeCodes, 3, async item => {
    const payload = await json(`${API}/route/${item.region}/${encodeURIComponent(item.route)}`);
    return (payload.data || []).flatMap(variant => (variant.directions || []).map(direction => ({
      operator:"GMB", region:item.region, route:item.route, routeId:variant.route_id,
      routeSeq:direction.route_seq, bound:Number(direction.route_seq) === 1 ? "O" : "I",
      serviceType:String(direction.route_seq), orig:direction.orig_tc || "", dest:direction.dest_tc || ""
    })));
  });
  const routes = variantsNested.flat();
  const routeStops = await pool(routes, 2, async route => {
    const payload = await json(`${API}/route-stop/${route.routeId}/${route.routeSeq}`);
    return { route, stops:payload.data?.route_stops || [] };
  });
  const stopRefs = new Map();
  for (const { route, stops } of routeStops) for (const stop of stops) {
    const id = String(stop.stop_id), current = stopRefs.get(id) || { stop:id, name_tc:stop.name_tc || id, routes:[] };
    current.routes.push({ route:route.route, routeId:route.routeId, routeSeq:route.routeSeq, stopSeq:stop.stop_seq });
    stopRefs.set(id, current);
  }
  const stops = await pool([...stopRefs.values()], 3, async stop => {
    const payload = await json(`${API}/stop/${stop.stop}`);
    const point = payload.data?.coordinates?.wgs84 || {};
    return { ...stop, lat:Number(point.latitude), long:Number(point.longitude), enabled:payload.data?.enabled !== false };
  });
  if (!routes.length || stops.length < 100) throw new Error("Official GMB index was incomplete");
  return { routes, stops };
}

async function fromPublishedMirror() {
  console.warn("Official bulk API is rate-limited; using the HK Bus Crawling published mirror for the static index. Live ETA remains official.");
  const source = await (await fetch("https://data.hkbus.app/routeFareList.min.json")).json();
  const routeMap = new Map(), stopRefs = new Map();
  for (const entry of Object.values(source.routeList || {})) {
    if (!entry.co?.includes("gmb") || !entry.gtfsId || !entry.stops?.gmb) continue;
    const bound = entry.bound?.gmb || "O", routeSeq = bound === "O" ? 1 : 2;
    const route = { operator:"GMB", region:"", route:String(entry.route), routeId:String(entry.gtfsId), routeSeq, bound, serviceType:String(routeSeq), orig:entry.orig?.zh || "", dest:entry.dest?.zh || "" };
    routeMap.set([route.routeId,routeSeq,route.orig,route.dest].join("|"), route);
    entry.stops.gmb.forEach((id, index) => {
      id = String(id); const meta = source.stopList?.[id] || source.stopMap?.[id] || {};
      const current = stopRefs.get(id) || { stop:id, name_tc:meta.name?.zh || id, lat:Number(meta.location?.lat), long:Number(meta.location?.lng), enabled:true, routes:[] };
      current.routes.push({ route:route.route, routeId:route.routeId, routeSeq, stopSeq:index + 1 }); stopRefs.set(id, current);
    });
  }
  return { routes:[...routeMap.values()], stops:[...stopRefs.values()] };
}

let generatedData;
try { generatedData = await fromOfficialApi(); }
catch (error) { console.warn(error.message); generatedData = await fromPublishedMirror(); }
const { routes, stops } = generatedData;
const generated = new Date().toISOString();
const enabledStops = stops.filter(s => Number.isFinite(s.lat) && Number.isFinite(s.long) && s.enabled);
const writeParts = async (prefix, values, count) => Promise.all(Array.from({length:count}, (_,i) => writeFile(`${prefix}-${i}.json`, JSON.stringify({ generated_timestamp:generated, data:values.filter((_,index) => index % count === i) }))));
await writeParts("gmb-routes", routes, 8);
await writeParts("gmb-stops", enabledStops, 16);
console.log(`Generated ${routes.length} GMB directions and ${stops.length} stops.`);
