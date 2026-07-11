import {
  AmbientLight,
  BoxGeometry,
  DirectionalLight,
  Group,
  Mesh,
  MeshStandardNodeMaterial,
  PerspectiveCamera,
  Quaternion,
  REVISION,
  RenderPipeline,
  RenderTarget,
  Scene,
  Sphere,
  Vector2,
  Vector3,
  WebGPURenderer,
  UnsignedByteType,
} from "three/webgpu";
import {
  color,
  emissive,
  float,
  mrt,
  normalView,
  output,
  pass,
  positionLocal,
  renderOutput,
  velocity,
} from "three/tsl";

import {
  CAMERA_MODES,
  CAMERA_TIERS,
  CameraDirectionController,
  OrbitIntentAdapter,
  PointerLookIntentAdapter,
  ProjectionJitterOwner,
  computeScreenOccupancy,
} from "./CameraDirectionController.mjs";
import { CameraRelativeOrigin } from "./CameraRelativeOrigin.mjs";
import { CAMERA_MECHANISMS, assertCameraRouteLock, parseCameraRoute } from "./routeState.mjs";

const CAMERA_IDS = Object.freeze(["design", "near", "far"]);
const FIXED_SEEDS = Object.freeze([0x00000001, 0x9e3779b9]);

function requireChoice(value, allowed, label) {
  if (!allowed.includes(value)) throw new RangeError(`unknown camera ${label}: ${value}`);
  return value;
}

function resolveReadbackStride(pixels, width, height) {
  const rowBytes = width * 4 * pixels.BYTES_PER_ELEMENT;
  if (height <= 1 || pixels.byteLength === rowBytes * height) return rowBytes;
  const aligned = Math.ceil(rowBytes / 256) * 256;
  if (
    pixels.byteLength === aligned * height ||
    pixels.byteLength === aligned * (height - 1) + rowBytes
  ) return aligned;
  const inferred = (pixels.byteLength - rowBytes) / (height - 1);
  if (!Number.isInteger(inferred) || inferred < rowBytes || inferred % pixels.BYTES_PER_ELEMENT !== 0) {
    throw new Error(`invalid WebGPU readback stride: ${inferred}`);
  }
  return inferred;
}

/** Host-consumable camera core: creates no renderer, DOM listeners, or loop. */
export function createCameraRigCore({
  camera,
  subject = null,
  subjectBounds = new Sphere(new Vector3(), 1),
  tier = "full",
  origin = new Vector3(),
  objectGlobal = new Vector3(),
} = {}) {
  if (!camera) throw new TypeError("createCameraRigCore requires a camera");
  const controller = new CameraDirectionController(camera, { subject, subjectBounds, tier });
  const originState = new CameraRelativeOrigin().setInitial(origin, objectGlobal);
  return {
    controller,
    originState,
    descriptor: Object.freeze({
      poseOwner: "camera-controller",
      projectionOwner: "host-or-camera-controller",
      originOwner: "camera-relative-origin",
      semanticModes: CAMERA_MODES,
      qualityTiers: Object.keys(CAMERA_TIERS),
      mechanisms: CAMERA_MECHANISMS,
    }),
    dispose() {
      controller.dispose();
      originState.dispose();
    },
  };
}

export async function createCameraRigDemo({
  canvas,
  documentRef = globalThis.document,
  locationRef = globalThis.location,
  startAnimationLoop = true,
} = {}) {
  if (!canvas) throw new TypeError("createCameraRigDemo requires a canvas");
  const route = parseCameraRoute(locationRef);
  const renderer = new WebGPURenderer({
    canvas,
    antialias: false,
    reversedDepthBuffer: true,
    trackTimestamp: true,
  });
  await renderer.init();
  if (renderer.backend?.isWebGPUBackend !== true) {
    throw new Error("WebGPU backend required for the canonical camera rig lab");
  }

  const scene = new Scene();
  const width = Math.max(1, canvas.clientWidth || canvas.width || 1);
  const height = Math.max(1, canvas.clientHeight || canvas.height || 1);
  const initialDpr = Math.min(globalThis.devicePixelRatio || 1, CAMERA_TIERS[route.tier].dprCap);
  renderer.setPixelRatio(initialDpr);
  renderer.setSize(width, height, false);

  const camera = new PerspectiveCamera(50, width / height, 0.3, 2000);
  camera.position.set(0, 2, 12);
  camera.updateProjectionMatrix();

  const subjectGeometry = new BoxGeometry(1.5, 0.8, 4);
  const subjectMaterial = new MeshStandardNodeMaterial();
  subjectMaterial.colorNode = color(0x7896e8);
  subjectMaterial.emissiveNode = color(0x071126);
  subjectMaterial.roughnessNode = float(0.42);
  subjectMaterial.metalnessNode = float(0.18);
  const subject = new Mesh(subjectGeometry, subjectMaterial);
  subject.quaternion.setFromAxisAngle(new Vector3(0.27, 0.91, -0.31).normalize(), 0.63);
  scene.add(subject);
  // The visible mesh is translated in the vertex graph from storage. The
  // camera follows this CPU-double mirror so both systems use the same
  // camera-relative frame without double-applying the offset.
  const rigSubject = new Group();
  rigSubject.quaternion.copy(subject.quaternion);
  scene.add(new AmbientLight(0x9fb5df, 1.1));
  const keyLight = new DirectionalLight(0xffffff, 4.5);
  keyLight.position.set(4, 8, 7);
  scene.add(keyLight);

  const core = createCameraRigCore({
    camera,
    subject: rigSubject,
    subjectBounds: new Sphere(new Vector3(), 2.2),
    tier: route.tier,
    origin: new Vector3(1_000_000_000, -2_000_000_000, 3_000_000_000),
    objectGlobal: new Vector3(1_000_000_000, -2_000_000_000, 3_000_000_000),
  });
  const { controller, originState } = core;
  rigSubject.position.copy(originState.currentRelative);
  rigSubject.updateMatrixWorld(true);
  subject.updateMatrixWorld(true);
  camera.updateMatrixWorld(true);
  originState.setInitialMatrices(camera, subject);
  const originNodes = originState.createTslContract();
  subjectMaterial.positionNode = positionLocal.add(originNodes.positionOffset);
  controller.mode = route.mode;
  controller.setThrust(0.65);

  const scenePass = pass(scene, camera);
  scenePass.setMRT(mrt({
    output,
    normal: normalView,
    emissive,
    velocity: route.mechanism === "floating-origin" ? originNodes.velocityNdc : velocity,
  }));
  const renderPipeline = new RenderPipeline(renderer);
  renderPipeline.outputNode = renderOutput(scenePass.getTextureNode("output"));
  renderPipeline.outputColorTransform = false;
  const captureTarget = new RenderTarget(1, 1, { type: UnsignedByteType, depthBuffer: false });
  captureTarget.texture.colorSpace = renderer.outputColorSpace;

  const debugElement = documentRef?.querySelector?.("[data-camera-debug]") ?? null;
  const debugForward = new Vector3();
  const drawingBufferSize = new Vector2();
  const jitterOwner = new ProjectionJitterOwner();
  const occupancy = {
    vertical: 0,
    horizontal: 0,
    minView: new Vector2(),
    maxView: new Vector2(),
  };
  const pointerAdapter = new PointerLookIntentAdapter(canvas).connect();
  const orbitAdapter = new OrbitIntentAdapter(canvas).connect();
  pointerAdapter.enabled = route.mechanism === "pointer-orbit-and-collision";
  orbitAdapter.enabled = route.mechanism === "pointer-orbit-and-collision";
  if (route.mechanism === "pointer-orbit-and-collision") controller.mode = "inspection";
  const orbitIntent = { yaw: 0, pitch: 0, zoomLog: 0 };
  let orbitYaw = 0;
  let orbitPitch = 0;

  const buttonHandlers = [];
  for (const button of documentRef?.querySelectorAll?.("[data-camera-mode]") ?? []) {
    const handler = () => controller.startHandoff(button.dataset.cameraMode);
    button.addEventListener("click", handler);
    buttonHandlers.push({ button, handler });
  }

  let seed = FIXED_SEEDS[0];
  let timeSeconds = 0;
  let lastTimestamp = 0;
  let disposed = false;
  const animatedOrigin = new Vector3();

  function updateDebug(mode) {
    if (!debugElement) return;
    camera.updateMatrixWorld(true);
    camera.getWorldDirection(debugForward);
    const target = controller.subjectWorldPosition(controller.scratch.target);
    const distance = Math.max(0.001, camera.position.distanceTo(target));
    computeScreenOccupancy(camera, distance, controller.subjectRadius(), controller.scratch, occupancy);
    debugElement.textContent = JSON.stringify({
      status: "native-webgpu-runtime; performance-unmeasured",
      mechanism: route.mechanism,
      tier: controller.tier,
      mode,
      seed,
      cameraPosition: camera.position.toArray().map((value) => Number(value.toFixed(4))),
      forward: debugForward.toArray().map((value) => Number(value.toFixed(4))),
      occupancy: {
        vertical: Number(occupancy.vertical.toFixed(4)),
        horizontal: Number(occupancy.horizontal.toFixed(4)),
      },
      bodyBasis: {
        forward: controller.scratch.bodyForward.toArray(),
        right: controller.scratch.bodyRight.toArray(),
        up: controller.scratch.bodyUp.toArray(),
      },
      origin: originState.describe(),
      mrt: ["output", "normal", "emissive", "velocity"],
      finalOutputOwner: "renderOutput",
      outputColorTransform: renderPipeline.outputColorTransform,
    }, null, 2);
  }

  function advanceFrame(deltaSeconds) {
    if (!Number.isFinite(deltaSeconds) || deltaSeconds < 0) throw new RangeError("deltaSeconds must be finite and >= 0");
    timeSeconds += deltaSeconds;
    if (route.mechanism === "pointer-orbit-and-collision") {
      const phase = timeSeconds % 4;
      controller.setObstructionDistance(phase < 1.5 ? 5.5 : Infinity);
      orbitAdapter.consume(orbitIntent);
      orbitYaw += orbitIntent.yaw;
      orbitPitch += orbitIntent.pitch;
      controller.setInspectionIntent(
        0.75 + pointerAdapter.yaw + orbitYaw,
        0.25 + pointerAdapter.pitch + orbitPitch,
        orbitIntent.zoomLog,
      );
    }
    if (route.mechanism === "floating-origin") {
      originState.beginFrame();
      originState.currentObject.x = 1_000_000_000 + Math.sin(timeSeconds) * 0.25;
      if (Math.floor(timeSeconds) % 2 === 1) {
        animatedOrigin.set(
          1_000_000_000 + Math.floor(timeSeconds),
          -2_000_000_000,
          3_000_000_000,
        );
        originState.rebase(animatedOrigin);
      }
      originState.commit();
      rigSubject.position.copy(originState.currentRelative);
      rigSubject.quaternion.copy(subject.quaternion);
      rigSubject.updateMatrixWorld(true);
    }
    const mode = controller.update(deltaSeconds);
    if (route.mechanism === "floating-origin") {
      camera.updateMatrixWorld(true);
      subject.updateWorldMatrix(true, false);
      originState.setCurrentMatrices(camera, subject);
    }
    updateDebug(mode);
    return mode;
  }

  function renderFrame() {
    camera.updateMatrixWorld(true);
    if (route.mechanism === "shared-jitter-and-velocity") {
      renderer.getDrawingBufferSize(drawingBufferSize);
      jitterOwner.begin(camera, drawingBufferSize.x, drawingBufferSize.y);
      try {
        renderPipeline.render();
      } finally {
        jitterOwner.end(camera);
      }
    } else {
      renderPipeline.render();
    }
  }

  const labController = {
    async ready() {},
    async setScenario(id) {
      requireChoice(id, CAMERA_MECHANISMS, "scenario");
      assertCameraRouteLock(route, { mechanism: id });
    },
    async setMode(id) {
      requireChoice(id, CAMERA_MODES, "mode");
      controller.startHandoff(id, 0.8);
    },
    async setTier(id) {
      requireChoice(id, Object.keys(CAMERA_TIERS), "tier");
      assertCameraRouteLock(route, { tier: id });
      controller.setTier(id);
      renderer.setPixelRatio(Math.min(globalThis.devicePixelRatio || 1, CAMERA_TIERS[id].dprCap));
    },
    async setSeed(value) {
      if (!Number.isInteger(value)) throw new RangeError("seed must be an integer");
      seed = value >>> 0;
    },
    async setCamera(id) {
      requireChoice(id, CAMERA_IDS, "camera");
      const radius = controller.subjectRadius();
      if (id === "near") camera.near = Math.max(0.05, radius * 0.04);
      else if (id === "far") camera.far = radius * 200;
      else {
        camera.near = 0.3;
        camera.far = 2000;
      }
      camera.updateProjectionMatrix();
    },
    async setTime(seconds) {
      if (!Number.isFinite(seconds) || seconds < 0) throw new RangeError("time must be finite and >= 0");
      timeSeconds = seconds;
    },
    async step(deltaSeconds) {
      return advanceFrame(deltaSeconds);
    },
    async resetHistory() {
      originState.setInitial(originState.currentOrigin, originState.currentObject);
      camera.updateMatrixWorld(true);
      subject.updateWorldMatrix(true, false);
      originState.setInitialMatrices(camera, subject).commit();
      jitterOwner.reset();
      renderPipeline.needsUpdate = true;
    },
    async resize(nextWidth, nextHeight, dpr = 1) {
      if (![nextWidth, nextHeight, dpr].every((value) => Number.isFinite(value) && value > 0)) {
        throw new RangeError("resize dimensions and DPR must be finite and > 0");
      }
      renderer.setPixelRatio(Math.min(dpr, CAMERA_TIERS[controller.tier].dprCap));
      renderer.setSize(nextWidth, nextHeight, false);
      captureTarget.setSize(renderer.domElement.width, renderer.domElement.height);
      camera.aspect = nextWidth / nextHeight;
      camera.updateProjectionMatrix();
      renderPipeline.needsUpdate = true;
    },
    async renderOnce() {
      renderFrame();
    },
    async capturePixels(target = "output") {
      if (target === "presentation") {
        captureTarget.setSize(renderer.domElement.width, renderer.domElement.height);
        const previousTarget = renderer.getRenderTarget();
        try {
          renderer.setRenderTarget(captureTarget);
          renderPipeline.render();
          const pixels = await renderer.readRenderTargetPixelsAsync(
            captureTarget,
            0,
            0,
            captureTarget.width,
            captureTarget.height,
          );
          return {
            target,
            width: captureTarget.width,
            height: captureTarget.height,
            format: "rgba8unorm",
            outputColorSpace: renderer.outputColorSpace,
            bytesPerPixel: 4,
            bytesPerRow: resolveReadbackStride(pixels, captureTarget.width, captureTarget.height),
            pixels,
          };
        } finally {
          renderer.setRenderTarget(previousTarget);
        }
      }
      const targets = ["output", "normal", "emissive", "velocity"];
      const textureIndex = targets.indexOf(target);
      if (textureIndex < 0) throw new RangeError(`unknown camera capture target: ${target}`);
      await this.renderOnce();
      const renderTarget = scenePass.renderTarget;
      const captureWidth = renderTarget.width;
      const captureHeight = renderTarget.height;
      const pixels = await renderer.readRenderTargetPixelsAsync(
        renderTarget,
        0,
        0,
        captureWidth,
        captureHeight,
        textureIndex,
      );
      return {
        target,
        width: captureWidth,
        height: captureHeight,
        bytesPerRow: resolveReadbackStride(pixels, captureWidth, captureHeight),
        pixels,
      };
    },
    describePipeline() {
      return {
        owners: {
          renderer: "webgpu-camera-rig",
          camera: "camera-controller",
          output: "renderOutput",
          toneMap: "renderOutput",
          origin: "camera-relative-origin",
          velocity: route.mechanism === "floating-origin" ? "camera-relative-origin" : "three-velocity-node",
        },
        signals: ["output", "normal", "emissive", "velocity"],
        sceneSubmissions: [{ id: "camera-scene-pass", kind: "lit" }],
        computeDispatches: [],
        resources: [{ id: "camera-origin-storage", bytes: originState.array.byteLength }],
        finalToneMapOwner: "renderOutput",
        finalOutputTransformOwner: "renderOutput",
      };
    },
    describeResources() {
      return {
        storage: [{ id: "camera-origin-storage", bytes: originState.array.byteLength, records: 8 }],
        renderTargets: ["output", "normal", "emissive", "velocity", "depth"],
      };
    },
    getMetrics() {
      return {
        rendererBackend: renderer.backend?.isWebGPUBackend === true ? "WebGPU" : "unsupported",
        threeRevision: REVISION,
        mechanism: route.mechanism,
        tier: controller.tier,
        timeSeconds,
        originEpoch: originState.epoch,
        gpuTiming: renderer.hasFeature?.("timestamp-query") ? "available-not-yet-resolved" : "INSUFFICIENT_EVIDENCE",
      };
    },
    async dispose() {
      if (disposed) return;
      disposed = true;
      renderer.setAnimationLoop(null);
      for (const { button, handler } of buttonHandlers) button.removeEventListener("click", handler);
      pointerAdapter.dispose();
      orbitAdapter.dispose();
      core.dispose();
      subjectGeometry.dispose();
      subjectMaterial.dispose();
      captureTarget.dispose();
      renderPipeline.dispose?.();
      renderer.dispose();
    },
  };

  if (startAnimationLoop) {
    renderer.setAnimationLoop((timestamp) => {
      const dt = lastTimestamp === 0 ? 0 : Math.min((timestamp - lastTimestamp) / 1000, 1 / 20);
      lastTimestamp = timestamp;
      advanceFrame(dt);
      renderFrame();
    });
  }

  return {
    renderer,
    renderPipeline,
    scenePass,
    scene,
    camera,
    controller,
    originState,
    route,
    labController,
    dispose: () => labController.dispose(),
  };
}

export { resolveReadbackStride };
