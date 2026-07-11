import {
  AmbientLight,
  BoxGeometry,
  DirectionalLight,
  InstancedMesh,
  Matrix4,
  Mesh,
  MeshStandardNodeMaterial,
  PerspectiveCamera,
  REVISION,
  RenderPipeline,
  RenderTarget,
  Scene,
  Timer,
  UnsignedByteType,
  WebGPURenderer,
} from "three/webgpu";
import { color, emissive, mrt, normalView, output, pass, renderOutput, screenUV, vec4, velocity } from "three/tsl";

import { createGpuInstanceMotionPlan } from "./gpu-instance-motion.js";
import { MOTION_MODES, MOTION_TIERS, assertMotionRouteLock, parseMotionRoute } from "./route-state.js";
import {
  MOTION_SCENARIOS,
  advanceDeltaPolicy,
  copyMotionState,
  createDeltaPolicy,
  createMotionStateSlots,
  createReparentFixture,
  getPresentationAlpha,
  interpolateMotionState,
  matrixMaxAbsDifference,
  resetMotionState,
  stepTimelineState,
} from "./timeline.js";

function exact(value, allowed, label) {
  if (!allowed.includes(value)) throw new RangeError(`unknown motion ${label}: ${value}`);
  return value;
}

function strideFor(pixels, width, height) {
  const rowBytes = width * 4 * pixels.BYTES_PER_ELEMENT;
  if (height <= 1 || pixels.byteLength === rowBytes * height) return rowBytes;
  const aligned = Math.ceil(rowBytes / 256) * 256;
  if (pixels.byteLength === aligned * height || pixels.byteLength === aligned * (height - 1) + rowBytes) return aligned;
  const inferred = (pixels.byteLength - rowBytes) / (height - 1);
  if (!Number.isInteger(inferred) || inferred < rowBytes) throw new Error(`invalid readback stride: ${inferred}`);
  return inferred;
}

/** Host-consumable core: no renderer, DOM, or animation loop is created. */
export function createProceduralMotionCore({
  seed = 20260704,
  scenario = "spin-docking",
  instanceCount = 4096,
  sceneUnitsPerMeter = 0.001,
} = {}) {
  exact(scenario, MOTION_SCENARIOS, "scenario");
  return {
    policy: createDeltaPolicy(),
    stateSlots: createMotionStateSlots({ seed, scenario, sceneUnitsPerMeter }),
    motionPlan: createGpuInstanceMotionPlan({ instanceCount, scenario, sceneUnitsPerMeter, seed }),
  };
}

export class ProceduralTimelineDemo {
  constructor({
    seed = 20260704,
    locationRef = globalThis.location,
    route = parseMotionRoute(locationRef),
  } = {}) {
    this.route = route;
    this.seed = seed >>> 0;
    this.scene = new Scene();
    this.camera = new PerspectiveCamera(55, 16 / 9, 0.1, 5000);
    this.camera.position.set(0, 3.5, 13);
    this.timer = new Timer();
    const core = createProceduralMotionCore({
      seed: this.seed,
      scenario: route.scenario,
      instanceCount: MOTION_TIERS[route.tier].instanceCount,
    });
    this.policy = core.policy;
    this.stateSlots = core.stateSlots;
    this.state = this.stateSlots.current;
    this.motionPlan = core.motionPlan;
    this.reparentProof = route.scenario === "quaternion-and-reparent" ? createReparentFixture() : null;
    this.disposed = false;
    this._fixedStepDispatch = (fixedStep, simulationTime) => {
      copyMotionState(this.stateSlots.previous, this.stateSlots.current);
      stepTimelineState(this.stateSlots.current, fixedStep, simulationTime + fixedStep);
      this.motionPlan.dispatchFixedStep(this.renderer, fixedStep, simulationTime + fixedStep);
    };
  }

  async initialize({ canvas, documentRef = globalThis.document, startAnimationLoop = true } = {}) {
    if (!canvas) throw new TypeError("ProceduralTimelineDemo.initialize requires a canvas");
    this.canvas = canvas;
    this.renderer = new WebGPURenderer({ canvas, antialias: false, trackTimestamp: true });
    await this.renderer.init();
    if (this.renderer.backend?.isWebGPUBackend !== true) {
      throw new Error("WebGPU is required for the canonical procedural-motion lab");
    }
    const width = Math.max(1, canvas.clientWidth || canvas.width || 1);
    const height = Math.max(1, canvas.clientHeight || canvas.height || 1);
    this.renderer.setPixelRatio(Math.min(globalThis.devicePixelRatio || 1, MOTION_TIERS[this.route.tier].dprCap));
    this.renderer.setSize(width, height, false);
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
    if (documentRef) this.timer.connect(documentRef);

    this.scene.add(new AmbientLight(0x8ba2cf, 1.2));
    const key = new DirectionalLight(0xffffff, 5);
    key.position.set(5, 8, 6);
    this.scene.add(key);

    this.rocketGeometry = new BoxGeometry(1, 4, 1);
    this.rocketMaterial = new MeshStandardNodeMaterial();
    this.rocketMaterial.colorNode = color(0xd8e8ff);
    this.rocketMaterial.emissiveNode = color(0x07152a);
    this.rocket = new Mesh(this.rocketGeometry, this.rocketMaterial);
    this.scene.add(this.rocket);

    this.instanceGeometry = new BoxGeometry(0.045, 0.045, 0.16);
    this.instanceMaterial = new MeshStandardNodeMaterial();
    this.instanceMaterial.colorNode = color(0x84d6ff);
    this.instanceMaterial.emissiveNode = color(0x041121);
    this.instanceMaterial.positionNode = this.motionPlan.createInterpolatedPositionNode();
    this.instanceMaterial.mrtNode = mrt({ velocity: this.motionPlan.createVelocityNdcNode() });
    this.instanceMesh = new InstancedMesh(this.instanceGeometry, this.instanceMaterial, this.motionPlan.buffers.instanceCount);
    const identity = new Matrix4();
    for (let i = 0; i < this.motionPlan.buffers.instanceCount; i += 1) this.instanceMesh.setMatrixAt(i, identity);
    this.instanceMesh.instanceMatrix.needsUpdate = true;
    this.scene.add(this.instanceMesh);

    this.scenePass = pass(this.scene, this.camera);
    this.scenePass.setMRT(mrt({ output, normal: normalView, emissive, velocity }));
    this.outputNodes = {
      final: renderOutput(this.scenePass.getTextureNode("output")),
      normal: renderOutput(this.scenePass.getTextureNode("normal")),
      emissive: renderOutput(this.scenePass.getTextureNode("emissive")),
      velocity: renderOutput(vec4(this.scenePass.getTextureNode("velocity").sample(screenUV).xy.mul(0.5).add(0.5), 0, 1)),
    };
    this.renderPipeline = new RenderPipeline(this.renderer);
    this.renderPipeline.outputNode = this.outputNodes[this.route.mode];
    this.renderPipeline.outputColorTransform = false;
    this.captureTarget = new RenderTarget(1, 1, { type: UnsignedByteType, depthBuffer: false });
    this.captureTarget.texture.colorSpace = this.renderer.outputColorSpace;
    this.motionPlan.primeFrameMatrices(this.camera, this.instanceMesh);
    this.debugElement = documentRef?.querySelector?.("[data-motion-debug]") ?? null;

    if (startAnimationLoop) {
      this.renderer.setAnimationLoop((timestamp) => {
        this.timer.update(timestamp);
        this.advanceFrame(this.timer.getDelta());
      });
    }
    this.labController = this.createLabController();
    return this;
  }

  advanceFrame(delta) {
    this.motionPlan.beginFrameMatrices();
    advanceDeltaPolicy(this.policy, delta, this._fixedStepDispatch);
    const alpha = getPresentationAlpha(this.policy);
    interpolateMotionState(this.stateSlots.render, this.stateSlots.previous, this.stateSlots.current, alpha);
    this.motionPlan.setPresentationAlpha(alpha);
    this.rocket?.position.copy(this.stateSlots.render.position);
    this.rocket?.quaternion.copy(this.stateSlots.render.quaternion);
    this.motionPlan.captureFrameMatrices(this.camera, this.instanceMesh);
    this.renderPipeline?.render();
    this.updateDebug(alpha);
    return alpha;
  }

  updateDebug(alpha) {
    if (!this.debugElement) return;
    this.debugElement.textContent = JSON.stringify({
      status: "native-webgpu-runtime; performance-unmeasured",
      scenario: this.stateSlots.current.scenario,
      tier: this.route.tier,
      alpha,
      simulationTime: this.policy.simulationTime,
      phaseId: this.stateSlots.current.phaseId,
      position: this.stateSlots.render.position.toArray(),
      velocity: this.stateSlots.render.velocity.toArray(),
      angularVelocity: this.stateSlots.render.angularVelocity.toArray(),
      spinAngle: this.stateSlots.render.spinAngle,
      storageBytes: this.motionPlan.storageBytes,
      dispatchCount: this.motionPlan.buffers.dispatchCount,
      reparent: this.reparentProof ? {
        worldMatrixError: matrixMaxAbsDifference(this.reparentProof.worldBefore, this.reparentProof.worldAfter),
        trsResidual: this.reparentProof.trsResidual,
        usesAffineMatrix: this.reparentProof.usesAffineMatrix,
      } : null,
      outputColorTransform: this.renderPipeline.outputColorTransform,
    }, null, 2);
  }

  createLabController() {
    const demo = this;
    return {
      async ready() {},
      async setScenario(id) {
        exact(id, MOTION_SCENARIOS, "scenario");
        assertMotionRouteLock(demo.route, { scenario: id });
      },
      async setMode(id) {
        exact(id, MOTION_MODES, "mode");
        demo.renderPipeline.outputNode = demo.outputNodes[id];
        demo.renderPipeline.needsUpdate = true;
      },
      async setTier(id) {
        exact(id, Object.keys(MOTION_TIERS), "tier");
        assertMotionRouteLock(demo.route, { tier: id });
      },
      async setSeed(seed) {
        if (!Number.isInteger(seed)) throw new RangeError("seed must be an integer");
        demo.seed = seed >>> 0;
        for (const state of Object.values(demo.stateSlots)) state.seed = demo.seed;
        await this.resetHistory("seed-change");
      },
      async setCamera(id) {
        exact(id, ["near", "design", "far"], "camera");
        demo.camera.position.z = id === "near" ? 7 : id === "far" ? 24 : 13;
        demo.camera.updateMatrixWorld(true);
        demo.motionPlan.primeFrameMatrices(demo.camera, demo.instanceMesh);
      },
      async setTime(seconds) {
        if (!Number.isFinite(seconds) || seconds < 0) throw new RangeError("time must be finite and >= 0");
        await this.resetHistory("time-seek");
        stepTimelineState(demo.stateSlots.current, demo.policy.fixedStep, seconds);
        copyMotionState(demo.stateSlots.previous, demo.stateSlots.current);
        copyMotionState(demo.stateSlots.render, demo.stateSlots.current);
        demo.policy.simulationTime = seconds;
        demo.policy.presentationTime = seconds;
        demo.motionPlan.resetState({ nextSeed: demo.seed, time: 0 });
        demo.motionPlan.seek(demo.renderer, seconds);
      },
      async step(deltaSeconds) { return demo.advanceFrame(deltaSeconds); },
      async resetHistory() {
        for (const state of Object.values(demo.stateSlots)) resetMotionState(state);
        stepTimelineState(demo.stateSlots.current, 0, 0);
        copyMotionState(demo.stateSlots.previous, demo.stateSlots.current);
        copyMotionState(demo.stateSlots.render, demo.stateSlots.current);
        Object.assign(demo.policy, createDeltaPolicy());
        demo.motionPlan.resetState({ nextSeed: demo.seed, time: 0 });
        demo.motionPlan.seek(demo.renderer, 0);
        demo.motionPlan.primeFrameMatrices(demo.camera, demo.instanceMesh);
        demo.renderPipeline.needsUpdate = true;
      },
      async resize(width, height, dpr = 1) {
        if (![width, height, dpr].every((value) => Number.isFinite(value) && value > 0)) throw new RangeError("invalid resize");
        demo.renderer.setPixelRatio(Math.min(dpr, MOTION_TIERS[demo.route.tier].dprCap));
        demo.renderer.setSize(width, height, false);
        demo.captureTarget.setSize(demo.renderer.domElement.width, demo.renderer.domElement.height);
        demo.camera.aspect = width / height;
        demo.camera.updateProjectionMatrix();
        demo.renderPipeline.needsUpdate = true;
      },
      async renderOnce() { demo.renderPipeline.render(); },
      async capturePixels(target = "output") {
        if (target === "presentation") {
          demo.captureTarget.setSize(demo.renderer.domElement.width, demo.renderer.domElement.height);
          const previousTarget = demo.renderer.getRenderTarget();
          try {
            demo.renderer.setRenderTarget(demo.captureTarget);
            demo.renderPipeline.render();
            const pixels = await demo.renderer.readRenderTargetPixelsAsync(
              demo.captureTarget,
              0,
              0,
              demo.captureTarget.width,
              demo.captureTarget.height,
            );
            return {
              target,
              width: demo.captureTarget.width,
              height: demo.captureTarget.height,
              format: "rgba8unorm",
              outputColorSpace: demo.renderer.outputColorSpace,
              bytesPerPixel: 4,
              bytesPerRow: strideFor(pixels, demo.captureTarget.width, demo.captureTarget.height),
              pixels,
            };
          } finally {
            demo.renderer.setRenderTarget(previousTarget);
          }
        }
        const targets = ["output", "normal", "emissive", "velocity"];
        const index = targets.indexOf(target);
        if (index < 0) throw new RangeError(`unknown motion capture target: ${target}`);
        demo.renderPipeline.render();
        const rt = demo.scenePass.renderTarget;
        const pixels = await demo.renderer.readRenderTargetPixelsAsync(rt, 0, 0, rt.width, rt.height, index);
        return { target, width: rt.width, height: rt.height, bytesPerRow: strideFor(pixels, rt.width, rt.height), pixels };
      },
      async captureStorage(count = 16) { return demo.motionPlan.readback(demo.renderer, count); },
      describePipeline() {
        return {
          owners: { renderer: "webgpu-procedural-timelines", motion: "procedural-motion-core", output: "renderOutput" },
          signals: ["output", "normal", "emissive", "velocity"],
          sceneSubmissions: [{ id: "motion-scene-pass", kind: "lit" }],
          computeDispatches: [{ id: "motion:integrate-previous-current-transform", count: demo.motionPlan.buffers.dispatchCount }],
          resources: [{ id: "motion-storage", bytes: demo.motionPlan.storageBytes }],
          finalToneMapOwner: "renderOutput",
          finalOutputTransformOwner: "renderOutput",
        };
      },
      describeResources() {
        return {
          storageBytes: demo.motionPlan.storageBytes,
          instanceMatrixBytes: demo.instanceMesh.instanceMatrix.array.byteLength,
          renderTargets: ["output", "normal", "emissive", "velocity", "depth"],
        };
      },
      getMetrics() {
        return {
          threeRevision: REVISION,
          backend: demo.renderer.backend?.isWebGPUBackend === true ? "WebGPU" : "unsupported",
          gpuTiming: demo.renderer.hasFeature?.("timestamp-query") ? "available-not-yet-resolved" : "INSUFFICIENT_EVIDENCE",
          simulationSteps: demo.policy.simulationSteps,
          dispatchCount: demo.motionPlan.buffers.dispatchCount,
          storageBytes: demo.motionPlan.storageBytes,
        };
      },
      async dispose() { demo.dispose(); },
    };
  }

  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    this.renderer?.setAnimationLoop(null);
    this.timer.dispose?.();
    this.rocketGeometry?.dispose();
    this.rocketMaterial?.dispose();
    this.instanceGeometry?.dispose();
    this.instanceMaterial?.dispose();
    this.motionPlan?.dispose();
    this.captureTarget?.dispose();
    this.renderPipeline?.dispose?.();
    this.renderer?.dispose?.();
  }
}

export function createProceduralTimelineDemo(options) {
  return new ProceduralTimelineDemo(options);
}
