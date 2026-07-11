import {
  AmbientLight,
  Color,
  DirectionalLight,
  Mesh,
  MeshStandardNodeMaterial,
  PerspectiveCamera,
  PlaneGeometry,
  REVISION,
  RenderPipeline,
  RenderTarget,
  Scene,
  UnsignedByteType,
  WebGPURenderer,
} from "three/webgpu";
import { color, mrt, normalView, output, packNormalToRGB, pass, renderOutput } from "three/tsl";

import { createStrictLabController } from "../../../labs/runtime/strict-lab-controller.mjs";
import { createVegetationIntegration } from "./vegetation-integration.js";
import {
  VEGETATION_INTEGRATION_TIER_CONFIG,
  resolveVegetationIntegrationRoute,
} from "./route-contract.js";

const canvas = document.querySelector("#view");
const status = document.querySelector("#status");
const WORLD_UNITS_PER_METER = 0.5;
const TIER_CONFIG = VEGETATION_INTEGRATION_TIER_CONFIG;

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
  throw new Error(`unrecognized vegetation integration readback stride: ${pixels.byteLength}`);
}

async function createLab() {
  const manifest = await fetch(new URL("./lab.manifest.json", import.meta.url)).then((response) => {
    if (!response.ok) throw new Error(`failed to load vegetation integration manifest: ${response.status}`);
    return response.json();
  });
  const renderer = new WebGPURenderer({ canvas, antialias: false });
  renderer.setPixelRatio(1);
  renderer.setSize(1200, 800, false);
  await renderer.init();
  if (renderer.backend?.isWebGPUBackend !== true) {
    throw new Error("vegetation integration requires native WebGPU");
  }
  renderer.shadowMap.enabled = true;

  const scene = new Scene();
  scene.background = new Color(0x8fb6c9);
  const camera = new PerspectiveCamera(48, 1.5, 0.05, 900);
  camera.position.set(115 * WORLD_UNITS_PER_METER, 24 * WORLD_UNITS_PER_METER, 54 * WORLD_UNITS_PER_METER);
  camera.lookAt(0, 24 * WORLD_UNITS_PER_METER, 0);
  camera.updateMatrixWorld(true);

  const groundGeometry = new PlaneGeometry(480 * WORLD_UNITS_PER_METER, 480 * WORLD_UNITS_PER_METER, 1, 1);
  groundGeometry.rotateX(-Math.PI * 0.5);
  const groundMaterial = new MeshStandardNodeMaterial();
  groundMaterial.colorNode = color(0x263c1d);
  groundMaterial.roughness = 0.93;
  const ground = new Mesh(groundGeometry, groundMaterial);
  ground.name = "host-terrain-surface";
  ground.receiveShadow = true;
  scene.add(ground);
  scene.add(new AmbientLight(0x9cb6c8, 0.48));
  const sun = new DirectionalLight(0xffefc0, 3.4);
  sun.position.set(72, 90, 46).multiplyScalar(WORLD_UNITS_PER_METER);
  sun.castShadow = true;
  sun.shadow.mapSize.set(1024, 1024);
  sun.shadow.camera.left = -180 * WORLD_UNITS_PER_METER;
  sun.shadow.camera.right = 180 * WORLD_UNITS_PER_METER;
  sun.shadow.camera.top = 180 * WORLD_UNITS_PER_METER;
  sun.shadow.camera.bottom = -40 * WORLD_UNITS_PER_METER;
  scene.add(sun);

  const scenePass = pass(scene, camera);
  scenePass.setMRT(mrt({ output, normal: packNormalToRGB(normalView) }));
  const pipeline = new RenderPipeline(renderer);
  pipeline.outputNode = renderOutput(scenePass.getTextureNode("output"));
  pipeline.outputColorTransform = false;
  pipeline.needsUpdate = true;

  const weather = {
    time: 0,
    windDirection: { x: 0.92, z: 0.38 },
    windStrength: 0.42,
    windSpeed: 0.75,
  };
  const owners = Object.freeze({
    renderer: "vegetation-host-pipeline",
    camera: "vegetation-host-camera",
    planet: "vegetation-host-planet",
    terrain: "vegetation-host-terrain",
    weather: "vegetation-host-weather",
    pipeline: "vegetation-host-pipeline",
    toneMap: "vegetation-host-pipeline",
    outputTransform: "vegetation-host-pipeline",
  });
  const host = {
    renderer,
    scene,
    camera,
    pipeline,
    planet: { worldUnitsPerMeter: WORLD_UNITS_PER_METER, radiusSceneUnits: 6_371_000 * WORLD_UNITS_PER_METER },
    terrain: { worldUnitsPerMeter: WORLD_UNITS_PER_METER, object: ground },
    weather,
    worldUnitsPerMeter: WORLD_UNITS_PER_METER,
    owners,
  };

  const route = resolveVegetationIntegrationRoute(window.location.href);
  let scenario = route.scenario;
  let mode = route.mode;
  let tier = route.tier;
  let seed = route.seed;
  let cameraId = route.camera;
  let elapsed = 0;
  let frameCount = 0;
  let integration = null;
  let captureTarget = null;
  let disposed = false;
  const viewport = { width: 1200, height: 800, requestedDpr: 1, actualDpr: 1 };

  function applyViewport() {
    viewport.actualDpr = Math.min(viewport.requestedDpr, TIER_CONFIG[tier].dprCap);
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

  function contactsForScenario() {
    return scenario === "creature-habitat-host"
      ? [
          { x: 2.4 * WORLD_UNITS_PER_METER, z: -1.2 * WORLD_UNITS_PER_METER, radius: 1.8 * WORLD_UNITS_PER_METER, weight: 1 },
          { x: -2.1 * WORLD_UNITS_PER_METER, z: 2.8 * WORLD_UNITS_PER_METER, radius: 1.2 * WORLD_UNITS_PER_METER, weight: 0.65 },
        ]
      : [];
  }

  async function buildIntegration() {
    integration?.dispose();
    const config = TIER_CONFIG[tier];
    integration = await createVegetationIntegration({
      host,
      scenario,
      denseTier: config.denseTier,
      denseSeed: seed,
      forestCount: config.forestCount,
      loadTextures: false,
    });
    integration.setMode(mode);
    integration.update({ time: elapsed, contacts: contactsForScenario() });
  }

  applyViewport();
  await buildIntegration();

  const implementation = {
    async ready() {},
    async setScenario(id) {
      if (!manifest.scenarios.some((entry) => entry.id === id)) throw new Error(`unknown vegetation integration scenario "${id}"`);
      scenario = id;
      await buildIntegration();
    },
    async setMode(id) {
      if (!manifest.modes.includes(id)) throw new Error(`unknown vegetation integration mode "${id}"`);
      mode = id;
      integration.setMode(id);
    },
    async setTier(id) {
      if (!(id in TIER_CONFIG)) throw new Error(`unknown vegetation integration tier "${id}"`);
      if (tier === id) return;
      tier = id;
      applyViewport();
      await buildIntegration();
    },
    async setSeed(nextSeed) {
      if (![1, 0x9e3779b9].includes(nextSeed)) throw new Error(`unknown vegetation integration seed "${nextSeed}"`);
      if (seed === nextSeed) return;
      seed = nextSeed;
      await buildIntegration();
    },
    async setCamera(id) {
      if (id !== "host-camera") throw new Error(`unknown vegetation integration camera "${id}"`);
      cameraId = id;
      camera.position.set(115 * WORLD_UNITS_PER_METER, 24 * WORLD_UNITS_PER_METER, 54 * WORLD_UNITS_PER_METER);
      camera.lookAt(0, 24 * WORLD_UNITS_PER_METER, 0);
      camera.updateMatrixWorld(true);
      integration.update({ time: elapsed, contacts: contactsForScenario() });
    },
    async setTime(seconds) {
      if (!Number.isFinite(seconds)) throw new Error("vegetation integration time must be finite");
      elapsed = seconds;
      weather.time = seconds;
      integration.update({ time: elapsed, contacts: contactsForScenario() });
    },
    async step(deltaSeconds) {
      if (!(deltaSeconds >= 0) || !Number.isFinite(deltaSeconds)) {
        throw new Error("vegetation integration step must be finite and non-negative");
      }
      await implementation.setTime(elapsed + deltaSeconds);
    },
    async resetHistory() {},
    async resize(width, height, dpr = 1) {
      if (!(width > 0 && height > 0 && dpr > 0)) throw new Error("invalid vegetation integration resize");
      viewport.width = width;
      viewport.height = height;
      viewport.requestedDpr = dpr;
      applyViewport();
    },
    async renderOnce() {
      if (disposed) throw new Error("vegetation integration lab is disposed");
      integration.update({ time: elapsed, contacts: contactsForScenario() });
      pipeline.render();
      frameCount += 1;
    },
    async capturePixels(target = "final") {
      if (!["final", "normal"].includes(target)) throw new Error(`unknown vegetation integration capture target "${target}"`);
      const width = renderer.domElement.width;
      const height = renderer.domElement.height;
      captureTarget?.dispose();
      captureTarget = new RenderTarget(width, height, { type: UnsignedByteType });
      const previousOutput = pipeline.outputNode;
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
        if (pipeline.outputNode !== previousOutput) {
          pipeline.outputNode = previousOutput;
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
        data: readback.pixels,
        pixels: readback.pixels,
      };
    },
    describePipeline() {
      const graph = integration.describePipeline();
      return {
        ...graph,
        signals: [
          ...graph.signals,
          { id: "output-normal-mrt", producer: owners.pipeline, consumers: ["presentation", "diagnostics"] },
          { id: "shadow-depth", producer: owners.pipeline, consumers: ["dense-grass", "structured-ash"] },
        ],
        resources: implementation.describeResources(),
      };
    },
    describeResources() {
      return {
        ...integration.describeResources(),
        tierLock: { id: tier, ...TIER_CONFIG[tier], requestedDpr: viewport.requestedDpr, actualDpr: viewport.actualDpr },
        rendererInfo: rendererInfoSnapshot(),
        shadows: { enabled: renderer.shadowMap.enabled, mapSize: [sun.shadow.mapSize.x, sun.shadow.mapSize.y] },
        renderTargets: ["scenePass.output", "scenePass.normal"],
      };
    },
    getMetrics() {
      return {
        backend: "webgpu",
        isWebGPUBackend: true,
        renderer: { threeRevision: REVISION, isWebGPUBackend: true },
        scenario,
        mode,
        tier,
        camera: cameraId,
        seed,
        elapsed,
        frameCount,
        worldUnitsPerMeter: WORLD_UNITS_PER_METER,
        dpr: { ...viewport, cap: TIER_CONFIG[tier].dprCap },
        rendererInfo: rendererInfoSnapshot(),
        integration: integration.getMetrics(),
      };
    },
    async dispose() {
      if (disposed) return;
      disposed = true;
      integration?.dispose();
      groundGeometry.dispose();
      groundMaterial.dispose();
      captureTarget?.dispose();
      scenePass.dispose?.();
      pipeline.dispose();
      renderer.dispose();
    },
  };

  return createStrictLabController(manifest, implementation);
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
  status.textContent = "native WebGPU host ready";
}).catch((error) => {
  window.__labError = error.stack ?? error.message;
  status.textContent = error.message;
  console.error(error);
});
