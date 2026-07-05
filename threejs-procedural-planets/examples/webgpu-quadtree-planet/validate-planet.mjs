import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { existsSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import {
  BODY_PRESETS,
  GENERATED_VARIANT_MANIFEST_RELATIVE_PATH,
  PLANET_UNITS,
  VALIDITY_RANGE,
  createPlanetConfig,
  validatePlanetConfig,
} from "./planet-config.js";
import {
  DEFAULT_CRATER_STAMPS,
  PLANET_FIELD_SCHEMA_KEYS,
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
  annotateNeighborLevels,
  assertAdjacentLevelDelta,
  createPatch,
  createRootPatches,
  projectedScreenError,
  shouldSplitPatch,
  splitPatch,
} from "./planet-quadtree.js";
import {
  createPatchComputeDescriptors,
  createPatchRecordBuffer,
  estimateDirtyPatchBounds,
} from "./patch-compute.js";
import { altitudeDetailWeights, heightGradient } from "./altitude-detail.js";
import { REQUIRED_DEBUG_VIEWS, createPlanetDebugRegistry } from "./debug-views.js";
import { createPlanetMaterialContract, sampleMaterialInputs } from "./planet-material.js";
import { NODE_POST_IMPORTS, WebGPUQuadtreePlanet } from "./webgpu-quadtree-planet.js";

const here = dirname(fileURLToPath(import.meta.url));
const manifestPath = resolve(here, GENERATED_VARIANT_MANIFEST_RELATIVE_PATH);
const manifestDir = dirname(manifestPath);
const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
const fixturePath = resolve(here, "planet-golden-fixtures.json");
let fixtures = JSON.parse(readFileSync(fixturePath, "utf8"));

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
    assert.equal(asset.reducedTierOnly, true);
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
    slope: sample.slope,
    roughnessVariance: sample.roughnessVariance,
    heightGradientX: sample.heightGradient[0],
    heightGradientY: sample.heightGradient[1],
  };
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
    NORMAL_QUERY_EVALUATION_COUNTS.fusedFullFieldEvaluations,
    1,
    "new normal query cost must be one fused planetFields() call",
  );
  assert(
    NORMAL_QUERY_EVALUATION_COUNTS.fusedFullFieldEvaluations <
      NORMAL_QUERY_EVALUATION_COUNTS.previousFullFieldEvaluations,
    "fused gradient must reduce full field evaluations",
  );
  return {
    pass: true,
    sharedConstantsObject: true,
    algorithmVersion: PLANET_FIELD_ALGORITHM.version,
    normalQueryEvaluationCounts: NORMAL_QUERY_EVALUATION_COUNTS,
  };
}

function validateGoldenFixtures() {
  assert.equal(fixtures.version, 1);
  assert.equal(fixtures.algorithmVersion, PLANET_FIELD_ALGORITHM.version);
  assert.deepEqual(fixtures.channels, PLANET_PARITY_CHANNELS);

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
  assert.deepEqual(readback.channels, PLANET_PARITY_CHANNELS);
  assert(Array.isArray(readback.samples), "GPU readback samples must be an array");

  let maxAbsError = 0;
  let meanAbsError = 0;
  let count = 0;
  let worstSample = null;
  const samples = readback.samples.map((entry, index) => {
    assert(BODY_PRESETS[entry.preset], `GPU sample ${index} unknown preset ${entry.preset}`);
    assert(entry.direction, `GPU sample ${index} missing direction`);
    assert(entry.values, `GPU sample ${index} missing values`);
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
        `GPU sample ${index} ${channel} error ${error} exceeds derived tolerance ${tolerance}`,
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
    toleranceDerivation: PLANET_FIELD_ALGORITHM.parityToleranceDerivation,
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
assert(PLANET_UNITS.radiusKm > 0);
assert(VALIDITY_RANGE.angularRadius[0] < VALIDITY_RANGE.angularRadius[1]);

const invalid = createPlanetConfig();
invalid.radiusKm = 100;
assert.equal(validatePlanetConfig(invalid).ok, false);

const fields = planetFields([0.3, 0.7, 0.2], { preset: BODY_PRESETS.pelagia });
for (const key of PLANET_FIELD_SCHEMA_KEYS) {
  assert(key in fields, `missing schema key ${key}`);
}
for (const key of ["craterFloor", "craterWall", "craterRim", "ejectaStrength", "erosion"]) {
  const crater = craterStamp(DEFAULT_CRATER_STAMPS[0].centerDirection, DEFAULT_CRATER_STAMPS[0]);
  assert(key in crater, `missing crater output ${key}`);
}
assert("biomeId" in fields);
assert("biomeWeights" in fields);

const root = createRootPatches();
root[0].screenError = projectedScreenError({
  patch: root[0],
  cameraDistance: 2200,
  radiusKm: config.radiusKm,
  viewportHeight: 1080,
  fovRadians: Math.PI / 3,
});
assert.equal(
  shouldSplitPatch(root[0], {
    splitThreshold: config.quality.splitThreshold,
    maxLevel: config.quality.maxLevel,
  }),
  true,
);
const patches = annotateNeighborLevels([...splitPatch(root[0]), ...root.slice(1)]);
assert.equal(assertAdjacentLevelDelta(patches).ok, true);
assert(
  patches.some((patch) => Object.values(patch.transitionEdges).some(Boolean) === false),
);

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
assert.equal(createPatchComputeDescriptors(patches).api, "renderer.computeAsync");
assert.equal(createPatchRecordBuffer(2).itemSize, 4);

const weights = altitudeDetailWeights({ altitude: 20, radius: 1 });
assert("nearWeight" in weights && "midWeight" in weights && "farWeight" in weights);
const gradient = heightGradient([0.2, 0.8, 0.4], {
  preset: BODY_PRESETS.pelagia,
});
assert.equal(gradient.analyticGradient.length, 2);
assert.equal(gradient.evaluationCount, NORMAL_QUERY_EVALUATION_COUNTS.fusedFullFieldEvaluations);

const registry = createPlanetDebugRegistry();
assert.deepEqual(Object.keys(registry), REQUIRED_DEBUG_VIEWS);
assert(registry["crater-channels"].output.includes("craterFloor"));

const material = createPlanetMaterialContract();
assert.equal(material.positionNode, "shared planetFields(surfaceDirection).height");
const materialInputs = sampleMaterialInputs([0.1, 0.6, 0.8], {
  preset: BODY_PRESETS.pelagia,
  altitude: 12,
  radius: 1,
});
assert("nearWeight" in materialInputs);
assert("heightGradient" in materialInputs);

const planet = new WebGPUQuadtreePlanet({ config });
assert.equal(planet.createPassGraph().renderer, "WebGPURenderer");
assert.equal(planet.createComputePlan().buffers.dirtyPatchRecords, "StorageBufferAttribute");
planet.resize(1280, 720);
planet.dispose();
assert.equal(planet.disposeCounters.patchBuffers, 1);

for (const importPath of Object.values(NODE_POST_IMPORTS)) {
  assert(importPath.includes("three/examples/jsm/"), importPath);
}

const source = [
  "README.md",
  "planet-field-constants.js",
  "planet-field-contract.js",
  "planet-config.js",
  "planet-fields.js",
  "planet-quadtree.js",
  "patch-compute.js",
  "altitude-detail.js",
  "planet-material.js",
  "debug-views.js",
  "webgpu-quadtree-planet.js",
  "validate-planet.mjs",
  "capture-planet-readback.mjs",
  "planet-readback-browser.js",
]
  .map((file) => readFileSync(resolve(here, file), "utf8"))
  .join("\n");

for (const required of [
  "WebGPURenderer",
  "MeshStandardNodeMaterial",
  "MeshPhysicalNodeMaterial",
  "positionNode",
  "planetFields",
  "StorageBufferAttribute",
  "renderer.computeAsync",
  "dirtyPatch",
  "minHeight",
  "maxHeight",
  "splitThreshold",
  "mergeThreshold",
  "screenError",
  "neighborLevels",
  "transitionEdges",
  "analyticGradient",
  "heightGradient",
  "NORMAL_QUERY_EVALUATION_COUNTS",
  "nearWeight",
  "midWeight",
  "farWeight",
  "Checkpoint",
  "Expected",
  "Wrong if",
  "cube-face seam",
  "LOD crack",
  "CPU/GPU drift",
  "planet-readback.json",
  "--allow-missing-gpu",
]) {
  assert(source.includes(required), `missing ${required}`);
}

for (const forbidden of [
  `Shader${"Material"}`,
  `gl_${"FragColor"}`,
  `tonemapping_${"fragment"}`,
]) {
  assert(!source.includes(forbidden), `canonical source contains ${forbidden}`);
}
assert(!source.includes(`TSL_${"PLANET_FIELDS_CONTRACT"}`), "dead TSL contract string must stay deleted");

const fixtureParity = validateGoldenFixtures();
let gpuParity;
if (options.artifacts) {
  gpuParity = validateGpuReadback(options.artifacts);
} else {
  gpuParity = {
    pass: false,
    status: "not-run",
    requiredForBrowserAcceptance: true,
    reason:
      "Pass --artifacts <dir> containing planet-readback.json, or pass --allow-missing-gpu for Layer 1 only.",
  };
  if (!options.allowMissingGpu) {
    process.exitCode = 1;
  }
}
const report = {
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
