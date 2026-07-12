import assert from "node:assert/strict";

import {
  canonicalFrostEvidenceJson,
  runFrostCaptureTransaction,
  sha256FrostEvidence,
} from "./capture-transaction.js";

assert.equal(
  canonicalFrostEvidenceJson({ z: 2, a: [true, "frost"] }),
  '{"a":[true,"frost"],"z":2}',
);
assert.equal(await sha256FrostEvidence({ a: 1 }), await sha256FrostEvidence({ a: 1 }));
assert.notEqual(await sha256FrostEvidence({ a: 1 }), await sha256FrostEvidence({ a: 2 }));
assert.throws(() => canonicalFrostEvidenceJson({ value: Number.NaN }), /finite JSON values/);

const calls = [];
const committed = await runFrostCaptureTransaction({
  recipeId: "final.design",
  snapshot: async () => { calls.push("snapshot"); return { digest: "entry" }; },
  execute: async (entry) => { calls.push(`execute:${entry.digest}`); return { pixels: true }; },
  cleanup: async () => { calls.push("cleanup"); },
  verify: async (entry) => { calls.push(`verify:${entry.digest}`); return { digest: "entry" }; },
  poison: async () => { calls.push("poison"); },
});
assert.deepEqual(calls, ["snapshot", "execute:entry", "cleanup", "verify:entry"]);
assert.deepEqual(committed.result, { pixels: true });
assert.deepEqual(committed.restored, { digest: "entry" });

const captureFailureCalls = [];
await assert.rejects(
  () => runFrostCaptureTransaction({
    recipeId: "temporal.t001",
    snapshot: async () => ({ digest: "entry" }),
    execute: async () => { captureFailureCalls.push("execute"); throw new Error("capture failed"); },
    cleanup: async () => { captureFailureCalls.push("cleanup"); },
    verify: async () => { captureFailureCalls.push("verify"); return { digest: "entry" }; },
    poison: async () => { captureFailureCalls.push("poison"); },
  }),
  /capture failed/,
);
assert.deepEqual(captureFailureCalls, ["execute", "cleanup", "verify"]);

let poisoned = false;
await assert.rejects(
  () => runFrostCaptureTransaction({
    recipeId: "seed-9e3779b9.final",
    snapshot: async () => ({ digest: "entry" }),
    execute: async () => ({ pixels: true }),
    cleanup: async () => { throw new Error("cleanup failed"); },
    verify: async () => { throw new Error("parent drifted"); },
    poison: async () => { poisoned = true; throw new Error("poison failed"); },
  }),
  (error) => {
    assert(error instanceof AggregateError);
    assert.deepEqual(error.errors.map(({ message }) => message), [
      "cleanup failed",
      "parent drifted",
      "poison failed",
    ]);
    return true;
  },
);
assert.equal(poisoned, true);

console.log("frost capture transaction contract passed");
