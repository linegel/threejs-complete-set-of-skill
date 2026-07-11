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

export const FIELD_GRADIENT_CHANNELS = deepFreeze({
  r: "macroGradientX",
  g: "macroGradientY",
  b: "macroGradientZ",
  a: "slope",
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
  "macroGradientX",
  "macroGradientY",
  "macroGradientZ",
]);

export const FIELD_PARITY_ERROR_MANIFEST = deepFreeze({
  version: 2,
  directF32: {
    status: "gated",
    provenance: "Gated",
    cpuOracle: "JavaScript binary64 with explicit f32 hash-corner conversion",
    gpuPath: "WGSL f32 field arithmetic with u32 seed uniform; no storage quantization or interpolation",
    roundingModel:
      "Use conservative WGSL u≈2^-23 for planning; builtins, FMA, reassociation, and subnormal behavior require separate empirical allowance.",
    absoluteChannelGates: Object.fromEntries(FIELD_PARITY_CHANNELS.map((channel) => [
      channel,
      channel.startsWith("macroGradient") ? 4e-5 : 8e-6,
    ])),
    thresholdConsumers: {
      placementMask: {
        threshold: 0.5,
        outputGuardBand: 8e-6,
        provenance: "Gated",
      },
    },
  },
  rgba16floatStorage: {
    status: "artifact-gated-at-declared-probes",
    provenance: "Derived format bound; interpolation and field error remain Measured",
    normalizedChannelDomain: [0, 1],
    nearestRoundingBoundBelowOne: 2 ** -12,
    validatedArtifactScope:
      "base packed/derived/gradient values at three declared texels and packed values at three declared texels per explicit box-filter mip",
    interpolationError:
      "not validated; content-, footprint-, and Jacobian-dependent filtered sampling requires a separate artifact",
  },
});

export const FIELD_ALGORITHM = deepFreeze({
  defaultSeed: 17,
  coordinates: {
    object: {
      transform: "identity",
      gradientDomain: "original-object-coordinate",
    },
    world: {
      transform: "uniform-scale",
      scale: 0.125,
      gradientDomain: "original-world-coordinate",
    },
    sphere: {
      transform: "normalize",
      minimumRadius: 1e-12,
      gradientDomain: "original-sphere-input-coordinate",
    },
  },
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
    // Slope is the norm of the analytic macro-height gradient after the
    // complete warp Jacobian, not a visual-channel difference heuristic.
    slopeScale: 0.12,
    placementBiomeLow: 0.22,
    placementBiomeHigh: 0.46,
    placementSlopeLow: 0.24,
    placementSlopeHigh: 0.68,
  },
});

const derivedBandSpectrum = Object.fromEntries(
  Object.entries(FIELD_ALGORITHM.bands).map(([name, band]) => {
    const hurstExponent = -Math.log(band.gain) / Math.log(band.lacunarity);
    return [name, {
      provenance: "Derived from the authored fixture lacunarity and gain",
      hurstExponent,
      amplitudeGain: band.gain,
      frequencyRatio: band.lacunarity,
      gradientGainPerOctave: band.lacunarity * band.gain,
      curvatureGainPerOctave: band.lacunarity ** 2 * band.gain,
    }];
  }),
);

export const FIELD_SPECTRUM = deepFreeze({
  provenance: "Authored regression fixture; not a universal scene or device prescription",
  hashFamily: "trilinear value noise with u32 lattice lowbias32 hash and deterministic seed wrapping",
  outputRange: [0, 1],
  normalization: "octave weights normalized by accumulated amplitude",
  bands: derivedBandSpectrum,
  footprintGate:
    "For every consumer require f_support*σmax(J_composed)<=0.5, or attenuate unresolved bands and transfer their slope variance to shading.",
});

export const fixedProbes = deepFreeze([
  { domain: "sphere", coordinate: [1, 0, 0], seed: 17 },
  { domain: "sphere", coordinate: [0.577, 0.577, 0.577], seed: 17 },
  { domain: "world", coordinate: [12.5, -4, 8.25], seed: 29 },
  { domain: "object", coordinate: [0.125, 0.75, 0.5], seed: 43 },
]);

export const FIELD_PARITY_THRESHOLD_ROLES = deepFreeze({
  center: "placement-mask-threshold-center",
  lower: "placement-mask-threshold-lower",
  upper: "placement-mask-threshold-upper",
});

// These probes bracket the placementMask=0.5 decision surface for seed 29.
// The center is inside the declared output guard band; lower and upper are
// 5e-5 away, so an allowed 8e-6 direct-f32 error cannot silently change their
// expected threshold side. Stable IDs/roles make validator selection
// independent of corpus order or later stress-probe additions.
export const placementThresholdProbes = deepFreeze([
  {
    id: "placement-mask-threshold-center-v1",
    role: FIELD_PARITY_THRESHOLD_ROLES.center,
    domain: "world",
    coordinate: [12.539499285176685, -4, 8],
    seed: 29,
  },
  {
    id: "placement-mask-threshold-lower-v1",
    role: FIELD_PARITY_THRESHOLD_ROLES.lower,
    domain: "world",
    coordinate: [12.539624435515918, -4, 8],
    seed: 29,
  },
  {
    id: "placement-mask-threshold-upper-v1",
    role: FIELD_PARITY_THRESHOLD_ROLES.upper,
    domain: "world",
    coordinate: [12.539374205897467, -4, 8],
    seed: 29,
  },
]);

export const gpuParityProbes = deepFreeze([
  ...fixedProbes,
  { domain: "object", coordinate: [-1.000001, 2.99999, -4.5], seed: -13 },
  { domain: "world", coordinate: [4095.875, -2048.125, 8191.5], seed: 2147483000 },
  { domain: "sphere", coordinate: [-0.2852127329, 0.9972098051, 5.372133451], seed: 16885 },
  ...placementThresholdProbes,
]);
