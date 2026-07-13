import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';

import { numericDatum, NumericLabel } from '../../labs/runtime/numeric-evidence.mjs';
import { canonicalSha256 } from '../../scripts/lib/evidence-manifest-contract.mjs';
import { createEvidenceLaneJoin } from '../../scripts/lib/evidence-lane-join.mjs';
import {
  assemblePendingReleaseBundle,
  assemblePreparedReleaseBundle,
} from '../../scripts/lib/release-bundle-assembler.mjs';
import { validateEvidenceBundle } from '../../scripts/lib/evidence-v2.mjs';
import {
  createUnifiedReleaseBundleFixture,
  readFixtureManifest,
  writeFixtureManifest,
} from './unified-release-fixture.mjs';

function makeRawCorrectnessBundle() {
  const directory = createUnifiedReleaseBundleFixture();
  const manifest = readFixtureManifest(directory);
  const correctness = manifest.captureSessions.find((session) => session.profile === 'correctness');
  manifest.bundleId = 'webgpu-validation-harness:raw-correctness:fixture:v2';
  manifest.bundleKind = 'raw-capture-session';
  manifest.publishable = false;
  manifest.claimVerdicts = {
    visualCorrectness: 'INSUFFICIENT_EVIDENCE',
    mechanismCorrectness: 'PASS',
    performanceCompliance: 'NOT_CLAIMED',
    gpuAttribution: 'NOT_CLAIMED',
    lifecycleStability: 'PASS',
    visualError: 'PASS',
  };
  manifest.captureSessions = [correctness];
  const retainedSessionPaths = new Set([correctness.document.path, correctness.writeLedger.path]);
  manifest.files = manifest.files.filter((entry) => (
    !['capture-session-document', 'capture-session-write-ledger'].includes(entry.kind)
    || retainedSessionPaths.has(entry.path)
  ));
  manifest.files.reverse();
  manifest.images.reverse();
  manifest.promotion = {
    status: 'NOT_ELIGIBLE',
    binding: null,
    bindingDigest: null,
    visualSignoff: {
      status: 'NOT_REVIEWED', reviewer: null, reviewedAt: null, reviewDigest: null, reviewedImages: [], notes: [],
    },
  };
  writeFixtureManifest(directory, manifest);
  const validation = validateEvidenceBundle(directory);
  assert.equal(validation.valid, true, validation.errors.join('\n'));
  return { directory, manifest };
}

function physicalReview(raw) {
  const lockedState = {
    scenario: 'browser-capture',
    mechanism: 'resource-ledger',
    mode: 'resources',
    tier: 'release',
    camera: 'design',
    seed: 1,
  };
  const record = {
    schemaVersion: 1,
    recordKind: 'lab-physical-route-review-v1',
    labId: raw.labId,
    profile: 'physical-route',
    automationSurface: 'codex-in-app-browser',
    publishable: false,
    sourceClosureHash: raw.sourceClosureHash,
    buildRevision: raw.buildRevision,
    threeRevision: raw.threeRevision,
    startedAt: '2026-07-13T00:00:00Z',
    finishedAt: '2026-07-13T00:01:00Z',
    immutableBuild: {
      immutable: true,
      viteDevelopmentServer: false,
      transformAtServe: false,
      sourceClosureHash: raw.sourceClosureHash,
      buildRevision: raw.buildRevision,
      threeRevision: raw.threeRevision,
      bundleHash: canonicalSha256('bundle'),
      servedLedgerHash: canonicalSha256('served'),
    },
    browser: { webdriver: false, headless: false, visibilityState: 'visible', userAgent: 'fixture browser', platform: 'macOS' },
    adapter: { adapterClass: 'hardware', identity: { vendor: 'apple', architecture: 'metal-3' } },
    route: {
      path: '/mechanism/resource-ledger/index.html',
      finalUrl: 'http://127.0.0.1:4324/mechanism/resource-ledger/index.html',
      controllerReady: true,
      lockedState,
      observedState: structuredClone(lockedState),
    },
    viewport: {
      width: numericDatum(1200, 'pixel', NumericLabel.MEASURED, 'fixture viewport'),
      height: numericDatum(800, 'pixel', NumericLabel.MEASURED, 'fixture viewport'),
      dpr: numericDatum(1, 'ratio', NumericLabel.MEASURED, 'fixture viewport'),
    },
    runtime: { initialized: true, nativeWebGPU: true, backend: { isWebGPUBackend: true, deviceIdentityVerified: true } },
    errors: { page: [], console: [], request: [], device: [], postDisposal: [] },
    checks: [{ id: 'review', inputMethod: 'direct-visual-inspection', expected: true, observed: true, verdict: 'PASS' }],
    review: {
      verdict: 'PASS', canvasVisible: true, controlsObstructCanvas: false, rawMetricsCollapsedByDefault: true,
      inspectedModes: ['final', 'resources'], notes: ['Final and resource views are distinct.'],
    },
    claimVerdicts: { visualCorrectness: 'PASS', performanceCompliance: 'NOT_CLAIMED', gpuTiming: 'NOT_CLAIMED' },
    limitations: [],
  };
  return { record, validation: { valid: true }, recordSha256: canonicalSha256(record) };
}

function reviewedRoute() {
  return {
    path: '/demos/webgpu-validation-harness/mechanism/resource-ledger/',
    scenario: 'browser-capture',
    mechanism: 'resource-ledger',
    mode: 'resources',
    tier: 'release',
    camera: 'design',
    seed: '0x00000001',
    timeSeconds: numericDatum(0, 'seconds', NumericLabel.AUTHORED, 'fixed route startup state'),
  };
}

function writeInputs(root, rawManifest, review) {
  const physicalReviewPath = join(root, 'physical-review.json');
  const servedLedgerPath = join(root, 'served-ledger.json');
  const laneJoinPath = join(root, 'lane-join.json');
  writeFileSync(physicalReviewPath, `${JSON.stringify(review, null, 2)}\n`);
  writeFileSync(servedLedgerPath, `${JSON.stringify({ schemaVersion: 1, ledgerSha256: review.record.immutableBuild.servedLedgerHash, entries: [], sealed: true }, null, 2)}\n`);
  const laneJoin = createEvidenceLaneJoin({ rawManifest, physicalReview: review });
  writeFileSync(laneJoinPath, `${JSON.stringify(laneJoin, null, 2)}\n`);
  return { physicalReviewPath, servedLedgerPath, laneJoinPath };
}

function preparedPhysicalSession(raw, route, overrides = {}) {
  return {
    sessionId: 'webgpu-validation-harness:physical-route:prepared-fixture',
    profile: 'physical-route',
    automationSurface: 'codex-in-app-browser',
    adapterClass: 'hardware',
    adapterIdentity: { kind: 'gpu-adapter', digest: canonicalSha256('prepared adapter') },
    deviceIdentity: { kind: 'gpu-device', digest: canonicalSha256('prepared device') },
    browserIdentity: { kind: 'browser', digest: canonicalSha256('prepared browser') },
    osIdentity: { kind: 'operating-system', digest: canonicalSha256('prepared os') },
    refreshIdentity: { kind: 'display-refresh', digest: canonicalSha256('prepared refresh') },
    colorIdentity: { kind: 'color-pipeline', digest: canonicalSha256('prepared color') },
    limitationsDigest: canonicalSha256([]),
    threeRevision: raw.threeRevision,
    sourceClosureHash: raw.sourceClosureHash,
    buildRevision: raw.buildRevision,
    startedAt: '2026-07-13T02:00:00Z',
    finishedAt: '2026-07-13T02:01:00Z',
    routePath: route.path,
    routeSetPaths: [raw.route.path, route.path],
    documentPath: 'sessions/prepared-physical.capture-session.json',
    writeLedgerPath: 'sessions/prepared-physical.write-ledger.json',
    rendererInitialized: true,
    isWebGPUBackend: true,
    timestampQuerySupported: false,
    ...overrides,
  };
}

function preparedReleaseInputs(raw, overrides = {}) {
  const route = reviewedRoute();
  const documentBytes = Buffer.from('{"profile":"physical-route","exact":true}\n');
  const ledgerBytes = Buffer.from('[{"path":"index.html","sha256":"fixture"}]');
  return {
    routes: [route],
    limitations: [],
    claimVerdicts: {
      visualCorrectness: 'PASS',
      mechanismCorrectness: 'PASS',
      performanceCompliance: 'NOT_CLAIMED',
      gpuAttribution: 'NOT_CLAIMED',
      lifecycleStability: 'PASS',
      visualError: 'PASS',
    },
    captureSessions: [preparedPhysicalSession(raw, route)],
    supplementaryArtifacts: [
      { path: 'sessions/prepared-physical.capture-session.json', kind: 'capture-session-document', bytes: documentBytes },
      { path: 'sessions/prepared-physical.write-ledger.json', kind: 'capture-session-write-ledger', bytes: ledgerBytes },
      { path: 'strict-lane-join.json', kind: 'supplementary-json', bytes: Buffer.from('{"schemaVersion":1}\n') },
    ],
    ...overrides,
  };
}

test('prepared assembler owns route, session, and exact supplementary bindings', async () => {
  const { directory, manifest } = makeRawCorrectnessBundle();
  const root = mkdtempSync(join(tmpdir(), 'release-prepared-input-'));
  const outputDirectory = join(root, 'release');
  const result = await assemblePreparedReleaseBundle({
    correctnessDirectory: directory,
    outputDirectory,
    prepareReleaseInputs({ rawManifest }) {
      assert.equal(Object.isFrozen(rawManifest), true);
      return preparedReleaseInputs(rawManifest);
    },
  });
  assert.equal(result.validation.valid, true, result.validation.errors.join('\n'));
  const session = result.manifest.captureSessions.find((entry) => entry.profile === 'physical-route');
  assert.deepEqual(session.routeSetPaths, [manifest.route.path, reviewedRoute().path]);
  assert.match(session.routeSetDigest, /^sha256:[a-f0-9]{64}$/);
  assert.equal(session.routeDigest, canonicalSha256(result.manifest.routeSet.find((route) => route.path === reviewedRoute().path)));
  assert.equal(session.document.sha256, result.manifest.files.find((entry) => entry.path === session.document.path).sha256);
  assert.equal(readFileSync(join(outputDirectory, session.document.path), 'utf8'), '{"profile":"physical-route","exact":true}\n');
  assert.equal(result.manifest.files.find((entry) => entry.path === 'strict-lane-join.json').kind, 'supplementary-json');
});

test('prepared assembler rejects unconfined, colliding, stale, and unknown inputs', async () => {
  const { directory, manifest } = makeRawCorrectnessBundle();
  const mutations = [
    ['unconfined path', (value) => { value.supplementaryArtifacts[0].path = '../escaped.json'; }, /confined normalized bundle-relative path/],
    ['captured-file collision', (value) => { value.supplementaryArtifacts[0].path = 'renderer-info.json'; }, /collides/],
    ['unsupported kind', (value) => { value.supplementaryArtifacts[0].kind = 'normative-json'; }, /unsupported kind/],
    ['stale document binding', (value) => {
      value.captureSessions[0].document = { kind: 'capture-session-document', path: value.captureSessions[0].documentPath, sha256: canonicalSha256('wrong'), byteLength: 1 };
    }, /document binding is stale/],
    ['unknown route', (value) => { value.captureSessions[0].routePath = '/demos/webgpu-validation-harness/unknown/'; }, /route is not in the release route set/],
  ];
  for (const [name, mutate, pattern] of mutations) {
    const root = mkdtempSync(join(tmpdir(), `release-prepared-${name.replaceAll(' ', '-')}-`));
    const inputs = preparedReleaseInputs(manifest);
    mutate(inputs);
    await assert.rejects(() => assemblePreparedReleaseBundle({
      correctnessDirectory: directory,
      outputDirectory: join(root, 'release'),
      prepareReleaseInputs: () => inputs,
    }), pattern, name);
  }
});

test('prepared assembler keeps source and release trees disjoint outside the portable join', async () => {
  const { directory, manifest } = makeRawCorrectnessBundle();
  await assert.rejects(() => assemblePreparedReleaseBundle({
    correctnessDirectory: directory,
    outputDirectory: join(directory, 'nested-release'),
    prepareReleaseInputs: () => preparedReleaseInputs(manifest),
  }), /disjoint resolved directory trees/);
});

test('offline assembler creates a validated nonpublishable multi-route release candidate', async () => {
  const { directory, manifest } = makeRawCorrectnessBundle();
  const root = mkdtempSync(join(tmpdir(), 'release-assembler-test-'));
  const review = physicalReview(manifest);
  const inputs = writeInputs(root, manifest, review);
  const outputDirectory = join(root, 'release');
  const result = await assemblePendingReleaseBundle({
    correctnessDirectory: directory,
    ...inputs,
    outputDirectory,
    physicalRoute: reviewedRoute(),
    limitations: [{
      id: 'performance-not-claimed', status: 'ACTIVE', statement: 'This release does not claim hardware performance.',
      affectedClaims: ['performanceCompliance', 'gpuAttribution'],
    }],
  });
  assert.equal(result.validation.valid, true, result.validation.errors.join('\n'));
  assert.equal(result.manifest.publishable, false);
  assert.equal(result.manifest.promotion.status, 'PENDING_VISUAL_SIGNOFF');
  assert.deepEqual(result.manifest.routeSet.map((route) => route.path), [manifest.route.path, reviewedRoute().path]);
  assert.deepEqual(result.manifest.images.slice(0, 3).map((image) => image.path), [
    'final.design.png', 'no-post.design.png', 'diagnostics.mosaic.png',
  ]);
  assert.deepEqual(result.manifest.files.slice(0, 3).map((file) => file.path), [
    'visual-contract.json', 'evidence-manifest.json', 'renderer-info.json',
  ]);
  assert.equal(result.manifest.captureSessions.find((session) => session.profile === 'physical-route').routePath, reviewedRoute().path);
  await assert.rejects(() => assemblePendingReleaseBundle({
    correctnessDirectory: directory,
    ...inputs,
    outputDirectory,
    physicalRoute: reviewedRoute(),
    limitations: [],
  }), /already exists/);
});

test('offline assembler applies bounded JSON projections and owns their final hashes', async () => {
  const { directory, manifest } = makeRawCorrectnessBundle();
  const root = mkdtempSync(join(tmpdir(), 'release-assembler-projection-'));
  const review = physicalReview(manifest);
  const inputs = writeInputs(root, manifest, review);
  const sourceRendererInfo = JSON.parse(readFileSync(join(directory, 'renderer-info.json'), 'utf8'));
  const sourceReference = manifest.files.find((entry) => entry.path === 'renderer-info.json');
  const outputDirectory = join(root, 'release');
  const result = await assemblePendingReleaseBundle({
    correctnessDirectory: directory,
    ...inputs,
    outputDirectory,
    physicalRoute: reviewedRoute(),
    limitations: [],
    projectEvidenceArtifacts({ artifacts, artifactBindings, rawManifest, laneJoin }) {
      assert.equal(Object.isFrozen(artifacts), true);
      assert.equal(Object.isFrozen(artifacts['renderer-info.json']), true);
      assert.equal(Object.isFrozen(artifactBindings), true);
      assert.equal(Object.isFrozen(artifactBindings['renderer-info.json'].ledgerEntry), true);
      assert.equal(JSON.parse(artifactBindings['renderer-info.json'].canonicalJson).renderer, 'WebGPURenderer');
      assert.equal(Object.isFrozen(rawManifest), true);
      assert.equal(Object.isFrozen(laneJoin), true);
      return {
        'renderer-info.json': {
          ...artifacts['renderer-info.json'],
          releaseProjection: 'verified-lane-join',
        },
      };
    },
  });
  const projectedBytes = readFileSync(join(outputDirectory, 'renderer-info.json'));
  const projected = JSON.parse(projectedBytes);
  const projectedReference = result.manifest.files.find((entry) => entry.path === 'renderer-info.json');
  assert.equal(projected.releaseProjection, 'verified-lane-join');
  assert.notEqual(projectedReference.sha256, sourceReference.sha256);
  assert.equal(projectedReference.byteLength, projectedBytes.byteLength);
  assert.deepEqual(JSON.parse(readFileSync(join(directory, 'renderer-info.json'), 'utf8')), sourceRendererInfo);
  assert.equal(result.validation.valid, true, result.validation.errors.join('\n'));
});

test('offline assembler confines projections to existing normative JSON artifacts', async () => {
  const { directory, manifest } = makeRawCorrectnessBundle();
  const mutations = [
    ['evidence manifest', { 'evidence-manifest.json': { schemaVersion: 2 } }, /cannot replace evidence-manifest/],
    ['standard image', { 'final.design.png': { schemaVersion: 2 } }, /cannot replace final\.design/],
    ['unknown file', { 'invented.json': { schemaVersion: 2 } }, /cannot replace invented/],
    ['missing schema', { 'renderer-info.json': { renderer: 'WebGPURenderer' } }, /must use schemaVersion 2/],
  ];
  for (const [name, projection, expected] of mutations) {
    const root = mkdtempSync(join(tmpdir(), `release-assembler-projection-${name.replaceAll(' ', '-')}-`));
    const review = physicalReview(manifest);
    const inputs = writeInputs(root, manifest, review);
    await assert.rejects(() => assemblePendingReleaseBundle({
      correctnessDirectory: directory,
      ...inputs,
      outputDirectory: join(root, 'release'),
      physicalRoute: reviewedRoute(),
      limitations: [],
      projectEvidenceArtifacts: () => projection,
    }), expected, name);
  }
});

test('offline assembler rejects physical route state and source-identity substitutions', async () => {
  const { directory, manifest } = makeRawCorrectnessBundle();
  const root = mkdtempSync(join(tmpdir(), 'release-assembler-mutation-'));
  const review = physicalReview(manifest);
  const inputs = writeInputs(root, manifest, review);
  const badRoute = reviewedRoute();
  badRoute.tier = 'wrong-tier';
  await assert.rejects(() => assemblePendingReleaseBundle({
    correctnessDirectory: directory,
    ...inputs,
    outputDirectory: join(root, 'bad-route'),
    physicalRoute: badRoute,
    limitations: [],
  }), /tier differs/);

  review.record.sourceClosureHash = canonicalSha256('substituted-source');
  review.record.immutableBuild.sourceClosureHash = review.record.sourceClosureHash;
  review.recordSha256 = canonicalSha256(review.record);
  writeFileSync(inputs.physicalReviewPath, `${JSON.stringify(review, null, 2)}\n`);
  await assert.rejects(() => assemblePendingReleaseBundle({
    correctnessDirectory: directory,
    ...inputs,
    outputDirectory: join(root, 'bad-source'),
    physicalRoute: reviewedRoute(),
    limitations: [],
  }), /identity differs/);
});

test('offline assembler rejects forged join hashes and substituted served ledgers', async () => {
  const { directory, manifest } = makeRawCorrectnessBundle();
  const root = mkdtempSync(join(tmpdir(), 'release-assembler-binding-'));
  const review = physicalReview(manifest);
  const inputs = writeInputs(root, manifest, review);
  const joinRecord = JSON.parse(readFileSync(inputs.laneJoinPath, 'utf8'));
  joinRecord.joinSha256 = canonicalSha256('forged-join');
  writeFileSync(inputs.laneJoinPath, `${JSON.stringify(joinRecord, null, 2)}\n`);
  await assert.rejects(() => assemblePendingReleaseBundle({
    correctnessDirectory: directory,
    ...inputs,
    outputDirectory: join(root, 'bad-join'),
    physicalRoute: reviewedRoute(),
    limitations: [],
  }), /canonical hash/);

  const restored = createEvidenceLaneJoin({ rawManifest: manifest, physicalReview: review });
  writeFileSync(inputs.laneJoinPath, `${JSON.stringify(restored, null, 2)}\n`);
  writeFileSync(inputs.servedLedgerPath, `${JSON.stringify({ schemaVersion: 1, ledgerSha256: canonicalSha256('other-ledger'), entries: [] }, null, 2)}\n`);
  await assert.rejects(() => assemblePendingReleaseBundle({
    correctnessDirectory: directory,
    ...inputs,
    outputDirectory: join(root, 'bad-ledger'),
    physicalRoute: reviewedRoute(),
    limitations: [],
  }), /served ledger/);
});
