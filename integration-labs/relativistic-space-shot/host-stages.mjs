import { Matrix4, Sphere, Vector3 } from "three/webgpu";
import { bloom } from "three/addons/tsl/display/BloomNode.js";

import { createCameraRigCore } from "../../threejs-camera-controls-and-rigs/examples/webgpu-camera-rig/main.mjs";
import { createProceduralMotionCore } from "../../threejs-procedural-motion-systems/examples/webgpu-procedural-timelines/main.js";
import {
  advanceDeltaPolicy,
  copyMotionState,
  createMotionState,
  getPresentationAlpha,
  interpolateMotionState,
  resetMotionState,
  stepTimelineState,
} from "../../threejs-procedural-motion-systems/examples/webgpu-procedural-timelines/timeline.js";
import { BLOOM_CONTROLS } from "../../threejs-bloom/examples/node-selective-bloom/index.js";
import { RELATIVISTIC_CAMERAS, RELATIVISTIC_SEEDS } from "./routes.mjs";

function exact(value, values, label) {
  if (!values.includes(value)) throw new RangeError(`unknown ${label}: ${value}`);
  return value;
}

export function sampleRelativisticMotion(timeSeconds) {
  if (!Number.isFinite(timeSeconds) || timeSeconds < 0) throw new RangeError("motion time must be finite and nonnegative");
  const state = createMotionState({ scenario: "spin-docking", sceneUnitsPerMeter: 0.001 });
  stepTimelineState(state, 0, timeSeconds);
  return { position: state.position.toArray(), velocity: state.velocity.toArray() };
}

/**
 * Thin event-packet adapter around the canonical procedural-motion core. The
 * canonical fixed-step policy/state/GPU plan remain the source of truth.
 */
export function createRelativisticMotionStage({
  renderer,
  subject,
  queueEvent,
  seed = RELATIVISTIC_SEEDS[0],
  instanceCount = 256,
} = {}) {
  if (renderer?.backend?.isWebGPUBackend !== true) throw new TypeError("relativistic motion stage requires the initialized host WebGPU renderer");
  if (!subject?.isObject3D) throw new TypeError("relativistic motion stage requires an Object3D subject");
  if (typeof queueEvent !== "function") throw new TypeError("relativistic motion stage requires a queueEvent consumer");
  exact(seed >>> 0, RELATIVISTIC_SEEDS, "Relativistic Space Shot seed");
  const core = createProceduralMotionCore({
    seed,
    scenario: "spin-docking",
    instanceCount,
    sceneUnitsPerMeter: 0.001,
  });
  const flow = new Vector3();
  let currentSeed = seed >>> 0;
  let consumedEventCount = 0;
  let emittedEventCount = 0;
  let disposed = false;

  function requireLive() {
    if (disposed) throw new Error("relativistic motion stage is disposed");
  }

  function applyRenderState() {
    subject.position.copy(core.stateSlots.render.position);
    subject.quaternion.copy(core.stateSlots.render.quaternion);
    subject.updateMatrixWorld(true);
  }

  function emitNewPackets() {
    const events = core.stateSlots.current.eventLog;
    for (; consumedEventCount < events.length; consumedEventCount += 1) {
      const event = events[consumedEventCount];
      flow.copy(core.stateSlots.current.velocity);
      if (flow.lengthSq() < 1e-12) flow.set(0, 0, -1);
      else flow.normalize().negate();
      queueEvent({
        seed: (currentSeed ^ Math.imul(event.actorId + 1, 0x9e3779b9)) >>> 0,
        position: core.stateSlots.current.position.toArray(),
        flowDirectionWorld: flow.toArray(),
      });
      emittedEventCount += 1;
    }
  }

  const dispatchFixedStep = (fixedStep, simulationTime) => {
    copyMotionState(core.stateSlots.previous, core.stateSlots.current);
    stepTimelineState(core.stateSlots.current, fixedStep, simulationTime + fixedStep);
    core.motionPlan.dispatchFixedStep(renderer, fixedStep, simulationTime + fixedStep);
    emitNewPackets();
  };
  applyRenderState();

  return {
    core,
    step(deltaSeconds) {
      requireLive();
      const steps = advanceDeltaPolicy(core.policy, deltaSeconds, dispatchFixedStep);
      const alpha = getPresentationAlpha(core.policy);
      interpolateMotionState(core.stateSlots.render, core.stateSlots.previous, core.stateSlots.current, alpha);
      core.motionPlan.setPresentationAlpha(alpha);
      applyRenderState();
      return steps;
    },
    setTime(seconds) {
      requireLive();
      if (!Number.isFinite(seconds) || seconds < 0) throw new RangeError("motion time must be finite and nonnegative");
      for (const state of Object.values(core.stateSlots)) resetMotionState(state);
      stepTimelineState(core.stateSlots.current, 0, seconds);
      copyMotionState(core.stateSlots.previous, core.stateSlots.current);
      copyMotionState(core.stateSlots.render, core.stateSlots.current);
      core.policy.accumulator = 0;
      core.policy.simulationTime = seconds;
      core.policy.presentationTime = seconds;
      consumedEventCount = core.stateSlots.current.eventLog.length;
      core.motionPlan.resetState({ nextSeed: currentSeed, time: 0 });
      core.motionPlan.seek(renderer, seconds);
      applyRenderState();
    },
    setSeed(nextSeed) {
      requireLive();
      currentSeed = exact(nextSeed >>> 0, RELATIVISTIC_SEEDS, "Relativistic Space Shot seed");
      for (const state of Object.values(core.stateSlots)) state.seed = currentSeed;
      core.motionPlan.resetState({ nextSeed: currentSeed, time: core.policy.simulationTime });
    },
    describe() {
      return {
        owner: "threejs-procedural-motion-systems",
        implementation: "createProceduralMotionCore/spin-docking",
        fixedStepSeconds: core.policy.fixedStep,
        maxCatchUpSteps: core.policy.maxSubsteps,
        simulationTime: core.policy.simulationTime,
        emittedEventCount,
        storageBytes: core.motionPlan.storageBytes,
        dispatchCount: core.motionPlan.buffers.dispatchCount,
        eventPacketConsumer: "threejs-particles-trails-and-effects",
      };
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      core.motionPlan.dispose();
    },
  };
}

/** Thin camera-route adapter around the canonical host-safe camera core. */
export function createRelativisticCameraStage({ camera, subject, cameraId = "design", tier = "budgeted" } = {}) {
  if (!camera?.isPerspectiveCamera) throw new TypeError("relativistic camera stage requires a PerspectiveCamera");
  if (!subject?.isObject3D) throw new TypeError("relativistic camera stage requires an Object3D subject");
  let currentCamera = exact(cameraId, RELATIVISTIC_CAMERAS, "Relativistic Space Shot camera");
  const core = createCameraRigCore({
    camera,
    subject,
    subjectBounds: new Sphere(new Vector3(), 2.6),
    tier,
  });
  const previousViewProjection = new Matrix4();
  const currentViewProjection = new Matrix4();
  let disposed = false;

  function update(deltaSeconds = 0) {
    if (disposed) throw new Error("relativistic camera stage is disposed");
    previousViewProjection.copy(currentViewProjection);
    if (currentCamera === "near") core.controller.computeProfilePose(camera.position, camera.quaternion);
    else {
      core.controller.computeOverviewPose(camera.position, camera.quaternion);
      if (currentCamera === "far") camera.position.sub(subject.position).multiplyScalar(1.6).add(subject.position);
    }
    if (deltaSeconds > 0) core.controller.update(deltaSeconds);
    camera.updateMatrixWorld(true);
    currentViewProjection.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
  }

  update();
  previousViewProjection.copy(currentViewProjection);
  return {
    core,
    setCamera(id) { currentCamera = exact(id, RELATIVISTIC_CAMERAS, "Relativistic Space Shot camera"); update(); },
    update,
    describe() {
      return {
        owner: "threejs-camera-controls-and-rigs",
        implementation: "createCameraRigCore",
        cameraId: currentCamera,
        currentPreviousState: true,
        jitterOwner: "host-image-pipeline-stage/TRAANode",
        previousViewProjection: previousViewProjection.elements.slice(),
        currentViewProjection: currentViewProjection.elements.slice(),
      };
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      core.dispose();
    },
  };
}

/** Host-safe bloom: canonical controls, shared MRT input, and no scene pass. */
export function createSharedEmissiveBloomStage({ emissiveTextureNode, resolutionScale, controls = BLOOM_CONTROLS } = {}) {
  if (!emissiveTextureNode?.isNode) throw new TypeError("shared-emissive bloom requires a TSL emissive texture node");
  if (!Number.isFinite(resolutionScale) || resolutionScale <= 0 || resolutionScale > 1) {
    throw new RangeError("bloom resolution scale must be finite and in (0, 1]");
  }
  const node = bloom(emissiveTextureNode, controls.strength, controls.radius, controls.threshold);
  node.smoothWidth.value = controls.smoothWidth;
  node.setResolutionScale(resolutionScale);
  return {
    node,
    outputNode: node.getTextureNode(),
    describe() {
      return {
        owner: "threejs-bloom",
        implementation: "r185 BloomNode with canonical BLOOM_CONTROLS",
        inputSignal: "scene.emissive",
        inputProducer: "relativistic-space-shot/primary-scene-mrt",
        sceneSubmissionCount: 0,
        resolutionScale,
        controls: { ...controls },
        timingVerdict: "INSUFFICIENT_EVIDENCE",
      };
    },
    dispose() { node.dispose(); },
  };
}
