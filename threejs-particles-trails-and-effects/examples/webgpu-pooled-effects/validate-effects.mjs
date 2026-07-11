import assert from "node:assert/strict";
import { readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { BoxGeometry } from "three";

import {
  BLOOM_MODES,
  EFFECT_TIERS,
  EffectPool,
  createSpawnPacket,
  validateHDRHierarchy,
} from "./effect-pool.js";
import { computeBounds, softDepthFade, validateDepthPolicy } from "./depth-policy.js";
import { createReentryShell, estimateShellBudget, flowFacingMask } from "./reentry-shell.js";
import { PooledEffectsDemo } from "./main.js";

const here = dirname(fileURLToPath(import.meta.url));

function runPoolValidation() {
  const pool = new EffectPool({ capacity: 64, lifetimeSeconds: 1.3 });
  const packet = createSpawnPacket({
    seed: 9001,
    count: 32,
    position: [0, 2, 0],
    flowDirectionWorld: [0.2, -1, 0.1],
  });
  const firstSpawn = pool.spawn(packet);
  const replay = new EffectPool({ capacity: 64, lifetimeSeconds: 1.3 });
  const secondSpawn = replay.spawn(packet);
  assert.deepEqual(firstSpawn, secondSpawn, "deterministic seed replay");
  assert.deepEqual(
    Array.from(pool.startPosition.array.slice(0, 16)),
    Array.from(replay.startPosition.array.slice(0, 16)),
    "seeded storage values replay",
  );

  pool.assertDenseRange();
  assert.equal(pool.liveCount, 32);
  const last = pool.indexToEntity[pool.liveCount - 1];
  const snapshot = pool.snapshotEntity(last);
  const result = pool.removeAt(11);
  assert.equal(result.movedEntity, last);
  pool.assertSnapshot(last, snapshot);
  pool.update(1 / 60);
  pool.assertDenseRange();
  assert.equal(pool.allocationCounter, 0, "no per-frame allocation counter");
  assert(pool.overflowDrops === 0);
  return pool;
}

function runShellValidation() {
  const shell = createReentryShell({
    hullGeometry: new BoxGeometry(1.2, 0.7, 3.8),
    flowDirectionWorld: [0, -1, -0.2],
    tier: "high",
  });
  const budget = estimateShellBudget(shell);
  assert(shell.hullSampleCount > 0, "hull samples");
  assert(shell.supportPoint.length === 3, "support point");
  assert(budget.vertices > 1000, "shell vertex count");
  assert(budget.triangles > 1000, "shell triangle count");
  assert(flowFacingMask({ x: 0, y: 1, z: 0 }, { x: 0, y: -1, z: 0 }) > 0.9);
  return { shell, budget };
}

const pool = runPoolValidation();
const { budget } = runShellValidation();

assert(validateHDRHierarchy(), "HDR hierarchy ordering");
assert(validateDepthPolicy(), "depth policy");
assert(softDepthFade({ sceneDepthMeters: 10, effectDepthMeters: 9.5 }) > 0);
assert(!computeBounds([{ position: [0, 0, 0] }]).isEmpty());

const demo = new PooledEffectsDemo({ tier: "medium", seed: 42 });
const hull = demo.createFixtureHull();
demo.spawnEvent();
demo.attachReentryShell(hull);
demo.update(1 / 60);
demo.setDebugMode("raw HDR");
assert.equal(demo.pipelineContract.bloomMode, BLOOM_MODES.FULL_SCENE);
assert.equal(demo.pipelineContract.contributionMRT, null, "default bloom adds no MRT");
assert(demo.validateContracts());
demo.dispose();

const selectiveDemo = new PooledEffectsDemo({
  tier: "medium",
  seed: 42,
  bloomMode: BLOOM_MODES.SELECTIVE_EMISSIVE,
});
assert(selectiveDemo.pipelineContract.contributionMRT, "selective bloom MRT descriptor");
assert.equal(selectiveDemo.pipelineContract.bloom.source, "MRT emissive");
assert(selectiveDemo.validateContracts());
selectiveDemo.dispose();

for (const [tier, config] of Object.entries(EFFECT_TIERS)) {
  assert(config.poolCap > 0, `${tier} pool cap`);
  assert(config.shellLayers >= 1, `${tier} shell layers`);
  assert(config.bloomScale > 0 && config.bloomScale <= 0.5, `${tier} bloom scale`);
}

const source = [
  "README.md",
  "effect-pool.js",
  "reentry-shell.js",
  "depth-policy.js",
  "dense-swap.test.mjs",
  "main.js",
]
  .map((file) => readFileSync(resolve(here, file), "utf8"))
  .join("\n");
const readme = readFileSync(resolve(here, "README.md"), "utf8");

for (const required of [
  "WebGPURenderer",
  "RenderPipeline",
  "StorageInstancedBufferAttribute",
  "Fn(",
  "renderer.compute",
  "instancedArray",
  "supportPoint",
  "flowDirectionWorld",
  "flowFacingMask",
  "hullSample",
  "wakeOrigin",
  "shearLobe",
  "MRT",
  "emissive",
  "spark",
  "debris",
  "wake",
  "rendererInfo",
  "softDepthFade",
  "occluder",
  "computeBounds",
  "point-size",
]) {
  assert(source.includes(required), `missing ${required}`);
}

assert.match(
  readme,
  /These checks do not prove GPU execution\./,
  "Node validation must not be presented as GPU-execution evidence",
);
assert.match(
  readme,
  /lab\.manifest\.json` therefore remains `incomplete` until the browser capture/,
  "uncaptured native-WebGPU evidence must keep the artifact manifest incomplete",
);
assert.match(
  readme,
  /Missing timing is\s+`INSUFFICIENT_EVIDENCE`, never zero cost\./,
  "missing measurements must not be encoded as zero-cost evidence",
);

const report = {
  pool: {
    capacity: pool.capacity,
    liveCount: pool.liveCount,
    swapCount: pool.swapCount,
    overflowDrops: pool.overflowDrops,
  },
  shell: budget,
  hdrHierarchy: true,
  deterministicSeed: 9001,
  noPerFrameAllocationCounter: pool.allocationCounter,
};

const reportPath =
  process.env.EFFECT_VALIDATION_REPORT ?? resolve(tmpdir(), "webgpu-pooled-effects.json");
writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`);
console.log(`webgpu-pooled-effects validation passed: ${reportPath}`);
