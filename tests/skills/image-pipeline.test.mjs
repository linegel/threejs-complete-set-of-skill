import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { PerspectiveCamera, Scene, Texture } from 'three/webgpu';
import { mrt, normalView, output, pass, texture, vec4, velocity } from 'three/tsl';
import TRAANode from 'three/addons/tsl/display/TRAANode.js';
import { rebuildTraaNode } from '../../skills/threejs-image-pipeline/examples/rebuild-traa-node.mjs';

const reference = readFileSync(new URL('../../skills/threejs-image-pipeline/references/production-image-pipeline.md', import.meta.url), 'utf8');
function fixture() {
  const camera = new PerspectiveCamera();
  const scenePass = pass(new Scene(), camera, { samples: 0 });
  const pipeline = { outputNode: vec4(1), outputColorTransform: true, needsUpdate: false };
  return { camera, scenePass, pipeline, args: { camera, renderPipeline: pipeline,
    beautyTexture: scenePass.getTextureNode(), depthTexture: scenePass.getTextureNode('depth'),
    velocityTexture: scenePass.getTextureNode('velocity'), composeOutput: value => value } };
}

test('failed composition leaves the previous graph untouched', () => {
  const { scenePass, pipeline, args } = fixture();
  const previous = pipeline.outputNode;
  assert.throws(() => rebuildTraaNode({ ...args, composeOutput() { throw new Error('composition failed'); } }), /composition failed/);
  assert.equal(pipeline.outputNode, previous);
  assert.equal(pipeline.outputColorTransform, true);
  scenePass.dispose();
});

test('undefined or asynchronous output cannot become the active graph', () => {
  for (const result of [undefined, null, {}, Promise.resolve(vec4(1))]) {
    const { scenePass, pipeline, args } = fixture();
    const before = pipeline.outputNode;
    assert.throws(() => rebuildTraaNode({ ...args, composeOutput: () => result }), /node/);
    assert.equal(pipeline.outputNode, before);
    scenePass.dispose();
  }
});

test('rebuild retains tuned public settings and rolls back without disposing borrowed state', () => {
  const { scenePass, pipeline, args } = fixture();
  const previousNode = new TRAANode(args.beautyTexture, args.depthTexture, args.velocityTexture, args.camera);
  previousNode.depthThreshold = 0.002;
  previousNode.edgeDepthDiff = 0.005;
  previousNode.maxVelocityLength = 64;
  previousNode.useSubpixelCorrection = false;
  const previousOutput = pipeline.outputNode;
  const replacement = rebuildTraaNode({ ...args, previousNode });
  for (const key of ['depthThreshold', 'edgeDepthDiff', 'maxVelocityLength', 'useSubpixelCorrection']) {
    assert.equal(replacement.node[key], previousNode[key]);
  }
  assert.equal(replacement.rollback(), true);
  assert.equal(replacement.rollback(), false);
  assert.equal(pipeline.outputNode, previousOutput);
  assert.equal(pipeline.outputColorTransform, true);
  assert.equal(pipeline.needsUpdate, true);
  replacement.node.dispose(); previousNode.dispose(); scenePass.dispose();
});

test('rollback refuses to overwrite a newer graph owner', () => {
  const { scenePass, pipeline, args } = fixture();
  const replacement = rebuildTraaNode(args);
  const newer = vec4(0);
  pipeline.outputNode = newer;
  assert.throws(() => replacement.rollback(), /changed/);
  assert.equal(pipeline.outputNode, newer);
  replacement.node.dispose(); scenePass.dispose();
});

test('stock jitter erases a pre-existing cropped camera view', () => {
  const { scenePass, args } = fixture();
  args.camera.setViewOffset(1200, 800, 200, 100, 600, 400);
  assert.throws(() => rebuildTraaNode(args), /view offset/);
  const raw = new TRAANode(args.beautyTexture, args.depthTexture, args.velocityTexture, args.camera);
  raw._velocityNode = { setProjectionMatrix() {} };
  raw.setViewOffset(600, 400);
  assert.equal(args.camera.view.fullWidth, 600);
  raw.clearViewOffset();
  assert.equal(args.camera.view.enabled, false);
  raw.dispose(); scenePass.dispose();
});

test('an arbitrary texture has no render-target owner for stock TRAA sizing', () => {
  const { scenePass, args } = fixture();
  const image = new Texture();
  assert.throws(() => rebuildTraaNode({ ...args, beautyTexture: texture(image) }), /render-target/);
  image.dispose(); scenePass.dispose();
});

test('declaring MRT outputs does not allocate their attachments', () => {
  const scenePass = pass(new Scene(), new PerspectiveCamera());
  scenePass.setMRT(mrt({ output, normal: normalView, velocity }));
  assert.equal(scenePass.renderTarget.textures.length, 1);
  for (const name of Object.keys(scenePass.getMRT().outputNodes)) scenePass.getTextureNode(name);
  assert.equal(scenePass.renderTarget.textures.length, 3);
  assert.ok(reference.includes('Object.keys( outputs )'));
  scenePass.dispose();
});

test('failed stock pass compilation needs host finally restoration', async () => {
  const scenePass = pass(new Scene(), new PerspectiveCamera());
  const previousTarget = {}, previousMRT = {};
  let target = previousTarget, modes = previousMRT;
  const renderer = { getRenderTarget: () => target, getMRT: () => modes,
    setRenderTarget: value => { target = value; }, setMRT: value => { modes = value; },
    async compileAsync() { throw new Error('compile failure'); } };
  try { await assert.rejects(scenePass.compileAsync(renderer), /compile failure/); }
  finally { renderer.setRenderTarget(previousTarget); renderer.setMRT(previousMRT); }
  assert.equal(target, previousTarget);
  assert.equal(modes, previousMRT);
  assert.ok(reference.includes('try/finally'));
  scenePass.dispose();
});
