import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

import {
  VEGETATION_INTEGRATION_MECHANISM_MODE,
  VEGETATION_INTEGRATION_TIER_CONFIG,
  VEGETATION_INTEGRATION_TIER_IDS,
  resolveVegetationIntegrationRoute,
} from "./route-contract.js";

const here = fileURLToPath(new URL(".", import.meta.url));
const manifest = JSON.parse(readFileSync(resolve(here, "lab.manifest.json"), "utf8"));
const browserSource = readFileSync(resolve(here, "browser-lab.js"), "utf8");
assert(browserSource.includes("createStrictLabController"), "integration browser must expose the strict controller interface");
assert(browserSource.includes("await renderer.init()"), "integration browser must initialize WebGPU before use");
assert(browserSource.includes("renderer.backend?.isWebGPUBackend !== true"), "integration browser must block missing WebGPU");
assert(browserSource.includes("bytesPerRow"), "integration capture must report aligned row stride");

for (const scenario of manifest.scenarios) {
  const route = resolveVegetationIntegrationRoute(`http://127.0.0.1${scenario.route}`);
  assert.equal(route.scenario, scenario.id);
}
for (const mechanism of manifest.mechanisms) {
  const route = resolveVegetationIntegrationRoute(`http://127.0.0.1${mechanism.route}`);
  assert.equal(route.mode, VEGETATION_INTEGRATION_MECHANISM_MODE[mechanism.id]);
  assert.equal(route.mode, mechanism.startup.mode);
}
for (const tier of VEGETATION_INTEGRATION_TIER_IDS) {
  assert.equal(resolveVegetationIntegrationRoute(`http://127.0.0.1/demos/${manifest.id}/tier/${tier}/`).tier, tier);
  assert.equal(resolveVegetationIntegrationRoute(`http://127.0.0.1/?tier=${tier}`).tier, tier);
}
for (const tier of manifest.tiers) {
  const runtime = VEGETATION_INTEGRATION_TIER_CONFIG[tier.id];
  assert.equal(tier.resolutionPolicy.dprCap.value, runtime.dprCap);
  assert.equal(tier.resourceLimits.denseStorageBytes.value, runtime.denseStorageBytes);
  assert.equal(tier.resourceLimits.ashForestStorageBytes.value, runtime.ashForestStorageBytes);
}
assert.equal(resolveVegetationIntegrationRoute("http://127.0.0.1/?seed=2654435769").seed, 0x9e3779b9);

for (const bad of [
  "/?scenario=not-real",
  "/?mode=proxy",
  "/?tier=automatic",
  "/?camera=second-camera",
  "/?seed=17",
  "/demos/webgpu-vegetation-integration/mechanism/fake/",
]) {
  assert.throws(() => resolveVegetationIntegrationRoute(`http://127.0.0.1${bad}`));
}

if (process.argv.includes("--mutations")) {
  const mutatedTier = { ...manifest.tiers[1].resolutionPolicy.dprCap, value: 2.5 };
  assert.notEqual(mutatedTier.value, 1.5, "DPR-cap mutation must be observable");
  assert.throws(() => resolveVegetationIntegrationRoute("http://127.0.0.1/?mode=owner_graph"));
}

console.log(JSON.stringify({
  pass: true,
  scenarios: manifest.scenarios.length,
  mechanisms: manifest.mechanisms.length,
  tiers: manifest.tiers.length,
  strictController: true,
}));
