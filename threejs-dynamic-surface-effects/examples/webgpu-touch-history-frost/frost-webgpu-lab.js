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
import {
  FROST_ALL_CAPTURE_RECIPES,
  FROST_CAPTURE_RECIPES,
  FROST_COVERAGE_PROBE_RECIPES,
  resolveFrostCaptureRecipe,
} from "./capture-recipes.js";
import {
  canonicalFrostEvidenceJson,
  runFrostCaptureTransaction,
  sha256FrostEvidence,
} from "./capture-transaction.js";

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
const FROST_CAMERA_POSES = Object.freeze({
  near: Object.freeze({ position: Object.freeze([0, 0.6, 6.1]), target: Object.freeze([0, 0, 0]) }),
  design: Object.freeze({ position: Object.freeze([0, 1.2, 10.2]), target: Object.freeze([0, 0, 0]) }),
  far: Object.freeze({ position: Object.freeze([0, 3.8, 17]), target: Object.freeze([0, 0, 0]) }),
});

const FROST_DEBUG_VIEW_TO_MODE = Object.freeze(Object.fromEntries(
  Object.entries(FROST_MODE_TO_DEBUG_VIEW).map(([mode, debugView]) => [debugView, mode]),
));

function applyFrostCameraPose(camera, id) {
  const pose = FROST_CAMERA_POSES[id];
  if (!pose) throw new RangeError(`unknown frost camera "${id}"`);
  camera.position.fromArray(pose.position);
  camera.lookAt(...pose.target);
}

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
    this.captureTransactionActive = null;
    this.captureTransactionPoison = null;
    this.captureTransactionSequence = 0;
    this.captureRecipeSetDigest = null;
    this.captureTargetSequence = 0;
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
    applyFrostCameraPose(this.camera, "design");
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
    this.captureRecipeSetDigest = await sha256FrostEvidence(FROST_ALL_CAPTURE_RECIPES);
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
    applyFrostCameraPose(this.camera, id);
    this.cameraId = id;
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

  async #capturePipelinePixels(pipeline, { target, captureMode = null, width = null, height = null } = {}) {
    const size = this.renderer.getDrawingBufferSize(new Vector2());
    const captureWidth = width ?? Math.trunc(size.x);
    const captureHeight = height ?? Math.trunc(size.y);
    if (!Number.isInteger(captureWidth) || !Number.isInteger(captureHeight) || captureWidth <= 0 || captureHeight <= 0) {
      throw new RangeError("Frost capture target dimensions must be positive integers");
    }
    const renderTarget = new RenderTarget(captureWidth, captureHeight, {
      type: UnsignedByteType,
      samples: 1,
      depthBuffer: false,
      stencilBuffer: false,
    });
    const captureTargetId = `frost-capture-target-${++this.captureTargetSequence}`;
    const artifactTarget = Object.freeze({
      kind: "render-target",
      rendererDeviceGeneration: this.rendererDeviceGeneration,
      captureTargetId,
      colorTextureUuid: renderTarget.texture.uuid,
      width: captureWidth,
      height: captureHeight,
      format: "rgba8unorm",
      sampleCount: 1,
      depthBuffer: false,
      stencilBuffer: false,
    });
    const state = RendererUtils.saveRendererState(this.renderer);
    let pixels;
    try {
      this.renderer.setRenderTarget(renderTarget);
      pipeline.render();
      pixels = await this.renderer.readRenderTargetPixelsAsync(renderTarget, 0, 0, captureWidth, captureHeight);
    } finally {
      RendererUtils.restoreRendererState(this.renderer, state);
      renderTarget.dispose();
    }
    const rowBytes = captureWidth * 4;
    const alignedBytesPerRow = Math.ceil(rowBytes / 256) * 256;
    const paddedLength = alignedBytesPerRow * (captureHeight - 1) + rowBytes;
    const bytesPerRow = pixels.length >= paddedLength ? alignedBytesPerRow : rowBytes;
    if (!Number.isInteger(bytesPerRow) || bytesPerRow < rowBytes) {
      throw new Error(`invalid WebGPU readback stride ${bytesPerRow} for row ${rowBytes}`);
    }
    return Object.freeze({
      artifactTarget,
      capture: Object.freeze({
        target,
        ...(captureMode === null ? {} : { captureMode }),
        width: captureWidth,
        height: captureHeight,
        format: "rgba8unorm",
        outputColorSpace: this.renderer.outputColorSpace,
        bytesPerPixel: 4,
        bytesPerRow,
        pixels,
      }),
    });
  }

  async capturePixels(target = "final") {
    if (target !== "final" && target !== "presentation") {
      throw new RangeError(`unknown frost capture target "${target}"`);
    }
    const { capture } = await this.#capturePipelinePixels(this.renderPipeline, { target });
    return capture;
  }

  #captureParentSnapshot() {
    const viewport = this.renderer.getSize(new Vector2());
    const evidence = Object.freeze({
      route: Object.freeze({
        scenario: this.scenario,
        mechanism: this.mechanism,
        tier: this.tier.id,
        mode: this.mode,
        camera: this.cameraId,
        seed: this.seed,
        timeSeconds: this.time,
      }),
      viewport: Object.freeze({ width: viewport.x, height: viewport.y, dpr: this.renderer.getPixelRatio() }),
      camera: Object.freeze({
        position: Object.freeze(this.camera.position.toArray()),
        quaternion: Object.freeze(this.camera.quaternion.toArray()),
        projectionMatrix: Object.freeze(this.camera.projectionMatrix.toArray()),
      }),
      history: Object.freeze({
        historyA: this.effect.historyA.uuid,
        historyB: this.effect.historyB.uuid,
        readTexture: this.effect.historyRead.uuid,
        writeTexture: this.effect.historyWrite.uuid,
        readNode: this.effect.historyReadTextureNode.uuid,
        writeNode: this.effect.historyWriteTextureNode.uuid,
        readSlot: this.effect.readSlot,
        frame: this.effect.frame,
      }),
      pipeline: Object.freeze({
        renderPipeline: this.renderPipeline.uuid ?? this.renderPipeline.constructor.name,
        outputNode: this.renderPipeline.outputNode?.uuid ?? this.renderPipeline.outputNode?.constructor?.name ?? null,
        outputColorTransform: this.renderPipeline.outputColorTransform,
      }),
      device: Object.freeze({
        generation: this.rendererDeviceGeneration,
        status: this.rendererDeviceStatus,
        lossGeneration: this.deviceLossGeneration,
      }),
    });
    return Object.freeze({
      evidence,
      refs: Object.freeze({
        rendererDevice: this.rendererDevice,
        renderPipeline: this.renderPipeline,
        outputNode: this.renderPipeline.outputNode,
        historyA: this.effect.historyA,
        historyB: this.effect.historyB,
        historyRead: this.effect.historyRead,
        historyWrite: this.effect.historyWrite,
        historyReadNode: this.effect.historyReadTextureNode,
        historyWriteNode: this.effect.historyWriteTextureNode,
      }),
    });
  }

  #verifyCaptureParent(entry) {
    const restored = this.#captureParentSnapshot();
    if (canonicalFrostEvidenceJson(restored.evidence) !== canonicalFrostEvidenceJson(entry.evidence)) {
      throw new Error("Frost capture transaction changed parent state or resource evidence");
    }
    for (const key of Object.keys(entry.refs)) {
      if (restored.refs[key] !== entry.refs[key]) {
        throw new Error(`Frost capture transaction changed parent ${key} identity`);
      }
    }
    return restored.evidence;
  }

  describeCaptureRecipes() {
    if (!this.captureRecipeSetDigest) throw new Error("Frost capture recipes are unavailable before ready()");
    return Object.freeze({
      schemaVersion: 1,
      recipeSetDigest: this.captureRecipeSetDigest,
      recipes: FROST_CAPTURE_RECIPES,
      coverageProbes: FROST_COVERAGE_PROBE_RECIPES,
    });
  }

  async captureRecipe(id) {
    const recipe = resolveFrostCaptureRecipe(id);
    if (this.captureTransactionPoison !== null) {
      throw new Error(`Frost capture controller is poisoned: ${this.captureTransactionPoison.message}`);
    }
    if (this.captureTransactionActive !== null) {
      throw new Error(`Frost capture transaction ${this.captureTransactionActive} is already active`);
    }
    const sequence = ++this.captureTransactionSequence;
    this.captureTransactionActive = recipe.id;
    let scratch = null;
    try {
      const transaction = await runFrostCaptureTransaction({
        recipeId: recipe.id,
        snapshot: async () => this.#captureParentSnapshot(),
        execute: async () => {
          const camera = this.camera.clone();
          applyFrostCameraPose(camera, recipe.camera);
          camera.aspect = recipe.viewport.width / recipe.viewport.height;
          camera.updateProjectionMatrix();
          scratch = createWebGPUTouchHistoryFrostEffect({
            renderer: this.renderer,
            scene: this.scene,
            camera,
            width: recipe.viewport.physicalWidth,
            height: recipe.viewport.physicalHeight,
            tier: recipe.tier,
            mechanism: recipe.mechanism,
            seed: recipe.seed,
          });
          await scratch.initialize();
          scratch.setDebugView(FROST_MODE_TO_DEBUG_VIEW[recipe.target]);
          for (const step of recipe.trace) {
            scratch.advanceFrame({
              deltaSeconds: step.deltaSeconds,
              segmentStart: step.start,
              segmentEnd: step.end,
              pressure: step.pressure,
              active: true,
              render: false,
            });
          }
          const readback = await this.#capturePipelinePixels(scratch.renderPipeline, {
            target: recipe.id,
            captureMode: recipe.target,
            width: recipe.viewport.physicalWidth,
            height: recipe.viewport.physicalHeight,
          });
          await this.rendererDevice.queue.onSubmittedWorkDone();
          const timeSeconds = recipe.expectedTimeSeconds;
          const scratchMetrics = scratch.getMetrics();
          const historyWidth = scratchMetrics.historySize[0];
          const historyHeight = scratchMetrics.historySize[1];
          return Object.freeze({
            readback,
            effectiveState: Object.freeze({
              scenario: recipe.scenario,
              mechanism: recipe.mechanism,
              tier: recipe.tier,
              mode: recipe.target,
              camera: recipe.camera,
              seed: recipe.seed,
              timeSeconds,
              viewport: Object.freeze({
                width: recipe.viewport.width,
                height: recipe.viewport.height,
                dpr: recipe.viewport.dpr,
                physicalWidth: readback.capture.width,
                physicalHeight: readback.capture.height,
              }),
            }),
            execution: Object.freeze({
              pointerSegmentCount: recipe.trace.length,
              computeDispatchDelta: recipe.trace.length,
              renderSubmissionDelta: 1,
              sameFrameComposite: true,
              historyExtent: Object.freeze({ width: historyWidth, height: historyHeight }),
              workgroupSize: Object.freeze([8, 8, 1]),
              workgroupCount: Object.freeze([scratchMetrics.dispatch.x, scratchMetrics.dispatch.y, 1]),
              coveredExtent: Object.freeze({
                width: scratchMetrics.dispatch.x * 8,
                height: scratchMetrics.dispatch.y * 8,
              }),
              boundsChecked: true,
            }),
          });
        },
        cleanup: async () => {
          scratch?.dispose();
          scratch = null;
        },
        verify: async (entry) => this.#verifyCaptureParent(entry),
        poison: async (error) => {
          this.captureTransactionPoison = Object.freeze({ recipeId: recipe.id, message: String(error.message ?? error) });
        },
      });
      const recipeDigest = await sha256FrostEvidence(recipe);
      const entryStateDigest = await sha256FrostEvidence(transaction.entry.evidence);
      const effectiveStateDigest = await sha256FrostEvidence(transaction.result.effectiveState);
      const restoredStateDigest = await sha256FrostEvidence(transaction.restored);
      return Object.freeze({
        ...transaction.result.readback.capture,
        evidence: Object.freeze({
          recipe: Object.freeze({
            id: recipe.id,
            schemaVersion: recipe.schemaVersion,
            digest: recipeDigest,
            setDigest: this.captureRecipeSetDigest,
            target: recipe.target,
          }),
          effectiveState: transaction.result.effectiveState,
          execution: transaction.result.execution,
          artifactTarget: transaction.result.readback.artifactTarget,
          transaction: Object.freeze({
            schemaVersion: 1,
            transactionId: `frost-capture-${sequence}`,
            sequence,
            recipeId: recipe.id,
            status: "COMMITTED",
            restorationVerdict: "PASS",
            entryStateDigest,
            effectiveStateDigest,
            restoredStateDigest,
            phaseVerdicts: Object.freeze({ capture: "PASS", restore: "PASS", settle: "PASS", verify: "PASS" }),
          }),
        }),
      });
    } finally {
      this.captureTransactionActive = null;
    }
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
      captureTransaction: {
        active: this.captureTransactionActive,
        poisoned: this.captureTransactionPoison,
        nextSequence: this.captureTransactionSequence + 1,
      },
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
