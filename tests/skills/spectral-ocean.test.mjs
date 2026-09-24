import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { positiveInverseDft2D, makeConventionFixtures, measureTransform, applyTolerances } from '../../skills/threejs-spectral-ocean/scripts/fft-convention-oracle.mjs';

const reference = readFileSync(new URL('../../skills/threejs-spectral-ocean/references/spectral-cascade-ocean-system.md', import.meta.url), 'utf8');
const gates = { maximum: 1e-10, rms: 1e-10, relativeL2: 1e-10, parseval: 1e-10 };
function separableDft(input, size) {
  const rows = new Float64Array(input.length), result = new Float64Array(input.length);
  for (const [source, target, vertical] of [[input, rows, false], [rows, result, true]]) {
    for (let z = 0; z < size; z++) for (let x = 0; x < size; x++) {
      const out = 2 * (z * size + x);
      for (let k = 0; k < size; k++) {
        const index = 2 * (vertical ? k * size + x : z * size + k);
        const angle = 2 * Math.PI * (k - size / 2) * (vertical ? z : x) / size;
        target[out] += source[index] * Math.cos(angle) - source[index + 1] * Math.sin(angle);
        target[out + 1] += source[index] * Math.sin(angle) + source[index + 1] * Math.cos(angle);
      }
    }
  }
  return result;
}

test('all fourteen convention fixtures agree with a separately implemented separable DFT', () => {
  for (const fixture of makeConventionFixtures()) {
    const metrics = measureTransform(fixture.spectrum, separableDft(fixture.spectrum, 8), 8, fixture.expectReal);
    assert.equal(applyTolerances(metrics, fixture.expectReal ? { ...gates, hermitianPartner: 1e-10, imaginaryLeakage: 1e-10 } : gates).passed, true, fixture.name);
  }
});

test('relative transform error does not vanish with signal amplitude', () => {
  for (const amplitude of [1, 1e-12, 1e-160]) {
    const spectrum = new Float64Array(128);
    spectrum[72] = amplitude;
    const actual = positiveInverseDft2D(spectrum, 8).map(value => value * 2);
    const metrics = measureTransform(spectrum, actual, 8);
    assert.ok(Math.abs(metrics.relativeL2 - 1) < 1e-12);
    assert.ok(Math.abs(metrics.parseval - 3) < 1e-12);
  }
});

test('zero-reference error is explicit rather than divided by an arbitrary epsilon', () => {
  const spectrum = new Float64Array(128), actual = new Float64Array(128);
  const zero = measureTransform(spectrum, actual, 8, true);
  assert.equal(zero.relativeL2, 0);
  actual[0] = 1e-160;
  const wrong = measureTransform(spectrum, actual, 8, true);
  assert.equal(wrong.relativeL2, Infinity);
  assert.equal(wrong.parseval, Infinity);
  assert.equal(applyTolerances(wrong, { maximum: 1 }).passed, false);
});

test('tolerances cannot pass without a declared gate or with invalid measurements', () => {
  const metrics = measureTransform(new Float64Array(128), new Float64Array(128), 8);
  assert.throws(() => applyTolerances(metrics, {}), /nonempty/);
  assert.throws(() => applyTolerances(metrics, { constructor: 1 }), /unknown metric/);
  assert.equal(applyTolerances({ ...metrics, rms: NaN }, { maximum: 1 }).passed, false);
  assert.equal(applyTolerances({ ...metrics, maximum: -1 }, { maximum: 1 }).passed, false);
});

test('the CPU oracle rejects oversized work and invalid numeric data before computation', () => {
  assert.throws(() => makeConventionFixtures(64), /size/);
  assert.throws(() => positiveInverseDft2D([], 2 ** 32), /size must/);
  for (const value of [NaN, Infinity, '1', 1n]) {
    const field = Array(128).fill(0); field[0] = value;
    assert.throws(() => positiveInverseDft2D(field, 8), /finite/);
  }
  assert.throws(() => makeConventionFixtures(8, NaN), /seed/);
  assert.throws(() => measureTransform(new Float64Array(128), new Float64Array(128), 8, 'false'), /boolean/);
});

const multiply = ([ar, ai], [br, bi]) => [ar * br - ai * bi, ar * bi + ai * br];
const add = ([ar, ai], [br, bi]) => [ar + br, ai + bi];
const conjugate = ([r, i]) => [r, -i];
const phase = angle => [Math.cos(angle), Math.sin(angle)];

test('a shared current phase preserves the Hermitian wave pair', () => {
  const a = [0.3, 0.7], b = [-0.2, 0.5], omega = 2, ku = 0.8, t = 0.7;
  const evolve = (left, right, current) => multiply(phase(-current * t), add(multiply(left, phase(-omega * t)), multiply(conjugate(right), phase(omega * t))));
  const k = evolve(a, b, ku), negative = evolve(b, a, -ku);
  assert.ok(Math.hypot(...add(negative, conjugate(k).map(value => -value))) < 1e-12);
  assert.ok(reference.includes('exp(-i k dot U t)'));
});

test('one stopped Doppler branch does not bound the opposite traveling branch', () => {
  const omega = 2, ku = -2, a = 0, partner = 1;
  assert.equal(Math.abs(omega + ku) * (a + partner), 0);
  assert.equal(Math.abs(omega + ku) * a + Math.abs(omega - ku) * partner, 4);
  assert.ok(reference.includes('abs(omega_int-k dot U)'));
});

test('time-varying choppiness has an additional product-rule velocity', () => {
  const D = -0.4, Ddot = 0.2, chi = 0.7, chiDot = 0.3;
  const dt = 1e-5;
  const position = t => (chi + chiDot * t) * (D + Ddot * t);
  const difference = (position(dt) - position(-dt)) / (2 * dt);
  assert.ok(Math.abs(difference - (chi * Ddot + chiDot * D)) < 1e-10);
  assert.ok(reference.includes('chiDot * D'));
});

test('fixture random values repeat exactly without global random state', () => {
  const a = makeConventionFixtures(8, 10), b = makeConventionFixtures(8, 10);
  assert.equal(a.length, 14);
  assert.deepEqual(a.map(value => value.spectrum), b.map(value => value.spectrum));
  assert.notDeepEqual(a[5].spectrum, makeConventionFixtures(8, 11)[5].spectrum);
});
