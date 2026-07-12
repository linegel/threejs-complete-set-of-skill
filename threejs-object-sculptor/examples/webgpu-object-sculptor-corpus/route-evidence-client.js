import {
  CORPUS_ROUTE_CAMERA_IDS,
  CORPUS_ROUTE_EVIDENCE_BASE_PATH,
  CORPUS_ROUTE_EVIDENCE_ORIGIN,
  CORPUS_ROUTE_IMMUTABLE_MANIFEST_PATH,
  CORPUS_ROUTE_MECHANISM_IDS,
  CORPUS_ROUTE_SCENARIO_IDS,
  CORPUS_ROUTE_TIER_IDS,
} from "./route-evidence-plan.js";
import {
  CORPUS_EXECUTABLE_SOURCE_CLOSURE,
  CORPUS_TRUSTED_ROUTE_HTML_SHA256_BY_ROUTE_ID,
  CORPUS_TRUSTED_RUNTIME_SOURCE_MANIFEST,
  CORPUS_TRUSTED_RUNTIME_SOURCE_MANIFEST_SHA256,
} from "./trusted-runtime-source-manifest.generated.js";

const ROUTE_DIMENSIONS = Object.freeze({
  scenario: Object.freeze({
    selectorId: "subject",
    stateKey: "subjectId",
    values: CORPUS_ROUTE_SCENARIO_IDS,
    methods: Object.freeze(["setSubject", "setScenario"]),
  }),
  mechanism: Object.freeze({
    selectorId: "mode",
    stateKey: "mode",
    values: CORPUS_ROUTE_MECHANISM_IDS,
    methods: Object.freeze(["setMode"]),
  }),
  tier: Object.freeze({
    selectorId: "tier",
    stateKey: "tier",
    values: CORPUS_ROUTE_TIER_IDS,
    methods: Object.freeze(["setTier"]),
  }),
  camera: Object.freeze({
    selectorId: "camera",
    stateKey: "camera",
    values: CORPUS_ROUTE_CAMERA_IDS,
    methods: Object.freeze(["setCamera"]),
  }),
});

const SELECTOR_PLAN = Object.freeze([
  Object.freeze({ id: "subject", stateKey: "subjectId" }),
  Object.freeze({ id: "mode", stateKey: "mode" }),
  Object.freeze({ id: "tier", stateKey: "tier" }),
  Object.freeze({ id: "camera", stateKey: "camera" }),
]);

const PIPELINE_KEYS = Object.freeze([
  "owner",
  "sceneRendersPerFrame",
  "passes",
  "mrt",
  "postprocessing",
  "toneMapping",
  "outputColorSpace",
  "finalOutputOwner",
]);

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function plainCanonicalValue(value) {
  if (Array.isArray(value)) return value.map(plainCanonicalValue);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.keys(value).sort().map((key) => [key, plainCanonicalValue(value[key])]));
  }
  return value;
}

export function canonicalJson(value) {
  return JSON.stringify(plainCanonicalValue(value));
}

function bytesFrom(value) {
  if (typeof value === "string") return new TextEncoder().encode(value);
  if (value instanceof Uint8Array) return value;
  if (ArrayBuffer.isView(value)) return new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
  if (value instanceof ArrayBuffer) return new Uint8Array(value);
  if (Array.isArray(value)) return Uint8Array.from(value);
  throw new TypeError("SHA-256 input must be text or byte-addressable data");
}

export async function sha256Hex(value) {
  if (!globalThis.crypto?.subtle) throw new Error("Web Crypto SHA-256 is required for route evidence");
  const digest = await globalThis.crypto.subtle.digest("SHA-256", bytesFrom(value));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

function routeDefinition(route) {
  if (!route || typeof route !== "object" || Array.isArray(route)) {
    throw new TypeError("route evidence requires a parsed route object");
  }
  const locks = Object.entries(ROUTE_DIMENSIONS).filter(([dimension]) => route[dimension] !== null);
  if (locks.length !== 1) throw new Error("route evidence requires exactly one physical route dimension");
  const [kind, spec] = locks[0];
  const id = route[kind];
  if (!spec.values.includes(id)) throw new RangeError(`Unknown ${kind} route value "${id}"`);
  return Object.freeze({
    routeId: `${kind}:${id}`,
    kind,
    id,
    urlPath: `${kind}/${id}/`,
    spec,
  });
}

function stateSnapshot(metrics) {
  return Object.freeze({
    subjectId: metrics.subjectId,
    scenario: metrics.scenario,
    mode: metrics.mode,
    tier: metrics.tier,
    camera: metrics.camera,
    seed: metrics.seed,
    time: metrics.time,
  });
}

function frameSnapshot(metrics) {
  return Object.freeze({
    firstFrameCompleted: metrics.firstFrameCompleted,
    completedFrames: metrics.completedFrames,
    renderSubmissions: metrics.renderSubmissions,
  });
}

function selectorSnapshot(select) {
  return Object.freeze({ value: select.value, disabled: select.disabled });
}

function routeSelectors(controls) {
  return Object.freeze(SELECTOR_PLAN.map(({ id }) => Object.freeze({ id, ...selectorSnapshot(controls[id]) })));
}

function alternateValue(values, current) {
  const value = values.find((candidate) => candidate !== current);
  if (value === undefined) throw new Error(`No alternate route probe value exists for "${current}"`);
  return value;
}

function sameState(actual, expected, label) {
  assert(canonicalJson(actual) === canonicalJson(expected), `${label} state drifted`);
}

function routeLockResult(metrics, label) {
  const result = metrics.lastRouteLockResult;
  assert(result && result.code === "CORPUS_ROUTE_LOCKED", `${label} did not publish CORPUS_ROUTE_LOCKED`);
  return result;
}

function essentialPipeline(pipeline) {
  const descriptor = Object.fromEntries(PIPELINE_KEYS.map((key) => [key, pipeline[key]]));
  assert(descriptor.owner === "WebGPURenderer", "route evidence requires WebGPURenderer pipeline ownership");
  assert(descriptor.sceneRendersPerFrame === 1, "route evidence requires exactly one scene render per frame");
  assert(canonicalJson(descriptor.passes) === canonicalJson(["forward-scene"]), "route evidence pipeline pass inventory drifted");
  assert(descriptor.mrt === false && descriptor.postprocessing === false, "route evidence requires the declared forward-only pipeline");
  assert(descriptor.toneMapping === "ACESFilmicToneMapping", "route evidence tone-map owner drifted");
  assert(descriptor.outputColorSpace === "srgb", "route evidence output color space drifted");
  assert(descriptor.finalOutputOwner === "renderer", "route evidence final output owner drifted");
  return Object.freeze(descriptor);
}

async function servedFile(pathname, immutableServerAttestation) {
  const url = new URL(pathname, CORPUS_ROUTE_EVIDENCE_ORIGIN);
  const response = await fetch(url, { cache: "no-store", redirect: "error" });
  assert(response.ok && response.url === url.href, `immutable source ${pathname} did not resolve exactly`);
  const bytes = new Uint8Array(await response.arrayBuffer());
  const sha256 = await sha256Hex(bytes);
  const sourcePath = response.headers.get("x-corpus-source-path");
  assert(response.headers.get("x-content-sha256") === sha256, `immutable source ${pathname} header digest drifted`);
  assert(response.headers.get("x-corpus-transform") === "none", `immutable source ${pathname} was transformed`);
  assert(
    response.headers.get("x-corpus-immutable-snapshot") === immutableServerAttestation.snapshotId,
    `immutable source ${pathname} came from another snapshot`,
  );
  const manifestEntry = immutableServerAttestation.entries.find((entry) => entry.urlPath === `/${sourcePath}`);
  assert(manifestEntry?.sha256 === sha256 && manifestEntry.byteLength === bytes.byteLength, `immutable source ${pathname} is absent from its snapshot manifest`);
  return Object.freeze({ pathname, sourcePath, sha256, byteLength: bytes.byteLength });
}

export function collectImmutableExecutedResourcePaths({ resourceNames, origin, baseHref, immutableEntries } = {}) {
  assert(Array.isArray(resourceNames), "observed resource names must be an array");
  assert(typeof origin === "string" && typeof baseHref === "string", "observed resource URL context is missing");
  assert(Array.isArray(immutableEntries) && immutableEntries.length > 0, "immutable manifest entries are missing");
  const immutableManifestPaths = new Set(immutableEntries.map(({ urlPath }) => urlPath));
  const paths = [];
  for (const name of resourceNames) {
    const url = new URL(name, baseHref);
    assert(url.origin === origin, `route loaded a third-party runtime resource: ${url.href}`);
    assert(immutableManifestPaths.has(url.pathname), `executed same-origin resource is absent from immutable manifest: ${url.pathname}`);
    paths.push(url.pathname);
  }
  return Object.freeze([...new Set(paths)].sort());
}

export async function failClosedPhysicalRouteCollection({
  routeId,
  cause,
  producer = null,
  childController = null,
  resetFrame,
} = {}) {
  assert(typeof routeId === "string" && routeId.length > 0, "failed route cleanup requires a route ID");
  assert(cause instanceof Error, "failed route cleanup requires the primary Error");
  assert(typeof resetFrame === "function", "failed route cleanup requires deterministic iframe reset");
  const cleanupErrors = [];
  let producerDisposed = false;
  if (typeof producer?.dispose === "function") {
    try {
      await producer.dispose();
      producerDisposed = true;
    } catch (cleanupError) {
      cleanupErrors.push(cleanupError);
    }
  }
  if (!producerDisposed && childController !== producer && typeof childController?.dispose === "function") {
    try {
      await childController.dispose();
    } catch (cleanupError) {
      cleanupErrors.push(cleanupError);
    }
  }
  try {
    await resetFrame();
  } catch (cleanupError) {
    cleanupErrors.push(cleanupError);
  }
  if (cleanupErrors.length > 0) {
    throw new AggregateError([cause, ...cleanupErrors], `${routeId} failed and its cleanup did not close deterministically`);
  }
  throw cause;
}

async function sourceProvenance(definition, immutableServerAttestation, servedRouteAttestation) {
  assert(immutableServerAttestation?.manifestPath === CORPUS_ROUTE_IMMUTABLE_MANIFEST_PATH, "immutable server manifest path drifted");
  assert(immutableServerAttestation.transformMode === "none", "route evidence cannot use transformed modules");
  assert(immutableServerAttestation.immutableSnapshot === true, "route evidence requires an immutable source snapshot");
  assert(immutableServerAttestation.spaFallback === false, "route evidence forbids SPA fallback routing");
  assert(immutableServerAttestation.viteClient === false, "route evidence forbids Vite development injection");
  assert(Array.isArray(immutableServerAttestation.entries) && immutableServerAttestation.entries.length > 0, "immutable server entries are missing");
  assert(
    canonicalJson(immutableServerAttestation.sourceClosure) === canonicalJson(CORPUS_EXECUTABLE_SOURCE_CLOSURE),
    "immutable server source closure drifted from the canonical executable closure",
  );
  assert(!immutableServerAttestation.entries.some(({ path, urlPath }) => `${path}\n${urlPath}`.includes("/@vite/client")), "immutable source closure contains /@vite/client");
  const executedResourcePaths = collectImmutableExecutedResourcePaths({
    resourceNames: performance.getEntriesByType("resource").map(({ name }) => name),
    origin: location.origin,
    baseHref: location.href,
    immutableEntries: immutableServerAttestation.entries,
  });
  for (const required of [
    `${CORPUS_ROUTE_EVIDENCE_BASE_PATH}route-evidence-bootstrap.js`,
    `${CORPUS_ROUTE_EVIDENCE_BASE_PATH}styles.css`,
    `${CORPUS_ROUTE_EVIDENCE_BASE_PATH}app.js`,
  ]) assert(executedResourcePaths.includes(required), `executed resource inventory omitted ${required}`);
  assert(!executedResourcePaths.some((path) => path.includes("/@vite/client")), "executed resource inventory contains /@vite/client");
  const sourceByPath = new Map(CORPUS_TRUSTED_RUNTIME_SOURCE_MANIFEST.map((entry) => [entry.path, entry]));
  const routePathname = `${CORPUS_ROUTE_EVIDENCE_BASE_PATH}${definition.urlPath}`;
  const routeFile = await servedFile(routePathname, immutableServerAttestation);
  const routeHtmlSha256 = routeFile.sha256;
  const appModulePath = "threejs-object-sculptor/examples/webgpu-object-sculptor-corpus/app.js";
  const appFile = await servedFile(`${CORPUS_ROUTE_EVIDENCE_BASE_PATH}app.js`, immutableServerAttestation);
  const appModuleSha256 = appFile.sha256;
  assert(typeof routeHtmlSha256 === "string", `trusted route HTML hash is missing for ${definition.routeId}`);
  assert(routeHtmlSha256 === CORPUS_TRUSTED_ROUTE_HTML_SHA256_BY_ROUTE_ID[definition.routeId], `served route HTML hash is stale for ${definition.routeId}`);
  assert(typeof appModuleSha256 === "string", "trusted app module hash is missing");
  assert(appModuleSha256 === sourceByPath.get(appModulePath)?.sha256, "served app module hash drifted from the trusted source");
  assert(
    servedRouteAttestation?.contentSha256 === routeHtmlSha256
      && servedRouteAttestation?.headerContentSha256 === routeHtmlSha256
      && servedRouteAttestation?.immutableSnapshotId === immutableServerAttestation.snapshotId
      && servedRouteAttestation?.transformMode === "none"
      && servedRouteAttestation?.byteLength === routeFile.byteLength
      && servedRouteAttestation?.sourcePath === routeFile.sourcePath,
    "parent preflight did not attest the exact route bytes executed by the immutable frame",
  );
  const producerPaths = [
    "threejs-object-sculptor/examples/webgpu-object-sculptor-corpus/route-evidence-bootstrap.js",
    "threejs-object-sculptor/examples/webgpu-object-sculptor-corpus/route-evidence-client.js",
  ];
  const producerFiles = Object.freeze(await Promise.all(producerPaths.map(async (path) => {
    const served = await servedFile(`/${path}`, immutableServerAttestation);
    assert(served.sha256 === sourceByPath.get(path)?.sha256, `served evidence producer hash drifted for ${path}`);
    return Object.freeze({ path, sha256: served.sha256, byteLength: served.byteLength });
  })));
  assert(producerFiles.every(({ sha256 }) => typeof sha256 === "string"), "trusted evidence producer hashes are missing");
  const producerBundleSha256 = await sha256Hex(`object-sculptor-route-producer-v1\n${canonicalJson(producerFiles)}`);
  const trustedRuntimeSourceManifestSha256 = await sha256Hex(
    `object-sculptor-trusted-runtime-source-v1\n${canonicalJson(CORPUS_TRUSTED_RUNTIME_SOURCE_MANIFEST)}`,
  );
  assert(
    trustedRuntimeSourceManifestSha256 === CORPUS_TRUSTED_RUNTIME_SOURCE_MANIFEST_SHA256,
    "generated trusted runtime source manifest hash drifted",
  );
  const sourceHash = await sha256Hex([
    "object-sculptor-route-source-v4",
    definition.routeId,
    routeHtmlSha256,
    immutableServerAttestation.closureSha256,
    CORPUS_EXECUTABLE_SOURCE_CLOSURE.sourceHash,
  ].join("\n"));
  return Object.freeze({
    evidenceProducer: "immutable-browser-page-route-producer",
    sourceHashAlgorithm: "sha256",
    immutableServer: Object.freeze({
      manifestPath: immutableServerAttestation.manifestPath,
      manifestSha256: immutableServerAttestation.manifestSha256,
      snapshotId: immutableServerAttestation.snapshotId,
      closureSha256: immutableServerAttestation.closureSha256,
      transformMode: immutableServerAttestation.transformMode,
      immutableSnapshot: immutableServerAttestation.immutableSnapshot,
      spaFallback: immutableServerAttestation.spaFallback,
      viteClient: immutableServerAttestation.viteClient,
      entryCount: immutableServerAttestation.entries.length,
    }),
    servedRoute: routeFile,
    routeHtmlSha256,
    servedAppModule: appFile,
    appModuleSha256,
    producerFiles,
    producerBundleSha256,
    trustedRuntimeSourceManifest: CORPUS_TRUSTED_RUNTIME_SOURCE_MANIFEST,
    trustedRuntimeSourceManifestSha256,
    executableSourceClosure: CORPUS_EXECUTABLE_SOURCE_CLOSURE,
    executedResourcePaths,
    sourceHash,
    buildRevision: immutableServerAttestation.snapshotId,
    browserEntry: location.pathname,
  });
}

function cameraPoseSnapshot(metrics) {
  const framing = metrics.cameraFraming;
  const pose = framing?.actualPose;
  if (!framing || !pose) throw new Error("route evidence requires a measured camera framing pose");
  const vector = (value, length, label) => {
    assert(Array.isArray(value) && value.length === length && value.every(Number.isFinite), `${label} must contain ${length} finite values`);
    return Object.freeze([...value]);
  };
  return Object.freeze({
    cameraId: framing.camera,
    subjectId: framing.subjectId,
    positionMeters: vector(pose.positionMeters, 3, "camera position"),
    quaternion: vector(pose.quaternion, 4, "camera quaternion"),
    up: vector(pose.up, 3, "camera up"),
    controlsTargetMeters: vector(pose.controlsTargetMeters, 3, "camera controls target"),
    fovDegrees: pose.fovDegrees,
    aspect: pose.aspect,
    nearMeters: pose.nearMeters,
    farMeters: pose.farMeters,
  });
}

function exactHud(status, subjectId) {
  const hud = Object.freeze({
    datasetState: status.dataset.state ?? null,
    textContent: status.textContent?.trim() ?? "",
    ready: status.dataset.state === "ready" && status.textContent?.trim() === `Ready · ${subjectId} · correctness WebGPU`,
  });
  assert(hud.ready, `HUD did not reach the exact Ready state; received "${hud.textContent}" (${hud.datasetState})`);
  return hud;
}

function exactErrorChannels(bootstrap) {
  assert(window.__CORPUS_ROUTE_EVIDENCE_BOOTSTRAP_CONFLICT__ !== true, "route evidence bootstrap was preempted before its trusted script executed");
  const snapshot = bootstrap?.snapshot?.();
  if (!snapshot) throw new Error("route evidence observers were not installed before the app module");
  assert(bootstrap.enabled === true && bootstrap.surface === "route", "route evidence bootstrap was not capture-enabled");
  assert(snapshot.schemaVersion === 2, "route evidence observer snapshot schema drifted");
  assert(snapshot.configuration?.enabled === true, "route evidence observer configuration is disabled");
  assert(snapshot.configuration?.origin === CORPUS_ROUTE_EVIDENCE_ORIGIN, "route evidence observer origin drifted");
  assert(snapshot.configuration?.search === "?capture=1", "route evidence observer query drifted");
  assert(snapshot.installed?.installedInHead === true, "route evidence bootstrap was not installed in document head");
  assert(snapshot.installed?.appModulePresentAtInstall === false, "route evidence bootstrap ran after the app module was present");
  assert(snapshot.setupFailures?.length === 0, `route evidence observer setup failed: ${canonicalJson(snapshot.setupFailures)}`);
  const channel = (key, activeFrom, observerId) => Object.freeze({
    observerInstalled: snapshot[key]?.observerInstalled === true,
    activeFrom,
    observerId,
    events: Object.freeze([...(snapshot[key]?.events ?? [])]),
  });
  const deviceEvents = snapshot.deviceLost?.events ?? [];
  const result = Object.freeze({
    pageErrors: channel("pageErrors", "before-app-module", "window-error"),
    consoleErrors: channel("consoleErrors", "before-app-module", "console-error"),
    unhandledRejections: channel("unhandledRejections", "before-app-module", "window-unhandledrejection"),
    requestFailures: channel("requestFailures", "before-app-module", "resource-request-failure"),
    gpuErrors: channel("gpuErrors", "before-first-frame", "gpu-device-uncapturederror"),
    deviceLost: Object.freeze({
      monitorAttached: snapshot.deviceLost?.monitorAttached === true,
      activeFrom: "before-first-frame",
      observerId: "gpu-device-lost",
      event: deviceEvents[0] ?? null,
    }),
  });
  for (const [name, value] of Object.entries(result)) {
    if (name === "deviceLost") {
      assert(value.monitorAttached === true, "GPU device-loss monitor was not attached before the first frame");
      assert(value.event === null && deviceEvents.length === 0, "GPU device loss was recorded during route evidence");
      continue;
    }
    assert(value.observerInstalled === true, `${name} observer was not installed`);
    assert(value.events.length === 0, `${name} recorded ${value.events.length} error event(s)`);
  }
  return result;
}

function runtimeEvidence(metrics) {
  return Object.freeze({
    backend: metrics.backend,
    nativeWebGPU: metrics.nativeWebGPU,
    initialized: metrics.initialized,
    firstFrameCompleted: metrics.firstFrameCompleted,
    completedFrames: metrics.completedFrames,
    renderSubmissions: metrics.renderSubmissions,
    rendererType: metrics.rendererInfo?.rendererType ?? null,
    backendType: metrics.rendererInfo?.backendType ?? null,
    runtimeProfile: metrics.runtimeProfile,
    threeRevision: metrics.rendererInfo?.threeRevision ?? null,
    rendererBackendEvidence: metrics.rendererBackendEvidence ?? null,
    rendererDeviceGeneration: metrics.rendererDeviceGeneration ?? null,
    deviceLossGeneration: metrics.deviceLossGeneration ?? null,
    rendererDeviceStatus: metrics.rendererDeviceStatus ?? null,
    deviceErrorCount: metrics.deviceErrorCount ?? null,
    deviceErrors: Object.freeze([...(metrics.deviceErrors ?? [])]),
    frameDriverState: metrics.frameDriverState ?? null,
    frameErrorCount: metrics.frameErrorCount,
    lifecycleErrorCount: metrics.lifecycleErrorCount,
    routeLockRejectCount: metrics.routeLockRejectCount,
    lastRouteLockResult: metrics.lastRouteLockResult,
    lastFrameError: metrics.lastFrameError,
    lastLifecycleError: metrics.lastLifecycleError,
  });
}

async function readbackEvidence(definition, capture) {
  assert(capture?.target === "presentation", "route readback target drifted");
  assert(capture.backendKind === "webgpu" && capture.nativeWebGPU === true, "route readback did not use native WebGPU");
  assert(capture.format === "rgba8unorm" && capture.bytesPerPixel === 4, "route readback format drifted");
  assert(capture.origin === "top-left", "route readback origin drifted");
  assert(capture.colorEncoding === "srgb" && capture.outputColorSpace === "srgb", "route readback color ownership drifted");
  const transportPixels = Uint8Array.from(capture.transport?.pixels ?? []);
  const transportLayout = capture.transport?.layout;
  assert(transportLayout && transportPixels.byteLength === transportLayout.byteLength, "renderer transport byte payload length drifted");
  assert(
    transportLayout.width === capture.width
      && transportLayout.height === capture.height
      && transportLayout.format === capture.format
      && transportLayout.rowBytes === capture.rowBytes,
    "renderer transport layout identity drifted",
  );
  assert(Number.isSafeInteger(transportLayout.byteLength) && transportLayout.byteLength > 0, "renderer transport byte length is missing");
  assert(Number.isSafeInteger(transportLayout.bytesPerRow) && transportLayout.bytesPerRow >= capture.rowBytes, "renderer transport row layout is missing");
  const minimumTransportByteLength = transportLayout.bytesPerRow * (capture.height - 1) + capture.rowBytes;
  assert(transportPixels.byteLength >= minimumTransportByteLength, "renderer transport bytes do not cover every visible row");
  assert(Number.isSafeInteger(capture.bytesPerRow) && capture.bytesPerRow % 256 === 0, "requested aligned row layout is invalid");
  const normalizedPixels = new Uint8Array(capture.fullyPaddedByteLength);
  for (let y = 0; y < capture.height; y += 1) {
    const sourceOffset = y * transportLayout.bytesPerRow;
    normalizedPixels.set(
      transportPixels.subarray(sourceOffset, sourceOffset + capture.rowBytes),
      y * capture.bytesPerRow,
    );
  }
  const controllerNormalized = Uint8Array.from(capture.normalized?.pixels ?? []);
  const controllerNormalizedLayout = capture.normalized?.layout;
  assert(
    controllerNormalizedLayout
      && controllerNormalizedLayout.width === capture.width
      && controllerNormalizedLayout.height === capture.height
      && controllerNormalizedLayout.format === capture.format
      && controllerNormalizedLayout.rowBytes === capture.rowBytes
      && controllerNormalizedLayout.bytesPerRow === capture.bytesPerRow
      && controllerNormalizedLayout.byteLength === capture.fullyPaddedByteLength
      && controllerNormalizedLayout.padding === "cpu-normalized-fully-padded"
      && controllerNormalized.byteLength === controllerNormalizedLayout.byteLength,
    "controller normalized readback payload/layout drifted",
  );
  for (let y = 0; y < capture.height; y += 1) {
    const offset = y * capture.bytesPerRow;
    for (let byte = 0; byte < capture.rowBytes; byte += 1) {
      assert(
        controllerNormalized[offset + byte] === normalizedPixels[offset + byte],
        `controller normalized visible row ${y} drifted from renderer transport`,
      );
    }
  }
  const paddingByteCount = capture.height * (capture.bytesPerRow - capture.rowBytes);
  let zeroPaddingByteCount = 0;
  for (let y = 0; y < capture.height; y += 1) {
    const start = y * capture.bytesPerRow + capture.rowBytes;
    const end = (y + 1) * capture.bytesPerRow;
    for (const byte of normalizedPixels.subarray(start, end)) if (byte === 0) zeroPaddingByteCount += 1;
  }
  assert(zeroPaddingByteCount === paddingByteCount, "normalized route readback padding was not independently zero-filled");
  const transportSha256 = await sha256Hex(transportPixels);
  const normalizedSha256 = await sha256Hex(normalizedPixels);
  const transportArtifact = Object.freeze({
    path: `route-readbacks/transport/${definition.kind}-${definition.id}.rgba8unorm.bin`,
    sha256: transportSha256,
    byteLength: transportPixels.byteLength,
    mediaType: "application/octet-stream",
    layout: "renderer-transport-rgba8unorm-top-left",
  });
  const normalizedArtifact = Object.freeze({
    path: `route-readbacks/normalized/${definition.kind}-${definition.id}.rgba8unorm.bin`,
    sha256: normalizedSha256,
    byteLength: normalizedPixels.byteLength,
    mediaType: "application/octet-stream",
    layout: "cpu-normalized-zero-padded-rgba8unorm-top-left",
  });
  const withoutDigest = Object.freeze({
    target: "presentation",
    captureSource: "native-webgpu-render-target-readback",
    backendKind: capture.backendKind,
    nativeWebGPU: capture.nativeWebGPU,
    width: capture.width,
    height: capture.height,
    format: capture.format,
    bytesPerPixel: capture.bytesPerPixel,
    transportLayout: Object.freeze({
      bytesPerRow: transportLayout.bytesPerRow,
      byteLength: transportLayout.byteLength,
      padding: transportLayout.padding,
      retained: true,
      provenance: "renderer.readRenderTargetPixelsAsync returned ArrayBuffer view",
    }),
    requestedLayout: Object.freeze({
      alignmentBytes: 256,
      rowBytes: capture.rowBytes,
      alignedBytesPerRow: capture.bytesPerRow,
      minimumByteLength: capture.minimumByteLength,
      fullyPaddedByteLength: capture.fullyPaddedByteLength,
      provenance: "WebGPU copy alignment request derived before readback",
    }),
    normalizedArtifactLayout: Object.freeze({
      bytesPerRow: capture.bytesPerRow,
      byteLength: normalizedPixels.byteLength,
      retained: true,
      normalization: capture.rowBytes === capture.bytesPerRow
        && transportLayout.byteLength === normalizedPixels.byteLength
        && transportLayout.bytesPerRow === capture.bytesPerRow
        ? "identity"
        : "cpu-row-padding",
      paddingByteCount,
      zeroPaddingByteCount,
      independentAllocation: normalizedPixels.buffer !== transportPixels.buffer,
      provenance: "CPU normalization after renderer transport for bounded TAR retention",
    }),
    origin: capture.origin,
    colorEncoding: capture.colorEncoding,
    outputColorSpace: capture.outputColorSpace,
    transportSha256,
    normalizedSha256,
    artifacts: Object.freeze({ transport: transportArtifact, normalized: normalizedArtifact }),
  });
  return Object.freeze({
    record: Object.freeze({
      ...withoutDigest,
      digestAlgorithm: "sha256",
      digest: await sha256Hex(`object-sculptor-route-readback-v2\n${definition.routeId}\n${canonicalJson(withoutDigest)}`),
    }),
    artifacts: Object.freeze([
      Object.freeze({ path: transportArtifact.path, bytes: transportPixels }),
      Object.freeze({ path: normalizedArtifact.path, bytes: normalizedPixels }),
    ]),
  });
}

export function createCorpusRouteEvidenceProducer({
  controller,
  route,
  frameOwner,
  controls,
  status,
  dispatchControlChange,
  disposeRoute,
  bootstrap = window.__CORPUS_ROUTE_EVIDENCE_BOOTSTRAP__,
} = {}) {
  if (!controller || typeof controller.getMetrics !== "function") throw new TypeError("route evidence requires the public lab controller");
  if (!controls || SELECTOR_PLAN.some(({ id }) => !controls[id])) throw new TypeError("route evidence requires all four corpus selectors");
  if (!status || typeof dispatchControlChange !== "function" || typeof disposeRoute !== "function") throw new TypeError("route evidence requires HUD, UI-control, and disposal instrumentation");
  if (frameOwner !== "capture-harness") throw new Error("route evidence requires exclusive ?capture=1 frame ownership");
  const definition = routeDefinition(route);
  let collected = false;
  let collectionComplete = false;
  let artifactsTaken = false;
  let retainedArtifacts = Object.freeze([]);
  let preDisposeRecord = null;
  let finalized = false;

  async function collect({
    origin,
    requestedHref,
    finalHref,
    requestedPathname,
    finalPathname,
    search,
    responseStatus,
    parentObserverAttestation,
    servedRouteAttestation,
    immutableServerAttestation,
  } = {}) {
    if (collected) throw new Error(`Route evidence for ${definition.routeId} can only be collected once`);
    collected = true;
    assert(origin === CORPUS_ROUTE_EVIDENCE_ORIGIN && location.origin === origin, "route evidence requires the canonical local origin");
    assert(requestedHref === finalHref && location.href === finalHref, "physical route redirected or final URL drifted");
    assert(search === "?capture=1", "route evidence requires the exact ?capture=1 query");
    assert(responseStatus === 200, `route evidence preflight returned HTTP ${responseStatus}`);
    assert(requestedPathname === finalPathname && location.pathname === finalPathname, "physical route redirected or final pathname drifted");
    assert(finalPathname === `${CORPUS_ROUTE_EVIDENCE_BASE_PATH}${definition.urlPath}`, "physical route base drifted");
    assert(parentObserverAttestation?.installedBeforeNavigation === true, "parent route observers were installed after navigation");
    assert(parentObserverAttestation?.listenersRemoved === true, "parent route navigation listeners were not removed");
    assert(document.readyState === "complete", `route document is ${document.readyState}, not complete`);

    const initialMetrics = controller.getMetrics();
    const baselineState = stateSnapshot(initialMetrics);
    assert(initialMetrics.runtimeProfile === "correctness", "route evidence requires the correctness runtime profile");
    assert(initialMetrics.firstFrameCompleted === false, "route evidence did not begin before the first frame");
    assert(initialMetrics.completedFrames === 0 && initialMetrics.renderSubmissions === 0, "route evidence initial frame counters were not zero");
    assert(initialMetrics.cameraInteractionEnabled === false, "physical capture routes must disable camera interaction");
    const cameraBeforeFirstFrame = cameraPoseSnapshot(initialMetrics);
    const selectors = routeSelectors(controls);
    const lockedSelectorIds = selectors.filter(({ disabled }) => disabled).map(({ id }) => id);
    assert(canonicalJson(lockedSelectorIds) === canonicalJson([definition.spec.selectorId]), "physical route did not disable exactly its locked selector");

    const firstBefore = frameSnapshot(initialMetrics);
    await controller.renderOnce();
    const firstAfterMetrics = controller.getMetrics();
    const firstAfter = frameSnapshot(firstAfterMetrics);
    const cameraAfterFirstFrame = cameraPoseSnapshot(firstAfterMetrics);
    assert(firstAfter.firstFrameCompleted === true, "route evidence first frame did not complete");
    assert(firstAfter.completedFrames === firstBefore.completedFrames + 1, "route evidence first completed-frame delta drifted");
    assert(firstAfter.renderSubmissions === firstBefore.renderSubmissions + 1, "route evidence first submission delta drifted");
    const hud = exactHud(status, baselineState.subjectId);

    const attemptedLockedValue = alternateValue(definition.spec.values, definition.id);
    const beforeUiState = stateSnapshot(controller.getMetrics());
    const beforeSelectorValue = controls[definition.spec.selectorId].value;
    const uiReturnValue = await dispatchControlChange(definition.spec.selectorId, attemptedLockedValue);
    const afterUiMetrics = controller.getMetrics();
    const afterUiState = stateSnapshot(afterUiMetrics);
    sameState(afterUiState, baselineState, `${definition.routeId} locked UI probe`);
    assert(
      controls[definition.spec.selectorId].value === beforeSelectorValue,
      `${definition.routeId} locked UI selector did not restore its baseline value`,
    );
    assert(uiReturnValue === false, "locked UI route probe did not return false");
    const uiResult = routeLockResult(afterUiMetrics, "locked UI route probe");
    const uiProbe = Object.freeze({
      attemptedValue: attemptedLockedValue,
      changeEvents: 1,
      fulfilled: true,
      returnValue: uiReturnValue,
      beforeState: beforeUiState,
      afterState: afterUiState,
      beforeSelectorValue,
      afterSelectorValue: controls[definition.spec.selectorId].value,
      result: uiResult,
    });

    const controllerProbes = [];
    for (const method of definition.spec.methods) {
      const beforeState = stateSnapshot(controller.getMetrics());
      let returnValue;
      let error = null;
      try {
        returnValue = await controller[method](attemptedLockedValue);
      } catch (value) {
        error = value instanceof Error ? { name: value.name, message: value.message } : { name: "Error", message: String(value) };
      }
      const metrics = controller.getMetrics();
      const afterState = stateSnapshot(metrics);
      sameState(afterState, baselineState, `${definition.routeId} locked ${method} probe`);
      assert(error === null && returnValue === false, `${definition.routeId} locked ${method} probe did not fulfill false`);
      controllerProbes.push(Object.freeze({
        method,
        attemptedValue: attemptedLockedValue,
        fulfilled: error === null,
        returnValue,
        error,
        beforeState,
        afterState,
        result: routeLockResult(metrics, `${definition.routeId} locked ${method} probe`),
      }));
    }

    const unlockedProbes = [];
    for (const [dimension, spec] of Object.entries(ROUTE_DIMENSIONS)) {
      if (dimension === definition.kind) continue;
      const selector = controls[spec.selectorId];
      const beforeState = stateSnapshot(controller.getMetrics());
      const beforeSelector = selectorSnapshot(selector);
      const attemptedValue = alternateValue(spec.values, beforeState[spec.stateKey]);
      const changeResult = await dispatchControlChange(spec.selectorId, attemptedValue);
      const changedState = stateSnapshot(controller.getMetrics());
      const changedSelector = selectorSnapshot(selector);
      assert(changeResult === true, `${definition.routeId} unlocked ${dimension} change was not applied`);
      assert(changedState[spec.stateKey] === attemptedValue, `${definition.routeId} unlocked ${dimension} state did not change`);
      assert(changedSelector.value === attemptedValue && changedSelector.disabled === false, `${definition.routeId} unlocked ${dimension} selector did not change`);
      const restoreResult = await dispatchControlChange(spec.selectorId, beforeState[spec.stateKey]);
      const restoredState = stateSnapshot(controller.getMetrics());
      const restoredSelector = selectorSnapshot(selector);
      assert(restoreResult === true, `${definition.routeId} unlocked ${dimension} restore failed`);
      sameState(restoredState, baselineState, `${definition.routeId} unlocked ${dimension} restore`);
      assert(restoredSelector.value === beforeSelector.value && restoredSelector.disabled === false, `${definition.routeId} unlocked ${dimension} selector did not restore`);
      unlockedProbes.push(Object.freeze({
        dimension,
        selectorId: spec.selectorId,
        surface: "ui-change-event",
        publicControllerMethod: spec.methods[0],
        attemptedValue,
        beforeState,
        beforeSelector,
        changeResult,
        changedState,
        changedSelector,
        restoreResult,
        restoredState,
        restoredSelector,
      }));
    }

    const postProbeBeforeMetrics = controller.getMetrics();
    const postProbeBefore = frameSnapshot(postProbeBeforeMetrics);
    const cameraAfterProbes = cameraPoseSnapshot(postProbeBeforeMetrics);
    const capture = await controller.capturePixels("presentation");
    const finalMetrics = controller.getMetrics();
    const postProbeAfter = frameSnapshot(finalMetrics);
    const cameraAfterReadback = cameraPoseSnapshot(finalMetrics);
    assert(postProbeAfter.completedFrames === postProbeBefore.completedFrames + 1, "post-probe readback completed-frame delta drifted");
    assert(postProbeAfter.renderSubmissions === postProbeBefore.renderSubmissions + 1, "post-probe readback submission delta drifted");
    sameState(stateSnapshot(finalMetrics), baselineState, `${definition.routeId} final`);
    for (const [label, pose] of [
      ["after first frame", cameraAfterFirstFrame],
      ["after probes", cameraAfterProbes],
      ["after readback", cameraAfterReadback],
    ]) {
      assert(canonicalJson(pose) === canonicalJson(cameraBeforeFirstFrame), `${definition.routeId} camera drifted ${label}`);
    }

    const pipelineDescriptor = essentialPipeline(await controller.describePipeline());
    const pipeline = Object.freeze({
      descriptor: pipelineDescriptor,
      digestAlgorithm: "sha256",
      digest: await sha256Hex(`object-sculptor-route-pipeline-v1\n${definition.routeId}\n${canonicalJson(pipelineDescriptor)}`),
    });
    const readbackResult = await readbackEvidence(definition, capture);
    const readback = readbackResult.record;
    retainedArtifacts = readbackResult.artifacts;
    const camera = Object.freeze({
      interactionEnabled: false,
      semanticCamera: baselineState.camera,
      beforeFirstFrame: cameraBeforeFirstFrame,
      afterFirstFrame: cameraAfterFirstFrame,
      afterProbes: cameraAfterProbes,
      afterReadback: cameraAfterReadback,
      digestAlgorithm: "sha256",
      poseDigest: await sha256Hex(`object-sculptor-route-camera-v1\n${definition.routeId}\n${canonicalJson(cameraAfterReadback)}`),
    });
    const provenance = await sourceProvenance(definition, immutableServerAttestation, servedRouteAttestation);
    const errorChannels = exactErrorChannels(bootstrap);
    const labError = window.__LAB_ERROR__ ?? null;
    assert(labError === null, `route published __LAB_ERROR__: ${canonicalJson(labError)}`);

    const routeLockState = controller.getRouteLockState();
    const record = Object.freeze({
      routeId: definition.routeId,
      kind: definition.kind,
      id: definition.id,
      urlPath: definition.urlPath,
      provenance,
      location: Object.freeze({
        origin,
        requestedHref,
        finalHref,
        requestedPathname,
        finalPathname,
        search,
        responseStatus,
        documentReadyState: document.readyState,
        parentObserverAttestation,
        viewport: Object.freeze({
          cssWidth: window.innerWidth,
          cssHeight: window.innerHeight,
          devicePixelRatio: window.devicePixelRatio,
          appliedDpr: finalMetrics.dpr,
        }),
      }),
      documentRoute: Object.freeze({
        kind: document.documentElement.dataset.routeKind ?? null,
        id: document.documentElement.dataset.routeId ?? null,
        subject: document.documentElement.dataset.subject ?? null,
        profile: document.documentElement.dataset.profile ?? null,
      }),
      parsedRoute: Object.freeze({
        scenario: route.scenario,
        mechanism: route.mechanism,
        tier: route.tier,
        camera: route.camera,
      }),
      selectors,
      baselineState,
      hud,
      camera,
      routeLock: Object.freeze({
        state: routeLockState,
        lockedSelectorId: definition.spec.selectorId,
        lockedValue: definition.id,
        disabledSelectorIds: Object.freeze([definition.spec.selectorId]),
        enabledSelectorIds: Object.freeze(selectors.filter(({ disabled }) => !disabled).map(({ id }) => id)),
        uiProbe,
        controllerProbes: Object.freeze(controllerProbes),
        unlockedProbes: Object.freeze(unlockedProbes),
      }),
      firstFrame: Object.freeze({ owner: "capture-harness", before: firstBefore, after: firstAfter }),
      postProbeRender: Object.freeze({ owner: "capture-harness", before: postProbeBefore, after: postProbeAfter }),
      runtime: runtimeEvidence(finalMetrics),
      pipeline,
      readback,
      errorChannels,
      labError,
    });
    preDisposeRecord = record;
    collectionComplete = true;
    return record;
  }

  async function finalizeAfterDispose({ disposeResult, settlingBarrier } = {}) {
    if (!collectionComplete || !preDisposeRecord) throw new Error(`Route ${definition.routeId} cannot finalize before collection`);
    if (finalized) throw new Error(`Route ${definition.routeId} post-disposal proof was already finalized`);
    finalized = true;
    assert(settlingBarrier?.owner === "in-app-evidence-runner", "post-disposal settling barrier owner drifted");
    assert(settlingBarrier?.type === "two-child-requestAnimationFrame-callbacks", "post-disposal settling barrier type drifted");
    assert(settlingBarrier?.requestedFrames === 2 && settlingBarrier?.observedFrames === 2 && settlingBarrier?.completed === true, "post-disposal settling barrier did not observe two child animation frames");
    assert(Array.isArray(settlingBarrier.timestampsMonotonicMs)
      && settlingBarrier.timestampsMonotonicMs.length === 2
      && settlingBarrier.timestampsMonotonicMs.every(Number.isFinite)
      && settlingBarrier.timestampsMonotonicMs[1] >= settlingBarrier.timestampsMonotonicMs[0], "post-disposal settling barrier timestamps are invalid");
    const expectedDeviceDestruction = disposeResult?.expectedDeviceDestruction;
    assert(expectedDeviceDestruction?.observed === true
      && expectedDeviceDestruction?.status === "observed-exact-destroyed-device"
      && Number.isInteger(expectedDeviceDestruction.deviceGeneration)
      && typeof expectedDeviceDestruction.tokenId === "string", "explicit renderer destruction was not observed for the exact armed GPU device generation");
    const routeDisposeResult = disposeResult.routeDisposeResult;
    const afterDisposeErrorChannels = exactErrorChannels(bootstrap);
    const afterDisposeLabError = window.__LAB_ERROR__ ?? null;
    assert(afterDisposeLabError === null, `route published __LAB_ERROR__ during disposal: ${canonicalJson(afterDisposeLabError)}`);
    const metrics = controller.getMetrics();
    assert(metrics.frameDriverState === "closed", "route frame driver did not reach closed after explicit disposal");
    assert(metrics.pendingControllerOperations === 0, "route retained controller operations after explicit disposal");
    assert(metrics.acceptingControllerOperations === false, "route controller still accepted operations after explicit disposal");
    assert(metrics.frameErrorCount === 0 && metrics.lifecycleErrorCount === 0, "route recorded controller errors during explicit disposal");
    const teardown = Object.freeze({
      explicitDispose: Object.freeze({
        requested: true,
        fulfilled: true,
        returnValue: routeDisposeResult === undefined ? null : routeDisposeResult,
        expectedDeviceDestruction,
      }),
      postDisposeSettlingBarrier: Object.freeze({ ...settlingBarrier }),
      beforeDispose: Object.freeze({
        errorChannels: preDisposeRecord.errorChannels,
        labError: preDisposeRecord.labError,
        frameDriverState: preDisposeRecord.runtime.frameDriverState ?? "idle",
        rendererDeviceStatus: preDisposeRecord.runtime.rendererDeviceStatus,
      }),
      afterDispose: Object.freeze({
        errorChannels: afterDisposeErrorChannels,
        labError: afterDisposeLabError,
        frameDriverState: metrics.frameDriverState,
        rendererDeviceStatus: metrics.rendererDeviceStatus,
        pendingControllerOperations: metrics.pendingControllerOperations,
        acceptingControllerOperations: metrics.acceptingControllerOperations,
        frameErrorCount: metrics.frameErrorCount,
        lifecycleErrorCount: metrics.lifecycleErrorCount,
        teardown: metrics.teardown ?? null,
      }),
      afterFrameReset: null,
    });
    return Object.freeze({ ...preDisposeRecord, teardown });
  }

  function takeArtifacts() {
    if (!collectionComplete) throw new Error(`Route artifacts for ${definition.routeId} are unavailable before successful collection`);
    if (artifactsTaken) throw new Error(`Route artifacts for ${definition.routeId} were already transferred`);
    artifactsTaken = true;
    return retainedArtifacts;
  }

  async function disposeWithExpectedDeviceDestruction() {
    if (!collectionComplete) return disposeRoute();
    assert(typeof bootstrap?.beginExpectedDeviceDestruction === "function", "route evidence bootstrap cannot distinguish explicit renderer destruction");
    const marker = bootstrap.beginExpectedDeviceDestruction();
    assert(marker?.armed === true
      && marker.phase === "after-successful-readback-before-explicit-renderer-dispose"
      && Number.isInteger(marker.monitoredDeviceCount)
      && marker.monitoredDeviceCount >= 1
      && Number.isInteger(marker.deviceGeneration)
      && typeof marker.tokenId === "string"
      && typeof marker.waitForObserved === "function"
      && typeof marker.cancel === "function", "explicit renderer-destruction marker is invalid");
    let routeDisposeResult;
    try {
      routeDisposeResult = await disposeRoute();
    } catch (error) {
      marker.cancel();
      throw error;
    }
    const expectedDeviceDestruction = await marker.waitForObserved(1000);
    assert(expectedDeviceDestruction?.observed === true, "explicit renderer disposal did not produce the exact armed GPUDevice.lost destroyed event");
    return Object.freeze({ routeDisposeResult, expectedDeviceDestruction });
  }

  return Object.freeze({ routeId: definition.routeId, collect, dispose: disposeWithExpectedDeviceDestruction, finalizeAfterDispose, takeArtifacts });
}
