import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import {
  mkdtempSync,
  mkdirSync,
  readFileSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { deflateSync } from "node:zlib";

import { encodeRgbaPng } from "../../../scripts/lib/png-rgba.mjs";
import { SCULPT_TIERS } from "../shared/sculpt-runtime.js";
import {
  CORPUS_PERFORMANCE_EVIDENCE_LIMITS,
  createObjectSculptorCorpusFrameDriver,
  createObjectSculptorCorpusPerformanceIdentity,
} from "./frame-driver.js";
import { SCULPT_TARGET_IDS } from "./object-catalog.js";
import {
  CORPUS_CAPTURE_PLAN,
  CORPUS_RASTER_COMPARISON_PLAN,
  CORPUS_RASTER_GATES,
  CORPUS_STANDARD_OUTPUT_PLAN,
  CORPUS_STANDARD_RASTER_CONTRACT,
  computeCorpusStandardDerivationSha256,
  computeCorpusRasterComparisons,
} from "./capture-hook.mjs";
import { resolveCorpusInitialState } from "./route-state.js";
import {
  CORPUS_ROUTE_BASE_PATH,
  CORPUS_ROUTE_ERROR_OBSERVERS,
  CORPUS_ROUTE_ORIGIN,
  CORPUS_ROUTE_PIPELINE_DESCRIPTOR,
  CORPUS_TRUSTED_RUNTIME_SOURCE_PATHS,
  CORPUS_PHYSICAL_ROUTE_PLAN,
  buildTrustedCorpusRuntimeSourceManifest,
  computeCorpusParentObserverAttestationDigest,
  computeCorpusRouteBuildRevision,
  computeCorpusRouteCameraDigest,
  computeCorpusRoutePipelineDigest,
  computeCorpusRouteProducerBundleHash,
  computeCorpusRouteReadbackDigest,
  computeCorpusRouteSourceHash,
  computeCorpusTrustedRuntimeSourceManifestHash,
  corpusRouteReadbackArtifactPath,
  validatePhysicalRouteRuntimeRecords,
} from "./validate-routes.mjs";
import {
  CORPUS_CORRECTNESS_CAPTURE_PROFILE,
  CORPUS_LIFECYCLE_MINIMUM_ITERATIONS,
  CORPUS_RESOURCE_PEAK_GATE_BYTES,
  CORPUS_SCULPT_SPEC_EVIDENCE,
  CORPUS_TIMING_GATES,
  CORPUS_VISUAL_INVARIANT_PLAN,
  REQUIRED_ACCEPTANCE_GATES,
  computeCorpusSourceProvenance,
  computeCorpusTimingDeviceBinding,
  corpusRasterComparisonIdForInvariant,
  validateCorpusCorrectnessCaptureProfile,
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
const SOURCE_PROVENANCE = computeCorpusSourceProvenance();
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

function finalizedFileReference(directory, path) {
  const bytes = readFileSync(join(directory, path));
  return Object.freeze({
    path,
    contentBinding: "finalized-file-hash-for-offline-promotion",
    sha256: `sha256:${sha256(bytes)}`,
    byteLength: bytes.byteLength,
  });
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
  return Uint8Array.of(
    digest[0], digest[1], digest[2], 255,
    digest[3] ^ 0x5a, digest[4] ^ 0xa5, digest[5] ^ 0x3c, 255,
  );
}

function paddedRgbaBytes(packed, width, height) {
  const packedBytesPerRow = width * 4;
  const paddedBytesPerRow = Math.ceil(packedBytesPerRow / 256) * 256;
  const bytes = Buffer.alloc(paddedBytesPerRow * height);
  for (let row = 0; row < height; row += 1) Buffer.from(packed).copy(bytes, row * paddedBytesPerRow, row * packedBytesPerRow, (row + 1) * packedBytesPerRow);
  return { bytes, paddedBytesPerRow };
}

function retainedPixelEvidence(directory, stem, packed, width, height, pngReference, { derivedComposite = false } = {}) {
  const transportPath = `${stem}.transport.bin`;
  const normalizedPath = `${stem}.normalized.bin`;
  const packedPath = `${stem}.packed.bin`;
  const { bytes: normalizedBytes, paddedBytesPerRow } = paddedRgbaBytes(packed, width, height);
  if (!derivedComposite) writeFileSync(join(directory, transportPath), Buffer.from(packed));
  writeFileSync(join(directory, normalizedPath), normalizedBytes);
  writeFileSync(join(directory, packedPath), Buffer.from(packed));
  const packedRgbaSha256 = sha256(packed);
  return {
    transport: {
      width,
      height,
      format: "rgba8",
      origin: "top-left",
      bytesPerPixel: 4,
      bytesPerRow: width * 4,
      byteLength: packed.length,
      rawArtifact: derivedComposite ? null : fileReference(directory, transportPath),
      producerOwner: derivedComposite ? "not-applicable-derived-output" : "shared-capture-runner",
      retentionStatus: derivedComposite ? "not-applicable-derived-composite" : "retained",
    },
    normalized: {
      alignmentBytes: 256,
      layout: "cpu-normalized-padded-rgba8",
      paddedBytesPerRow,
      paddedByteLength: normalizedBytes.length,
      rawArtifact: fileReference(directory, normalizedPath),
      packedArtifact: fileReference(directory, packedPath),
      producerOwner: derivedComposite ? "object-sculptor-capture-hook" : "shared-capture-runner",
      packedArtifactProducerOwner: "object-sculptor-capture-hook",
      packedRgbaSha256,
      packedByteLength: packed.length,
      origin: "top-left",
      orientationTransform: "none",
    },
    png: {
      ...pngReference,
      producerOwner: derivedComposite ? "object-sculptor-capture-hook" : "shared-capture-runner",
      decodedRgbaSha256: packedRgbaSha256,
      derivedFromPackedRgbaSha256: packedRgbaSha256,
    },
  };
}

function routeRecords(directory) {
  const trustedRuntimeSourceManifest = buildTrustedCorpusRuntimeSourceManifest();
  const trustedRuntimeSourceManifestSha256 = computeCorpusTrustedRuntimeSourceManifestHash(trustedRuntimeSourceManifest);
  const trustedByPath = new Map(trustedRuntimeSourceManifest.map((entry) => [entry.path, entry]));
  const producerPaths = CORPUS_TRUSTED_RUNTIME_SOURCE_PATHS.filter((path) => path.endsWith("route-evidence-bootstrap.js") || path.endsWith("route-evidence-client.js"));
  const producerFiles = producerPaths.map((path) => ({
    path,
    sha256: trustedByPath.get(path).sha256,
    byteLength: trustedByPath.get(path).byteLength,
  }));
  const producerBundleSha256 = computeCorpusRouteProducerBundleHash(producerFiles);
  const immutableClosureSha256 = SOURCE_PROVENANCE.sourceHash;
  const immutableSnapshotId = `source-sha256:${immutableClosureSha256}`;
  const immutableManifestSha256 = sha256(Buffer.from(JSON.stringify({
    snapshotId: immutableSnapshotId,
    closureSha256: immutableClosureSha256,
    entries: SOURCE_PROVENANCE.files,
  })));
  mkdirSync(join(directory, "route-readbacks"), { recursive: true });
  return CORPUS_PHYSICAL_ROUTE_PLAN.map((route, routeIndex) => {
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
      scenario: { selectorId: "subject", stateKeys: ["subjectId", "scenario"], methods: ["setSubject", "setScenario"], values: SCULPT_TARGET_IDS },
      mechanism: { selectorId: "mode", stateKeys: ["mode"], methods: ["setMode"], values: ["final", "blockout", "hierarchy", "materials", "action-ready"] },
      tier: { selectorId: "tier", stateKeys: ["tier"], methods: ["setTier"], values: ["full", "budgeted", "minimum"] },
      camera: { selectorId: "camera", stateKeys: ["camera"], methods: ["setCamera"], values: ["design", "profile", "attachment", "close-material"] },
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
    const unlockedProbes = Object.entries(dimensions).filter(([dimensionId]) => dimensionId !== route.kind).map(([dimensionId, spec]) => {
      const currentValue = baselineState[spec.stateKeys[0]];
      const unlockedAttempt = spec.values.find((value) => value !== currentValue);
      const changedState = { ...baselineState };
      for (const key of spec.stateKeys) changedState[key] = unlockedAttempt;
      return {
        dimension: dimensionId,
        selectorId: spec.selectorId,
        surface: "ui-change-event",
        publicControllerMethod: spec.methods[0],
        attemptedValue: unlockedAttempt,
        beforeState: baselineState,
        beforeSelector: { value: currentValue, disabled: false },
        changeResult: true,
        changedState,
        changedSelector: { value: unlockedAttempt, disabled: false },
        restoreResult: true,
        restoredState: baselineState,
        restoredSelector: { value: currentValue, disabled: false },
      };
    });
    const routeHtmlBytes = readFileSync(new URL(`./${route.urlPath}index.html`, import.meta.url));
    const routeHtmlSha256 = sha256(routeHtmlBytes);
    const expectedPathname = `${CORPUS_ROUTE_BASE_PATH}${route.urlPath}`;
    const parentObserverAttestation = {
      owner: "in-app-evidence-runner",
      target: "iframe#route-frame",
      observerIds: ["iframe-load", "iframe-error"],
      installedAtMonotonicMs: routeIndex * 10 + 1,
      navigationAssignedAtMonotonicMs: routeIndex * 10 + 2,
      installedBeforeNavigation: true,
      listenersRemoved: true,
      iframeErrorEvents: [],
      digestAlgorithm: "sha256",
      digest: null,
    };
    parentObserverAttestation.digest = computeCorpusParentObserverAttestationDigest(route.routeId, parentObserverAttestation);
    const cameraPose = {
      cameraId: baselineState.camera,
      subjectId: baselineState.subjectId,
      positionMeters: [0, 0, 5],
      quaternion: [0, 0, 0, 1],
      up: [0, 1, 0],
      controlsTargetMeters: [0, 0, 0],
      fovDegrees: 35,
      aspect: 320 / 240,
      nearMeters: 0.1,
      farMeters: 100,
    };
    const transportArtifactPath = corpusRouteReadbackArtifactPath(route, "transport");
    const normalizedArtifactPath = corpusRouteReadbackArtifactPath(route, "normalized");
    const readbackWidth = 320;
    const readbackHeight = 240;
    const rowBytes = readbackWidth * 4;
    const sourceBytesPerRow = Math.ceil(rowBytes / 256) * 256;
    const sourceByteLength = sourceBytesPerRow * readbackHeight;
    const transportBytes = Buffer.alloc(rowBytes * readbackHeight, routeIndex + 1);
    const normalizedBytes = Buffer.alloc(sourceByteLength);
    for (let row = 0; row < readbackHeight; row += 1) {
      transportBytes.copy(normalizedBytes, row * sourceBytesPerRow, row * rowBytes, (row + 1) * rowBytes);
    }
    mkdirSync(dirname(join(directory, transportArtifactPath)), { recursive: true });
    mkdirSync(dirname(join(directory, normalizedArtifactPath)), { recursive: true });
    writeFileSync(join(directory, transportArtifactPath), transportBytes);
    writeFileSync(join(directory, normalizedArtifactPath), normalizedBytes);
    const transportSha256 = sha256(transportBytes);
    const normalizedSha256 = sha256(normalizedBytes);
    const paddingByteCount = readbackHeight * (sourceBytesPerRow - rowBytes);
    const readback = {
      target: "presentation",
      captureSource: "native-webgpu-render-target-readback",
      backendKind: "webgpu",
      nativeWebGPU: true,
      width: readbackWidth,
      height: readbackHeight,
      format: "rgba8unorm",
      bytesPerPixel: 4,
      transportLayout: {
        bytesPerRow: rowBytes,
        byteLength: rowBytes * readbackHeight,
        padding: "compact",
        retained: true,
        provenance: "renderer.readRenderTargetPixelsAsync returned ArrayBuffer view",
      },
      requestedLayout: {
        alignmentBytes: 256,
        rowBytes,
        alignedBytesPerRow: sourceBytesPerRow,
        minimumByteLength: sourceBytesPerRow * (readbackHeight - 1) + rowBytes,
        fullyPaddedByteLength: sourceByteLength,
        provenance: "WebGPU copy alignment request derived before readback",
      },
      normalizedArtifactLayout: {
        bytesPerRow: sourceBytesPerRow,
        byteLength: sourceByteLength,
        retained: true,
        normalization: sourceBytesPerRow === rowBytes ? "identity" : "cpu-row-padding",
        paddingByteCount,
        zeroPaddingByteCount: paddingByteCount,
        independentAllocation: normalizedBytes.buffer !== transportBytes.buffer,
        provenance: "CPU normalization after renderer transport for bounded TAR retention",
      },
      origin: "top-left",
      colorEncoding: "srgb",
      outputColorSpace: "srgb",
      transportSha256,
      normalizedSha256,
      artifacts: {
        transport: {
          path: transportArtifactPath,
          sha256: transportSha256,
          byteLength: transportBytes.length,
          mediaType: "application/octet-stream",
          layout: "renderer-transport-rgba8unorm-top-left",
        },
        normalized: {
          path: normalizedArtifactPath,
          sha256: normalizedSha256,
          byteLength: normalizedBytes.length,
          mediaType: "application/octet-stream",
          layout: "cpu-normalized-zero-padded-rgba8unorm-top-left",
        },
      },
      digestAlgorithm: "sha256",
      digest: null,
    };
    readback.digest = computeCorpusRouteReadbackDigest(route.routeId, readback);
    const record = {
      routeId: route.routeId,
      kind: route.kind,
      id: route.id,
      urlPath: route.urlPath,
      provenance: {
        evidenceProducer: "immutable-browser-page-route-producer",
        sourceHashAlgorithm: "sha256",
        immutableServer: {
          manifestPath: "/.well-known/object-sculptor-corpus-immutable.json",
          manifestSha256: immutableManifestSha256,
          snapshotId: immutableSnapshotId,
          closureSha256: immutableClosureSha256,
          transformMode: "none",
          immutableSnapshot: true,
          spaFallback: false,
          viteClient: false,
          entryCount: SOURCE_PROVENANCE.files.length,
        },
        servedRoute: {
          pathname: expectedPathname,
          sourcePath: `threejs-object-sculptor/examples/webgpu-object-sculptor-corpus/${route.urlPath}index.html`,
          sha256: routeHtmlSha256,
          byteLength: routeHtmlBytes.byteLength,
        },
        routeHtmlSha256,
        servedAppModule: {
          pathname: `${CORPUS_ROUTE_BASE_PATH}app.js`,
          sourcePath: "threejs-object-sculptor/examples/webgpu-object-sculptor-corpus/app.js",
          sha256: trustedByPath.get("threejs-object-sculptor/examples/webgpu-object-sculptor-corpus/app.js").sha256,
          byteLength: trustedByPath.get("threejs-object-sculptor/examples/webgpu-object-sculptor-corpus/app.js").byteLength,
        },
        appModuleSha256: trustedByPath.get("threejs-object-sculptor/examples/webgpu-object-sculptor-corpus/app.js").sha256,
        producerFiles,
        producerBundleSha256,
        trustedRuntimeSourceManifest,
        trustedRuntimeSourceManifestSha256,
        executableSourceClosure: SOURCE_PROVENANCE,
        executedResourcePaths: [
          `${CORPUS_ROUTE_BASE_PATH}app.js`,
          `${CORPUS_ROUTE_BASE_PATH}route-evidence-bootstrap.js`,
          `${CORPUS_ROUTE_BASE_PATH}styles.css`,
        ].sort(),
        sourceHash: computeCorpusRouteSourceHash(
          route.routeId,
          routeHtmlSha256,
          immutableClosureSha256,
          SOURCE_PROVENANCE.sourceHash,
        ),
        buildRevision: immutableSnapshotId,
        browserEntry: expectedPathname,
      },
      location: {
        origin: CORPUS_ROUTE_ORIGIN,
        requestedHref: `${CORPUS_ROUTE_ORIGIN}${expectedPathname}?capture=1`,
        finalHref: `${CORPUS_ROUTE_ORIGIN}${expectedPathname}?capture=1`,
        requestedPathname: expectedPathname,
        finalPathname: expectedPathname,
        search: "?capture=1",
        responseStatus: 200,
        documentReadyState: "complete",
        parentObserverAttestation,
        viewport: { cssWidth: 320, cssHeight: 240, devicePixelRatio: 1, appliedDpr: 1 },
      },
      documentRoute: { kind: route.kind, id: route.id, subject: baselineState.subjectId, profile: "correctness" },
      parsedRoute: { scenario: null, mechanism: null, tier: null, camera: null, [route.kind]: route.id },
      selectors,
      baselineState,
      hud: {
        datasetState: "ready",
        textContent: `Ready · ${baselineState.subjectId} · correctness WebGPU`,
        ready: true,
      },
      camera: {
        interactionEnabled: false,
        semanticCamera: baselineState.camera,
        beforeFirstFrame: structuredClone(cameraPose),
        afterFirstFrame: structuredClone(cameraPose),
        afterProbes: structuredClone(cameraPose),
        afterReadback: structuredClone(cameraPose),
        digestAlgorithm: "sha256",
        poseDigest: computeCorpusRouteCameraDigest(route.routeId, cameraPose),
      },
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
        threeRevision: "185",
        runtimeProfile: "correctness",
        rendererBackendEvidence: {
          backendKind: "webgpu",
          backendType: "WebGPUBackend",
          deviceType: "GPUDevice",
          deviceLabel: "",
          rendererDeviceGeneration: 1,
          deviceIdentitySource: "renderer.backend.device-after-init",
          deviceIdentityVerified: true,
        },
        rendererDeviceGeneration: 1,
        deviceLossGeneration: 0,
        rendererDeviceStatus: "active",
        deviceErrorCount: 0,
        deviceErrors: [],
        frameDriverState: "idle",
        frameErrorCount: 0,
        lifecycleErrorCount: 0,
        routeLockRejectCount: 1 + dimension.methods.length,
        lastRouteLockResult: controllerProbes.at(-1).result,
        lastFrameError: null,
        lastLifecycleError: null,
      },
      pipeline: {
        descriptor: structuredClone(CORPUS_ROUTE_PIPELINE_DESCRIPTOR),
        digestAlgorithm: "sha256",
        digest: computeCorpusRoutePipelineDigest(route.routeId, CORPUS_ROUTE_PIPELINE_DESCRIPTOR),
      },
      readback,
      errorChannels: {
        ...Object.fromEntries(Object.entries(CORPUS_ROUTE_ERROR_OBSERVERS).map(([channel, observer]) => [channel, {
          observerInstalled: true,
          activeFrom: observer.activeFrom,
          observerId: observer.observerId,
          events: [],
        }])),
        deviceLost: { monitorAttached: true, activeFrom: "before-first-frame", observerId: "gpu-device-lost", event: null },
      },
      labError: null,
      teardown: {
        explicitDispose: {
          requested: true,
          fulfilled: true,
          returnValue: { listenersDetached: true, controllerResult: null },
        },
        beforeDispose: {
          errorChannels: null,
          labError: null,
          frameDriverState: "idle",
          rendererDeviceStatus: "active",
        },
        afterDispose: {
          errorChannels: null,
          labError: null,
          frameDriverState: "closed",
          rendererDeviceStatus: "disposed",
          pendingControllerOperations: 0,
          acceptingControllerOperations: false,
          frameErrorCount: 0,
          lifecycleErrorCount: 0,
          teardown: {},
        },
        postDisposeSettlingBarrier: {
          owner: "in-app-evidence-runner",
          type: "two-child-requestAnimationFrame-callbacks",
          requestedFrames: 2,
          observedFrames: 2,
          completed: true,
          timestampsMonotonicMs: [routeIndex * 10 + 8, routeIndex * 10 + 9],
        },
        afterFrameReset: {
          owner: "in-app-evidence-runner",
          beforeHref: `${CORPUS_ROUTE_ORIGIN}${expectedPathname}?capture=1`,
          afterHref: "about:blank",
          loadObserved: true,
          listenersRemoved: true,
          iframeErrorEvents: [],
        },
      },
    };
    record.teardown.beforeDispose.errorChannels = structuredClone(record.errorChannels);
    record.teardown.afterDispose.errorChannels = structuredClone(record.errorChannels);
    return record;
  });
}

function commonDocument(runId) {
  return {
    schemaVersion: 2,
    labId: LAB_ID,
    bundleId: BUNDLE_ID,
    runId,
    sourceHash: SOURCE_PROVENANCE.sourceHash,
    buildRevision: SOURCE_PROVENANCE.buildRevision,
    backend: BACKEND,
  };
}

async function makeFixtureBundle() {
  const directory = mkdtempSync(join(tmpdir(), "object-sculptor-evidence-"));
  const captureFiles = new Map();
  const capturePixels = new Map();
  for (const planned of CORPUS_CAPTURE_PLAN) {
    const pixels = pixelBytesForState(planned.state);
    const png = encodeRgbaPng({ width: 2, height: 1, data: pixels });
    writeFileSync(join(directory, planned.filename), png);
    captureFiles.set(planned.filename, fileReference(directory, planned.filename));
    capturePixels.set(planned.filename, pixels);
  }

  const captures = CORPUS_CAPTURE_PLAN.map((planned, index) => {
    const generation = planned.state.seedPhase === "B" ? 2 : planned.state.seedPhase === "A1" ? 3 : 1;
    const firstSubjectCapture = planned.state.seedPhase === "A0" && planned.state.seedCaseId === "final-full-design";
    const previousGeneration = planned.state.seedPhase === "B" ? 1 : planned.state.seedPhase === "A1" ? 2 : firstSubjectCapture ? null : 1;
    return {
      filename: planned.filename,
      state: planned.state,
      target: "presentation",
      width: 2,
      height: 1,
      bytesPerPixel: 4,
      bytesPerRow: 8,
      sourceBytesPerRow: 256,
      sourceByteLength: 256,
      transportByteLength: 8,
      sourceLayout: "padded",
      format: "rgba8",
      colorEncoding: "srgb",
      packedBytesPerRow: 8,
      sourceRowStride: 256,
      outputColorSpace: "srgb",
      captureSource: "native-webgpu-render-target-readback",
      file: captureFiles.get(planned.filename),
      pixelEvidence: retainedPixelEvidence(
        directory,
        planned.filename.replace(/\.png$/, ""),
        capturePixels.get(planned.filename),
        2,
        1,
        captureFiles.get(planned.filename),
      ),
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
        continuityStatus: previousGeneration === null
          ? "explicit-instance-established"
          : generation === previousGeneration
            ? "explicit-continuity-preserved"
            : "explicit-continuity-changed-new-generation",
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
  for (const capture of captures) capture.file = capture.pixelEvidence.png;
  const rasterComparisons = computeCorpusRasterComparisons((filename) => readFileSync(join(directory, filename)));
  const rasterComparisonById = new Map(rasterComparisons.map((comparison) => [comparison.id, comparison]));

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

  const sourceFilenamesForFragments = (fragments) => SCULPT_TARGET_IDS.map((subjectId, index) => `${subjectId}.${Array.isArray(fragments) ? fragments[index] : fragments}.png`);
  const captureRecordByFilename = new Map(captures.map((capture) => [capture.filename, capture]));
  const composeStandardPixels = (sourceCaptures) => {
    const output = Buffer.alloc(CORPUS_STANDARD_RASTER_CONTRACT.width * CORPUS_STANDARD_RASTER_CONTRACT.height * 4);
    for (let ordinal = 0; ordinal < sourceCaptures.length; ordinal += 1) {
      const sourceFilename = sourceCaptures[ordinal];
      const source = captureRecordByFilename.get(sourceFilename);
      const sourcePixels = capturePixels.get(sourceFilename);
      assert(source && sourcePixels, `missing standard source capture ${sourceFilename}`);
      for (let destinationY = 0; destinationY < CORPUS_STANDARD_RASTER_CONTRACT.panelHeight; destinationY += 1) {
        const sourceY = Math.min(
          source.height - 1,
          Math.floor(((destinationY + 0.5) * source.height) / CORPUS_STANDARD_RASTER_CONTRACT.panelHeight),
        );
        for (let destinationX = 0; destinationX < CORPUS_STANDARD_RASTER_CONTRACT.panelWidth; destinationX += 1) {
          const sourceX = Math.min(
            source.width - 1,
            Math.floor(((destinationX + 0.5) * source.width) / CORPUS_STANDARD_RASTER_CONTRACT.panelWidth),
          );
          const sourceOffset = (sourceY * source.width + sourceX) * 4;
          const outputX = ordinal * CORPUS_STANDARD_RASTER_CONTRACT.panelWidth + destinationX;
          const outputOffset = (destinationY * CORPUS_STANDARD_RASTER_CONTRACT.width + outputX) * 4;
          output[outputOffset] = sourcePixels[sourceOffset];
          output[outputOffset + 1] = sourcePixels[sourceOffset + 1];
          output[outputOffset + 2] = sourcePixels[sourceOffset + 2];
          output[outputOffset + 3] = sourcePixels[sourceOffset + 3];
        }
      }
    }
    return output;
  };
  const writeStandardComposite = (id, fragments) => {
    const sourceCaptures = sourceFilenamesForFragments(fragments);
    const plan = CORPUS_STANDARD_OUTPUT_PLAN.find((output) => output.id === id);
    assert.deepEqual(sourceCaptures, plan.sourceCaptures, `${id} source plan drifted`);
    const pixels = composeStandardPixels(sourceCaptures);
    const filename = `${id}.png`;
    writeFileSync(join(directory, filename), encodeRgbaPng({
      width: CORPUS_STANDARD_RASTER_CONTRACT.width,
      height: CORPUS_STANDARD_RASTER_CONTRACT.height,
      data: pixels,
    }));
    const pngReference = fileReference(directory, filename);
    const pixelEvidence = retainedPixelEvidence(
      directory,
      id,
      pixels,
      CORPUS_STANDARD_RASTER_CONTRACT.width,
      CORPUS_STANDARD_RASTER_CONTRACT.height,
      pngReference,
      { derivedComposite: true },
    );
    const inputs = sourceCaptures.map((capturePath, ordinal) => {
      const source = captureRecordByFilename.get(capturePath);
      return {
        ordinal,
        subjectId: source.state.subjectId,
        capturePath,
        capturePngSha256: source.pixelEvidence.png.sha256,
        capturePngProducer: source.pixelEvidence.png.producerOwner,
        normalizedPackedRgbaSha256: source.pixelEvidence.normalized.packedRgbaSha256,
        normalizedRawArtifactPath: source.pixelEvidence.normalized.rawArtifact.path,
        normalizedRawArtifactSha256: source.pixelEvidence.normalized.rawArtifact.sha256,
        normalizedRawArtifactProducer: source.pixelEvidence.normalized.producerOwner,
        normalizedPackedArtifactPath: source.pixelEvidence.normalized.packedArtifact.path,
        normalizedPackedArtifactSha256: source.pixelEvidence.normalized.packedArtifact.sha256,
        normalizedPackedArtifactProducer: source.pixelEvidence.normalized.packedArtifactProducerOwner,
        rendererTransportArtifactPath: source.pixelEvidence.transport.rawArtifact.path,
        rendererTransportArtifactSha256: source.pixelEvidence.transport.rawArtifact.sha256,
        rendererTransportArtifactProducer: source.pixelEvidence.transport.producerOwner,
        sourceRect: { x: 0, y: 0, width: source.width, height: source.height },
        panelRect: {
          x: ordinal * CORPUS_STANDARD_RASTER_CONTRACT.panelWidth,
          y: 0,
          width: CORPUS_STANDARD_RASTER_CONTRACT.panelWidth,
          height: CORPUS_STANDARD_RASTER_CONTRACT.panelHeight,
        },
      };
    });
    const derivation = {
      schemaVersion: 1,
      kind: "three-panel-native-readback-contact-sheet",
      inputs,
      layout: {
        direction: "horizontal",
        panelCount: CORPUS_STANDARD_RASTER_CONTRACT.panelCount,
        equalWidth: true,
        panelWidth: CORPUS_STANDARD_RASTER_CONTRACT.panelWidth,
        panelHeight: CORPUS_STANDARD_RASTER_CONTRACT.panelHeight,
        gapPixels: 0,
        syntheticFillPixels: 0,
      },
      resampling: {
        sourcePolicy: CORPUS_STANDARD_RASTER_CONTRACT.sourcePolicy,
        cropPolicy: CORPUS_STANDARD_RASTER_CONTRACT.cropPolicy,
        kernel: CORPUS_STANDARD_RASTER_CONTRACT.resamplingKernel,
        coordinateRule: CORPUS_STANDARD_RASTER_CONTRACT.coordinateRule,
        edgeMode: CORPUS_STANDARD_RASTER_CONTRACT.edgeMode,
        colorDomain: CORPUS_STANDARD_RASTER_CONTRACT.colorDomain,
      },
      output: {
        path: filename,
        width: CORPUS_STANDARD_RASTER_CONTRACT.width,
        height: CORPUS_STANDARD_RASTER_CONTRACT.height,
        normalizedPackedRgbaSha256: pixelEvidence.normalized.packedRgbaSha256,
        pngSha256: pixelEvidence.png.sha256,
        producer: pixelEvidence.png.producerOwner,
      },
    };
    return {
      id,
      status: "CAPTURED",
      filename,
      file: pixelEvidence.png,
      sourceCaptures,
      composition: {
        kind: "derived-three-panel-native-readback-contact-sheet",
        resampling: CORPUS_STANDARD_RASTER_CONTRACT.resamplingKernel,
        byteForByteNativeBinding: false,
        nativeTransportBinding: "not-applicable-derived-output",
        syntheticFillPixels: 0,
      },
      derivation,
      derivationSha256: computeCorpusStandardDerivationSha256(derivation),
      pixelEvidence,
    };
  };
  const standardOutputs = [
    writeStandardComposite("final.design", "final.full.design"),
    {
      id: "no-post.design",
      status: "NOT_APPLICABLE",
      filename: null,
      reason: "The corpus forward renderer has no post-processing stage to bypass.",
      graphProof: { pipelineOwner: "WebGPURenderer", sceneRendersPerFrame: 1, postProcessPasses: 0 },
    },
    writeStandardComposite("diagnostics.mosaic", ["blockout.full.design", "hierarchy.full.design", "materials.full.close-material"]),
    writeStandardComposite("camera.near", "final.full.close-material"),
    writeStandardComposite("camera.design", "final.budgeted.design"),
    {
      id: "camera.far",
      status: "NOT_APPLICABLE",
      filename: null,
      reason: "The authored corpus camera contract has no far bookmark.",
      graphProof: {
        cameraContractOwner: "CORPUS_CAMERAS",
        availableCameraIds: ["design", "profile", "attachment", "close-material"],
        omittedCameraId: "far",
      },
    },
    writeStandardComposite("seed-0001.final", "final.full.profile"),
    writeStandardComposite("seed-9e3779b9.final", "final.full.profile.stress-seed"),
    writeStandardComposite("temporal.t000", "action-ready.full.design.t000"),
    writeStandardComposite("temporal.t001", "action-ready.full.design.t200"),
  ];
  const sharedArtifactReference = (reference) => ({
    path: reference.path,
    sha256: `sha256:${reference.sha256}`,
    byteLength: readFileSync(join(directory, reference.path)).byteLength,
  });
  const standardOutputById = new Map(standardOutputs.map((output) => [output.id, output]));
  const verifiedOutputPlan = CORPUS_STANDARD_OUTPUT_PLAN.map((planned) => {
    if (planned.status === "NOT_APPLICABLE") return structuredClone(planned);
    const output = standardOutputById.get(planned.id);
    return {
      id: planned.id,
      status: "CAPTURED",
      filename: planned.filename,
      sourceCaptures: [...planned.sourceCaptures],
      artifact: sharedArtifactReference(output.pixelEvidence.png),
      derivation: {
        kind: "hook-validated-derived-output",
        validationStatus: "PASS",
        sourceCaptures: [...planned.sourceCaptures],
        outputFile: sharedArtifactReference(output.pixelEvidence.png),
        normalizedRaw: sharedArtifactReference(output.pixelEvidence.normalized.rawArtifact),
        normalizedPacked: sharedArtifactReference(output.pixelEvidence.normalized.packedArtifact),
      },
    };
  });
  const writtenCaptures = captures.map((capture) => ({
    target: "presentation",
    width: capture.width,
    height: capture.height,
    bytesPerPixel: 4,
    bytesPerRow: capture.width * 4,
    sourceBytesPerRow: capture.sourceBytesPerRow,
    sourceByteLength: capture.sourceByteLength,
    transportByteLength: capture.pixelEvidence.transport.byteLength,
    sourceLayout: capture.sourceLayout,
    sourceOrigin: "top-left",
    origin: "top-left",
    orientationTransform: "none",
    sourceFormat: "rgba8",
    format: "rgba8",
    colorEncoding: "srgb",
    transport: {
      artifact: {
        ...capture.pixelEvidence.transport.rawArtifact,
        sha256: `sha256:${capture.pixelEvidence.transport.rawArtifact.sha256}`,
        byteLength: capture.pixelEvidence.transport.byteLength,
      },
      layout: {
        width: capture.width,
        height: capture.height,
        format: capture.pixelEvidence.transport.format,
        layout: "compact",
        origin: capture.pixelEvidence.transport.origin,
        bytesPerPixel: capture.pixelEvidence.transport.bytesPerPixel,
        rowBytes: capture.width * 4,
        bytesPerRow: capture.pixelEvidence.transport.bytesPerRow,
        byteLength: capture.pixelEvidence.transport.byteLength,
        paddingKind: "compact",
        paddingBytesPerRow: 0,
      },
      rendererCopy: {
        layout: capture.sourceLayout,
        bytesPerRow: capture.sourceBytesPerRow,
        byteLength: capture.sourceByteLength,
        rawBytesRetained: true,
        requestedLayout: {
          width: capture.width,
          height: capture.height,
          rowBytes: capture.width * 4,
          bytesPerRow: capture.sourceBytesPerRow,
          byteLength: capture.sourceByteLength,
          alignmentBytes: 256,
        },
      },
    },
    normalized: {
      artifact: {
        ...capture.pixelEvidence.normalized.rawArtifact,
        sha256: `sha256:${capture.pixelEvidence.normalized.rawArtifact.sha256}`,
        byteLength: capture.pixelEvidence.normalized.paddedByteLength,
      },
      layout: "cpu-normalized-padded-rgba8",
      alignmentBytes: 256,
      bytesPerRow: capture.pixelEvidence.normalized.paddedBytesPerRow,
      byteLength: capture.pixelEvidence.normalized.paddedByteLength,
      origin: "top-left",
      orientationTransform: "none",
      compact: {
        layout: "compact-rgba8",
        origin: "top-left",
        bytesPerRow: capture.width * 4,
        byteLength: capture.pixelEvidence.normalized.packedByteLength,
        sha256: `sha256:${capture.pixelEvidence.normalized.packedRgbaSha256}`,
      },
      compactRgbaSha256: `sha256:${capture.pixelEvidence.normalized.packedRgbaSha256}`,
      compactByteLength: capture.pixelEvidence.normalized.packedByteLength,
    },
    controllerNormalized: {
      layout: {
        width: capture.width,
        height: capture.height,
        format: "rgba8",
        rowBytes: capture.width * 4,
        bytesPerRow: capture.pixelEvidence.normalized.paddedBytesPerRow,
        byteLength: capture.pixelEvidence.normalized.paddedByteLength,
        padding: "cpu-normalized-fully-padded",
      },
      origin: "top-left",
      orientationTransform: "none",
      byteLength: capture.pixelEvidence.normalized.paddedByteLength,
      sha256: `sha256:${capture.pixelEvidence.normalized.rawArtifact.sha256}`,
      compactSha256: `sha256:${capture.pixelEvidence.normalized.packedRgbaSha256}`,
      independentPaddedSha256: `sha256:${capture.pixelEvidence.normalized.rawArtifact.sha256}`,
      paddingBytesPerRow: capture.pixelEvidence.normalized.paddedBytesPerRow - capture.width * 4,
      paddingVerifiedZero: true,
      reconciliationStatus: "PASS",
    },
    png: {
      path: capture.pixelEvidence.png.path,
      sha256: `sha256:${capture.pixelEvidence.png.sha256}`,
      byteLength: readFileSync(join(directory, capture.file.path)).byteLength,
      encoding: "png-rgba8-srgb",
      derivedFromCompactRgbaSha256: `sha256:${capture.pixelEvidence.normalized.packedRgbaSha256}`,
      width: capture.width,
      height: capture.height,
    },
  }));

  const artifactWrites = [];
  const recordArtifactWrite = (path, kind) => {
    if (path === "capture-session.json") {
      artifactWrites.push({
        sequence: artifactWrites.length + 1,
        path,
        kind,
        existedBefore: false,
        contentBinding: "self-excluded-finalized-offline",
        sha256: null,
        byteLength: null,
      });
      return;
    }
    const bytes = readFileSync(join(directory, path));
    artifactWrites.push({
      sequence: artifactWrites.length + 1,
      path,
      kind,
      existedBefore: false,
      contentBinding: "sha256-byte-length-immutable-buffer-v1",
      sha256: `sha256:${sha256(bytes)}`,
      byteLength: bytes.byteLength,
    });
  };
  for (const capture of captures) {
    recordArtifactWrite(capture.pixelEvidence.png.path, "writeCapture-png");
    recordArtifactWrite(capture.pixelEvidence.transport.rawArtifact.path, "writeCapture-transport");
    recordArtifactWrite(capture.pixelEvidence.normalized.rawArtifact.path, "writeCapture-normalized");
    recordArtifactWrite(capture.pixelEvidence.normalized.packedArtifact.path, "hook-artifact");
  }
  for (const output of standardOutputs) {
    if (output.status !== "CAPTURED") continue;
    recordArtifactWrite(output.pixelEvidence.png.path, "hook-artifact");
    recordArtifactWrite(output.pixelEvidence.normalized.rawArtifact.path, "hook-artifact");
    recordArtifactWrite(output.pixelEvidence.normalized.packedArtifact.path, "hook-artifact");
  }
  recordArtifactWrite("capture-session.json", "capture-session-record");

  const captureSession = {
    schemaVersion: 2,
    labId: LAB_ID,
    sourceHash: SOURCE_PROVENANCE.sourceHash,
    sourceClosureHash: SOURCE_PROVENANCE.sourceHash,
    sourceClosure: SOURCE_PROVENANCE,
    buildRevision: SOURCE_PROVENANCE.buildRevision,
    threeRevision: SOURCE_PROVENANCE.threeRevision,
    profile: "contract-fixture",
    profileConfig: { width: 2, height: 1, dpr: 1 },
    automationSurface: "playwright-headless-chromium",
    adapterClass: "hardware",
    adapterIdentity: {
      source: "fixture renderer backend evidence",
      name: "Fixture hardware adapter",
    },
    browser: {
      name: "Chromium",
      version: "fixture-1",
      userAgent: "Fixture Playwright Chromium user agent",
      platform: "Fixture physical platform",
      automationSurface: "playwright-headless-chromium",
      adapterClass: "hardware",
      adapterIdentity: {
        source: "fixture renderer backend evidence",
        name: "Fixture hardware adapter",
      },
    },
    browserEntry: "threejs-object-sculptor/examples/webgpu-object-sculptor-corpus/index.html",
    url: "http://127.0.0.1/threejs-object-sculptor/examples/webgpu-object-sculptor-corpus/?capture=1&profile=correctness",
    finalUrl: "http://127.0.0.1/threejs-object-sculptor/examples/webgpu-object-sculptor-corpus/?capture=1&profile=correctness",
    route: {
      requestedUrl: "http://127.0.0.1/threejs-object-sculptor/examples/webgpu-object-sculptor-corpus/?capture=1&profile=correctness",
      finalUrl: "http://127.0.0.1/threejs-object-sculptor/examples/webgpu-object-sculptor-corpus/?capture=1&profile=correctness",
      browserEntry: "threejs-object-sculptor/examples/webgpu-object-sculptor-corpus/index.html",
      manifestLabId: LAB_ID,
      observedRuntimeLabId: LAB_ID,
      lockedState: { scenario: "articulated-desk-lamp", mode: "final", tier: "full", camera: "design", seed: 1, timeSeconds: 0 },
      observedState: { scenario: "articulated-desk-lamp", mode: "final", tier: "full", camera: "design", seed: 1, timeSeconds: 0 },
      finalState: (() => {
        const state = CORPUS_CAPTURE_PLAN.at(-1).state;
        return { scenario: state.subjectId, mode: state.mode, tier: state.tier, camera: state.camera, seed: state.seed, timeSeconds: state.time };
      })(),
    },
    startedAt: "2026-07-12T12:00:00.000Z",
    finishedAt: "2026-07-12T12:02:00.000Z",
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
    finalRuntime: null,
    postDisposeSnapshot: {
      labError: null,
      gpuEvents: null,
      threeGpuEvents: null,
      imagePipelineGpuEvents: null,
      deviceErrors: null,
      visibilityState: "visible",
    },
    outputPlan: verifiedOutputPlan,
    writtenCaptures,
    artifactWrites,
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
      sourceClosure: SOURCE_PROVENANCE,
      standardOutputs,
      rasterComparisonPlan: CORPUS_RASTER_COMPARISON_PLAN,
      rasterComparisons,
      evidenceStatus: "INSUFFICIENT_EVIDENCE",
      note: "Fixture capture session is not acceptance by itself.",
    },
    pageErrors: [],
    consoleErrors: [],
    requestErrors: [],
    note: "Fixture capture-session record.",
  };
  captureSession.finalRuntime = structuredClone(captureSession.runtime);
  {
    const state = CORPUS_CAPTURE_PLAN.at(-1).state;
    Object.assign(captureSession.finalRuntime.metrics, {
      scenario: state.subjectId,
      subjectId: state.subjectId,
      mode: state.mode,
      tier: state.tier,
      camera: state.camera,
      seed: state.seed,
      time: state.time,
    });
  }
  writeJson(directory, "capture-session.json", captureSession);
  const captureSessionRef = finalizedFileReference(directory, "capture-session.json");

  const routeEvidenceRef = writeJson(directory, "route-runtime-evidence.json", {
    ...commonDocument(RUN_BINDINGS.routes),
    captureSession: {
      profile: "physical-route",
      automationSurface: "codex-in-app-browser",
      adapterClass: "hardware",
      adapterIdentity: {
        source: "fixture renderer backend evidence",
        backendType: "WebGPUBackend",
        deviceType: "GPUDevice",
        deviceLabel: "Fixture hardware adapter",
        deviceIdentityVerified: true,
      },
      browser: {
        userAgent: "Fixture Codex in-app Browser user agent",
        platform: "Fixture physical platform",
        userAgentData: null,
      },
      sourceClosureHash: SOURCE_PROVENANCE.sourceHash,
      buildRevision: SOURCE_PROVENANCE.buildRevision,
      runnerHref: "http://127.0.0.1/in-app-evidence.html",
      startedAt: "2026-07-12T12:00:00.000Z",
      finishedAt: "2026-07-12T12:01:00.000Z",
      startedAtMonotonicMs: datum(1000, "ms", "Measured", "in-app runner monotonic clock"),
      finishedAtMonotonicMs: datum(61000, "ms", "Measured", "in-app runner monotonic clock"),
    },
    routes: routeRecords(directory),
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
  const visualContractById = new Map(visualContract.invariants.map((invariant) => [invariant.id, invariant]));

  const visualReviews = {
    ...commonDocument(RUN_BINDINGS.correctness),
    reviews: SCULPT_TARGET_IDS.map((subjectId) => {
      const invariantResultId = `final-authored-contract:${subjectId}`;
      return {
        subjectId,
        mode: "final",
        reviewBasis: "authored-contract",
        sculptSpec: {
          repositoryPath: CORPUS_SCULPT_SPEC_EVIDENCE[subjectId].repositoryPath,
          sha256: CORPUS_SCULPT_SPEC_EVIDENCE[subjectId].sha256,
        },
        invariantResultId,
        renderImage: captureFiles.get(`${subjectId}.final.full.design.png`),
        contractArtifact: visualContractRef,
        aiVisionScore: datum(0.9, "score", "Measured", `AI-review:${subjectId}:final-authored-contract`),
        acceptanceThreshold: visualContractById.get(invariantResultId).threshold,
        criticalFeatures: CORPUS_SCULPT_SPEC_EVIDENCE[subjectId].requiredFeatures.map((feature) => ({
          id: feature.id,
          specFeatureSha256: feature.sha256,
          score: datum(0.9, "score", "Measured", `AI-review:${subjectId}:${feature.id}`),
          threshold: datum(0.8, "score", "Gated", `ObjectSculptSpec:${subjectId}:${feature.id}:critical-feature-gate`),
        })),
      };
    }),
  };
  writeJson(directory, "visual-reviews.json", visualReviews);

  const visualErrors = {
    ...commonDocument(RUN_BINDINGS.correctness),
    contractId: visualContract.contractId,
    results: CORPUS_VISUAL_INVARIANT_PLAN.map((invariant, index) => {
      const contract = visualContract.invariants[index];
      const rasterComparisonId = corpusRasterComparisonIdForInvariant(invariant.id);
      const measurement = rasterComparisonId !== null
        ? rasterComparisonById.get(rasterComparisonId).rgbMaeCodeValues
        : invariant.comparison === "lte"
          ? 0.2
          : (invariant.unit === "score" ? 0.9 : 0.5);
      const measurementSource = invariant.id.startsWith("final-authored-contract:")
        ? `AI-review:${invariant.id.split(":")[1]}:final-authored-contract`
        : rasterComparisonId !== null
          ? `capture-session.rasterComparisons:${rasterComparisonId}:rgbMaeCodeValues`
          : `fixture measurement for ${invariant.id}`;
      return {
        id: invariant.id,
        metricId: invariant.metricId,
        comparison: invariant.comparison,
        measurement: datum(measurement, invariant.unit, "Measured", measurementSource),
        threshold: contract.threshold,
        captureFiles: contract.captureFiles,
      };
    }),
  };
  writeJson(directory, "visual-error-results.json", visualErrors);

  const timingTargetDevice = {
    id: "fixture-device-01",
    kind: "physical",
    device: "Fixture physical device",
    os: "Fixture OS",
    browser: {
      name: "Codex in-app Browser",
      version: "fixture-1",
      userAgent: "Fixture Codex in-app Browser user agent",
      platform: "Fixture physical platform",
      automationSurface: "codex-in-app-browser",
    },
    adapter: {
      adapterClass: "hardware",
      name: "Fixture hardware adapter",
      identitySource: "initialized renderer device identity",
      details: { vendor: "fixture-vendor", architecture: "fixture-architecture" },
    },
  };
  const timingViewport = {
    cssWidth: datum(390, "CSS px", "Measured", "performance viewport measurement"),
    cssHeight: datum(844, "CSS px", "Measured", "performance viewport measurement"),
    dpr: datum(1, "ratio", "Measured", "performance DPR measurement"),
    physicalWidth: datum(390, "physical px", "Derived", "round(cssWidth * dpr)"),
    physicalHeight: datum(844, "physical px", "Derived", "round(cssHeight * dpr)"),
  };
  const timingDeviceBinding = computeCorpusTimingDeviceBinding({
    sourceHash: SOURCE_PROVENANCE.sourceHash,
    buildRevision: SOURCE_PROVENANCE.buildRevision,
    targetDevice: timingTargetDevice,
    viewport: timingViewport,
    backend: BACKEND,
    rendererDeviceGeneration: null,
    deviceLossGeneration: null,
  });
  const performanceCaptureSession = Object.freeze({
    schemaVersion: "object-sculptor-physical-performance-session-v1",
    profile: "performance",
    automationSurface: "codex-in-app-browser",
    sourceClosureHash: SOURCE_PROVENANCE.sourceHash,
    buildRevision: SOURCE_PROVENANCE.buildRevision,
    routeHref: "https://threejs-skills.com/demos/webgpu-object-sculptor-corpus/",
    sessionId: "fixture-physical-performance-session",
    startedAt: "2026-07-12T12:00:00.000Z",
    installedAtDocumentReadyState: "loading",
  });
  const performanceMetrics = (subjectId, tier, lane) => ({
    subjectId,
    tier,
    mode: "action-ready",
    seed: 1,
    camera: "design",
    time: 0,
    stepCount: 0,
    stateMutationCount: 0,
    resourceTransitionCount: 1,
    rebuildCount: 1,
    cameraFraming: {
      camera: "design",
      actualPose: {
        positionMeters: [0, 0, 5],
        quaternion: [0, 0, 0, 1],
        controlsTargetMeters: [0, 0, 0],
        fovDegrees: 35,
        aspect: 390 / 844,
        nearMeters: 0.01,
        farMeters: 100,
      },
    },
    viewport: {
      cssWidth: 390,
      cssHeight: 844,
      requestedDpr: 1,
      appliedDpr: 1,
      drawingBufferWidth: 390,
      drawingBufferHeight: 844,
    },
    runtimeProfile: "performance",
    performanceTimestampMode: lane === "one-shot-gpu" ? "auto" : "disabled-for-cadence",
    backendKind: "webgpu",
    threeRevision: "185",
    timestampQueriesRequired: lane === "one-shot-gpu",
    timestampQueriesActive: lane === "one-shot-gpu",
    gpuTimestampResolveAttempts: 0,
    gpuTimestampResolveFailures: 0,
    rendererDeviceGeneration: 1,
    deviceLossGeneration: 0,
    completedFrames: 100,
    renderSubmissions: 100,
    rendererDeviceStatus: "active",
    rendererDeviceIdentityStillCurrent: true,
    performanceAdapterIdentityStatus: "verified-exact-renderer-device-binding",
    performanceAdapterIdentity: timingTargetDevice.adapter,
    deviceErrorCount: 0,
    frameErrorCount: 0,
    lifecycleErrorCount: 0,
    acceptingControllerOperations: true,
    lifecycleAcceptanceStatus: "provisional-no-uncertain-teardown",
    nativeWebGPU: true,
    cameraInteractionEnabled: false,
    rendererBackendEvidence: {
      deviceIdentityVerified: true,
      backendType: "WebGPUBackend",
      deviceType: "GPUDevice",
      deviceLabel: "Fixture hardware adapter",
      deviceIdentitySource: "initialized renderer backend",
      timestampQueryFeatureOnActualDevice: true,
      backendTimestampTrackingActive: lane === "one-shot-gpu",
    },
  });
  const performancePipeline = (metrics) => ({
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
  });
  const performanceResources = (metrics) => ({
    schemaVersion: "object-sculptor-resource-inventory-v1",
    subjectId: metrics.subjectId,
    tier: metrics.tier,
    renderTargets: [],
    activeTarget: { subjectId: metrics.subjectId, nodes: 12, meshes: 8 },
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
      resourceKind: "fixture geometry",
      allocationIds: [`${metrics.subjectId}-${metrics.tier}-fixture-geometry`],
      elementCount: 512,
      bytesPerElement: 1,
      sampleCount: 1,
      multiplicity: 1,
      logicalByteLength: 512,
      transient: false,
      accountingStatus: "exact fixture bytes",
      allocationCount: 1,
      physicalGpuResidentBytes: null,
      physicalGpuResidencyStatus: "opaque-driver-owned-not-claimed",
    }],
  });
  const performanceController = (metrics) => ({
    async step() {},
    async renderOnce() {},
    async resolveGpuTimestampSample() { return null; },
    getMetrics: () => metrics,
    describePipeline: () => performancePipeline(metrics),
    describeResources: () => performanceResources(metrics),
    async drain() {},
    async dispose() { return true; },
  });
  const identity = (subjectId, tier, lane) => {
    const controller = performanceController(performanceMetrics(subjectId, tier, lane));
    return createObjectSculptorCorpusPerformanceIdentity({
      lane,
      sourceClosureHash: SOURCE_PROVENANCE.sourceHash,
      buildRevision: SOURCE_PROVENANCE.buildRevision,
      browser: timingTargetDevice.browser,
      captureSession: performanceCaptureSession,
      controller,
    });
  };
  const commonIdentity = (value) => {
    const common = structuredClone(value);
    delete common.lane;
    delete common.cadenceContract;
    delete common.workload.performanceTimestampMode;
    delete common.workload.timestampMode;
    const pipelineState = JSON.parse(common.workload.pipelineState);
    for (const field of ["performanceTimestampMode", "timestampQueriesRequired", "timestampQueriesRequested", "timestampQueriesActive"]) delete pipelineState[field];
    common.workload.pipelineState = JSON.stringify(pipelineState);
    return common;
  };
  const timingWindow = (id, kind, start, duration, workloadBinding, identitySha256) => {
    const rawSamples = Array.from({ length: CORPUS_TIMING_GATES.minimumSamplesPerWindow }, (_, index) => {
      const tail = index >= CORPUS_TIMING_GATES.minimumSamplesPerWindow - 7;
      return {
        id: `${id}-sample-${String(index).padStart(3, "0")}`,
        sequence: datum(index, "ordinal", "Measured", `${id} raw sequence`),
        capturedAtMonotonicMs: datum(start + duration * ((index + 1) / (CORPUS_TIMING_GATES.minimumSamplesPerWindow + 1)), "ms", "Measured", `${id} monotonic clock`),
        cpuMs: datum(tail ? 5 : 3, "ms", "Measured", `${id} CPU scene submission`),
        rafIntervalMs: datum(tail ? 15 : 14, "ms", "Measured", `${id} rAF interval`),
        deadlineMiss: false,
        workloadBinding,
        identitySha256,
        rendererDeviceGeneration: datum(1, "generation", "Measured", `${id} renderer generation`),
        deviceLossGeneration: datum(0, "generation", "Measured", `${id} device-loss generation`),
        frameOrdinal: datum(index + 1, "ordinal", "Measured", `${id} completed frame ordinal`),
        submissionOrdinal: datum(index + 1, "ordinal", "Measured", `${id} render submission ordinal`),
      };
    });
    const minimumDuration = kind === "cold" ? CORPUS_TIMING_GATES.coldMinimumDurationMs : CORPUS_TIMING_GATES.sustainedMinimumDurationMs;
    return {
      id,
      kind,
      workloadBinding,
      identitySha256,
      startedAtMonotonicMs: datum(start, "ms", "Measured", `${id} monotonic start`),
      endedAtMonotonicMs: datum(start + duration, "ms", "Measured", `${id} monotonic end`),
      durationMs: datum(duration, "ms", "Derived", "endedAtMonotonicMs - startedAtMonotonicMs"),
      minimumDurationMs: datum(minimumDuration, "ms", "Gated", `CORPUS_TIMING_GATES.${kind}MinimumDurationMs`),
      sampleCount: datum(rawSamples.length, "sample", "Measured", "rawSamples.length"),
      rawSamples,
      cpuP50Ms: datum(3, "ms", "Measured", "nearest-rank(rawSamples.cpuMs,0.5)"),
      cpuP95Ms: datum(5, "ms", "Measured", "nearest-rank(rawSamples.cpuMs,0.95)"),
      rafIntervalP50Ms: datum(14, "ms", "Measured", "nearest-rank(rawSamples.rafIntervalMs,0.5)"),
      rafIntervalP95Ms: datum(15, "ms", "Measured", "nearest-rank(rawSamples.rafIntervalMs,0.95)"),
      coverageRatio: datum((rawSamples.at(-1).capturedAtMonotonicMs.value - rawSamples[0].capturedAtMonotonicMs.value) / duration, "ratio", "Measured", "(last(rawSamples.capturedAtMonotonicMs) - first(rawSamples.capturedAtMonotonicMs)) / durationMs"),
      minimumCoverageRatio: datum(CORPUS_TIMING_GATES.minimumCoverageRatio, "ratio", "Gated", "CORPUS_TIMING_GATES.minimumCoverageRatio"),
      maximumGapRatio: datum((rawSamples[1].capturedAtMonotonicMs.value - rawSamples[0].capturedAtMonotonicMs.value) / duration, "ratio", "Measured", "max(adjacent rawSamples capturedAt delta) / durationMs"),
      maximumGapRatioGate: datum(CORPUS_TIMING_GATES.maximumGapRatio, "ratio", "Gated", "CORPUS_TIMING_GATES.maximumGapRatio"),
      deadlineMisses: datum(0, "count", "Measured", "count(rawSamples.deadlineMiss)"),
    };
  };
  const gpuPopulation = (id, start, workloadBinding, identitySha256) => {
    const rawSamples = Array.from({ length: CORPUS_TIMING_GATES.minimumSamplesPerWindow }, (_, index) => ({
      id: `${id}-sample-${String(index).padStart(3, "0")}`,
      sequence: datum(index, "ordinal", "Measured", `${id} raw sequence`),
      capturedAtMonotonicMs: datum(start + index + 1, "ms", "Measured", `${id} monotonic clock`),
      gpuMs: datum(index >= CORPUS_TIMING_GATES.minimumSamplesPerWindow - 7 ? 5 : 3, "ms", "Measured", `${id} forward-scene timestamp`),
      resolveOverheadMs: datum(index % 3 === 2 ? 0.2 : 0.1, "ms", "Measured", `${id} timestamp resolve overhead`),
      workloadBinding,
      identitySha256,
      rendererDeviceGeneration: datum(1, "generation", "Measured", `${id} renderer generation`),
      deviceLossGeneration: datum(0, "generation", "Measured", `${id} device-loss generation`),
      frameOrdinal: datum(index + 1, "ordinal", "Measured", `${id} completed frame ordinal`),
      submissionOrdinal: datum(index + 1, "ordinal", "Measured", `${id} render submission ordinal`),
    }));
    return {
      id,
      scopeId: "forward-scene",
      kind: "render",
      resolved: true,
      workloadBinding,
      identitySha256,
      startedAtMonotonicMs: datum(start, "ms", "Measured", `${id} monotonic start`),
      endedAtMonotonicMs: datum(start + rawSamples.length + 1, "ms", "Measured", `${id} monotonic finish`),
      sampleCount: datum(rawSamples.length, "sample", "Measured", "rawSamples.length"),
      rawSamples,
      gpuP50Ms: datum(3, "ms", "Measured", "nearest-rank(rawSamples.gpuMs,0.5)"),
      gpuP95Ms: datum(5, "ms", "Measured", "nearest-rank(rawSamples.gpuMs,0.95)"),
      resolveOverheadP95Ms: datum(0.2, "ms", "Measured", "nearest-rank(rawSamples.resolveOverheadMs,0.95)"),
      coverageRatio: datum((rawSamples.at(-1).capturedAtMonotonicMs.value - rawSamples[0].capturedAtMonotonicMs.value) / (rawSamples.length + 1), "ratio", "Measured", "(last(rawSamples.capturedAtMonotonicMs) - first(rawSamples.capturedAtMonotonicMs)) / collectionDurationMs"),
      minimumCoverageRatio: datum(CORPUS_TIMING_GATES.minimumCoverageRatio, "ratio", "Gated", "CORPUS_TIMING_GATES.minimumCoverageRatio"),
      maximumGapRatio: datum(1 / (rawSamples.length + 1), "ratio", "Measured", "max(adjacent rawSamples capturedAt delta) / collectionDurationMs"),
      maximumGapRatioGate: datum(CORPUS_TIMING_GATES.maximumGapRatio, "ratio", "Gated", "CORPUS_TIMING_GATES.maximumGapRatio"),
    };
  };
  const timingWorkloadCases = SCULPT_TARGET_IDS.flatMap((subjectId) => SCULPT_TIERS.map((tier) => ({ subjectId, tier }))).map(({ subjectId, tier }, caseIndex) => {
    const id = `${subjectId}:${tier}`;
    const sustainedCadenceIdentity = identity(subjectId, tier, "sustained-cadence");
    const oneShotGpuIdentity = identity(subjectId, tier, "one-shot-gpu");
    const workloadBinding = sha256(Buffer.from(JSON.stringify({ deviceBinding: timingDeviceBinding, commonIdentity: commonIdentity(sustainedCadenceIdentity) })));
    const cadenceIdentitySha256 = sha256(Buffer.from(JSON.stringify(sustainedCadenceIdentity)));
    const gpuIdentitySha256 = sha256(Buffer.from(JSON.stringify(oneShotGpuIdentity)));
    const base = caseIndex * 100_000;
    const coldCadenceWindows = [timingWindow(`${subjectId}-${tier}-cold-01`, "cold", base, CORPUS_TIMING_GATES.coldMinimumDurationMs, workloadBinding, cadenceIdentitySha256)];
    const sustainedCadenceWindows = [
      timingWindow(`${subjectId}-${tier}-sustained-01`, "sustained", base + 3_000, CORPUS_TIMING_GATES.sustainedMinimumDurationMs, workloadBinding, cadenceIdentitySha256),
      timingWindow(`${subjectId}-${tier}-sustained-02`, "sustained", base + 34_000, CORPUS_TIMING_GATES.sustainedMinimumDurationMs, workloadBinding, cadenceIdentitySha256),
    ];
    const gpuTimestampPopulations = [gpuPopulation(`${subjectId}-${tier}-gpu-01`, base + 70_000, workloadBinding, gpuIdentitySha256)];
    const retentionRecord = (windows) => ({
      observedSampleCount: datum(windows.reduce((total, window) => total + window.rawSamples.length, 0), "sample", "Measured", "retained rawSamples.length"),
      retainedSampleCount: datum(windows.reduce((total, window) => total + window.rawSamples.length, 0), "sample", "Measured", "retained rawSamples.length"),
      retainedWindowCount: datum(windows.length, "window", "Measured", "retained windows.length"),
      limitRejectionCount: datum(0, "count", "Measured", "frame-driver retention rejection counter"),
    });
    return {
      id,
      subjectId,
      tier,
      workloadBinding,
      sustainedCadenceIdentity,
      oneShotGpuIdentity,
      coldCadenceWindows,
      sustainedCadenceWindows,
      gpuTimestampPopulations,
      retention: {
        limits: {
          maxWindowCountPerLane: datum(CORPUS_PERFORMANCE_EVIDENCE_LIMITS.maxWindowCountPerLane, "window", "Gated", "CORPUS_PERFORMANCE_EVIDENCE_LIMITS.maxWindowCountPerLane"),
          maxSampleCountPerLane: datum(CORPUS_PERFORMANCE_EVIDENCE_LIMITS.maxSampleCountPerLane, "sample", "Gated", "CORPUS_PERFORMANCE_EVIDENCE_LIMITS.maxSampleCountPerLane"),
        },
        oneShotGpu: retentionRecord(gpuTimestampPopulations),
        sustainedCadence: retentionRecord([...coldCadenceWindows, ...sustainedCadenceWindows]),
      },
      finalStableWindowId: `${subjectId}-${tier}-sustained-02`,
    };
  });
  {
    const metrics = performanceMetrics(SCULPT_TARGET_IDS[0], SCULPT_TIERS[0], "one-shot-gpu");
    const controller = performanceController(metrics);
    const performanceIdentity = createObjectSculptorCorpusPerformanceIdentity({
      lane: "one-shot-gpu",
      sourceClosureHash: SOURCE_PROVENANCE.sourceHash,
      buildRevision: SOURCE_PROVENANCE.buildRevision,
      browser: timingTargetDevice.browser,
      captureSession: performanceCaptureSession,
      controller,
    });
    const diagnosticDriver = createObjectSculptorCorpusFrameDriver({
      controller,
      performanceIdentity,
      now: () => 0,
      requestFrame: () => 1,
      cancelFrame: () => {},
      onMetrics: () => {},
      onError: () => {},
    });
    const authority = diagnosticDriver.publicController.getMetrics().performancePublicationAuthority;
    assert.equal(authority.publishable, false, "Node fixture timing must remain diagnostic and nonpublishable");
    assert.deepEqual(authority.missingRequirements, ["canonicalBrowserTiming", "physicalCaptureSession"]);
    await diagnosticDriver.close();
  }
  const refreshPeriod = 1000 / 60;
  const cpuEnvelope = refreshPeriod - 2 - 2;
  const gpuEnvelope = refreshPeriod - 2 - 2;
  writeJson(directory, "timing-trace.json", {
    ...commonDocument(RUN_BINDINGS.performance),
    targetDevice: timingTargetDevice,
    viewport: timingViewport,
    deviceBinding: timingDeviceBinding,
    displayRefreshHz: datum(60, "Hz", "Measured", "fixture display measurement"),
    targetPresentationRateHz: datum(60, "Hz", "Gated", "fixture target cadence"),
    refreshPeriodMs: datum(refreshPeriod, "ms", "Derived", "1000 / targetPresentationRateHz"),
    browserMainThreadReserveMs: datum(2, "ms", "Measured", "pass-through host-shell p95"),
    compositorGpuReserveMs: datum(2, "ms", "Authored", "provisional compositor reserve; no compositor timing API claimed"),
    cpuSafetyReserveMs: datum(2, "ms", "Authored", "frozen CPU safety reserve"),
    gpuSafetyReserveMs: datum(2, "ms", "Authored", "frozen GPU safety reserve"),
    cpuSceneEnvelopeMs: datum(cpuEnvelope, "ms", "Derived", "refreshPeriodMs - browserMainThreadReserveMs - cpuSafetyReserveMs"),
    gpuSceneEnvelopeMs: datum(gpuEnvelope, "ms", "Derived", "refreshPeriodMs - compositorGpuReserveMs - gpuSafetyReserveMs"),
    cpuP95GateMs: datum(cpuEnvelope, "ms", "Gated", "cpuSceneEnvelopeMs"),
    gpuP95GateMs: datum(gpuEnvelope, "ms", "Gated", "gpuSceneEnvelopeMs"),
    rafIntervalP95GateMs: datum(refreshPeriod, "ms", "Gated", "refreshPeriodMs"),
    deadlineMissGate: datum(CORPUS_TIMING_GATES.deadlineMisses, "count", "Gated", "CORPUS_TIMING_GATES.deadlineMisses"),
    minimumSamplesPerWindow: datum(CORPUS_TIMING_GATES.minimumSamplesPerWindow, "sample", "Gated", "CORPUS_TIMING_GATES.minimumSamplesPerWindow"),
    gpuTimingRequirement: "required",
    timestampTrackingEnabled: true,
    gpuTimestampSupport: true,
    presentationTiming: {
      verdict: "NOT_CLAIMED",
      api: null,
      reason: "No browser compositor timing API supplied independently attributable presentation timing.",
    },
    workloadCases: timingWorkloadCases,
  });

  const resourceWorkloadPlan = SCULPT_TARGET_IDS.flatMap((subjectId) => SCULPT_TIERS.map((tier) => ({ id: `${subjectId}:${tier}`, subjectId, tier })));
  const resourceRows = resourceWorkloadPlan.flatMap((workload, caseIndex) => RESOURCE_CATEGORIES.map((category, categoryIndex) => {
    const opaque = category === "renderer" || category === "shadow";
    const elementCount = opaque ? 0 : 100 + caseIndex * 10 + categoryIndex;
    const logicalBytes = elementCount * 4;
    const transient = category === "capture-target" || category === "readback-staging";
    return {
      id: `${workload.subjectId}-${workload.tier}-${category}-row-${categoryIndex}`,
      workloadCaseId: workload.id,
      subjectId: workload.subjectId,
      tier: workload.tier,
      category,
      owner: `${workload.subjectId}-${workload.tier}-owner-${categoryIndex}`,
      ownershipClass: opaque ? "renderer-opaque" : "app-owned",
      resourceKind: `${category}-resource`,
      formulaId: "resource-product-and-traffic-v1",
      descriptorSource: opaque ? "renderer reports class but not physical allocation residency" : "lab-controller.describeResources runtime snapshot",
      elementCount: datum(elementCount, "element", "Measured", `${workload.id}/${category} runtime descriptor element count`),
      bytesPerElement: datum(opaque ? 0 : 4, "byte/element", "Measured", `${workload.id}/${category} runtime descriptor format bytes`),
      sampleCount: datum(opaque ? 0 : 1, "sample", "Measured", `${workload.id}/${category} runtime descriptor sample count`),
      multiplicity: datum(opaque ? 0 : 1, "allocation", "Measured", `${workload.id}/${category} runtime allocation multiplicity`),
      logicalBytes: datum(logicalBytes, "byte", "Derived", "product(elementCount,bytesPerElement,sampleCount,multiplicity)"),
      requestedAllocationBytes: datum(logicalBytes, "byte", "Derived", "logicalBytes exact app-requested allocation bytes"),
      peakRequestedLiveBytes: datum(logicalBytes, "byte", "Derived", "requestedAllocationBytes when observed liveness overlaps peak"),
      physicalResidency: {
        verdict: "NOT_CLAIMED",
        bytes: null,
        method: null,
        reason: "The browser exposes no authoritative physical GPU residency telemetry for this allocation.",
      },
      readExecutionsPerFrame: datum(1, "execution/frame", "Authored", `${workload.id}/${category} compulsory read execution count`),
      writeExecutionsPerFrame: datum(1, "execution/frame", "Authored", `${workload.id}/${category} compulsory write execution count`),
      readFraction: datum(1, "ratio", "Authored", `${workload.id}/${category} compulsory read fraction`),
      writeFraction: datum(0.5, "ratio", "Authored", `${workload.id}/${category} compulsory write fraction`),
      readBytesPerFrame: datum(logicalBytes, "byte/frame", "Derived", "logicalBytes * readExecutionsPerFrame * readFraction"),
      writeBytesPerFrame: datum(logicalBytes * 0.5, "byte/frame", "Derived", "logicalBytes * writeExecutionsPerFrame * writeFraction"),
      allocationCount: datum(opaque ? 0 : 1, "count", "Measured", `${workload.id}/${category} allocation inventory`),
      allocationIds: opaque ? [] : [`${workload.subjectId}-${workload.tier}-${category}-allocation-00`],
      livenessIntervals: opaque ? [] : [{
        id: `${workload.subjectId}-${workload.tier}-${category}-live-00`,
        startEvent: "fixture-frame-start",
        endEvent: "fixture-frame-complete",
        overlapsPeak: true,
      }],
      transient,
    };
  }));
  const normalizedResourceInventory = resourceRows.map((row) => ({
    id: row.id,
    workloadCaseId: row.workloadCaseId,
    subjectId: row.subjectId,
    tier: row.tier,
    category: row.category,
      owner: row.owner,
      ownershipClass: row.ownershipClass,
      resourceKind: row.resourceKind,
    allocationIds: row.allocationIds,
      transient: row.transient,
      logicalBytes: row.logicalBytes.value,
      requestedAllocationBytes: row.requestedAllocationBytes.value,
      physicalResidencyVerdict: row.physicalResidency.verdict,
  }));
  const resourceInventorySha256 = sha256(Buffer.from(JSON.stringify(normalizedResourceInventory)));
  const resourceCaseTotals = resourceWorkloadPlan.map((workload) => {
    const caseRows = resourceRows.filter(({ workloadCaseId }) => workloadCaseId === workload.id);
    const normalizedCaseRows = normalizedResourceInventory.filter(({ workloadCaseId }) => workloadCaseId === workload.id);
    const sum = (field) => caseRows.reduce((total, row) => total + row[field].value, 0);
    return {
      id: workload.id,
      subjectId: workload.subjectId,
      tier: workload.tier,
      inventorySha256: sha256(Buffer.from(JSON.stringify(normalizedCaseRows))),
      logicalBytes: datum(sum("logicalBytes"), "byte", "Derived", "sum case resource logical bytes"),
      requestedAllocationBytes: datum(sum("requestedAllocationBytes"), "byte", "Derived", "sum case resource requested bytes"),
      peakRequestedLiveBytes: datum(sum("peakRequestedLiveBytes"), "byte", "Derived", "sum(case rows.peakRequestedLiveBytes)"),
      peakTransientRequestedBytes: datum(caseRows.filter(({ transient }) => transient).reduce((total, row) => total + row.peakRequestedLiveBytes.value, 0), "byte", "Derived", "sum(transient case rows.peakRequestedLiveBytes)"),
      readBytesPerFrame: datum(sum("readBytesPerFrame"), "byte/frame", "Derived", "sum case compulsory reads"),
      writeBytesPerFrame: datum(sum("writeBytesPerFrame"), "byte/frame", "Derived", "sum case compulsory writes"),
      physicalResidency: {
        verdict: "NOT_CLAIMED",
        bytes: null,
        method: null,
        reason: "Only logical and requested application bytes are closed; physical GPU residency is opaque.",
      },
    };
  });
  const lifecycleResourceWorkloadCaseId = "potted-bonsai:budgeted";
  const lifecycleResourceCase = resourceCaseTotals.find(({ id }) => id === lifecycleResourceWorkloadCaseId);
  const persistentAllocationIds = resourceRows.filter(({ workloadCaseId, transient }) => workloadCaseId === lifecycleResourceWorkloadCaseId && !transient).flatMap(({ allocationIds }) => allocationIds).sort();
  writeJson(directory, "resource-ledger.json", {
    ...commonDocument(RUN_BINDINGS.performance),
    inventorySha256: resourceInventorySha256,
    rows: resourceRows,
    caseTotals: resourceCaseTotals,
    peakRequestedLiveBytesGate: datum(CORPUS_RESOURCE_PEAK_GATE_BYTES, "byte", "Gated", "CORPUS_RESOURCE_PEAK_GATE_BYTES"),
  });

  const lifecycleSnapshot = (state, id, phase, capturedAt, liveResourceIds = persistentAllocationIds) => {
    const snapshot = {
      snapshotId: `${id}-${phase}-snapshot`,
      capturedAtMonotonicMs: datum(capturedAt, "ms", "Measured", `${id}/${phase} monotonic runtime snapshot clock`),
      snapshotSource: "lab-controller.getMetrics",
      liveResourceIds,
      uncertainResourceIds: [],
      possiblyLiveResourceIds: [],
      disposalClosureStatus: "certain",
      allocationCounter: datum(state.allocationCounter, "count", "Measured", `${id}/${phase} allocation counter`),
      disposalCounter: datum(state.disposalCounter, "count", "Measured", `${id}/${phase} disposal counter`),
      rendererDeviceGeneration: datum(state.rendererDeviceGeneration, "generation", "Measured", `${id}/${phase} renderer generation`),
      deviceLossGeneration: datum(state.deviceLossGeneration, "generation", "Measured", `${id}/${phase} device-loss generation`),
      historyEpoch: datum(state.historyEpoch, "epoch", "Measured", `${id}/${phase} history epoch`),
      viewport: state.viewport,
      dpr: datum(state.dpr, "ratio", "Measured", `${id}/${phase} DPR`),
      tier: state.tier,
      mode: state.mode,
      subjectId: state.subjectId,
    };
    snapshot.snapshotSha256 = sha256(Buffer.from(JSON.stringify(snapshot)));
    return snapshot;
  };
  const observedLifecycleValue = (id, state) => {
    if (id === "resize") return state.viewport;
    if (id === "dpr-change") return String(state.dpr);
    if (id === "tier-change") return state.tier;
    if (id === "mode-change") return state.mode;
    if (id === "history-reset") return String(state.historyEpoch);
    if (id === "subject-replace") return state.subjectId;
    if (id === "dispose-recreate") return String(state.rendererDeviceGeneration);
    return String(state.deviceLossGeneration);
  };
  const lifecycleCases = LIFECYCLE_CASE_IDS.map((id) => {
    let state = {
      allocationCounter: 10,
      disposalCounter: 4,
      rendererDeviceGeneration: 1,
      deviceLossGeneration: 0,
      historyEpoch: 0,
      viewport: "390x844",
      dpr: 1,
      tier: "budgeted",
      mode: "action-ready",
      subjectId: "potted-bonsai",
    };
    let previousAfterDocument = null;
    const witnesses = Array.from({ length: CORPUS_LIFECYCLE_MINIMUM_ITERATIONS }, (_, iteration) => {
      const beforeState = { ...state };
      const baseTime = iteration * 10 + LIFECYCLE_CASE_IDS.indexOf(id) * 100_000;
      const beforeDocument = previousAfterDocument ?? lifecycleSnapshot(beforeState, id, `iteration-${iteration}-before`, baseTime);
      const actionState = { ...beforeState };
      let allocationsDelta = 0;
      let disposalsDelta = 0;
      if (id === "resize") actionState.viewport = actionState.viewport === "390x844" ? "400x844" : "390x844";
      if (id === "dpr-change") actionState.dpr = actionState.dpr === 1 ? 1.5 : 1;
      if (id === "tier-change") actionState.tier = actionState.tier === "budgeted" ? "full" : "budgeted";
      if (id === "mode-change") actionState.mode = actionState.mode === "action-ready" ? "final" : "action-ready";
      if (id === "history-reset") actionState.historyEpoch += 1;
      if (id === "subject-replace") actionState.subjectId = actionState.subjectId === "potted-bonsai" ? "ceramic-teapot" : "potted-bonsai";
      if (id !== "history-reset") {
        allocationsDelta = 1;
        disposalsDelta = 1;
        actionState.allocationCounter += 1;
        actionState.disposalCounter += 1;
      }
      if (id === "dispose-recreate") actionState.rendererDeviceGeneration += 1;
      if (id === "device-error-recovery") {
        actionState.rendererDeviceGeneration += 1;
        actionState.deviceLossGeneration += 1;
      }
      const observedValue = observedLifecycleValue(id, actionState);
      const actionResourceIds = id === "history-reset"
        ? persistentAllocationIds
        : persistentAllocationIds.map((resourceId) => `${resourceId}-action-${String(iteration).padStart(3, "0")}`);
      const afterActionDocument = lifecycleSnapshot(actionState, id, `iteration-${iteration}-after-action`, baseTime + 3, actionResourceIds);
      const afterState = { ...actionState };
      if (id === "resize") afterState.viewport = beforeState.viewport;
      if (id === "dpr-change") afterState.dpr = beforeState.dpr;
      if (id === "tier-change") afterState.tier = beforeState.tier;
      if (id === "mode-change") afterState.mode = beforeState.mode;
      if (id === "subject-replace") afterState.subjectId = beforeState.subjectId;
      state = afterState;
      const afterDocument = lifecycleSnapshot(afterState, id, `iteration-${iteration}-after`, baseTime + 4);
      previousAfterDocument = afterDocument;
      return {
        iteration: datum(iteration, "ordinal", "Measured", `${id} witness order`),
        before: beforeDocument,
        action: {
          id,
          transitionId: `${id}-transition-${String(iteration).padStart(3, "0")}`,
          status: "completed",
          requestedValue: observedValue,
          observedValue,
          startedAtMonotonicMs: datum(baseTime + 1, "ms", "Measured", `${id} controller transition start`),
          finishedAtMonotonicMs: datum(baseTime + 2, "ms", "Measured", `${id} controller transition finish`),
          controllerReceipt: {
            operationId: `${id}-operation-${String(iteration).padStart(3, "0")}`,
            generationBefore: datum(beforeState.rendererDeviceGeneration, "generation", "Measured", `${id} receipt generation before`),
            generationAfter: datum(actionState.rendererDeviceGeneration, "generation", "Measured", `${id} receipt generation after`),
            status: "committed",
          },
        },
        resourceDisposition: {
          status: "closed",
          uncertainResourceIds: [],
          possiblyLiveResourceIds: [],
        },
        afterAction: afterActionDocument,
        after: afterDocument,
        counters: {
          allocationsDelta: datum(allocationsDelta, "count", "Measured", `${id} allocation delta`),
          disposalsDelta: datum(disposalsDelta, "count", "Measured", `${id} disposal delta`),
          frameErrorDelta: datum(0, "count", "Measured", `${id} frame error delta`),
          lifecycleErrorDelta: datum(0, "count", "Measured", `${id} lifecycle error delta`),
          deviceErrorDelta: datum(id === "device-error-recovery" ? 1 : 0, "count", "Measured", `${id} device error delta`),
        },
        invariantResults: [
          { id: `${id}:action-applied`, passed: true, witness: `${id} changed its declared state field` },
          { id: `${id}:resource-equilibrium`, passed: true, witness: `${id} returned to the same persistent allocation inventory` },
          { id: `${id}:no-unhandled-errors`, passed: true, witness: `${id} emitted no unhandled frame or lifecycle error` },
        ],
        errorEvents: [],
        postDisposeErrorEvents: [],
      };
    });
    return {
      id,
      iterations: datum(witnesses.length, "iteration", "Measured", `${id} witnesses.length`),
      witnesses,
    };
  });
  const lifecycleTrendAnalysis = lifecycleCases.map((lifecycleCase) => {
    const first = lifecycleCase.witnesses[0].before;
    const last = lifecycleCase.witnesses.at(-1).after;
    return {
      caseId: lifecycleCase.id,
      sampleCount: lifecycleCase.witnesses.length,
      netLiveResourceDelta: last.liveResourceIds.length - first.liveResourceIds.length,
      netAllocationMinusDisposalDelta: (last.allocationCounter.value - first.allocationCounter.value) - (last.disposalCounter.value - first.disposalCounter.value),
      verdict: "PASS",
    };
  });
  writeJson(directory, "lifecycle-evidence.json", {
    ...commonDocument(RUN_BINDINGS.lifecycle),
    resourceWorkloadCaseId: lifecycleResourceWorkloadCaseId,
    resourceInventorySha256: lifecycleResourceCase.inventorySha256,
    collectionMethod: "lab-controller-runtime-snapshots-and-transitions-v1",
    minimumIterations: datum(CORPUS_LIFECYCLE_MINIMUM_ITERATIONS, "iteration", "Gated", "CORPUS_LIFECYCLE_MINIMUM_ITERATIONS"),
    cases: lifecycleCases,
    trendAnalysis: lifecycleTrendAnalysis,
  });

  const evidenceManifest = {
    ...commonDocument(RUN_BINDINGS.correctness),
    claimVerdicts: {
      visualCorrectness: "PASS",
      mechanismCorrectness: "PASS",
      performanceCompliance: "PASS",
      gpuAttribution: "PASS",
      lifecycleStability: "PASS",
      visualError: "PASS",
    },
    profile: "correctness",
    captureProvenance: {
      sourceHash: captureSession.sourceHash,
      sourceClosureHash: captureSession.sourceClosureHash,
      sourceClosure: captureSession.sourceClosure,
      buildRevision: captureSession.buildRevision,
      threeRevision: captureSession.threeRevision,
      profile: captureSession.profile,
      profileConfig: captureSession.profileConfig,
      browser: captureSession.browser,
      automationSurface: captureSession.automationSurface,
      adapterClass: captureSession.adapterClass,
      adapterIdentity: captureSession.adapterIdentity,
      browserEntry: captureSession.browserEntry,
      url: captureSession.url,
      finalUrl: captureSession.finalUrl,
      route: captureSession.route,
      startedAt: captureSession.startedAt,
      finishedAt: captureSession.finishedAt,
    },
    runBindings: RUN_BINDINGS,
    captureSession: captureSessionRef,
    routeRuntimeEvidence: routeEvidenceRef,
    visualContract: visualContractRef,
    captures: CORPUS_CAPTURE_PLAN.map((planned) => ({
      filename: planned.filename,
      state: planned.state,
      file: captureFiles.get(planned.filename),
    })),
    standardOutputs: standardOutputs.map((output) => ({
      id: output.id,
      status: output.status,
      file: output.status === "CAPTURED"
        ? { path: output.file.path, sha256: output.file.sha256 }
        : null,
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

assert.deepEqual(validateCorpusCorrectnessCaptureProfile(
  CORPUS_CORRECTNESS_CAPTURE_PROFILE.profile,
  {
    width: CORPUS_CORRECTNESS_CAPTURE_PROFILE.width,
    height: CORPUS_CORRECTNESS_CAPTURE_PROFILE.height,
    dpr: CORPUS_CORRECTNESS_CAPTURE_PROFILE.dpr,
  },
), [], "the exact canonical 1200x800 DPR1 release profile must be accepted");
assert.match(
  validateCorpusCorrectnessCaptureProfile("correctness", { width: 2, height: 1, dpr: 1 }).join("\n"),
  /exactly 1200x800 CSS pixels at DPR 1/,
  "a reduced correctness capture must be rejected",
);
assert.match(
  validateCorpusCorrectnessCaptureProfile("contract-fixture", { width: 2, height: 1, dpr: 1 }).join("\n"),
  /nonpublishable and cannot support canonical acceptance/,
  "the compact contract fixture must be categorically nonpublishable",
);

const fixture = await makeFixtureBundle();
const contractFixture = validateCorpusArtifacts({ bundleDirectory: fixture.directory });
assert.equal(contractFixture.structuralVerdict, "FAIL", "the compact contract fixture must never occupy an accepted release lane");
assert.notEqual(contractFixture.claimVerdict, "PASS", "the compact contract fixture must never support acceptance");
assert(contractFixture.structuralErrors.length > 0);
assert(contractFixture.structuralErrors.every((error) => (
  /contract-fixture capture profile is nonpublishable/.test(error)
  || /canonical correctness capture profile must be exactly 1200x800 CSS pixels at DPR 1/.test(error)
)), contractFixture.structuralErrors.join("\n"));
assert.equal(contractFixture.evidenceErrors.length, 0, contractFixture.evidenceErrors.join("\n"));
assert.equal(contractFixture.captureCountRequired, CORPUS_CAPTURE_PLAN.length);
assert.equal(contractFixture.physicalRouteRecordsRequired, 15);

let adversarialMutationCount = 0;

function mutateJson(filename, mutation, expectedPattern) {
  adversarialMutationCount += 1;
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
  adversarialMutationCount += 1;
  const path = join(fixture.directory, "visual-contract.json");
  const original = readFileSync(path);
  writeFileSync(path, "null\n");
  const result = validateCorpusArtifacts({ bundleDirectory: fixture.directory });
  assert.notEqual(result.claimVerdict, "PASS");
  assert.match(result.evidenceErrors.join("\n"), /must contain a JSON object/);
  writeFileSync(path, original);
}

mutateJson("evidence-manifest.json", () => ({}), /schema keys|identity drifted|bundleId/);
mutateJson("evidence-manifest.json", (document) => {
  document.claimVerdicts.mechanismCorrectness = "INSUFFICIENT_EVIDENCE";
  return document;
}, /mechanismCorrectness must be PASS/);
mutateJson("evidence-manifest.json", (document) => {
  delete document.captureSession.contentBinding;
  return document;
}, /evidence-manifest\.captureSession schema keys must be exactly/);
mutateJson("evidence-manifest.json", (document) => {
  document.captureSession.contentBinding = "self-excluded-finalized-offline";
  return document;
}, /contentBinding must identify the finalized offline file hash/);
mutateJson("evidence-manifest.json", (document) => {
  document.captureSession.sha256 = `sha256:${"0".repeat(64)}`;
  return document;
}, /evidence-manifest\.captureSession\.sha256 does not match file bytes/);
mutateJson("evidence-manifest.json", (document) => {
  document.captureSession.byteLength += 1;
  return document;
}, /byteLength does not match the finalized capture-session bytes/);
mutateJson("capture-session.json", (document) => {
  document.hookResult.rasterComparisons[0].rgbMaeCodeValues = 999;
  return document;
}, /does not match recomputed decoded RGB metrics/);
mutateJson("capture-session.json", (document) => {
  document.sourceHash = "0".repeat(64);
  return document;
}, /sourceHash does not match/);
mutateJson("capture-session.json", (document) => {
  document.browser.automationSurface = "codex-in-app-browser";
  return document;
}, /Playwright headless Chromium|automation surfaces disagree/);
mutateJson("capture-session.json", (document) => {
  document.hookResult.sourceClosure.files.pop();
  return document;
}, /omits, adds, or changes a canonical transitive executable dependency/);
mutateJson("capture-session.json", (document) => {
  document.url += "&capture=1";
  document.finalUrl += "&capture=1";
  document.route.requestedUrl = document.url;
  document.route.finalUrl = document.finalUrl;
  return document;
}, /exactly one capture=1/);
mutateJson("capture-session.json", (document) => {
  document.route.observedRuntimeLabId = null;
  return document;
}, /route identity or final URL drifted/);
mutateJson("capture-session.json", (document) => {
  document.profileConfig.dpr = 2;
  return document;
}, /dimensions do not derive/);
mutateJson("capture-session.json", (document) => {
  document.hookResult.captures[0].pixelEvidence.transport.origin = "bottom-left";
  return document;
}, /transport origin must match the Three r185 top-left/);
mutateJson("capture-session.json", (document) => {
  document.hookResult.captures[0].pixelEvidence.transport.retentionStatus = "metadata-only";
  document.hookResult.captures[0].pixelEvidence.transport.rawArtifact = null;
  return document;
}, /transport bytes must be retained/);
mutateJson("capture-session.json", (document) => {
  const output = document.hookResult.standardOutputs.find(({ id }) => id === "final.design");
  output.derivation.inputs[0].capturePngSha256 = "0".repeat(64);
  output.derivationSha256 = computeCorpusStandardDerivationSha256(output.derivation);
  return document;
}, /input 0 hash binding mismatch/);
mutateJson("capture-session.json", (document) => {
  const output = document.hookResult.standardOutputs.find(({ id }) => id === "final.design");
  output.derivation.inputs[1].panelRect.x += 1;
  output.derivationSha256 = computeCorpusStandardDerivationSha256(output.derivation);
  return document;
}, /input 1 path or panel rectangle mismatch/);
mutateJson("capture-session.json", (document) => {
  const output = document.hookResult.standardOutputs.find(({ id }) => id === "final.design");
  output.derivation.resampling.kernel = "bilinear-forgery";
  output.derivationSha256 = computeCorpusStandardDerivationSha256(output.derivation);
  return document;
}, /resampling kernel or policy differs from the canonical contract/);
mutateJson("capture-session.json", (document) => {
  const output = document.hookResult.standardOutputs.find(({ id }) => id === "final.design");
  output.derivation.output.width -= 1;
  output.derivation.output.pngSha256 = "f".repeat(64);
  output.derivationSha256 = computeCorpusStandardDerivationSha256(output.derivation);
  return document;
}, /derivation output dimensions or hash mismatch/);
mutateJson("capture-session.json", (document) => {
  document.writtenCaptures[0].controllerNormalized.reconciliationStatus = "FAIL";
  return document;
}, /controllerNormalized does not prove zero-padded reconciliation/);
mutateJson("capture-session.json", (document) => {
  document.artifactWrites.splice(0, 1);
  return document;
}, /sequence must be contiguous|omits freshly written|must close over exactly/);
mutateJson("capture-session.json", (document) => {
  delete document.artifactWrites[0].byteLength;
  return document;
}, /artifactWrites\[0\] schema keys must be exactly/);
mutateJson("capture-session.json", (document) => {
  document.artifactWrites[0].contentBinding = "unbound-after-write";
  return document;
}, /contentBinding does not identify immutable write-bound bytes/);
mutateJson("capture-session.json", (document) => {
  document.artifactWrites[0].sha256 = `sha256:${"0".repeat(64)}`;
  return document;
}, /artifactWrites\[0\]\.content\.sha256 does not match file bytes/);
mutateJson("capture-session.json", (document) => {
  document.artifactWrites[0].byteLength += 1;
  return document;
}, /artifactWrites\[0\]\.byteLength changed after ledger binding/);
mutateJson("capture-session.json", (document) => {
  const self = document.artifactWrites.at(-1);
  self.contentBinding = "sha256-byte-length-immutable-buffer-v1";
  self.sha256 = `sha256:${"0".repeat(64)}`;
  self.byteLength = 1;
  return document;
}, /capture-session\.json must be the final write-ledger record|contentBinding does not identify|sha256 does not match/);
mutateJson("capture-session.json", (document) => {
  document.postDisposeSnapshot.deviceErrors = ["late device error"];
  return document;
}, /recorded an error after disposal and the two-frame settling barrier/);
mutateJson("capture-session.json", (document) => {
  document.outputPlan[0].derivation.normalizedPacked.sha256 = `sha256:${"0".repeat(64)}`;
  return document;
}, /derivation\.normalizedPacked does not match the canonical capture\/file reference/);
mutateJson("capture-session.json", (document) => {
  const tierCapture = document.hookResult.captures.find(({ state }) => state.subjectId === SCULPT_TARGET_IDS[0] && state.tier === "budgeted" && state.mode === "final" && state.camera === "design");
  tierCapture.identityEvidence.instanceGeneration += 1;
  return document;
}, /tier transition did not preserve/);
mutateJson("evidence-manifest.json", (document) => {
  document.captureProvenance.profile = "performance";
  return document;
}, /captureProvenance does not exactly bind/);
mutateJson("visual-reviews.json", (document) => {
  document.reviews[0].aiVisionScore.value = 0.1;
  return document;
}, /score is below its gate/);
mutateJson("visual-reviews.json", (document) => {
  document.reviews[0].sculptSpec.sha256 = "0".repeat(64);
  return document;
}, /current canonical ObjectSculptSpec bytes/);
mutateJson("visual-reviews.json", (document) => {
  document.reviews[0].criticalFeatures[0].specFeatureSha256 = "0".repeat(64);
  return document;
}, /does not bind the ordered canonical ObjectSculptSpec feature bytes/);
mutateJson("visual-error-results.json", (document) => {
  document.results.find(({ id }) => id === `final-authored-contract:${SCULPT_TARGET_IDS[0]}`).measurement.value = 0.85;
  return document;
}, /aiVisionScore must exactly equal/);
mutateJson("visual-error-results.json", (document) => {
  document.results.find(({ id }) => id === `action-motion-delta:${SCULPT_TARGET_IDS[0]}`).measurement.value = 0.5;
  return document;
}, /measurement must equal the independently decoded PNG raster comparison/);
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
mutateJson("route-runtime-evidence.json", (document) => {
  document.captureSession.automationSurface = "playwright-headless-chromium";
  return document;
}, /distinct Codex in-app Browser physical-route surface/);
mutateJson("timing-trace.json", (document) => {
  document.timestampTrackingEnabled = false;
  return document;
}, /pre-init timestamp tracking/);
mutateJson("timing-trace.json", (document) => {
  document.workloadCases.pop();
  return document;
}, /exactly 9 subject\/tier workload cases/);
mutateJson("timing-trace.json", (document) => {
  document.workloadCases[0].subjectId = SCULPT_TARGET_IDS[1];
  return document;
}, /identity\/order drifted/);
mutateJson("timing-trace.json", (document) => {
  for (const sample of document.workloadCases[0].gpuTimestampPopulations[0].rawSamples.slice(0, 8)) sample.gpuMs.value = 20;
  return document;
}, /GPU summary does not recompute/);
mutateJson("timing-trace.json", (document) => {
  document.workloadCases[0].coldCadenceWindows[0].endedAtMonotonicMs.value += 1;
  return document;
}, /durationMs does not derive/);
mutateJson("timing-trace.json", (document) => {
  document.browserMainThreadReserveMs.value += 1;
  return document;
}, /CPU envelope does not derive/);
mutateJson("timing-trace.json", (document) => {
  document.deviceBinding = "0".repeat(64);
  return document;
}, /deviceBinding does not match/);
mutateJson("timing-trace.json", (document) => {
  document.workloadCases[0].sustainedCadenceIdentity.adapter.name = "Forged second adapter";
  return document;
}, /do not match the named target browser\/adapter|immutable workload/);
mutateJson("timing-trace.json", (document) => {
  document.workloadCases[0].sustainedCadenceWindows[0].rawSamples[0].gpuMs = datum(1, "ms", "Measured", "forged mixed timing lane");
  return document;
}, /schema keys must be exactly/);
mutateJson("timing-trace.json", (document) => {
  document.workloadCases[0].sustainedCadenceWindows[0].rawSamples[1].capturedAtMonotonicMs.value = document.workloadCases[0].sustainedCadenceWindows[0].rawSamples[0].capturedAtMonotonicMs.value;
  return document;
}, /discontinuous or outside/);
mutateJson("timing-trace.json", (document) => {
  document.workloadCases[0].oneShotGpuIdentity.workload.threeRevision = "184";
  return document;
}, /Three r185 native WebGPU performance profile/);
mutateJson("timing-trace.json", (document) => {
  document.presentationTiming = { verdict: "PASS", api: null, reason: "forged from rAF" };
  return document;
}, /presentation\/compositor timing must remain NOT_CLAIMED/);
mutateJson("timing-trace.json", (document) => {
  document.workloadCases[0].retention.oneShotGpu.retainedSampleCount.value = 5000;
  return document;
}, /does not close over|exceeded the bounded frame-driver retention contract/);
mutateJson("resource-ledger.json", (document) => {
  document.caseTotals[0].logicalBytes.value += 1;
  return document;
}, /does not close over its exact six rows/);
mutateJson("resource-ledger.json", (document) => {
  document.rows.pop();
  return document;
}, /exactly 54 subject\/tier\/category rows/);
mutateJson("resource-ledger.json", (document) => {
  document.rows[2].allocationIds[0] = document.rows[1].allocationIds[0];
  return document;
}, /duplicate resource allocation ID/);
mutateJson("resource-ledger.json", (document) => {
  document.rows[1].elementCount.value += 1;
  return document;
}, /logicalBytes does not close/);
mutateJson("resource-ledger.json", (document) => {
  document.rows[1].livenessIntervals[0].overlapsPeak = false;
  return document;
}, /peakRequestedLiveBytes does not close/);
mutateJson("resource-ledger.json", (document) => {
  document.rows[0].physicalResidency = {
    verdict: "PASS",
    bytes: datum(1234, "byte", "Measured", "guessed renderer residency"),
    method: "logical-byte alias",
    reason: "forged",
  };
  return document;
}, /physicalResidency must remain explicitly NOT_CLAIMED/);
mutateJson("resource-ledger.json", (document) => {
  document.inventorySha256 = "0".repeat(64);
  return document;
}, /inventorySha256 does not bind/);
mutateJson("lifecycle-evidence.json", (document) => {
  document.cases[0].witnesses[0].afterAction.viewport = document.cases[0].witnesses[0].before.viewport;
  return document;
}, /action\/counter\/resource\/error closure|contradicts the validator-derived/);
mutateJson("lifecycle-evidence.json", (document) => {
  document.cases[2].witnesses[0].counters.allocationsDelta.value += 1;
  return document;
}, /action\/counter\/resource\/error closure/);
mutateJson("lifecycle-evidence.json", (document) => {
  document.cases[0].witnesses[0].errorEvents.push("forged PASS hid an error");
  return document;
}, /no-unhandled-errors|action\/counter\/resource\/error closure/);
mutateJson("lifecycle-evidence.json", (document) => {
  document.cases[0].witnesses[0].postDisposeErrorEvents.push("late disposal failure");
  return document;
}, /no-unhandled-errors|action\/counter\/resource\/error closure/);
mutateJson("lifecycle-evidence.json", (document) => {
  document.cases[0].iterations.value = 49;
  document.cases[0].witnesses.length = 49;
  return document;
}, /gated iteration count|witnesses must exactly close/);
mutateJson("lifecycle-evidence.json", (document) => {
  document.cases[0].witnesses[0].resourceDisposition.status = "uncertain";
  document.cases[0].witnesses[0].resourceDisposition.possiblyLiveResourceIds.push("possibly-live-target");
  return document;
}, /must prove certain closure with no possibly-live resources/);
mutateJson("lifecycle-evidence.json", (document) => {
  document.cases[0].witnesses[0].after.possiblyLiveResourceIds.push("possibly-live-after-disposal");
  return document;
}, /possiblyLiveResourceIds must be an observed empty set|snapshotSha256 does not bind/);
mutateJson("lifecycle-evidence.json", (document) => {
  document.trendAnalysis[0].netAllocationMinusDisposalDelta = 0;
  document.cases[0].witnesses.at(-1).after.allocationCounter.value += 2;
  return document;
}, /trendAnalysis must derive|snapshotSha256 does not bind/);
mutateJson("lifecycle-evidence.json", (document) => {
  document.resourceWorkloadCaseId = "missing-subject:full";
  return document;
}, /does not identify a validated subject\/tier resource case/);
mutateJson("visual-reviews.json", (document) => {
  document.runId = "wrong-correctness-run-0001";
  return document;
}, /runId does not match/);
mutateJson("visual-reviews.json", (document) => {
  document.reviews[0].renderImage = { path: "../escape.png", sha256: "0".repeat(64) };
  return document;
}, /canonical bundle-relative POSIX path/);

{
  adversarialMutationCount += 1;
  const session = JSON.parse(readFileSync(join(fixture.directory, "capture-session.json"), "utf8"));
  const binding = session.artifactWrites.find(({ path, contentBinding }) => (
    path.endsWith(".packed.bin")
    && contentBinding === "sha256-byte-length-immutable-buffer-v1"
  ));
  assert(binding, "fixture must expose one content-bound packed artifact");
  const path = join(fixture.directory, binding.path);
  const original = readFileSync(path);
  const substituted = Buffer.from(original);
  substituted[0] ^= 0xff;
  assert.equal(substituted.byteLength, binding.byteLength, "substitution mutation must preserve byte length");
  writeFileSync(path, substituted);
  const result = validateCorpusArtifacts({ bundleDirectory: fixture.directory });
  assert.notEqual(result.claimVerdict, "PASS");
  assert.match(result.structuralErrors.join("\n"), /artifactWrites\[\d+\]\.content\.sha256 does not match file bytes/);
  writeFileSync(path, original);
}

{
  adversarialMutationCount += 1;
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
  adversarialMutationCount += 1;
  const finalPath = join(fixture.directory, "final.design.png");
  const original = readFileSync(finalPath);
  writeFileSync(finalPath, encodeRgbaPng({
    width: 6,
    height: 1,
    data: Uint8Array.from({ length: 24 }, (_, index) => index % 4 === 3 ? 255 : 0),
  }));
  const result = validateCorpusArtifacts({ bundleDirectory: fixture.directory });
  assert.notEqual(result.claimVerdict, "PASS");
  assert.match([...result.structuralErrors, ...result.evidenceErrors].join("\n"), /blank or constant/);
  writeFileSync(finalPath, original);
}

{
  adversarialMutationCount += 1;
  const planned = CORPUS_CAPTURE_PLAN[0];
  const normalizedPath = join(fixture.directory, planned.filename.replace(/\.png$/, ".normalized.bin"));
  const original = readFileSync(normalizedPath);
  const changed = Buffer.from(original);
  changed[0] ^= 0xff;
  writeFileSync(normalizedPath, changed);
  const result = validateCorpusArtifacts({ bundleDirectory: fixture.directory });
  assert.notEqual(result.claimVerdict, "PASS");
  assert.match([...result.structuralErrors, ...result.evidenceErrors].join("\n"), /normalized packed RGBA hash does not derive|normalized pixels do not derive/);
  writeFileSync(normalizedPath, original);
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
  const records = routeRecords(fixture.directory);
  const readArtifact = (reference) => readFileSync(join(fixture.directory, reference.path));
  validatePhysicalRouteRuntimeRecords(records, { readArtifact });
  const expectRouteRejection = (recordsToValidate, pattern) => {
    adversarialMutationCount += 1;
    assert.throws(() => validatePhysicalRouteRuntimeRecords(recordsToValidate, { readArtifact }), pattern);
  };
  const wrongLock = structuredClone(records);
  wrongLock[0].selectors[1].disabled = true;
  expectRouteRejection(wrongLock, /lock state drifted|disable exactly one selector/);
  const fakeBackend = structuredClone(records);
  fakeBackend[0].runtime.backendType = "NotWebGPUBackend";
  expectRouteRejection(fakeBackend, /backend identity drifted/);
  const routeError = structuredClone(records);
  routeError[0].errorChannels.gpuErrors.events.push("synthetic GPU validation error");
  expectRouteRejection(routeError, /gpuErrors/);
  const aliasedRouteReadback = structuredClone(records);
  aliasedRouteReadback[0].readback.artifacts.normalized.path = aliasedRouteReadback[0].readback.artifacts.transport.path;
  expectRouteRejection(aliasedRouteReadback, /normalized artifact path drifted|artifact paths alias/);
}

const EXPECTED_ADVERSARIAL_MUTATIONS = 80;
assert.equal(adversarialMutationCount, EXPECTED_ADVERSARIAL_MUTATIONS, "adversarial mutation inventory drifted; update the frozen count intentionally");

console.log(JSON.stringify({
  ok: true,
  contractFixture: fixture.directory,
  captures: contractFixture.captureCountRequired,
  physicalRoutes: contractFixture.physicalRouteRecordsRequired,
  visualInvariants: contractFixture.visualInvariantResultsRequired,
  adversarialMutations: adversarialMutationCount,
}, null, 2));
