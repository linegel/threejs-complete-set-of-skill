import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import {
  mkdtempSync,
  readFileSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { deflateSync } from "node:zlib";

import { encodeRgbaPng } from "../../../scripts/lib/png-rgba.mjs";
import { SCULPT_TIERS } from "../shared/sculpt-runtime.js";
import { SCULPT_TARGET_IDS } from "./object-catalog.js";
import {
  CORPUS_CAPTURE_PLAN,
  CORPUS_RASTER_COMPARISON_PLAN,
  CORPUS_RASTER_GATES,
  computeCorpusRasterComparisons,
} from "./capture-hook.mjs";
import { resolveCorpusInitialState } from "./route-state.js";
import {
  CORPUS_PHYSICAL_ROUTE_PLAN,
  validatePhysicalRouteRuntimeRecords,
} from "./validate-routes.mjs";
import {
  CORPUS_VISUAL_INVARIANT_PLAN,
  REQUIRED_ACCEPTANCE_GATES,
  validateCorpusArtifacts,
} from "./validate-artifacts.mjs";
import { comparePngRgb, decodePngRaster } from "./png-raster.mjs";

const LAB_ID = "webgpu-object-sculptor-corpus";
const BUNDLE_ID = "bundle-fixture-0001";
const RUN_BINDINGS = Object.freeze({
  correctness: "correctness-run-fixture-0001",
  routes: "routes-run-fixture-0001",
  performance: "performance-run-fixture-0001",
  lifecycle: "lifecycle-run-fixture-0001",
});
const BACKEND = Object.freeze({
  kind: "webgpu",
  nativeWebGPU: true,
  rendererType: "WebGPURenderer",
  backendType: "WebGPUBackend",
  threeRevision: "185",
  outputColorSpace: "srgb",
});
const RESOURCE_CATEGORIES = Object.freeze([
  "renderer",
  "target-geometry",
  "target-materials",
  "shadow",
  "capture-target",
  "readback-staging",
]);
const LIFECYCLE_CASE_IDS = Object.freeze([
  "resize",
  "dpr-change",
  "tier-change",
  "mode-change",
  "history-reset",
  "subject-replace",
  "dispose-recreate",
  "device-error-recovery",
]);
const ACCEPTANCE_FILES = Object.freeze({
  "native-webgpu": ["capture-session.json", "evidence-manifest.json"],
  "physical-route-matrix": ["route-runtime-evidence.json"],
  "subject-distinctness": ["visual-contract.json", "visual-error-results.json"],
  "authored-contract-visual-review": ["visual-contract.json", "visual-reviews.json"],
  "action-motion-delta": ["visual-contract.json", "visual-error-results.json"],
  "tier-visual-error": ["visual-contract.json", "visual-error-results.json"],
  "sustained-performance": ["timing-trace.json"],
  "resource-ownership": ["resource-ledger.json"],
  lifecycle: ["lifecycle-evidence.json"],
});

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

const TEST_CRC_TABLE = new Uint32Array(256);
for (let index = 0; index < 256; index += 1) {
  let value = index;
  for (let bit = 0; bit < 8; bit += 1) value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
  TEST_CRC_TABLE[index] = value >>> 0;
}

function testCrc32(bytes) {
  let crc = 0xffffffff;
  for (const byte of bytes) crc = TEST_CRC_TABLE[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

function testPngChunk(type, data = Buffer.alloc(0)) {
  const typeBytes = Buffer.from(type, "ascii");
  const output = Buffer.alloc(data.length + 12);
  output.writeUInt32BE(data.length, 0);
  typeBytes.copy(output, 4);
  data.copy(output, 8);
  output.writeUInt32BE(testCrc32(Buffer.concat([typeBytes, data])), 8 + data.length);
  return output;
}

function encodeRgbPng({ width, height, rgb, bitDepth = 8, interlace = 0, includeSrgb = true }) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = bitDepth;
  ihdr[9] = 2;
  ihdr[12] = interlace;
  const scanlines = Buffer.alloc((width * 3 + 1) * height);
  for (let y = 0; y < height; y += 1) Buffer.from(rgb).copy(scanlines, y * (width * 3 + 1) + 1, y * width * 3, (y + 1) * width * 3);
  return Buffer.concat([
    Buffer.from("89504e470d0a1a0a", "hex"),
    testPngChunk("IHDR", ihdr),
    ...(includeSrgb ? [testPngChunk("sRGB", Buffer.from([0]))] : []),
    testPngChunk("IDAT", deflateSync(scanlines)),
    testPngChunk("IEND"),
  ]);
}

function fileReference(directory, path) {
  return Object.freeze({ path, sha256: sha256(readFileSync(join(directory, path))) });
}

function writeJson(directory, filename, value) {
  writeFileSync(join(directory, filename), `${JSON.stringify(value, null, 2)}\n`);
  return fileReference(directory, filename);
}

function datum(value, unit, label, source) {
  return Object.freeze({ value, unit, label, source });
}

function pixelBytesForState(state) {
  const stableState = {
    subjectId: state.subjectId,
    mode: state.mode,
    tier: state.tier,
    camera: state.camera,
    seed: state.seed,
    time: state.time,
  };
  const digest = createHash("sha256").update(JSON.stringify(stableState)).digest();
  return Uint8Array.of(digest[0], digest[1], digest[2], 255);
}

function routeRecords() {
  return CORPUS_PHYSICAL_ROUTE_PLAN.map((route) => {
    const routeState = resolveCorpusInitialState({
      scenario: null,
      mechanism: null,
      tier: null,
      camera: null,
      [route.kind]: route.id,
    });
    const baselineState = {
      subjectId: routeState.scenario,
      scenario: routeState.scenario,
      mode: routeState.mechanism,
      tier: routeState.tier,
      camera: routeState.camera,
      seed: 1,
      time: 0,
    };
    const dimensions = {
      scenario: { selectorId: "subject", stateField: "subjectId", methods: ["setSubject", "setScenario"], values: SCULPT_TARGET_IDS },
      mechanism: { selectorId: "mode", stateField: "mode", methods: ["setMode"], values: ["final", "blockout", "hierarchy", "materials", "action-ready"] },
      tier: { selectorId: "tier", stateField: "tier", methods: ["setTier"], values: ["full", "budgeted", "minimum"] },
      camera: { selectorId: "camera", stateField: "camera", methods: ["setCamera"], values: ["design", "profile", "attachment", "close-material"] },
    };
    const dimension = dimensions[route.kind];
    const attemptedValue = dimension.values.find((value) => value !== route.id);
    const selectors = [
      { id: "subject", value: routeState.scenario, disabled: route.selectorId === "subject" },
      { id: "mode", value: routeState.mechanism, disabled: route.selectorId === "mode" },
      { id: "tier", value: routeState.tier, disabled: route.selectorId === "tier" },
      { id: "camera", value: routeState.camera, disabled: route.selectorId === "camera" },
    ];
    const enabledSelectorIds = selectors.filter(({ disabled }) => !disabled).map(({ id }) => id);
    const locks = Object.fromEntries(Object.entries(dimensions).map(([dimensionId, spec]) => [dimensionId, {
      dimension: dimensionId,
      selectorId: spec.selectorId,
      locked: dimensionId === route.kind,
      lockedValue: dimensionId === route.kind ? route.id : null,
      controllerMethods: spec.methods,
    }]));
    const lockResult = (method, ordinal) => ({
      code: "CORPUS_ROUTE_LOCKED",
      status: "rejected",
      reason: "route-dimension-immutable",
      dimension: route.kind,
      selectorId: route.selectorId,
      method,
      lockedValue: route.id,
      requestedValue: attemptedValue,
      currentValue: route.id,
      stateChanged: false,
      fulfilled: true,
      returnValue: false,
      rejectionOrdinal: ordinal,
    });
    const uiResult = lockResult(dimension.methods[0], 1);
    const controllerProbes = dimension.methods.map((method, index) => ({
      method,
      attemptedValue,
      fulfilled: true,
      returnValue: false,
      error: null,
      beforeState: baselineState,
      afterState: baselineState,
      result: lockResult(method, index + 2),
    }));
    const unlockedProbes = Object.entries(dimensions).filter(([dimensionId]) => dimensionId !== route.kind).map(([, spec]) => ({
      selectorId: spec.selectorId,
      attemptedValue: spec.values.find((value) => value !== baselineState[spec.stateField]),
      changeResult: true,
      restoreResult: true,
      finalState: baselineState,
    }));
    return {
      routeId: route.routeId,
      kind: route.kind,
      id: route.id,
      urlPath: route.urlPath,
      location: {
        requestedPathname: `/threejs-object-sculptor/examples/webgpu-object-sculptor-corpus/${route.urlPath}`,
        finalPathname: `/threejs-object-sculptor/examples/webgpu-object-sculptor-corpus/${route.urlPath}`,
        search: "?capture=1",
        responseStatus: 200,
        observersInstalledBeforeNavigation: true,
      },
      documentRoute: { kind: route.kind, id: route.id },
      selectors,
      baselineState,
      routeLock: {
        state: {
          code: "CORPUS_ROUTE_LOCK_STATE",
          locks,
          lockedDimensions: [route.kind],
          lockedDimension: route.kind,
          lockedSelectorId: route.selectorId,
          lockedValue: route.id,
          disabledSelectorIds: [route.selectorId],
          enabledSelectorIds,
        },
        lockedSelectorId: route.selectorId,
        lockedValue: route.id,
        disabledSelectorIds: [route.selectorId],
        enabledSelectorIds,
        uiProbe: {
          attemptedValue,
          changeEvents: 1,
          fulfilled: true,
          returnValue: false,
          beforeState: baselineState,
          afterState: baselineState,
          beforeSelectorValue: route.id,
          afterSelectorValue: route.id,
          result: uiResult,
        },
        controllerProbes,
        unlockedProbes,
      },
      firstFrame: {
        owner: "capture-harness",
        before: { firstFrameCompleted: false, completedFrames: 0, renderSubmissions: 0 },
        after: { firstFrameCompleted: true, completedFrames: 1, renderSubmissions: 1 },
      },
      postProbeRender: {
        owner: "capture-harness",
        before: { firstFrameCompleted: true, completedFrames: 1, renderSubmissions: 1 },
        after: { firstFrameCompleted: true, completedFrames: 2, renderSubmissions: 2 },
      },
      runtime: {
        backend: "webgpu",
        nativeWebGPU: true,
        initialized: true,
        firstFrameCompleted: true,
        completedFrames: 2,
        renderSubmissions: 2,
        rendererType: "WebGPURenderer",
        backendType: "WebGPUBackend",
        frameErrorCount: 0,
        lifecycleErrorCount: 0,
        routeLockRejectCount: 1 + dimension.methods.length,
        lastRouteLockResult: controllerProbes.at(-1).result,
        lastFrameError: null,
        lastLifecycleError: null,
      },
      errorChannels: {
        pageErrors: { observerInstalled: true, events: [] },
        consoleErrors: { observerInstalled: true, events: [] },
        unhandledRejections: { observerInstalled: true, events: [] },
        requestFailures: { observerInstalled: true, events: [] },
        gpuErrors: { observerInstalled: true, events: [] },
        deviceLost: { monitorAttached: true, event: null },
      },
      labError: null,
    };
  });
}

function commonDocument(runId) {
  return {
    schemaVersion: 2,
    labId: LAB_ID,
    bundleId: BUNDLE_ID,
    runId,
    backend: BACKEND,
  };
}

function makeFixtureBundle() {
  const directory = mkdtempSync(join(tmpdir(), "object-sculptor-evidence-"));
  const captureFiles = new Map();
  for (const planned of CORPUS_CAPTURE_PLAN) {
    const png = encodeRgbaPng({ width: 1, height: 1, data: pixelBytesForState(planned.state) });
    writeFileSync(join(directory, planned.filename), png);
    captureFiles.set(planned.filename, fileReference(directory, planned.filename));
  }

  const captures = CORPUS_CAPTURE_PLAN.map((planned, index) => {
    const generation = planned.state.seedPhase === "B" ? 2 : planned.state.seedPhase === "A1" ? 3 : 1;
    const previousGeneration = planned.state.seedPhase === "B" ? 1 : planned.state.seedPhase === "A1" ? 2 : null;
    return {
      filename: planned.filename,
      state: planned.state,
      target: "presentation",
      width: 1,
      height: 1,
      bytesPerPixel: 4,
      bytesPerRow: 4,
      sourceBytesPerRow: 256,
      sourceByteLength: 4,
      transportByteLength: 4,
      sourceLayout: "padded",
      format: "rgba8",
      colorEncoding: "srgb",
      packedBytesPerRow: 4,
      sourceRowStride: 256,
      outputColorSpace: "srgb",
      captureSource: "native-webgpu-render-target-readback",
      file: captureFiles.get(planned.filename),
      runtimeState: {
        subjectId: planned.state.subjectId,
        mode: planned.state.mode,
        tier: planned.state.tier,
        camera: planned.state.camera,
        seed: planned.state.seed,
        time: planned.state.time,
        backend: "webgpu",
        nativeWebGPU: true,
        initialized: true,
        firstFrameCompleted: true,
        renderSubmissions: index + 2,
        completedFrames: index + 2,
        lastFrameError: null,
      },
      identityEvidence: {
        instanceId: "active-preview",
        instanceGeneration: generation,
        previousGeneration,
        continuityStatus: generation === 1 ? "explicit-instance-established" : "explicit-continuity-changed-new-generation",
        effectiveToken: `${planned.state.subjectId}:seed:${planned.state.seed}`,
        nodeIds: ["root"],
        socketIds: ["socket-main"],
        colliderIds: ["collider-main"],
        destructionGroupIds: ["destruction-main"],
        protectedNodeIds: ["root"],
        protectedSocketIds: ["socket-main"],
        protectedColliderIds: ["collider-main"],
        protectedDestructionGroupIds: ["destruction-main"],
      },
    };
  });
  const rasterComparisons = computeCorpusRasterComparisons((filename) => readFileSync(join(directory, filename)));

  const tierContracts = Object.fromEntries(SCULPT_TARGET_IDS.map((subjectId) => [
    subjectId,
    Object.fromEntries(SCULPT_TIERS.map((tier) => [tier, {
      subjectId,
      targetContractId: subjectId,
      tier,
      nodeIds: ["root"],
      socketIds: ["socket-main"],
      colliderIds: ["collider-main"],
      destructionGroupIds: ["destruction-main"],
      protectedNodeIds: ["root"],
      protectedSocketIds: ["socket-main"],
      protectedColliderIds: ["collider-main"],
      protectedDestructionGroupIds: ["destruction-main"],
      colliderConstructionInputs: [{ id: "collider-main" }],
      canonicalPhysicsProxyStatus: "blocked pending adapter",
    }])),
  ]));

  const captureSession = {
    schemaVersion: 2,
    labId: LAB_ID,
    sourceHash: null,
    buildRevision: "fixture-build-v1",
    profile: "correctness",
    profileConfig: { width: 1, height: 1, dpr: 1 },
    browserEntry: "threejs-object-sculptor/examples/webgpu-object-sculptor-corpus/index.html",
    url: "http://127.0.0.1/corpus/?capture=1&profile=correctness",
    runtime: {
      metrics: {
        backend: "webgpu",
        nativeWebGPU: true,
        initialized: true,
        firstFrameCompleted: true,
        lastFrameError: null,
      },
      pipeline: {
        owner: "WebGPURenderer",
        sceneRendersPerFrame: 1,
        passes: ["forward-scene"],
        mrt: false,
        postprocessing: false,
        toneMapping: "ACESFilmicToneMapping",
        outputColorSpace: "srgb",
        finalOutputOwner: "renderer",
      },
      resources: {},
    },
    hookResult: {
      schemaVersion: 2,
      evidenceRunId: RUN_BINDINGS.correctness,
      captures,
      tierContracts,
      backendProof: {
        backend: "webgpu",
        nativeWebGPU: true,
        initialized: true,
        firstFrameCompleted: true,
        rendererType: "WebGPURenderer",
        backendType: "WebGPUBackend",
        threeRevision: "185",
        pipelineOwner: "WebGPURenderer",
        sceneRendersPerFrame: 1,
        finalOutputOwner: "renderer",
        outputColorSpace: "srgb",
      },
      frameOwnership: {
        owner: "capture-harness",
        livePageFrameLoop: "disabled-by-capture-route",
        captureQuery: "1",
      },
      physicalRoutePlan: CORPUS_PHYSICAL_ROUTE_PLAN,
      rasterComparisonPlan: CORPUS_RASTER_COMPARISON_PLAN,
      rasterComparisons,
      evidenceStatus: "INSUFFICIENT_EVIDENCE",
      note: "Fixture capture session is not acceptance by itself.",
    },
    pageErrors: [],
    note: "Fixture capture-session record.",
  };
  const captureSessionRef = writeJson(directory, "capture-session.json", captureSession);

  const routeEvidenceRef = writeJson(directory, "route-runtime-evidence.json", {
    ...commonDocument(RUN_BINDINGS.routes),
    routes: routeRecords(),
  });

  const visualContract = {
    ...commonDocument(RUN_BINDINGS.correctness),
    contractId: "object-sculptor-corpus-visual-v1",
    invariants: CORPUS_VISUAL_INVARIANT_PLAN.map((invariant) => {
      return {
        id: invariant.id,
        metricId: invariant.metricId,
        domain: invariant.domain,
        statistic: invariant.statistic,
        comparison: invariant.comparison,
        threshold: datum(invariant.thresholdValue, invariant.unit, "Gated", `CORPUS_VISUAL_INVARIANT_PLAN:${invariant.id}`),
        captureFiles: invariant.captureFilenames.map((filename) => captureFiles.get(filename)),
      };
    }),
  };
  const visualContractRef = writeJson(directory, "visual-contract.json", visualContract);

  const visualReviews = {
    ...commonDocument(RUN_BINDINGS.correctness),
    reviews: SCULPT_TARGET_IDS.map((subjectId) => ({
      subjectId,
      mode: "final",
      reviewBasis: "authored-contract",
      renderImage: captureFiles.get(`${subjectId}.final.full.design.png`),
      contractArtifact: visualContractRef,
      aiVisionScore: datum(0.9, "score", "Measured", "fixture AI review"),
      acceptanceThreshold: datum(0.8, "score", "Gated", "fixture authored-contract gate"),
      criticalFeatures: [{
        id: "feature-main",
        score: datum(0.9, "score", "Measured", "fixture critical-feature review"),
        threshold: datum(0.8, "score", "Gated", "fixture critical-feature gate"),
      }],
    })),
  };
  writeJson(directory, "visual-reviews.json", visualReviews);

  const visualErrors = {
    ...commonDocument(RUN_BINDINGS.correctness),
    contractId: visualContract.contractId,
    results: CORPUS_VISUAL_INVARIANT_PLAN.map((invariant, index) => {
      const contract = visualContract.invariants[index];
      const measurement = invariant.comparison === "lte"
        ? (invariant.id.startsWith("representative-replay:") ? 0 : 0.2)
        : (invariant.unit === "score" ? 0.9 : 0.5);
      return {
        id: invariant.id,
        metricId: invariant.metricId,
        comparison: invariant.comparison,
        measurement: datum(measurement, invariant.unit, "Measured", `fixture measurement for ${invariant.id}`),
        threshold: contract.threshold,
        captureFiles: contract.captureFiles,
      };
    }),
  };
  writeJson(directory, "visual-error-results.json", visualErrors);

  const timingWindow = (id) => ({
    id,
    sampleCount: datum(12, "sample", "Measured", `${id} sample count`),
    cpuP50Ms: datum(3, "ms", "Measured", `${id} CPU p50`),
    cpuP95Ms: datum(5, "ms", "Measured", `${id} CPU p95`),
    gpuP50Ms: datum(3, "ms", "Measured", `${id} GPU p50`),
    gpuP95Ms: datum(5, "ms", "Measured", `${id} GPU p95`),
    presentationP95Ms: datum(15, "ms", "Measured", `${id} presentation p95`),
    deadlineMisses: datum(0, "count", "Measured", `${id} deadline misses`),
  });
  writeJson(directory, "timing-trace.json", {
    ...commonDocument(RUN_BINDINGS.performance),
    targetDevice: {
      id: "fixture-device-01",
      kind: "physical",
      device: "Fixture physical device",
      os: "Fixture OS",
      browser: "Fixture browser",
      adapter: null,
    },
    displayRefreshHz: datum(60, "Hz", "Measured", "fixture display measurement"),
    targetPresentationRateHz: datum(60, "Hz", "Gated", "fixture target cadence"),
    refreshPeriodMs: datum(1000 / 60, "ms", "Derived", "1000 / targetPresentationRateHz"),
    cpuSceneEnvelopeMs: datum(12, "ms", "Derived", "fixture refresh reserve model"),
    gpuSceneEnvelopeMs: datum(12, "ms", "Derived", "fixture refresh reserve model"),
    cpuP95GateMs: datum(10, "ms", "Gated", "fixture CPU envelope"),
    gpuP95GateMs: datum(10, "ms", "Gated", "fixture GPU envelope"),
    presentationP95GateMs: datum(16, "ms", "Gated", "fixture presentation envelope"),
    deadlineMissGate: datum(0, "count", "Gated", "fixture deadline gate"),
    minimumSamplesPerWindow: datum(10, "sample", "Gated", "fixture sampling gate"),
    gpuTimingRequirement: "required",
    timestampTrackingEnabled: true,
    gpuTimestampSupport: true,
    gpuTimestampScopes: [{
      id: "forward-scene",
      kind: "render",
      resolved: true,
      sampleCount: datum(12, "sample", "Measured", "fixture timestamp samples"),
      p50Ms: datum(3, "ms", "Measured", "fixture timestamp p50"),
      p95Ms: datum(5, "ms", "Measured", "fixture timestamp p95"),
    }],
    coldWindows: [timingWindow("cold-window-01")],
    sustainedWindows: [timingWindow("sustained-window-01"), timingWindow("sustained-window-02")],
    finalStableWindowId: "sustained-window-02",
  });

  const resourceRows = RESOURCE_CATEGORIES.map((category, index) => ({
    id: `${category}-row-${index}`,
    category,
    owner: `runtime-owner-${index}`,
    logicalBytes: datum(100 + index, "byte", "Derived", `${category} descriptor formula`),
    residentBytes: datum(80 + index, "byte", "Derived", `${category} residency formula`),
    peakLiveBytes: datum(90 + index, "byte", "Derived", `${category} liveness formula`),
    readBytesPerFrame: datum(10 + index, "byte/frame", "Derived", `${category} compulsory reads`),
    writeBytesPerFrame: datum(5 + index, "byte/frame", "Derived", `${category} compulsory writes`),
    allocationCount: datum(1, "count", "Measured", `${category} allocation inventory`),
    transient: category === "capture-target" || category === "readback-staging",
  }));
  const sum = (field) => resourceRows.reduce((total, row) => total + row[field].value, 0);
  writeJson(directory, "resource-ledger.json", {
    ...commonDocument(RUN_BINDINGS.performance),
    rows: resourceRows,
    totals: {
      logicalBytes: datum(sum("logicalBytes"), "byte", "Derived", "sum resource logical bytes"),
      residentBytes: datum(sum("residentBytes"), "byte", "Derived", "sum resource resident bytes"),
      peakLiveBytes: datum(500, "byte", "Measured", "fixture liveness observation"),
      peakTransientBytes: datum(200, "byte", "Measured", "fixture transient liveness observation"),
      readBytesPerFrame: datum(sum("readBytesPerFrame"), "byte/frame", "Derived", "sum compulsory reads"),
      writeBytesPerFrame: datum(sum("writeBytesPerFrame"), "byte/frame", "Derived", "sum compulsory writes"),
    },
    peakLiveBytesGate: datum(1000, "byte", "Gated", "fixture resource ceiling"),
  });

  writeJson(directory, "lifecycle-evidence.json", {
    ...commonDocument(RUN_BINDINGS.lifecycle),
    minimumIterations: datum(3, "iteration", "Gated", "fixture lifecycle minimum"),
    cases: LIFECYCLE_CASE_IDS.map((id) => ({
      id,
      iterations: datum(3, "iteration", "Measured", `${id} iterations`),
      equilibriumBefore: datum(10, "resource", "Measured", `${id} baseline resources`),
      equilibriumAfter: datum(10, "resource", "Measured", `${id} final resources`),
      peakLiveResources: datum(12, "resource", "Measured", `${id} peak resources`),
      unhandledErrors: datum(0, "count", "Measured", `${id} unhandled errors`),
      requiredInvariantCount: datum(2, "invariant", "Gated", `${id} required invariants`),
      observedInvariantCount: datum(2, "invariant", "Measured", `${id} observed invariants`),
    })),
  });

  const evidenceManifest = {
    ...commonDocument(RUN_BINDINGS.correctness),
    profile: "correctness",
    runBindings: RUN_BINDINGS,
    captureSession: captureSessionRef,
    routeRuntimeEvidence: routeEvidenceRef,
    visualContract: visualContractRef,
    captures: CORPUS_CAPTURE_PLAN.map((planned) => ({
      filename: planned.filename,
      state: planned.state,
      file: captureFiles.get(planned.filename),
    })),
  };
  writeJson(directory, "evidence-manifest.json", evidenceManifest);

  const refs = Object.fromEntries([
    "capture-session.json",
    "evidence-manifest.json",
    "route-runtime-evidence.json",
    "visual-contract.json",
    "visual-reviews.json",
    "visual-error-results.json",
    "timing-trace.json",
    "resource-ledger.json",
    "lifecycle-evidence.json",
  ].map((filename) => [filename, fileReference(directory, filename)]));
  writeJson(directory, "acceptance-summary.json", {
    ...commonDocument(RUN_BINDINGS.correctness),
    runBindings: RUN_BINDINGS,
    gates: REQUIRED_ACCEPTANCE_GATES.map((id) => ({
      id,
      evidenceFiles: ACCEPTANCE_FILES[id].map((filename) => refs[filename]),
    })),
  });

  return { directory, captureFiles };
}

{
  const rgb = Uint8Array.of(23, 91, 177, 210, 34, 18);
  const rgba = Uint8Array.of(23, 91, 177, 7, 210, 34, 18, 240);
  const decodedRgb = decodePngRaster(encodeRgbPng({ width: 2, height: 1, rgb, includeSrgb: true }));
  const decodedRgba = decodePngRaster(encodeRgbaPng({ width: 2, height: 1, data: rgba }));
  assert.equal(decodedRgb.colorType, 2);
  assert.equal(decodedRgba.colorType, 6);
  assert.equal(decodedRgb.ancillaryChunks.includes("sRGB"), true);
  assert.equal(decodedRgb.rgbSha256, decodedRgba.rgbSha256, "RGB and RGBA encodings must normalize to identical packed RGB");
  assert.deepEqual(comparePngRgb(decodedRgb, decodedRgba), {
    rgbMaeCodeValues: 0,
    changedPixelRatio: 0,
    maxChannelDelta: 0,
  });
  const drifted = decodePngRaster(encodeRgbPng({ width: 2, height: 1, rgb: Uint8Array.of(56, 91, 177, 210, 34, 18) }));
  const drift = comparePngRgb(decodedRgb, drifted);
  assert.equal(drift.maxChannelDelta, 33);
  assert(
    drift.rgbMaeCodeValues > CORPUS_RASTER_GATES.replay.rgbMaeMaximum
      && drift.changedPixelRatio > CORPUS_RASTER_GATES.replay.changedPixelRatioMaximum
      && drift.maxChannelDelta > CORPUS_RASTER_GATES.replay.maxChannelDeltaMaximum,
    "real decoded RGB drift must fail every conservative replay raster gate",
  );
  assert.throws(() => decodePngRaster(encodeRgbPng({ width: 2, height: 1, rgb, bitDepth: 16 })), /unsupported PNG bit depth/);
  assert.throws(() => decodePngRaster(encodeRgbPng({ width: 2, height: 1, rgb, interlace: 1 })), /noninterlaced/);
}

const fixture = makeFixtureBundle();
const passing = validateCorpusArtifacts({ bundleDirectory: fixture.directory });
assert.equal(passing.structuralVerdict, "PASS", passing.structuralErrors.join("\n"));
assert.equal(passing.claimVerdict, "PASS", passing.evidenceErrors.join("\n"));
assert.equal(passing.captureCountRequired, 48);
assert.equal(passing.physicalRouteRecordsRequired, 15);

function mutateJson(filename, mutation, expectedPattern) {
  const path = join(fixture.directory, filename);
  const original = readFileSync(path);
  const document = JSON.parse(original.toString("utf8"));
  const mutated = mutation(document);
  writeFileSync(path, `${JSON.stringify(mutated, null, 2)}\n`);
  const result = validateCorpusArtifacts({ bundleDirectory: fixture.directory });
  assert.notEqual(result.claimVerdict, "PASS", `${filename} mutation must not pass`);
  assert.match([...result.structuralErrors, ...result.evidenceErrors].join("\n"), expectedPattern);
  writeFileSync(path, original);
}

{
  const path = join(fixture.directory, "visual-contract.json");
  const original = readFileSync(path);
  writeFileSync(path, "null\n");
  const result = validateCorpusArtifacts({ bundleDirectory: fixture.directory });
  assert.notEqual(result.claimVerdict, "PASS");
  assert.match(result.evidenceErrors.join("\n"), /must contain a JSON object/);
  writeFileSync(path, original);
}

mutateJson("evidence-manifest.json", () => ({}), /schema keys|identity drifted|bundleId/);
mutateJson("capture-session.json", (document) => {
  document.hookResult.rasterComparisons[0].rgbMaeCodeValues = 999;
  return document;
}, /does not match recomputed decoded RGB metrics/);
mutateJson("visual-reviews.json", (document) => {
  document.reviews[0].aiVisionScore.value = 0.1;
  return document;
}, /score is below its gate/);
mutateJson("visual-error-results.json", (document) => ({
  schemaVersion: 2,
  labId: LAB_ID,
  status: "PASS",
  results: [{ status: "PASS" }],
}), /schema keys|bundleId/);
mutateJson("visual-error-results.json", (document) => {
  document.results.pop();
  return document;
}, /must contain exactly/);
mutateJson("route-runtime-evidence.json", (document) => {
  document.routes.pop();
  return document;
}, /runtime record count drifted/);
mutateJson("timing-trace.json", (document) => {
  document.timestampTrackingEnabled = false;
  return document;
}, /pre-init timestamp tracking/);
mutateJson("resource-ledger.json", (document) => {
  document.totals.logicalBytes.value += 1;
  return document;
}, /totals do not close/);
mutateJson("lifecycle-evidence.json", (document) => {
  document.cases[0].equilibriumAfter.value += 1;
  return document;
}, /iteration\/equilibrium\/error\/invariant closure/);
mutateJson("visual-reviews.json", (document) => {
  document.runId = "wrong-correctness-run-0001";
  return document;
}, /runId does not match/);
mutateJson("visual-reviews.json", (document) => {
  document.reviews[0].renderImage = { path: "../escape.png", sha256: "0".repeat(64) };
  return document;
}, /canonical bundle-relative POSIX path/);

{
  const capturePath = join(fixture.directory, CORPUS_CAPTURE_PLAN[0].filename);
  const original = readFileSync(capturePath);
  const mutated = Buffer.from(original);
  mutated[mutated.length - 1] ^= 1;
  writeFileSync(capturePath, mutated);
  const result = validateCorpusArtifacts({ bundleDirectory: fixture.directory });
  assert.notEqual(result.claimVerdict, "PASS");
  assert.match(result.structuralErrors.join("\n"), /sha256 does not match/);
  writeFileSync(capturePath, original);
}

{
  const outsidePath = join(dirname(fixture.directory), `outside-${Date.now()}.png`);
  const outsideBytes = encodeRgbaPng({ width: 1, height: 1, data: Uint8Array.of(1, 2, 3, 255) });
  writeFileSync(outsidePath, outsideBytes);
  symlinkSync(outsidePath, join(fixture.directory, "escape.png"));
  mutateJson("visual-reviews.json", (document) => {
    document.reviews[0].renderImage = { path: "escape.png", sha256: sha256(outsideBytes) };
    return document;
  }, /non-symlink file/);
}

{
  const records = routeRecords();
  validatePhysicalRouteRuntimeRecords(records);
  const wrongLock = structuredClone(records);
  wrongLock[0].selectors[1].disabled = true;
  assert.throws(() => validatePhysicalRouteRuntimeRecords(wrongLock), /lock state drifted|disable exactly one selector/);
  const fakeBackend = structuredClone(records);
  fakeBackend[0].runtime.backendType = "NotWebGPUBackend";
  assert.throws(() => validatePhysicalRouteRuntimeRecords(fakeBackend), /backend identity drifted/);
  const routeError = structuredClone(records);
  routeError[0].errorChannels.gpuErrors.events.push("synthetic GPU validation error");
  assert.throws(() => validatePhysicalRouteRuntimeRecords(routeError), /gpuErrors/);
}

console.log(JSON.stringify({
  ok: true,
  validBundle: fixture.directory,
  captures: passing.captureCountRequired,
  physicalRoutes: passing.physicalRouteRecordsRequired,
  visualInvariants: passing.visualInvariantResultsRequired,
  adversarialMutations: 16,
}, null, 2));
