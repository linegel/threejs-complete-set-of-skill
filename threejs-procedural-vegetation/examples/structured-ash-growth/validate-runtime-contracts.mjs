import assert from "node:assert/strict";

import {
  createAshForestStorage,
  createAshScene,
  evaluateAshLeafWindCPU,
  getAshGeometryResourceLedger,
  setAshDiagnosticMode,
} from "./ash-scene.js";
import { verifyAshContract } from "./verify-ash-contract.js";

const contract = verifyAshContract();
assert.equal(contract.branchVertices, 6639);
assert.equal(contract.branchTriangles, 9120);
assert.equal(contract.leafVertices, 21760);
assert.equal(contract.leafTriangles, 10880);
assert(Math.abs(contract.branchMaxY - 80.2981) < 1e-3);
assert(Math.abs(contract.leafMaxY - 83.6902) < 1e-3);

const scene = createAshScene({ loadTextures: false });
const geometryLedger = getAshGeometryResourceLedger(scene.tree);
assert(geometryLedger.residentBytes > 0 && geometryLedger.uniqueBufferArrays >= 3);
for (const name of ["leafTangentU", "leafTangentV", "leafRoot", "leafUvY"]) {
  assert(scene.tree.leafGeometry.getAttribute(name), `leaf geometry must expose ${name}`);
}
const rootWind = evaluateAshLeafWindCPU({
  uvY: 0,
  windStrength: 0.45,
  windScalar: 0.8,
  tangentU: [1, 0, 0],
  tangentV: [0, 1, 0],
});
const tipWind = evaluateAshLeafWindCPU({
  uvY: 1,
  windStrength: 0.45,
  windScalar: 0.8,
  tangentU: [1, 0, 0],
  tangentV: [0, 1, 0],
});
assert(rootWind.displacement.every((value) => Math.abs(value) <= 1e-12), "Ash leaf root must stay fixed");
assert(Math.hypot(...tipWind.displacement) > 0, "Ash leaf tip must move under wind");
assert(Math.abs(tipWind.normalLength - 1) < 1e-12, "Ash deformed normal must be unit length");
assert(scene.leafMesh.castShadow && scene.leafMesh.customDepthMaterial == null,
  "Ash shadow caster must use the same NodeMaterial position deformation as visible foliage");
const forest = createAshForestStorage({
  tree: scene.tree,
  materials: scene.materials,
  timeNode: scene.timeNode,
  count: 100,
});
assert.equal(forest.count, 100);
assert.equal(forest.bands.length, 2);
assert.equal(forest.drawCount, 4);
assert.equal(forest.storageBytes, 3200);
assert.equal(forest.storageImmutable(), true);
assert.match(forest.storageIdentity, /^fnv1a32:/);
for (const band of forest.bands) {
  assert(band.transformStorage.value.isStorageInstancedBufferAttribute);
  assert(band.stateStorage.value.isStorageInstancedBufferAttribute);
  assert(band.branches.material.positionNode);
  assert(band.foliage.material.positionNode);
  assert(band.foliage.material.normalNode);
}

const scaled = createAshScene({ loadTextures: false, worldUnitsPerMeter: 2 });
const scaledForest = createAshForestStorage({
  tree: scaled.tree,
  materials: scaled.materials,
  timeNode: scaled.timeNode,
  count: 4,
  worldUnitsPerMeter: 2,
});
assert.equal(scaled.group.scale.x, 2, "foreground Ash coordinates must obey worldUnitsPerMeter");
assert.equal(scaledForest.worldUnitsPerMeter, 2);
const firstForestX = scaledForest.bands[0].transformStorage.value.array[0];
const referenceForestX = forest.bands[0].transformStorage.value.array[0];
assert(Math.abs(firstForestX - 2 * referenceForestX) < 1e-5,
  "forest world coordinates must apply worldUnitsPerMeter exactly once");
assert.throws(() => setAshDiagnosticMode(scene, "not-a-mode"), /unknown Ash diagnostic mode/);

const report = {
  pass: true,
  legacyFidelity: contract,
  forest: {
    instances: forest.count,
    bands: forest.bands.length,
    drawCount: forest.drawCount,
    storageBytes: forest.storageBytes,
    storageRecords: ["position-scale", "tint-phase-lod-active"],
    storageIdentity: forest.storageIdentity,
    storageImmutable: forest.storageImmutable(),
  },
  deformation: { rootWind, tipWind, visibleShadowNodeParity: true },
  geometryLedger,
  worldUnits: { foregroundScale: scaled.group.scale.x, forestScale: scaledForest.worldUnitsPerMeter },
  evidenceBoundary: "Node/static execution only; native-WebGPU render, shadow atlas parity, and timing require browser capture",
};

forest.dispose();
scaledForest.dispose();
scene.branchMesh.geometry.dispose();
scene.leafMesh.geometry.dispose();
scene.leafOrigins.geometry.dispose();
scene.ground.geometry.dispose();
scene.ground.material.dispose();
scene.materials.bark.dispose();
scene.materials.leaves.dispose();
for (const material of Object.values(scene.materials.diagnostics)) material.dispose();
scaled.branchMesh.geometry.dispose();
scaled.leafMesh.geometry.dispose();
scaled.leafOrigins.geometry.dispose();
scaled.ground.geometry.dispose();
scaled.ground.material.dispose();
scaled.materials.bark.dispose();
scaled.materials.leaves.dispose();
for (const material of Object.values(scaled.materials.diagnostics)) material.dispose();

console.log(JSON.stringify(report, null, 2));
