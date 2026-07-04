import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import {
  DEFAULT_CLIPMAP_CONFIG,
  DIRTY_REASON_BITS,
  clampClipmapConfig,
  commitLevelRender,
  computeLevelCount,
  computeSelectionWeights,
  createClipmapLevels,
  directionChanged,
  estimateShadowMemoryBytes,
  invalidateSphere,
  inverseMapSize,
  selectLevelsForUpdate,
  snapLightSpaceCenter,
  validateClipmapConfig,
} from "./clipmap-config.js";
import {
  CachedClipmapShadowNode,
  createBiasNodePlan,
  createUnconditionalSamplingPlan,
  validateDisposeCounters,
} from "./clipmap-shadow-node.js";
import {
  createCachedClipmapShadowSystem,
  createShadowArchitectureDecisionRecord,
} from "./main.js";

const here = dirname(fileURLToPath(import.meta.url));

const config = clampClipmapConfig(DEFAULT_CLIPMAP_CONFIG);
assert.equal(
  config.levelCount,
  computeLevelCount(config),
  "level-count formula must match default config",
);

const validation = validateClipmapConfig(config);
assert.equal(validation.ok, true, validation.errors.join("\n"));
assert(validation.levels.length >= 3);
assert(estimateShadowMemoryBytes(validation.levels) <= config.memoryBudgetBytes);

const levels = createClipmapLevels(config);
assert(levels.every((level) => level.valid === false));
assert(levels.every((level) => Math.abs(level.centerX) === 1e9));

for (const level of levels) {
  assert.equal(inverseMapSize(level), 1 / level.mapSize);
  assert.equal(level.inverseMapSize, 1 / level.mapSize);
}

const desired = snapLightSpaceCenter({ x: 13.2, y: -9.7, z: 51 }, levels[0]);
assert.equal(desired.x % levels[0].texelWidth, 0);
commitLevelRender(levels[0], desired);
assert.equal(levels[0].valid, true);
assert.equal(levels[0].centerX, desired.x);

const desiredButNotCommitted = snapLightSpaceCenter(
  { x: 100, y: 200, z: 300 },
  levels[1],
);
assert.notEqual(levels[1].centerX, desiredButNotCommitted.x);

const selection = selectLevelsForUpdate({
  levels,
  cameraLight: { x: 250, y: -100, z: 20 },
  config,
});
assert(selection.selected.some((item) => item.dynamic));
assert(selection.budgetAfter >= 0);

levels.at(-1).valid = true;
levels.at(-1).centerX = 0;
levels.at(-1).centerY = 0;
levels.at(-1).centerZ = 0;
levels.at(-1).forceDirty = true;
const forcedSelection = selectLevelsForUpdate({
  levels,
  cameraLight: { x: 0, y: 0, z: 0 },
  config: { ...config, updateBudget: 1, dynamicLevels: 0 },
});
assert(
  forcedSelection.selected.some((item) => item.forced && !item.budgeted),
  "forced invalidation must bypass ordinary cached budget",
);

const refreshedAll = selectLevelsForUpdate({
  levels: createClipmapLevels(config),
  cameraLight: { x: 0, y: 0, z: 0 },
  config,
  lightDirectionChanged: directionChanged(Math.cos(config.directionEpsilon * 2), config.directionEpsilon),
});
assert.equal(refreshedAll.budgetBefore, config.levelCount);

const staggeredAges = createClipmapLevels(config).map((level) => level.age);
assert(new Set(staggeredAges).size > 1, "initial ages must be staggered");

const touched = invalidateSphere(levels, {
  x: levels[0].centerX,
  y: levels[0].centerY,
  radius: 1,
});
assert(touched.length >= 1);

const invalidWeights = computeSelectionWeights(createClipmapLevels(config), { x: 0, y: 0 }, config.blendRatio);
assert.equal(
  invalidWeights.weights.some((weight) => weight.weight > 0),
  false,
  "invalid sentinel levels must never win selection",
);

const samplingPlan = createUnconditionalSamplingPlan(levels);
assert.equal(samplingPlan.length, levels.length);
assert(
  samplingPlan.every((entry) => entry.sample.includes("unconditionally")),
  "comparison sampling must be unconditional before weighting",
);
assert(
  createBiasNodePlan(levels).every((entry) => entry.normalBias > 0),
  "normal bias must scale by texel width",
);

const architecture = createShadowArchitectureDecisionRecord({
  receiverBounded: false,
  streamingPersistentCoverage: true,
  measuredGpuTimes: {
    DirectionalLightShadow: 4.6,
    CSMShadowNode: 3.4,
    TileShadowNode: 2.7,
    "custom cached clipmap": 1.2,
  },
});
assert.equal(architecture.selected.use, "custom cached clipmap");
assert(architecture.requirement.includes("persistent coarse"));

const system = createCachedClipmapShadowSystem({ config });
assert.equal(system.light.shadow.shadowNode, system.node);
system.update({ x: 4, y: 8, z: 12 });
assert(system.debugSnapshot().levelCount > 0);
system.dispose();
assert.equal(validateDisposeCounters(system.node).ok, true);

const directNode = Object.create(CachedClipmapShadowNode.prototype);
directNode.light = { shadow: {} };
directNode.config = config;
directNode.levels = createClipmapLevels(config);
directNode.disposeCounters = {
  shadowNodes: 0,
  clonedShadows: 0,
  levelLights: 0,
  levelTargets: 0,
  storageBuffers: 0,
  debugTextures: 0,
};
assert.equal(directNode.setupShadowCoord(null, "shadowPositionWorld").hook, "setupShadowCoord");
assert.equal(directNode.setupShadowFilter(null, {}).length, directNode.levels.length);

const source = [
  "clipmap-config.js",
  "clipmap-shadow-node.js",
  "debug-views.js",
  "main.js",
  "README.md",
]
  .map((file) => readFileSync(resolve(here, file), "utf8"))
  .join("\n");

for (const required of [
  "inverseMapSize",
  "mapSize",
  "setupShadowFilter",
  "unconditional",
  "seed",
  "movingHero",
  "alphaTest",
  "wind",
  "invalidate",
  "slowPan",
  "teleport",
  "directionEpsilon",
  "CSMShadowNode",
  "TileShadowNode",
  "custom cached clipmap",
]) {
  assert(source.includes(required), `missing ${required}`);
}

assert.equal(
  Boolean(DIRTY_REASON_BITS.forceDirty),
  true,
  "dirty reason bits must expose forced invalidation",
);

console.log("webgpu-cached-clipmap-shadow validation passed");
