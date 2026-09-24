import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { vec3 } from 'three/tsl';
import { createLatticeParityBundle } from '../../skills/threejs-procedural-fields/examples/cpu-tsl-field-parity.mjs';
const ref = readFileSync(new URL('../../skills/threejs-procedural-fields/references/field-stack-recipes.md', import.meta.url), 'utf8').replace(/\s+/g, ' ');

test('shader field names and numeric seeds are validated', () => {
  for (const prefix of ['', 'bad-name', '__reserved', '1start']) {
    assert.throws(() => createLatticeParityBundle({ coordinate: vec3(0), seed: 0, prefix }), /prefix/);
  }
  for (const seed of [-1, 0.5, NaN, 0x100000000]) {
    assert.throws(() => createLatticeParityBundle({ coordinate: vec3(0), seed }), /seed/);
  }
});

test('warped gradients include the warp Jacobian', () => {
  const field = (x, y) => Math.sin(x + 0.5 * y * y), x = 0.3, y = 0.7, h = 1e-5;
  const numeric = (field(x, y + h) - field(x, y - h)) / (2 * h);
  const analytic = Math.cos(x + 0.5 * y * y) * y;
  assert.ok(Math.abs(numeric - analytic) < 1e-9);
  assert.ok(Math.abs(numeric) > 0.5);
});

test('a boundary derivative at one point is not a uniform displacement bound', () => {
  const valueError = 0.5;
  const actualShift = Math.asin(valueError);
  const pointDerivative = 1;
  const tubeDerivativeFloor = Math.sqrt(1 - valueError ** 2);
  assert.ok(actualShift > valueError / pointDerivative);
  assert.ok(actualShift <= valueError / tubeDerivativeFloor);
  assert.ok(ref.includes('transverse derivative'));
  assert.ok(ref.includes('connecting segment'));
});
