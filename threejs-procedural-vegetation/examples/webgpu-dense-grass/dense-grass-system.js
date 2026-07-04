import {
  Box3,
  Box3Helper,
  Color,
  DoubleSide,
  DynamicDrawUsage,
  Frustum,
  FrontSide,
  Group,
  InstancedMesh,
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
} from "three/webgpu";
import {
  Fn,
  abs,
  atan,
  cameraPosition,
  clamp,
  color,
  cos,
  dot,
  float,
  floor,
  fract,
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
  uniform,
  uv,
  vec2,
  vec3,
  vec4,
} from "three/tsl";

export const DEFAULT_PATCH_SIZE = 20;
export const DEFAULT_BLADES_PER_PATCH = 18000;
export const DEFAULT_BLADE_SEGMENTS = 14;

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
    patchGridRadius: 4,
    patchSize: 20,
    bladesPerPatch: 18000,
    nearDistance: 28,
    midDistance: 62,
    farDistance: 118,
    midDensity: 0.48,
    // Budget: 81 patches, up to 1.46M visible blades, 1 init dispatch per streamed patch,
    // 2 draw objects per visible patch, per-frame compute 0 ms because wind is vertex-node.
  },
  high: {
    patchGridRadius: 3,
    patchSize: 20,
    bladesPerPatch: 12000,
    nearDistance: 24,
    midDistance: 54,
    farDistance: 96,
    midDensity: 0.42,
    // Budget: 49 patches, up to 588k visible blades, static storage 32-64 B/blade,
    // 2-12 submitted patch draws typical after culling.
  },
  medium: {
    patchGridRadius: 2,
    patchSize: 24,
    bladesPerPatch: 8000,
    nearDistance: 20,
    midDistance: 44,
    farDistance: 78,
    midDensity: 0.32,
    // Budget: 25 patches, 200k blades before culling; static CPU-filled
    // storage is documented only for explicit fallback teaching requests.
  },
  low: {
    patchGridRadius: 1,
    patchSize: 28,
    bladesPerPatch: 3000,
    nearDistance: 16,
    midDistance: 32,
    farDistance: 58,
    midDensity: 0.22,
    // Budget: 9 patches, 27k blades plus impostor cards, no dynamic compute.
  },
};

const _matrix = new Matrix4();
const _frustum = new Frustum();
const _cameraProjectionView = new Matrix4();
const _vector = new Vector3();

function clamp01(value) {
  return Math.min(1, Math.max(0, value));
}

function hashUint(value) {
  let state = value >>> 0;
  state ^= state >>> 16;
  state = Math.imul(state, 0x7feb352d);
  state ^= state >>> 15;
  state = Math.imul(state, 0x846ca68b);
  state ^= state >>> 16;
  return state >>> 0;
}

function hashFloat(seed, salt = 0) {
  return hashUint((seed + Math.imul(salt + 1, 0x9e3779b9)) >>> 0) / 4294967295;
}

function buildPatchSeed(seed, x, z) {
  return hashUint((seed >>> 0) ^ Math.imul(x + 4096, 73856093) ^ Math.imul(z + 4096, 19349663));
}

function makeExpandedPatchBounds(patchSize, maxHeight, terrainAmplitude, windBend) {
  const half = patchSize * 0.5;
  const lateral = windBend + 1.8;
  const min = new Vector3(-half - lateral, -Math.abs(terrainAmplitude) - 0.2, -half - lateral);
  const max = new Vector3(half + lateral, maxHeight + Math.abs(terrainAmplitude) + windBend, half + lateral);
  return new Box3(min, max);
}

function makeBladeStripGeometry({ segments = DEFAULT_BLADE_SEGMENTS } = {}) {
  const geometry = new PlaneGeometry(1, 1, 1, segments);
  geometry.translate(0, 0.5, 0);
  return geometry;
}

function makeClumpCardGeometry() {
  const geometry = new PlaneGeometry(1, 1, 1, 3);
  geometry.translate(0, 0.5, 0);
  return geometry;
}

export function loadMeadowDensityMask(url = meadowDensityMaskPaths.a, manager) {
  const textureMap = new TextureLoader(manager).load(url);
  textureMap.colorSpace = NoColorSpace;
  textureMap.generateMipmaps = true;
  textureMap.flipY = false;
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

function markStorageForUpload(storageSet) {
  for (const node of Object.values(storageSet)) {
    node.value.needsUpdate = true;
  }
}

function fillReducedStorageOnCPU(patch, storageSet, options) {
  const {
    bladesPerPatch,
    patchSize,
    terrainAmplitude,
    bladeHeightMin,
    bladeHeightMax,
    bladeWidthMin,
    bladeWidthMax,
    bendAmountMin,
    bendAmountMax,
    clumpSize,
    clumpRadius,
  } = options;
  const columns = Math.ceil(Math.sqrt(bladesPerPatch));
  const half = patchSize * 0.5;
  const originArray = storageSet.originTerrainHeight.value.array;
  const shapeArray = storageSet.widthFacingBendSpecies.value.array;
  const densityArray = storageSet.densitySeedsNormal.value.array;
  const colorArray = storageSet.colorMaterial.value.array;

  for (let index = 0; index < bladesPerPatch; index += 1) {
    const gx = index % columns;
    const gz = Math.floor(index / columns);
    const seedBase = hashUint(patch.seed ^ Math.imul(index + 1, 747796405));
    const jitterX = hashFloat(seedBase, 1) - 0.5;
    const jitterZ = hashFloat(seedBase, 2) - 0.5;
    const localX = (gx + 0.5 + jitterX * 0.78) / columns * patchSize - half;
    const localZ = (gz + 0.5 + jitterZ * 0.78) / columns * patchSize - half;
    const worldX = patch.center.x + localX;
    const worldZ = patch.center.y + localZ;
    const terrain = terrainAmplitude * 0.5 * (
      Math.sin((worldX + options.seed) * options.terrainFrequency) +
      Math.sin((worldZ - options.seed) * options.terrainFrequency * 1.37)
    );
    const clumpCellX = Math.floor(worldX / clumpSize);
    const clumpCellZ = Math.floor(worldZ / clumpSize);
    const clumpSeed = hashUint(Math.imul(clumpCellX + 8192, 374761393) ^ Math.imul(clumpCellZ + 8192, 668265263));
    const clumpCenterX = (clumpCellX + hashFloat(clumpSeed, 3)) * clumpSize;
    const clumpCenterZ = (clumpCellZ + hashFloat(clumpSeed, 4)) * clumpSize;
    const distToClump = Math.hypot(clumpCenterX - worldX, clumpCenterZ - worldZ);
    const density = 1 - smoothstepCPU(0.68, 1, clamp01(distToClump / clumpRadius));
    const height = lerp(bladeHeightMin, bladeHeightMax, hashFloat(clumpSeed, 5)) * lerp(0.72, 1.28, hashFloat(seedBase, 6));
    const width = lerp(bladeWidthMin, bladeWidthMax, hashFloat(clumpSeed, 7)) * lerp(0.7, 1.3, hashFloat(seedBase, 8));
    const bend = lerp(bendAmountMin, bendAmountMax, hashFloat(clumpSeed, 9)) * lerp(0.8, 1.2, hashFloat(seedBase, 10));
    const facing = Math.atan2(clumpCenterZ - worldZ, clumpCenterX - worldX) + (hashFloat(seedBase, 11) - 0.5) * options.bladeYaw;
    const species = Math.floor(hashFloat(clumpSeed, 12) * 3);
    const normalX = clamp((Math.sin(worldX * options.terrainFrequency) * terrainAmplitude) / 6, -0.7, 0.7);
    const normalZ = clamp((Math.cos(worldZ * options.terrainFrequency) * terrainAmplitude) / 6, -0.7, 0.7);
    const o = index * 4;
    originArray[o + 0] = localX;
    originArray[o + 1] = localZ;
    originArray[o + 2] = terrain;
    originArray[o + 3] = height;
    shapeArray[o + 0] = width;
    shapeArray[o + 1] = facing;
    shapeArray[o + 2] = bend;
    shapeArray[o + 3] = species / 2;
    densityArray[o + 0] = density;
    densityArray[o + 1] = hashFloat(seedBase, 13);
    densityArray[o + 2] = normalX;
    densityArray[o + 3] = normalZ;
    colorArray[o + 0] = hashFloat(seedBase, 14);
    colorArray[o + 1] = hashFloat(clumpSeed, 15);
    colorArray[o + 2] = hashFloat(seedBase, 16);
    colorArray[o + 3] = density > 0.18 ? 1 : 0;
  }

  markStorageForUpload(storageSet);
}

function lerp(a, b, t) {
  return a + (b - a) * t;
}

function smoothstepCPU(edge0, edge1, x) {
  const t = clamp01((x - edge0) / (edge1 - edge0));
  return t * t * (3 - 2 * t);
}

const hash11 = Fn(([value]) => {
  return fract(sin(value.mul(127.1)).mul(43758.5453123));
});

const hash21 = Fn(([p]) => {
  return vec2(
    hash11(dot(p, vec2(127.1, 311.7))),
    hash11(dot(p, vec2(269.5, 183.3))),
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
  const invColumns = 1 / columns;
  const halfPatch = patchSize * 0.5;
  const origin = storageSet.originTerrainHeight;
  const shape = storageSet.widthFacingBendSpecies;
  const density = storageSet.densitySeedsNormal;
  const colorMaterial = storageSet.colorMaterial;
  const patchCenterNode = uniform(new Vector2(patch.center.x, patch.center.y));
  const patchSeedNode = uniform(patch.seed + seed * 101);
  const densityTextureNode = densityMaskTexture ? texture(densityMaskTexture) : null;

  // Dense Grass Build Order 3: one deterministic init dispatch per chunk writes static
  // origin, terrain, blade/clump/species, normal, and color material data to storage.
  return Fn(() => {
    const idx = instanceIndex;
    const gx = float(idx.mod(columns));
    const gz = floor(float(idx).mul(invColumns));
    const grid = vec2(gx, gz);
    const cellSeed = grid.add(patchSeedNode);
    const jitter = hash21(cellSeed).sub(0.5).mul(0.78);
    const localXZ = grid.add(0.5).add(jitter).mul(invColumns).mul(patchSize).sub(halfPatch);
    const worldXZ = patchCenterNode.add(localXZ);
    const terrainY = terrainHeightNode(worldXZ, float(terrainAmplitude), float(terrainFrequency), float(seed));
    const clumpCell = floor(worldXZ.div(clumpSize));
    const clumpRandom = hash21(clumpCell.add(patchSeedNode.mul(0.013)));
    const clumpCenter = clumpCell.add(clumpRandom).mul(clumpSize);
    const toClump = clumpCenter.sub(worldXZ);
    const distToClump = length(toClump);
    const clumpPresence = smoothstep(1.0, 0.68, clamp(distToClump.div(clumpRadius), 0.0, 1.0));
    const maskUv = worldXZ.div(patchSize * (options.patchGridRadius * 2 + 1)).add(0.5);
    const maskDensity = densityTextureNode ? densityTextureNode.sample(maskUv).r : float(1.0);
    const finalDensity = clamp(clumpPresence.mul(maskDensity), 0.0, 1.0);
    const bladeSeed = hash11(dot(worldXZ, vec2(37.0, 17.0)).add(patchSeedNode));
    const colorSeed = hash11(dot(worldXZ, vec2(19.3, 53.7)).add(patchSeedNode));
    const clumpSeed = hash11(dot(clumpCell, vec2(47.3, 61.7)).add(patchSeedNode));
    const typeTrend = hash11(dot(clumpCell, vec2(11.0, 23.0)).add(patchSeedNode));
    const height = mix(bladeHeightMin, bladeHeightMax, hash11(clumpSeed.add(1.7))).mul(mix(0.72, 1.28, bladeSeed));
    const width = mix(bladeWidthMin, bladeWidthMax, hash11(clumpSeed.add(3.1))).mul(mix(0.7, 1.3, colorSeed));
    const bend = mix(bendAmountMin, bendAmountMax, hash11(clumpSeed.add(5.3))).mul(mix(0.8, 1.2, bladeSeed));
    const facing = atan(toClump.y, toClump.x)
      .add(bladeSeed.sub(0.5).mul(bladeYaw))
      .add(clumpSeed.sub(0.5).mul(clumpYaw));
    const normalXZ = terrainNormalXZNode(worldXZ, float(terrainAmplitude), float(terrainFrequency), float(seed));
    const visibleFlag = step(0.18, finalDensity);

    origin.element(idx).assign(vec4(localXZ.x, localXZ.y, terrainY, height));
    shape.element(idx).assign(vec4(width, facing, bend, typeTrend));
    density.element(idx).assign(vec4(finalDensity, bladeSeed, normalXZ.x, normalXZ.y));
    colorMaterial.element(idx).assign(vec4(colorSeed, clumpSeed, hash11(bladeSeed.add(9.0)), visibleFlag));
  })().compute(bladesPerPatch, [128]).setName(`Init dense grass patch ${patch.key}`);
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
  const gust = sin(windTimeNode.mul(options.windSpeed).add(windTravel).add(bladePhase)).mul(0.5).add(0.5);
  const chop = sin(windTimeNode.mul(options.windSpeed * 4.7).add(bladePhase.mul(3.1))).mul(0.5).add(0.5);
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
  const drop = forward.mul(forward).div(max(height, 0.05)).mul(0.18);
  const terrainTilt = vec2(density.z, density.w).mul(t).mul(height).mul(0.35);

  // Dense Grass Build Order 5 and 6: the root stays fixed, blade fold and wind
  // are vertex-node work, and update() only changes wind/touch/LOD uniforms.
  material.positionNode = vec3(
    origin.x.add(rotatedXZ.x).sub(terrainTilt.x),
    origin.z.add(height.mul(localVertex.y).sub(drop)),
    origin.y.add(rotatedXZ.y).sub(terrainTilt.y),
  );

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
  const material = new MeshBasicNodeMaterial();
  material.side = FrontSide;
  material.alphaHash = true;
  material.forceSinglePass = true;

  const t = uv().y;
  const width = mix(0.75, 1.8, density.x);
  const height = mix(0.52, 1.35, density.x);
  const local = positionLocal;
  material.positionNode = vec3(
    origin.x.add(local.x.mul(width)),
    origin.z.add(local.y.mul(height)),
    origin.y,
  );
  const base = mix(root, tip, pow(t, 1.2)).mul(mix(0.75, 1.15, colorMaterial.y));
  const densityDebug = mix(color(0x334016), color(0xd2de67), density.x);
  const lodDebug = color(0xb5c46c);
  material.colorNode = select(debugModeNode.equal(2), densityDebug, select(debugModeNode.equal(3), lodDebug, base));
  material.opacityNode = clamp(density.x.mul(colorMaterial.w).mul(densityCutoffNode), 0.0, 1.0);
  material.userData.grassUniforms = { debugModeNode, lodTierNode, densityCutoffNode };
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
    center,
    seed: patchSeed,
    bounds,
    worldBounds,
    lodTier: 0,
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
  setGeometryBounds(bladeGeometry, patch.bounds);
  const bladeMaterial = makeGrassMaterial(patch, storageSet, options);
  const blades = new InstancedMesh(bladeGeometry, bladeMaterial, options.bladesPerPatch);
  blades.name = `dense-grass-blades-${patch.key}`;
  blades.frustumCulled = true;
  blades.position.set(patch.center.x, 0, patch.center.y);
  blades.instanceMatrix.setUsage(DynamicDrawUsage);
  blades.castShadow = true;
  blades.receiveShadow = true;
  blades.boundingBox = patch.worldBounds.clone();
  blades.boundingSphere = new Sphere();
  patch.worldBounds.getBoundingSphere(blades.boundingSphere);
  patch.bladeMaterials.push(bladeMaterial);

  const cardGeometry = makeClumpCardGeometry();
  setGeometryBounds(cardGeometry, patch.bounds);
  const cardMaterial = makeImpostorMaterial(patch, storageSet, options);
  const cards = new InstancedMesh(cardGeometry, cardMaterial, Math.max(1, Math.floor(options.bladesPerPatch * 0.08)));
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

async function withPreservedRendererState(renderer, callback) {
  const renderTarget = renderer.getRenderTarget?.() ?? null;
  const xrEnabled = renderer.xr ? renderer.xr.enabled : undefined;
  try {
    return await callback();
  } finally {
    if (renderer.setRenderTarget) renderer.setRenderTarget(renderTarget);
    if (renderer.xr && xrEnabled !== undefined) renderer.xr.enabled = xrEnabled;
  }
}

function normalizeOptions(options = {}) {
  const tier = denseGrassQualityTiers[options.tier ?? "high"] ?? denseGrassQualityTiers.high;
  return {
    tierName: options.tier ?? "high",
    patchGridRadius: options.patchGridRadius ?? tier.patchGridRadius,
    patchSize: options.patchSize ?? tier.patchSize,
    bladesPerPatch: options.bladesPerPatch ?? tier.bladesPerPatch,
    bladeSegments: options.bladeSegments ?? DEFAULT_BLADE_SEGMENTS,
    seed: options.seed ?? 7331,
    bladeHeightMin: options.bladeHeightMin ?? 0.4,
    bladeHeightMax: options.bladeHeightMax ?? 0.8,
    bladeWidthMin: options.bladeWidthMin ?? 0.01,
    bladeWidthMax: options.bladeWidthMax ?? 0.05,
    bendAmountMin: options.bendAmountMin ?? 0.2,
    bendAmountMax: options.bendAmountMax ?? 0.6,
    clumpSize: options.clumpSize ?? 0.8,
    clumpRadius: options.clumpRadius ?? 1.5,
    cameraFacing: options.cameraFacing ?? 0.28,
    bladeYaw: options.bladeYaw ?? 1.2,
    clumpYaw: options.clumpYaw ?? 0.5,
    windDirection: options.windDirection ?? new Vector2(1, 0),
    windStrength: options.windStrength ?? 0.35,
    windSpeed: options.windSpeed ?? 0.6,
    terrainAmplitude: options.terrainAmplitude ?? 2.5,
    terrainFrequency: options.terrainFrequency ?? 0.1,
    nearDistance: options.nearDistance ?? tier.nearDistance,
    midDistance: options.midDistance ?? tier.midDistance,
    farDistance: options.farDistance ?? tier.farDistance,
    midDensity: options.midDensity ?? tier.midDensity,
    rootColor: options.rootColor ?? 0x0f280f,
    tipColor: options.tipColor ?? 0x3e8d2f,
    rootColorB: options.rootColorB ?? 0x4e7422,
    tipColorB: options.tipColorB ?? 0xcddc52,
    groundColor: options.groundColor ?? 0x1a3310,
    densityMaskTexture: options.densityMaskTexture ?? null,
    explicitFallbackWhenWebGPUUnavailable: options.explicitFallbackWhenWebGPUUnavailable === true,
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
  if (!Number.isFinite(options.patchSize) || options.patchSize < 8 || options.patchSize > 64) {
    errors.push("patchSize must be finite and in the 8-64 m chunk range");
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
  if (storageBytesPerBlade !== 64) {
    errors.push("storageBytesPerBlade contract changed from 64");
  }

  if (errors.length > 0) {
    throw new Error(`Invalid dense grass config:\n- ${errors.join("\n- ")}`);
  }

  return {
    tier: options.tierName,
    patchGridRadius: options.patchGridRadius,
    patchCount,
    patchSize: options.patchSize,
    bladesPerPatch: options.bladesPerPatch,
    allocatedBladeCount,
    storageBytesPerBlade,
    storageByteEstimate,
    initDispatches: patchCount,
    perFrameComputeDispatches: 0,
    visibleDrawObjectCeiling: patchCount * 2,
    reducedActiveBladesPerPatch: Math.min(options.bladesPerPatch, denseGrassQualityTiers.low.bladesPerPatch),
  };
}

export function validateDenseGrassCapabilities(renderer, options = {}) {
  const missingRequirementReason = [];
  const initialized = renderer?.initialized === true || renderer?.backend != null || typeof renderer?.init !== "function";
  const isWebGPUBackend = renderer?.backend?.isWebGPUBackend === true;
  const hasComputeAsync = typeof renderer?.computeAsync === "function";
  let storageNodesAllocated = false;

  try {
    const probe = createStaticStorage(Math.max(1, options.probeBlades ?? 1));
    storageNodesAllocated = Object.values(probe).every((node) => node.value?.array?.length === 4);
  } catch (error) {
    missingRequirementReason.push(`storage-node allocation failed: ${error.message}`);
  }

  if (!initialized) missingRequirementReason.push("renderer not initialized");
  if (!isWebGPUBackend) missingRequirementReason.push("WebGPU backend required");
  if (!hasComputeAsync) missingRequirementReason.push("renderer.computeAsync required");

  const nativeStorage = missingRequirementReason.length === 0;

  return {
    tier: nativeStorage ? (options.tier ?? "high") : "fallback-teaching-static-storage",
    nativeStorage,
    initialized,
    isWebGPUBackend,
    hasComputeAsync,
    storageNodesAllocated,
    missingRequirementReason,
    fallbackTeachingTier: nativeStorage
      ? null
      : {
          dynamicCompute: false,
          cpuFilledStaticStorage: true,
          activeBladesPerPatch: denseGrassQualityTiers.low.bladesPerPatch,
        },
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
  }

  async initialize() {
    const { options } = this;
    const radius = options.patchGridRadius;
    this.capabilities = validateDenseGrassCapabilities(this.renderer, options);
    this.nativeStorageTier = this.capabilities.nativeStorage;
    if (!this.nativeStorageTier && options.explicitFallbackWhenWebGPUUnavailable !== true) {
      throw new Error("WebGPU backend required for the canonical dense grass path. If the user explicitly asks how to apply fallback when WebGPU is unavailable, pass explicitFallbackWhenWebGPUUnavailable and route the teaching to threejs-compatibility-fallbacks.");
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
      }
    }

    if (this.nativeStorageTier) {
      await withPreservedRendererState(this.renderer, async () => {
        for (const patch of this.patches) {
          await this.renderer.computeAsync(patch.initCompute);
        }
      });
    } else {
      for (const patch of this.patches) {
        fillReducedStorageOnCPU(patch, patch.storageSet, {
          ...options,
          bladesPerPatch: Math.min(options.bladesPerPatch, denseGrassQualityTiers.low.bladesPerPatch),
        });
        patch.meshes.blades.count = Math.min(options.bladesPerPatch, denseGrassQualityTiers.low.bladesPerPatch);
      }
    }

    this.initialized = true;
    return this;
  }

  update({ elapsed = 0, camera = null } = {}) {
    for (const patch of this.patches) {
      for (const material of [...patch.bladeMaterials, ...patch.impostorMaterials]) {
        const uniforms = material.userData.grassUniforms;
        if (uniforms.windTimeNode) uniforms.windTimeNode.value = elapsed;
        if (uniforms.debugModeNode) uniforms.debugModeNode.value = webgpuDenseGrassDebugModes.get(this.debugMode) ?? 0;
      }
    }
    if (camera) this.updatePatchCullingAndLOD(camera);
  }

  updatePatchCullingAndLOD(camera) {
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
      const tier = distance > this.options.midDistance ? 2 : distance > this.options.nearDistance ? 1 : 0;
      patch.lodTier = tier;

      const farVisible = distance > this.options.midDistance;
      blades.visible = !farVisible && distance < this.options.farDistance;
      cards.visible = farVisible && distance < this.options.farDistance;
      blades.count = tier === 0
        ? this.options.bladesPerPatch
        : Math.max(1, Math.floor(this.options.bladesPerPatch * this.options.midDensity));
      cards.count = Math.max(1, Math.floor(this.options.bladesPerPatch * 0.08));

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
    this.debugMode = webgpuDenseGrassDebugModes.has(mode) ? mode : "final";
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
  }

  getStats() {
    const patchCount = this.patches.length;
    const bladesPerPatch = this.options.bladesPerPatch;
    return {
      backendTier: this.nativeStorageTier ? "native WebGPU storage/compute" : "explicit fallback teaching static storage",
      seed: this.options.seed,
      patchCount,
      patchSize: this.options.patchSize,
      bladesPerPatch,
      allocatedBlades: patchCount * bladesPerPatch,
      storageBytesPerBlade: 64,
      initDispatches: this.nativeStorageTier ? patchCount : 0,
      perFrameComputeDispatches: 0,
      drawObjectsPerPatch: 2,
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
        bladeCount: patch.meshes.blades.count,
        cardCount: patch.meshes.cards.count,
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
      initDispatches: stats.initDispatches,
      perFrameComputeDispatches: stats.perFrameComputeDispatches,
      visibleDrawObjects: patches.reduce(
        (total, patch) => total + (patch.bladeVisible ? 1 : 0) + (patch.cardVisible ? 1 : 0),
        0,
      ),
      visibleDrawObjectCeiling: patches.length * 2,
      activeBladeCount: patches.reduce(
        (total, patch) => total + (patch.bladeVisible ? patch.bladeCount : 0),
        0,
      ),
      fallbackTeachingActiveBladeCount: this.nativeStorageTier
        ? null
        : patches.reduce((total, patch) => total + patch.bladeCount, 0),
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

  if (!system.nativeStorageTier) {
    const maxReduced = expected.reducedActiveBladesPerPatch * expected.patchCount;
    if (diagnostics.fallbackTeachingActiveBladeCount > maxReduced) {
      errors.push(`fallback teaching active blades ${diagnostics.fallbackTeachingActiveBladeCount} exceed ${maxReduced}`);
    }
    if (diagnostics.initDispatches !== 0) {
      errors.push(`fallback teaching static storage should not report live init dispatches, got ${diagnostics.initDispatches}`);
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
