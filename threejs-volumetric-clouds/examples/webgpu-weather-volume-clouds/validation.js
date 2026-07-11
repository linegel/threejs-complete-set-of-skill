import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync, statSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import {
  CLOUD_STORAGE_RESOURCE_LAYOUT,
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
  currentFrameWeightFromResponseTime,
  depthReject,
  historyUV,
  historyUVInBounds,
  validateTemporalCloudHistory,
  varianceClip,
} from "./cloud-history.js";
import {
  CLOUD_BEAUTY_KERNEL_STATUS,
  createCloudBeautyNodeContract,
  dualHenyeyGreenstein,
  henyeyGreenstein,
  integrateCloudStep,
  multiScattering,
  runPureJsCloudMarchMirror,
  stepTransmittance,
} from "./cloud-nodes.js";
import {
  createCloudShadowCascadeConfig,
  sampleCloudShadowTransmission,
  validateCloudShadowConfig,
} from "./cloud-shadows.js";
import {
  WebGPUWeatherVolumeClouds,
  createWeatherCloudStage,
} from "./webgpu-weather-volume-clouds.js";
import {
  CLOUD_DOMAIN_FIXTURES,
  clampCloudIntervalToSceneDepth,
  intersectObb,
  intersectPlanarSlab,
  intersectSphericalShell,
  normalize3,
} from "./cloud-domains.js";
import { NearestFilter, Storage3DTexture, StorageTexture } from "three/webgpu";
import { vec3 } from "three/tsl";

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

const upward = normalize3([0, 1, -0.2]);
const shellInterval = intersectSphericalShell({
  origin: [0, 200, 18000],
  direction: upward,
  center: CLOUD_DOMAIN_FIXTURES.shell.center,
  innerRadius: CLOUD_DOMAIN_FIXTURES.shell.innerRadius,
  outerRadius: CLOUD_DOMAIN_FIXTURES.shell.outerRadius,
});
assert.equal(shellInterval.hit, true);
assert(shellInterval.far > shellInterval.near && shellInterval.near >= 0);
const slabInterval = intersectPlanarSlab({
  origin: [0, 200, 0],
  direction: upward,
  minimumHeight: CLOUD_DOMAIN_FIXTURES.slab.minimumHeight,
  maximumHeight: CLOUD_DOMAIN_FIXTURES.slab.maximumHeight,
  horizontalHalfExtent: CLOUD_DOMAIN_FIXTURES.slab.horizontalHalfExtent,
});
assert.equal(slabInterval.hit, true);
assert(slabInterval.far > slabInterval.near);
const obbInterval = intersectObb({
  origin: [0, 3200, 20000],
  direction: normalize3([0, 0, -1]),
  center: CLOUD_DOMAIN_FIXTURES.obb.center,
  halfExtents: CLOUD_DOMAIN_FIXTURES.obb.halfExtents,
  worldToLocalRows: CLOUD_DOMAIN_FIXTURES.obb.worldToLocalRows,
});
assert.equal(obbInterval.hit, true);
const sceneClamped = clampCloudIntervalToSceneDepth(shellInterval, shellInterval.near + 100);
assert.equal(sceneClamped.far, shellInterval.near + 100);
assert.equal(sceneClamped.hit, true);

const defaultConfig = createDefaultCloudConfig();
const valid = validateCloudConfig(defaultConfig, manifest);
assert.equal(valid.ok, true, valid.errors.join("\n"));
assert(valid.storage.bytes > 0);
assert.equal(
  valid.storage.parts.shadowCascades,
  defaultConfig.cloudShadow.cascadeCount *
    defaultConfig.cloudShadow.resolution ** 2 *
    CLOUD_STORAGE_RESOURCE_LAYOUT.shadowCascades.bytesPerTexel,
);
const lowResolutionPixels =
  valid.storage.lowResolution.width * valid.storage.lowResolution.height;
for (const [partName, resource] of Object.entries(
  CLOUD_STORAGE_RESOURCE_LAYOUT.lowResolution,
)) {
  assert.equal(
    valid.storage.parts[partName],
    lowResolutionPixels * resource.bytesPerTexel * resource.slots.length,
    `${partName} must match its declared format and live slots`,
  );
}
const depthMotionParts = [
  "representativeDepthCurrentAndHistory",
  "velocityCurrentAndHistory",
  "depthMomentsCurrentAndHistory",
];
assert.equal(
  valid.storage.parts.depthMotionCurrentAndHistory,
  depthMotionParts.reduce(
    (bytes, partName) => bytes + valid.storage.parts[partName],
    0,
  ),
);
assert.equal(
  valid.storage.bytes,
  Object.values(CLOUD_STORAGE_RESOURCE_LAYOUT.lowResolution).reduce(
    (bytes, resource) =>
      bytes + lowResolutionPixels * resource.bytesPerTexel * resource.slots.length,
    valid.storage.parts.shadowCascades,
  ),
);
assert.equal(
  defaultConfig.cloudShadow[
    CLOUD_STORAGE_RESOURCE_LAYOUT.shadowCascades.updateCadenceFrom
  ],
  defaultConfig.cloudShadow.shadowUpdateCadence,
);
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
const canonicalShadowTiers = {
  ultra: [3, 1024],
  high: [3, 512],
  default: [2, 384],
  mobile: [1, 256],
};
for (const [tier, [cascadeCount, resolution]] of Object.entries(canonicalShadowTiers)) {
  const tierConfig = createDefaultCloudConfig({ qualityTier: tier });
  assert.equal(tierConfig.cloudShadow.cascadeCount, cascadeCount, `${tier} shadow count`);
  assert.equal(tierConfig.cloudShadow.resolution, resolution, `${tier} shadow resolution`);
}
const reusableCloudStage = createWeatherCloudStage({ config: defaultConfig, assetManifest: manifest });
assert.equal(reusableCloudStage.system.renderer, undefined, "integration stage must not own a renderer");
assert.equal(reusableCloudStage.system.hostPipeline, undefined, "integration stage must not own a pipeline");

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

const invalidCameraDepthRange = createDefaultCloudConfig();
invalidCameraDepthRange.camera.farMeters = invalidCameraDepthRange.camera.nearMeters;
expectInvalid(invalidCameraDepthRange, "nearMeters/farMeters");

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
assert.equal(historyConfig.claimLevel, "scaffold-only");
assert.equal(historyConfig.samplingArchitecture, "full-low-resolution-grid-every-frame");
assert.equal(historyConfig.runtimeEvidence, "not-run");
assert(historyConfig.implemented.some((item) => item.includes("variance clipping")));
assert(historyConfig.implemented.some((item) => item.includes("explicit reset")));
assert.equal(
  historyConfig.currentFrameWeight,
  currentFrameWeightFromResponseTime(1 / 60, 0.13),
);
const dependencySet = createTemporalResolveDependencySet(historyConfig);
for (const dependency of [
  "historyUVFromCloudVelocity",
  "metricRepresentativeDepthR32F",
  "depthRejectMeters",
  "velocityRejectPixels",
  "viewportBoundsRejectBeforeClamp",
]) {
  assert(dependencySet.has(dependency), `temporal dependency missing ${dependency}`);
}
assert.deepEqual(historyUV({ x: 0.5, y: 0.5 }, { x: 12, y: -8 }, { width: 480, height: 270 }), {
  x: 0.475,
  y: 0.5296296296296297,
});
assert.equal(historyUVInBounds({ x: 0.5, y: 0.5 }), true);
assert.equal(historyUVInBounds({ x: -0.01, y: 0.5 }), false);
assert.equal(depthReject(1000, 1180, 120), true);
assert.equal(varianceClip(10, 4, 2, 1.5), 7);

const shadowConfig = createCloudShadowCascadeConfig();
const shadowValid = validateCloudShadowConfig(shadowConfig);
assert.equal(shadowValid.ok, true, shadowValid.errors.join("\n"));
assert(shadowValid.bytes > 0);
assert.equal(shadowConfig.format, "R16F");
assert.deepEqual(shadowConfig.channelLayout, ["opticalDepth"]);
assert.equal(shadowConfig.decoder.depthResolved, false);
assert.equal(shadowConfig.claimLevel, "scaffold-only");
assert.equal(shadowConfig.runtimeEvidence, "not-run");
assert(shadowConfig.implementationStatus.includes("not implemented"));

const composite = createCloudCompositeContract();
assert.equal(validateCloudCompositeContract(composite).ok, true);
assert.equal(composite.claimLevel, "source-implemented");

const beauty = createCloudBeautyNodeContract();
assert.equal(beauty.claimLevel, "scaffold-only");
assert.equal(beauty.conformingRenderer, false);
assert.equal(CLOUD_BEAUTY_KERNEL_STATUS.sourceImplemented, true);
assert.equal(CLOUD_BEAUTY_KERNEL_STATUS.runtimeEvidence, "not-run");
assert.deepEqual(beauty.notImplemented, CLOUD_BEAUTY_KERNEL_STATUS.notImplemented);
assert(beauty.lighting.phase.includes("Henyey-Greenstein"));
assert(beauty.lighting.shadow.includes("separate product"));
assert(beauty.temporalOutputs.velocity.includes("current-minus-previous"));
assert(beauty.temporalOutputs.varianceClip.includes("implemented"));

assert(Number.isFinite(henyeyGreenstein(0.25, 0.7)));
assert(Number.isFinite(dualHenyeyGreenstein(0.25)));
assert(stepTransmittance(0.02, 100) < 1);
assert(multiScattering({ opticalDepth: 1.2, cosTheta: 0.4 }) > 0);

for (const g of [-0.25, 0, 0.72]) {
  const sampleCount = 20000;
  let integral = 0;
  for (let index = 0; index < sampleCount; index += 1) {
    const mu = -1 + (index + 0.5) * 2 / sampleCount;
    integral += henyeyGreenstein(mu, g) * 2 / sampleCount * 2 * Math.PI;
  }
  assert(Math.abs(integral - 1) < 2e-6, `HG phase integral for g=${g} is ${integral}`);
}

const oneStep = integrateCloudStep({
  sourceCoefficient: 0.4,
  extinction: 0.2,
  stepLengthMeters: 10,
  accumulatedTransmittance: 1,
});
const firstPartition = integrateCloudStep({
  sourceCoefficient: 0.4,
  extinction: 0.2,
  stepLengthMeters: 4,
  accumulatedTransmittance: 1,
});
const secondPartition = integrateCloudStep({
  sourceCoefficient: 0.4,
  extinction: 0.2,
  stepLengthMeters: 6,
  accumulatedTransmittance: firstPartition.transmittance,
});
assert(Math.abs(oneStep.radiance - (firstPartition.radiance + secondPartition.radiance)) < 1e-12);
assert(Math.abs(oneStep.transmittance - secondPartition.transmittance) < 1e-12);

const cloudSystem = new WebGPUWeatherVolumeClouds({
  config: defaultConfig,
  assetManifest: manifest,
});
const resources = cloudSystem.createResourcePlan();
assert.equal(resources.storageTextureClass, "StorageTexture");
assert.equal(resources.storage3DTextureClass, "Storage3DTexture");
assert.equal(cloudSystem.createPassGraph().renderer, "WebGPURenderer");
assert.equal(cloudSystem.createPassGraph().claimLevel, "scaffold-only");
assert.equal(cloudSystem.createPassGraph().beautyContract.conformingRenderer, false);
assert.equal(typeof cloudSystem.createComputeKernels, "function");
assert.equal(cloudSystem.createComputeDispatchDescriptors, undefined);

const texture2D = () => new StorageTexture(8, 8);
const texture3D = () => new Storage3DTexture(8, 8, 8);
const kernelSystem = new WebGPUWeatherVolumeClouds({
  config: defaultConfig,
  assetManifest: manifest,
  viewport: { width: 32, height: 32 },
});
const kernelResources = kernelSystem.createStorageResources();
const hostSceneDepth = texture2D();
kernelResources.fields = {
  localWeather: texture2D(),
  shape: texture3D(),
  shapeDetail: texture3D(),
  turbulence: texture2D(),
  stbn: texture3D(),
};
const kernels = kernelSystem.createComputeKernels({
  targets: kernelResources,
  sceneDepthTexture: hostSceneDepth,
  timeSeconds: 12.5,
  deltaTimeSeconds: 1 / 60,
  frameIndex: 7,
});
const receiverTransmission = sampleCloudShadowTransmission({
  worldPositionNode: vec3(0),
  shadowTextures: kernelResources.shadow,
  shadowConfig: createCloudShadowCascadeConfig({ tier: defaultConfig.qualityTier }),
});
assert.equal(receiverTransmission.isNode, true);
assert.equal(kernels.cloudShadow.length, defaultConfig.cloudShadow.cascadeCount);
assert(kernels.cloudShadow.every((node) => node.name.startsWith("cloud:sun-optical-depth:cascade-")));
assert.equal(kernels.cloudBeauty.length, 2);
assert.equal(kernels.cloudBeauty[0].cloudTimeSeconds, 12.5);
assert.equal(kernels.cloudBeauty[0].cloudFrameIndex, 7);
assert.equal(kernels.cloudBeauty[0].cloudSequenceIndex, Math.floor(12.5 * 60));
assert.equal(kernels.cloudBeauty[1].cloudDeltaTimeSeconds, 1 / 60);
assert.equal(kernels.temporalResolve.length, 2);
assert(kernels.cloudBeauty.every((node) => node.cloudImplementationStatus?.claimLevel === "scaffold-only" || node.name.includes("projected-representative-point")));
assert(kernels.temporalResolve.every((node) => node.cloudImplementationStatus.claimLevel === "scaffold-only"));
assert.equal(kernels.maximumStorageTextureBindings, 3);
assert.equal(
  kernels.temporalResolve[0].cloudCurrentFrameWeight,
  currentFrameWeightFromResponseTime(1 / 60, defaultConfig.temporal.responseTimeSeconds),
);
assert([...kernels.cloudBeauty, ...kernels.temporalResolve].every((node) => node.cloudStorageTextureBindingCount <= 4));
assert.equal(kernelResources.current.sceneDepthMeters, undefined, "cloud resources must not allocate fabricated host depth");
assert.equal(kernelResources.current.representativeDepthMeters.minFilter, NearestFilter, "portable R32F depth sampling requires a non-filtering sampler");
assert.equal(kernelResources.describe().hostDepthSource, "sampled host scene-pass depth; no private constant-depth storage");
const persistentRadiance = kernelResources.current.radianceTransmittance;
const dispatched = [];
const fakeRenderer = {
  backend: { isWebGPUBackend: true },
  async compute(node) { dispatched.push(node.name); },
};
await kernelSystem.dispatchFrame(fakeRenderer, {
  targets: kernelResources,
  sceneDepthTexture: hostSceneDepth,
  timeSeconds: 0.5,
  deltaTimeSeconds: 1 / 60,
  frameIndex: 0,
});
assert.equal(kernelResources.current.radianceTransmittance, persistentRadiance, "dispatch must not recreate storage");
assert.equal(kernelSystem.lastResolvedIndex, 1);
assert.equal(kernelSystem.historyReadIndex, 1);
await kernelSystem.dispatchFrame(fakeRenderer, {
  targets: kernelResources,
  sceneDepthTexture: hostSceneDepth,
  timeSeconds: 0.5,
  deltaTimeSeconds: 1 / 120,
  frameIndex: 1,
});
assert.equal(kernelSystem.lastResolvedIndex, 0);
assert.equal(kernelSystem.historyReadIndex, 0);
assert.equal(kernelResources.current.radianceTransmittance, persistentRadiance);
assert.equal(
  kernelSystem.lastKernels.temporalResolve[0].cloudCurrentFrameWeight,
  currentFrameWeightFromResponseTime(1 / 120, defaultConfig.temporal.responseTimeSeconds),
  "temporal response must use actual deltaTimeSeconds",
);
assert(dispatched.includes("cloud:temporal-resolve-color-depth-rejection"));
assert(dispatched.includes("cloud:temporal-resolve-auxiliary-history"));
assert.equal(
  dispatched.filter((name) => name.startsWith("cloud:sun-optical-depth:cascade-")).length,
  defaultConfig.cloudShadow.cascadeCount,
  "shadow cadence must derive from real time rather than presentation frame index",
);
kernelSystem.resetHistory("validation-cut");
assert.equal(kernelSystem.historyValid, false);
assert.equal(kernelResources.current.radianceTransmittance, persistentRadiance);
kernelSystem.dispose();
hostSceneDepth.dispose();
for (const texture of Object.values(kernelResources.fields)) {
  texture.dispose();
}

const fakeNonWebGPU = new WebGPUWeatherVolumeClouds({
  renderer: { backend: { isWebGPUBackend: false } },
  config: defaultConfig,
  assetManifest: manifest,
});
assert.throws(() => fakeNonWebGPU.selectQualityTier(), /WebGPU backend unavailable/);

const cloudNodeSource = readFileSync(resolve(here, "cloud-nodes.js"), "utf8");
assert(!cloudNodeSource.includes("add(turbulenceLift)"), "turbulence must warp coordinates, not add density");
assert(!cloudNodeSource.includes("hostVelocity"), "beauty scaffold must not claim opaque-surface velocity as cloud motion");
assert(cloudNodeSource.includes("representativeDepthMeters"));
assert(cloudNodeSource.includes("sourceCoefficient"));
assert(!cloudNodeSource.includes("frame * constants.timeSecondsPerFrame"), "cloud time must come from authored seconds, not frame count");
assert(cloudNodeSource.includes("domain.horizontalHalfExtent"), "TSL planar slab must enforce X/Z extent");

const cloudSystemSource = readFileSync(resolve(here, "webgpu-weather-volume-clouds.js"), "utf8");
assert(!cloudSystemSource.includes("selectBackendTier"));
assert(!cloudSystemSource.includes('return "reduced"'));
assert(cloudSystemSource.includes("WebGPU backend unavailable"));
assert(cloudSystemSource.includes("maximumStorageTextureBindings"));
assert(!cloudSystemSource.includes("cloud-host-scene-depth-r32f-meters"));

console.log("webgpu-weather-volume-clouds validation passed");
