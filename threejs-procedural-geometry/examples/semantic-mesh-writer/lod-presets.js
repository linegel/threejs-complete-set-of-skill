export const LOD_PRESETS = Object.freeze({
  hero: {
    dprCap: 2,
    profileSamples: 104,
    railSegments: 96,
    branchRadialSegments: 20,
    maxVertices: 35000,
    maxTriangles: 70000,
    maxNormalizedChordError: 0.006,
    maxNormalAngleError: 0.07,
    projectionEnvelope: {
      referenceCssHeight: 800,
      verticalFovDegrees: 42,
      nearestSupportDepth: 2.5,
      objectToViewSigmaMax: 1,
      maximumPositionErrorPixels: 1.6,
    },
    branchErrorEnvelope: {
      maximumPositionErrorPixels: 2.4,
      maximumRadialNormalAngleError: 0.18,
      maximumAdjacentFrameAngle: 0.32,
    },
    preserveExtrema: ["crown", "inner bead", "outer bead", "inner groove", "outer groove", "shoulder", "cove"],
  },
  standard: {
    dprCap: 1.5,
    profileSamples: 64,
    railSegments: 48,
    branchRadialSegments: 12,
    maxVertices: 8000,
    maxTriangles: 16000,
    maxNormalizedChordError: 0.012,
    maxNormalAngleError: 0.12,
    projectionEnvelope: {
      referenceCssHeight: 800,
      verticalFovDegrees: 42,
      nearestSupportDepth: 4.5,
      objectToViewSigmaMax: 1,
      maximumPositionErrorPixels: 2,
    },
    branchErrorEnvelope: {
      maximumPositionErrorPixels: 2.7,
      maximumRadialNormalAngleError: 0.27,
      maximumAdjacentFrameAngle: 0.32,
    },
    preserveExtrema: ["crown", "inner bead", "outer bead", "inner groove", "outer groove", "shoulder", "cove"],
  },
  crowd: {
    dprCap: 1,
    profileSamples: 40,
    railSegments: 24,
    branchRadialSegments: 6,
    maxVertices: 2600,
    maxTriangles: 5200,
    maxNormalizedChordError: 0.015,
    maxNormalAngleError: 0.23,
    projectionEnvelope: {
      referenceCssHeight: 800,
      verticalFovDegrees: 42,
      nearestSupportDepth: 8,
      objectToViewSigmaMax: 1,
      maximumPositionErrorPixels: 1.5,
    },
    branchErrorEnvelope: {
      maximumPositionErrorPixels: 4,
      maximumRadialNormalAngleError: 0.53,
      maximumAdjacentFrameAngle: 0.32,
    },
    preserveExtrema: ["crown", "inner bead", "outer bead", "inner groove", "outer groove", "shoulder", "cove"],
  },
});

export function resolvePhysicalProjectionEnvelope(
  envelope,
  { cssHeight = envelope?.referenceCssHeight, dpr = 1, passScale = 1 } = {},
) {
  if (!(Number.isFinite(cssHeight) && cssHeight > 0)) {
    throw new RangeError("CSS target height must be finite and positive");
  }
  if (!(Number.isFinite(dpr) && dpr > 0)) {
    throw new RangeError("DPR must be finite and positive");
  }
  if (!(Number.isFinite(passScale) && passScale > 0)) {
    throw new RangeError("pass scale must be finite and positive");
  }
  return {
    ...envelope,
    cssHeight,
    dpr,
    passScale,
    physicalTargetHeight: cssHeight * dpr * passScale,
  };
}

export function projectTransverseErrorPixels(worldError, envelope) {
  if (!(Number.isFinite(worldError) && worldError >= 0)) {
    throw new RangeError("worldError must be finite and nonnegative");
  }
  const {
    physicalTargetHeight,
    verticalFovDegrees,
    nearestSupportDepth,
    objectToViewSigmaMax,
  } = envelope ?? {};
  if (
    !Number.isFinite(physicalTargetHeight) || physicalTargetHeight <= 0 ||
    !Number.isFinite(verticalFovDegrees) || verticalFovDegrees <= 0 || verticalFovDegrees >= 180 ||
    !Number.isFinite(nearestSupportDepth) || nearestSupportDepth <= 0 ||
    !Number.isFinite(objectToViewSigmaMax) || objectToViewSigmaMax <= 0
  ) {
    throw new RangeError("projection envelope must define positive physical height, depth, and transform scale plus a valid FOV");
  }
  const verticalFovRadians = verticalFovDegrees * Math.PI / 180;
  return (
    objectToViewSigmaMax * worldError * physicalTargetHeight /
    (2 * nearestSupportDepth * Math.tan(verticalFovRadians * 0.5))
  );
}

export function estimateTierBudget(tier, geometry, resolution = {}) {
  const preset = LOD_PRESETS[tier];
  if (!preset) throw new RangeError(`unknown LOD tier "${tier}"`);
  const projectionEnvelope = resolvePhysicalProjectionEnvelope(
    preset.projectionEnvelope,
    resolution,
  );
  const vertices = geometry.attributes.position.count;
  const triangles = geometry.index.count / 3;
  const bytes = geometry.userData.writer.bytes;
  const approximation = geometry.userData.fixture?.profileApproximation ?? null;
  const railWidth = geometry.userData.fixture?.railWidth ?? null;
  const maximumWorldChordError = approximation && railWidth !== null
    ? approximation.maximumNormalizedChordError * railWidth
    : null;
  const projectedPositionErrorPixels = maximumWorldChordError !== null
    ? projectTransverseErrorPixels(maximumWorldChordError, projectionEnvelope)
    : null;
  return {
    tier,
    vertices,
    triangles,
    groups: geometry.groups.length,
    bytes,
    vertexBudgetOk: vertices <= preset.maxVertices,
    triangleBudgetOk: triangles <= preset.maxTriangles,
    extremaPreserved: approximation?.preservedExtrema ?? [],
    extremaPreservationOk: approximation?.extremaPreservationOk === true,
    maximumProfileGap: approximation?.maximumGap ?? null,
    maximumNormalizedChordError: approximation?.maximumNormalizedChordError ?? null,
    maximumNormalAngleError: approximation?.maximumNormalAngleError ?? null,
    maximumWorldChordError,
    projectedPositionErrorPixels,
    projectionEnvelope,
    projectedErrorOk:
      projectedPositionErrorPixels !== null &&
      projectedPositionErrorPixels <= preset.projectionEnvelope.maximumPositionErrorPixels,
    profileErrorOk: Boolean(
      approximation &&
      approximation.maximumNormalizedChordError <= preset.maxNormalizedChordError &&
      approximation.maximumNormalAngleError <= preset.maxNormalAngleError &&
      projectedPositionErrorPixels <= preset.projectionEnvelope.maximumPositionErrorPixels
    ),
  };
}
