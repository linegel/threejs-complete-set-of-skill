import assert from "node:assert/strict";
import { PerspectiveCamera, Sphere, Vector3 } from "three";

import {
  CameraDirectionController,
  clampObstruction,
  computeCameraPose,
  computeScreenOccupancy,
  createCameraScratch,
  stepScalarSpring,
} from "./CameraDirectionController.mjs";

function createCamera() {
  const camera = new PerspectiveCamera(50, 16 / 9, 0.2, 1000);
  camera.position.set(0, 0, 10);
  camera.updateProjectionMatrix();
  return camera;
}

function validateBasis() {
  const camera = createCamera();
  const scratch = createCameraScratch();
  const target = new Vector3(0, 0, 0);
  computeCameraPose(camera.position, camera.quaternion, target, new Vector3(0, 0, 10), new Vector3(0, 1, 0), scratch);
  camera.updateMatrixWorld(true);
  const ndc = target.clone().project(camera);
  const cameraSpace = target.clone().applyMatrix4(camera.matrixWorldInverse);
  assert(Math.abs(ndc.x) < 1e-9 && Math.abs(ndc.y) < 1e-9, "camera -Z basis projects target center");
  assert(cameraSpace.z < 0, "target camera-space z is negative");
  return { ndc: ndc.toArray(), cameraSpaceZ: cameraSpace.z };
}

function validateDegenerateUp() {
  const camera = createCamera();
  computeCameraPose(
    camera.position,
    camera.quaternion,
    new Vector3(0, 0, 0),
    new Vector3(0, 10, 0),
    new Vector3(0, 1, 0),
  );
  const sum = camera.quaternion.x + camera.quaternion.y + camera.quaternion.z + camera.quaternion.w;
  assert(Number.isFinite(sum), "degenerate up fallback finite");
  return { quaternion: camera.quaternion.toArray() };
}

function replayHandoff(fps) {
  const camera = createCamera();
  const controller = new CameraDirectionController(camera, {
    subjectBounds: new Sphere(new Vector3(), 2),
  });
  controller.computeSidePose(camera.position, camera.quaternion);
  controller.startHandoff("orbit", 1.2);
  const frames = Math.ceil(1.2 * fps);
  for (let i = 0; i < frames; i += 1) controller.update(1 / fps);
  return camera.position.clone();
}

function validateHandoffReplay() {
  const positions = [30, 60, 120].map((fps) => replayHandoff(fps));
  const baseline = positions[0];
  for (const position of positions) {
    assert(position.distanceTo(baseline) < 1e-5, "handoff replay at 30/60/120 FPS");
  }
  return { distances: positions.map((position) => position.distanceTo(baseline)) };
}

function validateStallClamp() {
  const state = { value: 0, velocity: 0 };
  stepScalarSpring(state, 1, 1, { maxSubsteps: 8 });
  assert(state.value <= 1.01, "tab-stall clamp/substep does not overshoot");
  return state;
}

function validateProjectionSnapshot() {
  const camera = createCamera();
  const controller = new CameraDirectionController(camera);
  camera.fov = 41;
  camera.near = 0.7;
  camera.far = 777;
  camera.aspect = 1.7;
  camera.zoom = 1.2;
  camera.filmGauge = 36;
  camera.filmOffset = 2;
  camera.up.set(0.1, 0.98, 0).normalize();
  camera.layers.set(2);
  camera.setViewOffset(1920, 1080, 12, 24, 1280, 720);
  const snapshot = controller.snapshot();

  camera.fov = 60;
  camera.near = 1;
  camera.far = 10;
  camera.aspect = 1;
  camera.zoom = 0.5;
  camera.filmGauge = 12;
  camera.filmOffset = 0;
  camera.up.set(0, 1, 0);
  camera.layers.set(0);
  camera.clearViewOffset();

  controller.restore(snapshot);
  assert.equal(camera.fov, 41);
  assert.equal(camera.near, 0.7);
  assert.equal(camera.far, 777);
  assert.equal(camera.aspect, snapshot.aspect);
  assert.equal(camera.zoom, 1.2);
  assert.equal(camera.filmGauge, 36);
  assert.equal(camera.filmOffset, 2);
  assert(camera.view, "projection snapshot restores view");
  assert.equal(camera.layers.mask, snapshot.layers);
  assert(camera.up.distanceTo(snapshot.up) < 1e-12);
  return { fov: camera.fov, near: camera.near, far: camera.far, view: camera.view };
}

function validateOccupancyAndObstruction() {
  const camera = createCamera();
  const occupancy = computeScreenOccupancy(camera, 10, 1);
  assert(occupancy.vertical > 0 && occupancy.horizontal > 0, "screen occupancy");
  const clamped = clampObstruction({
    target: new Vector3(0, 0, 0),
    desiredPosition: new Vector3(0, 0, 10),
    hitDistance: 4,
    radius: 0.5,
  });
  assert(clamped.z < 10 && clamped.z > 0, "obstruction clamp");
  return { occupancy, clamped: clamped.toArray() };
}

function validateControllerSurfaceAndLifecycle() {
  const camera = createCamera();
  const controller = new CameraDirectionController(camera, {
    subjectBounds: new Sphere(new Vector3(), 2),
  });

  for (const method of [
    "computeChasePose",
    "computeSidePose",
    "computeOrbitPose",
    "updateModePose",
    "startHandoff",
    "update",
    "reacquirePointerLook",
    "reacquireOrbitControls",
    "updateFloatingOrigin",
    "snapshot",
    "restore",
    "dispose",
  ]) {
    assert.equal(typeof controller[method], "function", `${method} is exported on controller`);
  }

  controller.computeChasePose(camera.position, camera.quaternion);
  camera.updateMatrixWorld(true);

  const yawPitch = controller.reacquirePointerLook();
  assert(Number.isFinite(yawPitch.yaw), "pointer yaw is finite");
  assert(Number.isFinite(yawPitch.pitch), "pointer pitch is finite");

  const mockControls = {
    target: new Vector3(100, 100, 100),
    updateCount: 0,
    update() {
      this.updateCount += 1;
    },
  };
  controller.reacquireOrbitControls(mockControls, new Vector3(1, 2, 3));
  assert(mockControls.target.distanceTo(new Vector3(1, 2, 3)) < 1e-12, "orbit target reacquired");
  assert.equal(mockControls.updateCount, 1, "orbit controls update called");

  const origin = controller.updateFloatingOrigin(new Vector3(1_000_000, -2, 3));
  assert.deepEqual(origin.toArray(), [1_000_000, -2, 3]);

  controller.startHandoff("side", 0.4);
  controller.dispose();
  assert.equal(controller.disposed, true);
  assert.equal(controller.transition, null);
  assert.equal(controller._snapshot, null);

  return {
    yawPitch,
    orbitTarget: mockControls.target.toArray(),
    floatingOrigin: origin.toArray(),
    disposed: controller.disposed,
  };
}

const gates = {
  basis: validateBasis(),
  degenerateUp: validateDegenerateUp(),
  handoffReplay: validateHandoffReplay(),
  stallClamp: validateStallClamp(),
  projectionSnapshot: validateProjectionSnapshot(),
  occupancyAndObstruction: validateOccupancyAndObstruction(),
  controllerSurfaceAndLifecycle: validateControllerSurfaceAndLifecycle(),
};

console.log(JSON.stringify(gates, null, 2));
