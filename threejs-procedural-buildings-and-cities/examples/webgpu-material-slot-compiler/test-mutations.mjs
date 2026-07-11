import assert from "node:assert/strict";

import { createBuildingPlan, validateBuildingPlan } from "./building-plan.js";
import { compileCityChunk, validateChunkCulling } from "./chunking.js";
import {
  compileBuilding,
  disposeCompiledBuilding,
  validateCompiledGeometryOrientation,
  validateDisposalLedger,
} from "./compiler.js";
import {
  createBuildingNodeMaterials,
  disposeBuildingNodeMaterials,
  validateMaterialBindings,
} from "./materials.js";
import { validateGeometryTangentFrames, validateGeometryUvJacobians } from "./uv-debug.js";
import {
  expectedSceneBackendDrawItems,
  resolveBuildingDpr,
} from "./lab-controller.js";

function catches(id, mutate, operation = validateBuildingPlan) {
  const plan = createBuildingPlan({ name: id, footprint: "L", seed: 7 });
  mutate(plan);
  const result = operation(plan);
  if (result && typeof result.ok === "boolean") assert.equal(result.ok, false, `${id} must fail`);
  return id;
}

const detected = [];
assert.equal(resolveBuildingDpr("distant", 2), 1, "distant tier must clamp DPR to its locked cap");
assert.equal(resolveBuildingDpr("city", 2), 1.5, "city tier must clamp DPR to its locked cap");
assert.equal(resolveBuildingDpr("hero", 1.25), 1.25, "DPR below the tier cap must be preserved");
detected.push("tier-dpr-cap-enforced");

assert.equal(
  expectedSceneBackendDrawItems({ diagnostics: { drawCalls: 2, backendDrawItems: 11 } }),
  12,
  "renderer submission reconciliation must use BatchedMesh backend entries plus the ground draw",
);
assert.equal(
  expectedSceneBackendDrawItems({
    diagnostics: { drawCalls: 2, backendDrawItems: 11 },
    getCullingState: () => ({ submittedDrawCalls: 1, submittedDrawItems: 7 }),
  }),
  8,
  "culled city reconciliation must use submitted backend draw items plus the ground draw",
);
detected.push("backend-draw-items-not-scene-object-count");
detected.push(catches("duplicate-ownership", (plan) => {
  plan.placements.push(structuredClone(plan.placements[0]));
  // Leave the original diagnostics attached: validation must recompute rather
  // than accepting this stale snapshot.
}));

detected.push(catches("cross-edge-world-overlap", (plan) => {
  const placement = plan.placements.find((entry) =>
    (entry.side === "left" || entry.side === "right") && entry.moduleId === "plinth");
  const edge = plan.exposedEdges.find((entry) => entry.id === placement.edgeId);
  placement.interval = { start: edge.start, end: edge.end };
  placement.ownershipRect.horizontal = [edge.start, edge.end];
  placement.dimensions.width = edge.length;
  placement.position[2] = edge.center;
  // The front/back corner owner now intersects this side solid in positive
  // world-space volume. The original diagnostics still says otherwise.
}));

detected.push(catches("placement-outside-exposed-edge", (plan) => {
  const placement = plan.placements.find((entry) => entry.side !== "top");
  placement.interval.start -= 100;
}));

detected.push(catches("four-bay-sliver", (plan) => {
  const tier = plan.tiers.find((entry) => entry.role === "shaft");
  tier.footprintPieces[0].x1 = tier.footprintPieces[0].x0 + 3;
}));

const missingBuilder = createBuildingPlan({ name: "missing-builder", footprint: "single", seed: 9 });
missingBuilder.placements[0].moduleId = "nonexistent-module";
const materials = createBuildingNodeMaterials();
assert.throws(() => compileBuilding(missingBuilder, materials), /missing module builders/i);
detected.push("missing-builder");

const materialMutation = createBuildingNodeMaterials();
materialMutation.limestone.normalNode = null;
assert.equal(validateMaterialBindings(materialMutation).ok, false, "unbound normal texture mutation must fail");
detected.push("unbound-material-texture");
disposeBuildingNodeMaterials(materialMutation);

const uvPlan = createBuildingPlan({ name: "zero-uv", footprint: "single", seed: 3 });
const uvCompiled = compileBuilding(uvPlan, materials);
const uvGeometry = uvCompiled.slotMeshes.find((mesh) => !mesh.isBatchedMesh).geometry;
const originalNormal = [
  uvGeometry.attributes.normal.getX(0),
  uvGeometry.attributes.normal.getY(0),
  uvGeometry.attributes.normal.getZ(0),
];
uvGeometry.attributes.normal.setXYZ(0, -originalNormal[0], -originalNormal[1], -originalNormal[2]);
assert.equal(validateCompiledGeometryOrientation(uvGeometry).ok, false, "one-corner inverted normal must fail orientation validation");
detected.push("one-corner-normal-inversion");
uvGeometry.attributes.normal.setXYZ(0, ...originalNormal);
const originalW = uvGeometry.attributes.tangent.getW(0);
uvGeometry.attributes.tangent.setW(0, -originalW);
assert.equal(validateGeometryTangentFrames(uvGeometry).ok, false, "flipped tangent handedness must fail UV-frame validation");
detected.push("flipped-tangent-handedness");
uvGeometry.attributes.tangent.setW(0, originalW);
uvGeometry.attributes.uv.array.fill(0);
assert.equal(validateGeometryUvJacobians(uvGeometry).ok, false, "zero-UV mutation must fail Jacobian validation");
detected.push("zero-uv-jacobian");
disposeCompiledBuilding(uvCompiled);

const disposalPlan = createBuildingPlan({ name: "skipped-dispose", footprint: "single", seed: 7 });
const disposalCompiled = compileBuilding(disposalPlan, materials);
disposalCompiled.slotMeshes[0].geometry.dispose = () => {};
const invalidLedger = disposeCompiledBuilding(disposalCompiled);
assert.equal(validateDisposalLedger(invalidLedger).ok, false, "skipped geometry disposal must fail ledger reconciliation");
detected.push("skipped-geometry-dispose");

const chunk = compileCityChunk({ materials, fixtureNames: ["single tower", "compound L"] });
const culling = chunk.cullByRadius(chunk.bounds.min, 1);
const hidden = chunk.chunks.find((entry) => !entry.root.visible);
assert(hidden, "culling mutation fixture needs a hidden chunk");
hidden.root.visible = true;
assert.equal(validateChunkCulling(chunk.chunks, culling).ok, false, "stale culling report must fail live-visibility reconciliation");
detected.push("stale-culling-report");
chunk.dispose();
disposeBuildingNodeMaterials(materials);

console.log(JSON.stringify({ ok: true, detected }, null, 2));
