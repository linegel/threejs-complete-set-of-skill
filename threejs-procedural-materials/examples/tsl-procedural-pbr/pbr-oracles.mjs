const DEFAULT_ALIGNMENT = 256;

export const WEBGPU_COLOR_ATTACHMENT_FORMAT_COST = Object.freeze({
  rgba16float: Object.freeze({ pixelByteCost: 8, componentAlignment: 2 }),
  rgba8unorm: Object.freeze({ pixelByteCost: 8, componentAlignment: 1 }),
  rgba8unormsrgb: Object.freeze({ pixelByteCost: 8, componentAlignment: 1 }),
});

const UINT32_SCALE = 1 / 0x100000000;

/**
 * Deterministically mix an authored uint32 seed with an independent stream.
 * `Math.imul()` keeps every operation in the uint32 domain instead of relying
 * on imprecise large JavaScript products.
 */
export function hashMaterialSeed(seed, stream = 0) {
  if (!Number.isInteger(seed) || seed < 0 || seed > 0xffffffff) {
    throw new RangeError("material seed must be a uint32 integer");
  }
  if (!Number.isInteger(stream) || stream < 0 || stream > 0xffffffff) {
    throw new RangeError("material seed stream must be a uint32 integer");
  }
  let value = (seed ^ Math.imul((stream + 1) >>> 0, 0x9e3779b9)) >>> 0;
  value = Math.imul(value ^ (value >>> 16), 0x7feb352d) >>> 0;
  value = Math.imul(value ^ (value >>> 15), 0x846ca68b) >>> 0;
  return (value ^ (value >>> 16)) >>> 0;
}

/**
 * Convert an arbitrary uint32 seed into a bounded float phase. TSL noise
 * inputs remain below 64 scene-coordinate units so float32 retains local
 * derivatives even for the stress seed 0x9e3779b9.
 */
export function materialSeedPhase(seed, stream = 0) {
  return hashMaterialSeed(seed, stream) * UINT32_SCALE * 64;
}

function requireFinite(value, name) {
  if (!Number.isFinite(value)) throw new TypeError(`${name} must be finite`);
}

function requirePositiveInteger(value, name) {
  if (!Number.isInteger(value) || value <= 0) {
    throw new RangeError(`${name} must be a positive integer`);
  }
}

function clamp01(value) {
  return Math.min(1, Math.max(0, value));
}

function smoothstep(edge0, edge1, value) {
  if (!(edge1 > edge0)) throw new RangeError("smoothstep edges must be strictly ordered");
  const t = clamp01((value - edge0) / (edge1 - edge0));
  return t * t * (3 - 2 * t);
}

export function evaluateBandLimitSample({
  coordinateFootprint,
  surfacePixelSpan,
  heightHalfAmplitude,
  supportMultiplier,
  slopeVarianceCalibration,
  qFade = [0.25, 0.5],
}) {
  for (const [name, value] of Object.entries({
    coordinateFootprint,
    surfacePixelSpan,
    heightHalfAmplitude,
    supportMultiplier,
    slopeVarianceCalibration,
  })) requireFinite(value, name);
  if (coordinateFootprint < 0) throw new RangeError("coordinateFootprint must be non-negative");
  if (surfacePixelSpan <= 0) throw new RangeError("surfacePixelSpan must be positive");
  if (heightHalfAmplitude < 0) throw new RangeError("heightHalfAmplitude must be non-negative");
  if (supportMultiplier <= 0) throw new RangeError("supportMultiplier must be positive");
  if (slopeVarianceCalibration < 0) throw new RangeError("slopeVarianceCalibration must be non-negative");
  if (!Array.isArray(qFade) || qFade.length !== 2 || !qFade.every(Number.isFinite) || !(qFade[1] > qFade[0])) {
    throw new RangeError("qFade must contain two strictly ordered finite values");
  }

  const q = coordinateFootprint * supportMultiplier;
  const keep = 1 - smoothstep(qFade[0], qFade[1], q);
  const supportFrequency = q / surfacePixelSpan;
  const slopeAmplitude = 2 * Math.PI * heightHalfAmplitude * supportFrequency;
  const removedSlopeVariance = 0.5
    * slopeVarianceCalibration
    * slopeAmplitude ** 2
    * (1 - keep ** 2);
  return Object.freeze({ q, keep, supportFrequency, removedSlopeVariance });
}

export function evaluateFilteredRoughness({
  roughness,
  normalVariance,
  specularVarianceScale,
}) {
  for (const [name, value] of Object.entries({ roughness, normalVariance, specularVarianceScale })) {
    requireFinite(value, name);
  }
  if (roughness < 0 || roughness > 1) throw new RangeError("roughness must be inside [0,1]");
  if (normalVariance < 0) throw new RangeError("normalVariance must be non-negative");
  if (specularVarianceScale < 0) throw new RangeError("specularVarianceScale must be non-negative");
  const widened = Math.sqrt(roughness ** 2 + normalVariance * specularVarianceScale);
  return Math.min(1, Math.max(roughness, widened));
}

export function resolveAtlasTileTransform({
  atlasWidth,
  atlasHeight,
  columns,
  rows,
  tileIndex,
  gutterTexels,
}) {
  for (const [name, value] of Object.entries({ atlasWidth, atlasHeight, columns, rows })) {
    requirePositiveInteger(value, name);
  }
  if (atlasWidth % columns !== 0 || atlasHeight % rows !== 0) {
    throw new RangeError("atlas dimensions must be divisible by the tile grid");
  }
  if (!Number.isInteger(tileIndex) || tileIndex < 0 || tileIndex >= columns * rows) {
    throw new RangeError("tileIndex is outside the atlas grid");
  }
  if (!Number.isInteger(gutterTexels) || gutterTexels < 0) {
    throw new RangeError("gutterTexels must be a non-negative integer");
  }
  const tileWidth = atlasWidth / columns;
  const tileHeight = atlasHeight / rows;
  if (gutterTexels * 2 >= tileWidth || gutterTexels * 2 >= tileHeight) {
    throw new RangeError("atlas gutter consumes the tile interior");
  }
  const tileX = tileIndex % columns;
  const tileY = Math.floor(tileIndex / columns);
  const origin = Object.freeze([
    (tileX * tileWidth + gutterTexels) / atlasWidth,
    (tileY * tileHeight + gutterTexels) / atlasHeight,
  ]);
  const span = Object.freeze([
    (tileWidth - 2 * gutterTexels) / atlasWidth,
    (tileHeight - 2 * gutterTexels) / atlasHeight,
  ]);
  return Object.freeze({
    tileIndex,
    tileX,
    tileY,
    tileWidth,
    tileHeight,
    origin,
    span,
    gradientScale: span,
  });
}

export function evaluateAtlasUv(transform, localUv) {
  if (!transform || !Array.isArray(transform.origin) || !Array.isArray(transform.span)) {
    throw new TypeError("transform must come from resolveAtlasTileTransform()");
  }
  if (!Array.isArray(localUv) || localUv.length !== 2 || !localUv.every(Number.isFinite)) {
    throw new TypeError("localUv must contain two finite values");
  }
  return Object.freeze([
    transform.origin[0] + localUv[0] * transform.span[0],
    transform.origin[1] + localUv[1] * transform.span[1],
  ]);
}

export function evaluateTriplanarWeights(normal) {
  if (!Array.isArray(normal) || normal.length !== 3 || !normal.every(Number.isFinite)) {
    throw new TypeError("normal must contain three finite values");
  }
  const magnitudes = normal.map(Math.abs);
  const sum = magnitudes[0] + magnitudes[1] + magnitudes[2];
  if (!(sum > 0)) throw new RangeError("normal must have non-zero length");
  return Object.freeze(magnitudes.map((value) => value / sum));
}

export function evaluateDissolveVisibility(cause, threshold, footprint) {
  for (const [name, value] of Object.entries({ cause, threshold, footprint })) requireFinite(value, name);
  if (footprint <= 0) throw new RangeError("footprint must be positive");
  return smoothstep(threshold, threshold + footprint, cause);
}

export function evaluateDissolveMaskParity({
  causeSamples,
  visibleThreshold,
  shadowThreshold,
  footprint,
  cutoff = 0.5,
}) {
  if (!Array.isArray(causeSamples) && !ArrayBuffer.isView(causeSamples)) {
    throw new TypeError("causeSamples must be an array or typed array");
  }
  for (const [name, value] of Object.entries({ visibleThreshold, shadowThreshold, footprint, cutoff })) {
    requireFinite(value, name);
  }
  if (footprint <= 0) throw new RangeError("footprint must be positive");
  if (cutoff < 0 || cutoff > 1) throw new RangeError("cutoff must be inside [0,1]");

  let visibleCount = 0;
  let shadowCount = 0;
  let intersection = 0;
  let union = 0;
  let mismatchCount = 0;
  for (const cause of causeSamples) {
    requireFinite(cause, "cause sample");
    const visible = evaluateDissolveVisibility(cause, visibleThreshold, footprint) >= cutoff;
    const shadow = evaluateDissolveVisibility(cause, shadowThreshold, footprint) >= cutoff;
    if (visible) visibleCount += 1;
    if (shadow) shadowCount += 1;
    if (visible && shadow) intersection += 1;
    if (visible || shadow) union += 1;
    if (visible !== shadow) mismatchCount += 1;
  }
  return Object.freeze({
    sampleCount: causeSamples.length,
    visibleCount,
    shadowCount,
    intersection,
    union,
    mismatchCount,
    iou: union === 0 ? 1 : intersection / union,
  });
}

export function computeRgbaReadbackLayout({
  width,
  height,
  byteLength,
  bytesPerComponent = 1,
  componentCount = 4,
  alignment = DEFAULT_ALIGNMENT,
}) {
  for (const [name, value] of Object.entries({
    width,
    height,
    byteLength,
    bytesPerComponent,
    componentCount,
    alignment,
  })) {
    requirePositiveInteger(value, name);
  }
  const rowBytes = width * componentCount * bytesPerComponent;
  const requestedBytesPerRow = Math.ceil(rowBytes / alignment) * alignment;
  const compactByteLength = rowBytes * height;
  const shortPaddedByteLength = requestedBytesPerRow * (height - 1) + rowBytes;
  const fullPaddedByteLength = requestedBytesPerRow * height;
  let sourceBytesPerRow;
  let sourceLayout;
  if (byteLength === compactByteLength) {
    sourceBytesPerRow = rowBytes;
    sourceLayout = "compact";
  } else if (byteLength === shortPaddedByteLength || byteLength === fullPaddedByteLength) {
    sourceBytesPerRow = requestedBytesPerRow;
    sourceLayout = "aligned-padded";
  } else {
    throw new RangeError(`unrecognized RGBA readback layout: ${byteLength} bytes`);
  }
  return Object.freeze({
    width,
    height,
    componentCount,
    bytesPerComponent,
    rowBytes,
    sourceBytesPerRow,
    sourceByteLength: byteLength,
    requestedBytesPerRow,
    requestedAlignment: alignment,
    sourceLayout,
  });
}

export function computeRgba8ReadbackLayout({
  width,
  height,
  byteLength,
  bytesPerElement = 1,
  alignment = DEFAULT_ALIGNMENT,
}) {
  if (bytesPerElement !== 1) {
    throw new RangeError("RGBA8 readback elements must be one byte wide");
  }
  return computeRgbaReadbackLayout({
    width,
    height,
    byteLength,
    bytesPerComponent: 1,
    componentCount: 4,
    alignment,
  });
}

export function unpackReadbackRows({
  bytes,
  width,
  height,
  bytesPerPixel,
  bytesPerRow,
}) {
  if (!ArrayBuffer.isView(bytes) && !(bytes instanceof Uint8Array)) {
    throw new TypeError("readback bytes must be an ArrayBuffer view");
  }
  for (const [name, value] of Object.entries({ width, height, bytesPerPixel, bytesPerRow })) {
    requirePositiveInteger(value, name);
  }
  const source = new Uint8Array(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const rowBytes = width * bytesPerPixel;
  if (bytesPerRow < rowBytes) throw new RangeError("readback stride is smaller than one logical row");
  const shortLength = bytesPerRow * (height - 1) + rowBytes;
  const fullLength = bytesPerRow * height;
  if (source.byteLength !== shortLength && source.byteLength !== fullLength) {
    throw new RangeError(`readback byte length ${source.byteLength} does not match its declared stride`);
  }
  const compact = new Uint8Array(rowBytes * height);
  for (let row = 0; row < height; row++) {
    compact.set(
      source.subarray(row * bytesPerRow, row * bytesPerRow + rowBytes),
      row * rowBytes,
    );
  }
  return compact;
}

export function float16ToFloat32(value) {
  if (!Number.isInteger(value) || value < 0 || value > 0xffff) {
    throw new RangeError("float16 bits must be a uint16 integer");
  }
  const sign = (value & 0x8000) === 0 ? 1 : -1;
  const exponent = (value >>> 10) & 0x1f;
  const fraction = value & 0x03ff;
  if (exponent === 0) return sign * fraction * 2 ** -24;
  if (exponent === 0x1f) return fraction === 0 ? sign * Infinity : NaN;
  return sign * (1 + fraction / 1024) * 2 ** (exponent - 15);
}

function linearToSrgb(value) {
  const clamped = Math.min(1, Math.max(0, value));
  return clamped <= 0.0031308
    ? clamped * 12.92
    : 1.055 * clamped ** (1 / 2.4) - 0.055;
}

export function visualizeHalfFloatEmissive({
  bytes,
  width,
  height,
  bytesPerRow,
}) {
  const compact = unpackReadbackRows({
    bytes,
    width,
    height,
    bytesPerPixel: 8,
    bytesPerRow,
  });
  const view = new DataView(compact.buffer, compact.byteOffset, compact.byteLength);
  const rgba8 = new Uint8Array(width * height * 4);
  for (let pixel = 0; pixel < width * height; pixel++) {
    const sourceOffset = pixel * 8;
    const destinationOffset = pixel * 4;
    for (let channel = 0; channel < 3; channel++) {
      const linear = float16ToFloat32(view.getUint16(sourceOffset + channel * 2, true));
      const finite = Number.isFinite(linear) ? Math.max(0, linear) : 0;
      const compressed = finite / (1 + finite);
      rgba8[destinationOffset + channel] = Math.round(linearToSrgb(compressed) * 255);
    }
    rgba8[destinationOffset + 3] = 255;
  }
  return rgba8;
}

export function evaluateColorAttachmentBudget({ formats, limit }) {
  if (!Array.isArray(formats) || formats.length === 0) {
    throw new TypeError("formats must be a non-empty array");
  }
  requirePositiveInteger(limit, "limit");
  const normalizedFormats = formats.map((format) => String(format).toLowerCase().replace(/[^a-z0-9]/g, ""));
  let total = 0;
  const entries = normalizedFormats.map((format) => {
    const descriptor = WEBGPU_COLOR_ATTACHMENT_FORMAT_COST[format];
    if (!descriptor) throw new RangeError(`unsupported color attachment format ${format}`);
    const alignedOffset = Math.ceil(total / descriptor.componentAlignment) * descriptor.componentAlignment;
    total = alignedOffset + descriptor.pixelByteCost;
    return Object.freeze({
      format,
      alignedOffset,
      pixelByteCost: descriptor.pixelByteCost,
      componentAlignment: descriptor.componentAlignment,
    });
  });
  return Object.freeze({
    formats: Object.freeze(normalizedFormats),
    entries: Object.freeze(entries),
    costs: Object.freeze(entries.map((entry) => entry.pixelByteCost)),
    total,
    limit,
    passes: total <= limit,
    provenance: "Derived from the WebGPU plain-color-format render-target byte costs and component-alignment algorithm",
  });
}
