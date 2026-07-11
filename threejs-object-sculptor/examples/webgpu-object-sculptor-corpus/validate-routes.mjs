import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { SCULPT_MODES, SCULPT_TIERS } from "../shared/sculpt-runtime.js";
import { CORPUS_DPR_CAPS, CORPUS_RENDER_POLICY } from "./lab-controller.js";
import { SCULPT_TARGET_IDS } from "./object-catalog.js";
import {
  CORPUS_CAMERAS,
  corpusRouteFromLocation,
  resolveCorpusInitialState,
} from "./route-state.js";

const here = dirname(fileURLToPath(import.meta.url));

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

const RUNTIME_ROUTE_DIMENSIONS = Object.freeze({
  scenario: Object.freeze({ selectorId: "subject", stateKey: "scenario", controllerMethods: Object.freeze(["setSubject", "setScenario"]), values: SCULPT_TARGET_IDS }),
  mechanism: Object.freeze({ selectorId: "mode", stateKey: "mechanism", controllerMethods: Object.freeze(["setMode"]), values: SCULPT_MODES }),
  tier: Object.freeze({ selectorId: "tier", stateKey: "tier", controllerMethods: Object.freeze(["setTier"]), values: SCULPT_TIERS }),
  camera: Object.freeze({ selectorId: "camera", stateKey: "camera", controllerMethods: Object.freeze(["setCamera"]), values: CORPUS_CAMERAS }),
});

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

export function validatePhysicalRouteRuntimeRecords(records) {
  assert(Array.isArray(records), "physical route runtime records must be an array");
  assert.equal(records.length, CORPUS_PHYSICAL_ROUTE_PLAN.length, "physical route runtime record count drifted");
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
      "location",
      "documentRoute",
      "selectors",
      "baselineState",
      "routeLock",
      "firstFrame",
      "postProbeRender",
      "runtime",
      "errorChannels",
      "labError",
    ], `physical route runtime record ${index}`);
    assert.equal(record.routeId, expected.routeId, `${expected.routeId} runtime route ID drifted`);
    assert.equal(record.kind, expected.kind, `${expected.routeId} runtime kind drifted`);
    assert.equal(record.id, expected.id, `${expected.routeId} runtime value drifted`);
    assert.equal(record.urlPath, expected.urlPath, `${expected.routeId} runtime URL path drifted`);

    assertExactKeys(record.location, [
      "requestedPathname",
      "finalPathname",
      "search",
      "responseStatus",
      "observersInstalledBeforeNavigation",
    ], `${expected.routeId} location`);
    assert.equal(record.location.requestedPathname, record.location.finalPathname, `${expected.routeId} redirected away from its physical route`);
    assert(record.location.finalPathname.endsWith(`/${expected.urlPath}`), `${expected.routeId} final pathname drifted`);
    assert.equal(record.location.search, "?capture=1", `${expected.routeId} route evidence must use exclusive capture ownership`);
    assert.equal(record.location.responseStatus, 200, `${expected.routeId} route response did not succeed`);
    assert.equal(record.location.observersInstalledBeforeNavigation, true, `${expected.routeId} error observers were installed too late`);

    assertExactKeys(record.documentRoute, ["kind", "id"], `${expected.routeId} documentRoute`);
    assert.equal(record.documentRoute.kind, expected.kind, `${expected.routeId} document route kind drifted`);
    assert.equal(record.documentRoute.id, expected.id, `${expected.routeId} document route ID drifted`);
    validateRouteStateSnapshot(record.baselineState, baselineState, `${expected.routeId} baselineState`);

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
      const current = baselineState[spec.stateKey === "mechanism" ? "mode" : spec.stateKey === "scenario" ? "subjectId" : spec.stateKey];
      const probe = record.routeLock.unlockedProbes[probeIndex];
      const label = `${expected.routeId} unlockedProbes[${probeIndex}]`;
      assertExactKeys(probe, ["selectorId", "attemptedValue", "changeResult", "restoreResult", "finalState"], label);
      assert.equal(probe.selectorId, spec.selectorId, `${label} selector drifted`);
      assert.equal(probe.attemptedValue, alternateValue(dimension, current), `${label} alternate value drifted`);
      assert.equal(probe.changeResult, true, `${label} unlocked change was blocked`);
      assert.equal(probe.restoreResult, true, `${label} unlocked restore failed`);
      validateRouteStateSnapshot(probe.finalState, baselineState, `${label}.finalState`);
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
    assert.equal(record.postProbeRender.before.firstFrameCompleted, true, `${expected.routeId} post-probe render baseline drifted`);
    assert.equal(record.postProbeRender.after.firstFrameCompleted, true, `${expected.routeId} post-probe render completion drifted`);
    assert.equal(record.postProbeRender.after.completedFrames, record.postProbeRender.before.completedFrames + 1, `${expected.routeId} post-probe completed-frame delta drifted`);
    assert.equal(record.postProbeRender.after.renderSubmissions, record.postProbeRender.before.renderSubmissions + 1, `${expected.routeId} post-probe submission delta drifted`);

    assertExactKeys(record.runtime, [
      "backend",
      "nativeWebGPU",
      "initialized",
      "firstFrameCompleted",
      "completedFrames",
      "renderSubmissions",
      "rendererType",
      "backendType",
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
    assert.equal(record.runtime.frameErrorCount, 0, `${expected.routeId} recorded frame errors`);
    assert.equal(record.runtime.lifecycleErrorCount, 0, `${expected.routeId} recorded lifecycle errors`);
    assert.equal(record.runtime.routeLockRejectCount, expectedRejectCount, `${expected.routeId} route lock rejection count drifted`);
    assert.deepEqual(record.runtime.lastRouteLockResult, record.routeLock.controllerProbes.at(-1).result, `${expected.routeId} last route lock result drifted`);
    assert.equal(record.runtime.completedFrames, record.postProbeRender.after.completedFrames, `${expected.routeId} final completed-frame count drifted`);
    assert.equal(record.runtime.renderSubmissions, record.postProbeRender.after.renderSubmissions, `${expected.routeId} final render-submission count drifted`);
    assert.equal(record.runtime.lastFrameError, null, `${expected.routeId} recorded a frame error`);
    assert.equal(record.runtime.lastLifecycleError, null, `${expected.routeId} recorded a lifecycle error`);

    assertExactKeys(record.errorChannels, [
      "pageErrors",
      "consoleErrors",
      "unhandledRejections",
      "requestFailures",
      "gpuErrors",
      "deviceLost",
    ], `${expected.routeId} errorChannels`);
    for (const channel of ["pageErrors", "consoleErrors", "unhandledRejections", "requestFailures", "gpuErrors"]) {
      assertExactKeys(record.errorChannels[channel], ["observerInstalled", "events"], `${expected.routeId} ${channel}`);
      assert.equal(record.errorChannels[channel].observerInstalled, true, `${expected.routeId} ${channel} observer was not installed`);
      assert.deepEqual(record.errorChannels[channel].events, [], `${expected.routeId} recorded ${channel}`);
    }
    assertExactKeys(record.errorChannels.deviceLost, ["monitorAttached", "event"], `${expected.routeId} deviceLost`);
    assert.equal(record.errorChannels.deviceLost.monitorAttached, true, `${expected.routeId} device-loss monitor was not attached`);
    assert.equal(record.errorChannels.deviceLost.event, null, `${expected.routeId} recorded device loss`);
    assert.equal(record.labError, null, `${expected.routeId} published __LAB_ERROR__`);
  }
  return true;
}

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function attributeCount(source, name, value) {
  const pattern = new RegExp(`\\b${escapeRegExp(name)}\\s*=\\s*["']${escapeRegExp(value)}["']`, "g");
  return [...source.matchAll(pattern)].length;
}

function classTokenCount(source, token) {
  const pattern = /\bclass\s*=\s*["']([^"']*)["']/g;
  let count = 0;
  for (const match of source.matchAll(pattern)) {
    if (match[1].split(/\s+/).includes(token)) count += 1;
  }
  return count;
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
  assert.equal(attributeCount(source, "data-route-kind", kind), 1, `${kind}/${id} route kind metadata drifted`);
  assert.equal(attributeCount(source, "data-route-id", id), 1, `${kind}/${id} route ID metadata drifted`);
  assert.match(source, /<link\b[^>]*href=["']\.\.\/\.\.\/styles\.css["'][^>]*>/, `${kind}/${id} must import ../../styles.css`);
  assert.match(source, /<script\b[^>]*src=["']\.\.\/\.\.\/app\.js["'][^>]*>\s*<\/script>/, `${kind}/${id} must import ../../app.js`);
  assert.match(source, /<script\b[^>]*type=["']module["'][^>]*>/, `${kind}/${id} app import must be a module`);
  assert.equal(classTokenCount(source, "corpus-index"), 1, `${kind}/${id} must expose one corpus-index node`);
  for (const domId of REQUIRED_ROUTE_DOM_IDS) {
    assert.equal(attributeCount(source, "id", domId), 1, `${kind}/${id} must expose exactly one #${domId}`);
  }
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
