import * as THREE from "three/webgpu";
import { color } from "three/tsl";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";

import {
  createTowerShip,
  summarizeTowerShip,
  TOWER_SHIP_MODES,
  TOWER_SHIP_TIERS,
} from "./tower-ship-factory.js";

export { TOWER_SHIP_MODES, TOWER_SHIP_TIERS };
export const TOWER_SHIP_SCENARIOS = Object.freeze({
  "reference-reconstruction": "final",
  "staged-sculpt": "blockout",
  "action-ready": "interaction",
});
export const TOWER_SHIP_CAMERAS = Object.freeze(["design", "profile", "bow", "close-material"]);
export const TOWER_SHIP_SEEDS = Object.freeze([1, 2654435769]);
export const TOWER_SHIP_DPR_CAPS = Object.freeze({ full: 2, budgeted: 1.5, minimum: 1 });

const CAMERA_POSES = Object.freeze({
  design: { position: [18.5, 11.8, 21.5], target: [0, 4.5, 0], fov: 38 },
  profile: { position: [0, 7.3, 31], target: [0, 4.3, 0], fov: 36 },
  bow: { position: [-22, 8.4, 13.5], target: [-1.6, 4.2, 0], fov: 42 },
  "close-material": { position: [9.5, 6.8, 11.6], target: [0.2, 4.5, 0], fov: 34 },
});

function assertKnown(value, values, label) {
  if (!values.includes(value)) throw new RangeError(`Unknown ${label} "${value}"`);
}

function floorMaterial() {
  const material = new THREE.MeshStandardNodeMaterial();
  material.colorNode = color(0x171b1d);
  material.roughness = 0.92;
  material.metalness = 0;
  return material;
}

function align(value, alignment) {
  return Math.ceil(value / alignment) * alignment;
}

export function resolveTowerShipDpr(tier, requestedDpr) {
  assertKnown(tier, TOWER_SHIP_TIERS, "tier");
  if (!(requestedDpr > 0) || !Number.isFinite(requestedDpr)) throw new RangeError("requested DPR must be finite and positive");
  return Math.min(requestedDpr, TOWER_SHIP_DPR_CAPS[tier]);
}

export function resolveFrameDeltaSeconds(nowMs, previousMs) {
  if (!Number.isFinite(nowMs) || !Number.isFinite(previousMs)) {
    throw new RangeError("frame timestamps must be finite");
  }
  return Math.min(Math.max((nowMs - previousMs) / 1000, 0), 0.1);
}

export async function createTowerShipLabController({
  canvas,
  width = 1280,
  height = 800,
  dpr = 1,
  mode = "final",
  tier = "full",
  seed = TOWER_SHIP_SEEDS[0],
  camera = "design",
} = {}) {
  assertKnown(mode, TOWER_SHIP_MODES, "mode");
  assertKnown(tier, TOWER_SHIP_TIERS, "tier");
  assertKnown(seed, TOWER_SHIP_SEEDS, "seed");
  assertKnown(camera, TOWER_SHIP_CAMERAS, "camera");

  const renderer = new THREE.WebGPURenderer({ canvas, antialias: true, trackTimestamp: true });
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.05;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  await renderer.init();
  if (renderer.backend.isWebGPUBackend !== true) {
    throw new Error("WebGPU is required for the canonical Tower Ship demo; no fallback was activated.");
  }

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x091012);
  scene.fog = new THREE.Fog(0x091012, 32, 72);
  const perspectiveCamera = new THREE.PerspectiveCamera(38, width / height, 0.05, 160);
  const controls = new OrbitControls(perspectiveCamera, canvas);
  controls.enableDamping = true;
  controls.dampingFactor = 0.07;
  controls.minDistance = 10;
  controls.maxDistance = 62;
  controls.maxPolarAngle = Math.PI * 0.495;

  const contentRoot = new THREE.Group();
  contentRoot.name = "tower-ship-demo-content";
  scene.add(contentRoot);

  const floor = new THREE.Mesh(new THREE.CircleGeometry(38, 96), floorMaterial());
  floor.rotation.x = -Math.PI / 2;
  floor.position.y = -1.2;
  floor.receiveShadow = true;
  scene.add(floor);

  const hemisphere = new THREE.HemisphereLight(0xbad5df, 0x24130e, 1.7);
  scene.add(hemisphere);
  const key = new THREE.DirectionalLight(0xffe5c3, 4.8);
  key.position.set(-10, 18, 14);
  key.castShadow = true;
  key.shadow.mapSize.set(2048, 2048);
  key.shadow.camera.left = -18;
  key.shadow.camera.right = 18;
  key.shadow.camera.top = 18;
  key.shadow.camera.bottom = -10;
  key.shadow.camera.near = 1;
  key.shadow.camera.far = 55;
  key.shadow.bias = -0.00035;
  scene.add(key);
  const rim = new THREE.DirectionalLight(0xff9c56, 2.8);
  rim.position.set(12, 12, -15);
  scene.add(rim);
  const fill = new THREE.DirectionalLight(0x8ebbd1, 1.15);
  fill.position.set(7, 5, 12);
  scene.add(fill);

  const captureTarget = new THREE.RenderTarget(1, 1, { type: THREE.UnsignedByteType, depthBuffer: true });
  captureTarget.texture.colorSpace = renderer.outputColorSpace;

  let currentMode = mode;
  let currentTier = tier;
  let currentSeed = seed;
  let currentCamera = camera;
  let currentTime = 0;
  let requestedDpr = dpr;
  let appliedDpr = 1;
  let ship = null;
  let summary = null;
  let disposed = false;

  function applyCamera(id) {
    const pose = CAMERA_POSES[id];
    perspectiveCamera.fov = pose.fov;
    perspectiveCamera.position.fromArray(pose.position);
    perspectiveCamera.updateProjectionMatrix();
    controls.target.fromArray(pose.target);
    controls.update();
    perspectiveCamera.updateMatrixWorld(true);
  }

  function applyResolutionPolicy() {
    appliedDpr = resolveTowerShipDpr(currentTier, requestedDpr);
    renderer.setPixelRatio(appliedDpr);
    renderer.setSize(width, height, false);
    perspectiveCamera.aspect = width / height;
    perspectiveCamera.updateProjectionMatrix();
    captureTarget.setSize(renderer.domElement.width, renderer.domElement.height);
  }

  function rebuild() {
    if (ship) {
      contentRoot.remove(ship.root);
      ship.dispose();
    }
    ship = createTowerShip({ tier: currentTier, seed: currentSeed });
    ship.root.rotation.y = -0.16;
    contentRoot.add(ship.root);
    ship.setMode(currentMode);
    ship.setTime(currentTime, currentMode === "interaction");
    summary = summarizeTowerShip(ship.root);
  }

  applyResolutionPolicy();
  applyCamera(currentCamera);
  rebuild();

  const controller = {
    async ready() {},
    async setScenario(id) {
      const scenarioMode = TOWER_SHIP_SCENARIOS[id];
      if (!scenarioMode) throw new RangeError(`Unknown scenario "${id}"`);
      await this.setMode(scenarioMode);
    },
    async setMode(id) {
      assertKnown(id, TOWER_SHIP_MODES, "mode");
      currentMode = id;
      ship.setMode(id);
      ship.setTime(currentTime, id === "interaction");
    },
    async setTier(id) {
      assertKnown(id, TOWER_SHIP_TIERS, "tier");
      currentTier = id;
      applyResolutionPolicy();
      rebuild();
    },
    async setSeed(value) {
      assertKnown(value, TOWER_SHIP_SEEDS, "seed");
      currentSeed = value;
      rebuild();
    },
    async setCamera(id) {
      assertKnown(id, TOWER_SHIP_CAMERAS, "camera");
      currentCamera = id;
      applyCamera(id);
    },
    async setTime(seconds) {
      if (!Number.isFinite(seconds) || seconds < 0) throw new RangeError("time must be finite and nonnegative");
      currentTime = seconds;
      ship.setTime(currentTime, currentMode === "interaction");
    },
    async step(deltaSeconds) {
      if (!Number.isFinite(deltaSeconds) || deltaSeconds < 0) throw new RangeError("deltaSeconds must be finite and nonnegative");
      controls.update();
      currentTime += deltaSeconds;
      ship.setTime(currentTime, currentMode === "interaction");
    },
    async resetHistory() {
      currentTime = 0;
      ship.setTime(0, currentMode === "interaction");
    },
    async resize(nextWidth, nextHeight, nextDpr = 1) {
      if (!(nextWidth > 0) || !(nextHeight > 0) || !(nextDpr > 0)) throw new RangeError("resize dimensions and DPR must be positive");
      width = Math.floor(nextWidth);
      height = Math.floor(nextHeight);
      requestedDpr = nextDpr;
      applyResolutionPolicy();
    },
    async renderOnce() {
      if (disposed) throw new Error("Tower Ship controller is disposed");
      await renderer.renderAsync(scene, perspectiveCamera);
    },
    async capturePixels(target = "presentation") {
      if (!new Set(["presentation", "output"]).has(target)) throw new RangeError(`Unknown capture target "${target}"`);
      captureTarget.setSize(renderer.domElement.width, renderer.domElement.height);
      const previous = renderer.getRenderTarget();
      try {
        renderer.setRenderTarget(captureTarget);
        await renderer.renderAsync(scene, perspectiveCamera);
        const tight = await renderer.readRenderTargetPixelsAsync(captureTarget, 0, 0, captureTarget.width, captureTarget.height);
        const tightRowBytes = captureTarget.width * 4;
        const rowStride = align(tightRowBytes, 256);
        const pixels = new Uint8Array(rowStride * captureTarget.height);
        for (let y = 0; y < captureTarget.height; y += 1) {
          const source = y * tightRowBytes;
          pixels.set(tight.subarray(source, source + tightRowBytes), y * rowStride);
        }
        return {
          target,
          width: captureTarget.width,
          height: captureTarget.height,
          channels: 4,
          rowStride,
          bytesPerPixel: 4,
          origin: "bottom-left",
          pixels: Array.from(pixels),
        };
      } finally {
        renderer.setRenderTarget(previous);
      }
    },
    getMetrics() {
      return {
        mode: currentMode,
        tier: currentTier,
        seed: currentSeed,
        camera: currentCamera,
        time: currentTime,
        backend: "webgpu",
        nativeWebGPU: renderer.backend.isWebGPUBackend === true,
        dpr: appliedDpr,
        timestampQueriesRequested: true,
        sustainedGpuTimingAvailable: false,
        performanceAcceptance: "insufficient-evidence",
        ...summary,
      };
    },
    describePipeline() {
      return {
        owner: "WebGPURenderer",
        sceneRendersPerFrame: 1,
        passes: ["forward-scene"],
        mrt: false,
        postprocessing: false,
        toneMapping: "ACESFilmicToneMapping",
        outputColorSpace: renderer.outputColorSpace,
        finalOutputOwner: "renderer",
      };
    },
    describeResources() {
      return {
        renderTargets: [{ id: "capture", format: "rgba8", width: captureTarget.width, height: captureTarget.height, transient: true }],
        objectFactory: {
          nodes: ship.runtime.nodes.size,
          meshes: ship.runtime.meshes.size,
          sockets: ship.runtime.sockets.size,
          colliders: ship.runtime.colliders.size,
          destructionGroups: ship.runtime.destructionGroups.size,
        },
        preservedInvariants: ["24 articulated oars", "semantic IDs", "primary silhouette", "single scene render"],
      };
    },
    getRuntimeContract() {
      return {
        nodeIds: [...ship.runtime.nodes.keys()].sort(),
        socketIds: [...ship.runtime.sockets.keys()].sort(),
        colliderIds: [...ship.runtime.colliders.keys()].sort(),
        destructionGroups: [...ship.runtime.destructionGroups.keys()].sort(),
      };
    },
    async dispose() {
      if (disposed) return;
      disposed = true;
      controls.dispose();
      ship?.dispose();
      floor.geometry.dispose();
      floor.material.dispose();
      captureTarget.dispose();
      renderer.dispose();
    },
  };

  return controller;
}
