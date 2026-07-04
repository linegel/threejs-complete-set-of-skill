import {
  CURVED_RAY_QUALITY_TIERS,
  CURVED_RAY_DEBUG_MODES,
  TSLCurvedRayAccretionEffect,
  createCurvedRayRenderPipeline,
  configureColorTexture,
  configureDataTexture,
  createSeededNoiseTexture,
  prepareCurvedRayRenderer,
  segmentSlabIntersectionZ,
} from "./curved-ray-accretion.js";
import {
  DataTexture,
  NoColorSpace,
  RenderPipeline,
  RGBAFormat,
  SRGBColorSpace,
  UnsignedByteType,
} from "three/webgpu";
import { pass, renderOutput } from "three/tsl";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function makeTexture() {
  return new DataTexture(new Uint8Array([255, 255, 255, 255]), 1, 1, RGBAFormat, UnsignedByteType);
}

function countMatches(source, pattern) {
  return source.match(pattern)?.length ?? 0;
}

const colorTexture = configureColorTexture(makeTexture(), { mipmaps: false });
const dataTexture = configureDataTexture(makeTexture(), { mipmaps: false });

assert(colorTexture.colorSpace === SRGBColorSpace, "Star/environment textures must use SRGBColorSpace.");
assert(dataTexture.colorSpace === NoColorSpace, "Noise/diagnostic textures must use NoColorSpace.");

const crossing = segmentSlabIntersectionZ(0.08, -0.08, 0.03);
assert(crossing.intersects === true, "Segment crossing the disk slab was not detected.");
assert(crossing.fraction > 0.35 && crossing.fraction < 0.4, `Unexpected slab fraction ${crossing.fraction}.`);
assert(crossing.midT > 0.49 && crossing.midT < 0.51, `Unexpected slab midpoint ${crossing.midT}.`);

const outside = segmentSlabIntersectionZ(0.08, 0.12, 0.03);
assert(outside.intersects === false, "Outside segment must not report a slab hit.");
assert(outside.fraction === 0, "Outside segment must have zero slab fraction.");

for (const [name, tier] of Object.entries(CURVED_RAY_QUALITY_TIERS)) {
  assert(tier.maxSteps > 0, `${name} maxSteps must be positive.`);
  assert(tier.minStep > 0 && tier.maxStep >= tier.minStep, `${name} step bounds are invalid.`);
  assert(tier.opacityCutoff > 0 && tier.opacityCutoff < 1, `${name} opacityCutoff must be in (0,1).`);
  assert(tier.resolutionScale > 0 && tier.resolutionScale <= 1, `${name} resolutionScale must be in (0,1].`);
}

for (const debugMode of ["final", "step-count", "transmittance", "steering", "termination", "invalid-state", "bent-direction", "opacity", "core-hit"]) {
  assert(Number.isInteger(CURVED_RAY_DEBUG_MODES[debugMode]), `${debugMode} debug mode must be registered.`);
}

const here = dirname(fileURLToPath(import.meta.url));
const source = readFileSync(join(here, "curved-ray-accretion.js"), "utf8");

assert(countMatches(source, /position\.assign\(candidatePosition\)/g) === 1, "Integrator must commit exactly one ray-position advance.");
assert(!/position\.assign\(\s*position\.add/.test(source), "Integrator must not advance by adding onto current position elsewhere.");
for (const id of [1, 2, 3, 4, 5]) {
  assert(source.includes(`terminationId.assign(${id}.0)`), `Termination ID ${id} must be assigned in the TSL integrator.`);
}
assert(source.includes("candidatePosition.x.notEqual(candidatePosition.x)"), "Invalid-state guard must detect NaN candidate positions.");
assert(source.includes("terminationId.equal(5.0)"), "Invalid-state debug output must be wired to termination ID 5.");
assert(source.includes("direction.mul(0.5).add(0.5)"), "Bent-direction debug output must visualize the final direction.");
assert(source.includes("float(1.0).sub(transmittance)"), "Opacity debug output must derive from accumulated transmittance.");
assert(source.includes("loadAsync(url)"), "Generated star loading must expose an awaitable loadAsync path.");
const initIndex = source.indexOf("await renderer.init()");
const initTextureIndex = source.indexOf("renderer.initTexture(texture)");
const compileIndex = source.indexOf("renderer.compileAsync(scene, camera)");
assert(initIndex !== -1 && initTextureIndex !== -1 && compileIndex !== -1, "Renderer preparation must include init(), initTexture(), and compileAsync().");
assert(initIndex < initTextureIndex && initTextureIndex < compileIndex, "Renderer preparation order must be init(), initTexture(), then compileAsync().");
assert(typeof createCurvedRayRenderPipeline === "function", "Curved-ray render pipeline factory must be exported.");
assert(typeof RenderPipeline === "function" && typeof pass === "function" && typeof renderOutput === "function", "RenderPipeline/pass/renderOutput imports must resolve.");
assert(source.includes("const scenePass = pass(scene, camera)"), "Reduced-resolution pipeline must create a real PassNode from pass(scene, camera).");
assert(source.includes("scenePass.setResolutionScale(resolutionScale)"), "Reduced-resolution pipeline must apply PassNode.setResolutionScale().");
assert(source.includes("const pipeline = new RenderPipeline(renderer)"), "Reduced-resolution pipeline must construct a RenderPipeline.");
assert(source.includes("pipeline.outputColorTransform = false"), "renderOutput owner requires RenderPipeline.outputColorTransform = false.");
assert(source.includes("pipeline.outputNode = renderOutput(scenePass"), "Reduced-resolution pipeline must composite through renderOutput(scenePass).");

const fakeUnavailableRenderer = {
  backend: { isWebGPUBackend: false },
  async init() {},
};
let rejectedImplicitFallbackTeaching = false;
try {
  await prepareCurvedRayRenderer({ renderer: fakeUnavailableRenderer });
} catch (error) {
  rejectedImplicitFallbackTeaching = error instanceof Error &&
    error.message.includes("explicitly asks how to apply fallback when WebGPU is unavailable");
}
assert(rejectedImplicitFallbackTeaching, "Fallback teaching for missing WebGPU must require an explicit user request.");

const explicitFallbackResult = await prepareCurvedRayRenderer({
  renderer: fakeUnavailableRenderer,
  explicitFallbackWhenWebGPUUnavailable: true,
});
assert(explicitFallbackResult.isWebGPUBackend === false, "Explicit fallback teaching path must report the non-WebGPU backend.");

const effect = new TSLCurvedRayAccretionEffect({
  noiseTexture: createSeededNoiseTexture({ size: 1 }),
  starTexture: configureColorTexture(makeTexture(), { mipmaps: false }),
});
effect.dispose();
effect.dispose();
assert(effect.disposed === true, "Disposal must be idempotent and mark the effect disposed.");

console.log(JSON.stringify({
  pass: true,
  colorSpace: {
    starEnvironment: colorTexture.colorSpace,
    noiseData: dataTexture.colorSpace,
  },
  diskSlabCrossing: crossing,
  debugModes: Object.keys(CURVED_RAY_DEBUG_MODES),
  qualityTiers: Object.keys(CURVED_RAY_QUALITY_TIERS),
  sourceContracts: {
    committedPositionAdvances: countMatches(source, /position\.assign\(candidatePosition\)/g),
    terminationIds: [1, 2, 3, 4, 5],
    invalidStateTermination: true,
    disposeIdempotent: effect.disposed,
    textureWarmupOrder: "init -> initTexture -> compileAsync",
    renderPipeline: "pass(scene,camera) -> setResolutionScale -> renderOutput",
    fallbackTeachingRequiresExplicitRequest: rejectedImplicitFallbackTeaching,
  },
}, null, 2));
