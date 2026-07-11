import {
  Color,
  DirectionalLight,
  HalfFloatType,
  HemisphereLight,
  NeutralToneMapping,
  NoColorSpace,
  PerspectiveCamera,
  RGBAFormat,
  RenderPipeline,
  Scene,
  UnsignedByteType,
  WebGPURenderer,
} from "three/webgpu";
import {
  renderOutput,
  rtt,
  screenUV,
  uniform,
  vec3,
  vec4,
} from "three/tsl";

import {
  AO_TIERS,
  createGTAOStage,
} from "../../threejs-ambient-contact-shading/examples/webgpu-node-gtao/main.js";
import {
  configureShadowRenderer,
  createShadowArchitectureOwner,
} from "../../threejs-scalable-real-time-shadows/examples/webgpu-cached-clipmap-shadow/shadow-architectures.js";
import {
  createSharedWeatherStage,
} from "../../threejs-rain-snow-and-wet-surfaces/examples/webgpu-rain-snow-and-wet-surfaces/precipitation-system.js";
import {
  DISTRICT_CAMERAS,
  DISTRICT_MECHANISM_MODES,
  DISTRICT_MODES,
  DISTRICT_SCENARIOS,
  DISTRICT_SEEDS,
  assertDistrictRouteLock,
  createDistrictRuntimeGraph,
  createDistrictValidationSnapshot,
  normalizeDistrictRouteLocks,
  requireDistrictCamera,
  requireDistrictMode,
  requireDistrictMechanism,
  requireDistrictScenario,
  requireDistrictSeed,
  requireDistrictTier,
  validateDistrictSnapshot,
} from "./district-contract.js";
import { createDistrictMaterials } from "./district-materials.js";
import { createDistrictCauseFieldStage } from "./shared-cause-field.js";
import { createDistrictStaticGeometry } from "./terrain-geometry.js";

const CAPTURE_TARGETS = Object.freeze([
  "final",
  "display",
  "lit-output",
  "no-post-output",
  "normal",
  "velocity",
  "raw-ao",
  "denoised-ao",
]);

function textureIndex(renderTarget, name) {
  const index = renderTarget.textures.findIndex((entry) => entry.name === name);
  if (index < 0) throw new Error(`Render target does not contain texture ${name}.`);
  return index;
}

export function inferDistrictPaddedLayout(byteLength, width, height) {
  for (const bytesPerTexel of [1, 2, 4, 8, 16]) {
    const rowBytes = width * bytesPerTexel;
    const bytesPerRow = Math.ceil(rowBytes / 256) * 256;
    const expected = height === 1 ? rowBytes : (height - 1) * bytesPerRow + rowBytes;
    if (expected === byteLength) return { bytesPerTexel, rowBytes, bytesPerRow };
  }
  throw new Error(`Cannot infer an integer WebGPU row stride for ${width}x${height} and ${byteLength} bytes.`);
}

async function captureRenderTarget(renderer, renderTarget, selectedTexture = 0, metadata = {}) {
  if (!renderTarget) throw new Error("Capture target has not been rendered yet.");
  const width = renderTarget.width;
  const height = renderTarget.height;
  const pixels = await renderer.readRenderTargetPixelsAsync(
    renderTarget,
    0,
    0,
    width,
    height,
    selectedTexture,
  );
  const source = new Uint8Array(pixels.buffer, pixels.byteOffset, pixels.byteLength);
  const layout = inferDistrictPaddedLayout(source.byteLength, width, height);
  const packed = new Uint8Array(layout.rowBytes * height);
  for (let y = 0; y < height; y += 1) {
    packed.set(
      source.subarray(y * layout.bytesPerRow, y * layout.bytesPerRow + layout.rowBytes),
      y * layout.rowBytes,
    );
  }
  return {
    ...metadata,
    width,
    height,
    bytesPerTexel: layout.bytesPerTexel,
    bytesPerRow: layout.bytesPerRow,
    packedRowBytes: layout.rowBytes,
    componentType: pixels.constructor.name,
    data: packed,
  };
}

function createWeatherStage() {
  return createSharedWeatherStage({
    time: 0,
    deltaTime: 0,
    elapsedDeltaTime: 0,
    progress: 0.18,
    forcing: 0.18,
    precipitationRate: 0.72,
    wetness: 0.2,
    puddleFill: 0.06,
    snowCoverage: 0,
    temperatureC: 8,
    wind: { x: 1.4, y: 0, z: 0.55 },
  });
}

function forcingAtTime(seconds) {
  return Math.min(1, Math.max(0, 0.52 + Math.sin(seconds * 0.31) * 0.34));
}

function createShadowConfig(tier) {
  return {
    mapSizes: [tier.shadowMapSize],
    firstRadius: 125,
    shadowNear: 0.5,
    shadowFarCap: 340,
    levelCount: 1,
    lightMargin: 45,
  };
}

function createCamera(width, height) {
  const camera = new PerspectiveCamera(46, width / height, 0.1, 520);
  camera.position.set(112, 88, 132);
  camera.lookAt(0, 19, 0);
  camera.updateMatrixWorld();
  return camera;
}

function createSceneLighting(scene) {
  const hemisphere = new HemisphereLight(0xb9d5df, 0x2c2b27, 1.15);
  const sun = new DirectionalLight(0xfff1d3, 3.2);
  sun.position.set(92, 148, 72);
  sun.target.position.set(0, 8, 0);
  scene.add(hemisphere, sun, sun.target);
  return { hemisphere, sun };
}

function resourceTotal(records) {
  return records.reduce((sum, entry) => sum + (entry.bytes ?? entry.residentBytes?.value ?? 0), 0);
}

export async function createProceduralDistrictLab({
  canvas,
  width = 1200,
  height = 800,
  dpr = 1,
  scenario: initialScenario = "district",
  mode: initialMode = "final",
  tier: initialTier = "balanced",
  seed: initialSeed = 0x00000001,
  camera: initialCamera = "district",
  time: initialTime = 0,
  mechanism: initialMechanism = null,
  routeLocks: initialRouteLocks = {},
} = {}) {
  requireDistrictScenario(initialScenario);
  requireDistrictMode(initialMode);
  requireDistrictTier(initialTier);
  requireDistrictSeed(initialSeed);
  requireDistrictCamera(initialCamera);
  if (initialMechanism !== null) {
    requireDistrictMechanism(initialMechanism);
    if (DISTRICT_MECHANISM_MODES[initialMechanism] !== initialMode) {
      throw new Error(`District mechanism ${initialMechanism} requires mode ${DISTRICT_MECHANISM_MODES[initialMechanism]}.`);
    }
  }
  if (!Number.isFinite(initialTime) || initialTime < 0) throw new RangeError("District initial time must be finite and nonnegative.");
  const routeLocks = normalizeDistrictRouteLocks(initialRouteLocks);
  assertDistrictRouteLock(routeLocks, "scenario", initialScenario);
  assertDistrictRouteLock(routeLocks, "mode", initialMode);
  assertDistrictRouteLock(routeLocks, "tier", initialTier);
  if (initialMechanism !== null) assertDistrictRouteLock(routeLocks, "mechanism", initialMechanism);

  const renderer = new WebGPURenderer({
    canvas,
    antialias: false,
    reversedDepthBuffer: false,
    outputBufferType: HalfFloatType,
    trackTimestamp: true,
  });
  renderer.toneMapping = NeutralToneMapping;
  renderer.toneMappingExposure = 1;
  await renderer.init();
  if (renderer.backend.isWebGPUBackend !== true) {
    throw new Error("Procedural District requires a native WebGPU backend; no fallback is activated.");
  }
  if (renderer.reversedDepthBuffer === true) {
    throw new Error("Procedural District uses the r185 standard-depth GTAO contract.");
  }
  configureShadowRenderer(renderer);

  const scene = new Scene();
  scene.name = "procedural-district";
  scene.background = new Color(0x8faab4);
  const sceneCamera = createCamera(width, height);
  const lighting = createSceneLighting(scene);
  const weatherStage = createWeatherStage();
  const renderPipeline = new RenderPipeline(renderer);
  renderPipeline.outputColorTransform = false;
  const diagnosticKeepAlive = uniform(0);

  let scenario = "district";
  let mode = "final";
  let mechanism = initialMechanism;
  let tierId = initialTier;
  let tier = requireDistrictTier(tierId);
  let seed = requireDistrictSeed(initialSeed);
  let cameraId = "district";
  let timeSeconds = 0;
  let requestedDpr = dpr;
  let appliedDpr = Math.min(dpr, tier.dprCap);
  let fieldStage;
  let materialStage;
  let staticWorld;
  let shadowOwner;
  let aoStage;
  let displayTarget;
  let geometryBuildCount = 0;
  let lastHistoryReset = "initialization";
  let disposed = false;
  let readyResolved = false;

  renderer.setPixelRatio(appliedDpr);
  renderer.setSize(width, height, false);

  function installShadowOwner() {
    shadowOwner?.dispose();
    shadowOwner = createShadowArchitectureOwner({
      light: lighting.sun,
      architecture: "bounded",
      config: createShadowConfig(tier),
    });
    lighting.sun.shadow.bias = -0.00022;
    lighting.sun.shadow.normalBias = 0.075;
    lighting.sun.shadow.radius = 1.4;
    lighting.sun.shadow.needsUpdate = true;
  }

  async function installStaticWorld() {
    fieldStage = await createDistrictCauseFieldStage({ renderer, tier, seed });
    materialStage = createDistrictMaterials({ causeField: fieldStage, weatherStage });
    staticWorld = createDistrictStaticGeometry({ tier, seed, causeField: fieldStage, materials: materialStage });
    geometryBuildCount += 1;
    staticWorld.setDiagnosticVisibility(mode);
    materialStage.setMode(mode);
    materialStage.updateWeatherUniforms();
    scene.add(staticWorld.root);
  }

  await installStaticWorld();
  installShadowOwner();
  aoStage = createGTAOStage({ scene, camera: sceneCamera, tier: AO_TIERS[tier.aoTier] });
  aoStage.setTemporalEnabled(false);

  function outputNodeForMode(nextMode) {
    if (nextMode === "no-post") return aoStage.gbufferPass.getTextureNode("output");
    if (nextMode === "ao") {
      const visibility = aoStage.reconstructedAO.sample(screenUV).r;
      return vec4(
        vec3(visibility).add(aoStage.materialContextOutput.rgb.mul(diagnosticKeepAlive)),
        1,
      );
    }
    return aoStage.materialContextOutput;
  }

  function rebuildOutput() {
    const previous = displayTarget;
    displayTarget = rtt(renderOutput(outputNodeForMode(mode)), null, null, {
      colorSpace: NoColorSpace,
      depthBuffer: false,
      format: RGBAFormat,
      type: UnsignedByteType,
    });
    displayTarget.setResolutionScale(tier.sceneScale);
    renderPipeline.outputNode = displayTarget;
    renderPipeline.needsUpdate = true;
    previous?.renderTarget?.dispose?.();
    previous?.dispose?.();
  }

  function updateModeState() {
    materialStage.setMode(mode);
    staticWorld.setDiagnosticVisibility(mode);
    lighting.hemisphere.intensity = mode === "shadow-contribution" ? 0 : 1.15;
    lighting.sun.intensity = mode === "shadow-contribution" ? 3.8 : 3.2;
    lighting.sun.shadow.needsUpdate = true;
    rebuildOutput();
  }

  async function rebuildWorld() {
    scene.remove(staticWorld.root);
    staticWorld.dispose();
    materialStage.dispose();
    fieldStage.dispose();
    installShadowOwner();
    await installStaticWorld();
    aoStage.setTier(AO_TIERS[tier.aoTier]);
    appliedDpr = Math.min(requestedDpr, tier.dprCap);
    renderer.setPixelRatio(appliedDpr);
    renderer.setSize(width, height, false);
    sceneCamera.aspect = width / height;
    sceneCamera.updateProjectionMatrix();
    updateModeState();
  }

  async function ready() {
    if (disposed) throw new Error("District lab is disposed.");
    readyResolved = true;
  }

  async function setScenario(id) {
    requireDistrictScenario(id);
    assertDistrictRouteLock(routeLocks, "scenario", id);
    scenario = id;
  }

  async function setMode(id) {
    requireDistrictMode(id);
    assertDistrictRouteLock(routeLocks, "mode", id);
    mode = id;
    if (routeLocks.mechanism === undefined) mechanism = null;
    updateModeState();
  }

  async function setTier(id) {
    const nextTier = requireDistrictTier(id);
    assertDistrictRouteLock(routeLocks, "tier", id);
    if (id === tierId) return;
    tierId = id;
    tier = nextTier;
    await rebuildWorld();
  }

  async function setSeed(nextSeed) {
    const resolved = requireDistrictSeed(nextSeed);
    if (resolved === seed) return;
    seed = resolved;
    await rebuildWorld();
  }

  async function setCamera(id) {
    requireDistrictCamera(id);
    cameraId = id;
    if (id === "street") {
      sceneCamera.position.set(64, 10, 86);
      sceneCamera.lookAt(8, 15, 0);
    } else if (id === "district") {
      sceneCamera.position.set(112, 88, 132);
      sceneCamera.lookAt(0, 19, 0);
    } else {
      sceneCamera.position.set(2, 188, 8);
      sceneCamera.lookAt(0, 0, 0);
    }
    sceneCamera.updateMatrixWorld();
    await resetHistory("camera-change");
  }

  function assertGeometryUnchanged(before, cause) {
    const after = { buildCount: geometryBuildCount, digest: staticWorld.digest };
    if (before.buildCount !== after.buildCount || before.digest !== after.digest) {
      throw new Error(`STATIC_GEOMETRY_REGENERATED during ${cause}`);
    }
    return { before, after };
  }

  async function setTime(seconds) {
    if (!Number.isFinite(seconds) || seconds < 0) throw new RangeError("District time must be finite and nonnegative.");
    const before = { buildCount: geometryBuildCount, digest: staticWorld.digest };
    weatherStage.reset({
      time: 0,
      deltaTime: 0,
      elapsedDeltaTime: 0,
      progress: 0.18,
      forcing: 0.18,
      precipitationRate: 0.72,
      wetness: 0.2,
      puddleFill: 0.06,
      snowCoverage: 0,
      temperatureC: 8,
      wind: { x: 1.4, y: 0, z: 0.55 },
    });
    weatherStage.update({
      deltaTime: seconds,
      targetForcing: forcingAtTime(seconds),
      temperatureC: 8,
      precipitationRate: 0.72,
    });
    timeSeconds = seconds;
    materialStage.updateWeatherUniforms();
    assertGeometryUnchanged(before, "setTime");
  }

  async function step(deltaSeconds) {
    if (!Number.isFinite(deltaSeconds) || deltaSeconds < 0) throw new RangeError("District deltaSeconds must be finite and nonnegative.");
    const before = { buildCount: geometryBuildCount, digest: staticWorld.digest };
    const nextTime = timeSeconds + deltaSeconds;
    weatherStage.update({
      deltaTime: deltaSeconds,
      targetForcing: forcingAtTime(nextTime),
      temperatureC: 8,
      precipitationRate: 0.72,
    });
    timeSeconds = nextTime;
    materialStage.updateWeatherUniforms();
    assertGeometryUnchanged(before, "weather step");
  }

  async function resetHistory(cause = "manual") {
    if (typeof cause !== "string" || cause.length === 0) throw new TypeError("History reset cause must be a nonempty string.");
    lastHistoryReset = cause;
    renderPipeline.needsUpdate = true;
  }

  async function resize(nextWidth, nextHeight, nextDpr = 1) {
    if (!Number.isInteger(nextWidth) || !Number.isInteger(nextHeight) || nextWidth < 1 || nextHeight < 1) {
      throw new RangeError("District resize dimensions must be positive integers.");
    }
    if (!Number.isFinite(nextDpr) || nextDpr <= 0) throw new RangeError("District DPR must be finite and positive.");
    width = nextWidth;
    height = nextHeight;
    requestedDpr = nextDpr;
    appliedDpr = Math.min(requestedDpr, tier.dprCap);
    renderer.setPixelRatio(appliedDpr);
    renderer.setSize(width, height, false);
    sceneCamera.aspect = width / height;
    sceneCamera.updateProjectionMatrix();
    rebuildOutput();
    await resetHistory("resize");
  }

  async function renderOnce() {
    if (disposed) throw new Error("District lab is disposed.");
    renderPipeline.render();
  }

  async function capturePixels(target = "display") {
    if (!CAPTURE_TARGETS.includes(target)) throw new RangeError(`Unknown district capture target: ${target}`);
    await renderOnce();
    if (target === "display" || target === "final") {
      return captureRenderTarget(renderer, displayTarget.renderTarget, 0, {
        target,
        format: "rgba8unorm",
        colorManaged: true,
        outputColorSpace: "srgb",
      });
    }
    if (target === "lit-output") {
      return captureRenderTarget(
        renderer,
        aoStage.litScenePass.renderTarget,
        textureIndex(aoStage.litScenePass.renderTarget, "output"),
      );
    }
    if (target === "no-post-output") {
      return captureRenderTarget(
        renderer,
        aoStage.gbufferPass.renderTarget,
        textureIndex(aoStage.gbufferPass.renderTarget, "output"),
      );
    }
    if (target === "normal") {
      return captureRenderTarget(
        renderer,
        aoStage.gbufferPass.renderTarget,
        textureIndex(aoStage.gbufferPass.renderTarget, "normal"),
      );
    }
    if (target === "velocity") {
      return captureRenderTarget(
        renderer,
        aoStage.gbufferPass.renderTarget,
        textureIndex(aoStage.gbufferPass.renderTarget, "velocity"),
      );
    }
    if (target === "raw-ao") return captureRenderTarget(renderer, aoStage.gtaoNode._aoRenderTarget, 0);
    return captureRenderTarget(renderer, aoStage.reconstructedAO.renderTarget, 0);
  }

  function buildResourceRecords() {
    const physicalWidth = Math.floor(width * appliedDpr);
    const physicalHeight = Math.floor(height * appliedDpr);
    const aoTier = AO_TIERS[tier.aoTier];
    const aoWidth = Math.round(physicalWidth * aoTier.resolutionScale);
    const aoHeight = Math.round(physicalHeight * aoTier.resolutionScale);
    return [
      ...fieldStage.describeResources(),
      ...staticWorld.resourceRecords,
      {
        id: "district-bounded-shadow",
        owner: "threejs-scalable-real-time-shadows",
        kind: "color-plus-depth-shadow-target-logical-lower-bound",
        bytes: tier.shadowMapSize * tier.shadowMapSize * 8,
        source: `${tier.shadowMapSize}^2*(4 B color + 4 B depth) logical lower bound`,
      },
      {
        id: "district-gbuffer-output",
        owner: "threejs-image-pipeline",
        kind: "rgba16float-render-target",
        bytes: physicalWidth * physicalHeight * 8,
        source: "physicalWidth*physicalHeight*8 B rgba16float logical payload",
      },
      {
        id: "district-gbuffer-normal",
        owner: "threejs-image-pipeline",
        kind: "rgba16float-render-target",
        bytes: physicalWidth * physicalHeight * 8,
        source: "physicalWidth*physicalHeight*8 B rgba16float logical payload",
      },
      {
        id: "district-gbuffer-velocity",
        owner: "threejs-image-pipeline",
        kind: "rgba16float-render-target",
        bytes: physicalWidth * physicalHeight * 8,
        source: "r185 named PassNode attachment clones HDR output format",
      },
      {
        id: "district-raw-gtao",
        owner: "threejs-ambient-contact-shading",
        kind: "r8unorm-render-target",
        bytes: aoWidth * aoHeight,
        source: "AO scaled width*height*1 B scalar visibility",
      },
      {
        id: "district-reconstructed-gtao",
        owner: "threejs-ambient-contact-shading",
        kind: "r8unorm-render-target",
        bytes: physicalWidth * physicalHeight,
        source: "full physical width*height*1 B reconstructed visibility",
      },
      {
        id: "district-display-readback",
        owner: "threejs-image-pipeline",
        kind: "rgba8unorm-render-target",
        bytes: Math.floor(physicalWidth * tier.sceneScale) * Math.floor(physicalHeight * tier.sceneScale) * 4,
        source: "scaled display readback extent*4 B rgba8unorm",
      },
    ];
  }

  function describePipeline() {
    return createDistrictRuntimeGraph({
      mode,
      tier: tierId,
      resources: buildResourceRecords(),
      fieldDispatches: fieldStage.dispatchRecords,
    });
  }

  function describeResources() {
    const resources = buildResourceRecords();
    return {
      schemaVersion: 2,
      physicalSize: [Math.floor(width * appliedDpr), Math.floor(height * appliedDpr)],
      tier: tierId,
      resources,
      logicalResidentBytes: {
        value: resourceTotal(resources),
        unit: "bytes",
        label: "Derived",
        source: "sum of exact typed-array payloads and declared logical texture payloads; excludes allocator padding",
      },
      storageResources: fieldStage.describeResources().map((entry) => entry.id),
      residentResourceEvidence: "Derived logical payload; physical GPU allocation remains INSUFFICIENT_EVIDENCE",
    };
  }

  function validationSnapshot() {
    const snapshot = createDistrictValidationSnapshot({
      facadeOwnershipKeys: staticWorld.facadeOwnershipKeys,
      fieldIdentity: fieldStage.id,
      fieldCoordinateClaims: fieldStage.describeCoordinateClaims(),
      geometryBuildCount,
      geometryDigest: staticWorld.digest,
    });
    snapshot.materialOwnerClaims = materialStage.describe().materialOwnerClaims;
    return snapshot;
  }

  function getMetrics() {
    const snapshot = validationSnapshot();
    const invariantValidation = validateDistrictSnapshot(snapshot);
    const runtimeGraph = describePipeline();
    const reachableFullScene = runtimeGraph.sceneSubmissions.filter(
      (entry) => entry.reachable !== false && ["prepass", "lit-scene"].includes(entry.kind),
    );
    return {
      schemaVersion: 2,
      backend: renderer.backend.isWebGPUBackend === true ? "webgpu" : "unsupported",
      threeRevision: String(renderer.constructor.REVISION ?? "185"),
      scenario,
      mechanism,
      mode,
      tier: tierId,
      seed,
      camera: cameraId,
      timeSeconds,
      requestedDpr,
      appliedDpr,
      geometryBuildCount,
      geometryDigest: staticWorld.digest,
      causeFieldId: fieldStage.id,
      fieldDispatchCount: fieldStage.dispatchRecords.length,
      facadeOwnershipCount: staticWorld.facadeOwnershipKeys.length,
      buildingCount: staticWorld.buildings.length,
      sceneSubmissionCount: reachableFullScene.length,
      shadowViewCount: shadowOwner.describe().shadowViewCount,
      lastHistoryReset,
      readyResolved,
      invariantValidation,
      materialState: materialStage.describe(),
      weatherState: { ...weatherStage.weather },
      rendererInfo: renderer.info,
      claimVerdicts: {
        nativeWebGPU: "PASS",
        fullCanonicalMaterialHost: "NOT_CLAIMED",
        minimalMaterialAdapterContract: "PASS",
        renderTargetReadback: "INSUFFICIENT_EVIDENCE",
        currentAdapterTiming: "INSUFFICIENT_EVIDENCE",
        lifecycleStability: "INSUFFICIENT_EVIDENCE",
      },
      routeSelection: {
        kind: mechanism ? "mechanism" : routeLocks.tier ? "tier" : routeLocks.scenario ? "scenario" : null,
        id: mechanism ?? routeLocks.tier ?? routeLocks.scenario ?? null,
        scenario,
        mechanism,
        mode,
        tier: tierId,
      },
    };
  }

  async function dispose() {
    if (disposed) return;
    disposed = true;
    displayTarget?.renderTarget?.dispose?.();
    displayTarget?.dispose?.();
    renderPipeline.dispose();
    aoStage.dispose();
    shadowOwner.dispose();
    scene.remove(staticWorld.root);
    staticWorld.dispose();
    materialStage.dispose();
    fieldStage.dispose();
    renderer.dispose();
  }

  await setScenario(initialScenario);
  await setCamera(initialCamera);
  await setTime(initialTime);
  mode = initialMode;
  updateModeState();
  await ready();

  return {
    ready,
    setScenario,
    setMode,
    setTier,
    setSeed,
    setCamera,
    setTime,
    step,
    resetHistory,
    resize,
    renderOnce,
    capturePixels,
    describePipeline,
    describeResources,
    getMetrics,
    dispose,
    renderer,
    renderPipeline,
    scene,
    camera: sceneCamera,
    get fieldStage() { return fieldStage; },
    get materialStage() { return materialStage; },
    get staticWorld() { return staticWorld; },
    get aoStage() { return aoStage; },
    get shadowOwner() { return shadowOwner; },
    constants: {
      scenarios: DISTRICT_SCENARIOS,
      modes: DISTRICT_MODES,
      cameras: DISTRICT_CAMERAS,
      seeds: DISTRICT_SEEDS,
      routeLocks,
    },
  };
}
