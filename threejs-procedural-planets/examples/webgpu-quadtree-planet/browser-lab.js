import {
  AmbientLight,
  Color,
  DirectionalLight,
  PerspectiveCamera,
  REVISION,
  RenderPipeline,
  RenderTarget,
  Scene,
  UnsignedByteType,
  Vector3,
  WebGPURenderer,
} from "three/webgpu";
import { mrt, output, pass, renderOutput } from "three/tsl";

import { createPlanetAtmosphereHandoff } from "./integration-adapter.js";
import { createPatchBoundsCompute } from "./patch-compute.js";
import { createPlanetFieldAtlas } from "./planet-field-atlas.js";
import {
  PLANET_BODY_MODES,
  PLANET_DEBUG_MODES,
  PLANET_TIER_CONFIG,
  createPlanetPatchMesh,
  createPlanetRuntimeFrontier,
  disposePlanetPatchMesh,
  setPlanetMaterialMode,
} from "./planet-mesh.js";
import { frontierSignature } from "./planet-quadtree.js";
import {
  PLANET_TIER_IDS,
  enforcePlanetRouteLocks,
  resolvePlanetRoute,
} from "./route-contract.js";
import { assertPlanetDpr } from "./planet-tiers.js";

const canvas = document.querySelector("#view");
const status = document.querySelector("#status");

const SCENARIOS = Object.freeze({
  "field-crater-climate": {
    mode: "field-crater-climate",
    bodyMode: "solid",
    camera: "design",
  },
  "cross-face-quadtree": { mode: "patch-level", bodyMode: "solid", camera: "far" },
  "balance-and-stitching": { mode: "transition-mask", bodyMode: "solid", camera: "design" },
  "field-atlas": { mode: "derivative-candidate", bodyMode: "solid", camera: "near" },
  "solid-body-material": { mode: "final", bodyMode: "solid", camera: "design" },
  "gas-and-ice-giants": {
    mode: "final",
    bodyMode: "gas-giant",
    camera: "giants",
    dualGiants: true,
  },
  "orbit-to-surface": { mode: "final", bodyMode: "solid", camera: "near" },
});

const CAMERA_PRESETS = Object.freeze({
  near: { position: [0, 4200, 13700], target: [0, 1100, 0], near: 2, far: 70000 },
  design: { position: [17000, 9500, 22000], target: [0, 0, 0], near: 10, far: 90000 },
  far: { position: [35000, 21000, 44000], target: [0, 0, 0], near: 20, far: 140000 },
  orbit: { position: [26000, 8000, 26000], target: [0, 0, 0], near: 10, far: 100000 },
  horizon: { position: [0, 1900, 15000], target: [0, 600, 0], near: 1, far: 70000 },
  surface: { position: [0, 700, 12350], target: [0, 250, 0], near: 0.25, far: 50000 },
  giants: { position: [0, 9500, 43000], target: [0, 0, 0], near: 10, far: 120000 },
});

const TIERS = PLANET_TIER_IDS;
const SEEDS = Object.freeze([0x00000001, 0x9e3779b9]);
const CAPTURE_TARGETS = Object.freeze([
  "final",
  "patch-level",
  "transition-mask",
  "field-atlas",
  "gas-giant",
  "ice-giant",
]);

function alignedRowStride(width, height, pixels) {
  const rowBytes = width * 4;
  const aligned = Math.ceil(rowBytes / 256) * 256;
  const byteLength = pixels.byteLength;
  if (byteLength === rowBytes * height) return rowBytes;
  if (byteLength === aligned * height || byteLength === aligned * (height - 1) + rowBytes) {
    return aligned;
  }
  throw new Error(
    `invalid WebGPU readback byte length ${byteLength}; expected ${rowBytes * height}, ` +
    `${aligned * height}, or ${aligned * (height - 1) + rowBytes}`,
  );
}

function routeLocks(body) {
  const lockedScenario = body.dataset.lockedScenario || null;
  const lockedTier = body.dataset.lockedTier || null;
  if (lockedScenario && !(lockedScenario in SCENARIOS)) {
    throw new Error(`unknown locked planet scenario "${lockedScenario}"`);
  }
  if (lockedTier && !TIERS.includes(lockedTier)) {
    throw new Error(`unknown locked planet tier "${lockedTier}"`);
  }
  return Object.freeze({ lockedScenario, lockedTier });
}

async function createLab() {
  const renderer = new WebGPURenderer({ canvas, antialias: false });
  let logicalWidth = 1200;
  let logicalHeight = 800;
  let dpr = 1;
  renderer.setPixelRatio(dpr);
  renderer.setSize(logicalWidth, logicalHeight, false);
  await renderer.init();
  if (renderer.backend?.isWebGPUBackend !== true) {
    throw new Error("threejs-procedural-planets canonical lab requires native WebGPU");
  }
  const initializedRendererDevice = renderer.backend?.device ?? null;
  if (!initializedRendererDevice) {
    throw new Error("planet lab requires renderer.backend.device after WebGPU init");
  }
  let rendererDeviceGeneration = 1;
  let rendererDeviceStatus = "active";
  let deviceLossGeneration = 0;
  let lossPromiseObservedOnActualDevice = true;
  initializedRendererDevice.lost.then((info) => {
    if (rendererDeviceStatus === "disposed" && info?.reason === "destroyed") return;
    if (rendererDeviceStatus !== "lost") deviceLossGeneration += 1;
    rendererDeviceStatus = "lost";
  });

  const scene = new Scene();
  scene.background = new Color(0x02050c);
  const camera = new PerspectiveCamera(42, logicalWidth / logicalHeight, 10, 90000);
  scene.add(new AmbientLight(0x8aa2c4, 0.52));
  const sun = new DirectionalLight(0xffe5bc, 4.2);
  sun.position.set(22000, 18000, 16000);
  scene.add(sun);

  const pipeline = new RenderPipeline(renderer);
  const scenePass = pass(scene, camera);
  scenePass.setMRT(mrt({ output }));
  const colorNode = scenePass.getTextureNode("output");
  pipeline.outputNode = renderOutput(colorNode);
  pipeline.outputColorTransform = false;
  pipeline.needsUpdate = true;

  const locks = routeLocks(document.body);
  const route = enforcePlanetRouteLocks(resolvePlanetRoute(window.location.href), locks);

  let tier = route.tier;
  let seed = SEEDS[0];
  let scenario = route.scenario;
  let mode = SCENARIOS[scenario].mode;
  let bodyMode = SCENARIOS[scenario].bodyMode;
  let cameraId = SCENARIOS[scenario].camera;
  let timeSeconds = 0;
  let mesh = null;
  let companionMesh = null;
  let atlas = null;
  let patchBounds = null;
  let runtime = null;
  let atmosphereHandoff = null;
  let captureTarget = null;
  let disposed = false;
  let frameCount = 0;
  let frontierRebuildCount = 0;

  function assertKnown(value, values, label) {
    if (!values.includes(value)) throw new Error(`unknown planet ${label} "${value}"`);
  }

  function assertMutable(lockValue, requested, label) {
    if (lockValue && requested !== lockValue) {
      throw new Error(`planet ${label} is locked to "${lockValue}" on this route`);
    }
  }

  function applyCamera(id) {
    if (!(id in CAMERA_PRESETS)) throw new Error(`unknown planet camera "${id}"`);
    cameraId = id;
    const preset = CAMERA_PRESETS[id];
    camera.position.fromArray(preset.position);
    camera.near = preset.near;
    camera.far = preset.far;
    camera.lookAt(new Vector3().fromArray(preset.target));
    camera.updateProjectionMatrix();
    camera.updateMatrixWorld(true);
  }

  function destroySubject() {
    if (mesh) scene.remove(mesh);
    if (companionMesh) scene.remove(companionMesh);
    patchBounds?.dispose();
    atlas?.dispose();
    disposePlanetPatchMesh(mesh);
    disposePlanetPatchMesh(companionMesh);
    mesh = null;
    companionMesh = null;
    atlas = null;
    patchBounds = null;
    runtime = null;
    atmosphereHandoff = null;
  }

  function applyVisualState() {
    if (!mesh) return;
    const state = SCENARIOS[scenario];
    mesh.position.set(0, 0, 0);
    mesh.scale.setScalar(1);
    setPlanetMaterialMode(mesh, { mode, bodyMode, time: timeSeconds });
    if (state.dualGiants) {
      mesh.position.set(-7200, 0, 0);
      mesh.scale.setScalar(0.55);
      setPlanetMaterialMode(mesh, { mode: "final", bodyMode: "gas-giant", time: timeSeconds });
      companionMesh.visible = true;
      companionMesh.position.set(7200, 0, 0);
      companionMesh.scale.setScalar(0.55);
      setPlanetMaterialMode(companionMesh, {
        mode: "final",
        bodyMode: "ice-giant",
        time: timeSeconds,
      });
    } else if (companionMesh) {
      companionMesh.visible = false;
    }
    mesh.updateMatrixWorld(true);
    companionMesh?.updateMatrixWorld(true);
  }

  function buildSubject() {
    destroySubject();
    runtime = createPlanetRuntimeFrontier({
      tier,
      seed,
      cameraPositionBody: camera.position.toArray(),
      verticalFovRadians: camera.fov * Math.PI / 180,
      renderTargetHeightPx: Math.round(logicalHeight * dpr),
      cameraNear: camera.near,
    });
    atlas = createPlanetFieldAtlas({
      patches: runtime.patches,
      preset: runtime.config.preset,
      seed,
      tileSide: runtime.tierConfig.gridSide,
    });
    mesh = createPlanetPatchMesh({
      tier,
      seed,
      patches: runtime.patches,
      atlas,
    });
    if (SCENARIOS[scenario].dualGiants) {
      companionMesh = createPlanetPatchMesh({
        tier,
        seed,
        patches: runtime.patches,
        atlas,
      });
      companionMesh.name = `${mesh.name}-ice-companion`;
    }
    patchBounds = createPatchBoundsCompute({
      patches: runtime.patches,
      radiusWorld: runtime.radiusWorld,
      maximumDisplacementWorld: runtime.maximumDisplacementWorld,
      maximumSurfaceSlope: runtime.tierConfig.maximumSurfaceSlope,
      gridSide: runtime.tierConfig.gridSide,
    });
    atlas.dispatch(renderer, { patchIds: null });
    patchBounds.dispatch(renderer);
    atmosphereHandoff = createPlanetAtmosphereHandoff({
      config: runtime.config,
      worldUnitsPerMeter: runtime.worldUnitsPerMeter,
    });
    scene.add(mesh);
    if (companionMesh) scene.add(companionMesh);
    frontierRebuildCount += 1;
    applyVisualState();
  }

  function applyScenario(id, { rebuild = true } = {}) {
    if (!(id in SCENARIOS)) throw new Error(`unknown planet scenario "${id}"`);
    assertMutable(locks.lockedScenario, id, "scenario");
    scenario = id;
    const state = SCENARIOS[id];
    mode = state.mode;
    bodyMode = state.bodyMode;
    applyCamera(state.camera);
    if (rebuild) buildSubject();
    else applyVisualState();
  }

  assertKnown(tier, TIERS, "tier");
  applyCamera(cameraId);
  buildSubject();

  const controller = {
    async ready() {},
    async setScenario(id) {
      applyScenario(id);
    },
    async setMode(id) {
      // Capture harness aliases: planet has no separate post stack, so no-post
      // maps to final; diagnostics maps to the patch-level debug visualization.
      const captureAliases = Object.freeze({
        "no-post": "final",
        diagnostics: "height",
      });
      const resolved = captureAliases[id] ?? id;
      assertKnown(resolved, PLANET_DEBUG_MODES, "mode");
      mode = resolved;
      setPlanetMaterialMode(mesh, { mode });
      if (companionMesh?.visible) setPlanetMaterialMode(companionMesh, { mode });
    },
    async setTier(id) {
      assertKnown(id, TIERS, "tier");
      assertMutable(locks.lockedTier, id, "tier");
      if (tier === id) return;
      const cap = PLANET_TIER_CONFIG[id].dprCap;
      if (dpr > cap) {
        throw new Error(`current DPR ${dpr} exceeds planet tier "${id}" cap ${cap}; resize first`);
      }
      tier = id;
      buildSubject();
    },
    async setSeed(nextSeed) {
      if (!Number.isInteger(nextSeed)) throw new Error("planet seed must be an integer");
      seed = nextSeed >>> 0;
      atlas.setSeed(seed);
      atlas.dispatch(renderer);
    },
    async setCamera(id) {
      applyCamera(id);
      buildSubject();
    },
    async setTime(seconds) {
      if (!Number.isFinite(seconds)) throw new Error("planet time must be finite");
      timeSeconds = seconds;
      setPlanetMaterialMode(mesh, { time: seconds });
      if (companionMesh) setPlanetMaterialMode(companionMesh, { time: seconds });
    },
    async step(deltaSeconds) {
      if (!(deltaSeconds >= 0) || !Number.isFinite(deltaSeconds)) {
        throw new Error("planet step delta must be finite and non-negative");
      }
      await controller.setTime(timeSeconds + deltaSeconds);
    },
    async resetHistory() {
      // No temporal history is owned by the standalone planet lab.
    },
    async resize(width, height, requestedDpr = 1) {
      if (!Number.isInteger(width) || !Number.isInteger(height) || width <= 0 || height <= 0 ||
          !(requestedDpr > 0) || !Number.isFinite(requestedDpr)) {
        throw new Error("planet resize requires positive integer dimensions and finite positive DPR");
      }
      assertPlanetDpr(tier, requestedDpr);
      logicalWidth = width;
      logicalHeight = height;
      dpr = requestedDpr;
      renderer.setPixelRatio(dpr);
      renderer.setSize(width, height, false);
      camera.aspect = width / height;
      camera.updateProjectionMatrix();
      buildSubject();
    },
    async renderOnce() {
      if (disposed) throw new Error("planet lab is disposed");
      pipeline.render();
      frameCount += 1;
    },
    async capturePixels(target = "final") {
      assertKnown(target, CAPTURE_TARGETS, "capture target");
      const savedMode = mode;
      const savedBodyMode = bodyMode;
      if (target === "patch-level") await controller.setMode("patch-level");
      else if (target === "transition-mask") await controller.setMode("transition-mask");
      else if (target === "field-atlas") await controller.setMode("derivative-candidate");
      else if (target === "gas-giant" || target === "ice-giant") {
        bodyMode = target;
        setPlanetMaterialMode(mesh, { mode: "final", bodyMode });
        if (companionMesh) companionMesh.visible = false;
      } else if (target === "final") {
        // Preserve the active controller mode so capture-harness setMode("height"/"no-post"/...)
        // produces distinct presentation readbacks instead of being forced back to final.
        setPlanetMaterialMode(mesh, { mode, bodyMode });
        if (companionMesh?.visible) setPlanetMaterialMode(companionMesh, { mode, bodyMode });
      } else {
        await controller.setMode("final");
      }
      const width = renderer.domElement.width;
      const height = renderer.domElement.height;
      captureTarget?.dispose();
      captureTarget = new RenderTarget(width, height, { type: UnsignedByteType });
      renderer.setRenderTarget(captureTarget);
      pipeline.render();
      renderer.setRenderTarget(null);
      const pixels = await renderer.readRenderTargetPixelsAsync(captureTarget, 0, 0, width, height);
      mode = savedMode;
      bodyMode = savedBodyMode;
      applyVisualState();
      return {
        target,
        width,
        height,
        format: "rgba8unorm",
        outputColorSpace: renderer.outputColorSpace,
        bytesPerPixel: 4,
        bytesPerRow: alignedRowStride(width, height, pixels),
        pixels,
      };
    },
    describePipeline() {
      return {
        owners: {
          renderer: "webgpu-quadtree-planet",
          scenePass: "webgpu-quadtree-planet",
          quadtree: "planet-camera-projected-frontier",
          field: "planet-field-atlas-storage",
          patchBounds: "planet:patch-analytic-bounds",
          toneMap: "renderOutput",
          outputTransform: "renderOutput",
        },
        signals: ["output", "field-atlas-base", "field-atlas-mips", "patch-bounds"],
        sceneSubmissions: [{
          id: "planet-scene-pass",
          kind: "lit-scene",
          count: 1,
          indexedLeafDraws: mesh.userData.resources.drawCount +
            (companionMesh?.visible ? companionMesh.userData.resources.drawCount : 0),
        }],
        computeDispatches: [
          ...atlas.describe().dispatches,
          { id: "planet:patch-analytic-bounds", ...patchBounds.describe() },
        ],
        resources: [mesh.userData.resources, atlas.describe(), patchBounds.describe()],
        finalToneMapOwner: "renderOutput",
        finalOutputTransformOwner: "renderOutput",
        runtimeProfile: "correctness",
        performanceTimestampMode: "off",
        timestampQueriesRequired: false,
        timestampQueriesRequested: false,
        timestampQueriesActive: false,
      };
    },
    describeResources() {
      return {
        geometry: mesh.userData.resources,
        companionGeometry: companionMesh?.userData.resources ?? null,
        atlas: atlas.describe(),
        patchBounds: patchBounds.describe(),
        renderTargets: ["scenePass.output"],
      };
    },
    getMetrics() {
      const backend = renderer.backend;
      const device = backend?.device ?? null;
      const nativeWebGPU = backend?.isWebGPUBackend === true;
      return {
        labId: "webgpu-quadtree-planet",
        threeRevision: REVISION,
        runtimeProfile: "correctness",
        performanceTimestampMode: "off",
        timestampQueriesRequired: false,
        timestampQueriesRequested: false,
        timestampQueriesActive: false,
        nativeWebGPU,
        initialized: renderer.initialized === true,
        rendererType: "WebGPURenderer",
        backend: nativeWebGPU ? "WebGPU" : "unsupported",
        backendKind: nativeWebGPU ? "WebGPU" : "unsupported",
        rendererBackend: backend?.constructor?.name ?? "unknown",
        rendererDeviceStatus,
        rendererDeviceGeneration,
        deviceLossGeneration,
        viewport: {
          width: { value: logicalWidth, unit: "px", label: "Measured", source: "planet LabController logicalWidth" },
          height: { value: logicalHeight, unit: "px", label: "Measured", source: "planet LabController logicalHeight" },
          dpr: { value: dpr, unit: "1", label: "Measured", source: "planet LabController dpr" },
        },
        rendererBackendEvidence: {
          backendKind: "WebGPU",
          backendType: backend?.constructor?.name ?? "unknown",
          isWebGPUBackend: nativeWebGPU,
          initialized: renderer.initialized === true,
          deviceIdentityVerified: device === initializedRendererDevice,
          deviceIdentitySource: "renderer.backend.device-after-init",
          deviceType: device?.constructor?.name ?? "GPUDevice",
          lossPromiseObservedOnActualDevice,
          rendererDeviceGeneration,
        },
        renderer: { threeRevision: REVISION, isWebGPUBackend: nativeWebGPU },
        scenario,
        mode,
        bodyMode,
        dualGiantsLive: Boolean(SCENARIOS[scenario].dualGiants && companionMesh?.visible),
        tier,
        tierDprCap: PLANET_TIER_CONFIG[tier].dprCap,
        dpr,
        seed,
        camera: cameraId,
        timeSeconds,
        frameCount,
        frontierRebuildCount,
        frontierSignature: frontierSignature(runtime.patches),
        patchContract: mesh.geometry.userData.planetPatchContract,
        atlas: atlas.describe(),
        atmosphereHandoff: atmosphereHandoff.serializable(),
      };
    },
    async dispose() {
      if (disposed) return;
      disposed = true;
      rendererDeviceStatus = "disposed";
      destroySubject();
      captureTarget?.dispose();
      scenePass.dispose?.();
      pipeline.dispose();
      renderer.dispose();
    },
  };

  return controller;
}

window.__labController = null;
window.__labError = null;

const labControllerPromise = createLab();
window.labController = labControllerPromise;
window.__LAB_CONTROLLER__ = labControllerPromise;

labControllerPromise
  .then(async (controller) => {
    window.__labController = controller;
    window.labController = controller;
    window.__LAB_CONTROLLER__ = controller;
    await controller.renderOnce();
    status.textContent = "native WebGPU ready";
  })
  .catch((error) => {
    window.__labError = error.stack ?? error.message;
    status.textContent = error.message;
    console.error(error);
  });
