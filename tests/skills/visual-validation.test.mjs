import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { FloatType, LinearSRGBColorSpace } from 'three';
import { HDRLoader } from 'three/addons/loaders/HDRLoader.js';
import { minimumAlignedBytesPerRow, unpackAlignedReadback } from '../../skills/threejs-visual-validation/scripts/aligned-readback.mjs';

const protocol = readFileSync(new URL('../../skills/threejs-visual-validation/references/graphics-validation-protocol.md', import.meta.url), 'utf8');

test('color validation distinguishes encoded sRGB from linear HDR', () => {
  assert.ok(protocol.includes('LinearSRGBColorSpace'));
  assert.ok(!protocol.includes('Color inputs use `SRGBColorSpace`.'));
  const header = new TextEncoder().encode('#?RADIANCE\nFORMAT=32-bit_rle_rgbe\n\n-Y 1 +X 1\n');
  const input = new Uint8Array(header.length + 4);
  input.set(header);
  input.set([128, 128, 128, 129], header.length);
  const result = new HDRLoader().setDataType(FloatType).parse(input.buffer);
  assert.equal(result.colorSpace, LinearSRGBColorSpace);
  assert.ok(result.data[0] > 1, 'HDR light must survive without display-range clamping');
});

test('readback and timestamp scope limits are explicit', () => {
  assert.ok(protocol.includes('single-layer'));
  assert.ok(protocol.includes('lastValue'));
  assert.ok(protocol.includes('query capacity'));
});

for (const [width, bytes, expected] of [[1, 4, 256], [64, 4, 256], [65, 4, 512], [33, 8, 512]]) {
  test(`minimum stride: ${width} texels at ${bytes} bytes`, () => {
    assert.equal(minimumAlignedBytesPerRow(width, bytes), expected);
  });
}

test('larger actual stride, view offset, and GPU copy offset stay independent', () => {
  const backing = new Uint8Array(600).fill(239);
  const source = new DataView(backing.buffer, 8, 580);
  const first = Uint8Array.from({ length: 12 }, (_, i) => i);
  const second = Uint8Array.from({ length: 12 }, (_, i) => 50 + i);
  backing.set(first, 12);
  backing.set(second, 524);
  const snapshot = backing.slice();
  const result = unpackAlignedReadback(source, { width: 3, height: 2, bytesPerRow: 512, viewOffset: 4, copyOffset: 256 });
  assert.deepEqual(result.pixels, new Uint8Array([...first, ...second]));
  assert.equal(result.layout.minimumCopyBytes, 524);
  assert.equal(result.layout.copyOffset, 256);
  assert.equal(result.sourceByteLength, 580);
  assert.deepEqual(backing, snapshot);
  result.pixels[0] = 99;
  assert.equal(backing[12], 0);
});

test('one row needs its payload, not trailing alignment padding', () => {
  const result = unpackAlignedReadback(new Uint8Array([1, 2, 3, 4]), { width: 1, height: 1, bytesPerRow: 256 });
  assert.deepEqual(result.pixels, new Uint8Array([1, 2, 3, 4]));
});

const valid = { width: 1, height: 2, bytesPerTexel: 4, bytesPerRow: 256 };
for (const [field, value] of [['width', 0], ['height', 1.5], ['bytesPerTexel', 0], ['bytesPerRow', 257], ['viewOffset', -1], ['copyOffset', 1], ['width', Number.MAX_SAFE_INTEGER]]) {
  test(`reject invalid ${field}=${value}`, () => {
    assert.throws(() => unpackAlignedReadback(new Uint8Array(512), { ...valid, [field]: value }), RangeError);
  });
}

test('missing stride and short source cannot be interpreted as tight pixels', () => {
  assert.throws(() => unpackAlignedReadback(new Uint8Array(512), { width: 1, height: 2 }), /bytesPerRow/);
  assert.throws(() => unpackAlignedReadback(new Uint8Array(259), valid), /260 are required/);
  assert.throws(() => unpackAlignedReadback(new Uint8Array(512), { ...valid, width: 65 }), /smaller than/);
  assert.throws(() => unpackAlignedReadback(new ArrayBuffer(512), valid), TypeError);
});

test('half-float pixel bytes remain byte-exact rather than converted to display pixels', () => {
  const source = new Uint8Array(264);
  const first = [0, 60, 0, 64, 0, 66, 0, 60];
  const second = [0, 68, 0, 69, 0, 70, 0, 60];
  source.set(first, 0);
  source.set(second, 256);
  const result = unpackAlignedReadback(source, { width: 1, height: 2, bytesPerTexel: 8, bytesPerRow: 256 });
  assert.deepEqual(result.pixels, new Uint8Array([...first, ...second]));
});
