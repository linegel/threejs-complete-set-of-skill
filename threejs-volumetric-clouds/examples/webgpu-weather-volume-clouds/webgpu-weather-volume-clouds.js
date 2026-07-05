import {
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
  createTemporalResolveNode,
} from "./cloud-history.js";
import {
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
    if (!this.validation.ok) {
      throw new Error(
        `Invalid WebGPU weather cloud config:\n${this.validation.errors.join("\n")}`,
      );
    }
  }

  static async createRenderer(options = {}) {
    const renderer = new WebGPURenderer(options);
    await renderer.init();
    return renderer;
  }

  selectBackendTier() {
    if (this.renderer?.backend?.isWebGPUBackend) {
      return this.config.qualityTier;
    }
    return "reduced";
  }

  createResourcePlan() {
    const storage = estimateCloudStorageBytes(this.config, this.viewport);
    const shadow = createCloudShadowCascadeConfig(this.config.cloudShadow);
    const temporal = createTemporalCloudHistoryConfig({
      fullWidth: this.viewport.width,
      fullHeight: this.viewport.height,
      linearResolutionScale:
        this.config.qualityTiers[this.config.qualityTier].linearResolutionScale,
      temporalAlpha: this.config.temporal.temporalAlpha,
      depthRejectMeters: this.config.temporal.depthRejectMeters,
      velocityRejectPixels: this.config.temporal.velocityRejectPixels,
      varianceClipSigma: this.config.temporal.varianceClipSigma,
      representativeDepthTarget: this.config.temporal.representativeDepthTarget,
      velocityTarget: this.config.temporal.velocityTarget,
    });

    return {
      storageTextureClass: StorageTexture.name,
      storage3DTextureClass: Storage3DTexture.name,
      current: "StorageTexture RGBA16F current radiance/transmittance",
      representativeDepthVelocity:
        "StorageTexture RGBA16F representativeDepth + velocity",
      history: "ping-pong StorageTexture history radiance/depth/velocity",
      generatedFields:
        "optional Storage3DTexture shape/detail writes via storageTexture3D",
      shadow,
      temporal,
      storage,
    };
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
        "cloudShadowCascade compute/update cadence",
        "reduced-resolution cloud beauty Fn().compute(count)",
        "temporal resolve compute with representativeDepth/velocity",
        "depth-aware upsample and linear HDR composite pass()",
      ],
      beautyContract: createCloudBeautyNodeContract({
        qualityTier: this.selectBackendTier(),
      }),
      compositeContract: createCloudCompositeContract(),
      outputOwnership:
        "clouds return linear HDR radiance/transmittance; host RenderPipeline owns renderOutput",
    };
  }

  async dispatchCompute(computeNode) {
    if (!this.renderer) {
      throw new Error("renderer is required before dispatching cloud compute");
    }
    if (typeof this.renderer.computeAsync === "function") {
      return this.renderer.computeAsync(computeNode);
    }
    return this.renderer.compute(computeNode);
  }

  createComputeKernels({ targets, frame = 0 } = {}) {
    if (!targets) {
      throw new Error("targets are required to create cloud compute kernels");
    }

    const temporal = createTemporalCloudHistoryConfig({
      fullWidth: this.viewport.width,
      fullHeight: this.viewport.height,
      linearResolutionScale:
        this.config.qualityTiers[this.config.qualityTier].linearResolutionScale,
      temporalAlpha: this.config.temporal.temporalAlpha,
      depthRejectMeters: this.config.temporal.depthRejectMeters,
      velocityRejectPixels: this.config.temporal.velocityRejectPixels,
      varianceClipSigma: this.config.temporal.varianceClipSigma,
      representativeDepthTarget: this.config.temporal.representativeDepthTarget,
      velocityTarget: this.config.temporal.velocityTarget,
    });

    return {
      cloudShadow: createCloudShadowMarchNode({
        shadowConfig: this.config.cloudShadow,
        targets: targets.cloudShadow,
      }),
      cloudBeauty: createCloudBeautyMarchNode({
        config: this.config,
        viewport: this.viewport,
        targets: targets.cloudBeauty,
        frame,
      }),
      temporalResolve: createTemporalResolveNode({
        historyConfig: temporal,
        targets: targets.temporalResolve,
      }),
    };
  }
}
