import {
  AmbientLight,
  BoxGeometry,
  Color,
  DirectionalLight,
  DoubleSide,
  InstancedBufferGeometry,
  Mesh,
  MeshBasicNodeMaterial,
  MeshPhysicalNodeMaterial,
  MeshStandardNodeMaterial,
  PerspectiveCamera,
  PlaneGeometry,
  RenderPipeline,
  RendererUtils,
  RenderTarget,
  Scene,
  StorageBufferAttribute,
  StorageInstancedBufferAttribute,
  UnsignedByteType,
  Vector2,
  Vector3,
  WebGPURenderer,
} from "three/webgpu";
import {
  Fn,
  If,
  atomicAdd,
  color,
  cos,
  exp,
  float,
  fract,
  instanceIndex,
  max,
  mix,
  mrt,
  normalLocal,
  normalView,
  normalWorldGeometry,
  output,
  pass,
  positionLocal,
  renderOutput,
  sin,
  smoothstep,
  storage,
  uniform,
  uint,
  vec3,
  vec4,
} from "three/tsl";

import {
  WEATHER_MECHANISMS,
  WEATHER_QUALITY_TIERS,
  WeatherImpactReceiverRegistry,
  WorldStableImpactScheduler,
  createWeatherEnvelope,
  deriveWetSurfaceState,
  requireWeatherMechanism,
  requireWeatherTier,
  updateWeatherEnvelope,
} from "./precipitation-system.js";

export const WEATHER_MODES = Object.freeze([
  "final",
  "mask",
  "normals",
  "particles",
  "events",
  "progress",
]);

export const WEATHER_MECHANISM_PROFILES = Object.freeze({
  "precipitation-volume": Object.freeze({
    rain: true,
    snow: true,
    road: false,
    snowReceiver: false,
    impacts: false,
    precipitationMotion: "analytic",
    targetForcing: 0.68,
    temperatureC: 4,
  }),
  "analytic-vs-recurrent": Object.freeze({
    rain: true,
    snow: true,
    road: false,
    snowReceiver: false,
    impacts: false,
    precipitationMotion: "recurrent-if-tier",
    targetForcing: 0.72,
    temperatureC: 3,
  }),
  "wet-road-and-puddles": Object.freeze({
    rain: false,
    snow: false,
    road: true,
    snowReceiver: false,
    impacts: false,
    precipitationMotion: "analytic",
    targetForcing: 0.64,
    temperatureC: 6,
  }),
  "impact-and-splashes": Object.freeze({
    rain: true,
    snow: false,
    road: true,
    snowReceiver: true,
    impacts: true,
    precipitationMotion: "analytic",
    targetForcing: 0.9,
    temperatureC: 7,
  }),
  "snow-accumulation-and-caps": Object.freeze({
    rain: false,
    snow: true,
    road: false,
    snowReceiver: true,
    impacts: false,
    precipitationMotion: "analytic",
    targetForcing: 0.82,
    temperatureC: -4,
  }),
  "weather-envelope-coupling": Object.freeze({
    rain: true,
    snow: true,
    road: true,
    snowReceiver: true,
    impacts: true,
    precipitationMotion: "recurrent-if-tier",
    targetForcing: 0.72,
    temperatureC: -2,
  }),
});

const TAU = Math.PI * 2;

export function requireWeatherMechanismProfile(id) {
  requireWeatherMechanism(id);
  return WEATHER_MECHANISM_PROFILES[id];
}

function seededFloat(index, lane, seed) {
  let value = (Math.imul(index + 1, 0x9e3779b1) ^ Math.imul(lane + 11, 0x85ebca6b) ^ seed) >>> 0;
  value = Math.imul(value ^ (value >>> 16), 0x7feb352d) >>> 0;
  value = Math.imul(value ^ (value >>> 15), 0x846ca68b) >>> 0;
  return ((value ^ (value >>> 16)) >>> 0) / 0x100000000;
}

export function createPrecipitationSeedValues(count, seed) {
  if (!Number.isInteger(count) || count <= 0) throw new RangeError("seed count must be a positive integer");
  if (!Number.isInteger(seed)) throw new TypeError("weather seed must be an integer");
  const values = new Float32Array(count * 4);
  for (let index = 0; index < count; index += 1) {
    values[index * 4] = seededFloat(index, 0, seed >>> 0);
    values[index * 4 + 1] = seededFloat(index, 1, seed >>> 0);
    values[index * 4 + 2] = seededFloat(index, 2, seed >>> 0);
    values[index * 4 + 3] = seededFloat(index, 3, seed >>> 0);
  }
  return values;
}

export function digestPrecipitationSeedValues(values) {
  if (!(values instanceof Float32Array)) throw new TypeError("seed digest requires Float32Array values");
  const words = new Uint32Array(values.buffer, values.byteOffset, values.byteLength / 4);
  let hash = 0x811c9dc5;
  for (const word of words) {
    hash ^= word;
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(16).padStart(8, "0");
}

function createSeedStorage(count, seed) {
  return new StorageInstancedBufferAttribute(createPrecipitationSeedValues(count, seed), 4);
}

export function createPrecipitationStage({
  family,
  maxInstances,
  visibleInstances,
  seed,
  uniforms,
  volume,
}) {
  const streakWidth = family === "rain" ? 0.018 : 0.075;
  const streakLength = family === "rain" ? 0.7 : 0.075;
  const base = new PlaneGeometry(streakWidth, streakLength, 1, 1);
  const geometry = new InstancedBufferGeometry().copy(base);
  base.dispose();
  geometry.instanceCount = visibleInstances;

  const seedStorage = createSeedStorage(maxInstances, seed);
  const recurrentStorage = new StorageInstancedBufferAttribute(maxInstances, 4);
  const seedNode = storage(seedStorage, "vec4", maxInstances).element(instanceIndex);
  const recurrentNode = storage(recurrentStorage, "vec4", maxInstances);
  const recurrentOffset = recurrentNode.element(instanceIndex);
  const fallSpeed = family === "rain" ? 7.2 : 1.35;
  const halfVolume = vec3(volume.x * 0.5, volume.y * 0.5, volume.z * 0.5);
  const cameraWrapped = vec3(
    fract(
      seedNode.x
        .add(uniforms.windDisplacement.x.div(volume.x))
        .sub(uniforms.cameraPosition.x.div(volume.x))
        .add(0.5),
    ).mul(volume.x),
    fract(
      seedNode.y
        .sub(uniforms.time.mul(fallSpeed / volume.y))
        .add(uniforms.windDisplacement.y.div(volume.y))
        .sub(uniforms.cameraPosition.y.div(volume.y))
        .add(0.5),
    ).mul(volume.y),
    fract(
      seedNode.z
        .add(uniforms.windDisplacement.z.div(volume.z))
        .sub(uniforms.cameraPosition.z.div(volume.z))
        .add(0.5),
    ).mul(volume.z),
  ).sub(halfVolume).add(uniforms.cameraPosition);
  const analyticPosition = positionLocal.add(cameraWrapped);
  const recurrentPosition = analyticPosition.add(recurrentOffset.xyz);

  const material = new MeshBasicNodeMaterial({
    transparent: true,
    depthWrite: false,
    side: DoubleSide,
  });
  material.colorNode = color(family === "rain" ? 0xa9d9ff : 0xf4f8ff);
  material.opacityNode = float(family === "rain" ? 0.68 : 0.84).mul(uniforms.forcing);
  material.positionNode = analyticPosition;

  const mesh = new Mesh(geometry, material);
  mesh.name = `${family}-one-storage-instanced-draw-camera-wrapped`;
  mesh.frustumCulled = false;

  const recurrentStep = Fn(() => {
    const state = recurrentNode.element(instanceIndex);
    const phase = uniforms.time.mul(family === "rain" ? 1.7 : 0.9).add(seedNode.w.mul(TAU));
    const forcing = vec3(sin(phase), 0, cos(phase.mul(1.31))).mul(family === "rain" ? 0.23 : 0.09);
    const damped = state.xyz.mul(exp(uniforms.deltaTime.mul(-2.4)));
    state.assign(vec4(damped.add(forcing.mul(uniforms.deltaTime)), state.w.add(uniforms.deltaTime)));
  })().compute(maxInstances, [64]).setName(`${family}:recurrent-turbulence`);

  return {
    family,
    mesh,
    geometry,
    material,
    seedStorage,
    recurrentStorage,
    recurrentStep,
    recurrentNode,
    motionMode: "analytic",
    setVisibleCount(count) {
      if (!Number.isInteger(count) || count < 0 || count > maxInstances) {
        throw new RangeError(`${family} visible count must be inside allocated capacity`);
      }
      geometry.instanceCount = count;
    },
    setMotionMode(mode) {
      if (mode !== "analytic" && mode !== "recurrent") {
        throw new RangeError(`unknown precipitation motion mode "${mode}"`);
      }
      this.motionMode = mode;
      material.positionNode = mode === "recurrent" ? recurrentPosition : analyticPosition;
      material.needsUpdate = true;
    },
    dispose() {
      geometry.dispose();
      material.dispose();
    },
  };
}

export function createWeatherSurfaceResponseStage(uniforms) {
  const roadGeometry = new PlaneGeometry(22, 18, 32, 16);
  const roadMaterial = new MeshPhysicalNodeMaterial({ metalness: 0, clearcoat: 1 });
  const roadColor = mix(color(0x30343a), color(0x101a21), uniforms.wetness);
  const rippleGate = uniforms.puddleFill.mul(uniforms.forcing.sub(0.5).mul(3.125).clamp(0, 1));
  const ripple = vec3(
    sin(positionLocal.x.mul(5.7).add(uniforms.time.mul(7.2))),
    sin(positionLocal.y.mul(6.1).sub(uniforms.time.mul(6.3))),
    0,
  ).mul(rippleGate.mul(0.08));
  const roadNormal = normalLocal.add(ripple).normalize();
  const roadMaskDiagnostic = vec3(uniforms.wetness, uniforms.puddleFill, rippleGate);
  const roadProgressDiagnostic = vec3(uniforms.forcing, uniforms.wetness, uniforms.puddleFill);
  roadMaterial.colorNode = roadColor;
  roadMaterial.roughnessNode = mix(float(0.78), float(0.24), uniforms.wetness);
  roadMaterial.clearcoatNode = uniforms.puddleFill.mul(0.92);
  roadMaterial.normalNode = roadNormal;
  const road = new Mesh(roadGeometry, roadMaterial);
  road.rotation.x = -Math.PI / 2;
  road.position.set(-6, -0.02, 0);
  road.name = "wet-road-integrated-response";

  const snowGeometry = new BoxGeometry(8, 2.4, 8, 16, 6, 16);
  const snowMaterial = new MeshStandardNodeMaterial({ roughness: 0.82 });
  const snowPhase = positionLocal.x.mul(0.47).add(positionLocal.z.mul(0.21)).add(uniforms.snowSeedPhase);
  const snowPhaseZ = positionLocal.z.mul(0.39).sub(positionLocal.x.mul(0.21)).sub(uniforms.snowSeedPhase.mul(1.7));
  const height = sin(snowPhase).mul(0.035).add(cos(snowPhaseZ).mul(0.035));
  const gradientX = cos(snowPhase).mul(0.035 * 0.47)
    .add(sin(snowPhaseZ).mul(0.035 * 0.21));
  const gradientZ = cos(snowPhase).mul(0.035 * 0.21)
    .sub(sin(snowPhaseZ).mul(0.035 * 0.39));
  const upwardSupport = smoothstep(0.55, 0.86, normalWorldGeometry.y);
  const outsideOccluderX = positionLocal.x.abs().sub(1.2).mul(8).clamp(0, 1);
  const outsideOccluderZ = positionLocal.z.abs().sub(1.2).mul(8).clamp(0, 1);
  const visibleToSky = max(outsideOccluderX, outsideOccluderZ);
  const snowAcceptance = upwardSupport.mul(visibleToSky).mul(uniforms.snowCoverage);
  const snowNormal = normalLocal.add(
    vec3(gradientX.negate(), 0, gradientZ.negate()).mul(snowAcceptance),
  ).normalize();
  const snowColor = mix(color(0x33414a), color(0xe8f3ff), snowAcceptance);
  const snowMaskDiagnostic = vec3(upwardSupport, visibleToSky, snowAcceptance);
  const snowProgressDiagnostic = vec3(uniforms.forcing, uniforms.snowCoverage, snowAcceptance);
  snowMaterial.positionNode = positionLocal.add(normalLocal.mul(height.mul(snowAcceptance)));
  snowMaterial.normalNode = snowNormal;
  snowMaterial.colorNode = snowColor;
  const snow = new Mesh(snowGeometry, snowMaterial);
  snow.position.set(9, 1.2, 0);
  snow.name = "snow-model-world-up-and-occlusion-rejected";

  const occluderGeometry = new BoxGeometry(3, 0.35, 3);
  const occluderMaterial = new MeshStandardNodeMaterial({ color: 0x293340, roughness: 0.66 });
  const snowOccluder = new Mesh(occluderGeometry, occluderMaterial);
  snowOccluder.position.set(9, 4, 0);
  snowOccluder.name = "snow-physical-occluder";

  function setDebugMode(mode) {
    if (!WEATHER_MODES.includes(mode)) throw new RangeError(`unknown surface diagnostic mode "${mode}"`);
    roadMaterial.colorNode = mode === "mask"
      ? roadMaskDiagnostic
      : mode === "progress"
        ? roadProgressDiagnostic
        : roadColor;
    snowMaterial.colorNode = mode === "mask"
      ? snowMaskDiagnostic
      : mode === "progress"
        ? snowProgressDiagnostic
        : snowColor;
    roadMaterial.needsUpdate = true;
    snowMaterial.needsUpdate = true;
  }

  return {
    road,
    snow,
    snowOccluder,
    roadMaterial,
    snowMaterial,
    setDebugMode,
    diagnosticSources: Object.freeze({
      mask: "live material wetness/puddle/up-support/occlusion nodes",
      normals: "scene MRT normalView attachment",
      progress: "shared weather uniforms consumed by live surface materials",
    }),
    dispose() {
      roadGeometry.dispose();
      roadMaterial.dispose();
      snowGeometry.dispose();
      snowMaterial.dispose();
      occluderGeometry.dispose();
      occluderMaterial.dispose();
    },
  };
}

function markStorageRange(attribute, start, count) {
  attribute.clearUpdateRanges?.();
  attribute.addUpdateRange?.(start, count);
  attribute.needsUpdate = true;
}

export function createWeatherImpactStage(uniforms, capacity) {
  if (!Number.isInteger(capacity) || capacity <= 0) throw new RangeError("impact capacity must be positive");
  const candidateCapacity = Math.min(64, capacity);
  const eventState = new StorageInstancedBufferAttribute(capacity, 4);
  const candidateState = new StorageInstancedBufferAttribute(candidateCapacity, 4);
  const eventNode = storage(eventState, "vec4", capacity);
  const candidateNode = storage(candidateState, "vec4", candidateCapacity);
  const counter = new StorageBufferAttribute(new Uint32Array(1), 1);
  const counterNode = storage(counter, "uint", 1);

  const spawn = Fn(() => {
    const candidate = candidateNode.element(instanceIndex);
    If(candidate.w.greaterThan(0), () => {
      const slot = atomicAdd(counterNode.element(uint(0)), uint(1)).mod(uint(capacity));
      eventNode.element(slot).assign(vec4(candidate.xyz, 1));
      candidate.w.assign(0);
    });
  })().compute(candidateCapacity, [64]).setName("weather:receiver-approved-world-cell-impact-spawn");

  const age = Fn(() => {
    const event = eventNode.element(instanceIndex);
    event.assign(vec4(event.xyz, max(0, event.w.sub(uniforms.deltaTime.mul(1.25)))));
  })().compute(capacity, [64]).setName("weather:impact-ring-age");

  const base = new PlaneGeometry(0.42, 0.42, 12, 1);
  const geometry = new InstancedBufferGeometry().copy(base);
  base.dispose();
  geometry.instanceCount = capacity;
  const state = eventNode.element(instanceIndex);
  const material = new MeshBasicNodeMaterial({ transparent: true, depthWrite: false, side: DoubleSide });
  material.colorNode = color(0xbfeaff);
  material.opacityNode = state.w.mul(uniforms.forcing);
  const horizontalSplashVertex = vec3(positionLocal.x, 0, positionLocal.y);
  material.positionNode = horizontalSplashVertex.mul(state.w).add(state.xyz);
  const mesh = new Mesh(geometry, material);
  mesh.name = "bounded-gpu-impact-ring-one-splash-draw";
  mesh.frustumCulled = false;

  return {
    capacity,
    candidateCapacity,
    eventState,
    candidateState,
    counter,
    spawn,
    age,
    mesh,
    geometry,
    material,
    queuedEvents: [],
    queueImpactCandidates(events) {
      if (!Array.isArray(events) || events.length > candidateCapacity) {
        throw new RangeError(`impact candidate batch must contain at most ${candidateCapacity} entries`);
      }
      candidateState.array.fill(0);
      this.queuedEvents = [];
      let count = 0;
      for (const event of events) {
        if (event?.accepted !== true || !event.receiverId) {
          throw new Error("only receiver-approved world-cell impacts may enter GPU candidate storage");
        }
        const offset = count * 4;
        candidateState.array[offset] = event.position.x;
        candidateState.array[offset + 1] = event.position.y + 0.035;
        candidateState.array[offset + 2] = event.position.z;
        candidateState.array[offset + 3] = 1;
        this.queuedEvents.push(event);
        count += 1;
      }
      markStorageRange(candidateState, 0, candidateState.array.length);
      return count;
    },
    clear() {
      eventState.array.fill(0);
      candidateState.array.fill(0);
      counter.array.fill(0);
      markStorageRange(eventState, 0, eventState.array.length);
      markStorageRange(candidateState, 0, candidateState.array.length);
      markStorageRange(counter, 0, counter.array.length);
      this.queuedEvents = [];
    },
    dispose() {
      geometry.dispose();
      material.dispose();
    },
  };
}

export function parseWeatherLabRoute(pathname = "/", search = "") {
  const params = new URLSearchParams(search);
  const segments = pathname.split("/").filter(Boolean);
  const mechanismIndex = segments.lastIndexOf("mechanism");
  const tierIndex = segments.lastIndexOf("tier");
  const mechanism = params.get("mechanism")
    ?? (mechanismIndex >= 0 ? segments[mechanismIndex + 1] : null)
    ?? "weather-envelope-coupling";
  const tier = params.get("tier")
    ?? (tierIndex >= 0 ? segments[tierIndex + 1] : null)
    ?? "medium";
  return {
    mechanism: requireWeatherMechanism(mechanism),
    tier: requireWeatherTier(tier).id,
  };
}

export class WebGPUWeatherSurfaceLab {
  constructor({ canvas, tier = "medium", mechanism = "weather-envelope-coupling", seed = 1 } = {}) {
    this.canvas = canvas;
    this.tier = requireWeatherTier(tier);
    this.mechanism = requireWeatherMechanism(mechanism);
    this.seed = seed >>> 0;
    const profile = requireWeatherMechanismProfile(this.mechanism);
    this.weather = createWeatherEnvelope({
      qualityTier: tier,
      temperatureC: profile.temperatureC,
    });
    this.mode = "final";
    this.cameraId = "design";
    this.targetForcing = profile.targetForcing;
    this.impactAccumulator = 0;
    this.volume = Object.freeze({ x: 38, y: 22, z: 24 });
    this.metrics = {
      analyticFrames: 0,
      recurrentDispatches: 0,
      impactAgeDispatches: 0,
      impactSpawnDispatches: 0,
      receiverAcceptedImpacts: 0,
      dynamicCpuMatrixWrites: 0,
    };
  }

  async initialize() {
    this.renderer = new WebGPURenderer({ canvas: this.canvas, antialias: false });
    await this.renderer.init();
    if (this.renderer.backend?.isWebGPUBackend !== true) {
      throw new Error("WebGPU is required for the canonical weather path");
    }

    const width = Math.max(1, this.canvas?.clientWidth || this.canvas?.width || 1200);
    const height = Math.max(1, this.canvas?.clientHeight || this.canvas?.height || 800);
    this.renderer.setSize(width, height, false);
    this.scene = new Scene();
    this.scene.background = new Color(0x101925);
    this.camera = new PerspectiveCamera(52, width / height, 0.1, 160);
    this.camera.position.set(0, 9.5, 24);
    this.camera.lookAt(5, 0, 0);
    this.scene.add(new AmbientLight(0x8fb1d8, 1.3));
    const sun = new DirectionalLight(0xfff1d2, 3.2);
    sun.position.set(-8, 16, 10);
    this.scene.add(sun);

    this.uniforms = {
      time: uniform(0, "float"),
      deltaTime: uniform(0, "float"),
      cameraPosition: uniform(this.camera.position.clone()),
      windDisplacement: uniform(new Vector3()),
      forcing: uniform(0, "float"),
      wetness: uniform(0, "float"),
      puddleFill: uniform(0, "float"),
      snowCoverage: uniform(0, "float"),
      snowSeedPhase: uniform(0, "float"),
    };
    this.surfaces = createWeatherSurfaceResponseStage(this.uniforms);
    this.scene.add(this.surfaces.road, this.surfaces.snow, this.surfaces.snowOccluder);
    this.receiverRegistry = new WeatherImpactReceiverRegistry();
    this.rebuildSeededResources(this.seed);

    this.scenePass = pass(this.scene, this.camera);
    this.scenePass.setMRT(mrt({ output, normal: normalView }));
    this.beautyNode = this.scenePass.getTextureNode("output");
    const normalTexture = this.scenePass.getTextureNode("normal");
    this.normalDiagnosticNode = vec4(normalTexture.xyz.mul(0.5).add(0.5), 1);
    this.renderPipeline = new RenderPipeline(this.renderer);
    this.renderPipeline.outputColorTransform = false;
    this.initialized = true;
    this.applyRuntimeSelection();
    this.syncUniforms();
    return this;
  }

  rebuildSeededResources(seed) {
    this.seed = seed >>> 0;
    if (!this.scene || !this.uniforms) return;
    for (const stage of [this.rain, this.snow, this.impacts]) {
      if (!stage) continue;
      this.scene.remove(stage.mesh);
      stage.dispose();
    }
    this.uniforms.snowSeedPhase.value = (this.seed / 0x100000000) * TAU;
    this.rain = createPrecipitationStage({
      family: "rain",
      maxInstances: this.tier.rainInstances,
      visibleInstances: this.tier.rainInstances,
      seed: this.seed,
      uniforms: this.uniforms,
      volume: this.volume,
    });
    this.snow = createPrecipitationStage({
      family: "snow",
      maxInstances: this.tier.snowInstances,
      visibleInstances: this.tier.snowInstances,
      seed: this.seed ^ 0x9e3779b9,
      uniforms: this.uniforms,
      volume: this.volume,
    });
    this.impacts = createWeatherImpactStage(this.uniforms, this.tier.impactCapacity);
    this.seedDigests = Object.freeze({
      rain: digestPrecipitationSeedValues(this.rain.seedStorage.array),
      snow: digestPrecipitationSeedValues(this.snow.seedStorage.array),
    });
    this.impactScheduler = new WorldStableImpactScheduler({
      seed: this.seed,
      receiverRegistry: this.receiverRegistry,
    });
    this.scene.add(this.rain.mesh, this.snow.mesh, this.impacts.mesh);
    this.impactAccumulator = 0;
    this.applyRuntimeSelection();
  }

  syncUniforms() {
    const wet = deriveWetSurfaceState(this.weather);
    this.uniforms.time.value = this.weather.time;
    this.uniforms.deltaTime.value = this.weather.deltaTime;
    this.uniforms.cameraPosition.value.copy(this.camera.position);
    this.uniforms.windDisplacement.value.set(
      this.weather.windDisplacement.x,
      this.weather.windDisplacement.y,
      this.weather.windDisplacement.z,
    );
    this.uniforms.forcing.value = this.weather.forcing;
    this.uniforms.wetness.value = wet.wetness;
    this.uniforms.puddleFill.value = wet.puddle;
    this.uniforms.snowCoverage.value = this.weather.snowCoverage;
  }

  getMechanismRuntimeProfile() {
    const profile = requireWeatherMechanismProfile(this.mechanism);
    return {
      ...profile,
      recurrent: profile.precipitationMotion === "recurrent-if-tier" && this.tier.recurrentTurbulence,
    };
  }

  applyRuntimeSelection() {
    if (!this.rain || !this.snow || !this.impacts || !this.surfaces) return;
    const profile = this.getMechanismRuntimeProfile();
    const visibility = {
      rain: profile.rain,
      snow: profile.snow,
      road: profile.road,
      snowReceiver: profile.snowReceiver,
      impacts: profile.impacts,
    };

    if (this.mode === "particles") {
      Object.assign(visibility, { rain: true, snow: true, road: false, snowReceiver: false, impacts: false });
    } else if (this.mode === "events") {
      Object.assign(visibility, { rain: false, snow: false, road: true, snowReceiver: true, impacts: true });
    } else if (["mask", "normals", "progress"].includes(this.mode)) {
      Object.assign(visibility, { rain: false, snow: false, impacts: false });
      visibility.road = profile.road || !profile.snowReceiver;
      visibility.snowReceiver = profile.snowReceiver || !profile.road;
    }

    this.rain.mesh.visible = visibility.rain;
    this.snow.mesh.visible = visibility.snow;
    this.surfaces.road.visible = visibility.road;
    this.surfaces.snow.visible = visibility.snowReceiver;
    this.surfaces.snowOccluder.visible = visibility.snowReceiver;
    this.impacts.mesh.visible = visibility.impacts;
    this.rain.setMotionMode(profile.recurrent ? "recurrent" : "analytic");
    this.snow.setMotionMode(profile.recurrent ? "recurrent" : "analytic");
    this.surfaces.setDebugMode(this.mode);

    if (this.renderPipeline) {
      this.renderPipeline.outputNode = renderOutput(
        this.mode === "normals" ? this.normalDiagnosticNode : this.beautyNode,
      );
      this.renderPipeline.needsUpdate = true;
    }
    this.runtimeVisibility = Object.freeze({ ...visibility });
  }

  async ready() {
    if (!this.initialized) await this.initialize();
  }

  async setScenario(id) {
    this.mechanism = requireWeatherMechanism(id);
    const profile = requireWeatherMechanismProfile(id);
    this.targetForcing = profile.targetForcing;
    this.weather.temperatureC = profile.temperatureC;
    this.applyRuntimeSelection();
  }

  async setMode(id) {
    if (!WEATHER_MODES.includes(id)) throw new RangeError(`unknown weather mode "${id}"`);
    this.mode = id;
    this.applyRuntimeSelection();
  }

  async setTier(id) {
    this.tier = requireWeatherTier(id);
    this.weather.qualityTier = id;
    this.rebuildSeededResources(this.seed);
  }

  async setSeed(seed) {
    if (!Number.isInteger(seed)) throw new TypeError("weather seed must be an integer");
    this.rebuildSeededResources(seed >>> 0);
  }

  async setCamera(id) {
    const poses = {
      near: { position: [1, 3.2, 9], target: [2, 0, 0] },
      design: { position: [0, 9.5, 24], target: [5, 0, 0] },
      far: { position: [-4, 17, 45], target: [6, 0, 0] },
    };
    const pose = poses[id];
    if (!pose) throw new RangeError(`unknown weather camera "${id}"`);
    this.cameraId = id;
    this.camera.position.fromArray(pose.position);
    this.camera.lookAt(...pose.target);
    this.uniforms.cameraPosition.value.copy(this.camera.position);
  }

  async setTime(seconds) {
    if (!Number.isFinite(seconds) || seconds < 0) throw new RangeError("weather time must be nonnegative");
    const profile = this.getMechanismRuntimeProfile();
    this.weather = createWeatherEnvelope({
      qualityTier: this.tier.id,
      temperatureC: profile.temperatureC,
    });
    updateWeatherEnvelope(this.weather, {
      deltaTime: seconds,
      targetForcing: this.targetForcing,
      temperatureC: profile.temperatureC,
    });
    this.syncUniforms();
  }

  async step(deltaSeconds) {
    const profile = this.getMechanismRuntimeProfile();
    updateWeatherEnvelope(this.weather, {
      deltaTime: deltaSeconds,
      targetForcing: this.targetForcing,
      temperatureC: profile.temperatureC,
    });
    this.syncUniforms();

    if (profile.recurrent) {
      this.renderer.compute([this.rain.recurrentStep, this.snow.recurrentStep]);
      this.metrics.recurrentDispatches += 2;
    } else {
      this.metrics.analyticFrames += 1;
    }

    const impactRuntimeEnabled = profile.impacts || this.mode === "events";
    if (impactRuntimeEnabled) {
      this.renderer.compute(this.impacts.age);
      this.metrics.impactAgeDispatches += 1;
      this.impactAccumulator += deltaSeconds * this.weather.forcing;
      let emitted = 0;
      const acceptedBatch = [];
      while (this.impactAccumulator >= 0.12 && emitted < 4) {
        const impact = this.impactScheduler.nextAccepted();
        if (impact) {
          acceptedBatch.push(impact);
        }
        this.impactAccumulator -= 0.12;
        emitted += 1;
      }
      if (acceptedBatch.length > 0) {
        this.impacts.queueImpactCandidates(acceptedBatch);
        this.renderer.compute(this.impacts.spawn);
        this.metrics.impactSpawnDispatches += 1;
        this.metrics.receiverAcceptedImpacts += acceptedBatch.length;
        this.lastAcceptedImpact = acceptedBatch.at(-1);
      }
    }
  }

  async resetHistory() {
    const profile = this.getMechanismRuntimeProfile();
    this.weather = createWeatherEnvelope({
      qualityTier: this.tier.id,
      temperatureC: profile.temperatureC,
    });
    this.rebuildSeededResources(this.seed);
    this.syncUniforms();
  }

  async resize(width, height, dpr = 1) {
    if (![width, height, dpr].every(Number.isFinite) || width <= 0 || height <= 0 || dpr <= 0) {
      throw new RangeError("weather resize dimensions and DPR must be positive");
    }
    this.renderer.setPixelRatio(dpr);
    this.renderer.setSize(width, height, false);
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
  }

  async renderOnce() {
    this.renderPipeline.render();
  }

  async capturePixels(target = this.mode) {
    if (!WEATHER_MODES.includes(target)) throw new RangeError(`unknown weather capture target "${target}"`);
    const previousMode = this.mode;
    await this.setMode(target);
    const size = this.renderer.getDrawingBufferSize(new Vector2());
    const width = Math.trunc(size.x);
    const height = Math.trunc(size.y);
    const renderTarget = new RenderTarget(width, height, { type: UnsignedByteType, samples: 1 });
    const state = RendererUtils.saveRendererState(this.renderer);
    let pixels;
    try {
      this.renderer.setRenderTarget(renderTarget);
      this.renderPipeline.render();
      pixels = await this.renderer.readRenderTargetPixelsAsync(renderTarget, 0, 0, width, height);
    } finally {
      RendererUtils.restoreRendererState(this.renderer, state);
      renderTarget.dispose();
      await this.setMode(previousMode);
    }
    const rowBytes = width * 4;
    const alignedBytesPerRow = Math.ceil(rowBytes / 256) * 256;
    const paddedLength = alignedBytesPerRow * (height - 1) + rowBytes;
    const bytesPerRow = pixels.length >= paddedLength ? alignedBytesPerRow : rowBytes;
    if (!Number.isInteger(bytesPerRow) || bytesPerRow < rowBytes) {
      throw new Error(`invalid WebGPU readback stride ${bytesPerRow} for row ${rowBytes}`);
    }
    return {
      target,
      width,
      height,
      format: "rgba8unorm",
      outputColorSpace: this.renderer.outputColorSpace,
      bytesPerPixel: 4,
      bytesPerRow,
      pixels,
    };
  }

  describePipeline() {
    const profile = this.getMechanismRuntimeProfile();
    const dispatches = [];
    if (profile.recurrent) dispatches.push("rain recurrent turbulence", "snow recurrent turbulence");
    if (profile.impacts || this.mode === "events") {
      dispatches.push("receiver-approved impact age", "receiver-approved impact spawn");
    }
    return {
      owners: {
        renderer: "threejs-rain-snow-and-wet-surfaces",
        finalPipeline: "threejs-rain-snow-and-wet-surfaces",
        weather: "threejs-rain-snow-and-wet-surfaces",
        toneMap: "RenderOutputNode",
        outputTransform: "RenderOutputNode",
      },
      mechanism: this.mechanism,
      mechanismProfile: profile,
      runtimeVisibility: this.runtimeVisibility,
      signals: ["time", "deltaTime", "cameraPosition", "wind", "forcing", "wetness", "puddleFill", "snowCoverage"],
      sceneSubmissions: [{ id: "weather-scene-output-normal-mrt", count: 1 }],
      computeDispatches: dispatches,
      diagnosticSources: {
        normals: "scenePass MRT normal attachment",
        mask: this.surfaces.diagnosticSources.mask,
        events: "impact eventState storage rendered by splash mesh",
        particles: "camera-wrapped precipitation storage instances",
        progress: this.surfaces.diagnosticSources.progress,
      },
      finalToneMapOwner: "RenderOutputNode",
      finalOutputTransformOwner: "RenderOutputNode",
    };
  }

  describeResources() {
    return {
      precipitation: {
        rainSeedBytes: this.rain?.seedStorage.array.byteLength ?? 0,
        rainRecurrentBytes: this.rain?.recurrentStorage.array.byteLength ?? 0,
        snowSeedBytes: this.snow?.seedStorage.array.byteLength ?? 0,
        snowRecurrentBytes: this.snow?.recurrentStorage.array.byteLength ?? 0,
      },
      impacts: {
        capacity: this.impacts?.capacity ?? 0,
        eventBytes: this.impacts?.eventState.array.byteLength ?? 0,
        candidateBytes: this.impacts?.candidateState.array.byteLength ?? 0,
        counterBytes: this.impacts?.counter.array.byteLength ?? 0,
      },
      renderTargets: {
        sceneOutput: "live scenePass output attachment",
        sceneNormal: "live scenePass normalView MRT attachment",
      },
      draws: {
        rainFamilies: 1,
        snowFamilies: 1,
        splashPools: 1,
      },
    };
  }

  getMetrics() {
    return {
      ...this.metrics,
      backendIsWebGPU: this.renderer.backend?.isWebGPUBackend === true,
      tier: this.tier.id,
      mechanism: this.mechanism,
      mode: this.mode,
      seed: this.seed,
      seedDigests: this.seedDigests,
      forcing: this.weather.forcing,
      wetness: this.weather.wetness,
      puddleFill: this.weather.puddleFill,
      snowCoverage: this.weather.snowCoverage,
      visibleInstances:
        (this.runtimeVisibility.rain ? this.rain.geometry.instanceCount : 0)
        + (this.runtimeVisibility.snow ? this.snow.geometry.instanceCount : 0),
      runtimeVisibility: this.runtimeVisibility,
      impactScheduler: this.impactScheduler.describe(),
      lastAcceptedImpact: this.lastAcceptedImpact ?? null,
      drawCountContract: 3,
      storage: this.describeResources(),
    };
  }

  async dispose() {
    this.renderer?.setAnimationLoop(null);
    this.rain?.dispose();
    this.snow?.dispose();
    this.impacts?.dispose();
    this.surfaces?.dispose();
    this.scenePass?.dispose?.();
    this.renderPipeline?.dispose();
    this.renderer?.dispose();
    this.disposed = true;
  }
}

export async function createWeatherSurfaceLab(options) {
  const lab = new WebGPUWeatherSurfaceLab(options);
  await lab.initialize();
  return lab;
}
