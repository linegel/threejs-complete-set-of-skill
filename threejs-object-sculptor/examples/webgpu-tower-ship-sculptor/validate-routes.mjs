import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { TOWER_SHIP_DPR_CAPS } from "./lab-controller.js";
import { towerShipRouteFromLocation } from "./route-state.js";

const manifest = JSON.parse(readFileSync(new URL("./lab.manifest.json", import.meta.url)));
const routes = [
  ...manifest.mechanisms.map((entry) => ["mechanism", entry.id]),
  ...manifest.tiers.map((entry) => ["tier", entry.id]),
];
for (const [kind, id] of routes) {
  const url = new URL(`./${kind}/${id}/index.html`, import.meta.url);
  assert(existsSync(url), `missing physical ${kind} route ${id}`);
  assert.match(readFileSync(url, "utf8"), /src="\.\.\/\.\.\/app\.js"/, `${kind}/${id} must import canonical app`);
}
for (const tier of manifest.tiers) {
  assert.equal(tier.resolutionPolicy.dprCap, TOWER_SHIP_DPR_CAPS[tier.id], `${tier.id} DPR cap drift`);
  assert.equal(tier.preservedInvariants.includes("24 articulated oars"), true, `${tier.id} must preserve the oar bank`);
}
const app = readFileSync(new URL("./app.js", import.meta.url), "utf8");
assert.match(app, /Unknown mechanism route/, "unknown mechanism routes must throw");
assert.match(app, /Unknown tier route/, "unknown tier routes must throw");
assert.deepEqual(
  towerShipRouteFromLocation({ pathname: "/tier/minimum/", search: "" }),
  { mechanism: null, tier: "minimum" },
  "physical tier routes must resolve before boot",
);
assert.deepEqual(
  towerShipRouteFromLocation({ pathname: "/demos/webgpu-tower-ship-sculptor/", search: "?mechanism=interaction" }),
  { mechanism: "interaction", tier: null },
  "generated mechanism queries must resolve before boot",
);
assert.deepEqual(
  towerShipRouteFromLocation({ pathname: "/demos/webgpu-tower-ship-sculptor/", search: "?tier=minimum" }),
  { mechanism: null, tier: "minimum" },
  "generated tier queries must resolve before boot",
);
assert.throws(
  () => towerShipRouteFromLocation({ pathname: "/tier/full/", search: "?tier=minimum" }),
  /Conflicting tier route/,
  "conflicting physical and generated routes must fail closed",
);
console.log(JSON.stringify({ ok: true, physicalRoutes: routes.length }, null, 2));
