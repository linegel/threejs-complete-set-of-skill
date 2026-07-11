import {
  Box3,
  Matrix4,
  Quaternion,
  Sphere,
  Vector2,
  Vector3,
} from "three/webgpu";

const HALF_PI = Math.PI * 0.5;

export const FIXTURE_BASIS_GATES = Object.freeze({
  aimLengthSq: 1e-12,
  rightLengthSq: 1e-12,
  upLengthSq: 1e-12,
  entryParallel: 0.985,
  exitParallel: 0.975,
});

export const CAMERA_MODES = Object.freeze([
  "overview",
  "profile",
  "inspection",
]);

export const CAMERA_TIERS = Object.freeze({
  full: Object.freeze({
    collision: true,
    thrustLag: true,
    floatingOrigin: true,
    dprCap: 2,
  }),
  budgeted: Object.freeze({
    collision: true,
    thrustLag: true,
    floatingOrigin: true,
    dprCap: 1.5,
  }),
  minimum: Object.freeze({
    collision: false,
    thrustLag: false,
    floatingOrigin: true,
    dprCap: 1,
  }),
});

export function createCameraScratch() {
  const scratch = {
    forward: new Vector3(),
    right: new Vector3(),
    up: new Vector3(),
    back: new Vector3(),
    upHint: new Vector3(),
    matrix: new Matrix4(),
    viewSize: new Vector2(),
    minView: new Vector2(),
    maxView: new Vector2(),
    startPosition: new Vector3(),
    targetPosition: new Vector3(),
    startQuaternion: new Quaternion(),
    targetQuaternion: new Quaternion(),
    desiredPosition: new Vector3(),
    desiredOffset: new Vector3(),
    target: new Vector3(),
    worldUp: new Vector3(0, 1, 0),
    previousRight: new Vector3(),
    bodyForward: new Vector3(),
    bodyRight: new Vector3(),
    bodyUp: new Vector3(),
    bodyQuaternion: new Quaternion(),
    obstructionDirection: new Vector3(),
    fallbackActive: false,
    boundsSphere: new Sphere(),
    pose: { position: null, quaternion: null },
  };
  return scratch;
}

export function chooseStableUpFallback(out, forward) {
  const ax = Math.abs(forward.x);
  const ay = Math.abs(forward.y);
  const az = Math.abs(forward.z);
  if (ax <= ay && ax <= az) out.set(1, 0, 0);
  else if (ay <= az) out.set(0, 1, 0);
  else out.set(0, 0, 1);
  out.addScaledVector(forward, -out.dot(forward)).normalize();
  return out;
}

/**
 * Builds a right-handed body frame without assuming world Y is body up.
 * The returned vectors are written into caller-owned storage.
 */
export function computeBodyTangentBasis(
  outForward,
  outRight,
  outUp,
  forwardHint,
  upHint,
  gates = FIXTURE_BASIS_GATES,
) {
  outUp.copy(upHint);
  if (outUp.lengthSq() <= gates.upLengthSq) outUp.set(0, 1, 0);
  outUp.normalize();

  outForward.copy(forwardHint).addScaledVector(outUp, -forwardHint.dot(outUp));
  if (outForward.lengthSq() <= gates.rightLengthSq) {
    chooseStableUpFallback(outForward, outUp);
  } else {
    outForward.normalize();
  }

  // forward x up is +right for a conventional body whose forward is -Z.
  outRight.crossVectors(outForward, outUp).normalize();
  outForward.crossVectors(outUp, outRight).normalize();
  return outForward;
}

export function computeCameraPose(
  outPosition,
  outQuaternion,
  target,
  desiredPosition,
  upHint,
  scratch = createCameraScratch(),
  gates = FIXTURE_BASIS_GATES,
) {
  outPosition.copy(desiredPosition);
  scratch.forward.subVectors(target, desiredPosition);
  if (scratch.forward.lengthSq() <= gates.aimLengthSq) {
    throw new Error("camera target and desired position must differ");
  }
  scratch.forward.normalize();

  scratch.right.copy(scratch.previousRight).addScaledVector(
    scratch.forward,
    -scratch.previousRight.dot(scratch.forward),
  );
  const reusedRight = scratch.right.lengthSq() > gates.rightLengthSq;
  if (reusedRight) {
    scratch.right.normalize();
  } else {
    scratch.upHint.copy(upHint);
    if (scratch.upHint.lengthSq() <= gates.upLengthSq) {
      chooseStableUpFallback(scratch.upHint, scratch.forward);
    } else {
      scratch.upHint.normalize();
    }
    const parallel = Math.abs(scratch.forward.dot(scratch.upHint));
    const useFallback = scratch.fallbackActive
      ? parallel > gates.exitParallel
      : parallel > gates.entryParallel;
    if (useFallback) chooseStableUpFallback(scratch.upHint, scratch.forward);
    scratch.fallbackActive = useFallback;
    scratch.right.crossVectors(scratch.forward, scratch.upHint).normalize();
  }

  scratch.up.crossVectors(scratch.right, scratch.forward).normalize();
  scratch.back.copy(scratch.forward).multiplyScalar(-1);
  scratch.matrix.makeBasis(scratch.right, scratch.up, scratch.back);
  outQuaternion.setFromRotationMatrix(scratch.matrix).normalize();
  scratch.previousRight.copy(scratch.right);
  scratch.pose.position = outPosition;
  scratch.pose.quaternion = outQuaternion;
  return scratch.pose;
}

export function computeScreenOccupancy(
  camera,
  distance,
  subjectRadius,
  scratch = createCameraScratch(),
  out = null,
) {
  camera.getViewSize(distance, scratch.viewSize);
  camera.getViewBounds(distance, scratch.minView, scratch.maxView);
  const result = out ?? {
    vertical: 0,
    horizontal: 0,
    minView: new Vector2(),
    maxView: new Vector2(),
  };
  result.vertical = (subjectRadius * 2) / scratch.viewSize.y;
  result.horizontal = (subjectRadius * 2) / scratch.viewSize.x;
  result.minView.copy(scratch.minView);
  result.maxView.copy(scratch.maxView);
  return result;
}

export function expDecayAlpha(lambda, dt) {
  return 1 - Math.exp(-lambda * dt);
}

/** Exact critically damped response for a target that is constant over dt. */
export function stepCriticalDampedScalar(state, target, angularFrequency, dt) {
  if (!Number.isFinite(dt) || dt < 0) throw new RangeError("dt must be finite and >= 0");
  if (!(angularFrequency > 0)) throw new RangeError("angularFrequency must be > 0");
  const y = state.value - target;
  const j = state.velocity + angularFrequency * y;
  const decay = Math.exp(-angularFrequency * dt);
  state.value = target + (y + j * dt) * decay;
  state.velocity = (state.velocity - angularFrequency * j * dt) * decay;
  return state;
}

export class PointerLookIntentAdapter {
  constructor(eventTarget, { sensitivity = 0.002 } = {}) {
    this.eventTarget = eventTarget;
    this.sensitivity = sensitivity;
    this.enabled = false;
    this.connected = false;
    this.yaw = 0;
    this.pitch = 0;
    this.held = false;
    this._onPointerMove = (event) => {
      if (!this.enabled || !this.held) return;
      this.yaw -= (event.movementX ?? 0) * this.sensitivity;
      this.pitch = Math.max(-HALF_PI, Math.min(HALF_PI, this.pitch - (event.movementY ?? 0) * this.sensitivity));
    };
    this._onPointerDown = () => { this.held = true; };
    this._onPointerUp = () => { this.held = false; };
    this._onBlur = () => { this.held = false; };
  }

  connect() {
    if (this.connected || !this.eventTarget?.addEventListener) return this;
    this.eventTarget.addEventListener("pointermove", this._onPointerMove);
    this.eventTarget.addEventListener("pointerdown", this._onPointerDown);
    this.eventTarget.addEventListener("pointerup", this._onPointerUp);
    this.eventTarget.addEventListener("blur", this._onBlur);
    this.connected = true;
    return this;
  }

  reacquire(camera, scratch = createCameraScratch()) {
    camera.getWorldDirection(scratch.forward);
    this.yaw = Math.atan2(-scratch.forward.x, -scratch.forward.z);
    this.pitch = Math.asin(Math.max(-1, Math.min(1, scratch.forward.y)));
    return this;
  }

  dispose() {
    if (this.connected && this.eventTarget?.removeEventListener) {
      this.eventTarget.removeEventListener("pointermove", this._onPointerMove);
      this.eventTarget.removeEventListener("pointerdown", this._onPointerDown);
      this.eventTarget.removeEventListener("pointerup", this._onPointerUp);
      this.eventTarget.removeEventListener("blur", this._onBlur);
    }
    this.connected = false;
    this.enabled = false;
    this.held = false;
  }
}

export class OrbitIntentAdapter {
  constructor(eventTarget, { angularScale = 0.004, zoomScale = 0.001 } = {}) {
    this.eventTarget = eventTarget;
    this.angularScale = angularScale;
    this.zoomScale = zoomScale;
    this.connected = false;
    this.enabled = false;
    this.dragging = false;
    this.yawDelta = 0;
    this.pitchDelta = 0;
    this.zoomLogDelta = 0;
    this._onPointerDown = () => { if (this.enabled) this.dragging = true; };
    this._onPointerMove = (event) => {
      if (!this.enabled || !this.dragging) return;
      this.yawDelta -= (event.movementX ?? 0) * this.angularScale;
      this.pitchDelta -= (event.movementY ?? 0) * this.angularScale;
    };
    this._onPointerUp = () => { this.dragging = false; };
    this._onWheel = (event) => {
      if (this.enabled) this.zoomLogDelta += (event.deltaY ?? 0) * this.zoomScale;
    };
    this._onBlur = () => { this.dragging = false; };
  }

  connect() {
    if (this.connected || !this.eventTarget?.addEventListener) return this;
    for (const [type, handler] of [
      ["pointerdown", this._onPointerDown],
      ["pointermove", this._onPointerMove],
      ["pointerup", this._onPointerUp],
      ["wheel", this._onWheel],
      ["blur", this._onBlur],
    ]) this.eventTarget.addEventListener(type, handler);
    this.connected = true;
    return this;
  }

  consume(out = { yaw: 0, pitch: 0, zoomLog: 0 }) {
    out.yaw = this.yawDelta;
    out.pitch = this.pitchDelta;
    out.zoomLog = this.zoomLogDelta;
    this.yawDelta = 0;
    this.pitchDelta = 0;
    this.zoomLogDelta = 0;
    return out;
  }

  dispose() {
    if (this.connected && this.eventTarget?.removeEventListener) {
      for (const [type, handler] of [
        ["pointerdown", this._onPointerDown],
        ["pointermove", this._onPointerMove],
        ["pointerup", this._onPointerUp],
        ["wheel", this._onWheel],
        ["blur", this._onBlur],
      ]) this.eventTarget.removeEventListener(type, handler);
    }
    this.connected = false;
    this.enabled = false;
    this.dragging = false;
    this.yawDelta = 0;
    this.pitchDelta = 0;
    this.zoomLogDelta = 0;
  }
}

function halton(index, base) {
  let result = 0;
  let fraction = 1 / base;
  let value = index;
  while (value > 0) {
    result += fraction * (value % base);
    value = Math.floor(value / base);
    fraction /= base;
  }
  return result;
}

/** One transient projection writer with exact null/disabled/enabled restoration. */
export class ProjectionJitterOwner {
  constructor() {
    this.index = 0;
    this.active = false;
    this.savedAspect = 1;
    this.savedViewWasNull = true;
    this._viewA = { enabled: false, fullWidth: 1, fullHeight: 1, offsetX: 0, offsetY: 0, width: 1, height: 1 };
    this._viewB = { enabled: false, fullWidth: 1, fullHeight: 1, offsetX: 0, offsetY: 0, width: 1, height: 1 };
    this._savedView = this._viewA;
    this._restoreView = this._viewB;
  }

  begin(camera, width, height) {
    if (this.active) throw new Error("projection jitter already active");
    if (!(width > 0 && height > 0)) throw new RangeError("jitter dimensions must be > 0");
    this.savedAspect = camera.aspect;
    this.savedViewWasNull = camera.view === null;
    if (camera.view) Object.assign(this._savedView, camera.view);
    const sample = (this.index % 8) + 1;
    const jitterX = halton(sample, 2) - 0.5;
    const jitterY = halton(sample, 3) - 0.5;
    camera.setViewOffset(width, height, jitterX, jitterY, width, height);
    this.active = true;
    return this;
  }

  end(camera) {
    if (!this.active) return;
    if (this.savedViewWasNull) {
      camera.view = null;
    } else {
      Object.assign(this._restoreView, this._savedView);
      camera.view = this._restoreView;
    }
    camera.aspect = this.savedAspect;
    camera.updateProjectionMatrix();
    this.index = (this.index + 1) % 8;
    this.active = false;
  }

  reset() {
    this.index = 0;
    this.active = false;
  }
}

export class CameraDirectionController {
  constructor(camera, {
    subject = null,
    subjectBounds = new Sphere(new Vector3(), 1),
    bodyForwardLocal = new Vector3(0, 0, -1),
    bodyUpLocal = new Vector3(0, 1, 0),
    tier = "full",
  } = {}) {
    if (!CAMERA_TIERS[tier]) throw new RangeError(`unknown camera tier: ${tier}`);
    this.camera = camera;
    this.subject = subject;
    this.subjectBounds = subjectBounds;
    this.bodyForwardLocal = bodyForwardLocal.clone().normalize();
    this.bodyUpLocal = bodyUpLocal.clone().normalize();
    this.scratch = createCameraScratch();
    this.mode = "overview";
    this.tier = tier;
    this.transition = {
      active: false,
      mode: "overview",
      duration: 1,
      elapsed: 0,
      startPosition: new Vector3(),
      startQuaternion: new Quaternion(),
    };
    this.thrust = 0;
    this.thrustLag = { value: 0, velocity: 0 };
    this.obstruction = {
      hitDistance: Infinity,
      currentDistance: Infinity,
      recoveryLambda: 9,
      clearance: 0.25,
      wasObstructed: false,
      inwardSnapThisFrame: false,
    };
    this.inspection = {
      yaw: 0.75,
      pitch: 0.25,
      distanceScale: 1,
    };
    this._frameDt = 0;
    this.disposed = false;
    this._snapshot = null;
  }

  setTier(tier) {
    if (!CAMERA_TIERS[tier]) throw new RangeError(`unknown camera tier: ${tier}`);
    this.tier = tier;
  }

  setThrust(normalizedThrust) {
    if (!Number.isFinite(normalizedThrust)) throw new RangeError("thrust must be finite");
    this.thrust = Math.max(0, Math.min(1, normalizedThrust));
  }

  setInspectionIntent(yaw, pitch, zoomLogDelta = 0) {
    if (![yaw, pitch, zoomLogDelta].every(Number.isFinite)) throw new RangeError("inspection intent must be finite");
    this.inspection.yaw = yaw;
    this.inspection.pitch = Math.max(-HALF_PI + 1e-3, Math.min(HALF_PI - 1e-3, pitch));
    this.inspection.distanceScale = Math.max(0.25, Math.min(4, this.inspection.distanceScale * Math.exp(zoomLogDelta)));
    return this;
  }

  setObstructionDistance(hitDistance = Infinity) {
    if (!(Number.isFinite(hitDistance) || hitDistance === Infinity) || hitDistance < 0) {
      throw new RangeError("hitDistance must be nonnegative or Infinity");
    }
    this.obstruction.hitDistance = hitDistance;
  }

  subjectWorldPosition(out = this.scratch.target) {
    if (this.subject) {
      this.subject.updateWorldMatrix(true, false);
      return this.subject.getWorldPosition(out);
    }
    return out.set(0, 0, 0);
  }

  subjectRadius() {
    if (this.subjectBounds instanceof Sphere) return this.subjectBounds.radius;
    if (this.subjectBounds instanceof Box3) {
      this.subjectBounds.getBoundingSphere(this.scratch.boundsSphere);
      return this.scratch.boundsSphere.radius;
    }
    return 1;
  }

  computeBodyBasis() {
    if (this.subject) this.subject.getWorldQuaternion(this.scratch.bodyQuaternion);
    else this.scratch.bodyQuaternion.identity();
    this.scratch.bodyForward.copy(this.bodyForwardLocal).applyQuaternion(this.scratch.bodyQuaternion);
    this.scratch.bodyUp.copy(this.bodyUpLocal).applyQuaternion(this.scratch.bodyQuaternion);
    computeBodyTangentBasis(
      this.scratch.bodyForward,
      this.scratch.bodyRight,
      this.scratch.bodyUp,
      this.scratch.bodyForward,
      this.scratch.bodyUp,
    );
    return this.scratch;
  }

  updateThrustLag(dt) {
    const tier = CAMERA_TIERS[this.tier];
    const target = tier.thrustLag ? this.thrust * this.subjectRadius() * 0.85 : 0;
    stepCriticalDampedScalar(this.thrustLag, target, 8, dt);
  }

  resolveObstruction(target, desiredPosition) {
    const tier = CAMERA_TIERS[this.tier];
    if (!tier.collision) return desiredPosition;
    const direction = this.scratch.obstructionDirection.subVectors(desiredPosition, target);
    const desiredDistance = direction.length();
    if (desiredDistance <= FIXTURE_BASIS_GATES.aimLengthSq) return desiredPosition;
    direction.multiplyScalar(1 / desiredDistance);
    const hit = this.obstruction.hitDistance;
    const finiteHit = Number.isFinite(hit);
    const allowedDistance = finiteHit
      ? Math.max(this.obstruction.clearance, Math.min(desiredDistance, hit - this.obstruction.clearance))
      : desiredDistance;
    if (!finiteHit && !this.obstruction.wasObstructed) {
      this.obstruction.currentDistance = desiredDistance;
    } else if (!Number.isFinite(this.obstruction.currentDistance) || allowedDistance < this.obstruction.currentDistance) {
      this.obstruction.currentDistance = allowedDistance;
    } else {
      this.obstruction.currentDistance +=
        (allowedDistance - this.obstruction.currentDistance) *
        expDecayAlpha(this.obstruction.recoveryLambda, this._frameDt);
    }
    if (finiteHit && allowedDistance < desiredDistance) {
      // A persistent occluder is a hard inequality, not a one-frame event.
      // Snap to the newly computed safe pose on entry and every obstructed
      // frame; only the outward, unoccluded branch is smoothed.
      this.obstruction.inwardSnapThisFrame = true;
      this.obstruction.wasObstructed = true;
    }
    if (!finiteHit && Math.abs(this.obstruction.currentDistance - desiredDistance) <= 1e-6) {
      this.obstruction.currentDistance = desiredDistance;
      this.obstruction.wasObstructed = false;
    }
    return desiredPosition.copy(target).addScaledVector(direction, this.obstruction.currentDistance);
  }

  computeOverviewPose(outPosition, outQuaternion) {
    const target = this.subjectWorldPosition(this.scratch.target);
    const radius = this.subjectRadius();
    const { bodyForward: forward, bodyUp: up } = this.computeBodyBasis();
    const desired = this.scratch.desiredPosition.copy(target)
      .addScaledVector(forward, -radius * 5.5 - this.thrustLag.value)
      .addScaledVector(up, radius * 0.6);
    this.resolveObstruction(target, desired);
    return computeCameraPose(outPosition, outQuaternion, target, desired, up, this.scratch);
  }

  computeProfilePose(outPosition, outQuaternion) {
    const target = this.subjectWorldPosition(this.scratch.target);
    const radius = this.subjectRadius();
    const { bodyForward: forward, bodyRight: right, bodyUp: up } = this.computeBodyBasis();
    const desired = this.scratch.desiredPosition.copy(target)
      .addScaledVector(right, radius * 3.2)
      .addScaledVector(up, radius)
      .addScaledVector(forward, radius * 1.35);
    this.resolveObstruction(target, desired);
    return computeCameraPose(outPosition, outQuaternion, target, desired, up, this.scratch);
  }

  computeInspectionPose(
    outPosition,
    outQuaternion,
    yaw = this.inspection.yaw,
    pitch = this.inspection.pitch,
  ) {
    const target = this.subjectWorldPosition(this.scratch.target);
    const radius = this.subjectRadius();
    const orbitRadius = radius * 5.2 * this.inspection.distanceScale;
    const { bodyForward: forward, bodyRight: right, bodyUp: up } = this.computeBodyBasis();
    const planarScale = Math.cos(pitch) * orbitRadius;
    const desired = this.scratch.desiredPosition.copy(target)
      .addScaledVector(right, Math.cos(yaw) * planarScale)
      .addScaledVector(forward, Math.sin(yaw) * planarScale)
      .addScaledVector(up, Math.sin(pitch) * orbitRadius);
    this.resolveObstruction(target, desired);
    return computeCameraPose(outPosition, outQuaternion, target, desired, up, this.scratch);
  }

  // Cinematic aliases retained because the skill routes these same mechanisms.
  computeChasePose(outPosition, outQuaternion) {
    return this.computeOverviewPose(outPosition, outQuaternion);
  }

  computeSidePose(outPosition, outQuaternion) {
    return this.computeProfilePose(outPosition, outQuaternion);
  }

  computeOrbitPose(outPosition, outQuaternion, yaw, pitch) {
    return this.computeInspectionPose(outPosition, outQuaternion, yaw, pitch);
  }

  updateModePose(mode, outPosition, outQuaternion) {
    if (!CAMERA_MODES.includes(mode)) throw new RangeError(`unknown camera mode: ${mode}`);
    if (mode === "profile") return this.computeProfilePose(outPosition, outQuaternion);
    if (mode === "inspection") return this.computeInspectionPose(outPosition, outQuaternion);
    return this.computeOverviewPose(outPosition, outQuaternion);
  }

  startHandoff(mode, duration = 1.2) {
    if (!CAMERA_MODES.includes(mode)) throw new RangeError(`unknown camera mode: ${mode}`);
    if (!Number.isFinite(duration) || duration <= 0) {
      throw new RangeError("handoff duration must be finite and > 0");
    }
    this.transition.active = true;
    this.transition.mode = mode;
    this.transition.duration = duration;
    this.transition.elapsed = 0;
    this.transition.startPosition.copy(this.camera.position);
    this.transition.startQuaternion.copy(this.camera.quaternion);
  }

  update(dt) {
    if (!Number.isFinite(dt) || dt < 0) throw new RangeError("dt must be finite and >= 0");
    const clampedDt = Math.min(dt, 1 / 20);
    this._frameDt = clampedDt;
    this.obstruction.inwardSnapThisFrame = false;
    this.updateThrustLag(clampedDt);
    if (this.transition.active) {
      const pose = this.updateModePose(
        this.transition.mode,
        this.scratch.targetPosition,
        this.scratch.targetQuaternion,
      );
      const remaining = this.transition.duration - this.transition.elapsed;
      this.transition.elapsed = clampedDt >= remaining - 1e-12
        ? this.transition.duration
        : this.transition.elapsed + clampedDt;
      const t = this.transition.elapsed / this.transition.duration;
      const eased = 1 - Math.pow(1 - t, 1.8);
      this.camera.position.lerpVectors(this.transition.startPosition, pose.position, eased);
      this.camera.quaternion.copy(this.transition.startQuaternion).slerp(pose.quaternion, eased).normalize();
      if (this.obstruction.inwardSnapThisFrame) {
        this.camera.position.copy(pose.position);
        this.camera.quaternion.copy(pose.quaternion);
      }
      if (t >= 1) {
        this.camera.position.copy(pose.position);
        this.camera.quaternion.copy(pose.quaternion);
        this.mode = this.transition.mode;
        this.transition.active = false;
      }
      return "handoff";
    }

    const pose = this.updateModePose(this.mode, this.scratch.targetPosition, this.scratch.targetQuaternion);
    const alpha = expDecayAlpha(this.mode === "overview" ? 18 : 9.5, clampedDt);
    if (this.obstruction.inwardSnapThisFrame) {
      this.camera.position.copy(pose.position);
      this.camera.quaternion.copy(pose.quaternion);
    } else {
      this.camera.position.lerp(pose.position, alpha);
      this.camera.quaternion.slerp(pose.quaternion, alpha).normalize();
    }
    return this.mode;
  }

  snapshot() {
    this._snapshot = {
      position: this.camera.position.clone(),
      quaternion: this.camera.quaternion.clone(),
      up: this.camera.up.clone(),
      parent: this.camera.parent,
      matrixAutoUpdate: this.camera.matrixAutoUpdate,
      matrixWorldAutoUpdate: this.camera.matrixWorldAutoUpdate,
      fov: this.camera.fov,
      near: this.camera.near,
      far: this.camera.far,
      aspect: this.camera.aspect,
      zoom: this.camera.zoom,
      filmGauge: this.camera.filmGauge,
      filmOffset: this.camera.filmOffset,
      focus: this.camera.focus,
      view: this.camera.view ? { ...this.camera.view } : null,
      layers: this.camera.layers.mask,
      tier: this.tier,
      scale: this.camera.scale.clone(),
      matrix: this.camera.matrix.clone(),
    };
    return this._snapshot;
  }

  restore(snapshot = this._snapshot) {
    if (!snapshot) return;
    if (this.camera.parent !== snapshot.parent) {
      if (snapshot.parent) snapshot.parent.add(this.camera);
      else this.camera.removeFromParent();
    }
    this.camera.position.copy(snapshot.position);
    this.camera.quaternion.copy(snapshot.quaternion);
    this.camera.scale.copy(snapshot.scale);
    this.camera.up.copy(snapshot.up);
    this.camera.matrixAutoUpdate = snapshot.matrixAutoUpdate;
    this.camera.matrixWorldAutoUpdate = snapshot.matrixWorldAutoUpdate;
    this.camera.fov = snapshot.fov;
    this.camera.near = snapshot.near;
    this.camera.far = snapshot.far;
    this.camera.aspect = snapshot.aspect;
    this.camera.zoom = snapshot.zoom;
    this.camera.filmGauge = snapshot.filmGauge;
    this.camera.filmOffset = snapshot.filmOffset;
    this.camera.focus = snapshot.focus;
    this.camera.view = snapshot.view ? { ...snapshot.view } : null;
    this.camera.layers.mask = snapshot.layers;
    this.setTier(snapshot.tier);
    if (snapshot.matrixAutoUpdate) this.camera.updateMatrix();
    else this.camera.matrix.copy(snapshot.matrix);
    this.camera.updateProjectionMatrix();
    this.camera.updateMatrixWorld(true);
  }

  dispose() {
    this.transition.active = false;
    this._snapshot = null;
    this.disposed = true;
  }
}
