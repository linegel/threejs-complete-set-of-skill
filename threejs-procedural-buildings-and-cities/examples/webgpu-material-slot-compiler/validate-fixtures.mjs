import assert from "node:assert/strict";

import { createBuildingPlan, FIXTURE_SETTINGS, validateBuildingPlan } from "./building-plan.js";
import { compileCityChunk } from "./chunking.js";
import { compileBuilding, disposeCompiledBuilding } from "./compiler.js";
import { validateDiagnosticsSchema } from "./diagnostics.js";
import { edgeContainsPlacement } from "./exposed-edges.js";
import { createBuildingNodeMaterials, validateMaterialColorSpaces } from "./materials.js";
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

  if (name === "twin towers" || name === "twin towers with bridge") {
    assert(plan.diagnostics.roofOwners.length >= 2, `${name} multiple roof owners`);
  }

  const ledger = disposeCompiledBuilding(compiled);
  assert.equal(ledger.geometries, 0, `${name} dispose ledger`);
  fixtureReports.push({ name, drawCalls: compiled.diagnostics.drawCalls, roofOwners: plan.diagnostics.roofOwners.length });
}

const missing = createBuildingPlan({ name: "missing-builder", footprint: "single", seed: 99 });
missing.placements[0].moduleId = "missingBuilder";
assert.equal(validateModuleRegistry(missing).ok, false, "missing-builder fixture fails before geometry emission");

const invalidSchema = { ...createBuildingPlan().diagnostics };
delete invalidSchema.exposedIntervals;
assert.equal(validateDiagnosticsSchema(invalidSchema).ok, false, "schema rejects missing required field");

const colorSpaces = validateMaterialColorSpaces();
assert.equal(colorSpaces.ok, true, "color-space assignments");

const chunk = compileCityChunk({ materials, fixtureNames: ["single tower", "compound L", "glass-heavy facade"] });
assert(chunk.drawCalls > 0, "chunk draw-call count");
assert(chunk.triangles > 0, "chunk triangle count");
assert(chunk.slots.length > 0, "chunk slots");
assert("cacheHitCounts" in chunk, "chunk cache-hit counts");
assert.equal(chunk.lodTier, "city", "chunk LOD-tier");

console.log(JSON.stringify({
  fixtures: fixtureReports,
  chunk: {
    lodTier: chunk.lodTier,
    drawCalls: chunk.drawCalls,
    triangles: chunk.triangles,
    slots: chunk.slots,
    bounds: chunk.bounds,
    cacheHitCounts: chunk.cacheHitCounts,
  },
}, null, 2));
