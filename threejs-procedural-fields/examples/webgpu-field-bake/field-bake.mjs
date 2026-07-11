import {
  HalfFloatType,
  LinearFilter,
  LinearMipMapLinearFilter,
  NearestFilter,
  NoColorSpace,
  RGBAFormat,
  RGFormat,
  StorageBufferAttribute,
  StorageTexture,
  UnsignedByteType,
} from "three/webgpu";
import {
  Fn,
  float,
  instanceIndex,
  min,
  storage,
  storageTexture,
  textureStore,
  uint,
  uvec2,
  vec2,
  vec3,
  vec4,
} from "three/tsl";

import {
  FIELD_ALGORITHM,
  createFieldNodeBundle,
  sampleFieldCPU,
} from "./field-bundle.mjs";

export const STORAGE_FORMATS = Object.freeze({
  smoothRgba: {
    format: RGBAFormat,
    type: HalfFloatType,
    colorSpace: NoColorSpace,
    minFilter: LinearMipMapLinearFilter,
    magFilter: LinearFilter,
    generateMipmaps: true,
  },
  compactRg: {
    format: RGFormat,
    type: HalfFloatType,
    colorSpace: NoColorSpace,
    minFilter: LinearMipMapLinearFilter,
    magFilter: LinearFilter,
    generateMipmaps: true,
    requiredFeature: "texture-formats-tier1",
  },
  normalizedMasks: {
    format: RGBAFormat,
    type: UnsignedByteType,
    colorSpace: NoColorSpace,
    minFilter: LinearFilter,
    magFilter: LinearFilter,
    generateMipmaps: false,
    quantization: "UNORM data only; do not use as an integer-ID texture",
  },
  nearestCodes: {
    format: RGBAFormat,
    type: UnsignedByteType,
    colorSpace: NoColorSpace,
    minFilter: NearestFilter,
    magFilter: NearestFilter,
    generateMipmaps: false,
    quantization: "explicitly encode/decode codes in RGBA8UNORM; filtering is forbidden",
  },
});

function finiteNonNegative(value, label, { positive = false } = {}) {
  if (!Number.isFinite(value) || value < 0 || (positive && value === 0)) {
    throw new Error(`${label} must be finite and ${positive ? "positive" : "non-negative"}`);
  }
  return value;
}

function invocationCost(term, label) {
  return finiteNonNegative(term.invocationCount, `${label}.invocationCount`) *
    finiteNonNegative(term.costPerInvocation, `${label}.costPerInvocation`);
}

// REGRESSION CONTRACT FIXTURE, NOT A DEVICE-INDEPENDENT HEURISTIC.
// Every value is supplied in one calibrated cost unit (normally GPU ns from
// paired timestamp queries). The algebra mirrors the skill cost model; it does
// not infer a strategy from a read count or device label.
export function estimateFieldPathCosts({
  inline,
  localBundle,
  bake,
  consumers = [],
  auxiliaryStorage = null,
}) {
  const inlineCost = invocationCost(inline, "inline");
  const localBundleCost = invocationCost(localBundle, "localBundle") +
    finiteNonNegative(localBundle.materializationCost ?? 0, "localBundle.materializationCost");

  const reuseFrames = finiteNonNegative(bake.reuseFrames, "bake.reuseFrames", { positive: true });
  const producerCost = (
    finiteNonNegative(bake.invocationCount, "bake.invocationCount") *
      (finiteNonNegative(bake.evaluationCostPerInvocation, "bake.evaluationCostPerInvocation") +
        finiteNonNegative(bake.writeCostPerInvocation, "bake.writeCostPerInvocation")) +
    finiteNonNegative(bake.dispatchCost, "bake.dispatchCost") +
    finiteNonNegative(bake.mipCost ?? 0, "bake.mipCost")
  ) / reuseFrames;

  const sampledConsumerCost = consumers.reduce((total, consumer, index) => {
    const prefix = `consumers[${index}]`;
    const invocations = finiteNonNegative(consumer.invocationCount, `${prefix}.invocationCount`);
    const sampleCost = finiteNonNegative(consumer.sampleCostPerInvocation, `${prefix}.sampleCostPerInvocation`);
    const bytes = finiteNonNegative(consumer.bytesPerInvocation, `${prefix}.bytesPerInvocation`);
    const bandwidth = finiteNonNegative(
      consumer.effectiveBandwidthBytesPerCostUnit,
      `${prefix}.effectiveBandwidthBytesPerCostUnit`,
      { positive: true },
    );
    return total + invocations * (sampleCost + bytes / bandwidth);
  }, 0);

  const costs = {
    "direct-evaluate": inlineCost,
    "local-bundle": localBundleCost,
    StorageTexture: producerCost + sampledConsumerCost,
  };

  if (auxiliaryStorage) {
    const auxiliaryInvocationCost = auxiliaryStorage.invocationCount === undefined
      ? 0
      : invocationCost(auxiliaryStorage, "auxiliaryStorage");
    costs["StorageTexture-plus-storage-buffers"] = costs.StorageTexture +
      finiteNonNegative(auxiliaryStorage.fixedCost ?? 0, "auxiliaryStorage.fixedCost") +
      auxiliaryInvocationCost;
  }

  return Object.freeze({
    costs: Object.freeze(costs),
    producerCost,
    sampledConsumerCost,
    costUnit: bake.costUnit ?? "calibrated-cost-unit",
  });
}

export function decideBakeStrategy({ costModel, tieFraction = 0.02 }) {
  if (!costModel) {
    throw new Error("costModel is required; read-count and device-label heuristics are forbidden");
  }
  finiteNonNegative(tieFraction, "tieFraction");
  const estimate = estimateFieldPathCosts(costModel);
  const preference = [
    "direct-evaluate",
    "local-bundle",
    "StorageTexture",
    "StorageTexture-plus-storage-buffers",
  ];
  const minimum = Math.min(...Object.values(estimate.costs));
  const tied = preference.filter(
    (name) => estimate.costs[name] !== undefined && estimate.costs[name] <= minimum * (1 + tieFraction),
  );
  return Object.freeze({
    strategy: tied[0],
    ...estimate,
    tieFraction,
    evidenceRequired: "paired marginal GPU p50/p95 plus whole-frame p50/p95 for each declared workload",
  });
}

export function createFieldStorageTexture(width, height, format = STORAGE_FORMATS.smoothRgba) {
  const texture = new StorageTexture(width, height);
  texture.format = format.format;
  texture.type = format.type;
  texture.colorSpace = format.colorSpace;
  texture.minFilter = format.minFilter;
  texture.magFilter = format.magFilter;
  texture.generateMipmaps = format.generateMipmaps;
  texture.mipmapsAutoUpdate = format.generateMipmaps;
  texture.name = "field-packed-atlas";
  return texture;
}

export function createDirtyTileTracker({ tilesX, tilesY }) {
  const dirty = new Set();
  return {
    dirtyTile: dirty,
    invalidate(x, y) {
      if (!Number.isInteger(x) || !Number.isInteger(y) || x < 0 || y < 0 || x >= tilesX || y >= tilesY) {
        throw new Error(`dirty tile (${x}, ${y}) is outside ${tilesX}x${tilesY}`);
      }
      dirty.add(`${x}:${y}`);
    },
    clear() {
      dirty.clear();
    },
    allTiles() {
      return Array.from(dirty);
    },
    tilesX,
    tilesY,
  };
}

export function createFieldBakePlan({
  width = 512,
  height = 512,
  costModel,
  dirtyTile = null,
  format = STORAGE_FORMATS.smoothRgba,
} = {}) {
  const decision = decideBakeStrategy({ costModel });
  const usesStorage = decision.strategy.startsWith("StorageTexture");
  const texture = usesStorage ? createFieldStorageTexture(width, height, format) : null;
  return {
    strategy: decision.strategy,
    decision,
    texture,
    dirtyTile,
    dispatch: usesStorage ? [Math.ceil(width / 8), Math.ceil(height / 8), 1] : null,
    api: usesStorage ? "renderer.compute" : null,
    write: usesStorage ? "textureStore(StorageTexture, uv, packedChannels)" : null,
    mipPolicy: usesStorage && format.generateMipmaps
      ? "auto-generate after compute write before the first sampled binding"
      : "no mip chain",
  };
}

function validateExtent(width, height, label = "extent") {
  if (!Number.isInteger(width) || !Number.isInteger(height) || width <= 0 || height <= 0) {
    throw new Error(`${label} must contain positive integer dimensions`);
  }
}

export function validateRegionWithinExtent(region, width, height, label = "region") {
  validateExtent(width, height, `${label} parent extent`);
  if (
    !region ||
    !Number.isInteger(region.x) ||
    !Number.isInteger(region.y) ||
    !Number.isInteger(region.width) ||
    !Number.isInteger(region.height) ||
    region.x < 0 ||
    region.y < 0 ||
    region.width <= 0 ||
    region.height <= 0 ||
    region.x + region.width > width ||
    region.y + region.height > height
  ) {
    throw new Error(
      `${label} (${region?.x},${region?.y},${region?.width},${region?.height}) ` +
      `is outside ${width}x${height}`,
    );
  }
  return Object.freeze({ ...region });
}

export function alignedReadbackLayout({ width, height, bytesPerTexel, bytesPerElement, elementLength }) {
  validateExtent(width, height, "readback extent");
  for (const [label, value] of Object.entries({ bytesPerTexel, bytesPerElement, elementLength })) {
    if (!Number.isInteger(value) || value <= 0) throw new Error(`${label} must be a positive integer`);
  }
  const rowBytes = width * bytesPerTexel;
  const alignedRowBytes = Math.ceil(rowBytes / 256) * 256;
  const tightLength = width * height * bytesPerTexel / bytesPerElement;
  const elementsPerRow = elementLength === tightLength
    ? rowBytes / bytesPerElement
    : alignedRowBytes / bytesPerElement;
  if (!Number.isInteger(elementsPerRow) || elementsPerRow < rowBytes / bytesPerElement) {
    throw new Error(`invalid aligned readback stride ${elementsPerRow}`);
  }
  const minimumLength = (height - 1) * elementsPerRow + rowBytes / bytesPerElement;
  if (elementLength < minimumLength) {
    throw new Error(`readback has ${elementLength} elements; expected at least ${minimumLength}`);
  }
  return Object.freeze({ rowBytes, alignedRowBytes, elementsPerRow, minimumLength });
}

export function fieldMipExtents(width, height) {
  validateExtent(width, height);
  const extents = [];
  let mipWidth = width;
  let mipHeight = height;
  while (true) {
    extents.push(Object.freeze({ width: mipWidth, height: mipHeight }));
    if (mipWidth === 1 && mipHeight === 1) break;
    mipWidth = Math.max(1, Math.ceil(mipWidth / 2));
    mipHeight = Math.max(1, Math.ceil(mipHeight / 2));
  }
  return Object.freeze(extents);
}

export function propagateDirtyRegion(region, extents) {
  const regions = [];
  let current = { ...region };
  for (const extent of extents) {
    const x = Math.max(0, Math.min(extent.width, current.x));
    const y = Math.max(0, Math.min(extent.height, current.y));
    const x1 = Math.max(x, Math.min(extent.width, current.x + current.width));
    const y1 = Math.max(y, Math.min(extent.height, current.y + current.height));
    regions.push(Object.freeze({ x, y, width: x1 - x, height: y1 - y }));
    current = {
      x: Math.floor(x / 2),
      y: Math.floor(y / 2),
      width: Math.ceil(x1 / 2) - Math.floor(x / 2),
      height: Math.ceil(y1 / 2) - Math.floor(y / 2),
    };
  }
  return Object.freeze(regions);
}

export function dependentMipReadRegion(outputRegion, inputExtent) {
  const x = Math.min(inputExtent.width, outputRegion.x * 2);
  const y = Math.min(inputExtent.height, outputRegion.y * 2);
  const x1 = Math.min(inputExtent.width, (outputRegion.x + outputRegion.width) * 2);
  const y1 = Math.min(inputExtent.height, (outputRegion.y + outputRegion.height) * 2);
  return Object.freeze({ x, y, width: x1 - x, height: y1 - y });
}

export function buildDirtyDispatchTrace(region, extents) {
  const mipRegions = propagateDirtyRegion(region, extents);
  return Object.freeze(mipRegions.map((outputRegion, level) => Object.freeze({
    level,
    kind: level === 0 ? "base-field-write" : "dependent-box-mip-write",
    outputRegion,
    inputReadRegion: level === 0
      ? null
      : dependentMipReadRegion(outputRegion, extents[level - 1]),
    invocationCount: outputRegion.width * outputRegion.height,
  })));
}

function createBaseTexture(width, height, name) {
  const texture = new StorageTexture(width, height);
  texture.format = RGBAFormat;
  texture.type = HalfFloatType;
  texture.colorSpace = NoColorSpace;
  texture.minFilter = LinearFilter;
  texture.magFilter = LinearFilter;
  texture.generateMipmaps = false;
  texture.mipmapsAutoUpdate = false;
  texture.name = name;
  return texture;
}

export function createFieldBakeResources(width, height) {
  validateExtent(width, height);
  const mipExtents = fieldMipExtents(width, height);
  const packedMipTextures = mipExtents.map((extent, level) => createBaseTexture(
    extent.width,
    extent.height,
    `field-packed-mip-${level}`,
  ));
  const derivedTexture = createBaseTexture(width, height, "field-derived-base");
  const gradientTexture = createBaseTexture(width, height, "field-gradient-base");
  const bytesPerTexel = 8;
  return {
    width,
    height,
    mipExtents,
    packedTexture: packedMipTextures[0],
    packedMipTextures,
    derivedTexture,
    gradientTexture,
    resourceBytes: {
      packedMipChain: packedMipTextures.reduce(
        (sum, texture) => sum + texture.image.width * texture.image.height * bytesPerTexel,
        0,
      ),
      derivedBase: width * height * bytesPerTexel,
      gradientBase: width * height * bytesPerTexel,
    },
  };
}

function fieldCoordinateFromCell(cell, width, height, domain) {
  const denominator = vec2(Math.max(width - 1, 1), Math.max(height - 1, 1));
  const uv = vec2(cell).div(denominator);
  return vec3(
    float(domain.minX).add(uv.x.mul(domain.maxX - domain.minX)),
    domain.y,
    float(domain.minZ).add(uv.y.mul(domain.maxZ - domain.minZ)),
  );
}

export function createFieldBakeComputeNode({
  resources,
  seed = 17,
  domain = { minX: -4, maxX: 4, y: 0.37, minZ: -4, maxZ: 4 },
  region = { x: 0, y: 0, width: resources.width, height: resources.height },
  name = "field:bake-base",
}) {
  const { width, height } = resources;
  validateRegionWithinExtent(region, width, height, "field bake region");
  const kernel = Fn(({ packed, derived, gradient }) => {
    const localX = instanceIndex.mod(uint(region.width));
    const localY = instanceIndex.div(uint(region.width));
    const cell = uvec2(localX.add(uint(region.x)), localY.add(uint(region.y)));
    const coordinate = fieldCoordinateFromCell(cell, width, height, domain);
    const bundle = createFieldNodeBundle({
      coordinate,
      seed: uint(seed >>> 0),
      warpStrength: float(0),
      varPrefix: "bakedField",
    });
    textureStore(packed, cell, bundle.packedChannels).toWriteOnly();
    textureStore(derived, cell, bundle.derivedChannels).toWriteOnly();
    textureStore(gradient, cell, bundle.gradientChannels).toWriteOnly();
  });
  return kernel({
    packed: storageTexture(resources.packedTexture),
    derived: storageTexture(resources.derivedTexture),
    gradient: storageTexture(resources.gradientTexture),
  }).compute(region.width * region.height, [64]).setName(name);
}

export function createFieldMipComputeNode({ inputTexture, outputTexture, inputExtent, region, level }) {
  validateExtent(region.width, region.height, `mip ${level} region`);
  const kernel = Fn(({ source, destination }) => {
    const localX = instanceIndex.mod(uint(region.width));
    const localY = instanceIndex.div(uint(region.width));
    const cell = uvec2(localX.add(uint(region.x)), localY.add(uint(region.y)));
    const sourceCell = cell.mul(uint(2));
    const maxCell = uvec2(inputExtent.width - 1, inputExtent.height - 1);
    const c00 = min(sourceCell, maxCell);
    const c10 = min(sourceCell.add(uvec2(1, 0)), maxCell);
    const c01 = min(sourceCell.add(uvec2(0, 1)), maxCell);
    const c11 = min(sourceCell.add(uvec2(1, 1)), maxCell);
    const value = storageTexture(source, c00).toReadOnly()
      .add(storageTexture(source, c10).toReadOnly())
      .add(storageTexture(source, c01).toReadOnly())
      .add(storageTexture(source, c11).toReadOnly())
      .mul(0.25);
    textureStore(destination, cell, value).toWriteOnly();
  });
  return kernel({
    source: inputTexture,
    destination: storageTexture(outputTexture),
  }).compute(region.width * region.height, [64]).setName(`field:mip-${level}`);
}

function placementCoordinateForIndex(index, columns, rows, domain) {
  const x = index % columns;
  const y = Math.floor(index / columns);
  return [
    domain.minX + x / Math.max(columns - 1, 1) * (domain.maxX - domain.minX),
    domain.y,
    domain.minZ + y / Math.max(rows - 1, 1) * (domain.maxZ - domain.minZ),
  ];
}

export function createStructuredPlacementResources({
  columns,
  rows,
  seed = FIELD_ALGORITHM.defaultSeed,
  domain = { minX: -4, maxX: 4, y: 0.37, minZ: -4, maxZ: 4 },
  threshold = 0.5,
}) {
  validateExtent(columns, rows, "placement grid");
  const cellCount = columns * rows;
  const acceptedCellIndices = [];
  for (let index = 0; index < cellCount; index += 1) {
    const coordinate = placementCoordinateForIndex(index, columns, rows, domain);
    const sample = sampleFieldCPU({ domain: "object", coordinate, seed });
    if (sample.placementMask >= threshold) acceptedCellIndices.push(index);
  }
  if (acceptedCellIndices.length === 0) {
    throw new Error("structured placement fixture produced no accepted cells");
  }
  const acceptedCount = acceptedCellIndices.length;
  const records = new StorageBufferAttribute(acceptedCount, 4, Float32Array);
  records.name = "field-structured-placement-records";
  const acceptedIndices = new StorageBufferAttribute(acceptedCount, 1, Uint32Array);
  acceptedIndices.name = "field-structured-placement-accepted-cell-indices";
  acceptedIndices.array.set(acceptedCellIndices);
  const recordBytes = acceptedCount * 4 * Float32Array.BYTES_PER_ELEMENT;
  const indexBytes = acceptedCount * Uint32Array.BYTES_PER_ELEMENT;
  return {
    columns,
    rows,
    cellCount,
    acceptedCount,
    rejectedCount: cellCount - acceptedCount,
    threshold,
    domain,
    records,
    acceptedIndices,
    acceptedCellIndices: Object.freeze(acceptedCellIndices),
    recordBytes,
    indexBytes,
    bytes: recordBytes + indexBytes,
  };
}

export function createStructuredPlacementComputeNode({
  placement,
  seed = 17,
  domain = { minX: -4, maxX: 4, y: 0.37, minZ: -4, maxZ: 4 },
}) {
  const output = storage(placement.records, "vec4", placement.acceptedCount);
  const acceptedIndices = storage(placement.acceptedIndices, "uint", placement.acceptedCount);
  const kernel = Fn(() => {
    const cellIndex = acceptedIndices.element(instanceIndex);
    const x = cellIndex.mod(uint(placement.columns));
    const y = cellIndex.div(uint(placement.columns));
    const cell = uvec2(x, y);
    const coordinate = fieldCoordinateFromCell(cell, placement.columns, placement.rows, domain);
    const bundle = createFieldNodeBundle({
      coordinate,
      seed: uint(seed >>> 0),
      warpStrength: float(0),
      varPrefix: "placementField",
    });
    output.element(instanceIndex).assign(vec4(
      coordinate.x,
      coordinate.z,
      bundle.placementMask,
      1,
    ));
  });
  return kernel().compute(placement.acceptedCount, [64]).setName("field:structured-placement");
}

export function createFieldBakeSystem(renderer, options = {}) {
  const resources = createFieldBakeResources(options.width ?? 256, options.height ?? 256);
  const placement = createStructuredPlacementResources({
    columns: options.placementColumns ?? 64,
    rows: options.placementRows ?? 64,
    seed: options.seed ?? FIELD_ALGORITHM.defaultSeed,
  });
  const fullRegion = { x: 0, y: 0, width: resources.width, height: resources.height };
  let lastDispatchTrace = null;

  async function requireNativeWebGpu() {
    await renderer.init();
    if (renderer.backend?.isWebGPUBackend !== true) {
      throw new Error("threejs-procedural-fields requires a native WebGPU backend.");
    }
  }

  async function dispatchRegion(region = fullRegion) {
    const validatedRegion = validateRegionWithinExtent(
      region,
      resources.width,
      resources.height,
      "field dispatch region",
    );
    await requireNativeWebGpu();
    const dispatchTrace = buildDirtyDispatchTrace(validatedRegion, resources.mipExtents);
    const mipRegions = dispatchTrace.map((entry) => entry.outputRegion);
    renderer.compute(createFieldBakeComputeNode({ resources, region: validatedRegion, seed: options.seed }));
    for (let level = 1; level < resources.packedMipTextures.length; level += 1) {
      const mipRegion = mipRegions[level];
      if (mipRegion.width === 0 || mipRegion.height === 0) continue;
      renderer.compute(createFieldMipComputeNode({
        inputTexture: resources.packedMipTextures[level - 1],
        outputTexture: resources.packedMipTextures[level],
        inputExtent: resources.mipExtents[level - 1],
        region: mipRegion,
        level,
      }));
    }
    lastDispatchTrace = dispatchTrace;
    return { baseRegion: validatedRegion, mipRegions, dispatchTrace };
  }

  async function dispatchPlacement() {
    await requireNativeWebGpu();
    renderer.compute(createStructuredPlacementComputeNode({ placement, seed: options.seed }));
    return renderer.getArrayBufferAsync(placement.records);
  }

  function dispose() {
    for (const texture of resources.packedMipTextures) texture.dispose();
    resources.derivedTexture.dispose();
    resources.gradientTexture.dispose();
    placement.records.dispose?.();
    placement.acceptedIndices.dispose?.();
  }

  return {
    resources,
    placement,
    dispatchFull: () => dispatchRegion(fullRegion),
    dispatchRegion,
    dispatchPlacement,
    describeResources: () => ({
      textures: resources.packedMipTextures.length + 2,
      storageBuffers: 2,
      bytes: Object.values(resources.resourceBytes).reduce((sum, value) => sum + value, 0) + placement.bytes,
      resourceBytes: resources.resourceBytes,
      placementBytes: placement.bytes,
      placementRecordBytes: placement.recordBytes,
      placementIndexBytes: placement.indexBytes,
      placementAcceptedCount: placement.acceptedCount,
      placementRejectedCount: placement.rejectedCount,
      lastDispatchTrace,
    }),
    dispose,
  };
}

export const FIELD_BAKE_CONTRACT_SOURCE = `
const system = createFieldBakeSystem(renderer, { width, height, seed });
await system.dispatchFull();              // renderer.compute after init
await system.dispatchRegion(dirtyRegion); // base texels plus dependent mip regions
const placement = await system.dispatchPlacement();
`;
