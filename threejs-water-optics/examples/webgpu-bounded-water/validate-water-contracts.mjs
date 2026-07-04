import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { Vector2 } from "three/webgpu";
import {
  DEFAULT_WATER_PARAMETERS,
  WATER_QUALITY_TIERS,
  createReducedBoundedWaterMaterial,
  createReducedBoundedWaterMesh,
  createWebGPUBoundedWaterSystem,
  validateWaterConfig,
  waterCourantNumber,
} from "./index.js";

const here = dirname(fileURLToPath(import.meta.url));
const source = readFileSync(join(here, "webgpu-bounded-water.js"), "utf8");

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

const tiers = Object.fromEntries(
  Object.entries(WATER_QUALITY_TIERS).map(([name, tier]) => [
    name,
    validateWaterConfig({ tier, parameters: DEFAULT_WATER_PARAMETERS }),
  ]),
);

assert(Object.values(tiers).every((tier) => tier.courant <= tier.maxCourant), "Default water tiers must satisfy CFL/Courant stability.");

let rejectedUnsafeConfig = false;
try {
  validateWaterConfig({
    tier: WATER_QUALITY_TIERS.high,
    parameters: {
      ...DEFAULT_WATER_PARAMETERS,
      worldSize: new Vector2(1, 1),
    },
  });
} catch (error) {
  rejectedUnsafeConfig = /CFL|Courant/.test(error.message);
}

assert(rejectedUnsafeConfig, "Unsafe water config must fail the CFL/Courant gate.");
assert(waterCourantNumber({
  resolution: WATER_QUALITY_TIERS.high.resolution,
  fixedTimeStep: WATER_QUALITY_TIERS.high.fixedTimeStep,
  waveSpeed: DEFAULT_WATER_PARAMETERS.waveSpeed,
  worldSize: DEFAULT_WATER_PARAMETERS.worldSize,
}) === tiers.high.courant, "waterCourantNumber must match validateWaterConfig output.");

assert(source.includes("viewportLinearDepth"), "Depth-aware refraction must use viewportLinearDepth.");
assert(source.includes("perspectiveDepthToViewZ"), "Depth-aware refraction must convert raw depth to view-Z meters.");
assert(!source.includes("mul(80.0)"), "Raw nonlinear depth deltas must not be scaled by a magic meter factor.");
assert(!source.includes("frustumCulled = false"), "Water mesh must use computed bounds instead of disabling frustum culling.");
assert(source.includes("sceneColorNode: pipeline?.colorNode"), "Material must consume pipeline-owned scene color when available.");
assert(source.includes("sceneDepthNode: pipeline?.depthNode"), "Material must consume pipeline-owned depth when available.");
assert(source.includes("refract(lightIncident"), "Caustic kernels must use refracted ray-bundle sampling.");
assert(source.includes("heightfield: null"), "Explicit WebGPU-unavailable handling must not expose a live heightfield.");
assert(source.includes("usesStorageTexture: false"), "Reduced material and mesh must advertise that they do not sample live StorageTextures.");

const reducedMaterial = createReducedBoundedWaterMaterial();
assert(reducedMaterial.userData.reducedTier === true, "Reduced material must mark itself as reduced-tier.");
assert(reducedMaterial.userData.usesStorageTexture === false, "Reduced material must not use StorageTexture sampling.");
assert(reducedMaterial.userData.waterStateTextureNode === undefined, "Reduced material must not expose a water state texture node.");
assert(reducedMaterial.userData.normalCausticTextureNode === undefined, "Reduced material must not expose a normal/caustic texture node.");

const reducedMesh = createReducedBoundedWaterMesh({ material: reducedMaterial });
assert(reducedMesh.userData.reducedTier.tier === "reduced", "Reduced mesh must mark its tier.");
assert(reducedMesh.userData.reducedTier.usesStorageTexture === false, "Reduced mesh must not depend on live StorageTextures.");
assert(reducedMesh.geometry.boundingBox !== null, "Reduced mesh must have computed culling bounds.");

const fakeReducedRenderer = {
  backend: { isWebGPUBackend: false },
  outputColorSpace: "srgb",
  async init() {},
};

let rejectedImplicitFallback = false;
try {
  await createWebGPUBoundedWaterSystem(fakeReducedRenderer, { tier: "ultra" });
} catch (error) {
  rejectedImplicitFallback = /opt-in|explicitly asks/.test(error.message);
}

assert(rejectedImplicitFallback, "Fallback teaching for missing WebGPU must require explicit opt-in.");

const reducedSystem = await createWebGPUBoundedWaterSystem(fakeReducedRenderer, {
  tier: "ultra",
  explicitFallbackWhenWebGPUUnavailable: true,
});
assert(reducedSystem.backendIsWebGPU === false, "Fake renderer should exercise the explicit WebGPU-unavailable handling.");
assert(reducedSystem.tier === "reduced", "Explicit WebGPU-unavailable handling must select the reduced tier.");
assert(reducedSystem.heightfield === null, "Explicit WebGPU-unavailable handling must not create a StorageTexture heightfield.");
assert(reducedSystem.material.userData.usesStorageTexture === false, "Explicit WebGPU-unavailable material must not sample StorageTextures.");
assert(reducedSystem.mesh.userData.reducedTier.usesStorageTexture === false, "Explicit WebGPU-unavailable mesh must not depend on StorageTextures.");
assert(reducedSystem.configValidation.pass === true, "Reduced tier config validation must pass.");

reducedSystem.dispose();
reducedMesh.geometry.dispose();
reducedMaterial.dispose();

console.log(JSON.stringify({
  pass: true,
  tiers,
  rejectedUnsafeConfig,
  rejectedImplicitFallback,
  reducedTierUsesStorageTexture: false,
  checks: [
    "CFL/Courant gate",
    "depth-to-viewZ meters",
    "pipeline-owned scene color/depth",
    "computed culling bounds",
    "refracted ray-bundle caustics",
    "explicit opt-in fallback teaching when WebGPU is unavailable",
  ],
}, null, 2));
