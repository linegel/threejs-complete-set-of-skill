export const LUT_MANIFEST_RELATIVE_PATH =
  "../../assets/lut-aerial-perspective/manifest.json";

export const DEFAULT_ATMOSPHERE_MODEL = Object.freeze({
  name: "earth-shared-atmosphere",
  radiiMeters: {
    bottom: 6360000,
    top: 6420000,
  },
  renderUnitsPerMeter: 1,
  solarIrradiance: [1.474, 1.8504, 1.91198],
  sunAngularRadius: 0.004675,
  rayleighScatteringPerKm: [0.005802, 0.013558, 0.0331],
  mieScatteringPerKm: [0.003996, 0.003996, 0.003996],
  mieExtinctionPerKm: [0.00444, 0.00444, 0.00444],
  miePhaseG: 0.8,
  absorptionExtinctionPerKm: [0.00065, 0.001881, 0.000085],
  groundAlbedo: 0.1,
  densityProfiles: {
    rayleighDensity: [
      {
        widthMeters: 60000,
        expTerm: 1,
        expScalePerKm: -0.125,
        linearTermPerKm: 0,
        constantTerm: 0,
      },
    ],
    mieDensity: [
      {
        widthMeters: 60000,
        expTerm: 1,
        expScalePerKm: -0.833333,
        linearTermPerKm: 0,
        constantTerm: 0,
      },
    ],
    absorptionDensity: [
      {
        widthMeters: 25000,
        expTerm: 0,
        expScalePerKm: 0,
        linearTermPerKm: 0.0666667,
        constantTerm: -0.666667,
      },
      {
        widthMeters: 0,
        expTerm: 0,
        expScalePerKm: 0,
        linearTermPerKm: -0.0666667,
        constantTerm: 2.666667,
      },
    ],
  },
  generatorMetadata: {
    source: "jeantimex/geospatial",
    revision: "d166316ad38f9a21f6d7a3293b808bc7f920283e",
    lutUnits: "kilometers",
    radianceUnits: "scene-linear HDR",
  },
  materialIrradiance: {
    enabled: false,
    reason:
      "The imported irradiance LUT is validated and uploaded, but PBR material relighting is disabled until a host lighting integration owns the sky-light signal.",
  },
});

export const UNIT_CONVERSION_FIXTURES = Object.freeze([
  {
    name: "1 world unit = 1 meter",
    renderUnitsPerMeter: 1,
    worldDistance: 1,
    atmosphereMeters: 1,
  },
  {
    name: "1 world unit = 1 kilometer",
    renderUnitsPerMeter: 0.001,
    worldDistance: 1,
    atmosphereMeters: 1000,
  },
]);

export const QUALITY_TIERS = Object.freeze({
  ultra: {
    label: "Ultra desktop-discrete",
    transmittance: { width: 256, height: 64 },
    multiscatter: { width: 64, height: 32 },
    irradiance: { width: 64, height: 32 },
    skyView: { width: 192, height: 108 },
    aerialFroxel: { width: 320, height: 180, depth: 48 },
    budgetMs: [0.4, 1.2],
    memoryBudgetBytes: 24 * 1024 * 1024,
    cadence: "sky-view and aerial froxel update on sun/camera-frame invalidation",
  },
  high: {
    label: "High desktop/integrated",
    transmittance: { width: 256, height: 64 },
    multiscatter: { width: 64, height: 32 },
    irradiance: { width: 64, height: 16 },
    skyView: { width: 128, height: 64 },
    aerialFroxel: { width: 160, height: 90, depth: 32 },
    budgetMs: [0.7, 1.8],
    memoryBudgetBytes: 14 * 1024 * 1024,
    cadence: "stagger sky-view and aerial froxel updates when motion is smooth",
  },
  mobile: {
    label: "Mobile/tiled",
    transmittance: { width: 128, height: 32 },
    multiscatter: { width: 32, height: 16 },
    irradiance: { width: 32, height: 16 },
    skyView: { width: 96, height: 48 },
    aerialFroxel: { width: 96, height: 54, depth: 20 },
    budgetMs: [0.8, 2.5],
    memoryBudgetBytes: 8 * 1024 * 1024,
    cadence: "reuse base LUTs and update view products at reduced frequency",
  },
  reduced: {
    label: "Reduced backend tier",
    transmittance: { width: 256, height: 64, imported: true },
    multiscatter: { width: 32, height: 16, disabled: true },
    irradiance: { width: 64, height: 16, imported: true },
    skyView: { width: 96, height: 48, static: true },
    aerialFroxel: { width: 80, height: 45, depth: 12 },
    budgetMs: [0.3, 1.2],
    memoryBudgetBytes: 4 * 1024 * 1024,
    cadence: "load precomputed LUT assets and disable optional live material irradiance",
  },
});

const RGBA16F_BYTES_PER_PIXEL = 4 * 2;

function ceilDiv(value, divisor) {
  return Math.ceil(value / divisor);
}

function textureBytes({ width, height, depth = 1 }) {
  return width * height * depth * RGBA16F_BYTES_PER_PIXEL;
}

function dispatch2D({ width, height }, workgroup = [8, 8, 1]) {
  return [ceilDiv(width, workgroup[0]), ceilDiv(height, workgroup[1]), 1];
}

function dispatch3D({ width, height, depth }, workgroup = [8, 8, 1]) {
  return [ceilDiv(width, workgroup[0]), ceilDiv(height, workgroup[1]), depth];
}

export function createProductSchedule(tier = "high") {
  const selected = QUALITY_TIERS[tier];
  if (!selected) {
    throw new Error(`Unknown atmosphere quality tier "${tier}"`);
  }

  const products = [
    {
      id: "transmittance",
      label: "transmittance",
      kind: "StorageTexture",
      dimensions: { ...selected.transmittance, depth: 1 },
      format: "RGBA16F",
      workgroup: [8, 8, 1],
      dispatch: dispatch2D(selected.transmittance),
      invalidation: ["atmosphere profile", "unit conversion", "solar inputs"],
      cadence: "only when shared atmosphere parameters change",
    },
    {
      id: "multiscatter",
      label: "multiscatter",
      kind: "StorageTexture",
      dimensions: { ...selected.multiscatter, depth: 1 },
      format: "RGBA16F",
      workgroup: [8, 8, 1],
      dispatch: dispatch2D(selected.multiscatter),
      invalidation: ["profile", "ground albedo", "solar irradiance"],
      cadence: selected.cadence,
    },
    {
      id: "irradiance",
      label: "irradiance",
      kind: "StorageTexture",
      dimensions: { ...selected.irradiance, depth: 1 },
      format: "RGBA16F",
      workgroup: [8, 8, 1],
      dispatch: dispatch2D(selected.irradiance),
      invalidation: ["profile", "ground albedo", "sun direction"],
      cadence: "update with multiscatter or load from manifest in reduced tier",
    },
    {
      id: "sky-view",
      label: "sky-view",
      kind: "StorageTexture",
      dimensions: { ...selected.skyView, depth: 1 },
      format: "RGBA16F",
      workgroup: [8, 8, 1],
      dispatch: dispatch2D(selected.skyView),
      invalidation: ["camera altitude", "sun direction", "planet transform"],
      cadence: selected.cadence,
    },
    {
      id: "aerial-froxel",
      label: "aerial froxel",
      kind: "Storage3DTexture",
      dimensions: { ...selected.aerialFroxel },
      format: "RGBA16F",
      workgroup: [8, 8, 1],
      dispatch: dispatch3D(selected.aerialFroxel),
      invalidation: ["camera projection", "view matrix", "depth range"],
      cadence: selected.cadence,
    },
  ];

  return products.map((product) => ({
    ...product,
    byteLength: textureBytes(product.dimensions),
  }));
}

export function estimateAtmosphereMemoryBytes(tier = "high") {
  return createProductSchedule(tier).reduce(
    (total, product) => total + product.byteLength,
    0,
  );
}

export function renderUnitsToAtmosphereMeters(worldDistance, config) {
  return worldDistance / config.renderUnitsPerMeter;
}

export function atmosphereMetersToRenderUnits(meters, config) {
  return meters * config.renderUnitsPerMeter;
}

export function createAtmosphereConfig({
  tier = "high",
  renderUnitsPerMeter = DEFAULT_ATMOSPHERE_MODEL.renderUnitsPerMeter,
  model = DEFAULT_ATMOSPHERE_MODEL,
} = {}) {
  return {
    ...structuredClone(model),
    tier,
    renderUnitsPerMeter,
    products: createProductSchedule(tier),
  };
}

function finiteArray(name, values, length, errors) {
  if (!Array.isArray(values) || values.length !== length) {
    errors.push(`${name} must have ${length} channels`);
    return;
  }
  if (!values.every(Number.isFinite)) {
    errors.push(`${name} must contain finite values`);
  }
}

function validateDensityProfiles(config, errors) {
  for (const [name, layers] of Object.entries(config.densityProfiles ?? {})) {
    if (!Array.isArray(layers) || layers.length === 0) {
      errors.push(`${name} must define at least one layer`);
      continue;
    }
    for (const [index, layer] of layers.entries()) {
      for (const key of [
        "widthMeters",
        "expTerm",
        "expScalePerKm",
        "linearTermPerKm",
        "constantTerm",
      ]) {
        if (!Number.isFinite(layer[key])) {
          errors.push(`${name}[${index}].${key} must be finite`);
        }
      }
    }
  }
}

export function validateAtmosphereConfig(config) {
  const errors = [];
  if (!config || typeof config !== "object") {
    return { ok: false, errors: ["config must be an object"] };
  }

  if (!(config.radiiMeters?.bottom > 0)) {
    errors.push("bottom radius must be positive");
  }
  if (!(config.radiiMeters?.top > config.radiiMeters?.bottom)) {
    errors.push("top radius must be greater than bottom radius");
  }
  if (!(config.renderUnitsPerMeter > 0)) {
    errors.push("renderUnitsPerMeter must be positive");
  }
  if (!(config.miePhaseG >= 0 && config.miePhaseG <= 0.92)) {
    errors.push("miePhaseG must be in [0, 0.92]");
  }
  if (!(config.groundAlbedo >= 0 && config.groundAlbedo <= 1)) {
    errors.push("groundAlbedo must be in [0, 1]");
  }

  finiteArray("solarIrradiance", config.solarIrradiance, 3, errors);
  finiteArray(
    "rayleighScatteringPerKm",
    config.rayleighScatteringPerKm,
    3,
    errors,
  );
  finiteArray("mieScatteringPerKm", config.mieScatteringPerKm, 3, errors);
  finiteArray("mieExtinctionPerKm", config.mieExtinctionPerKm, 3, errors);
  finiteArray(
    "absorptionExtinctionPerKm",
    config.absorptionExtinctionPerKm,
    3,
    errors,
  );

  if (
    Array.isArray(config.mieExtinctionPerKm) &&
    Array.isArray(config.mieScatteringPerKm)
  ) {
    for (let channel = 0; channel < 3; channel += 1) {
      if (
        config.mieExtinctionPerKm[channel] <
        config.mieScatteringPerKm[channel] + 0.0001
      ) {
        errors.push(`mieExtinctionPerKm[${channel}] must exceed scattering`);
      }
    }
  }

  validateDensityProfiles(config, errors);

  const products = Array.isArray(config.products)
    ? config.products
    : createProductSchedule(config.tier ?? "high");
  const memoryBytes = products.reduce(
    (total, product) => total + product.byteLength,
    0,
  );
  const budget =
    QUALITY_TIERS[config.tier ?? "high"]?.memoryBudgetBytes ?? Number.POSITIVE_INFINITY;
  if (memoryBytes > budget) {
    errors.push(`LUT memory ${memoryBytes} exceeds tier budget ${budget}`);
  }

  return {
    ok: errors.length === 0,
    errors,
    memoryBytes,
    products,
  };
}
