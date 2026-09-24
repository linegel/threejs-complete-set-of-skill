import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { AdditiveBlending, BlendMode, MaterialBlending, NoBlending, SpriteNodeMaterial } from 'three/webgpu';
import { emissive, mrt, output, vec4 } from 'three/tsl';
import BloomNode from 'three/addons/tsl/display/BloomNode.js';
import WebGPUPipelineUtils from 'three/src/renderers/webgpu/utils/WebGPUPipelineUtils.js';

const reference = readFileSync(new URL('../../skills/threejs-bloom/references/hdr-bloom-system.md', import.meta.url), 'utf8');
const builder = { getSharedContext: () => ({}) };

test('additive material blending requires exactly one opacity factor', () => {
  const utils = new WebGPUPipelineUtils({});
  for (const premultipliedAlpha of [false, true]) {
    const material = new SpriteNodeMaterial({ blending: AdditiveBlending, premultipliedAlpha });
    const blend = utils._getBlending(material);
    assert.equal(blend.color.srcFactor, premultipliedAlpha ? 'one' : 'src-alpha');
    const radiance = 8, alpha = 0.25;
    const emitted = premultipliedAlpha ? radiance * alpha : radiance;
    assert.equal(emitted * (premultipliedAlpha ? 1 : alpha), 2);
    assert.notEqual(radiance * alpha * alpha, 2);
    material.dispose();
  }
  assert.ok(reference.includes('material.emissiveNode = radiance;'));
  assert.ok(reference.includes('diffuseColor.a'));
});

test('r185 material MRT merge loses a configured named blend mode', () => {
  const scene = mrt({ output, emissive });
  scene.setBlendMode('emissive', new BlendMode(MaterialBlending));
  assert.equal(scene.getBlendMode('emissive').blending, MaterialBlending);
  assert.equal(scene.merge(mrt({ emissive })).getBlendMode('emissive').blending, NoBlending);
});

test('the five-level minimum-size gate agrees with actual allocated dimensions', () => {
  const node = new BloomNode(vec4(1));
  node.setup(builder);
  node.setSize(32, 64);
  assert.deepEqual(node._renderTargetsVertical.map(t => t.width), [16, 8, 4, 2, 1]);
  node.setSize(31, 64);
  assert.equal(node._renderTargetsVertical[4].width, 0);
  assert.equal(node._separableBlurMaterials[4].invSize.value.x, Infinity);
  node.dispose();
});

test('repeated setup appends unused blur materials instead of reusing the five', () => {
  const node = new BloomNode(vec4(1));
  node.setup(builder);
  assert.equal(node._separableBlurMaterials.length, 5);
  node.setup(builder);
  assert.equal(node._separableBlurMaterials.length, 10);
  node.dispose();
  assert.ok(reference.includes('appends five'));
});

test('display knee conversion must invert both endpoints, not the width alone', () => {
  const tone = x => x / (1 + x), inverse = y => y / (1 - y);
  const thresholdDisplay = 0.2, kneeDisplay = 0.1, exposure = 2;
  const thresholdScene = inverse(thresholdDisplay) / exposure;
  const kneeScene = (inverse(thresholdDisplay + kneeDisplay) - inverse(thresholdDisplay)) / exposure;
  assert.ok(Math.abs(tone(exposure * (thresholdScene + kneeScene)) - 0.3) < 1e-12);
  assert.notEqual(kneeScene, inverse(kneeDisplay) / exposure);
  assert.ok(reference.includes('inverseToneAndOutput(thresholdDisplay + kneeDisplay)'));
});

test('ordinary over compositing is ordered while additive emission commutes', () => {
  const over = (foreground, background, alpha) => foreground * alpha + background * (1 - alpha);
  assert.notEqual(over(2, 8, 0.5), over(8, 2, 0.25));
  assert.equal(2 * 0.5 + 8 * 0.25, 8 * 0.25 + 2 * 0.5);
  assert.ok(reference.includes('ordinary alpha-over is not commutative'));
});

test('a fully constructed BloomNode disposes all eleven targets and seven materials', () => {
  const node = new BloomNode(vec4(1));
  node.setup(builder);
  const resources = [node._renderTargetBright, ...node._renderTargetsHorizontal, ...node._renderTargetsVertical,
    node._highPassFilterMaterial, node._compositeMaterial, ...node._separableBlurMaterials];
  const counts = resources.map(() => 0);
  resources.forEach((resource, index) => resource.addEventListener('dispose', () => counts[index]++));
  node.dispose();
  assert.deepEqual(counts, Array(18).fill(1));
});
