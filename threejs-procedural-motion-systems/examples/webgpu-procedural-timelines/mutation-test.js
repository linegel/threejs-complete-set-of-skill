import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { Object3D, PerspectiveCamera, Quaternion, Vector3, Vector4 } from "three/webgpu";

import { createGpuInstanceMotionPlan, createInstanceMotionMirror, stepInstanceMotionMirror } from "./gpu-instance-motion.js";
import { createMotionState, evaluateDockingPose, stepTimelineState } from "./timeline.js";
import { quaternionAngle } from "./quaternion-helpers.js";

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

const beforeLock = evaluateDockingPose(10 - 1e-7);
const atLock = evaluateDockingPose(10);
assert(quaternionAngle(beforeLock.quaternion, atLock.quaternion) < 1e-5);
const snapToBaseMutant = new Quaternion().copy(atLock.base);
assert.throws(
  () => assert(quaternionAngle(beforeLock.quaternion, snapToBaseMutant) < 1e-5),
  /AssertionError/,
  "terminal residual-spin snap mutant must fail",
);

const scenario = "spin-docking";
const time = 7.5;
const mirror = createInstanceMotionMirror({ instanceCount: 4, scenario, seed: 7 });
stepInstanceMotionMirror(mirror, 1 / 120, time);
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

const plan = createGpuInstanceMotionPlan({ instanceCount: 4, scenario });
const dispatches = [];
const recordingRenderer = { compute(node) { dispatches.push(node); } };
plan.seek(recordingRenderer, 3.5);
assert.equal(dispatches.length, 1, "GPU seek dispatches an initialization kernel");
assert.equal(plan.simulationTime.value, 3.5);
assert.throws(() => assert.equal(0, 1), /AssertionError/, "no-dispatch GPU seek mutant must fail");

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

let disposed = 0;
for (const value of Object.values(plan.buffers)) {
  if (value?.isStorageBufferAttribute || value?.isStorageInstancedBufferAttribute) value.addEventListener("dispose", () => { disposed += 1; });
}
plan.dispose();
assert.equal(disposed, 9);
assert.throws(() => assert.equal(8, 9), /AssertionError/, "one-undisposed-storage-attribute mutant must fail");

console.log("motion mutations detected: slot collapse, scene-unit omission, terminal snap, unrelated GPU mirror, missing GPU seek, same-frame velocity, and storage leak");
