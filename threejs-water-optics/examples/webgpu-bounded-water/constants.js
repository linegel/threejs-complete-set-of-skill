import { Vector2, Vector3 } from "three/webgpu";

export const WATER_DEBUG_MODES = Object.freeze({
  final: 0,
  height: 1,
  velocity: 2,
  normals: 3,
  caustics: 4,
  refractionValidity: 5,
});

export const WATER_QUALITY_TIERS = Object.freeze({
  ultra: {
    resolution: 512,
    fixedTimeStep: 1 / 240,
    maxSubsteps: 4,
    workgroupSize: 8,
    analyticBands: 5,
    microBands: 4,
  },
  high: {
    resolution: 256,
    fixedTimeStep: 1 / 120,
    maxSubsteps: 3,
    workgroupSize: 8,
    analyticBands: 4,
    microBands: 3,
  },
  reduced: {
    resolution: 128,
    fixedTimeStep: 1 / 60,
    maxSubsteps: 2,
    workgroupSize: 8,
    analyticBands: 3,
    microBands: 0,
  },
});

// Authored identity carried from examples/analytic-wave-optics/water-system.js.
export const AUTHORED_WAVES = Object.freeze([
  Object.freeze({ direction: new Vector2(0.94, 0.32), amplitude: 0.38, wavelength: 28.0, steepness: 0.5 }),
  Object.freeze({ direction: new Vector2(-0.42, 0.91), amplitude: 0.24, wavelength: 18.0, steepness: 0.46 }),
  Object.freeze({ direction: new Vector2(0.78, -0.52), amplitude: 0.16, wavelength: 12.0, steepness: 0.42 }),
  Object.freeze({ direction: new Vector2(-0.35, -0.78), amplitude: 0.1, wavelength: 10.0, steepness: 0.35 }),
  Object.freeze({ direction: new Vector2(0.55, 0.62), amplitude: 0.06, wavelength: 9.5, steepness: 0.28 }),
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
  damping: 0.995,
  waveSpeed: 2.0,
  boundaryFadeCells: 3,
  dropRadius: 0.06,
  dropStrength: 0.12,
  objectRadius: 0.07,
  objectDisplacementScale: 0.6,
  causticEpsilon: 0.00025,
  causticMaxIntensity: 8.0,
  causticScale: 0.2,
  airIor: 1.0,
  waterIor: 1.333,
  absorptionPerMeter: new Vector3(0.20, 0.06, 0.02),
  fallbackDepthMeters: 4.0,
  refractionStrength: 0.085,
  roughness: 0.24,
  sunDirection: new Vector3(2, 2, -1).normalize(),
  deepBodyColor: new Vector3(0.005, 0.042, 0.115),
  shallowScatterColor: new Vector3(0.0, 0.27, 0.19),
  foamColor: new Vector3(0.9, 0.95, 1.0),
});

export function waterStorageBytes(resolution, textureCount = 3, bytesPerChannel = 2) {
  return resolution * resolution * 4 * bytesPerChannel * textureCount;
}

export function waterCourantNumber({
  resolution,
  fixedTimeStep,
  waveSpeed = DEFAULT_WATER_PARAMETERS.waveSpeed,
  worldSize = DEFAULT_WATER_PARAMETERS.worldSize,
}) {
  const cells = Math.max(1, resolution - 1);
  const dx = Math.min(worldSize.x, worldSize.y) / cells;
  return (waveSpeed * fixedTimeStep) / dx;
}

export function validateWaterConfig({
  tier = WATER_QUALITY_TIERS.high,
  parameters = DEFAULT_WATER_PARAMETERS,
  textureCount = 3,
  storageBudgetBytes = 64 * 1024 * 1024,
} = {}) {
  const resolution = tier.resolution;
  const fixedTimeStep = tier.fixedTimeStep;
  const maxCourant = 1 / Math.SQRT2;
  const worldSize = parameters.worldSize ?? DEFAULT_WATER_PARAMETERS.worldSize;
  const waveSpeed = parameters.waveSpeed ?? DEFAULT_WATER_PARAMETERS.waveSpeed;
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

  if (!(worldSize instanceof Vector2) || worldSize.x <= 0 || worldSize.y <= 0) {
    throw new Error("Water worldSize must be a positive Vector2.");
  }

  if (courant > maxCourant) {
    throw new Error(`Water CFL/Courant violation: ${courant.toFixed(4)} > ${maxCourant.toFixed(4)}.`);
  }

  const storageBytes = waterStorageBytes(resolution, textureCount);

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
    textureCount,
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
