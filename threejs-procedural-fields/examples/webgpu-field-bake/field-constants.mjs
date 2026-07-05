function deepFreeze(value) {
  if (value && typeof value === "object") {
    for (const child of Object.values(value)) deepFreeze(child);
    Object.freeze(value);
  }
  return value;
}

export const FIELD_CHANNELS = deepFreeze({
  r: "macroHeight",
  g: "ridge",
  b: "cavity",
  a: "moisture",
});

export const FIELD_DERIVED_CHANNELS = deepFreeze({
  r: "slope",
  g: "biome",
  b: "roughness",
  a: "placementMask",
});

export const FIELD_PARITY_CHANNELS = deepFreeze([
  "macroHeight",
  "ridge",
  "cavity",
  "moisture",
  "slope",
  "biome",
  "roughness",
  "placementMask",
]);

export const FIELD_ALGORITHM = deepFreeze({
  defaultSeed: 17,
  hash: {
    family: "lowbias32-u32-lattice",
    // Gated constants: odd u32 lattice decorrelators plus Chris Wellons'
    // lowbias32 finalizer. CPU uses Math.imul/u32 wraps; TSL uses u32 wraps.
    latticeMultipliers: [0x8da6b343, 0xd8163841, 0xcb1ab31f],
    seedMultiplier: 0x9e3779b9,
    mixMultipliers: [0x21f0aaad, 0x735a2d97],
    mixShifts: [16, 15, 15],
    seedWrap: 4294967296,
    outputScale: 1 / 4294967296,
    octaveSeedStep: 17,
  },
  warp: {
    frequency: 3.1,
    amplitude: 0.45,
    seedOffsets: [3, 7, 11],
  },
  bands: {
    macroHeight: {
      scale: 1.4,
      seedOffset: 13,
      octaves: 4,
      lacunarity: 2.03,
      gain: 0.5,
      initialAmplitude: 0.5,
      initialFrequency: 1,
    },
    ridge: {
      scale: 3.6,
      seedOffset: 29,
      octaves: 4,
      lacunarity: 2.08,
      gain: 0.52,
      initialAmplitude: 0.5,
      initialFrequency: 1,
    },
    cavity: {
      scale: 5.8,
      seedOffset: 47,
      octaves: 3,
      lacunarity: 2.1,
      gain: 0.48,
      initialAmplitude: 0.5,
      initialFrequency: 1,
      exponent: 2.7,
    },
    moisture: {
      scale: 0.9,
      seedOffset: 71,
      octaves: 3,
      lacunarity: 1.9,
      gain: 0.55,
      initialAmplitude: 0.5,
      initialFrequency: 1,
      fieldWeight: 0.7,
      macroWeight: 0.2,
    },
  },
  derived: {
    slopeCavityWeight: 0.35,
    biomeMoistureWeight: 0.55,
    biomeMacroWeight: 0.25,
    biomeCavityWeight: -0.12,
    roughnessBase: 0.34,
    roughnessRidgeWeight: 0.28,
    roughnessCavityWeight: 0.22,
    roughnessMoistureWeight: -0.1,
    placementBiomeLow: 0.45,
    placementBiomeHigh: 0.75,
    placementSlopeLow: 0.7,
    placementSlopeHigh: 0.95,
  },
});

export const FIELD_SPECTRUM = deepFreeze({
  hashFamily: "trilinear value noise with u32 lattice lowbias32 hash and deterministic seed wrapping",
  outputRange: [0, 1],
  normalization: "octave weights normalized by accumulated amplitude",
  lacunarity: { min: 1.7, max: 2.35, default: FIELD_ALGORITHM.bands.macroHeight.lacunarity },
  gain: { min: 0.42, max: 0.62, default: FIELD_ALGORITHM.bands.macroHeight.gain },
  spectralSlope: {
    macro: "low frequency, silhouette/region support",
    meso: "ridges, cavity, wear, shore breakup",
    micro: "normal/roughness only; never geometry displacement",
  },
  validityRange: {
    sphereRadiusKm: [1, 72000],
    worldMeters: [0.001, 1000000],
    objectUnits: [0.0001, 10000],
  },
});

export const fixedProbes = deepFreeze([
  { domain: "sphere", coordinate: [1, 0, 0], seed: 17 },
  { domain: "sphere", coordinate: [0.577, 0.577, 0.577], seed: 17 },
  { domain: "world", coordinate: [12.5, -4, 8.25], seed: 29 },
  { domain: "object", coordinate: [0.125, 0.75, 0.5], seed: 43 },
]);
