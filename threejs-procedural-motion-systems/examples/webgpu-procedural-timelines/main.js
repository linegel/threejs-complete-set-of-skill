import {
  BoxGeometry,
  InstancedMesh,
  Matrix4,
  Mesh,
  MeshStandardMaterial,
  PerspectiveCamera,
  Scene,
  Timer,
} from "three";
import { MeshStandardNodeMaterial, RenderPipeline, WebGPURenderer } from "three/webgpu";
import { pass, renderOutput } from "three/tsl";

import { createGpuInstanceMotionPlan } from "./gpu-instance-motion.js";
import {
  advanceDeltaPolicy,
  copyMotionState,
  createDeltaPolicy,
  createMotionStateSlots,
  getPresentationAlpha,
  interpolateMotionState,
  stepTimelineState,
} from "./timeline.js";

export class ProceduralTimelineDemo {
  constructor({ seed = 20260704, instanceCount = 4096 } = {}) {
    this.scene = new Scene();
    this.camera = new PerspectiveCamera(55, 16 / 9, 0.1, 5000);
    this.timer = new Timer();
    this.policy = createDeltaPolicy();
    this.stateSlots = createMotionStateSlots({ seed });
    this.state = this.stateSlots.current;
    this.motionPlan = createGpuInstanceMotionPlan({ instanceCount });
    this.nodePost = {
      pass: pass(this.scene, this.camera),
      output: renderOutput,
      ownership: "renderPipeline.render(), not renderer.render(), outputColorTransform owner",
    };
  }

  async initialize({ canvas, documentRef = globalThis.document } = {}) {
    this.renderer = new WebGPURenderer({ canvas, antialias: true });
    await this.renderer.init();
    this.renderPipeline = new RenderPipeline(this.renderer);
    this.renderPipeline.outputColorTransform = true;
    if (documentRef) this.timer.connect(documentRef);

    this.rocket = new Mesh(new BoxGeometry(1, 4, 1), new MeshStandardMaterial({ color: 0xd8e8ff }));
    this.scene.add(this.rocket);

    const instanceMaterial = new MeshStandardNodeMaterial({ color: 0x84d6ff });
    instanceMaterial.positionNode = this.motionPlan.createInterpolatedPositionNode();
    this.instanceMesh = new InstancedMesh(new BoxGeometry(0.045, 0.045, 0.16), instanceMaterial, this.motionPlan.buffers.instanceCount);
    const identity = new Matrix4();
    for (let i = 0; i < this.motionPlan.buffers.instanceCount; i += 1) this.instanceMesh.setMatrixAt(i, identity);
    this.scene.add(this.instanceMesh);

    this.renderer.setAnimationLoop((timestamp) => {
      this.timer.update(timestamp);
      this.advanceFrame(this.timer.getDelta());
    });

    return this;
  }

  // The full per-frame contract in one renderer-agnostic method so the
  // validator can drive the real loop headlessly (fixed-step sim, GPU
  // dispatch per fixed step, presentation interpolation, render).
  advanceFrame(delta) {
    advanceDeltaPolicy(this.policy, delta, (fixedStep, simulationTime) => {
      copyMotionState(this.stateSlots.previous, this.stateSlots.current);
      stepTimelineState(this.stateSlots.current, fixedStep, simulationTime + fixedStep);
      this.motionPlan.dispatchFixedStep(this.renderer, fixedStep, simulationTime + fixedStep);
    });

    const alpha = getPresentationAlpha(this.policy);
    interpolateMotionState(this.stateSlots.render, this.stateSlots.previous, this.stateSlots.current, alpha);
    this.motionPlan.setPresentationAlpha(alpha);
    this.rocket?.position.copy(this.stateSlots.render.position);
    this.rocket?.quaternion.copy(this.stateSlots.render.quaternion);
    this.renderPipeline?.render();
    return alpha;
  }

  dispose() {
    this.renderer?.setAnimationLoop(null);
    this.timer.dispose?.();
    this.scene.traverse((object) => {
      object.geometry?.dispose?.();
      object.material?.dispose?.();
    });
    this.renderer?.dispose?.();
  }
}

export function createProceduralTimelineDemo(options) {
  return new ProceduralTimelineDemo(options);
}
