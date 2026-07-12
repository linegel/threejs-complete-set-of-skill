import assert from "node:assert/strict";
import { Object3D, PerspectiveCamera, Quaternion, Vector3 } from "three/webgpu";

import {
  MOTION_STORAGE_LAYOUT,
  MOTION_STORAGE_FLAG_BITS,
  chooseMotionRoute,
  createGpuInstanceMotionPlan,
  createInstanceMotionMirror,
  maxPoseDifference,
  motionComputeShaderIdentifier,
  motionPresentationShaderIdentifier,
  prepareInstanceMotionMirrorPresentation,
  seekInstanceMotionMirror,
  stepInstanceMotionMirror,
} from "./gpu-instance-motion.js";
import {
  MOTION_PIPELINE_OWNERSHIP,
  MOTION_STAGE_PRESENTATION,
  MOTION_VELOCITY_DIAGNOSTIC_GAIN,
  describeMotionGpuTiming,
  parseMotionRuntimeProfile,
  requireInitializedMotionRendererDevice,
  runMotionRollback,
} from "./main.js";
import {
  MOTION_SCENARIOS,
  MOTION_EVENT_FLAG_BITS,
  MOTION_ORIGIN_METADATA,
  STORAGE_VERSION,
  advanceDeltaPolicy,
  computeReleasedDebrisVelocity,
  copyMotionState,
  createDeltaPolicy,
  createMotionState,
  createMotionStateSlots,
  createReparentFixture,
  evaluateDockingPose,
  evaluateComputeStoragePose,
  evaluateDebrisPose,
  evaluateInterpolationVelocityPose,
  evaluateLaunchPose,
  evaluateQuaternionReparentPose,
  getPresentationAlpha,
  integratedSpinAngle,
  interpolateMotionState,
  logOneShotEvent,
  matrixMaxAbsDifference,
  motionEventBitmask,
  reparentPreserveWorldTransform,
  resetMotionState,
  requireSceneUnitsPerMeter,
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
  slerpQuaternionsShortest,
} from "./quaternion-helpers.js";
import { MOTION_MODES, MOTION_TIERS, assertMotionRouteLock, parseMotionRoute } from "./route-state.js";

const induceViolation = process.argv.includes("--induce-violation");

function validateReplayAndTerminalLock() {
  const rates = [30, 60, 120, 144];
  const fixtures = [
    {
      scenario: "spin-docking",
      durationSeconds: 12,
      events: [
        { time: 6, phaseId: 1, eventName: "dockingCaptured", actorId: 2 },
        { time: 10, phaseId: 3, eventName: "terminalLocked", actorId: 2 },
      ],
    },
    {
      scenario: "launch-and-staging",
      durationSeconds: 26,
      events: [{ time: 24, phaseId: 1, eventName: "stageDetached", actorId: 1 }],
    },
    {
      scenario: "debris-release",
      durationSeconds: 4,
      events: [{ time: 2, phaseId: 1, eventName: "debrisReleased", actorId: 3 }],
    },
  ];
  const scheduleResults = [];
  for (const fixture of fixtures) {
    const replays = rates.map((presentationHz) => simulateTimeline({
      presentationHz,
      durationSeconds: fixture.durationSeconds,
      scenario: fixture.scenario,
    }));
    const baseline = replays[0].state;
    for (const replay of replays) {
      assert.equal(replay.state.eventLog.length, fixture.events.length);
      assert.deepEqual(
        replay.state.eventLog.map(({ time, phaseId, eventName, actorId }) => ({ time, phaseId, eventName, actorId })),
        fixture.events,
        `${fixture.scenario} event boundaries are exact and presentation-rate independent`,
      );
      assert(replay.state.position.distanceTo(baseline.position) < 1e-12);
      assert(replay.state.velocity.distanceTo(baseline.velocity) < 1e-12);
      assert(quaternionAngle(replay.state.quaternion, baseline.quaternion) < 1e-12);
      assert(replay.state.angularVelocity.distanceTo(baseline.angularVelocity) < 1e-12);
      assert.equal(replay.policy.droppedSubstep, false);
    }
    scheduleResults.push({
      scenario: fixture.scenario,
      eventTimes: replays[0].state.eventLog.map((event) => event.time),
    });
  }
  const terminal = simulateTimeline({ presentationHz: 60, durationSeconds: 12 }).state;
  assert(terminal.position.lengthSq() === 0, "terminal position is exact target");
  assert(terminal.velocity.lengthSq() === 0, "terminal linear velocity is exactly zero");
  assert(terminal.angularVelocity.lengthSq() === 0, "terminal angular velocity is exactly zero");
  const seek = createMotionState({ scenario: "spin-docking" });
  stepTimelineState(seek, 0, 12);
  assert.deepEqual(seek.eventLog.map((event) => event.time), [6, 10], "direct seek replays authored event boundaries");
  assert.equal(logOneShotEvent(seek, 10, "terminalLocked", 2, 3), false, "one-shot event cannot duplicate");
  assert.throws(() => logOneShotEvent(seek, 0, "fabricated"), /unknown motion event/);
  return { rates, schedules: scheduleResults };
}

function validateSceneUnitsOnce() {
  assert.equal(requireSceneUnitsPerMeter(0.001), 0.001);
  assert.throws(() => requireSceneUnitsPerMeter(Number.POSITIVE_INFINITY), /finite and > 0/);
  assert.throws(() => evaluateLaunchPose(1, { sceneUnits: 0.001 }), /not a valid second scale knob/);
  const a = evaluateLaunchPose(12, { sceneUnitsPerMeter: 0.001 });
  const b = evaluateLaunchPose(12, { sceneUnitsPerMeter: 0.002 });
  assert(a.position.clone().multiplyScalar(2).distanceTo(b.position) < 1e-9, "position scales exactly once");
  assert(a.velocity.clone().multiplyScalar(2).distanceTo(b.velocity) < 1e-9, "velocity scales exactly once");
  assert(quaternionAngle(a.quaternion, b.quaternion) < 1e-12, "orientation is dimensionless across the unit boundary");
  assert(a.angularVelocity.distanceTo(b.angularVelocity) < 1e-12, "angular velocity is not linearly rescaled");
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
  const inheritedA = computeReleasedDebrisVelocity({ sceneUnitsPerMeter: 0.001 });
  const inheritedB = computeReleasedDebrisVelocity({ sceneUnitsPerMeter: 0.002 });
  assert(inheritedA.velocity.clone().multiplyScalar(2).distanceTo(inheritedB.velocity) < 1e-12);
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
  assert.equal(error, fixture.worldResidual);
  assert(fixture.worldResidualGate >= fixture.worldAbsoluteResidualFloor);
  assert(fixture.worldResidualGate > 1e-10, "world gate accounts for transform scale and parent conditioning");
  assert(fixture.parentConditionEstimate >= 1 && fixture.parentConditionEstimate <= fixture.maxParentConditionEstimate);
  assert(fixture.trsResidual > 1e-8, "fixture actually exercises a sheared local affine transform");
  assert.equal(fixture.usesAffineMatrix, true, "non-TRS local transform remains a full affine matrix");
  assert.equal(fixture.localRepresentation, "affine-matrix");

  const uniformOldParent = new Object3D();
  const uniformNewParent = new Object3D();
  const uniformChild = new Object3D();
  uniformOldParent.scale.setScalar(2);
  uniformNewParent.scale.setScalar(0.5);
  uniformNewParent.rotation.set(0.2, -0.3, 0.1);
  uniformChild.position.set(1, 2, 3);
  uniformOldParent.add(uniformChild);
  const uniform = reparentPreserveWorldTransform(uniformChild, uniformNewParent);
  assert.equal(uniform.localRepresentation, "trs");
  assert(uniform.worldResidual <= uniform.worldResidualGate);

  const singularOldParent = new Object3D();
  const singularParent = new Object3D();
  const singularChild = new Object3D();
  singularOldParent.add(singularChild);
  singularParent.scale.set(1, 0, 1);
  singularParent.updateWorldMatrix(true, false);
  assert.throws(
    () => reparentPreserveWorldTransform(singularChild, singularParent),
    /not invertible/,
  );
  assert.equal(singularChild.parent, singularOldParent, "failed handoff preserves the original hierarchy");

  const illConditionedOldParent = new Object3D();
  const illConditionedParent = new Object3D();
  const illConditionedChild = new Object3D();
  illConditionedOldParent.add(illConditionedChild);
  illConditionedParent.scale.set(1e-4, 1e4, 1);
  assert.throws(
    () => reparentPreserveWorldTransform(illConditionedChild, illConditionedParent, {
      maxParentConditionEstimate: 100,
    }),
    /condition estimate.*bounded domain/,
  );
  assert.equal(illConditionedChild.parent, illConditionedOldParent);
  return {
    worldMatrixError: error,
    trsResidual: fixture.trsResidual,
    affinePolicy: fixture.localRepresentation,
    trsPolicy: uniform.localRepresentation,
    parentConditionEstimate: fixture.parentConditionEstimate,
  };
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
  assert(quaternionNormError(q) < 1e-12);
  assert(new Vector3(0, 1, 0).applyQuaternion(q).distanceTo(new Vector3(0, -1, 0)) < 1e-12);
  for (const axis of [new Vector3(1, 0, 0), new Vector3(0, 1, 0), new Vector3(0, 0, 1)]) {
    const antiparallel = fromUnitVectorsSafe(axis, axis.clone().negate(), axis);
    assert(quaternionNormError(antiparallel) < 1e-12, "parallel fallback input still chooses a stable perpendicular axis");
    assert(axis.clone().applyQuaternion(antiparallel).distanceTo(axis.clone().negate()) < 1e-12);
  }
  const hemisphereA = new Quaternion().setFromAxisAngle(new Vector3(0, 1, 0), 0.75);
  const hemisphereB = new Quaternion(-hemisphereA.x, -hemisphereA.y, -hemisphereA.z, -hemisphereA.w);
  const hemisphereMid = slerpQuaternionsShortest(hemisphereA, hemisphereB, 0.5);
  assert(quaternionAngle(hemisphereA, hemisphereMid) < 1e-12, "double-cover interpolation remains on the same represented orientation");
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
  assert(debris.velocity.length() <= 0.095 + 1e-12, "95 m/s cap crosses the default 0.001 scene-unit boundary exactly once");
  const physical = computeReleasedDebrisVelocity({ sceneUnitsPerMeter: 1 });
  assert(physical.velocity.length() <= 95 + 1e-12, "default SI speed cap is 95 m/s");
  assert(physical.tangentialVelocity.length() === 63, "default rotating-frame radius and rate yield 63 m/s tangential speed");
  const capped = computeReleasedDebrisVelocity({
    sceneUnitsPerMeter: 1,
    outwardSpeedMetersPerSecond: 1000,
  });
  assert(Math.abs(capped.velocity.length() - 95) < 1e-10, "over-cap authored debris is bounded in SI before presentation scaling");
  assert.throws(() => computeReleasedDebrisVelocity({ speedCapMetersPerSecond: 0 }), /speed cap/);
  return { tangential: debris.tangentialVelocity.toArray(), velocity: debris.velocity.toArray() };
}

async function validateStorageAndDeterminism() {
  assert.equal(chooseMotionRoute({ actorCount: 100 }), "<200 Object3D");
  assert.equal(chooseMotionRoute({ actorCount: 500, mixedGeometry: true }), "200-10k BatchedMesh");
  assert.equal(chooseMotionRoute({ actorCount: 20000 }), "10k+ StorageInstancedBufferAttribute");
  const plan = createGpuInstanceMotionPlan({ instanceCount: 64 });
  if (induceViolation) plan.renderConsumes = ["currentPose"];
  assert.equal(MOTION_STORAGE_LAYOUT.version, STORAGE_VERSION);
  const actualBytes = Object.values(plan.buffers)
    .filter((value) => value?.isStorageBufferAttribute || value?.isStorageInstancedBufferAttribute)
    .reduce((sum, value) => sum + value.array.byteLength, 0);
  assert.equal(plan.storageBytes, actualBytes, "reported bytes equal allocated storage");
  assert.equal(plan.storageBytes, 64 * MOTION_STORAGE_LAYOUT.storageBytesPerInstance);
  const initialStorage = plan.describeStorage();
  assert.equal(initialStorage.allocatedStorageBytes, actualBytes);
  assert.equal(initialStorage.resources.length, 13);
  assert(initialStorage.resources.every((resource) => (
    resource.runtimeReachable === true
    && /^vec4<(?:f32|u32)>$/.test(resource.format)
    && resource.byteLength === 64 * 4 * Float32Array.BYTES_PER_ELEMENT
    && resource.producers.length > 0
    && resource.consumers.length > 0
  )), "runtime resource ledger has exact formats, bytes, producers, and consumers");
  assert.equal(initialStorage.previousStateVersion, initialStorage.currentStateVersion);
  assert.equal(MOTION_STORAGE_LAYOUT.dynamicState.slotCount, 2);
  assert.equal(MOTION_STORAGE_LAYOUT.dynamicState.presentationSlotCount, 2);
  assert.notEqual(plan.buffers.previousPose, plan.buffers.currentPose);
  assert.notEqual(plan.buffers.previousQuaternion, plan.buffers.currentQuaternion);
  assert.deepEqual(plan.renderConsumes, [
    "previousPresentedPose",
    "currentPresentedPose",
    "previousPresentedQuaternion",
    "currentPresentedQuaternion",
  ]);
  assert.equal(plan.computeStep.isComputeNode, true);
  assert.equal(plan.presentationStep.isComputeNode, true);
  const initializationMatrixBytes = 64 * 16 * Float32Array.BYTES_PER_ELEMENT;
  plan.recordInitializationInstanceMatrixUpload(initializationMatrixBytes);
  assert.throws(
    () => plan.recordInitializationInstanceMatrixUpload(initializationMatrixBytes),
    /exactly once/,
  );
  const submissionBeforeDispatch = plan.describeSubmission();
  assert.deepEqual(submissionBeforeDispatch, {
    initializationInstanceMatrixUploadCount: 1,
    initializationInstanceMatrixUploadBytes: initializationMatrixBytes,
    hotPathInstanceMatrixUploadCount: 0,
    hotPathInstanceMatrixUploadBytes: 0,
  });

  const recordedDispatches = [];
  let deviceGenerationActive = true;
  const recordingRenderer = {
    initialized: true,
    _isDeviceLost: false,
    backend: {
      isWebGPUBackend: true,
      device: { lost: Promise.resolve({ reason: "fixture remains active" }) },
    },
    compute(node) { recordedDispatches.push(node); },
    async getArrayBufferAsync(attribute, _target, offset, count) {
      return attribute.array.buffer.slice(offset, offset + count);
    },
  };
  plan.bindRendererDevice(recordingRenderer, {
    deviceGeneration: 1,
    isDeviceGenerationActive: (generation) => deviceGenerationActive && generation === 1,
  });
  assert.deepEqual(plan.describeRendererBinding(), {
    status: "active",
    bound: true,
    deviceGeneration: 1,
    active: true,
  });
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
  const steppedStorage = plan.describeStorage();
  assert.equal(steppedStorage.previousStateVersion, initialStorage.currentStateVersion + fixedSteps - 1);
  assert.equal(steppedStorage.currentStateVersion, initialStorage.currentStateVersion + fixedSteps);
  assert.deepEqual(plan.describeSubmission(), submissionBeforeDispatch, "fixed-step compute performs no instance-matrix uploads");
  const stateVersionBeforePresentation = steppedStorage.currentStateVersion;
  plan.preparePresentation(recordingRenderer, 0.5);
  const presentedStorage = plan.describeStorage();
  assert.equal(presentedStorage.currentStateVersion, stateVersionBeforePresentation, "presentation does not invent a solver state version");
  assert.equal(presentedStorage.presentationDispatchCount, 1);
  assert.equal(recordedDispatches.at(-1), plan.presentationStep);
  deviceGenerationActive = false;
  assert.throws(
    () => plan.dispatchFixedStep(recordingRenderer, 1 / 120, 1),
    /device generation is not active/,
  );
  assert.equal(
    plan.describeStorage().currentStateVersion,
    steppedStorage.currentStateVersion,
    "rejected dispatch does not publish a version",
  );
  deviceGenerationActive = true;

  const seedBefore = plan.buffers.seedFlags.array[4];
  const anchorBefore = plan.buffers.anchorFrequency.array.slice(4, 8);
  plan.setSeed(0x9e3779b9, recordingRenderer);
  assert.notEqual(plan.buffers.seedFlags.array[4], seedBefore, "reseed updates deterministic static storage");
  assert.notDeepEqual(
    plan.buffers.anchorFrequency.array.slice(4, 8),
    anchorBefore,
    "reseed changes the visible authored storage-actor distribution",
  );
  assert(
    Math.hypot(plan.buffers.anchorFrequency.array[4], plan.buffers.anchorFrequency.array[6]) >= 0.8,
    "non-parity storage actors sit outside the hero silhouette at the reference scene scale",
  );
  assert.equal(plan.initializeState.value, 0, "GPU reseed initialization does not leak into fixed-step dispatch");
  plan.seek(recordingRenderer, 4.25);
  assert.equal(plan.simulationTime.value, 4.25, "explicit GPU seek targets the requested time");
  const seekStorage = plan.describeStorage();
  assert.equal(seekStorage.previousStateVersion, seekStorage.currentStateVersion, "seek initializes exact previous/current endpoints");
  assert.equal(seekStorage.readbackConfirmedStateVersion, null, "submission alone is not GPU-completion evidence");
  const confirmedReadback = await plan.readback(recordingRenderer, 1);
  assert.equal(confirmedReadback.readbackConfirmedStateVersion, seekStorage.currentStateVersion);
  assert.equal(plan.describeStorage().readbackConfirmedStateVersion, seekStorage.currentStateVersion);
  assert.equal(confirmedReadback.readbackBytes, 13 * 4 * Float32Array.BYTES_PER_ELEMENT);
  assert(confirmedReadback.angularVelocity instanceof Float32Array);
  assert(confirmedReadback.axisPhase instanceof Float32Array);
  assert(confirmedReadback.seedFlags instanceof Uint32Array);
  assert(confirmedReadback.previousPresentedPose instanceof Float32Array);
  assert.deepEqual(Object.keys(confirmedReadback.rawBufferFormats).sort(), initialStorage.resources.map(({ id }) => id).sort());

  const lossPlan = createGpuInstanceMotionPlan({ instanceCount: 1 });
  let readbackGenerationActive = true;
  const lossRenderer = {
    initialized: true,
    _isDeviceLost: false,
    backend: {
      isWebGPUBackend: true,
      device: { lost: Promise.resolve({ reason: "fixture loses generation during map" }) },
    },
    compute() {},
    async getArrayBufferAsync(attribute, _target, offset, count) {
      await Promise.resolve();
      readbackGenerationActive = false;
      return attribute.array.buffer.slice(offset, offset + count);
    },
  };
  lossPlan.bindRendererDevice(lossRenderer, {
    deviceGeneration: 1,
    isDeviceGenerationActive: () => readbackGenerationActive,
  });
  await assert.rejects(
    () => lossPlan.readback(lossRenderer, 1),
    /device generation is not active/,
    "async storage readback rechecks device generation after mapping",
  );
  assert.equal(lossPlan.describeStorage().readbackConfirmedStateVersion, null);
  lossPlan.dispose();

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
  const endpointMirror = createInstanceMotionMirror({ instanceCount: 1 });
  const initialEndpoint = endpointMirror.currentPose.slice();
  const initialQuaternionEndpoint = endpointMirror.currentQuaternion.slice();
  stepInstanceMotionMirror(endpointMirror, 1 / 120, 1 / 120);
  assert.deepEqual(endpointMirror.previousPose, initialEndpoint, "previous position endpoint is the exact prior current state");
  assert.deepEqual(endpointMirror.previousQuaternion, initialQuaternionEndpoint, "previous quaternion endpoint is the exact prior current state");
  assert.equal(endpointMirror.previousStateVersion, 1);
  assert.equal(endpointMirror.currentStateVersion, 2);
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
  assert.equal(plan.storageAttributeCount, 13);
  assert.equal(plan.dispose(), true);
  assert.equal(plan.dispose(), false);
  assert.equal(disposedStorageAttributes, 13, "all thirteen storage attributes are disposed exactly once");
  assert.deepEqual(plan.describeRendererBinding(), {
    status: "disposed",
    bound: false,
    deviceGeneration: null,
    active: false,
  }, "disposed storage plans cannot retain an apparently active renderer lease");
  return {
    storageBytes: plan.storageBytes,
    fixedSteps,
    deterministicSteps: policy.simulationSteps,
    recordedDispatches: recordedDispatches.length,
    initialStorageVersion: initialStorage.currentStateVersion,
    steppedStorageVersions: [steppedStorage.previousStateVersion, steppedStorage.currentStateVersion],
    noHotPathMatrixUploads: plan.describeSubmission().hotPathInstanceMatrixUploadCount === 0,
    disposedStorageAttributes,
  };
}

function validatePipelineOwnership() {
  assert.deepEqual(MOTION_PIPELINE_OWNERSHIP, {
    rendererOwner: "webgpu-procedural-timelines",
    renderPipelineOwner: "webgpu-procedural-timelines",
    motionOwner: "procedural-motion-core",
    finalToneMapOwner: "renderOutput",
    finalOutputTransformOwner: "renderOutput",
    outputColorTransform: false,
    litSceneSubmissionCount: 1,
  });
  assert.equal(Object.isFrozen(MOTION_PIPELINE_OWNERSHIP), true);
  assert.equal(MOTION_VELOCITY_DIAGNOSTIC_GAIN, 128);
  assert.equal(MOTION_STAGE_PRESENTATION.physicalClaim, false);
  assert.deepEqual(MOTION_ORIGIN_METADATA.physicsOriginMeters, [0, 0, 0]);
  assert.equal(MOTION_ORIGIN_METADATA.positionUnit, "meter-before-boundary");
  return { ...MOTION_PIPELINE_OWNERSHIP, originMetadata: MOTION_ORIGIN_METADATA };
}

function validateTimelineGpuMirrorContract() {
  const checkpoints = [
    ["launch-and-staging", 12],
    ["spin-docking", 7.5],
    ["debris-release", 3.25],
    ["quaternion-and-reparent", 4],
    ["compute-storage", 2.75],
    ["interpolation-and-velocity", 3.5],
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
    assert.equal(plan.computeStep.name, motionComputeShaderIdentifier(scenario));
    assert.equal(plan.presentationStep.name, motionPresentationShaderIdentifier(scenario));
    assert.equal(plan.computeStep.isComputeNode, true);
    plan.dispose();
    results.push({ scenario, time, positionError, velocityError });
  }
  const dockingAtThree = createMotionState({ scenario: "spin-docking" });
  stepTimelineState(dockingAtThree, 0, 3);
  for (const scenario of ["quaternion-and-reparent", "compute-storage", "interpolation-and-velocity"]) {
    const distinct = createMotionState({ scenario });
    stepTimelineState(distinct, 0, 3);
    assert(distinct.position.distanceTo(dockingAtThree.position) > 0.1, `${scenario} is not a spin-docking alias`);
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

  const launchPrevious = createMotionState({ scenario: "launch-and-staging" });
  const launchCurrent = createMotionState({ scenario: "launch-and-staging" });
  const launchPresented = createMotionState({ scenario: "launch-and-staging" });
  stepTimelineState(launchPrevious, 1 / 120, 24 - 1 / 120);
  stepTimelineState(launchCurrent, 1 / 120, 24);
  interpolateMotionState(launchPresented, launchPrevious, launchCurrent, 0);
  assert.equal(launchPresented.simulationTime, launchPrevious.simulationTime);
  assert.equal(launchPresented.phaseId, 0);
  assert.equal(launchPresented.eventFlags.stageDetached, false);
  interpolateMotionState(launchPresented, launchPrevious, launchCurrent, 0.5);
  assert.equal(launchPresented.simulationTime, 24 - 1 / 240);
  assert.equal(launchPresented.phaseId, 0);
  assert.equal(launchPresented.phaseLocalTime, 24 - 1 / 240);
  assert.equal(launchPresented.eventFlags.stageDetached, false);
  interpolateMotionState(launchPresented, launchPrevious, launchCurrent, 1);
  assert.equal(launchPresented.simulationTime, 24);
  assert.equal(launchPresented.phaseId, 1);
  assert.equal(launchPresented.phaseLocalTime, 0);
  assert.equal(launchPresented.eventFlags.stageDetached, true);
  assert.deepEqual(launchPresented.eventLog, launchCurrent.eventLog);

  const mirror = createInstanceMotionMirror({ instanceCount: 1, scenario: "interpolation-and-velocity" });
  stepInstanceMotionMirror(mirror, 1 / 120, 1 / 120);
  prepareInstanceMotionMirrorPresentation(mirror, 0.25);
  const quarterPresented = mirror.currentPresentedPose.slice();
  prepareInstanceMotionMirrorPresentation(mirror, 0.5);
  assert.deepEqual(mirror.previousPresentedPose, quarterPresented, "previous presentation retains the exact accepted alpha=0.25 transform");
  assert.notDeepEqual(mirror.currentPresentedPose, mirror.previousPresentedPose, "alpha motion without a solver step still produces consecutive presented transforms");
  const halfPresented = mirror.currentPresentedPose.slice();
  stepInstanceMotionMirror(mirror, 1 / 120, 2 / 120);
  prepareInstanceMotionMirrorPresentation(mirror, 0.1);
  assert.deepEqual(mirror.previousPresentedPose, halfPresented, "bracket transition retains the prior presented transform instead of substituting a solver endpoint");

  const signMirror = createInstanceMotionMirror({ instanceCount: 1, scenario: "interpolation-and-velocity" });
  stepInstanceMotionMirror(signMirror, 1 / 120, 1 / 120);
  const positive = signMirror.currentQuaternion.slice();
  signMirror.currentQuaternion.set(positive.map((value) => -value));
  prepareInstanceMotionMirrorPresentation(signMirror, 0.5);
  const signInvariant = new Quaternion().fromArray(signMirror.currentPresentedQuaternion);
  const expected = slerpQuaternionsShortest(
    new Quaternion().fromArray(signMirror.previousQuaternion),
    new Quaternion().fromArray(positive),
    0.5,
  );
  assert(quaternionAngle(signInvariant, expected) < 1e-7, "presented interpolation is hemisphere safe");
  const boundaryMirror = createInstanceMotionMirror({ instanceCount: 1, scenario: "launch-and-staging" });
  stepInstanceMotionMirror(boundaryMirror, 1 / 120, 24 - 1 / 120);
  stepInstanceMotionMirror(boundaryMirror, 1 / 120, 24);
  prepareInstanceMotionMirrorPresentation(boundaryMirror, 0.5);
  assert.equal(boundaryMirror.currentPresentedPose[3], 0, "GPU mirror phase remains discrete before the authored boundary");
  prepareInstanceMotionMirrorPresentation(boundaryMirror, 1);
  assert.equal(boundaryMirror.currentPresentedPose[3], 1, "GPU mirror adopts the new phase exactly at the endpoint");
  return {
    endpointsExact: true,
    boundaryMetadataExact: true,
    consecutivePresentedTransforms: true,
    hemisphereSafe: true,
  };
}

function validateNonIntegralReplayDuration() {
  const durationSeconds = 1.01;
  const rates = [30, 60, 120, 144];
  const replays = rates.map((presentationHz) => simulateTimeline({
    presentationHz,
    durationSeconds,
    scenario: "compute-storage",
  }));
  const baseline = replays[0].state;
  for (const replay of replays) {
    assert(Math.abs(replay.policy.presentationTime - durationSeconds) < 1e-12);
    assert(replay.policy.simulationTime <= durationSeconds + 1e-12, "fixed-step solver never overshoots real time");
    assert.equal(replay.state.simulationTime, durationSeconds, "analytic comparison sample is taken at exact real time");
    assert(replay.state.position.distanceTo(baseline.position) < 1e-12);
    assert(replay.state.velocity.distanceTo(baseline.velocity) < 1e-12);
    assert(quaternionAngle(replay.state.quaternion, baseline.quaternion) < 1e-12);
  }
  return { durationSeconds, rates, exactRemainderApplied: true };
}

function validateRoutes() {
  for (const scenario of MOTION_SCENARIOS) {
    const route = parseMotionRoute({ pathname: `/demos/motion/mechanism/${scenario}/`, search: "?tier=balanced&mode=velocity" });
    assert.deepEqual(route, {
      scenario,
      tier: "balanced",
      mode: "velocity",
      locks: { scenario: true, tier: false },
    });
  }
  for (const tier of Object.keys(MOTION_TIERS)) {
    assert.equal(parseMotionRoute({ pathname: `/demos/motion/tier/${tier}/`, search: "" }).tier, tier);
  }
  for (const mode of MOTION_MODES) assert.equal(parseMotionRoute({ pathname: "/", search: `?mode=${mode}` }).mode, mode);
  assert.throws(() => parseMotionRoute({ pathname: "/mechanism/fabricated/", search: "" }), /unknown motion scenario/);
  assert.throws(() => createGpuInstanceMotionPlan({ scenario: "fabricated", instanceCount: 1 }), /unknown motion scenario/);
  const corruptedState = createMotionState();
  corruptedState.scenario = "fabricated";
  assert.throws(() => stepTimelineState(corruptedState, 0, 0), /unknown motion scenario/);
  assert.throws(() => parseMotionRoute({ pathname: "/tier/fabricated/", search: "" }), /unknown motion tier/);
  assert.throws(() => parseMotionRoute({ pathname: "/mechanism/", search: "" }), /missing its locked id/);
  assert.throws(() => parseMotionRoute({ pathname: "/", search: "?mode=final&mode=velocity" }), /duplicate motion mode/);
  assert.throws(
    () => parseMotionRoute({ pathname: "/mechanism/compute-storage/", search: "?scenario=spin-docking" }),
    /locked to compute-storage/,
  );
  const locked = parseMotionRoute({ pathname: "/mechanism/compute-storage/", search: "?tier=full" });
  assert.equal(assertMotionRouteLock(locked), locked);
  assert.throws(() => assertMotionRouteLock(locked, { scenario: "spin-docking" }), /locked to compute-storage/);
  assert.equal(assertMotionRouteLock(locked, { tier: "balanced" }), locked);
  const tierLocked = parseMotionRoute({ pathname: "/tier/full/", search: "?scenario=spin-docking" });
  assert.throws(() => assertMotionRouteLock(tierLocked, { tier: "balanced" }), /locked to full/);
  const base = parseMotionRoute({ pathname: "/", search: "" });
  assert.deepEqual(base.locks, { scenario: false, tier: false });
  assert.equal(assertMotionRouteLock(base, { scenario: "launch-and-staging", tier: "test-minimum" }), base);
  return { scenarios: MOTION_SCENARIOS.length, tiers: Object.keys(MOTION_TIERS).length };
}

function validateRendererEvidenceContract() {
  assert.equal(parseMotionRuntimeProfile({ search: "" }), "correctness");
  assert.equal(parseMotionRuntimeProfile({ search: "?profile=performance" }), "performance");
  assert.throws(() => parseMotionRuntimeProfile({ search: "?profile=correctness&profile=performance" }), /duplicate/);
  assert.throws(() => parseMotionRuntimeProfile({ search: "?profile=synthetic" }), /unknown motion capture profile/);
  const device = { lost: Promise.resolve({ reason: "fixture" }) };
  const renderer = { initialized: true, backend: { isWebGPUBackend: true, device } };
  assert.equal(requireInitializedMotionRendererDevice(renderer), device);
  assert.throws(
    () => requireInitializedMotionRendererDevice({ initialized: true, backend: { isWebGPUBackend: false, device } }),
    /one initialized native WebGPU renderer/,
  );
  assert.throws(
    () => requireInitializedMotionRendererDevice({ initialized: true, backend: { isWebGPUBackend: true, device: {} } }),
    /loss promise/,
  );
  assert.deepEqual(describeMotionGpuTiming(false), {
    verdict: "INSUFFICIENT_EVIDENCE",
    reason: "timestamp tracking is not active for this capture profile",
  });
  assert.equal(describeMotionGpuTiming(true).verdict, "INSUFFICIENT_EVIDENCE");
  const rollbackOrder = [];
  const rollbackErrors = runMotionRollback([
    () => rollbackOrder.push("scene"),
    () => { throw new Error("material rollback failed"); },
    () => rollbackOrder.push("state"),
  ]);
  assert.deepEqual(rollbackOrder, ["scene", "state"], "rollback continues after a failed restoration step");
  assert.equal(rollbackErrors.length, 1);
  return { profiles: 2, requiresActualDeviceLossPromise: true };
}

const gates = {
  claimBoundary: { cpuContractExecuted: true, browserWebGpuExecutedThisRun: false, gpuTiming: "INSUFFICIENT_EVIDENCE" },
  replayAndTerminalLock: validateReplayAndTerminalLock(),
  sceneUnitsOnce: validateSceneUnitsOnce(),
  transformedParentReparent: validateReparent(),
  integratedSpin: validateSpinIntegration(),
  seedQuaternionResume: validateSeedQuaternionAndResume(),
  debris: validateDebris(),
  storageAndDeterminism: await validateStorageAndDeterminism(),
  pipelineOwnership: validatePipelineOwnership(),
  timelineGpuMirrorContract: validateTimelineGpuMirrorContract(),
  interpolation: validateInterpolation(),
  nonIntegralReplayDuration: validateNonIntegralReplayDuration(),
  routes: validateRoutes(),
  rendererEvidenceContract: validateRendererEvidenceContract(),
};

console.log(JSON.stringify(gates, null, 2));
