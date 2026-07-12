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
  Vector2,
  Vector3,
  WebGPURenderer,
} from "three/webgpu";
import { color, emissive, mrt, normalView, output, pass, renderOutput, screenUV, vec4, velocity } from "three/tsl";

import { createGpuInstanceMotionPlan } from "./gpu-instance-motion.js";
import { MOTION_MODES, MOTION_TIERS, assertMotionRouteLock, parseMotionRoute } from "./route-state.js";
import {
  MOTION_SCENARIOS,
  MOTION_ORIGIN_METADATA,
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

export const MOTION_PIPELINE_OWNERSHIP = Object.freeze({
  rendererOwner: "webgpu-procedural-timelines",
  renderPipelineOwner: "webgpu-procedural-timelines",
  motionOwner: "procedural-motion-core",
  finalToneMapOwner: "renderOutput",
  finalOutputTransformOwner: "renderOutput",
  outputColorTransform: false,
  litSceneSubmissionCount: 1,
});

export const MOTION_VELOCITY_DIAGNOSTIC_GAIN = 128;
export const MOTION_STAGE_PRESENTATION = Object.freeze({
  kind: "authored-presentation-cue",
  physicalClaim: false,
  attachedOffsetScene: Object.freeze([0, -2.55, 0]),
  detachedVelocityScenePerSecond: Object.freeze([0.32, -0.12, 0.08]),
  note: "The second-stage cue makes the authored detachment event legible; it is not a metric separation-velocity claim.",
});

const MOTION_RUNTIME_PROFILES = Object.freeze(["correctness", "performance"]);

export function parseMotionRuntimeProfile(locationLike = globalThis.location) {
  const params = new URLSearchParams(locationLike?.search ?? "");
  const values = params.getAll("profile");
  if (values.length > 1) throw new RangeError("duplicate motion capture profile values are not allowed");
  return exact(values[0] ?? "correctness", MOTION_RUNTIME_PROFILES, "capture profile");
}

export function describeMotionGpuTiming(timestampQueriesActive) {
  return Object.freeze({
    verdict: "INSUFFICIENT_EVIDENCE",
    reason: timestampQueriesActive
      ? "timestamp tracking is configured but no resolved sustained sample population is attached"
      : "timestamp tracking is not active for this capture profile",
  });
}

export function requireInitializedMotionRendererDevice(renderer) {
  const backend = renderer?.backend;
  const device = backend?.device;
  if (renderer?.initialized !== true || backend?.isWebGPUBackend !== true) {
    throw new Error("motion runtime requires one initialized native WebGPU renderer");
  }
  if (!device || typeof device !== "object") {
    throw new Error("initialized motion renderer did not expose its actual backend GPUDevice");
  }
  if (!device.lost || typeof device.lost.then !== "function") {
    throw new Error("initialized motion renderer GPUDevice does not expose its loss promise");
  }
  return device;
}

function deviceLabel(device) {
  return typeof device?.label === "string" ? device.label : "";
}

function classifyDevice(device) {
  const identity = `${deviceLabel(device)} ${device?.constructor?.name ?? ""}`.toLowerCase();
  return /swiftshader|llvmpipe|software|lavapipe/.test(identity) ? "software" : "unknown";
}

function snapshotDeviceLimits(limits) {
  const keys = [
    "maxBufferSize",
    "maxComputeInvocationsPerWorkgroup",
    "maxComputeWorkgroupSizeX",
    "maxComputeWorkgroupsPerDimension",
    "maxStorageBufferBindingSize",
    "maxStorageBuffersPerShaderStage",
  ];
  return Object.fromEntries(keys.flatMap((key) => (
    Number.isFinite(limits?.[key]) ? [[key, Number(limits[key])]] : []
  )));
}

function exact(value, allowed, label) {
  if (!allowed.includes(value)) throw new RangeError(`unknown motion ${label}: ${value}`);
  return value;
}

export function runMotionRollback(actions) {
  if (!Array.isArray(actions) || actions.some((action) => typeof action !== "function")) {
    throw new TypeError("motion rollback requires an array of actions");
  }
  const errors = [];
  for (const action of actions) {
    try {
      action();
    } catch (error) {
      errors.push(error);
    }
  }
  return Object.freeze(errors);
}

function strideFor(pixels, width, height) {
  const rowBytes = width * 4 * pixels.BYTES_PER_ELEMENT;
  if (height <= 1 || pixels.byteLength === rowBytes * height) return rowBytes;
  const aligned = Math.ceil(rowBytes / 256) * 256;
  if (pixels.byteLength === aligned * height || pixels.byteLength === aligned * (height - 1) + rowBytes) return aligned;
  throw new Error(
    `unknown renderer readback layout: ${pixels.byteLength} bytes for ${width}x${height}; stride was not inferred`,
  );
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
    this.sceneUnitsPerMeter = 0.001;
    this.currentScenario = route.scenario;
    this.currentTier = route.tier;
    this.currentMode = route.mode;
    this.currentCamera = "design";
    this.requestedDpr = 1;
    this.reconfiguring = false;
    this.runtimeProfile = parseMotionRuntimeProfile(locationRef);
    this.performanceTimestampMode = this.runtimeProfile === "performance" ? "auto" : "disabled";
    this.timestampQueriesRequired = this.runtimeProfile === "performance";
    this.timestampQueriesRequested = this.runtimeProfile === "performance";
    this.timestampQueriesActive = false;
    this.rendererDeviceGeneration = 0;
    this.deviceLossGeneration = 0;
    this.rendererDeviceStatus = "uninitialized";
    this.rendererMonitoringInstalledBeforeInit = false;
    this.lossPromiseObservedOnActualDevice = false;
    this.initializedRendererDevice = null;
    this.deviceErrorCount = 0;
    this.lastDeviceError = null;
    this.presentationHistoryStatus = "uninitialized";
    this.presentationOrigin = new Vector3();
    this._zeroPresentationOrigin = new Vector3();
    this._stageAttachedOffset = new Vector3(...MOTION_STAGE_PRESENTATION.attachedOffsetScene);
    this._stageDetachedVelocity = new Vector3(...MOTION_STAGE_PRESENTATION.detachedVelocityScenePerSecond);
    this._cameraTarget = new Vector3();
    this.scene = new Scene();
    this.camera = new PerspectiveCamera(55, 16 / 9, 0.1, 5000);
    this.camera.position.set(0, 3.5, 13);
    this.timer = new Timer();
    const core = createProceduralMotionCore({
      seed: this.seed,
      scenario: this.currentScenario,
      instanceCount: MOTION_TIERS[this.currentTier].instanceCount,
      sceneUnitsPerMeter: this.sceneUnitsPerMeter,
    });
    this.policy = core.policy;
    this.stateSlots = core.stateSlots;
    this.state = this.stateSlots.current;
    this.motionPlan = core.motionPlan;
    this.reparentProof = this.currentScenario === "quaternion-and-reparent" ? createReparentFixture() : null;
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
    this.renderer = new WebGPURenderer({
      canvas,
      antialias: false,
      trackTimestamp: this.timestampQueriesRequested,
    });
    const previousDeviceLost = this.renderer.onDeviceLost;
    const previousError = this.renderer.onError;
    this.renderer.onDeviceLost = (info) => {
      try {
        previousDeviceLost?.call(this.renderer, info);
      } finally {
        this.recordRendererDeviceLoss(info);
      }
    };
    this.renderer.onError = (info) => {
      try {
        previousError?.call(this.renderer, info);
      } finally {
        this.deviceErrorCount += 1;
        this.lastDeviceError = String(info?.message ?? info?.type ?? "uncaptured WebGPU error");
      }
    };
    this.rendererMonitoringInstalledBeforeInit = true;
    await this.renderer.init();
    this.bindInitializedRendererDevice();
    this.bindMotionPlanToRenderer(this.motionPlan);
    const width = Math.max(1, canvas.clientWidth || canvas.width || 1);
    const height = Math.max(1, canvas.clientHeight || canvas.height || 1);
    this.logicalWidth = width;
    this.logicalHeight = height;
    this.requestedDpr = globalThis.devicePixelRatio || 1;
    this.renderer.setPixelRatio(Math.min(this.requestedDpr, MOTION_TIERS[this.currentTier].dprCap));
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
    this.rocketMaterial.mrtNode = mrt({ velocity: vec4(0, 0, 0, 1) });
    this.rocket = new Mesh(this.rocketGeometry, this.rocketMaterial);
    this.scene.add(this.rocket);

    this.stageGeometry = new BoxGeometry(0.82, 1.45, 0.82);
    this.stageMaterial = new MeshStandardNodeMaterial();
    this.stageMaterial.colorNode = color(0xffb96b);
    this.stageMaterial.emissiveNode = color(0x1b0702);
    this.stageMaterial.mrtNode = mrt({ velocity: vec4(0, 0, 0, 1) });
    this.stage = new Mesh(this.stageGeometry, this.stageMaterial);
    this.scene.add(this.stage);

    this.instanceGeometry = new BoxGeometry(0.045, 0.045, 0.16);
    this.instanceMaterial = new MeshStandardNodeMaterial();
    this.instanceMaterial.colorNode = color(0x84d6ff);
    this.instanceMaterial.emissiveNode = color(0x041121);
    this.installMotionMaterialNodes(this.motionPlan);
    this.instanceMesh = this.createMotionInstanceMesh(this.motionPlan);
    this.scene.add(this.instanceMesh);

    this.scenePass = pass(this.scene, this.camera);
    this.scenePass.setMRT(mrt({ output, normal: normalView, emissive, velocity }));
    const velocityDiagnostic = this.scenePass.getTextureNode("velocity")
      .sample(screenUV).xy.mul(MOTION_VELOCITY_DIAGNOSTIC_GAIN);
    this.outputNodes = {
      final: renderOutput(this.scenePass.getTextureNode("output")),
      normal: renderOutput(this.scenePass.getTextureNode("normal")),
      emissive: renderOutput(this.scenePass.getTextureNode("emissive")),
      // The MRT remains raw NDC velocity. Gain is presentation-only so an
      // adjacent 1/120-s state remains legible after RGBA8 diagnostic encoding.
      velocity: renderOutput(vec4(
        velocityDiagnostic.x.max(0),
        velocityDiagnostic.x.negate().max(0),
        velocityDiagnostic.y.abs(),
        1,
      ).clamp(0, 1)),
    };
    this.renderPipeline = new RenderPipeline(this.renderer);
    this.renderPipeline.outputNode = this.outputNodes[this.currentMode];
    this.renderPipeline.outputColorTransform = MOTION_PIPELINE_OWNERSHIP.outputColorTransform;
    this.captureTarget = new RenderTarget(1, 1, { type: UnsignedByteType, depthBuffer: false });
    this.captureTarget.texture.colorSpace = this.renderer.outputColorSpace;
    this.syncSemanticActorTransform();
    this.frameCamera(this.currentCamera);
    this.motionPlan.primeFrameMatrices(this.camera, this.instanceMesh);
    this.presentationHistoryStatus = "primed";
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
    if (this.reconfiguring) return getPresentationAlpha(this.policy);
    this.requireActiveDeviceGeneration();
    this.motionPlan.beginFrameMatrices();
    advanceDeltaPolicy(this.policy, delta, this._fixedStepDispatch);
    const alpha = getPresentationAlpha(this.policy);
    interpolateMotionState(this.stateSlots.render, this.stateSlots.previous, this.stateSlots.current, alpha);
    try {
      this.motionPlan.preparePresentation(this.renderer, alpha);
      this.requireActiveDeviceGeneration();
      this.syncSemanticActorTransform();
      if (this.currentScenario === "debris-release") this.frameCamera(this.currentCamera);
      this.motionPlan.captureFrameMatrices(this.camera, this.instanceMesh);
      this.renderPipeline?.render();
      this.requireActiveDeviceGeneration();
    } catch (error) {
      this.presentationHistoryStatus = "uncertain";
      throw error;
    }
    this.presentationHistoryStatus = "active";
    this.updateDebug(alpha);
    return alpha;
  }

  syncSemanticActorTransform() {
    const launchUsesLocalPresentation = this.currentScenario === "launch-and-staging";
    this.presentationOrigin.copy(
      launchUsesLocalPresentation
        ? this.stateSlots.render.position
        : this._zeroPresentationOrigin,
    );
    this.rocket?.position.copy(this.stateSlots.render.position).sub(this.presentationOrigin);
    this.rocket?.quaternion.copy(this.stateSlots.render.quaternion);
    if (this.instanceMesh) {
      this.instanceMesh.position.copy(this.presentationOrigin).negate();
      this.instanceMesh.matrixWorldNeedsUpdate = true;
    }
    if (this.stage) {
      this.stage.visible = launchUsesLocalPresentation;
      if (launchUsesLocalPresentation) {
        const stageLocalTime = this.stateSlots.render.phaseId === 1
          ? Math.max(0, this.stateSlots.render.phaseLocalTime)
          : 0;
        this.stage.position.copy(this.rocket.position).add(this._stageAttachedOffset);
        if (stageLocalTime > 0) {
          this.stage.position.addScaledVector(
            this._stageDetachedVelocity,
            stageLocalTime,
          );
        }
        this.stage.quaternion.copy(this.rocket.quaternion);
        this.stage.rotateZ(stageLocalTime * 0.12);
      }
    }
  }

  frameCamera(id = this.currentCamera) {
    exact(id, ["near", "design", "far"], "camera");
    const framing = id === "near"
      ? [0, 1.8, 7]
      : id === "far"
        ? [0, 6, 24]
        : [0, 3.5, 13];
    this._cameraTarget.copy(
      this.currentScenario === "debris-release"
        ? this.stateSlots.render.position
        : this._zeroPresentationOrigin,
    );
    this.camera.position.set(...framing).add(this._cameraTarget);
    this.camera.lookAt(this._cameraTarget);
    this.camera.updateMatrixWorld(true);
    this.currentCamera = id;
  }

  requireActiveDeviceGeneration() {
    if (
      this.rendererDeviceStatus !== "active"
      || this.rendererDeviceGeneration <= 0
      || this.renderer?.backend?.device !== this.initializedRendererDevice
      || this.renderer?._isDeviceLost === true
    ) {
      throw new Error("motion renderer device generation is not active");
    }
    return this.rendererDeviceGeneration;
  }

  bindMotionPlanToRenderer(plan) {
    const deviceGeneration = this.requireActiveDeviceGeneration();
    return plan.bindRendererDevice(this.renderer, {
      deviceGeneration,
      isDeviceGenerationActive: (generation) => (
        this.rendererDeviceStatus === "active"
        && this.rendererDeviceGeneration === generation
        && this.renderer?.backend?.device === this.initializedRendererDevice
        && this.renderer?._isDeviceLost !== true
      ),
    });
  }

  recordRendererDeviceLoss(info) {
    if (this.rendererDeviceStatus === "disposed") return;
    if (this.rendererDeviceStatus !== "lost") this.deviceLossGeneration += 1;
    this.rendererDeviceStatus = "lost";
    this.lastDeviceError = String(info?.message ?? info?.reason ?? "WebGPU device lost");
  }

  bindInitializedRendererDevice() {
    const device = requireInitializedMotionRendererDevice(this.renderer);
    this.initializedRendererDevice = device;
    this.rendererDeviceGeneration = 1;
    this.rendererDeviceStatus = "active";
    this.lossPromiseObservedOnActualDevice = true;
    this.timestampQueriesActive = this.timestampQueriesRequested
      && this.renderer.backend?.trackTimestamp === true
      && device.features?.has?.("timestamp-query") === true;
    device.lost.then((info) => {
      if (this.rendererDeviceStatus === "disposed" && info?.reason === "destroyed") return;
      this.recordRendererDeviceLoss(info);
    });
    return device;
  }

  rendererBackendEvidence() {
    const backend = this.renderer?.backend;
    const device = backend?.device;
    return {
      backendKind: "WebGPU",
      backendType: backend?.constructor?.name ?? "unknown",
      isWebGPUBackend: backend?.isWebGPUBackend === true,
      initialized: this.renderer?.initialized === true,
      deviceIdentityVerified: device === this.initializedRendererDevice,
      deviceIdentitySource: "renderer.backend.device-after-init",
      deviceType: device?.constructor?.name ?? "GPUDevice",
      deviceLabel: deviceLabel(device),
      monitoringInstalledBeforeRendererInit: this.rendererMonitoringInstalledBeforeInit,
      lossPromiseObservedOnActualDevice: this.lossPromiseObservedOnActualDevice,
      rendererDeviceGeneration: this.rendererDeviceGeneration,
      timestampQueryFeatureOnActualDevice: device?.features?.has?.("timestamp-query") === true,
      backendTimestampTrackingActive: backend?.trackTimestamp === true,
      timestampRequestMatchedActualBackend: this.timestampQueriesRequested === this.timestampQueriesActive,
    };
  }

  adapterIdentity() {
    const device = this.renderer?.backend?.device;
    return {
      source: "renderer.backend.device-after-init",
      adapterClass: classifyDevice(device),
      backendType: this.renderer?.backend?.constructor?.name ?? "unknown",
      deviceType: device?.constructor?.name ?? "GPUDevice",
      deviceLabel: deviceLabel(device),
      deviceIdentityVerified: device === this.initializedRendererDevice,
      features: device?.features ? [...device.features].sort() : [],
      limits: snapshotDeviceLimits(device?.limits),
    };
  }

  updateDebug(alpha) {
    if (!this.debugElement) return;
    this.debugElement.textContent = JSON.stringify({
      status: "native-webgpu-runtime; performance-unmeasured",
      scenario: this.stateSlots.current.scenario,
      tier: this.currentTier,
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

  installMotionMaterialNodes(plan) {
    this.instanceMaterial.positionNode = plan.createInterpolatedPositionNode();
    this.instanceMaterial.mrtNode = mrt({ velocity: plan.createVelocityNdcNode() });
    this.instanceMaterial.needsUpdate = true;
  }

  createMotionInstanceMesh(plan) {
    const mesh = new InstancedMesh(this.instanceGeometry, this.instanceMaterial, plan.buffers.instanceCount);
    // CPU instance matrices are intentionally identity-only. Storage-driven
    // vertex positions therefore cannot use the default CPU bounding sphere.
    mesh.frustumCulled = false;
    const identity = new Matrix4();
    for (let i = 0; i < plan.buffers.instanceCount; i += 1) mesh.setMatrixAt(i, identity);
    mesh.instanceMatrix.needsUpdate = true;
    plan.recordInitializationInstanceMatrixUpload(mesh.instanceMatrix.array.byteLength);
    return mesh;
  }

  async reconfigureMotion({ scenario = this.currentScenario, tier = this.currentTier } = {}) {
    exact(scenario, MOTION_SCENARIOS, "scenario");
    exact(tier, Object.keys(MOTION_TIERS), "tier");
    assertMotionRouteLock(this.route, { scenario, tier });
    if (scenario === this.currentScenario && tier === this.currentTier) return false;
    if (this.reconfiguring) throw new Error("motion reconfiguration is already in progress");
    if (this.disposed) throw new Error("motion demo is disposed");
    this.requireActiveDeviceGeneration();

    this.reconfiguring = true;
    let nextPlan = null;
    let nextMesh = null;
    let installed = false;
    let committed = false;
    const previous = {
      plan: this.motionPlan,
      mesh: this.instanceMesh,
      policy: this.policy,
      stateSlots: this.stateSlots,
      state: this.state,
      scenario: this.currentScenario,
      tier: this.currentTier,
      reparentProof: this.reparentProof,
      positionNode: this.instanceMaterial.positionNode,
      mrtNode: this.instanceMaterial.mrtNode,
      pixelRatio: this.renderer.getPixelRatio(),
      logicalSize: this.renderer.getSize(new Vector2()),
      captureWidth: this.captureTarget.width,
      captureHeight: this.captureTarget.height,
      presentationHistoryStatus: this.presentationHistoryStatus,
    };
    try {
      const nextCore = createProceduralMotionCore({
        seed: this.seed,
        scenario,
        instanceCount: MOTION_TIERS[tier].instanceCount,
        sceneUnitsPerMeter: this.sceneUnitsPerMeter,
      });
      nextPlan = nextCore.motionPlan;
      this.bindMotionPlanToRenderer(nextPlan);
      await nextPlan.seek(this.renderer, 0);
      nextMesh = this.createMotionInstanceMesh(nextPlan);
      const nextPositionNode = nextPlan.createInterpolatedPositionNode();
      const nextMrtNode = mrt({ velocity: nextPlan.createVelocityNdcNode() });
      const nextReparentProof = scenario === "quaternion-and-reparent" ? createReparentFixture() : null;

      installed = true;
      this.scene.remove(previous.mesh);
      this.instanceMaterial.positionNode = nextPositionNode;
      this.instanceMaterial.mrtNode = nextMrtNode;
      this.instanceMaterial.needsUpdate = true;
      this.scene.add(nextMesh);
      this.policy = nextCore.policy;
      this.stateSlots = nextCore.stateSlots;
      this.state = this.stateSlots.current;
      this.motionPlan = nextPlan;
      this.instanceMesh = nextMesh;
      this.currentScenario = scenario;
      this.currentTier = tier;
      this.reparentProof = nextReparentProof;
      this.syncSemanticActorTransform();
      this.frameCamera(this.currentCamera);
      this.renderer.setPixelRatio(Math.min(this.requestedDpr, MOTION_TIERS[this.currentTier].dprCap));
      this.renderer.setSize(this.logicalWidth, this.logicalHeight, false);
      this.captureTarget.setSize(this.renderer.domElement.width, this.renderer.domElement.height);
      this.motionPlan.primeFrameMatrices(this.camera, this.instanceMesh);
      this.presentationHistoryStatus = "primed-after-reconfigure";
      this.renderPipeline.needsUpdate = true;
      this.updateDebug(0);

      // Nothing after this point may roll back to the previous plan. Publish
      // the new plan first, then retire the old allocation as post-commit
      // cleanup so a late failure cannot reinstall a disposed runtime.
      committed = true;
      nextPlan = null;
      nextMesh = null;
      try {
        previous.plan.dispose();
      } catch (error) {
        this.rendererDeviceStatus = "uncertain";
        throw new AggregateError(
          [error],
          "motion reconfiguration committed but previous-plan disposal failed",
        );
      }
      return true;
    } catch (error) {
      if (committed) throw error;
      let rollbackErrors = [];
      if (installed) {
        rollbackErrors = runMotionRollback([
          () => {
            this.scene.remove(nextMesh);
            this.scene.add(previous.mesh);
          },
          () => {
            this.instanceMaterial.positionNode = previous.positionNode;
            this.instanceMaterial.mrtNode = previous.mrtNode;
            this.instanceMaterial.needsUpdate = true;
          },
          () => {
            this.policy = previous.policy;
            this.stateSlots = previous.stateSlots;
            this.state = previous.state;
            this.motionPlan = previous.plan;
            this.instanceMesh = previous.mesh;
            this.currentScenario = previous.scenario;
            this.currentTier = previous.tier;
            this.reparentProof = previous.reparentProof;
            this.syncSemanticActorTransform();
            this.frameCamera(this.currentCamera);
            this.motionPlan.primeFrameMatrices(this.camera, this.instanceMesh);
            this.presentationHistoryStatus = previous.presentationHistoryStatus;
          },
          () => {
            this.renderer.setPixelRatio(previous.pixelRatio);
            this.renderer.setSize(previous.logicalSize.x, previous.logicalSize.y, false);
            this.captureTarget.setSize(previous.captureWidth, previous.captureHeight);
          },
          () => {
            this.renderPipeline.needsUpdate = true;
          },
        ]);
      }
      if (rollbackErrors.length > 0) {
        this.rendererDeviceStatus = "uncertain";
        throw new AggregateError([error, ...rollbackErrors], "motion reconfiguration and rollback failed");
      }
      throw error;
    } finally {
      nextMesh?.dispose?.();
      nextPlan?.dispose();
      this.reconfiguring = false;
    }
  }

  createLabController() {
    const demo = this;
    return {
      async ready() {},
      async setScenario(id) {
        exact(id, MOTION_SCENARIOS, "scenario");
        return demo.reconfigureMotion({ scenario: id });
      },
      async setMode(id) {
        exact(id, MOTION_MODES, "mode");
        demo.requireActiveDeviceGeneration();
        demo.renderPipeline.outputNode = demo.outputNodes[id];
        demo.renderPipeline.needsUpdate = true;
        demo.currentMode = id;
      },
      async setTier(id) {
        exact(id, Object.keys(MOTION_TIERS), "tier");
        return demo.reconfigureMotion({ tier: id });
      },
      async setSeed(seed) {
        if (!Number.isInteger(seed)) throw new RangeError("seed must be an integer");
        demo.requireActiveDeviceGeneration();
        demo.seed = seed >>> 0;
        for (const state of Object.values(demo.stateSlots)) state.seed = demo.seed;
        await this.resetHistory("seed-change");
      },
      async setCamera(id) {
        exact(id, ["near", "design", "far"], "camera");
        demo.requireActiveDeviceGeneration();
        demo.frameCamera(id);
        demo.motionPlan.primeFrameMatrices(demo.camera, demo.instanceMesh);
        demo.presentationHistoryStatus = "primed-after-camera-change";
      },
      async setTime(seconds) {
        if (!Number.isFinite(seconds) || seconds < 0) throw new RangeError("time must be finite and >= 0");
        demo.requireActiveDeviceGeneration();
        await this.resetHistory("time-seek");
        stepTimelineState(demo.stateSlots.current, demo.policy.fixedStep, seconds);
        copyMotionState(demo.stateSlots.previous, demo.stateSlots.current);
        copyMotionState(demo.stateSlots.render, demo.stateSlots.current);
        demo.policy.simulationTime = seconds;
        demo.policy.presentationTime = seconds;
        demo.motionPlan.resetState({ nextSeed: demo.seed, time: 0 });
        await demo.motionPlan.seek(demo.renderer, seconds);
        demo.syncSemanticActorTransform();
        demo.frameCamera(demo.currentCamera);
        demo.motionPlan.primeFrameMatrices(demo.camera, demo.instanceMesh);
        demo.presentationHistoryStatus = "primed-after-seek";
      },
      async step(deltaSeconds) { return demo.advanceFrame(deltaSeconds); },
      async resetHistory() {
        demo.requireActiveDeviceGeneration();
        for (const state of Object.values(demo.stateSlots)) resetMotionState(state);
        stepTimelineState(demo.stateSlots.current, 0, 0);
        copyMotionState(demo.stateSlots.previous, demo.stateSlots.current);
        copyMotionState(demo.stateSlots.render, demo.stateSlots.current);
        Object.assign(demo.policy, createDeltaPolicy());
        demo.motionPlan.resetState({ nextSeed: demo.seed, time: 0 });
        await demo.motionPlan.seek(demo.renderer, 0);
        demo.renderPipeline.needsUpdate = true;
        demo.syncSemanticActorTransform();
        demo.frameCamera(demo.currentCamera);
        demo.motionPlan.primeFrameMatrices(demo.camera, demo.instanceMesh);
        demo.presentationHistoryStatus = "primed-after-reset";
      },
      async resize(width, height, dpr = 1) {
        if (![width, height, dpr].every((value) => Number.isFinite(value) && value > 0)) throw new RangeError("invalid resize");
        demo.requireActiveDeviceGeneration();
        demo.logicalWidth = width;
        demo.logicalHeight = height;
        demo.requestedDpr = dpr;
        demo.renderer.setPixelRatio(Math.min(demo.requestedDpr, MOTION_TIERS[demo.currentTier].dprCap));
        demo.renderer.setSize(width, height, false);
        demo.captureTarget.setSize(demo.renderer.domElement.width, demo.renderer.domElement.height);
        demo.camera.aspect = width / height;
        demo.camera.updateProjectionMatrix();
        demo.motionPlan.primeFrameMatrices(demo.camera, demo.instanceMesh);
        demo.presentationHistoryStatus = "primed-after-resize";
        demo.renderPipeline.needsUpdate = true;
      },
      async renderOnce() {
        demo.requireActiveDeviceGeneration();
        demo.syncSemanticActorTransform();
        demo.renderPipeline.render();
      },
      async capturePixels(target = "output") {
        const openingDeviceGeneration = demo.requireActiveDeviceGeneration();
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
            if (demo.requireActiveDeviceGeneration() !== openingDeviceGeneration) {
              throw new Error("motion renderer device generation changed during presentation readback");
            }
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
        if (demo.requireActiveDeviceGeneration() !== openingDeviceGeneration) {
          throw new Error("motion renderer device generation changed during MRT readback");
        }
        return { target, width: rt.width, height: rt.height, bytesPerRow: strideFor(pixels, rt.width, rt.height), pixels };
      },
      async captureStorage(count = 16) {
        demo.requireActiveDeviceGeneration();
        return demo.motionPlan.readback(demo.renderer, count);
      },
      describePipeline() {
        return {
          runtimeProfile: demo.runtimeProfile,
          performanceTimestampMode: demo.performanceTimestampMode,
          timestampQueriesRequired: demo.timestampQueriesRequired,
          timestampQueriesRequested: demo.timestampQueriesRequested,
          timestampQueriesActive: demo.timestampQueriesActive,
          owners: {
            renderer: MOTION_PIPELINE_OWNERSHIP.rendererOwner,
            renderPipeline: MOTION_PIPELINE_OWNERSHIP.renderPipelineOwner,
            motion: MOTION_PIPELINE_OWNERSHIP.motionOwner,
            output: MOTION_PIPELINE_OWNERSHIP.finalOutputTransformOwner,
          },
          signals: ["output", "normal", "emissive", "velocity"],
          diagnosticModes: ["normal", "emissive", "velocity"],
          diagnosticTransforms: {
            velocity: {
              sourceSignal: "raw-current-presented-minus-previous-presented-ndc",
              presentationInterpolation: "hemisphere-safe quaternion slerp plus linear position interpolation",
              rawSignalScale: 1,
              presentationGain: MOTION_VELOCITY_DIAGNOSTIC_GAIN,
              channelMap: "R=positive-x, G=negative-x, B=absolute-y, zero=black",
            },
          },
          presentationGraph: {
            kind: "direct-render-output",
            selectedOutputNode: demo.currentMode,
            reachableOutputNodes: [...MOTION_MODES],
            postProcessingStages: [],
          },
          scenario: demo.currentScenario,
          tier: demo.currentTier,
          presentationOrigin: {
            owner: "procedural-motion-core",
            policy: demo.currentScenario === "launch-and-staging" ? "camera-relative-launch" : "world-origin",
            value: demo.presentationOrigin.toArray(),
            metadata: MOTION_ORIGIN_METADATA,
          },
          presentationHistoryStatus: demo.presentationHistoryStatus,
          semanticActorVelocityPolicy: {
            rocket: "explicit-zero; semantic cue excluded from storage-motion-vector claim",
            detachedStage: "explicit-zero; discontinuous visibility/reparent cue excluded from storage-motion-vector claim",
          },
          cameraTrackingPolicy: demo.currentScenario === "debris-release"
            ? "actor-relative-debris-framing"
            : "origin-framing",
          stagingPresentation: MOTION_STAGE_PRESENTATION,
          sceneSubmissions: [{ id: "motion-scene-pass", kind: "lit" }],
          computeDispatches: [
            { id: "motion:integrate-previous-current-transform", count: demo.motionPlan.buffers.dispatchCount },
            { id: "motion:prepare-consecutive-presented-transform", count: demo.motionPlan.buffers.presentationDispatchCount },
            { id: "motion:bind-static-metadata", count: demo.motionPlan.buffers.staticMetadataDispatchCount },
          ],
          resources: demo.motionPlan.describeStorage().resources,
          litSceneSubmissionCount: MOTION_PIPELINE_OWNERSHIP.litSceneSubmissionCount,
          outputColorTransform: demo.renderPipeline.outputColorTransform,
          finalToneMapOwner: MOTION_PIPELINE_OWNERSHIP.finalToneMapOwner,
          finalOutputTransformOwner: MOTION_PIPELINE_OWNERSHIP.finalOutputTransformOwner,
        };
      },
      describeResources() {
        const storage = demo.motionPlan.describeStorage();
        return {
          storageBytes: demo.motionPlan.storageBytes,
          storage,
          runtimeReachableStorageResources: storage.resources,
          instanceMatrixBytes: demo.instanceMesh.instanceMatrix.array.byteLength,
          submission: demo.motionPlan.describeSubmission(),
          renderTargets: ["output", "normal", "emissive", "velocity", "depth"],
          stagePresentationGeometryBytes: demo.stageGeometry?.attributes?.position?.array?.byteLength ?? 0,
          originMetadata: MOTION_ORIGIN_METADATA,
        };
      },
      getMetrics() {
        const gpuTimingEvidence = describeMotionGpuTiming(demo.timestampQueriesActive);
        return {
          labId: "webgpu-procedural-timelines",
          threeRevision: REVISION,
          runtimeProfile: demo.runtimeProfile,
          performanceTimestampMode: demo.performanceTimestampMode,
          timestampQueriesRequired: demo.timestampQueriesRequired,
          timestampQueriesRequested: demo.timestampQueriesRequested,
          timestampQueriesActive: demo.timestampQueriesActive,
          nativeWebGPU: demo.renderer.backend?.isWebGPUBackend === true,
          initialized: demo.renderer.initialized === true,
          rendererType: "WebGPURenderer",
          backend: demo.renderer.backend?.isWebGPUBackend === true ? "WebGPU" : "unsupported",
          backendKind: demo.renderer.backend?.isWebGPUBackend === true ? "WebGPU" : "unsupported",
          rendererBackend: demo.renderer.backend?.constructor?.name ?? "unknown",
          rendererDeviceStatus: demo.rendererDeviceStatus,
          rendererDeviceGeneration: demo.rendererDeviceGeneration,
          deviceLossGeneration: demo.deviceLossGeneration,
          rendererBackendEvidence: demo.rendererBackendEvidence(),
          adapterClass: classifyDevice(demo.renderer.backend?.device),
          adapterIdentity: demo.adapterIdentity(),
          scenario: demo.currentScenario,
          mode: demo.currentMode,
          tier: demo.currentTier,
          camera: demo.currentCamera,
          seed: demo.seed,
          timeSeconds: demo.policy.simulationTime,
          deviceErrorCount: demo.deviceErrorCount,
          lastDeviceError: demo.lastDeviceError,
          gpuTiming: gpuTimingEvidence.verdict,
          gpuTimingReason: gpuTimingEvidence.reason,
          simulationSteps: demo.policy.simulationSteps,
          dispatchCount: demo.motionPlan.buffers.dispatchCount,
          storageBytes: demo.motionPlan.storageBytes,
          storageState: demo.motionPlan.describeStorage(),
          presentationHistoryStatus: demo.presentationHistoryStatus,
          originMetadata: MOTION_ORIGIN_METADATA,
          submission: demo.motionPlan.describeSubmission(),
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
    this.stageGeometry?.dispose();
    this.stageMaterial?.dispose();
    this.instanceGeometry?.dispose();
    this.instanceMaterial?.dispose();
    this.motionPlan?.dispose();
    this.captureTarget?.dispose();
    this.scenePass?.dispose?.();
    this.renderPipeline?.dispose?.();
    this.rendererDeviceStatus = "disposed";
    this.renderer?.dispose?.();
  }
}

export function createProceduralTimelineDemo(options) {
  return new ProceduralTimelineDemo(options);
}
