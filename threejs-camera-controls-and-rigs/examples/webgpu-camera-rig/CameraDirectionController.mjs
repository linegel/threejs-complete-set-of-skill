import {
  Box3,
  Matrix4,
  Quaternion,
  Sphere,
  Vector2,
  Vector3,
} from "three";

export function createCameraScratch() {
  return {
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
    target: new Vector3(),
    bodyUp: new Vector3(0, 1, 0),
    worldUp: new Vector3(0, 1, 0),
    sideAxis: new Vector3(1, 0, 0),
    orbitOffset: new Vector3(),
    boundsSphere: new Sphere(),
  };
}

export function chooseStableUpFallback(out, forward) {
  const candidate = Math.abs(forward.y) < 0.9 ? new Vector3(0, 1, 0) : new Vector3(1, 0, 0);
  out.copy(candidate);
  out.addScaledVector(forward, -out.dot(forward)).normalize();
  return out;
}

export function computeCameraPose(
  outPosition,
  outQuaternion,
  target,
  desiredPosition,
  upHint,
  scratch = createCameraScratch(),
) {
  outPosition.copy(desiredPosition);
  scratch.forward.subVectors(target, desiredPosition);
  if (scratch.forward.lengthSq() < 1e-10) scratch.forward.set(0, 0, -1);
  scratch.forward.normalize();

  if (Math.abs(scratch.forward.dot(upHint)) > 0.985) {
    chooseStableUpFallback(scratch.upHint, scratch.forward);
  } else {
    scratch.upHint.copy(upHint).normalize();
  }

  scratch.right.crossVectors(scratch.forward, scratch.upHint);
  if (scratch.right.lengthSq() < 1e-10) chooseStableUpFallback(scratch.upHint, scratch.forward);
  scratch.right.crossVectors(scratch.forward, scratch.upHint).normalize();
  scratch.up.crossVectors(scratch.right, scratch.forward).normalize();
  scratch.back.copy(scratch.forward).multiplyScalar(-1);
  scratch.matrix.makeBasis(scratch.right, scratch.up, scratch.back);
  outQuaternion.setFromRotationMatrix(scratch.matrix).normalize();
  return { position: outPosition, quaternion: outQuaternion };
}

export function computeScreenOccupancy(camera, distance, subjectRadius, scratch = createCameraScratch()) {
  camera.getViewSize(distance, scratch.viewSize);
  camera.getViewBounds(distance, scratch.minView, scratch.maxView);
  return {
    vertical: (subjectRadius * 2) / scratch.viewSize.y,
    horizontal: (subjectRadius * 2) / scratch.viewSize.x,
    minView: scratch.minView.clone(),
    maxView: scratch.maxView.clone(),
  };
}

export function expDecayAlpha(lambda, dt) {
  return 1 - Math.exp(-lambda * dt);
}

export function stepScalarSpring(state, target, dt, {
  stiffness = 28,
  dampingRatio = 1.1,
  maxStep = 1 / 120,
  maxSubsteps = 8,
} = {}) {
  const damping = 2 * dampingRatio * Math.sqrt(stiffness);
  let remaining = Math.min(dt, 1 / 20);
  let steps = 0;
  while (remaining > 0 && steps < maxSubsteps) {
    const step = Math.min(remaining, maxStep);
    const acceleration = (target - state.value) * stiffness - state.velocity * damping;
    state.velocity += acceleration * step;
    state.value += state.velocity * step;
    remaining -= step;
    steps += 1;
  }
  return state;
}

export function clampObstruction({ target, desiredPosition, hitDistance = Infinity, radius = 0.2 }) {
  const direction = desiredPosition.clone().sub(target);
  const distance = direction.length();
  if (!Number.isFinite(hitDistance) || hitDistance >= distance) return desiredPosition.clone();
  direction.normalize();
  return target.clone().add(direction.multiplyScalar(Math.max(hitDistance - radius, radius)));
}

export class CameraDirectionController {
  constructor(camera, {
    subject = null,
    subjectBounds = new Sphere(new Vector3(), 1),
    dominantBodyPosition = new Vector3(0, 0, 0),
  } = {}) {
    this.camera = camera;
    this.subject = subject;
    this.subjectBounds = subjectBounds;
    this.dominantBodyPosition = dominantBodyPosition;
    this.scratch = createCameraScratch();
    this.mode = "chase";
    this.transition = null;
    this.spring = { value: 0, velocity: 0 };
    this.floatingOrigin = new Vector3();
    this.disposed = false;
    this._snapshot = null;
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

  computeChasePose(outPosition, outQuaternion) {
    const target = this.subjectWorldPosition(this.scratch.target);
    const radius = this.subjectRadius();
    const desired = this.scratch.desiredPosition.set(0, radius * 0.6, radius * 3.0).add(target);
    desired.z += radius * 2.5;
    return computeCameraPose(outPosition, outQuaternion, target, desired, this.scratch.worldUp.set(0, 1, 0), this.scratch);
  }

  computeSidePose(outPosition, outQuaternion) {
    const target = this.subjectWorldPosition(this.scratch.target);
    const radius = this.subjectRadius();
    const bodyUp = this.scratch.bodyUp.subVectors(target, this.dominantBodyPosition);
    if (bodyUp.lengthSq() < 1e-8) bodyUp.set(0, 1, 0);
    bodyUp.normalize();
    const desired = this.scratch.desiredPosition
      .copy(target)
      .addScaledVector(this.scratch.sideAxis.set(1, 0, 0), radius * 3.2)
      .addScaledVector(bodyUp, radius)
      .add(this.scratch.orbitOffset.set(0, 0, radius * 1.35));
    return computeCameraPose(outPosition, outQuaternion, target, desired, bodyUp, this.scratch);
  }

  computeOrbitPose(outPosition, outQuaternion, yaw = 0.75, pitch = 0.25) {
    const target = this.subjectWorldPosition(this.scratch.target);
    const radius = this.subjectRadius();
    const orbitRadius = radius * 5.2;
    const desired = this.scratch.desiredPosition.set(
      Math.cos(yaw) * orbitRadius,
      Math.sin(pitch) * orbitRadius * 0.45,
      Math.sin(yaw) * orbitRadius,
    ).add(target);
    return computeCameraPose(outPosition, outQuaternion, target, desired, this.scratch.worldUp.set(0, 1, 0), this.scratch);
  }

  updateModePose(mode, outPosition, outQuaternion) {
    if (mode === "side") return this.computeSidePose(outPosition, outQuaternion);
    if (mode === "orbit") return this.computeOrbitPose(outPosition, outQuaternion);
    return this.computeChasePose(outPosition, outQuaternion);
  }

  startHandoff(mode, duration = 1.2) {
    this.transition = {
      mode,
      duration,
      elapsed: 0,
      startPosition: this.camera.position.clone(),
      startQuaternion: this.camera.quaternion.clone(),
    };
  }

  update(dt) {
    const clampedDt = Math.min(dt, 1 / 20);
    if (this.transition) {
      const pose = this.updateModePose(
        this.transition.mode,
        this.scratch.targetPosition,
        this.scratch.targetQuaternion,
      );
      this.transition.elapsed = Math.min(this.transition.elapsed + clampedDt, this.transition.duration);
      const t = this.transition.elapsed / this.transition.duration;
      const eased = 1 - Math.pow(1 - t, 1.8);
      this.camera.position.lerpVectors(this.transition.startPosition, pose.position, eased);
      this.camera.quaternion.copy(this.transition.startQuaternion).slerp(pose.quaternion, eased).normalize();
      if (t >= 1) {
        this.camera.position.copy(pose.position);
        this.camera.quaternion.copy(pose.quaternion);
        this.mode = this.transition.mode;
        this.transition = null;
      }
      return "handoff";
    }

    const pose = this.updateModePose(this.mode, this.scratch.targetPosition, this.scratch.targetQuaternion);
    const alpha = expDecayAlpha(this.mode === "chase" ? 18 : 9.5, clampedDt);
    this.camera.position.lerp(pose.position, alpha);
    this.camera.quaternion.slerp(pose.quaternion, alpha).normalize();
    return this.mode;
  }

  reacquirePointerLook({ yawPitch, fromCamera = this.camera } = {}) {
    const euler = yawPitch ?? { yaw: 0, pitch: 0 };
    const direction = this.scratch.forward;
    fromCamera.getWorldDirection(direction);
    euler.yaw = Math.atan2(-direction.x, -direction.z);
    euler.pitch = Math.asin(Math.max(-1, Math.min(1, direction.y)));
    return euler;
  }

  reacquireOrbitControls(controls, target = null) {
    if (!controls) return null;
    controls.target.copy(target ?? this.subjectWorldPosition(this.scratch.target));
    controls.update();
    return controls;
  }

  updateFloatingOrigin(virtualCameraPosition) {
    this.floatingOrigin.copy(virtualCameraPosition);
    return this.floatingOrigin;
  }

  snapshot() {
    this._snapshot = {
      position: this.camera.position.clone(),
      quaternion: this.camera.quaternion.clone(),
      up: this.camera.up.clone(),
      fov: this.camera.fov,
      near: this.camera.near,
      far: this.camera.far,
      aspect: this.camera.aspect,
      zoom: this.camera.zoom,
      filmGauge: this.camera.filmGauge,
      filmOffset: this.camera.filmOffset,
      view: this.camera.view ? { ...this.camera.view } : null,
      layers: this.camera.layers.mask,
    };
    return this._snapshot;
  }

  restore(snapshot = this._snapshot) {
    if (!snapshot) return;
    this.camera.position.copy(snapshot.position);
    this.camera.quaternion.copy(snapshot.quaternion);
    this.camera.up.copy(snapshot.up);
    this.camera.fov = snapshot.fov;
    this.camera.near = snapshot.near;
    this.camera.far = snapshot.far;
    this.camera.aspect = snapshot.aspect;
    this.camera.zoom = snapshot.zoom;
    this.camera.filmGauge = snapshot.filmGauge;
    this.camera.filmOffset = snapshot.filmOffset;
    if (snapshot.view) {
      this.camera.setViewOffset(
        snapshot.view.fullWidth,
        snapshot.view.fullHeight,
        snapshot.view.offsetX,
        snapshot.view.offsetY,
        snapshot.view.width,
        snapshot.view.height,
      );
    } else {
      this.camera.clearViewOffset();
    }
    this.camera.layers.mask = snapshot.layers;
    this.camera.updateProjectionMatrix();
  }

  dispose() {
    this.transition = null;
    this._snapshot = null;
    this.disposed = true;
  }
}
