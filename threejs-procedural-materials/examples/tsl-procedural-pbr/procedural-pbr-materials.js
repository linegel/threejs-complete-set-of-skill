import {
  ClampToEdgeWrapping,
  Color,
  DataArrayTexture,
  DataTexture,
  InstancedBufferAttribute,
  LinearFilter,
  LinearMipMapLinearFilter,
  MeshPhysicalNodeMaterial,
  MeshStandardNodeMaterial,
  NoColorSpace,
  RGBAFormat,
  RepeatWrapping,
  SRGBColorSpace,
  StorageInstancedBufferAttribute,
  TextureLoader,
  UnsignedByteType,
} from "three/webgpu";

import {
  attribute,
  color,
  float,
  int,
  mrt,
  fwidth,
  max,
  min,
  mix,
  mx_noise_float,
  mx_worley_noise_float,
  normalLocal,
  normalView,
  positionLocal,
  positionView,
  positionWorld,
  select,
  smoothstep,
  texture,
  triplanarTexture,
  uniform,
  uv,
  vec2,
  vec3,
  vec4,
} from "three/tsl";

export const TRIPLANAR_COST_NOTE =
  "Three.js r185 triplanar projection executes 3 filtered texture operations per input texture; reserve it for UV-less or seam-intolerant close inspection and account for every PBR texture.";

export const PROCEDURAL_PBR_WEBGPU_REQUIRED_MESSAGE =
  "threejs-procedural-materials requires a native WebGPU backend for canonical compute/storage/MRT material work. If the user explicitly asks how to apply fallback when WebGPU is unavailable, route to ../threejs-compatibility-fallbacks/.";

const disposedProceduralMaterials = new WeakSet();

export const proceduralPbrDebugModes = new Map([
  ["final", 0],
  ["coordinates", 1],
  ["identity", 2],
  ["height", 3],
  ["roughness", 4],
  ["roughness-aa", 5],
  ["normal-variance", 6],
  ["metalness", 7],
  ["clearcoat", 8],
  ["dissolve", 9],
  ["emission", 10],
  ["triplanar-weights", 11],
  ["cause-map", 12],
]);

export const lavaCauseMapPaths = {
  a: new URL("../../assets/generated-variants/lava-cause-a.png", import.meta.url).href,
  b: new URL("../../assets/generated-variants/lava-cause-b.png", import.meta.url).href,
  c: new URL("../../assets/generated-variants/lava-cause-c.png", import.meta.url).href,
};

export const authoredPbrIdentities = {
  walnut: {
    label: "oiled walnut",
    provenance: "Authored physical identity; numeric ranges are trial values, not gates",
    baseColor: 0x5a2814,
    secondaryColor: 0x1f0d07,
    roughnessRange: [0.38, 0.50],
    metalnessModel: "dielectric-endpoint",
    metalnessRange: [0, 0],
    clearcoatRange: [0.45, 0.70],
    clearcoatRoughnessRange: [0.22, 0.34],
    heightMetersRange: [0.00015, 0.00060],
  },
  antiqueGold: {
    label: "antique gold",
    provenance: "Authored physical identity; numeric ranges are trial values, not gates",
    baseColor: 0xd0a448,
    secondaryColor: 0x6c4b1f,
    roughnessRange: [0.20, 0.34],
    metalnessModel: "filtered-binary-conductor-mask",
    metalnessRange: [0, 1],
    clearcoatRange: [0.10, 0.30],
    clearcoatRoughnessRange: [0.16, 0.28],
    heightMetersRange: [0.00002, 0.00015],
  },
  ebony: {
    label: "ebony lacquer",
    provenance: "Authored physical identity; numeric ranges are trial values, not gates",
    baseColor: 0x090706,
    secondaryColor: 0x1a1210,
    roughnessRange: [0.30, 0.46],
    metalnessModel: "dielectric-endpoint",
    metalnessRange: [0, 0],
    clearcoatRange: [0.55, 0.85],
    clearcoatRoughnessRange: [0.18, 0.32],
    heightMetersRange: [0.00001, 0.00008],
  },
  wetRock: {
    label: "wet rock",
    provenance: "Authored physical identity; numeric ranges are trial values, not gates",
    baseColor: 0x53605b,
    secondaryColor: 0x17211f,
    roughnessRange: [0.22, 0.82],
    metalnessModel: "dielectric-endpoint",
    metalnessRange: [0, 0],
    clearcoatRange: [0, 0.72],
    clearcoatRoughnessRange: [0.12, 0.32],
    heightMetersRange: [0.0004, 0.0025],
  },
};

export const proceduralPbrQualityTiers = Object.freeze({
  ultra: Object.freeze({ dprCap: 2, bloomScale: 0.5, normalStrength: 1, varianceScale: 1 }),
  high: Object.freeze({ dprCap: 1.5, bloomScale: 0.33, normalStrength: 0.8, varianceScale: 1 }),
  mobile: Object.freeze({ dprCap: 1, bloomScale: 0.25, normalStrength: 0.55, varianceScale: 1.15 }),
});

export const MATERIAL_ATLAS_CONTRACT = Object.freeze({
  width: 128,
  height: 128,
  columns: 2,
  rows: 2,
  baseGutterTexels: 4,
  sampledMipCount: 5,
  colorSpace: "SRGBColorSpace",
});

export const MATERIAL_ARRAY_CONTRACT = Object.freeze({
  width: 32,
  height: 32,
  layers: 4,
  colorSpace: "SRGBColorSpace",
});

export function resolveTierViewport({
  width,
  height,
  requestedDpr,
  tier,
}) {
  const quality = proceduralPbrQualityTiers[tier];
  if (!quality) throw new Error(`Unknown material tier "${tier}"`);
  if (!Number.isInteger(width) || width <= 0 || !Number.isInteger(height) || height <= 0) {
    throw new Error("material viewport dimensions must be positive integers");
  }
  if (!(Number.isFinite(requestedDpr) && requestedDpr > 0)) {
    throw new Error("material viewport DPR must be positive and finite");
  }
  const effectiveDpr = Math.min(requestedDpr, quality.dprCap);
  return Object.freeze({
    width,
    height,
    requestedDpr,
    effectiveDpr,
    physicalWidth: Math.max(1, Math.round(width * effectiveDpr)),
    physicalHeight: Math.max(1, Math.round(height * effectiveDpr)),
    tier,
    dprCap: quality.dprCap,
  });
}

function materialTileColor(tileIndex, x, y, interiorSize) {
  const palette = [
    [180, 72, 36],
    [42, 122, 184],
    [214, 164, 54],
    [55, 148, 91],
  ];
  const base = palette[tileIndex % palette.length];
  const stripe = ((Math.floor((x * 6) / Math.max(interiorSize, 1))
    + Math.floor((y * 6) / Math.max(interiorSize, 1))) & 1) === 0 ? 1 : 0.62;
  return [
    Math.round(base[0] * stripe),
    Math.round(base[1] * stripe),
    Math.round(base[2] * stripe),
    255,
  ];
}

function buildGutteredAtlasLevel({ width, height, columns, rows, gutter }) {
  const cellWidth = width / columns;
  const cellHeight = height / rows;
  if (!Number.isInteger(cellWidth) || !Number.isInteger(cellHeight)) {
    throw new Error("atlas mip dimensions must remain divisible by the tile grid");
  }
  if (gutter * 2 >= cellWidth || gutter * 2 >= cellHeight) {
    throw new Error("atlas mip gutter consumes the tile interior");
  }
  const data = new Uint8Array(width * height * 4);
  for (let tileY = 0; tileY < rows; tileY++) {
    for (let tileX = 0; tileX < columns; tileX++) {
      const tileIndex = tileY * columns + tileX;
      const interiorWidth = cellWidth - 2 * gutter;
      const interiorHeight = cellHeight - 2 * gutter;
      for (let localY = 0; localY < cellHeight; localY++) {
        const sampleY = Math.min(interiorHeight - 1, Math.max(0, localY - gutter));
        for (let localX = 0; localX < cellWidth; localX++) {
          const sampleX = Math.min(interiorWidth - 1, Math.max(0, localX - gutter));
          const rgba = materialTileColor(tileIndex, sampleX, sampleY, Math.max(interiorWidth, interiorHeight));
          const x = tileX * cellWidth + localX;
          const y = tileY * cellHeight + localY;
          data.set(rgba, (y * width + x) * 4);
        }
      }
    }
  }
  return Object.freeze({ data, width, height, gutter, cellWidth, cellHeight });
}

export function createMipSafeMaterialAtlas(contract = MATERIAL_ATLAS_CONTRACT) {
  const gutterContract = validateAtlasGutterContract({
    atlasWidth: contract.width,
    atlasHeight: contract.height,
    columns: contract.columns,
    rows: contract.rows,
    guttersByMip: Array.from(
      { length: contract.sampledMipCount },
      (_, level) => Math.max(1, contract.baseGutterTexels >> level),
    ),
    filterRadiusByMip: Array.from(
      { length: contract.sampledMipCount },
      (_, level) => Math.max(0.5, contract.baseGutterTexels / (2 ** level) - 0.25),
    ),
  });
  const mipmaps = Array.from({ length: contract.sampledMipCount }, (_, level) => {
    const width = contract.width >> level;
    const height = contract.height >> level;
    return buildGutteredAtlasLevel({
      width,
      height,
      columns: contract.columns,
      rows: contract.rows,
      gutter: gutterContract.levels[level].gutter,
    });
  });
  const textureAtlas = new DataTexture(
    mipmaps[0].data,
    mipmaps[0].width,
    mipmaps[0].height,
    RGBAFormat,
    UnsignedByteType,
  );
  textureAtlas.name = "procedural-pbr-mip-safe-color-atlas";
  textureAtlas.mipmaps = mipmaps.map(({ data, width, height }) => ({ data, width, height }));
  textureAtlas.generateMipmaps = false;
  textureAtlas.minFilter = LinearMipMapLinearFilter;
  textureAtlas.magFilter = LinearFilter;
  textureAtlas.wrapS = ClampToEdgeWrapping;
  textureAtlas.wrapT = ClampToEdgeWrapping;
  textureAtlas.colorSpace = SRGBColorSpace;
  textureAtlas.needsUpdate = true;
  textureAtlas.userData.materialAtlas = Object.freeze({
    ...contract,
    levels: mipmaps.map(({ width, height, gutter, cellWidth, cellHeight }) => (
      Object.freeze({ width, height, gutter, cellWidth, cellHeight })
    )),
    gutterGeneration: "per-tile mip generation with nearest-interior extrusion",
  });
  return textureAtlas;
}

export function createMaterialTextureArray(contract = MATERIAL_ARRAY_CONTRACT) {
  const { width, height, layers } = contract;
  const data = new Uint8Array(width * height * layers * 4);
  for (let layer = 0; layer < layers; layer++) {
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const rgba = materialTileColor(layer, x, y, Math.max(width, height));
        data.set(rgba, ((layer * width * height) + y * width + x) * 4);
      }
    }
  }
  const textureArray = new DataArrayTexture(data, width, height, layers);
  textureArray.name = "procedural-pbr-color-texture-array";
  textureArray.format = RGBAFormat;
  textureArray.type = UnsignedByteType;
  textureArray.colorSpace = SRGBColorSpace;
  textureArray.minFilter = LinearMipMapLinearFilter;
  textureArray.magFilter = LinearFilter;
  textureArray.wrapS = RepeatWrapping;
  textureArray.wrapT = RepeatWrapping;
  textureArray.generateMipmaps = true;
  textureArray.needsUpdate = true;
  textureArray.userData.materialArray = Object.freeze({ ...contract });
  return textureArray;
}

export function createTriplanarMaterialTexture({ width = 64, height = 64 } = {}) {
  const data = new Uint8Array(width * height * 4);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const ring = 0.55 + 0.45 * Math.sin(Math.hypot(x - width / 2, y - height / 2) * 0.72);
      data.set([
        Math.round(52 + 88 * ring),
        Math.round(68 + 102 * ring),
        Math.round(78 + 112 * ring),
        255,
      ], (y * width + x) * 4);
    }
  }
  const projectedTexture = new DataTexture(data, width, height, RGBAFormat, UnsignedByteType);
  projectedTexture.name = "procedural-pbr-triplanar-color";
  projectedTexture.colorSpace = SRGBColorSpace;
  projectedTexture.wrapS = RepeatWrapping;
  projectedTexture.wrapT = RepeatWrapping;
  projectedTexture.minFilter = LinearMipMapLinearFilter;
  projectedTexture.magFilter = LinearFilter;
  projectedTexture.generateMipmaps = true;
  projectedTexture.needsUpdate = true;
  return projectedTexture;
}

export function createAtlasArrayTriplanarMaterials({ atlas, textureArray, triplanarMap }) {
  if (!atlas?.isDataTexture || !textureArray?.isDataArrayTexture || !triplanarMap?.isDataTexture) {
    throw new Error("atlas, textureArray, and triplanarMap must be live texture resources");
  }
  const tile = createAtlasTileUvNode({
    atlasWidth: atlas.image.width,
    atlasHeight: atlas.image.height,
    columns: atlas.userData.materialAtlas.columns,
    rows: atlas.userData.materialAtlas.rows,
    tileIndex: 2,
    gutterTexels: atlas.userData.materialAtlas.levels[0].gutter,
  });
  const atlasMaterial = new MeshStandardNodeMaterial({ roughness: 0.48, metalness: 0 });
  atlasMaterial.name = "mip-safe atlas material";
  atlasMaterial.colorNode = texture(atlas, tile.node).rgb;
  atlasMaterial.userData.projectionLedger = describeProjectionLedger({ projection: "uv", colorTextures: 1, dataTextures: 0 });

  const layerNode = int(attribute("instanceTextureLayer", "float"));
  const arrayMaterial = new MeshStandardNodeMaterial({ roughness: 0.52, metalness: 0 });
  arrayMaterial.name = "texture-array material";
  arrayMaterial.colorNode = texture(textureArray).sample(uv()).depth(layerNode).rgb;
  arrayMaterial.userData.projectionLedger = describeProjectionLedger({ projection: "uv", colorTextures: 1, dataTextures: 0 });

  const triplanarMaterial = new MeshStandardNodeMaterial({ roughness: 0.6, metalness: 0 });
  triplanarMaterial.name = "three-axis triplanar material";
  triplanarMaterial.colorNode = createTriplanarProjectionNode(triplanarMap, { scale: 0.72 }).node.rgb;
  triplanarMaterial.userData.projectionLedger = describeProjectionLedger({ projection: "triplanar", colorTextures: 1, dataTextures: 0 });
  return Object.freeze({ atlasMaterial, arrayMaterial, triplanarMaterial });
}

export function createTextureArrayLayerAttribute(instanceCount, layerCount = MATERIAL_ARRAY_CONTRACT.layers) {
  if (!Number.isInteger(instanceCount) || instanceCount <= 0) throw new Error("instanceCount must be positive");
  if (!Number.isInteger(layerCount) || layerCount <= 0) throw new Error("layerCount must be positive");
  const attributeValue = new InstancedBufferAttribute(new Float32Array(instanceCount), 1);
  for (let index = 0; index < instanceCount; index++) attributeValue.array[index] = index % layerCount;
  attributeValue.needsUpdate = true;
  return attributeValue;
}

export function evaluateFilteredBinaryMetalness(cause, footprint, threshold = 0.5) {
  if (![cause, footprint, threshold].every(Number.isFinite) || footprint <= 0) {
    throw new Error("metalness cause, footprint, and threshold must be finite with positive footprint");
  }
  const low = threshold - footprint;
  const high = threshold + footprint;
  if (cause <= low) return 0;
  if (cause >= high) return 1;
  const t = (cause - low) / (high - low);
  return t * t * (3 - 2 * t);
}

export function evaluateDissolveVisibility(cause, threshold, footprint) {
  if (![cause, threshold, footprint].every(Number.isFinite) || footprint <= 0) {
    throw new Error("dissolve inputs must be finite with positive footprint");
  }
  const t = Math.min(1, Math.max(0, (cause - threshold) / footprint));
  return t * t * (3 - 2 * t);
}

export function evaluateWetRockResponse(wetness) {
  if (!Number.isFinite(wetness) || wetness < 0 || wetness > 1) {
    throw new Error("wetness must be finite and inside [0,1]");
  }
  return Object.freeze({
    colorScale: 1 - 0.52 * wetness,
    roughness: 0.82 + (0.22 - 0.82) * wetness,
    clearcoat: 0.72 * wetness,
    clearcoatRoughness: 0.32 + (0.12 - 0.32) * wetness,
    normalStrength: 1 + (0.58 - 1) * wetness,
  });
}

export function validateAtlasGutterContract({
  atlasWidth,
  atlasHeight,
  columns,
  rows,
  guttersByMip,
  filterRadiusByMip,
}) {
  for (const [name, value] of Object.entries({ atlasWidth, atlasHeight, columns, rows })) {
    if (!Number.isInteger(value) || value <= 0) throw new Error(`${name} must be a positive integer`);
  }
  if (atlasWidth % columns !== 0 || atlasHeight % rows !== 0) {
    throw new Error("atlas dimensions must be divisible by the tile grid");
  }
  if (!Array.isArray(guttersByMip) || guttersByMip.length === 0) {
    throw new Error("guttersByMip must contain every sampled mip");
  }
  if (guttersByMip.length !== filterRadiusByMip?.length) {
    throw new Error("gutter and filter-radius mip counts must match");
  }
  const levels = guttersByMip.map((gutter, level) => {
    const required = Math.ceil(filterRadiusByMip[level]);
    if (!Number.isInteger(gutter) || gutter < required) {
      throw new Error(`mip ${level} gutter ${gutter} is below required support ${required}`);
    }
    return Object.freeze({ level, gutter, required });
  });
  return Object.freeze({
    tileWidth: atlasWidth / columns,
    tileHeight: atlasHeight / rows,
    levels: Object.freeze(levels),
  });
}

export function describeProjectionLedger({
  projection = "uv",
  colorTextures = 1,
  dataTextures = 1,
  normalTextures = 0,
  manualTaps = 1,
} = {}) {
  const projectionCount = projection === "triplanar" ? 3 : projection === "top-side" ? 2 : 1;
  for (const [name, value] of Object.entries({ colorTextures, dataTextures, normalTextures, manualTaps })) {
    if (!Number.isInteger(value) || value < 0) throw new Error(`${name} must be a non-negative integer`);
  }
  return Object.freeze({
    projection,
    projectionCount,
    sampledTextureBindings: colorTextures + dataTextures + normalTextures,
    executedSamples: projectionCount * (colorTextures + dataTextures + normalTextures) * manualTaps,
  });
}

export function createAtlasTileUvNode({
  atlasWidth,
  atlasHeight,
  columns,
  rows,
  tileIndex,
  gutterTexels,
}) {
  if (!Number.isInteger(tileIndex) || tileIndex < 0 || tileIndex >= columns * rows) {
    throw new Error("tileIndex is outside the atlas grid");
  }
  const tileWidth = atlasWidth / columns;
  const tileHeight = atlasHeight / rows;
  if (gutterTexels * 2 >= tileWidth || gutterTexels * 2 >= tileHeight) {
    throw new Error("atlas gutter consumes the tile interior");
  }
  const tileX = tileIndex % columns;
  const tileY = Math.floor(tileIndex / columns);
  const origin = vec2(
    (tileX * tileWidth + gutterTexels) / atlasWidth,
    (tileY * tileHeight + gutterTexels) / atlasHeight,
  );
  const span = vec2(
    (tileWidth - 2 * gutterTexels) / atlasWidth,
    (tileHeight - 2 * gutterTexels) / atlasHeight,
  );
  return Object.freeze({ node: origin.add(uv().mul(span)), origin, span });
}

export const authoredLavaIdentity = {
  label: "lava crust and exposed heat",
  lavaHot: 0xff1402,
  lavaCool: 0xb20000,
  emberColor: 0xff5511,
  crustColor: 0x1f1515,
  ashColor: 0x0b0808,
  flowSpeed: 0.1,
  ridgeFrequency: 0.0,
  pulseSpeed: 0.05,
  amplitude: 0.4,
  octaves: 4,
  emissionIntensity: 7.5,
  heightMeters: 0.012,
};

export const authoredBandFilterContract = Object.freeze({
  provenance:
    "Authored trial for fade start/support/variance; qFade end 0.5 is the Derived Nyquist boundary",
  qFade: [0.25, 0.5],
  bands: Object.freeze({
    macro: Object.freeze({ supportMultiplier: 1.5, slopeVarianceCalibration: 1 }),
    grain: Object.freeze({ supportMultiplier: 1.5, slopeVarianceCalibration: 1 }),
    ridge: Object.freeze({ supportMultiplier: 2, slopeVarianceCalibration: 1 }),
    cavity: Object.freeze({ supportMultiplier: 2, slopeVarianceCalibration: 1 }),
  }),
});

function midpoint([minValue, maxValue]) {
  return (minValue + maxValue) * 0.5;
}

function linearColor(hex) {
  return new Color(hex);
}

function validateRange(name, range, {
  minValue = 0,
  maxValue = 1,
  allowEqual = false,
} = {}) {
  const [low, high] = range ?? [];
  if (!Number.isFinite(low) || !Number.isFinite(high)) {
    return `${name} must contain finite min/max values`;
  }
  if (low < minValue || high > maxValue) {
    return `${name} must stay inside [${minValue}, ${maxValue}]`;
  }
  if (allowEqual ? low > high : low >= high) {
    return `${name} must be ordered low < high`;
  }
  return null;
}

function validateMetalnessIdentity(identity, metalnessRange) {
  const [low, high] = metalnessRange;
  const model = identity?.metalnessModel;
  if (model === "dielectric-endpoint" && low === 0 && high === 0) return null;
  if (model === "conductor-endpoint" && low === 1 && high === 1) return null;
  if (model === "filtered-binary-conductor-mask" && low === 0 && high === 1) return null;
  return "metalnessRange must be [0,0] dielectric, [1,1] conductor, or [0,1] with filtered-binary-conductor-mask semantics";
}

export function validateProceduralPbrConfig({
  identity = authoredPbrIdentities.walnut,
  coordinateScale = 1,
  coordinateMode = "object",
  seed = 1,
  emissionIntensity = 0,
  sceneUnitsPerMeter = 1,
  specularVarianceScale = 1,
  causeMaps = [],
  roughnessRange = identity?.roughnessRange,
  metalnessRange = identity?.metalnessRange,
  clearcoatRange = identity?.clearcoatRange ?? [0, 0],
  clearcoatRoughnessRange = identity?.clearcoatRoughnessRange ?? [0, 0],
  heightMetersRange = identity?.heightMetersRange ?? [0, 0],
} = {}) {
  const errors = [];
  for (const rangeError of [
    validateRange("roughnessRange", roughnessRange),
    validateRange("metalnessRange", metalnessRange, { allowEqual: true }),
    validateRange("clearcoatRange", clearcoatRange, { allowEqual: true }),
    validateRange("clearcoatRoughnessRange", clearcoatRoughnessRange, { allowEqual: true }),
    validateRange("heightMetersRange", heightMetersRange, {
      minValue: 0,
      maxValue: Number.POSITIVE_INFINITY,
      allowEqual: true,
    }),
  ]) {
    if (rangeError) errors.push(rangeError);
  }
  const metalnessError = validateMetalnessIdentity(identity, metalnessRange);
  if (metalnessError) errors.push(metalnessError);

  if (!Number.isFinite(coordinateScale) || coordinateScale <= 0) {
    errors.push("coordinateScale must be positive and finite");
  }
  if (coordinateMode !== "object" && coordinateMode !== "world") {
    errors.push('coordinateMode must be "object" or "world"');
  }
  if (!Number.isFinite(seed)) {
    errors.push("seed must be finite");
  }
  if (!Number.isFinite(emissionIntensity) || emissionIntensity < 0) {
    errors.push("emissionIntensity must be finite and non-negative in scene-linear units");
  }
  if (!Number.isFinite(sceneUnitsPerMeter) || sceneUnitsPerMeter <= 0) {
    errors.push("sceneUnitsPerMeter must be positive and finite");
  }
  if (!Number.isFinite(specularVarianceScale) || specularVarianceScale < 0) {
    errors.push("specularVarianceScale must be finite and non-negative");
  }
  for (const [index, causeMap] of causeMaps.entries()) {
    if (causeMap?.colorSpace !== NoColorSpace) {
      errors.push(`causeMaps[${index}] must declare NoColorSpace`);
    }
  }

  if (errors.length > 0) {
    throw new Error(`Invalid procedural PBR config:\n- ${errors.join("\n- ")}`);
  }

  return {
    pass: true,
    coordinateScale,
    coordinateMode,
    seed,
    emissionIntensity,
    sceneUnitsPerMeter,
    specularVarianceScale,
    causeMapCount: causeMaps.length,
  };
}

function createMaterialUniforms({
  seed = 1,
  coordinateScale = 1,
  debugMode = "final",
  specularVarianceScale = 1,
  normalStrength = 1,
  flowTime = 0,
} = {}) {
  return {
    seed: uniform(seed),
    coordinateScale: uniform(coordinateScale),
    debugMode: uniform(proceduralPbrDebugModes.get(debugMode) ?? 0, "int"),
    specularVarianceScale: uniform(specularVarianceScale),
    normalStrength: uniform(normalStrength),
    flowTime: uniform(flowTime),
  };
}

// Build order 1: choose stable coordinates before any channel samples a field.
function createStableCoordinates(uniforms, {
  coordinateMode = "object",
  flow = vec2(0, 0),
} = {}) {
  const base = coordinateMode === "world" ? positionWorld : positionLocal;
  const seedOffset = vec3(
    uniforms.seed.mul(0.113),
    uniforms.seed.mul(0.271),
    uniforms.seed.mul(0.619),
  );
  const p = base.mul(uniforms.coordinateScale).add(seedOffset);
  const uvCoord = uv().mul(uniforms.coordinateScale).add(vec2(uniforms.seed.mul(0.071)));

  return {
    p: p.add(vec3(flow.x, 0, flow.y)),
    uv: uvCoord.add(flow),
    coordinateDebug: p.mul(0.08).add(vec3(0.5)),
  };
}

// Build order 2-4: one structural field cache feeds identity weights,
// causal modifiers, height, roughness, normals, and debug outputs.
function filterStructuralBand(value, domainPosition, {
  name,
  mean,
  heightWeight,
  heightSceneScale,
  surfacePixelSpan,
  supportMultiplier,
  slopeVarianceCalibration,
}) {
  const footprint = fwidth(domainPosition);
  const q = max(max(footprint.x, footprint.y), footprint.z)
    .mul(supportMultiplier)
    .toVar(`material${name}Footprint`);
  const keep = smoothstep(
    authoredBandFilterContract.qFade[0],
    authoredBandFilterContract.qFade[1],
    q,
  ).oneMinus();
  const filteredValue = mix(float(mean), value, keep);

  // For a random-phase sine, mean-square slope is (2*pi*A*f)^2/2.
  // q/surfacePixelSpan estimates support frequency in inverse scene units.
  // The noise-family mismatch is isolated in the authored calibration.
  const supportFrequency = q.div(surfacePixelSpan);
  const heightHalfAmplitude = 0.5 * Math.abs(heightWeight) * heightSceneScale;
  const slopeAmplitude = supportFrequency.mul(2 * Math.PI * heightHalfAmplitude);
  const removedEnergy = keep.mul(keep).oneMinus();
  const removedSlopeVariance = slopeAmplitude.mul(slopeAmplitude)
    .mul(0.5 * slopeVarianceCalibration)
    .mul(removedEnergy);

  return { value: filteredValue, removedSlopeVariance, footprint: q };
}

function createStructuralFields(coords, {
  fiberFrequency = 11.5,
  macroFrequency = 0.75,
  ridgeFrequency = 2.7,
  cavityFrequency = 5.25,
  heightMeters = 0.00025,
  sceneUnitsPerMeter = 1,
} = {}) {
  const surfacePixelSpan = max(
    positionView.dFdx().length(),
    positionView.dFdy().length(),
  ).max(float(1e-8));
  const heightSceneScale = heightMeters * sceneUnitsPerMeter;
  const macroBand = filterStructuralBand(
    mx_noise_float(coords.p.mul(macroFrequency)).mul(0.5).add(0.5),
    coords.p.mul(macroFrequency),
    {
      name: "Macro",
      mean: 0.5,
      heightWeight: 0.38,
      heightSceneScale,
      surfacePixelSpan,
      ...authoredBandFilterContract.bands.macro,
    },
  );
  const grainBand = filterStructuralBand(
    mx_noise_float(coords.p.mul(fiberFrequency)).mul(0.5).add(0.5),
    coords.p.mul(fiberFrequency),
    {
      name: "Grain",
      mean: 0.5,
      heightWeight: 0.44,
      heightSceneScale,
      surfacePixelSpan,
      ...authoredBandFilterContract.bands.grain,
    },
  );
  const ridgeBand = filterStructuralBand(
    mx_worley_noise_float(coords.p.mul(ridgeFrequency)).oneMinus(),
    coords.p.mul(ridgeFrequency),
    {
      name: "Ridge",
      mean: 0.5,
      heightWeight: 0.18,
      heightSceneScale,
      surfacePixelSpan,
      ...authoredBandFilterContract.bands.ridge,
    },
  );
  const cavityBand = filterStructuralBand(
    mx_worley_noise_float(coords.p.mul(cavityFrequency)),
    coords.p.mul(cavityFrequency),
    {
      name: "Cavity",
      mean: 0.5,
      heightWeight: -0.08,
      heightSceneScale,
      surfacePixelSpan,
      ...authoredBandFilterContract.bands.cavity,
    },
  );
  const macro = macroBand.value;
  const grain = grainBand.value;
  const ridge = ridgeBand.value;
  const cavity = cavityBand.value;
  const heightShape = macro.mul(0.38)
    .add(grain.mul(0.44))
    .add(ridge.mul(0.18))
    .sub(cavity.mul(0.08));
  const height = heightShape.mul(heightMeters * sceneUnitsPerMeter);

  return {
    macro,
    grain,
    ridge,
    cavity,
    height,
    heightDisplay: heightShape.mul(0.5).add(0.5),
    unresolvedNormalVariance: macroBand.removedSlopeVariance
      .add(grainBand.removedSlopeVariance)
      .add(ridgeBand.removedSlopeVariance)
      .add(cavityBand.removedSlopeVariance),
    footprint: max(
      max(macroBand.footprint, grainBand.footprint),
      max(ridgeBand.footprint, cavityBand.footprint),
    ),
    heightContract: Object.freeze({ heightMeters, sceneUnitsPerMeter }),
    identityWeight: smoothstep(0.25, 0.88, macro.add(ridge.mul(0.35))),
  };
}

// Build order 9: variants and dissolve come from instanced attributes, not
// cloned materials. Missing attributes compile to zero, which is the intact
// default.
function createPerInstanceDissolve(fields) {
  const instanceDissolve = attribute("instanceDissolve", "float");
  const instanceVariant = attribute("instanceVariant", "float");
  const dissolveCause = fields.macro.mul(0.45)
    .add(fields.ridge.mul(0.35))
    .add(instanceVariant.mul(0.20));
  const filterWidth = max(fwidth(dissolveCause), float(0.002));
  const mask = smoothstep(instanceDissolve, instanceDissolve.add(filterWidth), dissolveCause);

  return {
    instanceDissolve,
    instanceVariant,
    dissolveCause,
    mask,
  };
}

// The built-in texture bump node resamples height at offset UVs. Scalar procedural
// height is already evaluated, so feed its screen-space derivatives directly.
function createDerivativeNormalFromHeight(height, strength = float(1)) {
  const scaledHeight = height.mul(strength);
  const dpdx = positionView.dFdx();
  const dpdy = positionView.dFdy();
  const r1 = dpdy.cross(normalView);
  const r2 = normalView.cross(dpdx);
  const det = dpdx.dot(r1);
  const grad = det.sign().mul(scaledHeight.dFdx().mul(r1).add(scaledHeight.dFdy().mul(r2)));

  return det.abs().mul(normalView).sub(grad).normalize();
}

// Build order 6: transfer slope energy removed by footprint filtering into the
// material microfacet width. Three.js r185 independently adds geometry
// roughness; no final-normal derivative appears here.
function widenRoughnessFromVariance(roughness, normalVariance, specularVarianceScale) {
  const widened = roughness.mul(roughness)
    .add(normalVariance.mul(specularVarianceScale))
    .sqrt();
  return min(float(1), max(roughness, widened));
}

function createSpecularAA(roughness, unresolvedNormalVariance, {
  specularVarianceScale,
}) {
  const normalVariance = max(float(0), unresolvedNormalVariance);
  return {
    normalVariance,
    filteredRoughness: widenRoughnessFromVariance(
      roughness,
      normalVariance,
      specularVarianceScale,
    ),
  };
}

// Build order diagnostics: every debug view is exposed through colorNode while
// preserving the material lighting path.
function applyDebugModes(baseColor, {
  uniforms,
  coords,
  fields,
  roughness,
  filteredRoughness,
  normalVariance,
  metalness,
  clearcoat = float(0),
  dissolve,
  emission = vec3(0),
  triplanarWeights = vec3(0),
  causeMapDebug = vec3(0),
}) {
  let debug = baseColor;
  debug = select(uniforms.debugMode.equal(12), causeMapDebug, debug);
  debug = select(uniforms.debugMode.equal(11), triplanarWeights, debug);
  debug = select(uniforms.debugMode.equal(10), emission.mul(0.08), debug);
  debug = select(uniforms.debugMode.equal(9), vec3(dissolve.mask), debug);
  debug = select(uniforms.debugMode.equal(8), vec3(clearcoat), debug);
  debug = select(uniforms.debugMode.equal(7), vec3(metalness), debug);
  debug = select(uniforms.debugMode.equal(6), vec3(normalVariance.mul(96)), debug);
  debug = select(uniforms.debugMode.equal(5), vec3(filteredRoughness), debug);
  debug = select(uniforms.debugMode.equal(4), vec3(roughness), debug);
  debug = select(uniforms.debugMode.equal(3), vec3(fields.heightDisplay), debug);
  debug = select(uniforms.debugMode.equal(2), vec3(fields.identityWeight), debug);
  debug = select(uniforms.debugMode.equal(1), coords.coordinateDebug, debug);
  return debug;
}

// Build order 7: assign only NodeMaterial PBR slots; do not replace lighting.
function finalizePhysicalMaterial({
  name,
  identity,
  uniforms,
  coords,
  fields,
  colorNode,
  roughnessNode,
  metalnessNode,
  clearcoatNode,
  clearcoatRoughnessNode,
  normalNode,
  dissolve,
  specular,
  triplanarWeights,
}) {
  const material = new MeshPhysicalNodeMaterial({
    name,
    color: linearColor(identity.baseColor),
    roughness: midpoint(identity.roughnessRange),
    metalness: identity.metalnessRange[0],
    clearcoat: midpoint(identity.clearcoatRange),
    clearcoatRoughness: midpoint(identity.clearcoatRoughnessRange),
  });

  material.colorNode = applyDebugModes(colorNode, {
    uniforms,
    coords,
    fields,
    roughness: roughnessNode,
    filteredRoughness: specular.filteredRoughness,
    normalVariance: specular.normalVariance,
    metalness: metalnessNode,
    clearcoat: clearcoatNode,
    dissolve,
    triplanarWeights,
  });
  material.roughnessNode = specular.filteredRoughness;
  material.metalnessNode = metalnessNode;
  material.clearcoatNode = clearcoatNode;
  // This example leaves clearcoatNormalNode unset, so r185 uses normalView for
  // both lobes. Apply the same material-detail variance to clearcoat roughness;
  // a distinct clearcoat normal requires a distinct variance path.
  material.clearcoatRoughnessNode = widenRoughnessFromVariance(
    clearcoatRoughnessNode,
    specular.normalVariance,
    uniforms.specularVarianceScale,
  );
  material.normalNode = normalNode;
  const sharedDissolveMask = dissolve.mask.greaterThan(0.5);
  material.opacityNode = dissolve.mask;
  material.alphaTestNode = float(0.5);
  material.maskNode = sharedDissolveMask;
  material.maskShadowNode = sharedDissolveMask;
  material.mrtNode = mrt({
    materialAlbedo: vec4(colorNode, 1),
    materialParams: vec4(
      specular.filteredRoughness,
      metalnessNode,
      clearcoatNode,
      dissolve.mask,
    ),
    materialNormal: vec4(normalNode.mul(0.5).add(0.5), 1),
    materialFootprint: vec4(vec3(fields.footprint), 1),
    materialNormalVariance: vec4(vec3(specular.normalVariance), 1),
  });
  material.userData.proceduralPbr = {
    uniforms,
    disposeTextures: [],
    normalVarianceSource: "footprint-removed-material-slope-energy",
    geometryRoughnessOwner: "three-r185-getRoughness",
    clearcoatVarianceSource: "shared-normalView-material-slope-energy",
    specularVarianceScale: {
      value: uniforms.specularVarianceScale.value,
      provenance: "Authored trial; calibrate against a supersampled radiance reference",
    },
    heightUnit: "scene units = meters * sceneUnitsPerMeter",
    heightContract: fields.heightContract,
    responseBundle: identity.label,
    dissolveParity: Object.freeze({
      visibleMaskNode: sharedDissolveMask,
      shadowMaskNode: sharedDissolveMask,
      sameNodeIdentity: true,
      positionOwner: "shared undeformed positionLocal",
    }),
  };

  return material;
}

function createWoodLikeMaterial(identity, {
  seed = 17,
  coordinateScale = 1.35,
  coordinateMode = "object",
  debugMode = "final",
  specularVarianceScale = 1,
  normalStrength = 1,
  sceneUnitsPerMeter = 1,
  triplanarMap = null,
} = {}) {
  validateProceduralPbrConfig({
    identity,
    coordinateScale,
    coordinateMode,
    sceneUnitsPerMeter,
    specularVarianceScale,
  });
  const uniforms = createMaterialUniforms({
    seed,
    coordinateScale,
    debugMode,
    specularVarianceScale,
    normalStrength,
  });
  const coords = createStableCoordinates(uniforms, { coordinateMode });
  const fields = createStructuralFields(coords, {
    fiberFrequency: 16,
    macroFrequency: 0.52,
    ridgeFrequency: 1.8,
    cavityFrequency: 9.5,
    heightMeters: midpoint(identity.heightMetersRange),
    sceneUnitsPerMeter,
  });
  const dissolve = createPerInstanceDissolve(fields);
  const grainColor = mix(color(identity.secondaryColor), color(identity.baseColor), fields.identityWeight);
  const colorNode = triplanarMap
    ? mix(grainColor, createTriplanarProjectionNode(triplanarMap, { scale: 1.2 }).node.rgb, 0.22)
    : grainColor.mul(fields.grain.mul(0.18).add(0.9));
  const roughness = mix(float(identity.roughnessRange[0]), float(identity.roughnessRange[1]), fields.cavity);
  const normalNode = createDerivativeNormalFromHeight(fields.height, float(1.0).mul(uniforms.normalStrength));
  const specular = createSpecularAA(roughness, fields.unresolvedNormalVariance, {
    specularVarianceScale: uniforms.specularVarianceScale,
  });

  return finalizePhysicalMaterial({
    name: identity.label,
    identity,
    uniforms,
    coords,
    fields,
    colorNode,
    roughnessNode: roughness,
    metalnessNode: float(0),
    clearcoatNode: mix(float(identity.clearcoatRange[0]), float(identity.clearcoatRange[1]), fields.grain),
    clearcoatRoughnessNode: mix(float(identity.clearcoatRoughnessRange[0]), float(identity.clearcoatRoughnessRange[1]), fields.cavity),
    normalNode,
    dissolve,
    specular,
    triplanarWeights: createTriplanarWeights(normalLocal),
  });
}

export function createWalnutPbrMaterial(options = {}) {
  return createWoodLikeMaterial(authoredPbrIdentities.walnut, options);
}

export function createEbonyFramePbrMaterial(options = {}) {
  const material = createWoodLikeMaterial(authoredPbrIdentities.ebony, {
    seed: 29,
    coordinateScale: 1.8,
    specularVarianceScale: 1,
    ...options,
  });
  material.name = "ebony lacquer frame";
  return material;
}

export function createAntiqueGoldPbrMaterial({
  seed = 23,
  coordinateScale = 2.2,
  coordinateMode = "object",
  debugMode = "final",
  specularVarianceScale = 1,
  normalStrength = 0.75,
  sceneUnitsPerMeter = 1,
} = {}) {
  const identity = authoredPbrIdentities.antiqueGold;
  validateProceduralPbrConfig({
    identity,
    coordinateScale,
    coordinateMode,
    sceneUnitsPerMeter,
    specularVarianceScale,
  });
  const uniforms = createMaterialUniforms({
    seed,
    coordinateScale,
    debugMode,
    specularVarianceScale,
    normalStrength,
  });
  const coords = createStableCoordinates(uniforms, { coordinateMode });
  const fields = createStructuralFields(coords, {
    fiberFrequency: 5.0,
    macroFrequency: 1.05,
    ridgeFrequency: 5.5,
    cavityFrequency: 12.0,
    heightMeters: midpoint(identity.heightMetersRange),
    sceneUnitsPerMeter,
  });
  const dissolve = createPerInstanceDissolve(fields);
  const tarnish = smoothstep(0.42, 0.82, fields.cavity);
  const wornEdge = smoothstep(0.45, 0.86, fields.ridge);
  // Conductor and dielectric are discrete identities. The only fractional
  // values occur inside the derivative-sized reconstruction boundary.
  const conductorCause = fields.ridge.sub(fields.cavity.mul(0.38));
  const conductorBoundary = max(fwidth(conductorCause), float(0.002));
  const exposedConductor = smoothstep(
    float(0.5).sub(conductorBoundary),
    float(0.5).add(conductorBoundary),
    conductorCause,
  );
  const base = mix(color(identity.secondaryColor), color(identity.baseColor), wornEdge);
  const colorNode = mix(base, color(0x2c3324), tarnish.mul(0.28));
  const roughness = mix(float(identity.roughnessRange[0]), float(identity.roughnessRange[1]), tarnish);
  const normalNode = createDerivativeNormalFromHeight(fields.height, float(0.65).mul(uniforms.normalStrength));
  const specular = createSpecularAA(roughness, fields.unresolvedNormalVariance, {
    specularVarianceScale: uniforms.specularVarianceScale,
  });

  const material = finalizePhysicalMaterial({
    name: identity.label,
    identity,
    uniforms,
    coords,
    fields,
    colorNode,
    roughnessNode: roughness,
    metalnessNode: exposedConductor,
    clearcoatNode: mix(float(identity.clearcoatRange[0]), float(identity.clearcoatRange[1]), tarnish.oneMinus()),
    clearcoatRoughnessNode: mix(float(identity.clearcoatRoughnessRange[0]), float(identity.clearcoatRoughnessRange[1]), tarnish),
    normalNode,
    dissolve,
    specular,
    triplanarWeights: createTriplanarWeights(normalLocal),
  });
  material.userData.proceduralPbr.metalnessIdentity = Object.freeze({
    conductorValue: 1,
    dielectricValue: 0,
    transition: "fwidth-filtered subpixel reconstruction boundary only",
    cause: "ridge - 0.38*cavity",
  });
  return material;
}

export function createWetRockPbrMaterial({
  seed = 37,
  coordinateScale = 1.1,
  debugMode = "final",
  specularVarianceScale = 1,
  normalStrength = 1,
  sceneUnitsPerMeter = 1,
  waterlineWorldY = 0.45,
} = {}) {
  const identity = authoredPbrIdentities.wetRock;
  validateProceduralPbrConfig({
    identity,
    coordinateScale,
    coordinateMode: "world",
    sceneUnitsPerMeter,
    specularVarianceScale,
  });
  const uniforms = createMaterialUniforms({
    seed,
    coordinateScale,
    debugMode,
    specularVarianceScale,
    normalStrength,
  });
  const coords = createStableCoordinates(uniforms, { coordinateMode: "world" });
  const fields = createStructuralFields(coords, {
    fiberFrequency: 3.5,
    macroFrequency: 0.42,
    ridgeFrequency: 2.8,
    cavityFrequency: 7.5,
    heightMeters: midpoint(identity.heightMetersRange),
    sceneUnitsPerMeter,
  });
  const dissolve = createPerInstanceDissolve(fields);
  const heightWetness = smoothstep(
    waterlineWorldY - 0.18,
    waterlineWorldY + 0.18,
    positionWorld.y,
  ).oneMinus();
  const pooledWetness = heightWetness
    .mul(fields.cavity.mul(0.55).add(fields.macro.mul(0.45)))
    .clamp(0, 1);
  const dryColor = mix(color(identity.secondaryColor), color(identity.baseColor), fields.identityWeight);
  const wetColor = dryColor.mul(0.48);
  const colorNode = mix(dryColor, wetColor, pooledWetness);
  const roughness = mix(float(identity.roughnessRange[1]), float(identity.roughnessRange[0]), pooledWetness);
  const wetNormalStrength = mix(uniforms.normalStrength, uniforms.normalStrength.mul(0.58), pooledWetness);
  const normalNode = createDerivativeNormalFromHeight(fields.height, wetNormalStrength);
  const specular = createSpecularAA(roughness, fields.unresolvedNormalVariance, {
    specularVarianceScale: uniforms.specularVarianceScale,
  });
  const material = finalizePhysicalMaterial({
    name: identity.label,
    identity,
    uniforms,
    coords,
    fields,
    colorNode,
    roughnessNode: roughness,
    metalnessNode: float(0),
    clearcoatNode: pooledWetness.mul(identity.clearcoatRange[1]),
    clearcoatRoughnessNode: mix(
      float(identity.clearcoatRoughnessRange[1]),
      float(identity.clearcoatRoughnessRange[0]),
      pooledWetness,
    ),
    normalNode,
    dissolve,
    specular,
    triplanarWeights: createTriplanarWeights(normalLocal),
  });
  material.userData.proceduralPbr.wetnessCause = {
    owner: "world-height+cavity+macro-field",
    coupledChannels: ["color", "roughness", "clearcoat", "normal"],
    clearcoatF0: {
      value: 0.04,
      provenance: "Gated r185 clearcoat constant; authored approximation to a water film",
    },
    responseEquation: "evaluateWetRockResponse(wetness)",
    directLightOcclusionOwner: "renderer shadow comparison on the directional-light contribution",
    ambientAndEmissionUnaffectedByProjectedOcclusion: true,
  };
  return material;
}

function createLavaCauseNodes(causeMap, coords, fields) {
  if (!causeMap) {
    return {
      crust: fields.cavity,
      fracture: fields.ridge,
      exposure: smoothstep(0.48, 0.88, fields.ridge.add(fields.macro.mul(0.35))),
      heat: smoothstep(0.36, 0.82, fields.ridge),
      debug: vec3(fields.cavity, fields.ridge, fields.macro),
    };
  }

  causeMap.colorSpace = NoColorSpace;
  const sample = texture(causeMap, coords.uv);
  return {
    crust: sample.r,
    fracture: sample.g,
    exposure: sample.b,
    heat: sample.a,
    debug: sample.rgb,
  };
}

export function createLavaEmissivePbrMaterial({
  seed = 41,
  coordinateScale = 1.25,
  coordinateMode = "object",
  debugMode = "final",
  specularVarianceScale = 1,
  normalStrength = 1,
  sceneUnitsPerMeter = 1,
  flowTime = 0,
  flowSpeed = authoredLavaIdentity.flowSpeed,
  causeMap = null,
  emissionIntensity = authoredLavaIdentity.emissionIntensity,
} = {}) {
  validateProceduralPbrConfig({
    coordinateScale,
    coordinateMode,
    emissionIntensity,
    sceneUnitsPerMeter,
    specularVarianceScale,
    causeMaps: causeMap ? [causeMap] : [],
  });
  const uniforms = createMaterialUniforms({
    seed,
    coordinateScale,
    debugMode,
    specularVarianceScale,
    normalStrength,
    flowTime,
  });
  const flow = vec2(uniforms.flowTime.mul(flowSpeed), uniforms.flowTime.mul(flowSpeed * 1.5));
  const coords = createStableCoordinates(uniforms, { coordinateMode, flow });
  const fields = createStructuralFields(coords, {
    fiberFrequency: 7.0,
    macroFrequency: 0.7,
    ridgeFrequency: 3.6,
    cavityFrequency: 8.5,
    heightMeters: authoredLavaIdentity.heightMeters,
    sceneUnitsPerMeter,
  });
  const cause = createLavaCauseNodes(causeMap, coords, fields);
  const dissolve = createPerInstanceDissolve(fields);
  const crustMask = smoothstep(0.35, 0.74, cause.crust);
  const exposure = smoothstep(0.42, 0.92, cause.exposure.add(cause.fracture.mul(0.28)));
  const heat = exposure.mul(smoothstep(0.26, 0.86, cause.heat));
  const crust = mix(color(authoredLavaIdentity.ashColor), color(authoredLavaIdentity.crustColor), crustMask);
  const lava = mix(color(authoredLavaIdentity.lavaCool), color(authoredLavaIdentity.lavaHot), heat);
  const colorNode = mix(crust, lava, heat.mul(0.35));
  const roughness = mix(float(0.74), float(0.28), heat);
  const normalNode = createDerivativeNormalFromHeight(fields.height, uniforms.normalStrength);
  const specular = createSpecularAA(roughness, fields.unresolvedNormalVariance, {
    specularVarianceScale: uniforms.specularVarianceScale,
  });
  const emission = mix(color(authoredLavaIdentity.lavaCool), color(authoredLavaIdentity.lavaHot), heat)
    .mul(heat.mul(emissionIntensity));

  const material = new MeshStandardNodeMaterial({
    name: authoredLavaIdentity.label,
    color: linearColor(authoredLavaIdentity.crustColor),
    roughness: 0.62,
    metalness: 0,
  });
  material.colorNode = applyDebugModes(colorNode, {
    uniforms,
    coords,
    fields,
    roughness,
    filteredRoughness: specular.filteredRoughness,
    normalVariance: specular.normalVariance,
    metalness: float(0),
    dissolve,
    emission,
    triplanarWeights: createTriplanarWeights(normalLocal),
    causeMapDebug: cause.debug,
  });
  material.roughnessNode = specular.filteredRoughness;
  material.metalnessNode = float(0);
  material.normalNode = normalNode;
  material.emissiveNode = emission;
  material.opacityNode = dissolve.mask;
  material.alphaTestNode = float(0.5);
  const sharedDissolveMask = dissolve.mask.greaterThan(0.5);
  material.maskNode = sharedDissolveMask;
  material.maskShadowNode = sharedDissolveMask;
  material.mrtNode = mrt({
    materialAlbedo: vec4(colorNode, 1),
    materialParams: vec4(specular.filteredRoughness, 0, 0, dissolve.mask),
    materialNormal: vec4(normalNode.mul(0.5).add(0.5), 1),
    materialFootprint: vec4(vec3(fields.footprint), 1),
    materialNormalVariance: vec4(vec3(specular.normalVariance), 1),
  });
  material.userData.proceduralPbr = {
    uniforms,
    disposeTextures: causeMap ? [causeMap] : [],
    normalVarianceSource: "footprint-removed-material-slope-energy",
    geometryRoughnessOwner: "three-r185-getRoughness",
    specularVarianceScale: {
      value: uniforms.specularVarianceScale.value,
      provenance: "Authored trial; calibrate against a supersampled radiance reference",
    },
    heightUnit: "scene units = meters * sceneUnitsPerMeter",
    heightContract: fields.heightContract,
    responseBundle: authoredLavaIdentity.label,
    dissolveParity: Object.freeze({
      visibleMaskNode: sharedDissolveMask,
      shadowMaskNode: sharedDissolveMask,
      sameNodeIdentity: true,
      positionOwner: "shared undeformed positionLocal",
    }),
  };

  return material;
}

export function createTriplanarProjectionNode(textureSource, {
  scale = 1,
  positionNode = positionLocal,
  normalNode = normalLocal,
} = {}) {
  return {
    node: triplanarTexture(texture(textureSource), null, null, float(scale), positionNode, normalNode),
    costNote: TRIPLANAR_COST_NOTE,
  };
}

function createTriplanarWeights(normalNode) {
  let weights = normalNode.abs().normalize();
  weights = weights.div(weights.dot(vec3(1)));
  return weights;
}

export function createInstancedDissolveAttributes(instanceCount, {
  initialDissolve = 0,
  variantSeed = 1,
} = {}) {
  const dissolve = new StorageInstancedBufferAttribute(instanceCount, 1);
  const variant = new StorageInstancedBufferAttribute(instanceCount, 1);

  for (let i = 0; i < instanceCount; i++) {
    dissolve.array[i] = initialDissolve;
    variant.array[i] = (((i + 1) * 1103515245 + variantSeed * 12345) >>> 0) / 4294967295;
  }

  return {
    dissolve,
    variant,
    attachTo(geometry) {
      geometry.setAttribute("instanceDissolve", dissolve);
      geometry.setAttribute("instanceVariant", variant);
      return geometry;
    },
  };
}

export async function loadLavaCauseMaps({
  textureLoader = new TextureLoader(),
  paths = lavaCauseMapPaths,
} = {}) {
  const entries = await Promise.all(
    Object.entries(paths).map(async ([key, path]) => {
      const map = await textureLoader.loadAsync(path);
      map.colorSpace = NoColorSpace;
      map.wrapS = RepeatWrapping;
      map.wrapT = RepeatWrapping;
      map.minFilter = LinearMipMapLinearFilter;
      map.magFilter = LinearFilter;
      map.generateMipmaps = true;
      return [key, map];
    }),
  );
  return Object.fromEntries(entries);
}

export function setProceduralPbrDebugMode(material, debugMode) {
  const state = material.userData.proceduralPbr;
  if (!state) return false;
  if (!proceduralPbrDebugModes.has(debugMode)) {
    throw new Error(`Unknown procedural PBR debug mode "${debugMode}"`);
  }
  state.uniforms.debugMode.value = proceduralPbrDebugModes.get(debugMode);
  material.needsUpdate = true;
  return true;
}

export function setLavaFlowTime(material, elapsedSeconds) {
  const state = material.userData.proceduralPbr;
  if (!state?.uniforms.flowTime) return false;

  state.uniforms.flowTime.value = elapsedSeconds;
  return true;
}

// The default example has no mandatory compute kernel: analytic TSL fields and
// optional data maps are cheaper for these identities. This helper exists
// for callers that add generated cause maps or storage-backed instance state.
export async function initializeProceduralPbrMaterialData(renderer, {
  computeNodes = [],
} = {}) {
  const previousRenderTarget = renderer.getRenderTarget?.();

  try {
    await renderer.init();
    const isWebGPUBackend = renderer.backend?.isWebGPUBackend === true;
    if (!isWebGPUBackend) {
      throw new Error(PROCEDURAL_PBR_WEBGPU_REQUIRED_MESSAGE);
    }
    if (computeNodes.length > 0) {
      renderer.compute(computeNodes);
    }
    return { isWebGPUBackend, computeNodeCount: computeNodes.length };
  } finally {
    if (renderer.setRenderTarget && previousRenderTarget !== undefined) {
      renderer.setRenderTarget(previousRenderTarget);
    }
  }
}

export function disposeProceduralPbrMaterial(material) {
  if (!material || disposedProceduralMaterials.has(material)) return false;

  const state = material.userData.proceduralPbr;
  if (state?.disposeTextures) {
    for (const textureToDispose of state.disposeTextures) {
      textureToDispose.dispose?.();
    }
    state.disposeTextures.length = 0;
  }
  material.dispose?.();
  disposedProceduralMaterials.add(material);
  return true;
}

export function disposeTextureSet(textureSet) {
  if (!textureSet || typeof textureSet !== "object") return 0;

  let disposedCount = 0;
  for (const [key, textureToDispose] of Object.entries(textureSet)) {
    textureToDispose?.dispose?.();
    if (textureToDispose?.dispose) disposedCount += 1;
    delete textureSet[key];
  }
  return disposedCount;
}
