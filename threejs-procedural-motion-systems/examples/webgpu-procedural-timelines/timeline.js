import { Matrix4, Object3D, Quaternion, Vector3 } from "three/webgpu";

import {
  alignmentThenWorldRoll,
  canonicalizeQuaternionSign,
  fromUnitVectorsSafe,
  rotationAroundUnitAxis,
  safeNormalize,
} from "./quaternion-helpers.js";

export const DEFAULT_SEED = 20260704;
export const STORAGE_VERSION = 2;
export const MOTION_SCENARIOS = Object.freeze([
  "launch-and-staging",
  "spin-docking",
  "debris-release",
  "quaternion-and-reparent",
  "compute-storage",
  "interpolation-and-velocity",
]);

const X_AXIS = new Vector3(1, 0, 0);
const Y_AXIS = new Vector3(0, 1, 0);
const DOCK_AXIS = new Vector3(0, 0, -1);
const DEFAULT_OUTWARD = new Vector3(1, 0, 0);
const DEFAULT_WORLD_OFFSET_METERS = new Vector3(2000, 0, 0);

function createPoseScratch() {
  const scratch = {
    position: new Vector3(),
    velocity: new Vector3(),
    quaternion: new Quaternion(),
    angularVelocity: new Vector3(),
    radial: new Vector3(),
    tangent: new Vector3(),
    flightDirection: new Vector3(),
    dockAxis: new Vector3(0, 0, -1),
    radialDirection: new Vector3(1, 0, 0),
    terminalPosition: new Vector3(),
    terminalQuaternion: new Quaternion(),
    terminalSpin: new Quaternion(),
    base: new Quaternion(),
    spin: new Quaternion(),
    temp: new Vector3(),
  };
  scratch.debrisOutput = {
    angularVelocityOfShip: scratch.angularVelocity,
    tangentialVelocity: scratch.tangent,
    velocity: scratch.velocity,
    temp: scratch.radial,
    tempAxis: scratch.flightDirection,
  };
  return scratch;
}

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

export function createDeltaPolicy({ fixedStep = 1 / 120, maxFrameDelta = 1 / 20, maxSubsteps = 8 } = {}) {
  if (!(fixedStep > 0) || !(maxFrameDelta > 0) || !Number.isInteger(maxSubsteps) || maxSubsteps <= 0) {
    throw new RangeError("invalid delta policy");
  }
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
    droppedTime: 0,
    droppedSubstep: false,
  };
}

export function advanceDeltaPolicy(policy, rawDeltaSeconds, stepFixed) {
  if (!Number.isFinite(rawDeltaSeconds) || rawDeltaSeconds < 0) throw new RangeError("raw delta must be finite and >= 0");
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
    policy.droppedTime += policy.accumulator;
    policy.accumulator = 0;
    policy.droppedSubstep = true;
  }
  return substeps;
}

export function createMotionState({
  seed = DEFAULT_SEED,
  streamId = 3,
  scenario = "spin-docking",
  sceneUnitsPerMeter = 0.001,
} = {}) {
  if (!MOTION_SCENARIOS.includes(scenario)) throw new RangeError(`unknown motion scenario: ${scenario}`);
  if (!(sceneUnitsPerMeter > 0)) throw new RangeError("sceneUnitsPerMeter must be > 0");
  return {
    seed: seed >>> 0,
    streamId,
    scenario,
    sceneUnitsPerMeter,
    rngCounter: 0,
    simulationTime: 0,
    phaseId: 0,
    phaseLocalTime: 0,
    spinAngle: 0,
    position: new Vector3(),
    velocity: new Vector3(),
    baseQuaternion: new Quaternion(),
    quaternion: new Quaternion(),
    angularVelocity: new Vector3(),
    eventFlags: {
      stageDetached: false,
      dockingCaptured: false,
      debrisReleased: false,
      terminalLocked: false,
    },
    eventLog: [],
    _pose: createPoseScratch(),
    _poseOptions: { sceneUnitsPerMeter },
  };
}

export function copyMotionState(target, source) {
  target.seed = source.seed;
  target.streamId = source.streamId;
  target.scenario = source.scenario;
  target.sceneUnitsPerMeter = source.sceneUnitsPerMeter;
  target._poseOptions.sceneUnitsPerMeter = source.sceneUnitsPerMeter;
  target.rngCounter = source.rngCounter;
  target.simulationTime = source.simulationTime;
  target.phaseId = source.phaseId;
  target.phaseLocalTime = source.phaseLocalTime;
  target.spinAngle = source.spinAngle;
  target.position.copy(source.position);
  target.velocity.copy(source.velocity);
  target.baseQuaternion.copy(source.baseQuaternion);
  target.quaternion.copy(source.quaternion);
  target.angularVelocity.copy(source.angularVelocity);
  for (const key of Object.keys(target.eventFlags)) target.eventFlags[key] = source.eventFlags[key];
  target.eventLog.length = source.eventLog.length;
  for (let i = 0; i < source.eventLog.length; i += 1) {
    if (target.eventLog[i]) Object.assign(target.eventLog[i], source.eventLog[i]);
    else target.eventLog[i] = { ...source.eventLog[i] };
  }
  return target;
}

export function createMotionStateSlots(options = {}) {
  const previous = createMotionState(options);
  const current = createMotionState(options);
  const render = createMotionState(options);
  stepTimelineState(current, 0, 0);
  copyMotionState(previous, current);
  copyMotionState(render, current);
  return { previous, current, render };
}

export function getPresentationAlpha(policy) {
  return Math.min(Math.max(policy.accumulator / policy.fixedStep, 0), 1);
}

export function interpolateMotionState(target, previous, current, alpha) {
  copyMotionState(target, previous);
  target.position.lerpVectors(previous.position, current.position, alpha);
  target.velocity.lerpVectors(previous.velocity, current.velocity, alpha);
  target.quaternion.copy(previous.quaternion).slerp(current.quaternion, alpha).normalize();
  target.baseQuaternion.copy(target.quaternion);
  target.angularVelocity.lerpVectors(previous.angularVelocity, current.angularVelocity, alpha);
  target.spinAngle = previous.spinAngle + (current.spinAngle - previous.spinAngle) * alpha;
  target.phaseId = current.phaseId;
  target.phaseLocalTime = previous.phaseLocalTime + (current.phaseLocalTime - previous.phaseLocalTime) * alpha;
  return target;
}

export function logOneShotEvent(state, time, eventName, actorId = 0) {
  if (state.eventFlags[eventName]) return false;
  state.eventFlags[eventName] = true;
  state.eventLog.push({ time, phaseId: state.phaseId, eventName, actorId, rngCounter: state.rngCounter, seed: state.seed, streamId: state.streamId });
  return true;
}

export function resetMotionState(state) {
  state.rngCounter = 0;
  state.simulationTime = 0;
  state.phaseId = 0;
  state.phaseLocalTime = 0;
  state.spinAngle = 0;
  state.position.set(0, 0, 0);
  state.velocity.set(0, 0, 0);
  state.baseQuaternion.identity();
  state.quaternion.identity();
  state.angularVelocity.set(0, 0, 0);
  for (const key of Object.keys(state.eventFlags)) state.eventFlags[key] = false;
  state.eventLog.length = 0;
  return state;
}

export function smoothstepRange(start, end, time) {
  const x = Math.min(Math.max((time - start) / (end - start), 0), 1);
  return x * x * (3 - 2 * x);
}

export function smoothstepRangeDerivative(start, end, time) {
  if (time <= start || time >= end) return 0;
  const x = (time - start) / (end - start);
  return (6 * x * (1 - x)) / (end - start);
}

export function computeAscentKinematics(time, { slowDuration = 5, accelDuration = 11, decelDuration = 8, slowDistance = 0.00035 } = {}) {
  const slowSpeed = slowDistance / slowDuration;
  const remaining = 1 - slowDistance;
  const accel = (remaining - slowSpeed * (accelDuration + 0.5 * decelDuration)) /
    (0.5 * accelDuration * (accelDuration + decelDuration));
  const peakSpeed = slowSpeed + accel * accelDuration;
  const decel = peakSpeed / decelDuration;
  if (time <= slowDuration) return { distance: slowSpeed * time, speed: slowSpeed };
  if (time <= slowDuration + accelDuration) {
    const t = time - slowDuration;
    return { distance: slowDistance + slowSpeed * t + 0.5 * accel * t * t, speed: slowSpeed + accel * t };
  }
  const t = Math.min(time - slowDuration - accelDuration, decelDuration);
  const accelDistance = slowSpeed * accelDuration + 0.5 * accel * accelDuration * accelDuration;
  return { distance: slowDistance + accelDistance + peakSpeed * t - 0.5 * decel * t * t, speed: Math.max(peakSpeed - decel * t, 0) };
}

export function evaluateLaunchPose(time, options = {}, out = createPoseScratch()) {
  const scale = options.sceneUnitsPerMeter ?? options.sceneUnits ?? 0.001;
  const planetRadius = (options.planetRadiusMeters ?? 6_371_000) * scale;
  const targetAltitude = (options.targetOrbitAltitudeMeters ?? 420_000) * scale;
  const maxGroundArc = (options.maxGroundArcDistanceMeters ?? 2_200_000) * scale;
  const maxCrossrange = (options.maxCrossrangeMeters ?? 26_000) * scale;
  const ascent = computeAscentKinematics(Math.min(time, 24));
  const progress = Math.min(ascent.distance, 1);
  const altitude = progress * targetAltitude;
  const altitudeRate = ascent.speed * targetAltitude;
  const blend = smoothstepRange(1, 24, time);
  const blendRate = smoothstepRangeDerivative(1, 24, time);
  const progressPow = Math.pow(Math.max(progress, 0), 1.22);
  const progressDerivative = progress > 0 ? 1.22 * Math.pow(progress, 0.22) * ascent.speed : 0;
  const groundArc = progressPow * maxGroundArc * blend;
  const groundArcRate = maxGroundArc * (progressDerivative * blend + progressPow * blendRate);
  const arcAngle = groundArc / planetRadius;
  const arcRate = groundArcRate / planetRadius;
  out.radial.set(0, Math.cos(arcAngle), -Math.sin(arcAngle));
  out.tangent.set(0, -Math.sin(arcAngle), -Math.cos(arcAngle));
  out.position.copy(out.radial).multiplyScalar(planetRadius + altitude);
  out.position.x += maxCrossrange * progress;
  out.velocity.copy(out.radial).multiplyScalar(altitudeRate)
    .addScaledVector(out.tangent, (planetRadius + altitude) * arcRate)
    .addScaledVector(X_AXIS, maxCrossrange * ascent.speed);
  safeNormalize(out.flightDirection.copy(out.velocity), out.radial);
  fromUnitVectorsSafe(Y_AXIS, out.flightDirection, X_AXIS, out.base);
  rotationAroundUnitAxis(out.flightDirection, Math.sin(time * 2.5) * 0.008, out.spin);
  alignmentThenWorldRoll(out.base, out.spin, out.quaternion);
  out.angularVelocity.copy(out.flightDirection).multiplyScalar(Math.cos(time * 2.5) * 0.02);
  return out;
}

export function integratedSpinAngle(time, rate = 3.15, start = 8, end = 10) {
  if (time <= start) return Math.max(time, 0) * rate;
  const duration = end - start;
  const x = Math.min(Math.max((time - start) / duration, 0), 1);
  const integral = x - x * x * x + 0.5 * x * x * x * x;
  return rate * (start + duration * integral);
}

export function evaluateDockingPose(time, options = {}, out = createPoseScratch()) {
  const scale = options.sceneUnitsPerMeter ?? options.sceneUnits ?? 0.001;
  const approachT = smoothstepRange(0, 6, time);
  const approachRate = smoothstepRangeDerivative(0, 6, time);
  const dockT = smoothstepRange(6, 8, time);
  const dockRate = smoothstepRangeDerivative(6, 8, time);
  const spinDownT = smoothstepRange(8, 10, time);
  const startParallel = -4100 * scale;
  const radialXMeters = 350;
  const radialYMeters = 200;
  const startRadial = Math.hypot(radialXMeters, radialYMeters) * scale;
  out.dockAxis.copy(DOCK_AXIS);
  const physicalRadial = Math.hypot(radialXMeters, radialYMeters);
  out.radialDirection.set(radialXMeters / physicalRadial, radialYMeters / physicalRadial, 0);
  const radial = startRadial * (1 - approachT) * (1 - dockT);
  const radialRate = startRadial * (-approachRate * (1 - dockT) - (1 - approachT) * dockRate);
  const captureOffset = 80 * scale;
  const axial = startParallel * (1 - approachT) + captureOffset * (1 - dockT);
  const axialRate = -startParallel * approachRate - captureOffset * dockRate;
  out.position.copy(out.dockAxis).multiplyScalar(axial).addScaledVector(out.radialDirection, radial);
  out.velocity.copy(out.dockAxis).multiplyScalar(axialRate).addScaledVector(out.radialDirection, radialRate);
  fromUnitVectorsSafe(Y_AXIS, out.temp.copy(out.dockAxis).negate(), X_AXIS, out.base);
  const spinAngle = integratedSpinAngle(time);
  rotationAroundUnitAxis(out.dockAxis, spinAngle, out.spin);
  alignmentThenWorldRoll(out.base, out.spin, out.quaternion);
  out.angularVelocity.copy(out.dockAxis).multiplyScalar(3.15 * (1 - spinDownT));
  out.terminalPosition.set(0, 0, 0);
  rotationAroundUnitAxis(out.dockAxis, integratedSpinAngle(10), out.terminalSpin);
  alignmentThenWorldRoll(out.base, out.terminalSpin, out.terminalQuaternion);
  if (time >= 10) {
    out.position.copy(out.terminalPosition);
    out.velocity.set(0, 0, 0);
    out.quaternion.copy(out.terminalQuaternion);
    out.angularVelocity.set(0, 0, 0);
  }
  out.spinAngle = spinAngle;
  return out;
}

export function computeReleasedDebrisVelocity(options = {}, out = {}) {
  const scale = options.sceneUnitsPerMeter ?? options.sceneUnits ?? 0.001;
  const dockAxis = options.dockAxis ?? DOCK_AXIS;
  const currentSpinRate = options.currentSpinRate ?? 3.15;
  const worldOffsetFromShip = options.worldOffsetFromShipMeters ?? DEFAULT_WORLD_OFFSET_METERS;
  const outward = options.outward ?? DEFAULT_OUTWARD;
  const outwardSpeed = (options.outwardSpeedMetersPerSecond ?? 3000) * scale;
  const axialSpeed = (options.axialSpeedMetersPerSecond ?? 1000) * scale;
  out.angularVelocityOfShip ??= new Vector3();
  out.tangentialVelocity ??= new Vector3();
  out.velocity ??= new Vector3();
  out.angularVelocityOfShip.copy(dockAxis).normalize().multiplyScalar(currentSpinRate);
  out.tangentialVelocity.crossVectors(out.angularVelocityOfShip, worldOffsetFromShip).multiplyScalar(scale);
  out.velocity.copy(out.tangentialVelocity)
    .addScaledVector(out.temp?.copy(outward).normalize() ?? new Vector3().copy(outward).normalize(), outwardSpeed)
    .addScaledVector(out.tempAxis?.copy(dockAxis).normalize() ?? new Vector3().copy(dockAxis).normalize(), axialSpeed);
  const speedCap = (options.speedCapMetersPerSecond ?? 95000) * scale;
  if (out.velocity.length() > speedCap) out.velocity.setLength(speedCap);
  return out;
}

export function evaluateDebrisPose(time, options = {}, out = createPoseScratch()) {
  const scale = options.sceneUnitsPerMeter ?? options.sceneUnits ?? 0.001;
  out.temp.set(1000 * scale, 0, 0);
  const debris = computeReleasedDebrisVelocity(options, out.debrisOutput);
  const localTime = Math.max(0, time - 2);
  out.position.copy(out.temp).addScaledVector(debris.velocity, localTime);
  out.angularVelocity.copy(debris.angularVelocityOfShip).multiplyScalar(0.08);
  rotationAroundUnitAxis(out.angularVelocity, out.angularVelocity.length() * localTime, out.quaternion);
  if (time < 2) {
    out.position.copy(out.temp);
    out.velocity.set(0, 0, 0);
    out.quaternion.identity();
    out.angularVelocity.set(0, 0, 0);
  }
  return out;
}

export function stepTimelineState(state, fixedStep, simulationTime) {
  state.simulationTime = simulationTime;
  state._poseOptions.sceneUnitsPerMeter = state.sceneUnitsPerMeter;
  let pose = state._pose;
  if (state.scenario === "launch-and-staging") {
    pose = evaluateLaunchPose(simulationTime, state._poseOptions, pose);
    state.phaseId = simulationTime < 24 ? 0 : 1;
    state.phaseLocalTime = state.phaseId === 0 ? simulationTime : simulationTime - 24;
    if (simulationTime >= 24) logOneShotEvent(state, simulationTime, "stageDetached", 1);
    state.spinAngle = 0;
  } else if (state.scenario === "debris-release") {
    pose = evaluateDebrisPose(simulationTime, state._poseOptions, pose);
    state.phaseId = simulationTime < 2 ? 0 : 1;
    state.phaseLocalTime = state.phaseId === 0 ? simulationTime : simulationTime - 2;
    if (simulationTime >= 2) logOneShotEvent(state, simulationTime, "debrisReleased", 3);
    state.spinAngle = pose.angularVelocity.length() * state.phaseLocalTime;
  } else {
    pose = evaluateDockingPose(simulationTime, state._poseOptions, pose);
    state.phaseId = simulationTime < 6 ? 0 : simulationTime < 8 ? 1 : simulationTime < 10 ? 2 : 3;
    state.phaseLocalTime = state.phaseId === 0
      ? simulationTime
      : state.phaseId === 1
        ? simulationTime - 6
        : state.phaseId === 2
          ? simulationTime - 8
          : simulationTime - 10;
    if (simulationTime >= 6) logOneShotEvent(state, simulationTime, "dockingCaptured", 2);
    if (simulationTime >= 10) logOneShotEvent(state, simulationTime, "terminalLocked", 2);
    state.spinAngle = pose.spinAngle;
  }
  state.position.copy(pose.position);
  state.velocity.copy(pose.velocity);
  state.quaternion.copy(pose.quaternion);
  canonicalizeQuaternionSign(state.baseQuaternion, state.quaternion);
  state.baseQuaternion.copy(state.quaternion);
  state.angularVelocity.copy(pose.angularVelocity);
  if (state.eventFlags.terminalLocked) {
    state.position.set(0, 0, 0);
    state.velocity.set(0, 0, 0);
    state.quaternion.copy(pose.terminalQuaternion);
    state.baseQuaternion.copy(state.quaternion);
    state.angularVelocity.set(0, 0, 0);
  }
  return state;
}

export function simulateTimeline({ presentationHz = 60, durationSeconds = 12, seed = DEFAULT_SEED, scenario = "spin-docking", sceneUnitsPerMeter = 0.001 } = {}) {
  const state = createMotionState({ seed, scenario, sceneUnitsPerMeter });
  const policy = createDeltaPolicy();
  const frameCount = Math.round(durationSeconds * presentationHz);
  for (let frame = 0; frame < frameCount; frame += 1) {
    advanceDeltaPolicy(policy, 1 / presentationHz, (fixedStep, time) => stepTimelineState(state, fixedStep, time + fixedStep));
  }
  if (policy.simulationTime < durationSeconds - 1e-12) {
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
      velocity: state.velocity.toArray(),
      angularVelocity: state.angularVelocity.toArray(),
      spinAngle: state.spinAngle,
      quaternion: state.quaternion.toArray(),
    },
  };
}

export function reparentPreserveWorldTransform(child, newParent, { trsResidualGate = 1e-8 } = {}) {
  child.updateWorldMatrix(true, true);
  newParent.updateWorldMatrix(true, false);
  const worldBefore = child.matrixWorld.clone();
  const inverseParent = new Matrix4().copy(newParent.matrixWorld).invert();
  const localMatrix = new Matrix4().multiplyMatrices(inverseParent, worldBefore);
  const localPosition = new Vector3();
  const localQuaternion = new Quaternion();
  const localScale = new Vector3();
  localMatrix.decompose(localPosition, localQuaternion, localScale);
  const recomposed = new Matrix4().compose(localPosition, localQuaternion, localScale);
  const trsResidual = matrixMaxAbsDifference(localMatrix, recomposed);
  newParent.add(child);
  if (Number.isFinite(trsResidual) && trsResidual <= trsResidualGate) {
    child.matrixAutoUpdate = true;
    child.position.copy(localPosition);
    child.quaternion.copy(localQuaternion);
    child.scale.copy(localScale);
    child.updateMatrix();
  } else {
    child.matrixAutoUpdate = false;
    child.matrix.copy(localMatrix);
  }
  child.matrixWorldNeedsUpdate = true;
  child.updateWorldMatrix(false, true);
  return { worldBefore, worldAfter: child.matrixWorld.clone(), localMatrix, trsResidual, usesAffineMatrix: child.matrixAutoUpdate === false };
}

export function captureWorldTransformForReparent(child, newParent) {
  return reparentPreserveWorldTransform(child, newParent).worldBefore;
}

export function createReparentFixture() {
  const oldParent = new Object3D();
  const newParent = new Object3D();
  const child = new Object3D();
  oldParent.position.set(3, 4, 5);
  oldParent.quaternion.setFromAxisAngle(Y_AXIS, 0.4);
  oldParent.scale.set(1.4, 0.8, 1.1);
  newParent.position.set(-7, 2, 9);
  newParent.quaternion.setFromAxisAngle(new Vector3(0.3, 0.7, -0.2).normalize(), 0.9);
  newParent.scale.set(0.6, 1.7, 1.2);
  child.position.set(1, 2, 3);
  child.quaternion.setFromAxisAngle(X_AXIS, -0.33);
  child.scale.set(0.9, 1.2, 0.7);
  oldParent.add(child);
  oldParent.updateWorldMatrix(true, true);
  return { ...reparentPreserveWorldTransform(child, newParent), child, newParent };
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
