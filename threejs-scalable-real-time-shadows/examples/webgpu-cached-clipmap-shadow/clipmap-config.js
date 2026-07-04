export const DIRTY_REASON_BITS = Object.freeze({
  dynamicNear: 1 << 0,
  neverRendered: 1 << 1,
  forceDirty: 1 << 2,
  snappedCenterChanged: 1 << 3,
  cacheAgeExpired: 1 << 4,
  lightDirectionChanged: 1 << 5,
});

export const SHADOW_ARCHITECTURE_DECISIONS = Object.freeze([
  {
    need: "bounded receiver/caster volume",
    use: "DirectionalLightShadow",
    cost: "one pass and one map",
  },
  {
    need: "camera-following cascades",
    use: "CSMShadowNode",
    importPath: "three/addons/csm/CSMShadowNode.js",
    cost: "one pass per cascade",
  },
  {
    need: "large tiled projection without persistent cache state",
    use: "TileShadowNode",
    importPath: "three/addons/tsl/shadows/TileShadowNode.js",
    cost: "tilesX * tilesY passes",
  },
  {
    need: "streaming open world with persistent coarse coverage",
    use: "custom cached clipmap",
    cost: "dynamicLevels + cachedBudget + forcedInvalidations",
  },
]);

export const DEFAULT_CLIPMAP_CONFIG = Object.freeze({
  firstRadius: 12,
  scaleFactor: 2.5,
  maxDistance: 2000,
  lightMargin: 100,
  shadowNear: 1,
  shadowFarCap: 3000,
  guardBand: 0.15,
  blendRatio: 0.15,
  dynamicLevels: 2,
  updateBudget: 2,
  maxCacheAge: 64,
  directionEpsilon: 0.002,
  baseBias: 0,
  baseNormalBias: 0.02,
  mapSizes: [2048, 1024, 1024, 512, 512, 512],
  bytesPerDepthTexel: 4,
  sampledTextureLimit: 8,
  memoryBudgetBytes: 64 * 1024 * 1024,
});

export function computeLevelCount({
  firstRadius = DEFAULT_CLIPMAP_CONFIG.firstRadius,
  scaleFactor = DEFAULT_CLIPMAP_CONFIG.scaleFactor,
  maxDistance = DEFAULT_CLIPMAP_CONFIG.maxDistance,
} = {}) {
  return Math.ceil(Math.log(maxDistance / firstRadius) / Math.log(scaleFactor)) + 1;
}

export function clampClipmapConfig(config = {}) {
  const merged = { ...DEFAULT_CLIPMAP_CONFIG, ...config };
  const clamped = {
    ...merged,
    firstRadius: Math.max(1, merged.firstRadius),
    scaleFactor: Math.max(1.5, merged.scaleFactor),
    guardBand: Math.min(Math.max(merged.guardBand, 0.02), 0.5),
    blendRatio: Math.min(Math.max(merged.blendRatio, 0.01), 0.9),
    updateBudget: Math.max(1, Math.floor(merged.updateBudget)),
    maxCacheAge: Math.max(0, Math.floor(merged.maxCacheAge)),
  };
  const levelCount = computeLevelCount(clamped);
  return {
    ...clamped,
    levelCount,
    dynamicLevels: Math.min(Math.max(0, clamped.dynamicLevels), levelCount),
  };
}

export function halfWidthForLevel(levelIndex, config = DEFAULT_CLIPMAP_CONFIG) {
  const clamped = clampClipmapConfig(config);
  if (levelIndex === clamped.levelCount - 1) {
    return clamped.maxDistance;
  }
  return Math.min(
    clamped.firstRadius * clamped.scaleFactor ** levelIndex,
    clamped.maxDistance,
  );
}

export function mapSizeForLevel(levelIndex, config = DEFAULT_CLIPMAP_CONFIG) {
  return config.mapSizes?.[levelIndex] ?? config.mapSizes?.at(-1) ?? 1024;
}

export function worldTexelWidth(halfWidth, mapSize) {
  return (2 * halfWidth) / mapSize;
}

export function inverseMapSize(level) {
  return 1 / level.mapSize;
}

export function snapLightSpaceCenter(cameraLight, level) {
  const texelWidth = worldTexelWidth(level.halfWidth, level.mapSize);
  const zQuantum = level.halfWidth * 0.5;
  return {
    x: Math.round(cameraLight.x / texelWidth) * texelWidth,
    y: Math.round(cameraLight.y / texelWidth) * texelWidth,
    z: Math.round(cameraLight.z / zQuantum) * zQuantum,
    texelWidth,
  };
}

export function createClipmapLevels(config = DEFAULT_CLIPMAP_CONFIG) {
  const clamped = clampClipmapConfig(config);
  const levels = [];
  const finestTexelWidth = worldTexelWidth(
    halfWidthForLevel(0, clamped),
    mapSizeForLevel(0, clamped),
  );

  for (let index = 0; index < clamped.levelCount; index += 1) {
    const halfWidth = halfWidthForLevel(index, clamped);
    const mapSize = mapSizeForLevel(index, clamped);
    const texelWidth = worldTexelWidth(halfWidth, mapSize);
    levels.push({
      index,
      halfWidth,
      sampledHalfWidth: halfWidth * (1 - clamped.guardBand),
      mapSize,
      inverseMapSize: 1 / mapSize,
      texelWidth,
      normalBias: clamped.baseNormalBias * (texelWidth / finestTexelWidth),
      bias: clamped.baseBias,
      centerX: 1e9,
      centerY: 1e9,
      centerZ: 0,
      valid: false,
      forceDirty: false,
      age: Math.floor((-index * clamped.maxCacheAge) / clamped.levelCount),
      dirtyReasonBits: DIRTY_REASON_BITS.neverRendered,
      renderCount: 0,
      disposed: false,
    });
  }

  return levels;
}

export function directionChanged(dotCurrentPrevious, directionEpsilon) {
  return dotCurrentPrevious < Math.cos(directionEpsilon);
}

export function classifyLevelDirty({
  level,
  desired,
  config = DEFAULT_CLIPMAP_CONFIG,
  lightDirectionChanged = false,
}) {
  const bits =
    (level.index < config.dynamicLevels ? DIRTY_REASON_BITS.dynamicNear : 0) |
    (!level.valid ? DIRTY_REASON_BITS.neverRendered : 0) |
    (level.forceDirty ? DIRTY_REASON_BITS.forceDirty : 0) |
    (level.age >= config.maxCacheAge ? DIRTY_REASON_BITS.cacheAgeExpired : 0) |
    (lightDirectionChanged ? DIRTY_REASON_BITS.lightDirectionChanged : 0) |
    (level.valid &&
    (level.centerX !== desired.x ||
      level.centerY !== desired.y ||
      level.centerZ !== desired.z)
      ? DIRTY_REASON_BITS.snappedCenterChanged
      : 0);

  return bits;
}

export function selectLevelsForUpdate({
  levels,
  cameraLight,
  config = DEFAULT_CLIPMAP_CONFIG,
  lightDirectionChanged = false,
}) {
  const clamped = clampClipmapConfig(config);
  const budget = lightDirectionChanged
    ? clamped.levelCount
    : Math.max(1, clamped.updateBudget);
  let remainingBudget = budget;
  const selected = [];
  const diagnostics = [];

  for (const level of levels) {
    level.age += 1;
    const desired = snapLightSpaceCenter(cameraLight, level);
    const dirty = classifyLevelDirty({
      level,
      desired,
      config: clamped,
      lightDirectionChanged,
    });
    const dynamic = level.index < clamped.dynamicLevels;
    const forced = Boolean(dirty & DIRTY_REASON_BITS.forceDirty);
    const budgeted = !dynamic && !forced;
    const shouldUpdate =
      dirty !== 0 && (dynamic || forced || remainingBudget > 0);

    if (shouldUpdate) {
      selected.push({ level, desired, dirty, dynamic, forced, budgeted });
      if (budgeted) {
        remainingBudget -= 1;
      }
    }

    diagnostics.push({
      index: level.index,
      dirty,
      dynamic,
      forced,
      age: level.age,
      desired,
      selected: shouldUpdate,
    });
  }

  return {
    selected,
    diagnostics,
    budgetBefore: budget,
    budgetAfter: remainingBudget,
  };
}

export function commitLevelRender(level, desired) {
  level.centerX = desired.x;
  level.centerY = desired.y;
  level.centerZ = desired.z;
  level.valid = true;
  level.forceDirty = false;
  level.age = 0;
  level.dirtyReasonBits = 0;
  level.renderCount += 1;
  return level;
}

export function invalidateSphere(levels, sphereLightSpace, reason = "invalidate") {
  const touched = [];
  for (const level of levels) {
    const reach = level.halfWidth + sphereLightSpace.radius;
    const dx = Math.abs(sphereLightSpace.x - level.centerX);
    const dy = Math.abs(sphereLightSpace.y - level.centerY);
    if (dx <= reach && dy <= reach) {
      level.forceDirty = true;
      level.dirtyReasonBits |= DIRTY_REASON_BITS.forceDirty;
      touched.push({ index: level.index, reason });
    }
  }
  return touched;
}

export function computeSelectionWeights(levels, pointLightSpace, blendRatio) {
  let remaining = 1;
  const weights = [];
  for (const level of levels) {
    const distance = Math.max(
      Math.abs(pointLightSpace.x - level.centerX),
      Math.abs(pointLightSpace.y - level.centerY),
    );
    const inner = level.sampledHalfWidth * (1 - blendRatio);
    const outer = level.sampledHalfWidth;
    const fade = level.valid ? 1 - smoothstep(inner, outer, distance) : 0;
    const weight = fade * remaining;
    remaining *= 1 - fade;
    weights.push({ index: level.index, weight, fade, distance });
  }
  return { weights, unshadowedWeight: remaining };
}

export function estimateShadowMemoryBytes(
  levels,
  bytesPerDepthTexel = DEFAULT_CLIPMAP_CONFIG.bytesPerDepthTexel,
) {
  return levels.reduce(
    (sum, level) => sum + level.mapSize * level.mapSize * bytesPerDepthTexel,
    0,
  );
}

export function validateClipmapConfig(config = DEFAULT_CLIPMAP_CONFIG) {
  const errors = [];
  const clamped = clampClipmapConfig(config);
  const levels = createClipmapLevels(clamped);

  if (clamped.levelCount !== computeLevelCount(clamped)) {
    errors.push("level-count formula mismatch");
  }
  if (levels.length > clamped.sampledTextureLimit) {
    errors.push("sampled texture limit exceeded; reduce level count before resolution");
  }
  if (estimateShadowMemoryBytes(levels, clamped.bytesPerDepthTexel) > clamped.memoryBudgetBytes) {
    errors.push("shadow depth memory exceeds budget");
  }
  if (clamped.dynamicLevels > clamped.levelCount) {
    errors.push("dynamicLevels exceeds level count");
  }
  if (clamped.guardBand < 0.02 || clamped.guardBand > 0.5) {
    errors.push("guardBand outside safe range");
  }
  if (clamped.blendRatio < 0.01 || clamped.blendRatio > 0.9) {
    errors.push("blendRatio outside safe range");
  }
  for (const level of levels) {
    if (level.inverseMapSize !== 1 / level.mapSize) {
      errors.push(`level ${level.index} inverseMapSize must equal 1 / mapSize`);
    }
  }

  return {
    ok: errors.length === 0,
    errors,
    config: clamped,
    levels,
  };
}

function smoothstep(edge0, edge1, value) {
  const t = Math.min(Math.max((value - edge0) / (edge1 - edge0), 0), 1);
  return t * t * (3 - 2 * t);
}
