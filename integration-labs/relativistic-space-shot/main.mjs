import {
  AmbientLight,
  BlendMode,
  Color,
  DirectionalLight,
  HalfFloatType,
  MaterialBlending,
  NeutralToneMapping,
  NoToneMapping,
  PerspectiveCamera,
  REVISION,
  RenderPipeline,
  RenderTarget,
  Scene,
  SRGBColorSpace,
  Timer,
  UnsignedByteType,
  WebGPURenderer,
} from "three/webgpu";
import {
  emissive,
  dot,
  length,
  mrt,
  output,
  pass,
  renderOutput,
  vec3,
  vec4,
  velocity,
} from "three/tsl";

import { createSpaceIntegratorStage } from "../../threejs-black-holes-and-space-effects/examples/tsl-curved-ray/space-transfer-stage.js";
import { CURVED_RAY_QUALITY_TIERS } from "../../threejs-black-holes-and-space-effects/examples/tsl-curved-ray/curved-ray-accretion.js";
import { createPooledEffectsStage } from "../../threejs-particles-trails-and-effects/examples/webgpu-pooled-effects/lab.mjs";
import { createImagePipelineStage } from "../../threejs-image-pipeline/examples/webgpu-image-pipeline/stage.js";
import { unpackAlignedReadback } from "../../threejs-visual-validation/examples/webgpu-validation-harness/src/readback.js";
import {
  createRelativisticCameraStage,
  createRelativisticMotionStage,
  createSharedEmissiveBloomStage,
} from "./host-stages.mjs";
import {
  createRelativisticSpaceShotGraph,
  validateRelativisticSpaceShotGraph,
} from "./owner-graph.mjs";
import { createRelativisticQualityGovernor } from "./quality-governor.mjs";
import {
  RELATIVISTIC_CAMERAS,
  RELATIVISTIC_MODES,
  RELATIVISTIC_SCENARIOS,
  RELATIVISTIC_SEEDS,
  RELATIVISTIC_TIERS,
  assertRelativisticRouteLock,
  parseRelativisticRoute,
} from "./routes.mjs";

const LAB_ID = "relativistic-space-shot";

export const RELATIVISTIC_TIER_CONFIG = Object.freeze({
  hero: Object.freeze({ dprCap: 2, sceneScale: 1, rayScale: 1, spaceQuality: "hero", maxSteps: 160, particleTier: "ultra", sparkPoolCapacity: 65536, debrisPoolCapacity: 8192, bloomScale: 0.5, exposureTier: "full-histogram", sparkCount: 4096, debrisCount: 512 }),
  balanced: Object.freeze({ dprCap: 1.5, sceneScale: 1, rayScale: 1, spaceQuality: "standard", maxSteps: 96, particleTier: "high", sparkPoolCapacity: 24576, debrisPoolCapacity: 3072, bloomScale: 0.33, exposureTier: "balanced-log-reduction", sparkCount: 2048, debrisCount: 256 }),
  budgeted: Object.freeze({ dprCap: 1, sceneScale: 1, rayScale: 1, spaceQuality: "background", maxSteps: 48, particleTier: "medium", sparkPoolCapacity: 8192, debrisPoolCapacity: 1024, bloomScale: 0.25, exposureTier: "minimum-fixed-shot", sparkCount: 1024, debrisCount: 128 }),
});

function exact(value, values, label) {
  if (!values.includes(value)) throw new RangeError(`unknown Relativistic Space Shot ${label}: ${value}`);
  return value;
}

function numeric(value, unit, label, source) {
  return { value, unit, label, source };
}

/**
 * Sole native-WebGPU host for curved-ray transport, pooled GPU effects, one
 * shared MRT, one temporal history, one bloom input, and one exposure/output
 * graph. Imported stages never construct a renderer or final pipeline.
 */
export async function createRelativisticSpaceShotLab({
  canvas,
  documentRef = globalThis.document,
  locationRef = globalThis.location,
  startAnimationLoop = true,
} = {}) {
  if (!canvas) throw new TypeError("Relativistic Space Shot requires a canvas");
  const route = parseRelativisticRoute(locationRef);
  const tierConfig = RELATIVISTIC_TIER_CONFIG[route.tier];

  const renderer = new WebGPURenderer({
    canvas,
    antialias: false,
    outputBufferType: HalfFloatType,
    trackTimestamp: true,
  });
  renderer.outputColorSpace = SRGBColorSpace;
  renderer.toneMapping = NoToneMapping;
  renderer.toneMappingExposure = 1;
  await renderer.init();
  if (renderer.backend?.isWebGPUBackend !== true) {
    renderer.dispose();
    throw new Error("Relativistic Space Shot requires native WebGPU; no fallback is activated");
  }

  const scene = new Scene();
  scene.background = new Color(0x010207);
  const camera = new PerspectiveCamera(48, 1, 0.08, 160);
  const renderPipeline = new RenderPipeline(renderer);
  renderPipeline.outputColorTransform = false;

  const ambient = new AmbientLight(0x8da6d5, 0.24);
  const key = new DirectionalLight(0xffe0bd, 2.8);
  key.position.set(5, 7, 6);
  scene.add(ambient, key);

  const spaceStage = createSpaceIntegratorStage({
    mode: "accretion-disk",
    quality: tierConfig.spaceQuality,
    seed: route.scenario === "shot" ? RELATIVISTIC_SEEDS[0] : RELATIVISTIC_SEEDS[0],
  });
  spaceStage.mesh.scale.setScalar(3.25);
  spaceStage.mesh.position.set(0, 0, -1.1);
  // Preserve the factory's HDR result while publishing the same authored
  // radiance into the host emissive MRT. No second beauty render is created.
  const spaceRadiance = spaceStage.mesh.material.colorNode;
  spaceStage.mesh.material.colorNode = vec4(spaceRadiance.rgb.mul(0.12), spaceRadiance.a);
  spaceStage.mesh.material.emissiveNode = spaceRadiance.rgb.mul(0.88);
  scene.add(spaceStage.mesh);

  const particleStage = createPooledEffectsStage({
    scene,
    tier: tierConfig.particleTier,
    scenario: "reentry-shell-and-wake",
    seed: RELATIVISTIC_SEEDS[0],
  });
  const motionStage = createRelativisticMotionStage({
    renderer,
    subject: particleStage.reentry.group,
    queueEvent: particleStage.queueEvent,
    seed: RELATIVISTIC_SEEDS[0],
    instanceCount: route.tier === "hero" ? 512 : route.tier === "balanced" ? 256 : 128,
  });
  // Replace the factory's generic bootstrap packet with a packet attached to
  // the canonical motion subject before the first frame.
  particleStage.sparkPool.reset(renderer);
  particleStage.debrisPool.reset(renderer);
  particleStage.queueEvent({
    seed: RELATIVISTIC_SEEDS[0],
    position: particleStage.reentry.group.position.toArray(),
    flowDirectionWorld: [0, 0, -1],
    sparkCount: tierConfig.sparkCount,
    debrisCount: tierConfig.debrisCount,
  });
  const cameraStage = createRelativisticCameraStage({
    camera,
    subject: particleStage.reentry.group,
    cameraId: "design",
    tier: route.tier === "hero" ? "full" : route.tier === "balanced" ? "budgeted" : "minimum",
  });

  const scenePass = pass(scene, camera, { samples: 0 });
  scenePass.setResolutionScale(tierConfig.sceneScale);
  const sceneMrt = mrt({ output, emissive, velocity });
  sceneMrt.setBlendMode("emissive", new BlendMode(MaterialBlending));
  scenePass.setMRT(sceneMrt);
  const sceneColor = scenePass.getTextureNode("output");
  const sceneDepth = scenePass.getTextureNode("depth");
  const sceneVelocity = scenePass.getTextureNode("velocity");
  const sceneEmissive = scenePass.getTextureNode("emissive");

  const bloomStage = createSharedEmissiveBloomStage({
    emissiveTextureNode: sceneEmissive,
    resolutionScale: tierConfig.bloomScale,
  });
  const createHostImageStage = (exposureTier) => createImagePipelineStage({
      renderer,
      camera,
      sceneColorTextureNode: sceneColor,
      depthTextureNode: sceneDepth,
      velocityTextureNode: sceneVelocity,
      emissiveTextureNode: sceneEmissive,
      bloomTextureNode: bloomStage.outputNode,
      exposureTier,
      temporal: true,
      toneMappingVariant: "Neutral",
    });
  let imageStage = createHostImageStage(tierConfig.exposureTier);

  let width = Math.max(1, Math.round(canvas.clientWidth || canvas.width || 1200));
  let height = Math.max(1, Math.round(canvas.clientHeight || canvas.height || 800));
  let dpr = Math.min(globalThis.devicePixelRatio || 1, tierConfig.dprCap);
  renderer.setPixelRatio(dpr);
  renderer.setSize(width, height, false);
  camera.aspect = width / height;
  camera.updateProjectionMatrix();
  let captureTarget = new RenderTarget(Math.max(1, Math.round(width * dpr)), Math.max(1, Math.round(height * dpr)), {
    type: UnsignedByteType,
    depthBuffer: false,
  });
  captureTarget.texture.colorSpace = SRGBColorSpace;
  captureTarget.texture.name = "relativistic-space-shot-capture-rgba8";

  const timer = new Timer();
  if (documentRef) timer.connect(documentRef);
  const debugElement = documentRef?.querySelector?.("[data-space-debug]") ?? null;
  const resetEvents = [];
  const cpuFrameSamples = [];
  let scenario = route.scenario;
  let mechanism = route.mechanism;
  let tier = route.tier;
  let operatingTier = route.tier;
  let mode = route.mode;
  let cameraId = "design";
  let seed = RELATIVISTIC_SEEDS[0];
  let timeSeconds = 0;
  let disposed = false;
  let modeNodes = null;
  let particleReplaySteps = 0;

  function requireLive() {
    if (disposed) throw new Error("Relativistic Space Shot is disposed");
  }

  function compressedHdr(node) {
    return vec4(node.rgb.div(node.rgb.add(1)), 1);
  }

  function rebuildModeNodes() {
    const nodes = imageStage.nodes();
    const exposureLuminance = dot(nodes.preGrade.rgb, vec3(0.2126, 0.7152, 0.0722));
    const exposureSignal = exposureLuminance.div(exposureLuminance.add(1)).clamp(0, 1);
    const velocityMagnitude = length(sceneVelocity.xy).mul(8).clamp(0, 1);
    const emissiveLuminance = dot(sceneEmissive.rgb, vec3(0.2126, 0.7152, 0.0722));
    const emissiveSignal = emissiveLuminance.div(emissiveLuminance.add(1)).clamp(0, 1);
    const ownerSignalView = vec4(nodes.temporalConfidence.r, velocityMagnitude, emissiveSignal, 1);
    modeNodes = {
      final: nodes.output,
      "no-post": renderOutput(sceneColor, NeutralToneMapping, renderer.outputColorSpace),
      "curved-ray": renderOutput(sceneColor, NeutralToneMapping, renderer.outputColorSpace),
      "integration-pressure": renderOutput(sceneColor, NeutralToneMapping, renderer.outputColorSpace),
      velocity: renderOutput(vec4(sceneVelocity.xy.mul(0.5).add(0.5), 0, 1), NoToneMapping, renderer.outputColorSpace),
      particles: renderOutput(sceneColor, NeutralToneMapping, renderer.outputColorSpace),
      emissive: renderOutput(compressedHdr(sceneEmissive), NoToneMapping, renderer.outputColorSpace),
      bloom: renderOutput(compressedHdr(bloomStage.outputNode), NoToneMapping, renderer.outputColorSpace),
      exposure: renderOutput(vec4(exposureSignal, exposureSignal.mul(0.35), exposureSignal.oneMinus().mul(0.2), 1), NoToneMapping, renderer.outputColorSpace),
      "temporal-confidence": renderOutput(nodes.temporalConfidence, NoToneMapping, renderer.outputColorSpace),
      "owner-graph": renderOutput(ownerSignalView, NoToneMapping, renderer.outputColorSpace),
    };
  }

  function applyMode(nextMode) {
    mode = exact(nextMode, RELATIVISTIC_MODES, "mode");
    const curvedOnly = mode === "curved-ray" || mode === "integration-pressure";
    const particlesOnly = mode === "particles";
    spaceStage.mesh.visible = !particlesOnly;
    particleStage.reentry.group.visible = !curvedOnly;
    particleStage.sparkMesh.visible = !curvedOnly;
    particleStage.debrisMesh.visible = !curvedOnly;
    spaceStage.setDebugMode(mode === "integration-pressure" ? "step-count" : "final");
    renderPipeline.outputNode = modeNodes[mode];
    renderPipeline.outputColorTransform = false;
    renderPipeline.needsUpdate = true;
  }

  function resetImageHistory(cause) {
    const reset = imageStage.resetHistory(cause);
    resetEvents.push({ cause, timeSeconds, generation: reset.generation });
    rebuildModeNodes();
    applyMode(mode);
  }

  function applyOperatingTier(nextTier, reason) {
    operatingTier = exact(nextTier, RELATIVISTIC_TIERS, "operating tier");
    const config = RELATIVISTIC_TIER_CONFIG[operatingTier];
    const quality = CURVED_RAY_QUALITY_TIERS[config.spaceQuality];
    const uniforms = spaceStage.mesh.material.userData.curvedRayUniforms;
    uniforms.maxSteps.value = quality.maxSteps;
    uniforms.baseStep.value = quality.baseStep;
    uniforms.minStep.value = quality.minStep;
    uniforms.maxStep.value = quality.maxStep;
    uniforms.opacityCutoff.value = quality.opacityCutoff;
    uniforms.extinction.value = quality.extinction;
    spaceStage.mesh.material.userData.curvedRayQuality = { ...quality };
    bloomStage.node.setResolutionScale(config.bloomScale);
    particleStage.queueEvent({ sparkCount: config.sparkCount, debrisCount: config.debrisCount, seed });
    imageStage.dispose();
    imageStage = createHostImageStage(config.exposureTier);
    resetEvents.push({ cause: `quality-governor:${reason}:${operatingTier}`, timeSeconds, generation: imageStage.describe().temporal.generation });
    rebuildModeNodes();
    applyMode(mode);
  }

  const governorStress = new URLSearchParams(locationRef?.search ?? "").get("governor") === "stress";
  const qualityGovernor = createRelativisticQualityGovernor({
    initialTier: route.tier,
    targetFrameMs: 16.67,
    locked: !governorStress,
    onTransition(transition) { applyOperatingTier(transition.to, transition.reason); },
  });

  async function renderFrame(target = null, deltaSeconds = 0) {
    requireLive();
    spaceStage.update(timeSeconds);
    spaceStage.prepareFrame(renderer, camera, { jitter: [0, 0], forceCut: false });
    particleStage.step(renderer, deltaSeconds);
    particleStage.reentry.update(timeSeconds);
    imageStage.beforeRender(deltaSeconds);
    const previousTarget = renderer.getRenderTarget();
    const start = performance.now();
    try {
      renderer.setRenderTarget(target);
      renderPipeline.render();
    } finally {
      renderer.setRenderTarget(previousTarget);
    }
    const cpuFrameMs = performance.now() - start;
    cpuFrameSamples.push(cpuFrameMs);
    imageStage.meterAfterRender();
    qualityGovernor.record(cpuFrameMs);
  }

  function replayParticleState(seconds) {
    motionStage.setTime(0);
    particleStage.sparkPool.reset(renderer);
    particleStage.debrisPool.reset(renderer);
    particleStage.queueEvent({
      seed,
      position: particleStage.reentry.group.position.toArray(),
      flowDirectionWorld: [0, 0, -1],
      sparkCount: RELATIVISTIC_TIER_CONFIG[operatingTier].sparkCount,
      debrisCount: RELATIVISTIC_TIER_CONFIG[operatingTier].debrisCount,
    });
    particleReplaySteps = 0;
    let replayTime = 0;
    const replayStep = 1 / 60;
    while (replayTime + 1e-12 < seconds) {
      const delta = Math.min(replayStep, seconds - replayTime);
      motionStage.step(delta);
      particleStage.step(renderer, delta);
      replayTime += delta;
      particleReplaySteps += 1;
    }
    particleStage.reentry.update(seconds);
  }

  function describePipeline() {
    const graph = createRelativisticSpaceShotGraph({
      width: Math.max(1, Math.round(width * dpr)),
      height: Math.max(1, Math.round(height * dpr)),
      tier: operatingTier,
      activeMode: mode,
      spaceDescription: spaceStage.describePipeline(),
      particleDescription: particleStage.describePipeline(),
      bloomDescription: bloomStage.describe(),
      imageDescription: imageStage.describe(),
      motionDescription: motionStage.describe(),
      cameraDescription: cameraStage.describe(),
    });
    const validation = validateRelativisticSpaceShotGraph(graph);
    if (!validation.valid) throw new Error(validation.errors.join("\n"));
    return graph;
  }

  function updateDebug() {
    if (!debugElement) return;
    const graph = describePipeline();
    debugElement.textContent = JSON.stringify({
      status: "native-WebGPU runtime; v2 evidence pending",
      scenario,
      mechanism,
      tier,
      operatingTier,
      mode,
      camera: cameraId,
      seed: `0x${seed.toString(16).padStart(8, "0")}`,
      timeSeconds,
      backend: renderer.backend?.isWebGPUBackend === true ? "WebGPU" : "unsupported",
      owners: graph.ownerClaims,
      sceneSubmissions: graph.sceneSubmissions,
      compositionOrder: graph.compositionOrder,
      performanceVerdict: "INSUFFICIENT_EVIDENCE",
    }, null, 2);
  }

  rebuildModeNodes();
  applyMode(mode);
  await scenePass.compileAsync(renderer);
  await spaceStage.prepare(renderer, camera);

  const labController = {
    get labId() { return LAB_ID; },
    async ready() {
      cameraStage.update();
      await this.renderOnce();
    },
    async setScenario(id) {
      exact(id, RELATIVISTIC_SCENARIOS, "scenario");
      assertRelativisticRouteLock(route, { scenario: id });
      scenario = id;
    },
    async setMode(id) {
      exact(id, RELATIVISTIC_MODES, "mode");
      assertRelativisticRouteLock(route, { mode: id });
      applyMode(id);
    },
    async setTier(id) {
      exact(id, RELATIVISTIC_TIERS, "tier");
      assertRelativisticRouteLock(route, { tier: id });
      tier = id;
    },
    async setSeed(nextSeed) {
      seed = exact(nextSeed >>> 0, RELATIVISTIC_SEEDS, "seed");
      particleStage.setSeed(seed);
      motionStage.setSeed(seed);
      const seedNode = spaceStage.mesh.material.userData.curvedRayUniforms?.seed;
      if (seedNode) seedNode.value = seed;
      replayParticleState(timeSeconds);
      cameraStage.update();
      await resetImageHistory("seed-change");
    },
    async setCamera(id) {
      cameraId = exact(id, RELATIVISTIC_CAMERAS, "camera");
      cameraStage.setCamera(cameraId);
      await resetImageHistory("camera-change");
    },
    async setTime(seconds) {
      if (!Number.isFinite(seconds) || seconds < 0) throw new RangeError("time must be finite and nonnegative");
      timeSeconds = seconds;
      replayParticleState(seconds);
      cameraStage.update();
      await resetImageHistory("time-discontinuity");
    },
    async step(deltaSeconds) {
      if (!Number.isFinite(deltaSeconds) || deltaSeconds < 0) throw new RangeError("deltaSeconds must be finite and nonnegative");
      timeSeconds += deltaSeconds;
      motionStage.step(deltaSeconds);
      cameraStage.update();
      await renderFrame(null, deltaSeconds);
      updateDebug();
    },
    async resetHistory(cause) {
      if (typeof cause !== "string" || cause.length === 0) throw new TypeError("history reset cause is required");
      await resetImageHistory(cause);
    },
    async resize(nextWidth, nextHeight, nextDpr) {
      if (!Number.isInteger(nextWidth) || !Number.isInteger(nextHeight) || nextWidth <= 0 || nextHeight <= 0) throw new RangeError("resize dimensions must be positive integers");
      if (!Number.isFinite(nextDpr) || nextDpr <= 0) throw new RangeError("DPR must be finite and positive");
      width = nextWidth;
      height = nextHeight;
      dpr = Math.min(nextDpr, tierConfig.dprCap);
      renderer.setPixelRatio(dpr);
      renderer.setSize(width, height, false);
      camera.aspect = width / height;
      camera.updateProjectionMatrix();
      cameraStage.update();
      captureTarget.setSize(Math.max(1, Math.round(width * dpr)), Math.max(1, Math.round(height * dpr)));
      await resetImageHistory("resize-or-dpr");
    },
    async renderOnce() {
      await renderFrame(null, 0);
      updateDebug();
    },
    async capturePixels(target = mode) {
      exact(target, RELATIVISTIC_MODES, "capture target");
      const previousMode = mode;
      try {
        applyMode(target);
        await renderFrame(captureTarget, 0);
        const padded = await renderer.readRenderTargetPixelsAsync(captureTarget, 0, 0, captureTarget.width, captureTarget.height);
        const unpacked = unpackAlignedReadback(padded, captureTarget.width, captureTarget.height, 4);
        return {
          target,
          width: captureTarget.width,
          height: captureTarget.height,
          format: "rgba8unorm",
          encoding: renderer.outputColorSpace,
          pixels: unpacked.pixels,
          readbackLayout: unpacked.layout,
          sourceByteLength: unpacked.sourceByteLength,
        };
      } finally {
        applyMode(previousMode);
      }
    },
    describePipeline,
    describeResources() {
      const graph = describePipeline();
      return {
        runtimeResources: graph.resources,
        space: spaceStage.describeResources(),
        particles: particleStage.describeResources(),
        image: imageStage.describe(),
        bloom: bloomStage.describe(),
        captureTarget: {
          width: captureTarget.width,
          height: captureTarget.height,
          bytes: numeric(captureTarget.width * captureTarget.height * 4, "bytes", "Derived", "RGBA8 capture payload"),
        },
        physicalInventoryVerdict: "INSUFFICIENT_EVIDENCE",
      };
    },
    getMetrics() {
      return {
        labId: LAB_ID,
        threeRevision: REVISION,
        backend: renderer.backend?.isWebGPUBackend === true ? "WebGPU" : "unsupported",
        scenario,
        mechanism,
        tier,
        operatingTier,
        mode,
        camera: cameraId,
        seed,
        timeSeconds,
        cpuFrameSamples: [...cpuFrameSamples],
        resetEvents: [...resetEvents],
        motion: motionStage.describe(),
        cameraState: cameraStage.describe(),
        particleReplaySteps,
        qualityGovernor: qualityGovernor.describe(),
        modeDiagnostic: mode === "exposure"
          ? "composed pre-grade luminance meter signal"
          : mode === "owner-graph"
            ? "RGB = temporal confidence, velocity magnitude, shared emissive luminance"
            : mode,
        gpuTimingVerdict: "INSUFFICIENT_EVIDENCE",
        lifecycleVerdict: "INSUFFICIENT_EVIDENCE",
      };
    },
    async resolveGpuTimings() {
      try {
        const renderMs = await renderer.resolveTimestampsAsync("render");
        const computeMs = await renderer.resolveTimestampsAsync("compute");
        if (!Number.isFinite(renderMs)) throw new Error("render timestamps unavailable");
        return { verdict: "PASS", renderMs, computeMs: Number.isFinite(computeMs) ? computeMs : null };
      } catch (error) {
        return { verdict: "INSUFFICIENT_EVIDENCE", renderMs: null, computeMs: null, reason: error.message };
      }
    },
    async dispose() {
      if (disposed) return;
      disposed = true;
      renderer.setAnimationLoop(null);
      timer.dispose?.();
      cameraStage.dispose();
      motionStage.dispose();
      imageStage.dispose();
      bloomStage.dispose();
      particleStage.dispose();
      scene.remove(spaceStage.mesh);
      spaceStage.dispose();
      scenePass.dispose?.();
      captureTarget.dispose();
      renderPipeline.dispose();
      renderer.dispose();
      captureTarget = null;
    },
  };

  if (startAnimationLoop) {
    let frameInFlight = false;
    renderer.setAnimationLoop((timestamp) => {
      timer.update(timestamp);
      const deltaSeconds = Math.min(timer.getDelta(), 1 / 20);
      if (frameInFlight) return;
      frameInFlight = true;
      labController.step(deltaSeconds).catch((error) => {
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
    scenePass,
    spaceStage,
    particleStage,
    motionStage,
    cameraStage,
    bloomStage,
    get imageStage() { return imageStage; },
    route,
    labController,
    signals: Object.freeze({
      output: sceneColor,
      depth: sceneDepth,
      velocity: sceneVelocity,
      emissive: sceneEmissive,
    }),
  };
}
