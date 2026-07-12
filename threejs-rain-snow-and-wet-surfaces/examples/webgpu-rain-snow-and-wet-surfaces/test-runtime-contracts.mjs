import assert from "node:assert/strict";

import { Scene, Vector3 } from "three/webgpu";
import { uniform } from "three/tsl";

import {
  WeatherImpactReceiverRegistry,
  WorldStableImpactScheduler,
  cameraWrapPosition,
  createWorldImpactCandidate,
  evaluateSnowCoverage,
  worldStableImpact,
} from "./precipitation-system.js";
import {
  WEATHER_MECHANISM_PROFILES,
  WebGPUWeatherSurfaceLab,
  createPrecipitationSeedValues,
  createPrecipitationStage,
  createWeatherImpactStage,
  createWeatherSurfaceResponseStage,
  digestPrecipitationSeedValues,
  requireWeatherMechanismProfile,
} from "./weather-webgpu-lab.js";

function makeUniforms() {
  return {
    time: uniform(0, "float"),
    deltaTime: uniform(1 / 60, "float"),
    cameraPosition: uniform(new Vector3(0, 4, 8)),
    windDisplacement: uniform(new Vector3()),
    forcing: uniform(0.72, "float"),
    wetness: uniform(0.4, "float"),
    puddleFill: uniform(0.25, "float"),
    snowCoverage: uniform(0.8, "float"),
    snowSeedPhase: uniform(0.17, "float"),
  };
}

const profileSignatures = Object.entries(WEATHER_MECHANISM_PROFILES).map(([id, profile]) => [
  id,
  JSON.stringify(profile),
]);
assert.equal(new Set(profileSignatures.map(([, signature]) => signature)).size, profileSignatures.length);
assert.equal(requireWeatherMechanismProfile("precipitation-volume").road, false);
assert.equal(requireWeatherMechanismProfile("wet-road-and-puddles").road, true);
assert.equal(requireWeatherMechanismProfile("impact-and-splashes").impacts, true);
assert.equal(requireWeatherMechanismProfile("snow-accumulation-and-caps").snowReceiver, true);
assert.equal(requireWeatherMechanismProfile("weather-envelope-coupling").precipitationMotion, "recurrent-if-tier");
assert.throws(() => requireWeatherMechanismProfile("metadata-only"), /unknown weather mechanism/);

const seedOne = createPrecipitationSeedValues(128, 1);
const seedStress = createPrecipitationSeedValues(128, 0x9e3779b9);
assert.notEqual(digestPrecipitationSeedValues(seedOne), digestPrecipitationSeedValues(seedStress));
assert.equal(
  digestPrecipitationSeedValues(seedOne),
  digestPrecipitationSeedValues(createPrecipitationSeedValues(128, 1)),
);

const volume = { x: 38, y: 22, z: 24 };
const visualSeed = { x: 0.13, y: 0.91, z: 0.47 };
const cameraA = { x: 0, y: 5, z: 10 };
const cameraB = { x: 91, y: 13, z: -67 };
for (const camera of [cameraA, cameraB]) {
  const wrapped = cameraWrapPosition({
    seed: visualSeed,
    camera,
    volume,
    windDisplacement: { x: 3.5, y: 0, z: -1.25 },
    fallSpeed: 7.2,
    time: 4.25,
  });
  assert(Math.abs(wrapped.x - camera.x) <= volume.x * 0.5);
  assert(Math.abs(wrapped.y - camera.y) <= volume.y * 0.5);
  assert(Math.abs(wrapped.z - camera.z) <= volume.z * 0.5);
}

const stableCellA = worldStableImpact({ cellX: 3, cellZ: -2, seed: 991 });
const stableCellB = worldStableImpact({ cellX: 3, cellZ: -2, seed: 991 });
assert.deepEqual(stableCellA, stableCellB);

const receivers = new WeatherImpactReceiverRegistry();
assert.equal(receivers.resolve({ x: 0, z: 0 }).accepted, true);
assert.equal(receivers.resolve({ x: 9, z: 0 }).reason, "occluded");
const capHit = receivers.resolve({ x: 12, z: 2 });
assert.equal(capHit.accepted, true);
assert.equal(capHit.position.y, 2.4);
assert.equal(receivers.resolve({ x: 100, z: 100 }).reason, "outside-receiver-field");

const schedulerA = new WorldStableImpactScheduler({ seed: 0x12345678, receiverRegistry: receivers });
const schedulerB = new WorldStableImpactScheduler({ seed: 0x12345678, receiverRegistry: receivers });
const acceptedA = Array.from({ length: 128 }, () => schedulerA.nextAccepted());
const acceptedB = Array.from({ length: 128 }, () => schedulerB.nextAccepted());
assert.deepEqual(acceptedA, acceptedB, "physical impacts must not depend on presentation camera state");
assert(acceptedA.every((event) => event?.accepted && event.receiverId));
assert(schedulerA.describe().rejectedCount > 0, "receiver rejection path must be exercised by live scheduling");
for (const event of acceptedA) {
  const resolved = receivers.resolve(event.position);
  assert.equal(resolved.accepted, true);
  assert.equal(resolved.receiver.id, event.receiverId);
}
const rejectedCandidate = createWorldImpactCandidate({
  sequence: 3,
  seed: 0x12345678,
  receiverRegistry: new WeatherImpactReceiverRegistry([{
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
  }]),
});
assert.equal(rejectedCandidate.accepted, false);
assert.equal(rejectedCandidate.rejectionReason, "receiver-orientation-rejected");

const snowFixture = {
  modelPosition: { x: 0.4, y: 1.2, z: -0.7 },
  coverage: 1,
};
assert(evaluateSnowCoverage({ ...snowFixture, worldNormal: { x: 0, y: 1, z: 0 } }).coverage > 0.99);
for (const rejection of [
  { worldNormal: { x: 1, y: 0, z: 0 } },
  { worldNormal: { x: 0, y: -1, z: 0 } },
  { worldNormal: { x: 0, y: 1, z: 0 }, occluded: true },
  { worldNormal: { x: 0, y: 1, z: 0 }, visible: false },
]) {
  assert.equal(evaluateSnowCoverage({ ...snowFixture, ...rejection }).coverage, 0);
}

const uniforms = makeUniforms();
const rainStage = createPrecipitationStage({
  family: "rain",
  maxInstances: 128,
  visibleInstances: 64,
  seed: 1,
  uniforms,
  volume,
});
const analyticPositionNode = rainStage.material.positionNode;
rainStage.setMotionMode("recurrent");
assert.notEqual(rainStage.material.positionNode, analyticPositionNode, "recurrent route must change reachable material graph");
rainStage.setMotionMode("analytic");
assert.equal(rainStage.material.positionNode, analyticPositionNode);
assert.throws(() => rainStage.setMotionMode("metadata-only"), /unknown precipitation motion mode/);
rainStage.dispose();

const impactStage = createWeatherImpactStage(uniforms, 16);
const approved = schedulerA.nextAccepted();
assert.equal(impactStage.queueImpactCandidates([approved]), 1);
assert.equal(impactStage.candidateState.array[3], 1);
assert.throws(() => impactStage.queueImpactCandidates([rejectedCandidate]), /receiver-approved/);
impactStage.clear();
assert(impactStage.candidateState.array.every((value) => value === 0));
impactStage.dispose();

const surfaces = createWeatherSurfaceResponseStage(uniforms);
assert.equal(surfaces.snow.geometry.type, "BoxGeometry", "snow runtime must expose top, wall, and underside faces");
assert.equal(surfaces.snowOccluder.geometry.type, "BoxGeometry");
assert.match(surfaces.diagnosticSources.mask, /occlusion nodes/);
const roadVersion = surfaces.roadMaterial.version;
const snowVersion = surfaces.snowMaterial.version;
surfaces.setDebugMode("mask");
assert(surfaces.roadMaterial.version > roadVersion);
assert(surfaces.snowMaterial.version > snowVersion);
surfaces.dispose();

const controllerUniforms = makeUniforms();
const controller = new WebGPUWeatherSurfaceLab({
  tier: "budgeted",
  mechanism: "weather-envelope-coupling",
  seed: 1,
});
assert.equal(controller.labId, "webgpu-rain-snow-and-wet-surfaces");
controller.scene = new Scene();
controller.uniforms = controllerUniforms;
controller.surfaces = createWeatherSurfaceResponseStage(controllerUniforms);
controller.scene.add(controller.surfaces.road, controller.surfaces.snow, controller.surfaces.snowOccluder);
controller.receiverRegistry = new WeatherImpactReceiverRegistry();
controller.rebuildSeededResources(1);
const firstRainStage = controller.rain;
const firstSeedDigest = controller.seedDigests.rain;
await controller.setSeed(2);
assert.notEqual(controller.rain, firstRainStage, "setSeed must replace the bound precipitation stage");
assert.notEqual(controller.seedDigests.rain, firstSeedDigest, "setSeed must replace seed-backed storage values");
assert.equal(controller.impactScheduler.seed, 2, "setSeed must rebuild the world-impact scheduler");
await controller.setScenario("wet-road-and-puddles");
assert.equal(controller.surfaces.road.visible, true);
assert.equal(controller.rain.mesh.visible, false);
assert.equal(controller.impacts.mesh.visible, false);
await controller.setScenario("impact-and-splashes");
assert.equal(controller.rain.mesh.visible, true);
assert.equal(controller.impacts.mesh.visible, true);
assert.equal(controller.surfaces.snow.visible, true);
await controller.dispose();

console.log("weather runtime contract tests passed");
