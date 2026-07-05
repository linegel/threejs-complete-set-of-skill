export const SHADOW_DEBUG_VIEWS = Object.freeze([
  "architectureDecision",
  "levelHalfWidths",
  "texelGrid",
  "desiredVsCommittedCenter",
  "crossFadeWeights",
  "unshadowedWeight",
  "dynamicCachedClassification",
  "dirtyReasonBits",
  "budgetBeforeAfter",
  "directionEpsilon",
  "biasNodeNormalBias",
  "shadowMapPreview",
  "invalidationSphere",
  "sampledTextureLimits",
  "disposeCounters",
]);

export function createDebugSnapshot({ levels, selection, memoryBytes, architecture }) {
  return {
    architecture,
    levelCount: levels.length,
    textureCount: levels.length,
    levels: levels.map((level) => ({
      index: level.index,
      halfWidth: level.halfWidth,
      sampledHalfWidth: level.sampledHalfWidth,
      mapSize: level.mapSize,
      inverseMapSize: level.inverseMapSize,
      texelWidth: level.texelWidth,
      desiredVsCommittedCenter: {
        committedX: level.centerX,
        committedY: level.centerY,
        committedZ: level.centerZ,
      },
      valid: level.valid,
      forceDirty: level.forceDirty,
      age: level.age,
      normalBias: level.normalBias,
    })),
    budgetBefore: selection?.budgetBefore,
    budgetAfter: selection?.budgetAfter,
    memoryBytes,
    debugViews: SHADOW_DEBUG_VIEWS,
  };
}

export function createDeterministicValidationScene(seed = 1234) {
  return {
    seed,
    groundReceiver: { id: "ground", size: 2200 },
    staticFarCasters: [
      { id: "far-tower-a", position: [-420, 0, -760] },
      { id: "far-tower-b", position: [640, 0, 910] },
    ],
    movingHero: {
      id: "movingHero",
      path: "crosses near and cached coarse levels",
      invalidation: "invalidateSphere on each committed motion segment",
    },
    alphaTest: {
      id: "alphaTestFoliage",
      casterParity: "NodeMaterial alpha mask shared by visible and shadow pass",
    },
    wind: {
      id: "windDisplacedCaster",
      casterParity: "positionNode, castShadowPositionNode, and receivedShadowPositionNode are the same object",
    },
    invalidate: {
      id: "streamedChunkInvalidation",
      action: "invalidate light-space sphere when a terrain chunk arrives",
    },
    slowPan: {
      id: "slowPan",
      expected: "texelGrid remains snapped; no shadow crawl",
    },
    teleport: {
      id: "teleport",
      expected: "all invalid or moved levels refresh before winning selection",
    },
    directionEpsilon: {
      id: "directionEpsilon",
      below: "no all-level refresh",
      above: "all levels refresh coherently",
    },
  };
}
