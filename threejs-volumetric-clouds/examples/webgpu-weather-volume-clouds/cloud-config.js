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
 * @property {number} densityAmplitude
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
 * @property {number} responseTimeSeconds
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
    densityAmplitude: 0.2,
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
    densityAmplitude: 0.2,
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
    densityAmplitude: 0.003,
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
  mobile: {
    name: "mobile",
    linearResolutionScale: 0.25,
    primarySteps: 32,
    lightSteps: 2,
    temporalFrames: 16,
    detail: false,
    turbulence: false,
    groundBounce: false,
    multiScatteringOctaves: 2,
  },
  // Compatibility alias. Public canonical routes use "mobile".
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

export const CLOUD_TIER_BUDGETS = Object.freeze({
  ultra: {
    linearResolutionScale: [0.5, 0.5],
    primarySteps: [96, 160],
    lightSteps: [6, 8],
  },
  high: {
    linearResolutionScale: [0.5, 0.5],
    primarySteps: [72, 120],
    lightSteps: [4, 6],
  },
  default: {
    linearResolutionScale: [0.25, 0.25],
    primarySteps: [48, 80],
    lightSteps: [3, 4],
  },
  mobile: {
    linearResolutionScale: [0.25, 0.25],
    primarySteps: [24, 32],
    lightSteps: [1, 2],
  },
  reduced: {
    linearResolutionScale: [0.125, 0.25],
    primarySteps: [24, 48],
    lightSteps: [1, 2],
  },
});

export const DEFAULT_TEMPORAL_SETTINGS = Object.freeze({
  responseTimeSeconds: 0.13,
  depthRejectMeters: 120,
  velocityRejectPixels: 48,
  varianceClipSigma: 1.5,
  representativeDepthTarget: "cloudRepresentativeDepthMetersR32F",
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
  depthRangeMeters: 8000,
  betaExtinctionPerMeter: 0.001,
  receiverDomain: "opaque-or-ground-after-full-column",
  format: "R16F",
  channelLayout: ["opticalDepth"],
});

export const CLOUD_SHADOW_TIER_SETTINGS = Object.freeze({
  ultra: Object.freeze({ cascadeCount: 3, resolution: 1024, maxSamples: 64 }),
  high: Object.freeze({ cascadeCount: 3, resolution: 512, maxSamples: 48 }),
  default: Object.freeze({ cascadeCount: 2, resolution: 384, maxSamples: 32 }),
  mobile: Object.freeze({ cascadeCount: 1, resolution: 256, maxSamples: 16 }),
  reduced: Object.freeze({ cascadeCount: 1, resolution: 256, maxSamples: 16 }),
});

export const DEFAULT_CLOUD_OPTICS = Object.freeze({
  betaScatteringPerMeter: 0.0008,
  betaAbsorptionPerMeter: 0.0002,
  phaseConvention: "solid-angle-normalized",
  sourceUnits: "linear-radiance-per-meter",
});

const CURRENT_AND_HISTORY_SLOTS = Object.freeze([
  "current",
  "history-read",
  "history-write",
]);

export const CLOUD_STORAGE_RESOURCE_LAYOUT = Object.freeze({
  lowResolution: Object.freeze({
    currentRadiance: Object.freeze({
      format: "RGBA16F",
      bytesPerTexel: 8,
      slots: Object.freeze(["current"]),
      updateCadenceFrames: 1,
    }),
    historyRadiance: Object.freeze({
      format: "RGBA16F",
      bytesPerTexel: 8,
      slots: Object.freeze(["history-read", "history-write"]),
      updateCadenceFrames: 1,
    }),
    representativeDepthCurrentAndHistory: Object.freeze({
      format: "R32F",
      bytesPerTexel: 4,
      slots: CURRENT_AND_HISTORY_SLOTS,
      updateCadenceFrames: 1,
    }),
    velocityCurrentAndHistory: Object.freeze({
      format: "RG16F",
      bytesPerTexel: 4,
      slots: CURRENT_AND_HISTORY_SLOTS,
      updateCadenceFrames: 1,
    }),
    depthMomentsCurrentAndHistory: Object.freeze({
      format: "RG16F",
      bytesPerTexel: 4,
      slots: CURRENT_AND_HISTORY_SLOTS,
      updateCadenceFrames: 1,
    }),
    rejectionMask: Object.freeze({
      format: "RGBA16F",
      bytesPerTexel: 8,
      slots: Object.freeze(["current"]),
      updateCadenceFrames: 1,
    }),
  }),
  shadowCascades: Object.freeze({
    format: "R16F",
    bytesPerTexel: 2,
    slotsFrom: "cascadeCount",
    updateCadenceFrom: "shadowUpdateCadence",
  }),
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
  const qualityTier = overrides.qualityTier ?? "default";
  const shadowTier = CLOUD_SHADOW_TIER_SETTINGS[qualityTier];
  const cloudShadow = {
    ...structuredClone(DEFAULT_CLOUD_SHADOW_SETTINGS),
    ...shadowTier,
    ...(overrides.cloudShadow ?? {}),
  };

  return {
    layers,
    qualityTier,
    qualityTiers: structuredClone(CLOUD_QUALITY_TIERS),
    temporal: structuredClone(DEFAULT_TEMPORAL_SETTINGS),
    cloudShadow,
    optics: structuredClone(DEFAULT_CLOUD_OPTICS),
    storageBudgetMB: 96,
    referenceViewport: { width: 1920, height: 1080 },
    fieldAssets: Object.keys(EXPECTED_ASSET_CONTRACT),
    intervalContract,
    worldUnitsPerMeter: 1,
    domain: {
      type: "spherical-shell",
      center: [0, -6360000, 0],
      planetRadiusMeters: 6360000,
      innerRadiusMeters: 6360750,
      outerRadiusMeters: 6368000,
    },
    camera: {
      positionMeters: [0, 200, 18000],
      forward: [0, 0.12, -0.9927738917],
      right: [1, 0, 0],
      up: [0, 0.9927738917, 0.12],
      verticalFovRadians: Math.PI / 3,
      nearMeters: 0.1,
      farMeters: 200000,
    },
    ...overrides,
    qualityTier,
    cloudShadow,
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
  const lowPixels = low.width * low.height;
  const shadow = config.cloudShadow;
  const lowResolutionParts = Object.fromEntries(
    Object.entries(CLOUD_STORAGE_RESOURCE_LAYOUT.lowResolution).map(
      ([name, resource]) => [
        name,
        lowPixels * resource.bytesPerTexel * resource.slots.length,
      ],
    ),
  );
  const {
    currentRadiance,
    historyRadiance,
    representativeDepthCurrentAndHistory,
    velocityCurrentAndHistory,
    depthMomentsCurrentAndHistory,
    rejectionMask,
  } = lowResolutionParts;
  const depthMotionCurrentAndHistory =
    representativeDepthCurrentAndHistory +
    velocityCurrentAndHistory +
    depthMomentsCurrentAndHistory;
  const shadowLayout = CLOUD_STORAGE_RESOURCE_LAYOUT.shadowCascades;
  const shadowCascades =
    shadow[shadowLayout.slotsFrom] *
    shadow.resolution *
    shadow.resolution *
    shadowLayout.bytesPerTexel;

  return {
    bytes:
      currentRadiance +
      historyRadiance +
      depthMotionCurrentAndHistory +
      rejectionMask +
      shadowCascades,
    lowResolution: low,
    resourceLayout: CLOUD_STORAGE_RESOURCE_LAYOUT,
    parts: {
      currentRadiance,
      historyRadiance,
      depthMotionCurrentAndHistory,
      representativeDepthCurrentAndHistory,
      velocityCurrentAndHistory,
      depthMomentsCurrentAndHistory,
      rejectionMask,
      shadowCascades,
    },
  };
}

export function estimateTierMarchWork(
  tier,
  viewport = { width: 1920, height: 1080 },
) {
  const low = computeCloudTargetSize(viewport, tier);
  return {
    lowResolution: low,
    pixels: low.width * low.height,
    primaryLightProduct: low.width * low.height * tier.primarySteps * tier.lightSteps,
  };
}

export function validateQualityTierBudgets(
  qualityTiers = CLOUD_QUALITY_TIERS,
  viewport = { width: 1920, height: 1080 },
) {
  const errors = [];
  const products = {};

  for (const [name, tier] of Object.entries(qualityTiers)) {
    const budget = CLOUD_TIER_BUDGETS[name];
    if (!budget) {
      errors.push(`unknown tier budget ${name}`);
      continue;
    }

    const checks = [
      ["linearResolutionScale", tier.linearResolutionScale],
      ["primarySteps", tier.primarySteps],
      ["lightSteps", tier.lightSteps],
    ];

    for (const [field, value] of checks) {
      const [minimum, maximum] = budget[field];
      if (value < minimum || value > maximum) {
        errors.push(
          `${name} ${field} ${value} outside tier table ${minimum}-${maximum}`,
        );
      }
    }

    const work = estimateTierMarchWork(tier, viewport);
    const maximumTier = {
      ...tier,
      linearResolutionScale: budget.linearResolutionScale[1],
      primarySteps: budget.primarySteps[1],
      lightSteps: budget.lightSteps[1],
    };
    const maximumWork = estimateTierMarchWork(maximumTier, viewport);
    products[name] = {
      configured: work.primaryLightProduct,
      maximum: maximumWork.primaryLightProduct,
      lowResolution: work.lowResolution,
    };

    if (work.primaryLightProduct > maximumWork.primaryLightProduct) {
      errors.push(
        `${name} march work ${work.primaryLightProduct} exceeds tier table product ${maximumWork.primaryLightProduct}`,
      );
    }
  }

  return { ok: errors.length === 0, errors, products };
}

export function getCloudQualityTier(config) {
  const tier = config.qualityTiers?.[config.qualityTier];
  if (!tier) {
    throw new Error(`unknown quality tier ${config.qualityTier}`);
  }
  return tier;
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

  if (!(config.worldUnitsPerMeter > 0)) {
    errors.push("worldUnitsPerMeter must be positive");
  }
  const supportedDomains = new Set(["spherical-shell", "planar-slab", "obb"]);
  if (!supportedDomains.has(config.domain?.type)) {
    errors.push(`unsupported cloud domain ${config.domain?.type}`);
  }
  if (
    config.domain?.type === "spherical-shell" &&
    !(
      config.domain.innerRadiusMeters > 0 &&
      config.domain.outerRadiusMeters > config.domain.innerRadiusMeters &&
      config.domain.planetRadiusMeters <= config.domain.innerRadiusMeters
    )
  ) {
    errors.push("spherical cloud domain requires ordered planet/inner/outer radii");
  }
  for (const key of ["positionMeters", "forward", "right", "up"]) {
    if (!Array.isArray(config.camera?.[key]) || config.camera[key].length !== 3 ||
        !config.camera[key].every(Number.isFinite)) {
      errors.push(`camera.${key} must be a finite three-component vector`);
    }
  }
  if (!(config.camera?.verticalFovRadians > 0 && config.camera.verticalFovRadians < Math.PI)) {
    errors.push("camera.verticalFovRadians must be in (0, pi)");
  }
  if (!(config.camera?.nearMeters > 0 && config.camera?.farMeters > config.camera.nearMeters)) {
    errors.push("camera nearMeters/farMeters must be positive and ordered");
  }
  const cameraBasis = [config.camera?.forward, config.camera?.right, config.camera?.up];
  if (cameraBasis.every((axis) => Array.isArray(axis) && axis.length === 3 && axis.every(Number.isFinite))) {
    const dot3 = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
    for (const [index, axis] of cameraBasis.entries()) {
      if (Math.abs(dot3(axis, axis) - 1) > 1e-3) errors.push(`camera basis axis ${index} is not unit length`);
    }
    for (const [a, b] of [[0, 1], [0, 2], [1, 2]]) {
      if (Math.abs(dot3(cameraBasis[a], cameraBasis[b])) > 1e-3) errors.push(`camera basis axes ${a}/${b} are not orthogonal`);
    }
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
    if (!(layer.densityAmplitude >= 0)) {
      errors.push(`${layer.name ?? layer.weatherChannel} has invalid densityAmplitude`);
    }
    if (!(layer.weatherExponent > 0) || !(layer.coverageFilterWidth > 0)) {
      errors.push(`${layer.name ?? layer.weatherChannel} has invalid weather shaping controls`);
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
  if (!(config.temporal?.responseTimeSeconds > 0)) {
    errors.push("temporal reconstruction requires positive responseTimeSeconds");
  }

  const betaScattering = config.optics?.betaScatteringPerMeter;
  const betaAbsorption = config.optics?.betaAbsorptionPerMeter;
  if (!(betaScattering >= 0) || !(betaAbsorption >= 0) || betaScattering + betaAbsorption <= 0) {
    errors.push("cloud optics require nonnegative inverse-meter scattering/absorption coefficients");
  }
  if (config.optics?.phaseConvention !== "solid-angle-normalized") {
    errors.push("cloud optics phaseConvention must be solid-angle-normalized");
  }

  const tierBudget = validateQualityTierBudgets(
    config.qualityTiers,
    config.referenceViewport,
  );
  errors.push(...tierBudget.errors);

  const requiredShadowChannels = DEFAULT_CLOUD_SHADOW_SETTINGS.channelLayout;
  if (
    !sameStringSet(config.cloudShadow?.channelLayout, requiredShadowChannels)
  ) {
    errors.push(
      "cloud shadow channelLayout must contain only opticalDepth",
    );
  }
  if (config.cloudShadow?.cascadeCount < 1 || config.cloudShadow?.resolution < 128) {
    errors.push("cloud shadow cascade layout is too small to be meaningful");
  }
  if (config.cloudShadow?.cascadeCount > 4 || config.cloudShadow?.resolution > 1024) {
    errors.push("cloud shadow cascade layout exceeds Phase 1 bounds");
  }
  if (
    config.cloudShadow?.format !== "R16F" ||
    config.cloudShadow?.receiverDomain !== "opaque-or-ground-after-full-column"
  ) {
    errors.push("cloud shadow scaffold must be an R16F full-column product for opaque/ground receivers");
  }
  if (
    !(config.cloudShadow?.depthRangeMeters > 0) ||
    !(config.cloudShadow?.betaExtinctionPerMeter > 0)
  ) {
    errors.push("cloud shadow optical depth requires positive length and inverse-meter extinction scales");
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
    tierBudget,
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
