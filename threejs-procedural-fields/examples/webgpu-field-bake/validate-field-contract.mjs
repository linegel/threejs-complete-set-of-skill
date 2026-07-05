import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { existsSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import {
  CPU_FIELD_ALGORITHM,
  FIELD_ALGORITHM,
  FIELD_CHANNELS,
  FIELD_DERIVED_CHANNELS,
  FIELD_PARITY_CHANNELS,
  TSL_FIELD_ALGORITHM,
  coverage,
  fixedProbes,
  sampleFieldCPU,
} from "./field-bundle.mjs";
import { FIELD_ALGORITHM as SHARED_FIELD_ALGORITHM } from "./field-constants.mjs";
import {
  createDirtyTileTracker,
  createFieldBakePlan,
  decideBakeStrategy,
  STORAGE_FORMATS,
} from "./field-bake.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const manifestPath = resolve(here, "../../assets/generated-variants/manifest.json");
const manifestDir = dirname(manifestPath);
const fixturePath = resolve(here, "field-golden-fixtures.json");
const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
const fixtures = JSON.parse(readFileSync(fixturePath, "utf8"));
const fixtureTolerance = 1e-12;

const f32UnitRoundoff = 2 ** -24;
const gamma = (ops) => (ops * f32UnitRoundoff) / (1 - ops * f32UnitRoundoff);

// Derived gate: the u32 lattice hash makes corner values bit-identical after
// the CPU f32 conversion. Remaining drift is f32-vs-f64 arithmetic in three
// warp noises, four-octave fBm, trilinear lerps, pow/channel remaps, and the
// smooth placement mask. A deepest chain of <=384 rounded ops gives
// gamma_384 ~= 2.29e-5; the 4x Lipschitz/driver-libm margin gates every
// continuous channel at 1e-4. This is derived, not taken from the asset
// manifest's historical 0.001 image tolerance.
const gpuParityDerivation = Object.freeze({
  unitRoundoff: f32UnitRoundoff,
  deepestRoundedOps: 384,
  gammaDeepest: gamma(384),
  margin: 4.4,
  hashCornerError: 0,
  thresholdGuardBand: 1e-4,
});
const gpuParityTolerances = Object.freeze(
  Object.fromEntries(FIELD_PARITY_CHANNELS.map((channel) => [channel, 1e-4])),
);
const placementMaskThreshold = 0.5;

function parseArgs(argv) {
  const options = {
    allowMissingGpu: false,
    artifacts: null,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--allow-missing-gpu") options.allowMissingGpu = true;
    else if (arg === "--artifacts") options.artifacts = resolve(argv[++index]);
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

function validateManifest() {
  assert.equal(manifest.colorSpace, "NoColorSpace");
  assert.deepEqual(manifest.channelMeanings, FIELD_CHANNELS);
  for (const channel of Object.values(FIELD_CHANNELS)) {
    assert.equal(typeof manifest.coverage[channel]?.min, "number", `${channel} coverage min`);
    assert.equal(typeof manifest.coverage[channel]?.max, "number", `${channel} coverage max`);
    assert(
      manifest.coverage[channel].min <= manifest.coverage[channel].max,
      `${channel} coverage min must be <= max`,
    );
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
  }
}

function validateBakePlanning() {
  assert.equal(decideBakeStrategy({ readCount: 1 }), "direct-evaluate");
  assert.equal(decideBakeStrategy({ readCount: 8 }), "StorageTexture");

  const tracker = createDirtyTileTracker({ tilesX: 8, tilesY: 8 });
  tracker.invalidate(3, 4);
  assert.deepEqual(tracker.allTiles(), ["3:4"]);
  const bakePlan = createFieldBakePlan({ readCount: 8, dirtyTile: tracker.allTiles() });
  assert.equal(bakePlan.strategy, "StorageTexture");
  assert.equal(bakePlan.api, "renderer.computeAsync");
  assert.equal(bakePlan.texture.colorSpace, "");
  assert.equal(bakePlan.texture.mipmapsAutoUpdate, false);
  assert.equal(bakePlan.texture.format, STORAGE_FORMATS.smoothRgba.format);
  assert.equal(bakePlan.texture.type, STORAGE_FORMATS.smoothRgba.type);
}

function validateSharedAlgorithm() {
  assert.equal(CPU_FIELD_ALGORITHM, SHARED_FIELD_ALGORITHM, "CPU constants must be the shared object");
  assert.equal(TSL_FIELD_ALGORITHM, SHARED_FIELD_ALGORITHM, "TSL constants must be the shared object");
  assert.equal(FIELD_ALGORITHM, SHARED_FIELD_ALGORITHM, "field bundle must re-export shared constants");
  assert.deepEqual(CPU_FIELD_ALGORITHM, TSL_FIELD_ALGORITHM, "CPU and TSL constants must be identical");
  assert.deepEqual(Object.keys(FIELD_CHANNELS), ["r", "g", "b", "a"]);
  assert.deepEqual(Object.keys(FIELD_DERIVED_CHANNELS), ["r", "g", "b", "a"]);
}

function assertClose(actual, expected, maxError, label) {
  const error = Math.abs(actual - expected);
  assert(
    error <= maxError,
    `${label}: ${actual} differs from ${expected} by ${error}, tolerance ${maxError}`,
  );
  return error;
}

function validateGoldenFixtures() {
  assert.equal(fixtures.version, 1);
  assert.deepEqual(fixtures.channels, FIELD_PARITY_CHANNELS);
  assert.deepEqual(
    fixtures.probes.map((entry) => entry.probe),
    fixedProbes,
    "golden fixture probes must match fixedProbes",
  );

  let maxAbsError = 0;
  const samples = fixtures.probes.map((entry, probeIndex) => {
    const sample = sampleFieldCPU(entry.probe);
    const channelErrors = {};
    for (const channel of FIELD_PARITY_CHANNELS) {
      const error = assertClose(
        sample[channel],
        entry.values[channel],
        fixtureTolerance,
        `fixture probe ${probeIndex} ${channel}`,
      );
      channelErrors[channel] = error;
      maxAbsError = Math.max(maxAbsError, error);
    }
    return {
      probe: entry.probe,
      maxAbsError: Math.max(...Object.values(channelErrors)),
      channelErrors,
      macroHeight: sample.macroHeight,
      moisture: sample.moisture,
    };
  });

  return {
    pass: true,
    fixtureTolerance,
    maxAbsError,
    fixedProbes: samples.length,
    samples,
    coverage: {
      macroHeight: coverage(samples.map((sample) => sample.macroHeight)),
      moisture: coverage(samples.map((sample) => sample.moisture)),
    },
  };
}

function readGpuReadback(artifactDir) {
  const path = resolve(artifactDir, "field-readback.json");
  if (!existsSync(path)) {
    throw new Error(`GPU parity artifact missing: ${path}`);
  }
  return JSON.parse(readFileSync(path, "utf8"));
}

function validateGpuReadback(artifactDir) {
  const readback = readGpuReadback(artifactDir);
  assert.equal(readback.version, 1);
  assert.deepEqual(readback.channels, FIELD_PARITY_CHANNELS);
  assert(Array.isArray(readback.samples), "GPU readback samples must be an array");

  let maxAbsError = 0;
  let meanAbsError = 0;
  let count = 0;
  let placementGuardBandSamples = 0;
  const channelMaxErrors = Object.fromEntries(FIELD_PARITY_CHANNELS.map((channel) => [channel, 0]));
  const samples = readback.samples.map((entry, index) => {
    assert(entry.probe, `GPU readback sample ${index} is missing probe`);
    assert(entry.values, `GPU readback sample ${index} is missing values`);
    const cpu = sampleFieldCPU(entry.probe);
    const channelErrors = {};
    for (const channel of FIELD_PARITY_CHANNELS) {
      const actual = Number(entry.values[channel]);
      assert(Number.isFinite(actual), `GPU readback sample ${index} ${channel} is not finite`);
      const error = Math.abs(actual - cpu[channel]);
      channelErrors[channel] = error;
      channelMaxErrors[channel] = Math.max(channelMaxErrors[channel], error);
      maxAbsError = Math.max(maxAbsError, error);
      meanAbsError += error;
      count += 1;
      const tolerance = gpuParityTolerances[channel];
      if (error > tolerance) {
        throw new Error(
          `GPU parity ${channel} sample ${index} absError ${error} exceeds tolerance ${tolerance}`,
        );
      }
      if (channel === "placementMask") {
        const actualBit = actual >= placementMaskThreshold;
        const expectedBit = cpu[channel] >= placementMaskThreshold;
        const inGuardBand = Math.abs(cpu[channel] - placementMaskThreshold) <= gpuParityDerivation.thresholdGuardBand;
        if (inGuardBand) placementGuardBandSamples += 1;
        assert(
          actualBit === expectedBit || inGuardBand,
          `placementMask threshold mismatch outside guard band at sample ${index}`,
        );
      }
    }
    return {
      probe: entry.probe,
      channelErrors,
      maxAbsError: Math.max(...Object.values(channelErrors)),
    };
  });

  meanAbsError = count === 0 ? 0 : meanAbsError / count;
  return {
    pass: true,
    status: "passed",
    artifactDir,
    tolerances: gpuParityTolerances,
    derivation: gpuParityDerivation,
    maxAbsError,
    channelMaxErrors,
    meanAbsError,
    placementMaskThreshold,
    placementGuardBandSamples,
    samples,
  };
}

function validateSourceContract() {
  const source = [
    "README.md",
    "field-constants.mjs",
    "field-bundle.mjs",
    "field-bake.mjs",
    "browser-app.js",
    "capture.mjs",
    "validate-field-contract.mjs",
  ]
    .map((file) => readFileSync(resolve(here, file), "utf8"))
    .join("\n");

  for (const required of [
    "Fn(",
    "sampleField",
    "sampleFieldCPU",
    "sampleFieldDerived",
    "FIELD_ALGORITHM",
    "FIELD_PARITY_CHANNELS",
    "trilinear",
    "valueNoise3",
    "valueNoise3Node",
    "tangentWarp",
    "macroHeight",
    "packedChannels",
    "derivedChannels",
    "slope",
    "biome",
    "roughness",
    "placementMask",
    "StorageTexture",
    "textureStore",
    "readCount",
    "dirtyTile",
    "invalidate",
    "computeAsync",
    "maxAbsError",
    "meanAbsError",
    "coverage",
    "gpuParity",
    "fixedProbes",
    "tolerance",
    "process.exitCode",
    "Checkpoint",
    "must see",
    "if you see",
    "CPU-vs-TSL",
    "direct-vs-baked",
    "packed atlas",
  ]) {
    assert(source.includes(required), `missing ${required}`);
  }
}

function main() {
  const options = parseArgs(process.argv.slice(2));

  validateManifest();
  validateBakePlanning();
  validateSharedAlgorithm();
  const fixtureParity = validateGoldenFixtures();
  validateSourceContract();

  let gpuParity;
  if (options.artifacts) {
    gpuParity = validateGpuReadback(options.artifacts);
  } else {
    gpuParity = {
      pass: false,
      status: "not-run",
      requiredForBrowserAcceptance: true,
      reason:
        "Run examples/webgpu-field-bake/capture.mjs to generate field-readback.json, or pass --allow-missing-gpu for Layer 1 only.",
    };
    if (!options.allowMissingGpu) {
      process.exitCode = 1;
    }
  }

  const report = {
    structuralParity: {
      pass: true,
      sharedConstantsObject: true,
      channelPack: FIELD_CHANNELS,
      derivedChannelPack: FIELD_DERIVED_CHANNELS,
    },
    fixtureParity,
    gpuParity,
  };

  const reportPath =
    process.env.FIELD_VALIDATION_REPORT ??
    resolve(tmpdir(), "webgpu-field-bake-validation.json");
  writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`);

  if (process.exitCode) {
    throw new Error(
      `GPU parity ${gpuParity.status}; rerun with --artifacts <dir> or --allow-missing-gpu. Layer 1 report: ${reportPath}`,
    );
  }

  console.log(`webgpu-field-bake validation passed: ${reportPath}`);
}

main();
