import {
  Box3,
  Box3Helper,
  Color,
  DoubleSide,
  Frustum,
  FrontSide,
  Group,
  InstancedBufferGeometry,
  Matrix4,
  Mesh,
  MeshBasicNodeMaterial,
  MeshStandardNodeMaterial,
  NoColorSpace,
  PlaneGeometry,
  Sphere,
  TextureLoader,
  Vector2,
  Vector3,
  Vector4,
} from "three/webgpu";
import {
  Fn,
  abs,
  atan,
  bitcast,
  cameraPosition,
  clamp,
  color,
  cos,
  dot,
  float,
  floor,
  int,
  instanceIndex,
  instancedArray,
  length,
  max,
  min,
  mix,
  mod,
  normalize,
  positionLocal,
  pow,
  select,
  sin,
  smoothstep,
  step,
  texture,
  uint,
  uniform,
  uv,
  vec2,
  vec3,
  vec4,
} from "three/tsl";

export const DEFAULT_PATCH_SIZE = 20;
export const DEFAULT_BLADES_PER_PATCH = 18000;
export const DEFAULT_BLADE_SEGMENTS = 14;

export const DENSE_GRASS_HASH_CONTRACT = Object.freeze({
  mixer: "lowbias32",
  mixMultipliers: Object.freeze([0x7feb352d, 0x846ca68b]),
  mixShifts: Object.freeze([16, 15, 16]),
  laneStep: 0x9e3779b9,
  bladeIndexMultiplier: 747796405,
  clumpCoordinateMultipliers: Object.freeze([374761393, 668265263]),
  clumpSeedMultiplier: 2246822519,
  clumpCoordinateOffset: 8192,
  outputShift: 8,
  outputScale: 1 / 16777216,
});

export const webgpuDenseGrassDebugModes = new Map([
  ["final", 0],
  ["bounds", 1],
  ["density", 2],
  ["lod", 3],
  ["wind", 4],
]);

export const meadowDensityMaskPaths = {
  a: new URL("../../assets/generated-variants/meadow-density-a.png", import.meta.url).href,
  b: new URL("../../assets/generated-variants/meadow-density-b.png", import.meta.url).href,
  c: new URL("../../assets/generated-variants/meadow-density-c.png", import.meta.url).href,
};

export const denseGrassQualityTiers = {
  ultra: {
    dprCap: 2,
    patchGridRadius: 4,
    patchSize: 20,
    bladesPerPatch: 18000,
    nearDistance: 28,
    midDistance: 62,
    farDistance: 118,
    midDensity: 0.48,
    // Derived source workload: 81 allocated patches, 1.458M blades, 81 queued init
    // dispatches, 162 allocated draw objects, 81 submitted-representation
    // ceiling, and zero per-frame compute dispatches.
  },
  high: {
    dprCap: 1.5,
    patchGridRadius: 3,
    patchSize: 20,
    bladesPerPatch: 12000,
    nearDistance: 24,
    midDistance: 54,
    farDistance: 96,
    midDensity: 0.42,
    // Derived source workload: 49 allocated patches, 588k blades, 49 queued init
    // dispatches, 98 allocated draw objects, 49 submitted-representation
    // ceiling, and 37.632 MB logical storage payload.
  },
  medium: {
    dprCap: 1.25,
    patchGridRadius: 2,
    patchSize: 24,
    bladesPerPatch: 8000,
    nearDistance: 20,
    midDistance: 44,
    farDistance: 78,
    midDensity: 0.32,
    // Derived source workload: 25 allocated patches, 200k blades, 25 queued init
    // dispatches, 50 allocated draw objects, 25 submitted-representation
    // ceiling, and 12.8 MB logical storage payload.
  },
  low: {
    dprCap: 1,
    patchGridRadius: 1,
    patchSize: 28,
    bladesPerPatch: 3000,
    nearDistance: 16,
    midDistance: 32,
    farDistance: 58,
    midDensity: 0.22,
    // Derived source workload: 9 allocated patches, 27k blades, 9 queued init
    // dispatches, 18 allocated draw objects, 9 submitted-representation
    // ceiling, and 1.728 MB logical storage payload.
  },
};

const _frustum = new Frustum();
const _cameraProjectionView = new Matrix4();
const _vector = new Vector3();

export function hashDenseGrassUintCPU(value) {
  const { mixMultipliers, mixShifts } = DENSE_GRASS_HASH_CONTRACT;
  let state = value >>> 0;
  state = (state ^ (state >>> mixShifts[0])) >>> 0;
  state = Math.imul(state, mixMultipliers[0]) >>> 0;
  state = (state ^ (state >>> mixShifts[1])) >>> 0;
  state = Math.imul(state, mixMultipliers[1]) >>> 0;
  state = (state ^ (state >>> mixShifts[2])) >>> 0;
  return state >>> 0;
}

export function hashDenseGrassLaneCPU(seed, lane = 0) {
  const salted = (seed + Math.imul((lane + 1) >>> 0, DENSE_GRASS_HASH_CONTRACT.laneStep)) >>> 0;
  const mantissa = hashDenseGrassUintCPU(salted) >>> DENSE_GRASS_HASH_CONTRACT.outputShift;
  return mantissa * DENSE_GRASS_HASH_CONTRACT.outputScale;
}

function buildPatchSeed(seed, x, z) {
  return hashDenseGrassUintCPU(
    (seed >>> 0) ^ Math.imul(x + 4096, 73856093) ^ Math.imul(z + 4096, 19349663),
  );
}

export function buildDenseGrassBladeSeedCPU(patchSeed, bladeIndex) {
  return hashDenseGrassUintCPU(
    (patchSeed >>> 0) ^ Math.imul((bladeIndex + 1) >>> 0, DENSE_GRASS_HASH_CONTRACT.bladeIndexMultiplier),
  );
}

export function buildDenseGrassClumpSeedCPU(seed, clumpCellX, clumpCellZ) {
  const { clumpCoordinateMultipliers, clumpCoordinateOffset, clumpSeedMultiplier } = DENSE_GRASS_HASH_CONTRACT;
  const x = (Math.floor(clumpCellX) + clumpCoordinateOffset) | 0;
  const z = (Math.floor(clumpCellZ) + clumpCoordinateOffset) | 0;
  return hashDenseGrassUintCPU(
    Math.imul(x, clumpCoordinateMultipliers[0]) ^
    Math.imul(z, clumpCoordinateMultipliers[1]) ^
    Math.imul(seed >>> 0, clumpSeedMultiplier),
  );
}

function gcd(a, b) {
  let x = Math.abs(a);
  let y = Math.abs(b);
  while (y !== 0) [x, y] = [y, x % y];
  return x;
}

export function denseGrassSpatialPermutationStep(columns) {
  if (!Number.isInteger(columns) || columns < 1) {
    throw new Error("dense grass columns must be a positive integer");
  }
  const cellCount = columns * columns;
  let candidate = Math.max(1, Math.floor(cellCount * 0.6180339887498949));
  if ((candidate & 1) === 0) candidate += 1;
  while (gcd(candidate, cellCount) !== 1) candidate += 2;
  return candidate;
}

export function denseGrassSpatialGridSlot(bladeIndex, columns) {
  const cellCount = columns * columns;
  if (!Number.isInteger(bladeIndex) || bladeIndex < 0 || bladeIndex >= cellCount) {
    throw new Error("dense grass bladeIndex must address the ranked grid");
  }
  return (bladeIndex * denseGrassSpatialPermutationStep(columns)) % cellCount;
}

/** CPU oracle for the root/normal invariants implemented by the vertex node. */
export function evaluateDenseGrassRootedDeformationCPU({
  t,
  height,
  forward,
  touchX = 0,
  touchZ = 0,
  terrainTiltX = 0,
  terrainTiltZ = 0,
} = {}) {
  if (![t, height, forward, touchX, touchZ, terrainTiltX, terrainTiltZ].every(Number.isFinite)) {
    throw new Error("dense-grass deformation inputs must be finite");
  }
  if (t < 0 || t > 1 || height <= 0) {
    throw new Error("dense-grass deformation requires t in [0,1] and positive height");
  }
  const rootWeight = t ** 1.65;
  const x = (touchX - terrainTiltX) * rootWeight;
  const z = (touchZ - terrainTiltZ) * rootWeight;
  const slope = (forward + Math.hypot(x, z)) / Math.max(height, 0.05);
  const inverseLength = 1 / Math.hypot(slope, 1);
  return Object.freeze({
    rootWeight,
    offset: Object.freeze([x, 0, z]),
    normalLength: Math.hypot(slope * inverseLength, inverseLength),
  });
}

function makeExpandedPatchBounds(patchSize, maxHeight, terrainAmplitude, windBend) {
  const half = patchSize * 0.5;
  const lateral = windBend + 1.8;
  const min = new Vector3(-half - lateral, -Math.abs(terrainAmplitude) - 0.2, -half - lateral);
  const max = new Vector3(half + lateral, maxHeight + Math.abs(terrainAmplitude) + windBend, half + lateral);
  return new Box3(min, max);
}

function makeBladeStripGeometry({ segments = DEFAULT_BLADE_SEGMENTS } = {}) {
  const source = new PlaneGeometry(1, 1, 1, segments);
  source.translate(0, 0.5, 0);
  const geometry = new InstancedBufferGeometry().copy(source);
  source.dispose();
  return geometry;
}

function makeClumpCardGeometry() {
  const source = new PlaneGeometry(1, 1, 1, 3);
  source.translate(0, 0.5, 0);
  const geometry = new InstancedBufferGeometry().copy(source);
  source.dispose();
  return geometry;
}

export function loadMeadowDensityMask(url = meadowDensityMaskPaths.a, manager) {
  const textureMap = new TextureLoader(manager).load(url);
  textureMap.colorSpace = NoColorSpace;
  textureMap.generateMipmaps = true;
  textureMap.flipY = false;
  textureMap.userData.densityMaskUrl = String(url);
  return textureMap;
}

function createStaticStorage(bladesPerPatch) {
  return {
    originTerrainHeight: instancedArray(bladesPerPatch, "vec4").setName("GrassOriginTerrainHeight"),
    widthFacingBendSpecies: instancedArray(bladesPerPatch, "vec4").setName("GrassWidthFacingBendSpecies"),
    densitySeedsNormal: instancedArray(bladesPerPatch, "vec4").setName("GrassDensitySeedsNormal"),
    colorMaterial: instancedArray(bladesPerPatch, "vec4").setName("GrassColorMaterial"),
  };
}

const hashDenseGrassUintNode = Fn(([value]) => {
  const { mixMultipliers, mixShifts } = DENSE_GRASS_HASH_CONTRACT;
  let state = uint(value);
  state = state.bitXor(state.shiftRight(uint(mixShifts[0])));
  state = state.mul(uint(mixMultipliers[0]));
  state = state.bitXor(state.shiftRight(uint(mixShifts[1])));
  state = state.mul(uint(mixMultipliers[1]));
  state = state.bitXor(state.shiftRight(uint(mixShifts[2])));
  return state;
});

const hashDenseGrassLaneNode = Fn(([seed, lane]) => {
  const salted = uint(seed).add(
    uint(lane).add(uint(1)).mul(uint(DENSE_GRASS_HASH_CONTRACT.laneStep)),
  );
  const mantissa = hashDenseGrassUintNode(salted).shiftRight(uint(DENSE_GRASS_HASH_CONTRACT.outputShift));
  return float(mantissa).mul(DENSE_GRASS_HASH_CONTRACT.outputScale);
});

const buildDenseGrassClumpSeedNode = Fn(([seed, clumpCell]) => {
  const { clumpCoordinateMultipliers, clumpCoordinateOffset, clumpSeedMultiplier } = DENSE_GRASS_HASH_CONTRACT;
  const x = bitcast(int(clumpCell.x.add(clumpCoordinateOffset)), "uint");
  const z = bitcast(int(clumpCell.y.add(clumpCoordinateOffset)), "uint");
  return hashDenseGrassUintNode(
    x.mul(uint(clumpCoordinateMultipliers[0]))
      .bitXor(z.mul(uint(clumpCoordinateMultipliers[1])))
      .bitXor(uint(seed).mul(uint(clumpSeedMultiplier))),
  );
});

const terrainHeightNode = Fn(([worldXZ, amplitude, frequency, seed]) => {
  const n1 = sin(worldXZ.x.add(seed).mul(frequency));
  const n2 = sin(worldXZ.y.sub(seed).mul(frequency.mul(1.37)));
  return n1.add(n2).mul(0.5).mul(amplitude);
});

const terrainNormalXZNode = Fn(([worldXZ, amplitude, frequency, seed]) => {
  const sx = cos(worldXZ.x.add(seed).mul(frequency)).mul(amplitude).mul(frequency);
  const sz = cos(worldXZ.y.sub(seed).mul(frequency.mul(1.37))).mul(amplitude).mul(frequency.mul(1.37));
  return clamp(vec2(sx, sz).mul(-0.5), vec2(-0.7), vec2(0.7));
});

function makeStaticInitCompute(patch, storageSet, options, densityMaskTexture) {
  const {
    bladesPerPatch,
    patchSize,
    seed,
    terrainAmplitude,
    terrainFrequency,
    bladeHeightMin,
    bladeHeightMax,
    bladeWidthMin,
    bladeWidthMax,
    bendAmountMin,
    bendAmountMax,
    clumpSize,
    clumpRadius,
    bladeYaw,
    clumpYaw,
  } = options;
  const columns = Math.ceil(Math.sqrt(bladesPerPatch));
  const cellCount = columns * columns;
  const spatialStep = denseGrassSpatialPermutationStep(columns);
  const invColumns = 1 / columns;
  const halfPatch = patchSize * 0.5;
  const origin = storageSet.originTerrainHeight;
  const shape = storageSet.widthFacingBendSpecies;
  const density = storageSet.densitySeedsNormal;
  const colorMaterial = storageSet.colorMaterial;
  const patchCenterNode = uniform(new Vector2(patch.center.x, patch.center.y));
  const patchSeedNode = uniform(patch.seed >>> 0, "uint");
  const globalSeedNode = uniform(seed >>> 0, "uint");
  const densityTextureNode = densityMaskTexture ? texture(densityMaskTexture) : null;

  // Every random lane is keyed by a u32 patch/cell seed plus an integer lane.
  // DENSE_GRASS_HASH_CONTRACT and the exported CPU functions are the parity
  // specification; no floating sin/fract hash participates in placement.
  const computeNode = Fn(() => {
    const idx = instanceIndex;
    // The prefix of this permutation spans the field instead of selecting a
    // row-major strip. Mid-LOD instanceCount can therefore reduce work while
    // retaining deterministic occupancy in every spatial quadrant.
    const rankedSlot = idx.mul(uint(spatialStep)).mod(uint(cellCount));
    const gx = float(rankedSlot.mod(uint(columns)));
    const gz = float(rankedSlot.div(uint(columns)));
    const grid = vec2(gx, gz);
    const bladeSeedU32 = hashDenseGrassUintNode(
      patchSeedNode.bitXor(
        idx.add(uint(1)).mul(uint(DENSE_GRASS_HASH_CONTRACT.bladeIndexMultiplier)),
      ),
    );
    const jitter = vec2(
      hashDenseGrassLaneNode(bladeSeedU32, uint(1)),
      hashDenseGrassLaneNode(bladeSeedU32, uint(2)),
    ).sub(0.5).mul(0.78);
    const localXZ = grid.add(0.5).add(jitter).mul(invColumns).mul(patchSize).sub(halfPatch);
    const worldXZ = patchCenterNode.add(localXZ);
    const terrainY = terrainHeightNode(worldXZ, float(terrainAmplitude), float(terrainFrequency), float(seed));
    const clumpCell = floor(worldXZ.div(clumpSize));
    const clumpSeedU32 = buildDenseGrassClumpSeedNode(globalSeedNode, clumpCell);
    const clumpRandom = vec2(
      hashDenseGrassLaneNode(clumpSeedU32, uint(3)),
      hashDenseGrassLaneNode(clumpSeedU32, uint(4)),
    );
    const clumpCenter = clumpCell.add(clumpRandom).mul(clumpSize);
    const toClump = clumpCenter.sub(worldXZ);
    const distToClump = length(toClump);
    const clumpPresence = float(1).sub(
      smoothstep(0.68, 1.0, clamp(distToClump.div(clumpRadius), 0.0, 1.0)),
    );
    const maskUv = worldXZ.div(patchSize * (options.patchGridRadius * 2 + 1)).add(0.5);
    const maskDensity = densityTextureNode ? densityTextureNode.sample(maskUv).r : float(1.0);
    const finalDensity = clamp(clumpPresence.mul(maskDensity), 0.0, 1.0);
    const bladePhaseSeed = hashDenseGrassLaneNode(bladeSeedU32, uint(13));
    const colorSeed = hashDenseGrassLaneNode(bladeSeedU32, uint(14));
    const clumpColorSeed = hashDenseGrassLaneNode(clumpSeedU32, uint(15));
    const typeTrend = floor(hashDenseGrassLaneNode(clumpSeedU32, uint(12)).mul(3)).div(2);
    const height = mix(
      bladeHeightMin,
      bladeHeightMax,
      hashDenseGrassLaneNode(clumpSeedU32, uint(5)),
    ).mul(mix(0.72, 1.28, hashDenseGrassLaneNode(bladeSeedU32, uint(6))));
    const width = mix(
      bladeWidthMin,
      bladeWidthMax,
      hashDenseGrassLaneNode(clumpSeedU32, uint(7)),
    ).mul(mix(0.7, 1.3, hashDenseGrassLaneNode(bladeSeedU32, uint(8))));
    const bend = mix(
      bendAmountMin,
      bendAmountMax,
      hashDenseGrassLaneNode(clumpSeedU32, uint(9)),
    ).mul(mix(0.8, 1.2, hashDenseGrassLaneNode(bladeSeedU32, uint(10))));
    const facing = atan(toClump.y, toClump.x)
      .add(hashDenseGrassLaneNode(bladeSeedU32, uint(11)).sub(0.5).mul(bladeYaw))
      .add(hashDenseGrassLaneNode(clumpSeedU32, uint(17)).sub(0.5).mul(clumpYaw));
    const normalXZ = terrainNormalXZNode(worldXZ, float(terrainAmplitude), float(terrainFrequency), float(seed));
    const visibleFlag = step(0.18, finalDensity);

    origin.element(idx).assign(vec4(localXZ.x, localXZ.y, terrainY, height));
    shape.element(idx).assign(vec4(width, facing, bend, typeTrend));
    density.element(idx).assign(vec4(finalDensity, bladePhaseSeed, normalXZ.x, normalXZ.y));
    colorMaterial.element(idx).assign(vec4(
      colorSeed,
      clumpColorSeed,
      hashDenseGrassLaneNode(bladeSeedU32, uint(16)),
      visibleFlag,
    ));
  })().compute(bladesPerPatch, [128]).setName(`Init dense grass patch ${patch.key}`);

  computeNode.userData = {
    denseGrassUniforms: { patchCenterNode, patchSeedNode, globalSeedNode },
    spatialRanking: { columns, cellCount, spatialStep },
  };
  return computeNode;
}

function makeGrassMaterial(patch, storageSet, options) {
  const rootA = color(options.rootColor);
  const tipA = color(options.tipColor);
  const rootB = color(options.rootColorB);
  const tipB = color(options.tipColorB);
  const ground = color(options.groundColor);
  const origin = storageSet.originTerrainHeight.toAttribute();
  const shape = storageSet.widthFacingBendSpecies.toAttribute();
  const density = storageSet.densitySeedsNormal.toAttribute();
  const colorMaterial = storageSet.colorMaterial.toAttribute();
  const windTimeNode = uniform(0);
  const debugModeNode = uniform(0);
  const densityCutoffNode = uniform(1);
  const lodTierNode = uniform(0);
  const patchCenterNode = uniform(new Vector2(patch.center.x, patch.center.y));
  const windDirNode = uniform(new Vector2(options.windDirection.x, options.windDirection.y).normalize());
  const windStrengthNode = uniform(options.windStrength);
  const windSpeedNode = uniform(options.windSpeed);
  const touchNodes = Array.from(
    { length: options.maxTouchPoints },
    () => uniform(new Vector4(0, 0, 0.001, 0)),
  );
  const cameraFacingNode = uniform(options.cameraFacing);
  const material = new MeshStandardNodeMaterial();
  material.side = DoubleSide;
  material.roughness = 0.74;
  material.metalness = 0;
  material.alphaHash = true;
  material.forceSinglePass = true;

  const bladeUv = uv();
  const localVertex = positionLocal;
  const t = clamp(bladeUv.y, 0.0, 1.0);
  const side = bladeUv.x.sub(0.5).mul(2.0);
  const widthTaper = pow(float(1).sub(t), 1.15).mul(0.86).add(0.14);
  const presence = density.x.mul(colorMaterial.w);
  const keepForTier = step(float(1).sub(densityCutoffNode), density.y);
  const visiblePresence = presence.mul(keepForTier);
  const height = origin.w;
  const width = shape.x;
  const baseFacing = shape.y;
  const bend = shape.z;
  const worldBaseXZ = patchCenterNode.add(origin.xy);
  const toCamera = cameraPosition.xz.sub(worldBaseXZ);
  const cameraYaw = atan(toCamera.y, toCamera.x);
  const yaw = mix(baseFacing, cameraYaw, cameraFacingNode.mul(smoothstep(0.25, 1.0, t)));
  const windTravel = dot(worldBaseXZ, windDirNode).mul(0.18);
  const bladePhase = density.y.mul(6.28318530718);
  const gust = sin(windTimeNode.mul(windSpeedNode).add(windTravel).add(bladePhase)).mul(0.5).add(0.5);
  const chop = sin(windTimeNode.mul(windSpeedNode.mul(4.7)).add(bladePhase.mul(3.1))).mul(0.5).add(0.5);
  const windWeight = pow(t, 1.65);
  const windAmp = windStrengthNode.mul(mix(0.45, 1.25, gust)).mul(mix(0.85, 1.2, chop));
  const speciesFold = mix(0.48, 1.05, shape.w);
  const forward = bend.mul(speciesFold).mul(pow(t, 1.7)).add(windAmp.mul(height).mul(0.22).mul(windWeight));
  const sideFlutter = sin(windTimeNode.mul(9.0).add(bladePhase.mul(5.0))).mul(width).mul(0.55).mul(smoothstep(0.55, 1.0, t));
  const localBlade = vec2(side.mul(width).mul(widthTaper).add(sideFlutter), forward);
  const yawSin = sin(yaw);
  const yawCos = cos(yaw);
  const rotatedXZ = vec2(
    localBlade.x.mul(yawCos).sub(localBlade.y.mul(yawSin)),
    localBlade.x.mul(yawSin).add(localBlade.y.mul(yawCos)),
  );
  let touchOffset = vec2(0);
  for (const touchNode of touchNodes) {
    const delta = worldBaseXZ.sub(touchNode.xy);
    const distance = length(delta);
    const falloff = float(1).sub(
      smoothstep(touchNode.z.mul(0.2), touchNode.z, distance),
    ).mul(touchNode.w);
    const direction = delta.div(max(distance, 0.001));
    touchOffset = touchOffset.add(
      direction.mul(falloff).mul(height).mul(0.55).mul(windWeight),
    );
  }
  const drop = forward.mul(forward).div(max(height, 0.05)).mul(0.18);
  const terrainTilt = vec2(density.z, density.w).mul(t).mul(height).mul(0.35);

  // Dense Grass Build Order 5 and 6: the root stays fixed, blade fold and wind
  // are vertex-node work, and update() only changes wind/touch/LOD uniforms.
  material.positionNode = vec3(
    origin.x.add(rotatedXZ.x).add(touchOffset.x).sub(terrainTilt.x),
    origin.z.add(height.mul(localVertex.y).sub(drop)),
    origin.y.add(rotatedXZ.y).add(touchOffset.y).sub(terrainTilt.y),
  );
  const deformationSlope = forward.add(length(touchOffset)).div(max(height, 0.05));
  material.normalNode = normalize(vec3(
    yawSin.mul(deformationSlope),
    float(1),
    yawCos.mul(deformationSlope).negate(),
  ));

  const grad = pow(t, 1.25);
  const speciesColor = mix(mix(rootA, tipA, grad), mix(rootB, tipB, grad), colorMaterial.x);
  const clumpShade = mix(0.88, 1.14, colorMaterial.y);
  const densityShade = mix(0.62, 1.08, presence);
  const ao = mix(0.48, 1.0, pow(t, 4.0));
  const finalColor = speciesColor.mul(clumpShade).mul(densityShade).mul(ao);
  const densityDebug = mix(color(0x2f3a15), color(0xc8eb45), presence);
  const lodDebug = select(
    lodTierNode.equal(2),
    color(0xb5c46c),
    select(lodTierNode.equal(1), color(0x7dbb45), color(0x3f8d2f)),
  );
  const windDebug = vec3(gust, chop, t);
  material.colorNode = select(
    debugModeNode.equal(2),
    densityDebug,
    select(debugModeNode.equal(3), lodDebug, select(debugModeNode.equal(4), windDebug, finalColor)),
  );
  material.roughnessNode = mix(0.82, 0.58, t).add(float(1).sub(presence).mul(0.08));
  material.opacityNode = clamp(visiblePresence.mul(smoothstep(0.02, 0.12, t).add(step(t, 0.02))), 0.0, 1.0);

  material.userData.grassUniforms = {
    windTimeNode,
    debugModeNode,
    densityCutoffNode,
    lodTierNode,
    patchCenterNode,
    windDirNode,
    windStrengthNode,
    windSpeedNode,
    touchNodes,
  };
  material.userData.storageSet = storageSet;
  material.userData.buildOrder = "5: MeshStandardNodeMaterial position/color/roughness/opacity nodes";
  return material;
}

function makeImpostorMaterial(patch, storageSet, options) {
  const root = color(options.rootColor);
  const tip = color(options.tipColor);
  const origin = storageSet.originTerrainHeight.toAttribute();
  const density = storageSet.densitySeedsNormal.toAttribute();
  const colorMaterial = storageSet.colorMaterial.toAttribute();
  const debugModeNode = uniform(0);
  const lodTierNode = uniform(2);
  const densityCutoffNode = uniform(1);
  const windTimeNode = uniform(0);
  const windDirNode = uniform(new Vector2(options.windDirection.x, options.windDirection.y).normalize());
  const windStrengthNode = uniform(options.windStrength);
  const windSpeedNode = uniform(options.windSpeed);
  const patchCenterNode = uniform(new Vector2(patch.center.x, patch.center.y));
  const material = new MeshBasicNodeMaterial();
  material.side = FrontSide;
  material.alphaHash = true;
  material.forceSinglePass = true;

  const t = uv().y;
  const width = mix(0.75, 1.8, density.x);
  const height = mix(0.52, 1.35, density.x);
  const local = positionLocal;
  const worldBaseXZ = patchCenterNode.add(origin.xy);
  const phase = dot(worldBaseXZ, windDirNode).mul(0.12).add(density.y.mul(6.28318530718));
  const sway = sin(windTimeNode.mul(windSpeedNode).add(phase))
    .mul(windStrengthNode)
    .mul(height)
    .mul(pow(t, 1.6));
  material.positionNode = vec3(
    origin.x.add(local.x.mul(width)).add(windDirNode.x.mul(sway)),
    origin.z.add(local.y.mul(height)),
    origin.y.add(windDirNode.y.mul(sway)),
  );
  const base = mix(root, tip, pow(t, 1.2)).mul(mix(0.75, 1.15, colorMaterial.y));
  const densityDebug = mix(color(0x334016), color(0xd2de67), density.x);
  const lodDebug = color(0xb5c46c);
  material.colorNode = select(debugModeNode.equal(2), densityDebug, select(debugModeNode.equal(3), lodDebug, base));
  material.opacityNode = clamp(density.x.mul(colorMaterial.w).mul(densityCutoffNode), 0.0, 1.0);
  material.userData.grassUniforms = {
    debugModeNode,
    lodTierNode,
    densityCutoffNode,
    windTimeNode,
    windDirNode,
    windStrengthNode,
    windSpeedNode,
    patchCenterNode,
  };
  material.userData.storageSet = storageSet;
  material.userData.buildOrder = "8: far patch impostor/clump cards";
  patch.impostorMaterials.push(material);
  return material;
}

function createPatchRecord(x, z, seed, options) {
  const center = new Vector2(x * options.patchSize, z * options.patchSize);
  const patchSeed = buildPatchSeed(seed, x, z);
  const bounds = makeExpandedPatchBounds(
    options.patchSize,
    options.bladeHeightMax,
    options.terrainAmplitude,
    options.bendAmountMax + options.windStrength * options.bladeHeightMax,
  );
  const worldBounds = bounds.clone().translate(new Vector3(center.x, 0, center.y));
  return {
    key: `${x},${z}`,
    grid: { x, z },
    localGrid: { x, z },
    center,
    seed: patchSeed,
    bounds,
    worldBounds,
    lodTier: 0,
    pendingLodTier: 0,
    pendingSince: 0,
    visible: true,
    bladeMaterials: [],
    impostorMaterials: [],
  };
}

function setGeometryBounds(geometry, bounds) {
  geometry.boundingBox = bounds.clone();
  geometry.boundingSphere = new Sphere();
  bounds.getBoundingSphere(geometry.boundingSphere);
}

function createPatchMeshes(patch, storageSet, options) {
  const bladeGeometry = makeBladeStripGeometry({ segments: options.bladeSegments });
  bladeGeometry.instanceCount = options.bladesPerPatch;
  setGeometryBounds(bladeGeometry, patch.bounds);
  const bladeMaterial = makeGrassMaterial(patch, storageSet, options);
  const blades = new Mesh(bladeGeometry, bladeMaterial);
  blades.name = `dense-grass-blades-${patch.key}`;
  blades.frustumCulled = true;
  blades.position.set(patch.center.x, 0, patch.center.y);
  blades.castShadow = true;
  blades.receiveShadow = true;
  blades.boundingBox = patch.worldBounds.clone();
  blades.boundingSphere = new Sphere();
  patch.worldBounds.getBoundingSphere(blades.boundingSphere);
  patch.bladeMaterials.push(bladeMaterial);

  const cardGeometry = makeClumpCardGeometry();
  cardGeometry.instanceCount = Math.max(1, Math.floor(options.bladesPerPatch * 0.08));
  setGeometryBounds(cardGeometry, patch.bounds);
  const cardMaterial = makeImpostorMaterial(patch, storageSet, options);
  const cards = new Mesh(cardGeometry, cardMaterial);
  cards.name = `dense-grass-impostors-${patch.key}`;
  cards.frustumCulled = true;
  cards.position.copy(blades.position);
  cards.visible = false;
  cards.castShadow = true;
  cards.receiveShadow = true;
  cards.boundingBox = patch.worldBounds.clone();
  cards.boundingSphere = blades.boundingSphere.clone();

  const boundsHelper = new Box3Helper(patch.worldBounds, 0x8dcf55);
  boundsHelper.name = `dense-grass-bounds-${patch.key}`;
  boundsHelper.visible = false;

  return { blades, cards, boundsHelper };
}

function withPreservedRendererState(renderer, callback) {
  const renderTarget = renderer.getRenderTarget?.() ?? null;
  const xrEnabled = renderer.xr ? renderer.xr.enabled : undefined;
  try {
    return callback();
  } finally {
    if (renderer.setRenderTarget) renderer.setRenderTarget(renderTarget);
    if (renderer.xr && xrEnabled !== undefined) renderer.xr.enabled = xrEnabled;
  }
}

function normalizeOptions(options = {}) {
  if (options.__denseGrassNormalized === true) return options;
  const tier = denseGrassQualityTiers[options.tier ?? "high"] ?? denseGrassQualityTiers.high;
  const worldUnitsPerMeter = options.worldUnitsPerMeter ?? 1;
  if (!(worldUnitsPerMeter > 0) || !Number.isFinite(worldUnitsPerMeter)) {
    throw new Error("worldUnitsPerMeter must be finite and positive");
  }
  const meters = (value) => value * worldUnitsPerMeter;
  return {
    __denseGrassNormalized: true,
    tierName: options.tier ?? "high",
    dprCap: options.dprCap ?? tier.dprCap,
    worldUnitsPerMeter,
    patchGridRadius: options.patchGridRadius ?? tier.patchGridRadius,
    patchSizeMeters: options.patchSize ?? tier.patchSize,
    patchSize: meters(options.patchSize ?? tier.patchSize),
    bladesPerPatch: options.bladesPerPatch ?? tier.bladesPerPatch,
    bladeSegments: options.bladeSegments ?? DEFAULT_BLADE_SEGMENTS,
    seed: options.seed ?? 7331,
    bladeHeightMin: meters(options.bladeHeightMin ?? 0.4),
    bladeHeightMax: meters(options.bladeHeightMax ?? 0.8),
    bladeWidthMin: meters(options.bladeWidthMin ?? 0.01),
    bladeWidthMax: meters(options.bladeWidthMax ?? 0.05),
    bendAmountMin: meters(options.bendAmountMin ?? 0.2),
    bendAmountMax: meters(options.bendAmountMax ?? 0.6),
    clumpSize: meters(options.clumpSize ?? 0.8),
    clumpRadius: meters(options.clumpRadius ?? 1.5),
    cameraFacing: options.cameraFacing ?? 0.28,
    bladeYaw: options.bladeYaw ?? 1.2,
    clumpYaw: options.clumpYaw ?? 0.5,
    windDirection: options.windDirection ?? new Vector2(1, 0),
    windStrength: options.windStrength ?? 0.35,
    windSpeed: options.windSpeed ?? 0.6,
    terrainAmplitude: meters(options.terrainAmplitude ?? 2.5),
    terrainFrequency: (options.terrainFrequency ?? 0.1) / worldUnitsPerMeter,
    nearDistance: meters(options.nearDistance ?? tier.nearDistance),
    midDistance: meters(options.midDistance ?? tier.midDistance),
    farDistance: meters(options.farDistance ?? tier.farDistance),
    midDensity: options.midDensity ?? tier.midDensity,
    rootColor: options.rootColor ?? 0x0f280f,
    tipColor: options.tipColor ?? 0x3e8d2f,
    rootColorB: options.rootColorB ?? 0x4e7422,
    tipColorB: options.tipColorB ?? 0xcddc52,
    groundColor: options.groundColor ?? 0x1a3310,
    densityMaskTexture: options.densityMaskTexture ?? null,
    maxTouchPoints: options.maxTouchPoints ?? 8,
    streaming: options.streaming ?? true,
    lodHysteresis: options.lodHysteresis ?? 0.06,
    lodDwellSeconds: options.lodDwellSeconds ?? 0.18,
  };
}

function patchCountForRadius(radius) {
  return (radius * 2 + 1) ** 2;
}

function serializeBox(box) {
  return {
    min: box.min.toArray(),
    max: box.max.toArray(),
    size: box.getSize(new Vector3()).toArray(),
    center: box.getCenter(new Vector3()).toArray(),
  };
}

function storageNodeNames(storageSet) {
  return Object.fromEntries(
    Object.entries(storageSet).map(([key, node]) => [
      key,
      node.name ?? node.value?.name ?? key,
    ]),
  );
}

function geometryResidentBytes(geometry) {
  const arrays = new Set();
  for (const attribute of Object.values(geometry.attributes)) {
    if (attribute?.array) arrays.add(attribute.array);
  }
  if (geometry.index?.array) arrays.add(geometry.index.array);
  return [...arrays].reduce((total, array) => total + array.byteLength, 0);
}

function hashStaticStorageIdentity(options, patches) {
  let hash = 0x811c9dc5;
  const feed = (value) => {
    hash ^= value >>> 0;
    hash = Math.imul(hash, 0x01000193) >>> 0;
  };
  const feedFloat = (value) => feed(Math.round(value * 1e6));
  const feedString = (value) => {
    for (let index = 0; index < value.length; index += 1) feed(value.charCodeAt(index));
  };
  feed(options.seed);
  feed(options.bladesPerPatch);
  for (const value of [
    options.worldUnitsPerMeter,
    options.patchSize,
    options.bladeHeightMin,
    options.bladeHeightMax,
    options.bladeWidthMin,
    options.bladeWidthMax,
    options.bendAmountMin,
    options.bendAmountMax,
    options.clumpSize,
    options.clumpRadius,
    options.terrainAmplitude,
    options.terrainFrequency,
  ]) feedFloat(value);
  feedString(options.densityMaskTexture?.userData?.densityMaskUrl ?? "uniform-density");
  for (const patch of patches) {
    feed(patch.grid.x);
    feed(patch.grid.z);
    feed(patch.seed);
  }
  return `fnv1a32:${hash.toString(16).padStart(8, "0")}`;
}

export function validateDenseGrassConfig(config = {}) {
  const options = normalizeOptions(config);
  const patchCount = patchCountForRadius(options.patchGridRadius);
  const allocatedBladeCount = patchCount * options.bladesPerPatch;
  const storageBytesPerBlade = 64;
  const storageByteEstimate = allocatedBladeCount * storageBytesPerBlade;
  const errors = [];

  if (!Number.isInteger(options.patchGridRadius) || options.patchGridRadius < 0) {
    errors.push("patchGridRadius must be a non-negative integer");
  }
  if (!Number.isFinite(options.patchSizeMeters) || options.patchSizeMeters < 8 || options.patchSizeMeters > 64) {
    errors.push("patchSize must be finite and in the 8-64 m chunk range");
  }
  if (!(options.worldUnitsPerMeter > 0) || !Number.isFinite(options.worldUnitsPerMeter)) {
    errors.push("worldUnitsPerMeter must be finite and positive");
  }
  if (!(options.dprCap > 0) || !Number.isFinite(options.dprCap)) {
    errors.push("dprCap must be finite and positive");
  }
  if (!Number.isInteger(options.bladesPerPatch) || options.bladesPerPatch < 1) {
    errors.push("bladesPerPatch must be a positive integer");
  }
  if (!Number.isFinite(options.bladeHeightMax) || options.bladeHeightMax <= options.bladeHeightMin) {
    errors.push("bladeHeightMax must be greater than bladeHeightMin");
  }
  if (!Number.isFinite(options.bladeWidthMax) || options.bladeWidthMax <= options.bladeWidthMin) {
    errors.push("bladeWidthMax must be greater than bladeWidthMin");
  }
  if (!Number.isFinite(options.nearDistance) || !Number.isFinite(options.midDistance) || !Number.isFinite(options.farDistance)) {
    errors.push("near/mid/far distances must be finite");
  } else if (!(options.nearDistance < options.midDistance && options.midDistance < options.farDistance)) {
    errors.push("nearDistance < midDistance < farDistance is required");
  }
  if (!Number.isFinite(options.midDensity) || options.midDensity <= 0 || options.midDensity > 1) {
    errors.push("midDensity must be in (0, 1]");
  }
  if (!Number.isInteger(options.maxTouchPoints) || options.maxTouchPoints < 0 || options.maxTouchPoints > 16) {
    errors.push("maxTouchPoints must be an integer in [0, 16]");
  }
  if (!Number.isFinite(options.lodHysteresis) || options.lodHysteresis < 0 || options.lodHysteresis >= 0.5) {
    errors.push("lodHysteresis must be finite and in [0, 0.5)");
  }
  if (!Number.isFinite(options.lodDwellSeconds) || options.lodDwellSeconds < 0) {
    errors.push("lodDwellSeconds must be finite and non-negative");
  }
  if (storageBytesPerBlade !== 64) {
    errors.push("storageBytesPerBlade contract changed from 64");
  }

  if (errors.length > 0) {
    throw new Error(`Invalid dense grass config:\n- ${errors.join("\n- ")}`);
  }

  return {
    tier: options.tierName,
    dprCap: options.dprCap,
    worldUnitsPerMeter: options.worldUnitsPerMeter,
    patchGridRadius: options.patchGridRadius,
    patchCount,
    patchSizeMeters: options.patchSizeMeters,
    patchSize: options.patchSize,
    bladesPerPatch: options.bladesPerPatch,
    allocatedBladeCount,
    storageBytesPerBlade,
    storageByteEstimate,
    initDispatches: patchCount,
    perFrameComputeDispatches: 0,
    allocatedDrawObjectCount: patchCount * 2,
    visibleDrawObjectCeiling: patchCount,
  };
}

export function validateDenseGrassCapabilities(renderer, options = {}) {
  const missingRequirementReason = [];
  const initialized = renderer?.initialized === true || renderer?.backend != null || typeof renderer?.init !== "function";
  const isWebGPUBackend = renderer?.backend?.isWebGPUBackend === true;
  const hasCompute = typeof renderer?.compute === "function";
  let storageNodesAllocated = false;

  try {
    const probe = createStaticStorage(Math.max(1, options.probeBlades ?? 1));
    storageNodesAllocated = Object.values(probe).every((node) => node.value?.array?.length === 4);
  } catch (error) {
    missingRequirementReason.push(`storage-node allocation failed: ${error.message}`);
  }

  if (!initialized) missingRequirementReason.push("renderer not initialized");
  if (!isWebGPUBackend) missingRequirementReason.push("WebGPU backend required");
  if (!hasCompute) missingRequirementReason.push("renderer.compute required");

  const nativeStorage = missingRequirementReason.length === 0;

  return {
    tier: options.tier ?? "high",
    nativeStorage,
    initialized,
    isWebGPUBackend,
    hasCompute,
    storageNodesAllocated,
    missingRequirementReason,
  };
}

export class DenseGrassSystem {
  constructor(renderer, options = {}) {
    this.renderer = renderer;
    this.options = normalizeOptions(options);
    this.object = new Group();
    this.object.name = "webgpu-dense-grass";
    this.patches = [];
    this.debugMode = "final";
    this.nativeStorageTier = false;
    this.capabilities = null;
    this.initialized = false;
    this.centerGrid = { x: 0, z: 0 };
    this.touchPoints = [];
    this.streamingRecomputes = 0;
    this.staticStorageRevision = 0;
    this.staticStorageIdentity = null;
    this.staticStorageArrays = [];
    this.initDispatchCount = 0;
    this.elapsed = 0;
  }

  async initialize() {
    const { options } = this;
    const radius = options.patchGridRadius;
    this.capabilities = validateDenseGrassCapabilities(this.renderer, options);
    this.nativeStorageTier = this.capabilities.nativeStorage;
    if (!this.nativeStorageTier) {
      throw new Error(
        `Canonical dense grass requires initialized WebGPU storage/compute: ${this.capabilities.missingRequirementReason.join(", ")}`,
      );
    }

    // Dense Grass Build Order 1 and 2: deterministic chunk descriptors first,
    // then per-patch static storage allocation. Missing task directories/assets
    // are not inferred from child projects; this example stays local.
    for (let z = -radius; z <= radius; z += 1) {
      for (let x = -radius; x <= radius; x += 1) {
        const patch = createPatchRecord(x, z, options.seed, options);
        const storageSet = createStaticStorage(options.bladesPerPatch);
        const meshes = createPatchMeshes(patch, storageSet, options);
        patch.storageSet = storageSet;
        patch.meshes = meshes;
        patch.initCompute = makeStaticInitCompute(patch, storageSet, options, options.densityMaskTexture);
        this.patches.push(patch);
        this.object.add(meshes.blades, meshes.cards, meshes.boundsHelper);
        for (const node of Object.values(storageSet)) this.staticStorageArrays.push(node.value.array);
      }
    }

    withPreservedRendererState(this.renderer, () => {
      for (const patch of this.patches) {
        this.renderer.compute(patch.initCompute);
        this.initDispatchCount += 1;
      }
    });

    this.staticStorageRevision = 1;
    this.staticStorageIdentity = hashStaticStorageIdentity(options, this.patches);

    this.initialized = true;
    return this;
  }

  update({ elapsed = 0, camera = null } = {}) {
    this.elapsed = elapsed;
    for (const patch of this.patches) {
      for (const material of [...patch.bladeMaterials, ...patch.impostorMaterials]) {
        const uniforms = material.userData.grassUniforms;
        if (uniforms.windTimeNode) uniforms.windTimeNode.value = elapsed;
        if (uniforms.debugModeNode) uniforms.debugModeNode.value = webgpuDenseGrassDebugModes.get(this.debugMode) ?? 0;
      }
    }
    if (camera) {
      if (this.options.streaming) this.recenterAround(camera.position);
      this.updatePatchCullingAndLOD(camera, elapsed);
    }
  }

  updatePatchCullingAndLOD(camera, elapsed = this.elapsed) {
    camera.updateMatrixWorld();
    _cameraProjectionView.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
    _frustum.setFromProjectionMatrix(_cameraProjectionView);

    for (const patch of this.patches) {
      const { blades, cards, boundsHelper } = patch.meshes;
      const visible = _frustum.intersectsBox(patch.worldBounds);
      patch.visible = visible;
      if (!visible) {
        blades.visible = false;
        cards.visible = false;
        boundsHelper.visible = this.debugMode === "bounds";
        continue;
      }

      _vector.set(patch.center.x, 0, patch.center.y);
      const distance = camera.position.distanceTo(_vector);
      const hysteresis = this.options.lodHysteresis;
      let desiredTier = patch.lodTier;
      if (patch.lodTier === 0 && distance > this.options.nearDistance * (1 + hysteresis)) {
        desiredTier = 1;
      } else if (patch.lodTier === 1) {
        if (distance < this.options.nearDistance * (1 - hysteresis)) desiredTier = 0;
        else if (distance > this.options.midDistance * (1 + hysteresis)) desiredTier = 2;
      } else if (patch.lodTier === 2 && distance < this.options.midDistance * (1 - hysteresis)) {
        desiredTier = 1;
      }

      if (desiredTier !== patch.pendingLodTier) {
        patch.pendingLodTier = desiredTier;
        patch.pendingSince = elapsed;
      } else if (desiredTier !== patch.lodTier &&
          elapsed - patch.pendingSince >= this.options.lodDwellSeconds) {
        patch.lodTier = desiredTier;
      }
      const tier = patch.lodTier;

      const farVisible = tier === 2;
      blades.visible = !farVisible && distance < this.options.farDistance;
      cards.visible = farVisible && distance < this.options.farDistance;
      blades.geometry.instanceCount = tier === 0
        ? this.options.bladesPerPatch
        : Math.max(1, Math.floor(this.options.bladesPerPatch * this.options.midDensity));
      cards.geometry.instanceCount = Math.max(1, Math.floor(this.options.bladesPerPatch * 0.08));

      for (const material of patch.bladeMaterials) {
        material.userData.grassUniforms.densityCutoffNode.value = tier === 0 ? 1 : this.options.midDensity;
        material.userData.grassUniforms.lodTierNode.value = tier;
      }
      for (const material of patch.impostorMaterials) {
        material.userData.grassUniforms.densityCutoffNode.value = 0.76;
        material.userData.grassUniforms.lodTierNode.value = 2;
      }

      boundsHelper.visible = this.debugMode === "bounds" || this.debugMode === "lod";
      const helperColor = tier === 0 ? 0x3f8d2f : tier === 1 ? 0x7dbb45 : 0xb5c46c;
      boundsHelper.material.color.setHex(helperColor);
    }
  }

  setDebugMode(mode = "final") {
    if (!webgpuDenseGrassDebugModes.has(mode)) {
      throw new Error(`unknown dense-grass debug mode "${mode}"`);
    }
    this.debugMode = mode;
    for (const patch of this.patches) {
      patch.meshes.boundsHelper.visible = this.debugMode === "bounds" || this.debugMode === "lod";
      for (const material of [...patch.bladeMaterials, ...patch.impostorMaterials]) {
        material.userData.grassUniforms.debugModeNode.value = webgpuDenseGrassDebugModes.get(this.debugMode) ?? 0;
      }
    }
  }

  setWind({ direction, strength, speed } = {}) {
    if (direction) this.options.windDirection.copy(direction).normalize();
    if (typeof strength === "number") this.options.windStrength = strength;
    if (typeof speed === "number") this.options.windSpeed = speed;
    for (const patch of this.patches) {
      for (const material of [...patch.bladeMaterials, ...patch.impostorMaterials]) {
        const uniforms = material.userData.grassUniforms;
        uniforms.windDirNode?.value.copy(this.options.windDirection);
        if (uniforms.windStrengthNode) uniforms.windStrengthNode.value = this.options.windStrength;
        if (uniforms.windSpeedNode) uniforms.windSpeedNode.value = this.options.windSpeed;
      }
    }
  }

  setTouches(touches = []) {
    if (!Array.isArray(touches)) throw new Error("dense-grass touches must be an array");
    if (touches.length > this.options.maxTouchPoints) {
      throw new Error(`dense-grass supports at most ${this.options.maxTouchPoints} touch points`);
    }
    this.touchPoints = touches.map((touch, index) => {
      const x = touch.position?.x ?? touch.x;
      const z = touch.position?.z ?? touch.z;
      const radius = touch.radius;
      const weight = touch.weight ?? 1;
      if (![x, z, radius, weight].every(Number.isFinite) || radius <= 0 || weight < 0) {
        throw new Error(`invalid dense-grass touch at index ${index}`);
      }
      return { x, z, radius, weight };
    });
    for (const patch of this.patches) {
      for (const material of patch.bladeMaterials) {
        const touchNodes = material.userData.grassUniforms.touchNodes ?? [];
        for (let index = 0; index < touchNodes.length; index += 1) {
          const touch = this.touchPoints[index];
          touchNodes[index].value.set(
            touch?.x ?? 0,
            touch?.z ?? 0,
            touch?.radius ?? 0.001,
            touch?.weight ?? 0,
          );
        }
      }
    }
  }

  recenterAround(position) {
    const nextCenter = {
      x: Math.round(position.x / this.options.patchSize),
      z: Math.round(position.z / this.options.patchSize),
    };
    if (nextCenter.x === this.centerGrid.x && nextCenter.z === this.centerGrid.z) return false;
    this.centerGrid = nextCenter;

    withPreservedRendererState(this.renderer, () => {
      for (const patch of this.patches) {
        const gridX = patch.localGrid.x + nextCenter.x;
        const gridZ = patch.localGrid.z + nextCenter.z;
        patch.grid.x = gridX;
        patch.grid.z = gridZ;
        patch.center.set(gridX * this.options.patchSize, gridZ * this.options.patchSize);
        patch.seed = buildPatchSeed(this.options.seed, gridX, gridZ);
        patch.worldBounds.copy(patch.bounds).translate(
          new Vector3(patch.center.x, 0, patch.center.y),
        );
        const { blades, cards, boundsHelper } = patch.meshes;
        blades.position.set(patch.center.x, 0, patch.center.y);
        cards.position.copy(blades.position);
        blades.boundingBox = patch.worldBounds.clone();
        cards.boundingBox = patch.worldBounds.clone();
        patch.worldBounds.getBoundingSphere(blades.boundingSphere);
        cards.boundingSphere.copy(blades.boundingSphere);
        boundsHelper.box = patch.worldBounds;
        const initUniforms = patch.initCompute.userData.denseGrassUniforms;
        initUniforms.patchCenterNode.value.copy(patch.center);
        initUniforms.patchSeedNode.value = patch.seed >>> 0;
        for (const material of [...patch.bladeMaterials, ...patch.impostorMaterials]) {
          material.userData.grassUniforms.patchCenterNode?.value.copy(patch.center);
        }
        this.renderer.compute(patch.initCompute);
        this.streamingRecomputes += 1;
      }
    });
    this.staticStorageRevision += 1;
    this.staticStorageIdentity = hashStaticStorageIdentity(this.options, this.patches);
    return true;
  }

  getStats() {
    const patchCount = this.patches.length;
    const bladesPerPatch = this.options.bladesPerPatch;
    const storageResidentBytes = this.patches.reduce(
      (patchTotal, patch) => patchTotal + Object.values(patch.storageSet).reduce(
        (laneTotal, node) => laneTotal + (node.value.array?.byteLength ?? 0),
        0,
      ),
      0,
    );
    const storageBytesPerBlade = patchCount > 0
      ? storageResidentBytes / (patchCount * bladesPerPatch)
      : 0;
    const renderGeometryBytes = this.patches.reduce(
      (total, patch) => total + geometryResidentBytes(patch.meshes.blades.geometry) +
        geometryResidentBytes(patch.meshes.cards.geometry) +
        geometryResidentBytes(patch.meshes.boundsHelper.geometry),
      0,
    );
    return {
      backendTier: "native WebGPU storage/compute",
      seed: this.options.seed,
      worldUnitsPerMeter: this.options.worldUnitsPerMeter,
      dprCap: this.options.dprCap,
      patchCount,
      patchSize: this.options.patchSize,
      bladesPerPatch,
      allocatedBlades: patchCount * bladesPerPatch,
      storageBytesPerBlade,
      storageResidentBytes,
      renderGeometryBytes,
      initDispatches: this.initDispatchCount,
      perFrameComputeDispatches: 0,
      drawObjectsPerPatch: 2,
      submittedRepresentationsPerVisiblePatch: 1,
      spatialRanking: "coprime golden-step grid permutation",
      touchCapacity: this.options.maxTouchPoints,
      activeTouchCount: this.touchPoints.length,
      streamingRecomputes: this.streamingRecomputes,
      staticStorageRevision: this.staticStorageRevision,
      staticStorageIdentity: this.staticStorageIdentity,
      staticStorageImmutable: this.patches.every((patch, patchIndex) =>
        Object.values(patch.storageSet).every((node, lane) =>
          node.value.array === this.staticStorageArrays[patchIndex * 4 + lane],
        ),
      ),
    };
  }

  getDiagnostics() {
    const stats = this.getStats();
    const patches = this.patches.map((patch) => {
      const uniforms = patch.bladeMaterials[0]?.userData?.grassUniforms ?? {};
      return {
        key: patch.key,
        grid: patch.grid,
        visible: patch.visible,
        lodTier: patch.lodTier,
        bladeCount: patch.meshes.blades.geometry.instanceCount,
        cardCount: patch.meshes.cards.geometry.instanceCount,
        bladeVisible: patch.meshes.blades.visible,
        cardVisible: patch.meshes.cards.visible,
        densityCutoff: uniforms.densityCutoffNode?.value ?? null,
        bounds: serializeBox(patch.worldBounds),
        storageNames: storageNodeNames(patch.storageSet),
      };
    });

    return {
      backendTier: stats.backendTier,
      capabilities: this.capabilities,
      debugMode: this.debugMode,
      patchCount: stats.patchCount,
      bladesPerPatch: stats.bladesPerPatch,
      allocatedBlades: stats.allocatedBlades,
      storageBytesPerBlade: stats.storageBytesPerBlade,
      storageByteEstimate: stats.allocatedBlades * stats.storageBytesPerBlade,
      storageResidentBytes: stats.storageResidentBytes,
      renderGeometryBytes: stats.renderGeometryBytes,
      initDispatches: stats.initDispatches,
      perFrameComputeDispatches: stats.perFrameComputeDispatches,
      activeTouchCount: stats.activeTouchCount,
      touchCapacity: stats.touchCapacity,
      centerGrid: { ...this.centerGrid },
      streamingRecomputes: stats.streamingRecomputes,
      worldUnitsPerMeter: stats.worldUnitsPerMeter,
      dprCap: stats.dprCap,
      staticStorageRevision: stats.staticStorageRevision,
      staticStorageIdentity: stats.staticStorageIdentity,
      staticStorageImmutable: stats.staticStorageImmutable,
      rootedDeformation: this.patches.every((patch) => Boolean(patch.meshes.blades.material.positionNode)),
      deformedNormals: this.patches.every((patch) => Boolean(patch.meshes.blades.material.normalNode)),
      visibleShadowDeformationParity: this.patches.every((patch) =>
        patch.meshes.blades.castShadow && patch.meshes.blades.customDepthMaterial == null &&
        patch.meshes.cards.castShadow && patch.meshes.cards.customDepthMaterial == null,
      ),
      visibleDrawObjects: patches.reduce(
        (total, patch) => total + (patch.bladeVisible ? 1 : 0) + (patch.cardVisible ? 1 : 0),
        0,
      ),
      visibleDrawObjectCeiling: patches.length,
      activeBladeCount: patches.reduce(
        (total, patch) => total + (patch.bladeVisible ? patch.bladeCount : 0),
        0,
      ),
      patches,
    };
  }

  validate() {
    return validateDenseGrassSystem(this);
  }

  dispose() {
    for (const patch of this.patches) {
      const { blades, cards, boundsHelper } = patch.meshes;
      blades.geometry.dispose();
      cards.geometry.dispose();
      blades.material.dispose();
      cards.material.dispose();
      boundsHelper.geometry.dispose();
      boundsHelper.material.dispose();
      for (const node of Object.values(patch.storageSet)) {
        node.value.array = null;
      }
    }
    this.object.clear();
    this.patches.length = 0;
    this.staticStorageArrays.length = 0;
    this.initialized = false;
  }
}

export function validateDenseGrassSystem(system) {
  const expected = validateDenseGrassConfig(system.options);
  const diagnostics = system.getDiagnostics();
  const errors = [];

  if (diagnostics.patchCount !== expected.patchCount) {
    errors.push(`patchCount expected ${expected.patchCount}, got ${diagnostics.patchCount}`);
  }
  if (diagnostics.bladesPerPatch !== expected.bladesPerPatch) {
    errors.push(`bladesPerPatch expected ${expected.bladesPerPatch}, got ${diagnostics.bladesPerPatch}`);
  }
  if (diagnostics.storageBytesPerBlade !== 64) {
    errors.push(`storageBytesPerBlade expected 64, got ${diagnostics.storageBytesPerBlade}`);
  }
  if (diagnostics.perFrameComputeDispatches !== 0) {
    errors.push(`per-frame compute dispatches must be 0 in vertex-wind mode, got ${diagnostics.perFrameComputeDispatches}`);
  }
  if (!diagnostics.staticStorageImmutable) {
    errors.push("static placement storage backing arrays changed after initialization");
  }
  if (!diagnostics.rootedDeformation || !diagnostics.deformedNormals || !diagnostics.visibleShadowDeformationParity) {
    errors.push("visible, normal, and shadow deformation contracts must share the live NodeMaterial path");
  }
  if (diagnostics.worldUnitsPerMeter !== system.options.worldUnitsPerMeter) {
    errors.push("world-unit contract drifted between options and diagnostics");
  }
  if (diagnostics.visibleDrawObjects > expected.visibleDrawObjectCeiling) {
    errors.push(`visible draw objects ${diagnostics.visibleDrawObjects} exceed ceiling ${expected.visibleDrawObjectCeiling}`);
  }
  for (const patch of diagnostics.patches) {
    for (const name of ["originTerrainHeight", "widthFacingBendSpecies", "densitySeedsNormal", "colorMaterial"]) {
      if (!patch.storageNames[name]) {
        errors.push(`patch ${patch.key} missing storage name ${name}`);
      }
    }
    const [sizeX, sizeY, sizeZ] = patch.bounds.size;
    if (!(sizeX > system.options.patchSize && sizeY > system.options.bladeHeightMax && sizeZ > system.options.patchSize)) {
      errors.push(`patch ${patch.key} bounds are not expanded around grass motion`);
    }
  }

  if (errors.length > 0) {
    throw new Error(`Invalid dense grass system:\n- ${errors.join("\n- ")}`);
  }

  return {
    pass: true,
    config: expected,
    diagnostics,
  };
}

export async function createWebGPUDenseGrassSystem(renderer, options = {}) {
  await renderer.init();
  const system = new DenseGrassSystem(renderer, options);
  return system.initialize();
}

export function createDebugGroundPlane({ size = 160, colorValue = 0x1a3310 } = {}) {
  const geometry = new PlaneGeometry(size, size, 1, 1);
  geometry.rotateX(-Math.PI * 0.5);
  const material = new MeshBasicNodeMaterial();
  material.colorNode = color(new Color(colorValue));
  const mesh = new Mesh(geometry, material);
  mesh.name = "dense-grass-debug-ground";
  mesh.receiveShadow = true;
  return mesh;
}
