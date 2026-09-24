import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { Vector3, BufferGeometry } from 'three';
import { IndirectStorageBufferAttribute } from 'three/webgpu';
const root = new URL('../../skills/threejs-procedural-planets/references/', import.meta.url);
const read = name => readFileSync(new URL(name, root), 'utf8').replace(/\s+/g, ' ');
const body = read('body-model-mapping-and-lod.md'), solid = read('solid-fields-and-coast.md'), gas = read('gas-cloud-deck.md');

test('rationalized sagitta preserves small curvature without large squared radii', () => {
  const R = 1e9, r = 1, u = r / R;
  assert.equal(R - Math.sqrt(R * R - r * r), 0);
  const stable = r * u / (1 + Math.sqrt((1 - u) * (1 + u)));
  assert.equal(stable, 5e-10);
  assert.ok(body.includes('sagitta = r*u/(1 + sqrt((1-u)*(1+u)))'));
});

test('normalizing a parent-edge direction does not reproduce its rendered chord', () => {
  const a = new Vector3(Math.cos(0.4), Math.sin(0.4), 0);
  const b = new Vector3(Math.cos(0.4), -Math.sin(0.4), 0);
  const parentEdge = a.clone().add(b).multiplyScalar(0.5);
  assert.ok(parentEdge.distanceTo(parentEdge.clone().normalize()) > 0.07);
  assert.ok(body.includes('rendered coarse triangle'));
});

test('two-to-one edge collapse needs an even interval count and separate degenerate counts', () => {
  for (const side of [3, 17, 33]) assert.equal((side - 1) % 2, 0);
  assert.notEqual((32 - 1) % 2, 0);
  const tris = [];
  for (let y = 0; y < 2; y++) for (let x = 0; x < 2; x++) {
    const a = y * 3 + x, b = a + 1, c = a + 4, d = a + 3;
    tris.push([a, b, d], [b, c, d]);
  }
  const collapsed = tris.map(triangle => triangle.map(index => index === 1 ? 0 : index));
  assert.equal(collapsed.length, 8);
  assert.equal(collapsed.filter(triangle => new Set(triangle).size === 3).length, 7);
  assert.ok(body.includes('even number of intervals'));
  assert.ok(body.includes('unstitched upper bound'));
});

test('serial cache filters require summed support, not the maximum individual radius', () => {
  const offsets = [];
  for (let a = -2; a <= 2; a++) for (let b = -3; b <= 3; b++) offsets.push(a + b);
  assert.equal(Math.max(...offsets), 5);
  assert.notEqual(Math.max(...offsets), Math.max(2, 3));
  assert.ok(solid.includes('sum along each serial path'));
  assert.ok(solid.includes('continuous bound'));
});

test('ellipsoid normal-height displacement is not radial-height displacement', () => {
  const direction = new Vector3(1, 1, 0).normalize();
  const p0 = direction.clone().multiplyScalar(1 / Math.sqrt(direction.x ** 2 / 9 + direction.y ** 2 / 4));
  const normal = new Vector3(p0.x / 9, p0.y / 4, 0).normalize();
  assert.ok(normal.clone().multiplyScalar(0.1).distanceTo(direction.clone().multiplyScalar(0.1)) > 0.03);
  assert.ok(solid.includes('X = p0 + h*N0'));
});

test('a radial crater profile needs zero center slope for a differentiable center', () => {
  const epsilon = 1e-6;
  const coneRight = Math.abs(epsilon) / epsilon, coneLeft = Math.abs(-epsilon) / -epsilon;
  assert.notEqual(coneRight, coneLeft);
  assert.ok(Math.abs((1 - Math.cos(epsilon)) / epsilon) < 1e-6);
  assert.ok(solid.includes("profile'(0) = 0"));
});

test('body-scale f32 rounding loses detail that local residuals preserve', () => {
  const anchor = 6371000, local = 0.01;
  assert.equal(Math.fround(anchor + local) - Math.fround(anchor), 0);
  assert.ok(Math.abs(Math.fround(local) - local) < 1e-9);
  assert.ok(solid.includes('anchor plus local residual'));
});

test('gas field coordinates collapse longitude consistently at each pole', () => {
  const embedded = (longitude, latitude) => new Vector3(Math.cos(latitude) * Math.cos(longitude), Math.sin(latitude), Math.cos(latitude) * Math.sin(longitude));
  for (const latitude of [-Math.PI / 2, Math.PI / 2]) {
    assert.ok(embedded(0, latitude).distanceTo(embedded(1, latitude)) < 1e-15);
  }
  assert.ok(Math.hypot(1 - Math.cos(1), Math.sin(1)) > 0.9);
  assert.ok(gas.includes('cos(latitude)'));
});

test('positive jet motion uses inverse advection and integrated angular displacement', () => {
  const time = 2, acceleration = 0.4, offset = 0.5 * acceleration * time ** 2;
  const longitude = offset;
  assert.equal(Math.cos(longitude - offset), 1);
  assert.notEqual(Math.cos(longitude + offset), 1);
  assert.notEqual(offset, acceleration * time * time);
  assert.ok(gas.includes('longitude - angularDisplacement'));
  assert.ok(gas.includes('radians per second'));
});

test('indirect setters do not validate record alignment or enable optional features', () => {
  const data = new Uint32Array(5); data[3] = 0xffffffff;
  assert.equal(new Int32Array(data.buffer)[3], -1);
  const geometry = new BufferGeometry().setIndirect(new IndirectStorageBufferAttribute(data, 5), 2);
  assert.equal(geometry.indirectOffset, 2);
  assert.equal(geometry.indirect.array.byteLength, 20);
  assert.ok(body.includes('enabled device feature'));
  assert.ok(body.includes('4-byte-aligned'));
  geometry.dispose();
});
