import assert from "node:assert/strict";

import { createPlanetAtmosphereHandoff } from "./integration-adapter.js";
import { createPatchBoundsCompute } from "./patch-compute.js";
import { createPlanetFieldAtlas } from "./planet-field-atlas.js";
import { createPlanetPatchMesh, createPlanetRuntimeConfiguration } from "./planet-mesh.js";
import {
  assertAdjacentLevelDelta,
  createPatch,
  createRootPatches,
  createVertexMorphStencil,
  selectPlanetQuadtreeFrontier,
  splitPatch,
  validateLeafCoverage,
} from "./planet-quadtree.js";
import { assertPlanetDpr } from "./planet-tiers.js";
import { enforcePlanetRouteLocks, resolvePlanetRoute } from "./route-contract.js";

const detected = [];
function mutation(id, action) {
  action();
  detected.push(id);
}

mutation("missing-cube-face", () => {
  const missingFace = createRootPatches().slice(1);
  assert.equal(validateLeafCoverage(missingFace).ok, false);
});

mutation("unbalanced-cross-face-frontier", () => {
  let patches = createRootPatches();
  for (let depth = 0; depth < 3; depth += 1) {
    const target = depth === 0
      ? patches.find((patch) => patch.face === 4 && patch.level === 0)
      : patches.find((patch) => patch.face === 4 && patch.level === depth && patch.x === 0 && patch.y === 0);
    patches = [...patches.filter((patch) => patch.id !== target.id), ...splitPatch(target)];
  }
  assert.equal(assertAdjacentLevelDelta(patches).ok, false);
});

mutation("invalid-morph-weight-sum", () => {
  const patch = createPatch({ face: 4, level: 2, x: 0, y: 0 });
  patch.transitionEdges.north = true;
  const stencil = createVertexMorphStencil({ x: 3, y: 16, gridSide: 17, patch });
  const corrupted = [...stencil.weights];
  corrupted[0] += 0.125;
  assert.throws(() => assert(Math.abs(corrupted.reduce((sum, value) => sum + value, 0) - 1) < 1e-12));
});

mutation("frontier-budget-overflow", () => {
  assert.throws(() => selectPlanetQuadtreeFrontier({
    cameraPositionBody: [0, 0, 13000],
    verticalFovRadians: 42 * Math.PI / 180,
    renderTargetHeightPx: 800,
    cameraNear: 1,
    radiusWorld: 12000,
    maximumDisplacementWorld: 216,
    maximumSurfaceSlope: 4,
    gridSide: 17,
    splitThreshold: 9,
    mergeThreshold: 5,
    minLevel: 1,
    maxLevel: 6,
    maxLeafPatches: 6,
  }), /maxLeafPatches/);
});

mutation("tier-dpr-overrun", () => {
  assert.throws(() => assertPlanetDpr("reduced-webgpu", 1.5), /exceeds locked/);
});

mutation("locked-route-override", () => {
  const route = resolvePlanetRoute("http://127.0.0.1/demos/webgpu-quadtree-planet/?scenario=solid-body-material");
  assert.throws(() => enforcePlanetRouteLocks(route, {
    lockedScenario: "gas-and-ice-giants",
  }), /conflicts with locked scenario/);
});

const roots = createRootPatches();
const atlas = createPlanetFieldAtlas({ patches: roots, tileSide: 17 });
mutation("unknown-dirty-patch", () => {
  assert.throws(() => atlas.markDirtyPatchIds(["face99:level0:x0:y0"]), /unknown dirty planet patch/);
});

mutation("mip-source-index-out-of-range", () => {
  const level = atlas.levels[1];
  const previousCount = roots.length * atlas.levels[0].texelsPerPatch;
  const original = level.mappingBuffer.array[0];
  level.mappingBuffer.array[0] = previousCount;
  const mappingIsValid = level.mappingBuffer.array.every((value) => value < previousCount);
  assert.equal(mappingIsValid, false);
  level.mappingBuffer.array[0] = original;
});

mutation("atlas-frontier-order-drift", () => {
  assert.throws(() => createPlanetPatchMesh({
    tier: "balanced",
    patches: [...roots].reverse(),
    atlas,
  }), /same ordered patch frontier/);
});

const runtime = createPlanetRuntimeConfiguration({ worldUnitsPerMeter: 0.001 });
mutation("zero-body-orientation", () => {
  assert.throws(() => createPlanetAtmosphereHandoff({
    config: runtime.config,
    worldUnitsPerMeter: runtime.worldUnitsPerMeter,
    bodyFrame: { orientationWorldFromBody: [0, 0, 0, 0] },
  }), /quaternion must be nonzero/);
});

mutation("unit-scale-mismatch", () => {
  const handoff = createPlanetAtmosphereHandoff({
    config: runtime.config,
    worldUnitsPerMeter: runtime.worldUnitsPerMeter,
  });
  const corruptedSurfaceRadiusWorld = handoff.surfaceRadiusMeters;
  assert.throws(() => assert.equal(corruptedSurfaceRadiusWorld, handoff.surfaceRadiusWorld));
});

mutation("invalid-patch-compute-radius", () => {
  assert.throws(() => createPatchBoundsCompute({
    patches: roots,
    radiusWorld: 0,
    maximumDisplacementWorld: 1,
    maximumSurfaceSlope: 4,
    gridSide: 17,
  }), /invalid patch bounds/);
});

atlas.dispose();

console.log(JSON.stringify({ pass: true, detected }, null, 2));
