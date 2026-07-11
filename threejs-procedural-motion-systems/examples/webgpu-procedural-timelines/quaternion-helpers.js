import { Quaternion, Vector3 } from "three/webgpu";

const EPSILON = 1e-8;
const scratchAxis = new Vector3();
const scratchFrom = new Vector3();
const scratchTo = new Vector3();
const scratchFallback = new Vector3(1, 0, 0);
const scratchDelta = new Quaternion();

export function canonicalizeQuaternionSign(prev, next) {
  if (prev.dot(next) < 0) next.set(-next.x, -next.y, -next.z, -next.w);
  return next;
}

export function safeNormalize(vector, fallback = scratchFallback) {
  if (vector.lengthSq() < EPSILON) return vector.copy(fallback).normalize();
  return vector.normalize();
}

export function fromUnitVectorsSafe(
  fromLocalAxis,
  toWorldAxis,
  fallbackAxis = scratchFallback,
  out = new Quaternion(),
) {
  scratchFrom.copy(fromLocalAxis);
  scratchTo.copy(toWorldAxis);
  if (scratchFrom.lengthSq() < EPSILON || scratchTo.lengthSq() < EPSILON) return out.identity();
  scratchFrom.normalize();
  scratchTo.normalize();
  const dot = scratchFrom.dot(scratchTo);
  if (dot > 1 - 1e-6) return out.identity();
  if (dot < -1 + 1e-6) {
    scratchAxis.copy(fallbackAxis);
    if (Math.abs(scratchAxis.dot(scratchFrom)) > 0.95) scratchAxis.set(0, 1, 0);
    scratchAxis.cross(scratchFrom).normalize();
    return out.setFromAxisAngle(scratchAxis, Math.PI).normalize();
  }
  return out.setFromUnitVectors(scratchFrom, scratchTo).normalize();
}

export function rotationAroundUnitAxis(axisWorld, radians, out = new Quaternion()) {
  scratchAxis.copy(axisWorld);
  safeNormalize(scratchAxis, scratchFallback);
  return out.setFromAxisAngle(scratchAxis, radians).normalize();
}

/** World roll is applied after local-to-world alignment: result = roll * base. */
export function alignmentThenWorldRoll(baseAlignment, worldRoll, out = new Quaternion()) {
  return out.multiplyQuaternions(worldRoll, baseAlignment).normalize();
}

/** Local spin is applied before the base world transform: result = base * spin. */
export function localSpinAfterBase(baseWorld, localSpin, out = new Quaternion()) {
  return out.multiplyQuaternions(baseWorld, localSpin).normalize();
}

export function integrateAngularVelocityWorld(quaternion, angularVelocityWorld, dt) {
  const angularSpeed = angularVelocityWorld.length();
  if (angularSpeed < EPSILON || dt <= 0) return quaternion.normalize();
  scratchAxis.copy(angularVelocityWorld).multiplyScalar(1 / angularSpeed);
  rotationAroundUnitAxis(scratchAxis, angularSpeed * dt, scratchDelta);
  quaternion.premultiply(scratchDelta);
  return quaternion.normalize();
}

export function quaternionAngle(a, b) {
  const dot = Math.min(Math.abs(a.dot(b)), 1);
  return 2 * Math.acos(dot);
}

export function quaternionNormError(q) {
  return Math.abs(Math.hypot(q.x, q.y, q.z, q.w) - 1);
}
