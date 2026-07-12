import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { PerspectiveCamera, Texture } from "three/webgpu";
import { texture } from "three/tsl";

import { createTemporalSurfaceIntegration } from "./temporal-surface-integration.js";
import { resolveTemporalIntegrationRoute } from "./route-state.mjs";
import { resolveTemporalIntegrationReadbackStride } from "./browser-host.js";

const here = dirname(fileURLToPath(import.meta.url));

const resetRoute = resolveTemporalIntegrationRoute("http://127.0.0.1/?mechanism=host-reset-registry");
assert.equal(resetRoute.mechanism, "host-reset-registry");
assert.equal(resetRoute.mode, "reset-reason");
{
  const width = 641;
  const height = 359;
  const rowBytes = width * 4;
  const aligned = Math.ceil(rowBytes / 256) * 256;
  assert.equal(
    resolveTemporalIntegrationReadbackStride(new Uint8Array(aligned * (height - 1) + rowBytes), width, height),
    2816,
  );
}

function createHost() {
  const ownerId = "host-image-pipeline";
  const computeSubmissions = [];
  const renderer = {
    backend: { isWebGPUBackend: true },
    async init() {},
    compute(nodes) { computeSubmissions.push(nodes); },
  };
  const outputNode = Object.freeze({ id: "host-final-output" });
  const renderPipeline = { renderer, outputNode, outputColorTransform: false };
  const sceneColor = texture(new Texture());
  const depth = texture(new Texture());
  const velocity = texture(new Texture());
  const camera = new PerspectiveCamera();
  const scenePass = {
    camera,
    getTextureNode(id) {
      return { output: sceneColor, depth, velocity }[id];
    },
  };
  const resets = [];
  const resetRegistry = { record(entry) { resets.push(entry); } };
  const registrations = [];
  function registerSceneLinearStage(stage) {
    const registration = {
      ...stage,
      disposed: false,
      dispose() { this.disposed = true; },
    };
    registrations.push(registration);
    return registration;
  }
  return {
    ownerId,
    renderer,
    renderPipeline,
    scenePass,
    sceneSubmissionCount: 1,
    signals: { sceneColor, depth, velocity, camera },
    owners: {
      renderer: ownerId,
      scenePass: ownerId,
      temporalHistory: ownerId,
      jitter: ownerId,
      toneMap: ownerId,
      outputTransform: ownerId,
    },
    finalToneMapOwner: ownerId,
    finalOutputTransformOwner: ownerId,
    resetRegistry,
    registerSceneLinearStage,
    physicalWidth: 641,
    physicalHeight: 359,
    computeSubmissions,
    registrations,
    resets,
  };
}

const host = createHost();
const outputBefore = host.renderPipeline.outputNode;
const integration = await createTemporalSurfaceIntegration({ host, tier: "balanced" });
assert.deepEqual(integration.ownership, { renderer: false, renderPipeline: false, scenePass: false, output: false });
assert.equal(host.renderPipeline.outputNode, outputBefore);
assert.equal(host.registrations.length, 1);
assert.equal(host.registrations[0].inputNode, host.signals.sceneColor);
assert.equal(host.computeSubmissions.length, 1, "initial clear group expected");
const metrics = integration.update({
  deltaSeconds: 1 / 60,
  segmentStart: { x: 0.2, y: 0.3 },
  segmentEnd: { x: 0.7, y: 0.65 },
  pressure: 0.8,
  active: true,
});
assert.equal(metrics.computeUpdates, 1);
assert.equal(metrics.hostRenderCalls, 0);
assert.equal(metrics.privateScenePasses, 0);
assert.equal(host.computeSubmissions.length, 2, "clear plus one history update expected");
assert(Object.values(integration.describePipeline().sharedSignalIdentity).every(Boolean));
integration.resetHistory("camera-cut");
assert.equal(host.resets.at(-1).cause, "camera-cut");
integration.resize(800, 600);
assert.equal(host.resets.at(-1).cause, "resize");
assert.equal(integration.computeStage.effect.historyRead.image.width, 400, "balanced tier uses half-resolution history");
assert.equal(host.renderPipeline.outputNode, outputBefore);
integration.dispose();
assert.equal(host.registrations[0].disposed, true);
assert.equal(host.renderPipeline.outputNode, outputBefore);

const source = readFileSync(resolve(here, "temporal-surface-integration.js"), "utf8");
for (const forbidden of [
  "new WebGPURenderer",
  "new RenderPipeline",
  "renderOutput(",
  "pass(",
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
assert.equal(manifest.publishPath, "/demos/integration-temporal-surface/");
for (const path of manifest.canonicalSource) assert(existsSync(resolve(here, path)), path);

const browserHost = readFileSync(resolve(here, "browser-host.js"), "utf8");
const browserMain = readFileSync(resolve(here, "main.js"), "utf8");
for (const token of [
  'const LAB_ID = "integration-temporal-surface"',
  "get labId() { return LAB_ID; }",
  "labId: this.labId",
  "new WebGPURenderer",
  "await this.renderer.init()",
  "isWebGPUBackend !== true",
  "new RenderPipeline",
  "setMRT(mrt({ output, velocity }))",
  "readRenderTargetPixelsAsync",
  "bytesPerRow",
  "routeSelection",
  "MutableSceneLinearNode",
]) assert(browserHost.includes(token), `browser host missing ${token}`);
assert(browserMain.includes("return controller;"), "bootstrap promise must resolve to the canonical controller");
assert(browserMain.includes("globalThis.labController = controllerPromise"), "bootstrap must expose the in-flight controller promise");

console.log("temporal-surface integration validation passed");
