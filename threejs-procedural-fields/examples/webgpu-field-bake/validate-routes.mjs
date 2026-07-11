import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { FIELD_MECHANISM_OUTPUTS, resolveLockedRoute } from "./route-contract.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, "../../..");
const targets = JSON.parse(readFileSync(resolve(repoRoot, "labs/canonical-targets.json"), "utf8"));
const manifest = JSON.parse(readFileSync(resolve(here, "lab.manifest.json"), "utf8"));
const packageJson = JSON.parse(readFileSync(resolve(here, "package.json"), "utf8"));
const target = targets.targets.find((entry) => entry.id === manifest.id);
assert(target, `canonical target missing for ${manifest.id}`);
assert.equal(manifest.schemaVersion, 2);
assert.equal(manifest.status, "incomplete");
assert.deepEqual(manifest.mechanisms.map(({ id }) => id), target.mechanisms);
assert.deepEqual(manifest.tiers.map(({ id }) => id), target.tiers);
assert.deepEqual(Object.keys(FIELD_MECHANISM_OUTPUTS), target.mechanisms);
assert.equal(
  new Set(Object.values(FIELD_MECHANISM_OUTPUTS).map(({ outputNodeId }) => outputNodeId)).size,
  target.mechanisms.length,
  "every mechanism route must select a distinct runtime output node",
);

for (const [kind, ids] of [["mechanism", target.mechanisms], ["tier", target.tiers]]) {
  for (const id of ids) {
    const path = resolve(here, kind, id, "index.html");
    assert(existsSync(path), `missing physical ${kind} route ${id}`);
    const html = readFileSync(path, "utf8");
    assert(html.includes(`data-route-kind="${kind}"`), `${kind}/${id} does not lock route kind`);
    assert(html.includes(`data-route-id="${id}"`), `${kind}/${id} does not lock route id`);
    assert(html.includes("route-entry.mjs"), `${kind}/${id} does not import the canonical route entry`);
    const locked = resolveLockedRoute(manifest, kind, id);
    assert(Object.isFrozen(locked));
    if (kind === "mechanism") assert.equal(locked.outputNodeId, FIELD_MECHANISM_OUTPUTS[id].outputNodeId);
  }
}

const storageTier = manifest.tiers.find(({ id }) => id === "gpu-storage");
const directTier = manifest.tiers.find(({ id }) => id === "gpu-direct-evaluate");
const precomputedTier = manifest.tiers.find(({ id }) => id === "precomputed-minimum");
assert.deepEqual(storageTier.resolutionPolicy.fieldExtent, [641, 359]);
assert.equal(directTier.resourceLimits.storageBytes, 0);
assert.deepEqual(precomputedTier.resolutionPolicy.fieldExtent, [512, 512]);
assert.equal(precomputedTier.resourceLimits.storageTextures, 0);
assert.equal(precomputedTier.resourceLimits.storageBuffers, 0);

const browserSource = readFileSync(resolve(here, "browser-app.js"), "utf8");
for (const method of [
  "ready", "setScenario", "setMode", "setTier", "setSeed", "setCamera", "setTime",
  "step", "resetHistory", "resize", "renderOnce", "capturePixels", "describePipeline",
  "describeResources", "getMetrics", "dispose",
]) {
  assert(browserSource.includes(`${method}(`), `LabController is missing ${method}()`);
}
for (const token of [
  "FIELD_EXTENT = Object.freeze({ width: 641, height: 359 })",
  "globalThis.labController = controller",
  "globalThis.__LAB_CONTROLLER__ = controller",
  "requireKnown(id, SCENARIOS",
  "requireKnown(id, MODES",
  "requireKnown(nextTier, TIERS",
  "Unknown camera",
]) {
  assert(browserSource.includes(token), `browser controller contract is missing ${token}`);
}

for (const [kind, id] of [["mechanism", "unknown"], ["tier", "unknown"], ["unknown", "unknown"]]) {
  assert.throws(() => resolveLockedRoute(manifest, kind, id), /Unknown/);
}

for (const script of [
  "check", "validate:unit", "test:mutations", "capture",
  "validate:artifacts", "validate:quick", "validate:full",
]) {
  assert.equal(typeof packageJson.scripts[script], "string", `missing standard package script ${script}`);
}

console.log(`Validated ${target.mechanisms.length} field mechanisms and ${target.tiers.length} field tiers.`);
