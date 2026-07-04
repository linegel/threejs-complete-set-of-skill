import { Matrix4, Object3D, Quaternion, Vector3 } from "three";

import {
  alignmentThenWorldRoll,
  canonicalizeQuaternionSign,
  fromUnitVectorsSafe,
  integrateAngularVelocityWorld,
  localSpinAfterBase,
  rotationAroundUnitAxis,
  safeNormalize,
} from "./quaternion-helpers.js";

export const DEFAULT_SEED = 20260704;
export const STORAGE_VERSION = 1;

export function hashUint(value) {
  let x = value >>> 0;
  x ^= x >>> 16;
  x = Math.imul(x, 0x7feb352d);
  x ^= x >>> 15;
  x = Math.imul(x, 0x846ca68b);
  x ^= x >>> 16;
  return x >>> 0;
}

export function seededRandom(state, streamId = 0) {
  const value = hashUint(state.seed ^ Math.imul(streamId + 1, 0x9e3779b9) ^ state.rngCounter);
  state.rngCounter += 1;
  return value / 0xffffffff;
}

export function createDeltaPolicy({
  fixedStep = 1 / 120,
  maxFrameDelta = 1 / 20,
  maxSubsteps = 8,
} = {}) {
  return {
    rawDeltaSeconds: 0,
    clampedDeltaSeconds: 0,
    fixedStep,
    maxFrameDelta,
    maxSubsteps,
    accumulator: 0,
    simulationTime: 0,
    presentationTime: 0,
    simulationSteps: 0,
    droppedSubstep: false,
  };
}

export function advanceDeltaPolicy(policy, rawDeltaSeconds, stepFixed) {
  policy.rawDeltaSeconds = rawDeltaSeconds;
  policy.clampedDeltaSeconds = Math.min(rawDeltaSeconds, policy.maxFrameDelta);
  policy.accumulator += policy.clampedDeltaSeconds;
  policy.presentationTime += rawDeltaSeconds;
  policy.droppedSubstep = false;

  let substeps = 0;
  while (policy.accumulator + 1e-12 >= policy.fixedStep && substeps < policy.maxSubsteps) {
    stepFixed(policy.fixedStep, policy.simulationTime);
    policy.simulationTime += policy.fixedStep;
    policy.accumulator -= policy.fixedStep;
    policy.simulationSteps += 1;
    substeps += 1;
  }

  if (policy.accumulator >= policy.fixedStep) {
    policy.accumulator = 0;
    policy.droppedSubstep = true;
  }

  return substeps;
}

export function createMotionState({ seed = DEFAULT_SEED, streamId = 3 } = {}) {
  return {
    seed: seed >>> 0,
    streamId,
    rngCounter: 0,
    phaseId: 0,
    phaseLocalTime: 0,
    position: new Vector3(),
    velocity: new Vector3(),
    baseQuaternion: new Quaternion(),
    quaternion: new Quaternion(),
    angularVelocity: new Vector3(),
    eventFlags: {
      stageDetached: false,
      dockingCaptured: false,
      terminalLocked: false,
    },
    eventLog: [],
  };
}

export function logOneShotEvent(state, time, eventName, actorId = 0) {
  if (state.eventFlags[eventName]) return false;
  state.eventFlags[eventName] = true;
  state.eventLog.push({
    time,
    phaseId: state.phaseId,
    eventName,
    actorId,
    rngCounter: state.rngCounter,
    seed: state.seed,
    streamId: state.streamId,
  });
  return true;
}

export function resetMotionState(state) {
  state.rngCounter = 0;
  state.phaseId = 0;
  state.phaseLocalTime = 0;
  state.position.set(0, 0, 0);
  state.velocity.set(0, 0, 0);
  state.baseQuaternion.identity();
  state.quaternion.identity();
  state.angularVelocity.set(0, 0, 0);
  state.eventFlags.stageDetached = false;
  state.eventFlags.dockingCaptured = false;
  state.eventFlags.terminalLocked = false;
  state.eventLog.length = 0;
  return state;
}

export function smoothstepRange(start, end, time) {
  const x = Math.min(Math.max((time - start) / (end - start), 0), 1);
  return x * x * (3 - 2 * x);
}

export function computeAscentKinematics(time, {
  slowDuration = 5,
  accelDuration = 11,
  decelDuration = 8,
  slowDistance = 0.00035,
} = {}) {
  const slowSpeed = slowDistance / slowDuration;
  const remaining = 1 - slowDistance;
  const accel =
    (remaining - slowSpeed * (accelDuration + 0.5 * decelDuration)) /
    (0.5 * accelDuration * (accelDuration + decelDuration));
  const peakSpeed = slowSpeed + accel * accelDuration;
  const decel = peakSpeed / decelDuration;

  if (time <= slowDuration) {
    return { distance: slowSpeed * time, speed: slowSpeed };
  }
  if (time <= slowDuration + accelDuration) {
    const t = time - slowDuration;
    return {
      distance: slowDistance + slowSpeed * t + 0.5 * accel * t * t,
      speed: slowSpeed + accel * t,
    };
  }

  const t = Math.min(time - slowDuration - accelDuration, decelDuration);
  const accelDistance = slowSpeed * accelDuration + 0.5 * accel * accelDuration * accelDuration;
  return {
    distance: slowDistance + accelDistance + peakSpeed * t - 0.5 * decel * t * t,
    speed: Math.max(peakSpeed - decel * t, 0),
  };
}

export function evaluateLaunchPose(time, {
  sceneUnits = 1,
  planetRadius = 6371,
  targetOrbitAltitude = 420,
  maxGroundArcDistance = 2200,
  maxCrossrange = 26,
} = {}) {
  const ascent = computeAscentKinematics(Math.min(time, 24));
  const ascentProgress = Math.min(ascent.distance, 1);
  const altitude = ascentProgress * targetOrbitAltitude * sceneUnits;
  const groundArcDistance =
    Math.pow(ascentProgress, 1.22) * maxGroundArcDistance * smoothstepRange(1, 24, time);
  const arcAngle = groundArcDistance / planetRadius;
  const radial = new Vector3(0, Math.cos(arcAngle), -Math.sin(arcAngle));
  const tangent = new Vector3(0, -Math.sin(arcAngle), -Math.cos(arcAngle));
  const flightDirection = radial.clone().lerp(tangent, 0.9 * ascentProgress);
  safeNormalize(flightDirection, radial);

  const position = radial.clone().multiplyScalar((planetRadius + altitude) * sceneUnits);
  position.x += maxCrossrange * ascentProgress * sceneUnits;
  const base = fromUnitVectorsSafe(new Vector3(0, 1, 0), flightDirection, new Vector3(1, 0, 0));
  const roll = rotationAroundUnitAxis(flightDirection, Math.sin(time * 2.5) * 0.008);
  const quaternion = alignmentThenWorldRoll(base, roll);
  const velocity = flightDirection.clone().multiplyScalar(ascent.speed * 95);

  return { position, velocity, quaternion, radial, tangent, flightDirection };
}

export function evaluateDockingPose(time) {
  const dockAxis = new Vector3(0, 0, -1);
  const dockPort = new Vector3(0, 0, 0);
  const startPosition = new Vector3(0.35, 0.2, 4.1);
  const terminalPosition = dockPort.clone();
  const approachT = smoothstepRange(0, 6, time);
  const dockT = smoothstepRange(6, 8, time);
  const spinDownT = smoothstepRange(8, 10, time);

  const offset = startPosition.clone().sub(dockPort);
  const parallel = offset.dot(dockAxis);
  const radialVector = offset.clone().sub(dockAxis.clone().multiplyScalar(parallel));
  const radialDirection = safeNormalize(radialVector, new Vector3(1, 0, 0));
  const radial = radialVector.length() * (1 - approachT) * (1 - dockT);
  const axial = parallel * (1 - approachT) + 0.08 * (1 - dockT);
  const position = dockPort
    .clone()
    .add(dockAxis.clone().multiplyScalar(axial))
    .add(radialDirection.clone().multiplyScalar(radial));

  const alignment = fromUnitVectorsSafe(new Vector3(0, 1, 0), dockAxis.clone().multiplyScalar(-1));
  const spin = rotationAroundUnitAxis(dockAxis, (1 - spinDownT) * time * 3.15);
  const quaternion = localSpinAfterBase(alignment, spin);

  if (spinDownT >= 0.995 || time >= 10) {
    position.copy(terminalPosition);
    quaternion.copy(alignment);
  }

  return { position, quaternion, dockAxis, radialDirection, terminalPosition };
}

export function computeReleasedDebrisVelocity({
  dockAxis = new Vector3(0, 0, -1),
  currentSpinRate = 3.15,
  worldOffsetFromShip = new Vector3(2, 0, 0),
  outward = new Vector3(1, 0, 0),
  outwardSpeed = 3,
  axialSpeed = 1,
} = {}) {
  const angularVelocityOfShip = dockAxis.clone().normalize().multiplyScalar(currentSpinRate);
  const tangentialVelocity = new Vector3().crossVectors(angularVelocityOfShip, worldOffsetFromShip);
  const velocity = tangentialVelocity
    .clone()
    .add(outward.clone().normalize().multiplyScalar(outwardSpeed))
    .add(dockAxis.clone().normalize().multiplyScalar(axialSpeed));

  if (velocity.length() > 95) velocity.setLength(95);
  return { angularVelocityOfShip, tangentialVelocity, velocity };
}

export function captureWorldTransformForReparent(child, newParent) {
  child.matrixWorldNeedsUpdate = true;
  child.updateWorldMatrix(true, true, true);
  const matrix = child.matrixWorld.clone();

  if (newParent) newParent.add(child);

  matrix.decompose(child.position, child.quaternion, child.scale);
  child.matrix.compose(child.position, child.quaternion, child.scale);
  child.matrixWorld.copy(matrix);
  child.matrixWorldNeedsUpdate = false;
  return matrix;
}

export function createReparentFixture() {
  const oldParent = new Object3D();
  const newParent = new Object3D();
  const child = new Object3D();
  oldParent.position.set(3, 4, 5);
  oldParent.quaternion.setFromAxisAngle(new Vector3(0, 1, 0), 0.4);
  child.position.set(1, 2, 3);
  oldParent.add(child);
  oldParent.updateWorldMatrix(true, true, true);
  const before = child.matrixWorld.clone();
  const after = captureWorldTransformForReparent(child, newParent);
  return { before, after, child, newParent };
}

export function stepTimelineState(state, fixedStep, simulationTime) {
  const launch = evaluateLaunchPose(Math.min(simulationTime, 24));
  const docking = evaluateDockingPose(Math.max(simulationTime - 2, 0));
  const debris = computeReleasedDebrisVelocity();

  if (simulationTime >= 2) logOneShotEvent(state, simulationTime, "stageDetached", 1);
  if (simulationTime >= 6) logOneShotEvent(state, simulationTime, "dockingCaptured", 2);
  if (simulationTime >= 12) logOneShotEvent(state, simulationTime, "terminalLocked", 2);

  state.phaseId = simulationTime < 2 ? 0 : simulationTime < 6 ? 1 : simulationTime < 12 ? 2 : 3;
  state.phaseLocalTime = simulationTime;
  state.position.copy(docking.position).add(launch.position.multiplyScalar(0.00001));
  state.velocity.copy(launch.velocity).add(debris.velocity.multiplyScalar(0.01));
  state.quaternion.copy(docking.quaternion);
  canonicalizeQuaternionSign(state.baseQuaternion, state.quaternion);
  state.baseQuaternion.copy(state.quaternion);
  state.angularVelocity.copy(debris.angularVelocityOfShip);
  integrateAngularVelocityWorld(state.quaternion, state.angularVelocity, fixedStep * 0);
  return state;
}

export function simulateTimeline({
  presentationHz = 60,
  durationSeconds = 12,
  seed = DEFAULT_SEED,
} = {}) {
  const state = createMotionState({ seed });
  const policy = createDeltaPolicy();
  const frameCount = Math.round(durationSeconds * presentationHz);
  for (let frame = 0; frame < frameCount; frame += 1) {
    advanceDeltaPolicy(policy, 1 / presentationHz, (fixedStep, simulationTime) => {
      stepTimelineState(state, fixedStep, simulationTime + fixedStep);
    });
  }

  if (policy.simulationTime < durationSeconds) {
    stepTimelineState(state, policy.fixedStep, durationSeconds);
    policy.simulationTime = durationSeconds;
  }

  return {
    state,
    policy,
    snapshot: {
      seed: state.seed,
      streamId: state.streamId,
      rngCounter: state.rngCounter,
      eventLog: state.eventLog,
      storageVersion: STORAGE_VERSION,
      position: state.position.toArray(),
      quaternion: [state.quaternion.x, state.quaternion.y, state.quaternion.z, state.quaternion.w],
    },
  };
}

export function matrixMaxAbsDifference(a, b) {
  return a.elements.reduce((max, value, index) => Math.max(max, Math.abs(value - b.elements[index])), 0);
}

export function matrixEquality(a, b, epsilon = 1e-6) {
  return matrixMaxAbsDifference(a, b) <= epsilon;
}

export function makeIdentityMatrixArray(count) {
  const matrices = new Float32Array(count * 16);
  const identity = new Matrix4();
  for (let i = 0; i < count; i += 1) identity.toArray(matrices, i * 16);
  return matrices;
}
