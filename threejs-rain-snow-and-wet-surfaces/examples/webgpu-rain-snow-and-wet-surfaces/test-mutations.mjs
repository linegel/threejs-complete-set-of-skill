import assert from "node:assert/strict";

import {
  WeatherImpactReceiverRegistry,
  WorldStableImpactScheduler,
  acceptImpactReceiver,
  cameraWrapPosition,
  createWeatherEnvelope,
  deriveWetSurfaceState,
  evaluateSnowCoverage,
  updateWeatherEnvelope,
  validatePrecipitationConfig,
  worldStableImpact,
} from "./precipitation-system.js";
import {
  WEATHER_MECHANISM_PROFILES,
  createPrecipitationSeedValues,
  digestPrecipitationSeedValues,
} from "./weather-webgpu-lab.js";

const weather = createWeatherEnvelope({ temperatureC: -2 });
const duplicateOwnerMutation = validatePrecipitationConfig({
  weather,
  particleWeather: createWeatherEnvelope(),
  surfaceWeather: weather,
});
assert.equal(duplicateOwnerMutation.ok, false);
assert(duplicateOwnerMutation.errors.some((error) => error.includes("object identity")));

for (let frame = 0; frame < 60; frame += 1) {
  updateWeatherEnvelope(weather, { deltaTime: 1 / 60, targetForcing: 0.35 });
}
const surface = deriveWetSurfaceState(weather);
assert(surface.roughness < 0.78, "roughness-before-ripple mutation must fail");
assert.equal(surface.rippleNormalStrength, 0, "forcing aliases must not enable heavy-rain ripples early");
assert.notEqual(weather.wetness, weather.forcing, "integrated wetness cannot alias current forcing");

const cameraA = { x: 0, y: 2, z: 0 };
const cameraB = { x: 1000, y: 2, z: -900 };
const impactA = worldStableImpact({ cellX: 7, cellZ: -9, seed: 1234, camera: cameraA });
const impactB = worldStableImpact({ cellX: 7, cellZ: -9, seed: 1234, camera: cameraB });
assert.deepEqual(impactA, impactB, "camera-dependent physical-impact mutation must fail");

const wrappedA = cameraWrapPosition({
  seed: { x: 0.2, y: 0.8, z: 0.4 },
  camera: cameraA,
  volume: { x: 38, y: 22, z: 24 },
  windDisplacement: { x: 0, y: 0, z: 0 },
  fallSpeed: 7.2,
  time: 1,
});
const wrappedB = cameraWrapPosition({
  seed: { x: 0.2, y: 0.8, z: 0.4 },
  camera: cameraB,
  volume: { x: 38, y: 22, z: 24 },
  windDisplacement: { x: 0, y: 0, z: 0 },
  fallSpeed: 7.2,
  time: 1,
});
assert.notDeepEqual(wrappedA, wrappedB, "origin-fixed presentation-volume mutation must fail");

assert.equal(acceptImpactReceiver({ worldNormal: { x: 1, y: 0, z: 0 } }), false);
assert.equal(acceptImpactReceiver({ worldNormal: { x: 0, y: 1, z: 0 }, occluded: true }), false);

const receivers = new WeatherImpactReceiverRegistry();
const schedulerA = new WorldStableImpactScheduler({ seed: 1234, receiverRegistry: receivers });
const schedulerB = new WorldStableImpactScheduler({ seed: 1234, receiverRegistry: receivers });
assert.deepEqual(
  Array.from({ length: 32 }, () => schedulerA.nextAccepted()),
  Array.from({ length: 32 }, () => schedulerB.nextAccepted()),
  "presentation camera must not enter the physical-impact scheduler",
);

for (const rejected of [
  { worldNormal: { x: 1, y: 0, z: 0 } },
  { worldNormal: { x: 0, y: -1, z: 0 } },
  { worldNormal: { x: 0, y: 1, z: 0 }, occluded: true },
  { worldNormal: { x: 0, y: 1, z: 0 }, visible: false },
]) {
  assert.equal(evaluateSnowCoverage({
    modelPosition: { x: 0, y: 0, z: 0 },
    coverage: 1,
    ...rejected,
  }).coverage, 0, "unconditional-flat-snow mutation must fail");
}

const seedA = digestPrecipitationSeedValues(createPrecipitationSeedValues(64, 1));
const seedB = digestPrecipitationSeedValues(createPrecipitationSeedValues(64, 2));
assert.notEqual(seedA, seedB, "metadata-only setSeed mutation must fail");

const routeStates = Object.values(WEATHER_MECHANISM_PROFILES).map((profile) => JSON.stringify(profile));
assert.equal(new Set(routeStates).size, routeStates.length, "metadata-only mechanism-route mutation must fail");

console.log("weather mutation suite passed");
