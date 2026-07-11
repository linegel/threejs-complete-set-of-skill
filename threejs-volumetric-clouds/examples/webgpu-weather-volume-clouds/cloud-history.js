import {
  Fn,
  If,
  abs,
  float,
  instanceIndex,
  length,
  max,
  select,
  texture,
  textureStore,
  uvec2,
  vec2,
  vec3,
  vec4,
} from "three/tsl";

export const TEMPORAL_REPROJECTION_DEPENDENCIES = Object.freeze([
  "currentRadianceTransmittance",
  "currentRepresentativeDepthR32F",
  "currentVelocityRG16F",
  "currentDepthMomentsRG16F",
  "historyRadianceTransmittanceRead",
  "historyRepresentativeDepthRead",
  "historyVelocityRead",
  "historyDepthMomentsRead",
  "historyRadianceTransmittanceWrite",
  "historyRepresentativeDepthWrite",
  "historyVelocityWrite",
  "historyDepthMomentsWrite",
  "historyRejectionMask",
  "historyUVFromCloudVelocity",
  "metricRepresentativeDepthR32F",
  "depthRejectMeters",
  "velocityRejectPixels",
  "viewportBoundsRejectBeforeClamp",
]);

export const CLOUD_TEMPORAL_RESOLVE_STATUS = Object.freeze({
  claimLevel: "scaffold-only",
  sourceImplemented: true,
  runtimeEvidence: "not-run",
  samplingArchitecture: "full-low-resolution-grid-every-frame",
  implemented: [
    "frame-rate-independent current/history weight",
    "viewport rejection before safe integer lookup",
    "metric-depth mismatch rejection with depth-spread tolerance",
    "velocity-magnitude rejection",
    "ping-pong storage writes",
    "normalized-UV history sampling",
    "five-tap current-neighborhood variance clipping",
    "split color/depth/rejection and auxiliary writes under the four-storage-binding limit",
    "persistent ping-pong selection and explicit reset through the owning cloud stage",
  ],
  notImplemented: [
    "browser WebGPU execution, readback, temporal-error, and image evidence",
    "explicit filter policy proving bilinear history sampling",
    "browser proof that the selected storage-texture sampler path is bilinear",
    "split histories for independently moving disjoint layers",
  ],
});

export function currentFrameWeightFromResponseTime(
  deltaTimeSeconds,
  responseTimeSeconds,
) {
  if (!(deltaTimeSeconds >= 0) || !(responseTimeSeconds > 0)) {
    throw new Error("Temporal response requires deltaTimeSeconds >= 0 and responseTimeSeconds > 0.");
  }
  return 1 - Math.exp(-deltaTimeSeconds / responseTimeSeconds);
}

export function createTemporalCloudHistoryConfig({
  fullWidth = 1920,
  fullHeight = 1080,
  linearResolutionScale = 0.25,
  responseTimeSeconds = 0.13,
  deltaTimeSeconds = 1 / 60,
  depthRejectMeters = 120,
  depthRangeMeters = 200000,
  velocityRejectPixels = 48,
  varianceClipSigma = 1.5,
  representativeDepthTarget = "cloudRepresentativeDepthMetersR32F",
  velocityTarget = "cloudVelocityPixels",
} = {}) {
  const width = Math.ceil(fullWidth * linearResolutionScale);
  const height = Math.ceil(fullHeight * linearResolutionScale);
  const currentFrameWeight = currentFrameWeightFromResponseTime(
    deltaTimeSeconds,
    responseTimeSeconds,
  );

  return {
    claimLevel: CLOUD_TEMPORAL_RESOLVE_STATUS.claimLevel,
    sourceImplemented: CLOUD_TEMPORAL_RESOLVE_STATUS.sourceImplemented,
    runtimeEvidence: CLOUD_TEMPORAL_RESOLVE_STATUS.runtimeEvidence,
    samplingArchitecture: CLOUD_TEMPORAL_RESOLVE_STATUS.samplingArchitecture,
    lowResolution: { width, height, linearResolutionScale },
    responseTimeSeconds,
    deltaTimeSeconds,
    currentFrameWeight,
    depthRejectMeters,
    depthRangeMeters,
    depthEncoding: "R32F meters",
    velocityRejectPixels,
    varianceClipSigma,
    currentTargets: {
      radianceTransmittance: "RGBA16F current cloud radiance/transmittance",
      representativeDepth: `${representativeDepthTarget} (R32F meters)`,
      velocity: velocityTarget,
      depthMoments: "RG16F representative-depth mean/spread",
      rejectionMask: "RGBA16F history rejection diagnostics",
    },
    historyTargets: {
      radianceTransmittanceRead: "RGBA16F history read",
      radianceTransmittanceWrite: "RGBA16F history write",
      representativeDepthRead: "R32F metric-depth history read",
      representativeDepthWrite: "R32F metric-depth history write",
      velocityRead: "RG16F velocity history read",
      velocityWrite: "RG16F velocity history write",
      depthMomentsRead: "RG16F depth-moment history read",
      depthMomentsWrite: "RG16F depth-moment history write",
    },
    resolveSteps: [
      "every low-resolution texel is current",
      "historyUV = currentUV - cloudVelocity / lowResolution",
      "viewport bounds rejection before safe integer lookup",
      "metric depth mismatch rejection including current/history depth spread",
      "velocity spike rejection",
      "frame-rate-independent current/history blend",
      "history swap after write",
    ],
    implemented: CLOUD_TEMPORAL_RESOLVE_STATUS.implemented,
    notImplemented: CLOUD_TEMPORAL_RESOLVE_STATUS.notImplemented,
  };
}

export function historyUV(currentUV, velocityPixels, lowResolution) {
  return {
    x: currentUV.x - velocityPixels.x / lowResolution.width,
    y: currentUV.y - velocityPixels.y / lowResolution.height,
  };
}

export function historyUVInBounds(uv) {
  return uv.x >= 0 && uv.x <= 1 && uv.y >= 0 && uv.y <= 1;
}

export function depthReject(
  currentRepresentativeDepth,
  historyRepresentativeDepth,
  thresholdMeters = 120,
) {
  return (
    Math.abs(currentRepresentativeDepth - historyRepresentativeDepth) >
    thresholdMeters
  );
}

export function velocityReject(velocityPixels, limitPixels = 48) {
  return Math.hypot(velocityPixels.x, velocityPixels.y) > limitPixels;
}

export function varianceClip(value, mean, sigma, sigmaScale = 1.5) {
  const width = Math.max(0, sigma * sigmaScale);
  return Math.min(Math.max(value, mean - width), mean + width);
}

export function validateTemporalCloudHistory(config) {
  const errors = [];

  if (config.claimLevel !== "scaffold-only") {
    errors.push("temporal implementation must retain its scaffold-only evidence boundary");
  }
  if (config.samplingArchitecture !== "full-low-resolution-grid-every-frame") {
    errors.push("temporal scaffold must not conflate low-grid jitter with checkerboard missing samples");
  }
  if (!config.currentTargets?.representativeDepth) {
    errors.push("temporal history requires representativeDepth target");
  }
  if (!config.currentTargets?.velocity) {
    errors.push("temporal history requires velocity target");
  }
  if (!(config.currentFrameWeight > 0 && config.currentFrameWeight <= 1)) {
    errors.push("temporal history requires a valid frame-rate-independent current weight");
  }
  if (!(config.depthRangeMeters > 0) || !(config.depthRejectMeters > 0)) {
    errors.push("temporal history requires positive metric depth range and rejection controls");
  }
  if (!config.resolveSteps?.some((step) => step.includes("historyUV"))) {
    errors.push("temporal history requires historyUV reprojection");
  }
  if (!config.resolveSteps?.some((step) => step.includes("bounds rejection"))) {
    errors.push("temporal history requires viewport rejection before safe lookup");
  }
  if (config.depthEncoding !== "R32F meters") {
    errors.push("temporal history must store representative depth as R32F meters");
  }

  return { ok: errors.length === 0, errors };
}

function cellFromIndex(width) {
  const x = instanceIndex.mod(width);
  const y = instanceIndex.div(width);
  return uvec2(x, y);
}

export function createTemporalResolveDependencySet(config) {
  const dependencies = new Set(TEMPORAL_REPROJECTION_DEPENDENCIES);
  if (config?.representativeDepthTarget) {
    dependencies.add(config.representativeDepthTarget);
  }
  if (config?.velocityTarget) {
    dependencies.add(config.velocityTarget);
  }
  return dependencies;
}

export function createTemporalResolveNodes({
  historyConfig = createTemporalCloudHistoryConfig(),
  targets,
  historyValid = false,
} = {}) {
  if (!targets) {
    throw new Error("targets are required for temporal resolve");
  }

  const { width, height } = historyConfig.lowResolution;
  const constants = {
    width,
    height,
    currentFrameWeight: historyConfig.currentFrameWeight,
    depthRejectMeters: historyConfig.depthRejectMeters,
    velocityRejectPixels: historyConfig.velocityRejectPixels,
  };

  const resolveColorDepthKernel = Fn(
    ({
      currentRadianceTransmittance,
      currentRepresentativeDepth,
      currentVelocity,
      currentDepthMoments,
      historyRadianceTransmittanceRead,
      historyRepresentativeDepthRead,
      historyDepthMomentsRead,
      historyRadianceTransmittanceWrite,
      historyRepresentativeDepthWrite,
      historyRejectionMask,
    }) => {
      const cell = cellFromIndex(constants.width);
      const uv = vec2(cell).add(0.5).div(vec2(constants.width, constants.height));
      const current = texture(currentRadianceTransmittance, uv);
      const currentDepth = texture(currentRepresentativeDepth, uv).x;
      const velocity = texture(currentVelocity, uv).xy;
      const currentMoments = texture(currentDepthMoments, uv);
      const historyUv = uv.sub(
        velocity.div(vec2(constants.width, constants.height)),
      );
      const inBounds = historyUv.x
        .greaterThanEqual(0)
        .and(historyUv.x.lessThanEqual(1))
        .and(historyUv.y.greaterThanEqual(0))
        .and(historyUv.y.lessThanEqual(1));
      const safeUv = historyUv.clamp(0, 1);
      const history = texture(historyRadianceTransmittanceRead, safeUv);
      const historyDepth = texture(historyRepresentativeDepthRead, safeUv).x;
      const historyMoments = texture(historyDepthMomentsRead, safeUv);
      const depthDelta = abs(currentDepth.sub(historyDepth));
      const velocityMagnitude = length(velocity);
      const depthTolerance = float(constants.depthRejectMeters)
        .add(currentMoments.y)
        .add(historyMoments.y);
      const accepted = float(historyValid ? 1 : 0).greaterThan(0)
        .and(inBounds)
        .and(depthDelta.lessThanEqual(depthTolerance))
        .and(velocityMagnitude.lessThanEqual(constants.velocityRejectPixels));
      const resolved = current.toVar();

      const texel = vec2(1 / constants.width, 1 / constants.height);
      const left = texture(currentRadianceTransmittance, uv.sub(vec2(texel.x, 0))).rgb;
      const right = texture(currentRadianceTransmittance, uv.add(vec2(texel.x, 0))).rgb;
      const down = texture(currentRadianceTransmittance, uv.sub(vec2(0, texel.y))).rgb;
      const up = texture(currentRadianceTransmittance, uv.add(vec2(0, texel.y))).rgb;
      const mean = current.rgb.add(left).add(right).add(down).add(up).div(5);
      const variance = current.rgb
        .sub(mean)
        .mul(current.rgb.sub(mean))
        .add(left.sub(mean).mul(left.sub(mean)))
        .add(right.sub(mean).mul(right.sub(mean)))
        .add(down.sub(mean).mul(down.sub(mean)))
        .add(up.sub(mean).mul(up.sub(mean)))
        .div(5);
      const sigma = vec3(
        max(variance.x, 0).sqrt(),
        max(variance.y, 0).sqrt(),
        max(variance.z, 0).sqrt(),
      ).mul(historyConfig.varianceClipSigma);
      const clippedHistoryRgb = history.rgb.clamp(mean.sub(sigma), mean.add(sigma));
      const clippedHistory = vec4(clippedHistoryRgb, history.a.clamp(0, 1));

      If(accepted, () => {
        resolved.assign(
          current.mul(constants.currentFrameWeight).add(
            clippedHistory.mul(1 - constants.currentFrameWeight),
          ),
        );
      });

      const rejectValue = select(accepted, 0, 1);
      textureStore(
        historyRadianceTransmittanceWrite,
        cell,
        resolved,
      ).toWriteOnly();
      textureStore(
        historyRepresentativeDepthWrite,
        cell,
        vec4(currentDepth, 0, 0, 1),
      ).toWriteOnly();
      textureStore(
        historyRejectionMask,
        cell,
        vec4(
          rejectValue,
          depthDelta,
          velocityMagnitude,
          select(inBounds, 1, 0),
        ),
      ).toWriteOnly();
    },
  );

  const colorDepthNode = resolveColorDepthKernel(targets)
    .compute(constants.width * constants.height, [64])
    .setName("cloud:temporal-resolve-color-depth-rejection");
  colorDepthNode.cloudDependencySet = createTemporalResolveDependencySet(historyConfig);
  colorDepthNode.cloudImplementationStatus = CLOUD_TEMPORAL_RESOLVE_STATUS;
  colorDepthNode.cloudStorageTextureBindingCount = 3;
  colorDepthNode.cloudCurrentFrameWeight = constants.currentFrameWeight;

  const resolveAuxiliaryKernel = Fn(({
    currentVelocity,
    currentDepthMoments,
    historyVelocityWrite,
    historyDepthMomentsWrite,
  }) => {
    const cell = cellFromIndex(constants.width);
    const uv = vec2(cell).add(0.5).div(vec2(constants.width, constants.height));
    textureStore(
      historyVelocityWrite,
      cell,
      texture(currentVelocity, uv),
    ).toWriteOnly();
    textureStore(
      historyDepthMomentsWrite,
      cell,
      texture(currentDepthMoments, uv),
    ).toWriteOnly();
  });
  const auxiliaryNode = resolveAuxiliaryKernel(targets)
    .compute(constants.width * constants.height, [64])
    .setName("cloud:temporal-resolve-auxiliary-history");
  auxiliaryNode.cloudDependencySet = createTemporalResolveDependencySet(historyConfig);
  auxiliaryNode.cloudImplementationStatus = CLOUD_TEMPORAL_RESOLVE_STATUS;
  auxiliaryNode.cloudStorageTextureBindingCount = 2;
  return Object.assign([colorDepthNode, auxiliaryNode], {
    cloudStorageTextureBindingCount: 3,
  });
}

/** @deprecated Dispatch every node returned by createTemporalResolveNodes. */
export function createTemporalResolveNode(options = {}) {
  const nodes = createTemporalResolveNodes(options);
  const first = nodes[0];
  first.cloudSplitDispatches = nodes;
  return first;
}
