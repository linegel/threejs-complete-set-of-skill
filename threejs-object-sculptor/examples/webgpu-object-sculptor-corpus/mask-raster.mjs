import { SCULPT_TARGET_IDS } from "./object-catalog.js";

const FINAL_MASK_TIERS = Object.freeze(["full", "budgeted", "minimum"]);
const ACTION_MASK_TIMES = Object.freeze([
  Object.freeze({ suffix: "t000", time: 0 }),
  Object.freeze({ suffix: "t200", time: 2 }),
]);

export const CORPUS_TARGET_MASK_PLAN = Object.freeze(SCULPT_TARGET_IDS.flatMap((subjectId) => [
  ...FINAL_MASK_TIERS.map((tier) => Object.freeze({
    id: `target-mask:${subjectId}:final:${tier}`,
    filename: `masks/${subjectId}.final.${tier}.target-mask.png`,
    subjectId,
    maskKind: "subject-silhouette",
    mode: "final",
    tier,
    camera: "design",
    seed: 1,
    time: 0,
    sourceCaptureFilename: `${subjectId}.final.${tier}.design.png`,
  })),
  ...ACTION_MASK_TIMES.map(({ suffix, time }) => Object.freeze({
    id: `target-mask:${subjectId}:action-ready:${suffix}`,
    filename: `masks/${subjectId}.action-ready.full.design.${suffix}.target-mask.png`,
    subjectId,
    maskKind: "named-moving-semantic-regions",
    mode: "action-ready",
    tier: "full",
    camera: "design",
    seed: 1,
    time,
    sourceCaptureFilename: `${subjectId}.action-ready.full.design.${suffix}.png`,
  })),
]));

if (CORPUS_TARGET_MASK_PLAN.length !== 15) throw new Error(`Object Sculptor target-mask plan must contain 15 records; received ${CORPUS_TARGET_MASK_PLAN.length}`);
if (new Set(CORPUS_TARGET_MASK_PLAN.map(({ filename }) => filename)).size !== CORPUS_TARGET_MASK_PLAN.length) throw new Error("Object Sculptor target-mask filenames must be unique");

function requireRgbaRaster(raster, label) {
  if (
    !raster
    || !Number.isInteger(raster.width)
    || raster.width <= 0
    || !Number.isInteger(raster.height)
    || raster.height <= 0
    || !(raster.rgba instanceof Uint8Array)
    || raster.rgba.length !== raster.width * raster.height * 4
  ) throw new TypeError(`${label} must be a packed positive RGBA8 raster`);
  return raster;
}

function requireSameDimensions(rasters, label) {
  const [first, ...rest] = rasters;
  requireRgbaRaster(first, `${label}[0]`);
  for (const [index, raster] of rest.entries()) {
    requireRgbaRaster(raster, `${label}[${index + 1}]`);
    if (raster.width !== first.width || raster.height !== first.height) throw new RangeError(`${label} dimensions must match`);
  }
  return first;
}

export function decodeBinaryTargetMask(raster, label = "target mask") {
  requireRgbaRaster(raster, label);
  const mask = new Uint8Array(raster.width * raster.height);
  let selectedPixels = 0;
  for (let pixel = 0; pixel < mask.length; pixel += 1) {
    const offset = pixel * 4;
    const value = raster.rgba[offset];
    if (raster.rgba[offset + 1] !== value || raster.rgba[offset + 2] !== value || !new Set([0, 255]).has(value) || raster.rgba[offset + 3] !== 255) {
      throw new Error(`${label} must contain only opaque binary black/white pixels`);
    }
    mask[pixel] = value === 255 ? 1 : 0;
    selectedPixels += mask[pixel];
  }
  if (selectedPixels === 0 || selectedPixels === mask.length) throw new Error(`${label} must select a nonempty proper subset of the frame`);
  return Object.freeze({ width: raster.width, height: raster.height, mask, selectedPixels });
}

function srgbByteToLinear(value) {
  const encoded = value / 255;
  return encoded <= 0.04045 ? encoded / 12.92 : ((encoded + 0.055) / 1.055) ** 2.4;
}

function nearestRank(values, probability) {
  if (values.length === 0) throw new Error("nearest-rank percentile needs at least one value");
  const ordered = values.sort((left, right) => left - right);
  return ordered[Math.max(0, Math.ceil(probability * ordered.length) - 1)];
}

export function computeMaskedTierError(reference, candidate, referenceMaskRaster, candidateMaskRaster) {
  requireSameDimensions([reference, candidate, referenceMaskRaster, candidateMaskRaster], "tier-error rasters");
  const referenceMask = decodeBinaryTargetMask(referenceMaskRaster, "reference tier mask");
  const candidateMask = decodeBinaryTargetMask(candidateMaskRaster, "candidate tier mask");
  const errors = [];
  let silhouetteMismatchPixels = 0;
  for (let pixel = 0; pixel < referenceMask.mask.length; pixel += 1) {
    const referenceSelected = referenceMask.mask[pixel] === 1;
    const candidateSelected = candidateMask.mask[pixel] === 1;
    if (!referenceSelected && !candidateSelected) continue;
    const silhouetteMismatch = referenceSelected !== candidateSelected;
    silhouetteMismatchPixels += silhouetteMismatch ? 1 : 0;
    const offset = pixel * 4;
    let colorError = 0;
    for (let channel = 0; channel < 3; channel += 1) {
      colorError = Math.max(colorError, Math.abs(
        srgbByteToLinear(reference.rgba[offset + channel]) - srgbByteToLinear(candidate.rgba[offset + channel]),
      ));
    }
    errors.push(Math.max(silhouetteMismatch ? 1 : 0, colorError));
  }
  return Object.freeze({
    metric: "union-mask-nearest-rank-p95-max-linear-rgb-or-silhouette-v1",
    maskedP95: nearestRank(errors, 0.95),
    unionPixels: errors.length,
    silhouetteMismatchPixels,
    silhouetteMismatchRatio: silhouetteMismatchPixels / errors.length,
  });
}

function boundaryMask(binary) {
  const boundary = new Uint8Array(binary.mask.length);
  let boundaryPixels = 0;
  const { width, height, mask } = binary;
  for (let y = 0; y < height; y += 1) for (let x = 0; x < width; x += 1) {
    const index = y * width + x;
    if (mask[index] === 0) continue;
    const isBoundary = x === 0 || y === 0 || x === width - 1 || y === height - 1
      || mask[index - 1] === 0 || mask[index + 1] === 0
      || mask[index - width] === 0 || mask[index + width] === 0;
    if (isBoundary) {
      boundary[index] = 1;
      boundaryPixels += 1;
    }
  }
  if (boundaryPixels === 0) throw new Error("target mask has no four-connected subject boundary");
  return Object.freeze({ ...binary, mask: boundary, selectedPixels: boundaryPixels });
}

function squaredDistanceTransform1d(values) {
  const length = values.length;
  const result = new Float64Array(length);
  result.fill(Number.POSITIVE_INFINITY);
  const finite = [];
  for (let index = 0; index < length; index += 1) if (Number.isFinite(values[index])) finite.push(index);
  if (finite.length === 0) return result;
  const sites = new Int32Array(finite.length);
  const intersections = new Float64Array(finite.length + 1);
  let envelope = 0;
  sites[0] = finite[0];
  intersections[0] = Number.NEGATIVE_INFINITY;
  intersections[1] = Number.POSITIVE_INFINITY;
  for (let ordinal = 1; ordinal < finite.length; ordinal += 1) {
    const query = finite[ordinal];
    let intersection;
    do {
      const site = sites[envelope];
      intersection = ((values[query] + query * query) - (values[site] + site * site)) / (2 * (query - site));
      if (intersection <= intersections[envelope]) envelope -= 1;
      else break;
    } while (envelope >= 0);
    envelope += 1;
    sites[envelope] = query;
    intersections[envelope] = intersection;
    intersections[envelope + 1] = Number.POSITIVE_INFINITY;
  }
  envelope = 0;
  for (let query = 0; query < length; query += 1) {
    while (intersections[envelope + 1] < query) envelope += 1;
    const site = sites[envelope];
    const delta = query - site;
    result[query] = delta * delta + values[site];
  }
  return result;
}

function squaredEuclideanDistanceField(boundary) {
  const { width, height, mask } = boundary;
  const vertical = new Float64Array(width * height);
  for (let x = 0; x < width; x += 1) {
    const column = new Float64Array(height);
    for (let y = 0; y < height; y += 1) column[y] = mask[y * width + x] ? 0 : Number.POSITIVE_INFINITY;
    const distance = squaredDistanceTransform1d(column);
    for (let y = 0; y < height; y += 1) vertical[y * width + x] = distance[y];
  }
  const field = new Float64Array(width * height);
  for (let y = 0; y < height; y += 1) {
    const row = vertical.subarray(y * width, (y + 1) * width);
    field.set(squaredDistanceTransform1d(row), y * width);
  }
  return field;
}

function meanBoundaryDistance(sourceBoundary, destinationField) {
  let sum = 0;
  for (let index = 0; index < sourceBoundary.mask.length; index += 1) if (sourceBoundary.mask[index]) sum += Math.sqrt(destinationField[index]);
  return sum / sourceBoundary.selectedPixels;
}

export function computeNormalizedSymmetricBoundaryDistance(leftMaskRaster, rightMaskRaster) {
  requireSameDimensions([leftMaskRaster, rightMaskRaster], "boundary-distance masks");
  const left = boundaryMask(decodeBinaryTargetMask(leftMaskRaster, "left subject mask"));
  const right = boundaryMask(decodeBinaryTargetMask(rightMaskRaster, "right subject mask"));
  const leftToRightPixels = meanBoundaryDistance(left, squaredEuclideanDistanceField(right));
  const rightToLeftPixels = meanBoundaryDistance(right, squaredEuclideanDistanceField(left));
  const frameDiagonalPixels = Math.hypot(left.width, left.height);
  return Object.freeze({
    metric: "symmetric-mean-four-connected-boundary-distance-over-frame-diagonal-v1",
    leftToRightPixels,
    rightToLeftPixels,
    normalizedDistance: ((leftToRightPixels + rightToLeftPixels) * 0.5) / frameDiagonalPixels,
    leftBoundaryPixels: left.selectedPixels,
    rightBoundaryPixels: right.selectedPixels,
  });
}

export function computeNamedMotionOverlap(start, end, startMovingMaskRaster, endMovingMaskRaster, { channelDeltaThreshold = 2 } = {}) {
  requireSameDimensions([start, end, startMovingMaskRaster, endMovingMaskRaster], "motion-overlap rasters");
  if (!Number.isInteger(channelDeltaThreshold) || channelDeltaThreshold < 0 || channelDeltaThreshold > 255) throw new RangeError("motion channel threshold must be an integer in [0,255]");
  const startMask = decodeBinaryTargetMask(startMovingMaskRaster, "start moving-region mask");
  const endMask = decodeBinaryTargetMask(endMovingMaskRaster, "end moving-region mask");
  let absoluteDelta = 0;
  let changedPixels = 0;
  let namedRegionPixels = 0;
  let changedNamedRegionPixels = 0;
  for (let pixel = 0; pixel < startMask.mask.length; pixel += 1) {
    const offset = pixel * 4;
    let maximumChannelDelta = 0;
    for (let channel = 0; channel < 3; channel += 1) {
      const delta = Math.abs(start.rgba[offset + channel] - end.rgba[offset + channel]);
      absoluteDelta += delta;
      maximumChannelDelta = Math.max(maximumChannelDelta, delta);
    }
    const changed = maximumChannelDelta > channelDeltaThreshold;
    const named = startMask.mask[pixel] === 1 || endMask.mask[pixel] === 1;
    changedPixels += changed ? 1 : 0;
    namedRegionPixels += named ? 1 : 0;
    changedNamedRegionPixels += changed && named ? 1 : 0;
  }
  if (changedPixels === 0) throw new Error("motion endpoints contain no changed pixels above the frozen channel threshold");
  return Object.freeze({
    metric: "named-moving-region-rgb-overlap-v1",
    channelDeltaThreshold,
    rgbMaeCodeValues: absoluteDelta / (startMask.mask.length * 3),
    changedPixelRatio: changedPixels / startMask.mask.length,
    namedRegionChangedRatio: changedNamedRegionPixels / namedRegionPixels,
    changedPixelOverlapRatio: changedNamedRegionPixels / changedPixels,
    changedPixels,
    namedRegionPixels,
    changedNamedRegionPixels,
  });
}
