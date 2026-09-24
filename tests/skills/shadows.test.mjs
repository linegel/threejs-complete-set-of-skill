import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { DirectionalLight, HalfFloatType, PerspectiveCamera, ShadowNode, UnsignedByteType } from 'three/webgpu';

const reference = readFileSync(new URL('../../skills/threejs-scalable-real-time-shadows/references/cached-clipmap-shadows.md', import.meta.url), 'utf8');

test('a required radius below the finest level still admits one covering level', () => {
  const R0 = 8, Rmax = 1, s = 2;
  const oldCount = Math.ceil(Math.log(Rmax / R0) / Math.log(s)) + 1;
  assert.ok(oldCount < 1);
  const Rrequired = Math.max(R0, Rmax);
  const count = Math.max(1, Math.ceil(Math.log(Rrequired / R0) / Math.log(s)) + 1);
  assert.equal(count, 1);
  assert.ok(reference.includes('Rrequired = max(R0, Rmax)'));
});

test('zero-width fades and content changes during rendering have explicit admission rules', () => {
  assert.ok(Number.isNaN((10 - 10) / (10 - 10)));
  assert.ok(reference.includes('zero-width fade'));
  assert.ok(reference.includes('recheck the frozen content'));
});

test('r185 shadow clone retains the bias node but drops filter and map type', () => {
  const source = new DirectionalLight().shadow;
  source.mapType = HalfFloatType;
  source.biasNode = { isNode: true };
  source.filterNode = () => null;
  const clone = source.clone();
  assert.equal(clone.biasNode, source.biasNode);
  assert.equal(clone.mapType, UnsignedByteType);
  assert.equal(clone.filterNode, undefined);
});

test('r185 shadow throttling does not independently key two camera objects', () => {
  const node = new ShadowNode(new DirectionalLight());
  let calls = 0;
  node.shadowMap = { depthTexture: { version: 0 } };
  node.updateShadow = () => { calls++; node._depthVersionCached = 0; };
  node.updateBefore({ camera: new PerspectiveCamera(), frameId: 1 });
  node.updateBefore({ camera: new PerspectiveCamera(), frameId: 1 });
  assert.equal(calls, 1);
  assert.ok(reference.includes('per-camera behavior is not assumed'));
});

test('filtering static and dynamic visibility separately cannot preserve per-tap union', () => {
  const a = [1, 0], b = [0, 1];
  assert.equal((a[0] * b[0] + a[1] * b[1]) / 2, 0);
  assert.equal(((a[0] + a[1]) / 2) * ((b[0] + b[1]) / 2), 0.25);
});
