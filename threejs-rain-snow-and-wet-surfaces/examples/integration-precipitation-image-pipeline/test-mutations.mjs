import assert from "node:assert/strict";
import { PerspectiveCamera, Scene } from "three/webgpu";

import {
  createPrecipitationImagePipelineIntegration,
  createSharedWeatherStage,
  createWeatherIntegrationSignals,
} from "./precipitation-image-pipeline-integration.js";

function hostFixture() {
  const ownerId = "host";
  const renderer = { backend: { isWebGPUBackend: true }, compute() {} };
  const scene = new Scene();
  const camera = new PerspectiveCamera();
  const weatherStage = createSharedWeatherStage();
  const weatherSignals = createWeatherIntegrationSignals(weatherStage);
  return {
    ownerId,
    renderer,
    renderPipeline: { renderer, outputNode: { id: "output" }, outputColorTransform: false },
    scene,
    camera,
    scenePass: { scene, camera },
    sceneSubmissionCount: 1,
    weatherSignals,
    signals: { ...weatherSignals, sceneColor: {}, depth: {} },
    owners: { renderer: ownerId, scenePass: ownerId, weather: ownerId, toneMap: ownerId, outputTransform: ownerId },
    finalToneMapOwner: ownerId,
    finalOutputTransformOwner: ownerId,
  };
}

const duplicateWeather = hostFixture();
duplicateWeather.signals.weather = createSharedWeatherStage().weather;
assert.throws(() => createPrecipitationImagePipelineIntegration({ host: duplicateWeather }), /replaced instead of shared/);

const duplicateOutputOwner = hostFixture();
duplicateOutputOwner.owners.outputTransform = "precipitation-stage";
assert.throws(() => createPrecipitationImagePipelineIntegration({ host: duplicateOutputOwner }), /sole outputTransform owner/);

const extraScenePass = hostFixture();
extraScenePass.sceneSubmissionCount = 2;
assert.throws(() => createPrecipitationImagePipelineIntegration({ host: extraScenePass }), /exactly one host scene submission/);

const outputMutation = hostFixture();
const stage = createPrecipitationImagePipelineIntegration({ host: outputMutation });
outputMutation.renderPipeline.outputNode = { id: "illicit-private-output" };
assert.throws(() => stage.update(1 / 60), /must not mutate the host output graph/);

const fallbackMutation = hostFixture();
fallbackMutation.renderer.backend.isWebGPUBackend = false;
assert.throws(() => createPrecipitationImagePipelineIntegration({ host: fallbackMutation }), /native-WebGPU renderer/);

console.log("precipitation/image-pipeline integration mutations passed");
