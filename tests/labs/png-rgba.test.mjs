import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  compareRgbaPngs,
  decodeRgbaPng,
  encodeRgbaPng,
  inspectRgbaPng,
} from '../../scripts/lib/png-rgba.mjs';

function raster(width, height, pixelAt) {
  const data = new Uint8Array(width * height * 4);
  for (let y = 0; y < height; y += 1) for (let x = 0; x < width; x += 1) {
    data.set(pixelAt(x, y), (y * width + x) * 4);
  }
  return encodeRgbaPng({ width, height, data });
}

test('shared PNG decoder verifies CRC, filters, dimensions, and pixel closure', () => {
  const image = raster(16, 12, (x, y) => [x * 12, y * 16, (x ^ y) * 8, 255]);
  const decoded = decodeRgbaPng(image);
  assert.equal(decoded.width, 16);
  assert.equal(decoded.height, 12);
  assert.equal(decoded.pixels.byteLength, 16 * 12 * 4);
  const corrupt = Buffer.from(image);
  corrupt[corrupt.byteLength - 8] ^= 1;
  assert.throws(() => decodeRgbaPng(corrupt), /CRC mismatch/);
  assert.throws(() => decodeRgbaPng(Buffer.concat([image, Buffer.of(0)])), /trailing bytes/);
});

test('evidence inspection rejects constant colors and nearly transparent payloads', () => {
  const constantRed = raster(20, 20, () => [255, 0, 0, 255]);
  assert.throws(() => inspectRgbaPng(constantRed, 'constant-red.png'), /effectively flat/);

  const transparentNoise = raster(20, 20, (x, y) => [x * 11, y * 13, x ^ y, x === 0 && y === 0 ? 255 : 0]);
  assert.throws(() => inspectRgbaPng(transparentNoise, 'transparent-noise.png'), /transparent/);

  const useful = raster(20, 20, (x, y) => [x * 11, y * 13, x ^ y, 255]);
  assert.equal(inspectRgbaPng(useful).opaquePixels, 400);
});

test('decoded comparison distinguishes pixel aliases from material changes', () => {
  const baseline = raster(12, 12, (x, y) => [x * 8, y * 8, 32, 255]);
  const changed = raster(12, 12, (x, y) => [x * 8, y * 8, x < 6 ? 32 : 96, 255]);
  assert.equal(compareRgbaPngs(baseline, baseline).ratio, 0);
  const comparison = compareRgbaPngs(baseline, changed);
  assert.equal(comparison.ratio, 0.5);
  assert.equal(comparison.maxChannelDelta, 64);
});
