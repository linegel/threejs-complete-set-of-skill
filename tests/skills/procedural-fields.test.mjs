import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { sampleLatticeCPU } from '../../skills/threejs-procedural-fields/examples/cpu-tsl-field-parity.mjs';

const reference = readFileSync(new URL('../../skills/threejs-procedural-fields/references/field-stack-recipes.md', import.meta.url), 'utf8');
const core = readFileSync(new URL('../../skills/threejs-procedural-fields/examples/cpu-tsl-field-parity.mjs', import.meta.url), 'utf8');
const mask = 0xffffffffn;
const mul = (a, b) => (a * b) & mask;
function independentHash(coordinate, seed) {
  const lanes = coordinate.map(x => BigInt(Math.floor(Math.fround(x))) & mask);
  let h = mul(lanes[0], 0x8da6b343n) ^ mul(lanes[1], 0xd8163841n)
    ^ mul(lanes[2], 0xcb1ab31fn) ^ mul(BigInt(seed), 0x9e3779b9n);
  h = mul(h ^ (h >> 16n), 0x21f0aaadn);
  h = mul(h ^ (h >> 15n), 0x735a2d97n);
  return Number((h ^ (h >> 15n)) & mask);
}

test('lattice rejects holes and nonfinite components before hashing', () => {
  for (const coordinate of [new Array(3), [0, , 0], [NaN, 0, 0], [Infinity, 0, 0], ['0', 0, 0]]) {
    assert.throws(() => sampleLatticeCPU(coordinate, 1), /three finite values/);
  }
  for (const seed of [-1, 2 ** 32, 1.5, NaN]) {
    assert.throws(() => sampleLatticeCPU([0, 0, 0], seed), /uint32/);
  }
});

test('lattice preserves wrapping u32 hashes and exact half-open 24-bit values', () => {
  const points = [[0, 0, 0], [-1, 2, -3], [2147483520, -2147483648, 0], [0.9, -0.01, 19.5]];
  for (const point of points) for (const seed of [0, 1, 0xffffffff, 0x2b58e6cc]) {
    const actual = sampleLatticeCPU(point, seed);
    const hash = independentHash(point, seed);
    assert.equal(actual.hash, hash);
    assert.equal(actual.value, (hash >>> 8) / 2 ** 24);
    assert.equal(Math.fround(actual.value), actual.value);
    assert.ok(actual.value >= 0 && actual.value < 1);
  }
  const high = sampleLatticeCPU([0, 0, 0], 0x2b58e6cc);
  assert.equal(high.hash, 0xffffffff);
  assert.equal(Math.fround(high.hash) / 2 ** 32, 1, 'old conversion reaches one');
  assert.equal(high.value, 1 - 2 ** -24);
  assert.match(core, /hash\.shiftRight\(uint\(8\)\)/);
});

test('lattice gates the f32-converted coordinate, not its f64 input', () => {
  assert.equal(sampleLatticeCPU([2147483647, 0, 0], 1).valid, false);
  assert.equal(sampleLatticeCPU([-2147483648, 0, 0], 1).valid, true);
  for (const x of [2147483648, -2147483904, Number.MAX_VALUE]) {
    const actual = sampleLatticeCPU([x, 0, 0], 1);
    assert.equal(actual.valid, false);
    assert.equal(actual.hash, null);
    assert.equal(actual.value, null);
  }
});

test('rectangular mip accounting includes the one-dimensional tail', () => {
  const texels = (w, h) => {
    let n = 0;
    for (;;) {
      n += w * h;
      if (w === 1 && h === 1) return n;
      w = Math.max(1, Math.floor(w / 2)); h = Math.max(1, Math.floor(h / 2));
    }
  };
  assert.equal(texels(1, 1024), 2047);
  assert.ok(texels(1, 1024) > 1024 * 4 / 3);
  assert.equal(texels(4, 4), 21);
  assert.match(reference, /one-dimensional tail/);
});

test('mesh filtering uses the full remapped support, not the carrier', () => {
  const carrier = 1, edge = 0.3, remappedSupport = 2;
  assert.ok(carrier * edge < 0.5 && remappedSupport * edge > 0.5);
  assert.match(reference, /q_mesh = f_support \* maxPostWarpEdgeInFieldUnits/);
});

test('drainage edits reach downstream beyond a local stencil halo', () => {
  const area = source => source.reduce((acc, x) => [...acc, x + (acc.at(-1) ?? 0)], []);
  assert.deepEqual(area([1, 1, 1, 1]), [1, 2, 3, 4]);
  assert.deepEqual(area([2, 1, 1, 1]), [2, 3, 4, 5]);
  assert.match(reference, /nonlocal dependency closure/);
});
