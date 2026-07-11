import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { BoxGeometry, Matrix4, Scene, Vector3 } from "three";

import {
  GPUCompactionEffectPool,
  GPU_EFFECT_COMPACTION_CONTRACT,
  GPU_EFFECT_STORAGE_BINDINGS,
  compactSoAReference,
  computeEventEnvelopeSphere,
  exclusiveScanReference,
  integrateLinearDragExact,
} from "./gpu-compaction-pool.js";
import { buildEventFrame, computeSupportPoint, createHullSampleCache } from "./reentry-shell.js";
import { createReentryEffectVisuals } from "./effect-visuals.js";
import { EFFECT_TIERS } from "./effect-pool.js";
import {
  NativePooledEffectsLab,
  computeRgbaReadbackLayout,
  createPooledEffectsStage,
  derivePooledEffectsMechanismVerdicts,
} from "./lab.mjs";

const here = dirname(fileURLToPath(import.meta.url));

function integrateSchedule(hz, seconds) {
  let position = [1.25, -0.5, 2.75];
  let velocity = [4.5, 7.25, -2.1];
  const acceleration = [0.25, -9.80665, 1.1];
  const dt = 1 / hz;
  for (let step = 0; step < hz * seconds; step += 1) {
    ({ position, velocity } = integrateLinearDragExact({
      position,
      velocity,
      acceleration,
      drag: 0.73,
      dt,
    }));
  }
  return { position, velocity };
}

const schedules = [30, 60, 120, 144].map((hz) => integrateSchedule(hz, 2));
for (const candidate of schedules.slice(1)) {
  for (const key of ["position", "velocity"]) {
    candidate[key].forEach((value, lane) => {
      assert(Math.abs(value - schedules[0][key][lane]) < 1e-11, `${key}[${lane}] FPS parity`);
    });
  }
}

const marks = Uint32Array.from([1, 0, 1, 1, 0, 0, 1, 1]);
const scan = exclusiveScanReference(marks);
assert.deepEqual(Array.from(scan.destinations), [0, 1, 1, 2, 3, 3, 3, 4]);
assert.equal(scan.total, 5);

const ids = Uint32Array.from([11, 12, 13, 14, 15, 16, 17, 18]);
const values = Float32Array.from([
  1, 10, 2, 20, 3, 30, 4, 40, 5, 50, 6, 60, 7, 70, 8, 80,
]);
const compacted = compactSoAReference({
  id: { itemSize: 1, array: ids },
  value: { itemSize: 2, array: values },
}, marks);
assert.deepEqual(Array.from(compacted.output.id.array), [11, 13, 14, 17, 18]);
assert.deepEqual(Array.from(compacted.output.value.array), [1, 10, 3, 30, 4, 40, 7, 70, 8, 80]);

const indexToEntity = compacted.output.id.array;
const entityToIndex = new Map(Array.from(indexToEntity, (entity, index) => [entity, index]));
indexToEntity.forEach((entity, index) => assert.equal(entityToIndex.get(entity), index));
assert.equal(new Set(indexToEntity).size, indexToEntity.length, "identity map is bijective");

const geometry = new BoxGeometry(1, 1, 1);
const cache = createHullSampleCache(geometry);
const matrix = new Matrix4().makeTranslation(3, -2, 5);
const direction = new Vector3(0.2, -0.1, -1).normalize();
const support = computeSupportPoint({
  hullSampleCache: cache,
  flowDirectionWorld: direction,
  matrixWorld: matrix,
});
let oracleMaximum = -Infinity;
for (const point of cache.hullSamples) {
  oracleMaximum = Math.max(oracleMaximum, point.clone().applyMatrix4(matrix).dot(direction));
}
assert(Math.abs(support.score - oracleMaximum) < 1e-12, "support point is the transformed hull argmax");

for (const flow of [[0, 0, -1], [0, 1, 1e-9], [1, 0.2, -0.3]]) {
  const frame = buildEventFrame({ flowDirectionWorld: flow }).eventFrame;
  const forward = new Vector3().fromArray(frame.wakeForward);
  const up = new Vector3().fromArray(frame.wakeUp);
  const right = new Vector3().fromArray(frame.wakeRight);
  assert(Math.abs(forward.length() - 1) < 1e-12);
  assert(Math.abs(up.length() - 1) < 1e-12);
  assert(Math.abs(right.length() - 1) < 1e-12);
  assert(Math.abs(forward.dot(up)) < 1e-12);
  assert(Math.abs(forward.dot(right)) < 1e-12);
  assert(Math.abs(up.dot(right)) < 1e-12);
  assert(right.clone().cross(up).dot(forward) > 0.999999999, "event frame is right-handed");
}

const pool = new GPUCompactionEffectPool({ capacity: 256, workgroupSize: 128, kind: "debris" });
const object = pool.createRenderObject();
assert.equal(object.geometry.getIndirect(), pool.indirect);
assert.deepEqual(Array.from(pool.indirect.array), [object.geometry.index.count, 0, 0, 0, 0]);
assert.equal(pool.describePipeline().dispatchesPerStep, 11);
assert.equal(pool.describePipeline().maximumStorageBuffersInAnyKernel, 8);
assert.equal(pool.describeResources().maximumStorageBuffersInAnyKernel, 8);
assert.equal(Math.max(...Object.values(GPU_EFFECT_STORAGE_BINDINGS)), 8);
assert(Object.values(GPU_EFFECT_STORAGE_BINDINGS).every((count) => count <= 8));
assert.equal(pool.describeResources().hotReadback, false);
assert.equal(object.frustumCulled, true, "GPU pool uses a conservative analytic bound");
pool.queueEvent({
  count: 16,
  position: [10, 2, -4],
  lifetimeRange: [2, 4],
  radiusRange: [0.08, 0.22],
  speedRange: [1.5, 5],
  lateralSpeed: 2.5,
});
assert(object.geometry.boundingSphere.radius > 0);
assert(object.geometry.boundingSphere.containsPoint(new Vector3(10, 2, -4)));
const envelope = computeEventEnvelopeSphere({
  position: [-40, 3, 8],
  lifetimeRange: [2, 3],
  radiusRange: [0.1, 0.3],
  speedRange: [2, 6],
  lateralSpeed: 2,
  acceleration: new Vector3(0, -9.80665, 0),
});
pool.queueEvent({
  count: 8,
  position: envelope.center.toArray(),
  lifetimeRange: [2, 3],
  radiusRange: [0.1, 0.3],
  speedRange: [2, 6],
  lateralSpeed: 2,
});
assert(
  object.geometry.boundingSphere.center.distanceTo(envelope.center) + envelope.radius <=
    object.geometry.boundingSphere.radius + 1e-9,
  "unioned bound contains the complete second event envelope",
);
assert.deepEqual(GPU_EFFECT_COMPACTION_CONTRACT.phases, [
  "reset",
  "clear destination and identity tail",
  "integrate+mark",
  "block exclusive scan",
  "block-sum exclusive scan",
  "scatter motion lanes",
  "scatter appearance lanes",
  "scatter stable identity and rebuild entityToIndex",
  "expand bounded deterministic event state",
  "atomically pop stable ids for spawned entities",
  "publish indirect instance count",
]);
assert.equal(GPU_EFFECT_COMPACTION_CONTRACT.maximumStorageBuffersPerKernel, 8);
pool.reset({ backend: { isWebGPUBackend: true }, compute() {} });
assert.equal(object.geometry.boundingSphere.radius, 0, "reset clears stale event envelopes");
pool.dispose();
object.geometry.dispose();
object.material.dispose();

for (const [tier, expected] of Object.entries({
  ultra: [5, 3, 3],
  high: [4, 2, 2],
  medium: [2, 1, 1],
})) {
  const visuals = createReentryEffectVisuals({ tier });
  const description = visuals.describe();
  assert.deepEqual(
    [description.shellLayers, description.wakeFamilies, description.fieldOctaves],
    expected,
    `${tier} must instantiate its locked visual limits`,
  );
  visuals.update(1.25);
  visuals.dispose();
}
assert.deepEqual(
  Object.fromEntries(Object.entries(EFFECT_TIERS).map(([id, tier]) => [id, tier.dprCap])),
  { ultra: 2, high: 1.5, medium: 1 },
);

const hostScene = new Scene();
const integrationStage = createPooledEffectsStage({
  scene: hostScene,
  tier: "medium",
  scenario: "impact-sparks",
  seed: 17,
});
assert.equal(integrationStage.describePipeline().rendererOwner, "host");
assert.equal(integrationStage.describePipeline().outputOwner, "host");
assert.equal(integrationStage.describeResources().tier, "medium");
assert.equal(typeof integrationStage.reset, "function");
assert(hostScene.children.includes(integrationStage.sparkMesh));
const runtimeGraph = NativePooledEffectsLab.prototype.describePipeline.call({
  sparkPool: integrationStage.sparkPool,
  debrisPool: integrationStage.debrisPool,
});
assert.deepEqual(Object.keys(runtimeGraph).sort(), [
  "computeDispatches",
  "finalOutputTransformOwner",
  "finalToneMapOwner",
  "owners",
  "resources",
  "sceneSubmissions",
  "schemaVersion",
  "signals",
]);
assert.equal(runtimeGraph.computeDispatches.length, 22);
assert.deepEqual(runtimeGraph.sceneSubmissions.map(({ id }) => id), [
  "directional-shadow-map",
  "scene-pass",
  "bloom-high-pass",
  "bloom-horizontal-blur",
  "bloom-vertical-blur",
  "bloom-composite",
  "final-render-output",
]);
assert(runtimeGraph.resources.some(({ id }) => id === "directional-shadow-color"));
assert(runtimeGraph.resources.some(({ id }) => id === "directional-shadow-depth"));
integrationStage.setScenario("reentry-shell-and-wake");
assert.equal(integrationStage.reentry.group.visible, true);
assert.equal(integrationStage.sparkMesh.visible, false);
assert.equal(integrationStage.debrisMesh.visible, false);
integrationStage.setScenario("impact-sparks");
assert.equal(integrationStage.reentry.group.visible, false);
assert.equal(integrationStage.sparkMesh.visible, true);
assert.equal(integrationStage.debrisMesh.visible, false);
integrationStage.setScenario("debris-dissolve");
assert.equal(integrationStage.sparkMesh.visible, false);
assert.equal(integrationStage.debrisMesh.visible, true);
integrationStage.dispose();
integrationStage.dispose();
assert(!hostScene.children.includes(integrationStage.sparkMesh));

const poolOnlyVerdicts = derivePooledEffectsMechanismVerdicts({
  gpuReadback: {
    allValid: true,
    sparks: { liveCount: 7, indirectInstanceCount: 7 },
    debris: { liveCount: 3, indirectInstanceCount: 3 },
  },
});
assert.equal(poolOnlyVerdicts.claims.gpuPoolCompaction, "PASS");
assert.equal(poolOnlyVerdicts.claims.indirectDrawConsumption, "INSUFFICIENT_EVIDENCE");
assert.equal(poolOnlyVerdicts.overall, "INSUFFICIENT_EVIDENCE");
const completeVerdicts = derivePooledEffectsMechanismVerdicts({
  gpuReadback: {
    allValid: true,
    sparks: { liveCount: 7, indirectInstanceCount: 7 },
    debris: { liveCount: 3, indirectInstanceCount: 3 },
  },
  runtimeProofs: {
    indirectDrawConsumption: true,
    hullConformity: true,
    debrisDissolveShadowParity: true,
    softDepthOcclusion: true,
    emissiveIsolation: true,
  },
});
assert.equal(completeVerdicts.overall, "PASS");

const oddRowBytes = 641 * 4;
const oddAligned = Math.ceil(oddRowBytes / 256) * 256;
assert.deepEqual(computeRgbaReadbackLayout({
  width: 641,
  height: 359,
  byteLength: oddAligned * 358 + oddRowBytes,
}), { rowBytes: oddRowBytes, sourceBytesPerRow: oddAligned, bytesPerRow: oddAligned });
assert.deepEqual(computeRgbaReadbackLayout({
  width: 641,
  height: 359,
  byteLength: oddRowBytes * 359,
}), { rowBytes: oddRowBytes, sourceBytesPerRow: oddRowBytes, bytesPerRow: oddAligned });
assert.throws(() => computeRgbaReadbackLayout({
  width: 641,
  height: 359,
  byteLength: oddRowBytes * 359 - 1,
}), /unrecognized RGBA readback layout/);

const source = readFileSync(resolve(here, "gpu-compaction-pool.js"), "utf8");
for (const required of [
  "StorageInstancedBufferAttribute",
  "IndirectStorageBufferAttribute",
  "setIndirect",
  "workgroupArray",
  "workgroupBarrier",
  "exclusive-scan-blocks",
  "exclusive-scan-block-sums",
  "clear-destination",
  "scatter-motion-lanes",
  "scatter-appearance-lanes",
  "scatter-stable-identity",
  "expand-event-state",
  "expand-stable-identity",
  "atomicAdd",
  "atomicSub",
  "reset-identity-free-stack",
  "publish-indirect-count",
  "renderer.compute",
  "indexToEntity",
  "entityToIndex",
  "emissiveNode",
  "viewportLinearDepth",
  "linearDepth()",
]) assert(source.includes(required), `missing executable contract token ${required}`);
assert(!source.includes("mesh.frustumCulled = false"), "full GPU pools may not bypass culling");

const visualSource = readFileSync(resolve(here, "effect-visuals.js"), "utf8");
assert(visualSource.includes("positionViewDirection"), "shell rim must consume the live view direction");
assert(!visualSource.includes("dot(normalize(normalWorld), vec3(0, 0, 1))"), "world-axis rim mutation removed");
const labSource = readFileSync(resolve(here, "lab.mjs"), "utf8");
assert(!labSource.includes("this.bloomPass.setSize(width, height)"), "BloomNode owns internal target sizing after setup");
for (const token of [
  "directional-shadow-color",
  "directional-shadow-depth",
  "_renderTargetBright",
  "_renderTargetsHorizontal",
  "_renderTargetsVertical",
]) assert(labSource.includes(token), `runtime resource ledger missing ${token}`);
const captureSource = readFileSync(resolve(here, "capture.mjs"), "utf8");
assert(captureSource.includes("const cycles = 50"), "every capture profile runs the normative lifecycle loop");
assert(captureSource.includes("createPooledEffectsStage"), "lifecycle loop creates and disposes real host stages");
assert.match(
  captureSource,
  /writeJson\("bandwidth-model\.json", \{[\s\S]*?verdict: insufficient/,
  "capture readback bytes may not globally PASS runtime bandwidth",
);

const legacyPoolSource = readFileSync(resolve(here, "effect-pool.js"), "utf8");
assert(legacyPoolSource.includes("transformOffset + 12"), "column-major translation X");
assert(legacyPoolSource.includes("transformOffset + 13"), "column-major translation Y");
assert(legacyPoolSource.includes("transformOffset + 14"), "column-major translation Z");
assert(!legacyPoolSource.includes("transformOffset + 3] ="), "row-major translation mutation removed");

console.log("GPU pooled-effects CPU oracles and graph contracts passed");
