import { Group, Vector3 } from "three/webgpu";
import { uniform } from "three/tsl";

import {
  WEATHER_QUALITY_TIERS,
  WeatherImpactReceiverRegistry,
  WorldStableImpactScheduler,
  deriveWetSurfaceState,
} from "../../threejs-rain-snow-and-wet-surfaces/examples/webgpu-rain-snow-and-wet-surfaces/precipitation-system.js";
import {
  createPrecipitationStage,
  createWeatherImpactStage,
  createWeatherSurfaceResponseStage,
} from "../../threejs-rain-snow-and-wet-surfaces/examples/webgpu-rain-snow-and-wet-surfaces/weather-webgpu-lab.js";

const TAU = Math.PI * 2;
const VOLUME = Object.freeze({ x: 38, y: 22, z: 24 });

function geometryBytes(geometry) {
  if (!geometry) return 0;
  let bytes = geometry.index?.array?.byteLength ?? 0;
  for (const attribute of Object.values(geometry.attributes ?? {})) bytes += attribute.array?.byteLength ?? 0;
  return bytes;
}

/** Renderer/output-neutral canonical weather visuals for Creature Habitat. */
export function createHabitatWeatherVisualStage({
  renderer,
  scene,
  camera,
  weatherStage,
  tier = "medium",
  seed = 1,
} = {}) {
  if (renderer?.backend?.isWebGPUBackend !== true) throw new Error("habitat weather visuals require native WebGPU");
  if (!scene?.add || !camera || !weatherStage?.weather) throw new TypeError("habitat weather visuals require scene, camera, and weather stage");
  const tierConfig = WEATHER_QUALITY_TIERS[tier];
  if (!tierConfig) throw new RangeError(`unknown habitat weather tier "${tier}"`);
  const uniforms = {
    time: uniform(0, "float"),
    deltaTime: uniform(0, "float"),
    cameraPosition: uniform(camera.position.clone()),
    windDisplacement: uniform(new Vector3()),
    forcing: uniform(0, "float"),
    wetness: uniform(0, "float"),
    puddleFill: uniform(0, "float"),
    snowCoverage: uniform(0, "float"),
    snowSeedPhase: uniform(((seed >>> 0) / 0x100000000) * TAU, "float"),
  };
  const rain = createPrecipitationStage({
    family: "rain",
    maxInstances: tierConfig.rainInstances,
    visibleInstances: tierConfig.rainInstances,
    seed: seed >>> 0,
    uniforms,
    volume: VOLUME,
  });
  const snow = createPrecipitationStage({
    family: "snow",
    maxInstances: tierConfig.snowInstances,
    visibleInstances: tierConfig.snowInstances,
    seed: (seed ^ 0x9e3779b9) >>> 0,
    uniforms,
    volume: VOLUME,
  });
  rain.setMotionMode(tierConfig.recurrentTurbulence ? "recurrent" : "analytic");
  snow.setMotionMode(tierConfig.recurrentTurbulence ? "recurrent" : "analytic");
  const surfaces = createWeatherSurfaceResponseStage(uniforms);
  const impacts = createWeatherImpactStage(uniforms, tierConfig.impactCapacity);
  surfaces.road.receiveShadow = true;
  surfaces.snow.castShadow = true;
  surfaces.snow.receiveShadow = true;
  surfaces.snowOccluder.castShadow = true;
  surfaces.snowOccluder.receiveShadow = true;
  const receiverRegistry = new WeatherImpactReceiverRegistry();
  const impactScheduler = new WorldStableImpactScheduler({ seed: seed >>> 0, receiverRegistry });
  const root = new Group();
  root.name = "Creature Habitat canonical precipitation/wet/snow stage";
  root.add(rain.mesh, snow.mesh, surfaces.road, surfaces.snow, surfaces.snowOccluder, impacts.mesh);
  scene.add(root);

  let disposed = false;
  let impactAccumulator = 0;
  const acceptedBatch = [];
  const metrics = {
    recurrentDispatches: 0,
    impactAgeDispatches: 0,
    impactSpawnDispatches: 0,
    acceptedImpacts: 0,
  };

  function syncUniforms() {
    const weather = weatherStage.weather;
    const wet = deriveWetSurfaceState(weather);
    uniforms.time.value = weather.time;
    uniforms.deltaTime.value = weather.deltaTime;
    uniforms.cameraPosition.value.copy(camera.position);
    uniforms.windDisplacement.value.set(
      weather.windDisplacement.x,
      weather.windDisplacement.y,
      weather.windDisplacement.z,
    );
    uniforms.forcing.value = weather.forcing;
    uniforms.wetness.value = wet.wetness;
    uniforms.puddleFill.value = wet.puddle;
    uniforms.snowCoverage.value = weather.snowCoverage;
  }

  syncUniforms();
  return {
    root,
    uniforms,
    rain,
    snow,
    surfaces,
    impacts,
    receiverRegistry,
    impactScheduler,
    update(deltaSeconds) {
      if (disposed) throw new Error("habitat weather visual stage is disposed");
      syncUniforms();
      if (deltaSeconds <= 0) return;
      if (tierConfig.recurrentTurbulence) {
        renderer.compute([rain.recurrentStep, snow.recurrentStep]);
        metrics.recurrentDispatches += 2;
      }
      renderer.compute(impacts.age);
      metrics.impactAgeDispatches += 1;
      impactAccumulator += deltaSeconds * weatherStage.weather.forcing;
      acceptedBatch.length = 0;
      while (impactAccumulator >= 0.12 && acceptedBatch.length < impacts.candidateCapacity) {
        const accepted = impactScheduler.nextAccepted();
        if (accepted) acceptedBatch.push(accepted);
        impactAccumulator -= 0.12;
      }
      if (acceptedBatch.length > 0) {
        impacts.queueImpactCandidates(acceptedBatch);
        renderer.compute(impacts.spawn);
        metrics.impactSpawnDispatches += 1;
        metrics.acceptedImpacts += acceptedBatch.length;
      }
    },
    setMode(mode) {
      root.visible = mode !== "owner-graph";
    },
    reset() {
      impactAccumulator = 0;
      impacts.clear();
      impactScheduler.sequence = 0;
      impactScheduler.acceptedCount = 0;
      impactScheduler.rejectedCount = 0;
      impactScheduler.rejectionReasons.clear();
    },
    describeResources() {
      const records = [
        { id: "weather-rain-seeds", bytes: rain.seedStorage.array.byteLength },
        { id: "weather-rain-recurrent", bytes: rain.recurrentStorage.array.byteLength },
        { id: "weather-snow-seeds", bytes: snow.seedStorage.array.byteLength },
        { id: "weather-snow-recurrent", bytes: snow.recurrentStorage.array.byteLength },
        { id: "weather-impact-ring", bytes: impacts.eventState.array.byteLength },
        { id: "weather-impact-candidates", bytes: impacts.candidateState.array.byteLength },
        { id: "weather-impact-counter", bytes: impacts.counter.array.byteLength },
        { id: "weather-rain-geometry", bytes: geometryBytes(rain.geometry) },
        { id: "weather-snow-geometry", bytes: geometryBytes(snow.geometry) },
        { id: "weather-road-geometry", bytes: geometryBytes(surfaces.road.geometry) },
        { id: "weather-snow-receiver-geometry", bytes: geometryBytes(surfaces.snow.geometry) },
        { id: "weather-splash-geometry", bytes: geometryBytes(impacts.geometry) },
      ];
      return {
        tier: tierConfig.id,
        visible: root.visible,
        records,
        totalBytes: records.reduce((sum, record) => sum + record.bytes, 0),
        recurrentPerFrame: tierConfig.recurrentTurbulence,
      };
    },
    describeMetrics: () => ({ ...metrics, scheduler: impactScheduler.describe() }),
    dispose() {
      if (disposed) return;
      disposed = true;
      scene.remove(root);
      rain.dispose();
      snow.dispose();
      surfaces.dispose();
      impacts.dispose();
    },
  };
}
