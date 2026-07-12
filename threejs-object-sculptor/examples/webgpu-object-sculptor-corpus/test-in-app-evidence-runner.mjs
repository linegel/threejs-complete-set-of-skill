import assert from "node:assert/strict";
import { createHash, webcrypto } from "node:crypto";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { runInNewContext } from "node:vm";

import {
  canonicalJson,
  collectImmutableExecutedResourcePaths,
  failClosedPhysicalRouteCollection,
  sha256Hex,
} from "./route-evidence-client.js";
import {
  CORPUS_ROUTE_EVIDENCE_TAR_FILENAME,
  buildRouteEvidenceTar,
  buildRouteEvidenceDocument,
  routeEvidenceDownloadName,
} from "./route-evidence-document.js";
import {
  CORPUS_IN_APP_ROUTE_PLAN,
  CORPUS_ROUTE_EVIDENCE_FILENAME,
  CORPUS_ROUTE_EVIDENCE_QUERY,
} from "./route-evidence-plan.js";
import {
  CORPUS_CAPTURE_BUILD_REVISION,
  CORPUS_CAPTURE_SOURCE_HASH,
} from "./trusted-runtime-source-manifest.generated.js";

if (!globalThis.crypto) globalThis.crypto = webcrypto;

const here = dirname(fileURLToPath(import.meta.url));

function deferredDevice(label) {
  let resolveLost;
  const lost = new Promise((resolve) => { resolveLost = resolve; });
  return Object.freeze({
    device: Object.freeze({ label, lost, addEventListener() {} }),
    lose: (info) => resolveLost(info),
  });
}

async function bootstrapHarness(deferredDevices) {
  const queue = [...deferredDevices];
  const adapter = { requestDevice: async () => {
    const next = queue.shift();
    if (!next) throw new Error("synthetic device queue exhausted");
    return next.device;
  } };
  const context = {
    URLSearchParams,
    clearTimeout,
    console: { error() {} },
    document: {
      currentScript: { dataset: { surface: "route" } },
      head: { contains: () => true },
      scripts: [],
      readyState: "loading",
    },
    location: {
      origin: "http://127.0.0.1:4174",
      pathname: "/threejs-object-sculptor/examples/webgpu-object-sculptor-corpus/scenario/potted-bonsai/",
      search: "?capture=1",
    },
    navigator: { gpu: { requestAdapter: async () => adapter } },
    performance: { now: () => 1, timeOrigin: 1 },
    setTimeout,
  };
  context.window = context;
  context.addEventListener = () => {};
  runInNewContext(readFileSync(join(here, "route-evidence-bootstrap.js"), "utf8"), context);
  const instrumentedAdapter = await context.navigator.gpu.requestAdapter();
  return Object.freeze({ context, adapter: instrumentedAdapter, bootstrap: context.__CORPUS_ROUTE_EVIDENCE_BOOTSTRAP__ });
}

const expectedRouteIds = [
  "scenario:articulated-desk-lamp",
  "scenario:potted-bonsai",
  "scenario:ceramic-teapot",
  "mechanism:final",
  "mechanism:blockout",
  "mechanism:hierarchy",
  "mechanism:materials",
  "mechanism:action-ready",
  "tier:full",
  "tier:budgeted",
  "tier:minimum",
  "camera:design",
  "camera:profile",
  "camera:attachment",
  "camera:close-material",
];

assert.deepEqual(CORPUS_IN_APP_ROUTE_PLAN.map(({ routeId }) => routeId), expectedRouteIds);
assert.equal(CORPUS_ROUTE_EVIDENCE_QUERY, "?capture=1");
assert.equal(routeEvidenceDownloadName(), CORPUS_ROUTE_EVIDENCE_FILENAME);
assert.equal(CORPUS_ROUTE_EVIDENCE_FILENAME, "route-runtime-evidence.json");

const backend = Object.freeze({
  kind: "webgpu",
  nativeWebGPU: true,
  rendererType: "WebGPURenderer",
  backendType: "WebGPUBackend",
  threeRevision: "185",
  outputColorSpace: "srgb",
});
const routes = CORPUS_IN_APP_ROUTE_PLAN.map((route, index) => {
  const transportSha256 = (index + 1).toString(16).padStart(64, "0");
  const normalizedSha256 = (index + 101).toString(16).padStart(64, "0");
  const stem = `${route.kind}-${route.id}.rgba8unorm.bin`;
  return Object.freeze({
    ...route,
    runtime: Object.freeze({
      backend: backend.kind,
      nativeWebGPU: backend.nativeWebGPU,
      rendererType: backend.rendererType,
      backendType: backend.backendType,
      threeRevision: backend.threeRevision,
      rendererBackendEvidence: Object.freeze({
        deviceIdentitySource: "renderer.backend.device-after-init",
        backendType: "WebGPUBackend",
        deviceType: "GPUDevice",
        deviceLabel: "",
        deviceIdentityVerified: true,
      }),
    }),
    pipeline: Object.freeze({ descriptor: Object.freeze({ outputColorSpace: backend.outputColorSpace }) }),
    readback: Object.freeze({
      transportLayout: Object.freeze({ byteLength: 4, retained: true }),
      normalizedArtifactLayout: Object.freeze({
        byteLength: 256,
        retained: true,
        independentAllocation: true,
        paddingByteCount: 252,
        zeroPaddingByteCount: 252,
      }),
      transportSha256,
      normalizedSha256,
      artifacts: Object.freeze({
        transport: Object.freeze({
          path: `route-readbacks/transport/${stem}`,
          sha256: transportSha256,
          byteLength: 4,
          mediaType: "application/octet-stream",
          layout: "renderer-transport-rgba8unorm-top-left",
        }),
        normalized: Object.freeze({
          path: `route-readbacks/normalized/${stem}`,
          sha256: normalizedSha256,
          byteLength: 256,
          mediaType: "application/octet-stream",
          layout: "cpu-normalized-zero-padded-rgba8unorm-top-left",
        }),
      }),
    }),
  });
});
const captureSession = Object.freeze({
  profile: "physical-route",
  automationSurface: "codex-in-app-browser",
  adapterClass: "unknown",
  adapterIdentity: Object.freeze({
    source: "renderer.backend.device-after-init",
    backendType: "WebGPUBackend",
    deviceType: "GPUDevice",
    deviceLabel: "",
    deviceIdentityVerified: true,
  }),
  browser: Object.freeze({ userAgent: "fixture", platform: "fixture", vendor: "fixture", language: "en", userAgentData: null }),
  sourceClosureHash: CORPUS_CAPTURE_SOURCE_HASH,
  buildRevision: CORPUS_CAPTURE_BUILD_REVISION,
  runnerHref: "http://127.0.0.1:4174/threejs-object-sculptor/examples/webgpu-object-sculptor-corpus/in-app-evidence.html?capture=1",
  startedAt: "2026-07-12T00:00:00.000Z",
  finishedAt: "2026-07-12T00:00:01.000Z",
  startedAtMonotonicMs: Object.freeze({ value: 10, unit: "ms", label: "Measured", source: "fixture start" }),
  finishedAtMonotonicMs: Object.freeze({ value: 20, unit: "ms", label: "Measured", source: "fixture finish" }),
});
const documentRecord = buildRouteEvidenceDocument({
  bundleId: "corpus-bundle-test",
  runId: "corpus-routes-test",
  captureSession,
  routes,
});
assert(Object.isFrozen(documentRecord));
assert(Object.isFrozen(documentRecord.routes));
assert.deepEqual(Object.keys(documentRecord), ["schemaVersion", "labId", "bundleId", "runId", "sourceHash", "buildRevision", "captureSession", "backend", "routes"]);
assert.equal(documentRecord.schemaVersion, 2);
assert.equal(documentRecord.labId, "webgpu-object-sculptor-corpus");
assert.equal(documentRecord.sourceHash, CORPUS_CAPTURE_SOURCE_HASH);
assert.equal(documentRecord.buildRevision, CORPUS_CAPTURE_BUILD_REVISION);
assert.deepEqual(documentRecord.backend, backend);

assert.throws(
  () => buildRouteEvidenceDocument({ bundleId: "bundle", runId: "run", captureSession, routes: routes.slice(0, -1) }),
  /exactly 15 records/,
);
assert.throws(
  () => buildRouteEvidenceDocument({ bundleId: "bundle", runId: "run", captureSession, routes: [routes[1], routes[0], ...routes.slice(2)] }),
  /record 0 must be/,
);
assert.throws(
  () => buildRouteEvidenceDocument({ bundleId: "spaces are rejected", runId: "run", captureSession, routes }),
  /bundleId/,
);
assert.throws(
  () => buildRouteEvidenceDocument({ bundleId: "bundle", runId: "run", sourceHash: "0".repeat(64), buildRevision: "wrong", captureSession, routes }),
  /buildRevision/,
);
const aliasedRoutes = structuredClone(routes);
aliasedRoutes[0].readback.artifacts.normalized.path = aliasedRoutes[0].readback.artifacts.transport.path;
assert.throws(
  () => buildRouteEvidenceDocument({ bundleId: "bundle", runId: "run", captureSession, routes: aliasedRoutes }),
  /must not alias/,
);
const sameHashRoutes = structuredClone(routes);
sameHashRoutes[0].readback.normalizedSha256 = sameHashRoutes[0].readback.transportSha256;
sameHashRoutes[0].readback.artifacts.normalized.sha256 = sameHashRoutes[0].readback.transportSha256;
assert.throws(
  () => buildRouteEvidenceDocument({ bundleId: "bundle", runId: "run", captureSession, routes: sameHashRoutes }),
  /falsely aliases/,
);
const pngRelabelRoutes = structuredClone(routes);
pngRelabelRoutes[0].readback.artifacts.normalized.path = pngRelabelRoutes[0].readback.artifacts.normalized.path.replace(/\.bin$/, ".png");
pngRelabelRoutes[0].readback.artifacts.normalized.mediaType = "image/png";
assert.throws(
  () => buildRouteEvidenceDocument({ bundleId: "bundle", runId: "run", captureSession, routes: pngRelabelRoutes }),
  /identity\/layout drifted/,
);

assert.equal(
  canonicalJson({ z: 1, nested: { y: 2, a: [3, { z: 4, a: 5 }] }, a: 0 }),
  '{"a":0,"nested":{"a":[3,{"a":5,"z":4}],"y":2},"z":1}',
);
const digestInput = "object-sculptor-parent-observer-v1\nscenario:potted-bonsai\n{}";
assert.equal(await sha256Hex(digestInput), createHash("sha256").update(digestInput).digest("hex"));
const immutableEntries = [
  { urlPath: "/app.js" },
  { urlPath: "/styles.css" },
];
assert.deepEqual(
  collectImmutableExecutedResourcePaths({
    resourceNames: ["http://127.0.0.1:4174/styles.css", "/app.js", "/app.js"],
    origin: "http://127.0.0.1:4174",
    baseHref: "http://127.0.0.1:4174/route/",
    immutableEntries,
  }),
  ["/app.js", "/styles.css"],
);
assert.throws(
  () => collectImmutableExecutedResourcePaths({
    resourceNames: ["/unmanifested.js"],
    origin: "http://127.0.0.1:4174",
    baseHref: "http://127.0.0.1:4174/route/",
    immutableEntries,
  }),
  /absent from immutable manifest/,
);
assert.throws(
  () => collectImmutableExecutedResourcePaths({
    resourceNames: ["https://example.invalid/runtime.js"],
    origin: "http://127.0.0.1:4174",
    baseHref: "http://127.0.0.1:4174/route/",
    immutableEntries,
  }),
  /third-party runtime resource/,
);
let preflightFailureResetCount = 0;
const preflightError = new Error("preflight failed before producer acquisition");
await assert.rejects(
  failClosedPhysicalRouteCollection({
    routeId: "scenario:potted-bonsai",
    cause: preflightError,
    resetFrame: async () => { preflightFailureResetCount += 1; },
  }),
  (error) => error === preflightError,
);
assert.equal(preflightFailureResetCount, 1, "preflight failure must still reset the iframe exactly once");
let fallbackControllerDisposals = 0;
let fallbackFrameResets = 0;
const producerCleanupError = new Error("producer rejected pre-collection cleanup");
await assert.rejects(
  failClosedPhysicalRouteCollection({
    routeId: "scenario:potted-bonsai",
    cause: preflightError,
    producer: { dispose: async () => { throw producerCleanupError; } },
    childController: { dispose: async () => { fallbackControllerDisposals += 1; } },
    resetFrame: async () => { fallbackFrameResets += 1; },
  }),
  (error) => error instanceof AggregateError
    && error.errors[0] === preflightError
    && error.errors[1] === producerCleanupError,
);
assert.equal(fallbackControllerDisposals, 1, "producer cleanup failure must fall through to the child controller");
assert.equal(fallbackFrameResets, 1, "producer cleanup failure must still reset the iframe");
const cleanupCause = new Error("navigation failed");
const disposalError = new Error("dispose failed");
const resetError = new Error("reset failed");
await assert.rejects(
  failClosedPhysicalRouteCollection({
    routeId: "scenario:potted-bonsai",
    cause: cleanupCause,
    childController: { dispose: async () => { throw disposalError; } },
    resetFrame: async () => { throw resetError; },
  }),
  (error) => error instanceof AggregateError
    && error.errors.length === 3
    && error.errors[0] === cleanupCause
    && error.errors[1] === disposalError
    && error.errors[2] === resetError,
);

const exactDevice = deferredDevice("exact");
const exactHarness = await bootstrapHarness([exactDevice]);
await exactHarness.adapter.requestDevice();
const exactMarker = exactHarness.bootstrap.beginExpectedDeviceDestruction();
exactDevice.lose({ reason: "destroyed", message: "explicit fixture destruction" });
const exactOutcome = await exactMarker.waitForObserved(50);
assert.equal(exactOutcome.observed, true);
assert.equal(exactOutcome.status, "observed-exact-destroyed-device");
assert.equal(exactOutcome.deviceGeneration, 1);
assert.throws(() => exactHarness.bootstrap.beginExpectedDeviceDestruction(), /one-shot route token/);
assert.equal(exactHarness.bootstrap.snapshot().deviceLost.events.length, 0);
assert.equal(exactHarness.bootstrap.snapshot().expectedDeviceDestruction.observedCount, 1);

const olderDevice = deferredDevice("older");
const currentDevice = deferredDevice("current");
const twoDeviceHarness = await bootstrapHarness([olderDevice, currentDevice]);
await twoDeviceHarness.adapter.requestDevice();
await twoDeviceHarness.adapter.requestDevice();
const currentMarker = twoDeviceHarness.bootstrap.beginExpectedDeviceDestruction();
assert.equal(currentMarker.deviceGeneration, 2, "expected destruction must bind the newest exact device generation");
olderDevice.lose({ reason: "destroyed", message: "extra older-device destruction" });
await Promise.resolve();
currentDevice.lose({ reason: "destroyed", message: "current renderer destruction" });
assert.equal((await currentMarker.waitForObserved(50)).observed, true);
const twoDeviceSnapshot = twoDeviceHarness.bootstrap.snapshot();
assert.equal(twoDeviceSnapshot.deviceLost.events.length, 1, "an extra destroyed event from another device must remain a failure event");
assert.equal(twoDeviceSnapshot.deviceLost.events[0].deviceGeneration, 1);

const unobservedDevice = deferredDevice("unobserved");
const unobservedHarness = await bootstrapHarness([unobservedDevice]);
await unobservedHarness.adapter.requestDevice();
const unobservedMarker = unobservedHarness.bootstrap.beginExpectedDeviceDestruction();
const unobservedOutcome = await unobservedMarker.waitForObserved(5);
assert.equal(unobservedOutcome.observed, false);
assert.equal(unobservedOutcome.status, "failed-timeout-without-device-destroyed-event");
unobservedDevice.lose({ reason: "destroyed", message: "late destruction" });
await new Promise((resolve) => setTimeout(resolve, 0));
assert.equal(unobservedHarness.bootstrap.snapshot().deviceLost.events.length, 1, "a late destroyed event after timeout must not be suppressed");

const tarRoutes = structuredClone(routes);
const artifacts = new Map(tarRoutes.flatMap((route) => (
  Object.values(route.readback.artifacts).map((artifact) => [
    artifact.path,
    artifact.byteLength === 4
      ? Uint8Array.of(Number.parseInt(artifact.sha256.slice(-2), 16), 0, 0, 0)
      : new Uint8Array(artifact.byteLength),
  ])
)));
for (const route of tarRoutes) {
  for (const artifact of Object.values(route.readback.artifacts)) {
    artifact.sha256 = createHash("sha256").update(artifacts.get(artifact.path)).digest("hex");
    if (artifact.layout.startsWith("renderer-transport")) route.readback.transportSha256 = artifact.sha256;
    else route.readback.normalizedSha256 = artifact.sha256;
  }
}
const tarDocument = buildRouteEvidenceDocument({
  bundleId: "corpus-bundle-tar-test",
  runId: "corpus-routes-tar-test",
  captureSession,
  routes: tarRoutes,
});
const tarEvidenceJson = `${JSON.stringify(tarDocument)}\n`;
assert.equal(artifacts.size, CORPUS_IN_APP_ROUTE_PLAN.length * 2);
const tar = await buildRouteEvidenceTar({ evidenceJson: tarEvidenceJson, artifacts });
assert.equal(tar.byteLength % 512, 0);
assert.equal(new TextDecoder().decode(tar.subarray(0, 27)), "route-runtime-evidence.json");
assert(tar.subarray(-1024).every((byte) => byte === 0));
assert.equal(CORPUS_ROUTE_EVIDENCE_TAR_FILENAME, "route-runtime-evidence.tar");
await assert.rejects(
  buildRouteEvidenceTar({ evidenceJson: tarEvidenceJson, artifacts, maxBytes: 512 }),
  /safety bound/,
);
await assert.rejects(
  buildRouteEvidenceTar({ evidenceJson: tarEvidenceJson, artifacts: new Map([["../escape.bin", Uint8Array.of(1)]]) }),
  /confined route-readback namespace/,
);
await assert.rejects(
  buildRouteEvidenceTar({ evidenceJson: tarEvidenceJson, artifacts: new Map([["route-readbacks/scenario-articulated-desk-lamp.rgba8unorm.bin", Uint8Array.of(1)]]) }),
  /confined route-readback namespace/,
);
await assert.rejects(
  buildRouteEvidenceTar({ evidenceJson: tarEvidenceJson, artifacts: new Map([["route-readbacks/normalized/scenario-articulated-desk-lamp.png", Uint8Array.of(1)]]) }),
  /confined route-readback namespace/,
);
const missingArtifact = new Map(artifacts);
missingArtifact.delete(routes[0].readback.artifacts.transport.path);
await assert.rejects(
  buildRouteEvidenceTar({ evidenceJson: tarEvidenceJson, artifacts: missingArtifact }),
  /exactly 30 referenced readback artifacts/,
);
const substitutedArtifact = new Map(artifacts);
const substitutedPath = tarRoutes[0].readback.artifacts.transport.path;
substitutedArtifact.set(substitutedPath, new Uint8Array(substitutedArtifact.get(substitutedPath).byteLength).fill(0xff));
await assert.rejects(
  buildRouteEvidenceTar({ evidenceJson: tarEvidenceJson, artifacts: substitutedArtifact }),
  /declared SHA-256 digest/,
  "same-length substituted readback bytes must not enter the evidence TAR",
);

console.log(JSON.stringify({
  ok: true,
  routeRecords: routes.length,
  query: CORPUS_ROUTE_EVIDENCE_QUERY,
  exactDocumentKeys: Object.keys(documentRecord),
  negativeCases: 23,
  digestParity: true,
  tarBytes: tar.byteLength,
}, null, 2));
