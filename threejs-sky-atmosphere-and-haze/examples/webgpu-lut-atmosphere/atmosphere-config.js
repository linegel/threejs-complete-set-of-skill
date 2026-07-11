export const LUT_MANIFEST_RELATIVE_PATH =
  "../../assets/lut-aerial-perspective/manifest.json";

// Keeping |g| away from one is a representation gate, not an artistic default.
// At |g| = 1 the Henyey-Greenstein distribution becomes a Dirac delta, which a
// finite angular LUT and float32 arithmetic cannot represent. The accepted
// interval below still contains strongly forward/backward-peaked aerosols while
// retaining a strictly positive denominator base of (1 - MAX_ABS_HG_G)^2.
export const MAX_ABS_HG_G = 0.99;

export const DEFAULT_ATMOSPHERE_MODEL = Object.freeze({
  name: "earth-shared-atmosphere",
  modelRevision: "earth-relative-radiometry-v2",
  radiiMeters: {
    bottom: 6360000,
    top: 6420000,
  },
  renderUnitsPerMeter: 1,
  integrationLengthUnit: "kilometer",
  coefficientUnit: "km^-1",
  // The source vector is an authored relative *normal irradiance*, not SI
  // watts and not disc radiance.  The live LUTs store transport response per
  // unit source, so the vector is applied exactly once during composition.
  solarQuantity: "authored-relative-normal-irradiance",
  solarUnit: "relative-normal-irradiance",
  radianceUnit: "relative-radiance-per-steradian",
  solarMagnitudeFactoredOutOfLiveLuts: true,
  spectralBasis: "three source bands; not display sRGB",
  miePhaseFunction: "Henyey-Greenstein",
  phaseNormalization: "integrates-to-one-over-4pi",
  phaseDirectionConvention:
    "omega points from camera into scene; s points from sample to sun; mu=dot(omega,s)",
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
    radianceUnits:
      "source-defined imported relative radiance; not SI and not evidence for the live response LUTs",
    evidenceStatus:
      "imported asset provenance only; not proof for the live Phase 1 compute kernels",
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
  // Canonical public tier names. The legacy full/budgeted/minimum keys below
  // remain aliases so existing callers do not fork the implementation.
  ultra: {
    label: "Ultra authored workload trial",
    transmittance: { width: 256, height: 64 },
    multiscatter: { width: 64, height: 32 },
    irradiance: { width: 64, height: 32 },
    skyView: { width: 192, height: 108 },
    aerialFroxel: { width: 192, height: 108, depth: 48 },
    cadence: "authored trial: update dirty body-frame/view products only",
    evidenceStatus: "authored-workload-trial",
  },
  high: {
    label: "High authored workload trial",
    transmittance: { width: 192, height: 48 },
    multiscatter: { width: 64, height: 32 },
    irradiance: { width: 64, height: 16 },
    skyView: { width: 128, height: 64 },
    aerialFroxel: { width: 160, height: 90, depth: 32 },
    cadence: "authored trial: stagger view-product updates under an age/error gate",
    evidenceStatus: "authored-workload-trial",
  },
  mobile: {
    label: "Mobile authored workload trial",
    transmittance: { width: 128, height: 32 },
    multiscatter: { width: 32, height: 16 },
    irradiance: { width: 32, height: 16 },
    skyView: { width: 96, height: 48 },
    aerialFroxel: { width: 96, height: 54, depth: 20 },
    cadence: "authored trial: cache base LUTs and amortize dirty view slices",
    evidenceStatus: "authored-workload-trial",
  },
  full: {
    label: "Full-detail authored workload trial",
    transmittance: { width: 256, height: 64 },
    multiscatter: { width: 64, height: 32 },
    irradiance: { width: 64, height: 32 },
    skyView: { width: 192, height: 108 },
    aerialFroxel: { width: 192, height: 108, depth: 48 },
    cadence: "authored trial: update dirty body-frame/view products only",
    evidenceStatus: "authored-workload-trial",
  },
  budgeted: {
    label: "Budgeted authored workload trial",
    transmittance: { width: 192, height: 48 },
    multiscatter: { width: 64, height: 32 },
    irradiance: { width: 64, height: 16 },
    skyView: { width: 128, height: 64 },
    aerialFroxel: { width: 160, height: 90, depth: 32 },
    cadence: "authored trial: stagger view-product updates under an age/error gate",
    evidenceStatus: "authored-workload-trial",
  },
  minimum: {
    label: "Minimum-resident authored workload trial",
    transmittance: { width: 128, height: 32 },
    multiscatter: { width: 32, height: 16 },
    irradiance: { width: 32, height: 16 },
    skyView: { width: 96, height: 48 },
    aerialFroxel: { width: 96, height: 54, depth: 20 },
    cadence: "authored trial: cache base LUTs and amortize dirty view slices",
    evidenceStatus: "authored-workload-trial",
  },
});

const RGBA16F_BYTES_PER_PIXEL = 4 * 2;

function ceilDiv(value, divisor) {
  return Math.ceil(value / divisor);
}

function textureBytes({ width, height, depth = 1 }) {
  return width * height * depth * RGBA16F_BYTES_PER_PIXEL;
}

function flattenedDispatch(dimensions, workgroup = [8, 8, 1]) {
  const invocationCount =
    dimensions.width * dimensions.height * (dimensions.depth ?? 1);
  const workgroupInvocations = workgroup.reduce(
    (product, extent) => product * extent,
    1,
  );
  const flattenedWorkgroupCount = ceilDiv(
    invocationCount,
    workgroupInvocations,
  );
  return {
    invocationCount,
    workgroupInvocations,
    flattenedWorkgroupCount,
    // Three r185 maps numeric Fn().compute(count) to a flattened dispatch. All
    // authored trials here stay below WebGPU's minimum 65,535 groups/dimension,
    // so the backend's device-limit wrapping branch is not entered.
    dispatch: [flattenedWorkgroupCount, 1, 1],
    dispatchModel:
      "Three r185 numeric compute count: ceil(count/product(workgroupSize)) x 1 x 1",
  };
}

export function createProductSchedule(tier = "budgeted") {
  const selected = QUALITY_TIERS[tier];
  if (!selected) {
    throw new Error(`Unknown atmosphere quality tier "${tier}"`);
  }

  const workgroup = [8, 8, 1];
  const products = [
    {
      id: "transmittance",
      label: "transmittance",
      kind: "StorageTexture",
      dimensions: { ...selected.transmittance, depth: 1 },
      format: "RGBA16F",
      workgroup,
      kernelId: "transmittance",
      dispatchAccounting: "one runtime transmittance dispatch",
      invalidation: [
        "bottom/top geometry",
        "density/extinction profiles",
        "integration unit",
        "quadrature/encoding revision",
      ],
      explicitlyNotInvalidatedBy: [
        "sun direction",
        "solar magnitude",
        "phase g",
        "ground albedo",
        "camera",
      ],
      cadence: "only when its exact dependency hash changes",
      implementationStatus: "kernel-implemented-not-submitted-by-node-validator",
      payload: "RGB transmittance; alpha unused; dimensionless",
    },
    {
      id: "multiscatter",
      label: "multiscatter",
      kind: "StorageTexture",
      dimensions: { ...selected.multiscatter, depth: 1 },
      format: "RGBA16F",
      workgroup,
      kernelId: "multiscatter",
      dispatchAccounting: "one runtime multiscatter closure dispatch",
      invalidation: [
        "transmittance version",
        "scattering/extinction",
        "phase closure",
        "ground albedo",
        "iteration/quadrature revision",
      ],
      cadence: selected.cadence,
      implementationStatus: "kernel-implemented-reference-ungated",
      payload:
        "RGB compact multiple-scattering radiance response per unit normal solar irradiance; alpha closure residual",
    },
    {
      id: "irradiance",
      label: "irradiance",
      kind: "StorageTexture",
      dimensions: { ...selected.irradiance, depth: 1 },
      format: "RGBA16F",
      workgroup,
      kernelId: "irradiance",
      dispatchAccounting: "one runtime hemispherical irradiance dispatch",
      invalidation: ["transmittance/multiscatter versions", "ground BRDF", "parameterization"],
      cadence: "only when transmittance/multiscatter or ground response changes",
      implementationStatus: "kernel-implemented-reference-ungated",
      payload:
        "RGB hemispherical irradiance response per unit normal solar irradiance; alpha quadrature weight",
    },
    {
      id: "sky-view",
      label: "sky-view",
      kind: "StorageTexture",
      dimensions: { ...selected.skyView, depth: 1 },
      format: "RGBA16F",
      workgroup,
      kernelId: "sky-view",
      dispatchAccounting: "one runtime camera/sun sky-view dispatch",
      invalidation: [
        "base-LUT versions",
        "camera body-relative altitude/local-curvature model",
        "local sun zenith",
        "ground model",
        "resolution",
      ],
      explicitlyNotInvalidatedBy: ["camera yaw/roll", "projection jitter", "floating-origin translation"],
      cadence: selected.cadence,
      implementationStatus: "kernel-implemented-reference-ungated",
      payload:
        "RGB body-frame radiance response per unit normal solar irradiance; alpha ground/sky classification",
    },
    {
      id: "aerial-inscattering",
      label: "aerial RGB single-inscattering",
      kind: "Storage3DTexture",
      dimensions: { ...selected.aerialFroxel },
      format: "RGBA16F",
      workgroup,
      kernelId: "aerial-products",
      dispatchAccounting:
        "one shared implemented Phase 1 dispatch writes inscattering and optical depth",
      invalidation: [
        "unjittered inverse view-projection",
        "camera pose in body coordinates",
        "base-LUT versions",
        "sun frame",
        "depth mapping",
        "viewport/aspect tier",
      ],
      explicitlyNotInvalidatedBy: [
        "temporal projection jitter",
        "solar magnitude, which is factored out and applied during composition",
      ],
      cadence: selected.cadence,
      implementationStatus: "kernel-implemented-live-camera-cumulative-xy-ray",
      payload:
        "RGB cumulative inscattering response per unit normal solar irradiance; alpha segment-validity",
    },
    {
      id: "aerial-optical-depth",
      label: "aerial RGB optical depth",
      kind: "Storage3DTexture",
      dimensions: { ...selected.aerialFroxel },
      format: "RGBA16F",
      workgroup,
      kernelId: "aerial-products",
      dispatchAccounting:
        "shared output of the aerial-products dispatch; zero additional dispatches",
      invalidation: [
        "unjittered inverse view-projection",
        "camera pose in body coordinates",
        "extinction profile",
        "depth mapping",
        "viewport/aspect tier",
      ],
      explicitlyNotInvalidatedBy: [
        "phase function",
        "solar magnitude",
      ],
      cadence: selected.cadence,
      implementationStatus: "kernel-implemented-live-camera-cumulative-xy-ray",
      payload: "RGB cumulative optical depth; alpha metric segment kilometers",
    },
  ];

  return products.map((product) => {
    // The aerial kernel owns a complete Z column.  One invocation integrates
    // monotonically along one XY camera ray and stores every cumulative slice;
    // dispatching one invocation per voxel would repeat all earlier work.
    const invocationDimensions = product.kernelId === "aerial-products"
      ? { width: product.dimensions.width, height: product.dimensions.height, depth: 1 }
      : product.dimensions;
    const dispatch = flattenedDispatch(invocationDimensions, product.workgroup);
    return {
      ...product,
      ...dispatch,
      outputTexelCount:
        product.dimensions.width *
        product.dimensions.height *
        (product.dimensions.depth ?? 1),
      invocationTopology:
        product.kernelId === "aerial-products"
          ? "one invocation per XY ray; cumulative Z loop inside the kernel"
          : "one invocation per output texel",
      byteLength: textureBytes(product.dimensions),
    };
  });
}

export function estimateAtmosphereMemoryBytes(tier = "budgeted") {
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
  tier = "budgeted",
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
    if (layers.length > 2) {
      errors.push(`${name} supports at most two piecewise layers in the Phase 1 kernel`);
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
      if (Number.isFinite(layer.widthMeters) && layer.widthMeters < 0) {
        errors.push(`${name}[${index}].widthMeters must be non-negative`);
      }
    }
  }
}

export function validateAtmosphereConfig(config) {
  const errors = [];
  if (!config || typeof config !== "object") {
    return { ok: false, errors: ["config must be an object"] };
  }

  if (!Number.isFinite(config.radiiMeters?.bottom) || !(config.radiiMeters.bottom > 0)) {
    errors.push("bottom radius must be positive");
  }
  if (!Number.isFinite(config.radiiMeters?.top) ||
      !(config.radiiMeters.top > config.radiiMeters?.bottom)) {
    errors.push("top radius must be greater than bottom radius");
  }
  if (!Number.isFinite(config.renderUnitsPerMeter) || !(config.renderUnitsPerMeter > 0)) {
    errors.push("renderUnitsPerMeter must be positive");
  }
  if (!(Math.abs(config.miePhaseG) <= MAX_ABS_HG_G)) {
    errors.push(`miePhaseG must satisfy abs(g) <= ${MAX_ABS_HG_G}`);
  }
  if (!(config.groundAlbedo >= 0 && config.groundAlbedo <= 1)) {
    errors.push("groundAlbedo must be in [0, 1]");
  }
  if (!(config.sunAngularRadius > 0 && config.sunAngularRadius < Math.PI / 2)) {
    errors.push("sunAngularRadius must be in (0, pi/2)");
  }
  if (config.integrationLengthUnit !== "kilometer") {
    errors.push("Phase 1 live integrationLengthUnit must be kilometer");
  }
  if (config.coefficientUnit !== "km^-1") {
    errors.push("Phase 1 live coefficientUnit must be km^-1");
  }
  if (config.miePhaseFunction !== "Henyey-Greenstein") {
    errors.push("Phase 1 live miePhaseFunction must be Henyey-Greenstein");
  }
  if (config.phaseNormalization !== "integrates-to-one-over-4pi") {
    errors.push("Phase 1 phaseNormalization must integrate to one over 4pi");
  }
  if (config.spectralBasis !== "three source bands; not display sRGB") {
    errors.push("Phase 1 spectralBasis must declare the three non-display source bands");
  }
  if (config.solarQuantity !== "authored-relative-normal-irradiance") {
    errors.push("live solarQuantity must declare authored relative normal irradiance");
  }
  if (config.solarUnit !== "relative-normal-irradiance") {
    errors.push("live solarUnit must be relative-normal-irradiance");
  }
  if (config.radianceUnit !== "relative-radiance-per-steradian") {
    errors.push("live radianceUnit must be relative-radiance-per-steradian");
  }
  if (config.solarMagnitudeFactoredOutOfLiveLuts !== true) {
    errors.push("live LUTs must factor solar magnitude out of transport response");
  }

  for (const profileName of ["rayleighDensity", "mieDensity", "absorptionDensity"]) {
    if (!Object.hasOwn(config.densityProfiles ?? {}, profileName)) {
      errors.push(`densityProfiles.${profileName} is required`);
    }
  }

  finiteArray("solarIrradiance", config.solarIrradiance, 3, errors);
  finiteArray(
    "rayleighScatteringPerKm",
    config.rayleighScatteringPerKm,
    3,
    errors,
  );

  for (const [name, values] of Object.entries({
    solarIrradiance: config.solarIrradiance,
    rayleighScatteringPerKm: config.rayleighScatteringPerKm,
    mieScatteringPerKm: config.mieScatteringPerKm,
    mieExtinctionPerKm: config.mieExtinctionPerKm,
    absorptionExtinctionPerKm: config.absorptionExtinctionPerKm,
  })) {
    if (Array.isArray(values) && values.some((value) => value < 0)) {
      errors.push(`${name} must be componentwise non-negative`);
    }
  }
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
      if (config.mieExtinctionPerKm[channel] < config.mieScatteringPerKm[channel]) {
        errors.push(`mieExtinctionPerKm[${channel}] must be >= scattering`);
      }
    }
  }

  validateDensityProfiles(config, errors);

  if (!QUALITY_TIERS[config.tier ?? "budgeted"]) {
    errors.push(`unknown authored workload trial ${config.tier}`);
  }

  const products = Array.isArray(config.products)
    ? config.products
    : createProductSchedule(config.tier ?? "budgeted");
  const memoryBytes = products.reduce(
    (total, product) => total + product.byteLength,
    0,
  );
  return {
    ok: errors.length === 0,
    errors,
    memoryBytes,
    memoryEvidenceStatus:
      "derived scheduled payload bytes only; not peak live memory; excludes alignment, histories, temporaries, imported LUTs, and the scene graph",
    products,
  };
}

function compareManifestNumber(errors, path, actual, expected) {
  if (!Number.isFinite(actual) || !Number.isFinite(expected)) {
    errors.push(`${path} must contain finite values in both manifest and live config`);
    return;
  }
  const scale = Math.max(1, Math.abs(actual), Math.abs(expected));
  if (Math.abs(actual - expected) > 1e-12 * scale) {
    errors.push(`${path} manifest=${actual} live=${expected}`);
  }
}

function compareManifestArray(errors, path, actual, expected) {
  if (!Array.isArray(actual) || !Array.isArray(expected) || actual.length !== expected.length) {
    errors.push(`${path} channel/layer count differs between manifest and live config`);
    return;
  }
  for (let index = 0; index < expected.length; index += 1) {
    compareManifestNumber(errors, `${path}[${index}]`, actual[index], expected[index]);
  }
}

function compareDensityProfiles(errors, manifestAtmosphere, config) {
  for (const [manifestName, configName] of [
    ["rayleighDensity", "rayleighDensity"],
    ["mieDensity", "mieDensity"],
    ["absorptionDensity", "absorptionDensity"],
  ]) {
    const manifestLayers = manifestAtmosphere?.[manifestName];
    const configLayers = config.densityProfiles?.[configName];
    if (!Array.isArray(manifestLayers) || !Array.isArray(configLayers) ||
        manifestLayers.length !== configLayers.length) {
      errors.push(`atmosphere.${manifestName} layer count differs from live config`);
      continue;
    }
    for (let layerIndex = 0; layerIndex < configLayers.length; layerIndex += 1) {
      const manifestLayer = manifestLayers[layerIndex];
      const configLayer = configLayers[layerIndex];
      for (const key of ["widthMeters", "expTerm", "expScalePerKm", "constantTerm"]) {
        compareManifestNumber(
          errors,
          `atmosphere.${manifestName}[${layerIndex}].${key}`,
          manifestLayer[key],
          configLayer[key],
        );
      }
      compareManifestNumber(
        errors,
        `atmosphere.${manifestName}[${layerIndex}].linearTermPerKm`,
        manifestLayer.linearTermPerKm ?? manifestLayer.linearTerm,
        configLayer.linearTermPerKm,
      );
    }
  }
}

export function validateAtmosphereManifestCompatibility(manifest, config) {
  const errors = [];
  const atmosphere = manifest?.atmosphere;
  if (!manifest || !atmosphere) {
    return { ok: false, errors: ["manifest atmosphere model is required"] };
  }

  for (const [path, actual, expected] of [
    ["integrationLengthUnit", manifest.integrationLengthUnit, config.integrationLengthUnit],
    ["coefficientUnit", manifest.coefficientUnit, config.coefficientUnit],
    ["solarQuantity", manifest.solarQuantity, config.solarQuantity],
    ["solarUnit", manifest.solarUnit, config.solarUnit],
    ["radianceUnit", manifest.liveRadianceUnit, config.radianceUnit],
    ["spectralBasis", manifest.spectralBasis, config.spectralBasis],
    ["phaseNormalization", manifest.phaseNormalization, config.phaseNormalization],
    ["phaseDirectionConvention", manifest.phaseDirectionConvention, config.phaseDirectionConvention],
    ["atmosphere.miePhaseFunction", atmosphere.miePhaseFunction, config.miePhaseFunction],
  ]) {
    if (actual !== expected) errors.push(`${path} manifest=${actual} live=${expected}`);
  }

  for (const [path, actual, expected] of [
    ["atmosphere.bottomRadiusMeters", atmosphere.bottomRadiusMeters, config.radiiMeters.bottom],
    ["atmosphere.topRadiusMeters", atmosphere.topRadiusMeters, config.radiiMeters.top],
    ["atmosphere.sunAngularRadius", atmosphere.sunAngularRadius, config.sunAngularRadius],
    ["atmosphere.miePhaseG", atmosphere.miePhaseG, config.miePhaseG],
    ["atmosphere.groundAlbedo", atmosphere.groundAlbedo, config.groundAlbedo],
  ]) {
    compareManifestNumber(errors, path, actual, expected);
  }

  for (const [path, actual, expected] of [
    ["atmosphere.solarIrradiance", atmosphere.solarIrradiance, config.solarIrradiance],
    ["atmosphere.rayleighScatteringPerKm", atmosphere.rayleighScatteringPerKm, config.rayleighScatteringPerKm],
    ["atmosphere.mieScatteringPerKm", atmosphere.mieScatteringPerKm, config.mieScatteringPerKm],
    ["atmosphere.mieExtinctionPerKm", atmosphere.mieExtinctionPerKm, config.mieExtinctionPerKm],
    ["atmosphere.absorptionExtinctionPerKm", atmosphere.absorptionExtinctionPerKm, config.absorptionExtinctionPerKm],
  ]) {
    compareManifestArray(errors, path, actual, expected);
  }
  compareDensityProfiles(errors, atmosphere, config);

  return {
    ok: errors.length === 0,
    errors,
    evidenceStatus:
      "metadata/model equality only; imported transport accuracy still requires its source error report",
  };
}
