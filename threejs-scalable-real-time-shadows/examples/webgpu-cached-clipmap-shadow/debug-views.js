export const SHADOW_DEBUG_VIEWS = Object.freeze([
  "architectureDecision",
  "levelState",
  "updateSelection",
  "nominalMemoryEstimate",
]);

export function createDebugSnapshot({ levels, selection, memoryBytes, architecture }) {
  return {
    architecture,
    levelCount: levels.length,
    targetCount: levels.length,
    colorAttachmentCount: levels.length,
    depthAttachmentCount: levels.length,
    receiverSampledTextureCount: 0,
    levels: levels.map((level) => ({
      index: level.index,
      halfWidth: level.halfWidth,
      sampledHalfWidth: level.sampledHalfWidth,
      mapSize: level.mapSize,
      inverseMapSize: level.inverseMapSize,
      texelWidth: level.texelWidth,
      committedCenter: {
        committedX: level.centerX,
        committedY: level.centerY,
        committedZ: level.centerZ,
      },
      valid: level.valid,
      forceDirty: level.forceDirty,
      age: level.age,
      normalBias: level.normalBias,
      normalBiasHypothesis: level.normalBiasHypothesis,
    })),
    budgetBefore: selection?.budgetBefore,
    budgetAfter: selection?.budgetAfter,
    correctionBudgetBefore: selection?.correctionBudgetBefore,
    correctionBudgetAfter: selection?.correctionBudgetAfter,
    updateSelection: selection?.diagnostics ?? [],
    selectedLevelIndices:
      selection?.selected?.map((entry) => entry.level.index) ?? [],
    nominalTargetBytes: memoryBytes,
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
    movingCaster: {
      id: "movingCaster",
      path: "crosses near and cached coarse levels",
      invalidation: "invalidateSphere on each committed motion segment",
    },
    alphaTest: {
      id: "alphaTestFoliage",
      casterParity: "NodeMaterial alpha mask shared by visible and shadow pass",
    },
    wind: {
      id: "windDisplacedCaster",
      casterParity: "positionNode and castShadowPositionNode share one local-space node; receivedShadowPositionNode remains world-space/default",
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
