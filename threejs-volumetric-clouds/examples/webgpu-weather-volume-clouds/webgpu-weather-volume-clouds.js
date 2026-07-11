import {
  FloatType,
  HalfFloatType,
  LinearFilter,
  NearestFilter,
  NoColorSpace,
  RedFormat,
  RGFormat,
  RGBAFormat,
  RenderPipeline,
  Storage3DTexture,
  StorageTexture,
  WebGPURenderer,
} from "three/webgpu";
import {
  Fn,
  mrt,
  pass,
  storageTexture,
  storageTexture3D,
  textureStore,
} from "three/tsl";

import {
  createDefaultCloudConfig,
  estimateCloudStorageBytes,
  validateCloudConfig,
} from "./cloud-config.js";
import { createCloudCompositeContract } from "./cloud-composite.js";
import {
  createTemporalCloudHistoryConfig,
  createTemporalResolveNodes,
} from "./cloud-history.js";
import {
  createCloudAuxiliaryNode,
  createCloudBeautyMarchNode,
  createCloudBeautyNodeContract,
} from "./cloud-nodes.js";
import {
  createCloudShadowCascadeConfig,
  createCloudShadowMarchNode,
} from "./cloud-shadows.js";

const tslRuntimeSymbols = {
  Fn,
  storageTexture,
  storageTexture3D,
  textureStore,
  pass,
  mrt,
};

void tslRuntimeSymbols;

function configureStorageTexture(texture, { format, type, name, filter = LinearFilter }) {
  texture.name = name;
  texture.format = format;
  texture.type = type;
  texture.colorSpace = NoColorSpace;
  texture.minFilter = filter;
  texture.magFilter = filter;
  texture.generateMipmaps = false;
  texture.mipmapsAutoUpdate = false;
  return texture;
}

function storage2D(width, height, descriptor) {
  return configureStorageTexture(
    new StorageTexture(width, height),
    descriptor,
  );
}

export function createCloudStorageResources(config, viewport) {
  const plan = estimateCloudStorageBytes(config, viewport);
  const { width, height } = plan.lowResolution;
  const rgba16f = (name) => storage2D(width, height, {
    format: RGBAFormat,
    type: HalfFloatType,
    name,
  });
  const r32f = (name) => storage2D(width, height, {
    format: RedFormat,
    type: FloatType,
    name,
    filter: NearestFilter,
  });
  const rg16f = (name) => storage2D(width, height, {
    format: RGFormat,
    type: HalfFloatType,
    name,
  });
  const resources = {
    current: {
      radianceTransmittance: rgba16f("cloud-current-radiance-transmittance"),
      representativeDepthMeters: r32f("cloud-current-depth-r32f-meters"),
      cloudVelocity: rg16f("cloud-current-velocity-rg16f"),
      depthMoments: rg16f("cloud-current-depth-moments-rg16f"),
      rejectionMask: rgba16f("cloud-current-diagnostics"),
    },
    history: [0, 1].map((index) => ({
      radianceTransmittance: rgba16f(`cloud-history-${index}-radiance-transmittance`),
      representativeDepthMeters: r32f(`cloud-history-${index}-depth-r32f-meters`),
      cloudVelocity: rg16f(`cloud-history-${index}-velocity-rg16f`),
      depthMoments: rg16f(`cloud-history-${index}-depth-moments-rg16f`),
    })),
    temporalRejection: rgba16f("cloud-temporal-rejection"),
    shadow: [],
  };
  const shadow = createCloudShadowCascadeConfig({
    ...config.cloudShadow,
    tier: config.qualityTier,
  });
  resources.shadow = Array.from({ length: shadow.cascadeCount }, (_, index) =>
    configureStorageTexture(
      new StorageTexture(shadow.resolution, shadow.resolution),
      {
        format: RedFormat,
        type: HalfFloatType,
        name: `cloud-shadow-optical-depth-${index}`,
      },
    ),
  );
  resources.describe = () => ({
    lowResolution: { width, height },
    representativeDepthFormat: "R32F meters",
    representativeDepthFilter: "nearest/non-filtering (portable unfilterable-float sample type)",
    velocityFormat: "RG16F pixels/frame",
    shadowFormat: "R16F optical depth",
    shadowCount: resources.shadow.length,
    derivedBytes: plan.bytes,
    hostDepthSource: "sampled host scene-pass depth; no private constant-depth storage",
  });
  resources.dispose = () => {
    for (const texture of [
      ...Object.values(resources.current),
      ...resources.history.flatMap(Object.values),
      resources.temporalRejection,
      ...resources.shadow,
    ]) texture.dispose();
  };
  return resources;
}

export const WEBGPU_WEATHER_CLOUD_DEBUG_MODES = Object.freeze([
  "final",
  "weatherRGBA",
  "perLayerHeightFractions",
  "packedEmptyIntervals",
  "coverageRemappedDensity",
  "baseShape",
  "detailModifier",
  "turbulenceDisplacement",
  "totalScatteringExtinction",
  "rayNearFarSceneClamp",
  "sampleCounts",
  "sunOpticalDepth",
  "cloudShadowCascade",
  "transmittance",
  "representativeDepth",
  "velocity",
  "historyUV",
  "varianceBounds",
  "historyRejection",
  "upsampleDepthWeights",
  "shadowStructuredSamplingPlanes",
  "storageBudget",
]);

export class WebGPUWeatherVolumeClouds {
  constructor({
    renderer,
    config = createDefaultCloudConfig(),
    assetManifest,
    hostPipeline,
    viewport = { width: 1920, height: 1080 },
  } = {}) {
    this.renderer = renderer;
    this.config = config;
    this.assetManifest = assetManifest;
    this.hostPipeline = hostPipeline;
    this.viewport = viewport;
    this.validation = validateCloudConfig(config, assetManifest);
    this.historyReadIndex = 0;
    this.historyValid = false;
    this.lastResolvedIndex = null;
    this.lastShadowSequence = null;
    this.previousCameraState = structuredClone(config.camera);
    if (!this.validation.ok) {
      throw new Error(
        `Invalid WebGPU weather cloud config:\n${this.validation.errors.join("\n")}`,
      );
    }
  }

  static async createRenderer(options = {}) {
    const renderer = new WebGPURenderer(options);
    await renderer.init();
    if (renderer.backend?.isWebGPUBackend !== true) {
      throw new Error("WebGPU backend unavailable for the weather-volume cloud scaffold.");
    }
    return renderer;
  }

  selectQualityTier() {
    if (this.renderer && this.renderer.backend?.isWebGPUBackend !== true) {
      throw new Error("WebGPU backend unavailable for the weather-volume cloud scaffold.");
    }
    return this.config.qualityTier;
  }

  createResourcePlan() {
    const storage = estimateCloudStorageBytes(this.config, this.viewport);
    const shadow = createCloudShadowCascadeConfig({
      ...this.config.cloudShadow,
      tier: this.config.qualityTier,
    });
    const temporal = createTemporalCloudHistoryConfig({
      fullWidth: this.viewport.width,
      fullHeight: this.viewport.height,
      linearResolutionScale:
        this.config.qualityTiers[this.config.qualityTier].linearResolutionScale,
      responseTimeSeconds: this.config.temporal.responseTimeSeconds,
      depthRejectMeters: this.config.temporal.depthRejectMeters,
      depthRangeMeters: 200000,
      velocityRejectPixels: this.config.temporal.velocityRejectPixels,
      varianceClipSigma: this.config.temporal.varianceClipSigma,
      representativeDepthTarget: this.config.temporal.representativeDepthTarget,
      velocityTarget: this.config.temporal.velocityTarget,
    });

    return {
      storageTextureClass: StorageTexture.name,
      storage3DTextureClass: Storage3DTexture.name,
      current: "StorageTexture RGBA16F current radiance/transmittance",
      depthMotion:
        "allocated separate R32F metric depth, RG16F velocity, and RG16F depth-moment current/read/write slots",
      history: "allocated ping-pong RGBA16F radiance/transmittance slots",
      generatedFields:
        "optional Storage3DTexture shape/detail writes via storageTexture3D",
      shadow,
      temporal,
      storage,
      implementationStatus: "explicit allocation/format/disposal implementation; browser execution evidence required",
    };
  }

  createStorageResources() {
    this.resources?.dispose?.();
    this.resources = createCloudStorageResources(this.config, this.viewport);
    this.historyReadIndex = 0;
    this.historyValid = false;
    this.lastResolvedIndex = null;
    this.lastShadowSequence = null;
    return this.resources;
  }

  createPassGraph() {
    return {
      renderer: "WebGPURenderer",
      hostPipeline:
        this.hostPipeline instanceof RenderPipeline
          ? "RenderPipeline instance"
          : "RenderPipeline-compatible host",
      passes: [
        "host MRT scene pass provides color/depth/normal/velocity",
        "sun-aligned R16F opaque/ground cloud optical-depth cascades",
        "bounded reduced-resolution Beer/HG beauty compute; runtime evidence not run",
        "full-low-grid advected temporal resolve with depth/spread rejection and variance clipping",
        "depth-aware four-tap upsample and linear HDR composite",
      ],
      beautyContract: createCloudBeautyNodeContract({
        qualityTier: this.selectQualityTier(),
      }),
      compositeContract: createCloudCompositeContract(),
      outputOwnership:
        "clouds return linear HDR radiance/transmittance; host RenderPipeline owns renderOutput",
      claimLevel: "scaffold-only",
    };
  }

  async dispatchCompute(computeNode) {
    if (!this.renderer) {
      throw new Error("renderer is required before dispatching cloud compute");
    }
    if (this.renderer.backend?.isWebGPUBackend !== true) {
      throw new Error("WebGPU backend unavailable for cloud compute dispatch.");
    }
    return this.renderer.compute(computeNode);
  }

  createComputeKernels({
    targets,
    timeSeconds = 0,
    deltaTimeSeconds = 0,
    frameIndex = 0,
    cameraState = this.config.camera,
    previousCameraState = this.previousCameraState ?? cameraState,
    sceneDepthTexture,
  } = {}) {
    let resources = targets ?? this.resources ?? this.createStorageResources();
    if (resources.cloudBeauty) {
      const beauty = resources.cloudBeauty;
      const temporalTargets = resources.temporalResolve;
      resources = {
        current: {
          radianceTransmittance: beauty.radianceTransmittance,
          representativeDepthMeters: beauty.representativeDepthMeters,
          cloudVelocity: beauty.cloudVelocity,
          depthMoments: beauty.depthMoments,
          rejectionMask: beauty.rejectionMask,
          sceneDepthTexture: beauty.sceneDepthTexture,
        },
        fields: {
          localWeather: beauty.localWeather,
          shape: beauty.shape,
          shapeDetail: beauty.shapeDetail,
          turbulence: beauty.turbulence,
          stbn: beauty.stbn,
        },
        shadow: [resources.cloudShadow.cloudShadowCascade],
        history: [
          {
            radianceTransmittance: temporalTargets.historyRadianceTransmittanceRead,
            representativeDepthMeters: temporalTargets.historyRepresentativeDepthRead,
            cloudVelocity: temporalTargets.historyVelocityRead,
            depthMoments: temporalTargets.historyDepthMomentsRead,
          },
          {
            radianceTransmittance: temporalTargets.historyRadianceTransmittanceWrite,
            representativeDepthMeters: temporalTargets.historyRepresentativeDepthWrite,
            cloudVelocity: temporalTargets.historyVelocityWrite,
            depthMoments: temporalTargets.historyDepthMomentsWrite,
          },
        ],
        temporalRejection: temporalTargets.historyRejectionMask,
      };
    }

    const temporal = createTemporalCloudHistoryConfig({
      fullWidth: this.viewport.width,
      fullHeight: this.viewport.height,
      linearResolutionScale:
        this.config.qualityTiers[this.config.qualityTier].linearResolutionScale,
      responseTimeSeconds: this.config.temporal.responseTimeSeconds,
      deltaTimeSeconds,
      depthRejectMeters: this.config.temporal.depthRejectMeters,
      depthRangeMeters: 200000,
      velocityRejectPixels: this.config.temporal.velocityRejectPixels,
      varianceClipSigma: this.config.temporal.varianceClipSigma,
      representativeDepthTarget: this.config.temporal.representativeDepthTarget,
      velocityTarget: this.config.temporal.velocityTarget,
    });

    const shadowConfig = createCloudShadowCascadeConfig({
      ...this.config.cloudShadow,
      tier: this.config.qualityTier,
    });
    const readIndex = this.historyReadIndex ?? 0;
    const writeIndex = 1 - readIndex;
    const fields = resources.fields ?? resources;
    const hostSceneDepth = sceneDepthTexture ?? resources.sceneDepthTexture ?? resources.current.sceneDepthTexture;
    if (!hostSceneDepth) {
      throw new Error("cloud compute requires sampled host scene-pass depth");
    }
    const cloudBeauty = [
      createCloudBeautyMarchNode({
        config: this.config,
        viewport: this.viewport,
        targets: {
          radianceTransmittance: resources.current.radianceTransmittance,
          representativeDepthMeters: resources.current.representativeDepthMeters,
          rejectionMask: resources.current.rejectionMask,
          sceneDepthTexture: hostSceneDepth,
          localWeather: fields.localWeather,
          shape: fields.shape,
          shapeDetail: fields.shapeDetail,
          turbulence: fields.turbulence,
          stbn: fields.stbn,
        },
        timeSeconds,
        frameIndex,
        cameraState,
        previousCameraState,
      }),
      createCloudAuxiliaryNode({
        config: this.config,
        viewport: this.viewport,
        targets: {
          representativeDepthMeters: resources.current.representativeDepthMeters,
          cloudVelocity: resources.current.cloudVelocity,
          depthMoments: resources.current.depthMoments,
        },
        deltaTimeSeconds,
        cameraState,
        previousCameraState,
      }),
    ];
    const temporalResolve = createTemporalResolveNodes({
      historyConfig: temporal,
      historyValid: this.historyValid,
      targets: {
        currentRadianceTransmittance: resources.current.radianceTransmittance,
        currentRepresentativeDepth: resources.current.representativeDepthMeters,
        currentVelocity: resources.current.cloudVelocity,
        currentDepthMoments: resources.current.depthMoments,
        historyRadianceTransmittanceRead: resources.history[readIndex].radianceTransmittance,
        historyRepresentativeDepthRead: resources.history[readIndex].representativeDepthMeters,
        historyVelocityRead: resources.history[readIndex].cloudVelocity,
        historyDepthMomentsRead: resources.history[readIndex].depthMoments,
        historyRadianceTransmittanceWrite: resources.history[writeIndex].radianceTransmittance,
        historyRepresentativeDepthWrite: resources.history[writeIndex].representativeDepthMeters,
        historyVelocityWrite: resources.history[writeIndex].cloudVelocity,
        historyDepthMomentsWrite: resources.history[writeIndex].depthMoments,
        historyRejectionMask: resources.temporalRejection,
      },
    });
    const cloudShadow = resources.shadow.map((cloudShadowCascade, cascadeIndex) =>
        createCloudShadowMarchNode({
          shadowConfig,
          cascadeIndex,
          targets: {
            cloudShadowCascade,
            localWeather: fields.localWeather,
            shape: fields.shape,
          },
        }),
      );
    return {
      cloudShadow,
      cloudBeauty,
      temporalResolve,
      historyReadIndex: readIndex,
      historyWriteIndex: writeIndex,
      maximumStorageTextureBindings: Math.max(
        ...cloudShadow.map((node) => node.cloudStorageTextureBindingCount),
        ...cloudBeauty.map((node) => node.cloudStorageTextureBindingCount),
        ...temporalResolve.map((node) => node.cloudStorageTextureBindingCount),
      ),
    };
  }

  swapHistory() {
    this.historyReadIndex = 1 - (this.historyReadIndex ?? 0);
  }

  async dispatchFrame(renderer = this.renderer, {
    targets = this.resources,
    timeSeconds = 0,
    deltaTimeSeconds = 0,
    frameIndex = 0,
    cameraState = this.config.camera,
    sceneDepthTexture,
  } = {}) {
    if (!renderer || renderer.backend?.isWebGPUBackend !== true) {
      throw new Error("native WebGPU renderer is required for cloud frame dispatch");
    }
    if (!targets) throw new Error("cloud resources must be created before dispatchFrame");
    const kernels = this.createComputeKernels({
      targets,
      timeSeconds,
      deltaTimeSeconds,
      frameIndex,
      cameraState,
      previousCameraState: this.previousCameraState,
      sceneDepthTexture,
    });
    const cadence = Math.max(1, this.config.cloudShadow.shadowUpdateCadence);
    const shadowSequence = Math.floor((timeSeconds * 60) / cadence);
    if (shadowSequence !== this.lastShadowSequence || !this.historyValid) {
      for (const node of kernels.cloudShadow) await renderer.compute(node);
      this.lastShadowSequence = shadowSequence;
    }
    for (const node of kernels.cloudBeauty) await renderer.compute(node);
    for (const node of kernels.temporalResolve) await renderer.compute(node);
    this.lastResolvedIndex = kernels.historyWriteIndex;
    this.swapHistory();
    this.historyValid = true;
    this.previousCameraState = structuredClone(cameraState);
    this.lastKernels = kernels;
    return kernels;
  }

  getResolvedHistory() {
    if (this.lastResolvedIndex === null || !this.resources) return null;
    return this.resources.history[this.lastResolvedIndex];
  }

  resetHistory(cause = "explicit-reset") {
    if (typeof cause !== "string" || cause.length === 0) {
      throw new Error("cloud history reset requires a non-empty cause");
    }
    this.historyReadIndex = 0;
    this.historyValid = false;
    this.lastResolvedIndex = null;
    this.lastShadowSequence = null;
    this.lastResetCause = cause;
  }

  dispose() {
    this.resources?.dispose?.();
    this.resources = null;
    this.historyValid = false;
    this.lastResolvedIndex = null;
    this.lastShadowSequence = null;
  }
}

/** Reusable stage factory for integration flagships; owns no renderer/output. */
export function createWeatherCloudStage({ config, viewport, assetManifest } = {}) {
  const system = new WebGPUWeatherVolumeClouds({ config, viewport, assetManifest });
  return {
    system,
    createResources: () => system.createStorageResources(),
    createKernels: (options) => system.createComputeKernels(options),
    dispatchFrame: (renderer, options) => system.dispatchFrame(renderer, options),
    getResolvedHistory: () => system.getResolvedHistory(),
    resetHistory: (cause) => system.resetHistory(cause),
    describePipeline: () => system.createPassGraph(),
    describeResources: () => system.resources?.describe?.() ?? system.createResourcePlan(),
    swapHistory: () => system.swapHistory(),
    dispose: () => system.dispose(),
  };
}
