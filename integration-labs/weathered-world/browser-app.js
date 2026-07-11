import {
  AmbientLight,
  Color,
  HalfFloatType,
  NeutralToneMapping,
  NoColorSpace,
  PerspectiveCamera,
  RenderPipeline,
  RenderTarget,
  Scene,
  UnsignedByteType,
  Vector2,
  WebGPURenderer,
} from "three/webgpu";
import {
  abs,
  exp,
  float,
  log,
  mrt,
  normalize,
  output,
  pass,
  renderOutput,
  screenUV,
  select,
  texture,
  vec2,
  vec3,
  vec4,
} from "three/tsl";

import { createAtmosphereCompositeNode } from "../../threejs-sky-atmosphere-and-haze/examples/webgpu-lut-atmosphere/webgpu-lut-atmosphere.js";
import { createDepthAwareCloudCompositeNode } from "../../threejs-volumetric-clouds/examples/webgpu-weather-volume-clouds/cloud-composite.js";
import { unpackAlignedReadback } from "../../threejs-visual-validation/examples/webgpu-validation-harness/src/readback.js";

import {
  WEATHERED_WORLD_CAMERAS,
  WEATHERED_WORLD_MODES,
  WORLD_UNITS_PER_METER,
  createOwnerGraphManifest,
  requireWeatheredWorldCamera,
  requireWeatheredWorldMode,
  requireWeatheredWorldTier,
  validateWeatheredWorldContract,
} from "./world-contract.js";
import { createWeatheredWorldStages } from "./world-stages.js";

const canvas = document.querySelector("#lab");
const status = document.querySelector("#status");
const query = new URLSearchParams(location.search);
const mechanismModes = Object.freeze({
  "shared-world-units": "owner-graph",
  "shared-weather-envelope": "weather-envelope",
  "atmosphere-cloud-hdr": "atmosphere",
  "ocean-bounded-water-ownership": "ocean",
  "cloud-opaque-shadow-separation": "shadow-contribution",
  "owner-graph": "owner-graph",
});
const metaLockedTier = document.querySelector('meta[name="locked-tier"]')?.content ?? null;
const metaLockedMode = document.querySelector('meta[name="locked-mode"]')?.content ?? null;
const queryTier = query.get("tier");
const queryMode = query.get("mode");
const queryMechanism = query.get("mechanism");
const queryScenario = query.get("scenario");
if (queryScenario && queryScenario !== "world") throw new Error(`Unknown Weathered World scenario "${queryScenario}"`);
if (queryMechanism && !Object.hasOwn(mechanismModes, queryMechanism)) {
  throw new Error(`Unknown Weathered World mechanism "${queryMechanism}"`);
}
const mechanismMode = queryMechanism ? mechanismModes[queryMechanism] : null;
if (metaLockedTier && queryTier && metaLockedTier !== queryTier) throw new Error("Conflicting Weathered World tier locks");
if (metaLockedMode && queryMode && metaLockedMode !== queryMode) throw new Error("Conflicting Weathered World mode locks");
if (mechanismMode && queryMode && mechanismMode !== queryMode) throw new Error("Mechanism and mode query locks conflict");
const lockedTier = metaLockedTier ?? queryTier;
const lockedMode = metaLockedMode ?? mechanismMode ?? queryMode;
const initialTier = requireWeatheredWorldTier(lockedTier ?? "balanced");
const state = {
  scenario: queryScenario ?? "world",
  mode: requireWeatheredWorldMode(lockedMode ?? "final"),
  tier: initialTier.id,
  camera: "horizon",
  seed: 1,
  timeSeconds: 0,
  forcing: 0.68,
  dpr: 1,
};

const renderer = new WebGPURenderer({
  canvas,
  antialias: false,
  outputBufferType: HalfFloatType,
  trackTimestamp: true,
});
renderer.toneMapping = NeutralToneMapping;
await renderer.init();
if (renderer.backend?.isWebGPUBackend !== true) {
  throw new Error("Weathered World requires renderer.backend.isWebGPUBackend === true");
}
renderer.shadowMap.enabled = true;

const scene = new Scene();
scene.background = new Color(0x081423);
scene.add(new AmbientLight(0x86a4c7, 0.65));
const camera = new PerspectiveCamera(52, 1, 0.1, 1200);
const pipeline = new RenderPipeline(renderer);
pipeline.outputColorTransform = false;
const scenePass = pass(scene, camera);
// Weathered World currently has no downstream normal/emissive consumer.
// Keep the shipping graph output-only instead of paying for idle MRT stores.
scenePass.setMRT(mrt({ output }));
const sceneHdr = scenePass.getTextureNode("output");
const sceneDepth = scenePass.getTextureNode("depth");
const sceneViewDistance = scenePass.getViewZNode().negate();
const surfaceCoverage = renderer.reversedDepthBuffer
  ? sceneDepth.greaterThan(1e-7)
  : sceneDepth.lessThan(1 - 1e-7);

let stages = null;
let outputs = null;
let outputBindings = null;
let captureTarget = null;
let ownerValidation = null;
let frameUpdates = 0;

function setObjectVisibility(mode) {
  const isolate = new Set(["ocean", "bounded-water", "precipitation", "wetness", "snow", "vegetation-wind"]);
  const isolated = isolate.has(mode);
  const show = (object, value) => { if (object) object.visible = value; };
  show(stages.planet.mesh, !isolated);
  show(stages.ocean.mesh, !isolated || mode === "ocean");
  show(stages.boundedWater.mesh, !isolated || mode === "bounded-water");
  show(stages.vegetation.system.object, !isolated || mode === "vegetation-wind");
  show(stages.precipitation.object, !isolated || mode === "precipitation");
  show(stages.weatherSurfaceGroup, !isolated || mode === "wetness" || mode === "snow");
  show(stages.weatherSurfaces.road, !isolated || mode === "wetness");
  show(stages.weatherSurfaces.snow, !isolated || mode === "snow");
  show(stages.weatherSurfaces.snowOccluder, !isolated || mode === "snow");
}

function ownerGraphNode() {
  const column = screenUV.x.mul(4).floor();
  const row = screenUV.y.mul(3).floor();
  const index = row.mul(4).add(column);
  const a = vec3(0.12, 0.45, 0.88);
  const b = vec3(0.14, 0.72, 0.47);
  const c = vec3(0.86, 0.46, 0.12);
  const d = vec3(0.63, 0.24, 0.82);
  const first = select(index.mod(4).lessThan(1), a, select(index.mod(4).lessThan(2), b, select(index.mod(4).lessThan(3), c, d)));
  return vec4(first.mul(float(0.55).add(screenUV.y.mul(0.45))), 1);
}

function buildOutputNodes() {
  const atmosphereRuntime = stages.atmosphere.system.runtime;
  const atmosphereConfig = stages.atmosphere.system.config;
  const clipFar = vec4(
    screenUV.x.mul(2).sub(1),
    float(1).sub(screenUV.y.mul(2)),
    1,
    1,
  );
  const worldFarH = atmosphereRuntime.inverseViewProjectionWorldNode.mul(clipFar);
  const worldFar = worldFarH.xyz.div(worldFarH.w);
  const rayWorld = normalize(worldFar.sub(atmosphereRuntime.cameraPositionWorldNode));
  const bodyFarH = atmosphereRuntime.inverseViewProjectionBodyKmNode.mul(clipFar);
  const bodyFarKm = bodyFarH.xyz.div(bodyFarH.w);
  const rayBody = normalize(bodyFarKm.sub(atmosphereRuntime.cameraPositionBodyKmNode));
  const rayView = normalize(atmosphereRuntime.worldToViewNode.mul(vec4(rayWorld, 0)).xyz);
  const distanceWorld = sceneViewDistance.div(rayView.z.negate().max(1e-6));
  const worldUnitsPerKm = atmosphereConfig.renderUnitsPerMeter * 1000;
  const distanceKm = distanceWorld.div(worldUnitsPerKm).max(0);
  const atmosphereDepthParameter = log(
    distanceKm.div(atmosphereRuntime.aerialFarKmNode).mul(Math.exp(4) - 1).add(1),
  ).div(4).clamp(0, 1);
  const atmosphereHdr = createAtmosphereCompositeNode({
    sceneColorNode: sceneHdr,
    depthFractionNode: atmosphereDepthParameter,
    surfaceCoverageNode: surfaceCoverage,
    resources: stages.atmosphere.system.resources,
    runtime: atmosphereRuntime,
    config: atmosphereConfig,
    viewRayBodyNode: rayBody,
  });
  const cloudResolved = stages.getCloudResolved();
  const low = stages.cloudResources.describe().lowResolution;
  const cloudColorTexture = texture(cloudResolved.radianceTransmittance);
  const cloudDepthTexture = texture(cloudResolved.representativeDepthMeters);
  const cloudShadowTexture = texture(stages.cloudResources.shadow[0]);
  const oceanSurfaceTexture = texture(stages.ocean.ocean.combinedSurface.surfaceTexture);
  const boundedStateTexture = texture(stages.boundedWater.heightfield.currentTexture);
  const weather = stages.weatherNodes;
  const cloudTau = cloudShadowTexture.sample(screenUV).x;
  const cloudComposite = createDepthAwareCloudCompositeNode({
    sceneColorNode: atmosphereHdr,
    sceneDepthMetersNode: sceneViewDistance,
    cloudResolvedNode: cloudColorTexture,
    cloudDepthNode: cloudDepthTexture,
    lowWidth: low.width,
    lowHeight: low.height,
  });
  // Exact host-owned linear-HDR composition: C_scene * T_cloud + L_cloud.
  // Receiver cloud shadows are applied in the planet/ocean/water/vegetation
  // materials and therefore are not multiplied a second time here.
  const finalHdr = cloudComposite;
  const oceanSurface = oceanSurfaceTexture.sample(screenUV);
  const boundedState = boundedStateTexture.sample(screenUV);
  const shadowMapTexture = stages.opaqueShadow.light.shadow.map?.texture;
  if (!shadowMapTexture) throw new Error("Opaque-shadow diagnostic requires the real allocated shadow comparison target");
  const opaqueShadowTexture = texture(shadowMapTexture);
  const opaqueShadow = opaqueShadowTexture.sample(screenUV).r;
  const tone = (node) => renderOutput(node, NeutralToneMapping, renderer.outputColorSpace);
  const nodes = {
    final: tone(finalHdr),
    "no-post": tone(sceneHdr),
    "weather-envelope": tone(vec4(weather.wetness, weather.snowCoverage, weather.forcing, 1)),
    atmosphere: tone(atmosphereHdr),
    "cloud-optical-depth": tone(vec4(vec3(float(1).sub(exp(cloudTau.negate()))), 1)),
    ocean: tone(vec4(oceanSurface.rgb, 1)),
    "bounded-water": tone(vec4(boundedState.r, boundedState.g.mul(0.5).add(0.5), boundedState.b, 1)),
    precipitation: tone(sceneHdr),
    wetness: tone(sceneHdr),
    snow: tone(sceneHdr),
    "vegetation-wind": tone(sceneHdr),
    "shadow-contribution": tone(vec4(float(1).sub(exp(cloudTau.negate())), opaqueShadow, abs(opaqueShadow.sub(exp(cloudTau.negate()))), 1)),
    "owner-graph": tone(ownerGraphNode()),
  };
  return {
    nodes,
    bindings: {
      cloudColorTexture,
      cloudDepthTexture,
      cloudShadowTexture,
      oceanSurfaceTexture,
      boundedStateTexture,
      opaqueShadowTexture,
    },
  };
}

function refreshOutputBindings() {
  if (!outputBindings) return;
  const resolved = stages.getCloudResolved();
  outputBindings.cloudColorTexture.value = resolved.radianceTransmittance;
  outputBindings.cloudDepthTexture.value = resolved.representativeDepthMeters;
  outputBindings.cloudShadowTexture.value = stages.cloudResources.shadow[0];
  outputBindings.oceanSurfaceTexture.value = stages.ocean.ocean.combinedSurface.surfaceTexture;
  outputBindings.boundedStateTexture.value = stages.boundedWater.heightfield.currentTexture;
}

function cameraPose(id) {
  const poses = {
    orbit: { position: [0, 180, 290], target: [0, -5, 0] },
    horizon: { position: [0, 34, 190], target: [0, 4, -10] },
    surface: { position: [0, 8, 48], target: [0, 1, -24] },
  };
  return poses[id];
}

function applyCamera(id) {
  requireWeatheredWorldCamera(id);
  const pose = cameraPose(id);
  camera.position.fromArray(pose.position);
  camera.lookAt(...pose.target);
  state.camera = id;
}

async function rebuildStages() {
  stages?.dispose();
  const tier = requireWeatheredWorldTier(state.tier);
  const viewport = {
    width: Math.max(1, renderer.domElement.width),
    height: Math.max(1, renderer.domElement.height),
  };
  stages = await createWeatheredWorldStages({
    renderer,
    scene,
    camera,
    pipeline,
    sceneDepthTexture: sceneDepth,
    tier,
    seed: state.seed,
    viewport,
  });
  const stageUnits = Object.fromEntries(
    ["planet", "ocean", "boundedWater"].map((id) => [id, stages[id].worldUnitsPerMeter]),
  );
  stageUnits.cloud = stages.cloud.system.worldUnitsPerMeter;
  const weatherConsumers = stages.describeWeatherConsumers();
  ownerValidation = validateWeatheredWorldContract({
    tier,
    worldUnitsPerMeter: WORLD_UNITS_PER_METER,
    stageWorldUnits: stageUnits,
    sharedSurfaceRadiusMeters: stages.physicalRadiiMeters.planet,
    stageSurfaceRadii: stages.physicalRadiiMeters,
    sharedWeatherEnvelope: stages.weatherEnvelope,
    stageWeatherEnvelopes: weatherConsumers,
  });
  if (!ownerValidation.ok) throw new Error(ownerValidation.errors.join("\n"));
  scenePass.setResolutionScale(tier.sceneScale);
  // Compile and render the actual scene once so Three allocates the ordinary
  // directional-light shadow map before the diagnostic binds its real texture.
  pipeline.outputNode = renderOutput(sceneHdr, NeutralToneMapping, renderer.outputColorSpace);
  pipeline.needsUpdate = true;
  await scenePass.compileAsync(renderer);
  pipeline.render();
  await renderer.backend.device.queue.onSubmittedWorkDone();
  await stages.initializeCloud();
  if (state.timeSeconds > 0) {
    await stages.update(state.timeSeconds, state.timeSeconds, state.forcing);
  }
  const built = buildOutputNodes();
  outputs = built.nodes;
  outputBindings = built.bindings;
  setMode(state.mode);
}

function setMode(id) {
  requireWeatheredWorldMode(id);
  if (lockedMode && id !== lockedMode) throw new Error(`Mode route is locked to ${lockedMode}`);
  state.mode = id;
  setObjectVisibility(id);
  pipeline.outputNode = outputs[id];
  pipeline.needsUpdate = true;
  updateStatus();
}

async function updateToTime(seconds) {
  if (!Number.isFinite(seconds) || seconds < 0) throw new Error("Weathered World time must be finite and nonnegative");
  if (seconds < state.timeSeconds) {
    state.timeSeconds = 0;
    await rebuildStages();
  }
  const delta = seconds - state.timeSeconds;
  state.timeSeconds = seconds;
  await stages.update(seconds, delta, state.forcing);
  refreshOutputBindings();
  frameUpdates += 1;
}

async function renderOnce() {
  pipeline.render();
}

async function resize(width, height, dpr = 1) {
  if (!(Number.isInteger(width) && width > 0 && Number.isInteger(height) && height > 0 && Number.isFinite(dpr) && dpr > 0)) {
    throw new Error("resize requires positive integer dimensions and positive DPR");
  }
  const cap = requireWeatheredWorldTier(state.tier).dprCap;
  const selectedDpr = Math.min(dpr, cap);
  renderer.setPixelRatio(selectedDpr);
  renderer.setSize(width, height, false);
  camera.aspect = width / height;
  camera.updateProjectionMatrix();
  state.dpr = selectedDpr;
}

await resize(Math.max(1, innerWidth), Math.max(1, innerHeight), devicePixelRatio || 1);
applyCamera(state.camera);
await rebuildStages();
await updateToTime(0);
await renderOnce();
await renderer.backend.device.queue.onSubmittedWorkDone();

function updateStatus() {
  if (!status) return;
  status.textContent = `Weathered World — native WebGPU\n${state.tier} / ${state.mode}\n1 renderer · 1 RenderPipeline · 1 weather envelope\nruntime evidence incomplete`;
}

const controller = {
  async ready() {},
  async setScenario(id) { if (id !== "world") throw new Error(`Unknown Weathered World scenario "${id}"`); },
  async setMode(id) { setMode(id); await renderOnce(); },
  async setTier(id) {
    requireWeatheredWorldTier(id);
    if (lockedTier && id !== lockedTier) throw new Error(`Tier route is locked to ${lockedTier}`);
    if (id === state.tier) return;
    state.tier = id;
    await rebuildStages();
    await renderOnce();
  },
  async setSeed(seed) {
    if (!Number.isInteger(seed) || seed < 0 || seed > 0xffffffff) throw new Error("seed must be a uint32");
    state.seed = seed >>> 0;
    await rebuildStages();
  },
  async setCamera(id) { applyCamera(id); await rebuildStages(); await renderOnce(); },
  async setTime(seconds) { await updateToTime(seconds); },
  async step(deltaSeconds) {
    if (!Number.isFinite(deltaSeconds) || deltaSeconds < 0) throw new Error("step delta must be finite and nonnegative");
    await updateToTime(state.timeSeconds + deltaSeconds);
    await renderOnce();
  },
  async resetHistory(cause) {
    if (typeof cause !== "string" || cause.length === 0) throw new Error("resetHistory requires a non-empty cause");
    await rebuildStages();
  },
  async resize(width, height, dpr) {
    await resize(width, height, dpr);
    if (stages) await rebuildStages();
  },
  renderOnce,
  async capturePixels(target = state.mode) {
    requireWeatheredWorldMode(target);
    const previousMode = state.mode;
    if (target !== previousMode) setMode(target);
    const size = renderer.getDrawingBufferSize(new Vector2());
    captureTarget ??= new RenderTarget(size.x, size.y, { samples: 1, type: UnsignedByteType });
    captureTarget.texture.colorSpace = NoColorSpace;
    captureTarget.setSize(size.x, size.y);
    renderer.setRenderTarget(captureTarget);
    await renderOnce();
    const pixels = await renderer.readRenderTargetPixelsAsync(captureTarget, 0, 0, size.x, size.y);
    renderer.setRenderTarget(null);
    await renderOnce();
    const unpacked = unpackAlignedReadback(pixels, size.x, size.y, 4);
    if (previousMode !== state.mode) setMode(previousMode);
    return {
      target,
      width: size.x,
      height: size.y,
      format: "rgba8unorm",
      encoding: renderer.outputColorSpace,
      pixels: Array.from(unpacked.pixels),
      bytesPerRow: unpacked.layout.rowBytes,
      readbackLayout: unpacked.layout,
      sourceByteLength: unpacked.sourceByteLength,
    };
  },
  describePipeline() {
    return createOwnerGraphManifest({
      tier: requireWeatheredWorldTier(state.tier),
      resources: stages.describeResources(),
      dispatches: stages.describeDispatches(),
      sceneSubmissions: [
        { id: "weathered-world-primary", owner: "threejs-image-pipeline", kind: "shared-scene-pass", outputs: ["output", "depth"] },
      ],
    });
  },
  describeResources() {
    return {
      worldUnitsPerMeter: WORLD_UNITS_PER_METER,
      physicalRadiiMeters: { ...stages.physicalRadiiMeters },
      sharedWeatherIdentity: Object.values(stages.describeWeatherConsumers()).every((value) => value === stages.weatherEnvelope),
      resources: stages.describeResources(),
    };
  },
  getMetrics() {
    return {
      ...state,
      backendIsWebGPU: renderer.backend.isWebGPUBackend,
      rendererInfo: structuredClone(renderer.info),
      ownerValidation,
      weather: structuredClone(stages.weatherEnvelope),
      frameUpdates,
      runtimeVerdicts: {
        currentAdapterGpuTiming: "INSUFFICIENT_EVIDENCE",
        lifecycle: "INSUFFICIENT_EVIDENCE",
        visualError: "INSUFFICIENT_EVIDENCE",
      },
    };
  },
  async dispose() {
    captureTarget?.dispose();
    stages.dispose();
    scenePass.dispose?.();
    pipeline.dispose?.();
    renderer.dispose();
  },
};

globalThis.__LAB_CONTROLLER__ = controller;
updateStatus();
