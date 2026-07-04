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
  wind: { x: 1.2, y: 0, z: 0.5 },
  progress: 0,
  precipitationRate: 1,
  qualityTier: "medium",
  debugMode: "final",
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
  };
}

export function updateWeatherEnvelope(weather, { deltaTime, targetProgress }) {
  const dt = clampDeltaTime(deltaTime);
  weather.deltaTime = dt;
  weather.time += dt;
  const damping = 1 - Math.exp(-0.9 * dt);
  weather.progress += (targetProgress - weather.progress) * damping;
  return weather;
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
  wind,
  fallSpeed,
  time,
}) {
  const origin = {
    x: camera.x - volume.x * 0.5,
    y: camera.y - volume.y * 0.4,
    z: camera.z - volume.z * 0.5,
  };
  const base = {
    x: seed.x * volume.x,
    y: seed.y * volume.y,
    z: seed.z * volume.z,
  };
  const displaced = {
    x: base.x + wind.x * time - origin.x,
    y: base.y - fallSpeed * time - origin.y,
    z: base.z + wind.z * time - origin.z,
  };
  return {
    x: positiveModulo(displaced.x, volume.x) + origin.x,
    y: positiveModulo(displaced.y, volume.y) + origin.y,
    z: positiveModulo(displaced.z, volume.z) + origin.z,
  };
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
    dispatchApi: "renderer.compute(updatePrecipitation) or renderer.computeAsync(updatePrecipitation)",
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
    wind: weather?.wind ?? DEFAULT_WEATHER_ENVELOPE.wind,
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
  return {
    renderer: renderer?.constructor?.name ?? WebGPURenderer.name,
    pipeline: RenderPipeline.name,
    weather,
    precipitation: createComputePrecipitationModule({ maxInstances }),
    impacts: createImpactSplashStoragePlan(),
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
