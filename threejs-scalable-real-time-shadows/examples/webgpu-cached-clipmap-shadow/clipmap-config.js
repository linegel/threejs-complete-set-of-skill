export const DIRTY_REASON_BITS = Object.freeze({
  dynamicNear: 1 << 0,
  neverRendered: 1 << 1,
  forceDirty: 1 << 2,
  snappedCenterChanged: 1 << 3,
  cacheAgeExpired: 1 << 4,
  lightDirectionChanged: 1 << 5,
  deformationChanged: 1 << 6,
});

export const CLIPMAP_IMPLEMENTATION_STATUS = Object.freeze({
  phase: "phase-1-scaffold",
  productionClipmapProof: false,
  receiverBlendImplemented: false,
  validatedClaims: Object.freeze([
    "CPU level scheduling",
    "controlled-fixture per-level renderer command issuance",
    "committed-center state",
    "nominal Phase-1 color-plus-depth target-byte estimation",
    "actual level-target disposal calls, including attached depth resources",
    "local-space caster parity",
  ]),
  missingProductionProof: Object.freeze([
    "per-level TSL receiver sampling",
    "committed per-level shadow matrices in the material graph",
    "committed light-basis and shadow-depth-interval epochs",
    "cross-level receiver blending",
    "lit receiver capture driven by cached level targets",
    "wired per-level bias/filter state",
    "r185 shadow override/caster filtering and shadow callbacks",
    "cloned-shadow, child-light, storage, and debug-resource ownership",
    "real-renderer dispose/recreate memory balance",
  ]),
});

export const DEFAULT_CLIPMAP_CONFIG_EVIDENCE = Object.freeze({
  context:
    "deterministic Phase-1 validation fixture; values are neither production defaults nor measured budgets",
  Authored: Object.freeze([
    "coverage radii/scale",
    "map dimensions",
    "guard/fade",
    "dynamic-level policy",
    "cache age",
    "light-direction tolerance",
    "fixture bias hypothesis",
    "nominal four-byte depth24plus accounting assumption (not physical allocation)",
  ]),
  Derived: Object.freeze([
    "level count",
    "per-level texel widths",
    "RGBA8 color payload bytes",
    "nominal target-byte estimate",
  ]),
  Gated: Object.freeze([
    "update/correction queue ceilings",
    "adjacent coverage ratio",
    "sampled-texture ceiling",
    "nominal memory ceiling",
    "fixture light-depth interval validity",
  ]),
});

export function validateClipmapProofClaim(claim = CLIPMAP_IMPLEMENTATION_STATUS.phase) {
  if (claim !== CLIPMAP_IMPLEMENTATION_STATUS.phase) {
    return {
      ok: false,
      claim,
      reason:
        "production clipmap proof is unavailable until receiver sampling/blending and a lit receiver capture are implemented",
    };
  }

  return { ok: true, claim, reason: null };
}

export const SHADOW_ARCHITECTURE_DECISIONS = Object.freeze([
  {
    need: "bounded receiver/caster volume",
    use: "DirectionalLightShadow",
    cost: "one shadow view and one depth map",
  },
  {
    need: "camera-following cascades",
    use: "CSMShadowNode",
    importPath: "three/addons/csm/CSMShadowNode.js",
    cost: "L shadow views and L depth maps",
  },
  {
    need: "large tiled projection without persistent cache state",
    use: "TileShadowNode",
    importPath: "three/addons/tsl/shadows/TileShadowNode.js",
    cost:
      "one ArrayCamera renderer invocation; N = tilesX * tilesY backend layer render passes and coordinate/containment branches with conditional comparison work; union-frustum render-list objects can draw into every layer",
  },
  {
    need: "large persistent coverage with localized content changes",
    use: "custom cached clipmap",
    cost:
      "selected level views update; the r185 portable receiver keeps L independent child nodes statically reachable and each child frustum-gates its comparison, while a future packed path would need validated one/two-layer fade-containment invariants",
    status: CLIPMAP_IMPLEMENTATION_STATUS.phase,
  },
]);

// Authored Phase-1 fixture values. See DEFAULT_CLIPMAP_CONFIG_EVIDENCE.
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
  correctionBudget: 2,
  maxCacheAge: 64,
  directionEpsilon: 0.002,
  minAdjacentCoverageRatio: 1.25,
  baseBias: 0,
  baseNormalBias: 0.02,
  mapSizes: [2048, 1024, 1024, 512, 512, 512],
  bytesPerDepthTexel: 4,
  bytesPerColorTexel: 4,
  sampledTextureLimit: 8,
  memoryBudgetBytes: 64 * 1024 * 1024,
});

export function computeLevelCount({
  firstRadius = DEFAULT_CLIPMAP_CONFIG.firstRadius,
  scaleFactor = DEFAULT_CLIPMAP_CONFIG.scaleFactor,
  maxDistance = DEFAULT_CLIPMAP_CONFIG.maxDistance,
} = {}) {
  if (
    !Number.isFinite(firstRadius) ||
    !Number.isFinite(scaleFactor) ||
    !Number.isFinite(maxDistance) ||
    firstRadius <= 0 ||
    scaleFactor <= 1 ||
    maxDistance < firstRadius
  ) {
    throw new RangeError(
      "clipmap derivation requires finite firstRadius > 0, scaleFactor > 1, and maxDistance >= firstRadius",
    );
  }
  return Math.ceil(Math.log(maxDistance / firstRadius) / Math.log(scaleFactor)) + 1;
}

export function clampClipmapConfig(config = {}) {
  const merged = { ...DEFAULT_CLIPMAP_CONFIG, ...config };
  const errors = validateRawConfig(merged);
  if (errors.length > 0) {
    throw new RangeError(errors.join("; "));
  }
  const levelCount = computeLevelCount(merged);
  return {
    ...merged,
    levelCount,
    dynamicLevels: Math.min(merged.dynamicLevels, levelCount),
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
  if (![cameraLight.x, cameraLight.y, cameraLight.z].every(Number.isFinite)) {
    throw new RangeError("cameraLight coordinates must be finite");
  }
  const texelWidth = worldTexelWidth(level.halfWidth, level.mapSize);
  return {
    x: Math.round(cameraLight.x / texelWidth) * texelWidth,
    y: Math.round(cameraLight.y / texelWidth) * texelWidth,
    // Phase 1 snaps only the projected XY grid. Production Z must come from a
    // conservative biased-receiver plus relevant-occluder light-depth fit
    // with guarded hysteresis; this scaffold
    // carries the supplied light-space Z without an unrelated XY heuristic.
    z: cameraLight.z,
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
      normalBias: null,
      normalBiasHypothesis:
        clamped.baseNormalBias * (texelWidth / finestTexelWidth),
      bias: clamped.baseBias,
      centerX: 1e9,
      centerY: 1e9,
      centerZ: 0,
      valid: false,
      forceDirty: false,
      age: Math.floor((-index * clamped.maxCacheAge) / clamped.levelCount),
      updateDebt: 0,
      lastUpdateFrame: -1,
      desiredCenterLight: null,
      desiredDepthInterval: null,
      committedDepthInterval: null,
      committedBasisEpoch: -1,
      contentEpoch: 0,
      renderedContentEpoch: -1,
      invalidReasonBits: DIRTY_REASON_BITS.neverRendered,
      dirtyReasonBits: DIRTY_REASON_BITS.neverRendered,
      renderCount: 0,
      disposed: false,
    });
  }

  return levels;
}

export function directionChanged(dotCurrentPrevious, directionEpsilon) {
  if (!Number.isFinite(dotCurrentPrevious) || !Number.isFinite(directionEpsilon)) {
    throw new RangeError("direction comparison inputs must be finite");
  }
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
  let remainingCorrectionBudget = clamped.correctionBudget;
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
    const correctionAllowed = !forced || remainingCorrectionBudget > 0;
    const shouldUpdate =
      dirty !== 0 && correctionAllowed && (dynamic || forced || remainingBudget > 0);

    if (shouldUpdate) {
      selected.push({ level, desired, dirty, dynamic, forced, budgeted });
      if (forced) {
        remainingCorrectionBudget -= 1;
      } else if (budgeted) {
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
    correctionBudgetBefore: clamped.correctionBudget,
    correctionBudgetAfter: remainingCorrectionBudget,
  };
}

/**
 * Correctness-first, starvation-bounded scheduler used by the receiver-backed
 * v2 clipmap. Forced content repair has its own cap; ordinary cache refreshes
 * use age/debt priority with a round-robin tie break so a stable fine level
 * cannot permanently starve coarse coverage.
 */
export function selectLevelsForUpdateFair({
  levels,
  cameraLight,
  config = DEFAULT_CLIPMAP_CONFIG,
  lightDirectionChanged = false,
  schedulerState = { roundRobinCursor: 0 },
  frameId = 0,
}) {
  const clamped = clampClipmapConfig(config);
  const levelCount = levels.length;
  const cursor = ((schedulerState.roundRobinCursor ?? 0) % levelCount + levelCount) % levelCount;
  const candidates = [];

  for (const level of levels) {
    level.age += 1;
    level.updateDebt = Math.max(0, (level.updateDebt ?? 0) + 1);
    const desired = snapLightSpaceCenter(cameraLight, level);
    const dirty = classifyLevelDirty({
      level,
      desired,
      config: clamped,
      lightDirectionChanged,
    });
    level.dirtyReasonBits = dirty;
    const forced = level.forceDirty === true;
    const dynamic = level.index < clamped.dynamicLevels;
    const neverRendered = !level.valid && level.renderCount === 0;
    const coverageChanged = Boolean(dirty & DIRTY_REASON_BITS.snappedCenterChanged);
    const ringDistance = (level.index - cursor + levelCount) % levelCount;

    if (dirty !== 0) {
      candidates.push({
        level,
        desired,
        dirty,
        forced,
        dynamic,
        neverRendered,
        coverageChanged,
        ringDistance,
        priorityClass: lightDirectionChanged
          ? 0
          : forced
            ? 1
            : neverRendered
              ? 2
              : dynamic || coverageChanged
                ? 3
                : 4,
      });
    }
  }

  candidates.sort((a, b) =>
    a.priorityClass - b.priorityClass ||
    b.level.updateDebt - a.level.updateDebt ||
    b.level.age - a.level.age ||
    a.ringDistance - b.ringDistance,
  );

  let ordinaryRemaining = lightDirectionChanged
    ? levelCount
    : Math.max(1, clamped.updateBudget);
  let correctionRemaining = lightDirectionChanged
    ? levelCount
    : clamped.correctionBudget;
  const selected = [];
  for (const candidate of candidates) {
    if (lightDirectionChanged) {
      selected.push(candidate);
      continue;
    }
    if (candidate.forced) {
      if (correctionRemaining <= 0) continue;
      correctionRemaining -= 1;
      selected.push(candidate);
      continue;
    }
    if (candidate.dynamic) {
      selected.push(candidate);
      continue;
    }
    if (ordinaryRemaining <= 0) continue;
    ordinaryRemaining -= 1;
    selected.push(candidate);
  }

  if (selected.length > 0) {
    schedulerState.roundRobinCursor =
      (selected.at(-1).level.index + 1) % Math.max(1, levelCount);
  }

  const selectedIndices = new Set(selected.map((entry) => entry.level.index));
  return {
    selected,
    diagnostics: candidates.map((candidate) => ({
      index: candidate.level.index,
      dirty: candidate.dirty,
      forced: candidate.forced,
      dynamic: candidate.dynamic,
      age: candidate.level.age,
      updateDebt: candidate.level.updateDebt,
      lastUpdateFrame: candidate.level.lastUpdateFrame,
      desired: candidate.desired,
      priorityClass: candidate.priorityClass,
      selected: selectedIndices.has(candidate.level.index),
      frameId,
    })),
    budgetBefore: lightDirectionChanged ? levelCount : clamped.updateBudget,
    budgetAfter: ordinaryRemaining,
    correctionBudgetBefore: lightDirectionChanged ? levelCount : clamped.correctionBudget,
    correctionBudgetAfter: correctionRemaining,
    roundRobinCursorBefore: cursor,
    roundRobinCursorAfter: schedulerState.roundRobinCursor,
  };
}

export function commitLevelRender(level, desired) {
  level.centerX = desired.x;
  level.centerY = desired.y;
  level.centerZ = desired.z;
  level.valid = true;
  level.forceDirty = false;
  level.age = 0;
  level.updateDebt = 0;
  level.invalidReasonBits = 0;
  level.dirtyReasonBits = 0;
  level.renderCount += 1;
  return level;
}

export function invalidateSphere(levels, sphereLightSpace, reason = "invalidate") {
  if (
    ![sphereLightSpace.x, sphereLightSpace.y, sphereLightSpace.radius].every(Number.isFinite) ||
    sphereLightSpace.radius < 0
  ) {
    throw new RangeError("invalidation sphere requires finite x/y and radius >= 0");
  }
  const touched = [];
  for (const level of levels) {
    const reach = level.halfWidth + sphereLightSpace.radius;
    const dx = Math.abs(sphereLightSpace.x - level.centerX);
    const dy = Math.abs(sphereLightSpace.y - level.centerY);
    if (dx <= reach && dy <= reach) {
      level.valid = false;
      level.forceDirty = true;
      level.dirtyReasonBits |= DIRTY_REASON_BITS.forceDirty;
      level.invalidReasonBits |= DIRTY_REASON_BITS.forceDirty;
      touched.push({ index: level.index, reason });
    }
  }
  return touched;
}

export function invalidateAllLevels(levels, reasonBit = DIRTY_REASON_BITS.forceDirty, reason = "invalidate") {
  const touched = [];
  for (const level of levels) {
    level.valid = false;
    level.forceDirty = true;
    level.dirtyReasonBits |= reasonBit;
    level.invalidReasonBits |= reasonBit;
    touched.push({ index: level.index, reason });
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
  bytesPerColorTexel = DEFAULT_CLIPMAP_CONFIG.bytesPerColorTexel,
) {
  return levels.reduce(
    (sum, level) =>
      sum +
      level.mapSize * level.mapSize *
        (bytesPerDepthTexel + bytesPerColorTexel),
    0,
  );
}

export function validateClipmapConfig(config = DEFAULT_CLIPMAP_CONFIG) {
  const candidate = { ...DEFAULT_CLIPMAP_CONFIG, ...config };
  const errors = validateRawConfig(candidate);
  if (errors.length === 0) {
    const candidateLevelCount = computeLevelCount(candidate);
    if (candidate.dynamicLevels > candidateLevelCount) {
      errors.push("dynamicLevels exceeds derived level count");
    }
  }
  if (errors.length > 0) {
    return {
      ok: false,
      errors,
      config: candidate,
      levels: [],
    };
  }

  const clamped = clampClipmapConfig(config);
  const levels = createClipmapLevels(clamped);

  if (clamped.levelCount !== computeLevelCount(clamped)) {
    errors.push("level-count formula mismatch");
  }
  if (levels.length > clamped.sampledTextureLimit) {
    errors.push("sampled texture limit exceeded; reduce level count before resolution");
  }
  if (
    estimateShadowMemoryBytes(
      levels,
      clamped.bytesPerDepthTexel,
      clamped.bytesPerColorTexel,
    ) > clamped.memoryBudgetBytes
  ) {
    errors.push("nominal Phase-1 color-plus-depth target memory exceeds budget");
  }
  for (const level of levels) {
    if (level.inverseMapSize !== 1 / level.mapSize) {
      errors.push(`level ${level.index} inverseMapSize must equal 1 / mapSize`);
    }
  }
  for (let index = 1; index < levels.length; index += 1) {
    const fine = levels[index - 1];
    const coarse = levels[index];
    const ratio = coarse.halfWidth / fine.halfWidth;
    if (ratio < clamped.minAdjacentCoverageRatio) {
      errors.push(
        `levels ${fine.index}/${coarse.index} coverage ratio ${ratio} is below minAdjacentCoverageRatio ${clamped.minAdjacentCoverageRatio}`,
      );
    }

    // Derived for the fixture's nearest-grid quantizer: each committed center
    // can be half a texel from the shared desired center in opposite directions.
    const worstRelativeSnapDelta = 0.5 * (fine.texelWidth + coarse.texelWidth);
    if (
      coarse.sampledHalfWidth <
      fine.sampledHalfWidth + worstRelativeSnapDelta
    ) {
      errors.push(
        `levels ${fine.index}/${coarse.index} fail Phase-1 sampled-domain containment after worst relative snap`,
      );
    }
  }

  return {
    ok: errors.length === 0,
    errors,
    config: clamped,
    levels,
  };
}

function validateRawConfig(config) {
  const errors = [];
  const finitePositive = (value) => Number.isFinite(value) && value > 0;
  const nonNegativeInteger = (value) => Number.isInteger(value) && value >= 0;
  const positiveInteger = (value) => Number.isInteger(value) && value > 0;

  if (!finitePositive(config.firstRadius)) errors.push("firstRadius must be finite and > 0");
  if (!(Number.isFinite(config.scaleFactor) && config.scaleFactor > 1)) {
    errors.push("scaleFactor must be finite and > 1");
  }
  if (!(Number.isFinite(config.maxDistance) && config.maxDistance >= config.firstRadius)) {
    errors.push("maxDistance must be finite and >= firstRadius");
  }
  if (!(Number.isFinite(config.guardBand) && config.guardBand > 0 && config.guardBand < 1)) {
    errors.push("guardBand must be finite and in (0, 1)");
  }
  if (!(Number.isFinite(config.blendRatio) && config.blendRatio > 0 && config.blendRatio < 1)) {
    errors.push("blendRatio must be finite and in (0, 1)");
  }
  if (!positiveInteger(config.updateBudget)) errors.push("updateBudget must be a positive integer");
  if (!positiveInteger(config.correctionBudget)) errors.push("correctionBudget must be a positive integer");
  if (!nonNegativeInteger(config.dynamicLevels)) errors.push("dynamicLevels must be a non-negative integer");
  if (!nonNegativeInteger(config.maxCacheAge)) errors.push("maxCacheAge must be a non-negative integer");
  if (!(Number.isFinite(config.directionEpsilon) && config.directionEpsilon >= 0 && config.directionEpsilon < Math.PI)) {
    errors.push("directionEpsilon must be finite and in [0, pi)");
  }
  if (!(Number.isFinite(config.minAdjacentCoverageRatio) && config.minAdjacentCoverageRatio > 1)) {
    errors.push("minAdjacentCoverageRatio must be finite and > 1");
  }
  if (!finitePositive(config.shadowNear) || !(Number.isFinite(config.shadowFarCap) && config.shadowFarCap > config.shadowNear)) {
    errors.push("Phase-1 authored shadow depth interval must satisfy 0 < near < far");
  }
  if (!(Number.isFinite(config.lightMargin) && config.lightMargin >= 0)) {
    errors.push("lightMargin must be finite and >= 0");
  }
  if (!Array.isArray(config.mapSizes) || config.mapSizes.length === 0 || !config.mapSizes.every(positiveInteger)) {
    errors.push("mapSizes must be a non-empty array of positive integers");
  }
  for (const key of ["bytesPerDepthTexel", "bytesPerColorTexel", "memoryBudgetBytes"]) {
    if (!finitePositive(config[key])) errors.push(`${key} must be finite and > 0`);
  }
  if (!positiveInteger(config.sampledTextureLimit)) {
    errors.push("sampledTextureLimit must be a positive integer");
  }
  for (const key of ["baseBias", "baseNormalBias"]) {
    if (!Number.isFinite(config[key])) errors.push(`${key} must be finite`);
  }

  return errors;
}

function smoothstep(edge0, edge1, value) {
  const t = Math.min(Math.max((value - edge0) / (edge1 - edge0), 0), 1);
  return t * t * (3 - 2 * t);
}
