import {
  Fn,
  abs,
  clamp as clampNode,
  dot,
  float,
  fract as fractNode,
  normalize,
  pow,
  sin,
  vec3,
  vec4,
} from "three/tsl";

const fract = (value) => value - Math.floor(value);
const clamp = (value, min = 0, max = 1) => Math.min(Math.max(value, min), max);
const smoothstep = (edge0, edge1, value) => {
  const t = clamp((value - edge0) / (edge1 - edge0));
  return t * t * (3 - 2 * t);
};
const lerp = (a, b, t) => a + (b - a) * t;

export const FIELD_CHANNELS = Object.freeze({
  r: "macroHeight",
  g: "ridge",
  b: "cavity",
  a: "moisture",
});

export const FIELD_SPECTRUM = Object.freeze({
  hashFamily: "sin-dot value hash with deterministic seed wrapping",
  outputRange: [0, 1],
  normalization: "octave weights normalized by accumulated amplitude",
  lacunarity: { min: 1.7, max: 2.35, default: 2.03 },
  gain: { min: 0.42, max: 0.62, default: 0.5 },
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

export const fixedProbes = Object.freeze([
  { domain: "sphere", coordinate: [1, 0, 0], seed: 17 },
  { domain: "sphere", coordinate: [0.577, 0.577, 0.577], seed: 17 },
  { domain: "world", coordinate: [12.5, -4, 8.25], seed: 29 },
  { domain: "object", coordinate: [0.125, 0.75, 0.5], seed: 43 },
]);

function hash3(x, y, z, seed) {
  const wrappedSeed = ((seed % 65536) + 65536) % 65536;
  const n = x * 127.1 + y * 311.7 + z * 74.7 + wrappedSeed * 19.1999;
  return fract(Math.sin(n) * 43758.5453123);
}

function valueNoise3(x, y, z, seed) {
  const x0 = Math.floor(x);
  const y0 = Math.floor(y);
  const z0 = Math.floor(z);
  const tx = smoothstep(0, 1, fract(x));
  const ty = smoothstep(0, 1, fract(y));
  const tz = smoothstep(0, 1, fract(z));
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

function fbm(x, y, z, seed, octaves, lacunarity, gain) {
  let value = 0;
  let amplitude = 0.5;
  let frequency = 1;
  let norm = 0;
  for (let index = 0; index < octaves; index += 1) {
    value += valueNoise3(x * frequency, y * frequency, z * frequency, seed + index * 17) * amplitude;
    norm += amplitude;
    frequency *= lacunarity;
    amplitude *= gain;
  }
  return value / norm;
}

function normalize3(vector) {
  const length = Math.hypot(vector[0], vector[1], vector[2]) || 1;
  return [vector[0] / length, vector[1] / length, vector[2] / length];
}

function dot3(a, b) {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
}

export function stableCoordinates({ domain, coordinate }) {
  if (domain === "sphere") return normalize3(coordinate);
  if (domain === "world") return [coordinate[0] * 0.125, coordinate[1] * 0.125, coordinate[2] * 0.125];
  if (domain === "object") return [coordinate[0], coordinate[1], coordinate[2]];
  throw new Error(`Unknown field domain "${domain}"`);
}

export function tangentWarp(coordinate, seed) {
  const radial = normalize3(coordinate);
  const warp = [
    valueNoise3(radial[0] * 3.1, radial[1] * 3.1, radial[2] * 3.1, seed + 3) - 0.5,
    valueNoise3(radial[0] * 3.1, radial[1] * 3.1, radial[2] * 3.1, seed + 7) - 0.5,
    valueNoise3(radial[0] * 3.1, radial[1] * 3.1, radial[2] * 3.1, seed + 11) - 0.5,
  ];
  const radialComponent = dot3(warp, radial);
  return [
    warp[0] - radial[0] * radialComponent,
    warp[1] - radial[1] * radialComponent,
    warp[2] - radial[2] * radialComponent,
  ];
}

export function sampleFieldCPU({ domain, coordinate, seed = 17 }) {
  const base = stableCoordinates({ domain, coordinate });
  const warp = domain === "sphere" ? tangentWarp(base, seed) : [0, 0, 0];
  const q = [
    base[0] + warp[0] * 0.45,
    base[1] + warp[1] * 0.45,
    base[2] + warp[2] * 0.45,
  ];
  const macroHeight = fbm(q[0] * 1.4, q[1] * 1.4, q[2] * 1.4, seed + 13, 4, 2.03, 0.5);
  const ridgeBase = fbm(q[0] * 3.6, q[1] * 3.6, q[2] * 3.6, seed + 29, 4, 2.08, 0.52);
  const ridge = 1 - Math.abs(ridgeBase * 2 - 1);
  const cavity = Math.pow(1 - fbm(q[0] * 5.8, q[1] * 5.8, q[2] * 5.8, seed + 47, 3, 2.1, 0.48), 2.7);
  const moisture = clamp(fbm(q[0] * 0.9, q[1] * 0.9, q[2] * 0.9, seed + 71, 3, 1.9, 0.55) * 0.7 + macroHeight * 0.2);
  const slope = clamp(Math.abs(ridge - macroHeight) + cavity * 0.35);
  const biome = clamp(moisture * 0.55 + macroHeight * 0.25 - cavity * 0.12);
  const roughness = clamp(0.34 + ridge * 0.28 + cavity * 0.22 - moisture * 0.1);
  const placementMask = smoothstep(0.45, 0.75, biome) * (1 - smoothstep(0.7, 0.95, slope));
  const packedChannels = {
    r: macroHeight,
    g: ridge,
    b: cavity,
    a: moisture,
  };
  return {
    sourceCoordinates: base,
    tangentWarp: warp,
    macroHeight,
    ridge,
    cavity,
    moisture,
    slope,
    biome,
    roughness,
    placementMask,
    packedChannels,
  };
}

function hash3Node(position, seed) {
  return fractNode(
    sin(dot(position, vec3(127.1, 311.7, 74.7)).add(float(seed).mul(19.1999)))
      .mul(43758.5453123),
  );
}

function fbmNode(position, seed) {
  const octave0 = hash3Node(position, seed).mul(0.5);
  const octave1 = hash3Node(position.mul(2.03), seed + 17).mul(0.25);
  const octave2 = hash3Node(position.mul(4.1209), seed + 34).mul(0.125);
  const octave3 = hash3Node(position.mul(8.3654), seed + 51).mul(0.0625);
  return octave0.add(octave1).add(octave2).add(octave3).div(0.9375);
}

export const sampleField = Fn(({ coordinate }) => {
  const radial = normalize(coordinate);
  const warpSeed = 17;
  const warp = vec3(
    hash3Node(radial.mul(3.1), warpSeed + 3).sub(0.5),
    hash3Node(radial.mul(3.1), warpSeed + 7).sub(0.5),
    hash3Node(radial.mul(3.1), warpSeed + 11).sub(0.5),
  );
  const tangent = warp.sub(radial.mul(dot(warp, radial)));
  const q = radial.add(tangent.mul(0.45));
  const macroHeight = fbmNode(q.mul(1.4), 30);
  const ridgeBase = fbmNode(q.mul(3.6), 46);
  const ridge = float(1).sub(abs(ridgeBase.mul(2).sub(1)));
  const cavity = pow(float(1).sub(fbmNode(q.mul(5.8), 64)), 2.7);
  const moisture = clampNode(fbmNode(q.mul(0.9), 88).mul(0.7).add(macroHeight.mul(0.2)), 0, 1);

  return vec4(macroHeight, ridge, cavity, moisture);
});

export const TSL_FIELD_CONTRACT = `
const sampleField = Fn(({ coordinate, seed }) => {
  const warpedCoordinates = coordinate.add(tangentWarp(coordinate, seed));
  const macroHeight = normalizedFbm(warpedCoordinates, seed);
  const ridge = ridgedFbm(warpedCoordinates, seed);
  const cavity = pow(1 - normalizedFbm(warpedCoordinates, seed + 34), 2.7);
  const moisture = clamp(normalizedFbm(warpedCoordinates, seed + 58) * 0.7 + macroHeight * 0.2, 0, 1);
  return vec4(macroHeight, ridge, cavity, moisture);
});
`;

export function coverage(values) {
  return {
    min: Math.min(...values),
    max: Math.max(...values),
    mean: values.reduce((total, value) => total + value, 0) / values.length,
  };
}
