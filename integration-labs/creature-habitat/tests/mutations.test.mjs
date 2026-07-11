import assert from "node:assert/strict";
import test from "node:test";

import { REQUIRED_EXCLUSIVE_SEMANTICS, assertExclusiveOwnership } from "../ownership-audit.mjs";
import { createCreatureHabitatQualityGovernor } from "../quality-governor.mjs";
import { reconcileResourceLedger } from "../resource-ledger.mjs";
import { resolveHabitatRoute } from "../route-state.mjs";
import { captureStaticSpawnStorage, assertStaticSpawnStorageImmutable } from "../static-storage-audit.mjs";

test("duplicate renderer-owner mutation is blocking", () => {
  const owners = REQUIRED_EXCLUSIVE_SEMANTICS.map((semantic) => ({ semantic, owner: `owner/${semantic}` }));
  owners.push({ semantic: "renderer", owner: "mutant/second-renderer" });
  assert.throws(() => assertExclusiveOwnership(owners), /duplicate exclusive owner: renderer/);
});

test("missing output-transform owner mutation is blocking", () => {
  const owners = REQUIRED_EXCLUSIVE_SEMANTICS
    .filter((semantic) => semantic !== "output-transform")
    .map((semantic) => ({ semantic, owner: `owner/${semantic}` }));
  assert.throws(() => assertExclusiveOwnership(owners), /missing exclusive owner: output-transform/);
});

test("static vegetation spawn-storage rewrite mutation is blocking", () => {
  const array = new Float32Array([0.25, 0.5, 0.75, 1]);
  const system = {
    patches: [{ storageSet: { originTerrainHeight: { value: { array } } } }],
  };
  const baseline = captureStaticSpawnStorage(system);
  array[2] = 0.749;
  assert.throws(
    () => assertStaticSpawnStorageImmutable(system, baseline),
    /immutable vegetation spawn storage changed/,
  );
});

test("mechanism route override mutation is blocking", () => {
  assert.throws(
    () => resolveHabitatRoute(
      "http://127.0.0.1/demos/creature-habitat/mechanism/owner-graph/?mode=final",
    ),
    /locked mechanism route.*rejects mode/,
  );
  assert.throws(
    () => resolveHabitatRoute(
      "http://127.0.0.1/demos/creature-habitat/mechanism/owner-graph/?tier=hero",
    ),
    /locked mechanism route.*rejects tier/,
  );
});

test("missing timestamps cannot mutate the quality tier", () => {
  const governor = createCreatureHabitatQualityGovernor({
    initialTier: "hero",
    windowSize: 2,
    downgradePersistence: 1,
  });
  governor.recordGpuTimestamp(undefined);
  const skipped = governor.recordGpuTimestamp(undefined);
  assert.equal(skipped.kind, "skipped-window");
  assert.equal(governor.getTier(), "hero");
  assert.equal(governor.describe().transitionTrace.length, 0);
});

test("unreconciled resident-byte declaration mutation is blocking", () => {
  assert.throws(
    () => reconcileResourceLedger({
      resources: [{
        id: "live-storage",
        owner: "habitat",
        bytes: 64,
        label: "Measured",
        source: "typed-array byteLength",
      }],
      declaredResidentBytes: 63,
    }),
    /do not reconcile/,
  );
});
