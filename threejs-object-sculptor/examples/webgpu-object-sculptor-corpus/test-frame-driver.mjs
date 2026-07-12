import assert from "node:assert/strict";

import {
  CORPUS_PERFORMANCE_EVIDENCE_SCHEMA_VERSION,
  CORPUS_PERFORMANCE_EVIDENCE_LIMITS,
  CORPUS_PERFORMANCE_IDENTITY_SCHEMA_VERSION,
  CORPUS_CADENCE_WINDOW_LIMITS,
  CORPUS_ROUTE_LOCKED,
  CORPUS_ROUTE_LOCK_STATE,
  createObjectSculptorCorpusPerformanceIdentity,
  createObjectSculptorCorpusFrameDriver,
  objectSculptorCorpusFrameOwner,
  resolveCorpusFrameDeltaSeconds,
  settleCorpusControlAction,
  validateObjectSculptorCorpusPerformanceIdentity,
} from "./frame-driver.js";

const SOURCE_CLOSURE_HASH = "a".repeat(64);
const BUILD_REVISION = `source-sha256:${SOURCE_CLOSURE_HASH}`;
const BROWSER_IDENTITY = Object.freeze({
  name: "Chromium",
  version: "test-1",
  userAgent: "Object Sculptor frame-driver test Chromium",
  platform: "test-platform",
  automationSurface: "codex-in-app-browser",
});
const CAPTURE_SESSION = Object.freeze({
  schemaVersion: "object-sculptor-physical-performance-session-v1",
  profile: "performance",
  automationSurface: "codex-in-app-browser",
  sourceClosureHash: SOURCE_CLOSURE_HASH,
  buildRevision: BUILD_REVISION,
  routeHref: "https://threejs-skills.com/demos/webgpu-object-sculptor-corpus/",
  sessionId: "test-physical-performance-session",
  startedAt: "2026-07-12T12:00:00.000Z",
  installedAtDocumentReadyState: "loading",
});
const ADAPTER_IDENTITY = Object.freeze({
  adapterClass: "hardware",
  name: "Test WebGPU Adapter",
  identitySource: "test-renderer-device-fixture",
  details: Object.freeze({ vendor: "test-vendor", architecture: "test-architecture" }),
});

assert.equal(objectSculptorCorpusFrameOwner(""), "live-page");
assert.equal(objectSculptorCorpusFrameOwner("?subject=potted-bonsai"), "live-page");
assert.equal(objectSculptorCorpusFrameOwner("?capture=1&subject=ceramic-teapot"), "capture-harness");
assert.equal(objectSculptorCorpusFrameOwner("?capture=0"), "live-page");
for (const invalidSearch of [
  "?capture=0&capture=1",
  "?capture=1&capture=0",
  "?capture=1&capture=1",
  "?capture=0&capture=0",
  "?capture=",
  "?capture=2",
  "?capture=true",
]) {
  assert.throws(
    () => objectSculptorCorpusFrameOwner(invalidSearch),
    /capture frame ownership|Unknown capture frame ownership/,
    `capture ownership must fail closed for ${invalidSearch}`,
  );
}

assert.equal(resolveCorpusFrameDeltaSeconds(99, 100), 0);
assert.equal(resolveCorpusFrameDeltaSeconds(116, 100), 0.016);
assert.equal(resolveCorpusFrameDeltaSeconds(600, 100), 0.1);
assert.equal(resolveCorpusFrameDeltaSeconds(600, 100, 0.05), 0.05);
assert.throws(() => resolveCorpusFrameDeltaSeconds(Number.NaN, 100), /timestamps must be finite/);
assert.throws(() => resolveCorpusFrameDeltaSeconds(100, 90, 0), /cap must be finite and positive/);

function makeMetrics(overrides = {}) {
  return {
    subjectId: "potted-bonsai",
    mode: "action-ready",
    tier: "budgeted",
    camera: "design",
    seed: 1,
    time: 0,
    stepCount: 0,
    stateMutationCount: 0,
    resourceTransitionCount: 6,
    rebuildCount: 1,
    dpr: 1,
    viewport: {
      cssWidth: 1280,
      cssHeight: 800,
      requestedDpr: 1,
      appliedDpr: 1,
      drawingBufferWidth: 1280,
      drawingBufferHeight: 800,
    },
    cameraFraming: {
      camera: "design",
      actualPose: {
        positionMeters: [1, 1, 1],
        quaternion: [0, 0, 0, 1],
        controlsTargetMeters: [0, 0, 0],
        fovDegrees: 38,
        aspect: 1.6,
        nearMeters: 0.01,
        farMeters: 100,
      },
    },
    cameraInteractionEnabled: false,
    runtimeProfile: "performance",
    performanceTimestampMode: "auto",
    backendKind: "webgpu",
    nativeWebGPU: true,
    threeRevision: "185",
    timestampQueriesRequired: true,
    timestampQueriesActive: true,
    gpuTimestampResolveAttempts: 0,
    gpuTimestampResolveFailures: 0,
    rendererBackendEvidence: {
      backendType: "WebGPUBackend",
      deviceType: "GPUDevice",
      deviceLabel: "test-device",
      deviceIdentitySource: "renderer.backend.device-after-init",
      deviceIdentityVerified: true,
      timestampQueryFeatureOnActualDevice: true,
      backendTimestampTrackingActive: true,
    },
    rendererDeviceGeneration: 1,
    deviceLossGeneration: 0,
    rendererDeviceStatus: "active",
    rendererDeviceIdentityStillCurrent: true,
    performanceAdapterIdentityStatus: "verified-exact-renderer-device-binding",
    performanceAdapterIdentity: ADAPTER_IDENTITY,
    deviceErrorCount: 0,
    completedFrames: 0,
    renderSubmissions: 0,
    firstFrameCompleted: false,
    frameErrorCount: 0,
    lifecycleErrorCount: 0,
    acceptingControllerOperations: true,
    lifecycleAcceptanceStatus: "provisional-no-uncertain-teardown",
    ...overrides,
  };
}

function performanceIdentityFor(controller, lane, overrides = {}) {
  return createObjectSculptorCorpusPerformanceIdentity({
    lane,
    sourceClosureHash: SOURCE_CLOSURE_HASH,
    buildRevision: BUILD_REVISION,
    browser: BROWSER_IDENTITY,
    captureSession: CAPTURE_SESSION,
    controller,
    ...overrides,
  });
}

function makeController(overrides = {}, initialMetricsOverrides = {}) {
  let metrics = makeMetrics(initialMetricsOverrides);
  let gpuSampleOrdinal = 0;
  return {
    async ready() {},
    async setSubject(subjectId) {
      const changed = metrics.subjectId !== subjectId;
      metrics = { ...metrics, subjectId };
      return changed;
    },
    async setScenario(subjectId) {
      return this.setSubject(subjectId);
    },
    async setMode(mode) {
      const changed = metrics.mode !== mode;
      metrics = { ...metrics, mode };
      return changed;
    },
    async setTier(tier) {
      const changed = metrics.tier !== tier;
      metrics = { ...metrics, tier };
      return changed;
    },
    async setSeed() {
      return true;
    },
    async setCamera(camera) {
      const changed = metrics.camera !== camera;
      metrics = { ...metrics, camera };
      return changed;
    },
    async setTime(time) {
      const changed = metrics.time !== time;
      metrics = {
        ...metrics,
        time,
        stateMutationCount: metrics.stateMutationCount + (changed ? 1 : 0),
      };
      return changed;
    },
    async step() {},
    async resetHistory() {
      const changed = metrics.time !== 0;
      metrics = {
        ...metrics,
        time: 0,
        stateMutationCount: metrics.stateMutationCount + (changed ? 1 : 0),
      };
      return changed;
    },
    async resize(width = 1280, height = 800, requestedDpr = 1) {
      const appliedDpr = requestedDpr;
      metrics = {
        ...metrics,
        dpr: appliedDpr,
        viewport: {
          cssWidth: width,
          cssHeight: height,
          requestedDpr,
          appliedDpr,
          drawingBufferWidth: Math.floor(width * appliedDpr),
          drawingBufferHeight: Math.floor(height * appliedDpr),
        },
        cameraFraming: {
          ...metrics.cameraFraming,
          actualPose: {
            ...metrics.cameraFraming.actualPose,
            aspect: width / height,
          },
        },
      };
      return true;
    },
    async renderOnce() {
      metrics = {
        ...metrics,
        firstFrameCompleted: true,
        completedFrames: metrics.completedFrames + 1,
        renderSubmissions: metrics.renderSubmissions + 1,
      };
    },
    async resolveGpuTimestampSample() {
      gpuSampleOrdinal += 1;
      return {
        schemaVersion: "object-sculptor-gpu-timestamp-sample-v1",
        status: "measured",
        scope: "render",
        timingSource: "renderer.resolveTimestampsAsync(THREE.TimestampQuery.RENDER)",
        gpuMs: 1.25,
        resolveOverheadMs: 0.15,
        rendererDeviceGeneration: 1,
        deviceLossGeneration: 0,
        frameOrdinal: metrics.completedFrames,
        submissionOrdinal: metrics.renderSubmissions,
        coveredSubmissionCount: 1,
        renderPhase: "presentation-forward-scene",
        sampleOrdinal: gpuSampleOrdinal,
        subjectId: metrics.subjectId,
        tier: metrics.tier,
        mode: metrics.mode,
        seed: 1,
        queryPoolEvidence: {
          schemaVersion: "three-webgpu-timestamp-freshness-v1",
          freshnessStatus: "verified-current-pending-frame-resolved",
          evidenceSurface: "renderer.backend.timestampQueryPool.render",
          publicApiFreshnessProvable: false,
          threeRevision: "185",
          poolType: "WebGPUTimestampQueryPool",
          pendingContextIds: [`r:${gpuSampleOrdinal}:1:f${gpuSampleOrdinal}`],
          pendingFrameIds: [gpuSampleOrdinal],
          resolvedFrameIds: [gpuSampleOrdinal],
          resolvedContextDurationsMs: [1.25],
          pendingContextCount: 1,
          pendingQueryCount: 2,
          currentQueryIndexBefore: 2,
          currentQueryIndexAfter: 0,
          lastValueBefore: 0,
          lastValueAfter: 1.25,
          resultBufferMapStateBefore: "unmapped",
          resultBufferMapStateAfter: "unmapped",
        },
      };
    },
    async capturePixels() {
      return { pixels: [] };
    },
    getRuntimeContract: () => ({ subjectId: metrics.subjectId }),
    getMetrics: () => metrics,
    describePipeline: () => ({
      owner: "WebGPURenderer",
      sceneRendersPerFrame: 1,
      passes: ["forward-scene"],
      mrt: false,
      postprocessing: false,
      toneMapping: "ACESFilmicToneMapping",
      outputColorSpace: "srgb",
      finalOutputOwner: "renderer",
      runtimeProfile: metrics.runtimeProfile,
      performanceTimestampMode: metrics.performanceTimestampMode,
      timestampQueriesRequired: metrics.timestampQueriesRequired,
      timestampQueriesRequested: metrics.timestampQueriesActive,
      timestampQueriesActive: metrics.timestampQueriesActive,
    }),
    describeResources: () => ({
      schemaVersion: "object-sculptor-resource-inventory-v1",
      subjectId: metrics.subjectId,
      tier: metrics.tier,
      renderTargets: [],
      activeTarget: {
        subjectId: metrics.subjectId,
        nodes: 12,
        meshes: 8,
      },
      controllerStaticRenderResources: { geometryBytes: 512 },
      pipelineAccounting: { pipelineCount: 1 },
      shadow: {
        requestIdentity: "directional-key-shadow-map-request",
        requestedMapSize: 512,
        requestedTexels: 262144,
        requestedDepthBytesUpperBound: 1048576,
        requestedSampleCount: 1,
        physicalGpuResidencyStatus: "opaque-driver-owned-not-claimed",
      },
      rawEvidenceDescriptors: [{
        category: "target-geometry",
        owner: metrics.subjectId,
        resourceKind: "test geometry",
        allocationIds: ["test-geometry"],
        elementCount: 512,
        bytesPerElement: 1,
        sampleCount: 1,
        multiplicity: 1,
        logicalByteLength: 512,
        transient: false,
        accountingStatus: "exact test bytes",
        allocationCount: 1,
        physicalGpuResidentBytes: null,
        physicalGpuResidencyStatus: "opaque-driver-owned-not-claimed",
      }],
    }),
    getPerformanceEvidence: () => ({
      status: "measured-not-accepted-pending-sustained-windows",
      samples: [],
    }),
    async drain() {},
    async dispose() {
      return true;
    },
    ...overrides,
  };
}

function makeCadenceController(overrides = {}) {
  return makeController(overrides, {
    runtimeProfile: "performance",
    performanceTimestampMode: "disabled-for-cadence",
    timestampQueriesRequired: false,
    timestampQueriesActive: false,
    rendererBackendEvidence: {
      backendType: "WebGPUBackend",
      deviceType: "GPUDevice",
      deviceLabel: "test-device",
      deviceIdentitySource: "renderer.backend.device-after-init",
      deviceIdentityVerified: true,
      timestampQueryFeatureOnActualDevice: true,
      backendTimestampTrackingActive: false,
    },
  });
}

function createFrameScheduler() {
  let nextHandle = 1;
  const callbacks = new Map();
  const cancellations = [];
  return {
    callbacks,
    cancellations,
    requestFrame(callback) {
      const handle = nextHandle;
      nextHandle += 1;
      callbacks.set(handle, callback);
      return handle;
    },
    cancelFrame(handle) {
      cancellations.push(handle);
      callbacks.delete(handle);
    },
    take() {
      const entry = callbacks.entries().next().value;
      assert.ok(entry, "expected one scheduled frame callback");
      callbacks.delete(entry[0]);
      return { handle: entry[0], callback: entry[1] };
    },
  };
}

async function resolveScheduledManualSample(samplePromise, scheduler, timestamp) {
  for (let attempt = 0; attempt < 50 && scheduler.callbacks.size === 0; attempt += 1) {
    await Promise.resolve();
  }
  assert.equal(scheduler.callbacks.size, 1, "manual performance sample must schedule one rAF");
  await scheduler.take().callback(timestamp);
  return samplePromise;
}

const CANONICAL_CADENCE_OPTIONS = Object.freeze({
  warmupFrameCount: CORPUS_CADENCE_WINDOW_LIMITS.minWarmupFrameCount,
  measuredFrameCount: CORPUS_CADENCE_WINDOW_LIMITS.minMeasuredFrameCount,
  targetFrameMs: 16.67,
});

async function driveCadenceWindow(windowPromise, scheduler, {
  frameCount = CANONICAL_CADENCE_OPTIONS.warmupFrameCount
    + CANONICAL_CADENCE_OPTIONS.measuredFrameCount,
  firstTimestampMs = 100,
  intervalMs = 16.67,
} = {}) {
  for (let index = 0; index < frameCount; index += 1) {
    for (let attempt = 0; attempt < 50 && scheduler.callbacks.size === 0; attempt += 1) {
      await Promise.resolve();
    }
    assert.equal(
      scheduler.callbacks.size,
      1,
      `cadence window must own exactly one pending rAF at frame ${index + 1}`,
    );
    await scheduler.take().callback(firstTimestampMs + intervalMs * index);
  }
  return windowPromise;
}

{
  const controller = makeController();
  const identity = performanceIdentityFor(controller, "one-shot-gpu");
  assert.equal(identity.schemaVersion, CORPUS_PERFORMANCE_IDENTITY_SCHEMA_VERSION);
  assert.equal(identity.lane, "one-shot-gpu");
  assert.equal(identity.source.sourceClosureHash, SOURCE_CLOSURE_HASH);
  assert.equal(identity.source.buildRevision, BUILD_REVISION);
  assert.equal(identity.adapter.name, "Test WebGPU Adapter");
  assert.equal(identity.browser.automationSurface, "codex-in-app-browser");
  assert.equal(identity.captureSession.sessionId, "test-physical-performance-session");
  assert.equal(Object.isFrozen(identity.captureSession), true);
  assert.equal(identity.workload.subjectId, "potted-bonsai");
  assert.equal(identity.workload.workloadScope, "fixed-time-render-only");
  assert.equal(identity.workload.timeSeconds, 0);
  assert.equal(identity.workload.viewport.drawingBufferWidth, 1280);
  assert.equal(identity.generations.rendererDeviceGeneration, 1);
  assert.equal(identity.generations.deviceLossGeneration, 0);
  assert.equal(identity.cadenceContract, null);
  assert.equal(Object.isFrozen(identity), true);
  assert.equal(Object.isFrozen(identity.source), true);
  assert.equal(Object.isFrozen(identity.adapter.details), true);
  assert.deepEqual(validateObjectSculptorCorpusPerformanceIdentity(identity), identity);

  assert.throws(
    () => performanceIdentityFor(controller, "one-shot-gpu", { sourceClosureHash: "invalid" }),
    /lowercase SHA-256 digest/,
  );
  assert.throws(
    () => performanceIdentityFor(controller, "one-shot-gpu", { buildRevision: "detached-build" }),
    /must bind sourceClosureHash/,
  );
  assert.throws(
    () => performanceIdentityFor(controller, "one-shot-gpu", {
      browser: { ...BROWSER_IDENTITY, automationSurface: "caller-invented-browser" },
    }),
    /requires automationSurface=codex-in-app-browser/,
  );
  assert.throws(
    () => performanceIdentityFor(controller, "one-shot-gpu", {
      browser: { ...BROWSER_IDENTITY, automationSurface: "playwright-headless-chromium" },
    }),
    /requires automationSurface=codex-in-app-browser/,
  );
  assert.throws(
    () => performanceIdentityFor(controller, "one-shot-gpu", {
      browser: {
        ...BROWSER_IDENTITY,
        userAgent: "Mozilla/5.0 HeadlessChrome/140.0",
      },
    }),
    /rejects headless or Playwright browser runtimes/,
  );
  assert.throws(
    () => performanceIdentityFor(makeController({}, {
      performanceAdapterIdentity: { ...ADAPTER_IDENTITY, details: {} },
    }), "one-shot-gpu"),
    /details must be a nonempty/,
  );
  assert.throws(
    () => performanceIdentityFor(makeController({}, {
      performanceAdapterIdentityStatus: "caller-asserted",
    }), "one-shot-gpu"),
    /retained adapter bound to the exact initialized renderer device/,
  );
  assert.throws(
    () => performanceIdentityFor(controller, "one-shot-gpu", { callerInventedField: true }),
    /constructor options has an unexpected schema/,
  );
  assert.throws(
    () => performanceIdentityFor(controller, "one-shot-gpu", {
      captureSession: { ...CAPTURE_SESSION },
    }),
    /must be frozen before identity creation/,
  );
}

{
  const controller = makeCadenceController();
  const identity = performanceIdentityFor(controller, "sustained-cadence");
  assert.deepEqual(identity.cadenceContract, {
    targetFrameMs: 16.67,
    warmupFrameCount: CORPUS_CADENCE_WINDOW_LIMITS.minWarmupFrameCount,
    measuredFrameCount: CORPUS_CADENCE_WINDOW_LIMITS.minMeasuredFrameCount,
    minimumMeasuredDurationMs: CORPUS_CADENCE_WINDOW_LIMITS.minMeasuredDurationMs,
  });
  assert.equal(Object.isFrozen(identity.cadenceContract), true);
  assert.throws(
    () => performanceIdentityFor(controller, "sustained-cadence", {
      cadenceContract: {
        ...identity.cadenceContract,
        minimumMeasuredDurationMs: CORPUS_CADENCE_WINDOW_LIMITS.minMeasuredDurationMs - 1,
      },
    }),
    /at least 2000 ms of measured callbacks/,
  );
  assert.throws(
    () => performanceIdentityFor(makeController(), "one-shot-gpu", {
      cadenceContract: identity.cadenceContract,
    }),
    /cadenceContract must be null/,
  );
}

{
  const softwareAdapter = Object.freeze({
    ...ADAPTER_IDENTITY,
    adapterClass: "software",
    name: "SwiftShader diagnostic adapter",
  });
  const controller = makeCadenceController();
  const metrics = controller.getMetrics();
  controller.getMetrics = () => ({
    ...metrics,
    performanceAdapterIdentity: softwareAdapter,
  });
  const scheduler = createFrameScheduler();
  const identity = performanceIdentityFor(controller, "sustained-cadence");
  const driver = createObjectSculptorCorpusFrameDriver({
    controller,
    performanceIdentity: identity,
    now: () => 0,
    requestFrame: scheduler.requestFrame,
    cancelFrame: scheduler.cancelFrame,
    onMetrics: () => {},
    onError: () => {},
  });
  const authority = driver.publicController.getMetrics().performancePublicationAuthority;
  assert.equal(identity.adapter.adapterClass, "software");
  assert.equal(authority.publishable, false);
  assert.equal(authority.requirements.hardwareAdapter, false);
  assert.ok(authority.missingRequirements.includes("hardwareAdapter"));
  assert.equal(
    driver.publicController.getPerformanceWindowEvidence().finalHealth.status,
    "DIAGNOSTIC",
  );
  await driver.close();
}

{
  const controller = makeCadenceController();
  const scheduler = createFrameScheduler();
  const driver = createObjectSculptorCorpusFrameDriver({
    controller,
    performanceIdentity: performanceIdentityFor(controller, "sustained-cadence", {
      captureSession: null,
    }),
    now: () => 0,
    requestFrame: scheduler.requestFrame,
    cancelFrame: scheduler.cancelFrame,
    onMetrics: () => {},
    onError: () => {},
  });
  const authority = driver.publicController.getMetrics().performancePublicationAuthority;
  assert.equal(authority.requirements.physicalCaptureSession, false);
  assert.ok(authority.missingRequirements.includes("physicalCaptureSession"));
  assert.equal(authority.publishable, false);
  await driver.close();
}

{
  const controller = makeCadenceController();
  const scheduler = createFrameScheduler();
  const identity = performanceIdentityFor(controller, "sustained-cadence");
  const driver = createObjectSculptorCorpusFrameDriver({
    controller,
    performanceIdentity: identity,
    now: () => 0,
    requestFrame: scheduler.requestFrame,
    cancelFrame: scheduler.cancelFrame,
    onMetrics: () => {},
    onError: () => {},
  });
  const authority = driver.publicController.getMetrics().performancePublicationAuthority;
  assert.equal(Object.isFrozen(identity.captureSession), true);
  assert.equal(
    authority.requirements.physicalCaptureSession,
    false,
    "a caller-supplied frozen lookalike is not the pre-app executing-window witness",
  );
  assert.ok(authority.missingRequirements.includes("physicalCaptureSession"));
  await driver.close();
}

for (const invalidMetricsCase of [
  { name: "missing device error count", overrides: { deviceErrorCount: undefined }, pattern: /deviceErrorCount/ },
  { name: "NaN frame error count", overrides: { frameErrorCount: Number.NaN }, pattern: /frameErrorCount/ },
  { name: "negative lifecycle error count", overrides: { lifecycleErrorCount: -1 }, pattern: /lifecycleErrorCount/ },
  {
    name: "zero drawing-buffer width",
    overrides: {
      viewport: { ...makeMetrics().viewport, drawingBufferWidth: 0 },
    },
    pattern: /drawingBufferWidth/,
  },
  {
    name: "zero applied DPR",
    overrides: {
      viewport: { ...makeMetrics().viewport, appliedDpr: 0 },
    },
    pattern: /appliedDpr/,
  },
  {
    name: "malformed camera pose",
    overrides: { cameraFraming: { actualPose: {} } },
    pattern: /positionMeters/,
  },
  { name: "non-finite fixed time", overrides: { time: Number.NaN }, pattern: /fixed time/ },
  { name: "negative fixed time", overrides: { time: -0.01 }, pattern: /fixed time/ },
  {
    name: "non-unit camera quaternion",
    overrides: {
      cameraFraming: {
        ...makeMetrics().cameraFraming,
        actualPose: {
          ...makeMetrics().cameraFraming.actualPose,
          quaternion: [0, 0, 0, 2],
        },
      },
    },
    pattern: /quaternion must be unit length/,
  },
]) {
  assert.throws(
    () => performanceIdentityFor(makeController({}, invalidMetricsCase.overrides), "one-shot-gpu"),
    invalidMetricsCase.pattern,
    invalidMetricsCase.name,
  );
}

assert.throws(
  () => performanceIdentityFor(makeController({}, {
    runtimeProfile: "performance",
    performanceTimestampMode: "disabled-for-cadence",
    timestampQueriesRequired: false,
    timestampQueriesActive: false,
    gpuTimestampResolveAttempts: 1,
    rendererBackendEvidence: {
      ...makeMetrics().rendererBackendEvidence,
      backendTimestampTrackingActive: false,
    },
  }), "sustained-cadence"),
  /zero GPU timestamp resolution attempts and failures/,
);

{
  const scheduler = createFrameScheduler();
  const controller = makeController();
  const driver = createObjectSculptorCorpusFrameDriver({
    controller,
    now: () => 0,
    requestFrame: scheduler.requestFrame,
    cancelFrame: scheduler.cancelFrame,
    onMetrics: () => {},
    onError: (error) => assert.fail(`missing identity rejection must not poison the driver: ${error.message}`),
  });
  await assert.rejects(
    driver.publicController.samplePerformanceFrame({ windowId: "missing-identity" }),
    /requires an explicit immutable performanceIdentity/,
  );
  assert.equal(scheduler.callbacks.size, 0, "missing provenance must reject before scheduling or rendering");
  assert.equal(driver.getState(), "idle");
  await driver.publicController.renderOnce();
  assert.equal(driver.publicController.getMetrics().completedFrames, 1);
  assert.deepEqual(driver.publicController.getPerformanceWindowEvidence().gpuTimestampPopulations, []);
  await driver.close();
}

{
  const scheduler = createFrameScheduler();
  const controller = makeController();
  const driver = createObjectSculptorCorpusFrameDriver({
    controller,
    performanceIdentity: performanceIdentityFor(controller, "one-shot-gpu"),
    now: () => 0,
    requestFrame: scheduler.requestFrame,
    cancelFrame: scheduler.cancelFrame,
    onMetrics: () => {},
    onError: (error) => assert.fail(`mixed-lane rejection must not poison the driver: ${error.message}`),
  });
  await assert.rejects(
    driver.publicController.runCadenceWindow({
      windowId: "mixed-lane",
      ...CANONICAL_CADENCE_OPTIONS,
    }),
    /cannot run on the one-shot-gpu performance lane/,
  );
  assert.equal(scheduler.callbacks.size, 0);
  assert.equal(driver.getState(), "idle");
  assert.deepEqual(driver.publicController.getPerformanceWindowEvidence().sustainedCadenceWindows, []);
  await driver.close();
}

{
  assert.deepEqual(CORPUS_PERFORMANCE_EVIDENCE_LIMITS, {
    maxWindowCountPerLane: 16,
    maxSampleCountPerLane: 4096,
  });
  assert.equal(Object.isFrozen(CORPUS_PERFORMANCE_EVIDENCE_LIMITS), true);
  assert.throws(
    () => createObjectSculptorCorpusFrameDriver({
      controller: makeController(),
      performanceEvidenceLimits: {
        maxWindowCountPerLane: CORPUS_PERFORMANCE_EVIDENCE_LIMITS.maxWindowCountPerLane + 1,
        maxSampleCountPerLane: 1,
      },
      now: () => 0,
      requestFrame: () => 1,
      cancelFrame: () => {},
      onMetrics: () => {},
      onError: () => {},
    }),
    /cannot exceed the canonical bounded limit/,
  );
}

{
  const scheduler = createFrameScheduler();
  const controller = makeController();
  const driver = createObjectSculptorCorpusFrameDriver({
    controller,
    performanceIdentity: performanceIdentityFor(controller, "one-shot-gpu"),
    performanceEvidenceLimits: {
      maxWindowCountPerLane: 1,
      maxSampleCountPerLane: 1,
    },
    now: (() => {
      let value = 0;
      return () => ++value;
    })(),
    requestFrame: scheduler.requestFrame,
    cancelFrame: scheduler.cancelFrame,
    onMetrics: () => {},
    onError: (error) => assert.fail(`bounded sample rejection must remain pre-admission: ${error.message}`),
  });
  const firstPromise = driver.publicController.samplePerformanceFrame({ windowId: "bounded-samples" });
  await resolveScheduledManualSample(firstPromise, scheduler, 16);
  await assert.rejects(
    driver.publicController.samplePerformanceFrame({ windowId: "bounded-samples" }),
    (error) => error.code === "CORPUS_PERFORMANCE_EVIDENCE_LIMIT"
      && /sample-count limit/.test(error.message),
  );
  assert.equal(scheduler.callbacks.size, 0, "sample retention limit must reject before rAF");
  assert.equal(driver.getState(), "idle");
  const metrics = driver.publicController.getMetrics().performanceEvidenceLaneCounts;
  assert.deepEqual(metrics.oneShotGpu, {
    observedSampleCount: 1,
    retainedSampleCount: 1,
    retainedWindowCount: 1,
    limitRejectionCount: 1,
  });
  const evidence = driver.publicController.getPerformanceWindowEvidence();
  assert.deepEqual(evidence.retention.oneShotGpu, metrics.oneShotGpu);
  assert.equal(evidence.gpuTimestampPopulations[0].observedSampleCount, 1);
  assert.equal(evidence.gpuTimestampPopulations[0].retainedSampleCount, 1);
  await driver.close();
}

{
  const scheduler = createFrameScheduler();
  const controller = makeController();
  const driver = createObjectSculptorCorpusFrameDriver({
    controller,
    performanceIdentity: performanceIdentityFor(controller, "one-shot-gpu"),
    performanceEvidenceLimits: {
      maxWindowCountPerLane: 1,
      maxSampleCountPerLane: 2,
    },
    now: (() => {
      let value = 0;
      return () => ++value;
    })(),
    requestFrame: scheduler.requestFrame,
    cancelFrame: scheduler.cancelFrame,
    onMetrics: () => {},
    onError: (error) => assert.fail(`bounded window rejection must remain pre-admission: ${error.message}`),
  });
  const firstPromise = driver.publicController.samplePerformanceFrame({ windowId: "bounded-window-a" });
  await resolveScheduledManualSample(firstPromise, scheduler, 16);
  await assert.rejects(
    driver.publicController.samplePerformanceFrame({ windowId: "bounded-window-b" }),
    (error) => error.code === "CORPUS_PERFORMANCE_EVIDENCE_LIMIT"
      && /window-count limit/.test(error.message),
  );
  assert.equal(scheduler.callbacks.size, 0, "window retention limit must reject before rAF");
  assert.equal(driver.getState(), "idle");
  const retention = driver.publicController.getPerformanceWindowEvidence().retention.oneShotGpu;
  assert.deepEqual(retention, {
    observedSampleCount: 1,
    retainedSampleCount: 1,
    retainedWindowCount: 1,
    limitRejectionCount: 1,
  });
  await driver.close();
}

{
  const scheduler = createFrameScheduler();
  const controller = makeCadenceController();
  const driver = createObjectSculptorCorpusFrameDriver({
    controller,
    performanceIdentity: performanceIdentityFor(controller, "sustained-cadence"),
    performanceEvidenceLimits: {
      maxWindowCountPerLane: 1,
      maxSampleCountPerLane:
        CANONICAL_CADENCE_OPTIONS.warmupFrameCount
        + CANONICAL_CADENCE_OPTIONS.measuredFrameCount
        - 1,
    },
    now: (() => {
      let value = 0;
      return () => ++value;
    })(),
    requestFrame: scheduler.requestFrame,
    cancelFrame: scheduler.cancelFrame,
    onMetrics: () => {},
    onError: (error) => assert.fail(`bounded cadence rejection must remain pre-admission: ${error.message}`),
  });
  await assert.rejects(
    driver.publicController.runCadenceWindow({
      windowId: "bounded-cadence",
      ...CANONICAL_CADENCE_OPTIONS,
    }),
    (error) => error.code === "CORPUS_PERFORMANCE_EVIDENCE_LIMIT"
      && /sample-count limit/.test(error.message),
  );
  assert.equal(scheduler.callbacks.size, 0);
  assert.deepEqual(
    driver.publicController.getPerformanceWindowEvidence().retention.sustainedCadence,
    {
      observedSampleCount: 0,
      retainedSampleCount: 0,
      retainedWindowCount: 0,
      limitRejectionCount: 1,
    },
  );
  await driver.close();
}

{
  const scheduler = createFrameScheduler();
  const controller = makeCadenceController();
  const driver = createObjectSculptorCorpusFrameDriver({
    controller,
    performanceIdentity: performanceIdentityFor(controller, "sustained-cadence"),
    now: () => 0,
    requestFrame: scheduler.requestFrame,
    cancelFrame: scheduler.cancelFrame,
    onMetrics: () => {},
    onError: (error) => assert.fail(`cadence option rejection must remain pre-admission: ${error.message}`),
  });
  await assert.rejects(
    driver.publicController.runCadenceWindow({
      windowId: "too-little-warmup",
      ...CANONICAL_CADENCE_OPTIONS,
      warmupFrameCount: CORPUS_CADENCE_WINDOW_LIMITS.minWarmupFrameCount - 1,
    }),
    /at least 8 warmup frames/,
  );
  await assert.rejects(
    driver.publicController.runCadenceWindow({
      windowId: "too-few-measured",
      ...CANONICAL_CADENCE_OPTIONS,
      measuredFrameCount: CORPUS_CADENCE_WINDOW_LIMITS.minMeasuredFrameCount - 1,
    }),
    /at least 300 measured frames/,
  );
  await assert.rejects(
    driver.publicController.runCadenceWindow({
      windowId: "caller-extra-field",
      ...CANONICAL_CADENCE_OPTIONS,
      callerTimestamp: 1,
    }),
    /unexpected schema/,
  );
  await assert.rejects(
    driver.publicController.runCadenceWindow({
      windowId: "unbound-target",
      ...CANONICAL_CADENCE_OPTIONS,
      targetFrameMs: 17,
    }),
    /targetFrameMs does not match immutable cadence contract/,
  );
  await assert.rejects(
    driver.publicController.runCadenceWindow({
      windowId: "unbound-warmup",
      ...CANONICAL_CADENCE_OPTIONS,
      warmupFrameCount: CANONICAL_CADENCE_OPTIONS.warmupFrameCount + 1,
    }),
    /warmupFrameCount does not match immutable cadence contract/,
  );
  await assert.rejects(
    driver.publicController.runCadenceWindow({
      windowId: "unbound-measured-count",
      ...CANONICAL_CADENCE_OPTIONS,
      measuredFrameCount: CANONICAL_CADENCE_OPTIONS.measuredFrameCount + 1,
    }),
    /measuredFrameCount does not match immutable cadence contract/,
  );
  assert.equal(scheduler.callbacks.size, 0);
  assert.deepEqual(driver.publicController.getPerformanceWindowEvidence().sustainedCadenceWindows, []);
  await driver.close();
}

assert.throws(() => createObjectSculptorCorpusFrameDriver({
  controller: makeController(),
  routeLocks: { scenario: "ceramic-teapot" },
  now: () => 0,
  requestFrame: () => 1,
  cancelFrame: () => {},
  onMetrics: () => {},
  onError: () => {},
}), /does not match initial controller state/);

assert.throws(() => createObjectSculptorCorpusFrameDriver({
  controller: makeController({
    getMetrics: () => makeMetrics({ cameraInteractionEnabled: true }),
  }),
  routeLocks: { scenario: "potted-bonsai" },
  now: () => 0,
  requestFrame: () => 1,
  cancelFrame: () => {},
  onMetrics: () => {},
  onError: () => {},
}), /cameraInteractionEnabled=false/);

{
  const errors = [];
  let rawSubjectCalls = 0;
  let rawScenarioCalls = 0;
  const controller = makeController();
  const rawSetSubject = controller.setSubject.bind(controller);
  controller.setSubject = async (id) => {
    rawSubjectCalls += 1;
    return rawSetSubject(id);
  };
  controller.setScenario = async (id) => {
    rawScenarioCalls += 1;
    return rawSetSubject(id);
  };
  const driver = createObjectSculptorCorpusFrameDriver({
    controller,
    routeLocks: { scenario: "potted-bonsai" },
    now: () => 0,
    requestFrame: () => 1,
    cancelFrame: () => {},
    onMetrics: () => {},
    onError: (error) => errors.push(error.message),
  });
  const facade = driver.publicController;

  const lockState = facade.getRouteLockState();
  assert.equal(lockState.code, CORPUS_ROUTE_LOCK_STATE);
  assert.deepEqual(lockState.disabledSelectorIds, ["subject"]);
  assert.deepEqual(lockState.enabledSelectorIds, ["mode", "tier", "camera"]);
  assert.deepEqual(lockState.lockedDimensions, ["scenario"]);
  assert.equal(lockState.lockedDimension, "scenario");
  assert.equal(lockState.lockedSelectorId, "subject");
  assert.equal(lockState.lockedValue, "potted-bonsai");

  let programmaticSubjectValue = "ceramic-teapot";
  assert.equal(await settleCorpusControlAction(facade.setSubject(programmaticSubjectValue), {
    onApplied: () => assert.fail("a disabled subject selector must not apply"),
    onRestore: () => {
      programmaticSubjectValue = facade.getMetrics().subjectId;
    },
  }), false);
  assert.equal(programmaticSubjectValue, "potted-bonsai", "a programmatic disabled-selector change must restore its route value");
  assert.equal(await facade.setScenario("articulated-desk-lamp"), false, "setScenario must not bypass a scenario lock");
  assert.equal(rawSubjectCalls, 0);
  assert.equal(rawScenarioCalls, 0);

  let metrics = facade.getMetrics();
  assert.equal(metrics.routeLockRejectCount, 2);
  assert.equal(metrics.lastRouteLockResult.code, CORPUS_ROUTE_LOCKED);
  assert.equal(metrics.lastRouteLockResult.dimension, "scenario");
  assert.equal(metrics.lastRouteLockResult.method, "setScenario");
  assert.equal(metrics.lastRouteLockResult.stateChanged, false);
  assert.equal(metrics.frameErrorCount, 0);
  assert.equal(metrics.lifecycleErrorCount, 0);
  assert.equal(driver.getState(), "idle", "route rejection must not poison the serialized lane");

  for (const [method, changedValue, baselineValue] of [
    ["setMode", "materials", "action-ready"],
    ["setTier", "minimum", "budgeted"],
    ["setCamera", "profile", "design"],
  ]) {
    let controlValue = changedValue;
    assert.equal(await settleCorpusControlAction(facade[method](changedValue), {
      onApplied: () => {},
      onRestore: () => assert.fail(`${method} unexpectedly restored an enabled change`),
    }), true, `${method} must remain enabled on a scenario route`);
    controlValue = baselineValue;
    assert.equal(await settleCorpusControlAction(facade[method](baselineValue), {
      onApplied: () => {},
      onRestore: () => assert.fail(`${method} unexpectedly rejected an enabled restore`),
    }), true, `${method} must restore its baseline on a scenario route`);
    assert.equal(controlValue, baselineValue);
  }
  metrics = facade.getMetrics();
  assert.equal(metrics.subjectId, "potted-bonsai");
  assert.equal(metrics.mode, "action-ready");
  assert.equal(metrics.tier, "budgeted");
  assert.equal(metrics.camera, "design");
  assert.equal(metrics.frameErrorCount, 0);
  assert.equal(metrics.lifecycleErrorCount, 0);
  assert.deepEqual(errors, []);
  await facade.dispose();
}

for (const routeCase of [
  { dimension: "mechanism", lockedValue: "action-ready", selectorId: "mode", method: "setMode", attemptedValue: "final" },
  { dimension: "tier", lockedValue: "budgeted", selectorId: "tier", method: "setTier", attemptedValue: "full" },
  { dimension: "camera", lockedValue: "design", selectorId: "camera", method: "setCamera", attemptedValue: "profile" },
]) {
  const controller = makeController();
  const driver = createObjectSculptorCorpusFrameDriver({
    controller,
    routeLocks: { [routeCase.dimension]: routeCase.lockedValue },
    now: () => 0,
    requestFrame: () => 1,
    cancelFrame: () => {},
    onMetrics: () => {},
    onError: (error) => assert.fail(`unexpected route-lock error: ${error.message}`),
  });
  const facade = driver.publicController;
  assert.equal(await facade[routeCase.method](routeCase.attemptedValue), false);
  assert.deepEqual(facade.getRouteLockState().disabledSelectorIds, [routeCase.selectorId]);
  assert.equal(facade.getMetrics().lastRouteLockResult.code, CORPUS_ROUTE_LOCKED);
  assert.equal(await facade.setSubject("ceramic-teapot"), true, "an unlocked subject must change");
  assert.equal(await facade.setSubject("potted-bonsai"), true, "an unlocked subject must restore");
  assert.equal(driver.getState(), "idle");
  await facade.dispose();
}

{
  let releaseDispose;
  const disposeGate = new Promise((resolve) => {
    releaseDispose = resolve;
  });
  let rawSubjectCalls = 0;
  const controller = makeController({
    async setSubject() {
      rawSubjectCalls += 1;
      return true;
    },
    async dispose() {
      await disposeGate;
      return true;
    },
  });
  const driver = createObjectSculptorCorpusFrameDriver({
    controller,
    routeLocks: { scenario: "potted-bonsai" },
    now: () => 0,
    requestFrame: () => 1,
    cancelFrame: () => {},
    onMetrics: () => {},
    onError: (error) => assert.fail(`unexpected terminal-state route error: ${error.message}`),
  });
  const facade = driver.publicController;

  const closePromise = facade.dispose();
  assert.equal(driver.getState(), "closing");
  await assert.rejects(facade.setSubject("ceramic-teapot"), /frame driver is closing/);
  assert.equal(facade.getMetrics().routeLockRejectCount, 0, "closing admission must run before route-lock semantics");
  assert.equal(facade.getMetrics().lastRouteLockResult, null);
  releaseDispose();
  await closePromise;
  await assert.rejects(facade.setScenario("articulated-desk-lamp"), /frame driver is closed/);
  assert.equal(facade.getMetrics().routeLockRejectCount, 0, "closed admission must run before route-lock semantics");
  assert.equal(rawSubjectCalls, 0);
}

{
  let rawSubjectCalls = 0;
  const errors = [];
  const controller = makeController({
    async setSubject() {
      rawSubjectCalls += 1;
      return true;
    },
    async renderOnce() {
      throw new Error("synthetic terminal-state render failure");
    },
  });
  const driver = createObjectSculptorCorpusFrameDriver({
    controller,
    routeLocks: { scenario: "potted-bonsai" },
    now: () => 0,
    requestFrame: () => 1,
    cancelFrame: () => {},
    onMetrics: () => {},
    onError: (error) => errors.push(error.message),
  });
  const facade = driver.publicController;

  await assert.rejects(facade.renderOnce(), /synthetic terminal-state render failure/);
  assert.equal(driver.getState(), "failed");
  await assert.rejects(facade.setSubject("ceramic-teapot"), /frame driver is failed/);
  assert.equal(facade.getMetrics().routeLockRejectCount, 0, "failed admission must run before route-lock semantics");
  assert.equal(facade.getMetrics().lastRouteLockResult, null);
  assert.equal(rawSubjectCalls, 0);
  assert.deepEqual(errors, ["synthetic terminal-state render failure"]);
  await facade.dispose();
}

{
  const scheduler = createFrameScheduler();
  const deltas = [];
  const publishedMetrics = [];
  let completedFrames = 0;
  let disposeCalls = 0;
  const controller = makeController({
    async step(deltaSeconds) {
      deltas.push(deltaSeconds);
    },
    async renderOnce() {
      completedFrames += 1;
    },
    getMetrics() {
      return makeMetrics({
        firstFrameCompleted: completedFrames > 0,
        completedFrames,
      });
    },
    async dispose() {
      disposeCalls += 1;
      return true;
    },
  });
  const driver = createObjectSculptorCorpusFrameDriver({
    controller,
    now: () => 100,
    requestFrame: scheduler.requestFrame,
    cancelFrame: scheduler.cancelFrame,
    onMetrics: (value) => publishedMetrics.push(value),
    onError: (error) => assert.fail(`unexpected frame error: ${error.message}`),
  });

  assert.equal(driver.start(), true);
  assert.equal(driver.start(), false, "starting an active driver must be idempotent");
  assert.equal(publishedMetrics.length, 1, "HUD metrics must publish before the first render");
  assert.equal(publishedMetrics[0].firstFrameCompleted, false);
  const first = scheduler.take();
  await first.callback(99);
  assert.deepEqual(deltas, [0], "a rAF timestamp before performance.now() must clamp to zero");
  assert.equal(completedFrames, 1, "one driver frame must issue exactly one scene render");
  assert.equal(publishedMetrics.at(-1).firstFrameCompleted, true);
  assert.equal(scheduler.callbacks.size, 1, "a successful live frame must schedule one successor");
  const stale = scheduler.take();
  assert.equal(driver.suspend(), true);
  assert.equal(driver.suspend(), false, "suspending an inactive driver must be idempotent");
  assert.deepEqual(scheduler.cancellations, [stale.handle], "suspending must invalidate the owned rAF handle");
  await stale.callback(116);
  assert.equal(completedFrames, 1, "a suspended driver must ignore an already queued callback");
  assert.equal(driver.resume(), true, "a persisted pageshow can resume a suspended driver");
  const restored = scheduler.take();
  await restored.callback(132);
  assert.equal(completedFrames, 2, "the restored frame owner must render again");
  assert.equal(driver.stop(), true);
  assert.equal(scheduler.cancellations.length, 2, "each suspension must cancel its pending successor rAF");
  await driver.close();
  assert.equal(disposeCalls, 1);
  assert.equal(driver.getState(), "closed");
}

{
  const scheduler = createFrameScheduler();
  const rawCalls = { step: 0, renderOnce: 0, resolveGpuTimestampSample: 0, capturePixels: 0 };
  const controller = makeController({
    async step() { rawCalls.step += 1; },
    async renderOnce() { rawCalls.renderOnce += 1; },
    async resolveGpuTimestampSample() {
      rawCalls.resolveGpuTimestampSample += 1;
      assert.fail("live owner must prevent raw timestamp resolution");
    },
    async capturePixels() {
      rawCalls.capturePixels += 1;
      assert.fail("live owner must prevent raw capture");
    },
  });
  const driver = createObjectSculptorCorpusFrameDriver({
    controller,
    now: () => 0,
    requestFrame: scheduler.requestFrame,
    cancelFrame: scheduler.cancelFrame,
    onMetrics: () => {},
    onError: (error) => assert.fail(`live-owner rejection must not poison the driver: ${error.message}`),
  });
  assert.equal(driver.start(), true);
  for (const [method, args] of [
    ["step", [1 / 60]],
    ["renderOnce", []],
    ["resolveGpuTimestampSample", []],
    ["capturePixels", ["presentation"]],
  ]) {
    await assert.rejects(
      driver.publicController[method](...args),
      (error) => error.code === "CORPUS_FRAME_OWNER_CONFLICT",
      `${method} must reject while live rAF owns frame operations`,
    );
  }
  assert.deepEqual(rawCalls, {
    step: 0,
    renderOnce: 0,
    resolveGpuTimestampSample: 0,
    capturePixels: 0,
  });
  assert.equal(driver.getState(), "running");
  assert.equal(driver.publicController.getMetrics().frameErrorCount, 4);
  driver.suspend();
  await driver.close();
}

for (const forgedCase of [
  {
    name: "aggregate submission scope",
    mutate: (sample) => ({ ...sample, coveredSubmissionCount: 2 }),
    pattern: /exactly one render submission/,
  },
  {
    name: "mismatched Three revision",
    mutate: (sample) => ({
      ...sample,
      queryPoolEvidence: { ...sample.queryPoolEvidence, threeRevision: "184" },
    }),
    pattern: /freshness evidence is insufficient/,
  },
  {
    name: "forged submission ordinal",
    mutate: (sample) => ({ ...sample, submissionOrdinal: sample.submissionOrdinal + 1 }),
    pattern: /ordinals do not bind/,
  },
  {
    name: "forged context duration",
    mutate: (sample) => ({
      ...sample,
      queryPoolEvidence: {
        ...sample.queryPoolEvidence,
        resolvedContextDurationsMs: [sample.gpuMs + 1],
      },
    }),
    pattern: /durations do not sum/,
  },
]) {
  const scheduler = createFrameScheduler();
  const controller = makeController();
  const rawResolve = controller.resolveGpuTimestampSample.bind(controller);
  controller.resolveGpuTimestampSample = async () => forgedCase.mutate(await rawResolve());
  const errors = [];
  const driver = createObjectSculptorCorpusFrameDriver({
    controller,
    performanceIdentity: performanceIdentityFor(controller, "one-shot-gpu"),
    now: (() => {
      let value = 0;
      return () => ++value;
    })(),
    requestFrame: scheduler.requestFrame,
    cancelFrame: scheduler.cancelFrame,
    onMetrics: () => {},
    onError: (error) => errors.push(error.message),
  });
  const samplePromise = driver.publicController.samplePerformanceFrame({
    windowId: `forged-${forgedCase.name}`,
  });
  await assert.rejects(
    resolveScheduledManualSample(samplePromise, scheduler, 16),
    forgedCase.pattern,
    forgedCase.name,
  );
  assert.equal(driver.getState(), "failed");
  assert.equal(driver.publicController.getMetrics().performanceEvidenceLaneCounts.oneShotGpu.retainedSampleCount, 0);
  assert.equal(errors.length, 1);
  await driver.close();
}

for (const driftCase of [
  {
    name: "camera",
    mutate: (facade) => facade.setCamera("profile"),
    pattern: /changed camera/,
  },
  {
    name: "viewport-DPR",
    mutate: (facade) => facade.resize(640, 400, 1.25),
    pattern: /changed viewport or DPR/,
  },
  {
    name: "fixed-time-history",
    mutate: (facade) => facade.setTime(9),
    pattern: /changed timeSeconds|changed historyState/,
  },
]) {
  const scheduler = createFrameScheduler();
  const controller = makeController();
  const driver = createObjectSculptorCorpusFrameDriver({
    controller,
    performanceIdentity: performanceIdentityFor(controller, "one-shot-gpu"),
    now: (() => {
      let value = 0;
      return () => ++value;
    })(),
    requestFrame: scheduler.requestFrame,
    cancelFrame: scheduler.cancelFrame,
    onMetrics: () => {},
    onError: () => {},
  });
  const firstPromise = driver.publicController.samplePerformanceFrame({ windowId: "bound-window" });
  await resolveScheduledManualSample(firstPromise, scheduler, 16);
  await driftCase.mutate(driver.publicController);
  await assert.rejects(
    driver.publicController.samplePerformanceFrame({ windowId: "bound-window" }),
    driftCase.pattern,
    `${driftCase.name} drift must invalidate one performance window`,
  );
  assert.equal(driver.publicController.getMetrics().performanceEvidenceLaneCounts.oneShotGpu.retainedSampleCount, 1);
  assert.equal(scheduler.callbacks.size, 0, "drift must reject before requesting another frame");
  await driver.close();
}

{
  const scheduler = createFrameScheduler();
  const controller = makeController();
  const baseDescribeResources = controller.describeResources.bind(controller);
  let geometryBytes = 512;
  controller.describeResources = () => {
    const resources = baseDescribeResources();
    return {
      ...resources,
      rawEvidenceDescriptors: resources.rawEvidenceDescriptors.map((descriptor) => ({
        ...descriptor,
        elementCount: geometryBytes,
        logicalByteLength: geometryBytes,
      })),
    };
  };
  const driver = createObjectSculptorCorpusFrameDriver({
    controller,
    performanceIdentity: performanceIdentityFor(controller, "one-shot-gpu"),
    now: (() => {
      let value = 0;
      return () => ++value;
    })(),
    requestFrame: scheduler.requestFrame,
    cancelFrame: scheduler.cancelFrame,
    onMetrics: () => {},
    onError: (error) => assert.fail(`resource drift must reject before frame work: ${error.message}`),
  });
  const firstPromise = driver.publicController.samplePerformanceFrame({ windowId: "resource-bound" });
  await resolveScheduledManualSample(firstPromise, scheduler, 16);
  geometryBytes = 1024;
  await assert.rejects(
    driver.publicController.samplePerformanceFrame({ windowId: "resource-bound" }),
    /changed resourceState/,
  );
  assert.equal(scheduler.callbacks.size, 0);
  assert.equal(driver.getState(), "idle");
  await driver.close();
}

{
  const scheduler = createFrameScheduler();
  const errors = [];
  const controller = makeController();
  const driver = createObjectSculptorCorpusFrameDriver({
    controller,
    performanceIdentity: performanceIdentityFor(controller, "one-shot-gpu"),
    now: (() => {
      let value = 0;
      return () => ++value;
    })(),
    requestFrame: scheduler.requestFrame,
    cancelFrame: scheduler.cancelFrame,
    onMetrics: () => {},
    onError: (error) => errors.push(error.message),
  });
  const firstPromise = driver.publicController.samplePerformanceFrame({ windowId: "continuous-a" });
  await resolveScheduledManualSample(firstPromise, scheduler, 16);
  await driver.publicController.renderOnce();
  await assert.rejects(
    driver.publicController.samplePerformanceFrame({ windowId: "continuous-a" }),
    /is discontinuous between samples/,
  );
  assert.equal(scheduler.callbacks.size, 0, "a discontinuous population must fail before another rAF");
  assert.equal(driver.getState(), "failed");
  assert.deepEqual(errors, ["GPU timestamp population continuous-a is discontinuous between samples"]);
  assert.equal(
    driver.publicController.getPerformanceWindowEvidence().gpuTimestampPopulations[0].sampleCount,
    1,
  );
  await driver.close();
}

{
  const scheduler = createFrameScheduler();
  const errors = [];
  const controller = makeCadenceController();
  const driver = createObjectSculptorCorpusFrameDriver({
    controller,
    performanceIdentity: performanceIdentityFor(controller, "sustained-cadence"),
    now: (() => {
      let value = 0;
      return () => ++value;
    })(),
    requestFrame: scheduler.requestFrame,
    cancelFrame: scheduler.cancelFrame,
    onMetrics: () => {},
    onError: (error) => errors.push(error.message),
  });
  const windowPromise = driver.publicController.runCadenceWindow({
    windowId: "cadence-over-budget",
    ...CANONICAL_CADENCE_OPTIONS,
  });
  const windowEvidence = await driveCadenceWindow(windowPromise, scheduler, { intervalMs: 20 });
  assert.equal(windowEvidence.status, "over-budget");
  assert.equal(windowEvidence.windowAcceptance, "FAIL-p95-frame-budget");
  assert.equal(windowEvidence.summary.callbackIntervalP95Ms, 20);
  assert.equal(windowEvidence.summary.p95BudgetSatisfied, false);
  assert.equal(
    windowEvidence.continuity.status,
    "driver-owned-back-to-back-raf-and-consecutive-controller-ordinals",
  );
  assert.doesNotMatch(windowEvidence.samples[0].cadenceAcceptance, /^eligible/);
  assert.equal(
    driver.publicController.getPerformanceWindowEvidence().acceptance.sustainedCadence,
    "FAIL-one-or-more-windows-missed-runtime-duration-or-p95-gates",
  );
  assert.deepEqual(errors, []);
  await driver.close();
}

{
  const scheduler = createFrameScheduler();
  const controller = makeCadenceController();
  const errors = [];
  const previousRequestFrame = Object.getOwnPropertyDescriptor(
    globalThis,
    "requestAnimationFrame",
  );
  const previousCancelFrame = Object.getOwnPropertyDescriptor(
    globalThis,
    "cancelAnimationFrame",
  );
  Object.defineProperty(globalThis, "requestAnimationFrame", {
    configurable: true,
    writable: true,
    value: (callback) => scheduler.requestFrame(callback),
  });
  Object.defineProperty(globalThis, "cancelAnimationFrame", {
    configurable: true,
    writable: true,
    value: (handle) => scheduler.cancelFrame(handle),
  });
  try {
    assert.throws(
      () => createObjectSculptorCorpusFrameDriver({
        controller,
        performanceIdentity: performanceIdentityFor(controller, "sustained-cadence"),
        onMetrics: () => {},
        onError: (error) => errors.push(error.message),
      }),
      /frame timing callbacks are required/,
      "globals installed after module evaluation must not impersonate captured browser intrinsics",
    );
    assert.throws(
      () => createObjectSculptorCorpusFrameDriver({
        controller,
        performanceIdentity: performanceIdentityFor(controller, "sustained-cadence"),
        now: () => 0,
        requestFrame: scheduler.requestFrame,
        cancelFrame: scheduler.cancelFrame,
        onMetrics: () => {},
        onError: (error) => errors.push(error.message),
        timingAuthority: { publishable: true, status: "caller-forged" },
      }),
      /Unknown Object Sculptor corpus frame-driver options: timingAuthority/,
      "callers must not self-assert timing authority",
    );
    const driver = createObjectSculptorCorpusFrameDriver({
      controller,
      performanceIdentity: performanceIdentityFor(controller, "sustained-cadence"),
      now: () => 0,
      requestFrame: scheduler.requestFrame,
      cancelFrame: scheduler.cancelFrame,
      onMetrics: () => {},
      onError: (error) => errors.push(error.message),
    });
    const windowPromise = driver.publicController.runCadenceWindow({
      windowId: "canonical-browser-authority",
      ...CANONICAL_CADENCE_OPTIONS,
    });
    const windowEvidence = await driveCadenceWindow(windowPromise, scheduler, {
      intervalMs: 16.67,
    });
    assert.equal(windowEvidence.status, "diagnostic-continuous");
    assert.equal(windowEvidence.finalHealth.status, "DIAGNOSTIC");
    assert.equal(windowEvidence.timingAuthority.publishable, false);
    assert.equal(
      windowEvidence.samples[0].cadenceAcceptance,
      "diagnostic-dependency-injected-timing-not-publishable",
    );
    assert.equal(windowEvidence.samples[0].status, "diagnostic");
    assert.equal(windowEvidence.performancePublicationAuthority.publishable, false);
    assert.deepEqual(
      windowEvidence.performancePublicationAuthority.missingRequirements,
      ["canonicalBrowserTiming", "physicalCaptureSession"],
    );
    assert.deepEqual(errors, []);
    await driver.close();
  } finally {
    if (previousRequestFrame) {
      Object.defineProperty(globalThis, "requestAnimationFrame", previousRequestFrame);
    } else {
      delete globalThis.requestAnimationFrame;
    }
    if (previousCancelFrame) {
      Object.defineProperty(globalThis, "cancelAnimationFrame", previousCancelFrame);
    } else {
      delete globalThis.cancelAnimationFrame;
    }
  }
}

{
  const scheduler = createFrameScheduler();
  const baseController = makeController();
  const rawRender = baseController.renderOnce.bind(baseController);
  let visibleMetrics = baseController.getMetrics();
  const controller = {
    ...baseController,
    getMetrics: () => visibleMetrics,
    async renderOnce() {
      await rawRender();
      visibleMetrics = baseController.getMetrics();
    },
  };
  const driver = createObjectSculptorCorpusFrameDriver({
    controller,
    performanceIdentity: performanceIdentityFor(controller, "one-shot-gpu"),
    now: (() => {
      let value = 0;
      return () => ++value;
    })(),
    requestFrame: scheduler.requestFrame,
    cancelFrame: scheduler.cancelFrame,
    onMetrics: () => {},
    onError: (error) => assert.fail(`unexpected post-window health error: ${error.message}`),
  });
  const samplePromise = driver.publicController.samplePerformanceFrame({ windowId: "health-a" });
  await resolveScheduledManualSample(samplePromise, scheduler, 16);
  assert.equal(driver.publicController.getPerformanceWindowEvidence().finalHealth.status, "DIAGNOSTIC");
  visibleMetrics = {
    ...visibleMetrics,
    rendererDeviceStatus: "lost",
    rendererDeviceIdentityStillCurrent: false,
    deviceLossGeneration: 1,
    acceptingControllerOperations: false,
  };
  const invalidated = driver.publicController.getPerformanceWindowEvidence();
  assert.equal(invalidated.finalHealth.status, "INVALID");
  assert.match(invalidated.finalHealth.reason, /not active and current|active renderer device/);
  assert.equal(invalidated.gpuTimestampPopulations[0].sampleCount, 1);
  await driver.close();
}

{
  const scheduler = createFrameScheduler();
  let visibleMetrics = makeMetrics();
  const controller = makeController({ getMetrics: () => visibleMetrics });
  const identity = performanceIdentityFor(controller, "one-shot-gpu");
  const driver = createObjectSculptorCorpusFrameDriver({
    controller,
    performanceIdentity: identity,
    now: () => 0,
    requestFrame: scheduler.requestFrame,
    cancelFrame: scheduler.cancelFrame,
    onMetrics: () => {},
    onError: (error) => assert.fail(`adapter drift must reject before frame work: ${error.message}`),
  });
  visibleMetrics = {
    ...visibleMetrics,
    performanceAdapterIdentity: {
      ...visibleMetrics.performanceAdapterIdentity,
      name: "Different Adapter",
    },
  };
  await assert.rejects(
    driver.publicController.samplePerformanceFrame({ windowId: "adapter-drift" }),
    /changed the retained renderer-device adapter binding/,
  );
  assert.equal(scheduler.callbacks.size, 0);
  assert.equal(driver.getState(), "idle");
  await driver.close();
}

{
  const scheduler = createFrameScheduler();
  const controller = makeCadenceController();
  const driver = createObjectSculptorCorpusFrameDriver({
    controller,
    performanceIdentity: performanceIdentityFor(controller, "sustained-cadence"),
    now: (() => {
      let value = 0;
      return () => ++value;
    })(),
    requestFrame: scheduler.requestFrame,
    cancelFrame: scheduler.cancelFrame,
    onMetrics: () => {},
    onError: (error) => assert.fail(`unexpected continuous cadence error: ${error.message}`),
  });
  const windowPromise = driver.publicController.runCadenceWindow({
    windowId: "cadence-continuous-a",
    ...CANONICAL_CADENCE_OPTIONS,
  });
  const queuedRender = driver.publicController.renderOnce();
  const windowEvidence = await driveCadenceWindow(windowPromise, scheduler);
  assert.equal(windowEvidence.status, "diagnostic-continuous");
  assert.equal(
    windowEvidence.continuity.status,
    "driver-owned-back-to-back-raf-and-consecutive-controller-ordinals",
  );
  assert.equal(
    windowEvidence.observedSampleCount,
    CANONICAL_CADENCE_OPTIONS.warmupFrameCount
      + CANONICAL_CADENCE_OPTIONS.measuredFrameCount,
  );
  await queuedRender;
  assert.equal(
    driver.publicController.getMetrics().completedFrames,
    windowEvidence.observedSampleCount + 1,
    "an external render must remain queued until the driver-owned window closes",
  );
  assert.equal(driver.getState(), "idle");
  await driver.close();
}

{
  const scheduler = createFrameScheduler();
  const baseController = makeController();
  const rawRender = baseController.renderOnce.bind(baseController);
  let visibleMetrics = baseController.getMetrics();
  const controller = {
    ...baseController,
    getMetrics: () => visibleMetrics,
    async renderOnce() {
      await rawRender();
      visibleMetrics = baseController.getMetrics();
    },
  };
  const driver = createObjectSculptorCorpusFrameDriver({
    controller,
    performanceIdentity: performanceIdentityFor(controller, "one-shot-gpu"),
    now: (() => {
      let value = 0;
      return () => ++value;
    })(),
    requestFrame: scheduler.requestFrame,
    cancelFrame: scheduler.cancelFrame,
    onMetrics: () => {},
    onError: () => {},
  });
  const firstPromise = driver.publicController.samplePerformanceFrame({ windowId: "generation-a" });
  await resolveScheduledManualSample(firstPromise, scheduler, 16);
  visibleMetrics = {
    ...visibleMetrics,
    rendererDeviceGeneration: 2,
  };
  await assert.rejects(
    driver.publicController.samplePerformanceFrame({ windowId: "generation-a" }),
    /changed renderer or device-loss generation/,
  );
  assert.equal(scheduler.callbacks.size, 0, "generation drift must reject before another rAF");
  assert.equal(driver.getState(), "idle", "pre-admission identity drift must not poison unrelated driver work");
  await driver.close();
}

{
  const scheduler = createFrameScheduler();
  const errors = [];
  const controller = makeController();
  const driver = createObjectSculptorCorpusFrameDriver({
    controller,
    performanceIdentity: performanceIdentityFor(controller, "one-shot-gpu"),
    now: () => 0,
    requestFrame: scheduler.requestFrame,
    cancelFrame: scheduler.cancelFrame,
    onMetrics: () => {},
    onError: (error) => errors.push(error.message),
  });
  await assert.rejects(
    driver.publicController.samplePerformanceFrame({
      windowId: "caller-forgery",
      presentationTimestampMs: 16,
    }),
    /accept only windowId/,
  );
  const samplePromise = driver.publicController.samplePerformanceFrame({ windowId: "cancel-on-close" });
  await Promise.resolve();
  await Promise.resolve();
  assert.equal(scheduler.callbacks.size, 1);
  const closePromise = driver.close();
  assert.equal(driver.close(), closePromise, "manual-sample close must keep one terminal promise");
  await assert.rejects(samplePromise, /cancelled by driver close/);
  await closePromise;
  assert.equal(driver.close(), closePromise, "closed manual-sample driver must retain its terminal promise");
  assert.equal(driver.getState(), "closed");
  assert.equal(scheduler.cancellations.length, 1);
  assert.deepEqual(errors, [], "close-induced cancellation must not become a runtime error");
  assert.equal(driver.publicController.getMetrics().frameErrorCount, 0);
  const evidenceA = driver.publicController.getPerformanceWindowEvidence();
  const evidenceB = driver.publicController.getPerformanceWindowEvidence();
  assert.deepEqual(evidenceB, evidenceA, "terminal evidence must remain bounded and stable");
}

{
  const scheduler = createFrameScheduler();
  const errors = [];
  let cancelAttempts = 0;
  let disposeCalls = 0;
  const controller = makeController({
    async dispose() {
      disposeCalls += 1;
      return true;
    },
  });
  const driver = createObjectSculptorCorpusFrameDriver({
    controller,
    performanceIdentity: performanceIdentityFor(controller, "one-shot-gpu"),
    now: () => 0,
    requestFrame: scheduler.requestFrame,
    cancelFrame: () => {
      cancelAttempts += 1;
      throw new Error("synthetic manual cancel failure");
    },
    onMetrics: () => {},
    onError: (error) => errors.push({ message: error.message, code: error.code ?? null }),
  });
  const samplePromise = driver.publicController.samplePerformanceFrame({
    windowId: "cancel-throws-on-close",
  });
  for (let attempt = 0; attempt < 50 && scheduler.callbacks.size === 0; attempt += 1) {
    await Promise.resolve();
  }
  assert.equal(scheduler.callbacks.size, 1);
  const closeA = driver.close();
  const closeB = driver.close();
  assert.equal(closeA, closeB);
  await assert.rejects(
    samplePromise,
    (error) => error.code === "CORPUS_MANUAL_FRAME_CANCEL_FAILURE"
      && /synthetic manual cancel failure/.test(error.message),
  );
  await closeA;
  assert.equal(cancelAttempts, 1, "manual close must attempt cancellation only once");
  assert.equal(disposeCalls, 1, "manual cancel failure must still dispose exactly once");
  assert.deepEqual(errors, [{
    message: "synthetic manual cancel failure",
    code: "CORPUS_MANUAL_FRAME_CANCEL_FAILURE",
  }]);
  assert.equal(driver.getState(), "closed");
  assert.equal(driver.publicController.getMetrics().lifecycleErrorCount, 1);
  assert.deepEqual(
    driver.publicController.getPerformanceWindowEvidence().gpuTimestampPopulations,
    [],
  );
  assert.equal(
    await scheduler.take().callback(16),
    false,
    "a callback retained by a throwing cancel implementation must be inert after close",
  );
  assert.equal(scheduler.callbacks.size, 0);
  assert.equal(errors.length, 1, "stale callback must not emit a second terminal error");
}

{
  const scheduler = createFrameScheduler();
  const errors = [];
  const controller = makeCadenceController();
  const driver = createObjectSculptorCorpusFrameDriver({
    controller,
    performanceIdentity: performanceIdentityFor(controller, "sustained-cadence"),
    now: () => 0,
    requestFrame: scheduler.requestFrame,
    cancelFrame: scheduler.cancelFrame,
    onMetrics: () => {},
    onError: (error) => errors.push(error.message),
  });
  const cadencePromise = driver.publicController.runCadenceWindow({
    windowId: "cadence-close-cancel",
    ...CANONICAL_CADENCE_OPTIONS,
  });
  for (let attempt = 0; attempt < 50 && scheduler.callbacks.size === 0; attempt += 1) {
    await Promise.resolve();
  }
  assert.equal(scheduler.callbacks.size, 1);
  const closePromise = driver.close();
  assert.equal(driver.close(), closePromise);
  await assert.rejects(cadencePromise, /cancelled by driver close/);
  await closePromise;
  assert.deepEqual(errors, []);
  assert.equal(driver.publicController.getMetrics().frameErrorCount, 0);
  const cancelled = driver.publicController.getPerformanceWindowEvidence().sustainedCadenceWindows[0];
  assert.equal(cancelled.status, "cancelled-by-close");
  assert.equal(cancelled.completedCallbackCount, undefined);
  assert.equal(cancelled.continuity.completedCallbackCount, 0);
  assert.equal(scheduler.cancellations.length, 1);
  assert.equal(
    driver.publicController.getPerformanceWindowEvidence().sustainedCadenceWindows.length,
    1,
    "repeated close must not append terminal cadence outcomes",
  );
}

{
  const scheduler = createFrameScheduler();
  let releaseMode;
  let modeStarted;
  const modeStartedPromise = new Promise((resolve) => { modeStarted = resolve; });
  const modeGate = new Promise((resolve) => { releaseMode = resolve; });
  const controller = makeController({
    async setMode() {
      modeStarted();
      await modeGate;
      return true;
    },
  });
  const driver = createObjectSculptorCorpusFrameDriver({
    controller,
    performanceIdentity: performanceIdentityFor(controller, "one-shot-gpu"),
    now: () => 0,
    requestFrame: scheduler.requestFrame,
    cancelFrame: scheduler.cancelFrame,
    onMetrics: () => {},
    onError: (error) => assert.fail(`queued close must reject without poisoning: ${error.message}`),
  });
  const modePromise = driver.publicController.setMode("materials");
  await modeStartedPromise;
  const samplePromise = driver.publicController.samplePerformanceFrame({
    windowId: "queued-before-close",
  });
  const closePromise = driver.close();
  assert.equal(driver.getState(), "closing");
  assert.equal(scheduler.callbacks.size, 0, "queued sample must not own an rAF before admission");
  releaseMode();
  await modePromise;
  await assert.rejects(samplePromise, /frame driver is closing/);
  await closePromise;
  assert.equal(scheduler.callbacks.size, 0, "closed queued sample must never schedule an rAF");
  assert.equal(driver.getState(), "closed");
}

{
  let liveMetrics = makeMetrics();
  const controller = makeController({ getMetrics: () => liveMetrics });
  const driver = createObjectSculptorCorpusFrameDriver({
    controller,
    now: () => 0,
    requestFrame: () => 1,
    cancelFrame: () => {},
    onMetrics: () => {},
    onError: () => {},
  });
  liveMetrics = {
    ...liveMetrics,
    rendererDeviceStatus: "lost",
    deviceLossGeneration: 1,
  };
  assert.equal(driver.publicController.getMetrics().rendererDeviceStatus, "lost");
  assert.equal(driver.publicController.getMetrics().deviceLossGeneration, 1);
  await driver.close();
}

{
  const scheduler = createFrameScheduler();
  const events = [];
  const errors = [];
  let releaseStep;
  const stepGate = new Promise((resolve) => {
    releaseStep = resolve;
  });
  const controller = makeController({
    async step() {
      events.push("step:start");
      await stepGate;
      events.push("step:end");
    },
    async renderOnce() {
      events.push("render");
    },
    async setMode(mode) {
      events.push(`mode:${mode}`);
      return true;
    },
  });
  const driver = createObjectSculptorCorpusFrameDriver({
    controller,
    now: () => 0,
    requestFrame: scheduler.requestFrame,
    cancelFrame: scheduler.cancelFrame,
    onMetrics: () => {},
    onError: (error) => errors.push(error.message),
  });
  const facade = driver.publicController;

  assert.notEqual(facade, controller, "the page must never publish the raw controller");
  assert.equal(Object.isFrozen(facade), true);
  assert.equal("controller" in facade, false);
  assert.equal("mutate" in facade, false);
  assert.equal("mutate" in driver, false, "the driver must expose only explicit lifecycle and controller actions");
  assert.equal("close" in facade, false);
  assert.equal(Object.isFrozen(facade.getMetrics()), true, "public metrics must be a read-only driver snapshot");

  driver.start();
  const framePromise = scheduler.take().callback(16);
  const mutationPromise = facade.setMode("materials");
  await Promise.resolve();
  assert.deepEqual(events, ["step:start"], "the frame operation must hold the serialized lane");
  releaseStep();
  await Promise.all([framePromise, mutationPromise]);
  assert.deepEqual(events, ["step:start", "step:end", "render", "mode:materials"]);
  assert.deepEqual(errors, []);
  driver.suspend();
  await driver.close();
}

{
  const events = [];
  const errors = [];
  let releaseMode;
  const modeGate = new Promise((resolve) => {
    releaseMode = resolve;
  });
  const controller = makeController({
    async setMode(mode) {
      events.push(`mode:start:${mode}`);
      await modeGate;
      events.push(`mode:end:${mode}`);
      return true;
    },
    async renderOnce() {
      events.push("render");
    },
    async capturePixels() {
      events.push("capture");
      return { pixels: [1, 2, 3, 4] };
    },
    async resolveGpuTimestampSample() {
      events.push("resolve:gpu-render");
      return {
        status: "measured",
        scope: "render",
        gpuMs: 1,
        resolveOverheadMs: 0.1,
        rendererDeviceGeneration: 1,
        deviceLossGeneration: 0,
        frameOrdinal: 1,
        submissionOrdinal: 1,
      };
    },
    describeResources() {
      events.push("read:resources");
      return { activeTarget: "potted-bonsai" };
    },
    async dispose() {
      events.push("dispose");
      return true;
    },
  });
  const driver = createObjectSculptorCorpusFrameDriver({
    controller,
    now: () => 0,
    requestFrame: () => 1,
    cancelFrame: () => {},
    onMetrics: () => {},
    onError: (error) => errors.push(error.message),
  });
  const facade = driver.publicController;

  const modePromise = facade.setMode("hierarchy");
  const renderPromise = facade.renderOnce();
  const capturePromise = facade.capturePixels("presentation");
  const timestampPromise = facade.resolveGpuTimestampSample();
  const readPromise = facade.describeResources();
  await Promise.resolve();
  assert.deepEqual(events, ["mode:start:hierarchy"]);
  releaseMode();
  const [, , capture, timestamp, resources] = await Promise.all([
    modePromise,
    renderPromise,
    capturePromise,
    timestampPromise,
    readPromise,
  ]);
  assert.deepEqual(capture.pixels, [1, 2, 3, 4]);
  assert.equal(timestamp.gpuMs, 1);
  assert.equal(resources.activeTarget, "potted-bonsai");
  assert.deepEqual(events, [
    "mode:start:hierarchy",
    "mode:end:hierarchy",
    "render",
    "capture",
    "resolve:gpu-render",
    "read:resources",
  ]);
  assert.deepEqual(errors, []);
  await facade.drain();
  await driver.close();
  assert.equal(events.at(-1), "dispose");
}

{
  const scheduler = createFrameScheduler();
  const events = [];
  const errors = [];
  let releaseStep;
  const stepGate = new Promise((resolve) => {
    releaseStep = resolve;
  });
  const controller = makeController({
    async step() {
      events.push("step:start");
      await stepGate;
      events.push("step:end");
    },
    async renderOnce() {
      events.push("render");
    },
    async dispose() {
      events.push("dispose");
      return true;
    },
  });
  const driver = createObjectSculptorCorpusFrameDriver({
    controller,
    now: () => 0,
    requestFrame: scheduler.requestFrame,
    cancelFrame: scheduler.cancelFrame,
    onMetrics: () => {},
    onError: (error) => errors.push(error.message),
  });

  driver.start();
  const framePromise = scheduler.take().callback(16);
  await Promise.resolve();
  assert.deepEqual(events, ["step:start"]);
  const firstClose = driver.publicController.dispose();
  const secondClose = driver.publicController.dispose();
  assert.equal(firstClose, secondClose, "double close must share one terminal promise");
  assert.equal(driver.getState(), "closing");
  assert.deepEqual(events, ["step:start"], "close must drain rather than dispose across an in-flight step");
  await assert.rejects(driver.publicController.setMode("final"), /frame driver is closing/);
  releaseStep();
  await framePromise;
  await firstClose;
  assert.deepEqual(events, ["step:start", "step:end", "render", "dispose"]);
  assert.equal(driver.getState(), "closed");
  assert.deepEqual(errors, []);
}

{
  const errors = [];
  let disposeCalls = 0;
  let renderAttempts = 0;
  let controllerFrameErrors = 0;
  const controller = makeController({
    async renderOnce() {
      renderAttempts += 1;
      controllerFrameErrors += 1;
      throw new Error("synthetic corpus render failure");
    },
    getMetrics: () => makeMetrics({ frameErrorCount: controllerFrameErrors }),
    async setMode() {
      assert.fail("work queued behind a rejected render must not reach the controller");
    },
    async dispose() {
      disposeCalls += 1;
      return true;
    },
  });
  const driver = createObjectSculptorCorpusFrameDriver({
    controller,
    now: () => 100,
    requestFrame: () => 1,
    cancelFrame: () => {},
    onMetrics: () => {},
    onError: (error) => errors.push(error.message),
  });

  const rejectedRender = driver.publicController.renderOnce();
  const rejectedFrameFollower = driver.publicController.renderOnce();
  const rejectedLifecycleFollower = driver.publicController.setMode("materials");
  await assert.rejects(rejectedRender, /synthetic corpus render failure/);
  await assert.rejects(rejectedFrameFollower, /frame driver is failed/);
  await assert.rejects(rejectedLifecycleFollower, /frame driver is failed/);
  assert.equal(driver.getState(), "failed");
  assert.equal(renderAttempts, 1, "the second queued frame must fail before reaching the controller");
  assert.deepEqual(errors, ["synthetic corpus render failure"]);
  let metrics = driver.publicController.getMetrics();
  assert.equal(metrics.frameErrorCount, 2, "primary and suppressed back-to-back frame failures must remain cumulative");
  assert.equal(metrics.lifecycleErrorCount, 1, "a suppressed queued lifecycle action must remain cumulative");
  assert.deepEqual(metrics.errorCountEvidence, {
    controllerFrameErrorCount: 1,
    controllerLifecycleErrorCount: 0,
    driverFrameErrorCount: 1,
    driverLifecycleErrorCount: 1,
    frameErrorCount: 2,
    lifecycleErrorCount: 1,
  });
  await assert.rejects(driver.publicController.capturePixels(), /frame driver is failed/);
  metrics = driver.publicController.getMetrics();
  assert.equal(metrics.frameErrorCount, 3);
  const closeA = driver.close();
  const closeB = driver.close();
  assert.equal(closeA, closeB);
  await closeA;
  assert.equal(disposeCalls, 1, "a rejected render must still permit one drained terminal disposal");
  assert.equal(driver.getState(), "closed");
}

{
  const reported = [];
  const controller = makeController({
    async setMode() {
      return true;
    },
  });
  const driver = createObjectSculptorCorpusFrameDriver({
    controller,
    now: () => 0,
    requestFrame: () => 1,
    cancelFrame: () => {},
    onMetrics: () => {
      throw new Error("synthetic metrics observer failure");
    },
    onError: (error) => reported.push(error.message),
  });

  await assert.rejects(driver.publicController.setMode("final"), /synthetic metrics observer failure/);
  assert.equal(driver.getState(), "failed");
  assert.deepEqual(reported, ["synthetic metrics observer failure"]);
  assert.equal(driver.publicController.getMetrics().lifecycleErrorCount, 1);
  await driver.close();
}

{
  const scheduler = createFrameScheduler();
  const controller = makeController({
    async renderOnce() {
      throw new Error("synthetic primary render failure");
    },
  });
  const driver = createObjectSculptorCorpusFrameDriver({
    controller,
    now: () => 0,
    requestFrame: scheduler.requestFrame,
    cancelFrame: scheduler.cancelFrame,
    onMetrics: () => {},
    onError: () => {
      throw new Error("synthetic error observer failure");
    },
  });

  assert.equal(driver.start(), true);
  assert.equal(await scheduler.take().callback(16), false, "a rejected rAF render must terminate without an unhandled rejection");
  assert.equal(driver.getState(), "failed");
  assert.match(driver.getObserverFailure()?.message ?? "", /synthetic error observer failure/);
  assert.equal(driver.publicController.getMetrics().frameErrorCount, 1);
  assert.equal(driver.publicController.getMetrics().lifecycleErrorCount, 1);
  await driver.close();
}

{
  const events = [];
  let clockMs = 0;
  const scheduler = createFrameScheduler();
  const controller = makeController();
  const rawRender = controller.renderOnce.bind(controller);
  const rawResolve = controller.resolveGpuTimestampSample.bind(controller);
  controller.renderOnce = async () => {
    events.push("render");
    return rawRender();
  };
  controller.resolveGpuTimestampSample = async () => {
    events.push("resolve-render-timestamp");
    return rawResolve();
  };
  const driver = createObjectSculptorCorpusFrameDriver({
    controller,
    performanceIdentity: performanceIdentityFor(controller, "one-shot-gpu"),
    now: () => {
      clockMs += 1.5;
      return clockMs;
    },
    requestFrame: scheduler.requestFrame,
    cancelFrame: scheduler.cancelFrame,
    onMetrics: () => {},
    onError: (error) => assert.fail(`unexpected performance sample error: ${error.message}`),
  });
  const firstPromise = driver.publicController.samplePerformanceFrame({ windowId: "sustained-a" });
  await Promise.resolve();
  await Promise.resolve();
  await scheduler.take().callback(100);
  const first = await firstPromise;
  const secondPromise = driver.publicController.samplePerformanceFrame({ windowId: "sustained-a" });
  await Promise.resolve();
  await Promise.resolve();
  await scheduler.take().callback(116.7);
  const second = await secondPromise;
  assert.deepEqual(events, [
    "render",
    "resolve-render-timestamp",
    "render",
    "resolve-render-timestamp",
  ]);
  assert.equal(first.cpuSceneSubmitMs, 1.5);
  assert.equal(first.status, "diagnostic");
  assert.equal(first.timingAuthority.publishable, false);
  assert.equal(
    first.timingAuthority.acceptance,
    "DIAGNOSTIC-nonpublishable-injected-timing-authority",
  );
  assert.equal(first.deltaSeconds, 0);
  assert.equal(first.fixedTimeSeconds, 0);
  assert.equal(first.rafCallbackIntervalMs, null);
  assert.equal(second.rafCallbackIntervalMs, 16.700000000000003);
  assert.equal(second.presentationTimestampMs, null);
  assert.equal(second.presentationIntervalMs, null);
  assert.equal(
    second.presentationTimingStatus,
    "unavailable-no-compositor-presentation-feedback",
  );
  assert.equal(second.rendererDeviceGeneration, 1);
  assert.equal(second.gpuMs, 1.25);
  assert.equal(second.subjectId, "potted-bonsai");
  assert.equal(second.tier, "budgeted");
  assert.equal(second.measurementClass, "one-shot-gpu");
  assert.equal(controller.getMetrics().stepCount, 0, "one-shot GPU samples must stay fixed-time");
  assert.equal(
    second.cadenceAcceptance,
    "ineligible-blocking-gpu-timestamp-resolution-between-callbacks",
  );
  assert.equal(driver.publicController.getMetrics().performanceEvidenceLaneCounts.oneShotGpu.retainedSampleCount, 2);
  const evidence = await driver.publicController.getPerformanceEvidence();
  assert.equal(evidence.schemaVersion, CORPUS_PERFORMANCE_EVIDENCE_SCHEMA_VERSION);
  assert.equal(evidence.gpuTimestampPopulations.length, 1);
  assert.equal(evidence.gpuTimestampPopulations[0].status, "diagnostic-one-shot-scopes");
  assert.equal(evidence.timingAuthority.publishable, false);
  assert.equal(evidence.gpuTimestampPopulations[0].samples[1].windowSampleOrdinal, 2);
  assert.deepEqual(evidence.sustainedCadenceWindows, []);
  assert.equal("samples" in evidence, false, "separate performance lanes must not expose a combined population");
  assert.equal(evidence.presentationTiming.verdict, "NOT_CLAIMED");
  assert.equal(evidence.controller.status, "measured-not-accepted-pending-sustained-windows");
  assert.equal(evidence.controller.rawSamplePayloadsExcluded, true);
  assert.equal("samples" in evidence.controller, false);
  assert.equal("cpuRenderSubmissions" in evidence.controller, false);
  assert.equal(Object.isFrozen(evidence), true);
  await driver.close();
}

{
  const scheduler = createFrameScheduler();
  let resolveCalls = 0;
  let clockMs = 0;
  const controller = makeController({
    async resolveGpuTimestampSample() {
      resolveCalls += 1;
      for (let index = 0; index < 100; index += 1) await Promise.resolve();
      throw new Error("cadence path must not await the deliberately slow GPU timestamp resolver");
    },
  }, {
    runtimeProfile: "performance",
    performanceTimestampMode: "disabled-for-cadence",
    timestampQueriesRequired: false,
    timestampQueriesActive: false,
    rendererBackendEvidence: {
      backendType: "WebGPUBackend",
      deviceType: "GPUDevice",
      deviceLabel: "test-device",
      deviceIdentitySource: "renderer.backend.device-after-init",
      deviceIdentityVerified: true,
      timestampQueryFeatureOnActualDevice: true,
      backendTimestampTrackingActive: false,
    },
  });
  const driver = createObjectSculptorCorpusFrameDriver({
    controller,
    performanceIdentity: performanceIdentityFor(controller, "sustained-cadence"),
    now: () => {
      clockMs += 2;
      return clockMs;
    },
    requestFrame: scheduler.requestFrame,
    cancelFrame: scheduler.cancelFrame,
    onMetrics: () => {},
    onError: (error) => assert.fail(`unexpected no-resolve cadence error: ${error.message}`),
  });
  const windowPromise = driver.publicController.runCadenceWindow({
    windowId: "cadence-a",
    ...CANONICAL_CADENCE_OPTIONS,
  });
  const windowEvidence = await driveCadenceWindow(windowPromise, scheduler, { intervalMs: 16.5 });
  assert.equal(windowEvidence.status, "diagnostic-continuous");
  assert.equal(windowEvidence.warmupSamples.length, CANONICAL_CADENCE_OPTIONS.warmupFrameCount);
  assert.equal(windowEvidence.samples.length, CANONICAL_CADENCE_OPTIONS.measuredFrameCount);
  assert.equal(windowEvidence.samples[0].measurementClass, "sustained-cadence");
  assert.equal(
    windowEvidence.samples[0].cadenceAcceptance,
    "diagnostic-dependency-injected-timing-not-publishable",
  );
  assert.equal(windowEvidence.samples[0].gpuTimestampResolutionCalls, 0);
  assert.equal(resolveCalls, 0, "a deliberately slow resolver must be absent from cadence windows");
  assert.equal(windowEvidence.samples[0].cpuSceneSubmitMs, 2);
  assert.equal(controller.getMetrics().stepCount, 0, "fixed-time cadence must never advance history");
  assert.equal(windowEvidence.summary.callbackIntervalP50Ms, 16.5);
  assert.equal(windowEvidence.summary.callbackIntervalP95Ms, 16.5);
  assert.equal(windowEvidence.summary.deadlineMissCount, 0);
  assert.equal(windowEvidence.finalHealth.status, "DIAGNOSTIC");
  await assert.rejects(
    driver.publicController.runCadenceWindow({
      windowId: "cadence-a",
      ...CANONICAL_CADENCE_OPTIONS,
    }),
    /already exists/,
  );
  assert.equal(scheduler.callbacks.size, 0, "a cadence window ID cannot be resumed or appended");
  const evidence = driver.publicController.getPerformanceWindowEvidence();
  assert.deepEqual(evidence.gpuTimestampPopulations, []);
  assert.equal(evidence.sustainedCadenceWindows.length, 1);
  assert.equal(
    evidence.sustainedCadenceWindows[0].measuredSampleCount,
    CANONICAL_CADENCE_OPTIONS.measuredFrameCount,
  );
  assert.equal(evidence.finalHealth.status, "DIAGNOSTIC");
  assert.equal(
    evidence.acceptance.sustainedCadence,
    "DIAGNOSTIC-all-windows-use-nonpublishable-performance-authority",
  );
  assert.match(evidence.acceptance.sustainedGpu, /^INSUFFICIENT_EVIDENCE/);
  assert.match(evidence.acceptance.thermal, /^INSUFFICIENT_EVIDENCE/);
  assert.match(evidence.acceptance.separationRule, /no combined sample population/);
  await driver.close();
}

{
  const scheduler = createFrameScheduler();
  const errors = [];
  const controller = makeCadenceController();
  const driver = createObjectSculptorCorpusFrameDriver({
    controller,
    performanceIdentity: performanceIdentityFor(controller, "sustained-cadence"),
    now: (() => {
      let value = 0;
      return () => ++value;
    })(),
    requestFrame: scheduler.requestFrame,
    cancelFrame: scheduler.cancelFrame,
    onMetrics: () => {},
    onError: (error) => errors.push(error.message),
  });
  const windowPromise = driver.publicController.runCadenceWindow({
    windowId: "cadence-too-short",
    ...CANONICAL_CADENCE_OPTIONS,
  });
  const windowEvidence = await driveCadenceWindow(windowPromise, scheduler, { intervalMs: 1 });
  assert.equal(windowEvidence.status, "insufficient-duration");
  assert.equal(
    windowEvidence.summary.measuredDurationMs,
    CANONICAL_CADENCE_OPTIONS.measuredFrameCount,
  );
  assert.equal(
    windowEvidence.summary.minimumMeasuredDurationMs,
    CORPUS_CADENCE_WINDOW_LIMITS.minMeasuredDurationMs,
  );
  assert.equal(windowEvidence.samples[0].status, "diagnostic");
  assert.notEqual(windowEvidence.samples[0].cadenceAcceptance, "eligible");
  assert.equal(
    driver.publicController.getPerformanceWindowEvidence().acceptance.sustainedCadence,
    "FAIL-one-or-more-windows-missed-runtime-duration-or-p95-gates",
  );
  assert.deepEqual(errors, []);
  await driver.close();
}

{
  const scheduler = createFrameScheduler();
  const controller = makeController();
  const driver = createObjectSculptorCorpusFrameDriver({
    controller,
    performanceIdentity: performanceIdentityFor(controller, "one-shot-gpu"),
    now: () => 0,
    requestFrame: scheduler.requestFrame,
    cancelFrame: scheduler.cancelFrame,
    onMetrics: () => {},
    onError: (error) => assert.fail(`unexpected frame-owner conflict observer: ${error.message}`),
  });
  assert.equal(driver.start(), true);
  await assert.rejects(
    driver.publicController.samplePerformanceFrame({
      windowId: "forbidden-overlap",
    }),
    (error) => error.code === "CORPUS_FRAME_OWNER_CONFLICT",
  );
  assert.equal(driver.getState(), "running", "manual sample rejection must not stop the live owner");
  assert.equal(driver.publicController.getMetrics().performanceEvidenceLaneCounts.oneShotGpu.retainedSampleCount, 0);
  driver.suspend();
  await driver.close();
}

{
  const errors = [];
  const controller = makeController({
    async resolveGpuTimestampSample() {
      const error = new Error("synthetic timestamp resolve failure");
      error.code = "CORPUS_GPU_TIMESTAMP_UNAVAILABLE";
      throw error;
    },
  });
  let clockMs = 0;
  const scheduler = createFrameScheduler();
  const driver = createObjectSculptorCorpusFrameDriver({
    controller,
    performanceIdentity: performanceIdentityFor(controller, "one-shot-gpu"),
    now: () => ++clockMs,
    requestFrame: scheduler.requestFrame,
    cancelFrame: scheduler.cancelFrame,
    onMetrics: () => {},
    onError: (error) => errors.push(error.message),
  });
  const failedSample = driver.publicController.samplePerformanceFrame({
    windowId: "timestamp-failure",
  });
  await Promise.resolve();
  await Promise.resolve();
  await scheduler.take().callback(16);
  await assert.rejects(
    failedSample,
    /synthetic timestamp resolve failure/,
  );
  assert.equal(driver.getState(), "failed", "timestamp-required sample failure must fail closed");
  assert.equal(driver.publicController.getMetrics().performanceEvidenceLaneCounts.oneShotGpu.retainedSampleCount, 0);
  assert.deepEqual(errors, ["synthetic timestamp resolve failure"]);
  await driver.close();
}

console.log(JSON.stringify({
  ok: true,
  lifecycleCases: [
    "capture-owner",
    "duplicate-capture-query-rejection",
    "conflicting-capture-query-rejection",
    "route-lock-state",
    "scenario-alias-lock",
    "programmatic-disabled-control-restore",
    "unlocked-change-and-restore",
    "route-lock-does-not-poison-lane",
    "terminal-state-before-route-lock",
    "delta-cap",
    "single-render-per-frame",
    "serialized-public-facade",
    "serialized-render-and-capture",
    "bfcache-suspend-restore",
    "in-flight-close-drain",
    "double-close",
    "rejected-render",
    "queued-work-rejected-after-failure",
    "cumulative-frame-and-lifecycle-errors",
    "serialized-diagnostic-read",
    "live-owner-rejects-public-manual-frame-operations",
    "immutable-performance-identity-schema",
    "physical-browser-only-performance-identity",
    "physical-performance-session-required-for-publication",
    "caller-frozen-session-lookalike-cannot-publish",
    "immutable-cadence-target-count-and-duration-contract",
    "retained-adapter-renderer-device-identity",
    "software-adapter-performance-is-diagnostic-only",
    "strict-error-viewport-camera-time-and-quaternion-metrics",
    "missing-performance-identity-fails-before-frame-work",
    "performance-lanes-are-noninterchangeable",
    "manual-performance-frame-single-owner",
    "fixed-time-one-shot-gpu-render-workload",
    "driver-owned-continuous-raf-cadence-window",
    "captured-browser-intrinsics-resist-late-global-forgery",
    "dependency-injected-timing-is-diagnostic-only",
    "explicit-cadence-warmup-and-measured-minimums",
    "insufficient-cadence-duration-is-not-accepted",
    "over-budget-cadence-is-not-accepted",
    "cadence-p50-p95-and-deadline-summary",
    "manual-performance-presentation-feedback-unavailable",
    "performance-evidence-has-no-combined-population",
    "bounded-performance-window-and-sample-retention",
    "bounded-performance-limit-rejection-before-raf",
    "sustained-cadence-no-timestamp-resolve-lane",
    "one-shot-gpu-cadence-ineligible",
    "close-cancellation-is-not-runtime-failure",
    "throwing-manual-cancel-is-bounded-and-disposes-once",
    "cadence-close-cancellation-seals-cancelled-window",
    "queued-manual-sample-close-admission",
    "fixed-time-history-pipeline-and-resource-workload-binding",
    "resource-signature-drift-rejection",
    "manual-performance-window-discontinuity-rejection",
    "cadence-window-serializes-external-frame-work",
    "post-window-device-loss-invalidates-health",
    "manual-performance-device-generation-drift-rejection",
    "manual-performance-forged-gpu-schema-negatives",
    "timestamp-resolution-fail-closed",
    "async-device-metrics-refresh",
    "observer-failure-boundaries",
  ],
}, null, 2));
