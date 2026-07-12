import { Matrix4, StorageBufferAttribute, StorageInstancedBufferAttribute } from "three/webgpu";
import {
  Fn,
  cos,
  cross,
  float,
  instanceIndex,
  positionGeometry,
  sin,
  storage,
  uniform,
  vec3,
  vec4,
} from "three/tsl";

import {
  MOTION_EVENT_FLAG_BITS,
  MOTION_SCENARIOS,
  STORAGE_VERSION,
  createMotionState,
  hashUint,
  motionEventBitmask,
  resetMotionState,
  stepTimelineState,
} from "./timeline.js";

export const MOTION_STORAGE_LAYOUT = Object.freeze({
  version: STORAGE_VERSION,
  stateSlots: Object.freeze({
    previous: "previousPose + previousQuaternion",
    current: "currentPose + currentQuaternion + velocityFlags + angularVelocitySpin",
    previousPresented: "previousPresentedPose + previousPresentedQuaternion",
    currentPresented: "currentPresentedPose + currentPresentedQuaternion",
    versionPolicy: "monotonic state version; seek/reset aliases previous and current to one exact state",
  }),
  dynamicState: Object.freeze({
    fields: [
      "previousPositionPhase",
      "currentPositionPhase",
      "velocityFlags",
      "previousQuaternion",
      "currentQuaternion",
      "angularVelocitySpin",
      "previousPresentedPositionPhase",
      "currentPresentedPositionPhase",
      "previousPresentedQuaternion",
      "currentPresentedQuaternion",
    ],
    bytesPerInstance: 160,
    slotCount: 2,
    presentationSlotCount: 2,
  }),
  staticState: Object.freeze({
    fields: ["anchorFrequency", "axisPhase", "seedStreamFlags"],
    bytesPerInstance: 48,
  }),
  storageBytesPerInstance: 208,
});

export const GPU_MOTION_COMPUTE_CONTRACT = Object.freeze({
  dispatchOwner: "fixed-step accumulator or explicit GPU seek",
  renderInterpolation: "vertex path reads previous/current position and quaternion with alpha",
  workgroupSize: 64,
  parityLane: 0,
  parityMeaning: "lane zero is the same analytic launch/docking/debris timeline as the CPU core",
});

export const MOTION_STORAGE_FLAG_BITS = Object.freeze({
  ...MOTION_EVENT_FLAG_BITS,
  originMetadataBound: 16,
});

export function requireWgslIdentifier(value, label = "WGSL identifier") {
  if (typeof value !== "string" || !/^[A-Za-z_][A-Za-z0-9_]*$/.test(value)) {
    throw new RangeError(`${label} must contain only WGSL identifier characters`);
  }
  return value;
}

export const MOTION_SHADER_IDENTIFIERS = Object.freeze({
  fixedStep: requireWgslIdentifier("motion_fixed_step"),
  simulationTime: requireWgslIdentifier("motion_simulation_time"),
  presentationAlpha: requireWgslIdentifier("motion_presentation_alpha"),
  initializeState: requireWgslIdentifier("motion_initialize_state"),
  initializePresentation: requireWgslIdentifier("motion_initialize_presentation"),
  sceneUnitsPerMeter: requireWgslIdentifier("motion_scene_units_per_meter"),
  currentProjection: requireWgslIdentifier("motion_current_projection"),
  previousProjection: requireWgslIdentifier("motion_previous_projection"),
  currentView: requireWgslIdentifier("motion_current_view"),
  previousView: requireWgslIdentifier("motion_previous_view"),
  currentModel: requireWgslIdentifier("motion_current_model"),
  previousModel: requireWgslIdentifier("motion_previous_model"),
});

export function motionComputeShaderIdentifier(scenario) {
  const canonicalScenario = timelineScenario(scenario);
  return requireWgslIdentifier(
    `motion_${canonicalScenario.replaceAll("-", "_")}_previous_current_transform`,
    "motion compute shader identifier",
  );
}

export function motionPresentationShaderIdentifier(scenario) {
  const canonicalScenario = timelineScenario(scenario);
  return requireWgslIdentifier(
    `motion_${canonicalScenario.replaceAll("-", "_")}_prepare_presented_transform`,
    "motion presentation shader identifier",
  );
}

export function motionStaticMetadataShaderIdentifier(scenario) {
  const canonicalScenario = timelineScenario(scenario);
  return requireWgslIdentifier(
    `motion_${canonicalScenario.replaceAll("-", "_")}_bind_static_metadata`,
    "motion static-metadata shader identifier",
  );
}

const STORAGE_KEYS = Object.freeze([
  "previousPose",
  "currentPose",
  "velocityState",
  "previousQuaternion",
  "currentQuaternion",
  "angularVelocity",
  "previousPresentedPose",
  "currentPresentedPose",
  "previousPresentedQuaternion",
  "currentPresentedQuaternion",
  "anchorFrequency",
  "axisPhase",
  "seedFlags",
]);

const STORAGE_RESOURCE_GRAPH = Object.freeze({
  previousPose: Object.freeze({ format: "vec4<f32>", producers: ["motion-state-compute"], consumers: ["captureStorage"] }),
  currentPose: Object.freeze({ format: "vec4<f32>", producers: ["motion-state-compute"], consumers: ["captureStorage"] }),
  velocityState: Object.freeze({ format: "vec4<f32>", producers: ["motion-state-compute"], consumers: ["captureStorage"] }),
  previousQuaternion: Object.freeze({ format: "vec4<f32>", producers: ["motion-state-compute"], consumers: ["captureStorage"] }),
  currentQuaternion: Object.freeze({ format: "vec4<f32>", producers: ["motion-state-compute"], consumers: ["captureStorage"] }),
  angularVelocity: Object.freeze({ format: "vec4<f32>", producers: ["motion-state-compute"], consumers: ["captureStorage"] }),
  previousPresentedPose: Object.freeze({ format: "vec4<f32>", producers: ["cpu-seeded-initialization", "motion-presentation-compute"], consumers: ["motion-vertex", "motion-velocity-mrt", "captureStorage"] }),
  currentPresentedPose: Object.freeze({ format: "vec4<f32>", producers: ["cpu-seeded-initialization", "motion-presentation-compute"], consumers: ["motion-vertex", "motion-velocity-mrt", "captureStorage"] }),
  previousPresentedQuaternion: Object.freeze({ format: "vec4<f32>", producers: ["cpu-seeded-initialization", "motion-presentation-compute"], consumers: ["motion-velocity-mrt", "captureStorage"] }),
  currentPresentedQuaternion: Object.freeze({ format: "vec4<f32>", producers: ["cpu-seeded-initialization", "motion-presentation-compute"], consumers: ["motion-vertex", "motion-velocity-mrt", "captureStorage"] }),
  anchorFrequency: Object.freeze({ format: "vec4<f32>", producers: ["cpu-seeded-initialization"], consumers: ["motion-state-compute", "motion-presentation-compute", "captureStorage"] }),
  axisPhase: Object.freeze({ format: "vec4<f32>", producers: ["cpu-seeded-initialization"], consumers: ["motion-state-compute", "motion-presentation-compute", "captureStorage"] }),
  seedFlags: Object.freeze({ format: "vec4<u32>", producers: ["cpu-seeded-initialization"], consumers: ["motion-static-metadata-compute", "captureStorage"] }),
});

export function chooseMotionRoute({ actorCount, mixedGeometry = false }) {
  if (actorCount < 200) return "<200 Object3D";
  if (actorCount <= 10000) return mixedGeometry ? "200-10k BatchedMesh" : "200-10k InstancedMesh";
  return "10k+ StorageInstancedBufferAttribute";
}

function timelineScenario(scenario) {
  if (!MOTION_SCENARIOS.includes(scenario)) {
    throw new RangeError(`unknown motion scenario: ${scenario}`);
  }
  return scenario;
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
  // Keep the authored storage actors outside the hero mesh silhouette so seed
  // changes remain observable in final-output evidence, not only readback.
  const radiusMeters = 900 + ((hash >>> 16) & 0xff) * 6;
  const verticalMeters = (((hash >>> 24) & 0xff) / 255 - 0.5) * 3000;
  const stratification = 0.65 + 0.35 * (index / Math.max(instanceCount - 1, 1));
  out[0] = Math.cos(angle) * radiusMeters * stratification;
  out[1] = verticalMeters;
  out[2] = Math.sin(angle) * radiusMeters * stratification;
  out[0] *= scale;
  out[1] *= scale;
  out[2] *= scale;
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
    writeVec4(
      arrays.velocityState,
      lane,
      state.velocity.x,
      state.velocity.y,
      state.velocity.z,
      motionEventBitmask(state.eventFlags) | MOTION_STORAGE_FLAG_BITS.originMetadataBound,
    );
    writeVec4(arrays.previousQuaternion, lane, state.quaternion.x, state.quaternion.y, state.quaternion.z, state.quaternion.w);
    writeVec4(arrays.currentQuaternion, lane, state.quaternion.x, state.quaternion.y, state.quaternion.z, state.quaternion.w);
    writeVec4(arrays.angularVelocity, lane, state.angularVelocity.x, state.angularVelocity.y, state.angularVelocity.z, state.spinAngle);
    writeVec4(arrays.previousPresentedPose, lane, px, py, pz, state.phaseId);
    writeVec4(arrays.currentPresentedPose, lane, px, py, pz, state.phaseId);
    writeVec4(arrays.previousPresentedQuaternion, lane, state.quaternion.x, state.quaternion.y, state.quaternion.z, state.quaternion.w);
    writeVec4(arrays.currentPresentedQuaternion, lane, state.quaternion.x, state.quaternion.y, state.quaternion.z, state.quaternion.w);
    writeVec4(arrays.anchorFrequency, lane, anchor[0], anchor[1], anchor[2], 0);
    writeVec4(
      arrays.axisPhase,
      lane,
      i === 0 ? 0 : Math.cos(angleForIndex(i, instanceCount)),
      1,
      i === 0 ? 0 : Math.sin(angleForIndex(i, instanceCount)),
      i === 0 ? 0 : (i / instanceCount) * Math.PI * 2,
    );
    const streamSeed = i === 0 ? seed >>> 0 : hashUint(seed ^ i);
    writeVec4(arrays.seedFlags, lane, streamSeed, 3, 0, 1);
  }
  return arrays;
}

function angleForIndex(index, instanceCount) {
  return (index / Math.max(instanceCount, 1)) * Math.PI * 2;
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
    previousPresentedPose: buffers.previousPresentedPose.array,
    currentPresentedPose: buffers.currentPresentedPose.array,
    previousPresentedQuaternion: buffers.previousPresentedQuaternion.array,
    currentPresentedQuaternion: buffers.currentPresentedQuaternion.array,
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
    previousPresentedPose: new Float32Array(instanceCount * 4),
    currentPresentedPose: new Float32Array(instanceCount * 4),
    previousPresentedQuaternion: new Float32Array(instanceCount * 4),
    currentPresentedQuaternion: new Float32Array(instanceCount * 4),
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
    previousPresentedPose: new StorageInstancedBufferAttribute(arrays.previousPresentedPose, 4),
    currentPresentedPose: new StorageInstancedBufferAttribute(arrays.currentPresentedPose, 4),
    previousPresentedQuaternion: new StorageInstancedBufferAttribute(arrays.previousPresentedQuaternion, 4),
    currentPresentedQuaternion: new StorageInstancedBufferAttribute(arrays.currentPresentedQuaternion, 4),
    anchorFrequency: new StorageBufferAttribute(arrays.anchorFrequency, 4),
    axisPhase: new StorageBufferAttribute(arrays.axisPhase, 4),
    seedFlags: new StorageBufferAttribute(arrays.seedFlags, 4),
    dispatchCount: 0,
    resourceGeneration: 1,
    stateVersionSequence: 1,
    previousStateVersion: 1,
    currentStateVersion: 1,
    readbackConfirmedStateVersion: null,
    readbackConfirmedDispatchCount: null,
    readbackCount: 0,
    presentationDispatchCount: 0,
    staticMetadataDispatchCount: 0,
    presentationVersionSequence: 1,
    previousPresentationVersion: 1,
    currentPresentationVersion: 1,
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

function axisAngleQuaternionNode(axis, radians) {
  const normalizedAxis = axis.normalize();
  const half = radians.mul(0.5);
  return vec4(normalizedAxis.mul(sin(half)), cos(half)).normalize();
}

function fromUnitYToDirectionSafeNode(direction) {
  const normalized = direction.normalize();
  const general = vec4(normalized.z, 0, normalized.x.negate(), float(1).add(normalized.y)).normalize();
  return normalized.y.greaterThan(0.999999).select(
    vec4(0, 0, 0, 1),
    normalized.y.lessThan(-0.999999).select(vec4(0, 0, 1, 0), general),
  );
}

function integratedSpinAngleNode(time) {
  const x = time.sub(8).div(2).clamp(0, 1);
  const integral = x.sub(x.pow(3)).add(x.pow(4).mul(0.5));
  return time.lessThanEqual(8).select(time.max(0).mul(3.15), float(8).add(integral.mul(2)).mul(3.15));
}

function stableLaunchSinCosNode(angle) {
  // The authored launch ground arc remains below 0.4 rad. An explicit odd/
  // even polynomial avoids adapter-specific relaxed sin/cos error while its
  // next omitted terms are below the storage f32 precision at that bound.
  const x2 = angle.mul(angle);
  const x4 = x2.mul(x2);
  const x6 = x4.mul(x2);
  const x8 = x4.mul(x4);
  return {
    sinValue: angle.mul(float(1).sub(x2.div(6)).add(x4.div(120)).sub(x6.div(5040))),
    cosValue: float(1).sub(x2.div(2)).add(x4.div(24)).sub(x6.div(720)).add(x8.div(40320)),
  };
}

function dockingNodeState(time, scale) {
  const approach = smoothRangeNode(0, 6, time);
  const approachRate = smoothRangeDerivativeNode(0, 6, time);
  const capture = smoothRangeNode(6, 8, time);
  const captureRate = smoothRangeDerivativeNode(6, 8, time);
  const spinDown = smoothRangeNode(8, 10, time);
  const startParallel = float(-4100);
  const physicalRadial = Math.hypot(350, 200);
  const startRadial = float(physicalRadial);
  const radial = startRadial.mul(float(1).sub(approach)).mul(float(1).sub(capture));
  const radialRate = startRadial.mul(
    approachRate.negate().mul(float(1).sub(capture)).sub(float(1).sub(approach).mul(captureRate)),
  );
  const captureOffset = float(80);
  const axial = startParallel.mul(float(1).sub(approach)).add(captureOffset.mul(float(1).sub(capture)));
  const axialRate = startParallel.negate().mul(approachRate).sub(captureOffset.mul(captureRate));
  const radialDirection = vec3(350 / physicalRadial, 200 / physicalRadial, 0);
  const dockAxis = vec3(0, 0, -1);
  const positionMeters = dockAxis.mul(axial).add(radialDirection.mul(radial));
  const velocityMetersPerSecond = dockAxis.mul(axialRate).add(radialDirection.mul(radialRate));
  const spinAngle = integratedSpinAngleNode(time);
  const half = spinAngle.mul(0.5);
  const rootHalf = Math.SQRT1_2;
  const rollingQuaternion = vec4(
    cos(half).mul(rootHalf),
    sin(half).negate().mul(rootHalf),
    sin(half).negate().mul(rootHalf),
    cos(half).mul(rootHalf),
  ).normalize();
  const terminalHalf = 3.15 * 9 * 0.5;
  const terminalQuaternion = vec4(
    Math.cos(terminalHalf) * rootHalf,
    -Math.sin(terminalHalf) * rootHalf,
    -Math.sin(terminalHalf) * rootHalf,
    Math.cos(terminalHalf) * rootHalf,
  ).normalize();
  const terminal = time.greaterThanEqual(10);
  return {
    position: terminal.select(vec3(0), positionMeters.mul(scale)),
    velocity: terminal.select(vec3(0), velocityMetersPerSecond.mul(scale)),
    quaternion: terminal.select(terminalQuaternion, rollingQuaternion),
    angularVelocity: terminal.select(vec3(0), dockAxis.mul(float(3.15).mul(float(1).sub(spinDown)))),
    spinAngle,
    phase: time.lessThan(6).select(float(0), time.lessThan(8).select(float(1), time.lessThan(10).select(float(2), float(3)))),
    terminal,
    eventFlags: terminal.select(float(MOTION_EVENT_FLAG_BITS.dockingCaptured | MOTION_EVENT_FLAG_BITS.terminalLocked),
      time.greaterThanEqual(6).select(float(MOTION_EVENT_FLAG_BITS.dockingCaptured), float(0))),
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
  // Cross the physical-to-scene boundary before the large-radius f32 math.
  // Each dimensional constant is multiplied by the one scene scale exactly
  // once; the remaining ratios and trigonometry operate in stable scene units.
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
  const { sinValue: sinArc, cosValue: cosArc } = stableLaunchSinCosNode(arcAngle);
  // WebGPU implementations may use relaxed transcendental approximations.
  // Re-normalize the analytic frame so independent sin/cos approximation
  // error cannot scale a planetary radius into hundreds of metres of drift.
  const radial = vec3(0, cosArc, sinArc.negate()).normalize();
  const tangent = vec3(0, sinArc.negate(), cosArc.negate()).normalize();
  const radius = planetRadius.add(altitude);
  const positionScene = radial.mul(radius).add(vec3(maxCrossrange.mul(progress), 0, 0));
  const velocityScenePerSecond = radial.mul(altitudeRate).add(tangent.mul(radius.mul(arcRate))).add(vec3(maxCrossrange.mul(speed), 0, 0));
  const velocityLengthSq = velocityScenePerSecond.dot(velocityScenePerSecond);
  const normalizedVelocity = velocityScenePerSecond.div(velocityLengthSq.max(1e-12).sqrt());
  const flightDirection = velocityLengthSq.lessThan(1e-8).select(radial, normalizedVelocity);
  const base = fromUnitYToDirectionSafeNode(flightDirection);
  const rollAngle = sin(time.mul(2.5)).mul(0.008);
  const rollHalf = rollAngle.mul(0.5);
  const roll = vec4(flightDirection.mul(sin(rollHalf)), cos(rollHalf));
  return {
    position: positionScene,
    velocity: velocityScenePerSecond,
    quaternion: quaternionMultiplyNode(roll, base),
    angularVelocity: flightDirection.mul(cos(time.mul(2.5)).mul(0.02)),
    spinAngle: float(0),
    phase: time.lessThan(24).select(float(0), float(1)),
    terminal: time.greaterThanEqual(24),
    eventFlags: time.greaterThanEqual(24).select(float(MOTION_EVENT_FLAG_BITS.stageDetached), float(0)),
  };
}

function debrisNodeState(time, scale) {
  const localTime = time.sub(2).max(0);
  const basePositionMeters = vec3(20, 0, 0);
  const velocityMetersPerSecond = vec3(5.8, -63, -4.2);
  const movingPositionMeters = basePositionMeters.add(velocityMetersPerSecond.mul(localTime));
  const angle = localTime.mul(0.252);
  const quaternion = vec4(0, 0, sin(angle.mul(0.5)).negate(), cos(angle.mul(0.5))).normalize();
  const released = time.greaterThanEqual(2);
  return {
    position: released.select(movingPositionMeters.mul(scale), basePositionMeters.mul(scale)),
    velocity: released.select(velocityMetersPerSecond.mul(scale), vec3(0)),
    quaternion: released.select(quaternion, vec4(0, 0, 0, 1)),
    angularVelocity: released.select(vec3(0, 0, -0.252), vec3(0)),
    spinAngle: released.select(angle, float(0)),
    phase: released.select(float(1), float(0)),
    terminal: float(0).greaterThan(1),
    eventFlags: released.select(float(MOTION_EVENT_FLAG_BITS.debrisReleased), float(0)),
  };
}

function quaternionReparentNodeState(time, scale) {
  const clampedTime = time.clamp(0, 4);
  const turnAngle = clampedTime.mul(Math.PI / 4);
  const turnRate = time.greaterThan(0).and(time.lessThan(4)).select(float(Math.PI / 4), float(0));
  const direction = vec3(sin(turnAngle), cos(turnAngle), 0);
  return {
    position: vec3(
      cos(time.mul(0.6)).mul(1800),
      sin(time.mul(0.35)).mul(500),
      sin(time.mul(0.6)).mul(1800),
    ).mul(scale),
    velocity: vec3(
      sin(time.mul(0.6)).mul(-1080),
      cos(time.mul(0.35)).mul(175),
      cos(time.mul(0.6)).mul(1080),
    ).mul(scale),
    quaternion: fromUnitYToDirectionSafeNode(direction),
    angularVelocity: vec3(0, 0, turnRate.negate()),
    spinAngle: turnAngle,
    phase: time.lessThan(4).select(float(0), float(1)),
    terminal: float(0).greaterThan(1),
    eventFlags: float(0),
  };
}

function computeStorageNodeState(time, scale) {
  const axis = vec3(1, 1, 0.25).normalize();
  return {
    position: vec3(
      sin(time.mul(0.7)).mul(2100),
      cos(time.mul(0.5)).mul(1250),
      sin(time.mul(0.3)).mul(1600),
    ).mul(scale),
    velocity: vec3(
      cos(time.mul(0.7)).mul(1470),
      sin(time.mul(0.5)).mul(-625),
      cos(time.mul(0.3)).mul(480),
    ).mul(scale),
    quaternion: axisAngleQuaternionNode(axis, time.mul(0.4)),
    angularVelocity: axis.mul(0.4),
    spinAngle: time.mul(0.4),
    phase: float(0),
    terminal: float(0).greaterThan(1),
    eventFlags: float(0),
  };
}

function interpolationVelocityNodeState(time, scale) {
  return {
    position: vec3(
      sin(time.mul(0.9)).mul(2600),
      sin(time.mul(1.4)).mul(900),
      cos(time.mul(0.9)).mul(-800),
    ).mul(scale),
    velocity: vec3(
      cos(time.mul(0.9)).mul(2340),
      cos(time.mul(1.4)).mul(1260),
      sin(time.mul(0.9)).mul(720),
    ).mul(scale),
    quaternion: axisAngleQuaternionNode(vec3(0, 1, 0), time.mul(0.7)),
    angularVelocity: vec3(0, 0.7, 0),
    spinAngle: time.mul(0.7),
    phase: float(0),
    terminal: float(0).greaterThan(1),
    eventFlags: float(0),
  };
}

function timelineNodeState(scenario, time, scale) {
  if (scenario === "launch-and-staging") return launchNodeState(time, scale);
  if (scenario === "spin-docking") return dockingNodeState(time, scale);
  if (scenario === "debris-release") return debrisNodeState(time, scale);
  if (scenario === "quaternion-and-reparent") return quaternionReparentNodeState(time, scale);
  if (scenario === "compute-storage") return computeStorageNodeState(time, scale);
  if (scenario === "interpolation-and-velocity") return interpolationVelocityNodeState(time, scale);
  throw new RangeError(`unknown motion scenario: ${scenario}`);
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
    previousPresentedPose: storage(buffers.previousPresentedPose, "vec4", instanceCount),
    currentPresentedPose: storage(buffers.currentPresentedPose, "vec4", instanceCount),
    previousPresentedQuaternion: storage(buffers.previousPresentedQuaternion, "vec4", instanceCount),
    currentPresentedQuaternion: storage(buffers.currentPresentedQuaternion, "vec4", instanceCount),
    anchor: storage(buffers.anchorFrequency, "vec4", instanceCount),
    axisPhase: storage(buffers.axisPhase, "vec4", instanceCount),
    seedFlags: storage(buffers.seedFlags, "uvec4", instanceCount),
  };
  const fixedStep = uniform(1 / 120).setName(MOTION_SHADER_IDENTIFIERS.fixedStep);
  const simulationTime = uniform(0).setName(MOTION_SHADER_IDENTIFIERS.simulationTime);
  const alpha = uniform(0).setName(MOTION_SHADER_IDENTIFIERS.presentationAlpha);
  const initializeState = uniform(0).setName(MOTION_SHADER_IDENTIFIERS.initializeState);
  const initializePresentation = uniform(0).setName(MOTION_SHADER_IDENTIFIERS.initializePresentation);
  const sceneUnits = uniform(sceneUnitsPerMeter).setName(MOTION_SHADER_IDENTIFIERS.sceneUnitsPerMeter);

  const currentProjectionValue = new Matrix4();
  const previousProjectionValue = new Matrix4();
  const currentViewValue = new Matrix4();
  const previousViewValue = new Matrix4();
  const currentModelValue = new Matrix4();
  const previousModelValue = new Matrix4();
  const currentProjection = uniform(currentProjectionValue).setName(MOTION_SHADER_IDENTIFIERS.currentProjection);
  const previousProjection = uniform(previousProjectionValue).setName(MOTION_SHADER_IDENTIFIERS.previousProjection);
  const currentView = uniform(currentViewValue).setName(MOTION_SHADER_IDENTIFIERS.currentView);
  const previousView = uniform(previousViewValue).setName(MOTION_SHADER_IDENTIFIERS.previousView);
  const currentModel = uniform(currentModelValue).setName(MOTION_SHADER_IDENTIFIERS.currentModel);
  const previousModel = uniform(previousModelValue).setName(MOTION_SHADER_IDENTIFIERS.previousModel);
  let currentSeed = seed >>> 0;
  let disposed = false;
  let rendererBinding = null;
  let rendererBindingStatus = "unbound";
  const submissionLedger = {
    initializationInstanceMatrixUploadCount: 0,
    initializationInstanceMatrixUploadBytes: 0,
    hotPathInstanceMatrixUploadCount: 0,
    hotPathInstanceMatrixUploadBytes: 0,
  };

  const integrateInstanceMotion = Fn(() => {
    const i = instanceIndex;
    const current = nodes.currentPose.element(i);
    const currentQ = nodes.currentQuaternion.element(i);
    const anchor = nodes.anchor.element(i);
    const axisPhase = nodes.axisPhase.element(i);
    const state = timelineNodeState(canonicalScenario, simulationTime, sceneUnits);
    const storageDetail = i.greaterThan(0).select(
      axisPhase.xyz.normalize().mul(sin(simulationTime.add(axisPhase.w))).mul(0.05),
      vec3(0),
    );
    const nextPosition = state.position.add(anchor.xyz).add(storageDetail);
    const initializing = initializeState.greaterThan(0.5);
    const nextPose = vec4(nextPosition, state.phase);
    nodes.previousPose.element(i).assign(initializing.select(vec4(nextPosition, state.phase), current));
    nodes.currentPose.element(i).assign(nextPose);
    nodes.velocity.element(i).assign(vec4(
      state.velocity,
      state.eventFlags.add(MOTION_STORAGE_FLAG_BITS.originMetadataBound),
    ));
    nodes.previousQuaternion.element(i).assign(initializing.select(state.quaternion, currentQ));
    nodes.currentQuaternion.element(i).assign(state.quaternion);
    nodes.angularVelocity.element(i).assign(vec4(state.angularVelocity, state.spinAngle));
  });

  const computeStep = integrateInstanceMotion()
    .compute(instanceCount, [GPU_MOTION_COMPUTE_CONTRACT.workgroupSize])
    .setName(motionComputeShaderIdentifier(canonicalScenario));

  const preparePresentedTransform = Fn(() => {
    const i = instanceIndex;
    const anchor = nodes.anchor.element(i);
    const axisPhase = nodes.axisPhase.element(i);
    const lastPresentedPose = nodes.currentPresentedPose.element(i);
    const lastPresentedQuaternion = nodes.currentPresentedQuaternion.element(i);
    const presentationTime = simulationTime.sub(fixedStep.mul(float(1).sub(alpha)));
    const state = timelineNodeState(canonicalScenario, presentationTime, sceneUnits);
    const storageDetail = i.greaterThan(0).select(
      axisPhase.xyz.normalize().mul(sin(presentationTime.add(axisPhase.w))).mul(0.05),
      vec3(0),
    );
    const candidatePose = vec4(state.position.add(anchor.xyz).add(storageDetail), state.phase);
    const candidateQuaternion = state.quaternion;
    const initializing = initializePresentation.greaterThan(0.5);
    nodes.previousPresentedPose.element(i).assign(initializing.select(candidatePose, lastPresentedPose));
    nodes.previousPresentedQuaternion.element(i).assign(initializing.select(candidateQuaternion, lastPresentedQuaternion));
    nodes.currentPresentedPose.element(i).assign(candidatePose);
    nodes.currentPresentedQuaternion.element(i).assign(candidateQuaternion);
  });

  const presentationStep = preparePresentedTransform()
    .compute(instanceCount, [GPU_MOTION_COMPUTE_CONTRACT.workgroupSize])
    .setName(motionPresentationShaderIdentifier(canonicalScenario));

  const bindStaticMetadata = Fn(() => {
    const i = instanceIndex;
    const metadata = nodes.seedFlags.element(i);
    nodes.seedFlags.element(i).assign(metadata);
  });

  const staticMetadataStep = bindStaticMetadata()
    .compute(instanceCount, [GPU_MOTION_COMPUTE_CONTRACT.workgroupSize])
    .setName(motionStaticMetadataShaderIdentifier(canonicalScenario));

  function requireLive() {
    if (disposed) throw new Error("motion plan is disposed");
  }

  function bindRendererDevice(renderer, {
    deviceGeneration,
    isDeviceGenerationActive = () => true,
  } = {}) {
    requireLive();
    const device = renderer?.backend?.device;
    if (
      renderer?.initialized !== true
      || renderer?.backend?.isWebGPUBackend !== true
      || !device?.lost
      || typeof device.lost.then !== "function"
    ) {
      throw new Error("motion plan binding requires the initialized native WebGPU renderer device");
    }
    if (!Number.isInteger(deviceGeneration) || deviceGeneration <= 0) {
      throw new RangeError("motion renderer device generation must be a positive integer");
    }
    if (typeof isDeviceGenerationActive !== "function") {
      throw new TypeError("motion renderer device binding requires an active-generation predicate");
    }
    if (rendererBinding && (
      rendererBinding.renderer !== renderer
      || rendererBinding.device !== device
      || rendererBinding.deviceGeneration !== deviceGeneration
    )) {
      throw new Error("motion plan cannot be rebound to a different renderer device generation");
    }
    rendererBinding = Object.freeze({ renderer, device, deviceGeneration, isDeviceGenerationActive });
    rendererBindingStatus = "active";
    return describeRendererBinding();
  }

  function requireBoundActiveRenderer(renderer) {
    requireLive();
    if (!rendererBinding) throw new Error("motion plan has no bound renderer device generation");
    if (
      renderer !== rendererBinding.renderer
      || renderer?.backend?.device !== rendererBinding.device
      || renderer?.initialized !== true
      || renderer?.backend?.isWebGPUBackend !== true
      || renderer?._isDeviceLost === true
      || rendererBinding.isDeviceGenerationActive(rendererBinding.deviceGeneration) !== true
    ) {
      throw new Error("motion renderer device generation is not active");
    }
    return rendererBinding;
  }

  function describeRendererBinding() {
    return Object.freeze({
      status: rendererBindingStatus,
      bound: rendererBinding !== null,
      deviceGeneration: rendererBinding?.deviceGeneration ?? null,
      active: rendererBindingStatus === "active" && rendererBinding
        ? rendererBinding.isDeviceGenerationActive(rendererBinding.deviceGeneration) === true
        : false,
    });
  }

  function interpolatedTransformNodes() {
    const previousPosition = nodes.previousPresentedPose.element(instanceIndex).xyz;
    const currentPosition = nodes.currentPresentedPose.element(instanceIndex).xyz;
    const previousQ = nodes.previousPresentedQuaternion.element(instanceIndex);
    const currentQ = nodes.currentPresentedQuaternion.element(instanceIndex);
    const q = currentQ.normalize();
    const local = positionGeometry;
    const rotated = local.add(cross(q.xyz, cross(q.xyz, local).add(local.mul(q.w))).mul(2));
    return { previousPosition, currentPosition, previousQ, currentQ, q, position: rotated.add(currentPosition) };
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

  function preparePresentation(renderer, value = alpha.value) {
    requireBoundActiveRenderer(renderer);
    if (!renderer?.compute) throw new TypeError("motion presentation preparation requires renderer.compute");
    setPresentationAlpha(value);
    initializePresentation.value = 0;
    const previousVersions = {
      presentationVersionSequence: buffers.presentationVersionSequence,
      previousPresentationVersion: buffers.previousPresentationVersion,
      currentPresentationVersion: buffers.currentPresentationVersion,
      presentationDispatchCount: buffers.presentationDispatchCount,
      staticMetadataDispatchCount: buffers.staticMetadataDispatchCount,
    };
    buffers.previousPresentationVersion = buffers.currentPresentationVersion;
    buffers.currentPresentationVersion = ++buffers.presentationVersionSequence;
    buffers.presentationDispatchCount += 1;
    try {
      return renderer.compute(presentationStep);
    } catch (error) {
      Object.assign(buffers, previousVersions);
      throw error;
    }
  }

  function recordInitializationInstanceMatrixUpload(byteLength) {
    requireLive();
    if (!Number.isInteger(byteLength) || byteLength <= 0) {
      throw new TypeError("initial instance-matrix upload bytes must be a positive integer");
    }
    if (submissionLedger.initializationInstanceMatrixUploadCount !== 0) {
      throw new Error("initial instance-matrix upload may be recorded exactly once");
    }
    submissionLedger.initializationInstanceMatrixUploadCount = 1;
    submissionLedger.initializationInstanceMatrixUploadBytes = byteLength;
    return describeSubmission();
  }

  function describeSubmission() {
    return Object.freeze({ ...submissionLedger });
  }

  function describeStorage() {
    const resources = STORAGE_KEYS.map((key) => Object.freeze({
      id: key,
      owner: "procedural-motion-core",
      resourceKind: "storage-buffer-attribute",
      bindingType: "storage",
      format: STORAGE_RESOURCE_GRAPH[key].format,
      byteLength: attributeBytes(buffers[key]),
      itemSize: buffers[key].itemSize,
      count: buffers[key].count,
      producers: Object.freeze([...STORAGE_RESOURCE_GRAPH[key].producers]),
      consumers: Object.freeze([...STORAGE_RESOURCE_GRAPH[key].consumers]),
      runtimeReachable: true,
    }));
    const reconciledBytes = resources.reduce((sum, resource) => sum + resource.byteLength, 0);
    if (reconciledBytes !== buffers.storageBytes) {
      throw new Error(`motion storage inventory drifted: ${reconciledBytes} != ${buffers.storageBytes}`);
    }
    return Object.freeze({
      schemaVersion: `motion-storage-state-v${MOTION_STORAGE_LAYOUT.version}`,
      layoutVersion: MOTION_STORAGE_LAYOUT.version,
      resourceGeneration: buffers.resourceGeneration,
      stateVersionSequence: buffers.stateVersionSequence,
      previousStateVersion: buffers.previousStateVersion,
      currentStateVersion: buffers.currentStateVersion,
      versionMeaning: "submitted-state-generation; only readbackConfirmedStateVersion is GPU-completion-backed",
      readbackConfirmedStateVersion: buffers.readbackConfirmedStateVersion,
      readbackConfirmedDispatchCount: buffers.readbackConfirmedDispatchCount,
      readbackCount: buffers.readbackCount,
      presentationDispatchCount: buffers.presentationDispatchCount,
      staticMetadataDispatchCount: buffers.staticMetadataDispatchCount,
      presentationVersionSequence: buffers.presentationVersionSequence,
      previousPresentationVersion: buffers.previousPresentationVersion,
      currentPresentationVersion: buffers.currentPresentationVersion,
      allocatedStorageBytes: buffers.storageBytes,
      bytesPerInstance: MOTION_STORAGE_LAYOUT.storageBytesPerInstance,
      instanceCount,
      resources: Object.freeze(resources),
    });
  }

  function dispatchFixedStep(renderer, dt, time) {
    requireBoundActiveRenderer(renderer);
    if (!renderer?.compute) throw new TypeError("motion dispatch requires a renderer.compute implementation");
    if (!Number.isFinite(dt) || dt <= 0) throw new RangeError("motion fixed step must be finite and > 0");
    if (!Number.isFinite(time) || time < 0) throw new RangeError("motion simulation time must be finite and >= 0");
    fixedStep.value = dt;
    simulationTime.value = time;
    initializeState.value = 0;
    const previousVersions = {
      stateVersionSequence: buffers.stateVersionSequence,
      previousStateVersion: buffers.previousStateVersion,
      currentStateVersion: buffers.currentStateVersion,
      dispatchCount: buffers.dispatchCount,
      presentationVersionSequence: buffers.presentationVersionSequence,
      previousPresentationVersion: buffers.previousPresentationVersion,
      currentPresentationVersion: buffers.currentPresentationVersion,
      presentationDispatchCount: buffers.presentationDispatchCount,
    };
    buffers.previousStateVersion = buffers.currentStateVersion;
    buffers.currentStateVersion = ++buffers.stateVersionSequence;
    buffers.dispatchCount += 1;
    try {
      return renderer.compute(computeStep);
    } catch (error) {
      Object.assign(buffers, previousVersions);
      throw error;
    }
  }

  function markStorageForUpload() {
    for (const key of STORAGE_KEYS) buffers[key].needsUpdate = true;
  }

  function resetState({ nextSeed = currentSeed, time = 0 } = {}) {
    requireLive();
    if (!Number.isFinite(time) || time < 0) throw new RangeError("GPU reset time must be finite and nonnegative");
    currentSeed = nextSeed >>> 0;
    fillInstanceMotionArrays(arraysFromBuffers(buffers), instanceCount, {
      scenario: canonicalScenario,
      sceneUnitsPerMeter,
      seed: currentSeed,
      time,
    });
    markStorageForUpload();
    buffers.dispatchCount = 0;
    buffers.presentationDispatchCount = 0;
    buffers.staticMetadataDispatchCount = 0;
    buffers.readbackConfirmedStateVersion = null;
    buffers.readbackConfirmedDispatchCount = null;
    const resetStateVersion = ++buffers.stateVersionSequence;
    buffers.previousStateVersion = resetStateVersion;
    buffers.currentStateVersion = resetStateVersion;
    const resetPresentationVersion = ++buffers.presentationVersionSequence;
    buffers.previousPresentationVersion = resetPresentationVersion;
    buffers.currentPresentationVersion = resetPresentationVersion;
    alpha.value = 0;
    simulationTime.value = time;
    return currentSeed;
  }

  function seek(renderer, seconds) {
    requireBoundActiveRenderer(renderer);
    if (!Number.isFinite(seconds) || seconds < 0) throw new RangeError("GPU seek time must be finite and nonnegative");
    if (!renderer?.compute) throw new TypeError("GPU seek requires renderer.compute");
    simulationTime.value = seconds;
    fixedStep.value = 0;
    initializeState.value = 1;
    const previousVersions = {
      stateVersionSequence: buffers.stateVersionSequence,
      previousStateVersion: buffers.previousStateVersion,
      currentStateVersion: buffers.currentStateVersion,
      dispatchCount: buffers.dispatchCount,
      presentationVersionSequence: buffers.presentationVersionSequence,
      previousPresentationVersion: buffers.previousPresentationVersion,
      currentPresentationVersion: buffers.currentPresentationVersion,
      presentationDispatchCount: buffers.presentationDispatchCount,
      staticMetadataDispatchCount: buffers.staticMetadataDispatchCount,
    };
    const seekStateVersion = ++buffers.stateVersionSequence;
    buffers.previousStateVersion = seekStateVersion;
    buffers.currentStateVersion = seekStateVersion;
    const seekPresentationVersion = ++buffers.presentationVersionSequence;
    buffers.previousPresentationVersion = seekPresentationVersion;
    buffers.currentPresentationVersion = seekPresentationVersion;
    buffers.dispatchCount += 1;
    buffers.presentationDispatchCount += 1;
    buffers.staticMetadataDispatchCount += 1;
    initializePresentation.value = 1;
    alpha.value = 0;
    let result;
    try {
      const stateResult = renderer.compute(computeStep);
      initializeState.value = 0;
      const presentationResult = renderer.compute(presentationStep);
      const staticMetadataResult = renderer.compute(staticMetadataStep);
      result = [stateResult, presentationResult, staticMetadataResult];
    } catch (error) {
      Object.assign(buffers, previousVersions);
      throw error;
    } finally {
      initializeState.value = 0;
      initializePresentation.value = 0;
    }
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
    const openingBinding = requireBoundActiveRenderer(renderer);
    if (!Number.isInteger(count) || count <= 0 || count > instanceCount) {
      throw new RangeError("motion storage readback count must be within allocated instances");
    }
    const storageSnapshot = describeStorage();
    const byteCount = count * 4 * Float32Array.BYTES_PER_ELEMENT;
    const rawBuffers = await Promise.all(STORAGE_KEYS.map((key) => (
      renderer.getArrayBufferAsync(buffers[key], null, 0, byteCount)
    )));
    const closingBinding = requireBoundActiveRenderer(renderer);
    if (
      closingBinding.deviceGeneration !== openingBinding.deviceGeneration
      || closingBinding.device !== openingBinding.device
    ) {
      throw new Error("motion renderer device generation changed while storage readback was in flight");
    }
    const closingStateVersion = buffers.currentStateVersion;
    if (
      closingStateVersion !== storageSnapshot.currentStateVersion
      || buffers.currentPresentationVersion !== storageSnapshot.currentPresentationVersion
    ) {
      throw new Error("motion storage changed while its readback was in flight");
    }
    buffers.readbackConfirmedStateVersion = closingStateVersion;
    buffers.readbackConfirmedDispatchCount = buffers.dispatchCount;
    buffers.readbackCount += 1;
    const result = {
      count,
      layoutVersion: MOTION_STORAGE_LAYOUT.version,
      resourceGeneration: storageSnapshot.resourceGeneration,
      previousStateVersion: storageSnapshot.previousStateVersion,
      currentStateVersion: storageSnapshot.currentStateVersion,
      previousPresentationVersion: storageSnapshot.previousPresentationVersion,
      currentPresentationVersion: storageSnapshot.currentPresentationVersion,
      readbackConfirmedStateVersion: buffers.readbackConfirmedStateVersion,
      readbackConfirmedDispatchCount: buffers.readbackConfirmedDispatchCount,
      readbackCount: buffers.readbackCount,
      allocatedStorageBytes: storageSnapshot.allocatedStorageBytes,
      rendererDeviceGeneration: closingBinding.deviceGeneration,
      readbackBytes: byteCount * STORAGE_KEYS.length,
      rawBufferFormats: Object.fromEntries(STORAGE_KEYS.map((key) => [key, STORAGE_RESOURCE_GRAPH[key].format])),
    };
    for (let index = 0; index < STORAGE_KEYS.length; index += 1) {
      const key = STORAGE_KEYS[index];
      result[key] = key === "seedFlags"
        ? new Uint32Array(rawBuffers[index])
        : new Float32Array(rawBuffers[index]);
      if (result[key].byteLength !== byteCount) {
        throw new Error(`motion storage readback byte mismatch for ${key}`);
      }
    }
    result.velocity = result.velocityState;
    return result;
  }

  function dispose() {
    if (disposed) return false;
    disposed = true;
    rendererBinding = null;
    rendererBindingStatus = "disposed";
    computeStep.dispose?.();
    presentationStep.dispose?.();
    staticMetadataStep.dispose?.();
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
    initializePresentation,
    computeStep,
    presentationStep,
    staticMetadataStep,
    integrateInstanceMotion,
    preparePresentedTransform,
    bindStaticMetadata,
    createInterpolatedPositionNode,
    createVelocityNdcNode,
    setPresentationAlpha,
    preparePresentation,
    recordInitializationInstanceMatrixUpload,
    describeSubmission,
    describeStorage,
    bindRendererDevice,
    describeRendererBinding,
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
    renderConsumes: [
      "previousPresentedPose",
      "currentPresentedPose",
      "previousPresentedQuaternion",
      "currentPresentedQuaternion",
    ],
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
    previousPresentedPose: new Float32Array(instanceCount * 4), currentPresentedPose: new Float32Array(instanceCount * 4),
    previousPresentedQuaternion: new Float32Array(instanceCount * 4), currentPresentedQuaternion: new Float32Array(instanceCount * 4),
    anchorFrequency: new Float32Array(instanceCount * 4), axisPhase: new Float32Array(instanceCount * 4), seedFlags: new Uint32Array(instanceCount * 4),
  };
  fillInstanceMotionArrays(arrays, instanceCount, { scenario, sceneUnitsPerMeter, seed });
  return {
    instanceCount,
    scenario: timelineScenario(scenario),
    sceneUnitsPerMeter,
    seed: seed >>> 0,
    resourceGeneration: 1,
    stateVersionSequence: 1,
    previousStateVersion: 1,
    currentStateVersion: 1,
    _state: createMotionState({ seed, scenario: timelineScenario(scenario), sceneUnitsPerMeter }),
    _presentationState: createMotionState({ seed, scenario: timelineScenario(scenario), sceneUnitsPerMeter }),
    previousSimulationTime: 0,
    currentSimulationTime: 0,
    ...arrays,
  };
}

export function stepInstanceMotionMirror(mirror, fixedStep, simulationTime) {
  mirror.previousSimulationTime = mirror.currentSimulationTime;
  mirror.currentSimulationTime = simulationTime;
  stepTimelineState(mirror._state, fixedStep, simulationTime);
  const state = mirror._state;
  mirror.previousStateVersion = mirror.currentStateVersion;
  mirror.currentStateVersion = ++mirror.stateVersionSequence;
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
    const axisX = mirror.axisPhase[lane];
    const axisY = mirror.axisPhase[lane + 1];
    const axisZ = mirror.axisPhase[lane + 2];
    const axisLength = Math.hypot(axisX, axisY, axisZ) || 1;
    const detail = i === 0 ? 0 : Math.sin(simulationTime + mirror.axisPhase[lane + 3]) * 0.05;
    writeVec4(mirror.currentPose, lane,
      state.position.x + mirror.anchorFrequency[lane] + axisX / axisLength * detail,
      state.position.y + mirror.anchorFrequency[lane + 1] + axisY / axisLength * detail,
      state.position.z + mirror.anchorFrequency[lane + 2] + axisZ / axisLength * detail,
      state.phaseId);
    writeVec4(
      mirror.velocityState,
      lane,
      state.velocity.x,
      state.velocity.y,
      state.velocity.z,
      motionEventBitmask(state.eventFlags) | MOTION_STORAGE_FLAG_BITS.originMetadataBound,
    );
    writeVec4(mirror.currentQuaternion, lane, state.quaternion.x, state.quaternion.y, state.quaternion.z, state.quaternion.w);
    writeVec4(mirror.angularVelocity, lane, state.angularVelocity.x, state.angularVelocity.y, state.angularVelocity.z, state.spinAngle);
  }
  return mirror;
}

export function prepareInstanceMotionMirrorPresentation(mirror, alpha) {
  if (!Number.isFinite(alpha)) throw new RangeError("presentation alpha must be finite");
  const t = Math.min(Math.max(alpha, 0), 1);
  const presentationTime = mirror.previousSimulationTime
    + (mirror.currentSimulationTime - mirror.previousSimulationTime) * t;
  let sampledState = null;
  if (t > 0 && t < 1) {
    sampledState = resetMotionState(mirror._presentationState);
    stepTimelineState(sampledState, 0, presentationTime);
  }
  for (let i = 0; i < mirror.instanceCount; i += 1) {
    const lane = i * 4;
    mirror.previousPresentedPose.set(mirror.currentPresentedPose.subarray(lane, lane + 4), lane);
    mirror.previousPresentedQuaternion.set(mirror.currentPresentedQuaternion.subarray(lane, lane + 4), lane);
    if (t === 0 || t === 1) {
      const poseSource = t === 0 ? mirror.previousPose : mirror.currentPose;
      const quaternionSource = t === 0 ? mirror.previousQuaternion : mirror.currentQuaternion;
      mirror.currentPresentedPose.set(poseSource.subarray(lane, lane + 4), lane);
      mirror.currentPresentedQuaternion.set(quaternionSource.subarray(lane, lane + 4), lane);
    } else {
      const axisX = mirror.axisPhase[lane];
      const axisY = mirror.axisPhase[lane + 1];
      const axisZ = mirror.axisPhase[lane + 2];
      const axisLength = Math.hypot(axisX, axisY, axisZ) || 1;
      const detail = i === 0 ? 0 : Math.sin(presentationTime + mirror.axisPhase[lane + 3]) * 0.05;
      writeVec4(
        mirror.currentPresentedPose,
        lane,
        sampledState.position.x + mirror.anchorFrequency[lane] + axisX / axisLength * detail,
        sampledState.position.y + mirror.anchorFrequency[lane + 1] + axisY / axisLength * detail,
        sampledState.position.z + mirror.anchorFrequency[lane + 2] + axisZ / axisLength * detail,
        sampledState.phaseId,
      );
      sampledState.quaternion.toArray(mirror.currentPresentedQuaternion, lane);
    }
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
  for (const key of [
    "previousPose", "currentPose", "velocityState", "previousQuaternion", "currentQuaternion", "angularVelocity",
    "previousPresentedPose", "currentPresentedPose", "previousPresentedQuaternion", "currentPresentedQuaternion",
  ]) {
    for (let i = 0; i < a[key].length; i += 1) max = Math.max(max, Math.abs(a[key][i] - b[key][i]));
  }
  return max;
}
