import assert from "node:assert/strict";

import { SCULPT_TIERS } from "../shared/sculpt-runtime.js";
import { SCULPT_TARGET_IDS, createSculptTarget } from "./object-catalog.js";

const VALID_UINT32_SEEDS = Object.freeze([
  0,
  1,
  2,
  0x7fffffff,
  0x80000000,
  0x9e3779b9,
  0xfffffffe,
  0xffffffff,
]);

const INVALID_SEEDS = Object.freeze([
  -1,
  0x100000000,
  1.5,
  Number.NaN,
  Number.POSITIVE_INFINITY,
  "1",
  Object.freeze({ valueOf: () => 1 }),
]);

for (const subjectId of SCULPT_TARGET_IDS) {
  for (const tier of SCULPT_TIERS) {
    for (const seed of VALID_UINT32_SEEDS) {
      const asset = createSculptTarget(subjectId, { tier, seed });
      try {
        assert.equal(asset.runtime.seed, seed, `${subjectId}/${tier}/${seed} seed drifted`);
        assert.equal(asset.runtime.tier, tier, `${subjectId}/${tier}/${seed} tier drifted`);
      } finally {
        await asset.dispose();
      }
    }
  }
  for (const seed of INVALID_SEEDS) {
    assert.throws(
      () => createSculptTarget(subjectId, { tier: "minimum", seed }),
      /seed|uint32|integer|finite|range/i,
      `${subjectId} must reject invalid seed ${String(seed)}`,
    );
  }
}

console.log(JSON.stringify({
  ok: true,
  targets: SCULPT_TARGET_IDS,
  tiers: SCULPT_TIERS,
  validSeeds: VALID_UINT32_SEEDS,
  invalidCases: INVALID_SEEDS.length,
}, null, 2));
