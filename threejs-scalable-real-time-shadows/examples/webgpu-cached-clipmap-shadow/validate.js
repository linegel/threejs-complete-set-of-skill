import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
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
  createSharedDisplacedCaster,
  createShadowArchitectureDecisionRecord,
} from "./main.js";

const here = dirname(fileURLToPath(import.meta.url));
const args = parseArgs(process.argv.slice(2));

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
const firstRenderer = createMockRenderer();
await system.update(
  { x: 4, y: 8, z: 12 },
  { renderer: firstRenderer, frameId: 1, deformationTime: 0 },
);
const selectedCount = system.node.lastSelection.selected.length;
assert(selectedCount > 0, "scheduler must select at least one level for initial render");
assert.equal(
  firstRenderer.renderCalls.length,
  selectedCount,
  "renderShadow must issue one caster draw per selected level",
);
assert.equal(
  firstRenderer.renderCalls.every((call) => call.scene === system.casterScene),
  true,
  "renderShadow must draw the caster scene passed in the frame",
);
assert.equal(
  firstRenderer.renderCalls.every((call) => call.target?.depthTexture),
  true,
  "each scheduled level render must bind a target with a DepthTexture",
);
assert.equal(
  firstRenderer.renderCalls.every((call) => call.camera?.isOrthographicCamera),
  true,
  "each scheduled level render must use a fitted OrthographicCamera",
);
assert.equal(
  system.node.lastSelection.selected.every((item) => item.level.renderCount > 0),
  true,
  "renderShadow must commit only after selected levels are rendered",
);
assert(system.debugSnapshot().levelCount > 0);

const secondRenderer = createMockRenderer();
await system.update(
  { x: 4, y: 8, z: 12 },
  { renderer: secondRenderer, frameId: 2, deformationTime: 1 },
);
assert.equal(
  system.node.lastSelection.deformationInvalidations.length,
  1,
  "changing the displacement field time must invalidate cached shadow levels",
);
assert.equal(
  system.node.lastSelection.deformationInvalidations[0].touched.length,
  system.levels.length,
  "unbounded deformation changes must mark every level dirty",
);
assert(
  system.node.lastSelection.selected.some((item) => item.forced),
  "deformation dirty bits must force at least one cached level through scheduling",
);
assert(
  secondRenderer.renderCalls.length >= config.dynamicLevels + 1,
  "deformation invalidation must trigger new shadow renders beyond the dynamic baseline",
);
system.dispose();
assert.equal(validateDisposeCounters(system.node).ok, true);

const parity = createSharedDisplacedCaster();
assert.equal(
  parity.material.positionNode,
  parity.material.castShadowPositionNode,
  "visible positionNode and castShadowPositionNode must be the same node object",
);
assert.equal(
  parity.material.positionNode,
  parity.material.receivedShadowPositionNode,
  "receivedShadowPositionNode must share the same displacement node object",
);
assert.equal(
  parity.mesh.userData.shadowCasterParity.sharedPositionNode,
  parity.material.positionNode,
  "the example must expose the shared displacement node identity for validation",
);

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

assert.equal(
  Boolean(DIRTY_REASON_BITS.forceDirty),
  true,
  "dirty reason bits must expose forced invalidation",
);
assert.equal(
  Boolean(DIRTY_REASON_BITS.deformationChanged),
  true,
  "dirty reason bits must expose deformation-aware invalidation",
);

const artifactStatus = validateArtifacts(args);
if (artifactStatus.ok) {
  console.log(`gpu artifact validation: ${artifactStatus.status}`);
  console.log("webgpu-cached-clipmap-shadow validation passed");
} else if (args.allowMissingGpu) {
  console.log(`gpu artifact validation: not-run (${artifactStatus.reason})`);
  console.log("webgpu-cached-clipmap-shadow validation passed");
} else {
  console.error(`gpu artifact validation: not-run (${artifactStatus.reason})`);
  process.exitCode = 1;
}

function createMockRenderer() {
  return {
    currentTarget: null,
    renderCalls: [],
    setRenderTargetCalls: [],
    clearDepthCalls: 0,
    getRenderTarget() {
      return this.currentTarget;
    },
    setRenderTarget(target) {
      this.currentTarget = target;
      this.setRenderTargetCalls.push(target);
    },
    clearDepth() {
      this.clearDepthCalls += 1;
    },
    clear() {},
    render(scene, camera) {
      this.renderCalls.push({ scene, camera, target: this.currentTarget });
    },
  };
}

function parseArgs(argv) {
  const parsed = {
    allowMissingGpu: false,
    artifactsDir: null,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--allow-missing-gpu") {
      parsed.allowMissingGpu = true;
    } else if (arg === "--artifacts") {
      parsed.artifactsDir = argv[index + 1] ? resolve(argv[index + 1]) : null;
      index += 1;
    } else {
      throw new Error(`unknown argument: ${arg}`);
    }
  }

  return parsed;
}

function validateArtifacts({ artifactsDir }) {
  if (!artifactsDir) {
    return { ok: false, reason: "missing --artifacts <dir>" };
  }

  const shadowMapPath = resolve(artifactsDir, "shadow-map.png");
  const silhouettePath = resolve(artifactsDir, "silhouette.png");
  if (!existsSync(shadowMapPath) || !existsSync(silhouettePath)) {
    return {
      ok: false,
      reason: `expected ${shadowMapPath} and ${silhouettePath}`,
    };
  }

  const shadowMap = readFileSync(shadowMapPath);
  const silhouette = readFileSync(silhouettePath);
  assert(shadowMap.length > 128, "shadow-map artifact is too small to be a real capture");
  assert(silhouette.length > 128, "silhouette artifact is too small to be a real capture");
  assert.notDeepEqual(
    shadowMap,
    silhouette,
    "shadow-map and silhouette artifacts must differ",
  );

  return { ok: true, status: `diffed ${shadowMapPath} against ${silhouettePath}` };
}
