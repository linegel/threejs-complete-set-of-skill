import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { dirname, relative, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { SCULPT_MODES, SCULPT_TIERS } from "../shared/sculpt-runtime.js";
import { CORPUS_DPR_CAPS, CORPUS_RENDER_POLICY } from "./lab-controller.js";
import { SCULPT_TARGET_IDS } from "./object-catalog.js";
import { renderCorpusRouteHtml } from "./generate-routes.mjs";
import {
  CORPUS_ROUTE_CAMERA_IDS,
  CORPUS_ROUTE_MECHANISM_IDS,
  CORPUS_ROUTE_SCENARIO_IDS,
  CORPUS_ROUTE_TIER_IDS,
} from "./route-evidence-plan.js";
import {
  CORPUS_CAMERAS,
  corpusRouteFromLocation,
  resolveCorpusInitialState,
} from "./route-state.js";
import { CORPUS_EXECUTABLE_SOURCE_CLOSURE } from "./trusted-runtime-source-manifest.generated.js";

const here = dirname(fileURLToPath(import.meta.url));
const repositoryRoot = resolve(here, "../../..");

const CORPUS_SOURCE_BROWSER_ENTRY = "threejs-object-sculptor/examples/webgpu-object-sculptor-corpus/";
const SHA256_PATTERN = /^[a-f0-9]{64}$/;
export const CORPUS_ROUTE_ORIGIN = "http://127.0.0.1:4174";
export const CORPUS_ROUTE_BASE_PATH = `/${CORPUS_SOURCE_BROWSER_ENTRY}`;
export const CORPUS_ROUTE_MIN_VIEWPORT = Object.freeze({ cssWidth: 320, cssHeight: 240 });
const CORPUS_ROUTE_PRODUCER_PATHS = Object.freeze([
  `${CORPUS_SOURCE_BROWSER_ENTRY}route-evidence-bootstrap.js`,
  `${CORPUS_SOURCE_BROWSER_ENTRY}route-evidence-client.js`,
]);

export const CORPUS_ROUTE_BASE_PATHS = Object.freeze([CORPUS_ROUTE_BASE_PATH]);

export const CORPUS_TRUSTED_RUNTIME_SOURCE_PATHS = Object.freeze([
  "labs/runtime/aligned-readback.mjs",
  "package-lock.json",
  "package.json",
  "threejs-object-sculptor/examples/shared/sculpt-runtime.js",
  `${CORPUS_SOURCE_BROWSER_ENTRY}app.js`,
  `${CORPUS_SOURCE_BROWSER_ENTRY}app-runtime-options.js`,
  `${CORPUS_SOURCE_BROWSER_ENTRY}frame-driver.js`,
  `${CORPUS_SOURCE_BROWSER_ENTRY}in-app-evidence-runner.js`,
  `${CORPUS_SOURCE_BROWSER_ENTRY}in-app-evidence.css`,
  `${CORPUS_SOURCE_BROWSER_ENTRY}in-app-evidence.html`,
  `${CORPUS_SOURCE_BROWSER_ENTRY}immutable-route-server.mjs`,
  `${CORPUS_SOURCE_BROWSER_ENTRY}lab-controller.js`,
  `${CORPUS_SOURCE_BROWSER_ENTRY}object-catalog.js`,
  `${CORPUS_SOURCE_BROWSER_ENTRY}package.json`,
  `${CORPUS_SOURCE_BROWSER_ENTRY}route-evidence-bootstrap.js`,
  `${CORPUS_SOURCE_BROWSER_ENTRY}route-evidence-client.js`,
  `${CORPUS_SOURCE_BROWSER_ENTRY}route-evidence-document.js`,
  `${CORPUS_SOURCE_BROWSER_ENTRY}route-evidence-plan.js`,
  `${CORPUS_SOURCE_BROWSER_ENTRY}route-state.js`,
  `${CORPUS_SOURCE_BROWSER_ENTRY}styles.css`,
  `${CORPUS_SOURCE_BROWSER_ENTRY}targets/articulated-desk-lamp/articulated-desk-lamp-factory.js`,
  `${CORPUS_SOURCE_BROWSER_ENTRY}targets/ceramic-teapot/ceramic-teapot-factory.js`,
  `${CORPUS_SOURCE_BROWSER_ENTRY}targets/potted-bonsai/potted-bonsai-factory.js`,
].sort());

export const CORPUS_ROUTE_ERROR_OBSERVERS = Object.freeze({
  pageErrors: Object.freeze({ activeFrom: "before-app-module", observerId: "window-error" }),
  consoleErrors: Object.freeze({ activeFrom: "before-app-module", observerId: "console-error" }),
  unhandledRejections: Object.freeze({ activeFrom: "before-app-module", observerId: "window-unhandledrejection" }),
  requestFailures: Object.freeze({ activeFrom: "before-app-module", observerId: "resource-request-failure" }),
  gpuErrors: Object.freeze({ activeFrom: "before-first-frame", observerId: "gpu-device-uncapturederror" }),
});

export const REQUIRED_ROUTE_DOM_IDS = Object.freeze([
  "scene",
  "subject-title",
  "subject-description",
  "status",
  "subject",
  "mode",
  "tier",
  "camera",
  "mode-title",
  "mode-description",
  "metric-nodes",
  "metric-triangles",
  "metric-draws",
  "metric-submissions",
  "metric-handoffs",
  "metric-physics-status",
  "metric-motion",
  "metric-dpr",
]);

export const CANONICAL_ROUTE_DIMENSIONS = Object.freeze([
  Object.freeze({ kind: "scenario", ids: SCULPT_TARGET_IDS }),
  Object.freeze({ kind: "mechanism", ids: SCULPT_MODES }),
  Object.freeze({ kind: "tier", ids: SCULPT_TIERS }),
  Object.freeze({ kind: "camera", ids: CORPUS_CAMERAS }),
]);

const SELECTOR_ID_BY_ROUTE_KIND = Object.freeze({
  scenario: "subject",
  mechanism: "mode",
  tier: "tier",
  camera: "camera",
});

export const CORPUS_PHYSICAL_ROUTE_PLAN = Object.freeze(CANONICAL_ROUTE_DIMENSIONS.flatMap(({ kind, ids }) => (
  ids.map((id) => Object.freeze({
    routeId: `${kind}:${id}`,
    kind,
    id,
    urlPath: `${kind}/${id}/`,
    selectorId: SELECTOR_ID_BY_ROUTE_KIND[kind],
  }))
)));

function assertExactKeys(value, expected, label) {
  assert(value && typeof value === "object" && !Array.isArray(value), `${label} must be an object`);
  assert.deepEqual(Object.keys(value).sort(), [...expected].sort(), `${label} schema drifted`);
}

function canonicalJson(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

function sha256Text(value) {
  return createHash("sha256").update(value).digest("hex");
}

function assertSha256(value, label) {
  assert.equal(typeof value, "string", `${label} must be a lowercase SHA-256 digest`);
  assert.match(value, SHA256_PATTERN, `${label} must be a lowercase SHA-256 digest`);
}

function sha256Bytes(value) {
  return createHash("sha256").update(value).digest("hex");
}

export function buildTrustedCorpusRuntimeSourceManifest() {
  return Object.freeze(CORPUS_TRUSTED_RUNTIME_SOURCE_PATHS.map((path) => {
    const absolutePath = resolve(repositoryRoot, path);
    assert.equal(relative(repositoryRoot, absolutePath), path, `trusted runtime source path escaped the repository: ${path}`);
    assert(existsSync(absolutePath), `trusted runtime source is missing: ${path}`);
    const bytes = readFileSync(absolutePath);
    return Object.freeze({ path, sha256: sha256Bytes(bytes), byteLength: bytes.byteLength });
  }));
}

export function computeCorpusTrustedRuntimeSourceManifestHash(manifest) {
  assert(Array.isArray(manifest), "trusted runtime source manifest must be an array");
  return sha256Text(`object-sculptor-trusted-runtime-source-v1\n${canonicalJson(manifest)}`);
}

export function computeCorpusRouteProducerBundleHash(producerFiles) {
  assert(Array.isArray(producerFiles), "route producer files must be an array");
  return sha256Text(`object-sculptor-route-producer-v1\n${canonicalJson(producerFiles)}`);
}

export function computeCorpusRouteSourceHash(routeId, routeHtmlSha256, immutableClosureSha256, executableSourceHash) {
  assertSha256(routeHtmlSha256, "route HTML SHA-256");
  assertSha256(immutableClosureSha256, "immutable browser closure SHA-256");
  assertSha256(executableSourceHash, "executable source SHA-256");
  return sha256Text(`object-sculptor-route-source-v4\n${routeId}\n${routeHtmlSha256}\n${immutableClosureSha256}\n${executableSourceHash}`);
}

export function computeCorpusRouteBuildRevision(trustedRuntimeSourceManifestSha256) {
  assertSha256(trustedRuntimeSourceManifestSha256, "trusted runtime source manifest SHA-256");
  return `trusted-source-sha256:${trustedRuntimeSourceManifestSha256}`;
}

export function computeCorpusParentObserverAttestationDigest(routeId, attestation) {
  const { digestAlgorithm: _digestAlgorithm, digest: _digest, ...payload } = attestation;
  return sha256Text(`object-sculptor-parent-observer-v1\n${routeId}\n${canonicalJson(payload)}`);
}

export function computeCorpusRoutePipelineDigest(routeId, descriptor) {
  return sha256Text(`object-sculptor-route-pipeline-v1\n${routeId}\n${canonicalJson(descriptor)}`);
}

export function computeCorpusRouteCameraDigest(routeId, pose) {
  return sha256Text(`object-sculptor-route-camera-v1\n${routeId}\n${canonicalJson(pose)}`);
}

export function computeCorpusRouteReadbackDigest(routeId, readback) {
  const { digestAlgorithm: _digestAlgorithm, digest: _digest, ...payload } = readback;
  return sha256Text(`object-sculptor-route-readback-v2\n${routeId}\n${canonicalJson(payload)}`);
}

export function corpusRouteReadbackArtifactPath({ kind, id }, representation = "normalized") {
  assert(new Set(["transport", "normalized"]).has(representation), "route readback representation is invalid");
  return `route-readbacks/${representation}/${kind}-${id}.rgba8unorm.bin`;
}

export const CORPUS_ROUTE_PIPELINE_DESCRIPTOR = Object.freeze({
  owner: "WebGPURenderer",
  sceneRendersPerFrame: 1,
  passes: Object.freeze(["forward-scene"]),
  mrt: false,
  postprocessing: false,
  toneMapping: "ACESFilmicToneMapping",
  outputColorSpace: "srgb",
  finalOutputOwner: "renderer",
});

const RUNTIME_ROUTE_DIMENSIONS = Object.freeze({
  scenario: Object.freeze({ selectorId: "subject", stateKeys: Object.freeze(["subjectId", "scenario"]), controllerMethods: Object.freeze(["setSubject", "setScenario"]), values: SCULPT_TARGET_IDS }),
  mechanism: Object.freeze({ selectorId: "mode", stateKeys: Object.freeze(["mode"]), controllerMethods: Object.freeze(["setMode"]), values: SCULPT_MODES }),
  tier: Object.freeze({ selectorId: "tier", stateKeys: Object.freeze(["tier"]), controllerMethods: Object.freeze(["setTier"]), values: SCULPT_TIERS }),
  camera: Object.freeze({ selectorId: "camera", stateKeys: Object.freeze(["camera"]), controllerMethods: Object.freeze(["setCamera"]), values: CORPUS_CAMERAS }),
});

function expectedParsedRoute(expected) {
  return Object.freeze({ scenario: null, mechanism: null, tier: null, camera: null, [expected.kind]: expected.id });
}

function changedRouteState(baseline, dimension, value) {
  const changed = { ...baseline };
  for (const key of RUNTIME_ROUTE_DIMENSIONS[dimension].stateKeys) changed[key] = value;
  return changed;
}

function validateSelectorSnapshot(value, expectedValue, label) {
  assertExactKeys(value, ["value", "disabled"], label);
  assert.equal(value.value, expectedValue, `${label} value drifted`);
  assert.equal(value.disabled, false, `${label} must remain enabled`);
}

function validateFiniteVector(value, length, label) {
  assert(Array.isArray(value) && value.length === length, `${label} must contain ${length} values`);
  assert(value.every(Number.isFinite), `${label} must contain only finite values`);
}

function validateCameraPose(value, baselineState, label) {
  assertExactKeys(value, [
    "cameraId",
    "subjectId",
    "positionMeters",
    "quaternion",
    "up",
    "controlsTargetMeters",
    "fovDegrees",
    "aspect",
    "nearMeters",
    "farMeters",
  ], label);
  assert.equal(value.cameraId, baselineState.camera, `${label} semantic camera drifted`);
  assert.equal(value.subjectId, baselineState.subjectId, `${label} subject drifted`);
  validateFiniteVector(value.positionMeters, 3, `${label}.positionMeters`);
  validateFiniteVector(value.quaternion, 4, `${label}.quaternion`);
  validateFiniteVector(value.up, 3, `${label}.up`);
  validateFiniteVector(value.controlsTargetMeters, 3, `${label}.controlsTargetMeters`);
  const quaternionLength = Math.hypot(...value.quaternion);
  assert(Math.abs(quaternionLength - 1) <= 1e-6, `${label} quaternion is not normalized`);
  assert(Number.isFinite(value.fovDegrees) && value.fovDegrees > 0 && value.fovDegrees < 180, `${label} FOV is invalid`);
  assert(Number.isFinite(value.aspect) && value.aspect > 0, `${label} aspect is invalid`);
  assert(Number.isFinite(value.nearMeters) && value.nearMeters > 0, `${label} near plane is invalid`);
  assert(Number.isFinite(value.farMeters) && value.farMeters > value.nearMeters, `${label} far plane is invalid`);
}

function expectedStateForRoute(expected) {
  const route = { scenario: null, mechanism: null, tier: null, camera: null, [expected.kind]: expected.id };
  const state = resolveCorpusInitialState(route);
  return Object.freeze({
    subjectId: state.scenario,
    scenario: state.scenario,
    mode: state.mechanism,
    tier: state.tier,
    camera: state.camera,
    seed: 1,
    time: 0,
  });
}

function alternateValue(dimension, current) {
  return RUNTIME_ROUTE_DIMENSIONS[dimension].values.find((value) => value !== current);
}

function validateRouteStateSnapshot(value, expected, label) {
  assertExactKeys(value, ["subjectId", "scenario", "mode", "tier", "camera", "seed", "time"], label);
  assert.deepEqual(value, expected, `${label} drifted`);
}

function validateRouteLockResult(value, expected, method, requestedValue, ordinal, label) {
  assertExactKeys(value, [
    "code",
    "status",
    "reason",
    "dimension",
    "selectorId",
    "method",
    "lockedValue",
    "requestedValue",
    "currentValue",
    "stateChanged",
    "fulfilled",
    "returnValue",
    "rejectionOrdinal",
  ], label);
  assert.equal(value.code, "CORPUS_ROUTE_LOCKED", `${label} code drifted`);
  assert.equal(value.status, "rejected", `${label} status drifted`);
  assert.equal(value.reason, "route-dimension-immutable", `${label} reason drifted`);
  assert.equal(value.dimension, expected.kind, `${label} dimension drifted`);
  assert.equal(value.selectorId, expected.selectorId, `${label} selector drifted`);
  assert.equal(value.method, method, `${label} method drifted`);
  assert.equal(value.lockedValue, expected.id, `${label} locked value drifted`);
  assert.equal(value.requestedValue, requestedValue, `${label} requested value drifted`);
  assert.equal(value.currentValue, expected.id, `${label} current value drifted`);
  assert.equal(value.stateChanged, false, `${label} must preserve state`);
  assert.equal(value.fulfilled, true, `${label} must fulfill without poisoning the serialized lane`);
  assert.equal(value.returnValue, false, `${label} must return false`);
  assert.equal(value.rejectionOrdinal, ordinal, `${label} rejection ordinal drifted`);
}

export function validatePhysicalRouteRuntimeRecords(records, { readArtifact } = {}) {
  assert(Array.isArray(records), "physical route runtime records must be an array");
  assert.equal(records.length, CORPUS_PHYSICAL_ROUTE_PLAN.length, "physical route runtime record count drifted");
  assert.equal(typeof readArtifact, "function", "physical route validation requires a confined readArtifact(reference, record) resolver");
  const trustedRuntimeSourceManifest = buildTrustedCorpusRuntimeSourceManifest();
  const trustedRuntimeSourceManifestSha256 = computeCorpusTrustedRuntimeSourceManifestHash(trustedRuntimeSourceManifest);
  const trustedSourceByPath = new Map(trustedRuntimeSourceManifest.map((entry) => [entry.path, entry]));
  let runAppModuleSha256 = null;
  let runProducerBundleSha256 = null;
  let runBuildRevision = null;
  let runViewport = null;
  let runRouteBase = null;
  let priorNavigationAssignedAtMonotonicMs = -Infinity;
  for (let index = 0; index < CORPUS_PHYSICAL_ROUTE_PLAN.length; index += 1) {
    const expected = CORPUS_PHYSICAL_ROUTE_PLAN[index];
    const dimensionSpec = RUNTIME_ROUTE_DIMENSIONS[expected.kind];
    const baselineState = expectedStateForRoute(expected);
    const requestedAlternative = alternateValue(expected.kind, expected.id);
    const record = records[index];
    assertExactKeys(record, [
      "routeId",
      "kind",
      "id",
      "urlPath",
      "provenance",
      "location",
      "documentRoute",
      "parsedRoute",
      "selectors",
      "baselineState",
      "hud",
      "camera",
      "routeLock",
      "firstFrame",
      "postProbeRender",
      "runtime",
      "pipeline",
      "readback",
      "errorChannels",
      "labError",
      "teardown",
    ], `physical route runtime record ${index}`);
    assert.equal(record.routeId, expected.routeId, `${expected.routeId} runtime route ID drifted`);
    assert.equal(record.kind, expected.kind, `${expected.routeId} runtime kind drifted`);
    assert.equal(record.id, expected.id, `${expected.routeId} runtime value drifted`);
    assert.equal(record.urlPath, expected.urlPath, `${expected.routeId} runtime URL path drifted`);

    assertExactKeys(record.provenance, [
      "evidenceProducer",
      "sourceHashAlgorithm",
      "immutableServer",
      "servedRoute",
      "routeHtmlSha256",
      "servedAppModule",
      "appModuleSha256",
      "producerFiles",
      "producerBundleSha256",
      "trustedRuntimeSourceManifest",
      "trustedRuntimeSourceManifestSha256",
      "executableSourceClosure",
      "executedResourcePaths",
      "sourceHash",
      "buildRevision",
      "browserEntry",
    ], `${expected.routeId} provenance`);
    assert.equal(record.provenance.evidenceProducer, "immutable-browser-page-route-producer", `${expected.routeId} evidence producer drifted`);
    assert.equal(record.provenance.sourceHashAlgorithm, "sha256", `${expected.routeId} source hash algorithm drifted`);
    assertExactKeys(record.provenance.immutableServer, [
      "manifestPath",
      "manifestSha256",
      "snapshotId",
      "closureSha256",
      "transformMode",
      "immutableSnapshot",
      "spaFallback",
      "viteClient",
      "entryCount",
    ], `${expected.routeId} immutableServer`);
    assert.equal(record.provenance.immutableServer.manifestPath, "/.well-known/object-sculptor-corpus-immutable.json", `${expected.routeId} immutable manifest path drifted`);
    assertSha256(record.provenance.immutableServer.manifestSha256, `${expected.routeId} immutable manifest SHA-256`);
    assertSha256(record.provenance.immutableServer.closureSha256, `${expected.routeId} immutable closure SHA-256`);
    assert.equal(record.provenance.immutableServer.snapshotId, `source-sha256:${record.provenance.immutableServer.closureSha256}`, `${expected.routeId} immutable snapshot ID drifted`);
    assert.equal(record.provenance.immutableServer.transformMode, "none", `${expected.routeId} immutable source was transformed`);
    assert.equal(record.provenance.immutableServer.immutableSnapshot, true, `${expected.routeId} source snapshot was mutable`);
    assert.equal(record.provenance.immutableServer.spaFallback, false, `${expected.routeId} source server enabled SPA fallback`);
    assert.equal(record.provenance.immutableServer.viteClient, false, `${expected.routeId} source server enabled Vite injection`);
    assert(Number.isInteger(record.provenance.immutableServer.entryCount) && record.provenance.immutableServer.entryCount > 0, `${expected.routeId} immutable source entry count is invalid`);
    const validateServedFile = (served, label) => {
      assertExactKeys(served, ["pathname", "sourcePath", "sha256", "byteLength"], label);
      assertSha256(served.sha256, `${label}.sha256`);
      assert(Number.isSafeInteger(served.byteLength) && served.byteLength > 0, `${label}.byteLength is invalid`);
    };
    validateServedFile(record.provenance.servedRoute, `${expected.routeId} servedRoute`);
    validateServedFile(record.provenance.servedAppModule, `${expected.routeId} servedAppModule`);
    assertSha256(record.provenance.routeHtmlSha256, `${expected.routeId} route HTML SHA-256`);
    const trustedRouteHtmlBytes = readFileSync(resolve(here, expected.urlPath, "index.html"));
    assert.equal(record.provenance.routeHtmlSha256, sha256Bytes(trustedRouteHtmlBytes), `${expected.routeId} route HTML hash does not match the trusted source`);
    assert.equal(record.provenance.servedRoute.sha256, record.provenance.routeHtmlSha256, `${expected.routeId} served route digest drifted`);
    assert.equal(record.provenance.servedRoute.pathname, `${CORPUS_ROUTE_BASE_PATH}${expected.urlPath}`, `${expected.routeId} served route pathname drifted`);
    assertSha256(record.provenance.appModuleSha256, `${expected.routeId} app module SHA-256`);
    assert.equal(
      record.provenance.appModuleSha256,
      trustedSourceByPath.get(`${CORPUS_SOURCE_BROWSER_ENTRY}app.js`)?.sha256,
      `${expected.routeId} app module hash does not match the trusted source`,
    );
    assert.equal(record.provenance.servedAppModule.sha256, record.provenance.appModuleSha256, `${expected.routeId} served app digest drifted`);
    assert.equal(record.provenance.servedAppModule.pathname, `${CORPUS_ROUTE_BASE_PATH}app.js`, `${expected.routeId} served app pathname drifted`);
    assert(Array.isArray(record.provenance.producerFiles), `${expected.routeId} producer files must be an array`);
    assert.equal(record.provenance.producerFiles.length, CORPUS_ROUTE_PRODUCER_PATHS.length, `${expected.routeId} producer file count drifted`);
    for (let producerIndex = 0; producerIndex < CORPUS_ROUTE_PRODUCER_PATHS.length; producerIndex += 1) {
      const producer = record.provenance.producerFiles[producerIndex];
      assertExactKeys(producer, ["path", "sha256", "byteLength"], `${expected.routeId} producerFiles[${producerIndex}]`);
      assert.equal(producer.path, CORPUS_ROUTE_PRODUCER_PATHS[producerIndex], `${expected.routeId} producer file order/path drifted`);
      assertSha256(producer.sha256, `${expected.routeId} producerFiles[${producerIndex}].sha256`);
      assert.equal(producer.sha256, trustedSourceByPath.get(producer.path)?.sha256, `${expected.routeId} producer file hash does not match the trusted source`);
      assert(Number.isSafeInteger(producer.byteLength) && producer.byteLength > 0, `${expected.routeId} producer byte length is invalid`);
    }
    assertSha256(record.provenance.producerBundleSha256, `${expected.routeId} producer bundle SHA-256`);
    assert.equal(
      record.provenance.producerBundleSha256,
      computeCorpusRouteProducerBundleHash(record.provenance.producerFiles),
      `${expected.routeId} producer bundle hash drifted`,
    );
    assert.deepEqual(
      record.provenance.trustedRuntimeSourceManifest,
      trustedRuntimeSourceManifest,
      `${expected.routeId} trusted runtime source manifest drifted`,
    );
    assertSha256(record.provenance.trustedRuntimeSourceManifestSha256, `${expected.routeId} trusted runtime source manifest SHA-256`);
    assert.equal(
      record.provenance.trustedRuntimeSourceManifestSha256,
      trustedRuntimeSourceManifestSha256,
      `${expected.routeId} trusted runtime source manifest hash drifted`,
    );
    assert.deepEqual(record.provenance.executableSourceClosure, CORPUS_EXECUTABLE_SOURCE_CLOSURE, `${expected.routeId} executable source closure drifted`);
    assert(Array.isArray(record.provenance.executedResourcePaths), `${expected.routeId} executed resource paths must be an array`);
    assert.deepEqual([...record.provenance.executedResourcePaths].sort(), record.provenance.executedResourcePaths, `${expected.routeId} executed resource paths must be sorted`);
    assert(record.provenance.executedResourcePaths.includes(`${CORPUS_ROUTE_BASE_PATH}app.js`), `${expected.routeId} executed resources omitted app.js`);
    assert(record.provenance.executedResourcePaths.includes(`${CORPUS_ROUTE_BASE_PATH}route-evidence-bootstrap.js`), `${expected.routeId} executed resources omitted observer bootstrap`);
    assert(!record.provenance.executedResourcePaths.some((path) => path.includes("/@vite/client")), `${expected.routeId} executed resources contain Vite client injection`);
    assertSha256(record.provenance.sourceHash, `${expected.routeId} source SHA-256`);
    assert.equal(
      record.provenance.sourceHash,
      computeCorpusRouteSourceHash(
        expected.routeId,
        record.provenance.routeHtmlSha256,
        record.provenance.immutableServer.closureSha256,
        record.provenance.executableSourceClosure.sourceHash,
      ),
      `${expected.routeId} source hash does not bind the trusted route and complete runtime source manifest`,
    );
    assert.equal(
      record.provenance.buildRevision,
      record.provenance.immutableServer.snapshotId,
      `${expected.routeId} build revision drifted`,
    );
    if (index === 0) {
      runAppModuleSha256 = record.provenance.appModuleSha256;
      runProducerBundleSha256 = record.provenance.producerBundleSha256;
      runBuildRevision = record.provenance.buildRevision;
    } else {
      assert.equal(record.provenance.appModuleSha256, runAppModuleSha256, `${expected.routeId} app module changed within one route run`);
      assert.equal(record.provenance.producerBundleSha256, runProducerBundleSha256, `${expected.routeId} evidence producer changed within one route run`);
      assert.equal(record.provenance.buildRevision, runBuildRevision, `${expected.routeId} build revision changed within one route run`);
    }
    assertExactKeys(record.location, [
      "origin",
      "requestedHref",
      "finalHref",
      "requestedPathname",
      "finalPathname",
      "search",
      "responseStatus",
      "documentReadyState",
      "parentObserverAttestation",
      "viewport",
    ], `${expected.routeId} location`);
    const expectedPathname = `${CORPUS_ROUTE_BASE_PATH}${expected.urlPath}`;
    const expectedHref = `${CORPUS_ROUTE_ORIGIN}${expectedPathname}?capture=1`;
    assert.equal(record.location.origin, CORPUS_ROUTE_ORIGIN, `${expected.routeId} route origin drifted`);
    assert.equal(record.location.requestedHref, expectedHref, `${expected.routeId} requested URL drifted`);
    assert.equal(record.location.finalHref, expectedHref, `${expected.routeId} final URL drifted`);
    assert.equal(record.location.requestedPathname, record.location.finalPathname, `${expected.routeId} redirected away from its physical route`);
    assert.equal(record.location.finalPathname, expectedPathname, `${expected.routeId} final pathname drifted`);
    const observedRouteBase = record.location.finalPathname.slice(0, -expected.urlPath.length);
    if (index === 0) runRouteBase = observedRouteBase;
    else assert.equal(observedRouteBase, runRouteBase, `${expected.routeId} route base changed within one route run`);
    assert.equal(runRouteBase, CORPUS_ROUTE_BASE_PATH, `${expected.routeId} route base is not canonical`);
    assert.equal(record.provenance.browserEntry, expectedPathname, `${expected.routeId} browser entry drifted`);
    assert.equal(record.location.search, "?capture=1", `${expected.routeId} route evidence must use exclusive capture ownership`);
    assert.equal(record.location.responseStatus, 200, `${expected.routeId} route response did not succeed`);
    assert.equal(record.location.documentReadyState, "complete", `${expected.routeId} document was not fully loaded`);

    const parentAttestation = record.location.parentObserverAttestation;
    assertExactKeys(parentAttestation, [
      "owner",
      "target",
      "observerIds",
      "installedAtMonotonicMs",
      "navigationAssignedAtMonotonicMs",
      "installedBeforeNavigation",
      "listenersRemoved",
      "iframeErrorEvents",
      "digestAlgorithm",
      "digest",
    ], `${expected.routeId} parent observer attestation`);
    assert.equal(parentAttestation.owner, "in-app-evidence-runner", `${expected.routeId} parent observer owner drifted`);
    assert.equal(parentAttestation.target, "iframe#route-frame", `${expected.routeId} parent observer target drifted`);
    assert.deepEqual(parentAttestation.observerIds, ["iframe-load", "iframe-error"], `${expected.routeId} parent observer inventory drifted`);
    assert(Number.isFinite(parentAttestation.installedAtMonotonicMs) && parentAttestation.installedAtMonotonicMs >= 0, `${expected.routeId} parent observer install time is invalid`);
    assert(Number.isFinite(parentAttestation.navigationAssignedAtMonotonicMs), `${expected.routeId} navigation assignment time is invalid`);
    assert(parentAttestation.navigationAssignedAtMonotonicMs >= parentAttestation.installedAtMonotonicMs, `${expected.routeId} parent observers were not installed before navigation; monotonic clock regressed`);
    assert(parentAttestation.navigationAssignedAtMonotonicMs > priorNavigationAssignedAtMonotonicMs, `${expected.routeId} parent navigation chronology drifted`);
    priorNavigationAssignedAtMonotonicMs = parentAttestation.navigationAssignedAtMonotonicMs;
    assert.equal(parentAttestation.installedBeforeNavigation, true, `${expected.routeId} parent observer ordering flag drifted`);
    assert.equal(parentAttestation.listenersRemoved, true, `${expected.routeId} parent navigation listeners were not removed`);
    assert.deepEqual(parentAttestation.iframeErrorEvents, [], `${expected.routeId} parent iframe observer recorded navigation errors`);
    assert.equal(parentAttestation.digestAlgorithm, "sha256", `${expected.routeId} parent observer digest algorithm drifted`);
    assertSha256(parentAttestation.digest, `${expected.routeId} parent observer digest`);
    assert.equal(
      parentAttestation.digest,
      computeCorpusParentObserverAttestationDigest(expected.routeId, parentAttestation),
      `${expected.routeId} parent observer attestation digest drifted`,
    );

    assertExactKeys(record.location.viewport, ["cssWidth", "cssHeight", "devicePixelRatio", "appliedDpr"], `${expected.routeId} viewport`);
    assert(Number.isInteger(record.location.viewport.cssWidth) && record.location.viewport.cssWidth >= CORPUS_ROUTE_MIN_VIEWPORT.cssWidth, `${expected.routeId} viewport width is below the frozen route-evidence minimum`);
    assert(Number.isInteger(record.location.viewport.cssHeight) && record.location.viewport.cssHeight >= CORPUS_ROUTE_MIN_VIEWPORT.cssHeight, `${expected.routeId} viewport height is below the frozen route-evidence minimum`);
    assert(Number.isFinite(record.location.viewport.devicePixelRatio) && record.location.viewport.devicePixelRatio >= 0.5 && record.location.viewport.devicePixelRatio <= 4, `${expected.routeId} device DPR is outside the supported evidence range`);
    assert(Number.isFinite(record.location.viewport.appliedDpr) && record.location.viewport.appliedDpr > 0, `${expected.routeId} applied DPR is invalid`);
    const physicalViewport = {
      cssWidth: record.location.viewport.cssWidth,
      cssHeight: record.location.viewport.cssHeight,
      devicePixelRatio: record.location.viewport.devicePixelRatio,
    };
    if (index === 0) runViewport = physicalViewport;
    else assert.deepEqual(physicalViewport, runViewport, `${expected.routeId} physical viewport changed within one route run`);
    const expectedDpr = Math.min(record.location.viewport.devicePixelRatio, CORPUS_DPR_CAPS[baselineState.tier]);
    assert(Math.abs(record.location.viewport.appliedDpr - expectedDpr) <= 1e-9, `${expected.routeId} applied DPR does not match the tier policy`);

    assertExactKeys(record.documentRoute, ["kind", "id", "subject", "profile"], `${expected.routeId} documentRoute`);
    assert.equal(record.documentRoute.kind, expected.kind, `${expected.routeId} document route kind drifted`);
    assert.equal(record.documentRoute.id, expected.id, `${expected.routeId} document route ID drifted`);
    assert.equal(record.documentRoute.subject, baselineState.subjectId, `${expected.routeId} document subject dataset drifted`);
    assert.equal(record.documentRoute.profile, "correctness", `${expected.routeId} document profile dataset drifted`);
    assertExactKeys(record.parsedRoute, ["scenario", "mechanism", "tier", "camera"], `${expected.routeId} parsedRoute`);
    assert.deepEqual(record.parsedRoute, expectedParsedRoute(expected), `${expected.routeId} parsed route drifted`);
    validateRouteStateSnapshot(record.baselineState, baselineState, `${expected.routeId} baselineState`);

    assertExactKeys(record.hud, ["datasetState", "textContent", "ready"], `${expected.routeId} HUD`);
    assert.equal(record.hud.datasetState, "ready", `${expected.routeId} HUD state is not Ready`);
    assert.equal(record.hud.textContent, `Ready · ${baselineState.subjectId} · correctness WebGPU`, `${expected.routeId} HUD Ready text drifted`);
    assert.equal(record.hud.ready, true, `${expected.routeId} HUD did not publish ready=true`);

    assertExactKeys(record.camera, [
      "interactionEnabled",
      "semanticCamera",
      "beforeFirstFrame",
      "afterFirstFrame",
      "afterProbes",
      "afterReadback",
      "digestAlgorithm",
      "poseDigest",
    ], `${expected.routeId} camera proof`);
    assert.equal(record.camera.interactionEnabled, false, `${expected.routeId} fixed-route camera interaction was not disabled`);
    assert.equal(record.camera.semanticCamera, baselineState.camera, `${expected.routeId} camera proof semantic ID drifted`);
    const expectedCameraAspect = record.location.viewport.cssWidth / record.location.viewport.cssHeight;
    for (const stage of ["beforeFirstFrame", "afterFirstFrame", "afterProbes", "afterReadback"]) {
      validateCameraPose(record.camera[stage], baselineState, `${expected.routeId} camera.${stage}`);
      assert(Math.abs(record.camera[stage].aspect - expectedCameraAspect) <= 1e-12, `${expected.routeId} camera.${stage} aspect is not viewport-bound`);
    }
    assert.deepEqual(record.camera.afterFirstFrame, record.camera.beforeFirstFrame, `${expected.routeId} camera drifted during the first frame`);
    assert.deepEqual(record.camera.afterProbes, record.camera.beforeFirstFrame, `${expected.routeId} camera did not exactly restore after route probes`);
    assert.deepEqual(record.camera.afterReadback, record.camera.beforeFirstFrame, `${expected.routeId} camera drifted during readback`);
    assert.equal(record.camera.digestAlgorithm, "sha256", `${expected.routeId} camera digest algorithm drifted`);
    assertSha256(record.camera.poseDigest, `${expected.routeId} camera pose digest`);
    assert.equal(
      record.camera.poseDigest,
      computeCorpusRouteCameraDigest(expected.routeId, record.camera.afterReadback),
      `${expected.routeId} camera pose digest does not bind this route`,
    );

    assert(Array.isArray(record.selectors), `${expected.routeId} selectors must be an array`);
    const selectorPlan = [
      { id: "subject", stateKey: "subjectId" },
      { id: "mode", stateKey: "mode" },
      { id: "tier", stateKey: "tier" },
      { id: "camera", stateKey: "camera" },
    ];
    assert.equal(record.selectors.length, selectorPlan.length, `${expected.routeId} selector count drifted`);
    for (let selectorIndex = 0; selectorIndex < selectorPlan.length; selectorIndex += 1) {
      const selectorExpected = selectorPlan[selectorIndex];
      const selector = record.selectors[selectorIndex];
      assertExactKeys(selector, ["id", "value", "disabled"], `${expected.routeId} selector ${selectorIndex}`);
      assert.equal(selector.id, selectorExpected.id, `${expected.routeId} selector order drifted`);
      assert.equal(selector.value, baselineState[selectorExpected.stateKey], `${expected.routeId}/${selector.id} value drifted`);
      assert.equal(selector.disabled, selector.id === expected.selectorId, `${expected.routeId}/${selector.id} lock state drifted`);
    }
    const disabledSelectorIds = record.selectors.filter(({ disabled }) => disabled).map(({ id }) => id);
    const enabledSelectorIds = record.selectors.filter(({ disabled }) => !disabled).map(({ id }) => id);
    assertExactKeys(record.routeLock, [
      "state",
      "lockedSelectorId",
      "lockedValue",
      "disabledSelectorIds",
      "enabledSelectorIds",
      "uiProbe",
      "controllerProbes",
      "unlockedProbes",
    ], `${expected.routeId} routeLock`);
    assert.equal(record.routeLock.lockedSelectorId, expected.selectorId, `${expected.routeId} route lock ID drifted`);
    assert.equal(record.routeLock.lockedValue, expected.id, `${expected.routeId} route lock value drifted`);
    assert.deepEqual(record.routeLock.disabledSelectorIds, [expected.selectorId], `${expected.routeId} must disable exactly one selector`);
    assert.deepEqual(record.routeLock.enabledSelectorIds, enabledSelectorIds, `${expected.routeId} enabled selector inventory drifted`);
    assert.deepEqual(disabledSelectorIds, [expected.selectorId], `${expected.routeId} disabled selector inventory drifted`);

    assertExactKeys(record.routeLock.state, [
      "code",
      "locks",
      "lockedDimensions",
      "lockedDimension",
      "lockedSelectorId",
      "lockedValue",
      "disabledSelectorIds",
      "enabledSelectorIds",
    ], `${expected.routeId} routeLock.state`);
    assert.equal(record.routeLock.state.code, "CORPUS_ROUTE_LOCK_STATE", `${expected.routeId} route lock state code drifted`);
    assert.deepEqual(record.routeLock.state.lockedDimensions, [expected.kind], `${expected.routeId} locked dimensions drifted`);
    assert.equal(record.routeLock.state.lockedDimension, expected.kind, `${expected.routeId} locked dimension drifted`);
    assert.equal(record.routeLock.state.lockedSelectorId, expected.selectorId, `${expected.routeId} locked selector drifted`);
    assert.equal(record.routeLock.state.lockedValue, expected.id, `${expected.routeId} locked value drifted`);
    assert.deepEqual(record.routeLock.state.disabledSelectorIds, [expected.selectorId], `${expected.routeId} disabled selector state drifted`);
    assert.deepEqual(record.routeLock.state.enabledSelectorIds, enabledSelectorIds, `${expected.routeId} enabled selector state drifted`);
    assertExactKeys(record.routeLock.state.locks, ["scenario", "mechanism", "tier", "camera"], `${expected.routeId} routeLock.state.locks`);
    for (const [dimension, spec] of Object.entries(RUNTIME_ROUTE_DIMENSIONS)) {
      const lock = record.routeLock.state.locks[dimension];
      assertExactKeys(lock, ["dimension", "selectorId", "locked", "lockedValue", "controllerMethods"], `${expected.routeId} ${dimension} lock`);
      assert.equal(lock.dimension, dimension, `${expected.routeId}/${dimension} lock dimension drifted`);
      assert.equal(lock.selectorId, spec.selectorId, `${expected.routeId}/${dimension} lock selector drifted`);
      assert.equal(lock.locked, dimension === expected.kind, `${expected.routeId}/${dimension} lock boolean drifted`);
      assert.equal(lock.lockedValue, dimension === expected.kind ? expected.id : null, `${expected.routeId}/${dimension} lock value drifted`);
      assert.deepEqual(lock.controllerMethods, spec.controllerMethods, `${expected.routeId}/${dimension} controller lock methods drifted`);
    }

    assertExactKeys(record.routeLock.uiProbe, [
      "attemptedValue",
      "changeEvents",
      "fulfilled",
      "returnValue",
      "beforeState",
      "afterState",
      "beforeSelectorValue",
      "afterSelectorValue",
      "result",
    ], `${expected.routeId} uiProbe`);
    assert.equal(record.routeLock.uiProbe.attemptedValue, requestedAlternative, `${expected.routeId} UI probe did not use the frozen alternate value`);
    assert.equal(record.routeLock.uiProbe.changeEvents, 1, `${expected.routeId} UI probe event count drifted`);
    assert.equal(record.routeLock.uiProbe.fulfilled, true, `${expected.routeId} UI probe must fulfill`);
    assert.equal(record.routeLock.uiProbe.returnValue, false, `${expected.routeId} UI probe must return false`);
    validateRouteStateSnapshot(record.routeLock.uiProbe.beforeState, baselineState, `${expected.routeId} uiProbe.beforeState`);
    validateRouteStateSnapshot(record.routeLock.uiProbe.afterState, baselineState, `${expected.routeId} uiProbe.afterState`);
    assert.equal(record.routeLock.uiProbe.beforeSelectorValue, expected.id, `${expected.routeId} UI baseline selector drifted`);
    assert.equal(record.routeLock.uiProbe.afterSelectorValue, expected.id, `${expected.routeId} UI selector was not restored`);
    validateRouteLockResult(record.routeLock.uiProbe.result, expected, dimensionSpec.controllerMethods[0], requestedAlternative, 1, `${expected.routeId} uiProbe.result`);

    assert(Array.isArray(record.routeLock.controllerProbes), `${expected.routeId} controllerProbes must be an array`);
    assert.equal(record.routeLock.controllerProbes.length, dimensionSpec.controllerMethods.length, `${expected.routeId} controller lock probe count drifted`);
    for (let probeIndex = 0; probeIndex < dimensionSpec.controllerMethods.length; probeIndex += 1) {
      const method = dimensionSpec.controllerMethods[probeIndex];
      const probe = record.routeLock.controllerProbes[probeIndex];
      const label = `${expected.routeId} controllerProbes[${probeIndex}]`;
      assertExactKeys(probe, ["method", "attemptedValue", "fulfilled", "returnValue", "error", "beforeState", "afterState", "result"], label);
      assert.equal(probe.method, method, `${label} method drifted`);
      assert.equal(probe.attemptedValue, requestedAlternative, `${label} alternate value drifted`);
      assert.equal(probe.fulfilled, true, `${label} must fulfill`);
      assert.equal(probe.returnValue, false, `${label} must return false`);
      assert.equal(probe.error, null, `${label} must not poison the public lane`);
      validateRouteStateSnapshot(probe.beforeState, baselineState, `${label}.beforeState`);
      validateRouteStateSnapshot(probe.afterState, baselineState, `${label}.afterState`);
      validateRouteLockResult(probe.result, expected, method, requestedAlternative, probeIndex + 2, `${label}.result`);
    }

    const unlockedDimensions = Object.keys(RUNTIME_ROUTE_DIMENSIONS).filter((dimension) => dimension !== expected.kind);
    assert(Array.isArray(record.routeLock.unlockedProbes), `${expected.routeId} unlockedProbes must be an array`);
    assert.equal(record.routeLock.unlockedProbes.length, unlockedDimensions.length, `${expected.routeId} unlocked probe count drifted`);
    for (let probeIndex = 0; probeIndex < unlockedDimensions.length; probeIndex += 1) {
      const dimension = unlockedDimensions[probeIndex];
      const spec = RUNTIME_ROUTE_DIMENSIONS[dimension];
      const current = baselineState[spec.stateKeys[0]];
      const alternate = alternateValue(dimension, current);
      const probe = record.routeLock.unlockedProbes[probeIndex];
      const label = `${expected.routeId} unlockedProbes[${probeIndex}]`;
      assertExactKeys(probe, [
        "dimension",
        "selectorId",
        "surface",
        "publicControllerMethod",
        "attemptedValue",
        "beforeState",
        "beforeSelector",
        "changeResult",
        "changedState",
        "changedSelector",
        "restoreResult",
        "restoredState",
        "restoredSelector",
      ], label);
      assert.equal(probe.dimension, dimension, `${label} dimension drifted`);
      assert.equal(probe.selectorId, spec.selectorId, `${label} selector drifted`);
      assert.equal(probe.surface, "ui-change-event", `${label} must dispatch through the UI surface`);
      assert.equal(probe.publicControllerMethod, spec.controllerMethods[0], `${label} public controller binding drifted`);
      assert.equal(probe.attemptedValue, alternate, `${label} alternate value drifted`);
      validateRouteStateSnapshot(probe.beforeState, baselineState, `${label}.beforeState`);
      validateSelectorSnapshot(probe.beforeSelector, current, `${label}.beforeSelector`);
      assert.equal(probe.changeResult, true, `${label} unlocked change was blocked`);
      validateRouteStateSnapshot(probe.changedState, changedRouteState(baselineState, dimension, alternate), `${label}.changedState`);
      validateSelectorSnapshot(probe.changedSelector, alternate, `${label}.changedSelector`);
      assert.equal(probe.restoreResult, true, `${label} unlocked restore failed`);
      validateRouteStateSnapshot(probe.restoredState, baselineState, `${label}.restoredState`);
      validateSelectorSnapshot(probe.restoredSelector, current, `${label}.restoredSelector`);
    }

    const expectedRejectCount = 1 + dimensionSpec.controllerMethods.length;

    for (const [field, label] of [["firstFrame", "firstFrame"], ["postProbeRender", "postProbeRender"]]) {
      const proof = record[field];
      assertExactKeys(proof, ["owner", "before", "after"], `${expected.routeId} ${label}`);
      assert.equal(proof.owner, "capture-harness", `${expected.routeId} ${label} owner drifted`);
      for (const instant of ["before", "after"]) {
        assertExactKeys(proof[instant], ["firstFrameCompleted", "completedFrames", "renderSubmissions"], `${expected.routeId} ${label}.${instant}`);
      }
    }
    assert.deepEqual(record.firstFrame.before, { firstFrameCompleted: false, completedFrames: 0, renderSubmissions: 0 }, `${expected.routeId} first-frame baseline drifted`);
    assert.deepEqual(record.firstFrame.after, { firstFrameCompleted: true, completedFrames: 1, renderSubmissions: 1 }, `${expected.routeId} first-frame advancement drifted`);
    assert.deepEqual(record.postProbeRender.before, record.firstFrame.after, `${expected.routeId} probes unexpectedly submitted a frame`);
    assert.deepEqual(record.postProbeRender.after, { firstFrameCompleted: true, completedFrames: 2, renderSubmissions: 2 }, `${expected.routeId} post-probe readback render delta drifted`);

    assertExactKeys(record.runtime, [
      "backend",
      "nativeWebGPU",
      "initialized",
      "firstFrameCompleted",
      "completedFrames",
      "renderSubmissions",
      "rendererType",
      "backendType",
      "threeRevision",
      "runtimeProfile",
      "rendererBackendEvidence",
      "rendererDeviceGeneration",
      "deviceLossGeneration",
      "rendererDeviceStatus",
      "deviceErrorCount",
      "deviceErrors",
      "frameDriverState",
      "frameErrorCount",
      "lifecycleErrorCount",
      "routeLockRejectCount",
      "lastRouteLockResult",
      "lastFrameError",
      "lastLifecycleError",
    ], `${expected.routeId} runtime`);
    assert.equal(record.runtime.backend, "webgpu", `${expected.routeId} backend must be WebGPU`);
    assert.equal(record.runtime.nativeWebGPU, true, `${expected.routeId} must prove native WebGPU`);
    assert.equal(record.runtime.initialized, true, `${expected.routeId} renderer did not initialize`);
    assert.equal(record.runtime.firstFrameCompleted, true, `${expected.routeId} did not complete a frame`);
    assert(Number.isInteger(record.runtime.completedFrames) && record.runtime.completedFrames >= 1, `${expected.routeId} completed-frame count is invalid`);
    assert(Number.isInteger(record.runtime.renderSubmissions) && record.runtime.renderSubmissions >= 1, `${expected.routeId} render-submission count is invalid`);
    assert.equal(record.runtime.rendererType, "WebGPURenderer", `${expected.routeId} renderer identity drifted`);
    assert.equal(record.runtime.backendType, "WebGPUBackend", `${expected.routeId} backend identity drifted`);
    assert.equal(record.runtime.threeRevision, "185", `${expected.routeId} Three.js revision drifted`);
    assert.equal(record.runtime.runtimeProfile, "correctness", `${expected.routeId} runtime profile drifted`);
    assert(record.runtime.rendererBackendEvidence?.deviceIdentityVerified === true, `${expected.routeId} renderer device identity was not verified`);
    assert.equal(record.runtime.rendererBackendEvidence?.backendType, "WebGPUBackend", `${expected.routeId} renderer backend evidence drifted`);
    assert.equal(record.runtime.rendererDeviceGeneration, 1, `${expected.routeId} renderer device generation drifted`);
    assert.equal(record.runtime.deviceLossGeneration, 0, `${expected.routeId} device-loss generation drifted`);
    assert.equal(record.runtime.rendererDeviceStatus, "active", `${expected.routeId} renderer device was not active before disposal`);
    assert.equal(record.runtime.deviceErrorCount, 0, `${expected.routeId} renderer device errors were recorded`);
    assert.deepEqual(record.runtime.deviceErrors, [], `${expected.routeId} renderer device error inventory is nonempty`);
    assert.equal(record.runtime.frameDriverState, "idle", `${expected.routeId} capture-owned frame driver must remain idle before disposal`);
    assert.equal(record.runtime.frameErrorCount, 0, `${expected.routeId} recorded frame errors`);
    assert.equal(record.runtime.lifecycleErrorCount, 0, `${expected.routeId} recorded lifecycle errors`);
    assert.equal(record.runtime.routeLockRejectCount, expectedRejectCount, `${expected.routeId} route lock rejection count drifted`);
    assert.deepEqual(record.runtime.lastRouteLockResult, record.routeLock.controllerProbes.at(-1).result, `${expected.routeId} last route lock result drifted`);
    assert.equal(record.runtime.completedFrames, record.postProbeRender.after.completedFrames, `${expected.routeId} final completed-frame count drifted`);
    assert.equal(record.runtime.renderSubmissions, record.postProbeRender.after.renderSubmissions, `${expected.routeId} final render-submission count drifted`);
    assert.equal(record.runtime.lastFrameError, null, `${expected.routeId} recorded a frame error`);
    assert.equal(record.runtime.lastLifecycleError, null, `${expected.routeId} recorded a lifecycle error`);

    assertExactKeys(record.pipeline, ["descriptor", "digestAlgorithm", "digest"], `${expected.routeId} pipeline`);
    assertExactKeys(record.pipeline.descriptor, Object.keys(CORPUS_ROUTE_PIPELINE_DESCRIPTOR), `${expected.routeId} pipeline.descriptor`);
    assert.deepEqual(record.pipeline.descriptor, CORPUS_ROUTE_PIPELINE_DESCRIPTOR, `${expected.routeId} pipeline descriptor drifted`);
    assert.equal(record.pipeline.digestAlgorithm, "sha256", `${expected.routeId} pipeline digest algorithm drifted`);
    assertSha256(record.pipeline.digest, `${expected.routeId} pipeline digest`);
    assert.equal(
      record.pipeline.digest,
      computeCorpusRoutePipelineDigest(expected.routeId, record.pipeline.descriptor),
      `${expected.routeId} pipeline digest does not bind this route`,
    );

    assertExactKeys(record.readback, [
      "target",
      "captureSource",
      "backendKind",
      "nativeWebGPU",
      "width",
      "height",
      "format",
      "bytesPerPixel",
      "transportLayout",
      "requestedLayout",
      "normalizedArtifactLayout",
      "origin",
      "colorEncoding",
      "outputColorSpace",
      "transportSha256",
      "normalizedSha256",
      "artifacts",
      "digestAlgorithm",
      "digest",
    ], `${expected.routeId} readback`);
    assert.equal(record.readback.target, "presentation", `${expected.routeId} readback target drifted`);
    assert.equal(record.readback.captureSource, "native-webgpu-render-target-readback", `${expected.routeId} readback source drifted`);
    assert.equal(record.readback.backendKind, "webgpu", `${expected.routeId} readback backend drifted`);
    assert.equal(record.readback.nativeWebGPU, true, `${expected.routeId} readback did not prove native WebGPU`);
    assert(Number.isInteger(record.readback.width) && record.readback.width > 0, `${expected.routeId} readback width must be a positive integer`);
    assert(Number.isInteger(record.readback.height) && record.readback.height > 0, `${expected.routeId} readback height must be a positive integer`);
    assert.equal(record.readback.width, Math.floor(record.location.viewport.cssWidth * record.location.viewport.appliedDpr), `${expected.routeId} readback width is not viewport/DPR-bound`);
    assert.equal(record.readback.height, Math.floor(record.location.viewport.cssHeight * record.location.viewport.appliedDpr), `${expected.routeId} readback height is not viewport/DPR-bound`);
    assert.equal(record.readback.format, "rgba8unorm", `${expected.routeId} readback format drifted`);
    assert.equal(record.readback.bytesPerPixel, 4, `${expected.routeId} readback bytes-per-pixel drifted`);
    assertExactKeys(record.readback.transportLayout, ["bytesPerRow", "byteLength", "padding", "retained", "provenance"], `${expected.routeId} transportLayout`);
    assert(Number.isSafeInteger(record.readback.transportLayout.bytesPerRow) && record.readback.transportLayout.bytesPerRow >= record.readback.width * 4, `${expected.routeId} renderer transport row layout is invalid`);
    assert(Number.isSafeInteger(record.readback.transportLayout.byteLength) && record.readback.transportLayout.byteLength > 0, `${expected.routeId} renderer transport byte length is invalid`);
    assert(new Set(["compact", "webgpu-aligned-final-row-unpadded", "webgpu-aligned-fully-padded"]).has(record.readback.transportLayout.padding), `${expected.routeId} renderer transport padding mode drifted`);
    assert.equal(record.readback.transportLayout.retained, true, `${expected.routeId} renderer transport bytes must be retained`);
    assert.match(record.readback.transportLayout.provenance, /renderer\.readRenderTargetPixelsAsync/, `${expected.routeId} renderer transport provenance drifted`);
    assertExactKeys(record.readback.requestedLayout, ["alignmentBytes", "rowBytes", "alignedBytesPerRow", "minimumByteLength", "fullyPaddedByteLength", "provenance"], `${expected.routeId} requestedLayout`);
    assert.equal(record.readback.requestedLayout.alignmentBytes, 256, `${expected.routeId} requested alignment drifted`);
    assert.equal(record.readback.requestedLayout.rowBytes, record.readback.width * record.readback.bytesPerPixel, `${expected.routeId} compact row size drifted`);
    assert(Number.isSafeInteger(record.readback.requestedLayout.alignedBytesPerRow) && record.readback.requestedLayout.alignedBytesPerRow >= record.readback.requestedLayout.rowBytes, `${expected.routeId} requested aligned row size is invalid`);
    assert.equal(record.readback.requestedLayout.alignedBytesPerRow % 256, 0, `${expected.routeId} requested row size is not WebGPU-aligned`);
    assert.equal(record.readback.requestedLayout.minimumByteLength, record.readback.requestedLayout.alignedBytesPerRow * (record.readback.height - 1) + record.readback.requestedLayout.rowBytes, `${expected.routeId} requested minimum byte length drifted`);
    assert.equal(record.readback.requestedLayout.fullyPaddedByteLength, record.readback.requestedLayout.alignedBytesPerRow * record.readback.height, `${expected.routeId} requested full padding drifted`);
    const expectedTransportLayout = {
      compact: {
        bytesPerRow: record.readback.requestedLayout.rowBytes,
        byteLength: record.readback.requestedLayout.rowBytes * record.readback.height,
      },
      "webgpu-aligned-final-row-unpadded": {
        bytesPerRow: record.readback.requestedLayout.alignedBytesPerRow,
        byteLength: record.readback.requestedLayout.minimumByteLength,
      },
      "webgpu-aligned-fully-padded": {
        bytesPerRow: record.readback.requestedLayout.alignedBytesPerRow,
        byteLength: record.readback.requestedLayout.fullyPaddedByteLength,
      },
    }[record.readback.transportLayout.padding];
    assert.deepEqual(
      {
        bytesPerRow: record.readback.transportLayout.bytesPerRow,
        byteLength: record.readback.transportLayout.byteLength,
      },
      expectedTransportLayout,
      `${expected.routeId} renderer transport layout/padding disagreement`,
    );
    assertExactKeys(record.readback.normalizedArtifactLayout, [
      "bytesPerRow",
      "byteLength",
      "retained",
      "normalization",
      "paddingByteCount",
      "zeroPaddingByteCount",
      "independentAllocation",
      "provenance",
    ], `${expected.routeId} normalizedArtifactLayout`);
    assert.equal(record.readback.normalizedArtifactLayout.bytesPerRow, record.readback.requestedLayout.alignedBytesPerRow, `${expected.routeId} normalized artifact stride drifted`);
    assert.equal(record.readback.normalizedArtifactLayout.byteLength, record.readback.requestedLayout.fullyPaddedByteLength, `${expected.routeId} normalized artifact length drifted`);
    assert.equal(record.readback.normalizedArtifactLayout.retained, true, `${expected.routeId} normalized artifact must be retained`);
    assert(new Set(["identity", "cpu-row-padding"]).has(record.readback.normalizedArtifactLayout.normalization), `${expected.routeId} normalization mode drifted`);
    const expectedPaddingByteCount = record.readback.height
      * (record.readback.requestedLayout.alignedBytesPerRow - record.readback.requestedLayout.rowBytes);
    assert.equal(record.readback.normalizedArtifactLayout.paddingByteCount, expectedPaddingByteCount, `${expected.routeId} normalized padding byte count drifted`);
    assert.equal(record.readback.normalizedArtifactLayout.zeroPaddingByteCount, expectedPaddingByteCount, `${expected.routeId} normalized padding was not fully zero-filled`);
    assert.equal(record.readback.normalizedArtifactLayout.independentAllocation, true, `${expected.routeId} normalized artifact did not use an independent allocation`);
    assert.equal(record.readback.origin, "top-left", `${expected.routeId} readback origin drifted`);
    assert.equal(record.readback.colorEncoding, "srgb", `${expected.routeId} readback color encoding drifted`);
    assert.equal(record.readback.outputColorSpace, record.pipeline.descriptor.outputColorSpace, `${expected.routeId} readback/output color-space disagreement`);
    assertSha256(record.readback.transportSha256, `${expected.routeId} transport SHA-256`);
    assertSha256(record.readback.normalizedSha256, `${expected.routeId} normalized SHA-256`);
    if (expectedPaddingByteCount > 0
      || record.readback.transportLayout.byteLength !== record.readback.normalizedArtifactLayout.byteLength) {
      assert.notEqual(record.readback.transportSha256, record.readback.normalizedSha256, `${expected.routeId} distinct transport and normalized payloads must not share a hash`);
    }
    assertExactKeys(record.readback.artifacts, ["transport", "normalized"], `${expected.routeId} readback artifacts`);
    const artifactContracts = {
      transport: {
        path: corpusRouteReadbackArtifactPath(expected, "transport"),
        layout: "renderer-transport-rgba8unorm-top-left",
        byteLength: record.readback.transportLayout.byteLength,
        sha256: record.readback.transportSha256,
      },
      normalized: {
        path: corpusRouteReadbackArtifactPath(expected, "normalized"),
        layout: "cpu-normalized-zero-padded-rgba8unorm-top-left",
        byteLength: record.readback.normalizedArtifactLayout.byteLength,
        sha256: record.readback.normalizedSha256,
      },
    };
    const artifactViews = {};
    for (const [representation, contract] of Object.entries(artifactContracts)) {
      const artifact = record.readback.artifacts[representation];
      assertExactKeys(artifact, ["path", "sha256", "byteLength", "mediaType", "layout"], `${expected.routeId} ${representation} artifact`);
      assert.equal(artifact.path, contract.path, `${expected.routeId} ${representation} artifact path drifted`);
      assert.equal(artifact.mediaType, "application/octet-stream", `${expected.routeId} ${representation} artifact media type drifted`);
      assert.equal(artifact.layout, contract.layout, `${expected.routeId} ${representation} artifact layout drifted`);
      assert.equal(artifact.byteLength, contract.byteLength, `${expected.routeId} ${representation} artifact byte length drifted`);
      assert.equal(artifact.sha256, contract.sha256, `${expected.routeId} ${representation} artifact digest disagreement`);
      const artifactBytes = readArtifact(artifact, record);
      assert(ArrayBuffer.isView(artifactBytes), `${expected.routeId} readArtifact must return an ArrayBuffer view`);
      const artifactView = new Uint8Array(artifactBytes.buffer, artifactBytes.byteOffset, artifactBytes.byteLength);
      assert.equal(artifactView.byteLength, artifact.byteLength, `${expected.routeId} resolved ${representation} artifact byte length drifted`);
      assert.equal(sha256Bytes(artifactView), artifact.sha256, `${expected.routeId} resolved ${representation} artifact SHA-256 drifted`);
      artifactViews[representation] = artifactView;
    }
    assert.notEqual(record.readback.artifacts.transport.path, record.readback.artifacts.normalized.path, `${expected.routeId} transport and normalized artifact paths alias`);
    if (artifactViews.transport.buffer === artifactViews.normalized.buffer) {
      const transportStart = artifactViews.transport.byteOffset;
      const transportEnd = transportStart + artifactViews.transport.byteLength;
      const normalizedStart = artifactViews.normalized.byteOffset;
      const normalizedEnd = normalizedStart + artifactViews.normalized.byteLength;
      assert(
        transportEnd <= normalizedStart || normalizedEnd <= transportStart,
        `${expected.routeId} resolved transport and normalized artifact byte ranges alias`,
      );
    }
    for (let row = 0; row < record.readback.height; row += 1) {
      const transportRow = row * record.readback.transportLayout.bytesPerRow;
      const normalizedRow = row * record.readback.normalizedArtifactLayout.bytesPerRow;
      assert.deepEqual(
        artifactViews.normalized.subarray(normalizedRow, normalizedRow + record.readback.requestedLayout.rowBytes),
        artifactViews.transport.subarray(transportRow, transportRow + record.readback.requestedLayout.rowBytes),
        `${expected.routeId} normalized visible row ${row} drifted from renderer transport`,
      );
      assert(
        artifactViews.normalized
          .subarray(normalizedRow + record.readback.requestedLayout.rowBytes, normalizedRow + record.readback.normalizedArtifactLayout.bytesPerRow)
          .every((byte) => byte === 0),
        `${expected.routeId} normalized padding row ${row} contains nonzero bytes`,
      );
    }
    assert.equal(record.readback.digestAlgorithm, "sha256", `${expected.routeId} readback digest algorithm drifted`);
    assertSha256(record.readback.digest, `${expected.routeId} readback digest`);
    assert.equal(
      record.readback.digest,
      computeCorpusRouteReadbackDigest(expected.routeId, record.readback),
      `${expected.routeId} readback digest does not bind this route`,
    );

    assertExactKeys(record.errorChannels, [
      "pageErrors",
      "consoleErrors",
      "unhandledRejections",
      "requestFailures",
      "gpuErrors",
      "deviceLost",
    ], `${expected.routeId} errorChannels`);
    for (const [channel, observer] of Object.entries(CORPUS_ROUTE_ERROR_OBSERVERS)) {
      assertExactKeys(record.errorChannels[channel], ["observerInstalled", "activeFrom", "observerId", "events"], `${expected.routeId} ${channel}`);
      assert.equal(record.errorChannels[channel].observerInstalled, true, `${expected.routeId} ${channel} observer was not installed`);
      assert.equal(record.errorChannels[channel].activeFrom, observer.activeFrom, `${expected.routeId} ${channel} observer phase drifted`);
      assert.equal(record.errorChannels[channel].observerId, observer.observerId, `${expected.routeId} ${channel} observer provenance drifted`);
      assert.deepEqual(record.errorChannels[channel].events, [], `${expected.routeId} recorded ${channel}`);
    }
    assertExactKeys(record.errorChannels.deviceLost, ["monitorAttached", "activeFrom", "observerId", "event"], `${expected.routeId} deviceLost`);
    assert.equal(record.errorChannels.deviceLost.monitorAttached, true, `${expected.routeId} device-loss monitor was not attached`);
    assert.equal(record.errorChannels.deviceLost.activeFrom, "before-first-frame", `${expected.routeId} device-loss monitor phase drifted`);
    assert.equal(record.errorChannels.deviceLost.observerId, "gpu-device-lost", `${expected.routeId} device-loss monitor provenance drifted`);
    assert.equal(record.errorChannels.deviceLost.event, null, `${expected.routeId} recorded device loss`);
    assert.equal(record.labError, null, `${expected.routeId} published __LAB_ERROR__`);

    assertExactKeys(record.teardown, ["explicitDispose", "beforeDispose", "afterDispose", "postDisposeSettlingBarrier", "afterFrameReset"], `${expected.routeId} teardown`);
    assertExactKeys(record.teardown.explicitDispose, ["requested", "fulfilled", "returnValue"], `${expected.routeId} explicitDispose`);
    assert.equal(record.teardown.explicitDispose.requested, true, `${expected.routeId} explicit disposal was not requested`);
    assert.equal(record.teardown.explicitDispose.fulfilled, true, `${expected.routeId} explicit disposal did not fulfill`);
    assertExactKeys(record.teardown.explicitDispose.returnValue, ["listenersDetached", "controllerResult"], `${expected.routeId} explicitDispose.returnValue`);
    assert.equal(record.teardown.explicitDispose.returnValue.listenersDetached, true, `${expected.routeId} page listeners were not detached before disposal`);
    assertExactKeys(record.teardown.beforeDispose, ["errorChannels", "labError", "frameDriverState", "rendererDeviceStatus"], `${expected.routeId} beforeDispose`);
    assert.deepEqual(record.teardown.beforeDispose.errorChannels, record.errorChannels, `${expected.routeId} pre-disposal error snapshot drifted`);
    assert.equal(record.teardown.beforeDispose.labError, null, `${expected.routeId} pre-disposal lab error drifted`);
    assert.equal(record.teardown.beforeDispose.frameDriverState, "idle", `${expected.routeId} frame driver was not idle before disposal`);
    assert.equal(record.teardown.beforeDispose.rendererDeviceStatus, "active", `${expected.routeId} renderer device was not active before disposal`);
    assertExactKeys(record.teardown.afterDispose, [
      "errorChannels",
      "labError",
      "frameDriverState",
      "rendererDeviceStatus",
      "pendingControllerOperations",
      "acceptingControllerOperations",
      "frameErrorCount",
      "lifecycleErrorCount",
      "teardown",
    ], `${expected.routeId} afterDispose`);
    assert.equal(record.teardown.afterDispose.labError, null, `${expected.routeId} disposal published a lab error`);
    assert.equal(record.teardown.afterDispose.frameDriverState, "closed", `${expected.routeId} frame driver did not close`);
    assert.equal(record.teardown.afterDispose.pendingControllerOperations, 0, `${expected.routeId} retained pending controller operations`);
    assert.equal(record.teardown.afterDispose.acceptingControllerOperations, false, `${expected.routeId} accepted controller operations after disposal`);
    assert.equal(record.teardown.afterDispose.frameErrorCount, 0, `${expected.routeId} disposal recorded frame errors`);
    assert.equal(record.teardown.afterDispose.lifecycleErrorCount, 0, `${expected.routeId} disposal recorded lifecycle errors`);
    for (const [channel, observer] of Object.entries(CORPUS_ROUTE_ERROR_OBSERVERS)) {
      const value = record.teardown.afterDispose.errorChannels[channel];
      assertExactKeys(value, ["observerInstalled", "activeFrom", "observerId", "events"], `${expected.routeId} afterDispose.${channel}`);
      assert.equal(value.observerInstalled, true, `${expected.routeId} post-disposal ${channel} observer was not installed`);
      assert.equal(value.activeFrom, observer.activeFrom, `${expected.routeId} post-disposal ${channel} observer phase drifted`);
      assert.equal(value.observerId, observer.observerId, `${expected.routeId} post-disposal ${channel} observer ID drifted`);
      assert.deepEqual(value.events, [], `${expected.routeId} post-disposal ${channel} events were recorded`);
    }
    assert.equal(record.teardown.afterDispose.errorChannels.deviceLost?.event, null, `${expected.routeId} device loss occurred during disposal`);
    assertExactKeys(record.teardown.postDisposeSettlingBarrier, [
      "owner",
      "type",
      "requestedFrames",
      "observedFrames",
      "completed",
      "timestampsMonotonicMs",
    ], `${expected.routeId} postDisposeSettlingBarrier`);
    assert.equal(record.teardown.postDisposeSettlingBarrier.owner, "in-app-evidence-runner", `${expected.routeId} post-disposal barrier owner drifted`);
    assert.equal(record.teardown.postDisposeSettlingBarrier.type, "two-child-requestAnimationFrame-callbacks", `${expected.routeId} post-disposal barrier type drifted`);
    assert.equal(record.teardown.postDisposeSettlingBarrier.requestedFrames, 2, `${expected.routeId} post-disposal barrier request count drifted`);
    assert.equal(record.teardown.postDisposeSettlingBarrier.observedFrames, 2, `${expected.routeId} post-disposal barrier did not observe two frames`);
    assert.equal(record.teardown.postDisposeSettlingBarrier.completed, true, `${expected.routeId} post-disposal barrier did not complete`);
    assert(Array.isArray(record.teardown.postDisposeSettlingBarrier.timestampsMonotonicMs), `${expected.routeId} post-disposal barrier timestamps must be an array`);
    assert.equal(record.teardown.postDisposeSettlingBarrier.timestampsMonotonicMs.length, 2, `${expected.routeId} post-disposal barrier timestamp count drifted`);
    assert(
      record.teardown.postDisposeSettlingBarrier.timestampsMonotonicMs.every((value) => Number.isFinite(value) && value >= 0),
      `${expected.routeId} post-disposal barrier timestamps are invalid`,
    );
    assert(
      record.teardown.postDisposeSettlingBarrier.timestampsMonotonicMs[1]
        >= record.teardown.postDisposeSettlingBarrier.timestampsMonotonicMs[0],
      `${expected.routeId} post-disposal barrier timestamps are not monotonic`,
    );
    assertExactKeys(record.teardown.afterFrameReset, ["owner", "beforeHref", "afterHref", "loadObserved", "listenersRemoved", "iframeErrorEvents"], `${expected.routeId} afterFrameReset`);
    assert.equal(record.teardown.afterFrameReset.owner, "in-app-evidence-runner", `${expected.routeId} frame reset owner drifted`);
    assert.equal(record.teardown.afterFrameReset.beforeHref, expectedHref, `${expected.routeId} frame reset began from another route`);
    assert.equal(record.teardown.afterFrameReset.afterHref, "about:blank", `${expected.routeId} frame did not reset to about:blank`);
    assert.equal(record.teardown.afterFrameReset.loadObserved, true, `${expected.routeId} frame reset load was not observed`);
    assert.equal(record.teardown.afterFrameReset.listenersRemoved, true, `${expected.routeId} frame reset listeners were retained`);
    assert.deepEqual(record.teardown.afterFrameReset.iframeErrorEvents, [], `${expected.routeId} frame reset recorded iframe errors`);
  }
  return true;
}

const HTML_VOID_ELEMENTS = new Set([
  "area", "base", "br", "col", "embed", "hr", "img", "input", "link", "meta", "param", "source", "track", "wbr",
]);
const HTML_INERT_ELEMENTS = new Set(["template", "noscript"]);
const HTML_RAW_TEXT_ELEMENTS = new Set([
  "iframe", "noembed", "noframes", "noscript", "script", "style", "textarea", "title", "xmp",
]);

function findHtmlTagEnd(source, start, label) {
  let quote = null;
  for (let index = start; index < source.length; index += 1) {
    const character = source[index];
    if (quote !== null) {
      if (character === quote) quote = null;
      continue;
    }
    if (character === '"' || character === "'") quote = character;
    else if (character === ">") return index;
  }
  throw new Error(`${label} contains an unterminated HTML tag`);
}

function parseHtmlAttributes(source, start, end, label) {
  const attributes = new Map();
  let index = start;
  while (index < end) {
    while (index < end && /\s/.test(source[index])) index += 1;
    if (index >= end || source[index] === "/") break;
    const nameStart = index;
    while (index < end && !/[\s=/>]/.test(source[index])) index += 1;
    assert(index > nameStart, `${label} contains a malformed attribute`);
    const name = source.slice(nameStart, index).toLowerCase();
    assert(!attributes.has(name), `${label} contains duplicate ${name} attributes`);
    while (index < end && /\s/.test(source[index])) index += 1;
    let value = null;
    if (source[index] === "=") {
      index += 1;
      while (index < end && /\s/.test(source[index])) index += 1;
      assert(index < end, `${label} contains a missing ${name} value`);
      const quote = source[index];
      if (quote === '"' || quote === "'") {
        index += 1;
        const valueStart = index;
        while (index < end && source[index] !== quote) index += 1;
        assert(index < end, `${label} contains an unterminated ${name} value`);
        value = source.slice(valueStart, index);
        index += 1;
      } else {
        const valueStart = index;
        while (index < end && !/[\s>]/.test(source[index])) index += 1;
        assert(index > valueStart, `${label} contains an empty ${name} value`);
        value = source.slice(valueStart, index);
      }
    }
    attributes.set(name, value);
  }
  return attributes;
}

export function parseActiveHtmlElements(source, label = "HTML document") {
  const elements = [];
  const stack = [];
  let inertDepth = 0;
  let index = 0;
  while (index < source.length) {
    const tagStart = source.indexOf("<", index);
    if (tagStart < 0) break;
    if (source.startsWith("<!--", tagStart)) {
      const commentEnd = source.indexOf("-->", tagStart + 4);
      assert(commentEnd >= 0, `${label} contains an unterminated HTML comment`);
      index = commentEnd + 3;
      continue;
    }
    if (source[tagStart + 1] === "!" || source[tagStart + 1] === "?") {
      index = findHtmlTagEnd(source, tagStart + 2, label) + 1;
      continue;
    }
    const tagEnd = findHtmlTagEnd(source, tagStart + 1, label);
    let cursor = tagStart + 1;
    const closing = source[cursor] === "/";
    if (closing) cursor += 1;
    while (cursor < tagEnd && /\s/.test(source[cursor])) cursor += 1;
    const nameStart = cursor;
    while (cursor < tagEnd && /[A-Za-z0-9:-]/.test(source[cursor])) cursor += 1;
    assert(cursor > nameStart, `${label} contains a malformed HTML tag`);
    const name = source.slice(nameStart, cursor).toLowerCase();

    if (closing) {
      assert(stack.length > 0 && stack.at(-1).name === name, `${label} contains an unbalanced </${name}> tag`);
      const closed = stack.pop();
      if (closed.opensInertBoundary) inertDepth -= 1;
      index = tagEnd + 1;
      continue;
    }

    const attributes = parseHtmlAttributes(source, cursor, tagEnd, `${label} <${name}>`);
    const selfClosing = /\/\s*$/.test(source.slice(cursor, tagEnd));
    assert(!(selfClosing && !HTML_VOID_ELEMENTS.has(name)), `${label} uses browser-ignored self-closing syntax on non-void <${name}>`);
    assert.notEqual(name, "plaintext", `${label} contains unsupported browser raw-text <plaintext>`);
    const parentIsInert = inertDepth > 0;
    const opensInertBoundary = HTML_INERT_ELEMENTS.has(name);
    if (!parentIsInert && !opensInertBoundary) {
      elements.push(Object.freeze({ name, attributes, parentName: stack.at(-1)?.name ?? null, sourceIndex: tagStart }));
    }
    if (!selfClosing && !HTML_VOID_ELEMENTS.has(name)) {
      stack.push({ name, opensInertBoundary });
      if (opensInertBoundary) inertDepth += 1;
    }
    index = tagEnd + 1;
    if (HTML_RAW_TEXT_ELEMENTS.has(name) && !selfClosing) {
      const closingStart = source.toLowerCase().indexOf(`</${name}`, index);
      assert(closingStart >= 0, `${label} contains an unterminated <${name}> element`);
      index = closingStart;
    }
  }
  assert.equal(stack.length, 0, `${label} contains unclosed HTML elements`);
  return elements;
}

export function validateCanonicalIds(ids, label) {
  if (!Array.isArray(ids) || ids.length === 0) {
    throw new TypeError(`${label} must be a nonempty array`);
  }
  const seen = new Set();
  for (const id of ids) {
    if (typeof id !== "string" || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(id)) {
      throw new TypeError(`${label} contains invalid semantic ID "${id}"`);
    }
    if (seen.has(id)) throw new Error(`${label} contains duplicate semantic ID "${id}"`);
    seen.add(id);
  }
  return Object.freeze([...ids]);
}

export function validateRouteHtml(source, { kind, id } = {}) {
  if (typeof source !== "string" || source.length === 0) {
    throw new TypeError("route HTML must be a nonempty string");
  }
  validateCanonicalIds([kind], "route kind");
  validateCanonicalIds([id], `${kind} route ID`);
  assert.match(source, /^<!doctype html>/i, `${kind}/${id} must declare HTML5`);
  const elements = parseActiveHtmlElements(source, `${kind}/${id}`);
  const executableUrlAttributes = new Set(["action", "cite", "data", "formaction", "href", "longdesc", "manifest", "poster", "src", "xlink:href"]);
  for (const element of elements) {
    assert.equal(element.name === "style", false, `${kind}/${id} must not expose active inline <style> content`);
    for (const [attributeName, attributeValue] of element.attributes) {
      assert.equal(attributeName.startsWith("on"), false, `${kind}/${id} must not expose active inline event-handler attributes`);
      assert.notEqual(attributeName, "style", `${kind}/${id} must not expose active inline style attributes`);
      assert.notEqual(attributeName, "srcdoc", `${kind}/${id} must not expose executable iframe srcdoc content`);
      if (!executableUrlAttributes.has(attributeName) || typeof attributeValue !== "string") continue;
      assert.equal(attributeValue.includes("&"), false, `${kind}/${id} URL attributes must not use entity-obscured executable schemes`);
      const normalizedUrl = attributeValue.toLowerCase().replace(/[\u0000-\u0020\u007f]+/g, "");
      assert(!/^(?:javascript|vbscript|data):/.test(normalizedUrl), `${kind}/${id} must not expose executable URL schemes`);
    }
  }
  const htmlElements = elements.filter(({ name }) => name === "html");
  assert.equal(htmlElements.length, 1, `${kind}/${id} must expose exactly one active <html> element`);
  assert.equal(htmlElements[0].attributes.get("data-route-kind"), kind, `${kind}/${id} route kind metadata drifted`);
  assert.equal(htmlElements[0].attributes.get("data-route-id"), id, `${kind}/${id} route ID metadata drifted`);

  const styleLinks = elements.filter(({ name, attributes }) => (
    name === "link"
    && attributes.get("rel") === "stylesheet"
    && attributes.get("href") === "../../styles.css"
  ));
  assert.equal(styleLinks.length, 1, `${kind}/${id} must import one active ../../styles.css stylesheet`);

  const scripts = elements.filter(({ name }) => name === "script");
  const bootstrapScripts = scripts.filter(({ attributes }) => attributes.get("src") === "../../route-evidence-bootstrap.js");
  assert.equal(bootstrapScripts.length, 1, `${kind}/${id} must expose one active route-evidence bootstrap script`);
  assert.deepEqual([...bootstrapScripts[0].attributes.keys()].sort(), ["data-surface", "src"], `${kind}/${id} route-evidence bootstrap attributes drifted`);
  assert.equal(bootstrapScripts[0].attributes.get("data-surface"), "route", `${kind}/${id} bootstrap must be route-scoped`);
  assert.equal(bootstrapScripts[0].parentName, "head", `${kind}/${id} route-evidence bootstrap must be a direct <head> child`);
  const importMaps = scripts.filter(({ attributes }) => attributes.get("type") === "importmap");
  assert.equal(importMaps.length, 1, `${kind}/${id} must expose one import map for raw static modules`);
  assert.equal(importMaps[0].parentName, "head", `${kind}/${id} import map must be a direct <head> child`);
  for (const mapping of [
    '"three": "/node_modules/three/build/three.module.js"',
    '"three/webgpu": "/node_modules/three/build/three.webgpu.js"',
    '"three/tsl": "/node_modules/three/build/three.tsl.js"',
    '"three/addons/": "/node_modules/three/examples/jsm/"',
  ]) assert(source.includes(mapping), `${kind}/${id} import map omitted ${mapping}`);
  const appScripts = scripts.filter(({ attributes }) => attributes.get("src") === "../../app.js");
  assert.equal(appScripts.length, 1, `${kind}/${id} must expose exactly one active ../../app.js script tag`);
  assert.deepEqual([...appScripts[0].attributes.keys()].sort(), ["src", "type"], `${kind}/${id} app script attributes drifted`);
  assert.equal(appScripts[0].attributes.get("type"), "module", `${kind}/${id} ../../app.js script must itself be type=module`);
  assert.equal(appScripts[0].parentName, "body", `${kind}/${id} ../../app.js must be a direct <body> child`);
  assert.equal(scripts.length, 3, `${kind}/${id} active script inventory must contain only bootstrap, import map, and app`);
  assert.equal(scripts[0], bootstrapScripts[0], `${kind}/${id} route-evidence bootstrap must be the first active script`);
  assert.equal(scripts[1], importMaps[0], `${kind}/${id} import map must follow the observer bootstrap`);
  assert.equal(scripts[2], appScripts[0], `${kind}/${id} ../../app.js must be the third and final active script`);
  assert(bootstrapScripts[0].sourceIndex < appScripts[0].sourceIndex, `${kind}/${id} route-evidence bootstrap must execute before ../../app.js`);
  assert.equal(elements.filter(({ name }) => name === "base").length, 0, `${kind}/${id} must not redefine the route URL base`);
  const resourceAttributeByElement = {
    audio: "src",
    embed: "src",
    iframe: "src",
    img: "src",
    input: "src",
    link: "href",
    object: "data",
    script: "src",
    source: "src",
    track: "src",
    video: "src",
  };
  const resourceLoaders = elements.filter(({ name, attributes }) => {
    const attribute = resourceAttributeByElement[name];
    return attribute !== undefined && typeof attributes.get(attribute) === "string";
  });
  for (const loader of resourceLoaders) {
    if (loader === bootstrapScripts[0]) continue;
    assert(bootstrapScripts[0].sourceIndex < loader.sourceIndex, `${kind}/${id} route-evidence bootstrap must precede every active resource-loading element`);
  }

  const corpusIndexNodes = elements.filter(({ attributes }) => (
    (attributes.get("class") ?? "").split(/\s+/).includes("corpus-index")
  ));
  assert.equal(corpusIndexNodes.length, 1, `${kind}/${id} must expose one active corpus-index node`);
  const expectedTagById = {
    scene: "canvas",
    "subject-title": "h1",
    "subject-description": "p",
    status: "output",
    subject: "select",
    mode: "select",
    tier: "select",
    camera: "select",
    "mode-title": "strong",
    "mode-description": "span",
    "metric-nodes": "dd",
    "metric-triangles": "dd",
    "metric-draws": "dd",
    "metric-submissions": "dd",
    "metric-handoffs": "dd",
    "metric-physics-status": "dd",
    "metric-motion": "dd",
    "metric-dpr": "dd",
  };
  for (const domId of REQUIRED_ROUTE_DOM_IDS) {
    const matches = elements.filter(({ attributes }) => attributes.get("id") === domId);
    assert.equal(matches.length, 1, `${kind}/${id} must expose exactly one active #${domId}`);
    assert.equal(matches[0].name, expectedTagById[domId], `${kind}/${id} #${domId} element type drifted`);
  }
  assert.equal(source, renderCorpusRouteHtml(kind, id), `${kind}/${id} physical route bytes drifted from the canonical generator`);
  return true;
}

function manifestIds(entries, label) {
  if (!Array.isArray(entries)) throw new TypeError(`manifest ${label} must be an array`);
  const ids = entries.map((entry) => typeof entry === "string" ? entry : entry?.id);
  return validateCanonicalIds(ids, `manifest ${label}`);
}

export function validateManifestRoutes(manifest) {
  if (!manifest || typeof manifest !== "object" || Array.isArray(manifest)) {
    throw new TypeError("lab manifest must be an object");
  }
  const expectedByKind = new Map(CANONICAL_ROUTE_DIMENSIONS.map(({ kind, ids }) => [kind, [...ids]]));
  for (const { kind } of CANONICAL_ROUTE_DIMENSIONS) {
    const field = kind === "scenario" ? "scenarios" : `${kind}s`;
    const ids = manifestIds(manifest[field], field);
    assert.deepEqual(ids, expectedByKind.get(kind), `manifest ${field} must match canonical ordered IDs`);
    for (const entry of manifest[field]) {
      if (typeof entry !== "object" || entry === null || entry.route === undefined) continue;
      assert.equal(entry.route, `${kind}/${entry.id}/`, `manifest ${kind}/${entry.id} physical route drifted`);
    }
  }
  if (manifest.modes !== undefined) {
    assert.deepEqual(manifestIds(manifest.modes, "modes"), [...SCULPT_MODES], "manifest modes must match canonical mechanisms");
  }
  for (const tier of manifest.tiers) {
    assert.equal(
      tier.resolutionPolicy?.dprCap,
      CORPUS_DPR_CAPS[tier.id],
      `manifest ${tier.id} DPR cap must match the runtime policy`,
    );
  }
  if (manifest.physicalRouteContract !== undefined) {
    const dimensions = Object.fromEntries(CANONICAL_ROUTE_DIMENSIONS.map(({ kind, ids }) => [kind, ids.length]));
    assert.deepEqual(manifest.physicalRouteContract.dimensions, dimensions, "manifest physical route dimensions drifted");
    assert.equal(
      manifest.physicalRouteContract.routeCount,
      CANONICAL_ROUTE_DIMENSIONS.reduce((sum, { ids }) => sum + ids.length, 0),
      "manifest physical route count drifted",
    );
  }
  if (manifest.renderArchitecture !== undefined) {
    assert.equal(manifest.renderArchitecture.sceneRendersPerFrame, CORPUS_RENDER_POLICY.sceneRendersPerFrame, "manifest scene-render ownership drifted");
    assert.equal(manifest.renderArchitecture.postProcessingPasses, CORPUS_RENDER_POLICY.postprocessing ? 1 : 0, "manifest post-processing policy drifted");
  }
  return true;
}

function validatePhysicalRouteLock(kind, id) {
  const route = corpusRouteFromLocation({ pathname: `/demos/webgpu-object-sculptor-corpus/${kind}/${id}/`, search: "" });
  for (const { kind: candidate } of CANONICAL_ROUTE_DIMENSIONS) {
    assert.equal(route[candidate], candidate === kind ? id : null, `${kind}/${id} did not lock exactly one route dimension`);
  }
}

export function validateCorpusRoutes({ directory = here, manifestPath = resolve(directory, "lab.manifest.json") } = {}) {
  assert.deepEqual([...CORPUS_ROUTE_SCENARIO_IDS], [...SCULPT_TARGET_IDS], "runner scenario order drifted from runtime targets");
  assert.deepEqual([...CORPUS_ROUTE_MECHANISM_IDS], [...SCULPT_MODES], "runner mechanism order drifted from runtime modes");
  assert.deepEqual([...CORPUS_ROUTE_TIER_IDS], [...SCULPT_TIERS], "runner tier order drifted from runtime tiers");
  assert.deepEqual([...CORPUS_ROUTE_CAMERA_IDS], [...CORPUS_CAMERAS], "runner camera order drifted from runtime cameras");
  const records = [];
  const routeIds = [];
  for (const { kind, ids } of CANONICAL_ROUTE_DIMENSIONS) {
    validateCanonicalIds([...ids], `${kind} canonical IDs`);
    for (const id of ids) {
      routeIds.push(`${kind}:${id}`);
      const path = resolve(directory, kind, id, "index.html");
      assert(existsSync(path), `missing physical ${kind} route ${id}`);
      validateRouteHtml(readFileSync(path, "utf8"), { kind, id });
      validatePhysicalRouteLock(kind, id);
      records.push(Object.freeze({ kind, id, path }));
    }
  }
  validateCanonicalIds(routeIds.map((value) => value.replace(":", "-")), "physical route semantic IDs");

  let manifestChecked = false;
  if (existsSync(manifestPath)) {
    validateManifestRoutes(JSON.parse(readFileSync(manifestPath, "utf8")));
    manifestChecked = true;
  }

  return Object.freeze({
    ok: true,
    physicalRoutes: records.length,
    physicalRouteIds: Object.freeze(CORPUS_PHYSICAL_ROUTE_PLAN.map(({ routeId }) => routeId)),
    dimensions: Object.freeze(Object.fromEntries(CANONICAL_ROUTE_DIMENSIONS.map(({ kind, ids }) => [kind, ids.length]))),
    manifestChecked,
    requiredDomIds: REQUIRED_ROUTE_DOM_IDS.length,
  });
}

function isMainModule() {
  return Boolean(process.argv[1])
    && import.meta.url === pathToFileURL(resolve(process.argv[1])).href;
}

if (isMainModule()) {
  try {
    console.log(JSON.stringify(validateCorpusRoutes(), null, 2));
  } catch (error) {
    console.error(error.stack ?? error.message);
    process.exitCode = 1;
  }
}
