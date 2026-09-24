import assert from 'node:assert/strict';
import { test } from 'node:test';
import { currentRuntimeEvidenceSummary } from '../../scripts/lib/evidence-report-validation.mjs';

const demo = { id: 'lab', status: 'accepted', sourceHash: 'current' };
const summary = {
  schemaVersion: 1, labId: 'lab', classification: 'inspected-runtime-evidence-preview',
  acceptanceStatus: 'accepted', canonicalSourceHash: 'current',
  runtime: { isWebGPUBackend: true }, images: [], limitations: [],
};

test('current same-lab evidence remains eligible for media validation', () => {
  assert.equal(currentRuntimeEvidenceSummary(summary, demo), summary);
});

test('stale capture hashes or acceptance states withhold media rather than halt publication', () => {
  assert.equal(currentRuntimeEvidenceSummary({ ...summary, canonicalSourceHash: 'old' }, demo), null);
  assert.equal(currentRuntimeEvidenceSummary({ ...summary, acceptanceStatus: 'incomplete' }, demo), null);
});

test('malformed or foreign evidence is not mistaken for an ordinary stale capture', () => {
  for (const change of [{ labId: 'foreign' }, { schemaVersion: 0 }, { images: null }, { runtime: {} }]) {
    assert.throws(() => currentRuntimeEvidenceSummary({ ...summary, ...change }, demo), /invalid/);
  }
});
