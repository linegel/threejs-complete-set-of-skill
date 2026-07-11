import assert from "node:assert/strict";
import { Object3D, PerspectiveCamera, Quaternion, Sphere, Vector2, Vector3, Vector4 } from "three/webgpu";

import {
  CAMERA_MODES,
  CameraDirectionController,
  OrbitIntentAdapter,
  PointerLookIntentAdapter,
  ProjectionJitterOwner,
  computeBodyTangentBasis,
  computeCameraPose,
  computeScreenOccupancy,
  createCameraScratch,
  stepCriticalDampedScalar,
} from "./CameraDirectionController.mjs";
import { CAMERA_ORIGIN_RECORD, CameraRelativeOrigin } from "./CameraRelativeOrigin.mjs";
import { CAMERA_MECHANISMS, assertCameraRouteLock, parseCameraRoute } from "./routeState.mjs";
import { resolveReadbackStride } from "./main.mjs";

const induceViolation = process.argv.includes("--induce-violation");

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

  const forward = new Vector3();
  const right = new Vector3();
  const up = new Vector3();
  computeBodyTangentBasis(
    forward,
    right,
    up,
    new Vector3(0.1, 1, 0.001),
    new Vector3(0, 1, 0),
  );
  assert(Math.abs(forward.length() - 1) < 1e-12);
  assert(Math.abs(right.length() - 1) < 1e-12);
  assert(Math.abs(up.length() - 1) < 1e-12);
  assert(Math.abs(forward.dot(right)) < 1e-12);
  assert(Math.abs(forward.dot(up)) < 1e-12);
  assert(Math.abs(right.dot(up)) < 1e-12);
  assert(new Vector3().crossVectors(forward, up).dot(right) > 0.999999, "body frame is right handed");
  return { ndc: ndc.toArray(), cameraSpaceZ: cameraSpace.z };
}

function validateDegenerateUp() {
  const camera = createCamera();
  const scratch = createCameraScratch();
  computeCameraPose(
    camera.position,
    camera.quaternion,
    new Vector3(0, 0, 0),
    new Vector3(0, 10, 0),
    new Vector3(0, 1, 0),
    scratch,
  );
  const previousRight = scratch.previousRight.clone();
  computeCameraPose(
    camera.position,
    camera.quaternion,
    new Vector3(0.001, 0, 0),
    new Vector3(0, 10, 0),
    new Vector3(0, 1, 0),
    scratch,
  );
  assert(camera.quaternion.toArray().every(Number.isFinite), "degenerate up fallback finite");
  assert(scratch.previousRight.dot(previousRight) > 0, "basis transport avoids a sign flip");
  assert.throws(
    () => computeCameraPose(
      camera.position,
      camera.quaternion,
      new Vector3(1, 2, 3),
      new Vector3(1, 2, 3),
      new Vector3(0, 1, 0),
      createCameraScratch(),
    ),
    /must differ/,
  );
  return { transportedRightDot: scratch.previousRight.dot(previousRight) };
}

function validateBodyRelativeProfile() {
  const subject = new Object3D();
  subject.position.set(7, -3, 11);
  subject.quaternion.setFromAxisAngle(new Vector3(0.3, 0.8, -0.2).normalize(), 1.1);
  subject.updateMatrixWorld(true);
  const camera = createCamera();
  const radius = 2;
  const controller = new CameraDirectionController(camera, {
    subject,
    subjectBounds: new Sphere(new Vector3(), radius),
  });
  const position = new Vector3();
  const quaternion = new Quaternion();
  controller.computeProfilePose(position, quaternion);
  const target = controller.subjectWorldPosition(new Vector3());
  controller.computeBodyBasis();
  const offset = position.clone().sub(target);
  assert(Math.abs(offset.dot(controller.scratch.bodyUp) - radius) < 1e-10, "profile uses configured body-up component");
  assert(Math.abs(offset.dot(controller.scratch.bodyRight) - radius * 3.2) < 1e-10, "profile side uses body tangent");
  assert(Math.abs(offset.dot(controller.scratch.bodyForward) - radius * 1.35) < 1e-10, "profile depth uses body forward");
  return {
    offset: offset.toArray(),
    bodyUpComponent: offset.dot(controller.scratch.bodyUp),
  };
}

function replayHandoff(fps) {
  const camera = createCamera();
  const controller = new CameraDirectionController(camera, {
    subjectBounds: new Sphere(new Vector3(), 2),
  });
  controller.computeProfilePose(camera.position, camera.quaternion);
  controller.startHandoff("inspection", 1.2);
  const frames = Math.ceil(1.2 * fps);
  for (let i = 0; i < frames; i += 1) controller.update(1 / fps);
  return { position: camera.position.clone(), quaternion: camera.quaternion.clone() };
}

function validateHandoffReplayAndAllocationStability() {
  const poses = [30, 60, 120, 144].map((fps) => replayHandoff(fps));
  const baseline = poses[0];
  for (const pose of poses) {
    assert(pose.position.distanceTo(baseline.position) < 1e-9, "handoff endpoint replay equality");
    assert(1 - Math.abs(pose.quaternion.dot(baseline.quaternion)) < 1e-12, "handoff quaternion equality");
  }

  const camera = createCamera();
  const controller = new CameraDirectionController(camera);
  const refs = {
    startPosition: controller.transition.startPosition,
    startQuaternion: controller.transition.startQuaternion,
    desired: controller.scratch.desiredPosition,
    target: controller.scratch.target,
    pose: controller.scratch.pose,
  };
  for (let i = 0; i < 8; i += 1) {
    controller.startHandoff(CAMERA_MODES[i % CAMERA_MODES.length], 0.1);
    controller.update(0.05);
  }
  assert.equal(controller.transition.startPosition, refs.startPosition, "handoff position storage is preallocated");
  assert.equal(controller.transition.startQuaternion, refs.startQuaternion, "handoff quaternion storage is preallocated");
  assert.equal(controller.scratch.desiredPosition, refs.desired, "desired pose scratch is stable");
  assert.equal(controller.scratch.target, refs.target, "target scratch is stable");
  assert.equal(controller.scratch.pose, refs.pose, "pose result record is preallocated");
  return { rates: [30, 60, 120, 144] };
}

function validateThrustLagReplay() {
  const results = [];
  for (const fps of [30, 60, 120, 144]) {
    const state = { value: 0, velocity: 0 };
    const frames = fps * 2;
    for (let frame = 0; frame < frames; frame += 1) stepCriticalDampedScalar(state, 1.75, 8, 1 / fps);
    results.push(state);
  }
  for (const state of results) {
    assert(Math.abs(state.value - results[0].value) < 1e-12, "critical spring position is frame-rate independent");
    assert(Math.abs(state.velocity - results[0].velocity) < 1e-12, "critical spring velocity is frame-rate independent");
  }
  return results;
}

function validateCollisionEntryPersistenceRecovery() {
  const camera = createCamera();
  const controller = new CameraDirectionController(camera, {
    subjectBounds: new Sphere(new Vector3(), 1),
  });
  controller.mode = "overview";
  controller.setObstructionDistance(3);
  controller.update(1 / 60);
  const entryDistance = camera.position.length();
  assert(entryDistance <= 2.75 + 1e-9, "obstruction snaps inward immediately");
  controller.update(1 / 60);
  const secondFrameDistance = camera.position.length();
  assert(secondFrameDistance <= 2.75 + 1e-9, "second obstructed frame remains on the hard safe bound");
  for (let i = 0; i < 19; i += 1) controller.update(1 / 60);
  const persistentDistance = camera.position.length();
  assert(persistentDistance <= 2.75 + 1e-6, "persistent obstruction remains bounded");
  controller.setObstructionDistance(Infinity);
  controller.update(1 / 60);
  const firstRecoveryDistance = camera.position.length();
  assert(firstRecoveryDistance > persistentDistance, "outward recovery starts smoothly");
  assert(firstRecoveryDistance < 5.6, "outward recovery does not snap to desired distance");
  for (let i = 0; i < 120; i += 1) controller.update(1 / 60);
  assert(camera.position.length() > 5.4, "outward recovery converges");
  return { entryDistance, secondFrameDistance, persistentDistance, firstRecoveryDistance };
}

function validateInputLifecycle() {
  class FakeTarget {
    constructor() { this.listeners = new Map(); }
    addEventListener(type, handler) {
      const set = this.listeners.get(type) ?? new Set();
      set.add(handler);
      this.listeners.set(type, set);
    }
    removeEventListener(type, handler) { this.listeners.get(type)?.delete(handler); }
    emit(type, event = {}) { for (const handler of this.listeners.get(type) ?? []) handler(event); }
    count() { return [...this.listeners.values()].reduce((sum, set) => sum + set.size, 0); }
  }
  const target = new FakeTarget();
  const pointer = new PointerLookIntentAdapter(target).connect();
  const orbit = new OrbitIntentAdapter(target).connect();
  pointer.enabled = true;
  orbit.enabled = true;
  target.emit("pointerdown");
  target.emit("pointermove", { movementX: 4, movementY: -3 });
  target.emit("wheel", { deltaY: 10 });
  assert(pointer.yaw !== 0 && pointer.pitch !== 0, "pointer intent captured");
  const intent = orbit.consume({ yaw: 0, pitch: 0, zoomLog: 0 });
  assert(intent.yaw !== 0 && intent.pitch !== 0 && intent.zoomLog !== 0, "orbit intent captured");
  const camera = createCamera();
  const controller = new CameraDirectionController(camera);
  controller.mode = "inspection";
  const initialPosition = camera.position.clone();
  controller.setInspectionIntent(0.75 + pointer.yaw + intent.yaw, 0.25 + pointer.pitch + intent.pitch, intent.zoomLog);
  controller.update(1 / 60);
  assert(camera.position.distanceTo(initialPosition) > 1e-3, "pointer and orbit intent reach the actual camera pose");
  const listenerCount = target.count();
  assert(listenerCount > 0, "listeners installed");
  pointer.dispose();
  orbit.dispose();
  assert.equal(target.count(), 0, "all listeners removed");
  return { listenerCount };
}

function validateFloatingOrigin() {
  const origin = new Vector3(8e9, -4e9, 2e9);
  const object = origin.clone().add(new Vector3(2.5, -1.25, 0.5));
  const state = new CameraRelativeOrigin().setInitial(origin, object);
  assert(state.currentRelative.distanceTo(new Vector3(2.5, -1.25, 0.5)) < 1e-12, "CPU double relative position");
  assert(state.velocityRelative.lengthSq() === 0, "static origin velocity is zero");
  assert.equal(state.array.byteLength, 128, "eight vec4 high/low records are inventoried");
  const packedAxis = (highRecord, lowRecord, axis) => ({
    high: state.array[highRecord * 4 + axis],
    low: state.array[lowRecord * 4 + axis],
  });
  const packedObjectX = packedAxis(CAMERA_ORIGIN_RECORD.currentObjectHigh, CAMERA_ORIGIN_RECORD.currentObjectLow, 0);
  const packedOriginX = packedAxis(CAMERA_ORIGIN_RECORD.currentOriginHigh, CAMERA_ORIGIN_RECORD.currentOriginLow, 0);
  const compensatedX = Math.fround(
    Math.fround(packedObjectX.high - packedOriginX.high)
      + Math.fround(packedObjectX.low - packedOriginX.low),
  );
  const recomposedX = Math.fround(
    Math.fround(packedObjectX.high + packedObjectX.low)
      - Math.fround(packedOriginX.high + packedOriginX.low),
  );
  assert(Math.abs(compensatedX - 2.5) < 1e-6, "subtract-high/subtract-low preserves the local offset in f32");
  assert(Math.abs(recomposedX - 2.5) > 1, "recomposing high+low first is a detected precision mutant");
  const nodes = state.createTslContract();
  assert(nodes.positionOffset?.isNode, "visible position consumes storage");
  assert(nodes.previousPositionOffset?.isNode, "previous position consumes storage");
  assert(nodes.velocityNdc?.isNode, "velocity consumes the same storage");
  assert.notEqual(nodes.currentView, nodes.previousView, "velocity graph has distinct current and previous view uniforms");
  assert.notEqual(nodes.currentProjection, nodes.previousProjection, "velocity graph has distinct current and previous projection uniforms");
  assert.notEqual(nodes.currentModel, nodes.previousModel, "velocity graph has distinct current and previous model uniforms");

  const camera = createCamera();
  const object3D = new Object3D();
  object3D.quaternion.setFromAxisAngle(new Vector3(0.3, 0.8, -0.2).normalize(), 0.7);
  object3D.updateMatrixWorld(true);
  camera.updateMatrixWorld(true);
  state.setInitialMatrices(camera, object3D);
  state.beginFrame();
  camera.position.x += 1;
  camera.updateMatrixWorld(true);
  state.setCurrentMatrices(camera, object3D);
  assert(!state.currentView.equals(state.previousView), "camera motion advances the previous/current view pair");
  const localOffset = new Vector4(state.currentRelative.x, state.currentRelative.y, state.currentRelative.z, 0)
    .applyMatrix4(state.currentModelInverse);
  const reconstructedWorldOffset = localOffset.clone().applyMatrix4(state.currentModel);
  assert(
    new Vector3(reconstructedWorldOffset.x, reconstructedWorldOffset.y, reconstructedWorldOffset.z)
      .distanceTo(state.currentRelative) < 1e-10,
    "inverse-linear local offset keeps rotated shader geometry in the CPU camera-relative frame",
  );
  const currentClip = new Vector4(state.currentRelative.x, state.currentRelative.y, state.currentRelative.z, 1)
    .applyMatrix4(state.currentModel).applyMatrix4(state.currentView).applyMatrix4(state.currentProjection);
  const previousClip = new Vector4(state.previousRelative.x, state.previousRelative.y, state.previousRelative.z, 1)
    .applyMatrix4(state.previousModel).applyMatrix4(state.previousView).applyMatrix4(state.previousProjection);
  const velocityX = currentClip.x / currentClip.w - previousClip.x / previousClip.w;
  assert(velocityX < 0, "rightward camera motion produces the expected negative NDC velocity");

  state.beginFrame();
  state.currentObject.x += 0.75;
  state.commit();
  assert(state.velocityRelative.x > 0, "moving velocity has expected sign");

  const beforeRelative = state.currentRelative.clone();
  state.beginFrame();
  state.currentObject.x += 1024;
  const rebasedOrigin = state.currentOrigin.clone();
  rebasedOrigin.x += 1024;
  state.rebase(rebasedOrigin).commit();
  assert(state.currentRelative.distanceTo(beforeRelative) < 1e-12, "rebase preserves visible relative position");
  assert(state.velocityRelative.lengthSq() < 1e-24, "matched current/previous rebase produces zero false velocity");
  const rigSubject = new Object3D();
  rigSubject.position.copy(state.currentRelative);
  rigSubject.updateMatrixWorld(true);
  const frameController = new CameraDirectionController(createCamera(), { subject: rigSubject });
  assert(
    frameController.subjectWorldPosition(new Vector3()).distanceTo(state.currentRelative) < 1e-12,
    "camera target and shader storage offset share the same camera-relative frame",
  );
  const description = state.describe();
  state.dispose();
  return description;
}

function validateProjectionSnapshotAndFraming() {
  const camera = createCamera();
  const controller = new CameraDirectionController(camera);
  camera.fov = 41;
  camera.near = 0.7;
  camera.far = 777;
  camera.aspect = 1.7;
  camera.zoom = 1.2;
  camera.filmGauge = 36;
  camera.filmOffset = 2;
  camera.focus = 14;
  camera.up.set(0.1, 0.98, 0).normalize();
  camera.layers.set(2);
  camera.setViewOffset(1920, 1080, 12, 24, 1280, 720);
  const snapshot = controller.snapshot();
  camera.clearViewOffset();
  camera.fov = 60;
  controller.restore(snapshot);
  assert.equal(camera.fov, 41);
  assert.equal(camera.focus, 14);
  assert.deepEqual(camera.view, snapshot.view);

  camera.clearViewOffset();
  const disabledSnapshot = controller.snapshot();
  camera.setViewOffset(10, 10, 1, 1, 5, 5);
  controller.restore(disabledSnapshot);
  assert.deepEqual(camera.view, disabledSnapshot.view, "disabled view record restores exactly");
  camera.view = null;
  camera.updateProjectionMatrix();
  const nullSnapshot = controller.snapshot();
  camera.setViewOffset(10, 10, 0, 0, 10, 10);
  controller.restore(nullSnapshot);
  assert.equal(camera.view, null, "null view state restores exactly");

  const parentA = new Object3D();
  const parentB = new Object3D();
  parentA.position.set(3, -2, 7);
  parentA.quaternion.setFromAxisAngle(new Vector3(0, 1, 0), 0.4);
  parentA.add(camera);
  camera.position.set(1, 2, 3);
  camera.quaternion.setFromAxisAngle(new Vector3(1, 0, 0), 0.2);
  camera.scale.set(1.1, 0.9, 1.2);
  camera.updateMatrixWorld(true);
  const parentedSnapshot = controller.snapshot();
  parentB.add(camera);
  camera.position.set(9, 8, 7);
  camera.scale.setScalar(2);
  controller.restore(parentedSnapshot);
  assert.equal(camera.parent, parentA, "restore reinstates the captured camera parent");
  assert(camera.position.distanceTo(parentedSnapshot.position) < 1e-12, "parented local position restores exactly");
  assert(1 - Math.abs(camera.quaternion.dot(parentedSnapshot.quaternion)) < 1e-12, "parented local quaternion restores exactly");
  assert(camera.scale.distanceTo(parentedSnapshot.scale) < 1e-12, "parented local scale restores exactly");

  camera.filmOffset = 3;
  camera.updateProjectionMatrix();
  const occupancyOut = { vertical: 0, horizontal: 0, minView: new Vector2(), maxView: new Vector2() };
  const result = computeScreenOccupancy(camera, 10, 1, controller.scratch, occupancyOut);
  assert.equal(result, occupancyOut, "caller-owned occupancy record avoids steady allocation");
  assert(result.vertical > 0 && result.horizontal > 0);
  assert(Math.abs(result.minView.x + result.maxView.x) > 1e-6, "view bounds retain principal-point translation");
  return { fov: camera.fov, view: snapshot.view, occupancy: result };
}

function validateJitterOwnership() {
  const camera = createCamera();
  const jitter = new ProjectionJitterOwner();
  camera.view = null;
  const nullAspect = camera.aspect;
  jitter.begin(camera, 1200, 800);
  assert(camera.view?.enabled, "jitter owns an active transient view offset");
  jitter.end(camera);
  assert.equal(camera.view, null, "null view state restores after jitter");
  assert.equal(camera.aspect, nullAspect);

  camera.setViewOffset(1920, 1080, 12, 24, 1280, 720);
  const enabled = { ...camera.view };
  const enabledAspect = camera.aspect;
  jitter.begin(camera, 1200, 800);
  jitter.end(camera);
  assert.deepEqual(camera.view, enabled, "enabled authored view restores exactly");
  assert.equal(camera.aspect, enabledAspect);

  camera.clearViewOffset();
  const disabled = { ...camera.view };
  jitter.begin(camera, 641, 359);
  jitter.end(camera);
  assert.deepEqual(camera.view, disabled, "disabled view record restores exactly");
  assert.equal(jitter.index, 3, "one jitter owner advances exactly once per render");
  return { samples: jitter.index };
}

function validateRoutesAndStride() {
  for (const mechanism of CAMERA_MECHANISMS) {
    const route = parseCameraRoute({ pathname: `/demos/camera/mechanism/${mechanism}/`, search: "?tier=budgeted&mode=profile" });
    assert.deepEqual(route, { mechanism, tier: "budgeted", mode: "profile" });
  }
  for (const tier of ["full", "budgeted", "minimum"]) {
    const route = parseCameraRoute({ pathname: `/demos/camera/tier/${tier}/`, search: "" });
    assert.equal(route.tier, tier);
  }
  assert.throws(() => parseCameraRoute({ pathname: "/mechanism/fabricated/", search: "" }), /unknown camera mechanism/);
  assert.throws(() => parseCameraRoute({ pathname: "/tier/fabricated/", search: "" }), /unknown camera tier/);
  const locked = parseCameraRoute({ pathname: "/mechanism/floating-origin/", search: "?tier=full" });
  assert.equal(assertCameraRouteLock(locked), locked);
  assert.throws(() => assertCameraRouteLock(locked, { mechanism: "scale-aware-framing" }), /locked to floating-origin/);
  assert.throws(() => assertCameraRouteLock(locked, { tier: "budgeted" }), /locked to full/);
  if (induceViolation) assertCameraRouteLock(locked, { mechanism: "scale-aware-framing" });
  const tightlyPacked = new Uint8Array(13 * 7 * 4);
  assert.equal(resolveReadbackStride(tightlyPacked, 13, 7), 52);
  const rowBytes = 641 * 4;
  const aligned = Math.ceil(rowBytes / 256) * 256;
  const padded = new Uint8Array(aligned * (359 - 1) + rowBytes);
  assert.equal(resolveReadbackStride(padded, 641, 359), aligned, "odd WebGPU readback uses integer 256-byte alignment");
  return { mechanisms: CAMERA_MECHANISMS.length, alignedStride: aligned };
}

const gates = {
  claimBoundary: {
    cpuContractExecuted: true,
    nativeWebGpuCodePathPresent: true,
    browserWebGpuExecutedThisRun: false,
    gpuTiming: "INSUFFICIENT_EVIDENCE",
  },
  basis: validateBasis(),
  degenerateUp: validateDegenerateUp(),
  bodyRelativeProfile: validateBodyRelativeProfile(),
  handoffReplayAndAllocationStability: validateHandoffReplayAndAllocationStability(),
  thrustLagReplay: validateThrustLagReplay(),
  collision: validateCollisionEntryPersistenceRecovery(),
  inputLifecycle: validateInputLifecycle(),
  floatingOrigin: validateFloatingOrigin(),
  projectionSnapshotAndFraming: validateProjectionSnapshotAndFraming(),
  jitterOwnership: validateJitterOwnership(),
  routesAndStride: validateRoutesAndStride(),
};

console.log(JSON.stringify(gates, null, 2));
