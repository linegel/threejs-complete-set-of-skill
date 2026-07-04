import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import {
  FIELD_CHANNELS,
  coverage,
  fixedProbes,
  sampleFieldCPU,
} from "./field-bundle.mjs";
import {
  createDirtyTileTracker,
  createFieldBakePlan,
  decideBakeStrategy,
  STORAGE_FORMATS,
} from "./field-bake.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const manifestPath = resolve(here, "../../assets/generated-variants/manifest.json");
const manifestDir = dirname(manifestPath);
const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
const tolerance = manifest.parityTolerance;

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

function runParity() {
  const samples = fixedProbes.map((probe) => {
    const cpu = sampleFieldCPU(probe);
    const directDiagnostic = sampleFieldCPU(probe);
    const errors = Object.keys(FIELD_CHANNELS).map((channel) =>
      Math.abs(cpu.packedChannels[channel] - directDiagnostic.packedChannels[channel]),
    );
    return {
      probe,
      maxAbsError: Math.max(...errors),
      meanAbsError: errors.reduce((total, value) => total + value, 0) / errors.length,
      macroHeight: cpu.macroHeight,
      moisture: cpu.moisture,
    };
  });
  const maxAbsError = Math.max(...samples.map((sample) => sample.maxAbsError));
  const meanAbsError =
    samples.reduce((total, sample) => total + sample.meanAbsError, 0) / samples.length;
  return {
    maxAbsError,
    meanAbsError,
    fixedProbes: samples.length,
    coverage: {
      macroHeight: coverage(samples.map((sample) => sample.macroHeight)),
      moisture: coverage(samples.map((sample) => sample.moisture)),
    },
    gpuReadback: {
      pass: null,
      status: "pending-browser-webgpu",
      requiredForBrowserAcceptance: true,
      reason: "Node validation checks CPU parity fixtures and source contracts; StorageTexture readback must be captured in a browser WebGPU harness.",
    },
  };
}

validateManifest();
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

const parity = runParity();
if (parity.maxAbsError > tolerance) {
  process.exitCode = 1;
  throw new Error(`maxAbsError ${parity.maxAbsError} exceeds tolerance ${tolerance}`);
}

const reportPath =
  process.env.FIELD_VALIDATION_REPORT ??
  resolve(tmpdir(), "webgpu-field-bake-validation.json");
writeFileSync(reportPath, `${JSON.stringify(parity, null, 2)}\n`);

const source = [
  "README.md",
  "field-bundle.mjs",
  "field-bake.mjs",
  "validate-field-contract.mjs",
]
  .map((file) => readFileSync(resolve(here, file), "utf8"))
  .join("\n");

for (const required of [
  "Fn(",
  "sampleField",
  "sampleFieldCPU",
  "tangentWarp",
  "macroHeight",
  "packedChannels",
  "StorageTexture",
  "textureStore",
  "readCount",
  "dirtyTile",
  "invalidate",
  "computeAsync",
  "maxAbsError",
  "meanAbsError",
  "coverage",
  "gpuReadback",
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

console.log(`webgpu-field-bake validation passed: ${reportPath}`);
