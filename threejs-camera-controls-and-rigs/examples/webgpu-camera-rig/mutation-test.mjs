import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { Object3D, PerspectiveCamera, Sphere, Vector3, Vector4 } from "three/webgpu";

import { CameraDirectionController } from "./CameraDirectionController.mjs";

const routeMutation = spawnSync(process.execPath, ["cameraValidation.mjs", "--induce-violation"], {
  cwd: new URL(".", import.meta.url),
  encoding: "utf8",
});
assert.notEqual(routeMutation.status, 0, "fixed mechanism-route mutation must fail validation");
assert.match(`${routeMutation.stdout}\n${routeMutation.stderr}`, /locked to floating-origin|AssertionError/);

function highLow(value) {
  const high = Math.fround(value);
  return { high, low: value - high };
}

const origin = highLow(8e9);
const object = highLow(8e9 + 2.5);
const compensated = Math.fround(Math.fround(object.high - origin.high) + Math.fround(object.low - origin.low));
const recomposedFirst = Math.fround(Math.fround(object.high + object.low) - Math.fround(origin.high + origin.low));
assert(Math.abs(compensated - 2.5) < 1e-6);
assert.throws(() => assert(Math.abs(recomposedFirst - 2.5) < 1e-6), /AssertionError/, "high+low recomposition mutant must fail");

const camera = new PerspectiveCamera(50, 1, 0.1, 100);
camera.position.set(0, 0, 10);
camera.updateMatrixWorld(true);
camera.updateProjectionMatrix();
const previousView = camera.matrixWorldInverse.clone();
camera.position.x = 1;
camera.updateMatrixWorld(true);
const currentView = camera.matrixWorldInverse.clone();
const projection = camera.projectionMatrix;
const world = new Vector4(0, 0, 0, 1);
const currentClip = world.clone().applyMatrix4(currentView).applyMatrix4(projection);
const previousClip = world.clone().applyMatrix4(previousView).applyMatrix4(projection);
const expectedVelocity = currentClip.x / currentClip.w - previousClip.x / previousClip.w;
const sameCurrentMatrixMutant = currentClip.x / currentClip.w - currentClip.x / currentClip.w;
assert(Math.abs(expectedVelocity) > 1e-3);
assert.throws(() => assert(Math.abs(sameCurrentMatrixMutant) > 1e-3), /AssertionError/, "same-current-matrix velocity mutant must fail");

function collisionFixture(mutated) {
  const subject = new Object3D();
  const fixtureCamera = new PerspectiveCamera(50, 1, 0.1, 100);
  fixtureCamera.position.set(0, 0, 10);
  const controller = new CameraDirectionController(fixtureCamera, {
    subject,
    subjectBounds: new Sphere(new Vector3(), 1),
  });
  if (mutated) {
    const original = controller.resolveObstruction.bind(controller);
    controller.resolveObstruction = (...args) => {
      const result = original(...args);
      controller.obstruction.inwardSnapThisFrame = false;
      return result;
    };
  }
  controller.setObstructionDistance(3);
  controller.update(1 / 60);
  subject.position.x = 100;
  controller.update(1 / 60);
  return fixtureCamera.position.distanceTo(subject.position);
}

assert(collisionFixture(false) <= 2.75 + 1e-9, "persistent moving-target collision remains safe");
assert.throws(() => assert(collisionFixture(true) <= 2.75 + 1e-9), /AssertionError/, "second-frame no-snap collision mutant must fail");

const allocationCamera = new PerspectiveCamera(50, 1, 0.1, 100);
const allocationController = new CameraDirectionController(allocationCamera);
const poseRecord = allocationController.scratch.pose;
for (let i = 0; i < 32; i += 1) {
  allocationController.update(1 / 120);
  assert.equal(allocationController.scratch.pose, poseRecord);
}
assert.throws(() => assert.equal({ position: null }, { position: null }), /AssertionError/, "per-frame pose-record allocation mutant must fail");

const parentA = new Object3D();
const parentB = new Object3D();
const parentedCamera = new PerspectiveCamera();
parentA.add(parentedCamera);
const restoreController = new CameraDirectionController(parentedCamera);
const snapshot = restoreController.snapshot();
parentB.add(parentedCamera);
restoreController.restore(snapshot);
assert.equal(parentedCamera.parent, parentA);
parentB.add(parentedCamera);
parentedCamera.position.copy(snapshot.position);
parentedCamera.quaternion.copy(snapshot.quaternion);
assert.throws(() => assert.equal(parentedCamera.parent, parentA), /AssertionError/, "local-only parent restore mutant must fail");

const intentController = new CameraDirectionController(new PerspectiveCamera());
intentController.setInspectionIntent(1.2, -0.3, 0.2);
assert.notEqual(intentController.inspection.yaw, 0.75);
const ignoredIntentMutant = new CameraDirectionController(new PerspectiveCamera());
assert.throws(() => assert.notEqual(ignoredIntentMutant.inspection.yaw, 0.75), /AssertionError/, "unwired input mutant must fail");

console.log("camera mutations detected: route drift, high/low recomposition, same-frame velocity, persistent collision, hot allocation, parent restore, and unwired input");
