import {
  AmbientLight,
  BoxGeometry,
  Color,
  DirectionalLight,
  Group,
  HalfFloatType,
  InstancedMesh,
  Matrix4,
  Mesh,
  MeshStandardNodeMaterial,
  NeutralToneMapping,
  NoColorSpace,
  PerspectiveCamera,
  PlaneGeometry,
  RGBAFormat,
  REVISION,
  RenderPipeline,
  RenderTarget,
  Scene,
  ShadowNodeMaterial,
  Sphere,
  SRGBColorSpace,
  Timer,
  UnsignedByteType,
  Vector3,
  WebGPURenderer,
} from "three/webgpu";
import {
  color,
  emissive,
  float,
  materialAO,
  mix,
  mrt,
  normalView,
  output,
  pass,
  renderOutput,
  rtt,
  screenUV,
  step,
  uniform,
  vec3,
  vec4,
  velocity,
} from "three/tsl";
import { bloom } from "three/addons/tsl/display/BloomNode.js";

import { createCameraRigCore } from "../../threejs-camera-controls-and-rigs/examples/webgpu-camera-rig/main.mjs";
import { createProceduralMotionCore } from "../../threejs-procedural-motion-systems/examples/webgpu-procedural-timelines/main.js";
import {
  advanceDeltaPolicy,
  copyMotionState,
  getPresentationAlpha,
  interpolateMotionState,
  resetMotionState,
  stepTimelineState,
} from "../../threejs-procedural-motion-systems/examples/webgpu-procedural-timelines/timeline.js";
import {
  AO_TIERS,
  createGTAOStage,
} from "../../threejs-ambient-contact-shading/examples/webgpu-node-gtao/main.js";
import {
  createImagePipelineAOHostAdapter,
} from "../../threejs-ambient-contact-shading/examples/integration-image-pipeline-ao/host-adapter.js";
import {
  BLOOM_CONTROLS,
} from "../../threejs-bloom/examples/node-selective-bloom/index.js";
import {
  createExposureColorStage,
} from "../../threejs-exposure-color-grading/examples/webgpu-exposure-color-pipeline/stage.js";
import {
  configureShadowRenderer,
  createShadowArchitectureOwner,
} from "../../threejs-scalable-real-time-shadows/examples/webgpu-cached-clipmap-shadow/shadow-architectures.js";
import {
  unpackAlignedReadback,
} from "../../threejs-visual-validation/examples/webgpu-validation-harness/src/readback.js";
import {
  createFinalImageFlightGraph,
} from "./owner-graph.mjs";
import {
  createSustainedP95Governor,
} from "./quality-governor.mjs";
import {
  FINAL_IMAGE_FLIGHT_CAMERAS,
  FINAL_IMAGE_FLIGHT_MODES,
  FINAL_IMAGE_FLIGHT_SCENARIOS,
  FINAL_IMAGE_FLIGHT_SEEDS,
  FINAL_IMAGE_FLIGHT_TIERS,
  assertFinalImageFlightRouteLock,
  parseFinalImageFlightRoute,
} from "./routes.mjs";

const LAB_ID = "final-image-flight";

export const FINAL_IMAGE_FLIGHT_TIER_CONFIG = Object.freeze({
  hero: Object.freeze({ dprCap: 2, sceneScale: 1, aoTier: AO_TIERS.ultra, bloomScale: 0.5, exposureTier: "full-histogram", shadowMapSize: 1024, effectInstances: 256 }),
  balanced: Object.freeze({ dprCap: 1.5, sceneScale: 1, aoTier: AO_TIERS.high, bloomScale: 0.33, exposureTier: "balanced-log-reduction", shadowMapSize: 512, effectInstances: 128 }),
  budgeted: Object.freeze({ dprCap: 1, sceneScale: 0.85, aoTier: AO_TIERS.medium, bloomScale: 0.25, exposureTier: "minimum-fixed-shot", shadowMapSize: 256, effectInstances: 64 }),
});

/** Host-safe Bloom stage: consumes the host MRT emissive signal and creates no scene pass. */
export function createSharedEmissiveBloomStage({ emissiveNode, controls = BLOOM_CONTROLS, resolutionScale }) {
  if (emissiveNode?.isNode !== true) throw new TypeError("shared-emissive Bloom requires an MRT texture node");
  if (!Number.isFinite(resolutionScale) || resolutionScale <= 0 || resolutionScale > 1) {
    throw new RangeError("Bloom resolutionScale must be finite and in (0, 1]");
  }
  const bloomPass = bloom(emissiveNode, controls.strength, controls.radius, controls.threshold);
  bloomPass.smoothWidth.value = controls.smoothWidth;
  bloomPass.setResolutionScale(resolutionScale);
  let activeResolutionScale = resolutionScale;
  return {
    outputNode: bloomPass.getTextureNode(),
    node: bloomPass,
    describe() {
      return {
        owner: "threejs-bloom",
        inputProducer: "final-image-flight:image-pipeline-host/scene.emissive",
        sceneSubmissionCount: 0,
        resolutionScale: activeResolutionScale,
        controls: { ...controls },
      };
    },
    setResolutionScale(nextScale) {
      if (!Number.isFinite(nextScale) || nextScale <= 0 || nextScale > 1) {
        throw new RangeError("Bloom resolutionScale must be finite and in (0, 1]");
      }
      activeResolutionScale = nextScale;
      bloomPass.setResolutionScale(nextScale);
    },
    dispose() { bloomPass.dispose(); },
  };
}

function requireKnown(value, allowed, label) {
  if (!allowed.includes(value)) throw new RangeError(`unknown Final Image Flight ${label}: ${value}`);
  return value;
}

function numeric(value, unit, label, source) {
  return { value, unit, label, source };
}

function createNodeMaterial(baseColor, { roughness = 0.6, metalness = 0, emissiveColor = 0x000000, emissiveIntensity = 0 } = {}) {
  const material = new MeshStandardNodeMaterial();
  material.colorNode = color(baseColor);
  material.roughnessNode = float(roughness);
  material.metalnessNode = float(metalness);
  material.emissiveNode = color(emissiveColor).mul(float(emissiveIntensity));
  material.aoNode = materialAO;
  return material;
}

function disposeMaterial(material) {
  if (Array.isArray(material)) for (const entry of material) entry.dispose();
  else material?.dispose?.();
}

/**
 * Creates the host-owned flagship. Imported stages receive the host renderer,
 * scene, camera, or signals; none is allowed to construct a second renderer.
 */
export async function createFinalImageFlightLab({
  canvas,
  documentRef = globalThis.document,
  locationRef = globalThis.location,
  startAnimationLoop = true,
} = {}) {
  if (!canvas) throw new TypeError("Final Image Flight requires a canvas");
  const route = parseFinalImageFlightRoute(locationRef);
  let tierConfig = FINAL_IMAGE_FLIGHT_TIER_CONFIG[route.tier];
  const renderer = new WebGPURenderer({
    canvas,
    antialias: false,
    outputBufferType: HalfFloatType,
    trackTimestamp: true,
  });
  renderer.outputColorSpace = SRGBColorSpace;
  renderer.toneMapping = NeutralToneMapping;
  renderer.toneMappingExposure = 1;
  await renderer.init();
  if (renderer.backend?.isWebGPUBackend !== true) {
    renderer.dispose();
    throw new Error("Final Image Flight requires the native WebGPU backend; no fallback is activated");
  }
  configureShadowRenderer(renderer);

  const scene = new Scene();
  scene.background = new Color(0x060912);
  const camera = new PerspectiveCamera(52, 1, 0.12, 200);
  const renderPipeline = new RenderPipeline(renderer);
  renderPipeline.outputColorTransform = false;

  const ambient = new AmbientLight(0x7894d2, 0.38);
  const key = new DirectionalLight(0xfff3dc, 5.2);
  key.position.set(7, 11, 8);
  key.target.position.set(0, 0.8, 0);
  scene.add(ambient, key, key.target);

  const shipRoot = new Group();
  shipRoot.name = "flight-subject";
  const bodyGeometry = new BoxGeometry(1.4, 0.65, 4.4);
  const bodyMaterial = createNodeMaterial(0x7996c8, { roughness: 0.3, metalness: 0.58, emissiveColor: 0xff6a22, emissiveIntensity: 2.8 });
  const body = new Mesh(bodyGeometry, bodyMaterial);
  body.castShadow = true;
  body.receiveShadow = true;
  shipRoot.add(body);
  const wingGeometry = new BoxGeometry(5.2, 0.12, 1.35);
  const wingMaterial = createNodeMaterial(0x293a5d, { roughness: 0.42, metalness: 0.34 });
  const wings = new Mesh(wingGeometry, wingMaterial);
  wings.position.z = 0.25;
  wings.castShadow = true;
  wings.receiveShadow = true;
  shipRoot.add(wings);
  scene.add(shipRoot);

  const groundGeometry = new PlaneGeometry(34, 34);
  const groundMaterial = createNodeMaterial(0x172135, { roughness: 0.83, metalness: 0.02 });
  const ground = new Mesh(groundGeometry, groundMaterial);
  ground.rotation.x = -Math.PI / 2;
  ground.position.y = -2.2;
  ground.receiveShadow = true;
  scene.add(ground);
  const obstacleGeometry = new BoxGeometry(1.4, 4.5, 1.4);
  const obstacleMaterial = createNodeMaterial(0x32466e, { roughness: 0.68 });
  for (const x of [-4.2, 4.2]) {
    const obstacle = new Mesh(obstacleGeometry, obstacleMaterial);
    obstacle.position.set(x, 0.05, -1.8);
    obstacle.castShadow = true;
    obstacle.receiveShadow = true;
    scene.add(obstacle);
  }

  const effectInstanceCapacity = Math.max(...Object.values(FINAL_IMAGE_FLIGHT_TIER_CONFIG).map((config) => config.effectInstances));
  const motionCore = createProceduralMotionCore({
    seed: FINAL_IMAGE_FLIGHT_SEEDS[0],
    scenario: "spin-docking",
    instanceCount: effectInstanceCapacity,
  });
  const effectGeometry = new BoxGeometry(0.035, 0.035, 0.14);
  const effectMaterial = createNodeMaterial(0x6dcfff, { roughness: 0.34, emissiveColor: 0x35a7ff, emissiveIntensity: 5.5 });
  effectMaterial.positionNode = motionCore.motionPlan.createInterpolatedPositionNode();
  effectMaterial.mrtNode = mrt({ velocity: motionCore.motionPlan.createVelocityNdcNode() });
  const effectMesh = new InstancedMesh(effectGeometry, effectMaterial, effectInstanceCapacity);
  const identity = new Matrix4();
  for (let i = 0; i < effectInstanceCapacity; i += 1) effectMesh.setMatrixAt(i, identity);
  effectMesh.instanceMatrix.needsUpdate = true;
  effectMesh.count = tierConfig.effectInstances;
  effectMesh.castShadow = true;
  scene.add(effectMesh);

  const cameraCore = createCameraRigCore({
    camera,
    subject: shipRoot,
    subjectBounds: new Sphere(new Vector3(), 2.8),
    tier: route.tier === "budgeted" ? "minimum" : route.tier === "hero" ? "full" : "budgeted",
  });
  cameraCore.controller.mode = "overview";
  cameraCore.controller.computeOverviewPose(camera.position, camera.quaternion);
  camera.updateMatrixWorld(true);

  const shadowConfig = {
    mapSizes: [tierConfig.shadowMapSize],
    firstRadius: 14,
    shadowNear: 0.1,
    shadowFarCap: 60,
    bytesPerColorTexel: 4,
    bytesPerDepthTexel: 4,
  };
  const shadowOwner = createShadowArchitectureOwner({
    light: key,
    architecture: "bounded",
    config: shadowConfig,
  });
  // Two scene PassNodes share one committed shadow map. Refresh once before
  // the prepass; the subsequent material-context lit pass reuses it.
  key.shadow.autoUpdate = false;
  key.shadow.needsUpdate = true;

  const aoStage = createGTAOStage({ scene, camera, tier: tierConfig.aoTier });
  aoStage.setTemporalEnabled(false);
  aoStage.gbufferPass.setResolutionScale(tierConfig.sceneScale);
  aoStage.litScenePass.setResolutionScale(tierConfig.sceneScale);
  aoStage.gbufferPass.setMRT(mrt({ output, normal: normalView, emissive, velocity }));
  const imageAoHost = createImagePipelineAOHostAdapter({ renderPipeline, scene, camera });
  imageAoHost.attachAOStage(aoStage);

  const sceneOutput = aoStage.gbufferPass.getTextureNode("output");
  const sceneNormal = aoStage.gbufferPass.getTextureNode("normal");
  const sceneEmissive = aoStage.gbufferPass.getTextureNode("emissive");
  const sceneVelocity = aoStage.gbufferPass.getTextureNode("velocity");
  const litHdr = aoStage.materialContextOutput;
  const bloomStage = createSharedEmissiveBloomStage({
    emissiveNode: sceneEmissive,
    controls: BLOOM_CONTROLS,
    resolutionScale: tierConfig.bloomScale,
  });
  const bloomPass = bloomStage.node;
  const bloomOutput = bloomStage.outputNode;
  const combinedHdr = vec4(litHdr.rgb.add(bloomOutput.rgb), litHdr.a);
  const preGradeHdr = rtt(combinedHdr, null, null, {
    colorSpace: NoColorSpace,
    depthBuffer: false,
    format: RGBAFormat,
    type: HalfFloatType,
  });
  preGradeHdr.renderTarget.texture.name = "final-image-flight:scene.pre-grade-hdr";
  const exposureMeterSource = preGradeHdr;
  const exposureHdrSource = preGradeHdr;
  let exposureStage = createExposureColorStage({
    renderer,
    meterSourceTextureNode: exposureMeterSource,
    hdrColorNode: exposureHdrSource,
    tierId: tierConfig.exposureTier,
    toneMappingVariant: "Neutral",
  });

  const shadowMaskMaterial = new ShadowNodeMaterial({ color: 0xffffff, opacity: 1 });
  const shadowMaskPass = pass(scene, camera, { samples: 0 });
  shadowMaskPass.name = "final-image-flight:actual-shadow-contribution";
  shadowMaskPass.overrideMaterial = shadowMaskMaterial;
  const shadowMaskNode = shadowMaskPass.getTextureNode("output");

  const diagnosticKeepAlive = uniform(0);
  const keepIntegrated = (node) => mix(node, litHdr, diagnosticKeepAlive);
  const rawAoView = vec4(vec3(aoStage.rawAO.sample(screenUV).r), 1);
  const velocityView = vec4(sceneVelocity.sample(screenUV).xy.mul(0.5).add(0.5), 0, 1);
  const shadowContributionView = vec4(shadowMaskNode.sample(screenUV).rgb, 1);
  const normalViewDiagnostic = vec4(sceneNormal.sample(screenUV).xyz.mul(0.5).add(0.5), 1);
  const emissiveView = vec4(sceneEmissive.sample(screenUV).rgb, 1);
  const bloomView = vec4(bloomOutput.rgb, 1);
  const preGradeView = vec4(preGradeHdr.sample(screenUV).rgb, 1);
  const ownerGraphView = mix(
    mix(
      mix(sceneOutput.sample(screenUV), normalViewDiagnostic, step(0.2, screenUV.x)),
      velocityView,
      step(0.4, screenUV.x),
    ),
    mix(
      mix(rawAoView, emissiveView, step(0.8, screenUV.x)),
      bloomView.add(preGradeView.mul(0.08)),
      step(0.9, screenUV.x),
    ),
    step(0.6, screenUV.x),
  );
  let modeNodes;
  function rebuildModeNodes() {
    modeNodes = {
      final: exposureStage.outputNode,
      "no-post": renderOutput(keepIntegrated(sceneOutput)),
      velocity: renderOutput(keepIntegrated(velocityView)),
      ao: renderOutput(keepIntegrated(rawAoView)),
      emissive: renderOutput(keepIntegrated(emissiveView)),
      bloom: renderOutput(keepIntegrated(bloomView)),
      exposure: renderOutput(keepIntegrated(exposureStage.outputGraph.exposedStraightHdr)),
      "shadow-contribution": renderOutput(keepIntegrated(shadowContributionView)),
      "owner-graph": renderOutput(keepIntegrated(ownerGraphView)),
    };
  }
  rebuildModeNodes();
  renderPipeline.outputNode = modeNodes[route.mode];
  renderPipeline.outputColorTransform = false;
  renderPipeline.needsUpdate = true;

  let width = Math.max(1, Math.round(canvas.clientWidth || canvas.width || 1200));
  let height = Math.max(1, Math.round(canvas.clientHeight || canvas.height || 800));
  let requestedDpr = globalThis.devicePixelRatio || 1;
  let dpr = Math.min(requestedDpr, tierConfig.dprCap);
  renderer.setPixelRatio(dpr);
  renderer.setSize(width, height, false);
  camera.aspect = width / height;
  camera.updateProjectionMatrix();
  let captureTarget = new RenderTarget(Math.max(1, Math.round(width * dpr)), Math.max(1, Math.round(height * dpr)), {
    type: UnsignedByteType,
    depthBuffer: false,
  });
  captureTarget.texture.colorSpace = SRGBColorSpace;
  captureTarget.texture.name = "final-image-flight-capture-rgba8";

  const timer = new Timer();
  if (documentRef) timer.connect(documentRef);
  const debugElement = documentRef?.querySelector?.("[data-flight-debug]") ?? null;
  const resetEvents = [];
  const tierTransitionEvents = [];
  const cpuFrameSamples = [];
  let scenario = "flight";
  let mode = route.mode;
  let tier = route.tier;
  let cameraId = "design";
  let seed = FINAL_IMAGE_FLIGHT_SEEDS[0];
  let timeSeconds = 0;
  let nextFrameId = 0;
  let lastRenderedFrameId = -1;
  let lastGovernorSampleFrameId = -1;
  let pendingTimestampFrameCount = 0;
  let disposed = false;

  const qualityGovernor = createSustainedP95Governor({
    initialTier: tier,
    tierLocked: route.tierLocked,
    onTransition: async (nextTier, context) => {
      await applyTierConfiguration(nextTier, {
        source: "quality-governor",
        context,
      });
    },
  });

  const fixedStepMotion = (fixedStep, simulationTime) => {
    copyMotionState(motionCore.stateSlots.previous, motionCore.stateSlots.current);
    stepTimelineState(motionCore.stateSlots.current, fixedStep, simulationTime + fixedStep);
    motionCore.motionPlan.dispatchFixedStep(renderer, fixedStep, simulationTime + fixedStep);
  };

  function requireLive() {
    if (disposed) throw new Error("Final Image Flight is disposed");
  }

  function cameraTierFor(nextTier) {
    return nextTier === "hero" ? "full" : nextTier === "budgeted" ? "minimum" : "budgeted";
  }

  function resizeDrawingBuffer() {
    dpr = Math.min(requestedDpr, tierConfig.dprCap);
    renderer.setPixelRatio(dpr);
    renderer.setSize(width, height, false);
    camera.aspect = width / height;
    camera.updateProjectionMatrix();
    captureTarget.setSize(Math.max(1, Math.round(width * dpr)), Math.max(1, Math.round(height * dpr)));
  }

  function resetHistoryInternal(cause) {
    if (typeof cause !== "string" || cause.length === 0) throw new TypeError("history reset cause is required");
    resetEvents.push({ cause, timeSeconds, frameId: lastRenderedFrameId });
    motionCore.motionPlan.primeFrameMatrices(camera, effectMesh);
    renderPipeline.needsUpdate = true;
  }

  async function applyTierConfiguration(nextTier, { source, context = null } = {}) {
    requireKnown(nextTier, FINAL_IMAGE_FLIGHT_TIERS, "tier");
    if (nextTier === tier) return false;
    const previousTier = tier;
    const previousExposure = exposureStage;
    tier = nextTier;
    tierConfig = FINAL_IMAGE_FLIGHT_TIER_CONFIG[nextTier];
    aoStage.setTier(tierConfig.aoTier);
    aoStage.gbufferPass.setResolutionScale(tierConfig.sceneScale);
    aoStage.litScenePass.setResolutionScale(tierConfig.sceneScale);
    bloomStage.setResolutionScale(tierConfig.bloomScale);
    cameraCore.controller.setTier(cameraTierFor(nextTier));
    effectMesh.count = tierConfig.effectInstances;
    shadowConfig.mapSizes[0] = tierConfig.shadowMapSize;
    key.shadow.mapSize.set(tierConfig.shadowMapSize, tierConfig.shadowMapSize);
    key.shadow.map?.setSize?.(tierConfig.shadowMapSize, tierConfig.shadowMapSize);
    key.shadow.needsUpdate = true;
    resizeDrawingBuffer();
    exposureStage = createExposureColorStage({
      renderer,
      meterSourceTextureNode: exposureMeterSource,
      hdrColorNode: exposureHdrSource,
      tierId: tierConfig.exposureTier,
      toneMappingVariant: "Neutral",
    });
    rebuildModeNodes();
    renderPipeline.outputNode = modeNodes[mode];
    renderPipeline.outputColorTransform = false;
    renderPipeline.needsUpdate = true;
    previousExposure.dispose();
    resetHistoryInternal(`tier-change:${previousTier}->${nextTier}:${source ?? "unknown"}`);
    tierTransitionEvents.push({
      from: previousTier,
      to: nextTier,
      source: source ?? "unknown",
      frameId: lastRenderedFrameId,
      context,
      applied: {
        dprCap: tierConfig.dprCap,
        sceneScale: tierConfig.sceneScale,
        aoTier: tierConfig.aoTier.id,
        bloomScale: tierConfig.bloomScale,
        exposureTier: tierConfig.exposureTier,
        shadowMapSize: tierConfig.shadowMapSize,
        effectInstances: effectMesh.count,
      },
    });
    if (source !== "quality-governor") qualityGovernor.synchronizeTier(nextTier, { reason: source ?? "external-tier-selection" });
    return true;
  }

  function applyCamera(id) {
    const controller = cameraCore.controller;
    if (id === "near") controller.computeProfilePose(camera.position, camera.quaternion);
    else if (id === "far") {
      controller.computeOverviewPose(camera.position, camera.quaternion);
      camera.position.sub(shipRoot.position).multiplyScalar(1.65).add(shipRoot.position);
    } else controller.computeOverviewPose(camera.position, camera.quaternion);
    camera.updateMatrixWorld(true);
  }

  function updateSimulation(deltaSeconds) {
    motionCore.motionPlan.beginFrameMatrices();
    advanceDeltaPolicy(motionCore.policy, deltaSeconds, fixedStepMotion);
    if (deltaSeconds === 0) stepTimelineState(motionCore.stateSlots.current, 0, timeSeconds);
    const alpha = getPresentationAlpha(motionCore.policy);
    interpolateMotionState(motionCore.stateSlots.render, motionCore.stateSlots.previous, motionCore.stateSlots.current, alpha);
    motionCore.motionPlan.setPresentationAlpha(alpha);
    shipRoot.position.copy(motionCore.stateSlots.render.position);
    shipRoot.quaternion.copy(motionCore.stateSlots.render.quaternion);
    cameraCore.controller.update(deltaSeconds);
    motionCore.motionPlan.captureFrameMatrices(camera, effectMesh);
    return alpha;
  }

  function applyMode(nextMode) {
    mode = nextMode;
    renderPipeline.outputNode = modeNodes[nextMode];
    renderPipeline.outputColorTransform = false;
    renderPipeline.needsUpdate = true;
  }

  async function renderTo(target, deltaSeconds = 0) {
    requireLive();
    exposureStage.beforeRender(deltaSeconds);
    key.shadow.needsUpdate = true;
    const frameId = nextFrameId;
    nextFrameId += 1;
    const previousTarget = renderer.getRenderTarget();
    renderer.setRenderTarget(target);
    const start = performance.now();
    let rendered = false;
    try {
      renderPipeline.render();
      rendered = true;
    } finally {
      renderer.setRenderTarget(previousTarget);
    }
    if (rendered) {
      shadowOwner.recordFrame(frameId);
      lastRenderedFrameId = frameId;
      pendingTimestampFrameCount += 1;
    }
    cpuFrameSamples.push(performance.now() - start);
    if (mode === "final" || mode === "exposure" || mode === "owner-graph") exposureStage.meterAfterRender();
  }

  function describePipeline() {
    const physicalWidth = Math.max(1, Math.round(width * dpr));
    const physicalHeight = Math.max(1, Math.round(height * dpr));
    return createFinalImageFlightGraph({
      width: physicalWidth,
      height: physicalHeight,
      sceneScale: tierConfig.sceneScale,
      tier,
      aoScale: tierConfig.aoTier.resolutionScale,
      bloomScale: tierConfig.bloomScale,
      exposureDescription: exposureStage.describe(),
      shadowDescription: shadowOwner.describe(),
      motionStorageBytes: motionCore.motionPlan.storageBytes,
      activeEffectInstances: effectMesh.count,
      effectInstanceCapacity,
      activeMode: mode,
      qualityGovernor: qualityGovernor.describe(),
      preGradeHdrSharedIdentity: exposureMeterSource === exposureHdrSource,
      tierConfiguration: {
        dprCap: numeric(tierConfig.dprCap, "device-pixels-per-css-pixel", "Authored", `${tier} tier`),
        sceneScale: numeric(tierConfig.sceneScale, "ratio", "Authored", `${tier} tier`),
        aoTier: tierConfig.aoTier.id,
        bloomScale: numeric(tierConfig.bloomScale, "ratio", "Authored", `${tier} tier`),
        exposureTier: tierConfig.exposureTier,
        shadowMapSize: numeric(tierConfig.shadowMapSize, "texels-per-axis", "Authored", `${tier} tier`),
        effectInstances: numeric(tierConfig.effectInstances, "instances", "Authored", `${tier} tier`),
      },
    });
  }

  function updateDebug(alpha = getPresentationAlpha(motionCore.policy)) {
    if (!debugElement) return;
    const graph = describePipeline();
    debugElement.textContent = JSON.stringify({
      status: "native-WebGPU runtime; acceptance incomplete pending capture",
      scenario,
      mode,
      tier,
      camera: cameraId,
      seed: `0x${seed.toString(16).padStart(8, "0")}`,
      timeSeconds,
      interpolationAlpha: alpha,
      backend: renderer.backend?.isWebGPUBackend === true ? "WebGPU" : "unsupported",
      sceneSubmissionCount: graph.submissionCounts.sceneSubmissionCount.value,
      owners: graph.ownerClaims,
      signals: graph.signals,
      performanceVerdict: "INSUFFICIENT_EVIDENCE",
    }, null, 2);
  }

  const labController = {
    get labId() { return LAB_ID; },
    async ready() {
      applyCamera(cameraId);
      await this.renderOnce();
    },
    async setScenario(id) {
      requireKnown(id, FINAL_IMAGE_FLIGHT_SCENARIOS, "scenario");
      assertFinalImageFlightRouteLock(route, { scenario: id });
      scenario = id;
    },
    async setMode(id) {
      requireKnown(id, FINAL_IMAGE_FLIGHT_MODES, "mode");
      assertFinalImageFlightRouteLock(route, { mode: id });
      applyMode(id);
    },
    async setTier(id) {
      requireKnown(id, FINAL_IMAGE_FLIGHT_TIERS, "tier");
      assertFinalImageFlightRouteLock(route, { tier: id });
      await applyTierConfiguration(id, { source: "controller" });
    },
    async setSeed(nextSeed) {
      requireKnown(nextSeed, FINAL_IMAGE_FLIGHT_SEEDS, "seed");
      seed = nextSeed >>> 0;
      for (const state of Object.values(motionCore.stateSlots)) state.seed = seed;
      motionCore.motionPlan.resetState({ nextSeed: seed, time: 0 });
      motionCore.motionPlan.seek(renderer, motionCore.policy.simulationTime);
      await this.resetHistory("seed-change");
    },
    async setCamera(id) {
      requireKnown(id, FINAL_IMAGE_FLIGHT_CAMERAS, "camera");
      cameraId = id;
      applyCamera(id);
      await this.resetHistory("camera-change");
    },
    async setTime(seconds) {
      if (!Number.isFinite(seconds) || seconds < 0) throw new RangeError("time must be finite and nonnegative");
      timeSeconds = seconds;
      for (const state of Object.values(motionCore.stateSlots)) {
        resetMotionState(state);
        stepTimelineState(state, 0, seconds);
      }
      motionCore.policy.simulationTime = seconds;
      motionCore.policy.presentationTime = seconds;
      motionCore.policy.accumulator = 0;
      motionCore.motionPlan.resetState({ nextSeed: seed, time: 0 });
      motionCore.motionPlan.seek(renderer, seconds);
      updateSimulation(0);
      await this.resetHistory("time-seek");
    },
    async step(deltaSeconds) {
      if (!Number.isFinite(deltaSeconds) || deltaSeconds < 0) throw new RangeError("deltaSeconds must be finite and nonnegative");
      timeSeconds += deltaSeconds;
      const alpha = updateSimulation(deltaSeconds);
      await renderTo(null, deltaSeconds);
      updateDebug(alpha);
    },
    async resetHistory(cause) {
      resetHistoryInternal(cause);
    },
    async resize(nextWidth, nextHeight, nextDpr) {
      if (!Number.isInteger(nextWidth) || !Number.isInteger(nextHeight) || nextWidth <= 0 || nextHeight <= 0) throw new RangeError("resize dimensions must be positive integers");
      if (!Number.isFinite(nextDpr) || nextDpr <= 0) throw new RangeError("DPR must be finite and positive");
      width = nextWidth;
      height = nextHeight;
      requestedDpr = nextDpr;
      resizeDrawingBuffer();
      await this.resetHistory("resize");
    },
    async renderOnce() {
      await renderTo(null, 0);
      updateDebug();
    },
    async capturePixels(target = mode) {
      requireKnown(target, FINAL_IMAGE_FLIGHT_MODES, "capture target");
      const previousMode = mode;
      try {
        if (target !== mode) applyMode(target);
        await renderTo(captureTarget, 0);
        const padded = await renderer.readRenderTargetPixelsAsync(captureTarget, 0, 0, captureTarget.width, captureTarget.height);
        const unpacked = unpackAlignedReadback(padded, captureTarget.width, captureTarget.height, 4);
        return {
          target,
          width: captureTarget.width,
          height: captureTarget.height,
          format: "rgba8unorm",
          bytesPerPixel: 4,
          bytesPerRow: unpacked.layout.rowBytes,
          sourceBytesPerRow: unpacked.layout.bytesPerRow,
          colorManaged: true,
          outputColorSpace: renderer.outputColorSpace,
          pixels: unpacked.pixels,
          readbackLayout: unpacked.layout,
          sourceByteLength: unpacked.sourceByteLength,
        };
      } finally {
        if (previousMode !== mode) applyMode(previousMode);
      }
    },
    describePipeline,
    describeResources() {
      const graph = describePipeline();
      return {
        renderTargets: graph.resources,
        preGradeHdr: {
          id: "pre-grade-hdr",
          owner: "final-image-flight:image-pipeline-host",
          width: preGradeHdr.renderTarget.width,
          height: preGradeHdr.renderTarget.height,
          format: preGradeHdr.renderTarget.texture.format,
          type: preGradeHdr.renderTarget.texture.type,
          colorSpace: preGradeHdr.renderTarget.texture.colorSpace,
          bytes: numeric(preGradeHdr.renderTarget.width * preGradeHdr.renderTarget.height * 8, "bytes", "Derived", "runtime RGBA16F target dimensions"),
          meterAndHdrNodeIdentityShared: exposureMeterSource === exposureHdrSource,
        },
        shadowDiagnostic: {
          id: "shadow-diagnostic-target",
          reachable: mode === "shadow-contribution",
          width: shadowMaskPass.renderTarget.width,
          height: shadowMaskPass.renderTarget.height,
          format: shadowMaskPass.renderTarget.texture.format,
          type: shadowMaskPass.renderTarget.texture.type,
        },
        shadow: shadowOwner.describe(),
        exposure: exposureStage.describe(),
        motionStorageBytes: numeric(motionCore.motionPlan.storageBytes, "bytes", "Derived", "allocated storage attribute byteLength sum"),
        captureTarget: {
          width: captureTarget.width,
          height: captureTarget.height,
          bytes: numeric(captureTarget.width * captureTarget.height * 4, "bytes", "Derived", "RGBA8 capture payload"),
        },
      };
    },
    getMetrics() {
      return {
        labId: this.labId,
        threeRevision: REVISION,
        backend: renderer.backend?.isWebGPUBackend === true ? "WebGPU" : "unsupported",
        scenario,
        mode,
        tier,
        camera: cameraId,
        seed,
        timeSeconds,
        frameId: lastRenderedFrameId,
        mechanism: route.mechanism,
        routeSelection: {
          scenario,
          mechanism: route.mechanism,
          tier,
          mode,
          camera: cameraId,
          seed,
          time: timeSeconds,
        },
        routeLocks: {
          scenario: route.scenarioLocked,
          mechanism: route.mechanismLocked,
          tier: route.tierLocked,
          mode: route.modeLocked,
          sources: route.lockSources,
        },
        cpuFrameSamples: [...cpuFrameSamples],
        resetEvents: [...resetEvents],
        tierTransitionEvents: structuredClone(tierTransitionEvents),
        qualityGovernor: qualityGovernor.describe(),
        shadowFrame: shadowOwner.describe().frameMetrics,
        gpuTimingVerdict: qualityGovernor.describe().verdict,
        motionGpuSeekParity: "INSUFFICIENT_EVIDENCE",
      };
    },
    async resolveGpuTimings() {
      if (lastRenderedFrameId < 0) {
        qualityGovernor.recordUnavailable({ frameId: 0, reason: "no rendered frame exists for timestamp attribution" });
        return { verdict: "INSUFFICIENT_EVIDENCE", renderMs: null, computeMs: null, reason: "no rendered frame" };
      }
      if (lastGovernorSampleFrameId === lastRenderedFrameId) {
        qualityGovernor.recordUnavailable({ frameId: lastRenderedFrameId, reason: "duplicate timestamp resolution for one rendered frame" });
        return { verdict: "INSUFFICIENT_EVIDENCE", renderMs: null, computeMs: null, reason: "duplicate frame timestamp resolution" };
      }
      lastGovernorSampleFrameId = lastRenderedFrameId;
      const timestampFrameCount = pendingTimestampFrameCount;
      pendingTimestampFrameCount = 0;
      let renderMs;
      let computeMs;
      try {
        renderMs = await renderer.resolveTimestampsAsync("render");
        computeMs = await renderer.resolveTimestampsAsync("compute");
      } catch (error) {
        qualityGovernor.recordUnavailable({ frameId: lastRenderedFrameId, reason: error.message });
        return { verdict: "INSUFFICIENT_EVIDENCE", renderMs: null, computeMs: null, reason: error.message };
      }
      if (!Number.isFinite(renderMs) || !Number.isFinite(computeMs)) {
        const reason = "both render and compute timestamps are required";
        qualityGovernor.recordUnavailable({ frameId: lastRenderedFrameId, reason });
        return { verdict: "INSUFFICIENT_EVIDENCE", renderMs: null, computeMs: null, reason };
      }
      if (timestampFrameCount !== 1) {
        const reason = `timestamp query covered ${timestampFrameCount} rendered frames; exactly one is required for a p95 sample`;
        qualityGovernor.recordUnavailable({ frameId: lastRenderedFrameId, reason });
        return { verdict: "INSUFFICIENT_EVIDENCE", renderMs, computeMs, reason };
      }
      const governorResult = await qualityGovernor.recordTimestampSample({
        frameId: lastRenderedFrameId,
        renderMs,
        computeMs,
      });
      return {
        verdict: "MEASURED_NOT_ACCEPTED",
        renderMs,
        computeMs,
        composedFrameMs: renderMs + computeMs,
        governor: governorResult,
      };
    },
    async dispose() {
      if (disposed) return;
      disposed = true;
      renderer.setAnimationLoop(null);
      timer.dispose?.();
      shadowOwner.dispose();
      exposureStage.dispose();
      bloomStage.dispose();
      aoStage.dispose();
      shadowMaskPass.dispose?.();
      shadowMaskMaterial.dispose();
      preGradeHdr.renderTarget?.dispose?.();
      cameraCore.dispose();
      motionCore.motionPlan.dispose();
      const geometries = new Set();
      const materials = new Set();
      scene.traverse((object) => {
        if (object.geometry) geometries.add(object.geometry);
        if (Array.isArray(object.material)) for (const material of object.material) materials.add(material);
        else if (object.material) materials.add(object.material);
      });
      for (const geometry of geometries) geometry.dispose?.();
      for (const material of materials) disposeMaterial(material);
      captureTarget.dispose();
      renderPipeline.dispose();
      renderer.dispose();
      captureTarget = null;
    },
  };

  applyMode(mode);
  updateSimulation(0);
  applyCamera(cameraId);
  motionCore.motionPlan.primeFrameMatrices(camera, effectMesh);
  if (startAnimationLoop) {
    let frameInFlight = false;
    renderer.setAnimationLoop((timestamp) => {
      timer.update(timestamp);
      const delta = Math.min(timer.getDelta(), 1 / 20);
      if (frameInFlight) return;
      frameInFlight = true;
      labController.step(delta).catch((error) => {
        renderer.setAnimationLoop(null);
        if (debugElement) debugElement.textContent = `BLOCKED: ${error.message}`;
        globalThis.reportError?.(error);
      }).finally(() => { frameInFlight = false; });
    });
  }
  return {
    renderer,
    renderPipeline,
    scene,
    camera,
    cameraCore,
    motionCore,
    aoStage,
    bloomPass,
    bloomStage,
    get exposureStage() { return exposureStage; },
    shadowOwner,
    signals: Object.freeze({
      output: sceneOutput,
      depth: aoStage.sceneDepth,
      normal: sceneNormal,
      emissive: sceneEmissive,
      velocity: sceneVelocity,
      litHdr,
      bloomHdr: bloomOutput,
      preGradeHdr,
      shadowContribution: shadowMaskNode,
    }),
    route,
    labController,
  };
}
