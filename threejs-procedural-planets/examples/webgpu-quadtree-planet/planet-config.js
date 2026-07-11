export const GENERATED_VARIANT_MANIFEST_RELATIVE_PATH =
  "../../assets/generated-variants/manifest.json";

// This fixture keeps authored body data in kilometres and converts to SI only at
// the atmosphere boundary. Rendering scale is a product decision, not a physical
// constant: shaders should receive an explicit metresPerRenderUnit value.
export const PLANET_UNIT_CONTRACT = Object.freeze({
  bodyRadius: "kilometre",
  atmosphereRadius: "kilometre",
  atmosphereCoefficientLength: "metre",
  normalizedHeight: "signed dimensionless field",
  kilometresToMetres: 1000,
  displacementRule:
    "displacementKm = normalizedHeight * terrainAmplitudeRadiusFraction * radiusKm",
});

export const BODY_PRESETS = Object.freeze({
  pelagia: {
    id: "pelagia",
    kind: "terrestrial",
    radiusKm: 12000,
    terrainAmplitudeRadiusFraction: 0.018,
    seaLevel: 0.04,
    atmosphereInnerRadiusKm: 12000,
    atmosphereOuterRadiusKm: 12200,
    craterCount: 3,
    humidityBias: 0.05,
    temperatureBias: 0,
  },
  astra: {
    id: "astra",
    kind: "rocky",
    radiusKm: 5600,
    terrainAmplitudeRadiusFraction: 0.008,
    seaLevel: -0.2,
    atmosphereInnerRadiusKm: 5600,
    atmosphereOuterRadiusKm: 5645,
    craterCount: 3,
    humidityBias: -0.45,
    temperatureBias: -0.05,
  },
  verdance: {
    id: "verdance",
    kind: "dusty",
    radiusKm: 13600,
    terrainAmplitudeRadiusFraction: 0.02,
    seaLevel: -0.08,
    atmosphereInnerRadiusKm: 13600,
    atmosphereOuterRadiusKm: 13800,
    craterCount: 3,
    humidityBias: -0.25,
    temperatureBias: 0.08,
  },
});

// These are authored workload trials, not universal device classes or product
// acceptance gates. Products must select a trial from measured full-frame p50/
// p95 GPU and CPU time, peak live bytes, and visual-error sweeps on target hardware.
export const WORKLOAD_TRIALS = Object.freeze({
  "full-detail": {
    evidenceClass: "Authored",
    patchSideVertices: 65,
    activePatchPlanningRange: [120, 480],
    dirtyDispatchesPerUpdatePlanningRange: [1, 4],
    splitPixelError: 8,
    mergePixelError: 4.5,
    maxLevel: 7,
  },
  budgeted: {
    evidenceClass: "Authored",
    patchSideVertices: 33,
    activePatchPlanningRange: [80, 280],
    dirtyDispatchesPerUpdatePlanningRange: [1, 3],
    splitPixelError: 9,
    mergePixelError: 5,
    maxLevel: 6,
  },
  "minimum-resident": {
    evidenceClass: "Authored",
    patchSideVertices: 17,
    activePatchPlanningRange: [48, 160],
    dirtyDispatchesPerUpdatePlanningRange: [0, 1],
    splitPixelError: 11,
    mergePixelError: 6,
    maxLevel: 4,
  },
});

export function createPlanetConfig({
  preset = "pelagia",
  trial = "budgeted",
  seed = 31.731,
  radiusKm = BODY_PRESETS[preset]?.radiusKm,
  metresPerRenderUnit = 1000,
} = {}) {
  if (!BODY_PRESETS[preset]) {
    throw new Error(`Unknown planet preset "${preset}"`);
  }
  if (!WORKLOAD_TRIALS[trial]) {
    throw new Error(`Unknown planet workload trial "${trial}"`);
  }
  const sourcePreset = BODY_PRESETS[preset];
  const atmosphereThicknessKm =
    sourcePreset.atmosphereOuterRadiusKm - sourcePreset.atmosphereInnerRadiusKm;
  const resolvedPreset = Object.freeze({
    ...sourcePreset,
    radiusKm,
    atmosphereInnerRadiusKm: radiusKm,
    atmosphereOuterRadiusKm: radiusKm + atmosphereThicknessKm,
    atmosphereReferenceSurface: "sphere",
  });
  return {
    preset: resolvedPreset,
    trial,
    seed,
    radiusKm,
    metresPerRenderUnit,
    workload: WORKLOAD_TRIALS[trial],
  };
}

export function validatePlanetConfig(config) {
  const errors = [];
  if (!config?.preset) errors.push("preset is required");
  if (!Number.isFinite(config?.seed)) errors.push("seed must be finite");
  if (!Number.isFinite(config?.radiusKm) || config.radiusKm <= 0) {
    errors.push("radiusKm must be finite and positive");
  }
  if (!Number.isFinite(config?.metresPerRenderUnit) || config.metresPerRenderUnit <= 0) {
    errors.push("metresPerRenderUnit must be finite and positive");
  }
  if (!Number.isFinite(config?.preset?.terrainAmplitudeRadiusFraction) ||
      config.preset.terrainAmplitudeRadiusFraction < 0) {
    errors.push("terrainAmplitudeRadiusFraction must be finite and non-negative");
  }
  if (!Number.isFinite(config?.preset?.atmosphereInnerRadiusKm) ||
      !(config.preset.atmosphereInnerRadiusKm > 0)) {
    errors.push("atmosphereInnerRadiusKm must be finite and positive");
  }
  if (!Number.isFinite(config?.preset?.atmosphereOuterRadiusKm) ||
      !(config.preset.atmosphereOuterRadiusKm > config?.preset?.atmosphereInnerRadiusKm)) {
    errors.push("atmosphereOuterRadiusKm must exceed atmosphereInnerRadiusKm");
  }
  if (config?.preset?.atmosphereReferenceSurface !== "sphere") {
    errors.push("this fixture implements only a spherical atmosphere reference surface");
  }
  if (config?.preset?.radiusKm !== config?.radiusKm ||
      config?.preset?.atmosphereInnerRadiusKm !== config?.radiusKm) {
    errors.push("surface radius and atmosphere bottom radius must be the same reference sphere");
  }
  for (const field of ["seaLevel", "humidityBias", "temperatureBias"]) {
    if (!Number.isFinite(config?.preset?.[field])) errors.push(`preset.${field} must be finite`);
  }
  if (!Number.isInteger(config?.preset?.craterCount) || config.preset.craterCount < 0) {
    errors.push("preset.craterCount must be a non-negative integer");
  }
  if (config?.workload?.evidenceClass !== "Authored") {
    errors.push("workload trial must retain its Authored evidence classification");
  }
  const patchSide = config?.workload?.patchSideVertices;
  if (!Number.isInteger(patchSide) || patchSide < 3 ||
      !Number.isInteger(Math.log2(patchSide - 1))) {
    errors.push("patchSideVertices must be 2^k+1 for shared dyadic topology");
  }
  if (!(config?.workload?.splitPixelError > config?.workload?.mergePixelError &&
        config.workload.mergePixelError >= 0)) {
    errors.push("splitPixelError must exceed non-negative mergePixelError for hysteresis");
  }
  return { ok: errors.length === 0, errors };
}
