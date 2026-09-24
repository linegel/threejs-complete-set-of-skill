import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { Vector3 } from 'three';
import { float } from 'three/tsl';
import { createFilteredHeightNormal } from '../../skills/threejs-procedural-materials/examples/filtered-height-normal.mjs';
const base = new URL('../../skills/threejs-procedural-materials/', import.meta.url);
const source = readFileSync(new URL('examples/filtered-height-normal.mjs', base), 'utf8');
const reference = readFileSync(new URL('references/procedural-pbr-system.md', base), 'utf8').replace(/\s+/g, ' ');
const valid = { band: float(0.3), bandMean: 0, bandHalfRange: 1, heightHalfAmplitude: 0.1,
  footprintCyclesPerSample: 0.2, physicalSupportFrequency: 2, slopeVarianceCalibration: 1,
  qFade: [0.25, 0.5], roughness: 0.4, varianceScale: 1 };

test('fade edges remain ordered and distinct after f32 conversion', () => {
  for (const qFade of [Array(2), [0.2, ], [0.3, 0.300000001], [0.5, 0.5], [-0.1, 0.5]]) {
    assert.throws(() => createFilteredHeightNormal({ ...valid, qFade }), /qFade/);
  }
});

test('invalid literal material inputs cannot enter divisions or variance math', () => {
  const cases = [['bandHalfRange', 0], ['bandHalfRange', Number.MIN_VALUE],
    ['physicalSupportFrequency', -1], ['roughness', 1.1], ['varianceScale', -1],
    ['heightHalfAmplitude', Infinity], ['footprintCyclesPerSample', -1], ['bandMean', 1e100]];
  for (const [key, value] of cases) {
    assert.throws(() => createFilteredHeightNormal({ ...valid, [key]: value }), new RegExp(key));
  }
});

function normalFromDerivatives(dx, dy, n, hx, hy, face = 1, floor = 1e-5) {
  const lx = dx.length(), ly = dy.length();
  const sx = dx.clone().divideScalar(lx || 1), sy = dy.clone().divideScalar(ly || 1);
  const r1 = sy.clone().cross(n), r2 = n.clone().cross(sx);
  const det = sx.dot(r1) * face;
  const grad = r1.multiplyScalar(hx / (lx || 1)).add(r2.multiplyScalar(hy / (ly || 1))).multiplyScalar(Math.sign(det));
  const candidate = n.clone().multiplyScalar(Math.abs(det)).sub(grad);
  return lx > 0 && ly > 0 && Math.abs(det) >= floor && candidate.length() > 0 ? candidate.normalize() : n.clone();
}

test('surface-gradient rescaling preserves physical slopes and double-sided orientation', () => {
  const expected = new Vector3(-0.2, -0.3, 1).normalize();
  for (const scale of [1e-5, 1, 1e5]) {
    const dx = new Vector3(scale, 0, 0), dy = new Vector3(0, scale, 0);
    assert.ok(normalFromDerivatives(dx, dy, new Vector3(0, 0, 1), 0.2 * scale, 0.3 * scale).distanceTo(expected) < 1e-12);
    assert.ok(normalFromDerivatives(dx, dy, new Vector3(0, 0, -1), 0.2 * scale, 0.3 * scale, -1).distanceTo(expected.clone().negate()) < 1e-12);
  }
});

test('degenerate derivative frames retain the finite base normal', () => {
  const n = new Vector3(0, 0, 1);
  assert.deepEqual(normalFromDerivatives(new Vector3(), new Vector3(0, 1, 0), n, 0, 0), n);
  assert.deepEqual(normalFromDerivatives(new Vector3(1, 0, 0), new Vector3(2, 0, 0), n, 1, 2), n);
  assert.ok(source.includes('normalValid'));
  assert.ok(source.includes('minRelativeDet'));
});

test('valid material construction exposes normal conditioning without altering ownership', () => {
  const result = createFilteredHeightNormal(valid);
  assert.ok(Object.isFrozen(result));
  for (const key of ['normalNode', 'normalValid', 'roughnessNode', 'height', 'keep', 'removedSlopeVariance']) {
    assert.equal(result[key]?.isNode, true, key);
  }
  assert.throws(() => createFilteredHeightNormal({ ...valid, prefix: 'invalid-name' }), /prefix/);
  assert.throws(() => createFilteredHeightNormal({ ...valid, minRelativeDet: 0 }), /minRelativeDet/);
});

test('roughness variance accounts for removed amplitude power rather than amplitude', () => {
  const amplitude = 0.1, frequency = 2, keep = 0.4;
  const total = (2 * Math.PI * amplitude * frequency) ** 2 / 2;
  assert.ok(Math.abs(total * keep ** 2 + total * (1 - keep ** 2) - total) < 1e-12);
  assert.notEqual(total * (1 - keep), total * (1 - keep ** 2));
  assert.ok(reference.includes('locally stationary'));
});

test('triplanar texture-node options are not assumed to survive the built-in sampler', () => {
  assert.ok(reference.includes('reads only their texture values'));
});

test('shadow-node replacement needs material version invalidation', async () => {
  const { default: Renderer } = await import('three/src/renderers/common/Renderer.js');
  const { MeshStandardNodeMaterial } = await import('three/webgpu');
  const material = new MeshStandardNodeMaterial();
  const renderer = { _cacheShadowNodes: new WeakMap(), shadowMap: { transmitted: false } };
  const read = () => Renderer.prototype._getShadowNodes.call(renderer, material);
  material.positionNode = float(1);
  const first = read();
  material.positionNode = float(2);
  assert.equal(read().positionNode, first.positionNode);
  material.needsUpdate = true;
  assert.equal(read().positionNode, material.positionNode);
  material.opacityNode = float(0.25);
  material.alphaTestNode = float(0.5);
  material.needsUpdate = true;
  assert.equal(read().colorNode, null);
  assert.ok(reference.includes('opacityNode or alphaTestNode'));
  material.dispose();
});
