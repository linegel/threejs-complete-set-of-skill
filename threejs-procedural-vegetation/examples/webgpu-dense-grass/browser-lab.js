import {
  AmbientLight,
  Color,
  DirectionalLight,
  NoColorSpace,
  PerspectiveCamera,
  REVISION,
  RenderPipeline,
  RenderTarget,
  Scene,
  TextureLoader,
  UnsignedByteType,
  Vector2,
  WebGPURenderer,
} from "three/webgpu";
import { mrt, normalView, output, packNormalToRGB, pass, renderOutput } from "three/tsl";

import {
  createDebugGroundPlane,
  createWebGPUDenseGrassSystem,
  denseGrassQualityTiers,
  meadowDensityMaskPaths,
  webgpuDenseGrassDebugModes,
} from "./dense-grass-system.js";
import { DENSE_GRASS_RUNTIME_TIER, resolveDenseGrassRoute } from "./route-contract.js";
import { createStrictLabController } from "../../../labs/runtime/strict-lab-controller.mjs";
import {
  bindWebGPUDeviceIdentity,
  captureRuntimeProfileFields,
  markWebGPUDeviceDisposed,
  markWebGPUDeviceDisposing,
  webgpuDeviceIdentityMetrics,
} from "../../../labs/runtime/webgpu-device-identity.mjs";

const canvas = document.querySelector("#view");
const status = document.querySelector("#status");

const SCENARIOS = Object.freeze({
  "dense-grass-placement": { debug: "density", mask: null, touches: [] },
  "dense-grass-wind-and-trampling": {
    debug: "wind",
    mask: null,
    touches: [
      { x: 1.5, z: -1.0, radius: 2.4, weight: 1 },
      { x: -3.0, z: 2.2, radius: 1.7, weight: 0.72 },
    ],
  },
  "dense-grass-lod-and-impostors": { debug: "lod", mask: null, touches: [] },
  "uniform-density": { debug: "final", mask: null, touches: [] },
  "mask-a": { debug: "final", mask: "a", touches: [] },
  "mask-b": { debug: "final", mask: "b", touches: [] },
  "mask-c": { debug: "final", mask: "c", touches: [] },
});

const CAMERA_PRESETS = Object.freeze({
  near: { position: [10, 4.2, 13], target: [0, 1.1, 0] },
  design: { position: [25, 11, 31], target: [0, 0.5, 0] },
  far: { position: [58, 24, 67], target: [0, 0, 0] },
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
  if (pixels.byteLength === aligned * height ||
      pixels.byteLength === aligned * (height - 1) + tight) return { bytesPerRow: aligned, pixels };
  throw new Error(`unrecognized dense-grass readback stride: ${pixels.byteLength} bytes`);
}

async function loadDensityMask(id) {
  if (id == null) return null;
  if (!(id in meadowDensityMaskPaths)) throw new Error(`unknown meadow density mask "${id}"`);
  const texture = await new TextureLoader().loadAsync(meadowDensityMaskPaths[id]);
  texture.colorSpace = NoColorSpace;
  texture.flipY = false;
  texture.generateMipmaps = true;
  texture.userData.densityMaskUrl = meadowDensityMaskPaths[id];
  return texture;
}

async function createLab() {
  const manifest = await fetch(new URL("./lab.manifest.json", import.meta.url)).then((response) => {
    if (!response.ok) throw new Error(`failed to load dense-grass manifest: ${response.status}`);
    return response.json();
  });
  const renderer = new WebGPURenderer({ canvas, antialias: false });
  renderer.setPixelRatio(1);
  renderer.setSize(1200, 800, false);
  await renderer.init();
  if (renderer.backend?.isWebGPUBackend !== true) {
    throw new Error("threejs-procedural-vegetation dense grass requires native WebGPU");
  }
  const deviceIdentity = bindWebGPUDeviceIdentity(renderer);
  renderer.shadowMap.enabled = true;

  const scene = new Scene();
  scene.background = new Color(0x8fb5d1);
  const camera = new PerspectiveCamera(48, 1.5, 0.1, 500);
  scene.add(new AmbientLight(0x9eb4ca, 0.6));
  const sun = new DirectionalLight(0xfff2c2, 3.6);
  sun.position.set(38, 54, 24);
  sun.castShadow = true;
  sun.shadow.mapSize.set(1024, 1024);
  sun.shadow.camera.left = -70;
  sun.shadow.camera.right = 70;
  sun.shadow.camera.top = 70;
  sun.shadow.camera.bottom = -70;
  scene.add(sun);
  const ground = createDebugGroundPlane({ size: 240 });
  scene.add(ground);

  const scenePass = pass(scene, camera);
  scenePass.setMRT(mrt({ output, normal: packNormalToRGB(normalView) }));
  const pipeline = new RenderPipeline(renderer);
  pipeline.outputNode = renderOutput(scenePass.getTextureNode("output"));
  pipeline.outputColorTransform = false;
  pipeline.needsUpdate = true;

  let tier = "dense/medium";
  let scenario = "uniform-density";
  let mode = "final";
  let cameraId = "design";
  let seed = 1;
  let elapsed = 0;
  let system = null;
  let densityMask = null;
  let captureTarget = null;
  let disposed = false;
  let frameCount = 0;
  const viewport = { width: 1200, height: 800, requestedDpr: 1, actualDpr: 1 };

  function tierDprCap() {
    return denseGrassQualityTiers[DENSE_GRASS_RUNTIME_TIER[tier]].dprCap;
  }

  function applyViewport() {
    viewport.actualDpr = Math.min(viewport.requestedDpr, tierDprCap());
    renderer.setPixelRatio(viewport.actualDpr);
    renderer.setSize(viewport.width, viewport.height, false);
    camera.aspect = viewport.width / viewport.height;
    camera.updateProjectionMatrix();
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

  function setCamera(id) {
    const preset = CAMERA_PRESETS[id];
    if (!preset) throw new Error(`unknown dense-grass camera "${id}"`);
    cameraId = id;
    camera.position.fromArray(preset.position);
    camera.lookAt(...preset.target);
    camera.updateMatrixWorld(true);
  }

  async function destroySystem() {
    if (!system) return;
    scene.remove(system.object);
    system.dispose();
    system = null;
    densityMask?.dispose();
    densityMask = null;
  }

  async function buildSystem() {
    const config = SCENARIOS[scenario];
    await destroySystem();
    densityMask = await loadDensityMask(config.mask);
    system = await createWebGPUDenseGrassSystem(renderer, {
      tier: DENSE_GRASS_RUNTIME_TIER[tier],
      seed,
      densityMaskTexture: densityMask,
    });
    scene.add(system.object);
    system.setDebugMode(config.debug);
    mode = config.debug;
    system.setTouches(config.touches);
    system.setWind({ direction: new Vector2(1, 0.3), strength: 0.38, speed: 0.72 });
    system.update({ elapsed, camera });
  }

  async function setScenario(id) {
    if (!(id in SCENARIOS)) throw new Error(`unknown dense-grass scenario "${id}"`);
    const previousMask = SCENARIOS[scenario]?.mask;
    scenario = id;
    mode = SCENARIOS[id].debug;
    if (!system || previousMask !== SCENARIOS[id].mask) {
      await buildSystem();
      return;
    }
    system.setDebugMode(SCENARIOS[id].debug);
    system.setTouches(SCENARIOS[id].touches);
  }

  const route = resolveDenseGrassRoute(window.location.href);
  tier = route.tier;
  if (!(route.scenario in SCENARIOS)) throw new Error(`unknown dense-grass scenario "${route.scenario}"`);
  scenario = route.scenario;
  setCamera("design");
  await buildSystem();

  const implementation = {
    async ready() {},
    setScenario,
    async setMode(id) {
      // Builtin capture requests final/no-post/diagnostics; map the latter two
      // onto distinct dense-grass debug views so images are not byte-identical.
      if (id === "no-post") {
        mode = "bounds";
        system.setDebugMode("bounds");
        return;
      }
      if (id === "diagnostics") {
        mode = "density";
        system.setDebugMode("density");
        return;
      }
      if (!webgpuDenseGrassDebugModes.has(id)) throw new Error(`unknown dense-grass mode "${id}"`);
      mode = id;
      system.setDebugMode(id);
    },
    async setTier(id) {
      if (!(id in DENSE_GRASS_RUNTIME_TIER)) throw new Error(`unknown dense-grass tier "${id}"`);
      if (id === tier) return;
      const retainedMode = mode;
      tier = id;
      await buildSystem();
      mode = retainedMode;
      system.setDebugMode(mode);
      applyViewport();
    },
    async setSeed(nextSeed) {
      if (!Number.isInteger(nextSeed)) throw new Error("dense-grass seed must be an integer");
      const retainedMode = mode;
      seed = nextSeed >>> 0;
      await buildSystem();
      mode = retainedMode;
      system.setDebugMode(mode);
    },
    async setCamera(id) {
      setCamera(id);
      system.update({ elapsed, camera });
    },
    async setTime(seconds) {
      if (!Number.isFinite(seconds)) throw new Error("dense-grass time must be finite");
      elapsed = seconds;
      system.update({ elapsed, camera });
    },
    async step(deltaSeconds) {
      if (!(deltaSeconds >= 0) || !Number.isFinite(deltaSeconds)) {
        throw new Error("dense-grass step must be finite and non-negative");
      }
      await implementation.setTime(elapsed + deltaSeconds);
    },
    async resetHistory() {},
    async resize(width, height, dpr = 1) {
      if (!(width > 0 && height > 0 && dpr > 0)) throw new Error("invalid dense-grass resize");
      viewport.width = width;
      viewport.height = height;
      viewport.requestedDpr = dpr;
      applyViewport();
    },
    async renderOnce() {
      if (disposed) throw new Error("dense-grass lab is disposed");
      system.update({ elapsed, camera });
      pipeline.render();
      frameCount += 1;
    },
    async capturePixels(target = "final") {
      if (!['final', 'normal'].includes(target)) throw new Error(`unknown dense-grass capture target "${target}"`);
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
        colorSpace: "srgb",
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
        ...captureRuntimeProfileFields(),
        owners: {
          renderer: "webgpu-dense-grass",
          scenePass: "webgpu-dense-grass",
          wind: "dense-grass shared live uniforms",
          touch: "dense-grass bounded touch channel",
          toneMap: "renderOutput",
          outputTransform: "renderOutput",
        },
        signals: ["output", "normal", "wind", "touch", "shadow-depth"],
        sceneSubmissions: [{ id: "vegetation-scene", kind: "lit-scene", count: 1 }],
        computeDispatches: [{ id: "static-placement-init", count: system.getStats().initDispatches }],
        resources: [implementation.describeResources()],
        finalToneMapOwner: "renderOutput",
        finalOutputTransformOwner: "renderOutput",
      };
    },
    describeResources() {
      const diagnostics = system.getDiagnostics();
      return {
        storageBytes: diagnostics.storageResidentBytes,
        storageBytesPerBlade: diagnostics.storageBytesPerBlade,
        renderGeometryBytes: diagnostics.renderGeometryBytes,
        patches: diagnostics.patchCount,
        visibleDrawObjects: diagnostics.visibleDrawObjects,
        allocatedDrawObjects: diagnostics.patchCount * 2,
        rendererInfo: rendererInfoSnapshot(),
        staticStorageIdentity: diagnostics.staticStorageIdentity,
        staticStorageRevision: diagnostics.staticStorageRevision,
        staticStorageImmutable: diagnostics.staticStorageImmutable,
        rootedDeformation: diagnostics.rootedDeformation,
        deformedNormals: diagnostics.deformedNormals,
        shadowUsesVisibleDeformation: diagnostics.visibleShadowDeformationParity,
        worldUnitsPerMeter: diagnostics.worldUnitsPerMeter,
        dpr: { ...viewport, cap: tierDprCap() },
        renderTargets: ["scenePass.output", "scenePass.normal"],
        shadows: { enabled: renderer.shadowMap.enabled, mapSize: [sun.shadow.mapSize.x, sun.shadow.mapSize.y] },
      };
    },
    getMetrics() {
      return {
        labId: "webgpu-dense-grass",
        ...webgpuDeviceIdentityMetrics(deviceIdentity, renderer),
        threeRevision: REVISION,
        scenario,
        tier,
        mode,
        seed,
        camera: cameraId,
        timeSeconds: elapsed,
        elapsed,
        frameCount,
        viewport: {
          width: viewport.width,
          height: viewport.height,
          dpr: viewport.actualDpr,
        },
        dpr: { ...viewport, cap: tierDprCap() },
        infoSnapshot: rendererInfoSnapshot(),
        ...system.getDiagnostics(),
      };
    },
    async dispose() {
      if (disposed) return;
      disposed = true;
      markWebGPUDeviceDisposing(deviceIdentity);
      await destroySystem();
      ground.geometry.dispose();
      ground.material.dispose();
      captureTarget?.dispose();
      scenePass.dispose?.();
      pipeline.dispose();
      renderer.dispose();
      markWebGPUDeviceDisposed(deviceIdentity);
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
