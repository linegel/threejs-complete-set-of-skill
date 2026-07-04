export const BAYER_4X4 = Object.freeze([
  0, 8, 2, 10,
  12, 4, 14, 6,
  3, 11, 1, 9,
  15, 7, 13, 5,
]);

export function createTemporalCloudHistoryConfig({
  fullWidth = 1920,
  fullHeight = 1080,
  linearResolutionScale = 0.25,
  temporalAlpha = 0.12,
  representativeDepthTarget = "cloudRepresentativeDepthMeters",
  velocityTarget = "cloudVelocityPixels",
  bayerPattern = BAYER_4X4,
} = {}) {
  const width = Math.ceil(fullWidth * linearResolutionScale);
  const height = Math.ceil(fullHeight * linearResolutionScale);

  return {
    lowResolution: { width, height, linearResolutionScale },
    temporalAlpha,
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
