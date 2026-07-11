export const PLANET_FIELD_ALGORITHM = Object.freeze({
  version: 5,
  hash: Object.freeze({
    family: "lowbias32-u32-lattice",
    // Authored identity constants. CPU and TSL must share these exact u32
    // values, but selecting this hash family is not a quality/performance proof.
    latticeMultipliers: Object.freeze([0x8da6b343, 0xd8163841, 0xcb1ab31f]),
    seedMultiplier: 0x9e3779b9,
    mixMultipliers: Object.freeze([0x21f0aaad, 0x735a2d97]),
    mixShifts: Object.freeze([16, 15, 15]),
    outputScale: 1 / 4294967296,
    octaveSeedStep: 17,
  }),
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
  parityTolerance: 0.005,
  parityToleranceProvenance:
    "Gated acceptance thresholds, authored from the current fixed probes with margin for f32 node codegen and driver libm. They are regression gates, not an analytic global error bound or a production accuracy guarantee.",
  parityToleranceByChannel: Object.freeze({
    height: 1e-4,
    macroHeight: 1e-4,
    ridge: 1e-4,
    oceanDepth: 1e-4,
    humidity: 1e-4,
    temperature: 1e-4,
    ruggednessProxy: 1e-4,
    roughnessCause: 1e-4,
  }),
  fixtureTolerance: 1e-12,
});

export const PLANET_PARITY_CHANNELS = Object.freeze([
  "height",
  "macroHeight",
  "ridge",
  "oceanDepth",
  "humidity",
  "temperature",
  "ruggednessProxy",
  "roughnessCause",
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
  fusedCandidateFullFieldEvaluations: 1,
  fusedCandidateDerivation:
    "one planetFields() evaluation returns height and two candidate tangent derivatives",
  evidenceScope:
    "Derived call count only. The candidate derivatives are not independently validated and must not drive production normals until a finite-difference or automatic-differentiation gate passes.",
});
