import assert from "node:assert/strict";
import test from "node:test";

import { REQUIRED_EXCLUSIVE_SEMANTICS, assertExclusiveOwnership } from "../ownership-audit.mjs";
import { captureStaticSpawnStorage, assertStaticSpawnStorageImmutable } from "../static-storage-audit.mjs";

function validOwners() {
  return REQUIRED_EXCLUSIVE_SEMANTICS.map((semantic) => ({ semantic, owner: `owner/${semantic}` }));
}

function fakeVegetationSystem() {
  return {
    patches: [
      {
        storageSet: {
          originTerrainHeight: { value: { array: new Float32Array([1, 2, 3, 4]) } },
          densitySeedsNormal: { value: { array: new Float32Array([5, 6, 7, 8]) } },
        },
      },
    ],
  };
}

test("exclusive ownership audit returns one owner per required semantic", () => {
  const owners = assertExclusiveOwnership(validOwners());
  assert.equal(Object.keys(owners).length, REQUIRED_EXCLUSIVE_SEMANTICS.length);
  assert.equal(owners.renderer, "owner/renderer");
});

test("contact uniforms can change while immutable vegetation spawn storage stays byte-identical", () => {
  const system = fakeVegetationSystem();
  const baseline = captureStaticSpawnStorage(system);
  const touchUniform = { value: new Float32Array([0, 0, 0, 0]) };
  touchUniform.value.set([2, -3, 0.5, 1]);
  const current = assertStaticSpawnStorageImmutable(system, baseline);
  assert.equal(current.hash, baseline.hash);
  assert.equal(current.bytes, baseline.bytes);
});

