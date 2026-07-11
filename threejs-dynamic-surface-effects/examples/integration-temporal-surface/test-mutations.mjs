import assert from "node:assert/strict";
import { PerspectiveCamera, Texture } from "three/webgpu";
import { texture } from "three/tsl";

import { createTemporalSurfaceIntegration } from "./temporal-surface-integration.js";

function hostFixture() {
  const ownerId = "host";
  const renderer = { backend: { isWebGPUBackend: true }, async init() {}, compute() {} };
  const sceneColor = texture(new Texture());
  const depth = texture(new Texture());
  const velocity = texture(new Texture());
  const camera = new PerspectiveCamera();
  const scenePass = { camera, getTextureNode(id) { return { output: sceneColor, depth, velocity }[id]; } };
  return {
    ownerId,
    renderer,
    renderPipeline: { renderer, outputNode: { id: "output" }, outputColorTransform: false },
    scenePass,
    sceneSubmissionCount: 1,
    signals: { sceneColor, depth, velocity, camera },
    owners: { renderer: ownerId, scenePass: ownerId, temporalHistory: ownerId, jitter: ownerId, toneMap: ownerId, outputTransform: ownerId },
    finalToneMapOwner: ownerId,
    finalOutputTransformOwner: ownerId,
    resetRegistry: { record() {} },
    registerSceneLinearStage(stage) { return { ...stage, dispose() {} }; },
    physicalWidth: 320,
    physicalHeight: 180,
  };
}

const privateColor = hostFixture();
privateColor.signals.sceneColor = texture(new Texture());
await assert.rejects(createTemporalSurfaceIntegration({ host: privateColor }), /scene-pass signal identities/);

const duplicateOutputOwner = hostFixture();
duplicateOutputOwner.owners.outputTransform = "surface-stage";
await assert.rejects(createTemporalSurfaceIntegration({ host: duplicateOutputOwner }), /sole outputTransform owner/);

const missingReset = hostFixture();
missingReset.resetRegistry = null;
await assert.rejects(createTemporalSurfaceIntegration({ host: missingReset }), /reset registry/);

const extraScenePass = hostFixture();
extraScenePass.sceneSubmissionCount = 2;
await assert.rejects(createTemporalSurfaceIntegration({ host: extraScenePass }), /exactly one host scene submission/);

const outputMutation = hostFixture();
const stage = await createTemporalSurfaceIntegration({ host: outputMutation });
outputMutation.renderPipeline.outputNode = { id: "illicit-private-output" };
assert.throws(() => stage.update({ deltaSeconds: 1 / 60 }), /must not mutate the host output graph/);

const fallbackMutation = hostFixture();
fallbackMutation.renderer.backend.isWebGPUBackend = false;
await assert.rejects(createTemporalSurfaceIntegration({ host: fallbackMutation }), /native-WebGPU renderer/);

console.log("temporal-surface integration mutations passed");
