import assert from 'node:assert/strict';
import { test } from 'node:test';

import { numericDatum, NumericLabel } from '../../labs/runtime/numeric-evidence.mjs';
import { canonicalSha256 } from '../../scripts/lib/evidence-manifest-contract.mjs';
import { createEvidenceLaneJoin, validateEvidenceLaneJoin } from '../../scripts/lib/evidence-lane-join.mjs';

const hash = (value) => canonicalSha256(value);

function fixture() {
  const sourceClosureHash = hash('source');
  const buildRevision = hash('build');
  const route = { path: '/mechanism/frost/index.html', finalUrl: 'https://example.test/mechanism/frost/index.html', controllerReady: true, lockedState: { mode: 'final' }, observedState: { mode: 'final' } };
  const record = {
    schemaVersion: 1, recordKind: 'lab-physical-route-review-v1', labId: 'example-lab', profile: 'physical-route', automationSurface: 'codex-in-app-browser', publishable: false,
    sourceClosureHash, buildRevision, threeRevision: '0.185.1', startedAt: '2026-07-13T00:00:00Z', finishedAt: '2026-07-13T00:01:00Z',
    immutableBuild: { immutable: true, viteDevelopmentServer: false, transformAtServe: false, sourceClosureHash, buildRevision, threeRevision: '0.185.1', bundleHash: hash('bundle'), servedLedgerHash: hash('served') },
    browser: { webdriver: false, headless: false, visibilityState: 'visible', userAgent: 'fixture', platform: 'macOS' }, adapter: { adapterClass: 'hardware', identity: { vendor: 'apple' } }, route,
    viewport: { width: numericDatum(1200, 'pixel', NumericLabel.MEASURED, 'fixture'), height: numericDatum(800, 'pixel', NumericLabel.MEASURED, 'fixture'), dpr: numericDatum(1, 'ratio', NumericLabel.MEASURED, 'fixture') },
    runtime: { initialized: true, nativeWebGPU: true, backend: { isWebGPUBackend: true, deviceIdentityVerified: true } }, errors: { page: [], console: [], request: [], device: [], postDisposal: [] },
    checks: [ { id: 'review', inputMethod: 'direct-visual-inspection', expected: true, observed: true, verdict: 'PASS' } ],
    review: { verdict: 'PASS', canvasVisible: true, controlsObstructCanvas: false, rawMetricsCollapsedByDefault: true, inspectedModes: [ 'final', 'diagnostic' ], notes: [ 'Distinct real outputs inspected.' ] },
    claimVerdicts: { visualCorrectness: 'PASS', performanceCompliance: 'NOT_CLAIMED', gpuTiming: 'NOT_CLAIMED' }, limitations: [],
  };
  const physicalReview = { record, validation: { valid: true }, recordSha256: hash(record) };
  const rawManifest = {
    labId: 'example-lab', bundleKind: 'raw-capture-session', publishable: false, sourceClosureHash, buildRevision, threeRevision: '0.185.1', limitations: [],
    claimVerdicts: { visualCorrectness: 'INSUFFICIENT_EVIDENCE', mechanismCorrectness: 'PASS', performanceCompliance: 'NOT_CLAIMED', gpuAttribution: 'NOT_CLAIMED', lifecycleStability: 'PASS', visualError: 'PASS' },
    captureSessions: [ { profile: 'correctness', automationSurface: 'playwright-headless-chromium', adapterClass: 'software', sessionId: 'correctness:1', isWebGPUBackend: true, sourceClosureHash, buildRevision, threeRevision: '0.185.1', document: { sha256: hash('document') }, writeLedger: { sha256: hash('ledger') }, routeDigest: hash('route'), stateDigest: hash('state') } ],
  };
  return { rawManifest, physicalReview };
}

test('two-lane join accepts software correctness and hardware physical review without performance claims', () => {
  const input = fixture();
  const join = createEvidenceLaneJoin(input);
  assert.equal(join.claimVerdicts.visualCorrectness, 'PASS');
  assert.equal(join.lanes.correctness.adapterClass, 'software');
  assert.equal(join.lanes.physicalRoute.adapterClass, 'hardware');
  assert.equal(validateEvidenceLaneJoin(join).laneCount, 2);
  const { joinSha256, ...joinBody } = join;
  assert.equal(joinSha256, hash(joinBody));
});

test('lane join rejects source drift and missing performance attribution', () => {
  const drift = fixture();
  drift.physicalReview.record.sourceClosureHash = hash('drift');
  drift.physicalReview.record.immutableBuild.sourceClosureHash = hash('drift');
  drift.physicalReview.recordSha256 = hash(drift.physicalReview.record);
  assert.throws(() => createEvidenceLaneJoin(drift), /differs from correctness/);

  const performanceClaim = fixture();
  performanceClaim.rawManifest.claimVerdicts.performanceCompliance = 'PASS';
  assert.throws(() => createEvidenceLaneJoin(performanceClaim), /missing performance lane/);
});
