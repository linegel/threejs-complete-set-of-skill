import assert from "node:assert/strict";

import { buildingPlanSignature, createBuildingPlan, FIXTURE_SETTINGS, validateBuildingPlan } from "./building-plan.js";
import { compileCityChunk, validateChunkCulling } from "./chunking.js";
import { compileBuilding, disposeCompiledBuilding, validateDisposalLedger } from "./compiler.js";
import { validateDiagnosticsSchema } from "./diagnostics.js";
import { edgeContainsPlacement } from "./exposed-edges.js";
import {
  createBuildingNodeMaterials,
  validateMaterialBindings,
  validateMaterialColorSpaces,
} from "./materials.js";
import { validateModuleRegistry } from "./modules.js";
import { validateUvDensity } from "./uv-debug.js";

const requiredFixtureNames = [
  "single tower",
  "compound L",
  "compound T",
  "compound U",
  "courtyard / free court",
  "twin towers",
  "twin towers with bridge",
  "high ornament density",
  "minimum-span upper tiers",
  "glass-heavy facade",
  "distant skyline chunk",
];

const materials = createBuildingNodeMaterials();
const fixtureReports = [];

function validateCompiledGeometry(compiled) {
  let checkedTriangles = 0;
  for (const mesh of compiled.slotMeshes) {
    if (mesh.isBatchedMesh) continue;
    const geometry = mesh.geometry;
    const { position, normal, tangent, uv } = geometry.attributes;
    for (const attribute of [position, normal, tangent, uv]) {
      assert(attribute, `${mesh.name} missing attribute`);
      for (const value of attribute.array) assert(Number.isFinite(value), `${mesh.name} non-finite attribute`);
    }
    for (let vertex = 0; vertex < position.count; vertex += 1) {
      const normalLength = Math.hypot(normal.getX(vertex), normal.getY(vertex), normal.getZ(vertex));
      const tangentLength = Math.hypot(tangent.getX(vertex), tangent.getY(vertex), tangent.getZ(vertex));
      const dot = normal.getX(vertex) * tangent.getX(vertex) + normal.getY(vertex) * tangent.getY(vertex) + normal.getZ(vertex) * tangent.getZ(vertex);
      assert(Math.abs(normalLength - 1) < 1e-5, `${mesh.name} unit normal`);
      assert(Math.abs(tangentLength - 1) < 1e-5, `${mesh.name} unit tangent`);
      assert(Math.abs(dot) < 1e-5, `${mesh.name} tangent orthogonality`);
    }
    for (let component = 0; component < geometry.index.count; component += 1) {
      assert(geometry.index.getX(component) < position.count, `${mesh.name} index bounds`);
    }
    for (let component = 0; component < geometry.index.count; component += 3) {
      const ia = geometry.index.getX(component);
      const ib = geometry.index.getX(component + 1);
      const ic = geometry.index.getX(component + 2);
      const ab = [
        position.getX(ib) - position.getX(ia),
        position.getY(ib) - position.getY(ia),
        position.getZ(ib) - position.getZ(ia),
      ];
      const ac = [
        position.getX(ic) - position.getX(ia),
        position.getY(ic) - position.getY(ia),
        position.getZ(ic) - position.getZ(ia),
      ];
      const geometric = [
        ab[1] * ac[2] - ab[2] * ac[1],
        ab[2] * ac[0] - ab[0] * ac[2],
        ab[0] * ac[1] - ab[1] * ac[0],
      ];
      const authored = [
        normal.getX(ia) + normal.getX(ib) + normal.getX(ic),
        normal.getY(ia) + normal.getY(ib) + normal.getY(ic),
        normal.getZ(ia) + normal.getZ(ib) + normal.getZ(ic),
      ];
      const orientation = geometric[0] * authored[0] + geometric[1] * authored[1] + geometric[2] * authored[2];
      assert(orientation > 1e-9, `${mesh.name} triangle ${component / 3} winding/normal mismatch`);
      const du1 = uv.getX(ib) - uv.getX(ia);
      const dv1 = uv.getY(ib) - uv.getY(ia);
      const du2 = uv.getX(ic) - uv.getX(ia);
      const dv2 = uv.getY(ic) - uv.getY(ia);
      const determinant = du1 * dv2 - dv1 * du2;
      assert(Math.abs(determinant) > 1e-10, `${mesh.name} triangle ${component / 3} collapsed UV chart`);
      const dPdu = [0, 1, 2].map((axis) => (ab[axis] * dv2 - ac[axis] * dv1) / determinant);
      const dPdv = [0, 1, 2].map((axis) => (-ab[axis] * du2 + ac[axis] * du1) / determinant);
      for (const vertex of [ia, ib, ic]) {
        const n = [normal.getX(vertex), normal.getY(vertex), normal.getZ(vertex)];
        const t = [tangent.getX(vertex), tangent.getY(vertex), tangent.getZ(vertex)];
        const bitangent = [
          n[1] * t[2] - n[2] * t[1],
          n[2] * t[0] - n[0] * t[2],
          n[0] * t[1] - n[1] * t[0],
        ];
        const expectedHandedness = Math.sign(bitangent[0] * dPdv[0] + bitangent[1] * dPdv[1] + bitangent[2] * dPdv[2]);
        assert.equal(Math.sign(tangent.getW(vertex)), expectedHandedness, `${mesh.name} tangent handedness`);
        const alignment = Math.abs(
          (t[0] * dPdu[0] + t[1] * dPdu[1] + t[2] * dPdu[2]) /
          (Math.hypot(...t) * Math.hypot(...dPdu)),
        );
        assert(alignment > 0.999, `${mesh.name} tangent is not aligned to UV dP/du`);
      }
    }
    const ranges = geometry.userData.moduleRanges;
    const coverage = new Uint8Array(geometry.index.count);
    for (const range of ranges) {
      for (let component = range.startIndex; component < range.startIndex + range.indexCount; component += 1) coverage[component] += 1;
    }
    assert(coverage.every((value) => value === 1), `${mesh.name} module range coverage`);
    checkedTriangles += geometry.index.count / 3;
    geometry.computeBoundingBox();
    geometry.computeBoundingSphere();
    assert(geometry.boundingBox && geometry.boundingSphere, `${mesh.name} bounds`);
  }
  assert(checkedTriangles > 0, "compiled geometry triangles checked");
}

for (const name of requiredFixtureNames) {
  const settings = FIXTURE_SETTINGS.find((fixture) => fixture.name === name);
  assert(settings, `missing fixture ${name}`);
  const plan = createBuildingPlan(settings);
  assert(plan.footprintPieces.length > 0, `${name} footprintPieces`);
  assert(plan.exposedEdges.length > 0, `${name} exposedEdges`);
  assert(plan.placements.length > 0, `${name} placements`);
  assert(plan.diagnostics, `${name} diagnostics`);
  assert.equal(validateDiagnosticsSchema(plan.diagnostics).ok, true, `${name} diagnostics schema`);

  const validation = validateBuildingPlan(plan);
  assert.equal(validation.ok, true, `${name}: ${validation.errors.join(", ")}`);
  const registry = validateModuleRegistry(plan);
  assert.equal(registry.ok, true, `${name} registry`);

  for (const placement of plan.placements.filter((item) => item.side !== "top")) {
    const edge = plan.exposedEdges.find((candidate) => candidate.id === placement.edgeId);
    assert(edge, `${name} placement edge`);
    assert(edgeContainsPlacement(edge, placement), `${name} placement on blocked/internal interval`);
  }

  const compiled = compileBuilding(plan, materials);
  assert(compiled.slotMeshes.length <= Object.keys(compiled.diagnostics.materialSlotCounts).length);
  assert(compiled.diagnostics.drawCalls <= 8, `${name} draw calls bounded by semantic material slots`);
  assert(Object.values(compiled.diagnostics.triangles).reduce((total, value) => total + value, 0) > 0);
  assert.equal(validateUvDensity(plan.placements).ok, true, `${name} UV density`);
  validateCompiledGeometry(compiled);
  assert(compiled.resourceDescription.resources.every((resource) => resource.bytes > 0), `${name} resource byte ledger`);
  assert.deepEqual(
    compiled.diagnostics.structuralClosureCompilation.map((entry) => entry.closureId).sort(),
    plan.structuralClosures.map((entry) => entry.id).sort(),
    `${name} structural closure IR consumed exactly once`,
  );
  for (const range of compiled.diagnostics.structuralClosureCompilation) {
    if (range.kind === "connector") assert.equal(range.indexCount, 0, `${range.closureId} interior union emits no hidden face`);
    else assert(range.indexCount > 0 && range.indexCount % 3 === 0, `${range.closureId} emits triangle-aligned closure geometry`);
  }

  if (name === "twin towers" || name === "twin towers with bridge") {
    assert(plan.diagnostics.roofOwners.length >= 2, `${name} multiple roof owners`);
  }

  const ledger = disposeCompiledBuilding(compiled);
  assert.equal(validateDisposalLedger(ledger).ok, true, `${name} disposal ledger reconciles`);
  assert.equal(ledger.geometryDisposeEvents, ledger.before.geometries, `${name} geometry dispose events`);
  assert.equal(ledger.remainingSceneChildren, 0, `${name} scene ownership released`);
  assert.equal(ledger.remainingOwnedResources, 0, `${name} owned-resource ledger released`);
  assert.equal(disposeCompiledBuilding(compiled).alreadyDisposed, true, `${name} idempotent disposal`);
  fixtureReports.push({ name, drawCalls: compiled.diagnostics.drawCalls, backendDrawItems: compiled.diagnostics.backendDrawItems, roofOwners: plan.diagnostics.roofOwners.length });
}

const seedSignatures = new Set();
for (let seed = 1; seed <= 128; seed += 1) {
  const first = createBuildingPlan({ name: `seed-${seed}`, footprint: seed % 4 === 0 ? "L" : "single", seed });
  const second = createBuildingPlan({ name: `seed-${seed}`, footprint: seed % 4 === 0 ? "L" : "single", seed });
  const signature = buildingPlanSignature(first);
  assert.equal(signature, buildingPlanSignature(second), `seed ${seed} deterministic`);
  assert.equal(validateBuildingPlan(first).ok, true, `seed ${seed} valid`);
  seedSignatures.add(signature);
}
assert(seedSignatures.size >= 96, `seed sweep variation ${seedSignatures.size}`);

const roofVariantTriangles = new Map();
for (const seed of [1, 3, 7]) {
  const variantPlan = createBuildingPlan({ name: `roof-variant-${seed}`, footprint: "single", seed });
  const variantCompiled = compileBuilding(variantPlan, materials);
  roofVariantTriangles.set(variantPlan.design.roofStyle, variantCompiled.diagnostics.triangles.roof);
  disposeCompiledBuilding(variantCompiled);
}
assert.deepEqual(
  [...roofVariantTriangles.keys()].sort(),
  ["flat-service", "pyramidal-metal", "statue-tower"],
  "roof-style sweep reaches every authored geometry variant",
);
assert.equal(new Set(roofVariantTriangles.values()).size, 3, "roof variants compile to distinct topology");

const batchedPlan = createBuildingPlan({ name: "batched-fixture", footprint: "single", seed: 73, qualityTier: "city" });
const batched = compileBuilding(batchedPlan, materials, { preferBatchedMesh: true, qualityTier: "city" });
assert(batched.slotMeshes.every((mesh) => mesh.isBatchedMesh), "actual BatchedMesh material slots");
assert(batched.diagnostics.backendDrawItems > batched.diagnostics.drawCalls, "r185 BatchedMesh backend entries reported separately");
assert(batched.resourceDescription.resources.every((resource) => resource.bytes > 0), "BatchedMesh resource ledger");
const batchedLedger = disposeCompiledBuilding(batched);
assert.equal(validateDisposalLedger(batchedLedger).ok, true, "BatchedMesh disposal ledger reconciles");
assert.equal(batchedLedger.batchedDisposeCalls, batchedLedger.before.batchedMeshes, "BatchedMesh dispose calls measured");
assert.equal(batchedLedger.remainingSceneChildren, 0, "BatchedMesh scene ownership released");

const missing = createBuildingPlan({ name: "missing-builder", footprint: "single", seed: 99 });
missing.placements[0].moduleId = "missingBuilder";
assert.equal(validateModuleRegistry(missing).ok, false, "missing-builder fixture fails before geometry emission");

const invalidSchema = { ...createBuildingPlan().diagnostics };
delete invalidSchema.exposedIntervals;
assert.equal(validateDiagnosticsSchema(invalidSchema).ok, false, "schema rejects missing required field");

const colorSpaces = validateMaterialColorSpaces();
assert.equal(colorSpaces.ok, true, "color-space assignments");
const materialBindings = validateMaterialBindings(materials);
assert.equal(materialBindings.ok, true, materialBindings.errors.join(", "));
assert(materials.limestone.colorNode && materials.limestone.normalNode, "limestone samples bound albedo and normal textures");

const chunk = compileCityChunk({ materials, fixtureNames: ["single tower", "compound L", "glass-heavy facade"] });
assert(chunk.drawCalls > 0, "chunk draw-call count");
assert(chunk.triangles > 0, "chunk triangle count");
assert(chunk.slots.length > 0, "chunk slots");
assert("cacheHitCounts" in chunk, "chunk cache-hit counts");
assert.equal(chunk.lodTier, "city", "chunk LOD-tier");
const culling = chunk.cullByRadius(chunk.bounds.min, 8);
assert(culling.culledChunks > 0, "chunk culling removes distant chunks");
assert.equal(validateChunkCulling(chunk.chunks, culling).ok, true, "culling reconciles with live visibility");
assert.equal(
  chunk.chunks.filter((entry) => entry.root.visible).length,
  culling.visibleChunks,
  "chunk culling mutates submitted scene visibility",
);
assert.deepEqual(
  chunk.chunks.filter((entry) => entry.root.visible).map((entry) => entry.id),
  culling.visibleChunkIds,
  "culling report is derived from live visibility",
);
assert.equal(
  culling.submittedDrawItems,
  chunk.chunks.filter((entry) => entry.root.visible).reduce((sum, entry) => sum + entry.drawItems, 0),
  "submitted draw items reconcile with visible chunks",
);
const resetCulling = chunk.resetCulling();
assert.equal(resetCulling.visibleChunks, chunk.chunks.length, "reset restores all chunk submissions");
assert(chunk.chunks.every((entry) => entry.root.visible), "reset restores every chunk root visibility");
chunk.dispose();

console.log(JSON.stringify({
  fixtures: fixtureReports,
  chunk: {
    lodTier: chunk.lodTier,
    drawCalls: chunk.drawCalls,
    triangles: chunk.triangles,
    slots: chunk.slots,
    bounds: chunk.bounds,
    cacheHitCounts: chunk.cacheHitCounts,
    seedVariants: seedSignatures.size,
  },
}, null, 2));
