import assert from "node:assert/strict";

import { frostLifecycleCyclePlan } from "./frost-webgpu-lab.js";

assert.deepEqual(frostLifecycleCyclePlan(0), {
  width: 641,
  height: 359,
  dpr: 1,
  tier: "full",
  mode: "final",
  resetCause: "frost-lifecycle-cycle-0",
});
assert.deepEqual(frostLifecycleCyclePlan(1), {
  width: 320,
  height: 180,
  dpr: 1.5,
  tier: "balanced",
  mode: "next-history-ra",
  resetCause: "frost-lifecycle-cycle-1",
});
assert.deepEqual(frostLifecycleCyclePlan(2), {
  width: 400,
  height: 300,
  dpr: 2,
  tier: "budgeted",
  mode: "frost-mask-after-pointer",
  resetCause: "frost-lifecycle-cycle-2",
});
assert.deepEqual(frostLifecycleCyclePlan(3), {
  width: 641,
  height: 359,
  dpr: 1,
  tier: "full",
  mode: "final",
  resetCause: "frost-lifecycle-cycle-3",
});
assert.throws(() => frostLifecycleCyclePlan(-1), /nonnegative integer/);
assert.throws(() => frostLifecycleCyclePlan(0.5), /nonnegative integer/);

console.log("frost lifecycle cycle plan passed");
