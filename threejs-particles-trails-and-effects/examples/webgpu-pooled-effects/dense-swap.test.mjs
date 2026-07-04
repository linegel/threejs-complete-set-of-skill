import assert from "node:assert/strict";

import { EffectPool, createSpawnPacket, STORAGE_SLICES } from "./effect-pool.js";

function runMiddleRemovalInvariant() {
  const pool = new EffectPool({ capacity: 16, lifetimeSeconds: 10 });
  const entities = pool.spawn(
    createSpawnPacket({
      seed: 1717,
      count: 8,
      position: [1, 2, 3],
      flowDirectionWorld: [0.1, -1, 0.25],
    }),
  );

  pool.assertDenseRange();
  const lastEntity = entities.at(-1);
  const lastSnapshot = pool.snapshotEntity(lastEntity);
  const result = pool.removeAt(3);

  assert.equal(result.movedEntity, lastEntity);
  assert.equal(pool.entityToIndex.get(lastEntity), 3);
  assert.equal(pool.liveCount, 7);
  assert.equal(pool.swapCount, 1);
  pool.assertDenseRange();
  pool.assertSnapshot(lastEntity, { ...lastSnapshot, index: 3 });

  for (const key of STORAGE_SLICES) {
    assert.equal(pool[key].isStorageInstancedBufferAttribute, true, key);
  }

  const corrupt = pool.snapshotEntity(lastEntity);
  const renderOffset = pool.entityToIndex.get(lastEntity) * pool.render0.itemSize;
  pool.render0.array[renderOffset] += 99;
  assert.throws(
    () => pool.assertSnapshot(lastEntity, corrupt),
    /dense-swap slice render0/,
    "corrupting one copied slice must fail the invariant",
  );
}

function runRepeatedRemovalInvariant() {
  const pool = new EffectPool({ capacity: 32, lifetimeSeconds: 10 });
  pool.spawn(createSpawnPacket({ seed: 20260704, count: 20, flowDirectionWorld: [0, -1, 0] }));

  while (pool.liveCount > 5) {
    const removeIndex = Math.floor(pool.liveCount / 2);
    const lastEntity = pool.indexToEntity[pool.liveCount - 1];
    const snapshot = pool.snapshotEntity(lastEntity);
    const result = pool.removeAt(removeIndex);
    pool.assertDenseRange();
    if (result.movedEntity !== null) {
      pool.assertSnapshot(result.movedEntity, snapshot);
    }
  }

  assert.equal(pool.liveCount, 5);
  assert.equal(pool.entityToIndex.size, 5);
}

runMiddleRemovalInvariant();
runRepeatedRemovalInvariant();
console.log("dense-swap invariant passed");
