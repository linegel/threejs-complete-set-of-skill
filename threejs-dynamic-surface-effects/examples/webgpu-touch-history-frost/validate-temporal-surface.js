import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { existsSync, readFileSync, statSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import {
  DEFAULT_FROST_SETTINGS,
  FROST_DEBUG_VIEWS,
  FROST_MECHANISM_PROFILES,
  FROST_MECHANISMS,
  FROST_QUALITY_TIERS,
  TimestampedDirtyTileHistory,
  clampDeltaSeconds,
  computeDispatchSize,
  computeFrostExtents,
  computeSideAwareRefraction,
  createHistoryStorageDescriptor,
  createHistoryStorageTexture,
  createStaticTextureDescriptor,
  createTwoScaleRefractionContract,
  createWebGPUTouchHistoryFrostEffect,
  depositScale,
  estimateHistoryStorageBytes,
  exactDielectricFresnel,
  frostSeedPhase,
  historyVisualResponse,
  laplacianDiffusion,
  resolveFrostGraphContract,
  screenPeriodPhase,
  simulateHeldPointer,
  solveDecayDeposit,
  survivalFactor,
  updateHistorySample,
  validateDiffusionStep,
} from "./frost-surface-effect.js";
import {
  FROST_LAB_ID,
  FROST_LAB_MODES,
  FROST_MODE_TO_DEBUG_VIEW,
  FROST_SCENARIO_ID,
  WebGPUFrostLab,
  parseFrostLabRoute,
} from "./frost-webgpu-lab.js";

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, "../..");
const manifestPath = resolve(root, "assets/manifest.json");
const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));

function sha256(path) {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}

function assertManifest() {
  for (const asset of manifest.assets) {
    const path = resolve(root, "assets", asset.path);
    assert.equal(statSync(path).size, asset.byteLength, asset.id);
    assert.equal(sha256(path), asset.sha256, asset.id);
    assert.equal(asset.colorSpace, "NoColorSpace", asset.id);
    assert(asset.wrap === "MirroredRepeatWrapping", asset.id);
    assert.equal(asset.mipmap, false, asset.id);
  }
}

assertManifest();

assert.equal(clampDeltaSeconds(Number.NaN), 0);
assert.equal(clampDeltaSeconds(-1), 0);
assert.equal(clampDeltaSeconds(2), DEFAULT_FROST_SETTINGS.maxDeltaSeconds);
assert.equal(survivalFactor(0.92, 0), 1);
assert(depositScale(0.94, 1 / 60) > 0);
assert.equal(historyVisualResponse(0), 0);
assert.equal(historyVisualResponse(DEFAULT_FROST_SETTINGS.historyVisualKnee), 1);
assert(historyVisualResponse(depositScale(0.94, 1 / 60)) > depositScale(0.94, 1 / 60));
assert.throws(() => historyVisualResponse(0.2, 0), /knee in/);

const fps30 = simulateHeldPointer({ fps: 30, seconds: 1 });
const fps60 = simulateHeldPointer({ fps: 60, seconds: 1 });
const fps120 = simulateHeldPointer({ fps: 120, seconds: 1 });
assert(Math.abs(fps30.r - fps60.r) < 1e-12, "30/60 FPS visible mask mismatch");
assert(Math.abs(fps120.r - fps60.r) < 1e-12, "120/60 FPS visible mask mismatch");
assert(Math.abs(fps30.a - fps120.a) < 1e-12, "30/120 FPS tilt mask mismatch");

let partitioned = 0;
for (let frame = 0; frame < 60; frame += 1) {
  partitioned = solveDecayDeposit(partitioned, 0.73, 1 / 60);
}
const singleInterval = solveDecayDeposit(0, 0.73, 1);
assert(Math.abs(partitioned - singleInterval) < 1e-12, "closed-form deposit must compose under timestep partition");
assert.throws(() => updateHistorySample({ previousR: 0, previousA: 0, deltaSeconds: -1 }), /nonnegative/);

const held = updateHistorySample({
  previousR: 0.5,
  previousA: 0.25,
  deltaSeconds: 1 / 60,
});
assert(held.r > 0.5);
assert(held.a > 0.25);
assert.deepEqual([held.r, held.g, held.b], [held.r, held.r, held.r]);

const diffused = laplacianDiffusion({
  center: 0.5,
  left: 1,
  right: 1,
  up: 0,
  down: 0,
  deltaSeconds: 1 / 60,
});
assert(Number.isFinite(diffused));

const dispatch = computeDispatchSize(1920, 1080);
assert.deepEqual(dispatch, { x: 240, y: 135, count: 32400, tileSize: 8 });
const oddDispatch = computeDispatchSize(641, 359);
assert.deepEqual(oddDispatch, { x: 81, y: 45, count: 3645, tileSize: 8 });
assert(oddDispatch.x * 8 >= 641 && oddDispatch.y * 8 >= 359, "odd dispatch must cover every texel");
assert((oddDispatch.x - 1) * 8 < 641 && (oddDispatch.y - 1) * 8 < 359, "odd dispatch must be minimal");

const storage = estimateHistoryStorageBytes(1920, 1080);
assert.equal(storage.total, 33177600);

const descriptor = createHistoryStorageDescriptor(640, 360);
assert.equal(descriptor.width, 640);
assert.equal(descriptor.height, 360);
assert.equal(descriptor.generateMipmaps, false);
const historyTexture = createHistoryStorageTexture(641, 359, "odd-history");
assert.equal(historyTexture.isStorageTexture, true);
assert.equal(historyTexture.image.width, 641);
assert.equal(historyTexture.image.height, 359);
historyTexture.dispose();

assert.equal(validateDiffusionStep(0.08, 1 / 60), 0.08 / 60);
assert.throws(() => validateDiffusionStep(1, 0.251), /exceeds 0.25/);

const dirty = new TimestampedDirtyTileHistory({ tileCount: 1, initialValue: 1 });
const caughtUp = dirty.materialize(0, 10);
const staleMutation = 1;
assert(caughtUp < staleMutation - 0.1, "visible dirty tiles must analytically catch up their age");

const textureDescriptor = createStaticTextureDescriptor({ id: "main-normal" });
assert.equal(textureDescriptor.colorSpace, "NoColorSpace");
assert.equal(textureDescriptor.generateMipmaps, false);

const refraction = createTwoScaleRefractionContract();
assert.equal(refraction.mainScreenPeriod, 1200);
assert.equal(refraction.detailScreenPeriod, 350);
assert(refraction.heightWeight.includes("height"));
assert(refraction.Fresnel.includes("exact dielectric Fresnel"));
assert.equal(refraction.opticalSide, "outside");

const normalFresnel = exactDielectricFresnel(1, 1, DEFAULT_FROST_SETTINGS.ior);
const expectedNormalReflectance = ((1 - DEFAULT_FROST_SETTINGS.ior) / (1 + DEFAULT_FROST_SETTINGS.ior)) ** 2;
assert(Math.abs(normalFresnel.reflectance - expectedNormalReflectance) < 1e-12);
assert.equal(normalFresnel.totalInternalReflection, false);
const outsideThin = computeSideAwareRefraction({
  slope: { x: 0.4, y: -0.25 },
  thickness: 1,
  side: "outside",
  resolution: { x: 1200, y: 800 },
});
const outsideThick = computeSideAwareRefraction({
  slope: { x: 0.4, y: -0.25 },
  thickness: 2,
  side: "outside",
  resolution: { x: 1200, y: 800 },
});
assert(Math.abs(outsideThick.uvOffset.x - outsideThin.uvOffset.x * 2) < 1e-15, "thickness must scale the Snell offset");
assert(Math.abs(outsideThick.uvOffset.y - outsideThin.uvOffset.y * 2) < 1e-15, "thickness must scale both offset axes");
const insideTir = computeSideAwareRefraction({
  slope: { x: 2, y: 0 },
  side: "inside",
  resolution: { x: 1200, y: 800 },
});
assert.equal(insideTir.totalInternalReflection, true, "inside-to-air rays above the critical angle must classify TIR");
assert.deepEqual(insideTir.uvOffset, { x: 0, y: 0 });
assert.equal(screenPeriodPhase(600, 1200), Math.PI);
assert(screenPeriodPhase(600, 1200) < screenPeriodPhase(600, 350), "larger screen periods must lower, not raise, spatial frequency");
assert.deepEqual(frostSeedPhase(1), frostSeedPhase(1), "equal seeds must produce equal crystal phases");
assert.notDeepEqual(frostSeedPhase(1), frostSeedPhase(0x9e3779b9), "stress seed must change crystal phase");
assert.throws(() => frostSeedPhase(-1), /uint32/);
assert.throws(() => frostSeedPhase(0x100000000), /uint32/);

const oddBalancedExtent = computeFrostExtents({ drawingWidth: 641, drawingHeight: 359, historyScale: 0.5 });
assert.deepEqual(
  [oddBalancedExtent.displayWidth, oddBalancedExtent.displayHeight, oddBalancedExtent.historyWidth, oddBalancedExtent.historyHeight],
  [641, 359, 321, 180],
);
const historyGraph = resolveFrostGraphContract("history-and-deposit", "balanced", 641, 359);
const diffusionGraph = resolveFrostGraphContract("diffusion", "balanced", 641, 359);
const opticalFullGraph = resolveFrostGraphContract("refraction-and-fresnel", "full", 641, 359);
const opticalBudgetGraph = resolveFrostGraphContract("refraction-and-fresnel", "budgeted", 641, 359);
const benchmarkGraph = resolveFrostGraphContract("full-vs-dirty-vs-idle", "balanced", 641, 359);
assert.notDeepEqual(historyGraph.reachableNodes, diffusionGraph.reachableNodes, "mechanism routes must select different reachable graphs");
assert.equal(historyGraph.diffusion, false);
assert.equal(diffusionGraph.diffusion, true);
assert.equal(opticalFullGraph.refractionScaleCount, 2);
assert.equal(opticalBudgetGraph.refractionScaleCount, 1);
assert.notEqual(opticalFullGraph.extents.historyWidth, opticalBudgetGraph.extents.historyWidth, "tier routes must select different storage extents");
assert.equal(benchmarkGraph.benchmarkLedger, true, "benchmark route must allocate reachable instrumentation rather than changing metadata only");
assert.deepEqual(Object.keys(FROST_MECHANISM_PROFILES), FROST_MECHANISMS);

const computeSubmissions = [];
const manualRendererState = {
  renderTarget: "host-target",
  viewport: [11, 13, 320, 180],
  scissor: [17, 19, 300, 160],
  scissorTest: true,
  clearColor: 0x102030,
  clearAlpha: 0.75,
  autoClear: false,
  xrEnabled: true,
};
const renderer = {
  backend: { isWebGPUBackend: true },
  autoClear: manualRendererState.autoClear,
  xr: { enabled: manualRendererState.xrEnabled },
  async init() {},
  compute(nodes) { computeSubmissions.push(nodes); },
  getRenderTarget() { return manualRendererState.renderTarget; },
  setRenderTarget(value) { manualRendererState.renderTarget = value; },
  getViewport() { return manualRendererState.viewport; },
  setViewport(value) { manualRendererState.viewport = value; },
  getScissor() { return manualRendererState.scissor; },
  setScissor(value) { manualRendererState.scissor = value; },
  getScissorTest() { return manualRendererState.scissorTest; },
  setScissorTest(value) { manualRendererState.scissorTest = value; },
  getClearColor() { return manualRendererState.clearColor; },
  setClearColor(value, alpha) {
    manualRendererState.clearColor = value;
    manualRendererState.clearAlpha = alpha;
  },
  getClearAlpha() { return manualRendererState.clearAlpha; },
};
const rendererStateBefore = structuredClone(manualRendererState);
let pipelineRenderCount = 0;
let pipelineDisposeCount = 0;
const renderPipeline = {
  render() { pipelineRenderCount += 1; },
  dispose() { pipelineDisposeCount += 1; },
};
const effect = createWebGPUTouchHistoryFrostEffect({
  width: 320,
  height: 180,
  renderer,
  renderPipeline,
});
assert.equal(effect.renderPipeline, renderPipeline, "injected RenderPipeline must remain the presentation owner");
assert.equal(effect.ownsRenderPipeline, false, "the effect must not claim ownership of an injected RenderPipeline");
assert(effect.createFrameGraph().some((step) => step.includes("RenderPipeline.render")));
assert.equal(effect.historyReadTextureNode === effect.historyWriteTextureNode, false, "history read/write nodes must never alias");
assert.equal(effect.historyReadTextureNode.value === effect.historyWriteTextureNode.value, false, "history read/write node resources must never alias");
const initialResourcePlan = effect.createResourcePlan();
assert.notEqual(initialResourcePlan.diagnostics.previousHistory.node, initialResourcePlan.diagnostics.currentHistory.node);
assert.notEqual(initialResourcePlan.diagnostics.previousHistory.resource, initialResourcePlan.diagnostics.currentHistory.resource);
await effect.initialize();
const baselinePhase = effect.uniforms.crystalPhase.value.clone();
assert.equal(effect.setSeed(0x9e3779b9), 0x9e3779b9);
assert.equal(effect.getMetrics().seed, 0x9e3779b9);
assert.notDeepEqual(
  [effect.uniforms.crystalPhase.value.x, effect.uniforms.crystalPhase.value.y],
  [baselinePhase.x, baselinePhase.y],
  "setSeed must mutate the live crystal phase uniform",
);
const initialRead = effect.historyRead;
effect.advanceFrame({
  deltaSeconds: 1 / 60,
  segmentStart: { x: 0.25, y: 0.25 },
  segmentEnd: { x: 0.75, y: 0.75 },
  pressure: 1,
  active: true,
});
assert.notEqual(effect.historyRead, initialRead, "same-frame compute must swap the completed history before composite");
assert.equal(effect.historyReadTextureNode.value, effect.historyRead, "current-history node must follow the completed read slot");
assert.equal(effect.historyWriteTextureNode.value, initialRead, "previous-history node must retain the prior read slot");
assert.equal(effect.getMetrics().eventCount, 1);
assert.equal(effect.getMetrics().sameFrameComposite, true);
assert.equal(computeSubmissions.length, 2, "initialize clear group plus one history update expected");
assert.equal(pipelineRenderCount, 1, "advanceFrame must delegate presentation to RenderPipeline.render()");
effect.setSize(800, 600);
assert.equal(effect.historyRead.image.width, 800);
assert.equal(effect.historyClearedOnResize, true);
effect.setTier("balanced");
assert.deepEqual(effect.getMetrics().historySize, [400, 300], "tier scale must be reapplied to the current drawing-buffer extent");
effect.setSize(641, 359);
assert.deepEqual(effect.getMetrics().displaySize, [641, 359]);
assert.deepEqual(effect.getMetrics().historySize, [321, 180], "odd DPR-sized drawing buffers must preserve the balanced scale");
assert.deepEqual([effect.uniforms.displayResolution.value.x, effect.uniforms.displayResolution.value.y], [641, 359]);
const historyPlan = effect.setMechanism("history-and-deposit") && effect.createResourcePlan();
const diffusionPlan = effect.setMechanism("diffusion") && effect.createResourcePlan();
assert.equal(historyPlan.graph.diffusion, false);
assert.equal(diffusionPlan.graph.diffusion, true);
assert.notDeepEqual(historyPlan.graph.reachableNodes, diffusionPlan.graph.reachableNodes);
const benchmarkPlan = effect.setMechanism("full-vs-dirty-vs-idle") && effect.createResourcePlan();
assert.equal(benchmarkPlan.benchmarkLedger.name, "touch-history-frost:benchmark-ledger");
assert.equal(benchmarkPlan.residentStorageBytes, benchmarkPlan.storageBytes.total + 8);
assert.throws(() => effect.setTier("imaginary"), /unknown frost tier/);
assert.deepEqual(Object.keys(FROST_QUALITY_TIERS), ["full", "balanced", "budgeted"]);
effect.dispose();
assert.equal(effect.historyA.disposed, true);
assert.equal(effect.historyB.disposed, true);
assert.equal(pipelineDisposeCount, 0, "an injected RenderPipeline remains owned by its host");
assert.deepEqual(manualRendererState, rendererStateBefore, "the node pipeline must not mutate manual renderer state");
assert.equal(renderer.autoClear, rendererStateBefore.autoClear, "the effect must not mutate renderer.autoClear");
assert.equal(renderer.xr.enabled, rendererStateBefore.xrEnabled, "the effect must not mutate renderer.xr.enabled");

for (const required of [
  "previous history R/A",
  "deposit R/A",
  "next history R/A",
  "vertical blur",
  "detail refraction offset",
  "pause",
  "singleStep",
]) {
  assert(FROST_DEBUG_VIEWS.includes(required), `missing debug view ${required}`);
}

const source = readFileSync(resolve(here, "frost-surface-effect.js"), "utf8");
for (const token of [
  "WebGPURenderer",
  "RenderPipeline",
  "StorageTexture",
  "Fn",
  "textureStore",
  "textureLoad",
  "globalId.xy",
  "[8, 8, 1]",
  "resolutionScale",
  "outputNode",
  "HalfFloatType",
  "RGBAFormat",
  "NoColorSpace",
  "generateMipmaps",
  "setSize(",
  "dispose(",
  "compute(",
  "mainScreenPeriod",
  "detailScreenPeriod",
  ".mul((2 * Math.PI) / settings.mainScreenPeriod)",
  ".add(uniforms.crystalPhase)",
  "exactDielectricFresnelNode",
  "settings.thickness",
  "settings.ior",
  "historyReadTextureNode",
  "historyWriteTextureNode",
  "displayResolution",
  "resolveFrostGraphContract",
  "MirroredRepeatWrapping",
  "Fresnel",
  "sourceInset",
  "heightWeight",
  "outputColorTransform = false",
  "needsUpdate = true",
]) {
  assert(source.includes(token), `missing source token ${token}`);
}

for (const forbidden of [
  "getRenderTarget(",
  "setRenderTarget(",
  "getViewport(",
  "setViewport(",
  "getScissor(",
  "setScissor(",
  "getScissorTest(",
  "setScissorTest(",
  "getClearColor(",
  "setClearColor(",
  "getClearAlpha(",
  "autoClear =",
  "xr.enabled =",
  "pow(float(1).sub(clearAmount.mul(0.8)), 5)",
]) {
  assert(!source.includes(forbidden), `manual renderer-state mutation is outside RenderPipeline ownership: ${forbidden}`);
}

const labManifest = JSON.parse(readFileSync(resolve(here, "lab.manifest.json"), "utf8"));
assert.equal(labManifest.schemaVersion, 2);
assert.equal(labManifest.kind, "canonical-lab");
assert.equal(labManifest.status, "incomplete", "lab cannot be accepted before native-WebGPU evidence");
assert.equal(labManifest.threeRevision, "0.185.1");
assert.deepEqual(labManifest.mechanisms.map(({ id }) => id), FROST_MECHANISMS);
assert.deepEqual(labManifest.tiers.map(({ id }) => id), Object.keys(FROST_QUALITY_TIERS));
assert.deepEqual(labManifest.modes, FROST_LAB_MODES);
assert.equal(FROST_MODE_TO_DEBUG_VIEW["no-post"], "scene color");
assert.equal(FROST_MODE_TO_DEBUG_VIEW.diagnostics, "next history R/A");
assert.equal(labManifest.id, FROST_LAB_ID);
assert.deepEqual(labManifest.scenarios.map(({ id }) => id), [FROST_SCENARIO_ID]);
assert(existsSync(resolve(here, labManifest.browserEntry)), "canonical browser entry is missing");
for (const { id } of labManifest.mechanisms) {
  const wrapper = resolve(here, "mechanism", id, "index.html");
  assert(existsSync(wrapper), `missing mechanism wrapper ${id}`);
  assert(readFileSync(wrapper, "utf8").includes("../../route-wrapper.js"), `${id} forks the canonical route implementation`);
  assert.equal(parseFrostLabRoute(`/demos/frost/mechanism/${id}/`).mechanism, id);
}
for (const { id } of labManifest.tiers) {
  const wrapper = resolve(here, "tier", id, "index.html");
  assert(existsSync(wrapper), `missing tier wrapper ${id}`);
  assert(readFileSync(wrapper, "utf8").includes("../../route-wrapper.js"), `${id} forks the canonical route implementation`);
  assert.equal(parseFrostLabRoute(`/demos/frost/tier/${id}/`).tier, id);
}
assert.throws(() => parseFrostLabRoute("/demos/frost/mechanism/not-a-mechanism/"), /unknown frost mechanism/);
assert.throws(() => parseFrostLabRoute("/demos/frost/tier/not-a-tier/"), /unknown frost tier/);

const controllerContract = new WebGPUFrostLab({ mechanism: "diffusion" });
assert.equal(controllerContract.labId, FROST_LAB_ID);
await controllerContract.setScenario(FROST_SCENARIO_ID);
assert.equal(controllerContract.scenario, FROST_SCENARIO_ID);
assert.equal(controllerContract.mechanism, "diffusion", "scenario selection must not mutate the mechanism");
await assert.rejects(controllerContract.setScenario("history-and-deposit"), /unknown frost scenario/);
assert.throws(() => new WebGPUFrostLab({ runtimeProfile: "invented" }), /unknown frost runtime profile/);
assert.equal(typeof controllerContract.describeCaptureRecipes, "function");
assert.equal(typeof controllerContract.captureRecipe, "function");
assert.throws(() => controllerContract.describeCaptureRecipes(), /unavailable before ready/);
await assert.rejects(controllerContract.captureRecipe("invented"), /unknown frost capture recipe/);

const browserSource = readFileSync(resolve(here, "frost-webgpu-lab.js"), "utf8");
for (const token of [
  "await this.renderer.init()",
  "isWebGPUBackend !== true",
  "readRenderTargetPixelsAsync",
  "alignedBytesPerRow",
  "exact retained renderer.backend.device reference after renderer.init()",
  "lossPromiseObservedOnActualDevice",
  "timestampQueriesActive",
  "timeSeconds: this.time",
  "this.renderer.getSize(new Vector2())",
  "dpr: this.renderer.getPixelRatio()",
  "runFrostCaptureTransaction",
  "scratch = createWebGPUTouchHistoryFrostEffect",
  "await this.rendererDevice.queue.onSubmittedWorkDone()",
  "runSharedLifecycleProfile",
  "frostLifecycleCyclePlan",
  "OWNED_RENDERER_DISPOSED",
  "removeEventListener?.(\"uncapturederror\"",
  "rendererStateBeforeDigest",
  "rendererStateAfterDigest",
  'opaqueRendererInternalResidency: "NOT_CLAIMED"',
  "captureTargetId",
  "depthBuffer: false",
  'restorationVerdict: "PASS"',
]) {
  assert(browserSource.includes(token), `canonical frost browser source is missing ${token}`);
}
const entrySource = readFileSync(resolve(here, "main.js"), "utf8");
const pageSource = readFileSync(resolve(here, "index.html"), "utf8");
assert(entrySource.includes("globalThis.labController = lab"), "canonical frost controller is not published through labController");
assert(entrySource.includes("globalThis.__LAB_CONTROLLER__ = lab"), "canonical frost controller compatibility alias is missing");
assert(entrySource.includes("lab.setMechanism(mechanismSelect.value)"), "mechanism UI still mutates the scenario channel");
assert(entrySource.includes("globalThis.__LAB_CAPTURE_PROFILE__?.id"), "capture profile is not an explicit runtime input");
assert(entrySource.includes('get("capture") === "1"'), "automated capture does not own a deterministic clock");
assert(entrySource.includes("if (!automatedCapture)"), "presentation animation still runs during automated capture");
assert(pageSource.includes("<details data-metrics>"), "runtime metrics must use a native disclosure drawer");
assert(!pageSource.includes("<details data-metrics open"), "runtime metrics must not obscure the canvas by default");
assert(pageSource.includes("data-readiness"), "the compact HUD must expose renderer readiness");
assert(entrySource.includes("metricsDetails.open"), "closed metrics drawers must not serialize runtime data every frame");
assert(entrySource.includes("nextMetricsUpdate = timestamp + 250"), "open metrics serialization must be throttled");

console.log("webgpu-touch-history-frost validation passed");
