import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { corpusRouteFromLocation, resolveCorpusInitialState } from "./route-state.js";
import {
  CORPUS_PHYSICAL_ROUTE_PLAN,
  validateCanonicalIds,
  validateManifestRoutes,
  validatePhysicalRouteRuntimeRecords,
  validateRouteHtml,
} from "./validate-routes.mjs";

const routeSource = readFileSync(new URL("./scenario/potted-bonsai/index.html", import.meta.url), "utf8");
validateRouteHtml(routeSource, { kind: "scenario", id: "potted-bonsai" });

assert.throws(
  () => corpusRouteFromLocation({ search: "?scenario=unknown-sculpt" }),
  /Unknown sculpt target/,
  "unknown scenario routes must fail closed",
);

const routeRuntimeRecords = CORPUS_PHYSICAL_ROUTE_PLAN.map((route) => {
  const state = resolveCorpusInitialState({ scenario: null, mechanism: null, tier: null, camera: null, [route.kind]: route.id });
  const baselineState = { subjectId: state.scenario, scenario: state.scenario, mode: state.mechanism, tier: state.tier, camera: state.camera, seed: 1, time: 0 };
  const dimensions = {
    scenario: { selectorId: "subject", stateField: "subjectId", methods: ["setSubject", "setScenario"], values: ["articulated-desk-lamp", "potted-bonsai", "ceramic-teapot"] },
    mechanism: { selectorId: "mode", stateField: "mode", methods: ["setMode"], values: ["final", "blockout", "hierarchy", "materials", "action-ready"] },
    tier: { selectorId: "tier", stateField: "tier", methods: ["setTier"], values: ["full", "budgeted", "minimum"] },
    camera: { selectorId: "camera", stateField: "camera", methods: ["setCamera"], values: ["design", "profile", "attachment", "close-material"] },
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
      unlockedProbes: Object.entries(dimensions).filter(([dimensionId]) => dimensionId !== route.kind).map(([, spec]) => ({
        selectorId: spec.selectorId,
        attemptedValue: spec.values.find((value) => value !== baselineState[spec.stateField]),
        changeResult: true,
        restoreResult: true,
        finalState: baselineState,
      })),
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
validatePhysicalRouteRuntimeRecords(routeRuntimeRecords);

const missingRouteRuntime = structuredClone(routeRuntimeRecords);
missingRouteRuntime.pop();
assert.throws(
  () => validatePhysicalRouteRuntimeRecords(missingRouteRuntime),
  /record count drifted/,
  "runtime route evidence must cover all 15 physical URLs",
);

const unlockedRouteRuntime = structuredClone(routeRuntimeRecords);
unlockedRouteRuntime[0].selectors[0].disabled = false;
assert.throws(
  () => validatePhysicalRouteRuntimeRecords(unlockedRouteRuntime),
  /lock state drifted|disable exactly one selector/,
  "runtime route evidence must prove the routed selector is disabled",
);

const fakeBackendRuntime = structuredClone(routeRuntimeRecords);
fakeBackendRuntime[0].runtime.backendType = "NotWebGPUBackend";
assert.throws(
  () => validatePhysicalRouteRuntimeRecords(fakeBackendRuntime),
  /backend identity drifted/,
  "runtime route evidence must not accept a substring backend spoof",
);
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
  /exactly one #status/,
  "the production DOM validator must reject a missing required control",
);

const duplicateMetric = routeSource.replace(
  '<dd id="metric-nodes">—</dd>',
  '<dd id="metric-nodes">—</dd><dd id="metric-nodes">duplicate</dd>',
);
assert.throws(
  () => validateRouteHtml(duplicateMetric, { kind: "scenario", id: "potted-bonsai" }),
  /exactly one #metric-nodes/,
  "the production DOM validator must reject duplicate semantic DOM IDs",
);

const wrongLockMetadata = routeSource.replace('data-route-id="potted-bonsai"', 'data-route-id="ceramic-teapot"');
assert.throws(
  () => validateRouteHtml(wrongLockMetadata, { kind: "scenario", id: "potted-bonsai" }),
  /route ID metadata drifted/,
  "physical route metadata must not claim another subject",
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
    "duplicate-component-semantic-id",
    "duplicate-manifest-target-id",
    "missing-runtime-route-record",
    "unlocked-runtime-route-selector",
    "spoofed-runtime-route-backend",
  ],
}, null, 2));
