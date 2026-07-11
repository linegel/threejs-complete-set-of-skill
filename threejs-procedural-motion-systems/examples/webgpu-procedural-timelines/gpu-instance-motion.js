import { Matrix4, StorageBufferAttribute, StorageInstancedBufferAttribute } from "three/webgpu";
import {
  Fn,
  cos,
  cross,
  float,
  instanceIndex,
  mix,
  positionGeometry,
  sin,
  storage,
  uniform,
  vec3,
  vec4,
} from "three/tsl";

import { createMotionState, hashUint, stepTimelineState } from "./timeline.js";

export const MOTION_STORAGE_LAYOUT = Object.freeze({
  version: 2,
  dynamicState: Object.freeze({
    fields: ["previousPositionPhase", "currentPositionPhase", "velocityFlags", "previousQuaternion", "currentQuaternion", "angularVelocitySpin"],
    bytesPerInstance: 96,
    slotCount: 2,
  }),
  staticState: Object.freeze({
    fields: ["anchorFrequency", "axisPhase", "seedStreamFlags"],
    bytesPerInstance: 48,
  }),
  storageBytesPerInstance: 144,
});

export const GPU_MOTION_COMPUTE_CONTRACT = Object.freeze({
  dispatchOwner: "fixed-step accumulator or explicit GPU seek",
  renderInterpolation: "vertex path reads previous/current position and quaternion with alpha",
  workgroupSize: 64,
  parityLane: 0,
  parityMeaning: "lane zero is the same analytic launch/docking/debris timeline as the CPU core",
});

const STORAGE_KEYS = Object.freeze([
  "previousPose",
  "currentPose",
  "velocityState",
  "previousQuaternion",
  "currentQuaternion",
  "angularVelocity",
  "anchorFrequency",
  "axisPhase",
  "seedFlags",
]);

export function chooseMotionRoute({ actorCount, mixedGeometry = false }) {
  if (actorCount < 200) return "<200 Object3D";
  if (actorCount <= 10000) return mixedGeometry ? "200-10k BatchedMesh" : "200-10k InstancedMesh";
  return "10k+ StorageInstancedBufferAttribute";
}

function timelineScenario(scenario) {
  if (scenario === "launch-and-staging") return scenario;
  if (scenario === "debris-release") return scenario;
  return "spin-docking";
}

function writeVec4(array, lane, x, y, z, w) {
  array[lane] = x;
  array[lane + 1] = y;
  array[lane + 2] = z;
  array[lane + 3] = w;
}

function deterministicAnchor(index, instanceCount, seed, scale, out) {
  if (index === GPU_MOTION_COMPUTE_CONTRACT.parityLane) {
    out[0] = 0;
    out[1] = 0;
    out[2] = 0;
    return out;
  }
  const hash = hashUint(seed ^ Math.imul(index + 1, 0x9e3779b9));
  const angle = ((hash & 0xffff) / 0xffff) * Math.PI * 2;
  const radiusMeters = 90 + ((hash >>> 16) & 0xff) * 1.25;
  const verticalMeters = (((hash >>> 24) & 0xff) / 255 - 0.5) * 240;
  const stratification = 0.65 + 0.35 * (index / Math.max(instanceCount - 1, 1));
  out[0] = Math.cos(angle) * radiusMeters * scale * stratification;
  out[1] = verticalMeters * scale;
  out[2] = Math.sin(angle) * radiusMeters * scale * stratification;
  return out;
}

function fillInstanceMotionArrays(arrays, instanceCount, {
  scenario = "spin-docking",
  sceneUnitsPerMeter = 0.001,
  seed = 20260704,
  time = 0,
} = {}) {
  const state = createMotionState({ seed, scenario: timelineScenario(scenario), sceneUnitsPerMeter });
  stepTimelineState(state, 0, time);
  const anchor = new Float64Array(3);
  for (let i = 0; i < instanceCount; i += 1) {
    const lane = i * 4;
    deterministicAnchor(i, instanceCount, seed, sceneUnitsPerMeter, anchor);
    const px = state.position.x + anchor[0];
    const py = state.position.y + anchor[1];
    const pz = state.position.z + anchor[2];
    writeVec4(arrays.previousPose, lane, px, py, pz, state.phaseId);
    writeVec4(arrays.currentPose, lane, px, py, pz, state.phaseId);
    writeVec4(arrays.velocityState, lane, state.velocity.x, state.velocity.y, state.velocity.z, state.eventFlags.terminalLocked ? 1 : 0);
    writeVec4(arrays.previousQuaternion, lane, state.quaternion.x, state.quaternion.y, state.quaternion.z, state.quaternion.w);
    writeVec4(arrays.currentQuaternion, lane, state.quaternion.x, state.quaternion.y, state.quaternion.z, state.quaternion.w);
    writeVec4(arrays.angularVelocity, lane, state.angularVelocity.x, state.angularVelocity.y, state.angularVelocity.z, state.spinAngle);
    writeVec4(arrays.anchorFrequency, lane, anchor[0], anchor[1], anchor[2], 0);
    writeVec4(arrays.axisPhase, lane, 0, 1, 0, 0);
    const streamSeed = i === 0 ? seed >>> 0 : hashUint(seed ^ i);
    writeVec4(arrays.seedFlags, lane, streamSeed, 3, 0, 0);
  }
  return arrays;
}

function attributeBytes(attribute) {
  return attribute.array.byteLength;
}

function arraysFromBuffers(buffers) {
  return {
    previousPose: buffers.previousPose.array,
    currentPose: buffers.currentPose.array,
    velocityState: buffers.velocityState.array,
    previousQuaternion: buffers.previousQuaternion.array,
    currentQuaternion: buffers.currentQuaternion.array,
    angularVelocity: buffers.angularVelocity.array,
    anchorFrequency: buffers.anchorFrequency.array,
    axisPhase: buffers.axisPhase.array,
    seedFlags: buffers.seedFlags.array,
  };
}

export function createInstanceMotionBuffers(instanceCount, options = {}) {
  if (!Number.isInteger(instanceCount) || instanceCount <= 0) throw new RangeError("instanceCount must be a positive integer");
  const arrays = {
    previousPose: new Float32Array(instanceCount * 4),
    currentPose: new Float32Array(instanceCount * 4),
    velocityState: new Float32Array(instanceCount * 4),
    previousQuaternion: new Float32Array(instanceCount * 4),
    currentQuaternion: new Float32Array(instanceCount * 4),
    angularVelocity: new Float32Array(instanceCount * 4),
    anchorFrequency: new Float32Array(instanceCount * 4),
    axisPhase: new Float32Array(instanceCount * 4),
    seedFlags: new Uint32Array(instanceCount * 4),
  };
  fillInstanceMotionArrays(arrays, instanceCount, options);
  const buffers = {
    instanceCount,
    previousPose: new StorageInstancedBufferAttribute(arrays.previousPose, 4),
    currentPose: new StorageInstancedBufferAttribute(arrays.currentPose, 4),
    velocityState: new StorageInstancedBufferAttribute(arrays.velocityState, 4),
    previousQuaternion: new StorageInstancedBufferAttribute(arrays.previousQuaternion, 4),
    currentQuaternion: new StorageInstancedBufferAttribute(arrays.currentQuaternion, 4),
    angularVelocity: new StorageInstancedBufferAttribute(arrays.angularVelocity, 4),
    anchorFrequency: new StorageBufferAttribute(arrays.anchorFrequency, 4),
    axisPhase: new StorageBufferAttribute(arrays.axisPhase, 4),
    seedFlags: new StorageBufferAttribute(arrays.seedFlags, 4),
    dispatchCount: 0,
  };
  buffers.storageBytes = STORAGE_KEYS.reduce((sum, key) => sum + attributeBytes(buffers[key]), 0);
  if (buffers.storageBytes !== instanceCount * MOTION_STORAGE_LAYOUT.storageBytesPerInstance) {
    throw new Error(`motion storage inventory mismatch: ${buffers.storageBytes}`);
  }
  return buffers;
}

function smoothRangeNode(start, end, time) {
  const x = time.sub(start).div(end - start).clamp(0, 1);
  return x.mul(x).mul(float(3).sub(x.mul(2)));
}

function smoothRangeDerivativeNode(start, end, time) {
  const x = time.sub(start).div(end - start).clamp(0, 1);
  const derivative = x.mul(float(1).sub(x)).mul(6 / (end - start));
  return time.greaterThan(start).and(time.lessThan(end)).select(derivative, float(0));
}

function quaternionMultiplyNode(a, b) {
  return vec4(
    a.w.mul(b.x).add(a.x.mul(b.w)).add(a.y.mul(b.z)).sub(a.z.mul(b.y)),
    a.w.mul(b.y).sub(a.x.mul(b.z)).add(a.y.mul(b.w)).add(a.z.mul(b.x)),
    a.w.mul(b.z).add(a.x.mul(b.y)).sub(a.y.mul(b.x)).add(a.z.mul(b.w)),
    a.w.mul(b.w).sub(a.x.mul(b.x)).sub(a.y.mul(b.y)).sub(a.z.mul(b.z)),
  ).normalize();
}

function integratedSpinAngleNode(time) {
  const x = time.sub(8).div(2).clamp(0, 1);
  const integral = x.sub(x.pow(3)).add(x.pow(4).mul(0.5));
  return time.lessThanEqual(8).select(time.max(0).mul(3.15), float(8).add(integral.mul(2)).mul(3.15));
}

function dockingNodeState(time, scale) {
  const approach = smoothRangeNode(0, 6, time);
  const approachRate = smoothRangeDerivativeNode(0, 6, time);
  const capture = smoothRangeNode(6, 8, time);
  const captureRate = smoothRangeDerivativeNode(6, 8, time);
  const spinDown = smoothRangeNode(8, 10, time);
  const startParallel = scale.mul(-4100);
  const physicalRadial = Math.hypot(350, 200);
  const startRadial = scale.mul(physicalRadial);
  const radial = startRadial.mul(float(1).sub(approach)).mul(float(1).sub(capture));
  const radialRate = startRadial.mul(
    approachRate.negate().mul(float(1).sub(capture)).sub(float(1).sub(approach).mul(captureRate)),
  );
  const captureOffset = scale.mul(80);
  const axial = startParallel.mul(float(1).sub(approach)).add(captureOffset.mul(float(1).sub(capture)));
  const axialRate = startParallel.negate().mul(approachRate).sub(captureOffset.mul(captureRate));
  const radialDirection = vec3(350 / physicalRadial, 200 / physicalRadial, 0);
  const dockAxis = vec3(0, 0, -1);
  const position = dockAxis.mul(axial).add(radialDirection.mul(radial));
  const velocity = dockAxis.mul(axialRate).add(radialDirection.mul(radialRate));
  const spinAngle = integratedSpinAngleNode(time);
  const half = spinAngle.mul(0.5);
  const rootHalf = Math.SQRT1_2;
  const rollingQuaternion = vec4(cos(half).mul(rootHalf), sin(half).negate().mul(rootHalf), sin(half).negate().mul(rootHalf), cos(half).mul(rootHalf));
  const terminalHalf = 3.15 * 9 * 0.5;
  const terminalQuaternion = vec4(Math.cos(terminalHalf) * rootHalf, -Math.sin(terminalHalf) * rootHalf, -Math.sin(terminalHalf) * rootHalf, Math.cos(terminalHalf) * rootHalf);
  const terminal = time.greaterThanEqual(10);
  return {
    position: terminal.select(vec3(0), position),
    velocity: terminal.select(vec3(0), velocity),
    quaternion: terminal.select(terminalQuaternion, rollingQuaternion),
    angularVelocity: terminal.select(vec3(0), dockAxis.mul(float(3.15).mul(float(1).sub(spinDown)))),
    spinAngle,
    phase: time.lessThan(6).select(float(0), time.lessThan(8).select(float(1), time.lessThan(10).select(float(2), float(3)))),
    terminal,
  };
}

function launchNodeState(time, scale) {
  const t = time.min(24);
  const slowDuration = 5;
  const accelDuration = 11;
  const decelDuration = 8;
  const slowDistance = 0.00035;
  const slowSpeed = slowDistance / slowDuration;
  const remaining = 1 - slowDistance;
  const acceleration = (remaining - slowSpeed * (accelDuration + 0.5 * decelDuration)) /
    (0.5 * accelDuration * (accelDuration + decelDuration));
  const peakSpeed = slowSpeed + acceleration * accelDuration;
  const deceleration = peakSpeed / decelDuration;
  const accelTime = t.sub(slowDuration);
  const decelTime = t.sub(slowDuration + accelDuration).clamp(0, decelDuration);
  const slowDistanceNode = t.mul(slowSpeed);
  const accelDistanceNode = float(slowDistance).add(accelTime.mul(slowSpeed)).add(accelTime.mul(accelTime).mul(0.5 * acceleration));
  const acceleratedDistance = slowSpeed * accelDuration + 0.5 * acceleration * accelDuration * accelDuration;
  const decelDistanceNode = float(slowDistance + acceleratedDistance).add(decelTime.mul(peakSpeed)).sub(decelTime.mul(decelTime).mul(0.5 * deceleration));
  const distance = t.lessThanEqual(slowDuration).select(slowDistanceNode, t.lessThanEqual(slowDuration + accelDuration).select(accelDistanceNode, decelDistanceNode));
  const speed = t.lessThanEqual(slowDuration).select(float(slowSpeed), t.lessThanEqual(slowDuration + accelDuration).select(float(slowSpeed).add(accelTime.mul(acceleration)), float(peakSpeed).sub(decelTime.mul(deceleration)).max(0)));
  const progress = distance.clamp(0, 1);
  const planetRadius = scale.mul(6_371_000);
  const targetAltitude = scale.mul(420_000);
  const maxGroundArc = scale.mul(2_200_000);
  const maxCrossrange = scale.mul(26_000);
  const altitude = progress.mul(targetAltitude);
  const altitudeRate = speed.mul(targetAltitude);
  const blend = smoothRangeNode(1, 24, time);
  const blendRate = smoothRangeDerivativeNode(1, 24, time);
  const progressPower = progress.max(0).pow(1.22);
  const progressDerivative = progress.greaterThan(0).select(progress.pow(0.22).mul(speed).mul(1.22), float(0));
  const groundArc = progressPower.mul(maxGroundArc).mul(blend);
  const groundArcRate = maxGroundArc.mul(progressDerivative.mul(blend).add(progressPower.mul(blendRate)));
  const arcAngle = groundArc.div(planetRadius);
  const arcRate = groundArcRate.div(planetRadius);
  const radial = vec3(0, cos(arcAngle), sin(arcAngle).negate());
  const tangent = vec3(0, sin(arcAngle).negate(), cos(arcAngle).negate());
  const radius = planetRadius.add(altitude);
  const position = radial.mul(radius).add(vec3(maxCrossrange.mul(progress), 0, 0));
  const velocity = radial.mul(altitudeRate).add(tangent.mul(radius.mul(arcRate))).add(vec3(maxCrossrange.mul(speed), 0, 0));
  const velocityLengthSq = velocity.dot(velocity);
  const normalizedVelocity = velocity.div(velocityLengthSq.max(1e-12).sqrt());
  const flightDirection = velocityLengthSq.lessThan(1e-8).select(radial, normalizedVelocity);
  const base = vec4(flightDirection.z, 0, flightDirection.x.negate(), float(1).add(flightDirection.y)).normalize();
  const rollAngle = sin(time.mul(2.5)).mul(0.008);
  const rollHalf = rollAngle.mul(0.5);
  const roll = vec4(flightDirection.mul(sin(rollHalf)), cos(rollHalf));
  return {
    position,
    velocity,
    quaternion: quaternionMultiplyNode(roll, base),
    angularVelocity: flightDirection.mul(cos(time.mul(2.5)).mul(0.02)),
    spinAngle: float(0),
    phase: time.lessThan(24).select(float(0), float(1)),
    terminal: time.greaterThanEqual(24),
  };
}

function debrisNodeState(time, scale) {
  const localTime = time.sub(2).max(0);
  const basePosition = vec3(scale.mul(1000), 0, 0);
  const velocity = vec3(scale.mul(3000), scale.mul(-6300), scale.mul(-1000));
  const movingPosition = basePosition.add(velocity.mul(localTime));
  const angle = localTime.mul(0.252);
  const quaternion = vec4(0, 0, sin(angle.mul(0.5)).negate(), cos(angle.mul(0.5)));
  const released = time.greaterThanEqual(2);
  return {
    position: released.select(movingPosition, basePosition),
    velocity: released.select(velocity, vec3(0)),
    quaternion: released.select(quaternion, vec4(0, 0, 0, 1)),
    angularVelocity: released.select(vec3(0, 0, -0.252), vec3(0)),
    spinAngle: released.select(angle, float(0)),
    phase: released.select(float(1), float(0)),
    terminal: float(0).greaterThan(1),
  };
}

function timelineNodeState(scenario, time, scale) {
  if (scenario === "launch-and-staging") return launchNodeState(time, scale);
  if (scenario === "debris-release") return debrisNodeState(time, scale);
  return dockingNodeState(time, scale);
}

export function createGpuInstanceMotionPlan({
  instanceCount = 1024,
  scenario = "spin-docking",
  sceneUnitsPerMeter = 0.001,
  seed = 20260704,
} = {}) {
  const canonicalScenario = timelineScenario(scenario);
  const buffers = createInstanceMotionBuffers(instanceCount, { scenario: canonicalScenario, sceneUnitsPerMeter, seed });
  const nodes = {
    previousPose: storage(buffers.previousPose, "vec4", instanceCount),
    currentPose: storage(buffers.currentPose, "vec4", instanceCount),
    velocity: storage(buffers.velocityState, "vec4", instanceCount),
    previousQuaternion: storage(buffers.previousQuaternion, "vec4", instanceCount),
    currentQuaternion: storage(buffers.currentQuaternion, "vec4", instanceCount),
    angularVelocity: storage(buffers.angularVelocity, "vec4", instanceCount),
    anchor: storage(buffers.anchorFrequency, "vec4", instanceCount),
    axisPhase: storage(buffers.axisPhase, "vec4", instanceCount),
    seedFlags: storage(buffers.seedFlags, "uvec4", instanceCount),
  };
  const fixedStep = uniform(1 / 120);
  const simulationTime = uniform(0);
  const alpha = uniform(0);
  const initializeState = uniform(0);
  const sceneUnits = uniform(sceneUnitsPerMeter);

  const currentProjectionValue = new Matrix4();
  const previousProjectionValue = new Matrix4();
  const currentViewValue = new Matrix4();
  const previousViewValue = new Matrix4();
  const currentModelValue = new Matrix4();
  const previousModelValue = new Matrix4();
  const currentProjection = uniform(currentProjectionValue).setName("motion:current-projection");
  const previousProjection = uniform(previousProjectionValue).setName("motion:previous-projection");
  const currentView = uniform(currentViewValue).setName("motion:current-view");
  const previousView = uniform(previousViewValue).setName("motion:previous-view");
  const currentModel = uniform(currentModelValue).setName("motion:current-model");
  const previousModel = uniform(previousModelValue).setName("motion:previous-model");
  let currentSeed = seed >>> 0;
  let disposed = false;

  const integrateInstanceMotion = Fn(() => {
    const i = instanceIndex;
    const current = nodes.currentPose.element(i);
    const currentQ = nodes.currentQuaternion.element(i);
    const anchor = nodes.anchor.element(i);
    const state = timelineNodeState(canonicalScenario, simulationTime, sceneUnits);
    const nextPosition = state.position.add(anchor.xyz);
    const initializing = initializeState.greaterThan(0.5);
    nodes.previousPose.element(i).assign(initializing.select(vec4(nextPosition, state.phase), current));
    nodes.currentPose.element(i).assign(vec4(nextPosition, state.phase));
    nodes.velocity.element(i).assign(vec4(state.velocity, state.terminal.select(float(1), float(0))));
    nodes.previousQuaternion.element(i).assign(initializing.select(state.quaternion, currentQ));
    nodes.currentQuaternion.element(i).assign(state.quaternion);
    nodes.angularVelocity.element(i).assign(vec4(state.angularVelocity, state.spinAngle));
  });

  const computeStep = integrateInstanceMotion()
    .compute(instanceCount, [GPU_MOTION_COMPUTE_CONTRACT.workgroupSize])
    .setName(`motion:${canonicalScenario}:previous-current-transform`);

  function requireLive() {
    if (disposed) throw new Error("motion plan is disposed");
  }

  function interpolatedTransformNodes() {
    const previousPosition = nodes.previousPose.element(instanceIndex).xyz;
    const currentPosition = nodes.currentPose.element(instanceIndex).xyz;
    const previousQ = nodes.previousQuaternion.element(instanceIndex);
    const currentQ = nodes.currentQuaternion.element(instanceIndex);
    const q = mix(previousQ, currentQ, alpha).normalize();
    const local = positionGeometry;
    const rotated = local.add(cross(q.xyz, cross(q.xyz, local).add(local.mul(q.w))).mul(2));
    return { previousPosition, currentPosition, previousQ, currentQ, q, position: rotated.add(mix(previousPosition, currentPosition, alpha)) };
  }

  function createInterpolatedPositionNode() {
    return interpolatedTransformNodes().position;
  }

  function createVelocityNdcNode() {
    const transform = interpolatedTransformNodes();
    const previousQ = transform.previousQ.normalize();
    const currentQ = transform.currentQ.normalize();
    const previousRotated = positionGeometry.add(cross(previousQ.xyz, cross(previousQ.xyz, positionGeometry).add(positionGeometry.mul(previousQ.w))).mul(2));
    const currentRotated = positionGeometry.add(cross(currentQ.xyz, cross(currentQ.xyz, positionGeometry).add(positionGeometry.mul(currentQ.w))).mul(2));
    const previousLocal = previousRotated.add(transform.previousPosition);
    const currentLocal = currentRotated.add(transform.currentPosition);
    const currentClip = currentProjection.mul(currentView).mul(currentModel).mul(vec4(currentLocal, 1));
    const previousClip = previousProjection.mul(previousView).mul(previousModel).mul(vec4(previousLocal, 1));
    return currentClip.xy.div(currentClip.w).sub(previousClip.xy.div(previousClip.w));
  }

  function setPresentationAlpha(value) {
    requireLive();
    alpha.value = Math.min(Math.max(value, 0), 1);
  }

  function dispatchFixedStep(renderer, dt, time) {
    requireLive();
    if (!renderer?.compute) throw new TypeError("motion dispatch requires a renderer.compute implementation");
    fixedStep.value = dt;
    simulationTime.value = time;
    initializeState.value = 0;
    buffers.dispatchCount += 1;
    return renderer.compute(computeStep);
  }

  function markStorageForUpload() {
    for (const key of STORAGE_KEYS) buffers[key].needsUpdate = true;
  }

  function resetState({ nextSeed = currentSeed, time = 0 } = {}) {
    requireLive();
    currentSeed = nextSeed >>> 0;
    fillInstanceMotionArrays(arraysFromBuffers(buffers), instanceCount, {
      scenario: canonicalScenario,
      sceneUnitsPerMeter,
      seed: currentSeed,
      time,
    });
    markStorageForUpload();
    buffers.dispatchCount = 0;
    alpha.value = 0;
    simulationTime.value = time;
    return currentSeed;
  }

  function seek(renderer, seconds) {
    requireLive();
    if (!Number.isFinite(seconds) || seconds < 0) throw new RangeError("GPU seek time must be finite and nonnegative");
    if (!renderer?.compute) throw new TypeError("GPU seek requires renderer.compute");
    simulationTime.value = seconds;
    fixedStep.value = 0;
    initializeState.value = 1;
    buffers.dispatchCount += 1;
    const result = renderer.compute(computeStep);
    initializeState.value = 0;
    alpha.value = 0;
    return result;
  }

  function setSeed(nextSeed, renderer = null) {
    resetState({ nextSeed, time: 0 });
    if (renderer) seek(renderer, 0);
    return currentSeed;
  }

  function beginFrameMatrices() {
    previousProjectionValue.copy(currentProjectionValue);
    previousViewValue.copy(currentViewValue);
    previousModelValue.copy(currentModelValue);
  }

  function captureFrameMatrices(camera, object) {
    if (camera?.isCamera !== true || object?.isObject3D !== true) throw new TypeError("motion frame matrices require a camera and Object3D");
    camera.updateMatrixWorld(true);
    object.updateWorldMatrix(true, false);
    currentProjectionValue.copy(camera.projectionMatrix);
    currentViewValue.copy(camera.matrixWorldInverse);
    currentModelValue.copy(object.matrixWorld);
  }

  function primeFrameMatrices(camera, object) {
    captureFrameMatrices(camera, object);
    previousProjectionValue.copy(currentProjectionValue);
    previousViewValue.copy(currentViewValue);
    previousModelValue.copy(currentModelValue);
  }

  async function readback(renderer, count = Math.min(instanceCount, 16)) {
    requireLive();
    const byteCount = count * 4 * Float32Array.BYTES_PER_ELEMENT;
    const [previous, current, previousQuaternionBuffer, currentQuaternionBuffer, velocity] = await Promise.all([
      renderer.getArrayBufferAsync(buffers.previousPose, null, 0, byteCount),
      renderer.getArrayBufferAsync(buffers.currentPose, null, 0, byteCount),
      renderer.getArrayBufferAsync(buffers.previousQuaternion, null, 0, byteCount),
      renderer.getArrayBufferAsync(buffers.currentQuaternion, null, 0, byteCount),
      renderer.getArrayBufferAsync(buffers.velocityState, null, 0, byteCount),
    ]);
    return {
      count,
      previousPose: new Float32Array(previous),
      currentPose: new Float32Array(current),
      previousQuaternion: new Float32Array(previousQuaternionBuffer),
      currentQuaternion: new Float32Array(currentQuaternionBuffer),
      velocity: new Float32Array(velocity),
    };
  }

  function dispose() {
    if (disposed) return false;
    disposed = true;
    computeStep.dispose?.();
    for (const key of STORAGE_KEYS) buffers[key].dispose?.();
    return true;
  }

  return {
    buffers,
    nodes,
    fixedStep,
    simulationTime,
    alpha,
    initializeState,
    computeStep,
    integrateInstanceMotion,
    createInterpolatedPositionNode,
    createVelocityNdcNode,
    setPresentationAlpha,
    dispatchFixedStep,
    resetState,
    seek,
    setSeed,
    beginFrameMatrices,
    captureFrameMatrices,
    primeFrameMatrices,
    readback,
    dispose,
    dispatchPolicy: GPU_MOTION_COMPUTE_CONTRACT.dispatchOwner,
    renderConsumes: ["previousPose", "currentPose", "previousQuaternion", "currentQuaternion", "alpha"],
    storageBytes: buffers.storageBytes,
    scenario: canonicalScenario,
    sceneUnitsPerMeter,
    storageAttributeCount: STORAGE_KEYS.length,
    frameMatrices: {
      currentProjection: currentProjectionValue,
      previousProjection: previousProjectionValue,
      currentView: currentViewValue,
      previousView: previousViewValue,
      currentModel: currentModelValue,
      previousModel: previousModelValue,
    },
  };
}

export function createInstanceMotionMirror({
  instanceCount = 64,
  scenario = "spin-docking",
  sceneUnitsPerMeter = 0.001,
  seed = 20260704,
} = {}) {
  const arrays = {
    previousPose: new Float32Array(instanceCount * 4), currentPose: new Float32Array(instanceCount * 4), velocityState: new Float32Array(instanceCount * 4),
    previousQuaternion: new Float32Array(instanceCount * 4), currentQuaternion: new Float32Array(instanceCount * 4), angularVelocity: new Float32Array(instanceCount * 4),
    anchorFrequency: new Float32Array(instanceCount * 4), axisPhase: new Float32Array(instanceCount * 4), seedFlags: new Uint32Array(instanceCount * 4),
  };
  fillInstanceMotionArrays(arrays, instanceCount, { scenario, sceneUnitsPerMeter, seed });
  return {
    instanceCount,
    scenario: timelineScenario(scenario),
    sceneUnitsPerMeter,
    seed: seed >>> 0,
    _state: createMotionState({ seed, scenario: timelineScenario(scenario), sceneUnitsPerMeter }),
    ...arrays,
  };
}

export function stepInstanceMotionMirror(mirror, fixedStep, simulationTime) {
  stepTimelineState(mirror._state, fixedStep, simulationTime);
  const state = mirror._state;
  for (let i = 0; i < mirror.instanceCount; i += 1) {
    const lane = i * 4;
    mirror.previousPose[lane] = mirror.currentPose[lane];
    mirror.previousPose[lane + 1] = mirror.currentPose[lane + 1];
    mirror.previousPose[lane + 2] = mirror.currentPose[lane + 2];
    mirror.previousPose[lane + 3] = mirror.currentPose[lane + 3];
    mirror.previousQuaternion[lane] = mirror.currentQuaternion[lane];
    mirror.previousQuaternion[lane + 1] = mirror.currentQuaternion[lane + 1];
    mirror.previousQuaternion[lane + 2] = mirror.currentQuaternion[lane + 2];
    mirror.previousQuaternion[lane + 3] = mirror.currentQuaternion[lane + 3];
    writeVec4(mirror.currentPose, lane,
      state.position.x + mirror.anchorFrequency[lane],
      state.position.y + mirror.anchorFrequency[lane + 1],
      state.position.z + mirror.anchorFrequency[lane + 2],
      state.phaseId);
    writeVec4(mirror.velocityState, lane, state.velocity.x, state.velocity.y, state.velocity.z, state.eventFlags.terminalLocked ? 1 : 0);
    writeVec4(mirror.currentQuaternion, lane, state.quaternion.x, state.quaternion.y, state.quaternion.z, state.quaternion.w);
    writeVec4(mirror.angularVelocity, lane, state.angularVelocity.x, state.angularVelocity.y, state.angularVelocity.z, state.spinAngle);
  }
  return mirror;
}

export function seekInstanceMotionMirror({ instanceCount = 64, fixedStep = 1 / 120, steps = 0, scenario = "spin-docking", sceneUnitsPerMeter = 0.001, seed = 20260704 } = {}) {
  const mirror = createInstanceMotionMirror({ instanceCount, scenario, sceneUnitsPerMeter, seed });
  for (let step = 0; step < steps; step += 1) stepInstanceMotionMirror(mirror, fixedStep, (step + 1) * fixedStep);
  return mirror;
}

export function maxPoseDifference(a, b) {
  let max = 0;
  for (const key of ["previousPose", "currentPose", "velocityState", "previousQuaternion", "currentQuaternion", "angularVelocity"]) {
    for (let i = 0; i < a[key].length; i += 1) max = Math.max(max, Math.abs(a[key][i] - b[key][i]));
  }
  return max;
}
