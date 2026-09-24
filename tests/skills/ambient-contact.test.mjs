import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { PerspectiveCamera, Vector3 } from 'three/webgpu';
import { builtinAOContext, float, rtt } from 'three/tsl';
import GTAONode from 'three/addons/tsl/display/GTAONode.js';
import DenoiseNode from 'three/addons/tsl/display/DenoiseNode.js';

const root = new URL('../../skills/threejs-ambient-contact-shading/', import.meta.url);
const guide = readFileSync(new URL('SKILL.md', root), 'utf8');
const reference = readFileSync(new URL('references/gtao-bent-normal-pipeline.md', root), 'utf8');

test('AO leaves direct radiance unchanged, not the final tone-mapped image', () => {
  const direct = 2, indirect = 2, visibility = 0.5;
  const tone = x => x / (1 + x);
  assert.notEqual(tone(direct + indirect), tone(direct + indirect * visibility));
  assert.ok(!guide.includes('tone-mapped\nframe remain invariant'));
});

test('orthographic rays are parallel rather than aimed at the camera origin', () => {
  const a = new Vector3(-2, 0, 4).normalize(), b = new Vector3(2, 0, 4).normalize();
  assert.ok(a.angleTo(b) > 0.9);
  assert.ok(reference.includes('parallel view direction'));
  assert.ok(reference.includes('renderer.logarithmicDepthBuffer'));
});

test('a scalar noise angle rotates an orthonormal basis with an in-range channel', () => {
  for (let index = 0; index < 4; index++) {
    assert.ok(index % 4 >= 0 && index % 4 < 4);
    if (index > 0) assert.ok((index % 4) * 2 * Math.PI > 3);
  }
  for (const theta of [0, 0.4, Math.PI / 2, 5]) {
    const c = Math.cos(theta), s = Math.sin(theta);
    assert.ok(Math.abs(c * c + s * s - 1) < 1e-12);
    assert.ok(Math.abs(c * -s + s * c) < 1e-12);
  }
  const oldAtZero = [Math.sin(0), -Math.cos(0), Math.sin(0), Math.cos(0)];
  assert.equal(oldAtZero[0] * oldAtZero[3] - oldAtZero[2] * oldAtZero[1], 0);
  assert.ok(reference.includes('mat2( c, s, s.negate(), c )'));
});

test('stock AO sizing can round a positive extent down to zero', () => {
  const node = new GTAONode(null, null, new PerspectiveCamera());
  node.resolutionScale = 0.1;
  node.setSize(1, 1);
  assert.equal(node.resolution.value.x, 0);
  node.dispose();
  node._noiseNode.value.dispose();
  assert.ok(reference.includes('rounded dimensions'));
});

test('GTAO and denoise disposal leave their generated noise textures to the owner', () => {
  const camera = new PerspectiveCamera();
  const gtao = new GTAONode(null, null, camera);
  const denoise = new DenoiseNode(null, null, null, camera);
  let aoNoise = 0, denoiseNoise = 0;
  gtao._noiseNode.value.addEventListener('dispose', () => aoNoise++);
  denoise.noiseNode.value.addEventListener('dispose', () => denoiseNoise++);
  gtao.dispose();
  denoise.dispose();
  assert.deepEqual([aoNoise, denoiseNoise], [0, 0]);
  gtao._noiseNode.value.dispose();
  denoise.noiseNode.value.dispose();
  assert.deepEqual([aoNoise, denoiseNoise], [1, 1]);
  assert.ok(reference.includes('_noiseNode.value'));
});

test('RTT node disposal is not recursive target and material disposal', () => {
  const node = rtt(float(1), 4, 4, { depthBuffer: false });
  let target = 0, material = 0;
  node.renderTarget.addEventListener('dispose', () => target++);
  node._quadMesh.material.addEventListener('dispose', () => material++);
  node.dispose();
  assert.deepEqual([target, material], [0, 0]);
  node.renderTarget.dispose();
  node._quadMesh.material.dispose();
  assert.deepEqual([target, material], [1, 1]);
  assert.ok(reference.includes('not recursive'));
});

test('builtin AO context preserves transparent input and combines opaque material AO', () => {
  const visibility = float(0.5);
  const getAO = builtinAOContext(visibility).value.getAO;
  const input = { mul: value => ({ input, value }) };
  assert.equal(getAO(input, { material: { transparent: true } }), input);
  assert.equal(getAO(null, { material: { transparent: false } }), visibility);
  assert.deepEqual(getAO(input, { material: { transparent: false } }), { input, value: visibility });
});
