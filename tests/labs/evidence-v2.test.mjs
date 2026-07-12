import assert from 'node:assert/strict';
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
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
