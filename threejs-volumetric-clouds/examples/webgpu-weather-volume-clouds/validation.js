import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync, statSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import {
  DEFAULT_CLOUD_LAYERS,
  CLOUD_ASSET_MANIFEST_RELATIVE_PATH,
  createDefaultCloudConfig,
  packCloudLayerIntervals,
  validateCloudConfig,
} from "./cloud-config.js";
import {
  createCloudCompositeContract,
  validateCloudCompositeContract,
} from "./cloud-composite.js";
import {
  createTemporalCloudHistoryConfig,
  depthReject,
  historyUV,
  validateTemporalCloudHistory,
  varianceClip,
} from "./cloud-history.js";
import {
  createCloudBeautyNodeContract,
  henyeyGreenstein,
  multiScattering,
  stepTransmittance,
} from "./cloud-nodes.js";
import {
  createCloudShadowCascadeConfig,
  validateCloudShadowConfig,
} from "./cloud-shadows.js";
import { WebGPUWeatherVolumeClouds } from "./webgpu-weather-volume-clouds.js";

const here = dirname(fileURLToPath(import.meta.url));
const manifestPath = resolve(here, CLOUD_ASSET_MANIFEST_RELATIVE_PATH);
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

function assertManifestFiles() {
  for (const asset of manifest.assets) {
    const assetPath = resolve(manifestDir, asset.path);
    assert.equal(statSync(assetPath).size, asset.byteLength, asset.id);
    assert.equal(sha256(assetPath), asset.sha256, asset.id);
    if (asset.path.endsWith(".png")) {
      assert.deepEqual(pngDimensions(assetPath), {
        width: asset.width,
        height: asset.height,
      });
    }
  }
}

function expectInvalid(config, expectedText, assetManifest = manifest) {
  const result = validateCloudConfig(config, assetManifest);
  assert.equal(result.ok, false, "config should be invalid");
  assert(
    result.errors.some((error) => error.includes(expectedText)),
    `expected validation error containing "${expectedText}", got ${result.errors.join("; ")}`,
  );
}

assertManifestFiles();

const intervals = packCloudLayerIntervals(DEFAULT_CLOUD_LAYERS);
assert.deepEqual(intervals.occupiedBands, [
  [750, 2200],
  [7500, 8000],
]);
assert.deepEqual(intervals.packedGaps, [[2200, 7500]]);

const defaultConfig = createDefaultCloudConfig();
const valid = validateCloudConfig(defaultConfig, manifest);
assert.equal(valid.ok, true, valid.errors.join("\n"));
assert(valid.storage.bytes > 0);

const swappedIntervals = createDefaultCloudConfig();
swappedIntervals.intervalContract = {
  ...swappedIntervals.intervalContract,
  packedGaps: intervals.occupiedBands,
};
expectInvalid(swappedIntervals, "empty gaps");

const invalidManifest = structuredClone(manifest);
invalidManifest.assets.find((asset) => asset.id === "local-weather").width = 256;
expectInvalid(defaultConfig, "local-weather width", invalidManifest);

const missingVelocity = createDefaultCloudConfig();
missingVelocity.temporal = {
  ...missingVelocity.temporal,
  velocityTarget: "",
};
expectInvalid(missingVelocity, "velocity target");

const impossibleShadow = createDefaultCloudConfig();
impossibleShadow.cloudShadow = {
  ...impossibleShadow.cloudShadow,
  cascadeCount: 8,
  resolution: 4096,
};
expectInvalid(impossibleShadow, "cascade layout");

const outOfBudget = createDefaultCloudConfig({ storageBudgetMB: 1 });
expectInvalid(outOfBudget, "exceeds budget");

const historyConfig = createTemporalCloudHistoryConfig();
assert.equal(validateTemporalCloudHistory(historyConfig).ok, true);
assert.deepEqual(historyUV({ x: 0.5, y: 0.5 }, { x: 12, y: -8 }, { width: 480, height: 270 }), {
  x: 0.475,
  y: 0.5296296296296297,
});
assert.equal(depthReject(1000, 1180, 120), true);
assert.equal(varianceClip(10, 4, 2, 1.5), 7);

const shadowConfig = createCloudShadowCascadeConfig();
const shadowValid = validateCloudShadowConfig(shadowConfig);
assert.equal(shadowValid.ok, true, shadowValid.errors.join("\n"));
assert(shadowValid.bytes > 0);

const composite = createCloudCompositeContract();
assert.equal(validateCloudCompositeContract(composite).ok, true);

const beauty = createCloudBeautyNodeContract();
assert(beauty.lighting.phase.includes("henyeyGreenstein"));
assert(beauty.lighting.shadow.includes("opticalDepth"));
assert(beauty.temporalOutputs.depthReject.includes("history"));

assert(Number.isFinite(henyeyGreenstein(0.25, 0.7)));
assert(stepTransmittance(0.02, 100) < 1);
assert(multiScattering({ opticalDepth: 1.2, cosTheta: 0.4 }) > 0);

const cloudSystem = new WebGPUWeatherVolumeClouds({
  config: defaultConfig,
  assetManifest: manifest,
});
const resources = cloudSystem.createResourcePlan();
assert.equal(resources.storageTextureClass, "StorageTexture");
assert.equal(resources.storage3DTextureClass, "Storage3DTexture");
assert.equal(cloudSystem.createPassGraph().renderer, "WebGPURenderer");
assert(
  cloudSystem
    .createComputeDispatchDescriptors()
    .some((dispatch) => dispatch.api.includes("renderer.computeAsync")),
);

const sourceFiles = [
  "cloud-composite.js",
  "cloud-config.js",
  "cloud-history.js",
  "cloud-nodes.js",
  "cloud-shadows.js",
  "webgpu-weather-volume-clouds.js",
].map((file) => readFileSync(resolve(here, file), "utf8"));
const source = sourceFiles.join("\n");

for (const required of [
  "multiScattering",
  "henyeyGreenstein",
  "stepTransmittance",
  "representativeDepth",
  "groundBounce",
  "cloudShadowCascade",
  "opticalDepth",
  "shadowUpdateCadence",
  "storageTexture",
  "historyUV",
  "depthReject",
  "varianceClip",
  "Storage3DTexture",
  "RenderPipeline",
]) {
  assert(source.includes(required), `missing ${required}`);
}

for (const forbidden of [
  "RawShaderMaterial",
  "WebGLRenderTarget",
  "resolutionScale = 0.85",
  "toneMap(",
  "pow(color, vec3(1.0 / 2.2))",
]) {
  assert(!source.includes(forbidden), `canonical source contains ${forbidden}`);
}

console.log("webgpu-weather-volume-clouds validation passed");
