import {
  REVISION,
  RenderPipeline,
  RenderTarget,
  UnsignedByteType,
  WebGPURenderer,
} from "three/webgpu";
import { mrt, normalView, output, packNormalToRGB, pass, renderOutput } from "three/tsl";

import {
  ashDiagnosticModes,
  createAshForestStorage,
  createAshScene,
  disposeAshMaterialTextures,
  getAshGeometryResourceLedger,
  setAshDiagnosticMode,
} from "./ash-scene.js";
import { ASH_RUNTIME_TIER, ASH_TIER_IDS, resolveAshRoute } from "./route-contract.js";
import { createStrictLabController } from "../../../labs/runtime/strict-lab-controller.mjs";

const canvas = document.querySelector("#view");
const status = document.querySelector("#status");
const TIERS = ASH_TIER_IDS;
const SCENARIOS = Object.freeze({
  "structured-growth": { mode: "final", tier: "growth/hero" },
  "leaf-origins-and-normals": { mode: "leaf-origins", tier: "growth/hero" },
  "forest-storage-and-lod": { mode: "final", tier: "growth/forest" },
  "vegetation-shadow-parity": { mode: "wind-displacement", tier: "growth/forest" },
  "ash-contract": { mode: "final", tier: "growth/hero" },
  "ash-forest": { mode: "final", tier: "growth/forest" }
});
const CAMERAS = Object.freeze({
  near: [84, 22, 0],
  design: [115, 20, 0],
  far: [175, 34, 28],
});
const TIER_DPR_CAP = Object.freeze({
  "growth/hero": 2,
  "growth/forest": 1.5,
  "growth/background": 1,
});

function alignReadback(width, height, pixels) {
  const tight = width * 4;
  const aligned = Math.ceil(tight / 256) * 256;
  if (pixels.byteLength === tight * height) {
    if (tight === aligned) return { bytesPerRow: aligned, pixels };
    const padded = new Uint8Array(aligned * (height - 1) + tight);
    const source = new Uint8Array(pixels.buffer, pixels.byteOffset, pixels.byteLength);
    for (let y = 0; y < height; y += 1) {
      padded.set(source.subarray(y * tight, (y + 1) * tight), y * aligned);
    }
    return { bytesPerRow: aligned, pixels: padded };
  }
  if (pixels.byteLength === aligned * height || pixels.byteLength === aligned * (height - 1) + tight) {
    return { bytesPerRow: aligned, pixels };
  }
  throw new Error(`unrecognized Ash readback stride ${pixels.byteLength}`);
}

async function createLab() {
  const manifest = await fetch(new URL("./lab.manifest.json", import.meta.url)).then((response) => {
    if (!response.ok) throw new Error(`failed to load Ash manifest: ${response.status}`);
    return response.json();
  });
  const renderer = new WebGPURenderer({ canvas, antialias: false });
  renderer.setPixelRatio(1);
  renderer.setSize(1200, 800, false);
  await renderer.init();
  if (renderer.backend?.isWebGPUBackend !== true) {
    throw new Error("structured Ash canonical lab requires native WebGPU");
  }
  renderer.shadowMap.enabled = true;

  const state = createAshScene({ loadTextures: true });
  state.sun.shadow.mapSize.set(1024, 1024);
  state.sun.shadow.camera.left = -90;
  state.sun.shadow.camera.right = 90;
  state.sun.shadow.camera.top = 100;
  state.sun.shadow.camera.bottom = -20;
  state.camera.aspect = 1.5;
  state.camera.updateProjectionMatrix();
  const forest = createAshForestStorage({
    tree: state.tree,
    materials: state.materials,
    timeNode: state.timeNode,
    count: 100,
    worldUnitsPerMeter: state.worldUnitsPerMeter,
  });
  state.scene.add(forest.group);

  const scenePass = pass(state.scene, state.camera);
  scenePass.setMRT(mrt({ output, normal: packNormalToRGB(normalView) }));
  const pipeline = new RenderPipeline(renderer);
  pipeline.outputNode = renderOutput(scenePass.getTextureNode("output"));
  pipeline.outputColorTransform = false;
  pipeline.needsUpdate = true;

  let tier = "growth/hero";
  let scenario = "ash-contract";
  let mode = "final";
  let cameraId = "design";
  let elapsed = 0;
  let frameCount = 0;
  let captureTarget = null;
  let disposed = false;
  const viewport = { width: 1200, height: 800, requestedDpr: 1, actualDpr: 1 };

  function applyViewport() {
    viewport.actualDpr = Math.min(viewport.requestedDpr, TIER_DPR_CAP[tier]);
    renderer.setPixelRatio(viewport.actualDpr);
    renderer.setSize(viewport.width, viewport.height, false);
    state.camera.aspect = viewport.width / viewport.height;
    state.camera.updateProjectionMatrix();
  }

  function rendererInfoSnapshot() {
    const render = renderer.info?.render ?? {};
    const memory = renderer.info?.memory ?? {};
    return {
      frame: renderer.info?.frame ?? null,
      calls: render.calls ?? null,
      triangles: render.triangles ?? null,
      points: render.points ?? null,
      lines: render.lines ?? null,
      geometries: memory.geometries ?? null,
      textures: memory.textures ?? null,
    };
  }

  function applyTier(id) {
    if (!TIERS.includes(id)) throw new Error(`unknown Ash tier "${id}"`);
    tier = id;
    const runtimeTier = ASH_RUNTIME_TIER[id];
    state.group.visible = runtimeTier !== "background";
    forest.group.visible = runtimeTier !== "hero";
    applyViewport();
  }

  function applyMode(id) {
    if (!ashDiagnosticModes.includes(id)) throw new Error(`unknown Ash mode "${id}"`);
    mode = id;
    setAshDiagnosticMode(state, id);
  }

  function applyCamera(id) {
    if (!(id in CAMERAS)) throw new Error(`unknown Ash camera "${id}"`);
    cameraId = id;
    state.camera.position.fromArray(CAMERAS[id]).multiplyScalar(state.worldUnitsPerMeter);
    state.camera.lookAt(0, 25 * state.worldUnitsPerMeter, 0);
    state.camera.updateMatrixWorld(true);
  }

  function applyScenario(id) {
    if (!(id in SCENARIOS)) throw new Error(`unknown Ash scenario "${id}"`);
    scenario = id;
    applyMode(SCENARIOS[id].mode);
    applyTier(SCENARIOS[id].tier);
  }

  const route = resolveAshRoute(window.location.href);
  applyScenario(route.scenario);
  if (route.tier) applyTier(route.tier);
  applyCamera("design");

  const implementation = {
    async ready() {},
    async setScenario(id) { applyScenario(id); },
    async setMode(id) { applyMode(id); },
    async setTier(id) { applyTier(id); },
    async setSeed(nextSeed) {
      if ((nextSeed >>> 0) !== 36330) {
        throw new Error("Ash legacy-fidelity topology is pinned to seed 36330");
      }
    },
    async setCamera(id) { applyCamera(id); },
    async setTime(seconds) {
      if (!Number.isFinite(seconds)) throw new Error("Ash time must be finite");
      elapsed = seconds;
      state.timeNode.value = seconds;
    },
    async step(deltaSeconds) {
      if (!(deltaSeconds >= 0) || !Number.isFinite(deltaSeconds)) throw new Error("Ash step must be finite and non-negative");
      await implementation.setTime(elapsed + deltaSeconds);
    },
    async resetHistory() {},
    async resize(width, height, dpr = 1) {
      if (!(width > 0 && height > 0 && dpr > 0)) throw new Error("invalid Ash resize");
      viewport.width = width;
      viewport.height = height;
      viewport.requestedDpr = dpr;
      applyViewport();
    },
    async renderOnce() {
      if (disposed) throw new Error("Ash lab is disposed");
      pipeline.render();
      frameCount += 1;
    },
    async capturePixels(target = "final") {
      if (!['final', 'normal'].includes(target)) throw new Error(`unknown Ash capture target "${target}"`);
      const width = renderer.domElement.width;
      const height = renderer.domElement.height;
      captureTarget?.dispose();
      captureTarget = new RenderTarget(width, height, { type: UnsignedByteType });
      const previous = pipeline.outputNode;
      if (target === "normal") {
        pipeline.outputNode = renderOutput(scenePass.getTextureNode("normal"));
        pipeline.needsUpdate = true;
      }
      let pixels;
      try {
        renderer.setRenderTarget(captureTarget);
        pipeline.render();
        pixels = await renderer.readRenderTargetPixelsAsync(captureTarget, 0, 0, width, height);
      } finally {
        renderer.setRenderTarget(null);
        if (pipeline.outputNode !== previous) {
          pipeline.outputNode = previous;
          pipeline.needsUpdate = true;
        }
      }
      const readback = alignReadback(width, height, pixels);
      return {
        target,
        width,
        height,
        bytesPerPixel: 4,
        bytesPerRow: readback.bytesPerRow,
        format: "rgba8unorm",
        colorSpace: "display-srgb",
        colorManaged: true,
        colorTransformOwner: "renderOutput",
        sourceBytesPerRow: readback.bytesPerRow,
        compactBytesPerRow: width * 4,
        rowStrideBytes: readback.bytesPerRow,
        data: readback.pixels,
        pixels: readback.pixels,
      };
    },
    describePipeline() {
      return {
        owners: {
          renderer: "structured-ash-growth",
          scenePass: "structured-ash-growth",
          wind: "shared Ash time/wind nodes",
          toneMap: "renderOutput",
          outputTransform: "renderOutput",
        },
        signals: ["output", "normal", "rooted-wind", "shadow-depth"],
        sceneSubmissions: [{ id: "ash-scene", kind: "lit-scene", count: 1 }],
        computeDispatches: [],
        resources: [implementation.describeResources()],
        finalToneMapOwner: "renderOutput",
        finalOutputTransformOwner: "renderOutput",
      };
    },
    describeResources() {
      const branchVertices = state.tree.branchGeometry.getAttribute("position").count;
      const leafVertices = state.tree.leafGeometry.getAttribute("position").count;
      const branchTriangles = state.tree.branchGeometry.index.count / 3;
      const leafTriangles = state.tree.leafGeometry.index.count / 3;
      const runtimeTier = ASH_RUNTIME_TIER[tier];
      const geometryLedger = getAshGeometryResourceLedger(state.tree);
      return {
        foreground: {
          branchVertices,
          branchTriangles,
          leafVertices,
          leafTriangles,
          visible: state.group.visible,
          structuralDraws: state.group.visible ? 2 : 0,
          rootedDeformation: state.leafMesh.material.positionNode === state.materials.leaves.positionNode,
          deformedNormal: state.leafMesh.material.normalNode === state.materials.leaves.normalNode,
          shadowUsesVisibleMaterial: state.leafMesh.castShadow && state.leafMesh.customDepthMaterial == null,
          geometryResidentBytes: geometryLedger.residentBytes,
          uniqueBufferArrays: geometryLedger.uniqueBufferArrays,
        },
        forest: {
          instances: forest.count,
          drawCount: forest.drawCount,
          storageBytes: forest.storageBytes,
          bands: forest.bands.length,
          visible: forest.group.visible,
          visibleStructuralDraws: forest.group.visible ? forest.drawCount : 0,
          storageIdentity: forest.storageIdentity,
          storageImmutable: forest.storageImmutable(),
          worldUnitsPerMeter: forest.worldUnitsPerMeter,
          sharedTopologyResidentBytes: geometryLedger.residentBytes,
          geometryObjects: forest.bands.length * 2,
        },
        tierLock: {
          id: tier,
          runtimeTier,
          dprCap: TIER_DPR_CAP[tier],
          requestedDpr: viewport.requestedDpr,
          actualDpr: viewport.actualDpr,
        },
        rendererInfo: rendererInfoSnapshot(),
        shadows: { enabled: renderer.shadowMap.enabled, mapSize: [state.sun.shadow.mapSize.x, state.sun.shadow.mapSize.y] },
        renderTargets: ["scenePass.output", "scenePass.normal"],
      };
    },
    getMetrics() {
      return {
        backend: "webgpu",
        isWebGPUBackend: true,
        renderer: { threeRevision: REVISION, isWebGPUBackend: true },
        scenario,
        tier,
        mode,
        camera: cameraId,
        seed: 36330,
        elapsed,
        frameCount,
        worldUnitsPerMeter: state.worldUnitsPerMeter,
        dpr: { ...viewport, cap: TIER_DPR_CAP[tier] },
        rendererInfo: rendererInfoSnapshot(),
        stats: state.tree.stats,
        resources: controller.describeResources(),
      };
    },
    async dispose() {
      if (disposed) return;
      disposed = true;
      forest.dispose();
      state.branchMesh.geometry.dispose();
      state.leafMesh.geometry.dispose();
      state.leafOrigins.geometry.dispose();
      state.ground.geometry.dispose();
      state.ground.material.dispose();
      state.materials.bark.dispose();
      state.materials.leaves.dispose();
      disposeAshMaterialTextures(state.materials);
      for (const material of Object.values(state.materials.diagnostics)) material.dispose();
      captureTarget?.dispose();
      scenePass.dispose?.();
      pipeline.dispose();
      renderer.dispose();
    },
  };
  const controller = createStrictLabController(manifest, implementation);
  return controller;
}

window.__labController = null;
window.__labError = null;
const labControllerPromise = createLab();
window.labController = labControllerPromise;
window.__LAB_CONTROLLER__ = labControllerPromise;
labControllerPromise.then(async (controller) => {
  window.__labController = controller;
  window.labController = controller;
  window.__LAB_CONTROLLER__ = controller;
  await controller.renderOnce();
  status.textContent = "native WebGPU ready";
}).catch((error) => {
  window.__labError = error.stack ?? error.message;
  status.textContent = error.message;
  console.error(error);
});
