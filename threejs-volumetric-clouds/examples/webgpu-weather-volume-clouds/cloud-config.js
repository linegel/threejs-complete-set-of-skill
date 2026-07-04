export const CLOUD_ASSET_MANIFEST_RELATIVE_PATH =
  "../../assets/weather-volume-clouds/manifest.json";

export const EXPECTED_ASSET_CONTRACT = Object.freeze({
  "local-weather": { width: 512, height: 512, channels: "rgba8" },
  turbulence: { width: 128, height: 128, channels: "rgba8" },
  shape: { width: 128, height: 128, depth: 128, channels: "r8" },
  "shape-detail": { width: 32, height: 32, depth: 32, channels: "r8" },
  stbn: { width: 128, height: 128, depth: 64, channels: "r8" },
  "weather-map-a": { width: 512, height: 512, channels: "rgba8" },
  "weather-map-b": { width: 512, height: 512, channels: "rgba8" },
  "weather-map-c": { width: 512, height: 512, channels: "rgba8" },
});

/**
 * @typedef {object} CloudLayer
 * @property {"r"|"g"|"b"|"a"} weatherChannel
 * @property {number} baseAltitudeMeters
 * @property {number} heightMeters
 * @property {number} weatherExponent
 * @property {number} coverageFilterWidth
 * @property {number} shapeAlteringBias
 * @property {number} densityScale
 * @property {number} shapeAmount
 * @property {number} detailAmount
 * @property {boolean} castsCloudShadow
 * @property {{ exponentialTerm: number, exponent: number, linearTerm: number, constantTerm: number }} densityProfile
 * @property {{ x: number, y: number }} weatherWindMetersPerSecond
 * @property {{ x: number, y: number, z: number }} shapeWindMetersPerSecond
 * @property {{ x: number, y: number, z: number }} detailWindMetersPerSecond
 * @property {{ x: number, y: number }} turbulenceWindMetersPerSecond
 */

/**
 * @typedef {object} CloudQualityTier
 * @property {"ultra"|"high"|"default"|"reduced"} name
 * @property {number} linearResolutionScale
 * @property {number} primarySteps
 * @property {number} lightSteps
 * @property {number} temporalFrames
 * @property {boolean} detail
 * @property {boolean} turbulence
 * @property {boolean} groundBounce
 * @property {number} multiScatteringOctaves
 */

/**
 * @typedef {object} TemporalSettings
 * @property {number} temporalAlpha
 * @property {number} depthRejectMeters
 * @property {number} velocityRejectPixels
 * @property {number} varianceClipSigma
 * @property {string} representativeDepthTarget
 * @property {string} velocityTarget
 * @property {string[]} resetCauses
 */

/**
 * @typedef {object} CloudShadowSettings
 * @property {number} cascadeCount
 * @property {number} resolution
 * @property {number} shadowUpdateCadence
 * @property {number} maxSamples
 * @property {string[]} channelLayout
 */

export const DEFAULT_CLOUD_LAYERS = Object.freeze([
  {
    name: "low",
    weatherChannel: "r",
    baseAltitudeMeters: 750,
    heightMeters: 650,
    weatherExponent: 1,
    coverageFilterWidth: 0.6,
    shapeAlteringBias: 1,
    densityScale: 0.2,
    shapeAmount: 1,
    detailAmount: 1,
    castsCloudShadow: true,
    densityProfile: {
      exponentialTerm: 0,
      exponent: 0,
      linearTerm: 0.75,
      constantTerm: 0.25,
    },
    weatherWindMetersPerSecond: { x: 12, y: 2 },
    shapeWindMetersPerSecond: { x: 8, y: 0, z: 1 },
    detailWindMetersPerSecond: { x: 18, y: 2, z: 0 },
    turbulenceWindMetersPerSecond: { x: 6, y: -1 },
  },
  {
    name: "middle",
    weatherChannel: "g",
    baseAltitudeMeters: 1000,
    heightMeters: 1200,
    weatherExponent: 1,
    coverageFilterWidth: 0.6,
    shapeAlteringBias: 1,
    densityScale: 0.2,
    shapeAmount: 1,
    detailAmount: 1,
    castsCloudShadow: true,
    densityProfile: {
      exponentialTerm: 0,
      exponent: 0,
      linearTerm: 0.75,
      constantTerm: 0.25,
    },
    weatherWindMetersPerSecond: { x: 9, y: -1 },
    shapeWindMetersPerSecond: { x: 6, y: 1, z: 0 },
    detailWindMetersPerSecond: { x: 12, y: -3, z: 1 },
    turbulenceWindMetersPerSecond: { x: 4, y: 2 },
  },
  {
    name: "high",
    weatherChannel: "b",
    baseAltitudeMeters: 7500,
    heightMeters: 500,
    weatherExponent: 1.35,
    coverageFilterWidth: 0.5,
    shapeAlteringBias: 1.8,
    densityScale: 0.003,
    shapeAmount: 0.4,
    detailAmount: 0,
    castsCloudShadow: false,
    densityProfile: {
      exponentialTerm: 0,
      exponent: 0,
      linearTerm: 0.4,
      constantTerm: 0.6,
    },
    weatherWindMetersPerSecond: { x: 38, y: 4 },
    shapeWindMetersPerSecond: { x: 21, y: 0, z: 0 },
    detailWindMetersPerSecond: { x: 0, y: 0, z: 0 },
    turbulenceWindMetersPerSecond: { x: 0, y: 0 },
  },
]);

export const CLOUD_QUALITY_TIERS = Object.freeze({
  ultra: {
    name: "ultra",
    linearResolutionScale: 0.5,
    primarySteps: 160,
    lightSteps: 8,
    temporalFrames: 4,
    detail: true,
    turbulence: true,
    groundBounce: true,
    multiScatteringOctaves: 8,
  },
  high: {
    name: "high",
    linearResolutionScale: 0.5,
    primarySteps: 96,
    lightSteps: 6,
    temporalFrames: 4,
    detail: true,
    turbulence: true,
    groundBounce: true,
    multiScatteringOctaves: 6,
  },
  default: {
    name: "default",
    linearResolutionScale: 0.25,
    primarySteps: 64,
    lightSteps: 4,
    temporalFrames: 16,
    detail: true,
    turbulence: true,
    groundBounce: false,
    multiScatteringOctaves: 4,
  },
  reduced: {
    name: "reduced",
    linearResolutionScale: 0.25,
    primarySteps: 32,
    lightSteps: 2,
    temporalFrames: 16,
    detail: false,
    turbulence: false,
    groundBounce: false,
    multiScatteringOctaves: 2,
  },
});

export const DEFAULT_TEMPORAL_SETTINGS = Object.freeze({
  temporalAlpha: 0.12,
  depthRejectMeters: 120,
  velocityRejectPixels: 48,
  varianceClipSigma: 1.5,
  representativeDepthTarget: "cloudRepresentativeDepthMeters",
  velocityTarget: "cloudVelocityPixels",
  resetCauses: [
    "camera-cut",
    "resolution-or-scale-change",
    "weather-discontinuity",
    "layer-topology-change",
    "projection-mode-change",
  ],
});

export const DEFAULT_CLOUD_SHADOW_SETTINGS = Object.freeze({
  cascadeCount: 2,
  resolution: 384,
  shadowUpdateCadence: 4,
  maxSamples: 40,
  minTransmittance: 0.0001,
  channelLayout: [
    "frontDepth",
    "meanExtinction",
    "maxOpticalDepth",
    "tailEstimate",
  ],
});

export function cloneCloudLayer(layer) {
  return structuredClone(layer);
}

export function packCloudLayerIntervals(layers = DEFAULT_CLOUD_LAYERS) {
  const ranges = layers
    .filter((layer) => layer.heightMeters > 0)
    .map((layer) => [
      layer.baseAltitudeMeters,
      layer.baseAltitudeMeters + layer.heightMeters,
    ])
    .sort((a, b) => a[0] - b[0]);

  const occupiedBands = [];

  for (const range of ranges) {
    const [start, end] = range;
    if (end <= start) {
      continue;
    }

    const last = occupiedBands[occupiedBands.length - 1];
    if (!last || start > last[1]) {
      occupiedBands.push([start, end]);
    } else {
      last[1] = Math.max(last[1], end);
    }
  }

  const packedGaps = [];
  for (let index = 1; index < occupiedBands.length; index += 1) {
    const previous = occupiedBands[index - 1];
    const next = occupiedBands[index];
    if (next[0] > previous[1]) {
      packedGaps.push([previous[1], next[0]]);
    }
  }

  return {
    occupiedBands,
    packedGaps: packedGaps.slice(0, 3),
    minAltitudeMeters: occupiedBands[0]?.[0] ?? 0,
    maxAltitudeMeters: occupiedBands[occupiedBands.length - 1]?.[1] ?? 0,
  };
}

export function createDefaultCloudConfig(overrides = {}) {
  const layers = overrides.layers
    ? overrides.layers.map(cloneCloudLayer)
    : DEFAULT_CLOUD_LAYERS.map(cloneCloudLayer);
  const intervalContract =
    overrides.intervalContract ?? packCloudLayerIntervals(layers);

  return {
    layers,
    qualityTier: "default",
    qualityTiers: structuredClone(CLOUD_QUALITY_TIERS),
    temporal: structuredClone(DEFAULT_TEMPORAL_SETTINGS),
    cloudShadow: structuredClone(DEFAULT_CLOUD_SHADOW_SETTINGS),
    storageBudgetMB: 96,
    referenceViewport: { width: 1920, height: 1080 },
    fieldAssets: Object.keys(EXPECTED_ASSET_CONTRACT),
    intervalContract,
    ...overrides,
  };
}

export function computeCloudTargetSize(
  viewport,
  tier = CLOUD_QUALITY_TIERS.default,
) {
  const scale = tier.linearResolutionScale;
  return {
    width: Math.max(1, Math.ceil(viewport.width * scale)),
    height: Math.max(1, Math.ceil(viewport.height * scale)),
    scale,
  };
}

export function estimateCloudStorageBytes(
  config = createDefaultCloudConfig(),
  viewport = config.referenceViewport,
) {
  const tier = config.qualityTiers[config.qualityTier];
  const low = computeCloudTargetSize(viewport, tier);
  const rgba16fBytes = 8;
  const rg16fBytes = 4;
  const r16Bytes = 2;
  const lowPixels = low.width * low.height;
  const shadow = config.cloudShadow;

  const currentRadiance = lowPixels * rgba16fBytes;
  const historyRadiance = lowPixels * rgba16fBytes * 2;
  const representativeDepthVelocity = lowPixels * rg16fBytes * 2;
  const rejectionMask = lowPixels * r16Bytes;
  const shadowCascades =
    shadow.cascadeCount * shadow.resolution * shadow.resolution * rgba16fBytes;

  return {
    bytes:
      currentRadiance +
      historyRadiance +
      representativeDepthVelocity +
      rejectionMask +
      shadowCascades,
    lowResolution: low,
    parts: {
      currentRadiance,
      historyRadiance,
      representativeDepthVelocity,
      rejectionMask,
      shadowCascades,
    },
  };
}

function sameIntervals(a, b) {
  if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) {
    return false;
  }
  return a.every(
    (range, index) =>
      Array.isArray(range) &&
      Array.isArray(b[index]) &&
      Math.abs(range[0] - b[index][0]) < 1e-6 &&
      Math.abs(range[1] - b[index][1]) < 1e-6,
  );
}

function validateAssetManifest(manifest, errors) {
  if (!manifest || !Array.isArray(manifest.assets)) {
    errors.push("asset manifest is missing an assets array");
    return;
  }

  const assets = new Map(manifest.assets.map((asset) => [asset.id, asset]));
  for (const [id, expected] of Object.entries(EXPECTED_ASSET_CONTRACT)) {
    const asset = assets.get(id);
    if (!asset) {
      errors.push(`asset manifest is missing ${id}`);
      continue;
    }

    for (const key of ["width", "height", "depth", "channels"]) {
      if (expected[key] !== undefined && asset[key] !== expected[key]) {
        errors.push(
          `${id} ${key} expected ${expected[key]} but got ${asset[key]}`,
        );
      }
    }

    if (asset.colorSpace !== "NoColorSpace") {
      errors.push(`${id} must use NoColorSpace/linear data sampling`);
    }

    if (!asset.sha256 || !asset.byteLength) {
      errors.push(`${id} must pin byteLength and sha256`);
    }
  }
}

export function validateCloudConfig(config, manifest) {
  const errors = [];
  const warnings = [];

  if (!Array.isArray(config.layers) || config.layers.length === 0) {
    errors.push("at least one cloud layer is required");
  }

  for (const layer of config.layers ?? []) {
    if (layer.heightMeters <= 0) {
      errors.push(`${layer.name ?? layer.weatherChannel} has no height`);
    }
    if (layer.baseAltitudeMeters < 0) {
      errors.push(`${layer.name ?? layer.weatherChannel} has negative altitude`);
    }
    if (!layer.densityProfile) {
      errors.push(`${layer.name ?? layer.weatherChannel} lacks densityProfile`);
    }
    if (!layer.weatherWindMetersPerSecond || !layer.shapeWindMetersPerSecond) {
      errors.push(`${layer.name ?? layer.weatherChannel} lacks field winds`);
    }
  }

  const intervals = packCloudLayerIntervals(config.layers);
  if (
    config.intervalContract &&
    !sameIntervals(config.intervalContract.packedGaps, intervals.packedGaps)
  ) {
    errors.push(
      "packed interval contract must contain empty gaps, not occupied bands",
    );
  }

  const tier = config.qualityTiers?.[config.qualityTier];
  if (!tier) {
    errors.push(`unknown quality tier ${config.qualityTier}`);
  } else if (tier.linearResolutionScale > 0.5 || tier.linearResolutionScale <= 0) {
    errors.push(`${tier.name} has invalid linearResolutionScale`);
  }

  if (!config.temporal?.representativeDepthTarget) {
    errors.push("temporal reconstruction requires representativeDepth target");
  }
  if (!config.temporal?.velocityTarget) {
    errors.push("temporal reconstruction requires velocity target");
  }
  if (!config.temporal?.resetCauses?.includes("camera-cut")) {
    errors.push("temporal reconstruction must define camera-cut reset");
  }

  const requiredShadowChannels = DEFAULT_CLOUD_SHADOW_SETTINGS.channelLayout;
  if (
    !sameStringSet(config.cloudShadow?.channelLayout, requiredShadowChannels)
  ) {
    errors.push(
      "cloud shadow channelLayout must be frontDepth/meanExtinction/maxOpticalDepth/tailEstimate",
    );
  }
  if (config.cloudShadow?.cascadeCount < 1 || config.cloudShadow?.resolution < 128) {
    errors.push("cloud shadow cascade layout is too small to be meaningful");
  }
  if (config.cloudShadow?.cascadeCount > 4 || config.cloudShadow?.resolution > 1024) {
    errors.push("cloud shadow cascade layout exceeds Phase 1 bounds");
  }

  if (manifest) {
    validateAssetManifest(manifest, errors);
  } else {
    warnings.push("asset manifest not supplied; only config shape was checked");
  }

  const storage = estimateCloudStorageBytes(config);
  const budgetBytes = config.storageBudgetMB * 1024 * 1024;
  if (storage.bytes > budgetBytes) {
    errors.push(
      `cloud storage ${storage.bytes} bytes exceeds budget ${budgetBytes} bytes`,
    );
  }

  return {
    ok: errors.length === 0,
    errors,
    warnings,
    intervals,
    storage,
  };
}

function sameStringSet(a, b) {
  if (!Array.isArray(a) || a.length !== b.length) {
    return false;
  }
  const left = [...a].sort();
  const right = [...b].sort();
  return left.every((value, index) => value === right[index]);
}
