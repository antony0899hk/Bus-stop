const fs = require("node:fs");
const vm = require("node:vm");
const assert = require("node:assert/strict");

const app = fs.readFileSync("app.js", "utf8");
const extractFunction = name => {
  const match = app.match(new RegExp(`function ${name}\\([^\\n]*\\) \\{[\\s\\S]*?\\n\\}`));
  assert(match, `Expected ${name} to exist`);
  return match[0];
};
const etaLabel = vm.runInNewContext(`${extractFunction("etaLabel")}\netaLabel`, { Date });
const freshRouteEtas = vm.runInNewContext(`${extractFunction("freshRouteEtas")}\nfreshRouteEtas`, { Date });
const now = Date.now();

assert.equal(etaLabel(new Date(now + 10_000).toISOString()), "即將到站");
assert.equal(etaLabel(new Date(now + 90_000).toISOString()), "2 分鐘");
assert.equal(etaLabel(new Date(now - 30_000).toISOString()), "更新中");
assert.deepEqual(
  freshRouteEtas([
    { eta:new Date(now - 20_000).toISOString() },
    { eta:new Date(now + 120_000).toISOString() },
    { eta:new Date(now + 60_000).toISOString() }
  ]).map(x => x.eta),
  [new Date(now + 60_000).toISOString(), new Date(now + 120_000).toISOString()]
);

assert.match(app, /function startRouteEtaRefresh\([\s\S]*?\}, 30000\);/);
assert.match(app, /const visible = stops\.filter/);
assert.match(app, /await parallel\(visible, 3,/);
assert.match(app, /routeEtaRefreshBusy/);
assert.match(app, /routeEtas\(r, rs, "KMB"\)/);
assert.match(app, /routeEtas\(r, rs, "CTB"\)/);
assert.match(app, /routeEtas\(r, rs, "GMB"\)/);
assert.match(app, /clearRouteEtaRefresh\(\); \$\("#routeSection"\)/);

console.log("Passed: expired ETAs no longer masquerade as arrivals, and visible route stops refresh without overlapping requests.");
