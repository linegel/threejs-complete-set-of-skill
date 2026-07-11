import { Group, Vector3 } from "three/webgpu";
import { uniform } from "three/tsl";

import {
  WEATHER_QUALITY_TIERS,
  WeatherImpactReceiverRegistry,
  WorldStableImpactScheduler,
  createSharedWeatherStage,
  deriveWetSurfaceState,
  requireWeatherMechanism,
  requireWeatherTier,
} from "../webgpu-rain-snow-and-wet-surfaces/precipitation-system.js";
import {
  createPrecipitationStage,
  createWeatherImpactStage,
  createWeatherSurfaceResponseStage,
  requireWeatherMechanismProfile,
} from "../webgpu-rain-snow-and-wet-surfaces/weather-webgpu-lab.js";

const TAU = Math.PI * 2;

const REQUIRED_OWNER_KEYS = Object.freeze([
  "renderer",
  "scenePass",
  "weather",
  "toneMap",
  "outputTransform",
]);

export function createWeatherIntegrationSignals(weatherStage = createSharedWeatherStage()) {
  return {
    weatherStage,
    weather: weatherStage.weather,
    time: uniform(weatherStage.weather.time, "float"),
    deltaTime: uniform(weatherStage.weather.deltaTime, "float"),
    cameraPosition: uniform(new Vector3()),
    windDisplacement: uniform(new Vector3()),
    forcing: uniform(weatherStage.weather.forcing, "float"),
    wetness: uniform(weatherStage.weather.wetness, "float"),
    puddleFill: uniform(weatherStage.weather.puddleFill, "float"),
    snowCoverage: uniform(weatherStage.weather.snowCoverage, "float"),
    snowSeedPhase: uniform(0, "float"),
  };
}

function validateHost(host) {
  if (!host || typeof host !== "object") throw new TypeError("an image-pipeline host is required");
  if (!host.ownerId || typeof host.ownerId !== "string") throw new TypeError("host.ownerId is required");
  if (host.renderer?.backend?.isWebGPUBackend !== true) {
    throw new Error("the host must provide an initialized native-WebGPU renderer");
  }
  if (!host.renderPipeline || host.renderPipeline.renderer !== host.renderer) {
    throw new Error("the host must own one RenderPipeline bound to its renderer");
  }
  if (!host.scene || !host.camera || !host.scenePass) {
    throw new Error("the host scene, camera, and primary scenePass are required");
  }
  if (host.scenePass.scene !== host.scene || host.scenePass.camera !== host.camera) {
    throw new Error("the primary scenePass must consume the host scene and camera identities");
  }
  if (host.sceneSubmissionCount !== 1) {
    throw new Error(`precipitation integration requires exactly one host scene submission, received ${host.sceneSubmissionCount}`);
  }
  if (!host.weatherSignals || !host.signals) throw new Error("host weather and image signals are required");
  const weatherSignals = host.weatherSignals;
  if (weatherSignals.weatherStage?.weather !== weatherSignals.weather) {
    throw new Error("weatherStage and weather must share object identity");
  }
  for (const key of ["weather", "time", "deltaTime", "cameraPosition", "windDisplacement", "forcing", "wetness", "puddleFill", "snowCoverage", "snowSeedPhase"]) {
    if (host.signals[key] !== weatherSignals[key]) {
      throw new Error(`host signal "${key}" was replaced instead of shared`);
    }
  }
  for (const key of ["sceneColor", "depth"]) {
    if (!host.signals[key]) throw new Error(`host image signal "${key}" is required`);
  }
  for (const key of REQUIRED_OWNER_KEYS) {
    if (host.owners?.[key] !== host.ownerId) {
      throw new Error(`host must be the sole ${key} owner`);
    }
  }
  if (host.finalToneMapOwner !== host.ownerId || host.finalOutputTransformOwner !== host.ownerId) {
    throw new Error("tone-map and output-transform ownership must remain with the image-pipeline host");
  }
  return host;
}

function ownershipSnapshot(host) {
  return Object.freeze({
    renderer: host.renderer,
    renderPipeline: host.renderPipeline,
    outputNode: host.renderPipeline.outputNode,
    outputColorTransform: host.renderPipeline.outputColorTransform,
    finalToneMapOwner: host.finalToneMapOwner,
    finalOutputTransformOwner: host.finalOutputTransformOwner,
  });
}

function assertOwnershipStable(host, snapshot) {
  if (host.renderer !== snapshot.renderer || host.renderPipeline !== snapshot.renderPipeline) {
    throw new Error("renderer or RenderPipeline owner changed after precipitation integration");
  }
  if (host.renderPipeline.outputNode !== snapshot.outputNode
    || host.renderPipeline.outputColorTransform !== snapshot.outputColorTransform) {
    throw new Error("precipitation integration must not mutate the host output graph");
  }
  if (host.finalToneMapOwner !== snapshot.finalToneMapOwner
    || host.finalOutputTransformOwner !== snapshot.finalOutputTransformOwner) {
    throw new Error("precipitation integration must not mutate final color ownership");
  }
}

function updateUniforms(signals) {
  const weather = signals.weather;
  const surface = deriveWetSurfaceState(weather);
  signals.time.value = weather.time;
  signals.deltaTime.value = weather.deltaTime;
  signals.cameraPosition.value.copy(signals.camera.position);
  signals.windDisplacement.value.set(
    weather.windDisplacement.x,
    weather.windDisplacement.y,
    weather.windDisplacement.z,
  );
  signals.forcing.value = weather.forcing;
  signals.wetness.value = surface.wetness;
  signals.puddleFill.value = surface.puddle;
  signals.snowCoverage.value = weather.snowCoverage;
}

export function createPrecipitationImagePipelineIntegration({
  host,
  tier = "medium",
  mechanism = "weather-envelope-coupling",
  seed = 1,
} = {}) {
  validateHost(host);
  const tierConfig = requireWeatherTier(tier);
  const mechanismId = requireWeatherMechanism(mechanism);
  const mechanismProfile = requireWeatherMechanismProfile(mechanismId);
  const snapshot = ownershipSnapshot(host);
  const signals = host.weatherSignals;
  const volume = { x: 38, y: 22, z: 24 };
  const root = new Group();
  root.name = "host-owned-precipitation-integration-root";
  const rain = createPrecipitationStage({
    family: "rain",
    maxInstances: tierConfig.rainInstances,
    visibleInstances: tierConfig.rainInstances,
    seed: seed >>> 0,
    uniforms: signals,
    volume,
  });
  const snow = createPrecipitationStage({
    family: "snow",
    maxInstances: tierConfig.snowInstances,
    visibleInstances: tierConfig.snowInstances,
    seed: (seed ^ 0x9e3779b9) >>> 0,
    uniforms: signals,
    volume,
  });
  const surfaces = createWeatherSurfaceResponseStage(signals);
  const impacts = createWeatherImpactStage(signals, tierConfig.impactCapacity);
  const recurrent = mechanismProfile.precipitationMotion === "recurrent-if-tier" && tierConfig.recurrentTurbulence;
  rain.setMotionMode(recurrent ? "recurrent" : "analytic");
  snow.setMotionMode(recurrent ? "recurrent" : "analytic");
  signals.camera = host.camera;
  signals.cameraPosition.value.copy(host.camera.position);
  signals.snowSeedPhase.value = ((seed >>> 0) / 0x100000000) * TAU;
  root.add(rain.mesh, snow.mesh, surfaces.road, surfaces.snow, surfaces.snowOccluder, impacts.mesh);
  host.scene.add(root);
  rain.mesh.visible = mechanismProfile.rain;
  snow.mesh.visible = mechanismProfile.snow;
  surfaces.road.visible = mechanismProfile.road;
  surfaces.snow.visible = mechanismProfile.snowReceiver;
  surfaces.snowOccluder.visible = mechanismProfile.snowReceiver;
  impacts.mesh.visible = mechanismProfile.impacts;
  const receiverRegistry = new WeatherImpactReceiverRegistry();
  const impactScheduler = new WorldStableImpactScheduler({ seed: seed >>> 0, receiverRegistry });

  let impactAccumulator = 0;
  let disposed = false;
  const metrics = {
    recurrentDispatches: 0,
    impactAgeDispatches: 0,
    impactSpawnDispatches: 0,
    renderCalls: 0,
    privateScenePasses: 0,
    outputMutations: 0,
  };

  function update(deltaSeconds, targetForcing = mechanismProfile.targetForcing) {
    if (disposed) throw new Error("precipitation integration is disposed");
    assertOwnershipStable(host, snapshot);
    signals.weatherStage.update({
      deltaTime: deltaSeconds,
      targetForcing,
      temperatureC: mechanismProfile.temperatureC,
    });
    updateUniforms(signals);
    if (recurrent) {
      host.renderer.compute([rain.recurrentStep, snow.recurrentStep]);
      metrics.recurrentDispatches += 2;
    }
    if (mechanismProfile.impacts) {
      host.renderer.compute(impacts.age);
      metrics.impactAgeDispatches += 1;
      impactAccumulator += deltaSeconds * signals.weather.forcing;
      const accepted = [];
      while (impactAccumulator >= 0.12 && accepted.length < impacts.candidateCapacity) {
        const impact = impactScheduler.nextAccepted();
        if (impact) accepted.push(impact);
        impactAccumulator -= 0.12;
      }
      if (accepted.length > 0) {
        impacts.queueImpactCandidates(accepted);
        host.renderer.compute(impacts.spawn);
        metrics.impactSpawnDispatches += 1;
        metrics.receiverAcceptedImpacts = (metrics.receiverAcceptedImpacts ?? 0) + accepted.length;
      }
    }
    assertOwnershipStable(host, snapshot);
    return getMetrics();
  }

  function describePipeline() {
    return {
      owners: { ...host.owners },
      sharedSignalIdentity: {
        weather: host.signals.weather === signals.weather,
        time: host.signals.time === signals.time,
        deltaTime: host.signals.deltaTime === signals.deltaTime,
        cameraPosition: host.signals.cameraPosition === signals.cameraPosition,
        windDisplacement: host.signals.windDisplacement === signals.windDisplacement,
        forcing: host.signals.forcing === signals.forcing,
        wetness: host.signals.wetness === signals.wetness,
        puddleFill: host.signals.puddleFill === signals.puddleFill,
        snowCoverage: host.signals.snowCoverage === signals.snowCoverage,
        snowSeedPhase: host.signals.snowSeedPhase === signals.snowSeedPhase,
      },
      sceneSubmissions: [{ id: "host-primary-scene-pass", owner: host.ownerId, count: 1 }],
      computeDispatches: ["optional recurrent precipitation", "impact age", "bounded impact spawn"],
      finalToneMapOwner: host.finalToneMapOwner,
      finalOutputTransformOwner: host.finalOutputTransformOwner,
      adapterOwnership: { renderer: false, renderPipeline: false, scenePass: false, output: false },
    };
  }

  function getMetrics() {
    return {
      ...metrics,
      tier: tierConfig.id,
      mechanism: mechanismId,
      visibleInstances:
        (rain.mesh.visible ? rain.geometry.instanceCount : 0)
        + (snow.mesh.visible ? snow.geometry.instanceCount : 0),
      weatherForcing: signals.weather.forcing,
      wetness: signals.weather.wetness,
      puddleFill: signals.weather.puddleFill,
      snowCoverage: signals.weather.snowCoverage,
      hostOutputStable: host.renderPipeline.outputNode === snapshot.outputNode,
      receiverAcceptedImpacts: metrics.receiverAcceptedImpacts ?? 0,
      cameraWrappedPresentation: true,
      worldStableReceiverImpacts: true,
    };
  }

  function dispose() {
    if (disposed) return;
    assertOwnershipStable(host, snapshot);
    host.scene.remove(root);
    rain.dispose();
    snow.dispose();
    surfaces.dispose();
    impacts.dispose();
    disposed = true;
    assertOwnershipStable(host, snapshot);
  }

  return {
    id: "integration-precipitation-image-pipeline",
    host,
    root,
    rain,
    snow,
    surfaces,
    impacts,
    mechanismProfile,
    receiverRegistry,
    impactScheduler,
    weatherSignals: signals,
    ownership: Object.freeze({ renderer: false, renderPipeline: false, scenePass: false, output: false }),
    update,
    describePipeline,
    getMetrics,
    dispose,
  };
}

export { createSharedWeatherStage, WEATHER_QUALITY_TIERS };
