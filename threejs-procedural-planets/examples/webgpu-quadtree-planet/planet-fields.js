import { BODY_PRESETS } from "./planet-config.js";

const fract = (value) => value - Math.floor(value);
const smoothValue = (value) => value * value * (3 - 2 * value);
const lerp = (a, b, t) => a + (b - a) * t;
const clamp = (value, min = 0, max = 1) => Math.min(Math.max(value, min), max);
const smoothstep = (edge0, edge1, value) => {
  const t = clamp((value - edge0) / (edge1 - edge0));
  return t * t * (3 - 2 * t);
};

export const PLANET_FIELD_SCHEMA_KEYS = Object.freeze([
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
  "slope",
  "snow",
  "ice",
  "wetness",
  "biomeWeights",
  "biomeId",
  "roughnessVariance",
  "atmosphereMask",
  "debugChannels",
]);

export const DEBUG_FIELD_KEYS = Object.freeze([
  "height",
  "macroHeight",
  "craterFloor",
  "craterWall",
  "craterRim",
  "ejectaStrength",
  "humidity",
  "temperature",
  "slope",
  "oceanDepth",
  "biomeWeights",
  "roughnessVariance",
  "atmosphereMask",
]);

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

export function length(a) {
  return Math.hypot(a[0], a[1], a[2]);
}

export function normalize(a) {
  const len = length(a);
  if (len === 0) return [0, 1, 0];
  return [a[0] / len, a[1] / len, a[2] / len];
}

function hash3(x, y, z, seed) {
  const n = x * 127.1 + y * 311.7 + z * 74.7 + seed * 191.999;
  return fract(Math.sin(n) * 43758.5453123);
}

function valueNoise3(x, y, z, seed) {
  const x0 = Math.floor(x);
  const y0 = Math.floor(y);
  const z0 = Math.floor(z);
  const tx = smoothValue(fract(x));
  const ty = smoothValue(fract(y));
  const tz = smoothValue(fract(z));
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
        seed + index * 13.7,
      ) * amplitude;
    frequency *= lacunarity;
    amplitude *= gain;
  }
  return value;
}

export function craterStamp(surfaceDirection, crater) {
  const cosine = clamp(dot(surfaceDirection, crater.centerDirection), -1, 1);
  const angularDistance = Math.acos(cosine);
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

export function planetFields(
  directionInput,
  {
    preset = BODY_PRESETS.pelagia,
    seed = 31.731,
    craters = DEFAULT_CRATER_STAMPS.slice(0, preset.craterCount ?? 3),
  } = {},
) {
  const surfaceDirection = normalize(directionInput);
  const seedBase = seed * 97.113;
  const baseFrequency = preset.kind === "rocky" ? 10.2 : 8.4;
  const x = surfaceDirection[0] * baseFrequency;
  const y = surfaceDirection[1] * baseFrequency;
  const z = surfaceDirection[2] * baseFrequency;
  const warp = [
    valueNoise3(x * 0.75 + seedBase, y * 0.75, z * 0.75, seedBase + 7.1) - 0.5,
    valueNoise3(x * 0.75, y * 0.75 + seedBase, z * 0.75, seedBase + 11.4) - 0.5,
    valueNoise3(x * 0.75, y * 0.75, z * 0.75 + seedBase, seedBase + 17.9) - 0.5,
  ];
  const warpDot = dot(warp, surfaceDirection);
  const tangentWarp = [
    warp[0] - surfaceDirection[0] * warpDot,
    warp[1] - surfaceDirection[1] * warpDot,
    warp[2] - surfaceDirection[2] * warpDot,
  ];
  const q = [
    x + tangentWarp[0] * 2.4,
    y + tangentWarp[1] * 2.4,
    z + tangentWarp[2] * 2.4,
  ];
  const continental = fbmNoise3(q[0] * 0.55, q[1] * 0.55, q[2] * 0.55, seedBase + 23.1, 5, 2.03, 0.5);
  const highlands = fbmNoise3(q[0] * 1.25, q[1] * 1.25, q[2] * 1.25, seedBase + 41.8, 4, 2.15, 0.55);
  const ridgedBase = fbmNoise3(q[0] * 2.7, q[1] * 2.7, q[2] * 2.7, seedBase + 59.2, 4, 2.08, 0.52);
  const ridge = 1 - Math.abs(ridgedBase * 2 - 1);
  const latitudeTerm = (0.35 - Math.abs(surfaceDirection[1])) * 0.08;
  const macroHeight = clamp(
    (continental * 0.62 + highlands * 0.24 + ridge * 0.34 + latitudeTerm) * 2 - 1,
    -1,
    1,
  );
  const crater = aggregateCraters(surfaceDirection, craters);
  const continent = clamp(continental * 0.72 + macroHeight * 0.18 + ridge * 0.1);
  const height = clamp(
    macroHeight -
      crater.craterFloor * 0.75 -
      crater.craterWall * 0.08 +
      crater.craterRim * 0.9 +
      crater.ejectaStrength * 0.08,
    -1,
    1,
  );
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
  const slope = clamp(ridge * 0.45 + crater.craterWall * 0.35 + Math.abs(height - macroHeight) * 0.2);
  const snow = smoothstep(0.58, 0.88, Math.abs(surfaceDirection[1]) + height * 0.35 - temperature * 0.18);
  const ice = smoothstep(0.52, 0.9, snow + oceanDepth * (1 - temperature));
  const arid = smoothstep(0.46, 0.78, (1 - humidity) * temperature - height * 0.08);
  const lush = smoothstep(0.36, 0.72, humidity * temperature - arid * 0.35 - slope * 0.8);
  const rock = smoothstep(0.08, 0.3, slope + Math.max(height, 0) * 0.28);
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
  const roughnessVariance = clamp(slope * 0.4 + crater.ejectaStrength * 0.28 + rock * 0.22);
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
    slope,
    snow,
    ice,
    wetness,
    biomeWeights,
    biomeId,
    roughnessVariance,
    atmosphereMask,
    debugChannels: {
      tangentialWarpMagnitude: length(tangentWarp),
      craterAge: crater.age,
      craterErosion: crater.erosion,
      overlap: crater.overlapPriority,
    },
  };
}

export const TSL_PLANET_FIELDS_CONTRACT = `
const planetFields = Fn(({ surfaceDirection, preset }) => {
  const tangentWarp = warp.sub(surfaceDirection.mul(dot(warp, surfaceDirection)));
  const fields = {
    height,
    macroHeight,
    craterFloor,
    craterWall,
    craterRim,
    ejectaStrength,
    biomeWeights,
    biomeId,
    roughnessVariance,
    atmosphereMask
  };
  return fields;
});
`;
