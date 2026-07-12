import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import {
  TERMINAL_VELOCITY_RANGES,
  BoundedSplashRing,
  WEATHER_MECHANISMS,
  WEATHER_QUALITY_TIERS,
  WeatherImpactReceiverRegistry,
  WorldStableImpactScheduler,
  acceptImpactReceiver,
  cameraWrapPosition,
  clampDeltaTime,
  createImpactSplashStoragePlan,
  createSurfaceMaterialContracts,
  createWeatherEnvelope,
  createWorldImpactCandidate,
  createWebGPURainSnowWetSurfaceSystem,
  deriveWetSurfaceState,
  evaluateSnowCoverage,
  estimateStorageBytes,
  integrateBoundedResponse,
  requireWeatherMechanism,
  requireWeatherTier,
  selectRippleTier,
  streakLengthMeters,
  updateWeatherEnvelope,
  validatePrecipitationConfig,
  worldStableImpact,
} from "./precipitation-system.js";
import {
  WEATHER_MECHANISM_PROFILES,
  createPrecipitationSeedValues,
  digestPrecipitationSeedValues,
  parseWeatherLabRoute,
} from "./weather-webgpu-lab.js";

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

const state30 = createWeatherEnvelope({ temperatureC: -2 });
const state60 = createWeatherEnvelope({ temperatureC: -2 });
const state120 = createWeatherEnvelope({ temperatureC: -2 });
for (let index = 0; index < 30; index += 1) updateWeatherEnvelope(state30, { deltaTime: 1 / 30, targetForcing: 0.7 });
for (let index = 0; index < 60; index += 1) updateWeatherEnvelope(state60, { deltaTime: 1 / 60, targetForcing: 0.7 });
for (let index = 0; index < 120; index += 1) updateWeatherEnvelope(state120, { deltaTime: 1 / 120, targetForcing: 0.7 });
for (const key of ["forcing", "wetness", "puddleFill", "snowCoverage"]) {
  assert(Math.abs(state30[key] - state60[key]) < 1e-12, `${key} differs at 30/60 Hz`);
  assert(Math.abs(state120[key] - state60[key]) < 1e-12, `${key} differs at 120/60 Hz`);
}
assert.throws(() => updateWeatherEnvelope(weather, { deltaTime: -1 }), /nonnegative/);
assert.equal(integrateBoundedResponse(0.25, 0, 0, 10), 0.25);

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

assert.deepEqual(Object.keys(WEATHER_QUALITY_TIERS), ["high", "medium", "budgeted"]);
assert.equal(requireWeatherTier("medium").id, "medium");
assert.throws(() => requireWeatherTier("invented"), /unknown weather tier/);
assert.equal(requireWeatherMechanism(WEATHER_MECHANISMS[0]), WEATHER_MECHANISMS[0]);
assert.throws(() => requireWeatherMechanism("fake"), /unknown weather mechanism/);

const lightRain = createWeatherEnvelope({ wetness: 0.5, puddleFill: 0.4, forcing: 0.35 });
const earlySurface = deriveWetSurfaceState(lightRain);
assert(earlySurface.roughness < 0.78, "wetness must alter roughness before heavy-rain ripples");
assert.equal(earlySurface.rippleNormalStrength, 0, "ripples must remain gated at forcing 0.35");

const snowTop = evaluateSnowCoverage({
  modelPosition: { x: 1.2, y: 0, z: -0.7 },
  worldNormal: { x: 0, y: 1, z: 0 },
  coverage: 1,
});
assert(snowTop.coverage > 0.99);
assert(Math.abs(Math.hypot(snowTop.normal.x, snowTop.normal.y, snowTop.normal.z) - 1) < 1e-12);
const snowWall = evaluateSnowCoverage({
  modelPosition: { x: 1.2, y: 0, z: -0.7 },
  worldNormal: { x: 1, y: 0, z: 0 },
  coverage: 1,
});
assert.equal(snowWall.coverage, 0, "vertical walls must reject snow");
const snowOccluded = evaluateSnowCoverage({
  modelPosition: { x: 1.2, y: 0, z: -0.7 },
  worldNormal: { x: 0, y: 1, z: 0 },
  coverage: 1,
  occluded: true,
});
assert.equal(snowOccluded.coverage, 0, "occluded receivers must reject snow");
const snowCeiling = evaluateSnowCoverage({
  modelPosition: { x: 1.2, y: 0, z: -0.7 },
  worldNormal: { x: 0, y: -1, z: 0 },
  coverage: 1,
});
assert.equal(snowCeiling.coverage, 0, "ceilings and undersides must reject snow");
const snowHidden = evaluateSnowCoverage({
  modelPosition: { x: 1.2, y: 0, z: -0.7 },
  worldNormal: { x: 0, y: 1, z: 0 },
  visible: false,
  coverage: 1,
});
assert.equal(snowHidden.coverage, 0, "hidden receivers must reject snow");

assert.equal(streakLengthMeters(8, 1 / 60), streakLengthMeters(8, 1 / 120) * 2);
const impactA = worldStableImpact({ cellX: 10, cellZ: -4, seed: 99 });
const impactB = worldStableImpact({ cellX: 10, cellZ: -4, seed: 99 });
assert.deepEqual(impactA, impactB, "world-stable impact cannot depend on camera translation");
assert(acceptImpactReceiver({ worldNormal: { x: 0, y: 1, z: 0 } }));
assert(!acceptImpactReceiver({ worldNormal: { x: 0, y: -1, z: 0 } }));
assert(!acceptImpactReceiver({ worldNormal: { x: 0, y: 1, z: 0 }, occluded: true }));

const cameraA = { x: 0, y: 2, z: 0 };
const cameraB = { x: 1000, y: 7, z: -900 };
const wrappedCameraA = cameraWrapPosition({
  seed: { x: 0.3, y: 0.7, z: 0.2 },
  camera: cameraA,
  volume: { x: 38, y: 22, z: 24 },
  windDisplacement: weather.windDisplacement,
  fallSpeed: 7.2,
  time: weather.time,
});
const wrappedCameraB = cameraWrapPosition({
  seed: { x: 0.3, y: 0.7, z: 0.2 },
  camera: cameraB,
  volume: { x: 38, y: 22, z: 24 },
  windDisplacement: weather.windDisplacement,
  fallSpeed: 7.2,
  time: weather.time,
});
assert.notDeepEqual(wrappedCameraA, wrappedCameraB, "visual precipitation must follow the presentation camera");

const receiverRegistry = new WeatherImpactReceiverRegistry();
assert.equal(receiverRegistry.resolve({ x: 0, z: 0 }).accepted, true);
assert.equal(receiverRegistry.resolve({ x: 9, z: 0 }).reason, "occluded");
assert.equal(receiverRegistry.resolve({ x: 12, z: 2 }).position.y, 2.4);
const impactScheduler = new WorldStableImpactScheduler({ seed: 99, receiverRegistry });
const scheduledImpacts = Array.from({ length: 64 }, () => impactScheduler.nextAccepted());
assert(scheduledImpacts.every((impact) => impact?.accepted && impact.receiverId));
assert(impactScheduler.describe().rejectedCount > 0, "live receiver rejection was never exercised");
const downwardRegistry = new WeatherImpactReceiverRegistry([{
  id: "underside",
  kind: "ceiling",
  minX: -100,
  maxX: 100,
  minZ: -100,
  maxZ: 100,
  height: 2,
  worldNormal: { x: 0, y: -1, z: 0 },
  visible: true,
  occluders: [],
}]);
assert.equal(createWorldImpactCandidate({ sequence: 0, seed: 99, receiverRegistry: downwardRegistry }).accepted, false);

const seedDigestA = digestPrecipitationSeedValues(createPrecipitationSeedValues(64, 1));
const seedDigestB = digestPrecipitationSeedValues(createPrecipitationSeedValues(64, 0x9e3779b9));
assert.notEqual(seedDigestA, seedDigestB, "setSeed cannot be truthful if seed-backed storage is unchanged");

const mechanismSignatures = Object.values(WEATHER_MECHANISM_PROFILES).map((profile) => JSON.stringify(profile));
assert.equal(new Set(mechanismSignatures).size, WEATHER_MECHANISMS.length, "mechanism routes must select distinct runtime state");

const ring = new BoundedSplashRing(4);
for (let index = 0; index < 6; index += 1) ring.push({ id: index });
assert.equal(ring.activeEvents().length, 4);
assert.deepEqual(ring.activeEvents().map((event) => event.id), [2, 3, 4, 5]);
assert.equal(new Set(ring.activeEvents().map((event) => event.slot)).size, 4);

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

const manifest = JSON.parse(readFileSync(resolve(here, "lab.manifest.json"), "utf8"));
assert.equal(manifest.schemaVersion, 2);
assert.equal(manifest.kind, "canonical-lab");
assert.equal(manifest.status, "incomplete", "lab cannot be accepted before native-WebGPU evidence");
assert.equal(manifest.threeRevision, "0.185.1");
assert.deepEqual(manifest.mechanisms.map(({ id }) => id), WEATHER_MECHANISMS);
assert.deepEqual(manifest.tiers.map(({ id }) => id), Object.keys(WEATHER_QUALITY_TIERS));
assert(existsSync(resolve(here, manifest.browserEntry)), "canonical browser entry is missing");
for (const { id } of manifest.mechanisms) {
  const wrapper = resolve(here, "mechanism", id, "index.html");
  assert(existsSync(wrapper), `missing mechanism wrapper ${id}`);
  assert(readFileSync(wrapper, "utf8").includes("../../route-wrapper.js"), `${id} forks the canonical route implementation`);
  assert.equal(parseWeatherLabRoute(`/demos/weather/mechanism/${id}/`).mechanism, id);
}
for (const { id } of manifest.tiers) {
  const wrapper = resolve(here, "tier", id, "index.html");
  assert(existsSync(wrapper), `missing tier wrapper ${id}`);
  assert(readFileSync(wrapper, "utf8").includes("../../route-wrapper.js"), `${id} forks the canonical route implementation`);
  assert.equal(parseWeatherLabRoute(`/demos/weather/tier/${id}/`).tier, id);
}
assert.throws(() => parseWeatherLabRoute("/demos/weather/mechanism/not-a-mechanism/"), /unknown weather mechanism/);
assert.throws(() => parseWeatherLabRoute("/demos/weather/tier/not-a-tier/"), /unknown weather tier/);

const browserSource = readFileSync(resolve(here, "weather-webgpu-lab.js"), "utf8");
const mainSource = readFileSync(resolve(here, "main.js"), "utf8");
for (const token of [
  "await this.renderer.init()",
  "isWebGPUBackend !== true",
  "StorageInstancedBufferAttribute",
  "atomicAdd",
  "renderPipeline.outputColorTransform = false",
  "renderPipeline.needsUpdate = true",
  "readRenderTargetPixelsAsync",
  "alignedBytesPerRow",
  "cameraPosition",
  "rebuildSeededResources",
  "WorldStableImpactScheduler",
  "queueImpactCandidates",
  "scenePass.setMRT(mrt({ output, normal: normalView }))",
  "normalDiagnosticNode",
  "applyRuntimeSelection",
  "snow-model-world-up-and-occlusion-rejected",
  'export const WEATHER_LAB_ID = "webgpu-rain-snow-and-wet-surfaces"',
  "get labId() { return WEATHER_LAB_ID; }",
  "labId: WEATHER_LAB_ID",
]) {
  assert(browserSource.includes(token), `canonical browser source is missing ${token}`);
}
assert(mainSource.includes("globalThis.labController = lab"), "canonical weather entry does not publish the public controller contract");
assert(!browserSource.includes("this.modeNodes ="), "synthetic fullscreen diagnostic table must not return");

console.log("webgpu-rain-snow-and-wet-surfaces validation passed");
