import { Quaternion, Vector3 } from "three";

const EPSILON = 1e-8;
const scratchAxis = new Vector3();
const scratchFallback = new Vector3(1, 0, 0);

export function canonicalizeQuaternionSign(prev, next) {
  if (prev.dot(next) < 0) {
    next.set(-next.x, -next.y, -next.z, -next.w);
  }
  return next;
}

export function safeNormalize(vector, fallback = scratchFallback) {
  if (vector.lengthSq() < EPSILON) return vector.copy(fallback).normalize();
  return vector.normalize();
}

export function fromUnitVectorsSafe(fromLocalAxis, toWorldAxis, fallbackAxis = scratchFallback) {
  const from = fromLocalAxis.clone().normalize();
  const to = toWorldAxis.clone().normalize();
  if (from.lengthSq() < EPSILON || to.lengthSq() < EPSILON) {
    return new Quaternion();
  }

  const dot = from.dot(to);
  if (dot > 1 - 1e-6) return new Quaternion();
  if (dot < -1 + 1e-6) {
    scratchAxis.copy(fallbackAxis);
    if (Math.abs(scratchAxis.dot(from)) > 0.95) scratchAxis.set(0, 1, 0);
    scratchAxis.cross(from).normalize();
    return new Quaternion().setFromAxisAngle(scratchAxis, Math.PI);
  }

  return new Quaternion().setFromUnitVectors(from, to).normalize();
}

export function rotationAroundUnitAxis(axisWorld, radians) {
  const axis = axisWorld.clone();
  safeNormalize(axis, scratchFallback);
  return new Quaternion().setFromAxisAngle(axis, radians).normalize();
}

export function alignmentThenWorldRoll(baseAlignment, worldRoll) {
  const result = new Quaternion();
  result.multiplyQuaternions(worldRoll, baseAlignment);
  return result.normalize();
}

export function localSpinAfterBase(baseWorld, localSpin) {
  const result = new Quaternion();
  result.multiplyQuaternions(baseWorld, localSpin);
  return result.normalize();
}

export function integrateAngularVelocityWorld(quaternion, angularVelocityWorld, dt) {
  const angularSpeed = angularVelocityWorld.length();
  if (angularSpeed < EPSILON || dt <= 0) return quaternion.normalize();

  const deltaWorld = rotationAroundUnitAxis(
    scratchAxis.copy(angularVelocityWorld).multiplyScalar(1 / angularSpeed),
    angularSpeed * dt,
  );
  quaternion.premultiply(deltaWorld);
  return quaternion.normalize();
}

export function quaternionAngle(a, b) {
  const dot = Math.min(Math.abs(a.dot(b)), 1);
  return 2 * Math.acos(dot);
}

export function quaternionNormError(q) {
  return Math.abs(Math.hypot(q.x, q.y, q.z, q.w) - 1);
}
