export const PLANET_FIELD_ALGORITHM = Object.freeze({
  version: 2,
  baseFrequency: Object.freeze({
    rocky: 10.2,
    default: 8.4,
  }),
  tangentWarp: Object.freeze({
    noiseScale: 0.75,
    strength: 2.4,
    seedOffsets: Object.freeze([7.1, 11.4, 17.9]),
  }),
  fbm: Object.freeze({
    continental: Object.freeze({ scale: 0.55, octaves: 5, lacunarity: 2.03, gain: 0.5, seedOffset: 23.1 }),
    highlands: Object.freeze({ scale: 1.25, octaves: 4, lacunarity: 2.15, gain: 0.55, seedOffset: 41.8 }),
    ridged: Object.freeze({ scale: 2.7, octaves: 4, lacunarity: 2.08, gain: 0.52, seedOffset: 59.2 }),
  }),
  heightWeights: Object.freeze({
    continental: 0.62,
    highlands: 0.24,
    ridge: 0.34,
    latitude: 0.08,
    craterFloor: -0.75,
    craterWall: -0.08,
    craterRim: 0.9,
    ejectaStrength: 0.08,
  }),
  parityTolerance: 1e-9,
  fixtureTolerance: 1e-12,
});

export const PLANET_PARITY_CHANNELS = Object.freeze([
  "height",
  "macroHeight",
  "ridge",
  "oceanDepth",
  "humidity",
  "temperature",
  "slope",
  "roughnessVariance",
  "heightGradientX",
  "heightGradientY",
]);

export const PLANET_FIXED_DIRECTIONS = Object.freeze([
  Object.freeze([1, 0, 0]),
  Object.freeze([0, 1, 0]),
  Object.freeze([0, 0, 1]),
  Object.freeze([0.577, 0.577, 0.577]),
  Object.freeze([-0.42, 0.71, 0.56]),
]);

export const PLANET_PARITY_SEEDS = Object.freeze([31.731, 41.125, 59.75]);

export const NORMAL_QUERY_EVALUATION_COUNTS = Object.freeze({
  previousFullFieldEvaluations: 4,
  previousDerivation: "2 tangent axes * 2 central-difference samples per axis",
  fusedFullFieldEvaluations: 1,
  fusedDerivation: "one planetFields() evaluation returns height and the two tangent gradient components",
});
