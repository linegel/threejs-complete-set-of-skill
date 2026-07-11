import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { Scene, PerspectiveCamera } from "three/webgpu";

import { createVegetationIntegration, validateVegetationHostContract } from "./vegetation-integration.js";

const counter = { compute: 0 };
const renderer = {
  initialized: true,
  backend: { isWebGPUBackend: true },
  async init() {},
  compute() { counter.compute += 1; },
  getRenderTarget() { return null; },
  setRenderTarget() {},
};
const weather = { time: 0, windDirection: { x: 1, z: 0.25 }, windStrength: 0.4, windSpeed: 0.7 };
const owners = {
  renderer: "host-image-pipeline",
  camera: "host-camera",
  planet: "host-planet",
  terrain: "host-terrain",
  weather: "host-weather",
  pipeline: "host-image-pipeline",
  toneMap: "host-image-pipeline",
  outputTransform: "host-image-pipeline",
};
const host = {
  renderer,
  scene: new Scene(),
  camera: new PerspectiveCamera(50, 1.5, 0.1, 500),
  pipeline: { id: "host-image-pipeline" },
  planet: { worldUnitsPerMeter: 2 },
  terrain: { worldUnitsPerMeter: 2 },
  weather,
  worldUnitsPerMeter: 2,
  owners,
};

assert.equal(validateVegetationHostContract(host).ok, true);
assert.equal(validateVegetationHostContract({ ...host, owners: { ...owners, toneMap: "duplicate-owner" } }).ok, false);
assert.equal(validateVegetationHostContract({ ...host, terrain: { worldUnitsPerMeter: 0.001 } }).ok, false);

const integration = await createVegetationIntegration({
  host,
  scenario: "creature-habitat-host",
  denseTier: "low",
  forestCount: 4,
});
assert.equal(counter.compute, 9, "low dense tier must initialize exactly nine patches");
assert.equal(integration.dense.system.options.patchSizeMeters, 28);
assert.equal(integration.dense.system.options.patchSize, 56,
  "dense grass must scale authored meters into the shared host frame exactly once");
assert.equal(integration.ash.group.scale.x, 2,
  "foreground Ash must use the same shared host scale as dense grass");
assert.equal(integration.forest.worldUnitsPerMeter, 2,
  "Ash forest storage transforms must use the shared host scale");
const staticIdentity = integration.dense.system.getDiagnostics().staticStorageIdentity;
const staticRevision = integration.dense.system.getDiagnostics().staticStorageRevision;
integration.update({ time: 2, contacts: [{ x: 0, z: 0, radius: 1.5, weight: 1 }] });
assert.equal(integration.dense.system.getDiagnostics().staticStorageIdentity, staticIdentity);
assert.equal(integration.dense.system.getDiagnostics().staticStorageRevision, staticRevision,
  "weather/contact updates must not rewrite immutable spawn storage");
integration.setMode("weather-diagnostics");
assert.equal(integration.getMetrics().mode, "weather-diagnostics");
assert.equal(integration.dense.system.getDiagnostics().debugMode, "wind");
assert.throws(() => integration.setMode("not-a-mode"), /unknown vegetation integration mode/);
const graph = integration.describePipeline();
assert.equal(graph.finalToneMapOwner, "host-image-pipeline");
assert.equal(graph.finalOutputTransformOwner, "host-image-pipeline");
assert.equal(graph.sceneSubmissions.length, 1);
assert.equal(integration.getMetrics().pipelineOwnerCount, 1);
assert.equal(integration.describeResources().hostOwned.includes("planet"), true);
assert.equal(integration.describeResources().hostOwned.includes("terrain"), true);
assert.equal(integration.forest.drawCount, 4);
const resources = integration.describeResources();
assert.equal(resources.dense.worldUnitsPerMeter, 2);
assert.equal(resources.dense.staticStorageImmutable, true);
assert.equal(resources.ashForeground.worldUnitsPerMeter, 2);
assert.equal(resources.ashForest.storageImmutable, true);
assert.equal(resources.ashForest.draws <= 4, true);

const source = readFileSync(new URL("./vegetation-integration.js", import.meta.url), "utf8");
assert(!source.includes("new WebGPURenderer"), "integration must not construct a renderer");
assert(!source.includes("new RenderPipeline"), "integration must not construct a pipeline");
assert(!source.includes("renderOutput("), "integration must not own final output conversion");

integration.dispose();
assert.equal(integration.dense.system.patches.length, 0);

if (process.argv.includes("--mutations")) {
  await assert.rejects(() => createVegetationIntegration({
    host: { ...host, owners: { ...owners, outputTransform: "second-output" } },
    scenario: "weathered-world-host",
  }), /single host owner/);
  await assert.rejects(() => createVegetationIntegration({ host, scenario: "unknown-scenario" }));
  await assert.rejects(() => createVegetationIntegration({
    host: { ...host, worldUnitsPerMeter: 4 },
    scenario: "weathered-world-host",
  }), /worldUnitsPerMeter/);
}

console.log(JSON.stringify({ pass: true, computeDispatches: counter.compute, forestDraws: 4, singleOutputOwner: true, browserEvidence: "not-run" }));
