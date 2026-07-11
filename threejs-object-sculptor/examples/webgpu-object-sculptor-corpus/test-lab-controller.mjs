import assert from "node:assert/strict";
import * as THREE from "three/webgpu";

import {
  CORPUS_CAMERA_FOCUS_CONTRACTS,
  CORPUS_DPR_CAPS,
  CORPUS_CONTINUITY_TOKEN,
  CORPUS_RENDER_POLICY,
  CORPUS_RUNTIME_PROFILES,
  CORPUS_SHADOW_POLICIES,
  TARGET_IDS,
  createObjectSculptorCorpusController,
  describeCorpusReadback,
  preserveCorpusReadbackRows,
  resolveCorpusDpr,
  resolveCorpusProjectedBoundsFit,
} from "./lab-controller.js";

assert.deepEqual(CORPUS_DPR_CAPS, { full: 1.5, budgeted: 1.25, minimum: 1 });
assert.equal(CORPUS_CONTINUITY_TOKEN, "active-preview-continuity-v1");
assert.equal(resolveCorpusDpr("full", 3), 1.5);
assert.equal(resolveCorpusDpr("budgeted", 3), 1.25);
assert.equal(resolveCorpusDpr("minimum", 3), 1);
assert.equal(CORPUS_RENDER_POLICY.sceneRendersPerFrame, 1);
assert.equal(CORPUS_RENDER_POLICY.mrt, false);
assert.equal(CORPUS_RENDER_POLICY.postprocessing, false);
assert.equal(CORPUS_RENDER_POLICY.trackTimestamp, false);
assert.deepEqual(CORPUS_RUNTIME_PROFILES, ["correctness", "performance"]);
assert.equal(CORPUS_SHADOW_POLICIES.minimum.mapSize, 256);
assert.equal(CORPUS_SHADOW_POLICIES.minimum.casterLimit, 8);
assert.deepEqual(
  CORPUS_CAMERA_FOCUS_CONTRACTS["ceramic-teapot"].attachment.nodeIds,
  ["spout-root-collar", "lid-joint-pin"],
);

const landscapeFit = resolveCorpusProjectedBoundsFit({
  fovDegrees: 38,
  aspect: 16 / 9,
  direction: [1, 0.6, 1],
  halfExtents: [1, 0.5, 0.4],
});
const portraitFit = resolveCorpusProjectedBoundsFit({
  fovDegrees: 38,
  aspect: 9 / 16,
  direction: [1, 0.6, 1],
  halfExtents: [1, 0.5, 0.4],
});
assert(portraitFit.horizontalHalfFovRadians < portraitFit.verticalHalfFovRadians);
assert.equal(portraitFit.limitingHalfFovRadians, portraitFit.horizontalHalfFovRadians);
assert(portraitFit.distance > landscapeFit.distance, "portrait fitting must retreat for the limiting horizontal FOV");

const oddLayout = describeCorpusReadback(13, 7, "srgb");
assert.deepEqual(oddLayout, {
  width: 13,
  height: 7,
  format: "rgba8unorm",
  bytesPerPixel: 4,
  rowBytes: 52,
  bytesPerRow: 256,
  minimumByteLength: 1588,
  fullyPaddedByteLength: 1792,
  colorManaged: true,
  colorEncoding: "srgb",
  outputColorSpace: "srgb",
});
const compactRows = new Uint8Array(oddLayout.rowBytes * oddLayout.height);
for (let index = 0; index < compactRows.length; index += 1) compactRows[index] = index % 251;
const paddedRows = preserveCorpusReadbackRows(compactRows, oddLayout);
assert.equal(paddedRows.byteLength, oddLayout.fullyPaddedByteLength);
for (let y = 0; y < oddLayout.height; y += 1) {
  assert.deepEqual(
    paddedRows.slice(y * oddLayout.bytesPerRow, y * oddLayout.bytesPerRow + oddLayout.rowBytes),
    compactRows.slice(y * oddLayout.rowBytes, (y + 1) * oddLayout.rowBytes),
  );
}

function createHarness({
  nativeWebGPU = true,
  timestampQuerySupported = false,
  noOpMotion = false,
} = {}) {
  const definitions = new Map([
    ["articulated-desk-lamp", {
      id: "articulated-desk-lamp",
      cameraTarget: [0, 0.4, 0],
      boundsMeters: { width: 0.8, height: 1.1, depth: 0.7 },
      contract: { id: "articulated-desk-lamp" },
    }],
    ["potted-bonsai", {
      id: "potted-bonsai",
      cameraTarget: [0, 1.1, 0],
      boundsMeters: { width: 2.1, height: 2.3, depth: 1.6 },
      contract: { id: "potted-bonsai" },
    }],
    ["ceramic-teapot", {
      id: "ceramic-teapot",
      cameraTarget: [0.02, 0.04, 0],
      boundsMeters: { width: 0.7, height: 0.4, depth: 0.4 },
      contract: { id: "ceramic-teapot" },
    }],
  ]);
  const factoryCalls = [];
  const targetDisposals = new Map();
  const targets = [];
  const continuityHistory = new Map();
  let targetLiveCount = 0;
  let peakTargetLiveCount = 0;
  let controlsDisposals = 0;
  let failConfigurationFor = null;
  let configurationFailuresRemaining = 0;
  let rendererOptions = null;

  function continuityRecord(subjectId, options) {
    const registryKey = JSON.stringify([subjectId, options.instanceId]);
    const effectiveToken = JSON.stringify({
      schema: "fake-subject-continuity-v1",
      baseToken: options.continuityToken,
      subjectId,
      sourceRevision: `${subjectId}-source-v1`,
      seed: options.seed,
    });
    const previous = continuityHistory.get(registryKey);
    const preserved = previous?.effectiveToken === effectiveToken;
    const generation = previous ? (preserved ? previous.generation : previous.generation + 1) : 1;
    const status = previous
      ? (preserved ? "explicit-continuity-preserved" : "explicit-continuity-changed-new-generation")
      : "explicit-instance-established";
    continuityHistory.set(registryKey, { effectiveToken, generation });
    return {
      generation,
      status,
      effectiveToken,
      previousGeneration: previous?.generation ?? null,
    };
  }

  const renderer = {
    backend: { isWebGPUBackend: nativeWebGPU },
    shadowMap: {},
    domElement: { width: 1, height: 1 },
    info: {
      render: { calls: 0, triangles: 0, points: 0, lines: 0 },
      memory: { geometries: 0, textures: 0 },
    },
    pixelRatio: 1,
    currentRenderTarget: null,
    initCalls: 0,
    renderCalls: 0,
    disposeCalls: 0,
    failRender: false,
    async init() {
      this.initCalls += 1;
    },
    setPixelRatio(value) {
      this.pixelRatio = value;
    },
    setSize(width, height) {
      this.domElement.width = Math.floor(width * this.pixelRatio);
      this.domElement.height = Math.floor(height * this.pixelRatio);
    },
    async render() {
      if (this.failRender) throw new Error("synthetic native render failure");
      this.renderCalls += 1;
      this.info.render.calls = this.renderCalls;
    },
    getRenderTarget() {
      return this.currentRenderTarget;
    },
    setRenderTarget(value) {
      this.currentRenderTarget = value;
    },
    async readRenderTargetPixelsAsync(target) {
      const pixels = new Uint8Array(target.width * target.height * 4);
      pixels.fill(127);
      return pixels;
    },
    async dispose() {
      this.disposeCalls += 1;
    },
  };

  function createTarget(subjectId, options) {
    factoryCalls.push({ subjectId, options: { ...options } });
    const continuity = continuityRecord(subjectId, options);
    targetLiveCount += 1;
    peakTargetLiveCount = Math.max(peakTargetLiveCount, targetLiveCount);
    const root = new THREE.Group();
    root.userData.subjectId = subjectId;
    const socket = new THREE.Object3D();
    socket.userData.sculptId = "inspection-socket";
    socket.position.set(0.1, 0.2, 0.3);
    root.add(socket);
    const runtime = {
      subjectId,
      instanceId: options.instanceId,
      instanceGeneration: continuity.generation,
      runtimeId: Object.freeze({
        namespace: `${subjectId}.runtime`,
        localId: options.instanceId,
        generation: continuity.generation,
      }),
      continuityToken: continuity.effectiveToken,
      continuityStatus: continuity.status,
      continuity: Object.freeze({
        policy: "same effective token preserves generation; changed seed increments",
        status: continuity.status,
        token: continuity.effectiveToken,
        tokenProvided: true,
        generation: continuity.generation,
        previousGeneration: continuity.previousGeneration,
      }),
      subjectContinuity: Object.freeze({
        baseContinuityToken: options.continuityToken,
        effectiveContinuityToken: continuity.effectiveToken,
        sourceRevision: `${subjectId}-source-v1`,
        seed: options.seed,
        visualTierExcluded: true,
      }),
      tier: options.tier,
      seed: options.seed,
      root,
      mode: "final",
      nodes: new Map([["root", root], ["inspection-socket", socket]]),
      meshes: new Map(),
      sockets: new Map([["inspection-socket", socket]]),
      colliders: new Map([
        ["body", { recordType: "ColliderConstructionInput", id: "body" }],
        ["detail", { recordType: "ColliderConstructionInput", id: "detail" }],
      ]),
      physicsMaterials: new Map([["surface", { recordType: "PhysicsMaterialBindingInput", id: "surface" }]]),
      destructionGroups: new Map([["shell", ["root"]]]),
      setTimeCalls: [],
      setModeCalls: [],
    };
    const target = {
      root,
      runtime,
      contract: definitions.get(subjectId).contract,
      async setMode(nextMode) {
        runtime.setModeCalls.push(nextMode);
        if (failConfigurationFor === subjectId && configurationFailuresRemaining > 0) {
          configurationFailuresRemaining -= 1;
          throw new Error(`synthetic ${subjectId} configuration failure`);
        }
        runtime.mode = nextMode;
      },
      async setTime(seconds, animate) {
        runtime.setTimeCalls.push({ seconds, animate });
        if (!noOpMotion) socket.rotation.z = animate ? Math.sin(seconds * 1.1) * 0.1 : 0;
        root.updateMatrixWorld(true);
      },
      async dispose() {
        const previous = targetDisposals.get(target) ?? 0;
        assert.equal(previous, 0, "each target resource must be disposed exactly once");
        targetDisposals.set(target, previous + 1);
        targetLiveCount -= 1;
      },
    };
    targets.push(target);
    return target;
  }

  const dependencies = {
    createRenderer: (options) => {
      rendererOptions = { ...options };
      return renderer;
    },
    createControls: () => ({
      target: new THREE.Vector3(),
      update() {},
      dispose() {
        controlsDisposals += 1;
      },
    }),
    createTarget,
    getTargetDefinition(id) {
      const definition = definitions.get(id);
      if (!definition) throw new RangeError(`Unknown fake target "${id}"`);
      return definition;
    },
    summarizeTarget(root) {
      const target = targets.find((entry) => entry.root === root);
      const tierScale = { full: 3, budgeted: 2, minimum: 1 }[target.runtime.tier];
      return {
        subjectId: target.runtime.subjectId,
        instanceId: target.runtime.instanceId,
        instanceGeneration: target.runtime.instanceGeneration,
        continuityStatus: target.runtime.continuityStatus,
        tier: target.runtime.tier,
        seed: target.runtime.seed,
        mode: target.runtime.mode,
        nodes: target.runtime.nodes.size,
        meshes: 4 * tierScale,
        meshObjects: 4 * tierScale,
        renderItems: 5 * tierScale,
        triangles: 120 * tierScale,
        colliders: target.runtime.colliders.size,
        sockets: target.runtime.sockets.size,
        physicsMaterials: target.runtime.physicsMaterials.size,
        destructionGroups: target.runtime.destructionGroups.size,
      };
    },
    async resolvePreInitCapabilities({ runtimeProfile }) {
      return {
        source: "synthetic-exact-pre-init-capability",
        adapterAvailable: runtimeProfile === "performance",
        timestampQuerySupported: runtimeProfile === "performance" ? timestampQuerySupported : null,
      };
    },
  };

  return {
    dependencies,
    renderer,
    factoryCalls,
    targetDisposals,
    targets,
    get targetLiveCount() {
      return targetLiveCount;
    },
    get peakTargetLiveCount() {
      return peakTargetLiveCount;
    },
    get controlsDisposals() {
      return controlsDisposals;
    },
    get rendererOptions() {
      return rendererOptions;
    },
    failConfigurationFor(subjectId, times = 1) {
      failConfigurationFor = subjectId;
      configurationFailuresRemaining = times;
    },
    clearConfigurationFailure() {
      failConfigurationFor = null;
      configurationFailuresRemaining = 0;
    },
  };
}

assert.deepEqual(TARGET_IDS, ["articulated-desk-lamp", "potted-bonsai", "ceramic-teapot"]);

{
  const harness = createHarness();
  const controller = await createObjectSculptorCorpusController({
    canvas: {},
    width: 641,
    height: 359,
    dpr: 3,
    subjectId: "ceramic-teapot",
    mode: "materials",
    tier: "minimum",
    camera: "profile",
    seed: 7,
    dependencies: harness.dependencies,
  });

  assert.deepEqual(harness.factoryCalls, [{
    subjectId: "ceramic-teapot",
    options: {
      tier: "minimum",
      seed: 7,
      instanceId: "active-preview",
      continuityToken: "active-preview-continuity-v1",
    },
  }], "initial route state must drive the first and only target allocation");
  let metrics = controller.getMetrics();
  assert.equal(metrics.subjectId, "ceramic-teapot");
  assert.equal(metrics.mode, "materials");
  assert.equal(metrics.tier, "minimum");
  assert.equal(metrics.camera, "profile");
  assert.equal(metrics.dpr, 1);
  assert.equal(metrics.backendKind, "webgpu");
  assert.equal(metrics.nativeWebGPU, true);
  assert.equal(metrics.initialized, true);
  assert.equal(metrics.firstFrameCompleted, false);
  assert.equal(metrics.targetAllocations, 1);
  assert.equal(metrics.targetDisposals, 0);
  assert.equal(metrics.liveTargetCount, 1);
  assert.equal(metrics.peakLiveTargetCount, 1);
  assert.equal(metrics.physicsHandoffCount, 2);
  assert.equal(metrics.physicsHandoffStatus, "blocked-authoring-inputs-only");
  assert.equal(metrics.frameErrorCount, 0);
  assert.equal(metrics.lifecycleErrorCount, 0);
  assert.equal(metrics.runtimeProfile, "correctness");
  assert.equal(metrics.timestampQueriesRequested, false);
  assert.equal(metrics.timingMethod, "correctness-profile-no-timestamp-query");
  assert.equal(metrics.motionWitness.status, "frozen-authored-pose");
  assert.equal(metrics.cameraFraming.camera, "profile");
  assert.equal(metrics.cameraFraming.focusSource, "definition-bounds-fallback");
  assert.equal(metrics.lightShadowPolicy.mapSize, 256);
  assert.equal(metrics.lightShadowPolicy.filter, "basic");
  assert.equal(metrics.lightShadowPolicy.antialiasRequestedAtRendererInit, false);
  assert.equal(harness.rendererOptions.antialias, false);
  assert.equal(harness.rendererOptions.trackTimestamp, false);
  assert.equal(metrics.rendererInfo.render.calls, 0);
  assert.equal(controller.describePipeline().sceneRendersPerFrame, 1);
  assert.deepEqual(controller.describePipeline().passes, ["forward-scene"]);
  assert.equal(controller.describePipeline().mrt, false);
  assert.equal(controller.describePipeline().postprocessing, false);
  assert.deepEqual(controller.describeResources().renderTargets, [], "live initialization must not allocate capture resources");

  assert.equal(await controller.setSubject("ceramic-teapot"), false);
  assert.equal(await controller.setMode("materials"), false);
  assert.equal(await controller.setTier("minimum"), false);
  assert.equal(await controller.setCamera("profile"), false);
  assert.equal(await controller.setSeed(7), false);
  assert.equal(harness.factoryCalls.length, 1, "same-state setters must not allocate or discard a target");

  await controller.renderOnce();
  metrics = controller.getMetrics();
  assert.equal(metrics.firstFrameCompleted, true);
  assert.equal(metrics.renderSubmissions, 1);
  assert.equal(metrics.completedFrames, 1);
  assert.equal(metrics.rendererInfo.render.calls, 1);

  assert.equal(await controller.setMode("action-ready"), true);
  await controller.step(0.25);
  assert.deepEqual(harness.targets.at(-1).runtime.setTimeCalls.at(-1), { seconds: 0.25, animate: true });
  assert.equal(controller.getMetrics().time, 0.25);
  assert.equal(controller.getMetrics().motionWitness.status, "measured-live-pose-delta");
  assert(controller.getMetrics().motionWitness.activeChannelCount > 0);
  assert(controller.getMetrics().motionWitness.maxRotationDeltaRadians > 0);
  assert.equal(await controller.resetHistory(), true);
  assert.deepEqual(harness.targets.at(-1).runtime.setTimeCalls.at(-1), { seconds: 0, animate: true });
  assert.equal(controller.getMetrics().motionWitness.status, "awaiting-pose-delta");

  const beforeTierRebuild = controller.getRuntimeContract();
  assert.equal(beforeTierRebuild.instanceId, "active-preview");
  assert.equal(beforeTierRebuild.instanceGeneration, 1);
  assert.equal(beforeTierRebuild.continuityStatus, "explicit-instance-established");
  assert.equal(beforeTierRebuild.subjectContinuity.baseContinuityToken, CORPUS_CONTINUITY_TOKEN);
  assert.equal(beforeTierRebuild.subjectContinuity.visualTierExcluded, true);

  assert.equal(await controller.setTier("full"), true);
  metrics = controller.getMetrics();
  assert.equal(metrics.tier, "full");
  assert.equal(metrics.dpr, 1.5);
  assert.equal(metrics.targetAllocations, 2);
  assert.equal(metrics.targetDisposals, 1);
  assert.equal(metrics.liveTargetCount, 1);
  assert.equal(metrics.peakLiveTargetCount, 1, "same-subject stable instance replacement must not overlap live resources");
  assert.equal(metrics.lightShadowPolicy.mapSize, 1024);
  assert.equal(metrics.lightShadowPolicy.filter, "pcf-soft");
  assert.equal(metrics.lightShadowPolicy.antialiasMatchesCurrentTier, false);
  assert.equal(metrics.lightShadowPolicy.rendererRecreationRequiredForExactAntialiasTier, true);
  assert.equal(harness.targetDisposals.get(harness.targets[0]), 1);
  const afterTierRebuild = controller.getRuntimeContract();
  assert.equal(afterTierRebuild.instanceId, beforeTierRebuild.instanceId);
  assert.equal(afterTierRebuild.instanceGeneration, beforeTierRebuild.instanceGeneration);
  assert.deepEqual(afterTierRebuild.runtimeId, beforeTierRebuild.runtimeId, "visual tier rebuild must preserve the generation-qualified runtime ID");
  assert.equal(afterTierRebuild.continuityStatus, "explicit-continuity-preserved");
  assert.equal(
    afterTierRebuild.subjectContinuity.effectiveContinuityToken,
    beforeTierRebuild.subjectContinuity.effectiveContinuityToken,
    "factory effective continuity must exclude visual tier",
  );

  assert.equal(await controller.setSeed(8), true);
  metrics = controller.getMetrics();
  assert.equal(metrics.seed, 8);
  assert.equal(metrics.targetAllocations, 3);
  assert.equal(metrics.targetDisposals, 2);
  const afterSeedRebuild = controller.getRuntimeContract();
  assert.equal(afterSeedRebuild.instanceId, beforeTierRebuild.instanceId);
  assert.equal(afterSeedRebuild.instanceGeneration, beforeTierRebuild.instanceGeneration + 1);
  assert.equal(afterSeedRebuild.runtimeId.generation, beforeTierRebuild.runtimeId.generation + 1);
  assert.equal(afterSeedRebuild.continuityStatus, "explicit-continuity-changed-new-generation");
  assert.notEqual(
    afterSeedRebuild.subjectContinuity.effectiveContinuityToken,
    beforeTierRebuild.subjectContinuity.effectiveContinuityToken,
    "seed changes must change the factory-composed continuity signature",
  );

  assert.equal(await controller.setSubject("potted-bonsai"), true);
  metrics = controller.getMetrics();
  assert.equal(metrics.subjectId, "potted-bonsai");
  assert.equal(metrics.targetAllocations, 4);
  assert.equal(metrics.targetDisposals, 3);
  assert.equal(metrics.liveTargetCount, 1);
  assert.equal(metrics.peakLiveTargetCount, 2, "cross-subject transaction may hold old and candidate targets until commit");
  assert.equal(harness.peakTargetLiveCount, 2);

  harness.failConfigurationFor("articulated-desk-lamp");
  await assert.rejects(
    controller.setSubject("articulated-desk-lamp"),
    /synthetic articulated-desk-lamp configuration failure/,
  );
  harness.clearConfigurationFailure();
  metrics = controller.getMetrics();
  assert.equal(metrics.subjectId, "potted-bonsai", "failed cross-subject configuration must preserve the committed target");
  assert.equal(metrics.liveTargetCount, 1);
  assert.equal(harness.targetLiveCount, 1);
  assert.equal(harness.targetDisposals.get(harness.targets.at(-1)), 1, "failed candidate must be disposed exactly once");

  harness.failConfigurationFor("potted-bonsai", 1);
  await assert.rejects(
    controller.setTier("minimum"),
    /synthetic potted-bonsai configuration failure/,
  );
  harness.clearConfigurationFailure();
  metrics = controller.getMetrics();
  assert.equal(metrics.subjectId, "potted-bonsai");
  assert.equal(metrics.tier, "full", "failed same-subject tier rebuild must restore the committed tier");
  assert.equal(metrics.rollbackRebuildCount, 1);
  assert.equal(metrics.liveTargetCount, 1);
  assert.equal(harness.targetLiveCount, 1);

  const landscapeCameraDistance = controller.getMetrics().cameraFraming.framingDistanceMeters;
  await controller.resize(7, 13, 1);
  const portraitCameraFraming = controller.getMetrics().cameraFraming;
  assert.equal(portraitCameraFraming.aspect, 7 / 13);
  assert(portraitCameraFraming.framingDistanceMeters > landscapeCameraDistance, "portrait resize must reframe against horizontal FOV");
  await controller.resize(13, 7, 1);
  const capture = await controller.capturePixels("presentation");
  assert.equal(capture.format, "rgba8unorm");
  assert.equal(capture.outputColorSpace, "srgb");
  assert.equal(capture.colorEncoding, "srgb");
  assert.equal(capture.nativeWebGPU, true);
  assert.equal(capture.rowBytes, 52);
  assert.equal(capture.bytesPerRow, 256);
  assert.equal(capture.sourceBytesPerRow, 256);
  assert.equal(capture.readbackSourceBytesPerRow, 52);
  assert.equal(capture.sourceByteLength, 1792);
  assert.equal(capture.readbackSourceByteLength, 364);
  assert.equal(capture.pixels.length, 1792);
  assert.equal(controller.describeResources().renderTargets[0].allocation, "lazy-capture-only");

  const runtimeContract = controller.getRuntimeContract();
  assert.equal(runtimeContract.subjectId, "potted-bonsai");
  assert.equal(runtimeContract.instanceId, "active-preview");
  assert.equal(runtimeContract.instanceGeneration, 1);
  assert.equal(runtimeContract.runtimeId.generation, runtimeContract.instanceGeneration);
  assert.equal(runtimeContract.continuity.generation, runtimeContract.instanceGeneration);
  assert.equal(runtimeContract.continuity.tokenProvided, true);
  assert.equal(runtimeContract.subjectContinuity.baseContinuityToken, CORPUS_CONTINUITY_TOKEN);
  assert.equal(runtimeContract.subjectContinuity.visualTierExcluded, true);
  assert.equal(runtimeContract.continuityEvidence.baseToken, CORPUS_CONTINUITY_TOKEN);
  assert.equal(runtimeContract.continuityEvidence.effectiveToken, runtimeContract.continuity.token);
  assert.equal(runtimeContract.continuityEvidence.generation, runtimeContract.instanceGeneration);
  assert.equal(runtimeContract.continuityEvidence.visualTierExcluded, true);
  assert.deepEqual(runtimeContract.nodeIds, ["inspection-socket", "root"]);
  assert.deepEqual(runtimeContract.socketIds, ["inspection-socket"]);
  assert.deepEqual(runtimeContract.colliderIds, ["body", "detail"]);
  assert.deepEqual(runtimeContract.destructionGroupIds, ["shell"]);
  assert.deepEqual(runtimeContract.protectedNodeIds, runtimeContract.nodeIds);
  assert.deepEqual(runtimeContract.protectedSocketIds, runtimeContract.socketIds);
  assert.deepEqual(runtimeContract.protectedColliderIds, runtimeContract.colliderIds);
  assert.deepEqual(runtimeContract.protectedDestructionGroupIds, runtimeContract.destructionGroupIds);
  assert.equal(runtimeContract.colliderConstructionInputs.length, 2);
  assert.equal(runtimeContract.physicsAuthority, "authoring-input-only");
  assert.equal(runtimeContract.motionWitness.status, "awaiting-pose-delta");
  assert.equal(typeof controller.drain, "function");
  await controller.drain();

  harness.renderer.failRender = true;
  await assert.rejects(controller.renderOnce(), /synthetic native render failure/);
  assert.equal(controller.getMetrics().lastFrameError, "synthetic native render failure");
  assert.equal(controller.getMetrics().frameErrorCount, 1);
  harness.renderer.failRender = false;

  assert.equal(await controller.dispose(), true);
  assert.equal(await controller.dispose(), false);
  assert.equal(harness.targetLiveCount, 0);
  assert.equal(harness.renderer.disposeCalls, 1);
  assert.equal(harness.controlsDisposals, 1);
}

{
  const harness = createHarness({ timestampQuerySupported: true });
  const controller = await createObjectSculptorCorpusController({
    canvas: {},
    subjectId: "articulated-desk-lamp",
    mode: "action-ready",
    tier: "budgeted",
    camera: "attachment",
    profile: "performance",
    timestampQueriesRequired: true,
    dependencies: harness.dependencies,
  });
  const metrics = controller.getMetrics();
  assert.equal(harness.rendererOptions.trackTimestamp, true);
  assert.equal(metrics.runtimeProfile, "performance");
  assert.equal(metrics.preInitCapabilities.timestampQuerySupported, true);
  assert.equal(metrics.timestampQueriesRequired, true);
  assert.equal(metrics.timestampQueriesRequested, true);
  assert.match(metrics.timingMethod, /timestamp-query-requested/);
  assert.equal(metrics.sustainedGpuTimingAvailable, false);
  assert.equal(controller.describePipeline().timingEvidenceStatus, "requested-awaiting-renderer-device-and-sustained-evidence");
  assert.equal(controller.getMetrics().cameraFraming.focusSource, "definition-bounds-fallback");
  assert.deepEqual(
    controller.getMetrics().cameraFraming.missingNodeIds,
    [...CORPUS_CAMERA_FOCUS_CONTRACTS["articulated-desk-lamp"].attachment.nodeIds],
  );
  await controller.dispose();
}

{
  const harness = createHarness({ timestampQuerySupported: false });
  const controller = await createObjectSculptorCorpusController({
    canvas: {},
    subjectId: "potted-bonsai",
    runtimeProfile: "performance",
    dependencies: harness.dependencies,
  });
  assert.equal(harness.rendererOptions.trackTimestamp, false);
  assert.equal(controller.getMetrics().timestampQueriesRequested, false);
  assert.match(controller.getMetrics().timingMethod, /no-gpu-duration/);
  await controller.dispose();
}

{
  const harness = createHarness({ timestampQuerySupported: false });
  await assert.rejects(
    createObjectSculptorCorpusController({
      canvas: {},
      subjectId: "potted-bonsai",
      runtimeProfile: "performance",
      timestampQueriesRequired: true,
      dependencies: harness.dependencies,
    }),
    /requires WebGPU timestamp-query support/,
  );
  assert.equal(harness.renderer.initCalls, 0, "required timestamp capability failure must occur before renderer initialization");
}

{
  const harness = createHarness({ noOpMotion: true });
  const controller = await createObjectSculptorCorpusController({
    canvas: {},
    subjectId: "potted-bonsai",
    mode: "action-ready",
    dependencies: harness.dependencies,
  });
  await assert.rejects(
    controller.step(0.25),
    /no measured rest-to-current transform delta/,
    "a no-op action-ready target must fail the runtime motion witness",
  );
  assert.equal(controller.getMetrics().time, 0);
  assert.equal(controller.getMetrics().motionWitness.status, "awaiting-pose-delta");
  await controller.dispose();
}

{
  const harness = createHarness();
  let releaseRender;
  let enterRender;
  const renderEntered = new Promise((resolve) => {
    enterRender = resolve;
  });
  const renderGate = new Promise((resolve) => {
    releaseRender = resolve;
  });
  harness.renderer.render = async () => {
    enterRender();
    await renderGate;
    harness.renderer.renderCalls += 1;
  };
  const controller = await createObjectSculptorCorpusController({
    canvas: {},
    subjectId: "ceramic-teapot",
    dependencies: harness.dependencies,
  });
  const renderPromise = controller.renderOnce();
  await renderEntered;
  const disposePromise = controller.dispose();
  assert.equal(harness.renderer.disposeCalls, 0, "dispose must wait for the in-flight render lane");
  await assert.rejects(controller.setCamera("attachment"), /controller is closing/);
  releaseRender();
  await renderPromise;
  assert.equal(await disposePromise, true);
  assert.equal(harness.renderer.disposeCalls, 1);
  assert.equal(harness.targetLiveCount, 0);
}

{
  const harness = createHarness();
  await assert.rejects(
    createObjectSculptorCorpusController({
      canvas: {},
      runtimeProfile: "unknown",
      dependencies: harness.dependencies,
    }),
    /Unknown corpus runtime profile/,
  );
}

{
  const harness = createHarness({ nativeWebGPU: false });
  await assert.rejects(
    createObjectSculptorCorpusController({
      canvas: {},
      subjectId: "potted-bonsai",
      mode: "action-ready",
      tier: "budgeted",
      camera: "design",
      dependencies: harness.dependencies,
    }),
    /Native WebGPU is required/,
  );
  assert.equal(harness.factoryCalls.length, 0, "backend failure must occur before any target allocation");
  assert.equal(harness.renderer.disposeCalls, 1);
}

console.log(JSON.stringify({
  ok: true,
  lifecycleCases: [
    "initial-state-before-allocation",
    "same-state-idempotence",
    "stable-instance-tier-rebuild",
    "tier-continuity-generation-preserved",
    "seed-continuity-generation-incremented",
    "cross-subject-transaction",
    "same-subject-reconstructive-rollback",
    "failed-candidate-disposal",
    "one-render-submission",
    "aligned-native-readback",
    "aspect-safe-semantic-camera-framing",
    "measured-motion-witness-and-no-op-negative-control",
    "tiered-shadow-and-antialias-policy",
    "pre-init-correctness-and-performance-profiles",
    "serialized-controller-close-drain",
    "native-backend-failure",
  ],
}, null, 2));
