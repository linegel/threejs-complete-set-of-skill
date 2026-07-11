import {
  Data3DTexture,
  DataTexture,
  DirectionalLight,
  Group,
  LinearFilter,
  Matrix4,
  NoColorSpace,
  RedFormat,
  RepeatWrapping,
  RGBAFormat,
  UnsignedByteType,
  Vector3,
} from "three/webgpu";
import {
  color,
  float,
  mix,
  positionWorld,
  uniform,
} from "three/tsl";

import { createPlanetSceneAdapter } from "../../threejs-procedural-planets/examples/webgpu-quadtree-planet/integration-adapter.js";
import { DEFAULT_ATMOSPHERE_MODEL, createAtmosphereConfig } from "../../threejs-sky-atmosphere-and-haze/examples/webgpu-lut-atmosphere/atmosphere-config.js";
import { createAtmosphereStage, deriveAtmosphereRuntimeState } from "../../threejs-sky-atmosphere-and-haze/examples/webgpu-lut-atmosphere/webgpu-lut-atmosphere.js";
import { createDefaultCloudConfig } from "../../threejs-volumetric-clouds/examples/webgpu-weather-volume-clouds/cloud-config.js";
import { createCloudShadowCascadeConfig, sampleCloudShadowTransmission } from "../../threejs-volumetric-clouds/examples/webgpu-weather-volume-clouds/cloud-shadows.js";
import { createWeatherCloudStage } from "../../threejs-volumetric-clouds/examples/webgpu-weather-volume-clouds/webgpu-weather-volume-clouds.js";
import { createSpectralOceanStage } from "../../threejs-spectral-ocean/examples/webgpu-fft-ocean/integration-stage.js";
import { createBoundedWaterStage } from "../../threejs-water-optics/examples/webgpu-bounded-water/integration-stage.js";
import { WEATHER_QUALITY_TIERS, createSharedWeatherStage } from "../../threejs-rain-snow-and-wet-surfaces/examples/webgpu-rain-snow-and-wet-surfaces/precipitation-system.js";
import { createPrecipitationStage, createWeatherSurfaceResponseStage } from "../../threejs-rain-snow-and-wet-surfaces/examples/webgpu-rain-snow-and-wet-surfaces/weather-webgpu-lab.js";
import { createDenseVegetationSceneAdapter } from "../../threejs-procedural-vegetation/examples/webgpu-dense-grass/integration-adapter.js";

import { WORLD_UNITS_PER_METER } from "./world-contract.js";

function deterministicByte(index, seed) {
  let value = (index ^ seed) >>> 0;
  value = Math.imul(value ^ (value >>> 16), 0x7feb352d);
  value = Math.imul(value ^ (value >>> 15), 0x846ca68b);
  return (value ^ (value >>> 16)) & 255;
}

function createCloudFields(seed) {
  const weatherSize = 128;
  const weatherBytes = new Uint8Array(weatherSize * weatherSize * 4);
  for (let index = 0; index < weatherBytes.length; index += 1) weatherBytes[index] = deterministicByte(index, seed);
  const localWeather = new DataTexture(weatherBytes, weatherSize, weatherSize, RGBAFormat, UnsignedByteType);
  localWeather.needsUpdate = true;
  localWeather.colorSpace = NoColorSpace;
  localWeather.minFilter = localWeather.magFilter = LinearFilter;
  localWeather.wrapS = localWeather.wrapT = RepeatWrapping;
  const volume = (size, salt) => {
    const bytes = new Uint8Array(size ** 3);
    for (let index = 0; index < bytes.length; index += 1) bytes[index] = deterministicByte(index, seed ^ salt);
    const texture = new Data3DTexture(bytes, size, size, size);
    texture.format = RedFormat;
    texture.type = UnsignedByteType;
    texture.needsUpdate = true;
    texture.colorSpace = NoColorSpace;
    texture.minFilter = texture.magFilter = LinearFilter;
    texture.wrapS = texture.wrapT = texture.wrapR = RepeatWrapping;
    return texture;
  };
  return {
    localWeather,
    turbulence: localWeather.clone(),
    shape: volume(32, 0x1537),
    shapeDetail: volume(16, 0x8913),
    stbn: volume(32, 0x9e37),
    dispose() {
      for (const value of Object.values(this)) if (value?.isTexture) value.dispose();
    },
  };
}

function bindCloudShadowReceiver(object, transmissionNode, consumerId) {
  let boundMaterials = 0;
  object.traverse?.((candidate) => {
    const materials = Array.isArray(candidate.material)
      ? candidate.material
      : candidate.material ? [candidate.material] : [];
    for (const material of materials) {
      if (!material.isNodeMaterial) continue;
      const baseColor = material.colorNode ?? color(material.color ?? 0xffffff);
      material.colorNode = baseColor.mul(transmissionNode);
      material.userData.cloudOpticalDepthConsumer = consumerId;
      boundMaterials += 1;
    }
  });
  if (boundMaterials === 0) {
    throw new Error(`${consumerId} exposes no NodeMaterial for cloud optical-depth reception`);
  }
  return boundMaterials;
}

export function createOpaqueShadowStage(scene, tier) {
  const light = new DirectionalLight(0xfff0cf, 4.2);
  light.name = "opaque-shadow-directional-light";
  light.position.set(-80, 140, 60);
  light.castShadow = true;
  light.shadow.mapSize.set(tier.shadowMapSize, tier.shadowMapSize);
  light.shadow.camera.left = -180;
  light.shadow.camera.right = 180;
  light.shadow.camera.top = 180;
  light.shadow.camera.bottom = -180;
  light.shadow.camera.near = 1;
  light.shadow.camera.far = 400;
  scene.add(light, light.target);
  return {
    id: "opaque-shadow-stage",
    light,
    worldUnitsPerMeter: WORLD_UNITS_PER_METER,
    describeResources: () => ({
      kind: "opaque-comparison-shadow-map",
      mapSize: [light.shadow.mapSize.x, light.shadow.mapSize.y],
      separateFromCloudOpticalDepth: true,
    }),
    dispose() {
      scene.remove(light, light.target);
      light.shadow.dispose?.();
    },
  };
}

export async function createWeatheredWorldStages({ renderer, scene, camera, pipeline, sceneDepthTexture, tier, seed, viewport }) {
  if (!sceneDepthTexture) throw new Error("Weathered World cloud stage requires host scene-pass depth");
  const sharedWeather = createSharedWeatherStage({
    qualityTier: tier.weather,
    temperatureC: -1,
    precipitationRate: 0.8,
    forcing: 0.68,
    progress: 0.68,
    wetness: 0.28,
    puddleFill: 0.08,
    snowCoverage: 0.16,
    wind: { x: 8, y: 0, z: 3 },
  });
  const weather = sharedWeather.weather;
  weather.sunDirection = new Vector3(0.38, 0.82, -0.42).normalize();
  weather.windDirection = { x: weather.wind.x, z: weather.wind.z };
  weather.windStrength = Math.hypot(weather.wind.x, weather.wind.z);
  weather.windSpeed = weather.windStrength;
  weather.waterDrop = null;
  const weatherNodes = {
    time: uniform(weather.time, "float"),
    deltaTime: uniform(weather.deltaTime, "float"),
    cameraPosition: uniform(camera.position.clone()),
    forcing: uniform(weather.forcing, "float"),
    wetness: uniform(weather.wetness, "float"),
    puddleFill: uniform(weather.puddleFill, "float"),
    snowCoverage: uniform(weather.snowCoverage, "float"),
    snowSeedPhase: uniform((seed / 0x100000000) * Math.PI * 2, "float"),
    windDisplacement: uniform(new Vector3()),
  };

  const planetTier = tier.id === "hero" ? "full" : tier.id === "balanced" ? "balanced" : "reduced-webgpu";
  const planet = createPlanetSceneAdapter({
    renderer,
    scene,
    camera,
    pipeline,
    worldUnitsPerMeter: WORLD_UNITS_PER_METER,
    weather,
    tier: planetTier,
    preset: "pelagia",
    seed,
  });
  const planetRadiusWorld = planet.mesh.userData.config.radiusKm * 1000 * WORLD_UNITS_PER_METER;
  const planetAtmosphereTopMeters =
    planet.mesh.userData.config.preset.atmosphereOuterRadiusKm * 1000;
  const localTerrainAmplitudeMeters = 6;
  planet.mesh.material.userData.planetUniforms.amplitude.value =
    localTerrainAmplitudeMeters * WORLD_UNITS_PER_METER;
  planet.mesh.userData.integrationTerrainAmplitudeMeters = localTerrainAmplitudeMeters;
  planet.mesh.position.y = -planetRadiusWorld;
  // Vertex-node displacement expands the unit cube-sphere to planetary scale;
  // the undeformed BufferGeometry bound is not conservative.
  planet.mesh.frustumCulled = false;
  planet.mesh.receiveShadow = true;
  const dryRoughness = planet.mesh.material.roughnessNode;
  planet.mesh.material.roughnessNode = mix(dryRoughness, float(0.28), weatherNodes.wetness);
  planet.id = "planet-stage";
  planet.worldUnitsPerMeter = WORLD_UNITS_PER_METER;
  planet.localFrame = { originEcefMeters: [0, planet.mesh.userData.config.radiusKm * 1000, 0], axes: "east-up-north" };
  planet.implementationStatus = "canonical quadtree patch mesh plus GPU field-atlas adapter; native evidence incomplete";
  planet.describeResources = () => ({
    geometry: planet.mesh.userData.resources,
    atlas: planet.atlas.describe(),
    patchContract: planet.mesh.geometry.userData.planetPatchContract,
    integrationTerrainAmplitudeMeters: localTerrainAmplitudeMeters,
  });
  const atmosphereConfig = createAtmosphereConfig({
    tier: tier.atmosphere,
    renderUnitsPerMeter: WORLD_UNITS_PER_METER,
    model: {
      ...structuredClone(DEFAULT_ATMOSPHERE_MODEL),
      name: "weathered-world-shared-radius-atmosphere",
      radiiMeters: {
        bottom: planetRadiusWorld / WORLD_UNITS_PER_METER,
        top: planetAtmosphereTopMeters,
      },
    },
  });
  const atmosphere = createAtmosphereStage({ config: atmosphereConfig });
  await atmosphere.initialize(renderer);
  atmosphere.createResources();
  const atmosphereBodyWorld = new Matrix4().makeTranslation(
    0,
    planet.mesh.position.y,
    0,
  );
  function syncAtmosphere(cause) {
    const runtimeState = deriveAtmosphereRuntimeState({
      camera,
      bodyWorldMatrix: atmosphereBodyWorld,
      sunDirectionWorld: weather.sunDirection,
      config: atmosphereConfig,
      viewport: [viewport.width, viewport.height],
    });
    atmosphere.configureRuntimeState(runtimeState, cause);
    return atmosphere.dispatchDirty(renderer);
  }
  let atmosphereDispatch = syncAtmosphere("weathered-world-initialization");

  camera.updateMatrixWorld(true);
  const cameraForward = camera.getWorldDirection(new Vector3());
  const cameraRight = new Vector3(1, 0, 0).applyQuaternion(camera.quaternion);
  const cameraUp = new Vector3(0, 1, 0).applyQuaternion(camera.quaternion);
  const cloudConfig = createDefaultCloudConfig({
    qualityTier: tier.clouds,
    worldUnitsPerMeter: WORLD_UNITS_PER_METER,
    domain: {
      type: "spherical-shell",
      center: [0, -planetRadiusWorld, 0],
      planetRadiusMeters: planetRadiusWorld / WORLD_UNITS_PER_METER,
      innerRadiusMeters: planetRadiusWorld / WORLD_UNITS_PER_METER + 750,
      outerRadiusMeters: planetRadiusWorld / WORLD_UNITS_PER_METER + 8000,
    },
    camera: {
      positionMeters: camera.position.toArray(),
      forward: cameraForward.toArray(),
      right: cameraRight.toArray(),
      up: cameraUp.toArray(),
      verticalFovRadians: camera.fov * Math.PI / 180,
      nearMeters: camera.near,
      farMeters: camera.far,
    },
  });
  const cloud = createWeatherCloudStage({
    config: cloudConfig,
    viewport,
  });
  cloud.system.weatherState = weather;
  cloud.system.worldUnitsPerMeter = WORLD_UNITS_PER_METER;
  const cloudResources = cloud.createResources();
  cloudResources.fields = createCloudFields(seed);
  const cloudShadowConfig = createCloudShadowCascadeConfig({
    ...cloudConfig.cloudShadow,
    tier: cloudConfig.qualityTier,
  });
  const cloudShadowTransmission = sampleCloudShadowTransmission({
    worldPositionNode: positionWorld,
    shadowTextures: cloudResources.shadow,
    shadowConfig: cloudShadowConfig,
  });
  const cloudShadowConsumers = {};
  cloudShadowConsumers.planet = bindCloudShadowReceiver(
    planet.mesh,
    cloudShadowTransmission,
    "planet",
  );
  let cloudKernels = null;
  let cloudFrameIndex = 0;
  async function dispatchCloudFrame(timeSeconds, deltaTimeSeconds) {
    for (const layer of cloud.system.config.layers) {
      layer.weatherWindMetersPerSecond = {
        x: weather.wind.x,
        y: weather.wind.z,
      };
    }
    camera.updateMatrixWorld(true);
    const forward = camera.getWorldDirection(new Vector3());
    const right = new Vector3(1, 0, 0).applyQuaternion(camera.quaternion);
    const up = new Vector3(0, 1, 0).applyQuaternion(camera.quaternion);
    cloudKernels = await cloud.dispatchFrame(renderer, {
      targets: cloudResources,
      timeSeconds,
      deltaTimeSeconds,
      frameIndex: cloudFrameIndex,
      cameraState: {
        positionMeters: camera.position.toArray(),
        forward: forward.toArray(),
        right: right.toArray(),
        up: up.toArray(),
        verticalFovRadians: camera.fov * Math.PI / 180,
        nearMeters: camera.near,
        farMeters: camera.far,
      },
      sceneDepthTexture,
    });
    cloudFrameIndex += 1;
  }
  const ocean = await createSpectralOceanStage({
    renderer,
    weatherState: weather,
    quality: tier.ocean,
    seed,
    meshOptions: { sizeMeters: 420, segments: tier.id === "budgeted" ? 160 : 256 },
  });
  ocean.worldUnitsPerMeter = WORLD_UNITS_PER_METER;
  ocean.mesh.position.y = -4.5;
  ocean.mesh.receiveShadow = true;
  scene.add(ocean.mesh);
  cloudShadowConsumers.ocean = bindCloudShadowReceiver(
    ocean.mesh,
    cloudShadowTransmission,
    "spectral-ocean",
  );

  const boundedWater = await createBoundedWaterStage({
    renderer,
    weatherState: weather,
    tier: tier.boundedWater,
    seed,
  });
  boundedWater.worldUnitsPerMeter = WORLD_UNITS_PER_METER;
  boundedWater.mesh.position.set(46, -5.5, 18);
  boundedWater.mesh.receiveShadow = true;
  scene.add(boundedWater.mesh);
  cloudShadowConsumers.boundedWater = bindCloudShadowReceiver(
    boundedWater.mesh,
    cloudShadowTransmission,
    "bounded-water",
  );

  const vegetation = await createDenseVegetationSceneAdapter({
    renderer,
    scene,
    camera,
    pipeline,
    weather,
    worldUnitsPerMeter: WORLD_UNITS_PER_METER,
    tier: tier.vegetation,
    seed,
  });
  vegetation.system.object.traverse?.((object) => {
    if (object.isMesh) {
      object.castShadow = true;
      object.receiveShadow = true;
    }
  });
  cloudShadowConsumers.vegetation = bindCloudShadowReceiver(
    vegetation.system.object,
    cloudShadowTransmission,
    "vegetation",
  );

  const weatherTier = WEATHER_QUALITY_TIERS[tier.weather];
  const precipitationGroup = new Group();
  precipitationGroup.name = "canonical-weather-precipitation-families";
  const precipitationVolume = { x: 180, y: 70, z: 180 };
  const rain = createPrecipitationStage({
    family: "rain",
    maxInstances: weatherTier.rainInstances,
    visibleInstances: weatherTier.rainInstances,
    seed,
    uniforms: weatherNodes,
    volume: precipitationVolume,
  });
  const snow = createPrecipitationStage({
    family: "snow",
    maxInstances: weatherTier.snowInstances,
    visibleInstances: weatherTier.snowInstances,
    seed: seed ^ 0x9e3779b9,
    uniforms: weatherNodes,
    volume: precipitationVolume,
  });
  precipitationGroup.add(rain.mesh, snow.mesh);
  scene.add(precipitationGroup);
  const weatherSurfaces = createWeatherSurfaceResponseStage(weatherNodes);
  const weatherSurfaceGroup = new Group();
  weatherSurfaceGroup.name = "canonical-wetness-snow-surface-response";
  weatherSurfaceGroup.add(
    weatherSurfaces.road,
    weatherSurfaces.snow,
    weatherSurfaces.snowOccluder,
  );
  scene.add(weatherSurfaceGroup);
  cloudShadowConsumers.weatherSurfaces = bindCloudShadowReceiver(
    weatherSurfaceGroup,
    cloudShadowTransmission,
    "weather-surfaces",
  );
  const precipitation = {
    object: precipitationGroup,
    rain,
    snow,
    count: weatherTier.rainInstances + weatherTier.snowInstances,
    dispose() {
      scene.remove(precipitationGroup);
      rain.dispose();
      snow.dispose();
      rain.seedStorage.dispose?.();
      rain.recurrentStorage.dispose?.();
      snow.seedStorage.dispose?.();
      snow.recurrentStorage.dispose?.();
    },
  };
  const opaqueShadow = createOpaqueShadowStage(scene, tier);

  const stages = {
    planet,
    atmosphere,
    cloud,
    ocean,
    boundedWater,
    weather: sharedWeather,
    vegetation,
    precipitation,
    weatherSurfaces,
    weatherSurfaceGroup,
    opaqueShadow,
    weatherEnvelope: weather,
    weatherNodes,
    atmosphereDispatch,
    cloudResources,
    worldUnitsPerMeter: WORLD_UNITS_PER_METER,
    physicalRadiiMeters: {
      planet: planetRadiusWorld / WORLD_UNITS_PER_METER,
      atmosphere: atmosphereConfig.radiiMeters.bottom,
      cloud: cloudConfig.domain.planetRadiusMeters,
    },
    async initializeCloud() {
      if (!cloud.getResolvedHistory()) await dispatchCloudFrame(0, 0);
    },
    async update(timeSeconds, deltaSeconds, forcing = 0.68) {
      sharedWeather.update({
        deltaTime: deltaSeconds,
        targetForcing: forcing,
        temperatureC: weather.temperatureC,
        precipitationRate: weather.precipitationRate,
        wind: weather.wind,
      });
      weather.windDirection = { x: weather.wind.x, z: weather.wind.z };
      weather.windStrength = Math.hypot(weather.wind.x, weather.wind.z);
      weather.windSpeed = weather.windStrength;
      weather.waterDrop = weather.forcing > 0.1
        ? { x: Math.sin(timeSeconds * 0.7) * 8, y: Math.cos(timeSeconds * 0.53) * 8, radius: 0.8, strength: weather.forcing * 0.02 }
        : null;
      weatherNodes.time.value = weather.time;
      weatherNodes.deltaTime.value = weather.deltaTime;
      weatherNodes.cameraPosition.value.copy(camera.position);
      weatherNodes.forcing.value = weather.forcing;
      weatherNodes.wetness.value = weather.wetness;
      weatherNodes.puddleFill.value = weather.puddleFill;
      weatherNodes.snowCoverage.value = weather.snowCoverage;
      weatherNodes.windDisplacement.value.set(
        weather.windDisplacement.x,
        weather.windDisplacement.y,
        weather.windDisplacement.z,
      );
      atmosphereDispatch = syncAtmosphere("weathered-world-frame");
      planet.update({ time: weather.time });
      await dispatchCloudFrame(timeSeconds, deltaSeconds);
      await ocean.update(timeSeconds, deltaSeconds);
      boundedWater.update(deltaSeconds);
      vegetation.update({ time: weather.time });
    },
    describeWeatherConsumers() {
      return {
        cloud: cloud.system.weatherState,
        ocean: ocean.weatherState,
        boundedWater: boundedWater.weatherState,
        vegetation: weather,
        imagePipeline: weather,
        precipitation: weather,
      };
    },
    getCloudResolved() {
      return cloud.getResolvedHistory();
    },
    describeResources() {
      return [
        { id: "planet", owner: "threejs-procedural-planets", detail: planet.describeResources() },
        { id: "atmosphere", owner: "threejs-sky-atmosphere-and-haze", detail: atmosphere.describeResources() },
        { id: "cloud", owner: "threejs-volumetric-clouds", detail: cloud.describeResources() },
        { id: "cloud-optical-shadow", owner: "threejs-volumetric-clouds", detail: { count: cloudResources.shadow.length, format: "R16F optical depth" } },
        { id: "cloud-optical-shadow-consumers", owner: "threejs-volumetric-clouds", detail: cloudShadowConsumers },
        { id: "ocean", owner: "threejs-spectral-ocean", detail: ocean.describeResources() },
        { id: "bounded-water", owner: "threejs-water-optics", detail: boundedWater.describeResources() },
        { id: "vegetation", owner: "threejs-procedural-vegetation", detail: vegetation.describeOwnership() },
        { id: "opaque-shadow", owner: "threejs-scalable-real-time-shadows", detail: opaqueShadow.describeResources() },
        { id: "precipitation", owner: "threejs-rain-snow-and-wet-surfaces", detail: { instances: precipitation.count, draws: 2, families: ["rain", "snow"], canonicalStage: "createPrecipitationStage" } },
        { id: "weather-surfaces", owner: "threejs-rain-snow-and-wet-surfaces", detail: { canonicalStage: "createWeatherSurfaceResponseStage", states: ["wetness", "puddleFill", "snowCoverage"] } },
      ];
    },
    describeDispatches() {
      return [
        ...atmosphere.system.createComputeDispatchDescriptors().map((dispatch) => ({ ...dispatch, owner: "threejs-sky-atmosphere-and-haze", submitted: atmosphereDispatch.submitted.includes(dispatch.id) })),
        ...cloudKernels.cloudShadow.map((node) => ({ id: node.name, owner: "threejs-volumetric-clouds", kind: "cloud-optical-depth" })),
        ...cloudKernels.cloudBeauty.map((node) => ({ id: node.name, owner: "threejs-volumetric-clouds", kind: "cloud-beauty" })),
        ...cloudKernels.temporalResolve.map((node) => ({ id: node.name, owner: "threejs-volumetric-clouds", kind: "cloud-temporal" })),
        { id: "ocean-frame", owner: "threejs-spectral-ocean", kind: "fft-cascades", detail: ocean.describeDispatches() },
        { id: "bounded-water-frame", owner: "threejs-water-optics", kind: "heightfield", detail: boundedWater.describeDispatches() },
      ];
    },
    dispose() {
      precipitation.dispose();
      scene.remove(weatherSurfaceGroup);
      weatherSurfaces.dispose();
      opaqueShadow.dispose();
      vegetation.dispose();
      scene.remove(boundedWater.mesh);
      boundedWater.dispose();
      scene.remove(ocean.mesh);
      ocean.dispose();
      cloudResources.fields.dispose();
      cloud.dispose();
      atmosphere.dispose();
      planet.dispose();
    },
  };
  return stages;
}
