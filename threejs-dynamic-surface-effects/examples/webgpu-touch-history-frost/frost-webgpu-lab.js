import {
  AmbientLight,
  BoxGeometry,
  Color,
  DirectionalLight,
  Mesh,
  MeshStandardNodeMaterial,
  PerspectiveCamera,
  REVISION,
  RendererUtils,
  RenderTarget,
  Scene,
  SphereGeometry,
  UnsignedByteType,
  Vector2,
  WebGPURenderer,
} from "three/webgpu";
import { color } from "three/tsl";

import {
  FROST_MECHANISMS,
  FROST_QUALITY_TIERS,
  createWebGPUTouchHistoryFrostEffect,
} from "./frost-surface-effect.js";

export const FROST_MODE_TO_DEBUG_VIEW = Object.freeze({
  final: "final",
  "no-post": "scene color",
  diagnostics: "next history R/A",
  "scene-color": "scene color",
  "vertical-blur": "vertical blur",
  "horizontal-blur": "horizontal blur",
  "frost-noise": "frost noise",
  "frozen-structure": "frozen structure",
  "highlight-structure": "highlight structure",
  "previous-history-ra": "previous history R/A",
  "deposit-ra": "deposit R/A",
  "next-history-ra": "next history R/A",
  "frost-mask-before-pointer": "frost mask before pointer",
  "frost-mask-after-pointer": "frost mask after pointer",
  "sharp-blur-mix": "sharp/blur mix",
  "main-refraction-offset": "main refraction offset",
  "detail-refraction-offset": "detail refraction offset",
  "final-without-refraction": "final without refraction",
});

export const FROST_LAB_MODES = Object.freeze(Object.keys(FROST_MODE_TO_DEBUG_VIEW));
export const FROST_LAB_ID = "webgpu-touch-history-frost";
export const FROST_SCENARIO_ID = "touch-history-frost";
const FROST_RUNTIME_PROFILES = Object.freeze(["correctness", "performance"]);

const FROST_DEBUG_VIEW_TO_MODE = Object.freeze(Object.fromEntries(
  Object.entries(FROST_MODE_TO_DEBUG_VIEW).map(([mode, debugView]) => [debugView, mode]),
));

export function parseFrostLabRoute(pathname = "/", search = "") {
  const params = new URLSearchParams(search);
  const segments = pathname.split("/").filter(Boolean);
  const mechanismIndex = segments.lastIndexOf("mechanism");
  const tierIndex = segments.lastIndexOf("tier");
  const mechanism = params.get("mechanism")
    ?? (mechanismIndex >= 0 ? segments[mechanismIndex + 1] : null)
    ?? "history-and-deposit";
  const tier = params.get("tier")
    ?? (tierIndex >= 0 ? segments[tierIndex + 1] : null)
    ?? "balanced";
  if (!FROST_MECHANISMS.includes(mechanism)) {
    throw new RangeError(`unknown frost mechanism "${mechanism}"`);
  }
  if (!FROST_QUALITY_TIERS[tier]) throw new RangeError(`unknown frost tier "${tier}"`);
  return { mechanism, tier };
}

function createBackdropScene() {
  const scene = new Scene();
  scene.background = new Color(0x101829);
  scene.add(new AmbientLight(0xa8c8ed, 1.35));
  const sun = new DirectionalLight(0xffe2bd, 3.8);
  sun.position.set(4, 8, 5);
  scene.add(sun);

  const objects = [];
  const boxGeometry = new BoxGeometry(2.4, 2.4, 2.4, 4, 4, 4);
  const boxMaterial = new MeshStandardNodeMaterial({ roughness: 0.32, metalness: 0.12 });
  boxMaterial.colorNode = color(0xe46f56);
  const box = new Mesh(boxGeometry, boxMaterial);
  box.position.set(-2.3, 0.1, 0);
  box.rotation.set(0.5, 0.7, 0.1);
  scene.add(box);
  objects.push({ mesh: box, geometry: boxGeometry, material: boxMaterial });

  const sphereGeometry = new SphereGeometry(1.45, 48, 28);
  const sphereMaterial = new MeshStandardNodeMaterial({ roughness: 0.2, metalness: 0.58 });
  sphereMaterial.colorNode = color(0x56aee4);
  const sphere = new Mesh(sphereGeometry, sphereMaterial);
  sphere.position.set(2.1, 0.35, -0.3);
  scene.add(sphere);
  objects.push({ mesh: sphere, geometry: sphereGeometry, material: sphereMaterial });

  const floorGeometry = new BoxGeometry(10, 0.3, 7);
  const floorMaterial = new MeshStandardNodeMaterial({ roughness: 0.78, metalness: 0 });
  floorMaterial.colorNode = color(0x31404f);
  const floor = new Mesh(floorGeometry, floorMaterial);
  floor.position.y = -1.55;
  scene.add(floor);
  objects.push({ mesh: floor, geometry: floorGeometry, material: floorMaterial });

  return {
    scene,
    objects,
    dispose() {
      for (const object of objects) {
        object.geometry.dispose();
        object.material.dispose();
      }
    },
  };
}

export class WebGPUFrostLab {
  constructor({
    canvas,
    tier = "balanced",
    mechanism = "history-and-deposit",
    seed = 1,
    runtimeProfile = "correctness",
  } = {}) {
    this.canvas = canvas;
    if (!FROST_RUNTIME_PROFILES.includes(runtimeProfile)) {
      throw new RangeError(`unknown frost runtime profile "${runtimeProfile}"`);
    }
    this.runtimeProfile = runtimeProfile;
    this.scenario = FROST_SCENARIO_ID;
    this.tier = FROST_QUALITY_TIERS[tier];
    if (!this.tier) throw new RangeError(`unknown frost tier "${tier}"`);
    if (!FROST_MECHANISMS.includes(mechanism)) throw new RangeError(`unknown frost mechanism "${mechanism}"`);
    this.mechanism = mechanism;
    this.seed = seed >>> 0;
    this.mode = "final";
    this.cameraId = "design";
    this.pointer = {
      start: { x: 0.5, y: 0.5 },
      end: { x: 0.5, y: 0.5 },
      pressure: 0,
      active: false,
    };
    this.time = 0;
  }

  async initialize() {
    const timestampQueriesRequested = this.runtimeProfile === "performance";
    this.renderer = new WebGPURenderer({
      canvas: this.canvas,
      antialias: false,
      trackTimestamp: timestampQueriesRequested,
    });
    await this.renderer.init();
    if (this.renderer.backend?.isWebGPUBackend !== true) {
      throw new Error("WebGPU is required for the canonical dynamic-surface path");
    }
    this.rendererDevice = this.renderer.backend.device ?? null;
    if (!this.rendererDevice) throw new Error("Native WebGPU backend did not expose its initialized GPUDevice");
    this.rendererDeviceGeneration = 1;
    this.deviceLossGeneration = 0;
    this.rendererDeviceStatus = "active";
    this.deviceLostObserved = false;
    this.lossPromiseObservedOnActualDevice = Boolean(this.rendererDevice.lost?.then);
    if (this.lossPromiseObservedOnActualDevice) {
      this.rendererDevice.lost.then(() => {
        if (this.rendererDeviceStatus === "disposing" || this.rendererDeviceStatus === "disposed") return;
        this.deviceLostObserved = true;
        this.deviceLossGeneration += 1;
        this.rendererDeviceStatus = "lost";
      });
    }
    const width = Math.max(1, this.canvas?.clientWidth || this.canvas?.width || 1200);
    const height = Math.max(1, this.canvas?.clientHeight || this.canvas?.height || 800);
    this.renderer.setSize(width, height, false);
    this.backdrop = createBackdropScene();
    this.scene = this.backdrop.scene;
    this.camera = new PerspectiveCamera(48, width / height, 0.1, 100);
    this.camera.position.set(0, 1.2, 10.2);
    this.camera.lookAt(0, 0, 0);
    this.effect = createWebGPUTouchHistoryFrostEffect({
      renderer: this.renderer,
      scene: this.scene,
      camera: this.camera,
      width,
      height,
      tier: this.tier.id,
      mechanism: this.mechanism,
      seed: this.seed,
    });
    await this.effect.initialize();
    this.renderPipeline = this.effect.renderPipeline;
    this.mode = FROST_DEBUG_VIEW_TO_MODE[this.effect.debugView] ?? "final";
    this.initialized = true;
    return this;
  }

  async ready() {
    if (!this.initialized) await this.initialize();
  }

  async setScenario(id) {
    if (id !== FROST_SCENARIO_ID) throw new RangeError(`unknown frost scenario "${id}"`);
    this.scenario = id;
  }

  async setMechanism(id) {
    if (!FROST_MECHANISMS.includes(id)) throw new RangeError(`unknown frost mechanism "${id}"`);
    this.mechanism = id;
    const profile = this.effect.setMechanism(id);
    this.mode = FROST_DEBUG_VIEW_TO_MODE[profile.startupDebugView] ?? "final";
  }

  async setMode(id) {
    if (!FROST_LAB_MODES.includes(id)) throw new RangeError(`unknown frost mode "${id}"`);
    this.effect.setDebugView(FROST_MODE_TO_DEBUG_VIEW[id]);
    this.mode = id;
  }

  async setTier(id) {
    const tier = FROST_QUALITY_TIERS[id];
    if (!tier) throw new RangeError(`unknown frost tier "${id}"`);
    this.tier = tier;
    this.effect.setTier(id);
    this.mode = FROST_DEBUG_VIEW_TO_MODE[this.effect.debugView] ?? "final";
  }

  async setSeed(seed) {
    if (!Number.isInteger(seed) || seed < 0 || seed > 0xffffffff) {
      throw new RangeError("frost seed must be a uint32 integer");
    }
    this.seed = this.effect.setSeed(seed);
  }

  async setCamera(id) {
    const poses = {
      near: { position: [0, 0.6, 6.1], target: [0, 0, 0] },
      design: { position: [0, 1.2, 10.2], target: [0, 0, 0] },
      far: { position: [0, 3.8, 17], target: [0, 0, 0] },
    };
    const pose = poses[id];
    if (!pose) throw new RangeError(`unknown frost camera "${id}"`);
    this.cameraId = id;
    this.camera.position.fromArray(pose.position);
    this.camera.lookAt(...pose.target);
  }

  async setTime(seconds) {
    if (!Number.isFinite(seconds) || seconds < 0) throw new RangeError("frost time must be nonnegative");
    this.time = seconds;
  }

  queuePointerSegment(start, end, pressure, active = true) {
    this.pointer.start = { x: start.x, y: start.y };
    this.pointer.end = { x: end.x, y: end.y };
    this.pointer.pressure = Math.min(1, Math.max(0, pressure));
    this.pointer.active = active;
  }

  async step(deltaSeconds) {
    this.time += deltaSeconds;
    const metrics = this.effect.advanceFrame({
      deltaSeconds,
      segmentStart: this.pointer.start,
      segmentEnd: this.pointer.end,
      pressure: this.pointer.pressure,
      active: this.pointer.active,
      render: false,
    });
    this.pointer.start = { ...this.pointer.end };
    this.pointer.active = false;
    this.pointer.pressure = 0;
    return metrics;
  }

  async resetHistory() {
    this.effect.setSize(this.effect.displayWidth, this.effect.displayHeight, { clearHistory: true });
  }

  async resize(width, height, dpr = 1) {
    if (![width, height, dpr].every(Number.isFinite) || width <= 0 || height <= 0 || dpr <= 0) {
      throw new RangeError("frost resize dimensions and DPR must be positive");
    }
    this.renderer.setPixelRatio(dpr);
    this.renderer.setSize(width, height, false);
    const drawingSize = this.renderer.getDrawingBufferSize(new Vector2());
    const drawingWidth = Math.max(1, Math.trunc(drawingSize.x));
    const drawingHeight = Math.max(1, Math.trunc(drawingSize.y));
    this.effect.setSize(drawingWidth, drawingHeight, { clearHistory: true });
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
  }

  async renderOnce() {
    this.renderPipeline.render();
  }

  async capturePixels(target = "final") {
    if (target !== "final" && target !== "presentation") {
      throw new RangeError(`unknown frost capture target "${target}"`);
    }
    const size = this.renderer.getDrawingBufferSize(new Vector2());
    const width = Math.trunc(size.x);
    const height = Math.trunc(size.y);
    const renderTarget = new RenderTarget(width, height, { type: UnsignedByteType, samples: 1 });
    const state = RendererUtils.saveRendererState(this.renderer);
    let pixels;
    try {
      this.renderer.setRenderTarget(renderTarget);
      this.renderPipeline.render();
      pixels = await this.renderer.readRenderTargetPixelsAsync(renderTarget, 0, 0, width, height);
    } finally {
      RendererUtils.restoreRendererState(this.renderer, state);
      renderTarget.dispose();
    }
    const rowBytes = width * 4;
    const alignedBytesPerRow = Math.ceil(rowBytes / 256) * 256;
    const paddedLength = alignedBytesPerRow * (height - 1) + rowBytes;
    const bytesPerRow = pixels.length >= paddedLength ? alignedBytesPerRow : rowBytes;
    if (!Number.isInteger(bytesPerRow) || bytesPerRow < rowBytes) {
      throw new Error(`invalid WebGPU readback stride ${bytesPerRow} for row ${rowBytes}`);
    }
    return {
      target,
      width,
      height,
      format: "rgba8unorm",
      outputColorSpace: this.renderer.outputColorSpace,
      bytesPerPixel: 4,
      bytesPerRow,
      pixels,
    };
  }

  describePipeline() {
    const resources = this.effect.createResourcePlan();
    const computeDispatches = [{
      id: "history-update",
      workgroupSize: [8, 8, 1],
      updatePolicy: resources.graph.updatePolicy,
      diffusion: resources.graph.diffusion,
    }];
    if (resources.benchmarkLedger) {
      computeDispatches.push({
        id: "benchmark-ledger",
        workgroupSize: [1, 1, 1],
        updatePolicy: resources.graph.updatePolicy,
        diffusion: false,
      });
    }
    return {
      runtimeProfile: this.runtimeProfile,
      performanceTimestampMode: this.runtimeProfile === "performance" ? "auto" : "disabled",
      timestampQueriesRequired: this.runtimeProfile === "performance",
      timestampQueriesRequested: this.runtimeProfile === "performance",
      timestampQueriesActive: this.runtimeProfile === "performance" &&
        this.renderer.backend?.trackTimestamp === true &&
        this.renderer.hasFeature?.("timestamp-query") === true,
      owners: {
        renderer: "threejs-dynamic-surface-effects",
        scenePass: "host-scene",
        history: "threejs-dynamic-surface-effects",
        finalPipeline: "threejs-dynamic-surface-effects",
        toneMap: "RenderOutputNode",
        outputTransform: "RenderOutputNode",
      },
      signals: resources.graph.reachableNodes,
      sceneSubmissions: [{ id: "shared-scene-pass", count: 1 }],
      computeDispatches,
      finalToneMapOwner: "RenderOutputNode",
      finalOutputTransformOwner: "RenderOutputNode",
    };
  }

  describeResources() {
    return this.effect.createResourcePlan();
  }

  getAvailableModes() {
    return [...this.effect.availableDebugViews]
      .map((view) => FROST_DEBUG_VIEW_TO_MODE[view])
      .filter(Boolean);
  }

  getMetrics() {
    const timestampQueriesRequested = this.runtimeProfile === "performance";
    const timestampQueriesActive = timestampQueriesRequested &&
      this.renderer.backend?.trackTimestamp === true &&
      this.renderer.hasFeature?.("timestamp-query") === true;
    const deviceIdentityVerified = this.rendererDevice !== null &&
      this.rendererDevice === this.renderer.backend?.device;
    const viewportSize = this.renderer.getSize(new Vector2());
    return {
      ...this.effect.getMetrics(),
      labId: FROST_LAB_ID,
      threeRevision: REVISION,
      runtimeProfile: this.runtimeProfile,
      performanceTimestampMode: timestampQueriesRequested ? "auto" : "disabled",
      timestampQueriesRequired: timestampQueriesRequested,
      timestampQueriesRequested,
      timestampQueriesActive,
      nativeWebGPU: this.renderer.backend?.isWebGPUBackend === true,
      initialized: this.initialized === true,
      backend: "WebGPU",
      backendKind: "WebGPU",
      rendererBackend: "WebGPUBackend",
      rendererDeviceStatus: this.rendererDeviceStatus,
      rendererDeviceGeneration: this.rendererDeviceGeneration,
      deviceLossGeneration: this.deviceLossGeneration,
      deviceLostObserved: this.deviceLostObserved,
      rendererBackendEvidence: {
        backendKind: "WebGPU",
        backendType: "WebGPUBackend",
        isWebGPUBackend: this.renderer.backend?.isWebGPUBackend === true,
        deviceIdentityVerified,
        deviceIdentitySource: "exact retained renderer.backend.device reference after renderer.init()",
        deviceType: this.rendererDevice?.constructor?.name || "GPUDevice",
        lossPromiseObservedOnActualDevice: this.lossPromiseObservedOnActualDevice,
        rendererDeviceGeneration: this.rendererDeviceGeneration,
      },
      rendererInfo: {
        rendererType: "WebGPURenderer",
        backendType: "WebGPUBackend",
        threeRevision: REVISION,
      },
      backendIsWebGPU: this.renderer.backend?.isWebGPUBackend === true,
      scenario: this.scenario,
      mechanism: this.mechanism,
      mode: this.mode,
      camera: this.cameraId,
      seed: this.seed,
      timeSeconds: this.time,
      viewport: {
        width: viewportSize.x,
        height: viewportSize.y,
        dpr: this.renderer.getPixelRatio(),
      },
    };
  }

  async dispose() {
    this.renderer?.setAnimationLoop(null);
    this.rendererDeviceStatus = "disposing";
    this.effect?.dispose();
    this.backdrop?.dispose();
    this.renderer?.dispose();
    this.rendererDeviceStatus = "disposed";
    this.disposed = true;
  }

  get labId() {
    return FROST_LAB_ID;
  }
}

export async function createFrostLab(options) {
  const lab = new WebGPUFrostLab(options);
  await lab.initialize();
  return lab;
}
