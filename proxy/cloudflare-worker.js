const SOURCE = "https://www.td.gov.hk/tc/special_news/trafficnews.xml";

export default {
  async fetch(request) {
    if (request.method === "OPTIONS") return cors(new Response(null, { status: 204 }));
    if (new URL(request.url).pathname !== "/api/traffic") return new Response("Not found", { status: 404 });
    try {
      const upstream = await fetch(SOURCE, { headers: { Accept: "application/xml" }, cf: { cacheTtl: 60 } });
      if (!upstream.ok) return cors(new Response("Upstream unavailable", { status: 502 }));
      return cors(new Response(await upstream.text(), { headers: { "Content-Type": "application/xml; charset=utf-8", "Cache-Control": "public, max-age=60" } }));
    } catch {
      return cors(new Response("Upstream unavailable", { status: 502 }));
    }
  }
};

function cors(response) {
  const h = new Headers(response.headers);
  h.set("Access-Control-Allow-Origin", "*");
  h.set("Access-Control-Allow-Methods", "GET, OPTIONS");
  return new Response(response.body, { status: response.status, headers: h });
}
