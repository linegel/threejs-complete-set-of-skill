import assert from "node:assert/strict";
import { createHash, webcrypto } from "node:crypto";

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

const evidenceJson = `${JSON.stringify(documentRecord)}\n`;
const artifacts = new Map(routes.flatMap((route, routeIndex) => (
  Object.values(route.readback.artifacts).map((artifact, representationIndex) => [
    artifact.path,
    new Uint8Array(artifact.byteLength).fill(routeIndex + representationIndex + 1),
  ])
)));
assert.equal(artifacts.size, CORPUS_IN_APP_ROUTE_PLAN.length * 2);
const tar = buildRouteEvidenceTar({ evidenceJson, artifacts });
assert.equal(tar.byteLength % 512, 0);
assert.equal(new TextDecoder().decode(tar.subarray(0, 27)), "route-runtime-evidence.json");
assert(tar.subarray(-1024).every((byte) => byte === 0));
assert.equal(CORPUS_ROUTE_EVIDENCE_TAR_FILENAME, "route-runtime-evidence.tar");
assert.throws(
  () => buildRouteEvidenceTar({ evidenceJson, artifacts, maxBytes: 512 }),
  /safety bound/,
);
assert.throws(
  () => buildRouteEvidenceTar({ evidenceJson, artifacts: new Map([["../escape.bin", Uint8Array.of(1)]]) }),
  /confined route-readback namespace/,
);
assert.throws(
  () => buildRouteEvidenceTar({ evidenceJson, artifacts: new Map([["route-readbacks/scenario-articulated-desk-lamp.rgba8unorm.bin", Uint8Array.of(1)]]) }),
  /confined route-readback namespace/,
);
assert.throws(
  () => buildRouteEvidenceTar({ evidenceJson, artifacts: new Map([["route-readbacks/normalized/scenario-articulated-desk-lamp.png", Uint8Array.of(1)]]) }),
  /confined route-readback namespace/,
);
const missingArtifact = new Map(artifacts);
missingArtifact.delete(routes[0].readback.artifacts.transport.path);
assert.throws(
  () => buildRouteEvidenceTar({ evidenceJson, artifacts: missingArtifact }),
  /exactly 30 referenced readback artifacts/,
);

console.log(JSON.stringify({
  ok: true,
  routeRecords: routes.length,
  query: CORPUS_ROUTE_EVIDENCE_QUERY,
  exactDocumentKeys: Object.keys(documentRecord),
  negativeCases: 16,
  digestParity: true,
  tarBytes: tar.byteLength,
}, null, 2));
