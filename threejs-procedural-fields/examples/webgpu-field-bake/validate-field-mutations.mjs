import assert from "node:assert/strict";

import { FIELD_ALGORITHM, sampleFieldCPU, tangentWarp } from "./field-bundle.mjs";
import {
  enforceLockedRouteSelection,
  validateDisplaySubmissionCount,
  validateStorageEvidenceContract,
  validateTierResourceDescription,
} from "./route-contract.mjs";
import {
  alignedReadbackLayout,
  buildDirtyDispatchTrace,
  createDirtyTileTracker,
  createStructuredPlacementResources,
  fieldMipExtents,
  propagateDirtyRegion,
  validateRegionWithinExtent,
} from "./field-bake.mjs";

function expectFailure(label, callback) {
  let failed = false;
  try {
    callback();
  } catch {
    failed = true;
  }
  assert(failed, `${label} mutation was not detected`);
}

expectFailure("out-of-range dirty tile", () => {
  createDirtyTileTracker({ tilesX: 4, tilesY: 4 }).invalidate(4, 0);
});
expectFailure("out-of-bounds-dirty-region", () => {
  validateRegionWithinExtent({ x: 635, y: 350, width: 17, height: 13 }, 641, 359);
});

expectFailure("fractional padded stride", () => {
  alignedReadbackLayout({
    width: 641,
    height: 359,
    bytesPerTexel: 8,
    bytesPerElement: 2,
    elementLength: Math.floor((641 * 4.1) * 359),
  });
});

const extents = fieldMipExtents(641, 359);
const propagated = propagateDirtyRegion({ x: 3, y: 5, width: 17, height: 13 }, extents);
const staleMipMutation = propagated.map((region, level) => level === 0 ? region : { ...region, width: 0, height: 0 });
assert(
  staleMipMutation.slice(1).some((region, level) => (
    region.width !== propagated[level + 1].width || region.height !== propagated[level + 1].height
  )),
  "dirty-mip omission mutation was not detected",
);
const localTrace = buildDirtyDispatchTrace({ x: 3, y: 5, width: 17, height: 13 }, extents);
expectFailure("dirty-update-expanded-to-full-mips", () => {
  const mutatedTrace = localTrace.map((entry, level) => level === 0 ? entry : {
    ...entry,
    outputRegion: { x: 0, y: 0, ...extents[level] },
    invocationCount: extents[level].width * extents[level].height,
  });
  assert.deepEqual(mutatedTrace, localTrace);
});

let accepted = 0;
let rejected = 0;
let legacyAccepted = 0;
for (let y = 0; y < 64; y += 1) {
  for (let x = 0; x < 64; x += 1) {
    const sample = sampleFieldCPU({
      domain: "object",
      coordinate: [-4 + x * (8 / 63), 0.37, -4 + y * (8 / 63)],
      seed: FIELD_ALGORITHM.defaultSeed,
    });
    if (sample.placementMask >= 0.5) accepted += 1;
    else rejected += 1;
    const legacyMask = sample.biome >= 0.45 && sample.slope <= 0.7;
    if (legacyMask) legacyAccepted += 1;
  }
}
assert(accepted > 0 && rejected > 0, "canonical placement must contain both classes");
assert(legacyAccepted !== accepted, "legacy placement-threshold mutation was not detected");
const compactedPlacement = createStructuredPlacementResources({ columns: 64, rows: 64 });
assert.equal(compactedPlacement.records.count, compactedPlacement.acceptedCount);
expectFailure("retained-rejected-placement-records", () => {
  assert.equal(compactedPlacement.cellCount, compactedPlacement.acceptedCount);
});
compactedPlacement.records.dispose?.();
compactedPlacement.acceptedIndices.dispose?.();
expectFailure("direct-tier-retained-storage", () => {
  validateTierResourceDescription("gpu-direct-evaluate", {
    tier: "gpu-direct-evaluate",
    textures: 1,
    storageBuffers: 1,
    storageBytes: 4096,
  });
});
expectFailure("precomputed-tier-retained-runtime-bake", () => {
  validateTierResourceDescription("precomputed-minimum", {
    tier: "precomputed-minimum",
    precomputedTextures: 1,
    storageBuffers: 1,
    storageBytes: 4096,
  });
});
expectFailure("false-filtered-consumer-promotion", () => {
  validateStorageEvidenceContract({
    filteredConsumerValidated: true,
    filteredMipReadbackValidated: false,
  });
});
expectFailure("display-scene-count-drift", () => {
  validateDisplaySubmissionCount({ sceneSubmissionCount: 1 });
});
expectFailure("mechanism-route-lock-bypass", () => {
  enforceLockedRouteSelection(
    { kind: "mechanism", id: "domain-warp-jacobian" },
    "mechanism",
    "structured-placement",
  );
});
expectFailure("tier-route-lock-bypass", () => {
  enforceLockedRouteSelection(
    { kind: "tier", id: "gpu-direct-evaluate" },
    "tier",
    "gpu-storage",
  );
});

const coordinate = [0.83, 0.61, 0.42];
const sample = sampleFieldCPU({ domain: "sphere", coordinate, seed: 17 });
const epsilon = 1e-5;
let omittedJacobianError = 0;
for (let axis = 0; axis < 3; axis += 1) {
  const positive = [...sample.sourceCoordinates];
  const negative = [...sample.sourceCoordinates];
  positive[axis] += epsilon;
  negative[axis] -= epsilon;
  const finiteDifference = tangentWarp(positive, 17).map(
    (value, component) => (value - tangentWarp(negative, 17)[component]) / (2 * epsilon),
  );
  omittedJacobianError = Math.max(
    omittedJacobianError,
    ...finiteDifference.map((value) => Math.abs(value)),
  );
}
assert(omittedJacobianError > 1e-3, "omitted warp-Jacobian mutation was not observable");

function centralDifferenceMacroGradient(probe) {
  return [0, 1, 2].map((axis) => {
    const positive = { ...probe, coordinate: [...probe.coordinate] };
    const negative = { ...probe, coordinate: [...probe.coordinate] };
    positive.coordinate[axis] += epsilon;
    negative.coordinate[axis] -= epsilon;
    return (
      sampleFieldCPU(positive).macroHeight - sampleFieldCPU(negative).macroHeight
    ) / (2 * epsilon);
  });
}

function requireGradientMatch(probe, candidate, tolerance = 2e-4) {
  const reference = centralDifferenceMacroGradient(probe);
  const error = Math.max(...candidate.map((value, axis) => Math.abs(value - reference[axis])));
  assert(error <= tolerance, `${probe.domain} gradient error ${error} exceeded ${tolerance}`);
}

const worldProbe = { domain: "world", coordinate: [12.5, -4, 8.25], seed: 29 };
const worldSample = sampleFieldCPU(worldProbe);
requireGradientMatch(worldProbe, worldSample.macroGradient);
expectFailure("omitted-world-input-scale", () => {
  // This is the old result: dh/d(stableCoordinate), with ds/dx = 0.125 I omitted.
  requireGradientMatch(worldProbe, worldSample.stableMacroGradient);
});

const sphereProbe = { domain: "sphere", coordinate: [2.49, 1.83, 1.26], seed: 17 };
const sphereSample = sampleFieldCPU(sphereProbe);
requireGradientMatch(sphereProbe, sphereSample.macroGradient);
expectFailure("omitted-sphere-normalization-jacobian", () => {
  // This is the old result: dh/ds reported as dh/dx without (I - rr^T)/|x|.
  requireGradientMatch(sphereProbe, sphereSample.stableMacroGradient);
});

const radialLength = Math.hypot(...sphereProbe.coordinate);
const radial = sphereProbe.coordinate.map((component) => component / radialLength);
const radialDerivative = sphereSample.macroGradient.reduce(
  (sum, component, axis) => sum + component * radial[axis],
  0,
);
assert(Math.abs(radialDerivative) <= 2e-10, "sphere gradient must be tangent");
assert.equal(
  sphereSample.slope,
  Math.min(1, Math.hypot(...sphereSample.macroGradient) * FIELD_ALGORITHM.derived.slopeScale),
  "slope must derive from the original-domain gradient",
);

console.log(JSON.stringify({
  pass: true,
  mutations: [
    "out-of-range-dirty-tile",
    "out-of-bounds-dirty-region",
    "fractional-padded-stride",
    "dirty-mip-omission",
    "dirty-update-expanded-to-full-mips",
    "legacy-one-class-placement",
    "retained-rejected-placement-records",
    "direct-tier-retained-storage",
    "precomputed-tier-retained-runtime-bake",
    "false-filtered-consumer-promotion",
    "display-scene-count-drift",
    "mechanism-route-lock-bypass",
    "tier-route-lock-bypass",
    "omitted-warp-jacobian",
    "omitted-world-input-scale",
    "omitted-sphere-normalization-jacobian",
  ],
}, null, 2));
