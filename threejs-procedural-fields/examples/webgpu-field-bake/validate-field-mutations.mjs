import assert from "node:assert/strict";

import { uint, vec3 } from "three/tsl";

import {
  FIELD_ALGORITHM,
  createFieldCauseBindings,
  createFieldNodeBundle,
  sampleFieldF32CPU,
  sampleFieldCPU,
  tangentWarp,
  validateFieldCauseBindings,
  validateWarpFreeFieldNodeBundle,
} from "./field-bundle.mjs";
import { validateCaptureArtifactPathContract } from "./capture.mjs";
import {
  enforceLockedRouteSelection,
  validateDisplaySubmissionCount,
  validateStorageEvidenceContract,
  validateTierResourceDescription,
} from "./route-contract.mjs";
import {
  alignedReadbackLayout,
  buildDirtyDispatchTrace,
  compareFieldStorageMutation,
  createFieldBakeResources,
  createDirtyTileTracker,
  createFieldResourceLedger,
  createScopedFieldResourceLedger,
  createStructuredPlacementResources,
  fieldMipExtents,
  propagateDirtyRegion,
  validateFieldDispatchTrace,
  validateFieldResourceLedger,
  validateRegionWithinExtent,
  validateFieldStorageConfinement,
  validatePlacementReadbackSeparation,
} from "./field-bake.mjs";
import {
  analyzeFieldMechanismRgba,
  validateFieldMechanismStatistics,
  validateReportedFieldMechanismStatistics,
} from "./mechanism-evidence.mjs";
import {
  FIELD_PROBE_CORPUS,
  validateFieldProbeOracleIdentity,
} from "./field-probe-corpus.mjs";

function expectFailure(label, callback) {
  let failed = false;
  try {
    callback();
  } catch {
    failed = true;
  }
  assert(failed, `${label} mutation was not detected`);
}

const oracleIdentity = {
  nodeVersion: "22.22.0",
  inputSha256: FIELD_PROBE_CORPUS.expectedSha256,
  cpuOracleSha256: FIELD_PROBE_CORPUS.expectedCpuOracleSha256,
};
validateFieldProbeOracleIdentity(oracleIdentity);
expectFailure("unpinned-f32-oracle-runtime", () => {
  validateFieldProbeOracleIdentity({ ...oracleIdentity, nodeVersion: "26.4.0" });
});
expectFailure("forged-f32-oracle-hash", () => {
  validateFieldProbeOracleIdentity({ ...oracleIdentity, cpuOracleSha256: "0".repeat(64) });
});

for (const domain of ["object", "world"]) {
  const origin = sampleFieldF32CPU({ domain, coordinate: [0, 0, 0], seed: 17 });
  assert.equal(origin.warpMode, "disabled");
  assert.deepEqual(origin.tangentWarp, [0, 0, 0]);
  assert(origin.macroGradient.every(Number.isFinite));
}
const warpFreeOriginBundle = createFieldNodeBundle({
  coordinate: vec3(0),
  seed: uint(17),
  warpEnabled: false,
  varPrefix: "mutationWarpFreeOrigin",
});
validateWarpFreeFieldNodeBundle(warpFreeOriginBundle);
expectFailure("origin-routed-through-warp-graph", () => {
  validateWarpFreeFieldNodeBundle(createFieldNodeBundle({
    coordinate: vec3(0),
    seed: uint(17),
    warpEnabled: true,
    varPrefix: "mutationWarpedOrigin",
  }));
});

validateCaptureArtifactPathContract(
  "/tmp/webgpu-field-bake/correctness",
  "/tmp/webgpu-field-bake/correctness",
);
expectFailure("capture-validator-path-divergence", () => {
  validateCaptureArtifactPathContract(
    "/tmp/webgpu-field-bake/correctness",
    "/tmp/webgpu-field-bake/legacy-artifacts",
  );
});

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
expectFailure("forged-dirty-workgroup-count", () => {
  const mutatedTrace = localTrace.map((entry, index) => index === 0 ? {
    ...entry,
    workgroupCount: [entry.workgroupCount[0] + 1, 1, 1],
  } : entry);
  validateFieldDispatchTrace(
    mutatedTrace,
    { x: 3, y: 5, width: 17, height: 13 },
    extents,
  );
});

const beforeStorage = new Uint16Array(4 * 4 * 4);
const insideStorage = new Uint16Array(beforeStorage);
insideStorage[(1 * 4 + 1) * 4] = 1;
const confinedComparison = compareFieldStorageMutation({
  before: beforeStorage,
  after: insideStorage,
  width: 4,
  height: 4,
  allowedRegion: { x: 1, y: 1, width: 2, height: 2 },
});
assert.equal(validateFieldStorageConfinement(confinedComparison), confinedComparison);
const escapedStorage = new Uint16Array(insideStorage);
escapedStorage[0] = 1;
expectFailure("dirty-write-escaped-region", () => {
  validateFieldStorageConfinement(compareFieldStorageMutation({
    before: beforeStorage,
    after: escapedStorage,
    width: 4,
    height: 4,
    allowedRegion: { x: 1, y: 1, width: 2, height: 2 },
  }));
});
expectFailure("dirty-write-did-no-work", () => {
  validateFieldStorageConfinement(compareFieldStorageMutation({
    before: beforeStorage,
    after: beforeStorage,
    width: 4,
    height: 4,
    allowedRegion: { x: 1, y: 1, width: 2, height: 2 },
  }));
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
const validPlacementEvidence = {
  accepted: 2,
  acceptedIndices: [7, 19],
  rawGpuRecords: [[-1, 2, 0.75, 1], [3, -4, 0.9, 1]],
  decodedRecords: [
    { outputIndex: 0, cpuAcceptedCellIndex: 7, gpu: [-1, 2, 0.75, 1] },
    { outputIndex: 1, cpuAcceptedCellIndex: 19, gpu: [3, -4, 0.9, 1] },
  ],
  minRawGpuW: 1,
  maxRawGpuW: 1,
};
validatePlacementReadbackSeparation(validPlacementEvidence);
expectFailure("placement-w-overwritten-by-cpu-index", () => {
  const forged = structuredClone(validPlacementEvidence);
  forged.rawGpuRecords[0][3] = forged.acceptedIndices[0];
  forged.decodedRecords[0].gpu[3] = forged.acceptedIndices[0];
  forged.maxRawGpuW = forged.acceptedIndices[0];
  validatePlacementReadbackSeparation(forged);
});
expectFailure("placement-cpu-index-folded-into-gpu-record", () => {
  const forged = structuredClone(validPlacementEvidence);
  forged.decodedRecords[1].cpuAcceptedCellIndex = forged.rawGpuRecords[1][3];
  validatePlacementReadbackSeparation(forged);
});
expectFailure("placement-corpus-without-rejection", () => {
  createStructuredPlacementResources({ columns: 64, rows: 64, threshold: 0 });
});

const ledgerResources = createFieldBakeResources(17, 13);
const ledgerPlacement = createStructuredPlacementResources({ columns: 64, rows: 64 });
const validLedger = createFieldResourceLedger(ledgerResources, ledgerPlacement);
assert.equal(validateFieldResourceLedger(validLedger), validLedger);
expectFailure("forged-resource-byte-count", () => {
  const forged = JSON.parse(JSON.stringify(validLedger));
  forged.resources[0].bytes += 8;
  forged.totalBytes += 8;
  validateFieldResourceLedger(forged);
});
expectFailure("duplicate-resource-identity", () => {
  const forged = JSON.parse(JSON.stringify(validLedger));
  forged.resources[1].id = forged.resources[0].id;
  validateFieldResourceLedger(forged);
});
expectFailure("forged-resource-total", () => {
  const forged = JSON.parse(JSON.stringify(validLedger));
  forged.totalBytes += 4;
  validateFieldResourceLedger(forged);
});
expectFailure("unscoped-resource-entry", () => {
  const forged = JSON.parse(JSON.stringify(validLedger));
  delete forged.resources[0].scope;
  validateFieldResourceLedger(forged);
});
for (const textureResource of ledgerResources.packedMipTextures) textureResource.dispose();
ledgerResources.derivedTexture.dispose();
ledgerResources.gradientTexture.dispose();
ledgerPlacement.records.dispose?.();
ledgerPlacement.acceptedIndices.dispose?.();

const commonResourceEntries = [
  {
    id: "display-evidence-target",
    kind: "render-target",
    format: "rgba8unorm",
    extent: { width: 1200, height: 800 },
    bytesPerTexel: 4,
    bytes: 1200 * 800 * 4,
    scope: "resident-common",
    residency: "resident",
    ownership: "lab-owned",
  },
  {
    id: "raw-probe-target",
    kind: "render-target",
    format: "rgba32float",
    extent: { width: 1, height: 1 },
    bytesPerTexel: 16,
    bytes: 16,
    scope: "resident-common",
    residency: "resident",
    ownership: "lab-owned",
  },
  {
    id: "display-readback-request",
    kind: "readback-request",
    rowBytes: 4800,
    alignedBytesPerRow: 4864,
    rowCount: 800,
    bytes: 4864 * 800,
    scope: "transient-display-readback",
    residency: "transient",
    ownership: "capture-request",
  },
];
const commonLedger = createScopedFieldResourceLedger(commonResourceEntries);
validateTierResourceDescription("gpu-direct-evaluate", {
  tier: "gpu-direct-evaluate",
  common: { completeResourceLedger: commonLedger },
  textures: 0,
  storageBuffers: 0,
  storageBytes: 0,
  precomputedTextures: 0,
});
expectFailure("direct-tier-retained-storage", () => {
  validateTierResourceDescription("gpu-direct-evaluate", {
    tier: "gpu-direct-evaluate",
    common: { completeResourceLedger: commonLedger },
    textures: 1,
    storageBuffers: 1,
    storageBytes: 4096,
  });
});
expectFailure("missing-common-capture-transient", () => {
  const residentOnly = createScopedFieldResourceLedger(commonResourceEntries.slice(0, 2));
  validateTierResourceDescription("gpu-direct-evaluate", {
    tier: "gpu-direct-evaluate",
    common: { completeResourceLedger: residentOnly },
    textures: 0,
    storageBuffers: 0,
    storageBytes: 0,
    precomputedTextures: 0,
  });
});

const precomputedAsset = {
  id: "biome-field-a",
  path: "biome-field-a.png",
  width: 512,
  height: 512,
  channels: 4,
  seed: 1103,
  sourceByteLength: 493800,
  sha256: "90c3e906b8df1e4ef7642a48e226dee888cfb754b7fd85a8160e504042cc6bb6",
};
const precomputedMipExtents = fieldMipExtents(512, 512);
const precomputedMipBytes = precomputedMipExtents.reduce(
  (sum, extent) => sum + extent.width * extent.height * 4,
  0,
);
const precomputedLedger = createScopedFieldResourceLedger([
  ...commonResourceEntries,
  {
    id: "precomputed-field-texture",
    kind: "sampled-texture",
    format: "rgba8unorm",
    mipExtents: precomputedMipExtents,
    bytesPerTexel: 4,
    bytes: precomputedMipBytes,
    scope: "resident-tier",
    residency: "resident",
    ownership: "lab-owned",
  },
]);
const validPrecomputedDescription = {
  tier: "precomputed-minimum",
  common: { completeResourceLedger: precomputedLedger },
  textures: 1,
  storageBuffers: 0,
  storageBytes: 0,
  precomputedTextures: 1,
  precomputedAsset,
  seed: 1103,
  mipExtents: precomputedMipExtents,
  mipLevelCount: precomputedMipExtents.length,
  decodedBaseBytes: 512 * 512 * 4,
  decodedTextureBytes: precomputedMipBytes,
  decodedMipChainBytes: precomputedMipBytes,
  sourceAssetBytes: precomputedAsset.sourceByteLength,
  sourceAssetSha256: precomputedAsset.sha256,
};
validateTierResourceDescription("precomputed-minimum", validPrecomputedDescription);
expectFailure("precomputed-seed-modulo-alias", () => {
  validateTierResourceDescription("precomputed-minimum", {
    ...validPrecomputedDescription,
    seed: 17,
  });
});
expectFailure("precomputed-mip-byte-omission", () => {
  validateTierResourceDescription("precomputed-minimum", {
    ...validPrecomputedDescription,
    decodedTextureBytes: 512 * 512 * 4,
    decodedMipChainBytes: 512 * 512 * 4,
  });
});
expectFailure("precomputed-tier-retained-runtime-bake", () => {
  validateTierResourceDescription("precomputed-minimum", {
    ...validPrecomputedDescription,
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

const validMechanismStatistics = {
  channelRange: [32, 24, 16, 0],
  uniqueRgbaCount: 128,
  nonBlackOccupancy: 1,
  nonWhiteOccupancy: 1,
  redDominantOccupancy: 0.25,
  greenDominantOccupancy: 0.25,
  leftSha256: "a".repeat(64),
  rightSha256: "b".repeat(64),
  pairedHalfMeanAbsError: 0.01,
  pairedHalfMaxAbsError: 1,
  comparisonGeometry: {
    leftStart: 0,
    rightStart: 9,
    halfWidth: 8,
    excludedCenterColumns: 1,
  },
};
validateFieldMechanismStatistics("direct-vs-baked", validMechanismStatistics);
expectFailure("constant-mechanism-diagnostic", () => {
  validateFieldMechanismStatistics("shared-cause-composition", {
    ...validMechanismStatistics,
    channelRange: [0, 0, 0, 0],
    uniqueRgbaCount: 1,
  });
});
expectFailure("false-direct-vs-baked-visual-parity", () => {
  validateFieldMechanismStatistics("direct-vs-baked", {
    ...validMechanismStatistics,
    pairedHalfMeanAbsError: 64,
  });
});
expectFailure("direct-vs-baked-max-error-overrun", () => {
  validateFieldMechanismStatistics("direct-vs-baked", {
    ...validMechanismStatistics,
    pairedHalfMaxAbsError: 3,
  });
});
expectFailure("direct-vs-baked-point-misalignment", () => {
  validateFieldMechanismStatistics("direct-vs-baked", {
    ...validMechanismStatistics,
    comparisonGeometry: {
      ...validMechanismStatistics.comparisonGeometry,
      rightStart: 8,
    },
  });
});
expectFailure("one-class-placement-diagnostic", () => {
  validateFieldMechanismStatistics("structured-placement", {
    ...validMechanismStatistics,
    redDominantOccupancy: 0,
  });
});

const diagnosticWidth = 17;
const diagnosticHeight = 16;
const diagnosticBytes = new Uint8Array(diagnosticWidth * diagnosticHeight * 4);
const diagnosticHalfWidth = Math.floor(diagnosticWidth / 2);
const diagnosticRightStart = diagnosticWidth - diagnosticHalfWidth;
for (let y = 0; y < diagnosticHeight; y += 1) {
  for (let x = 0; x < diagnosticHalfWidth; x += 1) {
    const value = (x * 23 + y * 17) % 220;
    const rightOffset = x === 0 && y === 0 ? 1 : 0;
    for (const [targetX, offset] of [[x, 0], [x + diagnosticRightStart, rightOffset]]) {
      const target = (y * diagnosticWidth + targetX) * 4;
      diagnosticBytes[target] = value + offset;
      diagnosticBytes[target + 1] = (value * 3) % 240 + offset;
      diagnosticBytes[target + 2] = (value * 7) % 240 + offset;
      diagnosticBytes[target + 3] = 255;
    }
  }
  const seam = (y * diagnosticWidth + diagnosticHalfWidth) * 4;
  diagnosticBytes.set([127, 127, 127, 255], seam);
}
const recomputedDiagnosticStatistics = analyzeFieldMechanismRgba(
  diagnosticBytes,
  diagnosticWidth,
  diagnosticHeight,
);
validateReportedFieldMechanismStatistics(
  "direct-vs-baked",
  recomputedDiagnosticStatistics,
  diagnosticBytes,
  diagnosticWidth,
  diagnosticHeight,
);
expectFailure("trusted-forged-diagnostic-statistics", () => {
  validateReportedFieldMechanismStatistics(
    "direct-vs-baked",
    { ...recomputedDiagnosticStatistics, uniqueRgbaCount: 999999 },
    diagnosticBytes,
    diagnosticWidth,
    diagnosticHeight,
  );
});

const canonicalBundle = createFieldNodeBundle({
  coordinate: vec3(0.31, 0.47, 0.83),
  seed: uint(17),
  warpEnabled: false,
  varPrefix: "mutationCanonicalField",
});
const substituteBundle = createFieldNodeBundle({
  coordinate: vec3(0.61, 0.27, 0.43),
  seed: uint(29),
  warpEnabled: false,
  varPrefix: "mutationSubstituteField",
});
const canonicalBindings = createFieldCauseBindings(canonicalBundle);
expectFailure("private-placement-field-substitute", () => {
  validateFieldCauseBindings(canonicalBundle, {
    ...canonicalBindings,
    placement: { mask: substituteBundle.placementMask },
  });
});

const coordinate = [0.83, 0.61, 0.42];
expectFailure("unrebased-f32-phase-overflow", () => {
  sampleFieldCPU({
    domain: "world",
    coordinate: [4095.875, -2048.125, 8191.5],
    seed: 2147483000,
  });
});
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
    "unpinned-f32-oracle-runtime",
    "forged-f32-oracle-hash",
    "origin-routed-through-warp-graph",
    "capture-validator-path-divergence",
    "out-of-range-dirty-tile",
    "out-of-bounds-dirty-region",
    "fractional-padded-stride",
    "dirty-mip-omission",
    "dirty-update-expanded-to-full-mips",
    "forged-dirty-workgroup-count",
    "dirty-write-escaped-region",
    "dirty-write-did-no-work",
    "legacy-one-class-placement",
    "retained-rejected-placement-records",
    "placement-corpus-without-rejection",
    "placement-w-overwritten-by-cpu-index",
    "placement-cpu-index-folded-into-gpu-record",
    "forged-resource-byte-count",
    "duplicate-resource-identity",
    "forged-resource-total",
    "unscoped-resource-entry",
    "direct-tier-retained-storage",
    "missing-common-capture-transient",
    "precomputed-seed-modulo-alias",
    "precomputed-mip-byte-omission",
    "precomputed-tier-retained-runtime-bake",
    "false-filtered-consumer-promotion",
    "display-scene-count-drift",
    "mechanism-route-lock-bypass",
    "tier-route-lock-bypass",
    "constant-mechanism-diagnostic",
    "false-direct-vs-baked-visual-parity",
    "direct-vs-baked-max-error-overrun",
    "direct-vs-baked-point-misalignment",
    "one-class-placement-diagnostic",
    "trusted-forged-diagnostic-statistics",
    "private-placement-field-substitute",
    "unrebased-f32-phase-overflow",
    "omitted-warp-jacobian",
    "omitted-world-input-scale",
    "omitted-sphere-normalization-jacobian",
  ],
}, null, 2));
