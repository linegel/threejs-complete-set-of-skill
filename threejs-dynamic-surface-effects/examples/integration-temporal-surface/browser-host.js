import {
  AgXToneMapping,
  AmbientLight,
  BoxGeometry,
  Color,
  DirectionalLight,
  HalfFloatType,
  Mesh,
  MeshStandardNodeMaterial,
  PerspectiveCamera,
  RenderPipeline,
  RendererUtils,
  RenderTarget,
  REVISION,
  Scene,
  SphereGeometry,
  TempNode,
  UnsignedByteType,
  Vector4,
  WebGPURenderer,
} from "three/webgpu";
import {
  color,
  mrt,
  output,
  pass,
  renderOutput,
  uniform,
  vec4,
  velocity,
} from "three/tsl";

import { createTemporalSurfaceIntegration } from "./temporal-surface-integration.js";
import {
  TEMPORAL_CAMERAS,
  TEMPORAL_MECHANISMS,
  TEMPORAL_MODES,
  TEMPORAL_SCENARIOS,
  TEMPORAL_TIERS,
  requireTemporalChoice,
} from "./route-state.mjs";

const OWNER_ID = "integration-temporal-surface/host";

class MutableSceneLinearNode extends TempNode {
  constructor(sourceNode) {
    super("vec4");
    this.sourceNode = sourceNode;
  }

  setSource(sourceNode) {
    this.sourceNode = sourceNode;
    this.needsUpdate = true;
  }

  setup() { return this.sourceNode; }
}

class HostResetRegistry {
  constructor(capacity = 32) {
    this.capacity = capacity;
    this.records = [];
    this.sequence = 0;
  }

  record(entry) {
    const record = Object.freeze({ sequence: ++this.sequence, ...entry });
    if (this.records.length === this.capacity) this.records.shift();
    this.records.push(record);
    return record;
  }
}

export function resolveTemporalIntegrationReadbackStride(pixels, width, height) {
  const rowBytes = width * 4 * pixels.BYTES_PER_ELEMENT;
  if (height <= 1 || pixels.byteLength === rowBytes * height) return rowBytes;
  const aligned = Math.ceil(rowBytes / 256) * 256;
  if (pixels.byteLength === aligned * height || pixels.byteLength === aligned * (height - 1) + rowBytes) return aligned;
  const inferred = (pixels.byteLength - rowBytes) / (height - 1);
  if (!Number.isInteger(inferred) || inferred < rowBytes) throw new Error(`invalid WebGPU readback stride ${inferred}`);
  return inferred;
}

export class TemporalSurfaceBrowserHost {
  constructor({ canvas, route } = {}) {
    if (!canvas) throw new TypeError("temporal-surface browser host requires a canvas");
    this.canvas = canvas;
    this.scenario = requireTemporalChoice(route.scenario, TEMPORAL_SCENARIOS, "scenario");
    this.mechanism = route.mechanism === null ? null : requireTemporalChoice(route.mechanism, TEMPORAL_MECHANISMS, "mechanism");
    this.tier = requireTemporalChoice(route.tier, TEMPORAL_TIERS, "tier");
    this.mode = requireTemporalChoice(route.mode, TEMPORAL_MODES, "mode");
    this.cameraId = requireTemporalChoice(route.camera, TEMPORAL_CAMERAS, "camera");
    this.seed = route.seed >>> 0;
    this.time = 0;
    this.initialized = false;
    this.disposed = false;
  }

  async ready() {
    if (this.initialized) return;
    this.renderer = new WebGPURenderer({
      canvas: this.canvas,
      antialias: false,
      outputBufferType: HalfFloatType,
      reversedDepthBuffer: true,
      trackTimestamp: true,
    });
    await this.renderer.init();
    if (this.renderer.backend?.isWebGPUBackend !== true) {
      throw new Error("temporal-surface integration requires native WebGPU; fallback is blocked");
    }
    this.renderer.toneMapping = AgXToneMapping;
    this.renderer.toneMappingExposure = 1;
    const width = Math.max(1, this.canvas.clientWidth || this.canvas.width || 1200);
    const height = Math.max(1, this.canvas.clientHeight || this.canvas.height || 800);
    this.renderer.setPixelRatio(Math.min(globalThis.devicePixelRatio || 1, 1.5));
    this.renderer.setSize(width, height, false);
    this.physicalWidth = this.renderer.domElement.width;
    this.physicalHeight = this.renderer.domElement.height;

    this.scene = new Scene();
    this.scene.background = new Color(0x101829);
    this.camera = new PerspectiveCamera(48, width / height, 0.1, 100);
    this.camera.position.set(0, 1.2, 10.2);
    this.camera.lookAt(0, 0, 0);
    this.scene.add(new AmbientLight(0xa8c8ed, 1.35));
    const sun = new DirectionalLight(0xffe2bd, 3.8);
    sun.position.set(4, 8, 5);
    this.scene.add(sun);

    const boxMaterial = new MeshStandardNodeMaterial({ roughness: 0.32, metalness: 0.12 });
    boxMaterial.colorNode = color(0xe46f56);
    this.box = new Mesh(new BoxGeometry(2.4, 2.4, 2.4, 4, 4, 4), boxMaterial);
    this.box.position.set(-2.3, 0.1, 0);
    this.box.rotation.set(0.5, 0.7, 0.1);
    this.scene.add(this.box);
    const sphereMaterial = new MeshStandardNodeMaterial({ roughness: 0.2, metalness: 0.58 });
    sphereMaterial.colorNode = color(0x56aee4);
    this.sphere = new Mesh(new SphereGeometry(1.45, 48, 28), sphereMaterial);
    this.sphere.position.set(2.1, 0.35, -0.3);
    this.scene.add(this.sphere);

    this.scenePass = pass(this.scene, this.camera);
    this.scenePass.setMRT(mrt({ output, velocity }));
    const sceneColor = this.scenePass.getTextureNode("output");
    const depth = this.scenePass.getTextureNode("depth");
    const velocityNode = this.scenePass.getTextureNode("velocity");
    this.linearProxy = new MutableSceneLinearNode(sceneColor);
    this.renderPipeline = new RenderPipeline(this.renderer);
    this.renderPipeline.outputColorTransform = false;
    this.renderPipeline.outputNode = renderOutput(this.linearProxy);
    this.resetRegistry = new HostResetRegistry();
    this.resetDiagnostic = uniform(new Vector4(0, 0, 0, 1));
    this.ownerDiagnostic = uniform(new Vector4(1, 1, 0, 1));
    this.activeRegistration = null;

    this.host = {
      ownerId: OWNER_ID,
      renderer: this.renderer,
      renderPipeline: this.renderPipeline,
      scenePass: this.scenePass,
      sceneSubmissionCount: 1,
      signals: { sceneColor, depth, velocity: velocityNode, camera: this.camera },
      resetRegistry: this.resetRegistry,
      physicalWidth: this.physicalWidth,
      physicalHeight: this.physicalHeight,
      owners: {
        renderer: OWNER_ID,
        scenePass: OWNER_ID,
        temporalHistory: OWNER_ID,
        jitter: OWNER_ID,
        toneMap: OWNER_ID,
        outputTransform: OWNER_ID,
      },
      finalToneMapOwner: OWNER_ID,
      finalOutputTransformOwner: OWNER_ID,
      registerSceneLinearStage: (registration) => {
        if (this.activeRegistration) throw new Error("host already has a scene-linear feature stage");
        const record = {
          ...registration,
          dispose: () => {
            if (this.activeRegistration !== record) return;
            this.activeRegistration = null;
            this.linearProxy.setSource(sceneColor);
            this.renderPipeline.needsUpdate = true;
          },
        };
        this.activeRegistration = record;
        this.linearProxy.setSource(registration.outputNode);
        this.renderPipeline.needsUpdate = true;
        return record;
      },
    };

    this.hostVelocityDiagnostic = vec4(velocityNode.xy.mul(0.5).add(0.5), 0, 1);
    await this.rebuildIntegration();
    if (this.scenario === "host-temporal-reset-coupling" || this.mechanism === "host-reset-registry") {
      await this.resetHistory("locked-route-reset-coupling");
    }
    this.applyCamera(this.cameraId);
    this.applyMode(this.mode);
    await this.renderer.compileAsync(this.scene, this.camera);
    await this.scenePass.compileAsync(this.renderer);
    this.initialized = true;
  }

  async rebuildIntegration() {
    this.integration?.dispose();
    this.host.physicalWidth = this.physicalWidth;
    this.host.physicalHeight = this.physicalHeight;
    this.integration = await createTemporalSurfaceIntegration({ host: this.host, tier: this.tier });
    this.applyMode(this.mode);
  }

  modeNode(id) {
    const debug = this.integration.compositeStage.debugNodes;
    if (id === "host-scene-color") return this.host.signals.sceneColor;
    if (id === "surface-history") return this.integration.computeStage.historyNode;
    if (id === "frost-mask") return debug["frost mask after pointer"];
    if (id === "refraction") return debug["main refraction offset"];
    if (id === "host-velocity") return this.hostVelocityDiagnostic;
    if (id === "reset-reason") return this.resetDiagnostic;
    if (id === "owner-graph") return this.ownerDiagnostic;
    return this.integration.compositeStage.outputNode;
  }

  applyMode(id) {
    this.mode = requireTemporalChoice(id, TEMPORAL_MODES, "mode");
    if (!this.integration) return;
    this.linearProxy.setSource(this.modeNode(this.mode));
    this.renderPipeline.needsUpdate = true;
  }

  applyCamera(id) {
    this.cameraId = requireTemporalChoice(id, TEMPORAL_CAMERAS, "camera");
    const poses = { near: [0, 0.6, 6.1], design: [0, 1.2, 10.2], far: [0, 3.8, 17] };
    this.camera.position.fromArray(poses[this.cameraId]);
    this.camera.lookAt(0, 0, 0);
  }

  async setScenario(id) {
    this.scenario = requireTemporalChoice(id, TEMPORAL_SCENARIOS, "scenario");
    if (id === "host-temporal-reset-coupling") await this.resetHistory("scenario-host-temporal-reset-coupling");
  }

  async setMode(id) { this.applyMode(id); }

  async setTier(id) {
    const tier = requireTemporalChoice(id, TEMPORAL_TIERS, "tier");
    if (tier === this.tier) return;
    this.tier = tier;
    await this.rebuildIntegration();
  }

  async setSeed(seed) {
    if (!Number.isSafeInteger(seed) || seed < 0 || seed > 0xffffffff) throw new RangeError("seed must be u32");
    this.seed = seed >>> 0;
    await this.resetHistory("seed-change");
  }

  async setCamera(id) { this.applyCamera(id); }

  async setTime(seconds) {
    if (!Number.isFinite(seconds) || seconds < 0 || seconds > 30) throw new RangeError("time must be in [0,30]");
    await this.resetHistory("deterministic-seek");
    this.time = 0;
    const dt = 1 / 60;
    while (this.time + dt <= seconds + 1e-12) await this.step(dt);
    if (seconds - this.time > 1e-12) await this.step(seconds - this.time);
  }

  async step(deltaSeconds) {
    if (!Number.isFinite(deltaSeconds) || deltaSeconds < 0) throw new RangeError("deltaSeconds must be nonnegative");
    this.time += deltaSeconds;
    const phase = this.time * 0.37 + (this.seed / 0x100000000) * Math.PI * 2;
    const start = { x: 0.5 + Math.cos(phase) * 0.19, y: 0.5 + Math.sin(phase * 0.83) * 0.17 };
    const end = { x: 0.5 + Math.cos(phase + 0.16) * 0.19, y: 0.5 + Math.sin((phase + 0.16) * 0.83) * 0.17 };
    this.integration.update({ deltaSeconds, segmentStart: start, segmentEnd: end, pressure: 0.72, active: true });
  }

  async resetHistory(cause) {
    this.integration.resetHistory(cause);
    const count = this.resetRegistry.records.length;
    this.resetDiagnostic.value.set(Math.min(1, count / this.resetRegistry.capacity), (this.resetRegistry.sequence % 17) / 16, 0, 1);
  }

  async resize(width, height, dpr = 1) {
    if (![width, height, dpr].every((value) => Number.isFinite(value) && value > 0)) throw new RangeError("invalid resize");
    this.renderer.setPixelRatio(Math.min(dpr, 1.5));
    this.renderer.setSize(width, height, false);
    this.scenePass.setSize(width, height);
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
    this.physicalWidth = this.renderer.domElement.width;
    this.physicalHeight = this.renderer.domElement.height;
    this.host.physicalWidth = this.physicalWidth;
    this.host.physicalHeight = this.physicalHeight;
    this.integration.resize(this.physicalWidth, this.physicalHeight);
    this.captureTarget?.setSize(this.physicalWidth, this.physicalHeight);
    this.renderPipeline.needsUpdate = true;
  }

  async renderOnce() { this.renderPipeline.render(); }

  async capturePixels(target = "presentation") {
    let renderTarget;
    let textureIndex = 0;
    if (target === "presentation") {
      this.captureTarget ??= new RenderTarget(this.renderer.domElement.width, this.renderer.domElement.height, { type: UnsignedByteType });
      const state = RendererUtils.saveRendererState(this.renderer);
      try {
        this.renderer.setRenderTarget(this.captureTarget);
        this.renderPipeline.render();
      } finally {
        RendererUtils.restoreRendererState(this.renderer, state);
      }
      renderTarget = this.captureTarget;
    } else {
      const targets = ["output", "velocity"];
      textureIndex = targets.indexOf(target);
      if (textureIndex < 0) throw new RangeError(`unknown capture target "${target}"`);
      await this.renderOnce();
      renderTarget = this.scenePass.renderTarget;
    }
    const width = renderTarget.width;
    const height = renderTarget.height;
    const pixels = await this.renderer.readRenderTargetPixelsAsync(renderTarget, 0, 0, width, height, textureIndex);
    return {
      target,
      width,
      height,
      format: "rgba8unorm",
      outputColorSpace: this.renderer.outputColorSpace,
      bytesPerPixel: 4,
      pixels,
      bytesPerRow: resolveTemporalIntegrationReadbackStride(pixels, width, height),
    };
  }

  describePipeline() {
    return {
      ...this.integration.describePipeline(),
      hostOutputNodeStable: true,
      registeredSceneLinearStage: this.activeRegistration?.id ?? null,
      outputColorTransform: this.renderPipeline.outputColorTransform,
      toneMapping: "AgXToneMapping",
    };
  }

  describeResources() {
    const target = this.scenePass.renderTarget;
    return {
      surface: this.integration.computeStage.describeResources(),
      renderTargets: target.textures.map((texture, index) => ({ id: ["output", "velocity"][index], width: target.width, height: target.height, type: texture.type })),
      depth: { width: target.width, height: target.height },
      resetRegistry: { capacity: this.resetRegistry.capacity, count: this.resetRegistry.records.length },
    };
  }

  getMetrics() {
    return {
      status: "native-webgpu-runtime; evidence incomplete",
      rendererBackend: this.renderer.backend?.isWebGPUBackend === true ? "WebGPU" : "unsupported",
      threeRevision: REVISION,
      scenario: this.scenario,
      mechanism: this.mechanism,
      tier: this.tier,
      mode: this.mode,
      camera: this.cameraId,
      seed: this.seed,
      time: this.time,
      routeSelection: { scenario: this.scenario, mechanism: this.mechanism, tier: this.tier },
      integration: this.integration.getMetrics(),
      currentAdapterTiming: "INSUFFICIENT_EVIDENCE",
    };
  }

  async dispose() {
    if (this.disposed) return;
    this.disposed = true;
    this.renderer?.setAnimationLoop(null);
    this.integration?.dispose();
    for (const mesh of [this.box, this.sphere]) {
      mesh?.geometry.dispose();
      mesh?.material.dispose();
    }
    this.captureTarget?.dispose();
    this.renderPipeline?.dispose?.();
    this.renderer?.dispose();
  }
}
