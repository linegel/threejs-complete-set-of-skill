import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";

import { CORPUS_DPR_CAPS } from "./lab-controller.js";
import { buildImmutableCorpusSnapshot } from "./immutable-route-server.mjs";
import { corpusRouteFromLocation, resolveCorpusInitialState } from "./route-state.js";
import {
  CORPUS_PHYSICAL_ROUTE_PLAN,
  CORPUS_ROUTE_BASE_PATH,
  CORPUS_ROUTE_ERROR_OBSERVERS,
  CORPUS_ROUTE_ORIGIN,
  CORPUS_ROUTE_PIPELINE_DESCRIPTOR,
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
  validateCanonicalIds,
  validateManifestRoutes,
  validatePhysicalRouteRuntimeRecords,
  validateRouteHtml,
} from "./validate-routes.mjs";
import { CORPUS_EXECUTABLE_SOURCE_CLOSURE } from "./trusted-runtime-source-manifest.generated.js";

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

const trustedRuntimeSourceManifest = buildTrustedCorpusRuntimeSourceManifest();
const trustedRuntimeSourceManifestSha256 = computeCorpusTrustedRuntimeSourceManifestHash(trustedRuntimeSourceManifest);
const trustedSourceByPath = new Map(trustedRuntimeSourceManifest.map((entry) => [entry.path, entry]));
const immutableSnapshot = buildImmutableCorpusSnapshot();
const readbackArtifacts = new Map();
const readArtifact = ({ path }) => {
  const bytes = readbackArtifacts.get(path);
  if (!bytes) throw new Error(`missing fixture artifact ${path}`);
  return bytes;
};

const routeSource = readFileSync(new URL("./scenario/potted-bonsai/index.html", import.meta.url), "utf8");
validateRouteHtml(routeSource, { kind: "scenario", id: "potted-bonsai" });

assert.throws(
  () => corpusRouteFromLocation({ search: "?scenario=unknown-sculpt" }),
  /Unknown sculpt target/,
  "unknown scenario routes must fail closed",
);

const routeRuntimeRecords = CORPUS_PHYSICAL_ROUTE_PLAN.map((route, routeIndex) => {
  const state = resolveCorpusInitialState({ scenario: null, mechanism: null, tier: null, camera: null, [route.kind]: route.id });
  const baselineState = { subjectId: state.scenario, scenario: state.scenario, mode: state.mechanism, tier: state.tier, camera: state.camera, seed: 1, time: 0 };
  const dimensions = {
    scenario: { selectorId: "subject", stateKeys: ["subjectId", "scenario"], methods: ["setSubject", "setScenario"], values: ["articulated-desk-lamp", "potted-bonsai", "ceramic-teapot"] },
    mechanism: { selectorId: "mode", stateKeys: ["mode"], methods: ["setMode"], values: ["final", "blockout", "hierarchy", "materials", "action-ready"] },
    tier: { selectorId: "tier", stateKeys: ["tier"], methods: ["setTier"], values: ["full", "budgeted", "minimum"] },
    camera: { selectorId: "camera", stateKeys: ["camera"], methods: ["setCamera"], values: ["design", "profile", "attachment", "close-material"] },
  };
  const dimension = dimensions[route.kind];
  const attemptedValue = dimension.values.find((value) => value !== route.id);
  const selectors = [
    { id: "subject", value: state.scenario, disabled: route.selectorId === "subject" },
    { id: "mode", value: state.mechanism, disabled: route.selectorId === "mode" },
    { id: "tier", value: state.tier, disabled: route.selectorId === "tier" },
    { id: "camera", value: state.camera, disabled: route.selectorId === "camera" },
  ];
  const enabledSelectorIds = selectors.filter(({ disabled }) => !disabled).map(({ id }) => id);
  const lockResult = (method, rejectionOrdinal) => ({
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
    rejectionOrdinal,
  });
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
  const routeHtmlSha256 = sha256(readFileSync(new URL(`./${route.urlPath}index.html`, import.meta.url)));
  const appModuleSha256 = trustedSourceByPath.get("threejs-object-sculptor/examples/webgpu-object-sculptor-corpus/app.js").sha256;
  const producerFiles = [
    "threejs-object-sculptor/examples/webgpu-object-sculptor-corpus/route-evidence-bootstrap.js",
    "threejs-object-sculptor/examples/webgpu-object-sculptor-corpus/route-evidence-client.js",
  ].map((path) => ({ path, sha256: trustedSourceByPath.get(path).sha256, byteLength: immutableSnapshot.resources.get(path).byteLength }));
  const producerBundleSha256 = computeCorpusRouteProducerBundleHash(producerFiles);
  const sourceHash = computeCorpusRouteSourceHash(
    route.routeId,
    routeHtmlSha256,
    immutableSnapshot.closureSha256,
    CORPUS_EXECUTABLE_SOURCE_CLOSURE.sourceHash,
  );
  const viewport = {
    cssWidth: 640,
    cssHeight: 360,
    devicePixelRatio: 1.25,
    appliedDpr: Math.min(1.25, CORPUS_DPR_CAPS[baselineState.tier]),
  };
  const pipelineDescriptor = structuredClone(CORPUS_ROUTE_PIPELINE_DESCRIPTOR);
  const pipeline = {
    descriptor: pipelineDescriptor,
    digestAlgorithm: "sha256",
    digest: computeCorpusRoutePipelineDigest(route.routeId, pipelineDescriptor),
  };
  const cameraPose = {
    cameraId: baselineState.camera,
    subjectId: baselineState.subjectId,
    positionMeters: [0, 1, 2],
    quaternion: [0, 0, 0, 1],
    up: [0, 1, 0],
    controlsTargetMeters: [0, 0.5, 0],
    fovDegrees: 38,
    aspect: viewport.cssWidth / viewport.cssHeight,
    nearMeters: 0.01,
    farMeters: 10,
  };
  const camera = {
    interactionEnabled: false,
    semanticCamera: baselineState.camera,
    beforeFirstFrame: structuredClone(cameraPose),
    afterFirstFrame: structuredClone(cameraPose),
    afterProbes: structuredClone(cameraPose),
    afterReadback: structuredClone(cameraPose),
    digestAlgorithm: "sha256",
    poseDigest: computeCorpusRouteCameraDigest(route.routeId, cameraPose),
  };
  const readbackWidth = Math.floor(viewport.cssWidth * viewport.appliedDpr);
  const readbackHeight = Math.floor(viewport.cssHeight * viewport.appliedDpr);
  const rowBytes = readbackWidth * 4;
  const sourceBytesPerRow = Math.ceil(rowBytes / 256) * 256;
  const sourceByteLength = sourceBytesPerRow * readbackHeight;
  const transportArtifactPath = corpusRouteReadbackArtifactPath(route, "transport");
  const normalizedArtifactPath = corpusRouteReadbackArtifactPath(route, "normalized");
  const transportArtifactBytes = new Uint8Array(rowBytes * readbackHeight);
  const normalizedArtifactBytes = new Uint8Array(sourceByteLength);
  transportArtifactBytes.fill((routeIndex + 1) & 0xff);
  for (let row = 0; row < readbackHeight; row += 1) {
    normalizedArtifactBytes.set(
      transportArtifactBytes.subarray(row * rowBytes, (row + 1) * rowBytes),
      row * sourceBytesPerRow,
    );
  }
  readbackArtifacts.set(transportArtifactPath, transportArtifactBytes);
  readbackArtifacts.set(normalizedArtifactPath, normalizedArtifactBytes);
  const transportSha256 = sha256(transportArtifactBytes);
  const normalizedSha256 = sha256(normalizedArtifactBytes);
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
      independentAllocation: normalizedArtifactBytes.buffer !== transportArtifactBytes.buffer,
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
        byteLength: transportArtifactBytes.byteLength,
        mediaType: "application/octet-stream",
        layout: "renderer-transport-rgba8unorm-top-left",
      },
      normalized: {
        path: normalizedArtifactPath,
        sha256: normalizedSha256,
        byteLength: normalizedArtifactBytes.byteLength,
        mediaType: "application/octet-stream",
        layout: "cpu-normalized-zero-padded-rgba8unorm-top-left",
      },
    },
    digestAlgorithm: "sha256",
    digest: null,
  };
  readback.digest = computeCorpusRouteReadbackDigest(route.routeId, readback);
  const errorChannels = {
    ...Object.fromEntries(Object.entries(CORPUS_ROUTE_ERROR_OBSERVERS).map(([channel, observer]) => [channel, {
      observerInstalled: true,
      activeFrom: observer.activeFrom,
      observerId: observer.observerId,
      events: [],
    }])),
    deviceLost: {
      monitorAttached: true,
      activeFrom: "before-first-frame",
      observerId: "gpu-device-lost",
      event: null,
    },
  };
  const routeHref = `${CORPUS_ROUTE_ORIGIN}${CORPUS_ROUTE_BASE_PATH}${route.urlPath}?capture=1`;
  return {
    routeId: route.routeId,
    kind: route.kind,
    id: route.id,
    urlPath: route.urlPath,
    provenance: {
      evidenceProducer: "immutable-browser-page-route-producer",
      sourceHashAlgorithm: "sha256",
      immutableServer: {
        manifestPath: "/.well-known/object-sculptor-corpus-immutable.json",
        manifestSha256: "1".repeat(64),
        snapshotId: immutableSnapshot.snapshotId,
        closureSha256: immutableSnapshot.closureSha256,
        transformMode: "none",
        immutableSnapshot: true,
        spaFallback: false,
        viteClient: false,
        entryCount: immutableSnapshot.entries.length,
      },
      servedRoute: {
        pathname: `${CORPUS_ROUTE_BASE_PATH}${route.urlPath}`,
        sourcePath: `threejs-object-sculptor/examples/webgpu-object-sculptor-corpus/${route.urlPath}index.html`,
        sha256: routeHtmlSha256,
        byteLength: readFileSync(new URL(`./${route.urlPath}index.html`, import.meta.url)).byteLength,
      },
      routeHtmlSha256,
      servedAppModule: {
        pathname: `${CORPUS_ROUTE_BASE_PATH}app.js`,
        sourcePath: "threejs-object-sculptor/examples/webgpu-object-sculptor-corpus/app.js",
        sha256: appModuleSha256,
        byteLength: immutableSnapshot.resources.get("threejs-object-sculptor/examples/webgpu-object-sculptor-corpus/app.js").byteLength,
      },
      appModuleSha256,
      producerFiles,
      producerBundleSha256,
      trustedRuntimeSourceManifest,
      trustedRuntimeSourceManifestSha256,
      executableSourceClosure: CORPUS_EXECUTABLE_SOURCE_CLOSURE,
      executedResourcePaths: [
        `${CORPUS_ROUTE_BASE_PATH}app.js`,
        `${CORPUS_ROUTE_BASE_PATH}route-evidence-bootstrap.js`,
        `${CORPUS_ROUTE_BASE_PATH}styles.css`,
      ].sort(),
      sourceHash,
      buildRevision: immutableSnapshot.snapshotId,
      browserEntry: `${CORPUS_ROUTE_BASE_PATH}${route.urlPath}`,
    },
    location: {
      origin: CORPUS_ROUTE_ORIGIN,
      requestedHref: routeHref,
      finalHref: routeHref,
      requestedPathname: `${CORPUS_ROUTE_BASE_PATH}${route.urlPath}`,
      finalPathname: `${CORPUS_ROUTE_BASE_PATH}${route.urlPath}`,
      search: "?capture=1",
      responseStatus: 200,
      documentReadyState: "complete",
      parentObserverAttestation: (() => {
        const attestation = {
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
        attestation.digest = computeCorpusParentObserverAttestationDigest(route.routeId, attestation);
        return attestation;
      })(),
      viewport,
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
    camera,
    routeLock: {
      state: {
        code: "CORPUS_ROUTE_LOCK_STATE",
        locks: Object.fromEntries(Object.entries(dimensions).map(([dimensionId, spec]) => [dimensionId, {
          dimension: dimensionId,
          selectorId: spec.selectorId,
          locked: dimensionId === route.kind,
          lockedValue: dimensionId === route.kind ? route.id : null,
          controllerMethods: spec.methods,
        }])),
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
        result: lockResult(dimension.methods[0], 1),
      },
      controllerProbes,
      unlockedProbes: Object.entries(dimensions).filter(([dimensionId]) => dimensionId !== route.kind).map(([dimensionId, spec]) => {
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
      }),
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
    pipeline,
    readback,
    errorChannels,
    labError: null,
    teardown: {
      explicitDispose: { requested: true, fulfilled: true, returnValue: { listenersDetached: true, controllerResult: null } },
      beforeDispose: {
        errorChannels: structuredClone(errorChannels),
        labError: null,
        frameDriverState: "idle",
        rendererDeviceStatus: "active",
      },
      afterDispose: {
        errorChannels: structuredClone(errorChannels),
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
        timestampsMonotonicMs: [routeIndex * 10 + 3, routeIndex * 10 + 4],
      },
      afterFrameReset: {
        owner: "in-app-evidence-runner",
        beforeHref: routeHref,
        afterHref: "about:blank",
        loadObserved: true,
        listenersRemoved: true,
        iframeErrorEvents: [],
      },
    },
  };
});
validatePhysicalRouteRuntimeRecords(routeRuntimeRecords, { readArtifact });
assert.throws(
  () => validatePhysicalRouteRuntimeRecords(routeRuntimeRecords),
  /requires a confined readArtifact/,
  "runtime route evidence must not accept unverified readback artifact references",
);

const runtimeNegativeControls = [];

function rejectRuntimeMutation(id, mutate, expectedPattern) {
  const records = structuredClone(routeRuntimeRecords);
  mutate(records);
  assert.throws(
    () => validatePhysicalRouteRuntimeRecords(records, { readArtifact }),
    expectedPattern,
    `runtime route evidence must reject ${id}`,
  );
  runtimeNegativeControls.push(id);
}

assert.throws(
  () => validatePhysicalRouteRuntimeRecords(routeRuntimeRecords, {
    readArtifact: (reference, record) => {
      if (record.routeId === "tier:minimum" && reference === record.readback.artifacts.normalized) {
        return readbackArtifacts.get(record.readback.artifacts.transport.path);
      }
      return readArtifact(reference, record);
    },
  }),
  /artifact byte ranges alias/,
  "runtime route evidence must reject two artifact references resolving to the same retained byte range",
);
runtimeNegativeControls.push("resolved-transport-normalized-byte-range-alias");

rejectRuntimeMutation("missing-runtime-route-record", (records) => records.pop(), /record count drifted/);
rejectRuntimeMutation("duplicate-runtime-route-record", (records) => { records[1] = structuredClone(records[0]); }, /runtime route ID drifted/);
rejectRuntimeMutation("wrong-final-path", (records) => { records[0].location.finalPathname = "/wrong/route/"; }, /redirected away|final pathname drifted/);
rejectRuntimeMutation("wrong-requested-path", (records) => { records[0].location.requestedPathname = "/wrong/route/"; }, /redirected away/);
rejectRuntimeMutation("query-drift", (records) => { records[0].location.search = "?capture=1&extra=1"; }, /exclusive capture ownership/);
rejectRuntimeMutation("source-hash-drift", (records) => { records[0].provenance.sourceHash = "0".repeat(64); }, /source hash does not bind/);
rejectRuntimeMutation("vite-transform-enabled", (records) => { records[0].provenance.immutableServer.transformMode = "vite"; }, /source was transformed/);
rejectRuntimeMutation("vite-client-injected", (records) => { records[0].provenance.immutableServer.viteClient = true; }, /enabled Vite injection/);
rejectRuntimeMutation("served-route-byte-drift", (records) => { records[0].provenance.servedRoute.sha256 = "0".repeat(64); }, /served route digest drifted/);
rejectRuntimeMutation("omitted-executable-source", (records) => { records[0].provenance.executableSourceClosure.files.pop(); }, /executable source closure drifted/);
rejectRuntimeMutation("producer-bundle-drift", (records) => { records[0].provenance.producerFiles[0].sha256 = "0".repeat(64); }, /producer file hash does not match|producer bundle hash drifted/);
rejectRuntimeMutation("build-revision-drift", (records) => { records[0].provenance.buildRevision = "fixture-build"; }, /build revision drifted/);
rejectRuntimeMutation("forged-rehashed-source-run", (records) => {
  const forgedManifest = structuredClone(records[0].provenance.trustedRuntimeSourceManifest);
  forgedManifest.find(({ path }) => path.endsWith("/app.js")).sha256 = "0".repeat(64);
  const forgedManifestSha256 = computeCorpusTrustedRuntimeSourceManifestHash(forgedManifest);
  for (const record of records) {
    record.provenance.appModuleSha256 = "0".repeat(64);
    record.provenance.trustedRuntimeSourceManifest = structuredClone(forgedManifest);
    record.provenance.trustedRuntimeSourceManifestSha256 = forgedManifestSha256;
  }
}, /app module hash does not match|trusted runtime source manifest drifted/);
rejectRuntimeMutation("browser-entry-drift", (records) => { records[0].provenance.browserEntry = "index.html"; }, /browser entry drifted/);
rejectRuntimeMutation("mixed-route-base", (records) => {
  const record = records[1];
  record.location.requestedPathname = `/demos/webgpu-object-sculptor-corpus/${record.urlPath}`;
  record.location.finalPathname = record.location.requestedPathname;
  record.location.requestedHref = `${CORPUS_ROUTE_ORIGIN}${record.location.requestedPathname}?capture=1`;
  record.location.finalHref = record.location.requestedHref;
  record.provenance.browserEntry = record.location.finalPathname;
}, /requested URL drifted|final pathname drifted|route base/);
rejectRuntimeMutation("missing-parent-observer-attestation", (records) => {
  records[0].location.parentObserverAttestation.observerIds = [];
}, /parent observer inventory drifted/);
rejectRuntimeMutation("late-parent-observer-attestation", (records) => {
  const attestation = records[0].location.parentObserverAttestation;
  attestation.installedAtMonotonicMs = attestation.navigationAssignedAtMonotonicMs + 1;
  attestation.digest = computeCorpusParentObserverAttestationDigest(records[0].routeId, attestation);
}, /not installed before navigation/);
rejectRuntimeMutation("retained-parent-navigation-listener", (records) => {
  records[0].location.parentObserverAttestation.listenersRemoved = false;
}, /listeners were not removed/);
rejectRuntimeMutation("viewport-dpr-drift", (records) => { records[0].location.viewport.appliedDpr += 0.25; }, /applied DPR/);
rejectRuntimeMutation("mixed-viewport-run", (records) => { records[1].location.viewport.cssWidth += 1; }, /physical viewport changed within one route run/);
rejectRuntimeMutation("document-dataset-drift", (records) => { records[0].documentRoute.subject = "ceramic-teapot"; }, /document subject dataset drifted/);
rejectRuntimeMutation("parsed-route-drift", (records) => { records[0].parsedRoute.scenario = null; }, /parsed route drifted/);
rejectRuntimeMutation("unlocked-runtime-route-selector", (records) => { records[0].selectors[0].disabled = false; }, /lock state drifted|disable exactly one selector/);
rejectRuntimeMutation("two-disabled-selectors", (records) => { records[0].selectors[1].disabled = true; }, /lock state drifted|disable exactly one selector/);
rejectRuntimeMutation("selector-controller-disagreement", (records) => { records[0].baselineState.subjectId = "ceramic-teapot"; }, /baselineState drifted/);
rejectRuntimeMutation("hud-not-ready", (records) => { records[0].hud.datasetState = "starting"; }, /HUD state is not Ready/);
rejectRuntimeMutation("hud-text-drift", (records) => { records[0].hud.textContent = "Ready"; }, /HUD Ready text drifted/);
rejectRuntimeMutation("camera-interaction-enabled", (records) => { records[0].camera.interactionEnabled = true; }, /camera interaction was not disabled/);
rejectRuntimeMutation("camera-pose-drift", (records) => { records[0].camera.afterReadback.positionMeters[0] += 0.25; }, /camera drifted during readback/);
rejectRuntimeMutation("camera-digest-drift", (records) => { records[0].camera.poseDigest = "0".repeat(64); }, /camera pose digest does not bind/);
rejectRuntimeMutation("camera-aspect-viewport-drift", (records) => {
  for (const stage of ["beforeFirstFrame", "afterFirstFrame", "afterProbes", "afterReadback"]) records[0].camera[stage].aspect = 1;
  records[0].camera.poseDigest = computeCorpusRouteCameraDigest(records[0].routeId, records[0].camera.afterReadback);
}, /aspect is not viewport-bound/);
rejectRuntimeMutation("locked-ui-state-drift", (records) => {
  records[0].routeLock.uiProbe.afterState = { ...records[0].routeLock.uiProbe.afterState, subjectId: "ceramic-teapot" };
}, /uiProbe\.afterState drifted/);
rejectRuntimeMutation("scenario-alias-bypass", (records) => { records[0].routeLock.controllerProbes[1].returnValue = true; }, /must return false/);
rejectRuntimeMutation("unlocked-controller-no-intermediate-change", (records) => {
  records[0].routeLock.unlockedProbes[0].changedState = structuredClone(records[0].baselineState);
}, /changedState drifted/);
rejectRuntimeMutation("unlocked-dom-no-intermediate-change", (records) => {
  records[0].routeLock.unlockedProbes[0].changedSelector.value = records[0].routeLock.unlockedProbes[0].beforeSelector.value;
}, /changedSelector value drifted/);
rejectRuntimeMutation("unlocked-restore-drift", (records) => {
  records[0].routeLock.unlockedProbes[0].restoredState = {
    ...records[0].routeLock.unlockedProbes[0].restoredState,
    mode: "blockout",
  };
}, /restoredState drifted/);
rejectRuntimeMutation("first-frame-counter-spoof", (records) => { records[0].firstFrame.after.completedFrames = 0; }, /first-frame advancement drifted/);
rejectRuntimeMutation("post-probe-submission-spoof", (records) => { records[0].postProbeRender.after.renderSubmissions = 1; }, /readback render delta drifted/);
rejectRuntimeMutation("spoofed-runtime-route-backend", (records) => { records[0].runtime.backendType = "NotWebGPUBackend"; }, /backend identity drifted/);
rejectRuntimeMutation("hidden-frame-error-counter", (records) => { records[0].runtime.frameErrorCount = 1; }, /recorded frame errors/);
rejectRuntimeMutation("hidden-lifecycle-error-counter", (records) => { records[0].runtime.lifecycleErrorCount = 1; }, /recorded lifecycle errors/);
rejectRuntimeMutation("pipeline-contract-drift", (records) => {
  records[0].pipeline.descriptor.owner = "SpoofedRenderer";
  records[0].pipeline.digest = computeCorpusRoutePipelineDigest(records[0].routeId, records[0].pipeline.descriptor);
}, /pipeline descriptor drifted/);
rejectRuntimeMutation("pipeline-digest-drift", (records) => { records[0].pipeline.digest = "0".repeat(64); }, /pipeline digest does not bind/);
rejectRuntimeMutation("readback-digest-drift", (records) => { records[0].readback.normalizedSha256 = "0".repeat(64); }, /normalized artifact digest disagreement|readback digest does not bind/);
rejectRuntimeMutation("rehashed-fake-readback-payload", (records) => {
  const readback = records[0].readback;
  readback.normalizedSha256 = "0".repeat(64);
  readback.artifacts.normalized.sha256 = readback.normalizedSha256;
  readback.digest = computeCorpusRouteReadbackDigest(records[0].routeId, readback);
}, /resolved normalized artifact SHA-256 drifted/);
rejectRuntimeMutation("readback-artifact-path-escape", (records) => {
  records[0].readback.artifacts.transport.path = "../outside.bin";
}, /transport artifact path drifted/);
rejectRuntimeMutation("zero-dimensional-readback", (records) => {
  records[0].readback.width = 0;
  records[0].readback.height = 0;
}, /readback width must be a positive integer/);
rejectRuntimeMutation("readback-stride-drift", (records) => { records[0].readback.requestedLayout.alignedBytesPerRow += 1; }, /not WebGPU-aligned/);
rejectRuntimeMutation("bottom-left-native-readback", (records) => {
  records[0].readback.origin = "bottom-left";
}, /readback origin drifted/);
rejectRuntimeMutation("missing-transport-artifact", (records) => {
  delete records[0].readback.artifacts.transport;
}, /readback artifacts schema drifted/);
rejectRuntimeMutation("transport-not-retained", (records) => {
  records[0].readback.transportLayout.retained = false;
}, /renderer transport bytes must be retained/);
rejectRuntimeMutation("transport-normalized-path-alias", (records) => {
  records[0].readback.artifacts.normalized.path = records[0].readback.artifacts.transport.path;
}, /normalized artifact path drifted|artifact paths alias/);
rejectRuntimeMutation("transport-normalized-hash-alias", (records) => {
  const readback = records[0].readback;
  readback.normalizedSha256 = readback.transportSha256;
  readback.artifacts.normalized.sha256 = readback.transportSha256;
  readback.digest = computeCorpusRouteReadbackDigest(records[0].routeId, readback);
}, /must not share a hash/);
rejectRuntimeMutation("normalized-padding-count-drift", (records) => {
  records[0].readback.normalizedArtifactLayout.zeroPaddingByteCount -= 1;
}, /padding was not fully zero-filled/);
rejectRuntimeMutation("normalized-allocation-alias", (records) => {
  records[0].readback.normalizedArtifactLayout.independentAllocation = false;
}, /independent allocation/);
rejectRuntimeMutation("png-style-readback-relabel", (records) => {
  records[0].readback.artifacts.normalized.path = records[0].readback.artifacts.normalized.path.replace(/\.bin$/, ".png");
  records[0].readback.artifacts.normalized.mediaType = "image/png";
}, /normalized artifact path drifted|media type drifted/);
rejectRuntimeMutation("missing-error-observer", (records) => { records[0].errorChannels.pageErrors.observerInstalled = false; }, /observer was not installed/);
rejectRuntimeMutation("error-observer-provenance-drift", (records) => { records[0].errorChannels.pageErrors.observerId = "unknown"; }, /observer provenance drifted/);
for (const channel of Object.keys(CORPUS_ROUTE_ERROR_OBSERVERS)) {
  rejectRuntimeMutation(`nonempty-${channel}`, (records) => { records[0].errorChannels[channel].events.push("synthetic error"); }, new RegExp(`recorded ${channel}`));
}
rejectRuntimeMutation("device-loss-event", (records) => { records[0].errorChannels.deviceLost.event = { reason: "synthetic" }; }, /recorded device loss/);
rejectRuntimeMutation("lab-error", (records) => { records[0].labError = { message: "synthetic" }; }, /published __LAB_ERROR__/);
rejectRuntimeMutation("post-disposal-console-error", (records) => {
  records[0].teardown.afterDispose.errorChannels.consoleErrors.events.push({ message: "late" });
}, /post-disposal consoleErrors events were recorded/);
rejectRuntimeMutation("page-listener-disposal-leak", (records) => {
  records[0].teardown.explicitDispose.returnValue.listenersDetached = false;
}, /page listeners were not detached before disposal/);
rejectRuntimeMutation("post-disposal-device-loss", (records) => {
  records[0].teardown.afterDispose.errorChannels.deviceLost.event = { reason: "destroyed" };
}, /device loss occurred during disposal/);
rejectRuntimeMutation("post-disposal-settling-frame-missing", (records) => {
  records[0].teardown.postDisposeSettlingBarrier.observedFrames = 1;
}, /did not observe two frames/);
rejectRuntimeMutation("post-disposal-settling-timestamp-regression", (records) => {
  records[0].teardown.postDisposeSettlingBarrier.timestampsMonotonicMs.reverse();
}, /timestamps are not monotonic/);
rejectRuntimeMutation("frame-reset-listener-leak", (records) => {
  records[0].teardown.afterFrameReset.listenersRemoved = false;
}, /frame reset listeners were retained/);
rejectRuntimeMutation("frame-reset-error", (records) => {
  records[0].teardown.afterFrameReset.iframeErrorEvents.push({ type: "iframe-error" });
}, /frame reset recorded iframe errors/);
assert.throws(
  () => corpusRouteFromLocation({ search: "?tier=full&tier=minimum" }),
  /Conflicting tier values in query/,
  "conflicting duplicate query values must fail closed",
);
assert.throws(
  () => corpusRouteFromLocation({ pathname: "/tier/full/tier/minimum/" }),
  /Conflicting tier values in pathname/,
  "conflicting duplicate physical path values must fail closed",
);
assert.throws(
  () => corpusRouteFromLocation({ pathname: "/mechanism/final/", search: "?mechanism=action-ready" }),
  /Conflicting mechanism route/,
  "path/query route conflicts must fail closed",
);

const missingStatus = routeSource.replace('id="status"', 'data-mutation="missing-status"');
assert.throws(
  () => validateRouteHtml(missingStatus, { kind: "scenario", id: "potted-bonsai" }),
  /exactly one active #status/,
  "the production DOM validator must reject a missing required control",
);

const duplicateMetric = routeSource.replace(
  '<dd id="metric-nodes">—</dd>',
  '<dd id="metric-nodes">—</dd><dd id="metric-nodes">duplicate</dd>',
);
assert.throws(
  () => validateRouteHtml(duplicateMetric, { kind: "scenario", id: "potted-bonsai" }),
  /exactly one active #metric-nodes/,
  "the production DOM validator must reject duplicate semantic DOM IDs",
);

const wrongLockMetadata = routeSource.replace('data-route-id="potted-bonsai"', 'data-route-id="ceramic-teapot"');
assert.throws(
  () => validateRouteHtml(wrongLockMetadata, { kind: "scenario", id: "potted-bonsai" }),
  /route ID metadata drifted/,
  "physical route metadata must not claim another subject",
);

const decoyModuleScript = routeSource.replace(
  '<script type="module" src="../../app.js"></script>',
  '<script type="text/javascript" src="../../app.js"></script><script type="module">void 0;</script>',
);
assert.throws(
  () => validateRouteHtml(decoyModuleScript, { kind: "scenario", id: "potted-bonsai" }),
  /app\.js script must itself be type=module/,
  "an unrelated module script must not conceal a classic ../../app.js import",
);

const dataIdSpoof = routeSource.replace('id="status"', 'data-id="status"');
assert.throws(
  () => validateRouteHtml(dataIdSpoof, { kind: "scenario", id: "potted-bonsai" }),
  /exactly one active #status/,
  "data-id must not satisfy the active DOM id contract",
);

const commentedAppScript = routeSource.replace(
  '<script type="module" src="../../app.js"></script>',
  '<!-- <script type="module" src="../../app.js"></script> -->',
);
assert.throws(
  () => validateRouteHtml(commentedAppScript, { kind: "scenario", id: "potted-bonsai" }),
  /one active \.\.\/\.\.\/app\.js script tag/,
  "a commented module tag must not satisfy executable app ownership",
);

const templateAppScript = routeSource.replace(
  '<script type="module" src="../../app.js"></script>',
  '<template><script type="module" src="../../app.js"></script></template>',
);
assert.throws(
  () => validateRouteHtml(templateAppScript, { kind: "scenario", id: "potted-bonsai" }),
  /one active \.\.\/\.\.\/app\.js script tag/,
  "a template-contained module tag must not satisfy executable app ownership",
);

const selfClosingTemplateSpoof = routeSource.replace(
  '<script src="../../route-evidence-bootstrap.js" data-surface="route"></script>',
  '<template/><script src="../../route-evidence-bootstrap.js" data-surface="route"></script>',
);
assert.throws(
  () => validateRouteHtml(selfClosingTemplateSpoof, { kind: "scenario", id: "potted-bonsai" }),
  /browser-ignored self-closing syntax on non-void <template>/,
  "browser-ignored template self-closing syntax must fail closed",
);

for (const rawTextElement of ["iframe", "xmp"]) {
  const rawTextScriptSpoof = routeSource.replace(
    '<script type="module" src="../../app.js"></script>',
    `<${rawTextElement}><script type="module" src="../../app.js"></script></${rawTextElement}>`,
  );
  assert.throws(
    () => validateRouteHtml(rawTextScriptSpoof, { kind: "scenario", id: "potted-bonsai" }),
    /one active \.\.\/\.\.\/app\.js script tag/,
    `${rawTextElement} raw text must not expose a nested executable app script`,
  );
}

const preBootstrapScriptInjection = routeSource.replace(
  '<script src="../../route-evidence-bootstrap.js" data-surface="route"></script>',
  '<script>window.__CORPUS_ROUTE_EVIDENCE_BOOTSTRAP__ = { snapshot() { return {}; } };</script><script src="../../route-evidence-bootstrap.js" data-surface="route"></script>',
);
assert.throws(
  () => validateRouteHtml(preBootstrapScriptInjection, { kind: "scenario", id: "potted-bonsai" }),
  /active script inventory must contain only bootstrap, import map, and app|bootstrap must be the first active script/,
  "a pre-bootstrap script must not inject fake observer state",
);

const preBootstrapStylesheet = routeSource.replace(
  '<script src="../../route-evidence-bootstrap.js" data-surface="route"></script>',
  '<link rel="preload" href="../../app.js" as="script" />\n    <script src="../../route-evidence-bootstrap.js" data-surface="route"></script>',
);
assert.throws(
  () => validateRouteHtml(preBootstrapStylesheet, { kind: "scenario", id: "potted-bonsai" }),
  /bootstrap must precede every active resource-loading element/,
  "the bootstrap must install observers before any active resource loader",
);

const inlineEventHandler = routeSource.replace("<body>", '<body onload="console.error=()=>{}">');
assert.throws(
  () => validateRouteHtml(inlineEventHandler, { kind: "scenario", id: "potted-bonsai" }),
  /inline event-handler attributes/,
  "active inline event handlers must not tamper with installed observers",
);

const executableUrl = routeSource.replace("<body>", '<body><a href="javascript:console.error=()=>{}">tamper</a>');
assert.throws(
  () => validateRouteHtml(executableUrl, { kind: "scenario", id: "potted-bonsai" }),
  /executable URL schemes/,
  "javascript URLs must not expose an observer-tampering execution path",
);

const iframeSrcdoc = routeSource.replace(
  "<body>",
  '<body><iframe srcdoc="&lt;script&gt;parent.console.error=()=>{}&lt;/script&gt;"></iframe>',
);
assert.throws(
  () => validateRouteHtml(iframeSrcdoc, { kind: "scenario", id: "potted-bonsai" }),
  /iframe srcdoc content/,
  "same-origin iframe srcdoc must not tamper with parent observer state",
);

const inlineStyleElement = routeSource.replace(
  '<script src="../../route-evidence-bootstrap.js" data-surface="route"></script>',
  '<script src="../../route-evidence-bootstrap.js" data-surface="route"></script><style>@import url("https://invalid.example/style.css");</style>',
);
assert.throws(
  () => validateRouteHtml(inlineStyleElement, { kind: "scenario", id: "potted-bonsai" }),
  /active inline <style> content/,
  "inline style and import surfaces must fail closed",
);

const inlineStyleAttribute = routeSource.replace("<body>", '<body style="background:url(https://invalid.example/pixel)">');
assert.throws(
  () => validateRouteHtml(inlineStyleAttribute, { kind: "scenario", id: "potted-bonsai" }),
  /inline style attributes/,
  "inline style attributes must not add unobserved resource surfaces",
);

assert.throws(
  () => validateCanonicalIds(["hull", "hull"], "component semantic IDs"),
  /duplicate semantic ID "hull"/,
  "the production semantic-ID validator must reject duplicates",
);

const manifest = JSON.parse(readFileSync(new URL("./lab.manifest.json", import.meta.url), "utf8"));
validateManifestRoutes(manifest);
manifest.scenarios = manifest.scenarios.map((entry, index) => index === 1
  ? { ...entry, id: manifest.scenarios[0].id, route: manifest.scenarios[0].route }
  : entry);
assert.throws(
  () => validateManifestRoutes(manifest),
  /duplicate semantic ID/,
  "duplicate manifest target IDs must fail through the production validator",
);

console.log(JSON.stringify({
  ok: true,
  negativeControls: [
    "unknown-route",
    "conflicting-query-route",
    "conflicting-physical-route",
    "path-query-conflict",
    "missing-dom-contract",
    "duplicate-dom-semantic-id",
    "wrong-route-lock-metadata",
    "app-script-not-module",
    "data-id-spoof",
    "commented-app-script",
    "template-app-script",
    "self-closing-template-spoof",
    "iframe-raw-text-script-spoof",
    "xmp-raw-text-script-spoof",
    "pre-bootstrap-script-injection",
    "pre-bootstrap-resource-loader",
    "inline-event-handler",
    "javascript-url",
    "iframe-srcdoc",
    "inline-style-element",
    "inline-style-attribute",
    "duplicate-component-semantic-id",
    "duplicate-manifest-target-id",
    ...runtimeNegativeControls,
  ],
}, null, 2));
