import {
  Fn,
  abs,
  clamp as clampNode,
  dot,
  float,
  floor,
  fract as fractNode,
  mix,
  mod,
  normalize,
  pow,
  sin,
  smoothstep as smoothstepNode,
  vec3,
  vec4,
} from "three/tsl";

import {
  FIELD_ALGORITHM,
  FIELD_CHANNELS,
  FIELD_DERIVED_CHANNELS,
  FIELD_PARITY_CHANNELS,
  FIELD_SPECTRUM,
  fixedProbes,
} from "./field-constants.mjs";

const fract = (value) => value - Math.floor(value);
const clamp = (value, min = 0, max = 1) => Math.min(Math.max(value, min), max);
const smoothstep = (edge0, edge1, value) => {
  const t = clamp((value - edge0) / (edge1 - edge0));
  return t * t * (3 - 2 * t);
};
const lerp = (a, b, t) => a + (b - a) * t;

export {
  FIELD_ALGORITHM,
  FIELD_CHANNELS,
  FIELD_DERIVED_CHANNELS,
  FIELD_PARITY_CHANNELS,
  FIELD_SPECTRUM,
  fixedProbes,
};

export const CPU_FIELD_ALGORITHM = FIELD_ALGORITHM;
export const TSL_FIELD_ALGORITHM = FIELD_ALGORITHM;

function wrapSeed(seed) {
  const { seedWrap } = FIELD_ALGORITHM.hash;
  return ((seed % seedWrap) + seedWrap) % seedWrap;
}

function hash3(x, y, z, seed) {
  const { primes, seedMultiplier, outputMultiplier } = FIELD_ALGORITHM.hash;
  const n =
    x * primes[0] +
    y * primes[1] +
    z * primes[2] +
    wrapSeed(seed) * seedMultiplier;
  return fract(Math.sin(n) * outputMultiplier);
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

function fbm(x, y, z, seed, config) {
  let value = 0;
  let amplitude = config.initialAmplitude;
  let frequency = config.initialFrequency;
  let norm = 0;
  for (let index = 0; index < config.octaves; index += 1) {
    value +=
      valueNoise3(
        x * frequency,
        y * frequency,
        z * frequency,
        seed + index * FIELD_ALGORITHM.hash.octaveSeedStep,
      ) * amplitude;
    norm += amplitude;
    frequency *= config.lacunarity;
    amplitude *= config.gain;
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
  if (domain === "world") {
    return [coordinate[0] * 0.125, coordinate[1] * 0.125, coordinate[2] * 0.125];
  }
  if (domain === "object") return [coordinate[0], coordinate[1], coordinate[2]];
  throw new Error(`Unknown field domain "${domain}"`);
}

export function tangentWarp(coordinate, seed) {
  const radial = normalize3(coordinate);
  const { frequency, seedOffsets } = FIELD_ALGORITHM.warp;
  const warp = [
    valueNoise3(radial[0] * frequency, radial[1] * frequency, radial[2] * frequency, seed + seedOffsets[0]) - 0.5,
    valueNoise3(radial[0] * frequency, radial[1] * frequency, radial[2] * frequency, seed + seedOffsets[1]) - 0.5,
    valueNoise3(radial[0] * frequency, radial[1] * frequency, radial[2] * frequency, seed + seedOffsets[2]) - 0.5,
  ];
  const radialComponent = dot3(warp, radial);
  return [
    warp[0] - radial[0] * radialComponent,
    warp[1] - radial[1] * radialComponent,
    warp[2] - radial[2] * radialComponent,
  ];
}

function sampleFieldFromStableCoordinatesCPU({
  coordinate,
  seed = FIELD_ALGORITHM.defaultSeed,
  warpStrength = FIELD_ALGORITHM.warp.amplitude,
}) {
  const warp = warpStrength === 0 ? [0, 0, 0] : tangentWarp(coordinate, seed);
  const q = [
    coordinate[0] + warp[0] * warpStrength,
    coordinate[1] + warp[1] * warpStrength,
    coordinate[2] + warp[2] * warpStrength,
  ];
  const { bands, derived } = FIELD_ALGORITHM;
  const macro = bands.macroHeight;
  const ridgeConfig = bands.ridge;
  const cavityConfig = bands.cavity;
  const moistureConfig = bands.moisture;
  const macroHeight = fbm(
    q[0] * macro.scale,
    q[1] * macro.scale,
    q[2] * macro.scale,
    seed + macro.seedOffset,
    macro,
  );
  const ridgeBase = fbm(
    q[0] * ridgeConfig.scale,
    q[1] * ridgeConfig.scale,
    q[2] * ridgeConfig.scale,
    seed + ridgeConfig.seedOffset,
    ridgeConfig,
  );
  const ridge = 1 - Math.abs(ridgeBase * 2 - 1);
  const cavity = Math.pow(
    1 -
      fbm(
        q[0] * cavityConfig.scale,
        q[1] * cavityConfig.scale,
        q[2] * cavityConfig.scale,
        seed + cavityConfig.seedOffset,
        cavityConfig,
      ),
    cavityConfig.exponent,
  );
  const moisture = clamp(
    fbm(
      q[0] * moistureConfig.scale,
      q[1] * moistureConfig.scale,
      q[2] * moistureConfig.scale,
      seed + moistureConfig.seedOffset,
      moistureConfig,
    ) *
      moistureConfig.fieldWeight +
      macroHeight * moistureConfig.macroWeight,
  );
  const slope = clamp(Math.abs(ridge - macroHeight) + cavity * derived.slopeCavityWeight);
  const biome = clamp(
    moisture * derived.biomeMoistureWeight +
      macroHeight * derived.biomeMacroWeight +
      cavity * derived.biomeCavityWeight,
  );
  const roughness = clamp(
    derived.roughnessBase +
      ridge * derived.roughnessRidgeWeight +
      cavity * derived.roughnessCavityWeight +
      moisture * derived.roughnessMoistureWeight,
  );
  const placementMask =
    smoothstep(derived.placementBiomeLow, derived.placementBiomeHigh, biome) *
    (1 - smoothstep(derived.placementSlopeLow, derived.placementSlopeHigh, slope));

  return {
    tangentWarp: warp,
    macroHeight,
    ridge,
    cavity,
    moisture,
    slope,
    biome,
    roughness,
    placementMask,
    packedChannels: {
      r: macroHeight,
      g: ridge,
      b: cavity,
      a: moisture,
    },
    derivedChannels: {
      r: slope,
      g: biome,
      b: roughness,
      a: placementMask,
    },
  };
}

export function sampleFieldCPU({ domain, coordinate, seed = FIELD_ALGORITHM.defaultSeed }) {
  const base = stableCoordinates({ domain, coordinate });
  const warpStrength = domain === "sphere" ? FIELD_ALGORITHM.warp.amplitude : 0;
  const fields = sampleFieldFromStableCoordinatesCPU({ coordinate: base, seed, warpStrength });
  return {
    sourceCoordinates: base,
    ...fields,
  };
}

function wrappedSeedNode(seed) {
  const wrap = FIELD_ALGORITHM.hash.seedWrap;
  return mod(mod(seed, wrap).add(wrap), wrap);
}

function hash3Node(position, seed) {
  const { primes, seedMultiplier, outputMultiplier } = FIELD_ALGORITHM.hash;
  return fractNode(
    sin(
      dot(position, vec3(primes[0], primes[1], primes[2])).add(
        wrappedSeedNode(seed).mul(seedMultiplier),
      ),
    ).mul(outputMultiplier),
  );
}

function valueNoise3Node(position, seed) {
  const cell = floor(position);
  const f = smoothstepNode(float(0), float(1), fractNode(position));
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

function fbmNode(position, seed, config) {
  let value = float(0);
  let norm = 0;
  let amplitude = config.initialAmplitude;
  let frequency = config.initialFrequency;

  for (let index = 0; index < config.octaves; index += 1) {
    value = value.add(
      valueNoise3Node(
        position.mul(frequency),
        seed.add(index * FIELD_ALGORITHM.hash.octaveSeedStep),
      ).mul(amplitude),
    );
    norm += amplitude;
    frequency *= config.lacunarity;
    amplitude *= config.gain;
  }

  return value.div(norm);
}

function fieldNodes({ coordinate, seed, warpStrength }) {
  const fieldSeed = seed ?? float(FIELD_ALGORITHM.defaultSeed);
  const strength = warpStrength ?? float(FIELD_ALGORITHM.warp.amplitude);
  const radial = normalize(coordinate);
  const { frequency, seedOffsets } = FIELD_ALGORITHM.warp;
  const warpPosition = radial.mul(frequency);
  const warp = vec3(
    valueNoise3Node(warpPosition, fieldSeed.add(seedOffsets[0])).sub(0.5),
    valueNoise3Node(warpPosition, fieldSeed.add(seedOffsets[1])).sub(0.5),
    valueNoise3Node(warpPosition, fieldSeed.add(seedOffsets[2])).sub(0.5),
  );
  const tangent = warp.sub(radial.mul(dot(warp, radial)));
  const q = coordinate.add(tangent.mul(strength));
  const { bands, derived } = FIELD_ALGORITHM;
  const macroHeight = fbmNode(
    q.mul(bands.macroHeight.scale),
    fieldSeed.add(bands.macroHeight.seedOffset),
    bands.macroHeight,
  );
  const ridgeBase = fbmNode(
    q.mul(bands.ridge.scale),
    fieldSeed.add(bands.ridge.seedOffset),
    bands.ridge,
  );
  const ridge = float(1).sub(abs(ridgeBase.mul(2).sub(1)));
  const cavity = pow(
    float(1).sub(fbmNode(q.mul(bands.cavity.scale), fieldSeed.add(bands.cavity.seedOffset), bands.cavity)),
    bands.cavity.exponent,
  );
  const moisture = clampNode(
    fbmNode(q.mul(bands.moisture.scale), fieldSeed.add(bands.moisture.seedOffset), bands.moisture)
      .mul(bands.moisture.fieldWeight)
      .add(macroHeight.mul(bands.moisture.macroWeight)),
    0,
    1,
  );
  const slope = clampNode(abs(ridge.sub(macroHeight)).add(cavity.mul(derived.slopeCavityWeight)), 0, 1);
  const biome = clampNode(
    moisture
      .mul(derived.biomeMoistureWeight)
      .add(macroHeight.mul(derived.biomeMacroWeight))
      .add(cavity.mul(derived.biomeCavityWeight)),
    0,
    1,
  );
  const roughness = clampNode(
    float(derived.roughnessBase)
      .add(ridge.mul(derived.roughnessRidgeWeight))
      .add(cavity.mul(derived.roughnessCavityWeight))
      .add(moisture.mul(derived.roughnessMoistureWeight)),
    0,
    1,
  );
  const placementMask = smoothstepNode(
    derived.placementBiomeLow,
    derived.placementBiomeHigh,
    biome,
  ).mul(float(1).sub(smoothstepNode(derived.placementSlopeLow, derived.placementSlopeHigh, slope)));

  return {
    macroHeight,
    ridge,
    cavity,
    moisture,
    slope,
    biome,
    roughness,
    placementMask,
  };
}

export const sampleField = Fn(({ coordinate, seed, warpStrength }) => {
  const fields = fieldNodes({ coordinate, seed, warpStrength });
  return vec4(fields.macroHeight, fields.ridge, fields.cavity, fields.moisture);
});

export const sampleFieldDerived = Fn(({ coordinate, seed, warpStrength }) => {
  const fields = fieldNodes({ coordinate, seed, warpStrength });
  return vec4(fields.slope, fields.biome, fields.roughness, fields.placementMask);
});

export const TSL_FIELD_CONTRACT = `
import { FIELD_ALGORITHM } from "./field-constants.mjs";

const sampleField = Fn(({ coordinate, seed, warpStrength }) => {
  const fields = fieldNodes({
    coordinate,
    seed,
    warpStrength,
    algorithm: FIELD_ALGORITHM,
  });
  return vec4(fields.macroHeight, fields.ridge, fields.cavity, fields.moisture);
});

const sampleFieldDerived = Fn(({ coordinate, seed, warpStrength }) => {
  const fields = fieldNodes({
    coordinate,
    seed,
    warpStrength,
    algorithm: FIELD_ALGORITHM,
  });
  return vec4(fields.slope, fields.biome, fields.roughness, fields.placementMask);
});
`;

export function coverage(values) {
  return {
    min: Math.min(...values),
    max: Math.max(...values),
    mean: values.reduce((total, value) => total + value, 0) / values.length,
  };
}
