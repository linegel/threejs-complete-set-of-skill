import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
const root = new URL('../../skills/threejs-volumetric-clouds/references/', import.meta.url);
const density = readFileSync(new URL('density-and-marching.md', root), 'utf8');
const lighting = readFileSync(new URL('lighting-and-shadows.md', root), 'utf8');
const temporal = readFileSync(new URL('temporal-reconstruction.md', root), 'utf8');
const step = (sigma, source, length) => {
  const tau = sigma * length;
  return { T: Math.exp(-tau), L: source * length * (tau === 0 ? 1 : -Math.expm1(-tau) / tau) };
};

test('the zero-extinction approximation is controlled by optical depth, not coefficient alone', () => {
  const actual = step(1e-9, 1e-9, 1e12);
  assert.equal(actual.T, 0);
  assert.ok(Math.abs(actual.L - 1) < 1e-12);
  assert.notEqual(actual.L, 1e-9 * 1e12);
  assert.ok(density.includes('dimensionless optical depth'));
});

test('homogeneous transfer is stable at tiny optical depth and under step subdivision', () => {
  for (const sigma of [0, 1e-12, 0.4, 10]) {
    const whole = step(sigma, 2, 3), part = step(sigma, 2, 1.5);
    assert.ok(Math.abs(whole.L - (part.L + part.T * part.L)) < 1e-12);
    assert.ok(Math.abs(whole.T - part.T * part.T) < 1e-12);
  }
});

test('an unlit thin cloud can still change a bright background substantially', () => {
  const tau = 1e-4, background = 1e6;
  const omittedSource = 0;
  const imageError = background * -Math.expm1(-tau);
  assert.equal(omittedSource, 0);
  assert.ok(imageError > 99);
  assert.ok(density.includes('L_behind_max'));
  assert.ok(density.includes('accumulate the error budget'));
});

test('maximum sampled density does not bound unsampled procedural peaks', () => {
  const field = x => Math.sin(Math.PI * x) ** 2;
  assert.ok(Math.max(field(0), field(1)) < 1e-20);
  assert.equal(field(0.5), 1);
  assert.ok(density.includes('finest-cell continuous bound'));
});

test('finite-disc attenuation belongs inside the angular integral', () => {
  const radiance = [2, 8], transmission = [1, 0];
  const integrated = (radiance[0] * transmission[0] + radiance[1] * transmission[1]) / 2;
  const factored = (radiance[0] + radiance[1]) / 2 * 0.5;
  assert.equal(integrated, 1);
  assert.equal(factored, 2.5);
  assert.ok(lighting.includes('T_cloud(wi)'));
});

test('overlapping media differ from two serial full-segment composites', () => {
  const atmosphere = step(0.5, 1, 1), cloud = step(0.5, 2, 1);
  const coupled = step(1, 3, 1);
  const serial = cloud.L + cloud.T * atmosphere.L;
  assert.ok(Math.abs(coupled.L - serial) > 0.1);
  assert.equal(coupled.T, cloud.T * atmosphere.T);
  assert.ok(lighting.includes('overlapping media'));
});

test('small opacity weights preserve the representative depth', () => {
  const w = [1e-10, 1e-10], z = [10, 20];
  const sum = w[0] + w[1];
  assert.ok(Math.abs((w[0] * z[0] + w[1] * z[1]) / sum - 15) < 1e-12);
  assert.ok((w[0] * z[0] + w[1] * z[1]) / Math.max(sum, 1e-6) < 10);
  assert.ok(temporal.includes('actual positive weight sum'));
});

test('invalid history is not made safe by a zero blend weight', () => {
  assert.ok(Number.isNaN(1 * 2 + 0 * NaN));
  assert.ok(temporal.includes('before clipping or multiplying'));
  assert.match(temporal, /zero\s+response time/);
});

test('front depth cannot remove a back-layer contribution from a coarse radiance sample', () => {
  const frontRadiance = 2, frontTransmission = 0.5, rearRadiance = 10;
  const combined = frontRadiance + frontTransmission * rearRadiance;
  assert.equal(combined, 7);
  assert.notEqual(combined, frontRadiance);
  assert.ok(temporal.includes('representative depth cannot truncate'));
});

test('parallel DDA axes require an infinity branch instead of zero divided by zero', () => {
  assert.ok(Number.isNaN(0 / 0));
  assert.ok(density.includes('parallel axes'));
});
