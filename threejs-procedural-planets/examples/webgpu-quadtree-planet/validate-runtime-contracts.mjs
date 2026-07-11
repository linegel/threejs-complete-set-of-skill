import assert from "node:assert/strict";

import { createPlanetAtmosphereHandoff } from "./integration-adapter.js";
import { createPatchBoundsCompute } from "./patch-compute.js";
import { createPlanetFieldAtlas } from "./planet-field-atlas.js";
import {
  PLANET_TIER_CONFIG,
  createPlanetNodeMaterial,
  createPlanetPatchGeometry,
  createPlanetRuntimeConfiguration,
  createPlanetRuntimeFrontier,
  disposePlanetPatchMesh,
  sampleGasBandCPU,
  setPlanetMaterialMode,
  createPlanetPatchMesh,
} from "./planet-mesh.js";
import { planetFields } from "./planet-fields.js";
import {
  FACE_AXES,
  annotateNeighborLevels,
  assertAdjacentLevelDelta,
  computePatchMorphFactor,
  createConservativePatchBounds,
  createPatch,
  createRootPatches,
  createTransitionIndexVariants,
  createVertexMorphStencil,
  isPatchPotentiallyVisible,
  patchSurfaceDirection,
  projectPatchErrorPixels,
  validateLeafCoverage,
  validateReciprocalAdjacency,
} from "./planet-quadtree.js";

const close = createPlanetRuntimeFrontier({
  tier: "balanced",
  cameraPositionBody: [0, 0, 12250],
});
const far = createPlanetRuntimeFrontier({
  tier: "balanced",
  cameraPositionBody: [0, 0, 70000],
});
for (const runtime of [close, far]) {
  assert.equal(validateLeafCoverage(runtime.patches).ok, true);
  assert.equal(assertAdjacentLevelDelta(runtime.patches).ok, true);
  assert.equal(validateReciprocalAdjacency(runtime.patches).ok, true);
  assert.deepEqual(
    [...new Set(runtime.patches.map((patch) => patch.face))].sort((a, b) => a - b),
    FACE_AXES.map((_, face) => face),
  );
  for (const patch of runtime.patches) {
    if (patch.screenError > runtime.tierConfig.splitPixelError) {
      assert.equal(
        patch.level,
        runtime.tierConfig.maxLevel,
        `${patch.id} exceeds split error before max level`,
      );
    }
  }
}
assert(
  Math.max(...close.patches.map((patch) => patch.level)) >
    Math.max(...far.patches.map((patch) => patch.level)),
  "close approach must select a finer maximum level than distant orbit",
);

const fixedPatch = createPatch({ face: 4, level: 2, x: 1, y: 1 });
const fixedBounds = createConservativePatchBounds(fixedPatch, {
  radiusWorld: 12000,
  maximumDisplacementWorld: 216,
  maximumSurfaceSlope: 4,
  gridSide: 17,
});
for (const u of [0, 0.25, 0.5, 0.75, 1]) {
  for (const v of [0, 0.25, 0.5, 0.75, 1]) {
    const direction = patchSurfaceDirection(fixedPatch, u, v);
    for (const radius of [fixedBounds.minimumRadiusWorld, fixedBounds.maximumRadiusWorld]) {
      const point = direction.map((value) => value * radius);
      const distance = Math.hypot(
        point[0] - fixedBounds.centerWorld[0],
        point[1] - fixedBounds.centerWorld[1],
        point[2] - fixedBounds.centerWorld[2],
      );
      assert(distance <= fixedBounds.boundingSphereRadiusWorld + 1e-9);
    }
  }
}
const nearError = projectPatchErrorPixels(fixedBounds, {
  cameraPositionBody: [0, 0, 15000],
  verticalFovRadians: 42 * Math.PI / 180,
  renderTargetHeightPx: 800,
  cameraNear: 1,
});
const distantError = projectPatchErrorPixels(fixedBounds, {
  cameraPositionBody: [0, 0, 80000],
  verticalFovRadians: 42 * Math.PI / 180,
  renderTargetHeightPx: 800,
  cameraNear: 1,
});
assert(nearError > distantError);
assert.equal(isPatchPotentiallyVisible(fixedBounds, [0, 0, 80000]), true);
assert.equal(computePatchMorphFactor(9, {
  splitThreshold: 9,
  mergeThreshold: 5,
  level: 2,
}), 0);
assert.equal(computePatchMorphFactor(5, {
  splitThreshold: 9,
  mergeThreshold: 5,
  level: 2,
}), 1);

const transitionPatch = createPatch({ face: 4, level: 2, x: 1, y: 1 });
transitionPatch.transitionEdges.north = true;
const transitionStencil = createVertexMorphStencil({
  x: 3,
  y: 16,
  gridSide: 17,
  patch: transitionPatch,
});
assert.equal(transitionStencil.transitionWeight, 1);
assert(Math.abs(transitionStencil.weights.reduce((sum, value) => sum + value, 0) - 1) < 1e-12);
const interiorStencil = createVertexMorphStencil({
  x: 7,
  y: 9,
  gridSide: 17,
  patch: transitionPatch,
});
assert.equal(interiorStencil.transitionWeight, 0);
assert(Math.abs(interiorStencil.weights.reduce((sum, value) => sum + value, 0) - 1) < 1e-12);

const variants = createTransitionIndexVariants(17);
assert.equal(variants.length, 16);
for (const [mask, indices] of variants.entries()) {
  assert(indices.length > 0, `transition mask ${mask} is empty`);
  assert.equal(indices.length % 3, 0, `transition mask ${mask} is not triangles`);
  assert(Math.max(...indices) < 17 * 17, `transition mask ${mask} index overflow`);
}

const roots = annotateNeighborLevels(createRootPatches());
const atlas = createPlanetFieldAtlas({ patches: roots, tileSide: 17 });
const atlasDescriptionBefore = atlas.describe();
assert.equal(atlasDescriptionBefore.kind, "consumed-storage-field-atlas");
assert.equal(atlasDescriptionBefore.cacheStatus, "patch-resident-storage-atlas");
assert.equal(atlasDescriptionBefore.gutter, 4);
assert(atlasDescriptionBefore.mipCount >= 2);
assert(atlasDescriptionBefore.byteLength > 0);
for (let patchIndex = 0; patchIndex < roots.length; patchIndex += 1) {
  for (const [x, y] of [[0, 0], [8, 8], [16, 16]]) {
    const index = atlas.indexFor(patchIndex, x, y, 0);
    assert(index >= patchIndex * atlas.levels[0].texelsPerPatch);
    assert(index < (patchIndex + 1) * atlas.levels[0].texelsPerPatch);
  }
}

const computedNodes = [];
const fakeRenderer = {
  backend: { isWebGPUBackend: true },
  compute(node) { computedNodes.push(node); },
};
const fullDispatch = atlas.dispatch(fakeRenderer, { patchIds: null });
assert.equal(fullDispatch.dirtyPatchCount, roots.length);
assert.equal(fullDispatch.nodes.length, atlas.levels.length * 3);
assert(fullDispatch.nodes.every((node) => node.isComputeNode && node.count > 0));
assert.equal(atlas.dispatch(fakeRenderer).nodes.length, 0, "clean atlas must not redispatch");
atlas.markDirtyPatchIds([roots[2].id]);
const dirtyDispatch = atlas.dispatch(fakeRenderer);
assert.equal(dirtyDispatch.dirtyPatchCount, 1);
assert.equal(dirtyDispatch.nodes[0].count, atlas.levels[0].texelsPerPatch);
assert.throws(() => atlas.markDirtyPatchIds(["not-a-patch"]), /unknown dirty planet patch/);

const geometry = createPlanetPatchGeometry({
  patches: roots,
  gridSide: 17,
  atlas,
  radiusWorld: 12000,
  maximumDisplacementWorld: 216,
});
assert.equal(geometry.userData.planetPatchContract.drawCount, roots.length);
assert.equal(geometry.userData.planetPatchContract.groupCount, roots.length);
assert.equal(geometry.userData.planetPatchContract.atlasConsumed, true);
assert.equal(geometry.groups.length, roots.length);
assert.equal(geometry.boundingSphere.radius, 12216);

const material = createPlanetNodeMaterial({ atlas });
assert.equal(material.isNodeMaterial, true);
assert.equal(material.userData.fieldAtlasConsumed, true);
assert(material.positionNode && material.normalNode && material.colorNode && material.emissiveNode);
const mesh = createPlanetPatchMesh({ tier: "balanced", patches: roots, atlas });
assert.equal(mesh.userData.resources.drawCount, roots.length);
assert.equal(mesh.material.length, roots.length);
setPlanetMaterialMode(mesh, { bodyMode: "gas-giant" });
const gasModeValue = mesh.userData.primaryMaterial.userData.planetUniforms.bodyMode.value;
setPlanetMaterialMode(mesh, { bodyMode: "ice-giant" });
const iceModeValue = mesh.userData.primaryMaterial.userData.planetUniforms.bodyMode.value;
assert.notEqual(gasModeValue, iceModeValue, "gas and ice body modes must be independently live");
assert.throws(() => setPlanetMaterialMode(mesh, { mode: "no-such-mode" }));
assert.throws(() => setPlanetMaterialMode(mesh, { bodyMode: "no-such-body" }));

const runtime = createPlanetRuntimeConfiguration({ tier: "balanced", worldUnitsPerMeter: 0.001 });
const patchCompute = createPatchBoundsCompute({
  patches: roots,
  radiusWorld: runtime.radiusWorld,
  maximumDisplacementWorld: runtime.maximumDisplacementWorld,
  maximumSurfaceSlope: PLANET_TIER_CONFIG.balanced.maximumSurfaceSlope,
  gridSide: PLANET_TIER_CONFIG.balanced.gridSide,
});
assert(patchCompute.kernel.isComputeNode);
assert.equal(patchCompute.kernel.count, roots.length);
patchCompute.dispatch(fakeRenderer);
assert.equal(patchCompute.describe().dispatchCount, 1);
assert(patchCompute.describe().inputBytes > 0 && patchCompute.describe().outputBytes > 0);

const handoff = createPlanetAtmosphereHandoff({
  config: runtime.config,
  worldUnitsPerMeter: runtime.worldUnitsPerMeter,
  bodyFrame: { centerWorld: [10, 20, 30], orientationWorldFromBody: [0, 0, 0, 1] },
});
assert.equal(handoff.surfaceRadiusMeters, 12_000_000);
assert.equal(handoff.surfaceRadiusWorld, 12_000);
assert.equal(handoff.atmosphereTopRadiusWorld, 12_200);
assert.equal(handoff.altitudeMetersAtWorld([10, 20, 12_030]), 0);
assert.deepEqual(handoff.worldToEcefMeters([10, 20, 12_030]), [0, 0, 12_000_000]);
assert.deepEqual(handoff.upAtWorld([10, 20, 12_030]), [0, 0, 1]);

let finiteSamples = 0;
for (let index = 0; index < 1024; index += 1) {
  const y = ((index + 0.5) / 1024) * 2 - 1;
  const angle = index * 2.399963229728653;
  const radial = Math.sqrt(Math.max(0, 1 - y * y));
  const direction = [radial * Math.cos(angle), y, radial * Math.sin(angle)];
  const fields = planetFields(direction);
  for (const value of [
    fields.height,
    fields.heightDerivativeCandidate[0],
    fields.heightDerivativeCandidate[1],
    fields.humidity,
    fields.temperature,
    fields.oceanDepth,
  ]) assert(Number.isFinite(value));
  assert(fields.humidity >= 0 && fields.humidity <= 1);
  assert(fields.temperature >= 0 && fields.temperature <= 1);
  assert(fields.oceanDepth >= 0 && fields.oceanDepth <= 1);
  finiteSamples += 1;
}

const epsilon = 1e-8;
const seamA = sampleGasBandCPU([-1, 0.17, epsilon], 7.25);
const seamB = sampleGasBandCPU([-1, 0.17, -epsilon], 7.25);
assert(Math.abs(seamA - seamB) < 1e-6);

patchCompute.dispose();
disposePlanetPatchMesh(mesh);
geometry.dispose();
material.dispose();
// `mesh` owns the material and geometry. The atlas remains a separate runtime
// resource and is disposed exactly once here.
atlas.dispose();

console.log(JSON.stringify({
  pass: true,
  frontiers: {
    close: { patchCount: close.patches.length, maxLevel: Math.max(...close.patches.map((p) => p.level)) },
    far: { patchCount: far.patches.length, maxLevel: Math.max(...far.patches.map((p) => p.level)) },
  },
  projectedError: { nearError, distantError },
  atlas: atlasDescriptionBefore,
  computeNodeCount: computedNodes.length,
  fieldSamples: finiteSamples,
  gasLongitudeSeamError: Math.abs(seamA - seamB),
  evidenceBoundary: "browser-free numeric/runtime graph checks; native-WebGPU capture remains incomplete",
}, null, 2));
