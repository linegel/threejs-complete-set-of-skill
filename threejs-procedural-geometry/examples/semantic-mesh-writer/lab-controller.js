import * as THREE from "three/webgpu";
import {
  attribute,
  color,
  emissive,
  mrt,
  normalView,
  output,
  pass,
  renderOutput,
  uint,
  vec3,
} from "three/tsl";

import { buildFrameFixture } from "./frame-profile.js";
import { buildBranchRingFixture } from "./branch-rings.js";
import {
  createRealBatchingStrategies,
  reconcileStrategyDrawAudit,
  STRATEGY_ROSTER,
} from "./batching-demo.js";
import {
  beginDynamicUpdateFrame,
  updateVertexRange,
} from "./dynamic-updates.js";
import { buildDynamicComponentFixture } from "./dynamic-component-fixture.js";
import { LOD_PRESETS } from "./lod-presets.js";
import {
  assertObservedReadbackLayout,
  inferRendererReadbackLayout,
} from "./readback-layout.js";

export const GEOMETRY_MODES = Object.freeze([
  "frame-and-rail-profile",
  "branch-rings",
  "semantic-groups-and-materials",
  "batching-comparison",
  "dynamic-updates",
  "indirect-draw",
]);
export const GEOMETRY_TIERS = Object.freeze(["hero", "standard", "crowd"]);
export const GEOMETRY_DPR_CAPS = Object.freeze(Object.fromEntries(
  GEOMETRY_TIERS.map((id) => [id, LOD_PRESETS[id].dprCap]),
));
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

export function normalizeGeometryRouteLock(routeLock = null) {
  if (routeLock === null || routeLock === undefined) {
    return Object.freeze({ mode: null, tier: null });
  }
  if (typeof routeLock !== "object" || Array.isArray(routeLock)) {
    throw new TypeError("routeLock must be null or an object");
  }
  const mode = routeLock.mode ?? null;
  const tier = routeLock.tier ?? null;
  if (mode !== null) assertKnown(mode, GEOMETRY_MODES, "locked mode");
  if (tier !== null) assertKnown(tier, GEOMETRY_TIERS, "locked tier");
  return Object.freeze({ mode, tier });
}

export function assertGeometryRouteTransition(routeLock, dimension, value) {
  if (dimension !== "mode" && dimension !== "tier") {
    throw new RangeError(`Unknown route-lock dimension "${dimension}"`);
  }
  const locked = routeLock?.[dimension] ?? null;
  if (locked !== null && value !== locked) {
    throw new Error(`Fixed ${dimension} route is locked to "${locked}"; rejected "${value}"`);
  }
  return true;
}

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

function geometryByteLength(geometry) {
  if (!geometry) return 0;
  if (Number.isInteger(geometry.userData?.writer?.bytes)) return geometry.userData.writer.bytes;
  const arrays = new Set();
  if (geometry.index?.array) arrays.add(geometry.index.array);
  for (const attribute of Object.values(geometry.attributes ?? {})) {
    const array = attribute.isInterleavedBufferAttribute ? attribute.data?.array : attribute.array;
    if (array) arrays.add(array);
  }
  return Array.from(arrays).reduce((total, array) => total + array.byteLength, 0);
}

function describeGeometryResources(root) {
  const geometries = new Set();
  root?.traverse?.((object) => {
    if (object.geometry) geometries.add(object.geometry);
  });
  return Array.from(geometries, (geometry, index) => {
    const attributes = Object.fromEntries(Object.entries(geometry.attributes ?? {}).map(([name, attribute]) => {
      const array = attribute.isInterleavedBufferAttribute ? attribute.data?.array : attribute.array;
      return [name, {
        arrayType: array?.constructor?.name ?? null,
        itemSize: attribute.itemSize,
        count: attribute.count,
        normalized: attribute.normalized === true,
        bytes: array?.byteLength ?? 0,
      }];
    }));
    const indexBytes = geometry.index?.array?.byteLength ?? 0;
    return {
      id: `subject-geometry-${index}`,
      owner: "semantic-mesh-writer",
      kind: "buffer-geometry",
      residentBytes: geometryByteLength(geometry),
      vertices: geometry.attributes.position?.count ?? 0,
      indices: geometry.index?.count ?? 0,
      index: geometry.index ? {
        arrayType: geometry.index.array.constructor.name,
        count: geometry.index.count,
        bytes: indexBytes,
      } : null,
      attributes,
    };
  });
}

function textureFormatName(format) {
  const entries = [
    [THREE.RedFormat, "RedFormat"],
    [THREE.RGFormat, "RGFormat"],
    [THREE.RGBFormat, "RGBFormat"],
    [THREE.RGBAFormat, "RGBAFormat"],
    [THREE.RedIntegerFormat, "RedIntegerFormat"],
    [THREE.RGIntegerFormat, "RGIntegerFormat"],
    [THREE.RGBAIntegerFormat, "RGBAIntegerFormat"],
    [THREE.DepthFormat, "DepthFormat"],
    [THREE.DepthStencilFormat, "DepthStencilFormat"],
  ];
  return entries.find(([value]) => value === format)?.[1] ?? `unknown:${format}`;
}

function textureTypeName(type) {
  const entries = [
    [THREE.UnsignedByteType, "UnsignedByteType"],
    [THREE.ByteType, "ByteType"],
    [THREE.ShortType, "ShortType"],
    [THREE.UnsignedShortType, "UnsignedShortType"],
    [THREE.IntType, "IntType"],
    [THREE.UnsignedIntType, "UnsignedIntType"],
    [THREE.FloatType, "FloatType"],
    [THREE.HalfFloatType, "HalfFloatType"],
    [THREE.UnsignedShort4444Type, "UnsignedShort4444Type"],
    [THREE.UnsignedShort5551Type, "UnsignedShort5551Type"],
    [THREE.UnsignedInt248Type, "UnsignedInt248Type"],
  ];
  return entries.find(([value]) => value === type)?.[1] ?? `unknown:${type}`;
}

function textureBytesPerTexel(texture) {
  if (texture.format === THREE.DepthStencilFormat || texture.type === THREE.UnsignedInt248Type) return 4;
  if (texture.type === THREE.UnsignedShort4444Type || texture.type === THREE.UnsignedShort5551Type) return 2;
  const channels = new Map([
    [THREE.RedFormat, 1],
    [THREE.RedIntegerFormat, 1],
    [THREE.DepthFormat, 1],
    [THREE.RGFormat, 2],
    [THREE.RGIntegerFormat, 2],
    [THREE.RGBFormat, 3],
    [THREE.RGBAFormat, 4],
    [THREE.RGBAIntegerFormat, 4],
  ]).get(texture.format);
  const componentBytes = new Map([
    [THREE.UnsignedByteType, 1],
    [THREE.ByteType, 1],
    [THREE.ShortType, 2],
    [THREE.UnsignedShortType, 2],
    [THREE.HalfFloatType, 2],
    [THREE.IntType, 4],
    [THREE.UnsignedIntType, 4],
    [THREE.FloatType, 4],
  ]).get(texture.type);
  if (!channels || !componentBytes) {
    throw new Error(
      `cannot account texture format ${textureFormatName(texture.format)} / ${textureTypeName(texture.type)}`,
    );
  }
  return channels * componentBytes;
}

function describeTextureResource({ id, owner, kind, texture, width, height }) {
  const bytesPerTexel = textureBytesPerTexel(texture);
  return {
    id,
    owner,
    kind,
    width,
    height,
    format: textureFormatName(texture.format),
    type: textureTypeName(texture.type),
    bytesPerTexel,
    residentBytes: width * height * bytesPerTexel,
  };
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
  routeLock = null,
} = {}) {
  assertKnown(mode, GEOMETRY_MODES, "mode");
  assertKnown(tier, GEOMETRY_TIERS, "tier");
  assertKnown(seed, GEOMETRY_SEEDS, "seed");
  assertKnown(camera, GEOMETRY_CAMERAS, "camera");
  const fixedRoute = normalizeGeometryRouteLock(routeLock);
  assertGeometryRouteTransition(fixedRoute, "mode", mode);
  assertGeometryRouteTransition(fixedRoute, "tier", tier);

  const runtimeProfile = globalThis.__LAB_CAPTURE_PROFILE__?.id ?? "interactive";
  const timestampQueriesRequested = runtimeProfile === "performance";

  const renderer = new THREE.WebGPURenderer({
    canvas,
    antialias: false,
    outputBufferType: THREE.HalfFloatType,
    trackTimestamp: timestampQueriesRequested,
  });
  await renderer.init();
  if (renderer.backend.isWebGPUBackend !== true) {
    throw new Error("WebGPU is required for the canonical semantic-mesh-writer lab; no fallback was activated.");
  }
  renderer.info.autoReset = false;
  const rendererDevice = renderer.backend.device;
  if (!rendererDevice || typeof rendererDevice.lost?.then !== "function") {
    throw new Error("initialized WebGPU backend did not expose its actual GPUDevice loss promise");
  }
  const rendererDeviceGeneration = 1;
  let rendererDeviceStatus = "active";
  let deviceLossGeneration = 0;
  let deviceLossDetails = null;
  let disposing = false;
  rendererDevice.lost.then((info) => {
    if (disposing) return;
    rendererDeviceStatus = "lost";
    deviceLossGeneration = rendererDeviceGeneration;
    deviceLossDetails = {
      reason: info?.reason ?? "unknown",
      message: info?.message ?? "GPU device lost",
    };
  });
  const timestampQueriesActive =
    timestampQueriesRequested && renderer.hasFeature?.("timestamp-query") === true;
  const backendEvidence = () => ({
    backendKind: "WebGPU",
    backendType: "WebGPUBackend",
    deviceIdentityVerified: renderer.backend.device === rendererDevice,
    deviceIdentitySource: "renderer.backend.device captured immediately after await renderer.init()",
    deviceType: rendererDevice.constructor?.name || "GPUDevice",
    deviceLabel: rendererDevice.label || "",
    lossPromiseObservedOnActualDevice: true,
    rendererDeviceGeneration,
  });
  const adapterIdentity = {
    source: "initialized renderer.backend.device",
    adapterClass: "unknown",
    deviceType: rendererDevice.constructor?.name || "GPUDevice",
    deviceLabel: rendererDevice.label || "",
    featureNames: Array.from(rendererDevice.features ?? [], String).sort(),
  };

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
  let currentStrategies = null;
  let latestIndirectProof = null;
  let latestStorageProof = null;
  let latestDrawAudit = null;
  let latestFrameSubmission = null;
  let latestDynamicEdit = null;
  let renderSubmissionSequence = 0;
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
    currentStrategies = null;
    latestIndirectProof = null;
    latestStorageProof = null;
    latestDrawAudit = null;
    latestDynamicEdit = null;
    dynamicOffset = 0;
  }

  function buildFrame() {
    const geometry = buildFrameFixture({ tier: currentTier, railLength: 4.2, railWidth: 0.72 });
    const palette = [0xc6a36a, 0xc6a36a, 0xc6a36a, 0xc6a36a];
    const materials = palette.map((hex) => nodeMaterial(hex, { roughness: 0.45, metalness: 0.18 }));
    const mesh = new THREE.Mesh(geometry, materials);
    mesh.position.set(-2.1, -0.85, 0);
    mesh.rotation.x = -0.14;
    mesh.name = "exact-capacity-profile-rail";
    return mesh;
  }

  function buildDynamicFramePair() {
    const geometry = buildDynamicComponentFixture({
      tier: currentTier,
      railLength: 4.2,
      railWidth: 0.72,
    });
    const material = nodeMaterial(0xc6a36a, { roughness: 0.45, metalness: 0.18 });
    const mesh = new THREE.Mesh(geometry, material);
    mesh.position.set(-2.1, -1.05, 0);
    mesh.rotation.x = -0.14;
    mesh.name = "declared-component-dynamic-profile-rails";
    dynamicOffset = 0;
    return mesh;
  }

  function buildBranch() {
    const wobble = seededSigned(currentSeed, 4) * 0.08;
    const geometry = buildBranchRingFixture({
      radialSegments: LOD_PRESETS[currentTier].branchRadialSegments,
      centers: [[0, 0, 0], [0.2 + wobble, 0.8, 0.05], [-0.12, 1.65, 0.2], [0.22, 2.45, 0.04], [0.02, 3.35, -0.08]],
      twists: [0, 0.08, -0.06, 0.12, 0.18],
    });
    const materials = [nodeMaterial(0x775238, { roughness: 0.82 }), nodeMaterial(0x9b7652, { roughness: 0.75 })];
    const mesh = new THREE.Mesh(geometry, materials);
    mesh.position.set(0, -0.95, 0);
    mesh.name = "parallel-transport-branch-rings";
    return mesh;
  }

  function buildDiagnosticMosaic() {
    const geometry = buildFrameFixture({ tier: currentTier, railLength: 4.2, railWidth: 0.72 });
    const root = new THREE.Group();
    root.name = "semantic-geometry-diagnostics-mosaic";
    const debugUvNode = attribute("debugUv", "vec2");
    const boundaryNode = uint(attribute("boundaryReason", "uint")).toFloat();
    const normalMaterial = new THREE.MeshBasicNodeMaterial();
    normalMaterial.colorNode = normalView.mul(0.5).add(0.5);
    const uvMaterial = new THREE.MeshBasicNodeMaterial();
    uvMaterial.colorNode = vec3(debugUvNode.x, debugUvNode.y, 0.16);
    const boundaryMaterial = new THREE.MeshBasicNodeMaterial();
    boundaryMaterial.colorNode = vec3(
      boundaryNode.mul(0.18).add(0.08),
      boundaryNode.mul(0.07).add(0.16),
      boundaryNode.mul(0.25).add(0.12),
    );
    const slotMaterials = [0xd1a15c, 0x4c4138, 0x8a6f55, 0xb66f3c]
      .map((hex) => nodeMaterial(hex, { roughness: 0.45, metalness: 0.18 }));
    const panels = [
      { id: "material-slots", material: slotMaterials, position: [-2.4, -0.8, 0] },
      { id: "analytic-normals", material: [normalMaterial, normalMaterial, normalMaterial, normalMaterial], position: [0.2, -0.8, 0] },
      { id: "physical-and-debug-uv", material: [uvMaterial, uvMaterial, uvMaterial, uvMaterial], position: [-2.4, 0.65, 0] },
      { id: "boundary-reasons", material: [boundaryMaterial, boundaryMaterial, boundaryMaterial, boundaryMaterial], position: [0.2, 0.65, 0] },
    ];
    for (const panel of panels) {
      const mesh = new THREE.Mesh(geometry, panel.material);
      mesh.name = `diagnostic-${panel.id}`;
      mesh.position.set(...panel.position);
      mesh.scale.setScalar(0.55);
      mesh.rotation.x = -0.14;
      root.add(mesh);
    }
    root.userData.diagnosticPanels = panels.map((panel) => panel.id);
    return root;
  }

  function buildContent() {
    clearContent();
    if (currentMode === "branch-rings") currentContent = buildBranch();
    else if (currentMode === "semantic-groups-and-materials") {
      currentContent = buildDiagnosticMosaic();
    } else if (currentMode === "batching-comparison" || currentMode === "indirect-draw") {
      const strategies = createRealBatchingStrategies({ count: currentTier === "crowd" ? 4 : 8 });
      currentContent = strategies.root;
      currentDisposer = strategies.dispose;
      currentStrategies = strategies;
      computeNodes = currentMode === "indirect-draw"
        ? strategies.strategies.indirect.computeNodes
        : strategies.computeNodes;
      currentIndirectFixture = strategies.indirectFixture;
      strategies.setTime(currentTime);
      if (currentMode === "indirect-draw") {
        for (const [id, entry] of Object.entries(strategies.strategies)) entry.object.visible = id === "indirect";
      }
    } else {
      currentContent = currentMode === "dynamic-updates"
        ? buildDynamicFramePair()
        : buildFrame();
    }
    contentRoot.add(currentContent);
    contentRoot.updateMatrixWorld(true);
  }

  function applyStorageTime() {
    currentStrategies?.setTime(currentTime);
  }

  function applyDiscreteDynamicEdit() {
    if (currentMode !== "dynamic-updates" || !currentContent) return;
    const geometry = currentContent.geometry;
    // The moving rail is a separately closed component stored after the static
    // rail in the same vertex buffer. Translating that exact component keeps
    // its topology and basis valid while proving a real scoped upload.
    const nextOffset = Math.sin(currentTime * 2.2) * 0.32;
    const delta = nextOffset - dynamicOffset;
    if (Math.abs(delta) <= 1e-12) return;
    beginDynamicUpdateFrame(geometry);
    const range = geometry.userData.dynamicComponentRange;
    latestDynamicEdit = updateVertexRange(geometry, {
      startVertex: range.startVertex,
      vertexCount: range.vertexCount,
      positionDelta: [0, 0, delta],
    });
    if (latestDynamicEdit.updatedVertexFraction > range.maximumUpdatedVertexFraction) {
      throw new Error("dynamic edit exceeded its declared local upload envelope");
    }
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
      assertGeometryRouteTransition(fixedRoute, "mode", id);
      currentMode = id;
      buildContent();
    },
    async setTier(id) {
      assertKnown(id, GEOMETRY_TIERS, "tier");
      assertGeometryRouteTransition(fixedRoute, "tier", id);
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
      applyStorageTime();
      applyDiscreteDynamicEdit();
    },
    async step(deltaSeconds) {
      if (!Number.isFinite(deltaSeconds) || deltaSeconds < 0) throw new RangeError("deltaSeconds must be finite and nonnegative");
      currentTime += deltaSeconds;
      applyStorageTime();
    },
    async resetHistory() {
      currentTime = 0;
      if (currentMode === "dynamic-updates") buildContent();
      else applyStorageTime();
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
      renderer.info.reset();
      for (const node of computeNodes) renderer.compute(node);
      renderPipeline.render();
      latestFrameSubmission = {
        submissionSequence: ++renderSubmissionSequence,
        mode: currentMode,
        renderCalls: renderer.info.render.frameCalls,
        drawCalls: renderer.info.render.drawCalls,
        triangles: renderer.info.render.triangles,
        computeCalls: renderer.info.compute.frameCalls,
        source: "live WebGPURenderer.info after one reset/compute/render frame",
      };
    },
    async capturePixels(target = "output") {
      if (target === "presentation") {
        captureTarget.setSize(renderer.domElement.width, renderer.domElement.height);
        const previousTarget = renderer.getRenderTarget();
        try {
          renderer.setRenderTarget(captureTarget);
          await this.renderOnce();
          const pixels = await renderer.readRenderTargetPixelsAsync(
            captureTarget,
            0,
            0,
            captureTarget.width,
            captureTarget.height,
          );
          const inferred = inferRendererReadbackLayout({
            width: captureTarget.width,
            height: captureTarget.height,
            bytesPerPixel: 4,
            returnedByteLength: pixels.byteLength,
          });
          assertObservedReadbackLayout(inferred, pixels.byteLength);
          return {
            target,
            width: captureTarget.width,
            height: captureTarget.height,
            format: "rgba8unorm",
            colorManaged: true,
            outputColorSpace: renderer.outputColorSpace,
            bytesPerPixel: 4,
            rowBytes: inferred.requested.rowBytes,
            bytesPerRow: inferred.requested.bytesPerRow,
            sourceByteLength: inferred.requested.shortFinalRowByteLength,
            alignmentBytes: 256,
            origin: "top-left",
            transport: {
              layout: {
                width: captureTarget.width,
                height: captureTarget.height,
                rowBytes: inferred.observed.rowBytes,
                bytesPerRow: inferred.observed.bytesPerRow,
                byteLength: inferred.observed.byteLength,
                bytesPerPixel: 4,
                format: "rgba8unorm",
                origin: "top-left",
                padding: inferred.observed.padding,
              },
              data: pixels,
            },
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
      const inferred = inferRendererReadbackLayout({
        width: targetWidth,
        height: targetHeight,
        bytesPerPixel,
        returnedByteLength: pixels.byteLength,
      });
      assertObservedReadbackLayout(inferred, pixels.byteLength);
      return {
        target,
        width: targetWidth,
        height: targetHeight,
        bytesPerPixel,
        rowBytes: inferred.requested.rowBytes,
        bytesPerRow: inferred.requested.bytesPerRow,
        sourceByteLength: inferred.requested.shortFinalRowByteLength,
        alignmentBytes: 256,
        origin: "top-left",
        transport: {
          layout: {
            width: targetWidth,
            height: targetHeight,
            rowBytes: inferred.observed.rowBytes,
            bytesPerRow: inferred.observed.bytesPerRow,
            byteLength: inferred.observed.byteLength,
            bytesPerPixel,
            format: pixels.BYTES_PER_ELEMENT === 2 ? "rgba16float" : "rgba8unorm",
            origin: "top-left",
            padding: inferred.observed.padding,
          },
          data: pixels,
        },
      };
    },
    async readIndirectState() {
      if (!currentIndirectFixture) throw new Error("the selected mode has no indirect fixture");
      await this.renderOnce();
      const boundSubmissionSequence = latestFrameSubmission.submissionSequence;
      const readback = await currentIndirectFixture.captureGpuReadback(renderer);
      latestIndirectProof = {
        ...currentIndirectFixture.reconcile(readback),
        boundSubmissionSequence,
      };
      return {
        readback: {
          provenance: readback.provenance,
          sequence: readback.sequence,
          command: Array.from(readback.command),
          visibleIds: Array.from(readback.visibleIds),
          visibleOffsets: Array.from(readback.visibleOffsets),
        },
        reconciliation: latestIndirectProof,
      };
    },
    async readStorageState() {
      if (!currentStrategies) throw new Error("batching-comparison mode is required for storage readback");
      await this.renderOnce();
      const boundSubmissionSequence = latestFrameSubmission.submissionSequence;
      const readback = await currentStrategies.captureStorageGpuReadback(renderer);
      latestStorageProof = {
        ...currentStrategies.reconcileStorage(readback),
        boundSubmissionSequence,
      };
      return {
        readback: {
          provenance: readback.provenance,
          offsets: Array.from(readback.offsets),
        },
        reconciliation: latestStorageProof,
      };
    },
    async auditBatchingStrategies() {
      if (!currentStrategies) {
        throw new Error("batching-comparison or indirect-draw mode is required for draw auditing");
      }
      const entries = Object.entries(currentStrategies.strategies);
      const priorTarget = renderer.getRenderTarget();
      const priorFloorVisibility = floor.visible;
      const priorStates = new Map(entries.map(([, entry]) => [entry.object, {
        visible: entry.object.visible,
        frustumCulled: entry.object.frustumCulled,
      }]));
      const records = [];
      try {
        floor.visible = false;
        captureTarget.setSize(renderer.domElement.width, renderer.domElement.height);
        renderer.setRenderTarget(captureTarget);
        for (const [id, entry] of entries) {
          for (const [, candidate] of entries) candidate.object.visible = candidate === entry;
          entry.object.frustumCulled = false;
          renderer.info.reset();
          for (const node of entry.computeNodes) renderer.compute(node);
          renderer.render(scene, perspectiveCamera);
          const boundSubmissionSequence = ++renderSubmissionSequence;
          const rendererReportedTriangles = renderer.info.render.triangles;
          let indirectReadback = null;
          let storageReadback = null;
          if (id === "storage") {
            const readback = await currentStrategies.captureStorageGpuReadback(renderer);
            latestStorageProof = {
              ...currentStrategies.reconcileStorage(readback),
              boundSubmissionSequence,
            };
            storageReadback = latestStorageProof;
          }
          if (id === "indirect") {
            const readback = await currentIndirectFixture.captureGpuReadback(renderer);
            latestIndirectProof = {
              ...currentIndirectFixture.reconcile(readback),
              boundSubmissionSequence,
            };
            indirectReadback = latestIndirectProof;
          }
          const rendererKnownMaxTriangles = id === "indirect"
            ? entry.object.geometry.index.count / 3 * entry.maxInstances
            : null;
          records.push({
            id,
            route: entry.route,
            topologyOwner: entry.topologyOwner,
            transformOwner: entry.transformOwner,
            visibilityOwner: entry.visibilityOwner,
            commandOwner: entry.commandOwner,
            computeOwners: [...entry.computeOwners],
            expectedDrawCalls: entry.backendDrawItems,
            actualDrawCalls: renderer.info.render.drawCalls,
            rendererReportedTriangles,
            rendererKnownMaxTriangles,
            commandSubmittedTriangles: indirectReadback?.submittedTriangles ?? null,
            triangleCountAuthority:
              id === "indirect"
                ? "renderer-known-max-plus-gpu-command-readback"
                : "renderer.info",
            computeCalls: renderer.info.compute.frameCalls,
            rendererCalls: renderer.info.render.frameCalls,
            frustumCullingDisabledForAudit: true,
            boundSubmissionSequence,
            storageReadback,
            indirectReadback,
          });
        }
      } finally {
        floor.visible = priorFloorVisibility;
        for (const [object, state] of priorStates) {
          object.visible = state.visible;
          object.frustumCulled = state.frustumCulled;
        }
        renderer.setRenderTarget(priorTarget);
      }
      latestDrawAudit = {
        ...reconcileStrategyDrawAudit(records),
        source: "live direct native-WebGPU scene submissions with one strategy visible at a time",
      };
      return latestDrawAudit;
    },
    describePipeline() {
      return {
        runtimeProfile,
        mode: currentMode,
        tier: currentTier,
        routeLock: { ...fixedRoute },
        timestampQueriesRequired: timestampQueriesRequested,
        timestampQueriesRequested,
        timestampQueriesActive,
        performanceTimestampMode: timestampQueriesRequested ? "auto" : "disabled",
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
      const geometryResources = describeGeometryResources(currentContent);
      const liveStrategyLedger = currentContent?.userData?.strategyLedger ?? null;
      const strategyLedger = liveStrategyLedger
        ? Object.fromEntries(Object.entries(liveStrategyLedger).map(([id, entry]) => [id, {
          id,
          route: entry.route,
          topologyOwner: entry.topologyOwner,
          transformOwner: entry.transformOwner,
          visibilityOwner: entry.visibilityOwner,
          commandOwner: entry.commandOwner,
          computeOwners: [...entry.computeOwners],
          objectType: entry.object.constructor.name,
          backendDrawItems: entry.backendDrawItems,
          geometryBytes: entry.geometryBytes ?? 0,
          storageBytes: entry.storageBytes ?? entry.bytes ?? 0,
          computeOwner: entry.computeOwner ?? null,
          proofStatus: entry.proofStatus ?? null,
        }]))
        : null;
      const targetWidth = scenePass.renderTarget.width;
      const targetHeight = scenePass.renderTarget.height;
      const renderTargets = scenePass.renderTarget.textures.map((texture, index) =>
        describeTextureResource({
          id: `scene-${texture.name || `attachment-${index}`}`,
          owner: "semantic-mesh-writer.scene-pass",
          kind: "render-target",
          texture,
          width: targetWidth,
          height: targetHeight,
        }));
      if (scenePass.renderTarget.depthTexture) {
        renderTargets.push(describeTextureResource({
          id: "scene-depth",
          owner: "semantic-mesh-writer.scene-pass",
          kind: "depth-texture",
          texture: scenePass.renderTarget.depthTexture,
          width: targetWidth,
          height: targetHeight,
        }));
      }
      renderTargets.push(describeTextureResource({
        id: "validation-presentation",
        owner: "semantic-mesh-writer.capture",
        kind: "render-target",
        texture: captureTarget.texture,
        width: captureTarget.width,
        height: captureTarget.height,
      }));
      const storageResources = currentStrategies ? [
        {
          id: "storage-instance-authored-offsets",
          owner: "semanticMeshWriterStorageUpdate",
          kind: "storage-buffer",
          arrayType: currentStrategies.resources.baseOffsets.array.constructor.name,
          residentBytes: currentStrategies.resources.baseOffsets.array.byteLength,
        },
        {
          id: "storage-instance-current-offsets",
          owner: "semanticMeshWriterStorageUpdate",
          kind: "storage-buffer",
          arrayType: currentStrategies.resources.offsets.array.constructor.name,
          residentBytes: currentStrategies.resources.offsets.array.byteLength,
        },
      ] : [];
      const indirectResources = currentIndirectFixture
        ? Object.entries(currentIndirectFixture.resourceBytes).map(([id, bytes]) => ({
          id: `indirect-${id}`,
          owner: "semanticMeshWriterIndirectCompact",
          kind: id === "indirect" ? "indirect-buffer" : "storage-buffer",
          residentBytes: bytes,
        }))
        : [];
      const strategyStateResources = currentStrategies ? [
        {
          id: "instanced-instance-matrices",
          owner: "InstancedMesh.instanceMatrix",
          kind: "instance-buffer",
          residentBytes: currentStrategies.strategies.instanced.object.instanceMatrix.array.byteLength,
        },
        ...[
          ["batched-instance-matrices", currentStrategies.strategies.batched.object._matricesTexture],
          ["batched-indirect-table", currentStrategies.strategies.batched.object._indirectTexture],
          ["batched-instance-colors", currentStrategies.strategies.batched.object._colorsTexture],
        ].filter(([, texture]) => texture?.image?.data).map(([id, texture]) => ({
          id,
          owner: "BatchedMesh",
          kind: "data-texture-buffer",
          residentBytes: texture.image.data.byteLength,
        })),
      ] : [];
      const resources = [
        ...renderTargets,
        ...geometryResources,
        ...strategyStateResources,
        ...storageResources,
        ...indirectResources,
      ];
      const totals = {
        renderTargetBytes: renderTargets.reduce((sum, resource) => sum + resource.residentBytes, 0),
        geometryBytes: geometryResources.reduce((sum, resource) => sum + resource.residentBytes, 0),
        strategyStateBytes: strategyStateResources.reduce((sum, resource) => sum + resource.residentBytes, 0),
        storageBytes: storageResources.reduce((sum, resource) => sum + resource.residentBytes, 0),
        indirectBytes: indirectResources.reduce((sum, resource) => sum + resource.residentBytes, 0),
        accessibleResidentBytes: resources.reduce((sum, resource) => sum + resource.residentBytes, 0),
        resourceCount: resources.length,
      };
      return {
        accountingScope: "lab-owned resources reachable from the selected mechanism state",
        completeness: "COMPLETE_FOR_CPU_VISIBLE_ARRAYS_AND_EXPLICIT_RENDER_TARGETS",
        opaqueRendererInternalResidency: {
          verdict: "NOT_CLAIMED",
          residentBytes: null,
          reason: "WebGPURenderer pipeline caches, backend heaps, and driver residency are opaque to the lab API",
        },
        resources,
        totals,
        mechanismState: {
          mode: currentMode,
          tier: currentTier,
          strategyRoster: STRATEGY_ROSTER.map((entry) => ({
            ...entry,
            computeOwners: [...entry.computeOwners],
          })),
          activeComputeOwners: computeNodes.map((node) => node.name),
          dynamicEdit: latestDynamicEdit,
          storageReadback: latestStorageProof,
          indirectReadback: latestIndirectProof,
        },
        strategyLedger,
        storageReadback: latestStorageProof,
        indirectReadback: latestIndirectProof,
        drawAudit: latestDrawAudit,
      };
    },
    getMetrics() {
      return {
        labId: "semantic-mesh-writer",
        runtimeProfile,
        timestampQueriesRequired: timestampQueriesRequested,
        timestampQueriesRequested,
        timestampQueriesActive,
        performanceTimestampMode: timestampQueriesRequested ? "auto" : "disabled",
        initialized: true,
        nativeWebGPU: renderer.backend.isWebGPUBackend === true,
        backend: "WebGPU",
        backendKind: "WebGPU",
        rendererType: "WebGPURenderer",
        rendererDeviceStatus,
        rendererDeviceGeneration,
        deviceLossGeneration,
        deviceLossDetails,
        rendererBackendEvidence: backendEvidence(),
        adapterIdentity,
        scenario: currentMode,
        mode: currentMode,
        tier: currentTier,
        routeLock: { ...fixedRoute },
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
        rendererInfo: {
          rendererType: "WebGPURenderer",
          backendType: "WebGPU",
          backendEvidence: backendEvidence(),
          render: { ...renderer.info.render },
          compute: { ...renderer.info.compute },
          memory: { ...renderer.info.memory },
        },
        rendererBackend: renderer.backend.isWebGPUBackend === true ? "WebGPU" : "unsupported",
        threeRevision: THREE.REVISION,
        frameSubmission: latestFrameSubmission,
        drawAudit: latestDrawAudit ?? {
          verdict: "INSUFFICIENT_EVIDENCE",
          reason: "call auditBatchingStrategies() on a native-WebGPU batching route",
        },
        indirectReadback: latestIndirectProof ?? {
          verdict: "INSUFFICIENT_EVIDENCE",
          reason: "call readIndirectState() after a native-WebGPU render to reconcile GPU command and compacted records",
        },
        storageReadback: latestStorageProof ?? {
          verdict: "INSUFFICIENT_EVIDENCE",
          reason: "call readStorageState() or auditBatchingStrategies() after a native-WebGPU storage dispatch",
        },
        dynamicUpdates: {
          steadyStateCpuGeometryRewrite: false,
          trigger: "explicit setTime/reset interaction",
          latestDiscreteEdit: latestDynamicEdit,
        },
        gpuTiming: timestampQueriesRequested
          ? {
            verdict: "INSUFFICIENT_EVIDENCE",
            value: null,
            unit: "ms",
            source: "timestamp-query was requested but no sustained population has been resolved",
          }
          : {
            verdict: "NOT_CLAIMED",
            value: null,
            unit: "ms",
            source: "correctness and interactive profiles do not make a GPU timing claim",
          },
      };
    },
    async dispose() {
      if (disposed) return;
      disposed = true;
      disposing = true;
      rendererDeviceStatus = "disposed";
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
