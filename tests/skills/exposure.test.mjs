import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { ClampToEdgeWrapping, LinearFilter, NoColorSpace } from 'three/webgpu';
import { createIdentity3DLut } from '../../skills/threejs-exposure-color-grading/examples/identity-3d-lut.mjs';

const reference = readFileSync(new URL('../../skills/threejs-exposure-color-grading/references/scene-referred-color-pipeline.md', import.meta.url), 'utf8');

test('valid weighted means are invariant to a common positive weight scale', () => {
  const mean = weights => 2 ** (weights.reduce((sum, w) => sum + w * Math.log2(4), 0) / weights.reduce((a, b) => a + b));
  assert.equal(mean([1, 2]), mean([1e-9, 2e-9]));
  const biased = 2 ** ((3e-9 * Math.log2(4)) / Math.max(3e-9, 1e-6));
  assert.ok(Math.abs(biased - 4) > 2);
  assert.ok(reference.includes('L_key = exp2(sum(w_i * l_i) / sum(w_i))'));
});

test('zero-weight masking after invalid arithmetic still poisons a reduction', () => {
  assert.ok(Number.isNaN(0 * Math.log2(NaN)));
  assert.ok(reference.includes('before logarithms'));
});

test('hierarchical reduction must shrink and a key card uses the configured compensation', () => {
  assert.equal(Math.ceil(100 / 1), 100);
  assert.equal(Math.ceil(100 / 2), 50);
  assert.equal(Math.log2(0.18 / 0.18) + 1, 1);
  assert.ok(reference.includes('W >= 2'));
  assert.match(reference, /compensation\s+is zero/);
});

test('radiance unit conversion preserves the product only with compatible EV bounds', () => {
  const radiance = 4, currentEV = -1, k = 8;
  const converted = currentEV - Math.log2(k);
  assert.equal(radiance * 2 ** currentEV, k * radiance * 2 ** converted);
  assert.notEqual(radiance * 2 ** currentEV, k * radiance * 2 ** Math.max(-2, converted));
  assert.ok(reference.includes('convert the EV bounds'));
  assert.ok(reference.includes('superseded epoch'));
});

test('adaptation admits instant response separately from invalid time constants', () => {
  const current = 0, target = 2, dt = 0.25, tau = 0.5;
  const once = target + (current - target) * Math.exp(-dt / tau);
  const twice = target + (once - target) * Math.exp(-dt / tau);
  assert.ok(Math.abs(twice - (target + (current - target) * Math.exp(-2 * dt / tau))) < 1e-12);
  assert.ok(Number.isNaN(1 - Math.exp(-0 / 0)));
  assert.ok(reference.includes('zero time constant'));
});

test('identity LUT stores red-fastest RGBA data with explicit linear sampling', () => {
  const texture = createIdentity3DLut(4);
  const index = (r, g, b) => 4 * (r + 4 * (g + 4 * b));
  assert.deepEqual([...texture.image.data.slice(index(1, 2, 3), index(1, 2, 3) + 4)], [85, 170, 255, 255]);
  assert.deepEqual([texture.minFilter, texture.magFilter], [LinearFilter, LinearFilter]);
  assert.deepEqual([texture.wrapS, texture.wrapT, texture.wrapR], Array(3).fill(ClampToEdgeWrapping));
  assert.equal(texture.colorSpace, NoColorSpace);
  assert.equal(texture.generateMipmaps, false);
  assert.equal(texture.image.data.byteLength, 256);
  texture.dispose();
});

test('RGBA8 identity approximation has a bounded rounding error', () => {
  const texture = createIdentity3DLut(7);
  for (let i = 0; i < 7; i++) {
    const actual = texture.image.data[4 * i] / 255;
    assert.ok(Math.abs(actual - i / 6) <= 0.5 / 255 + 1e-12);
  }
  assert.equal(texture.userData.maxQuantizationError, 0.5 / 255);
  texture.dispose();
});

test('LUT size respects the declared texture limit and byte budget', () => {
  assert.throws(() => createIdentity3DLut(4, { maxTextureDimension3D: 3 }), /texture dimension/);
  assert.throws(() => createIdentity3DLut(4, { maxBytes: 128 }), /byte budget/);
  const exact = createIdentity3DLut(2, { maxTextureDimension3D: 2, maxBytes: 32 });
  assert.equal(exact.image.data.byteLength, 32);
  exact.dispose();
});

test('invalid LUT dimensions, limits, and arithmetic are rejected', () => {
  for (const size of [0, 1, 2.5, NaN, Infinity]) {
    assert.throws(() => createIdentity3DLut(size), RangeError);
  }
  assert.throws(() => createIdentity3DLut(2, null), TypeError);
  assert.throws(() => createIdentity3DLut(2, { maxBytes: -1 }), RangeError);
  assert.throws(() => createIdentity3DLut(2, { maxTextureDimension3D: Infinity }), RangeError);
  assert.throws(() => createIdentity3DLut(Number.MAX_SAFE_INTEGER, {
    maxTextureDimension3D: Number.MAX_SAFE_INTEGER, maxBytes: Number.MAX_SAFE_INTEGER
  }), /safe/);
});

test('Lut3D half-texel placement spans voxel centers, not texture edges', () => {
  for (const size of [2, 7, 16, 33]) {
    for (const x of [0, 0.1, 0.5, 0.9, 1]) {
      const uv = 0.5 / size + x * (1 - 1 / size);
      assert.ok(Math.abs(uv * size - 0.5 - x * (size - 1)) < 1e-12);
    }
  }
});
