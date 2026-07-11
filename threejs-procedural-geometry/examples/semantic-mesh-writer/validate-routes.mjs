import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";

import { GEOMETRY_DPR_CAPS } from "./lab-controller.js";
import { LOD_PRESETS } from "./lod-presets.js";

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
  const runtime = LOD_PRESETS[tier.id];
  assert(runtime, `manifest tier ${tier.id} has no runtime LOD preset`);
  assert.equal(tier.resolutionPolicy.dprCap, GEOMETRY_DPR_CAPS[tier.id], `${tier.id} DPR cap drift`);
  assert.equal(tier.mechanismLimits.profileSamples, runtime.profileSamples, `${tier.id} profile sample drift`);
  assert.equal(tier.mechanismLimits.railSegments, runtime.railSegments, `${tier.id} rail segment drift`);
  assert.equal(tier.resourceLimits.maxVertices, runtime.maxVertices, `${tier.id} vertex budget drift`);
  assert.equal(tier.resourceLimits.maxTriangles, runtime.maxTriangles, `${tier.id} triangle budget drift`);
}
const app = readFileSync(new URL("./app.js", import.meta.url), "utf8");
assert.match(app, /Unknown mechanism route/, "unknown mechanisms must throw");
assert.match(app, /Unknown tier route/, "unknown tiers must throw");
console.log(JSON.stringify({ ok: true, physicalRoutes: routes.length }, null, 2));
