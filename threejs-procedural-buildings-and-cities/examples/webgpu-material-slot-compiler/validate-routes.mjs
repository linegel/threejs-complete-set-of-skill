import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";

import { BUILDING_DPR_CAPS } from "./lab-controller.js";

const manifest = JSON.parse(readFileSync(new URL("./lab.manifest.json", import.meta.url)));
const routes = [
  ...manifest.mechanisms.map((entry) => ["mechanism", entry.id]),
  ...manifest.tiers.map((entry) => ["tier", entry.id]),
];
for (const [kind, id] of routes) {
  const url = new URL(`./${kind}/${id}/index.html`, import.meta.url);
  assert(existsSync(url), `missing physical ${kind} route ${id}`);
  const html = readFileSync(url, "utf8");
  assert.match(html, /src="\.\.\/\.\.\/app\.js"/, `${kind}/${id} must import canonical app`);
}
for (const tier of manifest.tiers) {
  assert.equal(tier.resolutionPolicy.dprCap, BUILDING_DPR_CAPS[tier.id], `${tier.id} DPR cap drift`);
}
const distant = manifest.tiers.find((tier) => tier.id === "distant");
assert.equal(
  distant.mechanismLimits.representation,
  "runtime-compiled-merged-material-slots",
  "distant tier must declare the runtime compiler representation rather than a nonexistent precompiled shell",
);
const app = readFileSync(new URL("./app.js", import.meta.url), "utf8");
assert.match(app, /Unknown mechanism route/, "unknown mechanisms must throw");
assert.match(app, /Unknown tier route/, "unknown tiers must throw");
console.log(JSON.stringify({ ok: true, physicalRoutes: routes.length }, null, 2));
