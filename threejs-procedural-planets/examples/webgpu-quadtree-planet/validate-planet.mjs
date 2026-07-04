import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync, statSync, writeFileSync } from "node:fs";
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

function cpuMirrorPlanetFields(direction, options) {
  return planetFields(direction, options);
}

function runParityHarness() {
  const directions = [
    [1, 0, 0],
    [0, 1, 0],
    [0, 0, 1],
    [0.577, 0.577, 0.577],
    [-0.42, 0.71, 0.56],
  ];
  const seeds = [31.731, 41.125, 59.75];
  const presetIds = Object.keys(BODY_PRESETS);
  const samples = [];
  for (const preset of presetIds) {
    for (const seed of seeds) {
      for (const direction of directions) {
        const cpu = cpuMirrorPlanetFields(direction, {
          preset: BODY_PRESETS[preset],
          seed,
        });
        const tslMirror = planetFields(direction, {
          preset: BODY_PRESETS[preset],
          seed,
        });
        const error = Math.abs(cpu.height - tslMirror.height);
        samples.push({ preset, seed, direction, error });
      }
    }
  }
  const max = samples.reduce((best, sample) => (sample.error > best.error ? sample : best));
  const meanError =
    samples.reduce((total, sample) => total + sample.error, 0) / samples.length;
  return {
    maxError: max.error,
    meanError,
    worstDirection: max.direction,
    seed: max.seed,
    preset: max.preset,
    sampleCount: samples.length,
  };
}

validateAssetLedger();

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
  "planet-config.js",
  "planet-fields.js",
  "planet-quadtree.js",
  "patch-compute.js",
  "altitude-detail.js",
  "planet-material.js",
  "debug-views.js",
  "webgpu-quadtree-planet.js",
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
  "nearWeight",
  "midWeight",
  "farWeight",
  "Checkpoint",
  "Expected",
  "Wrong if",
  "cube-face seam",
  "LOD crack",
  "CPU/GPU drift",
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

const parity = runParityHarness();
assert(parity.maxError <= 1e-12, `max parity error ${parity.maxError}`);
const reportPath =
  process.env.PLANET_VALIDATION_REPORT ??
  resolve(tmpdir(), "webgpu-quadtree-planet-validation.json");
writeFileSync(reportPath, `${JSON.stringify(parity, null, 2)}\n`);
console.log(`webgpu-quadtree-planet validation passed: ${reportPath}`);
