import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  mkdtempSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  REQUIRED_EVIDENCE_IMAGES,
  REQUIRED_EVIDENCE_JSON,
  validateEvidenceBundle,
} from '../../scripts/lib/evidence-v2.mjs';

const datum = (value, unit = 'count') => ({ value, unit, label: 'Measured', source: 'fixture' });

function writeJson(path, value) {
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`);
}

function minimalPng(marker) {
  const bytes = Buffer.alloc(25);
  Buffer.from('89504e470d0a1a0a', 'hex').copy(bytes, 0);
  bytes.writeUInt32BE(1200, 16);
  bytes.writeUInt32BE(800, 20);
  bytes[24] = marker;
  return bytes;
}

function createBundle() {
  const directory = mkdtempSync(join(tmpdir(), 'threejs-evidence-v2-'));
  mkdirSync(join(directory, 'images'));
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
  writeJson(join(directory, 'frame-trace.json'), {
    schemaVersion: 2,
    summary: { gpuP95: datum(8.5, 'ms') },
  });
  writeJson(join(directory, 'leak-loop.json'), {
    schemaVersion: 2,
    cycles: datum(50),
  });
  writeJson(join(directory, 'render-targets.json'), {
    schemaVersion: 2,
    readbacks: [{ id: 'final', bytesPerRow: datum(4864, 'bytes') }],
  });
  for (const [index, filename] of REQUIRED_EVIDENCE_IMAGES.entries()) {
    writeFileSync(join(directory, 'images', filename), minimalPng(index + 1));
  }
  return directory;
}

function updateJson(path, mutate) {
  const value = JSON.parse(readFileSync(path, 'utf8'));
  mutate(value);
  writeJson(path, value);
}

test('all-insufficient claims are structurally inspectable but cannot prove accepted coverage', () => {
  const directory = createBundle();
  try {
    updateJson(join(directory, 'evidence-manifest.json'), (manifest) => {
      for (const claim of Object.keys(manifest.claimVerdicts)) manifest.claimVerdicts[claim] = 'INSUFFICIENT_EVIDENCE';
    });
    assert.equal(validateEvidenceBundle(directory).valid, true);
    const accepted = validateEvidenceBundle(directory, { requireRequiredClaimsPass: true });
    assert.equal(accepted.valid, false);
    assert.equal(accepted.errors.filter((error) => error.includes('must be PASS for accepted coverage')).length, 5);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test('performance PASS without a positive GPU p95 timestamp is rejected', () => {
  const directory = createBundle();
  try {
    writeJson(join(directory, 'frame-trace.json'), { schemaVersion: 2, summary: {} });
    const result = validateEvidenceBundle(directory);
    assert.equal(result.valid, false);
    assert.ok(result.errors.includes('performance PASS requires a positive labelled GPU p95 timestamp value'));
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test('a 49-cycle lifecycle loop cannot satisfy the v2 evidence floor', () => {
  const directory = createBundle();
  try {
    writeJson(join(directory, 'leak-loop.json'), { schemaVersion: 2, cycles: datum(49) });
    const result = validateEvidenceBundle(directory);
    assert.equal(result.valid, false);
    assert.ok(result.errors.includes('leak-loop.json requires at least 50 measured lifecycle cycles'));
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
