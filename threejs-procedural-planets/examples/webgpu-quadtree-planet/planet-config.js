export const GENERATED_VARIANT_MANIFEST_RELATIVE_PATH =
  "../../assets/generated-variants/manifest.json";

export const PLANET_UNITS = Object.freeze({
  heading: "Units",
  radiusKm: 12000,
  renderScale: 1 / 12000,
  heightAmplitude: 0.018,
  seaLevel: 0,
  worldToAtmosphereScale: 1000,
  temperatureRange: [0, 1],
  humidityRange: [0, 1],
  angularRadius: [0.003, 0.18],
});

export const VALIDITY_RANGE = Object.freeze({
  heading: "Validity range",
  radiusKm: [1200, 72000],
  solidBodyRadiusKm: [1200, 18000],
  gasGiantRadiusKm: [18000, 72000],
  heightAmplitude: [0, 0.08],
  seaLevel: [-0.4, 0.4],
  worldToAtmosphereScale: [0.001, 100000],
  angularRadius: PLANET_UNITS.angularRadius,
  sphereToEllipsoidBreakpoint: "use sphere under 0.5% flattening; use ellipsoid above it",
});

export const BODY_PRESETS = Object.freeze({
  pelagia: {
    id: "pelagia",
    kind: "terrestrial",
    radiusKm: 12000,
    terrainAmplitude: 0.018,
    seaLevel: 0.04,
    atmosphereInnerRadiusKm: 12000,
    atmosphereOuterRadiusKm: 12200,
    worldToAtmosphereScale: 1000,
    craterCount: 3,
    humidityBias: 0.05,
    temperatureBias: 0,
  },
  astra: {
    id: "astra",
    kind: "rocky",
    radiusKm: 5600,
    terrainAmplitude: 0.008,
    seaLevel: -0.2,
    atmosphereInnerRadiusKm: 5600,
    atmosphereOuterRadiusKm: 5645,
    worldToAtmosphereScale: 1000,
    craterCount: 5,
    humidityBias: -0.45,
    temperatureBias: -0.05,
  },
  verdance: {
    id: "verdance",
    kind: "dusty",
    radiusKm: 13600,
    terrainAmplitude: 0.02,
    seaLevel: -0.08,
    atmosphereInnerRadiusKm: 13600,
    atmosphereOuterRadiusKm: 13800,
    worldToAtmosphereScale: 1000,
    craterCount: 4,
    humidityBias: -0.25,
    temperatureBias: 0.08,
  },
});

export const QUALITY_TIERS = Object.freeze({
  full: {
    nearPatchSide: 129,
    activePatchBudget: [300, 900],
    patchRecordBytes: 96,
    rebuildDispatches: [2, 5],
    splitThreshold: 8,
    mergeThreshold: 4.5,
    maxLevel: 7,
  },
  balanced: {
    nearPatchSide: 65,
    activePatchBudget: [120, 360],
    patchRecordBytes: 80,
    rebuildDispatches: [1, 3],
    splitThreshold: 9,
    mergeThreshold: 5,
    maxLevel: 6,
  },
  reduced: {
    nearPatchSide: 33,
    activePatchBudget: [60, 160],
    patchRecordBytes: 64,
    rebuildDispatches: [0, 2],
    splitThreshold: 11,
    mergeThreshold: 6,
    maxLevel: 4,
  },
});

export function createPlanetConfig({
  preset = "pelagia",
  tier = "full",
  seed = 31.731,
  radiusKm = BODY_PRESETS[preset]?.radiusKm,
  worldToAtmosphereScale = BODY_PRESETS[preset]?.worldToAtmosphereScale,
} = {}) {
  if (!BODY_PRESETS[preset]) {
    throw new Error(`Unknown planet preset "${preset}"`);
  }
  if (!QUALITY_TIERS[tier]) {
    throw new Error(`Unknown planet tier "${tier}"`);
  }
  return {
    preset: BODY_PRESETS[preset],
    tier,
    seed,
    radiusKm,
    worldToAtmosphereScale,
    quality: QUALITY_TIERS[tier],
  };
}

export function validatePlanetConfig(config) {
  const errors = [];
  if (!config?.preset) {
    errors.push("preset is required");
  }
  if (
    !(config.radiusKm >= VALIDITY_RANGE.radiusKm[0] &&
      config.radiusKm <= VALIDITY_RANGE.radiusKm[1])
  ) {
    errors.push("radiusKm is outside the Validity range");
  }
  if (
    !(config.worldToAtmosphereScale >= VALIDITY_RANGE.worldToAtmosphereScale[0] &&
      config.worldToAtmosphereScale <= VALIDITY_RANGE.worldToAtmosphereScale[1])
  ) {
    errors.push("worldToAtmosphereScale is outside the Validity range");
  }
  if (!(config.preset.terrainAmplitude >= VALIDITY_RANGE.heightAmplitude[0])) {
    errors.push("height amplitude must be non-negative");
  }
  return {
    ok: errors.length === 0,
    errors,
  };
}
