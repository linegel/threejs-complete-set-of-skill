import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import {
  createAshForestStorage,
  createAshScene,
  evaluateAshLeafWindCPU,
  setAshDiagnosticMode,
} from "./ash-scene.js";

assert.throws(() => createAshScene({ loadTextures: false, worldUnitsPerMeter: 0 }), /worldUnitsPerMeter/);
const scene = createAshScene({ loadTextures: false });
assert.throws(() => setAshDiagnosticMode(scene, "shadow-label-only"), /unknown Ash diagnostic mode/);

const root = evaluateAshLeafWindCPU({
  uvY: 0,
  windStrength: 0.5,
  windScalar: 1,
  tangentU: [1, 0, 0],
  tangentV: [0, 1, 0],
});
const mutatedRoot = evaluateAshLeafWindCPU({
  uvY: 0.05,
  windStrength: 0.5,
  windScalar: 1,
  tangentU: [1, 0, 0],
  tangentV: [0, 1, 0],
});
assert(root.displacement.every((value) => value === 0));
assert(Math.hypot(...mutatedRoot.displacement) > 1e-5,
  "nonzero root-weight mutation must be detected");
const degenerate = evaluateAshLeafWindCPU({
  uvY: 1,
  windStrength: 0,
  windScalar: 1,
  tangentU: [0, 1, 0],
  tangentV: [0, 1, 0],
});
assert.equal(degenerate.normalLength, 0, "degenerate card basis mutation must fail the unit-normal gate");

const forest = createAshForestStorage({
  tree: scene.tree,
  materials: scene.materials,
  timeNode: scene.timeNode,
  count: 4,
});
const band = forest.bands[0];
const original = band.transformStorage.value.array;
band.transformStorage.value.array = new Float32Array(original.length);
assert.equal(forest.storageImmutable(), false, "forest storage replacement mutation must be detected");
band.transformStorage.value.array = original;
assert.equal(forest.storageImmutable(), true);

const manifest = JSON.parse(readFileSync(new URL("./lab.manifest.json", import.meta.url), "utf8"));
const expectedDpr = { "growth/hero": 2, "growth/forest": 1.5, "growth/background": 1 };
for (const tier of manifest.tiers) {
  assert.equal(tier.resolutionPolicy.dprCap.value, expectedDpr[tier.id], `${tier.id} DPR lock drifted`);
}

forest.dispose();
scene.branchMesh.geometry.dispose();
scene.leafMesh.geometry.dispose();
scene.leafOrigins.geometry.dispose();
scene.ground.geometry.dispose();
scene.ground.material.dispose();
scene.materials.bark.dispose();
scene.materials.leaves.dispose();
for (const material of Object.values(scene.materials.diagnostics)) material.dispose();

console.log(JSON.stringify({
  pass: true,
  detected: ["invalid-world-units", "unknown-mode", "moving-root", "degenerate-normal", "forest-storage-replacement", "dpr-lock-drift"],
}));
