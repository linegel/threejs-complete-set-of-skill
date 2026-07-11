import {
  Fn,
  abs,
  bitcast,
  clamp as clampNode,
  dot,
  float,
  floor,
  fract as fractNode,
  int,
  mix,
  normalize,
  pow,
  smoothstep as smoothstepNode,
  uint,
  vec3,
  vec4,
} from "three/tsl";

import {
  FIELD_ALGORITHM,
  FIELD_CHANNELS,
  FIELD_DERIVED_CHANNELS,
  FIELD_GRADIENT_CHANNELS,
  FIELD_PARITY_ERROR_MANIFEST,
  FIELD_PARITY_CHANNELS,
  FIELD_SPECTRUM,
  fixedProbes,
  gpuParityProbes,
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
  FIELD_GRADIENT_CHANNELS,
  FIELD_PARITY_ERROR_MANIFEST,
  FIELD_PARITY_CHANNELS,
  FIELD_SPECTRUM,
  fixedProbes,
  gpuParityProbes,
};

export const CPU_FIELD_ALGORITHM = FIELD_ALGORITHM;
export const TSL_FIELD_ALGORITHM = FIELD_ALGORITHM;

function latticeCoordToU32(value) {
  // CPU<->TSL convention: floor to i32, then reinterpret i32 bits as u32.
  // This makes negative cells match WGSL bitcast<u32>(i32(floor(p))).
  return (Math.floor(value) | 0) >>> 0;
}

function seedToU32(seed) {
  return (Math.floor(seed) | 0) >>> 0;
}

function u32Mul(a, b) {
  return Math.imul(a >>> 0, b >>> 0) >>> 0;
}

function lowbias32(value) {
  const { mixMultipliers, mixShifts } = FIELD_ALGORITHM.hash;
  let h = value >>> 0;
  h = (h ^ (h >>> mixShifts[0])) >>> 0;
  h = u32Mul(h, mixMultipliers[0]);
  h = (h ^ (h >>> mixShifts[1])) >>> 0;
  h = u32Mul(h, mixMultipliers[1]);
  h = (h ^ (h >>> mixShifts[2])) >>> 0;
  return h >>> 0;
}

function hash3(x, y, z, seed) {
  const { latticeMultipliers, seedMultiplier, outputScale } = FIELD_ALGORITHM.hash;
  const h =
    u32Mul(latticeCoordToU32(x), latticeMultipliers[0]) ^
    u32Mul(latticeCoordToU32(y), latticeMultipliers[1]) ^
    u32Mul(latticeCoordToU32(z), latticeMultipliers[2]) ^
    u32Mul(seedToU32(seed), seedMultiplier);
  const mixed = lowbias32(h);
  return Math.fround(Math.fround(mixed) * outputScale);
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

// Exact analytic derivative of the trilinearly interpolated value-noise
// fixture. The fade is f(t)=t^2(3-2t), so f'(t)=6t(1-t). The derivative is
// with respect to the function input, before any octave or warp scale.
function valueNoise3WithGradient(x, y, z, seed) {
  const x0 = Math.floor(x);
  const y0 = Math.floor(y);
  const z0 = Math.floor(z);
  const fx = fract(x);
  const fy = fract(y);
  const fz = fract(z);
  const tx = smoothstep(0, 1, fx);
  const ty = smoothstep(0, 1, fy);
  const tz = smoothstep(0, 1, fz);
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
  const ny0 = lerp(nx00, nx10, ty);
  const ny1 = lerp(nx01, nx11, ty);

  const dx0 = lerp((n100 - n000) * dtx, (n110 - n010) * dtx, ty);
  const dx1 = lerp((n101 - n001) * dtx, (n111 - n011) * dtx, ty);
  const dy0 = (nx10 - nx00) * dty;
  const dy1 = (nx11 - nx01) * dty;

  return {
    value: lerp(ny0, ny1, tz),
    gradient: [
      lerp(dx0, dx1, tz),
      lerp(dy0, dy1, tz),
      (ny1 - ny0) * dtz,
    ],
  };
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

function fbmWithGradient(x, y, z, seed, config) {
  let value = 0;
  const gradient = [0, 0, 0];
  let amplitude = config.initialAmplitude;
  let frequency = config.initialFrequency;
  let norm = 0;
  for (let index = 0; index < config.octaves; index += 1) {
    const sample = valueNoise3WithGradient(
      x * frequency,
      y * frequency,
      z * frequency,
      seed + index * FIELD_ALGORITHM.hash.octaveSeedStep,
    );
    value += sample.value * amplitude;
    gradient[0] += sample.gradient[0] * frequency * amplitude;
    gradient[1] += sample.gradient[1] * frequency * amplitude;
    gradient[2] += sample.gradient[2] * frequency * amplitude;
    norm += amplitude;
    frequency *= config.lacunarity;
    amplitude *= config.gain;
  }
  return {
    value: value / norm,
    gradient: gradient.map((component) => component / norm),
  };
}

function normalize3(vector) {
  const length = Math.hypot(vector[0], vector[1], vector[2]) || 1;
  return [vector[0] / length, vector[1] / length, vector[2] / length];
}

function dot3(a, b) {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
}

function add3(a, b) {
  return [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
}

function scale3(vector, scalar) {
  return [vector[0] * scalar, vector[1] * scalar, vector[2] * scalar];
}

function identityColumn(index) {
  return [index === 0 ? 1 : 0, index === 1 ? 1 : 0, index === 2 ? 1 : 0];
}

function normalizationJacobianColumns(vector) {
  const length = Math.hypot(vector[0], vector[1], vector[2]);
  if (!(length > FIELD_ALGORITHM.coordinates.sphere.minimumRadius)) {
    throw new Error("field coordinates must have nonzero length for tangential warp");
  }
  const radial = scale3(vector, 1 / length);
  return [0, 1, 2].map((column) => {
    const basis = identityColumn(column);
    return scale3(add3(basis, scale3(radial, -radial[column])), 1 / length);
  });
}

function transposeMultiplyColumns(columns, vector) {
  return columns.map((column) => dot3(column, vector));
}

function warpBundleCPU(coordinate, seed) {
  const radial = normalize3(coordinate);
  const radialJacobian = normalizationJacobianColumns(coordinate);
  const { frequency, seedOffsets } = FIELD_ALGORITHM.warp;
  const samples = seedOffsets.map((offset) => valueNoise3WithGradient(
    radial[0] * frequency,
    radial[1] * frequency,
    radial[2] * frequency,
    seed + offset,
  ));
  const warp = samples.map((sample) => sample.value - 0.5);
  const warpGradients = samples.map((sample) => transposeMultiplyColumns(
    radialJacobian,
    scale3(sample.gradient, frequency),
  ));
  const tangent = add3(warp, scale3(radial, -dot3(warp, radial)));
  const tangentJacobian = [0, 1, 2].map((column) => {
    const dr = radialJacobian[column];
    const dw = [
      warpGradients[0][column],
      warpGradients[1][column],
      warpGradients[2][column],
    ];
    const projectedDw = add3(dw, scale3(radial, -dot3(radial, dw)));
    return add3(
      projectedDw,
      add3(
        scale3(dr, -dot3(radial, warp)),
        scale3(radial, -dot3(dr, warp)),
      ),
    );
  });
  return { radial, radialJacobian, warp, tangent, tangentJacobian };
}

export function fieldInputTransform({ domain, coordinate }) {
  if (domain === "sphere") {
    return {
      coordinate: normalize3(coordinate),
      jacobianColumns: normalizationJacobianColumns(coordinate),
      gradientDomain: FIELD_ALGORITHM.coordinates.sphere.gradientDomain,
    };
  }
  if (domain === "world") {
    const scale = FIELD_ALGORITHM.coordinates.world.scale;
    return {
      coordinate: scale3(coordinate, scale),
      jacobianColumns: [0, 1, 2].map((index) => scale3(identityColumn(index), scale)),
      gradientDomain: FIELD_ALGORITHM.coordinates.world.gradientDomain,
    };
  }
  if (domain === "object") {
    return {
      coordinate: [...coordinate],
      jacobianColumns: [0, 1, 2].map(identityColumn),
      gradientDomain: FIELD_ALGORITHM.coordinates.object.gradientDomain,
    };
  }
  throw new Error(`Unknown field domain "${domain}"`);
}

export function stableCoordinates(input) {
  return fieldInputTransform(input).coordinate;
}

export function tangentWarp(coordinate, seed) {
  return warpBundleCPU(coordinate, seed).tangent;
}

function sampleFieldFromStableCoordinatesCPU({
  coordinate,
  seed = FIELD_ALGORITHM.defaultSeed,
  warpStrength = FIELD_ALGORITHM.warp.amplitude,
  inputJacobianColumns = [0, 1, 2].map(identityColumn),
  gradientDomain = "stable-field-coordinate",
}) {
  const warpBundle = warpStrength === 0
    ? { tangent: [0, 0, 0], tangentJacobian: [identityColumn(0).map(() => 0), identityColumn(1).map(() => 0), identityColumn(2).map(() => 0)] }
    : warpBundleCPU(coordinate, seed);
  const warp = warpBundle.tangent;
  const coordinateJacobian = [0, 1, 2].map((index) => add3(
    identityColumn(index),
    scale3(warpBundle.tangentJacobian[index], warpStrength),
  ));
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
  const macroSample = fbmWithGradient(
    q[0] * macro.scale,
    q[1] * macro.scale,
    q[2] * macro.scale,
    seed + macro.seedOffset,
    macro,
  );
  const macroHeight = macroSample.value;
  const stableMacroGradient = transposeMultiplyColumns(
    coordinateJacobian,
    scale3(macroSample.gradient, macro.scale),
  );
  const macroGradient = transposeMultiplyColumns(inputJacobianColumns, stableMacroGradient);
  const ridgeSample = fbmWithGradient(
    q[0] * ridgeConfig.scale,
    q[1] * ridgeConfig.scale,
    q[2] * ridgeConfig.scale,
    seed + ridgeConfig.seedOffset,
    ridgeConfig,
  );
  const ridgeBase = ridgeSample.value;
  const ridge = 1 - Math.abs(ridgeBase * 2 - 1);
  const cavitySample = fbmWithGradient(
        q[0] * cavityConfig.scale,
        q[1] * cavityConfig.scale,
        q[2] * cavityConfig.scale,
        seed + cavityConfig.seedOffset,
        cavityConfig,
  );
  const cavity = Math.pow(1 - cavitySample.value, cavityConfig.exponent);
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
  const slope = clamp(Math.hypot(...macroGradient) * derived.slopeScale);
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
    warpJacobian: warpBundle.tangentJacobian,
    warpedCoordinates: q,
    macroHeight,
    stableMacroGradient,
    macroGradient,
    gradientDomain,
    macroGradientX: macroGradient[0],
    macroGradientY: macroGradient[1],
    macroGradientZ: macroGradient[2],
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
    gradientChannels: {
      r: macroGradient[0],
      g: macroGradient[1],
      b: macroGradient[2],
      a: slope,
    },
  };
}

export function sampleFieldCPU({ domain, coordinate, seed = FIELD_ALGORITHM.defaultSeed }) {
  const inputTransform = fieldInputTransform({ domain, coordinate });
  const warpStrength = domain === "sphere" ? FIELD_ALGORITHM.warp.amplitude : 0;
  const fields = sampleFieldFromStableCoordinatesCPU({
    coordinate: inputTransform.coordinate,
    seed,
    warpStrength,
    inputJacobianColumns: inputTransform.jacobianColumns,
    gradientDomain: inputTransform.gradientDomain,
  });
  return {
    sourceCoordinates: inputTransform.coordinate,
    inputJacobianColumns: inputTransform.jacobianColumns,
    ...fields,
  };
}

function latticeCoordToU32Node(value) {
  // CPU<->TSL convention: floor to i32, then reinterpret i32 bits as u32.
  // This is the TSL form of `(Math.floor(value) | 0) >>> 0` for negatives.
  return bitcast(int(value), "uint");
}

function seedToU32Node(seed) {
  return uint(seed);
}

function lowbias32Node(value) {
  const { mixMultipliers, mixShifts } = FIELD_ALGORITHM.hash;
  let h = uint(value);
  h = h.bitXor(h.shiftRight(uint(mixShifts[0])));
  h = h.mul(uint(mixMultipliers[0]));
  h = h.bitXor(h.shiftRight(uint(mixShifts[1])));
  h = h.mul(uint(mixMultipliers[1]));
  h = h.bitXor(h.shiftRight(uint(mixShifts[2])));
  return h;
}

function hash3Node(cell, seed) {
  const { latticeMultipliers, seedMultiplier, outputScale } = FIELD_ALGORITHM.hash;
  const h = latticeCoordToU32Node(cell.x)
    .mul(uint(latticeMultipliers[0]))
    .bitXor(latticeCoordToU32Node(cell.y).mul(uint(latticeMultipliers[1])))
    .bitXor(latticeCoordToU32Node(cell.z).mul(uint(latticeMultipliers[2])))
    .bitXor(seedToU32Node(seed).mul(uint(seedMultiplier)));
  return float(lowbias32Node(h)).mul(outputScale);
}

function valueNoise3Node(position, seed) {
  return valueNoise3NodeWithGradient(position, seed).value;
}

function valueNoise3NodeWithGradient(position, seed) {
  const cell = floor(position);
  const fractional = fractNode(position);
  const f = smoothstepNode(float(0), float(1), fractional);
  const df = fractional.mul(float(1).sub(fractional)).mul(6);
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
  const ny0 = mix(nx00, nx10, f.y);
  const ny1 = mix(nx01, nx11, f.y);
  const dx0 = mix(n100.sub(n000).mul(df.x), n110.sub(n010).mul(df.x), f.y);
  const dx1 = mix(n101.sub(n001).mul(df.x), n111.sub(n011).mul(df.x), f.y);
  const dy0 = nx10.sub(nx00).mul(df.y);
  const dy1 = nx11.sub(nx01).mul(df.y);
  return {
    value: mix(ny0, ny1, f.z),
    gradient: vec3(
      mix(dx0, dx1, f.z),
      mix(dy0, dy1, f.z),
      ny1.sub(ny0).mul(df.z),
    ),
  };
}

function fbmNode(position, seed, config) {
  return fbmNodeWithGradient(position, seed, config).value;
}

function fbmNodeWithGradient(position, seed, config) {
  let value = float(0);
  let gradient = vec3(0);
  let norm = 0;
  let amplitude = config.initialAmplitude;
  let frequency = config.initialFrequency;

  for (let index = 0; index < config.octaves; index += 1) {
    const sample = valueNoise3NodeWithGradient(
      position.mul(frequency),
      seed.add(uint(index * FIELD_ALGORITHM.hash.octaveSeedStep)),
    );
    value = value.add(sample.value.mul(amplitude));
    gradient = gradient.add(sample.gradient.mul(frequency * amplitude));
    norm += amplitude;
    frequency *= config.lacunarity;
    amplitude *= config.gain;
  }

  return { value: value.div(norm), gradient: gradient.div(norm) };
}

function basisNode(index) {
  return vec3(index === 0 ? 1 : 0, index === 1 ? 1 : 0, index === 2 ? 1 : 0);
}

function transposeMultiplyColumnsNode(columns, vector) {
  return vec3(dot(columns[0], vector), dot(columns[1], vector), dot(columns[2], vector));
}

function fieldNodes({ coordinate, seed, warpStrength, inputJacobianColumns, varPrefix }) {
  const fieldSeed = seed === undefined
    ? uint(FIELD_ALGORITHM.defaultSeed)
    : uint(seed);
  const strength = warpStrength ?? float(FIELD_ALGORITHM.warp.amplitude);
  const radial = normalize(coordinate).toVar(`${varPrefix}Radial`);
  const radialLength = coordinate.length().max(1e-8).toVar(`${varPrefix}CoordinateLength`);
  const radialJacobian = [0, 1, 2].map((index) => basisNode(index)
    .sub(radial.mul(radial[index]))
    .div(radialLength));
  const { frequency, seedOffsets } = FIELD_ALGORITHM.warp;
  const warpPosition = radial.mul(frequency);
  const warpSamples = seedOffsets.map((offset) => valueNoise3NodeWithGradient(
    warpPosition,
    fieldSeed.add(uint(offset)),
  ));
  const warp = vec3(...warpSamples.map((sample) => sample.value.sub(0.5)));
  const warpGradients = warpSamples.map((sample) => transposeMultiplyColumnsNode(
    radialJacobian,
    sample.gradient.mul(frequency),
  ));
  const tangent = warp.sub(radial.mul(dot(warp, radial))).toVar(`${varPrefix}TangentWarp`);
  const tangentJacobian = [0, 1, 2].map((index) => {
    const dr = radialJacobian[index];
    const dw = vec3(
      warpGradients[0][index],
      warpGradients[1][index],
      warpGradients[2][index],
    );
    const projectedDw = dw.sub(radial.mul(dot(radial, dw)));
    return projectedDw
      .sub(dr.mul(dot(radial, warp)))
      .sub(radial.mul(dot(dr, warp)));
  });
  const coordinateJacobian = [0, 1, 2].map((index) => basisNode(index)
    .add(tangentJacobian[index].mul(strength)));
  const q = coordinate.add(tangent.mul(strength)).toVar(`${varPrefix}WarpedCoordinate`);
  const { bands, derived } = FIELD_ALGORITHM;
  const macroSample = fbmNodeWithGradient(
    q.mul(bands.macroHeight.scale),
    fieldSeed.add(uint(bands.macroHeight.seedOffset)),
    bands.macroHeight,
  );
  const macroHeight = macroSample.value.toVar(`${varPrefix}MacroHeight`);
  const stableMacroGradient = transposeMultiplyColumnsNode(
    coordinateJacobian,
    macroSample.gradient.mul(bands.macroHeight.scale),
  ).toVar(`${varPrefix}StableMacroGradient`);
  const outerJacobian = inputJacobianColumns ?? [0, 1, 2].map(basisNode);
  const macroGradient = transposeMultiplyColumnsNode(
    outerJacobian,
    stableMacroGradient,
  ).toVar(`${varPrefix}MacroGradient`);
  const ridgeBase = fbmNode(
    q.mul(bands.ridge.scale),
    fieldSeed.add(uint(bands.ridge.seedOffset)),
    bands.ridge,
  ).toVar(`${varPrefix}RidgeBase`);
  const ridge = float(1).sub(abs(ridgeBase.mul(2).sub(1))).toVar(`${varPrefix}Ridge`);
  const cavity = pow(
    float(1).sub(
      fbmNode(
        q.mul(bands.cavity.scale),
        fieldSeed.add(uint(bands.cavity.seedOffset)),
        bands.cavity,
      ),
    ),
    bands.cavity.exponent,
  ).toVar(`${varPrefix}Cavity`);
  const moisture = clampNode(
    fbmNode(
      q.mul(bands.moisture.scale),
      fieldSeed.add(uint(bands.moisture.seedOffset)),
      bands.moisture,
    )
      .mul(bands.moisture.fieldWeight)
      .add(macroHeight.mul(bands.moisture.macroWeight)),
    0,
    1,
  ).toVar(`${varPrefix}Moisture`);
  const slope = clampNode(
    macroGradient.length().mul(derived.slopeScale),
    0,
    1,
  ).toVar(`${varPrefix}Slope`);
  const biome = clampNode(
    moisture
      .mul(derived.biomeMoistureWeight)
      .add(macroHeight.mul(derived.biomeMacroWeight))
      .add(cavity.mul(derived.biomeCavityWeight)),
    0,
    1,
  ).toVar(`${varPrefix}Biome`);
  const roughness = clampNode(
    float(derived.roughnessBase)
      .add(ridge.mul(derived.roughnessRidgeWeight))
      .add(cavity.mul(derived.roughnessCavityWeight))
      .add(moisture.mul(derived.roughnessMoistureWeight)),
    0,
    1,
  ).toVar(`${varPrefix}Roughness`);
  const placementMask = smoothstepNode(
    derived.placementBiomeLow,
    derived.placementBiomeHigh,
    biome,
  )
    .mul(float(1).sub(smoothstepNode(derived.placementSlopeLow, derived.placementSlopeHigh, slope)))
    .toVar(`${varPrefix}PlacementMask`);

  return {
    sourceRadial: radial,
    tangentWarp: tangent,
    stableMacroGradient,
    macroHeight,
    macroGradient,
    ridge,
    cavity,
    moisture,
    slope,
    biome,
    roughness,
    placementMask,
  };
}

// Use this owner whenever a shader needs more than one field channel. The
// named vars above force one evaluation of the expensive field core in the
// generated WGSL. The two Fn wrappers below are single-output conveniences for
// independent passes; calling both in one graph deliberately violates the
// canonical reuse contract.
export function createFieldNodeBundle({
  coordinate,
  seed,
  warpStrength,
  inputJacobianColumns,
  varPrefix = "field",
}) {
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(varPrefix)) {
    throw new Error("varPrefix must be a valid WGSL identifier prefix");
  }
  const fields = fieldNodes({
    coordinate,
    seed,
    warpStrength,
    inputJacobianColumns,
    varPrefix,
  });
  return {
    ...fields,
    packedChannels: vec4(
      fields.macroHeight,
      fields.ridge,
      fields.cavity,
      fields.moisture,
    ).toVar(`${varPrefix}PackedChannels`),
    derivedChannels: vec4(
      fields.slope,
      fields.biome,
      fields.roughness,
      fields.placementMask,
    ).toVar(`${varPrefix}DerivedChannels`),
    gradientChannels: vec4(
      fields.macroGradient,
      fields.slope,
    ).toVar(`${varPrefix}GradientChannels`),
  };
}

export const sampleField = Fn(({ coordinate, seed, warpStrength, inputJacobianColumns }) => {
  return createFieldNodeBundle({
    coordinate,
    seed,
    warpStrength,
    inputJacobianColumns,
  }).packedChannels;
});

export const sampleFieldDerived = Fn(({ coordinate, seed, warpStrength, inputJacobianColumns }) => {
  return createFieldNodeBundle({
    coordinate,
    seed,
    warpStrength,
    inputJacobianColumns,
  }).derivedChannels;
});

export const sampleFieldGradient = Fn(({ coordinate, seed, warpStrength, inputJacobianColumns }) => {
  return createFieldNodeBundle({
    coordinate,
    seed,
    warpStrength,
    inputJacobianColumns,
  }).gradientChannels;
});

export const TSL_FIELD_CONTRACT = `
import { createFieldNodeBundle } from "./field-bundle.mjs";

const bundle = createFieldNodeBundle({
  coordinate,
  seed,
  warpStrength,
});
material.colorNode = bundle.packedChannels;
material.roughnessNode = bundle.roughness;
`;

export function coverage(values) {
  return {
    min: Math.min(...values),
    max: Math.max(...values),
    mean: values.reduce((total, value) => total + value, 0) / values.length,
  };
}
