import {
  BoxGeometry,
  Mesh,
  MeshStandardMaterial,
  PerspectiveCamera,
  Scene,
  Timer,
} from "three";
import { RenderPipeline, WebGPURenderer } from "three/webgpu";
import { pass, renderOutput } from "three/tsl";

import { createGpuInstanceMotionPlan } from "./gpu-instance-motion.js";
import { createDeltaPolicy, advanceDeltaPolicy, createMotionState, stepTimelineState } from "./timeline.js";

export class ProceduralTimelineDemo {
  constructor({ seed = 20260704, instanceCount = 4096 } = {}) {
    this.scene = new Scene();
    this.camera = new PerspectiveCamera(55, 16 / 9, 0.1, 5000);
    this.timer = new Timer();
    this.policy = createDeltaPolicy();
    this.state = createMotionState({ seed });
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

    this.renderer.setAnimationLoop((timestamp) => {
      this.timer.update(timestamp);
      advanceDeltaPolicy(this.policy, this.timer.getDelta(), (fixedStep, simulationTime) => {
        stepTimelineState(this.state, fixedStep, simulationTime);
      });
      this.rocket.position.copy(this.state.position);
      this.rocket.quaternion.copy(this.state.quaternion);
      this.renderPipeline.render();
    });

    return this;
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
