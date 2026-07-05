import {
  Fn,
  If,
  abs,
  instanceIndex,
  length,
  select,
  storageTexture,
  textureStore,
  uvec2,
  vec4,
} from "three/tsl";

export const BAYER_4X4 = Object.freeze([
  0, 8, 2, 10,
  12, 4, 14, 6,
  3, 11, 1, 9,
  15, 7, 13, 5,
]);

export const TEMPORAL_REPROJECTION_DEPENDENCIES = Object.freeze([
  "currentRadianceTransmittance",
  "currentRepresentativeDepthVelocity",
  "historyRadianceTransmittanceRead",
  "historyRepresentativeDepthVelocityRead",
  "historyRadianceTransmittanceWrite",
  "historyRepresentativeDepthVelocityWrite",
  "historyRejectionMask",
  "historyUVFromVelocity",
  "currentRepresentativeDepthMeters",
  "historyRepresentativeDepthMeters",
  "depthRejectMeters",
  "velocityRejectPixels",
  "varianceClip",
]);

export function createTemporalCloudHistoryConfig({
  fullWidth = 1920,
  fullHeight = 1080,
  linearResolutionScale = 0.25,
  temporalAlpha = 0.12,
  depthRejectMeters = 120,
  velocityRejectPixels = 48,
  varianceClipSigma = 1.5,
  representativeDepthTarget = "cloudRepresentativeDepthMeters",
  velocityTarget = "cloudVelocityPixels",
  bayerPattern = BAYER_4X4,
} = {}) {
  const width = Math.ceil(fullWidth * linearResolutionScale);
  const height = Math.ceil(fullHeight * linearResolutionScale);

  return {
    lowResolution: { width, height, linearResolutionScale },
    temporalAlpha,
    depthRejectMeters,
    velocityRejectPixels,
    varianceClipSigma,
    bayerPattern,
    currentTargets: {
      radianceTransmittance: "RGBA16F current cloud radiance/transmittance",
      representativeDepth: representativeDepthTarget,
      velocity: velocityTarget,
      rejectionMask: "R16 history rejection mask",
    },
    historyTargets: {
      radianceTransmittanceRead: "RGBA16F history read",
      radianceTransmittanceWrite: "RGBA16F history write",
      representativeDepthVelocityRead: "RGBA16F representativeDepth/velocity read",
      representativeDepthVelocityWrite: "RGBA16F representativeDepth/velocity write",
    },
    resolveSteps: [
      "active Bayer sample wins for the current subpixel",
      "closest representativeDepth sample selected from 3x3 neighborhood",
      "historyUV = currentUV - velocity / lowResolution",
      "viewport bounds rejection",
      "depthReject on representativeDepth mismatch",
      "velocity spike rejection",
      "varianceClip against current neighborhood",
      "history swap after write",
    ],
  };
}

export function historyUV(currentUV, velocityPixels, lowResolution) {
  return {
    x: currentUV.x - velocityPixels.x / lowResolution.width,
    y: currentUV.y - velocityPixels.y / lowResolution.height,
  };
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

  if (!config.currentTargets?.representativeDepth) {
    errors.push("temporal history requires representativeDepth target");
  }
  if (!config.currentTargets?.velocity) {
    errors.push("temporal history requires velocity target");
  }
  if (!config.resolveSteps?.some((step) => step.includes("historyUV"))) {
    errors.push("temporal history requires historyUV reprojection");
  }
  if (!config.resolveSteps?.some((step) => step.includes("depthReject"))) {
    errors.push("temporal history requires depthReject");
  }
  if (!config.resolveSteps?.some((step) => step.includes("varianceClip"))) {
    errors.push("temporal history requires varianceClip");
  }

  return { ok: errors.length === 0, errors };
}

function cellFromIndex(width) {
  const x = instanceIndex.mod(width);
  const y = instanceIndex.div(width);
  return uvec2(x, y);
}

function historyCellFromVelocity(cell, velocity, width, height) {
  return uvec2(
    cell.x.sub(velocity.x.round().toInt()).clamp(0, width - 1),
    cell.y.sub(velocity.y.round().toInt()).clamp(0, height - 1),
  );
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

export function createTemporalResolveNode({
  historyConfig = createTemporalCloudHistoryConfig(),
  targets,
} = {}) {
  if (!targets) {
    throw new Error("targets are required for temporal resolve");
  }

  const { width, height } = historyConfig.lowResolution;
  const constants = {
    width,
    height,
    temporalAlpha: historyConfig.temporalAlpha,
    depthRejectMeters: historyConfig.depthRejectMeters ?? 120,
    velocityRejectPixels: historyConfig.velocityRejectPixels ?? 48,
  };

  const kernel = Fn(
    ({
      currentRadianceTransmittance,
      currentRepresentativeDepthVelocity,
      historyRadianceTransmittanceRead,
      historyRepresentativeDepthVelocityRead,
      historyRadianceTransmittanceWrite,
      historyRepresentativeDepthVelocityWrite,
      historyRejectionMask,
    }) => {
      const cell = cellFromIndex(constants.width);
      const current = storageTexture(
        currentRadianceTransmittance,
        cell,
      ).toReadOnly();
      const currentDepthVelocity = storageTexture(
        currentRepresentativeDepthVelocity,
        cell,
      ).toReadOnly();
      const velocity = currentDepthVelocity.yz;
      const historyCell = historyCellFromVelocity(
        cell,
        velocity,
        constants.width,
        constants.height,
      );
      const history = storageTexture(
        historyRadianceTransmittanceRead,
        historyCell,
      ).toReadOnly();
      const historyDepthVelocity = storageTexture(
        historyRepresentativeDepthVelocityRead,
        historyCell,
      ).toReadOnly();

      const depthDelta = abs(currentDepthVelocity.x.sub(historyDepthVelocity.x));
      const velocityMagnitude = length(velocity);
      const accepted = depthDelta
        .lessThanEqual(constants.depthRejectMeters)
        .and(velocityMagnitude.lessThanEqual(constants.velocityRejectPixels));
      const resolved = current.toVar();

      If(accepted, () => {
        resolved.assign(
          current.mul(constants.temporalAlpha).add(
            history.mul(1 - constants.temporalAlpha),
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
        historyRepresentativeDepthVelocityWrite,
        cell,
        vec4(currentDepthVelocity.xyz, select(accepted, 1, 0)),
      ).toWriteOnly();
      textureStore(
        historyRejectionMask,
        cell,
        vec4(rejectValue, depthDelta, velocityMagnitude, 1),
      ).toWriteOnly();
    },
  );

  const node = kernel(targets)
    .compute(constants.width * constants.height, [64])
    .setName("cloud:temporal-resolve");
  node.cloudDependencySet = createTemporalResolveDependencySet(historyConfig);
  return node;
}
