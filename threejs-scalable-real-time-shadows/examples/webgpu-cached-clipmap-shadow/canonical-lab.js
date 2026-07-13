import {
  AgXToneMapping,
  Bone,
  BoxGeometry,
  Color,
  CylinderGeometry,
  DirectionalLight,
  DoubleSide,
  Float32BufferAttribute,
  HemisphereLight,
  InstancedMesh,
  Layers,
  Matrix4,
  Mesh,
  MeshStandardNodeMaterial,
  NoToneMapping,
  PerspectiveCamera,
  PlaneGeometry,
  RenderPipeline,
  RenderTarget,
  RendererUtils,
  REVISION,
  Scene,
  ShadowNodeMaterial,
  Skeleton,
  SkinnedMesh,
  SphereGeometry,
  Uint16BufferAttribute,
  UnsignedByteType,
  Vector3,
  WebGPURenderer,
} from "three/webgpu";
import {
  Fn,
  color,
  float,
  mix,
  pass,
  positionLocal,
  renderOutput,
  screenUV,
  sin,
  step,
  texture,
  uniform,
  vec3,
  vec4,
} from "three/tsl";

import {
  DIRTY_REASON_BITS,
  validateClipmapConfig,
} from "./clipmap-config.js";
import {
  createShadowArchitectureOwner,
  configureShadowRenderer,
} from "./shadow-architectures.js";
import {
  SHADOW_MECHANISM_ROUTES,
  SHADOW_QUALITY_TIERS,
  configForShadowTier,
  resolveLockedShadowRoute,
} from "./routes.js";
import {
  bindWebGPUDeviceIdentity,
  captureRuntimeProfileFields,
  markWebGPUDeviceDisposed,
  markWebGPUDeviceDisposing,
  webgpuDeviceIdentityMetrics,
} from "../../../labs/runtime/webgpu-device-identity.mjs";

const MODES = Object.freeze([
  "final",
  "shadow-contribution",
  "shadow-depth",
  "level-centers",
  "level-validity",
  "scheduler",
  "silhouette-parity",
  "owner-graph",
]);
const CAMERAS = Object.freeze(["near", "design", "far"]);
const PARITY_LAYER = 2;
const CAMERA_POSITIONS = Object.freeze({
  near: Object.freeze([14, 10, 18]),
  design: Object.freeze([32, 24, 42]),
  far: Object.freeze([90, 68, 112]),
});
const ARCHITECTURE_DIAGNOSTIC_VALUE = Object.freeze({
  bounded: 0.125,
  csm: 0.375,
  tiled: 0.625,
  cached: 0.875,
});
const _casterWorld = new Vector3();
export const SHADOW_CASTER_CLASSES = Object.freeze([
  "alpha-tested",
  "shared-wind-displacement",
  "instanced",
  "morph-target",
  "skinned-two-bone",
]);

/**
 * Native-WebGPU shadow lab. This module owns one renderer and one final
 * RenderPipeline. It exposes capture hooks but does not claim accepted GPU
 * evidence until the v2 artifact validator runs on the current adapter.
 */
export async function createCanonicalShadowLab({
  canvas,
  pathname = globalThis.location?.pathname ?? "/",
  width = 1200,
  height = 800,
  dpr = 1,
  route = resolveLockedShadowRoute(pathname),
} = {}) {
  const renderer = new WebGPURenderer({
    canvas,
    antialias: false,
    reversedDepthBuffer: false,
    trackTimestamp: true,
  });
  renderer.setPixelRatio(dpr);
  renderer.setSize(width, height, false);
  renderer.toneMapping = AgXToneMapping;
  renderer.toneMappingExposure = 1;
  await renderer.init();
  if (renderer.backend?.isWebGPUBackend !== true) {
    renderer.dispose();
    throw new Error("canonical shadow lab requires native WebGPU");
  }
  if (REVISION !== "185") {
    renderer.dispose();
    throw new Error(`canonical shadow lab requires Three r185, found ${REVISION}`);
  }
  const deviceIdentity = bindWebGPUDeviceIdentity(renderer);
  configureShadowRenderer(renderer);

  const tier = SHADOW_QUALITY_TIERS[route.tierId];
  if (!tier) throw new RangeError(`unknown locked tier ${route.tierId}`);
  const config = configForShadowTier(route.tierId);
  const validation = validateClipmapConfig(config);
  if (!validation.ok) throw new Error(validation.errors.join("\n"));

  const sceneBundle = createArchitectureFixture(width / height);
  const {
    scene,
    camera,
    light,
    animated,
    resources,
    parityCasterClasses,
    seededSubjects,
  } = sceneBundle;
  const owner = createShadowArchitectureOwner({
    light,
    architecture: route.architecture,
    config: validation.config,
  });
  if (owner.architecture === "cached") {
    notifyAnimatedCasterBounds(owner.node, animated, 0);
  }
  const renderPipeline = new RenderPipeline(renderer);
  renderPipeline.outputColorTransform = false;
  const scenePass = pass(scene, camera, { samples: 0 });
  const finalNode = scenePass.getTextureNode("output");
  const graphKeepAlive = uniform(0);
  const shadowMaskMaterial = new ShadowNodeMaterial({
    color: 0xffffff,
    opacity: 1,
  });
  const shadowMaskPass = pass(scene, camera, { samples: 0 });
  shadowMaskPass.name = "actual-shadow-contribution";
  shadowMaskPass.overrideMaterial = shadowMaskMaterial;
  const shadowContributionNode = shadowMaskPass.getTextureNode("output");
  const diagnosticUniforms = createShadowDiagnosticUniforms(
    validation.config.levelCount,
  );
  const levelCentersNode = createLevelBandDiagnostic(
    diagnosticUniforms.centers,
  );
  const levelValidityNode = createLevelBandDiagnostic(
    diagnosticUniforms.validity,
  );
  const schedulerNode = createLevelBandDiagnostic(
    diagnosticUniforms.scheduler,
  );
  const ownerGraphNode = createOwnerGraphDiagnostic(diagnosticUniforms.owner);
  let parityPass = null;
  let parityNode = null;
  renderPipeline.outputNode = renderOutput(finalNode);

  const state = {
    route,
    mode: "final",
    requestedMode: route.mode,
    scenario: route.scenario,
    tierId: route.tierId,
    cameraId: "design",
    seed: 0x00000001,
    time: 0,
    frameCount: 0,
    ready: false,
    scenarioTrace: [],
    diagnosticSourceFrame: -1,
    disposed: false,
  };

  function assertLive() {
    if (state.disposed) throw new Error("shadow lab has been disposed");
  }

  async function ready() {
    assertLive();
    if (state.ready) return;
    // Compile the material/light graph, then permit cached levels to populate.
    // This encodes work; capturePixels supplies the completion/readback fence.
    renderOnce();
    renderOnce();
    await executeLockedScenarioActions();
    setOutputForMode(state.requestedMode);
    renderOnce();
    state.ready = true;
  }

  function renderOnce() {
    assertLive();
    updateDiagnosticUniforms();
    scene.updateMatrixWorld(true);
    camera.updateMatrixWorld(true);
    renderPipeline.render();
    state.frameCount += 1;
    owner.recordFrame(state.frameCount);
    updateDiagnosticUniforms();
  }

  function setOutputForMode(mode) {
    // Builtin capture uses no-post/diagnostics display aliases.
    const resolved = mode === "no-post"
      ? "shadow-contribution"
      : mode === "diagnostics"
        ? "owner-graph"
        : mode;
    if (!MODES.includes(resolved)) throw new RangeError(`unknown shadow mode: ${mode}`);
    let outputNode = finalNode;
    let dataOutput = false;
    if (resolved === "shadow-contribution") {
      outputNode = shadowContributionNode;
      dataOutput = true;
    } else if (resolved === "shadow-depth") {
      const depthTexture = firstDepthTexture(owner);
      if (!depthTexture) {
        throw new Error("shadow-depth mode requires a compiled, rendered shadow target");
      }
      const depth = texture(depthTexture).r;
      outputNode = keepRuntimeGraphReachable(vec4(vec3(depth), 1));
      dataOutput = true;
    } else if (resolved === "level-centers") {
      requireCachedMode(resolved);
      outputNode = keepRuntimeGraphReachable(levelCentersNode);
      dataOutput = true;
    } else if (resolved === "level-validity") {
      requireCachedMode(resolved);
      outputNode = keepRuntimeGraphReachable(levelValidityNode);
      dataOutput = true;
    } else if (resolved === "scheduler") {
      requireCachedMode(resolved);
      outputNode = keepRuntimeGraphReachable(schedulerNode);
      dataOutput = true;
    } else if (resolved === "silhouette-parity") {
      requireCachedMode(resolved);
      outputNode = keepRuntimeGraphReachable(ensureParityNode());
      dataOutput = true;
    } else if (resolved === "owner-graph") {
      outputNode = keepRuntimeGraphReachable(ownerGraphNode);
      dataOutput = true;
    }
    renderPipeline.outputNode = dataOutput
      ? renderOutput(outputNode, NoToneMapping, renderer.outputColorSpace)
      : renderOutput(outputNode);
    renderPipeline.needsUpdate = true;
    // Keep locked semantic mode as final when capture uses display aliases.
    state.mode = (mode === "no-post" || mode === "diagnostics") ? "final" : resolved;
  }

  function requireCachedMode(mode) {
    if (owner.architecture !== "cached") {
      throw new Error(`${mode} requires the cached-clipmap architecture`);
    }
  }

  function keepRuntimeGraphReachable(node) {
    return mix(node, finalNode, graphKeepAlive);
  }

  function ensureParityNode() {
    if (parityNode !== null) return parityNode;
    const level = selectCachedDiagnosticLevel(owner.node);
    if (!level?.depthTexture || !level.shadowCamera) {
      throw new Error("silhouette parity requires a committed cached shadow level");
    }
    parityPass = pass(scene, level.shadowCamera, { samples: 0 });
    parityPass.name = "visible-caster-position-parity";
    const parityLayers = new Layers();
    parityLayers.set(PARITY_LAYER);
    parityPass.setLayers(parityLayers);
    const visibleDepth = parityPass.getTextureNode("depth").r;
    const committedShadowDepth = texture(level.depthTexture).r;
    const visibleCaster = visibleDepth.lessThan(0.9999).select(1, 0);
    const signedError = visibleDepth
      .sub(committedShadowDepth)
      .abs()
      .mul(visibleCaster)
      .mul(32)
      .clamp(0, 1);
    parityNode = vec4(
      signedError,
      visibleCaster,
      committedShadowDepth.mul(visibleCaster),
      1,
    );
    return parityNode;
  }

  function updateDiagnosticUniforms() {
    const description = owner.describe();
    const cachedLevels = owner.architecture === "cached" ? owner.node.levels : [];
    const selected = new Set(
      description.frameMetrics?.selectedLevelIndices ?? [],
    );
    for (let index = 0; index < diagnosticUniforms.centers.length; index += 1) {
      const level = cachedLevels[index];
      if (!level) {
        diagnosticUniforms.centers[index].value.set(0, 0, 0);
        diagnosticUniforms.validity[index].value.set(0, 0, 0);
        diagnosticUniforms.scheduler[index].value.set(0, 0, 0);
        continue;
      }
      diagnosticUniforms.centers[index].value.set(
        encodeSignedDiagnostic(level.centerX),
        encodeSignedDiagnostic(level.centerY),
        Math.min(1, level.texelWidth / owner.node.levels.at(-1).texelWidth),
      );
      diagnosticUniforms.validity[index].value.set(
        level.valid ? 1 : 0,
        level.samplingEnabled === false ? 0 : 1,
        level.committedBasisEpoch === owner.node.basisEpoch ? 1 : 0,
      );
      diagnosticUniforms.scheduler[index].value.set(
        selected.has(level.index) ? 1 : 0,
        Math.min(1, (level.updateDebt ?? 0) / Math.max(1, validation.config.maxCacheAge)),
        Math.min(1, level.age / Math.max(1, validation.config.maxCacheAge)),
      );
    }
    const totals = description.resourceTotals ?? {
      targetCount: 0,
      residentTargetCount: 0,
    };
    diagnosticUniforms.owner.value.set(
      ARCHITECTURE_DIAGNOSTIC_VALUE[owner.architecture],
      totals.targetCount > 0
        ? totals.residentTargetCount / totals.targetCount
        : 0,
      Math.min(
        1,
        (description.frameMetrics?.sceneSubmissionCount ?? 0) /
          Math.max(1, validation.config.levelCount),
      ),
    );
    state.diagnosticSourceFrame = description.frameMetrics?.frameId ?? -1;
  }

  async function executeLockedScenarioActions() {
    const trace = {
      mechanism: state.route.mechanismId,
      scenario: state.scenario,
      actions: [...(state.route.actions ?? [])],
      samples: [],
    };
    if (owner.architecture !== "cached") {
      trace.samples.push({
        action: state.route.actions?.[0] ?? "render-architecture",
        architecture: owner.architecture,
        frameMetrics: owner.describe().frameMetrics,
      });
      state.scenarioTrace.push(trace);
      return;
    }

    if (state.scenario === "slow-subtexel-pan") {
      const level = owner.node.levels[0];
      const before = snapshotLevelCenters(owner.node.levels);
      const worldPosition = camera.getWorldPosition(new Vector3());
      const relative = worldPosition.clone().sub(owner.node.basis.anchor);
      const currentLightX = relative.dot(owner.node.basis.right);
      const targetLightX = level.centerX + level.texelWidth * 0.25;
      camera.position.addScaledVector(
        owner.node.basis.right,
        targetLightX - currentLightX,
      );
      camera.lookAt(0, 3, 0);
      camera.updateMatrixWorld(true);
      renderOnce();
      const after = snapshotLevelCenters(owner.node.levels);
      trace.samples.push({
        action: "subtexel-camera-pan",
        displacementWorld: targetLightX - currentLightX,
        finestTexelWidth: level.texelWidth,
        before,
        after,
        finestCenterStable:
          before[0].x === after[0].x && before[0].y === after[0].y,
      });
    } else if (state.scenario === "bias-sweep") {
      const normalBiasCap =
        validation.config.maxNormalBias ?? validation.config.baseNormalBias * 8;
      const samples = [
        { bias: -0.0002, normalBias: validation.config.baseNormalBias * 0.5 },
        { bias: validation.config.baseBias, normalBias: validation.config.baseNormalBias },
        { bias: 0.0002, normalBias: normalBiasCap * 0.9 },
      ];
      for (const sample of samples) {
        for (const level of owner.node.levels) {
          owner.node.setLevelBias(level.index, sample);
        }
        renderOnce();
        trace.samples.push({
          action: "sweep-bias-normal-bias",
          ...sample,
          frameMetrics: owner.describe().frameMetrics,
        });
      }
    } else if (state.scenario === "swept-caster-invalidation") {
      const before = owner.node.levels.map((level) => level.contentEpoch);
      await setTime(0.75);
      renderOnce();
      trace.samples.push({
        action: "move-caster-and-invalidate",
        beforeContentEpochs: before,
        afterContentEpochs: owner.node.levels.map((level) => level.contentEpoch),
        invalidations: owner.node.lastSelection?.deformationInvalidations ?? [],
        frameMetrics: owner.describe().frameMetrics,
      });
    } else if (state.scenario === "age-priority-round-robin") {
      owner.node.invalidateAll(
        DIRTY_REASON_BITS.forceDirty,
        "scheduler-fairness-probe",
      );
      const visited = new Set();
      const maximumFrames = owner.node.levels.length * 2;
      for (let frame = 0; frame < maximumFrames; frame += 1) {
        renderOnce();
        const frameMetrics = owner.describe().frameMetrics;
        for (const index of frameMetrics.selectedLevelIndices) visited.add(index);
        trace.samples.push({
          action: "force-refresh-and-drain-fairly",
          probeFrame: frame,
          selectedLevelIndices: [...frameMetrics.selectedLevelIndices],
        });
        if (owner.node.levels.every((level) => level.valid && !level.forceDirty)) {
          break;
        }
      }
      trace.fairness = {
        visitedLevelIndices: [...visited].sort((a, b) => a - b),
        allLevelsVisited: owner.node.levels.every((level) => visited.has(level.index)),
      };
    } else if (state.scenario === "alpha-displaced-instanced-morph") {
      await setTime(0.75);
      renderOnce();
      trace.samples.push({
        action: "animate-all-caster-classes",
        casterClasses: [...parityCasterClasses],
        frameMetrics: owner.describe().frameMetrics,
      });
    } else {
      trace.samples.push({
        action: "populate-cached-levels",
        validLevels: owner.node.levels.filter((level) => level.valid).length,
        frameMetrics: owner.describe().frameMetrics,
      });
    }
    state.scenarioTrace.push(trace);
  }

  async function setScenario(id) {
    assertLive();
    const known = Object.values(SHADOW_MECHANISM_ROUTES).some(
      (entry) => entry.scenario === id,
    );
    if (!known) throw new RangeError(`unknown shadow scenario: ${id}`);
    if (id !== state.route.scenario) {
      throw new Error(`scenario is locked by route to ${state.route.scenario}`);
    }
    state.scenario = id;
  }

  async function setMode(id) {
    assertLive();
    setOutputForMode(id);
  }

  async function setTier(id) {
    assertLive();
    if (!SHADOW_QUALITY_TIERS[id]) throw new RangeError(`unknown shadow tier: ${id}`);
    if (id !== state.route.tierId) {
      throw new Error(`tier is locked by route to ${state.route.tierId}`);
    }
  }

  async function setSeed(seed) {
    assertLive();
    if (!Number.isInteger(seed) || seed < 0 || seed > 0xffffffff) {
      throw new RangeError("seed must be an unsigned 32-bit integer");
    }
    state.seed = seed;
    applyFixtureSeed(seededSubjects, seed);
    if (owner.architecture === "cached") {
      owner.node.invalidateAll(
        DIRTY_REASON_BITS.deformationChanged,
        "fixture-seed-change",
      );
    }
  }

  async function setCamera(id) {
    assertLive();
    if (!CAMERAS.includes(id)) throw new RangeError(`unknown shadow camera: ${id}`);
    camera.position.fromArray(CAMERA_POSITIONS[id]);
    camera.lookAt(0, 3, 0);
    camera.updateMatrixWorld(true);
    state.cameraId = id;
  }

  async function setTime(seconds) {
    assertLive();
    if (!Number.isFinite(seconds)) throw new RangeError("time must be finite");
    state.time = seconds;
    applyFixtureTime(animated, seconds);
    if (owner.architecture === "cached") {
      if (state.scenario === "bias-sweep") {
        applyBiasSweep(owner.node, validation.config, seconds);
      }
      notifyAnimatedCasterBounds(owner.node, animated, seconds);
    }
  }

  async function step(deltaSeconds) {
    assertLive();
    if (!Number.isFinite(deltaSeconds) || deltaSeconds < 0) {
      throw new RangeError("deltaSeconds must be finite and nonnegative");
    }
    await setTime(state.time + deltaSeconds);
    renderOnce();
  }

  async function resetHistory(cause) {
    assertLive();
    if (typeof cause !== "string" || cause.length === 0) {
      throw new TypeError("history reset cause must be a nonempty string");
    }
    if (owner.architecture === "cached") {
      owner.node.invalidateAll(DIRTY_REASON_BITS.forceDirty, cause);
    }
  }

  async function resize(nextWidth, nextHeight, nextDpr = 1) {
    assertLive();
    if (
      !Number.isInteger(nextWidth) || nextWidth <= 0 ||
      !Number.isInteger(nextHeight) || nextHeight <= 0 ||
      !Number.isFinite(nextDpr) || nextDpr <= 0
    ) {
      throw new RangeError("resize requires positive integer dimensions and DPR");
    }
    renderer.setPixelRatio(nextDpr);
    renderer.setSize(nextWidth, nextHeight, false);
    camera.aspect = nextWidth / nextHeight;
    camera.updateProjectionMatrix();
  }

  async function capturePixels(target = "final", capture = {}) {
    assertLive();
    // Builtin capture writes final/no-post/diagnostics after setMode(...).
    // "final" and "presentation" read the currently selected output without
    // forcing a mode switch (same contract as rain/frost controllers).
    const presentationTargets = new Set(["final", "presentation"]);
    const isPresentation = presentationTargets.has(target);
    if (!isPresentation && !MODES.includes(target) && target !== "no-post" && target !== "diagnostics") {
      throw new RangeError(`unknown capture target: ${target}`);
    }
    const captureWidth = capture.width ?? 1200;
    const captureHeight = capture.height ?? 800;
    const previousMode = state.mode;
    // Preserve the locked public mode for presentation aliases when switching.
    const previousRequested = state.requestedMode;
    if (!isPresentation) setOutputForMode(target);
    const renderTarget = new RenderTarget(captureWidth, captureHeight, {
      depthBuffer: false,
      stencilBuffer: false,
      type: UnsignedByteType,
    });
    renderTarget.texture.name = `shadow-capture-${target}`;
    let rendererState;
    try {
      rendererState = RendererUtils.resetRendererState(renderer, rendererState);
      renderer.setRenderTarget(renderTarget);
      renderOnce();
      const raw = await renderer.readRenderTargetPixelsAsync(
        renderTarget,
        0,
        0,
        captureWidth,
        captureHeight,
      );
      const layout = describeRgbaReadbackLayout(raw, captureWidth, captureHeight);
      return {
        target,
        width: captureWidth,
        height: captureHeight,
        format: "rgba8unorm",
        outputColorSpace: renderer.outputColorSpace,
        bytesPerPixel: 4,
        rowBytes: layout.rowBytes,
        bytesPerRow: layout.bytesPerRow,
        sourceBytesPerRow: layout.sourceBytesPerRow,
        sourceByteLength: raw.byteLength,
        sourceElementBytes: 1,
        colorManaged: true,
        pixels: compactAlignedRgbaRows(raw, captureWidth, captureHeight),
        source: "render-target-readback",
      };
    } finally {
      if (rendererState) RendererUtils.restoreRendererState(renderer, rendererState);
      renderTarget.dispose();
      if (!isPresentation) {
        setOutputForMode(previousMode === "final" ? (previousRequested ?? "final") : previousMode);
      }
    }
  }

  function describePipeline() {
    const architecture = owner.describe();
    return {
      ...captureRuntimeProfileFields(),
      owners: {
        renderer: "canonical-shadow-lab",
        finalRenderPipeline: "canonical-shadow-lab",
        directionalShadow: owner.architecture,
        toneMap: "renderOutput",
        finalOutputTransform: "renderOutput",
      },
      finalToneMapOwner: "renderOutput",
      finalOutputTransformOwner: "renderOutput",
      renderPipelineOutputColorTransform: renderPipeline.outputColorTransform,
      sceneSubmissions: [
        {
          id: state.mode === "shadow-contribution"
            ? "shadow-mask-scene-pass"
            : state.mode === "silhouette-parity"
              ? "beauty-keepalive-plus-caster-depth"
              : "beauty-or-diagnostic-scene-pass",
          count: state.mode === "silhouette-parity" ? 2 : 1,
          provenance: "runtime-output-graph-selection",
        },
      ],
      architecture,
      route: { ...state.route },
      routeSelection: routeSelection(),
      diagnosticSourceFrame: state.diagnosticSourceFrame,
    };
  }

  function describeResources() {
    return {
      renderer: {
        threeRevision: REVISION,
        nativeWebGPU: renderer.backend.isWebGPUBackend === true,
        timestampQuery: renderer.hasFeature?.("timestamp-query") === true,
      },
      shadows: owner.describe().resources ?? [],
      diagnosticPasses: [
        {
          id: "shadow-contribution",
          reachable: state.mode === "shadow-contribution",
          residencyVerdict: "INSUFFICIENT_EVIDENCE",
          size: [shadowMaskPass.renderTarget.width, shadowMaskPass.renderTarget.height],
        },
        ...(parityPass
          ? [{
              id: "caster-position-parity",
              reachable: state.mode === "silhouette-parity",
              residencyVerdict: "INSUFFICIENT_EVIDENCE",
              size: [parityPass.renderTarget.width, parityPass.renderTarget.height],
            }]
          : []),
      ],
      fixture: resources.map((resource) => resource.name),
      transientAndStagingBytes: null,
      transientAndStagingVerdict: "INSUFFICIENT_EVIDENCE",
    };
  }

  function getMetrics() {
    return {
      labId: "webgpu-cached-clipmap-shadow",
      ...webgpuDeviceIdentityMetrics(deviceIdentity, renderer),
      status: "runtime-implemented-evidence-pending",
      performanceVerdict: "INSUFFICIENT_EVIDENCE",
      threeRevision: REVISION,
      frameCount: state.frameCount,
      time: state.time,
      timeSeconds: state.time,
      mode: state.mode,
      mechanismId: state.route.mechanismId,
      tier: state.tierId,
      tierId: state.tierId,
      scenario: state.scenario,
      camera: state.cameraId,
      seed: state.seed,
      viewport: {
        width: renderer.domElement.width,
        height: renderer.domElement.height,
        dpr: renderer.getPixelRatio(),
      },
      route: { ...state.route },
      routeSelection: routeSelection(),
      scenarioTrace: structuredClone(state.scenarioTrace),
      parityCasterClasses: [...parityCasterClasses],
      architecture: owner.describe(),
      infoSnapshot: snapshotRendererInfo(renderer.info),
    };
  }

  async function dispose() {
    if (state.disposed) return;
    state.disposed = true;
    markWebGPUDeviceDisposing(deviceIdentity);
    owner.dispose();
    parityPass?.dispose?.();
    shadowMaskPass.dispose?.();
    shadowMaskMaterial.dispose();
    for (const resource of resources) resource.dispose?.();
    renderPipeline.dispose();
    renderer.dispose();
    markWebGPUDeviceDisposed(deviceIdentity);
  }

  function routeSelection() {
    return {
      mechanism: state.route.mechanismId,
      tier: state.tierId,
      scenario: state.scenario,
      mode: state.mode,
      architecture: owner.architecture,
    };
  }

  return {
    renderer,
    renderPipeline,
    scene,
    camera,
    route,
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
  };
}

function createShadowDiagnosticUniforms(levelCount) {
  const vectorUniforms = () =>
    Array.from({ length: levelCount }, () => uniform(new Vector3()));
  return {
    centers: vectorUniforms(),
    validity: vectorUniforms(),
    scheduler: vectorUniforms(),
    owner: uniform(new Vector3()),
  };
}

function createLevelBandDiagnostic(entries) {
  let result = vec3(0.015, 0.02, 0.03);
  for (let index = 0; index < entries.length; index += 1) {
    const lower = index / entries.length;
    const upper = (index + 1) / entries.length;
    const inBand = screenUV.y
      .greaterThanEqual(lower)
      .and(screenUV.y.lessThan(upper));
    result = inBand.select(entries[index], result);
  }
  return vec4(result, 1);
}

function createOwnerGraphDiagnostic(ownerUniform) {
  const left = screenUV.x.lessThan(1 / 3);
  const middle = screenUV.x.lessThan(2 / 3);
  const architecture = vec3(ownerUniform.x, 0.04, 0.04);
  const residency = vec3(0.04, ownerUniform.y, 0.04);
  const submissions = vec3(0.04, 0.04, ownerUniform.z);
  return vec4(left.select(architecture, middle.select(residency, submissions)), 1);
}

function encodeSignedDiagnostic(value) {
  if (!Number.isFinite(value)) return 0;
  return 0.5 + 0.5 * (value / (1 + Math.abs(value)));
}

function snapshotLevelCenters(levels) {
  return levels.map((level) => ({
    index: level.index,
    x: level.centerX,
    y: level.centerY,
    z: level.centerZ,
    renderCount: level.renderCount,
  }));
}

function applyBiasSweep(node, config, seconds) {
  const phase = 0.5 + 0.5 * Math.sin(seconds * 0.75);
  const finestTexel = node.levels[0]?.texelWidth ?? 1;
  const normalBiasCap = config.maxNormalBias ?? config.baseNormalBias * 8;
  for (const level of node.levels) {
    const scale = level.texelWidth / finestTexel;
    node.setLevelBias(level.index, {
      bias: config.baseBias + (phase - 0.5) * 0.0004,
      normalBias: Math.min(
        normalBiasCap,
        config.baseNormalBias * scale * (0.5 + 1.5 * phase),
      ),
    });
  }
}

function applyFixtureSeed(subjects, seed) {
  let state = seed >>> 0;
  const randomSigned = () => {
    state = Math.imul(state ^ (state >>> 16), 0x45d9f3b) >>> 0;
    state = Math.imul(state ^ (state >>> 16), 0x45d9f3b) >>> 0;
    state ^= state >>> 16;
    return (state / 0xffffffff) * 2 - 1;
  };
  for (const subject of subjects) {
    const base = subject.userData.shadowSeedBasePosition;
    subject.position.set(
      base.x + randomSigned() * 1.25,
      base.y,
      base.z + randomSigned() * 1.25,
    );
    subject.rotation.y = randomSigned() * 0.2;
    subject.updateMatrixWorld(true);
  }
}

function snapshotRendererInfo(info) {
  const numericRecord = (record, keys) => Object.fromEntries(
    keys
      .filter((key) => Number.isFinite(record?.[key]))
      .map((key) => [key, record[key]]),
  );
  return {
    render: numericRecord(info?.render, [
      "frame",
      "calls",
      "triangles",
      "points",
      "lines",
      "timestamp",
    ]),
    compute: numericRecord(info?.compute, ["calls", "frame", "timestamp"]),
    memory: numericRecord(info?.memory, ["geometries", "textures"]),
    programs: Array.isArray(info?.programs) ? info.programs.length : null,
    provenance: "selected finite counters copied from renderer.info",
  };
}

function createArchitectureFixture(aspect) {
  const scene = new Scene();
  scene.name = "seeded-shadow-architecture-fixture";
  scene.background = new Color(0x000000);
  const camera = new PerspectiveCamera(48, aspect, 0.3, 400);
  camera.position.set(32, 24, 42);
  camera.lookAt(0, 3, 0);
  camera.layers.enable(PARITY_LAYER);

  const hemi = new HemisphereLight(0xd9ecff, 0x20251f, 0.35);
  const light = new DirectionalLight(0xfff3d6, 3.2);
  light.name = "canonical-shadow-owner";
  light.position.set(32, 48, 24);
  light.target.position.set(0, 0, 0);
  scene.add(hemi, light, light.target);

  const resources = [];
  const groundGeometry = new PlaneGeometry(180, 180, 1, 1);
  const groundMaterial = material(0x6d7663, 0.88, 0);
  const ground = new Mesh(groundGeometry, groundMaterial);
  ground.name = "shadow-receiver-ground";
  ground.rotation.x = -Math.PI / 2;
  ground.receiveShadow = true;
  scene.add(ground);
  resources.push(groundGeometry, groundMaterial);

  const boxGeometry = new BoxGeometry(5, 10, 5);
  const boxMaterial = material(0xa25039, 0.62, 0.02);
  const box = new Mesh(boxGeometry, boxMaterial);
  box.name = "static-box-caster";
  box.position.set(-8, 5, -2);
  box.castShadow = true;
  box.receiveShadow = true;
  scene.add(box);
  resources.push(boxGeometry, boxMaterial);

  const cylinderGeometry = new CylinderGeometry(2.5, 3.4, 14, 32);
  const cylinderMaterial = material(0x456a91, 0.48, 0.08);
  const cylinder = new Mesh(cylinderGeometry, cylinderMaterial);
  cylinder.name = "moving-cylinder-caster";
  cylinder.position.set(10, 7, 4);
  cylinder.castShadow = true;
  cylinder.receiveShadow = true;
  scene.add(cylinder);
  resources.push(cylinderGeometry, cylinderMaterial);

  const sphereGeometry = new SphereGeometry(4, 32, 16);
  const sphereMaterial = material(0xb89b51, 0.3, 0.35);
  const sphere = new Mesh(sphereGeometry, sphereMaterial);
  sphere.name = "grazing-bias-sphere";
  sphere.position.set(0, 4, -13);
  sphere.castShadow = true;
  sphere.receiveShadow = true;
  scene.add(sphere);
  resources.push(sphereGeometry, sphereMaterial);

  const alphaGeometry = new PlaneGeometry(10, 12, 16, 16);
  const alphaMaterial = material(0x315b37, 0.82, 0);
  alphaMaterial.side = DoubleSide;
  const alphaWave = sin(positionLocal.x.mul(2.7)).mul(sin(positionLocal.y.mul(3.1)));
  alphaMaterial.opacityNode = step(0, alphaWave);
  alphaMaterial.alphaTest = 0.5;
  const alphaCaster = new Mesh(alphaGeometry, alphaMaterial);
  alphaCaster.name = "alpha-tested-caster";
  alphaCaster.position.set(-20, 6, 10);
  alphaCaster.castShadow = true;
  alphaCaster.receiveShadow = true;
  alphaCaster.layers.enable(PARITY_LAYER);
  scene.add(alphaCaster);
  resources.push(alphaGeometry, alphaMaterial);

  const windTime = uniform(0);
  const windGeometry = new PlaneGeometry(8, 14, 16, 32);
  const windMaterial = material(0x5e7f47, 0.75, 0);
  windMaterial.side = DoubleSide;
  const sharedWindPosition = Fn(() => {
    const rootedHeight = positionLocal.y.add(7).max(0).div(14);
    const lateral = sin(positionLocal.y.mul(0.7).add(windTime))
      .mul(rootedHeight.mul(rootedHeight))
      .mul(1.1);
    return positionLocal.add(vec3(lateral, 0, 0));
  })();
  windMaterial.positionNode = sharedWindPosition;
  windMaterial.castShadowPositionNode = sharedWindPosition;
  windMaterial.receivedShadowPositionNode = null;
  const windCaster = new Mesh(windGeometry, windMaterial);
  windCaster.name = "shared-deformation-wind-caster";
  windCaster.position.set(19, 7, -9);
  windCaster.castShadow = true;
  windCaster.receiveShadow = true;
  windCaster.layers.enable(PARITY_LAYER);
  scene.add(windCaster);
  resources.push(windGeometry, windMaterial);

  const instanceGeometry = new BoxGeometry(1.1, 4, 1.1);
  const instanceMaterial = material(0x755b8f, 0.65, 0.04);
  const instanceCount = 12;
  const instances = new InstancedMesh(instanceGeometry, instanceMaterial, instanceCount);
  instances.name = "instanced-caster-array";
  instances.castShadow = true;
  instances.receiveShadow = true;
  instances.layers.enable(PARITY_LAYER);
  const instanceMatrix = new Matrix4();
  for (let index = 0; index < instanceCount; index += 1) {
    const angle = (index / instanceCount) * Math.PI * 2;
    instanceMatrix.makeTranslation(Math.cos(angle) * 16, 2, Math.sin(angle) * 16);
    instances.setMatrixAt(index, instanceMatrix);
  }
  instances.instanceMatrix.needsUpdate = true;
  scene.add(instances);
  resources.push(instanceGeometry, instanceMaterial);

  const morphGeometry = new SphereGeometry(2.8, 20, 12);
  const basePositions = morphGeometry.attributes.position.array;
  const morphPositions = new Float32Array(basePositions.length);
  for (let offset = 0; offset < basePositions.length; offset += 3) {
    morphPositions[offset] = basePositions[offset] * 1.18;
    morphPositions[offset + 1] = basePositions[offset + 1] * 1.35;
    morphPositions[offset + 2] = basePositions[offset + 2] * 0.82;
  }
  morphGeometry.morphAttributes.position = [
    new Float32BufferAttribute(morphPositions, 3),
  ];
  const morphMaterial = material(0x946052, 0.57, 0.02);
  const morphCaster = new Mesh(morphGeometry, morphMaterial);
  morphCaster.name = "morph-target-caster";
  morphCaster.position.set(4, 3, 16);
  morphCaster.morphTargetInfluences[0] = 0.42;
  morphCaster.castShadow = true;
  morphCaster.receiveShadow = true;
  morphCaster.layers.enable(PARITY_LAYER);
  scene.add(morphCaster);
  resources.push(morphGeometry, morphMaterial);

  const skinGeometry = new CylinderGeometry(1.2, 1.65, 8, 20, 8, true);
  const skinPosition = skinGeometry.attributes.position;
  const skinIndices = new Uint16Array(skinPosition.count * 4);
  const skinWeights = new Float32Array(skinPosition.count * 4);
  for (let index = 0; index < skinPosition.count; index += 1) {
    const blend = Math.min(1, Math.max(0, (skinPosition.getY(index) + 4) / 8));
    const offset = index * 4;
    skinIndices[offset] = 0;
    skinIndices[offset + 1] = 1;
    skinWeights[offset] = 1 - blend;
    skinWeights[offset + 1] = blend;
  }
  skinGeometry.setAttribute(
    "skinIndex",
    new Uint16BufferAttribute(skinIndices, 4),
  );
  skinGeometry.setAttribute(
    "skinWeight",
    new Float32BufferAttribute(skinWeights, 4),
  );
  const skinMaterial = material(0x8b6848, 0.68, 0.01);
  const skinnedCaster = new SkinnedMesh(skinGeometry, skinMaterial);
  skinnedCaster.name = "representative-two-bone-skinned-caster";
  const skinRoot = new Bone();
  skinRoot.name = "skinned-caster-root";
  skinRoot.position.y = -4;
  const skinTip = new Bone();
  skinTip.name = "skinned-caster-tip";
  skinTip.position.y = 8;
  skinRoot.add(skinTip);
  skinnedCaster.add(skinRoot);
  const skeleton = new Skeleton([skinRoot, skinTip]);
  skinnedCaster.bind(skeleton);
  skinnedCaster.position.set(-7, 4, 18);
  skinnedCaster.castShadow = true;
  skinnedCaster.receiveShadow = true;
  skinnedCaster.layers.enable(PARITY_LAYER);
  scene.add(skinnedCaster);
  resources.push(skinGeometry, skinMaterial, skeleton);

  const seededSubjects = [box, sphere, skinnedCaster];
  for (const subject of seededSubjects) {
    subject.userData.shadowSeedBasePosition = subject.position.clone();
  }

  return {
    scene,
    camera,
    light,
    animated: {
      cylinder,
      windTime,
      windCaster,
      morphCaster,
      skinnedCaster,
      skinTip,
    },
    parityCasterClasses: SHADOW_CASTER_CLASSES,
    seededSubjects,
    resources,
  };
}

function material(hex, roughness, metalness) {
  const result = new MeshStandardNodeMaterial();
  result.colorNode = color(hex);
  result.roughnessNode = float(roughness);
  result.metalnessNode = float(metalness);
  result.emissiveNode = color(0x000000);
  return result;
}

function applyFixtureTime(animated, time) {
  animated.cylinder.position.x = 10 + Math.sin(time * 0.7) * 12;
  animated.cylinder.position.z = 4 + Math.cos(time * 0.43) * 6;
  animated.cylinder.rotation.y = time * 0.35;
  animated.cylinder.updateMatrixWorld(true);
  animated.windTime.value = time;
  animated.morphCaster.morphTargetInfluences[0] = 0.5 + 0.35 * Math.sin(time * 0.6);
  animated.skinTip.rotation.z = Math.sin(time * 1.1) * 0.45;
  animated.skinnedCaster.updateMatrixWorld(true);
  animated.skinnedCaster.skeleton.update();
}

function notifyAnimatedCasterBounds(node, animated, version) {
  const notify = (object, radius) => {
    object.getWorldPosition(_casterWorld);
    node.notifyCasterBounds({
      id: object.name,
      version,
      centerWorld: _casterWorld,
      radius,
    });
  };
  notify(animated.cylinder, 8);
  notify(animated.windCaster, 10);
  notify(animated.morphCaster, 5);
  notify(animated.skinnedCaster, 6);
}

function firstDepthTexture(owner) {
  if (owner.architecture === "cached") {
    return selectCachedDiagnosticLevel(owner.node)?.depthTexture ?? null;
  }
  if (owner.architecture === "csm") {
    return owner.node._shadowNodes.find((node) => node.shadowMap)?.shadowMap.depthTexture ?? null;
  }
  if (owner.architecture === "tiled") return owner.node.shadowMap?.depthTexture ?? null;
  return owner.light.shadow.map?.depthTexture ?? null;
}

function selectCachedDiagnosticLevel(node) {
  const resident = node.levels.filter(
    (level) => level.valid && level.depthTexture && level.shadowCamera,
  );
  if (resident.length === 0) return null;
  const representativeHalfWidth = Math.min(
    48,
    resident.at(-1).sampledHalfWidth,
  );
  return resident.find(
    (level) => level.sampledHalfWidth >= representativeHalfWidth,
  ) ?? resident[Math.floor(resident.length / 2)];
}

export function compactAlignedRgbaRows(raw, width, height) {
  const { rowBytes, sourceBytesPerRow } = describeRgbaReadbackLayout(raw, width, height);
  const packedLength = rowBytes * height;
  if (raw.length === packedLength) return new Uint8Array(raw);
  const packed = new Uint8Array(packedLength);
  for (let y = 0; y < height; y += 1) {
    packed.set(
      raw.subarray(y * sourceBytesPerRow, y * sourceBytesPerRow + rowBytes),
      y * rowBytes,
    );
  }
  return packed;
}

export function describeRgbaReadbackLayout(raw, width, height) {
  if (!(raw instanceof Uint8Array)) {
    throw new TypeError(`shadow readback must be Uint8Array, received ${raw?.constructor?.name}`);
  }
  if (!Number.isInteger(width) || width <= 0 || !Number.isInteger(height) || height <= 0) {
    throw new RangeError("shadow readback dimensions must be positive integers");
  }
  const rowBytes = width * 4;
  const bytesPerRow = Math.ceil(rowBytes / 256) * 256;
  let sourceBytesPerRow;
  if (height === 1 || raw.byteLength === rowBytes * height) {
    sourceBytesPerRow = rowBytes;
  } else if (
    raw.byteLength === bytesPerRow * height ||
    raw.byteLength === bytesPerRow * (height - 1) + rowBytes
  ) {
    sourceBytesPerRow = bytesPerRow;
  } else {
    const inferred = (raw.byteLength - rowBytes) / (height - 1);
    if (!Number.isInteger(inferred) || inferred < rowBytes) {
      throw new Error(
        `invalid WebGPU RGBA row layout: length=${raw.byteLength}, rowBytes=${rowBytes}, alignedStride=${bytesPerRow}`,
      );
    }
    sourceBytesPerRow = inferred;
  }
  return { rowBytes, bytesPerRow, sourceBytesPerRow };
}

export { CAMERAS as SHADOW_CAMERAS, MODES as SHADOW_MODES };
