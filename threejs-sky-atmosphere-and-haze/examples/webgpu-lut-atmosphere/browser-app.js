import {
  AmbientLight,
  Color,
  DirectionalLight,
  Matrix4,
  Mesh,
  MeshStandardNodeMaterial,
  NeutralToneMapping,
  NoColorSpace,
  NoToneMapping,
  PerspectiveCamera,
  RenderPipeline,
  RenderTarget,
  Scene,
  SphereGeometry,
  UnsignedByteType,
  Vector2,
  Vector3,
} from "three/webgpu";
import {
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
  texture3D,
  vec3,
  vec4,
} from "three/tsl";

import { createAtmosphereConfig } from "./atmosphere-config.js";
import {
  createAtmosphereCompositeNode,
  createAtmosphereRenderer,
  createAtmosphereStage,
  deriveAtmosphereRuntimeState,
} from "./webgpu-lut-atmosphere.js";
import {
  ATMOSPHERE_MODES,
  ATMOSPHERE_SCENARIOS,
  ATMOSPHERE_TIERS,
  assertAtmosphereRouteTransition,
  resolveAtmosphereRoute,
} from "./lab-routes.js";

const canvas = document.querySelector("#lab");
const status = document.querySelector("#status");
const MODES = new Set(ATMOSPHERE_MODES);
const TIERS = new Set(ATMOSPHERE_TIERS);
const CAMERAS = new Set(ATMOSPHERE_SCENARIOS);
const SCENARIOS = CAMERAS;
const route = resolveAtmosphereRoute({
  pathname: location.pathname,
  kind: document.body.dataset.routeKind,
  id: document.body.dataset.routeId,
});
const state = {
  ...route.state,
  camera: route.state.scenario,
  seed: 1,
  time: 0,
  dpr: 1,
};
const bodyWorldMatrix = new Matrix4();
const sunDirectionWorld = new Vector3();
const drawingBufferSize = new Vector2();
let config;
let stage;
let outputNodes;
let captureTarget;
let lastDispatch = null;

const renderer = createAtmosphereRenderer({ canvas });
await renderer.init();
if (renderer.backend?.isWebGPUBackend !== true) {
  throw new Error("Native WebGPU is required; this canonical lab has no fallback branch.");
}

const scene = new Scene();
scene.background = new Color(0x000000);
const camera = new PerspectiveCamera(55, 1, 0.1, 30000);
camera.up.set(0, 0, 1);
const planetMaterial = new MeshStandardNodeMaterial({
  color: new Color(0x315b36),
  roughness: 0.88,
  metalness: 0,
});
const planet = new Mesh(
  new SphereGeometry(6360, 192, 96),
  planetMaterial,
);
planet.name = "atmosphere-body-surface";
scene.add(planet);
scene.add(new AmbientLight(0x49657e, 0.08));
const sunLight = new DirectionalLight(0xffffff, 2.6);
sunLight.name = "atmosphere-direct-sun";
sunLight.target = planet;
scene.add(sunLight);

const scenePass = pass(scene, camera);
scenePass.setMRT(mrt({ output }));
const sceneColor = scenePass.getTextureNode("output");
const sceneDepth = scenePass.getTextureNode("depth");
const sceneViewZ = scenePass.getViewZNode("depth");
const surfaceCoverage = renderer.reversedDepthBuffer
  ? sceneDepth.greaterThan(1e-7)
  : sceneDepth.lessThan(1 - 1e-7);
const pipeline = new RenderPipeline(renderer);
pipeline.outputColorTransform = false;

const CAMERA_PRESETS = Object.freeze({
  "sea-level": {
    altitudeKm: 2,
    target: [900, 6335, 0],
    sunElevation: 0.28,
    sunAzimuth: 0.42,
  },
  mountain: {
    altitudeKm: 8,
    target: [1000, 6338, 0],
    sunElevation: 0.18,
    sunAzimuth: 0.62,
  },
  "low-orbit": {
    altitudeKm: 320,
    target: [1300, 6000, 0],
    sunElevation: 0.12,
    sunAzimuth: 0.75,
  },
  "high-orbit": {
    altitudeKm: 5000,
    target: [0, 0, 0],
    sunElevation: 0.32,
    sunAzimuth: 0.35,
  },
  "night-side": {
    altitudeKm: 2,
    target: [900, 6335, 0],
    sunElevation: -0.34,
    sunAzimuth: 0.8,
  },
  "shell-entry": {
    altitudeKm: 61,
    target: [1150, 6300, 0],
    sunElevation: 0.04,
    sunAzimuth: 1.05,
  },
});

function applyCameraPreset(id) {
  const preset = CAMERA_PRESETS[id];
  if (!preset) throw new Error(`Unknown camera ${id}`);
  camera.position.set(0, 6360 + preset.altitudeKm, 0);
  camera.lookAt(...preset.target);
  camera.updateWorldMatrix(true, false);
}

function updateSunFromState() {
  const preset = CAMERA_PRESETS[state.camera];
  const azimuth = preset.sunAzimuth + state.time * 0.025;
  const elevation = preset.sunElevation + Math.sin(state.time * 0.017) * 0.04;
  const horizontal = Math.cos(elevation);
  sunDirectionWorld
    .set(
      Math.cos(azimuth) * horizontal,
      Math.sin(elevation),
      Math.sin(azimuth) * horizontal,
    )
    .normalize();
  sunLight.position.copy(sunDirectionWorld).multiplyScalar(18000);
}

function reconstructHostNodes() {
  const runtime = stage.system.runtime;
  const clipFar = vec4(
    screenUV.x.mul(2).sub(1),
    float(1).sub(screenUV.y.mul(2)),
    1,
    1,
  );
  const worldFarH = runtime.inverseViewProjectionWorldNode.mul(clipFar);
  const worldFar = worldFarH.xyz.div(worldFarH.w);
  const rayWorld = normalize(worldFar.sub(runtime.cameraPositionWorldNode));
  const bodyFarH = runtime.inverseViewProjectionBodyKmNode.mul(clipFar);
  const bodyFarKm = bodyFarH.xyz.div(bodyFarH.w);
  const rayBody = normalize(bodyFarKm.sub(runtime.cameraPositionBodyKmNode));
  const rayView = normalize(runtime.worldToViewNode.mul(vec4(rayWorld, 0)).xyz);
  const distanceWorld = sceneViewZ
    .negate()
    .div(rayView.z.negate().max(1e-6));
  const worldUnitsPerKm = config.renderUnitsPerMeter * 1000;
  const distanceKm = distanceWorld.div(worldUnitsPerKm).max(0);
  const depthParameter = log(
    distanceKm
      .div(runtime.aerialFarKmNode)
      .mul(Math.exp(4) - 1)
      .add(1),
  )
    .div(4)
    .clamp(0, 1);
  const surfaceWorld = runtime.cameraPositionWorldNode.add(rayWorld.mul(distanceWorld));
  const surfaceBodyKm = runtime.worldToBodyNode
    .mul(vec4(surfaceWorld, 1))
    .xyz.div(worldUnitsPerKm);
  return { rayWorld, rayBody, rayView, distanceKm, depthParameter, surfaceBodyKm };
}

function compressHdr(node) {
  return vec4(node.rgb.div(node.rgb.add(1)), 1);
}

function makeOutputNodes() {
  const resources = stage.system.resources;
  const runtime = stage.system.runtime;
  const host = reconstructHostNodes();
  const finalHdr = createAtmosphereCompositeNode({
    sceneColorNode: sceneColor,
    depthFractionNode: host.depthParameter,
    surfaceCoverageNode: surfaceCoverage,
    resources,
    runtime,
    config,
    viewRayBodyNode: host.rayBody,
  });
  const twoD = (id) => compressHdr(texture(resources.get(id), screenUV));
  const aerial = (id) =>
    compressHdr(texture3D(resources.get(id), vec3(screenUV, 0.55)));
  const optical = texture3D(
    resources.get("aerial-optical-depth"),
    vec3(screenUV, 0.55),
  ).rgb;
  const actualDepthDiagnostic = vec4(
    sceneDepth,
    host.depthParameter,
    select(surfaceCoverage, 1, 0),
    1,
  );
  const diagnosticBodyPosition = select(
    surfaceCoverage,
    host.surfaceBodyKm,
    runtime.cameraPositionBodyKmNode,
  );
  const altitudeFraction = diagnosticBodyPosition
    .length()
    .sub(config.radiiMeters.bottom / 1000)
    .div((config.radiiMeters.top - config.radiiMeters.bottom) / 1000)
    .clamp(0, 1);
  const ecefDirection = normalize(diagnosticBodyPosition).mul(0.5).add(0.5);
  const actualEcefDiagnostic = vec4(
    ecefDirection.x,
    ecefDirection.y,
    altitudeFraction,
    1,
  );
  return {
    final: renderOutput(finalHdr, NeutralToneMapping, renderer.outputColorSpace),
    "no-post": renderOutput(sceneColor, NeutralToneMapping, renderer.outputColorSpace),
    transmittance: renderOutput(twoD("transmittance"), NoToneMapping, renderer.outputColorSpace),
    multiscatter: renderOutput(twoD("multiscatter"), NoToneMapping, renderer.outputColorSpace),
    irradiance: renderOutput(twoD("irradiance"), NoToneMapping, renderer.outputColorSpace),
    "sky-view": renderOutput(twoD("sky-view"), NoToneMapping, renderer.outputColorSpace),
    "aerial-inscattering": renderOutput(
      aerial("aerial-inscattering"),
      NoToneMapping,
      renderer.outputColorSpace,
    ),
    "aerial-optical-depth": renderOutput(
      vec4(vec3(1).sub(exp(optical.negate())), 1),
      NoToneMapping,
      renderer.outputColorSpace,
    ),
    depth: renderOutput(actualDepthDiagnostic, NoToneMapping, renderer.outputColorSpace),
    ecef: renderOutput(actualEcefDiagnostic, NoToneMapping, renderer.outputColorSpace),
  };
}

function setMode(mode) {
  if (!MODES.has(mode)) throw new Error(`Unknown atmosphere mode ${mode}`);
  assertAtmosphereRouteTransition(route.lock, "mode", mode);
  state.mode = mode;
  pipeline.outputNode = outputNodes[mode];
  pipeline.needsUpdate = true;
}

function currentViewport() {
  renderer.getDrawingBufferSize(drawingBufferSize);
  return [Math.max(1, drawingBufferSize.x), Math.max(1, drawingBufferSize.y)];
}

function syncAtmosphereRuntime(cause) {
  updateSunFromState();
  planet.updateWorldMatrix(true, false);
  bodyWorldMatrix.copy(planet.matrixWorld);
  const runtimeState = deriveAtmosphereRuntimeState({
    camera,
    bodyWorldMatrix,
    sunDirectionWorld,
    config,
    viewport: currentViewport(),
  });
  const invalidation = stage.configureRuntimeState(runtimeState, cause);
  const submission = stage.dispatchDirty(renderer);
  lastDispatch = {
    cause,
    invalidated: invalidation.dirty,
    submitted: submission.submitted,
    reasons: submission.reasons,
  };
  status.textContent = [
    "native WebGPU · live camera/body/depth",
    `${state.tier} / ${state.mode} / ${state.camera}`,
    `dispatch: ${submission.submitted.join(", ") || "none"}`,
    "acceptance: incomplete pending native capture",
  ].join("\n");
  return lastDispatch;
}

async function rebuildTier(tier) {
  if (!TIERS.has(tier)) throw new Error(`Unknown atmosphere tier ${tier}`);
  assertAtmosphereRouteTransition(route.lock, "tier", tier);
  const previous = stage;
  config = createAtmosphereConfig({ tier, renderUnitsPerMeter: 0.001 });
  const next = createAtmosphereStage({ config });
  await next.initialize(renderer);
  next.createResources();
  stage = next;
  state.tier = tier;
  syncAtmosphereRuntime("tier-rebuild");
  outputNodes = makeOutputNodes();
  setMode(state.mode);
  previous?.dispose();
}

function alignedStride(width, height, byteLength) {
  const row = width * 4;
  if (byteLength === row * height) return row;
  const aligned = Math.ceil(row / 256) * 256;
  if (byteLength !== aligned * (height - 1) + row) {
    throw new Error("Unexpected WebGPU readback layout");
  }
  return aligned;
}

async function renderOnce() {
  syncAtmosphereRuntime("render-state-check");
  pipeline.render();
  await renderer.backend?.device?.queue?.onSubmittedWorkDone?.();
}

applyCameraPreset(state.camera);
await renderer.setSize(Math.max(innerWidth, 1), Math.max(innerHeight, 1), false);
await rebuildTier(state.tier);
await scenePass.compileAsync(renderer);

const controller = {
  async ready() {},
  async setScenario(id) {
    if (!SCENARIOS.has(id)) throw new Error(`Unknown scenario ${id}`);
    assertAtmosphereRouteTransition(route.lock, "scenario", id);
    state.scenario = id;
    state.camera = id;
    applyCameraPreset(id);
    syncAtmosphereRuntime("scenario-control");
  },
  async setMode(id) {
    setMode(id);
  },
  async setTier(id) {
    await rebuildTier(id);
  },
  async setSeed(seed) {
    if (!Number.isInteger(seed)) throw new Error("seed must be an integer");
    state.seed = seed >>> 0;
  },
  async setCamera(id) {
    if (!CAMERAS.has(id)) throw new Error(`Unknown camera ${id}`);
    state.camera = id;
    state.scenario = id;
    applyCameraPreset(id);
    syncAtmosphereRuntime("camera-control");
  },
  async setTime(seconds) {
    if (!Number.isFinite(seconds)) throw new Error("time must be finite");
    state.time = seconds;
    syncAtmosphereRuntime("sun-time-control");
  },
  async step(deltaSeconds) {
    if (!Number.isFinite(deltaSeconds) || deltaSeconds < 0) {
      throw new Error("deltaSeconds must be finite and non-negative");
    }
    state.time += deltaSeconds;
    syncAtmosphereRuntime("sun-time-step");
    await renderOnce();
  },
  async resetHistory() {
    stage.system.invalidation.markAllDirty("explicit-history-reset");
  },
  async resize(width, height, dpr = 1) {
    if (![width, height, dpr].every((value) => Number.isFinite(value) && value > 0)) {
      throw new Error("width, height, and dpr must be positive");
    }
    renderer.setPixelRatio(dpr);
    renderer.setSize(width, height, false);
    camera.aspect = width / height;
    camera.updateProjectionMatrix();
    state.dpr = dpr;
    captureTarget?.setSize(renderer.domElement.width, renderer.domElement.height);
    syncAtmosphereRuntime("resize-projection-control");
  },
  async renderOnce() {
    await renderOnce();
  },
  async capturePixels(target = "presentation") {
    if (target !== "presentation" && target !== "final") {
      throw new Error(`Unknown capture target ${target}`);
    }
    const size = renderer.getDrawingBufferSize(drawingBufferSize);
    captureTarget ??= new RenderTarget(size.x, size.y, {
      samples: 1,
      type: UnsignedByteType,
    });
    captureTarget.texture.colorSpace = NoColorSpace;
    captureTarget.setSize(size.x, size.y);
    const previous = renderer.getRenderTarget();
    renderer.setRenderTarget(captureTarget);
    try {
      await renderOnce();
    } finally {
      renderer.setRenderTarget(previous);
    }
    const pixels = await renderer.readRenderTargetPixelsAsync(
      captureTarget,
      0,
      0,
      size.x,
      size.y,
    );
    return {
      target,
      width: size.x,
      height: size.y,
      format: "rgba8unorm",
      outputColorSpace: renderer.outputColorSpace,
      bytesPerPixel: 4,
      bytesPerRow: alignedStride(size.x, size.y, pixels.length),
      pixels: Array.from(pixels),
    };
  },
  describePipeline() {
    return {
      owners: {
        renderer: "browser host",
        scenePass: "browser host",
        sceneDepth: "browser host PassNode depth",
        bodyTransform: "planet.matrixWorld",
        atmosphereCompute: "WebGPULutAtmosphere reusable stage",
        toneMap: "renderOutput",
        outputTransform: "renderOutput",
      },
      sceneSubmissions: 1,
      computeDispatches: stage.system.createComputeDispatchDescriptors(),
      runtimeInvalidation: stage.describeUpdates(),
      finalComposition:
        "sceneLinear * exp(-aerialOpticalDepth) + aerialResponse * solarNormalIrradiance; sky uses direction-mapped sky-view plus disc radiance",
      finalToneMapOwner: "renderOutput",
      finalOutputTransformOwner: "renderOutput",
      outputColorTransform: pipeline.outputColorTransform,
    };
  },
  describeResources() {
    return {
      ...stage.describeResources(),
      host: {
        sceneColor: "PassNode output",
        sceneDepth: "PassNode depth",
        bodyGeometry: {
          vertices: planet.geometry.attributes.position.count,
          indices: planet.geometry.index.count,
        },
      },
    };
  },
  getMetrics() {
    return {
      ...state,
      routeLock: route.lock,
      backendIsWebGPU: renderer.backend.isWebGPUBackend,
      rendererInfo: structuredClone(renderer.info),
      lastDispatch,
      invalidation: stage.describeUpdates(),
      runtimeState: structuredClone(stage.system.runtime.state),
      acceptanceVerdict: "INSUFFICIENT_EVIDENCE",
    };
  },
  async dispose() {
    captureTarget?.dispose();
    stage.dispose();
    planet.geometry.dispose();
    planetMaterial.dispose();
    pipeline.dispose?.();
    renderer.dispose();
  },
};

function appendControl(label, values, current, onChange, locked) {
  const row = document.createElement("label");
  row.textContent = `${label} `;
  const selectElement = document.createElement("select");
  for (const value of values) {
    const option = document.createElement("option");
    option.value = value;
    option.textContent = value;
    option.selected = value === current;
    selectElement.append(option);
  }
  selectElement.disabled = locked;
  selectElement.addEventListener("change", () => onChange(selectElement.value));
  row.append(selectElement);
  return row;
}

function mountLiveControls() {
  const panel = document.createElement("div");
  panel.id = "live-controls";
  panel.style.cssText =
    "position:fixed;left:12px;bottom:12px;display:flex;gap:8px;flex-wrap:wrap;max-width:calc(100vw - 24px);color:#d9ecff;background:#06101ddd;padding:8px 10px;font:12px/1.4 ui-monospace,monospace";
  panel.append(
    appendControl(
      "scenario",
      ATMOSPHERE_SCENARIOS,
      state.camera,
      (value) => controller.setScenario(value),
      route.lock.kind === "scenario",
    ),
    appendControl(
      "tier",
      ATMOSPHERE_TIERS,
      state.tier,
      (value) => controller.setTier(value),
      route.lock.kind === "tier",
    ),
    appendControl(
      "mode",
      ATMOSPHERE_MODES,
      state.mode,
      (value) => controller.setMode(value),
      route.lock.kind === "mechanism",
    ),
  );
  const sunLabel = document.createElement("label");
  sunLabel.textContent = " sun-time ";
  const sunInput = document.createElement("input");
  sunInput.type = "range";
  sunInput.min = "0";
  sunInput.max = "240";
  sunInput.step = "1";
  sunInput.value = String(state.time);
  sunInput.addEventListener("input", () => controller.setTime(Number(sunInput.value)));
  sunLabel.append(sunInput);
  panel.append(sunLabel);
  document.body.append(panel);
}

await controller.resize(Math.max(innerWidth, 1), Math.max(innerHeight, 1), 1);
await renderOnce();
globalThis.__LAB_CONTROLLER__ = controller;
mountLiveControls();
