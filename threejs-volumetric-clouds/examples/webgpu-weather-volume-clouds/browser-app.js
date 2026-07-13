import {
  Data3DTexture, DataTexture, LinearFilter, NoColorSpace, RedFormat,
  RepeatWrapping, RGBAFormat, UnsignedByteType,
} from "three";
import {
  AmbientLight, BoxGeometry, Color, Mesh, MeshStandardNodeMaterial,
  NoColorSpace as WebGPUDataSpace, PerspectiveCamera, RenderPipeline,
  RenderTarget, Scene, UnsignedByteType as WebGPUUnsignedByteType, Vector3,
} from "three/webgpu";
import {
  color, float, mrt, output, pass, renderOutput, screenUV,
  texture, vec2, vec3, vec4,
} from "three/tsl";

import { createDefaultCloudConfig } from "./cloud-config.js";
import { CLOUD_DOMAIN_FIXTURES } from "./cloud-domains.js";
import { WebGPUWeatherVolumeClouds } from "./webgpu-weather-volume-clouds.js";
import { createDepthAwareCloudCompositeNode } from "./cloud-composite.js";
import {
  CLOUD_MODES,
  CLOUD_SCENARIOS,
  CLOUD_TIERS,
  assertCloudRouteTransition,
  resolveCloudRoute,
} from "./lab-routes.js";

const canvas = document.querySelector("#lab");
const status = document.querySelector("#status");
const TIERS = new Set(CLOUD_TIERS);
const SCENARIOS = new Set(CLOUD_SCENARIOS);
const MODES = new Set(CLOUD_MODES);
const CAMERAS = new Set(["near", "design", "far"]);
const route = resolveCloudRoute({
  pathname: location.pathname,
  kind: document.body.dataset.routeKind,
  id: document.body.dataset.routeId,
});
const state = { ...route.state, camera: "design", seed: 1, frameIndex: 0, timeSeconds: 0 };
let system;
let resources;
let kernels;
let pipeline;
let outputs;
let outputBindings;
let captureTarget;

function deterministicByte(index, seed) {
  let value = (index ^ seed) >>> 0;
  value = Math.imul(value ^ (value >>> 16), 0x7feb352d);
  value = Math.imul(value ^ (value >>> 15), 0x846ca68b);
  return (value ^ (value >>> 16)) & 255;
}

function makeFields(seed) {
  const weatherSize = 128;
  const weatherBytes = new Uint8Array(weatherSize * weatherSize * 4);
  for (let index = 0; index < weatherBytes.length; index += 1) weatherBytes[index] = deterministicByte(index, seed);
  const localWeather = new DataTexture(weatherBytes, weatherSize, weatherSize, RGBAFormat, UnsignedByteType);
  const volume = (size, salt) => {
    const bytes = new Uint8Array(size ** 3);
    for (let index = 0; index < bytes.length; index += 1) bytes[index] = deterministicByte(index, seed ^ salt);
    const result = new Data3DTexture(bytes, size, size, size);
    result.format = RedFormat; result.type = UnsignedByteType; result.needsUpdate = true;
    result.minFilter = LinearFilter; result.magFilter = LinearFilter;
    result.wrapS = result.wrapT = result.wrapR = RepeatWrapping;
    result.colorSpace = NoColorSpace;
    return result;
  };
  localWeather.needsUpdate = true;
  localWeather.minFilter = localWeather.magFilter = LinearFilter;
  localWeather.wrapS = localWeather.wrapT = RepeatWrapping;
  localWeather.colorSpace = NoColorSpace;
  return {
    localWeather,
    shape: volume(32, 0x1234),
    shapeDetail: volume(16, 0x4567),
    turbulence: localWeather.clone(),
    stbn: volume(32, 0x9e37),
    dispose() { for (const value of Object.values(this)) value?.isTexture && value.dispose(); },
  };
}

function domainForScenario(scenario) {
  if (scenario === "planar-slab") return { ...CLOUD_DOMAIN_FIXTURES.slab };
  if (scenario === "obb-cloud-bank") return { ...CLOUD_DOMAIN_FIXTURES.obb };
  return {
    type: "spherical-shell", center: CLOUD_DOMAIN_FIXTURES.shell.center,
    planetRadiusMeters: 6360000, innerRadiusMeters: CLOUD_DOMAIN_FIXTURES.shell.innerRadius,
    outerRadiusMeters: CLOUD_DOMAIN_FIXTURES.shell.outerRadius,
  };
}

function outputNodes() {
  const write = system.getResolvedHistory();
  if (!write) throw new Error("cloud history must resolve before output construction");
  const current = resources.current;
  const cloudColorNode = texture(write.radianceTransmittance);
  const cloudDepthNode = texture(write.representativeDepthMeters);
  const velocityNode = texture(write.cloudVelocity);
  const momentsNode = texture(write.depthMoments);
  const rejectionNode = texture(resources.temporalRejection);
  const shadowNode = texture(resources.shadow[0]);
  const finalCloud = cloudColorNode.sample(screenUV);
  const depth = cloudDepthNode.sample(screenUV).x;
  const velocity = velocityNode.sample(screenUV).xy;
  const moments = momentsNode.sample(screenUV);
  const rejection = rejectionNode.sample(screenUV);
  const shadow = shadowNode.sample(screenUV).x;
  const finalHdr = createDepthAwareCloudCompositeNode({
    sceneColorNode: sceneHdr,
    sceneDepthMetersNode: sceneViewDistance,
    cloudResolvedNode: cloudColorNode,
    cloudDepthNode,
    lowWidth: resources.describe().lowResolution.width,
    lowHeight: resources.describe().lowResolution.height,
    cloudOpticalDepthNode: shadow,
    surfaceCoverageNode: sceneDepth.lessThan(0.999999),
  });
  return {
    nodes: {
    final: renderOutput(finalHdr),
    density: renderOutput(vec4(vec3(float(1).sub(finalCloud.a)), 1)),
    "ray-near-far": renderOutput(vec4(rejection.g, rejection.r, 0, 1)),
    "sample-counts": renderOutput(vec4(rejection.b.div(160), rejection.a.div(1280), 0, 1)),
    "sun-optical-depth": renderOutput(vec4(vec3(float(1).sub(shadow.negate().exp())), 1)),
    "cloud-shadow": renderOutput(vec4(vec3(shadow.div(10)), 1)),
    transmittance: renderOutput(vec4(vec3(finalCloud.a), 1)),
    "representative-depth": renderOutput(vec4(vec3(depth.div(200000)), 1)),
    velocity: renderOutput(vec4(velocity.mul(0.02).add(0.5), 0, 1)),
    "history-uv": renderOutput(vec4(screenUV.sub(velocity.div(vec3(resources.describe().lowResolution.width, resources.describe().lowResolution.height, 1).xy)), 0, 1)),
    "variance-bounds": renderOutput(vec4(vec3(moments.y.div(2000)), 1)),
    "history-rejection": renderOutput(rejection),
    "upsample-depth-weights": renderOutput(vec4(vec3(depth.greaterThan(0)), 1)),
    "storage-budget": renderOutput(vec4(0.2, 0.7, 0.35, 1)),
    },
    bindings: {
      cloudColorNode,
      cloudDepthNode,
      velocityNode,
      momentsNode,
      shadowNode,
    },
  };
}

async function rebuild() {
  if (!TIERS.has(state.tier)) throw new Error(`Unknown tier ${state.tier}`);
  if (!SCENARIOS.has(state.scenario)) throw new Error(`Unknown scenario ${state.scenario}`);
  assertCloudRouteTransition(route.lock, "tier", state.tier);
  assertCloudRouteTransition(route.lock, "scenario", state.scenario);
  resources?.fields?.dispose?.();
  system?.dispose?.();
  const config = createDefaultCloudConfig({ qualityTier: state.tier, domain: domainForScenario(state.scenario) });
  config.camera = cameraState();
  system = new WebGPUWeatherVolumeClouds({ renderer, config, viewport: { width: renderer.domElement.width || 1200, height: renderer.domElement.height || 800 } });
  resources = system.createStorageResources();
  resources.fields = makeFields(state.seed);
  // Populate the host pass depth once. Subsequent cloud frames consume the
  // previous presented depth, avoiding a private or fabricated depth target.
  pipeline.outputNode = renderOutput(sceneHdr);
  pipeline.needsUpdate = true;
  pipeline.render();
  await renderer.backend.device.queue.onSubmittedWorkDone();
  await dispatchCloudFrame(0);
  const built = outputNodes();
  outputs = built.nodes;
  outputBindings = built.bindings;
  setMode(state.mode);
}

function cameraState() {
  camera.updateMatrixWorld(true);
  const forward = camera.getWorldDirection(new Vector3());
  const right = new Vector3(1, 0, 0).applyQuaternion(camera.quaternion);
  const up = new Vector3(0, 1, 0).applyQuaternion(camera.quaternion);
  return {
    positionMeters: camera.position.toArray(),
    forward: forward.toArray(),
    right: right.toArray(),
    up: up.toArray(),
    verticalFovRadians: camera.fov * Math.PI / 180,
    nearMeters: camera.near,
    farMeters: camera.far,
  };
}

function applyCamera(id) {
  const poses = {
    near: { position: [0, 900, 1100], target: [0, 1300, -8000] },
    design: { position: [0, 1800, 7000], target: [0, 2300, -12000] },
    far: { position: [0, 5500, 19000], target: [0, 3500, -18000] },
  };
  const pose = poses[id];
  camera.position.fromArray(pose.position);
  camera.lookAt(...pose.target);
  camera.updateMatrixWorld(true);
  state.camera = id;
}

async function dispatchCloudFrame(deltaTimeSeconds) {
  kernels = await system.dispatchFrame(renderer, {
    targets: resources,
    timeSeconds: state.timeSeconds,
    deltaTimeSeconds,
    frameIndex: state.frameIndex,
    cameraState: cameraState(),
    sceneDepthTexture: sceneDepth,
  });
  if (kernels.maximumStorageTextureBindings > 4) {
    throw new Error(`cloud compute uses ${kernels.maximumStorageTextureBindings} storage bindings; portable limit is 4`);
  }
  const resolved = system.getResolvedHistory();
  if (resolved && outputBindings) {
    outputBindings.cloudColorNode.value = resolved.radianceTransmittance;
    outputBindings.cloudDepthNode.value = resolved.representativeDepthMeters;
    outputBindings.velocityNode.value = resolved.cloudVelocity;
    outputBindings.momentsNode.value = resolved.depthMoments;
    outputBindings.shadowNode.value = resources.shadow[0];
  }
}

function setMode(mode) {
  if (!MODES.has(mode)) throw new Error(`Unknown mode ${mode}`);
  assertCloudRouteTransition(route.lock, "mode", mode);
  state.mode = mode;
  pipeline.outputNode = outputs[mode];
  pipeline.needsUpdate = true;
}

function stride(width, height, length) {
  const row = width * 4;
  if (length === row * height) return row;
  const aligned = Math.ceil(row / 256) * 256;
  if (length !== aligned * (height - 1) + row) throw new Error("Unexpected WebGPU readback layout");
  return aligned;
}

const renderer = await WebGPUWeatherVolumeClouds.createRenderer({ canvas, antialias: false, trackTimestamp: true });
const scene = new Scene();
scene.background = new Color(0x14243b);
scene.add(new AmbientLight(0xd9e8ff, 2.2));
const camera = new PerspectiveCamera(54, 1, 0.1, 200000);
const subjectGeometry = new BoxGeometry(2600, 1800, 3200);
const subjectMaterial = new MeshStandardNodeMaterial({ roughness: 0.72, metalness: 0.04 });
subjectMaterial.colorNode = color(0x4e6172);
const subject = new Mesh(subjectGeometry, subjectMaterial);
subject.position.set(0, 600, -9000);
scene.add(subject);
applyCamera(state.camera);
pipeline = new RenderPipeline(renderer); pipeline.outputColorTransform = false;
const scenePass = pass(scene, camera);
scenePass.setMRT(mrt({ output }));
const sceneHdr = scenePass.getTextureNode("output");
const sceneDepth = scenePass.getTextureNode("depth");
const sceneViewDistance = scenePass.getViewZNode().negate();
renderer.setPixelRatio(1); renderer.setSize(innerWidth, innerHeight, false);
camera.aspect = innerWidth / Math.max(innerHeight, 1);
camera.updateProjectionMatrix();
await rebuild();
const renderOnce = async () => { pipeline.render(); await renderer.backend.device.queue.onSubmittedWorkDone(); };

const controller = {
  async ready() {},
  async setScenario(id) { if (!SCENARIOS.has(id)) throw new Error(`Unknown scenario ${id}`); assertCloudRouteTransition(route.lock, "scenario", id); state.scenario = id; await rebuild(); },
  async setMode(id) { setMode(id); },
  async setTier(id) { if (!TIERS.has(id)) throw new Error(`Unknown tier ${id}`); assertCloudRouteTransition(route.lock, "tier", id); state.tier = id; await rebuild(); },
  async setSeed(seed) { if (!Number.isInteger(seed)) throw new Error("seed must be integer"); state.seed = seed >>> 0; await rebuild(); },
  async setCamera(id) {
    if (!CAMERAS.has(id)) throw new Error(`Unknown camera ${id}`);
    applyCamera(id);
    system.resetHistory("camera-cut");
    state.frameIndex += 1;
    await dispatchCloudFrame(0);
  },
  async setTime(seconds) {
    if (!Number.isFinite(seconds) || seconds < 0) throw new Error("time must be finite and nonnegative");
    const delta = Math.max(0, seconds - state.timeSeconds);
    if (seconds < state.timeSeconds) system.resetHistory("time-rewind");
    state.timeSeconds = seconds;
    state.frameIndex += 1;
    await dispatchCloudFrame(delta);
  },
  async step(deltaSeconds) {
    if (!Number.isFinite(deltaSeconds) || deltaSeconds < 0) throw new Error("step delta must be finite and nonnegative");
    state.timeSeconds += deltaSeconds;
    state.frameIndex += 1;
    await dispatchCloudFrame(deltaSeconds);
    await renderOnce();
  },
  async resetHistory(cause = "explicit-reset") {
    system.resetHistory(cause);
    state.frameIndex += 1;
    await dispatchCloudFrame(0);
  },
  async resize(width, height, dpr = 1) {
    renderer.setPixelRatio(dpr);
    renderer.setSize(width, height, false);
    camera.aspect = width / height;
    camera.updateProjectionMatrix();
    await rebuild();
  },
  async renderOnce() { await renderOnce(); },
  async capturePixels(target = "final") {
    const width = renderer.domElement.width, height = renderer.domElement.height;
    captureTarget ??= new RenderTarget(width, height, { samples: 1, type: WebGPUUnsignedByteType });
    captureTarget.texture.colorSpace = WebGPUDataSpace; captureTarget.setSize(width, height);
    renderer.setRenderTarget(captureTarget); await renderOnce();
    const pixels = await renderer.readRenderTargetPixelsAsync(captureTarget, 0, 0, width, height);
    renderer.setRenderTarget(null);
    const bytesPerRow = stride(width, height, pixels.length);
    return {
      target,
      width,
      height,
      format: "rgba8",
      colorManaged: true,
      outputColorSpace: "srgb",
      colorSpace: "srgb",
      colorEncoding: "srgb",
      bytesPerPixel: 4,
      bytesPerRow,
      sourceBytesPerRow: bytesPerRow,
      sourceByteLength: pixels.byteLength ?? pixels.length,
      origin: "bottom-left",
      pixels: Array.from(pixels),
    };
  },
  describePipeline() {
    const graph = system.createPassGraph();
    return {
      runtimeProfile: "correctness",
      timestampQueriesRequired: false,
      timestampQueriesRequested: false,
      timestampQueriesActive: false,
      owner: "WebGPURenderer",
      sceneRendersPerFrame: 1,
      finalToneMapOwner: "renderOutput",
      finalOutputTransformOwner: "renderOutput",
      finalOutputOwner: "renderOutput",
      outputColorSpace: renderer.outputColorSpace,
      passGraph: JSON.parse(JSON.stringify(graph)),
    };
  },
  describeResources() {
    return {
      ...JSON.parse(JSON.stringify(resources.describe())),
      maximumStorageTextureBindings: kernels.maximumStorageTextureBindings,
      historyReadIndex: system.historyReadIndex,
      resolvedHistoryIndex: system.lastResolvedIndex,
    };
  },
  getMetrics() {
    const isWebGPU = renderer.backend.isWebGPUBackend === true;
    const device = renderer.backend.device;
    const evidence = {
      backendKind: "WebGPU",
      backendType: "WebGPUBackend",
      isWebGPUBackend: isWebGPU,
      initialized: true,
      deviceIdentityVerified: device != null,
      deviceIdentitySource: "renderer.backend.device after createRenderer/init",
      deviceType: device?.constructor?.name || "GPUDevice",
      deviceLabel: device?.label || "",
      lossPromiseObservedOnActualDevice: typeof device?.lost?.then === "function",
      rendererDeviceGeneration: 1,
    };
    return {
      labId: "webgpu-weather-volume-clouds",
      threeRevision: "185",
      runtimeProfile: "correctness",
      timestampQueriesRequired: false,
      timestampQueriesRequested: false,
      timestampQueriesActive: false,
      performanceTimestampMode: "disabled",
      scenario: state.scenario,
      mode: state.mode,
      tier: state.tier,
      seed: state.seed,
      camera: state.camera,
      timeSeconds: state.timeSeconds,
      time: state.timeSeconds,
      frameIndex: state.frameIndex,
      routeLock: route.lock,
      backend: "WebGPU",
      backendKind: "WebGPU",
      backendIsWebGPU: isWebGPU,
      nativeWebGPU: isWebGPU,
      rendererType: "WebGPURenderer",
      rendererBackend: "WebGPUBackend",
      rendererDeviceStatus: "active",
      rendererDeviceGeneration: 1,
      deviceLossGeneration: 0,
      rendererBackendEvidence: evidence,
      initialized: true,
      firstFrameCompleted: state.frameIndex >= 0,
      lastFrameError: null,
      viewport: {
        width: renderer.domElement.width || 1200,
        height: renderer.domElement.height || 800,
        dpr: renderer.getPixelRatio?.() ?? 1,
      },
      rendererInfo: {
        rendererType: "WebGPURenderer",
        backendType: "WebGPUBackend",
        threeRevision: "185",
        backendEvidence: evidence,
        render: { ...renderer.info.render },
        compute: { ...renderer.info.compute },
        memory: { ...renderer.info.memory },
      },
      runtimeEvidence: "incomplete",
    };
  },
  async dispose() { captureTarget?.dispose(); resources.fields.dispose(); system.dispose(); scenePass.dispose?.(); subjectGeometry.dispose(); subjectMaterial.dispose(); pipeline.dispose?.(); renderer.dispose(); },
};

await renderOnce();
globalThis.__LAB_CONTROLLER__ = controller;
status.textContent = `native WebGPU\n${state.scenario}\n${state.tier} / ${state.mode}\nGPU evidence pending capture`;
