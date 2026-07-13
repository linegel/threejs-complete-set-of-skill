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
  UnsignedByteType,
  Vector4,
  WebGPURenderer,
} from "three/webgpu";
import {
  color,
  emissive,
  mrt,
  normalView,
  output,
  pass,
  renderOutput,
  select,
  uniform,
} from "three/tsl";

import {
  bindWebGPUDeviceIdentity,
  captureRuntimeProfileFields,
  markWebGPUDeviceDisposed,
  markWebGPUDeviceDisposing,
  webgpuDeviceIdentityMetrics,
} from "../../../labs/runtime/webgpu-device-identity.mjs";
import {
  createPrecipitationImagePipelineIntegration,
  createWeatherIntegrationSignals,
} from "./precipitation-image-pipeline-integration.js";
import {
  INTEGRATION_CAMERAS,
  INTEGRATION_MECHANISMS,
  INTEGRATION_MODES,
  INTEGRATION_SCENARIOS,
  INTEGRATION_TIERS,
  MECHANISM_RUNTIME,
  SCENARIO_MECHANISM,
  requireIntegrationChoice,
} from "./route-state.mjs";

const LAB_ID = "integration-precipitation-image-pipeline";
const OWNER_ID = `${LAB_ID}/host`;
const MODE_INDEX = new Map(INTEGRATION_MODES.map((id, index) => [id, index]));

export function resolvePrecipitationIntegrationReadbackStride(pixels, width, height) {
  const rowBytes = width * 4 * pixels.BYTES_PER_ELEMENT;
  if (height <= 1 || pixels.byteLength === rowBytes * height) return rowBytes;
  const aligned = Math.ceil(rowBytes / 256) * 256;
  if (pixels.byteLength === aligned * height || pixels.byteLength === aligned * (height - 1) + rowBytes) return aligned;
  const inferred = (pixels.byteLength - rowBytes) / (height - 1);
  if (!Number.isInteger(inferred) || inferred < rowBytes) throw new Error(`invalid WebGPU readback stride ${inferred}`);
  return inferred;
}

function makeStableOutput(sceneColor, modeNode, weatherNode, ownerNode) {
  return select(
    modeNode.equal(MODE_INDEX.get("owner-graph")),
    ownerNode,
    select(modeNode.equal(MODE_INDEX.get("weather-state")), weatherNode, sceneColor),
  );
}

export class PrecipitationImagePipelineBrowserHost {
  constructor({ canvas, route } = {}) {
    if (!canvas) throw new TypeError("precipitation integration browser host requires a canvas");
    this.canvas = canvas;
    this.route = route;
    this.scenario = requireIntegrationChoice(route.scenario, INTEGRATION_SCENARIOS, "scenario");
    this.mechanism = route.mechanism;
    this.runtimeMechanism = route.runtimeMechanism;
    this.tier = requireIntegrationChoice(route.tier, INTEGRATION_TIERS, "tier");
    this.mode = requireIntegrationChoice(route.mode, INTEGRATION_MODES, "mode");
    this.cameraId = requireIntegrationChoice(route.camera, INTEGRATION_CAMERAS, "camera");
    this.seed = route.seed >>> 0;
    this.time = 0;
    this.initialized = false;
    this.disposed = false;
  }

  get labId() { return LAB_ID; }

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
      throw new Error("precipitation integration requires native WebGPU; fallback is blocked");
    }
    this.deviceIdentity = bindWebGPUDeviceIdentity(this.renderer);
    this.renderer.toneMapping = AgXToneMapping;
    this.renderer.toneMappingExposure = 1;
    const width = Math.max(1, this.canvas.clientWidth || this.canvas.width || 1200);
    const height = Math.max(1, this.canvas.clientHeight || this.canvas.height || 800);
    this.renderer.setPixelRatio(Math.min(globalThis.devicePixelRatio || 1, 1.5));
    this.renderer.setSize(width, height, false);

    this.scene = new Scene();
    this.scene.background = new Color(0x101822);
    this.camera = new PerspectiveCamera(48, width / height, 0.15, 160);
    this.camera.position.set(9, 5.5, 13);
    this.camera.lookAt(0, 1.2, 0);
    this.scene.add(new AmbientLight(0xacc7e8, 1.25));
    this.keyLight = new DirectionalLight(0xffefcf, 4);
    this.keyLight.position.set(8, 14, 6);
    this.scene.add(this.keyLight);
    const markerMaterial = new MeshStandardNodeMaterial();
    markerMaterial.colorNode = color(0x607a94);
    this.marker = new Mesh(new BoxGeometry(2.2, 2.2, 2.2), markerMaterial);
    this.marker.position.set(0, 1.1, -3.5);
    this.scene.add(this.marker);

    this.scenePass = pass(this.scene, this.camera);
    this.scenePass.setMRT(mrt({ output, normal: normalView, emissive }));
    const sceneColor = this.scenePass.getTextureNode("output");
    const depth = this.scenePass.getTextureNode("depth");
    this.modeNode = uniform(MODE_INDEX.get(this.mode), "int");
    this.weatherDiagnostic = uniform(new Vector4(0, 0, 0, 1));
    this.ownerDiagnostic = uniform(new Vector4(1, 1, 0, 1));
    const stableLinearOutput = makeStableOutput(sceneColor, this.modeNode, this.weatherDiagnostic, this.ownerDiagnostic);
    this.renderPipeline = new RenderPipeline(this.renderer);
    this.renderPipeline.outputColorTransform = false;
    this.renderPipeline.outputNode = renderOutput(stableLinearOutput);

    const weatherSignals = createWeatherIntegrationSignals();
    this.host = {
      ownerId: OWNER_ID,
      renderer: this.renderer,
      renderPipeline: this.renderPipeline,
      scene: this.scene,
      camera: this.camera,
      scenePass: this.scenePass,
      sceneSubmissionCount: 1,
      weatherSignals,
      signals: {
        ...weatherSignals,
        sceneColor,
        depth,
      },
      owners: {
        renderer: OWNER_ID,
        scenePass: OWNER_ID,
        weather: OWNER_ID,
        toneMap: OWNER_ID,
        outputTransform: OWNER_ID,
      },
      finalToneMapOwner: OWNER_ID,
      finalOutputTransformOwner: OWNER_ID,
    };
    await this.rebuildIntegration();
    this.applyMode(this.mode);
    this.applyCamera(this.cameraId);
    await this.renderer.compileAsync(this.scene, this.camera);
    await this.scenePass.compileAsync(this.renderer);
    this.initialized = true;
  }

  async rebuildIntegration() {
    this.integration?.dispose();
    this.integration = createPrecipitationImagePipelineIntegration({
      host: this.host,
      tier: this.tier,
      mechanism: this.runtimeMechanism,
      seed: this.seed,
    });
    this.applyMode(this.mode);
    this.renderPipeline.needsUpdate = true;
  }

  applyMode(id) {
    this.mode = requireIntegrationChoice(id, INTEGRATION_MODES, "mode");
    this.modeNode.value = MODE_INDEX.get(this.mode);
    if (!this.integration) return;
    const { rain, snow, surfaces, impacts } = this.integration;
    const profile = this.integration.mechanismProfile;
    const mechanismView = this.mode === "final" || this.mode === "weather-state";
    rain.mesh.visible = this.mode === "particles" || (mechanismView && profile.rain);
    snow.mesh.visible = ["particles", "snow"].includes(this.mode) || (mechanismView && profile.snow);
    surfaces.road.visible = this.mode === "wetness" || (mechanismView && profile.road);
    surfaces.snow.visible = this.mode === "snow" || (mechanismView && profile.snowReceiver);
    surfaces.snowOccluder.visible = surfaces.snow.visible;
    impacts.mesh.visible = this.mode === "impacts" || (mechanismView && profile.impacts);
  }

  applyCamera(id) {
    this.cameraId = requireIntegrationChoice(id, INTEGRATION_CAMERAS, "camera");
    const positions = { near: [5.5, 3.4, 7], design: [9, 5.5, 13], far: [16, 9, 23] };
    this.camera.position.fromArray(positions[this.cameraId]);
    this.camera.lookAt(0, 1.1, -1.5);
    this.host?.weatherSignals.cameraPosition.value.copy(this.camera.position);
  }

  async setScenario(id) {
    this.scenario = requireIntegrationChoice(id, INTEGRATION_SCENARIOS, "scenario");
    this.runtimeMechanism = SCENARIO_MECHANISM[this.scenario];
    await this.rebuildIntegration();
  }

  async setMode(id) { this.applyMode(id); }

  async setTier(id) {
    const tier = requireIntegrationChoice(id, INTEGRATION_TIERS, "tier");
    if (tier === this.tier) return;
    this.tier = tier;
    await this.rebuildIntegration();
  }

  async setSeed(seed) {
    if (!Number.isSafeInteger(seed) || seed < 0 || seed > 0xffffffff) throw new RangeError("seed must be u32");
    this.seed = seed >>> 0;
    await this.rebuildIntegration();
  }

  async setCamera(id) { this.applyCamera(id); }

  async setTime(seconds) {
    if (!Number.isFinite(seconds) || seconds < 0 || seconds > 30) throw new RangeError("time must be in [0,30]");
    this.host.weatherSignals.weatherStage.reset();
    this.time = 0;
    const dt = 1 / 60;
    while (this.time + dt <= seconds + 1e-12) await this.step(dt);
    if (seconds - this.time > 1e-12) await this.step(seconds - this.time);
  }

  async step(deltaSeconds) {
    if (!Number.isFinite(deltaSeconds) || deltaSeconds < 0) throw new RangeError("deltaSeconds must be nonnegative");
    this.integration.update(deltaSeconds);
    this.time = this.host.weatherSignals.weather.time;
    const weather = this.host.weatherSignals.weather;
    this.weatherDiagnostic.value.set(weather.forcing, weather.wetness, weather.snowCoverage, 1);
  }

  async resetHistory(cause) {
    if (typeof cause !== "string" || cause.length === 0) throw new TypeError("reset cause required");
    this.host.weatherSignals.weatherStage.reset();
    this.time = 0;
  }

  async resize(width, height, dpr = 1) {
    if (![width, height, dpr].every((value) => Number.isFinite(value) && value > 0)) throw new RangeError("invalid resize");
    this.renderer.setPixelRatio(Math.min(dpr, 1.5));
    this.renderer.setSize(width, height, false);
    this.scenePass.setSize(width, height);
    this.captureTarget?.setSize(width, height);
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
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
      const targets = ["output", "normal", "emissive"];
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
      bytesPerRow: resolvePrecipitationIntegrationReadbackStride(pixels, width, height),
    };
  }

  describePipeline() {
    return {
      ...this.integration.describePipeline(),
      ...captureRuntimeProfileFields(),
      hostOutputNodeStable: true,
      outputColorTransform: this.renderPipeline.outputColorTransform,
      toneMapping: "AgXToneMapping",
    };
  }

  describeResources() {
    const rt = this.scenePass.renderTarget;
    return {
      precipitation: this.integration.getMetrics(),
      renderTargets: rt.textures.map((texture, index) => ({ id: ["output", "normal", "emissive"][index], width: rt.width, height: rt.height, type: texture.type })),
      depth: { width: rt.width, height: rt.height },
      rendererMemory: this.renderer.info.memory,
    };
  }

  getMetrics() {
    return {
      labId: this.labId,
      status: "native-webgpu-runtime; evidence incomplete",
      ...webgpuDeviceIdentityMetrics(this.deviceIdentity, this.renderer),
      threeRevision: REVISION,
      scenario: this.scenario,
      mechanism: this.mechanism,
      runtimeMechanism: this.runtimeMechanism,
      tier: this.tier,
      mode: this.mode,
      camera: this.cameraId,
      cameraId: this.cameraId,
      seed: this.seed,
      time: this.time,
      timeSeconds: this.time,
      routeSelection: { labId: this.labId, scenario: this.scenario, mechanism: this.mechanism, tier: this.tier },
      integration: this.integration.getMetrics(),
      currentAdapterTiming: "INSUFFICIENT_EVIDENCE",
      viewport: {
        width: this.renderer.domElement.width,
        height: this.renderer.domElement.height,
        dpr: this.renderer.getPixelRatio(),
      },
    };
  }

  async dispose() {
    if (this.disposed) return;
    this.disposed = true;
    markWebGPUDeviceDisposing(this.deviceIdentity);
    this.renderer?.setAnimationLoop(null);
    this.integration?.dispose();
    this.marker?.geometry.dispose();
    this.marker?.material.dispose();
    this.captureTarget?.dispose();
    this.renderPipeline?.dispose?.();
    this.renderer?.dispose();
    markWebGPUDeviceDisposed(this.deviceIdentity);
  }
}
