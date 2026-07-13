import assert from 'node:assert/strict';
import { test } from 'node:test';

import { numericDatum, NumericLabel } from '../../labs/runtime/numeric-evidence.mjs';
import { canonicalSha256 } from '../../scripts/lib/evidence-manifest-contract.mjs';
import {
  finalizePhysicalReviewRecord,
  validatePhysicalReviewRecord,
} from '../../scripts/lib/physical-review-record.mjs';

const hash = (value) => canonicalSha256(value);

function fixture() {
  const state = { scenario: 'touch-history-frost', mechanism: 'refraction-and-fresnel', mode: 'final', tier: 'balanced' };
  return {
    schemaVersion: 1,
    recordKind: 'lab-physical-route-review-v1',
    labId: 'webgpu-touch-history-frost',
    profile: 'physical-route',
    automationSurface: 'codex-in-app-browser',
    publishable: false,
    sourceClosureHash: hash('source'),
    buildRevision: hash('build'),
    threeRevision: '0.185.1',
    startedAt: '2026-07-13T03:00:00.000Z',
    finishedAt: '2026-07-13T03:04:00.000Z',
    immutableBuild: {
      immutable: true,
      viteDevelopmentServer: false,
      transformAtServe: false,
      sourceClosureHash: hash('source'),
      buildRevision: hash('build'),
      threeRevision: '0.185.1',
      bundleHash: hash('bundle'),
      servedLedgerHash: hash('served-ledger'),
    },
    browser: {
      webdriver: false,
      headless: false,
      visibilityState: 'visible',
      userAgent: 'Codex in-app Browser fixture',
      platform: 'macOS',
    },
    adapter: { adapterClass: 'hardware', identity: { architecture: 'Apple GPU' } },
    route: {
      path: '/demos/webgpu-touch-history-frost/',
      finalUrl: 'https://threejs-skills.com/demos/webgpu-touch-history-frost/',
      controllerReady: true,
      lockedState: state,
      observedState: structuredClone(state),
    },
    viewport: {
      width: numericDatum(1280, 'pixel', NumericLabel.MEASURED, 'visible browser viewport'),
      height: numericDatum(720, 'pixel', NumericLabel.MEASURED, 'visible browser viewport'),
      dpr: numericDatum(2, 'ratio', NumericLabel.MEASURED, 'visible browser devicePixelRatio'),
    },
    runtime: {
      initialized: true,
      nativeWebGPU: true,
      backend: { isWebGPUBackend: true, deviceIdentityVerified: true },
    },
    errors: { page: [], console: [], request: [], device: [], postDisposal: [] },
    checks: [
      { id: 'ready', inputMethod: 'public-controller-read', expected: true, observed: true, verdict: 'PASS' },
      { id: 'review-trace', inputMethod: 'public-controller-call', expected: 1, observed: 1, verdict: 'PASS' },
      { id: 'diagnostic-control', inputMethod: 'user-facing-control', expected: 'frost-mask-after-pointer', observed: 'frost-mask-after-pointer', verdict: 'PASS' },
      { id: 'canvas-review', inputMethod: 'direct-visual-inspection', expected: 'legible scene', observed: 'legible scene', verdict: 'PASS' },
    ],
    review: {
      verdict: 'PASS',
      canvasVisible: true,
      controlsObstructCanvas: false,
      rawMetricsCollapsedByDefault: true,
      inspectedModes: [ 'final', 'frost-mask-after-pointer' ],
      notes: [ 'Final output remained legible with the metrics drawer collapsed.' ],
    },
    claimVerdicts: {
      visualCorrectness: 'PASS',
      performanceCompliance: 'NOT_CLAIMED',
      gpuTiming: 'NOT_CLAIMED',
    },
    limitations: [ 'Mobile viewport was not physically reviewed in this session.' ],
  };
}

test('physical review finalizer binds an immutable visible native-WebGPU session', () => {
  const record = fixture();
  const finalized = finalizePhysicalReviewRecord(record, { requiredChecks: [ 'ready', 'diagnostic-control', 'canvas-review' ] });
  assert.equal(finalized.validation.valid, true);
  assert.equal(finalized.recordSha256, canonicalSha256(record));
  assert.equal(finalized.validation.checkCount, 4);
});

test('physical review rejects route drift, automation forgery, obstruction, and performance claims', () => {
  const routeDrift = fixture();
  routeDrift.route.observedState.mode = 'scene-color';
  assert.throws(() => validatePhysicalReviewRecord(routeDrift), /state differs/);

  const routeFallback = fixture();
  routeFallback.route.finalUrl = 'https://threejs-skills.com/index.html';
  assert.throws(() => validatePhysicalReviewRecord(routeFallback), /exact ready URL/);

  const webdriver = fixture();
  webdriver.browser.webdriver = true;
  assert.throws(() => validatePhysicalReviewRecord(webdriver), /non-WebDriver/);

  const obstruction = fixture();
  obstruction.review.controlsObstructCanvas = true;
  assert.throws(() => validatePhysicalReviewRecord(obstruction), /unobstructed-canvas/);

  const timingClaim = fixture();
  timingClaim.claimVerdicts.gpuTiming = 'PASS';
  assert.throws(() => validatePhysicalReviewRecord(timingClaim), /cannot claim performance/);

  assert.throws(
    () => validatePhysicalReviewRecord(fixture(), { requiredChecks: [ 'missing-check' ] }),
    /omits required check/,
  );

  const unknownInputMethod = fixture();
  unknownInputMethod.checks[0].inputMethod = 'controller-ish';
  assert.throws(() => validatePhysicalReviewRecord(unknownInputMethod), /unsupported input method/);
});
