import * as THREE from "three/webgpu";
import { color, emissive, float, mrt, normalView, output, pass, renderOutput } from "three/tsl";

import {
  bindWebGPUDeviceIdentity,
  captureRuntimeProfileFields,
  markWebGPUDeviceDisposed,
  markWebGPUDeviceDisposing,
  webgpuDeviceIdentityMetrics,
} from "../../../labs/runtime/webgpu-device-identity.mjs";
import { createBuildingPlan, FIXTURE_SETTINGS } from "./building-plan.js";
import { compileBuilding, disposeCompiledBuilding } from "./compiler.js";
import { compileCityChunk } from "./chunking.js";
import {
  createBuildingNodeMaterials,
  disposeBuildingNodeMaterials,
  loadBuildingTextures,
  validateMaterialBindings,
} from "./materials.js";

export const BUILDING_MODES = Object.freeze([
  "massing-grammar",
  "exposed-edge-analysis",
  "facade-ownership",
  "module-geometry",
  "material-slot-compilation",
  "city-chunks-and-lod",
]);
export const BUILDING_TIERS = Object.freeze(["hero", "city", "distant"]);
export const BUILDING_DPR_CAPS = Object.freeze({ hero: 2, city: 1.5, distant: 1 });
export const BUILDING_CAMERAS = Object.freeze(["near", "design", "far"]);
export const BUILDING_SEEDS = Object.freeze([0x00000001, 0x9e3779b9]);
export const BUILDING_SCENARIOS = Object.freeze([
  "single-tower",
  "compound-footprint",
  "courtyard",
  "twin-towers-bridge",
  "high-ornament",
  "distant-skyline",
]);

const SCENARIO_SETTINGS = Object.freeze({
  "single-tower": { name: "single tower", footprint: "single" },
  "compound-footprint": { name: "compound L", footprint: "L" },
  courtyard: { name: "courtyard / free court", footprint: "courtyard" },
  "twin-towers-bridge": { name: "twin towers with bridge", footprint: "twin-bridge" },
  "high-ornament": { name: "high ornament density", footprint: "single", ornamentDensity: 0.95 },
  "distant-skyline": { name: "distant skyline chunk", footprint: "skyline" },
});

const CAMERA_POSES = Object.freeze({
  near: { position: [28, 31, 38], target: [0, 24, 0] },
  design: { position: [58, 47, 74], target: [0, 23, 0] },
  far: { position: [105, 72, 132], target: [0, 25, 10] },
});
const CITY_CULL_RADII = Object.freeze({ near: 35, design: 70, far: 145 });

function assertKnown(value, list, label) {
  if (!list.includes(value)) throw new RangeError(`Unknown ${label} "${value}"`);
}

export function resolveBuildingDpr(tier, requestedDpr) {
  assertKnown(tier, BUILDING_TIERS, "tier");
  if (!(requestedDpr > 0) || !Number.isFinite(requestedDpr)) {
    throw new RangeError("requested DPR must be finite and positive");
  }
  return Math.min(requestedDpr, BUILDING_DPR_CAPS[tier]);
}

export function expectedSceneBackendDrawItems(compiled, fixedSceneDrawItems = 1) {
  if (!compiled) return null;
  const subjectDrawItems = compiled.getCullingState
    ? compiled.getCullingState().submittedDrawItems
    : compiled.diagnostics?.backendDrawItems;
  return Number.isInteger(subjectDrawItems) ? subjectDrawItems + fixedSceneDrawItems : null;
}

function disposeObject(root) {
  root?.traverse?.((object) => object.geometry?.dispose?.());
  root?.clear?.();
}

function debugMaterial(hex, roughness) {
  const material = new THREE.MeshStandardNodeMaterial();
  material.colorNode = color(hex);
  material.roughnessNode = float(roughness);
  material.metalnessNode = float(0);
  return material;
}

function topologyDebug(plan, mode) {
  const root = new THREE.Group();
  root.name = `${mode}-debug`;
  const materials = {
    podium: debugMaterial(0x92765c, 0.8),
    shaft: debugMaterial(0xb3a58c, 0.78),
    crown: debugMaterial(0xd1be98, 0.72),
    bridge: debugMaterial(0x6e9aa8, 0.3),
    edge: debugMaterial(0x44d7ac, 0.4),
    ownership: debugMaterial(0xe5915a, 0.5),
  };
  for (const tier of plan.tiers) {
    for (const piece of tier.footprintPieces) {
      const geometry = new THREE.BoxGeometry(piece.x1 - piece.x0, tier.height, piece.z1 - piece.z0);
      const mesh = new THREE.Mesh(geometry, materials[tier.role]);
      mesh.position.set((piece.x0 + piece.x1) / 2, tier.y0 + tier.height / 2, (piece.z0 + piece.z1) / 2);
      mesh.name = `${tier.id}:${piece.id}`;
      root.add(mesh);
    }
  }
  if (mode === "exposed-edge-analysis") {
    for (const edge of plan.exposedEdges) {
      const tier = plan.tiers.find((candidate) => candidate.id === edge.tierId);
      const horizontal = edge.side === "front" || edge.side === "back";
      const geometry = new THREE.BoxGeometry(horizontal ? edge.length : 0.12, 0.16, horizontal ? 0.12 : edge.length);
      const mesh = new THREE.Mesh(geometry, materials.edge);
      mesh.position.set(edge.x, tier.y0 + tier.height + 0.2, edge.z);
      root.add(mesh);
    }
  }
  if (mode === "facade-ownership") {
    for (const placement of plan.placements.filter((entry) => entry.side !== "top")) {
      const horizontal = placement.side === "front" || placement.side === "back";
      const geometry = new THREE.BoxGeometry(horizontal ? placement.dimensions.width : 0.08, placement.dimensions.height, horizontal ? 0.08 : placement.dimensions.width);
      const mesh = new THREE.Mesh(geometry, materials.ownership);
      const basisOffset = placement.dimensions.depth + 0.18;
      mesh.position.fromArray(placement.position);
      if (placement.side === "front") mesh.position.z += basisOffset;
      else if (placement.side === "back") mesh.position.z -= basisOffset;
      else if (placement.side === "right") mesh.position.x += basisOffset;
      else mesh.position.x -= basisOffset;
      root.add(mesh);
    }
  }
  root.userData.debugMaterials = Object.values(materials);
  return root;
}

export async function createBuildingLabController({
  canvas,
  width = 1200,
  height = 800,
  dpr = 1,
  mode = "material-slot-compilation",
  tier = "hero",
  seed = BUILDING_SEEDS[0],
  camera = "design",
  scenario = "single-tower",
} = {}) {
  assertKnown(mode, BUILDING_MODES, "mode");
  assertKnown(tier, BUILDING_TIERS, "tier");
  assertKnown(seed, BUILDING_SEEDS, "seed");
  assertKnown(camera, BUILDING_CAMERAS, "camera");
  assertKnown(scenario, BUILDING_SCENARIOS, "scenario");

  const renderer = new THREE.WebGPURenderer({ canvas, antialias: false, outputBufferType: THREE.HalfFloatType, trackTimestamp: true });
  await renderer.init();
  if (renderer.backend.isWebGPUBackend !== true) {
    throw new Error("WebGPU is required for the canonical material-slot compiler lab; no fallback was activated.");
  }
  const deviceIdentity = bindWebGPUDeviceIdentity(renderer);
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x10171d);
  const perspectiveCamera = new THREE.PerspectiveCamera(44, width / height, 0.1, 600);
  const contentRoot = new THREE.Group();
  scene.add(contentRoot);
  const textures = await loadBuildingTextures();
  const materials = createBuildingNodeMaterials({ textures });
  const materialBindings = validateMaterialBindings(materials, { requireDecodedAssets: true });
  if (!materialBindings.ok) {
    disposeBuildingNodeMaterials(materials);
    throw new Error(`Canonical building texture binding failed: ${materialBindings.errors.join(", ")}`);
  }
  const groundMaterial = debugMaterial(0x32383b, 0.9);
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(260, 260), groundMaterial);
  ground.rotation.x = -Math.PI / 2;
  ground.position.y = -0.03;
  scene.add(ground);
  scene.add(new THREE.HemisphereLight(0xdce9ff, 0x1a1714, 1.35));
  const key = new THREE.DirectionalLight(0xfff4df, 4.2);
  key.position.set(40, 90, 55);
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
  let appliedDpr = resolveBuildingDpr(currentTier, requestedDpr);
  let currentSeed = seed;
  let currentCamera = camera;
  let currentScenario = scenario;
  let currentPlan = null;
  let currentCompiled = null;
  let currentContent = null;
  let currentDispose = null;
  let lastRenderMeasurement = null;
  let disposed = false;

  function applyCamera(id) {
    const pose = CAMERA_POSES[id];
    perspectiveCamera.position.fromArray(pose.position);
    perspectiveCamera.lookAt(...pose.target);
    perspectiveCamera.updateMatrixWorld(true);
    currentCompiled?.cullByRadius?.(perspectiveCamera.position.toArray(), CITY_CULL_RADII[id]);
  }

  function applyResolutionPolicy() {
    appliedDpr = resolveBuildingDpr(currentTier, requestedDpr);
    renderer.setPixelRatio(appliedDpr);
    renderer.setSize(width, height, false);
    captureTarget.setSize(renderer.domElement.width, renderer.domElement.height);
    scenePass.setSize(width, height);
    perspectiveCamera.aspect = width / height;
    perspectiveCamera.updateProjectionMatrix();
  }

  function clearContent() {
    if (currentContent) contentRoot.remove(currentContent);
    currentDispose?.();
    currentContent = null;
    currentDispose = null;
    currentCompiled = null;
  }

  function settings() {
    return {
      ...SCENARIO_SETTINGS[currentScenario],
      qualityTier: currentTier,
      seed: currentSeed,
    };
  }

  function rebuild() {
    clearContent();
    if (currentMode === "city-chunks-and-lod") {
      const chunk = compileCityChunk({
        materials,
        qualityTier: currentTier,
        fixtureNames: ["single tower", "compound L", "glass-heavy facade", "twin towers with bridge"],
        preferBatchedMesh: currentTier === "hero",
      });
      currentContent = chunk.root;
      currentCompiled = chunk;
      currentDispose = () => chunk.dispose();
      currentPlan = null;
    } else {
      currentPlan = createBuildingPlan(settings());
      if (["massing-grammar", "exposed-edge-analysis", "facade-ownership"].includes(currentMode)) {
        const debug = topologyDebug(currentPlan, currentMode);
        currentContent = debug;
        currentDispose = () => {
          disposeObject(debug);
          debug.userData.debugMaterials.forEach((material) => material.dispose());
        };
      } else {
        const compiled = compileBuilding(currentPlan, materials, {
          qualityTier: currentTier,
          preferBatchedMesh: currentMode === "module-geometry",
        });
        currentCompiled = compiled;
        currentContent = compiled.root;
        currentDispose = () => disposeCompiledBuilding(compiled);
      }
    }
    contentRoot.add(currentContent);
    contentRoot.updateMatrixWorld(true);
    if (currentCompiled?.cullByRadius) {
      currentCompiled.cullByRadius(perspectiveCamera.position.toArray(), CITY_CULL_RADII[currentCamera]);
    }
  }

  rebuild();
  applyCamera(currentCamera);

  const controller = {
    async ready() {},
    async setScenario(id) {
      assertKnown(id, BUILDING_SCENARIOS, "scenario");
      currentScenario = id;
      rebuild();
      await renderer.compileAsync(scene, perspectiveCamera);
    },
    async setMode(id) {
      assertKnown(id, BUILDING_MODES, "mode");
      currentMode = id;
      rebuild();
      await renderer.compileAsync(scene, perspectiveCamera);
    },
    async setTier(id) {
      assertKnown(id, BUILDING_TIERS, "tier");
      currentTier = id;
      applyResolutionPolicy();
      rebuild();
      await renderer.compileAsync(scene, perspectiveCamera);
    },
    async setSeed(value) {
      assertKnown(value, BUILDING_SEEDS, "seed");
      currentSeed = value;
      rebuild();
      await renderer.compileAsync(scene, perspectiveCamera);
    },
    async setCamera(id) {
      assertKnown(id, BUILDING_CAMERAS, "camera");
      currentCamera = id;
      applyCamera(id);
    },
    async setTime(seconds) {
      if (!Number.isFinite(seconds) || seconds < 0) throw new RangeError("time must be finite and nonnegative");
    },
    async step(deltaSeconds) {
      if (!Number.isFinite(deltaSeconds) || deltaSeconds < 0) throw new RangeError("deltaSeconds must be finite and nonnegative");
    },
    async resetHistory() {},
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
      renderPipeline.render();
      lastRenderMeasurement = {
        drawCalls: renderer.info.render.drawCalls,
        triangles: renderer.info.render.triangles,
        frameCalls: renderer.info.render.frameCalls,
        timestamp: renderer.info.render.timestamp || null,
        source: "renderer.info after current native-WebGPU RenderPipeline submission",
      };
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
      const pixels = await renderer.readRenderTargetPixelsAsync(scenePass.renderTarget, 0, 0, targetWidth, targetHeight, textureIndex, 0);
      const rowBytes = targetWidth * pixels.BYTES_PER_ELEMENT * 4;
      const bytesPerRow = Math.ceil(rowBytes / 256) * 256;
      if (!Number.isInteger(bytesPerRow) || bytesPerRow < rowBytes) throw new Error("invalid aligned WebGPU readback stride");
      return { target, width: targetWidth, height: targetHeight, pixels, rowBytes, bytesPerRow };
    },
    describePipeline() {
      return {
        ...captureRuntimeProfileFields(),
        owners: {
          renderer: "webgpu-material-slot-compiler-standalone",
          renderPipeline: "webgpu-material-slot-compiler-standalone",
          output: "webgpu-material-slot-compiler-standalone",
          toneMap: "renderOutput",
          outputColorTransform: "renderOutput",
        },
        signals: ["output", "normal", "emissive", "depth"],
        sceneSubmissions: [{ id: "building-scene", kind: "lit-scene", count: 1 }],
        computeDispatches: [],
        resources: this.describeResources().resources,
        finalToneMapOwner: "renderOutput",
        finalOutputTransformOwner: "renderOutput",
      };
    },
    describeResources() {
      if (currentCompiled?.resourceDescription) return currentCompiled.resourceDescription;
      if (currentCompiled?.buildings) {
        return {
          schemaVersion: 1,
          representation: "city chunks",
          resources: currentCompiled.buildings.map((building) => ({
            id: building.name,
            kind: "city-chunk-building",
            triangles: Object.values(building.diagnostics.triangles).reduce((sum, value) => sum + value, 0),
            backendDrawItems: building.diagnostics.backendDrawItems,
          })),
        };
      }
      return {
        schemaVersion: 1,
        representation: "diagnostic geometry",
        resources: [{ id: currentMode, kind: "diagnostic", objects: currentContent?.children.length ?? 0 }],
      };
    },
    getMetrics() {
      const expectedSceneDraws = expectedSceneBackendDrawItems(currentCompiled, 1); // ground
      const info = renderer.info ?? {};
      return {
        labId: "webgpu-material-slot-compiler",
        ...webgpuDeviceIdentityMetrics(deviceIdentity, renderer),
        threeRevision: "185",
        threePackageVersion: "0.185.1",
        mode: currentMode,
        tier: currentTier,
        seed: currentSeed,
        camera: currentCamera,
        scenario: currentScenario,
        timeSeconds: 0,
        viewport: { width, height, dpr: appliedDpr },
        backendIsWebGPU: renderer.backend?.isWebGPUBackend === true,
        isWebGPUBackend: renderer.backend?.isWebGPUBackend === true,
        resolutionPolicy: {
          width,
          height,
          requestedDpr,
          appliedDpr,
          dprCap: BUILDING_DPR_CAPS[currentTier],
        },
        plan: currentPlan?.diagnostics ?? null,
        measuredSubmission: lastRenderMeasurement ? { ...lastRenderMeasurement } : null,
        submissionReconciliation: expectedSceneDraws === null || !lastRenderMeasurement
          ? {
            verdict: "NOT_CLAIMED",
            expectedSceneBackendDrawItems: expectedSceneDraws,
            measuredRendererDrawCalls: lastRenderMeasurement?.drawCalls ?? null,
          }
          : {
            verdict: lastRenderMeasurement.drawCalls === expectedSceneDraws ? "PASS" : "FAIL",
            expectedSceneBackendDrawItems: expectedSceneDraws,
            measuredRendererDrawCalls: lastRenderMeasurement.drawCalls,
          },
        culling: currentCompiled?.getCullingState?.() ?? null,
        rendererInfo: {
          ...webgpuDeviceIdentityMetrics(deviceIdentity, renderer).rendererInfo,
          memory: { ...(info.memory ?? {}) },
          render: { ...(info.render ?? {}) },
          compute: { ...(info.compute ?? {}) },
        },
        gpuTiming: { verdict: "INSUFFICIENT_EVIDENCE", value: null, unit: "ms", label: "Measured", source: "timestamp readback not yet captured" },
      };
    },
    async dispose() {
      if (disposed) return;
      disposed = true;
      markWebGPUDeviceDisposing(deviceIdentity);
      clearContent();
      ground.geometry.dispose();
      groundMaterial.dispose();
      captureTarget.dispose();
      disposeBuildingNodeMaterials(materials);
      scenePass.dispose();
      renderPipeline.dispose();
      renderer.dispose();
      markWebGPUDeviceDisposed(deviceIdentity);
    },
  };

  await controller.resize(width, height, dpr);
  await renderer.compileAsync(scene, perspectiveCamera);
  await scenePass.compileAsync(renderer);
  return controller;
}
