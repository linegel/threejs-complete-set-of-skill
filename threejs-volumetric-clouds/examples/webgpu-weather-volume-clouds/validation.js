import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync, statSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import {
  CLOUD_TIER_BUDGETS,
  DEFAULT_CLOUD_LAYERS,
  CLOUD_ASSET_MANIFEST_RELATIVE_PATH,
  createDefaultCloudConfig,
  estimateTierMarchWork,
  packCloudLayerIntervals,
  validateQualityTierBudgets,
  validateCloudConfig,
} from "./cloud-config.js";
import {
  createCloudCompositeContract,
  validateCloudCompositeContract,
} from "./cloud-composite.js";
import {
  createTemporalCloudHistoryConfig,
  createTemporalResolveDependencySet,
  depthReject,
  historyUV,
  validateTemporalCloudHistory,
  varianceClip,
} from "./cloud-history.js";
import {
  createCloudBeautyNodeContract,
  henyeyGreenstein,
  multiScattering,
  runPureJsCloudMarchMirror,
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
assert.equal(valid.tierBudget.ok, true, valid.tierBudget.errors.join("\n"));

const tierBudget = validateQualityTierBudgets(
  defaultConfig.qualityTiers,
  defaultConfig.referenceViewport,
);
assert.equal(tierBudget.ok, true, tierBudget.errors.join("\n"));

for (const [name, tier] of Object.entries(defaultConfig.qualityTiers)) {
  const budget = CLOUD_TIER_BUDGETS[name];
  const work = estimateTierMarchWork(tier, defaultConfig.referenceViewport);
  const maximumWork = estimateTierMarchWork(
    {
      ...tier,
      linearResolutionScale: budget.linearResolutionScale[1],
      primarySteps: budget.primarySteps[1],
      lightSteps: budget.lightSteps[1],
    },
    defaultConfig.referenceViewport,
  );
  assert(
    work.primaryLightProduct <= maximumWork.primaryLightProduct,
    `${name} march work exceeds tier table product`,
  );

  const mirrorConfig = createDefaultCloudConfig({
    qualityTier: name,
    qualityTiers: defaultConfig.qualityTiers,
  });
  const mirror = runPureJsCloudMarchMirror({ config: mirrorConfig });
  assert.equal(mirror.tier, name);
  assert.equal(mirror.configuredProduct, work.primaryLightProduct);
  assert(mirror.primaryIterations > 0);
  assert(mirror.lightIterations > 0);
}

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

const inducedStepViolation = createDefaultCloudConfig();
inducedStepViolation.qualityTiers.default.primarySteps = 320;
expectInvalid(inducedStepViolation, "default primarySteps");

const historyConfig = createTemporalCloudHistoryConfig();
assert.equal(validateTemporalCloudHistory(historyConfig).ok, true);
const dependencySet = createTemporalResolveDependencySet(historyConfig);
for (const dependency of [
  "historyUVFromVelocity",
  "currentRepresentativeDepthMeters",
  "historyRepresentativeDepthMeters",
  "depthRejectMeters",
  "velocityRejectPixels",
  "varianceClip",
]) {
  assert(dependencySet.has(dependency), `temporal dependency missing ${dependency}`);
}
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
assert.equal(typeof cloudSystem.createComputeKernels, "function");
assert.equal(cloudSystem.createComputeDispatchDescriptors, undefined);

console.log("webgpu-weather-volume-clouds validation passed");
