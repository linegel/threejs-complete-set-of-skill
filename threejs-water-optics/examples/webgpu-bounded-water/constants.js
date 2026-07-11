import { Vector2, Vector3 } from "three/webgpu";

export const WATER_DEBUG_MODES = Object.freeze({
  final: 0,
  height: 1,
  velocity: 2,
  normals: 3,
  caustics: 4,
  "fresnel-and-tir": 5,
  absorption: 6,
  "optical-transport-unavailable": 7,
});

export const WATER_MECHANISM_ROUTES = Object.freeze([
  "heightfield-simulation",
  "drops-and-object-ripples",
  "differential-caustics",
  "refraction-and-absorption",
  "fresnel-and-tir",
  "buoyancy-spray-and-masks",
]);

export const WATER_MECHANISM_PROFILES = Object.freeze({
  "heightfield-simulation": Object.freeze({
    mode: "height",
    seedDrop: false,
    objectImpulse: false,
    receiverCaustics: false,
    opticalTransport: false,
    buoyancySprayMasks: false,
    underwaterView: false,
  }),
  "drops-and-object-ripples": Object.freeze({
    mode: "velocity",
    seedDrop: true,
    objectImpulse: true,
    receiverCaustics: false,
    opticalTransport: false,
    buoyancySprayMasks: false,
    underwaterView: false,
  }),
  "differential-caustics": Object.freeze({
    mode: "final",
    seedDrop: true,
    objectImpulse: true,
    receiverCaustics: true,
    opticalTransport: true,
    buoyancySprayMasks: false,
    underwaterView: false,
  }),
  "refraction-and-absorption": Object.freeze({
    mode: "final",
    seedDrop: true,
    objectImpulse: false,
    receiverCaustics: false,
    opticalTransport: true,
    buoyancySprayMasks: false,
    underwaterView: false,
  }),
  "fresnel-and-tir": Object.freeze({
    mode: "fresnel-and-tir",
    seedDrop: false,
    objectImpulse: false,
    receiverCaustics: false,
    opticalTransport: true,
    buoyancySprayMasks: false,
    underwaterView: true,
  }),
  "buoyancy-spray-and-masks": Object.freeze({
    mode: "final",
    seedDrop: true,
    objectImpulse: true,
    receiverCaustics: true,
    opticalTransport: true,
    buoyancySprayMasks: true,
    underwaterView: false,
  }),
});

export const WATER_EXAMPLE_CLAIM_BOUNDARY = Object.freeze({
  classification: "canonical-native-webgpu-lab-incomplete",
  proves: Object.freeze([
    "r185 WebGPU StorageTexture ping-pong construction",
    "fixed-step anisotropic CFL configuration gate",
    "authored parametric displacement with exact tangent construction",
    "deterministic CPU inversion of the authored horizontal map",
    "source-driven atomic receiver deposition with a bounded uint overflow proof",
    "view-space refracted-ray candidate validation and foreground rejection",
  ]),
  doesNotProve: Object.freeze([
    "receiver-space caustic GPU energy closure",
    "depth-validated refraction GPU execution or metric optical thickness",
    "GPU-versus-CPU numerical parity",
    "a bounded live heightfield residual without an enforced hard envelope",
    "mesh-resolved live heightfield bandwidth",
    "production compositing, sustained performance, or mobile thermal behavior",
  ]),
});

export const WATER_QUALITY_TIERS = Object.freeze({
  ultra: Object.freeze({
    resolution: 512,
    fixedTimeStep: 1 / 240,
    maxSubsteps: 4,
    linearWorkgroupSize: 64,
    meshSegments: 192,
    analyticBands: 5,
    microBands: 4,
  }),
  high: Object.freeze({
    resolution: 256,
    fixedTimeStep: 1 / 120,
    maxSubsteps: 3,
    linearWorkgroupSize: 64,
    meshSegments: 128,
    analyticBands: 4,
    microBands: 3,
  }),
  medium: Object.freeze({
    resolution: 192,
    fixedTimeStep: 1 / 120,
    maxSubsteps: 3,
    linearWorkgroupSize: 64,
    meshSegments: 96,
    analyticBands: 3,
    microBands: 2,
  }),
  low: Object.freeze({
    resolution: 96,
    fixedTimeStep: 1 / 60,
    maxSubsteps: 2,
    linearWorkgroupSize: 64,
    meshSegments: 48,
    analyticBands: 2,
    microBands: 0,
  }),
});

export const CANONICAL_WATER_TIER_IDS = Object.freeze(["ultra", "high", "medium", "low"]);
export const WATER_CFL_LIMIT = 0.85;
export const CAUSTIC_POWER_QUANTIZATION_UNITS_PER_WATT = 1 << 20;
export const UINT32_MAX = 0xffffffff;

// Authored identity carried from examples/analytic-wave-optics/water-system.js.
export const AUTHORED_WAVES = Object.freeze([
  Object.freeze({ direction: new Vector2(0.94, 0.32).normalize(), amplitude: 0.38, wavelength: 28.0, steepness: 0.5 }),
  Object.freeze({ direction: new Vector2(-0.42, 0.91).normalize(), amplitude: 0.24, wavelength: 18.0, steepness: 0.46 }),
  Object.freeze({ direction: new Vector2(0.78, -0.52).normalize(), amplitude: 0.16, wavelength: 12.0, steepness: 0.42 }),
  Object.freeze({ direction: new Vector2(-0.35, -0.78).normalize(), amplitude: 0.1, wavelength: 10.0, steepness: 0.35 }),
  Object.freeze({ direction: new Vector2(0.55, 0.62).normalize(), amplitude: 0.06, wavelength: 9.5, steepness: 0.28 }),
]);

// Authored micro-normal bundle from references/water-surface-system.md.
export const MICRO_NORMAL_BANDS = Object.freeze([
  Object.freeze({ wavelength: 12.0, relativeAmplitude: 1.0, direction: new Vector2(0.8, 0.4).normalize(), speedScale: 1.0 }),
  Object.freeze({ wavelength: 6.0, relativeAmplitude: 0.55, direction: new Vector2(-0.4, 0.8).normalize(), speedScale: 0.95 }),
  Object.freeze({ wavelength: 2.5, relativeAmplitude: 0.22, direction: new Vector2(0.28, 0.96).normalize(), speedScale: 0.9 }),
  Object.freeze({ wavelength: 5.25, relativeAmplitude: 0.12, direction: new Vector2(0.89, -0.46).normalize(), speedScale: 1.1 }),
  Object.freeze({ wavelength: 3.0, relativeAmplitude: 0.08, direction: new Vector2(0.49, 0.87).normalize(), speedScale: 0.7 }),
  Object.freeze({ wavelength: 1.5, relativeAmplitude: 0.05, direction: new Vector2(-0.08, 0.99).normalize(), speedScale: 1.2 }),
]);

export const DEFAULT_WATER_PARAMETERS = Object.freeze({
  worldSize: new Vector2(8, 8),
  dampingRatePerSecond: 0.6,
  waveSpeed: 2.0,
  boundaryFadeCells: 3,
  dropRadius: 0.06,
  dropStrength: 0.12,
  objectRadius: 0.07,
  objectDisplacementScale: 0.6,
  eventMaskCenter: new Vector2(0, 0),
  eventMaskRadiusMeters: 0.55,
  eventMaskEnabled: false,
  impulseHistoryDecayRatePerSecond: 1.8,
  causticEpsilon: 0.00025,
  causticMaxIntensity: 8.0,
  causticScale: 0.2,
  causticReceiverDepthMeters: 1.2,
  causticFootprintAreaEpsilonMeters2: 0.0004,
  causticLightTransmission: 0.96,
  refractionProbeDistanceMeters: 1.5,
  refractionMaxCrossTrackMeters: 0.12,
  refractionForegroundEpsilonMeters: 0.001,
  airIor: 1.0,
  waterIor: 1.333,
  previewPathLengthMeters: 1.25,
  absorptionCoefficientPerMeter: new Vector3(0.18, 0.075, 0.035),
  sunDirection: new Vector3(2, 2, -1).normalize(),
  deepBodyColor: new Vector3(0.005, 0.042, 0.115),
  shallowScatterColor: new Vector3(0.0, 0.27, 0.19),
  foamColor: new Vector3(0.9, 0.95, 1.0),
});

const FINITE_NON_NEGATIVE_PARAMETERS = Object.freeze([
  "dampingRatePerSecond",
  "boundaryFadeCells",
  "dropRadius",
  "objectRadius",
  "impulseHistoryDecayRatePerSecond",
  "causticEpsilon",
  "causticMaxIntensity",
  "causticScale",
  "causticReceiverDepthMeters",
  "causticFootprintAreaEpsilonMeters2",
  "refractionProbeDistanceMeters",
  "refractionMaxCrossTrackMeters",
  "refractionForegroundEpsilonMeters",
  "previewPathLengthMeters",
  "eventMaskRadiusMeters",
]);

export function validateFiniteWaterParameters(parameters) {
  if (!parameters || typeof parameters !== "object") throw new Error("Water parameters must be an object.");
  for (const name of FINITE_NON_NEGATIVE_PARAMETERS) {
    const value = parameters[name];
    if (!Number.isFinite(value) || value < 0) throw new Error(`Water ${name} must be finite and non-negative; got ${value}.`);
  }
  for (const name of [
    "boundaryFadeCells",
    "dropRadius",
    "objectRadius",
    "causticEpsilon",
    "causticReceiverDepthMeters",
    "causticFootprintAreaEpsilonMeters2",
    "refractionProbeDistanceMeters",
    "refractionMaxCrossTrackMeters",
  ]) {
    if (parameters[name] <= 0) throw new Error(`Water ${name} must be strictly positive.`);
  }
  for (const name of ["waveSpeed", "airIor", "waterIor"]) {
    const value = parameters[name];
    if (!Number.isFinite(value) || value <= 0) throw new Error(`Water ${name} must be finite and positive; got ${value}.`);
  }
  for (const name of ["dropStrength", "objectDisplacementScale"]) {
    if (!Number.isFinite(parameters[name])) throw new Error(`Water ${name} must be finite; got ${parameters[name]}.`);
  }
  if (!Number.isFinite(parameters.causticLightTransmission)
      || parameters.causticLightTransmission < 0
      || parameters.causticLightTransmission > 1) {
    throw new Error("Water causticLightTransmission must be finite and in [0, 1].");
  }
  if (!(parameters.worldSize instanceof Vector2)
      || !Number.isFinite(parameters.worldSize.x)
      || !Number.isFinite(parameters.worldSize.y)
      || parameters.worldSize.x <= 0
      || parameters.worldSize.y <= 0) {
    throw new Error("Water worldSize must be a finite positive Vector2.");
  }
  if (!(parameters.eventMaskCenter instanceof Vector2)
      || !Number.isFinite(parameters.eventMaskCenter.x)
      || !Number.isFinite(parameters.eventMaskCenter.y)) {
    throw new Error("Water eventMaskCenter must be a finite Vector2.");
  }
  for (const name of ["absorptionCoefficientPerMeter", "deepBodyColor", "shallowScatterColor", "foamColor", "sunDirection"]) {
    const vector = parameters[name];
    if (!(vector instanceof Vector3) || ![vector.x, vector.y, vector.z].every(Number.isFinite)) {
      throw new Error(`Water ${name} must be a finite Vector3.`);
    }
  }
  if ([parameters.absorptionCoefficientPerMeter.x, parameters.absorptionCoefficientPerMeter.y, parameters.absorptionCoefficientPerMeter.z].some((value) => value < 0)) {
    throw new Error("Water absorptionCoefficientPerMeter must be non-negative.");
  }
  for (const name of ["deepBodyColor", "shallowScatterColor", "foamColor"]) {
    if ([parameters[name].x, parameters[name].y, parameters[name].z].some((value) => value < 0)) {
      throw new Error(`Water ${name} radiance channels must be non-negative.`);
    }
  }
  if (parameters.sunDirection.lengthSq() <= 1e-12) throw new Error("Water sunDirection must be nonzero.");
  if (parameters.eventMaskEnabled !== true && parameters.eventMaskEnabled !== false) {
    throw new Error("Water eventMaskEnabled must be boolean.");
  }
  return true;
}

export function boundedCausticQuantizationContract(resolution) {
  if (!Number.isInteger(resolution) || resolution < 2) throw new Error("Caustic quantization requires resolution >= 2.");
  const sourceCount = resolution * resolution;
  // Four bilinear taps can add at most two uint units above the unquantized
  // source total through nearest-integer rounding. Reserve those units before
  // deriving the adversarial all-sources-to-one-receiver cap.
  const roundingReserveUnitsPerSource = 2;
  const maxUnitsPerSource = Math.max(1, Math.floor(UINT32_MAX / sourceCount) - roundingReserveUnitsPerSource);
  return Object.freeze({
    sourceCount,
    unitsPerWatt: CAUSTIC_POWER_QUANTIZATION_UNITS_PER_WATT,
    maxUnitsPerSource,
    maxPowerPerSourceWatts: maxUnitsPerSource / CAUSTIC_POWER_QUANTIZATION_UNITS_PER_WATT,
    roundingReserveUnitsPerSource,
    worstCaseReceiverUnits: (maxUnitsPerSource + roundingReserveUnitsPerSource) * sourceCount,
    maximumRoundingLossWatts: (roundingReserveUnitsPerSource * sourceCount) / CAUSTIC_POWER_QUANTIZATION_UNITS_PER_WATT,
  });
}

export function exactDielectricFresnel(cosIncident, incidentIor, transmittedIor) {
  if (![cosIncident, incidentIor, transmittedIor].every(Number.isFinite)) {
    throw new Error("Exact Fresnel requires finite arguments.");
  }
  if (incidentIor <= 0 || transmittedIor <= 0) {
    throw new Error("Exact Fresnel requires positive refractive indices.");
  }

  const ci = Math.min(1, Math.max(0, cosIncident));
  const eta = incidentIor / transmittedIor;
  const sinTransmittedSquared = eta * eta * (1 - ci * ci);
  if (sinTransmittedSquared > 1) {
    return { reflectance: 1, totalInternalReflection: true, cosTransmitted: 0 };
  }

  const ct = Math.sqrt(Math.max(0, 1 - sinTransmittedSquared));
  const rsDenominator = incidentIor * ci + transmittedIor * ct;
  const rpDenominator = transmittedIor * ci + incidentIor * ct;
  const rs = rsDenominator === 0 ? 1 : (incidentIor * ci - transmittedIor * ct) / rsDenominator;
  const rp = rpDenominator === 0 ? 1 : (transmittedIor * ci - incidentIor * ct) / rpDenominator;
  return {
    reflectance: 0.5 * (rs * rs + rp * rp),
    totalInternalReflection: false,
    cosTransmitted: ct,
  };
}

export function beerLambertTransmission(absorptionPerMeter, pathLengthMeters) {
  if (!Number.isFinite(pathLengthMeters) || pathLengthMeters < 0) {
    throw new Error("Beer-Lambert path length must be finite and non-negative.");
  }
  const coefficients = absorptionPerMeter instanceof Vector3
    ? absorptionPerMeter
    : new Vector3(absorptionPerMeter.x, absorptionPerMeter.y, absorptionPerMeter.z);
  if (![coefficients.x, coefficients.y, coefficients.z].every((value) => Number.isFinite(value) && value >= 0)) {
    throw new Error("Beer-Lambert absorption coefficients must be finite and non-negative.");
  }
  return new Vector3(
    Math.exp(-coefficients.x * pathLengthMeters),
    Math.exp(-coefficients.y * pathLengthMeters),
    Math.exp(-coefficients.z * pathLengthMeters),
  );
}

export function receiverAreaDeterminant(du, dv) {
  if (![du?.x, du?.y, dv?.x, dv?.y].every(Number.isFinite)) {
    throw new Error("Receiver-area determinant requires finite 2D derivatives.");
  }
  return Math.abs(du.x * dv.y - du.y * dv.x);
}

export function waterStorageBytes(resolution, textureCount = 4, bytesPerChannel = 2) {
  return resolution * resolution * 4 * bytesPerChannel * textureCount;
}

export function boundedWaterPersistentBytes(resolution) {
  const textures = waterStorageBytes(resolution, 4);
  const causticAtomicBuffer = resolution * resolution * Uint32Array.BYTES_PER_ELEMENT;
  const fixedBuffers = 8 * Uint32Array.BYTES_PER_ELEMENT + 16 * Float32Array.BYTES_PER_ELEMENT + 16 * Float32Array.BYTES_PER_ELEMENT;
  return textures + causticAtomicBuffer + fixedBuffers;
}

export function waterCourantNumber({
  resolution,
  fixedTimeStep,
  waveSpeed = DEFAULT_WATER_PARAMETERS.waveSpeed,
  worldSize = DEFAULT_WATER_PARAMETERS.worldSize,
}) {
  const cells = Math.max(1, resolution - 1);
  const dx = worldSize.x / cells;
  const dz = worldSize.y / cells;
  const courantX = (waveSpeed * fixedTimeStep) / dx;
  const courantZ = (waveSpeed * fixedTimeStep) / dz;
  return Math.hypot(courantX, courantZ);
}

export function waterGridUvForWorldCoordinate(worldCoordinate, worldExtent, resolution) {
  if (!Number.isFinite(worldCoordinate) || !Number.isFinite(worldExtent) || worldExtent <= 0) {
    throw new Error("Grid/world coordinates require a finite coordinate and positive finite extent.");
  }
  if (!Number.isInteger(resolution) || resolution < 2) {
    throw new Error(`Grid resolution must be an integer >= 2; got ${resolution}.`);
  }

  const gridIndex = (worldCoordinate / worldExtent + 0.5) * (resolution - 1);
  return (gridIndex + 0.5) / resolution;
}

export function waterGridWorldCoordinateForUv(uvCoordinate, worldExtent, resolution) {
  if (!Number.isFinite(uvCoordinate) || !Number.isFinite(worldExtent) || worldExtent <= 0) {
    throw new Error("Grid/UV coordinates require a finite coordinate and positive finite extent.");
  }
  if (!Number.isInteger(resolution) || resolution < 2) {
    throw new Error(`Grid resolution must be an integer >= 2; got ${resolution}.`);
  }

  const gridIndex = uvCoordinate * resolution - 0.5;
  return (gridIndex / (resolution - 1) - 0.5) * worldExtent;
}

export function validateWaterConfig({
  tier = WATER_QUALITY_TIERS.high,
  parameters = DEFAULT_WATER_PARAMETERS,
  textureCount = 4,
  storageBudgetBytes = 64 * 1024 * 1024,
} = {}) {
  const resolution = tier.resolution;
  const fixedTimeStep = tier.fixedTimeStep;
  const maxCourant = WATER_CFL_LIMIT;
  const worldSize = parameters.worldSize ?? DEFAULT_WATER_PARAMETERS.worldSize;
  const waveSpeed = parameters.waveSpeed ?? DEFAULT_WATER_PARAMETERS.waveSpeed;
  const dampingRatePerSecond = parameters.dampingRatePerSecond ?? DEFAULT_WATER_PARAMETERS.dampingRatePerSecond;
  const boundaryFadeCells = parameters.boundaryFadeCells ?? DEFAULT_WATER_PARAMETERS.boundaryFadeCells;
  const impulseHistoryDecayRatePerSecond = parameters.impulseHistoryDecayRatePerSecond ?? DEFAULT_WATER_PARAMETERS.impulseHistoryDecayRatePerSecond;
  const causticFootprintAreaEpsilonMeters2 = parameters.causticFootprintAreaEpsilonMeters2 ?? DEFAULT_WATER_PARAMETERS.causticFootprintAreaEpsilonMeters2;
  validateFiniteWaterParameters(parameters);
  const courant = waterCourantNumber({ resolution, fixedTimeStep, waveSpeed, worldSize });

  if (!Number.isInteger(resolution) || resolution < 16) {
    throw new Error(`Water resolution must be an integer >= 16; got ${resolution}.`);
  }

  if (!Number.isFinite(fixedTimeStep) || fixedTimeStep <= 0) {
    throw new Error(`Water fixedTimeStep must be positive and finite; got ${fixedTimeStep}.`);
  }

  if (!Number.isFinite(waveSpeed) || waveSpeed <= 0) {
    throw new Error(`Water waveSpeed must be positive and finite; got ${waveSpeed}.`);
  }

  if (!Number.isFinite(dampingRatePerSecond) || dampingRatePerSecond < 0) {
    throw new Error(`Water dampingRatePerSecond must be finite and non-negative; got ${dampingRatePerSecond}.`);
  }

  if (!Number.isFinite(impulseHistoryDecayRatePerSecond) || impulseHistoryDecayRatePerSecond < 0) {
    throw new Error(`Water impulseHistoryDecayRatePerSecond must be finite and non-negative; got ${impulseHistoryDecayRatePerSecond}.`);
  }

  if (!Number.isFinite(boundaryFadeCells) || boundaryFadeCells <= 0 || boundaryFadeCells * 2 >= resolution - 1) {
    throw new Error(`Water boundaryFadeCells must be positive and leave a non-empty interior; got ${boundaryFadeCells}.`);
  }

  if (!Number.isFinite(causticFootprintAreaEpsilonMeters2) || causticFootprintAreaEpsilonMeters2 <= 0) {
    throw new Error(`Water causticFootprintAreaEpsilonMeters2 must be finite and positive; got ${causticFootprintAreaEpsilonMeters2}.`);
  }

  if (!Number.isInteger(tier.meshSegments) || tier.meshSegments < 1) {
    throw new Error(`Water meshSegments must be a positive integer; got ${tier.meshSegments}.`);
  }

  if (!Number.isInteger(tier.linearWorkgroupSize) || tier.linearWorkgroupSize < 1 || tier.linearWorkgroupSize > 256) {
    throw new Error(`Water linearWorkgroupSize must be an integer in [1, 256]; got ${tier.linearWorkgroupSize}.`);
  }

  if (!(worldSize instanceof Vector2) || worldSize.x <= 0 || worldSize.y <= 0) {
    throw new Error("Water worldSize must be a positive Vector2.");
  }

  if (courant > maxCourant) {
    throw new Error(`Water CFL/Courant violation: ${courant.toFixed(4)} > ${maxCourant.toFixed(4)}.`);
  }

  const storageBytes = waterStorageBytes(resolution, textureCount);
  const persistentBytes = boundedWaterPersistentBytes(resolution);
  const causticQuantization = boundedCausticQuantizationContract(resolution);

  if (storageBytes > storageBudgetBytes) {
    throw new Error(`Water storage budget exceeded: ${storageBytes} > ${storageBudgetBytes} bytes.`);
  }

  const dropA = seededDropSequence(17, 2, parameters);
  const dropB = seededDropSequence(17, 2, parameters);

  if (JSON.stringify(dropA) !== JSON.stringify(dropB)) {
    throw new Error("Seeded water drop sequence is not deterministic.");
  }

  const analyticHeight = analyticSurfaceHeightAt(0.25, -0.5, 0.75);

  if (!Number.isFinite(analyticHeight) || Math.abs(analyticHeight) > 2) {
    throw new Error(`Analytic water height sanity check failed: ${analyticHeight}.`);
  }

  return {
    pass: true,
    resolution,
    fixedTimeStep,
    waveSpeed,
    courant,
    maxCourant,
    storageBytes,
    persistentBytes,
    textureCount,
    causticQuantization,
  };
}

export function seededUnit(seed, index) {
  let x = (seed >>> 0) + Math.imul(index + 1, 0x9e3779b9);
  x ^= x >>> 16;
  x = Math.imul(x, 0x7feb352d);
  x ^= x >>> 15;
  x = Math.imul(x, 0x846ca68b);
  x ^= x >>> 16;
  return (x >>> 0) / 0x100000000;
}

export function seededDropSequence(seed, count, {
  radius = DEFAULT_WATER_PARAMETERS.dropRadius,
  strength = DEFAULT_WATER_PARAMETERS.dropStrength,
} = {}) {
  const drops = [];

  for (let i = 0; i < count; i += 1) {
    drops.push({
      x: seededUnit(seed, i * 4 + 0) * 2 - 1,
      z: seededUnit(seed, i * 4 + 1) * 2 - 1,
      radius,
      strength: strength * (seededUnit(seed, i * 4 + 2) * 0.5 + 0.75),
    });
  }

  return drops;
}

export function analyticSurfaceHeightAt(x, z, timeSeconds, waves = AUTHORED_WAVES) {
  let height = 0;

  for (const wave of waves) {
    const k = (Math.PI * 2) / wave.wavelength;
    const omega = Math.sqrt(9.81 * k);
    height += wave.amplitude *
      Math.sin(k * (wave.direction.x * x + wave.direction.y * z) - omega * timeSeconds);
  }

  return height;
}
