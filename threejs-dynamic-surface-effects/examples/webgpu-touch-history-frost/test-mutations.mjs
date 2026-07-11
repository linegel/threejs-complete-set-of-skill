import assert from "node:assert/strict";

import {
  TimestampedDirtyTileHistory,
  assertDistinctHistoryBindings,
  computeDispatchSize,
  computeFrostExtents,
  computeSideAwareRefraction,
  exactDielectricFresnel,
  resolveFrostGraphContract,
  screenPeriodPhase,
  solveDecayDeposit,
  validateDiffusionStep,
} from "./frost-surface-effect.js";

const odd = computeDispatchSize(641, 359, 8);
const floorMutation = { x: Math.floor(641 / 8), y: Math.floor(359 / 8) };
assert(floorMutation.x * 8 < 641 || floorMutation.y * 8 < 359, "floor-dispatch mutation fixture is invalid");
assert(odd.x * 8 >= 641 && odd.y * 8 >= 359, "odd-size coverage mutation was not rejected");

const dirty = new TimestampedDirtyTileHistory({ tileCount: 1, initialValue: 1, initialTime: 0 });
const correct = dirty.materialize(0, 12);
const omitAgeCatchUpMutation = 1;
assert(correct < omitAgeCatchUpMutation - 0.1, "dirty-tile age-catch-up mutation must fail");

let partitioned = 0;
for (let frame = 0; frame < 120; frame += 1) {
  partitioned = solveDecayDeposit(partitioned, 0.64, 1 / 120);
}
const unpartitioned = solveDecayDeposit(0, 0.64, 1);
assert(Math.abs(partitioned - unpartitioned) < 1e-12, "per-frame deposit mutation must fail partition invariance");

assert.throws(() => validateDiffusionStep(2, 0.2), /unstable explicit diffusion/);

const textureA = { name: "A" };
const textureB = { name: "B" };
const nodeA = { value: textureA };
const nodeB = { value: textureB };
assert.equal(assertDistinctHistoryBindings({
  readTexture: textureA,
  writeTexture: textureB,
  readNode: nodeA,
  writeNode: nodeB,
}), true);
assert.throws(() => assertDistinctHistoryBindings({
  readTexture: textureA,
  writeTexture: textureB,
  readNode: nodeA,
  writeNode: nodeA,
}), /distinct read and write texture nodes/, "mutable-node alias mutation must be rejected");
assert.throws(() => assertDistinctHistoryBindings({
  readTexture: textureA,
  writeTexture: textureA,
  readNode: nodeA,
  writeNode: nodeB,
}), /distinct read and write textures/, "texture-slot alias mutation must be rejected");
assert.throws(() => assertDistinctHistoryBindings({
  readTexture: textureA,
  writeTexture: textureB,
  readNode: nodeB,
  writeNode: nodeA,
}), /do not match/, "diagnostic nodes bound to the wrong resources must be rejected");

const physicalNormal = exactDielectricFresnel(1, 1, 1.31).reflectance;
const falseMaskFresnelMutation = (1 - 0.4 * 0.8) ** 5;
assert(Math.abs(physicalNormal - falseMaskFresnelMutation) > 0.1, "mask-derived false Fresnel mutation must fail");
const thin = computeSideAwareRefraction({
  slope: { x: 0.45, y: 0.2 },
  thickness: 1,
  side: "outside",
  resolution: { x: 1200, y: 800 },
});
const thick = computeSideAwareRefraction({
  slope: { x: 0.45, y: 0.2 },
  thickness: 3,
  side: "outside",
  resolution: { x: 1200, y: 800 },
});
assert(Math.abs(thick.uvOffset.x - thin.uvOffset.x * 3) < 1e-15, "ignored-thickness mutation must fail");
const inside = computeSideAwareRefraction({
  slope: { x: 2, y: 0 },
  side: "inside",
  resolution: { x: 1200, y: 800 },
});
assert.equal(inside.totalInternalReflection, true, "one-sided no-TIR mutation must fail");

const correctPhase = screenPeriodPhase(600, 1200);
const invertedPeriodMutation = 2 * Math.PI * 600 * 1200;
assert.equal(correctPhase, Math.PI);
assert.notEqual(correctPhase, invertedPeriodMutation, "period-as-frequency mutation must fail");

const routeHistory = resolveFrostGraphContract("history-and-deposit", "balanced", 1200, 800);
const routeDiffusion = resolveFrostGraphContract("diffusion", "balanced", 1200, 800);
const routeBenchmark = resolveFrostGraphContract("full-vs-dirty-vs-idle", "balanced", 1200, 800);
assert.notDeepEqual(routeHistory.reachableNodes, routeDiffusion.reachableNodes, "metadata-only mechanism routes must fail");
assert.equal(routeBenchmark.benchmarkLedger, true, "benchmark route without a reachable ledger resource must fail");
const tierFull = resolveFrostGraphContract("refraction-and-fresnel", "full", 1200, 800);
const tierBudgeted = resolveFrostGraphContract("refraction-and-fresnel", "budgeted", 1200, 800);
assert.notEqual(tierFull.extents.historyWidth, tierBudgeted.extents.historyWidth, "metadata-only tier routes must fail");
assert.notEqual(tierFull.refractionScaleCount, tierBudgeted.refractionScaleCount, "tier graph mutation must remove the detail normal");

const resizedBalanced = computeFrostExtents({ drawingWidth: 961, drawingHeight: 538, historyScale: 0.5 });
const frozenFullScaleMutation = { historyWidth: 961, historyHeight: 538 };
assert.deepEqual([resizedBalanced.historyWidth, resizedBalanced.historyHeight], [481, 269]);
assert.notDeepEqual(
  [resizedBalanced.historyWidth, resizedBalanced.historyHeight],
  [frozenFullScaleMutation.historyWidth, frozenFullScaleMutation.historyHeight],
  "resize must reapply the declared reduced-resolution tier scale",
);

console.log("dynamic-surface mutation suite passed");
