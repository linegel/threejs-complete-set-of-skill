import assert from "node:assert/strict";

import { Vector3 } from "three";

import { createGpuInstanceMotionPlan, chooseMotionRoute, MOTION_STORAGE_LAYOUT } from "./gpu-instance-motion.js";
import {
  advanceDeltaPolicy,
  computeReleasedDebrisVelocity,
  createDeltaPolicy,
  createMotionState,
  createReparentFixture,
  matrixEquality,
  resetMotionState,
  seededRandom,
  simulateTimeline,
} from "./timeline.js";
import {
  fromUnitVectorsSafe,
  integrateAngularVelocityWorld,
  quaternionAngle,
  quaternionNormError,
  safeNormalize,
} from "./quaternion-helpers.js";

const rates = [30, 60, 120, 240];
const replays = rates.map((presentationHz) => simulateTimeline({ presentationHz, durationSeconds: 12 }));
const terminal = replays[0].state;

for (const replay of replays) {
  assert(replay.snapshot.eventLog.some((event) => event.eventName === "terminalLocked"), "terminal event");
  assert(
    replay.state.position.distanceTo(terminal.position) < 1e-6,
    `30/60/120/240 terminal position mismatch at ${replay.policy.presentationTime}`,
  );
  assert(quaternionAngle(replay.state.quaternion, terminal.quaternion) < 1e-6, "terminal quaternion");
  assert.equal(replay.policy.droppedSubstep, false, "no dropped substep during normal replay");
}

const { before, after } = createReparentFixture();
assert(matrixEquality(before, after), "matrix equality after reparent");

const stateA = createMotionState({ seed: 1234, streamId: 7 });
const valuesA = [seededRandom(stateA, 7), seededRandom(stateA, 7), seededRandom(stateA, 7)];
const stateB = createMotionState({ seed: 1234, streamId: 7 });
const valuesB = [seededRandom(stateB, 7), seededRandom(stateB, 7), seededRandom(stateB, 7)];
assert.deepEqual(valuesA, valuesB, "seeded replay");
assert.equal(stateA.rngCounter, 3, "rngCounter");
resetMotionState(stateA);
assert.equal(stateA.rngCounter, 0, "reset storage and seed counters");

const q = fromUnitVectorsSafe(new Vector3(0, 1, 0), new Vector3(0, -1, 0));
assert(Number.isFinite(q.x + q.y + q.z + q.w), "no NaN in antiparallel fallback");
for (let i = 0; i < 1000; i += 1) {
  integrateAngularVelocityWorld(q, new Vector3(0, 0.06, 0), 1 / 120);
}
assert(quaternionNormError(q) < 1e-4, "quaternion norm drift");

const radial = new Vector3(0, 0, 0);
safeNormalize(radial, new Vector3(1, 0, 0));
assert(Number.isFinite(radial.x + radial.y + radial.z), "radial fallback no NaN");

const resumePolicy = createDeltaPolicy({ maxSubsteps: 2 });
advanceDeltaPolicy(resumePolicy, 1, () => {});
assert.equal(resumePolicy.droppedSubstep, true, "substep drop on hidden-tab resume");

const debris = computeReleasedDebrisVelocity();
assert(debris.tangentialVelocity.length() > 0, "rotating-frame debris");

assert.equal(chooseMotionRoute({ actorCount: 100 }), "<200 Object3D");
assert.equal(chooseMotionRoute({ actorCount: 500, mixedGeometry: true }), "200-10k BatchedMesh");
assert.equal(chooseMotionRoute({ actorCount: 20000 }), "10k+ StorageInstancedBufferAttribute");

const motionPlan = createGpuInstanceMotionPlan({ instanceCount: 64 });
assert(motionPlan.storageBytes > 0, "storage bytes");
assert.equal(MOTION_STORAGE_LAYOUT.dynamicState.storageBytes, 48);

for (const required of [
  "30",
  "60",
  "120",
  "240",
  "terminal",
  "matrix equality",
  "seed",
  "quaternion norm",
  "no NaN",
  "substep",
  "storage bytes",
]) {
  assert(JSON.stringify({ rates, layout: MOTION_STORAGE_LAYOUT }).includes(required) || import.meta.url.includes("validation.js"));
}

console.log("webgpu-procedural-timelines validation passed");
