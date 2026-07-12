import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { WATER_QUALITY_TIERS } from "../../../threejs-water-optics/examples/webgpu-bounded-water/constants.js";
import { HABITAT_TIER_CONFIG } from "../route-state.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (name) => fs.readFileSync(path.join(root, name), "utf8");
const controller = read("habitat-controller.js");
const main = read("main.js");
const capture = read("capture.mjs");
const captureHook = read("capture-hook.mjs");
const routeState = read("route-state.mjs");
const scaledWaterStage = read("scaled-water-stage.js");
const manifest = JSON.parse(read("lab.manifest.json"));
const contract = JSON.parse(read("contract.json"));
const packageJson = JSON.parse(read("package.json"));

for (const token of [
  "new WebGPURenderer",
  "await this.renderer.init()",
  "isWebGPUBackend !== true",
  "new RenderPipeline",
  "setMRT(mrt({ output, normal: normalView, emissive, velocity }))",
  "renderPipeline.outputColorTransform = false",
  "readRenderTargetPixelsAsync",
  "resolveReadbackStride",
  "createCreatureStage",
  "createDenseVegetationSceneAdapter",
  "createScaledBoundedWaterStage",
  "createHabitatWeatherVisualStage",
  "createSharedWeatherStage",
  "CameraDirectionController",
  "renderer.shadowMap.enabled = true",
  "fanoutContactSnapshot",
  "assertStaticSpawnStorageImmutable",
  "scenePass.setResolutionScale",
  "createCreatureHabitatQualityGovernor",
  "resolveTimestampsAsync(\"render\")",
  "resolveTimestampsAsync(\"compute\")",
  "reconcileResourceLedger",
  "shadowStage.light.shadow.map?.texture",
  "target === \"outline-mask\"",
  "colorManaged",
]) assert(controller.includes(token), `missing native integration token: ${token}`);

assert(!controller.includes("WebGLRenderer"), "Creature Habitat must not construct a legacy renderer");
assert(!main.includes("browser-bootstrap.mjs"), "Creature Habitat must not use the generic dashboard bootstrap");
assert(main.includes("globalThis.labController = controller"), "generated route wrappers require the canonical labController handle");
assert(main.includes("return controller;"), "the early controller promise must resolve to the canonical controller");
assert(main.includes("globalThis.__LAB_READY__ = controllerPromise.then(() => true)"), "explicit readiness must be an awaitable promise, not a truthy boolean race");
assert(!main.includes("globalThis.__LAB_READY__ = false"), "readiness must not expose a defined false sentinel that the shared harness treats as ready");
assert(capture.includes("captureLabBrowser"), "local capture must use the shared self-serving browser harness");
assert(captureHook.includes('"final.design.png"'), "capture hook must produce final.design.png");
assert(captureHook.includes('"shadow-atlas"'), "capture hook must exercise the real shadow-atlas diagnostic");
assert(!packageJson.scripts.capture.includes("capture-status"), "capture must not be status-only");
assert.equal(typeof packageJson.scripts["capture:correctness"], "string");
assert.equal(typeof packageJson.scripts["capture:performance"], "string");
assert.equal(manifest.status, "incomplete");
assert.equal(manifest.kind, "integration-demo");
assert.equal(manifest.evidenceContract, "v2");
assert.equal(contract.status, "incomplete");
assert.deepEqual(manifest.modes, contract.modes);
assert.deepEqual(manifest.cameras, contract.cameras);
assert.deepEqual(manifest.tiers.map((tier) => tier.id), ["hero", "balanced", "budgeted"]);
assert.equal(contract.integrationConstraints.contactChannel.includes("one bounded registry"), true);
assert.equal(contract.integrationConstraints.staticSpawnStorage.includes("never rewrites"), true);
assert.equal(scaledWaterStage.includes("tierOverrides"), false, "habitat water must not forge a private canonical tier");
assert.equal(scaledWaterStage.includes("new WebGPUBoundedWaterHeightfield(renderer, {\n    tier,\n    parameters,"), true);

const ultraWaterResolution = WATER_QUALITY_TIERS.ultra.resolution;
for (const tier of manifest.tiers) {
  const config = HABITAT_TIER_CONFIG[tier.id];
  const waterTier = WATER_QUALITY_TIERS[config.waterTier];
  const expectedScale = waterTier.resolution / ultraWaterResolution;
  const contractTier = contract.tiers.find((entry) => entry.id === tier.id);
  assert.equal(config.waterScale, expectedScale, `${tier.id} runtime waterScale must derive from its canonical water tier`);
  assert.equal(tier.resolutionPolicy.waterScale, expectedScale, `${tier.id} manifest waterScale drifted`);
  assert.equal(contractTier.resolutionPolicy.waterScale, expectedScale, `${tier.id} contract waterScale drifted`);
}

for (const script of ["check", "validate:unit", "test:mutations", "capture", "validate:artifacts", "validate:quick", "validate:full"]) {
  assert.equal(typeof packageJson.scripts[script], "string", `missing local script ${script}`);
}

for (const tier of ["hero", "balanced", "budgeted"]) {
  const wrapper = read(`tier/${tier}/index.html`);
  assert(wrapper.includes(`content="${tier}"`), `${tier} wrapper must declare its locked tier`);
  assert(wrapper.includes('src="../../main.js"'), `${tier} wrapper must import the canonical controller`);
  assert(!wrapper.includes("browser-bootstrap.mjs"), `${tier} wrapper must not load the generic dashboard`);
}

for (const mechanism of manifest.mechanisms) {
  const wrapper = read(`mechanism/${mechanism.id}/index.html`);
  assert(wrapper.includes(`content="${mechanism.id}"`), `${mechanism.id} wrapper must declare its lock`);
  assert(wrapper.includes('src="../../main.js"'), `${mechanism.id} wrapper must import the canonical controller`);
  assert.equal(mechanism.startup.mode.length > 0, true, `${mechanism.id} must lock a mode`);
  assert.equal(mechanism.startup.tier.length > 0, true, `${mechanism.id} must lock a tier`);
  assert(routeState.includes(`"${mechanism.id}"`), `${mechanism.id} must exist in the canonical route parser`);
}

process.stdout.write("Creature Habitat native controller/static contract checks passed.\n");
