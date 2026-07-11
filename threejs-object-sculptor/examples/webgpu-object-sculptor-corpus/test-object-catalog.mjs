import assert from "node:assert/strict";

import { SCULPT_MODES, SCULPT_TIERS } from "../shared/sculpt-runtime.js";
import {
  SCULPT_TARGET_IDS,
  SCULPT_TARGETS,
  createSculptTarget,
  getSculptTargetDefinition,
  listSculptTargets,
} from "./object-catalog.js";

const EXPECTED_IDS = ["articulated-desk-lamp", "potted-bonsai", "ceramic-teapot"];

assert.deepEqual(SCULPT_TARGET_IDS, EXPECTED_IDS);
assert.equal(Object.isFrozen(SCULPT_TARGET_IDS), true);
assert.equal(Object.isFrozen(SCULPT_TARGETS), true);
assert.equal(listSculptTargets(), SCULPT_TARGETS, "listing must not allocate or reorder definitions");
assert.equal(new Set(SCULPT_TARGET_IDS).size, SCULPT_TARGET_IDS.length);
assert.equal(new Set(SCULPT_TARGETS.map(({ title }) => title.toLocaleLowerCase("en-US"))).size, SCULPT_TARGETS.length);

for (const definition of SCULPT_TARGETS) {
  assert.equal(Object.isFrozen(definition), true);
  assert.equal(Object.isFrozen(definition.cameraTarget), true);
  assert.equal(Object.isFrozen(definition.boundsMeters), true);
  assert.equal(getSculptTargetDefinition(definition.id), definition);
  assert.equal(definition.contract.id, definition.id);
  assert.equal(definition.contract.title, definition.title);
  assert.deepEqual(definition.contract.modes, SCULPT_MODES);
  assert.deepEqual(definition.contract.tierIds, SCULPT_TIERS);
  assert.equal(definition.defaultCamera, "design");
  assert.equal(definition.cameraTarget.length, 3);
  assert(Object.values(definition.boundsMeters).every((value) => Number.isFinite(value) && value > 0));

  const tierNodeCounts = [];
  for (const tier of SCULPT_TIERS) {
    const target = createSculptTarget(definition.id, { tier, seed: 17 });
    assert.equal(target.root.isObject3D, true);
    assert.equal(target.runtime.root, target.root);
    assert.equal(target.runtime.subjectId, definition.id);
    assert.equal(target.runtime.tier, tier);
    assert.equal(target.contract, definition.contract);
    assert.equal(typeof target.setMode, "function");
    assert.equal(typeof target.setTime, "function");
    assert.equal(typeof target.dispose, "function");
    target.setMode("action-ready");
    target.setTime(0.75);
    target.root.updateMatrixWorld(true);
    tierNodeCounts.push(target.runtime.nodes.size);
    const disposed = target.dispose();
    assert.equal(disposed.alreadyDisposed, false);
    assert.equal(target.dispose().alreadyDisposed, true);
  }
  assert(tierNodeCounts.every((count) => Number.isInteger(count) && count > 0));
}

for (const definition of SCULPT_TARGETS) {
  const target = createSculptTarget(definition.id);
  assert.equal(target.runtime.tier, "budgeted", "catalog factory default must be mobile-conscious");
  assert.equal(target.runtime.seed, 1);
  target.dispose();
}

assert.throws(() => getSculptTargetDefinition("missing-target"), /Unknown sculpt target/);
assert.throws(() => getSculptTargetDefinition(""), /nonempty string/);
assert.throws(() => createSculptTarget("missing-target"), /Unknown sculpt target/);
assert.throws(() => createSculptTarget("potted-bonsai", null), /options must be an object/);
assert.throws(() => createSculptTarget("potted-bonsai", { tier: "ultra" }), /Unknown sculpt tier/);
assert.throws(() => createSculptTarget("potted-bonsai", { seed: 1.25 }), /seed must be an integer/);

console.log(JSON.stringify({
  ok: true,
  targetIds: SCULPT_TARGET_IDS,
  modes: SCULPT_MODES,
  tiers: SCULPT_TIERS,
}, null, 2));
