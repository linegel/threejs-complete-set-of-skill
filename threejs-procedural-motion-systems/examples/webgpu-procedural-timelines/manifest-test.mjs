import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { validateLabManifest, validateRawLabManifest } from "../../../scripts/lib/lab-validation.mjs";

const root = dirname(fileURLToPath(import.meta.url));
const manifest = JSON.parse(readFileSync(join(root, "lab.manifest.json"), "utf8"));
const rawResult = validateRawLabManifest(manifest);
assert.deepEqual(rawResult.errors, [], rawResult.errors.join("\n"));
const result = validateLabManifest(manifest);
assert.deepEqual(result.errors, [], result.errors.join("\n"));
for (const route of manifest.mechanisms) {
  assert(route.route, `mechanism ${route.id} declares a route`);
  assert(existsSync(join(root, route.route, "index.html")), `mechanism ${route.id} has a physical wrapper`);
}
for (const tier of manifest.tiers) {
  assert(existsSync(join(root, "tier", tier.id, "index.html")), `tier ${tier.id} has a physical wrapper`);
}
console.log("motion schema-v2 manifest and physical routes validated");
