import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const base = new URL('../../skills/threejs-sky-atmosphere-and-haze/references/', import.meta.url);
const transport = readFileSync(new URL('atmosphere-transport.md', base), 'utf8');
const body = readFileSync(new URL('body-depth-and-composition.md', base), 'utf8');
const smooth = x => { const t = Math.max(0, Math.min(1, x)); return t * t * (3 - 2 * t); };

test('an opaque planet terminates the visible ray interval', () => {
  const atmosphere = [1, 9], planet = [3, 7];
  const visible = [Math.max(0, atmosphere[0]), Math.min(atmosphere[1], planet[0])];
  assert.deepEqual(visible, [1, 3]);
  assert.ok(body.includes('never resume behind the opaque body'));
});

test('increasing post error decreases the post result weight', () => {
  const weight = error => 1 - smooth((error - 0.1) / 0.4);
  assert.equal(weight(0.1), 1);
  assert.equal(weight(0.5), 0);
  assert.ok(body.includes('postWeight = 1 - smoothstep'));
});

test('outward top-boundary directions collapse to the same zero-length path', () => {
  const r = 11;
  for (const mu of [0.1, 0.5, 1]) {
    assert.ok(Math.abs(-r * mu + Math.sqrt(r * r * mu * mu)) < 1e-12);
  }
  assert.ok(transport.includes('many-to-one'));
});

test('zero exponential depth curvature has a linear limit and a stable inverse', () => {
  for (const k of [0, 1e-10, 1, 8]) {
    for (const z of [0, 0.1, 0.7, 1]) {
      const d = k === 0 ? 100 * z : 100 * Math.expm1(k * z) / Math.expm1(k);
      const inverse = k === 0 ? d / 100 : Math.log1p(d / 100 * Math.expm1(k)) / k;
      assert.ok(Math.abs(inverse - z) < 1e-12);
    }
  }
  assert.ok(transport.includes('k = 0'));
  assert.ok(transport.includes('expm1'));
});

test('scaled ellipsoid rays retain the original metric ray parameter', () => {
  const origin = 6 / 4, direction = -1 / 4;
  const A = direction * direction, B = 2 * origin * direction, C = origin * origin - 1;
  const q = -0.5 * (B - Math.sqrt(B * B - 4 * A * C));
  assert.deepEqual([q / A, C / q].sort((a, b) => a - b), [2, 10]);
  assert.ok(body.includes('do not renormalize'));
});

test('absolute optical-depth difference masks an inconsistent endpoint ordering', () => {
  const before = 7, after = 8;
  assert.equal(Math.abs(before - after), 1);
  assert.ok(before - after < 0);
  assert.ok(transport.includes('tauSegment = tauToTop(p,w) - tauToTop(q,w)'));
  assert.ok(!transport.includes('tauSegment = abs('));
});

test('cumulative radiance composition includes front-segment attenuation', () => {
  const sigma = 0.4, source = 2;
  const T = d => Math.exp(-sigma * d);
  const S = d => source * -Math.expm1(-sigma * d) / sigma;
  assert.ok(Math.abs(S(3) - (S(1) + T(1) * S(2))) < 1e-12);
  assert.ok(Math.abs((S(3) - S(1)) / T(1) - S(2)) < 1e-12);
  assert.ok(transport.includes('S(p->q) = (S(0->q) - S(0->p)) / T(0->p)'));
});

test('the existing homogeneous unit fixture preserves optical depth', () => {
  const kilometers = 0.01 * 1;
  const meters = 0.00001 * 1000;
  assert.equal(kilometers, meters);
  assert.equal(Math.exp(-kilometers), Math.exp(-meters));
  assert.ok(transport.includes('expected tau = 0.01'));
});
