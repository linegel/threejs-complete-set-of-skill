import assert from "node:assert/strict";

import { validateCompactionReadback } from "./gpu-compaction-pool.js";
import { derivePooledEffectsMechanismVerdicts } from "./lab.mjs";

const valid = {
  indexToEntity: Uint32Array.from([2, 0, 1, 0xffffffff]),
  entityToIndex: Uint32Array.from([1, 2, 0, 0xffffffff]),
  liveCount: 3,
  indirect: Uint32Array.from([6, 3, 0, 0, 0]),
  freeCount: 1,
};
assert.equal(validateCompactionReadback(valid), true);

const mutations = [
  {
    name: "hole",
    value: { ...valid, indexToEntity: Uint32Array.from([2, 0xffffffff, 1, 0xffffffff]) },
    pattern: /invalid entity/,
  },
  {
    name: "duplicate",
    value: { ...valid, indexToEntity: Uint32Array.from([2, 0, 0, 0xffffffff]) },
    pattern: /duplicate entity/,
  },
  {
    name: "stale reverse map",
    value: { ...valid, entityToIndex: Uint32Array.from([1, 0, 0, 0xffffffff]) },
    pattern: /entityToIndex mismatch/,
  },
  {
    name: "indirect mismatch",
    value: { ...valid, indirect: Uint32Array.from([6, 2, 0, 0, 0]) },
    pattern: /does not equal liveCount/,
  },
  {
    name: "stale dense tail",
    value: {
      ...valid,
      indexToEntity: Uint32Array.from([2, 0, 1, 3]),
    },
    pattern: /stale indexToEntity lane/,
  },
  {
    name: "stale reverse tail",
    value: {
      ...valid,
      entityToIndex: Uint32Array.from([1, 2, 0, 3]),
    },
    pattern: /stale entityToIndex lane for dead entity/,
  },
  {
    name: "free-list count mismatch",
    value: { ...valid, freeCount: 0 },
    pattern: /free-list count/,
  },
];

for (const mutation of mutations) {
  assert.throws(() => validateCompactionReadback(mutation.value), mutation.pattern, mutation.name);
}

const validReadback = {
  allValid: true,
  sparks: { liveCount: 3, indirectInstanceCount: 3 },
  debris: { liveCount: 2, indirectInstanceCount: 2 },
};
const missingVisualProof = derivePooledEffectsMechanismVerdicts({ gpuReadback: validReadback });
assert.notEqual(
  missingVisualProof.overall,
  "PASS",
  "pool readback must not globally pass unmeasured hull/dissolve/depth/emissive claims",
);
const falseDepthProof = derivePooledEffectsMechanismVerdicts({
  gpuReadback: validReadback,
  runtimeProofs: {
    indirectDrawConsumption: true,
    hullConformity: true,
    debrisDissolveShadowParity: true,
    softDepthOcclusion: false,
    emissiveIsolation: true,
  },
});
assert.equal(falseDepthProof.overall, "FAIL", "a failed claim must dominate the aggregate verdict");

console.log(`GPU pooled-effects mutation gates passed (${mutations.length + 2})`);
