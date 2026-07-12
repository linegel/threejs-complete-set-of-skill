import assert from 'node:assert/strict';
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';

import { encodeRgbaPng } from '../../scripts/lib/png-rgba.mjs';
import {
  REQUIRED_EVIDENCE_IMAGES,
  REQUIRED_EVIDENCE_JSON,
  validateEvidenceBundle,
} from '../../scripts/lib/evidence-v2.mjs';
import {
  createUnifiedV2ContractFixtureManifest,
} from '../../threejs-visual-validation/examples/webgpu-validation-harness/src/unified-v2-fixture.js';
import {
  createUnifiedReleaseBundleFixture,
  fixtureImageBytes,
  fixtureSha256,
  readFixtureManifest,
  rebindFixturePromotion,
  rewriteBoundFixtureImage,
  rewriteBoundFixtureJson,
  writeFixtureManifest,
} from './unified-release-fixture.mjs';

const datum = (value, unit = 'count', source = 'fixture measurement') => ({
  value,
  unit,
  label: 'Measured',
  source,
});

function writeJson(path, value) {
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`);
}

const legacyImageCache = new Map();

function legacyImage(marker) {
  if (legacyImageCache.has(marker)) return legacyImageCache.get(marker);
  const width = 1200;
  const height = 800;
  const data = new Uint8Array(width * height * 4);
  for (let y = 0; y < height; y += 1) for (let x = 0; x < width; x += 1) {
    const offset = (y * width + x) * 4;
    data.set([
      (x + marker * 17) & 0xff,
      (y + marker * 29) & 0xff,
      ((x >> 3) ^ (y >> 3) ^ marker) & 0xff,
      255,
    ], offset);
  }
  const png = encodeRgbaPng({ width, height, data });
  legacyImageCache.set(marker, png);
  return png;
}

function createLegacyV2Bundle() {
  const directory = mkdtempSync(join(tmpdir(), 'threejs-legacy-evidence-v2-'));
  mkdirSync(join(directory, 'images'), { recursive: true });
  for (const filename of REQUIRED_EVIDENCE_JSON) writeJson(join(directory, filename), { schemaVersion: 2 });
  writeJson(join(directory, 'evidence-manifest.json'), {
    schemaVersion: 2,
    claimVerdicts: {
      visualCorrectness: 'PASS',
      mechanismCorrectness: 'PASS',
      performanceCompliance: 'PASS',
      gpuAttribution: 'PASS',
      lifecycleStability: 'PASS',
    },
  });
  writeJson(join(directory, 'renderer-info.json'), {
    schemaVersion: 2,
    renderer: 'WebGPURenderer',
    backend: { isWebGPUBackend: true },
    threeRevision: '0.185.1',
  });
  writeJson(join(directory, 'performance-envelope.json'), {
    schemaVersion: 2,
    gpuP95Gate: datum(14.67, 'ms', 'frozen 60 Hz gate'),
    deadlineMissRatioGate: datum(0.01, 'ratio', 'frozen miss gate'),
  });
  writeJson(join(directory, 'frame-trace.json'), {
    schemaVersion: 2,
    summary: { gpuP95: datum(8.5, 'ms', 'resolved timestamp query p95') },
    sustained: { deadlineMissRatio: datum(0, 'ratio', 'measured cadence') },
  });
  writeJson(join(directory, 'quality-governor.json'), { schemaVersion: 2, verdict: 'PASS' });
  writeJson(join(directory, 'leak-loop.json'), {
    schemaVersion: 2,
    cycles: datum(50),
    verdict: 'PASS',
  });
  writeJson(join(directory, 'render-targets.json'), {
    schemaVersion: 2,
    readbacks: [{ id: 'final', bytesPerRow: datum(4864, 'bytes') }],
  });
  REQUIRED_EVIDENCE_IMAGES.forEach((filename, index) => {
    writeFileSync(join(directory, 'images', filename), legacyImage(index + 1));
  });
  return directory;
}

function updateJson(path, mutate) {
  const value = JSON.parse(readFileSync(path, 'utf8'));
  mutate(value);
  writeJson(path, value);
}

test('legacy v1 evidence remains readable but cannot satisfy canonical acceptance', () => {
  const directory = mkdtempSync(join(tmpdir(), 'threejs-legacy-evidence-v1-'));
  writeJson(join(directory, 'evidence-manifest.json'), {
    schemaVersion: 1,
    verdict: 'INSUFFICIENT_EVIDENCE',
  });
  const inspected = validateEvidenceBundle(directory);
  assert.equal(inspected.valid, true);
  assert.equal(inspected.protocol, 'legacy-v1');
  assert.equal(inspected.canonicalAcceptanceEligible, false);
  const accepted = validateEvidenceBundle(directory, { requireRequiredClaimsPass: true });
  assert.equal(accepted.valid, false);
  assert(accepted.errors.some((error) => error.includes('cannot satisfy canonical v2 acceptance')));
});

test('pre-unified v2 evidence is inspectable but never acceptance eligible', () => {
  const directory = createLegacyV2Bundle();
  const inspected = validateEvidenceBundle(directory);
  assert.equal(inspected.valid, true);
  assert.equal(inspected.protocol, 'legacy-v2');
  assert.equal(inspected.canonicalAcceptanceEligible, false);
  const accepted = validateEvidenceBundle(directory, { requireRequiredClaimsPass: true });
  assert.equal(accepted.valid, false);
  assert(accepted.errors.some((error) => error.includes('pre-unified v2 evidence cannot satisfy')));
});

test('legacy performance PASS without a positive GPU timestamp remains rejected', () => {
  const directory = createLegacyV2Bundle();
  writeJson(join(directory, 'frame-trace.json'), { schemaVersion: 2, summary: {} });
  const result = validateEvidenceBundle(directory);
  assert.equal(result.valid, false);
  assert(result.errors.includes('performance PASS requires a positive labelled GPU p95 timestamp value'));
});

test('legacy lifecycle PASS cannot hide a 49-cycle loop', () => {
  const directory = createLegacyV2Bundle();
  writeJson(join(directory, 'leak-loop.json'), {
    schemaVersion: 2,
    cycles: datum(49),
    verdict: 'PASS',
  });
  const result = validateEvidenceBundle(directory);
  assert.equal(result.valid, false);
  assert(result.errors.includes('leak-loop.json requires at least 50 measured lifecycle cycles'));
});

test('unified v2 contract fixtures consume the checked manifest and remain nonpublishable', () => {
  const directory = mkdtempSync(join(tmpdir(), 'threejs-unified-evidence-v2-'));
  writeJson(join(directory, 'evidence-manifest.json'), createUnifiedV2ContractFixtureManifest());
  const result = validateEvidenceBundle(directory);
  assert.equal(result.valid, true);
  assert.equal(result.protocol, 'unified-v2');
  assert.equal(result.canonicalAcceptanceEligible, false);
  const accepted = validateEvidenceBundle(directory, { requireRequiredClaimsPass: true });
  assert.equal(accepted.valid, false);
  assert(accepted.errors.some((error) => error.includes('accepted coverage requires an approved publishable')));
});

test('unified v2 schema mutations fail before an evidence claim can be consumed', () => {
  const directory = mkdtempSync(join(tmpdir(), 'threejs-unified-evidence-v2-mutation-'));
  const path = join(directory, 'evidence-manifest.json');
  writeJson(path, createUnifiedV2ContractFixtureManifest());
  updateJson(path, (manifest) => { manifest.browserLauncher = 'forged'; });
  const result = validateEvidenceBundle(directory);
  assert.equal(result.valid, false);
  assert(result.errors.some((error) => error.includes('unknown property browserLauncher')));
});

test('a fully materialized unified release bundle satisfies strict acceptance', () => {
  const result = validateEvidenceBundle(createUnifiedReleaseBundleFixture(), {
    requireRequiredClaimsPass: true,
  });
  assert.equal(result.valid, true, result.errors.join('\n'));
  assert.equal(result.protocol, 'unified-v2');
  assert.equal(result.canonicalAcceptanceEligible, true);
});

test('unified release validation rejects stale and rehashed normative bytes', () => {
  const stale = createUnifiedReleaseBundleFixture();
  const contractPath = join(stale, 'visual-contract.json');
  writeFileSync(contractPath, Buffer.concat([readFileSync(contractPath), Buffer.from(' ')]));
  const staleResult = validateEvidenceBundle(stale);
  assert.equal(staleResult.valid, false);
  assert(staleResult.errors.some((error) => error.includes('differs from its ledger')));

  const rehashed = createUnifiedReleaseBundleFixture();
  rewriteBoundFixtureJson(rehashed, 'visual-contract.json', (contract) => {
    contract.unlabelledThreshold = 17;
  });
  const rehashedResult = validateEvidenceBundle(rehashed);
  assert.equal(rehashedResult.valid, false);
  assert(rehashedResult.errors.some((error) => error.includes('unlabelled numeric value')));
});

test('unified release validation decodes pixels and rejects flat or aliased evidence', () => {
  const flat = createUnifiedReleaseBundleFixture();
  const pixels = new Uint8Array(1200 * 800 * 4);
  pixels.fill(255);
  rewriteBoundFixtureImage(flat, 'final.design.png', encodeRgbaPng({
    width: 1200,
    height: 800,
    data: pixels,
  }));
  const flatResult = validateEvidenceBundle(flat);
  assert.equal(flatResult.valid, false);
  assert(flatResult.errors.some((error) => error.includes('blank or effectively flat')));

  const aliased = createUnifiedReleaseBundleFixture();
  rewriteBoundFixtureImage(aliased, 'diagnostics.mosaic.png', fixtureImageBytes(1));
  const aliasedResult = validateEvidenceBundle(aliased);
  assert.equal(aliasedResult.valid, false);
  assert(aliasedResult.errors.some((error) => (
    error.includes('identical hashes') || error.includes('does not differ materially')
  )));
});

test('unified release validation rejects bad stride, timing attribution, and lifecycle depth', () => {
  const badStride = createUnifiedReleaseBundleFixture();
  rewriteBoundFixtureJson(badStride, 'render-targets.json', (targets) => {
    targets.readbacks[0].bytesPerRow.value = 4800;
  });
  const strideResult = validateEvidenceBundle(badStride);
  assert.equal(strideResult.valid, false);
  assert(strideResult.errors.some((error) => error.includes('256-byte-aligned row stride')));

  const cpuTiming = createUnifiedReleaseBundleFixture();
  rewriteBoundFixtureJson(cpuTiming, 'frame-trace.json', (trace) => {
    trace.gpuP95.source = 'CPU wall-clock fixture';
  });
  const timingResult = validateEvidenceBundle(cpuTiming);
  assert.equal(timingResult.valid, false);
  assert(timingResult.errors.some((error) => error.includes('GPU p95 timestamp')));

  const shortLifecycle = createUnifiedReleaseBundleFixture();
  rewriteBoundFixtureJson(shortLifecycle, 'leak-loop.json', (loop) => {
    loop.cycles.value = 49;
  });
  const lifecycleResult = validateEvidenceBundle(shortLifecycle);
  assert.equal(lifecycleResult.valid, false);
  assert(lifecycleResult.errors.some((error) => error.includes('at least 50 measured lifecycle cycles')));
});

test('unified release performance PASS requires complete sustained populations and stage attribution', () => {
  const missingP50 = createUnifiedReleaseBundleFixture();
  rewriteBoundFixtureJson(missingP50, 'frame-trace.json', (trace) => {
    delete trace.gpuP50;
  });
  const p50Result = validateEvidenceBundle(missingP50);
  assert.equal(p50Result.valid, false);
  assert(p50Result.errors.some((error) => error.includes('frame-trace.json.gpuP50')));

  const shortWarmup = createUnifiedReleaseBundleFixture();
  rewriteBoundFixtureJson(shortWarmup, 'frame-trace.json', (trace) => {
    trace.warmup.cpuSamples.values.pop();
  });
  const warmupResult = validateEvidenceBundle(shortWarmup);
  assert.equal(warmupResult.valid, false);
  assert(warmupResult.errors.some((error) => error.includes('requires at least 30 samples')));

  const perFrameMapping = createUnifiedReleaseBundleFixture();
  rewriteBoundFixtureJson(perFrameMapping, 'frame-trace.json', (trace) => {
    trace.timestampResolveCount.value = trace.sampleFrames.value;
    trace.timestampMappingCadence = 'per-frame mapping';
  });
  const mappingResult = validateEvidenceBundle(perFrameMapping);
  assert.equal(mappingResult.valid, false);
  assert(mappingResult.errors.some((error) => error.includes('resolved in batches')));

  const missingStages = createUnifiedReleaseBundleFixture();
  rewriteBoundFixtureJson(missingStages, 'frame-trace.json', (trace) => {
    trace.gpuStageAttribution = null;
  });
  const stagesResult = validateEvidenceBundle(missingStages);
  assert.equal(stagesResult.valid, false);
  assert(stagesResult.errors.some((error) => error.includes('gpuStageAttribution must be an object')));
});

test('unified release performance PASS requires exercised stable governor evidence', () => {
  const unexercised = createUnifiedReleaseBundleFixture();
  rewriteBoundFixtureJson(unexercised, 'quality-governor.json', (governor) => {
    governor.transitions = [];
  });
  const unexercisedResult = validateEvidenceBundle(unexercised);
  assert.equal(unexercisedResult.valid, false);
  assert(unexercisedResult.errors.some((error) => error.includes('transitions requires at least 1 entries')));

  const oscillating = createUnifiedReleaseBundleFixture();
  rewriteBoundFixtureJson(oscillating, 'quality-governor.json', (governor) => {
    governor.oscillationDetected = true;
  });
  const oscillatingResult = validateEvidenceBundle(oscillating);
  assert.equal(oscillatingResult.valid, false);
  assert(oscillatingResult.errors.some((error) => error.includes('governor oscillation')));

  const forgedTransition = createUnifiedReleaseBundleFixture();
  rewriteBoundFixtureJson(forgedTransition, 'quality-governor.json', (governor) => {
    governor.transitions[0].from = 'balanced';
    governor.transitions[0].to = 'full';
  });
  const forgedTransitionResult = validateEvidenceBundle(forgedTransition);
  assert.equal(forgedTransitionResult.valid, false);
  assert(forgedTransitionResult.errors.some((error) => error.includes('breaks source-window tier lineage')));

  const unboundWindowTimestamp = createUnifiedReleaseBundleFixture();
  rewriteBoundFixtureJson(unboundWindowTimestamp, 'quality-governor.json', (governor) => {
    governor.windows[3].timestampRows[0].totalMs.value = 7;
  });
  const unboundWindowTimestampResult = validateEvidenceBundle(unboundWindowTimestamp);
  assert.equal(unboundWindowTimestampResult.valid, false);
  assert(unboundWindowTimestampResult.errors.some((error) => error.includes('frame 0 total')));
});

test('unified release lifecycle PASS reconciles every settled row and resource trend', () => {
  const truncated = createUnifiedReleaseBundleFixture();
  rewriteBoundFixtureJson(truncated, 'leak-loop.json', (loop) => {
    loop.cycleSnapshots.pop();
  });
  const truncatedResult = validateEvidenceBundle(truncated);
  assert.equal(truncatedResult.valid, false);
  assert(truncatedResult.errors.some((error) => error.includes('at least 50 entries')));

  const retained = createUnifiedReleaseBundleFixture();
  rewriteBoundFixtureJson(retained, 'leak-loop.json', (loop) => {
    loop.cycleSnapshots[49].retainedTargetBytes.value = 1;
  });
  const retainedResult = validateEvidenceBundle(retained);
  assert.equal(retainedResult.valid, false);
  assert(retainedResult.errors.some((error) => error.includes('retained lab-owned GPU resources')));

  const forgedTrend = createUnifiedReleaseBundleFixture();
  rewriteBoundFixtureJson(forgedTrend, 'leak-loop.json', (loop) => {
    loop.trend.targetBytesPerCycle.value = 1;
  });
  const trendResult = validateEvidenceBundle(forgedTrend);
  assert.equal(trendResult.valid, false);
  assert(trendResult.errors.some((error) => error.includes('does not reconcile with its retained population')));

  const retainedListener = createUnifiedReleaseBundleFixture();
  rewriteBoundFixtureJson(retainedListener, 'leak-loop.json', (loop) => {
    loop.cycleSnapshots[11].retainedListenerCount.value = 1;
  });
  const retainedListenerResult = validateEvidenceBundle(retainedListener);
  assert.equal(retainedListenerResult.valid, false);
  assert(retainedListenerResult.errors.some((error) => error.includes('retained listener state')));

  const unrestoredRenderer = createUnifiedReleaseBundleFixture();
  rewriteBoundFixtureJson(unrestoredRenderer, 'leak-loop.json', (loop) => {
    loop.cycleSnapshots[19].rendererStateRestored = false;
  });
  const unrestoredRendererResult = validateEvidenceBundle(unrestoredRenderer);
  assert.equal(unrestoredRendererResult.valid, false);
  assert(unrestoredRendererResult.errors.some((error) => error.includes('did not restore renderer state')));
});

test('unified release validation confines captured file realpaths', () => {
  const directory = createUnifiedReleaseBundleFixture();
  const outside = mkdtempSync(join(tmpdir(), 'threejs-unified-release-outside-'));
  const outsidePath = join(outside, 'escaped.json');
  const outsideBytes = Buffer.from('{"escaped":true}\n');
  writeFileSync(outsidePath, outsideBytes);
  symlinkSync(outsidePath, join(directory, 'escaped.json'));

  const manifest = readFixtureManifest(directory);
  manifest.files.push({
    path: 'escaped.json',
    status: 'captured',
    kind: 'supplementary-json',
    sha256: fixtureSha256(outsideBytes),
    byteLength: outsideBytes.byteLength,
  });
  rebindFixturePromotion(manifest);
  writeFixtureManifest(directory, manifest);

  const result = validateEvidenceBundle(directory);
  assert.equal(result.valid, false);
  assert(result.errors.some((error) => error.includes('realpath escapes its bundle')));
});
