import { canonicalSha256 } from './evidence-manifest-contract.mjs';

const SHA256 = /^sha256:[a-f0-9]{64}$/;
const CLAIM_VERDICTS = new Set([ 'PASS', 'FAIL', 'INSUFFICIENT_EVIDENCE', 'NOT_CLAIMED' ]);
const PHYSICAL_INPUT_METHODS = new Set([
  'user-facing-control',
  'public-controller-read',
  'public-controller-call',
  'direct-visual-inspection',
]);

function requireObject(value, label) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new TypeError(`${label} must be an object`);
  }
  return value;
}

function requireArray(value, label) {
  if (!Array.isArray(value)) throw new TypeError(`${label} must be an array`);
  return value;
}

function requireString(value, label) {
  if (typeof value !== 'string' || value.length === 0) {
    throw new TypeError(`${label} must be a non-empty string`);
  }
  return value;
}

function requireHash(value, label) {
  if (!SHA256.test(value ?? '')) throw new TypeError(`${label} must be a SHA-256 digest`);
  return value;
}

function requireMeasuredDatum(value, label, unit) {
  requireObject(value, label);
  if (!Number.isFinite(value.value) || value.value <= 0) throw new TypeError(`${label}.value must be positive and finite`);
  if (value.unit !== unit || value.label !== 'Measured' || typeof value.source !== 'string' || value.source.length === 0) {
    throw new TypeError(`${label} must be measured in ${unit}`);
  }
}

function assertInterval(startedAt, finishedAt) {
  const start = Date.parse(startedAt);
  const finish = Date.parse(finishedAt);
  if (!Number.isFinite(start) || !Number.isFinite(finish) || finish < start) {
    throw new TypeError('physical review interval is invalid');
  }
}

function assertErrors(errors) {
  requireObject(errors, 'errors');
  for (const channel of [ 'page', 'console', 'request', 'device', 'postDisposal' ]) {
    if (requireArray(errors[channel], `errors.${channel}`).length > 0) {
      throw new Error(`physical review contains ${channel} errors`);
    }
  }
}

export function validatePhysicalReviewRecord(record, options = {}) {
  requireObject(record, 'physical review record');
  if (record.schemaVersion !== 1 || record.recordKind !== 'lab-physical-route-review-v1') {
    throw new Error('physical review schema identity is invalid');
  }
  requireString(record.labId, 'labId');
  const allowedPhysicalSurfaces = new Set(['codex-in-app-browser', 'playwright-cdp-chrome']);
  if (record.profile !== 'physical-route' || !allowedPhysicalSurfaces.has(record.automationSurface)) {
    throw new Error('physical review must come from Codex in-app Browser or CDP-attached Chrome physical-route lane');
  }
  if (record.publishable !== false) throw new Error('raw physical reviews are nonpublishable promotion inputs');
  requireHash(record.sourceClosureHash, 'sourceClosureHash');
  requireHash(record.buildRevision, 'buildRevision');
  if (record.threeRevision !== '0.185.1') throw new Error('physical review must use Three.js 0.185.1');
  assertInterval(record.startedAt, record.finishedAt);

  const build = requireObject(record.immutableBuild, 'immutableBuild');
  if (build.immutable !== true || build.viteDevelopmentServer !== false || build.transformAtServe !== false) {
    throw new Error('physical review requires immutable prebuilt bytes without development transforms');
  }
  for (const key of [ 'bundleHash', 'servedLedgerHash' ]) requireHash(build[key], `immutableBuild.${key}`);
  if (build.sourceClosureHash !== record.sourceClosureHash
    || build.buildRevision !== record.buildRevision
    || build.threeRevision !== record.threeRevision) {
    throw new Error('immutable build identity differs from the physical review identity');
  }

  const browser = requireObject(record.browser, 'browser');
  if (browser.webdriver !== false || browser.headless !== false || browser.visibilityState !== 'visible') {
    throw new Error('physical review requires a visible non-WebDriver browser');
  }
  requireString(browser.userAgent, 'browser.userAgent');
  requireString(browser.platform, 'browser.platform');

  const adapter = requireObject(record.adapter, 'adapter');
  if (adapter.adapterClass !== 'hardware' || Object.keys(requireObject(adapter.identity, 'adapter.identity')).length === 0) {
    throw new Error('physical review requires a named hardware adapter');
  }

  const route = requireObject(record.route, 'route');
  requireString(route.path, 'route.path');
  requireString(route.finalUrl, 'route.finalUrl');
  let finalUrl;
  try {
    finalUrl = new URL(route.finalUrl);
  } catch {
    throw new Error('physical route finalUrl must be an absolute URL');
  }
  if (route.controllerReady !== true || finalUrl.pathname !== route.path) {
    throw new Error('physical route did not reach its exact ready URL');
  }
  if (canonicalSha256(requireObject(route.lockedState, 'route.lockedState'))
    !== canonicalSha256(requireObject(route.observedState, 'route.observedState'))) {
    throw new Error('physical route state differs from its immutable lock');
  }

  const viewport = requireObject(record.viewport, 'viewport');
  requireMeasuredDatum(viewport.width, 'viewport.width', 'pixel');
  requireMeasuredDatum(viewport.height, 'viewport.height', 'pixel');
  requireMeasuredDatum(viewport.dpr, 'viewport.dpr', 'ratio');

  const runtime = requireObject(record.runtime, 'runtime');
  const backend = requireObject(runtime.backend, 'runtime.backend');
  if (runtime.initialized !== true || runtime.nativeWebGPU !== true
    || backend.isWebGPUBackend !== true || backend.deviceIdentityVerified !== true) {
    throw new Error('physical review lacks initialized native WebGPU device proof');
  }
  assertErrors(record.errors);

  const checks = requireArray(record.checks, 'checks');
  if (checks.length === 0) throw new Error('physical review has no interaction checks');
  const checkIds = new Set();
  for (const [index, check] of checks.entries()) {
    requireObject(check, `checks[${index}]`);
    const id = requireString(check.id, `checks[${index}].id`);
    if (checkIds.has(id)) throw new Error(`physical review duplicates check ${id}`);
    checkIds.add(id);
    if (!PHYSICAL_INPUT_METHODS.has(check.inputMethod)) {
      throw new Error(`physical review check ${id} uses an unsupported input method`);
    }
    if (check.verdict !== 'PASS') throw new Error(`physical review check ${id} did not pass`);
    if (!Object.hasOwn(check, 'expected') || !Object.hasOwn(check, 'observed')) {
      throw new Error(`physical review check ${id} omits expected or observed state`);
    }
  }
  for (const required of options.requiredChecks ?? []) {
    if (!checkIds.has(required)) throw new Error(`physical review omits required check ${required}`);
  }

  const review = requireObject(record.review, 'review');
  if (review.verdict !== 'PASS' || review.canvasVisible !== true
    || review.controlsObstructCanvas !== false || review.rawMetricsCollapsedByDefault !== true) {
    throw new Error('physical visual review did not pass unobstructed-canvas requirements');
  }
  if (requireArray(review.inspectedModes, 'review.inspectedModes').length < 2) {
    throw new Error('physical visual review must inspect at least two real output modes');
  }
  if (requireArray(review.notes, 'review.notes').length === 0) {
    throw new Error('physical visual review requires authored reviewer notes');
  }

  const claimVerdicts = requireObject(record.claimVerdicts, 'claimVerdicts');
  for (const [claim, verdict] of Object.entries(claimVerdicts)) {
    if (!CLAIM_VERDICTS.has(verdict)) throw new Error(`physical review claim ${claim} has invalid verdict ${verdict}`);
  }
  if (claimVerdicts.visualCorrectness !== 'PASS') throw new Error('physical review must carry a passing visual-correctness verdict');
  if (claimVerdicts.performanceCompliance !== 'NOT_CLAIMED' || claimVerdicts.gpuTiming !== 'NOT_CLAIMED') {
    throw new Error('physical-route review cannot claim performance or GPU timing');
  }
  requireArray(record.limitations, 'limitations');
  return Object.freeze({
    valid: true,
    labId: record.labId,
    profile: record.profile,
    checkCount: checks.length,
    sourceClosureHash: record.sourceClosureHash,
    buildRevision: record.buildRevision,
  });
}

export function finalizePhysicalReviewRecord(record, options = {}) {
  const validation = validatePhysicalReviewRecord(record, options);
  return Object.freeze({
    record,
    validation,
    recordSha256: canonicalSha256(record),
  });
}
