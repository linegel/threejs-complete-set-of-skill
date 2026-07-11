import * as THREE from "three/webgpu";
import {
  color,
  emissive,
  mrt,
  normalView,
  output,
  pass,
  renderOutput,
} from "three/tsl";

import { buildFrameFixture } from "./frame-profile.js";
import { buildBranchRingFixture } from "./branch-rings.js";
import { createRealBatchingStrategies } from "./batching-demo.js";
import {
  beginDynamicUpdateFrame,
  configureDynamicGeometry,
  updateVertexRange,
} from "./dynamic-updates.js";

export const GEOMETRY_MODES = Object.freeze([
  "frame-and-rail-profile",
  "branch-rings",
  "semantic-groups-and-materials",
  "batching-comparison",
  "dynamic-updates",
  "indirect-draw",
]);
export const GEOMETRY_TIERS = Object.freeze(["hero", "standard", "crowd"]);
export const GEOMETRY_DPR_CAPS = Object.freeze({ hero: 2, standard: 1.5, crowd: 1 });
export const GEOMETRY_CAMERAS = Object.freeze(["near", "design", "far"]);
export const GEOMETRY_SEEDS = Object.freeze([0x00000001, 0x9e3779b9]);

const CAMERA_POSES = Object.freeze({
  near: { position: [2.3, 1.2, 3.0], target: [1.6, 0.35, 0] },
  design: { position: [5.8, 3.6, 8.2], target: [1.1, 0.7, 0] },
  far: { position: [9.5, 6.3, 14.5], target: [0.8, 0.8, 0] },
});

const assertKnown = (value, values, label) => {
  if (!values.includes(value)) throw new RangeError(`Unknown ${label} "${value}"`);
};

export function resolveGeometryDpr(tier, requestedDpr) {
  assertKnown(tier, GEOMETRY_TIERS, "tier");
  if (!(requestedDpr > 0) || !Number.isFinite(requestedDpr)) {
    throw new RangeError("requested DPR must be finite and positive");
  }
  return Math.min(requestedDpr, GEOMETRY_DPR_CAPS[tier]);
}

function nodeMaterial(hex, { roughness = 0.6, metalness = 0.05 } = {}) {
  const material = new THREE.MeshStandardNodeMaterial();
  material.colorNode = color(hex);
  material.roughness = roughness;
  material.metalness = metalness;
  return material;
}

function disposeObject(root) {
  const geometries = new Set();
  const materials = new Set();
  root?.traverse?.((object) => {
    if (object.geometry) geometries.add(object.geometry);
    if (Array.isArray(object.material)) object.material.forEach((material) => materials.add(material));
    else if (object.material) materials.add(object.material);
  });
  geometries.forEach((geometry) => geometry.dispose());
  materials.forEach((material) => material.dispose());
}

function seededSigned(seed, lane) {
  let value = (seed ^ Math.imul(lane + 1, 0x85ebca6b)) >>> 0;
  value ^= value >>> 16;
  value = Math.imul(value, 0x7feb352d) >>> 0;
  value ^= value >>> 15;
  return (value / 0xffffffff) * 2 - 1;
}

export async function createGeometryLabController({
  canvas,
  width = 1200,
  height = 800,
  dpr = 1,
  mode = "frame-and-rail-profile",
  tier = "hero",
  seed = GEOMETRY_SEEDS[0],
  camera = "design",
} = {}) {
  assertKnown(mode, GEOMETRY_MODES, "mode");
  assertKnown(tier, GEOMETRY_TIERS, "tier");
  assertKnown(seed, GEOMETRY_SEEDS, "seed");
  assertKnown(camera, GEOMETRY_CAMERAS, "camera");

  const renderer = new THREE.WebGPURenderer({
    canvas,
    antialias: false,
    outputBufferType: THREE.HalfFloatType,
    trackTimestamp: true,
  });
  await renderer.init();
  if (renderer.backend.isWebGPUBackend !== true) {
    throw new Error("WebGPU is required for the canonical semantic-mesh-writer lab; no fallback was activated.");
  }

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x11171d);
  const perspectiveCamera = new THREE.PerspectiveCamera(42, width / height, 0.05, 120);
  const contentRoot = new THREE.Group();
  contentRoot.name = "semantic-mesh-writer-content";
  scene.add(contentRoot);

  const floorMaterial = nodeMaterial(0x313940, { roughness: 0.88, metalness: 0 });
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(18, 12), floorMaterial);
  floor.rotation.x = -Math.PI / 2;
  floor.position.y = -1.05;
  scene.add(floor);
  scene.add(new THREE.HemisphereLight(0xdce8ff, 0x17130f, 1.25));
  const key = new THREE.DirectionalLight(0xffffff, 3.5);
  key.position.set(4, 8, 6);
  scene.add(key);

  const renderPipeline = new THREE.RenderPipeline(renderer);
  const scenePass = pass(scene, perspectiveCamera);
  scenePass.setMRT(mrt({ output, normal: normalView, emissive }));
  renderPipeline.outputColorTransform = false;
  renderPipeline.outputNode = renderOutput(scenePass.getTextureNode("output"));
  renderPipeline.needsUpdate = true;
  const captureTarget = new THREE.RenderTarget(1, 1, {
    type: THREE.UnsignedByteType,
    depthBuffer: false,
  });
  captureTarget.texture.colorSpace = renderer.outputColorSpace;

  let currentMode = mode;
  let currentTier = tier;
  let requestedDpr = dpr;
  let appliedDpr = resolveGeometryDpr(currentTier, requestedDpr);
  let currentSeed = seed;
  let currentCamera = camera;
  let currentTime = 0;
  let currentContent = null;
  let currentDisposer = null;
  let computeNodes = [];
  let currentIndirectFixture = null;
  let latestIndirectProof = null;
  let dynamicOffset = 0;
  let disposed = false;

  function applyCamera(id) {
    const pose = CAMERA_POSES[id];
    perspectiveCamera.position.fromArray(pose.position);
    perspectiveCamera.lookAt(...pose.target);
    perspectiveCamera.updateMatrixWorld(true);
  }

  function applyResolutionPolicy() {
    appliedDpr = resolveGeometryDpr(currentTier, requestedDpr);
    renderer.setPixelRatio(appliedDpr);
    renderer.setSize(width, height, false);
    captureTarget.setSize(renderer.domElement.width, renderer.domElement.height);
    scenePass.setSize(width, height);
    perspectiveCamera.aspect = width / height;
    perspectiveCamera.updateProjectionMatrix();
  }

  function clearContent() {
    if (currentContent) contentRoot.remove(currentContent);
    currentDisposer?.();
    if (!currentDisposer) disposeObject(currentContent);
    currentContent = null;
    currentDisposer = null;
    computeNodes = [];
    currentIndirectFixture = null;
    latestIndirectProof = null;
    dynamicOffset = 0;
  }

  function buildFrame({ grouped = false, dynamic = false } = {}) {
    const geometry = buildFrameFixture({ tier: currentTier, railLength: 4.2, railWidth: 0.72 });
    if (dynamic) configureDynamicGeometry(geometry);
    const palette = grouped
      ? [0xd1a15c, 0x4c4138, 0x8a6f55, 0xb66f3c]
      : [0xc6a36a, 0xc6a36a, 0xc6a36a, 0xc6a36a];
    const materials = palette.map((hex) => nodeMaterial(hex, { roughness: 0.45, metalness: 0.18 }));
    const mesh = new THREE.Mesh(geometry, materials);
    mesh.position.set(-2.1, -0.85, 0);
    mesh.rotation.x = -0.14;
    mesh.name = dynamic ? "dynamic-profile-rail" : "exact-capacity-profile-rail";
    if (dynamic) dynamicOffset = 0;
    return mesh;
  }

  function buildBranch() {
    const wobble = seededSigned(currentSeed, 4) * 0.08;
    const geometry = buildBranchRingFixture({
      radialSegments: currentTier === "hero" ? 18 : currentTier === "standard" ? 12 : 6,
      centers: [[0, 0, 0], [0.2 + wobble, 0.8, 0.05], [-0.12, 1.65, 0.2], [0.22, 2.45, 0.04], [0.02, 3.35, -0.08]],
      twists: [0, 0.08, -0.06, 0.12, 0.18],
    });
    const materials = [nodeMaterial(0x775238, { roughness: 0.82 }), nodeMaterial(0x9b7652, { roughness: 0.75 })];
    const mesh = new THREE.Mesh(geometry, materials);
    mesh.position.set(0, -0.95, 0);
    mesh.name = "parallel-transport-branch-rings";
    return mesh;
  }

  function buildContent() {
    clearContent();
    if (currentMode === "branch-rings") currentContent = buildBranch();
    else if (currentMode === "batching-comparison" || currentMode === "indirect-draw") {
      const strategies = createRealBatchingStrategies({ count: currentTier === "crowd" ? 4 : 8 });
      currentContent = strategies.root;
      currentDisposer = strategies.dispose;
      computeNodes = strategies.computeNodes;
      currentIndirectFixture = strategies.indirectFixture;
      if (currentMode === "indirect-draw") {
        for (const [id, entry] of Object.entries(strategies.strategies)) entry.object.visible = id === "indirect";
      }
    } else {
      currentContent = buildFrame({
        grouped: currentMode === "semantic-groups-and-materials",
        dynamic: currentMode === "dynamic-updates",
      });
    }
    contentRoot.add(currentContent);
    contentRoot.updateMatrixWorld(true);
  }

  function applyDynamicTime() {
    if (currentMode !== "dynamic-updates" || !currentContent) return;
    const geometry = currentContent.geometry;
    const nextOffset = Math.sin(currentTime * 2.2) * 0.015;
    const delta = nextOffset - dynamicOffset;
    if (Math.abs(delta) <= 1e-12) return;
    beginDynamicUpdateFrame(geometry);
    const count = Math.min(24, geometry.attributes.position.count - 8);
    updateVertexRange(geometry, {
      startVertex: 8,
      vertexCount: count,
      positionDelta: [0, 0, delta],
    });
    dynamicOffset = nextOffset;
  }

  buildContent();
  applyCamera(currentCamera);

  const controller = {
    async ready() {},
    async setScenario(id) {
      assertKnown(id, GEOMETRY_MODES, "scenario");
      await this.setMode(id);
    },
    async setMode(id) {
      assertKnown(id, GEOMETRY_MODES, "mode");
      currentMode = id;
      buildContent();
    },
    async setTier(id) {
      assertKnown(id, GEOMETRY_TIERS, "tier");
      currentTier = id;
      applyResolutionPolicy();
      buildContent();
    },
    async setSeed(value) {
      assertKnown(value, GEOMETRY_SEEDS, "seed");
      currentSeed = value;
      buildContent();
    },
    async setCamera(id) {
      assertKnown(id, GEOMETRY_CAMERAS, "camera");
      currentCamera = id;
      applyCamera(id);
    },
    async setTime(seconds) {
      if (!Number.isFinite(seconds) || seconds < 0) throw new RangeError("time must be finite and nonnegative");
      currentTime = seconds;
      applyDynamicTime();
    },
    async step(deltaSeconds) {
      if (!Number.isFinite(deltaSeconds) || deltaSeconds < 0) throw new RangeError("deltaSeconds must be finite and nonnegative");
      currentTime += deltaSeconds;
      applyDynamicTime();
    },
    async resetHistory() {
      currentTime = 0;
      if (currentMode === "dynamic-updates") buildContent();
    },
    async resize(nextWidth, nextHeight, nextDpr = 1) {
      if (!(nextWidth > 0) || !(nextHeight > 0) || !(nextDpr > 0)) throw new RangeError("resize dimensions and DPR must be positive");
      width = Math.floor(nextWidth);
      height = Math.floor(nextHeight);
      requestedDpr = nextDpr;
      applyResolutionPolicy();
    },
    async renderOnce() {
      if (disposed) throw new Error("lab controller is disposed");
      for (const node of computeNodes) renderer.compute(node);
      renderPipeline.render();
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
          const rowBytes = captureTarget.width * 4;
          return {
            target,
            width: captureTarget.width,
            height: captureTarget.height,
            format: "rgba8unorm",
            outputColorSpace: renderer.outputColorSpace,
            bytesPerPixel: 4,
            rowBytes,
            bytesPerRow: Math.ceil(rowBytes / 256) * 256,
            pixels,
          };
        } finally {
          renderer.setRenderTarget(previousTarget);
        }
      }
      const textureIndex = scenePass.renderTarget.textures.findIndex((texture) => texture.name === target);
      if (textureIndex < 0) throw new RangeError(`Unknown capture target "${target}"`);
      await this.renderOnce();
      const targetWidth = scenePass.renderTarget.width;
      const targetHeight = scenePass.renderTarget.height;
      const pixels = await renderer.readRenderTargetPixelsAsync(
        scenePass.renderTarget,
        0,
        0,
        targetWidth,
        targetHeight,
        textureIndex,
        0,
      );
      const bytesPerPixel = pixels.BYTES_PER_ELEMENT * 4;
      const rowBytes = targetWidth * bytesPerPixel;
      const bytesPerRow = Math.ceil(rowBytes / 256) * 256;
      if (!Number.isInteger(bytesPerRow) || bytesPerRow < rowBytes) throw new Error("invalid aligned WebGPU readback stride");
      return { target, width: targetWidth, height: targetHeight, pixels, rowBytes, bytesPerRow };
    },
    async readIndirectState() {
      if (!currentIndirectFixture) throw new Error("the selected mode has no indirect fixture");
      await this.renderOnce();
      const readback = await currentIndirectFixture.captureGpuReadback(renderer);
      latestIndirectProof = currentIndirectFixture.reconcile(readback);
      return { readback, reconciliation: latestIndirectProof };
    },
    describePipeline() {
      return {
        owners: {
          renderer: "semantic-mesh-writer",
          renderPipeline: "semantic-mesh-writer",
          output: "semantic-mesh-writer",
          toneMap: "renderOutput",
          outputColorTransform: "renderOutput",
        },
        signals: ["output", "normal", "emissive", "depth"],
        sceneSubmissions: [{ id: "scene-pass", kind: "lit-scene", count: 1 }],
        computeDispatches: computeNodes.map((node) => ({ id: node.name || "indirect-command", count: 1 })),
        resources: this.describeResources().resources,
        finalToneMapOwner: "renderOutput",
        finalOutputTransformOwner: "renderOutput",
      };
    },
    describeResources() {
      const geometry = currentContent?.geometry;
      const strategyLedger = currentContent?.userData?.strategyLedger ?? null;
      return {
        resources: [
          { id: "scene-output", kind: "render-target", width: scenePass.renderTarget.width, height: scenePass.renderTarget.height },
          { id: "scene-normal", kind: "render-target", width: scenePass.renderTarget.width, height: scenePass.renderTarget.height },
          ...(geometry ? [{ id: "subject-geometry", kind: "buffer-geometry", bytes: geometry.userData.writer?.bytes ?? null }] : []),
          ...(currentIndirectFixture ? Object.entries(currentIndirectFixture.resourceBytes).map(([id, bytes]) => ({
            id: `indirect-${id}`,
            kind: id === "indirect" ? "indirect-buffer" : "storage-buffer",
            bytes,
          })) : []),
        ],
        strategyLedger,
        indirectReadback: latestIndirectProof,
      };
    },
    getMetrics() {
      return {
        mode: currentMode,
        tier: currentTier,
        seed: currentSeed,
        camera: currentCamera,
        timeSeconds: currentTime,
        resolutionPolicy: {
          width,
          height,
          requestedDpr,
          appliedDpr,
          dprCap: GEOMETRY_DPR_CAPS[currentTier],
        },
        rendererInfo: structuredClone(renderer.info),
        indirectReadback: latestIndirectProof ?? {
          verdict: "INSUFFICIENT_EVIDENCE",
          reason: "call readIndirectState() after a native-WebGPU render to reconcile GPU command and compacted records",
        },
        gpuTiming: { verdict: "INSUFFICIENT_EVIDENCE", value: null, unit: "ms", label: "Measured", source: "timestamp readback not yet captured" },
      };
    },
    async dispose() {
      if (disposed) return;
      disposed = true;
      clearContent();
      floor.geometry.dispose();
      floorMaterial.dispose();
      captureTarget.dispose();
      scenePass.dispose();
      renderPipeline.dispose();
      renderer.dispose();
    },
  };

  await controller.resize(width, height, dpr);
  return controller;
}
