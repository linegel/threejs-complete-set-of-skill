import assert from "node:assert/strict";
import { Object3D, PerspectiveCamera, Vector3 } from "three/webgpu";

import {
  MOTION_STORAGE_LAYOUT,
  chooseMotionRoute,
  createGpuInstanceMotionPlan,
  createInstanceMotionMirror,
  maxPoseDifference,
  seekInstanceMotionMirror,
  stepInstanceMotionMirror,
} from "./gpu-instance-motion.js";
import {
  MOTION_SCENARIOS,
  advanceDeltaPolicy,
  computeReleasedDebrisVelocity,
  copyMotionState,
  createDeltaPolicy,
  createMotionState,
  createMotionStateSlots,
  createReparentFixture,
  evaluateDockingPose,
  evaluateDebrisPose,
  evaluateLaunchPose,
  getPresentationAlpha,
  integratedSpinAngle,
  interpolateMotionState,
  matrixMaxAbsDifference,
  resetMotionState,
  seededRandom,
  simulateTimeline,
  stepTimelineState,
} from "./timeline.js";
import { fromUnitVectorsSafe, integrateAngularVelocityWorld, quaternionAngle, quaternionNormError, safeNormalize } from "./quaternion-helpers.js";
import { MOTION_MODES, MOTION_TIERS, assertMotionRouteLock, parseMotionRoute } from "./route-state.js";

const induceViolation = process.argv.includes("--induce-violation");

function validateReplayAndTerminalLock() {
  const rates = [30, 60, 120, 144];
  const replays = rates.map((presentationHz) => simulateTimeline({ presentationHz, durationSeconds: 12 }));
  const terminal = replays[0].state;
  for (const replay of replays) {
    assert.equal(replay.state.eventLog.filter((event) => event.eventName === "dockingCaptured").length, 1);
    assert.equal(replay.state.eventLog.filter((event) => event.eventName === "terminalLocked").length, 1);
    assert(replay.state.position.distanceTo(terminal.position) < 1e-12);
    assert(quaternionAngle(replay.state.quaternion, terminal.quaternion) < 1e-12);
    assert(replay.state.position.lengthSq() === 0, "terminal position is exact target");
    assert(replay.state.velocity.lengthSq() === 0, "terminal linear velocity is exactly zero");
    assert(replay.state.angularVelocity.lengthSq() === 0, "terminal angular velocity is exactly zero");
    assert.equal(replay.policy.droppedSubstep, false);
  }
  return { rates, eventTimes: replays[0].state.eventLog.map((event) => event.time) };
}

function validateSceneUnitsOnce() {
  const a = evaluateLaunchPose(12, { sceneUnitsPerMeter: 0.001 });
  const b = evaluateLaunchPose(12, { sceneUnitsPerMeter: 0.002 });
  assert(a.position.clone().multiplyScalar(2).distanceTo(b.position) < 1e-9, "position scales exactly once");
  assert(a.velocity.clone().multiplyScalar(2).distanceTo(b.velocity) < 1e-9, "velocity scales exactly once");
  const normalizedAltitudeRatioA = a.position.length() / (6_371_000 * 0.001);
  const normalizedAltitudeRatioB = b.position.length() / (6_371_000 * 0.002);
  assert(Math.abs(normalizedAltitudeRatioA - normalizedAltitudeRatioB) < 1e-12, "normalized orbit ratios do not distort");
  const dockingA = evaluateDockingPose(5, { sceneUnitsPerMeter: 0.001 });
  const dockingB = evaluateDockingPose(5, { sceneUnitsPerMeter: 0.002 });
  assert(dockingA.position.clone().multiplyScalar(2).distanceTo(dockingB.position) < 1e-12, "docking position scales exactly once");
  assert(dockingA.velocity.clone().multiplyScalar(2).distanceTo(dockingB.velocity) < 1e-12, "docking velocity scales exactly once");
  const debrisA = evaluateDebrisPose(3, { sceneUnitsPerMeter: 0.001 });
  const debrisB = evaluateDebrisPose(3, { sceneUnitsPerMeter: 0.002 });
  assert(debrisA.position.clone().multiplyScalar(2).distanceTo(debrisB.position) < 1e-12, "debris position scales exactly once");
  assert(debrisA.velocity.clone().multiplyScalar(2).distanceTo(debrisB.velocity) < 1e-12, "debris velocity scales exactly once");
  return {
    normalizedAltitudeRatioA,
    normalizedAltitudeRatioB,
    normalizedDockingRatio: dockingA.position.length() / 0.001,
    normalizedDebrisRatio: debrisA.position.length() / 0.001,
  };
}

function validateReparent() {
  const fixture = createReparentFixture();
  const error = matrixMaxAbsDifference(fixture.worldBefore, fixture.worldAfter);
  assert(error < 1e-10, "world transform preserved under arbitrary transformed parent");
  assert(fixture.trsResidual > 1e-8, "fixture actually exercises a sheared local affine transform");
  assert.equal(fixture.usesAffineMatrix, true, "non-TRS local transform remains a full affine matrix");
  return { worldMatrixError: error, trsResidual: fixture.trsResidual };
}

function validateSpinIntegration() {
  const times = [0, 4, 8, 9, 10, 12];
  const angles = times.map((time) => integratedSpinAngle(time));
  for (let i = 1; i < angles.length; i += 1) assert(angles[i] >= angles[i - 1], "integrated spin angle is monotone");
  assert(Math.abs(angles[4] - 3.15 * 9) < 1e-12, "smooth spin-down integrates to the analytic area");
  const terminal = evaluateDockingPose(12);
  assert(terminal.velocity.lengthSq() === 0 && terminal.angularVelocity.lengthSq() === 0);
  const beforeLock = evaluateDockingPose(10 - 1e-7);
  const atLock = evaluateDockingPose(10);
  const lockAngle = quaternionAngle(beforeLock.quaternion, atLock.quaternion);
  assert(lockAngle < 1e-5, "terminal lock is orientation-continuous instead of snapping by the residual spin phase");
  return { times, angles, terminalOrientationJumpRadians: lockAngle };
}

function validateSeedQuaternionAndResume() {
  const stateA = createMotionState({ seed: 1234, streamId: 7 });
  const valuesA = [seededRandom(stateA, 7), seededRandom(stateA, 7), seededRandom(stateA, 7)];
  const stateB = createMotionState({ seed: 1234, streamId: 7 });
  const valuesB = [seededRandom(stateB, 7), seededRandom(stateB, 7), seededRandom(stateB, 7)];
  assert.deepEqual(valuesA, valuesB);
  resetMotionState(stateA);
  assert.equal(stateA.rngCounter, 0);
  const q = fromUnitVectorsSafe(new Vector3(0, 1, 0), new Vector3(0, -1, 0));
  for (let i = 0; i < 1000; i += 1) integrateAngularVelocityWorld(q, new Vector3(0, 0.06, 0), 1 / 120);
  assert(quaternionNormError(q) < 1e-4);
  const radial = new Vector3();
  safeNormalize(radial, new Vector3(1, 0, 0));
  assert(radial.toArray().every(Number.isFinite));
  const resumePolicy = createDeltaPolicy({ maxSubsteps: 2 });
  advanceDeltaPolicy(resumePolicy, 1, () => {});
  assert.equal(resumePolicy.droppedSubstep, true);
  assert(resumePolicy.droppedTime > 0);
  return { valuesA, droppedTime: resumePolicy.droppedTime };
}

function validateDebris() {
  const debris = computeReleasedDebrisVelocity();
  assert(debris.tangentialVelocity.length() > 0, "rotating-frame inheritance is present");
  assert(debris.velocity.length() <= 95 + 1e-12, "speed cap");
  return { tangential: debris.tangentialVelocity.toArray(), velocity: debris.velocity.toArray() };
}

function validateStorageAndDeterminism() {
  assert.equal(chooseMotionRoute({ actorCount: 100 }), "<200 Object3D");
  assert.equal(chooseMotionRoute({ actorCount: 500, mixedGeometry: true }), "200-10k BatchedMesh");
  assert.equal(chooseMotionRoute({ actorCount: 20000 }), "10k+ StorageInstancedBufferAttribute");
  const plan = createGpuInstanceMotionPlan({ instanceCount: 64 });
  if (induceViolation) plan.renderConsumes = ["currentPose"];
  const actualBytes = Object.values(plan.buffers)
    .filter((value) => value?.isStorageBufferAttribute || value?.isStorageInstancedBufferAttribute)
    .reduce((sum, value) => sum + value.array.byteLength, 0);
  assert.equal(plan.storageBytes, actualBytes, "reported bytes equal allocated storage");
  assert.equal(plan.storageBytes, 64 * MOTION_STORAGE_LAYOUT.storageBytesPerInstance);
  assert.equal(MOTION_STORAGE_LAYOUT.dynamicState.slotCount, 2);
  assert.notEqual(plan.buffers.previousPose, plan.buffers.currentPose);
  assert.notEqual(plan.buffers.previousQuaternion, plan.buffers.currentQuaternion);
  assert.deepEqual(plan.renderConsumes, ["previousPose", "currentPose", "previousQuaternion", "currentQuaternion", "alpha"]);
  assert.equal(plan.computeStep.isComputeNode, true);

  const recordedDispatches = [];
  const recordingRenderer = { compute(node) { recordedDispatches.push(node); } };
  const dispatchPolicy = createDeltaPolicy();
  let fixedSteps = 0;
  for (let frame = 0; frame < 4; frame += 1) {
    advanceDeltaPolicy(dispatchPolicy, 1 / 240, (fixedStep, simulationTime) => {
      fixedSteps += 1;
      plan.dispatchFixedStep(recordingRenderer, fixedStep, simulationTime + fixedStep);
    });
  }
  assert.equal(recordedDispatches.length, fixedSteps);
  assert(recordedDispatches.every((node) => node === plan.computeStep));

  const seedBefore = plan.buffers.seedFlags.array[4];
  plan.setSeed(0x9e3779b9, recordingRenderer);
  assert.notEqual(plan.buffers.seedFlags.array[4], seedBefore, "reseed updates deterministic static storage");
  assert.equal(plan.initializeState.value, 0, "GPU reseed initialization does not leak into fixed-step dispatch");
  plan.seek(recordingRenderer, 4.25);
  assert.equal(plan.simulationTime.value, 4.25, "explicit GPU seek targets the requested time");

  const camera = new PerspectiveCamera();
  const object = new Object3D();
  camera.updateMatrixWorld(true);
  object.updateMatrixWorld(true);
  plan.primeFrameMatrices(camera, object);
  plan.beginFrameMatrices();
  camera.position.x = 1;
  camera.updateMatrixWorld(true);
  plan.captureFrameMatrices(camera, object);
  assert(!plan.frameMatrices.currentView.equals(plan.frameMatrices.previousView), "velocity owns distinct current/previous camera matrices");

  const instanceCount = 32;
  const accumulator = createInstanceMotionMirror({ instanceCount });
  const policy = createDeltaPolicy();
  for (let frame = 0; frame < 60; frame += 1) {
    advanceDeltaPolicy(policy, 1 / 60, (fixedStep, simulationTime) => stepInstanceMotionMirror(accumulator, fixedStep, simulationTime + fixedStep));
  }
  const seek = seekInstanceMotionMirror({ instanceCount, fixedStep: policy.fixedStep, steps: policy.simulationSteps });
  assert.equal(maxPoseDifference(accumulator, seek), 0, "fixed-step seek equals accumulated state");
  let disposedStorageAttributes = 0;
  for (const value of Object.values(plan.buffers)) {
    if (value?.isStorageBufferAttribute || value?.isStorageInstancedBufferAttribute) {
      value.addEventListener("dispose", () => { disposedStorageAttributes += 1; });
    }
  }
  assert.equal(plan.storageAttributeCount, 9);
  assert.equal(plan.dispose(), true);
  assert.equal(plan.dispose(), false);
  assert.equal(disposedStorageAttributes, 9, "all nine storage attributes are disposed exactly once");
  return {
    storageBytes: plan.storageBytes,
    fixedSteps,
    deterministicSteps: policy.simulationSteps,
    recordedDispatches: recordedDispatches.length,
    disposedStorageAttributes,
  };
}

function validateTimelineGpuMirrorContract() {
  const checkpoints = [
    ["launch-and-staging", 12],
    ["spin-docking", 7.5],
    ["debris-release", 3.25],
  ];
  const results = [];
  for (const [scenario, time] of checkpoints) {
    const mirror = createInstanceMotionMirror({ instanceCount: 8, scenario, sceneUnitsPerMeter: 0.001, seed: 17 });
    stepInstanceMotionMirror(mirror, 1 / 120, time);
    const state = createMotionState({ scenario, sceneUnitsPerMeter: 0.001, seed: 17 });
    stepTimelineState(state, 1 / 120, time);
    const positionError = new Vector3(mirror.currentPose[0], mirror.currentPose[1], mirror.currentPose[2]).distanceTo(state.position);
    const velocityError = new Vector3(mirror.velocityState[0], mirror.velocityState[1], mirror.velocityState[2]).distanceTo(state.velocity);
    assert(positionError <= Math.max(1e-6, state.position.length() * 2e-7), `${scenario} parity lane position matches the CPU timeline`);
    assert(velocityError <= Math.max(1e-6, state.velocity.length() * 2e-7), `${scenario} parity lane velocity matches the CPU timeline`);
    const plan = createGpuInstanceMotionPlan({ instanceCount: 8, scenario, sceneUnitsPerMeter: 0.001, seed: 17 });
    assert.equal(plan.scenario, scenario);
    assert.match(plan.computeStep.name, new RegExp(scenario));
    assert.equal(plan.computeStep.isComputeNode, true);
    plan.dispose();
    results.push({ scenario, time, positionError, velocityError });
  }
  return results;
}

function validateInterpolation() {
  const slots = createMotionStateSlots({ seed: 321, scenario: "spin-docking" });
  copyMotionState(slots.previous, slots.current);
  stepTimelineState(slots.current, 1 / 120, 1 / 120);
  interpolateMotionState(slots.render, slots.previous, slots.current, 0);
  assert(slots.render.position.distanceTo(slots.previous.position) < 1e-15, "alpha 0 equals previous");
  interpolateMotionState(slots.render, slots.previous, slots.current, 1);
  assert(slots.render.position.distanceTo(slots.current.position) < 1e-15, "alpha 1 equals current");
  const policy = createDeltaPolicy();
  advanceDeltaPolicy(policy, policy.fixedStep * 0.5, () => {});
  assert.equal(getPresentationAlpha(policy), 0.5);
  return { endpointsExact: true };
}

function validateRoutes() {
  for (const scenario of MOTION_SCENARIOS) {
    const route = parseMotionRoute({ pathname: `/demos/motion/mechanism/${scenario}/`, search: "?tier=balanced&mode=velocity" });
    assert.deepEqual(route, { scenario, tier: "balanced", mode: "velocity" });
  }
  for (const tier of Object.keys(MOTION_TIERS)) {
    assert.equal(parseMotionRoute({ pathname: `/demos/motion/tier/${tier}/`, search: "" }).tier, tier);
  }
  for (const mode of MOTION_MODES) assert.equal(parseMotionRoute({ pathname: "/", search: `?mode=${mode}` }).mode, mode);
  assert.throws(() => parseMotionRoute({ pathname: "/mechanism/fabricated/", search: "" }), /unknown motion scenario/);
  assert.throws(() => parseMotionRoute({ pathname: "/tier/fabricated/", search: "" }), /unknown motion tier/);
  const locked = parseMotionRoute({ pathname: "/mechanism/compute-storage/", search: "?tier=full" });
  assert.equal(assertMotionRouteLock(locked), locked);
  assert.throws(() => assertMotionRouteLock(locked, { scenario: "spin-docking" }), /locked to compute-storage/);
  assert.throws(() => assertMotionRouteLock(locked, { tier: "balanced" }), /locked to full/);
  return { scenarios: MOTION_SCENARIOS.length, tiers: Object.keys(MOTION_TIERS).length };
}

const gates = {
  claimBoundary: { cpuContractExecuted: true, browserWebGpuExecutedThisRun: false, gpuTiming: "INSUFFICIENT_EVIDENCE" },
  replayAndTerminalLock: validateReplayAndTerminalLock(),
  sceneUnitsOnce: validateSceneUnitsOnce(),
  transformedParentReparent: validateReparent(),
  integratedSpin: validateSpinIntegration(),
  seedQuaternionResume: validateSeedQuaternionAndResume(),
  debris: validateDebris(),
  storageAndDeterminism: validateStorageAndDeterminism(),
  timelineGpuMirrorContract: validateTimelineGpuMirrorContract(),
  interpolation: validateInterpolation(),
  routes: validateRoutes(),
};

console.log(JSON.stringify(gates, null, 2));
