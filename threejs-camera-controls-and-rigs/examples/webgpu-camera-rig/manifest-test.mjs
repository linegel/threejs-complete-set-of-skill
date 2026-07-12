import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { buildDemoRegistry } from "../../../scripts/lib/lab-registry.mjs";
import { validateLabManifest, validateRawLabManifest } from "../../../scripts/lib/lab-validation.mjs";

const root = dirname(fileURLToPath(import.meta.url));
const manifest = JSON.parse(readFileSync(join(root, "lab.manifest.json"), "utf8"));
const rawResult = validateRawLabManifest(manifest);
assert.deepEqual(rawResult.errors, [], rawResult.errors.join("\n"));
const registryManifest = buildDemoRegistry().demos.find((entry) => entry.id === manifest.id);
assert(registryManifest, `registry contains ${manifest.id}`);
const result = validateLabManifest(registryManifest);
assert.deepEqual(result.errors, [], result.errors.join("\n"));
const mainSource = readFileSync(join(root, "main.mjs"), "utf8");
assert.match(mainSource, /const LAB_ID = ["']webgpu-camera-rig["'];/);
assert.match(mainSource, /get labId\(\)/);
assert.match(mainSource, /labId: LAB_ID/);
const browserSource = readFileSync(join(root, "browser.mjs"), "utf8");
assert.match(browserSource, /globalThis\.labController = demo\.labController/);
assert.match(browserSource, /globalThis\.__LAB_CONTROLLER__ = demo\.labController/);
const indexSource = readFileSync(join(root, "index.html"), "utf8");
assert.match(indexSource, /globalThis\.labController = demo\.labController/);
assert.match(indexSource, /globalThis\.__LAB_CONTROLLER__ = demo\.labController/);
for (const route of manifest.mechanisms) {
  assert(route.route, `mechanism ${route.id} declares a route`);
  assert(existsSync(join(root, route.route, "index.html")), `mechanism ${route.id} has a physical wrapper`);
}
for (const tier of manifest.tiers) {
  assert(existsSync(join(root, "tier", tier.id, "index.html")), `tier ${tier.id} has a physical wrapper`);
}
console.log("camera schema-v2 manifest and physical routes validated");
