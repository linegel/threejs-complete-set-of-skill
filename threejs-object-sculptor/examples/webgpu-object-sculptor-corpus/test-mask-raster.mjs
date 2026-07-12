import assert from "node:assert/strict";

import {
  computeMaskedTierError,
  computeNamedMotionOverlap,
  computeNormalizedSymmetricBoundaryDistance,
  CORPUS_TARGET_MASK_PLAN,
  decodeBinaryTargetMask,
} from "./mask-raster.mjs";

function raster(width, height, pixel) {
  const rgba = new Uint8Array(width * height * 4);
  for (let y = 0; y < height; y += 1) for (let x = 0; x < width; x += 1) rgba.set(pixel(x, y), (y * width + x) * 4);
  return { width, height, rgba };
}

function mask(width, height, selected) {
  return raster(width, height, (x, y) => selected(x, y) ? [255, 255, 255, 255] : [0, 0, 0, 255]);
}

assert.equal(CORPUS_TARGET_MASK_PLAN.length, 15);
assert.equal(CORPUS_TARGET_MASK_PLAN.filter(({ maskKind }) => maskKind === "subject-silhouette").length, 9);
assert.equal(CORPUS_TARGET_MASK_PLAN.filter(({ maskKind }) => maskKind === "named-moving-semantic-regions").length, 6);

const fullMask = mask(8, 8, (x, y) => x >= 2 && x <= 5 && y >= 2 && y <= 5);
const shiftedMask = mask(8, 8, (x, y) => x >= 3 && x <= 6 && y >= 2 && y <= 5);
const reference = raster(8, 8, (x, y) => fullMask.rgba[(y * 8 + x) * 4] ? [128, 64, 32, 255] : [4, 4, 4, 255]);
const same = raster(8, 8, (x, y) => fullMask.rgba[(y * 8 + x) * 4] ? [128, 64, 32, 255] : [4, 4, 4, 255]);
const shifted = raster(8, 8, (x, y) => shiftedMask.rgba[(y * 8 + x) * 4] ? [128, 64, 32, 255] : [4, 4, 4, 255]);
assert.equal(computeMaskedTierError(reference, same, fullMask, fullMask).maskedP95, 0);
const tierError = computeMaskedTierError(reference, shifted, fullMask, shiftedMask);
assert.equal(tierError.maskedP95, 1, "silhouette loss must dominate color similarity");
assert.equal(tierError.silhouetteMismatchPixels, 8);

const distance = computeNormalizedSymmetricBoundaryDistance(fullMask, shiftedMask);
assert(distance.normalizedDistance > 0);
assert.equal(computeNormalizedSymmetricBoundaryDistance(fullMask, fullMask).normalizedDistance, 0);
const pointA = mask(6, 7, (x, y) => x === 0 && y === 0);
const pointB = mask(6, 7, (x, y) => x === 3 && y === 4);
const pointDistance = computeNormalizedSymmetricBoundaryDistance(pointA, pointB);
assert.equal(pointDistance.leftToRightPixels, 5, "squared Euclidean transform must recover the exact 3-4-5 distance");
assert.equal(pointDistance.rightToLeftPixels, 5);
assert.equal(pointDistance.normalizedDistance, 5 / Math.hypot(6, 7));

const startMoving = mask(8, 8, (x, y) => x === 2 && y >= 2 && y <= 5);
const endMoving = mask(8, 8, (x, y) => x === 5 && y >= 2 && y <= 5);
const motion = computeNamedMotionOverlap(reference, shifted, startMoving, endMoving);
assert(motion.rgbMaeCodeValues > 0.05);
assert(motion.changedPixelRatio > 0.01);
assert(motion.namedRegionChangedRatio > 0);
assert(motion.changedPixelOverlapRatio > 0);

assert.throws(() => decodeBinaryTargetMask(raster(2, 2, () => [127, 127, 127, 255])), /binary black\/white/);
assert.throws(() => decodeBinaryTargetMask(mask(2, 2, () => false)), /nonempty proper subset/);
assert.throws(() => computeNamedMotionOverlap(reference, reference, startMoving, endMoving), /no changed pixels/);

console.log(JSON.stringify({
  ok: true,
  masks: CORPUS_TARGET_MASK_PLAN.length,
  finalTierMasks: 9,
  actionMasks: 6,
  algorithms: [tierError.metric, distance.metric, motion.metric],
}, null, 2));
