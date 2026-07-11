import {
  Fn,
  abs as absNode,
  atan,
  bitcast,
  clamp as clampNode,
  cross as crossNode,
  dot as dotNode,
  exp,
  float,
  floor as floorNode,
  fract as fractNode,
  int,
  length as lengthNode,
  max as maxNode,
  mix,
  normalize as normalizeNode,
  pow as powNode,
  sign as signNode,
  smoothstep as smoothstepNode,
  uint,
  vec3,
  vec4,
} from "three/tsl";

import { BODY_PRESETS } from "./planet-config.js";
import {
  PLANET_FIELD_ALGORITHM,
  PLANET_PARITY_CHANNELS,
} from "./planet-field-constants.js";

const fract = (value) => value - Math.floor(value);
const smoothValue = (value) => value * value * (3 - 2 * value);
const lerp = (a, b, t) => a + (b - a) * t;
const clamp = (value, min = 0, max = 1) => Math.min(Math.max(value, min), max);
const f32 = (value) => Math.fround(value);
const smoothstep = (edge0, edge1, value) => {
  const t = clamp((value - edge0) / (edge1 - edge0));
  return t * t * (3 - 2 * t);
};
const smoothstepDerivative = (edge0, edge1, value) => {
  const t = clamp((value - edge0) / (edge1 - edge0));
  if (t <= 0 || t >= 1) return 0;
  return (6 * t * (1 - t)) / (edge1 - edge0);
};

// This is the CPU return schema. Only PLANET_PARITY_CHANNELS are packed by the
// optional WebGPU readback harness. Presence here is not GPU implementation or
// numeric-parity evidence.
export const CPU_PLANET_FIELD_SCHEMA_KEYS = Object.freeze([
  "height",
  "macroHeight",
  "ridge",
  "craterFloor",
  "craterWall",
  "craterRim",
  "ejecta",
  "ejectaStrength",
  "continent",
  "oceanDepth",
  "humidity",
  "temperature",
  "ruggednessProxy",
  "snow",
  "ice",
  "wetness",
  "biomeWeights",
  "biomeId",
  "roughnessCause",
  "atmosphereMask",
  "debugChannels",
  "heightDerivativeCandidate",
]);

// Compatibility name retained for callers. It still denotes CPU return-key
// coverage only; PLANET_FIELD_EVIDENCE is the machine-readable claim boundary.
export const PLANET_FIELD_SCHEMA_KEYS = CPU_PLANET_FIELD_SCHEMA_KEYS;

export const DEBUG_FIELD_KEYS = Object.freeze([
  "height",
  "macroHeight",
  "craterFloor",
  "craterWall",
  "craterRim",
  "ejectaStrength",
  "humidity",
  "temperature",
  "ruggednessProxy",
  "oceanDepth",
  "biomeWeights",
  "roughnessCause",
  "atmosphereMask",
]);

export const PLANET_FIELD_EVIDENCE = Object.freeze({
  hashConstants: "authored-identity-shared-by-cpu-and-tsl",
  cpuSchema: "executed-key-presence-only",
  cpuGoldenChannels: "executed-fixed-probe-regression",
  gpuParityChannels: "conditional-on-native-webgpu-readback-artifact",
  gpuParityExcludes: Object.freeze(
    CPU_PLANET_FIELD_SCHEMA_KEYS.filter((channel) =>
      !PLANET_PARITY_CHANNELS.includes(channel),
    ),
  ),
  derivativeCorrectness: "not-run-candidate-only",
});

export const DEFAULT_CRATER_STAMPS = Object.freeze([
  {
    centerDirection: normalize([0.82, 0.18, 0.54]),
    angularRadius: 0.075,
    floorDepth: 0.16,
    wallSlope: 0.7,
    rimHeight: 0.11,
    ejectaStrength: 0.5,
    age: 0.35,
    erosion: 0.18,
    seed: 19.7,
    priority: 3,
  },
  {
    centerDirection: normalize([-0.42, 0.71, 0.56]),
    angularRadius: 0.045,
    floorDepth: 0.09,
    wallSlope: 0.55,
    rimHeight: 0.07,
    ejectaStrength: 0.32,
    age: 0.72,
    erosion: 0.48,
    seed: 43.2,
    priority: 2,
  },
  {
    centerDirection: normalize([0.18, -0.62, -0.76]),
    angularRadius: 0.11,
    floorDepth: 0.2,
    wallSlope: 0.85,
    rimHeight: 0.16,
    ejectaStrength: 0.62,
    age: 0.22,
    erosion: 0.12,
    seed: 87.4,
    priority: 4,
  },
]);

export function dot(a, b) {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
}

function add(a, b) {
  return [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
}

function scale(a, scalar) {
  return [a[0] * scalar, a[1] * scalar, a[2] * scalar];
}

function cross(a, b) {
  return [
    a[1] * b[2] - a[2] * b[1],
    a[2] * b[0] - a[0] * b[2],
    a[0] * b[1] - a[1] * b[0],
  ];
}

export function length(a) {
  return Math.hypot(a[0], a[1], a[2]);
}

export function normalize(a) {
  const len = length(a);
  if (len === 0) return [0, 1, 0];
  return [a[0] / len, a[1] / len, a[2] / len];
}

export function tangentBasis(surfaceDirection) {
  const radial = normalize(surfaceDirection);
  const reference = Math.abs(radial[1]) < 0.98 ? [0, 1, 0] : [1, 0, 0];
  const xTangent = normalize(cross(reference, radial));
  const yTangent = normalize(cross(radial, xTangent));
  return { radial, xTangent, yTangent };
}

function hash3(x, y, z, seed) {
  const { latticeMultipliers, seedMultiplier, outputScale } = PLANET_FIELD_ALGORITHM.hash;
  const h =
    u32Mul(latticeCoordToU32(x), latticeMultipliers[0]) ^
    u32Mul(latticeCoordToU32(y), latticeMultipliers[1]) ^
    u32Mul(latticeCoordToU32(z), latticeMultipliers[2]) ^
    u32Mul(seedToU32(seed), seedMultiplier);
  return Math.fround(Math.fround(lowbias32(h)) * outputScale);
}

function latticeCoordToU32(value) {
  return (Math.floor(value) | 0) >>> 0;
}

function seedToU32(seed) {
  return (Math.floor(seed) | 0) >>> 0;
}

function u32Mul(a, b) {
  return Math.imul(a >>> 0, b >>> 0) >>> 0;
}

function lowbias32(value) {
  const { mixMultipliers, mixShifts } = PLANET_FIELD_ALGORITHM.hash;
  let h = value >>> 0;
  h = (h ^ (h >>> mixShifts[0])) >>> 0;
  h = u32Mul(h, mixMultipliers[0]);
  h = (h ^ (h >>> mixShifts[1])) >>> 0;
  h = u32Mul(h, mixMultipliers[1]);
  h = (h ^ (h >>> mixShifts[2])) >>> 0;
  return h >>> 0;
}

function valueNoise3(x, y, z, seed) {
  const xf = Math.fround(x);
  const yf = Math.fround(y);
  const zf = Math.fround(z);
  const x0 = Math.floor(xf);
  const y0 = Math.floor(yf);
  const z0 = Math.floor(zf);
  const tx = smoothValue(fract(xf));
  const ty = smoothValue(fract(yf));
  const tz = smoothValue(fract(zf));
  const n000 = hash3(x0, y0, z0, seed);
  const n100 = hash3(x0 + 1, y0, z0, seed);
  const n010 = hash3(x0, y0 + 1, z0, seed);
  const n110 = hash3(x0 + 1, y0 + 1, z0, seed);
  const n001 = hash3(x0, y0, z0 + 1, seed);
  const n101 = hash3(x0 + 1, y0, z0 + 1, seed);
  const n011 = hash3(x0, y0 + 1, z0 + 1, seed);
  const n111 = hash3(x0 + 1, y0 + 1, z0 + 1, seed);
  const nx00 = lerp(n000, n100, tx);
  const nx10 = lerp(n010, n110, tx);
  const nx01 = lerp(n001, n101, tx);
  const nx11 = lerp(n011, n111, tx);
  return lerp(lerp(nx00, nx10, ty), lerp(nx01, nx11, ty), tz);
}

function valueNoise3WithGradient(x, y, z, seed) {
  const xf = Math.fround(x);
  const yf = Math.fround(y);
  const zf = Math.fround(z);
  const x0 = Math.floor(xf);
  const y0 = Math.floor(yf);
  const z0 = Math.floor(zf);
  const fx = fract(xf);
  const fy = fract(yf);
  const fz = fract(zf);
  const tx = smoothValue(fx);
  const ty = smoothValue(fy);
  const tz = smoothValue(fz);
  const dtx = 6 * fx * (1 - fx);
  const dty = 6 * fy * (1 - fy);
  const dtz = 6 * fz * (1 - fz);
  const n000 = hash3(x0, y0, z0, seed);
  const n100 = hash3(x0 + 1, y0, z0, seed);
  const n010 = hash3(x0, y0 + 1, z0, seed);
  const n110 = hash3(x0 + 1, y0 + 1, z0, seed);
  const n001 = hash3(x0, y0, z0 + 1, seed);
  const n101 = hash3(x0 + 1, y0, z0 + 1, seed);
  const n011 = hash3(x0, y0 + 1, z0 + 1, seed);
  const n111 = hash3(x0 + 1, y0 + 1, z0 + 1, seed);
  const nx00 = lerp(n000, n100, tx);
  const nx10 = lerp(n010, n110, tx);
  const nx01 = lerp(n001, n101, tx);
  const nx11 = lerp(n011, n111, tx);
  const nxy0 = lerp(nx00, nx10, ty);
  const nxy1 = lerp(nx01, nx11, ty);
  return {
    value: lerp(nxy0, nxy1, tz),
    gradient: [
      lerp(lerp(n100 - n000, n110 - n010, ty), lerp(n101 - n001, n111 - n011, ty), tz) * dtx,
      lerp(lerp(n010 - n000, n110 - n100, tx), lerp(n011 - n001, n111 - n101, tx), tz) * dty,
      (nxy1 - nxy0) * dtz,
    ],
  };
}

function fbmNoise3(x, y, z, seed, octaves, lacunarity, gain) {
  let amplitude = 0.5;
  let frequency = 1;
  let value = 0;
  for (let index = 0; index < octaves; index += 1) {
    value +=
      valueNoise3(
        x * frequency,
        y * frequency,
        z * frequency,
        seed + index * PLANET_FIELD_ALGORITHM.hash.octaveSeedStep,
      ) * amplitude;
    frequency *= lacunarity;
    amplitude *= gain;
  }
  return value;
}

function fbmNoise3WithGradient(x, y, z, seed, octaves, lacunarity, gain) {
  let amplitude = 0.5;
  let frequency = 1;
  let value = 0;
  let gradient = [0, 0, 0];
  for (let index = 0; index < octaves; index += 1) {
    const octave = valueNoise3WithGradient(
      x * frequency,
      y * frequency,
      z * frequency,
      seed + index * PLANET_FIELD_ALGORITHM.hash.octaveSeedStep,
    );
    value += octave.value * amplitude;
    gradient = add(gradient, scale(octave.gradient, amplitude * frequency));
    frequency *= lacunarity;
    amplitude *= gain;
  }
  return { value, gradient };
}

export function craterStamp(surfaceDirection, crater) {
  const cosine = clamp(dot(surfaceDirection, crater.centerDirection), -1, 1);
  const sine = length(cross(surfaceDirection, crater.centerDirection));
  const angularDistance = Math.atan2(sine, cosine);
  const d = angularDistance / crater.angularRadius;
  const floorEdge = 0.38;
  const rimInner = 0.72;
  const rimOuter = 1.12;
  const floor = (1 - smoothstep(0, floorEdge, d)) * (1 - crater.erosion);
  const wall =
    smoothstep(floorEdge, rimInner, d) *
    (1 - smoothstep(rimInner, rimOuter, d)) *
    crater.wallSlope *
    (1 - crater.erosion * 0.45);
  const rimCenter = 0.92;
  const rimWidth = 0.16 + crater.erosion * 0.18;
  const rim =
    Math.exp(-Math.pow((d - rimCenter) / rimWidth, 2)) *
    crater.rimHeight *
    (1 - crater.erosion);
  const rayNoise = valueNoise3(
    surfaceDirection[0] * 36,
    surfaceDirection[1] * 36,
    surfaceDirection[2] * 36,
    crater.seed,
  );
  const ejecta =
    crater.ejectaStrength *
    Math.pow(1 - clamp((d - 0.8) / 2.5), 2) *
    smoothstep(0.65, 1.05, d) *
    (0.35 + rayNoise * 0.65) *
    (1 - crater.age * 0.55);
  return {
    craterFloor: floor * crater.floorDepth,
    craterWall: wall,
    craterRim: rim,
    ejectaStrength: ejecta,
    ejecta: ejecta,
    age: crater.age,
    erosion: crater.erosion,
    overlapPriority: crater.priority,
  };
}

function craterStampWithGradient(surfaceDirection, crater, basis) {
  const sample = craterStamp(surfaceDirection, crater);
  const cosine = clamp(dot(surfaceDirection, crater.centerDirection), -1, 1);
  const crossValue = cross(surfaceDirection, crater.centerDirection);
  const sinTheta = length(crossValue);
  const angularDistance = Math.atan2(sinTheta, cosine);
  const d = angularDistance / crater.angularRadius;
  const floorEdge = 0.38;
  const rimInner = 0.72;
  const rimOuter = 1.12;
  const rimCenter = 0.92;
  const rimWidth = 0.16 + crater.erosion * 0.18;
  const rayNoise = valueNoise3WithGradient(
    surfaceDirection[0] * 36,
    surfaceDirection[1] * 36,
    surfaceDirection[2] * 36,
    crater.seed,
  );
  const falloffInput = clamp((d - 0.8) / 2.5);
  const falloff = Math.pow(1 - falloffInput, 2);
  const falloffDerivative =
    falloffInput <= 0 || falloffInput >= 1 ? 0 : (-2 * (1 - falloffInput)) / 2.5;
  const gate = smoothstep(0.65, 1.05, d);
  const gateDerivative = smoothstepDerivative(0.65, 1.05, d);
  const noiseTerm = 0.35 + rayNoise.value * 0.65;
  const ageTerm = 1 - crater.age * 0.55;
  const gradient = [basis.xTangent, basis.yTangent].map((tangent) => {
    const cosineDerivative = dot(tangent, crater.centerDirection);
    const sineDerivative = sinTheta > 1e-7
      ? dot(crossValue, cross(tangent, crater.centerDirection)) / sinTheta
      : 0;
    // atan2(s, c) remains well-conditioned near theta=0 and pi. The angular
    // distance is nondifferentiable at exact coincidence/antipode, where this
    // fixture deliberately selects the zero subgradient.
    const angularDerivative = sinTheta > 1e-7
      ? (cosine * sineDerivative - sinTheta * cosineDerivative) /
        (cosine * cosine + sinTheta * sinTheta)
      : 0;
    const dDerivative = angularDerivative / crater.angularRadius;
    const floorDerivative =
      -smoothstepDerivative(0, floorEdge, d) * (1 - crater.erosion) * crater.floorDepth;
    const wallA = smoothstep(floorEdge, rimInner, d);
    const wallB = smoothstep(rimInner, rimOuter, d);
    const wallDerivative =
      (smoothstepDerivative(floorEdge, rimInner, d) * (1 - wallB) -
        wallA * smoothstepDerivative(rimInner, rimOuter, d)) *
      crater.wallSlope *
      (1 - crater.erosion * 0.45);
    const rimDerivative =
      sample.craterRim * (-2 * (d - rimCenter)) / (rimWidth * rimWidth);
    const rayNoiseDerivative = dot(rayNoise.gradient, scale(tangent, 36));
    const ejectaDerivative =
      crater.ejectaStrength *
      ageTerm *
      ((falloffDerivative * gate + falloff * gateDerivative) * noiseTerm * dDerivative +
        falloff * gate * rayNoiseDerivative * 0.65);
    return {
      craterFloor: floorDerivative * dDerivative,
      craterWall: wallDerivative * dDerivative,
      craterRim: rimDerivative * dDerivative,
      ejectaStrength: ejectaDerivative,
    };
  });
  return { sample, gradient };
}

export function aggregateCraters(surfaceDirection, craters = DEFAULT_CRATER_STAMPS) {
  const total = {
    craterFloor: 0,
    craterWall: 0,
    craterRim: 0,
    ejectaStrength: 0,
    ejecta: 0,
    age: 0,
    erosion: 0,
    overlapPriority: 0,
  };
  for (const crater of craters) {
    const sample = craterStamp(surfaceDirection, crater);
    const priorityWeight = sample.overlapPriority + sample.craterFloor + sample.craterRim;
    if (priorityWeight >= total.overlapPriority) {
      total.age = sample.age;
      total.erosion = sample.erosion;
      total.overlapPriority = priorityWeight;
    }
    total.craterFloor += sample.craterFloor;
    total.craterWall += sample.craterWall;
    total.craterRim += sample.craterRim;
    total.ejectaStrength += sample.ejectaStrength;
    total.ejecta += sample.ejecta;
  }
  return total;
}

function aggregateCratersWithGradient(surfaceDirection, craters, basis) {
  const total = {
    craterFloor: 0,
    craterWall: 0,
    craterRim: 0,
    ejectaStrength: 0,
    ejecta: 0,
    age: 0,
    erosion: 0,
    overlapPriority: 0,
  };
  const gradient = [
    { craterFloor: 0, craterWall: 0, craterRim: 0, ejectaStrength: 0 },
    { craterFloor: 0, craterWall: 0, craterRim: 0, ejectaStrength: 0 },
  ];
  for (const crater of craters) {
    const { sample, gradient: sampleGradient } = craterStampWithGradient(surfaceDirection, crater, basis);
    const priorityWeight = sample.overlapPriority + sample.craterFloor + sample.craterRim;
    if (priorityWeight >= total.overlapPriority) {
      total.age = sample.age;
      total.erosion = sample.erosion;
      total.overlapPriority = priorityWeight;
    }
    total.craterFloor += sample.craterFloor;
    total.craterWall += sample.craterWall;
    total.craterRim += sample.craterRim;
    total.ejectaStrength += sample.ejectaStrength;
    total.ejecta += sample.ejecta;
    for (const axis of [0, 1]) {
      gradient[axis].craterFloor += sampleGradient[axis].craterFloor;
      gradient[axis].craterWall += sampleGradient[axis].craterWall;
      gradient[axis].craterRim += sampleGradient[axis].craterRim;
      gradient[axis].ejectaStrength += sampleGradient[axis].ejectaStrength;
    }
  }
  return { crater: total, gradient };
}

function terrainDerivativeAlongTangent({
  surfaceDirection,
  tangent,
  baseFrequency,
  seedBase,
  warp,
  warpDot,
  qGradient,
}) {
  const { noiseScale, strength, seedOffsets } = PLANET_FIELD_ALGORITHM.tangentWarp;
  const scaledTangent = scale(tangent, baseFrequency);
  const warpGradients = [
    valueNoise3WithGradient(
      surfaceDirection[0] * baseFrequency * noiseScale + seedBase,
      surfaceDirection[1] * baseFrequency * noiseScale,
      surfaceDirection[2] * baseFrequency * noiseScale,
      seedBase + seedOffsets[0],
    ).gradient,
    valueNoise3WithGradient(
      surfaceDirection[0] * baseFrequency * noiseScale,
      surfaceDirection[1] * baseFrequency * noiseScale + seedBase,
      surfaceDirection[2] * baseFrequency * noiseScale,
      seedBase + seedOffsets[1],
    ).gradient,
    valueNoise3WithGradient(
      surfaceDirection[0] * baseFrequency * noiseScale,
      surfaceDirection[1] * baseFrequency * noiseScale,
      surfaceDirection[2] * baseFrequency * noiseScale + seedBase,
      seedBase + seedOffsets[2],
    ).gradient,
  ];
  const warpDerivative = warpGradients.map((gradient) =>
    dot(gradient, scale(scaledTangent, noiseScale)),
  );
  const warpDotDerivative = dot(warpDerivative, surfaceDirection) + dot(warp, tangent);
  const tangentWarpDerivative = [
    warpDerivative[0] - tangent[0] * warpDot - surfaceDirection[0] * warpDotDerivative,
    warpDerivative[1] - tangent[1] * warpDot - surfaceDirection[1] * warpDotDerivative,
    warpDerivative[2] - tangent[2] * warpDot - surfaceDirection[2] * warpDotDerivative,
  ];
  const qDerivative = add(scaledTangent, scale(tangentWarpDerivative, strength));
  return dot(qGradient, qDerivative);
}

export function planetFields(
  directionInput,
  {
    preset = BODY_PRESETS.pelagia,
    seed = 31.731,
    craters = DEFAULT_CRATER_STAMPS.slice(0, preset.craterCount ?? 3),
  } = {},
) {
  const surfaceDirection = normalize(directionInput);
  const basis = tangentBasis(surfaceDirection);
  const seedBase = f32(f32(seed) * f32(97.113));
  const baseFrequency = f32(
    preset.kind === "rocky"
      ? PLANET_FIELD_ALGORITHM.baseFrequency.rocky
      : PLANET_FIELD_ALGORITHM.baseFrequency.default,
  );
  const x = f32(f32(surfaceDirection[0]) * baseFrequency);
  const y = f32(f32(surfaceDirection[1]) * baseFrequency);
  const z = f32(f32(surfaceDirection[2]) * baseFrequency);
  const { noiseScale, strength, seedOffsets } = PLANET_FIELD_ALGORITHM.tangentWarp;
  const warp = [
    f32(valueNoise3(f32(f32(x * noiseScale) + seedBase), f32(y * noiseScale), f32(z * noiseScale), f32(seedBase + seedOffsets[0])) - 0.5),
    f32(valueNoise3(f32(x * noiseScale), f32(f32(y * noiseScale) + seedBase), f32(z * noiseScale), f32(seedBase + seedOffsets[1])) - 0.5),
    f32(valueNoise3(f32(x * noiseScale), f32(y * noiseScale), f32(f32(z * noiseScale) + seedBase), f32(seedBase + seedOffsets[2])) - 0.5),
  ];
  const warpDot = f32(dot(warp, surfaceDirection));
  const tangentWarp = [
    f32(warp[0] - f32(surfaceDirection[0] * warpDot)),
    f32(warp[1] - f32(surfaceDirection[1] * warpDot)),
    f32(warp[2] - f32(surfaceDirection[2] * warpDot)),
  ];
  const q = [
    f32(x + f32(tangentWarp[0] * strength)),
    f32(y + f32(tangentWarp[1] * strength)),
    f32(z + f32(tangentWarp[2] * strength)),
  ];
  const continentalSample = fbmNoise3WithGradient(
    q[0] * PLANET_FIELD_ALGORITHM.fbm.continental.scale,
    q[1] * PLANET_FIELD_ALGORITHM.fbm.continental.scale,
    q[2] * PLANET_FIELD_ALGORITHM.fbm.continental.scale,
    seedBase + PLANET_FIELD_ALGORITHM.fbm.continental.seedOffset,
    PLANET_FIELD_ALGORITHM.fbm.continental.octaves,
    PLANET_FIELD_ALGORITHM.fbm.continental.lacunarity,
    PLANET_FIELD_ALGORITHM.fbm.continental.gain,
  );
  const highlandsSample = fbmNoise3WithGradient(
    q[0] * PLANET_FIELD_ALGORITHM.fbm.highlands.scale,
    q[1] * PLANET_FIELD_ALGORITHM.fbm.highlands.scale,
    q[2] * PLANET_FIELD_ALGORITHM.fbm.highlands.scale,
    seedBase + PLANET_FIELD_ALGORITHM.fbm.highlands.seedOffset,
    PLANET_FIELD_ALGORITHM.fbm.highlands.octaves,
    PLANET_FIELD_ALGORITHM.fbm.highlands.lacunarity,
    PLANET_FIELD_ALGORITHM.fbm.highlands.gain,
  );
  const ridgedSample = fbmNoise3WithGradient(
    q[0] * PLANET_FIELD_ALGORITHM.fbm.ridged.scale,
    q[1] * PLANET_FIELD_ALGORITHM.fbm.ridged.scale,
    q[2] * PLANET_FIELD_ALGORITHM.fbm.ridged.scale,
    seedBase + PLANET_FIELD_ALGORITHM.fbm.ridged.seedOffset,
    PLANET_FIELD_ALGORITHM.fbm.ridged.octaves,
    PLANET_FIELD_ALGORITHM.fbm.ridged.lacunarity,
    PLANET_FIELD_ALGORITHM.fbm.ridged.gain,
  );
  const continental = continentalSample.value;
  const highlands = highlandsSample.value;
  const ridgedBase = ridgedSample.value;
  const ridge = 1 - Math.abs(ridgedBase * 2 - 1);
  const latitudeTerm = (0.35 - Math.abs(surfaceDirection[1])) * 0.08;
  const macroRaw =
    (continental * PLANET_FIELD_ALGORITHM.heightWeights.continental +
      highlands * PLANET_FIELD_ALGORITHM.heightWeights.highlands +
      ridge * PLANET_FIELD_ALGORITHM.heightWeights.ridge +
      latitudeTerm) *
      2 -
    1;
  const macroHeight = clamp(
    macroRaw,
    -1,
    1,
  );
  const { crater, gradient: craterGradient } = aggregateCratersWithGradient(surfaceDirection, craters, basis);
  const continent = clamp(continental * 0.72 + macroHeight * 0.18 + ridge * 0.1);
  const heightRaw =
    macroHeight -
    crater.craterFloor * 0.75 -
    crater.craterWall * 0.08 +
    crater.craterRim * 0.9 +
    crater.ejectaStrength * 0.08;
  const height = clamp(
    heightRaw,
    -1,
    1,
  );
  const ridgeDerivativeFactor = ridgedBase * 2 - 1 === 0 ? 0 : -2 * Math.sign(ridgedBase * 2 - 1);
  const qGradient = add(
    add(
      scale(continentalSample.gradient, PLANET_FIELD_ALGORITHM.heightWeights.continental * PLANET_FIELD_ALGORITHM.fbm.continental.scale),
      scale(highlandsSample.gradient, PLANET_FIELD_ALGORITHM.heightWeights.highlands * PLANET_FIELD_ALGORITHM.fbm.highlands.scale),
    ),
    scale(
      ridgedSample.gradient,
      PLANET_FIELD_ALGORITHM.heightWeights.ridge *
        ridgeDerivativeFactor *
        PLANET_FIELD_ALGORITHM.fbm.ridged.scale,
    ),
  );
  const heightDerivativeCandidate = [basis.xTangent, basis.yTangent].map((tangent, axis) => {
    const terrainDerivative =
      macroRaw <= -1 || macroRaw >= 1
        ? 0
        : 2 *
          (terrainDerivativeAlongTangent({
            surfaceDirection,
            tangent,
            baseFrequency,
            seedBase,
            warp,
            warpDot,
            qGradient,
          }) -
            Math.sign(surfaceDirection[1] || 1) * tangent[1] * PLANET_FIELD_ALGORITHM.heightWeights.latitude);
    const craterDerivative =
      PLANET_FIELD_ALGORITHM.heightWeights.craterFloor * craterGradient[axis].craterFloor +
      PLANET_FIELD_ALGORITHM.heightWeights.craterWall * craterGradient[axis].craterWall +
      PLANET_FIELD_ALGORITHM.heightWeights.craterRim * craterGradient[axis].craterRim +
      PLANET_FIELD_ALGORITHM.heightWeights.ejectaStrength * craterGradient[axis].ejectaStrength;
    return heightRaw <= -1 || heightRaw >= 1 ? 0 : terrainDerivative + craterDerivative;
  });
  const oceanDepth = clamp(preset.seaLevel - height);
  const humidity = clamp(
    valueNoise3(q[0] * 0.22, q[1] * 0.22, q[2] * 0.22, seedBase + 63.1) * 0.65 +
      valueNoise3(q[0] * 0.75, q[1] * 0.75, q[2] * 0.75, seedBase + 79.3) * 0.35 +
      preset.humidityBias,
  );
  const temperature = clamp(
    (1 - Math.pow(Math.abs(surfaceDirection[1]), 1.35)) * 0.85 +
      0.15 -
      height * 0.32 +
      preset.temperatureBias,
  );
  const ruggednessProxy = clamp(ridge * 0.45 + crater.craterWall * 0.35 + Math.abs(height - macroHeight) * 0.2);
  const snow = smoothstep(0.58, 0.88, Math.abs(surfaceDirection[1]) + height * 0.35 - temperature * 0.18);
  const ice = smoothstep(0.52, 0.9, snow + oceanDepth * (1 - temperature));
  const arid = smoothstep(0.46, 0.78, (1 - humidity) * temperature - height * 0.08);
  const lush = smoothstep(0.36, 0.72, humidity * temperature - arid * 0.35 - ruggednessProxy * 0.8);
  const rock = smoothstep(0.08, 0.3, ruggednessProxy + Math.max(height, 0) * 0.28);
  const wetness = clamp(oceanDepth + humidity * 0.35 + lush * 0.2);
  const biomeWeights = {
    ocean: oceanDepth,
    lush,
    arid,
    rock,
    snow,
    ice,
  };
  const biomeEntries = Object.entries(biomeWeights);
  const biomeId = biomeEntries.reduce(
    (best, [name, weight], index) => (weight > best.weight ? { id: index, name, weight } : best),
    { id: 0, name: "ocean", weight: -Infinity },
  ).id;
  const roughnessCause = clamp(ruggednessProxy * 0.4 + crater.ejectaStrength * 0.28 + rock * 0.22);
  const atmosphereMask = clamp(1 - oceanDepth * 0.2 + wetness * 0.1);
  return {
    height,
    macroHeight,
    ridge,
    craterFloor: crater.craterFloor,
    craterWall: crater.craterWall,
    craterRim: crater.craterRim,
    ejecta: crater.ejecta,
    ejectaStrength: crater.ejectaStrength,
    continent,
    oceanDepth,
    humidity,
    temperature,
    ruggednessProxy,
    snow,
    ice,
    wetness,
    biomeWeights,
    biomeId,
    roughnessCause,
    atmosphereMask,
    heightDerivativeCandidate,
    debugChannels: {
      tangentialWarpMagnitude: length(tangentWarp),
      craterAge: crater.age,
      craterErosion: crater.erosion,
      overlap: crater.overlapPriority,
    },
  };
}

function latticeCoordToU32Node(value) {
  return bitcast(int(floorNode(value)), "uint");
}

function seedToU32Node(seed) {
  return bitcast(int(floorNode(seed)), "uint");
}

function lowbias32Node(value) {
  const { mixMultipliers, mixShifts } = PLANET_FIELD_ALGORITHM.hash;
  let h = uint(value);
  h = h.bitXor(h.shiftRight(uint(mixShifts[0])));
  h = h.mul(uint(mixMultipliers[0]));
  h = h.bitXor(h.shiftRight(uint(mixShifts[1])));
  h = h.mul(uint(mixMultipliers[1]));
  h = h.bitXor(h.shiftRight(uint(mixShifts[2])));
  return h;
}

function hash3Node(cell, seed) {
  const { latticeMultipliers, seedMultiplier, outputScale } = PLANET_FIELD_ALGORITHM.hash;
  const h = latticeCoordToU32Node(cell.x)
    .mul(uint(latticeMultipliers[0]))
    .bitXor(latticeCoordToU32Node(cell.y).mul(uint(latticeMultipliers[1])))
    .bitXor(latticeCoordToU32Node(cell.z).mul(uint(latticeMultipliers[2])))
    .bitXor(seedToU32Node(seed).mul(uint(seedMultiplier)));
  return float(lowbias32Node(h)).mul(outputScale);
}

function valueNoise3Node(position, seed) {
  const cell = floorNode(position);
  const f = smoothValueNode(fractNode(position));
  const n000 = hash3Node(cell, seed);
  const n100 = hash3Node(cell.add(vec3(1, 0, 0)), seed);
  const n010 = hash3Node(cell.add(vec3(0, 1, 0)), seed);
  const n110 = hash3Node(cell.add(vec3(1, 1, 0)), seed);
  const n001 = hash3Node(cell.add(vec3(0, 0, 1)), seed);
  const n101 = hash3Node(cell.add(vec3(1, 0, 1)), seed);
  const n011 = hash3Node(cell.add(vec3(0, 1, 1)), seed);
  const n111 = hash3Node(cell.add(vec3(1, 1, 1)), seed);
  const nx00 = mix(n000, n100, f.x);
  const nx10 = mix(n010, n110, f.x);
  const nx01 = mix(n001, n101, f.x);
  const nx11 = mix(n011, n111, f.x);
  return mix(mix(nx00, nx10, f.y), mix(nx01, nx11, f.y), f.z);
}

function smoothValueNode(value) {
  return value.mul(value).mul(float(3).sub(value.mul(2)));
}

function smoothstepDerivativeNode(edge0, edge1, value) {
  const edgeSpan = float(edge1).sub(edge0);
  const t = clampNode(value.sub(edge0).div(edgeSpan), 0, 1);
  return t
    .lessThanEqual(0)
    .or(t.greaterThanEqual(1))
    .select(float(0), t.mul(6).mul(float(1).sub(t)).div(edgeSpan));
}

function valueNoise3WithGradientNode(position, seed) {
  const cell = floorNode(position);
  const f = fractNode(position);
  const tx = smoothValueNode(f.x);
  const ty = smoothValueNode(f.y);
  const tz = smoothValueNode(f.z);
  const dtx = f.x.mul(6).mul(float(1).sub(f.x));
  const dty = f.y.mul(6).mul(float(1).sub(f.y));
  const dtz = f.z.mul(6).mul(float(1).sub(f.z));
  const n000 = hash3Node(cell, seed);
  const n100 = hash3Node(cell.add(vec3(1, 0, 0)), seed);
  const n010 = hash3Node(cell.add(vec3(0, 1, 0)), seed);
  const n110 = hash3Node(cell.add(vec3(1, 1, 0)), seed);
  const n001 = hash3Node(cell.add(vec3(0, 0, 1)), seed);
  const n101 = hash3Node(cell.add(vec3(1, 0, 1)), seed);
  const n011 = hash3Node(cell.add(vec3(0, 1, 1)), seed);
  const n111 = hash3Node(cell.add(vec3(1, 1, 1)), seed);
  const nx00 = mix(n000, n100, tx);
  const nx10 = mix(n010, n110, tx);
  const nx01 = mix(n001, n101, tx);
  const nx11 = mix(n011, n111, tx);
  const nxy0 = mix(nx00, nx10, ty);
  const nxy1 = mix(nx01, nx11, ty);
  return {
    value: mix(nxy0, nxy1, tz),
    gradient: vec3(
      mix(mix(n100.sub(n000), n110.sub(n010), ty), mix(n101.sub(n001), n111.sub(n011), ty), tz).mul(dtx),
      mix(mix(n010.sub(n000), n110.sub(n100), tx), mix(n011.sub(n001), n111.sub(n101), tx), tz).mul(dty),
      nxy1.sub(nxy0).mul(dtz),
    ),
  };
}

function fbmNoise3WithGradientNode(position, seed, config) {
  let amplitude = 0.5;
  let frequency = 1;
  let value = float(0);
  let gradient = vec3(0, 0, 0);

  for (let index = 0; index < config.octaves; index += 1) {
    const octave = valueNoise3WithGradientNode(
      position.mul(frequency),
      seed.add(index * PLANET_FIELD_ALGORITHM.hash.octaveSeedStep),
    );
    value = value.add(octave.value.mul(amplitude));
    gradient = gradient.add(octave.gradient.mul(amplitude * frequency));
    frequency *= config.lacunarity;
    amplitude *= config.gain;
  }

  return { value, gradient };
}

function craterStampNode(surfaceDirection, crater) {
  const center = vec3(...crater.centerDirection);
  const cosine = clampNode(dotNode(surfaceDirection, center), -1, 1);
  const sine = lengthNode(crossNode(surfaceDirection, center));
  const angularDistance = atan(sine, cosine);
  const d = angularDistance.div(crater.angularRadius);
  const floorEdge = 0.38;
  const rimInner = 0.72;
  const rimOuter = 1.12;
  const floor = float(1)
    .sub(smoothstepNode(0, floorEdge, d))
    .mul(1 - crater.erosion);
  const wall = smoothstepNode(floorEdge, rimInner, d)
    .mul(float(1).sub(smoothstepNode(rimInner, rimOuter, d)))
    .mul(crater.wallSlope)
    .mul(1 - crater.erosion * 0.45);
  const rimCenter = 0.92;
  const rimWidth = 0.16 + crater.erosion * 0.18;
  const rim = exp(powNode(d.sub(rimCenter).div(rimWidth), 2).negate())
    .mul(crater.rimHeight)
    .mul(1 - crater.erosion);
  const rayNoise = valueNoise3Node(surfaceDirection.mul(36), float(crater.seed));
  const ejecta = float(crater.ejectaStrength)
    .mul(powNode(float(1).sub(clampNode(d.sub(0.8).div(2.5), 0, 1)), 2))
    .mul(smoothstepNode(0.65, 1.05, d))
    .mul(float(0.35).add(rayNoise.mul(0.65)))
    .mul(1 - crater.age * 0.55);
  return {
    craterFloor: floor.mul(crater.floorDepth),
    craterWall: wall,
    craterRim: rim,
    ejectaStrength: ejecta,
    ejecta,
  };
}

function craterStampWithGradientNode(surfaceDirection, crater, basis) {
  const sample = craterStampNode(surfaceDirection, crater);
  const center = vec3(...crater.centerDirection);
  const cosine = clampNode(dotNode(surfaceDirection, center), -1, 1);
  const crossValue = crossNode(surfaceDirection, center);
  const sinTheta = lengthNode(crossValue);
  const angularDistance = atan(sinTheta, cosine);
  const d = angularDistance.div(crater.angularRadius);
  const floorEdge = 0.38;
  const rimInner = 0.72;
  const rimOuter = 1.12;
  const rimCenter = 0.92;
  const rimWidth = 0.16 + crater.erosion * 0.18;
  const rayNoise = valueNoise3WithGradientNode(surfaceDirection.mul(36), float(crater.seed));
  const falloffInput = clampNode(d.sub(0.8).div(2.5), 0, 1);
  const falloff = powNode(float(1).sub(falloffInput), 2);
  const falloffDerivative = falloffInput
    .lessThanEqual(0)
    .or(falloffInput.greaterThanEqual(1))
    .select(float(0), float(-2).mul(float(1).sub(falloffInput)).div(2.5));
  const gate = smoothstepNode(0.65, 1.05, d);
  const gateDerivative = smoothstepDerivativeNode(0.65, 1.05, d);
  const noiseTerm = float(0.35).add(rayNoise.value.mul(0.65));
  const ageTerm = 1 - crater.age * 0.55;

  function gradientForTangent(tangent) {
    const cosineDerivative = dotNode(tangent, center);
    const sineDerivative = dotNode(crossValue, crossNode(tangent, center))
      .div(maxNode(sinTheta, 1e-7));
    const angularDerivative = sinTheta.lessThanEqual(1e-7).select(
      float(0),
      cosine
        .mul(sineDerivative)
        .sub(sinTheta.mul(cosineDerivative))
        .div(cosine.mul(cosine).add(sinTheta.mul(sinTheta))),
    );
    const dDerivative = angularDerivative.div(crater.angularRadius);
    const floorDerivative = smoothstepDerivativeNode(0, floorEdge, d)
      .negate()
      .mul(1 - crater.erosion)
      .mul(crater.floorDepth);
    const wallA = smoothstepNode(floorEdge, rimInner, d);
    const wallB = smoothstepNode(rimInner, rimOuter, d);
    const wallDerivative = smoothstepDerivativeNode(floorEdge, rimInner, d)
      .mul(float(1).sub(wallB))
      .sub(wallA.mul(smoothstepDerivativeNode(rimInner, rimOuter, d)))
      .mul(crater.wallSlope)
      .mul(1 - crater.erosion * 0.45);
    const rimDerivative = sample.craterRim.mul(-2).mul(d.sub(rimCenter)).div(rimWidth * rimWidth);
    const rayNoiseDerivative = dotNode(rayNoise.gradient, tangent.mul(36));
    const ejectaDerivative = float(crater.ejectaStrength)
      .mul(ageTerm)
      .mul(
        falloffDerivative
          .mul(gate)
          .add(falloff.mul(gateDerivative))
          .mul(noiseTerm)
          .mul(dDerivative)
          .add(falloff.mul(gate).mul(rayNoiseDerivative).mul(0.65)),
      );
    return {
      craterFloor: floorDerivative.mul(dDerivative),
      craterWall: wallDerivative.mul(dDerivative),
      craterRim: rimDerivative.mul(dDerivative),
      ejectaStrength: ejectaDerivative,
    };
  }

  return {
    sample,
    gradient: [gradientForTangent(basis.xTangent), gradientForTangent(basis.yTangent)],
  };
}

function aggregateCratersWithGradientNode(surfaceDirection, basis) {
  let crater = {
    craterFloor: float(0),
    craterWall: float(0),
    craterRim: float(0),
    ejectaStrength: float(0),
    ejecta: float(0),
  };
  const gradient = [
    { craterFloor: float(0), craterWall: float(0), craterRim: float(0), ejectaStrength: float(0) },
    { craterFloor: float(0), craterWall: float(0), craterRim: float(0), ejectaStrength: float(0) },
  ];

  for (const stamp of DEFAULT_CRATER_STAMPS) {
    const current = craterStampWithGradientNode(surfaceDirection, stamp, basis);
    crater = {
      craterFloor: crater.craterFloor.add(current.sample.craterFloor),
      craterWall: crater.craterWall.add(current.sample.craterWall),
      craterRim: crater.craterRim.add(current.sample.craterRim),
      ejectaStrength: crater.ejectaStrength.add(current.sample.ejectaStrength),
      ejecta: crater.ejecta.add(current.sample.ejecta),
    };
    for (const axis of [0, 1]) {
      gradient[axis] = {
        craterFloor: gradient[axis].craterFloor.add(current.gradient[axis].craterFloor),
        craterWall: gradient[axis].craterWall.add(current.gradient[axis].craterWall),
        craterRim: gradient[axis].craterRim.add(current.gradient[axis].craterRim),
        ejectaStrength: gradient[axis].ejectaStrength.add(current.gradient[axis].ejectaStrength),
      };
    }
  }

  return { crater, gradient };
}

function tangentBasisNode(surfaceDirection) {
  const radial = normalizeNode(surfaceDirection);
  const reference = absNode(radial.y).lessThan(0.98).select(vec3(0, 1, 0), vec3(1, 0, 0));
  const xTangent = normalizeNode(crossNode(reference, radial));
  const yTangent = normalizeNode(crossNode(radial, xTangent));
  return { radial, xTangent, yTangent };
}

function terrainDerivativeAlongTangentNode({
  surfaceDirection,
  tangent,
  baseFrequency,
  seedBase,
  warp,
  warpDot,
  qGradient,
}) {
  const { noiseScale, strength, seedOffsets } = PLANET_FIELD_ALGORITHM.tangentWarp;
  const scaledTangent = tangent.mul(baseFrequency);
  const base = surfaceDirection.mul(baseFrequency.mul(noiseScale));
  const warpGradients = [
    valueNoise3WithGradientNode(
      vec3(base.x.add(seedBase), base.y, base.z),
      seedBase.add(seedOffsets[0]),
    ).gradient,
    valueNoise3WithGradientNode(
      vec3(base.x, base.y.add(seedBase), base.z),
      seedBase.add(seedOffsets[1]),
    ).gradient,
    valueNoise3WithGradientNode(
      vec3(base.x, base.y, base.z.add(seedBase)),
      seedBase.add(seedOffsets[2]),
    ).gradient,
  ];
  const warpDerivative = vec3(
    dotNode(warpGradients[0], scaledTangent.mul(noiseScale)),
    dotNode(warpGradients[1], scaledTangent.mul(noiseScale)),
    dotNode(warpGradients[2], scaledTangent.mul(noiseScale)),
  );
  const warpDotDerivative = dotNode(warpDerivative, surfaceDirection).add(dotNode(warp, tangent));
  const tangentWarpDerivative = warpDerivative
    .sub(tangent.mul(warpDot))
    .sub(surfaceDirection.mul(warpDotDerivative));
  const qDerivative = scaledTangent.add(tangentWarpDerivative.mul(strength));
  return dotNode(qGradient, qDerivative);
}

export function planetFieldNodes({
  direction,
  seed,
  rocky,
  seaLevel,
  humidityBias,
  temperatureBias,
}) {
  const surfaceDirection = normalizeNode(direction);
  const basis = tangentBasisNode(surfaceDirection);
  const seedBase = seed.mul(97.113);
  const baseFrequency = mix(
    float(PLANET_FIELD_ALGORITHM.baseFrequency.default),
    float(PLANET_FIELD_ALGORITHM.baseFrequency.rocky),
    rocky,
  );
  const x = surfaceDirection.x.mul(baseFrequency);
  const y = surfaceDirection.y.mul(baseFrequency);
  const z = surfaceDirection.z.mul(baseFrequency);
  const { noiseScale, strength, seedOffsets } = PLANET_FIELD_ALGORITHM.tangentWarp;
  const warp = vec3(
    valueNoise3Node(vec3(x.mul(noiseScale).add(seedBase), y.mul(noiseScale), z.mul(noiseScale)), seedBase.add(seedOffsets[0])).sub(0.5),
    valueNoise3Node(vec3(x.mul(noiseScale), y.mul(noiseScale).add(seedBase), z.mul(noiseScale)), seedBase.add(seedOffsets[1])).sub(0.5),
    valueNoise3Node(vec3(x.mul(noiseScale), y.mul(noiseScale), z.mul(noiseScale).add(seedBase)), seedBase.add(seedOffsets[2])).sub(0.5),
  );
  const warpDot = dotNode(warp, surfaceDirection);
  const tangentWarp = warp.sub(surfaceDirection.mul(warpDot));
  const q = vec3(x, y, z).add(tangentWarp.mul(strength));
  const continentalSample = fbmNoise3WithGradientNode(
    q.mul(PLANET_FIELD_ALGORITHM.fbm.continental.scale),
    seedBase.add(PLANET_FIELD_ALGORITHM.fbm.continental.seedOffset),
    PLANET_FIELD_ALGORITHM.fbm.continental,
  );
  const highlandsSample = fbmNoise3WithGradientNode(
    q.mul(PLANET_FIELD_ALGORITHM.fbm.highlands.scale),
    seedBase.add(PLANET_FIELD_ALGORITHM.fbm.highlands.seedOffset),
    PLANET_FIELD_ALGORITHM.fbm.highlands,
  );
  const ridgedSample = fbmNoise3WithGradientNode(
    q.mul(PLANET_FIELD_ALGORITHM.fbm.ridged.scale),
    seedBase.add(PLANET_FIELD_ALGORITHM.fbm.ridged.seedOffset),
    PLANET_FIELD_ALGORITHM.fbm.ridged,
  );
  const continental = continentalSample.value;
  const highlands = highlandsSample.value;
  const ridgedBase = ridgedSample.value;
  const ridge = float(1).sub(absNode(ridgedBase.mul(2).sub(1)));
  const latitudeTerm = float(0.35).sub(absNode(surfaceDirection.y)).mul(0.08);
  const macroRaw = continental
    .mul(PLANET_FIELD_ALGORITHM.heightWeights.continental)
    .add(highlands.mul(PLANET_FIELD_ALGORITHM.heightWeights.highlands))
    .add(ridge.mul(PLANET_FIELD_ALGORITHM.heightWeights.ridge))
    .add(latitudeTerm)
    .mul(2)
    .sub(1);
  const macroHeight = clampNode(macroRaw, -1, 1);
  const { crater, gradient: craterGradient } = aggregateCratersWithGradientNode(surfaceDirection, basis);
  const heightRaw = macroHeight
    .sub(crater.craterFloor.mul(0.75))
    .sub(crater.craterWall.mul(0.08))
    .add(crater.craterRim.mul(0.9))
    .add(crater.ejectaStrength.mul(0.08));
  const height = clampNode(heightRaw, -1, 1);
  const ridgeDerivativeFactor = signNode(ridgedBase.mul(2).sub(1)).mul(-2);
  const qGradient = continentalSample.gradient
    .mul(PLANET_FIELD_ALGORITHM.heightWeights.continental * PLANET_FIELD_ALGORITHM.fbm.continental.scale)
    .add(highlandsSample.gradient.mul(PLANET_FIELD_ALGORITHM.heightWeights.highlands * PLANET_FIELD_ALGORITHM.fbm.highlands.scale))
    .add(
      ridgedSample.gradient.mul(
        PLANET_FIELD_ALGORITHM.heightWeights.ridge *
          PLANET_FIELD_ALGORITHM.fbm.ridged.scale,
      ).mul(ridgeDerivativeFactor),
    );
  const signY = surfaceDirection.y.equal(0).select(float(1), signNode(surfaceDirection.y));
  const heightDerivativeCandidate = [basis.xTangent, basis.yTangent].map((tangent, axis) => {
    const terrainDerivative = macroRaw
      .lessThanEqual(-1)
      .or(macroRaw.greaterThanEqual(1))
      .select(
        float(0),
        terrainDerivativeAlongTangentNode({
          surfaceDirection,
          tangent,
          baseFrequency,
          seedBase,
          warp,
          warpDot,
          qGradient,
        })
          .sub(signY.mul(tangent.y).mul(PLANET_FIELD_ALGORITHM.heightWeights.latitude))
          .mul(2),
      );
    const craterDerivative = craterGradient[axis].craterFloor
      .mul(PLANET_FIELD_ALGORITHM.heightWeights.craterFloor)
      .add(craterGradient[axis].craterWall.mul(PLANET_FIELD_ALGORITHM.heightWeights.craterWall))
      .add(craterGradient[axis].craterRim.mul(PLANET_FIELD_ALGORITHM.heightWeights.craterRim))
      .add(craterGradient[axis].ejectaStrength.mul(PLANET_FIELD_ALGORITHM.heightWeights.ejectaStrength));
    return heightRaw
      .lessThanEqual(-1)
      .or(heightRaw.greaterThanEqual(1))
      .select(float(0), terrainDerivative.add(craterDerivative));
  });
  const oceanDepth = clampNode(seaLevel.sub(height), 0, 1);
  const humidity = clampNode(
    valueNoise3Node(q.mul(0.22), seedBase.add(63.1))
      .mul(0.65)
      .add(valueNoise3Node(q.mul(0.75), seedBase.add(79.3)).mul(0.35))
      .add(humidityBias),
    0,
    1,
  );
  const temperature = clampNode(
    float(1)
      .sub(powNode(absNode(surfaceDirection.y), 1.35))
      .mul(0.85)
      .add(0.15)
      .sub(height.mul(0.32))
      .add(temperatureBias),
    0,
    1,
  );
  const ruggednessProxy = clampNode(
    ridge.mul(0.45).add(crater.craterWall.mul(0.35)).add(absNode(height.sub(macroHeight)).mul(0.2)),
    0,
    1,
  );
  const snow = smoothstepNode(0.58, 0.88, absNode(surfaceDirection.y).add(height.mul(0.35)).sub(temperature.mul(0.18)));
  const ice = smoothstepNode(0.52, 0.9, snow.add(oceanDepth.mul(float(1).sub(temperature))));
  const arid = smoothstepNode(0.46, 0.78, float(1).sub(humidity).mul(temperature).sub(height.mul(0.08)));
  const rock = smoothstepNode(0.08, 0.3, ruggednessProxy.add(maxNode(height, 0).mul(0.28)));
  const roughnessCause = clampNode(
    ruggednessProxy.mul(0.4).add(crater.ejectaStrength.mul(0.28)).add(rock.mul(0.22)),
    0,
    1,
  );

  return {
    surfaceDirection,
    xTangent: basis.xTangent,
    yTangent: basis.yTangent,
    height,
    macroHeight,
    ridge,
    oceanDepth,
    humidity,
    temperature,
    ruggednessProxy,
    roughnessCause,
    heightDerivativeCandidateX: heightDerivativeCandidate[0],
    heightDerivativeCandidateY: heightDerivativeCandidate[1],
    craterFloor: crater.craterFloor,
    craterWall: crater.craterWall,
    craterRim: crater.craterRim,
    ejectaStrength: crater.ejectaStrength,
    snow,
    ice,
    arid,
    rock,
  };
}

export const samplePlanetParity0 = Fn(({
  direction,
  seed,
  rocky,
  seaLevel,
  humidityBias,
  temperatureBias,
}) => {
  const fields = planetFieldNodes({ direction, seed, rocky, seaLevel, humidityBias, temperatureBias });
  return vec4(fields.height, fields.macroHeight, fields.ridge, fields.oceanDepth);
});

export const samplePlanetParity1 = Fn(({
  direction,
  seed,
  rocky,
  seaLevel,
  humidityBias,
  temperatureBias,
}) => {
  const fields = planetFieldNodes({ direction, seed, rocky, seaLevel, humidityBias, temperatureBias });
  return vec4(fields.humidity, fields.temperature, fields.ruggednessProxy, fields.roughnessCause);
});
