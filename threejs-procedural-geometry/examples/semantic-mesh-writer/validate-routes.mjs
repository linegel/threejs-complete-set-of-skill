import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";

import {
  assertGeometryRouteTransition,
  GEOMETRY_DPR_CAPS,
  normalizeGeometryRouteLock,
} from "./lab-controller.js";
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
  assert.equal(
    tier.mechanismLimits.branchRadialSegments,
    runtime.branchRadialSegments,
    `${tier.id} branch radial segment drift`,
  );
  assert.equal(tier.resourceLimits.maxVertices, runtime.maxVertices, `${tier.id} vertex budget drift`);
  assert.equal(tier.resourceLimits.maxTriangles, runtime.maxTriangles, `${tier.id} triangle budget drift`);
}
const app = readFileSync(new URL("./app.js", import.meta.url), "utf8");
assert.match(app, /Unknown mechanism route/, "unknown mechanisms must throw");
assert.match(app, /Unknown tier route/, "unknown tiers must throw");
assert.match(app, /routeLock:/, "physical wrappers must bind their state through the public controller lock");
const mechanismLock = normalizeGeometryRouteLock({ mode: "branch-rings" });
assert.equal(assertGeometryRouteTransition(mechanismLock, "mode", "branch-rings"), true);
assert.throws(
  () => assertGeometryRouteTransition(mechanismLock, "mode", "dynamic-updates"),
  /locked to "branch-rings"/,
  "public mode setter must not drift an immutable mechanism route",
);
const tierLock = normalizeGeometryRouteLock({ tier: "crowd" });
assert.equal(assertGeometryRouteTransition(tierLock, "tier", "crowd"), true);
assert.throws(
  () => assertGeometryRouteTransition(tierLock, "tier", "hero"),
  /locked to "crowd"/,
  "public tier setter must not drift an immutable tier route",
);
assert.match(
  app,
  /URLSearchParams\(window\.location\.search\)\.get\("capture"\) !== "1"/,
  "capture routes must not start the interactive animation loop",
);
console.log(JSON.stringify({ ok: true, physicalRoutes: routes.length }, null, 2));
