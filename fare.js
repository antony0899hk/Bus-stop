(() => {
  "use strict";
  const BUS_FARE = "https://static.data.gov.hk/td/routes-fares-xml/FARE_BUS.xml";
  const GMB_FARE = "https://static.data.gov.hk/td/routes-fares-xml/FARE_GMB.xml";
  const cache = new Map();

  async function loadFareXml(operator) {
    const url = operator === "GMB" ? GMB_FARE : BUS_FARE;
    if (cache.has(url)) return cache.get(url);
    const p = fetch(url, { cache:"force-cache" }).then(r => {
      if (!r.ok) throw new Error(`Fare HTTP ${r.status}`);
      return r.text();
    }).then(text => {
      const xml = new DOMParser().parseFromString(text, "text/xml");
      if (xml.querySelector("parsererror")) throw new Error("Fare XML parse error");
      return xml;
    }).catch(err => { cache.delete(url); throw err; });
    cache.set(url, p);
    return p;
  }

  function textOf(node, names) {
    for (const name of names) {
      const el = node.querySelector(name);
      const v = el?.textContent?.trim();
      if (v) return v;
    }
    return "";
  }

  function routeFareRecords(xml, ctx = {}) {
    const route = String(ctx.route || "").trim().toUpperCase();
    if (!route) return [];
    const candidates = [...xml.querySelectorAll("*:)".replace(":)", ""))];
    const out = [];
    for (const n of candidates) {
      if (!n.children || n.children.length < 2) continue;
      const r = textOf(n, ["ROUTE_NAMEC","ROUTE_NAMEE","ROUTE_NAME","ROUTE","ROUTE_NO","ROUTE_NUM"]);
      if (!r || String(r).trim().toUpperCase() !== route) continue;
      const fareRaw = textOf(n, ["FARE","FULL_FARE","SECTION_FARE","AIR_FARE","ADULT_FARE"]);
      const fare = Number(String(fareRaw).replace(/[^0-9.]/g, ""));
      if (!Number.isFinite(fare)) continue;
      const seqRaw = textOf(n, ["FROM_STOP_SEQ","STOP_SEQ","BOARDING_STOP_SEQ","SEQ","FROM_SEQ"]);
      const seq = Number(String(seqRaw).replace(/[^0-9]/g, "")) || 1;
      const bound = textOf(n, ["BOUND","DIRECTION","DIR"]);
      if (ctx.bound && bound && !String(bound).toUpperCase().includes(String(ctx.bound).toUpperCase())) continue;
      out.push({ seq, fare, bound });
    }
    return out;
  }

  function buildFareMap(records = []) {
    const map = new Map();
    for (const r of records) {
      const seq = Number(r.seq) || 1;
      const fare = Number(r.fare);
      if (Number.isFinite(fare) && (!map.has(seq) || fare < map.get(seq))) map.set(seq, fare);
    }
    if (!map.size && records.length) {
      const f = Number(records[0].fare);
      if (Number.isFinite(f)) map.set(1, f);
    }
    return map;
  }

  window.loadFareXml = loadFareXml;
  window.routeFareRecords = routeFareRecords;
  window.buildFareMap = buildFareMap;
})();
