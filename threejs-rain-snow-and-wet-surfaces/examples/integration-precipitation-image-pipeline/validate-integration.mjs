import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { PerspectiveCamera, Scene } from "three/webgpu";

import {
  createPrecipitationImagePipelineIntegration,
  createSharedWeatherStage,
  createWeatherIntegrationSignals,
} from "./precipitation-image-pipeline-integration.js";
import { resolveIntegrationRoute } from "./route-state.mjs";
import { resolvePrecipitationIntegrationReadbackStride } from "./browser-host.js";

const here = dirname(fileURLToPath(import.meta.url));

const recurrentRoute = resolveIntegrationRoute("http://127.0.0.1/?mechanism=weather-compute-before-host-render");
assert.equal(recurrentRoute.tier, "high");
assert.equal(recurrentRoute.runtimeMechanism, "analytic-vs-recurrent");
assert.equal(recurrentRoute.mode, "particles");
{
  const width = 641;
  const height = 359;
  const rowBytes = width * 4;
  const aligned = Math.ceil(rowBytes / 256) * 256;
  assert.equal(
    resolvePrecipitationIntegrationReadbackStride(new Uint8Array(aligned * (height - 1) + rowBytes), width, height),
    2816,
  );
}

function createHost() {
  const ownerId = "host-image-pipeline";
  const scene = new Scene();
  const camera = new PerspectiveCamera();
  const computeSubmissions = [];
  const renderer = {
    backend: { isWebGPUBackend: true },
    compute(nodes) { computeSubmissions.push(nodes); },
  };
  const outputNode = Object.freeze({ id: "host-final-output" });
  const renderPipeline = { renderer, outputNode, outputColorTransform: false };
  const scenePass = { scene, camera, id: "host-primary-scene-pass" };
  const weatherStage = createSharedWeatherStage({ temperatureC: -2 });
  const weatherSignals = createWeatherIntegrationSignals(weatherStage);
  const signals = {
    ...weatherSignals,
    sceneColor: Object.freeze({ id: "host-scene-color" }),
    depth: Object.freeze({ id: "host-depth" }),
    normal: Object.freeze({ id: "host-normal" }),
    velocity: Object.freeze({ id: "host-velocity" }),
  };
  return {
    ownerId,
    renderer,
    renderPipeline,
    scene,
    camera,
    scenePass,
    sceneSubmissionCount: 1,
    weatherSignals,
    signals,
    owners: {
      renderer: ownerId,
      scenePass: ownerId,
      weather: ownerId,
      toneMap: ownerId,
      outputTransform: ownerId,
    },
    finalToneMapOwner: ownerId,
    finalOutputTransformOwner: ownerId,
    computeSubmissions,
  };
}

const host = createHost();
const outputBefore = host.renderPipeline.outputNode;
const integration = createPrecipitationImagePipelineIntegration({
  host,
  tier: "high",
  mechanism: "analytic-vs-recurrent",
  seed: 1,
});
assert.deepEqual(integration.ownership, { renderer: false, renderPipeline: false, scenePass: false, output: false });
assert.equal(host.renderPipeline.outputNode, outputBefore);
assert.equal(integration.describePipeline().sceneSubmissions[0].count, 1);
assert(Object.values(integration.describePipeline().sharedSignalIdentity).every(Boolean));
const metrics = integration.update(1 / 60, 0.8);
assert.equal(metrics.recurrentDispatches, 2);
assert.equal(metrics.renderCalls, 0);
assert.equal(metrics.privateScenePasses, 0);
assert.equal(host.computeSubmissions.length, 1, "recurrent mechanism dispatches one ordered rain/snow compute group and no unrelated impact work");
assert.equal(host.renderPipeline.outputNode, outputBefore);
integration.dispose();
assert.equal(host.renderPipeline.outputNode, outputBefore);
assert.equal(host.scene.children.includes(integration.root), false);

const source = readFileSync(resolve(here, "precipitation-image-pipeline-integration.js"), "utf8");
for (const forbidden of [
  "new WebGPURenderer",
  "new RenderPipeline",
  "renderOutput(",
  "pass(host.scene",
  ".render()",
]) {
  assert(!source.includes(forbidden), `host-safe integration contains forbidden ownership token ${forbidden}`);
}
assert(!/renderPipeline\.outputNode\s*=(?!=)/.test(source), "adapter must not assign the host output node");
assert(!/renderPipeline\.outputColorTransform\s*=(?!=)/.test(source), "adapter must not assign output conversion ownership");

const manifest = JSON.parse(readFileSync(resolve(here, "lab.manifest.json"), "utf8"));
assert.equal(manifest.schemaVersion, 2);
assert.equal(manifest.kind, "integration-demo");
assert.equal(manifest.status, "incomplete");
assert.equal(manifest.browserEntry, "index.html");
assert.equal(manifest.publishPath, "/demos/integration-precipitation-image-pipeline/");
for (const path of manifest.canonicalSource) assert(existsSync(resolve(here, path)), path);

const browserHost = readFileSync(resolve(here, "browser-host.js"), "utf8");
for (const token of [
  "new WebGPURenderer",
  "await this.renderer.init()",
  "isWebGPUBackend !== true",
  "new RenderPipeline",
  "setMRT(mrt({ output, normal: normalView, emissive }))",
  "readRenderTargetPixelsAsync",
  "bytesPerRow",
  "routeSelection",
]) assert(browserHost.includes(token), `browser host missing ${token}`);

console.log("precipitation/image-pipeline integration validation passed");
