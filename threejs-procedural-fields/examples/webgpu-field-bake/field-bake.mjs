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
  createFieldCauseBindings,
  createFieldNodeBundle,
  fieldInputTransform,
  sampleFieldF32CPU,
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

export function compareFieldStorageMutation({
  before,
  after,
  width,
  height,
  allowedRegion,
  lanes = 4,
}) {
  validateExtent(width, height, "storage comparison extent");
  const region = validateRegionWithinExtent(allowedRegion, width, height, "allowed storage mutation region");
  if (!ArrayBuffer.isView(before) || !ArrayBuffer.isView(after)) {
    throw new Error("storage comparison requires typed-array snapshots");
  }
  const expectedLength = width * height * lanes;
  if (before.length !== expectedLength || after.length !== expectedLength) {
    throw new Error(`storage comparison length must equal ${expectedLength}`);
  }
  let changedInside = 0;
  let changedOutside = 0;
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const offset = (y * width + x) * lanes;
      let changed = false;
      for (let lane = 0; lane < lanes; lane += 1) {
        if (before[offset + lane] !== after[offset + lane]) {
          changed = true;
          break;
        }
      }
      if (!changed) continue;
      const inside = x >= region.x && x < region.x + region.width &&
        y >= region.y && y < region.y + region.height;
      if (inside) changedInside += 1;
      else changedOutside += 1;
    }
  }
  return Object.freeze({
    allowedRegion: region,
    changedInside,
    changedOutside,
    unchanged: changedInside === 0 && changedOutside === 0,
  });
}

export function validateFieldStorageConfinement(comparison, { requireChange = true } = {}) {
  if (!comparison || comparison.changedOutside !== 0) {
    throw new Error(`storage mutation escaped its declared region by ${comparison?.changedOutside ?? "unknown"} texels`);
  }
  if (requireChange && comparison.changedInside <= 0) {
    throw new Error("storage mutation did not change any texel inside its declared region");
  }
  return Object.freeze(comparison);
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
  return Object.freeze(mipRegions.map((outputRegion, level) => {
    const invocationCount = outputRegion.width * outputRegion.height;
    return Object.freeze({
      level,
      kind: level === 0 ? "base-field-write" : "dependent-box-mip-write",
      outputRegion,
      inputReadRegion: level === 0
        ? null
        : dependentMipReadRegion(outputRegion, extents[level - 1]),
      invocationCount,
      workgroupSize: Object.freeze([64, 1, 1]),
      workgroupCount: Object.freeze([Math.ceil(invocationCount / 64), 1, 1]),
    });
  }));
}

export function validateFieldDispatchTrace(trace, region, extents) {
  const expected = buildDirtyDispatchTrace(region, extents);
  if (!Array.isArray(trace) || trace.length !== expected.length) {
    throw new Error(`field dispatch trace has ${trace?.length ?? "no"} entries; expected ${expected.length}`);
  }
  for (let index = 0; index < expected.length; index += 1) {
    const actual = trace[index];
    const reference = expected[index];
    for (const key of ["level", "kind", "invocationCount"]) {
      if (actual[key] !== reference[key]) {
        throw new Error(`field dispatch ${index} ${key} drifted from the executed region`);
      }
    }
    for (const key of ["outputRegion", "inputReadRegion", "workgroupSize", "workgroupCount"]) {
      if (JSON.stringify(actual[key]) !== JSON.stringify(reference[key])) {
        throw new Error(`field dispatch ${index} ${key} drifted from the executed region`);
      }
    }
  }
  return Object.freeze(trace);
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

export function validateFieldResourceLedger(ledger) {
  if (!ledger || ledger.accountingScope !== "lab-owned-logical-bytes") {
    throw new Error("field resource ledger must declare lab-owned logical-byte scope");
  }
  if (!Array.isArray(ledger.resources) || ledger.resources.length === 0) {
    throw new Error("field resource ledger must contain resources");
  }
  const ids = new Set();
  let totalBytes = 0;
  let residentBytes = 0;
  const transientBytesByScope = new Map();
  for (const resource of ledger.resources) {
    if (typeof resource.id !== "string" || resource.id.length === 0 || ids.has(resource.id)) {
      throw new Error(`invalid or duplicate field resource id "${resource.id}"`);
    }
    ids.add(resource.id);
    if (!Number.isInteger(resource.bytes) || resource.bytes <= 0) {
      throw new Error(`field resource "${resource.id}" has invalid byte count`);
    }
    if (typeof resource.scope !== "string" || resource.scope.length === 0) {
      throw new Error(`field resource "${resource.id}" has no accounting scope`);
    }
    if (!["resident", "transient"].includes(resource.residency)) {
      throw new Error(`field resource "${resource.id}" has invalid residency`);
    }
    if (!["lab-owned", "capture-request"].includes(resource.ownership)) {
      throw new Error(`field resource "${resource.id}" has invalid ownership`);
    }
    if (["storage-texture", "render-target", "sampled-texture"].includes(resource.kind)) {
      const mipExtents = resource.mipExtents ?? [resource.extent];
      if (!Array.isArray(mipExtents) || mipExtents.length === 0) {
        throw new Error(`field texture "${resource.id}" has no extent`);
      }
      for (const extent of mipExtents) {
        validateExtent(extent?.width, extent?.height, `${resource.id} extent`);
      }
      const expected = mipExtents.reduce(
        (sum, extent) => sum + extent.width * extent.height * resource.bytesPerTexel,
        0,
      );
      if (resource.bytes !== expected) {
        throw new Error(`field texture "${resource.id}" reports ${resource.bytes} bytes; expected ${expected}`);
      }
    } else if (resource.kind === "storage-buffer") {
      const expected = resource.elementCount * resource.itemSize * resource.bytesPerElement;
      if (!Number.isInteger(expected) || expected <= 0 || resource.bytes !== expected) {
        throw new Error(`field buffer "${resource.id}" reports ${resource.bytes} bytes; expected ${expected}`);
      }
    } else if (resource.kind === "cpu-buffer") {
      const expected = resource.elementCount * resource.bytesPerElement;
      if (!Number.isInteger(expected) || expected <= 0 || resource.bytes !== expected) {
        throw new Error(`field CPU buffer "${resource.id}" reports ${resource.bytes} bytes; expected ${expected}`);
      }
    } else if (resource.kind === "readback-request") {
      const expected = resource.alignedBytesPerRow * resource.rowCount;
      if (
        !Number.isInteger(resource.rowBytes) ||
        !Number.isInteger(resource.alignedBytesPerRow) ||
        resource.alignedBytesPerRow < resource.rowBytes ||
        resource.alignedBytesPerRow % 256 !== 0 ||
        !Number.isInteger(expected) ||
        expected <= 0 ||
        resource.bytes !== expected
      ) {
        throw new Error(`field readback request "${resource.id}" has an invalid aligned layout`);
      }
    } else {
      throw new Error(`field resource "${resource.id}" has unknown kind "${resource.kind}"`);
    }
    totalBytes += resource.bytes;
    if (resource.residency === "resident") {
      residentBytes += resource.bytes;
    } else {
      transientBytesByScope.set(
        resource.scope,
        (transientBytesByScope.get(resource.scope) ?? 0) + resource.bytes,
      );
    }
  }
  if (ledger.totalBytes !== totalBytes) {
    throw new Error(`field resource total ${ledger.totalBytes} does not reconcile with ${totalBytes}`);
  }
  const transientByteSum = [...transientBytesByScope.values()].reduce((sum, bytes) => sum + bytes, 0);
  const peakTransientBytes = Math.max(0, ...transientBytesByScope.values());
  if (
    ledger.residentBytes !== residentBytes ||
    ledger.transientByteSum !== transientByteSum ||
    ledger.peakTransientBytes !== peakTransientBytes ||
    ledger.peakLabOwnedBytes !== residentBytes + peakTransientBytes
  ) {
    throw new Error("field resource ledger resident/transient totals do not reconcile");
  }
  if (
    !Array.isArray(ledger.unclaimed) ||
    !ledger.unclaimed.includes("renderer-internal-readback-staging-residency")
  ) {
    throw new Error("field resource ledger must explicitly leave opaque renderer staging unclaimed");
  }
  return Object.freeze(ledger);
}

export function createScopedFieldResourceLedger(resourceEntries, {
  unclaimed = ["renderer-internal-readback-staging-residency"],
} = {}) {
  const resources = Object.freeze(resourceEntries.map((entry) => Object.freeze({ ...entry })));
  const residentBytes = resources
    .filter((resource) => resource.residency === "resident")
    .reduce((sum, resource) => sum + resource.bytes, 0);
  const transientBytesByScope = Object.fromEntries(resources
    .filter((resource) => resource.residency === "transient")
    .reduce((scopes, resource) => {
      scopes.set(resource.scope, (scopes.get(resource.scope) ?? 0) + resource.bytes);
      return scopes;
    }, new Map()));
  const transientByteSum = Object.values(transientBytesByScope).reduce(
    (sum, bytes) => sum + bytes,
    0,
  );
  const peakTransientBytes = Math.max(0, ...Object.values(transientBytesByScope));
  return validateFieldResourceLedger({
    schemaVersion: 2,
    accountingScope: "lab-owned-logical-bytes",
    opaqueRendererResidency: "NOT_CLAIMED",
    unclaimed: Object.freeze([...unclaimed]),
    resources,
    totalBytes: residentBytes + transientByteSum,
    residentBytes,
    transientByteSum,
    transientBytesByScope: Object.freeze(transientBytesByScope),
    peakTransientBytes,
    peakLabOwnedBytes: residentBytes + peakTransientBytes,
  });
}

export function createFieldResourceLedger(resources, placement) {
  const textureResources = [
    ...resources.packedMipTextures.map((texture, level) => ({
      id: `packed-mip-${level}`,
      kind: "storage-texture",
      format: "rgba16float",
      extent: { ...resources.mipExtents[level] },
      bytesPerTexel: 8,
      bytes: texture.image.width * texture.image.height * 8,
      scope: "resident-tier",
      residency: "resident",
      ownership: "lab-owned",
    })),
    {
      id: "derived-base",
      kind: "storage-texture",
      format: "rgba16float",
      extent: { width: resources.width, height: resources.height },
      bytesPerTexel: 8,
      bytes: resources.width * resources.height * 8,
      scope: "resident-tier",
      residency: "resident",
      ownership: "lab-owned",
    },
    {
      id: "gradient-base",
      kind: "storage-texture",
      format: "rgba16float",
      extent: { width: resources.width, height: resources.height },
      bytesPerTexel: 8,
      bytes: resources.width * resources.height * 8,
      scope: "resident-tier",
      residency: "resident",
      ownership: "lab-owned",
    },
  ];
  const bufferResources = [
    {
      id: "placement-records",
      kind: "storage-buffer",
      format: "vec4f32",
      elementCount: placement.acceptedCount,
      itemSize: 4,
      bytesPerElement: Float32Array.BYTES_PER_ELEMENT,
      bytes: placement.records.array.byteLength,
      scope: "resident-tier",
      residency: "resident",
      ownership: "lab-owned",
    },
    {
      id: "placement-accepted-indices",
      kind: "storage-buffer",
      format: "u32",
      elementCount: placement.acceptedCount,
      itemSize: 1,
      bytesPerElement: Uint32Array.BYTES_PER_ELEMENT,
      bytes: placement.acceptedIndices.array.byteLength,
      scope: "resident-tier",
      residency: "resident",
      ownership: "lab-owned",
    },
  ];
  return createScopedFieldResourceLedger([...textureResources, ...bufferResources]);
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
      warpEnabled: false,
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
  const source = storageTexture(inputTexture).toReadOnly();
  const destination = storageTexture(outputTexture).toWriteOnly();
  const kernel = Fn(() => {
    const localX = instanceIndex.mod(uint(region.width));
    const localY = instanceIndex.div(uint(region.width));
    const cell = uvec2(localX.add(uint(region.x)), localY.add(uint(region.y)));
    const sourceCell = cell.mul(uint(2));
    const maxCell = uvec2(inputExtent.width - 1, inputExtent.height - 1);
    const c00 = min(sourceCell, maxCell);
    const c10 = min(sourceCell.add(uvec2(1, 0)), maxCell);
    const c01 = min(sourceCell.add(uvec2(0, 1)), maxCell);
    const c11 = min(sourceCell.add(uvec2(1, 1)), maxCell);
    const value = source.load(c00)
      .add(source.load(c10))
      .add(source.load(c01))
      .add(source.load(c11))
      .mul(0.25);
    textureStore(destination, cell, value).toWriteOnly();
  });
  return kernel().compute(region.width * region.height, [64]).setName(`field:mip-${level}`);
}

export function createFieldProbeResources(probes) {
  if (!Array.isArray(probes) || probes.length === 0) {
    throw new Error("field probe corpus must be a nonempty array");
  }
  const count = probes.length;
  const warpModes = new Set(probes.map((probe) => probe.domain === "sphere"));
  if (warpModes.size !== 1) {
    throw new Error("field probe dispatches must separate warp-free and tangential-warp corpora");
  }
  const warpEnabled = warpModes.has(true);
  const coordinates = new StorageBufferAttribute(count, 4, Float32Array);
  const seeds = new StorageBufferAttribute(count, 4, Uint32Array);
  const jacobianColumns = [0, 1, 2].map(
    () => new StorageBufferAttribute(count, 4, Float32Array),
  );
  const packed = new StorageBufferAttribute(count, 4, Float32Array);
  const derived = new StorageBufferAttribute(count, 4, Float32Array);
  const gradient = new StorageBufferAttribute(count, 4, Float32Array);
  coordinates.name = "field-probe-coordinates-and-warp";
  seeds.name = "field-probe-u32-seeds";
  jacobianColumns.forEach((attribute, index) => {
    attribute.name = `field-probe-input-jacobian-${index}`;
  });
  packed.name = "field-probe-packed-output";
  derived.name = "field-probe-derived-output";
  gradient.name = "field-probe-gradient-output";

  for (let index = 0; index < count; index += 1) {
    const probe = probes[index];
    if (!Number.isInteger(probe.seed) || probe.seed < 0 || probe.seed > 0xffffffff) {
      throw new Error(`field probe ${index} seed must be a u32 integer`);
    }
    const input = fieldInputTransform(probe);
    coordinates.array.set([
      ...input.coordinate,
      warpEnabled ? FIELD_ALGORITHM.warp.amplitude : 0,
    ], index * 4);
    seeds.array[index * 4] = probe.seed >>> 0;
    for (let column = 0; column < 3; column += 1) {
      jacobianColumns[column].array.set([...input.jacobianColumns[column], 0], index * 4);
    }
  }

  const attributes = [coordinates, seeds, ...jacobianColumns, packed, derived, gradient];
  const inputBytes = coordinates.array.byteLength + seeds.array.byteLength +
    jacobianColumns.reduce((sum, attribute) => sum + attribute.array.byteLength, 0);
  const outputBytes = packed.array.byteLength + derived.array.byteLength + gradient.array.byteLength;
  return {
    count,
    warpEnabled,
    warpMode: warpEnabled ? "tangential" : "disabled",
    probes: Object.freeze([...probes]),
    coordinates,
    seeds,
    jacobianColumns,
    packed,
    derived,
    gradient,
    attributes,
    inputBytes,
    outputBytes,
    bytes: inputBytes + outputBytes,
  };
}

export function createFieldProbeComputeNode(resources) {
  const coordinateInput = storage(resources.coordinates, "vec4", resources.count);
  const seedInput = storage(resources.seeds, "uvec4", resources.count);
  const jacobianInputs = resources.jacobianColumns.map(
    (attribute) => storage(attribute, "vec4", resources.count),
  );
  const packedOutput = storage(resources.packed, "vec4", resources.count);
  const derivedOutput = storage(resources.derived, "vec4", resources.count);
  const gradientOutput = storage(resources.gradient, "vec4", resources.count);
  const kernel = Fn(() => {
    const coordinateRecord = coordinateInput.element(instanceIndex);
    const bundle = createFieldNodeBundle({
      coordinate: coordinateRecord.xyz,
      seed: seedInput.element(instanceIndex).x,
      warpEnabled: resources.warpEnabled,
      warpStrength: resources.warpEnabled ? coordinateRecord.w : undefined,
      inputJacobianColumns: jacobianInputs.map(
        (input) => input.element(instanceIndex).xyz,
      ),
      varPrefix: "probeField",
    });
    const causes = createFieldCauseBindings(bundle);
    packedOutput.element(instanceIndex).assign(bundle.packedChannels);
    derivedOutput.element(instanceIndex).assign(vec4(
      causes.material.slope,
      bundle.biome,
      causes.material.roughness,
      causes.placement.mask,
    ));
    gradientOutput.element(instanceIndex).assign(vec4(
      causes.diagnostics.gradient,
      causes.material.slope,
    ));
  });
  return kernel().compute(resources.count, [64]).setName("field:probe-corpus-v1");
}

export function disposeFieldProbeResources(resources) {
  for (const attribute of resources.attributes) attribute.dispose?.();
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
  if (!Number.isFinite(threshold) || threshold < 0 || threshold > 1) {
    throw new Error("structured placement threshold must be within [0,1]");
  }
  const cellCount = columns * rows;
  const acceptedCellIndices = [];
  for (let index = 0; index < cellCount; index += 1) {
    const coordinate = placementCoordinateForIndex(index, columns, rows, domain);
    const sample = sampleFieldF32CPU({ domain: "object", coordinate, seed });
    if (sample.placementMask >= threshold) acceptedCellIndices.push(index);
  }
  if (acceptedCellIndices.length === 0) {
    throw new Error("structured placement fixture produced no accepted cells");
  }
  const acceptedCount = acceptedCellIndices.length;
  if (acceptedCount === cellCount) {
    throw new Error("structured placement fixture produced no rejected cells");
  }
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
      warpEnabled: false,
      varPrefix: "placementField",
    });
    const causes = createFieldCauseBindings(bundle);
    output.element(instanceIndex).assign(vec4(
      coordinate.x,
      coordinate.z,
      causes.placement.mask,
      1,
    ));
  });
  return kernel().compute(placement.acceptedCount, [64]).setName("field:structured-placement");
}

export function validatePlacementReadbackSeparation(evidence) {
  if (
    !evidence ||
    !Number.isInteger(evidence.accepted) ||
    !Array.isArray(evidence.acceptedIndices) ||
    !Array.isArray(evidence.rawGpuRecords) ||
    !Array.isArray(evidence.decodedRecords) ||
    evidence.acceptedIndices.length !== evidence.accepted ||
    evidence.rawGpuRecords.length !== evidence.accepted ||
    evidence.decodedRecords.length !== evidence.accepted
  ) {
    throw new Error("placement readback arrays do not reconcile with the accepted count");
  }
  for (let index = 0; index < evidence.accepted; index += 1) {
    const raw = evidence.rawGpuRecords[index];
    const decoded = evidence.decodedRecords[index];
    if (!Array.isArray(raw) || raw.length !== 4 || raw.some((value) => !Number.isFinite(value))) {
      throw new Error(`placement raw GPU record ${index} is invalid`);
    }
    if (raw[3] !== 1) {
      throw new Error(`placement raw GPU record ${index} replaced its w sentinel`);
    }
    if (
      decoded?.outputIndex !== index ||
      decoded?.cpuAcceptedCellIndex !== evidence.acceptedIndices[index] ||
      JSON.stringify(decoded?.gpu) !== JSON.stringify(raw)
    ) {
      throw new Error(`placement CPU index identity ${index} was folded into or detached from GPU data`);
    }
  }
  if (evidence.minRawGpuW !== 1 || evidence.maxRawGpuW !== 1) {
    throw new Error("placement raw GPU w summary does not preserve the sentinel lane");
  }
  return Object.freeze(evidence);
}

export function createFieldBakeSystem(renderer, options = {}) {
  const canonicalSeed = options.seed ?? FIELD_ALGORITHM.defaultSeed;
  if (!Number.isInteger(canonicalSeed) || canonicalSeed < 0 || canonicalSeed > 0xffffffff) {
    throw new Error("field bake system seed must be a u32 integer");
  }
  const resources = createFieldBakeResources(options.width ?? 256, options.height ?? 256);
  const placement = createStructuredPlacementResources({
    columns: options.placementColumns ?? 64,
    rows: options.placementRows ?? 64,
    seed: canonicalSeed,
  });
  const resourceLedger = createFieldResourceLedger(resources, placement);
  const fullRegion = { x: 0, y: 0, width: resources.width, height: resources.height };
  let lastDispatchTrace = null;
  let lastDispatchSeed = null;
  const dispatchTotals = {
    computeSubmissions: 0,
    invocations: 0,
    fieldRegionUpdates: 0,
    placementUpdates: 0,
  };

  async function requireNativeWebGpu() {
    await renderer.init();
    if (renderer.backend?.isWebGPUBackend !== true) {
      throw new Error("threejs-procedural-fields requires a native WebGPU backend.");
    }
  }

  async function dispatchRegion(region = fullRegion, { seed = canonicalSeed } = {}) {
    if (!Number.isInteger(seed) || seed < 0 || seed > 0xffffffff) {
      throw new Error("field dispatch seed must be a u32 integer");
    }
    const validatedRegion = validateRegionWithinExtent(
      region,
      resources.width,
      resources.height,
      "field dispatch region",
    );
    await requireNativeWebGpu();
    const dispatchTrace = buildDirtyDispatchTrace(validatedRegion, resources.mipExtents);
    validateFieldDispatchTrace(dispatchTrace, validatedRegion, resources.mipExtents);
    const mipRegions = dispatchTrace.map((entry) => entry.outputRegion);
    renderer.compute(createFieldBakeComputeNode({ resources, region: validatedRegion, seed }));
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
    lastDispatchSeed = seed >>> 0;
    dispatchTotals.computeSubmissions += dispatchTrace.length;
    dispatchTotals.invocations += dispatchTrace.reduce(
      (sum, entry) => sum + entry.invocationCount,
      0,
    );
    dispatchTotals.fieldRegionUpdates += 1;
    return { baseRegion: validatedRegion, mipRegions, dispatchTrace, seed: lastDispatchSeed };
  }

  async function dispatchPlacement() {
    await requireNativeWebGpu();
    renderer.compute(createStructuredPlacementComputeNode({ placement, seed: canonicalSeed }));
    dispatchTotals.computeSubmissions += 1;
    dispatchTotals.invocations += placement.acceptedCount;
    dispatchTotals.placementUpdates += 1;
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
    dispatchFull: (dispatchOptions) => dispatchRegion(fullRegion, dispatchOptions),
    dispatchRegion,
    dispatchPlacement,
    describeResources: () => ({
      textures: resources.packedMipTextures.length + 2,
      storageBuffers: 2,
      bytes: resourceLedger.totalBytes,
      resourceBytes: resources.resourceBytes,
      placementBytes: placement.bytes,
      placementRecordBytes: placement.recordBytes,
      placementIndexBytes: placement.indexBytes,
      placementAcceptedCount: placement.acceptedCount,
      placementRejectedCount: placement.rejectedCount,
      resourceLedger,
      lastDispatchTrace,
      lastDispatchSeed,
      dispatchTotals: { ...dispatchTotals },
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
