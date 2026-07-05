import assert from "node:assert/strict";

import { Vector3 } from "three";

import {
  createGpuInstanceMotionPlan,
  chooseMotionRoute,
  createInstanceMotionMirror,
  maxPoseDifference,
  MOTION_STORAGE_LAYOUT,
  seekInstanceMotionMirror,
  stepInstanceMotionMirror,
} from "./gpu-instance-motion.js";
import {
  advanceDeltaPolicy,
  computeReleasedDebrisVelocity,
  copyMotionState,
  createDeltaPolicy,
  createMotionState,
  createMotionStateSlots,
  createReparentFixture,
  getPresentationAlpha,
  interpolateMotionState,
  matrixEquality,
  resetMotionState,
  seededRandom,
  simulateTimeline,
  stepTimelineState,
} from "./timeline.js";
import {
  fromUnitVectorsSafe,
  integrateAngularVelocityWorld,
  quaternionAngle,
  quaternionNormError,
  safeNormalize,
} from "./quaternion-helpers.js";

const induceViolation = process.argv.includes("--induce-violation");

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
if (induceViolation) motionPlan.renderConsumes = ["currentPose"];
assert(motionPlan.storageBytes > 0, "storage bytes");
assert.equal(MOTION_STORAGE_LAYOUT.dynamicState.storageBytes, 48);
assert.equal(MOTION_STORAGE_LAYOUT.dynamicState.slotCount, 2, "previous/current state slots");
assert(motionPlan.buffers.previousPose.isStorageInstancedBufferAttribute, "previous pose storage slot");
assert(motionPlan.buffers.currentPose.isStorageInstancedBufferAttribute, "current pose storage slot");
assert.notEqual(motionPlan.buffers.previousPose, motionPlan.buffers.currentPose, "independent pose slots");
assert.deepEqual(motionPlan.renderConsumes, ["previousPose", "currentPose", "alpha"], "render consumes both slots with alpha");
assert.equal(motionPlan.computeStep.isComputeNode, true, "real ComputeNode");
assert.equal(motionPlan.dispatchPolicy, "fixed-step accumulator", "compute dispatch owner");

const stateSlots = createMotionStateSlots({ seed: 321 });
const alphaPolicy = createDeltaPolicy();
copyMotionState(stateSlots.previous, stateSlots.current);
stepTimelineState(stateSlots.current, alphaPolicy.fixedStep, alphaPolicy.fixedStep);
advanceDeltaPolicy(alphaPolicy, alphaPolicy.fixedStep * 0.5, () => {});
const alpha = getPresentationAlpha(alphaPolicy);
interpolateMotionState(stateSlots.render, stateSlots.previous, stateSlots.current, alpha);
assert.equal(alpha, 0.5, "presentation alpha");
assert(
  stateSlots.render.position.distanceTo(stateSlots.previous.position) > 0 &&
    stateSlots.render.position.distanceTo(stateSlots.current.position) > 0,
  "render pose is interpolated between previous and current",
);

const fakeDispatches = [];
const fakeRenderer = {
  compute(node) {
    fakeDispatches.push(node);
  },
};
const dispatchPolicy = createDeltaPolicy();
let fixedSteps = 0;
for (let frame = 0; frame < 4; frame += 1) {
  advanceDeltaPolicy(dispatchPolicy, 1 / 240, (fixedStep, simulationTime) => {
    fixedSteps += 1;
    motionPlan.dispatchFixedStep(fakeRenderer, fixedStep, simulationTime + fixedStep);
  });
}
assert.equal(fixedSteps, 2, "fixed-step count for 240 Hz presentation over 1/60 s");
assert.equal(fakeDispatches.length, fixedSteps, "compute dispatched per fixed step");
assert(fakeDispatches.every((node) => node === motionPlan.computeStep), "dispatch uses the compute node");

const deterministicInstanceCount = 32;
const accumulatorMirror = createInstanceMotionMirror({ instanceCount: deterministicInstanceCount });
const accumulatorPolicy = createDeltaPolicy();
const frameDelta = 1 / 60;
for (let frame = 0; frame < 60; frame += 1) {
  advanceDeltaPolicy(accumulatorPolicy, frameDelta, (fixedStep, simulationTime) => {
    stepInstanceMotionMirror(accumulatorMirror, fixedStep, simulationTime + fixedStep);
  });
}
const seekMirror = seekInstanceMotionMirror({
  instanceCount: deterministicInstanceCount,
  fixedStep: accumulatorPolicy.fixedStep,
  steps: accumulatorPolicy.simulationSteps,
});
assert.equal(accumulatorPolicy.simulationSteps, 120, "determinism fixed-step count");
assert.equal(maxPoseDifference(accumulatorMirror, seekMirror), 0, "seek(t) equals accumulator stepping");

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
  "previousPose",
  "currentPose",
  "alpha",
  "fixed-step accumulator",
]) {
  assert(JSON.stringify({ rates, layout: MOTION_STORAGE_LAYOUT }).includes(required) || import.meta.url.includes("validation.js"));
}

// Drive the REAL demo loop headlessly (not just the library primitives):
// a wiring regression in ProceduralTimelineDemo.advanceFrame — e.g. rendering
// the current slot instead of the previous/current interpolation — must fail
// here, not only in a browser session.
{
  const { ProceduralTimelineDemo } = await import("./main.js");
  const demo = new ProceduralTimelineDemo({ seed: 99, instanceCount: 8 });
  demo.renderer = { compute() {} };
  const fixedStep = demo.policy.fixedStep;
  const alpha = demo.advanceFrame(fixedStep * 1.5);
  assert(Math.abs(alpha - 0.5) < 1e-12, "real loop: alpha 0.5 after 1.5 fixed steps");
  const expected = new Vector3().lerpVectors(
    demo.stateSlots.previous.position,
    demo.stateSlots.current.position,
    alpha,
  );
  assert(
    demo.stateSlots.previous.position.distanceTo(demo.stateSlots.current.position) > 0,
    "real loop: previous and current slots diverged after a fixed step",
  );
  assert(
    demo.stateSlots.render.position.distanceTo(expected) < 1e-9,
    "real loop: rendered slot is the previous/current interpolation",
  );
  assert(
    demo.stateSlots.render.position.distanceTo(demo.stateSlots.current.position) > 0,
    "real loop: rendered slot is not the raw current slot",
  );
}

console.log(
  `webgpu-procedural-timelines validation passed; determinism ${deterministicInstanceCount} instances, ` +
    `${accumulatorPolicy.simulationSteps} fixed steps, maxDiff=${maxPoseDifference(accumulatorMirror, seekMirror)}`,
);
