export const LOD_PRESETS = Object.freeze({
  hero: {
    profileSamples: 72,
    railSegments: 96,
    maxVertices: 35000,
    maxTriangles: 70000,
    preserveExtrema: ["crown", "inner bead", "outer bead", "inner groove", "outer groove", "shoulder", "cove"],
  },
  standard: {
    profileSamples: 48,
    railSegments: 48,
    maxVertices: 8000,
    maxTriangles: 16000,
    preserveExtrema: ["crown", "inner bead", "outer bead", "inner groove", "outer groove", "shoulder", "cove"],
  },
  crowd: {
    profileSamples: 24,
    railSegments: 24,
    maxVertices: 2600,
    maxTriangles: 5200,
    preserveExtrema: ["crown", "inner bead", "outer bead", "inner groove", "outer groove", "shoulder", "cove"],
  },
});

export function estimateTierBudget(tier, geometry) {
  const preset = LOD_PRESETS[tier];
  const vertices = geometry.attributes.position.count;
  const triangles = geometry.index.count / 3;
  const bytes = geometry.userData.writer.bytes;
  return {
    tier,
    vertices,
    triangles,
    groups: geometry.groups.length,
    bytes,
    vertexBudgetOk: vertices <= preset.maxVertices,
    triangleBudgetOk: triangles <= preset.maxTriangles,
    extremaPreserved: preset.preserveExtrema,
  };
}
