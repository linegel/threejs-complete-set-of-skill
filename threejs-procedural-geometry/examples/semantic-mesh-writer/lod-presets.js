export const LOD_PRESETS = Object.freeze({
  hero: {
    profileSamples: 72,
    railSegments: 96,
    maxVertices: 35000,
    maxTriangles: 70000,
    maxNormalizedChordError: 0.006,
    maxNormalAngleError: 0.07,
    preserveExtrema: ["crown", "inner bead", "outer bead", "inner groove", "outer groove", "shoulder", "cove"],
  },
  standard: {
    profileSamples: 48,
    railSegments: 48,
    maxVertices: 8000,
    maxTriangles: 16000,
    maxNormalizedChordError: 0.012,
    maxNormalAngleError: 0.12,
    preserveExtrema: ["crown", "inner bead", "outer bead", "inner groove", "outer groove", "shoulder", "cove"],
  },
  crowd: {
    profileSamples: 40,
    railSegments: 24,
    maxVertices: 2600,
    maxTriangles: 5200,
    maxNormalizedChordError: 0.015,
    maxNormalAngleError: 0.23,
    preserveExtrema: ["crown", "inner bead", "outer bead", "inner groove", "outer groove", "shoulder", "cove"],
  },
});

export function estimateTierBudget(tier, geometry) {
  const preset = LOD_PRESETS[tier];
  const vertices = geometry.attributes.position.count;
  const triangles = geometry.index.count / 3;
  const bytes = geometry.userData.writer.bytes;
  const approximation = geometry.userData.fixture?.profileApproximation ?? null;
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
    profileErrorOk: Boolean(
      approximation &&
      approximation.maximumNormalizedChordError <= preset.maxNormalizedChordError &&
      approximation.maximumNormalAngleError <= preset.maxNormalAngleError
    ),
  };
}
