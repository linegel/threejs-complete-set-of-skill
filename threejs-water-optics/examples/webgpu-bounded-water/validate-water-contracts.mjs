import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { Vector2 } from "three/webgpu";
import { float, linearDepth, viewportLinearDepth } from "three/tsl";
import {
  DEFAULT_WATER_PARAMETERS,
  WATER_QUALITY_TIERS,
  analyticSurfaceHeightAt,
  createBoundedWaterHeightQuery,
  createWebGPUBoundedWaterSystem,
  estimateHeightfieldResidualBound,
  getWaterHeight,
  validateWaterConfig,
  waterCourantNumber,
} from "./index.js";

const here = dirname(fileURLToPath(import.meta.url));
const source = readFileSync(join(here, "webgpu-bounded-water.js"), "utf8");
const cpuHeightSource = readFileSync(join(here, "cpu-water-height.js"), "utf8");
const readme = readFileSync(join(here, "README.md"), "utf8");
const reference = readFileSync(join(here, "../../references/water-surface-system.md"), "utf8");

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

const analyticProbe = { x: 1.25, z: -0.75, time: 2.5 };
const query = createBoundedWaterHeightQuery();
const directHeight = getWaterHeight(analyticProbe.x, analyticProbe.z, analyticProbe.time);
const queryHeight = query.getWaterHeight(analyticProbe.x, analyticProbe.z, analyticProbe.time);
const existingHeight = analyticSurfaceHeightAt(analyticProbe.x, analyticProbe.z, analyticProbe.time);
assert(Math.abs(directHeight - existingHeight) < 1e-12, "getWaterHeight must exactly match the authored analytic wave evaluator.");
assert(Math.abs(queryHeight - existingHeight) < 1e-12, "createBoundedWaterHeightQuery must expose the same getWaterHeight contract.");
assert(estimateHeightfieldResidualBound() === DEFAULT_WATER_PARAMETERS.dropStrength + DEFAULT_WATER_PARAMETERS.objectDisplacementScale, "Heightfield residual bound must match the declared drop/object amplitude budget.");
assert(!cpuHeightSource.includes("copyTextureToBuffer") && !cpuHeightSource.includes("readRenderTargetPixels"), "Bounded CPU water-height contract must not use GPU readback.");

const linearDepthProbe = linearDepth(float(0.5));
assert(typeof viewportLinearDepth !== "function", "viewportLinearDepth is a const node in Three.js r185, not a callable function.");
assert(linearDepthProbe !== undefined, "linearDepth(float(...)) must construct a TSL depth conversion node.");

assert(source.includes("linearDepth(sampledDepth)"), "Depth-aware refraction must call linearDepth(sampledDepth).");
assert(source.includes("linearDepth(currentDepth)"), "Depth-aware refraction must call linearDepth(currentDepth).");
assert(!source.includes("viewportLinearDepth("), "Depth-aware refraction must not call viewportLinearDepth(...); it is not callable in r185.");
assert(source.includes("perspectiveDepthToViewZ"), "Depth-aware refraction must convert raw depth to view-Z meters.");
assert(!source.includes("mul(80.0)"), "Raw nonlinear depth deltas must not be scaled by a magic meter factor.");
assert(!source.includes("frustumCulled = false"), "Water mesh must use computed bounds instead of disabling frustum culling.");
assert(source.includes("createBoundedWaterRenderPipeline(renderer, sceneColorScene, camera)"), "System must build refraction inputs from a separate sceneColorScene.");
assert(source.includes("pass(opaqueScene, camera)"), "Render pipeline must render an opaque scene, not the live water scene.");
assert(source.includes("sceneColorNode: pipeline?.colorNode"), "Material must consume pipeline-owned scene color when available.");
assert(source.includes("sceneDepthNode: pipeline?.depthNode"), "Material must consume pipeline-owned depth when available.");
assert(source.includes("refract(lightIncident"), "Caustic kernels must use refracted ray-bundle sampling.");
assert(!source.includes("explicitFallbackWhenWebGPUUnavailable"), "Flagship water skill must not carry an in-skill fallback teaching branch.");
assert(!source.includes("createReducedBoundedWaterMaterial"), "Flagship water skill must not export reduced fallback material recipes.");
assert(!source.includes("createReducedBoundedWaterMesh"), "Flagship water skill must not export reduced fallback mesh recipes.");
assert(source.includes("../threejs-compatibility-fallbacks/"), "Non-WebGPU routing message must point to the compatibility fallback skill.");

for (const row of ["`coord`", "`coordUv`", "`world`", "`height/velocity`", "`normalCaustic.rg`", "`refractedUv`", "depth samples", "color samples", "data textures"]) {
  assert(reference.includes(row), `Reference interface-space table missing ${row}.`);
}
assert(reference.includes("linearDepth(value)") && reference.includes("view-Z meters"), "Reference must define raw depth to view-Z meter conversion.");

const checkpointCount = (readme.match(/You must see/g) ?? []).length;
const mistakeCount = (readme.match(/if /g) ?? []).length;
assert(checkpointCount >= 7, `README must contain at least seven build checkpoints, got ${checkpointCount}.`);
assert(mistakeCount >= 7, `README checkpoints must include likely mistakes, got ${mistakeCount}.`);

const fakeReducedRenderer = {
  backend: { isWebGPUBackend: false },
  outputColorSpace: "srgb",
  async init() {},
};

let rejectedNonWebGPU = false;
try {
  await createWebGPUBoundedWaterSystem(fakeReducedRenderer, { tier: "ultra" });
} catch (error) {
  rejectedNonWebGPU = /WebGPU backend required/.test(error.message) &&
    /threejs-compatibility-fallbacks/.test(error.message);
}

assert(rejectedNonWebGPU, "Missing WebGPU must throw and route fallback teaching to the compatibility skill.");

console.log(JSON.stringify({
  pass: true,
  tiers,
  rejectedUnsafeConfig,
  rejectedNonWebGPU,
  checks: [
    "CFL/Courant gate",
    "depth-to-viewZ meters",
    "pipeline-owned scene color/depth",
    "computed culling bounds",
    "refracted ray-bundle caustics",
    "CPU analytic getWaterHeight contract",
    "interface-space table",
    "checkpointed README",
    "WebGPU-unavailable routing to compatibility fallbacks",
  ],
}, null, 2));
