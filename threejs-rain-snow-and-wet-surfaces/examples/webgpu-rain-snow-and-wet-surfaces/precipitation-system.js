import {
  MeshPhysicalNodeMaterial,
  MeshStandardNodeMaterial,
  NoColorSpace,
  RenderPipeline,
  SpriteNodeMaterial,
  SRGBColorSpace,
  WebGPURenderer,
} from "three/webgpu";
import {
  Fn,
  float,
  instanceIndex,
  instancedArray,
  mrt,
  pass,
  storage,
  textureStore,
  uniform,
  vec2,
  vec3,
  vec4,
} from "three/tsl";

const tslSymbols = {
  Fn,
  float,
  instanceIndex,
  instancedArray,
  storage,
  textureStore,
  uniform,
  vec2,
  vec3,
  vec4,
  pass,
  mrt,
};

void tslSymbols;

export const TERMINAL_VELOCITY_RANGES = Object.freeze({
  rainMetersPerSecond: [4, 9],
  snowMetersPerSecond: [0.8, 3.5],
  validity: "inspection-scale scenes; art direction may scale but must keep particles and surfaces coupled",
});

export const DEFAULT_WEATHER_ENVELOPE = Object.freeze({
  time: 0,
  deltaTime: 0,
  elapsedDeltaTime: 0,
  wind: { x: 1.2, y: 0, z: 0.5 },
  windDisplacement: { x: 0, y: 0, z: 0 },
  temperatureC: 5,
  forcing: 0,
  progress: 0,
  precipitationRate: 1,
  wetness: 0,
  puddleFill: 0,
  snowCoverage: 0,
  qualityTier: "medium",
  debugMode: "final",
});

export const WEATHER_MECHANISMS = Object.freeze([
  "precipitation-volume",
  "analytic-vs-recurrent",
  "wet-road-and-puddles",
  "impact-and-splashes",
  "snow-accumulation-and-caps",
  "weather-envelope-coupling",
]);

export const WEATHER_QUALITY_TIERS = Object.freeze({
  high: Object.freeze({
    id: "high",
    targetClass: "close-inspection",
    rainInstances: 24576,
    snowInstances: 12288,
    impactCapacity: 4096,
    receiverScale: 1,
    recurrentTurbulence: true,
  }),
  medium: Object.freeze({
    id: "medium",
    targetClass: "ordinary-inspection",
    rainInstances: 12288,
    snowInstances: 6144,
    impactCapacity: 2048,
    receiverScale: 0.5,
    recurrentTurbulence: false,
  }),
  budgeted: Object.freeze({
    id: "budgeted",
    targetClass: "small-projected-footprint",
    rainInstances: 4096,
    snowInstances: 2048,
    impactCapacity: 512,
    receiverScale: 0.25,
    recurrentTurbulence: false,
  }),
});

export const WEATHER_RESPONSE_RATES = Object.freeze({
  wetDepositionPerSecond: 1.8,
  wetDrainagePerSecond: 0.16,
  puddleDepositionPerSecond: 0.72,
  puddleDrainagePerSecond: 0.08,
  snowDepositionPerSecond: 0.34,
  snowMeltPerSecondPerDegree: 0.028,
});

export const RAIN_SNOW_DEBUG_VIEWS = Object.freeze([
  "final",
  "mask",
  "normals",
  "particles",
  "events",
  "progress",
  "storage buffers",
  "camera-wrap edge test",
  "wetness mask",
  "impact occupancy",
]);

export function clampDeltaTime(deltaTime, maxDeltaTime = 1 / 15) {
  if (!Number.isFinite(deltaTime) || deltaTime <= 0) {
    return 0;
  }
  return Math.min(deltaTime, maxDeltaTime);
}

export function createWeatherEnvelope(overrides = {}) {
  return {
    ...structuredClone(DEFAULT_WEATHER_ENVELOPE),
    ...overrides,
    wind: { ...DEFAULT_WEATHER_ENVELOPE.wind, ...(overrides.wind ?? {}) },
    windDisplacement: {
      ...DEFAULT_WEATHER_ENVELOPE.windDisplacement,
      ...(overrides.windDisplacement ?? {}),
    },
  };
}

export function createSharedWeatherStage(overrides = {}) {
  const weather = createWeatherEnvelope(overrides);
  return {
    weather,
    ownership: Object.freeze({ renderer: false, renderPipeline: false, output: false }),
    update(options) {
      return updateWeatherEnvelope(weather, options);
    },
    surfaceState() {
      return deriveWetSurfaceState(weather);
    },
    reset(resetOverrides = {}) {
      const reset = createWeatherEnvelope({ ...overrides, ...resetOverrides });
      for (const key of Object.keys(weather)) delete weather[key];
      Object.assign(weather, reset);
      return weather;
    },
  };
}

export function integrateBoundedResponse(previous, sourceRate, lossRate, elapsedSeconds) {
  if (![previous, sourceRate, lossRate, elapsedSeconds].every(Number.isFinite)) {
    throw new TypeError("weather response inputs must be finite");
  }
  if (elapsedSeconds < 0 || sourceRate < 0 || lossRate < 0) {
    throw new RangeError("weather response rates and elapsed time must be nonnegative");
  }
  const totalRate = sourceRate + lossRate;
  if (totalRate === 0 || elapsedSeconds === 0) return Math.min(1, Math.max(0, previous));
  const equilibrium = sourceRate / totalRate;
  return Math.min(1, Math.max(0, equilibrium + (previous - equilibrium) * Math.exp(-totalRate * elapsedSeconds)));
}

export function updateWeatherEnvelope(weather, {
  deltaTime,
  targetForcing = weather.forcing ?? weather.progress,
  targetProgress = targetForcing,
  wind = weather.wind,
  temperatureC = weather.temperatureC,
  precipitationRate = weather.precipitationRate,
  responseRates = WEATHER_RESPONSE_RATES,
} = {}) {
  if (!Number.isFinite(deltaTime) || deltaTime < 0) {
    throw new RangeError("deltaTime must be finite and nonnegative");
  }
  if (!Number.isFinite(targetProgress) || targetProgress < 0 || targetProgress > 1) {
    throw new RangeError("target forcing must be finite and inside [0, 1]");
  }
  const elapsed = deltaTime;
  const visualDt = clampDeltaTime(elapsed);
  weather.deltaTime = visualDt;
  weather.elapsedDeltaTime = elapsed;
  weather.time += elapsed;
  weather.windDisplacement.x += 0.5 * (weather.wind.x + wind.x) * elapsed;
  weather.windDisplacement.y += 0.5 * (weather.wind.y + wind.y) * elapsed;
  weather.windDisplacement.z += 0.5 * (weather.wind.z + wind.z) * elapsed;
  weather.wind = { ...wind };
  weather.temperatureC = temperatureC;
  weather.precipitationRate = precipitationRate;
  const responseSteps = Math.max(1, Math.ceil(elapsed * 240 - 1e-12));
  const responseDt = elapsed / responseSteps;
  for (let step = 0; step < responseSteps; step += 1) {
    const damping = 1 - Math.exp(-0.9 * responseDt);
    weather.progress += (targetProgress - weather.progress) * damping;
    weather.forcing = weather.progress;
    const forcingRate = weather.forcing * precipitationRate;
    weather.wetness = integrateBoundedResponse(
      weather.wetness,
      forcingRate * responseRates.wetDepositionPerSecond,
      responseRates.wetDrainagePerSecond,
      responseDt,
    );
    weather.puddleFill = integrateBoundedResponse(
      weather.puddleFill,
      forcingRate * responseRates.puddleDepositionPerSecond,
      responseRates.puddleDrainagePerSecond,
      responseDt,
    );
    const meltRate = Math.max(0, temperatureC) * responseRates.snowMeltPerSecondPerDegree;
    const snowSource = temperatureC <= 1 ? forcingRate * responseRates.snowDepositionPerSecond : 0;
    weather.snowCoverage = integrateBoundedResponse(
      weather.snowCoverage,
      snowSource,
      meltRate,
      responseDt,
    );
  }
  return weather;
}

export function requireWeatherTier(tierId) {
  const tier = WEATHER_QUALITY_TIERS[tierId];
  if (!tier) throw new RangeError(`unknown weather tier "${tierId}"`);
  return tier;
}

export function requireWeatherMechanism(mechanismId) {
  if (!WEATHER_MECHANISMS.includes(mechanismId)) {
    throw new RangeError(`unknown weather mechanism "${mechanismId}"`);
  }
  return mechanismId;
}

export function deriveWetSurfaceState(weather) {
  const wetness = Math.min(1, Math.max(0, weather.wetness));
  const puddle = Math.min(1, Math.max(0, weather.puddleFill));
  const heavyRainGate = smoothstep(0.5, 0.82, weather.forcing);
  return {
    wetness,
    puddle,
    roughness: 0.78 + (0.24 - 0.78) * wetness,
    albedoScale: 1 - 0.24 * wetness,
    clearcoat: 0.92 * puddle,
    rippleNormalStrength: heavyRainGate * puddle,
  };
}

export function evaluateSnowField(x, z, seed = 1) {
  const phase = seed * 0.0000137;
  const kx = 0.47;
  const kz = 0.39;
  const crossK = 0.21;
  const a = 0.035;
  const b = 0.018;
  const h = a * Math.sin(kx * x + phase)
    + a * Math.cos(kz * z - phase * 1.7)
    + b * Math.sin(crossK * (x + z) + phase * 0.31);
  const dx = a * kx * Math.cos(kx * x + phase)
    + b * crossK * Math.cos(crossK * (x + z) + phase * 0.31);
  const dz = -a * kz * Math.sin(kz * z - phase * 1.7)
    + b * crossK * Math.cos(crossK * (x + z) + phase * 0.31);
  return { height: h, gradient: { x: dx, z: dz } };
}

export function evaluateSnowCoverage({
  modelPosition,
  worldNormal,
  up = { x: 0, y: 1, z: 0 },
  visible = true,
  occluded = false,
  coverage = 1,
  seed = 1,
} = {}) {
  const support = worldNormal.x * up.x + worldNormal.y * up.y + worldNormal.z * up.z;
  const supportMask = smoothstep(0.55, 0.86, support);
  const field = evaluateSnowField(modelPosition.x, modelPosition.z, seed);
  const accepted = !visible || occluded ? 0 : supportMask * Math.min(1, Math.max(0, coverage));
  const normalLength = Math.hypot(field.gradient.x, 1, field.gradient.z);
  return {
    displacement: field.height * accepted,
    coverage: accepted,
    normal: {
      x: -field.gradient.x / normalLength,
      y: 1 / normalLength,
      z: -field.gradient.z / normalLength,
    },
    field,
  };
}

export function streakLengthMeters(speedMetersPerSecond, shutterSeconds) {
  if (!Number.isFinite(speedMetersPerSecond) || speedMetersPerSecond < 0) {
    throw new RangeError("speedMetersPerSecond must be finite and nonnegative");
  }
  if (!Number.isFinite(shutterSeconds) || shutterSeconds < 0) {
    throw new RangeError("shutterSeconds must be finite and nonnegative");
  }
  return speedMetersPerSecond * shutterSeconds;
}

export function createPrecipitationStoragePlan({
  maxInstances = 100000,
  family = "rain",
} = {}) {
  const bytesPerVec4 = 16;
  return {
    family,
    maxInstances,
    positionLife: {
      api: "instancedArray(maxInstances, vec4)",
      bytes: maxInstances * bytesPerVec4,
      role: "position.xyz + opacity/life",
    },
    velocityLife: {
      api: "instancedArray(maxInstances, vec4)",
      bytes: maxInstances * bytesPerVec4,
      role: "fall velocity + wind contribution + phase",
    },
    seedFlags: {
      api: "instancedArray(maxInstances, vec4)",
      bytes: maxInstances * bytesPerVec4,
      role: "seed, size, material variant, active flag",
    },
    dynamicMirroredToCpu: false,
  };
}

export function estimateStorageBytes(plan) {
  return plan.positionLife.bytes + plan.velocityLife.bytes + plan.seedFlags.bytes;
}

export function cameraWrapPosition({
  seed,
  camera,
  volume,
  windDisplacement,
  fallSpeed,
  time,
}) {
  const origin = {
    x: camera.x - volume.x * 0.5,
    y: camera.y - volume.y * 0.5,
    z: camera.z - volume.z * 0.5,
  };
  const base = {
    x: seed.x * volume.x,
    y: seed.y * volume.y,
    z: seed.z * volume.z,
  };
  const displaced = {
    x: base.x + windDisplacement.x - origin.x,
    y: base.y - fallSpeed * time + windDisplacement.y - origin.y,
    z: base.z + windDisplacement.z - origin.z,
  };
  return {
    x: positiveModulo(displaced.x, volume.x) + origin.x,
    y: positiveModulo(displaced.y, volume.y) + origin.y,
    z: positiveModulo(displaced.z, volume.z) + origin.z,
  };
}

export function hashWorldCell(x, z, seed = 1) {
  let value = (Math.imul(x | 0, 0x1f123bb5) ^ Math.imul(z | 0, 0x5f356495) ^ (seed | 0)) >>> 0;
  value = Math.imul(value ^ (value >>> 16), 0x7feb352d) >>> 0;
  value = Math.imul(value ^ (value >>> 15), 0x846ca68b) >>> 0;
  return (value ^ (value >>> 16)) >>> 0;
}

export function worldStableImpact({ cellX, cellZ, seed = 1, cellSize = 2, receiverY = 0 }) {
  if (!Number.isInteger(cellX) || !Number.isInteger(cellZ)) {
    throw new TypeError("world impact cells must be integer coordinates");
  }
  const hash = hashWorldCell(cellX, cellZ, seed);
  const u = (hash & 0xffff) / 0x10000;
  const v = ((hash >>> 16) & 0xffff) / 0x10000;
  return {
    id: `${cellX}:${cellZ}:${hash.toString(16).padStart(8, "0")}`,
    hash,
    position: {
      x: (cellX + u) * cellSize,
      y: receiverY,
      z: (cellZ + v) * cellSize,
    },
  };
}

export const CANONICAL_WEATHER_RECEIVERS = Object.freeze([
  Object.freeze({
    id: "wet-road",
    kind: "road",
    minX: -17,
    maxX: 5,
    minZ: -9,
    maxZ: 9,
    height: 0,
    worldNormal: Object.freeze({ x: 0, y: 1, z: 0 }),
    visible: true,
    occluders: Object.freeze([]),
  }),
  Object.freeze({
    id: "snow-cap",
    kind: "snow-cap",
    minX: 5,
    maxX: 13,
    minZ: -4,
    maxZ: 4,
    height: 2.4,
    worldNormal: Object.freeze({ x: 0, y: 1, z: 0 }),
    visible: true,
    occluders: Object.freeze([
      Object.freeze({ minX: 7.8, maxX: 10.2, minZ: -1.2, maxZ: 1.2 }),
    ]),
  }),
]);

function pointInsideBounds(x, z, bounds) {
  return x >= bounds.minX && x <= bounds.maxX && z >= bounds.minZ && z <= bounds.maxZ;
}

export class WeatherImpactReceiverRegistry {
  constructor(receivers = CANONICAL_WEATHER_RECEIVERS) {
    if (!Array.isArray(receivers) || receivers.length === 0) {
      throw new RangeError("weather receiver registry requires at least one receiver");
    }
    this.receivers = receivers.map((receiver) => Object.freeze({
      ...structuredClone(receiver),
      worldNormal: Object.freeze({ ...receiver.worldNormal }),
      occluders: Object.freeze((receiver.occluders ?? []).map((bounds) => Object.freeze({ ...bounds }))),
    }));
  }

  resolve(position) {
    if (![position?.x, position?.z].every(Number.isFinite)) {
      throw new TypeError("impact receiver query position must contain finite x/z");
    }
    const receiver = this.receivers.find((candidate) => pointInsideBounds(position.x, position.z, candidate));
    if (!receiver) {
      return Object.freeze({ accepted: false, reason: "outside-receiver-field", receiver: null });
    }
    const occluded = receiver.occluders.some((bounds) => pointInsideBounds(position.x, position.z, bounds));
    const accepted = acceptImpactReceiver({
      worldNormal: receiver.worldNormal,
      visible: receiver.visible,
      occluded,
    });
    return Object.freeze({
      accepted,
      reason: accepted ? "accepted" : occluded ? "occluded" : "receiver-orientation-rejected",
      receiver,
      occluded,
      position: Object.freeze({ x: position.x, y: receiver.height, z: position.z }),
    });
  }
}

export function createWorldImpactCandidate({
  sequence,
  seed = 1,
  cellSize = 2,
  receiverRegistry = new WeatherImpactReceiverRegistry(),
} = {}) {
  if (!Number.isInteger(sequence) || sequence < 0) {
    throw new RangeError("impact sequence must be a nonnegative integer");
  }
  const selector = hashWorldCell(sequence, seed ^ 0x6a09e667, seed);
  const cellX = -9 + (selector & 15);
  const cellZ = -4 + ((selector >>> 8) & 7);
  const impact = worldStableImpact({
    cellX,
    cellZ,
    seed: seed >>> 0,
    cellSize,
  });
  const receiverResult = receiverRegistry.resolve(impact.position);
  return Object.freeze({
    ...impact,
    sequence,
    cellX,
    cellZ,
    accepted: receiverResult.accepted,
    rejectionReason: receiverResult.accepted ? null : receiverResult.reason,
    receiverId: receiverResult.receiver?.id ?? null,
    receiverKind: receiverResult.receiver?.kind ?? null,
    position: receiverResult.position ?? Object.freeze({ ...impact.position }),
  });
}

export class WorldStableImpactScheduler {
  constructor({ seed = 1, receiverRegistry = new WeatherImpactReceiverRegistry() } = {}) {
    this.seed = seed >>> 0;
    this.receiverRegistry = receiverRegistry;
    this.sequence = 0;
    this.acceptedCount = 0;
    this.rejectedCount = 0;
    this.rejectionReasons = new Map();
  }

  nextAccepted(maxAttempts = 32) {
    if (!Number.isInteger(maxAttempts) || maxAttempts <= 0) {
      throw new RangeError("maxAttempts must be a positive integer");
    }
    for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
      const candidate = createWorldImpactCandidate({
        sequence: this.sequence,
        seed: this.seed,
        receiverRegistry: this.receiverRegistry,
      });
      this.sequence += 1;
      if (candidate.accepted) {
        this.acceptedCount += 1;
        return candidate;
      }
      this.rejectedCount += 1;
      const reason = candidate.rejectionReason ?? "unknown";
      this.rejectionReasons.set(reason, (this.rejectionReasons.get(reason) ?? 0) + 1);
    }
    return null;
  }

  describe() {
    return {
      seed: this.seed,
      sequence: this.sequence,
      acceptedCount: this.acceptedCount,
      rejectedCount: this.rejectedCount,
      rejectionReasons: Object.fromEntries(this.rejectionReasons),
      receiverIds: this.receiverRegistry.receivers.map(({ id }) => id),
    };
  }
}

export class BoundedSplashRing {
  constructor(capacity = 4096) {
    if (!Number.isInteger(capacity) || capacity <= 0) {
      throw new RangeError("splash ring capacity must be a positive integer");
    }
    this.capacity = capacity;
    this.events = Array.from({ length: capacity }, () => null);
    this.writeSequence = 0;
    this.liveCount = 0;
  }

  push(event) {
    const slot = this.writeSequence % this.capacity;
    const sequence = this.writeSequence;
    this.writeSequence += 1;
    this.liveCount = Math.min(this.capacity, this.liveCount + 1);
    this.events[slot] = Object.freeze({
      ...structuredClone(event),
      slot,
      sequence,
    });
    return { slot, sequence };
  }

  activeEvents() {
    const firstSequence = Math.max(0, this.writeSequence - this.liveCount);
    const result = [];
    for (let sequence = firstSequence; sequence < this.writeSequence; sequence += 1) {
      const event = this.events[sequence % this.capacity];
      if (event?.sequence === sequence) result.push(event);
    }
    return result;
  }
}

export function acceptImpactReceiver({
  worldNormal,
  up = { x: 0, y: 1, z: 0 },
  visible = true,
  occluded = false,
  minimumUpDot = 0.55,
}) {
  const upDot = worldNormal.x * up.x + worldNormal.y * up.y + worldNormal.z * up.z;
  return visible && !occluded && upDot >= minimumUpDot;
}

export function createComputePrecipitationModule({
  maxInstances = 100000,
  volume = { x: 80, y: 50, z: 80 },
  family = "rain",
} = {}) {
  const storagePlan = createPrecipitationStoragePlan({ maxInstances, family });
  return {
    imports: {
      fromWebGPU: "from \"three/webgpu\"",
      fromTSL: "from \"three/tsl\"",
    },
    storagePlan,
    volume,
    compute: "Fn(() => { const i = instanceIndex; /* wrap position/life */ })().compute(maxInstances)",
    dispatchApi: "renderer.compute(updatePrecipitation); computeAsync is not a GPU-completion fence in r185",
    noCpuInstanceMatrixLoop: true,
    renderPath:
      family === "rain"
        ? "SpriteNodeMaterial rain streaks"
        : "SpriteNodeMaterial soft snow flakes",
  };
}

export function createImpactSplashStoragePlan({
  maxImpacts = 4096,
  atlasColumns = 4,
  atlasRows = 5,
} = {}) {
  const bytesPerVec4 = 16;
  return {
    splashEventState: "GPU-owned splash impact storage",
    impactPosition: { bytes: maxImpacts * bytesPerVec4, storage: true },
    normalTangentFrame: { bytes: maxImpacts * bytesPerVec4 * 2, storage: true },
    progressLifetime: { bytes: maxImpacts * bytesPerVec4, progress: true, lifetime: true },
    atlasTileOpacity: { bytes: maxImpacts * bytesPerVec4, atlas: `${atlasColumns}x${atlasRows}`, opacity: true },
    atomicCounter: { bytes: 4, atomic: "enabled only when event density requires compaction" },
    totalBytes: maxImpacts * bytesPerVec4 * 5 + 4,
  };
}

export function selectRippleTier({
  qualityTier = "medium",
  weather = DEFAULT_WEATHER_ENVELOPE,
} = {}) {
  if (qualityTier === "high") {
    return {
      rippleTier: "dynamic",
      source: "dynamic TSL/compute ripples tied to weather.progress",
      weatherProgress: weather.progress,
    };
  }
  return {
    rippleTier: "generated",
    weatherProgress: weather.progress,
    colorSpace: "NoColorSpace",
    variants: [
      "assets/generated-variants/ripple-normal-a.png",
      "assets/generated-variants/ripple-normal-b.png",
      "assets/generated-variants/ripple-normal-c.png",
    ],
  };
}

export function createSurfaceMaterialContracts() {
  const materialNames = {
    wet: MeshPhysicalNodeMaterial.name,
    snow: MeshStandardNodeMaterial.name,
    precipitation: SpriteNodeMaterial.name,
  };
  return {
    materialNames,
    colorTextureSpace: SRGBColorSpace,
    dataTextureSpace: "NoColorSpace",
    wetSurfaceSlots: {
      colorNode: "wet asphalt albedo response",
      roughnessNode: "porosity/wetness response; roughness before ripple normals",
      normalNode: "static normal + ripple normal tier",
      opacityNode: "decal or puddle mask opacity",
      positionNode: "optional snow displacement",
    },
    snowSurfaceSlots: {
      colorNode: "cool snow albedo inside upward-normal mask",
      roughnessNode: "settled snow roughness",
      normalNode: "same height field finite-difference normal",
      positionNode: "same height field displacement",
    },
  };
}

export function validatePrecipitationConfig({
  weather,
  particleWeather,
  surfaceWeather,
  maxInstances = 100000,
  qualityTier = "medium",
  budgetBytes = 8 * 1024 * 1024,
  volume = { x: 80, y: 50, z: 80 },
  camera = { x: 0, y: 2, z: 0 },
} = {}) {
  const errors = [];
  if (weather !== particleWeather || weather !== surfaceWeather) {
    errors.push("particles and surfaces must share the same weather object identity");
  }

  const storagePlan = createPrecipitationStoragePlan({ maxInstances });
  const bytes = estimateStorageBytes(storagePlan);
  if (bytes > budgetBytes) {
    errors.push(`storage byte count ${bytes} exceeds budget ${budgetBytes}`);
  }

  const wrapped = cameraWrapPosition({
    seed: { x: 0.95, y: 0.05, z: 0.5 },
    camera,
    volume,
    windDisplacement: weather?.windDisplacement ?? DEFAULT_WEATHER_ENVELOPE.windDisplacement,
    fallSpeed: 5,
    time: weather?.time ?? 0,
  });
  if (
    wrapped.x < camera.x - volume.x * 0.5 ||
    wrapped.x > camera.x + volume.x * 0.5 ||
    wrapped.z < camera.z - volume.z * 0.5 ||
    wrapped.z > camera.z + volume.z * 0.5
  ) {
    errors.push("camera-wrapped precipitation escaped volume bounds");
  }

  const ripple = selectRippleTier({ qualityTier, weather });
  if (ripple.rippleTier === "generated" && ripple.colorSpace !== "NoColorSpace") {
    errors.push("generated ripple normals must use NoColorSpace");
  }
  if (storagePlan.dynamicMirroredToCpu !== false) {
    errors.push("dynamic buffers must not be mirrored back to CPU");
  }

  return {
    ok: errors.length === 0,
    errors,
    storagePlan,
    bytes,
    wrapped,
    ripple,
  };
}

export function createWebGPURainSnowWetSurfaceSystem({
  renderer,
  weather = createWeatherEnvelope(),
  maxInstances = 100000,
  qualityTier = "medium",
} = {}) {
  const tier = requireWeatherTier(qualityTier);
  return {
    renderer: renderer?.constructor?.name ?? WebGPURenderer.name,
    pipeline: RenderPipeline.name,
    weather,
    precipitation: createComputePrecipitationModule({ maxInstances }),
    impacts: createImpactSplashStoragePlan(),
    tier,
    ripple: selectRippleTier({ qualityTier, weather }),
    materials: createSurfaceMaterialContracts(),
    debugViews: RAIN_SNOW_DEBUG_VIEWS,
    update(deltaTime, targetProgress) {
      return updateWeatherEnvelope(weather, { deltaTime, targetProgress });
    },
  };
}

function positiveModulo(value, modulus) {
  return ((value % modulus) + modulus) % modulus;
}

function smoothstep(edge0, edge1, value) {
  const t = Math.min(1, Math.max(0, (value - edge0) / (edge1 - edge0)));
  return t * t * (3 - 2 * t);
}
