import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { Matrix4, Object3D, PerspectiveCamera, Quaternion, Vector3, Vector4 } from "three/webgpu";

import {
  createGpuInstanceMotionPlan,
  createInstanceMotionMirror,
  prepareInstanceMotionMirrorPresentation,
  requireWgslIdentifier,
  stepInstanceMotionMirror,
} from "./gpu-instance-motion.js";
import {
  MOTION_PIPELINE_OWNERSHIP,
  describeMotionGpuTiming,
  parseMotionRuntimeProfile,
  requireInitializedMotionRendererDevice,
  runMotionRollback,
} from "./main.js";
import {
  createMotionState,
  createReparentFixture,
  computeReleasedDebrisVelocity,
  evaluateDockingPose,
  evaluateComputeStoragePose,
  evaluateInterpolationVelocityPose,
  evaluateQuaternionReparentPose,
  interpolateMotionState,
  matrixMaxAbsDifference,
  simulateTimeline,
  stepTimelineState,
} from "./timeline.js";
import { fromUnitVectorsSafe, quaternionAngle, quaternionNormError, slerpQuaternionsShortest } from "./quaternion-helpers.js";
import { parseMotionRoute } from "./route-state.js";

const previousCurrentMutation = spawnSync(process.execPath, ["validation.js", "--induce-violation"], {
  cwd: new URL(".", import.meta.url),
  encoding: "utf8",
});
assert.notEqual(previousCurrentMutation.status, 0, "previous/current storage mutation must fail validation");
assert.match(`${previousCurrentMutation.stdout}\n${previousCurrentMutation.stderr}`, /deep-equal|AssertionError/);

const dockingA = evaluateDockingPose(5, { sceneUnitsPerMeter: 0.001 });
const dockingB = evaluateDockingPose(5, { sceneUnitsPerMeter: 0.002 });
assert(dockingA.position.clone().multiplyScalar(2).distanceTo(dockingB.position) < 1e-12);
const unscaledDockingMutant = dockingA.position.clone();
assert.throws(
  () => assert(unscaledDockingMutant.clone().multiplyScalar(2).distanceTo(dockingA.position) < 1e-12),
  /AssertionError/,
  "docking scene-unit omission mutant must fail",
);
const doubleScaledDockingMutant = dockingA.position.clone().multiplyScalar(0.001);
assert.throws(
  () => assert(doubleScaledDockingMutant.clone().multiplyScalar(2).distanceTo(dockingB.position) < 1e-12),
  /AssertionError/,
  "docking double-scale mutant must fail",
);

const reparentFixture = createReparentFixture();
const wrongWorldAfter = new Matrix4().multiplyMatrices(
  reparentFixture.newParent.matrixWorld,
  reparentFixture.worldBefore,
);
assert.throws(
  () => assert(matrixMaxAbsDifference(reparentFixture.worldBefore, wrongWorldAfter) <= reparentFixture.worldResidualGate),
  /AssertionError/,
  "world-matrix-as-local reparent mutant must fail",
);
assert(reparentFixture.worldResidualGate > reparentFixture.worldAbsoluteResidualFloor);
const unconditionedAbsoluteGateMutant = reparentFixture.worldAbsoluteResidualFloor;
assert.throws(
  () => assert.equal(reparentFixture.worldResidualGate, unconditionedAbsoluteGateMutant),
  /AssertionError/,
  "absolute-only reparent tolerance mutant must fail the condition-relative contract",
);

for (const presentationHz of [30, 60, 120, 144]) {
  const replay = simulateTimeline({ presentationHz, durationSeconds: 12, scenario: "spin-docking" });
  const duplicateEventMutant = [...replay.state.eventLog, { ...replay.state.eventLog[0] }];
  assert.throws(
    () => assert.equal(new Set(duplicateEventMutant.map((event) => event.eventName)).size, duplicateEventMutant.length),
    /AssertionError/,
    `duplicate event mutant must fail at ${presentationHz} Hz`,
  );
  const sampledTimeMutant = replay.state.eventLog.map((event) => ({ ...event, time: 12 }));
  assert.throws(
    () => assert.deepEqual(sampledTimeMutant.map((event) => event.time), [6, 10]),
    /deep-equal|AssertionError/,
    `first-sampled event-time mutant must fail at ${presentationHz} Hz`,
  );
}

const nonIntegralDurationSeconds = 1.01;
const nonIntegralReplays = [30, 60, 120, 144].map((presentationHz) => simulateTimeline({
  presentationHz,
  durationSeconds: nonIntegralDurationSeconds,
  scenario: "compute-storage",
}));
for (const replay of nonIntegralReplays) {
  assert(replay.policy.simulationTime <= nonIntegralDurationSeconds + 1e-12);
  assert.equal(replay.state.simulationTime, nonIntegralDurationSeconds);
}
const roundedFrameOvershootMutant = Math.round(nonIntegralDurationSeconds * 60) / 60;
assert.throws(
  () => assert(roundedFrameOvershootMutant <= nonIntegralDurationSeconds),
  /AssertionError/,
  "rounded-frame replay overshoot mutant must fail",
);

const beforeLock = evaluateDockingPose(10 - 1e-7);
const atLock = evaluateDockingPose(10);
assert(quaternionAngle(beforeLock.quaternion, atLock.quaternion) < 1e-5);
const snapToBaseMutant = new Quaternion().copy(atLock.base);
assert.throws(
  () => assert(quaternionAngle(beforeLock.quaternion, snapToBaseMutant) < 1e-5),
  /AssertionError/,
  "terminal residual-spin snap mutant must fail",
);
const residualVelocityLockMutant = evaluateDockingPose(7).velocity.clone();
assert.throws(
  () => assert.equal(residualVelocityLockMutant.lengthSq(), 0),
  /AssertionError/,
  "terminal lock retaining linear velocity must fail",
);

const antiparallelAxis = new Vector3(0, 1, 0);
const antiparallel = fromUnitVectorsSafe(
  antiparallelAxis,
  antiparallelAxis.clone().negate(),
  antiparallelAxis,
);
assert(quaternionNormError(antiparallel) < 1e-12);
assert(antiparallelAxis.clone().applyQuaternion(antiparallel).distanceTo(antiparallelAxis.clone().negate()) < 1e-12);
const hemisphereStart = new Quaternion().setFromAxisAngle(new Vector3(0, 1, 0), 0.8);
const hemisphereNegated = new Quaternion(
  -hemisphereStart.x,
  -hemisphereStart.y,
  -hemisphereStart.z,
  -hemisphereStart.w,
);
const safeMidpoint = slerpQuaternionsShortest(hemisphereStart, hemisphereNegated, 0.5);
assert(quaternionAngle(hemisphereStart, safeMidpoint) < 1e-12);
const componentMixMutant = new Quaternion(
  (hemisphereStart.x + hemisphereNegated.x) * 0.5,
  (hemisphereStart.y + hemisphereNegated.y) * 0.5,
  (hemisphereStart.z + hemisphereNegated.z) * 0.5,
  (hemisphereStart.w + hemisphereNegated.w) * 0.5,
);
assert.throws(
  () => assert(quaternionNormError(componentMixMutant) < 1e-4),
  /AssertionError/,
  "component-mix quaternion double-cover mutant must fail",
);

const physicalDebris = computeReleasedDebrisVelocity({ sceneUnitsPerMeter: 1 });
assert(physicalDebris.velocity.length() <= 95);
assert.throws(
  () => assert(physicalDebris.velocity.length() <= 0.095),
  /AssertionError/,
  "scene-unit-as-SI debris cap mutant must fail",
);

const scenario = "spin-docking";
const time = 7.5;
const mirror = createInstanceMotionMirror({ instanceCount: 4, scenario, seed: 7 });
const initialPreviousEndpoint = mirror.currentPose.slice();
stepInstanceMotionMirror(mirror, 1 / 120, time);
assert.deepEqual(mirror.previousPose.slice(0, 4), initialPreviousEndpoint.slice(0, 4));
const collapsedEndpointMutant = mirror.previousPose.slice();
collapsedEndpointMutant.set(mirror.currentPose);
assert.throws(
  () => assert.deepEqual(collapsedEndpointMutant.slice(0, 4), initialPreviousEndpoint.slice(0, 4)),
  /deep-equal|AssertionError/,
  "collapsed previous/current endpoint mutant must fail",
);
const cpu = createMotionState({ scenario, seed: 7 });
stepTimelineState(cpu, 1 / 120, time);
const parityPosition = new Vector3(mirror.currentPose[0], mirror.currentPose[1], mirror.currentPose[2]);
assert(parityPosition.distanceTo(cpu.position) < 1e-6);
const unrelatedSinusoidMutant = new Vector3(Math.sin(time), Math.cos(time), 0);
assert.throws(
  () => assert(unrelatedSinusoidMutant.distanceTo(cpu.position) < 1e-6),
  /AssertionError/,
  "unrelated sinusoid GPU-mirror mutant must fail",
);

const distinctRoutePoses = [
  evaluateQuaternionReparentPose(3),
  evaluateComputeStoragePose(3),
  evaluateInterpolationVelocityPose(3),
];
for (const pose of distinctRoutePoses) {
  assert(pose.position.distanceTo(evaluateDockingPose(3).position) > 0.1, "mechanism route is not a spin-docking alias");
}
const presentationMirror = createInstanceMotionMirror({ instanceCount: 1, scenario: "interpolation-and-velocity" });
stepInstanceMotionMirror(presentationMirror, 1 / 120, 1 / 120);
prepareInstanceMotionMirrorPresentation(presentationMirror, 0.25);
const firstPresented = presentationMirror.currentPresentedPose.slice();
prepareInstanceMotionMirrorPresentation(presentationMirror, 0.5);
assert.deepEqual(presentationMirror.previousPresentedPose, firstPresented);
const solverEndpointVelocityMutant = presentationMirror.currentPose[0] - presentationMirror.previousPose[0];
const consecutivePresentedVelocity = presentationMirror.currentPresentedPose[0] - presentationMirror.previousPresentedPose[0];
assert.notEqual(solverEndpointVelocityMutant, consecutivePresentedVelocity);
assert.throws(
  () => assert.equal(solverEndpointVelocityMutant, consecutivePresentedVelocity),
  /AssertionError/,
  "solver-endpoint-as-presented-velocity mutant must fail",
);

const boundaryPrevious = createMotionState({ scenario: "launch-and-staging" });
const boundaryCurrent = createMotionState({ scenario: "launch-and-staging" });
const boundaryPresented = createMotionState({ scenario: "launch-and-staging" });
stepTimelineState(boundaryPrevious, 1 / 120, 24 - 1 / 120);
stepTimelineState(boundaryCurrent, 1 / 120, 24);
interpolateMotionState(boundaryPresented, boundaryPrevious, boundaryCurrent, 0.5);
assert.equal(boundaryPresented.phaseId, 0);
assert.equal(boundaryPresented.eventFlags.stageDetached, false);
const fractionalPhaseClockMutant = {
  phaseId: boundaryCurrent.phaseId,
  phaseLocalTime: boundaryPrevious.phaseLocalTime
    + (boundaryCurrent.phaseLocalTime - boundaryPrevious.phaseLocalTime) * 0.5,
  stageDetached: boundaryPrevious.eventFlags.stageDetached,
};
assert.throws(
  () => {
    assert.equal(fractionalPhaseClockMutant.phaseId, 0);
    assert(fractionalPhaseClockMutant.phaseLocalTime > 23);
    assert.equal(fractionalPhaseClockMutant.stageDetached, false);
  },
  /AssertionError/,
  "mixed discrete phase/reset-clock metadata mutant must fail",
);

const boundaryMirror = createInstanceMotionMirror({ instanceCount: 1, scenario: "launch-and-staging" });
stepInstanceMotionMirror(boundaryMirror, 1 / 120, 24 - 1 / 120);
stepInstanceMotionMirror(boundaryMirror, 1 / 120, 24);
prepareInstanceMotionMirrorPresentation(boundaryMirror, 0.5);
assert.equal(boundaryMirror.currentPresentedPose[3], 0);
const fractionalGpuPhaseMutant = (
  boundaryMirror.previousPose[3]
  + (boundaryMirror.currentPose[3] - boundaryMirror.previousPose[3]) * 0.5
);
assert.throws(
  () => assert(Number.isInteger(fractionalGpuPhaseMutant)),
  /AssertionError/,
  "fractional GPU phase-ID mutant must fail",
);

const plan = createGpuInstanceMotionPlan({ instanceCount: 4, scenario });
const resourceLedger = plan.describeStorage();
assert.equal(resourceLedger.resources.length, 13);
assert(resourceLedger.resources.every((resource) => resource.runtimeReachable && resource.format && resource.byteLength > 0));
const untypedResourceMutant = { ...resourceLedger.resources[0], format: null };
assert.throws(
  () => assert.match(untypedResourceMutant.format ?? "", /^vec4</),
  /AssertionError/,
  "untyped runtime resource mutant must fail",
);
plan.recordInitializationInstanceMatrixUpload(4 * 16 * Float32Array.BYTES_PER_ELEMENT);
const matrixUploadMutant = {
  ...plan.describeSubmission(),
  hotPathInstanceMatrixUploadCount: 1,
  hotPathInstanceMatrixUploadBytes: 4 * 16 * Float32Array.BYTES_PER_ELEMENT,
};
assert.throws(
  () => assert.equal(matrixUploadMutant.hotPathInstanceMatrixUploadCount, 0),
  /AssertionError/,
  "per-frame instance-matrix upload mutant must fail",
);
const dispatches = [];
let activeDeviceGeneration = true;
const recordingRenderer = {
  initialized: true,
  _isDeviceLost: false,
  backend: {
    isWebGPUBackend: true,
    device: { lost: Promise.resolve({ reason: "fixture remains active" }) },
  },
  compute(node) { dispatches.push(node); },
};
plan.bindRendererDevice(recordingRenderer, {
  deviceGeneration: 1,
  isDeviceGenerationActive: (generation) => activeDeviceGeneration && generation === 1,
});
plan.seek(recordingRenderer, 3.5);
assert.equal(dispatches.length, 3, "GPU seek dispatches bounded state, presentation, and static-metadata kernels");
assert.equal(plan.simulationTime.value, 3.5);
assert.throws(() => assert.equal(0, 1), /AssertionError/, "no-dispatch GPU seek mutant must fail");
assert.equal(plan.describeStorage().previousStateVersion, plan.describeStorage().currentStateVersion);
const versionBeforeDeviceLoss = plan.describeStorage().currentStateVersion;
activeDeviceGeneration = false;
assert.throws(
  () => plan.dispatchFixedStep(recordingRenderer, 1 / 120, 4),
  /device generation is not active/,
  "device-loss race must not publish a storage version",
);
assert.equal(plan.describeStorage().currentStateVersion, versionBeforeDeviceLoss);
activeDeviceGeneration = true;

const duplicatePipelineOwnerMutant = new Set([
  MOTION_PIPELINE_OWNERSHIP.renderPipelineOwner,
  "second-motion-render-pipeline",
]);
assert.throws(
  () => assert.equal(duplicatePipelineOwnerMutant.size, 1),
  /AssertionError/,
  "duplicate RenderPipeline owner mutant must fail",
);
assert.throws(
  () => parseMotionRoute({ pathname: "/mechanism/not-a-motion-route/", search: "" }),
  /unknown motion scenario/,
  "unknown route must fail closed",
);
assert.throws(
  () => createGpuInstanceMotionPlan({ instanceCount: 1, scenario: "not-a-motion-route" }),
  /unknown motion scenario/,
  "unknown GPU scenario must fail before graph construction",
);
const corruptedScenarioState = createMotionState();
corruptedScenarioState.scenario = "not-a-motion-route";
assert.throws(
  () => stepTimelineState(corruptedScenarioState, 0, 0),
  /unknown motion scenario/,
  "corrupted runtime scenario must fail instead of aliasing docking",
);
assert.throws(
  () => parseMotionRuntimeProfile({ search: "?profile=correctness&profile=performance" }),
  /duplicate motion capture profile/,
  "mixed capture-profile mutant must fail",
);
assert.equal(describeMotionGpuTiming(true).verdict, "INSUFFICIENT_EVIDENCE");
assert.throws(
  () => assert.equal("available-not-yet-resolved", "INSUFFICIENT_EVIDENCE"),
  /AssertionError/,
  "timestamp feature-presence mutant must not become timing evidence",
);
assert.throws(
  () => requireInitializedMotionRendererDevice({
    initialized: true,
    backend: { isWebGPUBackend: true, device: { label: "forged-without-loss-promise" } },
  }),
  /loss promise/,
  "forged renderer-device evidence mutant must fail",
);
const rollbackSteps = [];
const rollbackErrors = runMotionRollback([
  () => { throw new Error("first rollback mutation"); },
  () => rollbackSteps.push("later rollback still ran"),
]);
assert.deepEqual(rollbackSteps, ["later rollback still ran"]);
assert.equal(rollbackErrors.length, 1, "rollback failures are retained instead of short-circuiting restoration");
assert.throws(
  () => requireWgslIdentifier("motion:current-projection"),
  /WGSL identifier characters/,
  "punctuated TSL uniform-name mutant must fail before shader construction",
);

const camera = new PerspectiveCamera(50, 1, 0.1, 100);
const object = new Object3D();
camera.position.set(0, 0, 10);
camera.updateMatrixWorld(true);
object.updateMatrixWorld(true);
plan.primeFrameMatrices(camera, object);
plan.beginFrameMatrices();
camera.position.x = 1;
camera.updateMatrixWorld(true);
plan.captureFrameMatrices(camera, object);
const point = new Vector4(0, 0, 0, 1);
const currentClip = point.clone().applyMatrix4(plan.frameMatrices.currentModel).applyMatrix4(plan.frameMatrices.currentView).applyMatrix4(plan.frameMatrices.currentProjection);
const previousClip = point.clone().applyMatrix4(plan.frameMatrices.previousModel).applyMatrix4(plan.frameMatrices.previousView).applyMatrix4(plan.frameMatrices.previousProjection);
const velocity = currentClip.x / currentClip.w - previousClip.x / previousClip.w;
assert(Math.abs(velocity) > 1e-3);
assert.throws(() => assert(Math.abs(currentClip.x / currentClip.w - currentClip.x / currentClip.w) > 1e-3), /AssertionError/, "same-current-matrix velocity mutant must fail");

const lossPlan = createGpuInstanceMotionPlan({ instanceCount: 1 });
let mapGenerationActive = true;
const lossRenderer = {
  initialized: true,
  _isDeviceLost: false,
  backend: {
    isWebGPUBackend: true,
    device: { lost: Promise.resolve({ reason: "fixture generation ends during map" }) },
  },
  compute() {},
  async getArrayBufferAsync(attribute, _target, offset, count) {
    await Promise.resolve();
    mapGenerationActive = false;
    return attribute.array.buffer.slice(offset, offset + count);
  },
};
lossPlan.bindRendererDevice(lossRenderer, {
  deviceGeneration: 1,
  isDeviceGenerationActive: () => mapGenerationActive,
});
await assert.rejects(
  () => lossPlan.readback(lossRenderer, 1),
  /device generation is not active/,
  "post-map device-generation mutation must fail before readback confirmation",
);
assert.equal(lossPlan.describeStorage().readbackConfirmedStateVersion, null);
lossPlan.dispose();

let disposed = 0;
for (const value of Object.values(plan.buffers)) {
  if (value?.isStorageBufferAttribute || value?.isStorageInstancedBufferAttribute) value.addEventListener("dispose", () => { disposed += 1; });
}
plan.dispose();
assert.equal(disposed, 13);
assert.throws(() => assert.equal(12, 13), /AssertionError/, "one-undisposed-storage-attribute mutant must fail");
assert.deepEqual(plan.describeRendererBinding(), {
  status: "disposed",
  bound: false,
  deviceGeneration: null,
  active: false,
});
assert.throws(
  () => assert.equal({ status: "active", bound: true, active: true }.active, false),
  /AssertionError/,
  "disposed-plan-retains-active-renderer-binding mutant must fail",
);

const mainSource = readFileSync(new URL("./main.js", import.meta.url), "utf8");
const transactionStart = mainSource.indexOf("async reconfigureMotion");
const debugBeforeCommit = mainSource.indexOf("this.updateDebug(0);", transactionStart);
const commitPoint = mainSource.indexOf("committed = true;", transactionStart);
const detachActiveCleanup = mainSource.indexOf("nextPlan = null;", commitPoint);
const previousPlanDisposal = mainSource.indexOf("previous.plan.dispose();", commitPoint);
const committedCatchGuard = mainSource.indexOf("if (committed) throw error;", previousPlanDisposal);
assert(
  transactionStart >= 0
  && debugBeforeCommit > transactionStart
  && commitPoint > debugBeforeCommit
  && detachActiveCleanup > commitPoint
  && previousPlanDisposal > detachActiveCleanup
  && committedCatchGuard > previousPlanDisposal,
  "reconfiguration must complete fallible setup before commit and never roll back after old-plan disposal",
);
const disposeBeforeDebugMutant = {
  debugIndex: previousPlanDisposal,
  disposeIndex: debugBeforeCommit,
};
assert.throws(
  () => assert(disposeBeforeDebugMutant.disposeIndex > disposeBeforeDebugMutant.debugIndex),
  /AssertionError/,
  "dispose-before-last-fallible-operation mutant must fail",
);

console.log("motion mutations detected: slot collapse, scene-unit omission/double-scale, condition-relative reparent residual, event replay/time drift, non-integral schedule overshoot, terminal residuals, quaternion double cover/antiparallel fallback, SI debris cap, distinct mechanism routes, discrete boundary metadata, consecutive presented transforms, unrelated GPU mirror, missing GPU seek, matrix uploads, untyped resources, duplicate pipeline ownership, unknown scenarios/routes, mixed profiles, forged or lost device evidence, invalid WGSL names, same-frame velocity, transaction commit ordering, stale renderer binding, and storage leak");
