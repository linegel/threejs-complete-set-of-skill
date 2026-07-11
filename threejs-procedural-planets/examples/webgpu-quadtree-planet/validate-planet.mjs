import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { existsSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import {
  BODY_PRESETS,
  GENERATED_VARIANT_MANIFEST_RELATIVE_PATH,
  PLANET_UNIT_CONTRACT,
  WORKLOAD_TRIALS,
  createPlanetConfig,
  validatePlanetConfig,
} from "./planet-config.js";
import {
  CPU_PLANET_FIELD_SCHEMA_KEYS,
  DEFAULT_CRATER_STAMPS,
  PLANET_FIELD_EVIDENCE,
  craterStamp,
  planetFields,
} from "./planet-fields.js";
import {
  CPU_PLANET_FIELD_ALGORITHM,
  TSL_PLANET_FIELD_ALGORITHM,
  createPlanetFieldCpuBuilder,
  createPlanetFieldTslBuilder,
} from "./planet-field-contract.js";
import {
  NORMAL_QUERY_EVALUATION_COUNTS,
  PLANET_FIELD_ALGORITHM,
  PLANET_FIXED_DIRECTIONS,
  PLANET_PARITY_CHANNELS,
  PLANET_PARITY_SEEDS,
} from "./planet-field-constants.js";
import { PLANET_FIELD_ALGORITHM as SHARED_PLANET_FIELD_ALGORITHM } from "./planet-field-constants.js";
import {
  QUADTREE_EVIDENCE_SCOPE,
  annotateNeighborLevels,
  assertAdjacentLevelDelta,
  createPatch,
  createRootPatches,
  edgeNeighbors,
  projectedScreenError,
  shouldSplitPatch,
  splitPatch,
  transitionMask,
} from "./planet-quadtree.js";
import {
  PATCH_COMPUTE_CONTRACT,
  createPatchComputeDescriptors,
  createPatchRecordBuffer,
  deriveTileGutterTexels,
  estimateDirtyPatchBounds,
} from "./patch-compute.js";
import {
  detailRepresentationWeights,
  heightDerivativeCandidate,
  representedDetailWeight,
} from "./altitude-detail.js";
import { REQUIRED_DEBUG_VIEWS, createPlanetDebugRegistry } from "./debug-views.js";
import { createPlanetMaterialContract, sampleMaterialInputs } from "./planet-material.js";
import { NODE_POST_IMPORTS, WebGPUQuadtreePlanet } from "./webgpu-quadtree-planet.js";

const here = dirname(fileURLToPath(import.meta.url));
const manifestPath = resolve(here, GENERATED_VARIANT_MANIFEST_RELATIVE_PATH);
const manifestDir = dirname(manifestPath);
const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
const fixturePath = resolve(here, "planet-golden-fixtures.json");
let fixtures = JSON.parse(readFileSync(fixturePath, "utf8"));

export const VALIDATION_SCOPE = Object.freeze({
  proves: [
    "CPU field schema and fixed-probe regression",
    "CPU/TSL numeric parity only when a native-WebGPU readback artifact is supplied",
    "stable spherical crater equation and selected zero subgradient convention",
    "CPU cube-edge adjacency and 2:1 balance over the supplied leaf set",
    "projected-error and footprint-filter equations for supplied inputs",
    "generated asset integrity and color-space metadata",
  ],
  doesNotProve: [
    "GPU patch-bound compute or conservative reductions",
    "NodeMaterial compilation, planet geometry, storage or indirect draw submission",
    "MRT, AO, bloom, temporal reconstruction, shadows, or final presentation",
    "crack-free temporal LOD, image quality, full-frame timing, or peak live memory",
    "correctness of the bundled height-derivative candidate or material normals",
  ],
});

function parseArgs(argv) {
  const options = {
    allowMissingGpu: false,
    artifacts: null,
    updateFixtures: false,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--allow-missing-gpu") options.allowMissingGpu = true;
    else if (arg === "--artifacts") options.artifacts = resolve(argv[++index]);
    else if (arg === "--update-fixtures") options.updateFixtures = true;
    else throw new Error(`Unknown argument: ${arg}`);
  }
  return options;
}

function sha256(path) {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}

function pngDimensions(path) {
  const bytes = readFileSync(path);
  return {
    width: bytes.readUInt32BE(16),
    height: bytes.readUInt32BE(20),
  };
}

function validateAssetLedger() {
  assert.equal(manifest.colorSpace, "NoColorSpace");
  assert.equal(manifest.assetPreviewOnly, true);
  assert.equal(manifest.pipelineEvidence, "not-run");
  assert.equal(manifest.lifecycleEvidence, "not-run");
  for (const channel of ["r", "g", "b", "a"]) {
    assert(manifest.channelMeanings[channel], `missing channel ${channel}`);
  }
  for (const asset of manifest.assets) {
    const path = resolve(manifestDir, asset.path);
    assert.equal(statSync(path).size, asset.byteLength, asset.id);
    assert.equal(sha256(path), asset.sha256, asset.id);
    assert.deepEqual(pngDimensions(path), {
      width: asset.width,
      height: asset.height,
    });
    assert.equal(asset.colorSpace, "NoColorSpace");
    assert.equal(asset.minimumResidentDiagnosticOnly, true);
  }
}

function sampleParityChannels(direction, options) {
  const sample = planetFields(direction, options);
  return {
    height: sample.height,
    macroHeight: sample.macroHeight,
    ridge: sample.ridge,
    oceanDepth: sample.oceanDepth,
    humidity: sample.humidity,
    temperature: sample.temperature,
    ruggednessProxy: sample.ruggednessProxy,
    roughnessCause: sample.roughnessCause,
  };
}

function probeKey(entry) {
  return JSON.stringify([entry.preset, entry.seed, entry.direction]);
}

function expectedProbeKeys() {
  const keys = new Set();
  for (const preset of Object.keys(BODY_PRESETS)) {
    for (const seed of PLANET_PARITY_SEEDS) {
      for (const direction of PLANET_FIXED_DIRECTIONS) {
        keys.add(probeKey({ preset, seed, direction }));
      }
    }
  }
  return keys;
}

function assertExactProbeCartesian(samples, label) {
  assert(Array.isArray(samples) && samples.length > 0, `${label} probes must be nonempty`);
  const expected = expectedProbeKeys();
  assert.equal(samples.length, expected.size, `${label} must contain the exact probe Cartesian product`);
  const observed = new Set();
  for (const [index, sample] of samples.entries()) {
    const key = probeKey(sample);
    assert(expected.has(key), `${label} probe ${index} is outside the declared Cartesian product`);
    assert(!observed.has(key), `${label} probe ${index} duplicates ${key}`);
    observed.add(key);
  }
  assert.deepEqual([...observed].sort(), [...expected].sort(), `${label} probe product mismatch`);
}

function createGoldenFixtures() {
  const probes = [];
  for (const presetName of Object.keys(BODY_PRESETS)) {
    for (const seed of PLANET_PARITY_SEEDS) {
      for (const direction of PLANET_FIXED_DIRECTIONS) {
        probes.push({
          preset: presetName,
          seed,
          direction,
          values: sampleParityChannels(direction, {
            preset: BODY_PRESETS[presetName],
            seed,
          }),
        });
      }
    }
  }
  return {
    version: 1,
    algorithmVersion: PLANET_FIELD_ALGORITHM.version,
    channels: PLANET_PARITY_CHANNELS,
    probes,
  };
}

function assertClose(actual, expected, tolerance, label) {
  const error = Math.abs(actual - expected);
  assert(
    error <= tolerance,
    `${label}: ${actual} differs from ${expected} by ${error}, tolerance ${tolerance}`,
  );
  return error;
}

function validateSharedAlgorithm() {
  const cpuBuilder = createPlanetFieldCpuBuilder();
  const tslBuilder = createPlanetFieldTslBuilder();
  assert.equal(CPU_PLANET_FIELD_ALGORITHM, SHARED_PLANET_FIELD_ALGORITHM);
  assert.equal(TSL_PLANET_FIELD_ALGORITHM, SHARED_PLANET_FIELD_ALGORITHM);
  assert.equal(cpuBuilder.algorithm, SHARED_PLANET_FIELD_ALGORITHM);
  assert.equal(tslBuilder.algorithm, SHARED_PLANET_FIELD_ALGORITHM);
  assert.deepEqual(cpuBuilder.algorithm, tslBuilder.algorithm);
  assert.deepEqual(cpuBuilder.channels, PLANET_PARITY_CHANNELS);
  assert.deepEqual(tslBuilder.channels, PLANET_PARITY_CHANNELS);
  assert.equal(
    NORMAL_QUERY_EVALUATION_COUNTS.previousFullFieldEvaluations,
    2 * 2,
    "old normal query cost must be derived as 2 tangent axes * 2 central samples",
  );
  assert.equal(
    NORMAL_QUERY_EVALUATION_COUNTS.fusedCandidateFullFieldEvaluations,
    1,
    "candidate derivative query cost must be one fused planetFields() call",
  );
  assert(
    NORMAL_QUERY_EVALUATION_COUNTS.fusedCandidateFullFieldEvaluations <
      NORMAL_QUERY_EVALUATION_COUNTS.previousFullFieldEvaluations,
    "candidate derivative path must reduce full field evaluations",
  );
  return {
    pass: true,
    evidenceStatus:
      "Executed structural identity and Derived call-count checks; derivative correctness and GPU timing not run",
    sharedConstantsObject: true,
    algorithmVersion: PLANET_FIELD_ALGORITHM.version,
    normalQueryEvaluationCounts: NORMAL_QUERY_EVALUATION_COUNTS,
  };
}

function validateGoldenFixtures() {
  assert.equal(fixtures.version, 1);
  assert.equal(fixtures.algorithmVersion, PLANET_FIELD_ALGORITHM.version);
  assert.deepEqual(fixtures.channels, PLANET_PARITY_CHANNELS);
  assertExactProbeCartesian(fixtures.probes, "CPU golden");

  let maxAbsError = 0;
  let meanAbsError = 0;
  let count = 0;
  const samples = fixtures.probes.map((entry, index) => {
    assert(BODY_PRESETS[entry.preset], `fixture probe ${index} unknown preset ${entry.preset}`);
    const actual = sampleParityChannels(entry.direction, {
      preset: BODY_PRESETS[entry.preset],
      seed: entry.seed,
    });
    const channelErrors = {};
    for (const channel of PLANET_PARITY_CHANNELS) {
      const error = assertClose(
        actual[channel],
        entry.values[channel],
        PLANET_FIELD_ALGORITHM.fixtureTolerance,
        `fixture probe ${index} ${channel}`,
      );
      channelErrors[channel] = error;
      maxAbsError = Math.max(maxAbsError, error);
      meanAbsError += error;
      count += 1;
    }
    return {
      preset: entry.preset,
      seed: entry.seed,
      direction: entry.direction,
      maxAbsError: Math.max(...Object.values(channelErrors)),
      channelErrors,
    };
  });

  return {
    pass: true,
    evidenceStatus: "Executed CPU fixed-probe regression",
    fixtureTolerance: PLANET_FIELD_ALGORITHM.fixtureTolerance,
    maxAbsError,
    meanAbsError: count === 0 ? 0 : meanAbsError / count,
    sampleCount: samples.length,
    samples,
  };
}

function readGpuReadback(artifactDir) {
  const path = resolve(artifactDir, "planet-readback.json");
  if (!existsSync(path)) {
    throw new Error(`GPU parity artifact missing: ${path}`);
  }
  return JSON.parse(readFileSync(path, "utf8"));
}

function validateGpuReadback(artifactDir) {
  const readback = readGpuReadback(artifactDir);
  assert.equal(readback.version, 1);
  assert.equal(readback.algorithmVersion, PLANET_FIELD_ALGORITHM.version);
  assert.equal(readback.renderer?.isWebGPUBackend, true);
  assert.equal(readback.renderer?.threeRevision, "185");
  assert.deepEqual(readback.channels, PLANET_PARITY_CHANNELS);
  assert.deepEqual(readback.constants?.hash, PLANET_FIELD_ALGORITHM.hash);
  assert.deepEqual(readback.constants?.fbm, PLANET_FIELD_ALGORITHM.fbm);
  assert.deepEqual(readback.constants?.heightWeights, PLANET_FIELD_ALGORITHM.heightWeights);
  assert(Array.isArray(readback.samples), "GPU readback samples must be an array");
  assertExactProbeCartesian(readback.samples, "GPU readback");

  let maxAbsError = 0;
  let meanAbsError = 0;
  let count = 0;
  let worstSample = null;
  const samples = readback.samples.map((entry, index) => {
    assert(BODY_PRESETS[entry.preset], `GPU sample ${index} unknown preset ${entry.preset}`);
    assert(entry.direction, `GPU sample ${index} missing direction`);
    assert(entry.values, `GPU sample ${index} missing values`);
    assert.deepEqual(
      Object.keys(entry.values).sort(),
      [...PLANET_PARITY_CHANNELS].sort(),
      `GPU sample ${index} must contain only the declared parity channels`,
    );
    const cpu = sampleParityChannels(entry.direction, {
      preset: BODY_PRESETS[entry.preset],
      seed: entry.seed,
    });
    const channelErrors = {};
    for (const channel of PLANET_PARITY_CHANNELS) {
      const actual = Number(entry.values[channel]);
      assert(Number.isFinite(actual), `GPU sample ${index} ${channel} is not finite`);
      const error = Math.abs(actual - cpu[channel]);
      const tolerance =
        PLANET_FIELD_ALGORITHM.parityToleranceByChannel?.[channel] ??
        PLANET_FIELD_ALGORITHM.parityTolerance;
      assert(
        error <= tolerance,
        `GPU sample ${index} ${channel} error ${error} exceeds Gated tolerance ${tolerance}`,
      );
      channelErrors[channel] = error;
      meanAbsError += error;
      count += 1;
      if (error > maxAbsError) {
        maxAbsError = error;
        worstSample = { index, preset: entry.preset, seed: entry.seed, direction: entry.direction, channel };
      }
    }
    return {
      preset: entry.preset,
      seed: entry.seed,
      direction: entry.direction,
      channelErrors,
      maxAbsError: Math.max(...Object.values(channelErrors)),
    };
  });
  meanAbsError = count === 0 ? 0 : meanAbsError / count;
  if (maxAbsError > PLANET_FIELD_ALGORITHM.parityTolerance) {
    throw new Error(
      `GPU parity maxAbsError ${maxAbsError} exceeds tolerance ${PLANET_FIELD_ALGORITHM.parityTolerance}`,
    );
  }
  return {
    pass: true,
    status: "passed",
    artifactDir,
    tolerance: PLANET_FIELD_ALGORITHM.parityTolerance,
    toleranceByChannel: PLANET_FIELD_ALGORITHM.parityToleranceByChannel,
    toleranceProvenance: PLANET_FIELD_ALGORITHM.parityToleranceProvenance,
    evidenceStatus: "Measured native-WebGPU numeric field parity only",
    proofExclusions: VALIDATION_SCOPE.doesNotProve,
    maxAbsError,
    meanAbsError,
    worstSample,
    samples,
  };
}

const options = parseArgs(process.argv.slice(2));

if (options.updateFixtures) {
  fixtures = createGoldenFixtures();
  writeFileSync(fixturePath, `${JSON.stringify(fixtures, null, 2)}\n`);
}

validateAssetLedger();
const structuralParity = validateSharedAlgorithm();

const config = createPlanetConfig();
assert.equal(validatePlanetConfig(config).ok, true);
assert.equal(PLANET_UNIT_CONTRACT.kilometresToMetres, 1000);
assert.equal(config.workload.evidenceClass, "Authored");
assert.equal(WORKLOAD_TRIALS[config.trial], config.workload);
assert.equal(config.preset.radiusKm, config.radiusKm);
assert.equal(config.preset.atmosphereInnerRadiusKm, config.radiusKm);
assert(config.preset.atmosphereOuterRadiusKm > config.preset.atmosphereInnerRadiusKm);

const resizedBody = createPlanetConfig({ radiusKm: 9000 });
assert.equal(resizedBody.preset.radiusKm, 9000);
assert.equal(resizedBody.preset.atmosphereInnerRadiusKm, 9000);
assert.equal(
  resizedBody.preset.atmosphereOuterRadiusKm - resizedBody.preset.atmosphereInnerRadiusKm,
  BODY_PRESETS.pelagia.atmosphereOuterRadiusKm - BODY_PRESETS.pelagia.atmosphereInnerRadiusKm,
);

const invalid = createPlanetConfig();
invalid.radiusKm = 0;
assert.equal(validatePlanetConfig(invalid).ok, false);

const fields = planetFields([0.3, 0.7, 0.2], { preset: BODY_PRESETS.pelagia });
for (const key of CPU_PLANET_FIELD_SCHEMA_KEYS) {
  assert(key in fields, `missing schema key ${key}`);
}
assert.equal(PLANET_FIELD_EVIDENCE.derivativeCorrectness, "not-run-candidate-only");
assert(PLANET_FIELD_EVIDENCE.gpuParityExcludes.includes("heightDerivativeCandidate"));
for (const key of ["craterFloor", "craterWall", "craterRim", "ejectaStrength", "erosion"]) {
  const crater = craterStamp(DEFAULT_CRATER_STAMPS[0].centerDirection, DEFAULT_CRATER_STAMPS[0]);
  assert(key in crater, `missing crater output ${key}`);
}
assert("biomeId" in fields);
assert("biomeWeights" in fields);

const root = createRootPatches();
for (const patch of root) {
  for (const edge of ["north", "south", "east", "west"]) {
    const neighbors = edgeNeighbors(patch, root, edge);
    assert.equal(neighbors.length, 1, `${patch.id} ${edge} must have one cube-face neighbor`);
    assert.notEqual(neighbors[0].face, patch.face);
  }
}
for (const splitFace of root.keys()) {
  const splitLeaves = annotateNeighborLevels([
    ...splitPatch(root[splitFace]),
    ...root.filter((_, face) => face !== splitFace),
  ]);
  assert.equal(assertAdjacentLevelDelta(splitLeaves).ok, true);
  assert(splitLeaves.filter((patch) => patch.face === splitFace).every((patch) => transitionMask(patch) !== 0));
}
const fovY = Math.PI / 3;
const aspect = 16 / 9;
const near = 1;
const far = 100;
const focal = 1 / Math.tan(fovY / 2);
root[0].screenError = projectedScreenError({
  supportPairs: [
    { referenceWorld: [0, 0, -10], approximateWorld: [1, 0, -10] },
    // Off-axis depth error exercises the perspective denominator; an on-axis
    // distance clamp cannot conservatively represent this pair.
    { referenceWorld: [4, 1, -12], approximateWorld: [4, 1, -10] },
  ],
  views: [{
    unjitteredProjection: true,
    renderTargetWidthPx: 1920,
    renderTargetHeightPx: 1080,
    cameraNear: near,
    viewMatrix: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1],
    projectionMatrix: [
      focal / aspect, 0, 0, 0,
      0, focal, 0, 0,
      0, 0, (far + near) / (near - far), -1,
      0, 0, (2 * far * near) / (near - far), 0,
    ],
  }],
});
assert.throws(() => projectedScreenError({
  supportPairs: [{ referenceWorld: [0, 0, -0.5], approximateWorld: [0, 0, -0.4] }],
  views: [{
    unjitteredProjection: true,
    renderTargetWidthPx: 1920,
    renderTargetHeightPx: 1080,
    cameraNear: near,
    viewMatrix: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1],
    projectionMatrix: [
      focal / aspect, 0, 0, 0,
      0, focal, 0, 0,
      0, 0, (far + near) / (near - far), -1,
      0, 0, (2 * far * near) / (near - far), 0,
    ],
  }],
}), /near plane/);
assert.equal(
  shouldSplitPatch(root[0], {
    splitThreshold: config.workload.splitPixelError,
    maxLevel: config.workload.maxLevel,
  }),
  true,
);
const patches = annotateNeighborLevels([...splitPatch(root[0]), ...root.slice(1)]);
const balance = assertAdjacentLevelDelta(patches);
assert.equal(balance.ok, true);
assert.equal(balance.evidenceScope, QUADTREE_EVIDENCE_SCOPE);
const crossFaceNeighbors = edgeNeighbors(patches[0], patches, "west");
assert(crossFaceNeighbors.some((neighbor) => neighbor.face !== patches[0].face));
assert(patches.some((patch) => transitionMask(patch) !== 0));
assert(patches.every((patch) => transitionMask(patch) >= 0 && transitionMask(patch) < 16));

const dirtyPatch = createPatch({ face: 0, level: 2, x: 1, y: 2 });
const baseBounds = estimateDirtyPatchBounds(dirtyPatch, {
  preset: BODY_PRESETS.pelagia,
  seed: 31.731,
  amplitudeScale: 1,
});
const amplifiedBounds = estimateDirtyPatchBounds(dirtyPatch, {
  preset: BODY_PRESETS.pelagia,
  seed: 31.731,
  amplitudeScale: 2,
});
assert.notEqual(baseBounds.maxHeight, amplifiedBounds.maxHeight);
const computeDescriptor = createPatchComputeDescriptors(patches);
assert.equal(computeDescriptor.implementationStatus, "runtime-storage-compute");
assert.equal(PATCH_COMPUTE_CONTRACT.implementationStatus, computeDescriptor.implementationStatus);
assert.equal(computeDescriptor.reductions, "not-required-analytic-per-patch-bound");
assert.equal(createPatchRecordBuffer(2).itemSize, 4);
assert.equal(deriveTileGutterTexels({
  maximumWarpDisplacementTexels: 0.75,
  reconstructionFilterRadiusTexels: 1,
  derivativeStencilRadiusTexels: 1.5,
  maximumProjectedFootprintRadiusTexels: 2.4,
}), 4);

const weights = detailRepresentationWeights({
  wavelengths: { macro: 0.08, meso: 0.012, micro: 0.0025 },
  vertexSpacing: 0.001,
  pixelFootprint: 0.00075,
});
assert(weights.macroWeight >= weights.mesoWeight && weights.mesoWeight >= weights.microWeight);
assert.equal(representedDetailWeight({
  wavelength: 0.001,
  vertexSpacing: 0.001,
  pixelFootprint: 0.001,
}), 0);
assert.equal(representedDetailWeight({
  wavelength: 0.004,
  vertexSpacing: 0.001,
  pixelFootprint: 0.001,
}), 1);
const derivative = heightDerivativeCandidate([0.2, 0.8, 0.4], {
  preset: BODY_PRESETS.pelagia,
});
assert.equal(derivative.candidate.length, 2);
assert.equal(derivative.derivativeCorrectness, "not-run-candidate-only");
assert.equal(
  derivative.evaluationCount,
  NORMAL_QUERY_EVALUATION_COUNTS.fusedCandidateFullFieldEvaluations,
);

const registry = createPlanetDebugRegistry();
assert.deepEqual(Object.keys(registry), REQUIRED_DEBUG_VIEWS);
assert(registry["crater-channels"].output.includes("craterFloor"));

const material = createPlanetMaterialContract();
assert.equal(material.positionNode, "shared planetFields(surfaceDirection).height");
assert.equal(material.implementationStatus, "descriptor-only-not-rendered");
const materialInputs = sampleMaterialInputs([0.1, 0.6, 0.8], {
  preset: BODY_PRESETS.pelagia,
  detailSampling: {
    wavelengths: { macro: 0.08, meso: 0.012, micro: 0.0025 },
    vertexSpacing: 0.001,
    pixelFootprint: 0.00075,
  },
});
assert("microWeight" in materialInputs);
assert("heightDerivativeCandidate" in materialInputs);
assert.equal(materialInputs.derivativeCorrectness, "not-run-candidate-only");

const planet = new WebGPUQuadtreePlanet({ config });
const passGraph = planet.createPassGraph();
assert.equal(passGraph.implementationStatus, "descriptor-only-not-rendered");
assert.equal(passGraph.mrtDefault, "mrt({ output })");
assert.equal(planet.createComputePlan().buffers.dirtyPatchRecords, "StorageBufferAttribute");
let patchInstanceDisposeEvents = 0;
planet.patchInstances.addEventListener("dispose", () => {
  patchInstanceDisposeEvents += 1;
});
planet.resize(1280, 720);
planet.dispose();
assert.equal(planet.disposeCounters.patchBuffers, 1);
assert.equal(patchInstanceDisposeEvents, 1);

for (const importPath of Object.values(NODE_POST_IMPORTS)) {
  assert(importPath.startsWith("three/addons/"), importPath);
}

// Source inspection below is a structural guard only. Numeric or visual claims
// come from executed fixtures/readback, never from finding documentation words.
const fieldSource = readFileSync(resolve(here, "planet-fields.js"), "utf8");
const runtimeSource = readFileSync(resolve(here, "webgpu-quadtree-planet.js"), "utf8");
assert(fieldSource.includes("Math.atan2(sine, cosine)"));
assert(fieldSource.includes("atan(sine, cosine)"));
assert(!fieldSource.includes("Math.acos("));
assert(!/\bacos\s*\(/u.test(fieldSource));
assert(runtimeSource.includes("native WebGPU backend"));
assert(runtimeSource.includes('from "three/addons/'));

for (const forbidden of [`Shader${"Material"}`, `gl_${"FragColor"}`, `tonemapping_${"fragment"}`]) {
  assert(!fieldSource.includes(forbidden), `field source contains ${forbidden}`);
  assert(!runtimeSource.includes(forbidden), `runtime descriptor contains ${forbidden}`);
}

const fixtureParity = validateGoldenFixtures();
let gpuParity;
if (options.artifacts) {
  gpuParity = validateGpuReadback(options.artifacts);
} else {
  gpuParity = {
    pass: false,
    status: "not-run",
    requiredForNumericGpuParityClaim: true,
    reason:
      "Pass --artifacts <dir> containing planet-readback.json, or pass --allow-missing-gpu for structural/equation checks only.",
    proofExclusions: VALIDATION_SCOPE.doesNotProve,
  };
  if (!options.allowMissingGpu) {
    process.exitCode = 1;
  }
}
const report = {
  validationScope: VALIDATION_SCOPE,
  fieldEvidence: PLANET_FIELD_EVIDENCE,
  workloadEvidenceClass: config.workload.evidenceClass,
  quadtreeEvidenceScope: QUADTREE_EVIDENCE_SCOPE,
  descriptorStatuses: {
    patchCompute: computeDescriptor.implementationStatus,
    material: material.implementationStatus,
    renderGraph: planet.createPassGraph().implementationStatus,
  },
  structuralParity,
  fixtureParity,
  gpuParity,
};
const reportPath =
  process.env.PLANET_VALIDATION_REPORT ??
  resolve(tmpdir(), "webgpu-quadtree-planet-validation.json");
writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`);
if (process.exitCode) {
  throw new Error(
    `GPU parity ${gpuParity.status}; rerun with --artifacts <dir> or --allow-missing-gpu. Layer 1 report: ${reportPath}`,
  );
}
console.log(`webgpu-quadtree-planet validation passed: ${reportPath}`);
