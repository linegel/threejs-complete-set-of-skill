import {
  ClampToEdgeWrapping,
  HalfFloatType,
  LinearFilter,
  MirroredRepeatWrapping,
  NoColorSpace,
  RGBAFormat,
  StorageTexture,
  Vector4,
  WebGPURenderer,
  RenderPipeline,
} from "three/webgpu";
import {
  Fn,
  float,
  mrt,
  pass,
  renderOutput,
  storageTexture,
  textureStore,
  uv,
  vec2,
  vec3,
  vec4,
} from "three/tsl";

const tslSymbols = {
  Fn,
  float,
  vec2,
  vec3,
  vec4,
  uv,
  pass,
  mrt,
  renderOutput,
  storageTexture,
  textureStore,
};

void tslSymbols;

export const DEFAULT_FROST_SETTINGS = Object.freeze({
  decaySurvivalPerSecond: 0.92,
  depositPerSecond: 0.94,
  maxDeltaSeconds: 1 / 15,
  diffusionCoefficient: 0.08,
  diffusionEnabled: true,
  visibleNoiseStrength: 0.16,
  tiltNoiseStrength: 0.06,
  brushRadius: 0.16,
  sideFade: 0.35,
  cornerFade: 0.55,
  blurResolutionScale: 0.4,
  mainScreenPeriod: 1200,
  detailScreenPeriod: 350,
  mainNormalStrength: 0.3,
  detailNormalStrength: 2.0,
  ior: 1.31,
  thickness: 1.0,
  sourceInset: 0.17,
  FresnelStrength: 0.8,
});

export const FROST_DEBUG_VIEWS = Object.freeze([
  "scene color",
  "vertical blur",
  "horizontal blur",
  "frost noise",
  "frozen structure",
  "highlight structure",
  "previous history R/A",
  "deposit R/A",
  "next history R/A",
  "frost mask before pointer",
  "frost mask after pointer",
  "sharp/blur mix",
  "main refraction offset",
  "detail refraction offset",
  "final without refraction",
  "final",
  "pause",
  "singleStep",
]);

export function clampDeltaSeconds(deltaSeconds, maxDeltaSeconds = DEFAULT_FROST_SETTINGS.maxDeltaSeconds) {
  if (!Number.isFinite(deltaSeconds) || deltaSeconds <= 0) {
    return 0;
  }
  return Math.min(deltaSeconds, maxDeltaSeconds);
}

export function survivalFactor(decaySurvivalPerSecond, deltaSeconds) {
  return decaySurvivalPerSecond ** deltaSeconds;
}

export function depositScale(depositPerSecond, deltaSeconds) {
  return 1 - (1 - depositPerSecond) ** deltaSeconds;
}

export function laplacianDiffusion({
  center,
  left,
  right,
  up,
  down,
  coefficient = DEFAULT_FROST_SETTINGS.diffusionCoefficient,
  deltaSeconds,
}) {
  const laplacian = left + right + up + down - 4 * center;
  return center + laplacian * coefficient * deltaSeconds;
}

export function visibleSignatureForFrameRates(frameRates = [30, 60, 120]) {
  return frameRates.map((fps) => ({
    fps,
    expected: "same fixed pointer path converges within tolerance",
    wrongIf: "per-frame decay makes lower FPS clear faster or higher FPS over-deposit",
  }));
}

export function updateHistorySample({
  previousR,
  previousA,
  pointerActive = true,
  pressure = 1,
  visibleDeposit = 1,
  tiltDeposit = 0.65,
  deltaSeconds,
  settings = DEFAULT_FROST_SETTINGS,
}) {
  const dt = clampDeltaSeconds(deltaSeconds, settings.maxDeltaSeconds);
  const survival = survivalFactor(settings.decaySurvivalPerSecond, dt);
  const deposit = pointerActive
    ? depositScale(settings.depositPerSecond, dt) * pressure
    : 0;
  const visible = previousR * survival;
  const tilt = previousA * survival;
  const nextR = Math.min(1, visible + (1 - visible) * visibleDeposit * deposit);
  const nextA = Math.min(1, tilt + (1 - tilt) * tiltDeposit * deposit);

  return {
    r: nextR,
    g: nextR,
    b: nextR,
    a: nextA,
    previous: { r: previousR, a: previousA },
    deposit: { r: visibleDeposit * deposit, a: tiltDeposit * deposit },
    dt,
    survival,
  };
}

export function simulateHeldPointer({
  fps,
  seconds = 1,
  settings = DEFAULT_FROST_SETTINGS,
}) {
  const frames = Math.round(fps * seconds);
  let state = { r: 0, a: 0 };
  for (let frame = 0; frame < frames; frame += 1) {
    const next = updateHistorySample({
      previousR: state.r,
      previousA: state.a,
      deltaSeconds: 1 / fps,
      settings,
    });
    state = { r: next.r, a: next.a };
  }
  return state;
}

export function computeDispatchSize(width, height, tileSize = 8) {
  return {
    x: Math.ceil(width / tileSize),
    y: Math.ceil(height / tileSize),
    count: Math.ceil(width / tileSize) * Math.ceil(height / tileSize),
    tileSize,
  };
}

export function estimateHistoryStorageBytes(width, height) {
  const rgba16fBytes = 8;
  return {
    historyRead: width * height * rgba16fBytes,
    historyWrite: width * height * rgba16fBytes,
    total: width * height * rgba16fBytes * 2,
  };
}

export function createHistoryStorageDescriptor(width, height) {
  return {
    className: StorageTexture.name,
    width,
    height,
    type: HalfFloatType,
    format: RGBAFormat,
    colorSpace: "NoColorSpace",
    threeColorSpace: NoColorSpace,
    minFilter: LinearFilter,
    magFilter: LinearFilter,
    wrapS: ClampToEdgeWrapping,
    wrapT: ClampToEdgeWrapping,
    generateMipmaps: false,
  };
}

export function createStaticTextureDescriptor(asset) {
  return {
    id: asset.id,
    colorSpace: "NoColorSpace",
    threeColorSpace: NoColorSpace,
    wrapS: MirroredRepeatWrapping,
    wrapT: MirroredRepeatWrapping,
    minFilter: LinearFilter,
    magFilter: LinearFilter,
    generateMipmaps: false,
  };
}

export function createTwoScaleRefractionContract(settings = DEFAULT_FROST_SETTINGS) {
  return {
    mainScreenPeriod: settings.mainScreenPeriod,
    detailScreenPeriod: settings.detailScreenPeriod,
    mainNormalStrength: settings.mainNormalStrength,
    detailNormalStrength: settings.detailNormalStrength,
    heightWeight: "detail refraction is weighted by main-normal height",
    Fresnel: "linear-light Fresnel/sourceInset mask before output conversion",
    sourceInset: settings.sourceInset,
    IOR: settings.ior,
    thickness: settings.thickness,
    maskGate: "structural frost alpha * inverse visible history",
  };
}

export function saveRendererState(renderer) {
  const viewport = new Vector4();
  const scissor = new Vector4();
  return {
    renderTarget: renderer.getRenderTarget?.(),
    viewport: renderer.getViewport?.(viewport),
    scissor: renderer.getScissor?.(scissor),
    clearColor: renderer.getClearColor?.({}),
    clearAlpha: renderer.getClearAlpha?.(),
    autoClear: renderer.autoClear,
    xrEnabled: renderer.xr?.enabled,
    restore() {
      renderer.setRenderTarget?.(this.renderTarget);
      if (this.viewport) renderer.setViewport?.(this.viewport);
      if (this.scissor) renderer.setScissor?.(this.scissor);
      if (this.clearColor) renderer.setClearColor?.(this.clearColor, this.clearAlpha);
      renderer.autoClear = this.autoClear;
      if (renderer.xr) renderer.xr.enabled = this.xrEnabled;
    },
  };
}

export class WebGPUTouchHistoryFrostEffect {
  constructor({
    width = 1920,
    height = 1080,
    settings = DEFAULT_FROST_SETTINGS,
    renderer,
    renderPipeline,
  } = {}) {
    this.width = width;
    this.height = height;
    this.settings = { ...settings };
    this.renderer = renderer;
    this.renderPipeline = renderPipeline;
    this.historyRead = createHistoryStorageDescriptor(width, height);
    this.historyWrite = createHistoryStorageDescriptor(width, height);
    this.debugView = "final";
    this.pause = false;
    this.singleStep = false;
    this.outputNode = "RenderPipeline.outputNode owns frost composite/refraction";
  }

  static async createRenderer(options = {}) {
    const renderer = new WebGPURenderer(options);
    await renderer.init();
    return renderer;
  }

  createFrameGraph() {
    return [
      "input events for this frame",
      "Fn().compute(count) history update writes StorageTexture with textureStore",
      "swap history read/write",
      "scene pass via pass(scene, camera)",
      "vertical blur PassNode setResolutionScale",
      "horizontal blur PassNode setResolutionScale",
      "static crystalline fields",
      "full-resolution frost/thaw composite",
      "two-scale TSL refraction",
      "one RenderPipeline.render() owner",
    ];
  }

  createResourcePlan() {
    return {
      historyRead: this.historyRead,
      historyWrite: this.historyWrite,
      dispatch: computeDispatchSize(this.width, this.height),
      storageBytes: estimateHistoryStorageBytes(this.width, this.height),
      blur: {
        vertical: { setResolutionScale: this.settings.blurResolutionScale },
        horizontal: { setResolutionScale: this.settings.blurResolutionScale },
      },
      refraction: createTwoScaleRefractionContract(this.settings),
      debugViews: FROST_DEBUG_VIEWS,
    };
  }

  async dispatchHistoryCompute(computeNode) {
    if (typeof this.renderer?.computeAsync === "function") {
      return this.renderer.computeAsync(computeNode);
    }
    return this.renderer?.compute(computeNode);
  }

  setSize(width, height, { clearHistory = true } = {}) {
    this.width = width;
    this.height = height;
    this.historyRead = createHistoryStorageDescriptor(width, height);
    this.historyWrite = createHistoryStorageDescriptor(width, height);
    this.historyClearedOnResize = clearHistory;
  }

  dispose() {
    this.historyRead.disposed = true;
    this.historyWrite.disposed = true;
    this.disposed = true;
  }
}

export function createWebGPUTouchHistoryFrostEffect(options = {}) {
  return new WebGPUTouchHistoryFrostEffect(options);
}

export const CANONICAL_IMPORTS = Object.freeze({
  WebGPURenderer: WebGPURenderer.name,
  RenderPipeline: RenderPipeline.name,
  StorageTexture: StorageTexture.name,
  Fn: "Fn(",
  textureStore: "textureStore",
  storageTexture: "storageTexture",
  outputNode: "outputNode",
});
