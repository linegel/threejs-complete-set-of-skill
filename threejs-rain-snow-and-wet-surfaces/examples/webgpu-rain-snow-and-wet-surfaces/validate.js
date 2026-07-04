import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import {
  TERMINAL_VELOCITY_RANGES,
  clampDeltaTime,
  createImpactSplashStoragePlan,
  createSurfaceMaterialContracts,
  createWeatherEnvelope,
  createWebGPURainSnowWetSurfaceSystem,
  estimateStorageBytes,
  selectRippleTier,
  updateWeatherEnvelope,
  validatePrecipitationConfig,
} from "./precipitation-system.js";

const here = dirname(fileURLToPath(import.meta.url));
const weather = createWeatherEnvelope();
const particleWeather = weather;
const surfaceWeather = weather;

assert.equal(clampDeltaTime(Number.NaN), 0);
assert.equal(clampDeltaTime(-1), 0);
assert.equal(clampDeltaTime(1), 1 / 15);
assert(TERMINAL_VELOCITY_RANGES.rainMetersPerSecond[0] >= 4);

updateWeatherEnvelope(weather, { deltaTime: 1 / 60, targetProgress: 1 });
assert(weather.progress > 0);
assert.equal(particleWeather, surfaceWeather);

const validation = validatePrecipitationConfig({
  weather,
  particleWeather,
  surfaceWeather,
  maxInstances: 100000,
  budgetBytes: 8 * 1024 * 1024,
});
assert.equal(validation.ok, true, validation.errors.join("\n"));
assert(estimateStorageBytes(validation.storagePlan) <= 8 * 1024 * 1024);
assert.equal(validation.storagePlan.dynamicMirroredToCpu, false);
assert.equal(validation.ripple.colorSpace, "NoColorSpace");

const badWeather = validatePrecipitationConfig({
  weather,
  particleWeather: createWeatherEnvelope(),
  surfaceWeather,
});
assert.equal(badWeather.ok, false);
assert(badWeather.errors.some((error) => error.includes("weather object identity")));

const outOfBudget = validatePrecipitationConfig({
  weather,
  particleWeather,
  surfaceWeather,
  maxInstances: 300000,
  budgetBytes: 1024,
});
assert.equal(outOfBudget.ok, false);
assert(outOfBudget.errors.some((error) => error.includes("exceeds budget")));

const highRipple = selectRippleTier({ qualityTier: "high", weather });
assert.equal(highRipple.rippleTier, "dynamic");
const generatedRipple = selectRippleTier({ qualityTier: "medium", weather });
assert(generatedRipple.variants.some((path) => path.includes("ripple-normal-a")));
assert(generatedRipple.variants.some((path) => path.includes("ripple-normal-b")));
assert(generatedRipple.variants.some((path) => path.includes("ripple-normal-c")));

const impacts = createImpactSplashStoragePlan();
assert(impacts.progressLifetime.progress);
assert(impacts.atlasTileOpacity.atlas === "4x5");
assert(impacts.atomicCounter.atomic.includes("compaction"));

const materials = createSurfaceMaterialContracts();
for (const slot of ["colorNode", "roughnessNode", "normalNode", "opacityNode", "positionNode"]) {
  assert(slot in materials.wetSurfaceSlots || slot in materials.snowSurfaceSlots);
}

const system = createWebGPURainSnowWetSurfaceSystem({ weather });
assert.equal(system.weather, weather);
assert(system.debugViews.includes("particles"));
assert(system.update(1 / 60, 1).progress > 0);

const source = readFileSync(resolve(here, "precipitation-system.js"), "utf8");
for (const required of [
  "from \"three/webgpu\"",
  "from \"three/tsl\"",
  "instancedArray",
  "Fn",
  ".compute(",
  "SpriteNodeMaterial",
  "impact",
  "splash",
  "atomic",
  "storage",
  "progress",
  "lifetime",
  "atlas",
  "ripple-normal-a",
  "ripple-normal-b",
  "ripple-normal-c",
  "NoColorSpace",
  "weather.progress",
  "rippleTier",
  "colorNode",
  "roughnessNode",
  "normalNode",
  "opacityNode",
  "positionNode",
]) {
  assert(source.includes(required), `missing source token ${required}`);
}

for (const forbidden of [
  "setMatrixAt",
  "getMatrixAt",
  "instanceMatrix.needsUpdate",
  "ShaderMaterial",
  "RawShaderMaterial",
  "onBeforeCompile",
  "gl_FragColor",
  "gl_Position",
]) {
  assert(!source.includes(forbidden), `forbidden token ${forbidden}`);
}

console.log("webgpu-rain-snow-and-wet-surfaces validation passed");
