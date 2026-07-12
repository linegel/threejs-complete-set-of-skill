import { FIELD_ALGORITHM } from "./field-constants.mjs";

// This mirror intentionally rounds after every arithmetic operation that is
// represented by a WGSL f32 operation. It is distinct from the binary64 CPU
// reference in field-bundle.mjs: the binary64 path checks the mathematics,
// while this path checks the shader's declared precision and operation order.
const f32 = Math.fround;
const add = (a, b) => f32(f32(a) + f32(b));
const sub = (a, b) => f32(f32(a) - f32(b));
const mul = (a, b) => f32(f32(a) * f32(b));
const div = (a, b) => f32(f32(a) / f32(b));
const clamp = (value, minimum = 0, maximum = 1) => (
  f32(Math.min(Math.max(f32(value), f32(minimum)), f32(maximum)))
);
const mix = (a, b, t) => add(a, mul(sub(b, a), t));
const length3 = (vector) => f32(Math.sqrt(add(add(
  mul(vector[0], vector[0]),
  mul(vector[1], vector[1]),
), mul(vector[2], vector[2]))));

function smoothstep(edge0, edge1, value) {
  const t = clamp(div(sub(value, edge0), sub(edge1, edge0)));
  return mul(mul(t, t), sub(3, mul(2, t)));
}

function latticeCoordToU32(value) {
  return (Math.floor(f32(value)) | 0) >>> 0;
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
  const h = (
    u32Mul(latticeCoordToU32(x), latticeMultipliers[0]) ^
    u32Mul(latticeCoordToU32(y), latticeMultipliers[1]) ^
    u32Mul(latticeCoordToU32(z), latticeMultipliers[2]) ^
    u32Mul(seedToU32(seed), seedMultiplier)
  ) >>> 0;
  // WGSL performs a u32-to-f32 conversion and then an f32 multiply.
  return mul(f32(lowbias32(h)), f32(outputScale));
}

function valueNoise3WithGradient(position, seed) {
  const x = f32(position[0]);
  const y = f32(position[1]);
  const z = f32(position[2]);
  const x0 = Math.floor(x);
  const y0 = Math.floor(y);
  const z0 = Math.floor(z);
  const fx = sub(x, f32(x0));
  const fy = sub(y, f32(y0));
  const fz = sub(z, f32(z0));
  const tx = smoothstep(0, 1, fx);
  const ty = smoothstep(0, 1, fy);
  const tz = smoothstep(0, 1, fz);
  const dtx = mul(mul(6, fx), sub(1, fx));
  const dty = mul(mul(6, fy), sub(1, fy));
  const dtz = mul(mul(6, fz), sub(1, fz));
  const n000 = hash3(x0, y0, z0, seed);
  const n100 = hash3(x0 + 1, y0, z0, seed);
  const n010 = hash3(x0, y0 + 1, z0, seed);
  const n110 = hash3(x0 + 1, y0 + 1, z0, seed);
  const n001 = hash3(x0, y0, z0 + 1, seed);
  const n101 = hash3(x0 + 1, y0, z0 + 1, seed);
  const n011 = hash3(x0, y0 + 1, z0 + 1, seed);
  const n111 = hash3(x0 + 1, y0 + 1, z0 + 1, seed);
  const nx00 = mix(n000, n100, tx);
  const nx10 = mix(n010, n110, tx);
  const nx01 = mix(n001, n101, tx);
  const nx11 = mix(n011, n111, tx);
  const ny0 = mix(nx00, nx10, ty);
  const ny1 = mix(nx01, nx11, ty);
  const dx0 = mix(mul(sub(n100, n000), dtx), mul(sub(n110, n010), dtx), ty);
  const dx1 = mix(mul(sub(n101, n001), dtx), mul(sub(n111, n011), dtx), ty);
  const dy0 = mul(sub(nx10, nx00), dty);
  const dy1 = mul(sub(nx11, nx01), dty);
  return {
    value: mix(ny0, ny1, tz),
    gradient: [
      mix(dx0, dx1, tz),
      mix(dy0, dy1, tz),
      mul(sub(ny1, ny0), dtz),
    ],
  };
}

function fbmWithGradient(position, seed, config) {
  let value = f32(0);
  const gradient = [f32(0), f32(0), f32(0)];
  let normHost = 0;
  let amplitudeHost = config.initialAmplitude;
  let frequencyHost = config.initialFrequency;

  // Three constructs each octave with host-side constants. Reproduce that
  // exact boundary: host constants evolve in binary64 and are rounded when
  // embedded in each f32 shader operation.
  for (let index = 0; index < config.octaves; index += 1) {
    const amplitude = f32(amplitudeHost);
    const frequency = f32(frequencyHost);
    const sample = valueNoise3WithGradient([
      mul(position[0], frequency),
      mul(position[1], frequency),
      mul(position[2], frequency),
    ], (seed + index * FIELD_ALGORITHM.hash.octaveSeedStep) >>> 0);
    value = add(value, mul(sample.value, amplitude));
    for (let axis = 0; axis < 3; axis += 1) {
      gradient[axis] = add(gradient[axis], mul(mul(
        sample.gradient[axis],
        frequency,
      ), amplitude));
    }
    normHost += amplitudeHost;
    frequencyHost *= config.lacunarity;
    amplitudeHost *= config.gain;
  }
  const norm = f32(normHost);
  return {
    value: div(value, norm),
    gradient: gradient.map((component) => div(component, norm)),
  };
}

function fbm(position, seed, config) {
  return fbmWithGradient(position, seed, config).value;
}

function identityColumn(index) {
  return [f32(index === 0 ? 1 : 0), f32(index === 1 ? 1 : 0), f32(index === 2 ? 1 : 0)];
}

function dot3(a, b) {
  return add(add(mul(a[0], b[0]), mul(a[1], b[1])), mul(a[2], b[2]));
}

function add3(a, b) {
  return [add(a[0], b[0]), add(a[1], b[1]), add(a[2], b[2])];
}

function scale3(vector, scalar) {
  return vector.map((component) => mul(component, scalar));
}

function normalize3(vector, label) {
  const length = length3(vector);
  if (!(length > FIELD_ALGORITHM.coordinates.sphere.minimumRadius)) {
    throw new Error(`${label} must have nonzero f32 length`);
  }
  return vector.map((component) => div(component, length));
}

function normalizationJacobianColumns(vector) {
  const length = length3(vector);
  if (!(length > FIELD_ALGORITHM.coordinates.sphere.minimumRadius)) {
    throw new Error("field coordinates must have nonzero f32 length for tangential warp");
  }
  const radial = vector.map((component) => div(component, length));
  return [0, 1, 2].map((column) => {
    const basis = identityColumn(column);
    return scale3(add3(basis, scale3(radial, sub(0, radial[column]))), div(1, length));
  });
}

function transposeMultiplyColumns(columns, vector) {
  return columns.map((column) => dot3(column, vector));
}

function fieldInputTransformF32({ domain, coordinate }) {
  if (!Array.isArray(coordinate) || coordinate.length !== 3 || coordinate.some(
    (component) => !Number.isFinite(component),
  )) {
    throw new Error("field coordinate must contain three finite components");
  }
  const source = coordinate.map(f32);
  if (domain === "sphere") {
    return {
      coordinate: normalize3(source, "sphere field coordinate"),
      jacobianColumns: normalizationJacobianColumns(source),
      gradientDomain: FIELD_ALGORITHM.coordinates.sphere.gradientDomain,
    };
  }
  if (domain === "world") {
    const scale = f32(FIELD_ALGORITHM.coordinates.world.scale);
    const stable = scale3(source, scale);
    if (Math.max(...stable.map(Math.abs)) > FIELD_ALGORITHM.coordinates.stableMagnitudeGate) {
      throw new Error("world field stable coordinate exceeds the f32 phase gate; rebase or split the coordinate");
    }
    return {
      coordinate: stable,
      jacobianColumns: [0, 1, 2].map((index) => scale3(identityColumn(index), scale)),
      gradientDomain: FIELD_ALGORITHM.coordinates.world.gradientDomain,
    };
  }
  if (domain === "object") {
    if (Math.max(...source.map(Math.abs)) > FIELD_ALGORITHM.coordinates.stableMagnitudeGate) {
      throw new Error("object field coordinate exceeds the f32 phase gate; rebase or split the coordinate");
    }
    return {
      coordinate: source,
      jacobianColumns: [0, 1, 2].map(identityColumn),
      gradientDomain: FIELD_ALGORITHM.coordinates.object.gradientDomain,
    };
  }
  throw new Error(`Unknown field domain "${domain}"`);
}

function warpBundleF32(coordinate, seed) {
  const radial = normalize3(coordinate, "warp coordinate");
  const radialJacobian = normalizationJacobianColumns(coordinate);
  const frequency = f32(FIELD_ALGORITHM.warp.frequency);
  const samples = FIELD_ALGORITHM.warp.seedOffsets.map((offset) => valueNoise3WithGradient(
    scale3(radial, frequency),
    (seed + offset) >>> 0,
  ));
  const warp = samples.map((sample) => sub(sample.value, 0.5));
  const warpGradients = samples.map((sample) => transposeMultiplyColumns(
    radialJacobian,
    scale3(sample.gradient, frequency),
  ));
  const tangent = add3(warp, scale3(radial, sub(0, dot3(warp, radial))));
  const tangentJacobian = [0, 1, 2].map((column) => {
    const dr = radialJacobian[column];
    const dw = [
      warpGradients[0][column],
      warpGradients[1][column],
      warpGradients[2][column],
    ];
    const projectedDw = add3(dw, scale3(radial, sub(0, dot3(radial, dw))));
    return add3(projectedDw, add3(
      scale3(dr, sub(0, dot3(radial, warp))),
      scale3(radial, sub(0, dot3(dr, warp))),
    ));
  });
  return { tangent, tangentJacobian };
}

function sampleFromStableCoordinatesF32({
  coordinate,
  seed,
  warpEnabled,
  inputJacobianColumns,
  gradientDomain,
}) {
  const zeroColumns = [0, 1, 2].map(() => [f32(0), f32(0), f32(0)]);
  const warpBundle = warpEnabled
    ? warpBundleF32(coordinate, seed)
    : { tangent: [f32(0), f32(0), f32(0)], tangentJacobian: zeroColumns };
  const strength = warpEnabled ? f32(FIELD_ALGORITHM.warp.amplitude) : f32(0);
  const coordinateJacobian = [0, 1, 2].map((index) => add3(
    identityColumn(index),
    scale3(warpBundle.tangentJacobian[index], strength),
  ));
  const q = coordinate.map((component, axis) => add(
    component,
    mul(warpBundle.tangent[axis], strength),
  ));
  const { bands, derived } = FIELD_ALGORITHM;
  const macro = bands.macroHeight;
  const macroScale = f32(macro.scale);
  const macroSample = fbmWithGradient(
    scale3(q, macroScale),
    (seed + macro.seedOffset) >>> 0,
    macro,
  );
  const macroHeight = macroSample.value;
  const stableMacroGradient = transposeMultiplyColumns(
    coordinateJacobian,
    scale3(macroSample.gradient, macroScale),
  );
  const macroGradient = transposeMultiplyColumns(inputJacobianColumns, stableMacroGradient);
  const ridgeBase = fbm(
    scale3(q, f32(bands.ridge.scale)),
    (seed + bands.ridge.seedOffset) >>> 0,
    bands.ridge,
  );
  const ridge = sub(1, f32(Math.abs(sub(mul(ridgeBase, 2), 1))));
  const cavityBase = fbm(
    scale3(q, f32(bands.cavity.scale)),
    (seed + bands.cavity.seedOffset) >>> 0,
    bands.cavity,
  );
  const cavity = f32(Math.pow(sub(1, cavityBase), f32(bands.cavity.exponent)));
  const moistureField = fbm(
    scale3(q, f32(bands.moisture.scale)),
    (seed + bands.moisture.seedOffset) >>> 0,
    bands.moisture,
  );
  const moisture = clamp(add(
    mul(moistureField, f32(bands.moisture.fieldWeight)),
    mul(macroHeight, f32(bands.moisture.macroWeight)),
  ));
  const slope = clamp(mul(length3(macroGradient), f32(derived.slopeScale)));
  const biome = clamp(add(add(
    mul(moisture, f32(derived.biomeMoistureWeight)),
    mul(macroHeight, f32(derived.biomeMacroWeight)),
  ), mul(cavity, f32(derived.biomeCavityWeight))));
  const roughness = clamp(add(add(add(
    f32(derived.roughnessBase),
    mul(ridge, f32(derived.roughnessRidgeWeight)),
  ), mul(cavity, f32(derived.roughnessCavityWeight))), mul(
    moisture,
    f32(derived.roughnessMoistureWeight),
  )));
  const placementMask = mul(
    smoothstep(derived.placementBiomeLow, derived.placementBiomeHigh, biome),
    sub(1, smoothstep(derived.placementSlopeLow, derived.placementSlopeHigh, slope)),
  );

  return {
    arithmetic: "explicit-wgsl-f32-operation-mirror-v1",
    tangentWarp: warpBundle.tangent,
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
    packedChannels: { r: macroHeight, g: ridge, b: cavity, a: moisture },
    derivedChannels: { r: slope, g: biome, b: roughness, a: placementMask },
    gradientChannels: {
      r: macroGradient[0],
      g: macroGradient[1],
      b: macroGradient[2],
      a: slope,
    },
  };
}

export const FIELD_F32_ORACLE_CONTRACT = Object.freeze({
  id: "explicit-wgsl-f32-operation-mirror-v1",
  precision: "IEEE-754 binary32",
  operationBoundary: "Math.fround after every declared WGSL f32 arithmetic operation",
  nodeRuntime: "22.22.0",
  hostConstantBoundary:
    "Three.js host constants evolve in JavaScript binary64 and round when embedded in f32 shader operations",
});

export function sampleFieldF32CPU({
  domain,
  coordinate,
  seed = FIELD_ALGORITHM.defaultSeed,
}) {
  if (!Number.isInteger(seed) || seed < -0x80000000 || seed > 0xffffffff) {
    throw new Error("f32 field seed must be a signed-i32/u32-compatible integer");
  }
  const fieldSeed = seed >>> 0;
  const input = fieldInputTransformF32({ domain, coordinate });
  const sample = sampleFromStableCoordinatesF32({
    coordinate: input.coordinate,
    seed: fieldSeed,
    warpEnabled: domain === "sphere",
    inputJacobianColumns: input.jacobianColumns,
    gradientDomain: input.gradientDomain,
  });
  return {
    sourceCoordinates: input.coordinate,
    inputJacobianColumns: input.jacobianColumns,
    warpMode: domain === "sphere" ? "tangential" : "disabled",
    ...sample,
  };
}
